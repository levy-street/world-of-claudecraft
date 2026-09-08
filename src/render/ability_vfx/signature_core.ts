import type { AbilityVfxFullSpec } from '../ability_vfx_core';

export const SIGNATURE_CONTACT_TIME = 0.15;

export type Signature =
  | 'pyre'
  | 'glacier'
  | 'thunder'
  | 'tide'
  | 'wolf'
  | 'judgement'
  | 'execution'
  | 'rift';
export type Substance =
  | 'fire'
  | 'ice'
  | 'water'
  | 'shadow'
  | 'light'
  | 'earth'
  | 'nature'
  | 'arcane';
export const SIGNATURE_ABILITIES: Readonly<Record<string, Signature>> = {
  pyroblast: 'pyre',
  frost_nova: 'glacier',
  chain_lightning: 'thunder',
  chain_heal: 'tide',
  ghost_wolf: 'wolf',
  hammer_of_wrath: 'judgement',
  execute: 'execution',
  abyssal_rift: 'rift',
};

/** Visual time only. Damage, cast bars, area boundaries and replay ticks never change. */
export function chargeEnvelope(progress: number): number {
  const p = Number.isFinite(progress) ? Math.min(1, Math.max(0, progress)) : 0;
  // A slow gather, a held compression, then the quick final intake.
  return p < 0.65 ? 0.7 * (p / 0.65) ** 2 : 0.7 + 0.3 * ((p - 0.65) / 0.35) ** 3;
}

export function substanceOf(spec: AbilityVfxFullSpec): Substance {
  if (spec.healStyle === 'water') return 'water';
  switch (spec.palette) {
    case 'fire':
      return 'fire';
    case 'frost':
      return 'ice';
    case 'shadow':
    case 'blood':
      return 'shadow';
    case 'holy':
    case 'gold':
      return 'light';
    case 'nature':
    case 'poison':
      return 'nature';
    case 'arcane':
    case 'moon':
    case 'storm':
      return 'arcane';
    default:
      return 'earth';
  }
}

export function detailCell(substance: Substance): number {
  return substance === 'water'
    ? 1
    : substance === 'ice'
      ? 3
      : substance === 'shadow' || substance === 'arcane' || substance === 'light'
        ? 2
        : 0;
}

export function signatureStrength(id: string, spec: AbilityVfxFullSpec, tier: number): number {
  if (tier >= 2 || spec.filler) return 0;
  return (SIGNATURE_ABILITIES[id] ? 1 : spec.finisher ? 0.7 : 0.32) * (tier === 1 ? 0.45 : 1);
}

/** The hero's textured body owns the silhouette, with a compact light core instead of white sheets. */
export function refineSignatureSpec(id: string, base: AbilityVfxFullSpec): AbilityVfxFullSpec {
  if (!SIGNATURE_ABILITIES[id]) return base;
  return {
    ...base,
    impact: {
      ...base.impact,
      flipbook: false,
      sparks: base.impact?.sparks ?? 18,
      smoke: false,
      vRing: false,
    },
  };
}
