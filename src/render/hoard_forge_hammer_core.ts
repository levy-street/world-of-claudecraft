// How Emberforge's Forge Hammer LOOKS, as pure functions of one strike's clock
// (src/sim/rift/hoard_forge_hammer_core.ts): the shadow and the fall, the blow,
// the hammer lifting away, and the ring of fire with its gaps. No Three.js, no
// DOM: a Vitest imports this directly, and the adapter beside it
// (hoard_forge_hammer.ts) only copies these numbers onto meshes.

import {
  FORGE_HAMMER,
  FORGE_RING_LIFE_SEC,
  forgeBearingInGap,
  forgeRingRadius,
} from '../sim/rift/hoard_forge_hammer_core';

export const FORGE_HAMMER_LOOK = Object.freeze({
  iron: 0x2a2627,
  ironWorn: 0x5a4234,
  leather: 0x3a2014,
  molten: 0xff6a14,
  fire: 0xff8a2a,
  fireHot: 0xffd27a,
  /** Warm and pale: it belongs to the forge, and never reads as a hazard of its own. */
  door: 0xffe2a0,
  /** How far ahead of the ring a door's gate reaches before it has faded out. */
  doorReach: 7,
  shadow: 0x050302,
  scorch: 0x0c0604,
  /** How high above the floor the hammer is when it first comes into view. */
  dropHeight: 46,
  /** It stands in its crater this long, then is drawn back up out of sight. */
  restSec: 0.55,
  liftSec: 0.9,
  /** Segments round the ring: fine enough that a gap's edge is where the sim says. */
  ringSegments: 96,
  /** How tall the wall of fire stands over the burning band. */
  wallHeight: 1.7,
});

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (v: number): number => {
  const t = clamp01(v);
  return t * t * (3 - 2 * t);
};

export interface HammerPose {
  /** The shadow on the floor: how dark, and how far it has closed in. */
  shadow: number;
  shadowScale: number;
  /** The hammer: in view, and how far above its resting place. */
  visible: boolean;
  drop: number;
  /** 1 on the frame it lands, decaying: the jolt, the flash, the embers. */
  impact: number;
  /** How hot the face and the forge marks burn (they flare at the blow). */
  heat: number;
  /** The ring: its radius, how bright, and the doors through it. */
  ringRadius: number;
  ring: number;
  doors: number;
  /** The scorch left under the blow. */
  scorch: number;
}

export function hammerPose(elapsed: number, out: HammerPose): HammerPose {
  const warn = FORGE_HAMMER.warningSec;
  const warning = clamp01(elapsed / warn);
  const since = elapsed - warn;
  out.shadow = since < 0 ? 0.3 + 0.6 * smooth(warning / 0.7) : 0;
  out.shadowScale = 1.3 - 0.3 * smooth(warning);
  const fallFrom = warn - FORGE_HAMMER.fallSec;
  const falling = clamp01((elapsed - fallFrom) / FORGE_HAMMER.fallSec);
  const lifting = clamp01((since - FORGE_HAMMER_LOOK.restSec) / FORGE_HAMMER_LOOK.liftSec);
  out.visible = elapsed >= fallFrom && lifting < 1;
  // It FALLS (faster and faster), and is drawn back up the same way.
  out.drop =
    since < 0
      ? FORGE_HAMMER_LOOK.dropHeight * (1 - falling * falling)
      : FORGE_HAMMER_LOOK.dropHeight * lifting * lifting;
  out.impact = since >= 0 ? Math.max(0, 1 - since / 0.8) : 0;
  out.heat = since < 0 ? 0.45 + 0.35 * falling : 0.6 + 0.4 * out.impact;
  out.ringRadius = forgeRingRadius(since);
  const spent = clamp01(since / FORGE_RING_LIFE_SEC);
  out.ring = since < 0 || spent >= 1 ? 0 : smooth(since / 0.25) * (1 - smooth((spent - 0.8) / 0.2));
  // The doors show from the first of the shadow: where to be is known before
  // the hammer lands, never discovered as the fire arrives.
  out.doors = spent >= 1 ? 0 : since < 0 ? 0.55 * smooth(warning / 0.4) : 0.55 + 0.45 * out.ring;
  out.scorch = since < 0 ? 0 : 1 - smooth((spent - 0.6) / 0.4);
  return out;
}

/** Per ring vertex column, whether the fire burns there (1) or a door stands
 *  open (0): the sim's own gap test, sampled at the column's bearing. */
export function writeRingMask(cueId: number, out: Float32Array): void {
  const segments = out.length - 1;
  for (let column = 0; column <= segments; column++) {
    const bearing = (column / segments) * Math.PI * 2;
    out[column] = forgeBearingInGap(cueId, bearing) ? 0 : 1;
  }
}
