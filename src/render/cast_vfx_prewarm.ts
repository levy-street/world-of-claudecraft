// The cast-VFX warm-up over the scene: the program links the boot manifest's
// vfx.ability-primitives entry runs (and hands to the resume lane as debt
// when the budget drops it), and the readiness gate the painter consults.
// The pooled primitives and the generic basics sit hidden in the scene from
// the renderer's construction, so the visible-only scene compile never
// collects them; the lazy spell stand-ins join once their group is staged.
// renderer.ts keeps the wiring only.
//
// Linked means PROVED linked, by the settle record (linked_program_readiness.ts):
// each unit marks its root's programs once its compile settled, and the gate
// reads that record. Never three's `currentProgram` (assigned when the program
// cache hands the program over, BEFORE the link resolves under
// KHR_parallel_shader_compile, so a gate reading it opened on links still in
// flight), and never `isReady()` from a live frame (a synchronous GPU-process
// round trip the settle arm alone may issue; see the readiness module's header
// for the 5558 ms it cost once).

import type * as THREE from 'three';
import { abilityVfxCompileMaterials, collectAbilityVfxCompileTargets } from './ability_vfx';
import { type CastVfxReadiness, createCastVfxReadiness } from './cast_vfx_readiness_core';
import { type CompileArmHost, linkColorPrograms } from './compile_arms';
import { isProgramKnownReady, markProgramsReadyUnder } from './linked_program_readiness';
import type { LinkedProgramLike } from './linked_program_touch';
import type { PrewarmResumeUnit } from './prewarm_resume';
import { REVEAL_GATE_WATCHDOG_MS } from './reveal_gate';

/** What the gate reads off the renderer: three's per-material properties,
 *  whose `currentProgram` is the program the settle record is keyed on. */
export interface LinkedProgramSource {
  properties: { get(material: THREE.Material): unknown };
}

/** One link unit per distinct pooled program, plus one for the staged lazy
 *  stand-ins (null before their stage). Each unit names its root, so the
 *  resume lane warms it through the worker ahead of the link (a hit where
 *  the worker is on, an announced link for the audit everywhere), links it
 *  through the colour arm (the canvas variant: the pools draw in the world
 *  pass), and records its root's programs as linked once that compile
 *  settled: the settle is the proof the gate opens on. `compile` is the
 *  test seam. */
export function castVfxProgramUnits(
  scene: THREE.Object3D,
  standIns: THREE.Object3D | null,
  host: CompileArmHost,
  webgl: LinkedProgramSource,
  compile: (root: THREE.Object3D) => Promise<void> = (root) => linkColorPrograms(host, root, false),
): PrewarmResumeUnit[] {
  const unit = (id: string, root: THREE.Object3D): PrewarmResumeUnit => ({
    id,
    roots: [root],
    run: () =>
      compile(root).then(() => {
        markProgramsReadyUnder(webgl.properties, root);
      }),
  });
  const units: PrewarmResumeUnit[] = [];
  if (standIns) units.push(unit('ability-materials:compile', standIns));
  for (const target of collectAbilityVfxCompileTargets(scene)) {
    units.push(unit(`program:${target.id}`, target.object));
  }
  return units;
}

/** How long the cast gate may hold before it opens whatever its programs say.
 *  Three times the reveal watchdog, the project's own bound for "the world
 *  should be up by now": far past any legitimate resume on any device, so the
 *  deadline can only be reached by a lane that has genuinely stopped. A choice
 *  with its reason, not a measurement, and derived rather than tuned. */
export const CAST_VFX_READY_DEADLINE_MS = REVEAL_GATE_WATCHDOG_MS * 3;

/** The gate over the scene's cast materials and the lazy stand-ins' (kept by
 *  the host past their group's cleanup, since the group is removed and never
 *  disposed). */
export function createSceneCastVfxReadiness(
  scene: THREE.Object3D,
  webgl: LinkedProgramSource,
  standIns: () => readonly THREE.Material[] | null,
  now: () => number = () => performance.now(),
  deadlineMs: number = CAST_VFX_READY_DEADLINE_MS,
): CastVfxReadiness {
  return createCastVfxReadiness<THREE.Material>({
    now,
    deadlineMs,
    materials: () => [...abilityVfxCompileMaterials(scene), ...(standIns() ?? [])],
    staged: () => standIns() !== null,
    // The PROGRAM the settle record proved, not a boolean: the core keys its
    // answer on it, so a material three has repointed at a program no settle
    // has seen reads pending again instead of riding the earlier one's answer.
    linked: (material) => {
      const program = (
        webgl.properties.get(material) as { currentProgram?: LinkedProgramLike | null }
      ).currentProgram;
      return program && isProgramKnownReady(program) ? program : null;
    },
  });
}
