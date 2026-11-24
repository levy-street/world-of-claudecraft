// The Hoarshelf's frozen lakes as plain numbers: the clear-ice sheet laid over
// every lake in QUARTERED_FROZEN_LAKES (the sim's own list, the same circles
// the terrain pulls level and the slide aura reads), and the procedural crack
// texture it wears. Three-free and DOM-free so a Vitest pins it;
// quartered_landmark_dressing.ts is the thin consumer that builds the meshes
// and the material.
//
// The sheet is a polar disc just above the lake's level ground (lake.y plus
// LAKE_ICE_LIFT), inset a hand from the lake's edge so it never overhangs the
// bank where the ground eases back up, with its outer ring fading to clear so
// the ice melts into the terrain's own ice tint rather than ending on a line.
// Cosmetic only: the slide itself is the sim's (the slippery-ground aura).

import type { FrozenLake } from '../sim/quartered_landmarks';
import { hash2 } from '../sim/rng';

/** How far over the lake's level ground the sheet floats (with polygon
 *  offset on the material, enough that it never fights the terrain). */
export const LAKE_ICE_LIFT = 0.05;
/** How far inside the lake's edge the sheet stops. */
export const LAKE_ICE_INSET = 0.3;
/** The outer band over which the sheet fades to clear, yards. */
export const LAKE_ICE_FADE = 1.8;
/** The sheet's opacity at its heart (the terrain's deep ice shows through). */
export const LAKE_ICE_ALPHA = 0.86;
/** Rings and segments of the polar disc. */
export const LAKE_ICE_RINGS = 5;
export const LAKE_ICE_SEGMENTS = 48;
/** The crack texture repeats every this many yards across the ice. */
export const LAKE_ICE_TILE_YARDS = 14;

export interface LakeIceDisc {
  /** xyz per vertex, world yards */
  positions: Float32Array;
  /** world-space uv per vertex (one unit is one texture tile) */
  uvs: Float32Array;
  /** rgba per vertex: white, alpha the sheet's fade */
  colors: Float32Array;
  indices: Uint32Array;
}

/** The ice sheet over one lake. Ring 0 is the centre point; the last ring
 *  sits at the inset edge with alpha 0, the one before it at the fade's
 *  inner edge at full alpha, so the fade band is exactly LAKE_ICE_FADE. */
export function lakeIceDisc(lake: FrozenLake): LakeIceDisc {
  const outer = lake.r - LAKE_ICE_INSET;
  const inner = Math.max(0.5, outer - LAKE_ICE_FADE);
  const seg = LAKE_ICE_SEGMENTS;
  // radii: the centre, LAKE_ICE_RINGS - 1 even rings out to the fade's inner
  // edge, then the clear outer edge
  const radii: number[] = [0];
  for (let k = 1; k < LAKE_ICE_RINGS; k++) radii.push((inner * k) / (LAKE_ICE_RINGS - 1));
  radii.push(outer);
  const y = lake.y + LAKE_ICE_LIFT;
  const count = 1 + (radii.length - 1) * seg;
  const positions = new Float32Array(count * 3);
  const uvs = new Float32Array(count * 2);
  const colors = new Float32Array(count * 4);
  const put = (v: number, x: number, z: number, alpha: number) => {
    positions[v * 3] = x;
    positions[v * 3 + 1] = y;
    positions[v * 3 + 2] = z;
    uvs[v * 2] = x / LAKE_ICE_TILE_YARDS;
    uvs[v * 2 + 1] = z / LAKE_ICE_TILE_YARDS;
    colors[v * 4] = 1;
    colors[v * 4 + 1] = 1;
    colors[v * 4 + 2] = 1;
    colors[v * 4 + 3] = alpha;
  };
  put(0, lake.x, lake.z, LAKE_ICE_ALPHA);
  for (let ring = 1; ring < radii.length; ring++) {
    const alpha = ring === radii.length - 1 ? 0 : LAKE_ICE_ALPHA;
    for (let s = 0; s < seg; s++) {
      const a = (s / seg) * Math.PI * 2;
      const v = 1 + (ring - 1) * seg + s;
      put(v, lake.x + Math.cos(a) * radii[ring], lake.z + Math.sin(a) * radii[ring], alpha);
    }
  }
  const tris: number[] = [];
  // the centre fan
  for (let s = 0; s < seg; s++) tris.push(0, 1 + ((s + 1) % seg), 1 + s);
  // the ring bands
  for (let ring = 1; ring + 1 < radii.length; ring++) {
    const r0 = 1 + (ring - 1) * seg;
    const r1 = 1 + ring * seg;
    for (let s = 0; s < seg; s++) {
      const s1 = (s + 1) % seg;
      tris.push(r0 + s, r0 + s1, r1 + s, r1 + s, r0 + s1, r1 + s1);
    }
  }
  return { positions, uvs, colors, indices: Uint32Array.from(tris) };
}

/** The ice's body, its glassy mottling and its pale frost cracks, as sRGB
 *  bytes: black ice so still it reads as the frost inspiration's dark open
 *  water, the snow floes standing on it, with the cracks the one tell that
 *  it bears weight. */
export const LAKE_ICE_COLORS = {
  clear: [20, 38, 48],
  glass: [34, 60, 72],
  crack: [40, 92, 132],
  hairline: [32, 60, 78],
} as const;

/** The crack texture's side in texels (a power of two, so it mips). */
export const LAKE_ICE_TEXTURE_SIZE = 256;
/** Feature points per side of the tile's crack cells. */
const CRACK_CELLS = 5;
const HAIR_CELLS = 11;

/** The distance from a point to the nearest cell border of a tileable
 *  Voronoi pattern of `cells` points per side (F2 - F1, in tile units). */
function voronoiBorder(u: number, v: number, cells: number, salt: number): number {
  const gx = u * cells;
  const gz = v * cells;
  const ci = Math.floor(gx);
  const cj = Math.floor(gz);
  let f1 = Infinity;
  let f2 = Infinity;
  for (let dj = -1; dj <= 1; dj++) {
    for (let di = -1; di <= 1; di++) {
      const i = ci + di;
      const j = cj + dj;
      // wrapped cell ids, so the pattern tiles seamlessly
      const wi = ((i % cells) + cells) % cells;
      const wj = ((j % cells) + cells) % cells;
      const px = i + 0.1 + 0.8 * hash2(wi, wj, salt);
      const pz = j + 0.1 + 0.8 * hash2(wi, wj, salt + 1);
      const d = Math.hypot(gx - px, gz - pz);
      if (d < f1) {
        f2 = f1;
        f1 = d;
      } else if (d < f2) {
        f2 = d;
      }
    }
  }
  return (f2 - f1) / cells;
}

/** The crack texture: deep blue fractures over a tileable cell pattern, fine
 *  hairline fractures between them, and a slow glassy mottle in the clear
 *  body. RGBA bytes, row-major, opaque (the sheet's alpha is per vertex). */
export function lakeIceTexels(size = LAKE_ICE_TEXTURE_SIZE): Uint8Array {
  const out = new Uint8Array(size * size * 4);
  const c = LAKE_ICE_COLORS;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) / size;
      const v = (y + 0.5) / size;
      // the crack lines: about a texel and a half wide, soft at their edges
      const crack =
        1 - Math.min(1, Math.max(0, (voronoiBorder(u, v, CRACK_CELLS, 7101) - 0.004) / 0.006));
      const hair =
        0.6 *
        (1 - Math.min(1, Math.max(0, (voronoiBorder(u, v, HAIR_CELLS, 7201) - 0.0015) / 0.003)));
      // the glassy mottle: a tileable two-sine pattern, no hash seams
      const tau = Math.PI * 2;
      const mottle =
        0.5 +
        0.25 * Math.sin(tau * (2 * u + v)) * Math.cos(tau * (u - 3 * v)) +
        0.25 * Math.sin(tau * (5 * u - 2 * v));
      const o = (y * size + x) * 4;
      for (let ch = 0; ch < 3; ch++) {
        let col = c.clear[ch] + (c.glass[ch] - c.clear[ch]) * mottle;
        col += (c.hairline[ch] - col) * hair;
        col += (c.crack[ch] - col) * crack;
        out[o + ch] = Math.round(Math.max(0, Math.min(255, col)));
      }
      out[o + 3] = 255;
    }
  }
  return out;
}
