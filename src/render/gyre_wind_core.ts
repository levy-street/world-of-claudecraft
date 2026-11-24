// The Gyre's wind, as geometry (src/sim/quartered_gyre_wind.ts): translucent ribbons of air that
// sweep up every gale lane in long S-curves, the leaves and feathers they carry, thin chevrons
// carved in the road where the wind passes over it, and at each launch pocket a spiral of wisps
// rising out of a mist. Pure core: no Three, no DOM, no clock; the painter (gyre_wind.ts) turns
// these arrays into meshes and animates them.
//
// Cosmetic only: the wind's pace and the launches are the sim's (an aura), identical on every
// graphics tier; this is the drawing of them. Everything is deterministic (the sim's coordinate
// hash, never Math.random), so every client draws the same wind.

import { GYRE_WIND_PADS } from '../sim/quartered_gyre_pads';
import {
  GYRE_LAUNCH_POCKETS,
  GYRE_PATH_YARDS,
  GYRE_WIND_LANES,
  type GyreWindLane,
  gyreTAtYards,
} from '../sim/quartered_gyre_wind';
import { GYRE_PEAK, gyrePathPoint } from '../sim/quartered_landmarks';
import { hash2 } from '../sim/rng';

const TAU = Math.PI * 2;

/** A point on the path's centre line, with the unit vectors out over the drop and up the climb. */
export interface LaneSample {
  x: number;
  z: number;
  /** out over the drop (away from the peak's axis) */
  ox: number;
  oz: number;
  /** up the climb (the way the wind blows) */
  tx: number;
  tz: number;
  /** yards from the range's start */
  along: number;
}

/** The path between `yd0` and `yd1` (yards from its foot) sampled every `step` yards, both ends
 *  included, with its frames. */
export function sampleRange(yd0: number, yd1: number, step: number): LaneSample[] {
  const len = yd1 - yd0;
  const n = Math.max(1, Math.round(len / step));
  const pts: { x: number; z: number; along: number }[] = [];
  for (let k = 0; k <= n; k++) {
    const along = (len * k) / n;
    const p = gyrePathPoint(gyreTAtYards(yd0 + along));
    pts.push({ x: p.x, z: p.z, along });
  }
  return pts.map((p, k) => {
    const a = pts[Math.max(0, k - 1)];
    const b = pts[Math.min(n, k + 1)];
    const tl = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    const dx = p.x - GYRE_PEAK.x;
    const dz = p.z - GYRE_PEAK.z;
    const r = Math.hypot(dx, dz) || 1;
    return {
      x: p.x,
      z: p.z,
      ox: dx / r,
      oz: dz / r,
      tx: (b.x - a.x) / tl,
      tz: (b.z - a.z) / tl,
      along: p.along,
    };
  });
}

/** The lane's centre line sampled every `step` yards (both ends included), with its frames. */
export function sampleLane(lane: GyreWindLane, step: number): LaneSample[] {
  return sampleRange(lane.yd0, lane.yd1, step);
}

export interface RibbonGeometry {
  positions: Float32Array;
  uvs: Float32Array;
  indices: Uint32Array;
}

// ---- the carved chevrons ------------------------------------------------------------------

export interface RibbonOptions {
  /** the ribbon's width across the road, yards */
  width: number;
  /** sample spacing along it, yards */
  step: number;
  /** how far above the ground it lies, yards */
  lift: number;
  /** yards of lane per repeat of the chevron texture */
  tile: number;
}

/** One strip per lane merged into a single geometry: `width` wide, centred on the road, lifted
 *  `lift` over `groundAt`, for the thin chevrons carved in the flagstones. u runs across (0 on the
 *  drop side, 1 on the climb's inside), v along the lane in texture repeats, increasing up the
 *  climb, continuing lane to lane so no two neighbours repeat in step. */
export function buildLaneRibbons(
  lanes: readonly GyreWindLane[],
  groundAt: (x: number, z: number) => number,
  opt: RibbonOptions,
): RibbonGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (const lane of lanes) {
    const samples = sampleLane(lane, opt.step);
    const base = pos.length / 3;
    const v0 = lane.yd0 / opt.tile;
    for (const s of samples) {
      for (const side of [1, -1]) {
        // +ox is the drop side: u = 0 there
        const x = s.x + s.ox * side * (opt.width / 2);
        const z = s.z + s.oz * side * (opt.width / 2);
        pos.push(x, groundAt(x, z) + opt.lift, z);
        uv.push(side > 0 ? 0 : 1, v0 + s.along / opt.tile);
      }
    }
    for (let k = 0; k + 1 < samples.length; k++) {
      const a = base + k * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  return {
    positions: new Float32Array(pos),
    uvs: new Float32Array(uv),
    indices: new Uint32Array(idx),
  };
}

// ---- the wind's ribbons -------------------------------------------------------------------

/** Ribbons of air a lane carries. */
export const STRANDS_PER_LANE = 5;
/** A strand reaches this far past each end of its lane (a little more by chance), so the lanes'
 *  wind runs on into the gaps and the climb reads as one stream. */
const STRAND_EXT = 3;
/** Sample spacing along a strand, yards. */
export const STRAND_STEP = 0.75;
/** A strand stays this far from the road's centre line at most: inside the railing. */
const MAX_LATERAL = 3.0;
/** Yards of strand per repeat of the wisp texture. */
export const WISP_TILE = 5;

/** One ribbon of air: its centre line (xyz per sample, `step` yards apart) and its look. */
export interface WindStrand {
  lane: number;
  /** span on the path, yards from its foot */
  yd0: number;
  yd1: number;
  len: number;
  step: number;
  width: number;
  /** 0 lies flat, PI/2 stands on edge */
  tilt: number;
  /** the texture's offset along the strand, so no two strands show the same dashes */
  vOffset: number;
  /** xyz per sample */
  pts: Float32Array;
}

/** How far a strand sits off the road's centre line `s` yards along it, two sines summed and
 *  held inside the railing (`MAX_LATERAL`): positive is out over the drop. */
export function strandLateral(
  s: number,
  amp: number,
  wave: number,
  phase: number,
  amp2: number,
  wave2: number,
  phase2: number,
): number {
  const lat =
    amp * Math.sin((TAU * s) / wave + phase) + amp2 * Math.sin((TAU * s) / wave2 + phase2);
  return Math.max(-MAX_LATERAL, Math.min(MAX_LATERAL, lat));
}

/** Every gale lane's ribbons of air: sweeping S-curves across the road at different heights and
 *  tilts, thin at their ends, laid over `groundAt`. */
export function buildLaneStrands(
  lanes: readonly GyreWindLane[],
  groundAt: (x: number, z: number) => number,
): WindStrand[] {
  const out: WindStrand[] = [];
  const tilts = [0, 0.7, 1.35, 1.57, 2.2];
  lanes.forEach((lane, li) => {
    for (let j = 0; j < STRANDS_PER_LANE; j++) {
      const h = (k: number) => hash2(li * 31 + j, k, 0x57a1);
      const yd0 = Math.max(0, lane.yd0 - STRAND_EXT - h(1) * 2);
      const yd1 = Math.min(GYRE_PATH_YARDS, lane.yd1 + STRAND_EXT + h(2) * 2);
      const samples = sampleRange(yd0, yd1, STRAND_STEP);
      const amp = 0.9 + h(5) * 1.3;
      const wave = 9 + h(6) * 9;
      const phase = h(7) * TAU;
      const amp2 = 0.3 + h(8) * 0.5;
      const wave2 = 4 + h(9) * 4;
      const phase2 = h(10) * TAU;
      const lift = 0.35 + h(4) * 1.5;
      const pts = new Float32Array(samples.length * 3);
      samples.forEach((s, k) => {
        const lat = strandLateral(s.along, amp, wave, phase, amp2, wave2, phase2);
        const x = s.x + s.ox * lat;
        const z = s.z + s.oz * lat;
        const bob = 0.25 * Math.sin((TAU * s.along) / (wave * 0.8) + phase2 * 1.3);
        pts[k * 3] = x;
        pts[k * 3 + 1] = groundAt(x, z) + lift + bob;
        pts[k * 3 + 2] = z;
      });
      out.push({
        lane: li,
        yd0,
        yd1,
        len: yd1 - yd0,
        // the span is cut into whole samples, so the true spacing is a hair off the nominal one
        step: (yd1 - yd0) / (samples.length - 1),
        width: 0.7 + h(3) * 0.8,
        tilt: tilts[j % tilts.length] + (h(11) - 0.5) * 0.3,
        vOffset: h(12) * 3,
        pts,
      });
    }
  });
  return out;
}

/** The strand's centre line at `s` yards along it (clamped), interpolated, written into `out`. */
export function strandPointAt(
  st: Pick<WindStrand, 'pts' | 'step' | 'len'>,
  s: number,
  out: { x: number; y: number; z: number },
): void {
  const n = st.pts.length / 3 - 1;
  const f = Math.max(0, Math.min(n, s / st.step));
  const k = Math.min(n - 1, Math.floor(f));
  const u = f - k;
  out.x = st.pts[k * 3] + (st.pts[k * 3 + 3] - st.pts[k * 3]) * u;
  out.y = st.pts[k * 3 + 1] + (st.pts[k * 3 + 4] - st.pts[k * 3 + 1]) * u;
  out.z = st.pts[k * 3 + 2] + (st.pts[k * 3 + 5] - st.pts[k * 3 + 2]) * u;
}

/** A ribbon along a centre line (xyz per sample), `width` wide, tilted about its direction of
 *  travel, thin toward both ends. u runs across (0..1), v along it in texture repeats of `tile`
 *  yards (the horizontal distance walked, plus `vOffset`). Appends to the given arrays. */
function pushRibbon(
  pts: ArrayLike<number>,
  count: number,
  width: number,
  tilt: number,
  tile: number,
  vOffset: number,
  pos: number[],
  uv: number[],
  idx: number[],
): void {
  const base = pos.length / 3;
  const c = Math.cos(tilt);
  const sn = Math.sin(tilt);
  let run = 0;
  for (let k = 0; k < count; k++) {
    const a = Math.max(0, k - 1);
    const b = Math.min(count - 1, k + 1);
    const dx = pts[b * 3] - pts[a * 3];
    const dz = pts[b * 3 + 2] - pts[a * 3 + 2];
    const dl = Math.hypot(dx, dz) || 1;
    // horizontal perpendicular to the way the ribbon runs, and straight up, mixed by the tilt
    const wx = (-dz / dl) * c;
    const wz = (dx / dl) * c;
    const wy = sn;
    const f = count > 1 ? k / (count - 1) : 0.5;
    const taper = Math.sin(Math.PI * f) ** 0.7;
    const half = (width / 2) * taper;
    if (k > 0) {
      run += Math.hypot(pts[k * 3] - pts[(k - 1) * 3], pts[k * 3 + 2] - pts[(k - 1) * 3 + 2]);
    }
    const v = vOffset + run / tile;
    pos.push(
      pts[k * 3] - wx * half,
      pts[k * 3 + 1] - wy * half,
      pts[k * 3 + 2] - wz * half,
      pts[k * 3] + wx * half,
      pts[k * 3 + 1] + wy * half,
      pts[k * 3 + 2] + wz * half,
    );
    uv.push(0, v, 1, v);
  }
  for (let k = 0; k + 1 < count; k++) {
    const q = base + k * 2;
    idx.push(q, q + 1, q + 2, q + 1, q + 3, q + 2);
  }
}

/** Every strand as ribbons, merged into one geometry. */
export function buildStrandRibbons(strands: readonly WindStrand[]): RibbonGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (const st of strands) {
    pushRibbon(st.pts, st.pts.length / 3, st.width, st.tilt, WISP_TILE, st.vOffset, pos, uv, idx);
  }
  return {
    positions: new Float32Array(pos),
    uvs: new Float32Array(uv),
    indices: new Uint32Array(idx),
  };
}

// ---- the pockets' spiral of wisps ----------------------------------------------------------

/** Wisps in each pocket's updraft. */
export const SPIRAL_STRANDS = 6;
/** Samples along one spiral wisp. */
const SPIRAL_SAMPLES = 30;
/** Yards of spiral per repeat of the wisp texture. */
const SPIRAL_TILE = 3.2;

/** How far the spiral leans toward the mountain, yards inward for every yard it rises: the wind of
 *  a pocket carries a body up AND in, over the face to the next turn, and the column bends the way
 *  the lift goes. */
export const SPIRAL_LEAN = 0.45;

export interface PocketSpot {
  x: number;
  y: number;
  z: number;
  /** the unit vector out over the drop; the spiral leans the other way (none: it stands upright) */
  ox?: number;
  oz?: number;
}

/** The pockets' spirals, merged into one geometry in world space: thin wisps of air twisting up
 *  around each other out of the pad, leaning in toward the mountain the way the lift goes, some
 *  turning one way and some the other, standing on edge or leaning flat so one or the other faces
 *  the eye from any side. */
export function buildPocketSpirals(spots: readonly PocketSpot[]): RibbonGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  spots.forEach((spot, pi) => {
    for (let j = 0; j < SPIRAL_STRANDS; j++) {
      const h = (k: number) => hash2(pi * 13 + j, k, 0x9d17);
      const height = 11 + h(1) * 5;
      const turns = 1.1 + h(2) * 0.9;
      const r0 = 0.45 + h(3) * 0.45;
      const r1 = 1.3 + h(4) * 0.9;
      const phase = h(5) * TAU;
      const dir = j % 2 === 0 ? 1 : -1;
      const pts = new Float32Array(SPIRAL_SAMPLES * 3);
      for (let k = 0; k < SPIRAL_SAMPLES; k++) {
        const t = k / (SPIRAL_SAMPLES - 1);
        const a = phase + dir * TAU * turns * t;
        const r = r0 + (r1 - r0) * t ** 0.8;
        const lean = SPIRAL_LEAN * height * t;
        pts[k * 3] = spot.x + Math.cos(a) * r - (spot.ox ?? 0) * lean;
        pts[k * 3 + 1] = spot.y + 0.1 + height * t;
        pts[k * 3 + 2] = spot.z + Math.sin(a) * r - (spot.oz ?? 0) * lean;
      }
      const tilt = j % 3 === 2 ? 0.9 : 1.5;
      pushRibbon(pts, SPIRAL_SAMPLES, 0.5 + h(6) * 0.45, tilt, SPIRAL_TILE, h(7) * 3, pos, uv, idx);
    }
  });
  return {
    positions: new Float32Array(pos),
    uvs: new Float32Array(uv),
    indices: new Uint32Array(idx),
  };
}

// ---- the leaves and feathers ---------------------------------------------------------------

export type MoteKind = 'leaf' | 'feather';

/** A leaf or a feather the wind carries along one of its strands. */
export interface WindMote {
  kind: MoteKind;
  /** index into the strand list */
  strand: number;
  /** where along the strand it starts, yards, and how fast it is carried, yards a second */
  s0: number;
  speed: number;
  /** how far it drifts off the strand's centre line, yards (sideways, up) */
  drift: [number, number];
  /** its tumble: radians a second about each axis, and the starting angles */
  spin: [number, number, number];
  angle: [number, number, number];
  /** its size, yards */
  size: number;
}

export const LEAVES_PER_LANE = 5;
export const FEATHERS_PER_LANE = 2;

/** Leaves and feathers riding every lane's strands. */
export function buildWindMotes(strands: readonly WindStrand[]): WindMote[] {
  const out: WindMote[] = [];
  const lanes = new Map<number, number[]>();
  strands.forEach((st, i) => {
    const list = lanes.get(st.lane) ?? [];
    list.push(i);
    lanes.set(st.lane, list);
  });
  for (const [lane, list] of lanes) {
    const make = (kind: MoteKind, n: number) => {
      const h = (k: number) => hash2(lane * 53 + n, k, kind === 'leaf' ? 0x1ea7 : 0xfea7);
      const strand = list[Math.floor(h(1) * list.length) % list.length];
      const st = strands[strand];
      out.push({
        kind,
        strand,
        s0: h(2) * st.len,
        speed: 7 + h(3) * 5,
        drift: [(h(4) - 0.5) * 0.9, (h(5) - 0.3) * 0.7],
        spin: [(h(6) - 0.5) * 6, (h(7) - 0.5) * 6, (h(8) - 0.5) * 6],
        angle: [h(9) * TAU, h(10) * TAU, h(11) * TAU],
        size: kind === 'leaf' ? 0.34 + h(12) * 0.3 : 0.5 + h(12) * 0.35,
      });
    };
    for (let n = 0; n < LEAVES_PER_LANE; n++) make('leaf', n);
    for (let n = 0; n < FEATHERS_PER_LANE; n++) make('feather', n + 40);
  }
  return out;
}

export interface MotePose {
  x: number;
  y: number;
  z: number;
  rx: number;
  ry: number;
  rz: number;
}

/** Where a mote is `t` seconds in: carried along its strand (wrapping to the start when it
 *  reaches the end), drifting a little off it, tumbling. Written into `out`. */
export function motePose(m: WindMote, st: WindStrand, t: number, out: MotePose): void {
  const s = (((m.s0 + m.speed * t) % st.len) + st.len) % st.len;
  strandPointAt(st, s, out);
  const sway = Math.sin(t * 1.7 + m.angle[0]);
  out.x += m.drift[0] * sway;
  out.y += m.drift[1] * (0.6 + 0.4 * Math.sin(t * 2.3 + m.angle[1]));
  out.z += m.drift[0] * Math.cos(t * 1.3 + m.angle[2]);
  out.rx = m.angle[0] + m.spin[0] * t;
  out.ry = m.angle[1] + m.spin[1] * t;
  out.rz = m.angle[2] + m.spin[2] * t;
}

/** The four pockets' standing places (the centre of each updraft, on the path's surface). */
export function pocketSpots(): readonly {
  x: number;
  y: number;
  z: number;
  ox: number;
  oz: number;
}[] {
  return GYRE_LAUNCH_POCKETS;
}

/** The two wind pads' updrafts (quartered_gyre_pads.ts): standing upright on the ground at each
 *  pad's centre, the foot pad's by Gyrefoot Rest and the crown pad's on the crown, drawn with the
 *  pockets' spiral and mist so they read as the same wind. */
export function padSpots(ground: (x: number, z: number) => number): PocketSpot[] {
  return GYRE_WIND_PADS.map((pad) => ({ x: pad.x, y: ground(pad.x, pad.z), z: pad.z }));
}

/** All lanes (re-exported so a painter needs only this core and the sim's lane list). */
export const WIND_LANES = GYRE_WIND_LANES;
