// The farming crop catalog: what a seed becomes, how long it takes, and what
// a harvest pays (the growth-engine phase).
//
// DATA-AS-CODE, like GATHER_NODES and FARM_PATCHES beside it: one declarative
// row per crop, no logic. The engine (src/sim/professions/farming.ts) reads
// this table and never hardcodes a crop's numbers.
//
// CROP IDS ARE PERSISTED SAVE KEYS. `PlayerMeta.farmPlots` rows carry the crop
// id and the load-side allowlist (FARM_CROP_IDS, derived from this table's
// keys) DROPS any plot whose crop id is no longer here. Renaming or retiring a
// shipped crop id destroys every player's plot of that crop at their next
// load. Never rename, never reuse; retiring one is a deliberate
// destroy-on-load decision.
//
// The full eight-crop ladder (two per tier) is packet-locked; this phase ships
// exactly the tier-1 vale_wheat row so the engine is testable end to end, and
// the crop-ladder phase adds the other seven with their fine twins and their
// hoe gates. The skill threshold is NOT a column: it derives from the tier
// through the shared 25-point band math (farmCropSkillThreshold below), so a
// crop can never disagree with the profession's own ladder.

export interface FarmCropDef {
  readonly id: string;
  // The farming tier this crop belongs to, which decides BOTH its skill gate
  // (farmCropSkillThreshold) and its survival band (farmSurvivalChance in
  // professions/farm_projection.ts). Must agree with the tier of the patch a
  // player can reach it from (FARM_PATCHES / FARMING_ZONE_TIERS).
  readonly tier: 1 | 2 | 3 | 4;
  // Wall-clock growth time in milliseconds, added to the plant-time
  // lockoutNowMs to set the plot's absolute readyAtMs. Growth continues while
  // the owner is logged out, which is the whole design; nothing rots at the
  // far end, so this is an opportunity cost and never a deadline.
  readonly durationMs: number;
  readonly seedItemId: string;
  readonly produceItemId: string;
  // The fine grade a skill-scaled roll upgrades a pick into. Deliberately NOT
  // a MATERIAL_GRADES row: that table is the nine NODE yields and its tests
  // pin it to exactly those, so farming's fine roll lives in the harvest
  // resolver (professions/farming.ts) instead of the node grade path.
  readonly fineProduceItemId: string;
}

// TUNING, PROVISIONAL, FLAGGED FOR THE MAINTAINER: 45 minutes sits mid-band
// in the locked tier-1 range (30 to 60 minutes). It is long enough that a
// session boundary is the natural second visit (the check-in thesis) and short
// enough that a first-time player who plants during the intro quest can come
// back inside one sitting.
const VALE_WHEAT_DURATION_MS = 2_700_000;

const FARM_CROP_ROWS: readonly FarmCropDef[] = [
  {
    id: 'vale_wheat',
    tier: 1,
    durationMs: VALE_WHEAT_DURATION_MS,
    seedItemId: 'vale_wheat_seed',
    produceItemId: 'vale_wheat',
    fineProduceItemId: 'fine_vale_wheat',
  },
];

// Deep-frozen at module load for the same reason FARM_PATCHES is: `readonly`
// erases at runtime and these rows are handed out by reference, so a consumer
// that mutated one would corrupt shipped content process-wide.
export const FARM_CROPS: Readonly<Record<string, FarmCropDef>> = Object.freeze(
  Object.fromEntries(FARM_CROP_ROWS.map((c) => [c.id, Object.freeze({ ...c })])),
);

/** The crop this id names, or undefined. `Object.hasOwn` rather than a bare
 *  index so a prototype key ('constructor', '__proto__') can never resolve to
 *  a function and pass a truthiness gate (the fishing_zones.ts reader
 *  contract). */
export function farmCropById(cropId: string): FarmCropDef | undefined {
  return Object.hasOwn(FARM_CROPS, cropId) ? FARM_CROPS[cropId] : undefined;
}

/** The minimum farming proficiency a crop of this tier may be planted at: the
 *  25-point band math, so tier 1 gates at 0, tier 2 at 25, tier 3 at 50 and
 *  tier 4 at 75. The PLANT GATE reads this; the survival ramp
 *  (farmSurvivalChance in professions/farm_projection.ts) re-derives the same
 *  threshold from its own FARM_SURVIVAL_BAND_SPAN, because that pure leaf may
 *  not import content. Two 25s therefore exist, and the binding pin in
 *  tests/professions_farming.test.ts ("binds the catalog band math to the
 *  survival ramp span") is what keeps them from drifting apart: tune either
 *  one alone and that pin reds. */
export function farmCropSkillThreshold(cropTier: number): number {
  return (cropTier - 1) * 25;
}

/** The tier of a crop id, or 1 for an id this table does not carry. The
 *  fallback is unreachable through the plant path (the plant gate refuses an
 *  unknown crop id before anything is written) and exists for the PROJECTION,
 *  which reads persisted rows and must never throw on one; the load-side
 *  allowlist already drops rows naming a retired crop. */
export function farmCropTier(cropId: string): number {
  return farmCropById(cropId)?.tier ?? 1;
}

// The load-side crop allowlist, DERIVED from the catalog keys rather than
// restated: a crop that ships is plantable and persistable by construction,
// and no second list can drift out of sync with this one. Re-exported by
// content/farm_patches.ts, where the persistence call sites already import it.
export const FARM_CROP_IDS: ReadonlySet<string> = new Set(Object.keys(FARM_CROPS));

// What a FAILED crop pays out, shared by every crop rather than authored per
// row. It lives here in the content layer, beside the yields it belongs with,
// rather than in the engine that grants it, because the material taxonomy
// (src/sim/material_taxonomy.ts) must read it as DATA: that module derives the
// material set from content tables and may not import an engine module, since
// pulling the SimContext seam into a pure UI leaf is exactly the import cycle
// its header bans. professions/farming.ts re-exports it for its own callers.
export const FARM_WITHERED_HUSK_ITEM_ID = 'withered_husks';

// The two plant-time knob supplies (the knobs phase). They live HERE in the
// content layer, like the husk id above, so the material taxonomy can read
// them as data without importing the engine module that consumes them.
export const FARM_COMPOST_ITEM_ID = 'compost';
export const FARM_GROWTH_TONIC_ITEM_ID = 'growth_tonic';
export const FARM_SUPPLY_ITEM_IDS: readonly string[] = [
  FARM_COMPOST_ITEM_ID,
  FARM_GROWTH_TONIC_ITEM_ID,
];

// Everything a farming cycle can put in a player's bags or take out of them:
// the seed a plant consumes, the produce a harvest grants, its fine twin, the
// husks a failure pays, and the two knob supplies a plant can consume. Derived
// from the catalog, so the crop-ladder phase's seven remaining crops
// self-register with no edit here.
//
// This is the material taxonomy's farming source (see that module): farm
// yields are materials for the same reason node yields are, and the seeds and
// knob supplies are the tradeable input side of the same loop.
export const FARM_MATERIAL_ITEM_IDS: readonly string[] = [
  ...Object.values(FARM_CROPS).flatMap((c) => [c.seedItemId, c.produceItemId, c.fineProduceItemId]),
  FARM_WITHERED_HUSK_ITEM_ID,
  ...FARM_SUPPLY_ITEM_IDS,
];
