// The Wind Bridge's look, pure (breath_bridge_fx.ts paints it; the sim is
// encounters/smith_heart/breath_bridge.ts, its curve breath_bridge_path.ts).
// A magical jet stream over the chasm: a tunnel of fast-flowing wind streaks
// along the SAME curve a rider is carried on, a bright core and strands of
// wind wound round it, gust pulses racing along it and small electric arcs
// jumping along and around it; a swirling mouth at each end. It forms over
// BRIDGE_TUNING.form seconds and dissolves over `dissolve` on the pull;
// nothing of it is drawn once dissolved. The same on every tier.

import { BRIDGE_TUNING } from '../../sim/encounters/smith_heart/breath_bridge_ids';
import { type BridgePoint, bridgeCurve } from '../../sim/encounters/smith_heart/breath_bridge_path';

/** The stream's look: the tunnel's radius (yards), how high over the
 *  rider's feet line its middle runs (a body's middle), samples along the
 *  curve, the strands wound round it and their turns over the whole
 *  stream, and the lightning: how many arcs at once, their segments, how
 *  often they jump (seconds) and how far an arc reaches along the stream. */
export const BRIDGE_LOOK = {
  radius: 1.5,
  lift: 1.1,
  samples: 72,
  strands: 4,
  turns: 5,
  arcs: 5,
  arcSegments: 6,
  arcEvery: 0.09,
  arcReach: 2.4,
} as const;

/** The stream's centre line, `n` + 1 points along the bridge's curve, lifted
 *  to a body's middle (the curve is the feet's). Pure. */
export function bridgeStreamPath(floorY: number, n: number = BRIDGE_LOOK.samples): BridgePoint[] {
  const out: BridgePoint[] = [];
  for (let i = 0; i <= n; i++) {
    const p = bridgeCurve(i / n, floorY);
    out.push({ x: p.x, y: p.y + BRIDGE_LOOK.lift, z: p.z });
  }
  return out;
}

/** The unit side and up across `path` at sample `i` (side level, up square
 *  to the line and the side). */
function frameAt(
  path: readonly BridgePoint[],
  i: number,
): { sx: number; sz: number; ux: number; uy: number; uz: number } {
  const n = path.length - 1;
  const a = path[Math.max(0, i - 1)];
  const b = path[Math.min(n, i + 1)];
  let tx = b.x - a.x;
  let ty = b.y - a.y;
  let tz = b.z - a.z;
  const tl = Math.hypot(tx, ty, tz) || 1;
  tx /= tl;
  ty /= tl;
  tz /= tl;
  const sl = Math.hypot(tz, tx) || 1;
  const sx = -tz / sl;
  const sz = tx / sl;
  return { sx, sz, ux: ty * sz, uy: tz * sx - tx * sz, uz: -ty * sx };
}

/** A point `r` yards off `path` at sample `i`, at angle `ang` round it. Pure. */
export function streamOffset(
  path: readonly BridgePoint[],
  i: number,
  ang: number,
  r: number,
): BridgePoint {
  const f = frameAt(path, i);
  const p = path[i];
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  return {
    x: p.x + (f.sx * c + f.ux * s) * r,
    y: p.y + f.uy * s * r,
    z: p.z + (f.sz * c + f.uz * s) * r,
  };
}

/** Strand `k`'s points wound round `path` (a helix, its phase `k` of the
 *  strands round; it rises out of the mouths, tight at the ends). Pure. */
export function bridgeStrand(path: readonly BridgePoint[], k: number): BridgePoint[] {
  const L = BRIDGE_LOOK;
  const n = path.length - 1;
  const out: BridgePoint[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const ang = t * L.turns * Math.PI * 2 + (k / L.strands) * Math.PI * 2;
    const r = L.radius * 0.8 * (0.35 + 0.65 * Math.sin(Math.PI * t) ** 0.6);
    out.push(streamOffset(path, i, ang, r));
  }
  return out;
}

/** One electric arc along the stream: from a point on its skin at sample
 *  `i`, angle `ang`, to one `arcReach` yards on, jagged by `rand` (0..1, a
 *  cosmetic source), `arcSegments` + 1 points. Pure. */
export function bridgeArc(
  path: readonly BridgePoint[],
  i: number,
  ang: number,
  rand: () => number,
): BridgePoint[] {
  const L = BRIDGE_LOOK;
  const n = path.length - 1;
  const step = Math.max(1, Math.round((L.arcReach / 25) * n));
  const j = Math.min(n, i + step);
  const a = streamOffset(path, i, ang, L.radius * 0.9);
  const b = streamOffset(path, j, ang + (rand() - 0.5) * 1.6, L.radius * 0.9);
  const out: BridgePoint[] = [];
  for (let k = 0; k <= L.arcSegments; k++) {
    const u = k / L.arcSegments;
    const jag = k === 0 || k === L.arcSegments ? 0 : 0.45;
    out.push({
      x: a.x + (b.x - a.x) * u + (rand() - 0.5) * jag,
      y: a.y + (b.y - a.y) * u + (rand() - 0.5) * jag,
      z: a.z + (b.z - a.z) * u + (rand() - 0.5) * jag,
    });
  }
  return out;
}

/** One frame of the bridge's form (0 gone, 1 whole): toward whole over
 *  `form` seconds while it stands (`up`), toward gone over `dissolve` while
 *  it does not. Pure. */
export function stepBridgeForm(form: number, up: boolean, dt: number): number {
  const T = BRIDGE_TUNING;
  return up ? Math.min(1, form + dt / T.form) : Math.max(0, form - dt / T.dissolve);
}

/** Is anything of it drawn at form `f`? (Nothing once dissolved: no light,
 *  no arc, no mote in the fight.) */
export function bridgeShown(f: number): boolean {
  return f > 0.001;
}
