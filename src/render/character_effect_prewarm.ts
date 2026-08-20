// Boot prewarm for the character-rig TRANSPARENT effect variants.
//
// A rig goes translucent by mounting a `transparent = true` clone of every one
// of its materials (characters/effect_materials.ts, driven by `setGhost` for
// stealth / the spirit run / visions / ghost wolf / the spirit healer / the
// veilbound march, plus `setShadowform` and `setMoonkin`). Three keys its
// program cache on that flip, so every rig material owns TWO programs: the
// opaque one the boot archetype prewarm already links, and a transparent twin
// that only ever links the first time someone in view goes translucent.
//
// Nothing warmed that half. A 2026-08-17 production capture inside an Eastbrook
// crowd measured it as the run's dominant live family: `paladin_metallic` 4808
// ms in ONE synchronous link, then `mod_cloth` and `mod_jewel_59bcbc` twice
// each at 115 to 130 ms, all on the same rig root, all decoding to `-opaque`
// against the boot-prewarmed opaque program. The pairs are the double-sided
// materials: a transparent DoubleSide material is drawn (and compiled) as two
// face passes, so it mints two programs.
//
// This is the sibling of occluder_ghost_prewarm.ts, on the registry that one
// cannot see: `applyOccluderFade` never touches character rigs.
//
// One twin per distinct PROGRAM, not per material: a boot scene carries dozens
// of archetype rigs over a handful of programs, and staging a twin per material
// would pay the town-scale boot cost occluderGhostVariantKey exists to avoid.
// The key is material identity + mesh kind + attribute signature + morph counts
// + side (character_effect_prewarm_core.ts).
//
// Each twin carries the source's geometry, skinned-ness and `side` on purpose:
// three reads all three into the same key, and it is `side` that gets both face
// passes of a double-sided material compiled, because three's own compile()
// splits a transparent DoubleSide material into a BackSide and a FrontSide pass
// (WebGLRenderer prepareMaterial). Sharing the geometry costs nothing (no
// clone, no upload: the twins are never drawn) and the group is torn out of the
// scene after the prewarm WITHOUT disposal, because disposing a material
// releases the linked program this group exists to keep.

import * as THREE from 'three';
import {
  type CharacterEffectDrawPath,
  characterEffectProgramKey,
} from './character_effect_prewarm_core';
import { createGhostEffectMaterial } from './characters/effect_materials';

/** userData marker on a twin, so a later scan never shadows a shadow. */
const PREWARM_MARKER = 'wocCharacterEffectPrewarm';

/** One rig material plus the program-key context of the mesh wearing it. */
export interface CharacterEffectTarget {
  material: THREE.Material;
  geometry: THREE.BufferGeometry;
  skinned: boolean;
}

/**
 * Texture slots three folds into the program cache key. Only PRESENCE and the
 * uv channel matter (`<slot>Uv` in WebGLPrograms.getParameters); which image is
 * bound never does, which is why a whole crowd of dyed, re-atlased and
 * recoloured rigs collapses onto a handful of programs.
 */
const MAP_SLOTS = [
  'map',
  'aoMap',
  'lightMap',
  'bumpMap',
  'normalMap',
  'displacementMap',
  'emissiveMap',
  'metalnessMap',
  'roughnessMap',
  'alphaMap',
  'specularMap',
  'gradientMap',
  'matcap',
  'envMap',
] as const;

function isPrewarmTwin(material: THREE.Material): boolean {
  return (material.userData as { [PREWARM_MARKER]?: boolean })[PREWARM_MARKER] === true;
}

/** The material half of the twin's program identity, read off the TRANSPARENT
 *  clone (the state the live effect mounts), never off the opaque source. */
function effectMaterialKey(material: THREE.Material): string {
  const m = material as THREE.MeshPhysicalMaterial & Record<string, unknown>;
  const parts: unknown[] = [
    m.type,
    m.customProgramCacheKey(),
    JSON.stringify(m.defines ?? null),
    m.blending,
    m.premultipliedAlpha,
    m.forceSinglePass,
    m.alphaTest,
    m.alphaHash,
    m.alphaToCoverage,
    m.vertexColors,
    m.flatShading,
    m.fog,
    m.dithering,
    m.combine,
    m.normalMapType,
    m.clearcoat,
    m.iridescence,
    m.anisotropy,
    m.transmission,
    m.sheen,
  ];
  for (const slot of MAP_SLOTS) {
    const texture = m[slot] as THREE.Texture | null | undefined;
    parts.push(texture ? `${slot}:${texture.channel ?? 0}:${texture.mapping ?? 0}` : '');
  }
  return parts.join('|');
}

function attributeList(geometry: THREE.BufferGeometry): string[] {
  return Object.entries(geometry.attributes).map(
    ([name, attribute]) => `${name}:${(attribute as THREE.BufferAttribute).itemSize}`,
  );
}

/** The draw path a transparent clone of `target` binds. */
export function characterEffectDrawPath(
  target: CharacterEffectTarget,
  clone: THREE.Material,
): CharacterEffectDrawPath {
  const morphs = target.geometry.morphAttributes;
  return {
    materialKey: effectMaterialKey(clone),
    attributes: attributeList(target.geometry),
    skinned: target.skinned,
    morphCounts: [
      morphs.position?.length ?? 0,
      morphs.normal?.length ?? 0,
      morphs.color?.length ?? 0,
    ],
    side: clone.side,
    doubleSidedSplit: clone.side === THREE.DoubleSide && clone.forceSinglePass !== true,
  };
}

/**
 * Every distinct rig material under `root`, with a representative mesh.
 *
 * SkinnedMesh only: `skinning` is a program parameter, so the transparent
 * variant a rig asks for is never the one a static prop would link, and every
 * surface an effect overlay repaints belongs to a rig. Weapon-VFX meshes are
 * skipped for the same reason visual.ts keeps them out of the overlay cycle:
 * their shader materials are owned by the weapon-skin handle and never cloned.
 */
export function collectCharacterEffectTargets(root: THREE.Object3D): CharacterEffectTarget[] {
  const targets: CharacterEffectTarget[] = [];
  const seen = new Set<THREE.Material>();
  root.traverse((object) => {
    const mesh = object as THREE.SkinnedMesh;
    if (mesh.isSkinnedMesh !== true || !mesh.geometry) return;
    if (mesh.userData.weaponVfxMesh) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) {
      if (!material || seen.has(material)) continue;
      if (isPrewarmTwin(material)) continue;
      seen.add(material);
      targets.push({ material, geometry: mesh.geometry, skinned: true });
    }
  });
  return targets;
}

function buildTwin(target: CharacterEffectTarget, clone: THREE.Material): THREE.Mesh {
  clone.name = `${target.material.name || target.material.type}:character-effect-prewarm`;
  (clone.userData as { [PREWARM_MARKER]?: boolean })[PREWARM_MARKER] = true;
  // A SkinnedMesh with no skeleton: three's getParameters reads only
  // `object.isSkinnedMesh` for the `skinning` bit, and the twin is never drawn
  // (nothing projects an invisible subtree), so binding a skeleton would buy a
  // GPU bone texture for nothing.
  const mesh = new THREE.SkinnedMesh(target.geometry, clone);
  mesh.name = clone.name;
  mesh.visible = false;
  mesh.frustumCulled = false;
  return mesh;
}

/**
 * A hidden group of one twin mesh per DISTINCT transparent character program
 * found under `root` (materials sharing a program cache key share one twin), in
 * the exact state the live overlay mounts, so the boot compile links the
 * transparent variants a nearby player entering stealth, releasing to spirit,
 * or shifting to Shadowform / Moonkin would otherwise link inside a gameplay
 * frame.
 *
 * One twin serves all four flavours: ghost, stealth, shadowform and moonkin
 * differ only in opacity, colour and emissive, none of which three reads into a
 * program cache key.
 */
export function buildCharacterEffectPrewarmGroup(root: THREE.Object3D): THREE.Group {
  const group = new THREE.Group();
  group.name = 'character-effect-variant-prewarm';
  // Never drawn: the twins wear real rig geometry, and linking is what this
  // group is for (three's compile() traverses regardless of visibility).
  group.visible = false;
  group.userData.renderCategory = 'prewarm';
  const seen = new Set<string>();
  for (const target of collectCharacterEffectTargets(root)) {
    // Minted through the live factory, then keyed off the CLONE: the program a
    // twin links is the one the clone's own state describes, never the opaque
    // source's.
    const clone = createGhostEffectMaterial(target.material);
    const key = characterEffectProgramKey(characterEffectDrawPath(target, clone));
    if (seen.has(key)) {
      // Another material already links this program: a redundant twin would
      // only be a second cache hit, and it would pin a duplicate clone alive.
      clone.dispose();
      continue;
    }
    seen.add(key);
    group.add(buildTwin(target, clone));
  }
  return group;
}
