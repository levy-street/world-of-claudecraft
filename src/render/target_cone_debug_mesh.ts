// The dev-only Tab-target cone overlay's Three.js meshes (enabled via ?targetcone=1 in main.ts):
// the filled flared cone, its outline and the query-radius rim, built from the pure geometry in
// target_cone_debug.ts. Moved out of renderer.ts (2026-09-28) to pay the monolith ratchet for the
// melee contact queue; the renderer keeps the per-frame drape.
import * as THREE from 'three';
import { setRenderCategory } from './renderer_diagnostics';
import { buildFlaredConeFan, buildRingXZ } from './target_cone_debug';

export interface TargetConeMesh {
  group: THREE.Group;
  pos: THREE.BufferAttribute;
  localXZ: Float32Array;
  worldXYZ: Float32Array;
  // Full query-radius rim (40 yd): the absolute Tab range. Symmetric, so it is
  // draped with facing 0.
  ringPos: THREE.BufferAttribute;
  ringXZ: Float32Array;
  ringWorldXYZ: Float32Array;
}

/** Draws a filled flared near-radius cone (idle cluster), its outline, and a full query-radius
 *  rim (absolute Tab range). The group starts hidden; the caller adds it to the scene. */
export function buildTargetConeMesh(
  halfAt: (d: number) => number,
  nearRadius: number,
  queryRadius: number,
): TargetConeMesh {
  const fan = buildFlaredConeFan(nearRadius, halfAt, 16, 48);
  const worldXYZ = new Float32Array(fan.vertexCount * 3);
  // Wrap the array by reference (not Float32BufferAttribute, which copies) so
  // re-draping worldXYZ each frame writes straight into the uploaded buffer.
  const pos = new THREE.BufferAttribute(worldXYZ, 3);
  const fillGeo = new THREE.BufferGeometry();
  fillGeo.setAttribute('position', pos);
  fillGeo.setIndex(new THREE.BufferAttribute(fan.index, 1));
  const fillMat = new THREE.MeshBasicMaterial({
    color: 0x49c0ff,
    transparent: true,
    opacity: 0.16,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const fill = new THREE.Mesh(fillGeo, fillMat);
  fill.frustumCulled = false; // re-draped every frame; its bounds go stale
  // Outline: a LineLoop over the flared perimeter (left edge -> outer arc ->
  // right edge), sharing the position buffer so one update moves fill and edge.
  const lineGeo = new THREE.BufferGeometry();
  lineGeo.setAttribute('position', pos);
  lineGeo.setIndex(new THREE.BufferAttribute(fan.outline, 1));
  const lineMat = new THREE.LineBasicMaterial({
    color: 0x9be0ff,
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
  });
  const outline = new THREE.LineLoop(lineGeo, lineMat);
  outline.frustumCulled = false;
  // Query-radius rim: a full circle at max Tab range, in a contrasting amber so
  // it reads apart from the blue cone.
  const ringXZ = buildRingXZ(queryRadius, 96);
  const ringWorldXYZ = new Float32Array((ringXZ.length / 2) * 3);
  const ringPos = new THREE.BufferAttribute(ringWorldXYZ, 3);
  const ringGeo = new THREE.BufferGeometry();
  ringGeo.setAttribute('position', ringPos);
  const ringMat = new THREE.LineBasicMaterial({
    color: 0xffb24d,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
  });
  const ring = new THREE.LineLoop(ringGeo, ringMat);
  ring.frustumCulled = false;
  const group = new THREE.Group();
  group.add(fill);
  group.add(outline);
  group.add(ring);
  setRenderCategory(group, 'ui3d');
  group.visible = false;
  return {
    group,
    pos,
    localXZ: fan.localXZ,
    worldXYZ,
    ringPos,
    ringXZ,
    ringWorldXYZ,
  };
}
