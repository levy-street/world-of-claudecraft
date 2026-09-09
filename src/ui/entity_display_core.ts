// HUD-boundary display-name and narrative resolution for world entities: the pure
// id-to-localized-text resolvers the HUD (and its window modules) render from. Each
// wraps tEntity / the content tables so every surface resolves the same name the same
// way; the *FromSource variants reverse a sim-emitted ENGLISH name back to its
// localized display form (the sim stays language-agnostic, src/sim/CLAUDE.md).
// Extracted verbatim from src/ui/hud.ts under the monolith ratchet
// (tests/monolith_budget.test.ts); a pure core with no DOM and no IWorld.
//
// THE ONE HOME of the family since the Phase 18 sweep (2026-08-31): the live
// entity naming rule (entityDisplayName, once src/ui/entity_display_name.ts)
// and the two combat-log label helpers (combatAbilityName, parseSimMoney, once
// src/ui/entity_display_labels.ts) were folded in here, so the three sibling
// modules two packets extracted from hud.ts are one pure leaf again. The two
// old paths were one-line re-export shims until src/ui/hud.ts re-pointed at
// this module (the Phase 18 frontend review round), and were deleted with that
// last import; every consumer names this path.
import { isNecromancyUndead } from '../sim/combat/necromancy';
import { DUNGEON_LIST, ITEMS, QUESTS } from '../sim/data';
import type { Entity, PlayerClass } from '../sim/types';
import { abilityDisplayNameFromSource } from './ability_display_name';
import { classDisplayName, dungeonDisplayName, itemDisplayName, tEntity } from './entity_i18n';
import { feastTitleFor } from './hud/professions/feast_title';
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

export function delveDisplayName(delveId: string): string {
  return tEntity({ kind: 'delve', id: delveId, field: 'name' });
}

// The localized display name of a live world entity, as the HUD shows it
// (target and target-of-target frames, target auras, combat log lines). Both
// packets extracted it out of hud.ts (this module at the v0.37.0 chat-quota
// sync, farming's entity_display_name.ts at its Phase 12 headroom extraction);
// the farming absorb (Masterwrought 11b) kept farming's copy as the authority
// because it carries the live feast-title arm, and the Phase 18 sweep moved
// that copy HERE verbatim, still pinned by tests/entity_display_name.test.ts.
//
// The rules, unchanged from the hud.ts original plus the Phase 12 feast arm:
//  - a WILD mob names by its template through the entity dictionary;
//  - an OWNED mob (a pet or a summon, except the necromancy undead, which
//    keep their template identity) carries a sim-authored name, localized
//    through the aura-name matcher with the raw name as the fallback;
//  - an NPC names by its template;
//  - the placed harvest feast composes the localized "{name}'s Harvest
//    Feast" title around the PLACER'S raw name (the wire carries the name as
//    a value; sim and server stay language-agnostic);
//  - every other entity (players, plain objects) shows its wire name as is.
export function entityDisplayName(entity: Entity): string {
  if (entity.kind === 'mob') {
    return entity.ownerId !== null && !isNecromancyUndead(entity)
      ? (localizeSimAuraName(entity.name) ?? entity.name)
      : tEntity({ kind: 'mob', id: entity.templateId, field: 'name' });
  }
  if (entity.kind === 'npc') return tEntity({ kind: 'npc', id: entity.templateId, field: 'name' });
  if (entity.kind === 'object') {
    // ANY placed feast, of any tier (masterwrought Phase 11k): the shared
    // feast_title leaf owns the templateId-to-key rule so this surface and the
    // world label cannot name the same table two different things.
    const feastTitle = feastTitleFor(entity.templateId, entity.name);
    if (feastTitle !== null) return feastTitle;
  }
  return entity.name;
}

// The two combat-log label helpers the Ignivar raid consolidation extracted to
// entity_display_labels.ts (trimmed to these two at the eighth v0.41.0 sync),
// moved here verbatim at the Phase 18 sweep: the ability name a combat line
// prints (a null source name is the plain melee attack), and the reverse of
// the sim's plain-English money fragments ("3g 5s") back to copper so the HUD
// can re-render them locale-aware (src/sim/CLAUDE.md, "Money is built English
// here"). Null when the text carries no money fragment at all.
export function combatAbilityName(name: string | null): string {
  return name ? abilityDisplayNameFromSource(name) : t('hud.combat.attack');
}

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
