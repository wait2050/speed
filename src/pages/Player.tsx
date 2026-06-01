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
import { lockTouch } from '../utils/preventTouch';
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
  const rootRef = useRef<HTMLDivElement>(null);
  const schedulerRef = useRef<PlaybackScheduler | null>(null);
  const [actionName, setActionName] = useState('准备开始...');
  const [remainingMs, setRemainingMs] = useState(0);
  const [currentPhase, setCurrentPhase] = useState<Phase>('warmup');
  const [isPaused, setIsPaused] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pausedRef = useRef(false);

  const compiled = state.compiled;

  // 安全保护
  useEffect(() => {
    if (!state.compiled) {
      console.error('[Player] compiled is null, resetting');
      dispatch({ type: 'RESET' });
    }
  }, [state.compiled, dispatch]);

  // 屏幕常亮
  useWakeLock(true);

  // 防误触
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const unlock = lockTouch(el);
    return unlock;
  }, []);

  // 启动调度器
  useEffect(() => {
    if (!compiled || !compiled.timeline || compiled.timeline.length === 0) {
      console.error('[Player] no compiled timeline');
      return;
    }

    console.log('[Player] starting scheduler, timeline length:', compiled.timeline.length);

    audioEngine.resume().catch(() => {});

    try {
      const scheduler = new PlaybackScheduler(
        audioEngine,
        (name, remaining, phase) => {
          setActionName(name);
          setRemainingMs(remaining);
          setCurrentPhase(phase);
          dispatch({ type: 'UPDATE_PROGRESS', payload: { actionName: name, remainingMs: remaining, phase } });
        },
        (phase) => {
          setCurrentPhase(phase);
        },
        () => {
          dispatch({ type: 'PLAYBACK_FINISHED' });
          clearProgress();
        },
      );

      schedulerRef.current = scheduler;
      scheduler.start(compiled.timeline);
      setIsPaused(false);
      pausedRef.current = false;
    } catch (e: any) {
      console.error('[Player] scheduler error:', e);
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
    const interval = setInterval(() => {
      if (schedulerRef.current?.isRunning) {
        saveProgress(timeline, schedulerRef.current.elapsed);
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [compiled]);

  // 页面切后台
  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) {
        schedulerRef.current?.pause();
        setIsPaused(true);
        pausedRef.current = true;
      } else {
        schedulerRef.current?.resume();
        setIsPaused(false);
        pausedRef.current = false;
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  // 暂停/继续
  const togglePause = useCallback(() => {
    const s = schedulerRef.current;
    if (!s) return;
    if (pausedRef.current) {
      s.resume();
      setIsPaused(false);
      pausedRef.current = false;
    } else {
      s.pause();
      setIsPaused(true);
      pausedRef.current = true;
    }
  }, []);

  // 点击进度条跳转
  const handleSeek = useCallback((targetMs: number) => {
    schedulerRef.current?.seek(targetMs);
    setIsPaused(false);
    pausedRef.current = false;
  }, []);

  // 停止
  const handleStop = useCallback(() => {
    schedulerRef.current?.stop();
    dispatch({ type: 'RESET' });
    clearProgress();
  }, [dispatch]);

  // 阶段分段（进度条用）
  const segments: PhaseSegment[] = useMemo(
    () => (compiled ? computePhaseSegments(compiled.timeline) : []),
    [compiled]
  );

  const totalMs = compiled?.stats?.totalDuration || 0;
  const elapsedMs = totalMs - remainingMs;

  if (!compiled) {
    return (
      <div className="page player-page">
        <p style={{ color: '#8888aa', fontSize: 14 }}>加载编排数据失败，正在返回...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="page player-page">
        <p style={{ color: '#e94560', fontSize: 14 }}>播放出错：{error}</p>
        <button className="btn btn-recompile" onClick={() => dispatch({ type: 'RESET' })} style={{ marginTop: 16 }}>
          返回首页
        </button>
      </div>
    );
  }

  return (
    <div className="page player-page" ref={rootRef}>
      {/* 进度条 */}
      <ProgressBar
        segments={segments}
        elapsedMs={elapsedMs}
        totalMs={totalMs}
        currentPhaseLabel={phaseLabels[currentPhase] ?? currentPhase}
        onSeek={handleSeek}
      />

      {/* 阶段标签 */}
      <div className="player-phase">
        {phaseLabels[currentPhase] ?? '准备中'}
      </div>

      {/* 动作名称 */}
      <div className="player-action-name">
        {actionName}
      </div>

      {/* 倒计时 */}
      <Timer remainingMs={remainingMs} totalMs={totalMs > 0 ? totalMs : 60000} />

      {/* 控制按钮 */}
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
