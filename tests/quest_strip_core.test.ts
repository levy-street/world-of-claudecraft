import { describe, expect, it } from 'vitest';
import {
  clampQuestIndex,
  cycleQuestStrip,
  detectQuestProgress,
  QUEST_STRIP_BAND_GAP_PX,
  QUEST_STRIP_BAND_MIN_X_PX,
  QUEST_STRIP_BAND_TOP_PX,
  QUEST_STRIP_CYCLE_GRACE_MS,
  QUEST_STRIP_FALLBACK_HEIGHT_PX,
  QUEST_STRIP_MAX_OBJECTIVES,
  QUEST_STRIP_MIN_WIDTH_PX,
  QUEST_STRIP_SWIPE_DEADZONE_PX,
  QUEST_STRIP_TARGET_FRAME_GAP_PX,
  questStripBand,
  questStripCounter,
  questStripCycleGraceHolds,
  questStripProgressJump,
  questStripStep,
  questStripView,
} from '../src/ui/hud/quest/quest_strip_core';
import type { TrackedQuest } from '../src/ui/hud/quest/quest_tracker';

const objective = (label: string, current: number, total: number) => ({ label, current, total });

const quest = (id: string, objectives: TrackedQuest['objectives'] = []): TrackedQuest => ({
  id,
  number: Number(id.replace(/\D/g, '')) || 1,
  title: `Quest ${id}`,
  complete: false,
  objectives,
});

// Counts 1, 2, and 3 are the shapes the cycling has to be right for: one quest
// cannot cycle, two make advance and retreat land on the same neighbour, and
// three is the first count where the two directions differ.
const ONE = [quest('q1')];
const TWO = [quest('q1'), quest('q2')];
const THREE = [quest('q1'), quest('q2'), quest('q3')];

describe('quest strip constants', () => {
  it('shares the radial deadzone and pins the band metrics', () => {
    expect(QUEST_STRIP_SWIPE_DEADZONE_PX).toBe(22);
    expect(QUEST_STRIP_MAX_OBJECTIVES).toBe(4);
    expect(QUEST_STRIP_BAND_TOP_PX).toBe(6);
    expect(QUEST_STRIP_BAND_MIN_X_PX).toBe(12);
    expect(QUEST_STRIP_TARGET_FRAME_GAP_PX).toBe(11);
    expect(QUEST_STRIP_BAND_GAP_PX).toBe(10);
    expect(QUEST_STRIP_MIN_WIDTH_PX).toBe(150);
    expect(QUEST_STRIP_FALLBACK_HEIGHT_PX).toBe(56);
    expect(QUEST_STRIP_CYCLE_GRACE_MS).toBe(5000);
  });
});

describe('questStripStep', () => {
  it('advances on a leftward swipe and retreats on a rightward one', () => {
    expect(questStripStep(-60)).toBe(1);
    expect(questStripStep(60)).toBe(-1);
  });

  it('advances on a tap, so no gesture is required to reach any quest', () => {
    expect(questStripStep(0)).toBe(1);
    expect(questStripStep(21)).toBe(1);
    expect(questStripStep(-21)).toBe(1);
  });

  it('commits to a swipe at exactly 22px of travel', () => {
    expect(questStripStep(22)).toBe(-1);
    expect(questStripStep(23)).toBe(-1);
    // leftward is indistinguishable from a tap by outcome, which is the point
    expect(questStripStep(-22)).toBe(1);
  });

  it('accepts a caller deadzone', () => {
    expect(questStripStep(30, 40)).toBe(1);
    expect(questStripStep(30, 10)).toBe(-1);
  });
});

describe('clampQuestIndex', () => {
  it('keeps a stale selection inside the tracked set', () => {
    expect(clampQuestIndex(0, 3)).toBe(0);
    expect(clampQuestIndex(2, 3)).toBe(2);
    expect(clampQuestIndex(5, 3)).toBe(2);
    expect(clampQuestIndex(-4, 3)).toBe(0);
    expect(clampQuestIndex(1, 1)).toBe(0);
  });

  it('falls back to 0 for an empty set or a bad index', () => {
    expect(clampQuestIndex(2, 0)).toBe(0);
    expect(clampQuestIndex(Number.NaN, 3)).toBe(0);
  });

  it('truncates a fractional index toward zero rather than rounding', () => {
    expect(clampQuestIndex(1.9, 3)).toBe(1);
  });
});

describe('cycleQuestStrip', () => {
  it('wraps forward past the last quest at 3', () => {
    expect(cycleQuestStrip(0, 1, 3)).toBe(1);
    expect(cycleQuestStrip(1, 1, 3)).toBe(2);
    expect(cycleQuestStrip(2, 1, 3)).toBe(0);
  });

  it('wraps backward past the first quest at 3', () => {
    expect(cycleQuestStrip(2, -1, 3)).toBe(1);
    expect(cycleQuestStrip(1, -1, 3)).toBe(0);
    expect(cycleQuestStrip(0, -1, 3)).toBe(2);
  });

  it('makes both directions land on the same neighbour at 2', () => {
    expect(cycleQuestStrip(0, 1, 2)).toBe(1);
    expect(cycleQuestStrip(0, -1, 2)).toBe(1);
    expect(cycleQuestStrip(1, 1, 2)).toBe(0);
    expect(cycleQuestStrip(1, -1, 2)).toBe(0);
  });

  it('has nowhere to go at 1 or 0 quests', () => {
    expect(cycleQuestStrip(0, 1, 1)).toBe(0);
    expect(cycleQuestStrip(0, -1, 1)).toBe(0);
    expect(cycleQuestStrip(0, 1, 0)).toBe(0);
    expect(cycleQuestStrip(0, -1, 0)).toBe(0);
  });

  it('clamps an out-of-range or bad index before stepping', () => {
    expect(cycleQuestStrip(5, 1, 3)).toBe(0);
    expect(cycleQuestStrip(-4, 1, 3)).toBe(1);
    expect(cycleQuestStrip(Number.NaN, 1, 3)).toBe(0);
    expect(cycleQuestStrip(0, Number.NaN, 3)).toBe(0);
  });

  it('handles a step larger than the tracked set', () => {
    expect(cycleQuestStrip(0, 4, 3)).toBe(1);
    expect(cycleQuestStrip(0, -4, 3)).toBe(2);
  });

  it('truncates a fractional step toward zero before wrapping', () => {
    expect(cycleQuestStrip(0, 1.5, 3)).toBe(1);
  });
});

describe('questStripCounter', () => {
  it('reports a 1-based position and the total, never a formatted string', () => {
    expect(questStripCounter(0, 3)).toEqual({ position: 1, total: 3, visible: true });
    expect(questStripCounter(2, 3)).toEqual({ position: 3, total: 3, visible: true });
  });

  it('hides itself when there is nothing to cycle to', () => {
    expect(questStripCounter(0, 1)).toEqual({ position: 1, total: 1, visible: false });
    expect(questStripCounter(0, 0)).toEqual({ position: 0, total: 0, visible: false });
  });

  it('clamps a stale index', () => {
    expect(questStripCounter(9, 3)).toEqual({ position: 3, total: 3, visible: true });
  });
});

describe('questStripView', () => {
  it('renders nothing when no quest is tracked', () => {
    const view = questStripView([], 0);
    expect(view.visible).toBe(false);
    expect(view.title).toBe('');
    expect(view.objectives).toEqual([]);
    expect(view.counter).toEqual({ position: 0, total: 0, visible: false });
    expect(view.hiddenObjectives).toBe(0);
  });

  it('shows the selected quest with every objective and its done state', () => {
    const quests = [
      quest('q1', [objective('Slay boars', 4, 8), objective('Recover the sigil', 1, 1)]),
      quest('q2', [objective('Speak to the smith', 0, 1)]),
    ];
    const view = questStripView(quests, 1);
    expect(view.visible).toBe(true);
    expect(view.id).toBe('q2');
    expect(view.title).toBe('Quest q2');
    expect(view.index).toBe(1);
    expect(view.counter).toEqual({ position: 2, total: 2, visible: true });
    expect(view.objectives).toEqual([
      { label: 'Speak to the smith', current: 0, total: 1, done: false },
    ]);

    const first = questStripView(quests, 0);
    expect(first.objectives).toEqual([
      { label: 'Slay boars', current: 4, total: 8, done: false },
      { label: 'Recover the sigil', current: 1, total: 1, done: true },
    ]);
    expect(first.hiddenObjectives).toBe(0);
  });

  it('marks an overshot objective done', () => {
    const view = questStripView([quest('q1', [objective('Gather pelts', 12, 10)])], 0);
    expect(view.objectives[0].done).toBe(true);
  });

  it('handles a quest with no objectives at all', () => {
    const view = questStripView([quest('q1'), quest('q2')], 0);
    expect(view.visible).toBe(true);
    expect(view.objectives).toEqual([]);
    expect(view.hiddenObjectives).toBe(0);
    expect(view.counter).toEqual({ position: 1, total: 2, visible: true });
  });

  it('caps a pathological objective list and reports the remainder', () => {
    const many = quest(
      'q1',
      Array.from({ length: 7 }, (_, i) => objective(`Objective ${i}`, i, 3)),
    );
    const view = questStripView([many], 0);
    expect(view.objectives).toHaveLength(QUEST_STRIP_MAX_OBJECTIVES);
    expect(view.objectives.map((o) => o.label)).toEqual([
      'Objective 0',
      'Objective 1',
      'Objective 2',
      'Objective 3',
    ]);
    expect(view.hiddenObjectives).toBe(3);
  });

  it('clamps a selection the tracked set has shrunk under', () => {
    expect(questStripView(THREE, 9).id).toBe('q3');
    expect(questStripView(THREE, 9).index).toBe(2);
    expect(questStripView(ONE, 4).id).toBe('q1');
    expect(questStripView(TWO, -3).id).toBe('q1');
  });

  it('truncates a fractional requested index toward zero', () => {
    const view = questStripView(THREE, 1.9);
    expect(view.index).toBe(1);
    expect(view.id).toBe('q2');
  });

  it('carries the turn-in ready state through', () => {
    const ready: TrackedQuest = { ...quest('q1'), complete: true };
    expect(questStripView([ready], 0).complete).toBe(true);
    expect(questStripView([quest('q1')], 0).complete).toBe(false);
  });

  it('hands the caller its own arrays and counter object (no shared empty view)', () => {
    const a = questStripView([], 0);
    const b = questStripView([], 0);
    expect(a.objectives).not.toBe(b.objectives);
    expect(a.counter).not.toBe(b.counter);
  });
});

describe('questStripBand', () => {
  // The measured 874x402 (iPhone 16 Pro landscape) band: the buff bar on the
  // right, the combat control row on the left, and the strip anchored past the
  // target frame's static seat (--quest-strip-anchor-left, hud.mobile.css).
  const COMBAT_ROW = { left: 0, right: 200, top: 0, bottom: 44 };
  const BUFF_BAR = { left: 681, right: 860, top: 4, bottom: 40 };
  const ANCHOR = 276;

  it('runs from the anchor to the first occupant right of it', () => {
    const band = questStripBand({
      viewportWidth: 874,
      anchorLeft: ANCHOR,
      occupants: [COMBAT_ROW, BUFF_BAR],
      stripHeight: 40,
    });
    expect(band.maxWidth).toBe(395);
  });

  it('runs to the far edge margin when nothing shares the band', () => {
    const band = questStripBand({
      viewportWidth: 874,
      anchorLeft: ANCHOR,
      occupants: [],
      stripHeight: 40,
    });
    expect(band.maxWidth).toBe(874 - QUEST_STRIP_BAND_MIN_X_PX - ANCHOR);
  });

  it('IGNORES an occupant left of the anchor instead of pushing the strip right', () => {
    // The anchor is CSS-owned and target-independent; the party stack and the
    // combat row live behind it, and nothing measured may move it.
    const wide = { left: 0, right: 320, top: 0, bottom: 44 };
    const band = questStripBand({
      viewportWidth: 874,
      anchorLeft: ANCHOR,
      occupants: [wide],
      stripHeight: 40,
    });
    expect(band.maxWidth).toBe(874 - QUEST_STRIP_BAND_MIN_X_PX - ANCHOR);
  });

  it('ignores an occupant starting exactly ON the anchor', () => {
    const band = questStripBand({
      viewportWidth: 874,
      anchorLeft: ANCHOR,
      occupants: [{ left: ANCHOR, right: 500, top: 0, bottom: 44 }],
      stripHeight: 40,
    });
    expect(band.maxWidth).toBe(874 - QUEST_STRIP_BAND_MIN_X_PX - ANCHOR);
  });

  it('lets a right occupant cap the width', () => {
    const band = questStripBand({
      viewportWidth: 874,
      anchorLeft: QUEST_STRIP_BAND_MIN_X_PX,
      occupants: [BUFF_BAR],
      stripHeight: 40,
    });
    expect(band.maxWidth).toBe(659);
  });

  it('ignores occupants that do not overlap the band vertically', () => {
    const below = { left: 400, right: 720, top: 100, bottom: 160 };
    const above = { left: 400, right: 720, top: -60, bottom: 4 };
    const band = questStripBand({
      viewportWidth: 874,
      anchorLeft: QUEST_STRIP_BAND_MIN_X_PX,
      occupants: [below, above, BUFF_BAR],
      stripHeight: 40,
    });
    expect(band.maxWidth).toBe(659);
  });

  it('ignores an occupant whose bottom sits exactly on the band top', () => {
    const band = questStripBand({
      viewportWidth: 874,
      anchorLeft: QUEST_STRIP_BAND_MIN_X_PX,
      occupants: [{ left: 400, right: 720, top: -40, bottom: 6 }],
      stripHeight: 40,
    });
    expect(band.maxWidth).toBe(850);
  });

  it('ignores an occupant whose top sits exactly on the band bottom', () => {
    const band = questStripBand({
      viewportWidth: 874,
      anchorLeft: QUEST_STRIP_BAND_MIN_X_PX,
      occupants: [{ left: 400, right: 720, top: 46, bottom: 90 }],
      stripHeight: 40,
    });
    expect(band.maxWidth).toBe(850);
  });

  it('ignores zero-width occupants (a hidden element still has a box)', () => {
    const band = questStripBand({
      viewportWidth: 874,
      anchorLeft: QUEST_STRIP_BAND_MIN_X_PX,
      occupants: [{ left: 400, right: 400, top: 0, bottom: 44 }],
      stripHeight: 40,
    });
    expect(band.maxWidth).toBe(850);
  });

  it('uses the fallback height before the strip has been measured', () => {
    const lowOccupant = { left: 400, right: 720, top: 50, bottom: 90 };
    const measured = questStripBand({
      viewportWidth: 874,
      anchorLeft: QUEST_STRIP_BAND_MIN_X_PX,
      occupants: [lowOccupant],
      stripHeight: 40,
    });
    expect(measured.maxWidth).toBe(850);
    const unmeasured = questStripBand({
      viewportWidth: 874,
      anchorLeft: QUEST_STRIP_BAND_MIN_X_PX,
      occupants: [lowOccupant],
      stripHeight: 0,
    });
    expect(unmeasured.maxWidth).toBe(400 - QUEST_STRIP_BAND_GAP_PX - QUEST_STRIP_BAND_MIN_X_PX);
  });

  it('never squeezes below the minimum readable width', () => {
    const band = questStripBand({
      viewportWidth: 500,
      anchorLeft: 250,
      occupants: [{ left: 300, right: 500, top: 0, bottom: 44 }],
      stripHeight: 40,
    });
    expect(band.maxWidth).toBe(QUEST_STRIP_MIN_WIDTH_PX);
  });

  it('rounds fractional viewport and occupant measurements', () => {
    const band = questStripBand({
      viewportWidth: 874.5,
      anchorLeft: 210.4,
      occupants: [{ left: 600.6, right: 800, top: 0, bottom: 44.3 }],
      stripHeight: 40,
    });
    expect(band.maxWidth).toBe(380);
  });

  it('keeps the anchor out of the answer entirely (the strip is never moved)', () => {
    // The band arithmetic returns a WIDTH and nothing else: there is no left or
    // top to write, which is what makes a target coming or going unable to
    // reseat the strip.
    const band = questStripBand({
      viewportWidth: 874,
      anchorLeft: ANCHOR,
      occupants: [BUFF_BAR],
      stripHeight: 40,
    });
    expect(Object.keys(band)).toEqual(['maxWidth']);
  });
});

// The auto-show half: which tracked quest just earned the band, and when a hand
// cycle still outranks it. Both are pure, so the whole decision is driven here
// rather than through the controller's DOM.
describe('detectQuestProgress', () => {
  const tracked = (
    id: string,
    objectives: TrackedQuest['objectives'],
    complete = false,
  ): TrackedQuest => ({
    id,
    number: 1,
    title: `Quest ${id}`,
    complete,
    objectives,
  });

  const wolves = (current: number) => [objective('Wolves slain', current, 6)];

  it('reports the quest whose objective count rose', () => {
    const before = [tracked('a', wolves(0)), tracked('b', wolves(1))];
    const after = [tracked('a', wolves(0)), tracked('b', wolves(2))];
    expect(detectQuestProgress(before, after)).toBe(1);
  });

  it('reports an objective crossing into done even when the count did not move', () => {
    // A shared or scaled requirement can FALL, which finishes the line without
    // the current count changing; the strip should still surface it.
    const before = [tracked('a', [objective('Runes cleansed', 3, 6)])];
    const after = [tracked('a', [objective('Runes cleansed', 3, 3)])];
    expect(detectQuestProgress(before, after)).toBe(0);
  });

  it('reports a quest that just turned complete', () => {
    const before = [tracked('a', wolves(6)), tracked('b', wolves(0))];
    const after = [tracked('a', wolves(6), true), tracked('b', wolves(0))];
    expect(detectQuestProgress(before, after)).toBe(0);
  });

  it('reports nothing when nothing moved', () => {
    const before = [tracked('a', wolves(2)), tracked('b', wolves(3))];
    const after = [tracked('a', wolves(2)), tracked('b', wolves(3))];
    expect(detectQuestProgress(before, after)).toBeNull();
  });

  it('does NOT treat a newly tracked quest as progress', () => {
    // Accepting a quest is not a reason to take the band off the one the player
    // is working, so a quest with no previous entry is skipped entirely.
    const before = [tracked('a', wolves(1))];
    const after = [tracked('a', wolves(1)), tracked('b', wolves(0))];
    expect(detectQuestProgress(before, after)).toBeNull();
  });

  it('does NOT treat a removed quest as progress on the quest that inherited its slot', () => {
    // Matching by id rather than by position is what makes this hold: quest 'b'
    // moves from index 1 to index 0 with its counts untouched.
    const before = [tracked('a', wolves(0)), tracked('b', wolves(4))];
    const after = [tracked('b', wolves(4))];
    expect(detectQuestProgress(before, after)).toBeNull();
  });

  it('takes the FIRST in tracked order when two quests progress in one tick', () => {
    const before = [tracked('a', wolves(0)), tracked('b', wolves(0)), tracked('c', wolves(0))];
    const after = [tracked('a', wolves(0)), tracked('b', wolves(1)), tracked('c', wolves(1))];
    expect(detectQuestProgress(before, after)).toBe(1);
  });

  it('reports nothing from or to an empty list', () => {
    expect(detectQuestProgress([], [tracked('a', wolves(1))])).toBeNull();
    expect(detectQuestProgress([tracked('a', wolves(1))], [])).toBeNull();
  });

  it('tolerates an objective list that grew under the same quest id', () => {
    const before = [tracked('a', wolves(1))];
    const after = [tracked('a', [...wolves(1), objective('Totems burned', 0, 3)])];
    expect(detectQuestProgress(before, after)).toBeNull();
  });
});

describe('questStripCycleGraceHolds', () => {
  it('never holds before the player has cycled at all', () => {
    expect(questStripCycleGraceHolds(null, 10_000)).toBe(false);
  });

  it('holds inside the grace window and releases on its far edge', () => {
    expect(questStripCycleGraceHolds(1000, 1000)).toBe(true);
    expect(questStripCycleGraceHolds(1000, 1000 + QUEST_STRIP_CYCLE_GRACE_MS - 1)).toBe(true);
    expect(questStripCycleGraceHolds(1000, 1000 + QUEST_STRIP_CYCLE_GRACE_MS)).toBe(false);
    expect(questStripCycleGraceHolds(1000, 20_000)).toBe(false);
  });

  it('takes an explicit window', () => {
    expect(questStripCycleGraceHolds(1000, 2000, 3000)).toBe(true);
    expect(questStripCycleGraceHolds(1000, 2000, 500)).toBe(false);
  });

  it('does not hold on a clock that ran backwards or is not a number', () => {
    expect(questStripCycleGraceHolds(5000, 1000)).toBe(false);
    expect(questStripCycleGraceHolds(Number.NaN, 1000)).toBe(false);
    expect(questStripCycleGraceHolds(1000, Number.NaN)).toBe(false);
  });
});

describe('questStripProgressJump', () => {
  const tracked = (id: string, current: number): TrackedQuest => ({
    id,
    number: 1,
    title: `Quest ${id}`,
    complete: false,
    objectives: [objective('Wolves slain', current, 6)],
  });
  const before = [tracked('a', 0), tracked('b', 0)];
  const after = [tracked('a', 0), tracked('b', 1)];

  it('jumps to the progressed quest when no cycle is holding', () => {
    expect(
      questStripProgressJump({ previous: before, next: after, now: 9000, lastCycleAt: null }),
    ).toBe(1);
    expect(
      questStripProgressJump({ previous: before, next: after, now: 9000, lastCycleAt: 1000 }),
    ).toBe(1);
  });

  it('is suppressed while a hand cycle is still holding the selection', () => {
    expect(
      questStripProgressJump({ previous: before, next: after, now: 3000, lastCycleAt: 1000 }),
    ).toBeNull();
  });

  it('stays null when nothing progressed, cycle or no cycle', () => {
    expect(
      questStripProgressJump({ previous: before, next: before, now: 9000, lastCycleAt: null }),
    ).toBeNull();
  });
});
