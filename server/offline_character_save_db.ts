// The OFFLINE character-blob write, extracted whole from server/db.ts at the
// Phase 18 database review (the monolith ratchet: db.ts pays for growth by
// extraction, server/CLAUDE.md module-first, and the *_db.ts family is where a
// domain's own SQL lives).
//
// WHY IT NEEDS MORE THAN A STATEMENT TIMEOUT. The three offline writers (the
// rename and reclaim signer sweeps, the PBE roster save, and the admin
// clear-item-name strip) used to persist through the live save family, whose
// transaction owner (server/character_save_transaction.ts beginCharacterSaveTx)
// sets THREE bounds: statement_timeout, lock_timeout 2s, and
// idle_in_transaction_session_timeout 10s, under a 65s wall deadline. When the
// lease fence gave them their own writer, the replacement carried only the
// statement bound, and the two it dropped are the ones that matter for a
// single-row UPDATE: this statement takes a ROW LOCK on `characters`, and a
// live session's own save can be holding it. Without lock_timeout a contended
// fence UPDATE waits the entire statement allowance (a full minute on the
// heavy tier it inherited) with a pooled client pinned for all of it, while an
// operator watches an admin request hang; with it, the write fails fast as
// 55P03 and the caller can say so. idle_in_transaction_session_timeout is the
// same defense one level up: it bounds the hold if this process stalls between
// the SET and the COMMIT.
//
// The statement bound is deliberately NOT the heavy tier either. The heavy
// allowance exists for the multi-statement live saves and the big aggregates;
// this is one row's UPDATE, so it takes an allowance sized to that, on the
// GUILD_BANK_LOG_TIMEOUT_MS lowering precedent (db.ts). It still sits above
// the lock bound, or a contended wait could never surface as a lock timeout.
//
// The transaction runner is INJECTED rather than imported, so this module
// holds no pool of its own: db.ts binds the real runWithStatementTimeout at
// its one call site, and the suite drives the whole statement build and the
// bound sequence with a fake.
import type { QueryResult } from 'pg';

import { sanitizeRemovedZone1Content } from '../src/sim/removed_zone1_content';
import type { CharacterState } from '../src/sim/sim';
import { characterUpdateStatement } from './character_save_statement';
import { REALM } from './realm';

/** One row's UPDATE, not the heavy multi-statement tier (see the header). */
export const OFFLINE_CHARACTER_SAVE_STATEMENT_TIMEOUT_MS = 5_000;
/** The row-lock wait, matching beginCharacterSaveTx's own 2s. */
export const OFFLINE_CHARACTER_SAVE_LOCK_TIMEOUT_MS = 2_000;
/** The idle-in-transaction hold, matching beginCharacterSaveTx's own 10s. */
export const OFFLINE_CHARACTER_SAVE_IDLE_TX_TIMEOUT_MS = 10_000;

/** The shape of db.ts runWithStatementTimeout: run `fn` in ONE transaction on
 *  a dedicated pooled client whose statement_timeout is SET for the duration. */
export type BoundedTransactionRunner = <T>(
  timeoutMs: number,
  fn: (query: (text: string, values?: unknown[]) => Promise<QueryResult>) => Promise<T>,
) => Promise<T>;

/**
 * Persist a character row from an OFFLINE writer: fenced in the SAME statement
 * on the ABSENCE of a live load lease, so a login that has already claimed the
 * lease (the handshake acquires it before it re-reads the blob,
 * server/ws_auth.ts) makes this write touch nothing and return false, which
 * the caller surfaces as a refusal instead of landing a write the session's
 * next autosave would clobber. The caller's pre-checks answer the common case;
 * the fence answers the reconnect window a per-process session map cannot see
 * (a peer process too), and pins the row's realm. Same chokepoints as the live
 * save (the zone-1 sanitize, the one statement builder with its blob-size
 * signal).
 *
 * Every bound is SET before the write it bounds, inside the runner's own
 * transaction, so all three revert at COMMIT and none leaks to the next
 * checkout.
 */
export async function runOfflineCharacterSave(
  runBounded: BoundedTransactionRunner,
  characterId: number,
  level: number,
  state: CharacterState,
): Promise<boolean> {
  const cleanState = sanitizeRemovedZone1Content(state).state;
  const stmt = characterUpdateStatement(characterId, level, JSON.stringify(cleanState), {
    kind: 'unleased',
    realm: REALM,
  });
  const res = await runBounded(OFFLINE_CHARACTER_SAVE_STATEMENT_TIMEOUT_MS, async (query) => {
    // SET LOCAL takes no bind parameter, so both values are interpolated as
    // integers; they are module constants, never caller input, so no other
    // value can reach the statement text.
    await query(`SET LOCAL lock_timeout = ${OFFLINE_CHARACTER_SAVE_LOCK_TIMEOUT_MS}`);
    await query(
      `SET LOCAL idle_in_transaction_session_timeout = ${OFFLINE_CHARACTER_SAVE_IDLE_TX_TIMEOUT_MS}`,
    );
    return query(stmt.text, stmt.values);
  });
  return (res.rowCount ?? 0) > 0;
}
