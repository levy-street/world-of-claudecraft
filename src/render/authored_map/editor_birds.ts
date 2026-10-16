// Editor override for the ambient bird flock, moved out of renderer.ts. Birds
// are a tiny fixed pool, so a config change just rebuilds the flock.

import type * as THREE from 'three';
import { type BirdsView, buildBirds } from '../birds';

export interface EditorBirdsConfig {
  enabled: boolean;
  count: number;
  formation: boolean;
}

/** Dispose `birds` and build its replacement (null = the shipped default),
 *  swapping it into `scene`. */
export function rebuildBirdFlock(
  scene: THREE.Scene,
  birds: BirdsView,
  seed: number,
  cfg: EditorBirdsConfig | null,
): BirdsView {
  scene.remove(birds.group);
  const mats = new Set<THREE.Material>();
  birds.group.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) {
      m.geometry.dispose();
      mats.add(m.material as THREE.Material);
    }
  });
  for (const m of mats) m.dispose();
  const next = buildBirds(
    seed,
    cfg ? { count: cfg.enabled ? cfg.count : 0, formation: cfg.formation } : undefined,
  );
  scene.add(next.group);
  return next;
}
