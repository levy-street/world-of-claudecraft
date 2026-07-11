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
// #prompt-stack).
//
// Chrome is the shared AAA window frame (window_frame.ts) mounted on an inner
// container so the #bank-window root stays pristine for the docking CSS; the frame
// IS the dialog (role + aria-labelledby, so no separate markDialogRoot). The slot
// grid uses the .item-cell grammar (rarity via data-quality from the quality tokens,
// no raw hex in the painter), the filter is a .filter-row / .chip / .search-field
// header, empty states use .empty-state, and the buy-slots row sits in the sticky
// .window-footer.

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
import { filterBankSlots } from './bank_filter';
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
import { itemDisplayName } from './entity_i18n';
import { esc } from './esc';
import { FOCUSABLE_SELECTOR } from './focus_manager';
import { formatMoney, formatNumber, type TranslationKey, t } from './i18n';
import type { PainterHostPresentation } from './painter_host';
import { renderWindowFrame } from './window_frame';
import type { WindowFrameDescriptor } from './window_frame_view';

// A closable, footer-bearing frame: the capacity counter, filter toolbar, transient
// deposit-all status, and the scrollable grid+bonus region render into the body; the
// buy-slots expansion row is the sticky-footer bottom action. Reuses the existing
// bank title + close keys. Instance-parameterized on '#bank-window' (title id
// 'bank-window-title').
const BANK_FRAME: WindowFrameDescriptor = {
  id: 'bank-window',
  titleKey: 'hudChrome.bank.title',
  closeLabelKey: 'hudChrome.bank.close',
  footer: true,
};

// Grace before a null bankInfo closes the window: online the bank mirror rides the
// proximity snapshot, so it can lag the open by about a tick (copies the mailbox's
// MAIL_INFO_GRACE_MS semantics with a bank-named constant, same 3000 value).
const BANK_INFO_GRACE_MS = 3_000;

// Monotonic id source for the ad-hoc prompt dialogs' aria-labelledby target, so the
// id never couples to class ordering (mirrors bags' promptDialogSeq).
let promptDialogSeq = 0;

// The confirm / quantity prompts mount into #prompt-stack (outside #bank-window). A
// window-level close() removes any that are open so it never leaves an orphaned
// aria-modal dialog floating over the closed window.
const BANK_PROMPT_SELECTOR = '.bank-quantity-prompt, .bank-buy-prompt';
function dismissBankPrompts(): void {
  for (const p of document.querySelectorAll(BANK_PROMPT_SELECTOR)) p.remove();
}

// The bank's window-local filter preferences persist under their OWN key, distinct
// from the bags' 'woc_bag_filter': the two windows share the state SHAPE (BagFilterState)
// and the tolerant serialize/parse, but keep independent category/sort/search choices.
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
  quest: 'hudChrome.bags.filterQuest',
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

export class BankWindow {
  private opened = false;
  private lastSig = '';
  private openerFocus: HTMLElement | null = null;
  private openedAt = 0;

  // Window-local filter state: category chips + sort + live search, persisted across
  // sessions under BANK_FILTER_KEY. Pure logic lives in bank_filter.ts (reusing
  // bag_filter.ts); this is the consumer. Tolerant parse: corrupt storage falls back
  // to the default filter, never throwing.
  private filter: BagFilterState = (() => {
    try {
      return parseBagFilter(localStorage.getItem(BANK_FILTER_KEY));
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

  constructor(private readonly deps: BankWindowDeps) {}

  get isOpen(): boolean {
    return this.opened;
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
    const el = this.deps.root();
    el.style.display = 'none';
    el.inert = false;
    this.opened = false;
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
    if (document.querySelector(BANK_PROMPT_SELECTOR)) {
      dismissBankPrompts();
      el.inert = false;
    }
    this.deps.hideTooltip();
    // .bank-scroll (not #bank-window) is the scroll container; it is recreated on
    // every rebuild, so capture its scroll offset and reapply it to the fresh one,
    // else a withdraw snaps the list back to the top (the bags idiom).
    const prevScrollTop = el.querySelector('.bank-scroll')?.scrollTop ?? 0;
    const model = buildBankView(this.deps.world().bankInfo, (id) => ITEMS[id]);
    // Stamp the shared AAA window frame onto an INNER mount, leaving the #bank-window
    // root pristine (never a builder class / role / aria): the frame IS the dialog
    // (role + aria-labelledby), and the root stays the docking anchor the cluster CSS
    // targets by id. The body scrolls between the pinned titlebar and the sticky
    // footer that hosts the buy-slots row.
    const mount = document.createElement('div');
    const { body, footer } = renderWindowFrame(mount, BANK_FRAME, { onClose: () => this.close() });
    // The title carries a subtitle (the Gilded Strongbox flavour) the frame builder
    // cannot interpolate; set it on the frame title span (cold-path innerHTML, esc()d).
    const titleEl = mount.querySelector<HTMLElement>('.window-title');
    if (titleEl) {
      titleEl.innerHTML = `${esc(t('hudChrome.bank.title'))} <span class="panel-subtitle">${esc(t('hudChrome.bank.subtitle'))}</span>`;
    }
    if (model.kind === 'away') {
      const away = document.createElement('div');
      away.className = 'empty-state';
      away.textContent = t('hudChrome.bank.tooFar');
      body.appendChild(away);
      el.replaceChildren(mount);
      if (hadFocus && !searchFocus)
        (el.querySelector('[data-window-close]') as HTMLElement | null)?.focus();
      return;
    }
    const capacity = document.createElement('div');
    capacity.className = 'bank-capacity';
    const used = this.fmt(model.capacity.used);
    const total = this.fmt(model.capacity.total);
    capacity.textContent = t('hudChrome.bank.capacity', { used, total });
    capacity.setAttribute('aria-label', t('hudChrome.bank.capacityAria', { used, total }));
    body.appendChild(capacity);
    // Always mount the toolbar in the bank state: the deposit-all button belongs there
    // even over an empty bank, while buildFilterBar drops the search/category/sort
    // controls when there is nothing yet to filter.
    body.appendChild(this.buildFilterBar(model.empty));
    const status = this.buildDepositStatus();
    if (status) body.appendChild(status);
    // One shared scroll region holds the grid plus the bonus breakdown as its tail:
    // at a 360px-tall phone the rigid chrome (title, capacity, toolbar, buy row)
    // leaves less than one cell row of flex space, so a fixed below-the-buy-row
    // footer either crushed the grid or clipped itself (found live in QA).
    // Scrolling past the last cells reaches the bonus copy on every viewport, and
    // the transactional buy row stays pinned below in the sticky footer.
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
    body.appendChild(scroll);
    // The buy-slots expansion row is the window's bottom transactional action: it
    // rides the sticky footer, always visible while the body scrolls.
    if (footer) footer.appendChild(this.buildBuyRow(model.buy));
    el.replaceChildren(mount);
    scroll.scrollTop = prevScrollTop;
    if (hadFocus && !searchFocus)
      (el.querySelector('[data-window-close]') as HTMLElement | null)?.focus();
    if (searchFocus) {
      const fresh = el.querySelector('.bag-search') as HTMLInputElement | null;
      if (fresh) {
        fresh.focus();
        fresh.setSelectionRange(searchFocus.start, searchFocus.end);
      } else if (hadFocus) {
        // The rebuild dropped the search box (the bank emptied): fall back to the
        // close button rather than dropping focus to <body>.
        (el.querySelector('[data-window-close]') as HTMLElement | null)?.focus();
      }
    }
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
    const sig = JSON.stringify([
      info.capacity,
      info.purchasedSlots,
      info.bonusSlots,
      info.nextExpansionCost,
      info.slots,
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
      grid.innerHTML = `<div class="empty-state">${esc(t('hudChrome.bank.empty'))}</div>`;
      return;
    }
    // Apply the window-local filter/sort. slotIndex rides through, so a filtered or
    // sorted cell still acts on its ORIGINAL bank slot; filterBankSlots drops unknown-id
    // (dormant) slots exactly as the bags filter does.
    const isDefault = bagFilterIsDefault(this.filter);
    const visible = filterBankSlots(
      slots,
      (id) => ITEMS[id],
      this.filter,
      (id) => this.itemNameOf(id),
    );
    if (visible.length === 0) {
      // A narrowing filter matched nothing: show the no-match line. With NO filter active
      // (only dormant unknown-id slots remain) there is nothing to "match", so keep the
      // classic empty-square pad instead of a misleading no-match line.
      if (isDefault) this.appendEmptyCells(grid, emptyCells);
      else grid.innerHTML = `<div class="empty-state">${esc(t('hudChrome.bags.noMatch'))}</div>`;
      return;
    }
    for (const slot of visible) {
      const item = ITEMS[slot.itemId];
      if (!item) continue;
      const cell = document.createElement('button');
      cell.type = 'button';
      // AAA item-cell grammar: rarity border from the quality tokens via data-quality
      // (the view core already resolved slot.qualityKey), the stack count in the
      // corner, and the shared focus ring.
      cell.className = 'item-cell';
      cell.setAttribute('data-quality', slot.qualityKey);
      const itemName = itemDisplayName(item);
      cell.setAttribute(
        'aria-label',
        t('itemUi.bags.itemAria', { item: itemName, count: this.fmt(slot.count) }),
      );
      cell.innerHTML = `${this.deps.itemIcon(item)}${slot.showCount ? `<span class="item-cell-count">${esc(t('itemUi.bags.stackCount', { count: this.fmt(slot.count) }))}</span>` : ''}`;
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
        return `${this.deps.itemTooltip(item)}<div class="tt-sub">${esc(t('hudChrome.bank.withdrawHint'))}</div>${partial}`;
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
      cell.className = 'item-cell is-empty';
      cell.setAttribute('aria-hidden', 'true');
      grid.appendChild(cell);
    }
  }

  // Localized display name, used for search matching AND the name-sort so both agree
  // with the visible cell. An unknown id (already dropped by filterBankSlots) falls back
  // to the raw id defensively.
  private itemNameOf(itemId: string): string {
    const item = ITEMS[itemId];
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
    const model = buildBankView(info, (id) => ITEMS[id]);
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
      chips.className = 'filter-row';
      chips.setAttribute('role', 'group');
      chips.setAttribute('aria-label', t('hudChrome.bank.filterGroupAria'));
      for (const category of BAG_CATEGORIES) {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'chip';
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

      const searchField = document.createElement('div');
      searchField.className = 'search-field';
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
      searchField.appendChild(search);
      tools.appendChild(searchField);

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
    const deposit = document.createElement('button');
    deposit.type = 'button';
    deposit.className = 'bank-deposit-all';
    deposit.textContent = t('hudChrome.bank.depositAll');
    deposit.disabled =
      this.depositAllPending ||
      !hasDepositableMaterials(this.deps.world().inventory, (id) => ITEMS[id]);
    deposit.addEventListener('click', () => this.onDepositAll());
    tools.appendChild(deposit);

    bar.appendChild(tools);
    return bar;
  }

  private persistFilter(): void {
    try {
      localStorage.setItem(BANK_FILTER_KEY, serializeBagFilter(this.filter));
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
    const plan = planDepositAllMaterials(
      world.inventory,
      info.slots,
      info.capacity,
      (id) => ITEMS[id],
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
      (this.deps.root().querySelector('[data-window-close]') as HTMLElement | null)?.focus();
    });
    cancel.addEventListener('click', dismissAndReturn);
    stack.appendChild(prompt);
    window.setTimeout(() => confirm.focus(), 0);
  }

  private showWithdrawQuantityPrompt(slotIndex: number, maxCount: number): void {
    dismissBankPrompts();
    const opener = document.activeElement as HTMLElement | null;
    const slot = this.deps.world().bankInfo?.slots[slotIndex];
    const item = slot ? ITEMS[slot.itemId] : undefined;
    const stack = document.getElementById('prompt-stack');
    if (!stack) return;
    const prompt = document.createElement('div');
    prompt.className = 'prompt panel bank-quantity-prompt';
    const itemName = item ? itemDisplayName(item) : (slot?.itemId ?? '');
    prompt.innerHTML = `<div class="prompt-text">${esc(t('hudChrome.bank.withdrawQuantityTitle', { item: itemName }))}</div>`;
    const input = document.createElement('input');
    input.className = 'prompt-number';
    input.type = 'number';
    input.setAttribute('aria-label', t('hudChrome.bank.withdrawQuantityInput'));
    input.min = '1';
    input.max = String(maxCount);
    input.step = '1';
    input.value = '1';
    const confirm = document.createElement('button');
    confirm.className = 'btn';
    confirm.textContent = t('hudChrome.bank.withdrawQuantityConfirm');
    const cancel = document.createElement('button');
    cancel.className = 'btn';
    cancel.textContent = t('itemUi.vendor.sellQuantityCancel');
    const close = () => prompt.remove();
    prompt.append(input, confirm, cancel);
    const { dismiss, dismissAndReturn } = this.installPromptDialog(prompt, opener, close);
    const submit = () => {
      // The prompt captured slotIndex when it opened; the bank can repaint under it
      // (a server correction, another op landing), shifting what sits at that
      // index. Re-resolve the live slot and refuse on a mismatch: silently
      // withdrawing the WRONG item is worse than dismissing the prompt. The count
      // clamps to the live stack so a shrunken stack withdraws what is there.
      const live = this.deps.world().bankInfo?.slots[slotIndex];
      if (!live || !slot || live.itemId !== slot.itemId) {
        dismiss();
        (this.deps.root().querySelector('[data-window-close]') as HTMLElement | null)?.focus();
        return;
      }
      const count = Math.max(
        1,
        Math.min(maxCount, live.count, Math.floor(Number(input.value) || 0)),
      );
      this.deps.world().bankWithdraw(slotIndex, count);
      audio.click();
      // The split just moved into the bags; repaint the companion (see the dep doc).
      this.deps.onInventoryChanged();
      dismiss();
      // The grid rebuilds on the withdraw event, detaching the opener slot, so land on
      // the always-present close button rather than dropping focus to <body>.
      (this.deps.root().querySelector('[data-window-close]') as HTMLElement | null)?.focus();
    };
    confirm.addEventListener('click', submit);
    cancel.addEventListener('click', dismissAndReturn);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submit();
    });
    stack.appendChild(prompt);
    window.setTimeout(() => {
      input.focus();
      input.select();
    }, 0);
  }

  // WCAG 2.2 AA modal prompt wiring (the bags installPromptDialog recipe): role=dialog
  // + aria-modal + aria-labelledby (the prompt text), a self-contained Tab cycle among
  // the prompt's controls (mounted in #prompt-stack, outside this window's reach, so
  // they own their own trap), an Escape close, and focus return to the opener. EVERY
  // teardown path routes through dismiss(), which clears the #bank-window inert this
  // sets BEFORE the prompt is removed; close() clears it too as a force-close backstop,
  // so the window is never left inert while hidden.
  private installPromptDialog(
    prompt: HTMLElement,
    opener: HTMLElement | null,
    close: () => void,
  ): { dismiss: () => void; dismissAndReturn: () => void } {
    prompt.setAttribute('role', 'dialog');
    prompt.setAttribute('aria-modal', 'true');
    const bankRoot = this.deps.root();
    bankRoot.inert = true;
    const titleEl = prompt.querySelector('.prompt-text') as HTMLElement | null;
    if (titleEl) {
      if (!titleEl.id) titleEl.id = `bank-prompt-title-${promptDialogSeq++}`;
      prompt.setAttribute('aria-labelledby', titleEl.id);
      // Name an unlabeled quantity field by the prompt's own question when it lacks a
      // dedicated aria-label (WCAG 1.3.1 / 4.1.2).
      const numInput = prompt.querySelector('.prompt-number');
      if (numInput && !numInput.hasAttribute('aria-label')) {
        numInput.setAttribute('aria-labelledby', titleEl.id);
      }
    }
    const dismiss = (): void => {
      bankRoot.inert = false;
      close();
    };
    const dismissAndReturn = (): void => {
      dismiss();
      opener?.focus();
    };
    prompt.addEventListener('keydown', (e) => {
      const ke = e as KeyboardEvent;
      // Escape: stopPropagation, not just preventDefault. The input layer's
      // window-level keydown runs the global escape action (closeAll) regardless of
      // defaultPrevented, and prompt BUTTONS are not tag-exempt like inputs, so
      // without it one keypress dismisses the prompt AND closes the whole window.
      if (ke.key === 'Escape') {
        ke.preventDefault();
        ke.stopPropagation();
        dismissAndReturn();
        return;
      }
      // Enter / Space: stopPropagation for the same reason, keeping the default so
      // native activation (Enter/Space on the confirm and cancel buttons) survives.
      // A submit handler on the quantity input runs at the target phase and removes
      // the prompt DURING this keydown, so a window-level gate keyed on the prompt's
      // presence runs too late: without the stop, the same press hits the global
      // chat/jump bind and steals the WCAG 2.4.3 focus return. The event path is
      // fixed at dispatch, so this listener still runs after the detach; only THEN
      // cancel the default too, or the browser runs the key's activation against
      // the freshly re-landed focus (Enter ghost-clicking [data-window-close] and closing
      // the whole window).
      if (ke.key === 'Enter' || ke.key === ' ' || ke.code === 'Space') {
        ke.stopPropagation();
        if (!prompt.isConnected) ke.preventDefault();
        return;
      }
      if (ke.key !== 'Tab') return;
      const f = Array.from(prompt.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
      if (f.length === 0) return;
      const first = f[0];
      const last = f[f.length - 1];
      if (ke.shiftKey && document.activeElement === first) {
        ke.preventDefault();
        last.focus();
      } else if (!ke.shiftKey && document.activeElement === last) {
        ke.preventDefault();
        first.focus();
      }
    });
    return { dismiss, dismissAndReturn };
  }
}
