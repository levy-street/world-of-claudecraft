// The guild bank TRANSACTION HISTORY statement: one page of one guild's
// bank_ledger rows, newest first, for the in-game guild-visible history
// (server/guild_bank_log.ts owns the projection, the gate, and the cache; this
// is only the statement). Extracted from server/db.ts when the read grew a
// cursor: db.ts is a monolith under the ratchet, and a paged reader with its
// own timeout and row shape is a domain module, not coordinator wiring.
//
// PRIVACY IS THE COLUMN LIST. This is the one read whose result reaches
// players, so it selects the narrowest set that can render a sentence:
// bank_ledger.account_id, realm, and the instance payload are NOT selected at
// all, and character_id is resolved to a display name here rather than shipped.
// Nothing account-scoped can leak through a projection bug downstream, because
// nothing account-scoped is in the row.
//
// WHAT THE SCAN COSTS, honestly, per slice. The predicate rides
// bank_ledger_container_recent (container_id, id DESC) WHERE container =
// 'guild' (server/bank_ledger_indexes.ts), a backwards index scan in exactly
// the order the page wants, and the OLDER-PAGE cursor is the same column
// (`id < $n`), so an older page starts the same scan further back, never an
// OFFSET that re-walks everything newer. `op` is NOT an index column (a
// ScalarArrayOpExpr on a middle column forfeits the trailing order), so the op
// predicate is a heap FILTER on rows already arriving in id order, and the
// cost of a page is the rows WALKED to fill it, not the rows returned:
//   - `all` walks LIMIT+1 rows plus the two rare diagnostic rows it rejects,
//     so its cost is the window, whatever the guild's lifetime row count.
//   - `items` walks past every money row between item rows. Item rows are the
//     bulk of any guild's ledger (a vault deposit-all writes one row per
//     material), so the walk stays within a small multiple of the window.
//   - `money` is the SPARSE slice: on a material-heavy guild the filter would
//     heap-fetch every item row between money rows, and proving `more = false`
//     would walk the whole guild's history, a keep-forever table that only
//     grows. So the money arm rides its OWN partial index,
//     bank_ledger_container_money_recent, whose predicate names the money ops
//     as a LITERAL (BANK_LEDGER_GUILD_MONEY_OPS_PREDICATE_SQL) that the
//     statement interpolates verbatim: a bind parameter cannot prove the
//     partial-index implication at plan time, a literal can (the
//     account_wealth_db.ts large-movement precedent). The `all` and `items`
//     arms keep the `= ANY($n)` predicate and the container index.
//
// The op filter is applied HERE rather than in JS so a suppressed row never
// crosses the wire into this process at all, and so the LIMIT counts only rows
// a player can actually see (filtering after the fact would silently return
// fewer than the window it promised).

import { GUILD_BANK_LOG_OP_KIND } from '../src/world_api/guild_bank';
import { BANK_LEDGER_GUILD_MONEY_OPS_PREDICATE_SQL } from './bank_ledger_indexes';
import { runWithStatementTimeout } from './db';
import { REALM } from './realm';

export interface GuildBankLogDbRow {
  id: number;
  /** Epoch milliseconds (the column is TIMESTAMPTZ; pg hands back a Date). */
  at: number;
  /** The acting character's display name, or null when the character row is
   *  gone. Never an id. */
  characterName: string | null;
  op: string;
  itemId: string | null;
  count: number | null;
  copperDelta: number;
}

/** One page of the history plus the one fact a cursor needs: whether rows
 *  OLDER than the page's last row exist. Learned by fetching one row past the
 *  window and dropping it, so a page that happens to be exactly full never
 *  offers a "show older" that answers with nothing. */
export interface GuildBankLogDbPage {
  rows: GuildBankLogDbRow[];
  more: boolean;
}

/**
 * The per-statement bound for the history read, deliberately far BELOW the
 * pool default rather than above it.
 *
 * Intended cost is a bounded backward index scan of one page, i.e. single-digit
 * milliseconds. The cost without its index is a sequential scan of a
 * keep-forever table, and at the 15s pool default roughly ten of those in
 * flight would exhaust DB_POOL_MAX_CLIENTS and make every login and autosave on
 * the realm fail its checkout. That window is reachable now that the
 * CONCURRENTLY builds run after listen (runConcurrentIndexMigrations), and it
 * is also what a dropped index or an unhealed INVALID carcass looks like. Two
 * seconds is ~3 orders of magnitude of headroom over the intended cost and
 * still fails this ONE read instead of the realm: the caller answers the
 * player a refusal, which the pane renders.
 */
export const GUILD_BANK_LOG_TIMEOUT_MS = 2_000;

/** The money ops as the seam classifies them: the set the money arm is
 *  recognized by, and the set the partial index's literal predicate names. */
const MONEY_OPS: ReadonlySet<string> = new Set(
  Object.entries(GUILD_BANK_LOG_OP_KIND)
    .filter(([, kind]) => kind === 'money')
    .map(([op]) => op),
);

/** Whether an op list is EXACTLY the money slice (order-free). Only an exact
 *  match may ride the literal predicate: a narrower or wider list would
 *  silently return the wrong rows under it. */
export function isGuildBankMoneySlice(ops: readonly string[]): boolean {
  if (ops.length !== MONEY_OPS.size) return false;
  return ops.every((op) => MONEY_OPS.has(op));
}

/** Which statement text a read uses. Both flags are decided by the caller's
 *  inputs, never by anything a client sent verbatim. */
export interface GuildBankLogPageSqlShape {
  /** An older page (the `id <` cursor predicate) rather than the newest window. */
  cursor: boolean;
  /** The money slice: the literal op predicate over its partial index rather
   *  than `= ANY($n)` over the container index. */
  money: boolean;
}

/**
 * The statement text for one shape. Exported so the real-Postgres suite can
 * EXPLAIN exactly what ships (a hand-copied statement in a test drifts).
 *
 * Bind positions by shape: $1 is always the guild; the `all`/`items` arms bind
 * the op list at $2, then LIMIT, realm, and the cursor; the money arm has no
 * op parameter, so LIMIT, realm and the cursor shift down by one.
 *
 * Two statement TEXTS for the cursor rather than one `($n IS NULL OR id < $n)`
 * predicate: a generic plan for the OR form can demote the cursor from an
 * index condition to a filter, and a filter arm walks every newer row before
 * it finds the page. With the predicate present only when there is a cursor,
 * both shapes stay the bounded backward index scan the index was built for.
 */
export function guildBankLogPageSql(shape: GuildBankLogPageSqlShape): string {
  const limitParam = shape.money ? 2 : 3;
  const opPredicate = shape.money
    ? `bl.${BANK_LEDGER_GUILD_MONEY_OPS_PREDICATE_SQL}`
    : 'bl.op = ANY($2::text[])';
  const cursorClause = shape.cursor ? `\n        AND bl.id < $${limitParam + 2}` : '';
  return `SELECT bl.id,
            bl.created_at,
            bl.op,
            bl.item_id,
            bl.count,
            bl.copper_delta,
            c.name AS character_name
       FROM bank_ledger bl
       LEFT JOIN characters c ON c.id = bl.character_id
      WHERE bl.container = 'guild'
        AND bl.container_id = $1
        -- Realm discipline, matching every sibling statement. A guild lives on
        -- exactly one realm and guild ids are globally unique, so this cannot
        -- change which rows match today and cannot make the LIMIT scan wider;
        -- it is here so a cross-realm row could never be projected into a
        -- guild's history if that ever stopped being true.
        AND bl.realm = $${limitParam + 1}
        AND ${opPredicate}${cursorClause}
      ORDER BY bl.id DESC
      LIMIT $${limitParam}`;
}

/**
 * Read one page. `beforeId` null is the NEWEST window; a positive id asks for
 * the rows strictly older than it (the client hands back the oldest id it
 * holds). The predicate is `<`, never `<=`, so a page can never repeat the
 * cursor row, and the cursor is a bind parameter like everything else.
 */
export async function loadGuildBankLogPage(
  guildId: number,
  limit: number,
  visibleOps: readonly string[],
  beforeId: number | null,
): Promise<GuildBankLogDbPage> {
  // One row past the window is the `more` probe; a non-positive cursor is
  // treated as "no cursor" rather than as a page that can only be empty.
  const before = beforeId !== null && beforeId > 0 ? beforeId : null;
  const money = isGuildBankMoneySlice(visibleOps);
  const params: unknown[] = money
    ? [guildId, limit + 1, REALM]
    : [guildId, visibleOps, limit + 1, REALM];
  if (before !== null) params.push(before);
  const res = await runWithStatementTimeout(GUILD_BANK_LOG_TIMEOUT_MS, (query) =>
    query(guildBankLogPageSql({ cursor: before !== null, money }), params),
  );
  const rows = res.rows.map((r) => ({
    id: Number(r.id),
    at: r.created_at instanceof Date ? r.created_at.getTime() : Number(new Date(r.created_at)),
    characterName: typeof r.character_name === 'string' ? r.character_name : null,
    op: String(r.op),
    itemId: r.item_id === null || r.item_id === undefined ? null : String(r.item_id),
    count: r.count === null || r.count === undefined ? null : Number(r.count),
    // BIGINT arrives as a string from pg; Number() is safe here because every
    // legitimate copper magnitude is far inside the safe-integer range (the
    // treasury cap alone is 1e9).
    copperDelta: Number(r.copper_delta) || 0,
  }));
  const more = rows.length > limit;
  if (more) rows.length = limit;
  return { rows, more };
}

/** The newest-window read in its original shape (rows only), kept for the
 *  callers and tests that never page: the same statement with no cursor. */
export async function loadGuildBankLogRows(
  guildId: number,
  limit: number,
  visibleOps: readonly string[],
): Promise<GuildBankLogDbRow[]> {
  return (await loadGuildBankLogPage(guildId, limit, visibleOps, null)).rows;
}
