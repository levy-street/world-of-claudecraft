// Creator Skins Marketplace overlay — a two-sided storefront:
//   • Browse: a card grid of live creator skins with procedural preview swatches,
//     creator attribution, price, and a Buy / Equip / Equipped action.
//   • Create & Sell: an in-browser designer (recolour + pattern + glow) that lists
//     a procedural skin for sale — no file upload; the design IS the asset.
// Pure presentation: like the rest of src/ui/ it never imports net/ or the
// concrete world; world/wallet actions go through MarketplaceHooks wired by
// main.ts. It DOES use the renderer's procedural skin builder (render/characters)
// for previews — the same path hud.ts uses for CharacterPreview — since that is
// presentation, not world state.
import { t, formatNumber } from './i18n';
import {
  type CreatorSkinRegistryEntry, type SkinDesignSpec, type SkinPattern,
  SKIN_PATTERNS, defaultDesignSpec,
} from '../world_api';
import { designSwatchDataUrl } from '../render/characters/skin_design';

export interface MarketplaceListing {
  name: string;
  description: string;
  priceUsdc: string; // USDC base units (6 decimals) as a string
  design: SkinDesignSpec;
  targetClass: string | null;
}

export interface MarketplaceHooks {
  // The live creator skins (public registry metadata).
  listSkins(): Promise<CreatorSkinRegistryEntry[]>;
  // Creator-skin ids the player already owns (the equip allow-list, client view).
  ownedSkinIds(): string[];
  // Whether a Solana wallet is currently connected (the payer / payout dest).
  isWalletConnected(): boolean;
  // Open the wallet-connect modal; resolves once dismissed.
  connectWallet(): Promise<void>;
  // Buy + equip a skin end-to-end (quote -> sign+send split tx -> verify -> equip).
  // Throws with a human-readable message on failure.
  purchase(skin: CreatorSkinRegistryEntry): Promise<void>;
  // Equip an already-owned skin (server re-validates ownership).
  equip(skin: CreatorSkinRegistryEntry): void;
  // List a freshly-designed skin for sale (instant-live). Throws on failure.
  createListing(listing: MarketplaceListing): Promise<void>;
}

let hooks: MarketplaceHooks | null = null;
let overlay: HTMLDivElement | null = null;
let activeTab: 'browse' | 'create' = 'browse';
let design: SkinDesignSpec = defaultDesignSpec();

export function attachMarketplace(h: MarketplaceHooks): void {
  hooks = h;
}

export function marketplaceAttached(): boolean {
  return hooks !== null;
}

// Local HTML escaper — skin names/descriptions/creator labels are UGC and must
// never be interpolated raw (mirrors hud.ts's private esc).
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

function patternLabel(p: SkinPattern): string {
  return t(`marketplace.patterns.${p}` as 'marketplace.patterns.solid');
}

// ---------------------------------------------------------------------------
// Browse tab
// ---------------------------------------------------------------------------

function thumbSrc(skin: CreatorSkinRegistryEntry): string {
  if (skin.design) return designSwatchDataUrl(skin.design, 120);
  if (skin.assetUrl && skin.assetUrl !== 'procedural') return skin.assetUrl;
  return '';
}

function renderBrowse(content: HTMLElement, skins: CreatorSkinRegistryEntry[]): void {
  content.innerHTML =
    `<div class="market-browse">` +
    `<input type="text" class="market-search" aria-label="${esc(t('marketplace.search'))}" placeholder="${esc(t('marketplace.search'))}">` +
    `<div class="market-grid" role="list"></div>` +
    `</div>`;
  const grid = content.querySelector('.market-grid') as HTMLElement;
  const search = content.querySelector('.market-search') as HTMLInputElement;

  const draw = (filter: string): void => {
    const owned = new Set(hooks?.ownedSkinIds() ?? []);
    const q = filter.trim().toLowerCase();
    const shown = skins.filter((s) => !q || s.name.toLowerCase().includes(q) || s.creator.toLowerCase().includes(q));
    grid.innerHTML = '';
    if (shown.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'market-empty';
      empty.textContent = skins.length === 0 ? t('marketplace.empty') : t('marketplace.noResults');
      grid.appendChild(empty);
      return;
    }
    for (const skin of shown) grid.appendChild(buildCard(skin, owned.has(skin.id)));
  };

  search.addEventListener('input', () => draw(search.value));
  draw('');
}

function buildCard(skin: CreatorSkinRegistryEntry, isOwned: boolean): HTMLElement {
  const card = document.createElement('div');
  card.className = 'market-card';
  card.setAttribute('role', 'listitem');
  const src = thumbSrc(skin);
  const klass = skin.targetClass ? esc(skin.targetClass) : esc(t('marketplace.anyClass'));
  card.innerHTML =
    `<div class="market-thumb-wrap">${src ? `<img class="market-thumb" src="${esc(src)}" alt="" draggable="false">` : `<div class="market-thumb market-thumb-empty"></div>`}` +
    (isOwned ? `<span class="market-owned-badge">${esc(t('marketplace.ownedBadge'))}</span>` : '') +
    `</div>` +
    `<div class="market-card-name">${esc(skin.name)}</div>` +
    `<div class="market-card-meta"><span class="market-card-creator">${esc(t('marketplace.by', { creator: skin.creator }))}</span>` +
    `<span class="market-class-badge">${klass}</span></div>` +
    (skin.description ? `<div class="market-card-desc">${esc(skin.description)}</div>` : '') +
    `<div class="market-card-price">${esc(formatUsdc(skin.priceUsdc))}</div>` +
    `<div class="market-card-status" role="status" aria-live="polite"></div>`;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn market-buy-btn';
  if (isOwned) {
    button.textContent = t('marketplace.equip');
    button.setAttribute('aria-label', `${t('marketplace.equip')} ${skin.name}`);
    button.addEventListener('click', () => onEquip(skin, card, button));
  } else {
    button.textContent = t('marketplace.buy');
    button.setAttribute('aria-label', `${t('marketplace.buy')} ${skin.name} — ${formatUsdc(skin.priceUsdc)}`);
    button.addEventListener('click', () => { void onBuy(skin, card, button); });
  }
  card.appendChild(button);
  return card;
}

function statusEl(card: HTMLElement): HTMLElement {
  return card.querySelector('.market-card-status') as HTMLElement;
}

function onEquip(skin: CreatorSkinRegistryEntry, card: HTMLElement, button: HTMLButtonElement): void {
  if (!hooks) return;
  try {
    hooks.equip(skin);
    statusEl(card).textContent = t('marketplace.equipped');
    button.textContent = t('marketplace.equipped');
  } catch {
    statusEl(card).textContent = t('marketplace.equipFailed');
  }
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
    button.textContent = t('marketplace.equipped');
    button.disabled = false;
    // future clicks just re-equip the now-owned skin
    button.replaceWith(button); // no-op keeps reference; handler below
    button.onclick = () => onEquip(skin, card, button);
  } catch (err) {
    const detail = err instanceof Error && err.message ? `: ${err.message}` : '';
    status.textContent = `${t('marketplace.failed')}${detail}`.slice(0, 140);
    button.disabled = false;
  }
}

// ---------------------------------------------------------------------------
// Create & Sell tab (in-browser designer)
// ---------------------------------------------------------------------------

function renderCreate(content: HTMLElement): void {
  const patternOpts = SKIN_PATTERNS
    .map((p) => `<option value="${p}"${p === design.pattern ? ' selected' : ''}>${esc(patternLabel(p))}</option>`)
    .join('');
  content.innerHTML =
    `<div class="market-create">` +
    `<div class="market-design">` +
    `<div class="market-preview"><img class="market-preview-swatch" alt=""><div class="market-preview-label">${esc(t('marketplace.preview'))}</div></div>` +
    `<div class="market-controls">` +
    `<p class="market-design-intro">${esc(t('marketplace.designIntro'))}</p>` +
    `<label class="market-field"><span>${esc(t('marketplace.baseColor'))}</span><input type="color" class="d-primary" value="${design.primary}"></label>` +
    `<label class="market-field"><span>${esc(t('marketplace.patternColor'))}</span><input type="color" class="d-secondary" value="${design.secondary}"></label>` +
    `<label class="market-field"><span>${esc(t('marketplace.pattern'))}</span><select class="d-pattern">${patternOpts}</select></label>` +
    `<label class="market-field market-check"><input type="checkbox" class="d-glow-on"${design.emissive ? ' checked' : ''}><span>${esc(t('marketplace.glow'))}</span></label>` +
    `<label class="market-field d-glow-color-field"><span>${esc(t('marketplace.glowColor'))}</span><input type="color" class="d-glow" value="${design.emissive ?? '#39ff88'}"></label>` +
    `<button type="button" class="btn market-randomize">${esc(t('marketplace.randomize'))}</button>` +
    `</div></div>` +
    `<div class="market-listform">` +
    `<label class="market-field market-field-col"><span>${esc(t('marketplace.nameLabel'))}</span><input type="text" class="d-name" maxlength="40" placeholder="${esc(t('marketplace.namePlaceholder'))}"></label>` +
    `<label class="market-field market-field-col"><span>${esc(t('marketplace.descLabel'))}</span><input type="text" class="d-desc" maxlength="200" placeholder="${esc(t('marketplace.descPlaceholder'))}"></label>` +
    `<label class="market-field market-field-col"><span>${esc(t('marketplace.priceLabel'))}</span><input type="number" class="d-price" min="0.5" step="0.5" value="10"></label>` +
    `<div class="market-payout-hint">${esc(t('marketplace.payoutHint'))}</div>` +
    `<div class="market-card-status market-list-status" role="status" aria-live="polite"></div>` +
    `<button type="button" class="btn market-list-btn">${esc(t('marketplace.list'))}</button>` +
    `</div></div>`;

  const swatch = content.querySelector('.market-preview-swatch') as HTMLImageElement;
  const primary = content.querySelector('.d-primary') as HTMLInputElement;
  const secondary = content.querySelector('.d-secondary') as HTMLInputElement;
  const pattern = content.querySelector('.d-pattern') as HTMLSelectElement;
  const glowOn = content.querySelector('.d-glow-on') as HTMLInputElement;
  const glow = content.querySelector('.d-glow') as HTMLInputElement;
  const glowField = content.querySelector('.d-glow-color-field') as HTMLElement;
  const status = content.querySelector('.market-list-status') as HTMLElement;
  const listBtn = content.querySelector('.market-list-btn') as HTMLButtonElement;

  const sync = (): void => {
    design = {
      primary: primary.value,
      secondary: secondary.value,
      pattern: pattern.value as SkinPattern,
      emissive: glowOn.checked ? glow.value : null,
    };
    glowField.style.display = glowOn.checked ? '' : 'none';
    swatch.src = designSwatchDataUrl(design, 240);
  };
  for (const el of [primary, secondary, pattern, glowOn, glow]) el.addEventListener('input', sync);

  content.querySelector('.market-randomize')?.addEventListener('click', () => {
    const rndHex = (): string => '#' + Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0');
    primary.value = rndHex();
    secondary.value = rndHex();
    pattern.value = SKIN_PATTERNS[Math.floor(Math.random() * SKIN_PATTERNS.length)];
    sync();
  });

  listBtn.addEventListener('click', () => { void onList(content, status, listBtn); });
  sync();
}

async function onList(content: HTMLElement, status: HTMLElement, button: HTMLButtonElement): Promise<void> {
  if (!hooks) return;
  const name = (content.querySelector('.d-name') as HTMLInputElement).value.trim();
  const description = (content.querySelector('.d-desc') as HTMLInputElement).value.trim();
  const dollars = Number((content.querySelector('.d-price') as HTMLInputElement).value);
  if (!name) { status.textContent = t('marketplace.nameLabel'); return; }
  const priceUsdc = String(Math.max(0, Math.round((Number.isFinite(dollars) ? dollars : 0) * 1_000_000)));
  button.disabled = true;
  try {
    if (!hooks.isWalletConnected()) {
      status.textContent = t('marketplace.listConnectFirst');
      await hooks.connectWallet();
      if (!hooks.isWalletConnected()) { button.disabled = false; return; }
    }
    status.textContent = t('marketplace.listing');
    await hooks.createListing({ name, description, priceUsdc, design, targetClass: null });
    status.textContent = t('marketplace.listed');
  } catch (err) {
    const detail = err instanceof Error && err.message ? `: ${err.message}` : '';
    status.textContent = `${t('marketplace.listFailed')}${detail}`.slice(0, 140);
  } finally {
    button.disabled = false;
  }
}

// ---------------------------------------------------------------------------
// Shell + tabs
// ---------------------------------------------------------------------------

function setTab(tab: 'browse' | 'create', content: HTMLElement, skins: CreatorSkinRegistryEntry[]): void {
  activeTab = tab;
  overlay?.querySelectorAll('.market-tab').forEach((b) => {
    const el = b as HTMLElement;
    const on = el.dataset.tab === tab;
    el.classList.toggle('sel', on);
    el.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  if (tab === 'browse') renderBrowse(content, skins);
  else renderCreate(content);
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
    `<div class="market-tabs" role="tablist">` +
    `<button type="button" class="market-tab sel" data-tab="browse" role="tab" aria-selected="true">${esc(t('marketplace.tabBrowse'))}</button>` +
    `<button type="button" class="market-tab" data-tab="create" role="tab" aria-selected="false">${esc(t('marketplace.tabCreate'))}</button>` +
    `</div>` +
    `<div class="market-content">${esc(t('marketplace.loading'))}</div>` +
    `</div>`;
  el.style.display = 'flex';
  el.classList.add('open');
  el.querySelector('[data-close]')?.addEventListener('click', () => close());
  const content = el.querySelector('.market-content') as HTMLElement;

  const skins = await hooks.listSkins();
  // The user may have closed the overlay while the registry was loading.
  if (el.style.display === 'none') return;
  for (const b of Array.from(el.querySelectorAll('.market-tab'))) {
    b.addEventListener('click', () => setTab((b as HTMLElement).dataset.tab as 'browse' | 'create', content, skins));
  }
  setTab(activeTab, content, skins);
}
