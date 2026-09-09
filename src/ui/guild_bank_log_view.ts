// Pure view-core for the HISTORY view of the Bank window's Guild pane: the
// guild-visible transaction history of guild bank actions, read off the IWorld
// guildBankLog() mirror. DOM/Three/i18n-free, so every rule below is unit
// tested in Node (tests/guild_bank_log_view.test.ts).
//
// WHY THE HISTORY EXISTS AT ALL: the guild bank is officer-only, so any officer
// can quietly drain shared property. The server has always recorded every op;
// this view is what lets the guild SEE it, which is the social check that
// makes officer-only withdrawals defensible.
//
// The core decides the pane STATE (loading / refused / empty / rows), which
// SENTENCE each row is, the raw values that sentence needs, which filter chip
// is pressed, and what the FOOTER offers (older rows to fetch, an older page
// loading, or the start of the history reached). It does NOT decide wording,
// money formatting, or timestamps: those cross the i18n boundary in the
// painter (guild_bank_log_window.ts), the guild_bank_view.ts +
// guild_bank_window.ts split this file mirrors. Money stays RAW COPPER here
// and times stay epoch milliseconds.
//
// THREE STATES THAT ARE NOT THE SAME THING, and conflating any two of them is
// the bug this shape exists to prevent:
//   - LOADING: no answer yet. Says so; never an empty list.
//   - REFUSED: the server declined the read (a demotion or a leave mid-view).
//     Says so; never an empty list, because "you may not see this" and "nobody
//     has done anything" are opposite facts and a drained bank must never be
//     able to look like an untouched one.
//   - EMPTY: an answer arrived and the guild genuinely has no visible history
//     (under this filter: an empty Items slice is not an untouched bank, and
//     the model says which so the painter can word it).
// A background refresh (state 'loading' while rows are already installed) keeps
// showing the installed rows rather than blinking back to the loading line.

import {
  GUILD_BANK_LOG_KINDS,
  type GuildBankLogEntry,
  type GuildBankLogKind,
  type GuildBankLogOp,
  type GuildBankLogView,
} from '../world_api';

/** Which SENTENCE a row renders. A stable discriminator, not a translation key:
 *  the painter owns the key mapping so this core stays i18n-free. */
export type GuildBankLogRowKind =
  | 'depositItem'
  | 'withdrawItem'
  | 'depositMoney'
  | 'withdrawMoney'
  | 'buySlots'
  | 'openBank'
  | 'charterFee'
  /** An operator removed a stuck (pipe-refused) item. Rendered with NO actor
   *  ever: the underlying ledger row's character is the escrow carrier, a
   *  bystander, so naming anybody would accuse the wrong person. */
  | 'adminPurge';

/** The op-to-sentence map. Exhaustive over GuildBankLogOp by construction (the
 *  Record type), so a new visible op cannot be added to the wire without a
 *  sentence being chosen for it here. */
const ROW_KIND: Record<GuildBankLogOp, GuildBankLogRowKind> = {
  deposit: 'depositItem',
  withdraw: 'withdrawItem',
  deposit_gold: 'depositMoney',
  withdraw_gold: 'withdrawMoney',
  buy_slots: 'buySlots',
  open_bank: 'openBank',
  create_fee: 'charterFee',
  admin_purge: 'adminPurge',
};

/** Row kinds that carry an item (and therefore require an itemId + count). */
const ITEM_KINDS: ReadonlySet<GuildBankLogRowKind> = new Set<GuildBankLogRowKind>([
  'depositItem',
  'withdrawItem',
  'adminPurge',
]);

/** Row kinds that carry money (and therefore require a positive copper). */
const MONEY_KINDS: ReadonlySet<GuildBankLogRowKind> = new Set<GuildBankLogRowKind>([
  'depositMoney',
  'withdrawMoney',
  'buySlots',
  'openBank',
  'charterFee',
]);

/** Kinds that NEVER name an actor, whatever the entry claimed. */
const ANONYMOUS_KINDS: ReadonlySet<GuildBankLogRowKind> = new Set<GuildBankLogRowKind>([
  'adminPurge',
]);

export interface GuildBankLogRowModel {
  /** The ledger row id: the stable list key and the newest-first sort key. */
  id: number;
  /** Epoch milliseconds; the painter renders it through the i18n date
   *  formatter, never a hand-rolled string. */
  at: number;
  kind: GuildBankLogRowKind;
  /** The acting character's name, PLAYER-AUTHORED text the painter splices
   *  verbatim into a text sink. Null means no guildmate is named: an operator
   *  action, or a character that no longer exists. */
  actor: string | null;
  /** Item id for an item kind, else null. The painter resolves the display
   *  name (an unknown id renders as the raw id, the bank-grid precedent). */
  itemId: string | null;
  /** Copies moved; 1 or more for an item kind, 0 otherwise. */
  count: number;
  /** RAW copper, a positive magnitude; 0 for an item kind. */
  copper: number;
}

/** One filter chip of the strip: its kind and whether it is the pressed one. */
export interface GuildBankLogFilterModel {
  kind: GuildBankLogKind;
  selected: boolean;
}

/** What the list's FOOTER offers. `older`: the server holds rows older than
 *  the last one shown and a click fetches the next page. `loading`: that
 *  page is in flight. `end`: the rows shown reach the start of the history,
 *  said in words so an absent row reads as "it did not happen" and not as
 *  "the list stopped here". */
export type GuildBankLogFooter = 'older' | 'loading' | 'end';

/** The pane's search, over the LOADED rows only (the server pages by cursor;
 *  a search never reaches it). `textOf` is the painter's localized text for a
 *  row (member, action, details), so the core stays i18n-free while a player
 *  can type what they actually see on screen. */
export interface GuildBankLogSearch {
  query: string;
  textOf: (row: GuildBankLogRowModel) => string;
}

/** The comparable form of a search query: trimmed and case-folded. Empty
 *  means "no search". */
export function normalizeGuildBankLogQuery(query: string): string {
  return query.trim().toLowerCase();
}

/** The rows whose text contains the query (case-insensitive substring);
 *  every row when the query is empty. Order is preserved. */
export function filterGuildBankLogRows(
  rows: readonly GuildBankLogRowModel[],
  search: GuildBankLogSearch | undefined,
): GuildBankLogRowModel[] {
  const query = normalizeGuildBankLogQuery(search?.query ?? '');
  if (query === '' || search === undefined) return [...rows];
  return rows.filter((row) => search.textOf(row).toLowerCase().includes(query));
}

export type GuildBankLogPaneModel = {
  /** The chip strip renders on EVERY pane state, so a viewer can leave an
   *  empty filter slice and a refusal repaints under the chip that was
   *  pressed when it landed. */
  filters: GuildBankLogFilterModel[];
} & (
  | { kind: 'loading' }
  | { kind: 'refused' }
  /** `filtered` is true when a narrower slice than `all` is empty: the
   *  painter words that as "nothing matches this filter" rather than "the
   *  bank was never touched", which under a filter would be false. */
  | { kind: 'empty'; filtered: boolean }
  /** `rows` are the rows to DRAW (the search's matches; every loaded row when
   *  the query is empty), `total` how many are loaded, `query` the raw text
   *  the search box shows. `rows` can be EMPTY here: a search that matched
   *  nothing is still a loaded history, and the footer still offers older
   *  rows to widen it. */
  | {
      kind: 'rows';
      rows: GuildBankLogRowModel[];
      footer: GuildBankLogFooter;
      total: number;
      query: string;
    }
);

/**
 * Turn one wire entry into a row, or null when it cannot render honestly. A
 * dropped row is deliberate: an item op with no item, or a money op that moved
 * nothing, would render as a sentence with a hole in it, and a sentence with a
 * hole in it is worse than a missing line in a trust surface.
 */
export function guildBankLogRow(entry: GuildBankLogEntry): GuildBankLogRowModel | null {
  const kind = ROW_KIND[entry.op];
  if (kind === undefined) return null;
  if (!Number.isFinite(entry.at)) return null;
  const count = ITEM_KINDS.has(kind) ? Math.max(0, Math.trunc(entry.count ?? 0)) : 0;
  const copper = MONEY_KINDS.has(kind) ? Math.max(0, Math.trunc(entry.copper ?? 0)) : 0;
  if (ITEM_KINDS.has(kind) && (entry.itemId === null || count <= 0)) return null;
  if (MONEY_KINDS.has(kind) && copper <= 0) return null;
  return {
    id: entry.id,
    at: entry.at,
    kind,
    // The anonymity rule is enforced HERE and not only server-side, so a name
    // can never reach an operator sentence even if a future server regressed.
    actor: ANONYMOUS_KINDS.has(kind) ? null : (entry.actor ?? null),
    itemId: ITEM_KINDS.has(kind) ? entry.itemId : null,
    count,
    copper,
  };
}

/** The chip strip for a view: every kind in display order, the view's own
 *  kind pressed. */
export function guildBankLogFilters(kind: GuildBankLogKind): GuildBankLogFilterModel[] {
  return GUILD_BANK_LOG_KINDS.map((k) => ({ kind: k, selected: k === kind }));
}

/**
 * Map the whole history read to the pane model. Rows come back NEWEST FIRST,
 * sorted here rather than trusted from the frame: the ledger id is monotonic,
 * so this is a total order that cannot tie, and it means a reordered or merged
 * response still reads chronologically.
 */
export function buildGuildBankLogView(
  view: GuildBankLogView,
  // The pressed chip is the VIEWER'S choice, which the pane owns; it defaults
  // to the kind the view was read under (the online mirror echoes it) but a
  // caller that remembers the selection passes it, so a stale or offline
  // answer can never un-press the chip somebody just pressed.
  selected: GuildBankLogKind = view.kind,
  search?: GuildBankLogSearch,
): GuildBankLogPaneModel {
  const filters = guildBankLogFilters(selected);
  if (view.state === 'refused') return { filters, kind: 'refused' };
  const rows: GuildBankLogRowModel[] = [];
  for (const entry of view.entries) {
    const row = guildBankLogRow(entry);
    if (row !== null) rows.push(row);
  }
  if (rows.length === 0) {
    // No rows AND still in flight is the only true loading state; no rows with
    // an answer in hand is a genuinely empty history (of this slice).
    return view.state === 'loading'
      ? { filters, kind: 'loading' }
      : { filters, kind: 'empty', filtered: selected !== 'all' };
  }
  rows.sort((a, b) => b.id - a.id);
  // The footer is the server's word (`more`), never inferred from a full page:
  // a history that happens to be exactly one window long ends in "end", and a
  // window with older rows behind it offers them even when it is short (a
  // filtered slice can be sparse).
  const footer: GuildBankLogFooter = view.olderPending ? 'loading' : view.more ? 'older' : 'end';
  return {
    filters,
    kind: 'rows',
    rows: filterGuildBankLogRows(rows, search),
    footer,
    total: rows.length,
    query: search?.query ?? '',
  };
}

/**
 * A compact signature of the history read, for the window's repaint gate.
 * Changes exactly when the pane would draw something different (the state
 * flipped, rows arrived, the newest or oldest row moved, the filter changed,
 * the footer changed), so a repaint is driven by data rather than by a timer.
 * Never includes player names: it is compared, not rendered, and ids plus a
 * count are enough to detect every change the window cares about.
 */
export function guildBankLogSignature(view: GuildBankLogView): string {
  // A reduce, not Math.max(...map(...)): this core is a public export any
  // future caller can hand a view wider than one wire page, and a spread of an
  // unbounded array is both an allocation and an arity risk on a function that
  // runs on the slow band while the log is open.
  let newest = 0;
  let oldest = 0;
  for (const entry of view.entries) {
    if (entry.id > newest) newest = entry.id;
    if (oldest === 0 || entry.id < oldest) oldest = entry.id;
  }
  const foot = view.olderPending ? 'p' : view.more ? 'm' : 'e';
  return `${view.state}:${view.kind}:${view.entries.length}:${newest}:${oldest}:${foot}`;
}
