// 可复现的伪随机数：mulberry32（同 seed 生成相同编排）

export type Rng = () => number

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function randomInt(rng: Rng, min: number, max: number): number {
  return Math.floor(rng() * (max - min + 1)) + min
}

export function randomBetween(rng: Rng, min: number, max: number): number {
  return min + rng() * (max - min)
}

export function pick<T>(rng: Rng, arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length)]
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/** 按比例缩放一组秒数，使总和精确等于 targetSec，返回毫秒数组 */
export function scaleToTarget(valuesSec: number[], targetSec: number): number[] {
  const sum = valuesSec.reduce((a, b) => a + b, 0)
  if (sum <= 0) return valuesSec.map(() => 0)
  const scaled = valuesSec.map((v) => (v / sum) * targetSec)
  const ms = scaled.map((v) => Math.round(v * 1000))
  const diffMs = Math.round(targetSec * 1000) - ms.reduce((a, b) => a + b, 0)
  // 把差值回填到最后一个元素
  if (ms.length > 0) ms[ms.length - 1] += diffMs
  return ms
}