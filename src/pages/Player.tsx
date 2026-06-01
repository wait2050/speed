// ============================================================
// Player — 极简播放页：引擎驱动 UI，零闭包问题
// ============================================================
import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { useAppState } from '../state/context';
import { Timer } from '../components/Timer';
import { ProgressBar } from '../components/ProgressBar';
import { PlaybackEngine } from '../engine/PlaybackEngine';
import type { EngineDisplayState } from '../engine/PlaybackEngine';
import { computePhaseSegments } from '../scheduler/segments';
import type { PhaseSegment } from '../scheduler/segments';
import { saveProgress, clearProgress } from '../storage';
import type { Phase } from '../types';

const PHASE_LABELS: Record<Phase, string> = {
  warmup: '热身', core: '核心',
  sprint_start: '起冲', sprint_accel: '加速', sprint_peak: '顶峰',
  climax: '冲刺', afterglow: '余韵', cooldown: '收尾', landing: '着陆',
};

export const Player: React.FC = () => {
  const { state, dispatch } = useAppState();
  const compiled = state.compiled;
  const engineRef = useRef<PlaybackEngine | null>(null);

  // 显示状态（引擎单向推送）
  const [ds, setDs] = useState<EngineDisplayState>({
    actionName: '准备开始...', actionRemainingMs: 0,
    totalElapsedMs: 0, phase: 'warmup', isPaused: false,
  });

  // 启动
  useEffect(() => {
    if (!compiled?.timeline?.length) {
      dispatch({ type: 'RESET' });
      return;
    }

    const engine = new PlaybackEngine();
    engineRef.current = engine;

    engine.init().then(() => {
      engine.setOnUpdate(setDs);
      engine.start(compiled.timeline);
    });

    return () => { engine.destroy(); engineRef.current = null; };
  }, [compiled, dispatch]);

  // 暂停
  useEffect(() => {
    const onVis = () => {
      const e = engineRef.current;
      if (!e) return;
      if (document.hidden) e.pause(); else e.resume();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  // 定期存进度
  useEffect(() => {
    if (!compiled) return;
    const iv = setInterval(() => {
      const e = engineRef.current;
      if (e?.isRunning && !e.isPaused) {
        saveProgress(compiled.timeline, e.elapsed);
      }
    }, 5000);
    return () => clearInterval(iv);
  }, [compiled]);

  // 操作（直接调引擎，零闭包依赖）
  const togglePause = useCallback(() => {
    const e = engineRef.current; if (!e) return;
    e.isPaused ? e.resume() : e.pause();
  }, []);

  const handleSeek = useCallback((ms: number) => {
    engineRef.current?.seek(ms);
  }, []);

  const handleStop = useCallback(() => {
    engineRef.current?.destroy();
    dispatch({ type: 'RESET' });
    clearProgress();
  }, [dispatch]);

  const segments: PhaseSegment[] = useMemo(
    () => compiled ? computePhaseSegments(compiled.timeline) : [],
    [compiled]
  );
  const totalMs = compiled?.stats?.totalDuration || 0;

  if (!compiled) {
    return <div className="page player-page"><p style={{ color: '#8888aa' }}>加载失败</p></div>;
  }

  return (
    <div className="page player-page">
      <ProgressBar
        segments={segments}
        elapsedMs={ds.totalElapsedMs}
        totalMs={totalMs}
        currentPhaseLabel={PHASE_LABELS[ds.phase] ?? ds.phase}
        onSeek={handleSeek}
      />
      <div className="player-phase">{PHASE_LABELS[ds.phase] ?? ds.phase}</div>
      <div className="player-action-name">{ds.actionName}</div>
      <Timer remainingMs={ds.actionRemainingMs} totalMs={ds.actionRemainingMs || 60000} />
      <div className="player-controls">
        <button className="btn btn-pause" onClick={togglePause}>
          {ds.isPaused ? '▶ 继续' : '⏸ 暂停'}
        </button>
        <button className="btn btn-stop" onClick={handleStop}>■ 停止</button>
      </div>
    </div>
  );
};
