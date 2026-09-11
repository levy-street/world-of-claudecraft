import * as THREE from 'three';
import {
  cadenceIntervalForProjectedPixels,
  cadenceRefreshDue,
  projectedPixelSize,
} from './perceptual_lod_core';

export const CAMPFIRE_EMBER_MIN_PROJECTED_PIXELS = 10;

export interface FlamePerceptualState {
  worldPosition: THREE.Vector3;
  referenceHeight: number;
  warm: boolean;
  lastFlickerAt: number;
  emitsEmber: boolean;
  active: boolean;
}

function objectAndAncestorsVisible(object: THREE.Object3D): boolean {
  for (let current: THREE.Object3D | null = object; current; current = current.parent) {
    if (!current.visible) return false;
  }
  return true;
}

/**
 * Apply one scenery-only flame sample. A null result means the flame has a
 * hidden ancestor. Behind-camera flames return their reusable inactive state.
 */
export function updateSceneryFlame(
  flame: THREE.Mesh,
  index: number,
  time: number,
  cameraPosition: THREE.Vector3,
  viewForward: THREE.Vector3,
  projectionPixels: number,
  priorState?: FlamePerceptualState,
): FlamePerceptualState | null {
  if (!objectAndAncestorsVisible(flame)) return null;

  let state = priorState;
  if (!state) {
    const parameters = (flame.geometry as THREE.ConeGeometry).parameters;
    const authoredHeight = parameters && Number.isFinite(parameters.height) ? parameters.height : 1;
    const material = flame.material as THREE.MeshLambertMaterial;
    const worldScale = flame.getWorldScale(new THREE.Vector3());
    state = {
      worldPosition: flame.getWorldPosition(new THREE.Vector3()),
      referenceHeight: Math.max(0.8, authoredHeight * Math.abs(worldScale.y)),
      warm: material.color.r > material.color.b,
      lastFlickerAt: Number.NEGATIVE_INFINITY,
      emitsEmber: false,
      active: false,
    };
  }

  const dx = state.worldPosition.x - cameraPosition.x;
  const dy = state.worldPosition.y - cameraPosition.y;
  const dz = state.worldPosition.z - cameraPosition.z;
  const viewDepth = dx * viewForward.x + dy * viewForward.y + dz * viewForward.z;
  if (viewDepth <= 0) {
    state.active = false;
    state.emitsEmber = false;
    return state;
  }

  state.active = true;
  const projectedPixels = projectedPixelSize(state.referenceHeight, viewDepth, projectionPixels);
  const cadence = cadenceIntervalForProjectedPixels(projectedPixels);
  if (cadenceRefreshDue(time, state.lastFlickerAt, cadence)) {
    // The SLOW breath only — a log catching, sampled at the perceptual-LOD
    // cadence. The fast licking lives in the flame's vertex shader now
    // (campfire_flame.ts), where it runs per vertex and per frame; this used to
    // carry both and the whole flame pumped like a bellows. Kept byte-for-byte
    // in step with campfireFlameScale(), which is the same curve for flames
    // outside this lane (the editor's placed campfires).
    const scale =
      0.97 + Math.sin(time * 1.7 + index * 2.4) * 0.035 + Math.sin(time * 4.1 + index) * 0.02;
    flame.scale.set(scale, scale * (1 + Math.sin(time * 2.3 + index) * 0.05), scale);
    state.lastFlickerAt = time;
  }
  state.emitsEmber = state.warm && projectedPixels >= CAMPFIRE_EMBER_MIN_PROJECTED_PIXELS;
  return state;
}
