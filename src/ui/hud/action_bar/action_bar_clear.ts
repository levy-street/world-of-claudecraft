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
