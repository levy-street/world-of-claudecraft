// Gloamveil's climbing shadow, the pure half: where the dark stands on a body,
// how a cast and the entry drive it, and the shader text that draws it.
//
// The Shadow priest's body is swallowed by darkness from the ground up. The
// legs go near-black and the dark climbs in uneven pointed tongues that rise
// and fall, while the torso and head keep the character's own outfit and
// colours. Casting drives it: the dark surges to the chest for the length of
// the cast and sinks back afterwards. Entering the form closes it over the
// whole body for a beat before it recedes to the legs.
//
// The dark is measured in WORLD height above the character's feet and in the
// angle around its standing axis, so it fits any body (and any held weapon)
// without knowing its bones or proportions: the inputs are where the feet are,
// how tall the body is, and where it stands.
//
// The GLSL below and the CPU twin (gloamEdge, gloamDark) are written from the
// SAME tables, so the two cannot drift: the twin is what a Vitest pins, and
// what dims the one unlit piece of a priest's rig (the class halo) in step
// with the lit ones.
//
// Pure core contract: no three import, no DOM, no clocks, no randomness.
// Registered in RENDER_PURE_CORES (tests/architecture.test.ts); tested by
// tests/gloam_climb_core.test.ts.

/** One family of tongues around the body. */
interface TongueFamily {
  /** Tongues around the body. */
  lobes: number;
  /** Radians a second the family turns around the body (negative: the other way). */
  drift: number;
  phase: number;
  /** Exponent that narrows each lobe into a point. */
  sharp: number;
  /** Rest height of a tongue and how far its own clock swings it. */
  base: number;
  swing: number;
  /** The rise-and-fall clock: rate, how it varies around the body, its offset. */
  rate: number;
  twist: number;
  offset: number;
  /** Share of the reach this family takes. */
  weight: number;
}

/** Three families, each rising and falling on its own clock. */
const TONGUES: readonly TongueFamily[] = [
  {
    lobes: 3,
    drift: 0.6,
    phase: 0,
    sharp: 3,
    base: 0.55,
    swing: 0.45,
    rate: 1.7,
    twist: 2,
    offset: 0,
    weight: 0.5,
  },
  {
    lobes: 5,
    drift: -0.9,
    phase: 1.7,
    sharp: 4,
    base: 0.55,
    swing: 0.45,
    rate: 2.3,
    twist: -3,
    offset: 0.6,
    weight: 0.35,
  },
  {
    lobes: 8,
    drift: 1.3,
    phase: 4.1,
    sharp: 5,
    base: 0.5,
    swing: 0.5,
    rate: 3.1,
    twist: 1,
    offset: 0,
    weight: 0.2,
  },
];

/** Where the dark stands at rest and mid-cast, as a share of the body height. */
export const GLOAM_REST_LEVEL = 0.24;
export const GLOAM_SURGE_LEVEL = 0.58;
/** How far the tongues reach above that level, at rest and mid-cast. */
export const GLOAM_REST_REACH = 0.3;
export const GLOAM_SURGE_REACH = 0.36;
/** Half the width of the soft band at the edge of the dark. */
export const GLOAM_EDGE_SOFT = 0.03;
/** What the dark leaves of a surface's own colour. */
export const GLOAM_DARK_TINT: readonly [number, number, number] = [0.035, 0.03, 0.06];

/** Seconds-scale rates for the surge: it leaps up with a cast and sinks slowly. */
export const GLOAM_SURGE_RISE = 9;
export const GLOAM_SURGE_FALL = 1.3;
/** The entry: the dark swallows the whole body, holds a beat, then recedes. */
export const GLOAM_ENTRY_SURGE = 3.4;
export const GLOAM_ENTRY_HOLD = 0.28;
export const GLOAM_ENTRY_FALL = 2.1;
/** The tongue clock under reduced motion: one still frame of the same shape. */
export const GLOAM_STILL_CLOCK = 0;

/** The class halo floats this far up the body, in body heights: the height the
 *  unlit halo is dimmed at, since it carries no shader of its own to do it. */
export const GLOAM_HALO_HEIGHT = 1.2;
/** A middling tongue, for the one reading taken without an angle (the halo). */
const GLOAM_MEAN_TONGUE = 0.3;

function mix(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function smoothstep(lo: number, hi: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - lo) / (hi - lo)));
  return t * t * (3 - 2 * t);
}

/** How far the tongues stand out at `angle` radians around the body, 0 to about 1. */
export function gloamTongue(angle: number, clock: number): number {
  let reach = 0;
  for (const k of TONGUES) {
    const lobe = Math.max(0, 0.5 + 0.5 * Math.sin(angle * k.lobes + clock * k.drift + k.phase));
    const rise = k.base + k.swing * Math.sin(clock * k.rate + angle * k.twist + k.offset);
    reach += lobe ** k.sharp * rise * k.weight;
  }
  return reach;
}

/** The height the dark reaches for a given tongue, in body heights. `surge` is
 *  0 at rest and 1 mid-cast; the entry drives it well past 1. */
export function gloamEdgeFor(tongue: number, surge: number): number {
  const level = mix(GLOAM_REST_LEVEL, GLOAM_SURGE_LEVEL, surge);
  const reach = mix(GLOAM_REST_REACH, GLOAM_SURGE_REACH, surge);
  return level + reach * tongue;
}

/** The height the dark reaches at `angle` around the body, in body heights. */
export function gloamEdge(angle: number, clock: number, surge: number): number {
  return gloamEdgeFor(gloamTongue(angle, clock), surge);
}

/** How dark a point `height` body heights up is, 0 (its own colour) to 1. */
export function gloamDark(height: number, edge: number): number {
  return 1 - smoothstep(edge - GLOAM_EDGE_SOFT, edge + GLOAM_EDGE_SOFT, height);
}

/** How much of its own colour the unlit halo keeps at `surge`, one factor per
 *  channel written into `out`. Only the entry reaches it. */
export function gloamHaloTintInto(surge: number, out: [number, number, number]): void {
  const dark = gloamDark(GLOAM_HALO_HEIGHT, gloamEdgeFor(GLOAM_MEAN_TONGUE, surge));
  out[0] = mix(1, GLOAM_DARK_TINT[0], dark);
  out[1] = mix(1, GLOAM_DARK_TINT[1], dark);
  out[2] = mix(1, GLOAM_DARK_TINT[2], dark);
}

/** The violet edge glow: its strength at rest, how far a breath swells it, and
 *  the seconds one breath takes. */
export const GLOAM_RIM_REST = 1.8;
export const GLOAM_RIM_SWELL = 1.0;
export const GLOAM_RIM_PERIOD = 3.2;

/** The edge glow's strength at `seconds` on the render clock: a slow breath,
 *  held at rest under reduced motion. */
export function gloamRimBoost(seconds: number, reducedMotion: boolean): number {
  if (reducedMotion) return GLOAM_RIM_REST;
  const breath = 0.5 - 0.5 * Math.cos((seconds / GLOAM_RIM_PERIOD) * Math.PI * 2);
  return GLOAM_RIM_REST + GLOAM_RIM_SWELL * breath;
}

/** One character's surge: the cast response, the entry, and the entry's age. */
export interface GloamSurge {
  cast: number;
  entry: number;
  age: number;
}

export function createGloamSurge(): GloamSurge {
  return { cast: 0, entry: 0, age: 0 };
}

/**
 * The form began on this body. `entering` is a shift seen happening (the dark
 * closes over the whole body first); a body that comes into view already in
 * the form starts at rest.
 */
export function startGloamSurge(state: GloamSurge, entering: boolean): void {
  state.cast = 0;
  state.age = 0;
  state.entry = entering ? GLOAM_ENTRY_SURGE : 0;
}

/** The form ended: nothing left to drive. */
export function stopGloamSurge(state: GloamSurge): void {
  state.cast = 0;
  state.entry = 0;
  state.age = 0;
}

/**
 * Advance one frame and return the surge the shader reads. Reduced motion
 * drops the entry (the dark is simply there, at rest) and keeps the cast
 * response, which is the form answering what its wearer does.
 */
export function stepGloamSurge(
  state: GloamSurge,
  dt: number,
  casting: boolean,
  reducedMotion: boolean,
): number {
  const step = Number.isFinite(dt) ? Math.max(0, dt) : 0;
  state.age += step;
  const target = casting ? 1 : 0;
  const rate = target > state.cast ? GLOAM_SURGE_RISE : GLOAM_SURGE_FALL;
  state.cast += (target - state.cast) * (1 - Math.exp(-rate * step));
  if (reducedMotion) state.entry = 0;
  else if (state.age > GLOAM_ENTRY_HOLD) state.entry *= Math.exp(-GLOAM_ENTRY_FALL * step);
  return Math.max(state.cast, state.entry);
}

/** What a rig in the form tells the floor and smoke layer each frame. */
export const GLOAM_CUE_HIDDEN = 0;
export const GLOAM_CUE_PRESENT = 1;
export const GLOAM_CUE_ENTER = 2;
/** In the form, drawn for a viewer who asked for reduced motion. */
export const GLOAM_CUE_STILL = 3;
/** In the form with nothing to draw around it (swimming: no floor to stain). */
export const GLOAM_CUE_REST = 4;
export type GloamCue =
  | typeof GLOAM_CUE_HIDDEN
  | typeof GLOAM_CUE_PRESENT
  | typeof GLOAM_CUE_ENTER
  | typeof GLOAM_CUE_STILL
  | typeof GLOAM_CUE_REST;

/**
 * The cue for this frame. A ghosted or stealthed body shows no pool and no
 * smoke, at once (nothing may mark a stealther, the rule the form adornments
 * follow). A swimming body rests the layer: it has no floor to stain, and a
 * stain on the bed would draw over the water. Under reduced motion the layer
 * keeps its still read and no entry plays. Otherwise the entry is reported
 * while one is pending.
 */
export function gloamCue(
  inForm: boolean,
  ghosted: boolean,
  entryPending: boolean,
  reducedMotion: boolean,
  swimming: boolean,
): GloamCue {
  if (!inForm || ghosted) return GLOAM_CUE_HIDDEN;
  if (swimming) return GLOAM_CUE_REST;
  if (reducedMotion) return GLOAM_CUE_STILL;
  return entryPending ? GLOAM_CUE_ENTER : GLOAM_CUE_PRESENT;
}

/** A GLSL float literal. */
function f(value: number): string {
  return Number.isInteger(value) ? `${value}.0` : `${value}`;
}

/** Marker the patch leaves, so a second pass over one shader is a no-op. */
export const GLOAM_CLIMB_MARKER = 'woc-gloam-climb';

/**
 * Fragment declarations. `uGloamBody` is the feet anchor in world space and the
 * reciprocal of the body height; a zero reciprocal is a body that is not in
 * the form, which is every body but a Shadow priest's, and costs one branch.
 * `uGloamState` is the surge and the tongue clock.
 */
export const GLOAM_CLIMB_FRAGMENT_PARS = `
// ${GLOAM_CLIMB_MARKER}
uniform vec4 uGloamBody;
uniform vec2 uGloamState;
float gloamClimb(vec3 fromFeet) {
  float h = fromFeet.y * uGloamBody.w;
  float a = atan(fromFeet.z, fromFeet.x + 1e-6); // guarded: atan(0,0) is undefined
  float t = uGloamState.y;
  float tongue = 0.0;
${TONGUES.map(
  (k) =>
    `  tongue += pow(clamp(0.5 + 0.5 * sin(a * ${f(k.lobes)} + t * ${f(k.drift)} + ${f(k.phase)}), 0.0, 1.0), ${f(k.sharp)}) * (${f(k.base)} + ${f(k.swing)} * sin(t * ${f(k.rate)} + a * ${f(k.twist)} + ${f(k.offset)})) * ${f(k.weight)};`,
).join('\n')}
  float level = mix(${f(GLOAM_REST_LEVEL)}, ${f(GLOAM_SURGE_LEVEL)}, uGloamState.x);
  float reach = mix(${f(GLOAM_REST_REACH)}, ${f(GLOAM_SURGE_REACH)}, uGloamState.x);
  float edge = level + reach * tongue;
  return 1.0 - smoothstep(edge - ${f(GLOAM_EDGE_SOFT)}, edge + ${f(GLOAM_EDGE_SOFT)}, h);
}
`;

/**
 * After <color_fragment>: darken the surface's own colour. The point is taken
 * camera-relative (the view-space position turned back to world axes, plus the
 * camera's offset from the feet), so it needs no varying of its own.
 */
export const GLOAM_CLIMB_FRAGMENT_COLOR = `
float gloam = 0.0;
if (uGloamBody.w > 0.0) {
  gloam = gloamClimb((-vViewPosition) * mat3(viewMatrix) + (cameraPosition - uGloamBody.xyz));
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(${GLOAM_DARK_TINT.map(f).join(', ')}), gloam);
}
`;

/**
 * After <emissivemap_fragment>: a violet ember line along the edge of each
 * tongue, brighter while surging, and a faint violet lift inside the dark so
 * the legs never crush to flat black.
 */
export const GLOAM_CLIMB_FRAGMENT_EMISSIVE = `
if (gloam > 0.0) {
  float gloamSeam = smoothstep(0.03, 0.35, gloam) * (1.0 - smoothstep(0.35, 0.95, gloam));
  totalEmissiveRadiance += vec3(0.34, 0.13, 0.9) * gloamSeam * (0.4 + 0.5 * uGloamState.x);
  totalEmissiveRadiance += vec3(0.012, 0.005, 0.028) * gloam;
}
`;

const COMMON_ANCHOR = '#include <common>';
const COLOR_ANCHOR = '#include <color_fragment>';
const EMISSIVE_ANCHOR = '#include <emissivemap_fragment>';

/**
 * Splice the climb into a LIT material's fragment shader (three's standard,
 * physical or Lambert source, includes still unresolved). Returns the source
 * unchanged when it is already patched or lacks an anchor. The caller only
 * hands this a lit shader: the climb measures from `vViewPosition`, which
 * those declare (Lambert through its lights chunk, so the name is not in the
 * text this sees) and an unlit material does not.
 */
export function patchGloamClimbFragment(source: string): string {
  if (source.includes(GLOAM_CLIMB_MARKER)) return source;
  if (
    !source.includes(COMMON_ANCHOR) ||
    !source.includes(COLOR_ANCHOR) ||
    !source.includes(EMISSIVE_ANCHOR)
  ) {
    return source;
  }
  return source
    .replace(COMMON_ANCHOR, `${COMMON_ANCHOR}${GLOAM_CLIMB_FRAGMENT_PARS}`)
    .replace(COLOR_ANCHOR, `${COLOR_ANCHOR}${GLOAM_CLIMB_FRAGMENT_COLOR}`)
    .replace(EMISSIVE_ANCHOR, `${EMISSIVE_ANCHOR}${GLOAM_CLIMB_FRAGMENT_EMISSIVE}`);
}
