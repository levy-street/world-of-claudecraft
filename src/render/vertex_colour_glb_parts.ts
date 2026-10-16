// The shared plumbing of the Blender-built, vertex-coloured props (the harbor route
// markers, harbor_route_markers.ts, and the Wyrmwatch cliff harbor, wyrmwatch_harbor.ts):
// convert a GLB material into the surface family's vertex-coloured standard/lambert
// material (a "glow" material becomes the warm lantern emissive), read one mesh's
// geometry dequantized into a chosen frame, and merge the collected geometries into one
// mesh part per material. Extracted at the second vertex-coloured prop (the rule of
// three: the ship's converter, transport_ship.ts, buckets by attribute layout too).
// A painted material (one that carries a map: the Mirefen tavern's painted town maps) keeps
// its map, and its normal map (at the source's normal scale) where the tier draws standard
// materials, and its geometry keeps its UVs; the vertex colour is then the tint and baked
// light over the paint, stored under a headroom its material's extras name
// (`vertexColourScale`, multiplied back here). A texture-free GLB converts exactly as before.
// Nothing here runs per frame; callers build templates at world build.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { dequantizeAttribute } from './characters/dequantize_attribute';
import { GFX, surfaceMat } from './gfx';

/** One merged mesh part: its geometry and the converted material it draws with. */
export interface VertexColourPart {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
}

/** A material converter with its own cache (cleared on a graphics-profile rebuild). */
export interface VertexColourMaterialConverter {
  convert(source: THREE.Material): THREE.Material;
  clear(): void;
}

/** Warm lantern panes and windows: the ferry's own glow (transport_ship.ts). */
export const VERTEX_COLOUR_GLOW_EMISSIVE = 0xff9a3c;

/** The factor a GLB material's vertex colours are multiplied back by: a painted material
 *  stores them under a headroom (so baked light can lift the paint above its map) and names
 *  the factor in its extras, which three's loader hands over as `userData`; 1 otherwise. */
export function vertexColourScaleOf(source: THREE.Material): number {
  const scale = (source.userData as { vertexColourScale?: unknown }).vertexColourScale;
  return typeof scale === 'number' && Number.isFinite(scale) && scale > 0 ? scale : 1;
}

export function vertexColourMaterialConverter(): VertexColourMaterialConverter {
  const cache = new Map<string, THREE.Material>();
  return {
    convert(source: THREE.Material): THREE.Material {
      const std = source as THREE.MeshStandardMaterial;
      const glow = /glow/i.test(source.name);
      // a painted material's maps (the shared GLB-cache textures, never mutated here); the
      // lambert tier draws no normal map
      const map = std.map ?? undefined;
      const normalMap = map && GFX.standardMaterials ? (std.normalMap ?? undefined) : undefined;
      const key = `${source.name}|${GFX.standardMaterials ? 's' : 'l'}|${map?.uuid ?? ''}`;
      const cached = cache.get(key);
      if (cached) return cached;
      const mat = surfaceMat({
        color: 0xffffff,
        vertexColors: true,
        map,
        normalMap,
        roughness: std.roughness ?? 0.85,
        metalness: std.metalness ?? 0,
        emissive: glow ? VERTEX_COLOUR_GLOW_EMISSIVE : 0x000000,
        emissiveIntensity: glow ? (GFX.standardMaterials ? 1.9 : 1.0) : 1,
      });
      if (map) {
        // surfaceMat keys on the map's uuid (one GLB file's own map), so these post-sets are the
        // same for every material that carries it: the vertex colours back above the headroom,
        // and the loader's normal scale (its y flipped for a mesh without tangents; the
        // default would light the relief upside down). Never on an untextured material: its
        // surfaceMat entry is shared with every other prop's of the same finish.
        (mat as THREE.MeshStandardMaterial).color.setScalar(vertexColourScaleOf(source));
        if (normalMap && std.normalScale && (mat as THREE.MeshStandardMaterial).normalScale) {
          (mat as THREE.MeshStandardMaterial).normalScale.copy(std.normalScale);
        }
      }
      cache.set(key, mat);
      return mat;
    },
    clear(): void {
      cache.clear();
    },
  };
}

/** The attributes a converted part draws with: a painted material's UVs as well. Every
 *  geometry filed under one material then has the same attributes (the merge needs it). */
const PLAIN_ATTRIBUTES = ['position', 'normal', 'color'] as const;
const PAINTED_ATTRIBUTES = ['position', 'normal', 'color', 'uv'] as const;

/** A mesh's position, normal and colour (dequantized), its UVs when its material is painted
 *  (carries a map), and its index, mapped by `frame`. */
export function vertexColourMeshGeometry(
  mesh: THREE.Mesh,
  frame: THREE.Matrix4,
): THREE.BufferGeometry {
  const src = mesh.geometry;
  const geo = new THREE.BufferGeometry();
  const painted = !!(mesh.material as THREE.MeshStandardMaterial).map;
  for (const attr of painted ? PAINTED_ATTRIBUTES : PLAIN_ATTRIBUTES) {
    const a = src.getAttribute(attr) as THREE.BufferAttribute | undefined;
    if (a) geo.setAttribute(attr, dequantizeAttribute(a));
  }
  if (src.index) geo.setIndex(src.index.clone());
  geo.applyMatrix4(frame);
  return geo;
}

/** File a geometry under its material. */
export function addToBucket(
  buckets: Map<THREE.Material, THREE.BufferGeometry[]>,
  material: THREE.Material,
  geometry: THREE.BufferGeometry,
): void {
  const list = buckets.get(material);
  if (list) list.push(geometry);
  else buckets.set(material, [geometry]);
}

/** One merged part per material (the merged-away sources are disposed). */
export function mergeVertexColourBuckets(
  buckets: Map<THREE.Material, THREE.BufferGeometry[]>,
): VertexColourPart[] {
  const parts: VertexColourPart[] = [];
  for (const [material, geos] of buckets) {
    const geometry = geos.length === 1 ? geos[0] : mergeGeometries(geos, false);
    if (!geometry) continue;
    for (const g of geos) if (g !== geometry) g.dispose();
    geometry.computeBoundingSphere();
    parts.push({ geometry, material });
  }
  return parts;
}

/** Set on a material whose colour already carries its factor (a clone carries it too). */
const VERTEX_COLOUR_SCALED = 'vertexColourScaleApplied';

/**
 * The painted materials of a parsed GLB that draws with its OWN materials (the Highwatch manor,
 * a placed town building: the town view clones them per building, eastbrook_placed_building.ts,
 * and an authored map draws them as they are) brought back above their headroom: each material
 * whose extras name a `vertexColourScale` has its colour (the glTF base colour factor)
 * multiplied by it, once however many meshes share it, and is marked so it never is again.
 * Runs in the loader's parse chain (assets/loader.ts) before any consumer sees the scene; a
 * converter that builds fresh materials reads the factor itself (vertexColourScaleOf). A GLB
 * with no such extras is untouched. Returns the number of materials scaled.
 */
export function applyVertexColourScale(root: THREE.Object3D): number {
  // a loader stub in a test may hand over a scene with no graph at all
  if (typeof root?.traverse !== 'function') return 0;
  let scaled = 0;
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      const mat = material as THREE.MeshStandardMaterial | undefined;
      if (!mat?.color || mat.userData[VERTEX_COLOUR_SCALED]) continue;
      const scale = vertexColourScaleOf(mat);
      if (scale === 1) continue;
      mat.color.multiplyScalar(scale);
      mat.userData[VERTEX_COLOUR_SCALED] = true;
      scaled++;
    }
  });
  return scaled;
}
