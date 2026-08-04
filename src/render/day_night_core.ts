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

/** Full day-to-night-to-day period. One real hour, so every play session sees
 *  the whole cycle; epoch-anchored below, so the phase is identical for every
 *  player on Earth at the same instant, decoupled from local clocks. */
export const DAY_NIGHT_CYCLE_MS = 60 * 60 * 1000;

/** The grade a frame reads: intensity scale for the lights + IBL, per-channel
 *  color multipliers for the sky dome and fog, a fog-distance pull-in, and the
 *  raw night amount (0 = full day, 1 = deepest night) for hue-cool blends. */
export interface DayNightGrade {
  /** multiplies the sun key light's intensity (1 = authored day). */
  lightScale: number;
  /**
   * multiplies the AMBIENT half of the rig (hemisphere light + image-based
   * lighting) instead of `lightScale`. It sits on a higher night floor, because
   * the two halves answer different questions after dark: the key light is the
   * moon, which genuinely is that dim, while the ambient term is the sky bounce
   * that keeps terrain shape and silhouettes readable. Dropping both to the same
   * floor is what makes a night scene read as a black cutout rather than as
   * night, and lifting the key light instead would just flatten the moonlight
   * into a second sun. Always >= lightScale, always <= 1.
   */
  ambientScale: number;
  /** multiplies the sky dome color (1,1,1 = day; dark blue at night). */
  sky: [number, number, number];
  /** multiplies the biome fog color (kept lighter than the sky for readability). */
  fog: [number, number, number];
  /** scales fog `far` so sightlines close in a little after dark. */
  farScale: number;
  /** 1 - effectiveDayness; how far toward night the current grade sits. */
  nightAmt: number;
}

/** The cycle is LIVE: the moving sun and moon are the world's light sources and
 *  the clock reports the real epoch-anchored phase. Setting this back to true
 *  re-pins every consumer to full day (the clock reports noon and the renderer
 *  applies NEUTRAL_DAY_GRADE), the one-line kill switch the cycle shipped
 *  behind; `/daynight <phase>` overrides the live clock either way. */
export const DAY_ONLY = false;

/** The identity grade: the world exactly as its authored daylight rig paints it.
 *  `dayNightGrade(1)` lands on these same values by construction (the day
 *  targets below are neutral), so the cycle's noon IS the authored day look. */
export const NEUTRAL_DAY_GRADE: DayNightGrade = {
  lightScale: 1,
  ambientScale: 1,
  sky: [1, 1, 1],
  fog: [1, 1, 1],
  farScale: 1,
  nightAmt: 0,
};

// Night targets. The floor stays moonlit, not black, so a neutral realm at
// deepest night still reads and stays playable, but the sky itself goes a deep
// dark blue so the moon and stars stand out against it; the fog is a touch
// lighter than the sky for readability. The floor has been walked up from the
// 0.18 first cut across several playtests that all read too dark; 0.36 keeps
// night clearly night while the world stays comfortably playable.
const NIGHT_LIGHT_FLOOR = 0.36;
// The ambient (hemisphere + IBL) floor sits above the key-light floor: the sky
// bounce is what holds terrain shape and body silhouettes together, and pinning
// it to the moon's own dimness is what made deep night read as flat black rather
// than as a lit night. ONE number, kept here in the grade math so no consumer
// has to scatter a night multiplier of its own.
//
// Walked up across three passes (0.50, 0.62, then here) against playtest
// feedback that night was too dark to move around in. This is a 2.2x lift on the
// ambient half with the moonlit key light left untouched, which is what keeps
// the result reading as night: the CONTRAST between the two halves is the night
// cue, not the absolute level, and only the key light casts the long moon
// shadows that sell it.
//
// The last step was measured rather than eyeballed, by mean frame luminance over
// a fixed screenshot tour (see the numbers in the feature's PR notes). Going
// 0.62 to 0.78 moved a town square only about 8 percent, because a lit town is
// dominated by its own lamps and sky, but moved a forest interior 23 to 33
// percent. That shape is the whole argument for putting the knob here: raising
// the ambient floor buys the most exactly where the frame was darkest, and
// nearly nothing where it was already readable.
const NIGHT_AMBIENT_FLOOR = 0.78;
const NIGHT_SKY: [number, number, number] = [0.045, 0.06, 0.15];
const NIGHT_FOG: [number, number, number] = [0.14, 0.18, 0.31];
const NIGHT_FAR_SCALE = 0.82;

/** A signature realm's own night: per-channel sky/fog endpoints replacing the
 *  global deep-blue night, plus an optional scale on the moonlit light floor.
 *  This is how a realm keeps its identity after dark: the Nightbloom's night is
 *  purple and a shade darker, the Drakelands' stays warm with its lava glow. */
export interface RealmNightPalette {
  sky: [number, number, number];
  fog: [number, number, number];
  /** multiplies NIGHT_LIGHT_FLOOR (1 = the global moonlit floor). */
  floorScale?: number;
}

/** Night palettes for the realms whose mood IS a color. Realms without an entry
 *  take the global deep-blue night. Partial on purpose: a new biome without an
 *  entry gets a sane default instead of a build error (the amplitude table is
 *  the exhaustive one). */
export const REALM_NIGHT_PALETTE: Partial<Record<BiomeId, RealmNightPalette>> = {
  // the Nightbloom's dream-night deepens to violet, darker than a neutral night
  night: { sky: [0.09, 0.045, 0.17], fog: [0.24, 0.14, 0.36], floorScale: 0.85 },
  // the Drakelands' volcanic night glows warm: embers, not moonlight
  ember: { sky: [0.16, 0.075, 0.045], fog: [0.34, 0.19, 0.12], floorScale: 1.1 },
  // the Amberreach's golden hour settles into a deep amber evening
  amber: { sky: [0.14, 0.095, 0.05], fog: [0.32, 0.24, 0.15] },
  // the Veiled Hollow's dusk goes rose-violet after dark
  dusk: { sky: [0.13, 0.06, 0.13], fog: [0.28, 0.16, 0.28] },
  // the Frostveil's night is a frozen cyan-blue, colder than the neutral night
  frost: { sky: [0.035, 0.07, 0.16], fog: [0.12, 0.2, 0.32] },
  // the Wraithwood's gloom drains to a dead grey-green
  haunt: { sky: [0.075, 0.09, 0.085], fog: [0.19, 0.22, 0.2] },
};
// Day targets. Neutral on purpose: the golden-hour lighting rig and the
// per-biome HDRI gains (sky.ts HDRI_TUNE) were tuned against the identity
// grade, so the cycle's noon must reproduce that approved look exactly, and
// the cycle only ever dips DOWN toward night from it. (The old sub-white caps
// here predated those gains; they re-dimmed an already-graded day.)
const DAY_LIGHT_CAP = 1;
const DAY_SKY: [number, number, number] = [1, 1, 1];
const DAY_FOG: [number, number, number] = [1, 1, 1];

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
  night: 0.5, // the dream-night realm never sees full daylight, and dips darker than it breathes
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

/** Map an effective daylight amount to the render grade a frame applies. With a
 *  biome, the night end of the lerp comes from that realm's own palette (the
 *  Nightbloom's violet, the Drakelands' ember-warm) so a signature realm stays
 *  itself after dark; without one (or without an entry) it is the global
 *  deep-blue night. Day is always the identity, so the biome only shapes the
 *  dip, never the authored daylight. */
export function dayNightGrade(e: number, biome?: BiomeId): DayNightGrade {
  const c = clamp01(e);
  const palette = biome === undefined ? undefined : REALM_NIGHT_PALETTE[biome];
  const nightSky = palette?.sky ?? NIGHT_SKY;
  const nightFog = palette?.fog ?? NIGHT_FOG;
  const floorScale = palette?.floorScale ?? 1;
  const nightFloor = NIGHT_LIGHT_FLOOR * floorScale;
  // A realm's floorScale shapes its ambient the same way it shapes its key
  // light, but the ambient floor is capped at the authored day so a realm that
  // scales UP (the Drakelands' ember glow) can never brighten past noon.
  const nightAmbientFloor = Math.min(DAY_LIGHT_CAP, NIGHT_AMBIENT_FLOOR * floorScale);
  return {
    lightScale: lerp(nightFloor, DAY_LIGHT_CAP, c),
    ambientScale: lerp(nightAmbientFloor, DAY_LIGHT_CAP, c),
    sky: lerp3(nightSky, DAY_SKY, c),
    fog: lerp3(nightFog, DAY_FOG, c),
    farScale: lerp(NIGHT_FAR_SCALE, 1, c),
    nightAmt: 1 - c,
  };
}

/** Full-day grade, for a sane default before the first frame computes one. */
export function fullDayGrade(): DayNightGrade {
  return dayNightGrade(1);
}

// The minimap day/night dial paints the world cycle as a ring of sky colors and
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

// Dawn/dusk grade warmth: the sky/fog multipliers pull toward these as the sun
// crosses the horizon, so the whole frame (sky dome, scene fog, water) takes
// the sunrise and sunset orange rather than just the key light.
//
// The drama here is SATURATION, never added light, and that distinction is
// load-bearing: distant sprite impostors and the sun-path water glints already
// sit near the top of the range at dusk, so a tint that lifts red is what turns
// them into detail-less white peach. So red stays at (sky) or under (fog) the
// pre-overhaul gain and the depth comes from pulling green and blue down, which
// is also the physically right direction: at the horizon the sun is dimmer AND
// redder, not brighter. Net effect against the values these replace: red 0 to
// -2 percent, Rec.709 luminance 13 to 15 percent LOWER, red-to-blue ratio up
// from about 1.8 to about 2.8. Pinned in tests/day_night.test.ts.
const DUSK_SKY_TINT: [number, number, number] = [1.14, 0.72, 0.4];
const DUSK_FOG_TINT: [number, number, number] = [1.18, 0.74, 0.42];

/** Warm a grade toward the dawn/dusk orange by duskAmt (duskWarmAmount). Hue
 *  only: lightScale and farScale stay the cycle's own curve. Returns a new
 *  grade, never mutates the input; a zero duskAmt returns it untouched. */
export function warmDuskGrade(g: DayNightGrade, duskAmt: number): DayNightGrade {
  const d = clamp01(duskAmt);
  if (d <= 0) return g;
  const tintSky = lerp3([1, 1, 1], DUSK_SKY_TINT, d);
  const tintFog = lerp3([1, 1, 1], DUSK_FOG_TINT, d);
  return {
    ...g,
    sky: [g.sky[0] * tintSky[0], g.sky[1] * tintSky[1], g.sky[2] * tintSky[2]],
    fog: [g.fog[0] * tintFog[0], g.fog[1] * tintFog[1], g.fog[2] * tintFog[2]],
  };
}

/** How strongly the dawn/dusk sky glow shows, 0..1, from the sun's elevation
 *  (its unit-direction y). Peaks while the sun crosses the horizon: fades in
 *  as it drops below ~26 degrees of arc (y 0.44), is full through the crossing,
 *  and is gone once the sun sinks well under (deep night has no sunset). The
 *  sky dome pours its warm horizon lobe in scaled by this.
 *
 *  The window is deliberately WIDE. The first cut only opened at y 0.3 and shut
 *  at y -0.24, which gave a roughly ten-minute golden band per cycle: over
 *  before a player crossing a zone noticed it. Starting the ramp higher and
 *  letting the afterglow linger a little deeper stretches that to about
 *  thirteen minutes, a real golden hour, without leaking into deep night: the
 *  peak sun elevation is ~0.66, so noon still lands exactly on zero. */
export function duskWarmAmount(sunElev: number): number {
  const above = smoothstep((0.44 - sunElev) / 0.4); // fades in as the sun lowers
  const below = smoothstep((sunElev + 0.3) / 0.26); // fades out as it sinks under
  return above * below;
}

/** How much of the key light's golden-hour warmth survives at a sun elevation,
 *  0 (none) to 1 (all of it). This is the sunset's own horizon gate, and it is
 *  deliberately NOT aboveHorizon: that curve is already down to 0.35 by the
 *  time the sun sits ON the horizon, which washed the key light to a pale pink
 *  (rgb 234,199,189) at exactly the moment the sky was most orange, and was the
 *  single biggest reason sunset read flat. This holds full warmth through the
 *  crossing and instead reaches zero at y -0.14, still comfortably before
 *  updateKeyLight has finished handing the key over to the moon (y -0.15), so
 *  moonlight never picks up a sunset tint. */
export function sunsetWarmGate(sunElev: number): number {
  return smoothstep((sunElev + 0.14) / 0.16); // y <= -0.14 -> 0, y >= 0.02 -> 1
}

/** How far the sky dome desaturates toward night, 0 (day, untouched) to a
 *  capped maximum at deepest night: the day HDRI's blues and cloud color grey
 *  out BEFORE the dark night multiply, so the night sky reads as moonlit grey
 *  going on dark, not as a dimmed daytime photograph. Capped under 1 so a
 *  trace of the realm's own sky color survives. */
export function nightSkyDesat(nightAmt: number): number {
  return 0.75 * smoothstep(clamp01(nightAmt));
}

/** The synodic month: eight world days per lunar cycle, epoch-anchored like
 *  the day itself, so the moon's shape drifts night to night the way the real
 *  moon's does and every player sees the identical phase. */
export const LUNAR_CYCLE_MS = 8 * DAY_NIGHT_CYCLE_MS;

/** Lunar phase in [0, 1): 0 = new moon, 0.25 = first quarter, 0.5 = full,
 *  0.75 = last quarter. Same defensive double-modulo as cyclePhase. */
export function lunarPhase(nowMs: number): number {
  return (((nowMs % LUNAR_CYCLE_MS) + LUNAR_CYCLE_MS) % LUNAR_CYCLE_MS) / LUNAR_CYCLE_MS;
}

/** How the moon face's phase shadow is traced for a lunar phase: which side
 *  of the disc the shadow hugs (the moon waxes lit-from-the-right), the
 *  terminator ellipse's half-width (0 = the straight quarter-moon line,
 *  1 = a full-disc curve), and which side that ellipse bulges toward. Pure,
 *  so the canvas painter stays a dumb tracer and this geometry is testable.
 *  Sides are -1 (left) or 1 (right) in screen space. */
export interface MoonTerminator {
  /** fraction of the face lit: 0 = new, 0.5 = a quarter, 1 = full */
  litFrac: number;
  shadowSide: -1 | 1;
  /** terminator ellipse half-width as a fraction of the disc radius */
  rx: number;
  bulgeSide: -1 | 1;
}

export function moonTerminator(p: number): MoonTerminator {
  const c = ((p % 1) + 1) % 1;
  const a = Math.cos(2 * Math.PI * c); // +1 new, 0 at the quarters, -1 full
  const waxing = c < 0.5;
  const shadowSide: -1 | 1 = waxing ? -1 : 1;
  // crescents (a > 0): the shadow spills past centre, bulging toward the lit
  // side; gibbous (a < 0): the lit face spills over, terminator bulging back
  // into the shadow side.
  const bulgeSide: -1 | 1 = a > 0 ? (-shadowSide as -1 | 1) : shadowSide;
  return { litFrac: (1 - a) / 2, shadowSide, rx: Math.abs(a), bulgeSide };
}
