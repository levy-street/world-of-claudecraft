// The Last Keep's SITE at the Trollmoot rise: level build ground for the
// owner's placer rebuild of the keep (docs/design/drakelands-improvements/
// plan.md). The castle that stood on the midlands plateau is gone; what the
// site keeps is the flat land: one graded pad, the castle pad idiom with no
// terraces, walls, or lift field. world.ts applies the pad in its authored
// pad chain (applyKeepSitePad), the scatter clearances read keepSiteClear,
// and the placer-built keep will seat its pieces on this ground. Pure leaf:
// deterministic, no rng, no SimContext.

export const KEEP_SITE = {
  // The graded build pad on the rise. Probed against the shipped seed:
  // natural ground runs 0 to 3 across the rect, water sits at -4.3, and
  // the sea shelf begins past x 500 and z 2190. h 2.0 hugs the rise, so
  // the skirt lands gently instead of raising a plateau cliff.
  // The rect deliberately clears the bonefield muster row (graveyard,
  // banner stake, and warcaller camp at z 2106 to 2112), Scout Yerrin's
  // ridge camp at (494, 2100), and the shore.
  pad: { x0: 432, x1: 494, z0: 2122, z1: 2182, h: 2.0 },
  /** the skirt's reach back to the natural waste, in yards */
  skirt: 9,
} as const;

/**
 * The pad skirt's reach: 1 over the graded rect, easing out to nothing over
 * the skirt band (the castle pad's smoothstep shape, kept so the ground
 * reads the same as every other authored pad edge).
 */
export function keepSitePadWeight(x: number, z: number): number {
  const p = KEEP_SITE.pad;
  const dx = Math.max(p.x0 - x, 0, x - p.x1);
  const dz = Math.max(p.z0 - z, 0, z - p.z1);
  const d = Math.hypot(dx, dz);
  if (d >= KEEP_SITE.skirt) return 0;
  const t = 1 - d / KEEP_SITE.skirt;
  return t * t * (3 - 2 * t);
}

/** Scatter clearance: keep procedural decorations off the build ground
 *  (the pad plus a 4yd apron), so the owner places onto clean land. */
export function keepSiteClear(x: number, z: number): boolean {
  const p = KEEP_SITE.pad;
  return x < p.x0 - 4 || x > p.x1 + 4 || z < p.z0 - 4 || z > p.z1 + 4;
}
