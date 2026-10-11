// The dungeon guide registry: one record per optional lore guide (the guide
// system lives in src/sim/dungeon_guide). A later dungeon adds its guide by
// authoring a DungeonGuideDef plus its dynamic NpcDef, placing the NPC in its
// DungeonDef.npcs, and appending the record here. Pure data.

import type { DungeonGuideDef } from '../dungeon_guide/types';
import { CANTOR_GUIDE } from './drowned_temple_cantor';

export const DUNGEON_GUIDES: Readonly<Record<string, DungeonGuideDef>> = {
  [CANTOR_GUIDE.id]: CANTOR_GUIDE,
};

const BY_NPC: ReadonlyMap<string, DungeonGuideDef> = new Map(
  Object.values(DUNGEON_GUIDES).map((g) => [g.npcId, g]),
);

/** The guide record an NPC template plays, or null for every other NPC. */
export function dungeonGuideForNpc(npcTemplateId: string): DungeonGuideDef | null {
  return BY_NPC.get(npcTemplateId) ?? null;
}

/** The full i18n key of one of a guide's line or dialog key suffixes. */
export function dungeonGuideKey(guide: DungeonGuideDef, key: string): string {
  return `${guide.i18nPrefix}.${key}`;
}
