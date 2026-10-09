// The class-lock gate for loot-table rows: a drop that is BOTH soulbound and
// class-restricted (a non-empty `requiredClass`) only rolls when at least one
// class in the kill's loot-eligible set can use it.
//
// Soulbound blocks trade, mail, market, and sale, so a class-locked soulbound
// drop that nobody present can use is a dead slot: it costs the kill an item
// and leaves the looter a token to destroy. The Crucible sigils are the live
// case (content/ignivar_loot.ts): each covers one three-class group, so a raid
// with none of a group's classes could win a sigil no member can redeem.
//
// "Can use" is the literal `requiredClass` list, the same rule the Crucible
// Quartermaster's redemption gate applies (instances/crucible_vendor.ts).
// Items that are only one of soulbound or class-restricted are untouched.
//
// Shared by rollLoot and rollWorldBossLoot. Pure and draws NO rng: callers
// keep their own table draws, so a group still draws exactly one rng.next()
// and a plain row still draws its chance, whatever the party's classes are.
// A withheld GEAR copy never reaches the later quality roll, so it skips that
// copy's tier draw; the live locked drops (sigils) are not gear.
//
// Authoring notes for the reweight: a row with no itemId (an explicit
// "nothing" row) is kept and scaled like any other, unlike the implicit
// nothing share of a group summing below 1, which is preserved; and a group
// mixing locked and unlocked rows raises the unlocked rows too. Live groups
// are all-locked (the sigil partitions) or all-unlocked.

import { ITEMS } from '../data';
import type { LootEntry, PlayerClass } from '../types';

// True when a drop of `itemId` is usable by at least one of `classes`.
// Anything not both soulbound and class-restricted is always usable.
export function lootItemUsableByClasses(
  itemId: string,
  classes: ReadonlySet<PlayerClass>,
): boolean {
  const def = ITEMS[itemId];
  if (!def?.soulbound || !def.requiredClass?.length) return true;
  return def.requiredClass.some((cls) => classes.has(cls));
}

// An exclusive rollGroup with its unusable rows removed. The removed rows'
// share is redistributed across the kept rows in proportion to their chances,
// so the group's total drop chance is unchanged (a guaranteed slot stays
// guaranteed and still pays something the raid can use). The last kept row
// absorbs the float remainder so the cumulative walk ends on the original
// total. Returns `group` itself when nothing is removed, so every group with
// no locked rows rolls on byte-identical weights; an empty array when every
// row is unusable (the caller's pick then yields nothing).
export function usableRollGroup(
  group: readonly LootEntry[],
  usable: (itemId: string) => boolean,
): readonly LootEntry[] {
  const kept = group.filter((entry) => !entry.itemId || usable(entry.itemId));
  if (kept.length === group.length) return group;
  if (kept.length === 0) return [];
  const total = group.reduce((sum, entry) => sum + entry.chance, 0);
  const keptTotal = kept.reduce((sum, entry) => sum + entry.chance, 0);
  if (keptTotal <= 0) return [];
  const scale = total / keptTotal;
  let cumulative = 0;
  return kept.map((entry, index) => {
    const chance = index === kept.length - 1 ? total - cumulative : entry.chance * scale;
    cumulative += chance;
    return { ...entry, chance };
  });
}
