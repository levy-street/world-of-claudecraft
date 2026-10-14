// The Skull Bag pane's pure view core: turns the IWorld readout
// (`worldPvpInfo.skullBag`, src/sim/pvp/skull_bag.ts) plus the carried bags
// into rows, counts, and the render-skip signature. DOM-free and i18n-free:
// skull_bag_pane_controller.ts localizes and paints it.

import { type MaterialSource, materialSourceKey } from '../../../sim/material_sources';
import {
  WORLD_PVP_SKULL_BAG_ITEM_ID,
  WORLD_PVP_SKULL_ITEM_ID,
} from '../../../sim/pvp/world_pvp_trophy';
import type { InvSlot } from '../../../sim/types';
import type { SkullBagInfo } from '../../../world_api';

/** One victim's skulls in the bag. */
export interface SkullBagRowView {
  /** The bucket's canonical key: stable across repaints, a safe focus key. */
  key: string;
  /** The victim's name as they died under it, or null for unrecorded skulls. */
  victim: string | null;
  count: number;
  /** The exact descriptor a take sends back, untouched. */
  source: MaterialSource;
}

export interface SkullBagPaneView {
  /** The bag is carried: Store and Take are live. */
  owned: boolean;
  total: number;
  /** Most skulls first, then by name; unrecorded skulls last. */
  rows: SkullBagRowView[];
  /** Plain skulls in the bags that Store would move in. */
  carried: number;
  /** Changes whenever anything painted changes; the pane skips a repaint
   *  while it holds. */
  signature: string;
}

/** Plain (uninstanced) skulls carried in the bags: what Store moves. */
export function carriedSkullCount(inventory: readonly InvSlot[]): number {
  let count = 0;
  for (const slot of inventory) {
    if (slot.itemId === WORLD_PVP_SKULL_ITEM_ID && !slot.instance && slot.count > 0) {
      count += slot.count;
    }
  }
  return count;
}

function compareRows(a: SkullBagRowView, b: SkullBagRowView): number {
  if ((a.victim === null) !== (b.victim === null)) return a.victim === null ? 1 : -1;
  if (a.count !== b.count) return b.count - a.count;
  const an = a.victim ?? '';
  const bn = b.victim ?? '';
  if (an !== bn) return an < bn ? -1 : 1;
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
}

/** The pane's view, or null when the viewer has neither a bag nor stored skulls.
 *  A bag carried before its readout has arrived (online, the moment after a
 *  purchase) still opens, as an empty owned bag. */
export function skullBagPaneView(
  info: SkullBagInfo | undefined,
  inventory: readonly InvSlot[],
): SkullBagPaneView | null {
  if (!info) {
    if (!inventory.some((s) => s.itemId === WORLD_PVP_SKULL_BAG_ITEM_ID && s.count > 0)) {
      return null;
    }
    info = { owned: true, total: 0, sources: [] };
  }
  const rows = info.sources
    .filter((bucket) => bucket.count > 0)
    .map((bucket) => ({
      key: materialSourceKey(bucket.source),
      victim: bucket.source.gatherer?.name ?? null,
      count: bucket.count,
      source: bucket.source,
    }))
    .sort(compareRows);
  const carried = carriedSkullCount(inventory);
  const signature = [
    info.owned ? 1 : 0,
    info.total,
    carried,
    ...rows.map((row) => `${row.key}=${row.count}`),
  ].join('|');
  return { owned: info.owned, total: info.total, rows, carried, signature };
}

/** The take a row button sends: `count` skulls of exactly that victim. */
export function skullBagTakeAction(
  row: SkullBagRowView,
  count: number,
): { op: 'take'; sources: { source: MaterialSource; count: number }[] } {
  return { op: 'take', sources: [{ source: row.source, count: Math.min(count, row.count) }] };
}
