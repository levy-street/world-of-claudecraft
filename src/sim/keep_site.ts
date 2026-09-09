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

/** The rebuilt keep's raised temple court: the pad YIELDS here so the
 *  authored court stamps (content/ember_coast.ts, applied in the terrain
 *  edit layer BENEATH the pad chain) can raise the raw ground to the deck
 *  bases. Slightly larger than the stamps' flat cores, with a soft edge so
 *  the pad floor crossfades into the court's own smooth rims. */
const TEMPLE_COURT = { x0: 474.5, x1: 496, z0: 2154.5, z1: 2183, blend: 2 } as const;

function templeCourtWeight(x: number, z: number): number {
  const c = TEMPLE_COURT;
  const inset = Math.min(x - c.x0, c.x1 - x, z - c.z0, c.z1 - z);
  if (inset <= 0) return 0;
  const t = Math.min(1, inset / c.blend);
  return t * t * (3 - 2 * t);
}

/**
 * The pad skirt's reach: 1 over the graded rect, easing out to nothing over
 * the skirt band (the castle pad's smoothstep shape, kept so the ground
 * reads the same as every other authored pad edge), and yielding inside
 * the temple court so the rebuild's stamps rule its ground.
 */
export function keepSitePadWeight(x: number, z: number): number {
  const p = KEEP_SITE.pad;
  const dx = Math.max(p.x0 - x, 0, x - p.x1);
  const dz = Math.max(p.z0 - z, 0, z - p.z1);
  const d = Math.hypot(dx, dz);
  if (d >= KEEP_SITE.skirt) return 0;
  const t = 1 - d / KEEP_SITE.skirt;
  return t * t * (3 - 2 * t) * (1 - templeCourtWeight(x, z));
}

/** Scatter clearance: keep procedural decorations off the build ground
 *  (the pad plus a 4yd apron), so the owner places onto clean land. */
export function keepSiteClear(x: number, z: number): boolean {
  const p = KEEP_SITE.pad;
  return x < p.x0 - 4 || x > p.x1 + 4 || z < p.z0 - 4 || z > p.z1 + 4;
}
