// The fog scene's crossfade. A settle into a new fog scene state
// (fog_scene_state.ts resolves the state, interior_light_rig.ts owns its light)
// lands at once everywhere except between the Smith's Heart's rooms, where the
// look the scene showed fades into the new room's over a second: the fog's
// colour and reach, the key and fill lights' colours and strengths, the sky's
// reflection, the rim, and the key light's direction should two rooms ever
// differ (every room shares one sun, smith_heart/heart_environment.ts
// `SMITH_HEART_KEY_DIRECTION`, so inside the raid no shadow moves). The owner's
// ask of 2026-11-19: walking from a vein into the Ring snapped the whole room's
// light in one frame while its sky blended.
//
// This module owns which settles fade, how long they take, and the blend; the
// painter (fog_scene_fade.ts) reads and writes the scene.
//
// RENDER_PURE_CORES module: no three.js, no DOM, no clock; allocation-free per
// frame (every blend writes into a caller-owned record).

/** Seconds a settle between two of the Smith's Heart's rooms takes, walked (a
 *  vein's mouth, the Ring's rim) or hopped (the portal to the Heart, under its
 *  wash). About the time the raid's sky takes to blend between the same areas
 *  (smith_heart/heart_portal_core.ts `HEART_AREA_BLEND_RATE`), so the two move
 *  together. */
export const SMITH_HEART_ROOM_FADE_SECONDS = 1;

/**
 * How many seconds the settle from a state resolved in `fromInterior` to one
 * resolved in `toInterior` crossfades (the interiors `resolveFogScene` answers).
 * 0 means it lands at once, as every settle did before the fade: only a move
 * from one Smith's Heart room to another fades, never a way into or out of the
 * raid (a teleport, which cuts).
 */
export function fogSceneFadeSeconds(
  fromInterior: string | null | undefined,
  toInterior: string | null | undefined,
): number {
  return fromInterior === 'smith_heart' && toInterior === 'smith_heart'
    ? SMITH_HEART_ROOM_FADE_SECONDS
    : 0;
}

/** A colour in three's linear working space (a THREE.Color fits it). */
export interface FadeRgb {
  r: number;
  g: number;
  b: number;
}

/** A direction: the key light's, from the ground toward it. */
export interface FadeVec3 {
  x: number;
  y: number;
  z: number;
}

/** Everything a fog scene state's settle writes into the scene: the look a
 *  fade blends. */
export interface SceneLook {
  readonly fog: FadeRgb;
  fogNear: number;
  fogFar: number;
  readonly sun: FadeRgb;
  sunIntensity: number;
  readonly hemiSky: FadeRgb;
  readonly hemiGround: FadeRgb;
  hemiIntensity: number;
  /** The scene's environment intensity: the sky's reflection. */
  envIntensity: number;
  /** The shared rim boost. */
  rim: number;
  /** The shared rim tint. */
  readonly rimColor: FadeRgb;
}

function rgb(): FadeRgb {
  return { r: 0, g: 0, b: 0 };
}

export function newSceneLook(): SceneLook {
  return {
    fog: rgb(),
    fogNear: 0,
    fogFar: 0,
    sun: rgb(),
    sunIntensity: 0,
    hemiSky: rgb(),
    hemiGround: rgb(),
    hemiIntensity: 0,
    envIntensity: 0,
    rim: 0,
    rimColor: rgb(),
  };
}

function lerp(a: number, b: number, k: number): number {
  return a + (b - a) * k;
}

function lerpRgbInto(out: FadeRgb, a: FadeRgb, b: FadeRgb, k: number): void {
  out.r = lerp(a.r, b.r, k);
  out.g = lerp(a.g, b.g, k);
  out.b = lerp(a.b, b.b, k);
}

function copyRgbInto(out: FadeRgb, from: FadeRgb): void {
  out.r = from.r;
  out.g = from.g;
  out.b = from.b;
}

/** Copy look `from` into `out`. */
export function copySceneLookInto(out: SceneLook, from: SceneLook): SceneLook {
  copyRgbInto(out.fog, from.fog);
  out.fogNear = from.fogNear;
  out.fogFar = from.fogFar;
  copyRgbInto(out.sun, from.sun);
  out.sunIntensity = from.sunIntensity;
  copyRgbInto(out.hemiSky, from.hemiSky);
  copyRgbInto(out.hemiGround, from.hemiGround);
  out.hemiIntensity = from.hemiIntensity;
  out.envIntensity = from.envIntensity;
  out.rim = from.rim;
  copyRgbInto(out.rimColor, from.rimColor);
  return out;
}

/**
 * Blend look `a` toward look `b` by `k` (0 is `a`, 1 is `b`) into `out`, which
 * may be either of them. Colours blend in the linear working space, so halfway
 * between two lights is the light of both at half strength each. The ends are
 * exact copies: a finished fade leaves the settled state's own numbers.
 */
export function blendSceneLookInto(
  out: SceneLook,
  a: SceneLook,
  b: SceneLook,
  k: number,
): SceneLook {
  if (k >= 1) return copySceneLookInto(out, b);
  if (k <= 0) return copySceneLookInto(out, a);
  lerpRgbInto(out.fog, a.fog, b.fog, k);
  out.fogNear = lerp(a.fogNear, b.fogNear, k);
  out.fogFar = lerp(a.fogFar, b.fogFar, k);
  lerpRgbInto(out.sun, a.sun, b.sun, k);
  out.sunIntensity = lerp(a.sunIntensity, b.sunIntensity, k);
  lerpRgbInto(out.hemiSky, a.hemiSky, b.hemiSky, k);
  lerpRgbInto(out.hemiGround, a.hemiGround, b.hemiGround, k);
  out.hemiIntensity = lerp(a.hemiIntensity, b.hemiIntensity, k);
  out.envIntensity = lerp(a.envIntensity, b.envIntensity, k);
  out.rim = lerp(a.rim, b.rim, k);
  lerpRgbInto(out.rimColor, a.rimColor, b.rimColor, k);
  return out;
}

/**
 * Turn the key light's direction from `from` toward `to` by `k` into `out`,
 * which may be `to`: the normalized blend, so the shadows swing round with the
 * light instead of jumping. Ends exactly on `to`; two opposite directions (no
 * way round between them) take `to` at once.
 */
export function blendKeyDirectionInto(
  out: FadeVec3,
  from: FadeVec3,
  to: FadeVec3,
  k: number,
): FadeVec3 {
  if (k >= 1) {
    out.x = to.x;
    out.y = to.y;
    out.z = to.z;
    return out;
  }
  const x = lerp(from.x, to.x, k);
  const y = lerp(from.y, to.y, k);
  const z = lerp(from.z, to.z, k);
  const len = Math.hypot(x, y, z);
  if (len < 1e-6) {
    out.x = to.x;
    out.y = to.y;
    out.z = to.z;
    return out;
  }
  out.x = x / len;
  out.y = y / len;
  out.z = z / len;
  return out;
}

/** Smoothstep: the light leaves the old room and settles into the new one
 *  gently, never at a constant rate that starts and stops with a jolt. */
export function sceneFadeEase(t: number): number {
  const c = t <= 0 ? 0 : t >= 1 ? 1 : t;
  return c * c * (3 - 2 * c);
}

/** One renderer's crossfade: what it fades from and to, and how far it is. */
export interface SceneFade {
  /** The look the scene showed when the settle came. */
  readonly from: SceneLook;
  /** The settled state's look. */
  readonly to: SceneLook;
  /** The key light's direction as last drawn when the settle came. */
  readonly fromKey: FadeVec3;
  /** Seconds since the settle. */
  elapsed: number;
  /** The fade's length; 0 while none runs. */
  seconds: number;
  /** The interior the last settle was resolved in. */
  interior: string | null;
}

export function newSceneFade(): SceneFade {
  return {
    from: newSceneLook(),
    to: newSceneLook(),
    fromKey: { x: 0, y: 1, z: 0 },
    elapsed: 0,
    seconds: 0,
    interior: null,
  };
}

/**
 * A settle into a state resolved in `interior`: answers how long it fades (0:
 * it lands at once, and any fade still running stops) and remembers the
 * interior for the next settle. On a positive answer the caller captures
 * `from` and `fromKey` before writing the new state and `to` after.
 */
export function beginSceneFade(fade: SceneFade, interior: string | null | undefined): number {
  const seconds = fogSceneFadeSeconds(fade.interior, interior);
  fade.interior = interior ?? null;
  fade.elapsed = 0;
  fade.seconds = seconds;
  return seconds;
}

/** The running fade's eased progress, 0 to 1 (1 while none runs). */
export function sceneFadeProgress(fade: SceneFade): number {
  return fade.seconds > 0 ? sceneFadeEase(fade.elapsed / fade.seconds) : 1;
}

/**
 * Advance the running fade by `dt` seconds and answer its eased progress. At 1
 * the fade has arrived and stops (the caller writes `to` one last time); with
 * no fade running it answers 1 and changes nothing.
 */
export function stepSceneFade(fade: SceneFade, dt: number): number {
  if (fade.seconds <= 0) return 1;
  fade.elapsed += dt > 0 ? dt : 0;
  const k = sceneFadeProgress(fade);
  if (k >= 1) fade.seconds = 0;
  return k;
}

/** A settle the fade never sees (the rift's rig, written every frame): no fade
 *  runs, and the next settle starts from no interior, so it lands at once. */
export function cancelSceneFade(fade: SceneFade): void {
  fade.elapsed = 0;
  fade.seconds = 0;
  fade.interior = null;
}
