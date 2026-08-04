// Open-world mob respawn policy: how long a slain mob stays down.
//
// A pure leaf (no SimContext, no state): a Vitest imports it directly, and the
// one live caller is the death site in combat/damage.ts.
//
// WHY THIS EXISTS: this is a deliberate content-tuning knob, not a classic-era
// formula. It is stated once here and pinned by tests/respawn_policy.test.ts,
// with the downstream farm ceilings pinned by tests/economy_yield.test.ts.
//
// HISTORY, because this number has now moved twice and the reasoning matters:
//
//  1. The world shipped for months on one flat 25s timer for every open-world
//     mob.
//  2. That was replaced by three respawn tiers keyed to a zone's level band (60
//     / 120 / 180s), on the argument that a farmed camp regenerating three times
//     a minute paid gold and XP past what the zone was tuned for.
//  3. The tiers are now retired, back to a single 60s delay. Measuring the tiers
//     against how players actually farm did not support them:
//
//     - Respawn was never the binding constraint for a solo player. Even at
//       180s the densest route in the world (Thornpeak's Glimmermere corridor,
//       63 standing mobs) supported about 20 kills a minute, and a player who
//       kills one mob every 8 seconds wants 7. Nobody was ever waiting on a
//       spawn. The tiers only ever throttled AoE multi-pulls and several players
//       sharing a route.
//     - The per-hour ceilings that justified the tiers assume a farmer who
//       kills every mob the instant it respawns with zero travel: at the top
//       cluster that is 1.01 kills per SECOND, sustained, across 130 yards. It
//       is a bound, not a forecast, and the tiers were sized against a pace no
//       player can reach.
//     - The one genuine outlier turned out to be a single mob rather than a
//       tier: Warlord Drogmar is boss: true with boss-tier loot but declared no
//       cadence, so he inherited the trash timer and was 24% of that corridor's
//       gold by himself. He now carries an explicit respawnMult (zone3.ts).
//
// The thinner zones are what motivated the revisit: the ten expansion zones
// share the old endgame band but not its density (their largest cluster is
// Galecrest's 14-mob shipwreck against Glimmermere's 63), so 180s there bought
// no farm resistance and only made thin country feel empty.
//
// ZoneDef.trashRespawnSeconds remains the per-zone escape hatch. If a specific
// zone ever needs its own cadence, set it there rather than reintroducing bands.

import { zoneContaining } from './data';
import type { ZoneDef } from './types';

/**
 * The open-world trash respawn delay, everywhere, for every level band.
 *
 * 60 was already the starter-band value and was checked against SUPPLY rather
 * than assumed: a starter camp of 5 to 8 mobs returns 5 to 8 kills a minute,
 * while a new character needs 10 to 20 seconds per kill including the walk, so
 * 3 to 6 a minute. Supply exceeds demand at every authored camp in the world,
 * and the paired camps (two forest_wolf, two wild_boar, two vale_bandit) double
 * it again, so a "kill 10" objective never waits on a spawn. Applying it
 * world-wide extends that property to every zone rather than only the first two.
 */
export const TRASH_RESPAWN_SECONDS = 60;

/**
 * Fallback for a mob standing outside every authored zone rect: the far-east
 * instance plane (dungeons, the arena, delves) and any other off-map spawn.
 * Instanced content is already gated by lockouts and run length, so it keeps the
 * historical flat delay.
 */
export const DEFAULT_RESPAWN_SECONDS = 25;

/**
 * The trash respawn delay for one zone. Every authored zone takes the single
 * world delay unless it overrides with ZoneDef.trashRespawnSeconds; a null zone
 * (nowhere in the authored world) takes DEFAULT_RESPAWN_SECONDS.
 *
 * The zone argument is still taken, and the override still honored, precisely so
 * a future per-zone cadence needs no caller change: the level band is what was
 * retired, not per-zone control.
 */
export function trashRespawnSecondsForZone(zone: ZoneDef | null | undefined): number {
  if (!zone) return DEFAULT_RESPAWN_SECONDS;
  if (zone.trashRespawnSeconds !== undefined) return zone.trashRespawnSeconds;
  return TRASH_RESPAWN_SECONDS;
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
