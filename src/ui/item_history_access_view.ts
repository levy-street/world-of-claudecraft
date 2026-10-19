// Who may open a tracked copy's Item history, which record they read, and
// which door a surface shows for it. The bags offer the history to the
// holder from the right-click menu (bag_item_context_menu.ts); the trade
// window and the guild bank offer it to a player WEIGHING a copy someone
// else holds (the counterparty's offer, the guild's pooled stock), so the
// record handed to the dialog for such a copy is the public projection
// (publicProvenanceView): names and dates only, never a character id. The
// item's guid never reaches any of these surfaces (docs/design/item-tracking.md).
//
// Pure decisions (a UI_PURE_CORES member): no DOM, no host reads. The
// item_history_dialog.ts affordance helpers are the thin DOM consumer.

import { isLoadableItemProvenance, publicProvenanceView } from '../sim/item_provenance';
import type { ItemInstancePayload, ItemProvenance } from '../sim/types';

/** Whose copy the viewer is looking at: their own (`self`), or one another
 *  player or the guild holds (`other`). */
export type ItemHistoryHolder = 'self' | 'other';

/** The record the Item history dialog may render for this copy, or null when
 *  the copy is untracked (no provenance: nothing to offer). A copy the viewer
 *  does not hold reads the public projection, a fresh copy with no `byId` on
 *  the origin or on any hand. */
export function itemHistoryProvenanceFor(
  instance: ItemInstancePayload | undefined,
  holder: ItemHistoryHolder,
): ItemProvenance | null {
  const provenance = instance?.provenance;
  // A counterparty's payload arrives off the wire: judge it by the load
  // bound before projecting, so a malformed record offers no door rather than
  // throwing mid-render (the market and inspect decoders guard the same way).
  if (provenance === undefined || !isLoadableItemProvenance(provenance)) return null;
  return holder === 'self' ? provenance : publicProvenanceView(provenance);
}

/** The shape of the item surface the history door sits on. A `listRow` (a
 *  trade offer row) has room beside it and may not take focus itself (the
 *  counterparty's rows are plain blocks), so its visible button is the
 *  keyboard door and shows on every layout. A `gridCell` (a bank socket) is a
 *  focusable button whose right-click and Context Menu key already open the
 *  history on desktop, and a second control per socket would break the grid,
 *  so its visible button shows on touch layouts only, which have no
 *  right-click (the material sources cell rule). */
export type ItemHistorySurface = 'listRow' | 'gridCell';

/** Whether the visible "Item history" button renders beside the row/cell. */
export function itemHistoryButtonShown(surface: ItemHistorySurface, touchLayout: boolean): boolean {
  return surface === 'listRow' || touchLayout;
}

/** Whether a `contextmenu` event on the row opens the history. A touch or pen
 *  long-press is the row's tooltip peek, never this door; on the touch layout
 *  only a real mouse right-click counts. A keyboard Context Menu key (no
 *  pointer type) opens it on desktop. */
export function contextMenuOpensItemHistory(
  pointerType: string | undefined,
  touchLayout: boolean,
): boolean {
  if (pointerType === 'touch' || pointerType === 'pen') return false;
  if (touchLayout && pointerType !== 'mouse') return false;
  return true;
}
