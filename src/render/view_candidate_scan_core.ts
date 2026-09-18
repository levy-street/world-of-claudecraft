// The missing-view candidate scan: which world entities near the player have
// no renderer view yet, ranked for creation. The walk itself is the largest
// leaf in the renderer's own per-frame code on a weak CPU (every entity of the
// world, every frame, for a list that changes only when something joins,
// leaves, or crosses the draw range), so this module also owns WHEN the walk
// runs: at once when the roster or the view set changed (a new entity gets its
// candidate on the very next frame, never later: the graphics-fairness rule),
// when the player or their target changed, when the range moved, and otherwise
// on a short cadence that covers entities walking across the draw-range edge.
// Between scans the renderer keeps consuming the last ranked list.
//
// Node-only (RENDER_PURE_CORES): no three.js, no DOM, no randomness.

import type { Entity, QuestProgress } from '../sim/types';
import {
  entityViewCandidatePriority,
  entityViewDistanceSq,
  entityViewIsAdmitted,
  entityViewShouldDrop,
  isDistanceCullExemptObject,
} from './entity_view_policy_core';
import type { QuestObjectGate } from './quest_object_gate_core';
import {
  finishViewCandidates,
  type ViewCandidate,
  writeViewCandidate,
} from './view_candidate_pool_core';

/** Frames between two scans when nothing else asked for one: the only case a
 *  scan then serves is an entity crossing the draw-range edge, which is far
 *  outside anything a player reacts to, so a few frames of pop-in latency at
 *  the edge is invisible while the walk itself is not. */
export const VIEW_CANDIDATE_RESCAN_FRAMES = 4;

/** A center that jumped farther than this since the last scan (a teleport, a
 *  rift or dungeon entry) rescans at once: the last ranked list describes the
 *  old spot and would spend the frame's creation budget on entities the drop
 *  pass then retires. A running player covers well under a yard per frame. */
export const VIEW_CANDIDATE_RESCAN_MOVE_YD = 8;

export interface ViewCandidateScanCenter {
  id: number;
  targetId: number | null;
  pos: { x: number; z: number };
}

export interface ViewCandidateScanState {
  rosterVersion: number;
  viewCount: number;
  centerId: number;
  targetId: number | null;
  centerX: number;
  centerZ: number;
  rangeSq: number;
  /** Frames since the last scan; -1 before the first. */
  framesSinceScan: number;
}

export function createViewCandidateScanState(): ViewCandidateScanState {
  return {
    rosterVersion: -1,
    viewCount: -1,
    centerId: -1,
    targetId: null,
    centerX: Number.NaN,
    centerZ: Number.NaN,
    rangeSq: -1,
    framesSinceScan: -1,
  };
}

/** Whether this frame walks the roster; records the frame either way. A
 *  `force`d frame always walks and records its keys like any other scan. */
export function viewCandidateScanDue(
  state: ViewCandidateScanState,
  rosterVersion: number,
  viewCount: number,
  center: ViewCandidateScanCenter,
  rangeSq: number,
  force = false,
  cadenceFrames: number = VIEW_CANDIDATE_RESCAN_FRAMES,
): boolean {
  const dx = center.pos.x - state.centerX;
  const dz = center.pos.z - state.centerZ;
  const due =
    force ||
    state.framesSinceScan < 0 ||
    state.framesSinceScan + 1 >= cadenceFrames ||
    state.rosterVersion !== rosterVersion ||
    state.viewCount !== viewCount ||
    state.centerId !== center.id ||
    state.targetId !== center.targetId ||
    state.rangeSq !== rangeSq ||
    !(dx * dx + dz * dz <= VIEW_CANDIDATE_RESCAN_MOVE_YD * VIEW_CANDIDATE_RESCAN_MOVE_YD);
  if (!due) {
    state.framesSinceScan++;
    return false;
  }
  state.rosterVersion = rosterVersion;
  state.viewCount = viewCount;
  state.centerId = center.id;
  state.targetId = center.targetId;
  state.centerX = center.pos.x;
  state.centerZ = center.pos.z;
  state.rangeSq = rangeSq;
  state.framesSinceScan = 0;
  return true;
}

export interface ViewCandidateScanInput {
  entities: ReadonlyMap<number, Entity>;
  /** Entity ids that already have a view. */
  views: { has(id: number): boolean };
  questLog: Map<string, QuestProgress>;
  questObjectHidden: QuestObjectGate;
  center: Entity;
  rangeSq: number;
  /** Whether the player and their target ride the ranked list (the runtime
   *  frame creates those two ahead of it, so it leaves them out). */
  includeRequired: boolean;
}

/** Fills `active` (over the reusable `pool`) with every admitted, view-less
 *  entity inside `rangeSq` of the center, ranked; allocation-free once the
 *  pool has grown to the roster's size. */
export function collectMissingViewCandidatesInto(
  active: ViewCandidate[],
  pool: ViewCandidate[],
  input: ViewCandidateScanInput,
): void {
  const { center, questLog, questObjectHidden, rangeSq, views } = input;
  let count = 0;
  for (const e of input.entities.values()) {
    if (views.has(e.id)) continue;
    if (!entityViewIsAdmitted(e, questLog, questObjectHidden)) continue;
    const required = e.id === center.id || e.id === center.targetId;
    if (required && !input.includeRequired) continue;
    const d2 = entityViewDistanceSq(e, center);
    if (!required && d2 > rangeSq && !isDistanceCullExemptObject(e)) continue;
    writeViewCandidate(pool, active, count, e.id, d2, entityViewCandidatePriority(e, center, d2));
    count++;
  }
  finishViewCandidates(active, count);
}

/** The entity a ranked (or required) candidate still stands for when its
 *  view is about to be built, or null. The ranked list can be up to
 *  VIEW_CANDIDATE_RESCAN_FRAMES old, so the build re-asks the whole
 *  admission question: the entity is still in the roster, still view-less,
 *  and still admitted (a corpse that decayed or a quest object hidden since
 *  the scan would otherwise be built now and dropped a frame later). */
export function liveViewCandidate(
  id: number,
  world: { entities: ReadonlyMap<number, Entity>; questLog: Map<string, QuestProgress> },
  views: { has(id: number): boolean },
  questObjectHidden: QuestObjectGate,
): Entity | null {
  const e = world.entities.get(id);
  if (!e || views.has(id)) return null;
  return entityViewIsAdmitted(e, world.questLog, questObjectHidden) ? e : null;
}

export interface DoomedViewScanInput {
  entities: ReadonlyMap<number, Entity>;
  questLog: Map<string, QuestProgress>;
  questObjectHidden: QuestObjectGate;
  center: Entity;
  destroyRangeSq: number;
}

/** The drop half of the same policy: every view whose entity left, decayed,
 *  was retired by a quest turn-in or abandon, or moved past the destroy
 *  range, written into the caller's reusable `doomed` list. */
export function collectDoomedViewsInto(
  doomed: number[],
  viewIds: Iterable<number>,
  input: DoomedViewScanInput,
): void {
  doomed.length = 0;
  for (const id of viewIds) {
    const e = input.entities.get(id);
    if (
      entityViewShouldDrop(
        e,
        input.center,
        input.questLog,
        input.questObjectHidden,
        input.destroyRangeSq,
      )
    ) {
      doomed.push(id);
    }
  }
}
