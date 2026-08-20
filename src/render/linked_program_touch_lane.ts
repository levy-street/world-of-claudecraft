// The compile gate's touch tail, spread over the GPU work queue instead of
// landing in one burst.
//
// Why per program. Touching a linked program's uniform and attribute tables
// costs a driver round trip that waits behind everything the GPU process has
// queued (see linked_program_touch.ts for the measurements: 40 to 390 ms on the
// Intel iGPU for a whole far bake). As ONE unit the tail is unbudgetable: the
// queue can only decide to start it or not, and once started it runs to the
// end. As one unit PER PROGRAM the per-frame admission can let two through in a
// frame with headroom and none in a frame without, which is the whole point of
// pacing it.
//
// Sequential on purpose: the pieces are main-thread work, so overlapping them
// would only make one frame carry several round trips. The gate's own promise
// still settles after the last piece, so a gated reveal is no earlier than it
// was before.
import type * as THREE from 'three';
import { GPU_WORK_PRIORITY } from './background_gpu_queue';
import { recordGpuPrepEvent } from './gpu_prep_events';
import { isProgramKnownReady, markProgramsReadyUnder } from './linked_program_readiness';
import {
  collectLinkedPrograms,
  type LinkedProgramLike,
  type MaterialPropertiesLike,
  touchLinkedProgram,
} from './linked_program_touch';

/** The slice of the background GPU queue this lane needs. */
export interface LinkedProgramTouchQueue {
  run<T>(work: () => T | Promise<T>, priority?: number, label?: string): Promise<T>;
}

/** The label every touch piece carries. Its KIND (the part before the colon)
 *  is what the budget learns a cost for, so all pieces share one estimate. */
export const LINKED_PROGRAM_TOUCH_LABEL = 'touch:program';

/** The queue priority a gate's touch pieces ride at: an actionable gate keeps
 *  its own (the actionable floor); every other gate's pieces drop to
 *  TAIL_PIECE, below every link submission (see GPU_WORK_PRIORITY). */
export function linkedProgramTouchPriority(gatePriority: number): number {
  return gatePriority >= GPU_WORK_PRIORITY.ACTIONABLE_VIEW
    ? gatePriority
    : GPU_WORK_PRIORITY.TAIL_PIECE;
}

/** The PREVIEW context's own kind. Deliberately not the world label: the world
 *  touch kind has learned an EMA near zero over thousands of samples (its
 *  programs are warm by the time the tail runs), while a paperdoll program on
 *  a second context measures 15 to 17 ms per first-use query on the Intel
 *  iGPU. Sharing one estimate would let the budget admit a whole open's worth
 *  of preview pieces into one frame. */
export const PREVIEW_LINKED_PROGRAM_TOUCH_LABEL = 'touch-preview:program';

export interface LinkedProgramTouchLaneOptions {
  /** A caller on a SECOND context passes its own label so the budget prices it
   *  apart from the world tail; see the preview label above. */
  label?: string;
  /** Whether THIS caller proved the target's current programs linked, by
   *  awaiting a compile over them with no other proof arm (the preview
   *  context: its own scene, its own materials). True (the default) records
   *  each material's current program as linked before the walk. A host whose
   *  link pieces already prove every program one by one (the world gates,
   *  program_variant_settle) passes FALSE: the tail runs after the upload
   *  lane, and by then a SHARED material may carry a different program than
   *  the one its piece proved (another gate's variant still linking, or a
   *  released program relinked under the same key), which a walk mark would
   *  bless unproven and the touch would then block on (production
   *  2026-08-19: twenty touch pieces, 1160 ms, none proven by a poll). */
  settled?: boolean;
  /** Called with how many distinct programs under `target` the walk SKIPPED
   *  as unproven (deduplicated across meshes sharing a material), so a host
   *  can leave the evidence: those are exactly the programs a walk mark would
   *  have blessed. Called once per lane run, with 0 when nothing was skipped. */
  onUnproven?: (count: number) => void;
}

/**
 * Run one queue unit per linked program under `target`, in order, and resolve
 * with how many were touched. The programs are collected ONCE up front: the
 * walk is cheap, and re-walking between pieces would re-touch what earlier
 * pieces already warmed. `gatePriority` is the GATE's priority; the pieces
 * ride at `linkedProgramTouchPriority(gatePriority)`.
 *
 * Readiness comes from the settle, never from the driver: see
 * linked_program_readiness.ts for the 5.6 s live freeze one `isReady()` cost.
 */
export async function runLinkedProgramTouchLane(
  queue: LinkedProgramTouchQueue,
  properties: MaterialPropertiesLike,
  target: THREE.Object3D,
  gatePriority: number,
  options: LinkedProgramTouchLaneOptions = {},
): Promise<number> {
  const { label = LINKED_PROGRAM_TOUCH_LABEL, settled = true, onUnproven } = options;
  if (settled) markProgramsReadyUnder(properties, target);
  const unproven = new Set<LinkedProgramLike>();
  const programs = collectLinkedPrograms(properties, target, (program) => {
    const known = isProgramKnownReady(program);
    if (!known) unproven.add(program);
    return known;
  });
  onUnproven?.(unproven.size);
  const priority = linkedProgramTouchPriority(gatePriority);
  for (const program of programs) {
    await queue.run(() => touchLinkedProgram(program), priority, label);
  }
  return programs.length;
}

/** Key suffix of a gate whose link pieces did NOT all settle: unproven
 *  programs are expected there and must not read as the shared-material
 *  race the plain key names. */
export const TOUCH_UNPROVEN_UNSETTLED_SUFFIX = ':unsettled';

/**
 * The world gates' tail: the lane above with NO walk mark (the pieces' settle
 * arm, program_variant_settle, is the only proof), and the programs the walk
 * skips as unproven recorded as one `touch-unproven` event keyed by the gate
 * target's label (plus the unsettled suffix when the gate's pieces did not
 * all settle), `units` the count. Those are exactly the programs a walk mark
 * used to bless and the touch then blocked on: the tail runs after the upload
 * lane, and by then a SHARED material can carry another gate's variant still
 * linking or a released program relinked under the same key (production
 * 2026-08-19: twenty touch pieces, 1160 ms, none proven by a poll). The event
 * is write-only evidence, like every gpu_prep_events kind.
 */
export function runWorldGateTouchLane(
  queue: LinkedProgramTouchQueue,
  properties: MaterialPropertiesLike,
  target: THREE.Object3D,
  gatePriority: number,
  gate: { failed: boolean; timedOut: boolean },
): Promise<number> {
  return runLinkedProgramTouchLane(queue, properties, target, gatePriority, {
    settled: false,
    onUnproven: (count) => {
      if (count <= 0) return;
      const label = touchUnprovenLabel(target);
      const key =
        gate.failed || gate.timedOut ? `${label}${TOUCH_UNPROVEN_UNSETTLED_SUFFIX}` : label;
      recordGpuPrepEvent({ kind: 'touch-unproven', key, ageMs: 0, units: count });
    },
  });
}

/** The event key of a gate target: its name, else its render category (a live
 *  entity gate's group is never named, only categorised `entity:<kind>`, and
 *  every such gate collapsing to "Group" would leave the event unattributable),
 *  else its type. A bounded set of strings either way, never per instance. */
export function touchUnprovenLabel(target: {
  name: string;
  type: string;
  userData: { renderCategory?: unknown };
}): string {
  if (target.name) return target.name;
  const category = target.userData.renderCategory;
  return typeof category === 'string' && category ? category : target.type;
}
