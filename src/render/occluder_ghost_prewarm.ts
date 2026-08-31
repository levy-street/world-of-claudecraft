// Boot prewarm for the camera-ghost TRANSPARENT program variants.
//
// A ghosted structure fades by flipping `transparent` on its per-structure
// materials (occluder_fade.ts), and three derives its program cache key from
// that flip (`opaque` in WebGLPrograms.getParameters), so every ghost material
// owns TWO programs: the opaque one it draws with, and a transparent twin that
// only ever links on the structure's first fade. The hook-preserving clone in
// the hideable registries already collapsed the opaque half onto the source's
// program; this module removes the remaining half from the gameplay frame.
//
// Measured on the offline Eastbrook scene (insane tier, 1965 live ghost
// materials): putting them all into the fade state linked 41 programs over
// 2.39s of compile before this group existed, and 3 over 0.53s after.
//
// Coverage is by construction: `occluderFadeMat` marks every material it turns
// into a fade record, so a new hideable call site is warmed without touching
// this file. The scan is over the live scene graph, so it covers exactly what
// is BUILT at boot (the props kits and both rebuilt towns, all created in the
// Renderer constructor). Hideables built later, notably the dungeon arena walls
// emitted when an instance interior is built, are not in the scene when the
// prewarm runs; their first fade goes through the fade gate instead
// (occluder_fade_gate.ts), which links the twin before the flip, and the raid
// shells' backface walls stage their twins through the same gate on their
// first advanced frame (stageOccluderFadeOnce in dungeon_wall_occlusion.ts)
// and hold their re-show out of the fully hidden state until every twin is
// ready, so the flip never draws a program the stage has not linked.
//
// One twin per distinct PROGRAM, not per ghost material: see
// occluderGhostVariantKey for why a town of thousands of per-structure clones
// is a few dozen programs, and what a wrong merge would cost.
//
// Each twin carries the source's geometry and mesh kind on purpose: three reads
// `object.isInstancedMesh`, `instanceColor`, and the geometry's tangent/colour/
// morph attributes into the same key, so a stand-in box would link a key the
// live fade never asks for. Sharing the geometry costs nothing (no clone, no
// upload: the twins are never drawn) and the group is torn out of the scene
// after the prewarm WITHOUT disposal, because disposing a material releases the
// linked program this group exists to keep.

import * as THREE from 'three';
import { buildOccluderFadeTwin } from './occluder_fade_gate';
import {
  isOccluderGhostMaterial,
  isOccluderGhostTwin,
  type OccluderGhostTarget,
  occluderGhostVariantKey,
} from './occluder_ghost_variant_key';

// The key model and the twin recipe live in occluder_ghost_variant_key.ts and
// occluder_fade_gate.ts (the live fade gate mints twins from the same recipe);
// re-exported here for the callers that learned them under this name.
export { type OccluderGhostTarget, occluderGhostVariantKey };

/** Every distinct ghost material under `root`, with a representative mesh. */
export function collectOccluderGhostTargets(root: THREE.Object3D): OccluderGhostTarget[] {
  const targets: OccluderGhostTarget[] = [];
  const seen = new Set<THREE.Material>();
  root.traverse((object) => {
    const mesh = object as THREE.Mesh & { isInstancedMesh?: boolean; instanceColor?: unknown };
    if (!mesh.isMesh || !mesh.geometry) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) {
      if (!material || seen.has(material)) continue;
      if (isOccluderGhostTwin(material) || !isOccluderGhostMaterial(material)) continue;
      seen.add(material);
      targets.push({
        material,
        geometry: mesh.geometry,
        instanced: mesh.isInstancedMesh === true,
        instanceColor: mesh.isInstancedMesh === true && mesh.instanceColor != null,
      });
    }
  });
  return targets;
}

function buildTwin(target: OccluderGhostTarget): THREE.Mesh {
  return buildOccluderFadeTwin(target, 'ghost-fade-prewarm');
}

/**
 * A hidden group of one twin mesh per DISTINCT ghost program found under
 * `root` (materials sharing a program cache key share one twin), in the exact
 * fade state, so the boot compile links the transparent variants the first
 * live fade would otherwise link inside a gameplay frame.
 */
export function buildGhostVariantPrewarmGroup(root: THREE.Object3D): THREE.Group {
  const group = new THREE.Group();
  group.name = 'occluder-ghost-variant-prewarm';
  // Never drawn: the twins wear real building geometry, and linking is what
  // this group is for (three's compile() traverses regardless of visibility).
  group.visible = false;
  group.userData.renderCategory = 'prewarm';
  const seen = new Set<string>();
  for (const target of collectOccluderGhostTargets(root)) {
    const key = occluderGhostVariantKey(target);
    if (seen.has(key)) continue;
    seen.add(key);
    group.add(buildTwin(target));
  }
  return group;
}
