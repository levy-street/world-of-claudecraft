// The Harvest Journal's pure view core: row projection, the clock arms, the
// two empty states, and the value signature the window's 1 Hz tick uses as its
// only repaint gate.
//
// The load-bearing claim under test, and the reason this file leans on it
// hardest: READY IS READ FROM THE AUTHORITY'S `status`, NEVER FROM THE
// COUNTDOWN REACHING ZERO. A client clock running ahead of the server's must
// land on the zero-clamped 'finishing' arm, not on Ready, because a harvest
// there would be refused.
//
// DOM-free: the core is imported directly, exactly as a pure core should be.

import { describe, expect, it } from 'vitest';
import type { FarmPatchDef } from '../src/sim/content/farm_patches';
import { FARM_PATCHES } from '../src/sim/content/farm_patches';
import type { FarmPlotView } from '../src/sim/professions/farm_projection';
import {
  buildHarvestJournalView,
  type HarvestJournalRow,
  harvestJournalBedSite,
  harvestJournalClock,
  harvestJournalRowSignature,
  harvestJournalTimer,
  harvestJournalViewSignature,
} from '../src/ui/harvest_journal_view';

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** A fresh plot every call: nothing here is ever shared between two
 *  expectations, so a signature comparison can never degrade into an object
 *  comparing with itself. */
const plot = (over: Partial<FarmPlotView> = {}): FarmPlotView => ({
  bedId: 'bed_eastbrook_1',
  cropId: 'vale_wheat',
  plantedAtMs: 0,
  readyAtMs: 10 * MINUTE,
  compost: false,
  watch: false,
  tonic: false,
  notified: false,
  status: 'growing',
  ...over,
});

const rowsOf = (
  plots: readonly FarmPlotView[],
  nowMs: number,
  farmingSkill = 40,
  patches: readonly FarmPatchDef[] = FARM_PATCHES,
): readonly HarvestJournalRow[] => {
  const view = buildHarvestJournalView({ plots, patches, nowMs, farmingSkill });
  if (view.kind !== 'rows') throw new Error(`expected rows, got ${view.kind}`);
  return view.rows;
};

describe('harvest journal: the time cell', () => {
  it('renders a live countdown while the plot is growing and time is left', () => {
    const timer = harvestJournalTimer(plot({ readyAtMs: 10 * MINUTE }), 4 * MINUTE);
    expect(timer.kind).toBe('growing');
    if (timer.kind !== 'growing') throw new Error('unreachable');
    expect(timer.msRemaining).toBe(6 * MINUTE);
    expect(timer.clock.key).toBe('hudChrome.harvestJournal.remainingMinutesSeconds');
    expect(timer.clock.minutes).toBe(6);
    expect(timer.clock.seconds).toBe(0);
  });

  it("renders 'ready' with no countdown, and ONLY from the authority's status", () => {
    // Same deadline and same clock reading as the growing case above; the only
    // thing that changed is the authority's word.
    const timer = harvestJournalTimer(
      plot({ status: 'ready', readyAtMs: 10 * MINUTE }),
      4 * MINUTE,
    );
    expect(timer).toEqual({ kind: 'ready' });
  });

  it('renders withered without a countdown even with time still on the clock', () => {
    const timer = harvestJournalTimer(
      plot({ status: 'withered', readyAtMs: 10 * MINUTE }),
      4 * MINUTE,
    );
    expect(timer).toEqual({ kind: 'withered' });
  });

  it("zero-clamps to 'finishing' when the deadline has passed but status is still growing", () => {
    const timer = harvestJournalTimer(plot({ readyAtMs: 10 * MINUTE }), 10 * MINUTE + SECOND);
    expect(timer).toEqual({ kind: 'finishing' });
  });

  it('treats the exact deadline instant as finishing, not as a zero-length countdown', () => {
    expect(harvestJournalTimer(plot({ readyAtMs: 10 * MINUTE }), 10 * MINUTE)).toEqual({
      kind: 'finishing',
    });
  });

  // THE ACCEPTANCE-CRITERIA SKEW CASE. A client clock hours ahead of the
  // authority's is the exact shape that would make a naive `msRemaining <= 0`
  // render Ready and invite a harvest the server refuses.
  it('NEVER renders ready from a clock running far ahead of the deadline', () => {
    const skewed = harvestJournalTimer(plot({ readyAtMs: 10 * MINUTE }), 10 * MINUTE + 6 * HOUR);
    expect(skewed.kind).not.toBe('ready');
    expect(skewed).toEqual({ kind: 'finishing' });
    const rows = rowsOf([plot({ readyAtMs: 10 * MINUTE })], 10 * MINUTE + 6 * HOUR);
    expect(rows[0]?.timer.kind).toBe('finishing');
    expect(rows[0]?.status).toBe('growing');
  });

  it('reads a non-finite clock as finishing rather than rendering NaN', () => {
    expect(harvestJournalTimer(plot({ readyAtMs: Number.NaN }), 0)).toEqual({ kind: 'finishing' });
    expect(harvestJournalTimer(plot({ readyAtMs: 10 * MINUTE }), Number.NaN)).toEqual({
      kind: 'finishing',
    });
  });
});

describe('harvest journal: the clock arms', () => {
  // One case per arm, each with a value the NEIGHBOURING arms would render
  // differently, so a collapsed branch fails rather than coincidentally
  // agreeing.
  it('picks the days arm past a day and carries the leftover hours', () => {
    const clock = harvestJournalClock(2 * DAY + 5 * HOUR + 30 * MINUTE);
    expect(clock.key).toBe('hudChrome.harvestJournal.remainingDaysHours');
    expect(clock.days).toBe(2);
    expect(clock.hours).toBe(5);
  });

  it('picks the hours arm under a day and carries the leftover minutes', () => {
    const clock = harvestJournalClock(3 * HOUR + 7 * MINUTE);
    expect(clock.key).toBe('hudChrome.harvestJournal.remainingHoursMinutes');
    expect(clock.days).toBe(0);
    expect(clock.hours).toBe(3);
    expect(clock.minutes).toBe(7);
  });

  it('picks the minutes-and-seconds arm under an hour', () => {
    const clock = harvestJournalClock(12 * MINUTE + 34 * SECOND);
    expect(clock.key).toBe('hudChrome.harvestJournal.remainingMinutesSeconds');
    expect(clock.hours).toBe(0);
    expect(clock.minutes).toBe(12);
    expect(clock.seconds).toBe(34);
  });

  it('picks the seconds-only arm inside the final minute', () => {
    const clock = harvestJournalClock(45 * SECOND);
    expect(clock.key).toBe('hudChrome.harvestJournal.remainingSeconds');
    expect(clock.minutes).toBe(0);
    expect(clock.seconds).toBe(45);
  });

  it('ceils the seconds so a live timer never reads zero while a crop still grows', () => {
    const clock = harvestJournalClock(1);
    expect(clock.seconds).toBe(1);
    expect(clock.key).toBe('hudChrome.harvestJournal.remainingSeconds');
  });

  it('floors at zero for a negative or non-finite duration', () => {
    expect(harvestJournalClock(-5 * MINUTE)).toEqual({
      key: 'hudChrome.harvestJournal.remainingSeconds',
      days: 0,
      hours: 0,
      minutes: 0,
      seconds: 0,
    });
    expect(harvestJournalClock(Number.POSITIVE_INFINITY).seconds).toBe(0);
  });
});

describe('harvest journal: rows', () => {
  it('names the crop by its produce item and locates the bed in its patch', () => {
    const [row] = rowsOf([plot({ bedId: 'bed_mirefen_3', cropId: 'marsh_rice' })], 0);
    expect(row?.produceItemId).toBe('marsh_rice');
    expect(row?.patchId).toBe('patch_mirefen');
    expect(row?.zoneId).toBe('mirefen_marsh');
    // 1-based within its OWN patch, not across the whole table.
    expect(row?.bedIndex).toBe(3);
  });

  it('degrades an unknown crop id to the id itself rather than an empty cell', () => {
    const [row] = rowsOf([plot({ cropId: 'not_a_shipped_crop' })], 0);
    expect(row?.produceItemId).toBe('not_a_shipped_crop');
  });

  it('reports an unplaceable bed as having no patch instead of guessing one', () => {
    const [row] = rowsOf([plot({ bedId: 'bed_from_a_newer_server' })], 0);
    expect(row?.patchId).toBeNull();
    expect(row?.zoneId).toBeNull();
    expect(row?.bedIndex).toBe(0);
    expect(harvestJournalBedSite('bed_from_a_newer_server', FARM_PATCHES)).toBeNull();
  });

  it('carries each plant-time knob independently', () => {
    const [none] = rowsOf([plot()], 0);
    expect([none?.compost, none?.watch, none?.tonic]).toEqual([false, false, false]);
    // One row per knob, so a row that hardcoded any single flag fails on its
    // own case rather than hiding behind an all-on fixture.
    const [composted] = rowsOf([plot({ compost: true })], 0);
    expect([composted?.compost, composted?.watch, composted?.tonic]).toEqual([true, false, false]);
    const [watched] = rowsOf([plot({ watch: true })], 0);
    expect([watched?.compost, watched?.watch, watched?.tonic]).toEqual([false, true, false]);
    const [tonicked] = rowsOf([plot({ tonic: true })], 0);
    expect([tonicked?.compost, tonicked?.watch, tonicked?.tonic]).toEqual([false, false, true]);
  });

  it('derives the growth stage from the plot window and the passed clock', () => {
    const growing = plot({ plantedAtMs: 0, readyAtMs: 30 * MINUTE });
    expect(rowsOf([growing], 1 * MINUTE)[0]?.stage).toBe('sprout');
    expect(rowsOf([growing], 12 * MINUTE)[0]?.stage).toBe('seedling');
    expect(rowsOf([growing], 25 * MINUTE)[0]?.stage).toBe('maturing');
    expect(rowsOf([growing], 30 * MINUTE)[0]?.stage).toBe('ready');
  });

  it('keeps one row per plot, in the order the projection served them', () => {
    const rows = rowsOf(
      [
        plot({ bedId: 'bed_eastbrook_1' }),
        plot({ bedId: 'bed_eastbrook_2' }),
        plot({ bedId: 'bed_mirefen_1' }),
      ],
      0,
    );
    expect(rows.map((row) => row.bedId)).toEqual([
      'bed_eastbrook_1',
      'bed_eastbrook_2',
      'bed_mirefen_1',
    ]);
  });
});

describe('harvest journal: the two empty states', () => {
  it('tells a skilled farmer with nothing sown that the list fills itself', () => {
    expect(
      buildHarvestJournalView({ plots: [], patches: FARM_PATCHES, nowMs: 0, farmingSkill: 40 }),
    ).toEqual({ kind: 'empty' });
  });

  it('tells a character who has never farmed where to start', () => {
    expect(
      buildHarvestJournalView({ plots: [], patches: FARM_PATCHES, nowMs: 0, farmingSkill: 0 }),
    ).toEqual({ kind: 'novice' });
  });

  it('never shows an empty state while a plot exists, at either skill', () => {
    for (const farmingSkill of [0, 40]) {
      const view = buildHarvestJournalView({
        plots: [plot()],
        patches: FARM_PATCHES,
        nowMs: 0,
        farmingSkill,
      });
      expect(view.kind).toBe('rows');
    }
  });
});

describe('harvest journal: the value signature (the repaint gate)', () => {
  // THE READ-IDENTITY PROPERTY. The Sim mints a fresh plots array per read
  // while ClientWorld reuses one until the next delta, so a reference compare
  // would repaint every tick on one host and never repaint on the other.
  // Independently built, value-equal inputs must agree.
  it('agrees across two independently built, value-equal reads', () => {
    const a = buildHarvestJournalView({
      plots: [plot({ bedId: 'bed_eastbrook_2', compost: true })],
      patches: FARM_PATCHES,
      nowMs: 3 * MINUTE,
      farmingSkill: 40,
    });
    const b = buildHarvestJournalView({
      plots: [plot({ bedId: 'bed_eastbrook_2', compost: true })],
      patches: FARM_PATCHES,
      nowMs: 3 * MINUTE,
      farmingSkill: 40,
    });
    expect(a).not.toBe(b);
    expect(harvestJournalViewSignature(a)).toBe(harvestJournalViewSignature(b));
  });

  it('does NOT move as a countdown drains within one arm (the tick rewrites text instead)', () => {
    const early = rowsOf([plot({ readyAtMs: 30 * MINUTE })], 5 * MINUTE);
    const later = rowsOf([plot({ readyAtMs: 30 * MINUTE })], 6 * MINUTE);
    expect(early[0]?.timer.kind).toBe('growing');
    expect(later[0]?.timer.kind).toBe('growing');
    expect(later[0]?.signature).toBe(early[0]?.signature);
  });

  it('MOVES the instant a countdown crosses its deadline, forcing a repaint', () => {
    const before = rowsOf([plot({ readyAtMs: 30 * MINUTE })], 30 * MINUTE - SECOND);
    const after = rowsOf([plot({ readyAtMs: 30 * MINUTE })], 30 * MINUTE + SECOND);
    expect(before[0]?.timer.kind).toBe('growing');
    expect(after[0]?.timer.kind).toBe('finishing');
    expect(after[0]?.signature).not.toBe(before[0]?.signature);
  });

  // ISOLATING the timer arm from the growth stage. The two normally flip on the
  // SAME threshold (a plot is 'growing' exactly while its stage is not yet
  // 'ready'), so the deadline case above would still pass with the timer arm
  // dropped from the signature entirely: `stage` alone carries it. The one
  // shape that separates them is the zero-length grow window (the grow-now
  // mint farmGrowthStage documents), whose stage reads 'ready' at every clock
  // reading while the timer arm still moves.
  it('moves on the timer arm alone when the growth stage cannot tell the two apart', () => {
    const instant = plot({ plantedAtMs: 10 * MINUTE, readyAtMs: 10 * MINUTE });
    const early = rowsOf([instant], 9 * MINUTE)[0];
    const late = rowsOf([instant], 11 * MINUTE)[0];
    expect(early?.stage).toBe('ready');
    expect(late?.stage).toBe('ready');
    expect(early?.timer.kind).toBe('growing');
    expect(late?.timer.kind).toBe('finishing');
    expect(late?.signature).not.toBe(early?.signature);
  });

  it('moves on each field the row renders, one dimension at a time', () => {
    const baseRow = rowsOf([plot()], 2 * MINUTE)[0];
    if (!baseRow) throw new Error('no base row');
    const base = baseRow.signature;
    const moved: Array<readonly [string, Partial<FarmPlotView>]> = [
      ['bedId', { bedId: 'bed_eastbrook_2' }],
      ['cropId', { cropId: 'brook_carrot' }],
      ['status', { status: 'ready' }],
      ['readyAtMs', { readyAtMs: 11 * MINUTE }],
      ['compost', { compost: true }],
      ['watch', { watch: true }],
      ['tonic', { tonic: true }],
    ];
    for (const [label, over] of moved) {
      const next = rowsOf([plot(over)], 2 * MINUTE)[0];
      expect(next?.signature, `${label} must move the row signature`).not.toBe(base);
    }
  });

  it('moves when the growth stage flips, so the stage label cannot go stale', () => {
    const growing = plot({ plantedAtMs: 0, readyAtMs: 30 * MINUTE });
    const sprout = rowsOf([growing], 9 * MINUTE)[0];
    const seedling = rowsOf([growing], 11 * MINUTE)[0];
    expect(sprout?.stage).toBe('sprout');
    expect(seedling?.stage).toBe('seedling');
    expect(seedling?.signature).not.toBe(sprout?.signature);
  });

  it('separates the three view kinds and every row-set change', () => {
    const empty = buildHarvestJournalView({
      plots: [],
      patches: FARM_PATCHES,
      nowMs: 0,
      farmingSkill: 40,
    });
    const novice = buildHarvestJournalView({
      plots: [],
      patches: FARM_PATCHES,
      nowMs: 0,
      farmingSkill: 0,
    });
    expect(harvestJournalViewSignature(empty)).toBe('empty');
    expect(harvestJournalViewSignature(novice)).toBe('novice');
    const one = buildHarvestJournalView({
      plots: [plot()],
      patches: FARM_PATCHES,
      nowMs: 0,
      farmingSkill: 40,
    });
    const two = buildHarvestJournalView({
      plots: [plot(), plot({ bedId: 'bed_eastbrook_2' })],
      patches: FARM_PATCHES,
      nowMs: 0,
      farmingSkill: 40,
    });
    const signatures = [
      harvestJournalViewSignature(empty),
      harvestJournalViewSignature(novice),
      harvestJournalViewSignature(one),
      harvestJournalViewSignature(two),
    ];
    expect(new Set(signatures).size).toBe(signatures.length);
  });

  it('signs the row from its VALUES, not from the object it was handed', () => {
    // Two distinct objects with equal fields sign identically; changing one
    // field on an otherwise identical object does not.
    const fields = {
      bedId: 'bed_eastbrook_1',
      cropId: 'vale_wheat',
      produceItemId: 'vale_wheat',
      patchId: 'patch_eastbrook',
      zoneId: 'eastbrook_vale',
      bedIndex: 1,
      status: 'growing',
      stage: 'sprout',
      readyAtMs: 10 * MINUTE,
      timer: { kind: 'finishing' },
      compost: false,
      watch: false,
      tonic: false,
    } as const satisfies Omit<HarvestJournalRow, 'signature'>;
    expect(harvestJournalRowSignature({ ...fields })).toBe(
      harvestJournalRowSignature({ ...fields }),
    );
    expect(harvestJournalRowSignature({ ...fields, bedIndex: 2 })).not.toBe(
      harvestJournalRowSignature({ ...fields }),
    );
  });
});
