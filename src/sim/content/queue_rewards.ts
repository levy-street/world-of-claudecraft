// Character-only cosmetic bell finishes. No stats, inventory items or paid skins.
// Paused across all hosts; keep the saved-data catalog for existing characters.
export const QUEUE_REWARDS_ENABLED = false;
export const QUEUE_REWARDS = Object.freeze([
  Object.freeze({ id: 'bronze', cost: 20 }),
  Object.freeze({ id: 'silver', cost: 60 }),
  Object.freeze({ id: 'gold', cost: 120 }),
] as const);
export type QueueRewardId = (typeof QUEUE_REWARDS)[number]['id'];
export const QUEUE_BOSS_POINTS = 5;
export const QUEUE_COMPLETION_POINTS = 10;
export const QUEUE_DAILY_POINT_CAP = 60;
export const QUEUE_BALANCE_CAP = 1_000_000;
