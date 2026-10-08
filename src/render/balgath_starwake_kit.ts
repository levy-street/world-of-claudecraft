// The Blender-built Starwake kit (public/models/vfx/balgath_starwake.glb): the glowing
// star crystals that split out of the fallen star in Balgath's crater, the lava gobbets a
// geyser throws, the cooling-crust plates floating on a molten pool, and the geyser
// column itself. Built by scripts/assets/balgath_starwake/ (model.py plus its
// deterministic exporter) and pinned by tests/balgath_starwake_asset.test.ts.
//
// Loaded on the deferred world-content lane. Until it resolves (or if it fails, or in a
// Node test with no loader at all) every getter hands back a procedural stand-in with the
// SAME attribute set (position, normal, color), so the material that draws it links the
// same program either way and the first real piece never relinks anything.
//
// Two pivots, matching the asset contract: the crystals and the column are BASE-anchored
// (lowest point on y = 0, bounding box centred in x and z) so the caller plants them on
// the ground; the chunks and crusts are centred so the caller spins them about the middle.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { loadGltf, releaseGltf } from './assets/loader';
import { registerDeferredPreload } from './assets/preload';

const BALGATH_STARWAKE_KIT_URL = '/models/vfx/balgath_starwake.glb';

export const BALGATH_STAR_CRYSTALS = 6;
export const BALGATH_LAVA_CHUNKS = 6;
export const BALGATH_POOL_CRUSTS = 4;

/** Node names in the GLB, which ARE the asset contract. */
const crystalNode = (i: number): string => `star_crystal_${i}`;
const chunkNode = (i: number): string => `lava_chunk_${i}`;
const crustNode = (i: number): string => `pool_crust_${i}`;
const COLUMN_NODE = 'geyser_column';

type Anchor = 'base' | 'centre';
type Paint = 'crystal' | 'chunk' | 'crust' | 'column';

const loaded = new Map<string, THREE.BufferGeometry>();
const fallback = new Map<string, THREE.BufferGeometry>();

const NODES: ReadonlyArray<{ name: string; anchor: Anchor; paint: Paint }> = [
  ...Array.from({ length: BALGATH_STAR_CRYSTALS }, (_, i) => ({
    name: crystalNode(i),
    anchor: 'base' as const,
    paint: 'crystal' as const,
  })),
  ...Array.from({ length: BALGATH_LAVA_CHUNKS }, (_, i) => ({
    name: chunkNode(i),
    anchor: 'centre' as const,
    paint: 'chunk' as const,
  })),
  ...Array.from({ length: BALGATH_POOL_CRUSTS }, (_, i) => ({
    name: crustNode(i),
    anchor: 'centre' as const,
    paint: 'crust' as const,
  })),
  { name: COLUMN_NODE, anchor: 'base', paint: 'column' },
];

if (typeof window !== 'undefined') {
  registerDeferredPreload(() =>
    loadGltf(BALGATH_STARWAKE_KIT_URL)
      .then((gltf) => {
        gltf.scene.updateMatrixWorld(true);
        for (const { name, anchor, paint } of NODES) {
          const node = gltf.scene.getObjectByName(name);
          if (!node) continue;
          const geometry = bakeNode(node, anchor, paint);
          if (geometry) loaded.set(name, geometry);
        }
        releaseGltf(BALGATH_STARWAKE_KIT_URL);
      })
      // A cosmetic kit must never fail world entry: on any load or bake failure the
      // getters below keep handing out the procedural stand-ins.
      .catch(() => undefined),
  );
}

/**
 * One piece as a single draw: every child mesh of the node (a multi-material piece loads
 * as a Group of meshes) with its node transform baked in (meshopt quantization parks a
 * scale and offset on every node), reduced to the three attributes the vertex-coloured
 * material reads, merged, and re-anchored (base on y = 0 or centred). A shared
 * preparation-owned copy every spawn reuses and nothing disposes.
 */
function bakeNode(node: THREE.Object3D, anchor: Anchor, paint: Paint): THREE.BufferGeometry | null {
  const parts: THREE.BufferGeometry[] = [];
  node.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    const src = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry;
    // Plain floats FIRST: meshopt ships quantized, normalized integer attributes, and
    // baking a scale into those in place would clamp the piece to the unit cube.
    const part = new THREE.BufferGeometry();
    part.setAttribute('position', toFloat3(src.getAttribute('position')));
    const normal = src.getAttribute('normal');
    if (normal) part.setAttribute('normal', toFloat3(normal));
    const color = src.getAttribute('color');
    if (color && color.itemSize >= 3) part.setAttribute('color', toFloat3(color));
    part.applyMatrix4(mesh.matrixWorld);
    if (!normal) part.computeVertexNormals();
    if (!color) paintPiece(part, paint, parts.length + 1);
    parts.push(part);
  });
  if (parts.length === 0) return null;
  const merged = parts.length === 1 ? parts[0] : mergeGeometries(parts, false);
  if (!merged) return null;
  anchorGeometry(merged, anchor);
  return merged;
}

/** Base: lowest point to y = 0, bounding box centred in x and z. Centre: bounding sphere
 *  centre to the origin. */
function anchorGeometry(geometry: THREE.BufferGeometry, anchor: Anchor): void {
  if (anchor === 'base') {
    geometry.computeBoundingBox();
    const box = geometry.boundingBox;
    if (box) {
      geometry.translate(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2);
    }
  } else {
    geometry.computeBoundingSphere();
    const c = geometry.boundingSphere?.center;
    if (c) geometry.translate(-c.x, -c.y, -c.z);
  }
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
}

/** Any (possibly quantized, normalized, interleaved) vec attribute as plain float xyz. */
function toFloat3(
  attr: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
): THREE.BufferAttribute {
  const out = new Float32Array(attr.count * 3);
  for (let i = 0; i < attr.count; i++) {
    out[i * 3] = attr.getX(i);
    out[i * 3 + 1] = attr.getY(i);
    out[i * 3 + 2] = attr.getZ(i);
  }
  return new THREE.BufferAttribute(out, 3);
}

// The same ramps the factory paints, so a stand-in reads as the same family.
const STAR_RAMP: ReadonlyArray<readonly [number, number]> = [
  [0, 0xa8280c],
  [0.18, 0xe0561a],
  [0.5, 0xffa02a],
  [0.8, 0xffd877],
  [1, 0xfff6da],
];
const COLUMN_RAMP: ReadonlyArray<readonly [number, number]> = [
  [0, 0xfff4b8],
  [0.14, 0xffd650],
  [0.4, 0xff8a1c],
  [0.66, 0xe0480e],
  [0.84, 0x9a2a0e],
  [1, 0x5a2012],
];
const BASALT = new THREE.Color(0x2a201b);
const BASALT_DARK = new THREE.Color(0x17110e);
const EMBER = new THREE.Color(0xff7a14);
const EMBER_HOT = new THREE.Color(0xffc23a);

function rampColor(stops: ReadonlyArray<readonly [number, number]>, t: number, out: THREE.Color) {
  const u = Math.min(1, Math.max(0, t));
  for (let k = 0; k < stops.length - 1; k++) {
    const [t0, c0] = stops[k];
    const [t1, c1] = stops[k + 1];
    if (u <= t1) {
      out.setHex(c0).lerp(new THREE.Color(c1), (u - t0) / Math.max(1e-6, t1 - t0));
      return;
    }
  }
  out.setHex(stops[stops.length - 1][1]);
}

/**
 * A vertex-coloured stand-in painter per piece family: the crystal and column ramps by
 * height, basalt with hashed glowing cracks on a chunk, and a dark crust with a glowing
 * rim on a pool plate.
 */
function paintPiece(geometry: THREE.BufferGeometry, paint: Paint, salt: number): void {
  const pos = geometry.getAttribute('position');
  geometry.computeBoundingBox();
  const box =
    geometry.boundingBox ?? new THREE.Box3(new THREE.Vector3(), new THREE.Vector3(1, 1, 1));
  const height = Math.max(1e-6, box.max.y - box.min.y);
  const halfX = Math.max(1e-6, (box.max.x - box.min.x) / 2);
  const halfZ = Math.max(1e-6, (box.max.z - box.min.z) / 2);
  const colors = new Float32Array(pos.count * 3);
  const tmp = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const n = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453;
    const grain = n - Math.floor(n);
    if (paint === 'crystal') {
      rampColor(STAR_RAMP, (y - box.min.y) / height, tmp);
    } else if (paint === 'column') {
      rampColor(COLUMN_RAMP, (y - box.min.y) / height, tmp);
    } else if (paint === 'chunk') {
      tmp.copy(BASALT).lerp(BASALT_DARK, grain * 0.6);
      if (grain > 0.72) tmp.copy(EMBER).lerp(EMBER_HOT, (grain - 0.72) / 0.28);
    } else {
      const rim = Math.hypot(x / halfX, z / halfZ);
      tmp.copy(BASALT).lerp(BASALT_DARK, grain * 0.5);
      if (rim > 0.82) tmp.lerp(EMBER, Math.min(1, (rim - 0.82) / 0.15));
      if (y < box.min.y + height * 0.3) tmp.copy(EMBER);
    }
    colors[i * 3] = tmp.r;
    colors[i * 3 + 1] = tmp.g;
    colors[i * 3 + 2] = tmp.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
}

function stand(
  name: string,
  anchor: Anchor,
  paint: Paint,
  build: () => THREE.BufferGeometry,
): THREE.BufferGeometry {
  const real = loaded.get(name);
  if (real) return real;
  let geo = fallback.get(name);
  if (!geo) {
    geo = build().toNonIndexed();
    // Exactly the loaded pieces' attribute set: position, normal, color.
    geo.deleteAttribute('uv');
    geo.computeVertexNormals();
    anchorGeometry(geo, anchor);
    paintPiece(geo, paint, name.length);
    fallback.set(name, geo);
  }
  return geo;
}

const wrap = (i: number, n: number): number => ((i % n) + n) % n;

// Stand-in sizes follow the factory's per-index specs closely enough that a swap from
// stand-in to real asset does not visibly jump.
const CRYSTAL_HEIGHTS = [1.55, 0.9, 1.22, 0.62, 1.36, 0.78];
const CRYSTAL_RATIOS = [0.2, 0.27, 0.22, 0.33, 0.19, 0.3];
const CHUNK_RADII = [0.44, 0.4, 0.36, 0.32, 0.29, 0.26];
const CRUST_SPECS: ReadonlyArray<readonly [number, number, number]> = [
  [1.24, 0.12, 1.35],
  [1.04, 0.09, 1.15],
  [0.94, 0.07, 1.5],
  [1.14, 0.11, 1.25],
];

/** One of the star crystals: base at y = 0 (NOT recentred), growing up +Y. */
export function balgathStarCrystalGeometry(i: number): THREE.BufferGeometry {
  const k = wrap(i, BALGATH_STAR_CRYSTALS);
  return stand(crystalNode(k), 'base', 'crystal', () => {
    const h = CRYSTAL_HEIGHTS[k];
    return new THREE.ConeGeometry(CRYSTAL_RATIOS[k] * h * 0.5, h, k % 2 === 0 ? 6 : 5, 3);
  });
}

/** One of the lava gobbets a geyser throws, centred. */
export function balgathLavaChunkGeometry(i: number): THREE.BufferGeometry {
  const k = wrap(i, BALGATH_LAVA_CHUNKS);
  return stand(
    chunkNode(k),
    'centre',
    'chunk',
    () => new THREE.DodecahedronGeometry(CHUNK_RADII[k], 0),
  );
}

/** One of the cooling-crust plates, centred and lying flat in the XZ plane. */
export function balgathPoolCrustGeometry(i: number): THREE.BufferGeometry {
  const k = wrap(i, BALGATH_POOL_CRUSTS);
  return stand(crustNode(k), 'centre', 'crust', () => {
    const [length, thickness, elong] = CRUST_SPECS[k];
    const r = length / (2 * elong);
    const g = new THREE.CylinderGeometry(r * 0.93, r, thickness, 14, 1);
    g.scale(elong, 1, 1);
    return g;
  });
}

/** The geyser column: base at y = 0, height 1 (the caller scales it). */
export function balgathGeyserColumnGeometry(): THREE.BufferGeometry {
  return stand(COLUMN_NODE, 'base', 'column', () => {
    const profile: ReadonlyArray<readonly [number, number]> = [
      [0.5, 0],
      [0.38, 0.16],
      [0.28, 0.46],
      [0.25, 0.62],
      [0.36, 0.8],
      [0.37, 0.87],
      [0.22, 0.97],
      [0, 1],
    ];
    return new THREE.LatheGeometry(
      profile.map(([r, y]) => new THREE.Vector2(r, y)),
      16,
    );
  });
}

export const balgathStarwakeKitPreloadInternalsForTest = {
  url: BALGATH_STARWAKE_KIT_URL,
};
