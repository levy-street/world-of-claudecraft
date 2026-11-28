// Pure: the Wind Bridge's curved current (breath_bridge.ts carries a body
// along it; render/smith_heart_fx/breath_bridge_fx.ts draws it). One curve
// from the landing's mouth (s = 0) to the Cornice's (s = 1): the isles'
// ride arc up over the chasm and down (breath_isle_geometry.ts rideArc,
// the bridge's own apex), swept sideways to the north at its middle by
// `bend` (a sine), so it is never a straight line. Both ways ride the same
// curve (home runs s from 1 to 0). A rider's own start and set-down spots
// blend in at the ends (bridgeRidePoint), so the carry never jumps.
// No SimContext, no rng, no DOM.

import { CORNICE_BRIDGE } from '../../content/smith_heart_layout';
import { rideArc } from './breath_isle_geometry';

export interface BridgePoint {
  x: number;
  y: number;
  z: number;
}

/** The current's centre at `s` (0 the landing's mouth, 1 the Cornice's),
 *  instance-local, its floors at `floorY` (the feet's line; the drawn
 *  stream wraps a body above it). */
export function bridgeCurve(s: number, floorY: number): BridgePoint {
  const B = CORNICE_BRIDGE;
  const t = Math.max(0, Math.min(1, s));
  const a = { x: B.landing.x, y: floorY, z: B.landing.z };
  const b = { x: B.cornice.x, y: floorY, z: B.cornice.z };
  const p = rideArc(a, b, t, B.apex);
  // Sideways, square to the mouths' line, to the north (+z side of it).
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const len = Math.hypot(dx, dz) || 1;
  const nx = -dz / len;
  const nz = dx / len;
  const sweep = Math.sin(Math.PI * t) * B.bend * (nz >= 0 ? 1 : -1);
  return { x: p.x + nx * sweep, y: p.y, z: p.z + nz * sweep };
}

/** Smooth 0..1 over 0..1. */
function ease(u: number): number {
  const v = Math.max(0, Math.min(1, u));
  return v * v * (3 - 2 * v);
}

/** A rider's point at `s`: the curve, with its landing-side end blended to
 *  `atLanding` and its Cornice-side end to `atCornice` (the spots the ride
 *  leaves from or sets down on, each within a few yards of its mouth), over
 *  the first and last fifth of the curve. Pure. */
export function bridgeRidePoint(
  s: number,
  floorY: number,
  atLanding: { x: number; z: number },
  atCornice: { x: number; z: number },
): BridgePoint {
  const c = bridgeCurve(s, floorY);
  const l0 = bridgeCurve(0, floorY);
  const c1 = bridgeCurve(1, floorY);
  const wl = 1 - ease(s / 0.25);
  const wc = ease((s - 0.75) / 0.25);
  return {
    x: c.x + (atLanding.x - l0.x) * wl + (atCornice.x - c1.x) * wc,
    y: c.y,
    z: c.z + (atLanding.z - l0.z) * wl + (atCornice.z - c1.z) * wc,
  };
}
