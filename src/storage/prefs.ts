// 偏好存储：localStorage（PRD §4.10）
import { defaultSettings, Settings } from '../domain/types'

const KEY = 'speed.prefs.v1'

export function loadPrefs(): Settings {
  const base = defaultSettings()
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return base
    const parsed = JSON.parse(raw) as Partial<Settings>
    return {
      ...base,
      ...parsed,
      speeds: {
        slow: { ...base.speeds.slow, ...(parsed.speeds?.slow ?? {}) },
        medium: { ...base.speeds.medium, ...(parsed.speeds?.medium ?? {}) },
        fast: { ...base.speeds.fast, ...(parsed.speeds?.fast ?? {}) },
        extreme: { ...base.speeds.extreme, ...(parsed.speeds?.extreme ?? {}) },
      },
      haptics: { ...base.haptics, ...(parsed.haptics ?? {}) },
    }
  } catch {
    return base
  }
}

export function savePrefs(settings: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings))
  } catch {
    // 忽略隐私模式写入失败
  }
}

export function clearPrefs(): void {
  try {
    localStorage.removeItem(KEY)
  } catch {
    // ignore
  }
}