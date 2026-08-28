import { describe, expect, it } from 'vitest'
import { generateOrchestration } from '../domain/engine'
import { defaultSettings } from '../domain/types'
import { buildTimeline } from './timeline'
import { buildSegments } from '../session/segments'

describe('音频时间线', () => {
  it('事件覆盖完整会话且不超出总时长+着陆', () => {
    const r = generateOrchestration(900, defaultSettings(), 1)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const o = r.orchestration
    const events = buildTimeline(o, defaultSettings())
    expect(events.length).toBeGreaterThan(0)
    const maxEnd = o.totalMs + o.landing.durationMs
    for (const ev of events) {
      expect(ev.timeMs).toBeGreaterThanOrEqual(0)
      expect(ev.timeMs).toBeLessThanOrEqual(maxEnd + 2000)
    }
    // 至少包含节拍与 cue
    expect(events.some((e) => e.kind === 'beat')).toBe(true)
    expect(events.some((e) => e.kind === 'cue')).toBe(true)
    // 着陆心跳仍在时间线内（heartbeat timbre）
    expect(events.some((e) => e.timbre === 'heartbeat')).toBe(true)
  })

  it('波峰段同时包含左右声道事件', () => {
    const r = generateOrchestration(900, defaultSettings(), 2)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const o = r.orchestration
    const events = buildTimeline(o, defaultSettings())
    const peakSeg = buildSegments(o).find((s) => s.sub === 'peak')
    expect(peakSeg).toBeDefined()
    if (!peakSeg) return
    const peakEvents = events.filter((e) => e.timeMs >= peakSeg.startMs && e.timeMs < peakSeg.endMs)
    expect(peakEvents.some((e) => e.side === 'L')).toBe(true)
    expect(peakEvents.some((e) => e.side === 'R')).toBe(true)
  })
})