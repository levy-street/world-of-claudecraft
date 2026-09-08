// The hub practice coach's pure transition core
// (src/ui/hud/practice/hub_lesson_view.ts): which ONE step to show for the
// damage drill and the optional healing drill, and how observed progress
// (attempts, row seen, breakdown viewed, run ended, history viewed, the
// round-2 comparison reviewed) only ever advances on a genuine observation.
import { describe, expect, it } from 'vitest';
import {
  advanceHubLesson,
  advanceHubLessonTrack,
  damageEncounterQualifies,
  HUB_LESSON_START,
  HUB_LESSON_TRACK_START,
  type HubLessonDamageEncounter,
  type HubLessonTrackObservation,
  type HubLessonTrackProgress,
  isHubLessonTrackComplete,
  isSafeToKeepAcrossReload,
  parseHubLessonProgress,
  resetHubLessonTrack,
} from '../src/ui/hud/practice/hub_lesson_view';

const ME = 7;
const DUMMY = 'hub_training_dummy';

function obs(overrides: Partial<HubLessonTrackObservation> = {}): HubLessonTrackObservation {
  return {
    eligible: true,
    targeting: false,
    anyWindowOpen: false,
    tabOpen: false,
    attemptKey: null,
    liveNow: false,
    rowVisibleNow: false,
    ackNow: false,
    breakdownInteractionNow: false,
    historyViewedKey: null,
    ...overrides,
  };
}

describe('advanceHubLessonTrack: ineligible', () => {
  it('is always null, whatever the progress or observation says', () => {
    const { step } = advanceHubLessonTrack(
      'damage',
      HUB_LESSON_TRACK_START,
      obs({ eligible: false, targeting: true }),
    );
    expect(step).toBe(null);
  });
});

describe('advanceHubLessonTrack: before the first attempt', () => {
  it('asks to target the dummy first, even with a window already open', () => {
    const { step } = advanceHubLessonTrack(
      'damage',
      HUB_LESSON_TRACK_START,
      obs({ anyWindowOpen: true, tabOpen: true }),
    );
    expect(step).toEqual({ track: 'damage', kind: 'target', live: false });
  });

  it('asks to open a meters window once the dummy is targeted', () => {
    const { step } = advanceHubLessonTrack(
      'damage',
      HUB_LESSON_TRACK_START,
      obs({ targeting: true }),
    );
    expect(step).toEqual({ track: 'damage', kind: 'open-window', live: false });
  });

  it('asks for the right tab once a window is open on the wrong one', () => {
    const { step } = advanceHubLessonTrack(
      'damage',
      HUB_LESSON_TRACK_START,
      obs({ targeting: true, anyWindowOpen: true }),
    );
    expect(step).toEqual({ track: 'damage', kind: 'open-tab', live: false });
  });

  it('asks to act once the tab is open and nothing has landed yet', () => {
    const { step } = advanceHubLessonTrack(
      'damage',
      HUB_LESSON_TRACK_START,
      obs({ targeting: true, anyWindowOpen: true, tabOpen: true }),
    );
    expect(step).toEqual({ track: 'damage', kind: 'act', live: false });
  });

  it('counts a fresh attemptKey into progress.attempts on the very frame it appears', () => {
    const { progress } = advanceHubLessonTrack(
      'damage',
      HUB_LESSON_TRACK_START,
      obs({ attemptKey: 100 }),
    );
    expect(progress.attempts).toBe(1);
    expect(progress.lastCountedKey).toBe(100);
  });
});

describe('advanceHubLessonTrack: window/tab are prerequisites AFTER an attempt too', () => {
  const afterAttempt1: HubLessonTrackProgress = {
    ...resetHubLessonTrack(),
    attempts: 1,
    lastCountedKey: 100,
  };

  it('a CLOSED window after the first attempt returns open-window, not read-row on a hidden row', () => {
    const { step } = advanceHubLessonTrack(
      'damage',
      afterAttempt1,
      obs({ attemptKey: 100, liveNow: true }),
    );
    expect(step).toEqual({ track: 'damage', kind: 'open-window', live: false });
  });

  it('the WRONG tab after the first attempt returns open-tab', () => {
    const { step } = advanceHubLessonTrack(
      'damage',
      afterAttempt1,
      obs({ attemptKey: 100, liveNow: true, anyWindowOpen: true, tabOpen: false }),
    );
    expect(step).toEqual({ track: 'damage', kind: 'open-tab', live: false });
  });

  it('never latches rowSeen while the row cannot actually be visible (window/tab closed)', () => {
    const { progress } = advanceHubLessonTrack(
      'damage',
      afterAttempt1,
      obs({ attemptKey: 100, rowVisibleNow: false, ackNow: true }),
    );
    expect(progress.rowSeen).toBe(false);
  });

  it('resumes read-row once the window and the right tab are open again', () => {
    const { step } = advanceHubLessonTrack(
      'damage',
      afterAttempt1,
      obs({ attemptKey: 100, liveNow: true, anyWindowOpen: true, tabOpen: true }),
    );
    expect(step).toEqual({ track: 'damage', kind: 'read-row', live: true });
  });

  it('a visible row does NOT latch rowSeen without an explicit ack (the read-row step must actually show)', () => {
    const { progress, step } = advanceHubLessonTrack(
      'damage',
      afterAttempt1,
      obs({
        attemptKey: 100,
        liveNow: true,
        anyWindowOpen: true,
        tabOpen: true,
        rowVisibleNow: true,
      }),
    );
    expect(progress.rowSeen).toBe(false);
    expect(step).toEqual({ track: 'damage', kind: 'read-row', live: true });
  });

  it('latches rowSeen once the row is visible AND explicitly acknowledged', () => {
    const { progress } = advanceHubLessonTrack(
      'damage',
      afterAttempt1,
      obs({ attemptKey: 100, rowVisibleNow: true, ackNow: true }),
    );
    expect(progress.rowSeen).toBe(true);
  });
});

describe('advanceHubLessonTrack: view-breakdown', () => {
  const rowSeenOnly: HubLessonTrackProgress = {
    ...resetHubLessonTrack(),
    attempts: 1,
    lastCountedKey: 100,
    rowSeen: true,
  };

  it('asks for the breakdown interaction once the row has been seen', () => {
    const { step } = advanceHubLessonTrack(
      'damage',
      rowSeenOnly,
      obs({ attemptKey: 100, anyWindowOpen: true, tabOpen: true }),
    );
    expect(step).toEqual({ track: 'damage', kind: 'view-breakdown', live: false });
  });

  it('latches breakdownViewed on the interaction event', () => {
    const { progress } = advanceHubLessonTrack(
      'damage',
      rowSeenOnly,
      obs({ attemptKey: 100, rowVisibleNow: true, breakdownInteractionNow: true }),
    );
    expect(progress.breakdownViewed).toBe(true);
  });

  it('a closed window blocks view-breakdown too (prerequisite re-checked)', () => {
    const { step } = advanceHubLessonTrack('damage', rowSeenOnly, obs({ attemptKey: 100 }));
    expect(step).toEqual({ track: 'damage', kind: 'open-window', live: false });
  });
});

describe('advanceHubLessonTrack: end-run and inspect-history (damage only)', () => {
  const breakdownSeen: HubLessonTrackProgress = {
    ...resetHubLessonTrack(),
    attempts: 1,
    lastCountedKey: 100,
    rowSeen: true,
    breakdownViewed: true,
  };

  it('asks to stop and let the fight end while the attempt is still live', () => {
    const { step } = advanceHubLessonTrack(
      'damage',
      breakdownSeen,
      obs({ attemptKey: 100, liveNow: true, anyWindowOpen: true, tabOpen: true }),
    );
    expect(step).toEqual({ track: 'damage', kind: 'end-run', live: true });
  });

  it('latches runEnded once the attempt is no longer live', () => {
    const { progress } = advanceHubLessonTrack(
      'damage',
      breakdownSeen,
      obs({ attemptKey: 100, liveNow: false }),
    );
    expect(progress.runEnded).toBe(true);
  });

  it('never latches runEnded while still live, however many frames pass', () => {
    const { progress } = advanceHubLessonTrack(
      'damage',
      breakdownSeen,
      obs({ attemptKey: 100, liveNow: true }),
    );
    expect(progress.runEnded).toBe(false);
  });

  it('asks to inspect history once the run has ended', () => {
    const ended = { ...breakdownSeen, runEnded: true };
    const { step } = advanceHubLessonTrack(
      'damage',
      ended,
      obs({ attemptKey: 100, anyWindowOpen: true, tabOpen: true }),
    );
    expect(step).toEqual({ track: 'damage', kind: 'inspect-history', live: false });
  });

  it('latches historyViewed when the viewed segment matches the tracked attempt', () => {
    const ended = { ...breakdownSeen, runEnded: true };
    const { progress } = advanceHubLessonTrack(
      'damage',
      ended,
      obs({ attemptKey: 100, historyViewedKey: 100 }),
    );
    expect(progress.historyViewed).toBe(true);
  });

  it('does NOT latch historyViewed when the viewed segment is a DIFFERENT (wrong) fight', () => {
    const ended = { ...breakdownSeen, runEnded: true };
    const { progress, step } = advanceHubLessonTrack(
      'damage',
      ended,
      obs({ attemptKey: 100, anyWindowOpen: true, tabOpen: true, historyViewedKey: 999 }),
    );
    expect(progress.historyViewed).toBe(false);
    expect(step).toEqual({ track: 'damage', kind: 'inspect-history', live: false });
  });

  it('does NOT latch historyViewed when the viewed segment is the live "current" one (null key)', () => {
    const ended = { ...breakdownSeen, runEnded: true };
    const { progress } = advanceHubLessonTrack(
      'damage',
      ended,
      obs({ attemptKey: 100, historyViewedKey: null }),
    );
    expect(progress.historyViewed).toBe(false);
  });
});

describe('advanceHubLessonTrack: two attempts are required, and history inspection gates them', () => {
  it('two qualifying attempts with NO history inspection never completes the track', () => {
    let progress = HUB_LESSON_TRACK_START;
    // Attempt 1 appears...
    ({ progress } = advanceHubLessonTrack('damage', progress, obs({ attemptKey: 100 })));
    // ...and a SECOND qualifying encounter shows up before round 1 was ever
    // observed (the player just kept swinging with the window closed).
    const { step, progress: after } = advanceHubLessonTrack(
      'damage',
      progress,
      obs({ attemptKey: 200 }),
    );
    expect(after.attempts).toBe(1); // the stray second encounter is NOT counted
    expect(step).not.toEqual({ track: 'damage', kind: 'replay', live: false });
    expect(step?.kind).not.toBe('compare-again');
  });

  it('does not complete on two attempts alone: round 1 must be observed end-to-end first', () => {
    const twoAttemptsNoObservation: HubLessonTrackProgress = {
      ...resetHubLessonTrack(),
      attempts: 2,
      lastCountedKey: 200,
    };
    const { step } = advanceHubLessonTrack(
      'damage',
      twoAttemptsNoObservation,
      obs({ targeting: true }),
    );
    expect(step).not.toEqual({ track: 'damage', kind: 'replay', live: false });
    // Still stuck observing round 1 (the window/tab were never opened), even
    // though the ledger already shows two qualifying encounters: attempts
    // alone never completes the track.
    expect(step?.kind).toBe('open-window');
  });

  it('once round 1 is fully observed, asks to target again for the comparison attempt', () => {
    const roundOneDone: HubLessonTrackProgress = {
      ...resetHubLessonTrack(),
      attempts: 1,
      lastCountedKey: 100,
      rowSeen: true,
      breakdownViewed: true,
      runEnded: true,
      historyViewed: true,
    };
    const { step } = advanceHubLessonTrack('damage', roundOneDone, obs());
    expect(step).toEqual({ track: 'damage', kind: 'target', live: false });
  });

  it('the second attempt reads as compare-again, not act', () => {
    const roundOneDone: HubLessonTrackProgress = {
      ...resetHubLessonTrack(),
      attempts: 1,
      lastCountedKey: 100,
      rowSeen: true,
      breakdownViewed: true,
      runEnded: true,
      historyViewed: true,
    };
    const { step } = advanceHubLessonTrack(
      'damage',
      roundOneDone,
      obs({ targeting: true, anyWindowOpen: true, tabOpen: true }),
    );
    expect(step).toEqual({ track: 'damage', kind: 'compare-again', live: false });
  });

  it('counts the second, distinct attempt but does NOT complete on the first hit of round 2', () => {
    const roundOneDone: HubLessonTrackProgress = {
      ...resetHubLessonTrack(),
      attempts: 1,
      lastCountedKey: 100,
      rowSeen: true,
      breakdownViewed: true,
      runEnded: true,
      historyViewed: true,
    };
    const { step, progress } = advanceHubLessonTrack(
      'damage',
      roundOneDone,
      obs({ attemptKey: 200, liveNow: true, anyWindowOpen: true, tabOpen: true }),
    );
    expect(progress.attempts).toBe(2);
    expect(progress.compareReviewed).toBe(false);
    // NOT complete: the comparison run still needs to be reviewed.
    expect(step).toEqual({ track: 'damage', kind: 'end-run', live: true });
  });

  it('does not review-comparison the second run while it is still live, even with a row and an ack', () => {
    const roundTwoLive: HubLessonTrackProgress = {
      ...resetHubLessonTrack(),
      attempts: 2,
      lastCountedKey: 200,
      rowSeen: true,
      breakdownViewed: true,
      runEnded: true,
      historyViewed: true,
    };
    const { progress } = advanceHubLessonTrack(
      'damage',
      roundTwoLive,
      obs({ attemptKey: 200, liveNow: true, rowVisibleNow: true, ackNow: true }),
    );
    expect(progress.compareReviewed).toBe(false);
  });

  it('completes once the second attempt is finished, its row read, and explicitly acknowledged', () => {
    const roundTwoDone: HubLessonTrackProgress = {
      ...resetHubLessonTrack(),
      attempts: 2,
      lastCountedKey: 200,
      rowSeen: true,
      breakdownViewed: true,
      runEnded: true,
      historyViewed: true,
    };
    const { step, progress } = advanceHubLessonTrack(
      'damage',
      roundTwoDone,
      obs({ attemptKey: 200, liveNow: false, rowVisibleNow: true, ackNow: true }),
    );
    expect(progress.compareReviewed).toBe(true);
    expect(step).toBe(null); // complete, and not currently targeting
  });
});

describe('advanceHubLessonTrack: healing needs no comparison', () => {
  it('completes as soon as its single attempt is fully read+breakdown observed', () => {
    const rowSeen: HubLessonTrackProgress = {
      ...resetHubLessonTrack(),
      attempts: 1,
      lastCountedKey: 100,
      rowSeen: true,
    };
    const { step } = advanceHubLessonTrack(
      'healing',
      rowSeen,
      obs({ rowVisibleNow: true, breakdownInteractionNow: true, targeting: true }),
    );
    expect(step).toEqual({ track: 'healing', kind: 'replay', live: false });
  });

  it('never asks for end-run, inspect-history, or review-comparison', () => {
    const rowSeen: HubLessonTrackProgress = {
      ...resetHubLessonTrack(),
      attempts: 1,
      lastCountedKey: 100,
      rowSeen: true,
      breakdownViewed: true,
    };
    const { step } = advanceHubLessonTrack('healing', rowSeen, obs({ targeting: true }));
    expect(step).toEqual({ track: 'healing', kind: 'replay', live: false });
  });

  it('the row still needs an explicit ack, not merely rendering', () => {
    const fresh: HubLessonTrackProgress = {
      ...resetHubLessonTrack(),
      attempts: 1,
      lastCountedKey: 100,
    };
    const { progress, step } = advanceHubLessonTrack(
      'healing',
      fresh,
      obs({ attemptKey: 100, rowVisibleNow: true, anyWindowOpen: true, tabOpen: true }),
    );
    expect(progress.rowSeen).toBe(false);
    expect(step).toEqual({ track: 'healing', kind: 'read-row', live: false });
  });
});

describe('advanceHubLessonTrack: completion and replay', () => {
  const complete: HubLessonTrackProgress = {
    ...resetHubLessonTrack(),
    attempts: 2,
    lastCountedKey: 200,
    rowSeen: true,
    breakdownViewed: true,
    runEnded: true,
    historyViewed: true,
    compareReviewed: true,
  };

  it('is null once fully observed and the player is not targeting the dummy (no nagging)', () => {
    const { step } = advanceHubLessonTrack('damage', complete, obs({ targeting: false }));
    expect(step).toBe(null);
  });

  it('offers replay only while the completed track is targeted again', () => {
    const { step } = advanceHubLessonTrack('damage', complete, obs({ targeting: true }));
    expect(step).toEqual({ track: 'damage', kind: 'replay', live: false });
  });

  it('survives an early quest turn-in: eligible is independent of quest state', () => {
    const notYetComplete: HubLessonTrackProgress = {
      ...resetHubLessonTrack(),
      attempts: 1,
      lastCountedKey: 100,
      rowSeen: true,
      breakdownViewed: true,
      runEnded: true,
    };
    const { step } = advanceHubLessonTrack(
      'damage',
      notYetComplete,
      obs({ eligible: true, anyWindowOpen: true, tabOpen: true }),
    );
    expect(step).toEqual({ track: 'damage', kind: 'inspect-history', live: false });
  });
});

describe('resetHubLessonTrack: baseline keeps unrelated old history from being counted', () => {
  it('with no baseline, matches HUB_LESSON_TRACK_START', () => {
    expect(resetHubLessonTrack()).toEqual(HUB_LESSON_TRACK_START);
  });

  it('a baseline key already on the ledger at reset time is never (re-)counted as attempt 1', () => {
    const reset = resetHubLessonTrack(999); // 999 = the newest qualifying encounter that already existed
    const { progress } = advanceHubLessonTrack('damage', reset, obs({ attemptKey: 999 }));
    expect(progress.attempts).toBe(0);
  });

  it('a genuinely NEW key after the reset still counts normally', () => {
    const reset = resetHubLessonTrack(999);
    const { progress } = advanceHubLessonTrack('damage', reset, obs({ attemptKey: 1000 }));
    expect(progress.attempts).toBe(1);
  });
});

describe('advanceHubLesson: track priority and identity preservation', () => {
  it('prefers the damage track when both have something to say at once', () => {
    const { step } = advanceHubLesson(
      HUB_LESSON_START,
      obs({ targeting: true }),
      obs({ targeting: true }),
    );
    expect(step?.track).toBe('damage');
  });

  it('falls through to healing once damage has nothing to say', () => {
    const { step } = advanceHubLesson(
      HUB_LESSON_START,
      obs({ eligible: false }),
      obs({ targeting: true }),
    );
    expect(step).toEqual({ track: 'healing', kind: 'open-window', live: false });
  });

  it('returns the SAME progress object by reference when neither track actually changed', () => {
    // Both tracks ineligible: advanceHubLessonTrack returns its input
    // progress unchanged for each, so the aggregate must too (this is what
    // lets a caller persist only on identity change, instead of every poll).
    const { progress } = advanceHubLesson(
      HUB_LESSON_START,
      obs({ eligible: false }),
      obs({ eligible: false }),
    );
    expect(progress).toBe(HUB_LESSON_START);
  });

  it('returns a NEW progress object when a track actually changed', () => {
    const { progress } = advanceHubLesson(
      HUB_LESSON_START,
      obs({ attemptKey: 100 }),
      obs({ eligible: false }),
    );
    expect(progress).not.toBe(HUB_LESSON_START);
    expect(progress.healing).toBe(HUB_LESSON_START.healing); // the untouched track keeps its identity too
  });
});

describe('damageEncounterQualifies', () => {
  function enc(templateId: string | null, dmg: Record<number, number>): HubLessonDamageEncounter {
    const tallies = new Map<number, { dmg: number }>();
    for (const [pid, amount] of Object.entries(dmg)) tallies.set(Number(pid), { dmg: amount });
    return { startedAt: 0, mainMobTemplateId: templateId, tallies };
  }

  it('is true only for the right dummy with the local player landing damage', () => {
    expect(damageEncounterQualifies(enc(DUMMY, { [ME]: 500 }), DUMMY, ME)).toBe(true);
    expect(damageEncounterQualifies(enc('boar', { [ME]: 500 }), DUMMY, ME)).toBe(false);
    expect(damageEncounterQualifies(enc(DUMMY, { 99: 500 }), DUMMY, ME)).toBe(false);
    expect(damageEncounterQualifies(enc(DUMMY, { [ME]: 0 }), DUMMY, ME)).toBe(false);
    expect(damageEncounterQualifies(enc(null, { [ME]: 500 }), DUMMY, ME)).toBe(false);
  });
});

describe('isHubLessonTrackComplete / isSafeToKeepAcrossReload', () => {
  const complete: HubLessonTrackProgress = {
    ...resetHubLessonTrack(),
    attempts: 2,
    lastCountedKey: 200,
    rowSeen: true,
    breakdownViewed: true,
    runEnded: true,
    historyViewed: true,
    compareReviewed: true,
  };
  const midRound: HubLessonTrackProgress = {
    ...resetHubLessonTrack(),
    attempts: 1,
    lastCountedKey: 100,
    rowSeen: true,
  };

  it('a never-started track is safe to keep', () => {
    expect(isSafeToKeepAcrossReload('damage', HUB_LESSON_TRACK_START)).toBe(true);
  });

  it('a fully complete track is safe to keep', () => {
    expect(isHubLessonTrackComplete('damage', complete)).toBe(true);
    expect(isSafeToKeepAcrossReload('damage', complete)).toBe(true);
  });

  it('a mid-round track (attempts started, not complete) is UNSAFE to keep across a reload', () => {
    expect(isHubLessonTrackComplete('damage', midRound)).toBe(false);
    expect(isSafeToKeepAcrossReload('damage', midRound)).toBe(false);
  });
});

describe('parseHubLessonProgress: validates a loaded blob rather than trusting its shape', () => {
  it('an empty object ({}) falls back to a fresh start for both tracks, never crashes', () => {
    expect(parseHubLessonProgress({})).toEqual(HUB_LESSON_START);
  });

  it('null/non-object input falls back to a fresh start', () => {
    expect(parseHubLessonProgress(null)).toEqual(HUB_LESSON_START);
    expect(parseHubLessonProgress('nonsense')).toEqual(HUB_LESSON_START);
    expect(parseHubLessonProgress(42)).toEqual(HUB_LESSON_START);
  });

  it('a well-formed progress blob round-trips unchanged', () => {
    const valid: HubLessonTrackProgress = {
      ...resetHubLessonTrack(),
      attempts: 1,
      lastCountedKey: 55,
      rowSeen: true,
    };
    const parsed = parseHubLessonProgress({ damage: valid, healing: HUB_LESSON_TRACK_START });
    expect(parsed.damage).toEqual(valid);
    expect(parsed.healing).toEqual(HUB_LESSON_TRACK_START);
  });

  it('a malformed ONE track (wrong field types) resets only that track', () => {
    const valid: HubLessonTrackProgress = {
      ...resetHubLessonTrack(),
      attempts: 1,
      lastCountedKey: 55,
      rowSeen: true,
    };
    const parsed = parseHubLessonProgress({ damage: { attempts: 'oops' }, healing: valid });
    expect(parsed.damage).toEqual(HUB_LESSON_TRACK_START);
    expect(parsed.healing).toEqual(valid);
  });
});

describe('hub lesson playthrough regressions', () => {
  it('lets a selected friendly dummy take priority over unfinished damage coaching', () => {
    const { step } = advanceHubLesson(HUB_LESSON_START, obs(), obs({ targeting: true }));
    expect(step?.track).toBe('healing');
  });
  it('does not credit a breakdown on a different displayed encounter', () => {
    const p = { ...resetHubLessonTrack(), attempts: 1, lastCountedKey: 100, rowSeen: true };
    const { progress } = advanceHubLessonTrack(
      'damage',
      p,
      obs({ attemptKey: 100, rowVisibleNow: false, breakdownInteractionNow: true }),
    );
    expect(progress.breakdownViewed).toBe(false);
  });
});

it('lets the healing encounter finish before offering a fresh replay', () => {
  const complete = {
    ...resetHubLessonTrack(),
    attempts: 1,
    lastCountedKey: 100,
    rowSeen: true,
    breakdownViewed: true,
  };
  const { step } = advanceHubLessonTrack(
    'healing',
    complete,
    obs({ targeting: true, attemptKey: 100, liveNow: true }),
  );
  expect(step).toEqual({ track: 'healing', kind: 'end-run', live: true });
});
