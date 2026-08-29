// The identity model of a camera-ghost program, shared by the fade records
// (occluder_fade.ts), the boot prewarm (occluder_ghost_prewarm.ts) and the fade
// gate (occluder_fade_gate.ts), plus the userData markers those three read.
// Kept apart from all of them so the fade side and the prewarm side import one
// neutral module instead of each other.
import type * as THREE from 'three';

/**
 * userData marker every ghost material carries. It is what makes the boot
 * prewarm of the TRANSPARENT variants (occluder_ghost_prewarm.ts) complete by
 * construction: a registry that has to be fed separately gets forgotten by the
 * next hideable call site, while a material that skipped this constructor
 * cannot fade at all.
 */
const GHOST_MARKER = 'wocOccluderGhost';

/** userData marker on a twin, so a later scan never shadows a shadow. */
const TWIN_MARKER = 'wocOccluderGhostPrewarm';

type MarkedUserData = { [GHOST_MARKER]?: boolean; [TWIN_MARKER]?: boolean };

export function markOccluderGhostMaterial(mat: THREE.Material): void {
  (mat.userData as MarkedUserData)[GHOST_MARKER] = true;
}

/** True for a material some hideable registry handed to `occluderFadeMat`. */
export function isOccluderGhostMaterial(mat: THREE.Material): boolean {
  return (mat.userData as MarkedUserData)[GHOST_MARKER] === true;
}

/** Drop the marker from a clone of a ghost material (clone() copies userData). */
export function clearOccluderGhostMarker(mat: THREE.Material): void {
  delete (mat.userData as MarkedUserData)[GHOST_MARKER];
}

export function markOccluderGhostTwin(mat: THREE.Material): void {
  (mat.userData as MarkedUserData)[TWIN_MARKER] = true;
}

/** True for a hidden twin the prewarm or the fade gate minted. */
export function isOccluderGhostTwin(mat: THREE.Material): boolean {
  return (mat.userData as MarkedUserData)[TWIN_MARKER] === true;
}

/** One ghost material plus the program-key context of the mesh wearing it. */
export interface OccluderGhostTarget {
  material: THREE.Material;
  geometry: THREE.BufferGeometry;
  instanced: boolean;
  instanceColor: boolean;
}

/** The program-key context of one mesh, read the way the live scan reads it. */
export function occluderGhostTargetOf(
  material: THREE.Material,
  mesh: THREE.Mesh,
): OccluderGhostTarget {
  const instanced = (mesh as THREE.Mesh & { isInstancedMesh?: boolean }).isInstancedMesh === true;
  return {
    material,
    geometry: mesh.geometry,
    instanced,
    instanceColor:
      instanced && (mesh as THREE.Mesh & { instanceColor?: unknown }).instanceColor != null,
  };
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
export function occluderGhostVariantKey(
  target: OccluderGhostTarget,
  customProgramCacheKey: string = target.material.customProgramCacheKey(),
): string {
  const material = target.material as THREE.MeshPhysicalMaterial & Record<string, unknown>;
  const parts: unknown[] = [
    material.type,
    customProgramCacheKey,
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
  parts.push(occluderGhostMeshVariant(target));
  return parts.join('|');
}

/**
 * The MESH half of the identity: the geometry attributes and the instancing
 * flags three keys on. Two meshes wearing one material draw two programs when
 * this differs, which is why a fade record is minted per (material, mesh
 * variant) rather than per material.
 */
export function occluderGhostMeshVariant(target: OccluderGhostTarget): string {
  const geometry = target.geometry;
  const color = geometry.getAttribute('color');
  return [
    geometry.getAttribute('tangent') ? 'tangent' : '',
    color ? `color${color.itemSize}` : '',
    geometry.morphAttributes.position?.length ?? 0,
    geometry.morphAttributes.normal?.length ?? 0,
    geometry.morphAttributes.color?.length ?? 0,
    target.instanced ? 'instanced' : '',
    target.instanceColor ? 'instanceColor' : '',
  ].join('|');
}
