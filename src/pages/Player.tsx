// ============================================================
// Player — 播放页：大字号动作名 + 倒计时 + 零交互
// ============================================================
import React, { useEffect, useRef, useCallback, useState } from 'react';
import { useAppState } from '../state/context';
import { Timer } from '../components/Timer';
import { PlaybackScheduler } from '../scheduler/scheduler';
import { audioEngine } from '../audio/engine';
import { useWakeLock } from '../hooks/useWakeLock';
import { useFullscreen } from '../hooks/useFullscreen';
import { lockTouch } from '../utils/preventTouch';
import { saveProgress, clearProgress } from '../storage';
import type { Phase } from '../types';

const phaseLabels: Record<Phase, string> = {
  warmup: '热身',
  core: '核心',
  sprint_start: '冲刺·起冲',
  sprint_accel: '冲刺·加速',
  sprint_peak: '冲刺·顶峰',
  climax: '高潮冲刺',
  afterglow: '高潮后持续',
  cooldown: '收尾',
  landing: '静默着陆',
};

export const Player: React.FC = () => {
  const { state, dispatch } = useAppState();
  const compiled = state.compiled!;
  const rootRef = useRef<HTMLDivElement>(null);
  const schedulerRef = useRef<PlaybackScheduler | null>(null);
  const [actionName, setActionName] = useState('');
  const [remainingMs, setRemainingMs] = useState(0);
  const [currentPhase, setCurrentPhase] = useState<Phase>('warmup');
  const [emergencyVisible, setEmergencyVisible] = useState(false);
  const [confirmStop, setConfirmStop] = useState(false);
  const longPressRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 屏幕常亮 + 全屏
  useWakeLock(true);
  useFullscreen(true);

  // 防误触
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const unlock = lockTouch(el);
    return unlock;
  }, []);

  // 启动调度器
  useEffect(() => {
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

    return () => {
      scheduler.stop();
    };
  }, [compiled, dispatch]);

  // 定期保存进度
  useEffect(() => {
    const interval = setInterval(() => {
      if (schedulerRef.current?.isRunning) {
        saveProgress(compiled.timeline, schedulerRef.current.elapsed);
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [compiled]);

  // 页面切后台处理
  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) {
        schedulerRef.current?.pause();
      } else {
        schedulerRef.current?.resume();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  // 紧急退出：长按3秒
  const handleEmergStart = useCallback(() => {
    longPressRef.current = setTimeout(() => {
      setEmergencyVisible(true);
      setConfirmStop(true);
    }, 3000);
  }, []);

  const handleEmergCancel = useCallback(() => {
    if (longPressRef.current) {
      clearTimeout(longPressRef.current);
      longPressRef.current = null;
    }
    setEmergencyVisible(false);
    setConfirmStop(false);
  }, []);

  const handleStop = useCallback(() => {
    schedulerRef.current?.stop();
    dispatch({ type: 'RESET' });
    clearProgress();
  }, [dispatch]);

  const totalMs = compiled.stats.totalDuration;

  return (
    <div className="page player-page" ref={rootRef}>
      <div className="player-phase">
        {phaseLabels[currentPhase]}
      </div>

      <div className="player-action-name">
        {actionName || '准备开始...'}
      </div>

      <Timer remainingMs={remainingMs} totalMs={totalMs} />

      {/* 紧急退出按钮（角落透明） */}
      <div
        className={`emergency-btn ${emergencyVisible ? 'visible' : ''}`}
        onTouchStart={handleEmergStart}
        onTouchEnd={handleEmergCancel}
        onMouseDown={handleEmergStart}
        onMouseUp={handleEmergCancel}
        onMouseLeave={handleEmergCancel}
      >
        {confirmStop ? (
          <div className="emergency-confirm">
            <p>确定停止当前体验？</p>
            <button className="btn btn-danger" onClick={handleStop}>确定停止</button>
            <button className="btn btn-cancel" onClick={handleEmergCancel}>取消</button>
          </div>
        ) : (
          <span className="emergency-hint">长按3秒停止</span>
        )}
      </div>
    </div>
  );
};
