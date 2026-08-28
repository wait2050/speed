// 编排引擎（PRD 双垫版 v3）：纯 TS 生成 Orchestration
// - 五模式（含静置/空置）
// - 回落两段式：乳晕摩擦 ↘ → 静置
// - 核心段 静置:有动作 ≈ 1:2
// - 冲刺禁止乳晕摩擦与静置（收尾摩擦由系外过渡承担）
// - 七条硬性规则由 validator 校验

import {
  ActivityState,
  GenerateError,
  GenerateResult,
  Mode,
  Orchestration,
  Settings,
  Side,
  SideSpec,
  SprintStep,
  Stats,
  Timbre,
  TimedSegment,
  Transition,
  Unit,
  UnitStage,
  defaultSettings,
} from './types'
import { Rng, clamp, mulberry32, randomBetween, scaleToTarget } from './rand'

export const TRANSITION_MS = 3000
export const MIN_UNITS = 1
export const MAX_UNITS = 6
export const MIN_WARMUP_MS = 20_000
export const MIN_SPRINT_MS = 60_000

export const MIN_SEDUCE_MS = 25_000
export const MIN_CHARGE_MS = 20_000
export const MIN_CLIMB_MS = 30_000
export const MIN_RELEASE_MS = 40_000
export const MIN_COOLDOWN_RUB_MS = 10_000
// 单单元动作最小合计（不含静置）
export const MIN_UNIT_ACTION_MS =
  MIN_SEDUCE_MS + MIN_CHARGE_MS + MIN_CLIMB_MS + MIN_RELEASE_MS + MIN_COOLDOWN_RUB_MS

const AREOLA_TIMBRE: Timbre = 'woodfish'
const REST_TIMBRE: Timbre = 'silence'
const IDLE_TIMBRE: Timbre = 'silence'
const UNIT_ACTION_BASE_SEC = 165 // 每个单元动作约 2.75min 容量
const REST_RATIO = 1 / 3 // 静置占核心总时长 1/3（静置:有动作=1:2）

export function computeMinFeasibleSec(): number {
  for (let n = MIN_UNITS; n <= MAX_UNITS; n++) {
    // 核心 = 动作 + 静置；动作至少 n*MIN_UNIT_ACTION_MS，静置 = 动作/2
    const actionCoreMinMs = n * MIN_UNIT_ACTION_MS
    const coreMinMs = actionCoreMinMs / (1 - REST_RATIO)
    const availMinMs = coreMinMs / 0.6
    if (availMinMs * 0.2 >= MIN_WARMUP_MS && availMinMs * 0.2 >= MIN_SPRINT_MS) {
      return Math.ceil((availMinMs + (n + 2) * TRANSITION_MS) / 1000)
    }
  }
  return 0
}

function idleSide(): SideSpec {
  return { mode: 'idle', bpm: 0, timbre: IDLE_TIMBRE }
}

function restSide(): SideSpec {
  return { mode: 'rest', bpm: 0, timbre: REST_TIMBRE }
}

function areolaSide(bpm: number, direction?: 'up' | 'down'): SideSpec {
  return {
    mode: 'areola-friction',
    bpm,
    timbre: AREOLA_TIMBRE,
    ...(direction ? { direction: 'updown' as const } : {}),
  }
}

function makeSide(
  mode: Mode,
  bpm: number,
  timbre: Timbre,
  dominant?: boolean,
  direction?: SideSpec['direction'],
): SideSpec {
  return { mode, bpm, timbre, ...(dominant !== undefined ? { dominant } : {}), direction }
}

function stageMinMs(): number[] {
  return [
    MIN_SEDUCE_MS,
    MIN_CHARGE_MS,
    MIN_CLIMB_MS,
    MIN_RELEASE_MS,
    MIN_COOLDOWN_RUB_MS,
  ]
}

/** 在保证前五段 >= 最小毫秒的前提下，把数组总长调整到 targetMs（不含静置） */
function fitActionMs(ms: number[], targetMs: number): number[] {
  const min = stageMinMs()
  const arr = ms.map((v, i) => Math.max(Math.round(v), min[i]))
  let sum = arr.reduce((a, b) => a + b, 0)
  let diff = targetMs - sum
  if (diff === 0) return arr
  if (diff > 0) {
    arr[3] += diff // 余量优先追加到释放
    return arr
  }
  let remaining = -diff
  for (let i = arr.length - 1; i >= 0 && remaining > 0; i--) {
    const can = arr[i] - min[i]
    const take = Math.min(can, remaining)
    arr[i] -= take
    remaining -= take
  }
  if (remaining > 0) {
    throw new Error(`无法在阶段下限内凑齐 ${targetMs}ms`)
  }
  return arr
}

function buildWarmup(warmupMs: number, settings: Settings, rng: Rng): Orchestration['warmup'] {
  const count = clamp(Math.round(warmupMs / 10_000), 2, 12)
  const baseSec = Array.from({ length: count }, () => randomBetween(rng, 8, 15))
  const msArr = scaleToTarget(baseSec, warmupMs / 1000)
  const segments: TimedSegment[] = msArr.map((dur, i) => {
    const friction = i % 2 === 0
    const mode: Mode = friction ? 'areola-friction' : 'light-touch'
    const timbre: Timbre = friction ? AREOLA_TIMBRE : settings.speeds.slow.timbre
    const side = makeSide(mode, settings.speeds.slow.bpm, timbre)
    return {
      name: friction ? '乳晕摩擦（唤醒）' : '轻触（唤醒）',
      durationMs: dur,
      activity: 'bilateral' as ActivityState,
      dominant: 'L' as Side,
      left: { ...side },
      right: { ...side },
    }
  })
  return { durationMs: msArr.reduce((a, b) => a + b, 0), segments }
}

function buildCoreUnit(
  index: number,
  actionTargetMs: number,
  restMs: number,
  settings: Settings,
  rng: Rng,
): Unit {
  const dominant: Side = index % 2 === 0 ? 'L' : 'R'
  const releaseBaseSec = index < 4 ? [40, 50, 60, 50][index] : 60
  const releaseBpm = index < 4 ? [105, 120, 135, 135][index] : 135
  const releaseSec = clamp(
    releaseBaseSec * randomBetween(rng, 0.8, 1.2),
    MIN_RELEASE_MS / 1000,
    60,
  )

  const baseSecs: number[] = [
    randomBetween(rng, 25, 35), // seduce
    randomBetween(rng, 20, 30), // charge
    randomBetween(rng, 30, 40), // climb
    releaseSec,
    randomBetween(rng, settings.areolaMinSec, settings.areolaMaxSec), // cooldown_rub
  ]
  const targetMs = Math.round(actionTargetMs)
  const scaledMs = scaleToTarget(baseSecs, targetMs / 1000)
  const actionMs = fitActionMs(scaledMs, targetMs)

  const slow = settings.speeds.slow
  const medium = settings.speeds.medium
  const fast = settings.speeds.fast
  const extreme = settings.speeds.extreme
  const releaseTimbre = releaseBpm >= 135 ? extreme.timbre : fast.timbre

  const active = (mode: Mode, bpm: number, timbre: Timbre): SideSpec =>
    makeSide(mode, bpm, timbre, true)
  const empty = (): SideSpec => idleSide()

  const stages: UnitStage[] = [
    // 引诱：单侧（主导侧轻触，另侧空置）
    {
      name: 'seduce',
      durationMs: actionMs[0],
      activity: dominant === 'L' ? 'left_only' : 'right_only',
      dominant,
      left: dominant === 'L' ? active('light-touch', slow.bpm, slow.timbre) : empty(),
      right: dominant === 'R' ? active('light-touch', slow.bpm, slow.timbre) : empty(),
      cue: 'approach-seduce-end',
    },
    // 蓄力：双侧同步，乳晕摩擦↗ → 点按（模型以点按为终态，方向提示 up）
    {
      name: 'charge',
      durationMs: actionMs[1],
      activity: 'bilateral',
      dominant,
      left: makeSide('press-release', medium.bpm, medium.timbre, false, 'updown'),
      right: makeSide('press-release', medium.bpm, medium.timbre, false, 'updown'),
      directionHint: 'up',
    },
    // 攀爬：单侧（主导侧全覆盖，另侧空置）
    {
      name: 'climb',
      durationMs: actionMs[2],
      activity: dominant === 'L' ? 'left_only' : 'right_only',
      dominant,
      left: dominant === 'L' ? active('full-cover', fast.bpm, fast.timbre) : empty(),
      right: dominant === 'R' ? active('full-cover', fast.bpm, fast.timbre) : empty(),
      cue: 'approach-release',
    },
    // 释放：双侧同步全覆盖
    {
      name: 'release',
      durationMs: actionMs[3],
      activity: 'bilateral',
      dominant,
      left: makeSide('full-cover', releaseBpm, releaseTimbre),
      right: makeSide('full-cover', releaseBpm, releaseTimbre),
      cue: 'approach-cooldown',
    },
    // 回落前段：双侧乳晕摩擦 ↘
    {
      name: 'cooldown_rub',
      durationMs: actionMs[4],
      activity: 'bilateral',
      dominant,
      left: areolaSide(slow.bpm, 'down'),
      right: areolaSide(slow.bpm, 'down'),
      directionHint: 'down',
    },
    // 回落后段：双侧静置
    {
      name: 'cooldown_rest',
      durationMs: restMs,
      activity: 'rest',
      dominant,
      left: restSide(),
      right: restSide(),
      cue: 'rest-start',
    },
  ]

  return {
    index,
    stages,
    releaseDurationMs: actionMs[3],
    releaseBpm,
    restDurationMs: restMs,
  }
}

function buildSprint(sprintMs: number, settings: Settings): { substeps: SprintStep[] } {
  const slow = settings.speeds.slow

  const fast = settings.speeds.fast
  const extreme = settings.speeds.extreme
  const durMs = scaleToTarget([40, 50, 60, 60, 15], sprintMs / 1000).map((ms) => Math.round(ms))

  const fullSide = (bpm: number, timbre: Timbre, direction?: SideSpec['direction']) =>
    makeSide('full-cover', bpm, timbre, false, direction)
  const touchSide = () => makeSide('light-touch', slow.bpm, settings.endTimbre)
  const empty = (): SideSpec => idleSide()

  const substeps: SprintStep[] = [
    {
      sub: 'pushoff',
      name: '起冲',
      durationMs: durMs[0],
      activity: 'bilateral',
      dominant: 'L',
      left: fullSide(105, fast.timbre, 'rotate'),
      right: fullSide(105, fast.timbre, 'rotate'),
      bpmStart: 105,
      bpmEnd: 105,
    },
    {
      sub: 'ramp',
      name: '加速',
      durationMs: durMs[1],
      activity: 'bilateral',
      dominant: 'L',
      left: fullSide(105, fast.timbre, 'rotate'),
      right: fullSide(105, fast.timbre, 'rotate'),
      bpmStart: 105,
      bpmEnd: 120,
    },
    {
      sub: 'peak',
      name: '波峰',
      durationMs: durMs[2],
      activity: 'staggered',
      dominant: 'L',
      left: fullSide(135, extreme.timbre, 'rotate'),
      right: empty(),
      bpmStart: 135,
      bpmEnd: 135,
    },
    {
      sub: 'plateau',
      name: '高位持续',
      durationMs: durMs[3],
      activity: 'bilateral',
      dominant: 'L',
      left: fullSide(120, fast.timbre, 'cw'),
      right: fullSide(120, fast.timbre, 'cw'),
      bpmStart: 120,
      bpmEnd: 105,
    },
    {
      sub: 'taper',
      name: '收尾',
      durationMs: durMs[4],
      activity: 'bilateral',
      dominant: 'L',
      left: touchSide(),
      right: touchSide(),
      bpmStart: 20,
      bpmEnd: 20,
    },
  ]
  return { substeps }
}

function buildTransitions(
  warmupMs: number,
  coreUnitMs: number[],
  sprintMs: number,
): Transition[] {
  const transitions: Transition[] = []
  let cursor = 0
  const push = (kind: Transition['kind']) => {
    transitions.push({ atMs: cursor, durMs: TRANSITION_MS, kind })
    cursor += TRANSITION_MS
  }
  cursor += warmupMs
  push('warmup-core')
  for (let i = 0; i < coreUnitMs.length; i++) {
    cursor += coreUnitMs[i]
    if (i < coreUnitMs.length - 1) push('unit-gap')
  }
  push('core-sprint')
  cursor += sprintMs
  push('sprint-landing')
  return transitions
}

function computeStats(
  o: Pick<Orchestration, 'warmup' | 'core' | 'sprint' | 'transitions' | 'totalMs'>,
): Stats {
  let actionMs = 0
  let restMs = 0
  for (const seg of o.warmup.segments) actionMs += seg.durationMs
  for (const unit of o.core) {
    for (const stage of unit.stages) {
      if (stage.name === 'cooldown_rest') restMs += stage.durationMs
      else actionMs += stage.durationMs
    }
  }
  for (const t of o.transitions) actionMs += t.durMs // 过渡为乳晕摩擦，算有动作
  // 冲刺也算有动作
  for (const step of o.sprint.substeps) actionMs += step.durationMs
  return {
    totalSec: o.totalMs / 1000,
    actionSec: Math.round(actionMs / 1000),
    restSec: Math.round(restMs / 1000),
    unitCount: o.core.length,
    warmupUnits: o.warmup.segments.length,
    coreUnits: o.core.length,
    sprintSteps: o.sprint.substeps.length,
  }
}

export function generateOrchestration(
  totalSec: number,
  settings: Settings = defaultSettings(),
  seed: number,
): GenerateResult {
  const minFeasibleSec = computeMinFeasibleSec()
  if (totalSec < minFeasibleSec) {
    return { ok: false, error: { code: 'TOO_SHORT', minFeasibleSec } }
  }

  const totalMs = totalSec * 1000
  const rng = mulberry32(seed)

  // 选择单元数：基于核心动作容量
  let n = clamp(
    Math.round((totalSec * 0.6 * (1 - REST_RATIO)) / UNIT_ACTION_BASE_SEC),
    MIN_UNITS,
    MAX_UNITS,
  )
  for (;;) {
    const transitionsMs = (n + 2) * TRANSITION_MS
    const availMs = totalMs - transitionsMs
    const warmupMs = Math.round(availMs * 0.2)
    const sprintMs = Math.round(availMs * 0.2)
    const coreMs = availMs - warmupMs - sprintMs
    const actionCoreMs = coreMs * (1 - REST_RATIO)
    if (
      actionCoreMs >= n * MIN_UNIT_ACTION_MS &&
      warmupMs >= MIN_WARMUP_MS &&
      sprintMs >= MIN_SPRINT_MS
    ) {
      break
    }
    if (n > MIN_UNITS) {
      n--
      continue
    }
    return { ok: false, error: { code: 'TOO_SHORT', minFeasibleSec } }
  }

  const transitionsMs = (n + 2) * TRANSITION_MS
  const availMs = totalMs - transitionsMs
  const warmupMs = Math.round(availMs * 0.2)
  const sprintMs = Math.round(availMs * 0.2)
  const coreMs = availMs - warmupMs - sprintMs
  const actionCoreMs = Math.round(coreMs * (1 - REST_RATIO))
  const restTotalMs = coreMs - actionCoreMs

  const warmup = buildWarmup(warmupMs, settings, rng)
  const perUnitActionMs = actionCoreMs / n
  const units: Unit[] = []
  const unitTotalMs: number[] = []
  let restAccum = 0
  for (let i = 0; i < n; i++) {
    const restMs = i === n - 1 ? restTotalMs - restAccum : Math.round(restTotalMs / n)
    restAccum += restMs
    const unit = buildCoreUnit(i, perUnitActionMs, restMs, settings, rng)
    units.push(unit)
    unitTotalMs.push(unit.stages.reduce((a, s) => a + s.durationMs, 0))
  }

  const sprint = buildSprint(sprintMs, settings)
  const transitions = buildTransitions(warmupMs, unitTotalMs, sprintMs)

  const o: Orchestration = {
    id: `o-${seed}-${Date.now().toString(36)}`,
    seed,
    createdAt: Date.now(),
    totalSec,
    totalMs,
    minFeasibleSec,
    warmup,
    core: units,
    sprint,
    landing: { durationMs: 60_000, heartbeatDecaySec: 30, silenceSec: 30 },
    transitions,
    stats: undefined as unknown as Stats,
  }
  o.stats = computeStats(o)

  return { ok: true, orchestration: o }
}

export { defaultSettings }
export type { GenerateError }