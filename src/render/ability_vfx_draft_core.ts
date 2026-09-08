import type { AbilityVfxFullSpec, AbilityVfxSpec } from './ability_vfx_core';

export interface AbilityVfxDraft {
  tint: string;
  accent: string;
  power: number;
  sparks: number;
}
export interface AbilityVfxDraftPack {
  format: 'woc-vfx-draft';
  version: 1;
  abilities: Record<string, AbilityVfxDraft>;
}
export function validAbilityVfxDraft(value: unknown): value is AbilityVfxDraft {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  return (
    Object.keys(v).every((k) => ['tint', 'accent', 'power', 'sparks'].includes(k)) &&
    typeof v.tint === 'string' &&
    /^#[a-fA-F0-9]{6}$/.test(v.tint) &&
    typeof v.accent === 'string' &&
    /^#[a-fA-F0-9]{6}$/.test(v.accent) &&
    typeof v.power === 'number' &&
    Number.isFinite(v.power) &&
    v.power >= 0.25 &&
    v.power <= 2 &&
    typeof v.sparks === 'number' &&
    Number.isInteger(v.sparks) &&
    v.sparks >= 0 &&
    v.sparks <= 60
  );
}
export function parseAbilityVfxDraftPack(text: string): AbilityVfxDraftPack | null {
  if (text.length > 256_000) return null;
  try {
    const value = JSON.parse(text);
    if (
      value?.format !== 'woc-vfx-draft' ||
      value.version !== 1 ||
      !value.abilities ||
      typeof value.abilities !== 'object' ||
      Array.isArray(value.abilities)
    )
      return null;
    const entries = Object.entries(value.abilities);
    if (
      entries.length > 512 ||
      !entries.every(([id, v]) => /^[a-z][a-z0-9_]{0,95}$/.test(id) && validAbilityVfxDraft(v))
    )
      return null;
    return value;
  } catch {
    return null;
  }
}
export function draftAbilityVfx(
  compact: AbilityVfxSpec,
  full: AbilityVfxFullSpec,
  draft: AbilityVfxDraft,
): { compact: AbilityVfxSpec; full: AbilityVfxFullSpec } {
  return {
    compact: { ...compact, c: draft.tint, pw: draft.power, sp: draft.sparks },
    full: {
      ...full,
      tint: draft.tint,
      accent: draft.accent,
      power: draft.power,
      ritual: full.ritual
        ? {
            ...full.ritual,
            radius: full.ritual.radius * (draft.power / (full.power ?? 1)) ** 0.25,
            width: full.ritual.width * Math.sqrt(draft.power / (full.power ?? 1)),
          }
        : undefined,
      physical: full.physical
        ? {
            ...full.physical,
            weight: Math.min(2, (full.physical.weight * draft.power) / (full.power ?? 1)),
            width: full.physical.width * Math.sqrt(draft.power / (full.power ?? 1)),
            reach: full.physical.reach * (draft.power / (full.power ?? 1)) ** 0.25,
            particles: draft.sparks,
          }
        : undefined,
      impact: { ...full.impact, sparks: draft.sparks },
    },
  };
}
