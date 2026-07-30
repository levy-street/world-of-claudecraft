// The Amberfall's dressing, render-only. Its golden god-rays were removed at
// the user's request, so this module is intentionally a no-op: it keeps the
// sibling-realm contract (a static group plus an update(time)) so the realm
// can regain render-only dressing later without re-wiring the renderer.
import * as THREE from 'three';

export interface AmberFeaturesView {
  group: THREE.Group;
  update(time: number): void;
}

export function buildAmberFeatures(_seed: number): AmberFeaturesView {
  const group = new THREE.Group();
  group.name = 'amber-features';
  return {
    group,
    update(_time: number): void {},
  };
}
