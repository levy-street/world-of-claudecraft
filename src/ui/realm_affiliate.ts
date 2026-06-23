// Affiliate program panel (#475): a salesperson's shareable affiliate link plus
// the realms they have referred. Sharing the link and getting someone to found a
// realm through it earns the affiliate a commission (default 15%) of that realm's
// revenue, paid in USDC out of the operator's share when the in-realm revenue
// rails land (#477). Self-contained, like realm_operator: it renders into a
// host-provided container and reaches the server only through the injected Api.

import { t, formatNumber } from './i18n';
import { esc } from './esc';
import type { Api, AffiliateRealm } from '../net/online';
import { TYPE_LABEL, STATUS_LABEL, tierWord } from './realm_operator';

export interface RealmAffiliateHost {
  api: Api;
  // The page origin used to build the shareable link (e.g. https://site).
  origin(): string;
  close(): void;
}

export class RealmAffiliate {
  private readonly root: HTMLElement;
  private readonly host: RealmAffiliateHost;
  private code = '';
  private realms: AffiliateRealm[] = [];

  constructor(root: HTMLElement, host: RealmAffiliateHost) {
    this.root = root;
    this.host = host;
  }

  async open(): Promise<void> {
    this.code = '';
    this.realms = [];
    this.root.innerHTML = `<p class="ro-hint">${esc(t('realmOp.affiliate.loading'))}</p>`;
    try {
      const [info, realms] = await Promise.all([this.host.api.affiliateInfo(), this.host.api.affiliateRealms()]);
      this.code = info.code;
      this.realms = realms;
    } catch {
      this.root.innerHTML = `<p class="ro-hint ro-hint-muted">${esc(t('realmOp.affiliate.unavailable'))}</p>`;
      return;
    }
    this.render();
  }

  private get link(): string {
    return `${this.host.origin()}/?aff=${encodeURIComponent(this.code)}`;
  }

  private render(): void {
    const count = this.realms.length;
    const countLine = count === 1
      ? t('realmOp.affiliate.referredCount', { count: formatNumber(1) })
      : t('realmOp.affiliate.referredCountPlural', { count: formatNumber(count) });

    this.root.innerHTML = `
      <div class="ro">
        <section class="ro-found" aria-labelledby="ra-h">
          <h3 id="ra-h" class="ro-h">${esc(t('realmOp.affiliate.title'))}</h3>
          <p class="ro-sub">${esc(t('realmOp.affiliate.subtitle'))}</p>
          <div class="ro-field">
            <label class="ro-label" for="ra-link">${esc(t('realmOp.affiliate.yourLink'))}</label>
            <div class="ra-link-row">
              <input id="ra-link" class="ro-input ra-link" type="text" readonly value="${esc(this.link)}" />
              <button id="ra-copy" class="btn btn-secondary ra-copy" type="button">${esc(t('realmOp.affiliate.copy'))}</button>
            </div>
          </div>
          <p class="ro-hint ro-hint-badge">${esc(t('realmOp.affiliate.earningsSoon'))}</p>
        </section>
        <section class="ro-mine" aria-labelledby="ra-mine-h">
          <h3 id="ra-mine-h" class="ro-h">${esc(t('realmOp.affiliate.referredTitle'))}</h3>
          <p class="ro-hint">${esc(countLine)}</p>
          <div class="ro-mine-list">${count === 0
            ? `<p class="ro-empty">${esc(t('realmOp.affiliate.empty'))}</p>`
            : this.realms.map((r) => this.realmRowHtml(r)).join('')}</div>
        </section>
      </div>`;

    const copyBtn = this.root.querySelector('#ra-copy') as HTMLButtonElement;
    copyBtn.addEventListener('click', () => void this.copyLink(copyBtn));
  }

  private realmRowHtml(r: AffiliateRealm): string {
    const statusKey = STATUS_LABEL[r.status] ?? 'realmOp.status.active';
    const meta = `${esc(t(TYPE_LABEL[r.type]))} &middot; ${esc(t('realmOp.mine.tier', { tier: tierWord(r.tier) }))} &middot; ${esc(t('realmOp.affiliate.commission', { pct: formatNumber(r.bps / 100) }))}`;
    return `
      <div class="ro-realm">
        <div class="ro-realm-head">
          <span class="ro-realm-name">${esc(r.name)}</span>
          <span class="ro-badge ro-badge-${esc(r.status)}">${esc(t(statusKey))}</span>
        </div>
        <div class="ro-realm-meta">${meta}</div>
      </div>`;
  }

  private async copyLink(btn: HTMLButtonElement): Promise<void> {
    const input = this.root.querySelector('#ra-link') as HTMLInputElement | null;
    try {
      await navigator.clipboard.writeText(this.link);
    } catch {
      // Clipboard API unavailable (insecure context / permission): fall back to
      // selecting the field so the player can copy manually.
      if (input) { input.focus(); input.select(); }
      return;
    }
    const prev = btn.textContent;
    btn.textContent = t('realmOp.affiliate.copied');
    window.setTimeout(() => { btn.textContent = prev; }, 1500);
  }
}

// Re-exported so a test can build the same link string the panel renders.
export function affiliateLink(origin: string, code: string): string {
  return `${origin}/?aff=${encodeURIComponent(code)}`;
}
