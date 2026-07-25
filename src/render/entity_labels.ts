// Localized display names for the entities the renderer labels (nameplates and
// the build-time nameplate text). These wrap the i18n catalog (tEntity / t), so
// they are painter-side, not part of any pure core. Lifted out of renderer.ts so
// both the renderer and the NameplatePainter can share objectDisplayName without
// a renderer <-> painter import cycle.

import { SOURCE_CAVE_CHEST_TEMPLATE, SOURCE_CAVE_REBOOT_TEMPLATE } from '../sim/source_cave';
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
  if (entity.templateId === SOURCE_CAVE_REBOOT_TEMPLATE) {
    return t('worldContent.sourceCaveReboot');
  }
  if (entity.templateId === 'mailbox') {
    return t('worldContent.mailboxName');
  }
  if (entity.templateId === 'noticeboard_eastbrook') {
    return t('worldContent.noticeboardName');
  }
  if (entity.templateId === 'delve_locked_chest') {
    return t('worldContent.delveLockedChestInteract');
  }
  // The Source Cave's own reward chest reuses the delve reward-chest interact
  // label verbatim (same lootable-chest precedent; outside the delve_ prefix
  // since it is a plain ground object, not a delve interactable).
  if (
    entity.templateId === 'delve_reward_chest' ||
    entity.templateId === SOURCE_CAVE_CHEST_TEMPLATE
  ) {
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
  // The Source Cave's overworld entrance is a well with its own landmark name
  // (shown only very close, see nameplate_view.ts), not the dungeon's own name
  // like every other door.
  if (entity.templateId === 'dungeon_door' && entity.dungeonId === 'source_cave') {
    return t('worldContent.sourceCaveWellName');
  }
  // The Source Cave's exit portal only ever labels while the encounter seals it
  // (nameplate_view hides the open one entirely), so its one label is the denial.
  if (entity.templateId === 'dungeon_exit' && entity.dungeonId === 'source_cave') {
    return t('worldContent.sourceCaveExitDenied');
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
