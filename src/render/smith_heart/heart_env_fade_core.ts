// PURE (RENDER_PURE_CORES): the Smith's Heart's environment cross-fade (the
// team's doc of 2026-11-17: "add cross fade to environment lighting when going
// between areas"). Each of the raid's areas settles its own fog and light rig
// (smith_heart/heart_environment.ts, fog_scene_state.ts, interior_light_rig.ts)
// and the renderer used to snap from one to the next the frame the camera
// crossed; the sky and the rock already ease (heart_interior.ts
// heartAreaBlend). This core says WHEN a settle between two of the raid's
// states fades instead (`heartEnvFades`), how far along a fade is
// (`heartEnvFadeT`), and the mix of one number or one channel
// (`heartEnvMix`); heart_env_fade.ts paints it on the live fog and lights.
//
// Three-free, DOM-free, deterministic.

/** The raid's own fog states, plus the storm dusk it keeps where no vein's
 *  light holds (fog_scene_state.ts: the Sunken Bastion's, inside the raid). */
const HEART_ENV_STATES: ReadonlySet<string> = new Set([
  'smithHeartCore',
  'smithHeartHammer',
  'smithHeartRing',
  'smithHeartBreath',
  'smithHeartQuench',
  'smithHeartHeat',
  'sunkenBastion',
]);

/** Seconds a fade takes (the sky's own blend crosses in about 1.1 s at
 *  heart_portal_core.ts HEART_AREA_BLEND_RATE; the light a breath longer, so
 *  the sky leads and the light follows it). */
export const HEART_ENV_FADE_SECONDS = 1.6;

/** Does a settle from `from` to `to` cross-fade? Only between two of the
 *  raid's areas (at least one of them the raid's own: the storm dusk alone is
 *  the Sunken Bastion's, which never fades). */
export function heartEnvFades(from: string, to: string): boolean {
  if (from === to) return false;
  if (!HEART_ENV_STATES.has(from) || !HEART_ENV_STATES.has(to)) return false;
  return from !== 'sunkenBastion' || to !== 'sunkenBastion';
}

/** How far a fade stands `age` seconds in (0 to 1, eased in and out). */
export function heartEnvFadeT(age: number): number {
  const u = Math.max(0, Math.min(1, age / HEART_ENV_FADE_SECONDS));
  return u * u * (3 - 2 * u);
}

/** One number (or one colour channel) a share `t` of the way from `a` to `b`. */
export function heartEnvMix(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
