// ============================================================
// 序列编译器 · 主函数
// ============================================================
import type {
  CompiledSequence, TimelineItem, SoundType,
  Phase, UserPreferences, SpeedTier,
} from '../types';
import {
  WARMUP_ACTION_MIN, WARMUP_ACTION_MAX, WARMUP_REST,
  CORE_ACTION_MIN, CORE_ACTION_MAX, CORE_REST,
  SPRINT_ACTION_MAX, SPRINT_REST, MICRO_REST,
  CLIMAX_DURATION, AFTERGLOW_DURATION, COOLDOWN_DURATION,
  MIN_RECOMMENDED_DURATION, TOTAL_TOLERANCE,
  WARMUP_RATIO, CORE_RATIO, SPRINT_RATIO,
  WARMUP_VOLUME, CORE_VOLUME, SPRINT_VOLUME,
  CLIMAX_VOLUME, AFTERGLOW_VOLUME, COOLDOWN_VOLUME,
  WARMUP_BPM, SPRINT_START_BPM, SPRINT_ACCEL_BPM,
  SPRINT_PEAK_BPM, CLIMAX_BPM, AFTERGLOW_BPM,
  COOLDOWN_INTERVAL,
} from './rules';
import {
  weightedPick, pickTop, pickBasic, ALL_ACTIONS,
} from './pools';

// --- 主编译函数 ---
export function compileSequence(
  totalDurationMs: number,
  prefs: UserPreferences,
  lockedActions?: Map<number, string>
): CompiledSequence {
  const timeline: TimelineItem[] = [];

  // 1. 终局序列固定时长
  const FINALE_DURATION = CLIMAX_DURATION + AFTERGLOW_DURATION + COOLDOWN_DURATION;

  // 2. 短周期模式：<10分钟，仅热身+核心+终局，不单独分配冲刺
  const isShortMode = totalDurationMs < MIN_RECOMMENDED_DURATION;

  // 3. 剩余时长
  const remaining = totalDurationMs - FINALE_DURATION;
  if (remaining <= 0) {
    throw new Error(`总时长过短（至少需要 ${Math.ceil(FINALE_DURATION / 60000)} 分钟）`);
  }

  // 4. 比例分配
  let warmupBudget: number, coreBudget: number, sprintBudget: number;
  if (isShortMode) {
    // 短周期：热身30%，核心70%，不独立分冲刺
    warmupBudget = remaining * 0.30;
    coreBudget = remaining * 0.70;
    sprintBudget = 0;
  } else {
    warmupBudget = remaining * WARMUP_RATIO;
    coreBudget = remaining * CORE_RATIO;
    sprintBudget = remaining * SPRINT_RATIO;
  }

  const phaseMap = new Map<Phase, SoundType>();
  phaseMap.set('warmup', prefs.customSounds.slow);
  phaseMap.set('core', prefs.customSounds.slow);
  phaseMap.set('sprint_start', prefs.customSounds.medium);
  phaseMap.set('sprint_accel', prefs.customSounds.fast);
  phaseMap.set('sprint_peak', prefs.customSounds.extreme);
  phaseMap.set('climax', prefs.customSounds.extreme);
  phaseMap.set('afterglow', prefs.customSounds.fast);
  phaseMap.set('cooldown', prefs.customSounds.cooldown);

  let warmupRounds = 0;
  let coreRounds = 0;
  let sprintRounds = 0;

  // ---- 热身阶段 ----
  {
    let filled = 0;
    while (filled < warmupBudget) {
      const action = pickBasic();
      // 使用用户自定义慢速BPM
      const bpm = prefs.customBpm.slow;
      const dur = randInRange(WARMUP_ACTION_MIN, WARMUP_ACTION_MAX);
      timeline.push(makeAction(action.name, dur, bpm, prefs.customSounds.slow, WARMUP_VOLUME, 'warmup'));
      filled += dur;

      if (filled + WARMUP_REST <= warmupBudget || filled < warmupBudget - 5000) {
        timeline.push({ type: 'rest', duration: WARMUP_REST, phase: 'warmup' });
        filled += WARMUP_REST;
      }
      warmupRounds++;
    }
  }

  // 阶段切换信号: 热身→核心
  timeline.push({ type: 'transition', signal: 'single_ding', phase: 'core' });

  // ---- 核心阶段 ----
  {
    let filled = 0;
    while (filled < coreBudget) {
      // 从全部动作池加权抽取（锁定动作在 UI 层处理，此处始终用全池）
      const action = weightedPick(ALL_ACTIONS);

      const dur = randInRange(CORE_ACTION_MIN, CORE_ACTION_MAX);
      // 核心阶段音色：慢速用woodblock，快速用heartbeat
      const sound: SoundType = action.speedTier === 'slow'
        ? (prefs.customSounds.slow)
        : (prefs.customSounds.fast);
      const bpm = action.speedTier === 'slow'
        ? prefs.customBpm.slow
        : prefs.customBpm.fast;

      timeline.push(makeAction(action.name, dur, bpm, sound, CORE_VOLUME, 'core'));
      filled += dur;

      if (filled + CORE_REST <= coreBudget || filled < coreBudget - 5000) {
        timeline.push({ type: 'rest', duration: CORE_REST, phase: 'core' });
        filled += CORE_REST;
      }
      coreRounds++;
    }
  }

  // ---- 冲刺阶段（非短周期模式）----
  if (!isShortMode && sprintBudget > 0) {
    // 阶段切换: 核心→冲刺
    timeline.push({ type: 'transition', signal: 'double_ding', phase: 'sprint_start' });

    const third = sprintBudget / 3;

    // 起冲段
    {
      let filled = 0;
      while (filled < third) {
        const action = pickTop();
        const dur = Math.min(randInRange(SPRINT_ACTION_MAX - 10000, SPRINT_ACTION_MAX), SPRINT_ACTION_MAX);
        timeline.push(makeAction(action.name, dur, SPRINT_START_BPM, prefs.customSounds.medium, SPRINT_VOLUME, 'sprint_start'));
        filled += dur;
        if (filled + SPRINT_REST <= third) {
          timeline.push({ type: 'rest', duration: SPRINT_REST, phase: 'sprint_start' });
          filled += SPRINT_REST;
        }
        sprintRounds++;
      }
    }

    // 加速段
    {
      let filled = 0;
      while (filled < third) {
        const action = pickTop();
        const dur = Math.min(randInRange(SPRINT_ACTION_MAX - 10000, SPRINT_ACTION_MAX), SPRINT_ACTION_MAX);
        timeline.push(makeAction(action.name, dur, SPRINT_ACCEL_BPM, prefs.customSounds.fast, SPRINT_VOLUME, 'sprint_accel'));
        filled += dur;
        if (filled + SPRINT_REST <= third) {
          timeline.push({ type: 'rest', duration: SPRINT_REST, phase: 'sprint_accel' });
          filled += SPRINT_REST;
        }
        sprintRounds++;
      }
    }

    // 顶峰段（每60秒8秒微休息）
    {
      let filled = 0;
      while (filled < third) {
        const action = pickTop();
        const segDur = Math.min(SPRINT_ACTION_MAX, third - filled);
        const dur = Math.min(randInRange(30000, segDur), SPRINT_ACTION_MAX);
        timeline.push(makeAction(action.name, dur, SPRINT_PEAK_BPM, prefs.customSounds.extreme, SPRINT_VOLUME, 'sprint_peak'));
        filled += dur;

        // 每60秒插入微休息
        if (filled % 60000 < (dur % 60000) || filled >= 60000) {
          const remainingInBlock = third - filled;
          if (remainingInBlock > MICRO_REST + 5000) {
            timeline.push({ type: 'rest', duration: MICRO_REST, phase: 'sprint_peak' });
            filled += MICRO_REST;
          }
        }
        sprintRounds++;
      }
    }

    // 顶峰→高潮信号
    timeline.push({ type: 'transition', signal: 'heavy_beats', phase: 'climax' });
  } else if (isShortMode) {
    // 短周期：核心→高潮
    timeline.push({ type: 'transition', signal: 'double_ding', phase: 'climax' });
  }

  // ---- 终局序列 ----
  // 高潮冲刺
  const climaxAction = pickTop();
  timeline.push(makeAction(climaxAction.name, CLIMAX_DURATION, prefs.customBpm.extreme, prefs.customSounds.extreme, CLIMAX_VOLUME, 'climax'));

  // 高潮后持续
  const afterglowAction = pickTop();
  timeline.push(makeAction(afterglowAction.name, AFTERGLOW_DURATION, prefs.customBpm.fast, prefs.customSounds.fast, AFTERGLOW_VOLUME, 'afterglow'));

  // 收尾段（每3秒一个单音）
  timeline.push(makeAction('收尾缓冲', COOLDOWN_DURATION, Math.round(60000 / COOLDOWN_INTERVAL), prefs.customSounds.cooldown, COOLDOWN_VOLUME, 'cooldown'));

  // 结束标记
  timeline.push({ type: 'end' });

  // ---- 计算统计 ----
  const stats = computeStats(timeline, warmupRounds, coreRounds, sprintRounds);

  return { timeline, stats };
}

// --- 辅助函数 ---

function makeAction(
  name: string,
  durationMs: number,
  bpm: number,
  sound: SoundType,
  volume: number,
  phase: Phase,
): TimelineItem {
  return {
    type: 'action',
    name,
    duration: durationMs,
    bpm,
    sound,
    volume,
    phase,
  };
}

function randInRange(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function computeStats(
  timeline: TimelineItem[],
  warmupRounds: number,
  coreRounds: number,
  sprintRounds: number,
) {
  let totalActionDuration = 0;
  let totalRestDuration = 0;
  let rounds = 0;

  for (const item of timeline) {
    if (item.type === 'action') {
      totalActionDuration += item.duration;
      rounds++;
    } else if (item.type === 'rest') {
      totalRestDuration += item.duration;
    }
  }

  return {
    totalDuration: totalActionDuration + totalRestDuration,
    totalActionDuration,
    totalRestDuration,
    rounds,
    warmupRounds,
    coreRounds,
    sprintRounds,
  };
}

// --- 验证函数 ---
export function validateSequence(seq: CompiledSequence, targetMs: number): string[] {
  const errors: string[] = [];
  const { timeline, stats } = seq;

  // 总时长误差
  const diff = Math.abs(stats.totalDuration - targetMs);
  if (diff > TOTAL_TOLERANCE) {
    errors.push(`总时长误差 ${diff}ms 超出容差 ${TOTAL_TOLERANCE}ms`);
  }

  // 动作-休息交替规则（高潮冲刺和余韵除外）
  let prevType: 'action' | 'rest' | null = null;
  let inClimaxOrAfter = false;

  for (const item of timeline) {
    if (item.type === 'end' || item.type === 'transition') {
      if (item.type === 'transition') prevType = null;
      continue;
    }

    // 跟踪是否在终局连续区
    if (item.type === 'action' && (item.phase === 'climax' || item.phase === 'afterglow')) {
      inClimaxOrAfter = true;
    } else if (item.type === 'action' && item.phase !== 'climax' && item.phase !== 'afterglow') {
      inClimaxOrAfter = false;
    }

    if (item.type === 'action') {
      if (prevType === 'action' && !inClimaxOrAfter && item.phase !== 'cooldown') {
        errors.push(`动作 ${item.name} 前未插入休息`);
      }
      // 动作时长范围
      if (item.phase === 'climax') {
        if (item.duration < CLIMAX_DURATION - TOTAL_TOLERANCE) {
          errors.push(`高潮冲刺时长 ${item.duration}ms 不足 3 分钟`);
        }
      } else if (item.phase !== 'afterglow') {
        if (item.duration < 30000 || item.duration > 90000) {
          errors.push(`动作 ${item.name} 时长 ${item.duration}ms 超出 30~90秒范围`);
        }
      }
      prevType = 'action';
    } else if (item.type === 'rest') {
      // 微休息是例外：可短至8秒
      const isMicroRest = item.duration <= MICRO_REST + 1000;
      if (!isMicroRest && (item.duration < 10000 || item.duration > 20000)) {
        errors.push(`休息时长 ${item.duration}ms 超出 10~20秒范围`);
      }
      prevType = 'rest';
    }
  }

  return errors;
}
