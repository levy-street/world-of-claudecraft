// twin_moons_core: where the world's two moons sit and what they do to the night.
//
// The MAGE'S MOON is a made thing: it shines by its own light, always full, and is
// held exactly opposite the sun, so it rises as the sun sets and sets as the sun
// rises. It is the night's key light (the renderer's moonDir) and never changes
// shape. The NATURAL MOON follows Earth's moon in most ways: a 29.5-day synodic
// month (LUNAR_CYCLE_MS in day_night_core), an orbit tilted about 5 degrees off
// the sun's path so eclipses come in seasons, and a slightly oval orbit that
// makes it grow and shrink by about 5 percent. One deliberate departure: Earth's
// moon sits (0.5 - phase) of a turn from the antisolar point, which puts a new
// moon in the daytime sky; here that spread is squeezed to NIGHT_SWING of it, so
// the natural moon never strays more than about 63 degrees of arc from the mage's
// moon and is up every night (a crescent sets a few hours early or rises a few
// hours late, a full moon is up all night). It therefore never covers the sun.
//
// At full moon the natural moon passes the antisolar point, which is both the
// centre of the planet's shadow and where the mage's moon hangs: near a node that
// is a lunar eclipse (the natural moon turns copper red in the umbra) AND a
// covering of the mage's moon, so the night darkens for a while.
//
// Pure and deterministic: no Three, no DOM, no clock. The renderer passes the
// cycle phase, the lunar phase and the world-day count (day_night_clock reads
// Date.now); a Vitest drives any moment directly. Cosmetic only: nothing here
// reaches the sim, and the night it lights never drops below the night floors
// day_night_core already guarantees (moonNightFloors clamps the key light).

import { aboveHorizon, SYNODIC_MONTH_DAYS, sunDirectionInto } from './day_night_core';

export { SYNODIC_MONTH_DAYS };

export type Vec3 = [number, number, number];

/** Earth's moon, in world days (the synodic month lives with LUNAR_CYCLE_MS in day_night_core). */
export const DRACONIC_MONTH_DAYS = 27.212221; // node to node: sets the eclipse seasons
export const ANOMALISTIC_MONTH_DAYS = 27.55455; // nearest point to nearest point: sets the size swing
/** How far the natural moon's orbit tilts from the sun's path, in degrees. */
export const MOON_INCLINATION_DEG = 5.145;
/** Fraction of Earth's sun-to-moon spread the natural moon keeps (see header). */
export const NIGHT_SWING = 0.35;
/** The size swing either side of the mean (Earth's is about 6 percent). */
export const MOON_SIZE_SWING = 0.055;

// Apparent radii in units of the natural moon's mean radius, Earth's ratios: the
// umbra at the moon's distance is about 0.70 deg against the moon's 0.26.
export const UMBRA_RADII = 0.7 / 0.26;
export const PENUMBRA_RADII = 1.25 / 0.26;
/** The mage's moon draws a touch smaller than the natural moon, so a covering is total. */
export const MAGE_MOON_RADII = 0.92;
const MOON_TRUE_RADIUS_DEG = 0.26;

/**
 * The drawn natural moon's angular radius in radians. The face sprite is
 * MOON_FACE_SCALE (54) world units across at 760 units from the camera, with the
 * disc filling 118/128 of it (celestial_sprites). Restated here so this core
 * stays Three-free; tests/twin_moons_core.test.ts pins it against those values.
 */
export const MOON_ANGULAR_RADIUS = Math.atan(((54 / 2) * (118 / 128)) / 760);

// Latitude off the sun's path, mapped to drawn moon radii: true to the drawn size
// near the path (so eclipse contacts happen at Earth's limits), then compressed so
// the whole 5 degree swing stays a short way off the path instead of the 20 drawn
// radii a literal mapping would throw it.
const LAT_TRUE_SCALE_DEG = 1.6;
const LAT_FAR_EXTRA_RADII = 1;

/** Degrees off the sun's path to drawn moon radii (signed). */
export function latitudeToRadii(deg: number): number {
  const a = Math.abs(deg);
  const radii =
    a <= LAT_TRUE_SCALE_DEG
      ? a / MOON_TRUE_RADIUS_DEG
      : LAT_TRUE_SCALE_DEG / MOON_TRUE_RADIUS_DEG +
        ((a - LAT_TRUE_SCALE_DEG) / (MOON_INCLINATION_DEG - LAT_TRUE_SCALE_DEG)) *
          LAT_FAR_EXTRA_RADII;
  return Math.sign(deg) * radii;
}

const TAU = Math.PI * 2;
const frac = (x: number) => x - Math.floor(x);
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
/** a x b into out; safe when out is a or b (reads every input first). */
function crossInto(out: Vec3, a: Vec3, b: Vec3): Vec3 {
  const x = a[1] * b[2] - a[2] * b[1];
  const y = a[2] * b[0] - a[0] * b[2];
  const z = a[0] * b[1] - a[1] * b[0];
  out[0] = x;
  out[1] = y;
  out[2] = z;
  return out;
}
/** Normalize v in place. */
function normInto(v: Vec3): Vec3 {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  v[0] /= l;
  v[1] /= l;
  v[2] /= l;
  return v;
}

/** The natural moon's offset from the sun's path, in degrees, for a world-day count. */
export function moonLatitudeDeg(worldDays: number): number {
  return MOON_INCLINATION_DEG * Math.sin(frac(worldDays / DRACONIC_MONTH_DAYS) * TAU);
}

/** The natural moon's apparent size against its mean, for a world-day count. */
export function moonSizeFactor(worldDays: number): number {
  return 1 + MOON_SIZE_SWING * Math.cos(frac(worldDays / ANOMALISTIC_MONTH_DAYS) * TAU);
}

/**
 * Where the natural moon sits ALONG the sun's path, as a cycle phase of that
 * path: the mage's moon's spot (half a cycle from the sun) shifted by the squeezed
 * lunar spread. A waxing moon sits west of the antisolar point (a larger path
 * phase, so it is up in the evening and sets early), a waning moon east of it
 * (it rises late and is up into the morning), a full moon exactly on it.
 */
export function naturalMoonPathPhase(dayPhase: number, lunarPhase: number): number {
  return dayPhase + 0.5 + (0.5 - lunarPhase) * NIGHT_SWING;
}

/** Unit tangent of the sun's path at a path phase, pointing the way the sky turns (westward). */
export function pathTangent(pathPhase: number): Vec3 {
  return pathTangentInto([0, 0, 0], pathPhase);
}

const sPathDir: Vec3 = [0, 0, 0];

/** pathTangent written into a caller-owned vector. */
export function pathTangentInto(out: Vec3, pathPhase: number): Vec3 {
  const d = sunDirectionInto(sPathDir, pathPhase);
  const a = (pathPhase - 0.25) * TAU;
  // derivative of sunDirection's unnormalized vector, then made perpendicular to d
  const rx = -Math.sin(a);
  const ry = Math.cos(a) * 0.28;
  const k = rx * d[0] + ry * d[1];
  out[0] = rx - k * d[0];
  out[1] = ry - k * d[1];
  out[2] = -k * d[2];
  return normInto(out);
}

export interface MoonSky {
  /** the mage's moon: held opposite the sun; also the night key light's direction */
  mageDir: Vec3;
  naturalDir: Vec3;
  /** unit tangent of the path at the natural moon, westward: its sunward limb for a waxing moon */
  naturalTangent: Vec3;
  /** 0 new, 0.5 full */
  lunarPhase: number;
  /** 0 new, 1 full */
  litFrac: number;
  /** degrees off the sun's path */
  latitudeDeg: number;
  size: number;
  /** how far each body sits above the horizon, 0..1 (aboveHorizon) */
  mageUp: number;
  naturalUp: number;
  /** share of the natural moon's disc inside the umbra / inside the penumbra ring only */
  umbra: number;
  penumbra: number;
  /** share of the mage's moon hidden behind the natural moon */
  mageCover: number;
  /** the umbra's centre seen from the natural moon's centre, in its own radii, in the
   *  face frame: +x along naturalTangent, +y a quarter turn counter-clockwise on screen */
  umbraOffset: [number, number];
  /** the moonlit fraction the night grade reads (dayNightGrade's moonLitFrac) */
  nightLitFrac: number;
}

/** Area of overlap of two circles at centre distance d. */
export function circleOverlap(d: number, r1: number, r2: number): number {
  if (d >= r1 + r2) return 0;
  if (d <= Math.abs(r1 - r2)) return Math.PI * Math.min(r1, r2) ** 2;
  const a1 = r1 * r1 * Math.acos((d * d + r1 * r1 - r2 * r2) / (2 * d * r1));
  const a2 = r2 * r2 * Math.acos((d * d + r2 * r2 - r1 * r1) / (2 * d * r2));
  const k = 0.5 * Math.sqrt((-d + r1 + r2) * (d + r1 - r2) * (d - r1 + r2) * (d + r1 + r2));
  return a1 + a2 - k;
}

/**
 * The moonlit fraction the night grade reads. The mage's moon alone is the
 * half-moon reference (0.5: the night this game has always had as its normal),
 * the natural moon adds up to another half as it fills and climbs, so a new-moon
 * night is the normal night and a full-moon night is the brightest. A covering
 * dims the mage's share and the umbra dims the natural one, so an eclipse is the
 * one night that runs darker than normal.
 */
export function nightLitFraction(
  litFrac: number,
  naturalUp: number,
  umbra: number,
  penumbra: number,
  mageCover: number,
): number {
  const mage = 0.5 * (1 - 0.85 * mageCover);
  const natural = 0.5 * litFrac * naturalUp * (1 - 0.92 * umbra) * (1 - 0.3 * penumbra);
  return clamp01(mage + natural);
}

/** A MoonSky with every field zeroed, for a caller that fills one per frame with moonSkyInto. */
export function createMoonSky(): MoonSky {
  return {
    mageDir: [0, 0, 0],
    naturalDir: [0, 0, 0],
    naturalTangent: [0, 0, 0],
    lunarPhase: 0,
    litFrac: 0,
    latitudeDeg: 0,
    size: 1,
    mageUp: 0,
    naturalUp: 0,
    umbra: 0,
    penumbra: 0,
    mageCover: 0,
    umbraOffset: [0, 0],
    nightLitFrac: 0.5,
  };
}

/**
 * The whole two-moon sky for one moment, as a fresh object. `latitudeOverrideDeg`
 * is the dev `/daynight moon eclipse` pin (null for the real orbit).
 */
export function moonSky(
  dayPhase: number,
  lunarPhase: number,
  worldDays: number,
  latitudeOverrideDeg: number | null = null,
): MoonSky {
  return moonSkyInto(createMoonSky(), dayPhase, lunarPhase, worldDays, latitudeOverrideDeg);
}

// Module scratch for moonSkyInto, so the per-frame path allocates nothing.
const sOnPath: Vec3 = [0, 0, 0];
const sTangent: Vec3 = [0, 0, 0];
const sNorth: Vec3 = [0, 0, 0];
const sTmp: Vec3 = [0, 0, 0];
const sFaceUp: Vec3 = [0, 0, 0];

/**
 * moonSky written into a caller-owned MoonSky (createMoonSky), so the renderer's
 * per-frame read allocates nothing: every vector it touches is either one of
 * `out`'s own or this module's scratch. Returns `out`.
 */
export function moonSkyInto(
  out: MoonSky,
  dayPhase: number,
  lunarPhase: number,
  worldDays: number,
  latitudeOverrideDeg: number | null = null,
): MoonSky {
  const lp = frac(lunarPhase);
  const mageDir = sunDirectionInto(out.mageDir, dayPhase + 0.5);
  const pathPhase = naturalMoonPathPhase(dayPhase, lp);
  const onPath = sunDirectionInto(sOnPath, pathPhase);
  const tangent = pathTangentInto(sTangent, pathPhase);
  const north = normInto(crossInto(sNorth, tangent, onPath));
  const latitudeDeg = latitudeOverrideDeg ?? moonLatitudeDeg(worldDays);
  const offset = latitudeToRadii(latitudeDeg) * MOON_ANGULAR_RADIUS;
  const c = Math.cos(offset);
  const s = Math.sin(offset);
  const naturalDir = out.naturalDir;
  naturalDir[0] = onPath[0] * c + north[0] * s;
  naturalDir[1] = onPath[1] * c + north[1] * s;
  naturalDir[2] = onPath[2] * c + north[2] * s;
  normInto(naturalDir);
  // the path tangent made perpendicular to the moon's own direction
  const naturalTangent = normInto(
    crossInto(out.naturalTangent, naturalDir, crossInto(sTmp, tangent, naturalDir)),
  );
  const faceUp = normInto(crossInto(sFaceUp, naturalTangent, naturalDir));
  const size = moonSizeFactor(worldDays);

  // the shadow's centre is the antisolar point, which is where the mage's moon hangs
  sTmp[0] = mageDir[0] - naturalDir[0];
  sTmp[1] = mageDir[1] - naturalDir[1];
  sTmp[2] = mageDir[2] - naturalDir[2];
  const sep = Math.acos(Math.max(-1, Math.min(1, dot(naturalDir, mageDir)))) / MOON_ANGULAR_RADIUS;
  const area = Math.PI * size * size;
  const umbra = circleOverlap(sep, UMBRA_RADII, size) / area;
  const penumbra = Math.max(0, circleOverlap(sep, PENUMBRA_RADII, size) / area - umbra);
  const mageCover =
    circleOverlap(sep, size, MAGE_MOON_RADII) / (Math.PI * MAGE_MOON_RADII * MAGE_MOON_RADII);
  out.umbraOffset[0] = dot(sTmp, naturalTangent) / (MOON_ANGULAR_RADIUS * size);
  out.umbraOffset[1] = dot(sTmp, faceUp) / (MOON_ANGULAR_RADIUS * size);

  // moonTerminator's lit fraction, inline so no terminator object is built per frame
  const litFrac = (1 - Math.cos(TAU * lp)) / 2;
  const naturalUp = aboveHorizon(naturalDir[1]);
  out.lunarPhase = lp;
  out.litFrac = litFrac;
  out.latitudeDeg = latitudeDeg;
  out.size = size;
  out.mageUp = aboveHorizon(mageDir[1]);
  out.naturalUp = naturalUp;
  out.umbra = umbra;
  out.penumbra = penumbra;
  out.mageCover = mageCover;
  out.nightLitFrac = nightLitFraction(litFrac, naturalUp, umbra, penumbra, mageCover);
  return out;
}

/**
 * The mage made its moon burn brighter near the horizon, so dusk and dawn never
 * dim while it hands over with the sun: a halo scale multiplier, 1 overhead, up
 * to 1.6 on the horizon line. Cosmetic: the grade's light floor is unchanged.
 */
export function mageHaloBoost(mageDirY: number): number {
  return 1 + 0.6 * Math.exp(-((mageDirY / 0.08) ** 2));
}

/**
 * A sprite's screen rotation (three's SpriteMaterial.rotation, counter-clockwise)
 * that lays the face texture's +x along a world direction on the sky, given the
 * camera's world right and up axes. The natural moon's face is painted lit from
 * +x while waxing, so aiming +x along the path tangent turns its lit limb toward
 * the sun without ever flipping the face at full moon.
 */
export function spriteRotationAlong(dir: Vec3, camRight: Vec3, camUp: Vec3): number {
  return Math.atan2(dot(dir, camUp), dot(dir, camRight));
}
