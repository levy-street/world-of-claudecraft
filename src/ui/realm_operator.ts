// Realm operator panel (#475): the founding screen (stake $WOC to provision a
// realm) and the operator dashboard (manage / decommission owned realms). A
// self-contained module the realm-list screen composes, per the repo's
// module-first rule: it renders into a host-provided container and reaches the
// chain/account only through an injected RealmOperatorHost, so it carries no
// wallet state of its own and stays unit-testable at its seams.
//
// Strings live in src/ui/i18n.catalog/realm.ts (the `realm.*` keys); server
// error CODES map to realm.err.* below. Numbers go through formatNumber and
// dates through formatDateTime, per the i18n rules.

import { t, formatNumber, formatDateTime } from './i18n';
import type { TranslationKey } from './i18n';
import { esc } from './esc';
import { ApiError } from '../net/online';
import type {
  Api,
  OwnedRealm,
  ProvisionQuote,
  RealmBuyInfo,
  RealmBuyQuoteResponse,
  RealmBuyTierOption,
  RealmTierOption,
  RealmTiersInfo,
  RealmType,
} from '../net/online';

// The payment method the founding screen is currently set to.
export type PayMethod = 'stake' | 'buy';
// The currency the buy path pays in.
export type BuyCurrency = 'SOL' | 'USDC';

// The glue the panel needs from main.ts: the online client plus the wallet/link
// flow it already owns. Keeping this an interface lets the panel stay free of
// main.ts's wallet globals.
export interface RealmOperatorHost {
  api: Api;
  // The wallet currently linked to the signed-in account, or null. Read fresh on
  // each render so the submit button reflects a link made elsewhere on the page.
  linkedWallet(): string | null;
  // Connect + verify a wallet matching the account link. Resolves to the linked
  // pubkey when ready, or null if the player cancelled the wallet prompt. Throws
  // an Error with an already-localized message on a real failure.
  ensureWalletReady(): Promise<string | null>;
  // Sign + send the on-chain $WOC lock for a quote. Resolves to the lock
  // signature, or null if the player cancelled. Throws Error(localized) on failure.
  signLock(quote: ProvisionQuote): Promise<string | null>;
  // Sign + send the SOL/USDC split payment for a buy quote. Resolves to the
  // payment signature, or null if the player cancelled. Throws Error(localized) on
  // failure. Mirrors signLock for the "buy with SOL or USDC" path.
  signPurchase(quote: RealmBuyQuoteResponse): Promise<string | null>;
  // The affiliate code captured from a ?aff= link, or null. Sent with the quote so
  // a referred realm credits the salesperson; the panel shows a note when present.
  affiliateCode(): string | null;
  // Enter a realm the operator owns (reuses the realm-list selection flow).
  enterRealm(realm: OwnedRealm): void;
  // Close the panel (return to the realm list).
  close(): void;
}

// Shared realm label maps (also consumed by the affiliate panel).
export const TYPE_LABEL: Record<RealmType, TranslationKey> = {
  Normal: 'realmTypes.normal',
  PvP: 'realmTypes.pvp',
  RP: 'realmTypes.rp',
  'RP-PvP': 'realmTypes.rpPvp',
};

const TIER_LABEL: Record<RealmTierOption['name'], TranslationKey> = {
  bronze: 'realmOp.tier.bronze',
  silver: 'realmOp.tier.silver',
  gold: 'realmOp.tier.gold',
};

export const STATUS_LABEL: Record<string, TranslationKey> = {
  active: 'realmOp.status.active',
  provisioning: 'realmOp.status.provisioning',
  decommissioning: 'realmOp.status.decommissioning',
};

// Server `error` codes (and the two literal route messages) → realmOp.err.* keys.
// Exported so a unit test can assert every server-emitted code has a mapping.
export const ERR_KEYS = {
  invalid_realm_name: 'realmOp.err.invalid_realm_name',
  realm_name_not_allowed: 'realmOp.err.realm_name_not_allowed',
  realm_name_taken: 'realmOp.err.realm_name_taken',
  realm_cap_reached: 'realmOp.err.realm_cap_reached',
  stake_below_minimum: 'realmOp.err.stake_below_minimum',
  supply_unavailable: 'realmOp.err.supply_unavailable',
  invalid_amount: 'realmOp.err.invalid_amount',
  quote_expired: 'realmOp.err.quote_expired',
  quote_not_found: 'realmOp.err.quote_not_found',
  not_your_quote: 'realmOp.err.not_your_quote',
  stake_already_recorded: 'realmOp.err.stake_already_recorded',
  tx_not_finalized: 'realmOp.err.tx_not_finalized',
  tx_failed: 'realmOp.err.tx_failed',
  token_2022: 'realmOp.err.token_2022',
  wrong_vault_amount: 'realmOp.err.wrong_vault_amount',
  wrong_payer: 'realmOp.err.wrong_payer',
  not_realm_owner: 'realmOp.err.not_realm_owner',
  realm_not_found: 'realmOp.err.realm_not_found',
  realm_not_active: 'realmOp.err.realm_not_active',
  realm_not_decommissioning: 'realmOp.err.realm_not_decommissioning',
  timelock_not_elapsed: 'realmOp.err.timelock_not_elapsed',
  stake_not_released_onchain: 'realmOp.err.stake_not_released_onchain',
  // Buy-with-SOL/USDC path (server/realm_buy.ts): prepare + confirm + payment-verdict codes.
  buy_unavailable: 'realmOp.err.buy_unavailable',
  invalid_currency: 'realmOp.err.invalid_currency',
  invalid_tier: 'realmOp.err.invalid_tier',
  price_unavailable: 'realmOp.err.price_unavailable',
  payment_already_recorded: 'realmOp.err.payment_already_recorded',
  bad_signature: 'realmOp.err.bad_signature',
  legs_collide: 'realmOp.err.legs_collide',
  not_finalized: 'realmOp.err.not_finalized',
  memo_mismatch: 'realmOp.err.memo_mismatch',
  treasury_short: 'realmOp.err.treasury_short',
  buyback_short: 'realmOp.err.buyback_short',
  // Ongoing $WOC bond (buy path): the buyer's wallet does not currently hold the
  // tier's bond. The buy() catch renders this with the bond amount spliced in; the
  // mapping here keeps it covered and gives messageForError a (placeholder) fallback.
  bond_required: 'realmOp.err.bond_required',
  'link a wallet first': 'realmOp.err.link_wallet',
  'too many requests, slow down': 'realmOp.err.rate_limited',
} satisfies Record<string, TranslationKey>;

// Map any thrown failure to one user-facing line. ApiError carries the server
// `error` code/text; the wallet flow throws Error with copy main.ts already
// localized, so that message is shown verbatim. Everything else is generic.
export function messageForError(err: unknown): string {
  if (err instanceof ApiError) {
    const key = (ERR_KEYS as Record<string, TranslationKey>)[err.message];
    if (key) return t(key);
    return t('realmOp.err.generic');
  }
  if (err instanceof Error && err.message === 'wallet_mismatch') return t('realmOp.err.wallet_mismatch');
  if (err instanceof Error && err.message) return err.message;
  return t('realmOp.err.generic');
}

// Whole-token display of a base-unit amount. Whale-tier stakes are large round
// integers, so the fractional part is display noise. BigInt division reduces the
// base-unit string to whole tokens without overflow; realistic $WOC supplies keep
// the result well within Number range for formatNumber's locale grouping.
export function formatTokens(amountBase: string, decimals: number): string {
  const whole = BigInt(amountBase) / 10n ** BigInt(decimals);
  return formatNumber(Number(whole));
}

// Fractional display of a currency amount for the buy path. Unlike a whale-tier
// $WOC stake (formatTokens floors to whole tokens), a SOL/USDC price needs its
// fractional part shown. Realistic realm prices stay well within Number range, so
// scaling the base-unit string by the currency decimals before formatNumber is
// exact enough for display; formatNumber applies locale grouping + min/max
// fraction digits (capped at the mint's own precision).
export function formatAmount(amountBase: string, decimals: number): string {
  const value = Number(BigInt(amountBase)) / 10 ** decimals;
  return formatNumber(value, { maximumFractionDigits: Math.min(decimals, 6) });
}

export class RealmOperator {
  private readonly root: HTMLElement;
  private readonly host: RealmOperatorHost;

  private tiersInfo: RealmTiersInfo | null = null;
  private selectedTier: RealmTierOption | null = null;
  private owned: OwnedRealm[] = [];
  private confirmingId: number | null = null; // realm pending a decommission confirm
  private busy = false;

  // Buy-with-SOL/USDC path (#475). The price list loads alongside the stake tiers;
  // `buyInfo` stays null when the server reports buying is unconfigured (HTTP 503),
  // in which case the method toggle hides the buy option entirely.
  private payMethod: PayMethod = 'stake';
  private buyInfo: RealmBuyInfo | null = null;
  private buyAvailable = false; // false until realmBuyInfo() succeeds with a usable price list
  private selectedCurrency: BuyCurrency = 'USDC';

  // Cached element refs (set in render()).
  private nameInput!: HTMLInputElement;
  private typeSelect!: HTMLSelectElement;
  private methodBox!: HTMLElement;
  private currencyField!: HTMLElement;
  private currencyBox!: HTMLElement;
  private tiersBox!: HTMLElement;
  private stakeNote!: HTMLElement;
  private buyNote!: HTMLElement;
  private submitBtn!: HTMLButtonElement;
  private statusEl!: HTMLElement;
  private mineList!: HTMLElement;
  private mineStatus!: HTMLElement;

  constructor(root: HTMLElement, host: RealmOperatorHost) {
    this.root = root;
    this.host = host;
  }

  // Enter the panel: rebuild the form fresh (so labels track the current
  // language and no stale input lingers) and load tiers + owned realms.
  async open(): Promise<void> {
    this.tiersInfo = null;
    this.selectedTier = null;
    this.confirmingId = null;
    this.busy = false;
    this.owned = [];
    this.payMethod = 'stake';
    this.buyInfo = null;
    this.buyAvailable = false;
    this.selectedCurrency = 'USDC';
    this.render();
    await Promise.all([this.loadTiers(), this.loadBuyInfo(), this.loadOwned()]);
  }

  private get timelockDays(): number {
    return Math.max(1, Math.round((this.tiersInfo?.timelockSeconds ?? 259_200) / 86_400));
  }

  private render(): void {
    const opt = (ty: RealmType) => `<option value="${ty}">${esc(t(TYPE_LABEL[ty]))}</option>`;
    this.root.innerHTML = `
      <div class="ro">
        <section class="ro-found" aria-labelledby="ro-found-h">
          <h3 id="ro-found-h" class="ro-h">${esc(t('realmOp.found.title'))}</h3>
          <p class="ro-sub">${esc(t('realmOp.found.subtitle'))}</p>
          ${this.host.affiliateCode() ? `<p class="ro-aff-note">${esc(t('realmOp.found.affiliateNote'))}</p>` : ''}
          <div class="ro-field">
            <label class="ro-label" for="ro-name">${esc(t('realmOp.found.nameLabel'))}</label>
            <input id="ro-name" class="ro-input" type="text" maxlength="24" autocomplete="off"
              spellcheck="false" placeholder="${esc(t('realmOp.found.namePlaceholder'))}" />
          </div>
          <div class="ro-field">
            <label class="ro-label" for="ro-type">${esc(t('realmOp.found.typeLabel'))}</label>
            <select id="ro-type" class="ro-input ro-select">
              ${opt('Normal')}${opt('PvP')}${opt('RP')}${opt('RP-PvP')}
            </select>
          </div>
          <div class="ro-field">
            <span class="ro-label" id="ro-method-label">${esc(t('realmOp.found.methodLabel'))}</span>
            <div id="ro-method" class="ro-method" role="group" aria-labelledby="ro-method-label"></div>
            <p id="ro-method-hint" class="ro-hint"></p>
          </div>
          <div id="ro-currency-field" class="ro-field" hidden>
            <span class="ro-label" id="ro-currency-label">${esc(t('realmOp.buy.currencyLabel'))}</span>
            <div id="ro-currency" class="ro-method" role="group" aria-labelledby="ro-currency-label"></div>
          </div>
          <div class="ro-field">
            <span class="ro-label" id="ro-tier-label">${esc(t('realmOp.found.tierLabel'))}</span>
            <div id="ro-tiers" class="ro-tiers" role="group" aria-labelledby="ro-tier-label">
              <p class="ro-hint">${esc(t('realmOp.mine.loading'))}</p>
            </div>
            <p class="ro-hint">${esc(t('realmOp.found.tierHint'))}</p>
            <p class="ro-hint ro-hint-muted">${esc(t('realmOp.found.supplyNote'))}</p>
            <p class="ro-hint ro-hint-badge">${esc(t('realmOp.found.badgeNote'))}</p>
          </div>
          <p id="ro-stake-note" class="ro-stake-note"></p>
          <div id="ro-buy-note" class="ro-buy-note" hidden></div>
          <button id="ro-submit" class="btn btn-primary ro-submit" type="button" disabled>
            ${esc(t('realmOp.found.submit'))}
          </button>
          <p id="ro-status" class="ro-status" role="status" aria-live="polite"></p>
        </section>
        <section class="ro-mine" aria-labelledby="ro-mine-h">
          <h3 id="ro-mine-h" class="ro-h">${esc(t('realmOp.mine.title'))}</h3>
          <div id="ro-mine-list" class="ro-mine-list">
            <p class="ro-hint">${esc(t('realmOp.mine.loading'))}</p>
          </div>
          <p id="ro-mine-status" class="ro-status" role="status" aria-live="polite"></p>
        </section>
      </div>`;

    this.nameInput = this.root.querySelector('#ro-name') as HTMLInputElement;
    this.typeSelect = this.root.querySelector('#ro-type') as HTMLSelectElement;
    this.methodBox = this.root.querySelector('#ro-method') as HTMLElement;
    this.currencyField = this.root.querySelector('#ro-currency-field') as HTMLElement;
    this.currencyBox = this.root.querySelector('#ro-currency') as HTMLElement;
    this.tiersBox = this.root.querySelector('#ro-tiers') as HTMLElement;
    this.stakeNote = this.root.querySelector('#ro-stake-note') as HTMLElement;
    this.buyNote = this.root.querySelector('#ro-buy-note') as HTMLElement;
    this.submitBtn = this.root.querySelector('#ro-submit') as HTMLButtonElement;
    this.statusEl = this.root.querySelector('#ro-status') as HTMLElement;
    this.mineList = this.root.querySelector('#ro-mine-list') as HTMLElement;
    this.mineStatus = this.root.querySelector('#ro-mine-status') as HTMLElement;

    this.nameInput.addEventListener('input', () => {
      this.setStatus('', 'info');
      this.updateSubmit();
    });
    this.submitBtn.addEventListener('click', () => void this.found());
    this.mineList.addEventListener('click', (e) => this.onMineClick(e));
    this.renderMethod();
    this.updateSubmit();
  }

  private async loadTiers(): Promise<void> {
    try {
      this.tiersInfo = await this.host.api.realmTiers();
    } catch (err) {
      this.tiersBox.innerHTML = `<p class="ro-hint ro-hint-muted">${esc(t('realmOp.found.tiersUnavailable'))}</p>`;
      this.setStatus(messageForError(err), 'error');
      return;
    }
    this.renderTiers();
  }

  // Load the buy price list. A 503 (buy_unavailable) or any failure leaves
  // buyAvailable false, so the method toggle simply omits the buy option and the
  // stake flow is untouched. An empty currency/tier list is treated the same way.
  private async loadBuyInfo(): Promise<void> {
    let info: RealmBuyInfo | null = null;
    try {
      info = await this.host.api.realmBuyInfo();
    } catch {
      info = null;
    }
    if (!info || info.currencies.length === 0 || info.tiers.length === 0) {
      this.buyInfo = null;
      this.buyAvailable = false;
    } else {
      this.buyInfo = info;
      this.buyAvailable = true;
      // Default to USDC when it has a route, else the first priced currency.
      const usable = info.currencies.find((c) => this.currencyHasAnyPrice(c.key));
      if (usable) this.selectedCurrency = usable.key;
    }
    this.renderMethod();
    if (this.payMethod === 'buy') this.renderTiers();
  }

  // The radio-style payment-method toggle (always shows stake; shows buy only when
  // the server priced it). Re-rendered whenever buy availability changes.
  private renderMethod(): void {
    const tab = (method: PayMethod, label: TranslationKey) => {
      const on = this.payMethod === method;
      return `<button class="ro-method-tab" type="button" role="radio" aria-checked="${on ? 'true' : 'false'}"
        data-method="${method}">${esc(t(label))}</button>`;
    };
    let html = tab('stake', 'realmOp.found.methodStake');
    if (this.buyAvailable) html += tab('buy', 'realmOp.found.methodBuy');
    this.methodBox.innerHTML = html;
    for (const btn of Array.from(this.methodBox.querySelectorAll<HTMLButtonElement>('.ro-method-tab'))) {
      btn.classList.toggle('ro-method-on', btn.dataset.method === this.payMethod);
      btn.addEventListener('click', () => this.selectMethod(btn.dataset.method as PayMethod));
    }
    const hint = this.root.querySelector('#ro-method-hint') as HTMLElement | null;
    if (hint) hint.textContent = t(this.payMethod === 'buy' ? 'realmOp.found.methodBuyHint' : 'realmOp.found.methodStakeHint');
    this.renderCurrencies();
  }

  // Switch payment method: re-price the tier picker, swap the notes, keep the
  // currently selected tier (the same 1/2/3 picks apply to both paths).
  private selectMethod(method: PayMethod): void {
    if (method === 'buy' && !this.buyAvailable) return;
    if (method === this.payMethod) return;
    this.payMethod = method;
    this.renderMethod();
    this.renderTiers();
    this.setStatus('', 'info');
    this.updateSubmit();
  }

  // The SOL / USDC toggle, only shown on the buy path. A currency with no DEX route
  // (null price at every tier) is rendered disabled.
  private renderCurrencies(): void {
    const info = this.buyInfo;
    const show = this.payMethod === 'buy' && this.buyAvailable && info !== null;
    this.currencyField.hidden = !show;
    if (!show || !info) {
      this.currencyBox.innerHTML = '';
      return;
    }
    this.currencyBox.innerHTML = info.currencies
      .map((c) => {
        const on = this.selectedCurrency === c.key;
        const priced = this.currencyHasAnyPrice(c.key);
        const label = t(c.key === 'SOL' ? 'realmOp.buy.currencySol' : 'realmOp.buy.currencyUsdc');
        return `<button class="ro-method-tab" type="button" role="radio" aria-checked="${on ? 'true' : 'false'}"
          data-currency="${esc(c.key)}"${priced ? '' : ' disabled'}>${esc(label)}</button>`;
      })
      .join('');
    for (const btn of Array.from(this.currencyBox.querySelectorAll<HTMLButtonElement>('.ro-method-tab'))) {
      btn.classList.toggle('ro-method-on', btn.dataset.currency === this.selectedCurrency);
      btn.addEventListener('click', () => this.selectCurrency(btn.dataset.currency as BuyCurrency));
    }
  }

  private selectCurrency(currency: BuyCurrency): void {
    if (currency === this.selectedCurrency) return;
    if (!this.currencyHasAnyPrice(currency)) return;
    this.selectedCurrency = currency;
    this.renderCurrencies();
    this.renderTiers();
    this.setStatus('', 'info');
    this.updateSubmit();
  }

  // True when the buy price list has a non-null price for this currency at any tier.
  private currencyHasAnyPrice(currency: BuyCurrency): boolean {
    return this.buyInfo?.tiers.some((tier) => tier.prices[currency] !== null) ?? false;
  }

  private buyTierFor(tierNum: number): RealmBuyTierOption | null {
    return this.buyInfo?.tiers.find((x) => x.tier === tierNum) ?? null;
  }

  // The decimals of the currently selected buy currency, for formatting prices.
  private currencyDecimals(): number {
    return this.buyInfo?.currencies.find((c) => c.key === this.selectedCurrency)?.decimals ?? 0;
  }

  private renderTiers(): void {
    const info = this.tiersInfo;
    if (!info) return;
    const buying = this.payMethod === 'buy' && this.buyAvailable && this.buyInfo !== null;
    const decimals = this.currencyDecimals();
    this.tiersBox.innerHTML = info.tiers
      .map((tier) => {
        let cost: string;
        if (buying) {
          const price = this.buyTierFor(tier.tier)?.prices[this.selectedCurrency] ?? null;
          cost = price === null
            ? t('realmOp.tier.priceUnavailable')
            : t('realmOp.tier.price', { amount: formatAmount(price, decimals), currency: this.selectedCurrency });
        } else {
          cost = t('realmOp.tier.cost', { amount: formatTokens(tier.amountBase, info.decimals) });
        }
        const share = t('realmOp.tier.share', { pct: formatNumber(tier.bps / 100) });
        const unbuyable = buying && (this.buyTierFor(tier.tier)?.prices[this.selectedCurrency] ?? null) === null;
        return `
          <button class="ro-tier" type="button" aria-pressed="false" data-tier="${tier.tier}"${unbuyable ? ' disabled' : ''}>
            <span class="ro-tier-name">${esc(t(TIER_LABEL[tier.name]))}</span>
            <span class="ro-tier-cost">${esc(cost)}</span>
            <span class="ro-tier-share">${esc(share)}</span>
          </button>`;
      })
      .join('');
    for (const btn of Array.from(this.tiersBox.querySelectorAll<HTMLButtonElement>('.ro-tier'))) {
      btn.addEventListener('click', () => this.selectTier(Number(btn.dataset.tier)));
    }
    // Re-applying the highlight + note keeps the picked tier visible across a
    // method/currency swap; clear it if the pick is no longer buyable.
    if (this.selectedTier) {
      const stillValid = !buying
        || (this.buyTierFor(this.selectedTier.tier)?.prices[this.selectedCurrency] ?? null) !== null;
      if (stillValid) this.applyTierSelection(this.selectedTier.tier);
      else this.clearTierSelection();
    } else {
      this.refreshTierNote();
    }
  }

  private selectTier(tierNum: number): void {
    const info = this.tiersInfo;
    if (!info) return;
    this.selectedTier = info.tiers.find((x) => x.tier === tierNum) ?? null;
    this.applyTierSelection(tierNum);
    this.setStatus('', 'info');
    this.updateSubmit();
  }

  // Paint the selected-tier highlight and the matching stake/buy note.
  private applyTierSelection(tierNum: number): void {
    for (const btn of Array.from(this.tiersBox.querySelectorAll<HTMLButtonElement>('.ro-tier'))) {
      const on = Number(btn.dataset.tier) === tierNum;
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      btn.classList.toggle('ro-tier-on', on);
    }
    this.refreshTierNote();
  }

  private clearTierSelection(): void {
    this.selectedTier = null;
    for (const btn of Array.from(this.tiersBox.querySelectorAll<HTMLButtonElement>('.ro-tier'))) {
      btn.setAttribute('aria-pressed', 'false');
      btn.classList.remove('ro-tier-on');
    }
    this.refreshTierNote();
    this.updateSubmit();
  }

  // Swap the stake note / buy note (split + final-purchase warning) to match the
  // current method and the selected tier.
  private refreshTierNote(): void {
    const buying = this.payMethod === 'buy' && this.buyAvailable && this.buyInfo !== null;
    const tiersInfo = this.tiersInfo;
    this.stakeNote.hidden = buying;
    this.buyNote.hidden = !buying;
    if (buying && this.buyInfo) {
      this.buyNote.innerHTML = this.buyNoteHtml();
    } else if (this.selectedTier && tiersInfo) {
      this.stakeNote.textContent = t('realmOp.found.stakingNote', {
        amount: formatTokens(this.selectedTier.amountBase, tiersInfo.decimals),
        days: this.timelockDays,
      });
    } else {
      this.stakeNote.textContent = '';
    }
  }

  // The buy-path explainer: the per-tier payment line (when a tier is picked), the
  // treasury/buyback split, the ongoing $WOC bond (when bonds are enabled), and the
  // final/non-refundable warning.
  private buyNoteHtml(): string {
    const info = this.buyInfo;
    if (!info) return '';
    const lines: string[] = [];
    const tier = this.selectedTier ? this.buyTierFor(this.selectedTier.tier) : null;
    const price = tier?.prices[this.selectedCurrency] ?? null;
    if (price !== null) {
      const amount = formatAmount(price, this.currencyDecimals());
      lines.push(`<p class="ro-buy-line">${esc(t('realmOp.buy.note', { amount, currency: this.selectedCurrency }))}</p>`);
    }
    const split = t('realmOp.buy.splitNote', { treasuryPct: formatNumber(info.treasuryBps / 100) });
    lines.push(`<p class="ro-buy-line ro-hint-muted">${esc(split)}</p>`);
    // The ongoing $WOC bond, kept visually distinct from the one-time SOL/USDC price
    // so a buyer reads it as a held requirement, not part of the payment. Only when
    // bonds are enabled (bondBps > 0) and a tier is picked, so the amount is concrete.
    if (info.bondBps > 0 && tier) {
      const bond = formatTokens(tier.bondBase, info.wocDecimals);
      lines.push(`<p class="ro-buy-line ro-buy-bond">${esc(t('realmOp.buy.bondNote', { amount: bond }))}</p>`);
      lines.push(`<p class="ro-buy-line ro-buy-bond ro-hint-muted">${esc(t('realmOp.buy.bondWhy', { currency: this.selectedCurrency }))}</p>`);
    }
    lines.push(`<p class="ro-buy-line ro-buy-final">${esc(t('realmOp.buy.finalNote'))}</p>`);
    return lines.join('');
  }

  private updateSubmit(): void {
    const linked = this.host.linkedWallet() !== null;
    const buying = this.payMethod === 'buy' && this.buyAvailable && this.buyInfo !== null;
    // The buy path also needs the selected tier to be priced in the chosen currency.
    const tierOk = this.selectedTier !== null
      && (!buying || (this.buyTierFor(this.selectedTier.tier)?.prices[this.selectedCurrency] ?? null) !== null);
    const ready = !this.busy && this.nameInput.value.trim().length > 0 && tierOk;
    this.submitBtn.disabled = !ready;
    const submitKey: TranslationKey = buying
      ? (linked ? 'realmOp.buy.submit' : 'realmOp.buy.submitConnect')
      : (linked ? 'realmOp.found.submit' : 'realmOp.found.submitConnect');
    this.submitBtn.textContent = this.busy ? t('realmOp.flow.quoting') : t(submitKey);
    this.nameInput.disabled = this.busy;
    this.typeSelect.disabled = this.busy;
  }

  private setStatus(text: string, kind: 'info' | 'error' | 'success'): void {
    this.statusEl.textContent = text;
    this.statusEl.className = `ro-status ro-status-${kind}`;
  }

  private setBusy(b: boolean): void {
    this.busy = b;
    this.updateSubmit();
  }

  // The founding flow: ensure a verified wallet, reserve a quote, settle the
  // payment on chain (stake lock or SOL/USDC split), then confirm. Each step
  // surfaces its own status line; a thrown failure (or a cancelled wallet prompt)
  // stops the flow cleanly. Dispatches by the selected payment method.
  private async found(): Promise<void> {
    const name = this.nameInput.value.trim();
    const tier = this.selectedTier;
    if (!name || !tier || this.busy) return;
    if (this.payMethod === 'buy' && this.buyAvailable) {
      await this.buy(name, tier);
      return;
    }
    this.setBusy(true);
    try {
      this.setStatus(t('realmOp.flow.connecting'), 'info');
      const wallet = await this.host.ensureWalletReady();
      if (!wallet) return; // cancelled at the wallet prompt

      this.setStatus(t('realmOp.flow.quoting'), 'info');
      const type = (this.typeSelect.value as RealmType) || 'Normal';
      const quote = await this.host.api.quoteRealm(name, type, tier.amountBase, this.host.affiliateCode() ?? undefined);

      this.setStatus(t('realmOp.flow.locking'), 'info');
      const lockSig = await this.host.signLock(quote);
      if (!lockSig) return; // cancelled in the wallet

      this.setStatus(t('realmOp.flow.confirming'), 'info');
      await this.host.api.confirmRealm(quote.quoteId, lockSig);

      this.setStatus(t('realmOp.flow.founded', { name: quote.name }), 'success');
      this.nameInput.value = '';
      await this.loadOwned();
    } catch (err) {
      this.setStatus(messageForError(err), 'error');
    } finally {
      this.setBusy(false);
    }
  }

  // The buy flow: ensure a verified wallet, reserve a buy quote in the chosen
  // currency, pay the SOL/USDC split on chain, then confirm. Mirrors the stake
  // flow step for step (and carries the same affiliate code), but pays once rather
  // than locking a recoverable stake.
  private async buy(name: string, tier: RealmTierOption): Promise<void> {
    this.setBusy(true);
    try {
      this.setStatus(t('realmOp.flow.connecting'), 'info');
      const wallet = await this.host.ensureWalletReady();
      if (!wallet) return; // cancelled at the wallet prompt

      this.setStatus(t('realmOp.flow.quoting'), 'info');
      const type = (this.typeSelect.value as RealmType) || 'Normal';
      const quote = await this.host.api.quoteRealmBuy(
        name,
        type,
        tier.tier,
        this.selectedCurrency,
        this.host.affiliateCode() ?? undefined,
      );

      this.setStatus(t('realmOp.flow.paying'), 'info');
      const paySig = await this.host.signPurchase(quote);
      if (!paySig) return; // cancelled in the wallet

      this.setStatus(t('realmOp.flow.confirmingBuy'), 'info');
      await this.host.api.confirmRealmBuy(quote.quoteId, paySig);

      this.setStatus(t('realmOp.flow.founded', { name: quote.name }), 'success');
      this.nameInput.value = '';
      await this.loadOwned();
    } catch (err) {
      this.setStatus(this.buyErrorMessage(err, tier), 'error');
    } finally {
      this.setBusy(false);
    }
  }

  // Buy-path error copy: the only buy error that needs a value spliced in is
  // bond_required (the wallet does not hold the tier's ongoing $WOC bond), which the
  // generic messageForError cannot fill. Render it with the picked tier's bond
  // amount; everything else falls through to the shared mapping.
  private buyErrorMessage(err: unknown, tier: RealmTierOption): string {
    if (err instanceof ApiError && err.message === 'bond_required' && this.buyInfo) {
      const buyTier = this.buyTierFor(tier.tier);
      if (buyTier) {
        return t('realmOp.err.bond_required', {
          amount: formatTokens(buyTier.bondBase, this.buyInfo.wocDecimals),
        });
      }
    }
    return messageForError(err);
  }

  private async loadOwned(): Promise<void> {
    try {
      this.owned = await this.host.api.myRealms();
    } catch {
      this.owned = [];
      this.mineList.innerHTML = `<p class="ro-hint ro-hint-muted">${esc(t('realmOp.err.generic'))}</p>`;
      return;
    }
    this.renderOwned();
  }

  private renderOwned(): void {
    if (this.owned.length === 0) {
      this.mineList.innerHTML = `<p class="ro-empty">${esc(t('realmOp.mine.empty'))}</p>`;
      return;
    }
    this.mineList.innerHTML = this.owned.map((r) => this.ownedRowHtml(r)).join('');
  }

  private ownedRowHtml(r: OwnedRealm): string {
    const statusKey = STATUS_LABEL[r.status] ?? 'realmOp.status.active';
    const meta = `${esc(t(TYPE_LABEL[r.type]))} &middot; ${esc(t('realmOp.mine.tier', { tier: tierWord(r.tier) }))}`;
    const confirming = this.confirmingId === r.realmId;

    let extra = '';
    if (r.status === 'decommissioning') {
      const when = r.releaseEligibleAt
        ? t('realmOp.mine.eligible', { date: formatDateTime(new Date(r.releaseEligibleAt)) })
        : '';
      extra = `<p class="ro-realm-note">${esc(when)}</p>
        <p class="ro-realm-note ro-hint-muted">${esc(t('realmOp.mine.releaseHint'))}</p>`;
    }
    extra += this.bondNoteHtml(r);

    let actions = '';
    if (confirming) {
      actions = `
        <p class="ro-realm-note">${esc(t('realmOp.mine.decommissionConfirm', { name: r.name, days: this.timelockDays }))}</p>
        <div class="ro-realm-actions">
          <button class="btn btn-secondary ro-act" data-act="cancel" data-id="${r.realmId}" type="button">${esc(t('realmOp.back'))}</button>
          <button class="btn btn-danger ro-act" data-act="decommission" data-id="${r.realmId}" type="button">${esc(t('realmOp.mine.decommission'))}</button>
        </div>`;
    } else {
      const buttons: string[] = [];
      if (r.status === 'active' && r.url) {
        buttons.push(`<button class="btn btn-secondary ro-act" data-act="enter" data-id="${r.realmId}" type="button">${esc(t('realmOp.mine.enter'))}</button>`);
      }
      if (r.status === 'active') {
        buttons.push(`<button class="btn btn-secondary ro-act" data-act="confirm" data-id="${r.realmId}" type="button">${esc(t('realmOp.mine.decommission'))}</button>`);
      }
      if (r.status === 'decommissioning') {
        buttons.push(`<button class="btn btn-primary ro-act" data-act="finalize" data-id="${r.realmId}" type="button">${esc(t('realmOp.mine.release'))}</button>`);
      }
      actions = buttons.length ? `<div class="ro-realm-actions">${buttons.join('')}</div>` : '';
    }

    return `
      <div class="ro-realm" data-realm-id="${r.realmId}">
        <div class="ro-realm-head">
          <span class="ro-realm-name">${esc(r.name)}</span>
          <span class="ro-badge ro-badge-${esc(r.status)}">${esc(t(statusKey))}</span>
        </div>
        <div class="ro-realm-meta">${meta}</div>
        ${extra}
        ${actions}
      </div>`;
  }

  // The bond row for an owned bought realm. A realm with bondGraceUntil set is BELOW
  // its bond right now: show a prominent warning with the top-up deadline. A bonded
  // realm in good standing gets a calm, subtle info line. Staked realms (no bondBase)
  // render nothing. $WOC decimals come from the buy info or the stake-tier info, which
  // describe the same $WOC mint as the bond.
  private bondNoteHtml(r: OwnedRealm): string {
    if (r.bondBase == null) return '';
    const decimals = this.buyInfo?.wocDecimals ?? this.tiersInfo?.decimals;
    if (decimals == null) return '';
    const amount = formatTokens(r.bondBase, decimals);
    if (r.bondGraceUntil) {
      const date = formatDateTime(new Date(r.bondGraceUntil));
      return `<p class="ro-realm-note ro-realm-bond-warn" role="alert">${esc(t('realmOp.mine.bondWarning', { amount, date }))}</p>`;
    }
    return `<p class="ro-realm-note ro-hint-muted">${esc(t('realmOp.mine.bondInfo', { amount }))}</p>`;
  }

  private onMineClick(e: Event): void {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('.ro-act');
    if (!btn) return;
    const id = Number(btn.dataset.id);
    const realm = this.owned.find((r) => r.realmId === id);
    if (!realm) return;
    switch (btn.dataset.act) {
      case 'enter':
        this.host.enterRealm(realm);
        return;
      case 'confirm':
        this.confirmingId = id;
        this.renderOwned();
        return;
      case 'cancel':
        this.confirmingId = null;
        this.renderOwned();
        return;
      case 'decommission':
        void this.decommission(realm);
        return;
      case 'finalize':
        void this.finalize(realm);
        return;
    }
  }

  private async decommission(realm: OwnedRealm): Promise<void> {
    this.confirmingId = null;
    this.setMineStatus(t('realmOp.flow.decommissioning'), 'info');
    try {
      // A BOUGHT realm has no recoverable stake: the server closes it immediately
      // and returns closed:true, so it drops out of the list with no on-chain
      // release/finalize step. A staked realm enters the decommissioning timelock
      // and surfaces the finalize-close path via loadOwned() as before.
      const res = await this.host.api.decommissionRealm(realm.realmId);
      await this.loadOwned();
      this.setMineStatus(res.closed === true ? t('realmOp.flow.closed') : '', res.closed === true ? 'success' : 'info');
    } catch (err) {
      this.setMineStatus(messageForError(err), 'error');
    }
  }

  private async finalize(realm: OwnedRealm): Promise<void> {
    this.setMineStatus(t('realmOp.flow.releasing'), 'info');
    try {
      await this.host.api.releaseRealm(realm.realmId);
      await this.loadOwned();
      this.setMineStatus(t('realmOp.flow.released'), 'success');
    } catch (err) {
      this.setMineStatus(messageForError(err), 'error');
    }
  }

  private setMineStatus(text: string, kind: 'info' | 'error' | 'success'): void {
    this.mineStatus.textContent = text;
    this.mineStatus.className = `ro-status ro-status-${kind}`;
  }
}

// Map a numeric tier (0..3) to its display word for the "{tier} tier" line.
export function tierWord(tier: number): string {
  const name = (['', 'bronze', 'silver', 'gold'][tier] ?? '') as '' | RealmTierOption['name'];
  return name ? t(TIER_LABEL[name]) : formatNumber(tier);
}
