// The Book of Deeds window painter (#deeds-window): a cold, event-driven
// catalog browser over the IWorldDeeds facet + the static DEEDS table, the
// bank/mailbox shape exactly. Full innerHTML rebuild on open, on a real data
// change (refreshIfChanged diffs a compact signature), and on language
// switch; scroll offset of the entry list survives rebuilds; nothing here
// runs on the per-frame hot path. The pure model lives in deeds_view.ts; this
// module only paints and wires callbacks through injected deps (it never
// imports Hud and never hardcodes the window id).

import { audio } from '../game/audio';
import { DEED_ORDER, DEEDS } from '../sim/content/deeds';
import type { DeedsRarity, IWorld } from '../world_api';
import { deedDesc, deedName, deedTitleText } from './deed_i18n';
import {
  buildDeedsView,
  DEED_DISPLAY_CATEGORIES,
  DEED_FILTERS,
  DEED_WATCH_CAP,
  type DeedDisplayCategory,
  type DeedEntryModel,
  type DeedsFilter,
  type DeedsViewModel,
  deedRarityFraction,
  deedStatsDigest,
  deedsRefreshSig,
  pruneWatched,
  toggleWatch,
} from './deeds_view';
import { markDialogRoot } from './dialog_root';
import { esc } from './esc';
import {
  formatDateTime,
  formatNumber,
  getLanguage,
  languageTag,
  type TranslationKey,
  t,
} from './i18n';
import { iconDataUrl } from './icons';
import type { PainterHostPresentation } from './painter_host';
import { svgIcon } from './ui_icons';

// Per-character watchlist persistence (the hud.ts per-character key style:
// class + character name folded into the key; offline quick-start characters
// share a key per class+name by design, an accepted collision).
const DEED_WATCH_KEY_PREFIX = 'woc_deed_watch';

// Crest <img> backing-store size (2x the largest CSS box for crisp HiDPI).
const DEED_CREST_SIZE = 96;

const CATEGORY_LABEL_KEYS: Record<DeedDisplayCategory, TranslationKey> = {
  progression: 'hudChrome.deeds.catProgression',
  combat: 'hudChrome.deeds.catCombat',
  dungeon: 'hudChrome.deeds.catDungeon',
  delve: 'hudChrome.deeds.catDelve',
  chronicle: 'hudChrome.deeds.catChronicle',
  collection: 'hudChrome.deeds.catCollection',
  pvp: 'hudChrome.deeds.catPvp',
  social: 'hudChrome.deeds.catSocial',
  exploration: 'hudChrome.deeds.catExploration',
  feat: 'hudChrome.deeds.catFeat',
};

const FILTER_LABEL_KEYS: Record<DeedsFilter, TranslationKey> = {
  all: 'hudChrome.deeds.filterAll',
  earned: 'hudChrome.deeds.filterEarned',
  unearned: 'hudChrome.deeds.filterUnearned',
  nearly: 'hudChrome.deeds.filterNearly',
};

/**
 * The stable-identity selector a rerender uses to put focus back on the
 * role-equivalent fresh control. Selector-quote escaping, not HTML escaping:
 * the value sits inside a double-quoted CSS attribute string (CSS.escape is
 * absent in the jsdom test env, and quote+backslash is the full special set
 * there). Disabled matches are excluded so a watch button rendered disabled
 * at DEED_WATCH_CAP falls through to the Close fallback.
 */
export function refocusSelector(active: Element | null): string | null {
  if (active === null) return null;
  for (const attr of ['data-cat', 'data-filter', 'data-watch', 'data-title']) {
    const value = active.getAttribute(attr);
    if (value !== null) {
      const cssValue = value.replace(/["\\]/g, '\\$&');
      return `[${attr}="${cssValue}"]:not([disabled])`;
    }
  }
  return null;
}

/**
 * Hud-supplied glue: the shared presentation bag plus the window surface (the
 * world reads/commands, trapping focus capture/return, close/teardown chrome,
 * and the watch-change nudge so the HUD tracker repaints without waiting for
 * the slow band).
 */
export interface DeedsWindowDeps extends PainterHostPresentation {
  /** The #deeds-window root (Hud owns the id). */
  root(): HTMLElement;
  /** The live world (offline Sim or online ClientWorld mirror). */
  world(): IWorld;
  closeOthers(): void;
  hideTooltip(): void;
  /** True when this click is the release of a long-press tooltip peek, so the
   *  card's action (watch toggle, title equip) must be SUPPRESSED: holding a
   *  card to read its tooltip must not activate it on release. Wired to the
   *  shared Hud TouchPeekGuard; a plain tap and every desktop click return
   *  false (the bank cell contract). */
  consumePeek(): boolean;
  captureFocus(): HTMLElement | null;
  restoreFocus(target: HTMLElement | null): void;
  /** The watch set changed: repaint the HUD deed tracker now. */
  onWatchChanged(): void;
}

export class DeedsWindow {
  private opened = false;
  private lastSig = '';
  private openerFocus: HTMLElement | null = null;
  private category: DeedDisplayCategory | 'titles' = 'progression';
  private filter: DeedsFilter = 'all';
  private search = '';
  private watchedSet = new Set<string>();
  private watchedKey = '';
  private watchRev = 0;
  // Global rarity, cached per window-open: each fresh open() re-fetches once
  // through the facet (null offline or on failure; the slot renders nothing).
  private rarity: DeedsRarity | null = null;
  private rarityFetchSeq = 0;

  constructor(private readonly deps: DeedsWindowDeps) {}

  get isOpen(): boolean {
    return this.opened;
  }

  /** The live watch set; the HUD tracker reads this each slow-band paint. */
  get watched(): ReadonlySet<string> {
    this.ensureWatchLoaded();
    return this.watchedSet;
  }

  open(category?: DeedDisplayCategory | 'titles'): void {
    if (category) this.category = category;
    if (this.opened) {
      // Re-opening at a section (a chronicler interact while already open)
      // re-renders in place; the open bookkeeping must not re-run.
      this.render();
      return;
    }
    this.deps.closeOthers();
    this.openerFocus = this.deps.captureFocus();
    this.opened = true;
    this.lastSig = '';
    this.fetchRarity();
    this.render();
    this.deps.root().style.display = 'flex';
    // Move keyboard focus into the freshly opened window (onto the close button),
    // matching the sibling cold windows, so a keyboard user is not stranded on the
    // opener while the focus trap is active.
    (this.deps.root().querySelector('[data-close]') as HTMLElement | null)?.focus();
    audio.click();
  }

  /** One rarity fetch per fresh open. The async result repaints in place when
   *  it lands (the signature diff cannot see it, so this render is explicit);
   *  the sequence guard drops a stale response after a close/reopen race. */
  private fetchRarity(): void {
    const seq = ++this.rarityFetchSeq;
    this.rarity = null;
    void this.deps
      .world()
      .deedsRarity()
      .then((rarity) => {
        if (seq !== this.rarityFetchSeq || !this.opened || rarity === null) return;
        this.rarity = rarity;
        this.render();
      })
      .catch(() => {
        /* null-on-failure is the facet contract; a rejection renders nothing */
      });
  }

  close(): void {
    if (!this.opened) return;
    const el = this.deps.root();
    el.style.display = 'none';
    this.opened = false;
    this.deps.hideTooltip();
    this.deps.restoreFocus(this.openerFocus);
    this.openerFocus = null;
  }

  toggle(): void {
    if (this.opened) {
      this.close();
      audio.click();
    } else {
      this.open();
    }
  }

  /** Slow-band refresh: repaint only when the compact signature moves. The
   *  stat digest keeps open-window progress bars live while raw counters
   *  climb between unlocks. Both builders are pure deeds_view exports so
   *  every repaint dimension stays unit-pinned. */
  refreshIfChanged(): void {
    if (!this.opened) return;
    const world = this.deps.world();
    const sig = deedsRefreshSig({
      renown: world.renown,
      earnedCount: world.deedsEarned.size,
      activeTitle: world.activeTitle,
      filter: this.filter,
      search: this.search,
      category: this.category,
      watchRev: this.watchRev,
      statsDigest: deedStatsDigest(world.deedStats),
    });
    if (sig === this.lastSig) return;
    this.lastSig = sig;
    this.render();
  }

  render(): void {
    const el = this.deps.root();
    if (!this.opened) return;
    this.pruneWatchedIfStale();
    const active = document.activeElement as HTMLElement | null;
    const hadFocus = el.contains(active);
    const searchEl = el.querySelector('.deed-search') as HTMLInputElement | null;
    const searchFocus =
      searchEl !== null && active === searchEl
        ? { start: searchEl.selectionStart, end: searchEl.selectionEnd }
        : null;
    // An Enter activation rebuilds the DOM under the focused control, so carry
    // its stable identity attribute across and refocus the role-equivalent
    // fresh control (the social/market/mailbox refocus family). A match that
    // vanished or renders disabled (a watch button at DEED_WATCH_CAP) must not
    // take focus; those fall through to the Close fallback below.
    const refocusSel = hadFocus && searchFocus === null ? refocusSelector(active) : null;
    this.deps.hideTooltip();
    markDialogRoot(el, { label: t('hudChrome.deeds.title') });
    const prevScrollTop = el.querySelector('.deeds-scroll')?.scrollTop ?? 0;

    const model = this.buildModel();
    el.innerHTML =
      `<div class="panel-title"><span>${esc(t('hudChrome.deeds.title'))}</span>` +
      `<input type="search" class="deed-search" value="${esc(this.search)}" placeholder="${esc(t('hudChrome.deeds.searchPlaceholder'))}" aria-label="${esc(t('hudChrome.deeds.searchAria'))}">` +
      `<button type="button" class="x-btn" data-close aria-label="${esc(t('hudChrome.deeds.close'))}">${svgIcon('close')}</button></div>` +
      this.summaryHtml(model) +
      `<div class="deeds-body">${this.railHtml(model)}<div class="deeds-scroll">${this.contentHtml(model)}</div></div>` +
      this.filterBarHtml();

    this.wire(el);
    const scroll = el.querySelector('.deeds-scroll');
    if (scroll) scroll.scrollTop = prevScrollTop;
    if (searchFocus) {
      const fresh = el.querySelector('.deed-search') as HTMLInputElement | null;
      if (fresh) {
        fresh.focus();
        fresh.setSelectionRange(searchFocus.start, searchFocus.end);
      }
    } else if (hadFocus) {
      const fresh = refocusSel === null ? null : el.querySelector<HTMLElement>(refocusSel);
      (fresh ?? (el.querySelector('[data-close]') as HTMLElement | null))?.focus();
    }
  }

  private buildModel(): DeedsViewModel {
    const world = this.deps.world();
    const tag = languageTag(getLanguage());
    this.ensureWatchLoaded();
    return buildDeedsView({
      deedsEarned: world.deedsEarned,
      deedStats: world.deedStats,
      renown: world.renown,
      activeTitle: world.activeTitle,
      deeds: DEEDS,
      order: DEED_ORDER,
      category: this.category,
      filter: this.filter,
      search: this.search.trim().toLocaleLowerCase(tag),
      watched: this.watchedSet,
      searchText: (id) => `${deedName(id)} ${deedDesc(id)}`.toLocaleLowerCase(tag),
    });
  }

  private summaryHtml(model: DeedsViewModel): string {
    const s = model.summary;
    const earned = this.fmt(s.earned);
    const total = this.fmt(s.visibleTotal);
    const pctText = formatNumber(s.completion, { style: 'percent', maximumFractionDigits: 0 });
    const pct = Math.round(s.completion * 100);
    let html =
      `<div class="deeds-summary">` +
      `<span class="deeds-renown">${esc(t('hudChrome.deeds.renownLabel'))} <b>${this.fmt(s.renown)}</b></span>` +
      `<span class="deeds-count">${esc(t('hudChrome.deeds.countLabel', { earned, total }))}</span>` +
      `<span class="deeds-pct" role="img" aria-label="${esc(t('hudChrome.deeds.completionAria', { earned, total }))}">` +
      `<span class="deed-bar deeds-completion"><span class="deed-bar-fill" style="width:${pct}%"></span></span> ${esc(pctText)}</span>` +
      `</div>`;
    if (s.recent.length > 0) {
      const crests = s.recent
        .map(
          (r) =>
            // alt carries the deed name: the strip has no adjacent visible
            // text, so an empty alt would hide the recent unlocks entirely
            // from the accessibility tree.
            `<img class="deed-crest deed-crest-mini" src="${iconDataUrl('crest', r.crestId, DEED_CREST_SIZE)}" alt="${esc(deedName(r.id))}" title="${esc(deedName(r.id))}">`,
        )
        .join('');
      html += `<div class="deeds-recent"><span class="deeds-strip-label">${esc(t('hudChrome.deeds.recentLabel'))}</span>${crests}</div>`;
    }
    if (s.nearest.length > 0) {
      const rows = s.nearest
        .map(
          (n) =>
            `<span class="deeds-nearest-row">${esc(deedName(n.id))} <span class="deed-progress-text">${esc(
              t('hudChrome.deeds.progressText', {
                current: this.fmt(n.progress.current),
                target: this.fmt(n.progress.target),
              }),
            )}</span></span>`,
        )
        .join('');
      html += `<div class="deeds-nearest"><span class="deeds-strip-label">${esc(t('hudChrome.deeds.nearestLabel'))}</span>${rows}</div>`;
    }
    return html;
  }

  private railHtml(model: DeedsViewModel): string {
    const rows = model.categories
      .map((c) => {
        const label = t(CATEGORY_LABEL_KEYS[c.category]);
        const on = this.category === c.category;
        return (
          `<button type="button" class="deeds-cat${on ? ' active' : ''}" data-cat="${c.category}" aria-pressed="${on}" aria-label="${esc(
            t('hudChrome.deeds.categoryCountAria', {
              category: label,
              earned: this.fmt(c.earned),
              visible: this.fmt(c.visible),
            }),
          )}">` +
          `<span class="deeds-cat-name">${esc(label)}</span><span class="deeds-cat-count">${esc(`${this.fmt(c.earned)}/${this.fmt(c.visible)}`)}</span></button>`
        );
      })
      .join('');
    const titlesOn = this.category === 'titles';
    const titlesRow =
      `<button type="button" class="deeds-cat deeds-cat-titles${titlesOn ? ' active' : ''}" data-cat="titles" aria-pressed="${titlesOn}">` +
      `<span class="deeds-cat-name">${esc(t('hudChrome.deeds.titlesSection'))}</span></button>`;
    return `<nav class="deeds-rail" aria-label="${esc(t('hudChrome.deeds.categoriesAria'))}">${rows}${titlesRow}</nav>`;
  }

  private contentHtml(model: DeedsViewModel): string {
    if (this.category === 'titles') return this.titlesHtml(model);
    if (model.entries.length === 0)
      return `<div class="deeds-empty">${esc(t('hudChrome.deeds.emptyCategory'))}</div>`;
    return `<div class="deeds-list">${model.entries.map((entry) => this.entryHtml(entry)).join('')}</div>`;
  }

  private entryHtml(entry: DeedEntryModel): string {
    const name = deedName(entry.id);
    const chips: string[] = [];
    if (entry.feat)
      chips.push(
        `<span class="deed-chip deed-feat">${esc(t('hudChrome.deeds.featRibbon'))}</span>`,
      );
    if (entry.hiddenBadge)
      chips.push(
        `<span class="deed-chip deed-hidden">${esc(t('hudChrome.deeds.hiddenBadge'))}</span>`,
      );
    if (entry.titleReward)
      chips.push(
        `<span class="deed-chip deed-title-chip">${esc(t('hudChrome.deeds.titleChip'))}</span>`,
      );
    // Feats carry no Renown chip (they are zero Renown by rule).
    if (!entry.feat)
      chips.push(
        `<span class="deed-chip deed-renown">${esc(t('hudChrome.deeds.renownChip', { renown: this.fmt(entry.renown) }))}</span>`,
      );
    let body =
      `<div class="deed-head"><span class="deed-name">${esc(name)}</span>${chips.join('')}</div>` +
      `<div class="deed-desc">${esc(deedDesc(entry.id))}</div>`;
    if (entry.progress) {
      const pct = Math.round((entry.progress.current / entry.progress.target) * 100);
      const progressText = t('hudChrome.deeds.progressText', {
        current: this.fmt(entry.progress.current),
        target: this.fmt(entry.progress.target),
      });
      body +=
        `<div class="deed-progress" role="img" aria-label="${esc(
          t('hudChrome.deeds.progressAria', {
            current: this.fmt(entry.progress.current),
            target: this.fmt(entry.progress.target),
          }),
        )}"><span class="deed-bar"><span class="deed-bar-fill" style="width:${pct}%"></span></span>` +
        `<span class="deed-progress-text">${esc(progressText)}</span></div>`;
    }
    // Rarity line: only once a value exists for THIS deed (absent data means
    // no node at all, so offline and fetch-failure renders are unchanged).
    // The render gate is the pure deedRarityFraction, unit-pinned like every
    // other repaint dimension.
    const rarityFraction = deedRarityFraction(this.rarity, entry.id);
    if (rarityFraction !== null) {
      const percent = formatNumber(rarityFraction, {
        style: 'percent',
        maximumFractionDigits: 1,
      });
      body += `<div class="deed-rarity">${esc(t('hudChrome.deeds.rarityLine', { percent }))}</div>`;
    }
    let foot = '';
    if (entry.earnedDay !== null) {
      const date = formatDateTime(new Date(`${entry.earnedDay}T00:00:00Z`), {
        dateStyle: 'medium',
        timeZone: 'UTC',
      });
      foot += `<span class="deed-earned-date">${esc(t('hudChrome.deeds.earnedDate', { date }))}</span>`;
    }
    if (entry.watchable) {
      const atCap = !entry.watched && this.watchedSet.size >= DEED_WATCH_CAP;
      const label = t(entry.watched ? 'hudChrome.deeds.unwatch' : 'hudChrome.deeds.watch');
      const aria = t(entry.watched ? 'hudChrome.deeds.unwatchAria' : 'hudChrome.deeds.watchAria', {
        name,
      });
      const fullNote = atCap
        ? ` disabled title="${esc(t('hudChrome.deeds.watchFull', { cap: this.fmt(DEED_WATCH_CAP) }))}"`
        : '';
      foot += `<button type="button" class="deed-watch${entry.watched ? ' watching' : ''}" data-watch="${esc(entry.id)}" aria-pressed="${entry.watched}" aria-label="${esc(aria)}"${fullNote}>${esc(label)}</button>`;
    }
    if (foot !== '') foot = `<div class="deed-foot">${foot}</div>`;
    return (
      `<div class="deed-card${entry.earned ? ' earned' : ' unearned'}" data-deed="${esc(entry.id)}">` +
      `<img class="deed-crest${entry.earned ? '' : ' desat'}" src="${iconDataUrl('crest', entry.crestId, DEED_CREST_SIZE)}" alt="">` +
      `<div class="deed-main">${body}${foot}</div></div>`
    );
  }

  /** Long-press peek content for a card: the untruncated name + desc (phone
   *  cards ellipsize; the tooltip is the full read). Unknown ids (content
   *  drift between rebuilds) render nothing. */
  private cardTooltipHtml(id: string): string {
    if (id === '') return '';
    return `<b>${esc(deedName(id))}</b><div class="tt-sub">${esc(deedDesc(id))}</div>`;
  }

  private titlesHtml(model: DeedsViewModel): string {
    const rows = model.titles
      .map((option) => {
        const label =
          option.id === null ? t('hudChrome.deeds.titlesNone') : deedTitleText(option.id);
        return `<button type="button" class="deed-title-option${option.active ? ' active' : ''}" data-title="${esc(option.id ?? '')}" aria-pressed="${option.active}">${esc(label)}</button>`;
      })
      .join('');
    const empty =
      model.titles.length <= 1
        ? `<div class="deeds-empty">${esc(t('hudChrome.deeds.titlesEmpty'))}</div>`
        : '';
    return `<div class="deeds-titles" role="group" aria-label="${esc(t('hudChrome.deeds.titlesAria'))}">${rows}${empty}</div>`;
  }

  private filterBarHtml(): string {
    const chips = DEED_FILTERS.map((filter) => {
      const on = this.filter === filter;
      return `<button type="button" class="deed-filter-chip${on ? ' active' : ''}" data-filter="${filter}" aria-pressed="${on}">${esc(t(FILTER_LABEL_KEYS[filter]))}</button>`;
    }).join('');
    return `<div class="deeds-filterbar" role="group" aria-label="${esc(t('hudChrome.deeds.filterGroupAria'))}">${chips}</div>`;
  }

  private wire(el: HTMLElement): void {
    el.querySelector('[data-close]')?.addEventListener('click', () => {
      this.close();
      audio.click();
    });
    const search = el.querySelector('.deed-search') as HTMLInputElement | null;
    search?.addEventListener('input', () => {
      this.search = search.value;
      this.render();
    });
    for (const btn of el.querySelectorAll<HTMLElement>('[data-cat]')) {
      btn.addEventListener('click', () => {
        const cat = btn.dataset.cat ?? '';
        this.category =
          cat === 'titles'
            ? 'titles'
            : (DEED_DISPLAY_CATEGORIES as readonly string[]).includes(cat)
              ? (cat as DeedDisplayCategory)
              : 'progression';
        audio.click();
        this.render();
      });
    }
    for (const btn of el.querySelectorAll<HTMLElement>('[data-filter]')) {
      btn.addEventListener('click', () => {
        const filter = btn.dataset.filter as DeedsFilter;
        this.filter = (DEED_FILTERS as readonly string[]).includes(filter) ? filter : 'all';
        audio.click();
        this.render();
      });
    }
    // Touch long-press peek: holding a card shows its tooltip (name + full
    // desc; card text can truncate on a phone). The release click must then
    // inspect, never activate, so both card actions below consume the guard.
    for (const card of el.querySelectorAll<HTMLElement>('.deed-card')) {
      this.deps.attachTooltip(card, () => this.cardTooltipHtml(card.dataset.deed ?? ''));
    }
    for (const btn of el.querySelectorAll<HTMLElement>('[data-watch]')) {
      btn.addEventListener('click', () => {
        if (this.deps.consumePeek()) {
          this.deps.hideTooltip();
          return;
        }
        const id = btn.dataset.watch;
        if (!id) return;
        this.ensureWatchLoaded();
        const result = toggleWatch(this.watchedSet, id);
        if (!result.changed) return; // the cap arm renders disabled; defensive
        this.watchedSet = new Set(result.watched);
        this.watchRev++;
        this.persistWatched();
        this.deps.onWatchChanged();
        audio.click();
        this.render();
      });
    }
    for (const btn of el.querySelectorAll<HTMLElement>('[data-title]')) {
      btn.addEventListener('click', () => {
        if (this.deps.consumePeek()) {
          this.deps.hideTooltip();
          return;
        }
        const id = btn.dataset.title ?? '';
        // No optimistic local copy: the facet echoes the accepted change (the
        // offline sim synchronously, the mirror on the snapshot echo).
        this.deps.world().setActiveTitle(id === '' ? null : id);
        audio.click();
        this.render();
      });
    }
  }

  private fmt(n: number): string {
    return formatNumber(n, { maximumFractionDigits: 0 });
  }

  private watchKey(): string {
    const world = this.deps.world();
    return `${DEED_WATCH_KEY_PREFIX}_${world.cfg.playerClass}_${world.player.name}`;
  }

  /** Drop earned and catalog-unknown ids where the set meets fresh earned
   *  data, so a filled slot frees up the moment its card loses the unwatch
   *  button (an earned watch must never wedge the cap, in memory or in
   *  storage). On a drop: persist, bump the repaint signature, and nudge the
   *  HUD tracker. */
  private pruneWatchedIfStale(): void {
    this.ensureWatchLoaded();
    const result = pruneWatched(this.watchedSet, this.deps.world().deedsEarned, DEEDS);
    if (!result.changed) return;
    this.watchedSet = new Set(result.watched);
    this.watchRev++;
    this.persistWatched();
    this.deps.onWatchChanged();
  }

  private ensureWatchLoaded(): void {
    const key = this.watchKey();
    if (key === this.watchedKey) return;
    this.watchedKey = key;
    this.watchedSet = new Set();
    try {
      const raw = JSON.parse(localStorage.getItem(key) ?? 'null');
      if (Array.isArray(raw)) {
        for (const id of raw) {
          if (typeof id === 'string' && this.watchedSet.size < DEED_WATCH_CAP)
            this.watchedSet.add(id);
        }
      }
    } catch {
      /* corrupt or unavailable storage: start unwatched */
    }
  }

  private persistWatched(): void {
    try {
      localStorage.setItem(this.watchedKey, JSON.stringify([...this.watchedSet]));
    } catch {
      /* storage unavailable (private mode); the watchlist still works in-session */
    }
  }
}
