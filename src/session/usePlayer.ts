// 播放器会话 Hook：驱动音频引擎（AudioScheduler / BufferPlayer）+ 振动脉冲 + 进度存档
import { useCallback, useEffect, useRef, useState } from 'react'
import { AudioScheduler } from '../audio/scheduler'
import { BufferPlayer } from '../audio/bufferPlayer'
import { isOfflineRenderSupported, renderTimelineToBuffer } from '../audio/offlineRenderer'
import { VibrationController } from '../audio/vibration'
import { buildTimeline } from '../audio/timeline'
import { generateOrchestration } from '../domain/engine'
import type { Orchestration, Settings } from '../domain/types'
import { getCurrentSession } from './currentSession'
import { clearProgress, loadProgress, saveProgress, type SessionProgress } from '../storage/sessionProgress'
import { getSegmentAt } from './segments'

export type PlayerStatus =
  | 'idle'
  | 'resume-offer'
  | 'playing'
  | 'paused'
  | 'landing'
  | 'finished'
  | 'error'

interface ActiveSession {
  orchestration: Orchestration
  settings: Settings
  seed: number
  totalSec: number
}

type PlaybackEngine = AudioScheduler | BufferPlayer

/** 短会话阈值：总时长+着陆 ≤ 6 分钟时走预渲染 AudioBuffer（hybrid 息屏路径） */
const SHORT_SESSION_MS = 6 * 60 * 1000

export function usePlayer() {
  const [active, setActive] = useState<ActiveSession | null>(() => getCurrentSession())
  const [pendingResume, setPendingResume] = useState<SessionProgress | null>(() =>
    getCurrentSession() ? null : loadProgress(),
  )
  const [status, setStatus] = useState<PlayerStatus>(() =>
    getCurrentSession() ? 'idle' : loadProgress() ? 'resume-offer' : 'idle',
  )
  const [elapsedMs, setElapsedMs] = useState(0)

  const ctxRef = useRef<AudioContext | null>(null)
  const playerRef = useRef<PlaybackEngine | null>(null)
  const vibratorRef = useRef<VibrationController | null>(null)
  const intervalRef = useRef<number | null>(null)
  const lastSaveRef = useRef(-1)
  const disposedRef = useRef(false)
  const activeRef = useRef<ActiveSession | null>(null)
  const statusRef = useRef<PlayerStatus>(status)
  activeRef.current = active
  statusRef.current = status

  const stopPolling = useCallback(() => {
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }
  }, [])

  const startPolling = useCallback(() => {
    if (intervalRef.current !== null) return
    intervalRef.current = window.setInterval(() => {
      if (disposedRef.current) return
      const player = playerRef.current
      const act = activeRef.current
      if (!player || !act) return
      const e = Math.min(player.getElapsedMs(), act.orchestration.totalMs + act.orchestration.landing.durationMs)
      setElapsedMs(e)
      vibratorRef.current?.poll(e)

      const o = act.orchestration
      if (e >= o.totalMs + o.landing.durationMs) {
        setStatus('finished')
        clearProgress()
        stopPolling()
        return
      }
      if (e >= o.totalMs) {
        if (statusRef.current !== 'landing') setStatus('landing')
      } else if (statusRef.current === 'idle' || statusRef.current === 'resume-offer') {
        setStatus('playing')
      }

      const saveSlot = Math.floor(e / 5000)
      if (saveSlot !== lastSaveRef.current) {
        lastSaveRef.current = saveSlot
        saveProgress({
          seed: act.seed,
          totalSec: act.totalSec,
          settings: act.settings,
          elapsedMs: e,
          savedAt: Date.now(),
        })
      }
    }, 100)
  }, [stopPolling])

  const ensureContext = useCallback(async (): Promise<AudioContext> => {
    if (!ctxRef.current) ctxRef.current = new AudioContext()
    const ctx = ctxRef.current
    if (ctx.state === 'suspended') await ctx.resume()
    return ctx
  }, [])

  const initPlayback = useCallback(
    async (o: Orchestration, settings: Settings, seed: number, totalSec: number, seekMs: number) => {
      if (disposedRef.current) return
      const ctx = await ensureContext()

      // 释放旧引擎
      if (playerRef.current) {
        playerRef.current.dispose()
        playerRef.current = null
      }

      const timeline = buildTimeline(o, settings)
      const durationMs = o.totalMs + o.landing.durationMs
      const useBuffer = isOfflineRenderSupported() && durationMs <= SHORT_SESSION_MS
      let player: PlaybackEngine

      if (useBuffer) {
        // 短会话：预渲染为 AudioBuffer，单缓冲播放，减少后台调度依赖
        const buffer = await renderTimelineToBuffer(timeline, durationMs)
        const bp = new BufferPlayer(ctx)
        bp.setBuffer(buffer)
        bp.seek(seekMs)
        await bp.play()
        player = bp
      } else {
        const sched = new AudioScheduler(ctx)
        sched.setTimeline(timeline)
        if (seekMs > 0) sched.seek(seekMs)
        else await sched.start()
        player = sched
      }

      playerRef.current = player

      const vib = vibratorRef.current ?? new VibrationController(settings.haptics)
      vib.setHaptics(settings.haptics)
      vib.setTimeline(timeline)
      vib.seek(seekMs)
      vibratorRef.current = vib

      setElapsedMs(seekMs)
      setActive({ orchestration: o, settings, seed, totalSec })
      setStatus('playing')
      startPolling()
    },
    [ensureContext, startPolling],
  )

  const start = useCallback(async () => {
    const act = active
    if (!act) return
    try {
      await initPlayback(act.orchestration, act.settings, act.seed, act.totalSec, 0)
    } catch (err) {
      console.error(err)
      setStatus('error')
    }
  }, [active, initPlayback])

  const resume = useCallback(
    async (p: SessionProgress) => {
      try {
        const r = generateOrchestration(p.totalSec, p.settings, p.seed)
        if (!r.ok) {
          setStatus('error')
          return
        }
        setPendingResume(null)
        await initPlayback(r.orchestration, p.settings, p.seed, p.totalSec, p.elapsedMs)
      } catch (err) {
        console.error(err)
        setStatus('error')
      }
    },
    [initPlayback],
  )

  const abandon = useCallback(() => {
    clearProgress()
    setPendingResume(null)
    setStatus('idle')
  }, [])

  const togglePause = useCallback(async () => {
    const player = playerRef.current
    if (!player) return
    try {
      if (statusRef.current === 'playing' || statusRef.current === 'landing') {
        await player.pause()
        setStatus('paused')
      } else if (statusRef.current === 'paused') {
        await player.resume()
        setStatus('playing')
      }
    } catch (err) {
      console.error(err)
    }
  }, [])

  const finishEarly = useCallback(() => {
    clearProgress()
    stopPolling()
    setStatus('finished')
    playerRef.current?.dispose()
    playerRef.current = null
  }, [stopPolling])

  // 扣屏暂停 / 翻转继续（可选，降级为点按大区域）
  useEffect(() => {
    if (!('DeviceOrientationEvent' in window)) return
    let lastAction = 0
    const onOrientation = (ev: DeviceOrientationEvent) => {
      if (disposedRef.current) return
      const now = Date.now()
      if (now - lastAction < 1500) return
      const gamma = ev.gamma ?? 0
      const faceDown = Math.abs(gamma) > 60
      const faceUp = Math.abs(gamma) < 20
      if (faceDown && (statusRef.current === 'playing' || statusRef.current === 'landing')) {
        lastAction = now
        void togglePause()
      } else if (faceUp && statusRef.current === 'paused') {
        lastAction = now
        void togglePause()
      }
    }
    window.addEventListener('deviceorientation', onOrientation)
    return () => window.removeEventListener('deviceorientation', onOrientation)
  }, [togglePause])

  // 卸载时保存进度并释放
  useEffect(() => {
    return () => {
      disposedRef.current = true
      stopPolling()
      const player = playerRef.current
      if (player && statusRef.current !== 'finished') {
        const elapsed = player.getElapsedMs()
        const act = activeRef.current
        if (act && elapsed > 0 && elapsed < act.orchestration.totalMs + act.orchestration.landing.durationMs) {
          saveProgress({
            seed: act.seed,
            totalSec: act.totalSec,
            settings: act.settings,
            elapsedMs: elapsed,
            savedAt: Date.now(),
          })
        }
        player.dispose()
        playerRef.current = null
      }
      ctxRef.current?.close().catch(() => undefined)
      ctxRef.current = null
    }
  }, [stopPolling])

  const segment = active ? getSegmentAt(active.orchestration, elapsedMs) : null

  return {
    active,
    status,
    pendingResume,
    elapsedMs,
    segment,
    start,
    resume,
    abandon,
    togglePause,
    finishEarly,
  }
}