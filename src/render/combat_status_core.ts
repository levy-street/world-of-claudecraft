// The essential status vocabulary shared by combat and the VFX studio.
// One slot per meaning (and per locked school), never a strongest-status pick.
import { isFearAura } from '../sim/combat/cc';
import { VEILBOUND_MARCH_ID } from '../sim/combat/paladin_veilbound_state';
import { ABILITIES } from '../sim/data';

export const CONTROL_TYPES = [
  'stun',
  'fear',
  'root',
  'sleep',
  'silence',
  'incapacitate',
  'polymorph',
  'disarm',
  'slow',
  'stasis',
] as const;
export const LOCKOUT_SCHOOLS = [
  'physical',
  'holy',
  'fire',
  'nature',
  'frost',
  'shadow',
  'arcane',
] as const;
export const CONTROL_SLOT_COUNT = CONTROL_TYPES.length + LOCKOUT_SCHOOLS.length;
export type ControlType = (typeof CONTROL_TYPES)[number] | 'lockout';
export interface ControlAura {
  id: string;
  kind?: string;
  remaining?: number;
  duration?: number;
  school?: string;
}
export interface ControlSubject {
  id: number;
  dead?: boolean;
  hp?: number;
  auras: readonly ControlAura[];
}
export interface ControlState {
  remaining: Float32Array;
  duration: Float32Array;
}
export function createControlState(): ControlState {
  return {
    remaining: new Float32Array(CONTROL_SLOT_COUNT),
    duration: new Float32Array(CONTROL_SLOT_COUNT),
  };
}
const usesFearDr = (id: string): boolean => ABILITIES[id]?.fearDr === true;

export function controlSlot(aura: ControlAura): number {
  if (aura.kind === 'incapacitate') {
    if (isFearAura({ id: aura.id, kind: aura.kind }, usesFearDr)) return 1;
    return aura.id === 'hibernate_incap' ? 3 : 5;
  }
  if (aura.kind === 'lockout') {
    const school = LOCKOUT_SCHOOLS.indexOf(aura.school as (typeof LOCKOUT_SCHOOLS)[number]);
    return school < 0 ? -1 : CONTROL_TYPES.length + school;
  }
  return CONTROL_TYPES.indexOf(aura.kind as (typeof CONTROL_TYPES)[number]);
}

/** Reuses caller storage. A refresh cannot overwrite a longer simultaneous aura. */
export function resolveControlStateInto(out: ControlState, subject: ControlSubject): ControlState {
  out.remaining.fill(0);
  out.duration.fill(0);
  if (subject.dead || (subject.hp ?? 1) <= 0) return out;
  const march = subject.auras.some((a) => a.id === VEILBOUND_MARCH_ID && (a.remaining ?? 1) > 0);
  const slowImmune =
    march || subject.auras.some((a) => a.kind === 'slow_immunity' && (a.remaining ?? 1) > 0);
  for (const aura of subject.auras) {
    const remaining = aura.remaining ?? 1;
    if (!(remaining > 0) || !Number.isFinite(remaining)) continue;
    if ((march && aura.kind === 'root') || (slowImmune && aura.kind === 'slow')) continue;
    const slot = controlSlot(aura);
    if (slot < 0 || out.remaining[slot] >= remaining) continue;
    out.remaining[slot] = remaining;
    out.duration[slot] = Math.max(remaining, aura.duration ?? remaining);
  }
  return out;
}

// Shapes are also distinct in monochrome. Colour is a redundant signal.
export const CONTROL_COLORS = [
  0xffd45a, 0xc28cff, 0x73df92, 0xb7dfff, 0xed98cd, 0xf6c48a, 0xbab0ff, 0xffa27c, 0x79cddd,
  0x99e5f5, 0xcabfaf, 0xffd986, 0xff965b, 0x75df8b, 0x9cdaff, 0xbf97f4, 0xd6a2ff,
] as const;

export function controlKind(slot: number): ControlType {
  return CONTROL_TYPES[slot] ?? 'lockout';
}
