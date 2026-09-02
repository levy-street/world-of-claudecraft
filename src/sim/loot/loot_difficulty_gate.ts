// The difficulty gate for loot-table rows: which entries of a mob's base
// `loot` table a kill actually rolls, given whether the kill carries a live
// heroic instance claim.
//
// A `LootEntry.normalOnly` row is authored for the Normal table alone. On a
// heroic claim the roller skips it outright (for a rollGroup, the whole group,
// so no rng is drawn for it) and the boss's HEROIC_BOSS_LOOT append pays that
// slot instead. That is what lets a Heroic kill REPLACE a Normal slot with an
// exclusive one rather than stacking the two, the shape the Crucible raid
// uses to hold one item per five raiders on both difficulties
// (docs/prd/ignivar-raid-loot.md, "Boss loot tables").
//
// Shared by the roller (loot/loot_roll.ts) and the Dungeon Finder preview
// (ui/dungeon_finder_view.ts) so the preview can never advertise a row the
// kill will not roll. Pure, draws NO rng, `src/sim`-pure.

import type { LootEntry } from '../types';

export function lootEntryRollsOnClaim(
  entry: Pick<LootEntry, 'normalOnly'>,
  heroicClaim: boolean,
): boolean {
  return !(heroicClaim && entry.normalOnly === true);
}
