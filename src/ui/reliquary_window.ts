// The Reliquary window painter (#reliquary-window): a cold, event-driven
// collection browser over IWorldReliquary + the static RELIQUARY_PAGES catalog,
// the Book of Deeds / Professions family exactly. Full innerHTML rebuild on
// open, on a real data change (refreshIfChanged diffs reliquaryRefreshSig),
// and on language switch; scroll offset of the body survives rebuilds; nothing
// here runs on the per-frame hot path. The pure model lives in
// reliquary_view.ts; this module only paints and wires callbacks through
// injected deps (it never imports Hud and never hardcodes the window id).
//
// Phase 5: page grids (owned art vs quality silhouettes), clear count, live
// signature including ownershipDigest, tooltips that distinguish owned vs
// missing. Unlock toast / Illumination celebration are planned pure in
// reliquary_view and applied by a thin Hud arm.
//
// Phase 13: a silhouette tells you where to get it (one source line per
// authored door, in the missing-cell tooltip AND folded into its aria-label so
// keyboard reaches what hover reaches), a page tells you what it is
// (reliquaryPageDesc on the header and the shelf row), the grid is one roving
// tab stop instead of N, and the shelf
// list is a real ul/li. Relic names come from reliquary_labels.ts, the one
// ladder hud.ts's unlock sites share; page names still come from
// reliquaryPageName(pageId). Search and the owned/missing chips are painter
// state threaded into the pure core, which matches on LOCALIZED text this
// module injects.

import { audio } from '../game/audio';
import { mountDef } from '../sim/content/mounts';
import { RELIQUARY_PAGES, RELIQUARY_PAGES_BY_ID } from '../sim/content/reliquary';
import { WEAPON_SKINS } from '../sim/content/weapon_skins';
import { ITEMS } from '../sim/data';
import type { IWorld, ReliquaryRarity } from '../world_api';
import { deedName } from './deed_i18n';
import { markDialogRoot } from './dialog_root';
import { esc } from './esc';
import { captureFocusKey, focusedWithin, restoreFirstEnabled } from './focus_restore';
import { formatNumber, getLanguage, languageTag, type TranslationKey, t, tPlural } from './i18n';
import { iconDataUrl } from './icons';
import { knownItemDef, ownEntry } from './known_item';
import { ReannounceMarker } from './live_region_reannounce';
import type { PainterHostPresentation } from './painter_host';
import {
  type ReliquaryArtSlot,
  reliquaryCellArt,
  reliquaryCellArtOpaque,
} from './reliquary_cell_art';
import { reliquaryPageDesc, reliquaryPageName } from './reliquary_i18n';
import {
  reliquaryRelicDisplayName,
  reliquaryRelicSearchText,
  reliquarySecondaryClearsLabelKey,
  reliquarySourceAriaText,
  reliquarySourceLines,
} from './reliquary_labels';
import {
  pruneReliquaryPins,
  RELIQUARY_TRACK_CAP,
  toggleReliquaryPin,
} from './reliquary_tracker_view';
import {
  buildReliquaryView,
  CURATOR_BORDER_REWARD,
  CURATOR_RANK_NAME_KEYS,
  curatorRankNameKey,
  isReliquaryNavId,
  isReliquaryOwnedFilter,
  RELIQUARY_NAV,
  RELIQUARY_OWNED_FILTERS,
  type ReliquaryGridCellModel,
  type ReliquaryNavId,
  type ReliquaryNearlyPageModel,
  type ReliquaryOwnedFilter,
  type ReliquaryPageDetailModel,
  type ReliquaryRecentFindModel,
  type ReliquaryShelfCardModel,
  type ReliquaryViewInput,
  type ReliquaryViewModel,
  reliquaryClearsDigest,
  reliquaryFillPct,
  reliquaryFlashKey,
  reliquaryFocusFallbackKey,
  reliquaryObtainCountsDigest,
  reliquaryOwnershipDigest,
  reliquaryPageRarityFraction,
  reliquaryRarityFraction,
  reliquaryRecentSig,
  reliquaryRefreshSig,
  reliquarySecondaryClears,
} from './reliquary_view';
import { rovingTarget } from './roving_index';
import { svgIcon } from './ui_icons';
import {
  BLANK_PIXEL,
  itemIconImgHtml,
  knownItemIconHtml,
  unknownItemIconHtml,
} from './unknown_item_icon';

// Re-export pure rank chrome helpers so existing imports keep resolving.
export { CURATOR_RANK_NAME_KEYS, curatorRankNameKey };

const NAV_LABEL_KEYS: Record<ReliquaryNavId, TranslationKey> = {
  overview: 'hudChrome.reliquary.navOverview',
  conquerors: 'hudChrome.reliquary.navConquerors',
  professions: 'hudChrome.reliquary.navProfessions',
  horizons: 'hudChrome.reliquary.navHorizons',
};

// The SR-only description the relic grid points at, plus the literal key list
// aria-keyshortcuts takes (key VALUES, never localized prose). Both mirror the
// keys roving_index.ts actually owns for orientation 'both'.
const GRID_HINT_ID = 'reliquary-grid-hint';
const GRID_KEY_SHORTCUTS = 'ArrowLeft ArrowRight ArrowUp ArrowDown Home End';

/** Shared empty answer for "nothing flashes this paint", so the common case
 *  (every render but the one after a catalog fill) allocates nothing. */
const NO_FLASH: ReadonlySet<string> = new Set();

/** Pinned pages persist per character (the deeds watchlist storage contract):
 *  `<prefix>_<class>_<name>`, so two characters on one browser keep their own
 *  chase on the HUD tracker. */
const RELIQUARY_PIN_KEY_PREFIX = 'woc_reliquary_pins';

const FILTER_LABEL_KEYS: Record<ReliquaryOwnedFilter, TranslationKey> = {
  all: 'hudChrome.reliquary.filterAll',
  owned: 'hudChrome.reliquary.filterOwned',
  missing: 'hudChrome.reliquary.filterMissing',
};

/**
 * Hud-supplied glue: shared presentation bag plus the window surface (world
 * reads, focus capture/return, close chrome).
 */
export interface ReliquaryWindowDeps extends PainterHostPresentation {
  /** The #reliquary-window root (Hud owns the id). */
  root(): HTMLElement;
  /** The live world (offline Sim or online ClientWorld mirror). */
  world(): IWorld;
  closeOthers(): void;
  hideTooltip(): void;
  /** Shared Hud TouchPeekGuard (wired for parity with peek cards). */
  consumePeek(): boolean;
  captureFocus(): HTMLElement | null;
  restoreFocus(target: HTMLElement | null): void;
  /** Repaint the HUD tracker now, so a pin toggle never waits for the slow
   *  band (the DeedsWindow onWatchChanged contract). */
  onPinChanged(): void;
}

export class ReliquaryWindow {
  private opened = false;
  private lastSig = '';
  private openerFocus: HTMLElement | null = null;
  /** The realm population-rarity aggregate, one fetch per fresh open (the
   *  DeedsWindow rarity pattern): null offline, on failure, and until the
   *  async read lands, and null renders NO rarity nodes at all. */
  private rarity: ReliquaryRarity | null = null;
  private rarityFetchSeq = 0;
  /** Bumped when a fetch lands so the refresh SIGNATURE moves and the slow
   *  band repaints through the normal world-driven path. The landing never
   *  calls render() itself: a direct render would bypass the composing hold,
   *  read as player-driven to the live region, and consume none of the
   *  focus-restore machinery a rebuild owes (the three hazards the fresh
   *  frontend review named). Latency is one band tick, which the population
   *  line can afford. */
  private rarityGen = 0;
  private nav: ReliquaryNavId = 'overview';
  private pageId: string | null = null;
  private search = '';
  private ownedFilter: ReliquaryOwnedFilter = 'all';
  // Roving-tabindex cursor into the CURRENT page grid: exactly one cell is a
  // tab stop, Arrow/Home/End move it. Reset whenever the painted set changes.
  private gridIndex = 0;
  /**
   * The polite region that announces how many items a search or filter left.
   * Minted ONCE and re-appended after every innerHTML write, never emitted into
   * the markup string: a live region has to be registered with the AT BEFORE
   * its text changes, and a node created and mutated inside the same task is
   * unreliable (the #crafting-live / #combat-live precedent, for exactly this
   * reason). Surviving the rebuild is what makes the announcement work at all.
   */
  private liveEl: HTMLElement | null = null;
  /** The shared at-cap pin description target (see ensureCapNote). */
  private capNoteEl: HTMLElement | null = null;
  /** Raised by pinButtonHtml while a paint renders any at-cap control; decides
   *  whether ensureCapNote carries the cap sentence this paint. */
  private anyAtCap = false;
  /** Last LOGICAL (pre-marker) announcement, so a world-driven repaint with an
   *  unchanged count never re-marks the region (see announceResults). */
  private lastAnnounced = '';
  // Forces a byte-different write when two keystrokes narrow to the SAME count,
  // so the region still re-reads (the shared DOM-free deterministic marker).
  private readonly liveReannounce = new ReannounceMarker();
  // The open render must stay silent by DESIGN, not by the accident of the
  // root still being display:none when it writes (see announceResults).
  private suppressAnnounceOnce = false;
  // True while a CJK IME composition is assembling in the search field. The
  // slow band holds its repaint off (refreshIfChanged) so an innerHTML wipe
  // cannot rip the composition session out from under the player.
  private composing = false;
  /**
   * Illumination celebration one-shot (the deeds sticky-id pattern). The id is
   * sticky so the moment survives until the page it belongs to is actually
   * painted (the player may be on Overview, or online the fill may land a
   * snapshot later than the event); the pending flag is consumed by that one
   * paint, so a later rebuild cannot replay the animation. Reduced motion is
   * handled entirely in CSS, which is why nothing here reads matchMedia.
   */
  private celebratePageId: string | null = null;
  private celebratePending = false;
  /**
   * Relic ids catalogued by the drain that is about to repaint, for the cell
   * fill flash. Consumed by the very next render whatever surface that render
   * paints, so ids never accumulate and a second drain simply replaces the
   * first: a flash means "this just happened", and the newest drain is the one
   * that just happened.
   */
  private pendingFlash: ReadonlySet<string> | null = null;
  /**
   * Deep-link one-shot: the page whose header the next paint parks the reading
   * position on (openWithPage, the chat relic and Illumination links). Consumed
   * by that paint whatever it managed to show, so a page the surface could not
   * paint cannot leave the jump latched and yank focus at some arbitrary later
   * render (the deeds focusDeedId contract).
   */
  private focusPageId: string | null = null;
  /**
   * Shelf deep-link one-shot: the rail button the next paint parks the reading
   * position on (a nav-bearing open, today the Curator rank-up chat link). A
   * shelf jump is a navigation and owes the same focus move a page jump makes;
   * without it, a keyboard or screen-reader player who activates the link while
   * the window is ALREADY open perceives nothing at all, because that branch
   * only repaints. Consumed by the paint, and re-placed once the root is
   * visible on a cold open, exactly as focusPageId is.
   */
  private focusNavId: ReliquaryNavId | null = null;
  /**
   * Pinned pages for the HUD tracker, in pin order (a Set preserves insertion
   * order, and that order IS the strip's display order). Loaded lazily per
   * character key, capped at RELIQUARY_TRACK_CAP, and pruned of illuminated
   * pages on every paint: this window owns the store, the tracker only reads it.
   */
  private pinnedSet = new Set<string>();
  private pinnedKey = '';

  constructor(private readonly deps: ReliquaryWindowDeps) {}

  get isOpen(): boolean {
    return this.opened;
  }

  /** The live pin set; the HUD tracker reads this each slow-band paint. */
  get pinned(): ReadonlySet<string> {
    this.ensurePinsLoaded();
    return this.pinnedSet;
  }

  open(nav?: ReliquaryNavId): void {
    if (nav !== undefined) {
      this.nav = nav;
      // A nav-bearing open is a deep link to a SHELF, so the persisted page has
      // to go: the view resolves an open pageId from the WHOLE catalog, so a
      // page belonging to another shelf would otherwise paint under the shelf
      // just asked for (the Phase 13 QA contract, unreachable until deep links
      // landed). A no-arg open() still keeps where-I-was exactly.
      this.pageId = null;
      this.gridIndex = 0;
      // And the needle and ownership chip go with it, exactly as openWithPage
      // clears them: an external link that lands the player on a shelf whose
      // rows are all filtered away reads as a broken link. Only the EXTERNAL
      // jump clears these; the in-window [data-nav] rail buttons are navigation
      // within a search the player is running and keep both.
      this.search = '';
      this.ownedFilter = 'all';
      // A shelf deep link is a navigation, so arm the rail button for it (see
      // focusNavId). This is what makes the ALREADY-OPEN branch below do
      // something a non-sighted player can perceive.
      this.focusNavId = nav;
    }
    // Captured before render() consumes the one-shots: a cold deep link parks
    // focus on the target page header (or the target rail button) instead of
    // Close, and has to re-place it once the root is actually visible (the
    // deeds cold-jump pattern).
    const jumpPageId = this.focusPageId;
    const jumpNav = this.focusNavId;
    if (this.opened) {
      this.render();
      return;
    }
    this.deps.closeOthers();
    this.openerFocus = this.deps.captureFocus();
    this.opened = true;
    this.lastSig = '';
    this.suppressAnnounceOnce = true;
    this.fetchRarity();
    this.render();
    this.deps.root().style.display = 'flex';
    // The page jump outranks the shelf jump. Today at most ONE of the two is
    // ever armed: openWithPage arms focusPageId and then calls open() with no
    // argument, so that path never arms a nav, and a nav-bearing open arms only
    // focusNavId. The || is what settles it if a future caller ever arms both,
    // and it settles it on the page, the more specific promise of the two.
    const landed =
      (jumpPageId !== null && this.spotlightPage(this.deps.root(), jumpPageId)) ||
      (jumpNav !== null && this.spotlightNav(this.deps.root(), jumpNav));
    if (!landed) {
      (this.deps.root().querySelector('[data-close]') as HTMLElement | null)?.focus();
    }
    audio.click();
  }

  /**
   * Open (or refocus) the Reliquary on one page: the chat relic-link and
   * Illumination-link jump, the Book of Deeds openWithDeed shape. Switches to
   * the page's OWN shelf and clears the needle and ownership chip so the page
   * the link promised is guaranteed visible, then parks the reading position
   * on its header after the paint. An id the catalog no longer holds (content
   * drift, a forged wire id) opens the window wherever it last was, unfocused,
   * exactly as a still-masked deed does.
   */
  openWithPage(pageId: string): void {
    if (this.gotoPage(pageId)) {
      this.gridIndex = 0;
      // A needle typed on Overview or a Catalogued chip left on from the last
      // visit can hide the page entirely; the deeds jump clears both for the
      // same reason.
      this.search = '';
      this.ownedFilter = 'all';
      this.focusPageId = pageId;
    }
    if (!this.opened) {
      this.open();
      return;
    }
    this.render();
  }

  /**
   * Move the window onto a catalog page: the ONE state transition the in-window
   * [data-page] rows (recent chips, nearly rows, shelf rows) and the external
   * openWithPage deep link share. The shelf comes from the page record and
   * never from the current rail, so a cross-shelf jump cannot leave the rail
   * pointing at the wrong shelf. False for an id the catalog does not hold.
   *
   * The grid cursor reset is the CALLER's: the in-window rows reset it even for
   * an id that failed to resolve, the deep link only on the arm that moved.
   */
  private gotoPage(pageId: string): boolean {
    const page = RELIQUARY_PAGES.find((p) => p.id === pageId);
    if (!page) return false;
    this.nav = page.shelf;
    this.pageId = page.id;
    return true;
  }

  /**
   * Park the reading position on a page header after paint (the deeds
   * spotlightCard shape): a programmatic tab stop, focus, and a guarded scroll,
   * no flash class (the page detail is the whole surface, not a card in a
   * list). False when that page is not what got painted, so a cold open falls
   * back to its Close park instead of leaving focus nowhere.
   */
  private spotlightPage(el: HTMLElement, pageId: string): boolean {
    if (this.pageId !== pageId) return false;
    const header = el.querySelector<HTMLElement>('.reliquary-page-header');
    if (!header) return false;
    header.tabIndex = -1;
    header.focus({ preventScroll: true });
    // Guarded: jsdom (the focus/behavior test env) ships no scrollIntoView.
    if (typeof header.scrollIntoView === 'function') {
      header.scrollIntoView({ block: 'center' });
    }
    return true;
  }

  /**
   * Park the reading position on a rail button after paint: the spotlightPage
   * shape for a SHELF. No programmatic tab stop is needed (the rail button is
   * already a real control in the tab order), but the scroll is: the rail
   * scrolls on BOTH tiers (a 148px column on desktop, a horizontal strip under
   * mobile-touch), so a shelf past the fold would otherwise be focused while
   * off screen. 'nearest' on both axes leaves an already-visible button exactly
   * where it is. The button is found by its shared data-focus-key rather than a
   * built selector, so a nav id never has to be CSS-escaped. False when this
   * paint holds no such button, so a cold open falls back to its Close park
   * instead of leaving focus nowhere.
   */
  private spotlightNav(el: HTMLElement, nav: ReliquaryNavId): boolean {
    const key = `nav:${nav}`;
    const btn = [...el.querySelectorAll<HTMLElement>('.reliquary-nav')].find(
      (node) => node.dataset.focusKey === key,
    );
    if (!btn) return false;
    btn.focus({ preventScroll: true });
    // Guarded: jsdom (the focus/behavior test env) ships no scrollIntoView.
    if (typeof btn.scrollIntoView === 'function') {
      btn.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
    return true;
  }

  close(): void {
    if (!this.opened) return;
    const el = this.deps.root();
    el.style.display = 'none';
    this.opened = false;
    // Search is per-visit: a needle typed last session must not silently hide
    // most of the catalog on the next open. The ownership chip, shelf, and open
    // page stay put for the session (the deeds policy), because those read as
    // "where I was", not as a filter left switched on.
    this.search = '';
    this.gridIndex = 0;
    // Celebrations are for the live moment: an unspent Illumination or fill
    // flash must not replay as a fanfare on a much-later visit (the banner
    // already covered the event itself).
    this.celebratePageId = null;
    this.celebratePending = false;
    this.pendingFlash = null;
    // Same family, same reason: an armed jump is for the visit it was armed in.
    // Every path arms one immediately before the paint that consumes it, so
    // these are already null here; clearing them bounds the one case that is not
    // (a render that threw between the arm and the consume) to that visit,
    // rather than yanking focus on some unrelated later open.
    this.focusPageId = null;
    this.focusNavId = null;
    // The region must not carry a stale announcement (or a pending reannounce
    // toggle) into the next visit; the NODE persists, its state does not. The
    // cap note gets the same treatment for symmetry (open() re-renders before
    // the root shows, so this is hygiene, not a reachable-state fix).
    if (this.liveEl) this.liveEl.textContent = '';
    if (this.capNoteEl) this.capNoteEl.textContent = '';
    this.lastAnnounced = '';
    this.liveReannounce.reset();
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

  /** One rarity fetch per fresh open (the DeedsWindow rarity pattern). The
   *  landing only stores the aggregate and moves the refresh signature (see
   *  rarityGen); the next slow-band refreshIfChanged paints it with every
   *  rebuild discipline intact. The sequence guard drops a stale response
   *  after a close/reopen race, and the opened check drops one that lands
   *  after close. Null-on-failure is the facet contract: a rejection or null
   *  keeps this.rarity null and nothing renders. */
  private fetchRarity(): void {
    const seq = ++this.rarityFetchSeq;
    this.rarity = null;
    void this.deps
      .world()
      .reliquaryRarity()
      .then((rarity) => {
        if (seq !== this.rarityFetchSeq || !this.opened || rarity === null) return;
        this.rarity = rarity;
        this.rarityGen += 1;
      })
      .catch(() => {
        /* null-on-failure is the facet contract; a rejection renders nothing */
      });
  }

  /**
   * Arm the Illumination celebration for one page. The Hud calls this on the
   * drain that filled the page, immediately before its refreshIfChanged; the
   * class is composed by the next paint of that page's detail and removed on
   * animationend, so no timer, interval, or rAF is involved at any point.
   * The Hud only arms while the window is open (the celebration banner covers
   * the closed case), and close() clears an unspent moment: the arming is
   * sticky across paints within one open window session, never across sessions.
   */
  celebrateIllumination(pageId: string): void {
    this.celebratePageId = pageId;
    this.celebratePending = true;
  }

  /**
   * Arm the fill flash for the relics a drain just catalogued (one-shot).
   * Keys are `kind:id` (the grid cell key), because slot ids are un-namespaced
   * across kinds and a bare id would flash a same-named cell of another kind.
   * A later drain REPLACES an unpainted set rather than accumulating, and an
   * empty list clears it; the Hud call site only fires with a non-empty drain
   * (plan.refreshWindow requires logs), so the clear arm is deliberate reset
   * surface, not a reachable erasure of a pending moment.
   *
   * Deliberately the OPPOSITE stickiness of celebrateIllumination: the flash
   * is consumed by whichever repaint comes next (its cells may not even be on
   * the visible surface), while the celebration stays armed until the paint
   * of ITS page; the pair differs because only the celebration has one true
   * home surface to wait for.
   */
  flashRelics(keys: readonly string[]): void {
    this.pendingFlash = keys.length > 0 ? new Set(keys) : null;
  }

  /** One-shot: true exactly once, on the first paint of the illuminated page. */
  private consumeCelebration(pageId: string): boolean {
    if (!this.celebratePending || this.celebratePageId !== pageId) return false;
    this.celebratePending = false;
    return true;
  }

  /** Slow-band refresh: repaint only when the compact signature moves. */
  refreshIfChanged(): void {
    if (!this.opened) return;
    // A world repaint mid-composition would wipe the field and destroy the
    // IME session; hold the band off until the composition commits (the next
    // band picks the change up).
    if (this.composing) return;
    const input = this.buildInput();
    const sig = this.sigFromInput(input);
    if (sig === this.lastSig) return;
    this.render(input, sig);
  }

  render(prebuilt?: ReliquaryViewInput, prebuiltSig?: string): void {
    const el = this.deps.root();
    if (!this.opened) return;
    // Any full rebuild destroys an in-flight composition along with the old
    // field, whose compositionend will never fire on the fresh one: reset
    // the flag here so a render() from outside wire() (the language fan-out)
    // cannot wedge the slow band's composition hold open forever.
    this.composing = false;
    // Illuminated pins lose their unpin button in the markup below, so the
    // stored set has to shed them here or a finished page would hold a cap slot
    // with no way left to release it (the deeds pruneWatchedIfStale contract).
    this.prunePinsIfStale();
    const focusKey = captureFocusKey(el);
    const hadFocus = focusedWithin(el) !== null;
    // innerHTML wipes the search field, and the shared data-focus-key restore
    // only re-focuses (it cannot know about a caret). Carry the selection range
    // across the rebuild so typing mid-word does not jump to the end, the same
    // special case the Book of Deeds search field needs.
    const searchEl = el.querySelector<HTMLInputElement>('.reliquary-search');
    const caret =
      searchEl !== null && focusKey === 'search'
        ? { start: searchEl.selectionStart, end: searchEl.selectionEnd }
        : null;
    this.deps.hideTooltip();
    markDialogRoot(el, { label: t('hudChrome.reliquary.title') });
    const prevScrollTop = el.querySelector('.reliquary-scroll')?.scrollTop ?? 0;

    const input = prebuilt ?? this.buildInput();
    // The two ownership Sets are minted HERE, on a real repaint, never in
    // buildInput: the slow band builds an input on every poll and elides most
    // of them, and copying the mount list plus the account skin list on a poll
    // that paints nothing is pure waste. Nothing on the signature path reads
    // them (sigFromInput asks the world directly), so change detection is
    // unaffected; the view still receives real Sets.
    const world = this.deps.world();
    const viewInput: ReliquaryViewInput = {
      ...input,
      ownedMounts: new Set(world.ownedMounts()),
      weaponSkins: new Set(world.accountCosmetics.weaponSkinIds),
    };
    const model = buildReliquaryView(viewInput);
    // One-shot, taken before the markup is built: this repaint owns the flash,
    // and a later rebuild (a filter click, the next slow band) must not re-add
    // it. An elided poll simply leaves it armed for the paint that shows the
    // fill, which is the paint the player is waiting for anyway.
    const flash = this.pendingFlash ?? NO_FLASH;
    this.pendingFlash = null;
    // Reset before the markup builds: pinButtonHtml raises it for every at-cap
    // control this paint renders, and ensureCapNote (after the build) writes
    // the cap sentence only when one exists. An unconditional note would leave
    // browse-mode AT reading a false "tracker is full" state on every open.
    this.anyAtCap = false;
    el.innerHTML =
      `<div class="panel-title"><span>${esc(t('hudChrome.reliquary.title'))}</span>` +
      `<input type="search" class="reliquary-search" data-focus-key="search" value="${esc(this.search)}" placeholder="${esc(t('hudChrome.reliquary.searchPlaceholder'))}" aria-label="${esc(t('hudChrome.reliquary.searchAria'))}">` +
      `<button type="button" class="x-btn" data-close data-focus-key="close" aria-label="${esc(t('hudChrome.reliquary.close'))}">${svgIcon('close')}</button></div>` +
      this.summaryHtml(model) +
      `<div class="reliquary-body">${this.railHtml(model)}<div class="reliquary-scroll">${this.contentHtml(model, flash)}</div></div>`;

    // The innerHTML write above orphaned the region; put the SAME node back so
    // the AT keeps the registration it already has, then write into it. The
    // at-cap pin note rides along: every refused pin control names it via
    // aria-describedby, so it must resolve on every paint.
    const live = this.ensureLiveRegion(el);
    el.append(live, this.ensureCapNote(el));
    this.wire(el, model);
    const scroll = el.querySelector('.reliquary-scroll');
    if (scroll) scroll.scrollTop = prevScrollTop;
    // Only refreshIfChanged passes arguments, so a prebuilt input is an exact
    // "this repaint is world-driven, not player-driven" signal.
    this.announceResults(live, model, prebuilt !== undefined);
    this.lastSig = prebuiltSig ?? this.sigFromInput(input);
    if (caret !== null) {
      const fresh = el.querySelector<HTMLInputElement>('.reliquary-search');
      if (fresh) {
        fresh.focus();
        fresh.setSelectionRange(caret.start, caret.end);
      }
    } else if (hadFocus) {
      const keyed = [...el.querySelectorAll<HTMLElement>('[data-focus-key]')];
      const byKey = (key: string | null): HTMLElement | null =>
        key === null ? null : (keyed.find((node) => node.dataset.focusKey === key) ?? null);
      const exact = byKey(focusKey);
      // A card or page-jump control does not survive the rebuild it triggers;
      // land on the control that names the destination (the shelf's rail
      // button, the page's Back button) instead of falling through to Close.
      const fallback = exact === null ? byKey(reliquaryFocusFallbackKey(focusKey)) : null;
      restoreFirstEnabled([exact, fallback, el.querySelector<HTMLElement>('[data-close]')]);
      // A restored grid cell becomes the roving tab stop, so the one tab stop
      // follows the player's last cell instead of snapping back to the first.
      this.syncGridRoving(el, focusKey);
    }
    // The deep-link one-shots, taken LAST so the jump outranks the key-based
    // restore above, and released whatever this paint managed to show. A cold
    // open re-places them once the root is visible (see open()).
    const jumpPageId = this.focusPageId;
    this.focusPageId = null;
    const jumpNav = this.focusNavId;
    this.focusNavId = null;
    if (jumpPageId !== null) {
      this.spotlightPage(el, jumpPageId);
    } else if (jumpNav !== null) {
      this.spotlightNav(el, jumpNav);
    }
  }

  /** The persistent polite region (see liveEl), minted once from the root's own
   *  document rather than the `document` global, which this painter must not
   *  touch (the src/ui host-classification sweep) and which would also pin the
   *  node to the wrong document in a multi-document host. */
  private ensureLiveRegion(el: HTMLElement): HTMLElement {
    const existing = this.liveEl;
    if (existing) return existing;
    const node = el.ownerDocument.createElement('span');
    node.className = 'visually-hidden';
    node.dataset.reliquaryLive = '1';
    node.setAttribute('role', 'status');
    node.setAttribute('aria-live', 'polite');
    node.setAttribute('aria-atomic', 'true');
    this.liveEl = node;
    return node;
  }

  /** The shared at-cap description target: one visually-hidden note every
   *  refused pin control names via aria-describedby, minted once like the live
   *  region and re-appended after each innerHTML rebuild so the references
   *  always resolve. The text is rewritten per render (cold path) so a
   *  language switch relabels it, and it is EMPTY on a paint with no at-cap
   *  control: the clip-only class keeps the node in the accessibility tree, so
   *  an unconditional sentence would read a false full state to browse-mode
   *  AT. The id is document-global by construction: Hud instantiates this
   *  window exactly once per document (the deed-tracker precedent), and a
   *  second instance would need a root-derived id. */
  private ensureCapNote(el: HTMLElement): HTMLElement {
    let node = this.capNoteEl;
    if (!node) {
      node = el.ownerDocument.createElement('span');
      node.className = 'visually-hidden';
      node.id = 'reliquary-pin-cap-note';
      this.capNoteEl = node;
    }
    node.textContent = this.anyAtCap
      ? t('hudChrome.reliquary.pinFull', { cap: this.fmt(RELIQUARY_TRACK_CAP) })
      : '';
    return node;
  }

  /**
   * Announce how many items survived a narrowing, then keep quiet.
   *
   * The gate is what the PAINTED SURFACE actually narrowed, never the persisted
   * chip or the mere presence of a needle: ownedFilter survives a Back click,
   * and a needle that matches everything narrows nothing. Every surface asks
   * the model's own answer about this paint: the grid through
   * pageDetail.filtered, the shelf and Overview through model.filtered.
   *
   * The render that opens the window is exempt (suppressAnnounceOnce): a
   * persisted chip or page is state the player left behind, not a narrowing
   * they just performed, and announcing it at open would read out a count
   * nobody asked for. The text still latches so the next world-driven repaint
   * with the same count stays silent.
   *
   * Cold path only (called from render), never the per-frame band.
   */
  private announceResults(
    live: HTMLElement,
    model: ReliquaryViewModel,
    worldDriven: boolean,
  ): void {
    // Overview never paints a grid even if a pageId lingers in state, so the
    // strips answer for the painted surface there (defense in depth: no
    // current caller reaches Overview with a page selected).
    const narrowed =
      model.nav !== 'overview' && model.pageDetail ? model.pageDetail.filtered : model.filtered;
    if (this.suppressAnnounceOnce) {
      this.suppressAnnounceOnce = false;
      this.lastAnnounced = narrowed
        ? tPlural('hudChrome.plurals.reliquarySearchResults', this.announceCount(model), {
            count: this.fmt(this.announceCount(model)),
          })
        : '';
      return;
    }
    if (!narrowed) {
      // Nothing is narrowed: clear the region and forget the last text, so
      // re-narrowing to the same count later still announces cleanly.
      live.textContent = '';
      this.lastAnnounced = '';
      this.liveReannounce.reset();
      return;
    }
    const count = this.announceCount(model);
    // Raw count to tPlural (it is what Intl.PluralRules selects on); the
    // VISIBLE number is the locale-formatted override.
    const text = tPlural('hudChrome.plurals.reliquarySearchResults', count, {
      count: this.fmt(count),
    });
    // A world-driven repaint (slow-band signature move: ownership, clears,
    // rank) with an UNCHANGED count must not touch the region: the marker
    // returns byte-different text for identical input on purpose, and writing
    // it would make the reader re-read "N results." the player never asked
    // about. Player-driven renders always mark, so two keystrokes landing on
    // the same count still announce.
    if (worldDriven && text === this.lastAnnounced) return;
    this.lastAnnounced = text;
    live.textContent = this.liveReannounce.mark(text);
  }

  /** The one definition of what a narrowed surface counts. Overview counts
   *  its strips even if a pageId lingers unpainted in state (same defense as
   *  the narrowed gate above). */
  private announceCount(model: ReliquaryViewModel): number {
    if (model.nav === 'overview') return model.recent.length + model.nearly.length;
    return model.pageDetail ? model.pageDetail.cells.length : model.shelfPages.length;
  }

  /** Point the roving tab stop at the grid cell the focus-key restore landed
   *  on, then re-stamp every cell's tabindex. Matching on the captured key
   *  rather than the live activeElement keeps this painter free of direct
   *  browser globals and is exact: restoreFirstEnabled may have fallen through
   *  to Close, and a Close fallback must not move the grid cursor. */
  private syncGridRoving(el: HTMLElement, focusKey: string | null): void {
    if (focusKey === null || !focusKey.startsWith('cell:')) return;
    const cells = [...el.querySelectorAll<HTMLElement>('[data-cell-id]')];
    if (cells.length === 0) return;
    const restored = cells.findIndex((node) => node.dataset.focusKey === focusKey);
    if (restored >= 0) this.gridIndex = restored;
    this.stampGridTabIndex(cells);
  }

  /** Exactly one cell is tabbable; the rest are reachable only by Arrow keys.
   *  Write-elided: only the two cells whose stop actually moved are touched. */
  private stampGridTabIndex(cells: readonly HTMLElement[]): void {
    const active = Math.min(Math.max(this.gridIndex, 0), cells.length - 1);
    this.gridIndex = active;
    cells.forEach((node, i) => {
      const want = i === active ? 0 : -1;
      if (node.tabIndex !== want) node.tabIndex = want;
    });
  }

  /** True when a real (non-whitespace) search needle is active. One definition,
   *  because buildInput trims before filtering: a site testing the untrimmed
   *  field would call a whitespace-only search "active" and swap in the
   *  no-results copy for a surface that is empty for an unrelated reason. */
  private searchActive(): boolean {
    return this.search.trim() !== '';
  }

  /**
   * The CHEAP half of the input: live references and closures only, no copies.
   * Every slow-band poll builds one of these and most of them are then elided,
   * so the two ownership Sets the view needs are attached by render() instead
   * (see the comment there). Both halves are the same ReliquaryViewInput type;
   * the Set fields are simply absent here, which the optional members allow.
   */
  private buildInput(): ReliquaryViewInput {
    const world = this.deps.world();
    const tag = languageTag(getLanguage());
    // Horizons ownership: live seams only (no parallel discovery set).
    // Mounts = ownedMounts(); skins = account cosmetics (empty offline/stub);
    // titles = deedsEarned for deeds with title rewards.
    return {
      pages: RELIQUARY_PAGES,
      itemsDiscovered: world.deedStats.itemsDiscovered,
      marks: world.reliquaryMarks,
      recent: world.reliquaryRecent,
      nav: this.nav,
      pageId: this.pageId,
      // Needle and haystack fold with the SAME locale tag (the deeds_window
      // contract). Plain toLowerCase would break Turkish dotted/dotless I, so a
      // tr_TR player's own keystrokes would miss their own relic names.
      search: this.search.trim().toLocaleLowerCase(tag),
      ownedFilter: this.ownedFilter,
      // The pure core filters on LOCALIZED text it never resolves itself (the
      // deeds_view searchText contract): a player types the names their client
      // shows them, not the catalog's English. Page text is name PLUS blurb,
      // because the row now renders the blurb as its second line and a phrase a
      // player can read on the row has to be searchable.
      pageSearchText: (pageId) =>
        `${reliquaryPageName(pageId)} ${reliquaryPageDesc(pageId)}`.toLocaleLowerCase(tag),
      relicSearchText: (kind, id) => reliquaryRelicSearchText(kind, id, tag),
      clearCount: (pageId) => world.reliquaryPageClearCount(pageId),
      // The display-only second meter for pages whose def carries a
      // secondaryClearSource: read straight off the deeds facet's counter
      // block (both worlds already mirror it; zero IWorld change). The
      // validation and flooring live in the pure core, so a Vitest can drive
      // every refusal arm without a window.
      secondaryClearCount: (pageId) =>
        reliquarySecondaryClears(
          Object.hasOwn(RELIQUARY_PAGES_BY_ID, pageId) ? RELIQUARY_PAGES_BY_ID[pageId] : undefined,
          world.deedStats.counters,
        ),
      firstFind: world.reliquaryFirstFind,
      // Live reference, never a copy: this half of the input is built on every
      // slow-band poll and most of them elide, so the record is read only when
      // a rebuild actually walks the cells (and by the digest below, which
      // folds it in place).
      obtainCounts: world.reliquaryObtainCounts,
      deedsEarned: world.deedsEarned,
    };
  }

  private sigFromInput(input: ReliquaryViewInput): string {
    const world = this.deps.world();
    const catalog = world.reliquaryCatalogCompletion();
    // Clear meters paint on shelf/page; digest so a pure clear bump
    // (no ownership change) still refreshes an open window. The pure fold
    // (reliquary_view.ts) takes BOTH meters, so a secondary-only move
    // repaints an open header too (the stale-header trap).
    const clearsDigest = reliquaryClearsDigest(
      input.pages,
      input.clearCount,
      input.secondaryClearCount,
    );
    // Counted in place: Object.keys would mint a throwaway array of every
    // first-find id on every slow-band poll, including the many that elide.
    // The hasOwn guard keeps the count own-keys-only, matching what
    // Object.keys counted (for..in alone would also walk an enumerable
    // prototype chain if a future mirror shape ever grew one).
    let firstFindCount = 0;
    for (const id in world.reliquaryFirstFind) {
      if (Object.hasOwn(world.reliquaryFirstFind, id)) firstFindCount += 1;
    }
    const pageOwned =
      input.pageId !== null ? (world.reliquaryPageCompletion(input.pageId)?.owned ?? 0) : 0;
    const ownershipDigest = reliquaryOwnershipDigest({
      discoveredSize: world.deedStats.itemsDiscovered.size,
      marksSize: world.reliquaryMarks.size,
      firstFindCount,
      pageOwned,
    });
    return (
      reliquaryRefreshSig({
        owned: catalog.owned,
        total: catalog.total,
        curatorRank: world.reliquaryCuratorRank(),
        recentSig: reliquaryRecentSig(input.recent),
        marksSize: world.reliquaryMarks.size,
        nav: input.nav,
        pageId: input.pageId,
        clearsDigest,
        ownershipDigest,
        // A repeat obtain of a relic already on the wall moves nothing else in
        // this signature: no set grows, no first-find key is minted, no total
        // changes. Without this dimension an open window would keep painting the
        // previous tally until something unrelated happened to repaint it.
        countsDigest: reliquaryObtainCountsDigest(world.reliquaryObtainCounts),
        search: input.search,
        ownedFilter: input.ownedFilter,
        // Painter-side dimension: the rarity aggregate is window state (fetched
        // per open), not world state, so the generation rides here rather than
        // in the pure sig fold.
      }) + `|r${this.rarityGen}`
    );
  }

  /**
   * The one meter this window draws (summary, page header, nearly row, shelf
   * card). The fill rides a custom property instead of an inline width so the
   * stylesheet owns the geometry: it is the only inline style in the painter,
   * and a single declaration in one rule now covers every bar.
   */
  private barHtml(pct: number, extraClass = ''): string {
    const cls = extraClass === '' ? 'reliquary-bar' : `reliquary-bar ${extraClass}`;
    return (
      `<span class="${cls}">` +
      `<span class="reliquary-bar-fill" style="--reliquary-fill:${pct}%"></span></span>`
    );
  }

  /** The pure core owns the percent (rounding, empty-pair zero); the painter
   *  only threads it into barHtml. */
  private pctOf(owned: number, total: number): number {
    return reliquaryFillPct(owned, total);
  }

  private summaryHtml(model: ReliquaryViewModel): string {
    const p = model.progress;
    const owned = this.fmt(p.owned);
    const total = this.fmt(p.total);
    const pctText = formatNumber(p.fraction, { style: 'percent', maximumFractionDigits: 0 });
    const pct = this.pctOf(p.owned, p.total);
    const rankLabel =
      p.curatorRank > 0
        ? t(curatorRankNameKey(p.curatorRank), { rank: this.fmt(p.curatorRank) })
        : t('hudChrome.reliquary.curatorUnranked');
    const sealAttr = p.curatorSealId ? ` data-seal="${esc(p.curatorSealId)}"` : '';
    const sealClass = p.curatorSealId ? ' has-seal' : '';
    return (
      `<div class="reliquary-summary${sealClass}"${sealAttr}>` +
      `<span class="reliquary-count">${esc(t('hudChrome.reliquary.countLabel', { owned, total }))}</span>` +
      `<span class="reliquary-rank" data-rank="${p.curatorRank}">` +
      `<span class="reliquary-rank-seal" aria-hidden="true"></span>` +
      `${esc(rankLabel)}</span>` +
      `<span class="reliquary-pct" role="img" aria-label="${esc(t('hudChrome.reliquary.completionAria', { owned, total }))}">` +
      this.barHtml(pct) +
      ` ${esc(pctText)}</span>` +
      `</div>`
    );
  }

  private railHtml(model: ReliquaryViewModel): string {
    const rows = model.shelves
      .map((s) => {
        const label = t(NAV_LABEL_KEYS[s.id]);
        const on = this.nav === s.id;
        const count =
          s.id === 'overview'
            ? ''
            : `<span class="reliquary-nav-count">${esc(
                t('hudChrome.reliquary.progressText', {
                  owned: this.fmt(s.owned),
                  total: this.fmt(s.total),
                }),
              )}</span>`;
        const aria =
          s.id === 'overview'
            ? label
            : t('hudChrome.reliquary.navCountAria', {
                shelf: label,
                owned: this.fmt(s.owned),
                total: this.fmt(s.total),
              });
        return (
          `<button type="button" class="reliquary-nav${on ? ' active' : ''}" data-nav="${esc(s.id)}" data-focus-key="${esc(`nav:${s.id}`)}" aria-pressed="${on}" aria-label="${esc(aria)}">` +
          `<span class="reliquary-nav-name">${esc(label)}</span>${count}</button>`
        );
      })
      .join('');
    return `<nav class="reliquary-rail" aria-label="${esc(t('hudChrome.reliquary.shelvesAria'))}">${rows}</nav>`;
  }

  private contentHtml(model: ReliquaryViewModel, flash: ReadonlySet<string>): string {
    if (model.nav === 'overview') return this.overviewHtml(model);
    if (model.pageDetail) {
      // The illuminated gate keeps the one-shot ARMED when the event frame
      // outruns the snapshot (online, the model can still read incomplete on
      // this paint): consuming then would play the celebration on a page
      // whose standing frame is absent, and the keyframe's end state would
      // vanish at animationend instead of settling into is-illuminated.
      return this.pageDetailHtml(
        model.pageDetail,
        model.pageDetail.illuminated && this.consumeCelebration(model.pageDetail.pageId),
        flash,
      );
    }
    return this.shelfListHtml(model);
  }

  private overviewHtml(model: ReliquaryViewModel): string {
    // Asked ONCE for the whole Overview and handed down: the two strip hints
    // and the no-results line must agree about whether a needle is live, and
    // three separate asks are three chances to drift.
    const searching = this.searchActive();
    // When BOTH strips sit empty under a live needle the whole-Overview
    // searchEmpty line below renders (whether the needle emptied them or they
    // never held anything); a strip the needle emptied announces its own
    // stripNoMatch only while the other strip still shows matches, and a
    // STRUCTURALLY empty strip keeps its "nothing yet" hint even while a
    // needle is live (that hint stays true and must not flicker into a false
    // "no match" as the player types). On a fresh character with a needle the
    // paint is therefore both structural hints PLUS the shared line: four
    // individually true statements, pinned as a composition.
    const bothEmpty = model.recent.length === 0 && model.nearly.length === 0;
    const searchEmptyShown = searching && bothEmpty;
    const recentHint = this.stripHintKey(
      model.recent.length === 0,
      model.recentEmptiedBySearch,
      searchEmptyShown,
      'hudChrome.reliquary.recentEmpty',
    );
    const nearlyHint = this.stripHintKey(
      model.nearly.length === 0,
      model.nearlyEmptiedBySearch,
      searchEmptyShown,
      'hudChrome.reliquary.nearlyEmpty',
    );
    let html = `<section class="reliquary-overview">`;
    // Why a page can be full while the catalog total is smaller than the slot
    // sum: a relic shown on two pages is ONE relic. Said once, quietly, where
    // the two numbers sit side by side. Unconditional: the shelf denominators
    // disagree with the catalog total from the very first open (the slot sum
    // runs above the de-duplicated relic total; both are pinned in
    // tests/reliquary_content.test.ts rather than quoted here, because catalog
    // growth moves them), so the player at 0 owned needs the explanation too.
    html += `<p class="reliquary-uniques-note">${esc(t('hudChrome.reliquary.sharedUniquesNote'))}</p>`;
    // The rank whose deed bridge rewards a nameplate border says so once the
    // rank is held: the summary strip names the rank but never tells the
    // player the border exists or where it is worn. Same line the rank-up
    // moment logs, so the durable surface and the moment cannot drift.
    if (
      CURATOR_BORDER_REWARD !== null &&
      model.progress.curatorRank >= CURATOR_BORDER_REWARD.rank
    ) {
      html += `<p class="reliquary-border-note">${esc(
        t('hudChrome.reliquary.borderWearableNote', {
          name: deedName(CURATOR_BORDER_REWARD.deedId),
        }),
      )}</p>`;
    }
    html += this.recentStripHtml(model.recent, recentHint);
    html += this.nearlyStripHtml(model.nearly, nearlyHint);
    html += this.shelfCardsHtml(model.shelfCards);
    if (searching && bothEmpty) {
      // Both strips empty under a live needle gets the one shared line, even
      // when the strips were empty to begin with (the typed needle earns an
      // acknowledgement either way); a needle that emptied a single strip is
      // answered inside that strip (stripNoMatch), and the needle-less
      // "nothing yet" case per strip (recentEmpty / nearlyEmpty), where the
      // hint sits next to the label it explains. Literal keys, never a
      // template-built key behind an `as TranslationKey`: the cast would let a
      // catalog rename pass tsc and throw at runtime on the first missed
      // search.
      html += `<p class="reliquary-empty">${esc(t('hudChrome.reliquary.searchEmpty'))}</p>`;
    }
    html += `</section>`;
    return html;
  }

  /** The strip label ALWAYS renders: an Overview whose first section appears
   *  only after the first find reads as a broken window, and the hint is what
   *  tells a new player the shelf exists and how it fills. */
  private stripHintHtml(key: TranslationKey | null): string {
    if (key === null) return '';
    return `<span class="reliquary-strip-hint">${esc(t(key))}</span>`;
  }

  /** Which hint an empty strip shows: the structural "nothing yet" line when
   *  the strip would be empty with no needle too (true regardless of search),
   *  its own no-match line when THE NEEDLE emptied it, and none when the
   *  shared searchEmpty line already answers for both. */
  private stripHintKey(
    empty: boolean,
    emptiedBySearch: boolean,
    searchEmptyShown: boolean,
    emptyKey: TranslationKey,
  ): TranslationKey | null {
    if (!empty) return null;
    if (!emptiedBySearch) return emptyKey;
    return searchEmptyShown ? null : 'hudChrome.reliquary.stripNoMatch';
  }

  private recentStripHtml(
    recent: readonly ReliquaryRecentFindModel[],
    hintKey: TranslationKey | null,
  ): string {
    const chips = recent.map((r) => this.recentItemHtml(r)).join('');
    const hint = this.stripHintHtml(hintKey);
    return (
      `<div class="reliquary-recent">` +
      `<span class="reliquary-strip-label">${esc(t('hudChrome.reliquary.recentLabel'))}</span>` +
      hint +
      chips +
      `</div>`
    );
  }

  /**
   * One recent find. A find the catalog can place is a real jump button (the
   * shared [data-page] wiring takes it from here, including the cross-shelf
   * hop); one it cannot stays an inert chip rather than a control that goes
   * nowhere. Both carry the icon and the same tooltip.
   *
   * No title="" on either: the invariant bans native title tooltips. The name
   * wraps fully visible inside the chip (nothing truncates; the CSS pin bans
   * it), and data-recent-name feeds the shared HUD tooltip in wire().
   */
  private recentItemHtml(find: ReliquaryRecentFindModel): string {
    const name = reliquaryRelicDisplayName(find.kind, find.id);
    const body =
      `<span class="reliquary-recent-icon" aria-hidden="true">` +
      `${this.cellIconHtml(find, this.cellQuality(find))}</span>` +
      `<span class="reliquary-recent-name">${esc(name)}</span>`;
    if (find.pageId === null) {
      return `<span class="reliquary-recent-item" data-recent-name="${esc(name)}">${body}</span>`;
    }
    return (
      `<button type="button" class="reliquary-recent-item" data-page="${esc(find.pageId)}" ` +
      `data-recent-name="${esc(name)}" data-focus-key="${esc(`recent:${find.kind}:${find.id}`)}" ` +
      `aria-label="${esc(t('hudChrome.reliquary.recentJumpAria', { name }))}">${body}</button>`
    );
  }

  private nearlyStripHtml(
    nearly: readonly ReliquaryNearlyPageModel[],
    hintKey: TranslationKey | null,
  ): string {
    const rows = nearly
      .map((n) => {
        const progress = t('hudChrome.reliquary.progressText', {
          owned: this.fmt(n.owned),
          total: this.fmt(n.total),
        });
        // Raw count to tPlural (it is what Intl.PluralRules selects on); the
        // VISIBLE number is the locale-formatted override.
        const toGo = tPlural('hudChrome.plurals.reliquaryToGo', n.remaining, {
          count: this.fmt(n.remaining),
        });
        // Page names resolve from the id at paint time (reliquary_i18n), never
        // from the model's raw catalog English.
        const name = reliquaryPageName(n.pageId);
        return (
          `<button type="button" class="reliquary-nearly-row" data-page="${esc(n.pageId)}" data-focus-key="${esc(`nearly:${n.pageId}`)}" aria-label="${esc(
            t('hudChrome.reliquary.nearlyJumpAria', {
              name,
              owned: this.fmt(n.owned),
              total: this.fmt(n.total),
            }),
          )}">` +
          `<span class="reliquary-nearly-name">${esc(name)}</span>` +
          // The meter and both readouts are inside a button whose aria-label
          // already states the pair, so they are visual only and need no
          // further labeling of their own.
          this.barHtml(this.pctOf(n.owned, n.total)) +
          `<span class="reliquary-progress-text">${esc(progress)}</span>` +
          `<span class="reliquary-to-go">${esc(toGo)}</span></button>`
        );
      })
      .join('');
    const hint = this.stripHintHtml(hintKey);
    return (
      `<div class="reliquary-nearly">` +
      `<span class="reliquary-strip-label">${esc(t('hudChrome.reliquary.nearlyLabel'))}</span>` +
      hint +
      rows +
      `</div>`
    );
  }

  /**
   * The three shelf cards: where the Overview stops being a strip of leftovers
   * and becomes the way into the catalog. Always all three, in the model's
   * order (which is the rail's order), each one a real nav button the shared
   * [data-nav] wiring already drives.
   */
  private shelfCardsHtml(cards: readonly ReliquaryShelfCardModel[]): string {
    const rows = cards
      .map((card) => {
        const owned = this.fmt(card.owned);
        const total = this.fmt(card.total);
        const name = t(NAV_LABEL_KEYS[card.shelf]);
        const progress = t('hudChrome.reliquary.progressText', { owned, total });
        // Three-way latest line, chosen so the card can never contradict the
        // pair printed above it: the recent ring receives ONLY item and mark
        // first-finds (pushRecent's two call sites), so a Horizons find
        // (mounts, skins, titles) can never appear here, and a retro-seeded
        // veteran has owned > 0 with an empty ring on every shelf. Render the
        // find when the ring knows one, say "nothing yet" only when the count
        // agrees (owned 0), and otherwise say nothing at all.
        const latest =
          card.recentId !== null && card.recentKind !== null
            ? t('hudChrome.reliquary.shelfRecent', {
                name: reliquaryRelicDisplayName(card.recentKind, card.recentId),
              })
            : card.owned === 0
              ? t('hudChrome.reliquary.shelfNoFinds')
              : null;
        // The aria-label replaces the subtree as the accessible name, which
        // would hide the latest-find line (new information, not a restatement
        // of the pair); aria-describedby folds it back in after the name.
        const recentDomId = `reliquary-shelf-recent-${card.shelf}`;
        return (
          `<button type="button" class="reliquary-shelf-card" data-nav="${esc(card.shelf)}" ` +
          `data-focus-key="${esc(`card:${card.shelf}`)}" aria-label="${esc(
            t('hudChrome.reliquary.shelfOpenAria', { name, owned, total }),
          )}"${latest !== null ? ` aria-describedby="${esc(recentDomId)}"` : ''}>` +
          `<span class="reliquary-shelf-card-name">${esc(name)}</span>` +
          `<span class="reliquary-progress-text">${esc(progress)}</span>` +
          this.barHtml(this.pctOf(card.owned, card.total)) +
          (latest !== null
            ? `<span class="reliquary-shelf-card-recent" id="${esc(recentDomId)}">${esc(latest)}</span>`
            : '') +
          `</button>`
        );
      })
      .join('');
    return `<div class="reliquary-shelf-cards">${rows}</div>`;
  }

  private shelfListHtml(model: ReliquaryViewModel): string {
    if (model.shelfPages.length === 0) {
      return `<div class="reliquary-empty">${esc(
        this.searchActive()
          ? t('hudChrome.reliquary.searchEmpty')
          : t('hudChrome.reliquary.shelfEmpty'),
      )}</div>`;
    }
    // A real ul/li list, the professions window's structure: the row stays a
    // button (button semantics, one tab stop each) inside its own listitem, so
    // a screen reader announces "list, N items" instead of finding bare buttons
    // under a role="list" that owns no listitem children.
    const rows = model.shelfPages
      .map((page) => {
        const progress = t('hudChrome.reliquary.progressText', {
          owned: this.fmt(page.owned),
          total: this.fmt(page.total),
        });
        const clears =
          page.clears !== undefined
            ? `<span class="reliquary-clears">${esc(t('hudChrome.reliquary.clearsLabel', { count: this.fmt(page.clears) }))}</span>`
            : '';
        const done = page.complete
          ? `<span class="reliquary-complete-badge">${esc(t('hudChrome.reliquary.pageComplete'))}</span>`
          : '';
        const desc = reliquaryPageDesc(page.pageId);
        const sub = desc === '' ? '' : `<span class="reliquary-page-sub">${esc(desc)}</span>`;
        return (
          `<li class="reliquary-page-item">` +
          `<button type="button" class="reliquary-page-row" data-page="${esc(page.pageId)}" data-focus-key="${esc(`page:${page.pageId}`)}">` +
          `<span class="reliquary-page-main">` +
          `<span class="reliquary-page-name">${esc(reliquaryPageName(page.pageId))}</span>${sub}` +
          `</span>` +
          `<span class="reliquary-page-meta">` +
          `<span class="reliquary-progress-text">${esc(progress)}</span>${clears}${this.outsideCompletionChipHtml(page.pageId)}${done}` +
          `</span></button>${this.pinButtonHtml(page.pageId, page.complete)}</li>`
        );
      })
      .join('');
    return `<ul class="reliquary-page-list" role="list" aria-label="${esc(t(NAV_LABEL_KEYS[model.nav]))}">${rows}</ul>`;
  }

  /**
   * The pin control for one page: a SIBLING of the page row (never nested; the
   * row is itself a button), and absent entirely on an illuminated page, which
   * is exactly what retires it from the HUD tracker (the deeds unwatch-button
   * contract). At the cap an unpinned page renders aria-disabled (still a tab
   * stop) with the cap note on aria-describedby, so the refusal is reachable
   * and perceivable rather than a dead click.
   */
  private pinButtonHtml(pageId: string, complete: boolean): string {
    if (complete) return '';
    this.ensurePinsLoaded();
    const pinned = this.pinnedSet.has(pageId);
    const atCap = !pinned && this.pinnedSet.size >= RELIQUARY_TRACK_CAP;
    if (atCap) this.anyAtCap = true;
    const name = reliquaryPageName(pageId);
    const label = t(pinned ? 'hudChrome.reliquary.unpin' : 'hudChrome.reliquary.pin');
    // The accessible name stays the ACTION (so it always contains the visible
    // "Pin" label); at the cap the refusal rides aria-describedby to the shared
    // cap note, and aria-disabled (never native disabled) keeps the control a
    // tab stop so a keyboard player still reaches the reason. The reason never
    // rides a native title attribute (this window's rule: the HUD cannot style,
    // position, or dismiss one, and touch never sees it).
    const aria = t(pinned ? 'hudChrome.reliquary.unpinAria' : 'hudChrome.reliquary.pinAria', {
      name,
    });
    return (
      `<button type="button" class="reliquary-pin${pinned ? ' pinned' : ''}" data-pin="${esc(pageId)}" ` +
      `data-focus-key="${esc(`pin:${pageId}`)}" aria-pressed="${pinned}" aria-label="${esc(aria)}"` +
      `${atCap ? ' aria-disabled="true" aria-describedby="reliquary-pin-cap-note"' : ''}>${esc(label)}</button>`
    );
  }

  /**
   * The small chip an excludeFromCompletion page carries on its shelf row and
   * page header, resolved off the authored def the way the secondary meter's
   * stat is (the def flag, not a model field): excludeFromCompletion is catalog
   * data, not per-player state. The flag's REASON drives both the hook and the
   * label, so the two kinds of outside-completion page never wear each other's
   * word: 'retired' says Retired, 'personal' says Personal. Same markup family
   * as the Illuminated badge (reliquary-complete-badge), with data-retired /
   * data-personal as the hooks; the chip is plain visible text inside the
   * row/header, which is exactly what a screen reader announces, so no extra
   * aria is minted for it. Empty for every live page.
   */
  private outsideCompletionChipHtml(pageId: string): string {
    const reason = Object.hasOwn(RELIQUARY_PAGES_BY_ID, pageId)
      ? RELIQUARY_PAGES_BY_ID[pageId].excludeFromCompletion
      : undefined;
    if (reason === undefined) return '';
    // Exhaustive over the flag union: a third reason fails to index this
    // record at tsc time instead of silently wearing the Retired chip.
    const chips = {
      retired: { attr: 'data-retired', key: 'hudChrome.reliquary.retiredLabel' },
      personal: { attr: 'data-personal', key: 'hudChrome.reliquary.personalLabel' },
    } as const satisfies Record<'retired' | 'personal', { attr: string; key: string }>;
    const chip = chips[reason];
    return `<span class="reliquary-complete-badge" ${chip.attr}="1">${esc(t(chip.key))}</span>`;
  }

  private pageDetailHtml(
    page: ReliquaryPageDetailModel,
    celebrate: boolean,
    flash: ReadonlySet<string>,
  ): string {
    const progress = t('hudChrome.reliquary.progressText', {
      owned: this.fmt(page.owned),
      total: this.fmt(page.total),
    });
    // Page names resolve from the id at paint time (reliquary_i18n), never from
    // the model's raw catalog English.
    const pageName = reliquaryPageName(page.pageId);
    const pct = this.pctOf(page.owned, page.total);
    const clears =
      page.clears !== undefined
        ? `<p class="reliquary-page-clears">${esc(t('hudChrome.reliquary.clearsLabel', { count: this.fmt(page.clears) }))}</p>`
        : '';
    // The display-only second meter, after the primary, same markup and class
    // (no new CSS). The label key resolves from the def's stat through the
    // membership-guarded ladder in reliquary_labels.ts: an unknown stat
    // renders nothing (fail closed) rather than a wrong sentence.
    const secondaryStat = Object.hasOwn(RELIQUARY_PAGES_BY_ID, page.pageId)
      ? RELIQUARY_PAGES_BY_ID[page.pageId].secondaryClearSource?.stat
      : undefined;
    const secondaryKey =
      secondaryStat !== undefined ? reliquarySecondaryClearsLabelKey(secondaryStat) : null;
    const secondaryClears =
      page.secondaryClears !== undefined && secondaryKey !== null
        ? `<p class="reliquary-page-clears" data-secondary-clears="1">${esc(t(secondaryKey, { count: this.fmt(page.secondaryClears) }))}</p>`
        : '';
    const accountScope = page.accountScoped
      ? `<p class="reliquary-account-scope" data-account-scope="1">${esc(t('hudChrome.reliquary.accountScopeNote'))}</p>`
      : '';
    const done = page.illuminated
      ? `<span class="reliquary-complete-badge reliquary-page-illuminated">${esc(t('hudChrome.reliquary.pageComplete'))}</span>`
      : '';
    // A page tells you what it is: the authored blurb, localized through the
    // reliquary_i18n channel (English fallback until the release locale fill).
    const desc = reliquaryPageDesc(page.pageId);
    const blurb = desc === '' ? '' : `<p class="reliquary-page-desc">${esc(desc)}</p>`;
    // The population line: how much of the realm has illuminated this page.
    // Null (offline, fetch failure, empty population, or a page nobody has
    // illuminated, which permanently covers the personal Riftbound page)
    // renders NO node at all, the deed-rarity omission contract, so offline
    // and pre-fetch paints are byte-identical to the pre-rarity ones. Plain
    // rendered text, so screen readers get it without an aria mirror.
    const pageRarityFraction = reliquaryPageRarityFraction(this.rarity, page.pageId);
    const pageRarity =
      pageRarityFraction === null
        ? ''
        : `<p class="reliquary-page-rarity">${esc(
            t('hudChrome.reliquary.pageRarityLine', {
              percent: formatNumber(pageRarityFraction, {
                style: 'percent',
                maximumFractionDigits: 1,
              }),
            }),
          )}</p>`;
    const activeCell = Math.min(Math.max(this.gridIndex, 0), Math.max(page.cells.length - 1, 0));
    // Roving tabindex on role="list" is not a composite-widget role, so nothing
    // announces the arrow-key model on its own and a sighted keyboard-only
    // player could reach one cell of N without guessing. list/listitem is still
    // the honest mapping (the cells have no row structure and no selection), so
    // the affordance is described rather than the role changed.
    const grid =
      page.cells.length === 0
        ? `<p class="reliquary-empty">${esc(this.emptyGridText(page.filtered))}</p>`
        : `<span id="${GRID_HINT_ID}" class="visually-hidden">${esc(t('hudChrome.reliquary.gridKeyboardHint'))}</span>` +
          `<div class="reliquary-grid" role="list" aria-label="${esc(t('hudChrome.reliquary.gridAria', { name: pageName }))}">${page.cells
            .map((c, i) =>
              this.cellHtml(c, i, activeCell, flash.has(reliquaryFlashKey(c.kind, c.id))),
            )
            .join('')}</div>`;
    return (
      // The celebration class is composed here and nowhere else: it rides one
      // rebuild, and wire() strips it on animationend so a later rebuild of the
      // same page paints the standing illuminated treatment instead of the
      // arrival. Reduced motion is the stylesheet's job (a static bright frame),
      // which is why the gate above never asks the browser about it.
      `<section class="reliquary-page-detail${page.illuminated ? ' is-illuminated' : ''}${page.accountScoped ? ' is-account-scoped' : ''}${celebrate ? ' reliquary-page-celebrate' : ''}">` +
      `<button type="button" class="reliquary-back" data-back data-focus-key="back">${esc(t('hudChrome.reliquary.backToShelf'))}</button>` +
      // tabindex -1 + a focus key: spotlightPage parks the reading position
      // here on a deep link, and the key is what lets a fetch-driven or
      // slow-band rebuild RESTORE that position instead of dropping a
      // keyboard player onto Close moments after they arrived.
      `<header class="reliquary-page-header" tabindex="-1" data-focus-key="page-header">` +
      `<h3 class="reliquary-page-title">${esc(pageName)}</h3>${this.outsideCompletionChipHtml(page.pageId)}${done}` +
      // Same control, same focus key as the shelf row's: the shelf list and a
      // page detail are mutually exclusive surfaces (contentHtml), so one page
      // never renders two pin buttons and the key stays unique per paint.
      this.pinButtonHtml(page.pageId, page.illuminated) +
      `</header>` +
      blurb +
      pageRarity +
      accountScope +
      `<div class="reliquary-page-progress-row" role="img" aria-label="${esc(
        t('hudChrome.reliquary.pageProgressAria', {
          owned: this.fmt(page.owned),
          total: this.fmt(page.total),
        }),
      )}">` +
      `<span class="reliquary-page-progress">${esc(progress)}</span>` +
      this.barHtml(pct, 'reliquary-page-bar') +
      `</div>${clears}${secondaryClears}${this.filterBarHtml()}${grid}` +
      `</section>`
    );
  }

  /**
   * Which "nothing here" line an empty grid shows. Search wins when a needle is
   * live (it is the narrowing the player just performed), then the chip, then
   * the page is genuinely empty. Blaming a search a player never typed, because
   * they clicked Catalogued on a page they own nothing on, sends them looking
   * for a search box to clear.
   */
  private emptyGridText(filtered: boolean): string {
    if (this.searchActive()) return t('hudChrome.reliquary.searchEmpty');
    if (filtered || this.ownedFilter !== 'all') return t('hudChrome.reliquary.filterEmpty');
    return t('hudChrome.reliquary.shelfEmpty');
  }

  private filterBarHtml(): string {
    const chips = RELIQUARY_OWNED_FILTERS.map((filter) => {
      const on = this.ownedFilter === filter;
      return (
        `<button type="button" class="reliquary-filter-chip${on ? ' active' : ''}" ` +
        `data-filter="${esc(filter)}" data-focus-key="${esc(`filter:${filter}`)}" aria-pressed="${on}">` +
        `${esc(t(FILTER_LABEL_KEYS[filter]))}</button>`
      );
    }).join('');
    return `<div class="reliquary-filterbar" role="group" aria-label="${esc(t('hudChrome.reliquary.filterGroupAria'))}">${chips}</div>`;
  }

  private cellHtml(
    cell: ReliquaryGridCellModel,
    index: number,
    activeIndex: number,
    flash: boolean,
  ): string {
    const name = this.cellDisplayName(cell);
    const stateClass = cell.owned ? 'owned' : 'missing';
    const quality = this.cellQuality(cell);
    // The missing-state carve-out keys on the ART's opacity, not on a kind
    // literal: Armory cards and procedural crests both paint their own
    // background, and the resolver is the one place that knows which family a
    // cell landed on (reliquaryCellArtOpaque). Resolved once here and handed
    // to cellIconHtml, so the descriptor is never computed twice per cell.
    const art = reliquaryCellArt(cell);
    const opaqueArt = art !== null && reliquaryCellArtOpaque(art);
    const icon = this.cellIconHtml(cell, quality, art);
    // Resolved ONCE per cell per rebuild: the aria label and the count stamp
    // both read it, and the search path rebuilds the grid per keystroke.
    // Owned cells never show hunting directions, so they skip the resolution.
    const sourceLines = cell.owned ? [] : reliquarySourceLines(cell.sourcePlans);
    // data-cell-id + data-cell-kind drive tooltip wiring after rebuild.
    // Roving tabindex: one tab stop per grid, Arrow/Home/End move it (wire()).
    return (
      // aria-describedby and aria-keyshortcuts ride the CELL, not the grid: a
      // description on the focused element is reliably announced, one on a
      // role="list" container is not, and the container never takes focus here.
      // The flash rides the same one-shot as the celebration: a class composed
      // into this rebuild only, so a filter click or the next slow band paints
      // the settled cell.
      `<div class="reliquary-cell reliquary-cell--${stateClass} q-${esc(quality)}${flash ? ' reliquary-cell-flash' : ''}" role="listitem" tabindex="${index === activeIndex ? '0' : '-1'}" ` +
      `data-cell-id="${esc(cell.id)}" data-cell-kind="${esc(cell.kind)}" data-cell-owned="${cell.owned ? '1' : '0'}" ` +
      `${opaqueArt ? 'data-cell-art="opaque" ' : ''}` +
      // data-cell-source marks cells with at least one RESOLVABLE source line,
      // and carries how many actually resolve, so tooling (the PR shot picker)
      // can find the richest multi-source cell without matching English aria
      // text. Resolved lines, not authored plans: a plan whose id went stale
      // renders nothing, and the attribute must never promise lines the
      // tooltip will not paint. Any count is truthy as an attribute, so every
      // present/absent selector still holds.
      `${sourceLines.length > 0 ? `data-cell-source="${sourceLines.length}" ` : ''}` +
      `data-focus-key="${esc(`cell:${cell.kind}:${cell.id}`)}" ` +
      `aria-describedby="${GRID_HINT_ID}" aria-keyshortcuts="${GRID_KEY_SHORTCUTS}" ` +
      `aria-label="${esc(this.cellAria(cell, name, sourceLines))}">` +
      `<span class="reliquary-cell-art" aria-hidden="true">${icon}</span>` +
      `</div>`
    );
  }

  /**
   * Keyboard parity with hover: the label carries everything the tooltip shows
   * a mouse (EVERY source line for a missing relic, the first-find clear number
   * and the obtain tally for an owned one), so nothing actionable is hover-only.
   * A label cannot carry
   * the tooltip's separate lines, so they fold into the one {source} slot
   * through the localized join (reliquarySourceAriaText), never punctuation
   * spelled here.
   */
  private cellAria(cell: ReliquaryGridCellModel, name: string, sourceLines: string[]): string {
    // The tooltip/label agreement contract: the tooltip's rarity line rides
    // the SAME cellRarityText resolver, so whichever surface a player reads,
    // the population fact is there or absent on both. The composition key owns
    // the joining punctuation ('{base}, {rarity}'), never this painter.
    // The account-scope fact is the tooltip's one non-source, non-count line,
    // so it owes the same parity: a weapon skin is account-scoped whether the
    // player hovers it or hears it. Folded before rarity so the scope reads as
    // part of what the relic IS, and the population fact stays last on both
    // surfaces. Composition keys own the punctuation, never this painter.
    let base = this.cellAriaBase(cell, name, sourceLines);
    if (cell.kind === 'weapon_skin') {
      base = t('hudChrome.reliquary.cellAriaWithAccountScope', {
        base,
        scope: t('hudChrome.reliquary.accountScopeBadge'),
      });
    }
    const rarity = this.cellRarityText(cell);
    if (rarity === null) return base;
    return t('hudChrome.reliquary.cellAriaWithRarity', { base, rarity });
  }

  private cellAriaBase(cell: ReliquaryGridCellModel, name: string, sourceLines: string[]): string {
    if (cell.owned) {
      // Four owned shapes, one whole authored sentence each rather than a
      // stitched-together label: the clause order and the punctuation between
      // clauses differ per locale, and nothing here may spell either. The two
      // count-bearing arms are CLDR-plural on the obtain count (the number
      // whose noun inflects); the clear number rides as a separate {clears}
      // slot, because tPlural owns {count} and would otherwise select on the
      // wrong number.
      const count = cell.obtainedCount;
      if (count !== undefined) {
        return cell.firstFindClears !== undefined
          ? tPlural('hudChrome.plurals.reliquaryCellOwnedClearsObtainedAria', count, {
              name,
              clears: this.fmt(cell.firstFindClears),
              count: this.fmt(count),
            })
          : tPlural('hudChrome.plurals.reliquaryCellOwnedObtainedAria', count, {
              name,
              count: this.fmt(count),
            });
      }
      return cell.firstFindClears !== undefined
        ? t('hudChrome.reliquary.cellOwnedClearsAria', {
            name,
            count: this.fmt(cell.firstFindClears),
          })
        : t('hudChrome.reliquary.cellOwnedAria', { name });
    }
    const source = reliquarySourceAriaText(sourceLines);
    return source === ''
      ? t('hudChrome.reliquary.cellMissingAria', { name })
      : t('hudChrome.reliquary.cellMissingSourceAria', { name, source });
  }

  /**
   * Art for one relic slot, on the grid and on a recent chip alike. Every
   * catalogued kind resolves real art: reliquary_cell_art.ts walks each kind to
   * its committed source (reins item, Armory thumbnail, deed crest, profession
   * sheet, the authored specimen glyph) and this method only turns that answer
   * into markup. An id this bundle cannot place still falls to the quality
   * ghost, which is now a stale-client case rather than a whole shelf.
   *
   * One implementation for the grid and the strip, so a relic cannot render as
   * art in one place and as a silhouette in the other.
   *
   * The grid passes the descriptor it already resolved for the opacity stamp;
   * the recent strip omits it and resolves here.
   */
  private cellIconHtml(
    cell: ReliquaryArtSlot,
    quality: string,
    art: ReturnType<typeof reliquaryCellArt> = reliquaryCellArt(cell),
  ): string {
    if (art !== null) {
      if (art.kind === 'item') {
        // Straight through the shared itemIcon painter, so a relic cell and the
        // same stack in the bag are byte-identical (and a mount cell inherits
        // the reins def's own quality, never a second opinion about it). The
        // own-property read matches the resolver's R34 discipline even though
        // the id is already resolver-validated.
        const def = knownItemDef(ITEMS, art.itemId);
        if (def) return this.deps.itemIcon(def);
      } else if (art.kind === 'url') {
        return itemIconImgHtml(art.url, quality, art.fallbackUrl);
      } else {
        return itemIconImgHtml(this.crestIconSrc(art.crestId), quality);
      }
    }
    if (cell.kind === 'item' || cell.kind === 'unknown') {
      return unknownItemIconHtml(cell.id, quality);
    }
    return knownItemIconHtml({ id: cell.id, quality });
  }

  /** A deed crest's src, carrying the item ladder's never-a-throw swallow: a
   *  crest with no painted art composites its category recipe on a canvas, and
   *  a host without one must still paint a cell rather than take the window
   *  down (the unknown_item_icon.ts contract). */
  private crestIconSrc(crestId: string): string {
    try {
      return iconDataUrl('crest', crestId);
    } catch {
      return BLANK_PIXEL;
    }
  }

  private cellQuality(cell: ReliquaryArtSlot): string {
    // Each table read goes through its own canonical resolver: knownItemDef
    // and ownEntry are own-property gated (cell ids arrive off the wire on the
    // recent ring); mountDef is the content module's total accessor and is NOT
    // own-property gated, which is harmless here because a prototype key
    // resolves a Function with no .rarity and falls through to 'common' (and
    // the recent ring never carries a mount kind anyway).
    if (cell.kind === 'item' || cell.kind === 'unknown') {
      const def = knownItemDef(ITEMS, cell.id);
      if (def?.quality) return def.quality;
    }
    // Profession marks: masterworks read as epic; rare field notes as rare.
    if (cell.kind === 'mark') {
      if (cell.id.startsWith('masterwork:')) return 'epic';
      if (cell.id.startsWith('gather_event:')) return 'rare';
    }
    if (cell.kind === 'mount') {
      const def = mountDef(cell.id);
      if (def?.rarity) return def.rarity;
    }
    if (cell.kind === 'weapon_skin') {
      const def = ownEntry(WEAPON_SKINS, cell.id);
      if (def?.rarity) return def.rarity;
    }
    if (cell.kind === 'title') return 'epic';
    return 'common';
  }

  // Both name ladders below are one-line consumers of the shared resolver
  // (reliquary_labels.ts), which hud.ts's two unlock ladders also call: the
  // humanized `id.replace(/_/g, ' ')` fallback each of the four used to carry
  // is gone, so a namespaced id can no longer render four different ways.
  private cellDisplayName(cell: ReliquaryGridCellModel): string {
    return reliquaryRelicDisplayName(cell.kind, cell.id);
  }

  /**
   * The obtain tally line, the ONE implementation both owned tooltip branches
   * append: the full-item-tooltip branch and the plain body. A cell the world
   * reports no counted obtain for renders nothing at all rather than a zero,
   * because the absence means "cannot say", not "never obtained": a relic that
   * arrived by trade, mail, or market purchase is deliberately uncounted, and
   * so is one a veteran has held since before the tally existed.
   *
   * CLDR-plural selected on the RAW count so "Obtained 1 time" reads right and
   * a locale with real plural forms gets the leaf it needs. The DISPLAY number
   * is interpolated through formatNumber: selecting on that formatted string
   * would collapse every locale onto .other.
   */
  private obtainedLineHtml(cell: ReliquaryGridCellModel): string {
    const count = cell.obtainedCount;
    if (count === undefined) return '';
    return `<div class="tt-line">${esc(
      tPlural('hudChrome.plurals.reliquaryObtainedTimes', count, { count: this.fmt(count) }),
    )}</div>`;
  }

  /** The population-rarity sentence for one cell, or null when there is
   *  nothing to say (offline, fetch failure, empty population, or a relic
   *  nobody has found; weapon-skin, title, AND mount relics are always
   *  absent from the aggregate, see the ReliquaryRarity facet doc). ONE
   *  resolver feeds the tooltip line AND the aria fold so the two surfaces
   *  cannot disagree (the sourceLines agreement contract). */
  private cellRarityText(cell: ReliquaryGridCellModel): string | null {
    const fraction = reliquaryRarityFraction(this.rarity, cell.id);
    if (fraction === null) return null;
    return t('hudChrome.reliquary.rarityLine', {
      percent: formatNumber(fraction, { style: 'percent', maximumFractionDigits: 1 }),
    });
  }

  /** The rarity tooltip line, the ONE implementation every tooltip exit path
   *  appends (the obtainedLineHtml discipline): the missing-cell body, the
   *  owned plain body, and the owned full-item-tooltip branch. Absent data
   *  renders nothing at all, never a zero, so offline and fetch-failure
   *  tooltips are byte-identical to the pre-rarity ones. */
  private rarityLineHtml(cell: ReliquaryGridCellModel): string {
    const text = this.cellRarityText(cell);
    if (text === null) return '';
    return `<div class="tt-line">${esc(text)}</div>`;
  }

  private cellTooltipHtml(cell: ReliquaryGridCellModel): string {
    const name = this.cellDisplayName(cell);
    const status = cell.owned
      ? t('hudChrome.reliquary.ownedTooltipStatus')
      : t('hudChrome.reliquary.missingTooltipStatus');
    let body = `<div class="tt-name q-${esc(this.cellQuality(cell))}">${esc(name)}</div>`;
    body += `<div class="tt-line">${esc(status)}</div>`;
    // A silhouette tells you where to get it: EVERY door on its own line, the
    // way a collection log reads, so a relic with three routes shows three
    // rather than one arbitrary winner. Missing cells only: an owned item relic
    // returns the full item tooltip below, and a player who already has it does
    // not need the hunting directions. Nothing extra renders when the lines all
    // resolve empty, exactly like the un-hinted arm.
    //
    // Agreement contract with cellHtml/cellAria: both sides derive from the
    // same reliquarySourceLines(cell.sourcePlans) on the same cell object, so
    // the aria fold and this loop cannot disagree on content or count. Any
    // cap, filter, or dedup added here must land on the aria side too, and the
    // same rule binds every OWNED line below (clear#, obtain tally): whatever
    // this tooltip gains, cellAria gains in the same change.
    if (!cell.owned) {
      for (const source of reliquarySourceLines(cell.sourcePlans)) {
        body += `<div class="tt-line">${esc(source)}</div>`;
      }
    }
    if (cell.kind === 'weapon_skin') {
      body += `<div class="tt-line">${esc(t('hudChrome.reliquary.accountScopeBadge'))}</div>`;
    }
    if (cell.owned && cell.firstFindClears !== undefined) {
      body += `<div class="tt-line">${esc(
        t('hudChrome.reliquary.firstFindClears', {
          count: this.fmt(cell.firstFindClears),
        }),
      )}</div>`;
    }
    body += this.obtainedLineHtml(cell);
    // Owned item relics also get the full item tooltip body (stats are catalog
    // truth, not invented power) so the museum reads like other item surfaces.
    // Append first-find clear# when present (live obtain only; never invented),
    // then the obtain tally on the same rule.
    if (cell.owned && cell.kind === 'item') {
      const def = ITEMS[cell.id];
      if (def) {
        let html = this.deps.itemTooltip(def);
        if (cell.firstFindClears !== undefined) {
          html += `<div class="tt-line">${esc(
            t('hudChrome.reliquary.firstFindClears', {
              count: this.fmt(cell.firstFindClears),
            }),
          )}</div>`;
        }
        html += this.obtainedLineHtml(cell);
        html += this.rarityLineHtml(cell);
        return html;
      }
    }
    body += this.rarityLineHtml(cell);
    return body;
  }

  private wire(el: HTMLElement, model: ReliquaryViewModel): void {
    // A slain proof starts on its exact mob portrait, with the authored trophy
    // glyph carried only as a mixed-deploy/decode fallback. Disarm BEFORE the
    // swap and listen once, so even a malformed fallback cannot recurse.
    for (const img of el.querySelectorAll<HTMLImageElement>('img[data-icon-fallback-src]')) {
      img.addEventListener(
        'error',
        () => {
          const fallback = img.getAttribute('data-icon-fallback-src');
          img.removeAttribute('data-icon-fallback-src');
          if (fallback !== null && img.getAttribute('src') !== fallback) {
            img.setAttribute('src', fallback);
          }
        },
        { once: true },
      );
    }
    el.querySelector('[data-close]')?.addEventListener('click', () => {
      this.close();
      audio.click();
    });
    const search = el.querySelector<HTMLInputElement>('.reliquary-search');
    const applySearch = (): void => {
      const value = search?.value ?? '';
      // Equality guard IN the applier: at the end of a composition BOTH
      // compositionend and a final input event (isComposing false) arrive,
      // in either order by host. Whichever lands second must be a no-op, or
      // the second rebuild toggles the reannounce marker and the reader
      // hears the count twice.
      if (this.search === value) return;
      this.search = value;
      // A narrowed grid renumbers, so the roving cursor goes back to the front.
      this.gridIndex = 0;
      this.render();
    };
    search?.addEventListener('compositionstart', () => {
      this.composing = true;
    });
    search?.addEventListener('input', (e) => {
      // Mid-composition input events (a CJK IME assembling a candidate) must
      // not rebuild: innerHTML would destroy the composition session under the
      // player. The final input event after compositionend carries
      // isComposing false and lands in applySearch normally; the
      // compositionend listener below covers hosts that order those two the
      // other way around.
      if ((e as InputEvent).isComposing) return;
      applySearch();
    });
    search?.addEventListener('compositionend', () => {
      this.composing = false;
      applySearch();
    });
    for (const btn of el.querySelectorAll<HTMLElement>('[data-nav]')) {
      btn.addEventListener('click', () => {
        const nav = btn.dataset.nav ?? '';
        if (!isReliquaryNavId(nav)) return;
        this.nav = nav;
        this.pageId = null;
        this.gridIndex = 0;
        audio.click();
        this.render();
      });
    }
    for (const btn of el.querySelectorAll<HTMLElement>('[data-filter]')) {
      btn.addEventListener('click', () => {
        // Re-validate the attribute before the cast: the DOM is the untrusted
        // half of this round trip (the deeds filter chip contract).
        const filter = btn.dataset.filter ?? '';
        this.ownedFilter = isReliquaryOwnedFilter(filter) ? filter : 'all';
        this.gridIndex = 0;
        audio.click();
        this.render();
      });
    }
    for (const btn of el.querySelectorAll<HTMLElement>('[data-page]')) {
      btn.addEventListener('click', () => {
        const pageId = btn.dataset.page;
        if (!pageId) return;
        // The same transition the chat deep link takes (gotoPage), so an
        // in-window jump and an external one cannot resolve a shelf
        // differently. In-window rows keep their own state: the needle and the
        // ownership chip are the player's, only the external jump clears them.
        this.gotoPage(pageId);
        this.gridIndex = 0;
        audio.click();
        this.render();
      });
    }
    // The pin control is a SIBLING of the page row, not a child of it, so a pin
    // click never reaches the row's own listener and no stopPropagation is
    // needed: the row handler is bound on the row button itself, not on a
    // container both share.
    for (const btn of el.querySelectorAll<HTMLElement>('[data-pin]')) {
      btn.addEventListener('click', () => {
        const pageId = btn.dataset.pin;
        if (!pageId) return;
        this.ensurePinsLoaded();
        const result = toggleReliquaryPin(this.pinnedSet, pageId);
        if (!result.changed) {
          // Refused at the cap. The control stays focusable (aria-disabled,
          // not native disabled), so an activation answers through the polite
          // region instead of silence; the same reason rides the button's
          // aria-describedby for focus-time discovery. Nothing to repaint and
          // nothing to persist.
          if (this.liveEl) {
            this.liveEl.textContent = this.liveReannounce.mark(
              t('hudChrome.reliquary.pinFull', { cap: this.fmt(RELIQUARY_TRACK_CAP) }),
            );
          }
          return;
        }
        this.pinnedSet = new Set(result.pinned);
        this.persistPins();
        // The tracker repaints now rather than up to a slow band later, so the
        // strip agrees with the button the player just pressed.
        this.deps.onPinChanged();
        audio.click();
        this.render();
      });
    }
    el.querySelector('[data-back]')?.addEventListener('click', () => {
      this.pageId = null;
      this.gridIndex = 0;
      audio.click();
      this.render();
    });
    // The celebration removes itself when its animation ends, so the page
    // settles into the standing illuminated treatment with no timer anywhere in
    // this module. Removal only: the class can never come back, because the
    // one-shot that composed it was consumed by the render above.
    //
    // Under prefers-reduced-motion the stylesheet swaps the animation for a
    // static gold frame (`animation: none`), so animationend never fires and
    // this listener never runs. That is the .deed-card-flash contract, not a
    // leak: the next full rebuild drops the class with the rest of the markup,
    // because the one-shot that composed it is already spent. A timer to close
    // the gap would be the one thing this painter must never own.
    const celebrating = el.querySelector<HTMLElement>('.reliquary-page-celebrate');
    celebrating?.addEventListener('animationend', (e) => {
      // animationend bubbles: the 1s cell fill flash inside this section would
      // end the 1.6s page celebration and grid shimmer 0.6s early without the
      // target guard (the illuminating drain composes both in the same paint).
      if (e.target !== celebrating) return;
      celebrating.classList.remove('reliquary-page-celebrate');
    });
    // Recent chips: the shared HUD tooltip repeats the chip's fully visible
    // wrapped name near the pointer (a hover nicety, never the only route to
    // the text; nothing truncates).
    for (const chip of el.querySelectorAll<HTMLElement>('[data-recent-name]')) {
      const name = chip.dataset.recentName ?? '';
      if (name === '') continue;
      this.deps.attachTooltip(chip, () => `<div class="tt-name">${esc(name)}</div>`);
    }
    // Grid cell tooltips: owned vs missing copy, full item tip when catalogued.
    if (model.pageDetail) {
      const byKey = new Map<string, ReliquaryGridCellModel>();
      for (const cell of model.pageDetail.cells) {
        byKey.set(`${cell.kind}:${cell.id}`, cell);
      }
      const cells = [...el.querySelectorAll<HTMLElement>('[data-cell-id]')];
      cells.forEach((node, i) => {
        const id = node.dataset.cellId;
        const kind = node.dataset.cellKind;
        if (id && kind) {
          const cell = byKey.get(`${kind}:${id}`);
          if (cell) this.deps.attachTooltip(node, () => this.cellTooltipHtml(cell));
        }
        node.addEventListener('keydown', (e) => {
          const ke = e as KeyboardEvent;
          const next = rovingTarget(ke.key, i, cells.length, 'both');
          if (next === null) return;
          ke.preventDefault();
          this.gridIndex = next;
          this.stampGridTabIndex(cells);
          cells[next]?.focus();
        });
      });
    }
  }

  private fmt(n: number): string {
    return formatNumber(n, { maximumFractionDigits: 0 });
  }

  private pinKey(): string {
    const world = this.deps.world();
    return `${RELIQUARY_PIN_KEY_PREFIX}_${world.cfg.playerClass}_${world.player.name}`;
  }

  /** Drop illuminated and catalog-unknown pages where the set meets fresh
   *  ownership, so a filled slot frees up the moment its page loses the unpin
   *  button (an illuminated pin must never wedge the cap, in memory or in
   *  storage). On a drop: persist and nudge the HUD tracker. */
  private prunePinsIfStale(): void {
    this.ensurePinsLoaded();
    const world = this.deps.world();
    const result = pruneReliquaryPins(this.pinnedSet, (pageId) =>
      world.reliquaryPageCompletion(pageId),
    );
    if (!result.changed) return;
    this.pinnedSet = new Set(result.pinned);
    this.persistPins();
    this.deps.onPinChanged();
  }

  private ensurePinsLoaded(): void {
    const key = this.pinKey();
    if (key === this.pinnedKey) return;
    this.pinnedKey = key;
    this.pinnedSet = new Set();
    try {
      const raw = JSON.parse(localStorage.getItem(key) ?? 'null');
      if (Array.isArray(raw)) {
        for (const pageId of raw) {
          if (typeof pageId === 'string' && this.pinnedSet.size < RELIQUARY_TRACK_CAP) {
            this.pinnedSet.add(pageId);
          }
        }
      }
    } catch {
      /* corrupt or unavailable storage: start unpinned */
    }
  }

  private persistPins(): void {
    try {
      localStorage.setItem(this.pinnedKey, JSON.stringify([...this.pinnedSet]));
    } catch {
      /* storage unavailable (private mode); the pins still work in-session */
    }
  }
}

export type { ReliquaryNavId };
// Re-export nav helpers so callers (and tests) need only one import surface.
export { isReliquaryNavId, RELIQUARY_NAV };
