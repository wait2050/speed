// 领域基础类型（PRD 双垫版 v3 / PLAN.md）
// 五模式：四动作模式 + 静置；单侧无动作使用 idle（空置）表示。

export type Mode =
  | 'areola-friction'
  | 'light-touch'
  | 'press-release'
  | 'full-cover'
  | 'rest' // 静置：双侧无接触无声音
  | 'idle' // 空置：单侧阶段中另一侧无动作（对比机制）

export type ActivityState =
  | 'bilateral' // 双侧同步
  | 'left_only' // 左单侧
  | 'right_only' // 右单侧
  | 'rest' // 双侧静置
  | 'staggered' // 波峰左右交替（段级显示）

export type Timbre =
  | 'classic'
  | 'woodfish'
  | 'heartbeat'
  | 'waterdrop'
  | 'fingertip'
  | 'bassdrum'
  | 'silence' // 静置专用（主动选择的无声）

export type Side = 'L' | 'R'

export type StageName =
  | 'seduce'
  | 'charge'
  | 'climb'
  | 'release'
  | 'cooldown_rub' // 回落前段：乳晕摩擦 ↘
  | 'cooldown_rest' // 回落后段：静置

export type SprintSubName = 'pushoff' | 'ramp' | 'peak' | 'plateau' | 'taper'

export type Cue =
  | 'approach-seduce-end'
  | 'approach-release'
  | 'approach-cooldown'
  | 'handoff'
  | 'rest-start'
  | 'rest-before-end'
  | 'none'

export interface SpeedTier {
  bpm: number
  timbre: Timbre
}

export interface Settings {
  speeds: {
    slow: SpeedTier
    medium: SpeedTier
    fast: SpeedTier
    extreme: SpeedTier
  }
  areolaMinSec: number // 回落前段乳晕摩擦时长区间下限（10-30）
  areolaMaxSec: number // 上限（10-30）
  endTimbre: Timbre
  haptics: {
    enabled: boolean
    intensity: 'weak' | 'standard' | 'strong'
  }
  defaultDurationMin: number
  // v3：亮屏常亮 / 扣屏暂停
  wakeLock: boolean
  faceDownPause: boolean
}

export interface SideSpec {
  mode: Mode
  bpm: number
  timbre: Timbre
  direction?: 'cw' | 'ccw' | 'updown' | 'leftright' | 'rotate'
  dominant?: boolean
}

export interface UnitStage {
  name: StageName
  durationMs: number
  activity: ActivityState
  dominant: Side // 单侧时为主导侧；双侧/静置时为显示用
  left: SideSpec
  right: SideSpec
  cue?: Cue
  directionHint?: 'up' | 'down' // 乳晕摩擦 ↗ / ↘
}

export interface TimedSegment {
  name: string
  durationMs: number
  activity: ActivityState
  dominant: Side
  left: SideSpec
  right: SideSpec
  cue?: Cue
  directionHint?: 'up' | 'down'
}

export interface Unit {
  index: number
  stages: UnitStage[]
  releaseDurationMs: number
  releaseBpm: number
  restDurationMs: number // 该单元静置时长（回落后段）
}

export interface SprintStep extends TimedSegment {
  sub: SprintSubName
  bpmStart: number
  bpmEnd?: number
}

export interface WarmupBlock {
  durationMs: number
  segments: TimedSegment[]
}

export interface LandingBlock {
  durationMs: number
  heartbeatDecaySec: number
  silenceSec: number
}

export interface Transition {
  atMs: number
  durMs: number
  kind: 'warmup-core' | 'unit-gap' | 'core-sprint' | 'sprint-landing'
}

export interface Stats {
  totalSec: number
  actionSec: number // 有动作（四模式 + 空置所在单侧活动）
  restSec: number // 静置
  unitCount: number
  warmupUnits: number
  coreUnits: number
  sprintSteps: number
}

export interface Orchestration {
  id: string
  seed: number
  createdAt: number
  totalSec: number
  totalMs: number
  minFeasibleSec: number
  warmup: WarmupBlock
  core: Unit[]
  sprint: { substeps: SprintStep[] }
  landing: LandingBlock
  transitions: Transition[]
  stats: Stats
}

export interface GenerateError {
  code: 'TOO_SHORT'
  minFeasibleSec: number
}

export type GenerateResult =
  | { ok: true; orchestration: Orchestration }
  | { ok: false; error: GenerateError }

export const MODE_LABEL: Record<Mode, string> = {
  'areola-friction': '乳晕摩擦',
  'light-touch': '轻触',
  'press-release': '点按-松开',
  'full-cover': '全覆盖滑动/旋转',
  rest: '静置',
  idle: '空置',
}

export const ACTIVITY_LABEL: Record<ActivityState, string> = {
  bilateral: '双侧',
  left_only: '左侧',
  right_only: '右侧',
  rest: '静置',
  staggered: '交错',
}

export const STAGE_LABEL: Record<StageName, string> = {
  seduce: '引诱',
  charge: '蓄力',
  climb: '攀爬',
  release: '释放',
  cooldown_rub: '回落·摩擦',
  cooldown_rest: '回落·静置',
}

export const SPRINT_LABEL: Record<SprintSubName, string> = {
  pushoff: '起冲',
  ramp: '加速',
  peak: '波峰',
  plateau: '高位持续',
  taper: '收尾',
}

export const STAGE_ORDER: readonly StageName[] = [
  'seduce',
  'charge',
  'climb',
  'release',
  'cooldown_rub',
  'cooldown_rest',
]

export function defaultSettings(): Settings {
  return {
    speeds: {
      slow: { bpm: 60, timbre: 'waterdrop' },
      medium: { bpm: 105, timbre: 'fingertip' },
      fast: { bpm: 120, timbre: 'heartbeat' },
      extreme: { bpm: 135, timbre: 'bassdrum' },
    },
    areolaMinSec: 10,
    areolaMaxSec: 30,
    endTimbre: 'classic',
    haptics: { enabled: true, intensity: 'standard' },
    defaultDurationMin: 15,
    wakeLock: true,
    faceDownPause: true,
  }
}