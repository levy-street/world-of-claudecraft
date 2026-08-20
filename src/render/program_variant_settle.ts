// A compile gate piece's variant settle: after the piece's compileAsync
// resolves, poll EVERY program variant its materials carry until each answers
// ready or the piece's deadline fires, and record the ready ones for the touch
// tail. The rationale (compileAsync polls one slot per material; shared
// materials get that slot repointed by concurrent gates; the sibling variants
// linked unpolled and paid their link in a live frame) is in
// program_variant_settle_core.ts, which owns the enumeration and the pass.
//
// This poll asks three's `isReady()`. That is the SAME completion query three's
// own compileAsync polls, on the same cadence, from a timer, never from the
// draw path or the synchronous touch walk (linked_program_readiness.ts forbids
// it there: a latched-false answer re-issues the query synchronously, and one
// of those blocked a live frame 5.6 s). Here every query is one a compileAsync
// over the same materials would have issued anyway, had it polled the variant.

import type * as THREE from 'three';
import type { CompileGateScheduler, PieceDeadline } from './compile_gate';
import type { PieceSettle } from './compile_gate_pieces';
import { isProgramKnownReady, markProgramReady } from './linked_program_readiness';
import type { LinkedProgramLike, MaterialPropertiesLike } from './linked_program_touch';
import { prewarmDepthMaterialsOf } from './prewarm_depth_material';
import {
  nextProgramVariantPollMs,
  type PollableProgramLike,
  PROGRAM_VARIANT_POLL_INTERVAL_MS,
  pendingProgramVariants,
  pollProgramVariants,
} from './program_variant_settle_core';

/** A linked program as the settle sees it: touchable AND pollable. */
export type SettleProgramLike = LinkedProgramLike & PollableProgramLike;

interface MaterialProgramsLike {
  programs?: Map<string, SettleProgramLike>;
}

/** The scheduler the poll runs on: the gate's timer pair plus a clock for the
 *  pass cost that spaces the next pass (three's own backoff rule). */
export interface ProgramVariantSettleScheduler extends CompileGateScheduler {
  now(): number;
}

const defaultScheduler: ProgramVariantSettleScheduler = {
  setTimeout: (cb, ms) => setTimeout(cb, ms) as unknown as number,
  clearTimeout: (id) => clearTimeout(id),
  now: () => performance.now(),
};

export interface ProgramVariantSettleResult {
  /** True when every variant of the piece's materials was proved ready. */
  settled: boolean;
  /** Programs this settle newly proved ready (and recorded). */
  ready: number;
  /** Programs still linking when the poll ended on the deadline. */
  pending: number;
}

/**
 * Poll every not-yet-proved program of `materials` until all answer ready or
 * `deadline` fires; each program that answers ready is recorded at once
 * (markProgramReady), so a deadline that ends the poll still leaves the ready
 * ones proved and the touch tail warms them. The first pass runs
 * synchronously (the piece's compile just resolved, so its programs are the
 * likeliest to be ready right now); every later pass rides the scheduler at
 * three's cadence.
 *
 * The first pass stays synchronous ON PURPOSE, and it is the one thing here
 * that is not free: it runs inside the queue's released tail, so its queries
 * are booked by no unit's syncMs (review of PR #3519). Deferring it by one
 * zero-delay hop was built and measured on the iGPU teleport leg and dropped:
 * the settle throughput fell far enough that 39 to 75 reveal keys escaped by
 * their watchdog with links still in flight, and the first drawn frame after
 * the loading screen lifted blocked 1.25 s behind them, against 0.25 s here
 * (tmp/dropped/0005-settle-first-poll-defer.patch carries the numbers). The
 * accounting gap is real and its fix is the other half: charge the tail to
 * the unit through a spend hook, not move the work off the stack.
 */
export function settleProgramVariants(
  properties: MaterialPropertiesLike,
  materials: Iterable<THREE.Material>,
  deadline: PieceDeadline,
  scheduler: ProgramVariantSettleScheduler = defaultScheduler,
): Promise<ProgramVariantSettleResult> {
  const sets: Array<Iterable<SettleProgramLike> | undefined> = [];
  for (const material of materials) {
    sets.push((properties.get(material) as MaterialProgramsLike | undefined)?.programs?.values());
  }
  let pending = pendingProgramVariants(sets, isProgramKnownReady);
  let ready = 0;
  let intervalMs = PROGRAM_VARIANT_POLL_INTERVAL_MS;
  return new Promise((resolve, reject) => {
    const pass = (): void => {
      // Fail-soft like the gate: a query that throws (a context on its way
      // out) fails the piece instead of leaving it, and its gate, unsettled.
      try {
        const start = scheduler.now();
        const polled = pollProgramVariants(pending);
        for (const program of polled.ready) if (markProgramReady(program)) ready++;
        pending = polled.pending;
        if (pending.length === 0) {
          resolve({ settled: true, ready, pending: 0 });
          return;
        }
        if (deadline.fired) {
          resolve({ settled: false, ready, pending: pending.length });
          return;
        }
        intervalMs = nextProgramVariantPollMs(scheduler.now() - start, intervalMs);
        scheduler.setTimeout(pass, intervalMs);
      } catch (error) {
        reject(error);
      }
    };
    pass();
  });
}

/**
 * The materials whose programs one gate piece linked: the representative
 * node's own tuple, plus the depth twins the shadow arm swapped onto it
 * (prewarm_depth_material.ts keeps them in `depthMaterials`; their programs
 * live under the twins' own properties, not the node's).
 */
export function pieceMaterialsOf(
  node: THREE.Object3D,
  depthMaterials: ReadonlyMap<string, THREE.MeshDepthMaterial>,
): THREE.Material[] {
  const carrier = node as THREE.Object3D & { material?: THREE.Material | THREE.Material[] | null };
  const own = carrier.material;
  const materials: THREE.Material[] = [];
  for (const material of Array.isArray(own) ? own : own ? [own] : []) {
    if (!materials.includes(material)) materials.push(material);
  }
  for (const twin of prewarmDepthMaterialsOf(depthMaterials, node)) {
    if (!materials.includes(twin)) materials.push(twin);
  }
  return materials;
}

/** The settle arm a gate hands linkPieceWork, bound to one renderer's material
 *  properties and its shadow arm's depth-twin cache. */
export function pieceProgramSettle(
  properties: MaterialPropertiesLike,
  depthMaterials: ReadonlyMap<string, THREE.MeshDepthMaterial>,
  scheduler?: ProgramVariantSettleScheduler,
): PieceSettle {
  return (node, deadline) =>
    settleProgramVariants(properties, pieceMaterialsOf(node, depthMaterials), deadline, scheduler);
}
