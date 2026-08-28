// 预渲染 AudioBuffer 播放器：用于短会话息屏/锁屏的稳定播放路径（hybrid 方案 B 路径）
export class BufferPlayer {
  private ctx: AudioContext
  private buffer: AudioBuffer | null = null
  private source: AudioBufferSourceNode | null = null
  private startCtxTime = 0
  private offsetMs = 0
  private running = false
  private disposed = false

  constructor(ctx: AudioContext) {
    this.ctx = ctx
  }

  setBuffer(buffer: AudioBuffer): void {
    this.stopSource()
    this.buffer = buffer
    this.offsetMs = 0
    this.running = false
  }

  async play(): Promise<void> {
    if (!this.buffer || this.disposed) return
    if (this.ctx.state === 'suspended') await this.ctx.resume()
    this.startSource(this.offsetMs)
  }

  pause(): void {
    if (!this.running) return
    this.offsetMs = this.getElapsedMs()
    this.stopSource()
    this.running = false
  }

  resume(): void {
    if (this.running || !this.buffer || this.disposed) return
    void this.play()
  }

  seek(ms: number): void {
    if (!this.buffer) return
    const max = this.buffer.duration * 1000
    this.offsetMs = Math.min(max, Math.max(0, ms))
    if (this.running) {
      this.startSource(this.offsetMs)
    }
  }

  getElapsedMs(): number {
    if (!this.running) return this.offsetMs
    return this.offsetMs + (this.ctx.currentTime - this.startCtxTime) * 1000
  }

  isRunning(): boolean {
    return this.running
  }

  dispose(): void {
    this.disposed = true
    this.stopSource()
    this.buffer = null
  }

  private startSource(offsetMs: number): void {
    if (!this.buffer || this.disposed) return
    this.stopSource()
    const src = this.ctx.createBufferSource()
    src.buffer = this.buffer
    src.connect(this.ctx.destination)
    const offsetSec = Math.min(offsetMs / 1000, Math.max(0, this.buffer.duration - 0.001))
    src.start(0, offsetSec)
    this.source = src
    this.startCtxTime = this.ctx.currentTime
    this.offsetMs = offsetSec * 1000
    this.running = true
    src.onended = () => {
      if (this.source === src) {
        this.running = false
        this.offsetMs = this.buffer?.duration ? this.buffer.duration * 1000 : this.offsetMs
      }
    }
  }

  private stopSource(): void {
    if (this.source) {
      try {
        this.source.onended = null
        this.source.stop()
      } catch {
        // ignore
      }
      this.source.disconnect()
      this.source = null
    }
  }
}