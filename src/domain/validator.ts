// 七条硬性规则校验器（PRD v3 §4.5），纯函数，返回违规描述数组。

import { Orchestration, STAGE_ORDER } from './types'

export function validateOrchestration(o: Orchestration): string[] {
  const violations: string[] = []
  const push = (msg: string) => violations.push(msg)

  // 规则 1：单元内阶段顺序固定
  o.core.forEach((unit, ui) => {
    const names = unit.stages.map((s) => s.name)
    if (names.join(',') !== STAGE_ORDER.join(',')) {
      push(`单元 ${ui + 1} 阶段顺序错误：${names.join('→')}`)
    }
  })

  // 规则 2：引诱必须单侧（主导侧轻触，另侧空置）
  o.core.forEach((unit, ui) => {
    const seduce = unit.stages[0]
    if (!seduce) return
    const l = seduce.dominant === 'L'
    const activeSide = l ? seduce.left : seduce.right
    const idleSide = l ? seduce.right : seduce.left
    if (!(seduce.activity === 'left_only' || seduce.activity === 'right_only')) {
      push(`单元 ${ui + 1} 引诱段必须是单侧活动`)
    }
    if (activeSide.mode !== 'light-touch') {
      push(`单元 ${ui + 1} 引诱段主导侧必须轻触`)
    }
    if (idleSide.mode !== 'idle') {
      push(`单元 ${ui + 1} 引诱段另一侧必须空置`)
    }
  })

  // 规则 3：回落必须双侧同步：先乳晕摩擦 ↘（≥10s）后静置
  o.core.forEach((unit, ui) => {
    const rub = unit.stages.find((s) => s.name === 'cooldown_rub')
    const rest = unit.stages.find((s) => s.name === 'cooldown_rest')
    if (!rub || !rest) {
      push(`单元 ${ui + 1} 缺少回落两段`)
      return
    }
    if (
      rub.durationMs < 10_000 ||
      rub.left.mode !== 'areola-friction' ||
      rub.right.mode !== 'areola-friction'
    ) {
      push(`单元 ${ui + 1} 回落后段乳晕摩擦不足 10s 或非双侧同步`)
    }
    if (rest.left.mode !== 'rest' || rest.right.mode !== 'rest') {
      push(`单元 ${ui + 1} 回落静置段必须双侧静置`)
    }
  })

  // 规则 4：冲刺段禁止乳晕摩擦与静置
  o.sprint.substeps.forEach((step, si) => {
    if (
      step.left.mode === 'areola-friction' ||
      step.right.mode === 'areola-friction' ||
      step.left.mode === 'rest' ||
      step.right.mode === 'rest'
    ) {
      push(`冲刺子段 ${si + 1}(${step.name}) 出现乳晕摩擦或静置，违反冲刺规则`)
    }
  })

  // 规则 5：主导侧轮换
  for (let i = 0; i < o.core.length - 1; i++) {
    const a = o.core[i].stages[0]?.dominant
    const b = o.core[i + 1].stages[0]?.dominant
    if (a && b && a === b) {
      push(`单元 ${i + 1} 与 ${i + 2} 主导侧未轮换`)
    }
  }

  // 规则 6：静置只存在于核心回落静置，且核心 静置:有动作 ≈ 1:2
  let actionCoreMs = 0
  let restMs = 0
  for (const unit of o.core) {
    for (const stage of unit.stages) {
      if (stage.name === 'cooldown_rest') {
        restMs += stage.durationMs
        if (stage.left.mode !== 'rest' || stage.right.mode !== 'rest') {
          push(`单元 ${unit.index + 1} 静置段不是双侧静置`)
        }
      } else {
        actionCoreMs += stage.durationMs
      }
    }
  }
  if (restMs > 0 && actionCoreMs > 0) {
    const ratio = restMs / actionCoreMs
    // 1:2 -> 0.5；允许 ±15% 容差
    if (Math.abs(ratio - 0.5) / 0.5 > 0.15) {
      push(`核心段静置:有动作=${ratio.toFixed(3)}，偏离 1:2`)
    }
  }

  // 规则 7：总时长精确匹配（误差 ±5s）
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