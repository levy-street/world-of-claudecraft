export interface ItemChatLinkClick {
  shiftKey: boolean;
  preventDefault(): void;
  stopPropagation(): void;
}

export function maybeInsertItemChatLink(
  ev: ItemChatLinkClick,
  itemId: string,
  insertItemChatLink: (itemId: string) => void,
): boolean {
  if (!ev.shiftKey || !itemId) return false;
  ev.preventDefault();
  ev.stopPropagation();
  insertItemChatLink(itemId);
  return true;
}
