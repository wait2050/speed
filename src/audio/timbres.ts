// 6 种合成音色（Web Audio 实时合成，零音频资产）
import type { Timbre } from '../domain/types'

const cache = new Map<Timbre, AudioBuffer>()

function makeBuffer(ctx: BaseAudioContext, durationSec: number, draw: (t: number, d: Float32Array) => void): AudioBuffer {
  const len = Math.max(1, Math.floor(ctx.sampleRate * durationSec))
  const buffer = ctx.createBuffer(1, len, ctx.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < len; i++) draw(i / ctx.sampleRate, data)
  return buffer
}

function env(t: number, attack: number, decay: number): number {
  if (t < 0) return 0
  const a = attack <= 0 ? 1 : Math.min(1, t / attack)
  const d = Math.exp(-Math.max(0, t - attack) / decay)
  return a * d
}

export function getTimbreBuffer(ctx: BaseAudioContext, timbre: Timbre): AudioBuffer {
  const cached = cache.get(timbre)
  if (cached && cached.sampleRate === ctx.sampleRate) return cached

  const buffer = synthTimbre(ctx, timbre)
  cache.set(timbre, buffer)
  return buffer
}

export function synthTimbre(ctx: BaseAudioContext, timbre: Timbre): AudioBuffer {
  switch (timbre) {
    case 'classic':
      return makeBuffer(ctx, 0.2, (t, d) => {
        if (t < 0.001) return
        d[Math.floor(t * ctx.sampleRate)] = Math.sin(2 * Math.PI * 880 * t) * env(t, 0.002, 0.035)
      })
    case 'woodfish':
      return makeBuffer(ctx, 0.35, (t, d) => {
        const i = Math.floor(t * ctx.sampleRate)
        d[i] = (Math.sin(2 * Math.PI * 720 * t) + 0.6 * Math.sin(2 * Math.PI * 1450 * t)) * env(t, 0.003, 0.08)
      })
    case 'heartbeat':
      return makeBuffer(ctx, 0.6, (t, d) => {
        const i = Math.floor(t * ctx.sampleRate)
        // 双拍：咚-咚
        const first = t >= 0 && t < 0.22
        const second = t >= 0.28 && t < 0.5
        const beatPhase = first ? t : second ? t - 0.28 : 1
        const f = 55 + 20 * Math.exp(-beatPhase * 12)
        const amp = env(beatPhase, 0.004, 0.09)
        d[i] = (Math.sin(2 * Math.PI * f * beatPhase) + 0.4 * Math.sin(2 * Math.PI * f * 2 * beatPhase)) * amp
      })
    case 'waterdrop':
      return makeBuffer(ctx, 0.18, (t, d) => {
        const i = Math.floor(t * ctx.sampleRate)
        const f = 520 + 420 * Math.min(1, t / 0.06)
        d[i] = Math.sin(2 * Math.PI * f * t) * env(t, 0.004, 0.045)
      })
    case 'fingertip':
      return makeBuffer(ctx, 0.08, (t, d) => {
        const i = Math.floor(t * ctx.sampleRate)
        const noise = (Math.random() * 2 - 1) * 0.4
        d[i] = (Math.sin(2 * Math.PI * 1900 * t) * 0.7 + noise) * env(t, 0.001, 0.018)
      })
    case 'bassdrum':
      return makeBuffer(ctx, 0.4, (t, d) => {
        const i = Math.floor(t * ctx.sampleRate)
        const f = 110 * Math.exp(-t * 8)
        const click = t < 0.008 ? Math.sin(2 * Math.PI * 2600 * t) * (1 - t / 0.008) * 0.6 : 0
        d[i] = Math.sin(2 * Math.PI * f * t) * env(t, 0.002, 0.14) + click
      })
    default:
      return makeBuffer(ctx, 0.1, (t, d) => {
        const i = Math.floor(t * ctx.sampleRate)
        d[i] = Math.sin(2 * Math.PI * 440 * t) * env(t, 0.002, 0.03)
      })
  }
}

/** 工厂：创建可复用的节拍源播放函数 */
export function playTimbre(
  ctx: BaseAudioContext,
  destination: AudioNode,
  timbre: Timbre,
  when: number,
  gain = 1,
): void {
  const buffer = getTimbreBuffer(ctx, timbre)
  const src = ctx.createBufferSource()
  src.buffer = buffer
  const g = ctx.createGain()
  g.gain.setValueAtTime(gain, when)
  src.connect(g)
  g.connect(destination)
  src.start(when)
}