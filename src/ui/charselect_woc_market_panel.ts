// The character-select read-only $WOC Exchange panel
// (docs/prd/woc/marketplace.md "Character-select browsing"): lets a player
// browse live listings and realm-wide sales history before any character
// enters the world, so "check the Exchange while deciding" no longer requires
// a character to be online. Every read here rides the account's REST bearer
// token alone (GET /api/woc-market/status|listings|sales, all `readAccount`
// tier server-side); nothing on this screen needs a character id, a wallet,
// or a live world/WS session.
//
// Deliberately NOT the full WocMarketWindow (woc_market_window.ts): this
// panel has no Sell tab (it reads no inventory, which does not exist before
// a character is chosen), no Activity tab, no bid/buy-now/wallet flow, and no
// Hud dependency (Hud is constructed only after a character enters the
// world, src/main.ts startGame). Its one action beyond browsing is a plain
// link that hands the player to the browser-playable build
// (woc_market_link.ts resolveWocMarketUrl), the same "trade on the web"
// hand-off wrapped-desktop shells already use, where every mutation
// (bid/buy/sell/wallet-link) still lives.
//
// It reuses the SAME pure view core (woc_market_view.ts buildWocMarketView,
// passed an empty inventory and a null activity so the sell/activity
// sections of the model come back empty) and the SAME chrome builders the
// real Exchange window uses (woc_market_chrome.ts, woc_market_sales_html.ts)
// for every string, formatter and status face, so a listing or a sale row
// reads identically on both screens. Docked where the char-select news panel
// sits (the same `.cs-news-panel` class, position, sizing and mobile
// treatment the news and appearance-redesign panels already use), following
// the CharselectRedesignEditor recipe: hide the sibling panel, show this
// one, Escape and a Back button both close it, focus returns to the opener.

import type { WocListingView, WocMarketStatus, WocSaleView } from '../net/woc_market_sdk';
import { ITEMS } from '../sim/data';
import type { ItemInstancePayload } from '../sim/types';
import { durationText } from './duration_text';
import { itemDisplayName } from './entity_i18n';
import { esc } from './esc';
import {
  captureFocusKey,
  FOCUS_KEY_ATTR,
  findFocusKey,
  restoreFirstEnabled,
} from './focus_restore';
import { formatNumber, t } from './i18n';
import { iconDataUrl } from './icons';
import { focusActiveTab, wireTabStrip } from './tab_strip_painter';
import { tabStripHtml, tabStripModel } from './tab_strip_view';
import { svgIcon } from './ui_icons';
import { usdText } from './usd_text';
import { wocErrorStatusHtml, wocItemCellHtml, wocLoadingStatusHtml } from './woc_market_chrome';
import { resolveWocMarketUrl } from './woc_market_link';
import { wocSalesTableHtml } from './woc_market_sales_html';
import {
  browseItemFilterIds,
  buildWocMarketView,
  type WocListingRowModel,
  type WocMarketTab,
  type WocMarketViewModel,
} from './woc_market_view';

const PAGE_SIZE = 25;
const ROOT_ID = 'charselect-woc-market';
const TITLE_ID = 'charselect-woc-market-title';

/** The two read-only browse/history reads this panel needs, structurally
 *  matching src/net/woc_market_sdk.ts WocMarketClient (the real client
 *  satisfies this without a cast; a fake in tests needs only these three
 *  methods). */
export interface CharselectMarketClient {
  status(): Promise<WocMarketStatus>;
  browse(req: {
    page: number;
    quality: string | null;
    format: string | null;
    category: string | null;
    subcategory: string | null;
    itemIds: readonly string[] | null;
    sort: 'ending' | 'newest' | 'price_asc' | 'price_desc';
  }): Promise<
    { ok: true; hasMore: boolean; page: number; listings: WocListingView[] } | { ok: false }
  >;
  recentSales(req: {
    page: number;
    quality: string | null;
    format: string | null;
    category: string | null;
    subcategory: string | null;
    itemIds: readonly string[] | null;
  }): Promise<{ ok: true; hasMore: boolean; page: number; sales: WocSaleView[] } | { ok: false }>;
}

export interface CharselectWocMarketDeps {
  root(): HTMLElement | null;
  client(): CharselectMarketClient | null;
  /** The dock this panel shares with the news feed and the appearance
   *  redesign editor: hidden while this panel is open, restored on close. */
  newsHost(): HTMLElement | null;
  /** Close the redesign editor if one happens to be open (both panels dock
   *  in the same spot); a no-op the rest of the time. */
  closeRedesignIfOpen(): void;
}

export class CharselectWocMarketPanel {
  private built = false;
  private renderSeq = 0;
  private tab: WocMarketTab = 'browse';
  private status: WocMarketStatus | null = null;
  private statusFailed = false;
  private listings: WocListingView[] = [];
  private hasMore = false;
  private page = 0;
  private loading = false;
  private failed = false;
  private historySales: WocSaleView[] = [];
  private historyHasMore = false;
  private historyPage = 0;
  private historyLoading = false;
  private historyFailed = false;
  private itemQuery = '';
  private returnFocus: HTMLElement | null = null;
  private escapeHandler: ((e: KeyboardEvent) => void) | null = null;

  constructor(private readonly deps: CharselectWocMarketDeps) {}

  get isOpen(): boolean {
    const root = this.deps.root();
    return root !== null && !root.hasAttribute('hidden');
  }

  open(opener?: HTMLElement | null): void {
    const root = this.deps.root();
    if (!root || this.deps.client() === null) return;
    this.returnFocus =
      opener ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    this.deps.closeRedesignIfOpen();
    this.deps.newsHost()?.setAttribute('hidden', '');
    root.removeAttribute('hidden');
    this.tab = 'browse';
    this.escapeHandler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      this.close();
    };
    document.addEventListener('keydown', this.escapeHandler);
    void this.reload();
  }

  close(): void {
    const root = this.deps.root();
    if (this.escapeHandler) {
      document.removeEventListener('keydown', this.escapeHandler);
      this.escapeHandler = null;
    }
    // Cancels any in-flight loads (the seq fence below), so a late response
    // can no longer repaint a panel the player already left.
    this.renderSeq++;
    if (root && !root.hasAttribute('hidden') && this.returnFocus?.isConnected) {
      this.returnFocus.focus();
    }
    this.returnFocus = null;
    root?.setAttribute('hidden', '');
    this.deps.newsHost()?.removeAttribute('hidden');
  }

  private async reload(): Promise<void> {
    const client = this.deps.client();
    if (!client) return;
    const seq = ++this.renderSeq;
    this.render();
    const status = await client.status();
    if (seq !== this.renderSeq) return;
    this.status = status;
    this.statusFailed = !status.ok;
    await Promise.all([this.loadBrowse(seq), this.loadHistory(seq)]);
    if (seq !== this.renderSeq) return;
    this.render();
  }

  private resolveFilterItemIds(): { itemIds: readonly string[] | null; empty: boolean } {
    const itemIds = browseItemFilterIds(
      this.itemQuery,
      (id) => this.itemName(id),
      Object.keys(ITEMS),
    );
    return { itemIds, empty: itemIds !== null && itemIds.length === 0 };
  }

  private async loadBrowse(seq: number): Promise<void> {
    const client = this.deps.client();
    if (!client) return;
    this.loading = true;
    const { itemIds, empty } = this.resolveFilterItemIds();
    if (empty) {
      this.loading = false;
      this.failed = false;
      this.listings = [];
      this.hasMore = false;
      return;
    }
    const out = await client.browse({
      page: this.page,
      quality: null,
      format: null,
      category: null,
      subcategory: null,
      itemIds,
      sort: 'ending',
    });
    if (seq !== this.renderSeq) return;
    this.loading = false;
    if (!out.ok) {
      this.failed = true;
      return;
    }
    this.failed = false;
    this.listings = out.listings;
    this.hasMore = out.hasMore;
  }

  private async loadHistory(seq: number): Promise<void> {
    const client = this.deps.client();
    if (!client) return;
    this.historyLoading = true;
    const { itemIds, empty } = this.resolveFilterItemIds();
    if (empty) {
      this.historyLoading = false;
      this.historyFailed = false;
      this.historySales = [];
      this.historyHasMore = false;
      return;
    }
    const out = await client.recentSales({
      page: this.historyPage,
      quality: null,
      format: null,
      category: null,
      subcategory: null,
      itemIds,
    });
    if (seq !== this.renderSeq) return;
    this.historyLoading = false;
    if (!out.ok) {
      this.historyFailed = true;
      return;
    }
    this.historyFailed = false;
    this.historySales = out.sales;
    this.historyHasMore = out.hasMore;
  }

  private itemName(itemId: string): string {
    const def = ITEMS[itemId];
    return def ? itemDisplayName(def) : itemId;
  }

  private buildModel(): WocMarketViewModel {
    return buildWocMarketView({
      capable: true,
      status: this.status,
      statusFailed: this.statusFailed,
      walletLinked: false,
      tab: this.tab,
      nowMs: Date.now(),
      browse: {
        listings: this.listings,
        hasMore: this.hasMore,
        page: this.page,
        pageSize: PAGE_SIZE,
        loading: this.loading,
        failed: this.failed,
        selectedId: null,
        detail: null,
        estimate: null,
        sales: null,
      },
      history: {
        sales: this.historySales,
        hasMore: this.historyHasMore,
        page: this.historyPage,
        loading: this.historyLoading,
        failed: this.historyFailed,
      },
      inventory: [],
      activity: null,
    });
  }

  private render(): void {
    const root = this.deps.root();
    if (!root) return;
    if (!this.built) {
      this.built = true;
      root.addEventListener('click', (e) => this.onClick(e));
      root.addEventListener('change', (e) => this.onChange(e));
      root.addEventListener('keydown', (e) => this.onKeyDown(e as KeyboardEvent));
    }
    const model = this.buildModel();
    const focusKey = captureFocusKey(root);
    root.innerHTML = this.html(model);
    wireTabStrip(root, 'csm-tab', (id) => {
      this.tab = id as WocMarketTab;
      this.render();
      focusActiveTab(root, 'csm-tab', 'csm-tab-selected');
    });
    if (focusKey) {
      restoreFirstEnabled([findFocusKey(root, focusKey)]);
    }
  }

  private html(model: WocMarketViewModel): string {
    const header =
      `<div class="csm-head">` +
      `<h3 id="${TITLE_ID}" class="csm-title">${esc(t('hudChrome.wocMarket.launcherLabel'))}</h3>` +
      `<button type="button" class="btn btn-secondary csm-back" data-action="close" ${FOCUS_KEY_ATTR}="csm-back">${esc(
        t('auth.back'),
      )}</button></div>`;
    const webLink =
      `<div class="csm-web">` +
      `<a class="csm-web-link" href="${esc(resolveWocMarketUrl({ origin: globalThis.location?.origin ?? '' }))}" ` +
      `target="_blank" rel="noopener noreferrer">${esc(t('hudChrome.wocMarket.charselectWebLink'))}</a>` +
      `<p class="csm-web-note">${esc(t('hudChrome.wocMarket.charselectWebNote'))}</p></div>`;
    if (model.kind !== 'ready') {
      const status =
        model.kind === 'loading'
          ? wocLoadingStatusHtml()
          : model.kind === 'disabled'
            ? `<div class="wm-status" role="status">${esc(t('hudChrome.wocMarket.disabledRealm'))}</div>`
            : wocErrorStatusHtml(t('hudChrome.wocMarket.loadFailed'));
      return `${header}${status}${webLink}`;
    }
    const strip = tabStripHtml(
      tabStripModel({
        ariaLabel: t('hudChrome.wocMarket.tabsLabel'),
        panelId: 'csm-panel',
        stripClass: 'csm-tabs',
        tabClass: 'csm-tab',
        selectedClass: 'csm-tab-selected',
        selected: this.tab,
        tabs: [
          { id: 'browse', label: t('hudChrome.wocMarket.tabBrowse') },
          { id: 'history', label: t('hudChrome.wocMarket.tabHistory') },
        ],
      }),
    );
    const filter =
      `<div class="csm-filter">` +
      `<label class="csm-filter-label">${esc(t('hudChrome.wocMarket.filterItemLabel'))}` +
      `<input type="text" class="csm-filter-input" data-field="filter-item" ${FOCUS_KEY_ATTR}="csm-filter" ` +
      `value="${esc(this.itemQuery)}" placeholder="${esc(
        t('hudChrome.wocMarket.filterItemPlaceholder'),
      )}" /></label></div>`;
    const body = this.tab === 'history' ? this.historyHtml(model) : this.browseHtml(model);
    return `${header}${strip}<div id="csm-panel" role="tabpanel">${filter}${body}</div>${webLink}`;
  }

  private pagerHtml(page: number, hasMore: boolean, action: string): string {
    return (
      `<div class="csm-pager">` +
      `<button type="button" class="csm-page-btn" data-action="${action}-prev" ${FOCUS_KEY_ATTR}="csm-${action}-prev" ${
        page <= 0 ? 'disabled' : ''
      } aria-label="${esc(t('hudChrome.wocMarket.pagePrev'))}">${svgIcon('prev')}</button>` +
      `<span>${esc(t('hudChrome.wocMarket.pageNumber', { current: formatNumber(page + 1) }))}</span>` +
      `<button type="button" class="csm-page-btn" data-action="${action}-next" ${FOCUS_KEY_ATTR}="csm-${action}-next" ${
        hasMore ? '' : 'disabled'
      } aria-label="${esc(t('hudChrome.wocMarket.pageNext'))}">${svgIcon('next')}</button>` +
      `</div>`
    );
  }

  private browseHtml(model: Extract<WocMarketViewModel, { kind: 'ready' }>): string {
    const b = model.browse;
    const pager = this.pagerHtml(b.page, b.hasMore, 'browse');
    if (b.failed) {
      return `${pager}${wocErrorStatusHtml(t('hudChrome.wocMarket.browseError'))}`;
    }
    if (b.rows.length === 0) {
      return `${pager}${
        b.loading
          ? wocLoadingStatusHtml()
          : `<div class="wm-status" role="status">${esc(t('hudChrome.wocMarket.browseEmpty'))}</div>`
      }`;
    }
    const rows = b.rows.map((r) => this.browseRowHtml(r)).join('');
    return `${pager}<ul class="csm-list" aria-busy="${b.loading ? 'true' : 'false'}">${rows}</ul>`;
  }

  private browseRowHtml(r: WocListingRowModel): string {
    const price =
      r.currentCents !== null
        ? t('hudChrome.wocMarket.detailCurrentBid', { usd: usdText(r.currentCents) })
        : r.format === 'buy_now'
          ? t('hudChrome.wocMarket.sellFormatBuyNow')
          : t('hudChrome.wocMarket.detailNoBids');
    const buyNow =
      r.buyNowCents !== null
        ? `<span class="csm-buynow">${esc(
            t('hudChrome.wocMarket.detailBuyNow', { usd: usdText(r.buyNowCents) }),
          )}</span>`
        : '';
    return (
      `<li class="csm-row">` +
      wocItemCellHtml(
        this.itemName(r.itemId),
        iconDataUrl('item', r.itemId),
        r.quality,
        `csm:${r.id}`,
      ) +
      `<span class="csm-seller">${esc(t('hudChrome.wocMarket.detailSeller', { name: r.sellerName }))}</span>` +
      `<span class="csm-price">${esc(price)}</span>${buyNow}` +
      `<span class="csm-time">${esc(durationText(r.remainingMs / 1000))}</span>` +
      `</li>`
    );
  }

  private historyHtml(model: Extract<WocMarketViewModel, { kind: 'ready' }>): string {
    const pager = this.pagerHtml(model.history.page, model.history.hasMore, 'history');
    const table = wocSalesTableHtml(model.history, {
      itemName: (id) => this.itemName(id),
      itemCell: (itemId: string, quality: string, key: string, instance?: ItemInstancePayload) =>
        wocItemCellHtml(this.itemName(itemId), iconDataUrl('item', itemId), quality, key, instance),
      usd: (cents) => usdText(cents),
      // No tooltip host on this cold, char-select-only panel; the sold cell
      // just carries no title attribute (the medium date already shown is
      // enough context here, unlike the dense main Exchange table).
      tip: () => '',
    });
    return `${pager}<div class="wm-history">${table}</div>`;
  }

  private onClick(e: Event): void {
    const target = e.target as HTMLElement;
    const action = target.closest<HTMLElement>('[data-action]')?.dataset.action;
    if (!action) return;
    if (action === 'close') {
      this.close();
      return;
    }
    if (action === 'browse-prev' && this.page > 0) {
      this.page--;
      void this.loadBrowse(this.renderSeq).then(() => this.render());
    } else if (action === 'browse-next') {
      this.page++;
      void this.loadBrowse(this.renderSeq).then(() => this.render());
    } else if (action === 'history-prev' && this.historyPage > 0) {
      this.historyPage--;
      void this.loadHistory(this.renderSeq).then(() => this.render());
    } else if (action === 'history-next') {
      this.historyPage++;
      void this.loadHistory(this.renderSeq).then(() => this.render());
    }
  }

  private onChange(e: Event): void {
    const target = e.target as HTMLElement;
    if (target.dataset.field !== 'filter-item') return;
    this.itemQuery = (target as HTMLInputElement).value;
    this.page = 0;
    this.historyPage = 0;
    void Promise.all([this.loadBrowse(this.renderSeq), this.loadHistory(this.renderSeq)]).then(() =>
      this.render(),
    );
  }

  private onKeyDown(e: KeyboardEvent): void {
    const target = e.target as HTMLElement;
    if (e.key === 'Enter' && target.dataset.field === 'filter-item') {
      e.preventDefault();
      this.onChange(e);
    }
  }
}

export { ROOT_ID as CHARSELECT_WOC_MARKET_ROOT_ID, TITLE_ID as CHARSELECT_WOC_MARKET_TITLE_ID };
