// Pure plan of the Islands of the Wind's look (breath_isles_fx.ts paints it;
// the sim: encounters/smith_heart/breath_isles.ts). Three-free, DOM-free,
// deterministic (a hash, never rng): what a floating isle IS (its carved top,
// its underside of storm granite hanging to a point, its strata, its crystal
// clusters, its hanging roots, its ring of wind runes, its drifting stones),
// the Gale Path's and the Homeward Gale's circles and the route of wind each
// draws to where it carries, a rider's ribbons, the Gale Bulwark round the
// guardian and the Gale Mender's stream into it, read off the sim's own
// numbers (ISLE_TUNING, the layout, the ride's own arc), never tuned here.
//
// Readability (binding): the circles, their routes, the Bulwark and the
// Mender's stream draw on EVERY tier (the raid acts on them); the drifting
// stones, the mist and the motes thin on the low tier.

import { BREATH_ISLES } from '../../sim/content/smith_heart_layout';
import { isleSpots, rideArc } from '../../sim/encounters/smith_heart/breath_isle_geometry';
import {
  ISLE_OBJECTS,
  ISLE_TUNING as IT,
  isleCircleOf,
  rideOf,
} from '../../sim/encounters/smith_heart/breath_isle_ids';

/** The palette: the vein's storm teal and white for the wind, a pale gold
 *  for the way home, the crystals' cold blue, the granite's warm grey. */
export const ISLE_COLORS = {
  path: 0x7fe8ff,
  pathCore: 0xf2feff,
  home: 0xffe2a0,
  homeCore: 0xfffbe8,
  rune: 0x8ff0ff,
  crystal: 0x6fd2ff,
  crystalCore: 0xe6fbff,
  granite: 0xb8b3a6,
  graniteDark: 0x4e4a45,
  strata: 0x8c7f6c,
  moss: 0x6f8a5a,
  root: 0x4a3828,
  bulwark: 0x9ff0ff,
  bulwarkEdge: 0xffffff,
  mend: 0x7affd8,
  ribbon: 0xe8fbff,
  mist: 0xd8eef8,
} as const;

/** Pool sizes (fixed: no allocation in a fight). */
export const ISLE_POOLS = {
  /** Gale Paths (one per isle) and Homeward Gales (one per isle). */
  circles: BREATH_ISLES.length * 2,
  /** Riders in the air at once (a whole raid could ride). */
  riders: 10,
  /** Menders streaming into the Bulwark at once. */
  streams: BREATH_ISLES.length,
  /** Drifting stones under each isle. */
  stones: 9,
} as const;

/** A small integer hash to 0..1. */
export function isleHash(a: number, b: number): number {
  let h = (Math.imul(a | 0, 0x45d9f3b) ^ Math.imul(b | 0, 0x119de1f3)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** What an isle's circle object is (a Gale Path, a Homeward Gale, a ride's
 *  carrier), or null. */
export type IsleObjectKind = 'path' | 'home' | 'ride';
export function isleObjectKind(templateId: string): IsleObjectKind | null {
  if (templateId.startsWith(ISLE_OBJECTS.ridePrefix)) return rideOf(templateId) ? 'ride' : null;
  const c = isleCircleOf(templateId);
  return c ? c.kind : null;
}

// ---- the rock --------------------------------------------------------------------------

/** One isle's rock mesh, instance-local: its top (a carved disc at the
 *  floor's own outline, so what you see is what you stand on), a broken lip
 *  just under it, then the underside hanging to a jagged point, banded in
 *  strata. Vertex colours; triangle lists. */
export interface IsleRock {
  positions: number[];
  colors: number[];
  indices: number[];
}

const RING = 30;

function mixHex(a: number, b: number, k: number, out: number[]): void {
  const t = Math.max(0, Math.min(1, k));
  out.push(
    (((a >> 16) & 255) * (1 - t) + ((b >> 16) & 255) * t) / 255,
    (((a >> 8) & 255) * (1 - t) + ((b >> 8) & 255) * t) / 255,
    ((a & 255) * (1 - t) + (b & 255) * t) / 255,
  );
}

/** The isle's outline radius at angle step `k` (the field's carved disc,
 *  a little inside it so the rock never overhangs the walkable edge). */
export function isleRimRadius(i: number, k: number): number {
  const isle = BREATH_ISLES[i];
  return isle.r - 0.7 - 0.9 * isleHash(k, 71 + i * 13);
}

export function isleRock(i: number): IsleRock {
  const isle = BREATH_ISLES[i];
  const C = ISLE_COLORS;
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const cx = isle.x;
  const cz = isle.z;
  const top = isle.h;
  // The top: a fan from the middle, slightly domed, grey granite with moss
  // patches (vertex colour), its edge a hand lower (worn).
  positions.push(cx, top + 0.15, cz);
  mixHex(C.granite, C.moss, 0.35, colors);
  for (let k = 0; k < RING; k++) {
    const a = (k / RING) * Math.PI * 2;
    const r = isleRimRadius(i, k);
    positions.push(cx + Math.sin(a) * r, top - 0.05, cz + Math.cos(a) * r);
    mixHex(C.granite, C.moss, isleHash(k, 5 + i) * 0.5, colors);
  }
  for (let k = 0; k < RING; k++) indices.push(0, 1 + k, 1 + ((k + 1) % RING));
  // The underside: rings going down and in, each jagged, to a point.
  const depth = isle.r * 2.3;
  const rings = 9;
  let prev = 1;
  for (let j = 1; j <= rings; j++) {
    const t = j / rings;
    const base = positions.length / 3;
    for (let k = 0; k < RING; k++) {
      const a = (k / RING) * Math.PI * 2 + (j % 2) * 0.05;
      // A lip that swells out just under the top, then the hang tapering in
      // (a little bulge mid-way: the mass of the stone).
      const bulge = j === 1 ? 1.08 : 1;
      const taper = (1 - t) ** 1.25 * (1 + 0.18 * Math.sin(t * Math.PI));
      const jag = 1 + (isleHash(k * 7 + j, 31 + i) - 0.5) * (0.35 + 0.3 * t);
      const r = isleRimRadius(i, k) * taper * jag * bulge;
      const y = top - 0.4 - depth * t ** 1.1 - isleHash(k + j * 3, 47 + i) * 1.1 * t;
      positions.push(cx + Math.sin(a) * r, y, cz + Math.cos(a) * r);
      // Strata: bands of darker and warmer stone, dark toward the point.
      const band = Math.sin(y * 1.7 + isleHash(j, 3 + i) * 3) * 0.5 + 0.5;
      const dark = 0.25 + 0.65 * t;
      const tmp: number[] = [];
      mixHex(C.granite, C.strata, band * 0.6, tmp);
      const g = [tmp[0], tmp[1], tmp[2]];
      const d = (C.graniteDark >> 16) / 255;
      colors.push(
        g[0] * (1 - dark) + d * dark,
        g[1] * (1 - dark) + (((C.graniteDark >> 8) & 255) / 255) * dark,
        g[2] * (1 - dark) + ((C.graniteDark & 255) / 255) * dark,
      );
    }
    for (let k = 0; k < RING; k++) {
      const a0 = prev + k;
      const a1 = prev + ((k + 1) % RING);
      const b0 = base + k;
      const b1 = base + ((k + 1) % RING);
      indices.push(a0, b0, a1, a1, b0, b1);
    }
    prev = base;
  }
  // The point.
  const tip = positions.length / 3;
  positions.push(
    cx + (isleHash(i, 9) - 0.5) * 2,
    top - depth - 2.5,
    cz + (isleHash(i, 11) - 0.5) * 2,
  );
  mixHex(C.graniteDark, 0x000000, 0.3, colors);
  for (let k = 0; k < RING; k++) indices.push(prev + k, tip, prev + ((k + 1) % RING));
  return { positions, colors, indices };
}

/** The isle's crystal clusters: storm-blue shards growing out of its
 *  underside and two at its rim. Each: a base (instance-local), a lean
 *  (unit direction) and a length and girth. */
export interface IsleCrystal {
  x: number;
  y: number;
  z: number;
  dx: number;
  dy: number;
  dz: number;
  len: number;
  girth: number;
}

export function isleCrystals(i: number): IsleCrystal[] {
  const isle = BREATH_ISLES[i];
  const out: IsleCrystal[] = [];
  const depth = isle.r * 2.3;
  for (let c = 0; c < 7; c++) {
    const a = isleHash(c, 101 + i) * Math.PI * 2;
    const t = 0.15 + isleHash(c, 103 + i) * 0.55;
    const r = isle.r * (1 - t) * 0.92;
    const y = isle.h - 0.6 - depth * t;
    // Pointing out and down from the stone.
    const ox = Math.sin(a);
    const oz = Math.cos(a);
    const down = -0.35 - isleHash(c, 107) * 0.5;
    const n = Math.hypot(ox, down, oz);
    const cluster = 2 + Math.floor(isleHash(c, 109) * 3);
    for (let s = 0; s < cluster; s++) {
      const jx = (isleHash(c * 5 + s, 111) - 0.5) * 0.7;
      const jz = (isleHash(c * 5 + s, 113) - 0.5) * 0.7;
      const len = 2.2 + isleHash(c * 5 + s, 117) * 3.6 * (s === 0 ? 1.3 : 0.8);
      out.push({
        x: isle.x + ox * r,
        y,
        z: isle.z + oz * r,
        dx: ox / n + jx,
        dy: down / n + (isleHash(c * 5 + s, 119) - 0.5) * 0.4,
        dz: oz / n + jz,
        len,
        girth: 0.3 + len * 0.11,
      });
    }
  }
  // Two short clusters on the rim, leaning out (they sparkle in the wind).
  for (let c = 0; c < 2; c++) {
    const a = isleHash(c, 131 + i) * Math.PI * 2;
    const r = isle.r - 1.2;
    out.push({
      x: isle.x + Math.sin(a) * r,
      y: isle.h - 0.2,
      z: isle.z + Math.cos(a) * r,
      dx: Math.sin(a) * 0.6,
      dy: 0.8,
      dz: Math.cos(a) * 0.6,
      len: 1.6 + isleHash(c, 137) * 1.2,
      girth: 0.32,
    });
  }
  return out;
}

/** The isle's hanging roots: each a dangling curve from the underside (a
 *  list of points), swaying in the wind (the painter sways the whole set). */
export function isleRoots(i: number): { x: number; y: number; z: number }[][] {
  const isle = BREATH_ISLES[i];
  const out: { x: number; y: number; z: number }[][] = [];
  const depth = isle.r * 2.3;
  for (let c = 0; c < 11; c++) {
    const a = isleHash(c, 151 + i) * Math.PI * 2;
    const t = 0.05 + isleHash(c, 153 + i) * 0.4;
    const r = isle.r * (1 - t) * 0.95;
    const y0 = isle.h - 0.8 - depth * t;
    const len = 4 + isleHash(c, 157) * 9;
    const pts: { x: number; y: number; z: number }[] = [];
    const curl = (isleHash(c, 159) - 0.5) * 2.4;
    for (let s = 0; s <= 6; s++) {
      const k = s / 6;
      pts.push({
        x: isle.x + Math.sin(a) * (r + k * 0.8) + Math.cos(a) * curl * k * k,
        y: y0 - len * k,
        z: isle.z + Math.cos(a) * (r + k * 0.8) - Math.sin(a) * curl * k * k,
      });
    }
    out.push(pts);
  }
  return out;
}

/** The ring of wind runes round an isle's floor (its inner and outer radius:
 *  just inside the walkable edge). */
export function isleRuneRing(i: number): { inner: number; outer: number } {
  const r = BREATH_ISLES[i].r;
  return { inner: r - 3.1, outer: r - 1.7 };
}

/** A drifting stone under an isle `t` seconds in: its place (instance-local)
 *  and spin (a slow orbit on two beats). */
export function driftStone(
  i: number,
  k: number,
  t: number,
): { x: number; y: number; z: number; spin: number; size: number } {
  const isle = BREATH_ISLES[i];
  const a = isleHash(k, 171 + i) * Math.PI * 2 + t * (0.08 + isleHash(k, 173) * 0.12);
  const r = isle.r * (0.6 + isleHash(k, 175) * 0.9);
  const y = isle.h - 3 - isleHash(k, 177) * isle.r * 2 + Math.sin(t * 0.7 + k) * 0.6;
  return {
    x: isle.x + Math.sin(a) * r,
    y,
    z: isle.z + Math.cos(a) * r,
    spin: t * (0.3 + isleHash(k, 179)),
    size: 0.5 + isleHash(k, 181) * 1.1,
  };
}

// ---- the circles and their routes ----------------------------------------------------

/** A circle's look `age` seconds after it opened: its swirl's speed and
 *  brightness (a quick flare as it opens, then a steady beckon). */
export function circleLook(age: number): { open: number; glow: number; spin: number } {
  const open = Math.max(0, Math.min(1, age / 0.6));
  const flare = age < 1.2 ? 1 - age / 1.2 : 0;
  return { open, glow: 0.75 + 0.25 * Math.sin(age * 3.1) + 0.6 * flare, spin: 1.6 };
}

/** The route a circle draws to where it carries (instance-local points on
 *  the ride's own arc, from the circle's middle to its landing). */
export function circleRoute(
  isle: number,
  kind: 'path' | 'home',
  steps: number,
  heights: { cornice: number },
): { x: number; y: number; z: number }[] {
  const s = isleSpots()[isle];
  const from =
    kind === 'path'
      ? { x: s.path.x, y: heights.cornice, z: s.path.z }
      : { x: s.home.x, y: s.h, z: s.home.z };
  const to =
    kind === 'path'
      ? { x: s.land.x, y: s.h, z: s.land.z }
      : { x: s.back.x, y: heights.cornice, z: s.back.z };
  const out: { x: number; y: number; z: number }[] = [];
  for (let k = 0; k <= steps; k++) out.push(rideArc(from, to, k / steps));
  return out;
}

// ---- the Bulwark and the Mender ------------------------------------------------------

/** The Bulwark's look from its absorb (`left` of `whole`) at `clock`: how
 *  solid it stands, how cracked, how fast its wind turns. */
export function bulwarkLook(
  left: number,
  whole: number,
  clock: number,
): { solid: number; crack: number; spin: number; pulse: number } {
  const k = whole > 0 ? Math.max(0, Math.min(1, left / whole)) : 0;
  return {
    solid: 0.35 + 0.65 * k,
    crack: 1 - k,
    spin: 0.6 + 1.4 * k,
    pulse: 0.85 + 0.15 * Math.sin(clock * (2 + 3 * (1 - k))),
  };
}

/** The ride's flourish: how a rider's ribbons wrap them `k` (0 to 1) into
 *  the ride (tight and bright in the middle, loosening as it sets down). */
export function riderLook(k: number): { wrap: number; bright: number } {
  const t = Math.max(0, Math.min(1, k));
  return { wrap: 0.6 + 0.4 * Math.sin(t * Math.PI), bright: 0.5 + 0.5 * Math.sin(t * Math.PI) };
}

/** The ride's seconds and arc apex, read once (the painter's guards). */
export const RIDE = { seconds: IT.rideSeconds, apex: IT.rideApex, circleR: IT.circleR } as const;
