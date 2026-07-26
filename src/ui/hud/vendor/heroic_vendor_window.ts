// Thin DOM consumer for the Heroic Quartermaster window.
//
// The consumer half of the pure-core + thin-consumer split (reference
// vendor_window.ts): paints the marks-currency shop from the structured
// HeroicShopView and reports buy/close clicks back through the injected
// callbacks. Reuses the vendor window's CSS classes (.vendor-item, .vi-name,
// .vi-price) so the shop reads as the same window family. It owns no state.

import { markDialogRoot } from '../../dialog_root';
import { itemDisplayName } from '../../entity_i18n';
import { esc } from '../../esc';
import { formatList, formatNumber, type TranslationKey, t } from '../../i18n';
import type { PainterHostPresentation } from '../../painter_host';
import { itemPresentationName } from '../../procedural_item_presentation';
import { svgIcon } from '../../ui_icons';
import type {
  HeroicQuartermasterView,
  HeroicShopView,
  HeroicVendorTab,
  NythraxisForgeRow,
  NythraxisTuneRow,
  QuartermasterBlockReason,
  QuartermasterCost,
} from './heroic_vendor_view';

export interface LegacyHeroicVendorWindowDeps extends PainterHostPresentation {
  hideTooltip(): void;
  onBuy(itemId: string): void;
  onClose(): void;
}

export interface HeroicVendorWindowDeps extends LegacyHeroicVendorWindowDeps {
  onForge(offerId: string): void;
  onTune(instanceUid: string): void;
  onTab(tab: HeroicVendorTab): void;
  status: string | null;
  pending: boolean;
}

function num(value: number): string {
  return formatNumber(value, { maximumFractionDigits: 0 });
}

function powerName(powerId: string): string {
  return t(`itemUi.procedural.legendary.${powerId}.name` as TranslationKey);
}

function costText(cost: QuartermasterCost): string {
  return t('heroicShop.cost', {
    fragments: num(cost.fragments),
    marks: num(cost.heroicMarks),
  });
}

function blockedText(reason: QuartermasterBlockReason): string {
  if (!reason) return '';
  return t(`heroicShop.blocked.${reason}` as TranslationKey);
}

const HEROIC_VENDOR_TABS: readonly HeroicVendorTab[] = ['gear', 'forge', 'tune'];

function tabButton(tab: HeroicVendorTab, active: HeroicVendorTab): string {
  const selected = tab === active;
  return `<button type='button' role='tab' id='heroic-quartermaster-tab-${tab}' class='hq-tab${selected ? ' active' : ''}' data-tab='${tab}' data-focus-key='tab:${tab}' aria-selected='${selected}' aria-controls='heroic-quartermaster-panel-${tab}' tabindex='${selected ? '0' : '-1'}'>${esc(t(`heroicShop.tab.${tab}` as TranslationKey))}</button>`;
}

function gearHtml(view: HeroicQuartermasterView, deps: HeroicVendorWindowDeps): string {
  const rows = view.gear.rows
    .map(({ itemId, item, marks, affordable }) => {
      const itemName = itemDisplayName(item);
      const reason = affordable ? '' : t('heroicShop.blocked.marks');
      return `<button type='button' class='vendor-item hq-offer' data-buy='${esc(itemId)}' data-focus-key='gear:${esc(itemId)}' aria-disabled='${!affordable || deps.pending}' aria-label='${esc(t('heroicShop.buyAria', { item: itemName, marks: num(marks) }))}'>${deps.itemIcon(item)}<span class='vi-name'>${esc(itemName)}</span><span class='vi-price${affordable ? '' : ' unaffordable'}'>${esc(t('delveUi.shop.price', { marks: num(marks) }))}</span>${reason ? `<span class='hq-blocked'>${esc(reason)}</span>` : ''}</button>`;
    })
    .join('');
  return `<div class='hq-section-copy'>${esc(t('heroicShop.gearIntro'))}</div><div class='vendor-goods-grid'>${rows}</div>`;
}

function forgeRowHtml(row: NythraxisForgeRow, deps: HeroicVendorWindowDeps): string {
  const itemName = row.powerId ? powerName(row.powerId) : itemDisplayName(row.item);
  const kind = t(`heroicShop.forgeKind.${row.kind}` as TranslationKey);
  const traits = [
    row.randomAffixes ? t('heroicShop.randomAffixes') : t('heroicShop.deterministicStats'),
    row.raidForged ? t('heroicShop.raidForgedGuarantee') : null,
  ].filter((value): value is string => value !== null);
  const traitList = formatList(traits, { style: 'short', type: 'unit' });
  const blocked = blockedText(row.blockReason);
  return `<button type='button' class='hq-offer hq-forge-offer q-${row.quality}' data-forge='${esc(row.offerId)}' data-focus-key='forge:${esc(row.offerId)}' aria-disabled='${row.blockReason !== null || deps.pending}'>${deps.itemIcon(row.item, row.previewInstance)}<span class='hq-offer-copy'><span class='hq-offer-name'>${esc(itemName)}</span><span class='hq-offer-meta'>${esc(kind)} · ${esc(t('heroicShop.itemLevel', { level: num(row.itemLevel) }))}</span><span class='hq-offer-traits'>${esc(traitList)}</span><span class='hq-cost'>${esc(costText(row.cost))}</span>${blocked ? `<span class='hq-blocked'>${esc(blocked)}</span>` : ''}</span></button>`;
}

function forgeHtml(view: HeroicQuartermasterView, deps: HeroicVendorWindowDeps): string {
  const clear = view.heroicClear
    ? t('heroicShop.heroicClearReady')
    : t('heroicShop.heroicClearNeeded');
  const rows = view.forgeRows.map((row) => forgeRowHtml(row, deps)).join('');
  return `<div class='hq-section-copy'>${esc(t('heroicShop.forgeIntro'))}</div><div class='hq-clear-state ${view.heroicClear ? 'ready' : 'blocked'}'>${esc(clear)}</div><div class='hq-offer-list'>${rows}</div>`;
}

function tuneRowHtml(row: NythraxisTuneRow, deps: HeroicVendorWindowDeps): string {
  const itemName = itemPresentationName({ name: itemDisplayName(row.item) }, row.instance);
  const source = row.raidForged ? t('heroicShop.raidForged') : t('heroicShop.raidDrop');
  const blocked = blockedText(row.blockReason);
  return `<button type='button' class='hq-offer hq-tune-offer q-legendary' data-tune='${esc(row.instanceUid)}' data-focus-key='tune:${esc(row.instanceUid)}' aria-disabled='${row.blockReason !== null || deps.pending}'>${deps.itemIcon(row.item, row.instance)}<span class='hq-offer-copy'><span class='hq-offer-name'>${esc(itemName)}</span><span class='hq-offer-meta'>${esc(powerName(row.powerId))} · ${esc(t('heroicShop.itemLevel', { level: num(row.itemLevel) }))}</span><span class='hq-offer-traits'>${esc(source)} · ${esc(t('heroicShop.reforgeCount', { count: num(row.reforgeCount) }))}</span><span class='hq-cost'>${esc(costText(row.cost))}</span>${blocked ? `<span class='hq-blocked'>${esc(blocked)}</span>` : ''}</span></button>`;
}

function tuneHtml(view: HeroicQuartermasterView, deps: HeroicVendorWindowDeps): string {
  const intro = `<div class='hq-section-copy'>${esc(t('heroicShop.tuneIntro'))}</div>`;
  if (view.tuneRows.length === 0) {
    return `${intro}<div class='hq-empty'>${esc(t('heroicShop.tuneEmpty'))}</div>`;
  }
  return `${intro}<div class='hq-offer-list'>${view.tuneRows.map((row) => tuneRowHtml(row, deps)).join('')}</div>`;
}

/** Paint the Heroic Quartermaster panel from a prepared view. */
export function renderHeroicVendorWindow(
  el: HTMLElement,
  vendorName: string,
  view: HeroicShopView,
  deps: LegacyHeroicVendorWindowDeps,
): void {
  // The rebuild replaces the hovered row (its mouseleave never fires) and
  // collapses the scrolled list; drop the tooltip and restore the scroll.
  deps.hideTooltip();
  const scrollTop = el.scrollTop;
  el.innerHTML = `<div class="panel-title"><span>${esc(t('itemUi.vendor.goodsTitle', { name: vendorName }))}</span><button type="button" class="x-btn" data-close aria-label="${esc(t('itemUi.vendor.close'))}">${svgIcon('close')}</button></div>`;

  const balance = document.createElement('div');
  balance.className = 'vendor-section-title';
  balance.textContent = t('heroicShop.balance', {
    count: formatNumber(view.balance, { maximumFractionDigits: 0 }),
  });
  el.appendChild(balance);

  // Same landscape tile grid as the goods/buyback vendor (.vendor-goods-grid
  // in components.css): the Heroic Quartermaster is the same kind of shop
  // counter and shares #vendor-window's width, so its rows must flow into
  // the grid rather than stay a single full-width column at that width.
  const goodsGrid = document.createElement('div');
  goodsGrid.className = 'vendor-goods-grid';
  for (const { itemId, item, marks, affordable } of view.rows) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'vendor-item';
    row.disabled = !affordable;
    const itemName = itemDisplayName(item);
    const marksLabel = formatNumber(marks, { maximumFractionDigits: 0 });
    row.setAttribute('aria-label', t('heroicShop.buyAria', { item: itemName, marks: marksLabel }));
    row.innerHTML = `${deps.itemIcon(item)}<span class="vi-name">${esc(itemName)}</span><span class="vi-price${affordable ? '' : ' unaffordable'}">${esc(t('delveUi.shop.price', { marks: marksLabel }))}</span>`;
    row.addEventListener('click', () => deps.onBuy(itemId));
    deps.attachTooltip(
      row,
      () =>
        `${deps.itemTooltip(item)}<div class="tt-sub">${esc(t('itemUi.tooltip.clickBuy'))}</div>`,
    );
    goodsGrid.appendChild(row);
  }
  // Guard mirrors vendor_window.ts's goods/buyback grids: skip appending an
  // empty grid container rather than leaving a dead node in the DOM.
  if (view.rows.length > 0) el.appendChild(goodsGrid);

  el.querySelector('[data-close]')?.addEventListener('click', () => deps.onClose());
  el.style.display = 'block';
  el.scrollTop = scrollTop;
}

/** Paint the tabbed Heroic Quartermaster without resolving any purchase. */
export function renderHeroicQuartermasterWindow(
  el: HTMLElement,
  vendorName: string,
  view: HeroicQuartermasterView,
  deps: HeroicVendorWindowDeps,
): void {
  deps.hideTooltip();
  const scrollTop = el.scrollTop;
  const active = document.activeElement;
  const focusKey =
    active instanceof HTMLElement && el.contains(active) ? (active.dataset.focusKey ?? null) : null;
  const body =
    view.tab === 'gear'
      ? gearHtml(view, deps)
      : view.tab === 'forge'
        ? forgeHtml(view, deps)
        : tuneHtml(view, deps);
  el.innerHTML = `<div class='panel-title'><span id='heroic-quartermaster-title'>${esc(t('itemUi.vendor.goodsTitle', { name: vendorName }))}</span><button type='button' class='x-btn' data-close aria-label='${esc(t('itemUi.vendor.close'))}'>${svgIcon('close')}</button></div><div class='hq-balances'><span>${esc(t('heroicShop.fragmentBalance', { count: num(view.fragments) }))}</span><span>${esc(t('heroicShop.balance', { count: num(view.heroicMarks) }))}</span></div><div class='hq-tabs' role='tablist' aria-label='${esc(t('heroicShop.tabsAria'))}' aria-orientation='horizontal'>${tabButton('gear', view.tab)}${tabButton('forge', view.tab)}${tabButton('tune', view.tab)}</div><div class='hq-status' role='status' aria-live='polite'>${deps.status ? esc(deps.status) : ''}</div><div class='hq-tab-panel' id='heroic-quartermaster-panel-${view.tab}' role='tabpanel' aria-labelledby='heroic-quartermaster-tab-${view.tab}'>${body}</div>`;
  markDialogRoot(el, { labelledBy: 'heroic-quartermaster-title' });
  el.querySelector('[data-close]')?.addEventListener('click', () => deps.onClose());
  el.querySelectorAll<HTMLElement>('[data-tab]').forEach((button) => {
    button.addEventListener('click', () => deps.onTab(button.dataset.tab as HeroicVendorTab));
    button.addEventListener('keydown', (event) => {
      const current = HEROIC_VENDOR_TABS.indexOf(button.dataset.tab as HeroicVendorTab);
      let next = current;
      if (event.key === 'ArrowRight') next = (current + 1) % HEROIC_VENDOR_TABS.length;
      else if (event.key === 'ArrowLeft')
        next = (current - 1 + HEROIC_VENDOR_TABS.length) % HEROIC_VENDOR_TABS.length;
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = HEROIC_VENDOR_TABS.length - 1;
      else return;
      event.preventDefault();
      const tab = HEROIC_VENDOR_TABS[next];
      deps.onTab(tab);
      el.querySelector<HTMLElement>(`[data-tab='${tab}']`)?.focus();
    });
  });
  el.querySelectorAll<HTMLElement>('[data-buy]').forEach((button) => {
    button.addEventListener('click', () => {
      if (button.getAttribute('aria-disabled') === 'true') return;
      const itemId = button.dataset.buy;
      if (itemId) deps.onBuy(itemId);
    });
  });
  el.querySelectorAll<HTMLElement>('[data-forge]').forEach((button) => {
    button.addEventListener('click', () => {
      if (button.getAttribute('aria-disabled') === 'true') return;
      const offerId = button.dataset.forge;
      if (offerId) deps.onForge(offerId);
    });
  });
  el.querySelectorAll<HTMLElement>('[data-tune]').forEach((button) => {
    button.addEventListener('click', () => {
      if (button.getAttribute('aria-disabled') === 'true') return;
      const instanceUid = button.dataset.tune;
      if (instanceUid) deps.onTune(instanceUid);
    });
  });
  el.querySelectorAll<HTMLElement>('[data-buy]').forEach((button) => {
    const row = view.gear.rows.find((candidate) => candidate.itemId === button.dataset.buy);
    if (row) deps.attachTooltip(button, () => deps.itemTooltip(row.item));
  });
  el.querySelectorAll<HTMLElement>('[data-forge]').forEach((button) => {
    const row = view.forgeRows.find((candidate) => candidate.offerId === button.dataset.forge);
    if (row) deps.attachTooltip(button, () => deps.itemTooltip(row.item, row.previewInstance));
  });
  el.querySelectorAll<HTMLElement>('[data-tune]').forEach((button) => {
    const row = view.tuneRows.find((candidate) => candidate.instanceUid === button.dataset.tune);
    if (row) deps.attachTooltip(button, () => deps.itemTooltip(row.item, row.instance));
  });
  el.style.display = 'block';
  el.scrollTop = scrollTop;
  if (focusKey) {
    el.querySelector<HTMLElement>(`[data-focus-key='${CSS.escape(focusKey)}']`)?.focus();
  }
}
