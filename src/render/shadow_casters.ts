// Shadow-caster collection for the object views: every mesh under a view root that is
// flagged to cast, gathered once at build time into the view's distance-gated caster list
// (renderer.ts `objectCasters`). Lifted out of renderer.ts under the monolith ratchet; a
// Three-side helper, so it lives beside the shadow modules rather than in a pure core.

import type * as THREE from 'three';

export function collectCasters(root: THREE.Object3D, into: THREE.Object3D[]): void {
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh && (o as THREE.Mesh).castShadow) into.push(o);
  });
}
