import { STORAGE_SKU_LIST } from '../sim/content/storage_charters';
import type { PlayerClass, WeaponSkinType } from '../sim/types';
import type { DailyRewardHistory, DailyRewardStatus, IWorld } from '../world_api';
import { armorySectionHtml } from './armory_card_view';
import { ArmoryInspect } from './armory_inspect';
import {
  charterGrantedText,
  charterName,
  charterOffSurfaceNotice,
  charterRefusalText,
  charterSectionHtml,
} from './charter_card_view';
import { CharterFitMemory } from './charter_fit_memory';
import type { StoreSpendResult } from './claudium_purchase_bridge';
import {
  dailyRewardsLoadingHtml,
  dailyRewardsTitleHtml,
  wocStoreTabsHtml,
} from './daily_rewards_chrome_view';
import { dailyRewardsHistoryHtml, dailyRewardsLeaderboardHtml } from './daily_rewards_ranks_view';
import { SpinOverlay } from './daily_rewards_spin_controller';
import { spinSectionHtml } from './daily_rewards_spin_view';
import {
  buildDailyRewardsView,
  type DailyRewardsView,
  dailyRewardTaskDescription,
} from './daily_rewards_view';
import { dailyRewardsWalletCardHtml } from './daily_rewards_wallet_card_view';
import { markDialogRoot } from './dialog_root';
import { esc } from './esc';
import { captureFocusKey, focusedWithin, focusKeyAttr } from './focus_restore';
import { formatDateTime, formatNumber, t } from './i18n';
import { hydratePortraits } from './portrait_chip';
import { durableIntents, type PurchaseIntentLedger } from './purchase_intent_durability';
import { mintIntentKey } from './purchase_intent_key';
import { rovingTarget } from './roving_index';
import { StoreArmoryPurchase } from './store_armory_purchase';
import type { StoreDecisionPromptOptions } from './store_decision_prompt';
import {
  planStoreFocus,
  restoreStoreErrorFocus,
  restoreStoreFocus,
  StoreFocusStash,
} from './store_focus_policy';
import { StoreSurfaceRuntime } from './store_surface_runtime';
import { usdDollarsText } from './usd_text';
import {
  type ArmorySection,
  type ArmorySkinRow,
  buildArmorySections,
  buildCharterSection,
  type CharterDef,
  type CharterRow,
  emptyCharterSection,
  type WocStoreItemInput,
} from './woc_store_view';

// ── Strongbox Charters ──────────────────────────────────────────────────────
// The store's charter catalog: the four Strongbox bundles, ascending by grant.
// The twelve strongbox_rung_* SKUs carry a ladderIndex and are the BANKER's
// next-rung surface, never a store row, so the absence of a ladderIndex is the
// filter that keeps them out of this grid.
const STORE_CHARTERS: readonly CharterDef[] = STORAGE_SKU_LIST.filter(
  (sku) => sku.ladderIndex === undefined,
)
  .map((sku) => ({ id: sku.id, grantSlots: sku.grantSlots }))
  .sort((a, b) => a.grantSlots - b.grantSlots);

// The purchasable ladder ceiling, DERIVED rather than imported: the "complete"
// charter grants the whole ladder by construction, so the largest charter grant
// IS the ceiling. Deriving it keeps every slot literal and the gold price table
// (BANK_EXPANSION_PRICES) out of src/ui.
const CHARTER_CEILING_SLOTS = STORE_CHARTERS.reduce(
  (max, charter) => Math.max(max, charter.grantSlots),
  0,
);

// The minter moved to src/ui/purchase_intent_key.ts when the banker became the
// second Claudium spender: reaching it from there would have meant one window
// module importing another. Re-exported so existing importers, and the tests
// that pin both of its arms against the server charset, keep working unchanged.
export { mintIntentKey };

/** A purchase-result band painted into the store markup, so the state survives
 *  the markup-identity check that skips an unchanged repaint. */
interface CharterNotice {
  tone: 'success' | 'failure';
  text: string;
}

function remainingBanText(expiresAt: string, nowMs: number): string {
  const totalMinutes = Math.max(0, Math.ceil((Date.parse(expiresAt) - nowMs) / 60_000));
  const days = Math.floor(totalMinutes / 1_440);
  const hours = Math.floor((totalMinutes % 1_440) / 60);
  if (days > 0) {
    return t('hudChrome.dailyRewards.remainingDaysHours', {
      days: formatNumber(days, { maximumFractionDigits: 0 }),
      hours: formatNumber(hours, { maximumFractionDigits: 0 }),
    });
  }
  if (totalMinutes < 1) return t('hudChrome.dailyRewards.remainingLessThanMinute');
  const minutes = totalMinutes % 60;
  if (hours <= 0) {
    return t('hudChrome.dailyRewards.remainingMinutes', {
      minutes: formatNumber(minutes, { maximumFractionDigits: 0 }),
    });
  }
  return t('hudChrome.dailyRewards.remainingHoursMinutes', {
    hours: formatNumber(hours, { maximumFractionDigits: 0 }),
    minutes: formatNumber(minutes, { maximumFractionDigits: 0 }),
  });
}

export function dailyRewardReasonText(
  eligibility: DailyRewardStatus['eligibility'],
  nowMs = Date.now(),
): string {
  switch (eligibility.reason) {
    case 'eligible':
      return t('hudChrome.dailyRewards.reason.eligible');
    case 'no_wallet':
      return t('hudChrome.dailyRewards.reason.no_wallet');
    case 'under_minimum':
      return t('hudChrome.dailyRewards.reason.under_minimum');
    case 'price_unavailable':
      return t('hudChrome.dailyRewards.reason.price_unavailable');
    case 'banned':
      if (eligibility.banExpiresAt && Number.isFinite(Date.parse(eligibility.banExpiresAt))) {
        return t('hudChrome.dailyRewards.reason.bannedUntil', {
          reason: eligibility.banReason ?? t('hudChrome.dailyRewards.unknown'),
          remaining: remainingBanText(eligibility.banExpiresAt, nowMs),
          until: formatDateTime(new Date(eligibility.banExpiresAt), {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
          }),
        });
      }
      return t('hudChrome.dailyRewards.reason.banned', {
        reason: eligibility.banReason ?? t('hudChrome.dailyRewards.unknown'),
      });
  }
}

/** The authoritative outcome of one store spend, as the service answered it.
 *  Shared with the HUD's ClaudiumHooks so both ends of the wiring name one shape. */
// The canonical declaration moved to src/ui/claudium_purchase_bridge.ts, the
// module that owns the spend seam both spending windows share. Re-exported
// here so every existing importer keeps working unchanged.
export type { StoreSpendResult };

export interface DailyRewardsWindowDeps {
  root(): HTMLElement;
  world(): IWorld;
  closeOthers(): void;
  captureFocus(): HTMLElement | null;
  restoreFocus(target: HTMLElement | null): void;
  onVisibilityChange?(): void;
  /** Fired once per actual close (not when already closed). */
  onClose?(): void;
  onStatus?(status: DailyRewardStatus): void;
  onWalletConnect?(): void;
  storeEnabled?(): boolean;
  storeSnapshot?(): Promise<{
    available: boolean;
    balance: number | null;
    items: WocStoreItemInput[];
  }>;
  spendStoreItem?(
    itemId: string,
    kind: 'cosmetic' | 'skin' | 'item' | 'storage',
    expectedCostClaudium: number,
    /** ONE key per purchase INTENT, reused for every retry of that intent.
     *  Omitted by the weapon-skin path (a skin writes a grant row, so a fresh
     *  key per call still replays); REQUIRED by the repeatable charter path,
     *  where a fresh key on a retry is a SECOND REAL CHARGE. */
    idempotencyKey?: string,
  ): Promise<StoreSpendResult>;
  /** Open the Claudium window. `onClosed` is the top-up return path: fired at
   *  most once, when that window closes, so the store can come back. */
  openClaudium?(onClosed?: () => void): void;
}

export class DailyRewardsWindow {
  private openerFocus: HTMLElement | null = null;
  private poll: number | null = null;
  private countdownPoll: number | null = null;
  private renderSeq = 0;
  private lastHistory: DailyRewardHistory = { payouts: [] };
  // The spin celebration's element, owned by its own painter
  // (src/ui/daily_rewards_spin_controller.ts) beside the pure wheel core.
  private readonly spinOverlay = new SpinOverlay();
  private tab: 'store' | 'rewards' = 'store';
  private storeBalance: number | null = null;
  private storeItems: WocStoreItemInput[] = [];
  private armorySections: ArmorySection[] = [];
  private armoryInspect: ArmoryInspect | null = null;
  private armoryGraphicsRestoreSkinId: string | null = null;
  private storeLoading = false;
  private storeReady = false;
  private storeError = false;
  private storePriceChanged = false;
  private paintedStoreBody: HTMLElement | null = null;
  private paintedStoreMarkup: string | null = null;
  private charterSection = emptyCharterSection();
  private charterNotice: CharterNotice | null = null;
  private charterAnnounceSeq = 0;
  // ONE idempotency key per charter purchase INTENT, held across retries with
  // the cost it declared. A storage SKU is REPEATABLE and writes no grant row,
  // so the service dedupes only on this key: a retry under a fresh key, or under
  // the same key with a moved cost, is a second real charge.
  private readonly charterIntents: PurchaseIntentLedger = durableIntents(() => this.deps.world());
  // Charter ids whose open intent has actually reached the service. It gates
  // the cancel path: see abandonCharterIntent.
  private readonly charterSent = new Set<string>();
  // Charter ids with a spend in flight RIGHT NOW. It is money-safe to send a
  // second one (same key, the server answers purchase_in_progress), but the
  // player would be shown "another purchase is being completed" for their own
  // double-click, so the button goes disabled + aria-busy and both entry points
  // refuse while it is held.
  private readonly charterInFlight = new Set<string>();
  private readonly storeRuntime = new StoreSurfaceRuntime(() => this.deps.root());
  private readonly armoryPurchases = new StoreArmoryPurchase({
    balance: () => this.storeBalance,
    setBalance: (balance) => (this.storeBalance = balance),
    captureSurface: () => this.storeRuntime.captureSurface(),
    surfaceIsCurrent: (generation) => this.storeSurfaceIsCurrent(generation),
    spend: async (itemId, cost) => this.deps.spendStoreItem?.(itemId, 'skin', cost),
    showDecision: (options) => this.showStoreDecision(options),
    showNeedMore: (item, cost, balance, generation) =>
      this.openNeedMoreDialog(item, cost, balance, generation),
    showResult: (tone, text) => this.showStoreResult(tone, text),
    needMoreText: (item, cost, balance) => this.needMoreText(item, cost, balance),
    setPriceChanged: (changed) => (this.storePriceChanged = changed),
    setError: () => {
      this.storeError = true;
      this.paintArmoryState(false);
    },
    refreshStore: () => this.renderStore(null),
    rebuildAndPaint: () => this.paintArmoryState(true),
    rowById: (itemId) => this.armoryRowById(itemId),
    refreshInspector: (row) => this.armoryInspect?.refresh(row),
  });
  // The one-attempt focus stash; store_focus_policy.ts owns its lifetime rule.
  private readonly charterFocus = new StoreFocusStash();
  // What this store visit remembers about charter fit: the server's refusals and
  // the ladder count last painted against, plus the rule by which a count that
  // moves DOWN invalidates the refusals. src/ui/charter_fit_memory.ts owns all
  // three and says why they cannot live apart.
  private readonly charterFit = new CharterFitMemory();

  constructor(private readonly deps: DailyRewardsWindowDeps) {}

  /** Whether the window is currently shown; lets the opener distinguish the toggle direction. */
  get isOpen(): boolean {
    return this.deps.root().style.display === 'block';
  }

  openStore(): void {
    if (!this.storeEnabled()) return;
    if (!this.isOpen) {
      this.tab = 'store';
      this.toggle();
      return;
    }
    if (this.tab !== 'store') {
      this.invalidateStoreSurface();
      this.tab = 'store';
    }
    void this.renderCurrent('open');
  }

  /** Dispose the profile-bound Armory context; the next open rebuilds it lazily. */
  resetArmoryPreviewForGraphicsRebuild(): void {
    this.armoryGraphicsRestoreSkinId = this.armoryInspect?.openSkinId ?? null;
    this.armoryInspect?.destroy();
    this.armoryInspect = null;
  }

  /** Reopen an inspect overlay that was visible when its old profile context was reset. */
  restoreArmoryPreviewAfterGraphicsRebuild(): void {
    const skinId = this.armoryGraphicsRestoreSkinId;
    this.armoryGraphicsRestoreSkinId = null;
    if (!skinId || !this.isOpen) return;
    const row = this.armoryRowById(skinId);
    if (row) this.openArmoryInspect(row);
  }

  toggle(): void {
    if (this.isOpen) {
      this.close();
      return;
    }
    this.openerFocus = this.deps.captureFocus();
    this.deps.closeOthers();
    this.invalidateStoreSurface();
    const root = this.deps.root();
    if (!this.storeEnabled()) this.tab = 'rewards';
    root.style.display = 'block';
    this.deps.onVisibilityChange?.();
    this.ensureShell();
    void this.renderCurrent('open');
    // The service refresh is a paint the PLAYER DID NOT ASK FOR, so it carries
    // the background flag for the same reason the ladder refresh does: a poll
    // that lands between a purchase arming its focus stash and the outcome
    // spending it must not consume the stash, and must not pull focus out of
    // <body> into the grid mid-spend.
    this.poll = window.setInterval(() => {
      if (this.isOpen) void this.renderCurrent(null, { background: true });
    }, 15_000);
    this.countdownPoll = window.setInterval(() => {
      if (this.isOpen) this.paintCountdowns();
    }, 30_000);
  }

  close(): void {
    const root = this.deps.root();
    if (root.style.display !== 'block') {
      this.openerFocus = null;
      return;
    }
    if (this.poll !== null) {
      window.clearInterval(this.poll);
      this.poll = null;
    }
    if (this.countdownPoll !== null) {
      window.clearInterval(this.countdownPoll);
      this.countdownPoll = null;
    }
    this.invalidateStoreSurface();
    root.style.display = 'none';
    // A purchase-result band is about the attempt the player just made, not a
    // standing store state: a reopen must not show a stale one. The intent
    // ledger deliberately survives, so a retry still replays its key.
    this.charterNotice = null;
    // Server fit verdicts are scoped to the acting character and nothing here
    // observes a character change, so the belief is bounded to one store visit.
    this.charterFit.forgetRefusals();
    // Same bounding, one visit: a stash is about an attempt inside this visit.
    this.charterFocus.clear();
    this.spinOverlay.close();
    this.armoryInspect?.close();
    this.deps.restoreFocus(this.openerFocus);
    this.openerFocus = null;
    this.deps.onVisibilityChange?.();
    this.deps.onClose?.();
  }

  async render(focus: 'open' | null = null): Promise<void> {
    const root = this.deps.root();
    const seq = ++this.renderSeq;
    this.ensureShell();
    if (focus === 'open') (root.querySelector('[data-close]') as HTMLElement | null)?.focus();
    let status: DailyRewardStatus | null = null;
    let history: DailyRewardHistory = { payouts: [] };
    try {
      status = await this.deps.world().dailyRewards();
      if (status.enabled === false) {
        if (!this.isOpen || seq !== this.renderSeq) return;
        this.deps.onStatus?.(status);
        this.paint(buildDailyRewardsView({ kind: 'status', status, history }));
        return;
      }
      history = await this.deps.world().dailyRewardHistory();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'daily rewards unavailable';
      if (seq === this.renderSeq) this.paint(buildDailyRewardsView({ kind: 'error', message }));
      return;
    }
    if (!this.isOpen || seq !== this.renderSeq) return;
    this.lastHistory = history;
    this.deps.onStatus?.(status);
    this.paint(buildDailyRewardsView({ kind: 'status', status, history }));
    this.paintCountdowns();
  }

  private ensureShell(): void {
    const root = this.deps.root();
    const storeEnabled = this.storeEnabled();
    markDialogRoot(root, { labelledBy: 'daily-rewards-title' });
    if (root.querySelector('.woc-store-body') && root.dataset.storeEnabled === String(storeEnabled))
      return;
    if (!storeEnabled) this.tab = 'rewards';
    root.dataset.storeEnabled = String(storeEnabled);
    root.innerHTML =
      dailyRewardsTitleHtml(storeEnabled) +
      (storeEnabled ? wocStoreTabsHtml() : '') +
      dailyRewardsLoadingHtml(storeEnabled);
    root.querySelector('[data-close]')?.addEventListener('click', () => this.close());
    if (storeEnabled) this.wireTabs(root);
  }

  private wireTabs(root: HTMLElement): void {
    const tabs = Array.from(root.querySelectorAll<HTMLButtonElement>('[data-woc-store-tab]'));
    const select = (button: HTMLButtonElement, focus: boolean): void => {
      const tab = button.dataset.wocStoreTab;
      if (tab !== 'store' && tab !== 'rewards') return;
      if (tab !== this.tab) this.invalidateStoreSurface();
      this.tab = tab;
      this.syncTabs();
      if (focus) button.focus();
      void this.renderCurrent(null);
    };
    tabs.forEach((button, i) => {
      button.addEventListener('click', () => {
        select(button, false);
      });
      button.addEventListener('keydown', (event) => {
        const ke = event as KeyboardEvent;
        const next = rovingTarget(ke.key, i, tabs.length, 'horizontal');
        if (next !== null) {
          ke.preventDefault();
          const target = tabs[next];
          if (target) select(target, true);
          return;
        }
        if (ke.key === 'Enter' || ke.key === ' ') {
          ke.preventDefault();
          select(button, true);
        }
      });
    });
  }

  private async renderCurrent(
    focus: 'open' | null,
    opts: { background?: boolean } = {},
  ): Promise<void> {
    if (!this.storeEnabled()) this.tab = 'rewards';
    this.syncTabs();
    if (this.tab === 'store') {
      await this.renderStore(focus, opts);
      return;
    }
    await this.render(focus);
  }

  private syncTabs(): void {
    if (!this.storeEnabled()) {
      this.tab = 'rewards';
      this.deps.root().classList.remove('store-active');
      return;
    }
    this.deps.root().classList.toggle('store-active', this.tab === 'store');
    const panel = this.deps.root().querySelector<HTMLElement>('.woc-store-body');
    panel?.setAttribute(
      'aria-labelledby',
      this.tab === 'store' ? 'woc-store-tab-store' : 'woc-store-tab-rewards',
    );
    this.deps
      .root()
      .querySelectorAll<HTMLButtonElement>('[data-woc-store-tab]')
      .forEach((button) => {
        const selected = button.dataset.wocStoreTab === this.tab;
        button.classList.toggle('active', selected);
        button.setAttribute('aria-selected', selected ? 'true' : 'false');
        button.tabIndex = selected ? 0 : -1;
      });
  }

  private async renderStore(
    focus: 'open' | null,
    opts: { background?: boolean } = {},
  ): Promise<void> {
    const generation = this.storeRuntime.beginRequest();
    const root = this.deps.root();
    const body = root.querySelector<HTMLElement>('.dr-body');
    if (!body) return;
    if (focus === 'open')
      root.querySelector<HTMLButtonElement>('[data-woc-store-tab="store"]')?.focus();
    this.storeLoading = true;
    this.storeError = false;
    this.storeRuntime.setLoading(this.storeLoading);
    try {
      const snapshot = (await this.deps.storeSnapshot?.()) ?? {
        available: false,
        balance: null,
        items: [],
      };
      if (!this.storeRequestIsCurrent(generation)) return;
      if (!snapshot.available || snapshot.balance === null) {
        throw new Error('store snapshot unavailable');
      }
      this.storeBalance = snapshot.balance;
      this.storeItems = snapshot.items;
      this.rebuildArmorySections();
      this.storeReady = true;
    } catch {
      if (!this.storeRequestIsCurrent(generation)) return;
      this.storeError = !this.storeReady;
    } finally {
      // A stale request cannot clear the busy state owned by a newer request.
      if (this.storeRuntime.requestIsCurrent(generation, true)) {
        this.storeLoading = false;
        this.storeRuntime.setLoading(this.storeLoading);
      }
    }
    if (this.storeRequestIsCurrent(generation)) this.paintStore(body, opts);
  }

  private storeRequestIsCurrent(generation: number): boolean {
    return this.storeRuntime.requestIsCurrent(generation, this.isOpen && this.tab === 'store');
  }

  private storeSurfaceIsCurrent(generation: number): boolean {
    return this.storeRuntime.surfaceIsCurrent(generation, this.isOpen && this.tab === 'store');
  }

  /** Invalidate Store snapshot/spend and Rewards body writes together; prompt
   *  teardown also clears inert and runs the decision's cancel policy. */
  private invalidateStoreSurface(): void {
    this.renderSeq += 1;
    this.storeRuntime.invalidateSurface();
    this.storeLoading = false;
    this.storeRuntime.setLoading(this.storeLoading);
  }

  private showStoreDecision(options: Omit<StoreDecisionPromptOptions, 'closeText'>): boolean {
    return this.storeRuntime.openDecision(options);
  }

  private showStoreResult(tone: 'success' | 'failure', text: string): void {
    this.storeRuntime.showResult(tone, text);
  }

  /** Re-project the Season 1 Armory sections from the last service snapshot plus
   *  the live account cosmetics and equipped weapon (both change without a new
   *  fetch: purchases, applies, and gear swaps all reflect immediately). */
  private rebuildArmorySections(): void {
    const world = this.deps.world();
    const player = world.player;
    this.armorySections = buildArmorySections(this.storeBalance, this.storeItems, {
      cosmetics: world.accountCosmetics,
      cls: player.templateId,
      mainhandItemId: player.mainhandItemId,
      skinCatalog: player.skinCatalog,
    });
  }

  /** Live account-cosmetics change (another session's grant/apply, or a server
   *  correction of an optimistic apply): re-project the armory from the world's
   *  cosmetics and repaint the open store grid + inspect actions.
   *
   *  BACKGROUND for the same reason the slow-band poll is: the trigger is
   *  another session, not this player, so the repaint must not spend a focus
   *  stash a purchase here is still holding. The exposure is identical too (mid
   *  charter spend the confirm dialog is gone, focus is on <body>, and the stash
   *  is armed), so exempting only the poll would have left this door open. */
  onCosmeticsChanged(): void {
    if (!this.isOpen || this.tab !== 'store' || !this.storeReady) return;
    this.rebuildArmorySections();
    const body = this.deps.root().querySelector<HTMLElement>('.dr-body');
    if (body) this.paintStore(body, { background: true });
    const open = this.armoryInspect?.openSkinId;
    if (open) {
      const row = this.armoryRowById(open);
      if (row) this.armoryInspect?.refresh(row);
    }
  }

  private armoryRowById(skinId: string): ArmorySkinRow | null {
    for (const section of this.armorySections) {
      const row = section.rows.find((r) => r.skin.id === skinId);
      if (row) return row;
    }
    return null;
  }

  /** `background` marks a paint the PLAYER DID NOT ASK FOR (the slow-band poll).
   *  It changes nothing about the markup and only two things about focus, both
   *  below. */
  private paintStore(body: HTMLElement, opts: { background?: boolean } = {}): void {
    if (this.storeError || this.storeBalance === null) {
      this.paintStoreError(body, opts);
      return;
    }
    const balance = formatNumber(this.storeBalance, { maximumFractionDigits: 0 });
    const armory = this.armorySections.map((section) => armorySectionHtml(section)).join('');
    // Re-project the charters at PAINT time: unlike the armory they also depend
    // on live bank state, and every input has to reach the markup string below
    // or the identity check silently skips the repaint.
    this.rebuildCharterSection();
    const charters = charterSectionHtml(this.charterSection, this.charterInFlight);
    const notice = this.storePriceChanged
      ? `<div class="woc-store-notice" role="status">${esc(t('hudChrome.wocStore.priceChanged'))}</div>`
      : '';
    const markup =
      `<div class="woc-store-hero"><div><span>${esc(t('hudChrome.wocStore.armoryEyebrow'))}</span><h2>${esc(t('hudChrome.wocStore.armoryTitle'))}</h2><p>${esc(t('hudChrome.wocStore.armoryBody'))}</p></div>` +
      `<div class="woc-store-balance"><img src="/claudium/icons/claudium_coin_64.webp" alt=""><span>${esc(t('hudChrome.wocStore.balance'))}</span><strong>${balance}</strong><button type="button" data-buy-claudium${focusKeyAttr('topup')}>${esc(t('hudChrome.wocStore.buyClaudium'))}</button></div></div>` +
      notice +
      this.charterNoticeHtml() +
      armory +
      charters;
    // Carry keyboard focus across the wipe. replaceStoreBody assigns innerHTML,
    // which destroys the control the player is standing on, and this painter
    // fires on EVERY purchase outcome: without this a keyboard buyer who pressed
    // Enter on Purchase Charter lands on <body> and has to Tab from the top of
    // the window to retry. src/ui/store_focus_policy.ts owns the whole decision
    // (the stash, the background exemption, the degrade ladder) and says why.
    const plan = planStoreFocus({
      background: opts.background === true,
      focusInBody: captureFocusKey(body),
      focusWentNowhere: focusedWithin(document) === null,
      stashed: this.charterFocus.peek(),
    });
    // The stash is spent by a paint that HAPPENED: an elided paint destroyed no
    // control, so its target is still mounted and still the right return place.
    if (!this.replaceStoreBody(body, markup)) return;
    if (!opts.background) this.charterFocus.clear();
    // Dense armory compatibility chips defer their repeated portrait data URLs
    // so this markup stays kilobytes rather than megabytes. Hydration assigns
    // the already-cached nine class portraits by DOM property after mounting.
    hydratePortraits(body);
    body.querySelector<HTMLButtonElement>('[data-buy-claudium]')?.addEventListener('click', () => {
      this.openClaudiumFromStore();
    });
    body.querySelectorAll<HTMLButtonElement>('[data-armory-skin]').forEach((button) => {
      button.addEventListener('click', () => {
        const row = this.armoryRowById(button.dataset.armorySkin ?? '');
        if (row) this.openArmoryInspect(row);
      });
    });
    body.querySelectorAll<HTMLButtonElement>('[data-charter-buy]').forEach((button) => {
      button.addEventListener('click', () => {
        this.requestCharterPurchase(button.dataset.charterBuy ?? '');
      });
    });
    restoreStoreFocus(body, plan, body.querySelector<HTMLElement>('[data-buy-claudium]'));
  }

  private charterButton(itemId: string): HTMLButtonElement | null {
    const body = this.deps.root().querySelector<HTMLElement>('.dr-body');
    if (!body) return null;
    return (
      [...body.querySelectorAll<HTMLButtonElement>('[data-charter-buy]')].find(
        (button) => button.dataset.charterBuy === itemId,
      ) ?? null
    );
  }

  /** The ERROR body, which is a WIPE like any other and must carry focus like one.
   *
   *  It used to return above the whole focus contract, so a keyboard buyer whose
   *  store errored mid-visit landed on `<body>` and had to Tab from the top of the
   *  DOCUMENT, and an armed charter stash survived to be spent by some later
   *  unrelated repaint that then dragged focus and the scroller into the charter
   *  grid for no reason the player could see.
   *
   *  WHICH PATH TAKES SOMETHING FROM THE PLAYER, corrected in the review round,
   *  because a wrong answer here is what makes a focus fix inert. Only the
   *  armory-skin outage repaint sets `storeError` mid-visit (`storeReady` latches
   *  the fetch path and `storeBalance` never returns to null), and on that path
   *  the player stands in the armory INSPECT overlay, which mounts on
   *  document.body and survives this wipe: nothing is taken, so the plan
   *  correctly answers "focus nothing". The reachable harm is the OVERLAP, a
   *  charter purchase in flight whose busy disable already dropped focus to
   *  `<body>` and parked its return key in the stash.
   *
   *  Lives here rather than inline in paintStore because
   *  tests/woc_store_window_contract.test.ts pins paintStore's focus ORDER by the
   *  FIRST occurrence of three literals, and a second copy of them above the
   *  markup replace would read as the order being wrong. Same rules, own slice,
   *  own pin. */
  private paintStoreError(body: HTMLElement, opts: { background?: boolean }): void {
    const plan = planStoreFocus({
      background: opts.background === true,
      focusInBody: captureFocusKey(body),
      focusWentNowhere: focusedWithin(document) === null,
      stashed: this.charterFocus.peek(),
    });
    const wiped = this.replaceStoreBody(
      body,
      `<div class="dr-empty dr-error" role="alert">${esc(t('hudChrome.wocStore.error'))}</div>`,
    );
    // An ELIDED repaint destroyed no control, so its target is still mounted and
    // the stash is still the right return place: same rule as the normal path.
    if (!wiped) return;
    if (!opts.background) this.charterFocus.clear();
    restoreStoreErrorFocus(plan, this.deps.root());
  }

  /** Hold the buy button for the duration of the await. The concurrent spend a
   *  double-click would start is money-SAFE (same key, the server answers
   *  purchase_in_progress), but showing a buyer "another purchase is being
   *  completed" for their own second click is a bug in the copy's eyes. */
  private setCharterBusy(itemId: string, busy: boolean): void {
    const button = this.charterButton(itemId);
    if (!button) return;
    if (busy) {
      // No focus capture here: this runs inside the confirm dialog's onOk, by
      // which point the dialog element is gone and focus is already on <body>,
      // so the read would always be null. requestCharterPurchase stashes the key
      // while the buy button still holds focus, before the dialog opens.
      button.setAttribute('aria-busy', 'true');
      button.disabled = true;
      return;
    }
    button.removeAttribute('aria-busy');
    button.disabled = false;
  }

  /** Keep background polling data-fresh without rebuilding an identical store
   *  subtree. Replacing the covered window's DOM invalidates the overlapping
   *  Claudium compositor layer in some browsers and exposes the game canvas for
   *  a frame. A changed balance, catalog, ownership, equipment, or locale still
   *  produces different markup and repaints normally. */
  private replaceStoreBody(body: HTMLElement, markup: string): boolean {
    if (this.paintedStoreBody === body && this.paintedStoreMarkup === markup) return false;
    // The wipe resets scrollTop, and the charter grid is the LAST section, below
    // the whole armory: a forced repaint (every purchase outcome is one) would
    // otherwise throw the player back to the top of a long scroller, away from
    // the card they just used. Same idiom as the bank window's grid repaint.
    const scrollTop = body.scrollTop;
    body.innerHTML = markup;
    body.scrollTop = scrollTop;
    this.paintedStoreBody = body;
    this.paintedStoreMarkup = markup;
    return true;
  }

  private openArmoryInspect(row: ArmorySkinRow): void {
    this.ensureArmoryInspect().open(row);
  }

  private ensureArmoryInspect(): ArmoryInspect {
    if (!this.armoryInspect) {
      this.armoryInspect = new ArmoryInspect({
        appearance: () => {
          const player = this.deps.world().player;
          return {
            cls: player.templateId as PlayerClass,
            skin: player.skin,
            skinCatalog: player.skinCatalog,
            mainhandItemId: player.mainhandItemId,
          };
        },
        requestBuy: (target) => this.armoryPurchases.request(target),
        applySkin: (skinId) => {
          this.deps.world().changeWeaponSkin(skinId);
          this.afterArmoryChange(skinId);
        },
        detachSkin: (weaponType: WeaponSkinType) => {
          this.deps.world().changeWeaponSkin(null, weaponType);
          const open = this.armoryInspect?.openSkinId;
          if (open) this.afterArmoryChange(open);
        },
      });
    }
    return this.armoryInspect;
  }

  /** Re-project + repaint after an optimistic apply/detach or a grant, keeping
   *  the open inspect panel's actions in step with the store grid. */
  private afterArmoryChange(skinId: string): void {
    this.armoryPurchases.refreshAfterAppearanceChange(skinId);
  }

  private paintArmoryState(rebuild: boolean): void {
    if (rebuild) this.rebuildArmorySections();
    const body = this.deps.root().querySelector<HTMLElement>('.dr-body');
    if (body) this.paintStore(body);
  }

  /** Re-project the charter rows from the last service snapshot plus live bank
   *  state. */
  private rebuildCharterSection(): void {
    // The ALWAYS-available ladder read (src/world_api/bank.ts bankPurchasedSlots),
    // never bankInfo: that snapshot is null away from a bursar and the store opens
    // anywhere, which is the blindness this read exists to close. It stays
    // nullable (nothing has arrived yet), and the pure core reads null as "the fit
    // gate could not run" and lists every charter. The server remains the one
    // authority on fit and answers does_not_fit; this gate only decides what to
    // SHOW.
    const purchasedSlots = this.deps.world().bankPurchasedSlots;
    // Records the signature the slow-band poll compares against, and drops the
    // server's refusals if the count moved DOWN (charter_fit_memory.ts owns why).
    this.charterFit.observe(purchasedSlots);
    this.charterSection = buildCharterSection(this.storeBalance, this.storeItems, {
      purchasedSlots,
      ceilingSlots: CHARTER_CEILING_SLOTS,
      charters: STORE_CHARTERS,
      // Fit knowledge the SERVER already gave us, kept alongside the count gate
      // rather than replaced by it: a does_not_fit on grant G proves purchased +
      // G overshoots the ceiling for this character, and without it the refused
      // card comes straight back enabled forever. The verdict stays sound only
      // while the count it came from holds, which is the observe() above.
      refusedGrantSlots: this.charterFit.refusedGrants,
    });
  }

  /** The VISIBLE band. It carries no aria role on purpose: it is created inside
   *  the same innerHTML write as its own text, which is the shape that fails to
   *  announce. The persistent region in the shell does the announcing. */
  private charterNoticeHtml(): string {
    const notice = this.charterNotice;
    if (!notice) return '';
    return `<div class="woc-store-notice charter-notice ${notice.tone}">${esc(notice.text)}</div>`;
  }

  /** Set the result band AND announce it. One entry point so a future arm cannot
   *  paint a result that a screen reader never hears. */
  private setCharterNotice(tone: 'success' | 'failure', text: string): void {
    // A spend outcome can land after the player closed the store. close() has
    // already cleared the band, so re-arming it here would paint a stale result
    // on the NEXT open, attached to nothing the player just did.
    if (!this.isOpen) return;
    this.charterNotice = { tone, text };
    const live = this.deps.root().querySelector<HTMLElement>('[data-charter-live]');
    if (!live) return;
    // Clear first, then write in a microtask: an identical repeated message
    // (two failed retries) is otherwise a no-op mutation and is not re-announced.
    const seq = ++this.charterAnnounceSeq;
    live.textContent = '';
    queueMicrotask(() => {
      if (seq === this.charterAnnounceSeq) live.textContent = text;
    });
  }

  private charterRowById(itemId: string): CharterRow | null {
    return this.charterSection.rows.find((row) => row.itemId === itemId) ?? null;
  }

  private requestCharterPurchase(itemId: string): void {
    if (this.charterInFlight.has(itemId)) return;
    const row = this.charterRowById(itemId);
    if (!row?.purchasable || row.costClaudium === null) return;
    const name = charterName(itemId);
    // Mint the intent HERE, before the dialog, so the number the player confirms
    // is the number that will go on the wire. intentFor returns an already-open
    // intent unchanged, and its cost is FROZEN at mint time, so on a retry after
    // an ambiguous outcome the catalog price may have moved while the wire must
    // still carry the frozen one; quoting the row's refreshed price would show a
    // figure that cannot be the outcome of this click.
    const intent = this.charterIntents.intentFor(itemId, row.costClaudium);
    // AND THE AFFORDABILITY GATE READS THE SAME NUMBER, which is why the mint
    // moved above it (Bank Storage phase 17). `row.affordable` is computed from
    // the LIVE catalog price, and after a restore that is not what the wire
    // carries: with an intent frozen at 200, a catalog since moved to 250 and a
    // balance of 220, the old order told the player they needed more Claudium
    // and handed them to the top-up window for a purchase they could already
    // afford. Asking a player to spend real money they do not need to spend is
    // not the recorded cost of durability, which is one extra click and a
    // price_changed notice. One number, one place it comes from, which is the
    // rule the spend call site already states.
    //
    // The reorder mints on a first UNAFFORDABLE click, where nothing was minted
    // before. That is the already-argued "the save rides the mint" residual
    // (src/ui/purchase_intent_durability.ts): a never-sent key has no prior row
    // anywhere, so re-using it is an ordinary fresh attempt. It also makes the
    // top-up round trip carry ONE key instead of minting a fresh one per
    // attempt, which is the safer direction on a repeatable SKU.
    //
    // BOTH costs, not just the frozen one, and the review round is why. Judging
    // the frozen cost ALONE fixes the upward move and breaks the downward one:
    // frozen 250, catalog since retuned DOWN to 200, balance 220, and the player
    // is sent to buy real money for a product their balance already covers. The
    // honest rule is that a local refusal is only correct when the purchase is
    // unreachable BY EITHER ROUTE. The frozen cost goes out directly; the live
    // one is reachable in one round trip, because a frozen cost the catalog has
    // moved past comes back as a definitive price_changed that mints afresh at
    // the new price. So refuse only below the LOWER of the two, and quote that
    // one, which is the least real money the player would have to add.
    const reachableCost = Math.min(row.costClaudium, intent.costClaudium);
    if ((this.storeBalance ?? 0) < reachableCost) {
      this.openNeedMoreDialog(name, reachableCost, this.storeBalance);
      return;
    }
    // The buy button is still focused right now. The confirm dialog's own trap
    // restores focus on a DEFERRED task, so by the time onOk runs the dialog is
    // already removed and document.activeElement is <body>: capturing there
    // always yields null and the post-result repaint has nothing to hand focus
    // back to. This is the last moment the key is observable.
    const body = this.deps.root().querySelector<HTMLElement>('.dr-body');
    this.charterFocus.arm(body ? captureFocusKey(body) : null);
    const surfaceGeneration = this.storeRuntime.captureSurface();
    const opened = this.showStoreDecision({
      title: t('hudChrome.wocStore.charter.confirmTitle'),
      body: t('hudChrome.wocStore.charter.confirmBody', {
        item: name,
        cost: formatNumber(intent.costClaudium, { maximumFractionDigits: 0 }),
      }),
      confirmText: t('hudChrome.wocStore.confirmPurchase'),
      cancelText: t('hudChrome.wocStore.cancel'),
      onConfirm: () => void this.purchaseCharter(itemId, surfaceGeneration),
      onCancel: () => this.abandonCharterIntent(itemId),
    });
    if (!opened) this.abandonCharterIntent(itemId);
  }

  /** Drop an intent the player left, or whose prompt never opened, but ONLY
   *  before it reaches the service. Once a spend HAS been sent under the key, an ambiguous
   *  outcome may be hiding a live debit, so the key must outlive the cancel: the
   *  next attempt replays under it instead of minting a second key over that
   *  debit. Minting at confirm time is what gives this method something to drop:
   *  while the mint happened at SEND time, charterSent was added on the very
   *  next line, so an open intent always implied a sent one and this guard could
   *  never pass with anything to abandon. */
  private abandonCharterIntent(itemId: string): void {
    // The attempt ended with no paint, so nothing will spend the stash: drop it
    // here or some later unrelated repaint does, and moves focus for no reason.
    this.charterFocus.clear();
    if (this.charterSent.has(itemId)) return;
    this.charterIntents.abandon(itemId);
  }

  private async purchaseCharter(
    itemId: string,
    surfaceGeneration = this.storeRuntime.captureSurface(),
  ): Promise<void> {
    // ONE intent per purchase, minted and cost-FROZEN by requestCharterPurchase
    // before the confirm dialog opened. The FROZEN cost is what goes on the
    // wire, never a re-read catalog price. The server's prior-row identity check
    // includes expectedCostClaudium and answers a mismatch with a
    // definitive-looking already_granted WITHOUT first testing the row's status,
    // so a retry carrying a price the background refresh moved would close this
    // intent while the original row may still be PENDING behind a live debit,
    // and the next click would mint a second key over it. A genuine catalog move
    // instead comes back as a real price_changed (definitive, no debit) and
    // mints a fresh intent at the new price.
    if (this.charterInFlight.has(itemId)) return;
    const row = this.charterRowById(itemId);
    const intent = this.charterIntents.intentFor(itemId, row?.costClaudium ?? 0);
    const staleNotice = (message: string) => charterOffSurfaceNotice(itemId, message);
    // Only NOW has the key reached the service, so only now must a cancel stop
    // dropping it.
    this.charterSent.add(itemId);
    this.charterNotice = null;
    this.storePriceChanged = false;
    this.charterInFlight.add(itemId);
    this.setCharterBusy(itemId, true);
    let result: StoreSpendResult | undefined;
    try {
      result = await this.deps.spendStoreItem?.(itemId, 'storage', intent.costClaudium, intent.key);
    } catch {
      // A rejected transport is the same ambiguous outcome as a missing hook:
      // the durable intent stays open and the next attempt replays its key.
      result = undefined;
    } finally {
      // Released before anything repaints, so the rebuilt button comes back
      // enabled rather than inheriting a stale busy state from the markup.
      this.charterInFlight.delete(itemId);
      this.setCharterBusy(itemId, false);
    }
    if (!result) {
      // No hook at all is indistinguishable from a lost reply: leave the intent
      // OPEN so the next attempt replays under the same key.
      if (this.storeSurfaceIsCurrent(surfaceGeneration)) {
        this.setCharterNotice('failure', t('hudChrome.wocStore.charter.outage'));
        this.repaintStore();
      } else {
        this.showStoreResult('failure', staleNotice(t('hudChrome.wocStore.charter.outageStale')));
      }
      return;
    }
    // EVERY authoritative result goes to the ledger unclassified: which refusals
    // close an intent and which retain the key is store_purchase_intent.ts's
    // decision alone. Special-casing a token here would be a second classifier
    // that silently drifts from it (purchase_in_progress and no_live_character
    // both LOOK definitive and are not).
    this.charterIntents.settle(itemId, { granted: result.granted, reason: result.reason });
    if (!this.charterIntents.isOpen(itemId)) this.charterSent.delete(itemId);
    const surfaceCurrent = this.storeSurfaceIsCurrent(surfaceGeneration);
    if (surfaceCurrent && result.balance !== null) this.storeBalance = result.balance;
    // granted FIRST, then reason: 'already_granted' means OPPOSITE things on the
    // two arms, and every granted-true arm is a real purchase.
    if (result.granted) {
      const text = charterGrantedText(result.reason);
      if (surfaceCurrent) {
        this.setCharterNotice('success', text);
        await this.renderStore(null);
      } else {
        this.showStoreResult('success', staleNotice(text));
      }
      return;
    }
    await this.refuseCharterPurchase(itemId, intent.costClaudium, result, surfaceGeneration);
  }

  /** The granted-false half of the result contract. No debit happened on any of
   *  these except the ambiguous default, which the ledger has already kept the
   *  key for. */
  private async refuseCharterPurchase(
    itemId: string,
    /** The cost actually SENT (the intent's frozen one), which is what the
     *  service judged and therefore what a refreshed price must be compared
     *  against. */
    sentCostClaudium: number,
    result: StoreSpendResult,
    surfaceGeneration = this.storeRuntime.captureSurface(),
  ): Promise<void> {
    if (!this.storeSurfaceIsCurrent(surfaceGeneration)) {
      const staleNotice = (message: string) => charterOffSurfaceNotice(itemId, message);
      if (result.reason === 'insufficient_balance') {
        const authoritativeCost =
          result.costClaudium !== null &&
          Number.isFinite(result.costClaudium) &&
          result.costClaudium > 0
            ? result.costClaudium
            : sentCostClaudium;
        const message = this.needMoreText(charterName(itemId), authoritativeCost, result.balance);
        this.showStoreResult('failure', staleNotice(message));
      } else {
        const message =
          result.reason === 'price_changed'
            ? t('hudChrome.wocStore.priceChanged')
            : charterRefusalText(result.reason, 'stale');
        this.showStoreResult('failure', staleNotice(message));
      }
      return;
    }
    if (result.reason === 'price_changed') {
      // A new price is a NEW intent. price_changed is a definitive refusal, so
      // the ledger already closed this one and the re-confirm mints a fresh key.
      this.storePriceChanged = true;
      // The shared banner alone is not enough: it is written into the same
      // innerHTML as its own text, the shape this file already documents as the
      // one that never announces, so a screen-reader user whose purchase was
      // refused would hear nothing at all. Route it through the charter band,
      // which owns the persistent live region.
      this.setCharterNotice('failure', t('hudChrome.wocStore.priceChanged'));
      await this.renderStore(null);
      const current = this.charterRowById(itemId);
      // The false arm is load-bearing: re-confirming when the refreshed price
      // still equals the one just refused would loop the dialog forever.
      if (current && current.costClaudium !== null && current.costClaudium !== sentCostClaudium) {
        this.requestCharterPurchase(itemId);
      }
      return;
    }
    if (result.reason === 'does_not_fit') {
      // Remember the verdict: away from a banker the fit gate cannot run, so
      // without this the same guaranteed-to-fail card repaints enabled and the
      // player can loop the identical refusal forever.
      this.charterFit.noteRefused(this.charterRowById(itemId)?.grantSlots ?? 0);
    }
    if (result.reason === 'insufficient_balance') {
      // Prefer the service's own cost over the row's, exactly as the skin path does.
      const authoritativeCost =
        result.costClaudium !== null &&
        Number.isFinite(result.costClaudium) &&
        result.costClaudium > 0
          ? result.costClaudium
          : sentCostClaudium;
      this.repaintStore();
      this.openNeedMoreDialog(
        charterName(itemId),
        authoritativeCost,
        result.balance,
        surfaceGeneration,
      );
      return;
    }
    this.setCharterNotice('failure', charterRefusalText(result.reason));
    this.repaintStore();
  }

  /** Slow-band poll from hud.update(), the band the bank, bags and market windows
   *  already ride. The charter fit is re-projected at PAINT time and paints are
   *  event-driven (open, store fetch, cosmetics, purchase outcome), so nothing
   *  otherwise observes the ladder moving BEHIND an open store: the reachable case
   *  is the store and the bank open together at a bursar while a copper rung is
   *  bought in the bank (ruling 21). Signature-gated rather than repainting every
   *  tick, because a repaint rebuilds the whole armory grid's markup. */
  refreshIfChanged(): void {
    if (!this.isOpen || this.tab !== 'store' || !this.storeReady) return;
    // An error body carries no charter grid, and paintStore returns on that
    // branch BEFORE rebuildCharterSection, the only writer of the signature, so
    // without this the signature could never converge and the poll would rebuild
    // the error markup every slow tick until a refetch cleared the flag.
    // paintStore's branch also covers a null balance; storeReady above already
    // implies a non-null one, so repeating it here would add an unreachable arm.
    if (this.storeError) return;
    if (!this.charterFit.changedFrom(this.deps.world().bankPurchasedSlots)) return;
    // Deliberately NOT through repaintStore(): that path DROPS a stashed focus
    // key when it finds nothing to paint, which is right after a purchase
    // outcome and wrong here, where it would throw away the return target of a
    // purchase the player is still in the middle of. The `background` flag is
    // the other half of the same rule, and covers the paint that DOES happen.
    const body = this.deps.root().querySelector<HTMLElement>('.dr-body');
    if (body) this.paintStore(body, { background: true });
  }

  /** Repaint the open store body in place, with no service round trip. */
  private repaintStore(): void {
    const body = this.deps.root().querySelector<HTMLElement>('.dr-body');
    if (body && this.isOpen && this.tab === 'store') {
      this.paintStore(body);
      return;
    }
    // Nothing painted, so nothing consumed the stash: drop it (same rule as the
    // cancel and the close, and store_focus_policy.ts states it once).
    this.charterFocus.clear();
  }

  private openNeedMoreDialog(
    itemName: string,
    costClaudium: number,
    balance: number | null,
    surfaceGeneration = this.storeRuntime.captureSurface(),
  ): void {
    this.storeRuntime.openTopUp({
      itemName,
      cost: costClaudium,
      balance,
      fallbackBalance: this.storeBalance,
      generation: surfaceGeneration,
      visible: this.isOpen && this.tab === 'store',
      onConfirm: () => this.openClaudiumFromStore(),
      showDecision: (options) => this.showStoreDecision(options),
    });
  }

  private needMoreText(itemName: string, costClaudium: number, balance: number | null): string {
    return this.storeRuntime.needMoreText(itemName, costClaudium, balance, this.storeBalance);
  }

  private openClaudiumFromStore(): void {
    this.armoryInspect?.close();
    // The one return path out of the top-up handoff: the Claudium window fires
    // this exactly once, when it closes, and the store comes back on its Store
    // tab with a refreshed balance. No module global, and no timer guessing
    // when the player is done.
    this.deps.openClaudium?.(() => this.openStore());
  }

  private paint(view: DailyRewardsView): void {
    const body = this.deps.root().querySelector<HTMLElement>('.dr-body');
    if (!body) return;
    // The same body hosts both tabs. Mark it as non-store content so returning
    // to the Store tab always restores its markup even when its model is unchanged.
    this.paintedStoreBody = null;
    if (view.kind === 'loading') {
      body.innerHTML = `<div class="dr-empty" role="status">${esc(t('hudChrome.dailyRewards.loading'))}</div>`;
      return;
    }
    if (view.kind === 'error') {
      body.innerHTML = `<div class="dr-empty dr-error" role="alert">${esc(t('hudChrome.dailyRewards.error'))}</div>`;
      return;
    }
    if (view.kind === 'disabled') {
      body.innerHTML = `<div class="dr-empty" role="status">${esc(t('hudChrome.dailyRewards.disabled'))}</div>`;
      return;
    }
    body.innerHTML =
      this.summaryHtml(view) +
      dailyRewardsWalletCardHtml(view) +
      spinSectionHtml(view) +
      this.tasksHtml(view) +
      dailyRewardsLeaderboardHtml(view.status) +
      dailyRewardsHistoryHtml(view.history);
    body.querySelector<HTMLButtonElement>('[data-spin]')?.addEventListener('click', () => {
      void this.spin();
    });
    body
      .querySelector<HTMLButtonElement>('[data-wallet-connect]')
      ?.addEventListener('click', () => {
        this.deps.onWalletConnect?.();
      });
  }

  private async spin(): Promise<void> {
    const body = this.deps.root().querySelector<HTMLElement>('.dr-body');
    const button = body?.querySelector<HTMLButtonElement>('[data-spin]');
    if (button) button.disabled = true;
    try {
      const result = await this.deps.world().spinDailyReward();
      this.spinOverlay.open(result.awardedPoints);
      this.deps.onStatus?.(result);
      this.paint(
        buildDailyRewardsView({ kind: 'status', status: result, history: this.lastHistory }),
      );
    } catch {
      await this.render(null);
      return;
    }
  }

  private storeEnabled(): boolean {
    return this.deps.storeEnabled?.() ?? this.deps.storeSnapshot !== undefined;
  }

  private summaryHtml(view: Extract<DailyRewardsView, { kind: 'ready' }>): string {
    const s = view.status;
    const prize =
      s.prizePoolSol === null
        ? t('hudChrome.dailyRewards.unknown')
        : `${t('hudChrome.dailyRewards.sol', {
            amount: formatNumber(s.prizePoolSol, { maximumFractionDigits: 3 }),
          })} (${t('hudChrome.dailyRewards.usd', {
            amount: usdDollarsText(s.prizePoolUsd),
          })})`;
    const reset = formatDateTime(new Date(s.resetAt), { hour: 'numeric', minute: '2-digit' });
    const remaining = this.remainingText(s.resetAt);
    const value =
      s.eligibility.usdValue === null
        ? t('hudChrome.dailyRewards.unknown')
        : t('hudChrome.dailyRewards.usd', {
            amount: usdDollarsText(s.eligibility.usdValue),
          });
    const reason = dailyRewardReasonText(s.eligibility);
    return (
      `<p class="dr-intro">${esc(t('hudChrome.dailyRewards.intro'))}</p>` +
      `<p class="dr-disclaimer">${esc(t('hudChrome.dailyRewards.disclaimer'))}</p>` +
      `<div class="dr-summary">` +
      `<div><span>${esc(t('hudChrome.dailyRewards.prize'))}</span><strong>${esc(prize)}</strong></div>` +
      `<div><span>${esc(t('hudChrome.dailyRewards.reset'))}</span><strong>${esc(reset)}</strong></div>` +
      `<div class="dr-countdown"><span data-daily-rewards-countdown="${esc(s.resetAt)}">${esc(t('hudChrome.dailyRewards.endsIn', { time: remaining }))}</span></div>` +
      `<div><span>${esc(t('hudChrome.dailyRewards.score'))}</span><strong>${formatNumber(s.score, { maximumFractionDigits: 0 })}</strong></div>` +
      `<div><span>${esc(t('hudChrome.dailyRewards.walletValue'))}</span><strong>${esc(value)}</strong></div>` +
      `<p class="${view.locked ? 'dr-lock' : 'dr-ok'}">${esc(reason)}</p>` +
      `</div>`
    );
  }

  private remainingText(resetAt: string): string {
    const ms = Date.parse(resetAt) - Date.now();
    const totalMinutes = Math.max(0, Math.ceil(ms / 60_000));
    if (totalMinutes < 1) return t('hudChrome.dailyRewards.remainingLessThanMinute');
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (hours <= 0) {
      return t('hudChrome.dailyRewards.remainingMinutes', {
        minutes: formatNumber(minutes, { maximumFractionDigits: 0 }),
      });
    }
    return t('hudChrome.dailyRewards.remainingHoursMinutes', {
      hours: formatNumber(hours, { maximumFractionDigits: 0 }),
      minutes: formatNumber(minutes, { maximumFractionDigits: 0 }),
    });
  }

  private paintCountdowns(): void {
    const root = this.deps.root();
    root.querySelectorAll<HTMLElement>('[data-daily-rewards-countdown]').forEach((el) => {
      const resetAt = el.dataset.dailyRewardsCountdown;
      if (!resetAt) return;
      el.textContent = t('hudChrome.dailyRewards.endsIn', { time: this.remainingText(resetAt) });
    });
  }

  private tasksHtml(view: Extract<DailyRewardsView, { kind: 'ready' }>): string {
    const rows = view.status.tasks
      .map((task) => {
        const multiplier =
          typeof task.multiplier === 'number' && Number.isFinite(task.multiplier)
            ? `<em>${esc(t('hudChrome.dailyRewards.taskMultiplier', { multiplier: formatNumber(task.multiplier, { maximumFractionDigits: 2 }) }))}</em>`
            : '';
        const description = dailyRewardTaskDescription(
          task.type,
          task.description,
          t('hudChrome.dailyRewards.oneVsOneExcluded'),
        );
        return `<li class="${task.completed ? 'done' : ''}"><span>${esc(task.title)}</span><small><span>${esc(description)}</span>${multiplier}</small><b>${formatNumber(task.points, { maximumFractionDigits: 0 })}</b></li>`;
      })
      .join('');
    return (
      `<section class="dr-section"><h3>${esc(t('hudChrome.dailyRewards.tasks'))}</h3>` +
      `<ul class="dr-tasks">${rows}</ul>` +
      `</section>`
    );
  }
}
