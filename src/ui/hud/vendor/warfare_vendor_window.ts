// Thin DOM consumer for the WARFARE quartermaster's shop window.
//
// The consumer half of the pure-core + thin-consumer split (reference
// heroic_vendor_window.ts): paints #warfare-window from the sectioned
// WarfareShopView and reports buy/close clicks back through the injected
// callbacks. It owns no state and decides nothing; the purchase resolves
// server-side.
//
// Family reuse is deliberate, exactly as the Heroic Marks shop reuses it: the
// goods grid (.vendor-goods-grid), the tile (.vendor-item), the name and price
// cells (.vi-name / .vi-sub / .vi-price), the section title
// (.vendor-section-title) and the honor price / balance classes
// (.warfare-price / .warfare-balance) all already exist, so the shop reads as
// the same window family. Only what SECTIONING genuinely needs is new.
//
// WHAT THIS WINDOW DELIBERATELY DOES NOT SHOW, so it does not get added back:
// the set bonus text, and any owned-count or "N more for the next bonus" line.
// Both were here and both were cut as more than a buy list needs to say. The
// bonuses live in the ITEM TOOLTIP, where every raid tier set already shows them
// through the shared itemSetBlock path, lit when a threshold is met and greyed
// otherwise, so repeating all three per family here was duplicating a surface the
// player already reads. What survives is what a purchase decision actually needs:
// the family grouping, the price, and the per-tile Owned marker, which is not
// progress narration but the only thing standing between a mis-tap and a second
// copy of a soulbound piece that carries no refund and no sell value.
//
// The view core still exposes tiers / ownedPieces / totalPieces / nextTier. They
// are honest data and a future caller may want them; this painter simply renders
// none of it.

import { markDialogRoot } from '../../dialog_root';
import { itemDisplayName, tEntity } from '../../entity_i18n';
import { esc } from '../../esc';
import { focusedWithin, restoreFirstEnabled } from '../../focus_restore';
import { formatNumber, t } from '../../i18n';
import type { PainterHostPresentation } from '../../painter_host';
import { svgIcon } from '../../ui_icons';
import type { WarfareShopOffer, WarfareShopSection, WarfareShopView } from './warfare_vendor_view';

export interface WarfareVendorWindowDeps extends PainterHostPresentation {
  hideTooltip(): void;
  /** Reports the click only. The confirm dialog and the buy command both live on
   *  the coordinator, so the command can fire ONLY from the confirm callback
   *  (honor purchases record no buyback, so a mis-tap is unrefundable). */
  onBuy(itemId: string): void;
  onClose(): void;
}

function honorText(amount: number): string {
  return t('hudChrome.warfare.honorAmount', {
    amount: formatNumber(amount, { maximumFractionDigits: 0 }),
  });
}

function count(value: number): string {
  return formatNumber(value, { maximumFractionDigits: 0 });
}

function sectionTitleText(section: WarfareShopSection): string {
  if (section.kind === 'set') {
    return tEntity({ kind: 'itemSet', id: section.setId, field: 'name' });
  }
  return section.kind === 'jewelry'
    ? t('hudChrome.warfareShop.jewelry')
    : t('hudChrome.warfareShop.weapons');
}

function appendOfferTile(
  grid: HTMLElement,
  section: WarfareShopSection,
  offer: WarfareShopOffer,
  deps: WarfareVendorWindowDeps,
): void {
  const { itemId, item, honor, affordable, owned } = offer;
  const tile = document.createElement('button');
  tile.type = 'button';
  tile.className = owned ? 'vendor-item warfare-owned' : 'vendor-item';
  tile.disabled = !affordable;
  // Keyed on the SECTION plus the item id so the restore ladder can never land
  // on a same-named tile in another section (the sectioned window's version of
  // the heroic shop's one-tile-per-item identity).
  tile.dataset.focusKey = `buy:${section.key}:${itemId}`;
  const itemName = itemDisplayName(item);
  const price = honorText(honor);
  // An aria-label REPLACES the button's content as its accessible name, so the
  // owned marker folds into the name itself rather than being announced twice
  // or not at all. One combined key, never two concatenated t() results.
  tile.setAttribute(
    'aria-label',
    owned
      ? t('hudChrome.warfareShop.buyOwnedAria', { item: itemName, honor: price })
      : t('hudChrome.warfareShop.buyAria', { item: itemName, honor: price }),
  );
  const ownedMark = owned
    ? `<span class="vi-sub">${esc(t('hudChrome.warfareShop.owned'))}</span>`
    : '';
  tile.innerHTML = `${deps.itemIcon(item)}<span class="vi-name">${esc(itemName)}${ownedMark}</span><span class="vi-price"><span class="warfare-price${affordable ? '' : ' unaffordable'}">${esc(price)}</span></span>`;
  tile.addEventListener('click', () => deps.onBuy(itemId));
  deps.attachTooltip(
    tile,
    () => `${deps.itemTooltip(item)}<div class="tt-sub">${esc(t('itemUi.tooltip.clickBuy'))}</div>`,
  );
  grid.appendChild(tile);
}

/** Paint the WARFARE shop panel from a prepared view. */
export function renderWarfareVendorWindow(
  el: HTMLElement,
  vendorName: string,
  view: WarfareShopView,
  deps: WarfareVendorWindowDeps,
): void {
  // The rebuild replaces the hovered tile (its mouseleave never fires) and
  // collapses the scrolled list; drop the tooltip and restore the scroll.
  deps.hideTooltip();
  // Inventory and balance deltas repaint this window UNINITIATED, so carry
  // keyboard focus across the wipe per the focus-across-a-REBUILD contract:
  // the exact tile when it survived enabled, else outward neighbours inside
  // the SAME section grid, else the close button.
  const focused = focusedWithin(el);
  const focusKey = focused?.dataset.focusKey ?? null;
  const focusedGrid = focused?.closest<HTMLElement>('.vendor-goods-grid');
  const focusedGridName = focusedGrid?.dataset.grid ?? null;
  const focusedSlot = focusedGrid
    ? [...focusedGrid.querySelectorAll('button')].indexOf(focused as HTMLButtonElement)
    : -1;
  const scrollTop = el.scrollTop;

  const title = t('itemUi.vendor.goodsTitle', { name: vendorName });
  markDialogRoot(el, { label: title });
  el.innerHTML = `<div class="panel-title"><span>${esc(title)}</span><button type="button" class="x-btn" data-close data-focus-key="close" aria-label="${esc(t('itemUi.vendor.close'))}">${svgIcon('close')}</button></div>`;

  const balance = document.createElement('div');
  balance.className = 'warfare-balance';
  balance.textContent = t('hudChrome.warfare.balance', { amount: count(view.balance) });
  el.appendChild(balance);

  for (const section of view.sections) {
    // Guard mirrors the vendor window's grids: never leave a dead empty node.
    // It covers the HEADING as well as the grid, because a title with nothing
    // under it is the deader of the two. buildWarfareVendorView emits no empty
    // section today; this stays correct if it ever does.
    if (section.offers.length === 0) continue;
    const heading = document.createElement('div');
    heading.className = 'vendor-section-title';
    heading.textContent = sectionTitleText(section);
    el.appendChild(heading);
    const grid = document.createElement('div');
    grid.className = 'vendor-goods-grid';
    grid.dataset.grid = section.key;
    for (const offer of section.offers) appendOfferTile(grid, section, offer, deps);
    el.appendChild(grid);
  }

  el.querySelector('[data-close]')?.addEventListener('click', () => deps.onClose());
  el.style.display = 'block';
  el.scrollTop = scrollTop;
  // Restore focus LAST (a bare focus() may scroll the tile into view, which
  // must win over the raw scroll restore for a keyboard player). Dataset
  // equality rather than an attribute selector: the keys embed item ids and
  // this needs no CSS.escape (the vendor_window precedent).
  if (focusKey) {
    const keyed = [...el.querySelectorAll<HTMLButtonElement>('[data-focus-key]')];
    const exact = keyed.find((b) => b.dataset.focusKey === focusKey);
    const grid =
      focusedGridName !== null
        ? el.querySelector<HTMLElement>(`.vendor-goods-grid[data-grid="${focusedGridName}"]`)
        : null;
    const rows = grid ? [...grid.querySelectorAll('button')] : [];
    const slot = focusedSlot >= 0 ? Math.min(focusedSlot, rows.length - 1) : -1;
    const neighbors: (HTMLButtonElement | undefined)[] = [];
    if (slot >= 0) {
      for (let step = 0; step < rows.length; step++) {
        if (rows[slot + step]) neighbors.push(rows[slot + step] as HTMLButtonElement);
        if (step > 0 && rows[slot - step]) neighbors.push(rows[slot - step] as HTMLButtonElement);
      }
    }
    restoreFirstEnabled([exact, ...neighbors, keyed.find((b) => b.dataset.focusKey === 'close')]);
  }
}
