// 播放进度分段映射：根据 elapsedMs 得到当前显示信息
import type { Orchestration, Side, Symmetry } from '../domain/types'
import { SPRINT_LABEL, STAGE_LABEL } from '../domain/types'

export type PlayPhase = 'warmup' | 'core' | 'sprint' | 'transition' | 'landing' | 'finished'

export interface PlaySegment {
  startMs: number
  endMs: number
  phase: PlayPhase
  name: string
  symmetry: Symmetry
  dominant: Side
  sub?: string
}

export function buildSegments(o: Orchestration): PlaySegment[] {
  const segs: PlaySegment[] = []
  let t = 0

  for (const seg of o.warmup.segments) {
    segs.push({
      startMs: t,
      endMs: t + seg.durationMs,
      phase: 'warmup',
      name: seg.name,
      symmetry: seg.symmetry,
      dominant: seg.dominant,
    })
    t += seg.durationMs
  }

  // 热身 -> 核心过渡
  const warmupCore = o.transitions[0]
  if (warmupCore) {
    segs.push({
      startMs: warmupCore.atMs,
      endMs: warmupCore.atMs + warmupCore.durMs,
      phase: 'transition',
      name: '回落过渡',
      symmetry: 'full-symmetric',
      dominant: 'L',
    })
    t = warmupCore.atMs + warmupCore.durMs
  }

  o.core.forEach((unit, ui) => {
    for (const stage of unit.stages) {
      segs.push({
        startMs: t,
        endMs: t + stage.durationMs,
        phase: 'core',
        name: `${unit.index + 1} 单元·${STAGE_LABEL[stage.name]}`,
        symmetry: stage.symmetry,
        dominant: stage.dominant,
      })
      t += stage.durationMs
    }
    if (ui < o.core.length - 1) {
      const gap = o.transitions[ui + 1]
      if (gap) {
        segs.push({
          startMs: gap.atMs,
          endMs: gap.atMs + gap.durMs,
          phase: 'transition',
          name: '回落过渡',
          symmetry: 'full-symmetric',
          dominant: 'L',
        })
        t = gap.atMs + gap.durMs
      }
    }
  })

  // 核心 -> 冲刺过渡（units 之后的第 n 个过渡）
  const coreSprint = o.transitions[o.core.length]
  if (coreSprint) {
    segs.push({
      startMs: coreSprint.atMs,
      endMs: coreSprint.atMs + coreSprint.durMs,
      phase: 'transition',
      name: '回落过渡',
      symmetry: 'full-symmetric',
      dominant: 'L',
    })
    t = coreSprint.atMs + coreSprint.durMs
  }

  for (const step of o.sprint.substeps) {
    segs.push({
      startMs: t,
      endMs: t + step.durationMs,
      phase: 'sprint' as PlayPhase,
      name: SPRINT_LABEL[step.sub],
      symmetry: step.symmetry,
      dominant: step.dominant,
      sub: step.sub,
    })
    t += step.durationMs
  }

  const sprintLanding = o.transitions[o.core.length + 1]
  if (sprintLanding) {
    segs.push({
      startMs: sprintLanding.atMs,
      endMs: sprintLanding.atMs + sprintLanding.durMs,
      phase: 'transition',
      name: '回落过渡',
      symmetry: 'full-symmetric',
      dominant: 'L',
    })
    t = sprintLanding.atMs + sprintLanding.durMs
  }

  segs.push({
    startMs: t,
    endMs: t + o.landing.durationMs,
    phase: 'landing',
    name: '静默着陆',
    symmetry: 'full-symmetric',
    dominant: 'L',
  })

  return segs
}

export function getSegmentAt(o: Orchestration, elapsedMs: number): PlaySegment {
  const segs = buildSegments(o)
  const found = segs.find((s) => elapsedMs >= s.startMs && elapsedMs < s.endMs)
  if (found) return found
  if (elapsedMs >= o.totalMs + o.landing.durationMs) {
    return {
      startMs: o.totalMs + o.landing.durationMs,
      endMs: o.totalMs + o.landing.durationMs,
      phase: 'finished',
      name: '已完成',
      symmetry: 'full-symmetric',
      dominant: 'L',
    }
  }
  return segs[0]
}