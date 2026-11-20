import { describe, expect, it } from 'vitest';
import type { InputTickFrame } from '../src/game/input_tick_sampler';
import {
  type MotionState,
  PredictionRing,
  predictTick,
  reconcile,
  SELF_PREDICTION_RING_CAPACITY,
} from '../src/render/self_prediction_core';

function state(x = 0): MotionState {
  return {
    id: 1,
    pos: { x, y: 2, z: 3 },
    prevPos: { x, y: 2, z: 3 },
    facing: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    onGround: true,
    jumping: false,
    fallStartY: 2,
    swimStroke: 0,
    swimDiving: false,
    auras: [],
    ghost: false,
    sitting: false,
    castingAbility: null,
    maxHp: 100,
    mountKey: '',
    mountCastRemaining: 0,
    mountCastKey: '',
  };
}

function frame(ct: number, facing: number | null = null): InputTickFrame {
  return {
    ct,
    facing,
    mi: {
      forward: true,
      back: false,
      turnLeft: false,
      turnRight: false,
      strafeLeft: false,
      strafeRight: false,
      jump: false,
      dive: false,
      surface: false,
    },
  };
}

const step = (motion: MotionState): void => {
  motion.pos.x += 1;
  motion.vx = 20;
};

describe('self prediction core', () => {
  it('replays each frame from the mirrored state it was first predicted from', () => {
    // A marker aura the step reads, and that the step itself takes off (a
    // glider ending on landing): a replay must start the frame WITH it.
    const marker = {
      id: 'mark',
      name: 'm',
      kind: 'internal_cd',
      remaining: 9,
      duration: 9,
      value: 0,
      sourceId: 0,
      school: 'nature',
    } as MotionState['auras'][number];
    const stepMarked = (m: MotionState): void => {
      const held = m.auras.some((a) => a.id === 'mark');
      m.pos.x += held ? 1 : 0.5;
      if (held) m.auras = m.auras.filter((a) => a.id !== 'mark');
    };
    const ring = new PredictionRing();
    let s = predictTick(ring, state(0), frame(0), stepMarked);
    s = predictTick(ring, { ...s, auras: [marker] }, frame(1), stepMarked);
    s = predictTick(ring, s, frame(2), stepMarked);
    expect(s.pos.x).toBe(2);
    // The acknowledged frame 0 lands a little east: replay frames 1 and 2.
    const result = reconcile(ring, 0, { x: 0.6, y: 2, z: 3, facing: 0 }, 0, 0, stepMarked);
    expect(result.mode).toBe('replayed');
    expect(ring.head?.pose.pos.x).toBeCloseTo(2.1, 9);
  });

  it('steps once and records a full independent motion state', () => {
    const ring = new PredictionRing();
    const initial = state();
    const predicted = predictTick(ring, initial, frame(0, 0.5), step);

    expect(predicted.pos.x).toBe(1);
    expect(predicted.prevPos.x).toBe(0);
    expect(predicted.facing).toBe(0.5);
    expect(ring.head?.pose).toEqual(predicted);

    predicted.pos.x = 99;
    expect(ring.head?.pose.pos.x).toBe(1);
    expect(initial.pos.x).toBe(0);
  });

  it('bounds the ring at 128 entries', () => {
    const ring = new PredictionRing();
    let predicted = state();
    for (let ct = 0; ct < SELF_PREDICTION_RING_CAPACITY + 3; ct++) {
      predicted = predictTick(ring, predicted, frame(ct), step);
    }

    expect(ring.size).toBe(SELF_PREDICTION_RING_CAPACITY);
    expect(ring.oldestClientTick).toBe(3);
    expect(ring.head?.ct).toBe(130);
  });

  it('drops acknowledged entries after an exact position match', () => {
    const ring = new PredictionRing();
    let predicted = predictTick(ring, state(), frame(0), step);
    predicted = predictTick(ring, predicted, frame(1), step);

    expect(reconcile(ring, 0, { x: 1, y: 2, z: 3, facing: 7 }, 4, 4, step)).toEqual({
      mode: 'match',
    });
    expect(ring.size).toBe(1);
    expect(ring.head?.ct).toBe(1);
  });

  it('rebases and replays later inputs with an exact residual', () => {
    const ring = new PredictionRing();
    let predicted = predictTick(ring, state(), frame(0), step);
    predicted = predictTick(ring, predicted, frame(1), step);
    predictTick(ring, predicted, frame(2), step);

    const result = reconcile(ring, 0, { x: 0.25, y: 2, z: 3, facing: 0.75 }, 2, 2, step);

    expect(result).toEqual({
      mode: 'replayed',
      residual: { x: 0.75, y: 0, z: 0 },
    });
    expect(ring.size).toBe(2);
    expect(ring.find(1)?.pose.pos.x).toBe(1.25);
    expect(ring.head?.pose.pos.x).toBe(2.25);
    expect(ring.find(1)?.pose.prevPos.x).toBe(0.25);
  });

  it('suspends before replay when the override epoch changes', () => {
    const ring = new PredictionRing();
    predictTick(ring, state(), frame(0), step);

    expect(reconcile(ring, 0, { x: 1, y: 2, z: 3, facing: 0 }, 3, 2, step)).toEqual({
      mode: 'suspend',
    });
    expect(ring.size).toBe(1);
  });

  it('ignores an in-flight acknowledgement from before a re-anchored ring', () => {
    const ring = new PredictionRing();
    const predicted = predictTick(ring, state(), frame(71), step);
    predictTick(ring, predicted, frame(72), step);

    expect(reconcile(ring, 68, { x: 1, y: 2, z: 3, facing: 0 }, 4, 4, step)).toEqual({
      mode: 'ignore',
    });
    expect(ring.size).toBe(2);
    expect(ring.oldestClientTick).toBe(71);
    expect(ring.head?.ct).toBe(72);
  });

  it('marks an acknowledgement older than the retained tail as stale', () => {
    const ring = new PredictionRing(2);
    let predicted = state();
    for (let ct = 0; ct < 3; ct++) predicted = predictTick(ring, predicted, frame(ct), step);

    expect(reconcile(ring, 0, { x: 1, y: 2, z: 3, facing: 0 }, 0, 0, step)).toEqual({
      mode: 'stale',
    });
  });
});
