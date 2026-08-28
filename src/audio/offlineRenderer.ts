// 短会话预渲染器：把时间线一次性渲染为 AudioBuffer（hybrid 息屏方案）
import type { AudioEvent } from './timeline'
import { getTimbreBuffer, playTimbre } from './timbres'

export function isOfflineRenderSupported(): boolean {
  return typeof OfflineAudioContext !== 'undefined'
}

export async function renderTimelineToBuffer(
  events: AudioEvent[],
  durationMs: number,
  sampleRate = 16000,
): Promise<AudioBuffer> {
  const length = Math.max(1, Math.ceil((durationMs / 1000) * sampleRate))
  const ctx = new OfflineAudioContext(2, length, sampleRate)

  const merger = ctx.createChannelMerger(2)
  const leftGain = ctx.createGain()
  const rightGain = ctx.createGain()
  const centerGain = ctx.createGain()
  leftGain.connect(merger, 0, 0)
  rightGain.connect(merger, 0, 1)
  centerGain.connect(leftGain)
  centerGain.connect(rightGain)
  merger.connect(ctx.destination)

  const endSec = durationMs / 1000
  for (const ev of events) {
    const when = ev.timeMs / 1000
    if (when >= endSec) continue
    if (ev.kind === 'cue') {
      if (
        ev.cueType === 'silence' ||
        ev.cueType === 'heartbeat-shift' ||
        ev.cueType === 'voice' ||
        ev.cueType === 'rest-start' ||
        ev.cueType === 'rest-before-end'
      ) continue
      const timbre = ev.cueType === 'handoff' ? 'classic' : ev.timbre || 'classic'
      playTimbre(ctx, centerGain, timbre, when, ev.cueType === 'handoff' ? 0.35 : ev.gain ?? 0.5)
      if (ev.cueType === 'ding-ding') playTimbre(ctx, centerGain, timbre, when + 0.18, ev.gain ?? 0.5)
      continue
    }

    const buffer = getTimbreBuffer(ctx, ev.timbre)
    const src = ctx.createBufferSource()
    src.buffer = buffer
    const gain = ctx.createGain()
    gain.gain.setValueAtTime(ev.gain ?? 0.7, when)
    src.connect(gain)
    if (ev.side === 'L') gain.connect(leftGain)
    else if (ev.side === 'R') gain.connect(rightGain)
    else gain.connect(centerGain)
    src.start(when)
  }

  return ctx.startRendering()
}