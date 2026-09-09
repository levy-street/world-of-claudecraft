// How the post-entry resume lane runs one of its units on the GPU queue:
// the debt/cosmetic priority, the held or released tail, the per-root pieces
// of a debt batch, the compile lifecycle transitions, and now the shader
// warm worker ahead of the unit's links (shader_warm_lane.ts). Lifted out
// of the renderer's resume scheduling (renderer.ts, the resumeUnits
// callback), which keeps the bindings and nothing else.
//
// Priority and tail (hitch-hunt P1): link/upload debt runs at BOOT_DEBT so
// the cosmetic BACKGROUND warmers (the preview lane) cannot starve it
// (minutes of unpaid link debt behind the previews). A debt BATCH (no
// pieces) keeps its tail HELD: released, its 16 to 32 links piled into the
// driver at once (sub-1-fps for a minute with a dropped manifest). A debt
// ROOT piece releases its tail: ONE link under the released-tail cap,
// whereas a held root blocked the queue head for its whole link wait behind
// the driver's queue (batch 18: 4.0 s on the iGPU, reveals starved). The
// cosmetic resume keeps the released tail (held, a 16-root unit blocked live
// compile gates for seconds: travel hitches).
//
// The warm comes BEFORE the unit's links, every root asked at once so the
// worker paces the set, and BEFORE the compile lifecycle window, so a
// record's submitted-to-settled span stays link time: the hold is worker
// time, attributed by the warm readout, never by the compile record.

import type * as THREE from 'three';
import { GPU_WORK_PRIORITY } from './background_gpu_queue';
import type { CompileArmHost } from './compile_arms';
import type { PrewarmCompileLifecycle } from './prewarm_compile_lifecycle';
import { prewarmResumeIsDebt } from './prewarm_policy';
import {
  type PrewarmResumeEntry,
  type PrewarmResumeUnit,
  type PrewarmResumeUnitPiece,
  runPrewarmCompileResumeUnit,
  runPrewarmPiecesSerially,
} from './prewarm_resume';
import { warmRootsBeforeLink } from './shader_warm_lane';

export interface ResumeUnitQueue {
  run<T>(
    work: () => T | Promise<T>,
    priority: number,
    label: string,
    options?: { releaseTail?: boolean },
  ): Promise<T>;
}

export interface ResumeUnitRunnerDeps {
  queue: ResumeUnitQueue;
  ledger: { noteStart(entryId: string): void };
  lifecycle: PrewarmCompileLifecycle;
  /** The compile arms, for the warm ahead of each root's link; null skips
   *  the warm (a renderer without the arms bound). */
  arms: CompileArmHost | null;
}

/** The label of a unit's warm-assembly units: a kind of its own, so the
 *  budget prices the dry assembly apart from the link it precedes. */
export function resumeWarmLabel(unitId: string): string {
  return `resume-warm:${unitId}`;
}

/** The roots a unit links: its pieces' when it runs as pieces, else its own. */
function resumeUnitRoots(
  unit: PrewarmResumeUnit,
  pieces: readonly PrewarmResumeUnitPiece[] | undefined,
): THREE.Object3D[] {
  if (pieces) {
    return pieces
      .map((piece) => piece.root as THREE.Object3D | undefined)
      .filter((root): root is THREE.Object3D => root !== undefined);
  }
  return (unit.roots as readonly THREE.Object3D[] | undefined)?.slice() ?? [];
}

/** Run one resume unit as the lane's `runUnit` callback would. */
export async function runResumeUnit(
  unit: PrewarmResumeUnit,
  entry: PrewarmResumeEntry,
  deps: ResumeUnitRunnerDeps,
): Promise<void> {
  const debt = prewarmResumeIsDebt(entry.id);
  deps.ledger.noteStart(entry.id);
  const priority = debt ? GPU_WORK_PRIORITY.BOOT_DEBT : GPU_WORK_PRIORITY.BOOT_RESUME;
  const pieces = debt ? unit.pieces : undefined;
  const roots = resumeUnitRoots(unit, pieces);
  if (deps.arms && roots.length > 0) {
    await warmRootsBeforeLink(deps.arms, roots, {
      priority,
      label: resumeWarmLabel(unit.id),
      run: (work, warmPriority, label) => deps.queue.run(work, warmPriority, label),
    });
  }
  const link = async (): Promise<unknown> => {
    if (pieces) {
      return runPrewarmPiecesSerially(pieces, (piece) =>
        deps.queue.run(piece.run, priority, piece.id, { releaseTail: true }),
      );
    }
    return deps.queue.run(unit.run, priority, unit.id, { releaseTail: !debt });
  };
  if (entry.id.startsWith('programs.compile')) {
    await runPrewarmCompileResumeUnit(unit, deps.lifecycle, 'programs.compile-resume', link);
    return;
  }
  await link();
}
