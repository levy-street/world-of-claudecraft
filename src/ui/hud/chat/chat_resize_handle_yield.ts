// The touch chat resize handle steps aside while a #ctx-menu popup is open.
//
// The handle is a BODY-level element at z-index 300; #ctx-menu lives inside
// #ui, whose own stacking context (z-index 10) sits below it, so no z-index on
// the menu can lift it over the handle. On a short phone (844x390) the chat
// "+" Add channel menu, clamped to the viewport, ran under the handle and the
// handle covered its last row (Cancel) and swallowed the tap. The popup is the
// active interaction and a tap outside it closes it, so while it is shown the
// handle carries CHAT_RESIZE_YIELD_CLASS (hud.mobile.css hides it) and gets it
// back the moment the menu closes.
//
// Every ctx-menu open path shows the menu with an inline display write and
// closeContextMenu hides it with display:none, so the inline display is the
// one signal all of them share. A class on the handle (never a `:has()` on
// body, see src/styles/CLAUDE.md) keeps the invalidation to this one element.

export const CHAT_RESIZE_YIELD_CLASS = 'ctx-menu-yield';

interface StyledElement {
  readonly style: { readonly display: string };
}

interface ClassedElement {
  readonly classList: {
    contains(token: string): boolean;
    toggle(token: string, force?: boolean): boolean;
  };
}

/** True while the context menu is shown (an inline display other than none). */
export function isContextMenuShown(menu: StyledElement): boolean {
  const display = menu.style.display;
  return display !== '' && display !== 'none';
}

/** Mirrors the menu's shown state onto the handle; writes only on a change. */
export function syncResizeHandleYield(menu: StyledElement, handle: ClassedElement): void {
  const shown = isContextMenuShown(menu);
  if (handle.classList.contains(CHAT_RESIZE_YIELD_CLASS) !== shown) {
    handle.classList.toggle(CHAT_RESIZE_YIELD_CLASS, shown);
  }
}

type ObserverCtor = new (
  callback: () => void,
) => { observe(target: never, options: { attributes: boolean; attributeFilter: string[] }): void };

/** Keeps the handle in sync with the menu's inline style for the page's life. */
export function bindResizeHandleYield<M extends StyledElement, H extends ClassedElement>(
  menu: M,
  handle: H,
  Observer: ObserverCtor,
): void {
  syncResizeHandleYield(menu, handle);
  new Observer(() => syncResizeHandleYield(menu, handle)).observe(menu as never, {
    attributes: true,
    attributeFilter: ['style'],
  });
}
