import { PALADIN_BODY_FIT } from './paladin_body_fit';
export const AEGIS_CAPACITY = 16;
export const AEGIS_SEGMENTS = 64;
export const AEGIS_RINGS = 6;
export const AEGIS_FADE = 0.35;
export const AEGIS_CENTER = 0.46;
export const AEGIS_HALF_HEIGHT = 0.39;
export const AEGIS_FRONT = 0.36;
export const AEGIS_BOW = 0.085;
export const AEGIS_VISUAL_SCALE = 1.15;
export const AEGIS_SUN_Y = AEGIS_HALF_HEIGHT * 0.14;
/** Two ribbons of light swirl round a protected wearer. */
export const AEGIS_WISPS = 2;
export const AEGIS_WISP_SEGMENTS = 12;
/** Shield surface vertices per wearer, then the wisps. */
export const AEGIS_SHIELD_VERTICES = AEGIS_SEGMENTS * AEGIS_RINGS * 6;
export const AEGIS_VERTEX_BUDGET = AEGIS_SHIELD_VERTICES + AEGIS_WISPS * AEGIS_WISP_SEGMENTS * 6;

/** A bowed personal ward in front of the body, scaled by displayed height. */
export function aegisPoint(
  angle: number,
  radius: number,
  age: number,
  reduced: boolean,
  out: { x: number; y: number; z: number },
): void {
  const appear = reduced ? 1 : Math.min(1, age / 0.3);
  const scale = 0.8 + 0.2 * (1 - (1 - appear) ** 3);
  const r = radius * scale;
  const c = Math.cos(angle);
  const sn = Math.sin(angle);
  const width =
    c >= 0.5
      ? (PALADIN_BODY_FIT.shieldWidth * (1 - c)) / 0.5
      : PALADIN_BODY_FIT.shieldWidth * ((c + 1) / 1.5) ** 0.7;
  out.x = Math.sign(sn) * width * r;
  out.y = PALADIN_BODY_FIT.shieldCenter + c * PALADIN_BODY_FIT.shieldHalfHeight * r;
  out.z = PALADIN_BODY_FIT.shieldFront + AEGIS_BOW * (1 - radius * radius);
}

export function isGuardianCovenantAura(aura: { id: string; kind?: string }): boolean {
  return aura.id === 'guardian_covenant' && aura.kind === 'buff_dr';
}

/** Point along a swirling wisp (u from tail 0 to head 1), relative to the
 * wearer's feet in body heights. Reduced motion holds the ribbons still. */
export function aegisWispPoint(
  wisp: number,
  u: number,
  age: number,
  reduced: boolean,
  out: { x: number; y: number; z: number },
): void {
  const angle = (reduced ? 0 : age * 1.3) + wisp * Math.PI + u * 2.4;
  const radius = 0.5 + 0.05 * Math.sin(u * 5 + wisp);
  const tilt = wisp ? -0.35 : 0.35;
  out.x = Math.sin(angle) * radius;
  out.y = 0.2 + u * 0.55 + tilt * 0.15 * Math.sin(angle);
  out.z = Math.cos(angle) * radius;
}
