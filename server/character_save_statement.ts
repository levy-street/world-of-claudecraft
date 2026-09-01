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
//   Phase 18 QA database review). Its one caller,
//   server/offline_character_save_db.ts, takes the characters row lock
//   FOR UPDATE in a preceding statement for exactly this reason; a SECOND
//   caller that skips that step reopens the same write loss.
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

export function characterUpdateStatement(
  characterId: number,
  level: number,
  stateJson: string,
  fence: CharacterSaveFence,
): { text: string; values: unknown[] } {
  // The blob size signal lives HERE rather than in each caller, for the same
  // reason the lease fence does: this is the one statement the whole save family
  // issues, so measuring at the chokepoint covers the autosave, the market/mail
  // escrow flush, the guild bank escrow flush and the offline writer at once,
  // and a future save path inherits it instead of quietly becoming a blind
  // spot. Putting it in the callers would mean N places to remember and N
  // chances to miss one.
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
 *  its own rationale (rare, single-lock, and it wants the fresh-lease exclusion). */
export const CHARACTER_SAVE_ROW_LOCK_SQL =
  'SELECT 1 FROM characters WHERE id = $1 AND realm = $2 FOR NO KEY UPDATE';

/** Run the character UPDATE with the row lock taken FIRST for a NONCE-fenced live
 *  write, the offline writer's precedent (server/offline_character_save_db.ts)
 *  extended to the THREE DIRECT live save paths (saveCharacterState and its
 *  market and guild-bank siblings) by qr-19-live-nonce-fence-write-loss
 *  (Phase 19). The live callers pass only `none` or `nonce` fences; the nonce
 *  EXISTS over character_leases is an uncorrelated InitPlan decided BEFORE the row
 *  lock, so the lock (FOR NO KEY UPDATE) is taken first. A `none` fence is an
 *  unconditional write with no subquery and no race, so it skips the extra round
 *  trip and the cheapest save path stays cheap. The condition below keys on the
 *  `character_leases` reference; the OFFLINE `unleased` writer must NOT be routed
 *  through this helper (it takes its own FOR UPDATE lock for the fresh-lease
 *  exclusion), and no unleased caller does today. `tx` is the caller's transaction
 *  or pooled client; the lock rides the SAME transaction as the UPDATE, so it
 *  holds until the caller commits. Returns the UPDATE result, so a fence miss
 *  still surfaces as rowCount 0.
 *
 *  The FOURTH live path, db.ts saveCharacterStateOnClient (the marketplace
 *  escrow / directed / delivered / paid-guild caller), is DELIBERATELY NOT routed
 *  through this helper and keeps its plain fenced UPDATE with its pre-existing
 *  InitPlan race. Adding the lock statement there would raise that transaction's
 *  base workload to six statements, and baseWorkloadCeilingMs
 *  (ESCROW_STATEMENT_TIMEOUT_MS x 6 + lock + connect) would exceed the autosave
 *  period the tunables ladder pins as the ceiling (baseWorkloadCeilingMs <
 *  autosaveMs, tests/server/tunables.test.ts). Closing that path's race is a
 *  maintainer tuning decision (re-tune ESCROW_STATEMENT_TIMEOUT_MS to fit the
 *  sixth statement, or accept a higher escrow occupancy); it is CARRIED under
 *  qr-19-live-nonce-fence-write-loss, and the gate caught the breach the phase
 *  document's "four live save paths" premise missed. */
export async function runFencedCharacterUpdate(
  tx: { query: (text: string, values?: unknown[]) => Promise<QueryResult> },
  characterId: number,
  stmt: { text: string; values: unknown[] },
): Promise<QueryResult> {
  if (stmt.text.includes('character_leases')) {
    await tx.query(CHARACTER_SAVE_ROW_LOCK_SQL, [characterId, REALM]);
  }
  return tx.query(stmt.text, stmt.values);
}

/** Build the live-session save fence: no nonce is the unconditional write (tests,
 *  resumes, meta-less sessions); a nonce is the lease-fenced write under this
 *  process's holder. Lives here beside the statement builder it feeds so the
 *  whole fenced-save construction is one module; the holder is passed in rather
 *  than imported to keep this file free of a db.ts cycle. */
export function liveSaveFence(leaseNonce: string | undefined, holder: string): CharacterSaveFence {
  return leaseNonce === undefined ? { kind: 'none' } : { kind: 'nonce', holder, nonce: leaseNonce };
}
