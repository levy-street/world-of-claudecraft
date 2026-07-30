// day_night_core: the pure math of the world day/night cycle. It owns the
// clock-to-phase mapping, the smooth day/night curve, the per-realm amplitude
// table, and the render grade (light scale + sky/fog color multipliers) that a
// frame applies to the sun, hemisphere light, IBL, fog, and sky dome.
//
// This is a src/render pure core: NO Three, NO DOM, and crucially NO wall-clock
// read of its own. The one Date.now() lives in renderer.ts, which passes the
// millisecond timestamp in through cyclePhase(). Keeping the clock read out here
// makes the whole curve a deterministic function of its inputs, so a unit test
// can drive any moment of the cycle by hand (tests/day_night.test.ts).
//
// The cycle is anchored to the Unix epoch, so it is timezone-independent by
// construction: every client on Earth computes the identical phase from the same
// absolute instant, giving one shared world clock with no netcode. Day/night is
// render-only (it never touches the sim), so this determinism is about visual
// consistency across clients, not about parity.

import type { BiomeId } from '../sim/types';

/** Full day-to-night-to-day period. Twelve real hours, so the world runs two
 *  cycles per real day, deliberately decoupled from any player's local clock. */
export const DAY_NIGHT_CYCLE_MS = 12 * 60 * 60 * 1000;

/** The grade a frame reads: intensity scale for the lights + IBL, per-channel
 *  color multipliers for the sky dome and fog, a fog-distance pull-in, and the
 *  raw night amount (0 = full day, 1 = deepest night) for hue-cool blends. */
export interface DayNightGrade {
  /** multiplies sun + hemisphere + environment intensity (1 = authored day). */
  lightScale: number;
  /** multiplies the sky dome color (1,1,1 = day; dark blue at night). */
  sky: [number, number, number];
  /** multiplies the biome fog color (kept lighter than the sky for readability). */
  fog: [number, number, number];
  /** scales fog `far` so sightlines close in a little after dark. */
  farScale: number;
  /** 1 - effectiveDayness; how far toward night the current grade sits. */
  nightAmt: number;
}

/** SHIP DAY ONLY for now. The day/night cycle arrived with the grid-world merge and
 *  is not the look we release on yet, so every consumer pins itself to full day:
 *  the clock reports noon and the renderer applies NEUTRAL_DAY_GRADE instead of the
 *  cycle's grade. Nothing about the cycle math is removed, so flipping this to false
 *  restores it in one line, and `/daynight <phase>` still overrides it for testing. */
export const DAY_ONLY = true;

/** The identity grade: the world exactly as its authored daylight rig paints it.
 *  Note this is NOT `dayNightGrade(1)`, whose "day" is deliberately dimmed and
 *  cooled (lightScale 0.65, cool sky/fog) to leave headroom for night. */
export const NEUTRAL_DAY_GRADE: DayNightGrade = {
  lightScale: 1,
  sky: [1, 1, 1],
  fog: [1, 1, 1],
  farScale: 1,
  nightAmt: 0,
};

// Night targets. The floor stays moonlit, not black, so a neutral realm at
// deepest night still reads and stays playable, but the sky itself goes a deep
// dark blue so the moon and stars stand out against it; the fog is a touch
// lighter than the sky for readability. Tuned darker than the first pass
// (floor 0.26, sky 0.07/0.09/0.21) so night actually feels like night.
const NIGHT_LIGHT_FLOOR = 0.18;
const NIGHT_SKY: [number, number, number] = [0.045, 0.06, 0.15];
const NIGHT_FOG: [number, number, number] = [0.14, 0.18, 0.31];
const NIGHT_FAR_SCALE = 0.82;
// Day targets. Deliberately held well under white: the shipped HDRIs are bright
// day skies that bloom out to a jarring white at full strength, so the peak of
// the cycle is dimmed to a calm, soft daylight. Dusk (the midpoint of the lerp)
// then lands between night and this calmer day, which is the whole point.
const DAY_LIGHT_CAP = 0.65;
const DAY_SKY: [number, number, number] = [0.58, 0.62, 0.7];
const DAY_FOG: [number, number, number] = [0.64, 0.68, 0.76];

// Per-realm swing. 1 = the realm takes the full day-to-night grade; a smaller
// value compresses the swing toward the realm's authored look, so realms whose
// fixed time of day is their identity keep it. The authored look is treated as
// the DAY peak, so the amplitude only governs how far the night dip pulls it
// down (a realm never brightens past what it ships with). Amplitude doubles as a
// readability floor for already-dark realms (haunt, night) so they never crush
// to unplayable black at world-midnight. A Record over BiomeId, so tsc fails the
// build if a new biome is added without a considered amplitude here.
export const REALM_DAYNIGHT_AMPLITUDE: Record<BiomeId, number> = {
  // neutral daylight realms: the full day-to-night swing
  vale: 1,
  marsh: 1,
  peaks: 1,
  fen: 1,
  garden: 1,
  gale: 1,
  jungle: 0.95,
  // signature times of day: compressed swings that keep each realm itself
  frost: 0.7, // pale-blue day eases to a deep frozen-blue night
  amber: 0.55, // endless golden hour settles toward a golden evening
  ember: 0.5, // the volcanic sky dims but its lava glow (separate lights) stays
  night: 0.4, // the dream-night realm only breathes; never full daylight, never black
  haunt: 0.4, // already a dead-grey gloom; a gentle swing that stays readable
  dusk: 0.35, // the Veiled Hollow's permanent dusk drifts between early and late dusk
  // paint-only biomes (map editor): never a realm band, so neutral full swing
  beach: 1,
  desert: 1,
  volcano: 1,
  cave: 1,
};

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerp3(
  a: [number, number, number],
  b: [number, number, number],
  t: number,
): [number, number, number] {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

/** Smootherstep-lite Hermite ease, used to hold the day and night extremes a
 *  touch longer than a raw cosine would. */
function smoothstep(t: number): number {
  const c = clamp01(t);
  return c * c * (3 - 2 * c);
}

/** Cycle position in [0, 1) for a Unix millisecond timestamp. Epoch-anchored, so
 *  the same instant yields the same phase in every timezone. The double modulo
 *  keeps it in range even for a negative input (defensive; now is never < 0). */
export function cyclePhase(nowMs: number): number {
  return (
    (((nowMs % DAY_NIGHT_CYCLE_MS) + DAY_NIGHT_CYCLE_MS) % DAY_NIGHT_CYCLE_MS) / DAY_NIGHT_CYCLE_MS
  );
}

/** Global daylight amount in [0, 1] for a cycle phase: 0 at phase 0 (midnight),
 *  1 at phase 0.5 (noon), smooth and symmetric. Shared by every realm before the
 *  per-realm amplitude compresses it. */
export function globalDayness(phase: number): number {
  const raw = 0.5 - 0.5 * Math.cos(2 * Math.PI * phase);
  return smoothstep(raw);
}

/** The realm's own daylight amount: the global value pulled toward 1 (its
 *  authored day look) by the inverse of its amplitude, so a low-amplitude realm
 *  barely leaves its baseline while a neutral realm takes the full swing. */
export function effectiveDayness(global: number, biome: BiomeId): number {
  const amp = REALM_DAYNIGHT_AMPLITUDE[biome];
  return clamp01(1 - (1 - clamp01(global)) * amp);
}

/** Map an effective daylight amount to the render grade a frame applies. */
export function dayNightGrade(e: number): DayNightGrade {
  const c = clamp01(e);
  return {
    lightScale: lerp(NIGHT_LIGHT_FLOOR, DAY_LIGHT_CAP, c),
    sky: lerp3(NIGHT_SKY, DAY_SKY, c),
    fog: lerp3(NIGHT_FOG, DAY_FOG, c),
    farScale: lerp(NIGHT_FAR_SCALE, 1, c),
    nightAmt: 1 - c,
  };
}

/** Full-day grade, for a sane default before the first frame computes one. */
export function fullDayGrade(): DayNightGrade {
  return dayNightGrade(1);
}

// The minimap day/night dial paints the 12h cycle as a ring of sky colors and
// a "now" marker; SKY_DIAL_* are the stops it lerps between.
const SKY_DIAL_NIGHT: [number, number, number] = [0.11, 0.13, 0.26]; // deep navy
const SKY_DIAL_GLOW: [number, number, number] = [0.86, 0.52, 0.3]; // dawn/dusk warm
const SKY_DIAL_DAY: [number, number, number] = [0.46, 0.72, 0.98]; // bright day blue

/** A representative sky color (0..1 rgb) for a daylight amount, for the minimap
 *  day/night dial: deep navy at night, a warm dawn/dusk glow through the middle
 *  (dayness is symmetric, so both dawn and dusk land here), bright blue by day. */
export function skyTintForDayness(dayness: number): [number, number, number] {
  const d = clamp01(dayness);
  return d < 0.5
    ? lerp3(SKY_DIAL_NIGHT, SKY_DIAL_GLOW, d / 0.5)
    : lerp3(SKY_DIAL_GLOW, SKY_DIAL_DAY, (d - 0.5) / 0.5);
}

// The sun and moon ride a great circle tilted toward +z, so they cross the sky
// rather than passing through the zenith (which would flatten shadows). The tilt
// also keeps a little light bias to one side at noon for readable shading.
const CELESTIAL_TILT_Z = 0.32;
// Caps how high the sun and moon climb: at noon/midnight the peak lands around
// 40 degrees rather than near the zenith, so the bodies stay inside the player's
// (downward-looking) view band and cast readable medium-angle shadows.
const CELESTIAL_ARC_HEIGHT = 0.28;

/** Unit direction toward the sun for a cycle phase: on the horizon at dawn
 *  (0.25), highest at noon (0.5), back to the horizon at dusk (0.75), and below
 *  the horizon through the night. The renderer places the key light and the sky
 *  sun disc along this, and the HUD is unaffected. */
export function sunDirection(phase: number): [number, number, number] {
  const a = (phase - 0.25) * 2 * Math.PI; // dawn 0, noon PI/2, dusk PI, midnight -PI/2
  const x = Math.cos(a);
  const y = Math.sin(a) * CELESTIAL_ARC_HEIGHT; // capped peak so it stays in view
  const z = CELESTIAL_TILT_Z;
  const len = Math.hypot(x, y, z);
  return [x / len, y / len, z / len];
}

/** Unit direction toward the moon: the sun's antipode in the cycle, so it climbs
 *  the sky through the night while the sun is down and sets around dawn. */
export function moonDirection(phase: number): [number, number, number] {
  return sunDirection(phase + 0.5);
}

/** How far above the horizon a body sits, 0 (at or below) to 1 (well up), from
 *  its direction's y. Smooth, so the sun and moon fade in and out through dawn
 *  and dusk instead of snapping on at the horizon line. */
export function aboveHorizon(dirY: number): number {
  return smoothstep((dirY + 0.1) / 0.25); // y <= -0.10 -> 0, y >= 0.15 -> 1
}

/** How strongly the star field shows, 0 (day) to 1 (deep night), from the global
 *  daylight amount. Stars start appearing as it dims past dusk and are full by
 *  the dark of night. */
export function nightStarAmount(dayness: number): number {
  return smoothstep((0.35 - clamp01(dayness)) / 0.3); // dayness >= 0.35 -> 0, <= 0.05 -> 1
}
