import { isPartyFrameRelevantAura } from './aura_classify';
import { partyAuraPriority } from './combat/chronomancy';
import type { Role } from './content/talents';
import type { AbilityEffect, Aura, Entity } from './types';
import { PARTY_MEMBER_AURA_CAP } from './types';

export interface PartyFrameAuraSummary {
  id: string;
  kind: Aura['kind'];
  neg?: 1;
  remaining: number;
}

export interface PartyFrameResolvedAbility {
  effects: readonly AbilityEffect[];
}

/** Compact actionable auras for a party row. Filtering before the cap prevents
 * long-lived maintenance buffs from hiding a later debuff, HoT, or shield, and
 * the priority sort guarantees harmful effects and the viewer's own Temporal
 * Echo mark a strip slot under aura pressure (stable sort, so within a tier the
 * natural aura order is preserved). */
export function partyFrameAuras(
  auras: readonly Aura[],
  cap = PARTY_MEMBER_AURA_CAP,
): PartyFrameAuraSummary[] {
  const relevant = auras.filter((aura) => isPartyFrameRelevantAura(aura));
  relevant.sort((a, b) => partyAuraPriority(a) - partyAuraPriority(b));
  return relevant.slice(0, cap).map((aura) => ({
    id: aura.id,
    kind: aura.kind,
    ...(aura.value < 0 ? { neg: 1 as const } : {}),
    remaining: Math.max(0, Math.ceil(aura.remaining)),
  }));
}

/** Remaining damage absorption, matching the player and target frame total. */
export function partyFrameAbsorb(auras: readonly Aura[]): number {
  let total = 0;
  for (const aura of auras) {
    if (aura.kind === 'absorb') total += Math.max(0, aura.value);
  }
  return total;
}

/** Entity ids currently tanking at least one living hostile mob. */
export function partyFrameAggroTargets(entities: Iterable<Entity>): Set<number> {
  const targets = new Set<number>();
  for (const entity of entities) {
    if (
      entity.kind === 'mob' &&
      !entity.dead &&
      entity.aiState !== 'dead' &&
      entity.aggroTargetId !== null
    ) {
      targets.add(entity.aggroTargetId);
    }
  }
  return targets;
}

/** Expected base healing from active targeted casts, keyed by their locked target.
 * The midpoint is deterministic and avoids claiming the eventual random roll. */
export function partyFrameIncomingHeals(
  entities: Iterable<Entity>,
  resolve: (abilityId: string, casterId: number) => PartyFrameResolvedAbility | null,
): Map<number, number> {
  const incoming = new Map<number, number>();
  for (const caster of entities) {
    if (
      caster.kind !== 'player' ||
      caster.dead ||
      !caster.castingAbility ||
      caster.castTargetId === null
    ) {
      continue;
    }
    const ability = resolve(caster.castingAbility, caster.id);
    if (!ability) continue;
    let amount = 0;
    for (const effect of ability.effects) {
      if (effect.type === 'heal' || effect.type === 'chainHeal') {
        amount += (effect.min + effect.max) / 2;
      }
    }
    if (amount <= 0) continue;
    incoming.set(caster.castTargetId, (incoming.get(caster.castTargetId) ?? 0) + amount);
  }
  return incoming;
}

export function partyFrameRole(role: Role | null): Role {
  return role ?? 'dps';
}
