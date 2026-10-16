// Thin renderer consumer of far_lod_latch_core.ts: keeps each character view's
// latch memory (keyed weakly by the view record, so a dropped view takes its
// memory with it) and derives the per-frame moving holdout the core needs from
// the entity's interpolation state, exactly as the renderer used to inline it.

import { type CharacterLodBands, movingHoldoutActive } from './crowd_lod';
import {
  createFarLodLatchState,
  type FarLodLatchState,
  latchStaticFarMesh,
} from './far_lod_latch_core';
import { POS_EXTRAPOLATION_CAP } from './net_interp_core';

const latches = new WeakMap<object, FarLodLatchState>();

/** The slice of an entity the holdout reads. */
export interface FarLodEntity {
  pos: { x: number; z: number };
  prevPos: { x: number; z: number };
  netUpdatedAt?: number;
  netInterval?: number;
  vx: number;
  vz: number;
}

/**
 * The view's far-mesh state for this frame. `view.isFar` is last frame's;
 * `alpha` is the entity's interpolation alpha; `nowSec` the renderer clock.
 */
export function latchFarLod(
  view: { isFar: boolean },
  e: FarLodEntity,
  alpha: number,
  isSelf: boolean,
  distSq: number,
  bands: CharacterLodBands,
  actionable: boolean,
  nowSec: number,
): boolean {
  const remote = !isSelf && e.netUpdatedAt !== undefined && e.netInterval !== undefined;
  const moving = movingHoldoutActive(
    e.pos,
    e.prevPos,
    alpha,
    remote ? POS_EXTRAPOLATION_CAP : 1,
    e.vx !== 0 || e.vz !== 0,
  );
  let state = latches.get(view);
  if (!state) {
    state = createFarLodLatchState();
    latches.set(view, state);
  }
  return latchStaticFarMesh(state, view.isFar, distSq, bands, actionable, moving, nowSec);
}
