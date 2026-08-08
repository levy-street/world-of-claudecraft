// Farming plot state and its public projection (patches-and-plots phase).
//
// A plot is PER-PLAYER state on a SHARED static bed: two players see the same
// garden bed differently, the nodeHarvestCooldowns precedent. The full record
// (PlotState) lives on PlayerMeta.farmPlots keyed by bed id and is persisted in
// CharacterState via src/sim/professions/farm_persist.ts; the wire and both
// IWorld implementations serve only the FarmPlotView projection below.
//
// HIDDEN PRE-ROLL DOCTRINE (recon-locked): every random outcome of a growth
// cycle is rolled ONCE at plant time and stored in the hidden slots
// (survivalRoll, yieldSeed), the fishing hidden-bite-delay template, so timer
// expiry draws nothing and the three hosts stay deterministic. The growth
// phase fills the slots; this phase only declares them. THE HIDDEN SLOTS
// NEVER CROSS THE WIRE: projectFarmPlots builds its rows by explicit field
// picks, never by spreading PlotState, and tests/snapshots.test.ts pins the
// absence with an exhaustive key-set assertion.
//
// Pure leaf: no SimContext, no content-table import, no rng, explicit
// arguments only (the fishing_zones.ts contract), so a Vitest imports it
// directly. Wall-clock time enters ONLY as the nowMs argument; callers pass
// ctx.lockoutNowMs() (the raidLockouts epoch-ms idiom), never Date.now.

// Per-player state for one planted bed. All timestamps are milliseconds in
// the HOST'S OWN lockoutNowMs base: epoch ms on the server (Date.now is
// injected there), sim-clock ms counted from zero on the offline and
// headless hosts (the uninjected default). A consumer must only ever compare
// these against the SAME world's clock, never against Date.now directly; the
// growth phase adds a RaidLockout-style derived duration when a timer UI
// lands. The knob flags are declared now and wired by the knobs phase (all
// default off at plant time); `notified` is reserved for the ready-notice
// phase and is serialized so a delivered notice never repeats across
// sessions.
export interface PlotState {
  cropId: string;
  plantedAtMs: number;
  readyAtMs: number;
  // Hidden pre-rolled outcome slots: filled at plant time by the growth
  // phase, consumed at harvest. Server secrets, see the doctrine above.
  survivalRoll?: number;
  yieldSeed?: number;
  compost: boolean;
  watch: boolean;
  tonic: boolean;
  notified: boolean;
}

// Server-derived plot status. `withered` joins in the growth phase and may
// surface only at or after readyAtMs (a crop that is going to fail still
// LOOKS like it is growing until its timer runs out, so the hidden survival
// pre-roll stays unobservable while the plot grows).
export type FarmPlotStatus = 'growing' | 'ready' | 'withered';

// The public projection: the ONLY plot shape render/ui or the wire ever see.
// Ids, flags and epoch-ms numbers only, never localized text.
export interface FarmPlotView {
  bedId: string;
  cropId: string;
  plantedAtMs: number;
  readyAtMs: number;
  compost: boolean;
  watch: boolean;
  tonic: boolean;
  notified: boolean;
  status: FarmPlotStatus;
}

// Project a player's plots for the wire and both IWorld implementations.
// Explicit field picks are the leak barrier: a future PlotState field stays
// sim-side unless someone adds it here on purpose and re-pins the exhaustive
// key-set test. Rows are SORTED by bed id so the JSON form is a stable fplot
// delta signature (the cprof sorted-signature precedent): Map insertion order
// would otherwise vary with plant order and re-broadcast unchanged state.
export function projectFarmPlots(
  plots: ReadonlyMap<string, PlotState>,
  nowMs: number,
): FarmPlotView[] {
  const rows: FarmPlotView[] = [];
  for (const [bedId, p] of plots) {
    rows.push({
      bedId,
      cropId: p.cropId,
      plantedAtMs: p.plantedAtMs,
      readyAtMs: p.readyAtMs,
      compost: p.compost,
      watch: p.watch,
      tonic: p.tonic,
      notified: p.notified,
      status: nowMs < p.readyAtMs ? 'growing' : 'ready',
    });
  }
  rows.sort((a, b) => (a.bedId < b.bedId ? -1 : a.bedId > b.bedId ? 1 : 0));
  return rows;
}
