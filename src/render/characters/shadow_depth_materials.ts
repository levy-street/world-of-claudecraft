// Shared shadow-pass depth materials, one per program shape. three hands its
// ONE module-global MeshDepthMaterial to every caster in turn
// (WebGLShadowMap.getDepthMaterial, three 0.185.1), so its stored program
// parameters flip on every caster whose shape differs from the last one: the
// per-draw rebuild material_program_shape_core.ts describes, in the shadow
// pass. A customDepthMaterial keyed by the caster's own shape always matches.
// Constructed with three's DEFAULT options (never set depthPacking, the
// prewarm_depth_material.ts contract), so the shadow pass links the very same
// programs. getDepthMaterial rewrites side / map / alphaTest / clipping per
// draw on whichever material it returns, so sharing carries no state across
// draws that three's own global did not; any caster whose material would make
// getDepthMaterial write a NON-DEFAULT alphaTest is excluded, since alternating
// values on one shared material would bump its version per draw and recreate
// the very rebuild this module removes.
//
// Scope: the directional sun is the only shadow-casting light, so three's
// MeshDistanceMaterial arm of getDepthMaterial is never drawn and is
// deliberately not modelled here (prewarm_depth_material.ts leaves it out for
// the same reason). Point-light shadows would need the distance-material twin.

import * as THREE from 'three';
import { meshProgramShapeKey } from './material_program_shape_core';

const depthMaterials = new Map<string, THREE.MeshDepthMaterial>();

/** The conditions under which three clones its depth material per source
 *  material (getDepthMaterial), with its two alphaTest arms widened to any
 *  alphaTest at all: such a caster keeps three's own clone path. Checked without three's
 *  `renderer.localClippingEnabled` gate: the conservative arm, it only declines
 *  a sharing opportunity. */
export function needsOwnDepthMaterial(material: THREE.Material): boolean {
  const m = material as THREE.MeshStandardMaterial;
  if (m.alphaToCoverage === true) return true;
  // Material.alphaTest bumps material.version on a 0 <-> >0 transition, and
  // getDepthMaterial writes the caster's alphaTest onto the depth material
  // every draw.
  if (m.alphaTest > 0) return true;
  if (m.displacementMap && m.displacementScale !== 0) return true;
  if (m.clipShadows === true && Array.isArray(m.clippingPlanes) && m.clippingPlanes.length !== 0) {
    return true;
  }
  return false;
}

/** The shared depth material for one program shape, minted on first use. */
export function sharedDepthMaterial(shapeKey: string): THREE.MeshDepthMaterial {
  let mat = depthMaterials.get(shapeKey);
  if (!mat) {
    mat = new THREE.MeshDepthMaterial();
    mat.name = `char_depth_${shapeKey}`;
    depthMaterials.set(shapeKey, mat);
  }
  return mat;
}

/** Point a skinned caster at the shared depth material for its own program
 *  shape, or leave it on three's clone path when its material carries
 *  alpha-affecting state. Idempotent. Only skinned meshes are claimed: every
 *  shape mounted here is one more never-evicted material. */
export function attachSharedDepthMaterials(
  mesh: THREE.Mesh,
  material: THREE.Material | THREE.Material[],
): void {
  const skinned = (mesh as THREE.SkinnedMesh).isSkinnedMesh === true;
  const shareable =
    skinned &&
    (Array.isArray(material)
      ? material.every((m) => m && !needsOwnDepthMaterial(m))
      : !needsOwnDepthMaterial(material));
  if (!shareable) {
    mesh.customDepthMaterial = undefined;
    return;
  }
  mesh.customDepthMaterial = sharedDepthMaterial(meshProgramShapeKey(mesh));
}

/** Drop every shared depth material, disposing the programs with them. Wired
 *  into `resetCharacterProfileCaches`, the same graphics-rebuild seam the
 *  tinted-material cache resets on: these are minted from the tinted materials
 *  a profile produced, so a rebuild that retires those must retire these too or
 *  the map keeps a rebuild's worth of dead materials for the session. Safe
 *  there because that flow disposes every character visual first, so nothing
 *  still mounts one; this map needs no claim counting of its own. */
export function clearSharedDepthMaterials(): void {
  for (const mat of depthMaterials.values()) mat.dispose();
  depthMaterials.clear();
}

export const shadowDepthMaterialInternalsForTest = {
  depthMaterials,
  clear: clearSharedDepthMaterials,
};
