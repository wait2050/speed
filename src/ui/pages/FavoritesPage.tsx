import { useCallback, useEffect, useState } from 'react'
import { deleteFavorite, getFavorites, type FavoriteEntry } from '../../storage/db'
import { setCurrentSession } from '../../session/currentSession'
import { navigate } from '../../App'

export default function FavoritesPage() {
  const [items, setItems] = useState<FavoriteEntry[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    setItems(await getFavorites())
    setLoading(false)
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const replay = (entry: FavoriteEntry) => {
    setCurrentSession({
      orchestration: entry.orchestration,
      settings: entry.settings,
      seed: entry.orchestration.seed,
      totalSec: entry.orchestration.totalSec,
    })
    navigate('player')
  }

  const remove = async (id: string) => {
    await deleteFavorite(id)
    await refresh()
  }

  return (
    <div className="page">
      <h1>收藏</h1>
      {loading && <div className="card">加载中…</div>}
      {!loading && items.length === 0 && (
        <div className="card"><p>暂无收藏。完成一次编排后可收藏。</p></div>
      )}
      {items.map((item) => (
        <div className="card list-card" key={item.id}>
          <div className="list-main">
            <div className="list-title">{item.name}</div>
            <div className="list-sub">
              {Math.round(item.orchestration.totalSec / 60)} 分钟 · {item.orchestration.stats.coreUnits} 单元
            </div>
          </div>
          <div className="list-actions">
            <button className="btn secondary small" onClick={() => replay(item)}>再播</button>
            <button className="btn ghost small" onClick={() => void remove(item.id)}>删除</button>
          </div>
        </div>
      ))}
    </div>
  )
}