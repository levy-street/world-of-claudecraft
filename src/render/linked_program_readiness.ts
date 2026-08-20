// Which linked programs the touch walk is allowed to warm, answered WITHOUT
// asking the driver.
//
// three caches `WebGLProgram.programReady` only when a COMPLETION_STATUS_KHR
// poll returns true: a poll that came back false stays latched false for the
// rest of the session, so every later `isReady()` re-issues the query. That
// query is a synchronous round trip that waits behind everything the GPU
// process has queued at that instant. In production (2026-08-18, RTX 3090) one
// of them blocked the main thread 5558 ms on a program that had been linked and
// drawing for a minute (a `course_arch.glb` variant whose only poll ran under
// the boot cover), with eighteen reveal-gate units and the character sheet
// parked behind it; fourteen programs showed the same pattern in five minutes.
// The walk runs on the main thread outside any budgeted unit, so nothing can
// absorb it, and the GPU-work rule (src/render/CLAUDE.md) forbids exactly that.
//
// Readiness therefore comes from what this code already knows. A compileAsync
// that SETTLED over a target proved the program it polled linked (three's own
// compileAsync drops a material from its pending set once its `currentProgram`
// reports ready), so the gate's tail records those programs here and the walk
// reads the record instead of the driver. The gate's variant settle
// (program_variant_settle.ts) records the OTHER variants of a piece's
// materials one by one, as its own asynchronous poll proves each ready.
import type * as THREE from 'three';
import type { LinkedProgramLike, MaterialPropertiesLike } from './linked_program_touch';

/** The slice of a material's three properties this module reads: the variant
 *  the last program acquisition for that material resolved to. */
interface MaterialCurrentProgramLike {
  currentProgram?: LinkedProgramLike | null;
}

// Weak so a program dropped with its material (a rebuilt view, a released
// context) leaves with it; nothing here keeps a program alive.
const knownReady = new WeakSet<LinkedProgramLike>();

/**
 * Record ONE program as linked, and return whether it was newly recorded.
 *
 * Call it ONLY with a program the driver actually reported ready (a
 * compileAsync that settled over it, or a poll of its own completion query
 * that answered true): that answer is the whole proof.
 */
export function markProgramReady(program: LinkedProgramLike): boolean {
  if (knownReady.has(program)) return false;
  knownReady.add(program);
  return true;
}

/**
 * Record every material's current program under `target` as linked, and return
 * how many were newly recorded.
 *
 * Call it ONLY where a compile over `target` actually settled: that settle is
 * the whole proof. On a timed-out or failed gate the driver never told us
 * anything, and marking there would claim a link nobody saw.
 */
export function markProgramsReadyUnder(
  properties: MaterialPropertiesLike,
  target: THREE.Object3D,
): number {
  let marked = 0;
  target.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) {
      if (!material) continue;
      const current = (properties.get(material) as MaterialCurrentProgramLike | undefined)
        ?.currentProgram;
      if (current && markProgramReady(current)) marked++;
    }
  });
  return marked;
}

/** Whether a settle has already proved this program linked. Unknown means
 *  "not proved", never "not linked": the walk simply leaves it alone. */
export function isProgramKnownReady(program: LinkedProgramLike): boolean {
  return knownReady.has(program);
}
