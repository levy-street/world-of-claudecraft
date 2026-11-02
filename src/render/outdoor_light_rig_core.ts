// The outdoor light rig's fill intensities, and the one derived ratio that
// keeps the Lambert terrain lit when it runs under the standard-materials
// rig. Pure: no Three, no DOM, no GFX read (the caller passes the profile).
//
// Two rigs light the overworld:
// - The Lambert (low) rig: hemisphere 1.8, sun 2.25 with readability lighting
//   (legacy 0.9/2.65 otherwise), no image-based fill, and
//   the day/night grade is never applied to its lights (the renderer's outdoor
//   branch returns before grading on the Lambert tier), so its terrain sits at
//   a permanent full-day fill.
// - The standard-materials rig: a deliberately weak hemisphere (shadow
//   darkness reads as shade, not dirt-colour variation) plus the biome IBL
//   environment as the real shadow fill, both scaled by the day/night grade.
//
// MeshLambertMaterial never samples the scene environment, so a Lambert
// terrain built under the standard rig (the Advanced mix's Terrain Detail Low,
// or missing splat assets on any tier above low) only ever receives the weak
// hemisphere: every slope facing away from a low sun rendered solid black, and
// the whole ground went black at dusk. lambertTerrainFillBoost is the ratio
// that restores the Lambert rig's fill on that material alone, riding the
// graded hemisphere so night still darkens it like every other surface.

export interface OutdoorLightRigProfile {
  readonly composer: boolean;
  readonly gradePass: boolean;
  readonly standardMaterials: boolean;
}

/** Hemisphere fill under the standard-materials rig, by post chain. Shadow
 *  DARKNESS is the other half of felt sunlight: a stronger hemisphere plus IBL
 *  fill lifted building and hill shadows until they read as dirt-colour
 *  variation, not shade (BSL-class looks run visibly darker, cooler shadow
 *  regions). Key up / both fills down buys the contrast. */
export const HEMI_INTENSITY_COMPOSER = 0.27;
export const HEMI_INTENSITY_GRADE = 0.32;
export const HEMI_INTENSITY_FLAT = 0.4;

/** Legacy Lambert daylight values, retained for higher-tier terrain compensation. */
export const LAMBERT_RIG_HEMI_INTENSITY = 0.9;
export const LAMBERT_RIG_SUN_INTENSITY = 2.65;

export interface LowNightGrade {
  readonly fog?: string | readonly [number, number, number];
  readonly nightAmt?: number;
}

/** The Low preset's clearer fill uses the same light pair and shader programs.
 * Keep the legacy constants above for higher-tier Lambert terrain compensation.
 * By day (`nightAmt === 0`) the hemisphere and sun sit at 1.2 / 1.85 so peak
 * noon does not wash out unshadowed Lambert surfaces; after dark (`nightAmt > 0`),
 * realms whose night read relies on IBL fill on higher tiers (especially
 * Drakelands' `ember` sky, which receives a 12.38x night IBL lift on Standard)
 * get a compensating hemisphere and key lift on the IBL-free Low rig. */
export function lowHemiIntensity(
  profile: { readonly lowReadabilityLighting: boolean },
  grade?: LowNightGrade,
  biomeOverride?: string,
): number {
  if (!profile.lowReadabilityLighting) return LAMBERT_RIG_HEMI_INTENSITY;
  const n = Math.max(0, Math.min(1, grade?.nightAmt ?? 0));
  const biome = biomeOverride ?? (typeof grade?.fog === 'string' ? grade.fog : undefined);
  const darkRealm =
    biome === 'ember' || biome === 'volcano' || biome === 'hollow' || biome === 'marsh';
  return 1.2 * (1 + n * (darkRealm ? 0.95 : 0.45));
}

export function lowSunIntensity(
  profile: { readonly lowReadabilityLighting: boolean },
  grade?: LowNightGrade,
  biomeOverride?: string,
): number {
  if (!profile.lowReadabilityLighting) return LAMBERT_RIG_SUN_INTENSITY;
  const n = Math.max(0, Math.min(1, grade?.nightAmt ?? 0));
  const biome = biomeOverride ?? (typeof grade?.fog === 'string' ? grade.fog : undefined);
  const darkRealm =
    biome === 'ember' || biome === 'volcano' || biome === 'hollow' || biome === 'marsh';
  return 1.85 * (1 + n * (darkRealm ? 0.65 : 0.25));
}

/** Hemisphere intensity the standard-materials rig runs at for `profile`. */
export function hemiOutdoorIntensity(
  profile: Pick<OutdoorLightRigProfile, 'composer' | 'gradePass'>,
): number {
  return profile.composer
    ? HEMI_INTENSITY_COMPOSER
    : profile.gradePass
      ? HEMI_INTENSITY_GRADE
      : HEMI_INTENSITY_FLAT;
}

/** Multiplier on the Lambert terrain material's hemisphere irradiance: 1 on
 *  the Lambert rig (its hemisphere is already the full fill), else the ratio
 *  that lifts the standard rig's weak hemisphere back to the Lambert rig's
 *  daylight fill in place of the IBL the material cannot sample. */
export function lambertTerrainFillBoost(profile: OutdoorLightRigProfile): number {
  if (!profile.standardMaterials) return 1;
  return LAMBERT_RIG_HEMI_INTENSITY / hemiOutdoorIntensity(profile);
}

/** The per-frame target the renderer eases the shared terrain fill uniform
 *  toward. Only the live outdoor rig (every open-air fog state) needs the
 *  lift: an interior rig writes absolute hemisphere values of its own
 *  (dungeon murk, a castle hall), which the same multiplier would blow past
 *  on any outdoor ground still in frame through a doorway. */
export function terrainFillBoostTarget(
  profile: OutdoorLightRigProfile,
  outdoorRigLive: boolean,
): number {
  return outdoorRigLive ? lambertTerrainFillBoost(profile) : 1;
}
