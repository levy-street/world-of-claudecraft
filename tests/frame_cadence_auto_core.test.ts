import { describe, expect, it } from 'vitest';
import {
  AUTO_EVIDENCE_RUN_S,
  AUTO_FRAMES_CLEAR_OF_EXEMPTION,
  AUTO_PROBATION_S,
  AUTO_PROBE_FRAMES,
  AUTO_PROBES_PER_SESSION,
  autoStepDown,
  autoStepUp,
  createFrameCadenceAuto,
  type FrameCadenceAutoFrame,
  type FrameCadenceAutoState,
  frameCadenceAutoHoldsQuality,
  frameCadenceAutoRecord,
  frameCadencePlaySeconds,
  invalidateFrameCadenceAuto,
  resetFrameCadenceAutoWindow,
  restoreFrameCadenceAuto,
  stepFrameCadenceAuto,
} from '../src/game/frame_cadence_auto_core';

const HZ = 60;

interface Feed {
  /** One frame in every `lateEvery` is late (0: none). */
  lateEvery?: number;
  shedding?: boolean;
  atBaseline?: boolean;
  calm?: boolean;
  framesSinceExempt?: number;
  refreshHz?: number;
  /** Stop at the first change the core reports. */
  untilChange?: boolean;
}

/** Feed rendered frames for `seconds` of play at the cadence in force; returns
 *  the seconds of play at each change the core reported. */
function play(state: FrameCadenceAutoState, seconds: number, feed: Feed = {}): number[] {
  const changes: number[] = [];
  let t = 0;
  let n = 0;
  const frame: FrameCadenceAutoFrame = {
    dtSeconds: 0,
    late: false,
    refreshHz: feed.refreshHz ?? HZ,
    governorShedding: feed.shedding ?? false,
    governorAtBaseline: feed.atBaseline ?? false,
    calm: feed.calm ?? true,
    framesSinceExempt: feed.framesSinceExempt ?? 100_000,
  };
  while (t < seconds) {
    frame.dtSeconds = 1 / (state.ceiling === 0 ? frame.refreshHz : state.ceiling);
    n++;
    frame.late = !!feed.lateEvery && n % feed.lateEvery === 0;
    t += frame.dtSeconds;
    if (stepFrameCadenceAuto(state, frame)) {
      changes.push(t);
      if (feed.untilChange) break;
    }
  }
  return changes;
}

const heldAt30 = (confirmed: boolean, failStreak = 0): FrameCadenceAutoState => {
  const s = createFrameCadenceAuto();
  restoreFrameCadenceAuto(s, { ceiling: 30, confirmed, failStreak });
  return s;
};

/** A provisional hold at 30 brought to the start of its confirming probe. */
const probing = (): FrameCadenceAutoState => {
  const s = heldAt30(false);
  play(s, 70, { untilChange: true });
  expect(s.phase).toBe('probe');
  return s;
};

describe('play time', () => {
  it('credits a quarter second at most, and nothing for a gap', () => {
    expect(frameCadencePlaySeconds(16.7)).toBeCloseTo(0.0167, 4);
    expect(frameCadencePlaySeconds(600)).toBe(0.25);
    expect(frameCadencePlaySeconds(999)).toBe(0.25);
    // A background-throttled timer fires at exactly one second.
    expect(frameCadencePlaySeconds(1000)).toBe(-1);
    expect(frameCadencePlaySeconds(360_000)).toBe(-1);
    expect(frameCadencePlaySeconds(0)).toBe(0);
    expect(frameCadencePlaySeconds(Number.NaN)).toBe(0);
  });
});

describe('the tuning, pinned to literals so a test below cannot move with it', () => {
  it('is what the design says', () => {
    expect(AUTO_PROBES_PER_SESSION).toBe(2);
    expect(AUTO_EVIDENCE_RUN_S).toBe(600);
    expect(AUTO_PROBE_FRAMES).toBe(90);
    expect(AUTO_PROBATION_S).toBe(120);
    expect(AUTO_FRAMES_CLEAR_OF_EXEMPTION).toBe(300);
  });
});

describe('the ladder', () => {
  it('skips a step that changes nothing on the display', () => {
    expect(autoStepDown(0, 60)).toBe(30);
    expect(autoStepDown(0, 144)).toBe(60);
    expect(autoStepDown(60, 144)).toBe(30);
    expect(autoStepDown(30, 60)).toBe(30);
    expect(autoStepDown(0, 30)).toBe(0);
    expect(autoStepUp(30, 144)).toBe(60);
    expect(autoStepUp(30, 60)).toBe(0);
    expect(autoStepUp(60, 144)).toBe(0);
  });
});

describe('the descent', () => {
  it('steps down within seconds on a flagrant stream, provisionally', () => {
    const s = createFrameCadenceAuto();
    const changes = play(s, 10, { lateEvery: 2 });
    expect(s.ceiling).toBe(30);
    expect(changes[0]).toBeLessThan(2.1);
    expect(s.phase).toBe('held');
    expect(s.confirmed).toBe(false);
    expect(s.firstCeilingS).toBeCloseTo(changes[0], 5);
    expect(s.descents).toBe(1);
  });

  it('steps down on the watch window for an ordinary uneven stream', () => {
    const s = createFrameCadenceAuto();
    // One late frame in five: 20 percent, under the flagrant share.
    const changes = play(s, 20, { lateEvery: 5 });
    expect(s.ceiling).toBe(30);
    expect(changes[0]).toBeGreaterThan(14.9);
    expect(changes[0]).toBeLessThan(15.2);
  });

  it('leaves a stream under the uneven share alone, however long', () => {
    const s = createFrameCadenceAuto();
    // One in ten: 10 percent.
    expect(play(s, 600, { lateEvery: 10 })).toEqual([]);
    expect(s.phase).toBe('observe');
    expect(frameCadenceAutoHoldsQuality(s)).toBe(false);
  });

  it('gives the governor its turn on a flagrant stream, for three checkpoints and no more', () => {
    const s = createFrameCadenceAuto();
    // The ring fills at frame 120 (the first flagrant checkpoint), so the third
    // one in a row is frame 240: 4 s at 60 Hz.
    const changes = play(s, 60, { lateEvery: 2, shedding: true, untilChange: true });
    expect(changes[0]).toBeCloseTo(4, 1);
    expect(s.ceiling).toBe(30);
    const free = createFrameCadenceAuto();
    expect(play(free, 60, { lateEvery: 2, untilChange: true })[0]).toBeCloseTo(2, 1);
  });

  it('waits for the governor on the watch window too, not only on a flagrant stream', () => {
    const s = createFrameCadenceAuto();
    // 20 percent late: uneven, never flagrant.
    expect(play(s, 50, { lateEvery: 5, shedding: true })).toEqual([]);
    expect(s.ceiling).toBe(0);
    expect(play(s, 20, { lateEvery: 5, untilChange: true }).length).toBe(1);
    expect(s.ceiling).toBe(30);
  });

  it('is a settled verdict only on the watch window, past the settle phase', () => {
    const s = createFrameCadenceAuto();
    play(s, 90);
    play(s, 20, { lateEvery: 5, untilChange: true });
    expect(s.ceiling).toBe(30);
    expect(s.confirmed).toBe(true);
  });

  it('is provisional on the fast rule however late it comes: a stutter episode is not a verdict', () => {
    const s = createFrameCadenceAuto();
    play(s, 90);
    // One frame in three late (a streaming burst on a capable machine).
    play(s, 10, { lateEvery: 3, untilChange: true });
    expect(s.ceiling).toBe(30);
    expect(s.confirmed).toBe(false);
    expect(frameCadenceAutoHoldsQuality(s)).toBe(true);
    // The burst over, a clean minute earns the probe, and a machine that holds
    // its display goes back to it.
    play(s, 70, { untilChange: true });
    expect(s.phase).toBe('probe');
    play(s, 5, { untilChange: true });
    expect(s.phase).toBe('probation');
    expect(s.ceiling).toBe(0);
  });

  it('reads nothing in the frames that follow an exempt span', () => {
    const s = createFrameCadenceAuto();
    expect(play(s, 60, { lateEvery: 2, framesSinceExempt: 299 })).toEqual([]);
    expect(s.recentCount).toBe(0);
    expect(play(s, 5, { lateEvery: 2, framesSinceExempt: 300, untilChange: true }).length).toBe(1);
  });

  it('keeps going down a rung at a time on a fast display', () => {
    const s = createFrameCadenceAuto();
    play(s, 3, { lateEvery: 2, refreshHz: 144, untilChange: true });
    expect(s.ceiling).toBe(60);
    play(s, 5, { lateEvery: 2, refreshHz: 144, untilChange: true });
    expect(s.ceiling).toBe(30);
  });
});

describe('the confirming probe of a provisional hold', () => {
  it('comes once, after a clean minute, and fails on exactly the third late frame', () => {
    const s = heldAt30(false);
    const changes = play(s, 70, { untilChange: true });
    expect(changes.length).toBe(1);
    expect(changes[0]).toBeGreaterThan(59.9);
    expect(s.phase).toBe('probe');
    expect(s.ceiling).toBe(0);
    expect(s.probesLeft).toBe(AUTO_PROBES_PER_SESSION - 1);

    const frame: FrameCadenceAutoFrame = {
      dtSeconds: 1 / 60,
      late: true,
      refreshHz: HZ,
      governorShedding: false,
      governorAtBaseline: false,
      calm: true,
      framesSinceExempt: 100_000,
    };
    expect(stepFrameCadenceAuto(s, frame)).toBe(false);
    expect(stepFrameCadenceAuto(s, { ...frame, late: false })).toBe(false);
    expect(stepFrameCadenceAuto(s, frame)).toBe(false);
    expect(s.phase).toBe('probe');
    expect(stepFrameCadenceAuto(s, frame)).toBe(true);
    expect(s.phase).toBe('held');
    expect(s.ceiling).toBe(30);
    expect(s.confirmed).toBe(true);
    expect(s.failStreak).toBe(1);
    expect(frameCadenceAutoRecord(s)).toEqual({ ceiling: 30, confirmed: true, failStreak: 1 });
  });

  it('holds the quality levels and never remembers its own ceiling', () => {
    const s = probing();
    expect(s.ceiling).toBe(0);
    expect(frameCadenceAutoHoldsQuality(s)).toBe(true);
    expect(frameCadenceAutoRecord(s)).toEqual({ ceiling: 30, confirmed: false, failStreak: 0 });
  });

  it('passes at the frame count with two late frames, into probation', () => {
    const s = probing();
    const changes = play(s, 10, { lateEvery: 40, untilChange: true });
    expect(changes[0]).toBeCloseTo(1.5, 5);
    expect(s.phase).toBe('probation');
    expect(s.ceiling).toBe(0);
    // A passed probe says nothing yet about the ceiling it left: the record is
    // still the one behind it, provisional, which the wiring never stores.
    expect(frameCadenceAutoRecord(s)).toEqual({ ceiling: 30, confirmed: false, failStreak: 0 });
    expect(frameCadenceAutoHoldsQuality(s)).toBe(true);
  });

  it.each([
    ['in combat', { calm: false }],
    ['while the governor sheds', { shedding: true }],
  ] as const)('is deferred %s, and starts once that clears', (_label, feed) => {
    const s = heldAt30(false);
    expect(play(s, 200, feed)).toEqual([]);
    expect(s.phase).toBe('held');
    expect(play(s, 5, { untilChange: true }).length).toBe(1);
    expect(s.phase).toBe('probe');
  });

  it('settles without a probe after five minutes that never gave it a clean minute', () => {
    const s = heldAt30(false);
    // 1 late frame in 12 (8 percent): never clean, never uneven.
    const changes = play(s, 400, { lateEvery: 12, untilChange: true });
    expect(changes[0]).toBeGreaterThan(299);
    expect(changes[0]).toBeLessThan(303);
    expect(s.phase).toBe('held');
    expect(s.confirmed).toBe(true);
    expect(s.probesStarted).toBe(0);
    expect(frameCadenceAutoHoldsQuality(s)).toBe(false);
    // Settled for the governor's sake only: never a verdict to remember.
    expect(frameCadenceAutoRecord(s).confirmed).toBe(false);
  });

  it('is bounded in a fight that never ends: the hold settles unprobed and frees the governor', () => {
    const s = heldAt30(false);
    const changes = play(s, 800, { calm: false });
    expect(changes.length).toBe(1);
    expect(changes[0]).toBeGreaterThan(299);
    expect(changes[0]).toBeLessThan(303);
    expect(s.probesStarted).toBe(0);
    expect(frameCadenceAutoHoldsQuality(s)).toBe(false);
    expect(frameCadenceAutoRecord(s).confirmed).toBe(false);
    // A failed probe later is a real verdict, and is remembered as one.
    play(s, 700, { atBaseline: true, untilChange: true });
    expect(s.phase).toBe('probe');
    play(s, 1, { lateEvery: 1, untilChange: true });
    expect(frameCadenceAutoRecord(s)).toEqual({ ceiling: 30, confirmed: true, failStreak: 1 });
  });

  it('tolerates a stray late frame in the recent ring when it starts', () => {
    const s = heldAt30(false);
    // 1 in 40 (2.5 percent): clean checkpoints, a ring that is never spotless.
    expect(play(s, 70, { lateEvery: 40, untilChange: true })[0]).toBeLessThan(63);
    expect(s.phase).toBe('probe');
  });

  it('stays unprobed one rung down: an inherited confirmation is not a verdict to remember', () => {
    const s = createFrameCadenceAuto();
    restoreFrameCadenceAuto(s, { ceiling: 60, confirmed: false, failStreak: 0 });
    const hz = { refreshHz: 144 };
    // Settled for want of a probe, in a fight that never ends.
    play(s, 400, { ...hz, calm: false, untilChange: true });
    expect(s.confirmed).toBe(true);
    expect(frameCadenceAutoRecord(s).confirmed).toBe(false);
    // A watch-window descent (one in six late: never the fast rule) keeps the
    // confirmation it inherited, and keeps it unprobed.
    play(s, 40, { ...hz, calm: false, lateEvery: 6, untilChange: true });
    expect(s.ceiling).toBe(30);
    expect(s.confirmed).toBe(true);
    expect(s.probesStarted).toBe(0);
    expect(frameCadenceAutoRecord(s)).toEqual({ ceiling: 30, confirmed: false, failStreak: 0 });
    // The same descent from a genuinely settled hold is a verdict.
    const settled = createFrameCadenceAuto();
    restoreFrameCadenceAuto(settled, { ceiling: 60, confirmed: true, failStreak: 0 });
    play(settled, 40, { ...hz, lateEvery: 6, untilChange: true });
    expect(frameCadenceAutoRecord(settled)).toEqual({
      ceiling: 30,
      confirmed: true,
      failStreak: 0,
    });
  });

  it('is bounded at the bottom rung too, on a stream that stays uneven', () => {
    const s = heldAt30(false);
    const changes = play(s, 900, { lateEvery: 3 });
    expect(changes.length).toBe(1);
    expect(changes[0]).toBeGreaterThan(299);
    expect(changes[0]).toBeLessThan(305);
    expect(frameCadenceAutoHoldsQuality(s)).toBe(false);
    expect(frameCadenceAutoRecord(s).confirmed).toBe(false);
  });

  it('settles without a probe once the session budget is spent', () => {
    const s = heldAt30(false);
    s.probesLeft = 0;
    play(s, 70);
    expect(s.phase).toBe('held');
    expect(s.confirmed).toBe(true);
    expect(s.probesStarted).toBe(0);
    // Its clean minute was measured AT the ceiling: not a verdict to remember.
    expect(frameCadenceAutoRecord(s).confirmed).toBe(false);
  });

  it('is cancelled as inconclusive by combat, without spending the budget', () => {
    const s = probing();
    expect(play(s, 0.01, { calm: false }).length).toBe(1);
    expect(s.phase).toBe('held');
    expect(s.ceiling).toBe(30);
    expect(s.confirmed).toBe(false);
    expect(s.probesLeft).toBe(AUTO_PROBES_PER_SESSION);
    expect(s.probesInconclusive).toBe(1);
    expect(s.failStreak).toBe(0);
  });

  it('is cancelled by an exempt span, and the third cancellation ends the probes', () => {
    const s = heldAt30(false);
    for (let i = 0; i < 3; i++) {
      play(s, 70, { untilChange: true });
      expect(s.phase).toBe('probe');
      expect(resetFrameCadenceAutoWindow(s)).toBe(true);
      expect(s.ceiling).toBe(30);
    }
    expect(s.probesLeft).toBe(0);
    expect(resetFrameCadenceAutoWindow(s)).toBe(false);
  });
});

describe('probation', () => {
  const onProbation = (): FrameCadenceAutoState => {
    const s = probing();
    play(s, 2, { untilChange: true });
    expect(s.phase).toBe('probation');
    return s;
  };

  it('takes the step back at once when the rhythm breaks, even while the governor sheds', () => {
    const s = onProbation();
    const changes = play(s, 5, { lateEvery: 2, shedding: true });
    expect(changes.length).toBe(1);
    expect(s.phase).toBe('held');
    expect(s.ceiling).toBe(30);
    expect(s.confirmed).toBe(true);
    expect(s.failStreak).toBe(1);
    expect(s.probesFailed).toBe(1);
  });

  it('ends in a settled full cadence, which a later descent does not make provisional', () => {
    const s = onProbation();
    const changes = play(s, 125);
    expect(changes.length).toBe(1);
    expect(changes[0]).toBeGreaterThan(118);
    expect(s.phase).toBe('observe');
    expect(frameCadenceAutoRecord(s)).toEqual({ ceiling: 0, confirmed: false, failStreak: 0 });
    expect(frameCadenceAutoHoldsQuality(s)).toBe(false);
    // Two windows: the one in flight is diluted by the clean frames before it.
    play(s, 35, { lateEvery: 5, untilChange: true });
    expect(s.ceiling).toBe(30);
    expect(s.confirmed).toBe(true);
  });

  it('ends in a confirmed hold one rung up on a fast display, with the fail streak cleared', () => {
    const s = createFrameCadenceAuto();
    restoreFrameCadenceAuto(s, { ceiling: 30, confirmed: true, failStreak: 2 });
    const feed = { refreshHz: 144, atBaseline: true, untilChange: true };
    play(s, 4 * 600 + 20, feed);
    expect(s.phase).toBe('probe');
    expect(s.ceiling).toBe(60);
    play(s, 5, feed);
    expect(s.phase).toBe('probation');
    expect(s.failStreak).toBe(2);
    play(s, 125, feed);
    expect(s.phase).toBe('held');
    expect(s.ceiling).toBe(60);
    expect(s.confirmed).toBe(true);
    expect(s.failStreak).toBe(0);
    expect(frameCadenceAutoRecord(s)).toEqual({ ceiling: 60, confirmed: true, failStreak: 0 });
  });
});

describe('a confirmed hold', () => {
  it('releases the quality hold', () => {
    expect(frameCadenceAutoHoldsQuality(heldAt30(true))).toBe(false);
    expect(frameCadenceAutoHoldsQuality(heldAt30(false))).toBe(true);
  });

  it('never probes without the governor at baseline, however long and clean', () => {
    const s = heldAt30(true);
    expect(play(s, 4 * AUTO_EVIDENCE_RUN_S)).toEqual([]);
    expect(s.probesStarted).toBe(0);
  });

  it('probes after a full evidence run, doubled by each failure', () => {
    const fresh = heldAt30(true);
    const first = play(fresh, AUTO_EVIDENCE_RUN_S + 10, { atBaseline: true, untilChange: true });
    expect(first.length).toBe(1);
    expect(first[0]).toBeGreaterThan(600);
    expect(first[0]).toBeLessThan(606);

    const failedTwice = heldAt30(true, 2);
    expect(play(failedTwice, 4 * AUTO_EVIDENCE_RUN_S - 10, { atBaseline: true })).toEqual([]);
    expect(play(failedTwice, 20, { atBaseline: true, untilChange: true }).length).toBe(1);
    expect(failedTwice.phase).toBe('probe');
  });

  it('clamps a restored fail streak', () => {
    const s = heldAt30(true, 99);
    expect(s.failStreak).toBe(4);
  });

  it('builds its evidence at the miss share a released governor settles on', () => {
    const s = heldAt30(true);
    // 1 in 15 (6.7 percent): over the clean share, under the governor's own line.
    const changes = play(s, 700, { atBaseline: true, lateEvery: 15 });
    expect(changes).toEqual([]);
    expect(s.evidenceS).toBeGreaterThan(600);
    // The probe then waits for a calmer stretch of the ring.
    expect(play(s, 10, { atBaseline: true, untilChange: true }).length).toBe(1);
    expect(s.phase).toBe('probe');
  });

  it('restarts the evidence run on an unclean checkpoint, a governor move or an exempt span', () => {
    for (const breakIt of [
      // Long enough to contain a whole checkpoint.
      (s: FrameCadenceAutoState) => void play(s, 4.1, { atBaseline: true, lateEvery: 8 }),
      (s: FrameCadenceAutoState) => void play(s, 4.1, { atBaseline: false }),
      (s: FrameCadenceAutoState) => void resetFrameCadenceAutoWindow(s),
    ]) {
      const s = heldAt30(true);
      play(s, AUTO_EVIDENCE_RUN_S - 30, { atBaseline: true });
      breakIt(s);
      expect(play(s, AUTO_EVIDENCE_RUN_S - 30, { atBaseline: true })).toEqual([]);
      expect(s.phase).toBe('held');
    }
  });

  it('still steps down when its own rhythm is missed', () => {
    const s = createFrameCadenceAuto();
    restoreFrameCadenceAuto(s, { ceiling: 60, confirmed: true, failStreak: 0 });
    play(s, 5, { lateEvery: 2, refreshHz: 144, untilChange: true });
    expect(s.ceiling).toBe(30);
    // On the fast rule, so it owes its confirming probe like any other.
    expect(s.confirmed).toBe(false);
  });

  it('spends at most the session budget', () => {
    const s = heldAt30(true);
    for (let i = 0; i < 4; i++) {
      play(s, 16 * AUTO_EVIDENCE_RUN_S + 100, { atBaseline: true, untilChange: true });
      if (s.phase === 'probe') play(s, 1, { lateEvery: 1, untilChange: true });
    }
    expect(s.probesStarted).toBe(2);
    expect(s.failStreak).toBe(2);
  });
});

describe('invalidation and restore', () => {
  it('observes again from scratch and gives one probe back', () => {
    const s = heldAt30(true, 3);
    s.probesLeft = 0;
    invalidateFrameCadenceAuto(s);
    expect(s.phase).toBe('observe');
    expect(s.ceiling).toBe(0);
    expect(s.failStreak).toBe(0);
    expect(s.probesLeft).toBe(1);
    invalidateFrameCadenceAuto(s);
    invalidateFrameCadenceAuto(s);
    expect(s.probesLeft).toBe(AUTO_PROBES_PER_SESSION);
    // The fast rule applies again, and the descent is provisional again.
    play(s, 3, { lateEvery: 2, untilChange: true });
    expect(s.ceiling).toBe(30);
    expect(s.confirmed).toBe(false);
  });

  it('restores a remembered "no ceiling" as a plain observation', () => {
    const s = createFrameCadenceAuto();
    restoreFrameCadenceAuto(s, { ceiling: 0, confirmed: true, failStreak: 2 });
    expect(s.phase).toBe('observe');
    expect(s.confirmed).toBe(false);
  });

  it('ignores frames without a duration or a display', () => {
    const s = createFrameCadenceAuto();
    const frame: FrameCadenceAutoFrame = {
      dtSeconds: 0,
      late: true,
      refreshHz: HZ,
      governorShedding: false,
      governorAtBaseline: false,
      calm: true,
      framesSinceExempt: 0,
    };
    for (let i = 0; i < 500; i++) stepFrameCadenceAuto(s, frame);
    for (let i = 0; i < 500; i++)
      stepFrameCadenceAuto(s, { ...frame, dtSeconds: 0.016, refreshHz: 0 });
    expect(s.ceiling).toBe(0);
    expect(s.recentCount).toBe(0);
  });
});
