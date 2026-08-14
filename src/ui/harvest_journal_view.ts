// Pure, host-agnostic core for the Harvest Journal: the farmer's read-only
// list of their own planted beds, one row per plot, with the time left on
// each crop.
//
// INFORMATIONAL ONLY. The journal never plants and never harvests: it names
// what is in the ground, where, how long is left, and which plant-time knobs
// were paid for. Every action stays where it already lives (the world beds
// themselves), so this core emits no command and the window it feeds sends
// none.
//
// THE CLOCK BASE IS THE CALLER'S. `nowMs` arrives as an argument and must be
// the SAME world's lockoutNowMs base the plot timestamps were written in
// (IWorldFarming.farmNowMs(), per the CLOCK-BASE CONTRACT in
// src/world_api/farming.ts). Nothing here reads a wall clock, which is what
// keeps this file a pure core a Vitest drives directly.
//
// READY COMES FROM `status`, NEVER FROM THE COUNTDOWN. The authority decides
// when a plot is ready (and a doomed crop only reveals itself at its
// deadline), so a countdown that has run out while `status` still says
// 'growing' renders the zero-clamped 'finishing' arm rather than promising a
// harvest the server would refuse. That is the arm a client clock running
// ahead of the authority's lands in, and it is deliberately not Ready.
//
// DOM/Three-free (registered in tests/architecture.test.ts UI_PURE_CORES).

import { farmCropById } from '../sim/content/farm_crops';
import type { FarmPatchDef } from '../sim/content/farm_patches';
import {
  type FarmGrowthStage,
  type FarmPlotStatus,
  type FarmPlotView,
  farmGrowthStage,
} from '../sim/professions/farm_projection';
import type { TranslationKey } from './i18n.catalog';

/** One rendered clock: the line's key plus the decomposed parts it splices.
 *  The core picks the ARM and the numbers; the window formats them through
 *  formatNumber and t(), so no colon string is ever hand-built here. */
export interface HarvestJournalClock {
  key: TranslationKey;
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
}

/** What a row's time cell says. `growing` is the only arm that carries a live
 *  countdown, and therefore the only arm the window stamps with a rebind
 *  attribute for its 1 Hz tick. */
export type HarvestJournalTimer =
  | { kind: 'growing'; msRemaining: number; clock: HarvestJournalClock }
  | { kind: 'finishing' }
  | { kind: 'ready' }
  | { kind: 'withered' };

/** Where a bed sits: its patch, the patch's zone (the only localized location
 *  handle farming content carries), and the bed's 1-based position within its
 *  patch, so two beds in one garden are tellable apart. */
export interface HarvestJournalBedSite {
  patchId: string;
  zoneId: string;
  bedIndex: number;
}

export interface HarvestJournalRow {
  bedId: string;
  cropId: string;
  /** The item whose localized name NAMES the crop. Crop records carry no name
   *  of their own, so the produce is the display handle (the farming_view.ts
   *  seed-token hop, one step over). Falls back to the crop id for a row a
   *  client's catalog does not carry (content drift against a newer server). */
  produceItemId: string;
  patchId: string | null;
  zoneId: string | null;
  /** 1-based within the patch; 0 when the bed resolves to no patch. */
  bedIndex: number;
  status: FarmPlotStatus;
  stage: FarmGrowthStage;
  readyAtMs: number;
  timer: HarvestJournalTimer;
  compost: boolean;
  watch: boolean;
  tonic: boolean;
  /** The VALUE signature of everything the row's markup renders except the
   *  live countdown digits. See harvestJournalRowSignature. */
  signature: string;
}

/** The three states the window paints. `novice` and `empty` are both "no
 *  plots", split because the honest sentence differs: a farmer with skill has
 *  simply harvested everything, while a character at skill 0 has never worked
 *  a bed and needs to be told where to start. Gathering professions have no
 *  learn gate in this game, so `novice` never says a plant would be refused. */
export type HarvestJournalView =
  | { kind: 'novice' }
  | { kind: 'empty' }
  | { kind: 'rows'; rows: readonly HarvestJournalRow[] };

export interface HarvestJournalInput {
  /** The caller's own plots (IWorldFarming.myFarmPlots), already sorted by bed
   *  id by the projection. READ-IDENTITY WARNING: the Sim allocates a fresh
   *  array per read while ClientWorld reuses one until the next delta, so this
   *  core never keeps a reference to it and never compares two of them by
   *  identity; the value signature below is the only change detector. */
  plots: readonly FarmPlotView[];
  patches: readonly FarmPatchDef[];
  nowMs: number;
  farmingSkill: number;
}

/** Decompose a remaining duration into the arm that reads best at its scale.
 *  Seconds are CEILED, so a live timer never reads zero while the crop is
 *  still growing, and the sub-hour arms carry seconds so the 1 Hz tick has
 *  something to move (a minutes-only arm would freeze the visible line for a
 *  whole minute at a time). A non-finite input reads as zero rather than
 *  rendering NaN. */
export function harvestJournalClock(msRemaining: number): HarvestJournalClock {
  const totalSeconds = Number.isFinite(msRemaining)
    ? Math.max(0, Math.ceil(msRemaining / 1000))
    : 0;
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  const key: TranslationKey =
    days > 0
      ? 'hudChrome.harvestJournal.remainingDaysHours'
      : hours > 0
        ? 'hudChrome.harvestJournal.remainingHoursMinutes'
        : minutes > 0
          ? 'hudChrome.harvestJournal.remainingMinutesSeconds'
          : 'hudChrome.harvestJournal.remainingSeconds';
  return { key, days, hours, minutes, seconds };
}

/** The time cell for one plot. THE ORDER OF THESE BRANCHES IS THE CONTRACT:
 *  the authority's `status` is consulted first and the subtraction second, so
 *  a withered plot never shows a countdown and a plot whose deadline has
 *  passed while `status` still says 'growing' lands on 'finishing' rather
 *  than on Ready. Only the growing arm can carry digits. */
export function harvestJournalTimer(
  plot: Pick<FarmPlotView, 'status' | 'readyAtMs'>,
  nowMs: number,
): HarvestJournalTimer {
  if (plot.status === 'withered') return { kind: 'withered' };
  if (plot.status === 'ready') return { kind: 'ready' };
  const remaining = plot.readyAtMs - nowMs;
  const msRemaining = Number.isFinite(remaining) ? Math.max(0, remaining) : 0;
  if (msRemaining <= 0) return { kind: 'finishing' };
  return { kind: 'growing', msRemaining, clock: harvestJournalClock(msRemaining) };
}

/** The patch a bed belongs to. Farming content carries no bed-to-patch map
 *  (bed ids are conventionally named but nothing parses them), so this is the
 *  one walk, over four patches, done per row at open and at 1 Hz over at most
 *  a couple of dozen beds. */
export function harvestJournalBedSite(
  bedId: string,
  patches: readonly FarmPatchDef[],
): HarvestJournalBedSite | null {
  for (const patch of patches) {
    const index = patch.beds.findIndex((bed) => bed.id === bedId);
    if (index >= 0) return { patchId: patch.id, zoneId: patch.zoneId, bedIndex: index + 1 };
  }
  return null;
}

/** The VALUE signature of one row: every field the row's markup renders
 *  EXCEPT the live countdown digits, which the window's tick rewrites in
 *  place. Value-based on purpose (see the read-identity warning on
 *  HarvestJournalInput): the two worlds disagree about array and object
 *  identity, so a reference compare would either repaint every tick offline
 *  or never repaint online. `timer.kind` is in, which is what makes a
 *  growing-to-ready or growing-to-finishing flip force a full repaint on the
 *  tick that first observes it. */
export function harvestJournalRowSignature(row: Omit<HarvestJournalRow, 'signature'>): string {
  return [
    row.bedId,
    row.cropId,
    row.zoneId ?? '',
    String(row.bedIndex),
    row.status,
    row.stage,
    row.timer.kind,
    String(row.readyAtMs),
    row.compost ? '1' : '0',
    row.watch ? '1' : '0',
    row.tonic ? '1' : '0',
  ].join('|');
}

/** The signature of a whole painted view, the window's one repaint gate. */
export function harvestJournalViewSignature(view: HarvestJournalView): string {
  if (view.kind !== 'rows') return view.kind;
  return `rows|${view.rows.map((row) => row.signature).join(';')}`;
}

export function buildHarvestJournalView(input: HarvestJournalInput): HarvestJournalView {
  const rows: HarvestJournalRow[] = [];
  for (const plot of input.plots) {
    const site = harvestJournalBedSite(plot.bedId, input.patches);
    const fields: Omit<HarvestJournalRow, 'signature'> = {
      bedId: plot.bedId,
      cropId: plot.cropId,
      produceItemId: farmCropById(plot.cropId)?.produceItemId ?? plot.cropId,
      patchId: site?.patchId ?? null,
      zoneId: site?.zoneId ?? null,
      bedIndex: site?.bedIndex ?? 0,
      status: plot.status,
      // Cosmetic only, and only ever rendered on a growing row: a ready or
      // withered plot reads 'ready' here forever, which keeps it out of the
      // signature's churn.
      stage: farmGrowthStage(plot, input.nowMs),
      readyAtMs: plot.readyAtMs,
      timer: harvestJournalTimer(plot, input.nowMs),
      compost: plot.compost,
      watch: plot.watch,
      tonic: plot.tonic,
    };
    rows.push({ ...fields, signature: harvestJournalRowSignature(fields) });
  }
  if (rows.length > 0) return { kind: 'rows', rows };
  return input.farmingSkill > 0 ? { kind: 'empty' } : { kind: 'novice' };
}
