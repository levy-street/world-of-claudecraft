import type * as THREE from 'three';

export interface RankedPointLight {
  light: THREE.PointLight;
  d2: number;
  worldPos: THREE.Vector3;
  /** Static view-light base intensity. Null for externally driven lights. */
  base: number | null;
  /** Moving VFX lights refresh their world position and intensity every frame. */
  dynamic: boolean;
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

/** Reconcile one streamed entity view's point lights with the renderer-wide pool. */
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
    const dynamic = light.userData.budgetDynamic === true;
    if (!dynamic && typeof light.userData.budgetBase !== 'number') {
      light.userData.budgetBase = light.intensity;
    }
    if (!all.includes(light)) all.push(light);
  }
  return { lights: next, changed: true };
}

/** Apply a fixed-count nearest-light budget without reallocating rank entries. */
export function applyPointLightBudget(
  ranked: RankedPointLight[],
  px: number,
  pz: number,
  visibleCount: number,
  liveBudget: number,
  rangeSq: number,
): void {
  for (const entry of ranked) {
    if (entry.dynamic) entry.light.getWorldPosition(entry.worldPos);
    const dx = entry.worldPos.x - px;
    const dz = entry.worldPos.z - pz;
    entry.d2 = dx * dx + dz * dz;
  }
  if (ranked.length > visibleCount) ranked.sort((a, b) => a.d2 - b.d2);
  for (let index = 0; index < ranked.length; index++) {
    const entry = ranked[index];
    const counted = index < visibleCount;
    entry.light.visible = counted;
    const shine = counted && index < liveBudget && entry.d2 < rangeSq;
    if (entry.dynamic) {
      if (!shine) entry.light.intensity = 0;
    } else if (entry.base !== null) {
      entry.light.intensity = shine ? entry.base : 0;
    } else if (counted && !shine) {
      entry.light.intensity = 0;
    }
  }
}

/**
 * How many renderer-owned pad lights must be visible so the TOTAL visible
 * point-light count stays pinned at `visibleCount` even when fewer real lights
 * than the budget exist (boot before props stream in, sparse custom maps,
 * dungeon interiors). Three counts a light into numPointLights iff `visible`,
 * and that count is part of every lit material's program cache key, so any
 * drift recompiles every lit material in view: the open-world travel freeze.
 * Pad lights carry intensity 0 / distance 0, so they shade nothing.
 */
export function pointLightPadCount(rankedCount: number, visibleCount: number): number {
  return Math.max(0, visibleCount - Math.min(visibleCount, rankedCount));
}
