import type { PoolClient } from 'pg';
import type { CharacterState } from '../src/sim/character_state';
import {
  type MembershipBankTransferRequest,
  membershipBankView,
  planMembershipBankTransfer,
} from '../src/sim/membership_bank';
import type { BankInfo } from '../src/world_api/bank';
import type { BankLedgerSaveEffects } from './bank_ledger_save_effects_db';
import { lockCharacterSaveAccountParentOnClient } from './bank_ledger_save_effects_db';
import { PROCESS_LEASE_HOLDER } from './character_lease_db';
import { journalCharacterSaveSources } from './character_material_sources_db';
import { pool, saveCharacterStateOnClient } from './db';
import { cancelDetachedBackend } from './db_backend_cancel';
import { createDbTransactionDeadline } from './db_transaction_deadline';
import { membershipExpiresAtOnClient } from './membership_db';
import {
  type MembershipAuthorization,
  trustedRecurringMembershipExpiry,
} from './membership_service';
import { throwProvedRollback } from './pg_rollback_proof';
import { REALM } from './realm';
import type { StorageAppliedEffect } from './storage_purchase_db';

/** Deliberate selected-bank reads only. Oversized legacy banks remain intact and
 * usable through their owner; this cross-character view never truncates them. */
export const MEMBERSHIP_BANK_MAX_BYTES = 256 * 1024;
export const MEMBERSHIP_BANK_ROSTER_LIMIT = 20;
export const MEMBERSHIP_BANK_TRANSACTION_MS = 10_000;
export interface MembershipBankCharacter {
  characterId: number;
  name: string;
}
export type MembershipBankError =
  | 'membership_required'
  | 'not_found'
  | 'online'
  | 'too_large'
  | 'lease_lost'
  | 'invalid'
  | 'stale'
  | 'bound'
  | 'no_fit'
  | 'unavailable'
  | 'uncertain';
export type MembershipBankResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: MembershipBankError };

const validId = (id: number): boolean => Number.isSafeInteger(id) && id > 0;

export async function listMembershipBanks(accountId: number): Promise<MembershipBankCharacter[]> {
  if (!validId(accountId)) return [];
  // Metadata only. The account index bounds the roster before the tiny sort.
  const result = await pool.query(
    `SELECT id, name FROM characters WHERE account_id = $1 AND realm = $2
     ORDER BY id LIMIT $3`,
    [accountId, REALM, MEMBERSHIP_BANK_ROSTER_LIMIT],
  );
  return result.rows.map((row) => ({ characterId: Number(row.id), name: String(row.name) }));
}

export async function loadMembershipBank(
  accountId: number,
  characterId: number,
): Promise<MembershipBankResult<BankInfo>> {
  if (!validId(accountId) || !validId(characterId)) return { ok: false, error: 'invalid' };
  const result = await pool.query(
    `SELECT CASE WHEN COALESCE(octet_length((state->'bank')::text), 0) <= $4
                 THEN state->'bank' ELSE NULL END AS bank,
            COALESCE(octet_length((state->'bank')::text), 0) > $4 AS oversized,
            EXISTS (SELECT 1 FROM character_leases WHERE character_id = characters.id
                    AND expires_at > now()) AS online
       FROM characters WHERE id = $1 AND account_id = $2 AND realm = $3`,
    [characterId, accountId, REALM, MEMBERSHIP_BANK_MAX_BYTES],
  );
  const row = result.rows[0];
  if (!row) return { ok: false, error: 'not_found' };
  if (row.online) return { ok: false, error: 'online' };
  if (row.oversized) return { ok: false, error: 'too_large' };
  return { ok: true, value: membershipBankView(row.bank ?? undefined) };
}

export interface MembershipBankSave {
  accountId: number;
  characterId: number;
  targetCharacterId: number;
  leaseNonce: string;
  state: CharacterState;
  membership: MembershipAuthorization;
  storageEffects?: readonly StorageAppliedEffect[];
  ledgerEffects?: BankLedgerSaveEffects;
  request: MembershipBankTransferRequest;
  /** Re-check live authority/proximity after awaits, while the host still owns
   * the inventory guard and the source character's FIFO slot. */
  stillAuthorized(): boolean;
}

export interface MembershipBankCommitted {
  inventoryBefore: CharacterState['inventory'];
  inventory: CharacterState['inventory'];
  bank: BankInfo;
  moved: number;
}

class BankRefusal extends Error {
  constructor(readonly error: MembershipBankError) {
    super(error);
  }
}

/** Host MUST hold its inventory guard and serialize this whole call on the
 * actor's save FIFO. No live state is mutated until this returns a proven COMMIT.
 * Account parent -> two character rows ascending -> lease rows. The offline
 * target's FOR UPDATE excludes new lease FK inserts; deleting expired leases
 * prevents their heartbeat revival from undoing the offline write. */
export async function transferMembershipBank(
  input: MembershipBankSave,
): Promise<MembershipBankResult<MembershipBankCommitted>> {
  const { accountId, characterId, targetCharacterId } = input;
  if (
    ![accountId, characterId, targetCharacterId].every(validId) ||
    characterId === targetCharacterId ||
    !input.leaseNonce
  ) {
    return { ok: false, error: 'invalid' };
  }
  const client = await pool.connect();
  const tx = createDbTransactionDeadline(client, {
    operation: 'membership bank transfer',
    timeoutMs: MEMBERSHIP_BANK_TRANSACTION_MS,
    cancelBackend: cancelDetachedBackend,
  });
  // The existing save seam takes PoolClient but consumes only query. Routing
  // every query through the deadline preserves its wall and cancellation bound.
  const bounded = { query: tx.query.bind(tx) } as PoolClient;
  let commitStarted = false;
  try {
    await tx.query('BEGIN');
    await tx.query(
      "SET LOCAL statement_timeout = '5s'; SET LOCAL lock_timeout = '2s'; SET LOCAL idle_in_transaction_session_timeout = '5s'",
    );
    const parentLock = await lockCharacterSaveAccountParentOnClient(bounded, accountId);
    const expiresAt = await membershipExpiresAtOnClient(
      bounded,
      accountId,
      trustedRecurringMembershipExpiry(input.membership, Date.now()),
    );
    if (!(Number(expiresAt) > Date.now())) throw new BankRefusal('membership_required');
    const locked = await tx.query(
      `SELECT id, CASE WHEN id = $2 AND COALESCE(octet_length((state->'bank')::text), 0) <= $5
                      THEN state->'bank' ELSE NULL END AS bank,
              id = $2 AND COALESCE(octet_length((state->'bank')::text), 0) > $5 AS oversized,
              state IS NOT NULL AS has_state
         FROM characters WHERE id = ANY($1::int[]) AND account_id = $3 AND realm = $4
         ORDER BY id FOR UPDATE`,
      [
        [characterId, targetCharacterId].sort((a, b) => a - b),
        targetCharacterId,
        accountId,
        REALM,
        MEMBERSHIP_BANK_MAX_BYTES,
      ],
    );
    if (locked.rows.length !== 2) throw new BankRefusal('not_found');
    const target = locked.rows.find((row) => Number(row.id) === targetCharacterId);
    if (!target?.has_state) throw new BankRefusal('not_found');
    if (target.oversized) throw new BankRefusal('too_large');
    // Lock the actor nonce through COMMIT, so a same-account takeover cannot
    // win after the precheck and load the actor's pre-transfer durable bags.
    const actorLease = await tx.query(
      `SELECT character_id FROM character_leases WHERE character_id = $1
       AND holder = $2 AND nonce = $3 AND expires_at > now() FOR UPDATE`,
      [characterId, PROCESS_LEASE_HOLDER, input.leaseNonce],
    );
    if (actorLease.rows.length !== 1) throw new BankRefusal('lease_lost');
    await tx.query('DELETE FROM character_leases WHERE character_id = $1 AND expires_at <= now()', [
      targetCharacterId,
    ]);
    const targetLease = await tx.query(
      'SELECT character_id FROM character_leases WHERE character_id = $1',
      [targetCharacterId],
    );
    if (targetLease.rows.length !== 0) throw new BankRefusal('online');
    if (!input.stillAuthorized()) throw new BankRefusal('invalid');
    const plan = planMembershipBankTransfer(input.state, target.bank ?? undefined, input.request);
    if (!plan.ok) throw new BankRefusal(plan.error);
    // A growing save must not make the deliberate read unrepresentable.
    if (Buffer.byteLength(JSON.stringify(plan.bank), 'utf8') > MEMBERSHIP_BANK_MAX_BYTES) {
      throw new BankRefusal('too_large');
    }
    const saved = await saveCharacterStateOnClient(
      bounded,
      characterId,
      input.state.level,
      { ...input.state, inventory: plan.inventory },
      input.leaseNonce,
      input.storageEffects,
      input.ledgerEffects,
      parentLock,
    );
    if (!saved) throw new BankRefusal('lease_lost');
    // Patch only the bank subtree. Unrelated fields and future save keys of
    // the offline character stay byte-for-byte semantically untouched.
    const targetSaved = await tx.query(
      `UPDATE characters SET state = jsonb_set(state, '{bank}', $4::jsonb), updated_at = now()
       WHERE id = $1 AND account_id = $2 AND realm = $3
       AND NOT EXISTS (SELECT 1 FROM character_leases WHERE character_id = $1 AND expires_at > now())`,
      [targetCharacterId, accountId, REALM, JSON.stringify(plan.bank)],
    );
    if (targetSaved.rowCount !== 1) throw new BankRefusal('online');
    await journalCharacterSaveSources(
      bounded,
      targetCharacterId,
      { bank: target.bank, vault: undefined },
      targetSaved,
      { bank: plan.bank },
    );
    // Uses the existing keep-forever, hard-budgeted personal-bank ledger. The
    // character_id names the BANK OWNER so the existing audit replays it.
    await tx.query(
      `INSERT INTO bank_ledger
       (realm, character_id, account_id, op, item_id, count, instance, copper_delta,
        purchased_slots_after, container, container_id, counterparty_count)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, 0, $8, 'personal', NULL, $9)`,
      [
        REALM,
        targetCharacterId,
        accountId,
        input.request.direction,
        plan.item.itemId,
        plan.moved,
        plan.item.instance === undefined ? null : JSON.stringify(plan.item.instance),
        plan.bank.purchasedSlots,
        input.request.direction === 'deposit' ? -plan.moved : plan.moved,
      ],
    );
    if (!input.stillAuthorized() || !(Number(expiresAt) > Date.now()))
      throw new BankRefusal('membership_required');
    commitStarted = true;
    await tx.commit();
    return {
      ok: true,
      value: {
        inventoryBefore: input.state.inventory,
        inventory: plan.inventory,
        bank: membershipBankView(plan.bank),
        moved: plan.moved,
      },
    };
  } catch (error) {
    await tx.rollback();
    if (error instanceof BankRefusal) return { ok: false, error: error.error };
    // Never retry a COMMIT whose acknowledgement was lost. The caller must
    // quarantine without saving its old live inventory and reload from DB.
    if (commitStarted && !throwProvedRollback(error)) return { ok: false, error: 'uncertain' };
    throw error;
  } finally {
    tx.release();
  }
}
