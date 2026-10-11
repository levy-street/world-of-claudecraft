// Two small jobs every bespoke FX piece parented into a character rig shares:
// keeping the piece out of the body's own material cycle, and the unlit glow
// material recipe. The shapeshift form adornments (moonwing_adornment.ts,
// gloamveil_veil.ts) use both; the paladin rig FX and the weapon VFX set the
// same marker inline.
import * as THREE from 'three';
import { markSharedMaterial, markSharedTexture } from '../shared_resource';

/**
 * Keep a rig-parented FX object out of the body's overlay cycle: the tint,
 * ghost and Soul Rend swaps and their prewarm twins, the skin re-snapshot and
 * the shadow-caster sweep all skip `weaponVfxMesh` meshes (visual.ts,
 * assets.ts applyMaterials, character_effect_prewarm.ts,
 * soul_rend_prewarm_core.ts). An FX piece draws its own material and never
 * casts a shadow.
 */
export function markRigFx<T extends THREE.Object3D>(object: T): T {
  object.userData.weaponVfxMesh = true;
  const mesh = object as unknown as THREE.Mesh;
  if (mesh.isMesh) {
    mesh.castShadow = false;
    mesh.receiveShadow = false;
  }
  return object;
}

/**
 * The unlit glow recipe (the priest halo's): transparent, double-sided, no
 * depth write, unfogged, over a painted map. Every material minted here keys
 * the same program whatever its colour, texture or blending (three folds
 * blending into the key only for an opaque material). Marked shared with its
 * texture: these back module-level kits that every rig draws, so no per-root
 * teardown may dispose them.
 */
export function rigGlowMaterial(
  name: string,
  map: THREE.Texture,
  color: number,
  blending: THREE.Blending = THREE.AdditiveBlending,
): THREE.MeshBasicMaterial {
  const material = new THREE.MeshBasicMaterial({
    map: markSharedTexture(map),
    color,
    transparent: true,
    blending,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: false,
  });
  material.name = name;
  return markSharedMaterial(material);
}

/** Tag every mesh under a hidden prewarm stand-in with the `vfx` render
 *  category: the ability-primitives manifest entry walks the scene for exactly
 *  that tag to upload textures, so a stand-in's painted maps are resident
 *  before the first live draw (the live pieces keep their rig's category). */
export function tagStandInForTextureUpload(root: THREE.Object3D): void {
  root.traverse((object) => {
    if ((object as THREE.Mesh).isMesh) object.userData.renderCategory = 'vfx';
  });
}
