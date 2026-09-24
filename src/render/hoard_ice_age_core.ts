// How Hoarfrost's Ice Age LOOKS, as pure functions of the shared clock
// (src/sim/rift/hoard_ice_age_core.ts): the falling icicle, the pillar's strain
// and break-up, the storm's build and sweep, and the lee painted on the floor.
// No Three.js, no DOM: a Vitest imports this directly, and the adapter beside it
// (hoard_ice_age.ts) only copies these numbers onto meshes.

import {
  ICE_AGE,
  type IceAgeTimeline,
  iceAgeTimeline,
  iceCoverHalfWidth,
} from '../sim/rift/hoard_ice_age_core';

export const ICE_AGE_LOOK = Object.freeze({
  ice: 0x6bb8f5,
  iceDeep: 0x1f5ccc,
  frost: 0xeef7ff,
  glow: 0xb3f2ff,
  storm: 0xdff4ff,
  shadow: 0x04070c,
  // Hoarfrost's arena is snow: whatever must read on the FLOOR is a saturated
  // blue laid over it, never white light added to white.
  lee: 0x0f52c8,
  leeEdge: 0x052a70,
  gust: 0x5a8fe2,
  chill: 0x2f6fd8,
  wave: 0x1456dc,
  /** How high above the floor the icicle is when it first comes into view. */
  dropHeight: 52,
  /** The storm's own pace, in yards per second, as the cast builds and at the blast. */
  windCastSpeed: 9,
  windCastSpeedEnd: 30,
  windBlastSpeed: 78,
  /** How far the floor frost has crept from the boss by the end of the cast. */
  frostReach: 46,
  /** The pressure wave's pace and life at the blast. */
  waveSpeed: 95,
  waveSec: 0.7,
  /** Segments along the lee painted behind a pillar. */
  leeSegments: 10,
  /** Chunk flight: outward speed, lift, gravity, tumble. */
  chunkSpeed: 7.5,
  chunkLift: 8.5,
  chunkGravity: 19,
  chunkSpin: 5.2,
});

const LINE: IceAgeTimeline = {
  impactAt: 0,
  castAt: 0,
  castSec: 0,
  blastAt: 0,
  breakAt: 0,
  endAt: 0,
};
const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (v: number): number => {
  const t = clamp01(v);
  return t * t * (3 - 2 * t);
};

export interface IciclePose {
  /** The shadow on the floor: how dark, and how far it has closed in. */
  shadow: number;
  shadowScale: number;
  /** Ice dust sifting down ahead of it. */
  dust: number;
  /** The icicle itself: in view, and how far above its resting place. */
  visible: boolean;
  drop: number;
  /** 1 on the frame it lands, decaying: the jolt, the ring, the burst. */
  impact: number;
  /** The lee on the floor: 0 hidden, up to 1 as the cast peaks. */
  lee: number;
  /** The seams' glow: a faint life while it stands, straining as the storm hits. */
  crack: number;
  /** Shaking under the storm's force, in yards. */
  shake: number;
  /** 0 intact, up to 1 across the break-up. */
  shatter: number;
  /** The frost and mist left at its foot. */
  mist: number;
}

export function iciclePose(elapsed: number, total: number, out: IciclePose): IciclePose {
  const line = iceAgeTimeline(total, LINE);
  const fallFrom = line.impactAt - ICE_AGE.pillarFallSec;
  const warning = clamp01(elapsed / line.impactAt);
  out.shadow = elapsed < line.impactAt ? 0.25 + 0.6 * smooth(warning / 0.65) : 0;
  out.shadowScale = 1.25 - 0.25 * smooth(warning);
  out.dust = elapsed < line.impactAt ? smooth((warning - 0.4) / 0.3) : 0;
  out.visible = elapsed >= fallFrom && elapsed < line.endAt;
  // An accelerating fall: it is a falling object, never a lowered prop.
  const falling = clamp01((elapsed - fallFrom) / ICE_AGE.pillarFallSec);
  out.drop = elapsed < line.impactAt ? ICE_AGE_LOOK.dropHeight * (1 - falling * falling) : 0;
  const sinceImpact = elapsed - line.impactAt;
  out.impact = sinceImpact >= 0 ? Math.max(0, 1 - sinceImpact / 0.9) : 0;
  const casting = clamp01((elapsed - line.castAt) / Math.max(1e-6, line.castSec));
  out.lee =
    elapsed < line.impactAt || elapsed >= line.breakAt
      ? 0
      : 0.35 * smooth(sinceImpact / 0.6) + 0.65 * smooth(casting * 1.6);
  const sinceBlast = elapsed - line.blastAt;
  out.crack = sinceBlast >= 0 ? 1 : 0.12 + 0.3 * casting * casting;
  out.shake =
    sinceBlast >= 0 && elapsed < line.breakAt
      ? 0.16
      : sinceBlast < 0
        ? 0.03 * casting * casting
        : 0;
  out.shatter = clamp01((elapsed - line.breakAt) / ICE_AGE.pillarShatterSec);
  out.mist = out.shatter > 0 ? Math.sin(Math.PI * clamp01(out.shatter * 1.05)) : out.impact * 0.7;
  return out;
}

export interface ChunkFlight {
  x: number;
  y: number;
  z: number;
  spin: number;
  scale: number;
}

/** One chunk's place `progress` (0 to 1) through the break-up. `outX/outZ` is the
 *  unit direction it is thrown (away from the pillar's axis, carried downwind),
 *  `height` where it sat, `vigor` a per-chunk 0.7 to 1.3. Closed form: the same
 *  frame every time, no simulation, and it never sinks through the floor. */
export function chunkFlight(
  progress: number,
  outX: number,
  outZ: number,
  height: number,
  vigor: number,
  out: ChunkFlight,
): ChunkFlight {
  const t = clamp01(progress) * ICE_AGE.pillarShatterSec;
  const speed = ICE_AGE_LOOK.chunkSpeed * vigor;
  out.x = outX * speed * t;
  out.z = outZ * speed * t;
  const rise = ICE_AGE_LOOK.chunkLift * vigor * (0.35 + 0.65 * clamp01(height / 10));
  const y = rise * t - 0.5 * ICE_AGE_LOOK.chunkGravity * t * t;
  // It lands and lies where it fell: never below the floor it started above.
  out.y = Math.max(-height, y);
  out.spin = ICE_AGE_LOOK.chunkSpin * vigor * t;
  out.scale = 1 - smooth((progress - 0.55) / 0.45);
  return out;
}

export interface StormPose {
  /** The boss gathering frost: 0 to 1 across the cast, gone at the blast. */
  gather: number;
  /** Frost creeping over the floor from the boss, in yards. */
  frostRadius: number;
  frost: number;
  /** The wind: how fast its snow runs and how much of it shows. */
  windSpeed: number;
  wind: number;
  /** The blast's pressure wave: its radius, and 1 to 0 as it spends itself. */
  waveRadius: number;
  wave: number;
  /** Whether the pillars still stand to split the wind. */
  sheltering: boolean;
}

export function stormPose(elapsed: number, total: number, out: StormPose): StormPose {
  const line = iceAgeTimeline(total, LINE);
  const casting = clamp01((elapsed - line.castAt) / Math.max(1e-6, line.castSec));
  const sinceBlast = elapsed - line.blastAt;
  const blasting = sinceBlast >= 0;
  const spent = blasting ? clamp01(sinceBlast / ICE_AGE.blizzardSec) : 0;
  out.gather = blasting || elapsed < line.castAt ? 0 : smooth(casting);
  out.frostRadius = ICE_AGE_LOOK.frostReach * (blasting ? 1 : smooth(casting));
  out.frost = elapsed < line.castAt ? 0 : blasting ? 0.5 * (1 - smooth(spent)) : 0.5 * casting;
  out.windSpeed = blasting
    ? ICE_AGE_LOOK.windBlastSpeed * (1 - 0.6 * smooth(spent))
    : ICE_AGE_LOOK.windCastSpeed +
      (ICE_AGE_LOOK.windCastSpeedEnd - ICE_AGE_LOOK.windCastSpeed) * casting * casting;
  out.wind =
    elapsed < line.castAt ? 0 : blasting ? 1 - smooth((spent - 0.55) / 0.45) : 0.12 + 0.5 * casting;
  out.waveRadius = blasting ? ICE_AGE_LOOK.waveSpeed * sinceBlast : 0;
  out.wave = blasting ? Math.max(0, 1 - sinceBlast / ICE_AGE_LOOK.waveSec) : 0;
  out.sheltering = elapsed >= line.impactAt && elapsed < line.breakAt;
  return out;
}

/** The lee behind a pillar, written as a triangle strip of floor points (x, z
 *  pairs, left then right, `leeSegments + 1` rows) into `out`. It is the sim's
 *  own cover test drawn: the same bearing, reach and widening. Returns rows. */
export function writeLeeStrip(
  originX: number,
  originZ: number,
  pillarX: number,
  pillarZ: number,
  out: Float32Array,
): number {
  const dx = pillarX - originX;
  const dz = pillarZ - originZ;
  const distance = Math.hypot(dx, dz);
  const rows = ICE_AGE_LOOK.leeSegments + 1;
  if (distance < 1e-6) return 0;
  const ux = dx / distance;
  const uz = dz / distance;
  const reach = ICE_AGE.coverDistance + ICE_AGE.pillarRadius;
  for (let row = 0; row < rows; row++) {
    const behind = (reach * row) / ICE_AGE_LOOK.leeSegments;
    const along = distance + behind;
    const half = iceCoverHalfWidth(along, distance);
    const cx = originX + ux * along;
    const cz = originZ + uz * along;
    // Across the bearing: (uz, -ux) is its right-hand normal.
    out[row * 4] = cx - uz * half;
    out[row * 4 + 1] = cz + ux * half;
    out[row * 4 + 2] = cx + uz * half;
    out[row * 4 + 3] = cz - ux * half;
  }
  return rows;
}
