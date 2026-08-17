import type { PlayerMeta } from '../../sim';
import type { SimContext } from '../../sim_context';
import type { Entity } from '../../types';
import { DOCTRINE_AURA_ID } from './presentation';
import { hasPriestTalent, PRIEST_TALENT_IDS } from './talents';

export { DOCTRINE_AURA_ID } from './presentation';
export const DOCTRINE_DURATION = 30;
export const DOCTRINE_CONVERSION = 0.3;
export const DOCTRINE_FALLBACK_CONVERSION = 0.15;

const DOCTRINE_DAMAGE_ABILITIES = new Set(['smite', 'scouring_mercy']);

/** Remove only Doctrine links owned by this priest. */
export function stripDoctrineLinks(ctx: SimContext, priestId: number): void {
  for (const entity of ctx.entities.values()) {
    for (let index = entity.auras.length - 1; index >= 0; index--) {
      const aura = entity.auras[index];
      if (aura.id !== DOCTRINE_AURA_ID || aura.sourceId !== priestId) continue;
      entity.auras.splice(index, 1);
      ctx.emit({ type: 'aura', targetId: entity.id, name: aura.name, gained: false });
    }
  }
}

/** Psalm of Warding moves the priest's single source-owned Doctrine link. */
export function placeDoctrineLink(ctx: SimContext, priest: Entity, ally: Entity): void {
  const twin = hasPriestTalent(ctx, priest, PRIEST_TALENT_IDS.twinCovenant);
  if (!twin) {
    stripDoctrineLinks(ctx, priest.id);
  } else {
    const links = [...ctx.entities.values()].filter((entity) =>
      entity.auras.some((aura) => aura.id === DOCTRINE_AURA_ID && aura.sourceId === priest.id),
    );
    if (!links.some((entity) => entity.id === ally.id) && links.length >= 2) {
      const remove = links[0];
      const index = remove.auras.findIndex(
        (aura) => aura.id === DOCTRINE_AURA_ID && aura.sourceId === priest.id,
      );
      if (index >= 0) {
        const aura = remove.auras[index];
        remove.auras.splice(index, 1);
        ctx.emit({ type: 'aura', targetId: remove.id, name: aura.name, gained: false });
      }
    }
  }
  const conversion = twin ? 0.7 : DOCTRINE_CONVERSION;
  ctx.applyAura(ally, {
    id: DOCTRINE_AURA_ID,
    name: 'Doctrine',
    kind: 'doctrine',
    remaining: DOCTRINE_DURATION,
    duration: DOCTRINE_DURATION,
    value: conversion,
    sourceId: priest.id,
    school: 'holy',
  });
}

/** Class-scoped post-cast hook. It is inert outside committed Doctrine. */
export function doctrineAfterAbility(
  ctx: SimContext,
  priest: Entity,
  meta: PlayerMeta,
  target: Entity | null,
  abilityId: string,
): void {
  if (meta.cls !== 'priest' || meta.talents.spec !== 'discipline') return;
  if (abilityId === 'power_word_shield' && target && !target.dead) {
    const shield = target.auras.find(
      (aura) => aura.id === 'power_word_shield' && aura.sourceId === priest.id,
    );
    if (shield && shield.value2 === undefined) shield.value2 = shield.value;
    placeDoctrineLink(ctx, priest, target);
  }
}

function lowestHealthGroupAlly(ctx: SimContext, priest: Entity): Entity | null {
  const party = ctx.partyOf(priest.id);
  const ids = party?.members ?? [priest.id];
  let best: Entity | null = null;
  let bestFraction = Infinity;
  for (const id of ids) {
    const ally = ctx.entities.get(id);
    if (!ally || ally.dead || !ctx.players.has(id) || !ctx.isFriendlyTo(priest, ally)) continue;
    if (ally.hp >= ally.maxHp) continue;
    const fraction = ally.maxHp > 0 ? ally.hp / ally.maxHp : 1;
    if (
      best === null ||
      fraction < bestFraction ||
      (fraction === bestFraction && ally.id < best.id)
    ) {
      best = ally;
      bestFraction = fraction;
    }
  }
  return best;
}

/** Convert landed Holy damage from the two Doctrine attacks into non-crit healing. */
export function doctrineConvertDamage(
  ctx: SimContext,
  source: Entity | null,
  dealt: number,
  school: string,
  abilityId: string | null,
): void {
  if (
    source?.kind !== 'player' ||
    dealt <= 0 ||
    school !== 'holy' ||
    !abilityId ||
    !DOCTRINE_DAMAGE_ABILITIES.has(abilityId)
  )
    return;
  const meta = ctx.players.get(source.id);
  if (meta?.cls !== 'priest' || meta.talents.spec !== 'discipline') return;

  const linked: Entity[] = [];
  for (const entity of ctx.entities.values()) {
    if (
      !entity.dead &&
      entity.auras.some((aura) => aura.id === DOCTRINE_AURA_ID && aura.sourceId === source.id)
    )
      linked.push(entity);
  }

  if (linked.length > 0) {
    for (const ally of linked) {
      const link = ally.auras.find(
        (aura) => aura.id === DOCTRINE_AURA_ID && aura.sourceId === source.id,
      );
      const rate = link?.value ?? DOCTRINE_CONVERSION;
      const healed = ctx.applyHeal(
        source,
        ally,
        Math.round(dealt * rate),
        'Doctrine',
        abilityId,
        false,
        false,
      );
      if (hasPriestTalent(ctx, source, PRIEST_TALENT_IDS.livingCovenant) && healed > 0) {
        const shield = ally.auras.find(
          (aura) => aura.id === 'power_word_shield' && aura.sourceId === source.id,
        );
        if (shield && shield.value2 !== undefined) {
          shield.value = Math.min(shield.value2, shield.value + Math.round(healed * 0.2));
        }
      }
      if (
        abilityId === 'scouring_mercy' &&
        healed > 0 &&
        hasPriestTalent(ctx, source, PRIEST_TALENT_IDS.secondVerse)
      ) {
        ctx.applyAura(ally, {
          id: `priest_second_verse_scouring_mercy_${ctx.tickCount}`,
          name: 'Scouring Mercy',
          kind: 'hot',
          remaining: 2,
          duration: 2,
          value: Math.max(1, Math.round(healed * 0.4)),
          tickInterval: 2,
          tickTimer: 2,
          sourceId: source.id,
          school: 'holy',
        });
      }
    }
    return;
  }

  const fallback = lowestHealthGroupAlly(ctx, source);
  if (fallback) {
    ctx.applyHeal(
      source,
      fallback,
      Math.round(dealt * DOCTRINE_FALLBACK_CONVERSION),
      'Doctrine',
      abilityId,
      false,
      false,
    );
  }
}
