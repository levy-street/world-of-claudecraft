// The shared plumbing of the Blender-built, vertex-coloured props (the harbor route
// markers, harbor_route_markers.ts, and the Wyrmwatch cliff harbor, wyrmwatch_harbor.ts):
// convert a GLB material into the surface family's vertex-coloured standard/lambert
// material (a "glow" material becomes the warm lantern emissive), read one mesh's
// geometry dequantized into a chosen frame, and merge the collected geometries into one
// mesh part per material. Extracted at the second vertex-coloured prop (the rule of
// three: the ship's converter, transport_ship.ts, buckets by attribute layout too).
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

export function vertexColourMaterialConverter(): VertexColourMaterialConverter {
  const cache = new Map<string, THREE.Material>();
  return {
    convert(source: THREE.Material): THREE.Material {
      const std = source as THREE.MeshStandardMaterial;
      const glow = /glow/i.test(source.name);
      const key = `${source.name}|${GFX.standardMaterials ? 's' : 'l'}`;
      const cached = cache.get(key);
      if (cached) return cached;
      const mat = surfaceMat({
        color: 0xffffff,
        vertexColors: true,
        roughness: std.roughness ?? 0.85,
        metalness: std.metalness ?? 0,
        emissive: glow ? VERTEX_COLOUR_GLOW_EMISSIVE : 0x000000,
        emissiveIntensity: glow ? (GFX.standardMaterials ? 1.9 : 1.0) : 1,
      });
      cache.set(key, mat);
      return mat;
    },
    clear(): void {
      cache.clear();
    },
  };
}

/** A mesh's position, normal and colour (dequantized) and its index, mapped by `frame`. */
export function vertexColourMeshGeometry(
  mesh: THREE.Mesh,
  frame: THREE.Matrix4,
): THREE.BufferGeometry {
  const src = mesh.geometry;
  const geo = new THREE.BufferGeometry();
  for (const attr of ['position', 'normal', 'color'] as const) {
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
