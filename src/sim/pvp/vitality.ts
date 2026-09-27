// WARFARE Vitality: where honor gear's health bonus applies (owner rule,
// 2026-09-24: "it never works in dungeons or raids; it works in other
// contexts"). The bonus itself is a pure function of the Warfare Defense
// Rating (power.ts pvpVitalityFromRating) and entity.ts applies it to maxHp;
// this module only decides the context and flips `Entity.pvpVitalityActive`.
//
// The rule, safest-first: anything on the far-east instance plane is a PvE
// instance (a dungeon, raid, delve, rift floor, or any instance added later)
// and switches the bonus OFF, unless the player is in a battleground or arena
// match, which are PvP. Everywhere else (the open world) it is ON. A player
// whose state flips is recalculated once, and recalcPlayerStats preserves the
// health fraction, so a switch can never gain or lose health.
//
// Host-agnostic: no rng, no wall clock; runs on the world PvP pass cadence.

import { DUNGEON_X_THRESHOLD } from '../data';
import type { SimContext } from '../sim_context';
import type { Entity } from '../types';

/** Does honor gear's health bonus apply to this player where they stand now? */
export function pvpVitalityAppliesTo(ctx: SimContext, e: Entity): boolean {
  if (e.kind !== 'player') return false;
  if (ctx.bgMatches.has(e.id) || ctx.arenaMatches.has(e.id)) return true;
  return e.pos.x <= DUNGEON_X_THRESHOLD;
}

/** Flip each player's Vitality switch to match their context, recalculating
 *  only the players whose state changed. Players who carry no Vitality are
 *  left alone entirely, so a realm without honor gear pays one read each. */
export function updatePvpVitality(ctx: SimContext): void {
  for (const meta of ctx.players.values()) {
    const e = ctx.entities.get(meta.entityId);
    if (!e) continue;
    const active = pvpVitalityAppliesTo(ctx, e);
    if ((e.pvpVitalityActive !== false) === active) continue;
    // Absent means ON (the open-world default), so the flag is only present
    // while it is off: an entity that never enters an instance never carries it.
    if (active) delete e.pvpVitalityActive;
    else e.pvpVitalityActive = false;
    if (e.stats.pvpVitality > 0) ctx.recalcPlayer(e);
  }
}
