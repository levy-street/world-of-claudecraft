import { describe, expect, it } from 'vitest';
import type { Vec3Like } from '../src/render/self_motion';
import { SELF_MOTION_SNAP_DIST_SQ } from '../src/render/self_motion';
import {
  createSelfRenderPositionState,
  MAX_SELF_REWIND_YD_PER_SEC,
  noteSelfIdentity,
  type ReconciledSelfPrediction,
  type SelfRenderPositionState,
  selfSnapshotAlpha,
  updateSelfRenderPosition,
} from '../src/render/self_render_position_core';
import type { Entity } from '../src/sim/types';

const FRAME_DT = 1 / 60;
const HANDOFF_RATE = 15;

/** The reconciled prediction the pipeline hands the renderer for one frame. */
const reconciled = (
  position: Vec3Like,
  residual: Vec3Like | null = null,
): ReconciledSelfPrediction => ({ position, residual });

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
  it('starts unready, inactive and unbound', () => {
    const state = createSelfRenderPositionState();
    expect(state.ready).toBe(false);
    expect(state.active).toBe(false);
    expect(state.lastSelfId).toBeNull();
    expect(state.offset).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('adopts the caller-owned position object, so the renderer keeps its Vector3', () => {
    const owned = { x: 1, y: 2, z: 3 };
    const state = createSelfRenderPositionState(owned);
    expect(state.position).toBe(owned);
    updateSelfRenderPosition(
      state,
      playerAt({ x: 4, y: 0, z: 0 }, { x: 4, y: 0, z: 0 }),
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
  ): Vec3Like => updateSelfRenderPosition(state, player, alpha, FRAME_DT, lead, null, false);

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
});

describe('updateSelfRenderPosition reconciled path', () => {
  const runReconciled = (
    state: SelfRenderPositionState,
    player: Entity,
    selfMotion: ReconciledSelfPrediction | null,
    discontinuity = false,
  ): Vec3Like =>
    updateSelfRenderPosition(state, player, 1, FRAME_DT, 0.2, selfMotion, discontinuity);

  it('drives a scripted handoff: fallback, capture, decay, drop back, self change', () => {
    const state = createSelfRenderPositionState();
    const player = playerAt({ x: 10, y: 0, z: 0 }, { x: 10, y: 0, z: 0 });
    noteSelfIdentity(state, 1);

    // 1. Fallback frame: the lead-smoothing path owns the pose and marks it ready.
    runReconciled(state, player, null);
    expect(state.position.x).toBe(10);
    expect(state.active).toBe(false);

    // 2. Handoff frame: the reconciled pose lands one yard behind the drawn
    //    pose, so the gap is captured as an offset and immediately decayed once.
    const decay = Math.exp(-HANDOFF_RATE * FRAME_DT);
    runReconciled(state, player, reconciled({ x: 9, y: 0, z: 0 }));
    expect(state.offset.x).toBeCloseTo(1 * decay, 10);
    expect(state.position.x).toBeCloseTo(9 + 1 * decay, 10);
    expect(state.active).toBe(true);
    expect(state.ready).toBe(true);

    // 3. Next frame: no re-capture (prediction is already active), the residual
    //    offset just decays again toward zero.
    runReconciled(state, player, reconciled({ x: 8, y: 0, z: 0 }));
    expect(state.offset.x).toBeCloseTo(decay * decay, 10);
    expect(state.position.x).toBeCloseTo(8 + decay * decay, 10);

    // 4. Prediction drops out for a frame: the fallback path captures the gap
    //    and starts a bounded handoff, while the active flag drops so a later
    //    re-entry captures a fresh offset.
    const handedOver = state.position.x;
    runReconciled(state, player, null);
    expect(state.active).toBe(false);
    expect(state.position.x).toBeCloseTo(handedOver + MAX_SELF_REWIND_YD_PER_SEC * FRAME_DT, 10);

    // 5. A new character invalidates the whole carry-over.
    expect(noteSelfIdentity(state, 2)).toBe(true);
    expect(state.ready).toBe(false);
    expect(state.offset).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('bounds and smoothly decays a 1.4 yard prediction lead when the gate closes', () => {
    const state = createSelfRenderPositionState();
    const player = playerAt({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 });
    updateSelfRenderPosition(
      state,
      player,
      1,
      FRAME_DT,
      0.2,
      reconciled({ x: 1.4, y: 0, z: 0 }),
      false,
    );

    let previous = state.position.x;
    for (let frameIndex = 0; frameIndex < 20; frameIndex++) {
      updateSelfRenderPosition(state, player, 1, FRAME_DT, 0.2, null, false);
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
      1,
      FRAME_DT,
      0.2,
      reconciled({ x: 1.4, y: 0, z: 0 }),
      false,
    );
    updateSelfRenderPosition(
      state,
      playerAt({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }),
      1,
      FRAME_DT,
      0.2,
      null,
      false,
    );

    const previous = state.position.x;
    const retreatedBase = playerAt({ x: -0.02, y: 0, z: 0 }, { x: -0.02, y: 0, z: 0 });
    updateSelfRenderPosition(state, retreatedBase, 1, FRAME_DT, 0.2, null, false);

    expect(previous - state.position.x).toBeCloseTo(MAX_SELF_REWIND_YD_PER_SEC * FRAME_DT, 12);

    for (let frameIndex = 0; frameIndex < 100; frameIndex++) {
      updateSelfRenderPosition(state, retreatedBase, 1, FRAME_DT, 0.2, null, false);
    }
    expect(state.offset.x).toBeCloseTo(0, 10);
    expect(state.position.x).toBeCloseTo(-0.02, 10);
  });

  it('captures no offset when the prediction is the first to place the body', () => {
    const state = createSelfRenderPositionState();
    runReconciled(
      state,
      playerAt({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }),
      reconciled({ x: 5, y: 1, z: 2 }),
    );
    expect(state.offset).toEqual({ x: 0, y: 0, z: 0 });
    expect(state.position).toEqual({ x: 5, y: 1, z: 2 });
  });

  it('uses the shared handoff offset for a reconciled residual', () => {
    const state = createSelfRenderPositionState();
    const player = playerAt({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 });
    const decay = Math.exp(-HANDOFF_RATE * FRAME_DT);
    updateSelfRenderPosition(
      state,
      player,
      1,
      FRAME_DT,
      0,
      reconciled({ x: 4, y: 2, z: 1 }, { x: 1, y: -1, z: 0.5 }),
      false,
    );

    expect(state.position.x).toBeCloseTo(4 + decay, 10);
    expect(state.position.y).toBeCloseTo(2 - decay, 10);
    expect(state.position.z).toBeCloseTo(1 + 0.5 * decay, 10);
  });

  it('clears the handoff offset outright on an authoritative discontinuity', () => {
    const state = createSelfRenderPositionState();
    const player = playerAt({ x: 10, y: 0, z: 0 }, { x: 10, y: 0, z: 0 });
    runReconciled(state, player, null);
    runReconciled(state, player, reconciled({ x: 9, y: 0, z: 0 }), true);
    expect(state.offset).toEqual({ x: 0, y: 0, z: 0 });
    expect(state.position.x).toBe(9);
  });

  it('carries the offset on all three axes', () => {
    const state = createSelfRenderPositionState();
    state.ready = true;
    state.position.x = 1;
    state.position.y = 2;
    state.position.z = 3;
    const decay = Math.exp(-HANDOFF_RATE * FRAME_DT);
    runReconciled(
      state,
      playerAt({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }),
      reconciled({ x: 0, y: 0, z: 0 }),
    );
    expect(state.position.x).toBeCloseTo(1 * decay, 10);
    expect(state.position.y).toBeCloseTo(2 * decay, 10);
    expect(state.position.z).toBeCloseTo(3 * decay, 10);
  });
});
