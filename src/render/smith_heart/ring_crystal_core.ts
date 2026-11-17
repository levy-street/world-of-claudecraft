// Pure plan of the ring crystal (ring_crystal.ts paints it): the heart seal at the
// Ring's centre, ONE crystal that holds the four elements (the owner's ask of
// 2026-11-18: "a crystal connection that lights up", replacing the four granite
// quarters and the four spires). Its model is the Tripo build of the ChatGPT sheet
// (docs/design/raid/kit/ring_crystal_src/README.md): the Hammer's amber south, the
// Breath's storm north, the Quench's ice east, the Heat's fire west, round a
// white-gold heart, each vertex carrying its element weights.
//
//   a vein lights: its light RUNS to the seal (heart_rivers), arrives in the plinth's
//     channel on its side and CLIMBS that element's crystal behind a white-hot front
//     (the same fill timeline the quarters had: heartSealQuarterFill/Level); the heart
//     (white-gold) glows as the four fill;
//   ready (all four lit and the Ring clear, the READY bit): the whole crystal swells and
//     pulses, the sign that it can be shattered by hand;
//   the burst (the seal markers' portal bit, set when a player breaks it): the crystal
//     overloads for `HEART_PORTAL_OPEN.charge`, then shatters; its pieces (the model's
//     own shells, grouped) fly out, the crystal's pieces tumbling on into an orbit round
//     the portal funnel for good, the plinth's stones falling away.
//
// Pure and Three-free (the clock is passed in, render seconds).

import { HEART_PORTAL_OPEN, heartPortalStage } from './heart_portal_core';
import {
  HEART_SEAL_ARRIVAL,
  HEART_SEAL_FILL_SECONDS,
  heartSealQuarterFill,
  heartSealQuarterLevel,
} from './heart_seal_core';

/** The model's size (yards): its height and its plinth's reach (the Blender build's `--reach`
 *  puts the widest shard on the seal's inner circle, 8.6 yd; the plinth's stones stand at
 *  8.47). Pinned against the shipped GLB by tests/smith_heart_ring_crystal.test.ts. */
export const RING_CRYSTAL = { height: 18.85, plinthR: 8.47 } as const;

/** The crystal's click volume (ring_crystal_pick.ts): a frustum as wide as the plinth at
 *  its foot and narrowing toward the tip, so a click anywhere on the crystal's silhouette
 *  is a click on its entity (the sim's press, encounters/smith_heart/seal_burst.ts), and
 *  the height its entity's overhead label hangs at. */
export const RING_CRYSTAL_CLICK = {
  baseR: 8,
  topR: 4.5,
  height: RING_CRYSTAL.height,
  labelHeight: 8,
} as const;

/** The crystal's look (ring_crystal_material.ts reads it as three uniforms). The painting is
 *  the owner's approved concept, so every number here keeps its four colours: nothing adds a
 *  light of one colour over the crystal (the first cut washed the four elements out to
 *  white-gold). Dormant is the painting dimmed and cooled, its hues still readable; lit is the
 *  painting at full and over, its saturated cores burning deeper and only its brightest facets
 *  going white-hot; ready makes the whole crystal breathe, never tints it.
 *    dormantBright / dormantSat   the unlit painting's value and how much of its colour stays
 *    litBright / glowGain         a lit pixel's value, and what the element's glow adds on top
 *    coreBurn / whiteHot          the painting squared (deeper colour) and the white in the
 *                                 brightest facets, both scaled by the glow
 *    readyPulse / readyRim        the ready breath's swing, and its thin white-gold rim light
 *    litSat / rimGain             the lit painting's saturation, the element's rim light
 *    heartGain                    how much of the glow the white-gold heart takes (the shaft
 *                                 is the brightest thing on the dais; at full it blooms into
 *                                 a beam and loses its facets) */
export const RING_CRYSTAL_LOOK = {
  dormantBright: 0.42,
  dormantSat: 0.55,
  litBright: 1.0,
  glowGain: 0.28,
  coreBurn: 0.35,
  whiteHot: 0.12,
  readyPulse: 0.08,
  readyRim: 0.3,
  litSat: 1.55,
  rimGain: 0.3,
  heartGain: 0.55,
} as const;

/** The weights' channel order in the model's `_weights` (SMITH_HEART_VEINS order). */
export const RING_CRYSTAL_ELEMENTS = 4;

/** The heart's (the crown's) share of the glow: how bright it stands with every element
 *  full, and what the ready pulse adds. */
const CROWN_FULL = 0.9;
const CROWN_READY = 0.5;
/** Seconds the ready swell takes to rise. */
export const RING_CRYSTAL_READY_RISE = 1.2;

export interface RingCrystalState {
  /** Per element (hammer, breath, quench, heat): how far up its crystal its light has
   *  climbed, 0 (dark) to 1 (to the tip). */
  fill: number[];
  /** Per element: its brightness, 0 dark, 1 burning, a flare over 1 as the fill lands. */
  level: number[];
  /** The heart's glow, 0 to ~1.4. */
  crown: number;
  /** The ready swell, 0 (not ready) to 1 (the whole crystal pulsing). */
  ready: number;
  /** The burst's overload (0 to 1): the crystal whitens and shakes before it shatters. */
  charge: number;
  /** Seconds since the shatter (-1 before it). */
  burstT: number;
}

export function newRingCrystalState(): RingCrystalState {
  return {
    fill: [0, 0, 0, 0],
    level: [0, 0, 0, 0],
    crown: 0,
    ready: 0,
    charge: 0,
    burstT: -1,
  };
}

function ease(t: number): number {
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  return c * c * (3 - 2 * c);
}

/** The crystal's state from the seal's view: `since[i]` seconds since element i lit (-1
 *  dark, SMITH_HEART_VEINS order), `readySince` since the crystal became ready (-1 not
 *  yet), `portalSince` since the portal bit (the burst) was seen (-1 shut). Written into
 *  `out` (allocation-free: the frame driver calls it every frame). */
export function ringCrystalState(
  since: readonly number[],
  readySince: number,
  portalSince: number,
  out: RingCrystalState = newRingCrystalState(),
): RingCrystalState {
  let fillSum = 0;
  // Seconds since the slowest element finished filling its crystals (negative while one
  // is still climbing or dark).
  let settled = Number.POSITIVE_INFINITY;
  for (let i = 0; i < RING_CRYSTAL_ELEMENTS; i++) {
    const s = since[i] ?? -1;
    const fill = s < 0 ? 0 : heartSealQuarterFill(s);
    out.fill[i] = fill;
    out.level[i] = s < 0 ? 0 : heartSealQuarterLevel(s);
    fillSum += fill;
    settled = Math.min(
      settled,
      s < 0 ? Number.NEGATIVE_INFINITY : s - HEART_SEAL_ARRIVAL - HEART_SEAL_FILL_SECONDS,
    );
  }
  const burst = portalSince >= 0;
  // The swell waits for the last element's light: the sim's ready bit can come with the
  // fourth vein (the Ring already clear), seconds before that vein's river has reached
  // the seal, and a crystal still taking its light must not already pulse as ready.
  const readyFor = readySince < 0 ? -1 : Math.min(readySince, settled);
  out.ready = burst || readyFor < 0 ? 0 : ease(readyFor / RING_CRYSTAL_READY_RISE);
  out.crown = (fillSum / RING_CRYSTAL_ELEMENTS) * CROWN_FULL + out.ready * CROWN_READY;
  out.charge = burst ? heartPortalStage(portalSince).charge : 0;
  // The shatter lands as the overload ends.
  out.burstT =
    burst && portalSince >= HEART_PORTAL_OPEN.charge ? portalSince - HEART_PORTAL_OPEN.charge : -1;
  if (burst) {
    // Every element burns at its full while the crystal goes up.
    for (let i = 0; i < RING_CRYSTAL_ELEMENTS; i++) {
      out.fill[i] = 1;
      out.level[i] = Math.max(out.level[i], 1.1);
    }
    out.crown = CROWN_FULL + CROWN_READY;
  }
  return out;
}

/** The quantized state's key, so a steady crystal writes nothing: every number rounded
 *  to what a frame can show (the painter compares it to its last). */
export function ringCrystalKey(s: RingCrystalState): number {
  let k = 0;
  for (let i = 0; i < RING_CRYSTAL_ELEMENTS; i++) {
    k = k * 31 + Math.round(s.fill[i] * 128);
    k = k * 31 + Math.round(s.level[i] * 64);
  }
  k = k * 31 + Math.round(s.crown * 64);
  k = k * 31 + Math.round(s.ready * 64);
  k = k * 31 + Math.round(s.charge * 64);
  return k % 2147483647;
}

/** How hard the crystal trembles through its overload (yards of sway at the tip). */
export function ringCrystalTremble(charge: number): number {
  return charge * 0.12;
}

// ---- the burst's pieces --------------------------------------------------------------

export type RingCrystalPieceKind = 'plinth' | 'body' | 'heart' | 'core';

/** A body piece wider than any cluster of crystals (yards from its centre to its furthest
 *  vertex) is the model's grey core: the mass of dark rock under and between the crystals,
 *  hidden while the crystal stands, a plate sixteen yards wide when thrown. */
export const RING_CRYSTAL_CORE_RADIUS = 6;
/** Seconds after the shatter that the core takes to vanish into the flash (it never flies). */
const CORE_VANISH_SECONDS = 0.35;

/** The motion a piece takes: its node's kind, or `core` for a body piece wider than
 *  `RING_CRYSTAL_CORE_RADIUS`. */
export function ringCrystalPieceRole(
  kind: RingCrystalPieceKind,
  radius: number,
): RingCrystalPieceKind {
  return kind === 'body' && radius > RING_CRYSTAL_CORE_RADIUS ? 'core' : kind;
}

/** A piece's displacement from its assembled place (yards), its turn (radians) and its
 *  scale; `visible` false once it is gone. */
export interface RingCrystalPiecePose {
  dx: number;
  dy: number;
  dz: number;
  rx: number;
  ry: number;
  rz: number;
  scale: number;
  visible: boolean;
}

export function newRingCrystalPiecePose(): RingCrystalPiecePose {
  return { dx: 0, dy: 0, dz: 0, rx: 0, ry: 0, rz: 0, scale: 1, visible: true };
}

/** Gravity of the burst (yards per second squared; more than the world's, so the flight
 *  reads as a blast and not a drift). */
const BURST_GRAVITY = 26;
/** Horizontal drag of the burst (per second). */
const BURST_DRAG = 1.2;
/** Seconds after the shatter that a body piece begins to settle into its orbit and the
 *  seconds that settling takes. */
const ORBIT_FROM = 0.45;
const ORBIT_SECONDS = 2.4;
/** How small the orbiting pieces end (a share of their size). */
const ORBIT_SCALE = 0.5;
/** Seconds after the shatter that a falling plinth stone starts to shrink away and the
 *  seconds it takes. */
const PLINTH_GONE_FROM = 1.5;
const PLINTH_GONE_SECONDS = 1.1;

function h01(i: number, k: number): number {
  const v = Math.sin(i * 127.1 + k * 311.7) * 43758.5453;
  return v - Math.floor(v);
}

/** Piece `i` (its `kind`, its assembled centre `c` in the crystal's own frame, y up) `t`
 *  seconds after the shatter (-1: whole, nothing moves). The pieces fly outward from the
 *  axis and up (the heart's shaft straight up), tumbling; the crystal's pieces settle
 *  into a slow orbit round the portal's funnel (7 to 21 yd over the dais, always over a
 *  body's head), the plinth's fall away. */
export function ringCrystalPiecePose(
  i: number,
  kind: RingCrystalPieceKind,
  c: { x: number; y: number; z: number },
  t: number,
  out: RingCrystalPiecePose = newRingCrystalPiecePose(),
): RingCrystalPiecePose {
  if (t < 0) {
    out.dx = 0;
    out.dy = 0;
    out.dz = 0;
    out.rx = 0;
    out.ry = 0;
    out.rz = 0;
    out.scale = 1;
    out.visible = true;
    return out;
  }
  if (kind === 'core') {
    // The grey core goes in the flash: it stays where it stood and shrinks away.
    out.dx = 0;
    out.dy = 0;
    out.dz = 0;
    out.rx = 0;
    out.ry = 0;
    out.rz = 0;
    out.scale = Math.max(0, 1 - ease(t / CORE_VANISH_SECONDS));
    out.visible = out.scale > 0.001;
    return out;
  }
  const radial = Math.hypot(c.x, c.z);
  const ang0 =
    kind === 'heart' || radial < 0.8
      ? h01(i, 2) * Math.PI * 2
      : Math.atan2(c.x, c.z) + (h01(i, 1) - 0.5) * 0.5;
  // The plinth's slabs crack apart and sink into the dais (a slide out, hardly any lift),
  // never thrown up over the crystal's pieces: the crystal's pieces are the blast.
  const vh =
    kind === 'plinth'
      ? 2.5 + 2.5 * h01(i, 3)
      : kind === 'heart'
        ? 1.5 + 2 * h01(i, 3)
        : 5 + 8 * h01(i, 3);
  const vy =
    kind === 'plinth'
      ? 0.5 + 1.5 * h01(i, 4)
      : kind === 'heart'
        ? 24 + 6 * h01(i, 4)
        : 8 + 12 * h01(i, 4) + 6 * (c.y / RING_CRYSTAL.height);
  const reach = (vh * (1 - Math.exp(-BURST_DRAG * t))) / BURST_DRAG;
  let dx = Math.sin(ang0) * reach;
  let dz = Math.cos(ang0) * reach;
  let dy = vy * t - 0.5 * BURST_GRAVITY * t * t;
  let scale = 1 + 0.06 * Math.max(0, 1 - t / 0.12);
  const tumble = 0.8 + 2.4 * h01(i, 10);
  let spin = 1;
  if (kind !== 'plinth') {
    const e = ease((t - ORBIT_FROM) / ORBIT_SECONDS);
    // Where it settles: a ring round the funnel, its own height and radius, turning
    // slowly (a spin per piece, either way round).
    const a1 = ang0 + (0.1 + h01(i, 6) * 0.08) * (i % 2 ? 1 : -1) * t;
    const r1 = 6.5 + h01(i, 5) * 5.5;
    const y1 = 7 + h01(i, 7) * 14;
    const tx = Math.sin(a1) * r1 - c.x;
    const tz = Math.cos(a1) * r1 - c.z;
    const ty = y1 + Math.sin(t * (0.7 + h01(i, 9) * 0.5) + i) * 0.45 * e - c.y;
    dx = dx * (1 - e) + tx * e;
    dz = dz * (1 - e) + tz * e;
    // The blast overshoots up, then sinks into the orbit.
    dy = dy * (1 - e) + ty * e;
    scale *= 1 - (1 - ORBIT_SCALE) * e;
    spin = 1 - 0.75 * e;
  } else if (t > PLINTH_GONE_FROM) {
    scale *= Math.max(0, 1 - (t - PLINTH_GONE_FROM) / PLINTH_GONE_SECONDS);
  }
  out.dx = dx;
  out.dy = dy;
  out.dz = dz;
  out.rx = t * tumble * (0.6 + h01(i, 11)) * spin + h01(i, 12) * 0.4;
  out.ry = t * tumble * (0.3 + h01(i, 13)) * spin;
  out.rz = t * tumble * (0.5 + h01(i, 14)) * spin;
  out.scale = scale;
  out.visible = scale > 0.001;
  return out;
}

/** The pieces' kind from the model's node name (`Piece_07_body`). */
export function ringCrystalPieceKind(nodeName: string): RingCrystalPieceKind | null {
  const m = /^Piece_\d+_(plinth|body|heart)$/.exec(nodeName);
  return m ? (m[1] as RingCrystalPieceKind) : null;
}
