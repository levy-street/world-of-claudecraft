// Bank window painter: owns the #bank-window DOM and paints the pooled bank
// (the Gilded Strongbox deposit box) from the structured BankViewModel
// (bank_view.ts). The pure core decides which state the snapshot is in and what
// slots / empty cells / buy-row it shows; this thin consumer renders that and
// wires withdraw / buy-slots back through IWorld. It holds no Sim reference and
// reaches into Hud only through its deps.
//
// Cold, event-driven window (the MailboxWindow shape): innerHTML rebuild on open,
// on a real bank-data change, and on a language switch; the .bank-grid scroll
// offset is preserved across rebuilds; nothing bank-related runs per frame in
// Hud.update()'s hot path (the slow-band refreshIfChanged line mirrors mailbox).
//
// NON-modal companion of the bags window: the window itself installs no focus
// trap (the bags-style capture-and-return deps), and only the buy-slots confirm
// and withdraw-quantity prompts trap (their own Tab cycle, appended to
// #prompt-stack). No raw hex: the item-quality color comes from the shared
// QUALITY_COLOR map and the unranked fallback is the --color-quality-default token.

import { audio } from '../game/audio';
import { ITEMS } from '../sim/data';
import type { IWorld } from '../world_api';
import {
  BAG_CATEGORIES,
  BAG_SORTS,
  type BagCategory,
  type BagFilterState,
  type BagSort,
  bagFilterIsDefault,
  DEFAULT_BAG_FILTER,
  parseBagFilter,
  serializeBagFilter,
} from './bag_filter';
import { bagInstanceGlyphKind } from './bag_instance_glyph_view';
import { filterBankSlots } from './bank_filter';
import { showQuantityPrompt } from './bank_quantity_prompt';
import {
  type BankBonusModel,
  type BankBonusRowModel,
  type BankBuySlotsModel,
  type BankSlotModel,
  bankSlotAction,
  buildBankView,
  type DepositAllPlan,
  depositAllSummaryKey,
  hasDepositableMaterials,
  planDepositAllMaterials,
} from './bank_view';
import { markDialogRoot } from './dialog_root';
import { itemDisplayName } from './entity_i18n';
import { esc } from './esc';
import { captureFocusKey, restoreFirstEnabled } from './focus_restore';
import {
  GUILD_PANEL_ID,
  GUILD_TAB_ID,
  type GuildBankPaneView,
  GuildBankTab,
} from './guild_bank_window';
import { formatMoney, formatNumber, type TranslationKey, t } from './i18n';
import { QUALITY_COLOR } from './icons';
import {
  INSTANCE_GLYPH_ARIA_KEYS,
  instanceGlyphMarkHtml,
  UNKNOWN_INSTANCE_GLYPH_ARIA_KEYS,
} from './item_instance_glyph_mark';
import { knownItemDef } from './known_item';
import type { PainterHostPresentation } from './painter_host';
import {
  installPromptDialog as installModalPromptDialog,
  type PromptDialogHandle,
} from './prompt_dialog';
import { focusActiveTab, wireTabStrip } from './tab_strip_painter';
import { tabStripHtml, tabStripModel } from './tab_strip_view';
import { svgIcon } from './ui_icons';
import { unknownItemIconHtml } from './unknown_item_icon';

// The unranked quality fallback as a CSS custom property. The shared QUALITY_COLOR
// map carries the real per-quality hex; this token covers an item with no quality
// field, so no raw hex lives in the painter (mirrors bags' --bag-slot-quality).
const QUALITY_DEFAULT_COLOR = 'var(--color-quality-default)';

// Grace before a null bankInfo closes the window: online the bank mirror rides the
// proximity snapshot, so it can lag the open by about a tick (copies the mailbox's
// MAIL_INFO_GRACE_MS semantics with a bank-named constant, same 3000 value).
const BANK_INFO_GRACE_MS = 3_000;

// The confirm / quantity prompts mount into #prompt-stack (outside #bank-window). A
// window-level close() removes any that are open so it never leaves an orphaned
// aria-modal dialog floating over the closed window.
const BANK_PROMPT_SELECTOR = '.bank-quantity-prompt, .bank-buy-prompt';
// Exported so the guild pane (guild_bank_window.ts), which shares this window's
// prompt classes and force-close teardown, can tear siblings down before
// mounting its own prompts.
export function dismissBankPrompts(): void {
  for (const p of document.querySelectorAll(BANK_PROMPT_SELECTOR)) p.remove();
}

// The bank's window-local filter preferences persist under their OWN key, distinct
// from the bags' 'woc_bag_filter': the two windows share the state SHAPE (BagFilterState)
// and the tolerant serialize/parse, but keep independent category/sort choices. The
// SEARCH is per-visit only: close() resets the live value, persistFilter strips it
// from every write, and construction never restores it (and eagerly scrubs a
// non-empty stored query so storage never holds one even if the player never opens
// the bank this session). A reopened bank always starts unfiltered (a stale query
// silently hides slots). The bags window still keeps its search across sessions;
// aligning the family is a named follow-up, not an accident of this module.
const BANK_FILTER_KEY = 'woc_bank_filter';

// How long the transient deposit-all summary stays on screen before it clears. The
// summary is a polite aria-live status line INSIDE the window (the bank painter cannot
// reach Hud's toast without a hud.ts-wired deps callback, which the non-modal cluster
// forbids here), so it self-expires rather than lingering across later data refreshes.
const DEPOSIT_STATUS_MS = 4_000;

// The category chips and sort options REUSE the bags' generic label keys (All / Weapons
// / Recent / ...): those strings are not bags-specific, so duplicating them into the
// catalog would only add untranslated debt. The bank adds only its OWN aria labels
// (filterGroupAria / sortAria / searchAria) where the bags wording names "bags".
const BANK_CATEGORY_LABEL_KEYS: Record<BagCategory, TranslationKey> = {
  all: 'hudChrome.bags.filterAll',
  weapon: 'hudChrome.bags.filterWeapon',
  armor: 'hudChrome.bags.filterArmor',
  consumable: 'hudChrome.bags.filterConsumable',
  material: 'hudChrome.bags.filterMaterial',
  tool: 'hudChrome.bags.filterTool',
  quest: 'hudChrome.bags.filterQuest',
  mount: 'hudChrome.bags.filterMount',
};
const BANK_SORT_LABEL_KEYS: Record<BagSort, TranslationKey> = {
  recent: 'hudChrome.bags.sortRecent',
  quality: 'hudChrome.bags.sortQuality',
  name: 'hudChrome.bags.sortName',
};

// The KNOWN bonus-source ids (server-stamped into BankInfo.bonusSources) with their
// localized label and the advert shown while unearned; the referral row uses `advert`
// as its always-on explainer detail line. A source id ABSENT from this map is SKIPPED
// by buildBonusSection (forward compat: a future X/Twitch row arrives as a new server
// id and must never render a raw key or an English fallback). SOURCE-SCAN pinned in
// tests/bank_window.test.ts.
const BANK_BONUS_SOURCE_KEYS: Record<string, { label: TranslationKey; advert: TranslationKey }> = {
  email: {
    label: 'hudChrome.bank.bonusSourceEmail',
    advert: 'hudChrome.bank.bonusAdvertEmail',
  },
  discord: {
    label: 'hudChrome.bank.bonusSourceDiscord',
    advert: 'hudChrome.bank.bonusAdvertDiscord',
  },
  wallet: {
    label: 'hudChrome.bank.bonusSourceWallet',
    advert: 'hudChrome.bank.bonusAdvertWallet',
  },
  referral: {
    label: 'hudChrome.bank.bonusSourceReferral',
    advert: 'hudChrome.bank.bonusReferralExplainer',
  },
};

/**
 * Hud-supplied glue. The icon/money/tooltip painters are the shared
 * PainterHostPresentation bag (Hud builds it once and hands it to every window that
 * renders item rows); this composes that base and adds the bank surface: the world
 * reads/commands, the non-trapping focus capture/return, and the close/teardown
 * chrome. The module never reaches into Hud directly and never hardcodes the
 * window id (always deps.root()).
 */
export interface BankWindowDeps extends PainterHostPresentation {
  /** The #bank-window root (Hud owns the id; the painter stays instance-parameterized). */
  root(): HTMLElement;
  /** The live world (offline Sim or online ClientWorld mirror). */
  world(): IWorld;
  /** Close the sibling windows this one displaces (bank + bags cluster). */
  closeOthers(): void;
  hideTooltip(): void;
  /** True when this click is the release of a long-press tooltip peek, so the
   *  cell's withdraw must be SUPPRESSED (holding a cell to read its tooltip must
   *  not withdraw on release). Wired to the shared Hud TouchPeekGuard; a plain
   *  tap and every desktop click return false. */
  consumePeek(): boolean;
  // Non-modal focus capture/return (WCAG 2.4.3). The bank rides alongside the bags
  // window, so it does NOT trap focus; it only records its opener on open and returns
  // focus there on close. Wired to the FocusManager's activeFocusable / restore, NOT
  // the trap-installing windowFocus helper.
  captureFocus(): HTMLElement | null;
  restoreFocus(target: HTMLElement | null): void;
  /** Hud teardown after close() (drop the body docking class, resync bags). */
  onClosed(): void;
  /** Nudge the Hud that a bank op just moved inventory or coin (withdraw, partial
   *  withdraw, deposit-all, buy-slots). Bank ops emit no client repaint event and the
   *  bags companion has no per-frame refresh, so the initiating window repaints it
   *  (the bags-side deposit idiom, see bags_window.ts). Offline the sim has already
   *  applied the op synchronously and this paint is the ONLY one; online it paints the
   *  still-stale mirror harmlessly and the snapshot echo repaints again
   *  authoritatively (main.ts consumeInventoryChanged). */
  onInventoryChanged(): void;
}

/** The two bank panes. The Guild tab exists only while guildBankInfo is
 *  non-null (officer-plus at a banker, online with the book loaded). */
export type BankTabId = 'personal' | 'guild';

export class BankWindow {
  private opened = false;
  private lastSig = '';
  private openerFocus: HTMLElement | null = null;
  private openedAt = 0;

  // Which pane is showing. Guild is reachable only while the strip renders
  // (guildBankInfo non-null); any render that finds it gone falls back to
  // Personal, and close() resets it so a reopened bank never starts on a
  // pane that may no longer exist.
  private tab: BankTabId = 'personal';
  // The pane the LAST paint drew, so the .bank-scroll offset is restored only
  // within one pane (a tab switch starts at the top, never mid-list).
  private lastRenderedTab: BankTabId = 'personal';
  // ...and which GUILD sub-view it drew, for the same reason one level down:
  // the contents grid and the log list both mount a .bank-scroll, so without
  // this the grid's offset would be pasted onto the log the moment a player
  // switched between them.
  private lastRenderedGuildView: GuildBankPaneView = 'contents';
  // The guild pane painter (guild_bank_view.ts core + guild_bank_window.ts),
  // sharing this window's presentation bag and prompt-dialog chrome.
  private readonly guildPane: GuildBankTab;

  // Window-local filter state: category chips + sort persist across sessions under
  // BANK_FILTER_KEY; the live search is per-visit and starts empty even when a
  // reload while the bank sat open left a query in storage (close() never ran, see
  // BANK_FILTER_KEY). A non-empty stored search is also rewritten out at boot so
  // storage never holds a stranded query when the player never opens the bank.
  // Pure logic lives in bank_filter.ts (reusing bag_filter.ts); this is the
  // consumer. Tolerant parse: corrupt storage falls back to the default filter,
  // never throwing.
  private filter: BagFilterState = (() => {
    try {
      const parsed = parseBagFilter(localStorage.getItem(BANK_FILTER_KEY));
      const next = { ...parsed, search: '' };
      // Scrub a legacy or reload-stranded query at construction so storage never
      // holds a search value even if the player never opens the bank this session.
      // Category/sort stay; private-mode write failures are ignored like persistFilter.
      if (parsed.search !== '') {
        try {
          localStorage.setItem(BANK_FILTER_KEY, serializeBagFilter(next));
        } catch {
          /* storage unavailable (private mode); live state is still search-free */
        }
      }
      return next;
    } catch {
      return { ...DEFAULT_BAG_FILTER };
    }
  })();

  // The transient deposit-all summary and its self-expire timer. Rendered as a polite
  // aria-live line; re-painted (while fresh) across data-driven rebuilds so a repaint
  // that lands after the online mirror catches up does not swallow the feedback.
  private depositStatus: { text: string; at: number } | null = null;
  private statusTimer: number | null = null;

  // In-flight guard for deposit-all: the ONLINE mirror lags the sent commands by about
  // a tick, so a rapid second click would re-plan from the STALE mirror and re-send
  // slot indices the server has already spliced, banking whatever shifted into them
  // (the wrong-item class the stale-index prompt guard exists for). The button
  // stays disabled from send until the mirror echoes (refreshIfChanged sees a new data
  // signature) or the fallback timer clears a lost echo.
  private depositAllPending = false;
  private depositAllTimer: number | null = null;

  constructor(private readonly deps: BankWindowDeps) {
    this.guildPane = new GuildBankTab({
      root: () => this.deps.root(),
      world: () => this.deps.world(),
      itemIcon: (item) => this.deps.itemIcon(item),
      moneyHtml: (copper) => this.deps.moneyHtml(copper),
      itemTooltip: (item, instance) => this.deps.itemTooltip(item, instance),
      attachTooltip: (el, html) => this.deps.attachTooltip(el, html),
      hideTooltip: () => this.deps.hideTooltip(),
      consumePeek: () => this.deps.consumePeek(),
      onInventoryChanged: () => this.deps.onInventoryChanged(),
      installPromptDialog: (prompt, opener, close) =>
        this.installPromptDialog(prompt, opener, close),
      dismissPrompts: () => dismissBankPrompts(),
      requestRender: () => {
        if (this.opened) this.render();
      },
    });
  }

  get isOpen(): boolean {
    return this.opened;
  }

  /** True while the window is open on the PERSONAL pane: the bags companion
   *  reads this (via Hud) to route a bag click to bankDeposit.
   *
   *  It is deliberately NOT "open and not on the guild CONTENTS view": the
   *  guild pane's Log view is a reading surface, and while it shows, the
   *  personal grid is off screen behind it exactly like the guild grid is. A
   *  bag click there must arm NEITHER deposit, or reading the history silently
   *  banks the item that was clicked, which is the same trap guildTabActive
   *  documents below. */
  get personalTabActive(): boolean {
    return this.opened && this.tab === 'personal';
  }

  /** True while the window is open on the Guild pane: the bags companion
   *  reads this (via Hud) to route a bag click to guildBankDeposit. Also
   *  requires guildBankInfo to be live RIGHT NOW, so the one-frame window
   *  between the mirror nulling (walk-away, guild loss) and the slow-band
   *  repaint can never route a bag click at the guild facet. */
  get guildTabActive(): boolean {
    return (
      this.opened &&
      this.tab === 'guild' &&
      // ONLY the contents view routes bag clicks. The log is a reading surface:
      // a bag click while the player is reading the history must not silently
      // deposit the item they clicked (the whole point of that routing is that
      // the guild grid is on screen to drop into).
      this.guildPane.activeView === 'contents' &&
      // A READ-ONLY viewer's contents pane is a reading surface too (every
      // member sees the bank, only officer-plus may deposit): their bag click
      // must not arm the guild deposit, so it falls to the same speak-path the
      // Log view uses (bankOpen stays true, both deposit modes stay off).
      (this.deps.world().guildBankInfo?.canEdit ?? false)
    );
  }

  // Re-interacting with the banker while already open must not re-run the open
  // bookkeeping: re-capturing openerFocus could record a node INSIDE this window
  // (returned-to after close, i.e. destroyed), and a fresh render would tear an
  // open prompt down for no reason. Data changes ride refreshIfChanged.
  open(): void {
    if (this.opened) return;
    this.deps.closeOthers();
    this.openerFocus = this.deps.captureFocus();
    this.opened = true;
    this.lastSig = '';
    this.openedAt = performance.now();
    this.render();
    this.deps.root().style.display = 'flex';
    audio.bagOpen();
  }

  close(): void {
    if (!this.opened) return;
    // A confirm / quantity prompt is a modal CHILD that sets #bank-window inert. The
    // window can be force-closed out from under it (Esc / keybind), a path that never
    // runs the prompt's dismiss(); tear any open prompt down here so it is not left an
    // orphaned aria-modal dialog, then clear the inert it set (a hidden window must
    // never stay inert or the next open shows a dead grid).
    dismissBankPrompts();
    // Drop any pending deposit-all summary (and its timer) so a reopened bank never
    // flashes a stale line, and no late timer fires render() on the hidden window.
    this.clearDepositStatus();
    this.clearDepositAllPending();
    // The search is a per-visit filter: left set, the next open would start
    // pre-narrowed to a stale query (slots hidden with no cue why). Reset the
    // live value; the persist rewrite also scrubs any legacy pre-fix query out
    // of storage (persistFilter never stores the search). Category/sort stay.
    this.filter.search = '';
    this.persistFilter();
    const el = this.deps.root();
    el.style.display = 'none';
    el.inert = false;
    this.opened = false;
    // Walking away (or any close) empties the Guild tab state cleanly: the
    // next open starts on Personal, never on a pane that may no longer exist.
    this.tab = 'personal';
    this.lastRenderedTab = 'personal';
    // ...including the Guild pane's own sub-view: a reopened bank starts on the
    // contents, so the log is never refetched by an open the player did not
    // aim at it.
    this.guildPane.resetView();
    this.lastRenderedGuildView = 'contents';
    this.deps.hideTooltip();
    this.deps.restoreFocus(this.openerFocus);
    this.openerFocus = null;
    this.deps.onClosed();
  }

  private clearDepositStatus(): void {
    if (this.statusTimer !== null) {
      window.clearTimeout(this.statusTimer);
      this.statusTimer = null;
    }
    this.depositStatus = null;
  }

  private clearDepositAllPending(): void {
    if (this.depositAllTimer !== null) {
      window.clearTimeout(this.depositAllTimer);
      this.depositAllTimer = null;
    }
    this.depositAllPending = false;
  }

  render(): void {
    const el = this.deps.root();
    // A rebuild invalidates any open prompt (its localized text and its captured
    // slot index go stale against the fresh data/language) and destroys the focused
    // node. Tear prompts down first, clearing the inert they set, and remember
    // whether focus was inside the window or a prompt so it can re-land on the
    // fresh close button instead of dropping to <body> (WCAG 2.4.3).
    const active = document.activeElement as HTMLElement | null;
    const hadFocus = el.contains(active) || active?.closest(BANK_PROMPT_SELECTOR) != null;
    // Search focus survives a FULL rebuild too: the slow-band refreshIfChanged can
    // land a data repaint (a deposit's echo) moments after the player focused the
    // search box, and stealing focus to the close button mid-typing was a live bug
    // (proven by the online browser smoke probe). The fresh input's value is restored from
    // this.filter.search, so only focus + caret need carrying across.
    const searchEl = el.querySelector('.bag-search') as HTMLInputElement | null;
    const searchFocus =
      searchEl !== null && active === searchEl
        ? { start: searchEl.selectionStart, end: searchEl.selectionEnd }
        : null;
    // The focused control's identity (data-focus-key), captured BEFORE the wipe:
    // the guild refresh arm repaints on ANY officer's op, so an external echo
    // must not yank a keyboard user off the tab, cell, or button they were on.
    // Guild controls carry keys (guild_bank_window.ts + the tab annotation
    // below); personal controls carry none and keep the close-button fallback.
    const focusKey = hadFocus ? captureFocusKey(el) : null;
    if (document.querySelector(BANK_PROMPT_SELECTOR)) {
      dismissBankPrompts();
      el.inert = false;
    }
    this.deps.hideTooltip();
    markDialogRoot(el, { label: t('hudChrome.bank.title') });
    // .bank-scroll (not #bank-window) is the scroll container; it is recreated on
    // every rebuild, so capture its scroll offset and reapply it to the fresh one,
    // else a withdraw snaps the list back to the top (the bags idiom).
    const prevScrollTop = el.querySelector('.bank-scroll')?.scrollTop ?? 0;
    const model = buildBankView(this.deps.world().bankInfo, (id) => knownItemDef(ITEMS, id));
    // The Guild tab exists ONLY while guildBankInfo is non-null (any guild
    // member at a banker, online, book loaded; a plain member's pane renders
    // read-only). When it goes away mid-open (leave,
    // kick, a reconcile window), the strip disappears and the pane falls back
    // to Personal on this same paint; the whole-window walk-away close stays
    // refreshIfChanged's grace-close on bankInfo.
    const guildModel = this.guildPane.model();
    const guildAvailable = guildModel.kind !== 'hidden'; // opened OR unopened pane
    if (!guildAvailable) {
      this.tab = 'personal';
      // ...and drop the pane's OWN sub-view with it, the way close() does. The
      // log view is the one that fetches: leaving it selected on a pane that no
      // longer exists left a demoted client re-requesting a log the server
      // refuses, once per TTL, forever.
      this.guildPane.resetView();
    }
    el.innerHTML =
      `<div class="panel-title"><span>${esc(t('hudChrome.bank.title'))} <span class="panel-subtitle">${esc(t('hudChrome.bank.subtitle'))}</span></span>` +
      `<button type="button" class="x-btn" data-close aria-label="${esc(t('hudChrome.bank.close'))}">${svgIcon('close')}</button></div>`;
    el.querySelector('[data-close]')?.addEventListener('click', () => this.close());
    if (guildAvailable) {
      // The shared WAI-ARIA tab strip (tab_strip_view core + wireTabStrip),
      // the social/talents idiom. The PERSONAL pane's sections still mount
      // directly on the window root (wrapping them would disturb the flex
      // column the bank CSS sizes), so the strip carries no blanket `panelId`;
      // the GUILD pane does build a real role=tabpanel, because it holds a
      // nested tab list of its own and a second peer tablist with no stated
      // relationship is unintelligible to a screen reader. Its aria-controls is
      // stamped below, once that panel exists.
      el.insertAdjacentHTML(
        'beforeend',
        tabStripHtml(
          tabStripModel({
            ariaLabel: t('hudChrome.bank.tabsAria'),
            stripClass: 'bank-tabs',
            tabClass: 'bank-tab',
            selectedClass: 'on',
            tabs: [
              { id: 'personal', label: t('hudChrome.bank.personalTab') },
              // A stable id so the Guild pane's panel can point its
              // aria-labelledby back at this tab.
              { id: 'guild', label: t('hudChrome.bank.guildTab'), buttonId: GUILD_TAB_ID },
            ],
            selected: this.tab,
          }),
        ),
      );
      wireTabStrip(el, 'bank-tab', (id, focusFollow) => {
        if (id !== 'personal' && id !== 'guild') return;
        if (this.tab !== id) audio.click();
        this.tab = id;
        this.render();
        if (focusFollow) focusActiveTab(this.deps.root(), 'bank-tab', 'on');
      });
      // Key the tab buttons so a repaint keeps focus on the tab the user was
      // on (the shared strip carries data-tab; the key namespace is ours).
      for (const tab of el.querySelectorAll<HTMLElement>('.bank-tab')) {
        tab.dataset.focusKey = `tab:${tab.dataset.tab}`;
      }
    }
    if (this.tab === 'guild') {
      this.guildPane.renderInto(el, guildModel);
      // Close the tab/panel relationship now that the panel exists: without it
      // the pane's own Contents/Log strip reads to assistive tech as a second,
      // unrelated top-level tab list that appeared out of nowhere.
      const guildTab = el.querySelector<HTMLElement>(`#${GUILD_TAB_ID}`);
      if (guildTab && el.querySelector(`#${GUILD_PANEL_ID}`)) {
        guildTab.setAttribute('aria-controls', GUILD_PANEL_ID);
      }
      this.annotateGuildFocusKeys(el);
      this.restoreScroll(el, prevScrollTop);
      // The guild pane has no search box, so a searchFocus capture degrades
      // through the key ladder to the close button, never to <body>.
      if (hadFocus) this.restoreControlFocus(el, focusKey);
      return;
    }
    if (model.kind === 'away') {
      const away = document.createElement('div');
      away.className = 'bank-empty';
      away.textContent = t('hudChrome.bank.tooFar');
      el.appendChild(away);
      this.lastRenderedTab = this.tab;
      if (hadFocus) this.restoreControlFocus(el, focusKey);
      return;
    }
    const capacity = document.createElement('div');
    capacity.className = 'bank-capacity';
    const used = this.fmt(model.capacity.used);
    const total = this.fmt(model.capacity.total);
    capacity.textContent = t('hudChrome.bank.capacity', { used, total });
    capacity.setAttribute('aria-label', t('hudChrome.bank.capacityAria', { used, total }));
    el.appendChild(capacity);
    // Always mount the toolbar in the bank state: the deposit-all button belongs there
    // even over an empty bank, while buildFilterBar drops the search/category/sort
    // controls when there is nothing yet to filter.
    el.appendChild(this.buildFilterBar(model.empty));
    const status = this.buildDepositStatus();
    if (status) el.appendChild(status);
    // One shared scroll region holds the grid plus the bonus breakdown as its tail:
    // at a 360px-tall phone the rigid chrome (title, capacity, toolbar, buy row)
    // leaves less than one cell row of flex space, so a fixed below-the-buy-row
    // footer either crushed the grid or clipped itself (found live in QA).
    // Scrolling past the last cells reaches the bonus copy on every viewport, and
    // the transactional buy row stays pinned below, always visible.
    const scroll = document.createElement('div');
    scroll.className = 'bank-scroll';
    const grid = document.createElement('div');
    grid.className = 'bank-grid';
    this.fillGrid(grid, model.slots, model.emptyCells, model.empty);
    scroll.appendChild(grid);
    // The bonus-slot breakdown is present only online (bonusSources is [] offline);
    // it advertises what account links earn.
    const bonus = this.buildBonusSection(model.bonus);
    if (bonus) scroll.appendChild(bonus);
    el.appendChild(scroll);
    this.restoreScroll(el, prevScrollTop);
    el.appendChild(this.buildBuyRow(model.buy));
    if (searchFocus) {
      const fresh = el.querySelector('.bag-search') as HTMLInputElement | null;
      if (fresh) {
        fresh.focus();
        fresh.setSelectionRange(searchFocus.start, searchFocus.end);
      } else if (hadFocus) {
        // The rebuild dropped the search box (the bank emptied): fall back to the
        // close button rather than dropping focus to <body>.
        (el.querySelector('[data-close]') as HTMLElement | null)?.focus();
      }
    } else if (hadFocus) {
      this.restoreControlFocus(el, focusKey);
    }
  }

  // Stamp the guild pane's controls with their focus keys AFTER renderInto
  // returned: the shared data-focus-key namespace stays inside this module,
  // the one that imports focus_restore (the single-reader guard in
  // tests/focus_restore.test.ts), and the pane stays focus-agnostic. Cells are
  // keyed by wire index: fillGrid appends model.slots in order (slotIndex ==
  // array index) before the empty pad, so DOM order IS slot order; the pinned
  // focus test drives a real repaint over a focused cell, so a reorder that
  // broke this coupling goes red there.
  private annotateGuildFocusKeys(el: HTMLElement): void {
    // The Contents / Log sub-strip first: the log repaints on ANY officer's op
    // (its cache busts and the response lands), so a keyboard user reading it
    // must not be thrown off the strip by somebody else's deposit.
    for (const tab of el.querySelectorAll<HTMLElement>('.gbank-view-tab')) {
      tab.dataset.focusKey = `gbank:view:${tab.dataset.tab}`;
    }
    let slotIndex = 0;
    for (const cell of el.querySelectorAll<HTMLElement>('.bank-grid .bank-item:not(.empty)')) {
      cell.dataset.focusKey = `gbank:slot:${slotIndex++}`;
    }
    const [deposit, withdraw] = Array.from(el.querySelectorAll<HTMLElement>('.gbank-gold-btn'));
    if (deposit) deposit.dataset.focusKey = 'gbank:deposit-gold';
    if (withdraw) withdraw.dataset.focusKey = 'gbank:withdraw-gold';
    const buy = el.querySelector<HTMLElement>('.bank-buy-btn');
    if (buy) buy.dataset.focusKey = 'gbank:buy';
  }

  // Re-land focus after a full rebuild: the control the user was on (resolved
  // by its data-focus-key in the fresh tree, skipped when it came back
  // disabled), else the always-present close button. Never <body> (WCAG 2.4.3).
  private restoreControlFocus(el: HTMLElement, focusKey: string | null): void {
    restoreFirstEnabled([
      focusKey
        ? (el.querySelector(`[data-focus-key="${focusKey}"]`) as
            | (HTMLElement & { disabled?: boolean })
            | null)
        : null,
      el.querySelector('[data-close]') as HTMLElement | null,
    ]);
  }

  // Reapply the captured .bank-scroll offset to the freshly built pane, but only
  // within one pane (a tab switch starts at the top, never mid-list), and latch
  // which pane this paint drew. Every render path that mounts a scroll region
  // routes through here so the offset can never leak across panes.
  private restoreScroll(el: HTMLElement, prevScrollTop: number): void {
    const view = this.guildPane.activeView;
    const samePane = this.lastRenderedTab === this.tab && this.lastRenderedGuildView === view;
    const scroll = el.querySelector('.bank-scroll') as HTMLElement | null;
    if (scroll) scroll.scrollTop = samePane ? prevScrollTop : 0;
    this.lastRenderedTab = this.tab;
    this.lastRenderedGuildView = view;
  }

  // Per-frame (slow divider): refresh the grid when the mirror changes; close when the
  // player walks away from the banker (the mirror goes null past BANKER_RANGE).
  refreshIfChanged(): void {
    if (!this.opened) return;
    const info = this.deps.world().bankInfo;
    if (!info) {
      if (performance.now() - this.openedAt > BANK_INFO_GRACE_MS) this.close();
      return;
    }
    // The guild half rides the same signature: a guild op echo, an expansion,
    // the tab APPEARING or DISAPPEARING (guild loss, reconcile window), and a
    // canEdit flip (promotion or demotion at the banker: the buttons, action
    // rows, note, and bag-click routing all change with it) each repaint; null
    // collapses the whole guild arm so the strip drops and
    // the pane falls back to Personal in render(). Deliberately purse-free
    // (the guild enablement reads snapshot state only, see guild_bank_view.ts)
    // with ONE exception: while the bank is UNOPENED (purchasedSlots 0) and
    // the viewer may edit, the
    // open-the-bank row's shortfall marker reads the officer's own purse (rung
    // 0 is purse-paid), so the purse joins the signature for that state only
    // (a read-only member has no open row, so their pane stays purse-free).
    // Nesting the guild arm under the bankInfo null-gate above is safe because
    // guildBankInfoFor's gate is a strict SUPERSET of bankInfoFor's (same
    // banker proximity, plus alive + guild membership + a loaded book):
    // guildBank can never be non-null while bankInfo is null.
    const g = this.deps.world().guildBankInfo;
    const sig = JSON.stringify([
      info.capacity,
      info.purchasedSlots,
      info.bonusSlots,
      info.nextExpansionCost,
      info.slots,
      g && [
        g.treasury,
        g.capacity,
        g.purchasedSlots,
        g.nextExpansionPrice,
        g.slots,
        g.canEdit,
        g.purchasedSlots === 0 && g.canEdit ? this.deps.world().copper : null,
      ],
      // The activity log's own repaint arm, and NULL unless the log view is
      // actually open: the log is fetched on demand by reading it, so pulling
      // it into the signature unconditionally would make every officer standing
      // at a banker poll for a payload they are not looking at. When the view
      // IS open this is what turns the response landing (loading -> ready, or a
      // fresh row after another officer's op busted the server cache) into a
      // repaint, with no timer of its own.
      // ...and ONLY while the log view is on screen. `readAndRequestLog` reads
      // the log, and reading it is what SENDS the request, so this arm is gated
      // on the pane actually being visible rather than on the pane's remembered
      // sub-view alone: a player who opened the log and went back to the
      // Personal tab was otherwise re-requesting it every TTL for a pane nobody
      // was looking at.
      this.tab === 'guild' && g !== null ? this.guildPane.readAndRequestLog() : null,
    ]);
    if (sig === this.lastSig) return;
    this.lastSig = sig;
    // The bank data moved: any in-flight deposit-all run has echoed back (online) or
    // already applied (offline), so the button may re-enable on this repaint.
    this.clearDepositAllPending();
    this.render();
  }

  private fmt(n: number): string {
    return formatNumber(n, { maximumFractionDigits: 0 });
  }

  private fillGrid(
    grid: HTMLElement,
    slots: BankSlotModel[],
    emptyCells: number,
    empty: boolean,
  ): void {
    if (empty) {
      grid.innerHTML = `<div class="bank-empty">${esc(t('hudChrome.bank.empty'))}</div>`;
      return;
    }
    // Apply the window-local filter/sort. slotIndex rides through, so a filtered or
    // sorted cell still acts on its ORIGINAL bank slot; filterBankSlots keeps
    // unknown-id slots visible in the everything view (bank contents are server
    // truth, so a stale bundle can hold ids it predates, R34) and excludes them
    // only from category chips and name searches, exactly as the bags filter does.
    const isDefault = bagFilterIsDefault(this.filter);
    const visible = filterBankSlots(
      slots,
      (id) => knownItemDef(ITEMS, id),
      this.filter,
      (id) => this.itemNameOf(id),
    );
    if (visible.length === 0) {
      // A narrowing filter matched nothing: show the no-match line. With NO filter active
      // (only dormant unknown-id slots remain) there is nothing to "match", so keep the
      // classic empty-square pad instead of a misleading no-match line.
      if (isDefault) this.appendEmptyCells(grid, emptyCells);
      else grid.innerHTML = `<div class="bank-empty">${esc(t('hudChrome.bags.noMatch'))}</div>`;
      return;
    }
    for (const slot of visible) {
      const item = knownItemDef(ITEMS, slot.itemId);
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = `bank-item q-${slot.qualityKey}`;
      const qColor = QUALITY_COLOR[slot.qualityKey] ?? QUALITY_DEFAULT_COLOR;
      cell.style.setProperty('--bank-slot-quality', qColor);
      // Per-copy corner marks (masterwork seal, enchanted / signed / bound glyph,
      // or the generic wedge): same shared helper bags use so a banked masterwork
      // keeps its seal visible at a glance. Aria-hidden mark; the cell name
      // carries the per-copy fact. Quest items cannot enter the bank, so no
      // quest seal composes here.
      const glyphKind = bagInstanceGlyphKind(slot.instance);
      const instanceMark = instanceGlyphMarkHtml(glyphKind);
      // Stale-client guard (R34): an id this bundle predates still holds a
      // real, counted bank slot, so it renders (fallback icon, raw id as the
      // label) instead of vanishing. The withdraw click stays live because the
      // server resolves it by slotIndex, no def needed; only the def-derived
      // tooltip body is replaced.
      const countLabel = this.fmt(slot.count);
      cell.setAttribute(
        'aria-label',
        item
          ? t(glyphKind ? INSTANCE_GLYPH_ARIA_KEYS[glyphKind] : 'itemUi.bags.itemAria', {
              item: itemDisplayName(item),
              count: countLabel,
            })
          : t(
              glyphKind
                ? UNKNOWN_INSTANCE_GLYPH_ARIA_KEYS[glyphKind]
                : 'itemUi.bags.unknownItemAria',
              { id: slot.itemId, count: countLabel },
            ),
      );
      cell.innerHTML = `${item ? this.deps.itemIcon(item) : unknownItemIconHtml(slot.itemId)}${instanceMark}<span class="bank-count">${slot.showCount ? esc(t('itemUi.bags.stackCount', { count: countLabel })) : ''}</span>`;
      cell.addEventListener('click', (ev) => {
        // On touch, the click that ends a long-press peek inspects the slot (its
        // tooltip is already shown) instead of withdrawing: the release dismisses
        // the tooltip and fires nothing. A plain tap / desktop click falls through.
        if (this.deps.consumePeek()) {
          this.deps.hideTooltip();
          return;
        }
        this.onSlotClick(slot.slotIndex, ev.shiftKey);
      });
      this.deps.attachTooltip(cell, () => {
        const partial = slot.showCount
          ? `<div class="tt-sub">${esc(t('hudChrome.bank.withdrawPartialHint'))}</div>`
          : '';
        const body = item
          ? this.deps.itemTooltip(item, slot.instance)
          : `<div class="tt-title">${esc(slot.itemId)}</div><div class="tt-sub">${esc(t('itemUi.bags.unknownItem'))}</div>`;
        return `${body}<div class="tt-sub">${esc(t('hudChrome.bank.withdrawHint'))}</div>${partial}`;
      });
      grid.appendChild(cell);
    }
    // Free-slot squares only in the unfiltered view: a narrowed view shows matches only,
    // never the remaining capacity (the bags precedent).
    this.appendEmptyCells(grid, isDefault ? emptyCells : 0);
  }

  // The classic empty sockets that make remaining capacity visible at a glance.
  // Decorative, not focusable (mirrors bags).
  private appendEmptyCells(grid: HTMLElement, n: number): void {
    for (let i = 0; i < n; i++) {
      const cell = document.createElement('div');
      cell.className = 'bank-item empty';
      cell.setAttribute('aria-hidden', 'true');
      grid.appendChild(cell);
    }
  }

  // Localized display name, used for search matching AND the name-sort so both agree
  // with the visible cell. An unknown id falls back to the raw id: that is the label
  // its cell renders (the stale-client guard above), so sort and search stay agreed.
  private itemNameOf(itemId: string): string {
    const item = knownItemDef(ITEMS, itemId);
    return item ? itemDisplayName(item) : itemId;
  }

  // Repaint ONLY the grid from the live bank + current filter, preserving the search
  // input's focus/caret (the toolbar is untouched) and the scroll offset. Used by the
  // live-search keystroke path; a full render() still handles open/language/data
  // changes (mirrors bags_window.refreshGrid).
  private refreshGrid(): void {
    const grid = this.deps.root().querySelector('.bank-grid') as HTMLElement | null;
    if (!grid) return;
    const info = this.deps.world().bankInfo;
    if (!info) return; // walked away; refreshIfChanged owns the grace-close
    const model = buildBankView(info, (id) => knownItemDef(ITEMS, id));
    if (model.kind !== 'bank') return;
    // The offset lives on the .bank-scroll wrapper; emptying the grid momentarily
    // collapses the wrapper's scroll height (clamping scrollTop to 0), so capture
    // and reapply around the refill.
    const scroll = this.deps.root().querySelector('.bank-scroll') as HTMLElement | null;
    const prevScrollTop = scroll?.scrollTop ?? 0;
    grid.innerHTML = '';
    this.fillGrid(grid, model.slots, model.emptyCells, model.empty);
    if (scroll) scroll.scrollTop = prevScrollTop;
  }

  // The category-chip + sort + search toolbar, plus the deposit-all-materials button.
  // Reuses the bags filter-bar classes so the shared CSS carries the styling. A chip or
  // sort change re-renders (the bags idiom); a search keystroke routes through
  // refreshGrid so the input keeps focus and caret. The search / category / sort
  // controls only matter once the bank holds items, so they are skipped over an empty
  // bank; the deposit-all button (which acts on the BAGS) stays visible even then,
  // since dumping a fresh character's materials into an empty bank is its primary use.
  private buildFilterBar(bankEmpty: boolean): HTMLElement {
    const bar = document.createElement('div');
    bar.className = 'bag-filter-bar bank-filter-bar';

    const tools = document.createElement('div');
    tools.className = 'bag-tools';

    if (!bankEmpty) {
      const chips = document.createElement('div');
      chips.className = 'bag-chips';
      chips.setAttribute('role', 'group');
      chips.setAttribute('aria-label', t('hudChrome.bank.filterGroupAria'));
      for (const category of BAG_CATEGORIES) {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = `bag-chip${this.filter.category === category ? ' active' : ''}`;
        chip.textContent = t(BANK_CATEGORY_LABEL_KEYS[category]);
        chip.setAttribute('aria-pressed', this.filter.category === category ? 'true' : 'false');
        chip.addEventListener('click', () => {
          if (this.filter.category === category) return;
          this.filter.category = category;
          this.persistFilter();
          audio.click();
          this.render();
        });
        chips.appendChild(chip);
      }
      bar.appendChild(chips);

      const search = document.createElement('input');
      search.type = 'search';
      search.className = 'bag-search';
      search.placeholder = t('hudChrome.bags.searchPlaceholder');
      search.setAttribute('aria-label', t('hudChrome.bank.searchAria'));
      search.value = this.filter.search;
      search.addEventListener('input', () => {
        this.filter.search = search.value;
        this.persistFilter();
        this.refreshGrid();
      });
      tools.appendChild(search);

      const sort = document.createElement('select');
      sort.className = 'bag-sort';
      sort.setAttribute('aria-label', t('hudChrome.bank.sortAria'));
      for (const option of BAG_SORTS) {
        const opt = document.createElement('option');
        opt.value = option;
        opt.textContent = t(BANK_SORT_LABEL_KEYS[option]);
        if (this.filter.sort === option) opt.selected = true;
        sort.appendChild(opt);
      }
      sort.addEventListener('change', () => {
        this.filter.sort = sort.value as BagSort;
        this.persistFilter();
        audio.click();
        this.render();
      });
      tools.appendChild(sort);
    }

    // Deposit all materials: one click banks every material stack that fully fits.
    // Disabled when the bags hold no material stack; a full bank is still actionable
    // (the click reports it), so it does not disable here.
    //
    // The clarification (junk moves too, not just tradeskill materials, and
    // gathering tools never do) is exposed two ways so it reaches touch and keyboard users, not
    // only a mouse-hover title: a `title` for desktop hover, PLUS a visually-hidden
    // aria-describedby span the button always carries. A screen reader announces
    // aria-describedby on both hover and keyboard focus, and reading it needs no
    // pointer at all, so it also covers touch users who tap the button directly.
    const deposit = document.createElement('button');
    deposit.type = 'button';
    deposit.className = 'bank-deposit-all';
    deposit.textContent = t('hudChrome.bank.depositAll');
    const depositTooltip = t('hudChrome.bank.depositAllTooltip');
    deposit.title = depositTooltip;
    deposit.setAttribute('aria-describedby', 'bank-deposit-all-desc');
    deposit.disabled =
      this.depositAllPending ||
      !hasDepositableMaterials(this.deps.world().inventory, (id) => knownItemDef(ITEMS, id));
    deposit.addEventListener('click', () => this.onDepositAll());
    tools.appendChild(deposit);

    const depositDesc = document.createElement('span');
    depositDesc.id = 'bank-deposit-all-desc';
    depositDesc.className = 'visually-hidden';
    depositDesc.textContent = depositTooltip;
    tools.appendChild(depositDesc);

    bar.appendChild(tools);
    return bar;
  }

  private persistFilter(): void {
    try {
      // The search is stripped at the serialize boundary: it is per-visit state
      // (close() resets it; construction never restores it), so no keystroke,
      // chip, sort, or close write ever lands a query in storage.
      localStorage.setItem(BANK_FILTER_KEY, serializeBagFilter({ ...this.filter, search: '' }));
    } catch {
      /* storage unavailable (private mode); the filter still works in-session */
    }
  }

  // Deposit every fully-fitting material stack in one go. The plan is computed against
  // ONE snapshot (inventory + bank at click time) and every command is sent without
  // re-reading state mid-run, because the online mirror lags the authoritative world by
  // ~1 tick; sending against a mid-run mirror would double-count or mis-index.
  private onDepositAll(): void {
    const world = this.deps.world();
    const info = world.bankInfo;
    if (!info) return; // walked away between render and click
    const plan = planDepositAllMaterials(world.inventory, info.slots, info.capacity, (id) =>
      knownItemDef(ITEMS, id),
    );
    if (plan.sends.length === 0 && !plan.full) return; // nothing to do (button was disabled)
    for (const send of plan.sends) world.bankDeposit(send.slot, send.count);
    if (plan.sends.length > 0) {
      audio.coin();
      // Hold the button disabled until the data echoes back (see the field comment);
      // the timer only backstops a lost echo so the button can never wedge shut.
      this.depositAllPending = true;
      if (this.depositAllTimer !== null) window.clearTimeout(this.depositAllTimer);
      this.depositAllTimer = window.setTimeout(() => {
        this.depositAllTimer = null;
        if (!this.depositAllPending) return;
        this.depositAllPending = false;
        if (this.opened) this.render();
      }, DEPOSIT_STATUS_MS);
      // Material stacks just left the bags; repaint the companion (see the dep doc).
      // Inside the sends guard: a no-op click (nothing fit) moved nothing.
      this.deps.onInventoryChanged();
    }
    this.setDepositStatus(plan);
    this.render();
  }

  // Compose the transient summary from the PLAN (not post-facto state, which the online
  // mirror has not caught up to yet) and arm the self-expire.
  private setDepositStatus(plan: DepositAllPlan): void {
    // The arm choice (none fit / partially fit / all fit) lives in the pure core's
    // depositAllSummaryKey so its selection is unit-pinned; only the None arm
    // renders without a count token.
    const key = depositAllSummaryKey(plan);
    const text = plan.stacks === 0 ? t(key) : t(key, { count: this.fmt(plan.stacks) });
    this.depositStatus = { text, at: performance.now() };
  }

  // Build the polite aria-live summary line if one is still fresh, and arm a single timer
  // to clear it and repaint so it never lingers across later data-driven rebuilds.
  private buildDepositStatus(): HTMLElement | null {
    const s = this.depositStatus;
    if (!s) return null;
    const age = performance.now() - s.at;
    if (age >= DEPOSIT_STATUS_MS) {
      this.clearDepositStatus();
      return null;
    }
    const status = document.createElement('div');
    status.className = 'bank-status';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    status.textContent = s.text;
    if (this.statusTimer !== null) window.clearTimeout(this.statusTimer);
    this.statusTimer = window.setTimeout(() => {
      this.statusTimer = null;
      this.depositStatus = null;
      if (this.opened) this.render();
    }, DEPOSIT_STATUS_MS - age);
    return status;
  }

  // Plain click withdraws the whole stack; shift-click on a splittable stack opens a
  // quantity prompt. The pure bankSlotAction decides which (reading the live slot).
  private onSlotClick(slotIndex: number, shift: boolean): void {
    const slot = this.deps.world().bankInfo?.slots[slotIndex];
    const action = bankSlotAction(slot, slotIndex, shift);
    if (action.kind === 'withdraw') {
      this.deps.world().bankWithdraw(action.slotIndex);
      audio.click();
      // The item just moved into the bags; repaint the companion (see the dep doc).
      this.deps.onInventoryChanged();
    } else if (action.kind === 'withdrawPartial') {
      this.showWithdrawQuantityPrompt(action.slotIndex, action.max);
    }
  }

  // The footer expansion row: the next block's price on a buy button, or a maxed
  // label when purchased slots are capped. Never gated on affordability (the sim is
  // authoritative and emits its own refusal line, localized by the existing pipeline).
  private buildBuyRow(buy: BankBuySlotsModel): HTMLElement {
    const row = document.createElement('div');
    row.className = 'bank-buy-row';
    if (buy.maxed || buy.nextCost === null) {
      const maxed = document.createElement('span');
      maxed.className = 'bank-buy-maxed';
      maxed.textContent = t('hudChrome.bank.buySlotsMaxed');
      row.appendChild(maxed);
      return row;
    }
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'bank-buy-btn';
    btn.innerHTML =
      `<span class="bank-buy-label">${esc(t('hudChrome.bank.buySlots', { count: this.fmt(buy.blockSlots) }))}</span>` +
      this.deps.moneyHtml(buy.nextCost);
    btn.addEventListener('click', () => this.showBuySlotsPrompt(buy));
    row.appendChild(btn);
    return row;
  }

  // The bonus-slot breakdown footer: a header (title + the earned total like '+6')
  // over one compact row per KNOWN account source. Earned link sources show '+N';
  // unearned ones advertise what linking grants; the referral row shows its
  // {count}/{cap} progress and the invite-a-friend explainer as a detail line. Static
  // text only (no tooltip deps), all localized through t(). Returns null offline (no
  // bonusSources) so the whole section stays hidden there.
  private buildBonusSection(bonus: BankBonusModel): HTMLElement | null {
    if (!bonus.show) return null;
    const section = document.createElement('div');
    section.className = 'bank-bonus';
    // Grouped and labelled for AT; every earned/unearned state is conveyed in TEXT
    // (the '+N' / advert / progress line), never color alone.
    section.setAttribute('role', 'group');
    section.setAttribute('aria-label', t('hudChrome.bank.bonusSectionAria'));

    const head = document.createElement('div');
    head.className = 'bank-bonus-head';
    const title = document.createElement('span');
    title.className = 'bank-bonus-title';
    title.textContent = t('hudChrome.bank.bonusTitle');
    const total = document.createElement('span');
    total.className = 'bank-bonus-total';
    total.textContent = t('hudChrome.bank.bonusEarned', { count: this.fmt(bonus.total) });
    head.append(title, total);
    section.appendChild(head);

    for (const row of bonus.rows) {
      const meta = BANK_BONUS_SOURCE_KEYS[row.id];
      // Unknown source id (a future X/Twitch row landing before its label ships):
      // SKIP it. Never render a raw key or an English fallback (forward compat).
      if (!meta) continue;
      section.appendChild(this.buildBonusRow(row, meta));
    }
    return section;
  }

  private buildBonusRow(
    row: BankBonusRowModel,
    meta: { label: TranslationKey; advert: TranslationKey },
  ): HTMLElement {
    const el = document.createElement('div');
    el.className = `bank-bonus-row${row.earned ? ' earned' : ''}`;
    const label = document.createElement('span');
    label.className = 'bank-bonus-label';
    label.textContent = t(meta.label);
    const status = document.createElement('span');
    status.className = 'bank-bonus-status';
    // A source carrying progress numbers (referral, the only v1 one) shows {count}/{cap};
    // otherwise an earned source shows '+N' and an unearned one shows its advert line.
    const hasProgress = row.count !== undefined && row.cap !== undefined;
    if (hasProgress) {
      status.textContent = t('hudChrome.bank.bonusReferralProgress', {
        count: this.fmt(row.count as number),
        cap: this.fmt(row.cap as number),
      });
    } else if (row.earned) {
      status.textContent = t('hudChrome.bank.bonusStatusEarned', { count: this.fmt(row.slots) });
    } else {
      status.textContent = t(meta.advert);
    }
    el.append(label, status);
    // The referral row carries its explainer (invite a friend, they reach level 10,
    // you both keep playing) as a wrapping detail line under the label/status pair.
    if (hasProgress) {
      const detail = document.createElement('div');
      detail.className = 'bank-bonus-detail';
      detail.textContent = t(meta.advert);
      el.appendChild(detail);
    }
    return el;
  }

  private showBuySlotsPrompt(buy: BankBuySlotsModel): void {
    if (buy.nextCost === null) return;
    dismissBankPrompts();
    const opener = document.activeElement as HTMLElement | null;
    const stack = document.getElementById('prompt-stack');
    if (!stack) return;
    const prompt = document.createElement('div');
    prompt.className = 'prompt panel bank-buy-prompt';
    prompt.innerHTML = `<div class="prompt-text">${esc(
      t('hudChrome.bank.buyConfirm', {
        count: this.fmt(buy.blockSlots),
        price: formatMoney(buy.nextCost),
      }),
    )}</div>`;
    const confirm = document.createElement('button');
    confirm.className = 'btn';
    confirm.textContent = t('hudChrome.bank.buyConfirmAccept');
    const cancel = document.createElement('button');
    cancel.className = 'btn';
    cancel.textContent = t('itemUi.vendor.sellQuantityCancel');
    const close = () => prompt.remove();
    prompt.append(confirm, cancel);
    const { dismiss, dismissAndReturn } = this.installPromptDialog(prompt, opener, close);
    confirm.addEventListener('click', () => {
      this.deps.world().bankBuySlots();
      audio.coin();
      // Coin just left the purse and the bags money row shows it (see the dep doc).
      this.deps.onInventoryChanged();
      dismiss();
      // render() rebuilds the window, detaching the opener button, so land focus on
      // the always-present close button rather than letting it fall to <body>.
      (this.deps.root().querySelector('[data-close]') as HTMLElement | null)?.focus();
    });
    cancel.addEventListener('click', dismissAndReturn);
    stack.appendChild(prompt);
    window.setTimeout(() => confirm.focus(), 0);
  }

  // The shared quantity-prompt builder (bank_quantity_prompt.ts) owns the
  // chrome; this owns the bank-specific closures: the stale-index guard and
  // the withdraw send.
  private showWithdrawQuantityPrompt(slotIndex: number, maxCount: number): void {
    const slot = this.deps.world().bankInfo?.slots[slotIndex];
    if (!slot) return;
    // knownItemDef, not a raw ITEMS index: the release's stale-client sweep
    // made every bank item read tolerate an id this client does not know.
    const item = knownItemDef(ITEMS, slot.itemId);
    const itemName = item ? itemDisplayName(item) : slot.itemId;
    showQuantityPrompt(
      {
        installPromptDialog: (prompt, opener, close) =>
          this.installPromptDialog(prompt, opener, close),
        dismissSiblings: dismissBankPrompts,
      },
      {
        className: 'bank-quantity-prompt',
        titleText: t('hudChrome.bank.withdrawQuantityTitle', { item: itemName }),
        inputAriaText: t('hudChrome.bank.withdrawQuantityInput'),
        confirmText: t('hudChrome.bank.withdrawQuantityConfirm'),
        cancelText: t('itemUi.vendor.sellQuantityCancel'),
        maxCount,
        resolveCount: (requested) => {
          // The prompt captured slotIndex when it opened; the bank can repaint
          // under it (a server correction, another op landing), shifting what
          // sits at that index. Re-resolve the live slot and refuse on a
          // mismatch: silently withdrawing the WRONG item is worse than
          // dismissing the prompt. The count clamps to the live stack so a
          // shrunken stack withdraws what is there.
          const live = this.deps.world().bankInfo?.slots[slotIndex];
          if (!live || !slot || live.itemId !== slot.itemId) return null;
          return Math.max(1, Math.min(maxCount, live.count, requested));
        },
        send: (count) => {
          this.deps.world().bankWithdraw(slotIndex, count);
          audio.click();
          // The split just moved into the bags; repaint the companion (see the dep doc).
          this.deps.onInventoryChanged();
        },
        afterClose: () => {
          // The grid rebuilds on the withdraw event (and a stale refusal
          // destroyed the opener slot either way), so land on the
          // always-present close button rather than dropping focus to <body>.
          (this.deps.root().querySelector('[data-close]') as HTMLElement | null)?.focus();
        },
      },
    );
  }

  // WCAG 2.2 AA modal prompt wiring, the shared recipe (src/ui/prompt_dialog.ts):
  // #bank-window is the inert root while a prompt is open; close() clears it too
  // as a force-close backstop, so the window is never left inert while hidden.
  private installPromptDialog(
    prompt: HTMLElement,
    opener: HTMLElement | null,
    close: () => void,
  ): PromptDialogHandle {
    return installModalPromptDialog(prompt, opener, close, {
      inertRoot: this.deps.root(),
      idPrefix: 'bank-prompt-title',
    });
  }
}
