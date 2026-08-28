// 六条硬性规则校验器（PRD §4.5 / 制作方案 §4.6），纯函数，返回违规描述数组。

import { Orchestration, STAGE_ORDER } from './types'

export function validateOrchestration(o: Orchestration): string[] {
  const violations: string[] = []
  const push = (msg: string) => violations.push(msg)

  // ── 规则 1：单元内阶段顺序固定不可重排 ──
  o.core.forEach((unit, ui) => {
    const names = unit.stages.map((s) => s.name)
    if (names.join(',') !== STAGE_ORDER.join(',')) {
      push(`单元 ${ui + 1} 阶段顺序错误：${names.join('→')}`)
    }
  })

  // ── 规则 2：引诱必须非对称（主导侧轻触 + 辅助侧乳晕摩擦） ──
  o.core.forEach((unit, ui) => {
    const seduce = unit.stages[0]
    if (!seduce) return
    if (seduce.symmetry !== 'full-asymmetric') {
      push(`单元 ${ui + 1} 引诱段必须完全非对称`)
    }
    if (seduce.left.mode === seduce.right.mode) {
      push(`单元 ${ui + 1} 引诱段双侧模式相同，违反“对比产生预期张力”`)
    }
    const l = seduce.dominant === 'L'
    const dominantSide = l ? seduce.left : seduce.right
    const assistSide = l ? seduce.right : seduce.left
    if (dominantSide.mode !== 'light-touch') {
      push(`单元 ${ui + 1} 引诱段主导侧必须轻触`)
    }
    if (assistSide.mode !== 'areola-friction') {
      push(`单元 ${ui + 1} 引诱段辅助侧必须乳晕摩擦`)
    }
  })

  // ── 规则 3：核心单元释放后必须双侧对称乳晕摩擦 ≥10s ──
  o.core.forEach((unit, ui) => {
    const releaseIdx = unit.stages.findIndex((s) => s.name === 'release')
    const cooldown = unit.stages[releaseIdx + 1]
    if (!cooldown || cooldown.name !== 'cooldown') {
      push(`单元 ${ui + 1} 释放后缺少回落阶段`)
      return
    }
    if (
      cooldown.durationMs < 10_000 ||
      cooldown.left.mode !== 'areola-friction' ||
      cooldown.right.mode !== 'areola-friction'
    ) {
      push(`单元 ${ui + 1} 回落实测不足 10s 双侧对称乳晕摩擦`)
    }
  })

  // ── 规则 4：冲刺段禁止乳晕摩擦 ──
  o.sprint.substeps.forEach((step, si) => {
    if (step.left.mode === 'areola-friction' || step.right.mode === 'areola-friction') {
      push(`冲刺子段 ${si + 1}(${step.name}) 出现乳晕摩擦，违反冲刺禁止摩擦`)
    }
  })

  // ── 规则 5：相邻单元主导侧必须轮换 ──
  for (let i = 0; i < o.core.length - 1; i++) {
    const a = o.core[i].stages[0]?.dominant
    const b = o.core[i + 1].stages[0]?.dominant
    if (a && b && a === b) {
      push(`单元 ${i + 1} 与 ${i + 2} 主导侧未轮换`)
    }
  }

  // ── 规则 6：总时长精确匹配（误差 ±5s） ──
  let counted = o.warmup.durationMs
  for (const unit of o.core) {
    for (const stage of unit.stages) counted += stage.durationMs
  }
  for (const step of o.sprint.substeps) counted += step.durationMs
  for (const t of o.transitions) counted += t.durMs
  if (Math.abs(counted - o.totalMs) > 5_000) {
    push(`总时长不匹配：Σ=${counted}ms，目标=${o.totalMs}ms，差 ${Math.abs(counted - o.totalMs)}ms`)
  }

  // 附加：冲刺结构完整
  const sprintNames = o.sprint.substeps.map((s) => s.sub)
  if (
    sprintNames.join(',') !==
    ['pushoff', 'ramp', 'peak', 'plateau', 'taper'].join(',')
  ) {
    push(`冲刺子段缺失/顺序错误：${sprintNames.join('→')}`)
  }

  return violations
}

export function isValidOrchestration(o: Orchestration): boolean {
  return validateOrchestration(o).length === 0
}