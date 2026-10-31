// PvP tank restraint: a committed tank fighting another player deals 30% less
// damage and heals themselves for 30% less (owner rule, v0.46: tanks were
// unkillable in PvP).
//
// Who counts as a tank is the ONE shared rule, `isCommittedTank`
// (combat/tank_crit_immunity.ts): Protection warriors and paladins, a Feral
// druid while in Bruin Form, an Enhancement shaman while the Stonebound Weapon
// posture is up. The form and posture are read live, so a druid who leaves
// Bruin Form or a shaman who swaps to Galeheart drops the restraint at once.
//
// When it applies: from the moment the tank deals damage to, or takes damage
// from, a hostile player (or anything a player controls: a pet, guardian or
// totem), until PVP_EXCHANGE_LINGER_SECONDS pass with no further hostile
// player-vs-player damage either way. That is the classic 5-second combat
// linger the sim's own combat flag uses (sim.ts engaged pass,
// `combatTimer < 5`). Any hostile pairing counts, so open-world /pvp fights,
// free-for-all ground, battlegrounds, arenas and duels all qualify; a mob no
// player controls never starts or refreshes it. While it holds, ALL of the
// tank's damage pays it, including damage to creatures.
//
// The exchange stamp (`Entity.pvpExchangeAt`, sim seconds) is transient combat
// state: never persisted, never on the wire. Pure leaf: no SimContext, no rng,
// no clock read (the caller passes the sim time).

import { type CommittedTankMeta, isCommittedTank } from '../combat/tank_crit_immunity';
import type { Entity } from '../types';

/** Share of a restrained tank's damage that is removed. */
export const TANK_PVP_DAMAGE_PENALTY = 0.3;
/** Share of a restrained tank's healing on themselves that is removed. */
export const TANK_PVP_SELF_HEAL_PENALTY = 0.3;
/** Seconds after the last hostile player-vs-player hit that a player still
 *  counts as fighting players (the sim's classic combat linger). */
export const PVP_EXCHANGE_LINGER_SECONDS = 5;

/** Stamp both players of a hostile player-vs-player damage exchange. */
export function notePvpExchange(a: Entity, b: Entity, now: number): void {
  a.pvpExchangeAt = now;
  b.pvpExchangeAt = now;
}

/** Has this entity dealt or taken hostile player damage within the linger? */
export function inPvpExchange(e: Entity, now: number): boolean {
  const at = e.pvpExchangeAt;
  return at !== undefined && now - at < PVP_EXCHANGE_LINGER_SECONDS;
}

/** Is this player a committed tank currently fighting another player? */
export function tankPvpRestrained(
  player: Entity,
  meta: CommittedTankMeta | undefined,
  now: number,
): boolean {
  return inPvpExchange(player, now) && isCommittedTank(player, meta);
}

/** Multiplier on the damage a player (or anything they control) deals. */
export function tankPvpDamageMult(
  player: Entity,
  meta: CommittedTankMeta | undefined,
  now: number,
): number {
  return tankPvpRestrained(player, meta, now) ? 1 - TANK_PVP_DAMAGE_PENALTY : 1;
}

/** Multiplier on a heal; only a heal the player casts on themselves pays it. */
export function tankPvpSelfHealMult(
  source: Entity,
  target: Entity,
  meta: CommittedTankMeta | undefined,
  now: number,
): number {
  if (source.id !== target.id) return 1;
  return tankPvpRestrained(target, meta, now) ? 1 - TANK_PVP_SELF_HEAL_PENALTY : 1;
}
