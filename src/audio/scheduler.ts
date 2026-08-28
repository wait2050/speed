// Web Audio lookahead 调度器：支持双侧声道分离、阶段 cue、进度查询/seek/暂停
import { getTimbreBuffer, playTimbre } from './timbres'
import type { AudioEvent } from './timeline'

const LOOKAHEAD_SEC = 8
const TICK_MS = 25

export class AudioScheduler {
  private ctx: AudioContext
  private events: AudioEvent[] = []
  private cursor = 0
  private startCtxTime = 0
  private timer: number | null = null
  private paused = false
  private disposed = false
  private onVoice?: (prompt: string, whenSec: number) => void

  private merger: ChannelMergerNode
  private leftGain: GainNode
  private rightGain: GainNode
  private centerGain: GainNode

  constructor(ctx: AudioContext, onVoice?: (prompt: string, whenSec: number) => void) {
    this.ctx = ctx
    this.onVoice = onVoice
    this.merger = ctx.createChannelMerger(2)
    this.leftGain = ctx.createGain()
    this.rightGain = ctx.createGain()
    this.centerGain = ctx.createGain()
    this.leftGain.connect(this.merger, 0, 0)
    this.rightGain.connect(this.merger, 0, 1)
    this.centerGain.connect(this.leftGain)
    this.centerGain.connect(this.rightGain)
    this.merger.connect(ctx.destination)
  }

  setTimeline(events: AudioEvent[]): void {
    this.events = [...events].sort((a, b) => a.timeMs - b.timeMs)
    this.cursor = 0
  }

  async start(): Promise<void> {
    if (this.disposed) return
    if (this.ctx.state === 'suspended') await this.ctx.resume()
    this.paused = false
    if (!this.startCtxTime) this.startCtxTime = this.ctx.currentTime + 0.06
    this.tick()
    this.ensureTimer()
  }

  async pause(): Promise<void> {
    if (this.paused) return
    this.paused = true
    this.clearTimer()
    if (this.ctx.state === 'running') await this.ctx.suspend()
  }

  async resume(): Promise<void> {
    if (!this.paused) return
    this.paused = false
    if (this.ctx.state === 'suspended') await this.ctx.resume()
    this.ensureTimer()
    this.tick()
  }

  seek(elapsedMs: number): void {
    // 从指定进度重建调度：跳过已过事件，调整起点使 elapsed 对齐当前 ctx 时间
    this.cursor = this.events.findIndex((e) => e.timeMs >= elapsedMs)
    if (this.cursor < 0) this.cursor = this.events.length
    this.startCtxTime = this.ctx.currentTime - elapsedMs / 1000
    this.tick()
  }

  getElapsedMs(): number {
    if (!this.startCtxTime) return 0
    return Math.max(0, Math.floor((this.ctx.currentTime - this.startCtxTime) * 1000))
  }

  isPaused(): boolean {
    return this.paused
  }

  getEventCount(): number {
    return this.events.length
  }

  dispose(): void {
    this.disposed = true
    this.clearTimer()
    try {
      this.merger.disconnect()
      this.leftGain.disconnect()
      this.rightGain.disconnect()
      this.centerGain.disconnect()
    } catch {
      // ignore
    }
  }

  private ensureTimer(): void {
    if (this.timer !== null || this.paused || this.disposed) return
    this.timer = window.setInterval(() => this.tick(), TICK_MS)
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  private tick(): void {
    if (this.paused || this.disposed) return
    const now = this.ctx.currentTime
    const target = now + LOOKAHEAD_SEC
    while (this.cursor < this.events.length) {
      const ev = this.events[this.cursor]
      const when = this.startCtxTime + ev.timeMs / 1000
      if (when > target) break
      this.scheduleEvent(ev, when)
      this.cursor++
      if (this.disposed) return
    }
    this.ensureTimer()
  }

  private scheduleEvent(ev: AudioEvent, when: number): void {
    const ctx = this.ctx
    if (ev.kind === 'cue') {
      this.scheduleCue(ev, when)
      return
    }

    const buffer = getTimbreBuffer(ctx, ev.timbre)
    const src = ctx.createBufferSource()
    src.buffer = buffer
    const gain = ctx.createGain()
    gain.gain.setValueAtTime(ev.gain ?? 0.7, when)
    src.connect(gain)

    if (ev.side === 'L') gain.connect(this.leftGain)
    else if (ev.side === 'R') gain.connect(this.rightGain)
    else gain.connect(this.centerGain)

    src.start(when)
    src.stop(when + Math.max(0.2, buffer.duration + 0.05))
  }

  private scheduleCue(ev: AudioEvent, when: number): void {
    if (ev.cueType === 'silence' || ev.cueType === 'heartbeat-shift' || ev.cueType === 'rest-start') return
    if (ev.cueType === 'voice') {
      if (ev.voicePrompt && this.onVoice) {
        this.onVoice(ev.voicePrompt, when)
      }
      return
    }
    const type = ev.cueType
    const timbre = type === 'handoff' || type === 'rest-before-end' ? 'classic' : ev.timbre || 'classic'
    const gain = type === 'handoff' || type === 'rest-before-end' ? 0.35 : ev.gain ?? 0.5
    playTimbre(this.ctx, this.centerGain, timbre, when, gain)
    if (type === 'ding-ding') {
      playTimbre(this.ctx, this.centerGain, timbre, when + 0.18, gain)
    }
  }
}