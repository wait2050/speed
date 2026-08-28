import { useState } from 'react'
import { defaultSettings, type Settings, type Timbre } from '../../domain/types'
import { loadPrefs, savePrefs } from '../../storage/prefs'
import { clearAllData } from '../../storage/db'
import { playTimbre } from '../../audio/timbres'

const TIMBRES: { value: Timbre; label: string }[] = [
  { value: 'classic', label: '经典嗒音' },
  { value: 'woodfish', label: '木鱼' },
  { value: 'heartbeat', label: '心跳' },
  { value: 'waterdrop', label: '水滴' },
  { value: 'fingertip', label: '指尖敲击' },
  { value: 'bassdrum', label: '低音鼓点' },
]

const TIERS = [
  { key: 'slow', label: '慢速' },
  { key: 'medium', label: '中速' },
  { key: 'fast', label: '快速' },
  { key: 'extreme', label: '极速' },
] as const

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings>(() => loadPrefs())
  const [confirmClear, setConfirmClear] = useState(false)

  const update = (patch: Partial<Settings>) => {
    const next = { ...settings, ...patch }
    setSettings(next)
    savePrefs(next)
  }

  const updateTier = (tier: keyof Settings['speeds'], patch: Partial<Settings['speeds'][typeof tier]>) => {
    const speeds = {
      ...settings.speeds,
      [tier]: { ...settings.speeds[tier], ...patch },
    }
    update({ speeds })
  }

  const audition = (tier: (typeof TIERS)[number]['key']) => {
    const speed = settings.speeds[tier]
    const ctx = new AudioContext()
    const interval = 60000 / speed.bpm
    for (let i = 0; i < 4; i++) {
      playTimbre(ctx, ctx.destination, speed.timbre, ctx.currentTime + (i * interval) / 1000, 0.6)
    }
    window.setTimeout(() => void ctx.close(), 2000)
  }

  const clearAll = async () => {
    await clearAllData()
    setSettings(defaultSettings())
    setConfirmClear(false)
  }

  return (
    <div className="page">
      <h1>设置</h1>

      <div className="card">
        <h2 className="card-title">速度档位</h2>
        {TIERS.map((tier) => (
          <div className="setting-row" key={tier.key}>
            <span className="setting-label">{tier.label}</span>
            <input
              type="number"
              min={40}
              max={200}
              value={settings.speeds[tier.key].bpm}
              onChange={(e) => updateTier(tier.key, { bpm: Number(e.target.value) })}
            />
            <select
              value={settings.speeds[tier.key].timbre}
              onChange={(e) => updateTier(tier.key, { timbre: e.target.value as Timbre })}
            >
              {TIMBRES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
            <button className="btn ghost small" onClick={() => audition(tier.key)}>试听</button>
          </div>
        ))}
      </div>

      <div className="card">
        <h2 className="card-title">乳晕缓冲</h2>
        <label className="setting-line">
          下限 {settings.areolaMinSec}s
          <input
            type="range"
            min={10}
            max={30}
            value={settings.areolaMinSec}
            onChange={(e) => update({ areolaMinSec: Number(e.target.value) })}
          />
        </label>
        <label className="setting-line">
          上限 {settings.areolaMaxSec}s
          <input
            type="range"
            min={10}
            max={30}
            value={settings.areolaMaxSec}
            onChange={(e) => update({ areolaMaxSec: Number(e.target.value) })}
          />
        </label>
      </div>

      <div className="card">
        <h2 className="card-title">收尾音色</h2>
        <select
          value={settings.endTimbre}
          onChange={(e) => update({ endTimbre: e.target.value as Timbre })}
        >
          {TIMBRES.map((t) => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </select>
      </div>

      <div className="card">
        <h2 className="card-title">振动反馈</h2>
        <label className="setting-line">
          <input
            type="checkbox"
            checked={settings.haptics.enabled}
            onChange={(e) => update({ haptics: { ...settings.haptics, enabled: e.target.checked } })}
          />
          启用振动
        </label>
        <label className="setting-line">
          强度
          <select
            value={settings.haptics.intensity}
            onChange={(e) =>
              update({
                haptics: { ...settings.haptics, intensity: e.target.value as Settings['haptics']['intensity'] },
              })
            }
          >
            <option value="weak">弱</option>
            <option value="standard">标准</option>
            <option value="strong">强</option>
          </select>
        </label>
      </div>

      <div className="card">
        <h2 className="card-title">偏好记忆</h2>
        <label className="setting-line">
          常用时长（分钟）
          <input
            type="number"
            min={1}
            max={60}
            value={settings.defaultDurationMin}
            onChange={(e) => update({ defaultDurationMin: Number(e.target.value) })}
          />
        </label>
      </div>

      <div className="card danger-card">
        <h2 className="card-title">数据管理</h2>
        {!confirmClear ? (
          <button className="btn ghost" onClick={() => setConfirmClear(true)}>清空全部数据</button>
        ) : (
          <div className="row">
            <span>确认清空？</span>
            <button className="btn" onClick={() => void clearAll()}>确认</button>
            <button className="btn secondary" onClick={() => setConfirmClear(false)}>取消</button>
          </div>
        )}
      </div>
    </div>
  )
}