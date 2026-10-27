// The Guardian of the Heat's molten telegraph, as numbers (the shaders are
// heat_telegraph_glsl.ts, the dressing heat_telegraph.ts): how each of the
// fight's floor warnings paints over the shared floor telegraph's footprint.
//
// The SHAPE and the TIMING stay the shared kit's (../floor_telegraph): the
// footprint is draped at the sim's exact radius, length and width, and its
// fill is the sim's own bar (or the painter's clock off the sim's template),
// untouched here. Only the paint changes: instead of a flat wash of the
// threat colour, the basalt under the mark chars dark, its joints split into
// cracks that light white-gold as the fill sweeps over them, a molten flow
// churns in the swept part, the fill's front is a ragged line of fire, the
// edge a crisp hot line in the threat colour (danger, or lethal for the
// fist), and the whole mark flares over the bar's last stretch. Every one of
// those reads on every tier; the flow's churn, the fine cracks and the
// embers are the cosmetic layers the low tier sheds (`detail`).
//
// Three-free, DOM-free, deterministic.

/** Every floor warning the Heat fight draws through the kit. */
export type HeatTelegraphKind =
  | 'fist'
  | 'swell'
  | 'river'
  | 'seedCore'
  | 'seedReach'
  | 'fall'
  | 'cinderReach'
  | 'hunted';

export interface HeatTelegraphLook {
  /** How dark the basalt chars under the whole mark (0..1, multiply). */
  char: number;
  /** The molten flow in the swept part (0: cracks only). */
  body: number;
  /** 0: even heat; 1: hotter toward the middle (a falloff of damage). */
  falloff: number;
  /** The joints' cell size: cells per yard (smaller marks, finer cells). */
  cells: number;
  /** The cracks' light (0..1). */
  crack: number;
  /** The edge line's strength (1 a hard edge; the seeds' falloff reach is a
   *  softer line, still drawn on every tier). */
  rim: number;
  /** Whether the kit's cosmetic glowing curtain stands on its edge (a ring
   *  of ten seeds' curtains reads as noise, a moving mark's as jitter). */
  curtain: boolean;
}

const look = (
  char: number,
  body: number,
  falloff: number,
  cells: number,
  crack: number,
  rim = 1,
  curtain = true,
): HeatTelegraphLook => ({ char, body, falloff, cells, crack, rim, curtain });

/** Per kind. The lethal fist chars deepest; the seeds' wide reach (damage
 *  falling off with distance) is a light char hotter toward its seed with a
 *  softer edge; the small marks (a cinder's reach, the hunted's ring) take
 *  finer joints and no curtain (they ride a moving body). */
export const HEAT_TELEGRAPH_LOOKS: Readonly<Record<HeatTelegraphKind, HeatTelegraphLook>> = {
  fist: look(0.62, 1, 0, 0.5, 1),
  swell: look(0.5, 0.9, 0, 0.55, 0.95),
  river: look(0.45, 0.9, 0, 0.5, 0.95),
  seedCore: look(0.5, 0.85, 0, 0.7, 1),
  seedReach: look(0.22, 0, 1, 0.45, 0.7, 0.55, false),
  fall: look(0.55, 1, 0, 0.9, 1),
  cinderReach: look(0.32, 0.5, 0.5, 1.2, 0.85, 1, false),
  hunted: look(0.4, 0.6, 0, 1.8, 0.9, 1, false),
};

/**
 * Whether a mark has LANDED: its bar full and no front left (a rolling
 * swell's lane, a flowing river's lane, the hunted's ring held at full). A
 * landed mark keeps its edge and cracks but lets its flow and most of its
 * char go, so the fire it warned of (the wave's wake, the river) shows
 * through. Mirrors the shader's `landed` (heat_telegraph_glsl.ts).
 */
export function heatTelegraphLanded(fill: number, front: number): boolean {
  return fill >= 0.999 && front < 0.001;
}

/** The char's strength at a point of a kind's mark (before its fade and its
 *  falloff): `swept` 1 behind the fill's front and 0 ahead of it, `warn` the
 *  bar's last-stretch pulse (0..1); deeper where swept and in the warning, a
 *  third of it once landed. Mirrors the shader's char pass
 *  (heat_telegraph_glsl.ts). */
export function heatTelegraphChar(
  kind: HeatTelegraphKind,
  swept: number,
  warn: number,
  landed: boolean,
): number {
  const s = Math.min(1, Math.max(0, swept));
  const base = HEAT_TELEGRAPH_LOOKS[kind].char * (0.45 + 0.4 * s + 0.15 * warn);
  return landed ? base * 0.35 : base;
}
