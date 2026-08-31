// The compile host every streamed-decor reveal gate shares (reveal_gate.ts):
// one root in, its programs linked, its cold textures uploaded and its
// uniform tables warmed out. Lifted out of the renderer constructor so the
// reveal lane's policy is nameable and testable on its own; the renderer keeps
// only the bindings below.
//
// Ordinary reveal compiles ride BELOW the live entity gates (VISIBLE_PREWARM,
// not LIVE_VIEW): a teleport can queue dozens of far cells at once, and
// cosmetic scenery must never delay an actionable mob or player reveal.
//
// An IMMINENT key is the exception, and only about ORDER. It is the decor the
// camera already stands among at an arrival, which nothing else in the scene
// can stand in for and which stays hidden until its own compile lands, so its
// link, upload and touch pieces ride at LIVE_VIEW: still under the actionable
// gates (mobs and players keep their floor), still above every other reveal
// and every background warmer. It buys queue position, never an early draw.
//
// The tail matters as much as the link. Streamed decor used to pay the
// uniform-table round trip on its reveal DRAW (40 to 390 ms on the Intel
// iGPU) because the reveal host stopped at the shadow arm; the live gates'
// touch tail applies here too, per program, under the same budget.

import type * as THREE from 'three';
import { GPU_WORK_PRIORITY } from './background_gpu_queue';
import type { CompileGatePiece, CompileGateResult } from './compile_gate';
import { linkPiecesOf, linkPieceWork, type PieceSettle } from './compile_gate_pieces';
import { type RevealCompileHost, revealSoftDeadlineMs } from './reveal_gate';

/** The gpu-prep label prefix, and therefore the budget's cost KIND, of every
 *  reveal compile. One constant so the label and the cost lookup cannot
 *  drift apart (gpu_prep_budget_core gpuPrepKindOfLabel). */
export const REVEAL_GATE_PREP_KIND = 'reveal-gate';

export interface RevealCompileHostDeps {
  /** Run one root's link as a gate of queue units, one per material group
   *  of the root (compile_gate_pieces.ts), each under its own deadline. Its
   *  result says whether the whole link SETTLED, which is what the touch
   *  tail's readiness rests on. */
  gate(
    pieces: CompileGatePiece[],
    options: { priority: number; label: string },
  ): Promise<CompileGateResult>;
  compileColor(target: THREE.Object3D): Promise<unknown>;
  compileShadow(target: THREE.Object3D): Promise<unknown>;
  /** The piece's settle over every program variant its materials carry, the
   *  depth twins included, under the piece's own deadline
   *  (program_variant_settle.ts): what makes a settled gate mean "every
   *  variant ready", not "the one slot compileAsync polled". */
  settle: PieceSettle;
  /** Every cold texture under the root, one budgeted queue unit each. Between
   *  the link and the touch: the touch's driver round trip flushes behind
   *  everything already queued, so uploads paid after it are measured by it. */
  upload(target: THREE.Object3D, priority: number): Promise<unknown>;
  /** The touch tail. It carries the gate's own result: a timed-out or failed
   *  link proved nothing, so its tail may warm only what an earlier settle
   *  already proved ready (linked_program_readiness.ts). */
  touch(target: THREE.Object3D, priority: number, gate: CompileGateResult): Promise<unknown>;
  /** The frame budget's learned cost of ONE reveal compile unit (a piece,
   *  since the gate submits one unit per material group), which becomes the
   *  key's soft deadline once multiplied by the number of pieces its roots
   *  submit. What it learns is the compileAsync PROLOGUE (1 to 3 ms), not the
   *  driver's link wall time, so the deadline sits at its
   *  REVEAL_SOFT_DEADLINE_MIN_MS floor in practice; a learned wall time is
   *  future work. Harmless either way: the soft deadline is telemetry and
   *  never reveals anything. */
  predictRevealMs(): number;
  /** Read lazily: the renderer creates these gates before entry prewarm owns
   * the first-paint promise. Direct graphics rebuilds return null. */
  startAfterInitialPaint?: () => Promise<void> | null | undefined;
}

export function createRevealCompileHost(deps: RevealCompileHostDeps): RevealCompileHost {
  // How many pieces each root's compile submitted, so the key's expected
  // cost reads what was submitted instead of walking the roots a second time
  // in the deciding frame.
  const submittedPieces = new WeakMap<object, number>();
  return {
    startAfterInitialPaint: deps.startAfterInitialPaint,
    compile(root: object, imminent: boolean, namedPriority?: number): Promise<unknown> {
      const target = root as THREE.Object3D;
      // One caller names its priority outright: the occluder-fade gate's
      // edge-frame consult (the camera is INSIDE the structure now, and the
      // player's own body is what the opaque hold hides) rides the actionable
      // floor, like the character-effect swap it mirrors.
      const priority =
        namedPriority ??
        (imminent ? GPU_WORK_PRIORITY.LIVE_VIEW : GPU_WORK_PRIORITY.VISIBLE_PREWARM);
      const pieces = linkPieceWork(target, deps.compileColor, deps.compileShadow, deps.settle);
      submittedPieces.set(target, pieces.length);
      const linked = deps.gate(pieces, {
        priority,
        label: `${REVEAL_GATE_PREP_KIND}:${target.name || target.type}`,
      });
      return linked
        .then((gate) => deps.upload(target, priority).then(() => gate))
        .then((gate) => deps.touch(target, priority, gate));
    },
    expectedMs(_key: string, _rootCount: number, roots: readonly object[]): number {
      // The budget learns per PIECE (one queue unit per material group), so
      // the key's expected cost is the piece count of its roots, not the root
      // count: a town kit root is many pieces, a batch root one.
      let pieces = 0;
      for (const root of roots) {
        pieces += submittedPieces.get(root) ?? linkPiecesOf(root as THREE.Object3D).length;
      }
      return revealSoftDeadlineMs(deps.predictRevealMs(), pieces);
    },
  };
}
