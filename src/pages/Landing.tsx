// ============================================================
// Landing — 静默着陆页：呼吸灯 + 评分
// ============================================================
import React, { useState, useCallback, useEffect } from 'react';
import { useAppState } from '../state/context';
import { BreathingLight } from '../components/BreathingLight';
import { saveHistory, saveFavorite } from '../storage';
import type { HistoryEntry } from '../types';

export const Landing: React.FC = () => {
  const { state, dispatch } = useAppState();
  const [rating, setRating] = useState<number | null>(null);
  const [showFavorite, setShowFavorite] = useState(false);
  const [favLabel, setFavLabel] = useState('');
  const [ended, setEnded] = useState(false);
  const [phase, setPhase] = useState<'breathing' | 'rating' | 'done'>('breathing');

  // 30秒后自动进入评分
  useEffect(() => {
    const timer = setTimeout(() => {
      setPhase('rating');
    }, 30000);

    return () => clearTimeout(timer);
  }, []);

  const handleEndEarly = useCallback(() => {
    setPhase('rating');
  }, []);

  const handleRate = useCallback((r: number) => {
    setRating(r);

    if (state.compiled) {
      const entry: HistoryEntry = {
        id: `h_${Date.now()}`,
        timestamp: Date.now(),
        totalDuration: state.totalDuration,
        stats: state.compiled.stats,
        rating: r,
        sequence: state.compiled,
      };
      saveHistory(entry);
    }

    setShowFavorite(true);
  }, [state.compiled, state.totalDuration]);

  const handleFavorite = useCallback(() => {
    if (state.compiled && favLabel.trim()) {
      saveFavorite(state.compiled, favLabel.trim());
    }
    setPhase('done');
  }, [state.compiled, favLabel]);

  const handleSkipFavorite = useCallback(() => {
    setPhase('done');
  }, []);

  const handleReset = useCallback(() => {
    dispatch({ type: 'RESET' });
  }, [dispatch]);

  return (
    <div className="page landing-page">
      {phase === 'breathing' && (
        <div className="breathing-section">
          <BreathingLight />
          <button className="btn btn-end-early" onClick={handleEndEarly}>
            提前结束
          </button>
        </div>
      )}

      {phase === 'rating' && (
        <div className="rating-section">
          <h2>体验如何？</h2>
          <div className="stars">
            {[1, 2, 3, 4, 5].map(i => (
              <button
                key={i}
                className={`star ${rating !== null && i <= rating ? 'active' : ''}`}
                onClick={() => handleRate(i)}
                disabled={rating !== null}
              >
                {i <= (rating ?? 0) ? '★' : '☆'}
              </button>
            ))}
          </div>

          {showFavorite && (
            <div className="favorite-section">
              <p>是否收藏此编排？</p>
              <input
                type="text"
                className="fav-input"
                placeholder="输入标签（可选）"
                value={favLabel}
                onChange={e => setFavLabel(e.target.value)}
                autoFocus
              />
              <div className="fav-buttons">
                <button className="btn btn-save" onClick={handleFavorite}>
                  收藏
                </button>
                <button className="btn btn-skip" onClick={handleSkipFavorite}>
                  跳过
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {phase === 'done' && (
        <button className="btn btn-home" onClick={handleReset}>
          返回首页
        </button>
      )}
    </div>
  );
};
