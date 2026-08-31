// Thin DOM consumer for the Crucible Quartermaster window.
//
// The consumer half of the pure-core + thin-consumer split (reference
// heroic_vendor_window.ts): paints the sigil-redemption shop from the
// structured CrucibleShopView and reports buy/close clicks back through the
// injected callbacks. Reuses the vendor window's CSS classes (.vendor-item,
// .vi-name, .vi-price) so the shop reads as the same window family. It owns
// no state.

import { markDialogRoot } from '../../dialog_root';
import { itemDisplayName } from '../../entity_i18n';
import { esc } from '../../esc';
import { focusedWithin, restoreFirstEnabled } from '../../focus_restore';
import { formatList, formatNumber, t } from '../../i18n';
import type { PainterHostPresentation } from '../../painter_host';
import { svgIcon } from '../../ui_icons';
import type { CrucibleShopView } from './crucible_vendor_view';

export interface CrucibleVendorWindowDeps extends PainterHostPresentation {
  hideTooltip(): void;
  onBuy(itemId: string): void;
  onClose(): void;
}

/** Paint the Crucible Quartermaster panel from a prepared view. */
export function renderCrucibleVendorWindow(
  el: HTMLElement,
  vendorName: string,
  view: CrucibleShopView,
  deps: CrucibleVendorWindowDeps,
): void {
  // The rebuild replaces the hovered row (its mouseleave never fires) and
  // collapses the scrolled list; drop the tooltip and restore the scroll.
  deps.hideTooltip();
  // Carry keyboard focus across the wipe per the focus-across-a-REBUILD
  // contract (the heroic_vendor_window idiom): the exact tile when it survived
  // enabled, else outward grid neighbors, else the close button.
  const focused = focusedWithin(el);
  const focusKey = focused?.dataset.focusKey ?? null;
  const focusedSlot = focused?.classList.contains('vendor-item')
    ? [...el.querySelectorAll<HTMLButtonElement>('button.vendor-item')].indexOf(
        focused as HTMLButtonElement,
      )
    : -1;
  const scrollTop = el.scrollTop;
  markDialogRoot(el, { label: t('itemUi.vendor.goodsTitle', { name: vendorName }) });
  el.innerHTML = `<div class="panel-title"><span>${esc(t('itemUi.vendor.goodsTitle', { name: vendorName }))}</span><button type="button" class="x-btn" data-close data-focus-key="close" aria-label="${esc(t('itemUi.vendor.close'))}">${svgIcon('close')}</button></div>`;

  // The viewer's sigil balances, one line above the grid (the marks-balance
  // slot of the heroic shop; sigils are several currencies, so it lists each
  // held kind with its count, or the explicit none line).
  const balance = document.createElement('div');
  balance.className = 'vendor-section-title';
  balance.textContent =
    view.balances.length === 0
      ? t('crucibleShop.noSigils')
      : t('crucibleShop.balance', {
          // Each entry composes through its own catalog key and the join is
          // formatList (Intl.ListFormat), so no English quantity order or
          // list punctuation is hardcoded here.
          list: formatList(
            view.balances.map((b) =>
              t('crucibleShop.balanceEntry', {
                name: itemDisplayName(b.sigil),
                count: formatNumber(b.count, { maximumFractionDigits: 0 }),
              }),
            ),
          ),
        });
  el.appendChild(balance);

  const goodsGrid = document.createElement('div');
  goodsGrid.className = 'vendor-goods-grid';
  for (const { itemId, item, sigil, affordable } of view.rows) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'vendor-item';
    row.disabled = !affordable;
    row.dataset.focusKey = `buy:${itemId}`;
    const itemName = itemDisplayName(item);
    const sigilName = itemDisplayName(sigil);
    row.setAttribute('aria-label', t('crucibleShop.buyAria', { item: itemName, sigil: sigilName }));
    row.innerHTML = `${deps.itemIcon(item)}<span class="vi-name">${esc(itemName)}</span><span class="vi-price${affordable ? '' : ' unaffordable'}">${esc(t('crucibleShop.price', { sigil: sigilName }))}</span>`;
    row.addEventListener('click', () => deps.onBuy(itemId));
    deps.attachTooltip(
      row,
      () =>
        `${deps.itemTooltip(item)}<div class="tt-sub">${esc(t('itemUi.tooltip.clickBuy'))}</div>`,
    );
    goodsGrid.appendChild(row);
  }
  if (view.rows.length > 0) {
    el.appendChild(goodsGrid);
  } else {
    // Unreachable while every class has sets, but a silently empty panel is
    // the worse failure mode than an explicit line.
    const empty = document.createElement('div');
    empty.className = 'vendor-section-title';
    empty.textContent = t('crucibleShop.empty');
    el.appendChild(empty);
  }

  el.querySelector('[data-close]')?.addEventListener('click', () => deps.onClose());
  el.style.display = 'block';
  el.scrollTop = scrollTop;
  // Restore focus LAST (see heroic_vendor_window: focus-scroll wins for
  // keyboard players, raw scroll restore for mouse users).
  if (focusKey) {
    const keyed = [...el.querySelectorAll<HTMLButtonElement>('[data-focus-key]')];
    const exact = keyed.find((b) => b.dataset.focusKey === focusKey);
    const ladder = [...el.querySelectorAll<HTMLButtonElement>('button.vendor-item')];
    const slot = focusedSlot >= 0 ? Math.min(focusedSlot, ladder.length - 1) : -1;
    const neighbors: (HTMLButtonElement | undefined)[] = [];
    if (slot >= 0) {
      for (let step = 0; step < ladder.length; step++) {
        if (ladder[slot + step]) neighbors.push(ladder[slot + step]);
        if (step > 0 && ladder[slot - step]) neighbors.push(ladder[slot - step]);
      }
    }
    restoreFirstEnabled([exact, ...neighbors, keyed.find((b) => b.dataset.focusKey === 'close')]);
  }
}
