import { useCallback, useEffect, useState } from 'react'
import { deleteHistory, getHistory, type HistoryEntry } from '../../storage/db'
import { setCurrentSession } from '../../session/currentSession'
import { navigate } from '../../App'

function formatTime(ts: number): string {
  const d = new Date(ts)
  return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${d.getMinutes().toString().padStart(2, '0')}`
}

export default function HistoryPage() {
  const [items, setItems] = useState<HistoryEntry[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    setItems(await getHistory())
    setLoading(false)
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const replay = (entry: HistoryEntry) => {
    setCurrentSession({
      orchestration: entry.orchestration,
      settings: entry.settings,
      seed: entry.seed,
      totalSec: entry.totalSec,
    })
    navigate('player')
  }

  const remove = async (id: string) => {
    await deleteHistory(id)
    await refresh()
  }

  return (
    <div className="page">
      <h1>历史</h1>
      {loading && <div className="card">加载中…</div>}
      {!loading && items.length === 0 && (
        <div className="card"><p>暂无历史记录。</p></div>
      )}
      {items.map((item) => (
        <div className="card list-card" key={item.id}>
          <div className="list-main">
            <div className="list-title">
              {Math.round(item.totalSec / 60)} 分钟 · {item.unitCount} 单元
            </div>
            <div className="list-sub">
              {formatTime(item.createdAt)} {item.rating ? `· 评分 ${item.rating}/5` : ''}
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