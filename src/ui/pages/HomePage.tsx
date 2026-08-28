import { useMemo, useState } from 'react'
import { generateOrchestration } from '../../domain/engine'
import { ACTIVITY_LABEL, STAGE_LABEL } from '../../domain/types'
import { loadPrefs } from '../../storage/prefs'
import { setCurrentSession } from '../../session/currentSession'
import { navigate } from '../../App'

const PRESETS = [5, 10, 15, 20, 30]

function formatMinSec(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return s === 0 ? `${m} 分钟` : `${m} 分 ${s} 秒`
}

export default function HomePage() {
  const prefs = useMemo(() => loadPrefs(), [])
  const [durationMin, setDurationMin] = useState(prefs.defaultDurationMin)
  const [settings] = useState(prefs)
  const [seed, setSeed] = useState(0)
  const [generated, setGenerated] = useState(0)

  const result = useMemo(
    () => generateOrchestration(durationMin * 60, settings, seed || 1),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [durationMin, settings, seed, generated],
  )

  const generate = () => {
    setSeed(Math.floor(Math.random() * 2 ** 31))
    setGenerated((n) => n + 1)
  }

  const start = () => {
    if (!result.ok) return
    setCurrentSession({
      orchestration: result.orchestration,
      settings,
      seed,
      totalSec: result.orchestration.totalSec,
    })
    navigate('player')
  }

  return (
    <div className="page">
      <h1>节奏按摩引导器</h1>

      <div className="card">
        <label className="field-label">总时长：{durationMin} 分钟</label>
        <input
          type="range"
          min={1}
          max={60}
          step={1}
          value={durationMin}
          onChange={(e) => setDurationMin(Number(e.target.value))}
        />
        <div className="preset-row">
          {PRESETS.map((p) => (
            <button
              key={p}
              className={`chip ${durationMin === p ? 'chip-active' : ''}`}
              onClick={() => setDurationMin(p)}
            >
              {p}min
            </button>
          ))}
        </div>
        <div className="row">
          <button className="btn" onClick={generate}>生成编排</button>
          {result.ok && seed !== 0 && (
            <button className="btn secondary" onClick={generate}>重新编排</button>
          )}
        </div>
      </div>

      {!result.ok && (
        <div className="card warn-card">
          <p>当前时长过短，最少需要 {formatMinSec(result.error.minFeasibleSec)} 才能容纳完整螺旋结构。</p>
        </div>
      )}

      {result.ok && (
        <div className="card">
          <h2 className="card-title">编排概览</h2>
          <div className="stats-grid">
            <div><b>{formatMinSec(result.orchestration.stats.totalSec)}</b><span>总时长</span></div>
            <div><b>{formatMinSec(result.orchestration.stats.actionSec)}</b><span>有动作</span></div>
            <div><b>{formatMinSec(result.orchestration.stats.restSec)}</b><span>静置</span></div>
            <div><b>{result.orchestration.stats.warmupUnits}</b><span>热身段</span></div>
            <div><b>{result.orchestration.stats.coreUnits}</b><span>核心单元</span></div>
            <div><b>{result.orchestration.stats.sprintSteps}</b><span>冲刺步</span></div>
          </div>
          <button className="btn start-btn" onClick={start}>开始播放</button>
        </div>
      )}

      {result.ok && (
        <div className="card">
          <h2 className="card-title">单元列表</h2>
          {result.orchestration.core.map((unit) => (
            <div className="unit-block" key={unit.index}>
              <h3>单元 {unit.index + 1} {unit.index % 2 === 0 ? '· 左主导' : '· 右主导'}</h3>
              {unit.stages.map((st) => (
                <div className="stage-row" key={st.name}>
                  <span>{STAGE_LABEL[st.name]}</span>
                  <span className="mono">{Math.round(st.durationMs / 1000)}s</span>
                  <span>{ACTIVITY_LABEL[st.activity]}</span>
                </div>
              ))}
            </div>
          ))}
          <h3 className="sprint-title">冲刺</h3>
          {result.orchestration.sprint.substeps.map((step) => (
            <div className="stage-row" key={step.sub}>
              <span>{step.name}</span>
              <span className="mono">{Math.round(step.durationMs / 1000)}s</span>
              <span>{ACTIVITY_LABEL[step.activity]}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}