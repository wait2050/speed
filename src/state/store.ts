// ============================================================
// 全局状态 — Zustand store（轻量，无 Provider 嵌套）
// ============================================================
import { create } from 'zustand';
import type { AppStatus, CompiledSequence } from '../types';

interface AppStore {
  status: AppStatus;
  compiled: CompiledSequence | null;
  totalDuration: number;
  subjectiveClimaxTriggered: boolean;
  setDuration: (d: number) => void;
  startCompiling: () => void;
  compilationDone: (seq: CompiledSequence) => void;
  startPlaying: () => void;
  playbackFinished: () => void;
  reset: () => void;
  setSubjectiveClimax: (triggered: boolean) => void;
}

export const useAppStore = create<AppStore>((set) => ({
  status: 'IDLE',
  compiled: null,
  totalDuration: 20 * 60,
  subjectiveClimaxTriggered: false,

  setDuration: (d) => set({ totalDuration: d }),
  startCompiling: () => set({ status: 'COMPILING' }),
  compilationDone: (seq) => set({ status: 'READY', compiled: seq }),
  startPlaying: () => set({ status: 'PLAYING' }),
  playbackFinished: () => set({ status: 'FINISHED' }),
  reset: () => set({ status: 'IDLE', compiled: null, totalDuration: 20 * 60 }),
  setSubjectiveClimax: (triggered) => set({ subjectiveClimaxTriggered: triggered }),
}));
