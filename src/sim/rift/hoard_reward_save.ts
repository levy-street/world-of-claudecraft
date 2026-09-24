// Persist the collection half of a direct vault grant in the same character
// blob as its inventory. The live grant still emits events and syncs account
// deeds after commit; a crash before autosave must not lose the find itself.

import type { CharacterState } from '../character_state';
import { ITEMS } from '../data';
import { restoreDeedStats, serializeDeedStats } from '../deeds';
import {
  noteRelicItemFind,
  noteRelicObtain,
  restoreReliquaryState,
  serializeReliquaryState,
} from '../reliquary';
import type { ItemDef } from '../types';

export function projectHoardRewardCollections(
  state: CharacterState,
  items: readonly Readonly<{ itemId: string; count: number }>[],
): void {
  if (items.length === 0) return;
  const deedStats = restoreDeedStats(state.deedStats);
  const reliquary = restoreReliquaryState(state.reliquary);
  const meta = { deedStats, reliquary, delveClears: state.delveClears ?? {} };

  for (const item of items) {
    let id: string | undefined = item.itemId;
    let viaTier = false;
    // Keep the same capped heroic/relicOf walk and quality rule as the real
    // markItemDiscovered hub. Its event/deed side effects run on the live Sim.
    for (let depth = 0; id !== undefined && depth < 3; depth++) {
      const def: ItemDef | undefined = Object.hasOwn(ITEMS, id) ? ITEMS[id] : undefined;
      if (!def) break;
      if (!deedStats.itemsDiscovered.has(id)) {
        deedStats.itemsDiscovered.add(id);
        noteRelicItemFind(meta, id);
      }
      const quality = def.quality;
      if (!viaTier && (quality === 'rare' || quality === 'epic' || quality === 'legendary')) {
        deedStats.visited.add(`quality:${quality}`);
      }
      viaTier = def.heroicOf === undefined && def.relicOf !== undefined;
      id = def.heroicOf ?? def.relicOf;
    }
    noteRelicObtain(meta, item.itemId, item.count);
  }

  const savedStats = serializeDeedStats(deedStats);
  if (savedStats) state.deedStats = savedStats;
  const savedReliquary = serializeReliquaryState(reliquary);
  if (savedReliquary) state.reliquary = savedReliquary;
}
