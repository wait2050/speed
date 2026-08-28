// 播放器会话 Hook（PRD v3）：亮屏常亮 + 后台自动暂停 + 扣屏渐隐 + 语音播报 + 进度存档
import { useCallback, useEffect, useRef, useState } from 'react'
import { AudioScheduler } from '../audio/scheduler'
import { VibrationController } from '../audio/vibration'
import { VoiceController } from '../audio/voice'
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

export function usePlayer() {
  const [active, setActive] = useState<ActiveSession | null>(() => getCurrentSession())
  const [pendingResume, setPendingResume] = useState<SessionProgress | null>(() =>
    getCurrentSession() ? null : loadProgress(),
  )
  const [status, setStatus] = useState<PlayerStatus>(() =>
    getCurrentSession() ? 'idle' : loadProgress() ? 'resume-offer' : 'idle',
  )
  const [elapsedMs, setElapsedMs] = useState(0)
  const [faceDown, setFaceDown] = useState(false)

  const ctxRef = useRef<AudioContext | null>(null)
  const playerRef = useRef<AudioScheduler | null>(null)
  const vibratorRef = useRef<VibrationController | null>(null)
  const voiceRef = useRef<VoiceController | null>(null)
  const wakeLockRef = useRef<WakeLockSentinel | null>(null)
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

  const requestWakeLock = useCallback(async () => {
    const act = activeRef.current
    if (!act?.settings.wakeLock) return
    try {
      if ('wakeLock' in navigator && document.visibilityState === 'visible' && !wakeLockRef.current) {
        wakeLockRef.current = await navigator.wakeLock.request('screen')
      }
    } catch {
      // 忽略不支持/拒绝
    }
  }, [])

  const releaseWakeLock = useCallback(() => {
    wakeLockRef.current?.release().catch(() => undefined)
    wakeLockRef.current = null
  }, [])

  const initPlayback = useCallback(
    async (o: Orchestration, settings: Settings, seed: number, totalSec: number, seekMs: number) => {
      if (disposedRef.current) return
      const ctx = await ensureContext()

      if (playerRef.current) {
        playerRef.current.dispose()
        playerRef.current = null
      }
      voiceRef.current?.dispose()
      voiceRef.current = new VoiceController()

      const timeline = buildTimeline(o, settings)
      const sched = new AudioScheduler(ctx, (prompt, whenSec) => {
        voiceRef.current?.schedule(prompt, whenSec, ctx)
      })
      sched.setTimeline(timeline)
      if (seekMs > 0) sched.seek(seekMs)
      else await sched.start()
      playerRef.current = sched

      const vib = vibratorRef.current ?? new VibrationController(settings.haptics)
      vib.setHaptics(settings.haptics)
      vib.setTimeline(timeline)
      vib.seek(seekMs)
      vibratorRef.current = vib

      setElapsedMs(seekMs)
      setActive({ orchestration: o, settings, seed, totalSec })
      setStatus('playing')
      void requestWakeLock()
      startPolling()
    },
    [ensureContext, requestWakeLock, startPolling],
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
        releaseWakeLock()
      } else if (statusRef.current === 'paused') {
        await player.resume()
        setStatus('playing')
        void requestWakeLock()
      }
    } catch (err) {
      console.error(err)
    }
  }, [releaseWakeLock, requestWakeLock])

  const finishEarly = useCallback(() => {
    clearProgress()
    stopPolling()
    setStatus('finished')
    releaseWakeLock()
    playerRef.current?.dispose()
    playerRef.current = null
    voiceRef.current?.dispose()
    voiceRef.current = null
  }, [releaseWakeLock, stopPolling])

  // 扣屏暂停 / 翻转继续 + 渐隐全黑（可设置关闭）
  useEffect(() => {
    if (!('DeviceOrientationEvent' in window)) return
    let lastAction = 0
    const onOrientation = (ev: DeviceOrientationEvent) => {
      if (disposedRef.current) return
      const act = activeRef.current
      if (!act?.settings.faceDownPause) return
      const now = Date.now()
      if (now - lastAction < 1200) return
      const gamma = ev.gamma ?? 0
      const down = Math.abs(gamma) > 60
      const up = Math.abs(gamma) < 20
      if (down) {
        setFaceDown(true)
        if (statusRef.current === 'playing' || statusRef.current === 'landing') {
          lastAction = now
          void togglePause()
        }
      } else if (up) {
        setFaceDown(false)
        if (statusRef.current === 'paused') {
          lastAction = now
          void togglePause()
        }
      }
    }
    window.addEventListener('deviceorientation', onOrientation)
    return () => {
      window.removeEventListener('deviceorientation', onOrientation)
      setFaceDown(false)
    }
  }, [togglePause])

  // 切后台/锁屏自动暂停
  useEffect(() => {
    const onVis = () => {
      if (document.hidden && (statusRef.current === 'playing' || statusRef.current === 'landing')) {
        void togglePause()
      }
    }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [togglePause])

  // 卸载时保存进度并释放
  useEffect(() => {
    return () => {
      disposedRef.current = true
      stopPolling()
      releaseWakeLock()
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
      voiceRef.current?.dispose()
      voiceRef.current = null
      ctxRef.current?.close().catch(() => undefined)
      ctxRef.current = null
    }
  }, [releaseWakeLock, stopPolling])

  const segment = active ? getSegmentAt(active.orchestration, elapsedMs) : null

  return {
    active,
    status,
    pendingResume,
    elapsedMs,
    segment,
    faceDown,
    start,
    resume,
    abandon,
    togglePause,
    finishEarly,
  }
}