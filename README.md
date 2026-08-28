# 节奏按摩引导器（双垫版）

纯本地、零后端、零操作移动端 Web App。依据 `PRD.md` / `制作方案.md` 实现。

## 技术栈
- React 18 + TypeScript + Vite
- Web Audio API（6 音色实时合成、左右声道分离、lookahead 调度）
- localStorage / sessionStorage / IndexedDB（纯本地存储）
- GitHub Pages 部署（`./` 相对 base，支持子路径）

## 开发
```bash
npm install
npm run dev        # 本地开发
npm test           # 编排引擎 / 时间线 / 播放分段单测
npm run build      # 产物输出到 dist/
npm run preview    # 本地预览构建产物
```

## 部署
仓库开启 GitHub Pages（Actions 部署），推送 `main` 后自动构建发布。

## 已实现
- M0 项目骨架、暗色主题、底部导航、PWA manifest
- M1 纯 TS 编排引擎：时长分配、螺旋单元、冲刺结构、六条硬性规则 validator、统计
- M2 Web Audio 音频引擎：6 音色、lookahead 调度、左右声道 70:30、阶段 cue、振动脉冲；短会话预渲染 AudioBuffer + 长会话实时调度（hybrid）
- M3 播放器：状态机、圆形倒计时、对称度/主导侧指示、进度存档/2h 恢复、扣屏暂停
- M4 历史（最近 20）/ 收藏 / 设置（速度档、音色、振动、清空数据）
- M5 构建通过、GitHub Pages workflow、单元测试 + Playwright 冒烟脚本

## 冒烟测试
```bash
# 终端 1
npm run dev
# 终端 2（需要 Python + playwright）
python3 scripts/smoke_test.py
```

## 待完善（后续迭代）
- 更精细的冲刺微非对称/错峰时间线
- 真机锁屏/振动回归测试
- 可选：短会话预渲染从 AudioBuffer 升级为低码率 Opus 文件（`<audio>` 锁屏最稳路径）