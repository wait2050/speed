// ============================================================
// 全局状态 Reducer
// ============================================================
import type { AppState, AppAction, Phase } from '../types';

export const initialState: AppState = {
  status: 'IDLE',
  compiled: null,
  currentActionName: '',
  remainingMs: 0,
  currentPhase: 'warmup',
  totalDuration: 20 * 60, // 默认20分钟
};

export function reducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'SET_DURATION':
      return { ...state, totalDuration: action.payload };

    case 'START_COMPILING':
      return { ...state, status: 'COMPILING' };

    case 'COMPILATION_DONE':
      return {
        ...state,
        status: 'READY',
        compiled: action.payload,
      };

    case 'START_PLAYING':
      return {
        ...state,
        status: 'PLAYING',
        currentActionName: '',
        remainingMs: 0,
        currentPhase: 'warmup',
      };

    case 'PAUSE':
      return { ...state, status: 'PAUSED' };

    case 'RESUME':
      return { ...state, status: 'PLAYING' };

    case 'UPDATE_PROGRESS':
      return {
        ...state,
        currentActionName: action.payload.actionName,
        remainingMs: action.payload.remainingMs,
        currentPhase: action.payload.phase,
      };

    case 'PLAYBACK_FINISHED':
      return { ...state, status: 'FINISHED' };

    case 'RESET':
      return initialState;

    default:
      return state;
  }
}
