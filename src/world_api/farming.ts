import type { FarmPatchDef } from '../sim/content/farm_patches';
import type { FarmPlotStatus, FarmPlotView } from '../sim/professions/farm_projection';

export type { FarmPatchDef, FarmPlotStatus, FarmPlotView };

// Farming, the fifth gathering profession: the static garden-bed geography
// plus the caller's OWN plot state. READS ONLY as of the patches-and-plots
// phase: planting, harvesting, growth and knobs land in later phases, so no
// commands or events belong here yet.
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
}
