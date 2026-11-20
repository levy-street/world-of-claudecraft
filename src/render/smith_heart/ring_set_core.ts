// PURE: the Ring's set from the owner's Ring concept of 2026-11-11: mist lying in the pit
// round the Seal Dais, under every walk, and a rune of each vein's element carved in the
// standing stones that flank its mouth (the Breath's storm bolt north, the Quench's ice
// star east, the Heat's flame west, the Hammer's sun on the jambs at the Grand Stair's
// head), glowing low while the vein sleeps and blazing once it is lit (the seal's own
// memory, heart_seal_core.ts: the runes say what the seal and the rivers already say).
// The painter is ring_set.ts. Cosmetic, never a telegraph, never a solid. Three-free,
// DOM-free, deterministic.

import {
  RING,
  SEAL_DAIS,
  SMITH_HEART_VEINS,
  type SmithHeartVein,
} from '../../sim/content/smith_heart_layout';
import { planRingProps } from './ring_kit_plan_core';

/** The pit's mist: flat sheets from `r0` (clear of the dais's foot) to `r1` (the Ring's
 *  inner wall), each at its depth `y` with its `alpha` (the deepest thickest), every edge
 *  eased over `edge` yards; `rings` by `segs` cells. Every sheet under the walks (the Ring
 *  at its floor, the dais and the stairs no lower than the dais), so no eye's line to the
 *  seal ever crosses one. */
export const RING_MIST = {
  r0: SEAL_DAIS.r + 2,
  r1: RING.innerR - 0.5,
  edge: 4,
  sheets: [
    { y: -24, alpha: 0.9 },
    { y: -16, alpha: 0.6 },
    { y: -10, alpha: 0.32 },
  ],
  rings: 6,
  segs: 96,
} as const;

/** The mist's sheets (instance-local): `positions` x, y, z, `sheet` the sheet's index per
 *  vertex, `indices` triangles, the deepest sheet first (drawn first: seen from above, the
 *  nearer sheets lie over it). `sheets` the count kept (the low tier keeps fewer). */
export function ringMistMesh(sheets: number = RING_MIST.sheets.length): {
  positions: number[];
  sheet: number[];
  indices: number[];
} {
  const M = RING_MIST;
  const positions: number[] = [];
  const sheet: number[] = [];
  const indices: number[] = [];
  const row = M.segs + 1;
  for (let s = 0; s < Math.min(sheets, M.sheets.length); s++) {
    const base = positions.length / 3;
    for (let j = 0; j <= M.rings; j++) {
      const r = M.r0 + (M.r1 - M.r0) * (j / M.rings);
      for (let i = 0; i <= M.segs; i++) {
        const a = (i / M.segs) * Math.PI * 2;
        positions.push(RING.x + Math.sin(a) * r, M.sheets[s].y, RING.z + Math.cos(a) * r);
        sheet.push(s);
      }
    }
    for (let j = 0; j < M.rings; j++)
      for (let i = 0; i < M.segs; i++) {
        const a = base + j * row + i;
        indices.push(a, a + row, a + 1, a + 1, a + row, a + row + 1);
      }
  }
  return { positions, sheet, indices };
}

/** A rune on a standing stone (instance-local): its middle, the way its face looks
 *  (unit, xz), its half size (yards), its vein. */
export interface RingRune {
  x: number;
  y: number;
  z: number;
  nx: number;
  nz: number;
  half: number;
  vein: SmithHeartVein;
}

/** Where a rune sits on each stone (measured off the shipped Ring kit at the rune's
 *  height: the face's depth either side of the stone's frame, `front` along its +z and
 *  `back` along its -z), its height over the stone's foot, its half size, how far off the
 *  face it is drawn. */
export const RING_RUNE = {
  stones: {
    Kit_RingMonolith: { y: 6.6, front: 0.98, back: 0.9, half: 1.05 },
    Kit_JambHammer: { y: 6.2, front: 1.15, back: 1.14, half: 1.15 },
  } as Readonly<Record<string, { y: number; front: number; back: number; half: number }>>,
  clear: 0.08,
} as const;

/** The vein whose mouth a stone on the Ring flanks: the mouth nearest its bearing (the
 *  Breath north, the Quench east, the Heat west; the Hammer's jambs are its own). */
export function ringRuneVein(piece: string, x: number, z: number): SmithHeartVein {
  if (piece === 'Kit_JambHammer') return 'hammer';
  const deg = (Math.atan2(x - RING.x, z - RING.z) * 180) / Math.PI;
  if (Math.abs(deg) <= 45) return 'breath';
  if (deg > 45 && deg < 135) return 'quench';
  if (deg < -45 && deg > -135) return 'heat';
  return 'hammer';
}

/** Every rune: one on each standing stone and each of the Hammer's jambs, on the face
 *  that looks into the Ring. */
export function planRingRunes(): RingRune[] {
  const out: RingRune[] = [];
  for (const p of planRingProps()) {
    const S = RING_RUNE.stones[p.piece];
    if (!S) continue;
    // The stone's +z face, and which of its two faces looks into the Ring.
    const fx = Math.sin(p.rot);
    const fz = Math.cos(p.rot);
    const inward = fx * (RING.x - p.x) + fz * (RING.z - p.z) >= 0 ? 1 : -1;
    const depth = (inward > 0 ? S.front : S.back) + RING_RUNE.clear;
    out.push({
      x: p.x + fx * inward * depth,
      y: p.y + S.y,
      z: p.z + fz * inward * depth,
      nx: fx * inward,
      nz: fz * inward,
      half: S.half,
      vein: ringRuneVein(p.piece, p.x, p.z),
    });
  }
  return out;
}

/** How a rune glows: `asleep` its level while its vein sleeps (breathing by `breath`),
 *  `lit` once the vein is lit, rising over `rise` seconds through a `flash` over it. */
export const RING_RUNE_LIGHT = { asleep: 0.42, breath: 0.08, lit: 1.0, rise: 1.8, flash: 0.9 };

/** A rune's level `since` seconds after its vein lit (-1: asleep). The breath is the
 *  shader's; this is the level it breathes round. */
export function ringRuneLevel(since: number): number {
  const L = RING_RUNE_LIGHT;
  if (since < 0) return L.asleep;
  const t = Math.min(1, since / L.rise);
  const ease = t * t * (3 - 2 * t);
  const flash = L.flash * Math.max(0, 1 - Math.abs(since - L.rise * 0.4) / (L.rise * 0.6));
  return L.asleep + (L.lit - L.asleep) * ease + flash;
}

/** Each vein's index in the seal's order (the runes' level uniform). */
export function ringRuneVeinIndex(vein: SmithHeartVein): number {
  return SMITH_HEART_VEINS.indexOf(vein);
}
