// World PvP (the /pvp flag): the pure rules. Who is hostile to whom given the
// two flags and the two zone policies, what a kill stakes, and how the stake
// and the honor pool are split among everyone who worked for it. No
// SimContext, no rng, no clock: every function here is a plain function of its
// arguments so the sim (isHostileTo, the death hook), the renderer (nameplate
// colour), and the HUD (target frame, the auto-attack gate, the World PvP tab)
// can all read the same verdict and never drift. The ctx-bound system that
// owns the flag state, the assist books, the 5-minute disarm clock, the zone
// notices and the kill resolution is world_pvp.ts; the zone policy lookup
// (which rectangle a position is in) is world_pvp_zones.ts.

import type { Entity } from '../types';
import { repeatHonorMultiplier } from './honor';

/** What the ground says about open-world fighting (world_pvp_zones.ts). */
export type WorldPvpZonePolicy = 'sanctuary' | 'contested' | 'ffa';

/** The lowest level that may raise the flag: a fresh character in the starter
 *  village should never be able to opt into being killed by accident. */
export const WORLD_PVP_MIN_LEVEL = 10;

/** How long the flag stays up after /pvp off (the classic five minutes). The
 *  drop is DEFERRED while the player is in combat, so switching off mid-fight
 *  can never make an attacker's next blow fizzle. */
export const WORLD_PVP_DISARM_SECONDS = 300;

/** The gold stake a world kill moves: the SMALLER of this cap and
 *  WORLD_PVP_STAKE_FRACTION of the victim's purse (owner tuning: "5g or 10% of
 *  their purse, whichever is the minimum"). In copper: 5 gold. Only a FLAGGED
 *  victim stakes gold; an unflagged player killed in a free-for-all zone loses
 *  nothing (owner tuning). */
export const WORLD_PVP_STAKE_CAP_COPPER = 5 * 10_000;
export const WORLD_PVP_STAKE_FRACTION = 0.1;

/** The honor POOL one world kill pays, split equally among every contributor,
 *  so a clean 1v1 pays the whole pool and a five-player gank pays each of them
 *  a fifth. Deliberately sized BELOW the instanced faucets: a Thornhollow Fields
 *  win pays 60 plus its kill drip and a ranked 1v1 win pays 25, so a player who
 *  wants Warfare gear fastest still queues; world kills are the slower, open
 *  road to the same vendor (docs/design/warfare.md, "World PvP income"). */
export const WORLD_PVP_KILL_HONOR = 10;

/** Assist window in sim seconds: a hit or a heal older than this before the
 *  killing blow does not count as having helped (the battleground's window). */
export const WORLD_PVP_ASSIST_WINDOW = 10;

/** A victim more than this many levels BELOW a contributor is "grey" to them:
 *  that contributor takes neither honor nor gold from the kill, and the victim
 *  is not charged that contributor's share. The classic grey-kill rule, and the
 *  reason a level-cap character cannot farm flagged low-level purses. */
export const WORLD_PVP_GREY_LEVEL_GAP = 5;

/** The per-pair diminishing-returns window in sim seconds: kills of one victim
 *  by one contributor decay 100, 50, 25, then 0 percent (HONOR_REPEAT_DR) from
 *  the FIRST kill of that victim, and the counter starts over this long after
 *  it (owner tuning: "after 3 kills there should be 0 honor so there is no
 *  camping; this can reset after an hour"). */
export const WORLD_PVP_DR_WINDOW_SECONDS = 60 * 60;

/**
 * Two PLAYERS who can never be hostile to each other in the open world,
 * whatever the flags or the ground say: the same player, or two members of
 * one party or raid. The group is the "faction" of a factionless world, and a
 * flagged mage's Blizzard must never land on the healer standing beside them,
 * in a free-for-all zone as much as anywhere. A shared guild is NOT an
 * exemption (owner spec): guildmates outside one group fight like strangers,
 * so a guild that wants to stand together forms a party. Symmetric by
 * construction.
 */
export function worldPvpPairExempt(a: Entity, b: Entity, inSameParty: boolean): boolean {
  return a.id === b.id || inSameParty;
}

/**
 * The open-world verdict for a pair of PLAYERS (pets resolve to their owner
 * before reaching here, in the sim's pvpController and the renderer's
 * isOwnedPetHostile). In order: the exemptions above; a sanctuary under EITHER
 * player switches the world off; both standing in a free-for-all zone makes
 * them hostile with no flag at all, whatever their levels (owner spec: anyone
 * standing on free-for-all ground is fair game); anywhere else both must carry
 * the flag, which an under-level character can never do. Symmetric in every
 * arm.
 */
export function worldPvpPairHostile(
  a: Entity,
  b: Entity,
  inSameParty: boolean,
  zoneA: WorldPvpZonePolicy,
  zoneB: WorldPvpZonePolicy,
): boolean {
  if (worldPvpPairExempt(a, b, inSameParty)) return false;
  if (zoneA === 'sanctuary' || zoneB === 'sanctuary') return false;
  if (zoneA === 'ffa' && zoneB === 'ffa') return true;
  return !!a.pvpFlag && !!b.pvpFlag;
}

/**
 * Does landing a hostile hit mark the attacker (raise their flag)? Only a hit
 * that needed no flag at all can, and that is the free-for-all arm: an UNFLAGGED
 * attacker hitting an UNFLAGGED player. The other three owner cases fall out of
 * this one rule: hitting a flagged player never marks you, so whoever hits back
 * at an aggressor (the victim, or anyone defending them) is hitting the flag
 * the aggressor's own first blow raised.
 */
export function worldPvpHitMarksAttacker(attacker: Entity, victim: Entity): boolean {
  return !attacker.pvpFlag && !victim.pvpFlag;
}

/** Does a contributor in this group earn anything from a world kill? A raid
 *  never does (owner rule 2026-09-25, the King of the Hill raid rule carried to
 *  kills): a raid member takes neither honor nor gold and is left out of the
 *  split, so a zerg pays nobody and never dilutes a party's share. */
export function worldPvpGroupEarns(party: { raid: boolean } | null): boolean {
  return !party?.raid;
}

/** Is the victim grey (too low) to this contributor? Level difference only:
 *  the classic rule keys on the VICTIM being far below, never above. */
export function worldPvpVictimIsGrey(contributorLevel: number, victimLevel: number): boolean {
  return contributorLevel - victimLevel > WORLD_PVP_GREY_LEVEL_GAP;
}

/** The copper one kill stakes from a purse of `victimCopper`. Never negative,
 *  never fractional, never above the cap. */
export function worldPvpStake(victimCopper: number): number {
  if (!Number.isFinite(victimCopper) || victimCopper <= 0) return 0;
  return Math.min(WORLD_PVP_STAKE_CAP_COPPER, Math.floor(victimCopper * WORLD_PVP_STAKE_FRACTION));
}

/** One contributor's share of an amount split `contributors` ways, before that
 *  contributor's own diminishing-returns multiplier. The killing blow takes the
 *  integer remainder (`killerBonus`) so the split always sums to the whole. */
export function worldPvpSplit(
  amount: number,
  contributors: number,
): { share: number; killerBonus: number } {
  if (contributors <= 0 || amount <= 0) return { share: 0, killerBonus: 0 };
  const share = Math.floor(amount / contributors);
  return { share, killerBonus: amount - share * contributors };
}

/** The per-pair diminishing-returns multiplier for a contributor who has
 *  already been paid `previousKills` kills of this victim inside the current
 *  WORLD_PVP_DR_WINDOW_SECONDS window (the counter lives in the session books,
 *  world_pvp.ts): HONOR_REPEAT_DR, 100, 50, 25, then 0 percent, for honor AND
 *  gold alike, so camping one player pays out three times an hour and then
 *  nothing at all. */
export function worldPvpPairMultiplier(previousKills: number): number {
  return repeatHonorMultiplier(previousKills);
}
