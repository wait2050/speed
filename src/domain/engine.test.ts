import { describe, expect, it } from 'vitest'
import { computeMinFeasibleSec, generateOrchestration } from './engine'
import { isValidOrchestration, validateOrchestration } from './validator'
import { defaultSettings } from './types'

describe('编排引擎 · 可行性边界', () => {
  it('过短时长被拒绝并返回最小可生成时长', () => {
    const r = generateOrchestration(60, defaultSettings(), 1)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error.code).toBe('TOO_SHORT')
      expect(r.error.minFeasibleSec).toBeGreaterThan(60)
    }
  })

  it('最小可生成时长前后有正确分界', () => {
    const min = computeMinFeasibleSec()
    const below = generateOrchestration(min - 1, defaultSettings(), 2)
    const at = generateOrchestration(min, defaultSettings(), 2)
    expect(below.ok).toBe(false)
    expect(at.ok).toBe(true)
  })
})

describe('编排引擎 · 时长网格生成与六规则校验', () => {
  const feasibleMinutes = [10, 15, 20, 30, 60]

  feasibleMinutes.forEach((minutes) => {
    it(`${minutes} 分钟编排满足全部硬性规则且时长精确`, () => {
      const r = generateOrchestration(minutes * 60, defaultSettings(), 42)
      expect(r.ok).toBe(true)
      if (!r.ok) return
      const o = r.orchestration
      const violations = validateOrchestration(o)
      expect(violations).toEqual([])
      expect(isValidOrchestration(o)).toBe(true)
      expect(Math.abs(o.totalMs / 1000 - minutes * 60)).toBeLessThanOrEqual(5)
      // 核心单元 2-4
      expect(o.core.length).toBeGreaterThanOrEqual(2)
      expect(o.core.length).toBeLessThanOrEqual(4)
      // 冲刺五段
      expect(o.sprint.substeps).toHaveLength(5)
    })
  })

  it('1 分钟和 5 分钟被拒绝（过短）', () => {
    expect(generateOrchestration(60, defaultSettings(), 3).ok).toBe(false)
    expect(generateOrchestration(300, defaultSettings(), 3).ok).toBe(false)
  })
})

describe('编排引擎 · 可复现与随机性', () => {
  it('同 seed 生成相同单元结构', () => {
    const a = generateOrchestration(1200, defaultSettings(), 99)
    const b = generateOrchestration(1200, defaultSettings(), 99)
    expect(a.ok).toBe(true)
    expect(b.ok).toBe(true)
    if (!a.ok || !b.ok) return
    const stagesA = a.orchestration.core.map((u) =>
      u.stages.map((s) => s.durationMs),
    )
    const stagesB = b.orchestration.core.map((u) =>
      u.stages.map((s) => s.durationMs),
    )
    expect(stagesA).toEqual(stagesB)
  })

  it('不同 seed 通常产生不同时长（宽松断言，允许极小概率相同）', () => {
    const a = generateOrchestration(1800, defaultSettings(), 7)
    const b = generateOrchestration(1800, defaultSettings(), 8)
    expect(a.ok).toBe(true)
    expect(b.ok).toBe(true)
    if (!a.ok || !b.ok) return
    const key = (o: typeof a.orchestration) =>
      o.core.map((u) => u.stages.map((s) => s.durationMs).join(',')).join('|')
    // 100 次里几乎不可能完全一致；这里仅要求至少一次有差异以暴露“无随机”实现
    let diff = false
    for (let i = 0; i < 20; i++) {
      const x = generateOrchestration(1800, defaultSettings(), 100 + i)
      if (x.ok && key(x.orchestration) !== key(a.orchestration)) {
        diff = true
        break
      }
    }
    expect(diff).toBe(true)
  })
})

describe('编排引擎 · 六规则定向验证', () => {
  it('对刻意篡改的编排能报出违规', () => {
    const r = generateOrchestration(1200, defaultSettings(), 1)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const bad = structuredClone(r.orchestration)
    // 违反规则 1：打乱阶段顺序
    const unit0 = bad.core[0]
    unit0.stages.reverse()
    // 违反规则 2：引诱改对称
    const unit1 = bad.core[1]
    unit1.stages[0].left.mode = unit1.stages[0].right.mode
    unit1.stages[0].symmetry = 'full-symmetric'
    const violations = validateOrchestration(bad)
    expect(violations.length).toBeGreaterThan(0)
    expect(violations.some((v) => v.includes('阶段顺序'))).toBe(true)
    expect(violations.some((v) => v.includes('引诱'))).toBe(true)
  })
})