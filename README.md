# 节奏按摩引导器（双垫版 v3）

纯本地、零后端、亮屏常亮移动端 Web App。依据 `PRD.md`（v3）与 `PLAN.md` 实现。

## 技术栈
- React 18 + TypeScript + Vite
- Web Audio API（7 音色实时合成：6 种节拍音 + 静默；左右声道分离、lookahead 调度）
- 本地 TTS 语音播报（`say` 预生成 m4a，阶段首事件播放）
- Wake Lock 亮屏常亮 + 切后台/锁屏自动暂停 + 扣屏渐隐全黑
- localStorage / sessionStorage / IndexedDB（纯本地存储）
- GitHub Pages 部署（`./` 相对 base，`docs/` 目录模式）

## 开发
```bash
npm install
npm run dev        # 本地开发
npm test           # 编排引擎 v3 / 时间线 / 播放分段单测
npm run build      # 产物输出到 dist/
npm run preview    # 本地预览构建产物
```

## 部署
仓库 GitHub Pages 源为 `main` 分支 `/docs` 目录；本地 `npm run build && rm -rf docs && cp -R dist docs` 后提交推送即可。

## 已实现（v3）
- 五模式：摩擦/轻触/点按/全覆盖/**静置**，单侧无动作 = **空置**
- 活动状态：双侧 / 左侧 / 右侧 / 静置 / 交错
- 回落两段式：乳晕摩擦 ↘ → 静置，核心段 静置:有动作 ≈ 1:2
- 冲刺：双侧起冲 → 加速 → 波峰左右交替 → 高位持续 → 收尾；冲刺禁摩擦与静置
- 七条硬性规则 validator + 单测
- 音频：单侧仅对应耳出声、静置双耳静默、波峰左右反相、蓄力/回落方向提示音
- 播放器：Wake Lock 亮屏常亮、切后台自动暂停、扣屏渐隐全黑、进度存档/2h 恢复
- 语音播报：预生成 `public/voices/*.m4a`，阶段切换自动播报
- 历史（最近 20）/ 收藏 / 设置（速度档、音色、振动、播放模式、清空数据）
- 单元测试 + Playwright 冒烟脚本

## 冒烟测试
```bash
# 终端 1
npm run dev
# 终端 2（需要 Python + playwright）
python3 scripts/smoke_test.py
```

## 待完善（后续）
- 冲刺“左右快闪”微细节精细化
- 真机亮屏/Wake Lock/加速度计回归测试
- 若接入 Qwen3-TTS，可将本地 m4a 替换为后端批量生成并缓存