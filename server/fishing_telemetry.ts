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
// catches minus empty hooks minus got-aways minus early reels is the
// sessions still in flight PLUS every session that ended without an outcome
// event (cancelled by a hit, a teleport, or the angler's own movement, plus
// the once-ever codfather quest catch, which returns before any outcome
// event), so the residual grows in steady state and is a cancellation
// gauge, never a zero-check. The early reel (a pre-bite re-press, the
// anti-spam arm) has its OWN outcome event and series rather than joining
// that residual or the got-aways: it is self-inflicted where a got-away is
// the game costing the player, and its rate is how to tell whether the
// spam fix burns legitimate anglers. One accepted band edge, unlike the zone (which the session
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
// server/http/game_signals.ts: the fishing families are ZONES x BANDS, which is
// HARVEST_BANDS (14 zones) x 6 bands = 84 pre-seeded series per counter since
// masterwrought Phase 11i grew the catch ladder from three bands to six. The
// old wording here said "3 x 3", which understated the zone term even before
// 11i: only THREE zones have a catch table of their OWN (every other zone's
// water draws the eastbrook_vale fallback, so it fishes and can appear on a
// fishing event), and the exporter pre-seeds the full zone vocabulary anyway so
// a zone-and-band pair that never fires reads as a real zero rather than a gap
// (tests/server/http/game_metrics.test.ts derives the cross product rather than
// restating it). The rod-fee family is the TRAINER-taught rod
// recipes, still two after 11i added a third, drop-taught rung. Nothing per-player
// (account id, character id, name, ip) is ever a label, and the exporter's
// membership guards drop anything off these lists rather than minting a series
// for it.

import { FISHING_RARE_ID } from '../src/sim/content/items';
import { ROD_RECIPES } from '../src/sim/content/recipes';
import type { FishingCatchBand } from '../src/sim/professions/fishing_bands';
import { trainingFeeFor } from '../src/sim/professions/training';

/**
 * The six fishing bands, as label values. Fixed at six by the catch-band
 * ladder (FISHING_CATCH_BAND_THRESHOLDS in
 * src/sim/professions/fishing_bands.ts) and by the six per-band catch tables,
 * NOT derived from a content list: a band is a rung, not a record, so a
 * SEVENTH one is a design change that should redden this pin rather than
 * silently widen every fishing series.
 *
 * IT WAS THREE UNTIL masterwrought Phase 11i, and this pin did exactly the job
 * the paragraph above promised: growing the ladder reddened it and the widening
 * was a deliberate edit here rather than a series that appeared on its own.
 * Hand-written on purpose even so, because the alternative (deriving the length
 * from the threshold array) would make the next widening silent again.
 *
 * The band a cast is counted under is the EFFECTIVE band the sim resolved
 * (effectiveFishingBand: min of proficiency band and the owned rod's band), so
 * an over-rodded low-proficiency angler counts where they actually fished.
 */
export const FISHING_BANDS = ['0', '1', '2', '3', '4', '5'] as const;

/** One of the six fishing band label values. */
export type FishingBandLabel = (typeof FISHING_BANDS)[number];

/**
 * The label value for a sim-side band. The sim types the band
 * `FishingCatchBand` on every fishing event, so this is total over its whole
 * domain; a value outside it can only come from a caller bug, and the
 * exporter's membership guard drops that rather than minting a series (a band
 * is a distribution, so re-banding a malformed sample would corrupt the very
 * question R4 asks of it).
 */
export function fishingBandLabel(band: FishingCatchBand): FishingBandLabel {
  return FISHING_BANDS[band];
}

/**
 * The rod recipes whose training fee is counted: the rod recipe list filtered
 * to the rows a TRAINER actually teaches. Two today
 * (recipe_stormreel_fishing_rod at skillReq 75 and
 * recipe_tidewrought_fishing_rod at 125), out of a three-rung ladder.
 *
 * THE FILTER IS THE FEE-BEARING DISCRIMINATOR the emission site in
 * server/game.ts asks for, and masterwrought Phase 11i is what forced it. That
 * site counts a `trainResult ok` for any id this list contains, and its own
 * comment recorded the condition precisely: the counter is a PAYMENT count only
 * while no rod recipe carries 'drop' acquisition, because a pattern-item learn
 * emits `trainResult ok` having charged nothing. 11i's apex rung is
 * drop-taught, so an unfiltered list would have counted every pattern learn of
 * it as a fee paid and quietly turned the metric into a learn count.
 *
 * FILTERING THE VOCABULARY rather than adding a second check at the emit site
 * is deliberate: it makes `isRodFeeRecipe` correct by construction, so the one
 * predicate every consumer already calls carries the rule, and a future
 * drop-taught rung joins the exemption by existing. A rung that is BOTH
 * trainer-taught and pattern-taught would still need a real per-event
 * discriminator; nothing in the ladder is, and this is the arm that would have
 * to change if one ever were.
 */
export const ROD_FEE_RECIPE_IDS: readonly string[] = Object.freeze(
  ROD_RECIPES.filter((recipe) => !(recipe.acquisition ?? []).includes('drop')).map(
    (recipe) => recipe.id,
  ),
);

/** The static training fee in copper for each rod recipe, derived once from content.
 *
 *  A Map, NOT an object literal: the recipe id reaching the emission site comes
 *  from a client-driven command, and a plain-object lookup would resolve
 *  'toString' or 'constructor' to an inherited function. */
const ROD_FEE_BY_RECIPE: ReadonlyMap<string, number> = new Map(
  ROD_RECIPES.filter((recipe) => !(recipe.acquisition ?? []).includes('drop')).map((recipe) => [
    recipe.id,
    trainingFeeFor(recipe),
  ]),
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
