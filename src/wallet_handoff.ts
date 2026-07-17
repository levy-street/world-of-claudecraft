import './wallet_handoff.css';
import { walletHandoffCodeFromHash } from './net/desktop_wallet_handoff';
import {
  browserWalletOptions,
  connectBrowserWallet,
  onBrowserWalletRegistered,
} from './net/wallet_handoff_browser';
import { ensureLocaleLoaded, getLanguage, languageTag, t } from './ui/i18n';
import { authorizeWalletHandoff, type WalletHandoffClaim } from './wallet_handoff_authorization';
import { replaceWalletHandoffContent } from './wallet_handoff_focus';

const root = document.querySelector<HTMLElement>('#wallet-handoff-root');
const code = walletHandoffCodeFromHash(location.hash);
let claim: WalletHandoffClaim | null = null;
let busy = false;

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

async function post<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : 'request failed');
  return data as T;
}

function renderError(message = t('wallet.browser.failed')): void {
  if (!root) return;
  replaceWalletHandoffContent(
    root,
    `<div class="wallet-handoff-card">` +
      `<img class="wallet-handoff-logo" src="/woc_logo_square.webp" alt="">` +
      `<h1>${escapeHtml(t('wallet.browser.title'))}</h1>` +
      `<p role="alert">${escapeHtml(message)}</p>` +
      `<button type="button" data-retry>${escapeHtml(t('wallet.browser.retry'))}</button>` +
      `</div>`,
    { focusSelector: '[data-retry]' },
  );
  root.querySelector('[data-retry]')?.addEventListener('click', () => location.reload());
}

function renderWallets(): void {
  if (!root || !claim) return;
  const wallets = browserWalletOptions(claim.kind);
  const buttons = wallets
    .map(
      (wallet) =>
        `<button type="button" class="wallet-handoff-option" data-wallet="${escapeHtml(wallet.id)}">` +
        `<img src="${escapeHtml(wallet.icon)}" alt="">` +
        `<span>${escapeHtml(t('wallet.browser.continueWith', { wallet: wallet.name }))}</span>` +
        `</button>`,
    )
    .join('');
  replaceWalletHandoffContent(
    root,
    `<div class="wallet-handoff-card">` +
      `<img class="wallet-handoff-logo" src="/woc_logo_square.webp" alt="">` +
      `<p class="wallet-handoff-eyebrow">${escapeHtml(t('wallet.browser.eyebrow'))}</p>` +
      `<h1>${escapeHtml(t('wallet.browser.title'))}</h1>` +
      `<p>${escapeHtml(
        claim.kind === 'link' ? t('wallet.browser.linkBody') : t('wallet.browser.paymentBody'),
      )}</p>` +
      `<div class="wallet-handoff-options">${buttons}</div>` +
      (wallets.length === 0
        ? `<p class="wallet-handoff-help">${escapeHtml(t('wallet.browser.extensionHelp'))}</p>`
        : '') +
      `<p class="wallet-handoff-safety">${escapeHtml(t('wallet.browser.safety'))}</p>` +
      `</div>`,
    { preserveWalletFocus: true },
  );
  for (const button of root.querySelectorAll<HTMLButtonElement>('[data-wallet]')) {
    button.addEventListener('click', () => void authorize(button.dataset.wallet ?? ''));
  }
}

function renderBusy(wallet: string): void {
  if (!root) return;
  replaceWalletHandoffContent(
    root,
    `<div class="wallet-handoff-card">` +
      `<span class="wallet-handoff-spinner" aria-hidden="true"></span>` +
      `<h1 tabindex="-1" data-wallet-handoff-status>${escapeHtml(t('wallet.browser.reviewTitle'))}</h1>` +
      `<p>${escapeHtml(t('wallet.browser.reviewBody', { wallet }))}</p>` +
      `</div>`,
    { focusSelector: '[data-wallet-handoff-status]' },
  );
}

function renderComplete(): void {
  if (!root || !code) return;
  const returnUrl = `worldofclaudecraft://wallet-handoff?code=${encodeURIComponent(code)}`;
  replaceWalletHandoffContent(
    root,
    `<div class="wallet-handoff-card">` +
      `<img class="wallet-handoff-logo" src="/woc_logo_square.webp" alt="">` +
      `<h1 tabindex="-1" data-wallet-handoff-complete>${escapeHtml(t('wallet.browser.completeTitle'))}</h1>` +
      `<p>${escapeHtml(t('wallet.browser.completeBody'))}</p>` +
      `<a class="wallet-handoff-return" href="${returnUrl}">${escapeHtml(t('wallet.browser.returnButton'))}</a>` +
      `</div>`,
    { focusSelector: '[data-wallet-handoff-complete]' },
  );
  location.href = returnUrl;
}

async function authorize(walletId: string): Promise<void> {
  if (!code || !claim || busy) return;
  busy = true;
  const option = browserWalletOptions(claim.kind).find((wallet) => wallet.id === walletId);
  renderBusy(option?.name ?? walletId);
  try {
    const wallet = await connectBrowserWallet(walletId, claim.kind);
    await authorizeWalletHandoff({ code, claim, wallet, post });
    renderComplete();
  } catch (error) {
    console.error('[wallet-handoff] authorization failed', error);
    busy = false;
    renderError();
  }
}

async function boot(): Promise<void> {
  try {
    await ensureLocaleLoaded(getLanguage());
  } catch {
    // English remains the synchronous fallback when a locale chunk is unavailable.
  }
  document.documentElement.lang = languageTag(getLanguage());
  document.title = t('wallet.browser.eyebrow');
  if (!root || !code) return renderError();
  try {
    claim = await post<WalletHandoffClaim>('/api/desktop-wallet/claim', { code });
    renderWallets();
    onBrowserWalletRegistered(() => {
      if (!busy) renderWallets();
    });
  } catch (error) {
    console.error('[wallet-handoff] could not load authorization', error);
    renderError();
  }
}

void boot();
