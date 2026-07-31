// Thin opener for a plain right-click menu on the HUD's ONE shared `#ctx-menu`
// box: a list of labelled rows, no portraits, icons or per-row state.
//
// The player context menu in hud.ts builds a rich menu into the same element;
// this is the small-menu path a sibling module can reach without importing Hud.
// It owns no element and no placement rules: Hud injects the shared box plus the
// three helpers that already seat and clamp every popup, so a menu opened here
// behaves exactly like the ones Hud opens (same clamp, same Esc/close
// dispatcher, same keyboard activation).

import { esc } from './esc';

export interface SimpleMenuItem {
  /** Stable id echoed back to `onSelect`; also the row's `data-act`. */
  act: string;
  /** Already-localized row text. */
  label: string;
}

export interface SimpleMenuDeps {
  /** The shared `#ctx-menu` element. */
  root(): HTMLElement;
  /**
   * Hud's popup seater (visual-space x/y, author-space reserves). `minLeft` /
   * `minTop` pin the seated box off the viewport edges; they are forwarded
   * rather than defaulted so this menu clamps like the other HUD menus that
   * pass them (the chat context menu uses the same 0 / 8).
   */
  place(
    el: HTMLElement,
    x: number,
    y: number,
    reserveRight: number,
    reserveBottom: number,
    minLeft?: number,
    minTop?: number,
  ): void;
  /** Hud's post-layout re-clamp. */
  keepOnScreen(el: HTMLElement): void;
  /** Hud's row binder: role/tabindex, click + Enter/Space, close-then-act. */
  bindActions(onActivate: (act: string) => void): void;
  isMobileLayout(): boolean;
}

/** Row heights used to RESERVE space before the box has been laid out. */
const ROW_H_DESKTOP = 28;
const ROW_H_MOBILE = 44;
const MENU_CHROME_H = 16;
const RESERVE_RIGHT = 170;
/** Edge pins, matching the chat context menu so every HUD menu seats alike. */
const MIN_LEFT = 0;
const MIN_TOP = 8;

/**
 * Paint `items` into the shared menu at a viewport point and wire their
 * activation. Reserving the height from the row COUNT (rather than measuring)
 * is what makes the very first open seat correctly: a fresh
 * display:none -> block box reports a stale rect.
 */
export function openSimpleMenu(
  items: readonly SimpleMenuItem[],
  x: number,
  y: number,
  onSelect: (act: string) => void,
  deps: SimpleMenuDeps,
): void {
  if (items.length === 0) return;
  const el = deps.root();
  el.innerHTML = items
    .map((item) => `<div class="ctx-item" data-act="${esc(item.act)}">${esc(item.label)}</div>`)
    .join('');
  el.style.display = 'block';
  const rowH = deps.isMobileLayout() ? ROW_H_MOBILE : ROW_H_DESKTOP;
  deps.place(el, x, y, RESERVE_RIGHT, MENU_CHROME_H + items.length * rowH, MIN_LEFT, MIN_TOP);
  deps.keepOnScreen(el);
  deps.bindActions(onSelect);
}
