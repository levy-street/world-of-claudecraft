// The shared SOAK marker's plan (soak_marker.ts paints it): the one look every
// "stack on the marked player and share it" circle wears, a raid-language
// soak marker in our own procedural style (the owner's request of
// 2026-11-26): a glowing ground disc with a dense vortex of element-coloured
// energy (a bright band near the rim, a darker turbulent core), a crisp rim
// at the sim's own radius, thin rings converging from the rim on the middle,
// and a handful of thin luminous wisps spiralling up out of the disc.
//
// What it says, on every graphics tier (docs/design/graphics-settings-
// fairness.md): the circle at the sim's radius (the rim is yard-true; past it
// only the rim's own soft halo, light, never a fill; nothing moves outward),
// GATHER HERE (the vortex and its
// rings pull IN, and a ring of chevrons points in, so a still frame says it
// too), a pip round the rim per player the soak needs, lit one per player
// inside (floor_tell_core.ts `soakPips`), and an optional countdown arc.
// Cosmetic only: the wisps' count (the low tier sheds some, never all).
// Reduced motion holds every motion still (the shape still points in).
//
// Colour: the ELEMENT drives the palette (fire, earth, lightning, shadow, and
// frost and water ready for later); the share meaning lives in the shape and
// the motion (pulled in, never pushed out), never in the hue; a keep-out mark
// keeps its own plain painted footprint.
//
// Clips: Birth (the vortex spins up and blooms out from the middle), Hold
// (the loop), Decay (it is drawn back into the middle and fades).
//
// Three-free, DOM-free, deterministic.

export type SoakElement = 'fire' | 'earth' | 'air' | 'lightning' | 'shadow' | 'frost' | 'water';

export const SOAK_ELEMENTS: readonly SoakElement[] = [
  'fire',
  'earth',
  'air',
  'lightning',
  'shadow',
  'frost',
  'water',
];

/** An element's four tones, darkest to hottest: the turbulent core, the
 *  vortex's body, its bright band and streaks, the rim and the lit pips. */
export interface SoakPalette {
  deep: number;
  body: number;
  bright: number;
  hot: number;
}

export const SOAK_PALETTES: Readonly<Record<SoakElement, Readonly<SoakPalette>>> = {
  fire: { deep: 0x3a0400, body: 0xe01806, bright: 0xff5210, hot: 0xffcc48 },
  // Earth: a saturated golden amber with a hot-gold rim and dark umber
  // trailing sides, so it holds over grey and brown stone (never fire's red).
  earth: { deep: 0x1e0e02, body: 0xa65a08, bright: 0xffae1c, hot: 0xffe78a },
  air: { deep: 0x0c2a34, body: 0x4a9cac, bright: 0xa8e8ec, hot: 0xf6ffff },
  lightning: { deep: 0x020a30, body: 0x1840d0, bright: 0x64a8ff, hot: 0xeaf6ff },
  shadow: { deep: 0x08010f, body: 0x3a0f5c, bright: 0x8a3ee8, hot: 0xd9b2ff },
  frost: { deep: 0x041a2c, body: 0x2a7cb2, bright: 0x8edcff, hot: 0xf2ffff },
  water: { deep: 0x021a2c, body: 0x0c5c8c, bright: 0x3cbad8, hot: 0xdafff8 },
};

/** An element's own character over the shared look (each 0..1 unless
 *  noted): not a recolour only.
 *    grain    drifting specks carried round the vortex (earth's sand, fire's
 *             embers, air's motes);
 *    crackle  thin arcs flickering along the rim (lightning; air's faint
 *             storm flicker);
 *    tongues  the rim's bright edge licking inward in flame tongues (fire);
 *    smoke    a slow, darker, smoky body curling in (shadow);
 *    streams  long thin wind ribbons drawn round the swirl (air);
 *    speed    the vortex's turn and drift (1 the standard);
 *    wisp     the rising wisps' width (yards). */
export interface SoakCharacter {
  grain: number;
  crackle: number;
  tongues: number;
  smoke: number;
  streams: number;
  speed: number;
  wisp: number;
}

export const SOAK_CHARACTER: Readonly<Record<SoakElement, Readonly<SoakCharacter>>> = {
  fire: { grain: 0.7, crackle: 0, tongues: 1, smoke: 0, streams: 0, speed: 1.1, wisp: 0.3 },
  earth: { grain: 1, crackle: 0, tongues: 0, smoke: 0.1, streams: 0, speed: 0.85, wisp: 0.32 },
  air: { grain: 0.45, crackle: 0.3, tongues: 0, smoke: 0, streams: 1, speed: 1.7, wisp: 0.24 },
  lightning: { grain: 0.2, crackle: 1, tongues: 0, smoke: 0, streams: 0.3, speed: 1.3, wisp: 0.2 },
  shadow: { grain: 0.15, crackle: 0, tongues: 0, smoke: 1, streams: 0, speed: 0.7, wisp: 0.4 },
  frost: { grain: 0.6, crackle: 0.2, tongues: 0, smoke: 0.2, streams: 0.3, speed: 0.8, wisp: 0.24 },
  water: { grain: 0.2, crackle: 0, tongues: 0, smoke: 0.2, streams: 0.6, speed: 0.9, wisp: 0.3 },
};

/** The look's numbers (seconds; radii as a share of the sim's radius). */
export const SOAK_MARKER = {
  /** Birth: the vortex spins up and blooms from the middle. */
  birth: 0.6,
  /** Decay: drawn back into the middle as it fades. */
  decay: 0.4,
  /** The bloom a newborn starts from and a decaying one shrinks to. */
  bloomFrom: 0.3,
  bloomTo: 0.35,
  /** The vortex's turn a second (radians) and the extra turns the birth and
   *  the decay add (a spin-up, a last swirl). */
  spin: 0.9,
  birthTurn: 2.4,
  decayTurn: 2.0,
  /** A converging ring leaves the rim every `rippleEvery` seconds and
   *  reaches `rippleTo` of the radius as it fades. */
  ripples: 3,
  rippleEvery: 0.75,
  rippleTo: 0.45,
  /** The disc reaches a hair past the rim, for the rim's own soft halo
   *  only (light, never a fill). Nothing of a share marker moves outward
   *  (the Round 02 rule: outward motion says keep out, inward says come in);
   *  the rim itself (r = 1) is the sim's radius. */
  outer: 1.15,
  /** The vortex's arms: coherent logarithmic spirals (how many, and how
   *  tightly they wind per unit of log radius). */
  arms: 4,
  pitch: 1.05,
  /** Wisps: on the full tier, at least on the low one. */
  wisps: 6,
  wispsLow: 4,
  /** Their height, yards: a share of the radius, clamped. */
  wispPerRadius: 1.6,
  wispMin: 3.2,
  wispMax: 8,
} as const;

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const smooth = (v: number) => {
  const c = clamp01(v);
  return c * c * (3 - 2 * c);
};

export type SoakMarkerStage = 'birth' | 'hold' | 'decay' | 'done';

/** The clip at `age` seconds since it was laid, `decayAge` seconds since it
 *  was released (null: still held). */
export function soakMarkerStage(age: number, decayAge: number | null): SoakMarkerStage {
  if (decayAge !== null) return decayAge >= SOAK_MARKER.decay ? 'done' : 'decay';
  return age < SOAK_MARKER.birth ? 'birth' : 'hold';
}

/** The frame's look, filled by `soakMarkerLook`. */
export interface SoakMarkerLook {
  /** The vortex's spread (0..1: 1 reaches the rim). */
  bloom: number;
  /** The birth's progress (0 laid .. 1 born): the rim flares in place. */
  born: number;
  /** How strong the whole marker draws (0..1). */
  alpha: number;
  /** The vortex's turn (radians). */
  spin: number;
  /** The rings' and wisps' clock (seconds; held under reduced motion). */
  time: number;
  /** The wisps' rise (0..1). */
  wisp: number;
  /** The ready flare (every soaker it needs stands inside). */
  flare: number;
}

export function newSoakMarkerLook(): SoakMarkerLook {
  return { bloom: 1, born: 1, alpha: 1, spin: 0, time: 0, wisp: 1, flare: 0 };
}

/** The clock a reduced-motion marker is held at (a frame with the rings
 *  spread and the wisps up). */
export const SOAK_STILL_TIME = 0.4;

/**
 * The marker at `clock`, `age` seconds after it was laid and `decayAge` after
 * it was released (null: held), `fill` through its mark (0 laid, 1 landing:
 * it burns brighter and turns faster to the end), `ready` once every soaker
 * stands inside. Reduced motion skips the bloom and holds every motion still.
 */
export function soakMarkerLook(
  clock: number,
  age: number,
  decayAge: number | null,
  fill: number,
  ready: boolean,
  reduced: boolean,
  out: SoakMarkerLook,
): SoakMarkerLook {
  const f = clamp01(fill);
  const born = reduced ? 1 : smooth(age / SOAK_MARKER.birth);
  const gone = decayAge === null ? 0 : smooth(decayAge / SOAK_MARKER.decay);
  out.bloom =
    (SOAK_MARKER.bloomFrom + (1 - SOAK_MARKER.bloomFrom) * born) *
    (1 - (1 - SOAK_MARKER.bloomTo) * (reduced ? 0 : gone));
  out.born = born;
  out.alpha = (0.4 + 0.6 * born) * (1 - gone) * (0.82 + 0.18 * f);
  out.spin = reduced
    ? 0
    : clock * SOAK_MARKER.spin * (1 + 0.5 * f) +
      SOAK_MARKER.birthTurn * born +
      SOAK_MARKER.decayTurn * gone;
  out.time = reduced ? SOAK_STILL_TIME : clock;
  out.wisp = reduced ? 1 : born * (1 - gone);
  out.flare = ready ? 1 : 0;
  return out;
}

/** The converging ring `k` (0 .. ripples-1) at `time`: its radius (a share of
 *  the sim's, never past the rim) and its strength. Mirrors the shader. */
export function soakRipple(time: number, k: number): { r: number; a: number } {
  const n = SOAK_MARKER.ripples;
  const p = time / (SOAK_MARKER.rippleEvery * n) + k / n;
  const ph = p - Math.floor(p);
  return {
    r: 1 - ph * (1 - SOAK_MARKER.rippleTo),
    a: smooth(ph / 0.12) * (1 - ph),
  };
}

/** The body's gentle flicker at `time` (0.9 .. 1), once a frame on the CPU
 *  rather than per fragment. Still under reduced motion (the held time). */
export function soakFlicker(time: number): number {
  const w = Math.sin(time * 6.3) * Math.sin(time * 2.9 + 1.1);
  return 0.95 + 0.05 * w;
}

/** The wisps drawn at a tier's `detail` (0 low .. 1 full). */
export function soakWispCount(detail: number): number {
  const d = clamp01(detail);
  return Math.round(SOAK_MARKER.wispsLow + (SOAK_MARKER.wisps - SOAK_MARKER.wispsLow) * d);
}

/** The wisps' height (yards) over a circle of `radius` yards. */
export function soakWispHeight(radius: number): number {
  return Math.max(
    SOAK_MARKER.wispMin,
    Math.min(SOAK_MARKER.wispMax, radius * SOAK_MARKER.wispPerRadius),
  );
}

/** The countdown arc's share left (null: no arc) from a mark's progress. */
export function soakTimerLeft(progress: number | null | undefined): number {
  if (progress === null || progress === undefined) return -1;
  return 1 - clamp01(progress);
}
