// Pure plan for the Mere Hydra's Tsunami wave (temple_hydra_fx.ts draws it):
// the breaking wave's cross-section as it builds on the rim and curls over as
// it rolls, its crest height and forward travel over the bar, the shoulders
// that taper it across its width, the spray it sheds by graphics tier, and the
// lingering foam it leaves on the half of the pool it swept.
//
// The wave's clock is the sim's own: the heads' Tsunami bar (castRemaining of
// castTotal) says how far the wall has built, the wave object's surge template
// says it rolls (for HYDRA_TUNING.tsunamiRoll seconds), and the object's
// disappearance is the landing. Nothing here decides an outcome; the floor
// telegraph (temple_fx.ts) is the actionable read and paints over all of it.
//
// Three-free, DOM-free, deterministic.

import { HYDRA_TUNING, POOL } from '../../sim/encounters/drowned_temple/ids';
import { POOL_WATER } from './temple_plan_core';

// ---- the cross-section -----------------------------------------------------------------

/** Points in the front face's profile table (the vertex shader interpolates it). */
export const TSUNAMI_PROFILE_POINTS = 25;
/** Integration sub-steps between two table points. */
const PROFILE_SUBSTEPS = 4;
/** The face's tangent angle (radians from the heading, in the heading/up plane)
 *  at the toe: it climbs steeply, leaning back a touch (a concave face). */
const PHI_TOE = 1.95;
/** The tangent at the lip of a standing wall: leaning a little forward. */
const PHI_STAND = 1.35;
/** The tangent at the lip of a fully curled wave: pitched over and down, under. */
const PHI_CURLED = -2.4;
/** Curvature grows along the face (a tightening spiral): the exponent. */
const CURL_EXPONENT = 3;
/** How much longer the lip grows as it throws forward (at full curl). */
const LIP_THROW = 2.2;

/** Where the crest and the lip of one profile are (heading-local yards). */
export interface TsunamiProfileSummary {
  /** The crest: the highest point of the face (its y is the height). */
  crestZ: number;
  crestY: number;
  /** The profile parameter (0 toe, 1 lip tip) at the crest. */
  crestV: number;
  /** The lip tip. */
  tipZ: number;
  tipY: number;
  /** How far forward of the toe the lip reaches (the furthest z). */
  reach: number;
}

export function makeTsunamiProfileSummary(): TsunamiProfileSummary {
  return { crestZ: 0, crestY: 0, crestV: 0, tipZ: 0, tipY: 0, reach: 0 };
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

/**
 * The front face's cross-section, toe to lip tip, into `out` as
 * TSUNAMI_PROFILE_POINTS triples (z forward along the heading, y up, and the
 * tangent angle for the shading normal). The toe sits at the origin; the
 * crest is scaled to exactly `height`. `curl` 0 is a standing wall whose top
 * leans slightly forward; 1 is a plunging breaker whose lip has thrown forward
 * past the toe and curled down toward the floor.
 */
export function tsunamiProfileInto(
  out: Float32Array,
  height: number,
  curl: number,
  summary: TsunamiProfileSummary,
): void {
  const c = clamp01(curl);
  const phiEnd = PHI_STAND + (PHI_CURLED - PHI_STAND) * c;
  const steps = (TSUNAMI_PROFILE_POINTS - 1) * PROFILE_SUBSTEPS;
  let z = 0;
  let y = 0;
  let maxY = 0;
  out[0] = 0;
  out[1] = 0;
  out[2] = PHI_TOE;
  for (let i = 0; i < steps; i++) {
    const s = (i + 0.5) / steps;
    const phi = PHI_TOE + (phiEnd - PHI_TOE) * s ** CURL_EXPONENT;
    const ds = (1 + LIP_THROW * c * smoothstep(0.5, 0.9, s)) / steps;
    z += Math.cos(phi) * ds;
    y += Math.sin(phi) * ds;
    if ((i + 1) % PROFILE_SUBSTEPS === 0) {
      const k = ((i + 1) / PROFILE_SUBSTEPS) * 3;
      out[k] = z;
      out[k + 1] = y;
      const sEnd = (i + 1) / steps;
      out[k + 2] = PHI_TOE + (phiEnd - PHI_TOE) * sEnd ** CURL_EXPONENT;
      if (y > maxY) maxY = y;
    }
  }
  const scale = height / Math.max(maxY, 1e-6);
  let crest = 0;
  let reach = 0;
  for (let p = 0; p < TSUNAMI_PROFILE_POINTS; p++) {
    out[p * 3] *= scale;
    out[p * 3 + 1] *= scale;
    if (out[p * 3 + 1] > out[crest * 3 + 1]) crest = p;
    if (out[p * 3] > reach) reach = out[p * 3];
  }
  const last = (TSUNAMI_PROFILE_POINTS - 1) * 3;
  summary.crestZ = out[crest * 3];
  summary.crestY = out[crest * 3 + 1];
  summary.crestV = crest / (TSUNAMI_PROFILE_POINTS - 1);
  summary.tipZ = out[last];
  summary.tipY = out[last + 1];
  summary.reach = reach;
}

/** The back slope runs this many crest heights behind the crest. */
export const TSUNAMI_BACK_DEPTH = 1.3;

// ---- the wave over the bar -------------------------------------------------------------

/** The swell's height as it first lifts off the rim. */
export const TSUNAMI_SWELL_HEIGHT = 1.4;
/** The standing wall's height when the bar reaches the roll. */
export const TSUNAMI_WALL_HEIGHT = 7.5;
/** The crest's height as it pitches over mid-roll. */
export const TSUNAMI_SURGE_HEIGHT = 9.2;
/** The crest has begun to feather this far by the end of the warning. */
export const TSUNAMI_WARN_CURL = 0.22;
/** The broken wave collapses and fades over this long after it lands. */
export const TSUNAMI_CRASH_SECONDS = 0.9;
/** A newly seen wave fades in over this long. */
const FADE_IN_SECONDS = 0.45;
/** The whole wave: the pool's diameter and a stride of lagoon each side. */
export const TSUNAMI_WIDTH = POOL.r * 2 + 8;
/** The lip lands on the pool's middle line and a stride beyond it (the sim's
 *  half: the telegraph's straight edge). */
export const TSUNAMI_LANDING = POOL.r + 2;
/** The warning's length when no head bar is readable (the first wave's). */
export const TSUNAMI_WARN_SECONDS = HYDRA_TUNING.tsunamiCast - HYDRA_TUNING.tsunamiRoll;

/**
 * How far the wall has built (0 just raised, 1 the roll begins), read off a
 * head's Tsunami bar: the roll takes the bar's last `tsunamiRoll` seconds, so
 * the build fills the rest. The first wave's bar is `tsunamiCast`, the heroic
 * backwash's is `backwashAfter`: both read right.
 */
export function tsunamiWarnProgress(castRemaining: number, castTotal: number): number {
  const roll = HYDRA_TUNING.tsunamiRoll;
  const warn = castTotal - roll;
  if (!(warn > 0)) return 1;
  return clamp01(1 - (castRemaining - roll) / warn);
}

/** The wave's pose this frame (uniform inputs for the painter). */
export interface TsunamiShape {
  /** The crest's height (yards over the rim floor). */
  height: number;
  /** How far the lip has curled over (0 standing, 1 plunging). */
  curl: number;
  /** How far the toe has rolled in from the rim (yards along the heading). */
  travel: number;
  /** Whole-wave opacity (fade in, crash fade out). */
  alpha: number;
  /** Whitewater on the crest and the face (0 to 1). */
  foam: number;
  /** Where the white lip starts up the face (profile parameter). */
  foamStart: number;
  /** Churning white water at the toe. */
  churn: number;
  /** The broken wave's collapse (0 standing, 1 gone). */
  collapse: number;
}

export function makeTsunamiShape(): TsunamiShape {
  return {
    height: 0,
    curl: 0,
    travel: 0,
    alpha: 0,
    foam: 0,
    foamStart: 1,
    churn: 0,
    collapse: 0,
  };
}

/** The crest's height: a swell lifting into a wall over the warning, then
 *  rearing higher as it pitches over on the roll. */
export function tsunamiHeight(build: number, roll: number): number {
  const b = clamp01(build);
  const rise = 1 - (1 - b) ** 3;
  const wall = TSUNAMI_SWELL_HEIGHT + (TSUNAMI_WALL_HEIGHT - TSUNAMI_SWELL_HEIGHT) * rise;
  return wall + (TSUNAMI_SURGE_HEIGHT - TSUNAMI_WALL_HEIGHT) * smoothstep(0, 0.6, roll);
}

/** The lip's curl: a standing wall that only feathers at its top while the
 *  bar runs, then throws and curls right over as it rolls. */
export function tsunamiCurl(build: number, roll: number): number {
  const warn = TSUNAMI_WARN_CURL * smoothstep(0.55, 1, build);
  return warn + (1 - warn) * smoothstep(0.05, 0.9, roll);
}

const scratchProfile = new Float32Array(TSUNAMI_PROFILE_POINTS * 3);
const scratchSummary = makeTsunamiProfileSummary();

/** How far the fully curled lip reaches ahead of the toe at the roll's end. */
export const TSUNAMI_LIP_REACH_FULL = (() => {
  tsunamiProfileInto(scratchProfile, tsunamiHeight(1, 1), tsunamiCurl(1, 1), scratchSummary);
  return scratchSummary.reach;
})();

/** The toe's travel in from the rim over the roll: it accelerates as it
 *  pitches, and the fully curled lip lands exactly on TSUNAMI_LANDING. */
export function tsunamiTravel(roll: number): number {
  const r = clamp01(roll);
  return r * (0.35 + 0.65 * r) * (TSUNAMI_LANDING - TSUNAMI_LIP_REACH_FULL);
}

/**
 * The wave's pose. `build` is the warning's progress (tsunamiWarnProgress, or
 * the seconds seen over TSUNAMI_WARN_SECONDS), `roll` the surge's (0 to 1),
 * `crashAge` the seconds since it landed (negative while it stands), `seen`
 * the seconds since it was first drawn.
 */
export function tsunamiShapeInto(
  out: TsunamiShape,
  build: number,
  roll: number,
  crashAge: number,
  seen: number,
): void {
  const r = clamp01(roll);
  // A wave first seen late (or on a roll) still stands fully built by the time
  // its lip throws.
  const b = Math.max(clamp01(build), smoothstep(0, 0.35, r));
  out.height = tsunamiHeight(b, r);
  out.curl = tsunamiCurl(b, r);
  out.travel = tsunamiTravel(r);
  out.foam = 0.18 + 0.32 * smoothstep(0.5, 1, b) + 0.5 * r;
  out.foamStart = 0.93 - 0.2 * out.curl;
  out.churn = r > 0 ? 0.45 + 0.55 * r : 0.3 * smoothstep(0.3, 1, b);
  const fadeIn = clamp01(seen / FADE_IN_SECONDS);
  if (crashAge >= 0) {
    const k = clamp01(crashAge / TSUNAMI_CRASH_SECONDS);
    out.collapse = k;
    out.foam = Math.min(1, out.foam + 0.5 * k);
    out.foamStart = Math.max(0.35, out.foamStart - 0.45 * k);
    out.churn = 1 - k;
    out.alpha = fadeIn * (1 - k) ** 1.3;
  } else {
    out.collapse = 0;
    out.alpha = fadeIn;
  }
}

// ---- across the width ------------------------------------------------------------------

/** The shoulders: across the wave (e 0 at the middle, 1 at either end) the
 *  crest drops away, the curl softens (blend weight toward the gentler
 *  profile), and the break peels back behind the middle. */
export interface TsunamiShoulder {
  height: number;
  soft: number;
  lag: number;
}

const SHOULDER_DROP = 0.78;
const SHOULDER_PEEL = 2.5;

export function tsunamiShoulder(e: number, out: TsunamiShoulder): TsunamiShoulder {
  const x = clamp01(e);
  out.height = 1 - SHOULDER_DROP * smoothstep(0.5, 1, x);
  out.soft = smoothstep(0.3, 0.9, x);
  out.lag = SHOULDER_PEEL * x * x;
  return out;
}

/** The softer profile the shoulders blend toward carries this share of the curl. */
export const TSUNAMI_SHOULDER_CURL = 0.35;

const f = (n: number) => n.toFixed(4);

/** The same shoulders in GLSL (the vertex shader's copy). */
export const TSUNAMI_SHOULDER_GLSL = /* glsl */ `
float tsunamiShoulderHeight(float e) { return 1.0 - ${f(SHOULDER_DROP)} * smoothstep(0.5, 1.0, e); }
float tsunamiShoulderSoft(float e) { return smoothstep(0.3, 0.9, e); }
float tsunamiShoulderLag(float e) { return ${f(SHOULDER_PEEL)} * e * e; }
`;

// ---- the look --------------------------------------------------------------------------

/** Linear colours. No channel of the wave or its foam exceeds `maxChannel`,
 *  well under the bloom threshold, so nothing here out-glows the telegraph. */
export const TSUNAMI_LOOK = {
  /** The thick body at the foot: teal almost black. */
  deep: [0.004, 0.03, 0.04],
  /** The body higher up the face. */
  body: [0.02, 0.15, 0.18],
  /** Light through the thin lip: a translucent green-teal. */
  crest: [0.09, 0.42, 0.42],
  /** The sky sheen at grazing angles. */
  sky: [0.26, 0.38, 0.44],
  /** Whitewater on the crest: a cool off-white, never pure white. */
  foam: [0.72, 0.82, 0.84],
  /** Spray puffs and droplets. */
  spray: [0.56, 0.67, 0.72],
  drop: [0.44, 0.5, 0.5],
  /** The lingering foam lace on the floor. */
  floorFoam: [0.58, 0.68, 0.7],
  maxChannel: 0.9,
} as const;

// ---- spray by tier ---------------------------------------------------------------------

export type TsunamiTier = 'low' | 'full';

export function tsunamiTier(detail: boolean): TsunamiTier {
  return detail ? 'full' : 'low';
}

export interface TsunamiTierPlan {
  /** Pool capacities (the foam holds two waves' worth: the heroic backwash
   *  lands while the first wave's foam still lingers). */
  sprayCapacity: number;
  dropCapacity: number;
  foamCapacity: number;
  /** Peak emission per second: spindrift blown back off the crest, droplets
   *  thrown off the lip, churn at the toe. */
  spindrift: number;
  lip: number;
  churn: number;
  /** The landing's burst. */
  crashSpray: number;
  crashDrops: number;
  /** Lingering foam patches laid over the whole roll, and at the landing. */
  foamRoll: number;
  foamCrash: number;
  /** The wave mesh: columns across, rows up the face, rows down the back. */
  cols: number;
  faceRows: number;
  backRows: number;
}

export const TSUNAMI_TIERS: Readonly<Record<TsunamiTier, TsunamiTierPlan>> = {
  full: {
    sprayCapacity: 720,
    dropCapacity: 560,
    foamCapacity: 256,
    spindrift: 110,
    lip: 150,
    churn: 70,
    crashSpray: 200,
    crashDrops: 170,
    foamRoll: 80,
    foamCrash: 44,
    cols: 72,
    faceRows: 32,
    backRows: 10,
  },
  low: {
    sprayCapacity: 260,
    dropCapacity: 180,
    foamCapacity: 96,
    spindrift: 38,
    lip: 50,
    churn: 24,
    crashSpray: 70,
    crashDrops: 56,
    foamRoll: 28,
    foamCrash: 16,
    cols: 30,
    faceRows: 18,
    backRows: 6,
  },
};

/** The longest a spray puff or a droplet lives (the pools' sizing bound). */
export const TSUNAMI_SPRAY_LIFE_MAX = 2;
export const TSUNAMI_DROP_LIFE_MAX = 1.4;

export interface TsunamiSprayRates {
  spindrift: number;
  lip: number;
  churn: number;
}

/** Spray per second for this pose: spindrift once the crest feathers (late
 *  in the warning) and all through the roll, the lip's droplets and the toe's
 *  churn on the roll. Density only: the wave's position and timing never
 *  depend on the tier. */
export function tsunamiSprayRatesInto(
  out: TsunamiSprayRates,
  tier: TsunamiTier,
  build: number,
  roll: number,
): TsunamiSprayRates {
  const plan = TSUNAMI_TIERS[tier];
  const r = clamp01(roll);
  out.spindrift = plan.spindrift * Math.max(smoothstep(0.45, 1, build) * 0.7, r > 0 ? 1 : 0);
  out.lip = plan.lip * smoothstep(0.1, 0.6, r);
  out.churn = plan.churn * (r > 0 ? 1 : 0.3 * smoothstep(0.3, 1, build));
  return out;
}

// ---- the lingering foam ----------------------------------------------------------------

/** A foam patch grows from this size to that (yards across). */
export const TSUNAMI_FOAM_SIZE_MIN = 1.6;
export const TSUNAMI_FOAM_SIZE_MAX = 3.4;
/** How far a patch drifts along the heading over its whole life, at most. */
export const TSUNAMI_FOAM_DRIFT = 0.5;
/** Clearance kept from the pool's middle line (the other half is the heroic
 *  backwash's telegraph: the foam never spills onto it). */
export const TSUNAMI_FOAM_MIDLINE_CLEARANCE = 0.75;
/** Patches start this far in from the rim. */
const FOAM_RIM_INSET = 1.2;
/** How deep the moon pool's water sits under the rim floor. */
export const TSUNAMI_POOL_WATER_DROP = POOL.h - POOL_WATER.y;
/** Patches live this long (seconds): the foam lingers a few seconds. */
export const TSUNAMI_FOAM_LIFE_MIN = 3.5;
export const TSUNAMI_FOAM_LIFE_MAX = 5.5;

/** The furthest along the heading (from the rim) a patch centre may sit. */
export const TSUNAMI_FOAM_MAX_ALONG =
  POOL.r - TSUNAMI_FOAM_MIDLINE_CLEARANCE - TSUNAMI_FOAM_SIZE_MAX / 2 - TSUNAMI_FOAM_DRIFT;

export interface TsunamiFoamPatch {
  /** Yards from the rim along the heading, and across it (right of heading). */
  along: number;
  across: number;
  /** Final size (yards across); it starts at the smaller size. */
  size: number;
  /** On the moon pool's water (true) or the rim's flagstones. */
  onWater: boolean;
}

export function makeTsunamiFoamPatch(): TsunamiFoamPatch {
  return { along: 0, across: 0, size: 0, onWater: false };
}

/**
 * Place one lingering foam patch in the band [alongMin, alongMax] (yards from
 * the rim) from three uniform draws. It always lies wholly inside the swept
 * half: inside the pool's rim and short of the middle line, its drift and its
 * full size included, so it can never sit on the other half's telegraph.
 */
export function tsunamiFoamPatchInto(
  out: TsunamiFoamPatch,
  u1: number,
  u2: number,
  u3: number,
  alongMin: number,
  alongMax: number,
): TsunamiFoamPatch {
  const size =
    TSUNAMI_FOAM_SIZE_MIN + (TSUNAMI_FOAM_SIZE_MAX - TSUNAMI_FOAM_SIZE_MIN) * clamp01(u3);
  const lo = Math.max(FOAM_RIM_INSET + size / 2, Math.min(alongMin, alongMax));
  const hi = Math.min(TSUNAMI_FOAM_MAX_ALONG, Math.max(alongMin, alongMax));
  const along = hi > lo ? lo + (hi - lo) * clamp01(u1) : Math.min(lo, TSUNAMI_FOAM_MAX_ALONG);
  // The chord of the rim circle at this depth, less the patch's own radius.
  const fromCentre = POOL.r - along;
  const chord = Math.sqrt(Math.max(0, (POOL.r - size / 2) ** 2 - fromCentre * fromCentre));
  out.along = along;
  out.across = (clamp01(u2) * 2 - 1) * chord * 0.94;
  out.size = size;
  out.onWater = Math.hypot(fromCentre, out.across) + size / 2 < POOL_WATER.r;
  return out;
}

/** The lace's peak opacity: subtle, a trace of the wave, never a mark. */
export const TSUNAMI_FOAM_PEAK_ALPHA = 0.26;
const FOAM_FADE_IN = 0.08;

/** The lingering foam's opacity over its life fraction t (0 to 1): a quick
 *  settle, then a long thinning to nothing. */
export function tsunamiFoamAlpha(t: number): number {
  if (t <= 0 || t >= 1) return 0;
  const settle = smoothstep(0, FOAM_FADE_IN, t);
  const thin = (1 - smoothstep(FOAM_FADE_IN, 1, t)) ** 1.3;
  return TSUNAMI_FOAM_PEAK_ALPHA * settle * thin;
}

/** The same curve in GLSL (the foam's fragment shader). */
export const TSUNAMI_FOAM_FADE_GLSL = /* glsl */ `
float tsunamiFoamAlpha(float t) {
  if (t <= 0.0 || t >= 1.0) return 0.0;
  float settle = smoothstep(0.0, ${f(FOAM_FADE_IN)}, t);
  float thin = pow(max(1.0 - smoothstep(${f(FOAM_FADE_IN)}, 1.0, t), 0.0), 1.3);
  return ${f(TSUNAMI_FOAM_PEAK_ALPHA)} * settle * thin;
}
`;
