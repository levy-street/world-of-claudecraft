// The Blender-built Boulder Toss kit (public/models/vfx/balgath_boulder.glb): the hero
// boulder Balgath rips out of the fen, the chunks it shatters into, and the stone shards
// that spin in the Barrow Burden's dust vortex. Built by scripts/assets/balgath_boulder/
// (model.py plus its deterministic exporter) and pinned by tests/balgath_boulder_asset.test.ts.
//
// Loaded on the deferred world-content lane. Until it resolves (or if it fails, or in a
// Node test with no loader at all) every getter hands back a procedural stand-in with the
// SAME attribute set (position, normal, color), so the material that draws it links the
// same program either way and the first real boulder never relinks anything.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { loadGltf, releaseGltf } from './assets/loader';
import { registerDeferredPreload } from './assets/preload';

const BALGATH_BOULDER_KIT_URL = '/models/vfx/balgath_boulder.glb';

export const BALGATH_BOULDER_CHUNKS = 6;
export const BALGATH_BOULDER_SHARDS = 4;

/** Node names in the GLB, which ARE the asset contract. */
export const BALGATH_BOULDER_NODE = 'boulder';
export const balgathChunkNode = (i: number): string => `chunk_${i}`;
export const balgathShardNode = (i: number): string => `shard_${i}`;

const loaded = new Map<string, THREE.BufferGeometry>();
const fallback = new Map<string, THREE.BufferGeometry>();

if (typeof window !== 'undefined') {
  registerDeferredPreload(() =>
    loadGltf(BALGATH_BOULDER_KIT_URL)
      .then((gltf) => {
        gltf.scene.updateMatrixWorld(true);
        const names = [
          BALGATH_BOULDER_NODE,
          ...Array.from({ length: BALGATH_BOULDER_CHUNKS }, (_, i) => balgathChunkNode(i)),
          ...Array.from({ length: BALGATH_BOULDER_SHARDS }, (_, i) => balgathShardNode(i)),
        ];
        for (const name of names) {
          const node = gltf.scene.getObjectByName(name);
          if (!node) continue;
          const geometry = bakeNode(node);
          if (geometry) loaded.set(name, geometry);
        }
        releaseGltf(BALGATH_BOULDER_KIT_URL);
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
 * material reads, merged, and recentred on its own bounds. A shared preparation-owned
 * copy every spawn reuses and nothing disposes.
 */
function bakeNode(node: THREE.Object3D): THREE.BufferGeometry | null {
  const parts: THREE.BufferGeometry[] = [];
  node.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    const src = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry;
    // Plain floats FIRST: meshopt ships quantized, normalized integer attributes, and
    // baking a scale into those in place would clamp the rock to the unit cube.
    const part = new THREE.BufferGeometry();
    part.setAttribute('position', toFloat3(src.getAttribute('position')));
    const normal = src.getAttribute('normal');
    if (normal) part.setAttribute('normal', toFloat3(normal));
    const color = src.getAttribute('color');
    if (color && color.itemSize >= 3) part.setAttribute('color', toFloat3(color));
    part.applyMatrix4(mesh.matrixWorld);
    if (!normal) part.computeVertexNormals();
    if (!color) paintGranite(part, parts.length + 1);
    parts.push(part);
  });
  if (parts.length === 0) return null;
  const merged = parts.length === 1 ? parts[0] : mergeGeometries(parts, false);
  if (!merged) return null;
  merged.computeBoundingSphere();
  const c = merged.boundingSphere?.center;
  if (c) merged.translate(-c.x, -c.y, -c.z);
  merged.computeBoundingSphere();
  return merged;
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

/**
 * A vertex-coloured stand-in: moss on the upward faces, granite below, so even the
 * fallback reads as the same rock family rather than a grey ball.
 */
function paintGranite(geometry: THREE.BufferGeometry, salt: number): void {
  const pos = geometry.getAttribute('position');
  const colors = new Float32Array(pos.count * 3);
  const granite = new THREE.Color(0x7d766a);
  const dark = new THREE.Color(0x4a443b);
  const moss = new THREE.Color(0x5f7a3a);
  const tmp = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const n = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453;
    const grain = n - Math.floor(n);
    tmp.copy(granite).lerp(dark, grain * 0.5);
    if (y > 0.35) tmp.lerp(moss, Math.min(1, (y - 0.35) * 2.2));
    colors[i * 3] = tmp.r;
    colors[i * 3 + 1] = tmp.g;
    colors[i * 3 + 2] = tmp.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
}

function stand(name: string, build: () => THREE.BufferGeometry): THREE.BufferGeometry {
  const real = loaded.get(name);
  if (real) return real;
  let geo = fallback.get(name);
  if (!geo) {
    geo = build().toNonIndexed();
    // Exactly the loaded pieces' attribute set: position, normal, color.
    geo.deleteAttribute('uv');
    geo.computeVertexNormals();
    paintGranite(geo, name.length);
    fallback.set(name, geo);
  }
  return geo;
}

/** The hero boulder, unit bounding radius, centred. */
export function balgathBoulderGeometry(): THREE.BufferGeometry {
  return stand(BALGATH_BOULDER_NODE, () => new THREE.DodecahedronGeometry(1, 1));
}

/** One of the shatter chunks. */
export function balgathChunkGeometry(i: number): THREE.BufferGeometry {
  const k = ((i % BALGATH_BOULDER_CHUNKS) + BALGATH_BOULDER_CHUNKS) % BALGATH_BOULDER_CHUNKS;
  return stand(balgathChunkNode(k), () => new THREE.DodecahedronGeometry(0.28 + 0.03 * k, 0));
}

/** One of the thin vortex shards. */
export function balgathShardGeometry(i: number): THREE.BufferGeometry {
  const k = ((i % BALGATH_BOULDER_SHARDS) + BALGATH_BOULDER_SHARDS) % BALGATH_BOULDER_SHARDS;
  return stand(balgathShardNode(k), () => {
    const g = new THREE.TetrahedronGeometry(0.25, 0);
    g.scale(0.5, 1.6, 0.6);
    return g;
  });
}

export const balgathBoulderKitPreloadInternalsForTest = {
  url: BALGATH_BOULDER_KIT_URL,
};
