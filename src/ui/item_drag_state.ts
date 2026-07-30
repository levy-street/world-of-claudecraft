// The one live "what is the player dragging" handle, shared by the bags grid (the
// source), the character window's paperdoll sockets (the equip drop target) and the
// world canvas (the destroy drop target).
//
// It exists because a DataTransfer payload is unreadable during dragover on every
// browser (only on drop), so a drop target cannot decide whether to accept, or how
// to highlight, from the event alone; and because the touch drag has no DataTransfer
// at all. Both gestures therefore publish the dragged stack HERE on pick-up and
// clear it on release, and every drop target reads it. Hud owns one instance and
// hands it to the windows through their deps, so no cross-window drag state accretes
// on the coordinator (the dragUnequipSlot precedent it replaces for bag items).

/** The bag stack currently being dragged: the item id plus the stack size the
 *  destroy prompt pre-fills. `count` is the stack the player picked up, not the
 *  live inventory count (the prompt re-clamps at submit). */
export interface BagItemDrag {
  itemId: string;
  count: number;
  /** The stack's inventory index at pick-up, or null when the grid is not showing
   *  the raw array order (a sorted/filtered view names no position, so the stack
   *  cannot be reordered from there). It is what the manual-order move command
   *  sends as `from`; the sim re-validates it. */
  index: number | null;
}

export class ItemDragState {
  private current: BagItemDrag | null = null;

  /** Pick up a bag stack (dragstart, or the touch hold arming). */
  begin(drag: BagItemDrag): void {
    this.current = { itemId: drag.itemId, count: drag.count, index: drag.index };
  }

  /** The stack in flight, or null when nothing is being dragged. */
  get(): BagItemDrag | null {
    return this.current;
  }

  /** Release (dragend / pointerup / pointercancel). Idempotent: every teardown
   *  path calls it, including the ones that already consumed the payload. */
  end(): void {
    this.current = null;
  }
}
