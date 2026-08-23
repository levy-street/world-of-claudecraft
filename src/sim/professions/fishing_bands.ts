// The fishing CATCH-BAND ladder (masterwrought Phase 11i): which of the six
// per-zone catch tables a cast resolves against, from the two axes that gate
// it (the angler's fishing proficiency and the tier of the rod they carry).
//
// A SEPARATE LADDER FROM proficiency_bands.ts, and that separation is the
// whole reason this module exists. PROFICIENCY_BAND_THRESHOLDS is SHARED:
// professions/gathering.ts reads it for the land gather-cast duration and
// professions/proficiency_display_heal.ts reads it for the display band, so
// widening it to carry fishing's new catch bands would silently retune land
// gathering. Fishing gets its own array here instead, and the shared one is
// left literally [0, 100, 200].
//
// Extracted because a ladder is not command logic: fishing.ts is a command
// coordinator and this is a pure lookup two other layers read.
//
// WHAT THE EXTRACTION ACTUALLY MOVED, measured rather than characterised,
// because the first wording here flattered it. fishing.ts went 675 to 736
// lines, and every one of those 61 is comment: its NON-comment count went 287
// to 288, UP by one. One function body left (the six-line fishingRodBandFor)
// and the shim cost seven back (the import widened from one line to six, plus
// two re-export lines). So the code footprint is flat and the file is +61 lines
// of prose. What the move buys is not size: it is that the ladder now has ONE
// home that server/ and src/ui/ can import without reaching through a command
// coordinator, and that widening it again is one edit here.
//
// Pure leaf on the proficiency_bands.ts contract: no SimContext, no rng,
// explicit arguments only, so a Vitest imports it directly. It is NOT
// content-table free, and the difference is worth stating rather than
// implying: ./tools value-imports ../content/professions, so this module
// inherits that dependency transitively through its canGatherTier import.
// fishing.ts re-exports the old names so every existing importer resolves
// unchanged.

import { canGatherTier } from './tools';

/** The catch table a cast resolves against. ONE exported type, used at every
 *  site that used to write the literal union: the four fishing SimEvent
 *  variants (types.ts), effectiveFishingBand, fishingRodBandFor, and
 *  server/fishing_telemetry.ts's fishingBandLabel. Widening the ladder again
 *  is one edit here, not seven across the tree. */
export type FishingCatchBand = 0 | 1 | 2 | 3 | 4 | 5;

/**
 * The minimum fishing proficiency each catch band takes.
 *
 * SIX ENTRIES, and the shape is the ruling (masterwrought 11i DECISION B).
 * Band 2 drops its gate from the shared ladder's 200 to 150, which is what
 * makes every (proficiency, rod tier) pair resolve AT OR ABOVE the band it
 * resolved to before this phase (proven by the exhaustive walk in
 * tests/professions_fishing.test.ts, which hard-codes the pre-phase ladder as
 * its reference rather than importing this array and comparing it to itself).
 * It also fills the 100-to-200 stretch, which was previously barren: under the
 * shared ladder an angler crossed 100 and then learned nothing new about their
 * catch table for another hundred points.
 *
 * Bands 3, 4 and 5 all sit at 200, fishing's maxSkill
 * (content/professions.ts). That is deliberate rather than a placeholder: at
 * the cap the ROD becomes the only axis left, which is precisely the defect
 * this phase exists to fix. Before it, rod tier 3 already reached the last
 * band and the two crafted rungs above it bought no new catch at all.
 */
export const FISHING_CATCH_BAND_THRESHOLDS = [0, 100, 150, 200, 200, 200] as const;

/** The last index of a readonly tuple, as a LITERAL type rather than `number`.
 *
 *  Needed because `tuple.length - 1` is ordinary arithmetic and widens to
 *  `number`, which is what makes the naive `satisfies` on the next declaration
 *  fail to compile at all. Peeling one element off the tuple and reading the
 *  remainder's length keeps the answer a literal, so it can be checked against
 *  the band union.
 */
type LastIndexOf<T extends readonly unknown[]> = T extends readonly [...infer Rest, unknown]
  ? Rest['length']
  : never;

/** The highest band index the ladder defines.
 *
 *  THE TYPE ANNOTATION IS LOAD-BEARING, not decoration. This module's headline
 *  claim is that widening the ladder again is one edit, and the way that claim
 *  fails silently is adding a seventh threshold WITHOUT widening
 *  FishingCatchBand: an unchecked cast would then hand back 6,
 *  fishingRodBandFor would return it, and server/fishing_telemetry.ts would
 *  index its label array off the end and mint an `undefined` series. The value
 *  is DERIVED from the ladder at runtime and the type is derived from the same
 *  ladder at compile time, so a seventh threshold makes LastIndexOf resolve to
 *  6, which is not a FishingCatchBand, and this line stops compiling instead of
 *  becoming a metrics defect in production.
 */
export const MAX_FISHING_CATCH_BAND: FishingCatchBand = (FISHING_CATCH_BAND_THRESHOLDS.length -
  1) as LastIndexOf<typeof FISHING_CATCH_BAND_THRESHOLDS>;

/** Which catch band a given fishing proficiency selects. Pure state (no rng),
 *  so it never perturbs fishing's one-draw-per-catch contract. Walks DOWN the
 *  ladder so the highest satisfied threshold wins; a NaN proficiency fails
 *  every comparison and falls to band 0, matching proficiencyBandFor. */
export function fishingCatchBandFor(proficiency: number): FishingCatchBand {
  for (let band = MAX_FISHING_CATCH_BAND; band > 0; band--) {
    if (proficiency >= FISHING_CATCH_BAND_THRESHOLDS[band]) return band as FishingCatchBand;
  }
  return 0;
}

/** The highest catch band a rod of this tier unlocks.
 *
 *  THE SHIPPED GATE, REUSED RATHER THAN REPLACED: band b takes tool tier
 *  b + 1, run through the same canGatherTier comparator every node gate uses.
 *  The new bands ride it unchanged, which is what retroactively gives the two
 *  crafted rods a reason to exist: band 3 takes the shipped stormreel rod
 *  (tier 4), band 4 the shipped tidewrought rod (tier 5), and band 5 the
 *  tier-6 apex rod this phase mints. Tier 1 (the bare-hands floor and the
 *  simple pole) reaches band 0 only. */
export function fishingRodBandFor(rodTier: number): FishingCatchBand {
  let band: FishingCatchBand = 0;
  for (let b = 1; b <= MAX_FISHING_CATCH_BAND; b++) {
    if (canGatherTier(rodTier, b + 1)) band = b as FishingCatchBand;
  }
  return band;
}
