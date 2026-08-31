// SQL boundary for the clear-item-name remediation arm (the *_db.ts
// convention: server/clear_item_name.ts is the pure decision core behind an
// injected deps bag, admin.ts binds the real IO, and every query the arm
// needs beyond the shared character read/write pair lives here). The blob
// read is db.ts getCharacterById and the fenced write is db.ts
// saveOfflineCharacterState; this module owns the one read the refusal arm
// added: a SELECT 1 existence probe, so the endpoint can tell a live-lease
// refusal from a vanished row without paying the whole JSONB blob a second
// time (the Phase 18 clear-item-name-select1 item).

import { runWithStatementTimeout } from './db';
import { REALM } from './realm';

/**
 * The probe's own statement bound. Its sibling write (saveOfflineCharacterState,
 * server/offline_character_save_db.ts) runs under an explicitly chosen
 * single-row allowance rather than the ambient session default, and this read
 * gets the same discipline for the same reason: it is one indexed single-row
 * read on the REFUSAL path of an operator action, so its intended cost is
 * milliseconds and its degraded cost should not be a pooled client pinned for
 * the full 15s default while the operator waits (db.ts GUILD_BANK_LOG_TIMEOUT_MS
 * is the lowering precedent). Two seconds is generous for an index probe and
 * still an order of magnitude under the default.
 */
export const CLEAR_ITEM_NAME_PROBE_TIMEOUT_MS = 2_000;

/**
 * Does a character row with a state blob exist on this realm? The predicate is
 * the SAME one the first load (getCharacterById: id and realm) answers
 * not-found on, plus the state-not-null qualifier the endpoint applied to that
 * load, so the refusal arm can never call a row the load would have refused
 * "leased", nor the reverse. Projects a literal 1: the blob never leaves the
 * database on this path. A live lease does not change the answer; that is the
 * point, since existence-with-a-refused-write is exactly what the retry line
 * means.
 */
export async function characterStateExists(characterId: number): Promise<boolean> {
  const res = await runWithStatementTimeout(CLEAR_ITEM_NAME_PROBE_TIMEOUT_MS, (query) =>
    query('SELECT 1 FROM characters WHERE id = $1 AND realm = $2 AND state IS NOT NULL', [
      characterId,
      REALM,
    ]),
  );
  return (res.rowCount ?? 0) > 0;
}
