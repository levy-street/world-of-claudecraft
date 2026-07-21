// Thin modal window for CLAUDIUM, the server-authoritative soft currency.
//
// The consumer half of the pure-core + thin-consumer split (reference
// daily_rewards_window.ts / vendor_window.ts). It paints #claudium-window from
// the ClaudiumView (claudium_view.ts) and wires buy / spend / redeem / close. It
// owns NO currency logic: every number (balance, SKU credit, price, store cost,
// the crypto amount to send, the split) arrives through the injected deps, which
// read the economy SDK. When the service is off the view is the disabled/empty
// state and this paints a clean notice, never a crash.
//
// The buy tab offers FOUR rails: Card (stripe) plus three native Solana rails
// (SOL, USDC, WOC). Picking a native rail + an amount asks the service for a
// quote, then this paints a copy-and-confirm PAY panel: the exact crypto amount,
// the destination address, the memo/reference, a live countdown, and (WOC) the
// burn/treasury split. The player pays from their own wallet and pastes the tx
// signature to confirm; there is NO wallet auto-send here (this branch's wallet is
// signMessage-only), and the copy-and-confirm flow is the correct end state. The
// redeem tab takes a gift-card code and shows the credited amount.
//
// All strings are t() keys; all interpolation passes through esc(); colors/sizes
// are CSS tokens (class names), no literal hex/px in this module.

import {
  buildGiftQuoteInput,
  buildGiftReview,
  CLAUDIUM_GIFT_DELIVERIES,
  CLAUDIUM_GIFT_OCCASIONS,
  type ClaudiumGiftDelivery,
  type ClaudiumGiftDraft,
  type ClaudiumGiftOccasion,
  type ClaudiumGiftQuoteInput,
  type ClaudiumGiftReview,
  classifyGiftError,
  emptyGiftDraft,
  giftDraftReadyToReview,
  giftRedeemUrl,
  isValidGiftEmail,
} from './claudium_gift_view';

// Re-exported so the HUD (and other consumers) can import the gift-quote input
// type from the window module without reaching into the pure view-core directly.
export type { ClaudiumGiftQuoteInput } from './claudium_gift_view';

import {
  buildClaudiumInspectModel,
  type ClaudiumInspectModel,
  type CosmeticPreview,
} from './claudium_inspect_view';
import {
  buildClaudiumSupplyModel,
  type ClaudiumSupplyInput,
  type ClaudiumSupplyModel,
  type ClaudiumSupplyPointInput,
  type ClaudiumSupplyRange,
  claudiumSupplyQuery,
} from './claudium_supply_view';
import {
  buildClaudiumQuotePanel,
  buildClaudiumView,
  type ClaudiumNativeQuoteInput,
  type ClaudiumNativeRailId,
  type ClaudiumPriceInput,
  type ClaudiumQuotePanel,
  type ClaudiumRailId,
  type ClaudiumRedeemResult,
  type ClaudiumSkuInput,
  type ClaudiumStoreItemInput,
  type ClaudiumStoreRow,
  type ClaudiumView,
  claudiumRailOptions,
  claudiumToUsd,
  formatQuoteCountdown,
  NATIVE_RAIL_DECIMALS,
  scaleBaseUnits,
} from './claudium_view';
import { markDialogRoot } from './dialog_root';
import { esc } from './esc';
import { formatNumber, type TranslationKey, t } from './i18n';
import { qrToSvg } from './qr';
import { svgIcon } from './ui_icons';

/** The buy rails: the legacy stripe CARD rail plus the three native Solana rails. */
export type ClaudiumRail = ClaudiumRailId;

/** The service-sourced snapshot the window renders (all values from the service). */
export interface ClaudiumSnapshot {
  balance: number | null;
  skus: readonly ClaudiumSkuInput[];
  price: ClaudiumPriceInput;
  storeItems: readonly ClaudiumStoreItemInput[];
}

/** The raw native-quote payload the deps return (mirrors the service SDK shape). */
export type ClaudiumQuotePayload = ClaudiumNativeQuoteInput & {
  /** WOC base-unit decimals ride in the quote; sol/usdc use the fixed table. */
  wocDecimals?: number | null;
};

/** The redeem result the deps return (mirrors the service SDK shape). */
export type ClaudiumRedeemPayload = ClaudiumRedeemResult;

/**
 * The gift-card confirm result: settled + the issued redeem code + cardId (present
 * only once the on-chain payment settles). The window builds the redeem URL + QR from
 * the code; it never fabricates one.
 */
export interface ClaudiumGiftConfirmPayload {
  settled: boolean;
  reason: string | null;
  giftCardCode: string | null;
  cardId: string | null;
}

/** One ledger row the history view renders (mirrors the service LedgerEntryV1). */
export type ClaudiumHistoryReason =
  | 'purchase_stripe'
  | 'purchase_sol'
  | 'purchase_usdc'
  | 'purchase_woc'
  | 'giftcard_redeem'
  | 'spend'
  | 'refund_clawback'
  | 'chargeback_clawback'
  | 'giftcard_void_clawback';

export interface ClaudiumHistoryEntry {
  entryId: string;
  delta: number;
  reason: ClaudiumHistoryReason;
  ref: string;
  atMs: number;
}

/** One newest-first page of ledger entries + the next cursor (null on the last page). */
export interface ClaudiumHistoryPayload {
  entries: ClaudiumHistoryEntry[];
  nextCursor: string | null;
}

/**
 * Hud-supplied glue. The window paints from what these return and reports actions
 * back; it never reaches into Hud. snapshot() is the async service read; buy() runs
 * the legacy stripe flow; spend() redeems a cosmetic. nativeQuote()/nativeConfirm()
 * drive the native-rail pay flow; redeem() drives the gift-card tab. The focus pair
 * comes from Hud.windowFocus(). All of these are absent (return the off state) when
 * the service is off; the window then renders the disabled state.
 */
export interface ClaudiumWindowDeps {
  root(): HTMLElement;
  closeOthers(): void;
  captureFocus(): HTMLElement | null;
  restoreFocus(target: HTMLElement | null): void;
  onVisibilityChange?(): void;
  /** Load the current service snapshot. Rejects only on an unexpected error. */
  snapshot(): Promise<ClaudiumSnapshot>;
  /** Begin a legacy stripe (card) purchase for the chosen SKU. */
  buy(sku: string): void;
  /** Redeem a cosmetic for its Claudium cost. */
  spend(itemId: string, kind: 'cosmetic' | 'skin' | 'item'): void;
  /**
   * Locally preview a cosmetic / weapon skin on the player's own character model
   * WITHOUT owning it (IWorld.previewCosmetic). Render-only; grants nothing and
   * does not persist. Reverted via clearCosmeticPreview.
   */
  previewCosmetic(preview: CosmeticPreview): void;
  /** Revert any active try-on preview (IWorld.clearCosmeticPreview). */
  clearCosmeticPreview(): void;
  /** Quote a native-rail payment for a Claudium amount, crediting the caller. */
  nativeQuote?(rail: ClaudiumNativeRailId, claudium: number): Promise<ClaudiumQuotePayload>;
  /** Confirm a native payment by reference + the pasted on-chain signature. */
  nativeConfirm?(reference: string, signature: string): Promise<ClaudiumRedeemPayload>;
  /** Redeem a gift-card code into the caller's balance. */
  redeem?(code: string): Promise<ClaudiumRedeemPayload>;
  /**
   * Quote a native-rail payment whose settlement ISSUES a gift card (rather than
   * crediting the buyer). Reuses the same native quote plumbing as nativeQuote; only
   * the fulfillment differs. Returns the same quote payload shape.
   */
  giftcardQuote?(input: ClaudiumGiftQuoteInput): Promise<ClaudiumQuotePayload>;
  /**
   * Confirm a gift-card purchase by reference + the pasted on-chain signature. On
   * success the payload carries the issued redeem code + cardId.
   */
  giftcardConfirm?(reference: string, signature: string): Promise<ClaudiumGiftConfirmPayload>;
  /**
   * Fetch one newest-first page of the caller's Claudium ledger. `before` is the
   * cursor from the prior page; omit it for the first page.
   */
  historyPage?(limit: number, before?: string): Promise<ClaudiumHistoryPayload>;
  /**
   * Fetch the economy-wide supply totals plus the curve over one window. Unlike
   * every other dep here this is NOT scoped to the caller: it is the same figure
   * for every player. Absent when the service is off.
   */
  supply?(query: {
    sinceMs: number;
    untilMs: number;
    bucketMs: number;
  }): Promise<ClaudiumSupplyPayload>;
}

/** The service supply read: economy-wide totals plus the curve for one window. */
export interface ClaudiumSupplyPayload {
  supply: ClaudiumSupplyInput;
  points: ClaudiumSupplyPointInput[];
  /**
   * The window the service actually computed `points` for, carried through
   * verbatim. The view plots against THIS, never a locally recomputed window.
   * Null when the service is off.
   */
  serviceWindow: { sinceMs: number; untilMs: number } | null;
}

const EMPTY_SNAPSHOT: ClaudiumSnapshot = {
  balance: null,
  skus: [],
  price: { usdPerClaudium: null, wocBaseUnitsPerClaudium: null },
  storeItems: [],
};

type Tab = 'buy' | 'gift' | 'history' | 'redeem' | 'supply';

/** The supply chart's SVG user-space box. Normalized [0,1] maps into this. */
const SUPPLY_PLOT_W = 320;
const SUPPLY_PLOT_H = 140;

/** The gift wizard phase: collecting the draft, quoting, paying, or done. */
type GiftPhase = 'compose' | 'review' | 'pending' | 'success' | 'error';

function isNativeRail(rail: ClaudiumRailId): rail is ClaudiumNativeRailId {
  return rail === 'sol' || rail === 'usdc' || rail === 'woc';
}

/** The play origin the issued gift redeem link points at (window builds the QR of it). */
const GIFT_REDEEM_ORIGIN = 'https://play.worldofclaudecraft.com';

/** How many ledger rows one history page pulls (server caps; UUID cursor paginates). */
const HISTORY_PAGE_SIZE = 20;

export class ClaudiumWindow {
  private openerFocus: HTMLElement | null = null;
  private renderSeq = 0;
  private tab: Tab = 'buy';
  private selectedRail: ClaudiumRailId = 'stripe';
  // The in-flight native quote (raw payload + the resolved woc decimals) and the
  // Claudium amount it was quoted for. Cleared when the rail/amount changes.
  private quote: ClaudiumQuotePayload | null = null;
  private quoteClaudium: number | null = null;
  private quoteSeq = 0;
  private confirmResult: ClaudiumRedeemPayload | null = null;
  // True while a native confirm is in flight: the pay panel shows a calm
  // "waiting for on-chain confirmation" state instead of dead air (D6).
  private confirmPending = false;
  private redeemResult: ClaudiumRedeemPayload | null = null;
  private countdownTimer: ReturnType<typeof setInterval> | null = null;
  private lastView: ClaudiumView | null = null;
  // ---- Gift wizard state ----
  private giftPhase: GiftPhase = 'compose';
  private giftDraft: ClaudiumGiftDraft = emptyGiftDraft();
  // The in-flight gift quote (native rail) + the seq that guards a stale resolve.
  private giftQuote: ClaudiumQuotePayload | null = null;
  private giftQuoteSeq = 0;
  private giftConfirm: ClaudiumGiftConfirmPayload | null = null;
  private giftError: string | null = null;
  // ---- History state ----
  private historyEntries: ClaudiumHistoryEntry[] = [];
  private historyCursor: string | null = null;
  private historyLoading = false;
  private historyLoaded = false;
  private historyError = false;
  private historyFilter: ClaudiumHistoryReason | 'all' = 'all';
  // ---- Supply state ----
  // The last service read, kept whole so a range switch repaints from the same
  // totals while only the curve refetches.
  private supplyData: ClaudiumSupplyPayload | null = null;
  private supplyRange: ClaudiumSupplyRange = '7d';
  private supplyLoading = false;
  private supplyLoaded = false;
  private supplyError = false;
  private supplySeq = 0;
  // ---- Cosmetic-store inspect + try-on state ----
  // The SKU currently open in the inspect detail view (null = the store list).
  private inspectItemId: string | null = null;
  // The SKU currently being tried on (null = nothing previewed). Toggling it drives
  // deps.previewCosmetic / clearCosmeticPreview; it reverts on close/purchase/tab.
  private tryingOnItemId: string | null = null;

  constructor(private readonly deps: ClaudiumWindowDeps) {}

  get isOpen(): boolean {
    return this.deps.root().style.display === 'block';
  }

  toggle(): void {
    if (this.isOpen) {
      this.close();
      return;
    }
    this.openerFocus = this.deps.captureFocus();
    this.deps.closeOthers();
    const root = this.deps.root();
    root.style.display = 'block';
    this.deps.onVisibilityChange?.();
    this.ensureShell();
    void this.render('open');
  }

  /**
   * Revert an active try-on, if any. Called on window close, purchase, and tab
   * switch so a preview never survives the store (it grants nothing and must not
   * persist). A no-op when nothing is being tried on.
   */
  private stopTryOn(): void {
    if (this.tryingOnItemId === null) return;
    this.tryingOnItemId = null;
    this.deps.clearCosmeticPreview();
  }

  close(): void {
    const root = this.deps.root();
    this.stopCountdown();
    // Always revert a try-on on close (covers close/logout): the preview is local
    // and must not outlive the window.
    this.stopTryOn();
    this.inspectItemId = null;
    if (root.style.display !== 'block') {
      this.openerFocus = null;
      return;
    }
    root.style.display = 'none';
    this.deps.restoreFocus(this.openerFocus);
    this.openerFocus = null;
    this.deps.onVisibilityChange?.();
  }

  async render(focus: 'open' | null = null): Promise<void> {
    const root = this.deps.root();
    const seq = ++this.renderSeq;
    this.ensureShell();
    if (focus === 'open') (root.querySelector('[data-close]') as HTMLElement | null)?.focus();
    let snapshot: ClaudiumSnapshot;
    try {
      snapshot = await this.deps.snapshot();
    } catch {
      // A thrown read is treated exactly like the service being off: the disabled
      // state. The UI never surfaces a crash.
      snapshot = EMPTY_SNAPSHOT;
    }
    if (!this.isOpen || seq !== this.renderSeq) return;
    this.lastView = buildClaudiumView(snapshot);
    this.paint(this.lastView);
  }

  private ensureShell(): void {
    const root = this.deps.root();
    markDialogRoot(root, { labelledBy: 'claudium-title' });
    if (root.querySelector('.cl-body')) return;
    root.innerHTML = this.titleHtml() + `<div class="cl-body"></div>`;
    root.querySelector('[data-close]')?.addEventListener('click', () => this.close());
  }

  private titleHtml(): string {
    return (
      `<div class="panel-title"><span id="claudium-title">${esc(t('hudChrome.claudium.title'))}</span>` +
      `<button type="button" class="x-btn" data-close aria-label="${esc(t('hudChrome.claudium.close'))}">${svgIcon('close')}</button></div>`
    );
  }

  private paint(view: ClaudiumView): void {
    const body = this.deps.root().querySelector<HTMLElement>('.cl-body');
    if (!body) return;
    const panel = view.disabled
      ? ''
      : `<div id="cl-tabpanel" role="tabpanel" aria-labelledby="cl-tab-${this.tab}">` +
        this.tabPanelHtml(view) +
        `</div>`;
    body.innerHTML =
      this.balanceHtml(view) +
      this.noticeHtml(view) +
      this.tabsHtml(view) +
      panel +
      this.disclosureHtml();
    this.wire(body, view);
    this.syncCountdown();
  }

  private balanceHtml(view: ClaudiumView): string {
    // The balance is the ONE number the disabled state hides: with no service there
    // is no balance to show, so render a dash rather than a fabricated zero. When a
    // balance IS known, show its USD equivalent in parentheses (D2): the peg makes
    // the soft-currency count legible as real money.
    const shown = view.hasBalance
      ? t('hudChrome.claudium.amountWithUsd', {
          amount: formatNumber(view.balance ?? 0, { maximumFractionDigits: 0 }),
          usd: this.usdEquiv(view.balance ?? 0, view.usdPerClaudium),
        })
      : t('hudChrome.claudium.balanceUnit', { amount: '--' });
    return (
      `<div class="cl-balance">` +
      `<span class="cl-balance-label">${esc(t('hudChrome.claudium.balanceLabel'))}</span>` +
      `<strong class="cl-balance-value">${esc(shown)}</strong>` +
      `</div>`
    );
  }

  private noticeHtml(view: ClaudiumView): string {
    if (!view.disabled) return '';
    return `<p class="cl-notice" role="status">${esc(t('hudChrome.claudium.unavailable'))}</p>`;
  }

  private tabsHtml(view: ClaudiumView): string {
    if (view.disabled) return '';
    const tab = (id: Tab, label: string): string => {
      const selected = this.tab === id ? 'true' : 'false';
      const tabIndex = this.tab === id ? '0' : '-1';
      return (
        `<button type="button" class="cl-tab" role="tab" id="cl-tab-${id}" data-tab="${id}" ` +
        `aria-selected="${selected}" aria-controls="cl-tabpanel" tabindex="${tabIndex}">${esc(label)}</button>`
      );
    };
    return (
      `<div class="cl-tabs" role="tablist" aria-label="${esc(t('hudChrome.claudium.tabsLabel'))}">` +
      tab('buy', t('hudChrome.claudium.tabBuy')) +
      tab('gift', t('hudChrome.claudium.tabGift')) +
      tab('history', t('hudChrome.claudium.tabHistory')) +
      tab('supply', t('hudChrome.claudium.tabSupply')) +
      tab('redeem', t('hudChrome.claudium.tabRedeem')) +
      `</div>`
    );
  }

  private tabPanelHtml(view: ClaudiumView): string {
    switch (this.tab) {
      case 'gift':
        return this.giftTabHtml();
      case 'history':
        return this.historyTabHtml();
      case 'supply':
        return this.supplyTabHtml();
      case 'redeem':
        return this.redeemTabHtml(view);
      default:
        return this.buyTabHtml(view);
    }
  }

  // ---- Buy tab ----------------------------------------------------------------

  private buyTabHtml(view: ClaudiumView): string {
    if (view.disabled) return '';
    // When a SKU is open in the inspect detail view, that detail REPLACES the buy
    // ladder + store list (a focused pre-purchase view with try-on). If the open id
    // no longer exists in the snapshot, fall through to the store list.
    if (this.inspectItemId !== null) {
      const row = view.storeRows.find((r) => r.itemId === this.inspectItemId);
      if (row) return this.inspectDetailHtml(view, row);
      this.inspectItemId = null;
    }
    return (
      `<section class="cl-section"><h3>${esc(t('hudChrome.claudium.buyTitle'))}</h3>` +
      this.railPickerHtml(view) +
      (isNativeRail(this.selectedRail) ? this.nativePanelHtml() : this.stripeAmountHtml(view)) +
      `</section>` +
      this.storeHtml(view)
    );
  }

  /**
   * The SKU inspect detail: the larger art, name, kind, Claudium price (with its USD
   * equivalent), any flavor text the SKU carried, a try-on / stop-trying-on toggle
   * (only when the SKU carries a preview descriptor), and the redeem/top-up action.
   * The model is built by the pure core; this only paints and localizes it.
   */
  private inspectDetailHtml(view: ClaudiumView, row: ClaudiumStoreRow): string {
    const model = buildClaudiumInspectModel(row, view.usdPerClaudium);
    const kindLabel = this.kindLabel(model.kind);
    const cost = t('hudChrome.claudium.amountWithUsd', {
      amount: formatNumber(model.costClaudium, { maximumFractionDigits: 0 }),
      usd: this.usdEquiv(model.costClaudium, view.usdPerClaudium),
    });
    const art = model.art
      ? `<img class="cl-inspect-art" src="${esc(model.art)}" alt="${esc(t('hudChrome.claudium.inspectArtAlt', { name: model.name }))}" />`
      : '';
    const desc = model.description
      ? `<p class="cl-inspect-desc">${esc(model.description)}</p>`
      : '';
    const tryingOn = this.tryingOnItemId === model.itemId;
    // Try-on toggle: only when the SKU carries a preview descriptor. The active note
    // makes clear it is a preview that grants nothing.
    const tryOn = model.canTryOn
      ? tryingOn
        ? `<button type="button" class="cl-rail" data-tryon-stop aria-pressed="true">${esc(t('hudChrome.claudium.tryOnStopButton'))}</button>` +
          `<p class="cl-inspect-note" role="status">${esc(t('hudChrome.claudium.tryOnActiveNote'))}</p>`
        : `<button type="button" class="cl-rail" data-tryon="${esc(model.itemId)}" aria-pressed="false">${esc(t('hudChrome.claudium.tryOnButton'))}</button>`
      : '';
    const affordable = view.balance !== null && view.balance >= model.costClaudium;
    const action = affordable
      ? `<button type="button" class="cl-item-buy" data-item="${esc(model.itemId)}" data-kind="${esc(model.kind)}">${esc(t('hudChrome.claudium.spendButton'))}</button>`
      : `<div class="cl-item-topup">` +
        `<span class="cl-item-short">${esc(t('hudChrome.claudium.insufficientBalance'))}</span>` +
        `<button type="button" class="cl-topup-btn" data-topup>${esc(t('hudChrome.claudium.topUpButton'))}</button>` +
        `</div>`;
    return (
      `<section class="cl-section cl-inspect">` +
      `<div class="cl-pay-actions"><button type="button" class="cl-rail" data-inspect-close>${esc(t('hudChrome.claudium.inspectBack'))}</button></div>` +
      art +
      `<h3 class="cl-inspect-name">${esc(model.name)}</h3>` +
      `<span class="cl-item-kind">${esc(kindLabel)}</span>` +
      desc +
      `<div class="cl-inspect-cost">${esc(cost)}</div>` +
      `<div class="cl-pay-actions">${tryOn}</div>` +
      `<div class="cl-pay-actions">${action}</div>` +
      `</section>`
    );
  }

  private kindLabel(kind: 'cosmetic' | 'skin' | 'item'): string {
    return kind === 'skin'
      ? t('hudChrome.claudium.kindSkin')
      : kind === 'item'
        ? t('hudChrome.claudium.kindItem')
        : t('hudChrome.claudium.kindCosmetic');
  }

  private railPickerHtml(view: ClaudiumView): string {
    const label = (id: ClaudiumRailId): string =>
      id === 'stripe'
        ? t('hudChrome.claudium.railStripe')
        : id === 'sol'
          ? t('hudChrome.claudium.railSol')
          : id === 'usdc'
            ? t('hudChrome.claudium.railUsdc')
            : t('hudChrome.claudium.railWoc');
    const buttons = claudiumRailOptions(view, this.selectedRail)
      .map(
        (opt) =>
          `<button type="button" class="cl-rail" data-rail="${opt.id}" ` +
          `aria-pressed="${opt.selected ? 'true' : 'false'}"${opt.enabled ? '' : ' disabled'}>` +
          `${esc(label(opt.id))}</button>`,
      )
      .join('');
    return `<div class="cl-rails" role="group" aria-label="${esc(t('hudChrome.claudium.railLabel'))}">${buttons}</div>`;
  }

  /** The legacy stripe (card) amount ladder: pick a SKU, buy via the stripe flow. */
  private stripeAmountHtml(view: ClaudiumView): string {
    const rows = view.buyRows
      .map((row) => {
        const usd = this.usdLabel(row.usd);
        const claudium = formatNumber(row.claudium, { maximumFractionDigits: 0 });
        const label = t('hudChrome.claudium.skuRow', { usd, claudium });
        return (
          `<button type="button" class="cl-sku" data-sku="${esc(row.sku)}" aria-label="${esc(label)}">` +
          `<span class="cl-sku-usd">${esc(usd)}</span>` +
          `<span class="cl-sku-claudium">${esc(t('hudChrome.claudium.storeCost', { amount: claudium }))}</span>` +
          `<span class="cl-sku-buy">${esc(t('hudChrome.claudium.buyButton'))}</span>` +
          `</button>`
        );
      })
      .join('');
    const list = view.rails.stripe
      ? `<div class="cl-sku-list">${rows}</div>`
      : `<p class="cl-empty" role="status">${esc(t('hudChrome.claudium.buyUnavailable'))}</p>`;
    return `<div class="cl-amount-label">${esc(t('hudChrome.claudium.amountLabel'))}</div>${list}`;
  }

  /** The native-rail flow: pick an amount to quote, then show the pay panel. */
  private nativePanelHtml(): string {
    if (!this.lastView) return '';
    // Step 1: no quote yet, offer the amount ladder (each rung quotes on click).
    if (this.quote === null || this.quoteClaudium === null) {
      const rows = this.lastView.buyRows
        .map((row) => {
          const claudium = formatNumber(row.claudium, { maximumFractionDigits: 0 });
          const label = t('hudChrome.claudium.amountRow', {
            claudium,
            usd: this.usdLabel(row.usd),
          });
          return (
            `<button type="button" class="cl-sku" data-quote-claudium="${esc(String(row.claudium))}" aria-label="${esc(label)}">` +
            `<span class="cl-sku-claudium">${esc(t('hudChrome.claudium.storeCost', { amount: claudium }))}</span>` +
            `<span class="cl-sku-usd">${esc(this.usdLabel(row.usd))}</span>` +
            `<span class="cl-sku-buy">${esc(t('hudChrome.claudium.quoteButton'))}</span>` +
            `</button>`
          );
        })
        .join('');
      const list = this.lastView.buyRows.length
        ? `<div class="cl-sku-list">${rows}</div>`
        : `<p class="cl-empty" role="status">${esc(t('hudChrome.claudium.buyUnavailable'))}</p>`;
      return `<div class="cl-amount-label">${esc(t('hudChrome.claudium.amountLabel'))}</div>${list}`;
    }
    // Step 2: a quote is in hand, paint the pay panel.
    return this.payPanelHtml(this.currentPanel());
  }

  /** Build the projected quote panel from the raw payload at the current time. */
  private currentPanel(): ClaudiumQuotePanel {
    const rail = isNativeRail(this.selectedRail) ? this.selectedRail : 'sol';
    const woc = rail === 'woc' ? (this.quote?.wocDecimals ?? null) : null;
    return buildClaudiumQuotePanel(rail, this.quote, Date.now(), woc);
  }

  private railName(rail: ClaudiumNativeRailId): string {
    return rail === 'sol'
      ? t('hudChrome.claudium.railSol')
      : rail === 'usdc'
        ? t('hudChrome.claudium.railUsdc')
        : t('hudChrome.claudium.railWoc');
  }

  private payPanelHtml(panel: ClaudiumQuotePanel): string {
    if (panel.disabled) {
      const reason =
        panel.reason === 'rail_disabled'
          ? t('hudChrome.claudium.railDisabled')
          : panel.reason === 'oracle_unavailable'
            ? t('hudChrome.claudium.oracleUnavailable')
            : t('hudChrome.claudium.buyUnavailable');
      // A disabled quote is a plain-language recovery: explain, then offer a fresh
      // quote (re-quote), never a raw reason code (D6 error mapping).
      return (
        `<div class="cl-pay">` +
        `<p class="cl-rail-note" role="status">${esc(reason)}</p>` +
        `<div class="cl-pay-actions">` +
        `<button type="button" class="cl-rail" data-quote-cancel>${esc(t('hudChrome.claudium.requoteButton'))}</button>` +
        `</div>` +
        `</div>`
      );
    }
    const amount = panel.amountDisplay ?? '';
    const railName = this.railName(panel.rail);
    const sendLine = t('hudChrome.claudium.sendExactly', { amount, rail: railName });
    const countdown = panel.expired
      ? t('hudChrome.claudium.quoteExpired')
      : t('hudChrome.claudium.expiresIn', { time: formatQuoteCountdown(panel.countdownMs) });
    // D3: the split shows as ONE clean line ("X WOC burned, Y WOC to treasury") on
    // its own labelled row, never crowding the amount or the treasury address.
    const splitHtml = panel.split
      ? this.field(
          'hudChrome.claudium.splitLabel',
          t('hudChrome.claudium.splitSummary', {
            burn: panel.split.burnDisplay,
            treasury: panel.split.treasuryDisplay,
            rail: railName,
          }),
        )
      : '';
    // D5: an explicit review line before the commit action. For WOC the treasury
    // destination is the split treasury; the USD equivalent uses the quoted
    // Claudium count so the player sees exactly what they pay and receive.
    const usd =
      panel.claudium !== null
        ? this.usdEquiv(panel.claudium, this.lastView?.usdPerClaudium ?? null)
        : '';
    const claudiumText =
      panel.claudium !== null ? formatNumber(panel.claudium, { maximumFractionDigits: 0 }) : '';
    const reviewHtml =
      panel.claudium !== null
        ? this.field(
            'hudChrome.claudium.reviewLabel',
            t('hudChrome.claudium.reviewLine', {
              pay: amount,
              rail: railName,
              claudium: claudiumText,
              usd,
            }),
          )
        : '';
    // The service-computed discount: "N% off", with the base-to-credited bonus. Shown
    // only when the service reported an actual discount (the view already null-guards
    // discountBps > 0). Every number here is service-owned; the window only formats it.
    const discountHtml = panel.discount ? this.discountHtml(panel.discount) : '';
    // D6: a calm pending state while the confirm is in flight; a reassuring retry
    // state on not_finalized; plain-language success/failure otherwise.
    const confirmDone = this.confirmStatusHtml();
    return (
      `<div class="cl-pay">` +
      `<p class="cl-pay-amount"><strong>${esc(sendLine)}</strong></p>` +
      reviewHtml +
      discountHtml +
      this.fieldWithCopy('hudChrome.claudium.addressLabel', panel.destination ?? '') +
      this.field('hudChrome.claudium.memoLabel', panel.memo ?? '') +
      splitHtml +
      `<p class="cl-countdown" role="status">${esc(countdown)}</p>` +
      `<p class="cl-pay-note">${esc(t('hudChrome.claudium.payNote'))}</p>` +
      `<label class="cl-field-label" for="cl-sig">${esc(t('hudChrome.claudium.signatureLabel'))}</label>` +
      `<input id="cl-sig" class="cl-sig-input" type="text" autocomplete="off" spellcheck="false" ` +
      `placeholder="${esc(t('hudChrome.claudium.signaturePlaceholder'))}" />` +
      `<div class="cl-pay-actions">` +
      `<button type="button" class="cl-rail" data-quote-cancel>${esc(t('hudChrome.claudium.back'))}</button>` +
      `<button type="button" class="cl-item-buy" data-quote-confirm${this.confirmPending ? ' disabled' : ''}>${esc(t('hudChrome.claudium.confirmButton'))}</button>` +
      `</div>` +
      confirmDone +
      `</div>`
    );
  }

  /**
   * The discount block: a "N% off" summary, the base-to-credited bonus line, and (for
   * the $WOC rail floor) an always-on incentive note. Every value is service-computed
   * and passed through by the view; this only formats the numbers via formatNumber and
   * never derives a discount. Plain arrows/words only, never an em or en dash.
   */
  private discountHtml(discount: NonNullable<ClaudiumQuotePanel['discount']>): string {
    const percent = formatNumber(discount.percent, { maximumFractionDigits: 2 });
    const summary = t('hudChrome.claudium.discountSummary', { percent });
    const bonus = t('hudChrome.claudium.discountBonus', {
      base: formatNumber(discount.baseClaudium, { maximumFractionDigits: 0 }),
      credited: formatNumber(discount.claudiumCredited, { maximumFractionDigits: 0 }),
      bonus: formatNumber(discount.bonusClaudium, { maximumFractionDigits: 0 }),
    });
    const value = `${summary} (${bonus})`;
    // The $WOC floor incentive: surfaced whenever the always-on floor applies, with a
    // limited-time promo note appended when the service folded a promo into the total.
    const incentive =
      discount.floorBps > 0
        ? `<p class="cl-discount-incentive" role="note">${esc(t('hudChrome.claudium.wocIncentive'))}` +
          (discount.promoBps > 0 ? ` ${esc(t('hudChrome.claudium.wocPromoNote'))}` : '') +
          `</p>`
        : '';
    return (
      `<div class="cl-field cl-discount">` +
      `<span class="cl-field-label">${esc(t('hudChrome.claudium.discountLabel'))}</span>` +
      `<code class="cl-field-value cl-discount-value">${esc(value)}</code>` +
      incentive +
      `</div>`
    );
  }

  private field(labelKey: TranslationKey, value: string): string {
    // Each field on its OWN row with a clear label above the value (D3): the label
    // is a block, the value a block, so nothing runs together.
    return (
      `<div class="cl-field">` +
      `<span class="cl-field-label">${esc(t(labelKey))}</span>` +
      `<code class="cl-field-value">${esc(value)}</code>` +
      `</div>`
    );
  }

  private fieldWithCopy(labelKey: TranslationKey, value: string): string {
    return (
      `<div class="cl-field">` +
      `<span class="cl-field-label">${esc(t(labelKey))}</span>` +
      `<div class="cl-field-copy">` +
      `<code class="cl-field-value cl-address">${esc(value)}</code>` +
      `<button type="button" class="cl-copy-btn" data-copy-address="${esc(value)}" aria-label="${esc(t('hudChrome.claudium.copyAddress'))}">${esc(t('hudChrome.claudium.copyAddress'))}</button>` +
      `</div>` +
      `</div>`
    );
  }

  /**
   * The confirm status line under the pay actions. Order: an in-flight confirm is a
   * calm pending line (D6); then the result maps to plain-language copy with a
   * recovery action, never a raw reason code. not_finalized is reassuring (retry),
   * an expired/oracle reason offers a fresh quote, other failures a plain retry.
   */
  private confirmStatusHtml(): string {
    if (this.confirmPending) {
      return `<p class="cl-rail-note cl-pending" role="status">${esc(t('hudChrome.claudium.confirmPending'))}</p>`;
    }
    const result = this.confirmResult;
    if (!result) return '';
    if (result.credited) {
      return (
        `<p class="cl-rail-note cl-success" role="status">` +
        esc(
          t('hudChrome.claudium.confirmCredited', {
            amount: formatNumber(result.balance ?? 0, { maximumFractionDigits: 0 }),
          }),
        ) +
        `</p>`
      );
    }
    const reason = result.reason;
    if (reason === 'not_finalized') {
      return (
        `<p class="cl-rail-note" role="status">${esc(t('hudChrome.claudium.confirmNotFinalized'))}</p>` +
        `<div class="cl-pay-actions"><button type="button" class="cl-rail" data-quote-confirm>${esc(t('hudChrome.claudium.retryButton'))}</button></div>`
      );
    }
    if (reason === 'expired' || reason === 'oracle_unavailable') {
      return (
        `<p class="cl-rail-note" role="status">${esc(t('hudChrome.claudium.confirmRequote'))}</p>` +
        `<div class="cl-pay-actions"><button type="button" class="cl-rail" data-quote-cancel>${esc(t('hudChrome.claudium.requoteButton'))}</button></div>`
      );
    }
    return `<p class="cl-rail-note" role="status">${esc(t('hudChrome.claudium.confirmFailed'))}</p>`;
  }

  private usdLabel(usd: number): string {
    // The service sends whole-dollar SKUs ($1..$10000). Render with locale grouping
    // but no cents, so $10000 reads $10,000 in en and localizes elsewhere.
    return t('hudChrome.claudium.usdAmount', {
      usd: formatNumber(usd, { maximumFractionDigits: 0 }),
    });
  }

  /**
   * The USD equivalent of a Claudium amount at the view's peg, as a $ figure with
   * cents. Used where no per-row USD is present (the balance, a store price). The
   * peg is service-owned; this only projects it (claudiumToUsd), it never prices.
   */
  private usdEquiv(claudium: number, usdPerClaudium: number | null): string {
    const usd = claudiumToUsd(claudium, usdPerClaudium);
    return t('hudChrome.claudium.usdAmount', {
      usd: formatNumber(usd, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    });
  }

  // ---- Cosmetic store (shared under the buy tab) ------------------------------

  private storeHtml(view: ClaudiumView): string {
    if (view.disabled) return '';
    const kindLabel = (kind: 'cosmetic' | 'skin' | 'item'): string => this.kindLabel(kind);
    const rows =
      view.storeRows.length === 0
        ? `<p class="cl-empty" role="status">${esc(t('hudChrome.claudium.storeEmpty'))}</p>`
        : view.storeRows
            .map((row) => {
              // Show the cost with its USD equivalent (D2), so a store price reads
              // as real money like the balance and SKU rows do.
              const cost = t('hudChrome.claudium.amountWithUsd', {
                amount: formatNumber(row.costClaudium, { maximumFractionDigits: 0 }),
                usd: this.usdEquiv(row.costClaudium, view.usdPerClaudium),
              });
              // D7: when the balance cannot cover this item, swap the redeem button
              // for a "top up" affordance that jumps back to the buy tab.
              const affordable = view.balance !== null && view.balance >= row.costClaudium;
              const action = affordable
                ? `<button type="button" class="cl-item-buy" data-item="${esc(row.itemId)}" data-kind="${esc(row.kind)}" aria-label="${esc(cost)}">${esc(t('hudChrome.claudium.spendButton'))}</button>`
                : `<div class="cl-item-topup">` +
                  `<span class="cl-item-short">${esc(t('hudChrome.claudium.insufficientBalance'))}</span>` +
                  `<button type="button" class="cl-topup-btn" data-topup>${esc(t('hudChrome.claudium.topUpButton'))}</button>` +
                  `</div>`;
              // The inspect affordance opens the detail view (larger art, flavor,
              // and try-on) before any purchase decision.
              const details = `<button type="button" class="cl-item-inspect" data-inspect="${esc(row.itemId)}">${esc(t('hudChrome.claudium.inspectButton'))}</button>`;
              return (
                `<div class="cl-item">` +
                `<span class="cl-item-name">${esc(row.name)}</span>` +
                `<span class="cl-item-kind">${esc(kindLabel(row.kind))}</span>` +
                `<span class="cl-item-cost">${esc(cost)}</span>` +
                details +
                action +
                `</div>`
              );
            })
            .join('');
    return `<section class="cl-section"><h3>${esc(t('hudChrome.claudium.storeTitle'))}</h3><div class="cl-item-list">${rows}</div></section>`;
  }

  // ---- Gift-card tab ----------------------------------------------------------

  private occasionLabel(o: ClaudiumGiftOccasion): string {
    switch (o) {
      case 'birthday':
        return t('hudChrome.claudium.occasionBirthday');
      case 'holiday':
        return t('hudChrome.claudium.occasionHoliday');
      case 'congrats':
        return t('hudChrome.claudium.occasionCongrats');
      case 'thankyou':
        return t('hudChrome.claudium.occasionThankyou');
      default:
        return t('hudChrome.claudium.occasionGeneric');
    }
  }

  private deliveryLabel(d: ClaudiumGiftDelivery): string {
    return d === 'email'
      ? t('hudChrome.claudium.deliveryEmail')
      : d === 'link'
        ? t('hudChrome.claudium.deliveryLink')
        : t('hudChrome.claudium.deliveryReveal');
  }

  private giftTabHtml(): string {
    const title = `<section class="cl-section"><h3>${esc(t('hudChrome.claudium.giftTitle'))}</h3>`;
    switch (this.giftPhase) {
      case 'review':
        return title + this.giftReviewHtml() + this.giftTermsHtml() + `</section>`;
      case 'pending':
        return (
          title +
          `<p class="cl-rail-note cl-pending" role="status">${esc(t('hudChrome.claudium.giftPending'))}</p>` +
          `</section>`
        );
      case 'success':
        return title + this.giftSuccessHtml() + `</section>`;
      case 'error':
        return title + this.giftErrorHtml() + this.giftComposeHtml() + `</section>`;
      default:
        return title + this.giftComposeHtml() + this.giftTermsHtml() + `</section>`;
    }
  }

  private giftComposeHtml(): string {
    const d = this.giftDraft;
    const rows = (this.lastView?.buyRows ?? [])
      .map((row) => {
        const selected = d.claudium === row.claudium;
        const claudium = formatNumber(row.claudium, { maximumFractionDigits: 0 });
        return (
          `<button type="button" class="cl-sku" data-gift-denomination="${esc(String(row.claudium))}" ` +
          `aria-pressed="${selected ? 'true' : 'false'}">` +
          `<span class="cl-sku-claudium">${esc(t('hudChrome.claudium.storeCost', { amount: claudium }))}</span>` +
          `<span class="cl-sku-usd">${esc(this.usdLabel(row.usd))}</span>` +
          `</button>`
        );
      })
      .join('');
    const denomination =
      (this.lastView?.buyRows.length ?? 0) > 0
        ? `<div class="cl-amount-label">${esc(t('hudChrome.claudium.giftDenominationLabel'))}</div><div class="cl-sku-list">${rows}</div>`
        : `<p class="cl-empty" role="status">${esc(t('hudChrome.claudium.buyUnavailable'))}</p>`;

    // Rail picker: the three native rails (the card rail settles a different way and
    // is out of scope for the gift-issue flow, which reuses the native quote path).
    const railBtn = (id: ClaudiumNativeRailId, label: string): string =>
      `<button type="button" class="cl-rail" data-gift-rail="${id}" ` +
      `aria-pressed="${d.rail === id ? 'true' : 'false'}">${esc(label)}</button>`;
    const rails =
      `<div class="cl-amount-label">${esc(t('hudChrome.claudium.railLabel'))}</div>` +
      `<div class="cl-rails" role="group" aria-label="${esc(t('hudChrome.claudium.railLabel'))}">` +
      railBtn('sol', t('hudChrome.claudium.railSol')) +
      railBtn('usdc', t('hudChrome.claudium.railUsdc')) +
      railBtn('woc', t('hudChrome.claudium.railWoc')) +
      `</div>`;

    // Recipient: self or other; other + email delivery needs a valid email.
    const recipient =
      `<div class="cl-amount-label">${esc(t('hudChrome.claudium.giftRecipientLabel'))}</div>` +
      `<div class="cl-rails" role="group" aria-label="${esc(t('hudChrome.claudium.giftRecipientLabel'))}">` +
      `<button type="button" class="cl-rail" data-gift-toself="0" aria-pressed="${d.toSelf ? 'false' : 'true'}">${esc(t('hudChrome.claudium.giftToOther'))}</button>` +
      `<button type="button" class="cl-rail" data-gift-toself="1" aria-pressed="${d.toSelf ? 'true' : 'false'}">${esc(t('hudChrome.claudium.giftToSelf'))}</button>` +
      `</div>`;
    const emailInvalid =
      !d.toSelf &&
      d.delivery === 'email' &&
      d.recipientEmail.trim() !== '' &&
      !isValidGiftEmail(d.recipientEmail);
    const emailField =
      !d.toSelf && d.delivery === 'email'
        ? `<label class="cl-field-label" for="cl-gift-email">${esc(t('hudChrome.claudium.giftEmailLabel'))}</label>` +
          `<input id="cl-gift-email" class="cl-sig-input" type="email" autocomplete="off" spellcheck="false" ` +
          `inputmode="email" aria-invalid="${emailInvalid ? 'true' : 'false'}" ` +
          `value="${esc(d.recipientEmail)}" placeholder="${esc(t('hudChrome.claudium.giftEmailPlaceholder'))}" />` +
          (emailInvalid
            ? `<p class="cl-item-short" role="status">${esc(t('hudChrome.claudium.giftEmailInvalid'))}</p>`
            : '')
        : '';

    // Occasion picker (five templates).
    const occ = CLAUDIUM_GIFT_OCCASIONS.map(
      (o) =>
        `<button type="button" class="cl-rail" data-gift-occasion="${o}" aria-pressed="${d.occasion === o ? 'true' : 'false'}">${esc(this.occasionLabel(o))}</button>`,
    ).join('');
    const occasion =
      `<div class="cl-amount-label">${esc(t('hudChrome.claudium.giftOccasionLabel'))}</div>` +
      `<div class="cl-rails cl-rails-wrap" role="group" aria-label="${esc(t('hudChrome.claudium.giftOccasionLabel'))}">${occ}</div>`;

    // Personal message.
    const message =
      `<label class="cl-field-label" for="cl-gift-message">${esc(t('hudChrome.claudium.giftMessageLabel'))}</label>` +
      `<textarea id="cl-gift-message" class="cl-sig-input cl-gift-message" rows="2" ` +
      `placeholder="${esc(t('hudChrome.claudium.giftMessagePlaceholder'))}">${esc(d.message)}</textarea>`;

    // Delivery method.
    const del = CLAUDIUM_GIFT_DELIVERIES.map(
      (m) =>
        `<button type="button" class="cl-rail" data-gift-delivery="${m}" aria-pressed="${d.delivery === m ? 'true' : 'false'}">${esc(this.deliveryLabel(m))}</button>`,
    ).join('');
    const delivery =
      `<div class="cl-amount-label">${esc(t('hudChrome.claudium.giftDeliveryLabel'))}</div>` +
      `<div class="cl-rails cl-rails-wrap" role="group" aria-label="${esc(t('hudChrome.claudium.giftDeliveryLabel'))}">${del}</div>`;

    // Optional scheduled delivery date.
    const scheduleVal =
      d.deliverAtMs !== null ? new Date(d.deliverAtMs).toISOString().slice(0, 10) : '';
    const schedule =
      `<label class="cl-field-label" for="cl-gift-date">${esc(t('hudChrome.claudium.giftScheduleLabel'))}</label>` +
      `<input id="cl-gift-date" class="cl-sig-input" type="date" value="${esc(scheduleVal)}" />`;

    const ready = giftDraftReadyToReview(d);
    const actions =
      `<div class="cl-pay-actions">` +
      `<button type="button" class="cl-item-buy" data-gift-review${ready ? '' : ' disabled'}>${esc(t('hudChrome.claudium.giftReviewButton'))}</button>` +
      `</div>`;

    return (
      denomination +
      rails +
      recipient +
      emailField +
      occasion +
      message +
      delivery +
      schedule +
      actions
    );
  }

  private giftReviewHtml(): string {
    const review = this.currentGiftReview();
    if (!review) {
      return `<p class="cl-rail-note" role="status">${esc(t('hudChrome.claudium.buyUnavailable'))}</p>`;
    }
    const railName = this.railName(review.rail === 'stripe' ? 'sol' : review.rail);
    const claudiumText = formatNumber(review.claudium, { maximumFractionDigits: 0 });
    const usd = t('hudChrome.claudium.usdAmount', {
      usd: formatNumber(review.usd, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    });
    const line = t('hudChrome.claudium.reviewLine', {
      pay: review.payAmount,
      rail: railName,
      claudium: claudiumText,
      usd,
    });
    const recipientLine = review.toSelf
      ? t('hudChrome.claudium.giftReviewSelf')
      : review.recipientEmail
        ? t('hudChrome.claudium.giftReviewEmail', { email: review.recipientEmail })
        : t('hudChrome.claudium.giftReviewShared');
    const scheduled = review.scheduled
      ? `<p class="cl-pay-note">${esc(t('hudChrome.claudium.giftReviewScheduled'))}</p>`
      : '';
    const destination = this.giftQuote?.destination ?? '';
    const memo = this.giftQuote?.memo ?? '';
    return (
      `<div class="cl-pay">` +
      this.field('hudChrome.claudium.reviewLabel', line) +
      this.field('hudChrome.claudium.giftOccasionLabel', this.occasionLabel(review.occasion)) +
      this.field('hudChrome.claudium.giftRecipientLabel', recipientLine) +
      this.field('hudChrome.claudium.giftDeliveryLabel', this.deliveryLabel(review.delivery)) +
      scheduled +
      this.fieldWithCopy('hudChrome.claudium.addressLabel', destination) +
      this.field('hudChrome.claudium.memoLabel', memo) +
      `<p class="cl-pay-note">${esc(t('hudChrome.claudium.payNote'))}</p>` +
      `<label class="cl-field-label" for="cl-gift-sig">${esc(t('hudChrome.claudium.signatureLabel'))}</label>` +
      `<input id="cl-gift-sig" class="cl-sig-input" type="text" autocomplete="off" spellcheck="false" ` +
      `placeholder="${esc(t('hudChrome.claudium.signaturePlaceholder'))}" />` +
      `<div class="cl-pay-actions">` +
      `<button type="button" class="cl-rail" data-gift-back>${esc(t('hudChrome.claudium.back'))}</button>` +
      `<button type="button" class="cl-item-buy" data-gift-confirm>${esc(t('hudChrome.claudium.giftConfirmButton'))}</button>` +
      `</div>` +
      `</div>`
    );
  }

  /** Project the current gift draft + quote into the review model at the current time. */
  private currentGiftReview(): ClaudiumGiftReview | null {
    if (!this.giftQuote || this.giftDraft.rail === null || this.giftDraft.rail === 'stripe') {
      return null;
    }
    const rail = this.giftDraft.rail;
    const decimals =
      rail === 'sol'
        ? NATIVE_RAIL_DECIMALS.sol
        : rail === 'usdc'
          ? NATIVE_RAIL_DECIMALS.usdc
          : (this.giftQuote.wocDecimals ?? null);
    const payAmount =
      decimals === null ? '' : (scaleBaseUnits(this.giftQuote.amountBase, decimals) ?? '');
    return buildGiftReview(this.giftDraft, payAmount, this.lastView?.usdPerClaudium ?? null);
  }

  private giftSuccessHtml(): string {
    const code = this.giftConfirm?.giftCardCode ?? null;
    const url = giftRedeemUrl(GIFT_REDEEM_ORIGIN, code);
    if (!url) {
      return `<p class="cl-rail-note" role="status">${esc(t('hudChrome.claudium.giftFailed'))}</p>`;
    }
    // The QR encodes the exact redeem URL; colors ride from a token-driven class so it
    // reads in both themes. The buyer shares this link or has the recipient scan it.
    const svg = qrToSvg(url, { moduleSize: 4 });
    return (
      `<p class="cl-rail-note cl-success" role="status">${esc(t('hudChrome.claudium.giftIssued'))}</p>` +
      `<div class="cl-gift-qr" role="img" aria-label="${esc(t('hudChrome.claudium.giftQrAlt'))}">${svg}</div>` +
      this.fieldWithCopy('hudChrome.claudium.giftLinkLabel', url) +
      `<div class="cl-pay-actions">` +
      `<button type="button" class="cl-rail" data-gift-new>${esc(t('hudChrome.claudium.giftAnotherButton'))}</button>` +
      `</div>`
    );
  }

  private giftErrorHtml(): string {
    const kind = classifyGiftError(this.giftError);
    const copy =
      kind === 'expired'
        ? t('hudChrome.claudium.confirmRequote')
        : kind === 'oracle'
          ? t('hudChrome.claudium.oracleUnavailable')
          : kind === 'declined'
            ? t('hudChrome.claudium.giftDeclined')
            : t('hudChrome.claudium.giftFailed');
    return `<p class="cl-rail-note" role="status">${esc(copy)}</p>`;
  }

  private giftTermsHtml(): string {
    return `<p class="cl-disclosure">${esc(t('hudChrome.claudium.giftTerms'))}</p>`;
  }

  // ---- History tab ------------------------------------------------------------

  private historyReasonLabel(reason: ClaudiumHistoryReason): string {
    switch (reason) {
      case 'purchase_stripe':
        return t('hudChrome.claudium.reasonPurchaseStripe');
      case 'purchase_sol':
        return t('hudChrome.claudium.reasonPurchaseSol');
      case 'purchase_usdc':
        return t('hudChrome.claudium.reasonPurchaseUsdc');
      case 'purchase_woc':
        return t('hudChrome.claudium.reasonPurchaseWoc');
      case 'giftcard_redeem':
        return t('hudChrome.claudium.reasonGiftcardRedeem');
      case 'spend':
        return t('hudChrome.claudium.reasonSpend');
      case 'refund_clawback':
        return t('hudChrome.claudium.reasonRefund');
      case 'chargeback_clawback':
        return t('hudChrome.claudium.reasonChargeback');
      default:
        return t('hudChrome.claudium.reasonGiftcardVoid');
    }
  }

  private historyTabHtml(): string {
    const title = `<section class="cl-section"><h3>${esc(t('hudChrome.claudium.historyTitle'))}</h3>`;
    if (this.historyError) {
      return (
        title +
        `<p class="cl-rail-note" role="status">${esc(t('hudChrome.claudium.historyError'))}</p>` +
        `<div class="cl-pay-actions"><button type="button" class="cl-rail" data-history-retry>${esc(t('hudChrome.claudium.retryButton'))}</button></div>` +
        `</section>`
      );
    }
    if (!this.historyLoaded && this.historyLoading) {
      return (
        title +
        `<p class="cl-empty" role="status">${esc(t('hudChrome.claudium.historyLoading'))}</p></section>`
      );
    }
    if (this.historyLoaded && this.historyEntries.length === 0) {
      return (
        title +
        `<p class="cl-empty" role="status">${esc(t('hudChrome.claudium.historyEmpty'))}</p></section>`
      );
    }
    const filtered =
      this.historyFilter === 'all'
        ? this.historyEntries
        : this.historyEntries.filter((e) => e.reason === this.historyFilter);
    const rows = filtered.map((e) => this.historyRowHtml(e)).join('');
    const loadMore =
      this.historyCursor !== null
        ? `<div class="cl-pay-actions"><button type="button" class="cl-rail" data-history-more${this.historyLoading ? ' disabled' : ''}>${esc(t('hudChrome.claudium.historyLoadMore'))}</button></div>`
        : '';
    return (
      title +
      this.historyFilterHtml() +
      `<div class="cl-item-list">${rows}</div>` +
      loadMore +
      `</section>`
    );
  }

  private historyFilterHtml(): string {
    const opt = (id: ClaudiumHistoryReason | 'all', label: string): string =>
      `<option value="${id}"${this.historyFilter === id ? ' selected' : ''}>${esc(label)}</option>`;
    return (
      `<label class="cl-field-label" for="cl-history-filter">${esc(t('hudChrome.claudium.historyFilterLabel'))}</label>` +
      `<select id="cl-history-filter" class="cl-sig-input" data-history-filter>` +
      opt('all', t('hudChrome.claudium.historyFilterAll')) +
      opt('purchase_stripe', this.historyReasonLabel('purchase_stripe')) +
      opt('purchase_sol', this.historyReasonLabel('purchase_sol')) +
      opt('purchase_usdc', this.historyReasonLabel('purchase_usdc')) +
      opt('purchase_woc', this.historyReasonLabel('purchase_woc')) +
      opt('giftcard_redeem', this.historyReasonLabel('giftcard_redeem')) +
      opt('spend', this.historyReasonLabel('spend')) +
      opt('refund_clawback', this.historyReasonLabel('refund_clawback')) +
      opt('chargeback_clawback', this.historyReasonLabel('chargeback_clawback')) +
      opt('giftcard_void_clawback', this.historyReasonLabel('giftcard_void_clawback')) +
      `</select>`
    );
  }

  private historyRowHtml(e: ClaudiumHistoryEntry): string {
    const credit = e.delta >= 0;
    // The signed amount comes straight from the ledger delta; the sign + magnitude are
    // the entry's, never recomputed. The USD equivalent uses the view peg (display
    // only). A negative delta shows its absolute value with a leading minus.
    const magnitude = formatNumber(Math.abs(e.delta), { maximumFractionDigits: 0 });
    const signed = credit
      ? t('hudChrome.claudium.historyCredit', { amount: magnitude })
      : t('hudChrome.claudium.historyDebit', { amount: magnitude });
    const usd = this.usdEquiv(Math.abs(e.delta), this.lastView?.usdPerClaudium ?? null);
    const drill = this.historyDrilldownHtml(e);
    return (
      `<div class="cl-history-row">` +
      `<span class="cl-history-reason">${esc(this.historyReasonLabel(e.reason))}</span>` +
      `<span class="cl-history-time">${esc(this.historyRelativeTime(e.atMs))}</span>` +
      `<span class="cl-history-amount ${credit ? 'cl-history-credit' : 'cl-history-debit'}">${esc(signed)}</span>` +
      `<span class="cl-history-usd">${esc(usd)}</span>` +
      drill +
      `</div>`
    );
  }

  /** Per-entry drilldown: an explorer link for crypto reasons; a receipt note else. */
  private historyDrilldownHtml(e: ClaudiumHistoryEntry): string {
    const crypto =
      e.reason === 'purchase_sol' || e.reason === 'purchase_usdc' || e.reason === 'purchase_woc';
    if (crypto && e.ref) {
      const href = `https://explorer.solana.com/tx/${encodeURIComponent(e.ref)}`;
      return (
        `<a class="cl-history-link" href="${esc(href)}" target="_blank" rel="noopener noreferrer">` +
        `${esc(t('hudChrome.claudium.historyExplorer'))}</a>`
      );
    }
    if (e.reason === 'purchase_stripe') {
      return `<span class="cl-history-note">${esc(t('hudChrome.claudium.historyReceipt'))}</span>`;
    }
    if (e.reason === 'giftcard_redeem' || e.reason === 'giftcard_void_clawback') {
      return `<span class="cl-history-note">${esc(t('hudChrome.claudium.historyGiftNote'))}</span>`;
    }
    return '';
  }

  /** A coarse relative time (just now / N min / N h / N d) from atMs to now. */
  private historyRelativeTime(atMs: number): string {
    const diff = Math.max(0, Date.now() - atMs);
    const min = Math.floor(diff / 60000);
    if (min < 1) return t('hudChrome.claudium.timeJustNow');
    if (min < 60) return t('hudChrome.claudium.timeMinutes', { n: formatNumber(min) });
    const hr = Math.floor(min / 60);
    if (hr < 24) return t('hudChrome.claudium.timeHours', { n: formatNumber(hr) });
    const day = Math.floor(hr / 24);
    return t('hudChrome.claudium.timeDays', { n: formatNumber(day) });
  }

  // ---- Supply tab -------------------------------------------------------------
  //
  // Economy-wide, unlike every other tab: this is the same figure for every
  // player. The pure core (claudium_supply_view.ts) owns availability, the USD
  // conversion at the service peg, and the chart geometry; this method only
  // formats and emits markup. The chart is inline SVG rather than canvas because
  // the panel repaints on interaction, not per frame, so it needs no DPR backing
  // store or write-elision, and SVG stays crisp at any HUD scale.

  private supplyTabHtml(): string {
    const title = `<section class="cl-section"><h3>${esc(t('hudChrome.claudium.supplyTitle'))}</h3>`;
    if (this.supplyError) {
      return (
        title +
        `<p class="cl-rail-note" role="status">${esc(t('hudChrome.claudium.supplyError'))}</p>` +
        `<div class="cl-pay-actions"><button type="button" class="cl-rail" data-supply-retry>${esc(t('hudChrome.claudium.retryButton'))}</button></div>` +
        `</section>`
      );
    }
    if (!this.supplyLoaded && this.supplyLoading) {
      return (
        title +
        `<p class="cl-empty" role="status">${esc(t('hudChrome.claudium.supplyLoading'))}</p></section>`
      );
    }
    if (!this.supplyData) {
      return (
        title +
        `<p class="cl-empty" role="status">${esc(t('hudChrome.claudium.supplyUnavailable'))}</p></section>`
      );
    }

    const model = buildClaudiumSupplyModel({
      supply: this.supplyData.supply,
      points: this.supplyData.points,
      range: this.supplyRange,
      // The window the data was fetched for, NOT a fresh clock: a repaint must
      // not slide the plot forward and shed points off its left edge.
      serviceWindow: this.supplyData.serviceWindow,
    });
    if (!model.available) {
      return (
        title +
        `<p class="cl-empty" role="status">${esc(t('hudChrome.claudium.supplyUnavailable'))}</p></section>`
      );
    }
    return (
      title +
      this.supplyHeadlineHtml(model) +
      this.supplyRangeHtml(model) +
      this.supplyChartHtml(model) +
      this.supplyStatsHtml(model) +
      `<p class="cl-supply-foot">${esc(t('hudChrome.claudium.supplyFootnote'))}</p>` +
      `</section>`
    );
  }

  /** The big number: total in existence, plus its value at the service peg. */
  private supplyHeadlineHtml(model: ClaudiumSupplyModel): string {
    const amount = formatNumber(model.circulating ?? 0, { maximumFractionDigits: 0 });
    const usd =
      model.circulatingUsd !== null
        ? `<p class="cl-supply-usd">${esc(
            t('hudChrome.claudium.supplyUsdValue', {
              amount: formatNumber(model.circulatingUsd, {
                style: 'currency',
                currency: 'USD',
                maximumFractionDigits: 2,
              }),
            }),
          )}</p>`
        : '';
    return (
      `<div class="cl-supply-headline">` +
      `<p class="cl-supply-total">${esc(t('hudChrome.claudium.supplyInExistence', { amount }))}</p>` +
      usd +
      `</div>`
    );
  }

  /** The 24h / 7d / 30d selector, mirroring the range options from the core. */
  private supplyRangeHtml(model: ClaudiumSupplyModel): string {
    const label = (id: ClaudiumSupplyRange): string => {
      if (id === '24h') return t('hudChrome.claudium.supplyRange24h');
      if (id === '7d') return t('hudChrome.claudium.supplyRange7d');
      return t('hudChrome.claudium.supplyRange30d');
    };
    const buttons = model.rangeOptions
      .map(
        (opt) =>
          `<button type="button" class="cl-rail${opt.selected ? ' cl-rail-on' : ''}" ` +
          `data-supply-range="${opt.id}" aria-pressed="${opt.selected ? 'true' : 'false'}">` +
          `${esc(label(opt.id))}</button>`,
      )
      .join('');
    return (
      `<div class="cl-supply-ranges" role="group" ` +
      `aria-label="${esc(t('hudChrome.claudium.supplyRangeLabel'))}">${buttons}</div>`
    );
  }

  /**
   * The curve itself. The core hands over normalized [0,1] points with y already
   * flipped, so this only scales into the SVG box and joins them. An `img` role
   * plus a label keeps it announced as one figure rather than as loose numbers.
   */
  private supplyChartHtml(model: ClaudiumSupplyModel): string {
    const chart = model.chart;
    if (!chart || chart.points.length === 0) {
      return `<p class="cl-empty" role="status">${esc(t('hudChrome.claudium.supplyChartEmpty'))}</p>`;
    }
    const sx = (x: number): string => (x * SUPPLY_PLOT_W).toFixed(2);
    const sy = (y: number): string => (y * SUPPLY_PLOT_H).toFixed(2);
    const line = chart.points.map((p) => `${sx(p.x)},${sy(p.y)}`).join(' ');
    // Close the path down to the baseline so the area under the curve can be
    // tinted, matching the rest of the Claudium panels.
    const first = chart.points[0];
    const last = chart.points[chart.points.length - 1];
    const area = `${sx(first.x)},${SUPPLY_PLOT_H} ${line} ${sx(last.x)},${SUPPLY_PLOT_H}`;
    const gridlines = chart.valueLabels
      .map(
        (g) =>
          `<line class="cl-supply-grid" x1="0" y1="${sy(g.at)}" x2="${SUPPLY_PLOT_W}" y2="${sy(g.at)}" />`,
      )
      .join('');
    const label = t('hudChrome.claudium.supplyChartLabel');
    return (
      `<div class="cl-supply-chart">` +
      `<svg viewBox="0 0 ${SUPPLY_PLOT_W} ${SUPPLY_PLOT_H}" preserveAspectRatio="none" ` +
      `role="img" aria-label="${esc(label)}">` +
      gridlines +
      `<polygon class="cl-supply-area" points="${area}" />` +
      `<polyline class="cl-supply-line" points="${line}" />` +
      `<circle class="cl-supply-head" cx="${sx(last.x)}" cy="${sy(last.y)}" r="3" />` +
      `</svg>` +
      this.supplyAxisHtml(model) +
      `</div>`
    );
  }

  /** The value axis (top and bottom bounds) plus the window delta. */
  private supplyAxisHtml(model: ClaudiumSupplyModel): string {
    const chart = model.chart;
    if (!chart) return '';
    const round = (v: number): string => formatNumber(Math.round(v), { maximumFractionDigits: 0 });
    const change = this.supplyChangeText(model);
    return (
      `<div class="cl-supply-axis">` +
      `<span class="cl-supply-axis-hi">${esc(round(chart.maxCirculating))}</span>` +
      `<span class="cl-supply-axis-lo">${esc(round(chart.minCirculating))}</span>` +
      `</div>` +
      `<p class="cl-supply-change" role="status">${esc(change)}</p>`
    );
  }

  /** Net movement across the window, phrased by direction. */
  private supplyChangeText(model: ClaudiumSupplyModel): string {
    const delta = model.changeInWindow;
    if (delta === null || delta === 0) return t('hudChrome.claudium.supplyChangeFlat');
    const amount = formatNumber(Math.abs(delta), { maximumFractionDigits: 0 });
    return delta > 0
      ? t('hudChrome.claudium.supplyChangeUp', { amount })
      : t('hudChrome.claudium.supplyChangeDown', { amount });
  }

  /** The supporting totals: lifetime issued, lifetime sunk, and holder count. */
  private supplyStatsHtml(model: ClaudiumSupplyModel): string {
    const row = (labelKey: TranslationKey, value: string): string =>
      `<div class="cl-supply-stat">` +
      `<span class="cl-supply-stat-label">${esc(t(labelKey))}</span>` +
      `<span class="cl-supply-stat-value">${esc(value)}</span>` +
      `</div>`;
    const n = (v: number | null): string =>
      v === null ? '' : formatNumber(v, { maximumFractionDigits: 0 });
    const parts: string[] = [];
    if (model.issued !== null) parts.push(row('hudChrome.claudium.supplyIssued', n(model.issued)));
    if (model.sunk !== null) parts.push(row('hudChrome.claudium.supplySunk', n(model.sunk)));
    if (model.holders !== null) {
      parts.push(
        `<div class="cl-supply-stat"><span class="cl-supply-stat-label">` +
          `${esc(t('hudChrome.claudium.supplyHolders', { n: n(model.holders) }))}</span></div>`,
      );
    }
    return parts.length > 0 ? `<div class="cl-supply-stats">${parts.join('')}</div>` : '';
  }

  // ---- Redeem tab -------------------------------------------------------------

  private redeemTabHtml(view: ClaudiumView): string {
    if (view.disabled) return '';
    const result = this.redeemResult;
    const resultHtml = result
      ? `<p class="cl-rail-note" role="status">` +
        esc(
          result.credited
            ? t('hudChrome.claudium.redeemed', {
                amount: formatNumber(result.denominationClaudium ?? 0, {
                  maximumFractionDigits: 0,
                }),
                balance: formatNumber(result.balance ?? 0, { maximumFractionDigits: 0 }),
              })
            : t('hudChrome.claudium.redeemFailed'),
        ) +
        `</p>`
      : '';
    return (
      `<section class="cl-section"><h3>${esc(t('hudChrome.claudium.redeemTitle'))}</h3>` +
      `<label class="cl-field-label" for="cl-code">${esc(t('hudChrome.claudium.enterCode'))}</label>` +
      `<input id="cl-code" class="cl-sig-input" type="text" autocomplete="off" spellcheck="false" ` +
      `placeholder="${esc(t('hudChrome.claudium.codePlaceholder'))}" />` +
      `<div class="cl-pay-actions">` +
      `<button type="button" class="cl-item-buy" data-redeem>${esc(t('hudChrome.claudium.redeemButton'))}</button>` +
      `</div>` +
      resultHtml +
      `</section>`
    );
  }

  private disclosureHtml(): string {
    return `<p class="cl-disclosure">${esc(t('hudChrome.claudium.disclosure'))}</p>`;
  }

  // ---- Wiring -----------------------------------------------------------------

  private wire(body: HTMLElement, view: ClaudiumView): void {
    body.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const raw = btn.dataset.tab;
        const next: Tab =
          raw === 'redeem' || raw === 'gift' || raw === 'history' || raw === 'supply' ? raw : 'buy';
        if (next === this.tab) return;
        // Leaving the buy tab abandons any open inspect + active try-on preview.
        this.stopTryOn();
        this.inspectItemId = null;
        this.tab = next;
        this.paint(view);
        // Lazily load the first history page the first time the tab is opened.
        if (next === 'history' && !this.historyLoaded && !this.historyLoading) {
          void this.loadHistory(view, false);
        }
        // Same for supply: the economy read only happens once the tab is asked for.
        if (next === 'supply' && !this.supplyLoaded && !this.supplyLoading) {
          void this.loadSupply(view);
        }
      });
    });
    body.querySelectorAll<HTMLButtonElement>('[data-supply-range]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const raw = btn.dataset.supplyRange;
        const next: ClaudiumSupplyRange = raw === '24h' || raw === '30d' ? raw : '7d';
        if (next === this.supplyRange) return;
        this.supplyRange = next;
        // The curve is window-scoped, so a new range needs a new read.
        void this.loadSupply(view);
      });
    });
    body.querySelector<HTMLButtonElement>('[data-supply-retry]')?.addEventListener('click', () => {
      void this.loadSupply(view);
    });
    body.querySelectorAll<HTMLButtonElement>('[data-rail]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const rail = (btn.dataset.rail ?? 'stripe') as ClaudiumRailId;
        if (btn.disabled) return;
        if (rail === this.selectedRail) return;
        this.selectedRail = rail;
        // Switching rails abandons any in-flight quote.
        this.clearQuote();
        this.paint(view);
      });
    });
    // Legacy stripe SKU buy.
    body.querySelectorAll<HTMLButtonElement>('[data-sku]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const sku = btn.dataset.sku;
        if (sku) this.deps.buy(sku);
      });
    });
    // Native-rail: request a quote for the chosen Claudium amount.
    body.querySelectorAll<HTMLButtonElement>('[data-quote-claudium]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const claudium = Number(btn.dataset.quoteClaudium);
        if (Number.isFinite(claudium) && claudium > 0) void this.requestQuote(claudium, view);
      });
    });
    body.querySelector<HTMLButtonElement>('[data-quote-cancel]')?.addEventListener('click', () => {
      this.clearQuote();
      this.paint(view);
    });
    body.querySelectorAll<HTMLButtonElement>('[data-quote-confirm]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const sig = body.querySelector<HTMLInputElement>('#cl-sig')?.value.trim() ?? '';
        void this.confirmNative(sig, view);
      });
    });
    body.querySelectorAll<HTMLButtonElement>('[data-copy-address]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const addr = btn.dataset.copyAddress ?? '';
        if (addr) void navigator.clipboard?.writeText(addr).catch(() => {});
        btn.textContent = t('hudChrome.claudium.copied');
      });
    });
    body.querySelector<HTMLButtonElement>('[data-redeem]')?.addEventListener('click', () => {
      const code = body.querySelector<HTMLInputElement>('#cl-code')?.value.trim() ?? '';
      void this.doRedeem(code, view);
    });
    body.querySelectorAll<HTMLButtonElement>('[data-item]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const itemId = btn.dataset.item;
        const kind = btn.dataset.kind;
        if (itemId && (kind === 'cosmetic' || kind === 'skin' || kind === 'item')) {
          // A purchase reverts any active try-on: the real (now owned) appearance
          // applies via the normal equip path, not the local preview.
          this.stopTryOn();
          this.deps.spend(itemId, kind);
        }
      });
    });
    // Cosmetic-store inspect: open the detail view for a SKU.
    body.querySelectorAll<HTMLButtonElement>('[data-inspect]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const itemId = btn.dataset.inspect;
        if (!itemId) return;
        this.inspectItemId = itemId;
        this.paint(view);
      });
    });
    // Close the inspect detail, reverting any active try-on first.
    body.querySelector<HTMLButtonElement>('[data-inspect-close]')?.addEventListener('click', () => {
      this.stopTryOn();
      this.inspectItemId = null;
      this.paint(view);
    });
    // Try on the inspected SKU locally (only wired when the SKU carries a preview).
    body.querySelectorAll<HTMLButtonElement>('[data-tryon]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const itemId = btn.dataset.tryon;
        if (!itemId) return;
        const row = view.storeRows.find((r) => r.itemId === itemId);
        if (!row?.preview) return;
        this.tryingOnItemId = itemId;
        this.deps.previewCosmetic(row.preview);
        this.paint(view);
      });
    });
    // Stop trying on: revert to the real appearance.
    body.querySelector<HTMLButtonElement>('[data-tryon-stop]')?.addEventListener('click', () => {
      this.stopTryOn();
      this.paint(view);
    });
    // D7: the store "top up" affordance jumps back to the buy tab (where the store
    // and the rail picker live) and scrolls the buy controls into view.
    body.querySelector<HTMLButtonElement>('[data-topup]')?.addEventListener('click', () => {
      if (this.tab !== 'buy') this.tab = 'buy';
      // Top up leaves the inspect detail and reverts any active try-on so the buy
      // ladder + store list are shown.
      this.stopTryOn();
      this.inspectItemId = null;
      this.clearQuote();
      this.paint(view);
      const railsEl = this.deps.root().querySelector('.cl-rails');
      railsEl?.scrollIntoView({ block: 'nearest' });
      (railsEl?.querySelector('.cl-rail:not(:disabled)') as HTMLElement | null)?.focus();
    });
    this.wireGift(body, view);
    this.wireHistory(body, view);
  }

  private wireGift(body: HTMLElement, view: ClaudiumView): void {
    const captureText = (): void => {
      // Read the free-text fields off the DOM so a re-paint (a picker click) keeps them.
      const email = body.querySelector<HTMLInputElement>('#cl-gift-email');
      if (email) this.giftDraft.recipientEmail = email.value;
      const msg = body.querySelector<HTMLTextAreaElement>('#cl-gift-message');
      if (msg) this.giftDraft.message = msg.value;
      const date = body.querySelector<HTMLInputElement>('#cl-gift-date');
      if (date) {
        const v = date.value.trim();
        this.giftDraft.deliverAtMs = v === '' ? null : Date.parse(`${v}T00:00:00Z`) || null;
      }
    };
    body.querySelectorAll<HTMLButtonElement>('[data-gift-denomination]').forEach((btn) => {
      btn.addEventListener('click', () => {
        captureText();
        this.giftDraft.claudium = Number(btn.dataset.giftDenomination);
        this.paint(view);
      });
    });
    body.querySelectorAll<HTMLButtonElement>('[data-gift-rail]').forEach((btn) => {
      btn.addEventListener('click', () => {
        captureText();
        this.giftDraft.rail = btn.dataset.giftRail as ClaudiumNativeRailId;
        this.paint(view);
      });
    });
    body.querySelectorAll<HTMLButtonElement>('[data-gift-toself]').forEach((btn) => {
      btn.addEventListener('click', () => {
        captureText();
        this.giftDraft.toSelf = btn.dataset.giftToself === '1';
        this.paint(view);
      });
    });
    body.querySelectorAll<HTMLButtonElement>('[data-gift-occasion]').forEach((btn) => {
      btn.addEventListener('click', () => {
        captureText();
        this.giftDraft.occasion = btn.dataset.giftOccasion as ClaudiumGiftOccasion;
        this.paint(view);
      });
    });
    body.querySelectorAll<HTMLButtonElement>('[data-gift-delivery]').forEach((btn) => {
      btn.addEventListener('click', () => {
        captureText();
        this.giftDraft.delivery = btn.dataset.giftDelivery as ClaudiumGiftDelivery;
        this.paint(view);
      });
    });
    body.querySelector<HTMLButtonElement>('[data-gift-review]')?.addEventListener('click', () => {
      captureText();
      void this.startGiftReview(view);
    });
    body.querySelector<HTMLButtonElement>('[data-gift-back]')?.addEventListener('click', () => {
      this.giftPhase = 'compose';
      this.giftQuote = null;
      this.paint(view);
    });
    body.querySelector<HTMLButtonElement>('[data-gift-confirm]')?.addEventListener('click', () => {
      void this.confirmGift(view);
    });
    body.querySelector<HTMLButtonElement>('[data-gift-new]')?.addEventListener('click', () => {
      this.resetGift();
      this.paint(view);
    });
  }

  private wireHistory(body: HTMLElement, view: ClaudiumView): void {
    body.querySelector<HTMLButtonElement>('[data-history-retry]')?.addEventListener('click', () => {
      void this.loadHistory(view, false);
    });
    body.querySelector<HTMLButtonElement>('[data-history-more]')?.addEventListener('click', () => {
      void this.loadHistory(view, true);
    });
    body
      .querySelector<HTMLSelectElement>('[data-history-filter]')
      ?.addEventListener('change', (ev) => {
        const value = (ev.target as HTMLSelectElement).value;
        this.historyFilter = value as ClaudiumHistoryReason | 'all';
        this.paint(view);
      });
  }

  // ---- Gift async flow --------------------------------------------------------

  /** Ask the service for a gift-card quote, then move to the review phase. */
  private async startGiftReview(view: ClaudiumView): Promise<void> {
    const input = buildGiftQuoteInput(this.giftDraft);
    if (!input || !this.deps.giftcardQuote) return;
    const seq = ++this.giftQuoteSeq;
    let payload: ClaudiumQuotePayload;
    try {
      payload = await this.deps.giftcardQuote(input);
    } catch {
      payload = {
        reference: null,
        rail: input.rail,
        claudium: input.claudium,
        amountBase: null,
        destination: null,
        mint: null,
        memo: null,
        quoteExpiryMs: null,
        split: null,
        reason: 'unavailable',
      };
    }
    if (!this.isOpen || seq !== this.giftQuoteSeq) return;
    if (payload.reason || !payload.reference) {
      this.giftError = payload.reason;
      this.giftPhase = 'error';
      this.paint(view);
      return;
    }
    this.giftQuote = payload;
    this.giftPhase = 'review';
    this.paint(view);
  }

  /** Confirm the gift purchase. Reuses the pay panel's copy-and-confirm contract: the
   * buyer pays from their wallet and the memo/address show on the review; here we take
   * the signature from a prompt-free inline flow. For simplicity the review carries the
   * pay fields; the signature is captured on the review's own input. */
  private async confirmGift(view: ClaudiumView): Promise<void> {
    const reference = this.giftQuote?.reference;
    if (!reference || !this.deps.giftcardConfirm) return;
    const sig =
      this.deps.root().querySelector<HTMLInputElement>('#cl-gift-sig')?.value.trim() ?? '';
    this.giftPhase = 'pending';
    this.paint(view);
    let result: ClaudiumGiftConfirmPayload;
    try {
      result = await this.deps.giftcardConfirm(reference, sig);
    } catch {
      result = { settled: false, reason: 'unavailable', giftCardCode: null, cardId: null };
    }
    if (!this.isOpen) return;
    if (result.settled && result.giftCardCode) {
      this.giftConfirm = result;
      this.giftPhase = 'success';
    } else {
      this.giftError = result.reason;
      this.giftPhase = 'error';
    }
    this.paint(view);
  }

  private resetGift(): void {
    this.giftPhase = 'compose';
    this.giftDraft = emptyGiftDraft();
    this.giftQuote = null;
    this.giftConfirm = null;
    this.giftError = null;
  }

  // ---- History async flow -----------------------------------------------------

  /** Load a page of history. `more` uses the current cursor and appends; else resets. */
  /**
   * Read the economy-wide supply for the active range. The window is derived by
   * the pure core so the fetch and the plot always agree on their bounds. A
   * failure sets the error state and keeps the panel mounted; it never throws
   * into the caller, matching the fail-closed contract of every Claudium dep.
   */
  private async loadSupply(view: ClaudiumView): Promise<void> {
    if (!this.deps.supply) return;
    // Seq-guard (same idiom as the native quote): only the NEWEST request may
    // settle the state. Deliberately no in-flight early return, so switching
    // range always issues a fresh read; the superseded response drops out below
    // and the newer one owns clearing supplyLoading.
    const seq = ++this.supplySeq;
    this.supplyLoading = true;
    this.supplyError = false;
    this.paint(view);
    let payload: ClaudiumSupplyPayload;
    try {
      payload = await this.deps.supply(claudiumSupplyQuery(this.supplyRange, Date.now()));
    } catch {
      if (seq !== this.supplySeq) return; // a newer request owns the state
      this.supplyLoading = false;
      this.supplyError = true;
      if (this.isOpen) this.paint(view);
      return;
    }
    if (seq !== this.supplySeq) return; // superseded; the newer one settles it
    // Clear the in-flight flag even when the window closed mid-fetch. Bailing
    // out with supplyLoading still true would wedge the tab: nothing supersedes
    // this request, the lazy-load guard refuses to retry, and the panel renders
    // its loading state with no retry button for the rest of the session.
    this.supplyData = payload;
    this.supplyLoading = false;
    this.supplyLoaded = true;
    if (this.isOpen) this.paint(view);
  }

  private async loadHistory(view: ClaudiumView, more: boolean): Promise<void> {
    if (!this.deps.historyPage || this.historyLoading) return;
    this.historyLoading = true;
    this.historyError = false;
    if (!more) {
      this.historyEntries = [];
      this.historyCursor = null;
      this.historyLoaded = false;
    }
    this.paint(view);
    let page: ClaudiumHistoryPayload;
    try {
      page = await this.deps.historyPage(
        HISTORY_PAGE_SIZE,
        more ? (this.historyCursor ?? undefined) : undefined,
      );
    } catch {
      page = { entries: [], nextCursor: null };
      if (!this.isOpen) return;
      this.historyLoading = false;
      this.historyError = true;
      this.paint(view);
      return;
    }
    if (!this.isOpen) return;
    this.historyEntries = more ? this.historyEntries.concat(page.entries) : page.entries;
    this.historyCursor = page.nextCursor;
    this.historyLoading = false;
    this.historyLoaded = true;
    this.paint(view);
  }

  private async requestQuote(claudium: number, view: ClaudiumView): Promise<void> {
    if (!isNativeRail(this.selectedRail) || !this.deps.nativeQuote) return;
    const rail = this.selectedRail;
    const seq = ++this.quoteSeq;
    let payload: ClaudiumQuotePayload;
    try {
      payload = await this.deps.nativeQuote(rail, claudium);
    } catch {
      payload = {
        reference: null,
        rail,
        claudium,
        amountBase: null,
        destination: null,
        mint: null,
        memo: null,
        quoteExpiryMs: null,
        split: null,
        reason: 'unavailable',
      };
    }
    if (!this.isOpen || seq !== this.quoteSeq || this.selectedRail !== rail) return;
    this.quote = payload;
    this.quoteClaudium = claudium;
    this.confirmResult = null;
    this.paint(view);
  }

  private async confirmNative(signature: string, view: ClaudiumView): Promise<void> {
    if (!this.deps.nativeConfirm || !this.quote?.reference || signature === '') return;
    if (this.confirmPending) return;
    const reference = this.quote.reference;
    // Show the calm pending state immediately, then await the on-chain check (D6).
    this.confirmPending = true;
    this.confirmResult = null;
    this.paint(view);
    let result: ClaudiumRedeemPayload;
    try {
      result = await this.deps.nativeConfirm(reference, signature);
    } catch {
      result = {
        credited: false,
        balance: null,
        denominationClaudium: null,
        reason: 'unavailable',
      };
    }
    if (!this.isOpen) return;
    this.confirmPending = false;
    this.confirmResult = result;
    // A credited confirm refreshes the balance from the service on the next render.
    if (result.credited) void this.render();
    else this.paint(view);
  }

  private async doRedeem(code: string, view: ClaudiumView): Promise<void> {
    if (!this.deps.redeem || code === '') return;
    let result: ClaudiumRedeemPayload;
    try {
      result = await this.deps.redeem(code);
    } catch {
      result = {
        credited: false,
        balance: null,
        denominationClaudium: null,
        reason: 'unavailable',
      };
    }
    if (!this.isOpen) return;
    this.redeemResult = result;
    if (result.credited) void this.render();
    else this.paint(view);
  }

  private clearQuote(): void {
    this.quote = null;
    this.quoteClaudium = null;
    this.confirmResult = null;
    this.confirmPending = false;
    this.stopCountdown();
  }

  // ---- Live countdown ---------------------------------------------------------

  /** Repaint only the countdown line each second while a live quote is showing. */
  private syncCountdown(): void {
    const showing =
      this.tab === 'buy' &&
      isNativeRail(this.selectedRail) &&
      this.quote !== null &&
      this.quote.reason === null &&
      this.quote.quoteExpiryMs !== null;
    if (!showing) {
      this.stopCountdown();
      return;
    }
    if (this.countdownTimer) return;
    this.countdownTimer = setInterval(() => this.tickCountdown(), 1000);
  }

  private tickCountdown(): void {
    if (!this.isOpen) {
      this.stopCountdown();
      return;
    }
    const el = this.deps.root().querySelector<HTMLElement>('.cl-countdown');
    if (!el) {
      this.stopCountdown();
      return;
    }
    const panel = this.currentPanel();
    el.textContent = panel.expired
      ? t('hudChrome.claudium.quoteExpired')
      : t('hudChrome.claudium.expiresIn', { time: formatQuoteCountdown(panel.countdownMs) });
  }

  private stopCountdown(): void {
    if (this.countdownTimer) {
      clearInterval(this.countdownTimer);
      this.countdownTimer = null;
    }
  }
}
