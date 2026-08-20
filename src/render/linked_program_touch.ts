// The last synchronous step of a compile gate. A linked program's first
// setProgram still runs three's onFirstUse: an ACTIVE_UNIFORMS /
// ACTIVE_ATTRIBUTES round trip that waits for everything the GPU process has
// queued in front of it (the frame's uploads and draws, plus whatever link
// work a driver finishes lazily at first use). Measured on the composed far
// bakes at their reveal draw, AFTER COMPLETION_STATUS reported the link done:
// 20 to 160 ms on NVIDIA, 40 to 390 ms on the Intel iGPU. Touching the tables
// in the gate's tail, while nothing of the target's is queued, moves that cost
// off the reveal frame (NVIDIA: 0 to 20 ms once; iGPU: 40 to 100 ms per new
// program, still off the draw). Extracted from renderer.ts so the rule is
// testable with a stub property map (tests/linked_program_touch.test.ts).
import type * as THREE from 'three';

/** The slice of a three WebGLProgram this touch needs. Deliberately WITHOUT
 *  `isReady`: asking three costs a synchronous driver query whenever its
 *  cached answer is a latched false (see linked_program_readiness.ts), and
 *  this walk runs outside any budgeted unit. */
export interface LinkedProgramLike {
  getUniforms(): unknown;
  getAttributes(): unknown;
}

/** The slice of `WebGLRenderer.properties` this touch reads (three types the
 *  per-material map as `unknown`; `programs` is where WebGLRenderer.getProgram
 *  keeps every linked variant of a material, keyed by program cache key). */
export interface MaterialPropertiesLike {
  get(material: THREE.Material): unknown;
}

interface MaterialProgramsLike {
  programs?: Map<string, LinkedProgramLike>;
}

/**
 * Every KNOWN-LINKED program under `target`, deduped. Every variant of the
 * material, not `currentProgram`: a tinted clone can be shared between a
 * skinned rig and its rigid far mesh, and that slot names whichever variant
 * drew last. A variant still linking is skipped: its first use would block on
 * the link, which is exactly what the gate exists to avoid.
 *
 * `isKnownReady` is the caller's OWN record of what a settled compile proved
 * (linked_program_readiness.ts). The walk never asks three: `isReady()` on a
 * program whose readiness three cached false re-issues a COMPLETION_STATUS
 * query, and one of those blocked a live main thread 5.6 s in production.
 *
 * Split from the touch itself so the walk (cheap, one pass) and the touching
 * (the expensive part, one driver round trip per program) can be scheduled
 * apart: the renderer runs each program as its own budgeted queue unit.
 */
export function collectLinkedPrograms(
  properties: MaterialPropertiesLike,
  target: THREE.Object3D,
  isKnownReady: (program: LinkedProgramLike) => boolean,
): LinkedProgramLike[] {
  const ready: LinkedProgramLike[] = [];
  const seen = new Set<LinkedProgramLike>();
  target.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) {
      if (!material) continue;
      const programs = (properties.get(material) as MaterialProgramsLike).programs;
      if (!programs) continue;
      for (const program of programs.values()) {
        if (seen.has(program) || !isKnownReady(program)) continue;
        seen.add(program);
        ready.push(program);
      }
    }
  });
  return ready;
}

/** Warm ONE linked program's uniform and attribute tables. This is the piece
 *  that costs a driver round trip, so it is also the unit a pacing budget
 *  admits. */
export function touchLinkedProgram(program: LinkedProgramLike): void {
  program.getUniforms();
  program.getAttributes();
}

/**
 * Warm every linked program under `target` in one synchronous burst, and
 * return how many were touched. The unpaced composition of the two functions
 * above: paths that must not spread the cost over frames (a headless host, a
 * test) keep using it.
 */
export function touchLinkedPrograms(
  properties: MaterialPropertiesLike,
  target: THREE.Object3D,
  isKnownReady: (program: LinkedProgramLike) => boolean,
): number {
  const programs = collectLinkedPrograms(properties, target, isKnownReady);
  for (const program of programs) touchLinkedProgram(program);
  return programs.length;
}
