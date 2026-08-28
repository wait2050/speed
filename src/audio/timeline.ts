// 把 Orchestration 展开为闭式节拍/信号事件时间线（《制作方案》§5.2/5.4）
import type {
  Orchestration,
  Settings,
  Side,
  Timbre,
  TimedSegment,
  UnitStage,
} from '../domain/types'

export type AudioEventKind = 'beat' | 'cue'
export type CueType =
  | 'ding'
  | 'ding-ding'
  | 'handoff'
  | 'silence'
  | 'approach-seduce-end'
  | 'approach-release'
  | 'approach-cooldown'
  | 'heartbeat-shift'

export interface AudioEvent {
  timeMs: number
  kind: AudioEventKind
  side: 'L' | 'R' | 'both'
  timbre: Timbre
  bpm?: number
  gain?: number
  cueType?: CueType
}

const DEFAULT_GAIN = 0.7
const DING_GAIN = 0.5
const WOODFISH: Timbre = 'woodfish'
const HEARTBEAT: Timbre = 'heartbeat'

function pushBeat(
  events: AudioEvent[],
  timeMs: number,
  side: 'L' | 'R' | 'both',
  timbre: Timbre,
  bpm: number,
  gain: number,
): void {
  events.push({ timeMs, kind: 'beat', side, timbre, bpm, gain })
}

function pushCue(events: AudioEvent[], timeMs: number, cueType: CueType, timbre: Timbre = 'classic'): void {
  events.push({ timeMs, kind: 'cue', side: 'both', timbre, cueType, gain: DING_GAIN })
}

/** 生成一段固定/线性 BPM 的双侧统一节拍 */
function addBoth(
  events: AudioEvent[],
  startMs: number,
  durMs: number,
  bpm: number,
  timbre: Timbre,
  gain: number,
  bpmEnd?: number,
): void {
  let t = startMs
  while (t < startMs + durMs) {
    const progress = durMs <= 0 ? 0 : (t - startMs) / durMs
    const bpmNow = bpmEnd === undefined ? bpm : bpm + (bpmEnd - bpm) * progress
    pushBeat(events, t, 'both', timbre, bpmNow, gain)
    t += 60000 / Math.max(5, bpmNow)
  }
}

/** 生成单侧节拍（用于左右声道分离） */
function addSide(
  events: AudioEvent[],
  side: Side,
  startMs: number,
  durMs: number,
  bpm: number,
  timbre: Timbre,
  gain: number,
  bpmEnd?: number,
): void {
  let t = startMs
  while (t < startMs + durMs) {
    const progress = durMs <= 0 ? 0 : (t - startMs) / durMs
    const bpmNow = bpmEnd === undefined ? bpm : bpm + (bpmEnd - bpm) * progress
    pushBeat(events, t, side, timbre, bpmNow, gain)
    t += 60000 / Math.max(5, bpmNow)
  }
}

function addStageTimeLine(
  events: AudioEvent[],
  stage: UnitStage,
  startMs: number,
): void {
  const sameMode = stage.left.mode === stage.right.mode

  if (sameMode) {
    addBoth(events, startMs, stage.durationMs, stage.left.bpm, stage.left.timbre, DEFAULT_GAIN)
  } else {
    const lGain = stage.dominant === 'L' && stage.left.dominant !== false ? 0.7 : 0.4
    const rGain = stage.dominant === 'R' && stage.right.dominant !== false ? 0.7 : 0.4
    addSide(events, 'L', startMs, stage.durationMs, stage.left.bpm, stage.left.timbre, lGain)
    addSide(events, 'R', startMs, stage.durationMs, stage.right.bpm, stage.right.timbre, rGain)
  }

  // 阶段临近结束信号（§4.7）
  if (stage.name === 'seduce') {
    pushCue(events, startMs + stage.durationMs - 5000, 'approach-seduce-end')
  } else if (stage.name === 'climb') {
    pushCue(events, startMs + stage.durationMs - 5000, 'approach-release')
  } else if (stage.name === 'release') {
    pushCue(events, startMs + stage.durationMs - 5000, 'approach-cooldown')
  }
}

function addSprintStepTimeLine(
  events: AudioEvent[],
  step: TimedSegment & { sub: string; bpmStart: number; bpmEnd?: number },
  startMs: number,
  settings: Settings,
): void {
  const medium = settings.speeds.medium
  const extreme = settings.speeds.extreme

  if (step.sub === 'peak') {
    // 交错对称：左 6s 全覆盖→3s 点按；右 3s 点按→6s 全覆盖，周期 9s
    const L = [
      { dur: 6000, bpm: 135, timbre: extreme.timbre as Timbre },
      { dur: 3000, bpm: medium.bpm, timbre: medium.timbre as Timbre },
    ]
    const R = [
      { dur: 3000, bpm: medium.bpm, timbre: medium.timbre as Timbre },
      { dur: 6000, bpm: 135, timbre: extreme.timbre as Timbre },
    ]
    let lt = startMs
    let rt = startMs
    let li = 0
    let ri = 0
    while (lt < startMs + step.durationMs) {
      const p = L[li % 2]
      addSide(events, 'L', lt, Math.min(p.dur, startMs + step.durationMs - lt), p.bpm, p.timbre, 0.6)
      lt += p.dur
      li++
    }
    while (rt < startMs + step.durationMs) {
      const p = R[ri % 2]
      addSide(events, 'R', rt, Math.min(p.dur, startMs + step.durationMs - rt), p.bpm, p.timbre, 0.6)
      rt += p.dur
      ri++
    }
    return
  }

  if (step.left.mode === step.right.mode) {
    addBoth(events, startMs, step.durationMs, step.bpmStart, step.left.timbre, DEFAULT_GAIN, step.bpmEnd)
  } else {
    addSide(events, 'L', startMs, step.durationMs, step.left.bpm, step.left.timbre, 0.7, step.bpmEnd)
    addSide(events, 'R', startMs, step.durationMs, step.right.bpm, step.right.timbre, 0.3, step.bpmEnd)
  }
}

export function buildTimeline(o: Orchestration, settings: Settings): AudioEvent[] {
  const events: AudioEvent[] = []
  const slow = settings.speeds.slow
  let t = 0

  // 热身
  for (const seg of o.warmup.segments) {
    addBoth(events, t, seg.durationMs, seg.left.bpm, seg.left.timbre, DEFAULT_GAIN)
    t += seg.durationMs
  }

  // 过渡数组按顺序消费
  let ti = 0
  const takeTransition = () => {
    const trans = o.transitions[ti]
    if (trans) {
      addBoth(events, trans.atMs, trans.durMs, slow.bpm, WOODFISH, 0.5)
      t = trans.atMs + trans.durMs
      ti++
    }
  }
  takeTransition() // warmup -> core

  // 核心单元
  o.core.forEach((unit, ui) => {
    pushCue(events, t, 'handoff') // 主导侧交接（每单元开始）
    for (const stage of unit.stages) {
      addStageTimeLine(events, stage, t)
      t += stage.durationMs
    }
    if (ui < o.core.length - 1) takeTransition() // unit-gap
  })
  takeTransition() // core -> sprint

  // 冲刺
  pushCue(events, t, 'ding-ding')
  o.sprint.substeps.forEach((step) => {
    addSprintStepTimeLine(events, step as TimedSegment & { sub: string; bpmStart: number; bpmEnd?: number }, t, settings)
    t += step.durationMs
  })
  takeTransition() // sprint -> landing

  // 静默着陆：前 30s 心跳 60→0 减速，后 30s 静默
  const landing = o.landing
  const decayMs = landing.heartbeatDecaySec * 1000
  let bt = t
  while (bt < t + decayMs) {
    const progress = (bt - t) / decayMs
    const bpmNow = 60 * (1 - progress)
    pushBeat(events, bt, 'both', HEARTBEAT, Math.max(1, bpmNow), 0.35)
    bt += 60000 / Math.max(2, bpmNow)
  }
  pushCue(events, t + decayMs, 'heartbeat-shift')

  return events
}