import { describe, expect, it } from 'vitest';
import {
  stepJob, initialProgress, describeMilestone,
  type JobConfig, type JobObservation, type JobProgress,
} from '../server/job_milestone';

// A baseline observation: subject alive, helper present, nothing happening.
// Each test overrides only the fields it cares about.
function obs(over: Partial<JobObservation> = {}): JobObservation {
  return {
    tick: 100,
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
  deadlineTick: 1_000_000,
  requireHelperPresent: true,
  ...over,
});

// Drive a sequence of observations through the engine, returning final progress.
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
  const c = cfg({ milestone: { kind: 'survive', durationTicks: 100 } });
  it('completes after the full duration with the helper present', () => {
    const p1 = stepJob(c, initialProgress(), obs({ tick: 200 })); // timer starts at 200
    expect(p1.status).toBe('pending');
    expect(p1.startedTick).toBe(200);
    const p2 = stepJob(c, p1, obs({ tick: 300 })); // 100 ticks later
    expect(p2.status).toBe('completed');
  });
  it('resets the timer if the helper leaves, so absence is not rewarded', () => {
    const p1 = stepJob(c, initialProgress(), obs({ tick: 200 }));
    const p2 = stepJob(c, p1, obs({ tick: 250, helperPresent: false })); // helper bails → reset
    expect(p2.startedTick).toBeNull();
    const p3 = stepJob(c, p2, obs({ tick: 260 })); // timer restarts at 260
    expect(p3.startedTick).toBe(260);
    expect(stepJob(c, p3, obs({ tick: 300 })).status).toBe('pending'); // only 40 ticks in
  });
  it('voids if the subject dies during the window', () => {
    const p1 = stepJob(c, initialProgress(), obs({ tick: 200 }));
    expect(stepJob(c, p1, obs({ tick: 250, subjectDiedThisTick: true })).status).toBe('voided');
  });
});

describe('deadline and terminal stickiness', () => {
  it('voids (refund) when the deadline passes while still pending', () => {
    const c = cfg({ milestone: { kind: 'reach_level', target: 10 }, deadlineTick: 500 });
    expect(stepJob(c, initialProgress(), obs({ tick: 500, subjectLevel: 1 })).reason).toBe('expired');
    expect(stepJob(c, initialProgress(), obs({ tick: 500, subjectLevel: 1 })).status).toBe('voided');
  });
  it('a completed job is never re-evaluated (late events cannot flip it)', () => {
    const c = cfg({ milestone: { kind: 'reach_level', target: 10 }, deadlineTick: 500 });
    const completed = stepJob(c, initialProgress(), obs({ subjectLevel: 10 }));
    expect(completed.status).toBe('completed');
    // A later death + past deadline must not change the settled outcome.
    const after = run(c, [obs({ tick: 600, subjectDiedThisTick: true }), obs({ tick: 999 })], completed);
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
    expect(describeMilestone({ kind: 'survive', durationTicks: 200 })).toMatch(/10s/); // 200 ticks / 20 = 10s
  });
});
