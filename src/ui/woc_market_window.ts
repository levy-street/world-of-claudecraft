// The $WOC Exchange window (docs/prd/woc/marketplace.md): a COLD window on
// the leaderboard pattern (async data behind a renderSeq epoch, no driver of
// its own; Hud.update()'s slow band polls refreshIfChanged, which rebuilds
// only when the wocMarketViewSig digest moves, second-resolution countdowns
// included). The pure model lives in woc_market_view.ts; this painter owns
// every t() string, formatter, and the wall clock, and reaches the server
// only through the injected WocMarketHooks (main.ts wires the SDK + wallet
// signer; ui/ itself never imports net/ at runtime).
//
// Cold contracts held here: no forced-reflow layout read, no repeating
// driver. Rebuilds carry typed input across via form_draft.ts and focus via
// focus_restore.ts; the language fan-out calls relocalize(), which re-renders
// once and re-latches the signature.

import type {
  WocActivityView,
  WocEstimateView,
  WocListingView,
  WocMarketStatus,
  WocQuoteView,
  WocSaleView,
  WocSellerView,
} from '../net/woc_market_sdk';
import { ITEMS } from '../sim/data';
import type { ExchangeBrowseCategory } from '../sim/exchange_eligibility';
import type { ItemDef, ItemInstancePayload } from '../sim/types';
import type { IWorld } from '../world_api';
import { userFacingApiError } from './api_error_i18n';
import { markDialogRoot } from './dialog_root';
import { dropdownKeyNav } from './dropdown_nav';
import { durationText } from './duration_text';
import { itemDisplayName } from './entity_i18n';
import { esc } from './esc';
import { captureFocusKey, restoreFirstEnabled } from './focus_restore';
import { captureFormDraft, restoreFormDraft } from './form_draft';
import type { TranslationKey } from './i18n';
import { formatDateTime, formatDuration, formatNumber, t, tPlural } from './i18n';
import { iconDataUrl } from './icons';
import { itemNameColor } from './item_name_color';
import { focusActiveTab, wireTabStrip } from './tab_strip_painter';
import { tabStripHtml, tabStripModel } from './tab_strip_view';
import { termsUrlFor } from './terms_link';
import { svgIcon } from './ui_icons';
import { usdText } from './usd_text';
import { verifiedWocBalance, walletConnectionView } from './wallet_balance';
import {
  type WalletBridgeReason,
  walletBridgeReason,
  walletBridgeReasonText,
} from './wallet_bridge_reason_text';
import { overWalletBalance } from './woc_affordable_core';
import { wocActivityHtml } from './woc_market_activity_html';
import {
  wocBidDisclosuresHtml,
  wocBrowseStripHtml,
  wocBuyNowHtml,
  wocEndsAtText,
  wocErrorStatusHtml,
  wocLoadingStatusHtml,
  wocMarketBannersHtml,
  wocMarketFootHtml,
  wocQuoteFaceHtml,
  wocSalesHistoryHtml,
  wocSellEmptyHtml,
  wocSellerPaneHtml,
  wocSpinnerHtml,
  wocWalletCardSig,
} from './woc_market_chrome';
import type { WocMarketHooks } from './woc_market_hooks';
import { anyBondAwaitingChain, shouldPollWocMarket } from './woc_market_poll_core';
import {
  wocBondPendingText,
  wocPaymentPendingText,
  wocSettlementFailText,
} from './woc_market_reason_text';
import {
  browseItemFilterIds,
  browseQualityOptions,
  buildWocMarketView,
  canCancelListing,
  type WocMarketTab,
  type WocMarketViewModel,
  type WocSellRowModel,
  wocMarketViewSig,
  wocQuoteCountdownSig,
} from './woc_market_view';
import { wocTokensText } from './woc_tokens_text';

// The hooks contract lives in its own leaf module (wiring, window, and the
// trade arm all consume it); re-exported here so importers keep one home.
export type { WocMarketHooks } from './woc_market_hooks';

export interface WocMarketWindowDeps {
  root(): HTMLElement;
  world(): IWorld;
  hooks(): WocMarketHooks | null;
  closeOthers(): void;
  hideTooltip(): void;
  /** Open the shared wallet connect flow, giving the unlinked-wallet banner a
   *  direct path to link through the same event as the other wallet surfaces. */
  openWallet(): void;
  refreshWocBalance(force?: boolean): void;
  /** The shared hover/focus tooltip binder (Hud.attachTooltip). It owns the
   *  positioning and the only forced-reflow reads involved, which is what keeps
   *  this cold window's no-layout-read contract intact. */
  attachTooltip(element: HTMLElement, html: () => string): void;
  /** The SAME item tooltip the character window shows (Hud.itemTooltip with
   *  compare on), so a listing reads identically to worn gear: stats, the
   *  instance badges, the enchant, and the compare-to-equipped deltas. */
  itemTooltip(item: ItemDef, instance?: ItemInstancePayload): string;
  captureFocus(): HTMLElement | null;
  restoreFocus(target: HTMLElement | null): void;
}

/**
 * The scroll containers a rebuild replaces, each with the state key that decides
 * whether a saved position still refers to the same content.
 *
 * This is the scroll pair the perf gate's cold allowance table documents as the
 * shape repeated across these windows (bags, bank, deeds and the rest): read the
 * position before the rebuild, write it back after, so the list does not jump
 * under the player. It is load-bearing here rather than cosmetic, because the
 * slow-band poll rebuilds on every countdown bucket change, which is once a
 * minute at rest and once a SECOND inside the anti-snipe window: without it the
 * browse list yanked itself back to the top while the player was reading it.
 *
 * Keyed, so a genuine change of view still starts at the top. The body resets
 * when the tab changes; the detail pane also resets when a different listing is
 * selected, since its old offset means nothing in another listing's content.
 */
const SCROLL_KEEPERS: ReadonlyArray<readonly [keyof WocMarketScrollKeys, string]> = [
  ['body', '.wm-body'],
  ['detail', '.wm-detail'],
];

interface WocMarketScrollKeys {
  body: string;
  detail: string;
}

/** The sell picker's listbox id. One definition: the markup builds the option ids
 *  from it and paintSellActive points aria-activedescendant at them, so two
 *  literals would let the two drift apart silently. */
const SELL_LISTBOX_ID = 'wm-sell-listbox';

// usdCents is NULLABLE on purpose: it is only a display label sourced from the
// cached activity row, and a missing row must render no amount rather than a
// fabricated $0.00 next to a real charge. The quote's token legs are the
// authoritative figures either way.
type PendingQuote =
  | {
      kind: 'bond';
      bidId: number;
      /** The listing's item when the painter knows it ('' otherwise): the
       *  quote face names which auction the bond is for. Display only. */
      itemId: string;
      usdCents: number | null;
      quote: WocQuoteView;
    }
  | {
      kind: 'settlement';
      settlementId: number;
      itemId: string;
      usdCents: number | null;
      /** The claim's own payment deadline (the wire's deadlineAtMs), or null:
       *  the quote face shows it beside the quote expiry. Display only. */
      deadlineAtMs: number | null;
      quote: WocQuoteView;
    };

const PAGE_SIZE = 25;

/** The toast strip's UNRESOLVED state: keys, codes, and screened reason
 *  words, resolved at render by resolveNotice() so a runtime language switch
 *  never leaves a stale-locale sentence on screen. */
type WocNotice =
  | { kind: 'key'; key: TranslationKey; error: boolean }
  | { kind: 'api'; code: string; params?: Record<string, unknown>; error: boolean }
  | { kind: 'pending'; reason: string | null; error: boolean }
  | { kind: 'bondPending'; reason: string | null; error: boolean }
  | {
      kind: 'bridge';
      reason: WalletBridgeReason;
      flavor: 'sign' | 'payment';
      error: boolean;
    };

export class WocMarketWindow {
  private built = false;
  private opener: HTMLElement | null = null;
  private renderSeq = 0;
  private lastSig = '';
  /** The model the live DOM was built from, so a keyboard index always resolves
   *  against the rows on screen rather than a freshly rebuilt list. */
  private lastModel: WocMarketViewModel | null = null;

  private tab: WocMarketTab = 'browse';
  private status: WocMarketStatus | null = null;
  private statusFailed = false;
  private listings: WocListingView[] = [];
  private hasMore = false;
  private page = 0;
  private sort: 'ending' | 'newest' | 'price_asc' | 'price_desc' = 'ending';
  private browseLoading = false;
  private browseFailed = false;
  private selectedId: number | null = null;
  private detail: WocListingView | null = null;
  private estimate: WocEstimateView | null = null;
  private sales: WocSaleView[] | null = null;
  private activity: WocActivityView | null = null;
  private sellIndex: number | null = null;
  // Non-text form state lives HERE, not in the rebuilt DOM: form_draft.ts
  // deliberately carries only text inputs, so a poll rebuild (which fires at
  // least once a minute while any tab is open) would silently reset a select or
  // checkbox and submit would then read the reset value. On a money surface
  // that means listing with the wrong format, duration, or terms flag.
  private sellFormat: 'auction' | 'buy_now' = 'auction';
  // The Browse filters (the server's own browse params, held here like the
  // sort so a poll rebuild repaints them and a change survives it). The item
  // box holds the RAW query; loadBrowse resolves it to ids per request, so a
  // language switch re-resolves against the names on screen.
  private filterQuality: string | null = null;
  private filterFormat: 'auction' | 'buy_now' | null = null;
  /** The stamped category axes; picking a category drops an incompatible
   *  subcategory (a sword filter under Armor would silently show nothing). */
  private filterCategory: ExchangeBrowseCategory | null = null;
  private filterSubcategory: string | null = null;
  private filterItemQuery = '';
  /** The seller click-through pane: set replaces the Browse body until Back.
   *  Null sales = the read is still out (the pane's loading face); failed
   *  keeps the pane up with the error face and its Back control. */
  private sellerPane: {
    name: string;
    sales: WocSaleView[] | null;
    /** The seller's public line (guild, character age): null until the read
     *  lands or when the name no longer resolves (renamed or deleted). */
    profile: WocSellerView | null;
    failed?: boolean;
  } | null = null;
  /** Sell-tab combobox: the typed query, whether the listbox is open, and the
   *  active (highlighted) option. All painter state, not DOM state: the window
   *  rebuilds from state on the slow poll band, so anything held only in the DOM
   *  would collapse the listbox mid-interaction. form_draft carries the input's
   *  value AND its caret across that rebuild, so typing survives it. */
  private sellSearch = '';
  private sellOpen = false;
  private sellActive = -1;
  /** True for the duration of render(). Any focus movement inside that window is
   *  the rebuild tearing down its own nodes, never the user leaving the control. */
  private rendering = false;
  /** What the scroll positions carried across the last rebuild referred to, so a
   *  restore is skipped once it would point into different content. See
   *  SCROLL_KEEPERS and scrollKeys(). */
  private renderedScrollKey: WocMarketScrollKeys = { body: '', detail: '' };
  private sellDurationHours: number | null = null;
  private sellOfferNext = false;
  private acceptTerms = false;
  /** The bid form's disclosure well, collapsed by default so Place bid sits
   *  above the fold (the whole point of the toggle). Painter state, not DOM
   *  state: the poll-band rebuild would silently re-collapse an open well
   *  held only in the DOM. Reset on close so every visit starts compact. */
  private bidTermsOpen = false;
  private pendingQuote: PendingQuote | null = null;
  /** The bid preview's timer-free coalescing (see onBidPriceInput): the price
   *  still awaiting an estimate, and whether one is already out. */
  private bidEstimateWanted: number | null = null;
  private bidEstimateInFlight = false;
  /** The server-quoted tokens for the price currently typed, or null when there
   *  is no figure to show. Rendered, never written into the DOM directly. */
  private bidEquivalentTokens: number | null = null;
  /** The server-quoted tokens for THIS listing's buy-now price. Its own quote
   *  because the detail's estimate covers the current bid, not the buy-now. */
  private buyNowTokens: number | null = null;

  private walletTokens(): number | null {
    return verifiedWocBalance();
  }
  private paintedWalletSig = '';
  private busy = false;
  private busyLabel: TranslationKey | null = null;
  /** Bumped every time a mutation starts AND every time the window closes. A
   *  withBusy run captures it and settles only if it still owns it, so a wallet
   *  round trip abandoned by a close (the desktop signer has no timeout) can
   *  neither clear a newer run's guard nor write over its state on late
   *  resolution. `busy` stays a truthful "a mutation is in flight" for the poll
   *  gate. */
  private busyGen = 0;
  /** The toast strip's state, stored UNRESOLVED (keys, codes, screened
   *  reason words) and resolved at render time by resolveNotice(): a stored
   *  resolved string survived a runtime language switch in the old locale
   *  (the longest-lived one was the pending-payment toast). The bridge arm
   *  stores the CLASSIFIED reason, never provider prose. */
  private notice: WocNotice | null = null;
  /** Background-poll bookkeeping. The stamp is when the last poll STARTED (see
   *  shouldPollWocMarket); both are read only by pollFromServer. */
  private pollStartedMs: number | null = null;
  private pollInFlight = false;
  // Item hover targets for the CURRENT DOM, rebuilt with it. An instance payload
  // is an object and cannot ride in a data attribute, so the markup carries a
  // stable key and this maps it back to the row it came from. Cleared at the top
  // of every html() pass so a key can never resolve against a destroyed row.
  private tooltipTargets = new Map<string, { itemId: string; instance?: ItemInstancePayload }>();
  /** Plain-text explainers for the CURRENT DOM's tagged badges, countdowns and
   *  strikes line (data-tip-key), resolved at render in the current locale and
   *  cleared with the tooltip targets above. */
  private tipTexts = new Map<string, string>();
  /** The seller's resolved fee for the price being typed in the sell form: the
   *  server's split for that amount (the same estimate the bid preview asks
   *  for; the client derives no money). Null until quoted or when the wire
   *  carries no split; the coalescing pair mirrors the bid preview's. */
  private sellFeeSplit: { sellerCents: number; burnCents: number; treasuryCents: number } | null =
    null;
  private sellFeeWanted: number | null = null;
  private sellFeeInFlight = false;

  constructor(private readonly deps: WocMarketWindowDeps) {}

  get isOpen(): boolean {
    return this.deps.root().style.display === 'flex';
  }

  open(): void {
    if (this.deps.hooks() === null) return;
    this.opener = this.deps.captureFocus();
    this.deps.closeOthers();
    this.deps.root().style.display = 'flex';
    this.deps.refreshWocBalance();
    void this.reload();
  }

  toggle(): void {
    if (this.isOpen) this.close();
    else this.open();
  }

  close(): void {
    if (!this.isOpen) return;
    this.deps.root().style.display = 'none';
    this.deps.hideTooltip();
    this.deps.restoreFocus(this.opener);
    this.opener = null;
    // Clear any in-flight guard on close: since submitListing became a wallet
    // round trip (B6/R1), a browser-extension signer with no timeout can leave a
    // dismissed popup's withBusy finally unreached, which would otherwise brick
    // every Exchange button and suppress the poll for the rest of the session.
    // Bumping busyGen is what makes this safe: the abandoned run's finally and
    // its post-await body both see a stale generation and no-op, so a late
    // resolution can neither re-enable a newer run's buttons nor send a second
    // request. (This is why the Exchange needs more than the trade window's flat
    // reset: closing the trade tears down its session, but the Exchange keeps
    // sellIndex and the quote one click from re-entry.)
    this.busy = false;
    this.busyLabel = null;
    this.busyGen++;
    this.bidTermsOpen = false;
    this.sellerPane = null;
  }

  /** Full refetch (open, tab change, after a mutation). */
  private async reload(): Promise<void> {
    const hooks = this.deps.hooks();
    if (!hooks) return;
    const seq = ++this.renderSeq;
    this.render();
    const status = await hooks.client.status();
    if (seq !== this.renderSeq) return;
    this.status = status;
    this.statusFailed = !status.ok;
    await Promise.all([this.loadBrowse(seq), this.loadActivity(seq)]);
    if (seq !== this.renderSeq) return;
    this.render();
  }

  /**
   * @param silent A BACKGROUND refresh: report neither progress nor failure.
   *
   * Both halves matter, and both are about not punishing the player for a poll
   * they did not ask for. The loading flag is IN the view digest, so raising it
   * every poll would force a full rebuild on a cadence even when the answer was
   * identical. The failed flag REPLACES the entire list with an error, so one
   * blipped background request would throw away a list that is still perfectly
   * good; keeping the stale rows is strictly better than that, and the next poll
   * repairs it. A refresh the player DID ask for still reports both.
   */
  private async loadBrowse(seq: number, silent = false): Promise<void> {
    const hooks = this.deps.hooks();
    if (!hooks) return;
    if (!silent) this.browseLoading = true;
    const itemIds = browseItemFilterIds(
      this.filterItemQuery,
      (id) => this.itemName(id),
      Object.keys(ITEMS),
    );
    if (itemIds !== null && itemIds.length === 0) {
      // A real "nothing matches": the SDK omits an empty itemIds param
      // (an empty filter would read as NO filter and show everything), so
      // the empty answer paints locally and the server is never asked.
      if (!silent) this.browseLoading = false;
      this.browseFailed = false;
      this.listings = [];
      this.hasMore = false;
      return;
    }
    const out = await hooks.client.browse({
      page: this.page,
      quality: this.filterQuality,
      format: this.filterFormat,
      category: this.filterCategory,
      subcategory: this.filterSubcategory,
      itemIds,
      sort: this.sort,
    });
    if (seq !== this.renderSeq) return;
    if (!silent) this.browseLoading = false;
    if (!out.ok) {
      if (!silent) this.browseFailed = true;
      return;
    }
    this.browseFailed = false;
    this.listings = out.listings;
    this.hasMore = out.hasMore;
  }

  private async loadActivity(seq: number): Promise<void> {
    const hooks = this.deps.hooks();
    if (!hooks) return;
    const out = await hooks.client.me();
    if (seq !== this.renderSeq) return;
    if (out.ok) this.activity = out.activity;
  }

  private async selectListing(id: number): Promise<void> {
    const hooks = this.deps.hooks();
    if (!hooks) return;
    this.selectedId = id;
    this.detail = null;
    this.estimate = null;
    this.sales = null;
    // A different listing means a different bid: carrying the previous one's
    // token figure across would put a stale rate under an empty price field.
    this.bidEquivalentTokens = null;
    this.bidEstimateWanted = null;
    this.buyNowTokens = null;
    this.render();
    // The one-column phone sheet stacks the detail pane below the table, so a
    // row tap on a full page painted the bid form off screen. A scroll
    // COMMAND, not a forced-reflow read (the paintSellActive precedent);
    // block nearest is a no-op on the desktop's sticky, already-visible pane.
    this.deps.root().querySelector('.wm-detail')?.scrollIntoView({ block: 'nearest' });
    const seq = this.renderSeq;
    const detail = await hooks.client.detail(id);
    if (seq !== this.renderSeq) return;
    if (detail.ok) {
      this.detail = detail.listing;
      this.estimate = detail.estimate;
      // The detail's own estimate prices the CURRENT BID, so buy-now needs its
      // own quote before it can be checked against a balance.
      const buyNowCents = detail.listing.buyNowCents;
      if (buyNowCents !== null && buyNowCents > 0) {
        const quoted = await hooks.client.estimate(buyNowCents);
        if (seq !== this.renderSeq) return;
        this.buyNowTokens = quoted?.amount?.tokens ?? null;
      }
      const history = await hooks.client.history(detail.listing.itemId);
      if (seq !== this.renderSeq) return;
      this.sales = history.ok ? history.sales : [];
    }
    this.render();
  }

  // -------------------------------------------------------------------------
  // Poll + language fan-out
  // -------------------------------------------------------------------------

  /** Hud.update() slow-band entry: rebuild only when the data digest moves. */
  refreshIfChanged(): void {
    if (!this.isOpen) return;
    // Never rebuild under an open picker. The rebuild would destroy the option
    // the pointer is resting on, and a removed node fires no mouseleave, so the
    // stats card would vanish and not come back until the pointer moved again.
    // Nothing behind the picker is time-critical, and lastSig is deliberately
    // left unmoved, so the very next poll after it closes picks the change up.
    // Scoped to the tab the picker lives on as well as the flag: the flag is
    // cleared by a focusout that a stray path could skip, and an unscoped skip
    // would then freeze the browse countdowns for the rest of the session, which
    // is a worse failure than the flicker it prevents.
    if (this.tab === 'sell' && this.sellOpen) return;
    // Ask the server again on its own cadence, then fall through. The poll only
    // MUTATES state and never paints: the signature compare below is the one
    // render path, so a poll that changed nothing costs no rebuild, and one that
    // did is picked up by the very next tick.
    this.pollFromServer();
    const sig = `${wocMarketViewSig(this.buildModel())}|${this.quoteCountdownSig()}`;
    if (sig === this.lastSig) return;
    this.render();
  }

  /**
   * The background re-ask, driven by the same slow band as the rebuild above.
   *
   * Without this the window only ever showed what it fetched when it opened: a
   * bid someone else outbid, a listing that sold, and above all a bond the chain
   * had since confirmed all required closing and reopening the panel to see.
   *
   * Deliberately NOT reload(): that one bumps renderSeq to cancel in-flight work
   * and repaints immediately, which is right for a user action and wrong for a
   * background refresh (it would fight whatever the player is currently doing).
   * This reuses the same seq FENCE, so if the player does act mid-poll their
   * action wins and this response is discarded.
   */
  private pollFromServer(): void {
    const hooks = this.deps.hooks();
    if (!hooks) return;
    // Never mid-mutation: withBusy is a user action in flight, and refetching
    // underneath it would swap the state its own completion is about to write.
    if (this.busy) return;
    // ONE clock read, used for both the decision and the stamp it writes: two
    // reads could disagree, which would quietly shorten or lengthen the very
    // interval this is enforcing.
    const nowMs = Date.now();
    if (
      !shouldPollWocMarket({
        nowMs,
        lastFetchStartedMs: this.pollStartedMs,
        inFlight: this.pollInFlight,
        awaitingChain: anyBondAwaitingChain(this.activity?.bids ?? []),
      })
    ) {
      return;
    }
    this.pollStartedMs = nowMs;
    this.pollInFlight = true;
    const seq = this.renderSeq;
    // The status read is deliberately not repeated here: it carries the feature
    // and pause configuration, which changes on an operator action rather than
    // on play, and reload() already refreshes it on every open and tab change.
    // EVERY filtered browse deliberately sits OUT of the background poll:
    // the service caches only the unfiltered shallow pages, so a filtered
    // re-ask every beat would be one uncached read per viewer per beat,
    // forever. The player's own actions (typing, paging, sorting, changing a
    // filter) still refresh a filtered view, and the countdowns tick from
    // endsAtMs client-side.
    const filtered =
      this.filterItemQuery.trim() !== '' ||
      this.filterQuality !== null ||
      this.filterFormat !== null ||
      this.filterCategory !== null ||
      this.filterSubcategory !== null;
    const browseLeg = filtered ? Promise.resolve() : this.loadBrowse(seq, true);
    void Promise.all([browseLeg, this.loadActivity(seq)]).finally(() => {
      // Cleared even on a stale or failed response: leaving it set would wedge
      // the poll off for the rest of the session, which is the failure this
      // whole method exists to prevent.
      this.pollInFlight = false;
    });
  }

  /** The pending quote's own repaint key: the quote panel is WINDOW state, so it
   *  never reaches the pure model and its digest cannot move for it. Without this
   *  the "expires in" countdown sat frozen while the quote ran out under the player. */
  private quoteCountdownSig(): string {
    return wocQuoteCountdownSig(this.pendingQuote?.quote.expiresAtMs, Date.now());
  }

  /** Language fan-out arm: self-gated, one rebuild, signature re-latched. */
  relocalize(): void {
    if (!this.isOpen) return;
    this.render();
  }

  /** Wallet fan-out arm: the card is module state the view digest never sees. */
  onWalletChanged(): void {
    if (wocWalletCardSig(walletConnectionView()) === this.paintedWalletSig) return;
    this.relocalize();
  }

  // -------------------------------------------------------------------------
  // Model + render
  // -------------------------------------------------------------------------

  private buildModel(): WocMarketViewModel {
    return buildWocMarketView({
      capable: this.deps.hooks() !== null,
      status: this.status,
      statusFailed: this.statusFailed,
      walletLinked: this.deps.hooks()?.walletLinked() ?? false,
      tab: this.tab,
      nowMs: Date.now(),
      browse: {
        listings: this.listings,
        hasMore: this.hasMore,
        page: this.page,
        pageSize: PAGE_SIZE,
        loading: this.browseLoading,
        failed: this.browseFailed,
        selectedId: this.selectedId,
        detail: this.detail,
        estimate: this.estimate,
        sales: this.sales,
      },
      inventory: this.deps.world().inventory,
      activity: this.activity,
    });
  }

  render(): void {
    const root = this.deps.root();
    if (!this.built) {
      this.built = true;
      markDialogRoot(root, { labelledBy: 'woc-market-title' });
      root.addEventListener('click', (e) => this.onClick(e));
      root.addEventListener('change', (e) => this.onChange(e));
      root.addEventListener('input', (e) => this.onInput(e));
      // mousedown, NOT click: the options are non-focusable divs, so a click would
      // blur the input first and focusout would close the listbox out from under
      // the selection. preventDefault keeps focus where it is.
      root.addEventListener('mousedown', (e) => this.onComboMouseDown(e as MouseEvent));
      root.addEventListener('mousemove', (e) => this.onComboMouseMove(e as MouseEvent));
      root.addEventListener('keydown', (e) => this.onKeyDown(e as KeyboardEvent));
      // focusin/focusout, NOT focus/blur: only the former pair bubbles, and this
      // is one delegated listener over a subtree the rebuild replaces wholesale.
      // Opening on focus is the default the picker wants (see onFocusIn); closing
      // on focusout keeps the listbox from outliving the control, guarded on
      // relatedTarget so moving focus WITHIN the combobox does not close it.
      root.addEventListener('focusin', (e) => this.onFocusIn(e as FocusEvent));
      root.addEventListener('focusout', (e) => this.onFocusOut(e as FocusEvent));
    }
    const model = this.buildModel();
    this.lastModel = model;
    // The SAME composite refreshIfChanged compares. Latching only the model half
    // would leave the two permanently unequal, so every poll would rebuild the
    // window: the caret, the hover card and the scroll position with it.
    this.lastSig = `${wocMarketViewSig(model)}|${this.quoteCountdownSig()}`;
    this.rendering = true;
    try {
      this.renderInner(root, model);
    } finally {
      this.rendering = false;
    }
  }

  /** The body of render(), split out so the `rendering` flag can wrap all of it
   *  including the focus restore, which is itself a focus movement. */
  private renderInner(root: HTMLElement, model: WocMarketViewModel): void {
    const focusKey = captureFocusKey(root);
    const draft = captureFormDraft(root);
    // Read every scroll position BEFORE the markup that owns it is thrown away,
    // and only for the containers whose content this rebuild still describes.
    const keys = this.scrollKeys(model);
    const keptScroll: [string, number][] = [];
    for (const [name, selector] of SCROLL_KEEPERS) {
      if (keys[name] !== this.renderedScrollKey[name]) continue;
      const top = root.querySelector<HTMLElement>(selector)?.scrollTop ?? 0;
      if (top > 0) keptScroll.push([selector, top]);
    }
    this.renderedScrollKey = keys;
    // The shared tooltip box is anchored to an element this rebuild is about to
    // destroy. Without this it would hang there pointing at nothing, because a
    // removed node fires no mouseleave.
    this.deps.hideTooltip();
    root.innerHTML = this.html(model);
    this.wire(root, model);
    this.attachItemTooltips(root);
    // After wire(), so the write lands on the container the fresh markup built.
    for (const [selector, top] of keptScroll) {
      const el = root.querySelector<HTMLElement>(selector);
      if (el) el.scrollTop = top;
    }
    restoreFormDraft(root, draft);
    if (focusKey) {
      // captureFocusKey returns the ATTRIBUTE VALUE, so it must be wrapped in
      // the attribute selector; passing it raw made this a type selector that
      // matched nothing and silently dropped focus across every rebuild. The
      // pager is a two-rung ladder: a page-next that lands on the last page
      // rebuilds its own button disabled, so focus falls to prev, not to body.
      const byKey = (key: string) =>
        root.querySelector<HTMLElement>(`[data-focus-key="${key.replace(/["\\]/g, '\\$&')}"]`);
      const ladder =
        focusKey === 'wm-page-next' || focusKey === 'wm-page-prev'
          ? [byKey(focusKey), byKey('wm-page-next'), byKey('wm-page-prev')]
          : [byKey(focusKey)];
      restoreFirstEnabled(ladder);
    }
  }

  private usd(cents: number): string {
    return usdText(cents);
  }

  /** Multi-unit countdown (the shared duration_text core: auction and
   *  settlement windows span days, and a raw formatDuration would render
   *  them as tens of thousands of seconds). */
  private countdown(seconds: number): string {
    return durationText(seconds);
  }

  /** The shared $WOC token spelling (woc_tokens_text.ts): the trade arm, the
   *  bag balance and this window agree on the digits. */
  private tokens(value: number): string {
    return wocTokensText(value);
  }

  private itemName(itemId: string): string {
    const def = ITEMS[itemId];
    return def ? itemDisplayName(def) : itemId;
  }

  /**
   * One item cell: the shared quality-framed icon (the .item-icon family the
   * bag, vendor and trade rows paint) plus the quality-coloured name, wrapped
   * in ONE inline-flex box so the pair can never wrap apart inside a wrapping
   * row, hoverable for the full stat tooltip.
   *
   * `key` must be unique within a render and stable across renders (the tab plus
   * the row's own id), so the hover target survives a poll rebuild. The tag goes
   * on BOTH the icon and the name so either half is a hover target. The icon
   * asks iconDataUrl for its default master (curated art returns the 128px WebP
   * whatever the size; the procedural fallback composes at the shared master
   * size and rides the idle warmer's cache key).
   */
  private itemCellHtml(
    itemId: string,
    quality: string,
    key: string,
    instance?: ItemInstancePayload,
  ): string {
    const icon = iconDataUrl('item', itemId);
    // itemNameColor family (vendor/bags): hasOwn parks prototype-key qualities on the fallback.
    const color = itemNameColor({ quality });
    // The .q-<rung> frame class: the same charset guard the shared icon helper
    // applies (the quality is server-sent on the wire; an unknown rung takes
    // the neutral frame).
    const rung = /^[a-z]+$/.test(quality) ? quality : 'common';
    this.tooltipTargets.set(key, { itemId, instance });
    const tag = ` data-tt-key="${esc(key)}"`;
    return (
      `<span class="wm-item">` +
      `<img class="wm-icon item-icon q-${rung}"${tag} src="${icon}" alt="" draggable="false" />` +
      `<span class="wm-name"${tag} style="color: ${color}">${esc(this.itemName(itemId))}</span>` +
      `</span>`
    );
  }

  /**
   * Bind the shared item tooltip to every tagged cell in the freshly built DOM,
   * and the plain-text explainers to every tagged badge, countdown and strikes
   * line (the same shared #tooltip box, keyboard and touch included; never a
   * native title).
   *
   * Runs after each rebuild because the elements are new every time; the previous
   * listeners died with the nodes they were attached to.
   */
  private attachItemTooltips(root: HTMLElement): void {
    for (const el of root.querySelectorAll<HTMLElement>('[data-tt-key]')) {
      const target = this.tooltipTargets.get(el.dataset.ttKey ?? '');
      if (!target) continue;
      const def = ITEMS[target.itemId];
      // An id this client has no def for (a server ahead of this build) simply
      // gets no tooltip rather than an empty box.
      if (!def) continue;
      this.deps.attachTooltip(el, () => this.deps.itemTooltip(def, target.instance));
    }
    for (const el of root.querySelectorAll<HTMLElement>('[data-tip-key]')) {
      const text = this.tipTexts.get(el.dataset.tipKey ?? '');
      if (text === undefined) continue;
      this.deps.attachTooltip(el, () => esc(text));
    }
  }

  /** Register a plain-text explainer for a tagged element. Same lifetime as
   *  the tooltip targets (cleared at the top of every html() pass). */
  private tip(key: string, text: string): string {
    this.tipTexts.set(key, text);
    return ` data-tip-key="${esc(key)}"`;
  }

  private html(model: WocMarketViewModel): string {
    // Same lifetime as the DOM it describes (see the fields' comments).
    this.tooltipTargets.clear();
    this.tipTexts.clear();
    // The shared window-chrome family (.panel-title + .x-btn + the close glyph,
    // the social/bank/report markup), not a bespoke header: the invented
    // .window-header / .window-close classes matched no rule in any sheet, so
    // the title and close button rendered as raw browser chrome. The close
    // button carries its accessible name only (the family convention: no
    // native title beside the aria-label).
    const header =
      `<div class="panel-title">` +
      `<span id="woc-market-title">${esc(t('hudChrome.wocMarket.title'))}</span>` +
      `<button type="button" class="x-btn" data-close aria-label="${esc(
        t('hudChrome.wocMarket.close'),
      )}">${svgIcon('close')}</button></div>`;
    if (model.kind === 'unavailable') return header;
    if (model.kind === 'loading') {
      // The shared ring, so a slow first load reads as waiting, never a stall.
      return `${header}<div class="wm-status wm-status-loading" role="status">${wocSpinnerHtml()}<span>${esc(t('hudChrome.wocMarket.loading'))}</span></div>`;
    }
    if (model.kind === 'error') {
      return `${header}${wocErrorStatusHtml(t('hudChrome.wocMarket.loadFailed'))}`;
    }
    if (model.kind === 'disabled') {
      return `${header}<div class="wm-status" role="status">${esc(t('hudChrome.wocMarket.disabledRealm'))}</div>`;
    }

    const strip = tabStripHtml(
      tabStripModel({
        ariaLabel: t('hudChrome.wocMarket.tabsLabel'),
        panelId: 'woc-market-panel',
        stripClass: 'wm-tabs',
        tabClass: 'wm-tab',
        selectedClass: 'wm-tab-selected',
        selected: model.tab,
        tabs: [
          { id: 'browse', label: t('hudChrome.wocMarket.tabBrowse') },
          { id: 'sell', label: t('hudChrome.wocMarket.tabSell') },
          { id: 'activity', label: t('hudChrome.wocMarket.tabActivity') },
        ],
      }),
    );

    // The standing banners and the footer are chrome builders (the pure-core
    // split); the window resolves its own state (notice sentence, busy label)
    // and the builders own the markup.
    const wallet = walletConnectionView();
    this.paintedWalletSig = wocWalletCardSig(wallet);
    const bannerStrip = wocMarketBannersHtml({
      paused: model.paused,
      wallet,
      tokensPerUsd: model.tokensPerUsd,
    });
    const foot = wocMarketFootHtml({
      paused: model.paused,
      tokensPerUsd: model.tokensPerUsd,
      priceAsOfMs: model.priceAsOfMs,
      tokens: (value) => this.tokens(value),
      notice: this.notice
        ? { text: this.resolveNotice(this.notice), error: this.notice.error }
        : null,
      busyText: this.busy ? t(this.busyLabel ?? 'hudChrome.wocMarket.confirming') : null,
    });

    const body =
      this.pendingQuote !== null
        ? this.quoteHtml(model)
        : model.tab === 'browse'
          ? this.browseHtml(model)
          : model.tab === 'sell'
            ? this.sellHtml(model)
            : this.activityHtml(model);

    return `${header}${strip}${bannerStrip}<div id="woc-market-panel" class="wm-body window-fill" role="tabpanel">${body}</div>${foot}`;
  }

  /** The shared waiting ring (the trade arm's spinner, one primitive). */
  private browseHtml(model: Extract<WocMarketViewModel, { kind: 'ready' }>): string {
    // The seller click-through replaces the whole Browse body until Back:
    // the pane is class state, so a poll-band rebuild repaints it rather
    // than dropping the player back into the table mid-read.
    if (this.sellerPane) {
      return wocSellerPaneHtml({
        name: this.sellerPane.name,
        failed: this.sellerPane.failed === true,
        profile: this.sellerPane.profile,
        sales:
          this.sellerPane.sales === null
            ? null
            : this.sellerPane.sales.map((s) => ({
                atMs: s.atMs,
                itemName: this.itemName(s.itemId),
                buyerName: s.buyerName,
                usdText: this.usd(s.priceCents),
              })),
      });
    }
    const b = model.browse;
    // The control row is a chrome builder (sort leading, then the filters,
    // then the pager, keyed so a keyboard player keeps their place across
    // the rebuild). The quality vocabulary is the realm floor and up.
    const pager = wocBrowseStripHtml({
      page: b.page,
      hasMore: b.hasMore,
      sort: this.sort,
      quality: this.filterQuality,
      qualityOptions: browseQualityOptions(this.status?.ok ? this.status.qualityFloor : 'epic', {
        mounts: this.status?.ok ? this.status.allowMounts : false,
        mechChromas: this.status?.ok ? this.status.allowMechChromas : false,
      }),
      format: this.filterFormat,
      category: this.filterCategory,
      subcategory: this.filterSubcategory,
      itemQuery: this.filterItemQuery,
    });
    if (b.failed) {
      return `<div class="wm-browse">${pager}${wocErrorStatusHtml(t('hudChrome.wocMarket.browseError'))}</div>`;
    }
    if (b.rows.length === 0) {
      // Loading with nothing to show yet paints the ring, never a header-only
      // table; empty paints the empty line. Both under the live pager.
      const status = b.loading
        ? wocLoadingStatusHtml()
        : `<div class="wm-status" role="status">${esc(t('hudChrome.wocMarket.browseEmpty'))}</div>`;
      return `<div class="wm-browse">${pager}${status}</div>`;
    }
    const rows = b.rows
      .map((r) => {
        // A USD figure's token equivalence rides its tooltip (the detail
        // pane's own estimateNote spelling), when a live rate is on hand.
        const usdTip = (cents: number, slot: string): string =>
          model.tokensPerUsd === null
            ? ''
            : this.tip(
                `${slot}:${r.id}`,
                t('hudChrome.wocMarket.estimateNote', {
                  tokens: this.tokens((cents / 100) * model.tokensPerUsd),
                  usd: this.usd(cents),
                }),
              );
        const badge =
          r.reserveBadge === null
            ? ''
            : `<span class="wm-reserve wm-reserve-${r.reserveBadge}"${this.tip(
                `reserve:${r.id}`,
                t(
                  r.reserveBadge === 'met'
                    ? 'hudChrome.wocMarket.reserveMetTip'
                    : 'hudChrome.wocMarket.reserveNotMetTip',
                ),
              )}>${esc(
                t(
                  r.reserveBadge === 'met'
                    ? 'hudChrome.wocMarket.reserveMet'
                    : 'hudChrome.wocMarket.reserveNotMet',
                ),
              )}</span>`;
        const mine = r.mine
          ? `<span class="wm-mine"${this.tip(`mine:${r.id}`, t('hudChrome.wocMarket.yourListingTip'))}>${esc(t('hudChrome.wocMarket.yourListing'))}</span>`
          : '';
        const locked = r.buyNowLocked
          ? `<span class="wm-locked"${this.tip(`locked:${r.id}`, t('hudChrome.wocMarket.buyNowLockedTip'))}>${esc(t('hudChrome.wocMarket.buyNowLockedBadge'))}</span>`
          : '';
        // A buy-now-only listing takes no bids: its price column names the
        // format instead of claiming 'No bids yet' for an auction it is not.
        const currentCell =
          r.currentCents !== null
            ? esc(this.usd(r.currentCents))
            : r.format === 'buy_now'
              ? esc(t('hudChrome.wocMarket.sellFormatBuyNow'))
              : esc(t('hudChrome.wocMarket.detailNoBids'));
        return (
          `<tr class="wm-row ${r.selected ? 'wm-row-selected' : ''}" data-listing="${r.id}" ` +
          `${r.selected ? 'aria-current="true"' : ''}>` +
          // The row is the only route to the detail pane, the bid form and
          // buy-now, so its activator is a real button: keyboard and screen
          // readers reach the purchase flow, not just the mouse. Its name says
          // what it does (opens the listing), never 'place a bid' on a listing
          // that takes none.
          `<td><button type="button" class="wm-row-open" data-listing="${r.id}" ` +
          `data-focus-key="wm-row-${r.id}" aria-label="${esc(t('hudChrome.wocMarket.rowOpenAria', { item: this.itemName(r.itemId) }))}">` +
          `${this.itemCellHtml(r.itemId, r.quality, `browse:${r.id}`, r.instance)}</button>${mine}${locked}</td>` +
          // The seller cell is the click-through into their recent trades
          // (its own data-action, so closest() takes it before the row).
          `<td><button type="button" class="wm-seller-link" data-action="seller-view" ` +
          `data-seller="${esc(r.sellerName)}" aria-label="${esc(
            t('hudChrome.wocMarket.sellerLinkAria', { name: r.sellerName }),
          )}">${esc(r.sellerName)}</button></td>` +
          `<td><span${r.currentCents === null ? '' : usdTip(r.currentCents, 'bidequiv')}>${currentCell}</span>${badge}</td>` +
          `<td>${r.buyNowCents === null ? '' : `<span${usdTip(r.buyNowCents, 'buyequiv')}>${esc(this.usd(r.buyNowCents))}</span>`}</td>` +
          // The countdown is one truncated unit; the exact end time (UTC and
          // local, the detail pane's spelling) rides its tooltip.
          `<td${this.tip(`ends:${r.id}`, wocEndsAtText(r.endsAtMs))}>${esc(this.countdown(r.remainingMs / 1000))}</td></tr>`
        );
      })
      .join('');
    // aria-busy on a refresh the player asked for (page, sort): the rows dim
    // while the answer is on its way, so a pressed pager button reads as
    // heard; a background poll never raises the flag (loadBrowse silent arm).
    const table =
      `<table class="wm-table" aria-busy="${b.loading ? 'true' : 'false'}"><thead><tr>` +
      `<th>${esc(t('hudChrome.wocMarket.colItem'))}</th>` +
      `<th>${esc(t('hudChrome.wocMarket.colSeller'))}</th>` +
      `<th>${esc(t('hudChrome.wocMarket.colCurrentBid'))}</th>` +
      `<th>${esc(t('hudChrome.wocMarket.colBuyNow'))}</th>` +
      `<th>${esc(t('hudChrome.wocMarket.colTimeLeft'))}</th>` +
      `</tr></thead><tbody>${rows}</tbody></table>`;
    return `<div class="wm-browse">${pager}${table}${this.detailPaneHtml(model)}</div>`;
  }

  private detailPaneHtml(model: Extract<WocMarketViewModel, { kind: 'ready' }>): string {
    const d = model.browse.detail;
    if (!d) return '';
    const name = this.itemName(d.row.itemId);
    const buyNowOnly = d.row.format === 'buy_now';
    // The estimate names the amount it converts (the same rule the server
    // priced: the current bid, else the starting bid), and its slot is kept
    // while the figure is on its way so the form below never moves.
    const estimate = d.estimateAmount
      ? `<p class="wm-estimate">${esc(
          t('hudChrome.wocMarket.estimateNote', {
            tokens: this.tokens(d.estimateAmount.tokens),
            usd: this.usd(d.row.currentCents ?? d.row.startCents),
          }),
        )}</p>`
      : `<p class="wm-estimate"></p>`;
    const sales = wocSalesHistoryHtml(this.sales === null ? null : d.sales, (c) => this.usd(c));
    const bidForm = this.bidFormHtml(model, d.row.id, name);
    // EXACT here, unlike the bid: buy-now carries no bond, so the server compares
    // this same price and nothing else.
    const overBuyNow = overWalletBalance(this.buyNowTokens, this.walletTokens());
    const buyNow =
      d.row.buyNowCents !== null && !d.row.mine
        ? // The chrome builder: the walk-away-cost disclosure BEFORE the
          // button, the token equivalence off buy-now's own quote.
          wocBuyNowHtml({
            listingId: d.row.id,
            itemName: name,
            buyNowCents: d.row.buyNowCents,
            locked: d.row.buyNowLocked,
            disabled: model.paused || !model.walletLinked || d.row.buyNowLocked || overBuyNow,
            tokensText: this.buyNowTokens === null ? null : this.tokens(this.buyNowTokens),
            overBalance: overBuyNow,
            usd: (c) => this.usd(c),
          })
        : '';
    // The shared cancel predicate (woc_market_view.ts canCancelListing): a
    // cancel-pending listing offers no second Cancel here either.
    const cancel =
      d.row.mine && canCancelListing(d.row)
        ? `<button type="button" data-action="cancel-listing" data-listing="${d.row.id}" ` +
          `aria-label="${esc(t('hudChrome.wocMarket.cancelAria', { item: name }))}" data-focus-key="wm-cancel">` +
          `${esc(t('hudChrome.wocMarket.cancelButton'))}</button>`
        : '';
    // A fixed-price listing has no bid form, so nothing else would carry the two
    // fields buyNow's own server-side guards demand. Rendered only when the bid
    // form is absent: a legacy combined listing would otherwise emit the same
    // data-field twice and the reader would take whichever came first.
    const buyNowFields = buyNow !== '' && bidForm === '' ? this.confirmFieldsHtml(model) : '';
    // A buy-now-only listing takes no bids: no starting-bid line for a start
    // price that exists only for sorting (the button already carries the
    // price the buyer pays).
    const priceLine = buyNowOnly
      ? ''
      : `<p>${
          d.row.currentCents === null
            ? esc(t('hudChrome.wocMarket.detailStartingBid', { usd: this.usd(d.row.startCents) }))
            : esc(t('hudChrome.wocMarket.detailCurrentBid', { usd: this.usd(d.row.currentCents) }))
        }</p>`;
    return (
      `<div class="wm-detail"><h3>${esc(t('hudChrome.wocMarket.detailTitle'))}</h3>` +
      `<div class="wm-detail-item">${this.itemCellHtml(d.row.itemId, d.row.quality, `detail:${d.row.id}`, d.row.instance)}</div>` +
      `<p>${esc(t('hudChrome.wocMarket.detailSeller', { name: d.row.sellerName }))}</p>` +
      `<p>${esc(wocEndsAtText(d.row.endsAtMs))}</p>` +
      priceLine +
      estimate +
      bidForm +
      buyNowFields +
      buyNow +
      cancel +
      `<h4>${esc(t('hudChrome.wocMarket.detailSales'))}</h4>${sales}</div>`
    );
  }

  private bidFormHtml(
    model: Extract<WocMarketViewModel, { kind: 'ready' }>,
    listingId: number,
    itemName: string,
  ): string {
    const d = model.browse.detail;
    if (!d || d.row.mine || d.row.format === 'buy_now' || d.row.remainingMs <= 0) return '';
    // A LOWER BOUND on the server's rule, which checks the bid PLUS its bond.
    // The bond for an arbitrary bid is server-computed and the client may not
    // derive money, so this catches the clear case (bidding well past what you
    // hold) and leaves the narrow band between bid and bid+bond to the server's
    // own refusal. Erring this way only ever permits, never wrongly blocks.
    const overBid = overWalletBalance(this.bidEquivalentTokens, this.walletTokens());
    const disabled = model.paused || !model.walletLinked || this.busy || overBid ? 'disabled' : '';
    return (
      `<div class="wm-bid-form">` +
      `<p class="wm-min-next">${esc(t('hudChrome.wocMarket.detailMinNext', { usd: this.usd(d.row.minNextBidCents) }))}</p>` +
      `<label>${esc(t('hudChrome.wocMarket.bidLabel'))}` +
      `<input type="number" inputmode="decimal" min="0" step="0.25" data-field="bid-usd" data-focus-key="wm-bid-usd" placeholder="${esc(
        t('hudChrome.wocMarket.bidPlaceholder'),
      )}" /></label>` +
      // Empty until the server has quoted the typed price, so it never claims a
      // rate it does not have.
      (this.bidEquivalentTokens === null
        ? ''
        : `<p class="wm-bid-equiv${overBid ? ' over-balance' : ''}">${esc(
            t('hudChrome.trade.woc.equivalent', {
              tokens: this.tokens(this.bidEquivalentTokens),
            }),
          )}</p>`) +
      // Never colour alone: the refusal is also stated in words, beside a button
      // that is actually disabled.
      (overBid
        ? `<p class="wm-over-balance">${esc(t('hudChrome.trade.woc.hintInsufficientBalance'))}</p>`
        : '') +
      this.confirmFieldsHtml(model) +
      // The commitment disclosures (H13), composed by the chrome builder:
      // collapsed behind the Bid terms toggle, always in the DOM before the
      // commit control. Both bond figures are server-computed and ride the
      // row; the client computes no money (the PRD rule).
      wocBidDisclosuresHtml({
        open: this.bidTermsOpen,
        bondCents: d.row.minNextBidBondCents,
        bidCents: d.row.minNextBidCents,
        schedule:
          model.bondSchedule === null
            ? null
            : {
                ...model.bondSchedule,
                payWindowText: this.countdown(model.bondSchedule.pendingTtlSeconds),
              },
        offerNext: d.offerNext,
        settlementWindowText: this.countdown(model.settlementWindowSeconds),
        usd: (c) => this.usd(c),
      }) +
      `<button type="button" class="wm-primary" data-action="place-bid" data-listing="${listingId}" ${disabled} ` +
      `aria-label="${esc(t('hudChrome.wocMarket.bidAria', { item: itemName }))}" data-focus-key="wm-bid-submit">` +
      `${esc(t('hudChrome.wocMarket.bidButton'))}</button></div>`
    );
  }

  /**
   * The field the SERVER demands before it will take money: the terms
   * acceptance. It was two until 2FA came off the Exchange's paying side; the
   * helper stays because the same reasoning applies to whatever the server gates
   * on next, and because both the bid form and the buy-now path still need it.
   *
   * One definition, rendered by whichever action is on screen, because the
   * server's guards do not care which one it was. Both `placeBid` and `buyNow`
   * runs guardTerms, but this input used to live only inside the bid form, which
   * is suppressed for a fixed-price listing: a buyer who had not yet accepted the
   * terms got terms_required with no checkbox to tick, a dead end with no way out
   * of the UI, and one that could not appear on a legacy combined listing, which
   * is the only kind the local database held.
   */
  private confirmFieldsHtml(model: Extract<WocMarketViewModel, { kind: 'ready' }>): string {
    // The terms are LINKED at the moment of acceptance (draft Terms 10.3):
    // a checkbox naming a document the player cannot reach recorded consent
    // to nothing (the R9 cluster's Exchange half). Caption and link share one
    // row and one size, so they read as one sentence.
    const termsRow = model.activity?.termsAccepted
      ? ''
      : `<div class="wm-terms-row"><label class="wm-terms"><input type="checkbox" data-field="accept-terms" data-focus-key="wm-terms" ${this.acceptTerms ? 'checked' : ''} /> ${esc(
          t('hudChrome.wocMarket.termsLabel'),
        )}</label> <a class="wm-terms-link" href="${esc(termsUrlFor(globalThis.location?.origin ?? ''))}" target="_blank" rel="noopener noreferrer">${esc(
          t('hudChrome.wocMarket.termsLink'),
        )}</a></div>`;
    return termsRow;
  }

  private sellHtml(model: Extract<WocMarketViewModel, { kind: 'ready' }>): string {
    // The picker hides a copy the player locked themselves, and the note says
    // so instead of leaving it silently missing. The count comes from the view
    // core's own filter, run with the lock arm inverted, so the caption appears
    // only for a copy UNLOCKING would actually bring back: asking the bags
    // "is anything locked" claimed it about a locked stack of cloth, which the
    // picker would never have offered either way.
    const lockedNote =
      model.sell.lockedOut > 0
        ? `<p class="wm-note">${esc(t('hudChrome.wocMarket.sellLockedHidden'))}</p>`
        : '';
    if (model.sell.rows.length === 0) {
      return wocSellEmptyHtml(model.sell, lockedNote);
    }
    // A searchable dropdown, not a grid of buttons: a full bag is 70+ tradable
    // items and the flat list pushed the form off the screen. An empty query
    // matches everything, so focus alone (onFocusIn) shows the whole list and
    // typing only narrows it.
    const query = this.sellSearch.trim().toLowerCase();
    const matches = model.sell.rows.filter(
      (r) => query === '' || this.itemName(r.itemId).toLowerCase().includes(query),
    );
    const selected = model.sell.rows.find((r) => r.index === this.sellIndex) ?? null;
    // An ARIA 1.2 combobox (the social_window typeahead pattern), not a native
    // select: options carry the item ICON, which a native <option> cannot. The
    // options are non-focusable role=option divs on purpose, exactly as that
    // sibling documents: DOM focus stays on the input and aria-activedescendant
    // moves, so focusable options would also be dragged into the window's
    // focus-trap cycle.
    const listId = SELL_LISTBOX_ID;
    const open = this.sellOpen && selected === null;
    const active =
      open && this.sellActive >= 0 && this.sellActive < matches.length ? this.sellActive : -1;
    const optionsHtml =
      matches.length === 0
        ? `<div class="wm-combo-empty" role="option" aria-selected="false" aria-disabled="true">${esc(
            t('hudChrome.wocMarket.sellNoMatches'),
          )}</div>`
        : matches
            .map((r, i) => {
              // The icon carries the same hover stats card as the selected cell,
              // so a seller can compare candidates without picking one first. The
              // NAME deliberately does not: a card following the pointer across
              // every row while scanning a 70-item list is noise, and the icon is
              // the deliberate target. attachItemTooltips resolves the key. The
              // icon wears the shared quality frame like every other item cell.
              this.tooltipTargets.set(`opt:${r.index}`, {
                itemId: r.itemId,
                instance: r.instance,
              });
              const rung = /^[a-z]+$/.test(r.quality) ? r.quality : 'common';
              const clr = itemNameColor({ quality: r.quality });
              return (
                `<div class="wm-combo-item${i === active ? ' wm-combo-active' : ''}" ` +
                `id="${listId}-o${i}" role="option" aria-selected="${i === active ? 'true' : 'false'}" ` +
                `data-sell-index="${r.index}" data-opt="${i}">` +
                `<img class="wm-combo-icon item-icon q-${rung}" data-tt-key="opt:${r.index}" src="${iconDataUrl('item', r.itemId)}" alt="" draggable="false" />` +
                `<span class="wm-combo-name" style="color: ${clr}">` +
                `${esc(this.itemName(r.itemId))}</span></div>`
              );
            })
            .join('');
    const control = selected
      ? // Selected: the item renders INSIDE the control as a real cell, so the
        // hover stats card still works, with a clear button on the far right
        // (its accessible name is the whole instruction; no native title
        // beside it, the x-btn family convention).
        `<div class="wm-combo-chosen">` +
        this.itemCellHtml(
          selected.itemId,
          selected.quality,
          `sell:${selected.index}`,
          selected.instance,
        ) +
        `<button type="button" class="x-btn wm-combo-clear" data-action="sell-clear" ` +
        `data-focus-key="wm-sell-clear" aria-label="${esc(
          t('hudChrome.wocMarket.sellClear', { item: this.itemName(selected.itemId) }),
        )}">${svgIcon('close')}</button>` +
        `</div>`
      : `<input type="text" class="wm-combo-input" id="${listId}-input" role="combobox" ` +
        `aria-autocomplete="list" aria-controls="${listId}" aria-expanded="${open}" ` +
        (active >= 0 ? `aria-activedescendant="${listId}-o${active}" ` : '') +
        `autocomplete="off" spellcheck="false" ` +
        `data-field="sell-search" data-focus-key="wm-sell-search" ` +
        `placeholder="${esc(t('hudChrome.wocMarket.sellSearchPlaceholder'))}" ` +
        `value="${esc(this.sellSearch)}" />`;
    // `for` only while the input exists: once an item is chosen the control is the
    // chosen cell plus its clear button, and a label pointing at a removed id is
    // worse than a plain caption.
    const picker =
      (selected
        ? `<span class="wm-sell-pick">${esc(t('hudChrome.wocMarket.sellChoose'))}</span>`
        : `<label class="wm-sell-pick" for="${listId}-input">${esc(
            t('hudChrome.wocMarket.sellChoose'),
          )}</label>`) +
      `<div class="wm-combo" data-combo>${control}` +
      `<div class="wm-combo-list" id="${listId}" role="listbox" aria-label="${esc(
        // tPlural, not a flat key: "Choose from 1 items" is what a {count}
        // template produces, and the plural category differs per locale.
        tPlural('hudChrome.plurals.wocMarketSellChoose', matches.length, {
          count: formatNumber(matches.length),
        }),
      )}" ${open ? '' : 'hidden'}>${optionsHtml}</div></div>`;
    // Selected BY VALUE from painter state (never by index: a server-side
    // reorder of the allowlist would otherwise silently change the default).
    const chosenDuration =
      this.sellDurationHours ?? model.durationsHours[1] ?? model.durationsHours[0] ?? null;
    // Each option through the Intl unit formatter (the durationText path), so
    // the plural form is the locale's own for 12, 24 and 48 alike.
    const durations = model.durationsHours
      .map(
        (h) =>
          `<option value="${h}" ${h === chosenDuration ? 'selected' : ''}>${esc(
            formatNumber(h, { style: 'unit', unit: 'hour', unitDisplay: 'long' }),
          )}</option>`,
      )
      .join('');
    // The seller's fee, resolved: the server's split for the price being typed
    // (the same estimate the bid form asks for; the client derives no money),
    // rendered in place under the price fields, with the schedule-free note.
    const fee = this.sellFeeSplit;
    const feeLines =
      fee === null
        ? ''
        : // Each sentence renders as its own line rather than being joined here
          // with a hard ' ': the space between two sentences is a locale's call
          // (CJK sets none), and the arm renders the same pair the same way.
          `<p class="wm-note wm-sell-fee">${esc(
            t('hudChrome.trade.woc.feeLine', {
              fee: this.usd(fee.burnCents + fee.treasuryCents),
            }),
          )}</p>` +
          `<p class="wm-note wm-sell-fee">${esc(
            t('hudChrome.trade.woc.netLine', { net: this.usd(fee.sellerCents) }),
          )}</p>`;
    const form = selected
      ? `<div class="wm-sell-form">` +
        `<label>${esc(t('hudChrome.wocMarket.sellFormat'))}` +
        `<select data-field="sell-format" data-focus-key="wm-sell-format">` +
        `<option value="auction" ${this.sellFormat === 'auction' ? 'selected' : ''}>${esc(t('hudChrome.wocMarket.sellFormatAuction'))}</option>` +
        `<option value="buy_now" ${this.sellFormat === 'buy_now' ? 'selected' : ''}>${esc(t('hudChrome.wocMarket.sellFormatBuyNow'))}</option>` +
        `</select></label>` +
        // Only the fields the CHOSEN format actually permits. The server refuses
        // a reserve on a buy-now (bad_reserve) and a buy-now price on an auction
        // (bad_buy_now), so rendering both unconditionally offered every seller
        // two controls that would be rejected, with the refusal arriving only
        // after they pressed the button. A missing field reads as null, which is
        // exactly what each format requires of the other one.
        //
        // An AUCTION now carries an optional buy-now beside its reserve: filling
        // it in is what turns the listing into the combined format, so the
        // seller opts in by naming a price rather than by picking a third entry
        // from the format list. A PURE buy-now still forbids a reserve, which
        // would describe nothing on a listing with no bidding.
        //
        // The starting bid rides the same gate: it describes bidding, so a pure
        // buy-now never asks for one. The server still requires startCents on
        // every format (it is the browse sort key), so submitListing synthesizes
        // it for a buy-now instead of asking the seller for a number that is
        // never shown and never bid against.
        (this.sellFormat === 'auction'
          ? `<label>${esc(t('hudChrome.wocMarket.sellStart'))}<input type="number" inputmode="decimal" min="0" step="0.25" data-field="sell-start" data-focus-key="wm-sell-start" /></label>` +
            `<label>${esc(t('hudChrome.wocMarket.sellReserve'))}<input type="number" inputmode="decimal" min="0" step="0.25" data-field="sell-reserve" data-focus-key="wm-sell-reserve" /></label>` +
            `<p class="wm-note">${esc(t('hudChrome.wocMarket.sellReserveNote'))}</p>` +
            `<label>${esc(t('hudChrome.wocMarket.sellBuyNowPrice'))}<input type="number" inputmode="decimal" min="0" step="0.25" data-field="sell-buy-now" data-focus-key="wm-sell-buy-now" /></label>` +
            `<p class="wm-note">${esc(t('hudChrome.wocMarket.sellBuyNowAuctionNote'))}</p>`
          : `<label>${esc(t('hudChrome.wocMarket.sellBuyNowPrice'))}<input type="number" inputmode="decimal" min="0" step="0.25" data-field="sell-buy-now" data-focus-key="wm-sell-buy-now" required /></label>` +
            `<p class="wm-note">${esc(t('hudChrome.wocMarket.sellBuyNowNote'))}</p>`) +
        `<label>${esc(t('hudChrome.wocMarket.sellDuration'))}<select data-field="sell-duration" data-focus-key="wm-sell-duration">${durations}</select></label>` +
        // The next-highest-bidder fallback describes bidders, so only an
        // auction offers it; on a pure buy-now the absent checkbox reads as
        // false at submit, which is the only value the format can mean.
        (this.sellFormat === 'auction'
          ? `<label class="wm-offer-next"><input type="checkbox" data-field="sell-offer-next" data-focus-key="wm-sell-offer-next" ${this.sellOfferNext ? 'checked' : ''} /> ${esc(
              t('hudChrome.wocMarket.sellOfferNext'),
            )}</label>`
          : '') +
        `<div class="wm-disclosures">` +
        `<p class="wm-note">${esc(t('hudChrome.wocMarket.sellFeeNote'))}</p>` +
        feeLines +
        `</div>` +
        `<button type="button" class="wm-primary" data-action="sell-submit" ${model.paused || !model.walletLinked || this.busy ? 'disabled' : ''} ` +
        `aria-label="${esc(t('hudChrome.wocMarket.sellSubmitAria', { item: this.itemName(selected.itemId) }))}" data-focus-key="wm-sell-submit">` +
        `${esc(t('hudChrome.wocMarket.sellSubmit'))}</button></div>`
      : '';
    return `<div class="wm-sell"><h3>${esc(t('hudChrome.wocMarket.sellTitle'))}</h3><div class="wm-sell-list">${picker}</div>${lockedNote}${form}</div>`;
  }

  /** The My Activities tab renders through its own pure builder
   *  (woc_market_activity_html.ts): the window hands over its formatters,
   *  tooltip binder and busy flag and paints the returned markup. */
  private activityHtml(model: Extract<WocMarketViewModel, { kind: 'ready' }>): string {
    return wocActivityHtml(model.activity, {
      busy: this.busy,
      itemName: (id) => this.itemName(id),
      // bind, not a wrapper call: the key-discipline scan checks every
      // itemCellHtml CALL carries a literal namespaced key, and the keys for
      // these rows are literals inside the builder.
      itemCell: this.itemCellHtml.bind(this),
      usd: (c) => this.usd(c),
      countdown: (s) => this.countdown(s),
      tip: (slot, text) => this.tip(slot, text),
    });
  }

  private quoteHtml(model: Extract<WocMarketViewModel, { kind: 'ready' }>): string {
    const pending = this.pendingQuote;
    if (!pending) return '';
    void model;
    const q = pending.quote;
    const remainingMs = q.expiresAtMs === null ? 0 : Math.max(0, q.expiresAtMs - Date.now());
    // With no cached USD label, the token legs below carry the amount rather
    // than a fabricated $0.00. A bond names its listing's item when the
    // painter knows it (a retry face after a declined wallet still says which
    // auction it is for).
    const title =
      pending.usdCents === null
        ? t('hudChrome.wocMarket.quoteTitle')
        : pending.kind === 'bond'
          ? pending.itemId === ''
            ? t('hudChrome.wocMarket.quoteBondFor', { usd: this.usd(pending.usdCents) })
            : t('hudChrome.wocMarket.quoteBondForItem', {
                item: this.itemName(pending.itemId),
                usd: this.usd(pending.usdCents),
              })
          : t('hudChrome.wocMarket.quoteSettlementFor', {
              item: this.itemName(pending.itemId),
              usd: this.usd(pending.usdCents),
            });
    // The face itself is the chrome builder's; this painter resolves the
    // title, the token legs and the clock (chrome holds none of them).
    return wocQuoteFaceHtml({
      title,
      amountTokens: q.amount ? this.tokens(q.amount.tokens) : null,
      sellerTokens: q.seller ? this.tokens(q.seller.tokens) : null,
      burnTokens: q.burn ? this.tokens(q.burn.tokens) : null,
      treasuryTokens: q.treasury ? this.tokens(q.treasury.tokens) : null,
      remainingMs,
      // The claim's own payment deadline on a settlement quote (the trade
      // arm's quote face shows its twin): 'Not now' keeps it running.
      dueAtMs: pending.kind === 'settlement' ? pending.deadlineAtMs : null,
      busy: this.busy,
    });
  }

  /** Open the seller click-through pane and fetch their recent trades. The
   *  renderSeq guard is selectListing's: a reload started after this fetch
   *  went out owns the epoch, and the stale answer drops. */
  private openSellerPane(name: string): void {
    if (name === '') return;
    // Re-entry guard: the same seller with a read already outstanding is a
    // no-op, so rapid clicks cannot burn the shared read bucket (the
    // awaiting-chain payment poll spends from the same per-minute allowance).
    if (this.sellerPane?.name === name && this.sellerPane.sales === null) return;
    this.sellerPane = { name, sales: null, profile: null };
    this.render();
    void (async () => {
      const hooks = this.deps.hooks();
      if (!hooks) return;
      const seq = this.renderSeq;
      const out = await hooks.client.sellerHistory(name);
      if (seq !== this.renderSeq) return;
      // Back (or a different seller) won the race: this answer has no home.
      if (this.sellerPane?.name !== name) return;
      this.sellerPane = out.ok
        ? { name, sales: out.sales, profile: out.seller }
        : { name, sales: null, profile: null, failed: true };
      this.render();
    })();
  }

  // -------------------------------------------------------------------------
  // Wiring + actions
  // -------------------------------------------------------------------------

  private wire(root: HTMLElement, model: WocMarketViewModel): void {
    if (model.kind !== 'ready') return;
    wireTabStrip(root, 'wm-tab', (id, focusFollow) => {
      if (id === 'browse' || id === 'sell' || id === 'activity') {
        this.tab = id;
        this.notice = null;
        this.render();
        if (focusFollow) focusActiveTab(root, 'wm-tab', 'wm-tab-selected');
      }
    });
  }

  private field<T extends HTMLElement>(selector: string): T | null {
    return this.deps.root().querySelector<T>(selector);
  }

  private numberFieldCents(selector: string): number | null {
    const el = this.field<HTMLInputElement>(selector);
    if (!el || el.value.trim() === '') return null;
    const dollars = Number(el.value);
    if (!Number.isFinite(dollars) || dollars <= 0) return null;
    return Math.round(dollars * 100);
  }

  /** Typing in the combobox filters and opens the listbox. */
  private onInput(e: Event): void {
    const target = e.target as HTMLElement | null;
    const field = target?.getAttribute('data-field');
    if (field === 'bid-usd') {
      this.onBidPriceInput();
      return;
    }
    // Deliberately NOT the sell price fields: their fee estimate rides the same
    // per-minute bucket as the bond quote, the settlement quote and the refresh
    // (WOC_MARKET_QUOTE_POLICY), so a seller trying prices could spend the
    // allowance the PAYMENT path needs and meet a refusal at the worst moment.
    // The seller's figure is asked for once the value settles (the change
    // event, on blur or Enter) rather than per keystroke; the bidder's live
    // preview keeps its own cadence because a bidder watches it while typing.
    if (field === 'sell-start' || field === 'sell-buy-now') return;
    if (field !== 'sell-search') return;
    this.sellSearch = (target as HTMLInputElement).value;
    this.sellOpen = true;
    // A fresh query invalidates the highlight: keeping the index would leave it
    // pointing at whatever now happens to sit in that position.
    this.sellActive = -1;
    this.render();
  }

  /**
   * The bid's $WOC preview, on the same terms as the p2p trade's.
   *
   * Written IN PLACE into its own line rather than through render(): a rebuild
   * would replace the input under the caret on every keystroke, which is the
   * bug the trade arm already had to solve.
   *
   * Coalesced WITHOUT a timer, unlike the trade arm's 350ms debounce. This file
   * is a cold window and holds a no-self-scheduling contract that its own suite
   * pins by scanning for the token, so a `setTimeout` debounce is not available
   * here. Keeping at most one request in flight and chasing the latest value on
   * completion gets the same property: typing fast costs about one request per
   * round trip rather than one per character, and it needs no clock at all.
   *
   * The figure is the SERVER's, like every other money number here; the client
   * multiplies nothing.
   */
  private onBidPriceInput(): void {
    const cents = this.numberFieldCents('[data-field="bid-usd"]');
    if (cents === null || cents <= 0) {
      // Nothing to preview, and an emptied field must not keep showing the rate
      // for the number that used to be there.
      this.bidEstimateWanted = null;
      if (this.bidEquivalentTokens !== null) {
        this.bidEquivalentTokens = null;
        this.render();
      }
      return;
    }
    this.bidEstimateWanted = cents;
    this.pumpBidEstimate();
  }

  private pumpBidEstimate(): void {
    const cents = this.bidEstimateWanted;
    const hooks = this.deps.hooks();
    if (cents === null || this.bidEstimateInFlight || !hooks) return;
    this.bidEstimateInFlight = true;
    void hooks.client.estimate(cents).then((est) => {
      this.bidEstimateInFlight = false;
      // Stale: the player typed on while this was out. Leave the line alone and
      // chase the number they actually have now.
      if (this.bidEstimateWanted !== cents) {
        this.pumpBidEstimate();
        return;
      }
      this.bidEstimateWanted = null;
      this.bidEquivalentTokens = est?.amount?.tokens ?? null;
      // Through render(), not a raw write into the line. This window rebuilds
      // its whole subtree and already carries the caret and the typed value
      // across with captureFormDraft/captureFocusKey, so the price being typed
      // survives; poking textContent directly would dodge the file's own
      // no-raw-write rule for no benefit.
      this.render();
    });
  }

  /**
   * The seller's fee preview: the server's split for the price being typed
   * (the buy-now price when one is entered, else the starting bid), on the
   * same terms as the bid preview above: in place, coalesced without a timer,
   * the figure the SERVER's. The fee schedule is service configuration and is
   * not on the wire, so this estimate is the one honest source of a resolved
   * fee; the client derives no money.
   */
  private onSellPriceInput(): void {
    const cents =
      this.numberFieldCents('[data-field="sell-buy-now"]') ??
      this.numberFieldCents('[data-field="sell-start"]');
    if (cents === null || cents <= 0) {
      this.sellFeeWanted = null;
      if (this.sellFeeSplit !== null) {
        this.sellFeeSplit = null;
        this.render();
      }
      return;
    }
    this.sellFeeWanted = cents;
    this.pumpSellFee();
  }

  private pumpSellFee(): void {
    const cents = this.sellFeeWanted;
    const hooks = this.deps.hooks();
    if (cents === null || this.sellFeeInFlight || !hooks) return;
    this.sellFeeInFlight = true;
    void hooks.client.estimate(cents).then((est) => {
      this.sellFeeInFlight = false;
      if (this.sellFeeWanted !== cents) {
        this.pumpSellFee();
        return;
      }
      this.sellFeeWanted = null;
      // The split is a passthrough of the wire (an older service sends none,
      // and null then renders no figure); rendered through render() so the
      // typed price and caret ride the form-draft carry like the bid preview.
      const split = est?.split;
      this.sellFeeSplit =
        split && typeof split.sellerCents === 'number'
          ? {
              sellerCents: split.sellerCents,
              burnCents: split.burnCents,
              treasuryCents: split.treasuryCents,
            }
          : null;
      this.render();
    });
  }

  /**
   * Combobox keyboard handling, delegated to the shared dropdownKeyNav core.
   *
   * Space is deliberately NOT passed through. That core was written for a
   * button-triggered listbox where Space means activate; in a text combobox Space
   * is content, and routing it would make the space bar select an item instead of
   * typing. Every other key (arrows, Home, End, Enter, Escape, Tab) keeps the
   * shared semantics rather than a second hand-rolled copy of them.
   */
  private onKeyDown(e: KeyboardEvent): void {
    const target = e.target as HTMLElement | null;
    if (target?.getAttribute('data-field') !== 'sell-search') return;
    if (e.key === ' ') return;
    const matches = this.sellMatches();
    const action = dropdownKeyNav(e.key, this.sellOpen, this.sellActive, matches.length);
    switch (action.kind) {
      case 'open':
        e.preventDefault();
        this.sellOpen = true;
        this.sellActive = action.index;
        this.render();
        return;
      case 'move':
        e.preventDefault();
        this.sellActive = action.index;
        // In place, not a rebuild: see paintSellActive. Arrowing does not change
        // which options exist, only which one is highlighted.
        this.paintSellActive(this.deps.root());
        return;
      case 'select': {
        e.preventDefault();
        const pick = matches[this.sellActive];
        // Enter with nothing highlighted is a no-op, not a silent pick of the
        // first row: the seller has not chosen anything yet.
        if (pick) this.commitSellPick(pick.index);
        return;
      }
      case 'close':
        e.preventDefault();
        this.sellOpen = false;
        this.sellActive = -1;
        this.render();
        return;
      case 'tab':
        // No preventDefault: let Tab move on natively (the shared core's note).
        this.sellOpen = false;
        this.sellActive = -1;
        this.render();
        return;
      default:
        return;
    }
  }

  private onComboMouseDown(e: MouseEvent): void {
    const option = (e.target as HTMLElement | null)?.closest<HTMLElement>('[data-sell-index]');
    if (!option) return;
    e.preventDefault();
    const index = Number(option.dataset.sellIndex);
    if (Number.isInteger(index)) this.commitSellPick(index);
  }

  private onComboMouseMove(e: MouseEvent): void {
    if (!this.sellOpen) return;
    const option = (e.target as HTMLElement | null)?.closest<HTMLElement>('[data-opt]');
    if (!option) return;
    const next = Number(option.dataset.opt);
    // Repaint only on a real change: the pointer fires mousemove continuously.
    if (!Number.isInteger(next) || next === this.sellActive) return;
    this.sellActive = next;
    // In place, and here it is a CORRECTNESS requirement rather than a saving: a
    // rebuild would destroy the very option being hovered and take its stats card
    // with it. See paintSellActive.
    this.paintSellActive(this.deps.root());
  }

  /**
   * Open the full list the moment the control takes focus, before any typing.
   *
   * With an empty query every eligible row matches, so this is the whole scrollable
   * inventory rather than a teaser: the picker behaves like a dropdown you open,
   * not a search box you have to guess at. A player who does not know what is
   * listable should not have to type to find out.
   *
   * The `rendering` guard is the same one onFocusOut needs and load-bearing for the
   * same reason: renderInner's focus restore is itself a focus movement into this
   * input, so without it Escape would close the list and the rebuild it triggers
   * would immediately reopen it.
   */
  private onFocusIn(e: FocusEvent): void {
    if (this.rendering || this.sellOpen) return;
    const target = e.target as HTMLElement | null;
    if (target?.getAttribute('data-field') !== 'sell-search') return;
    this.sellOpen = true;
    this.sellActive = -1;
    this.render();
  }

  /**
   * Move the highlight IN PLACE, without a rebuild.
   *
   * The sibling this copies is social_window's highlightSuggest, and the reason is
   * not only cost. A rebuild replaces the option the pointer is resting on, and a
   * removed node fires no mouseleave, so the hover stats card would be hidden and
   * then never re-shown: mouseenter does not fire again on the replacement while
   * the pointer sits still. Repainting the highlight instead leaves the hovered
   * option, and its tooltip binding, alive.
   *
   * scrollIntoView is a scroll COMMAND, not one of the forced-reflow reads the
   * cold contract counts, and it is what the sibling combobox uses for exactly
   * this case. It is needed here: the list opens at full length, so arrowing down
   * leaves the visible 240px almost immediately.
   */
  private paintSellActive(root: HTMLElement): void {
    const input = root.querySelector<HTMLElement>('[data-field="sell-search"]');
    for (const option of root.querySelectorAll<HTMLElement>('[data-opt]')) {
      const on = Number(option.dataset.opt) === this.sellActive;
      option.classList.toggle('wm-combo-active', on);
      option.setAttribute('aria-selected', on ? 'true' : 'false');
      if (on) option.scrollIntoView({ block: 'nearest' });
    }
    // aria-activedescendant is what a screen reader follows while DOM focus stays
    // on the input, so it has to move with the class or the two disagree.
    if (this.sellActive >= 0) {
      input?.setAttribute('aria-activedescendant', `${SELL_LISTBOX_ID}-o${this.sellActive}`);
    } else input?.removeAttribute('aria-activedescendant');
  }

  /**
   * Close the listbox when focus genuinely leaves the combobox.
   *
   * The `rendering` guard is load-bearing, not defensive. Every render() replaces
   * this subtree, and the browser moves focus off the input as part of removing
   * it, firing focusout with a null relatedTarget: indistinguishable from the user
   * clicking away. Checking isConnected does NOT separate them, which cost real
   * debugging time here: the node is still attached at the moment the event fires,
   * so the guard passed and the rebuild closed its own listbox. The symptom looked
   * nothing like the cause, because each keystroke re-rendered, the rebuild
   * cleared sellOpen, and the NEXT key therefore read the list as closed, so Enter
   * and Escape silently fell through to dropdownKeyNav's collapsed branch.
   */
  private onFocusOut(e: FocusEvent): void {
    if (this.rendering || !this.sellOpen) return;
    const target = e.target as HTMLElement | null;
    const combo = target?.closest('[data-combo]');
    if (!combo) return;
    const next = e.relatedTarget as Node | null;
    if (next && combo.contains(next)) return;
    this.sellOpen = false;
    this.sellActive = -1;
    this.render();
  }

  /** What each preserved scroll offset currently refers to. The detail key folds
   *  in the selected listing as well as the tab, because an offset taken in one
   *  listing's pane means nothing in another's. */
  private scrollKeys(model: WocMarketViewModel): WocMarketScrollKeys {
    const listing = model.kind === 'ready' ? model.browse.detail?.row.id : undefined;
    return { body: this.tab, detail: `${this.tab}:${listing ?? ''}` };
  }

  /** The rows the current query matches. One definition, used by the markup and
   *  by the keyboard handler, so the highlight index can never mean two things. */
  private sellMatches(): WocSellRowModel[] {
    const model = this.lastModel;
    if (!model || model.kind !== 'ready') return [];
    const query = this.sellSearch.trim().toLowerCase();
    return model.sell.rows.filter(
      (r) => query === '' || this.itemName(r.itemId).toLowerCase().includes(query),
    );
  }

  private commitSellPick(index: number): void {
    this.sellIndex = index;
    this.sellOpen = false;
    this.sellActive = -1;
    this.sellSearch = '';
    this.render();
  }

  private onChange(e: Event): void {
    const target = e.target as HTMLElement | null;
    if (!target) return;
    const field = target.getAttribute('data-field');
    if (field === 'sell-format') {
      const value = (target as HTMLSelectElement).value;
      // 'auction_buy_now' is deliberately absent: a combined listing is no
      // longer creatable (existing ones still render and settle).
      if (value === 'auction' || value === 'buy_now') {
        this.sellFormat = value;
        // The format swaps WHICH price field exists (a buy-now price on an
        // auction is refused, and the reverse), so a fee resolved for the old
        // field describes a price that is no longer on screen. Drop it, and any
        // in-flight want, before the re-render: leaving it up put a stale
        // "$10.00 fee, you receive $90.00" under a form whose price had just
        // become $5, in the exact spot the copy promises the fee for the price
        // entered. Re-deriving after the render re-asks when a price survived.
        this.sellFeeSplit = null;
        this.sellFeeWanted = null;
        this.render();
        this.onSellPriceInput();
      }
      return;
    }
    // The seller's fee is asked for HERE, on change (blur or Enter), not on the
    // input event: see onInput. One request per settled price instead of one
    // per keystroke, on a bucket the payment path shares.
    if (field === 'sell-start' || field === 'sell-buy-now') {
      this.onSellPriceInput();
      return;
    }
    if (field === 'sell-duration') {
      const value = Number((target as HTMLSelectElement).value);
      if (Number.isFinite(value)) this.sellDurationHours = value;
      return;
    }
    if (field === 'sell-offer-next') {
      this.sellOfferNext = (target as HTMLInputElement).checked;
      return;
    }
    if (field === 'accept-terms') {
      this.acceptTerms = (target as HTMLInputElement).checked;
      return;
    }
    if (field === 'sort') {
      const value = (target as HTMLSelectElement).value;
      if (
        value === 'ending' ||
        value === 'newest' ||
        value === 'price_asc' ||
        value === 'price_desc'
      ) {
        this.sort = value;
        this.page = 0;
        void this.reloadBrowseOnly();
      }
      return;
    }
    // The Browse filters, on the sort's own pattern: every change restarts
    // at page one, because the old page number indexed a different result
    // set. The item box rides the change event (blur or Enter), never the
    // input event: one browse request per settled query, not per keystroke.
    if (field === 'filter-quality') {
      const value = (target as HTMLSelectElement).value;
      this.filterQuality = value === '' ? null : value;
      this.page = 0;
      void this.reloadBrowseOnly();
      return;
    }
    if (field === 'filter-format') {
      const value = (target as HTMLSelectElement).value;
      this.filterFormat = value === 'auction' || value === 'buy_now' ? value : null;
      this.page = 0;
      void this.reloadBrowseOnly();
      return;
    }
    if (field === 'filter-category') {
      const value = (target as HTMLSelectElement).value;
      this.filterCategory =
        value === 'weapon' || value === 'armor' || value === 'mount' || value === 'chroma'
          ? value
          : null;
      // The finer axis belongs to its category: a sword filter surviving a
      // switch to Armor would silently show nothing.
      this.filterSubcategory = null;
      this.page = 0;
      void this.reloadBrowseOnly();
      return;
    }
    if (field === 'filter-subcategory') {
      const value = (target as HTMLSelectElement).value;
      this.filterSubcategory = value === '' ? null : value;
      this.page = 0;
      void this.reloadBrowseOnly();
      return;
    }
    if (field === 'filter-item') {
      this.filterItemQuery = (target as HTMLInputElement).value;
      this.page = 0;
      void this.reloadBrowseOnly();
    }
  }

  private async reloadBrowseOnly(): Promise<void> {
    const seq = ++this.renderSeq;
    await this.loadBrowse(seq);
    if (seq !== this.renderSeq) return;
    this.render();
  }

  private onClick(e: Event): void {
    const target = (e.target as HTMLElement | null)?.closest<HTMLElement>(
      '[data-action], [data-close], .wm-row-open, .wm-row',
    );
    if (!target) return;
    const action = target.getAttribute('data-action');
    // data-close is the family's close marker (social/bank/report all use it);
    // the action arm stays for any future explicitly-actioned close.
    if (action === 'close' || target.hasAttribute('data-close')) {
      this.close();
      return;
    }
    if (
      !action &&
      (target.classList.contains('wm-row-open') || target.classList.contains('wm-row'))
    ) {
      const id = Number(target.getAttribute('data-listing'));
      if (Number.isFinite(id)) void this.selectListing(id);
      return;
    }
    if (this.busy) return;
    switch (action) {
      case 'page-prev':
        this.page = Math.max(0, this.page - 1);
        void this.reloadBrowseOnly();
        break;
      case 'page-next':
        this.page += 1;
        void this.reloadBrowseOnly();
        break;
      case 'sell-clear':
        // Back to search mode with an empty query, so the seller can pick again
        // without first clearing the box themselves.
        this.sellIndex = null;
        this.sellSearch = '';
        this.sellOpen = false;
        this.sellActive = -1;
        // The fee preview described the price typed for the item just cleared.
        this.sellFeeSplit = null;
        this.sellFeeWanted = null;
        this.render();
        break;
      case 'place-bid':
        void this.placeBid(Number(target.getAttribute('data-listing')));
        break;
      case 'buy-now':
        void this.buyNow(Number(target.getAttribute('data-listing')));
        break;
      case 'cancel-listing':
        void this.cancelListing(Number(target.getAttribute('data-listing')));
        break;
      case 'sell-submit':
        void this.submitListing();
        break;
      case 'pay-bond':
        void this.payBond(Number(target.getAttribute('data-bid')));
        break;
      case 'pay-settlement':
        void this.paySettlement(Number(target.getAttribute('data-settlement')));
        break;
      case 'quote-sign':
        void this.signPendingQuote();
        break;
      case 'quote-refresh':
        void this.refreshPendingQuote();
        break;
      case 'quote-cancel':
        void this.cancelPendingQuote();
        break;
      case 'toggle-bid-terms':
        this.bidTermsOpen = !this.bidTermsOpen;
        this.render();
        break;
      case 'connect-wallet':
        // The shared connect flow owns everything from here (connect, verify,
        // link); the poll picks the linked state up and retires the banner.
        this.deps.openWallet();
        break;
      case 'seller-view':
        this.openSellerPane(target.getAttribute('data-seller') ?? '');
        break;
      case 'seller-back':
        // Back restores the exact browse the player left: page, sort and
        // filters all live on the class, so dropping the pane is enough.
        this.sellerPane = null;
        this.render();
        break;
      default:
        break;
    }
  }

  private ok(key: TranslationKey): void {
    this.notice = { kind: 'key', key, error: false };
  }

  private fail(code: string, params?: Record<string, unknown>): void {
    this.notice = { kind: 'api', code, params, error: true };
  }

  /** Resolve the stored notice to the CURRENT locale's text. Dispatch only:
   *  every sentence comes from the pure mappers (api_error_i18n,
   *  woc_market_reason_text, wallet_bridge_reason_text) or the catalog. */
  private resolveNotice(n: WocNotice): string {
    switch (n.kind) {
      case 'key':
        return t(n.key);
      case 'api':
        return userFacingApiError({ code: n.code, params: n.params });
      case 'pending':
        return wocPaymentPendingText(n.reason);
      case 'bondPending':
        return wocBondPendingText(n.reason);
      case 'bridge':
        return walletBridgeReasonText(n.reason, n.flavor);
    }
  }

  private async withBusy(label: TranslationKey, run: () => Promise<void>): Promise<void> {
    if (this.busy) return;
    const gen = ++this.busyGen;
    this.busy = true;
    this.busyLabel = label;
    this.render();
    try {
      await run();
    } finally {
      // Only settle if THIS run still owns the busy state. A close() or a
      // superseding run bumps busyGen; an abandoned wallet round trip resolving
      // late must not clear a newer run's guard or repaint over its state.
      if (this.busyGen === gen) {
        this.busy = false;
        this.busyLabel = null;
        this.render();
      }
    }
  }

  /** Whether the mutation that owns generation `gen` is still the current one.
   *  A run awaiting a wallet checks this after each await and bails when it is
   *  false: a close() reset the window under it, so proceeding would send a
   *  request and write state a newer run now owns. */
  private stillOwns(gen: number): boolean {
    return this.busyGen === gen;
  }

  private acceptTermsChecked(): boolean {
    return this.acceptTerms;
  }

  private async placeBid(listingId: number): Promise<void> {
    const hooks = this.deps.hooks();
    if (!hooks || !Number.isFinite(listingId)) return;
    const amountCents = this.numberFieldCents('[data-field="bid-usd"]');
    if (amountCents === null) {
      this.fail('woc_market.invalid_input');
      this.render();
      return;
    }
    let quoted = false;
    await this.withBusy('hudChrome.wocMarket.confirming', async () => {
      const out = await hooks.client.placeBid({
        listingId,
        characterId: hooks.characterId(),
        amountCents,
        acceptTerms: this.acceptTermsChecked(),
      });
      if (!out.ok) {
        this.fail(out.code, out.params);
        return;
      }
      this.notice = null;
      this.pendingQuote = {
        kind: 'bond',
        bidId: out.bid.id,
        itemId: this.detail?.itemId ?? '',
        usdCents: out.bid.bondCents,
        quote: out.bond,
      };
      quoted = true;
    });
    // Straight on into the wallet. The bond is not a second decision the player
    // makes, it is what placing a bid COSTS, and stopping to ask again left them
    // holding a listing lock they had not realised they had taken.
    //
    // OUTSIDE the withBusy above, not inside it: withBusy refuses to re-enter
    // while busy, so a nested call would be silently swallowed and the player
    // would be left staring at the quote panel after all.
    //
    // The signature itself cannot be skipped, and is not being skipped here:
    // this service holds no buyer key by design. What goes is the extra click
    // between deciding to bid and being asked to pay for it. A declined wallet
    // still lands on the quote panel, which is now the RETRY surface rather than
    // the happy path, with its own abandon.
    if (quoted) await this.signPendingQuote();
  }

  private async buyNow(listingId: number): Promise<void> {
    const hooks = this.deps.hooks();
    if (!hooks || !Number.isFinite(listingId)) return;
    const itemId = this.detail?.itemId ?? '';
    await this.withBusy('hudChrome.wocMarket.confirming', async () => {
      const out = await hooks.client.buyNow({
        listingId,
        characterId: hooks.characterId(),
        acceptTerms: this.acceptTermsChecked(),
      });
      if (!out.ok) {
        this.fail(out.code, out.params);
        return;
      }
      this.notice = null;
      this.pendingQuote = {
        kind: 'settlement',
        settlementId: out.settlement.id,
        itemId,
        usdCents: out.settlement.amountCents,
        deadlineAtMs:
          typeof out.settlement.deadlineAtMs === 'number' ? out.settlement.deadlineAtMs : null,
        quote: out.quote,
      };
    });
  }

  private async cancelListing(listingId: number): Promise<void> {
    const hooks = this.deps.hooks();
    if (!hooks || !Number.isFinite(listingId)) return;
    await this.withBusy('hudChrome.wocMarket.confirming', async () => {
      const out = await hooks.client.cancelListing(listingId);
      if (!out.ok) {
        this.fail(out.code, out.params);
        return;
      }
      // cancelPending: the cancel was accepted as intent (a buyer holds the
      // short buy-now window); the listing closes on its own unless they pay.
      this.ok(
        out.cancelPending === true
          ? 'hudChrome.wocMarket.listingCancelPending'
          : 'hudChrome.wocMarket.listingCancelled',
      );
      this.selectedId = null;
      this.detail = null;
      await this.reload();
    });
  }

  private async submitListing(): Promise<void> {
    const hooks = this.deps.hooks();
    if (!hooks || this.sellIndex === null) return;
    // Capture the index WITH the slot: the body reads it back after the wallet
    // await, and this.sellIndex can move (or clear) if the window is closed and
    // reopened under a hung signer, which would send the captured slot at the
    // wrong index.
    const itemIndex = this.sellIndex;
    const inventory = this.deps.world().inventory;
    const slot = inventory[itemIndex];
    if (!slot) {
      this.fail('woc_market.stale_item');
      this.render();
      return;
    }
    const format = this.field<HTMLSelectElement>('[data-field="sell-format"]')?.value ?? 'auction';
    const reserveCents = this.numberFieldCents('[data-field="sell-reserve"]');
    const buyNowCents = this.numberFieldCents('[data-field="sell-buy-now"]');
    // A pure buy-now renders no starting-bid field but the server still
    // requires startCents (the browse sort key), and it accepts start === price
    // since there is no bidding (validListingParams). Synthesize the price:
    // price - 1 put a 25c listing at 24, under the floor, refused as bad_start
    // only AFTER the wallet step-up.
    const startCents =
      format === 'buy_now' ? buyNowCents : this.numberFieldCents('[data-field="sell-start"]');
    const durationHours = Number(
      this.field<HTMLSelectElement>('[data-field="sell-duration"]')?.value ?? '',
    );
    const offerNext =
      this.field<HTMLInputElement>('[data-field="sell-offer-next"]')?.checked === true;
    if (startCents === null || !Number.isFinite(durationHours)) {
      this.fail('woc_market.invalid_params');
      this.render();
      return;
    }
    if (format !== 'auction' && format !== 'buy_now') return;
    // Naming a buy-now price on an auction IS the combined format. The seller
    // opts in by filling that field rather than by picking a third entry from
    // the format list, so the two prices stay one decision.
    const submitFormat = format === 'auction' && buyNowCents !== null ? 'auction_buy_now' : format;
    // The buy-now price has to beat the starting bid, and the reserve if one is
    // set. Checked here so the seller is told which field is wrong before a round
    // trip; validListingParams re-checks it server-side, which is the authority,
    // so this mirrors it exactly: a PURE buy-now takes no bids, so start === price
    // is valid (the natural 25c-floor listing) and only the combined auction keeps
    // the strict-above rule. The reserve is nulled for a pure buy-now, as the body
    // below nulls it.
    if (buyNowCents !== null) {
      const effectiveReserve = submitFormat === 'buy_now' ? null : reserveCents;
      const floor = Math.max(startCents, effectiveReserve ?? 0);
      const belowFloor = submitFormat === 'buy_now' ? buyNowCents < floor : buyNowCents <= floor;
      if (belowFloor) {
        this.notice = { kind: 'key', key: 'hudChrome.wocMarket.sellBuyNowAboveStart', error: true };
        this.render();
        return;
      }
    }
    // The exact figures the wallet is asked to authorize; the challenge binds
    // them server-side, so these and the createListing body below must agree
    // byte for byte or the server refuses the pair.
    const listingReserve = submitFormat === 'buy_now' ? null : reserveCents;
    const listingBuyNow = submitFormat === 'auction' ? null : buyNowCents;
    // The mint is a plain REST round trip: the busy line says "Confirming",
    // and only the step that actually hands a message to the wallet says
    // "Waiting for your wallet" (the dev economy's devsig arm never does, so it
    // never claims one). The label used to open on the wallet sentence before
    // the challenge existed, and stayed there through a dev run with no wallet
    // in the flow at all.
    await this.withBusy('hudChrome.wocMarket.confirming', async () => {
      const gen = this.busyGen;
      // Step-up (B6/R1): a fresh server-built challenge, signed by the linked
      // wallet, authorizes THIS listing. The wallet popup shows the message.
      const issued = await hooks.client.stepUpChallenge({
        operation: 'create_listing',
        itemId: slot.itemId,
        // The exact copy, so the signed message names which one leaves the
        // bags and the server binds it (matches the createListing body below).
        expectInstance: slot.instance ?? null,
        format: submitFormat,
        startCents,
        reserveCents: listingReserve,
        buyNowCents: listingBuyNow,
        durationHours,
        offerNext,
      });
      // Bail if the window was closed under the mint: a newer run now owns the
      // state, and proceeding would fail or send a stale request.
      if (!this.stillOwns(gen)) return;
      if (!issued.ok) {
        this.fail(issued.code, issued.params);
        return;
      }
      let stepUpSignature: string;
      if (issued.challenge.signatureRequired === false) {
        // The dev economy's devsig arm, mirrored from the payment path:
        // explicit permission only; an absent flag still goes to the wallet.
        stepUpSignature = `devsig:${issued.challenge.nonce}`;
      } else {
        this.busyLabel = 'hudChrome.wocMarket.signing';
        this.render();
        try {
          stepUpSignature = await hooks.signMessageBase58(
            issued.challenge.message,
            issued.challenge.nonce,
          );
        } catch (err) {
          // Dev channel keeps the raw error; the player line is CLASSIFIED
          // (decline, timeout, missing wallet), never err.message raw (the
          // wallet-bridge i18n medium). A message signature moves no funds,
          // so the generic arm stays the no-"payment" copy.
          console.warn('[wallet bridge] step-up signature failed', err);
          this.notice = {
            kind: 'bridge',
            reason: walletBridgeReason(err),
            flavor: 'sign',
            error: true,
          };
          return;
        }
      }
      // The wallet handoff is the long pole a close can straddle: if it did,
      // abandon before sending so a late signature cannot escrow a copy the
      // player already navigated away from.
      if (!this.stillOwns(gen)) return;
      // A plain REST create, not an on-chain settlement: its own honest label.
      this.busyLabel = 'hudChrome.wocMarket.listing';
      this.render();
      const out = await hooks.client.createListing({
        characterId: hooks.characterId(),
        itemIndex,
        itemId: slot.itemId,
        expectInstance: slot.instance ?? null,
        format: submitFormat,
        startCents,
        // A pure buy-now carries no reserve; an auction, combined or not, may.
        reserveCents: listingReserve,
        // Only a plain auction sends no price. Both buy-now-bearing formats
        // require one, and validListingParams refuses a format and a price that
        // disagree in either direction.
        buyNowCents: listingBuyNow,
        durationHours,
        offerNext,
        stepUp: { nonce: issued.challenge.nonce, signature: stepUpSignature },
      });
      if (!out.ok) {
        this.fail(out.code, out.params);
        return;
      }
      // The create landed; if a close straddled it, the reopened window reloads
      // on its own, so do not write this session's success state over it.
      if (!this.stillOwns(gen)) return;
      this.ok('hudChrome.wocMarket.listingCreated');
      this.sellIndex = null;
      this.sellFeeSplit = null;
      this.sellFeeWanted = null;
      await this.reload();
    });
  }

  private async payBond(bidId: number): Promise<void> {
    const hooks = this.deps.hooks();
    if (!hooks || !Number.isFinite(bidId)) return;
    const bid = this.activity?.bids.find((b) => b.id === bidId) ?? null;
    await this.withBusy('hudChrome.wocMarket.confirming', async () => {
      const out = await hooks.client.bondQuote(bidId);
      if (!out.ok) {
        this.fail(out.code, out.params);
        return;
      }
      this.pendingQuote = {
        kind: 'bond',
        bidId,
        itemId:
          this.activity?.listings.find((l) => l.id === bid?.listingId)?.itemId ?? bid?.itemId ?? '',
        // The QUOTE's service-computed figure labels the prompt: a refresh can
        // re-price the bond (the drift-adopt path), and the cached row is one
        // reload stale. The row is only the fallback for an older server that
        // sends no figure; never render a fabricated $0.00 for a real charge.
        usdCents: out.bond.bondCents ?? bid?.bondCents ?? null,
        quote: out.bond,
      };
    });
  }

  private async paySettlement(settlementId: number): Promise<void> {
    const hooks = this.deps.hooks();
    if (!hooks || !Number.isFinite(settlementId)) return;
    const settlement = this.activity?.settlements.find((s) => s.id === settlementId) ?? null;
    const listing = this.activity?.listings.find((l) => l.id === settlement?.listingId) ?? null;
    await this.withBusy('hudChrome.wocMarket.confirming', async () => {
      const out = await hooks.client.settlementQuote(settlementId);
      if (!out.ok) {
        this.fail(out.code, out.params);
        return;
      }
      this.pendingQuote = {
        kind: 'settlement',
        settlementId,
        itemId: listing?.itemId ?? '',
        usdCents: settlement?.amountCents ?? null,
        deadlineAtMs: settlement?.deadlineAtMs ?? null,
        quote: out.quote,
      };
    });
  }

  /**
   * "Not now", meaning it on the server too.
   *
   * A BOND quote holds a listing-wide lock: the bid exists as pending_bond, and
   * every further bid on that listing is refused until it resolves. Dropping
   * only the client's copy left the player locked out of the auction they were
   * trying to enter, told to abandon a bid through a control that did not
   * exist, for the whole five-minute TTL.
   *
   * A SETTLEMENT quote is not the same and is deliberately left alone: the item
   * is already theirs to pay for, the Activity tab offers Pay now, and there is
   * a deadline rather than a lock. Cancelling that would throw away a purchase.
   */
  private async cancelPendingQuote(): Promise<void> {
    const pending = this.pendingQuote;
    const hooks = this.deps.hooks();
    this.pendingQuote = null;
    if (!hooks || pending?.kind !== 'bond') {
      this.render();
      return;
    }
    await this.withBusy('hudChrome.wocMarket.confirming', async () => {
      const out = await hooks.client.abandonBid(pending.bidId);
      // A failure here is worth saying out loud rather than swallowing: the bid
      // is still holding the lock, and the player needs to know why their next
      // bid is refused. The TTL remains the backstop either way.
      if (!out.ok) this.fail(out.code, out.params);
      await this.reload();
    });
  }

  private async refreshPendingQuote(): Promise<void> {
    const hooks = this.deps.hooks();
    const pending = this.pendingQuote;
    if (!hooks || !pending) return;
    await this.withBusy('hudChrome.wocMarket.confirming', async () => {
      if (pending.kind === 'bond') {
        const out = await hooks.client.bondQuote(pending.bidId);
        // The payBond rule holds on refresh too: a re-quote can re-price the
        // bond (the drift-adopt path persists the service's new figure), and
        // the prompt must label the amount the wallet is about to be asked
        // for, never the figure the stale quote carried.
        if (out.ok) {
          this.pendingQuote = {
            ...pending,
            quote: out.bond,
            usdCents: out.bond.bondCents ?? pending.usdCents,
          };
        } else this.fail(out.code, out.params);
      } else {
        const out = await hooks.client.settlementQuote(pending.settlementId);
        if (out.ok) this.pendingQuote = { ...pending, quote: out.quote };
        else this.fail(out.code, out.params);
      }
    });
  }

  private async signPendingQuote(): Promise<void> {
    const hooks = this.deps.hooks();
    const pending = this.pendingQuote;
    if (!hooks || !pending || pending.quote.transactionBase64 === null) return;
    // The dev arm signs nothing, so it never claims a wallet is waiting; the
    // real arm sets the wallet label right before the handoff (see the listing
    // submit above for the same sequencing).
    await this.withBusy('hudChrome.wocMarket.confirming', async () => {
      let signature: string;
      if (pending.quote.signatureRequired === false) {
        // The trade arm's dev-chain rule, mirrored: the service's stand-in
        // transaction is not signable by any wallet (handing it to a real one
        // threw at atob() before the wallet could reject it), and its
        // verifier matches on the built memo rather than signature bytes.
        // Explicit permission only: an absent flag still goes through the
        // wallet.
        signature = `devsig:${pending.quote.reference ?? ''}`;
      } else {
        this.busyLabel = 'hudChrome.wocMarket.signing';
        this.render();
        try {
          signature = await hooks.signAndSendTransactionBase64(
            pending.quote.transactionBase64 ?? '',
            pending.quote.reference ?? null,
          );
        } catch (err) {
          // Same classification rule as the step-up arm, payment-flavored.
          console.warn('[wallet bridge] payment signature failed', err);
          this.notice = {
            kind: 'bridge',
            reason: walletBridgeReason(err),
            flavor: 'payment',
            error: true,
          };
          return;
        }
      }
      this.busyLabel = 'hudChrome.wocMarket.confirming';
      this.render();
      if (pending.kind === 'bond') {
        const out = await hooks.client.confirmBond(pending.bidId, signature);
        if (!out.ok) {
          this.fail(out.code, out.params);
          return;
        }
        // Three outcomes, not two. "Not standing" used to cover both being
        // outbid and the chain simply not having decided yet, which told a
        // player their good payment had lost. A pending outcome now says
        // WHICH pending (ledger-matched, nothing visible, service down).
        if (out.pending) {
          // BOND-flavored copy: "payment seen" reads as the purchase money,
          // and the figure in flight here is the refundable bid bond.
          this.notice = { kind: 'bondPending', reason: out.reason ?? null, error: false };
        } else {
          this.ok(
            out.standing
              ? 'hudChrome.wocMarket.bidPlacedStanding'
              : 'hudChrome.wocMarket.bidPlacedOutbid',
          );
        }
      } else {
        const out = await hooks.client.confirmSettlement(pending.settlementId, signature);
        if (!out.ok) {
          this.fail(out.code, out.params);
          return;
        }
        // A review-parked payment is neither settled nor lost: the outcome
        // arm answers its state on a recorded-signature retry, and toasting
        // "purchase complete" for money awaiting an operator verdict is the
        // custody lie the row label rule already bans. The row itself
        // renders the same key. The same rule for a still-CONFIRMING answer:
        // it used to toast "purchase complete" while the chain had not
        // decided; it now says which pending it is.
        if (out.state === 'review') {
          this.ok('hudChrome.wocMarket.settlementReview');
        } else if (out.state === 'confirming') {
          this.notice = { kind: 'pending', reason: out.reason ?? null, error: false };
        } else if (out.state === 'confirmed' || out.state === 'delivering') {
          // Decided money, delivery still completing: "complete" would claim
          // a finalize that has not run (the trade arm's paymentConfirmed
          // ladder, mirrored).
          this.ok('hudChrome.wocMarket.paymentConfirmedDelivering');
        } else {
          this.ok('hudChrome.wocMarket.purchaseComplete');
        }
      }
      this.pendingQuote = null;
      this.deps.refreshWocBalance(true); // Token-account changes emit no wallet event.
      await this.reload();
    });
  }
}
