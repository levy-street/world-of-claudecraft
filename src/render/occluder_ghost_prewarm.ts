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
// prewarm runs and still pay their first fade on sight.
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
import { cloneMaterialWithHooks } from './material_clone_hooks';
import { clearOccluderGhostMarker, isOccluderGhostMaterial } from './occluder_fade';
import { OCCLUDER_FADE_ALPHA } from './occluder_fade_core';

/** userData marker on a twin, so a later scan never shadows a shadow. */
const PREWARM_MARKER = 'wocOccluderGhostPrewarm';

/** One ghost material plus the program-key context of the mesh wearing it. */
export interface OccluderGhostTarget {
  material: THREE.Material;
  geometry: THREE.BufferGeometry;
  instanced: boolean;
  instanceColor: boolean;
}

function isPrewarmTwin(material: THREE.Material): boolean {
  return (material.userData as { [PREWARM_MARKER]?: boolean })[PREWARM_MARKER] === true;
}

/**
 * Texture slots three folds into the program cache key. Only PRESENCE and the
 * uv channel matter (`<slot>Uv` in WebGLPrograms.getParameters); which image is
 * bound never does, which is why a whole town of recoloured, re-atlased kit
 * sheets collapses onto a handful of programs.
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
  'anisotropyMap',
  'clearcoatMap',
  'clearcoatNormalMap',
  'clearcoatRoughnessMap',
  'iridescenceMap',
  'iridescenceThicknessMap',
  'sheenColorMap',
  'sheenRoughnessMap',
  'specularMap',
  'specularColorMap',
  'specularIntensityMap',
  'transmissionMap',
  'thicknessMap',
  'alphaMap',
  'gradientMap',
  'matcap',
  'envMap',
] as const;

/**
 * The identity of the program a faded twin of `target` would link.
 *
 * The hideable registries clone their materials PER STRUCTURE (a fade must not
 * bleed across buildings), so a town is thousands of ghost materials over a few
 * dozen programs; staging a twin each cost a measured 2.4s of extra boot
 * compile to link 38 of them. This models the inputs three keys on so the group
 * carries one twin per program instead.
 *
 * It errs toward SPLITTING: raw values go in rather than the derived booleans,
 * because an extra twin is one redundant cache hit while a wrong merge silently
 * drops a variant back onto the first live fade.
 */
export function occluderGhostVariantKey(target: OccluderGhostTarget): string {
  const material = target.material as THREE.MeshPhysicalMaterial & Record<string, unknown>;
  const geometry = target.geometry;
  const parts: unknown[] = [
    material.type,
    material.customProgramCacheKey(),
    JSON.stringify(material.defines ?? null),
    material.side,
    material.blending,
    material.premultipliedAlpha,
    material.forceSinglePass,
    material.alphaTest,
    material.alphaHash,
    material.alphaToCoverage,
    material.vertexColors,
    material.flatShading,
    material.fog,
    material.dithering,
    material.depthPacking,
    material.combine,
    material.normalMapType,
    material.clearcoat,
    material.iridescence,
    material.anisotropy,
    material.transmission,
    material.sheen,
    material.dispersion,
  ];
  for (const slot of MAP_SLOTS) {
    const texture = material[slot] as THREE.Texture | null | undefined;
    parts.push(texture ? `${slot}:${texture.channel ?? 0}:${texture.mapping ?? 0}` : '');
  }
  const color = geometry.getAttribute('color');
  parts.push(
    geometry.getAttribute('tangent') ? 'tangent' : '',
    color ? `color${color.itemSize}` : '',
    geometry.morphAttributes.position?.length ?? 0,
    geometry.morphAttributes.normal?.length ?? 0,
    geometry.morphAttributes.color?.length ?? 0,
    target.instanced ? 'instanced' : '',
    target.instanceColor ? 'instanceColor' : '',
  );
  return parts.join('|');
}

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
      if (isPrewarmTwin(material) || !isOccluderGhostMaterial(material)) continue;
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
  const material = cloneMaterialWithHooks(target.material);
  material.name = `${target.material.name || target.material.type}:ghost-fade-prewarm`;
  // Exactly the state applyOccluderFade writes below alpha 1.
  material.transparent = true;
  material.depthWrite = true;
  material.opacity = target.material.opacity * OCCLUDER_FADE_ALPHA;
  clearOccluderGhostMarker(material);
  (material.userData as { [PREWARM_MARKER]?: boolean })[PREWARM_MARKER] = true;

  let mesh: THREE.Mesh;
  if (target.instanced) {
    const instanced = new THREE.InstancedMesh(target.geometry, material, 1);
    instanced.setMatrixAt(0, new THREE.Matrix4());
    if (target.instanceColor) instanced.setColorAt(0, new THREE.Color(1, 1, 1));
    mesh = instanced;
  } else {
    mesh = new THREE.Mesh(target.geometry, material);
  }
  mesh.name = material.name;
  mesh.visible = false;
  mesh.frustumCulled = false;
  return mesh;
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
