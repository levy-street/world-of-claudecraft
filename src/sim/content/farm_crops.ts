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
// The full eight-crop ladder (two per tier) is packet-locked and ships here:
// the growth-engine phase landed exactly the tier-1 vale_wheat row so the
// engine was testable end to end, and the crop-ladder phase adds the other
// seven with their fine twins (the hoe gates land with the tool ladder in the
// same phase). The skill threshold is NOT a column: it derives from the tier
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

// TUNING, PROVISIONAL, FLAGGED FOR THE MAINTAINER: 35 minutes sits in the
// lower half of the locked tier-1 band (30 to 60 minutes), deliberately
// below vale_wheat's 45 so the two tier-1 crops never share a duration and
// the starter vegetable reads as the quicker, cheaper first plant. It is
// short enough that the D9 fee loop (buy the vendor carrot, plant, come
// back for the harvest) resolves inside one sitting for a first-time
// player, and long enough that a plot stays a check-in visit rather than
// a refresh timer.
const BROOK_CARROT_DURATION_MS = 2_100_000;

// TUNING, PROVISIONAL, FLAGGED FOR THE MAINTAINER: 130 minutes takes the
// high end of the locked tier-2 band (about 2 hours). The high end is
// deliberate on two counts: it stays clear of the tier-2 sibling
// (bog_beet, 8,100,000 ms, 135 minutes; the two crops of a tier must never
// share a duration), and a paddy grain that outruns one sitting pushes the
// second visit past a session boundary, the same check-in thesis
// vale_wheat's mid-band 45 minutes serves one rung down.
const MARSH_RICE_DURATION_MS = 7_800_000;

// TUNING, PROVISIONAL, FLAGGED FOR THE MAINTAINER: 135 minutes takes the
// high end of the locked tier-2 band (about 2 hours). Sitting a quarter
// hour above the flat 120-minute center buys two things: the tier's two
// crops keep distinct timers (the sibling marsh_rice ships at 7,800,000
// ms, 130 minutes, so the pair never collides), and against
// VALE_WHEAT_DURATION_MS (45 minutes) this timer clearly outlives one
// sitting, making the marsh root the plant-now, collect-next-session rung
// of the ladder rather than a longer wheat.
const BOG_BEET_DURATION_MS = 8_100_000;

// TUNING, PROVISIONAL, FLAGGED FOR THE MAINTAINER: 4 hours flat sits on
// the round center of the locked tier-3 band (about 4 hours), the midpoint
// the tier-3 sibling (frost_gourd, 16,200,000 ms, 4 hours 30 minutes)
// deliberately leaves free, so the two tier-3 crops never share a
// duration. Against VALE_WHEAT_DURATION_MS (45 minutes) it buys the hardy
// mountain-grain feel: plant before one session and the harvest is the
// natural first stop of the next, while staying comfortably short of the
// tier-4 overnight band (8 to 11 hours).
const HIGHLAND_BARLEY_DURATION_MS = 14_400_000;

// TUNING, PROVISIONAL, FLAGGED FOR THE MAINTAINER: 4 hours 30 minutes takes
// the top of the locked tier-3 band (about 4 hours). The high end buys two
// things: it reads as the slow cold-hardy grower Thornpeak's flavor promises
// against vale_wheat's 45-minute check-in, and it deliberately leaves the
// round 4-hour midpoint free for the tier-3 sibling crop, so the two crops of
// a tier cannot share a duration even if the sibling takes the obvious
// center. At this length a morning plant is ready by evening and an evening
// plant is ready next session, which keeps the check-in thesis intact one
// rung below the overnight tier-4 band.
const FROST_GOURD_DURATION_MS = 16_200_000;

// TUNING, PROVISIONAL, FLAGGED FOR THE MAINTAINER: 10 hours takes the high
// end of the locked tier-4 overnight band (8 to 11 hours): the Evergarden
// showcase melon is the ladder's prestige wait, so planted at the end of an
// evening session it is ready the next evening's first check-in even for a
// player who logs in late, while staying an hour under the band ceiling.
// The tier-4 sibling (evergarden_greens) sits half an hour higher at
// 37,800,000 ms (10.5 hours); the two crops of a tier never share a
// duration.
const GILDED_SUNMELON_DURATION_MS = 36_000_000;

// TUNING, PROVISIONAL, FLAGGED FOR THE MAINTAINER: 10.5 hours takes the
// HIGH end of the locked tier-4 overnight band (8 to 11 hours), half an
// hour above the tier-4 sibling (gilded_sunmelon, 36,000,000 ms, 10 hours),
// so the two tier-4 durations never collide. Against a plant at an evening
// logoff, the extra margin past 8 hours buys a crop that is not yet ready
// at a short morning check and lands comfortably before the NEXT evening
// session: the Evergarden capstone reads as a full-day commitment on the
// check-in rhythm, never an alarm-clock race, and (per the header above)
// the far end never rots, so the overshoot is pure slack.
const EVERGARDEN_GREENS_DURATION_MS = 37_800_000;

const FARM_CROP_ROWS: readonly FarmCropDef[] = [
  {
    id: 'vale_wheat',
    tier: 1,
    durationMs: VALE_WHEAT_DURATION_MS,
    seedItemId: 'vale_wheat_seed',
    produceItemId: 'vale_wheat',
    fineProduceItemId: 'fine_vale_wheat',
  },
  {
    id: 'brook_carrot',
    tier: 1,
    durationMs: BROOK_CARROT_DURATION_MS,
    seedItemId: 'brook_carrot_seed',
    produceItemId: 'brook_carrot',
    fineProduceItemId: 'fine_brook_carrot',
  },
  {
    id: 'marsh_rice',
    tier: 2,
    durationMs: MARSH_RICE_DURATION_MS,
    seedItemId: 'marsh_rice_seed',
    produceItemId: 'marsh_rice',
    fineProduceItemId: 'fine_marsh_rice',
  },
  {
    id: 'bog_beet',
    tier: 2,
    durationMs: BOG_BEET_DURATION_MS,
    seedItemId: 'bog_beet_seed',
    produceItemId: 'bog_beet',
    fineProduceItemId: 'fine_bog_beet',
  },
  {
    id: 'highland_barley',
    tier: 3,
    durationMs: HIGHLAND_BARLEY_DURATION_MS,
    seedItemId: 'highland_barley_seed',
    produceItemId: 'highland_barley',
    fineProduceItemId: 'fine_highland_barley',
  },
  {
    id: 'frost_gourd',
    tier: 3,
    durationMs: FROST_GOURD_DURATION_MS,
    seedItemId: 'frost_gourd_seed',
    produceItemId: 'frost_gourd',
    fineProduceItemId: 'fine_frost_gourd',
  },
  {
    id: 'gilded_sunmelon',
    tier: 4,
    durationMs: GILDED_SUNMELON_DURATION_MS,
    seedItemId: 'gilded_sunmelon_seed',
    produceItemId: 'gilded_sunmelon',
    fineProduceItemId: 'fine_gilded_sunmelon',
  },
  {
    id: 'evergarden_greens',
    tier: 4,
    durationMs: EVERGARDEN_GREENS_DURATION_MS,
    seedItemId: 'evergarden_greens_seed',
    produceItemId: 'evergarden_greens',
    fineProduceItemId: 'fine_evergarden_greens',
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
