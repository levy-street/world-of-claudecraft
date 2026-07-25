import type { Entity } from '../types';
import { SOURCE_CAVE_CHEST_SEALED_TEMPLATE, SOURCE_CAVE_CHEST_TEMPLATE } from './clear';
import { SOURCE_CAVE_REBOOT_TEMPLATE } from './reboot';
import { SOURCE_CAVE_DUNGEON_ID } from './runtime';

type SourceCaveObject = Pick<Entity, 'dungeonId' | 'templateId'>;

/** Objects whose interaction outcome must always be resolved by the server-side sim. */
export function isSourceCaveGatedObject(entity: SourceCaveObject): boolean {
  return (
    (entity.templateId === 'dungeon_door' && entity.dungeonId === SOURCE_CAVE_DUNGEON_ID) ||
    entity.templateId === SOURCE_CAVE_REBOOT_TEMPLATE ||
    entity.templateId === SOURCE_CAVE_CHEST_TEMPLATE ||
    entity.templateId === SOURCE_CAVE_CHEST_SEALED_TEMPLATE
  );
}
