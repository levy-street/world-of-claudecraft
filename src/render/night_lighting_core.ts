// night_lighting_core: the pure 0..1 drivers every after-dark readability layer
// reads, so the streetlamps, the mob ground glow, and the character rim lift all
// fade on ONE shared curve instead of three hand-tuned ternaries scattered
// through renderer.ts.
//
// This is a src/render pure core: no Three, no DOM, no clock of its own. The
// renderer computes the world's night amount from day_night_core and hands it in,
// so a Vitest drives any moment of the cycle by hand.
//
// Why the GLOBAL night amount and not the grade's realm-compressed nightAmt: a
// lamplighter lights the lamps at dusk whatever realm they stand in. Keying these
// layers off the shared world clock means every realm lights up at the same
// instant, which is also the only version a player can predict. The realm's own
// amplitude still shapes how dark the world actually gets (day_night_core's
// per-realm palette and light floor); it just does not decide whether the lamps
// are burning.
//
// Tier policy (the graphics-neutrality invariant): `gradeApplied` is false on the
// Lambert tier, where renderer.ts skips the whole day/night grade and the world
// never darkens at all. A tier whose world stays at noon has nothing to
// compensate for, so its drivers stay at 0 rather than lighting lamps under a
// bright sky. Every tier that DOES run the cycle gets the identical curve: there
// is no per-tier scaling here, and nothing a player reacts to is hidden either
// way (the lamp posts, mobs, and nameplates are drawn on every tier regardless).

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Hermite ease, matching day_night_core's own smoothstep so the ramps agree. */
function smoothstep(t: number): number {
  const c = clamp01(t);
  return c * c * (3 - 2 * c);
}

/** Ease `v` across [lo, hi] to 0..1; returns 0 at or below lo, 1 at or above hi. */
function ramp(v: number, lo: number, hi: number): number {
  return smoothstep((v - lo) / (hi - lo));
}

/**
 * The shared night driver: 1 - globalDayness, zeroed on a tier that never
 * applies the day/night grade. Everything below reads this, never the raw
 * dayness, so one clamp governs the whole feature.
 */
export function nightLightAmount(globalNightAmt: number, gradeApplied: boolean): number {
  if (!gradeApplied) return 0;
  return clamp01(globalNightAmt);
}

// Lamps catch EARLY: the lamplighter is out in the late afternoon, the lamps
// are at full burn before the sun touches the horizon, and (globalDayness
// being symmetric) they hold through dawn and only snuff once the morning is
// properly bright. Noon and the early afternoon stay lamp-free, which the
// mid-afternoon pin in tests/night_lighting_core.test.ts holds.
const LAMP_ON = 0.08;
const LAMP_FULL = 0.32;

/** How brightly the streetlamps burn, 0 (out) to 1 (full), from the driver. */
export function lampGlowAmount(nightLight: number): number {
  return ramp(nightLight, LAMP_ON, LAMP_FULL);
}

// The mob ground glow waits for real dark: at dusk the sky itself still
// silhouettes a mob, and a pool of light under everything that moves would read
// as a game mechanic rather than as night. Capped below 1 so it stays a hint.
const MOB_ON = 0.52;
const MOB_FULL = 0.88;
const MOB_GLOW_CEILING = 0.75;

/** How strongly the warm ground disc under a nearby character reads, 0 to 1. */
export function mobGlowAmount(nightLight: number): number {
  return ramp(nightLight, MOB_ON, MOB_FULL) * MOB_GLOW_CEILING;
}

/**
 * Bioluminescence: the glow flora and the fireflies. Shares the mob glow's
 * later window rather than the lamps' dusk window, because a lamp is something
 * a person lights at sundown while a glowing mushroom is only VISIBLE once the
 * light around it has actually gone. Reaches a full 1 (the mob cue is
 * deliberately capped below that; this one is the thing you are looking at).
 */
export function wildGlowAmount(nightLight: number): number {
  return ramp(nightLight, MOB_ON, MOB_FULL);
}

/** Yards at which a character's ground glow has faded out completely. */
export const MOB_GLOW_RANGE = 44;
/** Yards at which it starts easing out, so a disc never pops in at the edge. */
const MOB_GLOW_FADE_START = 34;
/** Pool size for the glow discs: the crowd cap, past which extras are skipped. */
export const MOB_GLOW_POOL = 64;

/**
 * One character's disc strength: the frame's glow amount eased out over the last
 * stretch of range. Takes SQUARED distance, because the renderer's entity loop
 * already has it and a square root per character per frame buys nothing.
 */
export function mobGlowStrength(distSq: number, glowAmount: number): number {
  if (glowAmount <= 0) return 0;
  const fadeSq = MOB_GLOW_FADE_START * MOB_GLOW_FADE_START;
  const rangeSq = MOB_GLOW_RANGE * MOB_GLOW_RANGE;
  if (distSq >= rangeSq) return 0;
  if (distSq <= fadeSq) return glowAmount;
  return glowAmount * (1 - smoothstep((distSq - fadeSq) / (rangeSq - fadeSq)));
}

// The character rim (pbr_fragment_shader.ts, cranked underground by uRimBoost) is
// already the cheapest silhouette separator the renderer owns: one shared uniform,
// no extra draw, every rig at once. Outdoors it sits at 1; after dark it lifts by
// this much, which is enough to hold a moonlit edge on a body against dark ground
// without reading as a cartoon outline.
const NIGHT_RIM_LIFT = 0.85;

/** `sharedUniforms.uRimBoost` for an outdoor frame: 1 by day, lifted at night. */
export function nightRimBoost(nightLight: number): number {
  return 1 + ramp(nightLight, MOB_ON, MOB_FULL) * NIGHT_RIM_LIFT;
}
