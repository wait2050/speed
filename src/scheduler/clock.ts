// ============================================================
// 时间计算辅助
// ============================================================

/** 给定BPM，计算每拍间隔（毫秒） */
export function bpmToInterval(bpm: number): number {
  return 60000 / bpm;
}

/** 给定动作时长和BPM，计算拍数 */
export function beatCount(durationMs: number, bpm: number): number {
  return Math.floor(durationMs / bpmToInterval(bpm));
}

/** 格式化毫秒为 mm:ss */
export function formatMs(ms: number): string {
  const totalSec = Math.max(0, Math.round(ms / 1000));
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${sec.toString().padStart(2, '0')}`;
}

/** 格式化秒为 mm:ss */
export function formatSec(sec: number): string {
  return formatMs(sec * 1000);
}
