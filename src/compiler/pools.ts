// ============================================================
// 动作池定义
// ============================================================
import type { ActionDef } from '../types';

// --- 快感最强（可直接达到高潮） ---
const TOP_ACTIONS: ActionDef[] = [
  {
    name: '从上方和下方捏住并旋转',
    intensity: 1,
    speedTier: 'slow',
    baseDuration: 60,
    floatRange: 10,
  },
  {
    name: '隔着内衣用指甲抓挠',
    intensity: 1,
    speedTier: 'fast',
    baseDuration: 45,
    floatRange: 5,
  },
];

// --- 快感次强 ---
const STRONG_ACTIONS: ActionDef[] = [
  {
    name: '捏住并不断变换力度',
    intensity: 2,
    speedTier: 'slow',
    baseDuration: 60,
    floatRange: 10,
  },
  {
    name: '捏住并轻轻向外侧拉',
    intensity: 2,
    speedTier: 'slow',
    baseDuration: 55,
    floatRange: 10,
  },
  {
    name: '夹住周围区域',
    intensity: 2,
    speedTier: 'slow',
    baseDuration: 50,
    floatRange: 10,
  },
];

// --- 基础动作 ---
const BASIC_ACTIONS: ActionDef[] = [
  {
    name: '用指腹温柔摩擦',
    intensity: 3,
    speedTier: 'slow',
    baseDuration: 50,
    floatRange: 10,
  },
  {
    name: '用指甲拨动',
    intensity: 3,
    speedTier: 'slow',
    baseDuration: 50,
    floatRange: 5,
  },
  {
    name: '按压',
    intensity: 3,
    speedTier: 'slow',
    baseDuration: 60,
    floatRange: 10,
  },
  {
    name: '振动手指',
    intensity: 3,
    speedTier: 'fast',
    baseDuration: 40,
    floatRange: 5,
  },
  {
    name: '反复碰触',
    intensity: 3,
    speedTier: 'fast',
    baseDuration: 35,
    floatRange: 5,
  },
  {
    name: '摩擦周围区域',
    intensity: 3,
    speedTier: 'slow',
    baseDuration: 50,
    floatRange: 10,
  },
  {
    name: '摩擦目标区域和周围区域',
    intensity: 3,
    speedTier: 'slow',
    baseDuration: 50,
    floatRange: 10,
  },
];

export const ALL_ACTIONS: ActionDef[] = [
  ...TOP_ACTIONS,
  ...STRONG_ACTIONS,
  ...BASIC_ACTIONS,
];

export const ACTION_POOLS = {
  top: TOP_ACTIONS,
  strong: STRONG_ACTIONS,
  basic: BASIC_ACTIONS,
  warmup: BASIC_ACTIONS,          // 热身仅基础动作
  core: ALL_ACTIONS,               // 核心全部动作
  sprint: [...TOP_ACTIONS],        // 冲刺优先最强
  climax: TOP_ACTIONS,             // 高潮固定最强
} as const;

// --- 编排抽取权重 ---
// 核心阶段：最强 0.4，次强 0.35，基础 0.25
export function weightedPick(actions: ActionDef[]): ActionDef {
  // 如果只有基础动作，直接随机
  const hasTop = actions.some(a => a.intensity === 1);
  const hasStrong = actions.some(a => a.intensity === 2);

  if (!hasTop && !hasStrong) {
    return actions[Math.floor(Math.random() * actions.length)];
  }

  const pool: ActionDef[] = [];
  for (const a of actions) {
    let copies = 0;
    if (a.intensity === 1) copies = 40;     // 40%
    else if (a.intensity === 2) copies = 35; // 35%
    else copies = 25;                         // 25%
    for (let i = 0; i < copies; i++) pool.push(a);
  }
  return pool[Math.floor(Math.random() * pool.length)];
}

// 冲刺阶段：只选最强
export function pickTop(): ActionDef {
  return TOP_ACTIONS[Math.floor(Math.random() * TOP_ACTIONS.length)];
}

// 热身阶段：从基础动作随机
export function pickBasic(): ActionDef {
  return BASIC_ACTIONS[Math.floor(Math.random() * BASIC_ACTIONS.length)];
}
