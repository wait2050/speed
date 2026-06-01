// ============================================================
// App — 状态驱动页面路由
// ============================================================
import React from 'react';
import { useAppState, AppProvider } from './state/context';
import { Home } from './pages/Home';
import { Preview } from './pages/Preview';
import { Player } from './pages/Player';
import { Landing } from './pages/Landing';
import { loadProgress } from './storage';
import { audioEngine } from './audio/engine';
import './index.css';

const AppInner: React.FC = () => {
  const { state, dispatch } = useAppState();

  // 检测未完成编排（延迟执行，避免阻塞首屏渲染）
  React.useEffect(() => {
    const timer = setTimeout(() => {
      try {
        const saved = loadProgress();
        if (saved && state.status === 'IDLE') {
          const resume = window.confirm(
            '检测到上次未完成的播放，是否继续？'
          );
          if (resume) {
            audioEngine.init().then(() => {
              dispatch({
                type: 'COMPILATION_DONE',
                payload: { timeline: saved.timeline, stats: { totalDuration: 0, totalActionDuration: 0, totalRestDuration: 0, rounds: 0, warmupRounds: 0, coreRounds: 0, sprintRounds: 0 } },
              });
              dispatch({ type: 'START_PLAYING' });
            }).catch(() => {});
          }
        }
      } catch { /* ignore */ }
    }, 500);
    return () => clearTimeout(timer);
  }, []); // eslint-disable-line

  switch (state.status) {
    case 'IDLE':
      return <Home />;
    case 'COMPILING':
      return (
        <div className="page loading-page">
          <div className="loading-spinner" />
          <p>正在生成编排...</p>
        </div>
      );
    case 'READY':
      return <Preview />;
    case 'PLAYING':
    case 'PAUSED':
      return <Player />;
    case 'FINISHED':
      return <Landing />;
    default:
      return <Home />;
  }
};

const App: React.FC = () => {
  return (
    <AppProvider>
      <AppInner />
    </AppProvider>
  );
};

export default App;
