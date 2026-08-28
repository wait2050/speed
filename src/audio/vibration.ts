// 振动脉冲控制器：《制作方案》§5.6
import type { Timbre } from '../domain/types'
import type { AudioEvent } from './timeline'

export interface Haptics {
  enabled: boolean
  intensity: 'weak' | 'standard' | 'strong'
}

const PATTERN_BY_TIMBRE: Record<Timbre, number[]> = {
  waterdrop: [15],
  fingertip: [30],
  heartbeat: [40, 30, 40],
  bassdrum: [40, 30, 40],
  woodfish: [20, 20],
  classic: [40],
}

const PATTERN_BY_CUE: Record<string, number[]> = {
  ding: [60],
  'ding-ding': [60, 60, 60],
  handoff: [40, 40, 40],
  'approach-seduce-end': [25],
  'approach-release': [35],
  'approach-cooldown': [20],
}

const INTENSITY_MULTIPLIER: Record<Haptics['intensity'], number> = {
  weak: 0.5,
  standard: 1,
  strong: 1.5,
}

function supportVibration(): boolean {
  return typeof navigator !== 'undefined' && 'vibrate' in navigator
}

export class VibrationController {
  private events: AudioEvent[] = []
  private nextIdx = 0
  private lastVibrateAt = 0
  private enabled: boolean
  private intensity: Haptics['intensity']

  constructor(haptics: Haptics = { enabled: true, intensity: 'standard' }) {
    this.enabled = haptics.enabled && supportVibration()
    this.intensity = haptics.intensity
  }

  setTimeline(events: AudioEvent[]): void {
    this.events = [...events].sort((a, b) => a.timeMs - b.timeMs)
    this.nextIdx = 0
  }

  setHaptics(haptics: Haptics): void {
    this.enabled = haptics.enabled && supportVibration()
    this.intensity = haptics.intensity
  }

  seek(elapsedMs: number): void {
    this.nextIdx = this.events.findIndex((e) => e.timeMs >= elapsedMs)
    if (this.nextIdx < 0) this.nextIdx = this.events.length
  }

  /** 由外部定时驱动（Player 每 100ms 调用） */
  poll(elapsedMs: number): void {
    if (!this.enabled) return
    const now = Date.now()
    while (this.nextIdx < this.events.length) {
      const ev = this.events[this.nextIdx]
      if (ev.timeMs > elapsedMs) break
      if (now - this.lastVibrateAt >= 90) {
        const pattern = ev.kind === 'cue'
          ? (PATTERN_BY_CUE[ev.cueType || ''] || [40])
          : (PATTERN_BY_TIMBRE[ev.timbre] || [30])
        const scaled = pattern.map((ms) => Math.round(ms * INTENSITY_MULTIPLIER[this.intensity]))
        try {
          navigator.vibrate?.(scaled)
        } catch {
          // ignore
        }
        this.lastVibrateAt = now
      }
      this.nextIdx++
    }
  }
}

export function isVibrationSupported(): boolean {
  return supportVibration()
}