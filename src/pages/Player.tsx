// ============================================================
// Player — 播放页：进度条 + 暂停/继续 + 倒计时
// ============================================================
import React, { useEffect, useRef, useCallback, useState, useMemo } from 'react';
import { useAppState } from '../state/context';
import { Timer } from '../components/Timer';
import { ProgressBar } from '../components/ProgressBar';
import { PlaybackScheduler } from '../scheduler/scheduler';
import { computePhaseSegments } from '../scheduler/segments';
import type { PhaseSegment } from '../scheduler/segments';
import { audioEngine } from '../audio/engine';
import { useWakeLock } from '../hooks/useWakeLock';
import { saveProgress, clearProgress } from '../storage';
import type { Phase } from '../types';

const phaseLabels: Record<Phase, string> = {
  warmup: '热身',
  core: '核心',
  sprint_start: '起冲',
  sprint_accel: '加速',
  sprint_peak: '顶峰',
  climax: '冲刺',
  afterglow: '余韵',
  cooldown: '收尾',
  landing: '着陆',
};

export const Player: React.FC = () => {
  const { state, dispatch } = useAppState();
  const schedulerRef = useRef<PlaybackScheduler | null>(null);

  const [actionName, setActionName] = useState('准备开始...');
  const [actionRemainingMs, setActionRemainingMs] = useState(0);
  const [totalElapsedMs, setTotalElapsedMs] = useState(0);
  const [currentPhase, setCurrentPhase] = useState<Phase>('warmup');
  const [isPaused, setIsPaused] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const compiled = state.compiled;

  // 安全保护
  useEffect(() => {
    if (!state.compiled) {
      dispatch({ type: 'RESET' });
    }
  }, [state.compiled, dispatch]);

  useWakeLock(true);

  // 启动调度器
  useEffect(() => {
    if (!compiled?.timeline?.length) return;

    audioEngine.resume().catch(() => {});

    try {
      const s = new PlaybackScheduler(
        audioEngine,
        (name, actionRemaining, totalElapsed, phase) => {
          setActionName(name);
          setActionRemainingMs(actionRemaining);
          setTotalElapsedMs(totalElapsed);
          setCurrentPhase(phase);
          dispatch({ type: 'UPDATE_PROGRESS', payload: { actionName: name, remainingMs: actionRemaining, phase } });
        },
        (phase) => setCurrentPhase(phase),
        () => {
          dispatch({ type: 'PLAYBACK_FINISHED' });
          clearProgress();
        },
      );

      schedulerRef.current = s;
      s.start(compiled.timeline);
      setIsPaused(false);
    } catch (e: any) {
      setError(e?.message ?? '调度器启动失败');
    }

    return () => {
      schedulerRef.current?.stop();
      schedulerRef.current = null;
    };
  }, [compiled, dispatch]);

  // 定期保存进度
  useEffect(() => {
    if (!compiled) return;
    const timeline = compiled.timeline;
    const iv = setInterval(() => {
      if (schedulerRef.current?.isRunning) {
        saveProgress(timeline, schedulerRef.current.elapsed);
      }
    }, 5000);
    return () => clearInterval(iv);
  }, [compiled]);

  // 页面切后台自动暂停
  useEffect(() => {
    const onVis = () => {
      const s = schedulerRef.current;
      if (!s) return;
      if (document.hidden) {
        s.pause();
        setIsPaused(true);
      } else {
        s.resume();
        setIsPaused(false);
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  // 暂停 / 继续（直接从调度器读状态，避免闭包陈旧）
  const togglePause = useCallback(() => {
    const s = schedulerRef.current;
    if (!s) return;
    if (s.isRunning) {
      s.pause();
      setIsPaused(true);
    } else {
      s.resume();
      setIsPaused(false);
    }
  }, []);

  // 点击进度条跳转
  const handleSeek = useCallback((targetMs: number) => {
    schedulerRef.current?.seek(targetMs);
    setIsPaused(false);
  }, []);

  // 停止
  const handleStop = useCallback(() => {
    schedulerRef.current?.stop();
    dispatch({ type: 'RESET' });
    clearProgress();
  }, [dispatch]);

  // 阶段分段
  const segments: PhaseSegment[] = useMemo(
    () => (compiled ? computePhaseSegments(compiled.timeline) : []),
    [compiled]
  );

  const totalMs = compiled?.stats?.totalDuration || 0;

  if (!compiled) {
    return <div className="page player-page"><p style={{ color: '#8888aa' }}>加载失败，返回中...</p></div>;
  }
  if (error) {
    return (
      <div className="page player-page">
        <p style={{ color: '#e94560' }}>错误：{error}</p>
        <button className="btn btn-recompile" onClick={() => dispatch({ type: 'RESET' })} style={{ marginTop: 16 }}>返回</button>
      </div>
    );
  }

  return (
    <div className="page player-page">
      {/* 全局进度条 */}
      <ProgressBar
        segments={segments}
        elapsedMs={totalElapsedMs}
        totalMs={totalMs}
        currentPhaseLabel={phaseLabels[currentPhase] ?? currentPhase}
        onSeek={handleSeek}
      />

      <div className="player-phase">{phaseLabels[currentPhase] ?? '准备中'}</div>

      <div className="player-action-name">{actionName}</div>

      {/* 当前动作倒计时 */}
      <Timer remainingMs={actionRemainingMs} totalMs={actionRemainingMs > 0 ? actionRemainingMs : 60000} />

      <div className="player-controls">
        <button className="btn btn-pause" onClick={togglePause}>
          {isPaused ? '▶ 继续' : '⏸ 暂停'}
        </button>
        <button className="btn btn-stop" onClick={handleStop}>
          ■ 停止
        </button>
      </div>
    </div>
  );
};
