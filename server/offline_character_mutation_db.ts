// Fresh-blob offline mutations share one transaction: lock the current row,
// mutate synchronously, retire its expired nonce, then apply the unleased save.
// Async work such as moderation audit and market/mail writes belongs outside.
import { sanitizeRemovedZone1Content } from '../src/sim/removed_zone1_content';
import type { CharacterState } from '../src/sim/sim';
import {
  captureCharacterPreimage,
  journalCharacterSaveSources,
} from './character_material_sources_db';
import { CHARACTER_SAVE_LEASED_LINE, characterUpdateStatement } from './character_save_statement';
import { runWithStatementTimeout } from './db';
import {
  applyOfflineCharacterSaveBounds,
  type BoundedTransactionRunner,
  OFFLINE_CHARACTER_SAVE_STATEMENT_TIMEOUT_MS,
} from './offline_character_save_db';
import { REALM } from './realm';

export type OfflineCharacterMutationOutcome =
  | { ok: true; changed: number }
  | { ok: false; error: 'character not found' | typeof CHARACTER_SAVE_LEASED_LINE };

/** Five seconds per statement, two seconds per lock acquisition, ten seconds
 * idle in transaction. These are not a whole-transaction wall deadline.
 * A zero-change callback performs no lease deletion or character update. */
export async function mutateOfflineCharacterState(
  characterId: number,
  mutate: (state: CharacterState) => number,
  runTransaction: BoundedTransactionRunner = runWithStatementTimeout,
): Promise<OfflineCharacterMutationOutcome> {
  return runTransaction(OFFLINE_CHARACTER_SAVE_STATEMENT_TIMEOUT_MS, async (query) => {
    await applyOfflineCharacterSaveBounds(query);
    const loaded = await query(
      'SELECT level, state FROM characters WHERE id = $1 AND realm = $2 FOR UPDATE',
      [characterId, REALM],
    );
    const row = loaded.rows[0] as { level: number; state: CharacterState | null } | undefined;
    if (!row?.state) return { ok: false, error: 'character not found' };
    // The before-state for the source journal, DETACHED before the callback runs:
    // `mutate` rewrites this blob in place, so a later read would be the after.
    const preimage = captureCharacterPreimage(row.state);
    const changed = mutate(row.state);
    if (!Number.isSafeInteger(changed) || changed < 0) {
      throw new Error('offline character mutation must return a non-negative safe integer');
    }
    if (changed === 0) return { ok: true, changed };

    // Lock order: character, then its expired lease. FOR UPDATE excludes new
    // lease inserts through their parent FK check. Existing expired-row UPSERTs
    // skip that check, and heartbeats can revive them: delete the expired nonce
    // under the parent lock so neither can undo a successful offline mutation.
    // A revival/takeover that wins first makes DELETE recheck and retain the
    // live row; the following fresh statement's unleased fence then refuses.
    await query('DELETE FROM character_leases WHERE character_id = $1 AND expires_at <= now()', [
      characterId,
    ]);
    const cleanState = sanitizeRemovedZone1Content(row.state).state;
    const statement = characterUpdateStatement(characterId, row.level, JSON.stringify(cleanState), {
      kind: 'unleased',
      realm: REALM,
    });
    const saved = await query(statement.text, statement.values);
    // Same transaction, after the write: a lease-refused write (0 rows) journals
    // nothing, and a refused journal aborts the mutation with it. A sanctioned
    // signer rewrite is exactly the exact-decrement/exact-increment pair here.
    await journalCharacterSaveSources({ query }, characterId, preimage, saved, cleanState);
    return (saved.rowCount ?? 0) > 0
      ? { ok: true, changed }
      : { ok: false, error: CHARACTER_SAVE_LEASED_LINE };
  });
}
