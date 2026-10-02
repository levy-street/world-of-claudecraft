// THE GLOBAL PLOT CLAIM: one authoritative realm process per plot, proved by a
// database lease plus a monotonically increasing fencing GENERATION per opaque
// plot id (07a deliverable 1; docs/freeholds/mutation-touch-set-manifest.md P2
// to P6). Every realm on one database shares these rows, so a second realm of
// one account is answered `busy` instead of being silently write-blocked (the
// rollout contract's R2), and a holder that crashed stops renewing, expires,
// and is fenced by the next claimant's newer generation: its late writes match
// no row.
//
// THE LEASE POLICY IS THE CHARACTER LEASE'S, reused rather than guessed: the
// same LEASE_TTL_SECONDS, the same per-boot PROCESS_LEASE_HOLDER, the same
// expiry-or-same-holder steal arms, and the renewer rides the autosave cadence
// beside heartbeatCharacterLeases. There is NO same-account arm: an account
// alive on another realm keeps its home there until that realm lets go.
//
// THE FENCE IS (holder, generation), compared IN THE STATEMENT that locks the
// row, never check-then-write. Expiry decides only when another realm may TAKE
// the claim; a holder whose lease lapsed with nobody taking it may still write,
// because nobody else can have. A release keeps the row, so a generation never
// restarts.
//
// Time is clock_timestamp(), never now(): now() is the transaction START, so a
// login that began before a concurrent release committed would read the
// released row as live and refuse.
//
// KEEP FOREVER, deliberately exempt from the retention sweep: one row per plot
// id ever claimed, cascading with its account, so it is bounded by the plots.
import { randomBytes } from 'node:crypto';
import { FREEHOLD_PLOT_ID_RE, type FreeholdQueryable } from './freehold_db';

/** The per-attempt write token: 16 random bytes as hex, one per write. The
 *  Hearth advance token shares this shape (server/freehold_hearth_db.ts). */
export const FREEHOLD_WRITE_TOKEN_RE = /^[0-9a-f]{32}$/;

/** A fencing generation (or a durable revision) as exact positive bigint text,
 *  the shape every housing module checks before it reaches SQL. */
export const FREEHOLD_GENERATION_TEXT_RE = /^[1-9][0-9]{0,18}$/;

export function mintFreeholdWriteToken(): string {
  return randomBytes(16).toString('hex');
}

/**
 * The claim DDL, applied by ensureSchema immediately after the Hearth fragment.
 * Tables and indexes only, so (like FREEHOLD_SCHEMA) it needs no search_path
 * ceremony; `schemaName` qualifies the created objects for the private-schema
 * suite, and `accounts` resolves through the applying connection's own path.
 */
export function freeholdClaimSchema(schemaName = 'public'): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(schemaName)) {
    throw new Error('freehold claim schema must be a simple lowercase identifier');
  }
  const schema = `"${schemaName}"`;
  return `
-- KEEP FOREVER, and deliberately exempt from the retention sweep
-- (server/retention_sweep.ts): one row per plot id ever claimed, removed only by
-- its account's cascade. A release keeps the row, because the fencing generation
-- must never restart: a fresh row at generation 1 would re-admit a late write
-- from an earlier generation-1 era. account_id is nullable ON PURPOSE (a
-- guild-owned plot arrives later with its own owner column and a num_nonnulls
-- CHECK added NOT VALID); every writer in this release sets it.
CREATE TABLE IF NOT EXISTS "__woc_freehold_claim_schema__".freehold_plot_claims (
  plot_id TEXT PRIMARY KEY,
  account_id INT REFERENCES accounts(id) ON DELETE CASCADE,
  realm TEXT NOT NULL,
  holder TEXT NOT NULL,
  generation BIGINT NOT NULL,
  write_token TEXT,
  acquired_at TIMESTAMPTZ NOT NULL,
  heartbeat_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT freehold_plot_claims_plot_id_charset CHECK (plot_id ~ '^[A-Za-z0-9_:-]{1,64}$'),
  CONSTRAINT freehold_plot_claims_generation_positive CHECK (generation >= 1),
  CONSTRAINT freehold_plot_claims_realm_shape CHECK (realm <> '' AND length(realm) <= 64),
  -- The holder is REALM#uuid (server/character_lease_db.ts): at most 64 + 1 + 36.
  CONSTRAINT freehold_plot_claims_holder_shape CHECK (holder <> '' AND length(holder) <= 128),
  CONSTRAINT freehold_plot_claims_token_shape
    CHECK (write_token IS NULL OR write_token ~ '^[0-9a-f]{32}$')
) WITH (fillfactor = 80);
-- fillfactor 80: the renewer and every plot write rewrite each live row on the
-- autosave cadence, on columns no index covers (heartbeat_at, expires_at,
-- write_token), so page room keeps those versions on the same page (HOT). A
-- release and a takeover DO rewrite holder, which freehold_plot_claims_holder
-- indexes, so those two are never HOT; they happen once per claim era, not per
-- cadence.
-- PROBED FIRST (07a): a no-op CREATE INDEX IF NOT EXISTS still takes the
-- table's SHARE lock and holds it to the boot COMMIT, which would block every
-- other realm's claim writes through this realm's whole boot.
DO $freehold_plot_claims_indexes$
BEGIN
  -- The renewer, the release and the shutdown release select by holder.
  IF to_regclass('"__woc_freehold_claim_schema__".freehold_plot_claims_holder') IS NULL THEN
CREATE INDEX IF NOT EXISTS freehold_plot_claims_holder
  ON "__woc_freehold_claim_schema__".freehold_plot_claims (holder);
  END IF;
  -- The account cascade and the export.
  IF to_regclass('"__woc_freehold_claim_schema__".freehold_plot_claims_account') IS NULL THEN
CREATE INDEX IF NOT EXISTS freehold_plot_claims_account
  ON "__woc_freehold_claim_schema__".freehold_plot_claims (account_id);
  END IF;
END;
$freehold_plot_claims_indexes$;
`.replaceAll('"__woc_freehold_claim_schema__"', schema);
}

export const FREEHOLD_CLAIM_SCHEMA = freeholdClaimSchema();

export interface FreeholdClaimFence {
  readonly plotId: string;
  readonly holder: string;
  /** Exact bigint text, as RETURNING hands it back. */
  readonly generation: string;
}

export type FreeholdClaimAcquire =
  | {
      readonly kind: 'acquired';
      readonly generation: string;
      /** The fence advanced over an existing row: another holder's expired
       *  claim, or a RELEASED claim, this holder's own included (a re-acquire
       *  after its own release counts too; PostgreSQL 16's upsert cannot return
       *  the prior holder, and a release is final, so the generation must move). */
      readonly takeover: boolean;
    }
  | { readonly kind: 'busy' };

/** A live claim held by ANOTHER holder, read WITHOUT a lock, so a refused alt
 *  never holds the holder's row (ON CONFLICT DO UPDATE locks the conflicting
 *  row even when its WHERE is false). */
export const FREEHOLD_CLAIM_BUSY_SQL = `SELECT 1 FROM freehold_plot_claims
 WHERE plot_id = $1 AND holder <> $2 AND expires_at > clock_timestamp()`;

/** The acquire (manifest P4). ONE clock reading for the three stamps, through
 *  the CTE, so a fresh row's acquired_at equals its heartbeat_at exactly and a
 *  takeover is recognizable in RETURNING (a same-holder re-acquire keeps its
 *  older acquired_at). */
export const FREEHOLD_CLAIM_ACQUIRE_SQL = `WITH t AS (SELECT clock_timestamp() AS at)
INSERT INTO freehold_plot_claims AS c
       (plot_id, account_id, realm, holder, generation, acquired_at, heartbeat_at, expires_at)
SELECT $1, $2, $3, $4, 1, t.at, t.at, t.at + make_interval(secs => $5) FROM t
ON CONFLICT (plot_id) DO UPDATE
   SET realm = EXCLUDED.realm,
       holder = EXCLUDED.holder,
       generation = CASE WHEN c.holder = EXCLUDED.holder THEN c.generation
                         ELSE c.generation + 1 END,
       acquired_at = CASE WHEN c.holder = EXCLUDED.holder THEN c.acquired_at
                          ELSE EXCLUDED.acquired_at END,
       heartbeat_at = EXCLUDED.heartbeat_at,
       expires_at = EXCLUDED.expires_at
 WHERE c.expires_at <= clock_timestamp() OR c.holder = EXCLUDED.holder
RETURNING generation::text AS generation,
          (xmax = 0) AS inserted,
          (acquired_at = heartbeat_at) AS fresh`;

function requireText(name: string, value: string, max: number): string {
  if (typeof value !== 'string' || value === '' || value.length > max) {
    throw new RangeError(`freehold claim ${name} must be a non-empty string of at most ${max}`);
  }
  return value;
}

function requirePlotId(plotId: string): string {
  if (typeof plotId !== 'string' || !FREEHOLD_PLOT_ID_RE.test(plotId)) {
    throw new RangeError('freehold claim plot id must match the plot id charset');
  }
  return plotId;
}

function requireTtl(ttlSeconds: number): number {
  if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds <= 0) {
    throw new RangeError('freehold claim ttl must be a positive integer of seconds');
  }
  return ttlSeconds;
}

function requireGeneration(generation: string): string {
  if (typeof generation !== 'string' || !FREEHOLD_GENERATION_TEXT_RE.test(generation)) {
    throw new RangeError('freehold claim generation must be positive bigint text');
  }
  return generation;
}

function requireToken(token: string): string {
  if (typeof token !== 'string' || !FREEHOLD_WRITE_TOKEN_RE.test(token)) {
    throw new RangeError('freehold write token must be 32 lowercase hex characters');
  }
  return token;
}

/**
 * Take, keep or refuse the claim on one plot, inside the caller's transaction
 * (the login read). A live foreign claim answers `busy` from the lock-free
 * pre-check; otherwise the upsert takes an expired claim (advancing the
 * generation), re-stamps this holder's own (keeping its generation), or inserts
 * generation 1. The answer is trusted only if the caller's COMMIT proves it
 * (runFreeholdTransaction's tag check).
 */
export async function acquireFreeholdClaim(
  db: FreeholdQueryable,
  input: {
    readonly plotId: string;
    readonly accountId: number;
    readonly realm: string;
    readonly holder: string;
    readonly ttlSeconds: number;
  },
): Promise<FreeholdClaimAcquire> {
  const plotId = requirePlotId(input.plotId);
  if (!Number.isSafeInteger(input.accountId) || input.accountId <= 0) {
    throw new RangeError('freehold claim account id must be a positive safe integer');
  }
  const realm = requireText('realm', input.realm, 64);
  const holder = requireText('holder', input.holder, FREEHOLD_LIVE_HOLDER_MAX);
  const ttl = requireTtl(input.ttlSeconds);
  const live = await db.query(FREEHOLD_CLAIM_BUSY_SQL, [plotId, holder]);
  if ((live.rowCount ?? live.rows?.length ?? 0) > 0) return { kind: 'busy' };
  const res = await db.query(FREEHOLD_CLAIM_ACQUIRE_SQL, [
    plotId,
    input.accountId,
    realm,
    holder,
    ttl,
  ]);
  const row = res.rows?.[0] as { generation?: unknown; inserted?: unknown; fresh?: unknown };
  if (!row) return { kind: 'busy' };
  if (typeof row.generation !== 'string') {
    throw new TypeError('freehold_plot_claims.generation must come back as exact bigint text');
  }
  return {
    kind: 'acquired',
    generation: requireGeneration(row.generation),
    takeover: row.inserted !== true && row.fresh === true,
  };
}

/** G4 for a write (manifest P1 and P2): the fence re-proved and the row locked
 *  in ONE statement whose WHERE is on the row itself, so a lock wait re-checks
 *  the latest version and a takeover that committed during the wait is seen.
 *  It stamps this attempt's token, which is what a later verify reads. */
export const FREEHOLD_CLAIM_FENCE_SQL = `UPDATE freehold_plot_claims
   SET write_token = $4
 WHERE plot_id = $1 AND holder = $2 AND generation = $3::bigint
RETURNING plot_id`;

export async function fenceFreeholdClaimOnClient(
  tx: FreeholdQueryable,
  fence: FreeholdClaimFence,
  writeToken: string,
): Promise<boolean> {
  const res = await tx.query(FREEHOLD_CLAIM_FENCE_SQL, [
    requirePlotId(fence.plotId),
    requireText('holder', fence.holder, FREEHOLD_LIVE_HOLDER_MAX),
    requireGeneration(fence.generation),
    requireToken(writeToken),
  ]);
  return (res.rowCount ?? res.rows?.length ?? 0) === 1;
}

/** The ambiguous-retry arm (manifest P2): lock this holder's row and read the
 *  token the LAST write left. The lock waits for a transaction still holding
 *  the row, so the token read is never the pre-commit version. Null: fenced. */
export const FREEHOLD_CLAIM_TOKEN_LOCK_SQL = `SELECT write_token FROM freehold_plot_claims
 WHERE plot_id = $1 AND holder = $2 AND generation = $3::bigint
   FOR NO KEY UPDATE`;

export async function lockFreeholdClaimTokenOnClient(
  tx: FreeholdQueryable,
  fence: FreeholdClaimFence,
): Promise<{ readonly writeToken: string | null } | null> {
  const res = await tx.query(FREEHOLD_CLAIM_TOKEN_LOCK_SQL, [
    requirePlotId(fence.plotId),
    requireText('holder', fence.holder, FREEHOLD_LIVE_HOLDER_MAX),
    requireGeneration(fence.generation),
  ]);
  const row = res.rows?.[0] as { write_token?: unknown } | undefined;
  if (!row) return null;
  return { writeToken: typeof row.write_token === 'string' ? row.write_token : null };
}

/** The first insert of an absent plot (manifest P3): generation 1 under a
 *  freshly minted id, inside the transaction that inserts the plot row, so a
 *  lost plot-insert race rolls BOTH back. A conflict means the minted id is
 *  already claimed, which only a retry of this realm's own ambiguous insert or
 *  a collision can produce; the caller decides which from the token. */
export const FREEHOLD_CLAIM_INSERT_SQL = `WITH t AS (SELECT clock_timestamp() AS at)
INSERT INTO freehold_plot_claims
       (plot_id, account_id, realm, holder, generation, write_token,
        acquired_at, heartbeat_at, expires_at)
SELECT $1, $2, $3, $4, 1, $5, t.at, t.at, t.at + make_interval(secs => $6) FROM t
ON CONFLICT (plot_id) DO NOTHING
RETURNING plot_id`;

export async function insertFreeholdClaimOnClient(
  tx: FreeholdQueryable,
  input: {
    readonly plotId: string;
    readonly accountId: number;
    readonly realm: string;
    readonly holder: string;
    readonly writeToken: string;
    readonly ttlSeconds: number;
  },
): Promise<boolean> {
  if (!Number.isSafeInteger(input.accountId) || input.accountId <= 0) {
    throw new RangeError('freehold claim account id must be a positive safe integer');
  }
  const res = await tx.query(FREEHOLD_CLAIM_INSERT_SQL, [
    requirePlotId(input.plotId),
    input.accountId,
    requireText('realm', input.realm, 64),
    requireText('holder', input.holder, FREEHOLD_LIVE_HOLDER_MAX),
    requireToken(input.writeToken),
    requireTtl(input.ttlSeconds),
  ]);
  return (res.rowCount ?? res.rows?.length ?? 0) === 1;
}

/** The renewer's two statements (manifest P5), each locking its rows in
 *  ascending plot id through the subselect so two multi-row statements can
 *  never cycle. RETURNING names exactly the claims still held. */
export const FREEHOLD_CLAIM_RENEW_SQL = `UPDATE freehold_plot_claims
   SET heartbeat_at = clock_timestamp(),
       expires_at = clock_timestamp() + make_interval(secs => $2)
 WHERE plot_id IN (
   SELECT plot_id FROM freehold_plot_claims
    WHERE holder = $1 AND plot_id = ANY($3::text[])
    ORDER BY plot_id
      FOR NO KEY UPDATE SKIP LOCKED)
RETURNING plot_id`;

/** The renewer's lock-free follow-up for the ids a RENEW chunk did NOT return: a
 *  row SKIP LOCKED passed over (a trip or a write holding it) is still this
 *  holder's and only missed one heartbeat; a row another holder now owns was
 *  taken. No expiry predicate on purpose: an expired row of this holder's is
 *  still renewable (expiry governs only a takeover). The release chunks read
 *  through FREEHOLD_CLAIM_RELEASE_READ_SQL instead. */
export const FREEHOLD_CLAIM_STILL_HELD_SQL = `SELECT plot_id FROM freehold_plot_claims
 WHERE holder = $1 AND plot_id = ANY($2::text[])`;

export async function freeholdClaimsStillHeldOnClient(
  tx: FreeholdQueryable,
  holder: string,
  plotIds: readonly string[],
): Promise<Set<string>> {
  if (plotIds.length === 0) return new Set();
  const res = await tx.query(FREEHOLD_CLAIM_STILL_HELD_SQL, [
    requireText('holder', holder, FREEHOLD_LIVE_HOLDER_MAX),
    plotIds.map(requirePlotId),
  ]);
  return returnedPlotIds(res);
}

/** The holder a RELEASED claim carries: the releasing holder plus this suffix.
 *  Renaming, not only expiring, is what makes a release final: the renewer and
 *  the write fence both match the LIVE holder exactly, so a renewal already in
 *  flight when the release commits cannot revive the claim, and a late write of
 *  the releasing process is fenced; another holder (or this one again) takes it
 *  as a takeover, advancing the generation. At most 128 characters (101 + 9). */
export const FREEHOLD_CLAIM_RELEASED_SUFFIX = '#released';

/** A LIVE holder leaves room for the release suffix inside the column's
 *  128-character shape, so a release can never fail its own CHECK. Read only
 *  inside the functions below, at call time. */
const FREEHOLD_LIVE_HOLDER_MAX = 128 - FREEHOLD_CLAIM_RELEASED_SUFFIX.length;

/** Release keeps the row (the generation must survive) and touches only rows
 *  still live, so a long-lived process does not rewrite every claim it ever
 *  held in a keep-forever table. SKIP LOCKED: a row a write abandoned at the
 *  drain deadline still holds is left to expire on its own rather than failing
 *  the whole release. */
export const FREEHOLD_CLAIM_RELEASE_SQL = `UPDATE freehold_plot_claims
   SET expires_at = clock_timestamp(),
       holder = holder || '${FREEHOLD_CLAIM_RELEASED_SUFFIX}'
 WHERE plot_id IN (
   SELECT plot_id FROM freehold_plot_claims
    WHERE holder = $1 AND plot_id = ANY($2::text[]) AND expires_at > clock_timestamp()
    ORDER BY plot_id
      FOR NO KEY UPDATE SKIP LOCKED)
RETURNING plot_id`;

/** The shutdown release. The OUTER `holder = $1` is load-bearing, not a
 *  repeat: this statement's lock set is every live claim of the holder (no
 *  chunk bound), and on a grown table (201,000 rows, 5,000 of them the
 *  holder's) the planner served a bare `plot_id IN (...)` with a hash semi join
 *  over a SEQUENTIAL SCAN of the whole keep-forever table. The holder qual
 *  gives the outer read the holder index, so its cost follows this process's
 *  own claims, never the table's age (docs/freeholds/qa/mutation-2026-09-30/
 *  workload-evidence.md). */
export const FREEHOLD_CLAIM_RELEASE_ALL_SQL = `UPDATE freehold_plot_claims
   SET expires_at = clock_timestamp(),
       holder = holder || '${FREEHOLD_CLAIM_RELEASED_SUFFIX}'
 WHERE holder = $1 AND plot_id IN (
   SELECT plot_id FROM freehold_plot_claims
    WHERE holder = $1 AND expires_at > clock_timestamp()
    ORDER BY plot_id
      FOR NO KEY UPDATE SKIP LOCKED)
RETURNING plot_id`;

function returnedPlotIds(res: { rows?: unknown[] }): Set<string> {
  const ids = new Set<string>();
  for (const row of res.rows ?? []) {
    const plotId = (row as { plot_id?: unknown }).plot_id;
    if (typeof plotId === 'string') ids.add(plotId);
  }
  return ids;
}

/** Inside the renewer's one transaction: the renewed set, then the released
 *  set. An empty list issues no statement. */
export async function renewFreeholdClaimRows(
  tx: FreeholdQueryable,
  holder: string,
  plotIds: readonly string[],
  ttlSeconds: number,
): Promise<Set<string>> {
  if (plotIds.length === 0) return new Set();
  const res = await tx.query(FREEHOLD_CLAIM_RENEW_SQL, [
    requireText('holder', holder, FREEHOLD_LIVE_HOLDER_MAX),
    requireTtl(ttlSeconds),
    plotIds.map(requirePlotId),
  ]);
  return returnedPlotIds(res);
}

export async function releaseFreeholdClaimRows(
  tx: FreeholdQueryable,
  holder: string,
  plotIds: readonly string[],
): Promise<Set<string>> {
  if (plotIds.length === 0) return new Set();
  const res = await tx.query(FREEHOLD_CLAIM_RELEASE_SQL, [
    requireText('holder', holder, FREEHOLD_LIVE_HOLDER_MAX),
    plotIds.map(requirePlotId),
  ]);
  return returnedPlotIds(res);
}

export async function releaseAllFreeholdClaimRows(
  tx: FreeholdQueryable,
  holder: string,
): Promise<number> {
  const res = await tx.query(FREEHOLD_CLAIM_RELEASE_ALL_SQL, [
    requireText('holder', holder, FREEHOLD_LIVE_HOLDER_MAX),
  ]);
  return returnedPlotIds(res).size;
}

/** The renewer's read of release chunk ids it holds no proved answer for
 *  (manifest P6): each asked row still under this holder, live or released,
 *  with its holder and whether it is live. A row another holder already holds
 *  is filtered out before any lock, so it is never returned or waited for.
 *  Lock-free: the form for the ids a COMPLETED release did not return, where
 *  nothing of this holder's is in flight. */
export const FREEHOLD_CLAIM_RELEASE_READ_SQL = `SELECT plot_id, holder, expires_at > clock_timestamp() AS live
  FROM freehold_plot_claims
 WHERE plot_id = ANY($2::text[])
   AND holder IN ($1::text, $1::text || '${FREEHOLD_CLAIM_RELEASED_SUFFIX}')
 ORDER BY plot_id`;

/** The same read after a THROWN release, which may still be committing (a
 *  stalled WAL flush): FOR SHARE waits out a row the release still holds, so
 *  the answer is that release's outcome, never the version before it. FOR
 *  SHARE, not FOR KEY SHARE: the release UPDATE holds FOR NO KEY UPDATE, which
 *  conflicts with FOR SHARE and NOT with FOR KEY SHARE (the P9 verify's ruling).
 *  Locked in plot id order, the global order. The caller's lock_timeout bounds
 *  EACH lock wait, not the read: a 256-row read may wait up to 1 s per
 *  contended row (55P03 when one runs it out), capped by its 2 s statement
 *  timeout and then the 5 s wall (FREEHOLD_CLAIM_RENEW_BOUNDS). Its own COMMIT
 *  needs a WAL flush too (the row locks it takes write lock records), so in
 *  the stalled-WAL case it exists for it most likely ends ambiguous, and the
 *  renewer then keeps the chunk, which is safe: an unrenewed claim expires on
 *  its own. */
export const FREEHOLD_CLAIM_RELEASE_WAIT_SQL = `${FREEHOLD_CLAIM_RELEASE_READ_SQL}
   FOR SHARE`;

/** What a release read says about one id: still this holder's live claim
 *  (`held`), this holder's release landed (`released`), or anything else, which
 *  is no longer this holder's live claim (`gone`: another holder's, an expired
 *  row of this holder's, or no row). */
export type FreeholdClaimReleaseReading = 'held' | 'released' | 'gone';

/** Every asked id answered; `wait` picks the FOR SHARE form. An empty list
 *  issues no statement. */
export async function readFreeholdClaimReleasesOnClient(
  tx: FreeholdQueryable,
  holder: string,
  plotIds: readonly string[],
  opts: { readonly wait: boolean },
): Promise<Map<string, FreeholdClaimReleaseReading>> {
  const readings = new Map<string, FreeholdClaimReleaseReading>();
  if (plotIds.length === 0) return readings;
  const live = requireText('holder', holder, FREEHOLD_LIVE_HOLDER_MAX);
  const ids = plotIds.map(requirePlotId);
  for (const plotId of ids) readings.set(plotId, 'gone');
  const sql = opts.wait ? FREEHOLD_CLAIM_RELEASE_WAIT_SQL : FREEHOLD_CLAIM_RELEASE_READ_SQL;
  const res = await tx.query(sql, [live, ids]);
  for (const row of res.rows ?? []) {
    const read = row as { plot_id?: unknown; holder?: unknown; live?: unknown };
    if (typeof read.plot_id !== 'string' || !readings.has(read.plot_id)) continue;
    if (read.holder === live && read.live === true) readings.set(read.plot_id, 'held');
    else if (read.holder === `${live}${FREEHOLD_CLAIM_RELEASED_SUFFIX}`) {
      readings.set(read.plot_id, 'released');
    }
  }
  return readings;
}

/** The verify's claim read (manifest P9), issued only AFTER the verify's lock
 *  on the character row has waited out the hung transaction, as its own
 *  statement, so it sees that transaction's committed outcome. */
export const FREEHOLD_CLAIM_VERIFY_SQL = `SELECT holder, generation::text AS generation, write_token
  FROM freehold_plot_claims WHERE plot_id = $1`;

export async function readFreeholdClaimOnClient(
  tx: FreeholdQueryable,
  plotId: string,
): Promise<{ holder: string; generation: string; writeToken: string | null } | null> {
  const res = await tx.query(FREEHOLD_CLAIM_VERIFY_SQL, [requirePlotId(plotId)]);
  const row = res.rows?.[0] as
    | { holder?: unknown; generation?: unknown; write_token?: unknown }
    | undefined;
  if (!row || typeof row.holder !== 'string' || typeof row.generation !== 'string') return null;
  return {
    holder: row.holder,
    generation: row.generation,
    writeToken: typeof row.write_token === 'string' ? row.write_token : null,
  };
}

/** The account export's claim rows: an ALLOWLIST. The holder (a per-boot
 *  process id), the generation and the token are server internals and never
 *  leave the server. Bounded by the account's plots. */
export const FREEHOLD_CLAIM_EXPORT_SQL = `SELECT plot_id, realm, acquired_at, heartbeat_at, expires_at
  FROM freehold_plot_claims WHERE account_id = $1 ORDER BY plot_id`;

export async function freeholdClaimsForExport(
  db: FreeholdQueryable,
  accountId: number,
): Promise<unknown[]> {
  if (!Number.isSafeInteger(accountId) || accountId <= 0) {
    throw new RangeError('freehold claim export account id must be a positive safe integer');
  }
  const res = await db.query(FREEHOLD_CLAIM_EXPORT_SQL, [accountId]);
  return res.rows ?? [];
}

/** G4 for a claim proved without a write (the housing hook's read fence,
 *  server/freehold_mutation.ts): lock it under the fence, no row version
 *  written (a no-op UPDATE would write one per trip). */
export const FREEHOLD_CLAIM_READ_FENCE_SQL = `SELECT plot_id FROM freehold_plot_claims
 WHERE plot_id = $1 AND holder = $2 AND generation = $3::bigint
   FOR NO KEY UPDATE`;

export async function lockFreeholdClaimFenceOnClient(
  tx: FreeholdQueryable,
  fence: FreeholdClaimFence,
): Promise<boolean> {
  const res = await tx.query(FREEHOLD_CLAIM_READ_FENCE_SQL, [
    requirePlotId(fence.plotId),
    requireText('holder', fence.holder, FREEHOLD_LIVE_HOLDER_MAX),
    requireGeneration(fence.generation),
  ]);
  return (res.rowCount ?? res.rows?.length ?? 0) === 1;
}
