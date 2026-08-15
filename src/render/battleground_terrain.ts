// The battleground field's ground: a chunked mesh over the SAME heightfield the
// sim walks on (sim/battleground_field.ts), textured by the map's own painted
// swatches.
//
// Paint is an 18-layer texture array plus a nearest-sampled index grid at the
// map's 0.25yd authoring resolution. The fragment shader reads the four index
// texels around the fragment and blends their tiled samples by the bilinear
// weights, so large painted regions read as their own material and their
// borders feather instead of showing a quarter-yard staircase. Each swatch
// carries its own tiling period and albedo lift, exactly as authored.
//
// Fairness: the ground is drawn identically on every graphics tier. Only the
// material class degrades (surfaceMat substitutes Lambert on low), never which
// paint a player sees, because the paint marks the lanes people navigate by.

import * as THREE from 'three';
import { bgFieldHeightLocal } from '../sim/battleground_field';
import { loadTexture } from './assets/loader';
import {
  BG_TERRAIN_CELL,
  type BgPaintLookup,
  bgPaintLookup,
  bgPaintTextureFiles,
  bgTerrainChunks,
} from './battleground_core';
import { GFX } from './gfx';

export interface BgTerrainView {
  group: THREE.Group;
  dispose(): void;
}

/** Vertex normal from the heightfield's own gradient, so lighting matches the
 *  surface the sim reports rather than the tessellation. */
function normalAt(lx: number, lz: number, out: THREE.Vector3): void {
  const e = BG_TERRAIN_CELL;
  const hx = bgFieldHeightLocal(lx + e, lz) - bgFieldHeightLocal(lx - e, lz);
  const hz = bgFieldHeightLocal(lx, lz + e) - bgFieldHeightLocal(lx, lz - e);
  out.set(-hx, 2 * e, -hz).normalize();
}

/** The painted index grid as a red-channel texture, sampled NEAREST: the
 *  shader does its own weighted blend, so any filtering here would smear
 *  layer INDICES into meaningless in-between values. */
function paintIndexTexture(paint: BgPaintLookup): THREE.DataTexture {
  const tex = new THREE.DataTexture(
    paint.ids,
    paint.cols,
    paint.rows,
    THREE.RedIntegerFormat,
    THREE.UnsignedByteType,
  );
  tex.internalFormat = 'R8UI';
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}

/** Ground textures packed into one array texture so a fragment can reach any
 *  swatch without a per-layer branch. Resolution is capped per tier: the
 *  authored 1024s are more than the ground needs at play distance. */
async function paintArrayTexture(files: string[], size: number): Promise<THREE.DataArrayTexture> {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const data = new Uint8Array(size * size * 4 * files.length);
  for (let i = 0; i < files.length; i++) {
    const tex = await loadTexture(files[i]);
    const img = tex.image as CanvasImageSource;
    if (!ctx || !img) continue;
    ctx.clearRect(0, 0, size, size);
    ctx.drawImage(img, 0, 0, size, size);
    data.set(ctx.getImageData(0, 0, size, size).data, i * size * size * 4);
  }
  const array = new THREE.DataArrayTexture(data, size, size, files.length);
  array.format = THREE.RGBAFormat;
  array.type = THREE.UnsignedByteType;
  array.wrapS = THREE.RepeatWrapping;
  array.wrapT = THREE.RepeatWrapping;
  array.magFilter = THREE.LinearFilter;
  array.minFilter = THREE.LinearMipmapLinearFilter;
  array.generateMipmaps = true;
  array.colorSpace = THREE.SRGBColorSpace;
  array.needsUpdate = true;
  return array;
}

/**
 * How far (yards) the noise may displace a paint lookup. Sized against the
 * paint grid, not the textures: at the 0.25yd cell this is ~3 cells of
 * wander, enough to bury the staircase without smearing a painted region so
 * far that it stops matching the map the author drew.
 */
const PAINT_WARP_YD = 0.85;

const VERT_HEAD = /* glsl */ `
varying vec2 vFieldXZ;
`;
const VERT_BODY = /* glsl */ `
vFieldXZ = vec2(position.x, position.z);
`;

const FRAG_HEAD = /* glsl */ `
varying vec2 vFieldXZ;
uniform highp usampler2D uPaintIds;
uniform sampler2DArray uPaintTex;
uniform vec2 uPaintOrigin;
uniform vec2 uPaintSize;   // cols, rows
uniform float uPaintCell;
uniform vec2 uSwatch[32];  // per layer: (1 / tileSize, light)

uniform float uPaintWarp;

vec3 bgSwatchSample(uint layer, vec2 world) {
  if (layer > 250u) return vec3(-1.0);
  vec2 sw = uSwatch[layer];
  vec3 c = texture(uPaintTex, vec3(world * sw.x, float(layer))).rgb;
  return clamp(c * (1.0 + sw.y), 0.0, 1.0);
}

// Cheap hash-based value noise. Used ONLY to warp the paint lookup, so it costs
// four hashes a fragment and no extra texture taps.
float bgHash21(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}

float bgValueNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(bgHash21(i), bgHash21(i + vec2(1.0, 0.0)), f.x),
    mix(bgHash21(i + vec2(0.0, 1.0)), bgHash21(i + vec2(1.0, 1.0)), f.x),
    f.y
  );
}
`;

// Replaces the standard map fetch: four index taps, bilinear weights, and a
// renormalizing accumulate so unpainted neighbours never darken a painted
// fragment (they drop out of the weight sum instead of blending toward black).
// The painted colour REPLACES the base by its coverage, matching how the map
// editor composites the same swatches, so the ground reads exactly as authored
// rather than as the base tint multiplied by a texture.
const FRAG_BODY = /* glsl */ `
// Break the lattice BEFORE looking up. The paint grid is a quarter-yard
// lattice, so a border between two swatches is an axis-aligned staircase, and
// a one-cell bilinear feather is far too narrow to hide it at head height ,
// which is exactly where players read the ground. Two octaves of value noise
// displace the LOOKUP by up to ~a yard, so the border wanders like a real
// material boundary and the bilinear below then feathers what is left.
// The warp never touches the tiling coordinate handed to bgSwatchSample: warp
// that and the material itself swims underfoot as the camera moves.
// Fade the warp out with distance. The index map is sampled NEAREST, so a
// warp that survives to where one pixel covers most of a cell makes
// neighbouring pixels land in different cells and the far field SPARKLES as
// the camera moves. fwidth gives yards-per-pixel directly, so the warp is full
// strength exactly where the staircase is legible and gone by the time it
// isn't. This is also why it costs nothing at distance.
float pxSpan = max(fwidth(vFieldXZ.x), fwidth(vFieldXZ.y));
float warpFade = 1.0 - smoothstep(0.06, 0.32, pxSpan);
vec2 warp = vec2(bgValueNoise(vFieldXZ * 1.3), bgValueNoise(vFieldXZ * 1.3 + 41.7)) - 0.5;
warp += (vec2(bgValueNoise(vFieldXZ * 3.7 + 11.3), bgValueNoise(vFieldXZ * 3.7 + 87.1)) - 0.5) * 0.5;
vec2 pWorld = vFieldXZ + warp * (uPaintWarp * warpFade);
vec2 pCoord = (pWorld - uPaintOrigin) / uPaintCell - 0.5;
vec2 pBase = floor(pCoord);
vec2 pFrac = pCoord - pBase;
vec3 acc = vec3(0.0);
float wsum = 0.0;
for (int oz = 0; oz <= 1; oz++) {
  for (int ox = 0; ox <= 1; ox++) {
    vec2 cell = pBase + vec2(float(ox), float(oz));
    vec2 uv = (cell + 0.5) / uPaintSize;
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) continue;
    uint layer = texture(uPaintIds, uv).r;
    vec3 c = bgSwatchSample(layer, vFieldXZ);
    if (c.r < 0.0) continue;
    float w = (ox == 0 ? 1.0 - pFrac.x : pFrac.x) * (oz == 0 ? 1.0 - pFrac.y : pFrac.y);
    acc += c * w;
    wsum += w;
  }
}
if (wsum > 0.001) diffuseColor.rgb = mix(diffuseColor.rgb, acc / wsum, min(1.0, wsum));
`;

/**
 * Build the field's ground. `heightAt` is injected so the caller can pass the
 * same sampler the sim uses; the default IS that sampler.
 */
export async function buildBattlegroundTerrain(opts: { lowGfx: boolean }): Promise<BgTerrainView> {
  const group = new THREE.Group();
  group.name = 'battleground-terrain';
  const paint = bgPaintLookup();
  const idTex = paintIndexTexture(paint);
  const size = opts.lowGfx || GFX.tier === 'medium' ? 256 : 512;
  const arrayTex = await paintArrayTexture(bgPaintTextureFiles(), size);

  const swatch = new Float32Array(64);
  paint.swatches.forEach((s, i) => {
    swatch[i * 2] = 1 / Math.max(0.5, s.tileSize);
    swatch[i * 2 + 1] = s.light;
  });

  // Base tone for the cells the author left unpainted: bare hollow earth, so an
  // unpainted patch reads as ground rather than as white.
  const mat = new THREE.MeshStandardMaterial({ color: 0x6b6a4e, roughness: 0.95, metalness: 0 });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uPaintIds = { value: idTex };
    shader.uniforms.uPaintTex = { value: arrayTex };
    shader.uniforms.uPaintOrigin = { value: new THREE.Vector2(paint.originX, paint.originZ) };
    shader.uniforms.uPaintSize = { value: new THREE.Vector2(paint.cols, paint.rows) };
    shader.uniforms.uPaintCell = { value: paint.cell };
    shader.uniforms.uSwatch = { value: swatch };
    shader.uniforms.uPaintWarp = { value: PAINT_WARP_YD };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERT_HEAD}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${VERT_BODY}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAG_HEAD}`)
      .replace('#include <map_fragment>', `#include <map_fragment>\n${FRAG_BODY}`);
  };
  // Distinct cache key: the patched program must never be shared with a plain
  // standard material that happens to match on colour and flags.
  mat.customProgramCacheKey = () => 'bg-terrain-paint';

  const geos: THREE.BufferGeometry[] = [];
  const n = new THREE.Vector3();
  for (const chunk of bgTerrainChunks()) {
    const cols = Math.round((chunk.maxX - chunk.minX) / BG_TERRAIN_CELL) + 1;
    const rows = Math.round((chunk.maxZ - chunk.minZ) / BG_TERRAIN_CELL) + 1;
    const pos = new Float32Array(cols * rows * 3);
    const nor = new Float32Array(cols * rows * 3);
    for (let c = 0; c < cols; c++) {
      for (let r = 0; r < rows; r++) {
        const lx = chunk.minX + c * BG_TERRAIN_CELL;
        const lz = chunk.minZ + r * BG_TERRAIN_CELL;
        const i = (c * rows + r) * 3;
        pos[i] = lx;
        pos[i + 1] = bgFieldHeightLocal(lx, lz);
        pos[i + 2] = lz;
        normalAt(lx, lz, n);
        nor[i] = n.x;
        nor[i + 1] = n.y;
        nor[i + 2] = n.z;
      }
    }
    const idx: number[] = [];
    for (let c = 0; c < cols - 1; c++) {
      for (let r = 0; r < rows - 1; r++) {
        const a = c * rows + r;
        const b = (c + 1) * rows + r;
        idx.push(a, a + 1, b, b, a + 1, b + 1);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    // The shader reads world XZ, not UVs, but the standard material's
    // map_fragment chunk needs the attribute to exist.
    geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(cols * rows * 2), 2));
    geo.setIndex(idx);
    geo.computeBoundingSphere();
    geos.push(geo);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    group.add(mesh);
  }

  return {
    group,
    dispose() {
      for (const g of geos) g.dispose();
      mat.dispose();
      idTex.dispose();
      arrayTex.dispose();
      group.clear();
    },
  };
}
