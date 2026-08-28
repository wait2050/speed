import { describe, expect, it } from 'vitest'
import { generateOrchestration } from '../domain/engine'
import { defaultSettings } from '../domain/types'
import { buildSegments } from './segments'

describe('播放分段', () => {
  it('分段连续覆盖 0..总时长+着陆，无重叠无缺口', () => {
    const r = generateOrchestration(900, defaultSettings(), 5)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const o = r.orchestration
    const segs = buildSegments(o)
    expect(segs.length).toBeGreaterThan(0)
    expect(segs[0].startMs).toBe(0)
    let cursor = 0
    for (const seg of segs) {
      expect(seg.startMs).toBe(cursor)
      expect(seg.endMs).toBeGreaterThan(cursor)
      cursor = seg.endMs
    }
    expect(cursor).toBe(o.totalMs + o.landing.durationMs)
  })
})