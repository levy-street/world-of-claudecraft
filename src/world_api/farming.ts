import type { FarmPatchDef } from '../sim/content/farm_patches';
import type {
  FarmGrowthStage,
  FarmPlantKnobs,
  FarmPlotStatus,
  FarmPlotView,
} from '../sim/professions/farm_projection';

// The stage TYPE travels with the view types. The farmGrowthStage FUNCTION
// deliberately does not: this seam imports src/sim for types only (pinned by
// tests/architecture.test.ts), so a value re-export here would drag the engine
// into the seam. A render consumer imports the function from
// src/sim/professions/farm_projection directly, which the pure-core contract
// expressly allows.
export type { FarmGrowthStage, FarmPatchDef, FarmPlantKnobs, FarmPlotStatus, FarmPlotView };

// Farming, the fifth gathering profession: the static garden-bed geography
// plus the caller's OWN plot state, and the commands that mutate it (plant,
// harvest, and the knobs phase's husk conversion; the plant-time knobs
// themselves ride plantCrop's payload rather than commands of their own,
// because every choice is front-loaded at plant time per D8).
//
// THE WIRE PROJECTION NEVER CARRIES THE HIDDEN OUTCOME SLOTS OR THE YIELD
// SEED. A plot's survival outcome and yield are pre-rolled server secrets
// (PlotState.survivalRoll / PlotState.yieldSeed): leaking either lets a
// client know a crop's fate before its timer runs out. FarmPlotView is built
// by explicit field picks in src/sim/professions/farm_projection.ts, never a
// spread, and tests/snapshots.test.ts pins the absence with an exhaustive
// key-set assertion over the real wire path.
export interface IWorldFarming {
  // Static content read (the RecipeDef precedent in ./professions.ts): both
  // worlds serve src/sim/content/farm_patches.ts directly, since content
  // ships with the client bundle, so this needs no wire round-trip.
  farmPatches: readonly FarmPatchDef[];
  // The caller's own plots, one row per planted bed, sorted by bed id.
  // Server-derived: online it mirrors the `fplot` self delta, offline the
  // Sim projects its own PlayerMeta.farmPlots; `status` is always computed
  // by the authority (`withered` may surface only at or after readyAtMs),
  // never predicted by the client. Empty until the growth phase ships a
  // plant command.
  // CLOCK-BASE CONTRACT: plantedAtMs and readyAtMs are absolutes in the
  // AUTHORITY'S own lockoutNowMs base (epoch ms online, sim-clock ms on the
  // offline and headless hosts). A consumer must never subtract a clock the
  // authority did not use, so no render/ui code may do readyAtMs minus
  // Date.now; rely on `status`, or read this world's own clock through
  // farmNowMs() below, which is the derived-duration surface the contract
  // deferred to the first timer consumer.
  myFarmPlots: readonly FarmPlotView[];
  // This world's OWN authority clock base, read fresh per call: the
  // RaidLockout-template timer read the CLOCK-BASE CONTRACT above deferred to
  // the first timer surface, which is this phase's growth-stage fractions.
  // The Sim returns its sim-clock lockoutNowMs and ClientWorld returns
  // Date.now (the same clock raidLockouts already subtracts, and the base the
  // live server writes its farm timestamps in), so a consumer pairing this
  // with myFarmPlots derives stage and wetness fractions without ever mixing
  // clock bases. Purely COSMETIC: the authoritative facts about a plot remain
  // `status` and the farm SimEvents, never a fraction derived here.
  farmNowMs(): number;
  // Sow `cropId` into the garden bed `bedId`, with the optional plant-time
  // knob payload (compost, farmer's watch, growth tonic: every choice is
  // front-loaded at plant time per D8, so the knobs ride THIS call and there
  // is no later knob command). Server-authoritative in the
  // strongest sense this profession has: the Sim re-validates the bed id
  // against FARM_BED_IDS, the crop id against the crop catalog, that the bed
  // is free FOR THIS PLAYER, the farming skill threshold, that a seed is
  // actually in the sender's bags, and that every REQUESTED knob can be paid
  // from those bags (compost and tonic by count, the watch fee by the
  // tier-scaled produce plan in farm_watch_fee.ts); a knob that cannot be
  // paid denies the whole plant with nothing consumed. The crop-ladder
  // phase's step-12 hoe gate is LIVE: the plant also demands a WIELDABLE
  // farming hoe covering the crop's tier in bags (the wield-filtered scan,
  // refused as farmDenied reason 'tool').
  // It then consumes the seed plus the requested knob payments
  // and pre-rolls the WHOLE growth script (the hidden survival outcomes and
  // the yield seed) in one contiguous rng block, IDENTICAL under every knob
  // combination. The wire carries the two ids plus up to three literal-true
  // knob booleans and nothing else: no item payload, no roll, no deadline,
  // so a client can neither choose its own outcome nor learn it. ClientWorld
  // sends the plant_crop command and never predicts: the new plot row
  // arrives on the `fplot` self delta (its knob flags included) and the
  // outcome as a text-free id-carrying SimEvent.
  plantCrop(bedId: string, cropId: string, knobs?: FarmPlantKnobs): void;
  // Pull the crop out of the garden bed `bedId`. Same authority split: the
  // Sim re-validates the bed id, that the plot is the SENDER'S, and that it
  // is ready or withered, then resolves the yield from the pre-rolled hidden
  // slots and grants produce (or withered husks) plus farming skill. Nothing
  // about the yield is decided or previewed client-side, so a harvest cannot
  // be re-rolled by replaying the command: the pre-roll happened at plant
  // time and the plot is gone once this resolves.
  harvestCrop(bedId: string): void;
  // Trade withered husks for compost at the sim's fixed ratio
  // (FARM_HUSKS_PER_COMPOST): failure turned into the next attempt's
  // insurance. One call converts EVERY complete batch in the caller's bags;
  // the remainder stays. Carries NO payload: the ratio, the batch count and
  // both item ids resolve server-side from the sender's own bags, so there is
  // nothing to forge. The location gate is deliberately permissive until the
  // go-live phase ships the farmer NPCs, which add the NPC range arm.
  convertHusks(): void;
}
