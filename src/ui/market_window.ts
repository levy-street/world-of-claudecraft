// Thin DOM painter for the World Market window.
//
// The consumer half of the pure-core + thin-painter split: it paints
// #market-window from the structured MarketView (market_view.ts) and owns the
// window's view-state (tab, filters, page, the staged sell item, the search
// term) plus its lifecycle (open / close / refresh-on-snapshot). The pure core
// decides WHICH state the snapshot is in and WHAT rows it shows; this module
// renders that and wires the buy / list / cancel / collect / filter dispatch
// back through IWorld + injected callbacks. It holds no Sim reference and reaches
// into Hud only through its deps.
//
// Colors live in the extracted stylesheet: item-quality tint comes
// from the shared QUALITY_COLOR map, the unranked fallback is a CSS token, so no
// raw hex sits in this painter.

import { audio } from '../game/audio';
import {
  type MarketDurationHours,
  type MarketListOptions,
  marketDepositPerUnit,
} from '../sim/market';
import type { EquipSlot } from '../sim/types';
import type { IWorld, MarketListingView } from '../world_api';
import { markDialogRoot } from './dialog_root';
import { dropdownKeyNav } from './dropdown_nav';
import { computeDropdownPlacement } from './dropdown_position';
import { itemDisplayName } from './entity_i18n';
import { esc } from './esc';
import { formatMoney as formatLocalizedMoney, formatNumber, t } from './i18n';
import { QUALITY_COLOR } from './icons';
import {
  MARKET_ARMOR_TYPE_FILTERS,
  MARKET_ITEM_TYPE_FILTERS,
  MARKET_RARITY_FILTERS,
  MARKET_SORT_ORDERS,
  MARKET_WEAPON_TYPE_FILTERS,
  type MarketItemTypeFilter,
  type MarketQuery,
  type MarketRarityFilter,
  type MarketSortOrder,
  type MarketSubtypeFilter,
} from './market_filters';
import {
  buildMarketView,
  COPPER_PER_GOLD,
  COPPER_PER_SILVER,
  type MarketBrowseBody,
  type MarketCollectBody,
  type MarketSellBody,
  type MarketSellMeta,
  type MarketTab,
  marketCollectBadgeCount,
} from './market_view';
import type { PainterHostPresentation } from './painter_host';
import { lockoutParts, lockoutShape } from './raid_lockout';
import { svgIcon } from './ui_icons';

// The unranked quality fallback as a CSS custom property. The
// shared QUALITY_COLOR map carries the real per-quality hex; this token covers a
// listing whose item has no quality field, so no raw hex lives in the painter.
const QUALITY_DEFAULT_COLOR = 'var(--color-quality-default)';

// The filter dropdown's natural size (mirrors .mkt-select-menu's max-height/gap in
// components.css). #market-window clips with overflow: hidden on mobile, and a menu
// that renders past that clip has no scroll path to the rest of it, so every open
// recomputes placement against the window's actual clip box instead of assuming
// there is always room below the trigger.
const MKT_MENU_PREFERRED_HEIGHT = 236;
const MKT_MENU_GAP = 4;
const MKT_MENU_MIN_HEIGHT = 80;

/**
 * Hud-supplied glue. Composes the shared PainterHostPresentation bag
 * (icon/money/tooltip) and adds the market-specific surface: world reads +
 * commands, cross-window bag sync (the Sell tab drags from bags), focus capture
 * for WCAG focus-return, and the localized slot name for the armor subtype menu.
 */
export interface MarketWindowDeps extends PainterHostPresentation {
  root(): HTMLElement;
  world(): IWorld;
  closeOthers(): void;
  hideTooltip(): void;
  captureFocus(): HTMLElement | null;
  restoreFocus(target: HTMLElement | null): void;
  showError(text: string): void;
  slotName(slot: EquipSlot): string;
  /** The shared modal confirm prompt (reused verbatim from talents/questlog). */
  confirmDialog(
    title: string,
    body: string,
    okText: string,
    cancelText: string,
    onOk: () => void,
  ): void;
  /** Render the bags window and, when `open`, reveal it alongside the market. */
  syncBags(open: boolean): void;
}

export class MarketWindow {
  private opened = false;
  private tab: MarketTab = 'browse';
  private itemTypeFilter: MarketItemTypeFilter = 'all';
  private subtypeFilter: MarketSubtypeFilter = 'all';
  private rarityFilter: MarketRarityFilter = 'all';
  private sortOrder: MarketSortOrder = 'newest';
  private browsePage = 0;
  private sellItemId: string | null = null;
  private sellKind: 'fixed' | 'auction' = 'fixed';
  private sellDurationHours: MarketDurationHours = 48;
  private searchQuery = '';
  private lastSig = '';
  private openerFocus: HTMLElement | null = null;

  constructor(private readonly deps: MarketWindowDeps) {}

  get isOpen(): boolean {
    return this.opened;
  }

  /** True while the Sell tab is showing (the bags window stages items into it). */
  get isSellTab(): boolean {
    return this.opened && this.tab === 'sell';
  }

  open(): void {
    this.deps.closeOthers();
    this.openerFocus = this.deps.captureFocus();
    this.opened = true;
    this.tab = 'browse';
    this.itemTypeFilter = 'all';
    this.subtypeFilter = 'all';
    this.rarityFilter = 'all';
    this.sortOrder = 'newest';
    this.browsePage = 0;
    this.sellItemId = null;
    this.sellKind = 'fixed';
    this.sellDurationHours = 48;
    this.searchQuery = '';
    this.pushQuery();
    this.lastSig = '';
    this.render();
    this.deps.root().style.display = 'flex';
    // Bags ride alongside so you can click items straight onto the Sell tab.
    this.deps.syncBags(true);
    audio.bagOpen();
  }

  close(): void {
    if (!this.opened) return;
    this.opened = false;
    this.sellItemId = null;
    this.deps.root().style.display = 'none';
    this.deps.hideTooltip();
    this.deps.syncBags(false);
    this.deps.restoreFocus(this.openerFocus);
    this.openerFocus = null;
  }

  /** Stage a bag item onto the Sell tab (called by the bags window on click). */
  stageSell(itemId: string): void {
    this.sellItemId = itemId;
    this.render();
  }

  /** The current browse query (search + filters + page) the UI sends to the server. */
  private currentQuery(): MarketQuery {
    return {
      search: this.searchQuery,
      itemType: this.itemTypeFilter,
      subtype: this.subtypeFilter,
      rarity: this.rarityFilter,
      sort: this.sortOrder,
      page: this.browsePage,
    };
  }

  // Push the current query to the server, which filters + paginates the whole market
  // and streams back the matching page. Offline (Sim) this resolves synchronously, so
  // the snapshot is up to date by the next render; online it round-trips and the
  // per-frame refreshIfChanged repaints when the new page arrives.
  private pushQuery(): void {
    this.deps.world().marketSearch(this.currentQuery());
  }

  // Per-frame (slow divider): refresh the live lists (Browse/Collect) when they
  // change. The Sell tab holds typed inputs, so it is only rebuilt on actions.
  refreshIfChanged(): void {
    if (!this.opened || this.tab === 'sell') return;
    const info = this.deps.world().marketInfo;
    const sig = JSON.stringify([
      this.tab,
      this.itemTypeFilter,
      this.subtypeFilter,
      this.rarityFilter,
      this.sortOrder,
      this.browsePage,
      info?.listings,
      info?.totalCount,
      info?.filter,
      info?.page,
      info?.pageCount,
      info?.collectionCopper,
      info?.collectionItems,
    ]);
    if (sig === this.lastSig) return;
    this.lastSig = sig;
    const collectTab = this.deps.root().querySelector('[data-tab="collect"]');
    if (collectTab) {
      const n = marketCollectBadgeCount(info);
      collectTab.textContent =
        n > 0
          ? t('itemUi.market.collectWithCount', {
              count: formatNumber(n, { maximumFractionDigits: 0 }),
            })
          : t('itemUi.market.collect');
    }
    this.renderContent();
  }

  render(): void {
    const el = this.deps.root();
    this.deps.hideTooltip();
    // WCAG 2.2 AA: name the focus-trapped root with a dialog role.
    markDialogRoot(el, { label: t('itemUi.market.title') });
    const info = this.deps.world().marketInfo;
    const tabLabel = (id: MarketTab): string => {
      if (id === 'browse') return t('itemUi.market.browse');
      if (id === 'sell') return t('itemUi.market.sell');
      const n = marketCollectBadgeCount(info);
      return n > 0
        ? t('itemUi.market.collectWithCount', {
            count: formatNumber(n, { maximumFractionDigits: 0 }),
          })
        : t('itemUi.market.collect');
    };
    const tab = (id: MarketTab) =>
      `<button type="button" class="mkt-tab${this.tab === id ? ' sel' : ''}" data-tab="${id}" aria-pressed="${this.tab === id ? 'true' : 'false'}">${esc(tabLabel(id))}</button>`;
    el.innerHTML =
      `<div class="panel-title"><span>${esc(t('itemUi.market.title'))} <span class="panel-subtitle">${esc(t('itemUi.market.subtitle'))}</span></span><button type="button" class="x-btn" data-close aria-label="${esc(t('itemUi.market.close'))}">${svgIcon('close')}</button></div>` +
      `<div class="mkt-tabs">` +
      tab('browse') +
      tab('sell') +
      tab('collect') +
      `</div>` +
      this.renderMarketFilters() +
      `<div id="market-body"></div>`;
    el.querySelector('[data-close]')?.addEventListener('click', () => this.close());
    el.querySelectorAll('[data-tab]').forEach((node) => {
      node.addEventListener('click', () => {
        const next = (node as HTMLElement).dataset.tab as MarketTab;
        if (next === this.tab) return;
        this.tab = next;
        this.browsePage = 0;
        this.lastSig = '';
        audio.click();
        this.render();
        // Keyboard focus would otherwise fall to <body> when render() rebuilds the
        // tab strip; land it on the newly selected tab instead (WCAG 2.4.3).
        (this.deps.root().querySelector(`[data-tab="${next}"]`) as HTMLElement | null)?.focus();
      });
    });
    const closeFilterMenus = () => {
      el.querySelectorAll<HTMLElement>('.mkt-select.open').forEach((menu) => {
        menu.classList.remove('open', 'open-up');
        menu
          .querySelector<HTMLButtonElement>('.mkt-select-btn')
          ?.setAttribute('aria-expanded', 'false');
        const list = menu.querySelector<HTMLElement>('.mkt-select-menu');
        if (list) {
          list.hidden = true;
          list.style.maxHeight = '';
        }
      });
    };
    const positionFilterMenu = (menu: HTMLElement) => {
      const trigger = menu.querySelector<HTMLButtonElement>('.mkt-select-btn');
      const list = menu.querySelector<HTMLElement>('.mkt-select-menu');
      // `el` (deps.root()) already IS #market-window, so there is no separate
      // container to look up: querySelector('#market-window') on the window
      // itself never matches its own root and would always fall back to `el`.
      if (!trigger || !list) return;
      const t = trigger.getBoundingClientRect();
      const c = el.getBoundingClientRect();
      // #market-window clips at its padding box (overflow: hidden), which sits
      // inset from the border box measured above by the panel's border width on
      // each edge; subtract it so the clamp matches the real clip, not the
      // border-inclusive box.
      const borderTop = Number.parseFloat(getComputedStyle(el).borderTopWidth) || 0;
      const borderBottom = Number.parseFloat(getComputedStyle(el).borderBottomWidth) || 0;
      const placement = computeDropdownPlacement({
        triggerTop: t.top,
        triggerBottom: t.bottom,
        containerTop: c.top + borderTop,
        containerBottom: c.bottom - borderBottom,
        preferredMaxHeight: MKT_MENU_PREFERRED_HEIGHT,
        gap: MKT_MENU_GAP,
        minHeight: MKT_MENU_MIN_HEIGHT,
      });
      menu.classList.toggle('open-up', placement.side === 'above');
      list.style.maxHeight = `${placement.maxHeight}px`;
    };
    el.querySelectorAll<HTMLButtonElement>('.mkt-select-btn').forEach((button) => {
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        const menu = button.closest<HTMLElement>('.mkt-select');
        if (!menu) return;
        const wantOpen = !menu.classList.contains('open');
        closeFilterMenus();
        menu.classList.toggle('open', wantOpen);
        button.setAttribute('aria-expanded', wantOpen ? 'true' : 'false');
        const list = menu.querySelector<HTMLElement>('.mkt-select-menu');
        if (list) list.hidden = !wantOpen;
        if (wantOpen) positionFilterMenu(menu);
      });
    });
    el.querySelectorAll<HTMLButtonElement>('[data-market-filter-option]').forEach((option) => {
      option.addEventListener('click', () => {
        const menu = option.closest<HTMLElement>('[data-market-filter-menu]');
        const key = menu?.dataset.marketFilterMenu;
        const value = option.dataset.marketFilterOption ?? 'all';
        if (key === 'itemType') {
          const next = value as MarketItemTypeFilter;
          if (next !== this.itemTypeFilter) {
            this.itemTypeFilter = next;
            this.subtypeFilter = 'all';
            this.browsePage = 0;
          }
        } else if (key === 'subtype') {
          this.subtypeFilter = value as MarketSubtypeFilter;
          this.browsePage = 0;
        } else if (key === 'rarity') {
          this.rarityFilter = value as MarketRarityFilter;
          this.browsePage = 0;
        } else if (key === 'sort') {
          this.sortOrder = value as MarketSortOrder;
          this.browsePage = 0;
        } else {
          return;
        }
        this.pushQuery(); // filtering is server-side now, so the query must round-trip
        this.lastSig = '';
        audio.click();
        this.render();
        // Return focus to the filter's trigger button after render() rebuilds the
        // menus, so a keyboard user is not dropped to <body> (WCAG 2.4.3).
        const newMenu = this.deps.root().querySelector(`[data-market-filter-menu="${key}"]`);
        (
          newMenu?.closest('.mkt-select')?.querySelector('.mkt-select-btn') as HTMLElement | null
        )?.focus();
      });
    });
    // Keyboard operation of the filter listboxes via the shared dropdownKeyNav core (the
    // same WAI-ARIA listbox pattern buildDropdown wires onto its custom listbox): roving
    // focus through the options, Enter/Space commit, Escape/Tab close returning focus to the
    // trigger. The options carry tabindex=-1 (out of the Tab order but programmatically
    // focusable); the mouse toggle, the click-away close, and the option-click commit above
    // are reused unchanged (select dispatches a real click on the focused option).
    el.querySelectorAll<HTMLElement>('.mkt-select').forEach((select) => {
      const trigger = select.querySelector<HTMLButtonElement>('.mkt-select-btn');
      const options = Array.from(select.querySelectorAll<HTMLElement>('.mkt-select-option'));
      const focusedIndex = () =>
        document.activeElement instanceof HTMLElement
          ? options.indexOf(document.activeElement)
          : -1;
      select.addEventListener('keydown', (event) => {
        const ke = event as KeyboardEvent;
        const action = dropdownKeyNav(
          ke.key,
          select.classList.contains('open'),
          focusedIndex(),
          options.length,
        );
        if (action.kind === 'none') return;
        // Tab closes and returns focus to the trigger WITHOUT preventDefault, so native Tab
        // then advances from a real tab-order element (matches buildDropdown's tab branch).
        if (action.kind === 'tab') {
          closeFilterMenus();
          trigger?.focus();
          return;
        }
        // preventDefault suppresses the native button activation (Enter/Space) so the open
        // and select paths below are the only ones that fire, exactly as buildDropdown does.
        ke.preventDefault();
        switch (action.kind) {
          case 'open': {
            closeFilterMenus();
            select.classList.add('open');
            trigger?.setAttribute('aria-expanded', 'true');
            const list = select.querySelector<HTMLElement>('.mkt-select-menu');
            if (list) list.hidden = false;
            positionFilterMenu(select);
            options[action.index]?.focus();
            break;
          }
          case 'move':
            options[action.index]?.focus();
            break;
          case 'select':
            options[focusedIndex()]?.click();
            break;
          case 'close':
            closeFilterMenus();
            trigger?.focus();
            break;
        }
      });
    });
    el.addEventListener('click', closeFilterMenus);
    this.renderContent();
  }

  private renderContent(): void {
    const body = this.deps.root().querySelector<HTMLElement>('#market-body');
    if (!body) return;
    const view = buildMarketView({
      info: this.deps.world().marketInfo,
      tab: this.tab,
      filters: {
        itemType: this.itemTypeFilter,
        subtype: this.subtypeFilter,
        rarity: this.rarityFilter,
      },
      sellItemId: this.sellItemId,
      sellHave: this.sellItemId ? this.bagCount(this.sellItemId) : 0,
    });
    if (view.kind === 'no-data') {
      body.innerHTML = `<div class="mkt-empty">${esc(t('itemUi.market.noMerchant'))}</div>`;
      return;
    }
    if (view.kind === 'browse') {
      this.renderBrowse(body, view.body);
      return;
    }
    if (view.kind === 'sell') {
      this.renderSell(body, view.body, view.meta);
      return;
    }
    this.renderCollect(body, view.body);
  }

  private renderBrowse(body: HTMLElement, view: MarketBrowseBody): void {
    // Reuse the search field and list container across refreshes so typing in
    // the box never loses focus when the server streams back filtered results.
    let search = body.querySelector('.mkt-search') as HTMLInputElement | null;
    let list = body.querySelector('.mkt-list') as HTMLElement | null;
    if (!search || !list) {
      body.innerHTML = '';
      search = document.createElement('input');
      search.type = 'search';
      search.className = 'mkt-search';
      search.placeholder = t('itemUi.market.searchPlaceholder');
      search.setAttribute('aria-label', t('itemUi.market.searchAria'));
      search.value = this.searchQuery;
      search.addEventListener('input', () => {
        if (!search) return;
        this.searchQuery = search.value;
        this.browsePage = 0;
        this.pushQuery();
      });
      body.appendChild(search);
      list = document.createElement('div');
      list.className = 'mkt-list';
      body.appendChild(list);
    }
    // lazy-load a11y: the Browse search round-trips through the
    // server (sync offline, async online) and streams results back into the list. A
    // persistent off-screen polite status node announces the new result count (or the
    // empty reason) so a screen-reader user hears that the async results arrived. It
    // updates only when renderContent re-runs on a real signature change, so it never
    // floods. visually-hidden mirrors the #combat-live utility class.
    let status = body.querySelector('.mkt-status') as HTMLElement | null;
    if (!status) {
      status = document.createElement('div');
      status.className = 'mkt-status visually-hidden';
      status.setAttribute('role', 'status');
      status.setAttribute('aria-live', 'polite');
      body.appendChild(status);
    }
    // Keep the field in sync on external resets, but never clobber active typing.
    if (document.activeElement !== search && search.value !== this.searchQuery) {
      search.value = this.searchQuery;
    }
    list.innerHTML = '';
    if (view.state === 'empty') {
      if (view.reason === 'filtered') this.browsePage = 0;
      const empty = document.createElement('div');
      empty.className = 'mkt-empty';
      empty.textContent =
        view.reason === 'search'
          ? t('itemUi.market.emptySearch')
          : view.reason === 'filtered'
            ? t('itemUi.market.emptyFiltered')
            : t('itemUi.market.emptyBrowse');
      list.appendChild(empty);
      status.textContent = empty.textContent;
      return;
    }
    const page = view.page;
    this.browsePage = page.page;
    // The range note describes the paged OTHER listings; on a page with none (e.g. only
    // the viewer's own listings match) it is skipped, leaving just the rows.
    if (page.end > page.start) {
      const note = document.createElement('div');
      note.className = 'mkt-note';
      const shown = `${formatNumber(page.start + 1, { maximumFractionDigits: 0 })}-${formatNumber(page.end, { maximumFractionDigits: 0 })}`;
      const total = formatNumber(page.total, { maximumFractionDigits: 0 });
      note.textContent = t('itemUi.market.pageRange', { shown, total });
      list.appendChild(note);
      status.textContent = note.textContent;
    } else {
      status.textContent = t('itemUi.market.pageRange', {
        shown: formatNumber(page.items.length, { maximumFractionDigits: 0 }),
        total: formatNumber(page.total, { maximumFractionDigits: 0 }),
      });
    }
    for (const { listing: l, item } of page.items) {
      const qColor = QUALITY_COLOR[item.quality ?? 'common'] ?? QUALITY_DEFAULT_COLOR;
      const row = document.createElement('div');
      row.className = 'mkt-row';
      const itemName = itemDisplayName(item);
      const stack =
        l.count > 1
          ? ` <span class="stack">${esc(t('itemUi.market.stackCount', { count: formatNumber(l.count, { maximumFractionDigits: 0 }) }))}</span>`
          : '';
      const myBidBadge = l.myBid
        ? ` <span class="mkt-mybid">${esc(t('itemUi.market.yourBidBadge'))}</span>`
        : '';
      const timeLeft =
        l.secondsLeft >= 0
          ? `<br><span class="time-left">${esc(t('itemUi.market.timeLeft', { time: this.formatTimeLeft(l.secondsLeft) }))}</span>`
          : '';
      row.innerHTML =
        `${this.deps.itemIcon(item)}` +
        `<span class="mkt-name"><span class="nm" style="color:${qColor}">${esc(itemName)}${stack}${myBidBadge}</span>` +
        `<span class="seller${l.house ? ' house' : ''}">${esc(l.house ? t('itemUi.market.merchantStock') : l.sellerName)}</span>${timeLeft}</span>` +
        this.marketPriceCellHtml(l);
      this.appendMarketRowAction(row, l, itemName);
      this.deps.attachTooltip(row, () => this.deps.itemTooltip(item));
      list.appendChild(row);
    }
    if (page.pageCount > 1) {
      const pager = document.createElement('div');
      pager.className = 'mkt-page';
      const pageNumber = formatNumber(page.page + 1, { maximumFractionDigits: 0 });
      const pageCount = formatNumber(page.pageCount, { maximumFractionDigits: 0 });
      pager.innerHTML =
        `<button type="button" class="mkt-page-btn" data-market-page="prev"${page.page <= 0 ? ' disabled' : ''} aria-label="${esc(t('itemUi.market.pagePrevAria'))}">${esc(t('itemUi.market.pagePrev'))}</button>` +
        `<span class="mkt-page-info">${esc(t('itemUi.market.pageStatus', { current: pageNumber, total: pageCount }))}</span>` +
        `<button type="button" class="mkt-page-btn" data-market-page="next"${page.page >= page.pageCount - 1 ? ' disabled' : ''} aria-label="${esc(t('itemUi.market.pageNextAria'))}">${esc(t('itemUi.market.pageNext'))}</button>`;
      pager.querySelectorAll<HTMLButtonElement>('[data-market-page]').forEach((button) => {
        button.addEventListener('click', () => {
          if (button.disabled) return;
          const dir = button.dataset.marketPage;
          this.browsePage = Math.max(0, this.browsePage + (dir === 'next' ? 1 : -1));
          this.pushQuery(); // the server returns the requested page of listings
          this.lastSig = '';
          audio.click();
          this.renderContent();
          body.scrollTop = 0;
          // The pager is rebuilt by renderContent, so move focus to the matching new
          // page button (or any enabled pager button if it became disabled at an end),
          // keeping the keyboard user off <body> (WCAG 2.4.3).
          const refocus = body.querySelector<HTMLButtonElement>(`[data-market-page="${dir}"]`);
          if (refocus && !refocus.disabled) refocus.focus();
          else body.querySelector<HTMLButtonElement>('[data-market-page]:not([disabled])')?.focus();
        });
      });
      list.appendChild(pager);
    }
  }

  private renderSell(body: HTMLElement, view: MarketSellBody, meta: MarketSellMeta): void {
    body.innerHTML = `<div class="mkt-note">${esc(
      t('itemUi.market.sellNote', {
        cut: formatNumber(meta.cutPct, { maximumFractionDigits: 0 }),
        used: formatNumber(meta.myListingCount, { maximumFractionDigits: 0 }),
        max: formatNumber(meta.maxListings, { maximumFractionDigits: 0 }),
      }),
    )}</div>`;
    if (view.state === 'pick-empty') {
      const pick = document.createElement('div');
      pick.className = 'mkt-sell-pick empty';
      pick.textContent = t('itemUi.market.sellPickEmpty');
      body.appendChild(pick);
      return;
    }
    if (view.state === 'cannot-market') {
      this.sellItemId = null;
      const pick = document.createElement('div');
      pick.className = 'mkt-sell-pick empty';
      pick.textContent = t('itemUi.tooltip.cannotMarket');
      body.appendChild(pick);
      return;
    }
    const { item, have, suggested } = view.form;
    const qColor = QUALITY_COLOR[item.quality ?? 'common'] ?? QUALITY_DEFAULT_COLOR;
    const pick = document.createElement('div');
    pick.className = 'mkt-sell-pick';
    pick.innerHTML = `${this.deps.itemIcon(item)}<span class="ps-name" style="color:${qColor}">${esc(itemDisplayName(item))}</span>`;
    body.appendChild(pick);

    // Listing-type toggle (fixed price / auction): two small buttons, not the
    // filter-menu listbox (a 2-way choice does not need one) and not a slider
    // (numeric-input precedent, docs/hud-program-validation-report.md M7).
    const kindToggle = document.createElement('div');
    kindToggle.className = 'mkt-type-toggle';
    kindToggle.setAttribute('role', 'group');
    kindToggle.setAttribute('aria-label', t('itemUi.market.listingTypeLabel'));
    kindToggle.innerHTML = (['fixed', 'auction'] as const)
      .map(
        (kind) =>
          `<button type="button" class="mkt-type-btn${this.sellKind === kind ? ' sel' : ''}" data-sell-kind="${kind}" aria-pressed="${this.sellKind === kind ? 'true' : 'false'}">${esc(t(kind === 'fixed' ? 'itemUi.market.listingTypeFixed' : 'itemUi.market.listingTypeAuction'))}</button>`,
      )
      .join('');
    kindToggle.querySelectorAll<HTMLButtonElement>('[data-sell-kind]').forEach((button) => {
      button.addEventListener('click', () => {
        const next = button.dataset.sellKind as 'fixed' | 'auction';
        if (next === this.sellKind) return;
        this.sellKind = next;
        audio.click();
        this.renderContent();
      });
    });
    body.appendChild(kindToggle);

    // Duration toggle (12h / 24h / 48h): same small-button pattern as the type
    // toggle above, driven by the sim's own duration list (meta.durationsHours)
    // so the UI can never drift from what marketList will accept.
    const durationToggle = document.createElement('div');
    durationToggle.className = 'mkt-duration-toggle';
    durationToggle.setAttribute('role', 'group');
    durationToggle.setAttribute('aria-label', t('itemUi.market.durationLabel'));
    durationToggle.innerHTML = meta.durationsHours
      .map((hours) => {
        const sel = this.sellDurationHours === hours;
        return `<button type="button" class="mkt-duration-btn${sel ? ' sel' : ''}" data-sell-duration="${hours}" aria-pressed="${sel ? 'true' : 'false'}">${esc(t('itemUi.market.durationOption', { hours: formatNumber(hours, { maximumFractionDigits: 0 }) }))}</button>`;
      })
      .join('');
    durationToggle.querySelectorAll<HTMLButtonElement>('[data-sell-duration]').forEach((button) => {
      button.addEventListener('click', () => {
        const next = Number(button.dataset.sellDuration) as MarketDurationHours;
        if (next === this.sellDurationHours) return;
        this.sellDurationHours = next;
        audio.click();
        this.renderContent();
      });
    });
    body.appendChild(durationToggle);

    const form = document.createElement('div');
    form.className = 'mkt-price-form';
    const qtyRow =
      have > 1
        ? `<div class="mkt-price-row"><label for="mkt-qty">${esc(t('itemUi.market.quantity'))}</label><input class="coininput" id="mkt-qty" type="number" min="1" max="${have}" value="${have}"> <span class="mkt-coin-tag">${esc(t('itemUi.market.quantityOf', { count: formatNumber(have, { maximumFractionDigits: 0 }) }))}</span></div>`
        : '';
    const priceLabel =
      this.sellKind === 'auction'
        ? t('itemUi.market.startingBidLabel')
        : t('itemUi.market.priceEach');
    const priceRow =
      `<div class="mkt-price-row"><label>${esc(priceLabel)}</label>` +
      `<input class="coininput" id="mkt-g" type="number" min="0" value="${suggested.gold}" aria-label="${esc(t('itemUi.money.gold'))}"><span class="coin g" aria-hidden="true"></span><span class="mkt-coin-tag">${esc(t('itemUi.money.goldShort'))}</span>` +
      `<input class="coininput" id="mkt-s" type="number" min="0" max="99" value="${suggested.silver}" aria-label="${esc(t('itemUi.money.silver'))}"><span class="coin s" aria-hidden="true"></span><span class="mkt-coin-tag">${esc(t('itemUi.money.silverShort'))}</span>` +
      `<input class="coininput" id="mkt-c" type="number" min="0" max="99" value="${suggested.copper}" aria-label="${esc(t('itemUi.money.copper'))}"><span class="coin c" aria-hidden="true"></span><span class="mkt-coin-tag">${esc(t('itemUi.money.copperShort'))}</span></div>`;
    const totalRow =
      this.sellKind === 'fixed'
        ? `<div class="mkt-price-row"><label>${esc(t('itemUi.market.totalLabel'))}</label><span id="mkt-total" class="mkt-coin-tag"></span></div>`
        : '';
    const buyoutRow =
      this.sellKind === 'auction'
        ? `<div class="mkt-price-row"><label>${esc(t('itemUi.market.buyoutOptionalLabel'))}</label>` +
          `<input class="coininput" id="mkt-bo-g" type="number" min="0" value="0" aria-label="${esc(t('itemUi.money.gold'))}"><span class="coin g" aria-hidden="true"></span><span class="mkt-coin-tag">${esc(t('itemUi.money.goldShort'))}</span>` +
          `<input class="coininput" id="mkt-bo-s" type="number" min="0" max="99" value="0" aria-label="${esc(t('itemUi.money.silver'))}"><span class="coin s" aria-hidden="true"></span><span class="mkt-coin-tag">${esc(t('itemUi.money.silverShort'))}</span>` +
          `<input class="coininput" id="mkt-bo-c" type="number" min="0" max="99" value="0" aria-label="${esc(t('itemUi.money.copper'))}"><span class="coin c" aria-hidden="true"></span><span class="mkt-coin-tag">${esc(t('itemUi.money.copperShort'))}</span></div>`
        : '';
    const depositRow = `<div class="mkt-price-row"><label>${esc(t('itemUi.market.depositPreviewLabel'))}</label><span id="mkt-deposit" class="mkt-coin-tag"></span></div>`;
    form.innerHTML = qtyRow + priceRow + totalRow + buyoutRow + depositRow;
    body.appendChild(form);

    const inputVal = (id: string): number => {
      const el = this.deps.root().querySelector(`#${id}`) as HTMLInputElement | null;
      return Math.max(0, parseInt(el?.value || '0', 10) || 0);
    };
    const readQty = (): number => (have > 1 ? Math.max(1, Math.min(have, inputVal('mkt-qty'))) : 1);
    const readEach = (): number =>
      inputVal('mkt-g') * COPPER_PER_GOLD +
      inputVal('mkt-s') * COPPER_PER_SILVER +
      inputVal('mkt-c');
    const readBuyout = (): number =>
      this.sellKind === 'auction'
        ? inputVal('mkt-bo-g') * COPPER_PER_GOLD +
          inputVal('mkt-bo-s') * COPPER_PER_SILVER +
          inputVal('mkt-bo-c')
        : 0;
    const totalEl = body.querySelector('#mkt-total') as HTMLElement | null;
    const depositEl = body.querySelector('#mkt-deposit') as HTMLElement;
    const refreshLivePreview = () => {
      const qty = readQty();
      if (totalEl) totalEl.textContent = formatLocalizedMoney(readEach() * qty);
      depositEl.textContent = formatLocalizedMoney(
        marketDepositPerUnit(item, this.sellDurationHours) * qty,
      );
    };
    body
      .querySelectorAll<HTMLInputElement>(
        '#mkt-qty, #mkt-g, #mkt-s, #mkt-c, #mkt-bo-g, #mkt-bo-s, #mkt-bo-c',
      )
      .forEach((input) => {
        input.addEventListener('input', refreshLivePreview);
      });
    refreshLivePreview();

    const listBtn = document.createElement('button');
    listBtn.className = 'mkt-list-btn';
    listBtn.textContent = t('itemUi.market.listButton');
    listBtn.addEventListener('click', () => {
      const qty = readQty();
      const each = readEach();
      const opts: MarketListOptions = { durationHours: this.sellDurationHours };
      if (this.sellKind === 'auction') {
        if (each < 1) {
          this.deps.showError(t('itemUi.errors.minStartingBid'));
          return;
        }
        const buyout = readBuyout();
        if (buyout > 0 && buyout <= each) {
          this.deps.showError(t('itemUi.errors.buyoutTooLow'));
          return;
        }
        opts.auction = { startingBid: each, buyoutPrice: buyout > 0 ? buyout : undefined };
        // pricePerUnit is ignored by the sim for an auction lot; 0 documents that.
        this.deps.world().marketList(view.form.itemId, qty, 0, opts);
      } else {
        if (each < 1) {
          this.deps.showError(t('itemUi.market.minPriceError'));
          return;
        }
        this.deps.world().marketList(view.form.itemId, qty, each, opts);
      }
      this.sellItemId = null;
      audio.coin();
      this.render(); // the next snapshot echoes the new bags + listings
    });
    body.appendChild(listBtn);
  }

  private renderCollect(body: HTMLElement, view: MarketCollectBody): void {
    if (view.state === 'empty') {
      body.innerHTML = `<div class="mkt-empty">${esc(t('itemUi.market.collectEmpty'))}</div>`;
      return;
    }
    body.innerHTML = `<div class="mkt-note">${esc(t('itemUi.market.collectNote'))}</div>`;
    if (view.proceeds > 0) {
      const row = document.createElement('div');
      row.className = 'mkt-collect';
      row.innerHTML = `<span>${esc(t('itemUi.market.saleProceeds'))}</span><span class="mkt-price">${this.deps.moneyHtml(view.proceeds)}</span>`;
      body.appendChild(row);
    }
    for (const { item, count } of view.rows) {
      const qColor = QUALITY_COLOR[item.quality ?? 'common'] ?? QUALITY_DEFAULT_COLOR;
      const row = document.createElement('div');
      row.className = 'mkt-collect';
      const stack =
        count > 1
          ? ` ${t('itemUi.market.stackCount', { count: formatNumber(count, { maximumFractionDigits: 0 }) })}`
          : '';
      row.innerHTML = `<span class="mkt-collect-item">${this.deps.itemIcon(item)}<span style="color:${qColor}">${esc(itemDisplayName(item))}${esc(stack)}</span></span>`;
      this.deps.attachTooltip(row, () => this.deps.itemTooltip(item));
      body.appendChild(row);
    }
    const btn = document.createElement('button');
    btn.className = 'mkt-list-btn';
    btn.textContent = t('itemUi.market.collectAll');
    btn.addEventListener('click', () => {
      this.deps.world().marketCollect();
      audio.coin();
    });
    body.appendChild(btn);
  }

  private bagCount(itemId: string): number {
    return this.deps
      .world()
      .inventory.filter((s) => s.itemId === itemId)
      .reduce((n, s) => n + s.count, 0);
  }

  // ---- Browse row: time-left, price cell, and the buy/bid/reclaim action area ----

  // Whole days/hours/minutes from a listing's secondsLeft, via the same pure
  // lockoutParts/lockoutShape split + hudChrome.raidLockout.* templates the raid
  // lockout badge already uses (hud.ts formatLockoutDuration precedent): no new
  // duration-formatting i18n keys needed for the market's own time-left column.
  private formatTimeLeft(secondsLeft: number): string {
    const ms = secondsLeft * 1000;
    const { days, hours, minutes } = lockoutParts(ms);
    const n = (v: number) => formatNumber(v, { maximumFractionDigits: 0, useGrouping: false });
    switch (lockoutShape(ms)) {
      case 'daysHours':
        return t('hudChrome.raidLockout.daysHours', { d: n(days), h: n(hours) });
      case 'hoursMinutes':
        return t('hudChrome.raidLockout.hoursMinutes', { h: n(hours), m: n(minutes) });
      case 'minutes':
        return t('hudChrome.raidLockout.minutes', { m: n(minutes) });
      default:
        return t('hudChrome.raidLockout.lessThanMinute');
    }
  }

  // The price cell: fixed rows keep the existing total (+ per-unit "each" sub-line
  // for a stack); auction rows show the auction badge, the standing bid (or "no
  // bids yet"), the minimum next bid, and an optional buyout price.
  private marketPriceCellHtml(l: MarketListingView): string {
    if (l.kind === 'auction') {
      const bidLine =
        l.currentBid !== undefined
          ? `${esc(t('itemUi.market.currentBidLabel'))} ${this.deps.moneyHtml(l.currentBid)}`
          : esc(t('itemUi.market.noBidsYet'));
      const minLine =
        l.minNextBid !== undefined
          ? `<br><span class="seller">${esc(t('itemUi.market.minNextBid', { money: formatLocalizedMoney(l.minNextBid) }))}</span>`
          : '';
      const buyoutLine =
        l.buyoutPrice !== undefined
          ? `<br><span class="seller">${esc(t('itemUi.market.buyoutLabel', { money: formatLocalizedMoney(l.buyoutPrice) }))}</span>`
          : '';
      return `<span class="mkt-price"><span class="mkt-auction-badge">${esc(t('itemUi.market.auctionBadge'))}</span><br>${bidLine}${minLine}${buyoutLine}</span>`;
    }
    const each =
      l.count > 1
        ? `<br><span class="seller">${esc(t('itemUi.market.each', { money: formatLocalizedMoney(Math.ceil(l.price / l.count)) }))}</span>`
        : '';
    return `<span class="mkt-price">${this.deps.moneyHtml(l.price)}${each}</span>`;
  }

  // The action area: Reclaim (with a deposit-aware confirm) for the viewer's own
  // listing; Bid input + optional Buyout for an auction lot; a quantity spinner +
  // live total for a per-unit fixed row; the plain Buy button for a legacy
  // whole-lot row (or a single-count fixed row, where a spinner buys nothing).
  private appendMarketRowAction(row: HTMLElement, l: MarketListingView, itemName: string): void {
    if (l.mine) {
      const btn = document.createElement('button');
      btn.className = 'mkt-btn cancel';
      btn.textContent = t('itemUi.market.reclaim');
      btn.setAttribute('aria-label', t('itemUi.market.reclaimAria', { item: itemName }));
      btn.addEventListener('click', () => {
        const deposit = l.depositTotal ?? 0;
        const body =
          deposit > 0
            ? t('itemUi.market.cancelConfirmBody', {
                item: itemName,
                money: formatLocalizedMoney(deposit),
              })
            : t('itemUi.market.cancelConfirmBodyNoDeposit', { item: itemName });
        this.deps.confirmDialog(
          t('itemUi.market.cancelConfirmTitle'),
          body,
          t('itemUi.market.reclaim'),
          t('itemUi.market.cancelConfirmDismiss'),
          () => {
            this.deps.world().marketCancel(l.id);
            audio.click();
          },
        );
      });
      row.appendChild(btn);
      return;
    }
    if (l.kind === 'auction') {
      const actions = document.createElement('div');
      actions.className = 'mkt-auction-actions';
      if (l.buyoutPrice !== undefined) {
        const buyoutBtn = document.createElement('button');
        buyoutBtn.className = 'mkt-btn';
        buyoutBtn.textContent = t('itemUi.market.buyoutButton');
        buyoutBtn.setAttribute(
          'aria-label',
          t('itemUi.market.buyoutAria', {
            item: itemName,
            price: formatLocalizedMoney(l.buyoutPrice),
          }),
        );
        buyoutBtn.addEventListener('click', () => {
          this.deps.world().marketBuy(l.id);
          audio.click();
        });
        actions.appendChild(buyoutBtn);
      }
      if (l.myBid) {
        const badge = document.createElement('span');
        badge.className = 'mkt-mybid-lead';
        badge.textContent = t('itemUi.market.leadingBid');
        actions.appendChild(badge);
      } else {
        const min = l.minNextBid ?? 1;
        const form = document.createElement('div');
        form.className = 'mkt-bid-form';
        form.innerHTML =
          `<input class="coininput mkt-bid-input" type="number" min="${min}" step="1" value="${min}" aria-label="${esc(t('itemUi.market.bidInputAria', { item: itemName }))}">` +
          `<button type="button" class="mkt-btn">${esc(t('itemUi.market.bidButton'))}</button>`;
        const input = form.querySelector('input') as HTMLInputElement;
        const bidBtn = form.querySelector('button') as HTMLButtonElement;
        bidBtn.setAttribute('aria-label', t('itemUi.market.bidAria', { item: itemName }));
        bidBtn.addEventListener('click', () => {
          const amount = Math.max(min, parseInt(input.value, 10) || min);
          this.deps.world().marketBid(l.id, amount);
          audio.click();
        });
        actions.appendChild(form);
      }
      row.appendChild(actions);
      return;
    }
    if (l.pricePerUnit !== undefined && l.count > 1) {
      const perUnit = l.pricePerUnit;
      const form = document.createElement('div');
      form.className = 'mkt-buy-form';
      form.innerHTML =
        `<input class="coininput mkt-qty-input" type="number" min="1" max="${l.count}" value="${l.count}" aria-label="${esc(t('itemUi.market.buyQuantityAria', { item: itemName }))}">` +
        `<span class="mkt-buy-total"></span>` +
        `<button type="button" class="mkt-btn">${esc(t('itemUi.market.buy'))}</button>`;
      const input = form.querySelector('input') as HTMLInputElement;
      const totalEl = form.querySelector('.mkt-buy-total') as HTMLElement;
      const buyBtn = form.querySelector('button') as HTMLButtonElement;
      const clampedQty = () => Math.max(1, Math.min(l.count, parseInt(input.value, 10) || 1));
      const updateTotal = () => {
        totalEl.textContent = formatLocalizedMoney(clampedQty() * perUnit);
      };
      input.addEventListener('input', updateTotal);
      updateTotal();
      buyBtn.setAttribute(
        'aria-label',
        t('itemUi.market.buyAria', { item: itemName, price: formatLocalizedMoney(perUnit) }),
      );
      buyBtn.addEventListener('click', () => {
        this.deps.world().marketBuy(l.id, clampedQty());
        audio.click();
      });
      row.appendChild(form);
      return;
    }
    const btn = document.createElement('button');
    btn.className = 'mkt-btn';
    btn.textContent = t('itemUi.market.buy');
    btn.setAttribute(
      'aria-label',
      t('itemUi.market.buyAria', { item: itemName, price: formatLocalizedMoney(l.price) }),
    );
    btn.addEventListener('click', () => {
      this.deps.world().marketBuy(l.id);
      audio.click();
    });
    row.appendChild(btn);
  }

  // ---- Filter chrome (the browse-tab type/subtype/rarity/sort dropdowns) ----

  private marketItemTypeLabel(filter: MarketItemTypeFilter): string {
    if (filter === 'weapon') return t('itemUi.market.filterTypeWeapon');
    if (filter === 'armor') return t('itemUi.market.filterTypeArmor');
    if (filter === 'consumable') return t('itemUi.market.filterTypeConsumable');
    if (filter === 'material') return t('itemUi.market.filterTypeMaterial');
    if (filter === 'cosmetic') return t('itemUi.market.filterTypeCosmetic');
    if (filter === 'other') return t('itemUi.market.filterTypeOther');
    return t('itemUi.market.filterTypeAll');
  }

  private marketRarityLabel(filter: MarketRarityFilter): string {
    if (filter === 'poor') return t('itemUi.market.rarityPoor');
    if (filter === 'common') return t('itemUi.market.rarityCommon');
    if (filter === 'uncommon') return t('itemUi.market.rarityUncommon');
    if (filter === 'rare') return t('itemUi.market.rarityRare');
    if (filter === 'epic') return t('itemUi.market.rarityEpic');
    return t('itemUi.market.filterRarityAll');
  }

  private marketSubtypeOptions(): readonly MarketSubtypeFilter[] {
    if (this.itemTypeFilter === 'armor') return MARKET_ARMOR_TYPE_FILTERS;
    if (this.itemTypeFilter === 'weapon') return MARKET_WEAPON_TYPE_FILTERS;
    return ['all'];
  }

  private marketSubtypeLabel(): string {
    return t(
      this.itemTypeFilter === 'armor'
        ? 'itemUi.market.filterArmorType'
        : 'itemUi.market.filterWeaponType',
    );
  }

  private marketSubtypeOptionLabel(filter: MarketSubtypeFilter): string {
    if (filter === 'all')
      return t(
        this.itemTypeFilter === 'armor'
          ? 'itemUi.market.filterArmorAll'
          : 'itemUi.market.filterWeaponAll',
      );
    if (this.itemTypeFilter === 'armor') return this.deps.slotName(filter as EquipSlot);
    if (filter === 'sword') return t('itemUi.market.weaponSword');
    if (filter === 'dagger') return t('itemUi.market.weaponDagger');
    if (filter === 'staff') return t('itemUi.market.weaponStaff');
    if (filter === 'mace') return t('itemUi.market.weaponMace');
    if (filter === 'axe') return t('itemUi.market.weaponAxe');
    return t('itemUi.market.weaponOther');
  }

  private marketSortLabel(sort: MarketSortOrder): string {
    if (sort === 'priceAsc') return t('itemUi.market.sortPrice');
    if (sort === 'timeLeft') return t('itemUi.market.sortTimeLeft');
    return t('itemUi.market.sortNewest');
  }

  private renderMarketFilterMenu(
    menu: 'itemType' | 'subtype' | 'rarity' | 'sort',
    label: string,
    value: string,
    options: readonly string[],
    optionLabel: (option: string) => string,
  ): string {
    const current = optionLabel(value);
    const optionHtml = options
      .map((option) => {
        const selected = option === value;
        return `<button type="button" class="mkt-select-option${selected ? ' sel' : ''}" role="option" tabindex="-1" aria-selected="${selected ? 'true' : 'false'}" data-market-filter-option="${option}">${esc(optionLabel(option))}</button>`;
      })
      .join('');
    return (
      `<div class="mkt-filter"><span>${esc(label)}</span><div class="mkt-select" data-market-filter-menu="${menu}">` +
      `<button type="button" class="mkt-select-btn" aria-haspopup="listbox" aria-expanded="false" aria-label="${esc(`${label}: ${current}`)}"><span>${esc(current)}</span><span class="mkt-select-chevron" aria-hidden="true"></span></button>` +
      `<div class="mkt-select-menu" role="listbox" hidden>${optionHtml}</div>` +
      `</div></div>`
    );
  }

  private renderMarketFilters(): string {
    if (this.tab !== 'browse') return '';
    const hasSubtype = this.itemTypeFilter === 'armor' || this.itemTypeFilter === 'weapon';
    return (
      `<div class="mkt-filters${hasSubtype ? ' has-subtype' : ''}" role="group" aria-label="${esc(t('itemUi.market.filters'))}">` +
      this.renderMarketFilterMenu(
        'itemType',
        t('itemUi.market.filterType'),
        this.itemTypeFilter,
        MARKET_ITEM_TYPE_FILTERS,
        (filter) => this.marketItemTypeLabel(filter as MarketItemTypeFilter),
      ) +
      (hasSubtype
        ? this.renderMarketFilterMenu(
            'subtype',
            this.marketSubtypeLabel(),
            this.subtypeFilter,
            this.marketSubtypeOptions(),
            (filter) => this.marketSubtypeOptionLabel(filter as MarketSubtypeFilter),
          )
        : '') +
      this.renderMarketFilterMenu(
        'rarity',
        t('itemUi.market.filterRarity'),
        this.rarityFilter,
        MARKET_RARITY_FILTERS,
        (filter) => this.marketRarityLabel(filter as MarketRarityFilter),
      ) +
      this.renderMarketFilterMenu(
        'sort',
        t('itemUi.market.sortLabel'),
        this.sortOrder,
        MARKET_SORT_ORDERS,
        (sort) => this.marketSortLabel(sort as MarketSortOrder),
      ) +
      `</div>`
    );
  }
}
