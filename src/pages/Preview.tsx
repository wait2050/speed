// ============================================================
// Preview — 编排预览：统计 + 序列列表 + 开始按钮
// ============================================================
import React, { useMemo, useCallback } from 'react';
import { useAppState } from '../state/context';
import { SequenceList } from '../components/SequenceList';
import { formatMs, formatSec } from '../scheduler/clock';

export const Preview: React.FC = () => {
  const { state, dispatch } = useAppState();
  const compiled = state.compiled!;
  const stats = compiled.stats;

  const handleStart = useCallback(() => {
    dispatch({ type: 'START_PLAYING' });
  }, [dispatch]);

  const handleRecompile = useCallback(() => {
    dispatch({ type: 'RESET' });
  }, [dispatch]);

  return (
    <div className="page preview-page">
      <h2>编排预览</h2>

      {/* 统计概览 */}
      <div className="stats-grid">
        <div className="stat-item">
          <span className="stat-value">{formatMs(stats.totalDuration)}</span>
          <span className="stat-label">总时长</span>
        </div>
        <div className="stat-item">
          <span className="stat-value">{formatMs(stats.totalActionDuration)}</span>
          <span className="stat-label">动作总时长</span>
        </div>
        <div className="stat-item">
          <span className="stat-value">{formatMs(stats.totalRestDuration)}</span>
          <span className="stat-label">休息总时长</span>
        </div>
        <div className="stat-item">
          <span className="stat-value">{stats.rounds}</span>
          <span className="stat-label">总轮数</span>
        </div>
      </div>

      <div className="phase-summary">
        热身 {stats.warmupRounds} 轮 → 核心 {stats.coreRounds} 轮
        {stats.sprintRounds > 0 && ` → 冲刺 ${stats.sprintRounds} 轮`}
      </div>

      {/* 序列列表 */}
      <div className="sequence-scroll">
        <SequenceList timeline={compiled.timeline} />
      </div>

      {/* 操作按钮 */}
      <div className="preview-actions">
        <button className="btn btn-start" onClick={handleStart}>
          开始
        </button>
        <button className="btn btn-recompile" onClick={handleRecompile}>
          重新编排
        </button>
      </div>
    </div>
  );
};
