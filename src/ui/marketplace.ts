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
  type CreatorSkinRegistryEntry, type SkinDesignSpec, type SkinPattern, type SkinFinish, type SkinDensity,
  SKIN_PATTERNS, SKIN_FINISHES, SKIN_DENSITIES, defaultDesignSpec,
} from '../world_api';
import type { PlayerClass } from '../sim/types';
import { designSwatchDataUrl } from '../render/characters/skin_design';
import { CharacterPreview } from '../render/characters';

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
  // List a self-hosted skin (free): the server proxies the URL. Throws on failure.
  selfHostSkin(listing: { name: string; description: string; priceUsdc: string; originUrl: string; targetClass: string | null }): Promise<void>;
  // Upload a hosted skin (raw PNG bytes); $WOC-quota gated server-side. Throws on failure.
  uploadSkin(meta: { name: string; description: string; priceUsdc: string; targetClass: string | null }, png: Uint8Array): Promise<void>;
  // The viewer's hosting quota (tier/slots/usage/trusted) for the designer meter.
  fetchQuota(): Promise<{ tier: number; quota: number; used: number; remaining: number; trusted: boolean; hostingEnabled: boolean; selfHostedFree: boolean }>;
  // The viewer's class, so the designer previews the skin on their own body.
  playerClass(): PlayerClass;
  // Open the NFT-PFP skins picker (wear an owned NFT). Optional; the entry point
  // hides when unset.
  openNftSkins?(): void;
}

let hooks: MarketplaceHooks | null = null;
let overlay: HTMLDivElement | null = null;
let activeTab: 'browse' | 'create' = 'browse';
let design: SkinDesignSpec = defaultDesignSpec();
// The designer's live 3D turntable. Created on the Create tab, torn down when the
// overlay closes or the tab switches away, so its WebGL render loop never runs idle.
let designerPreview: CharacterPreview | null = null;
let designerCanvas: HTMLCanvasElement | null = null;

function destroyDesignerPreview(): void {
  if (designerPreview) { designerPreview.destroy(); designerPreview = null; }
  if (designerCanvas) { designerCanvas.remove(); designerCanvas = null; }
}

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
  destroyDesignerPreview();
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
function finishLabel(f: SkinFinish): string {
  return t(`marketplace.finishes.${f}` as 'marketplace.finishes.matte');
}
function densityLabel(d: SkinDensity): string {
  return t(`marketplace.densities.${d}` as 'marketplace.densities.low');
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
  const nftButton = hooks?.openNftSkins
    ? `<button type="button" class="market-nft-cta" style="min-height:40px;padding:0 14px;border-radius:6px;border:1px solid #6b5226;background:#241a14;color:#caa84b;font-weight:600;cursor:pointer">${esc(t('hudChrome.nftSkins.title'))}</button>`
    : '';
  content.innerHTML =
    `<div class="market-browse">` +
    `<div class="market-browse-head" style="display:flex;gap:8px;align-items:center">` +
    `<input type="text" class="market-search" style="flex:1" aria-label="${esc(t('marketplace.search'))}" placeholder="${esc(t('marketplace.search'))}">` +
    nftButton +
    `</div>` +
    `<div class="market-grid" role="list"></div>` +
    `</div>`;
  const grid = content.querySelector('.market-grid') as HTMLElement;
  const search = content.querySelector('.market-search') as HTMLInputElement;
  content.querySelector('.market-nft-cta')?.addEventListener('click', () => hooks?.openNftSkins?.());

  const draw = (filter: string): void => {
    const owned = new Set(hooks?.ownedSkinIds() ?? []);
    const q = filter.trim().toLowerCase();
    // NFT-PFP skins are claimed (proof of ownership), not bought, so they never
    // appear in the for-sale browse grid; they are reached via the picker.
    const shown = skins.filter((s) => !s.nft && (!q || s.name.toLowerCase().includes(q) || s.creator.toLowerCase().includes(q)));
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
  // One button, one click handler, closure-tracked ownership: a successful buy
  // flips `owned` so the next click equips — no second listener (which would
  // re-fire the buy), no element churn.
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn market-buy-btn';
  let owned = isOwned;
  const refresh = (): void => {
    button.textContent = owned ? t('marketplace.equip') : t('marketplace.buy');
    button.setAttribute('aria-label', owned
      ? `${t('marketplace.equip')} ${skin.name}`
      : `${t('marketplace.buy')} ${skin.name} — ${formatUsdc(skin.priceUsdc)}`);
  };
  button.addEventListener('click', () => {
    if (owned) { onEquip(skin, card, button); return; }
    void onBuy(skin, card, button).then((bought) => {
      if (!bought) return;
      owned = true;
      refresh();
      if (!card.querySelector('.market-owned-badge')) {
        const badge = document.createElement('span');
        badge.className = 'market-owned-badge';
        badge.textContent = t('marketplace.ownedBadge');
        card.querySelector('.market-thumb-wrap')?.appendChild(badge);
      }
    });
  });
  refresh();
  card.appendChild(button);
  return card;
}

function statusEl(card: HTMLElement): HTMLElement {
  return card.querySelector('.market-card-status') as HTMLElement;
}

function onEquip(skin: CreatorSkinRegistryEntry, card: HTMLElement, button: HTMLButtonElement): void {
  if (!hooks) return;
  hooks.equip(skin);
  statusEl(card).textContent = t('marketplace.equipped');
  button.textContent = t('marketplace.equipped');
}

// Returns true once the skin is bought (so the card can flip to Equip). The
// try/catch is load-bearing: purchase spans wallet + network + chain and throws
// human-readable failures that must land on the card's status line.
async function onBuy(skin: CreatorSkinRegistryEntry, card: HTMLElement, button: HTMLButtonElement): Promise<boolean> {
  if (!hooks) return false;
  const status = statusEl(card);
  button.disabled = true;
  try {
    if (!hooks.isWalletConnected()) {
      status.textContent = t('marketplace.connectFirst');
      await hooks.connectWallet();
      if (!hooks.isWalletConnected()) { button.disabled = false; return false; }
    }
    status.textContent = t('marketplace.purchasing');
    await hooks.purchase(skin);
    status.textContent = t('marketplace.owned');
    button.disabled = false;
    return true;
  } catch (err) {
    const detail = err instanceof Error && err.message ? `: ${err.message}` : '';
    status.textContent = `${t('marketplace.failed')}${detail}`.slice(0, 140);
    button.disabled = false;
    return false;
  }
}

// ---------------------------------------------------------------------------
// Create & Sell tab (in-browser designer)
// ---------------------------------------------------------------------------

function renderCreate(content: HTMLElement): void {
  content.innerHTML =
    `<div class="market-cmodes" role="tablist">` +
    `<button type="button" class="market-cmode sel" data-cmode="design" role="tab" aria-selected="true">${esc(t('marketplace.modeDesign'))}</button>` +
    `<button type="button" class="market-cmode" data-cmode="upload" role="tab" aria-selected="false">${esc(t('marketplace.modeUpload'))}</button>` +
    `<button type="button" class="market-cmode" data-cmode="link" role="tab" aria-selected="false">${esc(t('marketplace.modeLink'))}</button>` +
    `</div><div class="market-cbody"></div>`;
  const body = content.querySelector('.market-cbody') as HTMLElement;
  const setMode = (mode: 'design' | 'upload' | 'link'): void => {
    destroyDesignerPreview(); // the turntable only lives in design mode
    content.querySelectorAll('.market-cmode').forEach((b) => {
      const el = b as HTMLElement; const on = el.dataset.cmode === mode;
      el.classList.toggle('sel', on); el.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    if (mode === 'design') renderDesignerMode(body);
    else void renderImageMode(body, mode);
  };
  content.querySelectorAll('.market-cmode').forEach((b) =>
    b.addEventListener('click', () => setMode((b as HTMLElement).dataset.cmode as 'design' | 'upload' | 'link')));
  setMode('design');
}

// Shared listing form (name / description / price) for every Create sub-mode.
function listingFormHtml(): string {
  return `<label class="market-field market-field-col"><span>${esc(t('marketplace.nameLabel'))}</span><input type="text" class="d-name" maxlength="40" placeholder="${esc(t('marketplace.namePlaceholder'))}"></label>` +
    `<label class="market-field market-field-col"><span>${esc(t('marketplace.descLabel'))}</span><input type="text" class="d-desc" maxlength="200" placeholder="${esc(t('marketplace.descPlaceholder'))}"></label>` +
    `<label class="market-field market-field-col"><span>${esc(t('marketplace.priceLabel'))}</span><input type="number" class="d-price" min="0.5" step="0.5" value="10"></label>` +
    `<div class="market-payout-hint">${esc(t('marketplace.payoutHint'))}</div>` +
    `<div class="market-card-status market-list-status" role="status" aria-live="polite"></div>`;
}

// Read name/description/price from a Create sub-mode form; null if no name.
function readListingMeta(root: HTMLElement): { name: string; description: string; priceUsdc: string } | null {
  const name = (root.querySelector('.d-name') as HTMLInputElement).value.trim();
  if (!name) return null;
  const description = (root.querySelector('.d-desc') as HTMLInputElement).value.trim();
  const dollars = Number((root.querySelector('.d-price') as HTMLInputElement).value);
  return { name, description, priceUsdc: String(Math.max(0, Math.round((Number.isFinite(dollars) ? dollars : 0) * 1_000_000))) };
}

// Upload (hosted, $WOC-gated) + Self-host (link, free) sub-modes share a layout:
// an intro, a quota/free note, the source input, then the listing form.
async function renderImageMode(host: HTMLElement, mode: 'upload' | 'link'): Promise<void> {
  const quota = hooks ? await hooks.fetchQuota() : null;
  const note = mode === 'upload'
    ? (quota && !quota.hostingEnabled
      ? `<div class="market-quota market-quota-warn">${esc(t('marketplace.hostingUnavailable'))}</div>`
      : `<div class="market-quota">${esc(t('marketplace.quotaMeter', { used: String(quota?.used ?? 0), quota: String(quota?.quota ?? 0) }))}${quota?.trusted ? ` &middot; ${esc(t('marketplace.trustedBadge'))}` : ''}</div>`)
    : `<div class="market-quota">${esc(t('marketplace.selfHostedFreeNote'))}</div>`;
  const input = mode === 'upload'
    ? `<label class="market-field market-field-col"><span>${esc(t('marketplace.uploadFile'))}</span><input type="file" accept="image/png" class="d-file"></label>`
    : `<label class="market-field market-field-col"><span>${esc(t('marketplace.linkUrl'))}</span><input type="url" class="d-url" placeholder="https://"></label>`;
  host.innerHTML =
    `<div class="market-imagemode">` +
    `<p class="market-design-intro">${esc(t(mode === 'upload' ? 'marketplace.uploadIntro' : 'marketplace.linkIntro'))}</p>` +
    note + input + listingFormHtml() +
    `<button type="button" class="btn market-list-btn">${esc(t('marketplace.list'))}</button>` +
    `</div>`;
  const status = host.querySelector('.market-list-status') as HTMLElement;
  const btn = host.querySelector('.market-list-btn') as HTMLButtonElement;
  btn.addEventListener('click', () => { void submitImage(host, mode, status, btn); });
}

async function submitImage(host: HTMLElement, mode: 'upload' | 'link', status: HTMLElement, button: HTMLButtonElement): Promise<void> {
  if (!hooks) return;
  const meta = readListingMeta(host);
  if (!meta) { status.textContent = t('marketplace.nameLabel'); return; }
  button.disabled = true;
  try {
    if (!hooks.isWalletConnected()) {
      status.textContent = t('marketplace.listConnectFirst');
      await hooks.connectWallet();
      if (!hooks.isWalletConnected()) { button.disabled = false; return; }
    }
    status.textContent = t('marketplace.listing');
    if (mode === 'upload') {
      const file = (host.querySelector('.d-file') as HTMLInputElement).files?.[0];
      if (!file) { status.textContent = t('marketplace.uploadFile'); button.disabled = false; return; }
      await hooks.uploadSkin({ ...meta, targetClass: null }, new Uint8Array(await file.arrayBuffer()));
    } else {
      const originUrl = (host.querySelector('.d-url') as HTMLInputElement).value.trim();
      if (!originUrl) { status.textContent = t('marketplace.linkUrl'); button.disabled = false; return; }
      await hooks.selfHostSkin({ ...meta, originUrl, targetClass: null });
    }
    status.textContent = t('marketplace.listedReview');
  } catch (err) {
    const detail = err instanceof Error && err.message ? `: ${err.message}` : '';
    status.textContent = `${t('marketplace.listFailed')}${detail}`.slice(0, 140);
  } finally {
    button.disabled = false;
  }
}

function renderDesignerMode(host: HTMLElement): void {
  destroyDesignerPreview(); // a fresh turntable per mount
  const opts = <T extends string>(vals: readonly T[], cur: T, label: (v: T) => string): string =>
    vals.map((v) => `<option value="${v}"${v === cur ? ' selected' : ''}>${esc(label(v))}</option>`).join('');
  host.innerHTML =
    `<div class="market-create">` +
    `<div class="market-design">` +
    `<div class="market-preview"><div class="market-preview-3d"></div><img class="market-preview-swatch" alt="" title="${esc(t('marketplace.preview'))}"><div class="market-preview-label">${esc(t('marketplace.preview'))}</div></div>` +
    `<div class="market-controls">` +
    `<p class="market-design-intro">${esc(t('marketplace.designIntro'))}</p>` +
    `<label class="market-field"><span>${esc(t('marketplace.baseColor'))}</span><input type="color" class="d-primary" value="${design.primary}"></label>` +
    `<label class="market-field"><span>${esc(t('marketplace.patternColor'))}</span><input type="color" class="d-secondary" value="${design.secondary}"></label>` +
    `<label class="market-field"><span>${esc(t('marketplace.accentColor'))}</span><input type="color" class="d-accent" value="${design.accent}"></label>` +
    `<label class="market-field"><span>${esc(t('marketplace.pattern'))}</span><select class="d-pattern">${opts(SKIN_PATTERNS, design.pattern, patternLabel)}</select></label>` +
    `<label class="market-field"><span>${esc(t('marketplace.finishLabel'))}</span><select class="d-finish">${opts(SKIN_FINISHES, design.finish, finishLabel)}</select></label>` +
    `<label class="market-field"><span>${esc(t('marketplace.densityLabel'))}</span><select class="d-density">${opts(SKIN_DENSITIES, design.density, densityLabel)}</select></label>` +
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

  const $ = <T extends HTMLElement>(sel: string): T => host.querySelector(sel) as T;
  const swatch = $<HTMLImageElement>('.market-preview-swatch');
  const primary = $<HTMLInputElement>('.d-primary');
  const secondary = $<HTMLInputElement>('.d-secondary');
  const accent = $<HTMLInputElement>('.d-accent');
  const pattern = $<HTMLSelectElement>('.d-pattern');
  const finish = $<HTMLSelectElement>('.d-finish');
  const density = $<HTMLSelectElement>('.d-density');
  const glowOn = $<HTMLInputElement>('.d-glow-on');
  const glow = $<HTMLInputElement>('.d-glow');
  const glowField = $<HTMLElement>('.d-glow-color-field');
  const status = $<HTMLElement>('.market-list-status');
  const listBtn = $<HTMLButtonElement>('.market-list-btn');

  // Live 3D turntable: the design on the viewer's own class model.
  const stage = $<HTMLElement>('.market-preview-3d');
  designerCanvas = document.createElement('canvas');
  stage.appendChild(designerCanvas);
  designerPreview = new CharacterPreview(stage, designerCanvas);
  designerPreview.setClass(hooks!.playerClass());

  const sync = (): void => {
    design = {
      primary: primary.value,
      secondary: secondary.value,
      accent: accent.value,
      pattern: pattern.value as SkinPattern,
      finish: finish.value as SkinFinish,
      density: density.value as SkinDensity,
      emissive: glowOn.checked ? glow.value : null,
    };
    glowField.style.display = glowOn.checked ? '' : 'none';
    swatch.src = designSwatchDataUrl(design, 120);
    designerPreview?.setDesignSkin(design);
  };
  for (const el of [primary, secondary, accent, pattern, finish, density, glowOn, glow]) el.addEventListener('input', sync);

  host.querySelector('.market-randomize')?.addEventListener('click', () => {
    const rndHex = (): string => '#' + Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0');
    const pick = <T,>(a: readonly T[]): T => a[Math.floor(Math.random() * a.length)];
    primary.value = rndHex();
    secondary.value = rndHex();
    accent.value = rndHex();
    pattern.value = pick(SKIN_PATTERNS);
    finish.value = pick(SKIN_FINISHES);
    density.value = pick(SKIN_DENSITIES);
    sync();
  });

  listBtn.addEventListener('click', () => { void onList(host, status, listBtn); });
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
  if (tab === 'browse') { destroyDesignerPreview(); renderBrowse(content, skins); }
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
