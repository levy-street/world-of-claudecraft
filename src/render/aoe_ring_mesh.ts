// The pooled AoE impact ring slot the renderer flashes where a ground-targeted
// spell lands (aoe_ring.ts owns its animation). One builder, so the boot entry
// that links the ring's program (castVfxFirstReadsEntry) is tested on the same
// material the renderer draws.

import * as THREE from 'three';
import { floorVfxRenderOrder } from './floor_vfx_layer';
import { setRenderCategory } from './renderer_diagnostics';

export function buildAoeRingMesh(
  geometry: THREE.BufferGeometry,
): THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial> {
  const ring = new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, depthTest: false }),
  );
  ring.visible = false;
  ring.renderOrder = floorVfxRenderOrder('player', 9); // like the click marker
  setRenderCategory(ring, 'ui3d');
  return ring;
}
