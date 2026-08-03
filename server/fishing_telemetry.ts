// Fishing telemetry vocabulary: the bounded label sets the /metrics exporter
// uses for the fishing arc (casts, catches, koi, got-aways, empty hooks) and
// for the rod training fees, plus the pure classifiers that produce them. Kept
// out of game.ts and out of the exporter, exactly like server/economy_telemetry.ts,
// so all of it unit-tests with no registry, no socket, and no running world.
//
// Why these signals exist: fishing is the one gathering profession with no node
// to stand on, so nothing about it is visible from the harvest series. Three
// open questions need it. R4 asked whether the koi odds are right, which is a
// koi-per-catch rate per band. R8 asked what the rod training fees actually
// take out of the economy, which is a payment count per rod recipe times a
// static fee. And the empty-hook rate (the table's itemId:null row) is the
// difference between "fishing is slow" and "fishing is broken" and cannot be
// derived from a catch count alone. Casts are the denominator: casts minus
// catches minus empty hooks minus got-aways is the sessions still in flight
// PLUS every session that ended without an outcome event (cancelled by a
// hit, a teleport, or the angler's own movement, plus the once-ever
// codfather quest catch, which returns before any outcome event), so the
// residual grows in steady state and is a cancellation gauge, never a
// zero-check. One accepted band edge, unlike the zone (which the session
// pins on fishCastZoneId): the cast samples the effective band at cast time
// while the outcome events re-resolve it at completion, so a mid-session
// rod change (discarding the rod during the bite wait has no casting guard)
// can put a cast and its catch in different band cells. Per-band totals
// absorb it as residual noise; it cannot mint an off-vocabulary series.
//
// THE ZONE VOCABULARY IS HARVEST_BANDS, deliberately reused rather than
// re-derived: a fishing zone and a harvest zone are the same ZoneDef list, and
// a second copy would drift the moment a fourth zone ships.
//
// EVERY VOCABULARY HERE READS BUILTIN CONTENT (the src/sim/content modules,
// the same direction server/economy_telemetry.ts takes with src/sim/data), NOT
// the swappable active bundle that zoneAt now resolves through. That is a
// deliberate exception to the unify-the-content-reads sweep, not an oversight:
// a custom map's zone ids must never mint label series, so an event carrying
// one is DROPPED by the exporter's membership guard rather than counted.
// Nothing is lost in production, because only the client and the world editor
// ever call setActiveWorldContent; the authoritative server runs BUILTIN_WORLD,
// so every zone the sim can put on a fishing event is a member of this list.
//
// CARDINALITY IS BOUNDED BY CONSTRUCTION, the same contract as
// server/http/game_signals.ts: zones x bands is 3 x 3 per fishing family and
// the rod-fee family is the two shipped rod recipes. Nothing per-player
// (account id, character id, name, ip) is ever a label, and the exporter's
// membership guards drop anything off these lists rather than minting a series
// for it.

import { FISHING_RARE_ID } from '../src/sim/content/items';
import { ROD_RECIPES } from '../src/sim/content/recipes';
import { trainingFeeFor } from '../src/sim/professions/training';

/**
 * The three fishing bands, as label values. Fixed at three by the proficiency
 * ladder (FISHING_BAND_THRESHOLDS) and by the three per-band catch tables, NOT
 * derived from a content list: a band is a rung, not a record, so a fourth one
 * is a design change that should redden this pin rather than silently widen
 * every fishing series.
 *
 * The band a cast is counted under is the EFFECTIVE band the sim resolved
 * (effectiveFishingBand: min of proficiency band and the owned rod's band), so
 * an over-rodded low-proficiency angler counts where they actually fished.
 */
export const FISHING_BANDS = ['0', '1', '2'] as const;

/** One of the three fishing band label values. */
export type FishingBandLabel = (typeof FISHING_BANDS)[number];

/**
 * The label value for a sim-side band. The sim types the band 0 | 1 | 2 on
 * every fishing event, so this is total over its whole domain; a value outside
 * it can only come from a caller bug, and the exporter's membership guard drops
 * that rather than minting a series (a band is a distribution, so re-banding a
 * malformed sample would corrupt the very question R4 asks of it).
 */
export function fishingBandLabel(band: 0 | 1 | 2): FishingBandLabel {
  return FISHING_BANDS[band];
}

/**
 * The rod recipes whose training fee is counted, derived from the rod recipe
 * list so the label set cannot drift from the shipped rods. Exactly the two
 * trainer-taught rods today (recipe_stormreel_fishing_rod at skillReq 75 and
 * recipe_tidewrought_fishing_rod at 125); a third rod extends the label set by
 * construction and the exporter pre-seeds it to zero.
 */
export const ROD_FEE_RECIPE_IDS: readonly string[] = Object.freeze(
  ROD_RECIPES.map((recipe) => recipe.id),
);

/** The static training fee in copper for each rod recipe, derived once from content.
 *
 *  A Map, NOT an object literal: the recipe id reaching the emission site comes
 *  from a client-driven command, and a plain-object lookup would resolve
 *  'toString' or 'constructor' to an inherited function. */
const ROD_FEE_BY_RECIPE: ReadonlyMap<string, number> = new Map(
  ROD_RECIPES.map((recipe) => [recipe.id, trainingFeeFor(recipe)]),
);

/** Whether a trained recipe id is one of the rod recipes the fee counter tracks. */
export function isRodFeeRecipe(recipeId: string): boolean {
  return ROD_FEE_BY_RECIPE.has(recipeId);
}

/**
 * The copper a rod recipe's training charges, or 0 for anything that is not a
 * rod recipe. The fee is STATIC content (trainingFeeFor is a pure tier lookup),
 * which is why the exporter counts payments rather than summing copper: one
 * count series times this constant is the copper, and the constant is published
 * beside the counter so a dashboard never has to hardcode 4g/16g.
 */
export function rodFeeForRecipe(recipeId: string): number {
  return ROD_FEE_BY_RECIPE.get(recipeId) ?? 0;
}

/**
 * Whether a landed catch is the rare koi. The koi is the one catch whose rate
 * is a balance question in its own right (R4), so it gets its own counter
 * beside the all-catches one rather than an itemId label, which would grow the
 * series set with the catch tables.
 */
export function isKoi(itemId: string): boolean {
  return itemId === FISHING_RARE_ID;
}
