// The Gyre's railing: a low storm-granite wall along the path's outer lip, foot to crown, opened
// only where the launch pockets are (quartered_gyre_wind.ts) and butted against the way beacons
// (quartered_council_seat.ts), so the climb is a walk beside a drop that only the air pockets
// open onto. The wall is the painted Breath vein's own (two models cut from the Smith's Heart
// raid's kit, public/models/props/gyre_storm_wall_*.glb, stretched a little taller to read as a
// railing), laid along the lip as ZonePropsDef.fences runs of kind 'storm' (merged by
// quartered_isle.ts): the render stretches each run's modules to close it exactly and pitches them
// with the path, and the collider is the ordinary fence's, solid to a walker and cleared by an
// airborne body, so the glide off the mountain passes over every turn's railing.
//
// Pure leaf: deterministic, no rng, no SimContext.

import {
  GYRE_LAUNCH_POCKETS,
  GYRE_PATH_YARDS,
  gyreTAtYards,
  gyreYardsAtT,
} from '../quartered_gyre_wind';
import { GYRE_PEAK, gyrePathPoint } from '../quartered_landmarks';
import type { ZonePropsDef } from '../types';
import { COUNCIL_BEACON_STOPS } from './quartered_council_seat';

type FenceRun = ZonePropsDef['fences'][number];

const round2 = (v: number) => Math.round(v * 100) / 100;

/** The wall models' thickness and height, yards (render/prop_natural_size.generated.ts, which a
 *  test pins), the collider's depth and the camera-ghost top of every run. */
export const GYRE_WALL_THICK = 0.95;
export const GYRE_WALL_HEIGHT = 1.36;

/** The wall's centre line stands this far outboard of the path's centre line: its outer face
 *  flush with the path's edge (GYRE_PEAK.pathW / 2). */
export const GYRE_RAIL_OFFSET = GYRE_PEAK.pathW / 2 - GYRE_WALL_THICK / 2 - 0.02;
/** The railing starts this far up the path, so the road's foot stays open, and runs on past the
 *  last beacon to this far short of the crown: the road's last bend is walled like the rest (its lip
 *  stands well outside the plaza and the seat's lane, quartered_council_seat.ts). */
export const GYRE_RAIL_START_YD = 10;
export const GYRE_RAIL_CROWN_CLEAR_YD = 1;
/** Half the opening at each launch pocket, along the path, yards: the gap a body walks through
 *  to the lip, wider than the pocket so the run-up is clear. */
export const GYRE_RAIL_GAP_HALF = 5.5;
/** The wall stops this far short of a beacon's centre (the beacon's own plinth closes the rest). */
export const GYRE_RAIL_BEACON_CLEAR = 1.1;
/** A run's target length, yards (a straight chord of the lip; the render cuts it into modules). */
const MODULE_LEN = 6;
/** ... and never longer than this: a longer straight chord would cut a tight bend's corner (the
 *  short run past the top beacon, on the crown's last bend, is cut in two). */
const MODULE_MAX_LEN = 8;
/** A stretch shorter than this is not worth a module. */
const MIN_STRETCH = 2.5;

/** The path's lip at `yd` yards along the path: the wall's centre line there, and the unit
 *  vector out over the drop. */
export function gyreLipAt(yd: number): { x: number; z: number; ox: number; oz: number } {
  const p = gyrePathPoint(gyreTAtYards(yd));
  const dx = p.x - GYRE_PEAK.x;
  const dz = p.z - GYRE_PEAK.z;
  const r = Math.hypot(dx, dz);
  const ox = dx / r;
  const oz = dz / r;
  return { x: p.x + ox * GYRE_RAIL_OFFSET, z: p.z + oz * GYRE_RAIL_OFFSET, ox, oz };
}

export interface GyreRailStretch {
  /** yards from the foot, a to b */
  a: number;
  b: number;
}

/** The unbroken stretches of railing, foot to crown: the path's span between the foot and the
 *  crown, less each launch pocket's opening and each beacon's post. */
export function gyreRailStretches(): GyreRailStretch[] {
  const gaps: GyreRailStretch[] = [];
  for (const pocket of GYRE_LAUNCH_POCKETS) {
    const c = gyreYardsAtT(pocket.t);
    gaps.push({ a: c - GYRE_RAIL_GAP_HALF, b: c + GYRE_RAIL_GAP_HALF });
  }
  for (const t of COUNCIL_BEACON_STOPS) {
    const c = gyreYardsAtT(t);
    gaps.push({ a: c - GYRE_RAIL_BEACON_CLEAR, b: c + GYRE_RAIL_BEACON_CLEAR });
  }
  gaps.sort((m, n) => m.a - n.a);
  const out: GyreRailStretch[] = [];
  let at = GYRE_RAIL_START_YD;
  const end = GYRE_PATH_YARDS - GYRE_RAIL_CROWN_CLEAR_YD;
  for (const gap of gaps) {
    if (gap.a - at >= MIN_STRETCH) out.push({ a: at, b: Math.min(gap.a, end) });
    at = Math.max(at, gap.b);
  }
  if (end - at >= MIN_STRETCH) out.push({ a: at, b: end });
  return out;
}

/** Sample spacing along the path when a stretch's lip is measured, yards. */
const LIP_STEP = 0.25;

/** The path positions (yards from the foot) that cut a stretch of the LIP into `n` modules of
 *  equal length: the lip runs outboard of the path's centre line, so on the tight upper turns its
 *  length outruns the path's and the modules are cut by the lip's own measure. */
function lipCuts(a: number, b: number): number[] {
  const steps = Math.max(1, Math.ceil((b - a) / LIP_STEP));
  const yd: number[] = [];
  const cum: number[] = [0];
  let prev = gyreLipAt(a);
  yd.push(a);
  for (let k = 1; k <= steps; k++) {
    const y = a + ((b - a) * k) / steps;
    const p = gyreLipAt(y);
    cum.push(cum[k - 1] + Math.hypot(p.x - prev.x, p.z - prev.z));
    yd.push(y);
    prev = p;
  }
  const total = cum[steps];
  let n = Math.max(1, Math.round(total / MODULE_LEN));
  if (total / n > MODULE_MAX_LEN) n = Math.ceil(total / MODULE_MAX_LEN);
  const cuts = [a];
  let k = 0;
  for (let i = 1; i < n; i++) {
    const want = (total * i) / n;
    while (k < steps && cum[k + 1] < want) k++;
    const span = cum[k + 1] - cum[k];
    cuts.push(yd[k] + (span > 0 ? ((want - cum[k]) / span) * (yd[k + 1] - yd[k]) : 0));
  }
  cuts.push(b);
  return cuts;
}

export interface GyreRailPiece {
  x1: number;
  z1: number;
  x2: number;
  z2: number;
  /** the chord's length, yards */
  chord: number;
}

/** Every run of the railing, foot to crown: straight chords of the lip, about MODULE_LEN yards each. */
export function gyreRailPieces(): GyreRailPiece[] {
  const out: GyreRailPiece[] = [];
  for (const s of gyreRailStretches()) {
    const cuts = lipCuts(s.a, s.b);
    for (let i = 0; i + 1 < cuts.length; i++) {
      const p0 = gyreLipAt(cuts[i]);
      const p1 = gyreLipAt(cuts[i + 1]);
      out.push({
        x1: p0.x,
        z1: p0.z,
        x2: p1.x,
        z2: p1.z,
        chord: Math.hypot(p1.x - p0.x, p1.z - p0.z),
      });
    }
  }
  return out;
}

/** The railing's fence runs, in a stable order (ZonePropsDef.fences, kind 'storm'). */
export function gyreRailFences(): FenceRun[] {
  return gyreRailPieces().map(
    (p): FenceRun => ({
      x1: round2(p.x1),
      z1: round2(p.z1),
      x2: round2(p.x2),
      z2: round2(p.z2),
      kind: 'storm',
      width: GYRE_WALL_THICK,
      height: GYRE_WALL_HEIGHT,
    }),
  );
}
