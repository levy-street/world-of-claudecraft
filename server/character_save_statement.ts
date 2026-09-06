// The ONE character UPDATE statement the whole save family issues
// (saveCharacterState, saveCharacterAndMarketState, the guild bank escrow
// sibling, and the offline admin writer), extracted from server/db.ts at the
// Masterwrought phase 13 QA (the monolith ratchet; server/CLAUDE.md
// module-first) so the lease fence stays byte-identical across the family and
// a fourth fence shape could land without growing db.ts. The fence rides the
// write statement itself, never a separate pre-check that would race a
// takeover, and a fence that matches no row touches nothing, which every
// caller must treat as "persist NOTHING".
//
// TWO statement SHAPES now build from one fence vocabulary, and the difference
// is a workload count, never a fence: the plain UPDATE (paired with a separate
// row lock on the three direct live paths, so the fence re-evaluates on a fresh
// snapshot) and the single-statement MATERIALIZED locking CTE (for the paths
// that must not grow their statement count, and for the raceless `none` fence).
// BOTH return the material-source PRE-IMAGE the source journal replays from,
// read under the row lock they already take.
//
// Three fence shapes:
// - none: the unconditional write (tests, resumes, meta-less sessions).
// - nonce: the live-session fence. The row is written only while THIS
//   process still holds the character's load lease under the session's
//   per-join nonce AND that lease has not expired (server/db.ts
//   character_leases), so a displaced session (a same-account takeover rotated
//   the nonce, or a peer process reclaimed an expired lease) cannot overwrite
//   the live session's state. The `AND expires_at > now()` qualifier was added
//   by qr-19-nonce-fence-expiry-term (Phase 19) so this fence, the unleased
//   fence below, and acquireCharacterLease's reclaim predicate agree on what a
//   live lease IS; a lapsed-but-unreclaimed row no longer admits its own
//   session's autosave over a landed strip. RESIDUAL (B1, carried to the
//   maintainer): heartbeatCharacterLeases stays unqualified, so a recovered
//   process re-arms a lapsed lease and the term narrows the window rather than
//   closing it. Be honest about how narrow: the autosave and the heartbeat ride
//   the SAME 30 s flush tick (server/periodic_save_flush.ts), which launches the
//   saves FIRST but whose single-statement heartbeat almost always commits first
//   anyway (ONE round trip against a save's connect, BEGIN, SET, row lock and
//   UPDATE), so in the lapsed-but-UNRECLAIMED case (no peer took over) the term
//   catches only the sub-tick window before the heartbeat re-arms the row, which
//   is the LIKELY branch. It fully closes the RECLAIMED-by-a-peer
//   case (the holder changed, so the heartbeat cannot match). Qualifying the
//   heartbeat would shut the residual but risk a stalled process's sessions
//   becoming permanently unsaveable, which is why B1 is the maintainer's call.
// - unleased: the OFFLINE writer fence (the admin clear-item-name strip, the
//   phase 13 QA login-race closure). The row is written only while NO live
//   lease exists for the character. The WS handshake acquires the lease
//   BEFORE it re-reads the blob it will hand to game.join
//   (server/ws_auth.ts), so a fresh login that will ever hold the pre-write
//   state has already claimed the lease by the time this statement runs,
//   and a 0-row result tells the offline writer to refuse rather than land a
//   write the session's next autosave would clobber. Cross-process by
//   construction: the lease table is the one truth a per-process session map
//   cannot see (the double-boot accident the table exists to catch).
//   NOT SELF-SUFFICIENT UNDER CONTENTION, and a caller must know it: this
//   fence is UNCORRELATED with the row it gates (its only reference is $1),
//   so PostgreSQL hoists it into an InitPlan and gates the statement on a
//   One-Time Filter decided BEFORE the row lock is taken, and EvalPlanQual
//   never re-runs an InitPlan after a lock wait. A lease committed during
//   that wait was therefore unseen and the write landed (reproduced at the
//   Phase 18 QA database review). Both offline_character_save_db.ts and
//   offline_character_mutation_db.ts take the character lock FOR UPDATE first.
//   Fresh-blob mutations also delete expired leases under that lock, preventing
//   their heartbeat revival or takeover from undoing a completed mutation.
//
// Pure apart from the size signal: no pool, no clock of its own, the holder
// injected, so the statement text is unit-testable
// (tests/server/character_save_statement.test.ts).
import type { QueryResult } from 'pg';

import {
  queueCharacterBlobWarning,
  recordCharacterBlobBytes,
  reportCharacterBlobSize,
} from './character_blob_size';
import type { CharacterMaterialPreimage } from './character_material_sources_db';
import { REALM } from './realm';

export type CharacterSaveFence =
  | { kind: 'none' }
  | { kind: 'nonce'; holder: string; nonce: string }
  // The offline fence also pins the row's realm (the Phase 17 security
  // review's defense-in-depth note): the live fences address a row a session
  // of THIS realm process loaded, while the offline writer takes a bare
  // character id from an admin route, so the statement itself refuses a
  // cross-realm id rather than relying on every caller's pre-checks.
  | { kind: 'unleased'; realm: string };

/** The offline writer's refusal, surfaced to the operator by the endpoint
 *  that took the 0-row result (server/clear_item_name.ts). */
export const CHARACTER_SAVE_LEASED_LINE =
  'character holds a live session lease; kick them (or wait out the lease) and retry';

// The blob size signal lives HERE rather than in each caller, for the same
// reason the lease fence does: this is the one place the whole save family
// builds its write, so measuring at the chokepoint covers the autosave, the
// market/mail escrow flush, the guild bank escrow flush and the offline writer
// at once, and a future save path inherits it instead of quietly becoming a
// blind spot. Putting it in the callers would mean N places to remember and N
// chances to miss one. BOTH statement shapes below route through it, so the
// pre-image form cannot become the blind spot the split might have created.
//
// Yes, this makes an otherwise pure statement builder log. That is the
// deliberate trade: every call site is a real write attempt (there is no path
// that builds this statement and discards it unused).
//
// What a line here does NOT promise is that the row landed. The statement can
// still be rolled back for reasons unrelated to size: a lease-fence miss rolls
// back both escrow transactions, a refused guild bank escrow aborts the
// whole transaction, and saveCharacterOnLeave retries up to
// LEAVE_SAVE_MAX_ATTEMPTS times with every attempt but the last having failed.
// The message says "attempted" for exactly that reason.
//
// WARN-ONLY, and the write is never gated on size: see
// server/character_blob_size.ts for why a character blob gets a signal where a
// guild bank book gets a hard bound. Nothing about the size can refuse,
// truncate, or skip the write. The reporter also dampens to one line per
// window, so a fleet-wide crossing cannot drown the log.
// The byte measure feeds BOTH signals: the dampened warn line and the
// scrape-visible high-water gauge (woc_character_state_bytes_max), which is
// why it stays unconditional (a cheap can-this-exceed pre-filter would blind
// the gauge to exactly the 10 to 50 KB band it exists to watch; the scan is
// microseconds at the measured worst case).
function reportSaveBlobSize(characterId: number, stateJson: string): void {
  const blobBytes = Buffer.byteLength(stateJson, 'utf8');
  recordCharacterBlobBytes(blobBytes);
  const sizeWarning = reportCharacterBlobSize(characterId, blobBytes, Date.now());
  // Deferred off the builder call: of the five db.ts call sites, at least
  // three build this statement inside an open transaction holding row locks
  // (the two beginSaveTx escrow flushes plus saveCharacterStateOnClient after
  // lockSaveEffectAccounts), and console.warn is a SYNCHRONOUS write when
  // stdout is a blocking sink (a file, a full pipe), which would lengthen the
  // lock hold at exactly the moment the signal fires. The queue writes the
  // line on the next immediate, off the critical section, and the shutdown
  // train drains it synchronously before process.exit (the lost-line window
  // the bare setImmediate left open; see character_blob_size.ts).
  if (sizeWarning !== null) queueCharacterBlobWarning(sizeWarning);
}

export function characterUpdateStatement(
  characterId: number,
  level: number,
  stateJson: string,
  fence: CharacterSaveFence,
): { text: string; values: unknown[] } {
  reportSaveBlobSize(characterId, stateJson);
  switch (fence.kind) {
    case 'none':
      return {
        text: 'UPDATE characters SET level = $2, state = $3, updated_at = now() WHERE id = $1',
        values: [characterId, level, stateJson],
      };
    case 'nonce':
      return {
        text: `UPDATE characters SET level = $2, state = $3, updated_at = now()
            WHERE id = $1
              AND EXISTS (
                SELECT 1 FROM character_leases
                 WHERE character_id = $1 AND holder = $4 AND nonce = $5
                   AND expires_at > now()
              )`,
        values: [characterId, level, stateJson, fence.holder, fence.nonce],
      };
    case 'unleased':
      return {
        text: `UPDATE characters SET level = $2, state = $3, updated_at = now()
            WHERE id = $1 AND realm = $4
              AND NOT EXISTS (
                SELECT 1 FROM character_leases
                 WHERE character_id = $1 AND expires_at > now()
              )`,
        values: [characterId, level, stateJson, fence.realm],
      };
  }
}

/** The characters row lock the fenced UPDATE needs taken FIRST. The nonce and
 *  unleased fences are UNCORRELATED subqueries (their only row reference is $1),
 *  so PostgreSQL hoists each into an InitPlan and decides the One-Time Filter
 *  BEFORE the UPDATE takes the row lock, and EvalPlanQual never re-runs an
 *  InitPlan after a lock wait. A lease that committed (or a nonce that rotated)
 *  during that wait is therefore unseen and the write lands over a live session
 *  (reproduced twice at the Phase 18 QA database review, on the offline twin).
 *  The FIX is the statement ORDERING, not the lock strength: any row lock taken
 *  first moves the whole lock wait ahead of the fence, so the fence evaluates on
 *  a fresh snapshot with the row held (the offline arm measured the repro green
 *  under FOR NO KEY UPDATE too). This LIVE lock is FOR NO KEY UPDATE, the mode the
 *  UPDATE itself would take, deliberately NOT the offline arm's FOR UPDATE: on
 *  this hot save path (about 33 saves a second at 1,000 online, one per character
 *  per 30 s) FOR UPDATE would conflict with the FOR KEY SHARE
 *  every FK-child INSERT of the character takes (chat_logs, character_deeds,
 *  play_sessions and the rest), stalling those inserts and opening a deadlock
 *  edge for the whole save, and it buys nothing here: a same-account takeover
 *  rotates the nonce through acquireCharacterLease's ON CONFLICT DO UPDATE arm,
 *  which re-checks no FK and takes no parent lock, so FOR UPDATE never excluded
 *  it anyway. The fence, not the lock, refuses a cross-realm write (a cross-realm
 *  id has no lease row for this process's holder), so the realm pin here only
 *  keeps the lock from touching another realm's row; it locks nothing on a
 *  mismatch and the fence still refuses. The offline writer keeps FOR UPDATE by
 *  its own rationale (rare, single-lock, and it wants the fresh-lease exclusion).
 *
 *  Its PROJECTION is the save's material-source PRE-IMAGE (the intentional
 *  gathering source journal): the two container subtrees plus two exact-PK
 *  anchor probes, read under the lock that already had to be taken. Each probe
 *  is correlated to the locked row's actual realm and id. The lock's own job is
 *  unchanged; this only stops the read from becoming another statement. What
 *  it costs is real and is not hidden: extracting a field from `state` DETOASTS
 *  the whole blob and ships the two subtrees back on every fenced save, where
 *  `SELECT 1` shipped nothing. After a lock wait the returned image is the
 *  LATEST committed row (EvalPlanQual re-projects the updated tuple), which is
 *  what makes it the honest predecessor rather than a stale snapshot. */
export const CHARACTER_SAVE_PREIMAGE_SELECT = `state->'bank' AS before_bank, state->'vault' AS before_vault,
  EXISTS (
    SELECT 1 FROM material_source_containers
     WHERE material_source_containers.realm = characters.realm
       AND material_source_containers.container = 'personal'
       AND material_source_containers.owner_id = characters.id
  ) AS personal_anchor_exists,
  EXISTS (
    SELECT 1 FROM material_source_containers
     WHERE material_source_containers.realm = characters.realm
       AND material_source_containers.container = 'vault'
       AND material_source_containers.owner_id = characters.id
  ) AS vault_anchor_exists`;

export const CHARACTER_SAVE_ROW_LOCK_SQL = `SELECT ${CHARACTER_SAVE_PREIMAGE_SELECT} FROM characters WHERE id = $1 AND realm = $2 FOR NO KEY UPDATE`;

/** Read a returned pre-image row. A row that does not ANSWER the projection is
 *  no pre-image at all and reads as null, never as an empty container: an
 *  invented empty opening would journal a whole bank as a deposit. A row that
 *  answers with SQL nulls (a character with neither container yet) is a real,
 *  empty pre-image. Anchor proofs are less permissive: only literal true is
 *  trusted, so an absent, null or malformed value safely resends the opening. */
export function readCharacterSavePreimage(
  row: Record<string, unknown> | undefined,
): CharacterMaterialPreimage | null {
  if (row === undefined) return null;
  if (!Object.hasOwn(row, 'before_bank') || !Object.hasOwn(row, 'before_vault')) return null;
  return {
    bank: row.before_bank,
    vault: row.before_vault,
    personalAnchorExists: row.personal_anchor_exists === true,
    vaultAnchorExists: row.vault_anchor_exists === true,
  };
}

/** The offline `unleased` writers own their own lock and statement; routing one
 *  through the live helpers would silently swap its fence's exclusion. */
const UNLEASED_ROUTING_REFUSAL =
  'the unleased offline fence must not run through the live character save helpers';

/**
 * The SINGLE-statement live save: a MATERIALIZED locking CTE takes the row and
 * carries its pre-image, the UPDATE joins that CTE, and RETURNING hands both
 * back. One statement, one round trip, so a path that must not grow its
 * workload (the caller-owned escrow transaction, whose statement count the
 * tunables ladder prices) can capture a pre-image without paying for a second
 * statement.
 *
 * MATERIALIZED is load-bearing: without it the locking read could be folded into
 * the UPDATE's own scan and the "previous" image would stop being a separately
 * locked read. The shape (CTE, join, RETURNING) is the one measured against
 * PostgreSQL 16 before it was written here: the returned image is the committed
 * predecessor even when the statement waited out another transaction's lock, a
 * fence mismatch returns zero rows and zero images, and the write rolls back
 * with its paired audit rows.
 *
 * WHAT IT DOES NOT DO, and no caller may claim otherwise: it does NOT close the
 * nonce fence's InitPlan race. The EXISTS below is still uncorrelated, the
 * planner may still decide it before the row lock, and nothing in the probe
 * observed that ordering. That race stays carried exactly where it was
 * (qr-19-live-nonce-fence-write-loss); the two-statement helper below is what
 * closes it for the three direct paths.
 *
 * Row scope matches the statement each shape replaces, deliberately: `none`
 * addresses `id` alone (the unconditional write's scope, unchanged), and `nonce`
 * addresses `id` plus the lease fence, which is what refuses a cross-realm id.
 */
export function characterPreimageUpdateStatement(
  characterId: number,
  level: number,
  stateJson: string,
  fence: CharacterSaveFence,
): { text: string; values: unknown[] } {
  if (fence.kind === 'unleased') throw new Error(UNLEASED_ROUTING_REFUSAL);
  reportSaveBlobSize(characterId, stateJson);
  const leaseFence =
    fence.kind === 'nonce'
      ? `   AND EXISTS (
             SELECT 1 FROM character_leases
              WHERE character_id = $1 AND holder = $4 AND nonce = $5
                AND expires_at > now()
           )`
      : '';
  const values =
    fence.kind === 'nonce'
      ? [characterId, level, stateJson, fence.holder, fence.nonce]
      : [characterId, level, stateJson];
  return {
    text: `WITH previous AS MATERIALIZED (
  SELECT id, ${CHARACTER_SAVE_PREIMAGE_SELECT} FROM characters WHERE id = $1 FOR NO KEY UPDATE
)
UPDATE characters AS c
   SET level = $2, state = $3, updated_at = now()
  FROM previous
 WHERE c.id = previous.id
${leaseFence}
RETURNING previous.before_bank AS before_bank,
          previous.before_vault AS before_vault,
          previous.personal_anchor_exists AS personal_anchor_exists,
          previous.vault_anchor_exists AS vault_anchor_exists`,
    values,
  };
}

/** One live save's outcome: the UPDATE's own result (a fence miss is still
 *  rowCount 0) plus the locked pre-image the source journal replays from. */
export interface FencedCharacterSave {
  readonly result: QueryResult;
  readonly before: CharacterMaterialPreimage | null;
}

/** The single-statement save, for a caller that owns the transaction and cannot
 *  afford another statement in it. */
export async function runPreimageCharacterSave(
  tx: { query: (text: string, values?: unknown[]) => Promise<QueryResult> },
  characterId: number,
  level: number,
  stateJson: string,
  fence: CharacterSaveFence,
): Promise<FencedCharacterSave> {
  const stmt = characterPreimageUpdateStatement(characterId, level, stateJson, fence);
  const result = await tx.query(stmt.text, stmt.values);
  return { result, before: readCharacterSavePreimage(result.rows[0]) };
}

/** Run the character UPDATE with the row lock taken FIRST for a NONCE-fenced live
 *  write, the offline writer's precedent (server/offline_character_save_db.ts)
 *  extended to the THREE DIRECT live save paths (saveCharacterState and its
 *  market and guild-bank siblings) by qr-19-live-nonce-fence-write-loss
 *  (Phase 19). The live callers pass only `none` or `nonce` fences; the nonce
 *  EXISTS over character_leases is an uncorrelated InitPlan decided BEFORE the row
 *  lock, so the lock (FOR NO KEY UPDATE) is taken first, and the SEPARATE
 *  subsequent UPDATE is what gives the fence a fresh statement snapshot. That
 *  two-statement shape is KEPT here on purpose: collapsing it into the
 *  single-statement pre-image form above would hand this path the carried
 *  InitPlan race it does not have. The OFFLINE `unleased` writer must not be
 *  routed through this helper either (it takes its own FOR UPDATE lock for the
 *  fresh-lease exclusion), and it is refused rather than silently re-fenced.
 *  `tx` is the caller's transaction or pooled client; the lock rides the SAME
 *  transaction as the UPDATE, so it holds until the caller commits. Returns the
 *  UPDATE result, so a fence miss still surfaces as rowCount 0, plus the locked
 *  pre-image for the source journal.
 *
 *  A `none` fence has no subquery and no race, so it needs no separate lock, but
 *  it DOES need a pre-image: it takes the single-statement form, which keeps the
 *  cheapest save path at one round trip exactly as before.
 *
 *  The FOURTH live path, db.ts saveCharacterStateOnClient (the marketplace
 *  escrow / directed / delivered / paid-guild caller), is DELIBERATELY NOT routed
 *  through this helper and takes the single-statement form instead, keeping its
 *  pre-existing InitPlan race. Adding a separate lock would add a workload
 *  statement to the escrow budget, so it remains a distinct policy decision.
 *  The source journal already adds one conditional statement when bank or vault
 *  material changes; woc_market_db.ts prices that statement explicitly. None of
 *  this permits collapsing the already-safe direct saves into a single query. */
export async function runFencedCharacterSave(
  tx: { query: (text: string, values?: unknown[]) => Promise<QueryResult> },
  characterId: number,
  level: number,
  stateJson: string,
  fence: CharacterSaveFence,
): Promise<FencedCharacterSave> {
  if (fence.kind === 'unleased') throw new Error(UNLEASED_ROUTING_REFUSAL);
  if (fence.kind !== 'nonce') {
    return runPreimageCharacterSave(tx, characterId, level, stateJson, fence);
  }
  const locked = await tx.query(CHARACTER_SAVE_ROW_LOCK_SQL, [characterId, REALM]);
  const stmt = characterUpdateStatement(characterId, level, stateJson, fence);
  const result = await tx.query(stmt.text, stmt.values);
  return { result, before: readCharacterSavePreimage(locked.rows[0]) };
}

/** Build the live-session save fence: no nonce is the unconditional write (tests,
 *  resumes, meta-less sessions); a nonce is the lease-fenced write under this
 *  process's holder. Lives here beside the statement builder it feeds so the
 *  whole fenced-save construction is one module; the holder is passed in rather
 *  than imported to keep this file free of a db.ts cycle. */
export function liveSaveFence(leaseNonce: string | undefined, holder: string): CharacterSaveFence {
  return leaseNonce === undefined ? { kind: 'none' } : { kind: 'nonce', holder, nonce: leaseNonce };
}
