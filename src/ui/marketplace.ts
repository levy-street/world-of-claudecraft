// Creator Skins Marketplace overlay — a self-contained dialog that lists the
// live creator skins and buys + equips one. Pure presentation: like the rest of
// src/ui/ it never imports net/ or the concrete world; it talks to the app
// through MarketplaceHooks wired by main.ts (mirroring the HUD's ReportHooks /
// OptionsHooks seam). The actual quote -> sign -> buy -> equip orchestration
// lives behind hooks.purchase, since it spans net + wallet + world.
import { t, formatNumber } from './i18n';
import type { CreatorSkinRegistryEntry } from '../world_api';

export interface MarketplaceHooks {
  // The live creator skins (public registry metadata).
  listSkins(): Promise<CreatorSkinRegistryEntry[]>;
  // Whether a Solana wallet is currently connected (the payer).
  isWalletConnected(): boolean;
  // Open the wallet-connect modal; resolves once the modal is dismissed.
  connectWallet(): Promise<void>;
  // Buy + equip a skin end-to-end (quote -> sign+send split tx -> verify -> equip).
  // Throws with a human-readable message on failure.
  purchase(skin: CreatorSkinRegistryEntry): Promise<void>;
}

let hooks: MarketplaceHooks | null = null;
let overlay: HTMLDivElement | null = null;

export function attachMarketplace(h: MarketplaceHooks): void {
  hooks = h;
}

export function marketplaceAttached(): boolean {
  return hooks !== null;
}

// Local HTML escaper — skin names/descriptions are creator UGC and must never be
// interpolated raw (mirrors hud.ts's private esc).
function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// USDC base units (6 decimals) -> a localized currency string, e.g. "$10.00".
function formatUsdc(baseUnits: string): string {
  const n = Number(baseUnits) / 1_000_000;
  return formatNumber(Number.isFinite(n) ? n : 0, { style: 'currency', currency: 'USD' });
}

function close(): void {
  if (!overlay) return;
  overlay.classList.remove('open');
  overlay.style.display = 'none';
}

function ensureOverlay(): HTMLDivElement {
  if (overlay) return overlay;
  const el = document.createElement('div');
  el.id = 'creator-marketplace';
  el.className = 'skin-event-overlay'; // reuse the cosmetic-overlay backdrop styling
  el.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  el.addEventListener('mousedown', (e) => { if (e.target === el) close(); });
  document.body.appendChild(el);
  overlay = el;
  return el;
}

function statusEl(card: HTMLElement): HTMLElement {
  return card.querySelector('.market-card-status') as HTMLElement;
}

async function onBuy(skin: CreatorSkinRegistryEntry, card: HTMLElement, button: HTMLButtonElement): Promise<void> {
  if (!hooks) return;
  const status = statusEl(card);
  button.disabled = true;
  try {
    if (!hooks.isWalletConnected()) {
      status.textContent = t('marketplace.connectFirst');
      await hooks.connectWallet();
      if (!hooks.isWalletConnected()) { button.disabled = false; return; }
    }
    status.textContent = t('marketplace.purchasing');
    await hooks.purchase(skin);
    status.textContent = t('marketplace.owned');
    button.textContent = t('marketplace.owned');
    // leave the button disabled — the skin is now owned + equipped
  } catch (err) {
    const detail = err instanceof Error && err.message ? `: ${err.message}` : '';
    status.textContent = `${t('marketplace.failed')}${detail}`.slice(0, 120);
    button.disabled = false;
  }
}

function renderSkins(body: HTMLElement, skins: CreatorSkinRegistryEntry[]): void {
  body.innerHTML = '';
  if (skins.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'market-empty';
    empty.textContent = t('marketplace.empty');
    body.appendChild(empty);
    return;
  }
  for (const skin of skins) {
    const card = document.createElement('div');
    card.className = 'market-card';
    card.innerHTML =
      `<div class="market-card-name">${esc(skin.name)}</div>` +
      (skin.description ? `<div class="market-card-desc">${esc(skin.description)}</div>` : '') +
      `<div class="market-card-price">${esc(formatUsdc(skin.priceUsdc))}</div>` +
      `<div class="market-card-status" role="status" aria-live="polite"></div>`;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn market-buy-btn';
    button.textContent = t('marketplace.buy');
    button.setAttribute('aria-label', `${t('marketplace.buy')} ${skin.name} — ${formatUsdc(skin.priceUsdc)}`);
    button.addEventListener('click', () => { void onBuy(skin, card, button); });
    card.appendChild(button);
    body.appendChild(card);
  }
}

/** Open (and populate) the marketplace overlay. No-op until attachMarketplace
 *  has wired the app hooks (i.e. only online). */
export async function openMarketplace(): Promise<void> {
  if (!hooks) return;
  const el = ensureOverlay();
  const title = esc(t('marketplace.title'));
  el.innerHTML =
    `<div class="panel market-panel" role="dialog" aria-modal="true" aria-label="${title}">` +
    `<div class="panel-title"><span>${title}</span>` +
    `<button type="button" class="x-btn" data-close aria-label="${esc(t('marketplace.close'))}">×</button></div>` +
    `<div class="market-subtitle">${esc(t('marketplace.subtitle'))}</div>` +
    `<div class="market-body">${esc(t('marketplace.loading'))}</div>` +
    `</div>`;
  el.style.display = 'flex';
  el.classList.add('open');
  el.querySelector('[data-close]')?.addEventListener('click', () => close());
  const body = el.querySelector('.market-body') as HTMLElement;

  const skins = await hooks.listSkins();
  // The user may have closed the overlay while the registry was loading.
  if (el.style.display === 'none') return;
  renderSkins(body, skins);
}
