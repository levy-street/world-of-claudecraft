import type { Entity } from '../sim/types';

const MAX_ICICLES = 5;
const MAX_THUNDER_WARD_CHARGES = 9;

function clampedWhole(value: number | undefined, max: number, missing = 0): number {
  const resolved = value ?? missing;
  if (!Number.isFinite(resolved)) return 0;
  return Math.min(max, Math.max(0, Math.trunc(resolved)));
}

export function characterIciclesCount(e: Entity): number {
  const aura = e.auras.find((candidate) => candidate.id === 'mag_icicles');
  // AuraWire omits `stacks` at exactly one, so presence reconstructs that count.
  return aura ? clampedWhole(aura.stacks, MAX_ICICLES, 1) : 0;
}

export function characterFrostbiteArmed(e: Entity): boolean {
  return e.auras.some((a) => a.id === 'mag_frostbite');
}

export function characterThunderWardCharges(e: Entity): number {
  const aura = e.auras.find((candidate) => candidate.id === 'lightning_shield');
  return clampedWhole(aura?.charges, MAX_THUNDER_WARD_CHARGES);
}

export function characterSoulRendActive(e: Entity): boolean {
  return e.auras.some((a) => a.id === 'nythraxis_soul_rend');
}

export function characterSanguineAuraActive(e: Entity): boolean {
  return e.auras.some((a) => a.id === 'sanguine_aura');
}

export function characterRecklessnessActive(e: Entity): boolean {
  return e.auras.some((a) => a.kind === 'buff_reckless');
}
