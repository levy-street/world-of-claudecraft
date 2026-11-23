// FORK: the baked cave cache (SPACEY, 2026-09-12: "a button to bake the cave
// you have dug into the map so it treats it like normal terrain").
//
// A carve interior is marched from its field on demand: on load, on every
// edit, and on every camera-LOD ring change as the maker moves about. That
// marching is what makes a dug map feel slower than an undug one. Baking
// pre-builds every tile at every LOD ring ONCE, keeps the decimated geometry
// here, and mirrors it into the map document (MapDoc.caveBake) as quantized
// bytes, so a ring change or a reload rebuilds the mesh from bytes instead
// of the field. An edit invalidates only the tiles its region touches; those
// tiles march again until the next bake.
//
// Storage per vertex: position as Int16 in 1/2048 yd relative to the tile
// origin (a 16-yd tile spans 32768 steps), normal as Int8, the grey depth
// tint as one Uint8 in 1/200. UVs are NOT stored: they are a pure function of
// position and normal (dominant axis), recomputed on rebuild.

import type { CaveBakeTile } from '../sim/map_doc';
import type { CavityMeshArrays } from './cut_cavity_core';

export const BAKE_POS_UNIT = 1 / 2048;
export const BAKE_TINT_UNIT = 1 / 200;

interface BakeEntry {
  x0: number;
  y0: number;
  z0: number;
  arrays: CavityMeshArrays;
  /** The document record, encoded once on the first serialize. */
  rec?: CaveBakeTile;
}

const cache = new Map<string, BakeEntry>();
let cacheGen = 0; // bumped on every change; the doc mirror compares it
let mirroredGen = -1;
let loadedFrom: readonly CaveBakeTile[] | null = null;

/** Cached geometry for a tile key, or null. */
export function cavityBakeGet(key: string): CavityMeshArrays | null {
  return cache.get(key)?.arrays ?? null;
}

export function cavityBakeHas(key: string): boolean {
  return cache.has(key);
}

/** Store a marched tile. Only the bake pass and cache-miss rebuilds after a
 *  bake call this (an unbaked map never grows a cache on its own). */
export function cavityBakeStore(
  key: string,
  origin: { x0: number; y0: number; z0: number },
  arrays: CavityMeshArrays,
): void {
  cache.set(key, { x0: origin.x0, y0: origin.y0, z0: origin.z0, arrays });
  cacheGen++;
}

/** True once the map has any baked tile: the mesher then caches every tile
 *  it marches (a cache miss after an edit heals itself). */
export function cavityBakeActive(): boolean {
  return cache.size > 0;
}

/** Drop every cached tile whose box touches the edited region (world yards,
 *  xz). Returns how many went. */
export function cavityBakeInvalidate(
  region: { minX: number; minZ: number; maxX: number; maxZ: number },
  tile: number,
  pad: number,
): number {
  let n = 0;
  for (const [key, e] of cache) {
    const minX = e.x0 - pad;
    const maxX = e.x0 + tile + pad;
    const minZ = e.z0 - pad;
    const maxZ = e.z0 + tile + pad;
    if (minX <= region.maxX && maxX >= region.minX && minZ <= region.maxZ && maxZ >= region.minZ) {
      cache.delete(key);
      n++;
    }
  }
  if (n > 0) cacheGen++;
  return n;
}

export function cavityBakeClear(): void {
  if (cache.size === 0) return;
  cache.clear();
  cacheGen++;
}

export function cavityBakeStats(): { tiles: number; bytes: number } {
  let bytes = 0;
  for (const e of cache.values()) {
    const a = e.arrays;
    bytes +=
      (a.positions.length / 3) * 10 + a.indices.length * (a.positions.length / 3 > 65535 ? 4 : 2);
  }
  return { tiles: cache.size, bytes };
}

/** Has the cache changed since the last serialize()? */
export function cavityBakeDirty(): boolean {
  return cacheGen !== mirroredGen;
}

// ---- codec ----------------------------------------------------------------

function bytesToBase64(bytes: Uint8Array): string {
  let s = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK) as unknown as number[]);
  }
  return btoa(s);
}

function base64ToBytes(text: string): Uint8Array | null {
  try {
    const s = atob(text);
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

/** One tile's arrays as a document record. */
export function encodeBakeTile(
  key: string,
  origin: { x0: number; y0: number; z0: number },
  a: CavityMeshArrays,
): CaveBakeTile {
  const n = a.positions.length / 3;
  const pos = new Int16Array(n * 3);
  const nrm = new Int8Array(n * 3);
  const col = new Uint8Array(n);
  for (let v = 0; v < n; v++) {
    pos[v * 3] = Math.round((a.positions[v * 3] - origin.x0) / BAKE_POS_UNIT);
    pos[v * 3 + 1] = Math.round((a.positions[v * 3 + 1] - origin.y0) / BAKE_POS_UNIT);
    pos[v * 3 + 2] = Math.round((a.positions[v * 3 + 2] - origin.z0) / BAKE_POS_UNIT);
    nrm[v * 3] = Math.round(Math.max(-1, Math.min(1, a.normals[v * 3])) * 127);
    nrm[v * 3 + 1] = Math.round(Math.max(-1, Math.min(1, a.normals[v * 3 + 1])) * 127);
    nrm[v * 3 + 2] = Math.round(Math.max(-1, Math.min(1, a.normals[v * 3 + 2])) * 127);
    col[v] = Math.round(
      Math.max(0, Math.min(255 * BAKE_TINT_UNIT, a.colors[v * 3])) / BAKE_TINT_UNIT,
    );
  }
  const wide = n > 65535;
  const idx = wide ? new Uint32Array(a.indices) : new Uint16Array(a.indices);
  return {
    key,
    x0: origin.x0,
    y0: origin.y0,
    z0: origin.z0,
    n,
    t: a.indices.length,
    pos: bytesToBase64(new Uint8Array(pos.buffer)),
    nrm: bytesToBase64(new Uint8Array(nrm.buffer)),
    col: bytesToBase64(col),
    idx: bytesToBase64(new Uint8Array(idx.buffer)),
  };
}

function dominantUvs(positions: Float32Array, normals: Float32Array): Float32Array {
  const n = positions.length / 3;
  const uvs = new Float32Array(n * 2);
  for (let v = 0; v < n; v++) {
    const px = positions[v * 3];
    const py = positions[v * 3 + 1];
    const pz = positions[v * 3 + 2];
    const nxa = Math.abs(normals[v * 3]);
    const nya = Math.abs(normals[v * 3 + 1]);
    const nza = Math.abs(normals[v * 3 + 2]);
    if (nya >= nxa && nya >= nza) {
      uvs[v * 2] = px;
      uvs[v * 2 + 1] = pz;
    } else if (nxa >= nza) {
      uvs[v * 2] = pz;
      uvs[v * 2 + 1] = py;
    } else {
      uvs[v * 2] = px;
      uvs[v * 2 + 1] = py;
    }
  }
  return uvs;
}

/** A document record back to arrays; null when the bytes do not add up. */
export function decodeBakeTile(rec: CaveBakeTile): BakeEntry | null {
  const n = rec.n | 0;
  const t = rec.t | 0;
  if (n < 0 || t < 0 || t % 3 !== 0) return null;
  const posB = base64ToBytes(rec.pos);
  const nrmB = base64ToBytes(rec.nrm);
  const colB = base64ToBytes(rec.col);
  const idxB = base64ToBytes(rec.idx);
  if (!posB || !nrmB || !colB || !idxB) return null;
  const wide = n > 65535;
  if (
    posB.length !== n * 6 ||
    nrmB.length !== n * 3 ||
    colB.length !== n ||
    idxB.length !== t * (wide ? 4 : 2)
  ) {
    return null;
  }
  const pos = new Int16Array(posB.buffer, posB.byteOffset, n * 3);
  const nrm = new Int8Array(nrmB.buffer, nrmB.byteOffset, n * 3);
  const idxSrc = wide
    ? new Uint32Array(idxB.buffer.slice(idxB.byteOffset, idxB.byteOffset + t * 4))
    : new Uint16Array(idxB.buffer.slice(idxB.byteOffset, idxB.byteOffset + t * 2));
  const positions = new Float32Array(n * 3);
  const normals = new Float32Array(n * 3);
  const colors = new Float32Array(n * 3);
  for (let v = 0; v < n; v++) {
    positions[v * 3] = rec.x0 + pos[v * 3] * BAKE_POS_UNIT;
    positions[v * 3 + 1] = rec.y0 + pos[v * 3 + 1] * BAKE_POS_UNIT;
    positions[v * 3 + 2] = rec.z0 + pos[v * 3 + 2] * BAKE_POS_UNIT;
    normals[v * 3] = nrm[v * 3] / 127;
    normals[v * 3 + 1] = nrm[v * 3 + 1] / 127;
    normals[v * 3 + 2] = nrm[v * 3 + 2] / 127;
    const tint = colB[v] * BAKE_TINT_UNIT;
    colors[v * 3] = tint;
    colors[v * 3 + 1] = tint;
    colors[v * 3 + 2] = tint;
  }
  const indices = new Uint32Array(t);
  for (let i = 0; i < t; i++) {
    const ix = idxSrc[i];
    if (ix >= n) return null;
    indices[i] = ix;
  }
  return {
    x0: rec.x0,
    y0: rec.y0,
    z0: rec.z0,
    // a baked tile is final: its collar (if any) needs no protection downstream
    arrays: {
      positions,
      normals,
      colors,
      uvs: dominantUvs(positions, normals),
      indices,
      collarVertexStart: n,
    },
  };
}

/** The whole cache as document records (the doc mirror). Records are encoded
 *  once per tile and kept, so a sync after an edit costs only the new tiles. */
export function cavityBakeSerialize(): CaveBakeTile[] {
  const out: CaveBakeTile[] = [];
  for (const [key, e] of cache) {
    if (!e.rec) e.rec = encodeBakeTile(key, e, e.arrays);
    out.push(e.rec);
  }
  mirroredGen = cacheGen;
  return out;
}

/** Replace the cache with a document's records (a map load). Idempotent on
 *  the same array, so the world binder can call it on every rebind. */
export function cavityBakeLoad(tiles: readonly CaveBakeTile[] | null | undefined): number {
  if (tiles === loadedFrom) return cache.size;
  loadedFrom = tiles ?? null;
  cache.clear();
  if (tiles) {
    for (const rec of tiles) {
      const e = decodeBakeTile(rec);
      if (e) {
        e.rec = rec;
        cache.set(rec.key, e);
      }
    }
  }
  cacheGen++;
  mirroredGen = cacheGen;
  return cache.size;
}
