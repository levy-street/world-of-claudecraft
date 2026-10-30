// Pure policy for the PAINTED skies in src/render/sky.ts: the grade a painted (LDR)
// sky texture takes on the dome, and the dusk crossfade from a biome's painted day
// sky to its painted night sky. Three/DOM-free so the curves are pinned by a plain
// Vitest (tests/sky_painted_core.test.ts); sky.ts is the thin consumer that writes the
// results into the dome uniforms, and scripts/assets/compress_sky_ldr.mjs makes the
// textures.
//
// Colour space, the one fact everything below leans on: a painted sky ships as UASTC
// LDR KTX2 whose DFD carries the sRGB transfer function, so three's KTX2Loader tags it
// SRGBColorSpace and uploads it to an sRGB internal format, and the GPU decodes every
// texel to LINEAR light before the dome shader (or the PMREM generator) reads it. That
// is the same linear radiance space the UASTC HDR skies feed the dome; only the level
// differs (a painted sky tops out at 1.0), and the tunes below are what close it.

import { moonDirection, nightSkyDesat } from './day_night_core';
import { clamp01 } from './num_clamp';

/** The dome's per-sky grade: radiance gain, the bloom-economy clamp, and the
 *  contrast curve about the shader's 0.8 pivot (1 is the identity). */
export interface SkyTune {
  readonly gain: number;
  readonly clamp: number;
  readonly contrast?: number;
}

/**
 * The grade a painted DAY sky takes, calibrated against the retired vale_day HDRI's
 * dome (gain 0.6, contrast 1.25, its blue tint) through the same ACES output: at gain 1
 * the painted blue between the clouds (45 to 75 degrees up) lands at 0.97x the old
 * sky's luminance, and contrast 1.1 deepens it to 0.88x (screen sRGB about 85,143,198
 * against the old 93,144,225), the "same place, slightly deeper" the art brief asked
 * for, while cloud tops near 0.9 barely move. The clamp is a guard only: painted peaks
 * stay under 1.05 after the contrast, so a painted sky never reaches it or the 1.32
 * bloom threshold.
 */
export const PAINTED_DAY_TUNE: SkyTune = { gain: 1, clamp: 1.6, contrast: 1.1 };

/**
 * The grade a painted NIGHT sky takes INSTEAD of the day sky's night grade (the
 * desaturation and the dark uDayNight multiply). It is painted dark already, so the
 * night multiply on top would crush it to black; gain 1.1 is the small moonlit lift,
 * which lands its 45 to 75 degree band at 1.25x the old procedural night's luminance
 * (0.021 against 0.017) and its painted teal horizon glow, mostly under the dome's fog
 * band, about three times brighter.
 */
export const PAINTED_NIGHT_TUNE: SkyTune = { gain: 1.1, clamp: 1.6, contrast: 1 };

/**
 * Where the dusk crossfade starts and completes, on the cycle's own night amount
 * (dnGrade.nightAmt in a neutral realm: 0 at noon, 0.5 with the sun on the horizon, 1
 * at midnight). It opens while the sun is still a few degrees up, so the painted day's
 * golden horizon carries the sunset; on the shipped 45 minute cycle it is 0.14 of the
 * way in as the sun touches the horizon, 0.6 as the first stars appear (phase 0.78,
 * the sun 3 degrees under) and complete by phase 0.85, just before the star field is
 * full: about six real minutes of blue hour. Dawn runs the same curve back.
 */
export const PAINTED_NIGHT_START = 0.4;
export const PAINTED_NIGHT_FULL = 0.9;

/** The night desaturation at deep night: the normalizer that turns the value the
 *  renderer hands SkyView.setCycle back into a 0 to 1 night amount. */
const DESAT_AT_NIGHT = nightSkyDesat(1);

function smoothstep01(t: number): number {
  const c = clamp01(t);
  return c * c * (3 - 2 * c);
}

/**
 * The painted night's share of an arm's dome colour, 0 at full day to 1 at deep night,
 * from the night desaturation the renderer already passes SkyView.setCycle
 * (nightSkyDesat(dnGrade.nightAmt), the same grade that drives uDayNight), so the
 * crossfade can never disagree with how dark the cycle has made the world. The
 * window's ends are taken through nightSkyDesat itself, so a retuned desaturation curve
 * moves them with it: the weight stays monotonic in nightAmt, 0 at or before
 * PAINTED_NIGHT_START and 1 at or after PAINTED_NIGHT_FULL, with zero slope at both
 * ends, so it eases in and out with no visible start or stop.
 */
export function paintedNightWeight(nightDesat: number): number {
  if (!(DESAT_AT_NIGHT > 0) || !Number.isFinite(nightDesat)) return 0;
  const s = clamp01(nightDesat / DESAT_AT_NIGHT);
  const s0 = nightSkyDesat(PAINTED_NIGHT_START) / DESAT_AT_NIGHT;
  const s1 = nightSkyDesat(PAINTED_NIGHT_FULL) / DESAT_AT_NIGHT;
  return smoothstep01((s - s0) / (s1 - s0));
}

/**
 * Seconds a biome's painted night takes to fade in once its texture is uploaded and
 * bound. The night texture can land mid-dusk or at midnight, and binding it straight at
 * its full cycle weight would pop.
 */
export const PAINTED_NIGHT_FADE_SEC = 3;

/**
 * One step of a biome's painted-night residency fade: linear toward 1 while its texture
 * is bound (`available`), and straight to 0 when it is not, because the dome then
 * samples a placeholder in that slot and must not show it. dt of zero or less holds.
 */
export function stepPaintedNightFade(fade: number, available: boolean, dt: number): number {
  if (!available) return 0;
  const current = clamp01(fade);
  if (!(dt > 0)) return current;
  return clamp01(current + dt / PAINTED_NIGHT_FADE_SEC);
}

/** The per-arm painted-night weights the dome binds (uNightW) and their mix. */
export interface PaintedNightArms {
  /** arm A's weight: the cycle weight times its biome's residency fade */
  readonly a: number;
  /** arm B's weight */
  readonly b: number;
  /** the share of the blended dome the painted nights replace: the arms' weights
   *  mixed by the biome blend, exactly the weight the dome shader applies */
  readonly share: number;
}

/**
 * Combine the cycle weight with each bound arm's residency fade (0 for an arm whose
 * biome has no painted night, or whose night is not uploaded yet) across the biome
 * blend `mix` (uMix: 0 shows arm A, 1 arm B).
 */
export function paintedNightArms(
  cycleWeight: number,
  fadeA: number,
  fadeB: number,
  mix: number,
): PaintedNightArms {
  const w = clamp01(cycleWeight);
  const a = w * clamp01(fadeA);
  const b = w * clamp01(fadeB);
  const m = clamp01(mix);
  return { a, b, share: a + (b - a) * m };
}

/**
 * How much of the classic procedural star field (the dome's small white points) survives
 * over a fully shown painted night. None: the painted night's own stars are removed at
 * build time (compress_sky_ldr.mjs, removePointStarsInPlace; a painted star is a few
 * texels the dome magnifies into a soft blob) and the dome draws the PAINTED star layer
 * in their place (sky_painted_stars_glsl.ts, PAINTED_STARS below), so the two fields
 * crossfade with the painted night's share and never double up. Day, and every HDR sky,
 * keep the classic field whole.
 */
export const PAINTED_NIGHT_STAR_KEEP = 0;

/** The classic procedural star strength multiplier for a painted-night share. */
export function paintedNightStarScale(share: number): number {
  return 1 - (1 - PAINTED_NIGHT_STAR_KEEP) * clamp01(share);
}

/** The painted star layer's strength multiplier for a painted-night share: it takes
 *  exactly the share the classic field gives up, so the sky never holds both at once. */
export function paintedStarLayerScale(share: number): number {
  return clamp01(share);
}

/**
 * The painted star layer over a painted night (sky_painted_stars_glsl.ts): stars that
 * look hand painted but are drawn analytically in the dome shader, so they stay crisp at
 * any screen resolution and stable as the camera turns (every shape is a smooth profile
 * held at least about a pixel wide by screen-space derivatives, its energy conserved).
 * Angles are in degrees; cells divide the sky's u (a full turn) and v (pole to pole).
 * The painting's own star density (the night texture's alpha, compress_sky_ldr.mjs
 * starDensityAlpha) decides how many of each layer's cells light up, so the field is
 * thickest along the painted milky band and absent over the painted clouds.
 */
export const PAINTED_STARS = {
  /** Small soft round points: fine cells of 0.6 degrees, at most one point each, kept
   *  off the cell edges (no halo here, so nothing ever crosses a cell edge). */
  pointCells: [600, 300] as const,
  /** Share of fine cells holding a visible point where the painted density is 1. */
  pointFill: 0.1,
  /** Point radius range in degrees; the size is drawn cubed, so most are small, and
   *  the brightness follows the size. */
  pointRadiusDeg: [0.025, 0.075] as const,
  pointGain: 0.9,
  /** Bright stars: coarse cells of 4 degrees, the four nearest searched, so a shape
   *  may reach anywhere inside half a cell. */
  sparkleCells: [90, 45] as const,
  /** Share of coarse cells holding a bright star where the painted density is 1. */
  sparkleFill: 0.2,
  /** Share of the bright stars drawn as four-point twinkles; the rest are round, with
   *  the painted glow halo. */
  crossShare: 0.35,
  /** Twinkle arm half-length range in degrees (held under half a cell). */
  sparkleArmDeg: [0.8, 1.8] as const,
  /** The vertical arm runs this much longer than the horizontal, as painted. */
  sparkleArmAspect: 1.3,
  sparkleArmWidthDeg: 0.04,
  sparkleCoreDeg: 0.09,
  /** Random tilt of each cross, in radians either way, so they do not stand square. */
  sparkleTiltRad: 0.3,
  sparkleGain: 1.5,
  /** Arm brightness relative to the core. */
  armGain: 0.9,
  /** The painted glow halo round the bright stars (held under half a cell). */
  haloDeg: 0.3,
  haloGain: 0.2,
  /** Bright-star brightness lost at the bottom of a slow twinkle. */
  twinkle: 0.25,
  /** The two ends of the per-star tint. */
  warm: [1, 0.9, 0.76] as const,
  cool: [0.78, 0.87, 1] as const,
  /** Density floor high in the sky (from 37 degrees up to 58, above the painted cloud
   *  tops), so the zenith, which the painting leaves nearly starless, still holds a
   *  sparse field. */
  zenithFloor: 0.3,
} as const;

/**
 * The equirect u a painted night's glow is turned to: the moon's azimuth at midnight,
 * where it stands highest, so the painting's moonlit horizon sits under the moon. The
 * day skies turn their painted sun to the shared sun anchor instead (sky.ts sunOffsetU).
 * Same u convention as the dome shader: atan(z, x) / 2pi + 0.5.
 */
export const PAINTED_NIGHT_ANCHOR_U = (() => {
  const [x, , z] = moonDirection(0);
  return Math.atan2(z, x) / (2 * Math.PI) + 0.5;
})();

/** The u offset that moves a painted night's measured glow onto the anchor. */
export function paintedNightOffsetU(glowU: number): number {
  return glowU - PAINTED_NIGHT_ANCHOR_U;
}
