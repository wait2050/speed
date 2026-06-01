// ============================================================
// PlaybackEngine — 统一音频播放引擎（在 React 之外运行）
//
// 设计原则（来自 web.dev / MDN 最佳实践）：
// - 引擎是 class 实例，存储在 useRef 中
// - 所有播放状态是引擎实例属性，不通过 React state 管理
// - 引擎通过 onUpdate 回调单向推送显示数据到 React
// - setInterval + audioContext.currentTime 预调度（行业金标准）
// ============================================================
import type { TimelineItem, SoundType, Phase } from '../types';
import {
  synthesizeTick, synthesizeWoodblock, synthesizeHeartbeat,
  synthesizeWaterdrop, synthesizeFingertap, synthesizeBassdrum,
} from '../audio/sounds';
import { BPM_BOOST_DURATION, BPM_BOOST_AMOUNT } from '../compiler/rules';

// ---- 显示状态（引擎推送给 React） ----
export interface EngineDisplayState {
  actionName: string;
  actionRemainingMs: number;
  totalElapsedMs: number;
  phase: Phase;
  isPaused: boolean;
}

export type EngineUpdateCallback = (state: EngineDisplayState) => void;

// 动作 → 语音文件名
const VOICE_MAP: Record<string, string> = {
  '从上方和下方捏住并旋转': '从上方和下方捏住并旋转.wav',
  '隔着内衣用指甲抓挠': '隔着内衣用指甲抓挠.wav',
  '捏住并不断变换力度': '捏住并不断变换力度.wav',
  '捏住并轻轻向外侧拉': '捏住并轻轻向外侧拉.wav',
  '夹住周围区域': '夹住周围区域.wav',
  '用指腹温柔摩擦': '用指腹温柔摩擦.wav',
  '用指甲拨动': '用指甲拨动.wav',
  '按压': '按压.wav',
  '振动手指': '振动手指.wav',
  '反复碰触': '反复碰触.wav',
  '摩擦周围区域': '摩擦周围区域.wav',
  '摩擦目标区域和周围区域': '摩擦目标区域和周围区域.wav',
  '休息中': '休息.wav',
  '收尾缓冲': '收尾缓冲.wav',
};

const BASE = import.meta.env.BASE_URL || '/';

const LOOK_AHEAD_MS = 200;
const SCHEDULE_INTERVAL_MS = 50;

export class PlaybackEngine {
  // ---- 公开状态（React 只读） ----
  isRunning = false;
  isPaused = false;
  totalElapsedMs = 0;

  // ---- 内部 ----
  private ctx: AudioContext | null = null;
  private beatBuffers = new Map<SoundType, AudioBuffer>();
  private signalBuffers = new Map<string, AudioBuffer>();
  private voiceBuffers = new Map<string, AudioBuffer>();
  private snapBuffer: AudioBuffer | null = null;
  private initialized = false;

  private timeline: TimelineItem[] = [];
  private startTime = 0;
  private pausedAt: number | null = null;
  private elapsedBeforePause = 0;
  private timerId: ReturnType<typeof setInterval> | null = null;
  private scheduledBeats = new Set<number>();
  private lastVoiceKey = '';
  private voiceEndTime = 0;

  private currentActionName = '';
  private currentPhase: Phase = 'warmup';
  private onUpdate: EngineUpdateCallback | null = null;

  // ---- 初始化 ----

  /** 必须在用户手势中调用（移动端 AudioContext 限制） */
  async init(): Promise<void> {
    if (this.initialized) return;
    this.ctx = new AudioContext({ sampleRate: 44100 });

    // 合成节拍音
    this.beatBuffers.set('tick', synthesizeTick());
    this.beatBuffers.set('woodblock', synthesizeWoodblock());
    this.beatBuffers.set('heartbeat', synthesizeHeartbeat());
    this.beatBuffers.set('waterdrop', synthesizeWaterdrop());
    this.beatBuffers.set('fingertap', synthesizeFingertap());
    this.beatBuffers.set('bassdrum', synthesizeBassdrum());

    // 合成信号音
    this.signalBuffers.set('single_ding', this.makeDing(1));
    this.signalBuffers.set('double_ding', this.makeDing(2));
    this.signalBuffers.set('heavy_beats', this.makeHeavyBeat());

    // 合成打响指音效
    this.snapBuffer = this.makeSnap();

    this.initialized = true;

    // 后台加载语音
    this.loadVoices();
  }

  /** 注册 UI 更新回调 */
  setOnUpdate(cb: EngineUpdateCallback): void {
    this.onUpdate = cb;
  }

  // ---- 播放控制 ----

  start(timeline: TimelineItem[]): void {
    if (!this.ctx || !this.initialized) return;
    this.ctx.resume().catch(() => {});

    this.timeline = timeline;
    this.isRunning = true;
    this.isPaused = false;
    this.totalElapsedMs = 0;
    this.pausedAt = null;
    this.elapsedBeforePause = 0;
    this.scheduledBeats.clear();
    this.lastVoiceKey = '';
    this.voiceEndTime = 0;
    this.startTime = this.ctx.currentTime;

    this.scheduleLoop();
    this.timerId = setInterval(() => this.scheduleLoop(), SCHEDULE_INTERVAL_MS);
  }

  pause(): void {
    if (!this.isRunning || this.isPaused) return;
    this.isPaused = true;
    if (!this.ctx) return;
    this.pausedAt = this.ctx.currentTime;
    this.elapsedBeforePause = this.pausedAt - this.startTime;
    if (this.timerId) { clearInterval(this.timerId); this.timerId = null; }
    this.emitUpdate();
  }

  resume(): void {
    if (!this.isPaused || this.pausedAt === null || !this.ctx) return;
    this.isPaused = false;
    this.startTime = this.ctx.currentTime - this.elapsedBeforePause;
    this.pausedAt = null;
    this.scheduleLoop();
    this.timerId = setInterval(() => this.scheduleLoop(), SCHEDULE_INTERVAL_MS);
    this.emitUpdate();
  }

  seek(targetMs: number): void {
    if (!this.ctx) return;
    const wasPaused = this.isPaused;
    if (this.timerId) { clearInterval(this.timerId); this.timerId = null; }
    this.scheduledBeats.clear();
    this.lastVoiceKey = '';
    this.voiceEndTime = 0;
    this.startTime = this.ctx.currentTime - targetMs / 1000;
    this.elapsedBeforePause = 0;
    this.pausedAt = null;
    this.isPaused = false;
    this.isRunning = true;
    this.scheduleLoop();
    this.timerId = setInterval(() => this.scheduleLoop(), SCHEDULE_INTERVAL_MS);
    if (wasPaused) {
      this.pause();
    }
  }

  stop(): void {
    this.isRunning = false;
    this.isPaused = false;
    if (this.timerId) { clearInterval(this.timerId); this.timerId = null; }
    this.scheduledBeats.clear();
  }

  destroy(): void {
    this.stop();
    if (this.ctx) { this.ctx.close(); this.ctx = null; }
    this.beatBuffers.clear();
    this.signalBuffers.clear();
    this.voiceBuffers.clear();
    this.initialized = false;
  }

  get elapsed(): number {
    if (!this.ctx) return 0;
    if (this.isPaused) return this.elapsedBeforePause * 1000;
    if (!this.isRunning) return 0;
    return (this.ctx.currentTime - this.startTime) * 1000;
  }

  // ---- 调度循环 ----

  private scheduleLoop(): void {
    if (!this.isRunning || this.isPaused || !this.ctx) return;
    const now = this.ctx.currentTime;
    const elapsedMs = (now - this.startTime) * 1000;
    this.totalElapsedMs = elapsedMs;

    let accumulatedMs = 0;
    let foundCurrent = false;

    for (const item of this.timeline) {
      if (item.type === 'end') {
        if (elapsedMs >= accumulatedMs) {
          this.isRunning = false;
          if (this.timerId) { clearInterval(this.timerId); this.timerId = null; }
          this.emitUpdate();
        }
        return;
      }

      const dur = item.type === 'action' || item.type === 'rest' ? item.duration : 0;
      const itemEnd = accumulatedMs + dur;

      if (elapsedMs >= accumulatedMs && elapsedMs < itemEnd && !foundCurrent) {
        foundCurrent = true;
        const remainingMs = itemEnd - elapsedMs;

        if (item.type === 'action') {
          this.currentActionName = item.name;
          this.currentPhase = item.phase;

          // 语音
          const voiceKey = `a_${accumulatedMs}`;
          if (voiceKey !== this.lastVoiceKey) {
            this.lastVoiceKey = voiceKey;
            const vdur = this.playVoice(item.name);
            this.voiceEndTime = now + vdur;
          }
        } else if (item.type === 'rest') {
          this.currentActionName = '休息中';

          const voiceKey = `r_${accumulatedMs}`;
          if (voiceKey !== this.lastVoiceKey) {
            this.lastVoiceKey = voiceKey;
            const vdur = this.playVoice('休息中');
            this.voiceEndTime = now + vdur;
          }
        }

        // 推送给 React
        this.emitUpdateWith(remainingMs);
      }

      // 安排节拍
      if (item.type === 'action' && itemEnd > elapsedMs) {
        this.scheduleBeats(item, accumulatedMs, itemEnd);
      }

      // 安排信号
      if (item.type === 'transition') {
        const signalTime = this.startTime + accumulatedMs / 1000;
        if (signalTime > now && signalTime < now + LOOK_AHEAD_MS / 1000) {
          this.playSignal(item.signal, signalTime);
        }
      }

      // 打响指：经过时立即播放
      if (item.type === 'snap' && elapsedMs >= accumulatedMs && elapsedMs < accumulatedMs + 500) {
        this.playSnap();
      }

      if (item.type === 'action' || item.type === 'rest') {
        accumulatedMs += item.duration;
      }
    }
  }

  private scheduleBeats(
    item: Extract<TimelineItem, { type: 'action' }>,
    offsetMs: number,
    endMs: number,
  ): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const bpm = item.bpm;
    const intervalMs = 60000 / bpm;
    const boostStart = endMs - BPM_BOOST_DURATION;

    for (let t = offsetMs; t < endMs; t += intervalMs) {
      let actualInterval = intervalMs;
      if (t >= boostStart) {
        actualInterval = 60000 / (bpm + BPM_BOOST_AMOUNT);
      }

      const absTime = this.startTime + t / 1000;

      // 语音期间不排节拍
      if (absTime < this.voiceEndTime) {
        if (t >= boostStart) t += actualInterval - intervalMs;
        continue;
      }

      const key = Math.round(absTime * 1000);
      if (absTime > now && absTime < now + LOOK_AHEAD_MS / 1000) {
        if (!this.scheduledBeats.has(key)) {
          this.scheduledBeats.add(key);
          this.playBeat(item.sound, absTime, item.volume);
        }
      }

      if (t >= boostStart) t += actualInterval - intervalMs;
    }
  }

  // ---- 音频播放 ----

  private playBeat(sound: SoundType, when: number, volume: number): void {
    if (!this.ctx) return;
    const buf = this.beatBuffers.get(sound);
    if (!buf) return;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const gain = this.ctx.createGain();
    gain.gain.value = volume;
    src.connect(gain).connect(this.ctx.destination);
    src.start(when);
  }

  private playSignal(signal: string, when: number): void {
    if (!this.ctx) return;
    const buf = this.signalBuffers.get(signal);
    if (!buf) return;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.connect(this.ctx.destination);
    src.start(when);
  }

  private playVoice(actionName: string): number {
    if (!this.ctx) return 0;
    const buf = this.voiceBuffers.get(actionName);
    if (!buf) return 0;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.connect(this.ctx.destination);
    const t = this.ctx.currentTime + 0.01;
    src.start(t);
    return buf.duration;
  }

  // ---- 语音加载 ----

  private async loadVoices(): Promise<void> {
    if (!this.ctx) return;
    const names = Object.keys(VOICE_MAP);
    await Promise.allSettled(
      names.map(async (name) => {
        try {
          const url = `${BASE}voices/${encodeURIComponent(VOICE_MAP[name])}`;
          const resp = await fetch(url);
          if (!resp.ok) return;
          const buf = await resp.arrayBuffer();
          const audioBuf = await this.ctx!.decodeAudioData(buf);
          this.voiceBuffers.set(name, audioBuf);
        } catch { /* skip */ }
      })
    );
  }

  // ---- 通知 React ----

  private emitUpdateWith(actionRemainingMs: number): void {
    if (!this.onUpdate) return;
    this.onUpdate({
      actionName: this.currentActionName,
      actionRemainingMs,
      totalElapsedMs: this.totalElapsedMs,
      phase: this.currentPhase,
      isPaused: this.isPaused,
    });
  }

  private emitUpdate(): void {
    if (!this.onUpdate) return;
    this.onUpdate({
      actionName: this.currentActionName || '准备中',
      actionRemainingMs: 0,
      totalElapsedMs: this.totalElapsedMs,
      phase: this.currentPhase,
      isPaused: this.isPaused,
    });
  }

  // ---- 信号音合成 ----

  private makeDing(count: 1 | 2): AudioBuffer {
    const sr = 44100;
    const dingLen = Math.ceil(0.3 * sr);
    const gapLen = Math.ceil(0.2 * sr);
    const total = count === 1 ? dingLen : dingLen + gapLen + dingLen;
    const buf = new AudioBuffer({ length: total, sampleRate: sr });
    const ch = buf.getChannelData(0);
    for (let i = 0; i < dingLen; i++) {
      const t = i / sr;
      const env = Math.exp(-t / 0.08);
      ch[i] = 0.4 * Math.sin(2 * Math.PI * 1200 * t) * env
        + 0.15 * Math.sin(2 * Math.PI * 2400 * t) * env;
    }
    if (count === 2) {
      const off = dingLen + gapLen;
      for (let i = 0; i < dingLen; i++) {
        const t = i / sr;
        ch[off + i] = 0.5 * Math.sin(2 * Math.PI * 1400 * t) * Math.exp(-t / 0.05);
      }
    }
    return buf;
  }

  private makeHeavyBeat(): AudioBuffer {
    const sr = 44100;
    const len = Math.ceil(0.8 * sr);
    const buf = new AudioBuffer({ length: len, sampleRate: sr });
    const ch = buf.getChannelData(0);
    for (let beat = 0; beat < 2; beat++) {
      const off = beat * Math.ceil(0.3 * sr);
      for (let i = 0; i < Math.ceil(0.3 * sr); i++) {
        const t = i / sr;
        const val = 0.6 * Math.sin(2 * Math.PI * (100 * Math.exp(-t * 8) + 30) * t) * Math.exp(-t / 0.1);
        if (off + i < len) ch[off + i] = val;
      }
    }
    return buf;
  }

  /** 合成打响指：极短噪声 + 带通滤波 */
  private makeSnap(): AudioBuffer {
    const sr = 44100;
    const len = Math.ceil(0.03 * sr); // 30ms
    const buf = new AudioBuffer({ length: len, sampleRate: sr });
    const ch = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      // 白噪声 × 指数衰减（极快的起音+衰减）
      const env = Math.exp(-t / 0.004); // 极快衰减
      ch[i] = (Math.random() * 2 - 1) * 0.6 * env;
    }
    return buf;
  }

  /** 播放打响指 */
  playSnap(): void {
    if (!this.ctx || !this.snapBuffer) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.snapBuffer;
    // 带通滤波器（3kHz 中心）
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 3000;
    filter.Q.value = 3;
    const gain = this.ctx.createGain();
    gain.gain.value = 0.5;
    src.connect(filter).connect(gain).connect(this.ctx.destination);
    src.start(this.ctx.currentTime + 0.005);
  }
}
