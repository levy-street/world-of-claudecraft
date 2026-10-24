// Pure, host-agnostic Gearscore: the average item level of a worn paperdoll.
//
// The pure-core half of the gearscore readout. Both the character sheet (above
// the Offense panel) and the inspect window (under the model stage's floor line)
// paint the same number, so it is computed once here from the PaperdollView
// both surfaces already build. Each worn piece contributes the same per-copy
// level its tooltip prints (itemInstanceLevel, plus the Riftbound band's
// per-copy ladder level when its shell has no source), so the score and the
// tooltips can never disagree.
//
// Only pieces with a derivable item level count: an empty slot, or a piece with
// no level (starter and vendor gear, non-combat oddities), adds nothing to the
// sum and nothing to the count. DOM-free, i18n-free, no RNG or wall clock, so
// tests/gear_score_view.test.ts drives it directly.

import { itemInstanceLevel } from '../sim/item_level';
import { riftBandItemLevel } from '../sim/rift/band_ladder';
import type { ItemDef, ItemInstancePayload } from '../sim/types';
import type { PaperdollSlot, PaperdollView } from './char_view';

/** The level one worn copy contributes, or undefined when it has none. Mirrors
 *  the tooltip's itemLevelReadout level (rift_band_tooltip.ts). */
export function wornItemLevel(item: ItemDef, instance?: ItemInstancePayload): number | undefined {
  const level = itemInstanceLevel(item, instance);
  if (level !== undefined) return level;
  const rift = instance?.rift;
  return rift ? riftBandItemLevel(rift.tier, rift.upgradeLevel) : undefined;
}

/** The Gearscore: the average item level over every worn piece that has one,
 *  rounded to one decimal. Each worn piece counts once, so a two-hander counts
 *  once and a dual-wielded pair of two-handers counts twice. Null when nothing
 *  worn has an item level (the painter hides the line). */
export function gearScore(view: PaperdollView): number | null {
  const cells: PaperdollSlot[] = [...view.left, ...view.right, ...view.weapons];
  let sum = 0;
  let count = 0;
  for (const { item, instance } of cells) {
    if (!item) continue;
    const level = wornItemLevel(item, instance ?? undefined);
    if (level === undefined) continue;
    sum += level;
    count += 1;
  }
  return count > 0 ? Math.round((sum / count) * 10) / 10 : null;
}
