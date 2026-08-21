// The localized display name of a live world entity, as the HUD shows it
// (target and target-of-target frames, target auras, combat log lines).
// Extracted whole from hud.ts at the Phase 12 headroom extraction so the Hud
// stays a thin consumer and the naming rules are pinned by a direct Vitest
// (tests/entity_display_name.test.ts).
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
import { isNecromancyUndead } from '../sim/combat/necromancy';
import { FARM_FEAST_TEMPLATE_ID } from '../sim/professions/feast';
import type { Entity } from '../sim/types';
import { tEntity } from './entity_i18n';
import { t } from './i18n';
import { localizeSimAuraName } from './sim_i18n';

export function entityDisplayName(entity: Entity): string {
  if (entity.kind === 'mob') {
    return entity.ownerId !== null && !isNecromancyUndead(entity)
      ? (localizeSimAuraName(entity.name) ?? entity.name)
      : tEntity({ kind: 'mob', id: entity.templateId, field: 'name' });
  }
  if (entity.kind === 'npc') return tEntity({ kind: 'npc', id: entity.templateId, field: 'name' });
  if (entity.kind === 'object' && entity.templateId === FARM_FEAST_TEMPLATE_ID) {
    return t('hudChrome.farming.feastTitle', { name: entity.name });
  }
  return entity.name;
}
