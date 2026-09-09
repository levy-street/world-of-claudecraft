// The id a helpful effect's aura is applied under, in ONE place.
//
// applyAura dedups by (id, sourceId), so every companion buff one cast leaves
// needs a distinct id or the last would evict the rest. The dispatcher
// (effect_dispatch.ts) used to spell these rules inline at each site, which left
// any reader of the content that has to name a live aura before it exists (the
// HUD's aura-track catalog derives its keys from the ability table) guessing at
// them, and guessing wrong: Raised Guard's mitigation lands as raised_guard_dr,
// Hallowed Wall's shield as holy_shield_absorb, Arcane Power's haste as
// arcane_power_buff_spellhaste, none of which is the ability id. Both sides now
// call these, so an id the catalog computes is an id a live aura can carry.
//
// Pure: no Sim, no Rng, no host. Moved, not rewritten: each body is the
// dispatcher's original expression.

import type { AbilityEffect } from '../types';

/** The slice of an ability the id rules read. */
export interface AuraIdAbility {
  id: string;
  effects: readonly AbilityEffect[];
}

/** The slice of an effect the id rules read. */
export interface AuraIdEffect {
  kind?: string;
  auraId?: string;
}

/**
 * A self-buff. The PRIMARY self-buff (the first selfBuff kind on the DEF) keeps
 * the bare ability id, so its icon and name resolve and a form or aspect
 * toggle-off still finds it by id; every companion is kind-suffixed. An explicit
 * `auraId` wins over both. Compared by KIND, not object identity: applyTalentMods
 * may have replaced the resolved effect objects, so a reference check would
 * misfire.
 */
export function selfBuffAuraId(ability: AuraIdAbility, eff: AuraIdEffect): string {
  if (eff.auraId !== undefined) return eff.auraId;
  const firstSelfBuffKind = ability.effects.find((e) => e.type === 'selfBuff')?.kind;
  return eff.kind === firstSelfBuffKind ? ability.id : `${ability.id}_${eff.kind}`;
}

/**
 * An absorb. Beside a stasis self-buff (the mage's Ice Block) it takes `_absorb`
 * so the two auras of one cast do not collide; alone it keeps the bare id. An
 * explicit `auraId` wins.
 */
export function absorbAuraId(ability: AuraIdAbility, eff: AuraIdEffect): string {
  if (eff.auraId !== undefined) return eff.auraId;
  const hasStasisSelfBuff = ability.effects.some(
    (effect) => effect.type === 'selfBuff' && effect.kind === 'stasis',
  );
  return hasStasisSelfBuff ? `${ability.id}_absorb` : ability.id;
}

/**
 * The nth buffTarget of one cast: the first keeps the bare id, the rest are
 * suffixed by kind and position. No `auraId` arm, because the dispatcher never
 * read one here.
 */
export function buffTargetAuraId(
  ability: Pick<AuraIdAbility, 'id'>,
  eff: Pick<AuraIdEffect, 'kind'>,
  index: number,
): string {
  return index === 0 ? ability.id : `${ability.id}_${eff.kind}_${index}`;
}
