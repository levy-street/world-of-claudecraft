// The painted kits' shared baker (the Hammer vein's, hammer_env_kit.ts, the Breath's,
// breath_env_kit.ts, and the Quench's, quench_env_kit.ts): every Env_* or Tex_* node of a
// painted kit's GLB baked once into one
// merged geometry per painting (the painting a node's material draws), and a plan
// instanced over the baked pieces, one InstancedMesh per piece, culling cell, shadow
// class and painting. Each kit keeps its own pieces, paintings and materials; this is
// only the arithmetic they share.

import * as THREE from 'three';
import { markSharedGeometry } from '../shared_resource';
import { heartKitPlacementMatrix } from './heart_kit';
import type { HeartKitPlacement } from './heart_kit_core';

/** One baked piece: painting name to its merged geometry. */
export interface EnvBaked {
  parts: Map<string, THREE.BufferGeometry>;
}

/** Is this node a painted kit's piece (an Env_* or Tex_* node not inside another)? */
export function isEnvPieceNode(node: THREE.Object3D): boolean {
  return /^(Env|Tex)_/.test(node.name) && !/^(Env|Tex)_/.test(node.parent?.name ?? '');
}

/** Merge a piece's meshes of one painting into one indexed geometry. */
export function mergeEnvParts(list: readonly THREE.BufferGeometry[]): THREE.BufferGeometry {
  let count = 0;
  let indices = 0;
  for (const g of list) {
    count += g.attributes.position.count;
    indices += g.index ? g.index.count : g.attributes.position.count;
  }
  const pos = new Float32Array(count * 3);
  const nor = new Float32Array(count * 3);
  const uv = new Float32Array(count * 2);
  const index = count > 65535 ? new Uint32Array(indices) : new Uint16Array(indices);
  let o = 0;
  let io = 0;
  for (const g of list) {
    const n = g.attributes.position.count;
    pos.set(g.attributes.position.array as Float32Array, o * 3);
    nor.set(g.attributes.normal.array as Float32Array, o * 3);
    if (g.attributes.uv) uv.set(g.attributes.uv.array as Float32Array, o * 2);
    if (g.index) {
      const src = g.index.array;
      for (let k = 0; k < src.length; k++) index[io++] = src[k] + o;
    } else {
      for (let k = 0; k < n; k++) index[io++] = o + k;
    }
    o += n;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setIndex(new THREE.BufferAttribute(index, 1));
  out.computeBoundingSphere();
  return out;
}

/** Bake one piece node: its meshes in the piece's own frame, merged per painting
 *  (`paintingOf` names a material's painting). Each painting's map is handed to
 *  `onMap` the first time it is seen, for the kit's own store. */
export function bakeEnvNode(
  node: THREE.Object3D,
  paintingOf: (materialName: string) => string,
  onMap: (painting: string, map: THREE.Texture) => void,
): EnvBaked {
  node.updateWorldMatrix(true, true);
  const groups = new Map<string, THREE.BufferGeometry[]>();
  node.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const mat = Array.isArray(child.material) ? child.material[0] : child.material;
    const painting = paintingOf(mat?.name ?? '');
    const map = (mat as THREE.MeshStandardMaterial).map;
    if (map) onMap(painting, map);
    const geometry = new THREE.BufferGeometry();
    for (const name of ['position', 'normal', 'uv']) {
      const attr = child.geometry.getAttribute(name);
      if (!attr) continue;
      const values = new Float32Array(attr.count * attr.itemSize);
      for (let i = 0; i < attr.count; i++)
        for (let j = 0; j < attr.itemSize; j++)
          values[i * attr.itemSize + j] = attr.getComponent(i, j);
      geometry.setAttribute(name, new THREE.BufferAttribute(values, attr.itemSize));
    }
    if (child.geometry.index) geometry.setIndex(child.geometry.index.clone());
    geometry.applyMatrix4(child.matrixWorld);
    if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
    const list = groups.get(painting) ?? [];
    list.push(geometry);
    groups.set(painting, list);
  });
  const parts = new Map<string, THREE.BufferGeometry>();
  for (const [painting, list] of groups) {
    parts.set(painting, markSharedGeometry(mergeEnvParts(list)));
    for (const g of list) g.dispose();
  }
  return { parts };
}

/** How one painting's instances cast and take the sun's shadow. */
export interface EnvShadowRule {
  casts: (painting: string) => boolean;
  receives: (painting: string) => boolean;
}

const tmp = new THREE.Matrix4();

/** Instance a plan over a kit's baked pieces: one InstancedMesh per piece, culling cell,
 *  shadow class and painting. A placement whose piece did not bake is skipped; the low
 *  tier sheds the cosmetic ones. */
export function instanceEnvPieces(
  baked: ReadonlyMap<string, EnvBaked>,
  materialOf: (painting: string) => THREE.Material,
  list: readonly HeartKitPlacement[],
  lowGfx: boolean,
  name: string,
  cell: number,
  shadow: EnvShadowRule,
): THREE.Group {
  const group = new THREE.Group();
  group.name = name;
  const buckets = new Map<string, HeartKitPlacement[]>();
  for (const p of list) {
    if (lowGfx && p.cosmetic) continue;
    if (!baked.has(p.piece)) continue;
    const key = `${p.piece}|${Math.floor(p.x / cell)}|${Math.floor(p.z / cell)}|${p.noShadow ? 1 : 0}`;
    const bucket = buckets.get(key) ?? [];
    bucket.push(p);
    buckets.set(key, bucket);
  }
  for (const bucket of buckets.values()) {
    const piece = baked.get(bucket[0].piece);
    if (!piece) continue;
    const casts = !lowGfx && !bucket[0].noShadow;
    for (const [painting, g] of piece.parts) {
      const mesh = new THREE.InstancedMesh(g, materialOf(painting), bucket.length);
      mesh.name = `${bucket[0].piece}:${painting}`;
      for (const [i, p] of bucket.entries()) mesh.setMatrixAt(i, heartKitPlacementMatrix(p, tmp));
      mesh.instanceMatrix.needsUpdate = true;
      mesh.castShadow = casts && shadow.casts(painting);
      mesh.receiveShadow = shadow.receives(painting);
      mesh.computeBoundingSphere();
      mesh.matrixAutoUpdate = false;
      group.add(mesh);
    }
  }
  return group;
}

let warmGeometry: THREE.BufferGeometry | null = null;

/** One hidden instanced triangle per painting, on that painting's material: a kit's
 *  program warmers (the pieces' own variant), built with the interior so a late kit
 *  build brings no unlinked program or unuploaded painting into a live frame. */
export function envWarmCarriers(
  paintings: Iterable<string>,
  materialOf: (painting: string) => THREE.Material,
  shadow: EnvShadowRule,
  prefix: string,
): THREE.InstancedMesh[] {
  if (!warmGeometry) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(9), 3));
    g.setAttribute(
      'normal',
      new THREE.BufferAttribute(new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0]), 3),
    );
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(6), 2));
    g.setIndex(new THREE.BufferAttribute(new Uint16Array([0, 1, 2]), 1));
    warmGeometry = markSharedGeometry(g);
  }
  const out: THREE.InstancedMesh[] = [];
  for (const painting of paintings) {
    const mesh = new THREE.InstancedMesh(warmGeometry, materialOf(painting), 1);
    mesh.castShadow = shadow.casts(painting);
    mesh.receiveShadow = shadow.receives(painting);
    mesh.visible = false;
    mesh.frustumCulled = false;
    mesh.name = `${prefix}:${painting}`;
    out.push(mesh);
  }
  return out;
}
