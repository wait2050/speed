// 编排引擎：纯 TS 生成 Orchestration，不依赖 DOM/audio。
// 实现《制作方案》§4：时长分配、螺旋单元、冲刺、六条硬性规则由 validator 独立校验。

import {
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

// ── 常量 ──
export const TRANSITION_MS = 3000
export const MIN_UNITS = 2
export const MAX_UNITS = 4
export const MIN_WARMUP_MS = 20_000
export const MIN_SPRINT_MS = 60_000
export const MIN_SEDUCE_MS = 25_000
export const MIN_CHARGE_MS = 20_000
export const MIN_CLIMB_MS = 30_000
export const MIN_RELEASE_MS = 40_000
export const MIN_COOLDOWN_MS = 15_000
export const MIN_UNIT_MS =
  MIN_SEDUCE_MS + MIN_CHARGE_MS + MIN_CLIMB_MS + MIN_RELEASE_MS + MIN_COOLDOWN_MS

const AREOLA_TIMBRE: Timbre = 'woodfish'
const BASE_RELEASE_SEC = [40, 50, 60, 50]
const BASE_RELEASE_BPM = [105, 120, 135, 135]
const BASE_SPRINT_SEC = [40, 50, 60, 60, 15]
const UNIT_BASE_SEC = 165

export function computeMinFeasibleSec(): number {
  // 选择能同时满足“20/20/60 比例 + 阶段/冲刺下限”的最小 n=2 总时长
  for (let n = MIN_UNITS; n <= MAX_UNITS; n++) {
    const coreMinMs = n * MIN_UNIT_MS
    const availMinMs = coreMinMs / 0.6
    if (availMinMs * 0.2 >= MIN_WARMUP_MS && availMinMs * 0.2 >= MIN_SPRINT_MS) {
      return Math.ceil((availMinMs + (n + 2) * TRANSITION_MS) / 1000)
    }
  }
  return 0
}

function areolaSide(bpm: number): SideSpec {
  return { mode: 'areola-friction', bpm, timbre: AREOLA_TIMBRE }
}

function makeSide(
  mode: Mode,
  bpm: number,
  timbre: Timbre,
  dominant?: boolean,
  direction?: 'cw' | 'ccw',
): SideSpec {
  return { mode, bpm, timbre, ...(dominant !== undefined ? { dominant } : {}), direction }
}

/** 把候选毫秒数映射到各阶段最小毫秒数组 */
function stageMinMs(): number[] {
  return [MIN_SEDUCE_MS, MIN_CHARGE_MS, MIN_CLIMB_MS, MIN_RELEASE_MS, MIN_COOLDOWN_MS]
}

/** 在保证每阶段 >= 最小毫秒的前提下，把数组总长调整到 targetMs */
function fitStageMs(ms: number[], targetMs: number): number[] {
  const min = stageMinMs()
  const arr = ms.map((v, i) => Math.max(Math.round(v), min[i]))
  let sum = arr.reduce((a, b) => a + b, 0)
  let diff = targetMs - sum
  if (diff === 0) return arr

  if (diff > 0) {
    // 余量优先追加到释放段
    arr[3] += diff
    return arr
  }

  let remaining = -diff
  // 从后往前削减（优先削减释放/回落，保留阶段下限）
  for (let i = arr.length - 1; i >= 0 && remaining > 0; i--) {
    const can = arr[i] - min[i]
    const take = Math.min(can, remaining)
    arr[i] -= take
    remaining -= take
  }
  if (remaining > 0) {
    throw new Error(`无法在阶段下限约束内凑齐 ${targetMs}ms`)
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
      symmetry: 'full-symmetric',
      dominant: 'L',
      left: { ...side },
      right: { ...side },
    }
  })
  return { durationMs: msArr.reduce((a, b) => a + b, 0), segments }
}

function buildCoreUnit(
  index: number,
  unitTargetMs: number,
  settings: Settings,
  rng: Rng,
): Unit {
  const dominant: Side = index % 2 === 0 ? 'L' : 'R'
  const releaseBaseSec = BASE_RELEASE_SEC[index % BASE_RELEASE_SEC.length]
  const releaseSec = clamp(
    releaseBaseSec * randomBetween(rng, 0.8, 1.2),
    MIN_RELEASE_MS / 1000,
    60,
  )
  const releaseBpm = BASE_RELEASE_BPM[index % BASE_RELEASE_BPM.length]

  const baseSecs: number[] = [
    randomBetween(rng, 25, 35), // seduce
    randomBetween(rng, 20, 30), // charge
    randomBetween(rng, 30, 40), // climb
    releaseSec,
    randomBetween(rng, 15, 20), // cooldown
  ]
  const targetMs = Math.round(unitTargetMs)
  // scaleToTarget 直接返回毫秒数组
  const scaledMs = scaleToTarget(baseSecs, targetMs / 1000)
  const durMs = fitStageMs(scaledMs, targetMs)

  const slow = settings.speeds.slow
  const medium = settings.speeds.medium
  const fast = settings.speeds.fast
  const extreme = settings.speeds.extreme
  const releaseTimbre = releaseBpm >= 135 ? extreme.timbre : fast.timbre

  const dominantSpec = (mode: Mode, bpm: number, timbre: Timbre): SideSpec =>
    makeSide(mode, bpm, timbre, true)
  const assistSpec = (mode: Mode, bpm: number, timbre: Timbre): SideSpec =>
    makeSide(mode, bpm, timbre, false)

  const stages: UnitStage[] = [
    // 引诱：完全非对称，主导侧轻触 / 辅助侧乳晕摩擦
    {
      name: 'seduce',
      durationMs: durMs[0],
      symmetry: 'full-asymmetric',
      dominant,
      left:
        dominant === 'L'
          ? dominantSpec('light-touch', slow.bpm, slow.timbre)
          : assistSpec('areola-friction', slow.bpm, AREOLA_TIMBRE),
      right:
        dominant === 'R'
          ? dominantSpec('light-touch', slow.bpm, slow.timbre)
          : assistSpec('areola-friction', slow.bpm, AREOLA_TIMBRE),
      cue: 'approach-seduce-end',
    },
    // 蓄力：完全对称，双侧点按-松开
    {
      name: 'charge',
      durationMs: durMs[1],
      symmetry: 'full-symmetric',
      dominant,
      left: makeSide('press-release', medium.bpm, medium.timbre),
      right: makeSide('press-release', medium.bpm, medium.timbre),
    },
    // 攀爬：偏对称，主导侧全覆盖 / 辅助侧点按-松开
    {
      name: 'climb',
      durationMs: durMs[2],
      symmetry: 'biased',
      dominant,
      left:
        dominant === 'L'
          ? dominantSpec('full-cover', fast.bpm, fast.timbre)
          : assistSpec('press-release', medium.bpm, medium.timbre),
      right:
        dominant === 'R'
          ? dominantSpec('full-cover', fast.bpm, fast.timbre)
          : assistSpec('press-release', medium.bpm, medium.timbre),
      cue: 'approach-release',
    },
    // 释放：完全对称，双侧全覆盖
    {
      name: 'release',
      durationMs: durMs[3],
      symmetry: 'full-symmetric',
      dominant,
      left: makeSide('full-cover', releaseBpm, releaseTimbre),
      right: makeSide('full-cover', releaseBpm, releaseTimbre),
      cue: 'approach-cooldown',
    },
    // 回落：完全对称，双侧乳晕摩擦
    {
      name: 'cooldown',
      durationMs: durMs[4],
      symmetry: 'full-symmetric',
      dominant,
      left: areolaSide(slow.bpm),
      right: areolaSide(slow.bpm),
    },
  ]

  return {
    index,
    stages,
    releaseDurationMs: durMs[3],
    releaseBpm,
    climbSymmetry: 'biased',
    releaseSymmetry: 'full-symmetric',
  }
}

function buildSprint(sprintMs: number, settings: Settings): { substeps: SprintStep[] } {
  const slow = settings.speeds.slow
  const medium = settings.speeds.medium
  const fast = settings.speeds.fast
  const extreme = settings.speeds.extreme
  const durMs = scaleToTarget(
    [...BASE_SPRINT_SEC],
    sprintMs / 1000,
  ).map((ms) => Math.round(ms))

  const fullSide = (bpm: number, timbre: Timbre, direction?: 'cw' | 'ccw') =>
    makeSide('full-cover', bpm, timbre, false, direction)
  const pressSide = () => makeSide('press-release', medium.bpm, medium.timbre)
  const touchSide = () => makeSide('light-touch', slow.bpm, settings.endTimbre)

  const direction = 'cw'
  const substeps: SprintStep[] = [
    {
      sub: 'pushoff',
      name: '起冲',
      durationMs: durMs[0],
      symmetry: 'full-symmetric',
      dominant: 'L',
      left: fullSide(105, fast.timbre, direction),
      right: fullSide(105, fast.timbre, direction),
      bpmStart: 105,
      bpmEnd: 105,
    },
    {
      sub: 'ramp',
      name: '加速',
      durationMs: durMs[1],
      symmetry: 'full-symmetric',
      dominant: 'L',
      left: fullSide(105, fast.timbre, direction),
      right: fullSide(105, fast.timbre, direction),
      bpmStart: 105,
      bpmEnd: 120,
    },
    {
      sub: 'peak',
      name: '波峰',
      durationMs: durMs[2],
      symmetry: 'staggered',
      dominant: 'L',
      left: fullSide(135, extreme.timbre, direction),
      right: pressSide(),
      bpmStart: 135,
      bpmEnd: 135,
    },
    {
      sub: 'plateau',
      name: '高位持续',
      durationMs: durMs[3],
      symmetry: 'full-symmetric',
      dominant: 'L',
      left: fullSide(120, fast.timbre, 'ccw'),
      right: fullSide(120, fast.timbre, 'ccw'),
      bpmStart: 120,
      bpmEnd: 105,
    },
    {
      sub: 'taper',
      name: '收尾',
      durationMs: durMs[4],
      symmetry: 'full-symmetric',
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
  let restMs = 0
  const addRest = (left: SideSpec, right: SideSpec, dur: number) => {
    if (left.mode === 'areola-friction' && right.mode === 'areola-friction') {
      restMs += dur
    }
  }
  for (const seg of o.warmup.segments) addRest(seg.left, seg.right, seg.durationMs)
  for (const unit of o.core) {
    for (const stage of unit.stages) addRest(stage.left, stage.right, stage.durationMs)
  }
  for (const t of o.transitions) {
    restMs += t.durMs // 过渡固定为乳晕摩擦
  }
  const totalSec = o.totalMs / 1000
  const restSec = Math.round(restMs / 1000)
  return {
    totalSec,
    stimSec: Math.round(totalSec - restSec),
    restSec,
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
    const error: GenerateError = { code: 'TOO_SHORT', minFeasibleSec }
    return { ok: false, error }
  }

  const totalMs = totalSec * 1000
  const rng = mulberry32(seed)

  // 选择核心单元数（2-4），按 60% 目标 + 可行约束逐步降级
  let n = clamp(Math.round((totalSec * 0.6) / UNIT_BASE_SEC), MIN_UNITS, MAX_UNITS)
  for (;;) {
    const transitionsMs = (n + 2) * TRANSITION_MS
    const availMs = totalMs - transitionsMs
    const warmupMs = Math.round(availMs * 0.2)
    const sprintMs = Math.round(availMs * 0.2)
    const coreMs = availMs - warmupMs - sprintMs
    if (
      coreMs >= n * MIN_UNIT_MS &&
      warmupMs >= MIN_WARMUP_MS &&
      sprintMs >= MIN_SPRINT_MS
    ) {
      break
    }
    if (n > MIN_UNITS) {
      n--
      continue
    }
    // 理论不可达（minFeasibleSec 已拦截），保守返回错误
    return {
      ok: false,
      error: { code: 'TOO_SHORT', minFeasibleSec },
    }
  }

  const transitionsMs = (n + 2) * TRANSITION_MS
  const availMs = totalMs - transitionsMs
  const warmupMs = Math.round(availMs * 0.2)
  const sprintMs = Math.round(availMs * 0.2)
  const coreMs = availMs - warmupMs - sprintMs

  const warmup = buildWarmup(warmupMs, settings, rng)
  const perUnitMs = coreMs / n
  const units: Unit[] = []
  let unitTargets: number[] = []
  for (let i = 0; i < n; i++) {
    const unit = buildCoreUnit(i, perUnitMs, settings, rng)
    units.push(unit)
    unitTargets.push(unit.stages.reduce((a, s) => a + s.durationMs, 0))
  }
  const sprint = buildSprint(sprintMs, settings)
  const transitions = buildTransitions(warmupMs, unitTargets, sprintMs)

  // 校验并构建最终对象
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