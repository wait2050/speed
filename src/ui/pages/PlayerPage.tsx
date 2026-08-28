import { useEffect, useRef, useState } from 'react'
import { usePlayer } from '../../session/usePlayer'
import { navigate } from '../../App'
import { ACTIVITY_LABEL } from '../../domain/types'
import { addFavorite, addHistory } from '../../storage/db'

const PHASE_LABEL: Record<string, string> = {
  warmup: '热身',
  core: '核心',
  sprint: '冲刺',
  transition: '过渡',
  landing: '静默着陆',
  finished: '已完成',
}

function formatMs(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000))
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

export default function PlayerPage() {
  const player = usePlayer()
  const { status, active, pendingResume, elapsedMs, segment, faceDown } = player
  const [rating, setRating] = useState(0)
  const [favName, setFavName] = useState('')
  const [favSaved, setFavSaved] = useState(false)
  const savedRef = useRef(false)

  // 自然结束后自动落盘历史
  useEffect(() => {
    if (status === 'finished' && active && !savedRef.current) {
      savedRef.current = true
      void addHistory({
        id: `h-${Date.now()}`,
        seed: active.seed,
        totalSec: active.totalSec,
        unitCount: active.orchestration.core.length,
        rating: rating || undefined,
        createdAt: Date.now(),
        orchestration: active.orchestration,
        settings: active.settings,
      })
    }
  }, [status, active, rating])

  const saveFav = async () => {
    if (!active || !favName.trim()) return
    await addFavorite({
      id: `f-${Date.now()}`,
      name: favName.trim(),
      createdAt: Date.now(),
      orchestration: active.orchestration,
      settings: active.settings,
    })
    setFavSaved(true)
  }

  if (!active && status === 'resume-offer' && pendingResume) {
    return (
      <div className="page">
        <h1>继续上次？</h1>
        <div className="card">
          <p>检测到未完成的编排（{formatMs(pendingResume.elapsedMs)} / {formatMs(pendingResume.totalSec * 1000)}）。2 小时内可继续。</p>
          <div className="row">
            <button className="btn" onClick={() => void player.resume(pendingResume)}>继续</button>
            <button className="btn secondary" onClick={player.abandon}>放弃</button>
          </div>
        </div>
      </div>
    )
  }

  if (!active) {
    return (
      <div className="page">
        <h1>播放</h1>
        <div className="card">
          <p>还没有编排，请先到首页生成。</p>
          <button className="btn" onClick={() => navigate('home')}>去编排</button>
        </div>
      </div>
    )
  }

  if (status === 'idle') {
    return (
      <div className="page">
        <h1>准备播放</h1>
        <div className="card">
          <p>{active.orchestration.stats.coreUnits} 个核心单元 · {formatMs(active.orchestration.totalMs)}</p>
          <p className="hint">请佩戴左右声道耳机，本应用只面向立体声耳机播放。</p>
          <button className="btn" onClick={() => void player.start()}>开始</button>
        </div>
      </div>
    )
  }

  if (status === 'error') {
    return (
      <div className="page">
        <h1>出错了</h1>
        <div className="card">
          <p>音频启动失败，请返回重试。</p>
          <button className="btn" onClick={() => navigate('home')}>返回首页</button>
        </div>
      </div>
    )
  }

  if (status === 'finished') {
    return (
      <div className="page">
        <h1>完成</h1>
        <div className="card">
          <p>本场已结束，已自动写入历史。</p>
          <div className="rating-row">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                className={`star ${n <= rating ? 'star-on' : ''}`}
                onClick={() => setRating(n)}
              >
                ★
              </button>
            ))}
          </div>
          <div className="fav-line">
            <input
              type="text"
              placeholder="收藏名称（可选）"
              value={favName}
              onChange={(e) => setFavName(e.target.value)}
            />
            <button className="btn secondary small" disabled={favSaved || !favName.trim()} onClick={() => void saveFav()}>
              {favSaved ? '已收藏' : '收藏'}
            </button>
          </div>
          <div className="row">
            <button className="btn" onClick={() => navigate('home')}>返回首页</button>
            <button className="btn secondary" onClick={() => navigate('history')}>历史</button>
          </div>
        </div>
      </div>
    )
  }

  const isPaused = status === 'paused'
  const isLanding = status === 'landing'
  const totalMs = active.orchestration.totalMs + active.orchestration.landing.durationMs
  const progress = Math.min(1, elapsedMs / totalMs)
  const remaining = Math.max(0, (segment?.endMs ?? elapsedMs) - elapsedMs)
  const activityText = segment ? ACTIVITY_LABEL[segment.activity] : ''
  const directionMark = segment?.directionHint === 'up' ? ' ↗' : segment?.directionHint === 'down' ? ' ↘' : ''
  const stageDisplay = `${segment?.name ?? ''}${directionMark}`

  return (
    <div className={`page player-page${faceDown ? ' face-down' : ''}`}>
      <div className="card player-card">
        <div className="player-top">
          <span className="phase-label">{PHASE_LABEL[segment?.phase ?? ''] ?? ''}</span>
          {isPaused && <span className="pause-badge">已暂停</span>}
          {isLanding && <span className="pause-badge">静默着陆</span>}
        </div>

        <div className="circle-wrap">
          <svg className="circle" viewBox="0 0 120 120">
            <circle cx="60" cy="60" r="52" className="circle-bg" />
            <circle
              cx="60"
              cy="60"
              r="52"
              className="circle-fg"
              strokeDasharray={`${2 * Math.PI * 52}`}
              strokeDashoffset={`${2 * Math.PI * 52 * (1 - progress)}`}
            />
          </svg>
          <div className="circle-text">
            <div className="circle-time mono">{formatMs(remaining)}</div>
            <div className="circle-stage">{stageDisplay}</div>
          </div>
        </div>

        <div className="player-meta">
          <div>活动状态：<b>{activityText}</b></div>
          <div>主导侧：<b className={segment?.dominant === 'L' ? 'side-l' : 'side-r'}>{segment?.dominant === 'L' ? 'L 左' : 'R 右'}</b></div>
          <div>总进度：<span className="mono">{formatMs(elapsedMs)} / {formatMs(totalMs)}</span></div>
        </div>

        <div className="row">
          <button className="btn secondary big-tap" onClick={() => void player.togglePause()}>
            {isPaused ? '继续' : '暂停'}
          </button>
          {!isLanding && (
            <button className="btn ghost big-tap" onClick={player.finishEarly}>结束</button>
          )}
        </div>
        <p className="hint">亮屏常亮播放；锁屏/切后台自动暂停；扣下手机暂停并渐隐全黑，翻转继续</p>
      </div>
    </div>
  )
}