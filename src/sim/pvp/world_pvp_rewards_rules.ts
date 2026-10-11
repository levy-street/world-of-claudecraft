// Bounded played-time streak and reward math. No clocks, I/O or mutable globals.

import { TICK_RATE } from '../types';
import type { WorldPvpMetaState } from './world_pvp';

export const WORLD_PVP_TITLE_THRESHOLDS = [
  { id: 'pvp_flag_1h', hours: 1 },
  { id: 'pvp_flag_3h', hours: 3 },
  { id: 'pvp_flag_6h', hours: 6 },
  { id: 'pvp_flag_24h', hours: 24 },
  { id: 'pvp_flag_168h', hours: 168 },
] as const;
export const WORLD_PVP_MAX_REWARD_TICKS = 168 * 3600 * TICK_RATE;

export function worldPvpRewardsActive(state: WorldPvpMetaState | undefined): boolean {
  return state?.flagged === true && state.disarmAt === null;
}

export function sanitizeWorldPvpRewardTicks(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(WORLD_PVP_MAX_REWARD_TICKS, Math.max(0, Math.floor(value)))
    : 0;
}
