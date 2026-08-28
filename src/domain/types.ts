// 领域基础类型（对应 PRD §4 与《制作方案》§3）

export type Mode = 'areola-friction' | 'light-touch' | 'press-release' | 'full-cover'
export type Symmetry = 'full-asymmetric' | 'biased' | 'full-symmetric' | 'staggered'
export type Timbre =
  | 'classic'
  | 'woodfish'
  | 'heartbeat'
  | 'waterdrop'
  | 'fingertip'
  | 'bassdrum'
export type Side = 'L' | 'R'
export type StageName = 'seduce' | 'charge' | 'climb' | 'release' | 'cooldown'
export type SprintSubName = 'pushoff' | 'ramp' | 'peak' | 'plateau' | 'taper'
export type Cue =
  | 'approach-seduce-end'
  | 'approach-release'
  | 'approach-cooldown'
  | 'handoff'
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
  areolaMinSec: number // 10-30，随机下限
  areolaMaxSec: number // 10-30，随机上限
  endTimbre: Timbre
  haptics: {
    enabled: boolean
    intensity: 'weak' | 'standard' | 'strong'
  }
  defaultDurationMin: number
}

export interface SideSpec {
  mode: Mode
  bpm: number
  timbre: Timbre
  direction?: 'cw' | 'ccw'
  dominant?: boolean
}

export interface UnitStage {
  name: StageName
  durationMs: number
  symmetry: Symmetry
  dominant: Side
  left: SideSpec
  right: SideSpec
  cue?: Cue
}

export interface TimedSegment {
  name: string
  durationMs: number
  symmetry: Symmetry
  dominant: Side
  left: SideSpec
  right: SideSpec
  cue?: Cue
}

export interface Unit {
  index: number
  stages: UnitStage[]
  releaseDurationMs: number
  releaseBpm: number
  climbSymmetry: Symmetry
  releaseSymmetry: Symmetry
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
  stimSec: number
  restSec: number
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
}

export const SYMMETRY_LABEL: Record<Symmetry, string> = {
  'full-asymmetric': '非对称',
  biased: '偏对称',
  'full-symmetric': '对称',
  staggered: '交错对称',
}

export const STAGE_LABEL: Record<StageName, string> = {
  seduce: '引诱',
  charge: '蓄力',
  climb: '攀爬',
  release: '释放',
  cooldown: '回落',
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
  'cooldown',
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
  }
}