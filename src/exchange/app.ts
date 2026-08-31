import { AccountSessionApi, type CharacterSummary } from '../net/account_session_api';
import { WocExchangeClient } from '../net/woc_exchange_client';
import type {
  WocActivityView,
  WocListingView,
  WocQuoteView,
  WocSaleView,
} from '../net/woc_market_sdk';
import { ITEMS } from '../sim/data';
import { classDisplayName, itemDisplayName } from '../ui/entity_i18n';
import { type TranslationKey, t } from '../ui/i18n';
import { termsUrlFor } from '../ui/terms_link';
import { ExchangeOperationGate, payServerQuote, StaleExchangeOperation } from './payment_flow';
import { restoreValidatedSession, splitSecondFactor } from './session';

type WalletModule = typeof import('../net/wallet');
type View = 'browse' | 'activity';
type TurnstileApi = {
  render(el: HTMLElement, options: { sitekey: string; size?: 'flexible' }): string;
  getResponse(id: string): string;
  reset(id: string): void;
};

const TURNSTILE_SITEKEY = String(import.meta.env.VITE_TURNSTILE_SITEKEY ?? '');
const REOWN_PROJECT_ID = String(import.meta.env.VITE_REOWN_PROJECT_ID ?? '').trim() || null;

function node<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = '',
): HTMLElementTagNameMap[K] {
  const out = document.createElement(tag);
  if (className) out.className = className;
  return out;
}

function button(
  label: string,
  action: () => void | Promise<void>,
  className = '',
): HTMLButtonElement {
  const out = node('button', className);
  out.type = 'button';
  out.textContent = label;
  out.addEventListener('click', () => void action());
  return out;
}

function usd(cents: number | null): string {
  if (cents == null) return '-';
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(
    cents / 100,
  );
}

function itemName(itemId: string): string {
  const def = ITEMS[itemId];
  return def ? itemDisplayName(def) : itemId;
}

function date(ms: number): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(ms);
}

function bidStatus(status: string): string {
  const keys: Record<string, TranslationKey> = {
    pending_bond: 'hudChrome.wocMarket.bidStatusPending',
    active: 'hudChrome.wocMarket.bidStatusActive',
    outbid: 'hudChrome.wocMarket.bidStatusOutbid',
    won: 'hudChrome.wocMarket.bidStatusWon',
    defaulted: 'hudChrome.wocMarket.bidStatusDefaulted',
    cancelled: 'hudChrome.wocMarket.bidStatusCancelled',
  };
  return t(keys[status] ?? 'hudChrome.wocMarket.bidStatusLapsed');
}

function settlementStatus(state: string): string {
  const keys: Record<string, TranslationKey> = {
    confirming: 'hudChrome.wocMarket.settlementConfirming',
    confirmed: 'hudChrome.wocMarket.settlementConfirmedDelivering',
    delivering: 'hudChrome.wocMarket.settlementConfirmedDelivering',
    review: 'hudChrome.wocMarket.settlementReview',
    delivered: 'hudChrome.wocMarket.settlementDelivered',
    expired: 'hudChrome.wocMarket.settlementExpired',
    failed: 'hudChrome.wocMarket.settlementFailed',
  };
  return t(keys[state] ?? 'hudChrome.wocMarket.settlementOffered');
}

export class ExchangeApp {
  private readonly api = new AccountSessionApi();
  private readonly market = new WocExchangeClient({
    token: () => this.api.token,
    base: this.api.base,
  });
  private readonly operation = new ExchangeOperationGate();
  private view: View = 'browse';
  private page = 0;
  private sort: 'ending' | 'newest' | 'price_asc' | 'price_desc' = 'ending';
  private quality: string | null = null;
  private format: string | null = null;
  private query = '';
  private listings: WocListingView[] = [];
  private hasMore = false;
  private activity: WocActivityView | null = null;
  private characters: CharacterSummary[] = [];
  private characterId: number | null = null;
  private wallet: WalletModule | null = null;
  private turnstileId: string | null = null;
  private secondFactorRequired = false;
  private refreshTimer: number | null = null;

  constructor(private readonly mount: HTMLElement) {}

  async start(): Promise<void> {
    document.title = t('exchange.title');
    this.view = location.hash === '#activity' ? 'activity' : 'browse';
    window.addEventListener('hashchange', () => {
      if (this.operation.isRunning()) {
        location.hash = this.view === 'activity' ? 'activity' : '';
        this.announce(t('exchange.paymentInProgress'), true);
        return;
      }
      this.operation.invalidate();
      this.view = location.hash === '#activity' ? 'activity' : 'browse';
      void this.renderMarket();
    });
    window.addEventListener('beforeunload', (event) => {
      if (!this.operation.isRunning()) return;
      event.preventDefault();
      event.returnValue = '';
    });
    document.addEventListener('visibilitychange', () => this.syncPolling());
    const restored = await restoreValidatedSession(this.api);
    if (!restored.authenticated) {
      this.renderLogin();
      return;
    }
    await this.enterMarket();
  }

  private replace(...children: Node[]): void {
    this.mount.replaceChildren(...children);
  }

  private announce(message: string, error = false): void {
    const live = this.mount.querySelector<HTMLElement>('[data-live]');
    if (!live) return;
    live.textContent = message;
    live.dataset.error = error ? 'true' : 'false';
  }

  private renderLogin(): void {
    this.stopPolling();
    const shell = node('main', 'exchange-login');
    const card = node('section', 'exchange-login-card');
    const title = node('h1');
    title.textContent = t('exchange.title');
    const subtitle = node('p', 'exchange-muted');
    subtitle.textContent = t('exchange.subtitle');
    const form = node('form');
    const username = node('input');
    username.name = 'username';
    username.autocomplete = 'username';
    username.required = true;
    const usernameLabel = node('label');
    usernameLabel.textContent = t('exchange.username');
    usernameLabel.append(username);
    const password = node('input');
    password.type = 'password';
    password.name = 'password';
    password.autocomplete = 'current-password';
    password.required = true;
    const passwordLabel = node('label');
    passwordLabel.textContent = t('exchange.password');
    passwordLabel.append(password);
    const factor = node('input');
    factor.name = 'factor';
    factor.autocomplete = 'one-time-code';
    const factorLabel = node('label');
    factorLabel.textContent = t('exchange.secondFactor');
    factorLabel.append(factor);
    factorLabel.hidden = !this.secondFactorRequired;
    const turnstile = node('div', 'exchange-turnstile');
    const submit = node('button', 'exchange-primary');
    submit.type = 'submit';
    submit.textContent = t('exchange.login');
    const live = node('p', 'exchange-live');
    live.dataset.live = '';
    live.setAttribute('role', 'status');
    form.append(usernameLabel, passwordLabel, factorLabel, turnstile, submit, live);
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      submit.disabled = true;
      const factorParts = splitSecondFactor(factor.value);
      const turnstileToken = this.turnstileToken();
      try {
        const result = await this.api.login(
          username.value,
          password.value,
          turnstileToken,
          factorParts.code,
          factorParts.recoveryCode,
        );
        if (result.twoFactorRequired) {
          this.secondFactorRequired = true;
          factorLabel.hidden = false;
          factor.required = true;
          factor.focus();
          this.resetTurnstile();
          this.announce(t('exchange.secondFactorHint'));
          return;
        }
        this.api.saveSession();
        await this.enterMarket();
      } catch {
        this.announce(t('exchange.signInFailed'), true);
        this.resetTurnstile();
      } finally {
        submit.disabled = false;
      }
    });
    card.append(title, subtitle, form);
    shell.append(card);
    this.replace(shell);
    this.mountTurnstile(turnstile);
  }

  private turnstileApi(): TurnstileApi | undefined {
    return (window as unknown as { turnstile?: TurnstileApi }).turnstile;
  }

  private mountTurnstile(container: HTMLElement): void {
    if (!TURNSTILE_SITEKEY) return;
    const mount = () => {
      const api = this.turnstileApi();
      if (!api || !container.isConnected) return false;
      this.turnstileId = api.render(container, { sitekey: TURNSTILE_SITEKEY, size: 'flexible' });
      return true;
    };
    if (mount()) return;
    let attempts = 0;
    const timer = window.setInterval(() => {
      attempts += 1;
      if (mount() || attempts > 50) window.clearInterval(timer);
    }, 100);
  }

  private turnstileToken(): string {
    if (!TURNSTILE_SITEKEY) return '';
    const api = this.turnstileApi();
    return api && this.turnstileId ? (api.getResponse(this.turnstileId) ?? '') : '';
  }

  private resetTurnstile(): void {
    const api = this.turnstileApi();
    if (api && this.turnstileId) api.reset(this.turnstileId);
  }

  private async enterMarket(): Promise<void> {
    this.characters = await this.api.characters().catch(() => []);
    const stored = Number(localStorage.getItem('woc.exchange.character'));
    this.characterId = this.characters.some((character) => character.id === stored)
      ? stored
      : (this.characters[0]?.id ?? null);
    await this.renderMarket();
    this.syncPolling();
  }

  private chrome(): { shell: HTMLElement; content: HTMLElement } {
    const shell = node('div', 'exchange-shell');
    const skip = node('a', 'exchange-skip');
    skip.href = '#exchange-main';
    skip.textContent = t('exchange.skip');
    const header = node('header', 'exchange-header');
    const brand = node('div');
    const heading = node('h1');
    heading.textContent = t('exchange.title');
    const subtitle = node('p', 'exchange-muted');
    subtitle.textContent = t('exchange.subtitle');
    brand.append(heading, subtitle);
    const actions = node('div', 'exchange-actions');
    const select = node('select');
    select.setAttribute('aria-label', t('exchange.chooseCharacter'));
    for (const character of this.characters) {
      const option = node('option');
      option.value = String(character.id);
      option.textContent = `${character.name} - ${classDisplayName(character.class)} ${character.level}`;
      option.selected = character.id === this.characterId;
      select.append(option);
    }
    select.addEventListener('change', () => {
      this.characterId = Number(select.value);
      localStorage.setItem('woc.exchange.character', select.value);
    });
    actions.append(
      select,
      button(t('exchange.walletConnect'), () => this.ensureWallet()),
      button(t('exchange.logout'), () => this.logout()),
    );
    header.append(brand, actions);
    const nav = node('nav', 'exchange-nav');
    const browseButton = button(
      t('exchange.browse'),
      () => this.navigate('browse'),
      this.view === 'browse' ? 'active' : '',
    );
    const activityButton = button(
      t('exchange.activity'),
      () => this.navigate('activity'),
      this.view === 'activity' ? 'active' : '',
    );
    if (this.view === 'browse') browseButton.setAttribute('aria-current', 'page');
    else activityButton.setAttribute('aria-current', 'page');
    nav.append(browseButton, activityButton);
    const content = node('main', 'exchange-content');
    content.id = 'exchange-main';
    const live = node('p', 'exchange-live');
    live.dataset.live = '';
    live.setAttribute('role', 'status');
    shell.append(skip, header, nav, live, content);
    return { shell, content };
  }

  private navigate(view: View): void {
    if (this.operation.isRunning()) {
      this.announce(t('exchange.paymentInProgress'), true);
      return;
    }
    this.operation.invalidate();
    this.view = view;
    location.hash = view === 'activity' ? 'activity' : '';
    void this.renderMarket();
  }

  private async renderMarket(): Promise<void> {
    const { shell, content } = this.chrome();
    const loading = node('p');
    loading.textContent = t('exchange.loading');
    content.append(loading);
    this.replace(shell);
    if (this.view === 'activity') await this.loadActivity(content);
    else await this.loadBrowse(content);
  }

  private async loadBrowse(content: HTMLElement): Promise<void> {
    const status = await this.market.status();
    if (!status.ok) {
      content.replaceChildren(this.message(t('exchange.unavailable')));
      return;
    }
    if (!status.enabled) {
      content.replaceChildren(this.message(t('exchange.paused')));
      return;
    }
    const result = await this.market.browse({
      page: this.page,
      quality: this.quality,
      format: this.format,
      category: null,
      subcategory: null,
      itemIds: null,
      sort: this.sort,
    });
    if (!result.ok) {
      content.replaceChildren(this.message(t('exchange.requestFailed')));
      return;
    }
    this.listings = result.listings;
    this.hasMore = result.hasMore;
    this.renderBrowse(content);
  }

  private renderBrowse(content: HTMLElement): void {
    const marketStatus = this.message(t('exchange.marketOnline'));
    marketStatus.className = 'exchange-status';
    const controls = node('div', 'exchange-filters');
    const search = node('input');
    search.type = 'search';
    search.placeholder = t('exchange.search');
    search.setAttribute('aria-label', t('exchange.search'));
    search.value = this.query;
    const sort = node('select');
    sort.setAttribute('aria-label', t('exchange.sort'));
    const choices = [
      ['ending', t('exchange.ending')],
      ['newest', t('exchange.newest')],
      ['price_asc', t('exchange.priceLow')],
      ['price_desc', t('exchange.priceHigh')],
    ] as const;
    for (const [value, label] of choices) {
      const option = node('option');
      option.value = value;
      option.textContent = label;
      option.selected = value === this.sort;
      sort.append(option);
    }
    sort.addEventListener('change', () => {
      this.sort = sort.value as typeof this.sort;
      this.page = 1;
      void this.renderMarket();
    });
    const quality = this.filterSelect(
      t('exchange.quality'),
      [
        ['', t('exchange.all')],
        ['epic', t('exchange.qualityEpic')],
        ['legendary', t('exchange.qualityLegendary')],
        ['artifact', t('exchange.qualityArtifact')],
      ],
      this.quality,
      (value) => {
        this.quality = value || null;
      },
    );
    const format = this.filterSelect(
      t('exchange.format'),
      [
        ['', t('exchange.all')],
        ['auction', t('exchange.auction')],
        ['buy_now', t('exchange.buyNowFormat')],
        ['auction_buy_now', `${t('exchange.auction')} + ${t('exchange.buyNowFormat')}`],
      ],
      this.format,
      (value) => {
        this.format = value || null;
      },
    );
    controls.append(
      search,
      sort,
      quality,
      format,
      button(t('exchange.refresh'), () => this.renderMarket()),
    );
    const grid = node('div', 'exchange-grid');
    this.renderListingGrid(grid);
    search.addEventListener('input', () => {
      this.query = search.value;
      this.renderListingGrid(grid);
    });
    const pagination = node('div', 'exchange-pagination');
    const previous = button(t('exchange.previous'), () => {
      this.page = Math.max(1, this.page - 1);
      return this.renderMarket();
    });
    previous.disabled = this.page <= 1;
    const marker = node('span');
    marker.textContent = t('exchange.page', { page: this.page });
    const next = button(t('exchange.next'), () => {
      this.page += 1;
      return this.renderMarket();
    });
    next.disabled = !this.hasMore;
    pagination.append(previous, marker, next);
    const listingCta = node('aside', 'exchange-list-cta');
    const help = node('p');
    help.textContent = t('exchange.listHelp');
    const link = node('a', 'exchange-primary');
    link.href = '/play';
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = t('exchange.listInGame');
    listingCta.append(help, link);
    content.replaceChildren(marketStatus, controls, grid, pagination, listingCta);
  }

  private renderListingGrid(grid: HTMLElement): void {
    const query = this.query.trim().toLowerCase();
    const shown = this.listings.filter((listing) =>
      query ? `${itemName(listing.itemId)} ${listing.itemId}`.toLowerCase().includes(query) : true,
    );
    grid.replaceChildren(...shown.map((listing) => this.listingCard(listing)));
    if (!shown.length) grid.append(this.message(t('exchange.empty')));
  }

  private filterSelect(
    label: string,
    options: readonly (readonly [string, string])[],
    selected: string | null,
    update: (value: string) => void,
  ): HTMLSelectElement {
    const select = node('select');
    select.setAttribute('aria-label', label);
    for (const [value, text] of options) {
      const option = node('option');
      option.value = value;
      option.textContent = `${label}: ${text}`;
      option.selected = value === (selected ?? '');
      select.append(option);
    }
    select.addEventListener('change', () => {
      update(select.value);
      this.page = 1;
      void this.renderMarket();
    });
    return select;
  }

  private listingCard(listing: WocListingView): HTMLElement {
    const card = node('article', 'exchange-card');
    const name = node('h2');
    name.textContent = itemName(listing.itemId);
    const seller = node('p', 'exchange-muted');
    seller.textContent = `${t('exchange.seller')}: ${listing.sellerName}`;
    const bid = node('p');
    bid.textContent = `${t('exchange.currentBid')}: ${usd(listing.currentBidCents ?? listing.startCents)}`;
    const buy = node('p');
    buy.textContent = `${t('exchange.buyNow')}: ${usd(listing.buyNowCents)}`;
    const ends = node('p', 'exchange-muted');
    ends.textContent = `${t('exchange.ends')}: ${date(listing.endsAtMs)}`;
    card.append(
      name,
      seller,
      bid,
      buy,
      ends,
      button(t('exchange.details'), () => this.openDetail(listing.id), 'exchange-primary'),
    );
    return card;
  }

  private async openDetail(id: number): Promise<void> {
    if (this.operation.isRunning()) {
      this.announce(t('exchange.paymentInProgress'), true);
      return;
    }
    this.operation.invalidate();
    const result = await this.market.detail(id);
    if (!result.ok) {
      this.announce(t('exchange.requestFailed'), true);
      return;
    }
    const history = await this.market.history(result.listing.itemId);
    const sellerHistory = await this.market.sellerHistory(result.listing.sellerName);
    const dialog = node('dialog', 'exchange-dialog');
    const listing = result.listing;
    const title = node('h2');
    title.id = `exchange-listing-${listing.id}`;
    title.textContent = itemName(listing.itemId);
    dialog.setAttribute('aria-labelledby', title.id);
    const details = node('div', 'exchange-detail');
    for (const text of [
      `${t('exchange.seller')}: ${listing.sellerName}`,
      `${t('exchange.currentBid')}: ${usd(listing.currentBidCents ?? listing.startCents)}`,
      `${t('exchange.buyNow')}: ${usd(listing.buyNowCents)}`,
      `${t('exchange.ends')}: ${date(listing.endsAtMs)}`,
    ])
      details.append(this.message(text));
    const actions = node('div', 'exchange-actions');
    if (!listing.mine && listing.format !== 'buy_now')
      actions.append(button(t('exchange.bid'), () => this.placeBid(listing), 'exchange-primary'));
    if (!listing.mine && listing.buyNowCents != null && !listing.buyNowLocked)
      actions.append(button(t('exchange.buyNow'), () => this.buyNow(listing), 'exchange-primary'));
    if (
      listing.mine &&
      listing.status === 'active' &&
      listing.currentBidCents == null &&
      !listing.cancelPending
    )
      actions.append(button(t('exchange.cancel'), () => this.cancelListing(listing, dialog)));
    const historyTitle = node('h3');
    historyTitle.textContent = t('exchange.history');
    const historyList = this.salesList(history.ok ? history.sales : []);
    const sellerHistoryTitle = node('h3');
    sellerHistoryTitle.textContent = t('exchange.sellerHistory');
    const sellerHistoryList = this.salesList(sellerHistory.ok ? sellerHistory.sales : []);
    const close = button(t('exchange.close'), () => dialog.close());
    dialog.addEventListener('close', () => {
      if (!this.operation.isRunning()) this.operation.invalidate();
      dialog.remove();
    });
    dialog.append(
      title,
      details,
      actions,
      historyTitle,
      historyList,
      sellerHistoryTitle,
      sellerHistoryList,
      close,
    );
    document.body.append(dialog);
    dialog.showModal();
  }

  private salesList(sales: WocSaleView[]): HTMLElement {
    const list = node('ul', 'exchange-sales');
    if (!sales.length) {
      const empty = node('li');
      empty.textContent = t('exchange.noHistory');
      list.append(empty);
      return list;
    }
    for (const sale of sales) {
      const row = node('li');
      row.textContent = `${usd(sale.priceCents)} - ${sale.sellerName} - ${date(sale.atMs)}`;
      list.append(row);
    }
    return list;
  }

  private requireCharacter(): number | null {
    if (this.characterId == null) this.announce(t('exchange.chooseCharacter'), true);
    return this.characterId;
  }

  private async placeBid(listing: WocListingView): Promise<void> {
    const characterId = this.requireCharacter();
    if (characterId == null) return;
    const raw = window.prompt(t('exchange.bidAmount'), (listing.minNextBidCents / 100).toFixed(2));
    if (raw == null) return;
    const amountCents = Math.round(Number(raw) * 100);
    if (!Number.isFinite(amountCents) || amountCents < listing.minNextBidCents) return;
    if (!(await this.confirmTerms(t('exchange.confirmBid')))) return;
    await this.runMutation(async (operation) => {
      await this.ensureWallet();
      this.operation.assertCurrent(operation);
      const result = await this.market.placeBid({
        listingId: listing.id,
        characterId,
        amountCents,
        acceptTerms: true,
      });
      if (!result.ok) throw new Error(result.code);
      return this.payBond(result.bid.id, result.bond, operation);
    });
  }

  private async buyNow(listing: WocListingView): Promise<void> {
    const characterId = this.requireCharacter();
    if (characterId == null || !(await this.confirmTerms(t('exchange.confirmBuy')))) return;
    await this.runMutation(async (operation) => {
      await this.ensureWallet();
      this.operation.assertCurrent(operation);
      const result = await this.market.buyNow({
        listingId: listing.id,
        characterId,
        acceptTerms: true,
      });
      if (!result.ok) throw new Error(result.code);
      return this.paySettlement(result.settlement.id, result.quote, operation);
    });
  }

  private confirmTerms(actionText: string): Promise<boolean> {
    return new Promise((resolve) => {
      const dialog = node('dialog', 'exchange-dialog');
      const title = node('h2');
      title.id = 'exchange-terms-title';
      title.textContent = actionText;
      dialog.setAttribute('aria-labelledby', title.id);
      const label = node('label', 'exchange-terms');
      const checkbox = node('input');
      checkbox.type = 'checkbox';
      const caption = node('span');
      caption.textContent = t('exchange.acceptTerms');
      label.append(checkbox, caption);
      const terms = node('a');
      terms.href = termsUrlFor(location.origin);
      terms.target = '_blank';
      terms.rel = 'noopener noreferrer';
      terms.textContent = t('exchange.termsLink');
      const accept = button(t('exchange.continue'), () => finish(true), 'exchange-primary');
      accept.disabled = true;
      checkbox.addEventListener('change', () => {
        accept.disabled = !checkbox.checked;
      });
      const finish = (accepted: boolean) => {
        dialog.close();
        dialog.remove();
        resolve(accepted && checkbox.checked);
      };
      dialog.addEventListener('cancel', (event) => {
        event.preventDefault();
        finish(false);
      });
      dialog.append(
        title,
        label,
        terms,
        accept,
        button(t('exchange.close'), () => finish(false)),
      );
      document.body.append(dialog);
      dialog.showModal();
      checkbox.focus();
    });
  }

  private async cancelListing(listing: WocListingView, dialog?: HTMLDialogElement): Promise<void> {
    if (!window.confirm(t('exchange.confirmCancel'))) return;
    await this.runMutation(async () => {
      const result = await this.market.cancelListing(listing.id);
      if (!result.ok) throw new Error(result.code);
      dialog?.close();
    });
  }

  private async loadActivity(content: HTMLElement): Promise<void> {
    const result = await this.market.me();
    if (!result.ok) {
      content.replaceChildren(this.message(t('exchange.requestFailed')));
      return;
    }
    this.activity = result.activity;
    const sections = node('div', 'exchange-activity');
    const accountRows = [
      this.activityRow(
        result.activity.termsAcceptedAtMs == null
          ? t('exchange.termsNotAccepted')
          : t('exchange.termsAccepted'),
      ),
      this.activityRow(t('exchange.strikes', { count: result.activity.strikes?.strikes ?? 0 })),
      this.activityRow(
        result.activity.strikes?.suspendedUntilMs
          ? t('exchange.suspendedUntil', {
              date: date(result.activity.strikes.suspendedUntilMs),
            })
          : t('exchange.noSuspension'),
      ),
      this.activityRow(
        result.activity.walletLinked ? t('exchange.walletReady') : t('exchange.walletNotLinked'),
      ),
    ];
    sections.append(
      this.activitySection(t('exchange.accountStatus'), accountRows),
      this.activitySection(
        t('exchange.listings'),
        result.activity.listings.map((listing) => this.listingCard(listing)),
      ),
      this.activitySection(
        t('exchange.bids'),
        result.activity.bids.map((bid) => {
          const row = this.activityRow(
            `${bid.itemId ? itemName(bid.itemId) : `#${bid.listingId}`} - ${usd(bid.amountCents)} - ${bidStatus(bid.status)}`,
          );
          if (bid.bondState !== 'confirmed' && !bid.bondConfirming) {
            row.append(
              button(t('exchange.resumeBond'), () => this.resumeBond(bid.id)),
              button(t('exchange.abandonBid'), () => this.abandonBid(bid.id)),
            );
          }
          return row;
        }),
      ),
      this.activitySection(
        t('exchange.settlements'),
        result.activity.settlements.map((settlement) => {
          const row = this.activityRow(
            `${settlement.itemId ? itemName(settlement.itemId) : `#${settlement.listingId}`} - ${usd(settlement.amountCents)} - ${settlementStatus(settlement.state)}`,
          );
          if (settlement.state === 'offered' || settlement.state === 'failed')
            row.append(
              button(t('exchange.resumePayment'), () => this.resumeSettlement(settlement.id)),
            );
          return row;
        }),
      ),
    );
    content.replaceChildren(sections);
  }

  private activitySection(titleText: string, rows: HTMLElement[]): HTMLElement {
    const section = node('section');
    const title = node('h2');
    title.textContent = titleText;
    const body = node('div', 'exchange-grid');
    if (rows.length) body.append(...rows);
    else body.append(this.message(t('exchange.empty')));
    section.append(title, body);
    return section;
  }

  private activityRow(text: string): HTMLElement {
    const row = node('article', 'exchange-card');
    row.append(this.message(text));
    return row;
  }

  private async resumeBond(id: number): Promise<void> {
    await this.runMutation(async (operation) => {
      await this.ensureWallet();
      this.operation.assertCurrent(operation);
      const result = await this.market.bondQuote(id);
      if (!result.ok) throw new Error(result.code);
      return this.payBond(id, result.bond, operation);
    });
  }

  private async abandonBid(id: number): Promise<void> {
    await this.runMutation(async () => {
      const result = await this.market.abandonBid(id);
      if (!result.ok) throw new Error(result.code);
    });
  }

  private async resumeSettlement(id: number): Promise<void> {
    await this.runMutation(async (operation) => {
      await this.ensureWallet();
      this.operation.assertCurrent(operation);
      const result = await this.market.settlementQuote(id);
      if (!result.ok) throw new Error(result.code);
      return this.paySettlement(id, result.quote, operation);
    });
  }

  private async payBond(id: number, quote: WocQuoteView, operation: number): Promise<string> {
    const wallet = await this.loadWallet();
    const signature = await payServerQuote(quote, wallet.signAndSendTransactionBase64);
    const result = await this.market.confirmBond(id, signature);
    if (!result.ok) throw new Error(result.code);
    this.operation.assertCurrent(operation);
    return result.pending ? t('exchange.paymentPending') : t('exchange.paymentComplete');
  }

  private async paySettlement(id: number, quote: WocQuoteView, operation: number): Promise<string> {
    const wallet = await this.loadWallet();
    const signature = await payServerQuote(quote, wallet.signAndSendTransactionBase64);
    const result = await this.market.confirmSettlement(id, signature);
    if (!result.ok) throw new Error(result.code);
    this.operation.assertCurrent(operation);
    return result.state === 'confirming'
      ? t('exchange.paymentPending')
      : t('exchange.paymentComplete');
  }

  private async runMutation(
    action: (operation: number) => Promise<string | undefined>,
  ): Promise<void> {
    const operation = this.operation.begin();
    if (operation == null) return;
    try {
      const outcome = await action(operation);
      this.operation.assertCurrent(operation);
      await this.renderMarket();
      this.announce(outcome ?? t('exchange.actionComplete'));
    } catch (error) {
      if (!(error instanceof StaleExchangeOperation))
        this.announce(t('exchange.requestFailed'), true);
    } finally {
      this.operation.finish(operation);
    }
  }

  private async loadWallet(): Promise<WalletModule> {
    if (this.wallet) return this.wallet;
    const wallet = await import('../net/wallet');
    wallet.configureWalletConnect(REOWN_PROJECT_ID);
    wallet.setWalletPicker((options) => this.pickWallet(options));
    this.wallet = wallet;
    return wallet;
  }

  private pickWallet(
    options: readonly { id: string; name: string; icon: string; connected: boolean }[],
  ): Promise<string | null> {
    return new Promise((resolve) => {
      const dialog = node('dialog', 'exchange-dialog');
      const title = node('h2');
      title.id = 'exchange-wallet-title';
      title.textContent = t('exchange.walletChoice');
      dialog.setAttribute('aria-labelledby', title.id);
      const finish = (choice: string | null) => {
        dialog.close();
        dialog.remove();
        resolve(choice);
      };
      for (const option of options)
        dialog.append(button(option.name, () => finish(option.id), 'exchange-primary'));
      dialog.append(button(t('exchange.close'), () => finish(null)));
      dialog.addEventListener(
        'cancel',
        (event) => {
          event.preventDefault();
          finish(null);
        },
        { once: true },
      );
      dialog.prepend(title);
      document.body.append(dialog);
      dialog.showModal();
    });
  }

  private async ensureWallet(): Promise<void> {
    const wallet = await this.loadWallet();
    let current = wallet.currentWallet();
    if (!current.isConnected) {
      await wallet.openWalletModal();
      current = wallet.currentWallet();
    }
    if (!current.address) throw new Error('wallet unavailable');
    const linked = await this.api.linkedWallet();
    if (!linked) {
      const challenge = await this.api.walletLinkChallenge(current.address);
      const signature = await wallet.signMessageBase58(challenge.message);
      await this.api.linkWallet(current.address, signature, challenge.nonce);
      this.announce(t('exchange.walletLinked', { address: current.address }));
      return;
    }
    if (linked.pubkey !== current.address) {
      this.announce(t('exchange.walletMismatch'), true);
      throw new Error('wallet mismatch');
    }
    this.announce(t('exchange.walletLinked', { address: linked.pubkey }));
  }

  private async logout(): Promise<void> {
    if (this.operation.isRunning()) {
      this.announce(t('exchange.paymentInProgress'), true);
      return;
    }
    try {
      await this.api.logout();
    } finally {
      this.api.clearSession();
      this.operation.invalidate();
      this.renderLogin();
    }
  }

  private message(text: string): HTMLParagraphElement {
    const out = node('p');
    out.textContent = text;
    return out;
  }

  private syncPolling(): void {
    if (document.hidden || !this.api.token) {
      this.stopPolling();
      return;
    }
    if (this.refreshTimer != null) return;
    this.refreshTimer = window.setInterval(() => {
      const active = document.activeElement;
      if (
        this.operation.isRunning() ||
        document.querySelector('dialog[open]') ||
        (active && active !== document.body && active !== this.mount)
      )
        return;
      void this.renderMarket();
    }, 20_000);
  }

  private stopPolling(): void {
    if (this.refreshTimer != null) window.clearInterval(this.refreshTimer);
    this.refreshTimer = null;
  }
}
