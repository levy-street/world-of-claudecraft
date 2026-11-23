// Pure plan for the Thaw Works' floor (sanctum_works.ts): the cult's stain on
// the clean glacier. Soot round every pyre and tent, grey trodden slush across
// the camp, the sledges' runner ruts down to the works road, meltwater
// puddles round the soul pyres, and the melt channel's running water along
// the layout's MELT_CHANNEL line. Every mark lies flat on ONE walkable floor
// (never across a terrace's edge), hashed per spot so the camp looks used,
// not tiled.
//
// Three-free, DOM-free, deterministic.

import {
  GRAVEWYRM_SANCTUM_FIELD,
  MELT_CHANNEL,
  THAW_WORKS,
} from '../../sim/content/gravewyrm_sanctum_layout';
import { sanctumFloorAt, sanctumHash } from './sanctum_plan_core';

/** 0 soot, 1 slush, 2 a runner rut, 3 a meltwater puddle. */
export type WorksMarkKind = 0 | 1 | 2 | 3;

export interface WorksMark {
  kind: WorksMarkKind;
  x: number;
  z: number;
  /** Half extents across and along `rot` (yards). */
  hw: number;
  hl: number;
  /** Turn (radians, sim convention: 0 runs along +z). */
  rot: number;
  /** True when the mark sheds on the low tier (cosmetic scatter). */
  cosmetic: boolean;
}

/** Is the whole rectangle of a mark on one floor height (no edge under it)? */
export function worksMarkFits(m: WorksMark): boolean {
  const y0 = sanctumFloorAt(m.x, m.z);
  if (y0 === null) return false;
  const c = Math.cos(m.rot);
  const s = Math.sin(m.rot);
  for (const [a, b] of [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
    [0, 1],
    [0, -1],
  ]) {
    const ax = a * m.hw;
    const al = b * m.hl;
    const y = sanctumFloorAt(m.x + ax * c + al * s, m.z - ax * s + al * c);
    if (y === null || Math.abs(y - y0) > 0.01) return false;
  }
  return true;
}

function propsOf(kind: string) {
  return GRAVEWYRM_SANCTUM_FIELD.props.filter((p) => p.kind === kind);
}

/** Every mark of the works' floor, in a fixed order. */
export function planWorksMarks(): WorksMark[] {
  const out: WorksMark[] = [];
  const push = (m: WorksMark) => {
    if (worksMarkFits(m)) out.push(m);
  };
  // Soot: a scorched ring round every soul pyre, smuts blown off downwind,
  // and the black round the tents' stove pipes.
  for (const [i, p] of propsOf('gs_soul_pyre').entries()) {
    push({ kind: 0, x: p.x, z: p.z, hw: 4.2, hl: 4.2, rot: i * 0.9, cosmetic: false });
    for (let k = 0; k < 3; k++) {
      const a = 0.4 + sanctumHash(i, k) * 0.9;
      const d = 4.5 + k * 2.2;
      push({
        kind: 0,
        x: p.x + Math.sin(a) * d,
        z: p.z + Math.cos(a) * d,
        hw: 0.8 + sanctumHash(k, i) * 0.7,
        hl: 1.2,
        rot: a,
        cosmetic: true,
      });
    }
    // Meltwater pooling in the hollow the pyre's heat sank into the ice.
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2 + sanctumHash(i + 9, k) * 1.4;
      const d = 2.6 + sanctumHash(k + 4, i) * 1.4;
      push({
        kind: 3,
        x: p.x + Math.sin(a) * d,
        z: p.z + Math.cos(a) * d,
        hw: 1.3 + sanctumHash(i, k + 7) * 0.9,
        hl: 1.6 + sanctumHash(k, i + 7) * 1.0,
        rot: a,
        cosmetic: false,
      });
    }
  }
  for (const [i, t] of propsOf('gs_cult_tent').entries()) {
    push({ kind: 0, x: t.x, z: t.z + 3.4, hw: 2.2, hl: 1.6, rot: t.rot, cosmetic: true });
    push({
      kind: 1,
      x: t.x,
      z: t.z - 4.4,
      hw: 4.5,
      hl: 2.6,
      rot: t.rot + i * 0.3,
      cosmetic: false,
    });
  }
  // Ruts: each sledge's two runners, dragged in from the works road.
  for (const [i, sl] of propsOf('gs_cult_sledge').entries()) {
    if (sl.z < THAW_WORKS.upper.z0 || sl.z > THAW_WORKS.lower.z1) continue;
    const dx = 0 - sl.x;
    const dz = 52 - sl.z;
    const len = Math.hypot(dx, dz);
    if (len < 2) continue;
    const rot = Math.atan2(dx, dz);
    for (const side of [-1, 1]) {
      const ox = Math.cos(rot) * 1.05 * side;
      const oz = -Math.sin(rot) * 1.05 * side;
      push({
        kind: 2,
        x: sl.x + dx / 2 + ox,
        z: sl.z + dz / 2 + oz,
        hw: 0.32,
        hl: len / 2,
        rot,
        cosmetic: false,
      });
    }
    push({ kind: 1, x: sl.x, z: sl.z, hw: 3.4, hl: 5.2, rot: sl.rot + i, cosmetic: true });
  }
  // The works road: trodden slush and runner ruts down the ramp.
  for (const side of [-1.2, 1.2]) {
    push({ kind: 2, x: side, z: 44, hw: 0.32, hl: 6, rot: 0, cosmetic: false });
  }
  // Slush scattered over both terraces where the cult walks.
  for (const [ti, t] of [THAW_WORKS.upper, THAW_WORKS.lower].entries()) {
    for (let k = 0; k < 12; k++) {
      const x = t.x0 + 6 + sanctumHash(k * 3.1, ti + 1) * (t.x1 - t.x0 - 12);
      const z = t.z0 + 3 + sanctumHash(ti + 5, k * 1.7) * (t.z1 - t.z0 - 6);
      push({
        kind: 1,
        x,
        z,
        hw: 2.2 + sanctumHash(k, ti) * 2.6,
        hl: 2.6 + sanctumHash(ti, k) * 3.0,
        rot: sanctumHash(k + 11, ti) * Math.PI,
        cosmetic: k % 2 === 1,
      });
    }
  }
  return out;
}

export interface ChannelPoint {
  x: number;
  z: number;
  /** Yards from the channel's head (the flow's coordinate). */
  s: number;
}

/** The melt channel's line resampled about every `step` yards, head to foot
 *  (the water runs from the pyres' end, [14, 30], east and down to the lip). */
export function planMeltChannel(step = 1): ChannelPoint[] {
  const out: ChannelPoint[] = [];
  let s = 0;
  for (let i = 0; i < MELT_CHANNEL.length - 1; i++) {
    const [x0, z0] = MELT_CHANNEL[i];
    const [x1, z1] = MELT_CHANNEL[i + 1];
    const len = Math.hypot(x1 - x0, z1 - z0);
    const n = Math.max(1, Math.ceil(len / step));
    for (let k = i === 0 ? 0 : 1; k <= n; k++) {
      const t = k / n;
      out.push({ x: x0 + (x1 - x0) * t, z: z0 + (z1 - z0) * t, s: s + len * t });
    }
    s += len;
  }
  return out;
}

/** The channel's running water's half width (yards). */
export const MELT_CHANNEL_HALF_WIDTH = 1.15;
