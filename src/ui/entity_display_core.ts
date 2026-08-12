// HUD-boundary display-name and narrative resolution for world entities: the pure
// id-to-localized-text resolvers the HUD (and its window modules) render from. Each
// wraps tEntity / the content tables so every surface resolves the same name the same
// way; the *FromSource variants reverse a sim-emitted ENGLISH name back to its
// localized display form (the sim stays language-agnostic, src/sim/CLAUDE.md).
// Extracted verbatim from src/ui/hud.ts under the monolith ratchet
// (tests/monolith_budget.test.ts); a pure core with no DOM and no IWorld.
import { isNecromancyUndead } from '../sim/combat/necromancy';
import { DUNGEON_LIST, ITEMS, QUESTS } from '../sim/data';
import type { Entity, PlayerClass } from '../sim/types';
import { classDisplayName, dungeonDisplayName, itemDisplayName, tEntity } from './entity_i18n';
import { formatNumber, t } from './i18n';
import { localizeSimAuraName } from './sim_i18n';

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

export function dungeonDisplayNameFromSource(name: string): string {
  const dungeon = DUNGEON_LIST.find((candidate) => candidate.name === name);
  return dungeon ? dungeonDisplayName(dungeon.id) : name;
}

export function entityDisplayName(entity: Entity): string {
  if (entity.kind === 'mob')
    return entity.ownerId !== null && !isNecromancyUndead(entity)
      ? (localizeSimAuraName(entity.name) ?? entity.name)
      : mobDisplayName(entity.templateId);
  if (entity.kind === 'npc') return npcDisplayName(entity.templateId);
  return entity.name;
}

export function delveDisplayName(delveId: string): string {
  return tEntity({ kind: 'delve', id: delveId, field: 'name' });
}
