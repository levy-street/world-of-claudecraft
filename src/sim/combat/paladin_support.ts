import type { SimContext } from '../sim_context';
import type { Aura, Entity } from '../types';

const PALADIN_AURA_CHOICE_IDS: ReadonlySet<string> = new Set(['devotion_ward', 'retribution_aura']);

const PALADIN_LONG_DEVOTION_IDS: ReadonlySet<string> = new Set([
  'radiant_devotion',
  'dawn_devotion',
  'grace_devotion',
]);

export const PALADIN_DEVOTION_ABILITY_IDS: ReadonlySet<string> = new Set([
  ...PALADIN_AURA_CHOICE_IDS,
  ...PALADIN_LONG_DEVOTION_IDS,
]);

function devotionFamily(id: string): ReadonlySet<string> | null {
  if (PALADIN_AURA_CHOICE_IDS.has(id)) return PALADIN_AURA_CHOICE_IDS;
  if (PALADIN_LONG_DEVOTION_IDS.has(id)) return PALADIN_LONG_DEVOTION_IDS;
  return null;
}

export function paladinDevotionConflicts(
  auras: readonly Aura[],
  sourceId: number,
  incomingId: string,
): number[] {
  const family = devotionFamily(incomingId);
  if (!family) return [];
  const conflicts: number[] = [];
  for (let index = auras.length - 1; index >= 0; index--) {
    const aura = auras[index];
    if (aura.sourceId === sourceId && aura.id !== incomingId && family.has(aura.id)) {
      conflicts.push(index);
    }
  }
  return conflicts;
}

/** Replace only the other choice in the incoming Devotion's family. Recasting the
 * same Devotion refreshes it through normal aura application instead of fading it. */
export function replacePaladinDevotionChoice(
  ctx: SimContext,
  sourceId: number,
  incomingId: string,
): void {
  for (const entity of ctx.entities.values()) {
    const conflicts = paladinDevotionConflicts(entity.auras, sourceId, incomingId);
    for (const index of conflicts) {
      const aura = entity.auras[index];
      ctx.applyNonPlayerStatAura(entity, aura, -1);
      entity.auras.splice(index, 1);
      ctx.emit({ type: 'aura', targetId: entity.id, name: aura.name, gained: false });
    }
    if (conflicts.length > 0 && entity.kind === 'player') ctx.recalcPlayer(entity);
  }
}

export function stripPaladinDevotionsFromSource(
  ctx: SimContext,
  sourceId: number,
  familyId?: string,
): void {
  const family = familyId === undefined ? PALADIN_DEVOTION_ABILITY_IDS : devotionFamily(familyId);
  if (!family) return;
  for (const entity of ctx.entities.values()) {
    let removed = false;
    for (let index = entity.auras.length - 1; index >= 0; index--) {
      const aura = entity.auras[index];
      if (aura.sourceId !== sourceId || !family.has(aura.id)) continue;
      ctx.applyNonPlayerStatAura(entity, aura, -1);
      entity.auras.splice(index, 1);
      removed = true;
      ctx.emit({ type: 'aura', targetId: entity.id, name: aura.name, gained: false });
    }
    if (removed && entity.kind === 'player') ctx.recalcPlayer(entity);
  }
}

export function paladinManaCostMultiplier(entity: Entity): number {
  let reduction = 0;
  for (const aura of entity.auras) {
    if (aura.kind === 'buff_mana_grace') reduction += aura.value2 ?? 0.03;
  }
  return Math.max(0.2, 1 - reduction);
}

export function paladinHealingDoneMultiplier(entity: Entity): number {
  let bonus = 0;
  for (const aura of entity.auras) {
    if (aura.kind === 'buff_healing_done') bonus += aura.value;
    else if (aura.kind === 'sacred_form') bonus += aura.value;
  }
  return 1 + bonus;
}
