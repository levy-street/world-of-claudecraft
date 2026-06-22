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
  RealmTierOption,
  RealmTiersInfo,
  RealmType,
} from '../net/online';

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
  // Enter a realm the operator owns (reuses the realm-list selection flow).
  enterRealm(realm: OwnedRealm): void;
  // Close the panel (return to the realm list).
  close(): void;
}

const TYPE_LABEL: Record<RealmType, TranslationKey> = {
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

const STATUS_LABEL: Record<string, TranslationKey> = {
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

export class RealmOperator {
  private readonly root: HTMLElement;
  private readonly host: RealmOperatorHost;

  private tiersInfo: RealmTiersInfo | null = null;
  private selectedTier: RealmTierOption | null = null;
  private owned: OwnedRealm[] = [];
  private confirmingId: number | null = null; // realm pending a decommission confirm
  private busy = false;

  // Cached element refs (set in render()).
  private nameInput!: HTMLInputElement;
  private typeSelect!: HTMLSelectElement;
  private tiersBox!: HTMLElement;
  private stakeNote!: HTMLElement;
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
    this.render();
    await Promise.all([this.loadTiers(), this.loadOwned()]);
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
            <span class="ro-label" id="ro-tier-label">${esc(t('realmOp.found.tierLabel'))}</span>
            <div id="ro-tiers" class="ro-tiers" role="group" aria-labelledby="ro-tier-label">
              <p class="ro-hint">${esc(t('realmOp.mine.loading'))}</p>
            </div>
            <p class="ro-hint">${esc(t('realmOp.found.tierHint'))}</p>
            <p class="ro-hint ro-hint-muted">${esc(t('realmOp.found.supplyNote'))}</p>
          </div>
          <p id="ro-stake-note" class="ro-stake-note"></p>
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
    this.tiersBox = this.root.querySelector('#ro-tiers') as HTMLElement;
    this.stakeNote = this.root.querySelector('#ro-stake-note') as HTMLElement;
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

  private renderTiers(): void {
    const info = this.tiersInfo;
    if (!info) return;
    this.tiersBox.innerHTML = info.tiers
      .map((tier) => {
        const cost = t('realmOp.tier.cost', { amount: formatTokens(tier.amountBase, info.decimals) });
        const share = t('realmOp.tier.share', { pct: formatNumber(tier.bps / 100) });
        return `
          <button class="ro-tier" type="button" aria-pressed="false" data-tier="${tier.tier}">
            <span class="ro-tier-name">${esc(t(TIER_LABEL[tier.name]))}</span>
            <span class="ro-tier-cost">${esc(cost)}</span>
            <span class="ro-tier-share">${esc(share)}</span>
          </button>`;
      })
      .join('');
    for (const btn of Array.from(this.tiersBox.querySelectorAll<HTMLButtonElement>('.ro-tier'))) {
      btn.addEventListener('click', () => this.selectTier(Number(btn.dataset.tier)));
    }
  }

  private selectTier(tierNum: number): void {
    const info = this.tiersInfo;
    if (!info) return;
    this.selectedTier = info.tiers.find((x) => x.tier === tierNum) ?? null;
    for (const btn of Array.from(this.tiersBox.querySelectorAll<HTMLButtonElement>('.ro-tier'))) {
      const on = Number(btn.dataset.tier) === tierNum;
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      btn.classList.toggle('ro-tier-on', on);
    }
    if (this.selectedTier) {
      this.stakeNote.textContent = t('realmOp.found.stakingNote', {
        amount: formatTokens(this.selectedTier.amountBase, info.decimals),
        days: this.timelockDays,
      });
    }
    this.setStatus('', 'info');
    this.updateSubmit();
  }

  private updateSubmit(): void {
    const linked = this.host.linkedWallet() !== null;
    const ready = !this.busy && this.nameInput.value.trim().length > 0 && this.selectedTier !== null;
    this.submitBtn.disabled = !ready;
    this.submitBtn.textContent = this.busy
      ? t('realmOp.flow.quoting')
      : linked
        ? t('realmOp.found.submit')
        : t('realmOp.found.submitConnect');
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

  // The founding flow: ensure a verified wallet, reserve a quote, lock the stake
  // on chain, then confirm. Each step surfaces its own status line; a thrown
  // failure (or a cancelled wallet prompt) stops the flow cleanly.
  private async found(): Promise<void> {
    const name = this.nameInput.value.trim();
    const tier = this.selectedTier;
    if (!name || !tier || this.busy) return;
    this.setBusy(true);
    try {
      this.setStatus(t('realmOp.flow.connecting'), 'info');
      const wallet = await this.host.ensureWalletReady();
      if (!wallet) return; // cancelled at the wallet prompt

      this.setStatus(t('realmOp.flow.quoting'), 'info');
      const type = (this.typeSelect.value as RealmType) || 'Normal';
      const quote = await this.host.api.quoteRealm(name, type, tier.amountBase);

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
      await this.host.api.decommissionRealm(realm.realmId);
      await this.loadOwned();
      this.setMineStatus('', 'info');
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
