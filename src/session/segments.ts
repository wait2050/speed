// 播放进度分段映射：根据 elapsedMs 得到当前显示信息（PRD v3）
import type { ActivityState, Orchestration, Side } from '../domain/types'
import { SPRINT_LABEL, STAGE_LABEL } from '../domain/types'

export type PlayPhase = 'warmup' | 'core' | 'sprint' | 'transition' | 'landing' | 'finished'

export interface PlaySegment {
  startMs: number
  endMs: number
  phase: PlayPhase
  name: string
  activity: ActivityState
  dominant: Side
  sub?: string
  directionHint?: 'up' | 'down'
}

function transitionSegment(t: { atMs: number; durMs: number }): PlaySegment {
  return {
    startMs: t.atMs,
    endMs: t.atMs + t.durMs,
    phase: 'transition',
    name: '回落过渡',
    activity: 'bilateral',
    dominant: 'L',
  }
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
      activity: seg.activity,
      dominant: seg.dominant,
    })
    t += seg.durationMs
  }

  const warmupCore = o.transitions[0]
  if (warmupCore) {
    segs.push(transitionSegment(warmupCore))
    t = warmupCore.atMs + warmupCore.durMs
  }

  o.core.forEach((unit, ui) => {
    for (const stage of unit.stages) {
      segs.push({
        startMs: t,
        endMs: t + stage.durationMs,
        phase: 'core',
        name: `${unit.index + 1} 单元·${STAGE_LABEL[stage.name]}`,
        activity: stage.activity,
        dominant: stage.dominant,
        directionHint: stage.directionHint,
      })
      t += stage.durationMs
    }
    if (ui < o.core.length - 1) {
      const gap = o.transitions[ui + 1]
      if (gap) {
        segs.push(transitionSegment(gap))
        t = gap.atMs + gap.durMs
      }
    }
  })

  const coreSprint = o.transitions[o.core.length]
  if (coreSprint) {
    segs.push(transitionSegment(coreSprint))
    t = coreSprint.atMs + coreSprint.durMs
  }

  for (const step of o.sprint.substeps) {
    segs.push({
      startMs: t,
      endMs: t + step.durationMs,
      phase: 'sprint' as PlayPhase,
      name: SPRINT_LABEL[step.sub],
      activity: step.activity,
      dominant: step.dominant,
      sub: step.sub,
    })
    t += step.durationMs
  }

  const sprintLanding = o.transitions[o.core.length + 1]
  if (sprintLanding) {
    segs.push(transitionSegment(sprintLanding))
    t = sprintLanding.atMs + sprintLanding.durMs
  }

  segs.push({
    startMs: t,
    endMs: t + o.landing.durationMs,
    phase: 'landing',
    name: '静默着陆',
    activity: 'bilateral',
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
      activity: 'bilateral',
      dominant: 'L',
    }
  }
  return segs[0]
}