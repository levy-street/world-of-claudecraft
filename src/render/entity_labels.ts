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
