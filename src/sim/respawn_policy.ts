// Open-world mob respawn policy: how long a slain mob stays down.
//
// A pure leaf (no SimContext, no state): a Vitest imports it directly, and the
// one live caller is the death site in combat/damage.ts.
//
// WHY THIS EXISTS: every open-world mob used to respawn on one flat 25s timer,
// so a farmed camp regenerated about three times a minute and dense pack strips
// paid gold and XP far past what the zone was tuned for. Respawn now scales with
// the zone's level band, so a low-level starter camp still churns for questing
// while endgame packs come back on a farm-resistant cadence.
//
// The tiers are a deliberate content-tuning knob, not a classic-era formula:
// they are stated once here and pinned by tests/respawn_policy.test.ts, with the
// downstream farm ceilings they protect pinned by tests/economy_yield.test.ts.

import { zoneContaining } from './data';
import type { ZoneDef } from './types';

/**
 * Starter bands (zones capped at level 7): quest-paced, still fast.
 *
 * 60 rather than the band formula's own logic, and deliberately: this tier lands
 * on a player's first hour, who has no second camp to rotate to and no mount, so
 * it was checked against supply rather than assumed. A starter camp of 5 to 8
 * mobs now returns 5 to 8 kills a minute (down from 12 to 19), while a new
 * character needs 10 to 20 seconds per kill including the walk, so 3 to 6 a
 * minute. Supply still exceeds demand at every authored starter camp, and the
 * paired camps (two forest_wolf, two wild_boar, two vale_bandit) double it
 * again, so a "kill 10" objective never waits on a spawn.
 *
 * If starter-zone feel ever regresses anyway, prefer ZoneDef.trashRespawnSeconds
 * on the one zone over moving this constant, which governs Farshore Isle too.
 */
export const TRASH_RESPAWN_SECONDS_LOW = 60;
/** Mid bands (zones capped at level 14). */
export const TRASH_RESPAWN_SECONDS_MID = 120;
/** Endgame bands (everything above level 14). */
export const TRASH_RESPAWN_SECONDS_HIGH = 180;

/**
 * Fallback for a mob standing outside every authored zone rect: the far-east
 * instance plane (dungeons, the arena, delves) and any other off-map spawn.
 * Instanced content is already gated by lockouts and run length, so it keeps the
 * historical flat delay.
 */
export const DEFAULT_RESPAWN_SECONDS = 25;

/**
 * The trash respawn delay for one zone, by its level band. A zone may override
 * its tier with ZoneDef.trashRespawnSeconds. A null zone (nowhere in the
 * authored world) takes DEFAULT_RESPAWN_SECONDS.
 */
export function trashRespawnSecondsForZone(zone: ZoneDef | null | undefined): number {
  if (!zone) return DEFAULT_RESPAWN_SECONDS;
  if (zone.trashRespawnSeconds !== undefined) return zone.trashRespawnSeconds;
  const bandCap = zone.levelRange[1];
  if (bandCap <= 7) return TRASH_RESPAWN_SECONDS_LOW;
  if (bandCap <= 14) return TRASH_RESPAWN_SECONDS_MID;
  return TRASH_RESPAWN_SECONDS_HIGH;
}

/**
 * The base respawn delay in effect at a world position, BEFORE the per-template
 * rare/respawnMult multiplier.
 *
 * `cfgRespawnSeconds` is SimConfig.respawnSeconds and is the global override: a
 * host that passes it (the headless RL env, the fast unit tests) pins the whole
 * world to that base and opts out of the zone tiers entirely. Left undefined (a
 * normal world), the position's zone decides.
 */
export function baseRespawnSecondsAt(
  x: number,
  z: number,
  cfgRespawnSeconds: number | undefined,
): number {
  if (cfgRespawnSeconds !== undefined) return cfgRespawnSeconds;
  return trashRespawnSecondsForZone(zoneContaining(x, z));
}

/** The template fields the policy reads; a MobTemplate satisfies it structurally. */
export interface RespawnTemplateFields {
  respawnSeconds?: number;
  respawnMult?: number;
  rare?: boolean;
}

/**
 * Historical world respawn base, kept SEPARATE from DEFAULT_RESPAWN_SECONDS even
 * though both are 25 today. This one is the base a self-scheduled template was
 * tuned against; that one is the off-map fallback. Retiming the fallback later
 * must not silently retime every shipped rare, so they do not share a constant.
 */
export const LEGACY_RESPAWN_SECONDS = 25;

/**
 * Does this template carry its OWN respawn schedule rather than inheriting the
 * world's? Two ways to say so, and both were tuned against the flat 25s base:
 *
 *  - an authored `respawnMult`: every shipped coefficient is a wall-clock target
 *    expressed as a multiple of 25 (144 is one hour, 432 three, 864 six, and 7.2
 *    is the three minutes tests/fixes.test.ts pins for a quest rare);
 *  - `rare: true`, whose default 4x is the 100s cadence every bare rare shipped
 *    with.
 *
 * Re-basing either onto a zone tier would stretch a six-hour rare past forty
 * hours and a three-minute quest rare to twenty-two minutes. So named rares and
 * minibosses keep their exact shipped schedule, and the zone tiers govern plain
 * trash plus the open-world bosses that never declared a schedule at all. That
 * split is the whole point: it slows farmable TRASH without touching tuned rare
 * cadence.
 */
export function isSelfScheduled(template: RespawnTemplateFields | undefined): boolean {
  return template?.respawnMult !== undefined || template?.rare === true;
}

/**
 * The full resolution the death site applies, in precedence order:
 *  1. an explicit MobTemplate.respawnSeconds (a fixed schedule: the training
 *     dummy) wins outright, exactly as before;
 *  2. otherwise the base, times the template's respawnMult, defaulting to 4x for
 *     a rare and 1x for everything else. The multiplier arithmetic is unchanged
 *     from the flat-timer era; only which base it multiplies moved, and only for
 *     templates that are NOT self-scheduled (see isSelfScheduled).
 *
 * An explicit SimConfig base still overrides everything below the template's own
 * fixed seconds, for both populations, exactly as it always did.
 *
 * The position is the mob's SPAWN point, not where it died: a mob dragged out of
 * its camp still respawns on its home zone's cadence.
 */
export function resolveRespawnSeconds(
  template: RespawnTemplateFields | undefined,
  spawnPos: { x: number; z: number },
  cfgRespawnSeconds: number | undefined,
): number {
  if (template?.respawnSeconds !== undefined) return template.respawnSeconds;
  const base = isSelfScheduled(template)
    ? (cfgRespawnSeconds ?? LEGACY_RESPAWN_SECONDS)
    : baseRespawnSecondsAt(spawnPos.x, spawnPos.z, cfgRespawnSeconds);
  return base * (template?.respawnMult ?? (template?.rare ? 4 : 1));
}
