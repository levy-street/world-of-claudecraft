// Thin DOM consumer for the vendor window.
//
// The consumer half of the pure-core + thin-consumer split: it paints
// #vendor-window from the structured VendorView + VendorSellRow[] (vendor_view.ts)
// and wires the buy / sell / buyback / close actions. It owns no state. The active
// tab is Hud-held (threaded in as `activeTab`), so a snapshot repaint never loses
// the tab and a fresh open resets it to Browse; the cross-window orchestration
// stays in Hud because it needs Hud's private state.
//
// The chrome comes from the shared window-frame builder (window_frame.ts): a
// titlebar with a close control, a Browse / Sell / Buyback tab rail, and a
// scrollable tab body. This matches the World Market's tabbed standalone feel
// (the maintainer's "make the traders work like the Merchant" ask), replacing the
// old flat goods + buyback list that force-docked Bags for selling. The frame is
// stamped cold at first open and reused on later repaints; only the tab body
// repaints per render. The body uses the AAA .list-rows / .item-cell grammar.

import { itemDisplayName } from './entity_i18n';
import { esc } from './esc';
import { formatMoney as formatLocalizedMoney, formatNumber, t } from './i18n';
import type { PainterHostPresentation } from './painter_host';
import type { VendorBuybackRow, VendorGoodsRow, VendorSellRow, VendorView } from './vendor_view';
import { applyActiveWindowTab, renderWindowFrame, type WindowFrameParts } from './window_frame';
import type { WindowFrameDescriptor } from './window_frame_view';

/** Which of the three vendor tabs the body currently paints. */
export type VendorTab = 'browse' | 'sell' | 'buyback';

// A closable, tabbed frame with no footer: the Browse (buy), Sell, and Buyback
// tabs each own the one scrollable body. Browse and Sell reuse the World Market's
// already-translated tab labels (the same words); the third tab is the vendor's
// own Buyback (shops buy back, they do not "Collect" like the Market). The bulk
// sell-junk action lives inside the Sell tab body, so no sticky footer is needed.
const VENDOR_FRAME: WindowFrameDescriptor = {
  id: 'vendor-window',
  titleKey: 'itemUi.vendor.goodsTitle',
  closeLabelKey: 'itemUi.vendor.close',
  tabs: [
    { id: 'browse', labelKey: 'itemUi.market.browse' },
    { id: 'sell', labelKey: 'itemUi.market.sell' },
    { id: 'buyback', labelKey: 'itemUi.vendor.buybackTitle' },
  ],
};

/**
 * Hud-supplied glue. The icon/money/tooltip painters are the shared
 * PainterHostPresentation bag (Hud builds it once and hands it to every window
 * that renders item rows); this composes that base and adds the vendor-specific
 * tooltip teardown, the buy/buyback/sell/sell-junk/close dispatch, the tab-change
 * callback, and the sell-junk state. The module never reaches into Hud directly.
 */
export interface VendorWindowDeps extends PainterHostPresentation {
  hideTooltip(): void;
  onBuy(itemId: string): void;
  onBuyBack(itemId: string): void;
  /** Sell the whole stack of one bag item (dispatches the sim sellItem command). */
  onSellItem(itemId: string, count: number): void;
  /**
   * Shared modal confirm (the Hud's confirmDialog). Gates selling an
   * instance-bearing (rolled-stat) row, whose rolled stats buyback cannot restore;
   * `onOk` runs only if the player accepts.
   */
  confirmDialog(
    title: string,
    body: string,
    okText: string,
    cancelText: string,
    onOk: () => void,
  ): void;
  onSellJunk(): void;
  /** Fired with the id fragment of the tab the player activated. */
  onTabChange(tab: VendorTab): void;
  onClose(): void;
  sellJunk: {
    enabled: boolean;
    proceeds: number;
  };
}

/**
 * Stamp the shared window frame cold at first open, then reuse it.
 *
 * The frame mounts on an INNER container, never on the shared #vendor-window
 * root: the Heroic Quartermaster is a second tenant of that root and paints it
 * with innerHTML only, so builder classes / role / aria set on the root itself
 * would leak into the untouched heroic window. With the inner mount the root
 * stays byte-identical to its pre-build state under every sequence, including
 * the direct copper-to-heroic handoff (openHeroicVendor takes the container
 * without ever calling closeVendor), and heroic's innerHTML wipe destroys the
 * frame naturally. An intact mounted frame (its body present) is the reuse
 * marker; anything else (first open, or heroic content) forces a cold rebuild.
 */
function ensureFrame(
  el: HTMLElement,
  deps: VendorWindowDeps,
  activeTab: VendorTab,
): WindowFrameParts {
  const mounted = el.querySelector<HTMLElement>(':scope > .window-frame');
  const body = mounted?.querySelector<HTMLElement>('.window-body');
  if (mounted && body) {
    return {
      root: mounted,
      body,
      footer: mounted.querySelector<HTMLElement>('.window-footer'),
      tabButtons: Array.from(mounted.querySelectorAll<HTMLButtonElement>('[data-window-tab]')),
    };
  }
  const mount = document.createElement('div');
  const parts = renderWindowFrame(
    mount,
    VENDOR_FRAME,
    { onClose: () => deps.onClose(), onTabChange: (tab) => deps.onTabChange(tab as VendorTab) },
    activeTab,
  );
  el.replaceChildren(mount);
  return parts;
}

/**
 * Force the tab rail + body to reflect `activeTab` (roving tabindex, aria-selected,
 * aria-controls on the selected tab only, and the body's tabpanel id + labelling).
 * The frame's own click handler already does this on a click, but a Hud-driven
 * repaint (a fresh open resets to Browse, a snapshot repaint keeps the tab) must
 * re-affirm it against the reused frame; both route through the one shared helper.
 */
function syncActiveTab(parts: WindowFrameParts, activeTab: VendorTab): void {
  applyActiveWindowTab(parts.tabButtons, parts.body, activeTab);
}

/** The rarity-bordered item cell: icon plus a count in the corner when stacked. */
function iconCellHtml(item: VendorGoodsRow['item'], count: number, deps: VendorWindowDeps): string {
  const quality = item.quality ?? 'common';
  const corner =
    count > 1
      ? `<span class="item-cell-count">${esc(formatNumber(count, { maximumFractionDigits: 0 }))}</span>`
      : '';
  return `<span class="item-cell" data-quality="${esc(quality)}">${deps.itemIcon(item)}${corner}</span>`;
}

/** The stack-count aria fragment (" (5)") for a stacked row, empty otherwise. */
function stackAria(count: number): string {
  return count > 1
    ? ` ${t('itemUi.bags.stackCount', { count: formatNumber(count, { maximumFractionDigits: 0 }) })}`
    : '';
}

function goodsRow(g: VendorGoodsRow, deps: VendorWindowDeps): HTMLButtonElement {
  const row = document.createElement('button');
  row.type = 'button';
  row.className = 'vendor-row';
  const price = formatLocalizedMoney(g.price);
  const itemName = itemDisplayName(g.item);
  // The visible count lives in the cell corner; the aria label keeps the stack
  // wording for screen readers.
  row.setAttribute(
    'aria-label',
    t('itemUi.vendor.buyAria', { item: `${itemName}${stackAria(g.quantity)}`, price }),
  );
  row.innerHTML =
    `${iconCellHtml(g.item, g.quantity, deps)}` +
    `<span class="vendor-row-name">${esc(itemName)}</span>` +
    `<span class="vendor-row-price">${deps.moneyHtml(g.price)}</span>`;
  row.addEventListener('click', () => deps.onBuy(g.itemId));
  deps.attachTooltip(
    row,
    () =>
      `${deps.itemTooltip(g.item)}<div class="tt-sub">${esc(t('itemUi.tooltip.clickBuy'))}</div>`,
  );
  return row;
}

function sellRow(s: VendorSellRow, deps: VendorWindowDeps): HTMLButtonElement {
  const row = document.createElement('button');
  row.type = 'button';
  row.className = 'vendor-row';
  const price = formatLocalizedMoney(s.total);
  const itemName = itemDisplayName(s.item);
  row.setAttribute(
    'aria-label',
    t('itemUi.vendor.sellItemAria', { item: `${itemName}${stackAria(s.count)}`, price }),
  );
  row.innerHTML =
    `${iconCellHtml(s.item, s.count, deps)}` +
    `<span class="vendor-row-name">${esc(itemName)}</span>` +
    `<span class="vendor-row-price">${deps.moneyHtml(s.total)}</span>`;
  // The whole-stack sell: the classic right-click-sells-the-stack dispatch, and the
  // total shown is exactly what it pays out. Routes through the same sim sellItem
  // command the bags flow uses. An instance-bearing (rolled-stat) row is gated
  // behind a confirm first, because the sim sells by itemId and buyback restores
  // only a BASE copy, so this one click would otherwise silently lose the rolled
  // stats. Plain fungible rows sell with no friction.
  const sell = () => deps.onSellItem(s.itemId, s.count);
  row.addEventListener('click', () => {
    if (s.instanced) {
      deps.confirmDialog(
        t('itemUi.vendor.sellQuantityTitle', { item: itemName }),
        t('itemUi.vendor.sellRolledWarning'),
        t('itemUi.vendor.sellQuantityConfirm'),
        t('itemUi.vendor.sellQuantityCancel'),
        sell,
      );
    } else {
      sell();
    }
  });
  deps.attachTooltip(row, () => deps.itemTooltip(s.item));
  return row;
}

function buybackRow(b: VendorBuybackRow, deps: VendorWindowDeps): HTMLButtonElement {
  const row = document.createElement('button');
  row.type = 'button';
  row.className = 'vendor-row';
  const price = formatLocalizedMoney(b.price);
  const itemName = itemDisplayName(b.item);
  row.setAttribute('aria-label', t('itemUi.vendor.buybackAria', { item: itemName, price }));
  row.innerHTML =
    `${iconCellHtml(b.item, b.count, deps)}` +
    `<span class="vendor-row-name">${esc(itemName)}</span>` +
    `<span class="vendor-row-price">${deps.moneyHtml(b.price)}</span>`;
  row.addEventListener('click', () => deps.onBuyBack(b.itemId));
  deps.attachTooltip(
    row,
    () =>
      `${deps.itemTooltip(b.item)}<div class="tt-sub">${esc(t('itemUi.tooltip.clickBuyback'))}</div>`,
  );
  return row;
}

function emptyState(text: string): HTMLElement {
  const div = document.createElement('div');
  div.className = 'empty-state';
  div.textContent = text;
  return div;
}

function listRows(): HTMLElement {
  const list = document.createElement('div');
  list.className = 'list-rows';
  return list;
}

/** The bulk sell-junk action: sell every gray item, showing the proceeds money. */
function sellJunkButton(deps: VendorWindowDeps): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn is-primary vendor-sell';
  btn.disabled = !deps.sellJunk.enabled;
  btn.innerHTML =
    `<span class="vendor-row-name">${esc(t('itemUi.vendor.sellJunk'))}</span>` +
    (deps.sellJunk.enabled
      ? `<span class="vendor-row-price">${deps.moneyHtml(deps.sellJunk.proceeds)}</span>`
      : '');
  btn.setAttribute(
    'aria-label',
    deps.sellJunk.enabled
      ? t('itemUi.vendor.sellJunkAria', { price: formatLocalizedMoney(deps.sellJunk.proceeds) })
      : t('itemUi.vendor.sellJunk'),
  );
  btn.addEventListener('click', () => deps.onSellJunk());
  deps.attachTooltip(
    btn,
    () => `<div class="tt-sub">${esc(t('itemUi.vendor.sellJunkHint'))}</div>`,
  );
  return btn;
}

/** Paint the Browse tab: the vendor's goods (buy), or an empty-stock state. */
function paintBrowse(body: HTMLElement, view: VendorView, deps: VendorWindowDeps): void {
  if (view.goods.length === 0) {
    body.appendChild(emptyState(t('itemUi.vendor.buybackEmpty')));
    return;
  }
  const list = listRows();
  for (const g of view.goods) list.appendChild(goodsRow(g, deps));
  body.appendChild(list);
}

/** Paint the Sell tab: the bulk sell-junk action then the sellable bag rows. */
function paintSell(body: HTMLElement, sellRows: VendorSellRow[], deps: VendorWindowDeps): void {
  if (sellRows.length === 0) {
    // Nothing gray or otherwise sellable is in the bags, so sell-junk is dead too:
    // show the shared "No items" empty state alone.
    body.appendChild(emptyState(t('itemUi.vendor.buybackEmpty')));
    return;
  }
  body.appendChild(sellJunkButton(deps));
  const list = listRows();
  for (const s of sellRows) list.appendChild(sellRow(s, deps));
  body.appendChild(list);
}

/** Paint the Buyback tab: the redeemable buyback slots, or an empty state. */
function paintBuyback(body: HTMLElement, view: VendorView, deps: VendorWindowDeps): void {
  if (view.buyback.length === 0) {
    body.appendChild(emptyState(t('itemUi.vendor.buybackEmpty')));
    return;
  }
  const list = listRows();
  for (const b of view.buyback) list.appendChild(buybackRow(b, deps));
  body.appendChild(list);
}

/** Paint the vendor panel from a prepared view + sellable rows + the active tab. */
export function renderVendorWindow(
  el: HTMLElement,
  vendorName: string,
  view: VendorView,
  sellRows: VendorSellRow[],
  activeTab: VendorTab,
  deps: VendorWindowDeps,
): void {
  // The rebuild replaces the hovered row (its mouseleave never fires) and can
  // collapse the scrolled list; drop the tooltip and restore the scroll. On the
  // desktop flex model the ROOT never scrolls (the frame's .window-body does),
  // so capture both: the root covers the touch dock path (overflow-y on the
  // root), the body covers desktop, and whichever did not scroll restores 0.
  deps.hideTooltip();
  const scrollTop = el.scrollTop;
  const bodyScrollTop = el.querySelector<HTMLElement>('.window-body')?.scrollTop ?? 0;

  const parts = ensureFrame(el, deps, activeTab);
  const { body } = parts;
  syncActiveTab(parts, activeTab);

  // The frame builder resolves the title key WITHOUT interpolation values, but
  // the vendor title carries the merchant name ({name}: Goods); set it here
  // (textContent is auto-escaped) reusing the same key with the value.
  const titleEl = el.querySelector<HTMLElement>('.window-title');
  if (titleEl) titleEl.textContent = t('itemUi.vendor.goodsTitle', { name: vendorName });

  body.innerHTML = '';
  if (activeTab === 'sell') paintSell(body, sellRows, deps);
  else if (activeTab === 'buyback') paintBuyback(body, view, deps);
  else paintBrowse(body, view, deps);

  // State-driven display, never a baked inline value: body.mobile-touch can flip
  // while the vendor is open (Interface Mode in Options opens WITHOUT closing the
  // vendor; foldable/tablet rotation crosses the touch media query), and an inline
  // display would go stale because nothing re-renders on that flip. The painter
  // only CLEARS the stale inline 'none' a close left behind; the stylesheet owns
  // the value: #vendor-window:has(> .window-frame) shows the standalone float as a
  // flex column (components.css, so the grammar bounds the frame and the body
  // scrolls internally). closeVendor's inline display:none still wins over it while
  // closed, and the heroic tenant has no mounted frame, so the rule never matches
  // it (the shared-root pristine invariant holds: the style attribute stays the
  // painter's only root touch).
  el.style.removeProperty('display');
  el.scrollTop = scrollTop;
  parts.body.scrollTop = bodyScrollTop;
}
