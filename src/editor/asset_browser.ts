// The bottom asset-browser drawer (visible while the Place tool is active):
// category tabs + search + a thumbnail grid, plus an Uploaded tab backed by the
// server's user assets. Cells paint instantly with a procedural placeholder
// tile (deterministic hue from the asset id, label glyph, category tag) and
// then lazily swap in a real 3D GLB snapshot from asset_thumbs.ts once it
// renders; ids whose GLB fails keep the placeholder.

import { collisionOverrideFor } from '../sim/asset_collision';
import { ASSET_COLLISION, ASSET_RAMPS } from '../sim/asset_collision.generated';
import { t } from '../ui/i18n';
import { ASSET_CATALOG, ASSET_CATEGORIES, assetById } from './asset_catalog.generated';
import {
  filterAssets,
  parseStoredIds,
  pushRecent,
  subcategoriesOf,
  toggleFavourite,
} from './asset_search_core';
import { cachedAssetThumb, requestAssetThumb } from './asset_thumbs';
import { hashHue } from './asset_thumbs_core';
import { el } from './dom';
import { LOCAL_ASSET_PREFIX, listLocalAssets, removeLocalAsset } from './local_assets';
import { deleteStoredLocalAsset } from './local_assets_db';
import { deleteUserAsset, EditorApiError, listMyAssets, signedIn } from './net';
import { editorErrorKey } from './server_errors_core';
import {
  clearUserAssets,
  listUserAssets,
  registerUserAssets,
  removeUserAsset,
  userAssetIdFor,
} from './user_assets';

const UPLOADED_TAB = 'uploaded';
const IMPORTED_TAB = 'imported';
const ALL_TAB = 'all';
const FAVOURITES_TAB = 'favourites';
const RECENTS_TAB = 'recents';
// Drawer height: user-resizable by dragging the top edge, persisted per browser.
const HEIGHT_PREF_KEY = 'woc_editor_assets_height';
// Favourites / recents: persisted per browser, same arrangement as the height.
const FAVOURITES_PREF_KEY = 'woc_editor_assets_favs';
const RECENTS_PREF_KEY = 'woc_editor_assets_recents';
const MIN_DRAWER_H = 140;
const DRAWER_MAX_VH = 0.72;
// The grid renders in chunks: this many cells up front, another chunk each
// time the scroll sentinel comes into view. Nothing truncates, the All tab's
// 1500+ assets are all reachable, but a tab open never builds more DOM than
// the viewport plus one chunk. Thumbnails stay lazy per cell on top of this.
const GRID_CHUNK = 250;
const SEARCH_DEBOUNCE_MS = 120;
// Cached thumbnails are ~15 KB canvases; cap the cache so a long session
// browsing the whole catalog cannot pin unbounded canvas memory.
const THUMB_CACHE_CAP = 1000;

// Per-category counts are static for the generated catalog: compute once at
// module init instead of an ASSET_CATALOG.filter per category per tab render.
const CATEGORY_COUNTS: ReadonlyMap<string, number> = (() => {
  const counts = new Map<string, number>();
  for (const a of ASSET_CATALOG) counts.set(a.category, (counts.get(a.category) ?? 0) + 1);
  return counts;
})();

export interface AssetBrowserDeps {
  onPick(assetId: string, label: string): void;
  confirm(title: string, body: string): Promise<boolean>;
  toastError(message: string): void;
  /** Open the Collision Master (per-asset collision authoring scene) for a
   *  CATALOGUE asset. Absent = the cells show no Collision Master button. */
  onCollisionMaster?(assetId: string, label: string): void;
  /** Import a local .glb/.gltf model (the button lives here in the browser,
   *  next to the assets it lands beside, fully offline). */
  onImportModel(): void;
}

interface Entry {
  id: string;
  label: string;
  category: string;
  subcategory?: string;
  /** Server row id for uploaded assets owned by this account (delete handle). */
  uploadId?: number;
  sha256?: string;
  /** Locally imported model (delete = drop the session blob, no server). */
  local?: boolean;
}

/** How a catalogue asset will collide when placed, for the cell badge. */
type CollisionStatus = 'authored' | 'baked' | 'none';

function collisionStatusFor(assetId: string): CollisionStatus {
  if (collisionOverrideFor(assetId) !== null) return 'authored';
  if (ASSET_COLLISION[assetId] !== undefined || ASSET_RAMPS[assetId] !== undefined) return 'baked';
  // Deliberate softness (ground cover) and a genuinely missing shape both read
  // "none": the badge exists so a maker SEES that before playtesting into it.
  return 'none';
}

const CATEGORY_KEYS: Record<string, string> = {
  biome: 'editor.assets.category.biome',
  chars: 'editor.assets.category.chars',
  creatures: 'editor.assets.category.creatures',
  dungeon: 'editor.assets.category.dungeon',
  foliage: 'editor.assets.category.foliage',
  props: 'editor.assets.category.props',
  quest: 'editor.assets.category.quest',
  resources: 'editor.assets.category.resources',
  tools: 'editor.assets.category.tools',
  weapons: 'editor.assets.category.weapons',
};

function categoryLabel(category: string): string {
  const key = CATEGORY_KEYS[category];
  // A future generated category without a key falls back to its raw folder name.
  return key ? t(key as Parameters<typeof t>[0]) : category;
}

const SUBCATEGORY_KEYS: Record<string, string> = {
  buildings: 'editor.assets.subcategory.buildings',
  props: 'editor.assets.subcategory.props',
  nature: 'editor.assets.subcategory.nature',
  environment: 'editor.assets.subcategory.environment',
  structure: 'editor.assets.subcategory.structure',
  furniture: 'editor.assets.subcategory.furniture',
  containers: 'editor.assets.subcategory.containers',
  lighting: 'editor.assets.subcategory.lighting',
  decor: 'editor.assets.subcategory.decor',
  other: 'editor.assets.subcategory.other',
  enemies: 'editor.assets.subcategory.enemies',
  players: 'editor.assets.subcategory.players',
  modular: 'editor.assets.subcategory.modular',
};

function subcategoryLabel(sub: string): string {
  const key = SUBCATEGORY_KEYS[sub];
  return key ? t(key as Parameters<typeof t>[0]) : sub;
}

function thumbCanvas(entry: Entry): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = 72;
  c.height = 54;
  const ctx = c.getContext('2d');
  if (!ctx) return c;
  const hue = hashHue(entry.id);
  const grad = ctx.createLinearGradient(0, 0, 0, c.height);
  grad.addColorStop(0, `hsl(${hue}, 32%, 24%)`);
  grad.addColorStop(1, `hsl(${hue}, 40%, 12%)`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.strokeStyle = `hsl(${hue}, 45%, 38%)`;
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, c.width - 2, c.height - 2);
  // Big glyph: the first character of the label.
  ctx.fillStyle = `hsl(${hue}, 60%, 78%)`;
  ctx.font = '700 22px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText((entry.label[0] ?? '?').toUpperCase(), c.width / 2, c.height / 2 - 4);
  // Category tag along the bottom.
  ctx.font = '600 8px system-ui, sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.fillText(entry.category.toUpperCase().slice(0, 10), c.width / 2, c.height - 8);
  return c;
}

export class AssetBrowser {
  readonly root: HTMLElement;
  private readonly tabs: HTMLElement;
  private readonly subtabs: HTMLElement;
  private readonly grid: HTMLElement;
  private readonly search: HTMLInputElement;
  private readonly note: HTMLElement;
  private category: string = ALL_TAB;
  private subcategory: string | null = null;
  private selectedId: string | null = null;
  private uploadedLoaded = false;
  private uploadedLoading = false;
  private searchTimer = 0;
  private favourites: string[] = [];
  private recents: string[] = [];
  private readonly thumbCache = new Map<string, HTMLCanvasElement>();
  private thumbObserver: IntersectionObserver | null = null;
  private chunkObserver: IntersectionObserver | null = null;
  // Ids the grid currently shows: the cheap stale-skip probe for queued 3D
  // snapshots (rebuilt on every renderGrid, so search/tab churn drops work).
  private gridIds: ReadonlySet<string> = new Set();

  constructor(
    parent: HTMLElement,
    private readonly deps: AssetBrowserDeps,
  ) {
    this.root = el('section', 'ed-assets');
    this.root.setAttribute('aria-label', t('editor.assets.label'));
    this.root.style.display = 'none';
    try {
      const saved = Number(localStorage.getItem(HEIGHT_PREF_KEY));
      if (Number.isFinite(saved) && saved >= MIN_DRAWER_H) this.root.style.height = `${saved}px`;
    } catch {
      // Blocked storage: keep the stylesheet default.
    }
    this.buildResizeGrip();

    const head = el('div', 'ed-assets-head');
    head.appendChild(el('h2', 'ed-assets-title', t('editor.assets.title')));
    this.search = document.createElement('input');
    this.search.type = 'search';
    this.search.placeholder = t('editor.assets.searchPlaceholder');
    this.search.setAttribute('aria-label', t('editor.assets.search'));
    this.search.addEventListener('input', () => {
      window.clearTimeout(this.searchTimer);
      this.searchTimer = window.setTimeout(() => this.renderGrid(), SEARCH_DEBOUNCE_MS);
    });
    this.search.addEventListener('keydown', (ev) => ev.stopPropagation());
    head.appendChild(this.search);
    // Import Model lives with the assets it creates (was a topbar action).
    const importBtn = document.createElement('button');
    importBtn.type = 'button';
    importBtn.className = 'ed-assets-import';
    importBtn.textContent = t('editor.topbar.importModel');
    importBtn.title = t('editor.topbar.importModelTitle');
    importBtn.addEventListener('click', () => deps.onImportModel());
    head.appendChild(importBtn);
    this.root.appendChild(head);

    this.tabs = el('div', 'ed-assets-tabs');
    this.tabs.setAttribute('role', 'tablist');
    this.root.appendChild(this.tabs);

    this.subtabs = el('div', 'ed-assets-subtabs');
    this.subtabs.setAttribute('role', 'tablist');
    this.subtabs.style.display = 'none';
    this.root.appendChild(this.subtabs);

    this.note = el('p', 'ed-assets-note');
    this.note.style.display = 'none';
    this.root.appendChild(this.note);

    try {
      this.favourites = parseStoredIds(localStorage.getItem(FAVOURITES_PREF_KEY));
      this.recents = parseStoredIds(localStorage.getItem(RECENTS_PREF_KEY));
    } catch {
      // Blocked storage: both lists still work for this session.
    }

    this.grid = el('div', 'ed-assets-grid');
    this.root.appendChild(this.grid);

    this.renderTabs();
    this.renderGrid();
    parent.appendChild(this.root);
  }

  setVisible(on: boolean): void {
    this.root.style.display = on ? '' : 'none';
    if (on && this.category === UPLOADED_TAB) void this.loadUploaded();
  }

  /** Drag strip along the drawer's top edge: pull up/down to resize, height
   *  persisted per browser. Pointer capture keeps the drag alive off-strip. */
  private buildResizeGrip(): void {
    const grip = el('div', 'ed-assets-resize');
    grip.setAttribute('role', 'separator');
    grip.setAttribute('aria-orientation', 'horizontal');
    grip.setAttribute('aria-label', t('editor.assets.resizeHandle'));
    grip.title = t('editor.assets.resizeHandle');
    let startY = 0;
    let startH = 0;
    const move = (ev: PointerEvent): void => {
      const max = Math.round(window.innerHeight * DRAWER_MAX_VH);
      const h = Math.min(max, Math.max(MIN_DRAWER_H, startH + (startY - ev.clientY)));
      this.root.style.height = `${h}px`;
    };
    grip.addEventListener('pointerdown', (ev) => {
      ev.preventDefault();
      startY = ev.clientY;
      startH = this.root.getBoundingClientRect().height;
      this.root.classList.add('resizing');
      grip.setPointerCapture(ev.pointerId);
      grip.addEventListener('pointermove', move);
      const end = (): void => {
        grip.removeEventListener('pointermove', move);
        this.root.classList.remove('resizing');
        try {
          localStorage.setItem(
            HEIGHT_PREF_KEY,
            String(Math.round(this.root.getBoundingClientRect().height)),
          );
        } catch {
          // Blocked storage: the size still applies for this session.
        }
      };
      grip.addEventListener('pointerup', end, { once: true });
      grip.addEventListener('pointercancel', end, { once: true });
    });
    this.root.appendChild(grip);
  }

  get selectedAssetId(): string | null {
    return this.selectedId;
  }

  private persistList(key: string, list: readonly string[]): void {
    try {
      localStorage.setItem(key, JSON.stringify(list));
    } catch {
      // Blocked storage: the in-memory list still works this session.
    }
  }

  private rememberRecent(entry: Entry): void {
    if (entry.local || entry.uploadId !== undefined || !assetById(entry.id)) return;
    this.recents = pushRecent(this.recents, entry.id);
    this.persistList(RECENTS_PREF_KEY, this.recents);
  }

  /** Register a fresh upload and jump the browser to it (post-upload flow). */
  showUploaded(assetId: string): void {
    this.category = UPLOADED_TAB;
    this.uploadedLoaded = true; // the registry was just updated by the caller
    this.selectedId = assetId;
    this.renderTabs();
    this.renderGrid();
  }

  /** Jump the browser to a freshly imported local model (post-import flow). */
  showImported(assetId: string): void {
    this.category = IMPORTED_TAB;
    this.selectedId = assetId;
    this.renderTabs();
    this.renderGrid();
  }

  private renderTabs(): void {
    this.tabs.innerHTML = '';
    const cats: { id: string; label: string }[] = [
      {
        id: ALL_TAB,
        label: t('editor.assets.allTab', { count: ASSET_CATALOG.length }),
      },
      {
        id: FAVOURITES_TAB,
        label: t('editor.assets.favouritesTab', { count: this.favourites.length }),
      },
      { id: RECENTS_TAB, label: t('editor.assets.recentsTab') },
      ...ASSET_CATEGORIES.map((c) => ({
        id: c,
        label: t('editor.assets.categoryTab', {
          category: categoryLabel(c),
          count: CATEGORY_COUNTS.get(c) ?? 0,
        }),
      })),
    ];
    cats.push({ id: UPLOADED_TAB, label: t('editor.assets.uploadedTab') });
    cats.push({ id: IMPORTED_TAB, label: t('editor.assets.importedTab') });
    for (const c of cats) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'ed-assets-tab';
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', c.id === this.category ? 'true' : 'false');
      b.classList.toggle('active', c.id === this.category);
      b.textContent = c.label;
      b.addEventListener('click', () => {
        this.category = c.id;
        this.subcategory = null;
        this.renderTabs();
        if (c.id === UPLOADED_TAB) void this.loadUploaded();
        this.renderGrid();
      });
      this.tabs.appendChild(b);
    }
    this.renderSubTabs();
  }

  /** Subcategory chips under the tabs, only for divided categories (the
   *  village pack's real subfolders, the dungeon pack's naming families). */
  private renderSubTabs(): void {
    this.subtabs.innerHTML = '';
    const subs = subcategoriesOf(ASSET_CATALOG, this.category);
    if (subs.length === 0) {
      this.subtabs.style.display = 'none';
      return;
    }
    this.subtabs.style.display = '';
    const total = CATEGORY_COUNTS.get(this.category) ?? 0;
    const chips = [
      { id: null as string | null, label: t('editor.assets.subcategoryAll', { count: total }) },
      ...subs.map((s) => ({
        id: s.id as string | null,
        label: t('editor.assets.subcategoryTab', {
          name: subcategoryLabel(s.id),
          count: s.count,
        }),
      })),
    ];
    for (const chip of chips) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'ed-assets-subtab';
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', chip.id === this.subcategory ? 'true' : 'false');
      b.classList.toggle('active', chip.id === this.subcategory);
      b.textContent = chip.label;
      b.addEventListener('click', () => {
        this.subcategory = chip.id;
        this.renderSubTabs();
        this.renderGrid();
      });
      this.subtabs.appendChild(b);
    }
  }

  private async loadUploaded(): Promise<void> {
    if (this.uploadedLoaded || this.uploadedLoading || !signedIn()) return;
    this.uploadedLoading = true;
    this.renderGrid();
    try {
      const assets = await listMyAssets();
      clearUserAssets();
      registerUserAssets(
        assets.map((a) => ({ id: a.id, sha256: a.sha256, name: a.name, byteSize: a.byteSize })),
      );
      this.uploadedLoaded = true;
    } catch {
      this.note.textContent = t('editor.assets.uploadedLoadFailed');
      this.note.style.display = '';
    } finally {
      this.uploadedLoading = false;
      if (this.category === UPLOADED_TAB) this.renderGrid();
    }
  }

  private entries(): Entry[] {
    if (this.category === UPLOADED_TAB) {
      return listUserAssets().map((a) => ({
        id: userAssetIdFor(a.sha256),
        label: a.name ?? a.sha256.slice(0, 8),
        category: t('editor.assets.uploadedTab'),
        uploadId: a.id,
        sha256: a.sha256,
      }));
    }
    if (this.category === IMPORTED_TAB) {
      return listLocalAssets().map((a) => ({
        id: a.id,
        label: a.name,
        category: t('editor.assets.importedTab'),
        local: true,
      }));
    }
    const catalogEntry = (a: (typeof ASSET_CATALOG)[number]): Entry => ({
      id: a.id,
      label: a.label,
      category: a.category,
      subcategory: a.subcategory,
    });
    if (this.category === ALL_TAB) return ASSET_CATALOG.map(catalogEntry);
    // Favourites keep save order; recents are most-recent-first. Stale ids
    // (a renamed pack) drop out silently rather than rendering dead cells.
    if (this.category === FAVOURITES_TAB) {
      return this.favourites.flatMap((id) => {
        const a = assetById(id);
        return a ? [catalogEntry(a)] : [];
      });
    }
    if (this.category === RECENTS_TAB) {
      return this.recents.flatMap((id) => {
        const a = assetById(id);
        return a ? [catalogEntry(a)] : [];
      });
    }
    return ASSET_CATALOG.filter(
      (a) =>
        a.category === this.category &&
        (this.subcategory === null || a.subcategory === this.subcategory),
    ).map(catalogEntry);
  }

  private renderGrid(): void {
    this.grid.innerHTML = '';
    this.note.style.display = 'none';
    this.gridIds = new Set();
    if (this.category === UPLOADED_TAB) {
      if (!signedIn()) {
        this.note.textContent = t('editor.assets.uploadedSignIn');
        this.note.style.display = '';
        return;
      }
      if (this.uploadedLoading) {
        this.note.textContent = t('editor.openDrawer.loading');
        this.note.style.display = '';
        return;
      }
    }
    const q = this.search.value.trim();
    const items = filterAssets(
      this.entries().map((e) => ({ ...e, path: `/models/${e.id}.glb` })),
      q,
    );
    this.gridIds = new Set(items.map((a) => a.id));
    if (items.length === 0) {
      this.note.textContent =
        this.category === UPLOADED_TAB && !q
          ? t('editor.assets.uploadedEmpty')
          : this.category === IMPORTED_TAB && !q
            ? t('editor.assets.importedEmpty')
            : this.category === FAVOURITES_TAB && !q
              ? t('editor.assets.favouritesEmpty')
              : this.category === RECENTS_TAB && !q
                ? t('editor.assets.recentsEmpty')
                : t('editor.assets.empty');
      this.note.style.display = '';
      return;
    }
    this.appendChunk(items, 0);
  }

  /** Append cells [from, from+GRID_CHUNK) and, if more remain, a sentinel that
   *  appends the next chunk when scrolled into view. DOM grows with scrolling,
   *  never with catalogue size. */
  private appendChunk(items: Entry[], from: number): void {
    const to = Math.min(items.length, from + GRID_CHUNK);
    for (let i = from; i < to; i++) this.grid.appendChild(this.cell(items[i]));
    if (to >= items.length) return;
    const sentinel = el('div', 'ed-assets-more');
    this.chunkObserver?.disconnect();
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        observer.disconnect();
        // The grid may have re-rendered (search/tab churn) while we scrolled;
        // a detached sentinel means this chunk run is stale.
        if (!sentinel.isConnected) return;
        sentinel.remove();
        this.appendChunk(items, to);
      },
      { root: this.grid, rootMargin: '300px' },
    );
    this.chunkObserver = observer;
    observer.observe(sentinel);
    this.grid.appendChild(sentinel);
  }

  /** Lazily created IntersectionObserver: fires each cell's queued thumbnail
   *  request the first time it becomes visible, then forgets the cell. */
  private visibleThumbs(): IntersectionObserver {
    if (!this.thumbObserver) {
      this.thumbObserver = new IntersectionObserver(
        (entries) => {
          for (const e of entries) {
            if (!e.isIntersecting) continue;
            const el = e.target as HTMLElement & { __wocThumb?: () => void };
            this.thumbObserver?.unobserve(el);
            el.__wocThumb?.();
            el.__wocThumb = undefined;
          }
        },
        { root: this.grid.parentElement, rootMargin: '200px' },
      );
    }
    return this.thumbObserver;
  }

  /** Thumbnail canvases are deterministic per asset id: cache and reuse them. */
  private thumbFor(entry: Entry): HTMLCanvasElement {
    let thumb = this.thumbCache.get(entry.id);
    if (!thumb) {
      if (this.thumbCache.size >= THUMB_CACHE_CAP) this.thumbCache.clear();
      thumb = thumbCanvas(entry);
      this.thumbCache.set(entry.id, thumb);
    }
    return thumb;
  }

  private cell(entry: Entry): HTMLElement {
    const wrap = el('div', 'ed-asset-cell');
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'ed-asset';
    b.classList.toggle('active', entry.id === this.selectedId);
    b.title = t('editor.assets.pick', { name: entry.label });
    b.setAttribute('aria-label', t('editor.assets.pick', { name: entry.label }));
    // Paint instantly: the cached 3D snapshot when one exists, else the
    // procedural placeholder while the real preview renders in the background.
    // Real snapshots are requested ONLY once the cell scrolls into view: a
    // 379-item tab must not queue 379 GLB loads the moment it opens.
    const snapshot = cachedAssetThumb(entry.id);
    const thumb = snapshot ?? this.thumbFor(entry);
    b.appendChild(thumb);
    if (!snapshot) {
      this.visibleThumbs().observe(b);
      (b as HTMLElement & { __wocThumb?: () => void }).__wocThumb = () => {
        requestAssetThumb(
          entry.id,
          () => this.gridIds.has(entry.id),
          (real) => {
            // Swap only if this very cell still shows the id (the grid may have
            // re-rendered for a search or tab change while the GLB loaded).
            if (!thumb.isConnected || !this.gridIds.has(entry.id)) return;
            thumb.replaceWith(real);
            this.thumbCache.delete(entry.id); // the placeholder is obsolete now
          },
        );
      };
    }
    b.appendChild(el('span', 'ed-asset-label', entry.label));
    b.addEventListener('click', () => {
      this.selectedId = entry.id;
      for (const other of this.grid.querySelectorAll('.ed-asset.active')) {
        other.classList.remove('active');
      }
      b.classList.add('active');
      this.rememberRecent(entry);
      this.deps.onPick(entry.id, entry.label);
    });
    wrap.appendChild(b);
    const isCatalog = !entry.local && entry.uploadId === undefined && assetById(entry.id);
    if (isCatalog) {
      // Collision badge: what placing this asset collides as, from the same
      // tables the sim reads, coverage is visible here, not discovered by
      // walking through a building in playtest.
      const status = collisionStatusFor(entry.id);
      const badge = el('span', `ed-asset-collision ed-asset-collision-${status}`);
      badge.title = t(`editor.assets.collision.${status}`);
      wrap.appendChild(badge);
      const fav = document.createElement('button');
      fav.type = 'button';
      fav.className = 'ed-asset-fav';
      const isFav = this.favourites.includes(entry.id);
      fav.classList.toggle('active', isFav);
      // The star glyph is drawn by .ed-asset-fav::before (styles.css); the button
      // is named by its aria-label below.
      const favKey = isFav ? 'editor.assets.favouriteRemove' : 'editor.assets.favouriteAdd';
      fav.title = t(favKey, { name: entry.label });
      fav.setAttribute('aria-label', t(favKey, { name: entry.label }));
      fav.addEventListener('click', (ev) => {
        ev.stopPropagation();
        this.favourites = toggleFavourite(this.favourites, entry.id);
        this.persistList(FAVOURITES_PREF_KEY, this.favourites);
        // Tab counts and (on the Favourites tab) membership both changed.
        this.renderTabs();
        this.renderGrid();
      });
      wrap.appendChild(fav);
    }
    // Catalogue assets get the Collision Master shortcut (per-asset authored
    // collision). Uploaded/imported models keep their per-map import bake, so
    // the corner slot stays free for their delete button instead.
    if (!entry.local && entry.uploadId === undefined && this.deps.onCollisionMaster) {
      const cmBtn = document.createElement('button');
      cmBtn.type = 'button';
      cmBtn.className = 'ed-asset-del ed-asset-cm';
      cmBtn.innerHTML =
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 20 6v6c0 4.8-3.1 7.6-8 9-4.9-1.4-8-4.2-8-9V6zM8 12h8M12 8v8"/></svg>';
      cmBtn.title = t('editor.assets.collisionMaster');
      cmBtn.setAttribute('aria-label', t('editor.assets.collisionMaster'));
      cmBtn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        this.deps.onCollisionMaster?.(entry.id, entry.label);
      });
      wrap.appendChild(cmBtn);
    }
    if (entry.local) {
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'ed-asset-del';
      del.textContent = 'x';
      del.title = t('editor.assets.removeImported');
      del.setAttribute('aria-label', t('editor.assets.removeImported'));
      del.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const url = removeLocalAsset(entry.id);
        if (url) URL.revokeObjectURL(url);
        void deleteStoredLocalAsset(entry.id.slice(LOCAL_ASSET_PREFIX.length));
        if (this.selectedId === entry.id) this.selectedId = null;
        this.renderGrid();
      });
      wrap.appendChild(del);
      return wrap;
    }
    if (entry.uploadId !== undefined && entry.sha256) {
      const uploadId = entry.uploadId;
      const sha = entry.sha256;
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'ed-asset-del';
      del.textContent = 'x';
      del.title = t('editor.assets.deleteAsset');
      del.setAttribute('aria-label', t('editor.assets.deleteAsset'));
      del.addEventListener('click', async (ev) => {
        ev.stopPropagation();
        const ok = await this.deps.confirm(
          t('editor.assets.deleteAsset'),
          t('editor.assets.deleteAssetConfirm', { name: entry.label }),
        );
        if (!ok) return;
        try {
          await deleteUserAsset(uploadId);
          removeUserAsset(sha);
          if (this.selectedId === entry.id) this.selectedId = null;
          this.renderGrid();
        } catch (err) {
          const key =
            err instanceof EditorApiError
              ? editorErrorKey(err.code, err.status)
              : editorErrorKey(null);
          this.deps.toastError(t(key));
        }
      });
      wrap.appendChild(del);
    }
    return wrap;
  }
}
