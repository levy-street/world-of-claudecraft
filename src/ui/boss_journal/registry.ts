// Every five-player dungeon that ships a boss guide, keyed by dungeon id. A
// new dungeon page is one data module under ./dungeons/ plus its row here.

import { DROWNED_TEMPLE_JOURNAL } from './dungeons/drowned_temple';
import { GRAVEWYRM_SANCTUM_JOURNAL } from './dungeons/gravewyrm_sanctum';
import { HOLLOW_CRYPT_JOURNAL } from './dungeons/hollow_crypt';
import { SUNKEN_BASTION_JOURNAL } from './dungeons/sunken_bastion';
import { WILDHEART_BASIN_JOURNAL } from './dungeons/wildheart_basin';
import { type DungeonJournalDef, dungeonJournalSource, type JournalSource } from './journal_view';

export const DUNGEON_JOURNALS: readonly DungeonJournalDef[] = [
  HOLLOW_CRYPT_JOURNAL,
  SUNKEN_BASTION_JOURNAL,
  DROWNED_TEMPLE_JOURNAL,
  GRAVEWYRM_SANCTUM_JOURNAL,
  WILDHEART_BASIN_JOURNAL,
];

const SOURCES = new Map<string, JournalSource>(
  DUNGEON_JOURNALS.map((def) => [def.dungeonId, dungeonJournalSource(def)]),
);

/** The dungeon's guide as a window source, or null for a dungeon with none. */
export function dungeonJournalSourceFor(dungeonId: string): JournalSource | null {
  return SOURCES.get(dungeonId) ?? null;
}
