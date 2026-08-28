// 播放进度：sessionStorage（PRD §3.2 / §4.6）
import type { Settings } from '../domain/types'

const KEY = 'speed.session.v1'
export const RESUME_WINDOW_MS = 2 * 60 * 60 * 1000

export interface SessionProgress {
  seed: number
  totalSec: number
  settings: Settings
  elapsedMs: number
  savedAt: number
}

export function saveProgress(p: SessionProgress): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(p))
  } catch {
    // ignore
  }
}

/** 读取未完成进度；超过 2 小时视为过期自动清除 */
export function loadProgress(): SessionProgress | null {
  try {
    const raw = sessionStorage.getItem(KEY)
    if (!raw) return null
    const p = JSON.parse(raw) as SessionProgress
    if (!p || typeof p.seed !== 'number' || typeof p.elapsedMs !== 'number') return null
    if (Date.now() - p.savedAt > RESUME_WINDOW_MS) {
      sessionStorage.removeItem(KEY)
      return null
    }
    return p
  } catch {
    return null
  }
}

export function clearProgress(): void {
  try {
    sessionStorage.removeItem(KEY)
  } catch {
    // ignore
  }
}