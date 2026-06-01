// ============================================================
// 音频引擎 — AudioContext 管理 + 预缓存 + 节拍/信号调度
// ============================================================
import type { SoundType } from '../types';
import {
  synthesizeTick,
  synthesizeWoodblock,
  synthesizeHeartbeat,
  synthesizeWaterdrop,
  synthesizeFingertap,
  synthesizeBassdrum,
} from './sounds';

export class AudioEngine {
  ctx: AudioContext | null = null;
  private buffers = new Map<SoundType, AudioBuffer>();
  private signalBuffers = new Map<string, AudioBuffer>();
  private initialized = false;

  constructor() {
    // Defer AudioContext creation to first user interaction
  }

  /** 懒初始化 — 必须在用户手势后调用 */
  async init(): Promise<void> {
    if (this.initialized) return;

    this.ctx = new AudioContext({ sampleRate: 44100 });

    // 预缓存所有音色
    this.buffers.set('tick', synthesizeTick());
    this.buffers.set('woodblock', synthesizeWoodblock());
    this.buffers.set('heartbeat', synthesizeHeartbeat());
    this.buffers.set('waterdrop', synthesizeWaterdrop());
    this.buffers.set('fingertap', synthesizeFingertap());
    this.buffers.set('bassdrum', synthesizeBassdrum());

    // 预合成信号音
    this.signalBuffers.set('single_ding', this.makeDing(1));
    this.signalBuffers.set('double_ding', this.makeDing(2));
    this.signalBuffers.set('heavy_beats', this.makeHeavyBeat());

    this.initialized = true;
  }

  get currentTime(): number {
    return this.ctx?.currentTime ?? 0;
  }

  /** 恢复AudioContext（从挂起状态） */
  async resume(): Promise<void> {
    if (this.ctx?.state === 'suspended') {
      await this.ctx.resume();
    }
  }

  /** 在指定时间播放一个节拍音 */
  scheduleBeat(sound: SoundType, when: number, volume = 1): void {
    if (!this.ctx || !this.initialized) return;
    const buf = this.buffers.get(sound);
    if (!buf) return;

    const src = this.ctx.createBufferSource();
    src.buffer = buf;

    const gain = this.ctx.createGain();
    gain.gain.value = volume;

    src.connect(gain);
    gain.connect(this.ctx.destination);

    src.start(when);
  }

  /** 播放阶段切换信号 */
  scheduleSignal(signal: 'single_ding' | 'double_ding' | 'heavy_beats', when: number): void {
    if (!this.ctx || !this.initialized) return;
    const buf = this.signalBuffers.get(signal);
    if (!buf) return;

    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.connect(this.ctx.destination);
    src.start(when);
  }

  /** 立即试听一个节拍 */
  previewBeat(sound: SoundType, volume = 0.5): void {
    if (!this.ctx || !this.initialized) return;
    this.resume().catch(() => {});
    if (sound === 'fingertap') {
      this.scheduleBeatWithFilter(sound, this.ctx.currentTime + 0.01, volume);
      return;
    }
    this.scheduleBeat(sound, this.ctx.currentTime + 0.01, volume);
  }

  private scheduleBeatWithFilter(sound: SoundType, when: number, volume: number): void {
    if (!this.ctx || !this.initialized) return;
    const buf = this.buffers.get(sound);
    if (!buf) return;

    const src = this.ctx.createBufferSource();
    src.buffer = buf;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 2000;
    filter.Q.value = 1.0;

    const gain = this.ctx.createGain();
    gain.gain.value = volume;

    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.ctx.destination);
    src.start(when);
  }

  destroy(): void {
    if (this.ctx) {
      this.ctx.close();
      this.ctx = null;
    }
    this.buffers.clear();
    this.signalBuffers.clear();
    this.initialized = false;
  }

  // --- 信号音合成 ---
  private makeDing(count: 1 | 2): AudioBuffer {
    const sampleRate = 44100;
    const dingLen = Math.ceil(0.3 * sampleRate);
    const gapLen = Math.ceil(0.2 * sampleRate);
    const totalLen = count === 1 ? dingLen : dingLen + gapLen + dingLen;
    const buf = new AudioBuffer({ length: totalLen, sampleRate });
    const ch = buf.getChannelData(0);

    // First ding
    for (let i = 0; i < dingLen; i++) {
      const t = i / sampleRate;
      const env = Math.exp(-t / 0.08);
      ch[i] = 0.4 * Math.sin(2 * Math.PI * 1200 * t) * env
        + 0.15 * Math.sin(2 * Math.PI * 2400 * t) * env;
    }

    // Second ding
    if (count === 2) {
      const offset = dingLen + gapLen;
      for (let i = 0; i < dingLen; i++) {
        const t = i / sampleRate;
        const env = Math.exp(-t / 0.05);
        ch[offset + i] = 0.5 * Math.sin(2 * Math.PI * 1400 * t) * env;
      }
    }

    return buf;
  }

  private makeHeavyBeat(): AudioBuffer {
    const sampleRate = 44100;
    const len = Math.ceil(0.8 * sampleRate);
    const buf = new AudioBuffer({ length: len, sampleRate });
    const ch = buf.getChannelData(0);

    // Two heavy drum hits
    for (let beat = 0; beat < 2; beat++) {
      const offset = beat * Math.ceil(0.3 * sampleRate);
      for (let i = 0; i < Math.ceil(0.3 * sampleRate); i++) {
        const t = i / sampleRate;
        const freq = 100 * Math.exp(-t * 8) + 30;
        const env = Math.exp(-t / 0.1);
        const val = 0.6 * Math.sin(2 * Math.PI * freq * t) * env;
        const idx = offset + i;
        if (idx < len) ch[idx] = val;
      }
    }
    return buf;
  }
}

// 单例
export const audioEngine = new AudioEngine();
