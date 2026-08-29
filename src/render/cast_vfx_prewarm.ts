// The cast-VFX warm-up over the scene: the program links the boot manifest's
// vfx.ability-primitives entry runs (and hands to the resume lane as debt
// when the budget drops it), and the readiness gate the painter consults.
// The pooled primitives and the generic basics sit hidden in the scene from
// the renderer's construction, so the visible-only scene compile never
// collects them; the lazy spell stand-ins join once their group is staged.
// renderer.ts keeps the wiring only.

import type * as THREE from 'three';
import { abilityVfxCompileMaterials, collectAbilityVfxCompileTargets } from './ability_vfx';
import { type CastVfxReadiness, createCastVfxReadiness } from './cast_vfx_readiness_core';
import type { PrewarmResumeUnit } from './prewarm_resume';
import { REVEAL_GATE_WATCHDOG_MS } from './reveal_gate';

/** One link unit per distinct pooled program, plus one for the staged lazy
 *  stand-ins (null before their stage). Each unit names its root, so the
 *  resume lane warms it through the worker ahead of the link (a hit where
 *  the worker is on, an announced link for the audit everywhere). */
export function castVfxProgramUnits(
  scene: THREE.Object3D,
  standIns: THREE.Object3D | null,
  compile: (root: THREE.Object3D) => Promise<void>,
): PrewarmResumeUnit[] {
  const unit = (id: string, root: THREE.Object3D): PrewarmResumeUnit => ({
    id,
    roots: [root],
    run: () => compile(root),
  });
  const units: PrewarmResumeUnit[] = [];
  if (standIns) units.push(unit('ability-materials:compile', standIns));
  for (const target of collectAbilityVfxCompileTargets(scene)) {
    units.push(unit(`program:${target.id}`, target.object));
  }
  return units;
}

/** What the gate reads off the renderer: three's per-material properties,
 *  whose `currentProgram` is set once the material's program is linked. */
export interface LinkedProgramSource {
  properties: { get(material: THREE.Material): unknown };
}

/** The gate over the scene's cast materials and the lazy stand-ins' (kept by
 *  the host past their group's cleanup, since the group is removed and never
 *  disposed). */
/** How long the cast gate may hold before it opens whatever its programs say.
 *  Three times the reveal watchdog, the project's own bound for "the world
 *  should be up by now": far past any legitimate resume on any device, so the
 *  deadline can only be reached by a lane that has genuinely stopped. A choice
 *  with its reason, not a measurement, and derived rather than tuned. */
export const CAST_VFX_READY_DEADLINE_MS = REVEAL_GATE_WATCHDOG_MS * 3;

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
    linked: (material) =>
      !!(webgl.properties.get(material) as { currentProgram?: unknown }).currentProgram,
  });
}
