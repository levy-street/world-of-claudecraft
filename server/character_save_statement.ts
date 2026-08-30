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
//   per-join nonce (server/db.ts character_leases), so a displaced session
//   (a same-account takeover rotated the nonce, or a peer process reclaimed
//   an expired lease) cannot overwrite the live session's state.
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
//
// Pure apart from the size signal: no pool, no clock of its own, the holder
// injected, so the statement text is unit-testable
// (tests/server/character_save_statement.test.ts).
import { recordCharacterBlobBytes, reportCharacterBlobSize } from './character_blob_size';

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
  // lock hold at exactly the moment the signal fires. setImmediate keeps the
  // line, off the critical section.
  // The callback swallows its own throw (EPIPE on a stdout closed at
  // shutdown): an unhandled async rejection from a dev-channel line would be
  // worse than a lost line, and a shutdown-path save losing its queued warn
  // is an accepted cost of keeping the write off the lock hold.
  if (sizeWarning !== null) {
    setImmediate(() => {
      try {
        console.warn(sizeWarning);
      } catch {
        /* a lost dev-channel line, never a crash */
      }
    });
  }
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
