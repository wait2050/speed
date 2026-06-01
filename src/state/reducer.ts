// ============================================================
// 全局状态 Reducer（仅页面路由）
// ============================================================
import type { AppState, AppAction } from '../types';

export const initialState: AppState = {
  status: 'IDLE',
  compiled: null,
  totalDuration: 20 * 60,
};

export function reducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'SET_DURATION':
      return { ...state, totalDuration: action.payload };
    case 'START_COMPILING':
      return { ...state, status: 'COMPILING' };
    case 'COMPILATION_DONE':
      return { ...state, status: 'READY', compiled: action.payload };
    case 'START_PLAYING':
      return { ...state, status: 'PLAYING' };
    case 'PAUSE':
      return { ...state, status: 'PAUSED' };
    case 'RESUME':
      return { ...state, status: 'PLAYING' };
    case 'PLAYBACK_FINISHED':
      return { ...state, status: 'FINISHED' };
    case 'RESET':
      return initialState;
    default:
      return state;
  }
}
