// Bow-native ranged cycle reducer (src/render/characters/bow_cycle.ts): the
// hunter's draw -> hold -> release phase machine and its launch-alignment
// timing. Pure and three-free, so every timeline runs directly in Node.
import { describe, expect, it } from 'vitest';
import {
  BOW_ARM_SLACK_S,
  BOW_DRAW_MAX_TIMESCALE,
  BOW_REMOTE_WINDOW_S,
  type BowCycleState,
  type BowFrameInput,
  bowArmScrubTime,
  bowDrawTimeScale,
  createBowCycle,
  tickBowCycle,
  writeBowShotInputs,
} from '../src/render/characters/bow_cycle';

const CFG = { armAt: 0.133 };

function input(over: Partial<BowFrameInput> = {}): BowFrameInput {
  return {
    dt: 0.016,
    poseOk: true,
    engaged: false,
    localIntent: false,
    timeToShot: null,
    launch: false,
    drawDone: false,
    looseDone: false,
    ...over,
  };
}

describe('tickBowCycle: the local auto-shot timeline', () => {
  it('runs engage -> draw -> hold -> arm -> loose -> draw as one seamless cycle', () => {
    const st = createBowCycle();
    // standing idle: nothing happens
    expect(tickBowCycle(st, input(), CFG)).toBe('none');
    expect(st.phase).toBe('off');
    // auto-shot engages on a live target in range
    expect(tickBowCycle(st, input({ engaged: true, timeToShot: 2.3 }), CFG)).toBe('draw');
    expect(st.phase).toBe('draw');
    // the draw one-shot finishes (visual reports back): settle into the hold
    expect(tickBowCycle(st, input({ engaged: true, timeToShot: 1.1, drawDone: true }), CFG)).toBe(
      'none',
    );
    expect(st.phase).toBe('hold');
    // countdown far away: keep holding
    expect(tickBowCycle(st, input({ engaged: true, timeToShot: 0.8 }), CFG)).toBe('none');
    expect(st.phase).toBe('hold');
    // countdown inside the snap window: arm the release (scrubbed from here)
    expect(tickBowCycle(st, input({ engaged: true, timeToShot: 0.12 }), CFG)).toBe('arm');
    expect(st.phase).toBe('arm');
    // the sim launch event lands: loose (snap + follow-through)
    expect(tickBowCycle(st, input({ engaged: true, timeToShot: 2.3, launch: true }), CFG)).toBe(
      'loose',
    );
    expect(st.phase).toBe('loose');
    // follow-through ends while still engaged: draw the next arrow
    expect(tickBowCycle(st, input({ engaged: true, timeToShot: 1.5, looseDone: true }), CFG)).toBe(
      'draw',
    );
    expect(st.phase).toBe('draw');
  });

  it('lowers the bow when the engagement drops mid-hold', () => {
    const st: BowCycleState = { phase: 'hold', remoteWindow: 0 };
    expect(tickBowCycle(st, input({ engaged: false }), CFG)).toBe('lower');
    expect(st.phase).toBe('off');
  });

  it('retreats from arm back to hold when the countdown is pushed past the slack', () => {
    const st: BowCycleState = { phase: 'arm', remoteWindow: 0 };
    // still inside slack: stay armed (the scrub simply parks)
    expect(
      tickBowCycle(
        st,
        input({ engaged: true, timeToShot: CFG.armAt + BOW_ARM_SLACK_S - 0.05 }),
        CFG,
      ),
    ).toBe('none');
    expect(st.phase).toBe('arm');
    // pushed beyond the slack (cast pushback / gate stall): back to the hold
    expect(
      tickBowCycle(
        st,
        input({ engaged: true, timeToShot: CFG.armAt + BOW_ARM_SLACK_S + 0.2 }),
        CFG,
      ),
    ).toBe('hold');
    expect(st.phase).toBe('hold');
  });

  it('interrupts the draw to arm when engaging with the shot already imminent', () => {
    const st: BowCycleState = { phase: 'draw', remoteWindow: 0 };
    expect(tickBowCycle(st, input({ engaged: true, timeToShot: 0.05 }), CFG)).toBe('arm');
    expect(st.phase).toBe('arm');
  });

  it('cuts draw/hold/arm to lower when the pose breaks (movement)', () => {
    for (const phase of ['draw', 'hold', 'arm'] as const) {
      const st: BowCycleState = { phase, remoteWindow: 0 };
      expect(tickBowCycle(st, input({ engaged: true, poseOk: false, timeToShot: 1 }), CFG)).toBe(
        'lower',
      );
      expect(st.phase).toBe('off');
    }
  });

  it('replays the snap for an instant re-shot mid-follow-through', () => {
    const st: BowCycleState = { phase: 'loose', remoteWindow: 0 };
    expect(tickBowCycle(st, input({ engaged: true, launch: true }), CFG)).toBe('loose');
    expect(st.phase).toBe('loose');
  });

  it('cuts the follow-through to lower when the pose breaks mid-loose', () => {
    const st: BowCycleState = { phase: 'loose', remoteWindow: 0 };
    expect(tickBowCycle(st, input({ engaged: true, poseOk: false }), CFG)).toBe('lower');
    expect(st.phase).toBe('off');
  });

  it('lowers after the follow-through the moment LOCAL engagement ends', () => {
    // the local player's engagement is authoritative: the recent-shot window
    // (opened by its own launches) never keeps its bow up after the target dies
    const st: BowCycleState = { phase: 'loose', remoteWindow: 3 };
    expect(
      tickBowCycle(st, input({ engaged: false, localIntent: true, looseDone: true }), CFG),
    ).toBe('lower');
    expect(st.phase).toBe('off');
  });
});

describe('tickBowCycle: remote rigs (no local prediction)', () => {
  it('ignores a launch while the pose cannot shoot (mid-run shots stay bodiless)', () => {
    const st = createBowCycle();
    expect(tickBowCycle(st, input({ poseOk: false, launch: true }), CFG)).toBe('none');
    expect(st.phase).toBe('off');
  });

  it('rides launch events: loose from cold, then draw+hold inside the window', () => {
    const st = createBowCycle();
    // first observed shot: snap immediately (no draw was predictable)
    expect(tickBowCycle(st, input({ launch: true }), CFG)).toBe('loose');
    expect(st.remoteWindow).toBe(BOW_REMOTE_WINDOW_S);
    // follow-through ends: the recent-shot window keeps the cycle alive
    expect(tickBowCycle(st, input({ looseDone: true }), CFG)).toBe('draw');
    expect(tickBowCycle(st, input({ drawDone: true }), CFG)).toBe('none');
    expect(st.phase).toBe('hold');
    // the window expires with no further shots: lower the bow
    expect(tickBowCycle(st, input({ dt: BOW_REMOTE_WINDOW_S + 0.1 }), CFG)).toBe('lower');
    expect(st.phase).toBe('off');
  });

  it('never raises the bow off the recent-shot window while the pose is broken', () => {
    const st: BowCycleState = { phase: 'off', remoteWindow: 3 };
    expect(tickBowCycle(st, input({ poseOk: false }), CFG)).toBe('none');
    expect(st.phase).toBe('off');
  });
});

describe('release timing math', () => {
  it('scrubs the pre-snap segment 1:1 against the countdown, parked at full draw', () => {
    expect(bowArmScrubTime(0.133, 0.133)).toBe(0);
    expect(bowArmScrubTime(0.133, 0.05)).toBeCloseTo(0.083, 5);
    // stalled shot (gates blocking at timer zero): park exactly at the snap frame
    expect(bowArmScrubTime(0.133, 0)).toBeCloseTo(0.133, 5);
    // countdown above the window never scrubs backwards past the start
    expect(bowArmScrubTime(0.133, 0.5)).toBe(0);
  });

  it('compresses the draw so it completes before the release must arm', () => {
    // plenty of time: authored pace
    expect(bowDrawTimeScale(1.033, 0.133, 2.3)).toBe(1);
    expect(bowDrawTimeScale(1.033, 0.133, null)).toBe(1);
    // hasted swing: the draw speeds up to fit
    const tight = bowDrawTimeScale(1.033, 0.133, 0.8);
    expect(tight).toBeGreaterThan(1);
    expect(tight).toBeLessThanOrEqual(BOW_DRAW_MAX_TIMESCALE);
    // hopeless windows cap out rather than divide toward infinity
    expect(bowDrawTimeScale(1.033, 0.133, 0.1)).toBe(BOW_DRAW_MAX_TIMESCALE);
  });
});

describe('writeBowShotInputs (renderer-side facts)', () => {
  const HUNTER = {
    kind: 'player',
    templateId: 'hunter',
    autoAttack: false,
    swingTimer: 0,
    castingAbility: null as string | null,
    castRemaining: 0,
  };
  const scratch = () =>
    ({ bowEngaged: undefined, bowLocalIntent: undefined, bowTimeToShot: undefined }) as {
      bowEngaged?: boolean;
      bowLocalIntent?: boolean;
      bowTimeToShot?: number | null;
    };

  it('engages a projectile shot cast for ANY entity (castRemaining is replicated)', () => {
    const st = scratch();
    writeBowShotInputs(
      st,
      { ...HUNTER, castingAbility: 'aimed_shot', castRemaining: 1.7 },
      false,
      null,
    );
    expect(st.bowEngaged).toBe(true);
    expect(st.bowTimeToShot).toBe(1.7);
  });

  it('never engages a non-projectile cast (only explicit projectile shots draw)', () => {
    const st = scratch();
    writeBowShotInputs(st, { ...HUNTER, castingAbility: 'mend_pet', castRemaining: 2 }, true, 10);
    expect(st.bowEngaged).toBe(false);
    expect(st.bowTimeToShot).toBeNull();
  });

  it('engages the SELF auto-shot inside the ranged window with the swing timer', () => {
    const st = scratch();
    writeBowShotInputs(st, { ...HUNTER, autoAttack: true, swingTimer: 1.4 }, true, 20);
    expect(st.bowEngaged).toBe(true);
    expect(st.bowTimeToShot).toBe(1.4);
    expect(st.bowLocalIntent).toBe(true);
  });

  it('marks intent authoritative ONLY for the local player entity', () => {
    // localIntent alone decides whether the recent-shot window may keep the
    // bow raised (a remote rig) or must never (the local player, whose
    // engagement folds the moment the target dies)
    const self = scratch();
    writeBowShotInputs(self, HUNTER, true, null);
    expect(self.bowLocalIntent).toBe(true);
    const remote = scratch();
    writeBowShotInputs(remote, HUNTER, false, null);
    expect(remote.bowLocalIntent).toBe(false);
    const mob = scratch();
    writeBowShotInputs(mob, { ...HUNTER, kind: 'mob' }, true, null);
    expect(mob.bowLocalIntent).toBe(false);
  });

  it('does not engage outside the window, for remote rigs, or for non-players', () => {
    const outOfRange = scratch();
    writeBowShotInputs(outOfRange, { ...HUNTER, autoAttack: true }, true, 40);
    expect(outOfRange.bowEngaged).toBe(false);
    const deadZone = scratch();
    writeBowShotInputs(deadZone, { ...HUNTER, autoAttack: true }, true, 4);
    expect(deadZone.bowEngaged).toBe(false);
    const remote = scratch();
    writeBowShotInputs(remote, { ...HUNTER, autoAttack: true }, false, 20);
    expect(remote.bowEngaged).toBe(false);
    const mob = scratch();
    writeBowShotInputs(mob, { ...HUNTER, kind: 'mob', autoAttack: true }, true, 20);
    expect(mob.bowEngaged).toBe(false);
  });
});
