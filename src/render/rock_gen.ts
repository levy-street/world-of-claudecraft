// Procedural rock/boulder generator for the editor's Rock tool (placement
// path 'procedural://rock'). A displaced icosphere: deterministic seeded value
// noise pushes every vertex in or out, so the same placement regenerates the
// exact same mesh on reload; the sliders shape it (noise amount, feature
// detail, sharpness, jaggedness, height, texture). Per-axis placement scale
// (the gizmo) stretches rocks into slabs/cliff plates, and material overrides
// (tint/opacity) work through the ordinary placed-assets pipeline.
//
// The MERGED ridge builder (path 'procedural://rock-ridge') lofts one
// continuous displaced tube along a smoothed node chain instead of piling
// overlapping boulders: a single solid body with per-node girth/height.

import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { hash2 } from '../sim/rng';
import { acquireTexture } from './assets/loader';
import { terrainTexturePath, terrainTextureSet } from './terrain_texture_sets';
import { stoneMaps } from './textures';

// Base icosphere detail: 20*(SUBDIVISIONS+1)^2 faces (720 at 5).
const SUBDIVISIONS = 5;
// Displacement amplitude range (fraction of the unit radius) over rockNoise.
const AMP_MIN = 0.08;
const AMP_MAX = 0.55;
// Noise frequency range over rockDetail (features per unit).
const FREQ_MIN = 1.2;
const FREQ_MAX = 4.2;
// Jaggedness: ridged high-frequency octave (creased spikes), amplitude at 1.
const JAG_AMP = 0.34;
const JAG_FREQ_MULT = 5.3;

export interface RockParams {
  rockSeed?: number;
  rockNoise?: number;
  rockDetail?: number;
  rockSharp?: number;
  rockTex?: number;
  rockHeight?: number;
  rockDepth?: number;
  rockJag?: number;
  rockTexId?: string;
  /** Texture tile size in yards per repeat (texture sets default to 28). */
  rockTexTile?: number;
  /** Approximate placed world diameter in yards (placed_assets passes
   *  2.4 * placement scale) so tile sizes are physical, not per-mesh. */
  worldSize?: number;
}

export interface RockChainNode {
  dx: number;
  dz: number;
  dy: number;
  r: number;
  h: number;
}

/** Deterministic default seed for a rock anchored at (x, z). */
export function rockSeed(x: number, z: number): number {
  return Math.round(hash2(Math.round(x * 10), Math.round(z * 10), 977) * 1e9);
}

// 3D value noise from the sim's deterministic hash (trilinear interpolation).
function vnoise3(x: number, y: number, z: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fy = y - iy;
  const fz = z - iz;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const sz = fz * fz * (3 - 2 * fz);
  const h = (a: number, b: number, c: number): number => hash2(a + 131 * c, b, seed);
  const c00 = h(ix, iy, iz) + (h(ix + 1, iy, iz) - h(ix, iy, iz)) * sx;
  const c10 = h(ix, iy + 1, iz) + (h(ix + 1, iy + 1, iz) - h(ix, iy + 1, iz)) * sx;
  const c01 = h(ix, iy, iz + 1) + (h(ix + 1, iy, iz + 1) - h(ix, iy, iz + 1)) * sx;
  const c11 = h(ix, iy + 1, iz + 1) + (h(ix + 1, iy + 1, iz + 1) - h(ix, iy + 1, iz + 1)) * sx;
  const c0 = c00 + (c10 - c00) * sy;
  const c1 = c01 + (c11 - c01) * sy;
  return c0 + (c1 - c0) * sz; // [0, 1)
}

/** The combined displacement field every rock surface samples: billowy base
 *  noise, sharpness ridging, plus the jaggedness octave (high-frequency
 *  creases). Returns a signed offset in [-~1.4, ~1.4] before amplitude. */
function rockField(
  x: number,
  y: number,
  z: number,
  seed: number,
  freq: number,
  sharp: number,
  jag: number,
): number {
  let n =
    vnoise3(x * freq + 7.1, y * freq + 3.7, z * freq + 9.3, seed) * 0.68 +
    vnoise3(x * freq * 2.3, y * freq * 2.3, z * freq * 2.3, seed + 17) * 0.32;
  n = n * 2 - 1; // [-1, 1]
  // Sharpness ridges the noise: creases instead of billows.
  if (sharp > 0) n = n * (1 - sharp) + (1 - 2 * Math.abs(n)) * sharp * 0.9;
  // Jaggedness: an extra ridged octave of spiky creases on top.
  if (jag > 0) {
    const f = freq * JAG_FREQ_MULT;
    const rj = 1 - 2 * Math.abs(vnoise3(x * f + 3.3, y * f + 8.9, z * f + 1.7, seed + 71) - 0.5);
    n += (rj * 2 - 1) * jag * JAG_AMP * 2;
  }
  return n;
}

// Shared materials per texture option, cloned per entry only when a placement
// sets tint/opacity overrides (the placed-assets pipeline handles that).
const rockMats = new Map<string, THREE.MeshStandardMaterial>();
// Texture release handles per library-set material, so a GC can hand the maps'
// VRAM back once no placement uses the set (disposeUnusedRockGroundMats).
const rockMatReleases = new Map<string, (() => void)[]>();

function rockMaterial(tex: number, texId?: string): THREE.MeshStandardMaterial {
  // A built-in terrain texture set overrides the legacy numeric options.
  const set = texId ? terrainTextureSet(texId) : null;
  if (set) {
    const key = `set:${set.key}`;
    let m = rockMats.get(key);
    if (m) return m;
    m = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      vertexColors: true,
      roughness: 0.95,
      metalness: 0,
    });
    // Maps stream in and upgrade the material in place (cave_mesh pattern);
    // reference-counted so the GC below can free them when the set falls unused.
    const mat = m;
    const releases: (() => void)[] = [];
    const assign = (
      slot: 'map' | 'normalMap' | 'roughnessMap' | 'aoMap',
      kind: 'color' | 'normal' | 'rough' | 'ao',
      srgb: boolean,
    ): void => {
      const path = terrainTexturePath(set.key, kind);
      if (!path) return;
      const { texture, release } = acquireTexture(`/${path}`, { srgb, repeat: true });
      releases.push(release);
      void texture
        .then((t) => {
          mat[slot] = t;
          mat.needsUpdate = true;
        })
        .catch(() => {});
    };
    assign('map', 'color', true);
    assign('normalMap', 'normal', false);
    assign('roughnessMap', 'rough', false);
    assign('aoMap', 'ao', false);
    rockMats.set(key, m);
    rockMatReleases.set(key, releases);
    return m;
  }
  const key = `n:${Math.max(0, Math.min(2, Math.round(tex)))}`;
  let m = rockMats.get(key);
  if (m) return m;
  if (key === 'n:2') {
    // Bare: vertex-shaded matte stone (best canvas for strong tints).
    m = new THREE.MeshStandardMaterial({
      color: 0x8d8a84,
      vertexColors: true,
      roughness: 0.95,
      metalness: 0,
    });
  } else {
    const maps = stoneMaps();
    m = new THREE.MeshStandardMaterial({
      map: maps.map,
      normalMap: maps.normalMap,
      color: key === 'n:0' ? 0xffffff : 0x9a8f80, // 1 = warmer, sandier cast
      vertexColors: true,
      roughness: 0.97,
      metalness: 0,
    });
  }
  rockMats.set(key, m);
  return m;
}

/**
 * Free the textures of every library-set rock material that no current
 * placement references. `usedKeys` = the terrain-texture-set keys (rockTexId)
 * used by the active placements. Legacy numeric materials (`n:*`) are shared
 * procedural stone and never freed. A set used again re-creates its material
 * and re-streams; the reference-counted loader only frees a texture once the
 * base splat and every other holder have also let it go.
 */
export function disposeUnusedRockGroundMats(usedKeys: ReadonlySet<string>): void {
  for (const [key, mat] of [...rockMats]) {
    if (!key.startsWith('set:')) continue;
    if (usedKeys.has(key.slice(4))) continue;
    for (const release of rockMatReleases.get(key) ?? []) release();
    rockMatReleases.delete(key);
    mat.map = null;
    mat.normalMap = null;
    mat.roughnessMap = null;
    mat.aoMap = null;
    mat.dispose();
    rockMats.delete(key);
  }
}

/**
 * Build the rock mesh for a placement's rock params. Unit-radius-ish source
 * size: the placed-assets normalization seats and sizes it like any model.
 */
export function buildRockModel(params: RockParams): THREE.Mesh {
  const seed = Math.round(params.rockSeed ?? 0) % 100000;
  const noiseAmt = Math.min(1, Math.max(0, params.rockNoise ?? 0.5));
  const detail = Math.min(1, Math.max(0, params.rockDetail ?? 0.5));
  const sharp = Math.min(1, Math.max(0, params.rockSharp ?? 0.3));
  const jag = Math.min(1, Math.max(0, params.rockJag ?? 0));
  const height = Math.min(3, Math.max(0.3, params.rockHeight ?? 1));
  let geo: THREE.BufferGeometry = new THREE.IcosahedronGeometry(1, SUBDIVISIONS);
  // IcosahedronGeometry arrives NON-indexed (every triangle owns its verts),
  // which is exactly the faceted look sharp rocks want. Smooth rocks weld the
  // shared vertices first so computeVertexNormals averages across faces.
  if (sharp < 0.45 && jag < 0.4) {
    geo.deleteAttribute('normal');
    geo.deleteAttribute('uv');
    geo = mergeVertices(geo, 1e-4);
  }
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const amp = AMP_MIN + (AMP_MAX - AMP_MIN) * noiseAmt;
  const freq = FREQ_MIN + (FREQ_MAX - FREQ_MIN) * detail;
  const colors = new Float32Array(pos.count * 3);
  const uvs = new Float32Array(pos.count * 2);
  // World-physical texture tiling: a picked texture set repeats every
  // rockTexTile yards of the placed surface (u spans 2 per equator wrap,
  // v spans 1 pole-to-pole = half the circumference). Legacy looks keep the
  // stock per-mesh mapping (mult 1) so existing rocks render unchanged.
  const texTile = params.rockTexTile ?? (params.rockTexId ? 28 : 0);
  const circum = Math.PI * Math.max(0.5, params.worldSize ?? 2.4);
  const uMult = texTile > 0 ? circum / texTile / 2 : 1;
  const vMult = texTile > 0 ? circum / 2 / texTile : 1;
  let minR = Infinity;
  let maxR = -Infinity;
  const rOf = new Float32Array(pos.count);
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.set(pos.getX(i), pos.getY(i), pos.getZ(i)).normalize();
    const n = rockField(v.x, v.y, v.z, seed, freq, sharp, jag);
    // A gentle vertical squash so unscaled rocks sit boulder-like, not spherical.
    const r = (1 + n * amp) * (1 - 0.18 * Math.abs(v.y));
    rOf[i] = r;
    minR = Math.min(minR, r);
    maxR = Math.max(maxR, r);
    // The height stretch shapes spires/slabs before normalization.
    pos.setXYZ(i, v.x * r, v.y * r * height, v.z * r);
    // Spherical UVs (the visible seam hides in noise on a rock).
    uvs[i * 2] = (Math.atan2(v.z, v.x) / (Math.PI * 2) + 0.5) * 2 * uMult;
    uvs[i * 2 + 1] = (Math.acos(Math.max(-1, Math.min(1, v.y))) / Math.PI) * vMult;
  }
  // Crevice shading: recessed vertices darken (cheap baked AO).
  const span = Math.max(1e-4, maxR - minR);
  for (let i = 0; i < pos.count; i++) {
    const s = 0.72 + 0.32 * ((rOf[i] - minR) / span);
    colors[i * 3] = s;
    colors[i * 3 + 1] = s;
    colors[i * 3 + 2] = s;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.computeVertexNormals();
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  const mesh = new THREE.Mesh(geo, rockMaterial(params.rockTex ?? 0, params.rockTexId));
  mesh.name = 'generated-rock';
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

// Ring resolution around the ridge tube and samples per yard along it.
const RIDGE_RING = 22;
const RIDGE_STEP = 1.1;
// The body's vertical placement relative to each node's floor line (dy):
// center rides above it, the underside embeds below it, so the loft reads as
// bedrock breaking out of the ground rather than a log resting on it.
const RIDGE_CENTER_LIFT = 0.5;
const RIDGE_V_RADIUS = 0.95;

/**
 * Build ONE merged rock body along a node chain (local anchor-relative
 * coordinates, world units): a Catmull-Rom smoothed centerline lofted with
 * parallel-transport frames, elliptical cross-sections interpolating each
 * node's girth (r) and height multiplier (h), displaced by the same seeded
 * rock noise as single boulders, with shrink-capped ends. The result is a
 * single continuous solid, not a pile of overlapping spheres.
 */
export function buildRockChainModel(
  nodes: readonly RockChainNode[],
  params: RockParams,
): THREE.Mesh {
  const seed = Math.round(params.rockSeed ?? 0) % 100000;
  const noiseAmt = Math.min(1, Math.max(0, params.rockNoise ?? 0.5));
  const detail = Math.min(1, Math.max(0, params.rockDetail ?? 0.5));
  const sharp = Math.min(1, Math.max(0, params.rockSharp ?? 0.3));
  const jag = Math.min(1, Math.max(0, params.rockJag ?? 0));
  const pts = nodes.map((n) => new THREE.Vector3(n.dx, n.dy, n.dz));
  const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal', 0.5);
  const totalLen = Math.max(1, curve.getLength());
  const segs = Math.max(6, Math.ceil(totalLen / RIDGE_STEP));
  // Node parameter (girth/height) lookup by arc fraction: nearest span lerp.
  const nodeAt = (t: number): { r: number; h: number } => {
    const f = t * (nodes.length - 1);
    const i = Math.max(0, Math.min(nodes.length - 2, Math.floor(f)));
    const u = f - i;
    return {
      r: nodes[i].r + (nodes[i + 1].r - nodes[i].r) * u,
      h: nodes[i].h + (nodes[i + 1].h - nodes[i].h) * u,
    };
  };
  const amp = AMP_MIN + (AMP_MAX - AMP_MIN) * noiseAmt;
  // World-space noise frequency: features sized like a size-3 boulder's.
  const freq = (FREQ_MIN + (FREQ_MAX - FREQ_MIN) * detail) / 3.2;
  // Yards per texture repeat along and around the body (sets default to 28,
  // the legacy stone look keeps its original ~6yd repeat).
  const texTile = params.rockTexTile ?? (params.rockTexId ? 28 : 6);

  const positions: number[] = [];
  const uvs: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  // Parallel-transport frame: carry the normal along to avoid ring twist.
  const tangent = new THREE.Vector3();
  const normal = new THREE.Vector3(1, 0, 0);
  const binormal = new THREE.Vector3();
  const prevTangent = new THREE.Vector3();
  const center = new THREE.Vector3();
  const radial = new THREE.Vector3();
  const p = new THREE.Vector3();
  // End caps: extra shrink rings at each end round the body off.
  const capShrink = [0.55, 0.18];
  let ring = 0;
  for (let cap = capShrink.length - 1; cap >= 0; cap--) {
    emitRing(0, capShrink[cap], -(capShrink.length - cap) * 0.35);
  }
  for (let i = 0; i <= segs; i++) emitRing(i / segs, 1, 0);
  for (let cap = 0; cap < capShrink.length; cap++) {
    emitRing(1, capShrink[cap], (cap + 1) * 0.35);
  }

  function emitRing(t: number, shrink: number, endPush: number): void {
    curve.getPointAt(t, center);
    curve.getTangentAt(Math.min(1, Math.max(0, t)), tangent);
    if (ring === 0) {
      // Seed the frame with any vector not parallel to the first tangent.
      const up =
        Math.abs(tangent.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
      normal.crossVectors(up, tangent).normalize();
    } else {
      // Parallel transport: rotate the carried normal by the tangent delta.
      const cross = new THREE.Vector3().crossVectors(prevTangent, tangent);
      if (cross.lengthSq() > 1e-10) {
        const angle = Math.acos(Math.max(-1, Math.min(1, prevTangent.dot(tangent))));
        normal.applyAxisAngle(cross.normalize(), angle);
      }
    }
    prevTangent.copy(tangent);
    binormal.crossVectors(tangent, normal).normalize();
    const { r, h } = nodeAt(t);
    const rH = r * shrink;
    const rV = r * h * RIDGE_V_RADIUS * shrink;
    const cy = center.y + r * h * RIDGE_CENTER_LIFT;
    // Push cap rings outward along the tangent so the ends round off.
    const cx = center.x + tangent.x * endPush * r;
    const cz = center.z + tangent.z * endPush * r;
    const start = positions.length / 3;
    const arcU = (t * totalLen) / texTile;
    // Around the girth: world-proportional v so the tile is physical there too.
    const girthV = (2 * Math.PI * rH) / texTile;
    for (let k = 0; k <= RIDGE_RING; k++) {
      const a = (k / RIDGE_RING) * Math.PI * 2;
      radial.copy(normal).multiplyScalar(Math.cos(a)).addScaledVector(binormal, Math.sin(a));
      // Elliptical section: horizontal semi-axis rH, vertical rV.
      p.set(cx + radial.x * rH, cy + radial.y * rV, cz + radial.z * rH);
      const n = rockField(p.x * freq, p.y * freq, p.z * freq, seed, 1, sharp, jag);
      const disp = 1 + n * amp;
      p.set(cx + radial.x * rH * disp, cy + radial.y * rV * disp, cz + radial.z * rH * disp);
      positions.push(p.x, p.y, p.z);
      uvs.push(arcU, (k / RIDGE_RING) * girthV);
      colors.push(disp); // staged: remapped to crevice shading below
    }
    if (ring > 0) {
      const a0 = start - (RIDGE_RING + 1);
      for (let k = 0; k < RIDGE_RING; k++) {
        indices.push(a0 + k, start + k, start + k + 1);
        indices.push(a0 + k, start + k + 1, a0 + k + 1);
      }
    }
    ring++;
  }

  // Remap staged displacement into crevice shading (baked AO), darker below.
  const colorArr = new Float32Array(positions.length);
  for (let i = 0; i < colors.length; i++) {
    const s = 0.74 + 0.3 * Math.min(1, Math.max(0, (colors[i] - (1 - amp)) / (2 * amp || 1)));
    colorArr[i * 3] = s;
    colorArr[i * 3 + 1] = s;
    colorArr[i * 3 + 2] = s;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uvs), 2));
  geo.setAttribute('color', new THREE.BufferAttribute(colorArr, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  const mesh = new THREE.Mesh(geo, rockMaterial(params.rockTex ?? 0, params.rockTexId));
  mesh.name = 'generated-rock-ridge';
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}
