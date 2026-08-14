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

// Server-derived plot status. `withered` may surface only at or after
// readyAtMs (a crop that is going to fail still LOOKS like it is growing
// until its timer runs out, so the hidden survival pre-roll stays
// unobservable while the plot grows).
export type FarmPlotStatus = 'growing' | 'ready' | 'withered';

// The plant-time knob request (the knobs phase), the payload shape plantCrop
// accepts on the IWorld seam and the wire alike: three independent opt-ins
// mirroring the three PlotState flags above. Every knob is chosen AT PLANT
// TIME and never later (D8, front-loaded only); an absent field means the
// knob was not requested, exactly as `false` does, which is what lets the
// wire frame omit unset knobs and stay byte-identical to the pre-knob
// protocol on a plain plant.
export interface FarmPlantKnobs {
  compost?: boolean;
  watch?: boolean;
  tonic?: boolean;
}

// The survival ramp (the growth-engine phase). Pure arithmetic, no rng, no
// content import: the caller supplies the crop's tier, which keeps this file
// the pure leaf its banner promises.
//
// TUNING, PROVISIONAL, FLAGGED FOR THE MAINTAINER. Base survival is 85 percent
// at the crop's own gate and ramps to 100 percent at the top of its 25-point
// band, so one full band above the threshold retires the crop's risk
// permanently. Compost and the farmer's watch each add 10 points on top (LIVE
// since the knobs phase: plantCrop stores the flags a paid knob armed, and
// this bonus arm is what they buy), and the whole thing caps at 1.
export const FARM_SURVIVAL_AT_GATE = 0.85;
export const FARM_SURVIVAL_BAND_SPAN = 25;
export const FARM_SURVIVAL_COMPOST_BONUS = 0.1;
export const FARM_SURVIVAL_WATCH_BONUS = 0.1;

/** The chance a crop of this tier survives for a farmer at this proficiency.
 *
 *  EVALUATED AT READ TIME against CURRENT skill, never at plant time, which is
 *  what makes "out-levelling a crop permanently retires its risk" literally
 *  true: a plot planted at the gate and harvested a band later survives. That
 *  is only ever player-favorable because gathering proficiency is a monotonic
 *  additive-only counter with no decrement path, so this number can never fall
 *  between planting and harvesting.
 *
 *  The band position is CLAMPED into [0, 1] rather than branched: at or above
 *  the band top the chance is exactly 1, and below the gate (unreachable
 *  through the plant gate, but reachable by a hand-edited save naming a crop
 *  above the farmer's skill) it floors at the gate value rather than dipping
 *  under it. A non-finite skill reads as 0. */
export function farmSurvivalChance(
  skill: number,
  cropTier: number,
  compost: boolean,
  watch: boolean,
): number {
  const threshold = (cropTier - 1) * FARM_SURVIVAL_BAND_SPAN;
  const s = Number.isFinite(skill) ? skill : 0;
  const band = Math.max(0, Math.min(1, (s - threshold) / FARM_SURVIVAL_BAND_SPAN));
  const base = FARM_SURVIVAL_AT_GATE + (1 - FARM_SURVIVAL_AT_GATE) * band;
  const bonuses =
    (compost ? FARM_SURVIVAL_COMPOST_BONUS : 0) + (watch ? FARM_SURVIVAL_WATCH_BONUS : 0);
  return Math.min(1, base + bonuses);
}

/** Whether a plot's pre-rolled outcome beats the ramp above. THE one
 *  definition: the projection's `withered` status and the harvest's payout
 *  both call it, so a plot can never read as ready and then pay husks.
 *
 *  An ABSENT survivalRoll survives. That case is unreachable for a plot this
 *  engine planted (plantCrop always writes both hidden slots, and the load
 *  side DERIVES a replacement for a missing one rather than dropping it), and
 *  where it is reachable at all the player-favorable answer is the right one:
 *  a bug in our own hidden state must never destroy a real crop. */
export function farmPlotSurvived(plot: PlotState, skill: number, cropTier: number): boolean {
  if (!Number.isFinite(plot.survivalRoll)) return true;
  return (
    (plot.survivalRoll as number) < farmSurvivalChance(skill, cropTier, plot.compost, plot.watch)
  );
}

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

// The shared empty projection (the EMPTY_TOOL_EFFECT_SLOT_VIEWS precedent in
// professions/tools.ts): projection runs per session per tick on the snapshot
// path, and the empty map is the overwhelming majority, so a fresh [] per
// call would be a per-player-per-tick allocation for nothing.
export const EMPTY_FARM_PLOT_VIEWS: readonly FarmPlotView[] = Object.freeze([]);

// Project a player's plots for the wire and both IWorld implementations.
// Explicit field picks are the leak barrier: a future PlotState field stays
// sim-side unless someone adds it here on purpose and re-pins the exhaustive
// key-set test. Rows are SORTED by bed id so the JSON form is a stable fplot
// delta signature (the cprof sorted-signature precedent): Map insertion order
// would otherwise vary with plant order and re-broadcast unchanged state.
// `farmingSkill` and `cropTierOf` arrive as explicit arguments for the same
// reason the allowlists do in farm_persist.ts: this stays a pure leaf, with no
// content-table import, so a Vitest drives it without shipped content.
// `cropTierOf` is passed as a module-level function reference (the caller uses
// content/farm_crops.ts farmCropTier), never a fresh closure, because this
// runs per session per tick on the snapshot path.
export function projectFarmPlots(
  plots: ReadonlyMap<string, PlotState>,
  nowMs: number,
  farmingSkill: number,
  cropTierOf: (cropId: string) => number,
): readonly FarmPlotView[] {
  if (plots.size === 0) return EMPTY_FARM_PLOT_VIEWS;
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
      // The survival read is gated behind the deadline so the hidden pre-roll
      // stays unobservable while the plot grows: a doomed crop is
      // indistinguishable from a healthy one right up to its ready time.
      status:
        nowMs < p.readyAtMs
          ? 'growing'
          : farmPlotSurvived(p, farmingSkill, cropTierOf(p.cropId))
            ? 'ready'
            : 'withered',
    });
  }
  rows.sort((a, b) => (a.bedId < b.bedId ? -1 : a.bedId > b.bedId ? 1 : 0));
  return rows;
}

/** The four derived visual growth stages (see the banner). Pure, stateless,
 *  and exported so the render phase reads THIS definition rather than
 *  re-deriving the thirds. A zero-length window (the grow-now mint) or a
 *  negative one reads as ready.
 *
 *  CLOCK-BASE CONTRACT for the future render/ui consumer: `nowMs` MUST be the
 *  same world's lockoutNowMs-base clock the plot's own timestamps were written
 *  in (epoch ms online, sim-clock ms on the offline and headless hosts).
 *  Feeding Date.now() to an offline plot makes every bed render ready the
 *  instant it is planted; there is no cross-base conversion. The parameter is
 *  a structural minimum (the two timestamps), so both the public FarmPlotView
 *  and the sim-side PlotState fit without ever needing the hidden slots. The
 *  derived msRemaining wire field (the RaidLockout template) stays owed to the
 *  first timer surface, Phase 8. */
export type FarmGrowthStage = 'sprout' | 'seedling' | 'maturing' | 'ready';

export function farmGrowthStage(
  plot: Pick<PlotState, 'plantedAtMs' | 'readyAtMs'>,
  nowMs: number,
): FarmGrowthStage {
  const duration = plot.readyAtMs - plot.plantedAtMs;
  if (duration <= 0) return 'ready';
  const elapsed = (nowMs - plot.plantedAtMs) / duration;
  if (elapsed >= 1) return 'ready';
  if (elapsed >= 2 / 3) return 'maturing';
  if (elapsed >= 1 / 3) return 'seedling';
  return 'sprout';
}
