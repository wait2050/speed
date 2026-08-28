// 语音播报控制器：预生成 TTS m4a 片段，阶段首事件触发播放
const PROMPT_TO_FILE: Record<string, string> = {
  '引诱，左侧轻触': 'seduce_L',
  '引诱，右侧轻触': 'seduce_R',
  '蓄力，乳晕摩擦升温，然后点按': 'charge',
  '攀爬，左侧全覆盖滑动': 'climb_L',
  '攀爬，右侧全覆盖滑动': 'climb_R',
  '释放，双侧同步全覆盖': 'release',
  '回落，双侧乳晕摩擦降温': 'cooldown_rub',
  '静置，双手休息': 'cooldown_rest',
  '冲刺开始，双侧全覆盖滑动': 'sprint_pushoff',
  '加速，全覆盖旋转': 'sprint_ramp',
  '波峰，左右交替': 'sprint_peak',
  '高位持续，慢下来': 'sprint_plateau',
  '收尾，轻触': 'sprint_taper',
}

export class VoiceController {
  private audioCache = new Map<string, HTMLAudioElement>()
  private timers: number[] = []
  private volume = 0.6

  setVolume(v: number): void {
    this.volume = v
  }

  schedule(prompt: string, whenSec: number, ctx: AudioContext): void {
    const file = PROMPT_TO_FILE[prompt]
    if (!file) return
    const delayMs = Math.max(0, (whenSec - ctx.currentTime) * 1000)
    const timer = window.setTimeout(() => this.play(file), delayMs)
    this.timers.push(timer)
  }

  play(file: string): void {
    let audio = this.audioCache.get(file)
    if (!audio) {
      audio = new Audio(`voices/${file}.m4a`)
      audio.volume = this.volume
      audio.preload = 'auto'
      this.audioCache.set(file, audio)
    } else {
      audio.currentTime = 0
    }
    void audio.play().catch(() => undefined)
  }

  dispose(): void {
    for (const t of this.timers) clearTimeout(t)
    this.timers = []
    this.audioCache.forEach((a) => {
      a.pause()
      a.src = ''
    })
    this.audioCache.clear()
  }
}