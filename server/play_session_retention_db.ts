// Fold-forward retention for play_sessions: old ENDED sessions fold into two
// compact rollup tables (lifetime per-character playtime totals and the
// account-to-IP association ledger), then delete. The nightly retention sweep
// calls the prune primitives below with a batch size; each call is ONE bounded
// batch returning the finite deleted row count, and the sweep owns iteration
// and budget, so nothing here loops. Every batch runs as a short autocommit
// statement on the DEFAULT statement timeout; batching is what makes the
// default allowance safe here, do not re-wrap these in the heavy allowance.

// Minimal structural seam over pg's Pool/PoolClient query surface, defined
// locally so this module works against either without importing pg types.
interface Queryable {
  query(text: string, values?: unknown[]): Promise<{ rowCount: number | null }>;
}

// play_session_totals.character_id is DELIBERATELY a plain unconstrained int,
// never its own FK: play_sessions.character_id is ON DELETE SET NULL, so a
// doomed row can arrive with character_id NULL, and the PRIMARY KEY cannot
// hold NULL, so the fold COALESCEs it to 0 (the deleted-character bucket) and
// the column must keep accepting ids of characters that no longer exist.
// account_ip_associations_ip serves the whole-view and moderation ban-evasion
// evaluation, which scans by ip_address (the per-account eligibility probe
// rides the PK instead; the PK leads on account_id, so an ip-leading scan
// needs its own index);
// account_ip_associations_last_seen serves the aging prune's batch predicate
// (every sweep batch predicate must be index-served). last_seen_at is the
// privacy bound on how long an account-to-IP link persists.
export const PLAY_SESSION_RETENTION_SCHEMA = `
CREATE TABLE IF NOT EXISTS play_session_totals (
  account_id INT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  character_id INT NOT NULL,
  playtime_seconds BIGINT NOT NULL,
  sessions INT NOT NULL,
  last_played TIMESTAMPTZ,
  PRIMARY KEY (account_id, character_id)
);
CREATE TABLE IF NOT EXISTS account_ip_associations (
  account_id INT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  ip_address TEXT NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (account_id, ip_address)
);
CREATE INDEX IF NOT EXISTS account_ip_associations_ip ON account_ip_associations(ip_address, account_id);
CREATE INDEX IF NOT EXISTS account_ip_associations_last_seen ON account_ip_associations(last_seen_at);
`;

// The admin activity windows read a 30-day play_sessions window
// (ACTIVITY_WINDOW_DAYS in server/admin.ts), so the retention floor sits
// strictly above it, with headroom for sessions that span days, so a fold can
// never delete a row an admin activity window still counts.
export const PLAY_SESSION_RETENTION_FLOOR_DAYS = 45;

// 0 (or any non-finite or non-positive value) means keep forever and is never
// clamped. Every positive value clamps up to the floor; a fractional value
// below 1 would otherwise floor to '0 days' and delete everything, and the
// floor swallows that too.
export function clampPlaySessionRetentionDays(retentionDays: number): number {
  if (!Number.isFinite(retentionDays) || retentionDays <= 0) return 0;
  return Math.max(PLAY_SESSION_RETENTION_FLOOR_DAYS, Math.floor(retentionDays));
}

// One bounded fold-and-delete batch against play_sessions. The data-modifying
// CTEs make the whole fold-and-delete batch atomic without an explicit
// transaction, and one statement on the default allowance guarantees forward
// progress. ORDER BY started_at LIMIT batch rides play_sessions_started, so
// each batch takes the oldest ended sessions first. The fold is deliberately
// realm-global: play_sessions has no realm column (realm scoping lives on
// characters), unlike the per-realm online-samples prune. Value conservation
// assumes single-flight execution: the doomed CTE takes no row lock, so two
// processes folding the same rows would both add to the rollups while only one
// deletes. The nightly sweep's pg_try_advisory_lock guarantees exactly one
// folder and its batches are serial, so only call this from that sweep.
//
// The `NOT EXISTS` guard on first_session_id is load-bearing:
// player_account_facts.first_session_id is ON DELETE SET NULL, so deleting a
// row that is some account's first session would NULL that column, and a
// later login would re-anchor it and clobber first_session_max_level back to
// 1, corrupting durable analytics facts. The anti-join is index-served by
// player_account_facts_first_session_realm, and the facts row already
// denormalizes first_session_ended_at/first_session_seconds, so keeping one
// referent row per account costs almost nothing in storage. The scan cost is
// not free, though: the keeper prefix (one never-deletable row per account,
// clustered at the oldest end of started_at) is re-walked by this anti-join on
// every batch and grows with lifetime account count, so at large account
// counts each nightly scan lengthens. At current scale the off-peak cost is
// single-digit ms; revisit with scanned-vs-deleted sweep observability, or a
// denormalized first-session flag plus a partial index that skips keepers, if
// account count climbs toward six figures. NOT EXISTS (not NOT IN) is
// deliberate: the planner keeps it a nested-loop anti-join at any work_mem,
// where a NOT IN hash silently flips to a per-row subplan once the facts
// table outgrows the hash budget and then times out, stalling retention.
// The guard is snapshot-scoped: a dormant account's first login can commit a
// facts row referencing a doomed session after this statement's snapshot, in
// which case the delete nulls that anchor and the next login re-anchors to
// the earliest surviving session, the same end state as a login that arrived
// after the fold, so the race is bounded and analytics-only.
//
// Doomed rows with a NULL ip_address still fold into play_session_totals and
// still delete; they just write no association row (ip_address is NOT NULL
// and part of that PK). last_played folds MAX(started_at) because the
// character-select reader's live term defines last_played as MAX(started_at);
// last_seen_at folds MAX(ended_at) because a doomed row always has ended_at
// and it is the latest moment the account was seen on that IP. The ::bigint
// cast rounds fractional seconds at fold time, so a lifetime sum recomputed
// after a fold can differ from the pre-fold value by under a second per folded
// group per batch (a group folded across K batches rounds up to K times); the
// lifetime readers add the stored bigint to their live
// sums, and those readers must gain their rollup terms in the same boot as
// the first delete.
export async function prunePlaySessionsBatch(
  db: Queryable,
  retentionDays: number,
  batchSize: number,
): Promise<number> {
  const days = clampPlaySessionRetentionDays(retentionDays);
  if (days === 0) return 0;
  const res = await db.query(
    `WITH doomed AS (
       SELECT id, account_id, character_id, started_at, ended_at, ip_address
         FROM play_sessions
        WHERE started_at < now() - ($1 || ' days')::interval
          AND ended_at IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM player_account_facts f WHERE f.first_session_id = play_sessions.id)
        ORDER BY started_at
        LIMIT $2
     ), folded_totals AS (
       INSERT INTO play_session_totals (account_id, character_id, playtime_seconds, sessions, last_played)
       SELECT account_id,
              COALESCE(character_id, 0),
              COALESCE(SUM(EXTRACT(EPOCH FROM (ended_at - started_at))), 0)::bigint,
              COUNT(*)::int,
              MAX(started_at)
         FROM doomed
        GROUP BY account_id, COALESCE(character_id, 0)
       ON CONFLICT (account_id, character_id) DO UPDATE
          SET playtime_seconds = play_session_totals.playtime_seconds + EXCLUDED.playtime_seconds,
              sessions = play_session_totals.sessions + EXCLUDED.sessions,
              last_played = GREATEST(play_session_totals.last_played, EXCLUDED.last_played)
     ), folded_associations AS (
       INSERT INTO account_ip_associations (account_id, ip_address, last_seen_at)
       SELECT account_id, ip_address, MAX(ended_at)
         FROM doomed
        WHERE ip_address IS NOT NULL
        GROUP BY account_id, ip_address
       ON CONFLICT (account_id, ip_address) DO UPDATE
          SET last_seen_at = GREATEST(account_ip_associations.last_seen_at, EXCLUDED.last_seen_at)
     )
     DELETE FROM play_sessions WHERE id IN (SELECT id FROM doomed)`,
    [String(days), Math.max(1, Math.floor(batchSize))],
  );
  return res.rowCount ?? 0;
}

// One bounded aging batch against account_ip_associations. The predicate
// rides account_ip_associations_last_seen; aging out an association is the
// privacy bound and deliberately also the end of the ban-evasion lookback for
// that link. No retention floor here: the 45-day floor protects the admin
// activity windows over play_sessions and is retention-specific.
export async function pruneAccountIpAssociationsBatch(
  db: Queryable,
  agingDays: number,
  batchSize: number,
): Promise<number> {
  if (!Number.isFinite(agingDays) || agingDays <= 0) return 0;
  // A fractional value must clamp to at least one day, never floor to '0 days'.
  const days = Math.max(1, Math.floor(agingDays));
  const res = await db.query(
    `DELETE FROM account_ip_associations
      WHERE (account_id, ip_address) IN (
        SELECT account_id, ip_address FROM account_ip_associations
         WHERE last_seen_at < now() - ($1 || ' days')::interval
         ORDER BY last_seen_at
         LIMIT $2)`,
    [String(days), Math.max(1, Math.floor(batchSize))],
  );
  return res.rowCount ?? 0;
}
