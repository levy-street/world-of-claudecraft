// The durable home of one owned housing plot: the `account_freeholds` DDL, the
// one-round-trip account read, the compare-and-swap upsert, the plot-id
// generator, and the subject-access export loader. This is the SQL boundary for
// Freeholds persistence (the *_db.ts convention) and it owns nothing else: no
// sim state, no coalescing, no lifecycle, no policy. The store above it decides
// WHEN to write; this module decides only what the statement says.
//
// Two invariants a future reader must not break:
//   * `durable_rev` and `wire_rev` are PostgreSQL bigints and cross this
//     boundary as exact TEXT, never as a JS number (the discipline and the
//     comment come from server/material_source_journal_db.ts). `durable_rev`
//     fences every write, and a revision past 2^53 silently rounded into a
//     double would fence on the WRONG revision and let a stale save win.
//   * The plot save is NOT the upkeep writer. The CAS UPDATE below sets tier,
//     layout, trophies, condition, visit_policy, wire_rev, durable_rev and
//     updated_at, and NOTHING else: plot_id, schema_version, created_at,
//     upkeep_binding, upkeep_checkpoint and upkeep_credit stay exactly as the
//     writer that owns them left them, so a plot save can never clear a bound
//     upkeep checkpoint or a granted credit.
//
// No './db' import: db.ts applies FREEHOLD_SCHEMA at boot and imports this
// module, so every function here takes the pool or a narrow queryable as a
// parameter (the server/maps_db.ts and server/attribution_db.ts shape) and the
// import graph stays acyclic.

import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { FreeholdUpsertRefused } from './freehold_upsert_refused';

/** Every public plot identity carries this prefix, so an id is recognizable in
 *  a log line without being guessable or carrying an account key. */
export const FREEHOLD_PLOT_ID_PREFIX = 'plot:';

/** The wire's own bound (server/freehold_wire.ts OPAQUE_ID_MAX_LEN). */
export const FREEHOLD_PLOT_ID_MAX_LEN = 64;

/** The opaque public identity charset, shared with the wire and the DDL's own
 *  CHECK. A dot, a slash or base64 padding is deliberately absent: the client
 *  echoes the plot id back on build-presence frames, which refuse anything
 *  else at the type boundary. */
export const FREEHOLD_PLOT_ID_RE = /^[A-Za-z0-9_:-]{1,64}$/;

/** The one plot slot the writer admits today. Row shape allows more (the DDL
 *  bounds plot_index only at zero); policy does not. */
export const FREEHOLD_PRIMARY_PLOT_INDEX = 0;

/** The stored-column length ceilings this table enforces, SHAPE ONLY and
 *  deliberately far above every authored identity (the longest shipped tier id
 *  and visit policy are a fraction of these). They are exported because the
 *  worst-case record fixture has to be INSERTABLE: a maximal record the sim
 *  admits but PostgreSQL refuses with a 23514 would make the byte-ceiling proof
 *  unrunnable, and the mismatch would surface as a save that fails only in
 *  production. tests/server/freehold_db.pg.test.ts pins the fixture to these. */
export const FREEHOLD_TIER_COLUMN_MAX_LENGTH = 64;

/**
 * The ON-DISK pre-gate for the account read, in the post-TOAST bytes
 * pg_column_size reports, which it reads from the TOAST pointer header without
 * detoasting anything.
 *
 * It exists because the authoritative measure cannot be cheap:
 * `octet_length(layout::text)` has to fully detoast the column and render the
 * whole value to text BEFORE the comparison can happen, so on its own it bounds
 * the CLIENT, never the server. Measured on postgres:16-alpine, the same
 * account read costs 0.96 ms at the maximal legal row, 84.7 ms at a 7.2 MB
 * rendered row and 412 ms at a 36 MB one, each paid while holding one
 * background permit and one pool client on a box where PostgreSQL and the game
 * loop share four cores. The recovery machinery exists precisely because
 * oversized rows CAN reach disk (a later release with a bigger decor budget
 * writes one, then the realm rolls back to this build), so that cost is
 * reachable.
 *
 * WHERE 131072 COMES FROM, measured against a STORED column rather than a
 * parameterized expression, which is the only thing the gate can actually read:
 *  - the maximal legal record's two content columns measure 2,199 bytes on
 *    disk, because its worst-case ids repeat and pglz compresses them 48x;
 *  - one genuinely INCOMPRESSIBLE legal record measured 32,827 bytes on disk.
 *    That is ONE SAMPLE, not a bound: the figure moves with the identifiers the
 *    fixture uses, and independent re-measurements of the same shape have landed
 *    at 32,565 and at 35,523. Read it as the order of magnitude an incompressible
 *    row takes, never as a ceiling;
 *  - the theoretical ceiling for any legal row is its UNCOMPRESSED datum size,
 *    97,932 bytes, which is HEADER-INCLUSIVE (pg_column_size on an unstored
 *    expression reports the datum, so it carries the four-byte varlena header
 *    per column), since TOAST compression can only shrink it.
 * So 131072 sits above the largest on-disk size a legal row can ever take, with
 * a third of that again as margin, and no legal row is ever refused unmeasured.
 *
 * WHAT IT IS NOT: a bound on the detoast. pg_column_size reports the COMPRESSED
 * size, and the compression ratio is unbounded, so a deliberately
 * hyper-compressible blob can sit under any threshold and still render to
 * megabytes. There is no value of this constant that closes that, which is why
 * it is calibrated to be the smallest one that is SAFE rather than the largest
 * one that seems strict. Such a row cannot come from this codebase, whose save
 * path refuses anything past the content ceilings; `octet_length` stays the
 * authoritative measure below the gate; and the read renders it once rather
 * than three times (see the OFFSET 0 barrier in the statement). This is a
 * pathology short-circuit, not a second ceiling.
 */
export const FREEHOLD_STORED_DETOAST_GATE_BYTES = 131_072;

/** The visit-policy half of the pair FREEHOLD_TIER_COLUMN_MAX_LENGTH documents
 *  above, on the same reasoning: shape only, far above every authored policy,
 *  and exported so the worst-case fixture stays insertable. */
export const FREEHOLD_VISIT_POLICY_COLUMN_MAX_LENGTH = 32;

/** One slot of headroom past the admitted one, so an account whose ONLY row
 *  sits at an unadmitted index is SEEN rather than read as absence. This
 *  docblock used to sit two declarations above the constant it describes, so
 *  the invariant it states had no hover text and its neighbour wore the wrong
 *  one. */
export const FREEHOLD_ACCOUNT_PLOT_READ_LIMIT = 2;

/** An explicitly unbound row: no upkeep-derived day or week stamp, no credit.
 *  The DDL's last CHECK is what makes that a fact rather than a convention. */
export const FREEHOLD_UPKEEP_BINDING_UNBOUND = 'unbound_no_history';

/** The two NARROW integer columns' own ranges, so the writer refuses what the
 *  column would refuse. plot_index is SMALLINT and schema_version is INT; a
 *  value past either raises 22003 in the database and aborts the CALLER's whole
 *  transaction, which is the failure every refusal in requireUpsertInput exists
 *  to prevent. */
export const FREEHOLD_PLOT_INDEX_COLUMN_MAX = 32_767;
export const FREEHOLD_SCHEMA_VERSION_COLUMN_MAX = 2_147_483_647;

/**
 * The freehold plot DDL, applied by ensureSchema (server/db.ts) at every boot
 * under the boot advisory lock. Idempotent and additive: CREATE ... IF NOT
 * EXISTS only, no ALTER of an existing table and no data migration.
 *
 * `schemaName` exists so the real-PostgreSQL suite can install into a private
 * schema (tests/server/freehold_db.pg.test.ts): the created objects are
 * qualified through the `__woc_freehold_schema__` placeholder, the
 * storage_purchase_db.ts substitution idiom. Deliberately WITHOUT that module's
 * SET LOCAL search_path ceremony: this fragment defines no trigger and no
 * function, so it needs no fixed execution path, and ensureSchema runs every
 * fragment on ONE client inside ONE transaction, where a SET LOCAL search_path
 * would leak into every later fragment until explicitly replayed back. Not
 * touching search_path at all is the smaller blast radius. `accounts` stays
 * unqualified for the same reason it does in maps_db.ts: the foreign key must
 * resolve through the applying connection's own search_path.
 */
export function freeholdSchema(schemaName = 'public'): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(schemaName)) {
    throw new Error('freehold schema must be a simple lowercase identifier');
  }
  const schema = `"${schemaName}"`;
  return `
-- KEEP FOREVER, and deliberately exempt from the retention sweep
-- (server/retention_sweep.ts), like seeker_entitlement_claims and
-- content_moderation_actions. This table is bounded at a small number of plots
-- per ACCOUNT: it never grows per event, per session or per day, because each
-- row IS the player's built home rather than a record of something that
-- happened. There is no aging predicate to write and none may be added; the
-- reverse foreign-key cascade from accounts is the only removal path there is.
CREATE TABLE IF NOT EXISTS "__woc_freehold_schema__".account_freeholds (
  account_id INT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  plot_index SMALLINT NOT NULL,
  plot_id TEXT NOT NULL,
  schema_version INT NOT NULL DEFAULT 1,
  durable_rev BIGINT NOT NULL DEFAULT 1,
  wire_rev BIGINT NOT NULL DEFAULT 0,
  tier TEXT NOT NULL,
  layout JSONB NOT NULL DEFAULT '[]'::jsonb,
  trophies JSONB NOT NULL DEFAULT '[]'::jsonb,
  condition SMALLINT NOT NULL DEFAULT 100,
  visit_policy TEXT NOT NULL DEFAULT 'closed',
  upkeep_binding TEXT NOT NULL DEFAULT '${FREEHOLD_UPKEEP_BINDING_UNBOUND}',
  upkeep_checkpoint JSONB,
  upkeep_credit JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- One row per (account, plot slot). account_id LEADS the key on purpose; see
  -- the index note under the table.
  PRIMARY KEY (account_id, plot_index),
  -- SHAPE ONLY. The approved per-account plot cap is enforced by the writer in
  -- TypeScript, never here: CREATE TABLE IF NOT EXISTS never revisits an inline
  -- constraint, so a policy cap baked in now would raise 23514 forever once the
  -- cap widens, on rows a later release considers perfectly legal.
  CONSTRAINT account_freeholds_plot_index_shape
    CHECK (plot_index >= 0),
  -- The shared opaque public identity charset: what the wire admits and what
  -- mintFreeholdPlotId is required to produce. This one IS a policy rather than
  -- a shape, unlike its siblings, and it is frozen here on purpose: the charset
  -- is the wire's own permanent contract, so widening it is a wire change
  -- before it is a schema change. CREATE TABLE IF NOT EXISTS never revisits an
  -- inline constraint, so a release that does widen the wire owes an explicit
  -- named ALTER TABLE ... DROP CONSTRAINT / ADD CONSTRAINT in its own DDL; it
  -- cannot be relaxed by editing the line above.
  CONSTRAINT account_freeholds_plot_id_charset
    CHECK (plot_id ~ '^[A-Za-z0-9_:-]{1,64}$'),
  -- A row always declares which persisted shape it was written in.
  CONSTRAINT account_freeholds_schema_version_positive
    CHECK (schema_version >= 1),
  -- The compare-and-swap fence starts at one and only ever climbs.
  CONSTRAINT account_freeholds_durable_rev_positive
    CHECK (durable_rev >= 1),
  -- The wire revision is the client-facing counter and starts unwritten.
  CONSTRAINT account_freeholds_wire_rev_nonnegative
    CHECK (wire_rev >= 0),
  -- Condition is a percentage; a value outside it would render a broken bar.
  CONSTRAINT account_freeholds_condition_range
    CHECK (condition BETWEEN 0 AND 100),
  -- SHAPE ONLY, never the authored tier set: a tier this build does not admit
  -- must still READ BACK, so recovery can preserve it instead of erasing a home.
  CONSTRAINT account_freeholds_tier_shape
    CHECK (tier <> '' AND length(tier) <= ${FREEHOLD_TIER_COLUMN_MAX_LENGTH}),
  -- Shape only, same reason: an unadmitted policy must survive a readback.
  CONSTRAINT account_freeholds_visit_policy_shape
    CHECK (visit_policy <> '' AND length(visit_policy) <= ${FREEHOLD_VISIT_POLICY_COLUMN_MAX_LENGTH}),
  -- Shape only: the upkeep writer owns this vocabulary, not this table.
  CONSTRAINT account_freeholds_upkeep_binding_shape
    CHECK (upkeep_binding <> '' AND length(upkeep_binding) <= 32),
  -- Owned content is a LIST of placements; an object or a scalar here would
  -- make every loader's shape check a guess.
  CONSTRAINT account_freeholds_layout_array
    CHECK (jsonb_typeof(layout) = 'array'),
  CONSTRAINT account_freeholds_trophies_array
    CHECK (jsonb_typeof(trophies) = 'array'),
  -- An explicitly unbound row carries NO upkeep-derived day or week stamp and
  -- no credit: the two together would claim a billing history that never ran.
  CONSTRAINT account_freeholds_unbound_carries_no_upkeep
    CHECK (upkeep_binding <> '${FREEHOLD_UPKEEP_BINDING_UNBOUND}'
      OR (upkeep_checkpoint IS NULL AND upkeep_credit IS NULL))
);
-- The opaque public identity is globally unique: a client echoes a plot id back
-- on build-presence and visit frames, so two plots may never answer to one id.
-- PROBED FIRST (07a): a no-op CREATE INDEX IF NOT EXISTS still takes the
-- table's SHARE lock and holds it to the boot COMMIT, which would block every
-- other realm's plot writes through this realm's whole boot.
DO $account_freeholds_plot_id$
BEGIN
  IF to_regclass('"__woc_freehold_schema__".account_freeholds_plot_id') IS NULL THEN
CREATE UNIQUE INDEX IF NOT EXISTS account_freeholds_plot_id
  ON "__woc_freehold_schema__".account_freeholds (plot_id);
  END IF;
END;
$account_freeholds_plot_id$;
-- NO separate account_id index, on purpose. PostgreSQL indexes no referencing
-- side of a foreign key, but PRIMARY KEY (account_id, plot_index) builds a
-- unique btree whose LEADING column is account_id, and the accounts ON DELETE
-- CASCADE probes exactly WHERE account_id = $1, which that key serves as a
-- leading-prefix scan. The account read below rides the same prefix. Adding an
-- account-only index would be pure write amplification on every plot save;
-- server/play_session_retention_db.ts makes the same call for play_session_totals
-- and account_ip_associations, for the same reason.
`.replaceAll('"__woc_freehold_schema__"', schema);
}

export const FREEHOLD_SCHEMA = freeholdSchema();

/** The pg surface this module needs. A Pool, a PoolClient, or a test double
 *  satisfies it; nothing here opens a connection or starts a transaction. */
export interface FreeholdQueryable {
  query(
    text: string,
    values?: unknown[],
  ): Promise<{ rows?: Record<string, unknown>[]; rowCount?: number | null }>;
}

/** One durable plot row as this boundary hands it up. */
export interface FreeholdRow {
  readonly accountId: number;
  readonly plotIndex: number;
  readonly plotId: string;
  readonly schemaVersion: number;
  /** PostgreSQL bigint, exact as text; never parsed into a JS number. */
  readonly durableRev: string;
  /** PostgreSQL bigint, exact as text; never parsed into a JS number. */
  readonly wireRev: string;
  readonly tier: string;
  /** Parsed JSONB exactly as stored (pg hands objects, never strings). */
  readonly layout: unknown;
  readonly trophies: unknown;
  readonly condition: number;
  readonly visitPolicy: string;
  readonly upkeepBinding: string;
  /** Uncompressed serialized bytes of layout plus trophies, measured in SQL. */
  readonly ownedBytes: number;
}

export type FreeholdRowLoad =
  | { readonly kind: 'absent' }
  | { readonly kind: 'row'; readonly row: FreeholdRow }
  | {
      readonly kind: 'oversize';
      readonly plotIndex: number;
      readonly plotId: string;
      readonly durableRev: string;
      /** The MEASURED stored text length, or 0 when the row was refused on its
       *  on-disk size before anything was rendered (see detoastRefused). */
      readonly bytes: number;
      readonly limit: number;
      /** True when the on-disk pre-gate refused the row without rendering it,
       *  so `bytes` is unmeasured and `diskBytes` carries what WAS measured. A
       *  refusal that reports a number it never took is worse than one that
       *  says which number it has. */
      readonly detoastRefused: boolean;
      /** The post-TOAST on-disk size of the two content columns. */
      readonly diskBytes: number;
    }
  /** 07a: another realm holds this plot's live claim, so this realm reads no
   *  row and writes none until a later login finds the claim free. A CAPACITY
   *  answer (repairable), never a data one: the row itself is fine. */
  | {
      readonly kind: 'claim_busy';
      readonly plotIndex: number;
      readonly plotId: string;
    }
  | {
      readonly kind: 'unadmitted';
      readonly plotIndex: number;
      readonly plotId: string;
      readonly durableRev: string;
      readonly detail: string;
    };

// ONE round trip for the whole account, bounded TWICE and in that order.
//
// The authoritative bound is measured IN SQL the server/db.ts loadGuildBankRow
// way: a LATERAL computes the UNCOMPRESSED serialized size once per row
// (octet_length of the text form, never pg_column_size, which reports the
// post-TOAST COMPRESSED size and would let a highly compressible multi-megabyte
// blob slip under the bound), and the two content columns come back NULL past
// it, so an oversized row never crosses the wire into a deep parse.
//
// Ahead of it sits a CHEAP on-disk pre-gate, because octet_length is not free
// on the server side: it must fully detoast the column and render it to text
// before the comparison can happen, so on its own it bounds the client and not
// the database. pg_column_size reads the TOAST pointer header instead. Past the
// gate the measured size comes back NULL, which the reader classifies as
// oversize WITHOUT ever having rendered the value. See
// FREEHOLD_STORED_DETOAST_GATE_BYTES for what the gate does and does not
// promise.
//
// OFFSET 0 is an OPTIMIZATION BARRIER, not decoration. Without it the planner
// flattens the LATERAL into the target list and inlines `owned_bytes` into all
// three output expressions, so the render runs once for the measure and once
// inside each of the two content CASEs: measured 35.4 ms against 13.6 ms for a
// single render at 4.88 MB of text. The barrier makes it 13.7 ms, one render,
// and it is exactly the residual the pre-gate above exists to bound.
//
// AND ONLY THE ADMITTED SLOT IS MEASURED OR RETURNED. The LIMIT admits two rows
// so a stranded slot is SEEN rather than read as absence, but the caller reads
// content from the primary row alone and takes only plot_id and durable_rev from
// a stranded one. Measured, rendering the second row cost 0.50 ms against
// 0.76 ms at two legal rows (167,678 layout bytes crossing the wire, half of
// them discarded) and 16.9 ms against 34.1 ms at two hyper-compressible rows
// under the pre-gate, all of it paid while holding one background permit and one
// pool client. The plot_index test nulls the measure for a stranded row, which
// nulls both content CASEs with it.
//
// The explicit LIMIT is the last part of the same promise: a corrupted account
// can never turn one boot read into an unbounded scan. Read it as the
// INDEX-ORDERED PLAN's bound rather than the LIMIT's own: plot_index carries
// CHECK (>= 0), so the admitted slot is the minimum possible value and always
// sorts into the first two rows. At a cardinality small enough for the planner
// to pick a sequential scan plus a Sort, the LATERAL runs once per matching row
// before the LIMIT applies, which is harmless because such a table also has few
// rows per account.
const FREEHOLD_ACCOUNT_READ_SQL = `SELECT f.plot_index,
       f.plot_id,
       f.schema_version,
       f.durable_rev::text AS durable_rev,
       f.wire_rev::text AS wire_rev,
       f.tier,
       f.condition,
       f.visit_policy,
       f.upkeep_binding,
       b.disk_bytes,
       b.owned_bytes,
       CASE WHEN b.owned_bytes <= $2 THEN f.layout ELSE NULL END AS layout,
       CASE WHEN b.owned_bytes <= $2 THEN f.trophies ELSE NULL END AS trophies
  FROM account_freeholds f
  LEFT JOIN LATERAL (
    SELECT disk_bytes, owned_bytes FROM (
      SELECT d.disk_bytes,
             CASE
               WHEN f.plot_index <> ${FREEHOLD_PRIMARY_PLOT_INDEX} THEN NULL
               WHEN d.disk_bytes > ${FREEHOLD_STORED_DETOAST_GATE_BYTES} THEN NULL
               ELSE COALESCE(octet_length(f.layout::text), 0)
                  + COALESCE(octet_length(f.trophies::text), 0)
             END AS owned_bytes
        FROM (
          SELECT COALESCE(pg_column_size(f.layout), 0)
               + COALESCE(pg_column_size(f.trophies), 0) AS disk_bytes
        ) d
    ) m OFFSET 0
  ) b ON true
 WHERE f.account_id = $1
 ORDER BY f.plot_index
 LIMIT ${FREEHOLD_ACCOUNT_PLOT_READ_LIMIT}`;

function requireAccountId(accountId: number): void {
  if (!Number.isSafeInteger(accountId) || accountId <= 0) {
    throw new RangeError('freehold accountId must be a positive safe integer');
  }
}

/** A bigint that arrived as anything but exact digits is a broken read, never a
 *  value to coerce: `String(1e21)` would hand back '1e+21' and fence forever. */
function readBigintText(value: unknown, column: string): string {
  if (typeof value !== 'string' || !/^[0-9]+$/.test(value)) {
    throw new TypeError(`account_freeholds.${column} must come back as exact bigint text`);
  }
  return value;
}

function toFreeholdRow(accountId: number, row: Record<string, unknown>): FreeholdRow {
  return {
    accountId,
    plotIndex: Number(row.plot_index),
    plotId: String(row.plot_id),
    schemaVersion: Number(row.schema_version),
    durableRev: readBigintText(row.durable_rev, 'durable_rev'),
    wireRev: readBigintText(row.wire_rev, 'wire_rev'),
    tier: String(row.tier),
    layout: row.layout ?? null,
    trophies: row.trophies ?? null,
    condition: Number(row.condition),
    visitPolicy: String(row.visit_policy),
    upkeepBinding: String(row.upkeep_binding),
    ownedBytes: Number(row.owned_bytes) || 0,
  };
}

/**
 * The whole account's housing in one statement, ordered by plot slot.
 *
 * Classification, in the order the caller cares about:
 *   * no row at all                      -> 'absent' (this account may build)
 *   * the admitted primary slot is there -> 'row', or 'oversize' past the bound
 *   * only unadmitted slots came back    -> 'unadmitted', NEVER absence: reading
 *     a stranded row as "no plot" would let the writer mint a second plot and
 *     bury the first one where nothing ever looks again.
 * An unadmitted slot ALONGSIDE the primary one is not a refusal: the primary row
 * loads and the extra is the writer's problem, not the reader's.
 */
export async function freeholdForAccount(
  db: FreeholdQueryable,
  accountId: number,
  maxOwnedBytes: number,
): Promise<FreeholdRowLoad> {
  requireAccountId(accountId);
  if (!Number.isSafeInteger(maxOwnedBytes) || maxOwnedBytes <= 0) {
    // A non-finite bound would make the SQL comparison answer NULL, which nulls
    // both content columns while the JS side still classifies the row as fine.
    throw new RangeError('freehold maxOwnedBytes must be a positive safe integer');
  }
  const res = await db.query(FREEHOLD_ACCOUNT_READ_SQL, [accountId, maxOwnedBytes]);
  const rows = res.rows ?? [];
  if (rows.length === 0) return { kind: 'absent' };

  const primary = rows.find((row) => Number(row.plot_index) === FREEHOLD_PRIMARY_PLOT_INDEX);
  if (primary === undefined) {
    const stranded = rows[0];
    const plotIndex = Number(stranded.plot_index);
    return {
      kind: 'unadmitted',
      plotIndex,
      plotId: String(stranded.plot_id),
      durableRev: readBigintText(stranded.durable_rev, 'durable_rev'),
      detail: `plot_index ${plotIndex} is outside the admitted slot ${FREEHOLD_PRIMARY_PLOT_INDEX}`,
    };
  }

  const diskBytes = Number(primary.disk_bytes) || 0;
  // NULL is the on-disk pre-gate's answer: the row was too large to render, so
  // there is no measured text length and none was paid for.
  const measured = primary.owned_bytes;
  if (measured === null || measured === undefined) {
    return {
      kind: 'oversize',
      plotIndex: Number(primary.plot_index),
      plotId: String(primary.plot_id),
      durableRev: readBigintText(primary.durable_rev, 'durable_rev'),
      bytes: 0,
      limit: maxOwnedBytes,
      detoastRefused: true,
      diskBytes,
    };
  }
  const bytes = Number(measured) || 0;
  if (bytes > maxOwnedBytes) {
    return {
      kind: 'oversize',
      plotIndex: Number(primary.plot_index),
      plotId: String(primary.plot_id),
      durableRev: readBigintText(primary.durable_rev, 'durable_rev'),
      bytes,
      limit: maxOwnedBytes,
      detoastRefused: false,
      diskBytes,
    };
  }
  return { kind: 'row', row: toFreeholdRow(accountId, primary) };
}

export interface FreeholdUpsert {
  readonly accountId: number;
  readonly plotIndex: number;
  readonly plotId: string;
  readonly tier: string;
  readonly layoutJson: string;
  readonly trophiesJson: string;
  readonly condition: number;
  readonly visitPolicy: string;
  readonly wireRev: number;
  /** The persisted SHAPE this document was written in. Written explicitly on
   *  every save rather than left to the column DEFAULT, because the column is
   *  what a LATER build reads to decide whether it can interpret the row at
   *  all. Left to the default, a future release writing shape 2 would leave
   *  every row claiming shape 1, and a rollback to a shape-1 build would accept
   *  a document it cannot read: the forward-version refusal would be inert
   *  exactly when it is the only thing standing between a rollback and a
   *  misread house. */
  readonly schemaVersion: number;
  /** The durable revision this save is fencing on, or null for insert-only
   *  (the first write for this account and slot). */
  readonly expectedDurableRev: string | null;
}

export type FreeholdUpsertResult =
  | { readonly kind: 'inserted'; readonly durableRev: string }
  | { readonly kind: 'updated'; readonly durableRev: string }
  | { readonly kind: 'stale'; readonly durableRev: string }
  | { readonly kind: 'missing' }
  | { readonly kind: 'conflict'; readonly detail: string };

// The first write for a slot. DO NOTHING rather than DO UPDATE: an insert that
// finds a row has lost a race with another writer, and overwriting there would
// silently discard whatever that writer built.
const FREEHOLD_INSERT_SQL = `INSERT INTO account_freeholds
    (account_id, plot_index, plot_id, tier, layout, trophies, condition, visit_policy, wire_rev,
     schema_version)
VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8, $9::bigint, $10)
ON CONFLICT (account_id, plot_index) DO NOTHING
RETURNING durable_rev::text AS durable_rev`;

// The compare-and-swap save. The WHERE pins the exact durable revision this
// caller read, so a stale session can never clobber a newer save (the
// server/maps_db.ts updateMapIfVersion shape, on a bigint fence).
//
// THE SET LIST IS THE INVARIANT. plot_id, created_at, upkeep_binding,
// upkeep_checkpoint and upkeep_credit are ABSENT on purpose: the plot save is
// not the upkeep writer and must never clear a bound checkpoint or a granted
// credit, and the plot identity is minted once and never re-minted. Anything
// added to this SET needs its own writer's consent.
//
// schema_version IS present, and has to be: the writer is the only party that
// knows which shape it just serialized, and the column is what a later or
// EARLIER build reads to decide whether it may interpret the row. Leaving it to
// the column DEFAULT would make every row claim shape 1 forever.
const FREEHOLD_CAS_UPDATE_SQL = `UPDATE account_freeholds
   SET tier = $4,
       layout = $5::jsonb,
       trophies = $6::jsonb,
       condition = $7,
       visit_policy = $8,
       wire_rev = $9::bigint,
       schema_version = $10,
       durable_rev = durable_rev + 1,
       updated_at = now()
 WHERE account_id = $1 AND plot_index = $2 AND durable_rev = $3::bigint
RETURNING durable_rev::text AS durable_rev`;

// The one follow-up read that turns "zero rows" into a diagnosis: a present row
// means the fence moved (stale), an absent one means the target is gone.
const FREEHOLD_CURRENT_REV_SQL = `SELECT durable_rev::text AS durable_rev
  FROM account_freeholds
 WHERE account_id = $1 AND plot_index = $2`;

/** Every structural refusal happens BEFORE a byte reaches the database (the
 *  server/material_source_journal_db.ts rule): a malformed value sent anyway
 *  would raise 22P02 or 23514 and abort the caller's whole transaction, where a
 *  throw here costs the caller nothing it had not already broken. */
function requireUpsertInput(input: FreeholdUpsert): void {
  if (!Number.isSafeInteger(input.accountId) || input.accountId <= 0) {
    throw new FreeholdUpsertRefused('freehold accountId must be a positive safe integer');
  }
  // BOUNDED AT THE COLUMN, not just at zero. plot_index is SMALLINT and
  // schema_version is INT: a value past either raises 22003 and aborts the
  // caller's whole transaction, which is exactly what this function's header
  // promises cannot happen. Unreachable from today's one writer, which uses the
  // primary slot, and load-bearing for the second-slot writer the ladder owes.
  if (
    !Number.isSafeInteger(input.plotIndex) ||
    input.plotIndex < 0 ||
    input.plotIndex > FREEHOLD_PLOT_INDEX_COLUMN_MAX
  ) {
    throw new FreeholdUpsertRefused(
      `freehold plotIndex must be an integer between 0 and ${FREEHOLD_PLOT_INDEX_COLUMN_MAX}`,
    );
  }
  if (typeof input.plotId !== 'string' || !FREEHOLD_PLOT_ID_RE.test(input.plotId)) {
    throw new FreeholdUpsertRefused('freehold plotId must match the opaque plot id charset');
  }
  if (typeof input.tier !== 'string' || input.tier === '') {
    throw new FreeholdUpsertRefused('freehold tier must be a non-empty string');
  }
  if (typeof input.visitPolicy !== 'string' || input.visitPolicy === '') {
    throw new FreeholdUpsertRefused('freehold visitPolicy must be a non-empty string');
  }
  // AND THEY HAVE TO BE JSON ARRAYS. A string that is not parseable raises
  // 22P02 on the ::jsonb cast and one that parses to an object or a scalar
  // raises 23514 on the two array CHECKs; both abort the caller's transaction,
  // and both are refusals this function claims to make before a byte is sent.
  // Parsed rather than pattern-matched, because the DDL's own test is
  // jsonb_typeof and nothing cheaper answers the same question.
  for (const [name, json] of [
    ['layoutJson', input.layoutJson],
    ['trophiesJson', input.trophiesJson],
  ] as const) {
    if (typeof json !== 'string') {
      throw new FreeholdUpsertRefused(
        'freehold layoutJson and trophiesJson must be serialized strings',
      );
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch {
      throw new FreeholdUpsertRefused(`freehold ${name} must be parseable JSON`);
    }
    if (!Array.isArray(parsed)) {
      throw new FreeholdUpsertRefused(`freehold ${name} must serialize a JSON array`);
    }
  }
  if (!Number.isSafeInteger(input.condition) || input.condition < 0 || input.condition > 100) {
    throw new FreeholdUpsertRefused('freehold condition must be an integer between 0 and 100');
  }
  if (!Number.isSafeInteger(input.wireRev) || input.wireRev < 0) {
    throw new FreeholdUpsertRefused('freehold wireRev must be a non-negative safe integer');
  }
  if (
    !Number.isSafeInteger(input.schemaVersion) ||
    input.schemaVersion < 1 ||
    input.schemaVersion > FREEHOLD_SCHEMA_VERSION_COLUMN_MAX
  ) {
    throw new FreeholdUpsertRefused(
      `freehold schemaVersion must be an integer between 1 and ${FREEHOLD_SCHEMA_VERSION_COLUMN_MAX}`,
    );
  }
  // The two stored-column ceilings, checked HERE rather than left to the DDL,
  // for the same reason as every other refusal in this function: a value the
  // CHECK would refuse raises 23514 and aborts the caller's whole transaction.
  if (input.tier.length > FREEHOLD_TIER_COLUMN_MAX_LENGTH) {
    throw new FreeholdUpsertRefused(
      `freehold tier must be at most ${FREEHOLD_TIER_COLUMN_MAX_LENGTH} characters`,
    );
  }
  if (input.visitPolicy.length > FREEHOLD_VISIT_POLICY_COLUMN_MAX_LENGTH) {
    throw new FreeholdUpsertRefused(
      `freehold visitPolicy must be at most ${FREEHOLD_VISIT_POLICY_COLUMN_MAX_LENGTH} characters`,
    );
  }
  if (input.expectedDurableRev !== null && !/^[0-9]+$/.test(input.expectedDurableRev)) {
    throw new FreeholdUpsertRefused(
      'freehold expectedDurableRev must be null or exact bigint text',
    );
  }
}

/**
 * One durable plot write: insert-only when the caller holds no revision, a
 * compare-and-swap update when it does. At most two round trips, and the second
 * only ever DIAGNOSES a write that did not happen.
 */
export async function upsertFreehold(
  db: FreeholdQueryable,
  input: FreeholdUpsert,
): Promise<FreeholdUpsertResult> {
  requireUpsertInput(input);
  const content = [
    input.accountId,
    input.plotIndex,
    input.plotId,
    input.tier,
    input.layoutJson,
    input.trophiesJson,
    input.condition,
    input.visitPolicy,
    String(input.wireRev),
    input.schemaVersion,
  ];

  if (input.expectedDurableRev === null) {
    const res = await insertFreeholdRow(db, content);
    if (res === null) {
      // A plot_id unique violation, which ON CONFLICT (account_id, plot_index)
      // does NOT absorb: the minted identity collided with another account's
      // row. Diagnosed rather than thrown, because the caller's response is the
      // same as for any other conflict (hold this owner, write nothing) and an
      // unclassified throw would read as a database fault instead.
      return {
        kind: 'conflict',
        detail: 'the minted plot identity is already in use by another row',
      };
    }
    const inserted = (res.rows ?? [])[0];
    if (inserted !== undefined) {
      return { kind: 'inserted', durableRev: readBigintText(inserted.durable_rev, 'durable_rev') };
    }
    const current = await currentDurableRev(db, input);
    if (current === null) {
      // The conflicting row vanished between the insert and the diagnosis: a
      // concurrent account delete, never an ordinary race. Reported rather than
      // retried, because a caller that inserts again would resurrect a home the
      // player just removed.
      return {
        kind: 'conflict',
        detail: 'insert conflicted but no row was present to diagnose',
      };
    }
    return { kind: 'stale', durableRev: current };
  }

  const res = await db.query(FREEHOLD_CAS_UPDATE_SQL, [
    input.accountId,
    input.plotIndex,
    input.expectedDurableRev,
    input.tier,
    input.layoutJson,
    input.trophiesJson,
    input.condition,
    input.visitPolicy,
    String(input.wireRev),
    input.schemaVersion,
  ]);
  const updated = (res.rows ?? [])[0];
  if (updated !== undefined) {
    return { kind: 'updated', durableRev: readBigintText(updated.durable_rev, 'durable_rev') };
  }
  const current = await currentDurableRev(db, input);
  if (current === null) return { kind: 'missing' };
  return { kind: 'stale', durableRev: current };
}

/** The claim fence a plot write carries (server/freehold_claim_db.ts): the
 *  holder and generation the write must still own, and this attempt's token. */
export interface FreeholdWriteFence {
  readonly plotId: string;
  readonly holder: string;
  readonly generation: string;
  readonly writeToken: string;
}

export type FreeholdFencedUpsertResult = FreeholdUpsertResult | { readonly kind: 'fenced' };

/** The fenced compare-and-swap (07a, the touch-set manifest's P2), ONE
 *  statement, so a dirty plot pays exactly what 07's write paid. Three CTEs:
 *  - `fence` LOCKS the claim row under the (holder, generation) fence and writes
 *    nothing;
 *  - `cas` is gated on it through an UNCORRELATED EXISTS, which the planner
 *    evaluates once, before the CAS scans, so the claim row is locked first and
 *    the plot row second (the manifest's G4 before G7), and the fence cannot go
 *    stale because this statement holds the claim row until it commits;
 *  - `stamp` writes this attempt's token ONLY IF the CAS wrote. A fence hit
 *    whose CAS matched nothing (stale) commits no token, so a later verify can
 *    never read a stale attempt's token as proof that its document landed.
 *  The SET list is FREEHOLD_CAS_UPDATE_SQL's, byte for byte, so it still never
 *  touches plot_id, created_at or the upkeep columns. */
export const FREEHOLD_FENCED_CAS_SQL = `WITH fence AS MATERIALIZED (
  SELECT plot_id FROM freehold_plot_claims
   WHERE plot_id = $12 AND holder = $13 AND generation = $14::bigint
     FOR NO KEY UPDATE
), cas AS (
  UPDATE account_freeholds
     SET tier = $4,
         layout = $5::jsonb,
         trophies = $6::jsonb,
         condition = $7,
         visit_policy = $8,
         wire_rev = $9::bigint,
         schema_version = $10,
         durable_rev = durable_rev + 1,
         updated_at = now()
   WHERE account_id = $1 AND plot_index = $2 AND durable_rev = $3::bigint
     AND EXISTS (SELECT 1 FROM fence)
  RETURNING durable_rev::text AS durable_rev
), stamp AS (
  UPDATE freehold_plot_claims
     SET write_token = $11
   WHERE plot_id = $12 AND EXISTS (SELECT 1 FROM cas)
  RETURNING plot_id
)
SELECT (SELECT count(*) FROM fence)::int AS fenced,
       (SELECT durable_rev FROM cas) AS durable_rev,
       (SELECT count(*) FROM stamp)::int AS stamped`;

/**
 * The UPDATE arm of upsertFreehold behind the claim fence. Same refusal before
 * any SQL, same diagnosis after a zero-row CAS; a fence the claim row no longer
 * matches answers `fenced` (the claim was taken over) and writes nothing.
 */
export async function upsertFencedFreehold(
  db: FreeholdQueryable,
  input: FreeholdUpsert,
  fence: FreeholdWriteFence,
): Promise<FreeholdFencedUpsertResult> {
  requireUpsertInput(input);
  if (input.expectedDurableRev === null) {
    throw new FreeholdUpsertRefused('a fenced write updates an existing row');
  }
  if (fence.plotId !== input.plotId) {
    throw new FreeholdUpsertRefused('the write fence names another plot');
  }
  const res = await db.query(FREEHOLD_FENCED_CAS_SQL, [
    input.accountId,
    input.plotIndex,
    input.expectedDurableRev,
    input.tier,
    input.layoutJson,
    input.trophiesJson,
    input.condition,
    input.visitPolicy,
    String(input.wireRev),
    input.schemaVersion,
    fence.writeToken,
    fence.plotId,
    fence.holder,
    fence.generation,
  ]);
  const row = (res.rows ?? [])[0];
  if (row === undefined || Number(row.fenced) !== 1) return { kind: 'fenced' };
  if (row.durable_rev !== null && row.durable_rev !== undefined) {
    return { kind: 'updated', durableRev: readBigintText(row.durable_rev, 'durable_rev') };
  }
  const current = await currentDurableRev(db, input);
  if (current === null) return { kind: 'missing' };
  return { kind: 'stale', durableRev: current };
}

/** The plot's current durable revision, for the ambiguous-retry adopt arm. */
export async function freeholdDurableRevOnClient(
  db: FreeholdQueryable,
  accountId: number,
  plotIndex: number,
): Promise<string | null> {
  const res = await db.query(FREEHOLD_CURRENT_REV_SQL, [accountId, plotIndex]);
  const row = (res.rows ?? [])[0];
  if (row === undefined) return null;
  return readBigintText(row.durable_rev, 'durable_rev');
}

/** The claimed login's plot-id pre-read (server/freehold_claim_login.ts),
 *  WITHOUT a lock: the claim decides who may serve the plot, not this read.
 *  Exported so the claim suite pins its plan on the plot PK. */
export const FREEHOLD_PRIMARY_PLOT_ID_SQL =
  'SELECT plot_id FROM account_freeholds WHERE account_id = $1 AND plot_index = 0';

/** The primary plot's public id, or null when the account has no row at the
 *  primary slot yet (nothing to claim: the first insert claims it). */
export async function freeholdPrimaryPlotIdOnClient(
  db: FreeholdQueryable,
  accountId: number,
): Promise<string | null> {
  const res = await db.query(FREEHOLD_PRIMARY_PLOT_ID_SQL, [accountId]);
  const plotId = (res.rows ?? [])[0]?.plot_id;
  return typeof plotId === 'string' ? plotId : null;
}

/** The insert, with the ONE constraint violation it can raise that is a
 *  diagnosis rather than a fault turned into a null. Every other error
 *  propagates: a fault must not be reported as a conflict. */
async function insertFreeholdRow(
  db: FreeholdQueryable,
  content: unknown[],
): Promise<{ rows?: Record<string, unknown>[] } | null> {
  try {
    return await db.query(FREEHOLD_INSERT_SQL, content);
  } catch (err) {
    const constraint = (err as { constraint?: unknown }).constraint;
    const code = (err as { code?: unknown }).code;
    if (code === '23505' && constraint === 'account_freeholds_plot_id') return null;
    throw err;
  }
}

async function currentDurableRev(
  db: FreeholdQueryable,
  input: FreeholdUpsert,
): Promise<string | null> {
  const res = await db.query(FREEHOLD_CURRENT_REV_SQL, [input.accountId, input.plotIndex]);
  const row = (res.rows ?? [])[0];
  if (row === undefined) return null;
  return readBigintText(row.durable_rev, 'durable_rev');
}

const defaultPlotIdHex = (): string => randomUUID().replaceAll('-', '');

/**
 * Mint a fresh opaque public plot identity.
 *
 * THE GENERATOR OWES THE CHARSET CHECK that asFreeholdPlotId
 * (src/sim/freehold/types.ts) deliberately does not perform. It is not
 * defensive noise: the client echoes the plot id back on every
 * set_freehold_build_presence frame, and server/freehold_wire.ts admits
 * [A-Za-z0-9_:-] only, so an id carrying a dot, a slash or base64 padding would
 * make every later build-presence frame refuse at the wire type boundary with
 * no diagnostic at all, on a plot that persisted perfectly. Fail here, once, at
 * the one place a new id comes from. The DDL's plot_id CHECK is the same rule
 * in the database, and the two are cross-pinned in the tests.
 */
export function mintFreeholdPlotId(randomHex: () => string = defaultPlotIdHex): string {
  const plotId = `${FREEHOLD_PLOT_ID_PREFIX}${randomHex()}`;
  // The length bound is a second seal, not a duplicate: FREEHOLD_PLOT_ID_RE
  // bounds length today, and this survives a future edit that drops the
  // quantifier while the wire keeps its own 64-character ceiling.
  if (!FREEHOLD_PLOT_ID_RE.test(plotId) || plotId.length > FREEHOLD_PLOT_ID_MAX_LEN) {
    throw new Error('minted freehold plot id must match the opaque plot id charset and bound');
  }
  return plotId;
}

/** The row bound on the subject-access read, WIDENED rather than copied from the
 *  account read's LIMIT of 2. The export must render every plot the owner has,
 *  including slots this build does not admit, so a bound calibrated to the
 *  admitted slot would omit exactly the rows recovery exists for. Twenty is far
 *  above every approved per-account plot ladder and still turns a corrupted
 *  account into a bounded read. */
export const FREEHOLD_EXPORT_ROW_LIMIT = 20;

/** The per-row ON-DISK pre-gate for the export, the same measure and the same
 *  reason as FREEHOLD_STORED_DETOAST_GATE_BYTES on the account read: a row too
 *  large to render is reported by its identity and its size rather than
 *  detoasted into the request path. The export runs on one pool client on a
 *  request, so an unbounded render there is the same hazard the account read's
 *  own bound is justified against in this file. */
export const FREEHOLD_EXPORT_DETOAST_GATE_BYTES = FREEHOLD_STORED_DETOAST_GATE_BYTES;

/** The AUTHORITATIVE bound behind that pre-gate, and the reason the pre-gate
 *  alone is not one. pg_column_size reports the COMPRESSED size and the
 *  compression ratio is unbounded, so a row under the gate can still render to
 *  megabytes: at this file's own measured 48x pglz ratio, 131072 compressed
 *  bytes is about 6.3 MB of text on a request path holding one pool client. The
 *  account read pairs its pre-gate with an octet_length measure for exactly this
 *  reason; the export now does too. Wider than the account read's stored ceiling
 *  because the export must hand back rows this build refuses to LOAD, including
 *  the oversize class recovery exists for. A LITERAL rather than an import of
 *  FREEHOLD_MAX_STORED_BYTES: this module deliberately imports nothing from the
 *  sim leaf, and 425984 is four times that constant's 106496.
 *
 *  WHICH BOUND ACTUALLY BINDS, corrected here rather than left as the claim
 *  that four times the stored ceiling covers everything. The two measures are
 *  in different units and the pre-gate is the CHEAP one, so for COMPRESSIBLE
 *  content this rendered bound binds and the widening is real, while for
 *  INCOMPRESSIBLE content the pre-gate binds first at 131072 on-disk bytes and
 *  this constant is never reached. That is deliberate and it is the trade the
 *  pre-gate exists to make: without it an incompressible row is measured by
 *  detoasting it, which is the cost being avoided. THE RESIDUAL, named rather
 *  than implied: an incompressible row above the pre-gate comes back with its
 *  identity, both revisions, every scalar column and its measured on-disk size,
 *  and NOT its content, on the owner's only readback of it. It is carried as a
 *  named limit in docs/freeholds/persistence-rollout-contract.md section 8a. */
export const FREEHOLD_EXPORT_MAX_RENDERED_BYTES = 425_984;

/** The plot export's statement: its column ALLOWLIST (the plot, its durable
 *  shape and the two byte-bounded content columns) is pinned by name in
 *  tests/server/freehold_sql_contract.test.ts beside the other housing
 *  exports. */
export const FREEHOLD_PLOT_EXPORT_SQL = `SELECT plot_index, plot_id, schema_version, durable_rev, wire_rev, tier,
            condition, visit_policy, upkeep_binding,
            -- THE TWO UPKEEP COLUMNS ARE JSONB AND ARE SELECTED RAW, past both
            -- bounds above, which is safe only because of the DDL: 07a is the
            -- release that starts writing them, this build writes NULL, and
            -- the unbound-carries-no-upkeep CHECK holds them NULL for every row
            -- this build can produce. The release that writes them owes them
            -- the same pre-gate and measure the two content columns carry.
            upkeep_checkpoint, upkeep_credit, created_at, updated_at,
            b.disk_bytes,
            b.owned_bytes,
            CASE WHEN b.owned_bytes <= ${FREEHOLD_EXPORT_MAX_RENDERED_BYTES}
                 THEN f.layout ELSE NULL END AS layout,
            CASE WHEN b.owned_bytes <= ${FREEHOLD_EXPORT_MAX_RENDERED_BYTES}
                 THEN f.trophies ELSE NULL END AS trophies
       FROM account_freeholds f
       LEFT JOIN LATERAL (
         SELECT disk_bytes, owned_bytes FROM (
           SELECT d.disk_bytes,
                  CASE
                    WHEN d.disk_bytes > ${FREEHOLD_EXPORT_DETOAST_GATE_BYTES} THEN NULL
                    ELSE COALESCE(octet_length(f.layout::text), 0)
                       + COALESCE(octet_length(f.trophies::text), 0)
                  END AS owned_bytes
             FROM (
               SELECT COALESCE(pg_column_size(f.layout), 0)
                    + COALESCE(pg_column_size(f.trophies), 0) AS disk_bytes
             ) d
         ) m OFFSET 0
       ) b ON true
      WHERE f.account_id = $1
      ORDER BY f.plot_index
      LIMIT ${FREEHOLD_EXPORT_ROW_LIMIT}`;

/** The subject-access read (exportAccountData): every persisted plot row this
 *  account owns, in stable plot_index order, or an empty array when it owns
 *  none. Keep-forever rows, so this is the owner's ONLY readback of them, and
 *  unsupported content rides out AS STORED in its original durable columns:
 *  nothing here normalizes a row.
 *
 *  BOUNDED IN BOTH DIRECTIONS, AND THE BOUNDS ARE VISIBLE IN THE ANSWER. It was
 *  the one read in this file with neither a LIMIT nor a byte gate, while the
 *  account read's `LIMIT 2` is justified in this same file against exactly that
 *  hazard, and it is the read that runs on a REQUEST. Two things it therefore
 *  does NOT promise, stated rather than implied:
 *   * AT OR past FREEHOLD_EXPORT_ROW_LIMIT rows the answer may be TRUNCATED,
 *     and it says so: a read that comes back holding the limit appends one
 *     `{ truncated: true }` marker row rather than trailing off, because an
 *     export that quietly stops is worse than one that stops and says it did.
 *     AT the limit exactly the marker is an OVER-REPORT, and deliberately: a
 *     read of exactly twenty rows is indistinguishable from a read that stopped
 *     at twenty, and saying "there may be more" about an account that has
 *     exactly twenty is the safe direction on an account's only readback. The
 *     limit is twenty against an approved ladder of at most two plots, so no
 *     shipped account can reach it.
 *   * a row whose content is too large to render comes back with `layout` and
 *     `trophies` NULL and its two measured sizes in their place. The row itself,
 *     its identity, both revisions and every scalar column are present, so the
 *     owner can see the plot exists and how large its content is; the content is
 *     not rendered into the request path. TWO measures, not one, because the
 *     cheap pre-gate reads the COMPRESSED size and the compression ratio is
 *     unbounded: `owned_bytes` is the authoritative rendered length and it is
 *     itself NULL when the pre-gate refused to render at all. */
export async function freeholdsForExport(
  db: FreeholdQueryable,
  accountId: number,
): Promise<Record<string, unknown>[]> {
  // THE SAME STRUCTURAL REFUSAL every other entry point in this module runs.
  // It was the one that skipped it, and it is the one that runs on a REQUEST:
  // a non-integer sent anyway raises 22P02 and aborts whatever transaction the
  // export composition is holding.
  requireAccountId(accountId);
  const res = await db.query(FREEHOLD_PLOT_EXPORT_SQL, [accountId]);
  const rows = res.rows ?? [];
  // SAY SO WHEN IT STOPS. Reaching the limit exactly is indistinguishable from
  // having exactly that many rows, and the account that reaches it is the
  // corrupt one this export exists to serve.
  if (rows.length === FREEHOLD_EXPORT_ROW_LIMIT) {
    rows.push({ truncated: true, limit: FREEHOLD_EXPORT_ROW_LIMIT });
  }
  return rows;
}
