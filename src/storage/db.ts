// IndexedDB：历史 / 收藏（PRD §4.10，纯本地）
import type { Orchestration, Settings } from '../domain/types'

const DB_NAME = 'speed-db'
const DB_VERSION = 1

export interface HistoryEntry {
  id: string
  seed: number
  totalSec: number
  unitCount: number
  rating?: number
  createdAt: number
  orchestration: Orchestration
  settings: Settings
}

export interface FavoriteEntry {
  id: string
  name: string
  createdAt: number
  orchestration: Orchestration
  settings: Settings
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains('history')) {
        const store = db.createObjectStore('history', { keyPath: 'id' })
        store.createIndex('createdAt', 'createdAt')
      }
      if (!db.objectStoreNames.contains('favorites')) {
        const store = db.createObjectStore('favorites', { keyPath: 'id' })
        store.createIndex('createdAt', 'createdAt')
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function openRequest<T>(
  storeName: string,
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T> | void,
): Promise<T | undefined> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode)
    const store = tx.objectStore(storeName)
    let result: T | undefined
    try {
      const req = fn(store)
      if (req) {
        req.onsuccess = () => {
          result = req.result
        }
      }
    } catch (err) {
      reject(err)
    }
    tx.oncomplete = () => {
      db.close()
      resolve(result)
    }
    tx.onerror = () => {
      db.close()
      reject(tx.error)
    }
  })
}

export async function addHistory(entry: HistoryEntry): Promise<void> {
  await openRequest('history', 'readwrite', (store) => store.put(entry))
  await trimHistory(20)
}

export async function updateHistory(id: string, patch: Partial<HistoryEntry>): Promise<void> {
  await openRequest('history', 'readwrite', (store) => {
    const get = store.get(id)
    get.onsuccess = () => {
      const existing = get.result as HistoryEntry | undefined
      if (existing) store.put({ ...existing, ...patch })
    }
  })
}

export async function getHistory(): Promise<HistoryEntry[]> {
  const all = await openRequest<HistoryEntry[]>('history', 'readonly', (store) => {
    const req = store.getAll()
    req.onsuccess = () => {
      ;(req as IDBRequest<HistoryEntry[]>).result.sort((a, b) => b.createdAt - a.createdAt)
    }
    return req
  })
  return all ?? []
}

export async function deleteHistory(id: string): Promise<void> {
  await openRequest('history', 'readwrite', (store) => store.delete(id))
}

export async function clearHistory(): Promise<void> {
  await openRequest('history', 'readwrite', (store) => store.clear())
}

async function trimHistory(keep: number): Promise<void> {
  const entries = await getHistory()
  if (entries.length <= keep) return
  const remove = entries.slice(keep)
  for (const e of remove) await deleteHistory(e.id)
}

export async function addFavorite(entry: FavoriteEntry): Promise<void> {
  await openRequest('favorites', 'readwrite', (store) => store.put(entry))
}

export async function getFavorites(): Promise<FavoriteEntry[]> {
  const all = await openRequest<FavoriteEntry[]>('favorites', 'readonly', (store) => {
    const req = store.getAll()
    req.onsuccess = () => {
      ;(req as IDBRequest<FavoriteEntry[]>).result.sort((a, b) => b.createdAt - a.createdAt)
    }
    return req
  })
  return all ?? []
}

export async function deleteFavorite(id: string): Promise<void> {
  await openRequest('favorites', 'readwrite', (store) => store.delete(id))
}

export async function clearFavorites(): Promise<void> {
  await openRequest('favorites', 'readwrite', (store) => store.clear())
}

export async function clearAllData(): Promise<void> {
  await clearHistory()
  await clearFavorites()
  try {
    localStorage.clear()
  } catch {
    // ignore
  }
  try {
    sessionStorage.clear()
  } catch {
    // ignore
  }
}