先看了 TTS 能力，Qwen3-TTS 支持 SSML 精确停顿、多音色、语速控制，完全可以承担"语音播报下一动作"的角色。下面是完整架构方案。

---

# 节奏按摩引导器 · 架构方案

## 一、整体架构

```
┌─────────────────────────────────────────────────────────┐
│                    浏览器（亮屏常亮）                      │
│  ┌───────────┐ ┌──────────┐ ┌──────────────────────┐   │
│  │ 编排编译器 │ │ 播放引擎 │ │ UI 层（进度条/屏幕）  │   │
│  │ (JS)      │ │ (JS)     │ │ (DOM + Canvas)       │   │
│  └─────┬─────┘ └────┬─────┘ └──────────┬───────────┘   │
│        │             │                  │               │
│  ┌─────┴─────────────┴──────────────────┴───────────┐   │
│  │              音频子系统（双轨并行）                  │   │
│  │  ┌─────────────────┐  ┌──────────────────────┐   │   │
│  │  │ 节拍合成轨       │  │ 语音播报轨            │   │   │
│  │  │ Web Audio API    │  │ HTML5 Audio / blob   │   │   │
│  │  │ 6 种音色实时合成  │  │ 预生成 TTS 片段       │   │   │
│  │  │ 左右声道分离      │  │ 阶段切换时触发        │   │   │
│  │  └─────────────────┘  └──────────────────────┘   │   │
│  └─────────────────────────────────────────────────┘   │
│                                                         │
│  ┌──────────┐ ┌──────────┐ ┌────────────────────┐      │
│  │ Wake Lock│ │ 加速度计 │ │ 存储（local/IDB/   │      │
│  │ 屏幕常亮 │ │ 扣下暂停 │ │ sessionStorage）    │      │
│  └──────────┘ └──────────┘ └────────────────────┘      │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│                  后端（Python 微服务）                     │
│  ┌──────────────────────────────────────────────────┐   │
│  │  TTS 代理层                                       │   │
│  │  - 接收前端发来的播报文本列表                       │   │
│  │  - 调用 dashscope Qwen3-TTS                       │   │
│  │  - 返回合成后的 mp3 blob                          │   │
│  │  - 可缓存常用短语（如"左侧轻触"）                   │   │
│  └──────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────┐   │
│  │  静态资源服务                                      │   │
│  │  - HTML / CSS / JS                                │   │
│  └──────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

---

## 二、编排编译器（Choreography Compiler）

这是整个应用的大脑，放在前端 JS 中。输入用户设定、输出一份完整时间线。

### 2.1 输入

```
{
  totalDuration: 1800,        // 秒
  warmupRatio: 0.20,
  coreRatio: 0.60,
  sprintRatio: 0.20,
  areolaBufferMin: 10,        // 乳晕缓冲最小时长（秒）
  areolaBufferMax: 30,        // 乳晕缓冲最大时长（秒）
  speedProfiles: {            // 四档速度
    slow:   { bpm: 60,  timbre: 'waterdrop' },
    medium: { bpm: 105, timbre: 'fingertap' },
    fast:   { bpm: 120, timbre: 'heartbeat' },
    max:    { bpm: 135, timbre: 'kickdrum' }
  },
  restRatio: 0.33             // 静置配比 1:2
}
```

### 2.2 输出：时间线数组

```typescript
type TimelineEvent = {
  startTime: number;          // 开始秒数
  duration: number;           // 持续秒数
  phase: '引诱' | '蓄力' | '攀爬' | '释放' | '回落_摩擦' | '回落_静置'
       | '起冲' | '加速' | '波峰' | '高位持续' | '收尾' | '静默着陆'
       | '热身_摩擦' | '热身_轻触';
  activityState: 'bilateral' | 'left_only' | 'right_only' | 'rest';
  dominantSide?: 'L' | 'R';   // 单侧时才有
  mode: 'areola_rub' | 'light_touch' | 'press_release' | 'full_coverage' | 'rest';
  bpm: number;
  timbre: string;             // 音色标识
  channel: 'both' | 'left' | 'right' | 'silent';  // 声道
  voicePrompt: string;        // TTS 播报文本（阶段首事件）
  slideDirection?: 'updown' | 'leftright' | 'rotate'; // 全覆盖时的滑动方向
};
```

### 2.3 编译步骤

```
1. 按比例切分阶段时长
2. 核心段计算：根据有动作总时长 ÷ 3min 得单元数 N
3. 计算静置总时长 = 有动作总时长 × 0.5（1:2 → 静置 = 1/3 核心 = 0.5×有动作）
4. 每个单元分配静置时长 = 静置总时长 / N
5. 每个单元内：
   - 乳晕摩擦回落 = random(areolaBufferMin, areolaBufferMax)
   - 其余阶段按比例微调（±20%）
6. 冲刺段按固定模板展开
7. 从头到尾遍历，为每个阶段首事件生成 voicePrompt
8. 输出完整 TimelineEvent[]
```

---

## 三、播放引擎（Playback Engine）

### 3.1 核心循环

```
┌──────────────────────────────────────────────────┐
│              requestAnimationFrame 循环            │
│  ┌────────────────────────────────────────────┐  │
│  │  每帧检查：                                  │  │
│  │  1. 当前时间落在哪个 TimelineEvent           │  │
│  │  2. 是否为事件边界（阶段切换）→ 触发语音播报  │  │
│  │  3. 更新节拍合成参数（BPM/音色/声道）         │  │
│  │  4. 更新屏幕显示（阶段名/倒计时/状态徽标）    │  │
│  │  5. 更新进度条                               │  │
│  │  6. 更新 sessionStorage 进度                 │  │
│  └────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────┘
```

### 3.2 状态机

```
states: IDLE → PREVIEW → PLAYING → PAUSED → FINISHED
                          ↑         │
                          └─ resume ┘

PLAYING 内部子状态由 TimelineEvent 驱动，无额外状态机。
```

### 3.3 进度保存

```
sessionStorage key: "massage_progress"
{
  sessionId: "uuid",
  timeline: TimelineEvent[],   // 完整时间线（序列化）
  elapsedSeconds: number,
  updatedAt: timestamp,
  validUntil: timestamp + 2h
}
```

---

## 四、音频子系统（双轨并行）

### 4.1 节拍合成轨（Web Audio API，实时）

```
AudioContext
├── leftChannel: GainNode → PannerNode (hard left)
│   ├── OscillatorNode (主音色)
│   └── OscillatorNode (泛音层，可选)
├── rightChannel: GainNode → PannerNode (hard right)
│   ├── OscillatorNode
│   └── OscillatorNode
└── masterGain

每拍触发：
  根据当前 TimelineEvent.timbre 设置 oscillator 波形/频率
  根据 bpm 计算拍间隔 → setInterval 或 scheduler 精准排拍
  根据 channel 决定左/右/双声道 gain
  非对称时：活动侧 gain=1.0，空置侧 gain=0
  静置时：masterGain=0
```

6 种音色的 Oscillator 配置：

| 音色   | 波形       | 基频              | 包络                            |
| ---- | -------- | --------------- | ----------------------------- |
| 水滴   | sine     | 800Hz           | 短 attack 10ms + 快 decay 100ms |
| 木鱼   | triangle | 400Hz           | 短 attack 5ms + decay 80ms     |
| 指尖敲击 | square   | 600Hz           | attack 5ms + decay 60ms       |
| 心跳   | sine     | 60Hz + 120Hz 双频 | attack 50ms + decay 200ms     |
| 低音鼓点 | sine     | 50Hz            | attack 10ms + decay 300ms     |
| 经典嗒音 | triangle | 1000Hz          | attack 2ms + decay 40ms       |

### 4.2 语音播报轨（TTS 预生成）

**策略**：播放前预生成全部播报音频，存为 blob URL 数组，播放时按时间戳触发。

```
流程：
  编排编译完成
    ↓
  提取所有 voicePrompt（去重）
    ↓
  发送到后端 /api/tts/batch
    ↓
  后端逐条调用 Qwen3-TTS，返回 mp3 bytes
    ↓
  前端转 blob URL，存入 Map<prompt, blobUrl>
    ↓
  播放引擎在事件边界时：
    audio = new Audio(blobUrl)
    audio.play()
```

**后端 TTS 批量接口设计**：

```python
# POST /api/tts/batch
# body: { "prompts": ["引诱，左侧轻触", "双侧全覆盖滑动", "静置，双手休息"] }
# response: { "audios": { "引诱，左侧轻触": "<base64 mp3>", ... } }

# 优化：常用短语缓存到磁盘，重复 session 免调 API
```

**语音播报时机**：只在阶段首事件触发，不在阶段内部重复。播报音量低于节拍（gain=0.6），不打断节拍流。

**SSML 停顿利用**：如果单条播报需要内部节奏（如"蓄力，乳晕摩擦升温，然后点按"），用 SSML `<break time="500ms"/>` 制造自然停顿。

---

## 五、进度条方案

### 5.1 视觉设计

```
┌──────────────────────────────────────────────────────────────┐
│  热身         核心（单元1）    单元2      单元3    冲刺   着陆 │
│ ▓▓▓▓▓▓▓▓░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ │
│ ████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ │
│ ▲                                                       ◆  │
│ 已播放 4:32                                   剩余 25:28    │
└──────────────────────────────────────────────────────────────┘
```

- 横向满宽条，高度约 6-8px（可触摸区域扩大到 24px）
- 各阶段用不同底色分段：热身=浅橙、核心=浅紫、冲刺=深红、着陆=浅蓝
- 已播放部分填充同色系深色，未播放部分为浅色/灰色
- 当前位置用白色竖线或圆点标记
- 上方悬浮当前阶段名称
- 轻触进度条任意位置弹出该时刻的阶段预览（不改变播放位置，只读）

### 5.2 实现方式

两种选择：

**方案 A：Canvas 2D**（推荐）

- 绘制分段色块 + 播放进度覆盖 + 位置指示器
- 性能好，适合 60fps 更新
- 触摸命中检测用坐标换算

**方案 B：纯 DOM + CSS**

- 每段一个 `<div>`，用 `flex-grow` 按比例分配宽度
- 播放进度用绝对定位的覆盖层
- 实现更简单但分段多时 DOM 节点多

建议用 **Canvas**，因为时间线可能有 20+ 个段（热身 2 段 + 核心 N×5 段 + 冲刺 7 段 + 着陆 1 段），Canvas 一次性绘制更干净。

### 5.3 Canvas 绘制逻辑

```
function drawProgressBar(ctx, width, height, timeline, currentTime, totalTime) {
  // 1. 按时间比例绘制各阶段色块
  for (event of timeline.groupByPhase()) {
    x = event.startTime / totalTime * width;
    w = event.duration / totalTime * width;
    fillStyle = phaseColor(event.phase);
    fillRect(x, 0, w, height);
  }

  // 2. 已播放遮罩（加深已播区域）
  playedWidth = currentTime / totalTime * width;
  fillStyle = 'rgba(0,0,0,0.2)';
  fillRect(0, 0, playedWidth, height);

  // 3. 当前位置指示器
  strokeStyle = 'white';
  lineWidth = 2;
  beginPath();
  moveTo(playedWidth, 0);
  lineTo(playedWidth, height);
  stroke();

  // 4. 阶段标签（在条上方）
  // 只绘制宽度 > 40px 的段的标签，避免拥挤
}
```

### 5.4 屏幕显示布局（播放中）

```
┌─────────────────────────────────┐
│  ● 核心 · 单元 2                │  ← 阶段 + 单元
│                                 │
│        ┌──────────┐             │
│        │   0:32   │             │  ← 圆形倒计时（当前阶段剩余）
│        │  释放    │             │
│        │  ●双侧●  │             │  ← 活动状态徽标
│        │  主导 L  │             │  ← 主导侧（单侧时显示）
│        └──────────┘             │
│                                 │
│  ▓▓▓▓▓▓▓▓▓▓░░░░░░░░░░░░░░░░░  │  ← 进度条
│  ▲ 4:32 / 30:00                │
│                                 │
│  [扣下暂停]                     │  ← 提示文字（渐隐）
└─────────────────────────────────┘
```

---

## 六、技术栈与项目结构

```
speed-ui/
├── index.html              # SPA 入口
├── css/
│   └── app.css             # 全局样式、进度条、倒计时
├── js/
│   ├── app.js              # 主控：初始化、路由（首页/播放/历史）
│   ├── compiler.js         # 编排编译器：输入→时间线
│   ├── player.js           # 播放引擎：时间线驱动循环
│   ├── audio/
│   │   ├── beat_synth.js   # 节拍合成：Web Audio 6 音色 + 声道控制
│   │   └── voice_player.js # 语音播报：TTS blob 管理与触发
│   ├── ui/
│   │   ├── progress_bar.js # Canvas 进度条
│   │   ├── countdown.js    # 圆形倒计时组件
│   │   └── screen.js       # 屏幕状态管理（亮屏/扣下/翻转）
│   ├── storage.js          # localStorage / IDB / sessionStorage 封装
│   └── utils.js            # 时间格式化、随机工具
├── sw.js                   # Service Worker（离线缓存，可选）
└── manifest.json           # PWA（可选）

backend/
├── server.py               # Flask/FastAPI 主服务
├── tts_client.py           # Qwen3-TTS 调用封装（基于已有 demo）
├── tts_cache/              # 常用短语 mp3 缓存目录
└── requirements.txt
```

---

## 七、语音播报文本模板

编译器生成 voicePrompt 时从模板库拼接：

```
模式播报：
  引诱："引诱，{主导侧}轻触"          → "引诱，左侧轻触"
  蓄力："蓄力，乳晕摩擦升温，然后点按"
  攀爬："攀爬，{主导侧}全覆盖滑动"     → "攀爬，右侧全覆盖滑动"
  释放："释放，双侧同步全覆盖{方向}"   → "释放，双侧同步全覆盖旋转"
  回落_摩擦："回落，双侧乳晕摩擦降温"
  回落_静置："静置，双手休息"

冲刺播报：
  起冲："冲刺开始，双侧全覆盖滑动"
  加速："加速，全覆盖旋转"
  波峰："波峰，左右交替"
  高位持续："高位持续，慢下来"
  收尾："收尾，轻触"

阶段切换：
  热身→核心："进入核心阶段"
  核心→冲刺："进入冲刺阶段"

过渡信号：
  单侧→双侧："汇合"
  进入静置："静置"（轻声）
  静置结束："准备"（轻声）
```

这些模板对应的 TTS 短语约 30-40 条，首次使用后全部缓存到后端磁盘 + 前端 IndexedDB，后续 session 零 API 调用。

---

## 八、关键数据流

```
用户设定时长
      │
      ▼
compiler.js 生成 TimelineEvent[]
      │
      ├──→ 提取 voicePrompt[] → 去重
      │         │
      │         ▼
      │    backend /api/tts/batch
      │         │
      │         ▼
      │    voice_player.js 缓存 blob URL Map
      │
      ├──→ UI 渲染预览列表 + 进度条分段
      │
      └──→ 用户点「开始播放」
                │
                ▼
         player.js 启动 rAF 循环
                │
         ┌──────┼──────┐
         ▼      ▼      ▼
    beat_synth  voice   UI 更新
    (连续节拍)  (阶段首) (倒计时+进度条+状态)
                │
                ▼
         进度写 sessionStorage
```

---

## 九、开发优先级

| 优先级 | 模块                             | 原因             |
| --- | ------------------------------ | -------------- |
| P0  | compiler.js                    | 无时间线一切无法运转     |
| P0  | beat_synth.js                  | 核心体验载体         |
| P1  | player.js                      | 驱动播放           |
| P1  | progress_bar.js + countdown.js | 屏幕显示           |
| P1  | 后端 tts_client.py + server.py   | 语音播报（可与前端并行开发） |
| P2  | voice_player.js                | 依赖后端就绪         |
| P2  | 扣下/翻转暂停                        | 增强体验           |
| P3  | 历史/收藏/存储                       | 留存功能           |
| P3  | Service Worker                 | 离线能力           |
