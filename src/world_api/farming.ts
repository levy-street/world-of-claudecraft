import type { FarmPatchDef } from '../sim/content/farm_patches';
import type { FarmPlotStatus, FarmPlotView } from '../sim/professions/farm_projection';

export type { FarmPatchDef, FarmPlotStatus, FarmPlotView };

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
  // Date.now; rely on `status`, or wait for the growth phase's derived
  // duration field (the RaidLockout msRemaining template), which lands with
  // the first timer surface.
  myFarmPlots: readonly FarmPlotView[];
  // Sow `cropId` into the garden bed `bedId`. Server-authoritative in the
  // strongest sense this profession has: the Sim re-validates the bed id
  // against FARM_BED_IDS, the crop id against the crop catalog, that the bed
  // is free FOR THIS PLAYER, the farming skill threshold, and that a seed is
  // actually in the sender's bags (the hoe-tier and wield gates are DEFERRED
  // to the crop-ladder phase: no farming tool kind exists yet),
  // then consumes the seed and pre-rolls the WHOLE growth script (the hidden
  // survival outcomes and the yield seed) in one contiguous rng block. The
  // wire carries two ids and nothing else: no item payload, no roll, no
  // deadline, so a client can neither choose its own outcome nor learn it.
  // ClientWorld sends the plant_crop command and never predicts: the new plot
  // row arrives on the `fplot` self delta and the outcome as a text-free
  // id-carrying SimEvent.
  plantCrop(bedId: string, cropId: string): void;
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
