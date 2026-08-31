import { isNecromancyUndead } from '../sim/combat/necromancy';
import { ITEMS, QUESTS } from '../sim/data';
import type { ResolvedAbility } from '../sim/sim';
import type { AbilityDef, Entity, PlayerClass, ResourceType } from '../sim/types';
import { formatAbilityNumber } from './ability_description';
import { abilityDisplayNameFromSource } from './ability_display_name';
import { classDisplayName, itemDisplayName, tEntity } from './entity_i18n';
import { formatNumber, type TranslationKey, t } from './i18n';
import { localizeSimAuraName } from './sim_i18n';

const RESOURCE_LABEL_KEYS: Record<ResourceType, TranslationKey> = {
  mana: 'abilityUi.resources.mana',
  rage: 'abilityUi.resources.rage',
  energy: 'abilityUi.resources.energy',
  focus: 'abilityUi.resources.focus',
};

export function itemDisplayNameFromSource(name: string): string {
  const item = Object.values(ITEMS).find((candidate) => candidate.name === name);
  return item ? itemDisplayName(item) : name;
}

export function itemStackDisplayName(item: string, stackSuffix?: string): string {
  const itemName = itemDisplayNameFromSource(item);
  if (!stackSuffix) return itemName;
  const count = Number(stackSuffix.trim().slice(1));
  return `${itemName} ${t('itemUi.bags.stackCount', { count: formatNumber(count, { maximumFractionDigits: 0 }) })}`;
}

export function mobDisplayName(mobId: string): string {
  return tEntity({ kind: 'mob', id: mobId, field: 'name' });
}

export function npcDisplayName(npcId: string): string {
  return tEntity({ kind: 'npc', id: npcId, field: 'name' });
}

export function npcDisplayTitle(npcId: string): string {
  return tEntity({ kind: 'npc', id: npcId, field: 'title' });
}

export function npcGreeting(npcId: string, playerClass: PlayerClass, playerName: string): string {
  const className = classDisplayName(playerClass);
  return tEntity({
    kind: 'npc',
    id: npcId,
    field: 'greeting',
    values: {
      className,
      classNameLower: className.toLocaleLowerCase(),
      playerName,
    },
  });
}

export function questTitle(questId: string): string {
  return tEntity({ kind: 'quest', id: questId, field: 'title' });
}

export function questNarrative(
  questId: string,
  field: 'text' | 'completion',
  playerName: string,
): string {
  return tEntity({ kind: 'quest', id: questId, field, values: { playerName } });
}

export function questObjectiveLabel(questId: string, objectiveIndex: number): string {
  return tEntity({
    kind: 'questObjective',
    questId,
    objectiveIndex,
    field: 'label',
  });
}

export function questTitleFromSource(name: string): string {
  const quest = Object.values(QUESTS).find((candidate) => candidate.name === name);
  return quest ? questTitle(quest.id) : name;
}

export function zoneWelcome(zoneId: string): string {
  return tEntity({ kind: 'zone', id: zoneId, field: 'welcome' });
}

export function dungeonText(dungeonId: string, field: 'enterText' | 'leaveText'): string {
  return tEntity({ kind: 'dungeon', id: dungeonId, field });
}

export function delveText(delveId: string, field: 'enterText' | 'leaveText'): string {
  return tEntity({ kind: 'delve', id: delveId, field });
}

export function entityDisplayName(entity: Entity): string {
  if (entity.kind === 'mob')
    return entity.ownerId !== null && !isNecromancyUndead(entity)
      ? (localizeSimAuraName(entity.name) ?? entity.name)
      : mobDisplayName(entity.templateId);
  if (entity.kind === 'npc') return npcDisplayName(entity.templateId);
  return entity.name;
}

export function combatAbilityName(name: string | null): string {
  return name ? abilityDisplayNameFromSource(name) : t('hud.combat.attack');
}

export function resourceDisplayName(resourceType: ResourceType | null): string {
  return t(RESOURCE_LABEL_KEYS[resourceType ?? 'mana']);
}

// itemSlotName moved to ./item_slot_labels as itemSlotLabel (imported above under
// its old name here), so the pure view cores can read the same shared-label facts
// the HUD does (#2466).

export function parseSimMoney(text: string): number | null {
  let copper = 0;
  let matched = false;
  for (const match of text.matchAll(/(\d+)\s*([gsc])/gi)) {
    matched = true;
    const amount = Number(match[1]);
    const unit = match[2].toLowerCase();
    if (unit === 'g') copper += amount * 10000;
    else if (unit === 's') copper += amount * 100;
    else copper += amount;
  }
  return matched ? copper : null;
}

export function abilityRangeLine(def: AbilityDef): string | null {
  if (def.range <= 0) return null;
  if (def.minRange !== undefined) {
    return t('abilityUi.tooltip.rangeWithMin', {
      min: formatAbilityNumber(def.minRange),
      max: formatAbilityNumber(def.range),
    });
  }
  return t('abilityUi.tooltip.range', {
    range: formatAbilityNumber(def.range),
  });
}

// The live caster's TOTAL spell-haste fraction: the resolved stat (set bonuses + spec
// mastery) PLUS active buff_spellhaste auras (Arcane Power, Icy Veins, Metamorphosis).
// Mirrors the sim's spellHasteMult (spell_combat.ts) EXACTLY, including its
// `Math.max(0, ...)` floor, so a shown cast time never disagrees with the real one (a
// net-negative haste, e.g. a cast-slow debuff, floors at 0 for both). ui/ cannot import
// the sim-combat helper across the seam, so the formula is kept identical here by hand.
export function playerSpellHasteFrac(p: Entity | null | undefined): number {
  if (!p) return 0;
  let frac = p.spellHaste;
  for (const a of p.auras) if (a.kind === 'buff_spellhaste') frac += a.value;
  return Math.max(0, frac);
}

// `spellHaste` (the live character's total spell haste, a fraction) shortens the shown
// cast / channel time exactly as the sim does, so a hasted caster's tooltips reflect the
// real, faster cast.
export function abilityCastLine(known: ResolvedAbility, spellHaste = 0): string {
  const h = 1 + Math.max(0, spellHaste);
  if (known.def.channel) {
    return t('abilityUi.tooltip.channeledSeconds', {
      seconds: formatAbilityNumber(known.def.channel.duration / h),
    });
  }
  if (known.castTime > 0) {
    return t('abilityUi.tooltip.castSeconds', {
      seconds: formatAbilityNumber(known.castTime / h),
    });
  }
  return t('abilityUi.tooltip.instant');
}
