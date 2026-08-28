// 当前编排的内存单例：首页生成后传入播放页
import type { Orchestration, Settings } from '../domain/types'

export interface CurrentSession {
  orchestration: Orchestration
  settings: Settings
  seed: number
  totalSec: number
}

let current: CurrentSession | null = null

export function setCurrentSession(session: CurrentSession): void {
  current = session
}

export function getCurrentSession(): CurrentSession | null {
  return current
}

export function clearCurrentSession(): void {
  current = null
}