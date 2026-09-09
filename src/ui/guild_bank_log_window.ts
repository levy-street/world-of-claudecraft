// The HISTORY view of the Bank window's Guild pane: a plain-language
// transaction history of what officers have done with the guild's shared
// property, painted from the structured GuildBankLogPaneModel
// (guild_bank_log_view.ts). The pure core decides the pane state, the pressed
// filter chip, which SENTENCE each row is, and what the footer offers; this
// thin consumer crosses the i18n boundary (wording, formatMoney, the date
// formatter) and wires the two controls (the chip strip, the show-older
// button) back to the pane through its deps, nothing else.
//
// Composed by GuildBankTab (guild_bank_window.ts), which owns the Contents/
// History sub-strip, the selected filter, and the on-demand fetch trigger.
// Cold-pane contract (the bank_window cold-bucket rules): no forced-reflow
// layout read, no repeating driver of its own, and no raw hex.
//
// PLAYER-AUTHORED TEXT: a row's actor is a character name. It is spliced into a
// TEXT sink (textContent on a fresh node, never innerHTML), so the DOM escapes
// it by construction and it never passes through t() as a key. That is also why
// the whole row is built node by node rather than as an HTML string: there is
// no markup in a log line worth the risk of getting one esc() wrong on a
// surface whose entire job is to be trusted.
//
// THE THREE NON-ROW STATES ARE ALL RENDERED, and none of them is an empty list:
// loading says it is loading, a refusal says the read was declined, and an
// empty history says so in words (and says "under this filter" when a filter
// is on, because an empty Items slice is not an untouched bank). A drained
// guild bank must never be able to look like an untouched one because a frame
// went missing.

import type { ItemDef } from '../sim/types';
import type { GuildBankLogKind } from '../world_api';
import { itemDisplayName } from './entity_i18n';
import type {
  GuildBankLogFilterModel,
  GuildBankLogFooter,
  GuildBankLogPaneModel,
  GuildBankLogRowKind,
  GuildBankLogRowModel,
} from './guild_bank_log_view';
import { formatDateTime, formatMoney, formatNumber, type TranslationKey, t } from './i18n';

/** The ACTION column's word per row kind. Exhaustive over the core's
 *  discriminator, so a new kind cannot ship without its own line of copy.
 *  Deposits and withdrawals share a verb across items and money: the
 *  DETAILS column is what says whether an item stack or a sum moved. */
const ACTION_KEY: Record<GuildBankLogRowKind, TranslationKey> = {
  depositItem: 'hudChrome.bank.logActionDeposit',
  withdrawItem: 'hudChrome.bank.logActionWithdraw',
  depositMoney: 'hudChrome.bank.logActionDeposit',
  withdrawMoney: 'hudChrome.bank.logActionWithdraw',
  buySlots: 'hudChrome.bank.logActionBuySlots',
  openBank: 'hudChrome.bank.logActionOpenBank',
  charterFee: 'hudChrome.bank.logActionCharterFee',
  adminPurge: 'hudChrome.bank.logActionAdminPurge',
};

/** Kinds that put something INTO the guild's holdings; every other kind takes
 *  something out (or pays from a purse). Only a styling hint on the row: the
 *  Action word carries the meaning, never the colour alone. */
const INBOUND_KINDS: ReadonlySet<GuildBankLogRowKind> = new Set<GuildBankLogRowKind>([
  'depositItem',
  'depositMoney',
]);

/** The column headers, in column order. */
const COLUMN_KEYS: readonly TranslationKey[] = [
  'hudChrome.bank.logColTime',
  'hudChrome.bank.logColMember',
  'hudChrome.bank.logColAction',
  'hudChrome.bank.logColDetail',
];

/** The chip label per filter kind. Exhaustive over the seam's vocabulary. */
const FILTER_KEY: Record<GuildBankLogKind, TranslationKey> = {
  all: 'hudChrome.bank.logFilterAll',
  items: 'hudChrome.bank.logFilterItems',
  money: 'hudChrome.bank.logFilterMoney',
};

export interface GuildBankLogPaneDeps {
  /** Item table lookup (knownItemDef, never a raw index: a prototype key
   *  indexes to a truthy Function). Undefined means the def is gone. */
  itemDef(itemId: string): ItemDef | undefined;
  /** A filter chip was pressed: the owner remembers the kind and repaints
   *  (the next read under that kind is what requests it). */
  selectFilter(kind: GuildBankLogKind): void;
  /** The show-older button was pressed: the owner asks the world for the
   *  next page and repaints (the footer flips to its loading line). */
  loadOlder(): void;
  /** The search box changed: the owner remembers the raw text and repaints
   *  (the core filters the loaded rows through searchText below). */
  setSearch(query: string): void;
}

export class GuildBankLogPane {
  // The pane state the last paint ANNOUNCED, so a repeated repaint (any officer
  // op rebuilds this window) cannot re-announce the same refusal over and over.
  private lastAnnounced: GuildBankLogPaneModel['kind'] | null = null;
  // The footer the last paint drew, so the older-page loading line announces
  // once when it APPEARS (the same live-region rule as the refusal below) and
  // not on every repaint while the page is in flight.
  private lastFooter: GuildBankLogFooter | null = null;

  constructor(private readonly deps: GuildBankLogPaneDeps) {}

  /** Append the history view's sections to the pane root. */
  renderInto(el: HTMLElement, model: GuildBankLogPaneModel): void {
    const wrap = document.createElement('div');
    wrap.className = 'gbank-log';
    // The chip strip renders on EVERY state, so a viewer can leave an empty
    // slice or a refusal by pressing another chip, and so the strip never
    // jumps in and out between paints.
    wrap.appendChild(this.buildFilters(model.filters));
    if (model.kind !== 'rows') {
      const notice = this.buildNotice(model);
      wrap.appendChild(notice);
      el.appendChild(wrap);
      this.lastFooter = null;
      this.announce(notice, model.kind);
      return;
    }
    this.lastAnnounced = model.kind;
    // The scope line is always-visible TEXT, not a tooltip: a player reading a
    // trust surface has to know how many rows are on screen and that they run
    // newest first; the FOOTER says whether older rows exist, so an absent row
    // never reads as proof that nothing happened.
    const note = document.createElement('div');
    note.className = 'gbank-log-note';
    note.textContent =
      model.query.trim() === ''
        ? t('hudChrome.bank.logShowing', { count: this.count(model.total) })
        : t('hudChrome.bank.logShowingMatched', {
            matched: this.count(model.rows.length),
            count: this.count(model.total),
          });
    wrap.appendChild(this.buildSearch(model.query));
    wrap.appendChild(note);
    // .bank-scroll is the window's one scroll-region class; BankWindow captures
    // and restores its offset (and scopes that restore to one pane), so the log
    // list must use it rather than inventing a second scroller. The footer
    // rides INSIDE the scroller, after the rows: "show older" belongs at the
    // bottom of the list a reader has just scrolled to the end of.
    const scroll = document.createElement('div');
    scroll.className = 'bank-scroll';
    // A real TABLE: four columns (when, member, action, details) with a header
    // row the stylesheet keeps pinned to the top of the scroller, so a reader
    // fifty rows deep still knows which column is which. Semantic markup on
    // purpose: assistive tech reads a cell with its column header for free.
    const table = document.createElement('table');
    table.className = 'gbank-log-list';
    table.setAttribute('aria-label', t('hudChrome.bank.logAria'));
    const head = document.createElement('thead');
    const headRow = document.createElement('tr');
    for (const key of COLUMN_KEYS) {
      const th = document.createElement('th');
      th.scope = 'col';
      th.textContent = t(key);
      headRow.appendChild(th);
    }
    head.appendChild(headRow);
    const body = document.createElement('tbody');
    for (const row of model.rows) body.appendChild(this.buildRow(row));
    table.append(head, body);
    if (model.rows.length > 0) {
      scroll.appendChild(table);
    } else {
      // A search that matched none of the LOADED rows: said in words, with the
      // footer still offering older rows so the search can be widened.
      const none = document.createElement('div');
      none.className = 'bank-empty gbank-log-notice gbank-log-nomatch';
      none.textContent = t('hudChrome.bank.logSearchNoMatch');
      scroll.appendChild(none);
    }
    const foot = this.buildFooter(model.footer);
    scroll.appendChild(foot);
    wrap.appendChild(scroll);
    el.appendChild(wrap);
    this.announceFooter(foot, model.footer);
  }

  // The loading footer's live region is inserted already populated by the
  // rebuild, which (see announce below) is generally NOT announced; re-write
  // its text one task later, once, on the paint where it first appears.
  private announceFooter(node: HTMLElement, footer: GuildBankLogFooter): void {
    const changed = this.lastFooter !== footer;
    this.lastFooter = footer;
    if (!changed || footer !== 'loading') return;
    const text = t('hudChrome.bank.logOlderLoading');
    window.setTimeout(() => {
      node.textContent = '';
      node.appendChild(document.createTextNode(text));
    }, 0);
  }

  /** The text a search matches against for one row: exactly what the row
   *  shows in its Member, Action and Details cells, so a player can type what
   *  they see. Exposed for the owner to hand the core (GuildBankLogSearch). */
  searchText(row: GuildBankLogRowModel): string {
    return `${this.member(row)} ${t(ACTION_KEY[row.kind])} ${this.detail(row)}`;
  }

  // The search box, over the loaded rows. It reuses the bank's `.bag-search`
  // class on purpose: BankWindow's repaint captures and restores focus and
  // caret for that class, so typing survives the full rebuild every keystroke
  // causes (the bags search's live-bug precedent). The value is re-installed
  // from the owner's remembered query, never read back from the old node.
  private buildSearch(query: string): HTMLElement {
    const tools = document.createElement('div');
    tools.className = 'gbank-log-tools';
    const input = document.createElement('input');
    input.type = 'search';
    input.className = 'bag-search gbank-log-search';
    input.placeholder = t('hudChrome.bank.logSearchPlaceholder');
    input.setAttribute('aria-label', t('hudChrome.bank.logSearchAria'));
    input.autocomplete = 'off';
    input.value = query;
    input.addEventListener('input', () => this.deps.setSearch(input.value));
    tools.appendChild(input);
    return tools;
  }

  // The filter chip strip: a labelled GROUP of toggle buttons (aria-pressed),
  // the armory_inspect mode-toggle family, never a third nested tablist (the
  // pane already sits inside two) and never colour alone for the pressed state
  // (the attribute carries it; the class only styles it).
  private buildFilters(filters: GuildBankLogFilterModel[]): HTMLElement {
    const strip = document.createElement('div');
    strip.className = 'gbank-log-filters';
    strip.setAttribute('role', 'group');
    strip.setAttribute('aria-label', t('hudChrome.bank.logFilterAria'));
    for (const filter of filters) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = `gbank-log-filter${filter.selected ? ' on' : ''}`;
      chip.dataset.kind = filter.kind;
      chip.setAttribute('aria-pressed', filter.selected ? 'true' : 'false');
      chip.textContent = t(FILTER_KEY[filter.kind]);
      chip.addEventListener('click', () => {
        if (!filter.selected) this.deps.selectFilter(filter.kind);
      });
      strip.appendChild(chip);
    }
    return strip;
  }

  // The list's tail: the show-older control, its in-flight line, or the
  // start-of-history line. All three are TEXT a reader meets at the end of
  // the rows, so "the list stopped here" is never ambiguous.
  private buildFooter(footer: GuildBankLogFooter): HTMLElement {
    const foot = document.createElement('div');
    foot.className = `gbank-log-foot gbank-log-foot-${footer}`;
    if (footer === 'older') {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'gbank-log-older';
      btn.textContent = t('hudChrome.bank.logOlder');
      btn.addEventListener('click', () => this.deps.loadOlder());
      foot.appendChild(btn);
      return foot;
    }
    foot.textContent =
      footer === 'loading' ? t('hudChrome.bank.logOlderLoading') : t('hudChrome.bank.logEnd');
    if (footer === 'loading') {
      foot.setAttribute('role', 'status');
      foot.setAttribute('aria-live', 'polite');
    }
    return foot;
  }

  // The loading / refused / empty line. One node shape for all three so the
  // pane's height and focus behaviour do not jump between them.
  private buildNotice(model: Exclude<GuildBankLogPaneModel, { kind: 'rows' }>): HTMLElement {
    const line = document.createElement('div');
    line.className = `bank-empty gbank-log-notice gbank-log-${model.kind}`;
    line.textContent = this.noticeText(model);
    if (model.kind !== 'empty') {
      line.setAttribute('role', 'status');
      line.setAttribute('aria-live', 'polite');
    }
    return line;
  }

  private noticeText(model: Exclude<GuildBankLogPaneModel, { kind: 'rows' }>): string {
    switch (model.kind) {
      case 'loading':
        return t('hudChrome.bank.logLoading');
      case 'refused':
        return t('hudChrome.bank.logUnavailable');
      case 'empty':
        // An empty FILTERED slice is worded as such: "nothing has been moved"
        // would be false about a bank whose money moved while Items is pressed.
        return model.filtered ? t('hudChrome.bank.logEmptyFiltered') : t('hudChrome.bank.logEmpty');
      default: {
        const unreachable: never = model;
        return String(unreachable);
      }
    }
  }

  // Make the refusal ACTUALLY announce. A live region is announced when its
  // content CHANGES while the region is already in the accessibility tree; a
  // region inserted already-populated (which is what a full window rebuild
  // produces every time) generally is not announced at all, so the attributes
  // alone were decoration. Re-writing the same text one task later is a real
  // mutation on a live region that by then exists, and it is invisible to
  // sighted players because no paint happens in between.
  //
  // Only on a CHANGE of pane state, and only for the refusal: the refusal is
  // the one that can replace a history somebody is reading (a demotion
  // mid-view), and this window repaints on any officer's op, so announcing
  // unconditionally would nag. A one-shot timeout, never a repeating driver.
  // A late fire onto a node the next repaint already detached is harmless.
  private announce(node: HTMLElement, kind: GuildBankLogPaneModel['kind']): void {
    const changed = this.lastAnnounced !== kind;
    this.lastAnnounced = kind;
    if (!changed || kind !== 'refused') return;
    const text = t('hudChrome.bank.logUnavailable');
    window.setTimeout(() => {
      node.textContent = '';
      node.appendChild(document.createTextNode(text));
    }, 0);
  }

  private buildRow(row: GuildBankLogRowModel): HTMLElement {
    const tr = document.createElement('tr');
    tr.className = `gbank-log-row ${INBOUND_KINDS.has(row.kind) ? 'gbank-log-in' : 'gbank-log-out'}`;
    const time = document.createElement('td');
    time.className = 'gbank-log-time';
    // Through the i18n date formatter, so the locale decides ordering,
    // separators, and the 12/24 hour clock. Never a hand-built string.
    time.textContent = formatDateTime(row.at, { dateStyle: 'short', timeStyle: 'short' });
    const member = document.createElement('td');
    member.className = 'gbank-log-member';
    // textContent: the character name is player-authored and is spliced
    // verbatim into a text sink, which is the escape.
    member.textContent = this.member(row);
    const action = document.createElement('td');
    action.className = 'gbank-log-action';
    action.textContent = t(ACTION_KEY[row.kind]);
    const text = document.createElement('td');
    text.className = 'gbank-log-text';
    text.textContent = this.detail(row);
    tr.append(time, member, action, text);
    return tr;
  }

  // The MEMBER cell's text. A missing actor is a LOCALIZED stand-in, never an
  // empty cell: a blank member cell on the one surface that has to look
  // trustworthy would read as a rendering bug. The operator purge names
  // NOBODY (the core already nulled the carrier), and says who did it instead.
  private member(row: GuildBankLogRowModel): string {
    if (row.kind === 'adminPurge') return t('hudChrome.bank.logActorAdmin');
    return row.actor ?? t('hudChrome.bank.logFormerMember');
  }

  // The DETAILS cell: the stack that moved, or the sum. EXHAUSTIVE, with no
  // default arm: a default would silently route a future kind into the money
  // cell and render formatMoney(0) for it.
  private detail(row: GuildBankLogRowModel): string {
    switch (row.kind) {
      case 'depositItem':
      case 'withdrawItem':
      case 'adminPurge':
        return t('hudChrome.bank.logDetailItem', {
          count: this.count(row.count),
          item: this.itemName(row.itemId),
        });
      case 'depositMoney':
      case 'withdrawMoney':
      case 'buySlots':
      case 'openBank':
      case 'charterFee':
        return formatMoney(row.copper);
      default: {
        const unreachable: never = row.kind;
        return String(unreachable);
      }
    }
  }

  private count(count: number): string {
    return formatNumber(count, { maximumFractionDigits: 0 });
  }

  // The item's localized display name; an id whose def a content update
  // removed falls back to the raw id, the bank-grid precedent (the id is the
  // only name that exists for it, and dropping the row would hide a movement).
  private itemName(itemId: string | null): string {
    if (itemId === null) return '';
    const def = this.deps.itemDef(itemId);
    return def ? itemDisplayName(def) : itemId;
  }
}
