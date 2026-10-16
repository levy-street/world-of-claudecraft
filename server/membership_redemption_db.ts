import type { PoolClient } from 'pg';
import type { CharacterState } from '../src/sim/character_state';
import { lockCharacterSaveAccountParentOnClient } from './bank_ledger_save_effects_db';
import { bankLedgerSaveEffects } from './bank_ledger_session';
import { PROCESS_LEASE_HOLDER } from './character_lease_db';
import { pool, saveCharacterStateOnClient } from './db';
import { cancelDetachedBackend } from './db_backend_cancel';
import { createDbTransactionDeadline } from './db_transaction_deadline';
import { extendPrepaidMembershipOnClient } from './membership_db';
import { throwProvedRollback } from './pg_rollback_proof';
import { REALM } from './realm';
import type { CharacterSaveArgs } from './woc_market_character_save';

export function consumeMembershipToken(state: CharacterState, index: number): boolean {
  if (!Number.isSafeInteger(index) || index < 0) return false;
  const slot = state.inventory[index];
  if (
    slot?.itemId !== 'membership_token' ||
    !Number.isSafeInteger(slot.count) ||
    slot.count < 1 ||
    slot.instance?.locked
  )
    return false;
  if (slot.count === 1) state.inventory.splice(index, 1);
  else slot.count--;
  return true;
}

export type MembershipRedemptionResult =
  | { ok: true; expiresAt: number }
  | { ok: false; reason: 'token_missing' | 'lease_lost' | 'retry' };

/** Inventory removal and prepaid time commit together. Caller holds the live save FIFO. */
export async function redeemMembershipTokenAtomic(
  accountId: number,
  save: CharacterSaveArgs,
  slotIndex: number,
  recurringExpiresAt: number | null,
): Promise<MembershipRedemptionResult> {
  const state = structuredClone(save.state);
  if (!consumeMembershipToken(state, slotIndex)) return { ok: false, reason: 'token_missing' };
  if (!save.leaseNonce) return { ok: false, reason: 'lease_lost' };
  let client: PoolClient;
  try {
    client = await pool.connect();
  } catch {
    // No checkout means no transaction or token mutation could have happened.
    return { ok: false, reason: 'retry' };
  }
  const tx = createDbTransactionDeadline(client, {
    timeoutMs: 20_000,
    operation: 'membership redemption',
    cancelBackend: cancelDetachedBackend,
  });
  let committing = false;
  try {
    await tx.query('BEGIN');
    await tx.query(
      "SET LOCAL statement_timeout = '5s'; SET LOCAL lock_timeout = '2s'; SET LOCAL idle_in_transaction_session_timeout = '10s'",
    );
    const proof = await lockCharacterSaveAccountParentOnClient(tx, accountId);
    const owned = await tx.query(
      'SELECT id FROM characters WHERE id = $1 AND account_id = $2 AND realm = $3 FOR UPDATE',
      [save.characterId, accountId, REALM],
    );
    const lease = await tx.query(
      'SELECT nonce FROM character_leases WHERE character_id = $1 AND nonce = $2 AND holder = $3 AND expires_at > now() FOR UPDATE',
      [save.characterId, save.leaseNonce, PROCESS_LEASE_HOLDER],
    );
    if (!owned.rowCount || !lease.rowCount) {
      await tx.rollback();
      return { ok: false, reason: 'lease_lost' };
    }
    const saved = await saveCharacterStateOnClient(
      tx as unknown as PoolClient,
      save.characterId,
      save.level,
      state,
      save.leaseNonce,
      save.storageEffects,
      save.bankLedgerSnapshot ? bankLedgerSaveEffects(save.bankLedgerSnapshot) : undefined,
      proof,
    );
    if (!saved) {
      await tx.rollback();
      return { ok: false, reason: 'lease_lost' };
    }
    const expiresAt = await extendPrepaidMembershipOnClient(
      tx as unknown as PoolClient,
      accountId,
      recurringExpiresAt,
      Date.now(),
    );
    committing = true;
    await tx.commit();
    return { ok: true, expiresAt };
  } catch (error) {
    await tx.rollback();
    // A lost COMMIT response can mean the token was already consumed. The host
    // must quarantine instead of retrying or projecting its old inventory.
    if (committing && !throwProvedRollback(error)) throw error;
    return { ok: false, reason: 'retry' };
  } finally {
    tx.release();
  }
}
