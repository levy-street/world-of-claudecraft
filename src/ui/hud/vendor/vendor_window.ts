// Thin DOM consumer for the vendor window.
//
// The consumer half of the pure-core + thin-consumer split: it paints
// #vendor-window from the structured VendorView (vendor_view.ts) and wires the
// buy / buyback / close actions. It owns no state. The cross-window
// orchestration (which windows to close, bag re-centring, mobile teardown)
// stays in Hud because it needs Hud's private state; this module only renders
// one panel and reports clicks back through the injected callbacks.

import type { ItemInstancePayload } from '../../../sim/types';
import type { VendorBuyOptions } from '../../../sim/vendor_buy_stack';
import { itemDisplayName } from '../../entity_i18n';
import { esc } from '../../esc';
import { focusedWithin, restoreFirstEnabled } from '../../focus_restore';
import { gatheringProfessionNameKey } from '../../gathering_profession_name';
import { formatMoney as formatLocalizedMoney, formatNumber, t } from '../../i18n';
import type { PainterHostPresentation } from '../../painter_host';
import { svgIcon } from '../../ui_icons';
import { showBuyQuantityPrompt } from './buy_quantity_prompt_window';
import {
  VENDOR_MULTIPLES,
  type VendorGoodsRow,
  type VendorMultiple,
  type VendorPrice,
  type VendorView,
} from './vendor_view';

/**
 * Hud-supplied glue. The icon/money/tooltip painters are the shared
 * PainterHostPresentation bag (Hud builds it once and hands it to every window
 * that renders item rows); this composes that base and adds the vendor-specific
 * tooltip teardown, the buy/buyback/sell-junk dispatch, and the sell-junk state.
 * The module never reaches into Hud directly.
 */
export interface VendorWindowDeps extends PainterHostPresentation {
  hideTooltip(): void;
  /** The one explicit purchase shape (VendorBuyOptions): `{ bulk: true }` for
   *  a ctrl/cmd-click on the row or a click on its "Buy Stack" control (the
   *  largest affordable stack, #2374), `{ count: N }` for a control-row
   *  multiple or a confirmed custom amount (N row units, phase 21). At most
   *  one field is ever set; a plain click passes undefined. */
  onBuy(itemId: string, opts?: VendorBuyOptions): void;
  /** Control-row selection (phase 21). Hud owns the selected multiple (it must
   *  survive the buy-driven rebuild) and re-renders with the new value. */
  onQtyChange(multiple: VendorMultiple): void;
  /** The countFit-derived row-unit cap for the custom prompt (Q19), resolved
   *  through the live world inventory at click time so the shown max is never
   *  stale by a purchase. */
  buyCustomMax(itemId: string): number;
  onBuyBack(
    itemId: string,
    index: number,
    instance: ItemInstancePayload | undefined,
    craftedRecipeId: string | undefined,
  ): void;
  onSellJunk(): void;
  onClose(): void;
  sellJunk: {
    enabled: boolean;
    proceeds: number;
  };
}

function honorText(amount: number): string {
  return t('hudChrome.warfare.honorAmount', {
    amount: formatNumber(amount, { maximumFractionDigits: 0 }),
  });
}

function goodsPriceText(price: VendorPrice): string {
  const money = price.copper > 0 ? formatLocalizedMoney(price.copper) : '';
  const honor = price.honor > 0 ? honorText(price.honor) : '';
  if (money && honor) return t('hudChrome.warfare.dualPrice', { money, honor });
  return money || honor;
}

/** The advisory requirement line under a row's name (R22): the localized
 *  gathering profession plus the wield proficiency the tool will ask of its
 *  owner, e.g. "Requires Mining 40". The row sells either way.
 *
 *  Reuses hudChrome.crafting.skillReqLine rather than minting a second sentence
 *  saying the same thing: its rendered English is exactly this line, it is
 *  filled in every locale, and its `{craft}` placeholder is a name slot, not a
 *  claim that the named thing is a craft (the crafting window passes a craft,
 *  this passes a gathering profession). The trainer's own locked-row key stays
 *  separate because its wording, "Taught at", is trainer-specific and false of a
 *  merchant. Empty string for a profession with no display-name key, matching
 *  every other consumer of that table: no name is printable, so no line is. */
function requirementText(row: VendorGoodsRow): string {
  const requirement = row.requirement;
  if (!requirement) return '';
  const nameKey = gatheringProfessionNameKey(requirement.professionId);
  if (nameKey === undefined) return '';
  return t('hudChrome.crafting.skillReqLine', {
    craft: t(nameKey),
    skill: formatNumber(requirement.proficiency, { maximumFractionDigits: 0 }),
  });
}

function goodsPriceHtml(row: VendorGoodsRow, deps: VendorWindowDeps): string {
  const parts: string[] = [];
  if (row.price.copper > 0) parts.push(deps.moneyHtml(row.price.copper));
  if (row.price.honor > 0) {
    parts.push(`<span class="warfare-price">${esc(honorText(row.price.honor))}</span>`);
  }
  return parts.join('<span aria-hidden="true"> + </span>');
}

/** Paint the vendor panel from a prepared view. */
export function renderVendorWindow(
  el: HTMLElement,
  vendorName: string,
  view: VendorView,
  deps: VendorWindowDeps,
): void {
  // The rebuild replaces the hovered row (its mouseleave never fires) and
  // collapses the scrolled list, drop the tooltip and restore the scroll.
  // It also replaces the FOCUSED row (a keyboard buy rebuilds under the
  // finger), so the focus key is captured here and restored at the end per
  // the focus-across-a-REBUILD contract; requirement-advisory rows are
  // focusable since the R22 turn, which widened the set exposed to the drop.
  deps.hideTooltip();
  const focused = focusedWithin(el);
  const focusKey = focused?.dataset.focusKey ?? null;
  // The grid slot beside the key: when the exact row is gone or comes back
  // disabled (the last-stack buy), the same SLOT in the same grid is the next
  // best landing (after a removal it holds the next item), and it keeps the
  // player inside the row instead of jumping to Close, where a reflexive
  // Enter would shut the vendor.
  const focusedGrid = focused?.closest<HTMLElement>('.vendor-goods-grid');
  const focusedGridName = focusedGrid?.dataset.grid ?? null;
  const focusedSlot = focusedGrid
    ? [...focusedGrid.querySelectorAll('button')].indexOf(focused as HTMLButtonElement)
    : -1;
  const scrollTop = el.scrollTop;
  el.innerHTML = `<div class="panel-title"><span>${esc(t('itemUi.vendor.goodsTitle', { name: vendorName }))}</span><button type="button" class="x-btn" data-close data-focus-key="close" aria-label="${esc(t('itemUi.vendor.close'))}">${svgIcon('close')}</button></div>`;

  if (view.hasHonorGoods) {
    const balance = document.createElement('div');
    balance.className = 'warfare-balance';
    balance.textContent = t('hudChrome.warfare.balance', {
      amount: formatNumber(view.honorBalance, { maximumFractionDigits: 0 }),
    });
    el.appendChild(balance);
  }

  // The 1x/5x/10x/custom purchase control row (phase 21, Q21: the ONE count
  // trigger surface). aria-pressed marks the selection; each button carries
  // its own focus key so the ladder and gamepad reach it across the rebuild
  // (the fixed multiples are the gamepad-complete path, Q24).
  if (view.goods.length > 0) {
    const qtyRow = document.createElement('div');
    qtyRow.className = 'vendor-qty-row';
    qtyRow.setAttribute('role', 'group');
    qtyRow.setAttribute('aria-label', t('itemUi.vendor.qtyRowAria'));
    for (const m of VENDOR_MULTIPLES) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'vendor-qty-btn';
      // The selected state rides aria-pressed alone; the stylesheet keys off
      // the attribute so style and semantics cannot drift apart.
      btn.setAttribute('aria-pressed', view.multiple === m ? 'true' : 'false');
      if (m === 'custom') {
        btn.textContent = t('itemUi.vendor.qtyCustom');
        btn.setAttribute('aria-label', t('itemUi.vendor.qtyCustomAria'));
      } else {
        const count = formatNumber(m, { maximumFractionDigits: 0 });
        btn.textContent = t('itemUi.vendor.qtyMultiple', { count });
        btn.setAttribute('aria-label', t('itemUi.vendor.qtyMultipleAria', { count }));
      }
      btn.dataset.focusKey = `qty:${m}`;
      btn.addEventListener('click', () => deps.onQtyChange(m));
      qtyRow.appendChild(btn);
    }
    el.appendChild(qtyRow);
  }

  // Landscape layout: goods tile up in a multi-column grid instead of one
  // full-width row per item (see .vendor-goods-grid in components.css).
  const goodsGrid = document.createElement('div');
  goodsGrid.className = 'vendor-goods-grid';
  goodsGrid.dataset.grid = 'goods';
  for (const goods of view.goods) {
    const { itemId, item, quantity } = goods;
    const row = document.createElement('button');
    row.type = 'button';
    // An unmet wield requirement is ADVISORY (R22): the row sells like any
    // other, and .vendor-locked survives purely as the style hook that tints
    // the requirement sub-line so the number reads as "not yet met" rather
    // than decoration. Never disabled for it: the sale is real, the gate is
    // at the harvest.
    row.className = goods.requirementUnmet ? 'vendor-item vendor-locked' : 'vendor-item';
    // The disable state tracks the SELECTED multiple (phase 21): a count row
    // gates on the whole-count total; force-1 and custom rows keep the 1x
    // baseline (the custom prompt's typed amount decides the rest).
    const countBuy = goods.countBuy;
    row.disabled = countBuy ? !countBuy.affordable : !goods.affordable;
    const price = countBuy ? formatLocalizedMoney(countBuy.copper) : goodsPriceText(goods.price);
    const itemName = itemDisplayName(item);
    const stack =
      quantity > 1
        ? ` ${t('itemUi.bags.stackCount', { count: formatNumber(quantity, { maximumFractionDigits: 0 }) })}`
        : '';
    const requirement = goods.requirementUnmet ? requirementText(goods) : '';
    // Every row gets a buy aria-label (the purchase deny is retired, so the
    // promise is true of every row), and an aria-label REPLACES the button's
    // content as its accessible name: a requirement-unmet row must fold the
    // advisory into the name itself or screen-reader users never hear what
    // the sighted sub-line says. One combined key, never two concatenated
    // t() results. A count row's name states qty and TOTAL price
    // (acceptance f), through the same combined-key rule.
    const countText = countBuy
      ? formatNumber(countBuy.count, { maximumFractionDigits: 0 })
      : undefined;
    row.setAttribute(
      'aria-label',
      countBuy
        ? requirement
          ? t('itemUi.vendor.buyCountAriaWithRequirement', {
              count: countText as string,
              item: `${itemName}${stack}`,
              price,
              requirement,
            })
          : t('itemUi.vendor.buyCountAria', {
              count: countText as string,
              item: `${itemName}${stack}`,
              price,
            })
        : requirement
          ? t('itemUi.vendor.buyAriaWithRequirement', {
              item: `${itemName}${stack}`,
              price,
              requirement,
            })
          : t('itemUi.vendor.buyAria', { item: `${itemName}${stack}`, price }),
    );
    // The count chip reuses the control row's own multiple key ({count}x), so
    // it reads in the row's grammar (5x = five purchases) and can never sit
    // beside the name's units-per-purchase "x5" wearing the same face; the
    // price cell shows the whole-count total the click will charge.
    const qtyChip = countBuy
      ? `<span class="vi-qty">${esc(t('itemUi.vendor.qtyMultiple', { count: countText as string }))}</span>`
      : '';
    const priceHtml = countBuy ? deps.moneyHtml(countBuy.copper) : goodsPriceHtml(goods, deps);
    row.innerHTML = `${deps.itemIcon(item)}<span class="vi-name">${esc(itemName)}${esc(stack)}${requirement ? `<span class="vi-sub">${esc(requirement)}</span>` : ''}</span><span class="vi-price">${qtyChip}${priceHtml}</span>`;
    row.dataset.focusKey = `buy:${itemId}`;
    // Ctrl/Cmd-click requests a bulk purchase (#2374) and wins over the
    // selected multiple (an explicit stack request), the desktop mirror of
    // the "Buy Stack" tile below; both funnel through the same
    // onBuy(itemId, { bulk: true }). Otherwise the click follows the
    // selection: a fixed multiple sends its count, 'custom' opens the
    // countFit-capped prompt (Q19), and 1x stays the plain buy.
    row.addEventListener('click', (ev) => {
      if (ev.ctrlKey || ev.metaKey) {
        deps.onBuy(itemId, { bulk: true });
      } else if (countBuy) {
        deps.onBuy(itemId, { count: countBuy.count });
      } else if (goods.customBuy) {
        showBuyQuantityPrompt(el, item, deps.buyCustomMax(itemId), (count) =>
          deps.onBuy(itemId, { count }),
        );
      } else {
        deps.onBuy(itemId, undefined);
      }
    });
    // No appended requirement line in the tooltip: the shared item tooltip
    // (deps.itemTooltip -> gatherToolTooltipLines) already renders the same
    // "Requires {craft} {skill}" sentence on every requirement-carrying
    // tool, and the painter appending it again showed the line twice on
    // every gated row. The at-a-glance signal stays the .vi-sub row line.
    deps.attachTooltip(
      row,
      () =>
        `${deps.itemTooltip(item)}<div class="tt-sub">${esc(t('itemUi.tooltip.clickBuy'))}</div>`,
    );
    goodsGrid.appendChild(row);
    // A separate, always-visible tile (never a nested <button>, never hidden
    // behind a modifier key) so the bulk purchase is reachable identically on
    // touch and desktop: the mobile-parity affordance for the ctrl-click
    // gesture above. Only offered when the row actually qualifies for a bulk
    // purchase of more than one unit (see bulkQuantity in vendor_view.ts).
    if (goods.bulkQuantity !== undefined && goods.bulkQuantity > 1) {
      const bulkRow = document.createElement('button');
      bulkRow.type = 'button';
      bulkRow.className = 'vendor-item vendor-item-bulk';
      bulkRow.disabled = !goods.bulkAffordable;
      const bulkCount = formatNumber(goods.bulkQuantity, { maximumFractionDigits: 0 });
      const bulkCopper = Math.max(0, item.buyValue ?? 0) * goods.bulkQuantity;
      const bulkPrice = formatLocalizedMoney(bulkCopper);
      bulkRow.setAttribute(
        'aria-label',
        t('itemUi.vendor.buyStackAria', { item: itemName, count: bulkCount, price: bulkPrice }),
      );
      bulkRow.innerHTML = `${deps.itemIcon(item)}<span class="vi-name">${esc(t('itemUi.vendor.buyStack', { count: bulkCount }))}</span><span class="vi-price">${deps.moneyHtml(bulkCopper)}</span>`;
      // Its own focus key: a keyboard bulk buy rebuilds the grid under the
      // finger exactly like the ordinary row's buy, and without a key the
      // restore ladder cannot find the tile again (focus fell to <body>).
      bulkRow.dataset.focusKey = `buy-stack:${itemId}`;
      bulkRow.addEventListener('click', () => deps.onBuy(itemId, { bulk: true }));
      deps.attachTooltip(
        bulkRow,
        () =>
          `${deps.itemTooltip(item)}<div class="tt-sub">${esc(t('itemUi.vendor.buyStack', { count: bulkCount }))}</div>`,
      );
      goodsGrid.appendChild(bulkRow);
    }
  }
  if (view.goods.length > 0) el.appendChild(goodsGrid);

  const sellJunk = document.createElement('button');
  sellJunk.type = 'button';
  sellJunk.className = 'vendor-sell-junk';
  sellJunk.disabled = !deps.sellJunk.enabled;
  sellJunk.innerHTML = `<span class="vi-name">${esc(t('itemUi.vendor.sellJunk'))}</span>${deps.sellJunk.enabled ? `<span class="vi-price">${deps.moneyHtml(deps.sellJunk.proceeds)}</span>` : ''}`;
  sellJunk.setAttribute(
    'aria-label',
    deps.sellJunk.enabled
      ? t('itemUi.vendor.sellJunkAria', {
          price: formatLocalizedMoney(deps.sellJunk.proceeds),
        })
      : t('itemUi.vendor.sellJunk'),
  );
  sellJunk.dataset.focusKey = 'sell-junk';
  sellJunk.addEventListener('click', () => deps.onSellJunk());
  deps.attachTooltip(
    sellJunk,
    () => `<div class="tt-sub">${esc(t('itemUi.vendor.sellJunkHint'))}</div>`,
  );
  el.appendChild(sellJunk);

  const buybackTitle = document.createElement('div');
  buybackTitle.className = 'vendor-section-title';
  buybackTitle.textContent = t('itemUi.vendor.buybackTitle');
  el.appendChild(buybackTitle);

  if (view.buyback.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'vendor-empty';
    empty.textContent = t('itemUi.vendor.buybackEmpty');
    el.appendChild(empty);
  }
  const buybackGrid = document.createElement('div');
  buybackGrid.className = 'vendor-goods-grid';
  buybackGrid.dataset.grid = 'buyback';
  for (const {
    itemId,
    item,
    count,
    price: priceCopper,
    index,
    instance,
    craftedRecipeId,
  } of view.buyback) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'vendor-item';
    const price = formatLocalizedMoney(priceCopper);
    const itemName = itemDisplayName(item);
    row.setAttribute('aria-label', t('itemUi.vendor.buybackAria', { item: itemName, price }));
    row.innerHTML = `${deps.itemIcon(item)}<span class="vi-name">${esc(itemName)}${count > 1 ? ` ${esc(t('itemUi.bags.stackCount', { count: formatNumber(count, { maximumFractionDigits: 0 }) }))}` : ''}</span><span class="vi-price">${deps.moneyHtml(priceCopper)}</span>`;
    // POSITIONAL by design, unlike the identity-keyed goods rows: after a
    // buyback the list shifts and focus stays at the same SLOT (the next
    // item to reclaim), which is the useful landing for repeated buybacks.
    row.dataset.focusKey = `buyback:${index}`;
    row.addEventListener('click', () => deps.onBuyBack(itemId, index, instance, craftedRecipeId));
    deps.attachTooltip(
      row,
      () =>
        `${deps.itemTooltip(item, instance)}<div class="tt-sub">${esc(t('itemUi.tooltip.clickBuyback'))}</div>`,
    );
    buybackGrid.appendChild(row);
  }
  if (view.buyback.length > 0) el.appendChild(buybackGrid);

  const hint = document.createElement('div');
  hint.className = 'vendor-hint';
  hint.textContent = t('itemUi.vendor.hint');
  el.appendChild(hint);

  el.querySelector('[data-close]')?.addEventListener('click', () => deps.onClose());
  el.style.display = 'block';
  el.scrollTop = scrollTop;
  // Scroll first, then restore (the family contract): the exact control when
  // it survived the rebuild, else the stable neighbors, so a keyboard buy of
  // the last stack cannot drop focus to <body>.
  if (focusKey) {
    // Matched by dataset equality rather than an attribute selector: the keys
    // are self-minted (buy:<itemId> and friends) but this needs no CSS.escape,
    // which jsdom does not provide. ONE identity end to end: every rung below
    // resolves through data-focus-key, so a class rename cannot silently
    // hollow a rung.
    const keyed = [...el.querySelectorAll<HTMLButtonElement>('[data-focus-key]')];
    const exact = keyed.find((b) => b.dataset.focusKey === focusKey);
    // The same-grid slot ladder: the slot itself (after a removal it holds
    // the NEXT item), then outward neighbors, before ever leaving the row.
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
    restoreFirstEnabled([
      exact,
      ...neighbors,
      keyed.find((b) => b.dataset.focusKey === 'sell-junk'),
      keyed.find((b) => b.dataset.focusKey === 'close'),
    ]);
  }
}
