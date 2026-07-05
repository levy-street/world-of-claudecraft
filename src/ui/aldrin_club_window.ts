// Aldrin Club membership modal (PR #938): the thin DOM consumer of the pure
// aldrin_club_view core, a self-contained modal the HUD composes (it does not
// live in hud.ts). Boundary-clean like nft_skins_window in the NFT-PFP branch:
// it imports only the ui surface (t/esc/focus/dialog helpers) and takes the
// network actions as an injected deps object, so it never reaches into src/net
// (main.ts wires the Api closures).
//
// Deliberately read-only on this branch: the wallet link is signMessage-only
// here, so there is NO transaction path and none is faked. An available method
// shows its server quote (amount, the treasury/buyback-burn split, memo, expiry
// as static text) plus a localized notice that payment rails stay off pending
// operator keys and sign-off. Fail-closed: attachAldrinClubEntry adds its HUD
// entry only after GET /api/aldrin reports the feature enabled (the route 404s
// while ALDRIN_ENABLED is off, the default).

import {
  type AldrinMethodId,
  type AldrinMethodModel,
  type AldrinMethodReason,
  type AldrinQuoteInput,
  type AldrinStatusInput,
  buildAldrinClubModel,
} from './aldrin_club_view';
import { markDialogRoot } from './dialog_root';
import { esc } from './esc';
import { FocusManager } from './focus_manager';
import { formatDateTime, formatNumber, t } from './i18n';

export interface AldrinClubWindowDeps {
  /** GET /api/aldrin; resolve null when the feature is disabled (404) or unreachable. */
  status(): Promise<AldrinStatusInput | null>;
  /** POST /api/aldrin/quote for a crypto rail; rejects when the rail is refused. */
  quote(method: AldrinMethodId): Promise<AldrinQuoteInput>;
  /** False on this branch: the wallet link signs messages only, never transactions. */
  walletCanSignTransactions: boolean;
  onClose?(): void;
}

function methodLabel(method: AldrinMethodId): string {
  switch (method) {
    case 'sol':
      return t('hudChrome.aldrin.method.sol');
    case 'usdc':
      return t('hudChrome.aldrin.method.usdc');
    case 'woc':
      return t('hudChrome.aldrin.method.woc');
    case 'stripe':
      return t('hudChrome.aldrin.method.stripe');
  }
}

function reasonText(reason: AldrinMethodReason): string {
  switch (reason) {
    case 'clubDisabled':
      return t('hudChrome.aldrin.reason.clubDisabled');
    case 'walletCannotSign':
      return t('hudChrome.aldrin.reason.walletCannotSign');
    case 'notConfigured':
      return t('hudChrome.aldrin.reason.notConfigured');
  }
}

// Known perk ids map to their catalog keys; an unknown id (a future server-side
// perk this client predates) is skipped rather than rendered untranslated.
function perkLabel(id: string): string | null {
  switch (id) {
    case 'aura':
      return t('hudChrome.aldrin.perk.aura');
    case 'regalia':
      return t('hudChrome.aldrin.perk.regalia');
    case 'mount':
      return t('hudChrome.aldrin.perk.mount');
    case 'title':
      return t('hudChrome.aldrin.perk.title');
    case 'nameColor':
      return t('hudChrome.aldrin.perk.nameColor');
    case 'lounge':
      return t('hudChrome.aldrin.perk.lounge');
    case 'wardrobe':
      return t('hudChrome.aldrin.perk.wardrobe');
    case 'queue':
      return t('hudChrome.aldrin.perk.queue');
    case 'stipend':
      return t('hudChrome.aldrin.perk.stipend');
    default:
      return null;
  }
}

const pct = (n: number): string => formatNumber(n, { maximumFractionDigits: 0 });

/** Open the Aldrin Club membership modal. Resolves when the modal is closed. */
export async function openAldrinClubWindow(deps: AldrinClubWindowDeps): Promise<void> {
  let status: AldrinStatusInput | null = null;
  try {
    status = await deps.status();
  } catch {
    status = null;
  }
  let quote: AldrinQuoteInput | null = null;
  let quoteError = false;
  let quoteLoading: AldrinMethodId | null = null;

  const overlay = document.createElement('div');
  overlay.className = 'aldrin-club-overlay';
  overlay.style.cssText =
    'position:fixed;inset:0;z-index:9000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.6);';

  const panel = document.createElement('div');
  panel.className = 'panel aldrin-club-panel';
  markDialogRoot(panel, { label: t('hudChrome.aldrin.title'), modal: true });
  panel.style.cssText =
    'width:100%;max-width:560px;max-height:86vh;overflow:auto;border-radius:10px;padding:20px;';
  overlay.appendChild(panel);

  const focusManager = new FocusManager();
  const focusTrap = focusManager.open({ root: () => panel });

  function stripeAdvertised(): boolean {
    return !!status?.methods.includes('stripe');
  }

  function model() {
    return buildAldrinClubModel({
      status,
      quote,
      walletCanSignTransactions: deps.walletCanSignTransactions,
      stripeEnabled: stripeAdvertised(),
      nowMs: Date.now(),
    });
  }

  function membershipHtml(m: ReturnType<typeof model>): string {
    if (!m.enabled) {
      return `<p class="aldrin-unavailable" style="opacity:0.85">${esc(t('hudChrome.aldrin.unavailable'))}</p>`;
    }
    if (m.member && m.memberUntilISO) {
      const line = t('hudChrome.aldrin.memberUntil', {
        date: formatDateTime(new Date(m.memberUntilISO), { dateStyle: 'medium' }),
        days: formatNumber(m.memberDaysRemaining, { useGrouping: false }),
      });
      const renew = m.autoRenew
        ? `<div style="font-size:13px;opacity:0.8">${esc(t('hudChrome.aldrin.autoRenew'))}</div>`
        : '';
      return `<div class="aldrin-member" style="margin:8px 0">
        <span class="aldrin-member-badge" style="display:inline-block;padding:2px 10px;border:1px solid var(--gold-dim);border-radius:10px;color:var(--gold);font-weight:600">${esc(t('hudChrome.aldrin.memberBadge'))}</span>
        <div style="margin-top:6px">${esc(line)}</div>${renew}
      </div>`;
    }
    return `<p class="aldrin-not-member" style="margin:8px 0">${esc(t('hudChrome.aldrin.notMember'))}</p>`;
  }

  function quoteHtml(m: ReturnType<typeof model>): string {
    if (quoteLoading) {
      return `<p class="aldrin-quote-loading" style="opacity:0.8">${esc(t('hudChrome.aldrin.loading'))}</p>`;
    }
    if (quoteError) {
      return `<p class="aldrin-quote-error" style="color:var(--color-text-error)">${esc(t('hudChrome.aldrin.quoteError'))}</p>`;
    }
    const q = m.quote;
    if (!q) return '';
    const amount = formatNumber(q.amountUnits, { maximumFractionDigits: Math.min(q.decimals, 6) });
    const expiry = q.expired
      ? t('hudChrome.aldrin.quoteExpired')
      : t('hudChrome.aldrin.quoteExpires', {
          minutes: formatNumber(Math.max(1, Math.ceil(q.expiresInSeconds / 60)), {
            useGrouping: false,
          }),
        });
    return `<div class="aldrin-quote" style="margin-top:12px;padding:12px;border:1px solid var(--panel-edge);border-radius:8px">
      <h3 style="margin:0 0 6px;font-size:15px;color:var(--gold)">${esc(t('hudChrome.aldrin.quoteTitle', { method: methodLabel(q.method) }))}</h3>
      <div>${esc(t('hudChrome.aldrin.quoteAmount', { amount, method: methodLabel(q.method) }))}</div>
      <div style="font-size:13px;opacity:0.85;margin-top:4px">${esc(
        t('hudChrome.aldrin.splitLine', {
          treasuryPct: pct(q.treasuryPct),
          burnPct: pct(q.burnPct),
        }),
      )}</div>
      <div style="font-size:13px;margin-top:4px;word-break:break-all">${esc(t('hudChrome.aldrin.quoteMemo', { memo: q.memo }))}</div>
      <div style="font-size:13px;opacity:0.85;margin-top:4px">${esc(expiry)}</div>
    </div>`;
  }

  function methodsHtml(methods: AldrinMethodModel[]): string {
    const rows = methods
      .map((mm) => {
        const reason = mm.reason
          ? `<div class="aldrin-method-reason" style="font-size:12px;opacity:0.7;margin-top:4px">${esc(reasonText(mm.reason))}</div>`
          : '';
        return `<div class="aldrin-method" style="flex:1;min-width:120px">
        <button type="button" class="btn aldrin-method-btn" data-method="${esc(mm.method)}"${mm.available ? '' : ' disabled'}
          style="width:100%;min-height:40px">${esc(methodLabel(mm.method))}</button>${reason}
      </div>`;
      })
      .join('');
    return `<div class="aldrin-methods" style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-start;margin:8px 0">${rows}</div>`;
  }

  function render(): void {
    const m = model();
    const perkItems = m.perks
      .map((p) => perkLabel(p.id))
      .filter((label): label is string => label !== null)
      .map((label) => `<li>${esc(label)}</li>`)
      .join('');
    const body = m.enabled
      ? `
      <p style="font-size:13px;opacity:0.85;line-height:1.5">${esc(t('hudChrome.aldrin.intro'))}</p>
      ${membershipHtml(m)}
      <div class="aldrin-price" style="margin:8px 0;font-weight:600">${esc(
        t('hudChrome.aldrin.priceLine', {
          amount: formatNumber(m.priceUsdCents / 100, { maximumFractionDigits: 2 }),
          days: formatNumber(m.periodDays, { useGrouping: false }),
        }),
      )}</div>
      <div style="font-size:13px;opacity:0.85">${esc(
        t('hudChrome.aldrin.splitLine', {
          treasuryPct: pct(m.treasuryPct),
          burnPct: pct(m.burnPct),
        }),
      )}</div>
      <h3 style="font-size:15px;margin:14px 0 4px;color:var(--gold)">${esc(t('hudChrome.aldrin.perksTitle'))}</h3>
      <ul class="aldrin-perks" style="margin:4px 0 0;padding-left:20px;font-size:13px;line-height:1.6">${perkItems}</ul>
      <h3 style="font-size:15px;margin:14px 0 4px;color:var(--gold)">${esc(t('hudChrome.aldrin.methodsTitle'))}</h3>
      ${methodsHtml(m.methods)}
      <p class="aldrin-rails-notice" style="font-size:13px;opacity:0.85;border:1px solid var(--panel-edge);border-radius:8px;padding:10px;line-height:1.5">${esc(t('hudChrome.aldrin.railsNotice'))}</p>
      <div class="aldrin-quote-slot">${quoteHtml(m)}</div>`
      : membershipHtml(m);

    panel.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px">
        <h2 style="margin:0;font-size:20px;color:var(--gold)">${esc(t('hudChrome.aldrin.title'))}</h2>
        <button class="x-btn aldrin-close-btn" type="button" data-close aria-label="${esc(t('hudChrome.aldrin.close'))}"
          style="min-height:40px;min-width:40px">&times;</button>
      </div>
      ${body}
    `;
    wire();
  }

  function wire(): void {
    panel.querySelector<HTMLButtonElement>('.aldrin-close-btn')?.addEventListener('click', close);
    for (const btn of panel.querySelectorAll<HTMLButtonElement>('.aldrin-method-btn')) {
      btn.addEventListener('click', () => {
        const method = btn.dataset.method as AldrinMethodId | undefined;
        if (!method) return;
        if (method === 'stripe') {
          // No checkout wiring in this build; the quote slot carries the notice.
          const slot = panel.querySelector<HTMLElement>('.aldrin-quote-slot');
          if (slot)
            slot.innerHTML = `<p class="aldrin-stripe-notice" style="font-size:13px;opacity:0.85;margin-top:12px">${esc(t('hudChrome.aldrin.stripeNotice'))}</p>`;
          return;
        }
        void fetchQuote(method);
      });
    }
  }

  async function fetchQuote(method: AldrinMethodId): Promise<void> {
    quoteLoading = method;
    quoteError = false;
    quote = null;
    render();
    try {
      quote = await deps.quote(method);
    } catch {
      quoteError = true;
    } finally {
      quoteLoading = null;
    }
    if (overlay.isConnected) render();
  }

  function close(): void {
    overlay.removeEventListener('keydown', onKey);
    overlay.remove();
    focusTrap.release(true);
    deps.onClose?.();
  }
  function onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') close();
  }
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });
  overlay.addEventListener('keydown', onKey);

  render();
  document.body.appendChild(overlay);
  focusTrap.focusFirst();
}

/**
 * Fail-closed HUD entry: probe GET /api/aldrin once and add a community-tray
 * button only when the server advertises the feature. While disabled (the
 * default) the entry never appears, so the club is invisible to players.
 */
export async function attachAldrinClubEntry(deps: AldrinClubWindowDeps): Promise<void> {
  let status: AldrinStatusInput | null = null;
  try {
    status = await deps.status();
  } catch {
    status = null;
  }
  if (!status?.enabled) return;
  const tray = document.querySelector<HTMLElement>('#community-menu .community-tray');
  if (!tray || tray.querySelector('.aldrin-club-entry')) return;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'community-link aldrin-club-entry';
  const label = t('hudChrome.aldrin.entryLabel');
  btn.title = label;
  btn.setAttribute('aria-label', label);
  btn.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2l2.4 4.9 5.4.8-3.9 3.8.9 5.4-4.8-2.5-4.8 2.5.9-5.4L4.2 7.7l5.4-.8L12 2zm-7 17h14v2H5v-2z"/></svg><span>${esc(label)}</span>`;
  btn.addEventListener('click', () => {
    void openAldrinClubWindow(deps);
  });
  tray.appendChild(btn);
}
