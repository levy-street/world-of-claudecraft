// The LOG view of the Bank window's Guild pane: a plain-language history of
// what officers have done with the guild's shared property, painted from the
// structured GuildBankLogPaneModel (guild_bank_log_view.ts). The pure core
// decides the pane state and which SENTENCE each row is; this thin consumer
// crosses the i18n boundary (wording, formatMoney, the date formatter) and
// nothing else.
//
// Composed by GuildBankTab (guild_bank_window.ts), which owns the Contents/Log
// sub-strip and the on-demand fetch trigger. Cold-pane contract (the
// bank_window cold-bucket rules): no forced-reflow layout read, no repeating
// driver of its own, and no raw hex.
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
// empty history says so in words. A drained guild bank must never be able to
// look like an untouched one because a frame went missing.

import type { ItemDef } from '../sim/types';
import { GUILD_BANK_LOG_LIMIT } from '../world_api';
import { itemDisplayName } from './entity_i18n';
import type {
  GuildBankLogPaneModel,
  GuildBankLogRowKind,
  GuildBankLogRowModel,
} from './guild_bank_log_view';
import { formatDateTime, formatMoney, formatNumber, type TranslationKey, t } from './i18n';

/** The sentence key per row kind. Exhaustive over the core's discriminator, so
 *  a new kind cannot ship without its own line of copy. */
const ROW_KEY: Record<GuildBankLogRowKind, TranslationKey> = {
  depositItem: 'hudChrome.bank.logDepositItem',
  withdrawItem: 'hudChrome.bank.logWithdrawItem',
  depositMoney: 'hudChrome.bank.logDepositMoney',
  withdrawMoney: 'hudChrome.bank.logWithdrawMoney',
  buySlots: 'hudChrome.bank.logBuySlots',
  openBank: 'hudChrome.bank.logOpenBank',
  charterFee: 'hudChrome.bank.logCharterFee',
  adminPurge: 'hudChrome.bank.logAdminPurge',
};

export interface GuildBankLogPaneDeps {
  /** Item table lookup (knownItemDef, never a raw index: a prototype key
   *  indexes to a truthy Function). Undefined means the def is gone. */
  itemDef(itemId: string): ItemDef | undefined;
}

export class GuildBankLogPane {
  // The pane state the last paint ANNOUNCED, so a repeated repaint (any officer
  // op rebuilds this window) cannot re-announce the same refusal over and over.
  private lastAnnounced: GuildBankLogPaneModel['kind'] | null = null;

  constructor(private readonly deps: GuildBankLogPaneDeps) {}

  /** Append the log view's sections to the pane root. */
  renderInto(el: HTMLElement, model: GuildBankLogPaneModel): void {
    const wrap = document.createElement('div');
    wrap.className = 'gbank-log';
    if (model.kind !== 'rows') {
      const notice = this.buildNotice(model.kind);
      wrap.appendChild(notice);
      el.appendChild(wrap);
      this.announce(notice, model.kind);
      return;
    }
    this.lastAnnounced = model.kind;
    // The scope line is always-visible TEXT, not a tooltip: a player reading a
    // trust surface has to know it is a recent WINDOW and not the whole history,
    // or an absent row reads as proof that nothing happened.
    const note = document.createElement('div');
    note.className = 'gbank-log-note';
    // The window size is interpolated from the ONE seam constant, never baked
    // into the copy: a hardcoded "50" would have made the sentence lie in every
    // language the moment the cap moved, and it would have skipped formatNumber
    // (thousands separators are locale business even at this size).
    note.textContent = t('hudChrome.bank.logNote', { count: this.count(GUILD_BANK_LOG_LIMIT) });
    wrap.appendChild(note);
    // .bank-scroll is the window's one scroll-region class; BankWindow captures
    // and restores its offset (and scopes that restore to one pane), so the log
    // list must use it rather than inventing a second scroller.
    const scroll = document.createElement('div');
    scroll.className = 'bank-scroll';
    const list = document.createElement('ul');
    list.className = 'gbank-log-list';
    list.setAttribute('aria-label', t('hudChrome.bank.logAria'));
    for (const row of model.rows) list.appendChild(this.buildRow(row));
    scroll.appendChild(list);
    wrap.appendChild(scroll);
    el.appendChild(wrap);
  }

  // The loading / refused / empty line. One node shape for all three so the
  // pane's height and focus behaviour do not jump between them.
  private buildNotice(kind: 'loading' | 'refused' | 'empty'): HTMLElement {
    const line = document.createElement('div');
    line.className = `bank-empty gbank-log-notice gbank-log-${kind}`;
    line.textContent = this.noticeText(kind);
    if (kind !== 'empty') {
      line.setAttribute('role', 'status');
      line.setAttribute('aria-live', 'polite');
    }
    return line;
  }

  private noticeText(kind: 'loading' | 'refused' | 'empty'): string {
    return kind === 'loading'
      ? t('hudChrome.bank.logLoading')
      : kind === 'refused'
        ? t('hudChrome.bank.logUnavailable')
        : t('hudChrome.bank.logEmpty');
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
    const text = this.noticeText(kind);
    window.setTimeout(() => {
      node.textContent = '';
      node.appendChild(document.createTextNode(text));
    }, 0);
  }

  private buildRow(row: GuildBankLogRowModel): HTMLElement {
    const li = document.createElement('li');
    li.className = 'gbank-log-row';
    const time = document.createElement('span');
    time.className = 'gbank-log-time';
    // Through the i18n date formatter, so the locale decides ordering,
    // separators, and the 12/24 hour clock. Never a hand-built string.
    time.textContent = formatDateTime(row.at, { dateStyle: 'short', timeStyle: 'short' });
    const text = document.createElement('span');
    text.className = 'gbank-log-text';
    // textContent: the character name inside this sentence is player-authored
    // and is spliced verbatim into a text sink, which is the escape.
    text.textContent = this.sentence(row);
    li.append(time, text);
    return li;
  }

  private sentence(row: GuildBankLogRowModel): string {
    // A missing actor is a LOCALIZED stand-in, never an empty splice: a row
    // reading "  deposited 5 Iron Ore" would look like a rendering bug on the
    // one surface that has to look trustworthy. adminPurge has no actor slot in
    // its sentence at all (the operator is described, not named).
    const actor = row.actor ?? t('hudChrome.bank.logFormerMember');
    const key = ROW_KEY[row.kind];
    // EXHAUSTIVE, with no default arm: a default would silently route a future
    // kind into the money sentence and render formatMoney(0) for it.
    switch (row.kind) {
      case 'depositItem':
      case 'withdrawItem':
        return t(key, { actor, count: this.count(row.count), item: this.itemName(row.itemId) });
      case 'adminPurge':
        return t(key, { count: this.count(row.count), item: this.itemName(row.itemId) });
      case 'depositMoney':
      case 'withdrawMoney':
      case 'buySlots':
      case 'openBank':
      case 'charterFee':
        return t(key, { actor, amount: formatMoney(row.copper) });
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
