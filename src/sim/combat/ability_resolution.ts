// The presentation resolution chain shared by Sim.resolvedAbility and every
// display caller (docs/design/class-balance-v042.md): action-slot
// replacement, the spec-gated resolvers, one post-transform talent-mod bake
// keyed by the final id, then the Ascension/Radiant Resonance presentation
// transforms (effect magnitudes and cast time). `mods` is the caller's own
// precomputed TalentModifiers, never recomputed here.
//
// applyAbilityCostTail below is the resource-cost tail (draining curse
// cost_tax, the Measured Fury arms discount, Aether Surge's per-charge ramp):
// also shared, so every display caller shows the same cost. The SERVER stays
// the sole spend authority regardless of who displays it.

import type { KnownAbility } from '../content/classes';
import { applyTalentMods } from '../content/classes';
import type { TalentAllocation, TalentModifiers } from '../content/talents';
import { resolveAscensionAbility } from '../paladin_devotion';
import type { ResolvedAbility } from '../sim';
import type { Entity, PlayerClass } from '../types';
import { resolveActionReplacement } from './action_replacement';
import { aetherSurgeCostMult } from './chronomancy';
import { resolveColdsightAbilityForSpec } from './hunter_coldsight';
import { resolveHunterSharedAbilityForTalents } from './hunter_shared';
import { radiantResonanceCastTime } from './paladin_radiant_resonance';
import { resolveVespersAbility } from './priest/vespers';

/** The narrow slice of PlayerMeta this chain needs, so a caller with only a
 *  class + talent allocation never fakes a full PlayerMeta. */
export interface AbilityResolutionActor {
  cls: PlayerClass;
  talents: TalentAllocation;
}

export function resolveAbilityChain(
  known: KnownAbility,
  actor: Entity,
  meta: AbilityResolutionActor,
  mods: TalentModifiers,
): ResolvedAbility {
  let found: ResolvedAbility = resolveActionReplacement(known, actor);
  if (meta.cls === 'hunter') {
    found = resolveColdsightAbilityForSpec(found, actor, meta.talents.spec, mods.selected);
    found = resolveHunterSharedAbilityForTalents(found, actor, meta.talents);
  }
  found = resolveVespersAbility(found, meta);
  // known already carries its own talent mods, baked in once at abilitiesKnownAt
  // time. A wholesale def swap above never went through that bake, so give it
  // its own pass here, exactly once, keyed by the FINAL id: comparing ids
  // rather than object identity, since a resolver above returns a `{...}`
  // spread copy even when it leaves the def untouched.
  if (found.def.id !== known.def.id) applyTalentMods(found, mods);
  const ascensionResolved = resolveAscensionAbility(actor, mods.spec, found);
  // mods carries the worn-set flags (Dawnforged 4pc: instant empowered Dawn's
  // Embrace). known.def.id, not the transformed found.def.id, is the ability
  // actually requested: the same identity radiantResonanceCastTime checks.
  const castTime = radiantResonanceCastTime(actor, known.def.id, ascensionResolved.castTime, mods);
  return castTime === ascensionResolved.castTime
    ? ascensionResolved
    : { ...ascensionResolved, castTime };
}

// Highest active cost_tax aura, expressed as a cost multiplier (1 = no tax).
function costTaxMult(e: Entity): number {
  let pct = 0;
  for (const a of e.auras) if (a.kind === 'cost_tax' && a.value > pct) pct = a.value;
  return 1 + pct;
}

/** The resource-cost tail every resolvedAbility caller applies on top of
 *  resolveAbilityChain's output, in order: the Measured Fury (arms) discount,
 *  the highest active draining-curse cost_tax aura, then Aether Surge's
 *  per-charge ramp (arcane_surge only). Returns `found` unchanged (same
 *  reference) when the cost does not change. */
export function applyAbilityCostTail(
  found: ResolvedAbility,
  abilityId: string,
  actor: Entity,
  known: readonly KnownAbility[],
  mods: TalentModifiers,
): ResolvedAbility {
  let cost = found.cost;
  if (
    cost > 0 &&
    mods.spec === 'arms' &&
    known.some((k) => k.def.id === 'measured_fury' && k.def.passive)
  ) {
    cost = Math.max(0, Math.round(cost * 0.9));
  }
  const tax = costTaxMult(actor);
  if (tax > 1 && cost > 0) cost = Math.ceil(cost * tax);
  if (abilityId === 'arcane_surge' && cost > 0) {
    cost = Math.round(cost * aetherSurgeCostMult(actor));
  }
  return cost === found.cost ? found : { ...found, cost };
}
