// The Cartographer's Ink map picker's pure core: which held treasure maps one
// ink use could redraw, and what each costs. DOM-free; the controller
// (ink_map_picker_controller.ts) paints it. The sim (src/sim/treasure_vault.ts
// useCartographersInk) re-checks every choice, so this only decides what to offer.

import {
  CARTOGRAPHERS_INK_ITEM_ID,
  nextTreasureMapRarity,
  TREASURE_MAP_ITEM_IDS,
  TREASURE_MAP_RARITIES,
  TREASURE_MAP_UPGRADE_INKS,
  type TreasureMapRarity,
} from '../../../sim/content/treasure_maps';
import type { InvSlot } from '../../../sim/types';
import type { IWorld } from '../../../world_api';

export interface InkMapChoice {
  rarity: TreasureMapRarity;
  /** The map being followed (its X is marked); otherwise an unread copy. */
  read: boolean;
  /** Copies this row stands for: always 1 for the read map. */
  count: number;
  next: TreasureMapRarity;
  inks: number;
  affordable: boolean;
}

export interface InkMapPickerModel {
  /** Inks held across the bags. */
  held: number;
  /** The read map first, then unread maps from common up. A top-rarity map
   *  cannot be redrawn, so it is never offered. */
  choices: InkMapChoice[];
}

function countHeld(inventory: readonly (InvSlot | null)[], itemId: string): number {
  let n = 0;
  for (const slot of inventory) if (slot?.itemId === itemId) n += slot.count;
  return n;
}

export function inkMapPickerModel(
  world: Pick<IWorld, 'inventory' | 'treasureMap'>,
): InkMapPickerModel {
  const held = countHeld(world.inventory, CARTOGRAPHERS_INK_ITEM_ID);
  const readRarity = world.treasureMap?.rarity ?? null;
  const readRows: InkMapChoice[] = [];
  const unreadRows: InkMapChoice[] = [];
  for (const rarity of TREASURE_MAP_RARITIES) {
    const next = nextTreasureMapRarity(rarity);
    if (!next) continue;
    const copies = countHeld(world.inventory, TREASURE_MAP_ITEM_IDS[rarity]);
    const inks = TREASURE_MAP_UPGRADE_INKS[rarity];
    const row = { rarity, next, inks, affordable: held >= inks };
    const readHere = readRarity === rarity && copies > 0 ? 1 : 0;
    if (readHere) readRows.push({ ...row, read: true, count: 1 });
    if (copies - readHere > 0) unreadRows.push({ ...row, read: false, count: copies - readHere });
  }
  return { held, choices: [...readRows, ...unreadRows] };
}
