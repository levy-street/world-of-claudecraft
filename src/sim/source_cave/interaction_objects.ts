import type { Entity } from '../types';
import { SOURCE_CAVE_CHEST_SEALED_TEMPLATE, SOURCE_CAVE_CHEST_TEMPLATE } from './clear';
import { SOURCE_CAVE_REBOOT_TEMPLATE } from './reboot';
import { SOURCE_CAVE_DUNGEON_ID } from './runtime';

type SourceCaveObject = Pick<Entity, 'dungeonId' | 'templateId'>;

/**
 * The cave's overworld entrance. It is the one INTERACT-ONLY dungeon door (the
 * walk-in trigger skips it so the well banter runs, see instances/dungeons.ts),
 * which is why a released spirit may still click it while every other dead
 * interaction is refused: the sim routes that click through to re-entry, and
 * without it a corpse-running ghost is stranded outside its own corpse.
 */
export function isSourceCaveWell(entity: SourceCaveObject): boolean {
  return entity.templateId === 'dungeon_door' && entity.dungeonId === SOURCE_CAVE_DUNGEON_ID;
}

/** Objects whose interaction outcome must always be resolved by the server-side sim. */
export function isSourceCaveGatedObject(entity: SourceCaveObject): boolean {
  return (
    isSourceCaveWell(entity) ||
    entity.templateId === SOURCE_CAVE_REBOOT_TEMPLATE ||
    entity.templateId === SOURCE_CAVE_CHEST_TEMPLATE ||
    entity.templateId === SOURCE_CAVE_CHEST_SEALED_TEMPLATE
  );
}
