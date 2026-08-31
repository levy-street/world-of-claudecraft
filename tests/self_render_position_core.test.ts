import { describe, expect, it } from 'vitest';
import type { SelfMotionFrame, SelfMotionPredictor, Vec3Like } from '../src/render/self_motion';
import { SELF_MOTION_SNAP_DIST_SQ } from '../src/render/self_motion';
import {
  createSelfRenderPositionState,
  MAX_SELF_REWIND_YD_PER_SEC,
  noteSelfIdentity,
  type SelfRenderPositionState,
  selfSnapshotAlpha,
  updateSelfRenderPosition,
} from '../src/render/self_render_position_core';
import { Sim } from '../src/sim/sim';
import type { Entity, MoveInput } from '../src/sim/types';

const SEED = 42;
const FRAME_DT = 1 / 60;
const HANDOFF_RATE = 15;

const mi = (over: Partial<MoveInput> = {}): MoveInput => ({
  forward: false,
  back: false,
  turnLeft: false,
  turnRight: false,
  strafeLeft: false,
  strafeRight: false,
  jump: false,
  dive: false,
  surface: false,
  ...over,
});

const frame = (over: Partial<SelfMotionFrame> = {}): SelfMotionFrame => ({
  enabled: true,
  moveInput: mi({ forward: true }),
  displayFacing: 0,
  echoMs: 80,
  jitterMs: 10,
  alpha: 0.5,
  frameDt: FRAME_DT,
  snapAgeMs: 25,
  snapIntervalMs: 50,
  riftFloor: null,
  ...over,
});

/** A predictor stand-in whose output the test scripts frame by frame. */
function stubPredictor(next: () => Vec3Like | null): SelfMotionPredictor {
  return { step: () => next(), leadMs: 0, onGround: true } as unknown as SelfMotionPredictor;
}

/** A player entity with an authoritative interpolation segment to fall back to. */
function playerAt(prev: Vec3Like, pos: Vec3Like): Entity {
  return { prevPos: { ...prev }, pos: { ...pos } } as unknown as Entity;
}

describe('selfSnapshotAlpha', () => {
  it('adds the lead to the frame alpha', () => {
    expect(selfSnapshotAlpha(0.5, 0.2)).toBeCloseTo(0.7, 10);
    expect(selfSnapshotAlpha(0, 0)).toBe(0);
  });

  it('ignores a negative lead and caps the sum at 1.25', () => {
    expect(selfSnapshotAlpha(0.5, -5)).toBe(0.5);
    expect(selfSnapshotAlpha(1.25, 0.5)).toBe(1.25);
    expect(selfSnapshotAlpha(1, 0.25)).toBe(1.25);
  });
});

describe('createSelfRenderPositionState', () => {
  it('starts unready, inactive, unbound and without a predictor', () => {
    const state = createSelfRenderPositionState();
    expect(state.ready).toBe(false);
    expect(state.active).toBe(false);
    expect(state.lastSelfId).toBeNull();
    expect(state.predictor).toBeNull();
    expect(state.offset).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('adopts the caller-owned position object, so the renderer keeps its Vector3', () => {
    const owned = { x: 1, y: 2, z: 3 };
    const state = createSelfRenderPositionState(owned);
    expect(state.position).toBe(owned);
    updateSelfRenderPosition(
      state,
      playerAt({ x: 4, y: 0, z: 0 }, { x: 4, y: 0, z: 0 }),
      SEED,
      1,
      FRAME_DT,
      0,
      null,
      false,
    );
    expect(owned).toEqual({ x: 4, y: 0, z: 0 });
  });
});

describe('noteSelfIdentity', () => {
  it('reports the first bind and drops any carry-over from the previous character', () => {
    const state = createSelfRenderPositionState();
    state.ready = true;
    state.offset.x = 3;
    expect(noteSelfIdentity(state, 7)).toBe(true);
    expect(state.lastSelfId).toBe(7);
    expect(state.ready).toBe(false);
    expect(state.offset).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('is a no-op while the same character keeps drawing', () => {
    const state = createSelfRenderPositionState();
    noteSelfIdentity(state, 7);
    state.ready = true;
    state.offset.x = 3;
    expect(noteSelfIdentity(state, 7)).toBe(false);
    expect(state.ready).toBe(true);
    expect(state.offset.x).toBe(3);
  });

  it('reports a change on a new self id', () => {
    const state = createSelfRenderPositionState();
    noteSelfIdentity(state, 7);
    expect(noteSelfIdentity(state, 8)).toBe(true);
    expect(state.lastSelfId).toBe(8);
  });
});

describe('updateSelfRenderPosition fallback path', () => {
  const runFallback = (
    state: SelfRenderPositionState,
    player: Entity,
    alpha: number,
    lead: number,
  ): Vec3Like => updateSelfRenderPosition(state, player, SEED, alpha, FRAME_DT, lead, null, false);

  it('interpolates the authoritative segment at alpha plus lead', () => {
    const state = createSelfRenderPositionState();
    const player = playerAt({ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 });
    runFallback(state, player, 0.5, 0);
    expect(state.position.x).toBeCloseTo(5, 10);
    expect(state.ready).toBe(true);
    expect(state.active).toBe(false);
  });

  it('snaps on the first frame even with smoothing on, then eases', () => {
    const state = createSelfRenderPositionState();
    const player = playerAt({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 });
    // Not ready yet: the fallback must place the body outright.
    runFallback(state, player, 1, 0.2);
    expect(state.position.x).toBe(0);
    // Ready now, so a one-yard step is smoothed rather than teleported.
    const stepped = playerAt({ x: 1, y: 0, z: 0 }, { x: 1, y: 0, z: 0 });
    runFallback(state, stepped, 1, 0.2);
    expect(state.position.x).toBeGreaterThan(0);
    expect(state.position.x).toBeLessThan(1);
  });

  it('never smooths without a lead, so the offline path stays exact', () => {
    const state = createSelfRenderPositionState();
    runFallback(state, playerAt({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }), 1, 0);
    runFallback(state, playerAt({ x: 1, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }), 1, 0);
    expect(state.position.x).toBe(1);
  });

  it('snaps past the teleport threshold even while smoothing', () => {
    const state = createSelfRenderPositionState();
    const far = Math.sqrt(SELF_MOTION_SNAP_DIST_SQ) + 1;
    runFallback(state, playerAt({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }), 1, 0.2);
    runFallback(state, playerAt({ x: far, y: 0, z: 0 }, { x: far, y: 0, z: 0 }), 1, 0.2);
    expect(state.position.x).toBe(far);
  });

  it('builds no predictor while the frame carries no self motion', () => {
    const state = createSelfRenderPositionState();
    runFallback(state, playerAt({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }), 1, 0);
    expect(state.predictor).toBeNull();
  });
});

describe('updateSelfRenderPosition predictor path', () => {
  const runPredicted = (
    state: SelfRenderPositionState,
    player: Entity,
    discontinuity = false,
  ): Vec3Like =>
    updateSelfRenderPosition(state, player, SEED, 1, FRAME_DT, 0.2, frame(), discontinuity);

  it('drives a scripted handoff: fallback, capture, decay, drop back, self change', () => {
    const state = createSelfRenderPositionState();
    const player = playerAt({ x: 10, y: 0, z: 0 }, { x: 10, y: 0, z: 0 });
    noteSelfIdentity(state, 1);

    // 1. Fallback frame: the lead-smoothing path owns the pose and marks it ready.
    updateSelfRenderPosition(state, player, SEED, 1, FRAME_DT, 0.2, null, false);
    expect(state.position.x).toBe(10);
    expect(state.active).toBe(false);

    // 2. Handoff frame: the predictor takes over one yard behind the drawn pose,
    //    so the gap is captured as an offset and immediately decayed once.
    let predicted: Vec3Like = { x: 9, y: 0, z: 0 };
    state.predictor = stubPredictor(() => predicted);
    const decay = Math.exp(-HANDOFF_RATE * FRAME_DT);
    runPredicted(state, player);
    expect(state.offset.x).toBeCloseTo(1 * decay, 10);
    expect(state.position.x).toBeCloseTo(9 + 1 * decay, 10);
    expect(state.active).toBe(true);
    expect(state.ready).toBe(true);

    // 3. Next frame: no re-capture (the predictor is already active), the
    //    residual offset just decays again toward zero.
    predicted = { x: 8, y: 0, z: 0 };
    runPredicted(state, player);
    expect(state.offset.x).toBeCloseTo(decay * decay, 10);
    expect(state.position.x).toBeCloseTo(8 + decay * decay, 10);

    // 4. The predictor declines a frame: the fallback path captures the gap
    //    and starts a bounded handoff, while the active flag drops so a later
    //    re-entry captures a fresh offset.
    const handedOver = state.position.x;
    state.predictor = stubPredictor(() => null);
    runPredicted(state, player);
    expect(state.active).toBe(false);
    expect(state.position.x).toBeCloseTo(handedOver + MAX_SELF_REWIND_YD_PER_SEC * FRAME_DT, 10);

    // 5. A new character invalidates the whole carry-over.
    expect(noteSelfIdentity(state, 2)).toBe(true);
    expect(state.ready).toBe(false);
    expect(state.offset).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('bounds and smoothly decays a 1.4 yard predictor lead when the gate closes', () => {
    const state = createSelfRenderPositionState();
    const player = playerAt({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 });
    updateSelfRenderPosition(
      state,
      player,
      SEED,
      1,
      FRAME_DT,
      0.2,
      { kind: 'reconciled', position: { x: 1.4, y: 0, z: 0 }, residual: null },
      false,
    );

    let previous = state.position.x;
    for (let frameIndex = 0; frameIndex < 20; frameIndex++) {
      updateSelfRenderPosition(state, player, SEED, 1, FRAME_DT, 0.2, null, false);
      const rewind = previous - state.position.x;
      expect(rewind).toBeGreaterThan(0);
      expect(rewind).toBeLessThanOrEqual(MAX_SELF_REWIND_YD_PER_SEC * FRAME_DT + 1e-12);
      previous = state.position.x;
    }

    expect(state.position.x).toBeLessThan(0.1);
    expect(state.position.x).toBeGreaterThan(0);
  });

  it('bounds the total rewind when the fallback base also retreats', () => {
    const state = createSelfRenderPositionState();
    updateSelfRenderPosition(
      state,
      playerAt({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }),
      SEED,
      1,
      FRAME_DT,
      0.2,
      { kind: 'reconciled', position: { x: 1.4, y: 0, z: 0 }, residual: null },
      false,
    );
    updateSelfRenderPosition(
      state,
      playerAt({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }),
      SEED,
      1,
      FRAME_DT,
      0.2,
      null,
      false,
    );

    const previous = state.position.x;
    const retreatedBase = playerAt({ x: -0.02, y: 0, z: 0 }, { x: -0.02, y: 0, z: 0 });
    updateSelfRenderPosition(state, retreatedBase, SEED, 1, FRAME_DT, 0.2, null, false);

    expect(previous - state.position.x).toBeCloseTo(MAX_SELF_REWIND_YD_PER_SEC * FRAME_DT, 12);

    for (let frameIndex = 0; frameIndex < 100; frameIndex++) {
      updateSelfRenderPosition(state, retreatedBase, SEED, 1, FRAME_DT, 0.2, null, false);
    }
    expect(state.offset.x).toBeCloseTo(0, 10);
    expect(state.position.x).toBeCloseTo(-0.02, 10);
  });

  it('captures no offset when the predictor is the first to place the body', () => {
    const state = createSelfRenderPositionState();
    state.predictor = stubPredictor(() => ({ x: 5, y: 1, z: 2 }));
    runPredicted(state, playerAt({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }));
    expect(state.offset).toEqual({ x: 0, y: 0, z: 0 });
    expect(state.position).toEqual({ x: 5, y: 1, z: 2 });
  });

  it('uses the shared handoff offset for a reconciled v2 residual', () => {
    const state = createSelfRenderPositionState();
    const player = playerAt({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 });
    const decay = Math.exp(-HANDOFF_RATE * FRAME_DT);
    updateSelfRenderPosition(
      state,
      player,
      SEED,
      1,
      FRAME_DT,
      0,
      {
        kind: 'reconciled',
        position: { x: 4, y: 2, z: 1 },
        residual: { x: 1, y: -1, z: 0.5 },
      },
      false,
    );

    expect(state.position.x).toBeCloseTo(4 + decay, 10);
    expect(state.position.y).toBeCloseTo(2 - decay, 10);
    expect(state.position.z).toBeCloseTo(1 + 0.5 * decay, 10);
    expect(state.predictor).toBeNull();
  });

  it('clears the handoff offset outright on an authoritative discontinuity', () => {
    const state = createSelfRenderPositionState();
    const player = playerAt({ x: 10, y: 0, z: 0 }, { x: 10, y: 0, z: 0 });
    updateSelfRenderPosition(state, player, SEED, 1, FRAME_DT, 0.2, null, false);
    state.predictor = stubPredictor(() => ({ x: 9, y: 0, z: 0 }));
    runPredicted(state, player, true);
    expect(state.offset).toEqual({ x: 0, y: 0, z: 0 });
    expect(state.position.x).toBe(9);
  });

  it('carries the offset on all three axes', () => {
    const state = createSelfRenderPositionState();
    state.ready = true;
    state.position.x = 1;
    state.position.y = 2;
    state.position.z = 3;
    state.predictor = stubPredictor(() => ({ x: 0, y: 0, z: 0 }));
    const decay = Math.exp(-HANDOFF_RATE * FRAME_DT);
    runPredicted(state, playerAt({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }));
    expect(state.position.x).toBeCloseTo(1 * decay, 10);
    expect(state.position.y).toBeCloseTo(2 * decay, 10);
    expect(state.position.z).toBeCloseTo(3 * decay, 10);
  });

  it('builds the real predictor lazily, from the seed it is handed', () => {
    const sim = new Sim({ seed: SEED, playerClass: 'warrior', autoEquip: true });
    const state = createSelfRenderPositionState();
    updateSelfRenderPosition(state, sim.player, sim.cfg.seed, 1, FRAME_DT, 0.2, frame(), false);
    expect(state.predictor).not.toBeNull();
    const built = state.predictor;
    updateSelfRenderPosition(state, sim.player, sim.cfg.seed, 1, FRAME_DT, 0.2, frame(), false);
    expect(state.predictor).toBe(built);
  });
});
