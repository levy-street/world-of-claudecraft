// The shared SOAK tell's pure numbers (the team's playtest of 2026-11-25 on
// the Hammer Council: "soak mechanics need a clear tell"): a circle the raid
// must GATHER in (a soak, a split) wears the shared soak marker
// (soak_marker_core.ts) through floor_tell.ts, with a pip round its rim for
// every player it needs, lit one by one as players step inside (the count the
// mechanic asks for). It is the mechanic's own information, so it draws the
// same on every graphics tier (docs/design/graphics-settings-fairness.md).
//
// (The keep-out "avoid" tell of 2026-11-25 is gone: the owner's call of
// 2026-11-26 put every keep-out mechanic back on its own painted footprint.)
//
// Three-free, DOM-free, deterministic.

/** The one tell kind a mark wears: a shared soak. */
export type FloorTellKind = 'share';

/** Where the soakers' pips sit (a share of the radius) and their size. */
export const FLOOR_TELL_PIPS = { at: 0.82, size: 0.1, most: 10 } as const;

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
