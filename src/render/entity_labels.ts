// Localized display names for the entities the renderer labels (nameplates and
// the build-time nameplate text). These wrap the i18n catalog (tEntity / t), so
// they are painter-side, not part of any pure core. Lifted out of renderer.ts so
// both the renderer and the NameplatePainter can share objectDisplayName without
// a renderer <-> painter import cycle.

import type { Entity } from '../sim/types';
import { dungeonDisplayName, tEntity } from '../ui/entity_i18n';
import { t } from '../ui/i18n';

export function mobDisplayName(mobId: string): string {
  return tEntity({ kind: 'mob', id: mobId, field: 'name' });
}

export function npcDisplayName(npcId: string): string {
  return tEntity({ kind: 'npc', id: npcId, field: 'name' });
}

export function objectDisplayName(entity: Entity): string {
  if (entity.templateId === 'mailbox') {
    return t('worldContent.mailboxName');
  }
  if (entity.templateId === 'delve_locked_chest') {
    return t('worldContent.delveLockedChestInteract');
  }
  if (entity.templateId === 'delve_reward_chest') {
    return t('worldContent.delveRewardChestInteract');
  }
  if (entity.templateId === 'delve_surface_exit') {
    return t('worldContent.delveSurfaceExitInteract');
  }
  // The Drowned Reliquary Rite finale: the risen reliquary and the four shrines
  // all carry an explicit "Press F" call to action while the rite is up.
  if (entity.templateId === 'delve_drowned_reliquary') {
    return t('worldContent.delveReliquaryInteract');
  }
  if (entity.templateId === 'delve_drowned_reliquary_open') {
    return t('worldContent.delveRewardChestInteract');
  }
  if (entity.templateId === 'delve_rite_shrine_bell') {
    return t('worldContent.delveRiteShrineBellInteract');
  }
  if (entity.templateId === 'delve_rite_shrine_candle') {
    return t('worldContent.delveRiteShrineCandleInteract');
  }
  if (entity.templateId === 'delve_rite_shrine_reed') {
    return t('worldContent.delveRiteShrineReedInteract');
  }
  if (entity.templateId === 'delve_rite_shrine_skull') {
    return t('worldContent.delveRiteShrineSkullInteract');
  }
  // Marsh room puzzle interactables: the sim names these in English
  // (createDelveObject); localize through the delveUi.object.* labels. Spent
  // variants keep the same label (same object, triggered).
  if (entity.templateId === 'delve_sluice_valve' || entity.templateId === 'delve_sluice_valve_open')
    return t('delveUi.object.sluice_valve');
  if (entity.templateId === 'delve_grave_tablet' || entity.templateId === 'delve_grave_tablet_lit')
    return t('delveUi.object.grave_tablet');
  if (
    entity.templateId === 'delve_corpse_candle' ||
    entity.templateId === 'delve_corpse_candle_lit'
  )
    return t('delveUi.object.corpse_candle');
  if (entity.templateId === 'delve_bell_rope' || entity.templateId === 'delve_bell_rope_pulled') {
    return t('delveUi.object.bell_rope');
  }
  if (
    (entity.templateId === 'dungeon_door' || entity.templateId === 'dungeon_exit') &&
    entity.dungeonId
  ) {
    const dungeonName = dungeonDisplayName(entity.dungeonId);
    return entity.templateId === 'dungeon_exit'
      ? t('worldContent.dungeonExitName', { name: dungeonName })
      : dungeonName;
  }
  // Collectible/quest ground objects carry the item id they grant; localize the
  // nameplate through the item dictionary instead of the raw English name.
  if (entity.objectItemId) return tEntity({ kind: 'item', id: entity.objectItemId, field: 'name' });
  return entity.name;
}
