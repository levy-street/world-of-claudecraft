// The shared SOAK / AVOID tell for every boss's floor circles (the team's
// playtest of 2026-11-25 on the Hammer Council: "soak mechanics need a clear
// tell"), as pure numbers. One standard any fight adopts through
// floor_tell.ts:
//
//   share  a circle the raid must GATHER in (a soak, a split): chevrons
//          pointing IN and rings converging on the middle, endlessly; round
//          the rim a pip for every player it needs, lit one by one as
//          players step inside (the count the mechanic asks for).
//   avoid  a circle the raid must KEEP OUT of (a knockback, a pulse, a
//          spread): chevrons pointing OUT and rings growing from the middle
//          to the rim, the rim itself throbbing outward.
//
// The direction reads twice over: in the SHAPE (the chevrons' tips point the
// way, so a still frame or reduced motion says it too) and in the MOTION. It
// is the mechanic's own information, so it draws the same on every graphics
// tier (docs/design/graphics-settings-fairness.md); only reduced motion holds
// the motion still. The colour stays the owner's threat colour
// (telegraph_look_core.ts TELEGRAPH_THREAT_COLORS) or its soak gold.
//
// Three-free, DOM-free, deterministic.

export type FloorTellKind = 'share' | 'avoid';

export interface FloorTellSpec {
  /** -1: the pattern runs inward (gather); +1: outward (keep out). */
  dir: -1 | 1;
  /** Pattern cycles a second (a cycle carries a band one band's width). */
  speed: number;
  /** Bands of chevrons between the middle and the rim. */
  bands: number;
  /** Chevrons round the circle. */
  spokes: number;
  /** How far a chevron's arms trail behind its tip (unit radii per spoke
   *  half-width): the shape's own arrow. */
  slope: number;
  /** The rim's throb a second (avoid) or its steady glow (share). */
  rimPulse: number;
}

export const FLOOR_TELL: Readonly<Record<FloorTellKind, FloorTellSpec>> = {
  share: { dir: -1, speed: 0.55, bands: 3, spokes: 10, slope: 0.32, rimPulse: 0 },
  avoid: { dir: 1, speed: 0.7, bands: 3, spokes: 10, slope: 0.32, rimPulse: 1.6 },
};

/** Where the soakers' pips sit (a share of the radius) and their size. */
export const FLOOR_TELL_PIPS = { at: 0.84, size: 0.075, most: 10 } as const;

/** The frame's look: the pattern's phase (cycles), the rim's throb (0..1),
 *  how strong the whole tell draws. */
export interface FloorTellLook {
  phase: number;
  rim: number;
  alpha: number;
}

/**
 * The tell `kind` at `clock` seconds, its mark `fill` through (0 laid, 1
 * landing: it burns brighter to the end), `reduced` holding the motion still
 * (the shape still points the way). Fills `out`.
 */
export function floorTellLook(
  kind: FloorTellKind,
  clock: number,
  fill: number,
  reduced: boolean,
  out: FloorTellLook,
): FloorTellLook {
  const spec = FLOOR_TELL[kind];
  const f = Math.max(0, Math.min(1, fill));
  // Faster as the mark runs out: the urgency the timer already says.
  out.phase = reduced ? 0.35 : clock * spec.speed * (1 + 0.6 * f);
  out.rim =
    spec.rimPulse > 0 && !reduced ? 0.5 + 0.5 * Math.sin(clock * spec.rimPulse * Math.PI * 2) : 0.6;
  out.alpha = 0.55 + 0.45 * f;
  return out;
}

/**
 * The chevron field the shader draws (mirrored here so the direction is
 * pinned): at unit radius `r` and across-spoke offset `u` (-0.5..0.5, 0 the
 * spoke's middle), the band coordinate in [0, 1) at `phase`. A chevron's
 * stroke is where it is small; its tip is the point of a stroke nearest the
 * middle (share) or the rim (avoid).
 */
export function tellBand(kind: FloorTellKind, r: number, u: number, phase: number): number {
  const spec = FLOOR_TELL[kind];
  const v = r + spec.dir * Math.abs(u) * spec.slope;
  const x = v * spec.bands - spec.dir * phase;
  return x - Math.floor(x);
}

/** The soakers' pips: how many to draw (the need, capped) and how many lit
 *  (players inside, never past the need). */
export function soakPips(need: number, have: number): { need: number; lit: number } {
  const n = Math.max(0, Math.min(FLOOR_TELL_PIPS.most, Math.round(need)));
  return { need: n, lit: Math.max(0, Math.min(n, Math.round(have))) };
}

/** Players standing inside a circle of `radius` round (x, z) (the sim's own
 *  `<=` rule, a hair of slack for the drawn body). */
export function countInside(
  x: number,
  z: number,
  radius: number,
  points: readonly { x: number; z: number }[],
  n = points.length,
): number {
  let k = 0;
  const r2 = (radius + 1e-6) * (radius + 1e-6);
  for (let i = 0; i < n; i++) {
    const dx = points[i].x - x;
    const dz = points[i].z - z;
    if (dx * dx + dz * dz <= r2) k++;
  }
  return k;
}
