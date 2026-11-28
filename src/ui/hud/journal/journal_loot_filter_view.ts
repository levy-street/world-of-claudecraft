// Pure model of the Adventure Journal's Loot filter: which of a page's real
// drops a class and specialization can use, for one boss or for the whole
// instance. It reuses the Dungeon Finder's loot preview rule
// (dungeon_loot_preview_view.ts: legal armor and weapon types, the class gate,
// and the specialization's role and stat affinity), so the journal and the
// Adventure Guide never disagree about what an item is for. A drop the loot
// table itself keeps to one class (restrictedToClass) shows only for that class.
// "All classes" is a null filter: every drop shows.

import { ITEMS } from '../../../sim/data';
import type { DungeonDifficulty, PlayerClass } from '../../../sim/types';
import {
  type LootPreviewSelection,
  lootPreviewFits,
  validLootPreviewSpec,
} from '../../dungeon_loot_preview_view';
import type { TranslationKey } from '../../i18n';
import type { JournalInstance } from './journal_catalog';
import { journalPageBodies } from './journal_catalog';
import { type JournalLootRow, journalLoot } from './journal_loot_view';

/** One boss's drops, or the whole instance's, boss by boss. */
export type JournalLootScope = 'boss' | 'instance';
export const JOURNAL_LOOT_SCOPES: readonly JournalLootScope[] = ['boss', 'instance'];

/** A class (and maybe a specialization) to show loot for; null is All classes. */
export type JournalLootFilter = LootPreviewSelection | null;

/** The filter a character opens on: its own class and current specialization
 *  (an unknown or unchosen specialization reads as every specialization). */
export function journalLootFilterFor(cls: PlayerClass, spec: string | null): LootPreviewSelection {
  return { cls, spec: validLootPreviewSpec(cls, spec) };
}

/** Whether a drop shows under a filter. */
export function journalLootFits(row: JournalLootRow, filter: JournalLootFilter): boolean {
  if (!filter) return true;
  if (row.restrictedToClass && row.restrictedToClass !== filter.cls) return false;
  const item = ITEMS[row.itemId];
  return !!item && lootPreviewFits(item, filter);
}

export interface JournalLootSection {
  bossKey: string;
  /** Every body the page covers (two for a council). */
  members: readonly string[];
  nameKey?: TranslationKey;
  portraitUrl: string;
  /** The drops the filter keeps, in the loot model's order. */
  rows: JournalLootRow[];
  /** Every drop of the page on this difficulty, before the filter. */
  total: number;
}

export interface JournalLootView {
  sections: JournalLootSection[];
  /** Every drop in scope before the filter, and how many the filter keeps. */
  total: number;
  shown: number;
}

/** The Loot tab's model: the page's drops (or every page's, in route order)
 *  on one difficulty, narrowed by the filter. */
export function journalLootView(
  instance: JournalInstance,
  bossKey: string,
  scope: JournalLootScope,
  difficulty: DungeonDifficulty,
  filter: JournalLootFilter,
): JournalLootView {
  const keys = scope === 'instance' ? instance.source.bossKeys : [bossKey];
  const sections = keys.map((key): JournalLootSection => {
    const view = instance.source.view(key, 'normal');
    const all = journalLoot(journalPageBodies(instance.source, key), difficulty);
    return {
      bossKey: key,
      members: view.members ?? [view.mobId],
      ...(view.nameKey ? { nameKey: view.nameKey } : {}),
      portraitUrl: view.portraitUrl,
      rows: all.filter((row) => journalLootFits(row, filter)),
      total: all.length,
    };
  });
  let total = 0;
  let shown = 0;
  for (const section of sections) {
    total += section.total;
    shown += section.rows.length;
  }
  return { sections, total, shown };
}
