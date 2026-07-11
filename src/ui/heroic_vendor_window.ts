// Thin DOM consumer for the Heroic Quartermaster window.
//
// The consumer half of the pure-core + thin-consumer split (reference
// vendor_window.ts): paints the marks-currency shop from the structured
// HeroicShopView and reports buy/close clicks back through the injected callbacks.
// It owns no state.
//
// The chrome comes from the shared window-frame builder (window_frame.ts), the
// builder migration the copper vendor pilot deferred. #vendor-window is shared
// with the copper vendor, whose vendor_window.ts reuses a DIRECT-CHILD
// `#vendor-window > .window-frame` (its ensureFrame reuse marker). So the heroic
// frame mounts one level deeper, inside a `.heroic-shop` wrapper: copper's
// `:scope > .window-frame` never matches a heroic-owned frame, so a copper reopen
// after a heroic paint always cold-rebuilds its own frame (never reuses heroic's,
// which would keep heroic's close wiring and lack the sell-junk footer). Heroic's
// own reuse marker is symmetric (`:scope > .heroic-shop` with a live body), and
// its wrapper wipe (replaceChildren) destroys a copper frame on the reverse
// handoff. The shared #vendor-window root stays a plain .window.panel under every
// sequence (its chrome neutralized in CSS via :has(> .heroic-shop)), so the
// pristine-root invariant vendor_window.test.ts pins is preserved. The body uses
// the AAA .list-rows / .vendor-row grammar (the legacy .vendor-item markup is
// retired here; crafting / vale-cup still consume it).

import { itemDisplayName } from './entity_i18n';
import { esc } from './esc';
import type { HeroicShopView } from './heroic_vendor_view';
import { formatNumber, t } from './i18n';
import type { PainterHostPresentation } from './painter_host';
import { renderWindowFrame } from './window_frame';
import type { WindowFrameDescriptor } from './window_frame_view';

export interface HeroicVendorWindowDeps extends PainterHostPresentation {
  hideTooltip(): void;
  onBuy(itemId: string): void;
  onClose(): void;
}

// A closable, tab-less, footer-less frame: the marks balance and jewelry offers
// render as one scrollable body. The title carries the merchant name (set on the
// node, since the builder cannot interpolate it); keys are reused from the vendor
// catalog so the shop reads as the same window family as the copper vendor.
const HEROIC_FRAME: WindowFrameDescriptor = {
  id: 'vendor-window',
  titleKey: 'itemUi.vendor.goodsTitle',
  closeLabelKey: 'itemUi.vendor.close',
};

/** The live nodes a heroic render paints into: the frame (for its title) + body. */
interface HeroicFrameParts {
  frame: HTMLElement;
  body: HTMLElement;
}

/**
 * Mount (or reuse) the heroic frame inside a `.heroic-shop` wrapper.
 *
 * The extra wrapper is load-bearing: it keeps the frame OUT of copper's direct-
 * child reuse path (see the module header), so the two tenants never share a
 * frame instance. An intact wrapper with a live body is reused; anything else
 * (first open, or a copper frame left in the root) rebuilds cold and wipes it.
 */
function ensureHeroicFrame(el: HTMLElement, onClose: () => void): HeroicFrameParts {
  const wrapper = el.querySelector<HTMLElement>(':scope > .heroic-shop');
  const frame = wrapper?.querySelector<HTMLElement>(':scope > .window-frame');
  const body = frame?.querySelector<HTMLElement>('.window-body');
  if (wrapper && frame && body) return { frame, body };
  const newWrapper = document.createElement('div');
  newWrapper.className = 'heroic-shop';
  const mount = document.createElement('div');
  const parts = renderWindowFrame(mount, HEROIC_FRAME, { onClose });
  newWrapper.appendChild(mount);
  el.replaceChildren(newWrapper);
  return { frame: parts.root, body: parts.body };
}

/** The rarity-bordered item cell (jewelry never stacks, so no count corner). */
function iconCellHtml(item: HeroicShopView['rows'][number]['item'], deps: HeroicVendorWindowDeps) {
  const quality = item.quality ?? 'common';
  return `<span class="item-cell" data-quality="${esc(quality)}">${deps.itemIcon(item)}</span>`;
}

/** Paint the Heroic Quartermaster panel from a prepared view. */
export function renderHeroicVendorWindow(
  el: HTMLElement,
  vendorName: string,
  view: HeroicShopView,
  deps: HeroicVendorWindowDeps,
): void {
  // The rebuild replaces the hovered row (its mouseleave never fires) and
  // collapses the scrolled list; drop the tooltip and restore the scroll.
  deps.hideTooltip();
  const scrollTop = el.scrollTop;
  const { frame, body } = ensureHeroicFrame(el, () => deps.onClose());

  // The builder resolves the plain title key; the merchant name is set on the
  // node (textContent auto-escapes), reusing the same {name} key as the vendor.
  const titleEl = frame.querySelector<HTMLElement>('.window-title');
  if (titleEl) titleEl.textContent = t('itemUi.vendor.goodsTitle', { name: vendorName });

  body.innerHTML = '';

  const balance = document.createElement('div');
  balance.className = 'vendor-section';
  balance.textContent = t('heroicShop.balance', {
    count: formatNumber(view.balance, { maximumFractionDigits: 0 }),
  });
  body.appendChild(balance);

  const list = document.createElement('div');
  list.className = 'list-rows';
  for (const { itemId, item, marks, affordable } of view.rows) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'vendor-row';
    row.disabled = !affordable;
    const itemName = itemDisplayName(item);
    const marksLabel = formatNumber(marks, { maximumFractionDigits: 0 });
    row.setAttribute('aria-label', t('heroicShop.buyAria', { item: itemName, marks: marksLabel }));
    row.innerHTML =
      `${iconCellHtml(item, deps)}` +
      `<span class="vendor-row-name">${esc(itemName)}</span>` +
      `<span class="vendor-row-price${affordable ? '' : ' unaffordable'}">${esc(t('delveUi.shop.price', { marks: marksLabel }))}</span>`;
    row.addEventListener('click', () => deps.onBuy(itemId));
    deps.attachTooltip(
      row,
      () =>
        `${deps.itemTooltip(item)}<div class="tt-sub">${esc(t('itemUi.tooltip.clickBuy'))}</div>`,
    );
    list.appendChild(row);
  }
  body.appendChild(list);

  el.style.display = 'block';
  el.scrollTop = scrollTop;
}
