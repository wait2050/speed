// 把 Orchestration v3 展开为闭式节拍/信号/语音事件时间线
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
  | 'rest-start'
  | 'rest-before-end'
  | 'approach-seduce-end'
  | 'approach-release'
  | 'approach-cooldown'
  | 'heartbeat-shift'
  | 'voice'

export interface AudioEvent {
  timeMs: number
  kind: AudioEventKind
  side: 'L' | 'R' | 'both'
  timbre: Timbre
  bpm?: number
  gain?: number
  cueType?: CueType
  voicePrompt?: string
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

function pushCue(
  events: AudioEvent[],
  timeMs: number,
  cueType: CueType,
  timbre: Timbre = 'classic',
  voicePrompt?: string,
): void {
  events.push({ timeMs, kind: 'cue', side: 'both', timbre, cueType, gain: DING_GAIN, voicePrompt })
}

function addBoth(
  events: AudioEvent[],
  startMs: number,
  durMs: number,
  bpm: number,
  timbre: Timbre,
  gain: number,
  bpmEnd?: number,
): void {
  if (bpm <= 0 || timbre === 'silence') return
  let t = startMs
  while (t < startMs + durMs) {
    const progress = durMs <= 0 ? 0 : (t - startMs) / durMs
    const bpmNow = bpmEnd === undefined ? bpm : bpm + (bpmEnd - bpm) * progress
    pushBeat(events, t, 'both', timbre, bpmNow, gain)
    t += 60000 / Math.max(5, bpmNow)
  }
}

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
  if (bpm <= 0 || timbre === 'silence') return
  let t = startMs
  while (t < startMs + durMs) {
    const progress = durMs <= 0 ? 0 : (t - startMs) / durMs
    const bpmNow = bpmEnd === undefined ? bpm : bpm + (bpmEnd - bpm) * progress
    pushBeat(events, t, side, timbre, bpmNow, gain)
    t += 60000 / Math.max(5, bpmNow)
  }
}

function voiceText(stage: UnitStage): string {
  const dominant = stage.dominant === 'L' ? '左侧' : '右侧'
  switch (stage.name) {
    case 'seduce':
      return `引诱，${dominant}轻触`
    case 'charge':
      return '蓄力，乳晕摩擦升温，然后点按'
    case 'climb':
      return `攀爬，${dominant}全覆盖滑动`
    case 'release':
      return '释放，双侧同步全覆盖'
    case 'cooldown_rub':
      return '回落，双侧乳晕摩擦降温'
    case 'cooldown_rest':
      return '静置，双手休息'
    default:
      return ''
  }
}

function addStageTimeLine(
  events: AudioEvent[],
  stage: UnitStage,
  startMs: number,
): void {
  // 语音播报：阶段首事件
  const text = voiceText(stage)
  if (text) pushCue(events, startMs, 'voice', 'classic', text)

  // 静置：无节拍，仅 cue
  if (stage.name === 'cooldown_rest') {
    pushCue(events, startMs, 'rest-start')
    pushCue(events, startMs + Math.max(0, stage.durationMs - 3000), 'rest-before-end')
    return
  }

  // 蓄力：前半乳晕摩擦升温 → 后半点按
  if (stage.name === 'charge') {
    const half = Math.round(stage.durationMs / 2)
    const slow = stage.left.bpm
    const mediumBpm = stage.right.bpm
    const wood = WOODFISH
    const finger = stage.left.timbre
    addBoth(events, startMs, half, slow, wood, DEFAULT_GAIN)
    addBoth(events, startMs + half, stage.durationMs - half, mediumBpm, finger, DEFAULT_GAIN)
  } else if (stage.left.mode === 'idle' || stage.right.mode === 'idle') {
    // 单侧：仅活动耳出声
    if (stage.left.mode !== 'idle') {
      addSide(events, 'L', startMs, stage.durationMs, stage.left.bpm, stage.left.timbre, 1)
    } else {
      addSide(events, 'R', startMs, stage.durationMs, stage.right.bpm, stage.right.timbre, 1)
    }
  } else if (stage.left.mode !== 'rest' && stage.right.mode !== 'rest') {
    addBoth(events, startMs, stage.durationMs, stage.left.bpm, stage.left.timbre, DEFAULT_GAIN)
  }

  // 阶段临近结束信号
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
  const slow = settings.speeds.slow
  const fast = settings.speeds.fast
  const extreme = settings.speeds.extreme

  // 语音播报
  const texts: Record<string, string> = {
    pushoff: '冲刺开始，双侧全覆盖滑动',
    ramp: '加速，全覆盖旋转',
    peak: '波峰，左右交替',
    plateau: '高位持续，慢下来',
    taper: '收尾，轻触',
  }
  pushCue(events, startMs, 'voice', 'classic', texts[step.sub])

  if (step.sub === 'pushoff') {
    // 40s 模板：双侧 20s → 左 10s → 右 10s（按比例缩放）
    const unit = step.durationMs / 40
    const bi = 20 * unit
    const left = 10 * unit
    const right = 10 * unit
    addBoth(events, startMs, bi, 105, fast.timbre, DEFAULT_GAIN)
    addSide(events, 'L', startMs + bi, left, 105, fast.timbre, 1)
    addSide(events, 'R', startMs + bi + left, right, 105, fast.timbre, 1)
    return
  }

  if (step.sub === 'ramp') {
    // 简化：整体线性加速；左右快闪可由后续细化
    addBoth(events, startMs, step.durationMs, step.bpmStart, fast.timbre, DEFAULT_GAIN, step.bpmEnd)
    return
  }

  if (step.sub === 'peak') {
    // 波峰：左 6s 全覆盖 → 右 6s 全覆盖，严格交替，一边空置
    const cycle = 6000
    let lt = startMs
    let cur: Side = 'L'
    while (lt < startMs + step.durationMs) {
      const dur = Math.min(cycle, startMs + step.durationMs - lt)
      addSide(events, cur, lt, dur, 135, extreme.timbre, 1)
      lt += dur
      cur = cur === 'L' ? 'R' : 'L'
    }
    return
  }

  if (step.sub === 'taper') {
    // 收尾：轻触 3-5 次 + 最后 5s 乳晕摩擦缓冲（冲刺外缓冲）
    addBoth(events, startMs, step.durationMs, 20, slow.timbre, DEFAULT_GAIN)
    return
  }

  if (step.left.mode === 'idle' || step.right.mode === 'idle') {
    if (step.left.mode !== 'idle') {
      addSide(events, 'L', startMs, step.durationMs, step.left.bpm, step.left.timbre, 1, step.bpmEnd)
    } else {
      addSide(events, 'R', startMs, step.durationMs, step.right.bpm, step.right.timbre, 1, step.bpmEnd)
    }
  } else {
    addBoth(events, startMs, step.durationMs, step.bpmStart, step.left.timbre, DEFAULT_GAIN, step.bpmEnd)
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

  let ti = 0
  const takeTransition = () => {
    const trans = o.transitions[ti]
    if (trans) {
      addBoth(events, trans.atMs, trans.durMs, slow.bpm, WOODFISH, 0.5)
      t = trans.atMs + trans.durMs
      ti++
    }
  }
  takeTransition()

  // 核心单元
  o.core.forEach((unit, ui) => {
    pushCue(events, t, 'handoff')
    for (const stage of unit.stages) {
      addStageTimeLine(events, stage, t)
      t += stage.durationMs
    }
    if (ui < o.core.length - 1) takeTransition()
  })
  takeTransition()

  // 冲刺
  pushCue(events, t, 'ding-ding')
  o.sprint.substeps.forEach((step) => {
    addSprintStepTimeLine(
      events,
      step as TimedSegment & { sub: string; bpmStart: number; bpmEnd?: number },
      t,
      settings,
    )
    t += step.durationMs
  })
  takeTransition()

  // 静默着陆
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