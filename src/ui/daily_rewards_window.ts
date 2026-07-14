import type { PlayerClass, WeaponSkinType } from '../sim/types';
import type { DailyRewardHistory, DailyRewardStatus, IWorld } from '../world_api';
import { ArmoryInspect } from './armory_inspect';
import {
  badgeLabel,
  localizeWeaponSkin,
  rarityLabel,
  weaponSkinCollectionLabel,
  weaponTypeLabel,
} from './armory_labels';
import { buildDailyRewardsView, type DailyRewardsView } from './daily_rewards_view';
import { markDialogRoot } from './dialog_root';
import { tEntity } from './entity_i18n';
import { esc } from './esc';
import { formatDateTime, formatNumber, t } from './i18n';
import { portraitChipHtml } from './portrait_chip';
import { rovingTarget } from './roving_index';
import { svgIcon } from './ui_icons';
import {
  type ArmorySection,
  type ArmorySkinRow,
  buildArmorySections,
  type WocStoreItemInput,
} from './woc_store_view';

function reasonText(eligibility: DailyRewardStatus['eligibility']): string {
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
      return t('hudChrome.dailyRewards.reason.banned', {
        reason: eligibility.banReason ?? t('hudChrome.dailyRewards.unknown'),
      });
  }
}

export interface DailyRewardsWindowDeps {
  root(): HTMLElement;
  world(): IWorld;
  closeOthers(): void;
  captureFocus(): HTMLElement | null;
  restoreFocus(target: HTMLElement | null): void;
  onVisibilityChange?(): void;
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
    kind: 'cosmetic' | 'skin' | 'item',
    expectedCostClaudium: number,
  ): Promise<{
    granted: boolean;
    balance: number | null;
    costClaudium: number | null;
    reason: string | null;
  }>;
  openClaudium?(): void;
  confirmDialog?(
    title: string,
    body: string,
    okText: string,
    cancelText: string,
    onOk: () => void,
  ): void;
}

export class DailyRewardsWindow {
  private openerFocus: HTMLElement | null = null;
  private poll: number | null = null;
  private countdownPoll: number | null = null;
  private renderSeq = 0;
  private lastHistory: DailyRewardHistory = { payouts: [] };
  private spinOverlay: HTMLElement | null = null;
  private tab: 'store' | 'rewards' = 'store';
  private storeBalance: number | null = null;
  private storeItems: WocStoreItemInput[] = [];
  private armorySections: ArmorySection[] = [];
  private armoryInspect: ArmoryInspect | null = null;
  private storeLoading = false;
  private storeReady = false;
  private storeError = false;
  private storePriceChanged = false;
  private paintedStoreBody: HTMLElement | null = null;
  private paintedStoreMarkup: string | null = null;

  private readonly wheelValues = [20, 30, 40, 50, 75, 100, 150, 250];

  constructor(private readonly deps: DailyRewardsWindowDeps) {}

  get isOpen(): boolean {
    return this.deps.root().style.display === 'block';
  }

  openStore(): void {
    if (!this.storeEnabled()) return;
    this.tab = 'store';
    if (!this.isOpen) {
      this.toggle();
      return;
    }
    void this.renderCurrent('open');
  }

  toggle(): void {
    if (this.isOpen) {
      this.close();
      return;
    }
    this.openerFocus = this.deps.captureFocus();
    this.deps.closeOthers();
    const root = this.deps.root();
    if (!this.storeEnabled()) this.tab = 'rewards';
    root.style.display = 'block';
    this.deps.onVisibilityChange?.();
    this.ensureShell();
    void this.renderCurrent('open');
    this.poll = window.setInterval(() => {
      if (this.isOpen) void this.renderCurrent(null);
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
    root.style.display = 'none';
    this.closeSpinOverlay();
    this.armoryInspect?.close();
    this.deps.restoreFocus(this.openerFocus);
    this.openerFocus = null;
    this.deps.onVisibilityChange?.();
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
      this.titleHtml(storeEnabled) +
      (storeEnabled ? this.tabsHtml() : '') +
      this.loadingHtml(storeEnabled);
    root.querySelector('[data-close]')?.addEventListener('click', () => this.close());
    if (storeEnabled) this.wireTabs(root);
  }

  private wireTabs(root: HTMLElement): void {
    const tabs = Array.from(root.querySelectorAll<HTMLButtonElement>('[data-woc-store-tab]'));
    const select = (button: HTMLButtonElement, focus: boolean): void => {
      const tab = button.dataset.wocStoreTab;
      if (tab !== 'store' && tab !== 'rewards') return;
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

  private async renderCurrent(focus: 'open' | null): Promise<void> {
    if (!this.storeEnabled()) this.tab = 'rewards';
    this.syncTabs();
    if (this.tab === 'store') {
      await this.renderStore(focus);
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

  private async renderStore(focus: 'open' | null): Promise<void> {
    const root = this.deps.root();
    const body = root.querySelector<HTMLElement>('.dr-body');
    if (!body) return;
    if (focus === 'open')
      root.querySelector<HTMLButtonElement>('[data-woc-store-tab="store"]')?.focus();
    this.storeLoading = true;
    this.storeError = false;
    this.syncStoreLoading();
    try {
      const snapshot = (await this.deps.storeSnapshot?.()) ?? {
        available: false,
        balance: null,
        items: [],
      };
      if (!this.isOpen || this.tab !== 'store') return;
      if (!snapshot.available || snapshot.balance === null) {
        throw new Error('store snapshot unavailable');
      }
      this.storeBalance = snapshot.balance;
      this.storeItems = snapshot.items;
      this.rebuildArmorySections();
      this.storeReady = true;
    } catch {
      this.storeError = !this.storeReady;
    } finally {
      this.storeLoading = false;
      this.syncStoreLoading();
    }
    if (this.isOpen && this.tab === 'store') this.paintStore(body);
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
    });
  }

  /** Live account-cosmetics change (another session's grant/apply, or a server
   *  correction of an optimistic apply): re-project the armory from the world's
   *  cosmetics and repaint the open store grid + inspect actions. */
  onCosmeticsChanged(): void {
    if (!this.isOpen || this.tab !== 'store' || !this.storeReady) return;
    this.rebuildArmorySections();
    const body = this.deps.root().querySelector<HTMLElement>('.dr-body');
    if (body) this.paintStore(body);
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

  private paintStore(body: HTMLElement): void {
    if (this.storeError || this.storeBalance === null) {
      this.replaceStoreBody(
        body,
        `<div class="dr-empty dr-error" role="alert">${esc(t('hudChrome.wocStore.error'))}</div>`,
      );
      return;
    }
    const balance = formatNumber(this.storeBalance, { maximumFractionDigits: 0 });
    const armory = this.armorySections.map((section) => this.armorySectionHtml(section)).join('');
    const notice = this.storePriceChanged
      ? `<div class="woc-store-notice" role="status">${esc(t('hudChrome.wocStore.priceChanged'))}</div>`
      : '';
    const markup =
      `<div class="woc-store-hero"><div><span>${esc(t('hudChrome.wocStore.armoryEyebrow'))}</span><h2>${esc(t('hudChrome.wocStore.armoryTitle'))}</h2><p>${esc(t('hudChrome.wocStore.armoryBody'))}</p></div>` +
      `<div class="woc-store-balance"><img src="/claudium/icons/claudium_coin_64.webp" alt=""><span>${esc(t('hudChrome.wocStore.balance'))}</span><strong>${balance}</strong><button type="button" data-buy-claudium>${esc(t('hudChrome.wocStore.buyClaudium'))}</button></div></div>` +
      notice +
      armory;
    if (!this.replaceStoreBody(body, markup)) return;
    body.querySelector<HTMLButtonElement>('[data-buy-claudium]')?.addEventListener('click', () => {
      this.openClaudiumFromStore();
    });
    body.querySelectorAll<HTMLButtonElement>('[data-armory-skin]').forEach((button) => {
      button.addEventListener('click', () => {
        const row = this.armoryRowById(button.dataset.armorySkin ?? '');
        if (row) this.openArmoryInspect(row);
      });
    });
  }

  /** Keep background polling data-fresh without rebuilding an identical store
   *  subtree. Replacing the covered window's DOM invalidates the overlapping
   *  Claudium compositor layer in some browsers and exposes the game canvas for
   *  a frame. A changed balance, catalog, ownership, equipment, or locale still
   *  produces different markup and repaints normally. */
  private replaceStoreBody(body: HTMLElement, markup: string): boolean {
    if (this.paintedStoreBody === body && this.paintedStoreMarkup === markup) return false;
    body.innerHTML = markup;
    this.paintedStoreBody = body;
    this.paintedStoreMarkup = markup;
    return true;
  }

  private armorySectionHtml(section: ArmorySection): string {
    const servicePrice =
      section.rows.find((row) => row.costClaudium !== null)?.costClaudium ?? null;
    const price =
      servicePrice === null
        ? `<span class="armory-section-price unavailable">${esc(t('hudChrome.wocStore.unavailable'))}</span>`
        : `<span class="armory-section-price"><img src="/claudium/icons/claudium_coin_64.webp" alt="">${formatNumber(servicePrice, { maximumFractionDigits: 0 })}</span>`;
    const cards = section.rows.map((row) => this.armoryCardHtml(row)).join('');
    return (
      `<section class="armory-section rarity-${esc(section.rarity)}">` +
      `<header><div><span>${esc(rarityLabel(section.rarity))}</span><h3>${esc(t('hudChrome.wocStore.collectionLine', { collection: weaponSkinCollectionLabel(section.collection) }))}</h3></div>` +
      `${price}</header>` +
      `<div class="armory-grid">${cards}</div></section>`
    );
  }

  private armoryCardHtml(row: ArmorySkinRow): string {
    const copy = localizeWeaponSkin(row.skin);
    const state = row.applied
      ? `<span class="armory-state applied">${esc(t('hudChrome.wocStore.applied'))}</span>`
      : row.owned
        ? `<span class="armory-state">${esc(t('hudChrome.wocStore.owned'))}</span>`
        : row.costClaudium === null
          ? `<span class="armory-state unavailable">${esc(t('hudChrome.wocStore.unavailable'))}</span>`
          : `<span class="armory-cost"><img src="/claudium/icons/claudium_coin_64.webp" alt=""><strong>${formatNumber(row.costClaudium, { maximumFractionDigits: 0 })}</strong></span>`;
    const badge = row.skin.badge
      ? `<span class="armory-badge">${esc(badgeLabel(row.skin.badge))}</span>`
      : '';
    return (
      `<article class="armory-card rarity-${esc(row.skin.rarity)}${row.owned ? ' owned' : ''}${row.applied ? ' applied' : ''}">` +
      `<button type="button" data-armory-skin="${esc(row.skin.id)}" aria-label="${esc(t('hudChrome.wocStore.inspectAria', { item: copy.name }))}">` +
      `<span class="armory-card-art"><img src="${esc(row.art)}" alt="" loading="lazy">${badge}${this.armoryClassChipsHtml(row)}</span>` +
      `<span class="armory-card-copy"><span class="armory-card-type">${esc(weaponTypeLabel(row.skin.weaponType))}</span>` +
      `<h4>${esc(copy.name)}</h4>${state}</span>` +
      `</button></article>`
    );
  }

  /** Top-right face chips: the classes that can ever apply this skin. Class
   *  names come from the entity matcher (already localized in every locale).
   *  The shared portrait chip shows the class crest while the character GLBs
   *  are still preloading and upgrades itself via the global ready hook. */
  private armoryClassChipsHtml(row: ArmorySkinRow): string {
    const chips = row.eligibleClasses
      .map((cls) => {
        const name = tEntity({ kind: 'class', id: cls, field: 'name' });
        return `<span class="armory-class-chip" title="${esc(name)}">${portraitChipHtml({ cls, name, badge: false })}</span>`;
      })
      .join('');
    return chips ? `<span class="armory-classes">${chips}</span>` : '';
  }

  private openArmoryInspect(row: ArmorySkinRow): void {
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
        requestBuy: (target) => this.requestArmoryPurchase(target),
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
    this.armoryInspect.open(row);
  }

  /** Re-project + repaint after an optimistic apply/detach or a grant, keeping
   *  the open inspect panel's actions in step with the store grid. */
  private afterArmoryChange(skinId: string): void {
    this.rebuildArmorySections();
    const body = this.deps.root().querySelector<HTMLElement>('.dr-body');
    if (body && this.isOpen && this.tab === 'store') this.paintStore(body);
    const row = this.armoryRowById(skinId);
    if (row) this.armoryInspect?.refresh(row);
  }

  private requestArmoryPurchase(row: ArmorySkinRow): void {
    if (row.owned || !row.purchasable || row.costClaudium === null) return;
    const copy = localizeWeaponSkin(row.skin);
    const cost = formatNumber(row.costClaudium, { maximumFractionDigits: 0 });
    if (!row.affordable) {
      this.openNeedMoreDialog(row, row.costClaudium, this.storeBalance);
      return;
    }
    this.deps.confirmDialog?.(
      t('hudChrome.wocStore.confirmTitle'),
      t('hudChrome.wocStore.confirmBody', { item: copy.name, cost }),
      t('hudChrome.wocStore.confirmPurchase'),
      t('hudChrome.wocStore.cancel'),
      () => void this.purchaseArmorySkin(row),
    );
  }

  private async purchaseArmorySkin(row: ArmorySkinRow): Promise<void> {
    const expectedCostClaudium = row.costClaudium;
    if (expectedCostClaudium === null) return;
    this.storePriceChanged = false;
    const result = await this.deps.spendStoreItem?.(row.skin.id, 'skin', expectedCostClaudium);
    if (result?.reason === 'price_changed') {
      this.storePriceChanged = true;
      if (result.balance !== null) this.storeBalance = result.balance;
      await this.renderStore(null);
      const current = this.armoryRowById(row.skin.id);
      if (
        current &&
        current.costClaudium !== null &&
        current.costClaudium !== expectedCostClaudium
      ) {
        this.requestArmoryPurchase(current);
      }
      return;
    }
    if (result?.reason === 'insufficient_balance') {
      if (result.balance !== null) {
        this.storeBalance = result.balance;
        this.rebuildArmorySections();
        const body = this.deps.root().querySelector<HTMLElement>('.dr-body');
        if (body) this.paintStore(body);
      }
      const authoritativeCost =
        result.costClaudium !== null &&
        Number.isFinite(result.costClaudium) &&
        result.costClaudium > 0
          ? result.costClaudium
          : row.costClaudium;
      if (authoritativeCost !== null) {
        this.openNeedMoreDialog(row, authoritativeCost, result.balance);
      }
      return;
    }
    if (!result?.granted) {
      // Re-check before declaring an outage: a double-submit lands as the
      // service's already_granted (not granted), yet the skin IS owned.
      await this.renderStore(null);
      const owned = this.armoryRowById(row.skin.id)?.owned ?? false;
      if (!owned) {
        this.storeError = true;
        const body = this.deps.root().querySelector<HTMLElement>('.dr-body');
        if (body) this.paintStore(body);
        return;
      }
    } else {
      await this.renderStore(null);
    }
    const fresh = this.armoryRowById(row.skin.id);
    if (fresh) this.armoryInspect?.refresh(fresh);
  }

  private openNeedMoreDialog(
    row: ArmorySkinRow,
    costClaudium: number,
    balance: number | null,
  ): void {
    const knownBalance = balance ?? this.storeBalance;
    const copy = localizeWeaponSkin(row.skin);
    const shortfall = formatNumber(Math.max(0, costClaudium - (knownBalance ?? 0)), {
      maximumFractionDigits: 0,
    });
    this.deps.confirmDialog?.(
      t('hudChrome.wocStore.needMoreTitle'),
      t('hudChrome.wocStore.needMoreBody', { item: copy.name, shortfall }),
      t('hudChrome.wocStore.buyClaudium'),
      t('hudChrome.wocStore.cancel'),
      () => this.openClaudiumFromStore(),
    );
  }

  private openClaudiumFromStore(): void {
    this.armoryInspect?.close();
    this.deps.openClaudium?.();
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
    body.innerHTML =
      this.summaryHtml(view) +
      this.walletHtml(view) +
      this.spinHtml(view) +
      this.tasksHtml(view) +
      this.leaderboardHtml(view.status) +
      this.historyHtml(view.history);
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
      this.openSpinOverlay(result.awardedPoints);
      this.deps.onStatus?.(result);
      this.paint(
        buildDailyRewardsView({ kind: 'status', status: result, history: this.lastHistory }),
      );
    } catch {
      await this.render(null);
      return;
    }
  }

  private titleHtml(storeEnabled: boolean): string {
    const title = storeEnabled ? t('hudChrome.wocStore.title') : t('hudChrome.dailyRewards.title');
    const close = storeEnabled ? t('hudChrome.wocStore.close') : t('hudChrome.dailyRewards.close');
    return (
      `<div class="panel-title"><span id="daily-rewards-title">${esc(title)}</span>` +
      `<button type="button" class="x-btn" data-close aria-label="${esc(close)}">${svgIcon('close')}</button></div>`
    );
  }

  private tabsHtml(): string {
    return (
      `<div class="woc-store-tabs" role="tablist" aria-label="${esc(t('hudChrome.wocStore.tabsLabel'))}">` +
      `<button id="woc-store-tab-store" type="button" role="tab" aria-controls="woc-store-panel" data-woc-store-tab="store">${esc(t('hudChrome.wocStore.storeTab'))}</button>` +
      `<button id="woc-store-tab-rewards" type="button" role="tab" aria-controls="woc-store-panel" data-woc-store-tab="rewards">${esc(t('hudChrome.wocStore.rewardsTab'))}</button>` +
      `<span class="woc-store-loading" data-woc-store-loading role="status" aria-live="polite" aria-label="${esc(t('hudChrome.wocStore.loading'))}" aria-busy="false"><i aria-hidden="true"></i></span></div>`
    );
  }

  private loadingHtml(storeEnabled: boolean): string {
    return storeEnabled
      ? '<div id="woc-store-panel" class="dr-body woc-store-body" role="tabpanel" aria-labelledby="woc-store-tab-store"></div>'
      : '<div class="dr-body woc-store-body"></div>';
  }

  private syncStoreLoading(): void {
    const indicator = this.deps.root().querySelector<HTMLElement>('[data-woc-store-loading]');
    if (!indicator) return;
    indicator.classList.toggle('active', this.storeLoading);
    indicator.setAttribute('aria-busy', this.storeLoading ? 'true' : 'false');
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
            amount: `$${formatNumber(s.prizePoolUsd, {
              maximumFractionDigits: 2,
              minimumFractionDigits: 2,
            })}`,
          })})`;
    const reset = formatDateTime(new Date(s.resetAt), { hour: 'numeric', minute: '2-digit' });
    const remaining = this.remainingText(s.resetAt);
    const value =
      s.eligibility.usdValue === null
        ? t('hudChrome.dailyRewards.unknown')
        : t('hudChrome.dailyRewards.usd', {
            amount: `$${formatNumber(s.eligibility.usdValue, { maximumFractionDigits: 2 })}`,
          });
    const reason = reasonText(s.eligibility);
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

  private spinHtml(view: Extract<DailyRewardsView, { kind: 'ready' }>): string {
    const spin = view.status.spin;
    const text = spin.claimed
      ? t('hudChrome.dailyRewards.spinClaimed', {
          points: formatNumber(spin.points ?? 0, { maximumFractionDigits: 0 }),
        })
      : t('hudChrome.dailyRewards.spinReady');
    return (
      `<section class="dr-section"><h3>${esc(t('hudChrome.dailyRewards.spinTitle'))}</h3>` +
      `<div class="dr-spin"><div class="dr-wheel">${esc(spin.claimed ? `+${formatNumber(spin.points ?? 0, { maximumFractionDigits: 0 })}` : '?')}</div>` +
      `<div><p>${esc(text)}</p><button type="button" class="lb-page-btn" data-spin ${view.locked || spin.claimed ? 'disabled' : ''}>${esc(t('hudChrome.dailyRewards.spinButton'))}</button></div></div></section>`
    );
  }

  private walletHtml(view: Extract<DailyRewardsView, { kind: 'ready' }>): string {
    if (!view.locked) return '';
    const reason = view.lockReason;
    if (reason === 'banned') return '';
    const title =
      reason === 'no_wallet'
        ? t('hudChrome.dailyRewards.walletConnectTitle')
        : t('hudChrome.dailyRewards.walletHoldTitle');
    const body =
      reason === 'no_wallet'
        ? t('hudChrome.dailyRewards.walletConnectBody')
        : reason === 'under_minimum'
          ? t('hudChrome.dailyRewards.walletHoldBody', {
              amount: formatNumber(view.status.eligibility.minUsd, { maximumFractionDigits: 0 }),
            })
          : t('hudChrome.dailyRewards.walletPriceBody');
    const button =
      reason === 'no_wallet'
        ? `<button type="button" class="lb-page-btn" data-wallet-connect>${esc(t('hudChrome.dailyRewards.walletConnectButton'))}</button>`
        : '';
    return (
      `<section class="dr-wallet-card">` +
      `<h3>${esc(title)}</h3>` +
      `<p>${esc(body)}</p>` +
      button +
      `</section>`
    );
  }

  private wheelLandingAngle(points: number): number {
    const index = Math.max(0, this.wheelValues.indexOf(points));
    const segment = 360 / this.wheelValues.length;
    const center = index * segment + segment / 2;
    return -center;
  }

  private openSpinOverlay(points: number): void {
    this.closeSpinOverlay();
    const overlay = document.createElement('div');
    overlay.className = 'dr-spin-overlay open';
    overlay.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') this.closeSpinOverlay();
    });
    overlay.addEventListener('mousedown', (event) => {
      if (event.target === overlay) this.closeSpinOverlay();
    });
    const labels = this.wheelValues
      .map(
        (value, index) =>
          `<span style="--i:${index}">+${formatNumber(value, { maximumFractionDigits: 0 })}</span>`,
      )
      .join('');
    overlay.innerHTML =
      `<div class="dr-spin-stage" role="dialog" aria-modal="true" aria-label="${esc(t('hudChrome.dailyRewards.spinDialogTitle'))}">` +
      `<button type="button" class="x-btn dr-spin-close" data-spin-close aria-label="${esc(t('hudChrome.dailyRewards.spinClose'))}">${svgIcon('close')}</button>` +
      `<div class="dr-spin-pointer" aria-hidden="true"></div>` +
      `<div class="dr-spin-wheel-big" style="--land-angle:${this.wheelLandingAngle(points)}deg" aria-hidden="true">${labels}</div>` +
      `<div class="dr-spin-result" style="--tier-color:#ffe27a">` +
      `<span>${esc(t('hudChrome.dailyRewards.spinResult', { points: formatNumber(points, { maximumFractionDigits: 0 }) }))}</span>` +
      `<i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i>` +
      `<b></b><b></b><b></b><b></b><b></b><b></b><b></b><b></b><b></b><b></b><b></b><b></b>` +
      `</div></div>`;
    overlay
      .querySelector('[data-spin-close]')
      ?.addEventListener('click', () => this.closeSpinOverlay());
    document.body.appendChild(overlay);
    this.spinOverlay = overlay;
    (overlay.querySelector('[data-spin-close]') as HTMLElement | null)?.focus();
  }

  private closeSpinOverlay(): void {
    if (!this.spinOverlay) return;
    this.spinOverlay.remove();
    this.spinOverlay = null;
  }

  private tasksHtml(view: Extract<DailyRewardsView, { kind: 'ready' }>): string {
    const rows = view.status.tasks
      .map((task) => {
        const multiplier =
          typeof task.multiplier === 'number' && Number.isFinite(task.multiplier)
            ? `<em>${esc(t('hudChrome.dailyRewards.taskMultiplier', { multiplier: formatNumber(task.multiplier, { maximumFractionDigits: 2 }) }))}</em>`
            : '';
        return `<li class="${task.completed ? 'done' : ''}"><span>${esc(task.title)}</span><small><span>${esc(task.description)}</span>${multiplier}</small><b>${formatNumber(task.points, { maximumFractionDigits: 0 })}</b></li>`;
      })
      .join('');
    return (
      `<section class="dr-section"><h3>${esc(t('hudChrome.dailyRewards.tasks'))}</h3>` +
      `<ul class="dr-tasks">${rows}</ul>` +
      `</section>`
    );
  }

  private leaderboardHtml(status: DailyRewardStatus): string {
    const totalKey =
      status.leaderboardTotal === 1
        ? 'hudChrome.dailyRewards.totalPlayer'
        : 'hudChrome.dailyRewards.totalPlayers';
    const total = `<div class="dr-leaderboard-total">${esc(t(totalKey, { count: formatNumber(status.leaderboardTotal, { maximumFractionDigits: 0 }) }))}</div>`;
    const rows =
      status.leaderboard.length === 0
        ? `<div class="dr-empty">${esc(t('hudChrome.dailyRewards.noLeaders'))}</div>`
        : status.leaderboard
            .map(
              (row) =>
                `<div class="dr-rank${row.me ? ' mine' : ''}"><span>${row.rank}</span><b>${esc(row.name)}</b><strong>${formatNumber(row.points, { maximumFractionDigits: 0 })}</strong></div>`,
            )
            .join('');
    return `<section class="dr-section"><h3>${esc(t('hudChrome.dailyRewards.leaderboard'))}</h3>${total}<div class="dr-ranks dr-leaderboard-ranks">${rows}</div></section>`;
  }

  private historyHtml(history: DailyRewardHistory): string {
    const rows =
      history.payouts.length === 0
        ? `<div class="dr-empty">${esc(t('hudChrome.dailyRewards.noHistory'))}</div>`
        : history.payouts
            .slice(0, 10)
            .map((row) => {
              const prize = `$${t('hudChrome.dailyRewards.usd', {
                amount: formatNumber(row.prizeUsd, { maximumFractionDigits: 2 }),
              })}`;
              return `<div class="dr-rank"><span>${esc(row.day)} #${row.rank}</span><b>${esc(row.name)}</b><strong>${esc(prize)}</strong></div>`;
            })
            .join('');
    return `<section class="dr-section"><h3>${esc(t('hudChrome.dailyRewards.history'))}</h3><div class="dr-ranks">${rows}</div></section>`;
  }
}
