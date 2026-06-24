import { describe, expect, it } from 'vitest';
import {
  stepJob, initialProgress, describeMilestone, parseMilestone,
  type JobConfig, type JobObservation, type JobProgress,
} from '../server/job_milestone';

// A baseline observation: subject alive, helper present, nothing happening.
// Each test overrides only the fields it cares about. Time is wall-clock seconds.
function obs(over: Partial<JobObservation> = {}): JobObservation {
  return {
    nowSec: 1000,
    subjectLevel: 1,
    subjectAlive: true,
    subjectDiedThisTick: false,
    subjectPos: { x: 0, z: 0 },
    helperPresent: true,
    questTurnIns: [],
    dungeonClears: [],
    ...over,
  };
}

const cfg = (over: Partial<JobConfig>): JobConfig => ({
  milestone: { kind: 'reach_level', target: 10 },
  deadlineSec: 10_000_000,
  requireHelperPresent: true,
  ...over,
});

function run(c: JobConfig, observations: JobObservation[], start: JobProgress = initialProgress()): JobProgress {
  return observations.reduce((p, o) => stepJob(c, p, o), start);
}

describe('reach_level', () => {
  const c = cfg({ milestone: { kind: 'reach_level', target: 10 } });
  it('completes when the subject hits the target level with the helper present', () => {
    expect(stepJob(c, initialProgress(), obs({ subjectLevel: 10 })).status).toBe('completed');
    expect(stepJob(c, initialProgress(), obs({ subjectLevel: 12 })).status).toBe('completed');
  });
  it('stays pending below target', () => {
    expect(stepJob(c, initialProgress(), obs({ subjectLevel: 9 })).status).toBe('pending');
  });
  it('does NOT complete while the helper is absent (no free payouts)', () => {
    expect(stepJob(c, initialProgress(), obs({ subjectLevel: 10, helperPresent: false })).status).toBe('pending');
  });
  it('a subject death does not void a levelling job (they can rez and continue)', () => {
    expect(stepJob(c, initialProgress(), obs({ subjectDiedThisTick: true, subjectLevel: 5 })).status).toBe('pending');
  });
});

describe('complete_quest', () => {
  const c = cfg({ milestone: { kind: 'complete_quest', questId: 'q_boar_hunt' } });
  it('completes on the matching turn-in', () => {
    expect(stepJob(c, initialProgress(), obs({ questTurnIns: ['q_boar_hunt'] })).status).toBe('completed');
  });
  it('ignores a different quest', () => {
    expect(stepJob(c, initialProgress(), obs({ questTurnIns: ['q_other'] })).status).toBe('pending');
  });
});

describe('clear_dungeon', () => {
  const c = cfg({ milestone: { kind: 'clear_dungeon', dungeonId: 'hollow_crypt' } });
  it('completes when the subject clears the agreed dungeon', () => {
    expect(stepJob(c, initialProgress(), obs({ dungeonClears: ['hollow_crypt'] })).status).toBe('completed');
  });
  it('is NOT voided by a death (deaths happen in raids; the goal is the clear)', () => {
    const p = stepJob(c, initialProgress(), obs({ subjectDiedThisTick: true }));
    expect(p.status).toBe('pending');
    expect(stepJob(c, p, obs({ dungeonClears: ['hollow_crypt'] })).status).toBe('completed');
  });
});

describe('escort', () => {
  const c = cfg({ milestone: { kind: 'escort', x: 100, z: 50, radius: 5 } });
  it('completes when the subject reaches the destination alive', () => {
    expect(stepJob(c, initialProgress(), obs({ subjectPos: { x: 102, z: 52 } })).status).toBe('completed');
  });
  it('stays pending while still far away', () => {
    expect(stepJob(c, initialProgress(), obs({ subjectPos: { x: 0, z: 0 } })).status).toBe('pending');
  });
  it('voids if the subject dies en route', () => {
    expect(stepJob(c, initialProgress(), obs({ subjectDiedThisTick: true })).reason).toBe('subject_died');
    expect(stepJob(c, initialProgress(), obs({ subjectDiedThisTick: true })).status).toBe('voided');
  });
  it('does not complete at the destination if the helper bailed', () => {
    expect(stepJob(c, initialProgress(), obs({ subjectPos: { x: 100, z: 50 }, helperPresent: false })).status).toBe('pending');
  });
});

describe('survive', () => {
  const c = cfg({ milestone: { kind: 'survive', durationSec: 100 } });
  it('completes after the full duration with the helper present', () => {
    const p1 = stepJob(c, initialProgress(), obs({ nowSec: 2000 })); // timer starts at 2000
    expect(p1.status).toBe('pending');
    expect(p1.startedSec).toBe(2000);
    const p2 = stepJob(c, p1, obs({ nowSec: 2100 })); // 100s later
    expect(p2.status).toBe('completed');
  });
  it('resets the timer if the helper leaves, so absence is not rewarded', () => {
    const p1 = stepJob(c, initialProgress(), obs({ nowSec: 2000 }));
    const p2 = stepJob(c, p1, obs({ nowSec: 2050, helperPresent: false })); // helper bails → reset
    expect(p2.startedSec).toBeNull();
    const p3 = stepJob(c, p2, obs({ nowSec: 2060 })); // timer restarts at 2060
    expect(p3.startedSec).toBe(2060);
    expect(stepJob(c, p3, obs({ nowSec: 2100 })).status).toBe('pending'); // only 40s in
  });
  it('voids if the subject dies during the window', () => {
    const p1 = stepJob(c, initialProgress(), obs({ nowSec: 2000 }));
    expect(stepJob(c, p1, obs({ nowSec: 2050, subjectDiedThisTick: true })).status).toBe('voided');
  });
});

describe('deadline and terminal stickiness', () => {
  it('voids (refund) when the deadline passes while still pending', () => {
    const c = cfg({ milestone: { kind: 'reach_level', target: 10 }, deadlineSec: 5000 });
    expect(stepJob(c, initialProgress(), obs({ nowSec: 5000, subjectLevel: 1 })).reason).toBe('expired');
    expect(stepJob(c, initialProgress(), obs({ nowSec: 5000, subjectLevel: 1 })).status).toBe('voided');
  });
  it('a completed job is never re-evaluated (late events cannot flip it)', () => {
    const c = cfg({ milestone: { kind: 'reach_level', target: 10 }, deadlineSec: 5000 });
    const completed = stepJob(c, initialProgress(), obs({ subjectLevel: 10 }));
    expect(completed.status).toBe('completed');
    const after = run(c, [obs({ nowSec: 6000, subjectDiedThisTick: true }), obs({ nowSec: 9999 })], completed);
    expect(after.status).toBe('completed');
  });
  it('a voided job stays voided', () => {
    const c = cfg({ milestone: { kind: 'escort', x: 100, z: 50, radius: 5 } });
    const voided = stepJob(c, initialProgress(), obs({ subjectDiedThisTick: true }));
    expect(voided.status).toBe('voided');
    expect(stepJob(c, voided, obs({ subjectPos: { x: 100, z: 50 } })).status).toBe('voided');
  });
});

describe('requireHelperPresent = false', () => {
  it('completes without the helper when presence is not required', () => {
    const c = cfg({ milestone: { kind: 'reach_level', target: 10 }, requireHelperPresent: false });
    expect(stepJob(c, initialProgress(), obs({ subjectLevel: 10, helperPresent: false })).status).toBe('completed');
  });
});

describe('describeMilestone', () => {
  it('summarises each milestone kind', () => {
    expect(describeMilestone({ kind: 'reach_level', target: 10 })).toMatch(/level 10/);
    expect(describeMilestone({ kind: 'survive', durationSec: 120 })).toMatch(/120s/);
  });
});

describe('parseMilestone (untrusted input)', () => {
  it('accepts well-formed milestones of each kind', () => {
    expect(parseMilestone({ kind: 'reach_level', target: 10 })).toEqual({ kind: 'reach_level', target: 10 });
    expect(parseMilestone({ kind: 'clear_dungeon', dungeonId: 'hollow_crypt' })).toEqual({ kind: 'clear_dungeon', dungeonId: 'hollow_crypt' });
    expect(parseMilestone({ kind: 'complete_quest', questId: 'q1' })).toEqual({ kind: 'complete_quest', questId: 'q1' });
    expect(parseMilestone({ kind: 'escort', x: 1, z: 2, radius: 5 })).toEqual({ kind: 'escort', x: 1, z: 2, radius: 5 });
    expect(parseMilestone({ kind: 'survive', durationSec: 300 })).toEqual({ kind: 'survive', durationSec: 300 });
  });
  it('rejects malformed / out-of-bounds input', () => {
    expect(parseMilestone(null)).toBeNull();
    expect(parseMilestone({ kind: 'nope' })).toBeNull();
    expect(parseMilestone({ kind: 'reach_level', target: 1 })).toBeNull();   // below min
    expect(parseMilestone({ kind: 'reach_level', target: 1.5 })).toBeNull(); // non-integer
    expect(parseMilestone({ kind: 'survive', durationSec: 5 })).toBeNull();  // too short
    expect(parseMilestone({ kind: 'escort', x: 1, z: 2, radius: 999 })).toBeNull(); // radius too big
    expect(parseMilestone({ kind: 'complete_quest', questId: '' })).toBeNull();
  });
});
