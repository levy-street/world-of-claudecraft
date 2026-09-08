import { ITEMS } from '../sim/data';
import { isShieldItem } from '../sim/equipment_rules';
import { weaponAttackStyle } from './characters/weapon_attack_style_core';

export type WarriorPowerKind = 0 | 1;
export type WarriorPowerIntent = 0 | 1 | 2;
export interface WarriorPowerAura {
  id: string;
  kind?: string;
  remaining?: number;
}
export function warriorPowerKind(aura: WarriorPowerAura): WarriorPowerKind | null {
  if (!(Number.isFinite(aura.remaining) && (aura.remaining ?? 0) > 0)) return null;
  if (aura.id === 'avatar' && aura.kind === 'buff_avatar') return 0;
  if (aura.id === 'recklessness' && aura.kind === 'buff_reckless') return 1;
  return null;
}

/** Local specialization is authoritative. A remote player whose specialization
 * is unavailable uses actual equipped weapon intent, never a guessed spec ID. */
export function warriorPowerIntent(
  spec: string | null | undefined,
  mainhand?: string | null,
  offhand?: string | null,
): WarriorPowerIntent {
  if (spec === 'arms') return 0;
  if (spec === 'fury') return 1;
  if (spec === 'prot') return 2;
  if (offhand && isShieldItem(ITEMS[offhand])) return 2;
  return weaponAttackStyle(mainhand ?? null, offhand ?? null) === 'dualwield' ? 1 : 0;
}

export interface WarriorPowerPiece {
  x: number;
  y: number;
  z: number;
  yaw: number;
  roll: number;
  sx: number;
  sy: number;
  sz: number;
  color: number;
}
export const WARRIOR_POWER_COUNTS = [5, 6] as const;
const STONE_TINT = [0xe1d2b8, 0xe2b5ac, 0xbad3e3];
const BLOOD_TINT = [0xff9a81, 0xff6471, 0xe78995];

/** Sparse rooted monoliths versus a torn six-hook crown. No body scaling.
 * The passed scratch is reused for every instance and every frame. */
export function warriorPowerPiece(
  out: WarriorPowerPiece,
  kind: WarriorPowerKind,
  intent: WarriorPowerIntent,
  piece: number,
  age: number,
  reduced: boolean,
  nativeBone = false,
): WarriorPowerPiece {
  out.x = out.y = out.z = out.yaw = out.roll = 0;
  out.sx = out.sy = out.sz = 1;
  const side = piece % 2 ? -1 : 1;
  if (kind === 0) {
    out.color = STONE_TINT[intent];
    if (piece === 0) {
      // Broad breastplate, leaving the head and real weapon exposed.
      out.y = -0.5;
      out.z = 0.2;
      out.sy = 0.7;
      out.sx = 1.5;
      out.sz = 0.6;
      out.yaw = 0.25;
    } else {
      const upper = piece < 3,
        sign = piece % 2 ? -1 : 1;
      out.x = sign * (upper ? 1.3 : 0.5);
      out.y = upper ? -0.15 : -1.02;
      out.z = upper ? -0.05 : 0.12;
      out.roll = -sign * (upper ? 0.45 : 0.12);
      out.sy = 0.6;
      out.sx = upper ? 2.6 : 1.3;
      out.sz = upper ? 1.2 : 1;
      out.yaw = sign * 0.65;
    }
  } else {
    out.color = BLOOD_TINT[intent];
    const band = Math.floor(piece / 2);
    out.x = side * (band === 0 ? 0.72 : band === 1 ? 1.15 : 0.95);
    out.y = band === 0 ? 0.15 : band === 1 ? -0.2 : 0.35;
    out.z = band === 0 ? 0.18 : band === 1 ? -0.25 : -0.7;
    out.yaw = (side < 0 ? Math.PI : 0) + side * (band === 0 ? 0.7 : band === 1 ? 1 : 0.2);
    out.roll = -side * (0.24 + band * 0.22);
    out.sy = 0.95 - band * 0.14;
    out.sx = 1.3;
    out.sz = 1.7;
    if (intent === 0 && piece === 0) {
      out.x = 0.12;
      out.y = 0.1;
      out.z = -0.62;
      out.roll = -0.12;
      out.sy = 1.25;
      out.sx = 1.05;
    }
    if (intent === 2) {
      out.x -= 0.28;
      out.z += piece < 2 ? 0.25 : 0;
      out.sy *= piece < 2 ? 1.08 : 0.9;
    }
    if (!reduced) out.roll += Math.sin(age * 4.2 + piece * 1.7) * 0.018;
  }
  const assembly = reduced ? 1 : 1 - (1 - Math.min(1, age / 0.32)) ** 3;
  if (kind === 0 && nativeBone) {
    // Native left is +X. Arms and shins grow along their joint's +Y,
    // with shin fronts facing local -Z; no inferred model scale here.
    out.x = out.y = out.z = out.yaw = out.roll = 0;
    if (piece === 0) {
      out.y = -0.23;
      out.z = 0.12;
      out.sx = 1.2;
      out.sy = 0.23;
      out.sz = 0.55;
    } else if (piece < 3) {
      out.y = -0.14;
      out.z = 0.085;
      out.sx = 2;
      out.sy = 0.18;
      out.sz = 1.1;
      out.roll = piece === 1 ? 0.14 : -0.14;
    } else {
      out.y = -0.15;
      out.z = -0.085;
      out.yaw = Math.PI;
      out.sx = 0.9;
      out.sy = 0.14;
      out.sz = 0.65;
    }
  }
  out.y -= (1 - assembly) * (nativeBone ? 0.3 : kind === 0 ? 1.15 : 0.5);
  out.x *= 1 + (1 - assembly) * 0.35;
  out.sy *= Math.max(0.02, assembly);
  return out;
}
