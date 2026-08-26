// Three-facing construction of the world-entry compile units. The renderer
// owns timing/admission; this module owns root collection, ordering,
// program-content dedupe and the optional link TAIL for one fresh snapshot of
// scene + staged groups.

import type * as THREE from 'three';
import { GPU_WORK_PRIORITY } from './background_gpu_queue';
import type { CompileGateResult, CompileGateScheduler, PieceDeadline } from './compile_gate';
import type { PieceSettle } from './compile_gate_pieces';
import type { MaterialPropertiesLike } from './linked_program_touch';
import { type LinkedProgramTouchQueue, runWorldGateTouchLane } from './linked_program_touch_lane';
import { materialProgramSignature, prewarmProgramContentKeys } from './prewarm_policy';
import {
  buildPrewarmCompileUnits,
  compileRootDistanceSq,
  orderRootsByDistanceSq,
  type PrewarmResumeUnit,
} from './prewarm_resume';
import { pieceProgramSettle } from './program_variant_settle';

export interface InitialSceneCompileDedupe {
  seen: Set<THREE.Object3D>;
  seenKeys: Set<unknown>;
}

export interface InitialSceneCompileUnitOptions {
  scene: THREE.Scene;
  stagedGroups: readonly (readonly [string, THREE.Group | null])[];
  includeGroup: (groupId: string) => boolean;
  playerX: number;
  playerZ: number;
  batchSize: number;
  sharedDedupe: InitialSceneCompileDedupe;
  compileColor: (root: THREE.Object3D) => Promise<unknown>;
  compileShadow: (root: THREE.Object3D) => Promise<unknown>;
  onCompiledRoot: () => void;
  /** The link tail, OPT-IN and off by default: without it the lane keeps its
   *  colour-then-shadow shape and every program it links pays the driver's
   *  uniform-table round trip at its first live draw (see the tail below). */
  tail?: InitialSceneCompileTail;
}

/**
 * The arms the live entity gates (renderer.ts compileGate) and the
 * streamed-decor reveal host (reveal_compile_host.ts) already run AFTER their
 * colour and shadow compiles, offered to the world-entry lane as an opt-in.
 *
 * Why the lane needs them. Its units stopped at the shadow arm and no prewarm
 * draw follows them, so a boot-linked program's uniform and attribute tables
 * were still unfetched when the reveal lifted: every one of them paid the
 * driver's reflection round trip at its FIRST LIVE DRAW instead, seen as a long
 * ACTIVE_UNIFORMS query (40 to 390 ms per root on the Intel iGPU, measured on
 * streamed decor before the reveal host got the same tail). The settle proves
 * the program variants compileAsync never polled, and the touch pays their
 * round trip under the loading cover, one budgeted queue unit at a time.
 */
export interface InitialSceneCompileTail {
  /** The piece settle (program_variant_settle.ts pieceProgramSettle): poll
   *  every program variant the root's materials carry, the shadow arm's depth
   *  twins included, until each answers ready or the deadline below fires.
   *  What makes the touch warm every variant instead of the one slot
   *  compileAsync happened to poll. */
  settle: PieceSettle;
  /** The touch tail (linked_program_touch_lane.ts runWorldGateTouchLane): one
   *  budgeted queue unit per program the settle PROVED, its tables fetched off
   *  the live path. The renderer's own hook signature, priority included, so
   *  all three lanes are handed the identical binding. */
  touch: (root: THREE.Object3D, priority: number, gate: CompileGateResult) => Promise<unknown>;
  /** The bound the settle's poll ends on, armed per root. This lane has no
   *  gate to inherit a PieceDeadline from, so the tail arms one itself: a link
   *  that never settles must not hold its unit open, and the lane's own
   *  deadline rule only decides what is SUBMITTED. */
  timeoutMs: number;
  /** Injectable for tests; production uses real timers. */
  scheduler?: CompileGateScheduler;
}

const defaultTailScheduler: CompileGateScheduler = {
  setTimeout: (cb, ms) => setTimeout(cb, ms) as unknown as number,
  clearTimeout: (id) => clearTimeout(id),
};

/** The settle poll's bound for one boot root: the same 1500 ms a live gate
 *  piece arms for its own settle (renderer.ts VIEW_COMPILE_GATE_MAX_MS). A
 *  driver link is never cancellable, so this ends only the POLL; its job is to
 *  stop a unit hanging on a driver that stopped answering, never to pace
 *  anything, which is why it is one bound and not a tuned schedule. */
export const ENTRY_COMPILE_TAIL_SETTLE_MAX_MS = 1500;

/**
 * The production tail, bound to one renderer: the gates' own settle over the
 * root's program variants (its shadow depth twins included) and the gates' own
 * per-program touch lane on the background GPU queue. The renderer hands over
 * the three things those two need and nothing else, so the boot lane runs the
 * identical arms the live gates and the reveal host run.
 */
export function entryCompileTail(
  webgl: { properties: MaterialPropertiesLike },
  depthMaterials: ReadonlyMap<string, THREE.MeshDepthMaterial>,
  queue: LinkedProgramTouchQueue,
): InitialSceneCompileTail {
  const { properties } = webgl;
  return {
    settle: pieceProgramSettle(properties, depthMaterials),
    touch: (root, priority, gate) => runWorldGateTouchLane(queue, properties, root, priority, gate),
    timeoutMs: ENTRY_COMPILE_TAIL_SETTLE_MAX_MS,
  };
}

/**
 * One root's tail: the settle under a freshly armed deadline, then the touch
 * over what that settle proved. Fail-soft and silent on purpose. The colour and
 * shadow arms have already landed by here and the tail is pure warm-up, so a
 * throw must never demote a unit whose programs linked (its lifecycle record
 * would read `failed` and the admission would keep counting settled work as
 * debt); and a context on its way out rejects every in-flight tail at once, so
 * a log per root would be the noise, not the signal. The touch's own
 * `touch-unproven` event is where a tail that warmed nothing leaves evidence.
 */
export async function runInitialSceneCompileTail(
  tail: InitialSceneCompileTail,
  root: THREE.Object3D,
): Promise<void> {
  const scheduler = tail.scheduler ?? defaultTailScheduler;
  let fired = false;
  const deadline: PieceDeadline = {
    get fired() {
      return fired;
    },
  };
  const guard = scheduler.setTimeout(() => {
    fired = true;
  }, tail.timeoutMs);
  try {
    await tail.settle(root, deadline);
    // BOOT_DEBT names the lane the tail belongs to; the pieces themselves ride
    // at TAIL_PIECE either way (linkedProgramTouchPriority), which is the one
    // sub-VISIBLE_PREWARM class the arrival cover's admission rule admits, so
    // the round trip is paid under the curtain rather than after it.
    //
    // `failed` is a gate's arm and this lane has no gate. A settle that ended
    // on its deadline is exactly the unsettled case the touch's event key
    // names, and the walk skips the unproved programs either way.
    await tail.touch(root, GPU_WORK_PRIORITY.BOOT_DEBT, {
      failed: false,
      timedOut: deadline.fired,
    });
  } catch {
    // See the fail-soft contract above.
  } finally {
    scheduler.clearTimeout(guard);
  }
}

function compileRoots(roots: readonly THREE.Object3D[], visibleOnly: boolean): THREE.Object3D[] {
  const materialRoots: THREE.Object3D[] = [];
  const collect = (child: THREE.Object3D): void => {
    if ((child as THREE.Mesh).material) materialRoots.push(child);
  };
  for (const root of roots) {
    if (visibleOnly) root.traverseVisible(collect);
    else root.traverse(collect);
  }
  return materialRoots;
}

function programContentKeys(root: THREE.Object3D): unknown[] {
  const mesh = root as THREE.Mesh & {
    isSkinnedMesh?: boolean;
    isInstancedMesh?: boolean;
    isBatchedMesh?: boolean;
    instanceColor?: unknown;
  };
  const materials = Array.isArray(mesh.material)
    ? mesh.material
    : mesh.material
      ? [mesh.material]
      : [];
  const morphs = mesh.geometry?.morphAttributes;
  const colorAttribute = mesh.geometry?.attributes?.color as { itemSize?: number } | undefined;
  return prewarmProgramContentKeys(
    {
      isSkinnedMesh: mesh.isSkinnedMesh === true,
      isInstancedMesh: mesh.isInstancedMesh === true,
      hasInstanceColor: mesh.instanceColor != null,
      isBatchedMesh: mesh.isBatchedMesh === true,
      hasMorphPositions: morphs?.position !== undefined,
      morphTargetCount: morphs?.position?.length ?? 0,
      morphNormalCount: morphs?.normal?.length ?? 0,
      morphColorCount: morphs?.color?.length ?? 0,
      hasTangents: mesh.geometry?.attributes?.tangent !== undefined,
      hasNormals: mesh.geometry?.attributes?.normal !== undefined,
      vertexColorItemSize: colorAttribute?.itemSize ?? 0,
      castShadow: mesh.castShadow === true,
    },
    materials.map((entry) => materialProgramSignature(entry)),
  );
}

export function buildInitialSceneCompileUnits(
  options: InitialSceneCompileUnitOptions,
): PrewarmResumeUnit[] {
  // One compileAsync call still has a synchronous traversal prologue and its
  // linker cannot be cancelled. Material-bearing leaves keep each unit small
  // enough for the hard-deadline check between units to remain meaningful.
  const stagedRoots = new Set<THREE.Object3D>(
    options.stagedGroups.flatMap(([, group]) => (group ? [group] : [])),
  );
  return buildPrewarmCompileUnits(
    [
      ...(options.includeGroup('scene')
        ? [
            {
              id: 'scene',
              // Near-first: the resume lane drains these in order, and the
              // debt the camera can reach first must be the debt paid first
              // (hitch-hunt P3a; the S10 632-681 ms submit stalls were reveals
              // winning the race against their own compile). Anchor on the
              // PLAYER: the camera is still at its constructor default during
              // early submission.
              roots: orderRootsByDistanceSq(
                compileRoots(
                  options.scene.children.filter((root) => !stagedRoots.has(root)),
                  true,
                ),
                (root) => compileRootDistanceSq(root, options.playerX, options.playerZ),
              ),
            },
          ]
        : []),
      ...options.stagedGroups.flatMap(([id, group]) =>
        group && options.includeGroup(id)
          ? [{ id, roots: compileRoots(group.children, false) }]
          : [],
      ),
    ],
    async (root) => {
      await options.compileColor(root);
      await options.compileShadow(root);
      // Counted where it always was: the root's PROGRAMS are linked here, and
      // the tail below only warms what they left cold.
      options.onCompiledRoot();
      if (options.tail) await runInitialSceneCompileTail(options.tail, root);
    },
    {
      // NOT batched into one compileAsync call per unit: an A/B measured no
      // gain (11.5 s vs 11.9 s on a cold full entry) because the remaining
      // time is the driver's parallel link work, not the prologue walk.
      // Program-content keys collapse leaves only when material signatures
      // and mesh-shape bits produce the same PROGRAM. Distinct GLB material
      // UUIDs by the hundred share programs; UUID dedupe kept 2,725 roots for
      // about 500 programs and paid roughly 5,450 prologues (12.4 s). An
      // imperfect signature is fail-soft: first draw links any residue.
      dedupeKeys: programContentKeys,
      sharedDedupe: options.sharedDedupe,
      batchSize: options.batchSize,
    },
  );
}
