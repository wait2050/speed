// ============================================================
// 播放调度器 — 基于 audioContext.currentTime 预调度
// ============================================================
import type { TimelineItem, Phase, SoundType } from '../types';
import { AudioEngine } from '../audio/engine';
import { bpmToInterval } from './clock';
import { BPM_BOOST_DURATION, BPM_BOOST_AMOUNT } from '../compiler/rules';

export type UICallback = (actionName: string, actionRemainingMs: number, totalElapsedMs: number, phase: Phase) => void;
export type PhaseCallback = (phase: Phase) => void;
export type FinishCallback = () => void;

export class PlaybackScheduler {
  private timeline: TimelineItem[] = [];
  private audio: AudioEngine;
  private onUI: UICallback;
  private onPhase: PhaseCallback;
  private onFinish: FinishCallback;

  private startTime = 0;           // audioContext.currentTime at play
  private pausedAt: number | null = null;
  private elapsedBeforePause = 0;
  private timerId: ReturnType<typeof setInterval> | null = null;
  private scheduledUntil = 0;
  private running = false;
  private currentPhase: Phase = 'warmup';
  private currentActionName = '';
  private lastVoiceKey = '';  // 用于检测动作是否切换，触发语音
  private voiceEndTime = 0;   // 语音结束的绝对 audioContext 时间，在此之前不排节拍

  // 已安排的节拍时间点（去重用）
  private scheduledBeats = new Set<number>();

  constructor(
    audio: AudioEngine,
    onUI: UICallback,
    onPhase: PhaseCallback,
    onFinish: FinishCallback,
  ) {
    this.audio = audio;
    this.onUI = onUI;
    this.onPhase = onPhase;
    this.onFinish = onFinish;
  }

  start(timeline: TimelineItem[]): void {
    this.timeline = timeline;
    this.running = true;
    this.pausedAt = null;
    this.elapsedBeforePause = 0;
    this.scheduledUntil = 0;
    this.scheduledBeats.clear();
    this.lastVoiceKey = '';
    this.voiceEndTime = 0;
    this.startTime = this.audio.currentTime;

    this.scheduleLoop();
    this.timerId = setInterval(() => this.scheduleLoop(), 50);
  }

  pause(): void {
    if (!this.running) return;
    this.running = false;
    this.pausedAt = this.audio.currentTime;
    this.elapsedBeforePause = this.pausedAt - this.startTime;
    if (this.timerId) {
      clearInterval(this.timerId);
      this.timerId = null;
    }
  }

  resume(): void {
    if (this.running || this.pausedAt === null) return;
    this.running = true;
    // 重新计算 startTime，使 elapsed 保持连续
    this.startTime = this.audio.currentTime - this.elapsedBeforePause;
    this.pausedAt = null;
    this.scheduledUntil = this.audio.currentTime;
    this.scheduleLoop();
    this.timerId = setInterval(() => this.scheduleLoop(), 50);
  }

  stop(): void {
    this.running = false;
    if (this.timerId) {
      clearInterval(this.timerId);
      this.timerId = null;
    }
    this.scheduledBeats.clear();
  }

  /** 跳转到指定毫秒位置 */
  seek(targetMs: number): void {
    const wasRunning = this.running;
    if (this.timerId) {
      clearInterval(this.timerId);
      this.timerId = null;
    }
    this.scheduledBeats.clear();
    this.scheduledUntil = 0;
    this.voiceEndTime = 0;
    this.lastVoiceKey = '';

    // 调整 startTime 使 elapsed = targetMs
    this.startTime = this.audio.currentTime - targetMs / 1000;
    this.elapsedBeforePause = 0;
    this.pausedAt = null;

    if (wasRunning) {
      this.running = true;
      this.scheduleLoop();
      this.timerId = setInterval(() => this.scheduleLoop(), 50);
    }
  }

  get elapsed(): number {
    if (this.pausedAt !== null) return this.elapsedBeforePause;
    if (!this.running && this.elapsedBeforePause > 0) return this.elapsedBeforePause;
    if (!this.running) return 0;
    return (this.audio.currentTime - this.startTime) * 1000;
  }

  get isRunning(): boolean {
    return this.running;
  }

  // ---- 内部 ----

  private scheduleLoop(): void {
    if (!this.running) return;

    try {
    const now = this.audio.currentTime;
    const elapsedMs = (now - this.startTime) * 1000;
    const lookAheadMs = 200; // 提前200ms安排

    // 遍历时间线，找到当前进度
    let accumulatedMs = 0;
    let foundCurrent = false;

    for (const item of this.timeline) {
      if (item.type === 'end') {
        // 结束
        if (elapsedMs >= accumulatedMs) {
          this.running = false;
          if (this.timerId) {
            clearInterval(this.timerId);
            this.timerId = null;
          }
          this.onFinish();
        }
        return;
      }

      const dur = item.type === 'action' || item.type === 'rest' ? item.duration : 0;
      const itemEnd = accumulatedMs + dur;

      if (elapsedMs >= accumulatedMs && elapsedMs < itemEnd && !foundCurrent) {
        foundCurrent = true;
        // 这是当前正在进行的项
        const remainingMs = itemEnd - elapsedMs;

        if (item.type === 'action') {
          this.currentActionName = item.name;
          if (item.phase !== this.currentPhase) {
            this.currentPhase = item.phase;
            this.onPhase(item.phase);
          }
          this.onUI(item.name, remainingMs, elapsedMs, item.phase);

          // 动作切换时播放语音引导，并记录语音结束时间
          const voiceKey = `action_${accumulatedMs}`;
          if (voiceKey !== this.lastVoiceKey) {
            this.lastVoiceKey = voiceKey;
            const dur = this.audio.speakVoice(item.name);
            this.voiceEndTime = this.audio.currentTime + dur;
          }
        } else if (item.type === 'rest') {
          this.currentActionName = '休息中';
          this.onUI('休息中', remainingMs, elapsedMs, item.phase);

          // 休息开始也播放语音，并记录语音结束时间
          const voiceKey = `rest_${accumulatedMs}`;
          if (voiceKey !== this.lastVoiceKey) {
            this.lastVoiceKey = voiceKey;
            const dur = this.audio.speakVoice('休息中');
            this.voiceEndTime = this.audio.currentTime + dur;
          }
        }
      }

      // 安排未来节拍
      if (item.type === 'action' && itemEnd > elapsedMs) {
        const offsetMs = accumulatedMs;
        const actionEndMs = itemEnd;
        this.scheduleActionBeats(item, offsetMs, actionEndMs, elapsedMs, lookAheadMs);
      }

      // 安排 transition 信号
      if (item.type === 'transition' && itemEnd <= elapsedMs + lookAheadMs && itemEnd > elapsedMs - 50) {
        const signalTime = this.startTime + itemEnd / 1000;
        if (signalTime > now && signalTime < now + lookAheadMs / 1000) {
          this.audio.scheduleSignal(item.signal, signalTime);
        }
      }

      if (item.type === 'action' || item.type === 'rest') {
        accumulatedMs += item.duration;
      }
    }
    } catch (e) {
      console.error('[Scheduler] scheduleLoop error:', e);
    }
  }

  private scheduleActionBeats(
    item: Extract<TimelineItem, { type: 'action' }>,
    offsetMs: number,
    endMs: number,
    elapsedMs: number,
    lookAheadMs: number,
  ): void {
    const now = this.audio.currentTime;
    const bpm = item.bpm;
    const intervalMs = bpmToInterval(bpm);
    const boostStart = endMs - BPM_BOOST_DURATION;

    // 只在动作范围内安排节拍
    const firstBeatOffset = offsetMs;
    for (let t = firstBeatOffset; t < endMs; t += intervalMs) {
      // 最后10秒 BPM+2
      let actualInterval = intervalMs;
      if (t >= boostStart) {
        const boostedBpm = bpm + BPM_BOOST_AMOUNT;
        actualInterval = bpmToInterval(boostedBpm);
      }

      const beatAbsTime = this.startTime + t / 1000;

      // 语音播放期间不排节拍
      if (beatAbsTime < this.voiceEndTime) continue;

      const beatKey = Math.round(beatAbsTime * 1000);

      // 在 look-ahead 窗口内且未安排过
      if (beatAbsTime > now && beatAbsTime < now + lookAheadMs / 1000) {
        if (!this.scheduledBeats.has(beatKey)) {
          this.scheduledBeats.add(beatKey);
          this.audio.scheduleBeat(item.sound, beatAbsTime, item.volume);
        }
      }

      // 如果已过当前拍，继续下一个
      if (t >= boostStart) {
        // 使用加速间隔
        t += actualInterval - intervalMs; // adjust
      }
    }
  }
}
