type ClearContextMenuEvent = Pick<MouseEvent, 'shiftKey' | 'preventDefault'>;
type ClearKeyEvent = Pick<KeyboardEvent, 'shiftKey' | 'key' | 'preventDefault' | 'stopPropagation'>;

export function handleShiftClearContextMenu(
  event: ClearContextMenuEvent,
  clear: () => void,
): boolean {
  if (!event.shiftKey) return false;
  event.preventDefault();
  clear();
  return true;
}

export function handleShiftClearKeydown(event: ClearKeyEvent, clear: () => void): boolean {
  if (!event.shiftKey || (event.key !== 'Delete' && event.key !== 'Backspace')) return false;
  event.preventDefault();
  event.stopPropagation();
  clear();
  return true;
}

/**
 * Bind both desktop clear affordances on one action-bar slot button. The two
 * handlers above own the rules; this is the one place that knows a slot offers
 * BOTH of them, so a surface cannot ship half the pair (the touch bar editor's
 * Clear control is the third entry point, and it routes to the same
 * clearHotbarSlot plus saveSlotMap path).
 */
export function bindShiftClear(btn: HTMLElement, clear: () => void): void {
  btn.addEventListener('contextmenu', (e) => {
    handleShiftClearContextMenu(e as MouseEvent, clear);
  });
  btn.addEventListener('keydown', (e) => {
    handleShiftClearKeydown(e as KeyboardEvent, clear);
  });
}
