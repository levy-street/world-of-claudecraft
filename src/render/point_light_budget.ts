import type * as THREE from 'three';
import { markPointLightSource } from './point_light_carriers_core';

/**
 * The append-only face of the fire-light registry that a subsystem is handed.
 *
 * Deliberately shaped like `Array.prototype.push` so a plain array still
 * satisfies it (tests and off-screen callers keep passing one), while the
 * renderer can pass an adopter that hides the light and marks the budget rank
 * dirty in the same step. A subsystem that appends a VISIBLE light the rank has
 * never seen changes numPointLights for the frames before the next budget pass,
 * and that relinks every material drawn in them.
 */
export interface FireLightSink {
  push(...lights: THREE.PointLight[]): number;
}

export interface RankedPointLight {
  light: THREE.PointLight;
  d2: number;
  worldPos: THREE.Vector3;
  /** Static view-light base intensity. Null for externally driven lights. */
  base: number | null;
  /** Moving VFX lights refresh their world position and intensity every frame. */
  dynamic: boolean;
  /** Stable index in the renderer's fire-light registry, absent for view lights. */
  fireIndex?: number;
  /** Working flag: drawn-eligibility computed by applyPointLightBudget. */
  eligible?: boolean;
}

export interface ReconciledViewPointLights {
  lights: THREE.PointLight[];
  changed: boolean;
}

function sameLights(
  left: readonly THREE.PointLight[],
  right: readonly THREE.PointLight[],
): boolean {
  return left.length === right.length && left.every((light, index) => light === right[index]);
}

/** Reconcile one streamed entity view's point lights with the renderer-wide pool.
 *  A view light is often born visible, so it becomes a carrier source here,
 *  before any render or compile can gather it beside the carriers. */
export function reconcileViewPointLights(
  root: THREE.Object3D,
  current: readonly THREE.PointLight[],
  all: THREE.PointLight[],
): ReconciledViewPointLights {
  const next: THREE.PointLight[] = [];
  root.traverse((object) => {
    const light = object as THREE.PointLight;
    if (light.isPointLight) next.push(light);
  });
  if (sameLights(current, next)) return { lights: current.slice(), changed: false };

  for (const light of current) {
    const index = all.indexOf(light);
    if (index >= 0) all.splice(index, 1);
  }
  for (const light of next) {
    markPointLightSource(light);
    const dynamic = light.userData.budgetDynamic === true;
    if (!dynamic && typeof light.userData.budgetBase !== 'number') {
      light.userData.budgetBase = light.intensity;
    }
    if (!all.includes(light)) all.push(light);
  }
  return { lights: next, changed: true };
}

/**
 * A light draws only if it AND its whole ancestor chain are visible. The
 * budget owns light.visible, but the world owns the ancestors (zone streaming,
 * far-LOD wraps, compile gates), so a chosen light under a hidden group would
 * hold a counted slot the render never draws, starving a light that could
 * shine. A light is drawn-eligible only if walking its parents reaches
 * `sceneRoot` through visible nodes.
 */
function isDrawnEligible(light: THREE.PointLight, sceneRoot: THREE.Object3D): boolean {
  let node = light.parent;
  while (node !== null) {
    if (node === sceneRoot) return node.visible;
    if (node.visible === false) return false;
    node = node.parent;
  }
  return false;
}

/** Apply a fixed-count nearest-light budget without reallocating rank entries.
 *  Returns the number of counted, drawn-eligible lights. */
export function applyPointLightBudget(
  ranked: RankedPointLight[],
  px: number,
  pz: number,
  visibleCount: number,
  liveBudget: number,
  rangeSq: number,
  sceneRoot?: THREE.Object3D,
): number {
  for (const entry of ranked) {
    // Eligibility FIRST, because getWorldPosition below walks and recomputes
    // the whole ancestor matrix chain. An ineligible light is one nothing can
    // draw (a far-LOD swap hid the rig carrying it, a streamed group is off),
    // it can never hold a counted slot, and its stale d2 only ever orders it
    // against other ineligible entries in the tail the sort pushes it into.
    // Weapon-skin lights ride a rig that hides on the LOD swap, so a crowd is
    // exactly the case that pays this walk for nothing.
    entry.eligible = sceneRoot === undefined || isDrawnEligible(entry.light, sceneRoot);
    if (entry.dynamic && entry.eligible) entry.light.getWorldPosition(entry.worldPos);
    const dx = entry.worldPos.x - px;
    const dz = entry.worldPos.z - pz;
    entry.d2 = dx * dx + dz * dz;
  }
  // Sort whenever the live budget (which can sit below visibleCount under the
  // frame-budget governor or on constrained-memory tiers) actually truncates
  // the ranked list. Comparing against visibleCount alone let array order,
  // not distance, decide which lights shine whenever
  // liveBudget < ranked.length <= visibleCount. Ineligible entries sort to
  // the tail so they never hold a counted slot; on the untruncated path they
  // are skipped by the running counter instead, so a hidden ancestor never
  // forces a per-frame sort of its own (the hot path stays allocation-free).
  if (ranked.length > liveBudget) {
    ranked.sort((a, b) => Number(!a.eligible) - Number(!b.eligible) || a.d2 - b.d2);
  }
  let drawn = 0;
  for (let index = 0; index < ranked.length; index++) {
    const entry = ranked[index];
    const counted = entry.eligible !== false && drawn < visibleCount;
    if (counted) drawn++;
    entry.light.visible = counted;
    const shine = counted && drawn <= liveBudget && entry.d2 < rangeSq;
    if (entry.dynamic) {
      if (!shine) entry.light.intensity = 0;
    } else if (entry.base !== null) {
      entry.light.intensity = shine ? entry.base : 0;
    } else if (counted && !shine) {
      entry.light.intensity = 0;
    }
  }
  return drawn;
}

/** Flicker only fire lights that the completed budget says can contribute. */
export function flickerContributingFireLights(
  ranked: readonly RankedPointLight[],
  time: number,
  visibleCount: number,
  liveBudget: number,
  rangeSq: number,
): void {
  const contributingCount = Math.min(ranked.length, visibleCount, liveBudget);
  for (let index = 0; index < contributingCount; index++) {
    const entry = ranked[index];
    const fireIndex = entry.fireIndex;
    if (fireIndex === undefined || entry.d2 >= rangeSq || entry.eligible === false) continue;
    const base = (entry.light.userData.baseIntensity as number | undefined) ?? 11;
    entry.light.intensity = base + Math.sin(time * 11 + fireIndex * 1.7) * 2.5 * (base / 11);
  }
}
