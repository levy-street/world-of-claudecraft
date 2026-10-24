// One bounded counter per connected character, driven only by simulation ticks.
import { DUNGEON_X_THRESHOLD } from '../data';
import type { SimContext } from '../sim_context';
import type { Entity } from '../types';
import { TICK_RATE } from '../types';
import {
  WORLD_PVP_MAX_REWARD_TICKS,
  WORLD_PVP_TITLE_THRESHOLDS,
  worldPvpRewardsActive,
} from './world_pvp_rewards_rules';
import type { WorldPvpZonePolicy } from './world_pvp_rules';
import { worldPvpZonePolicyAt } from './world_pvp_zones';

/** Why a flagged player banks no streak time right now. */
export type WorldPvpRewardPauseCause = 'dead' | 'instance' | 'sanctuary';

/**
 * Why the armed streak does not tick for this player where they are now, or
 * null when it does. The streak rewards time spent where a flagged rival can
 * reach you, so it pauses wherever nobody can: dead (a corpse, or a released
 * ghost, which keeps `dead`), inside a PvE instance (dungeon, raid, delve,
 * rift, maze: all on the far-east plane past DUNGEON_X_THRESHOLD), and on
 * sanctuary ground. Without these a flagged player could lie dead or park in
 * a private dungeon copy and bank the titles risk-free. `zone` is the policy
 * at the player's position when the caller already holds it; otherwise it is
 * read only for a living player on open-world ground. Seated battleground
 * and arena participants (including Fiesta and Protect Yumi) keep accruing
 * while alive, including preparation and the match's return countdown.
 * Membership uses at most two keyed probes, never a walk of the match books.
 */
export function worldPvpRewardPause(
  ctx: Pick<SimContext, 'bgMatches' | 'arenaMatches'>,
  e: Pick<Entity, 'id' | 'dead' | 'pos'>,
  zone?: WorldPvpZonePolicy,
): WorldPvpRewardPauseCause | null {
  if (e.dead) return 'dead';
  if (e.pos.x > DUNGEON_X_THRESHOLD) {
    return ctx.bgMatches.has(e.id) || ctx.arenaMatches.has(e.id) ? null : 'instance';
  }
  return (zone ?? worldPvpZonePolicyAt(e.pos.x, e.pos.z)) === 'sanctuary' ? 'sanctuary' : null;
}

export function updateWorldPvpRewards(ctx: SimContext): void {
  if (ctx.worldPvpDisabled) return;
  for (const meta of ctx.players.values()) {
    const state = meta.worldPvp;
    if (
      !state ||
      !worldPvpRewardsActive(state) ||
      meta.leaving ||
      !ctx.entities.has(meta.entityId) ||
      ctx.entities.get(meta.entityId)!.pvpRewardsPaused
    )
      continue;
    const player = ctx.entities.get(meta.entityId)!;
    if (worldPvpRewardPause(ctx, player) !== null) continue;
    const before = state.rewardTicks ?? 0;
    if (before >= WORLD_PVP_MAX_REWARD_TICKS) continue;
    const ticks = before + 1;
    state.rewardTicks = ticks;
    if (ticks % TICK_RATE !== 0) continue;
    // Only five threshold ticks ever enter the grant path. Re-earned titles
    // use the ordinary idempotent deed grant, so they emit no extra saves.
    for (const title of WORLD_PVP_TITLE_THRESHOLDS) {
      if (ticks === title.hours * 3600 * TICK_RATE) ctx.grantDeed(meta, title.id);
    }
  }
}
