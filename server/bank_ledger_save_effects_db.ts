// The narrow bridge between a fenced character save and the transactional
// bank-ledger batch writer. Validation stays query-free, account parents lock
// before their character child, and callers keep ownership of BEGIN/COMMIT.

import {
  type BankLedgerBatchOwner,
  type BankLedgerBatchWriteResult,
  writeBankLedgerCommandBatches,
} from './bank_ledger_batch_db';
import {
  type BankLedgerCommandBatch,
  bankLedgerBatchMatchesOwner,
  bankLedgerCommandBatchFingerprintJson,
} from './bank_ledger_outbox';
import { REALM } from './realm';
import type { StorageAppliedEffect } from './storage_purchase_db';

export interface BankLedgerSaveEffects {
  readonly owner: BankLedgerBatchOwner;
  readonly batches: readonly BankLedgerCommandBatch[];
}

export interface BankLedgerCommittedPrefixEvidence {
  readonly owner: BankLedgerBatchOwner;
  readonly batches: readonly BankLedgerCommandBatch[];
}

const committedPrefixEvidence = new WeakMap<object, BankLedgerCommittedPrefixEvidence>();

/** Read the ledger-only durable evidence attached to a later save failure.
 *  Storage effects are deliberately absent: their receipt owns its own retry. */
export function bankLedgerCommittedPrefixForError(
  error: unknown,
): BankLedgerCommittedPrefixEvidence | null {
  if ((typeof error !== 'object' && typeof error !== 'function') || error === null) return null;
  return committedPrefixEvidence.get(error) ?? null;
}

/** Preserve only the verified pre-existing prefix. Newly claimed commands may
 *  have rolled back, and an ambiguous COMMIT provides no stronger evidence. */
export function attachBankLedgerCommittedPrefixToError(
  error: unknown,
  effects: BankLedgerSaveEffects | undefined,
  result: BankLedgerBatchWriteResult | undefined,
): void {
  if (
    !effects ||
    !result ||
    result.alreadyCommittedPrefix.length === 0 ||
    (typeof error !== 'object' && typeof error !== 'function') ||
    error === null
  ) {
    return;
  }
  committedPrefixEvidence.set(
    error,
    Object.freeze({
      owner: Object.freeze({
        realm: effects.owner.realm,
        characterId: effects.owner.characterId,
        accountId: effects.owner.accountId,
      }),
      batches: result.alreadyCommittedPrefix,
    }),
  );
}

interface Queryable {
  query(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }>;
}

/** An opaque, one-use proof that this exact transaction client already holds
 *  a parent account lock strong enough for character save effects. Callers
 *  cannot construct or move a proof to another client: the private WeakMap is
 *  the authority, while accountId remains visible only for diagnostics. */
const characterSaveAccountLockProofBrand: unique symbol = Symbol('CharacterSaveAccountLockProof');
export interface CharacterSaveAccountLockProof {
  readonly [characterSaveAccountLockProofBrand]: true;
  readonly accountId: number;
}

interface AccountLockProofState {
  readonly db: Queryable;
  readonly accountId: number;
  consumed: boolean;
}

const accountLockProofs = new WeakMap<CharacterSaveAccountLockProof, AccountLockProofState>();

function assertPositiveAccountId(accountId: number): void {
  if (!Number.isSafeInteger(accountId) || accountId <= 0) {
    throw new RangeError('character save account lock id must be a positive safe integer');
  }
}

function characterSaveEffectAccountIds(
  storageEffects: readonly StorageAppliedEffect[],
  ledgerEffects: BankLedgerSaveEffects | undefined,
): number[] {
  const accountIds = new Set(storageEffects.map((effect) => effect.accountId));
  if (ledgerEffects) {
    accountIds.add(ledgerEffects.owner.accountId);
    for (const batch of ledgerEffects.batches) {
      for (const row of batch.rows) accountIds.add(row.accountId);
    }
  }
  return [...accountIds].sort((a, b) => a - b);
}

function rememberCharacterSaveAccountLock(
  db: Queryable,
  accountId: number,
): CharacterSaveAccountLockProof {
  const proof = Object.freeze({
    [characterSaveAccountLockProofBrand]: true as const,
    accountId,
  });
  accountLockProofs.set(proof, { db, accountId, consumed: false });
  return proof;
}

/** Take the accounts-first NO KEY UPDATE lock used by a capped WOC escrow
 *  insert and return a proof the later character-save helper can consume.
 *  This is stronger than the KEY SHARE lock save effects otherwise acquire,
 *  while still admitting unrelated FK-child inserts. */
export async function lockCharacterSaveAccountParentOnClient(
  db: Queryable,
  accountId: number,
): Promise<CharacterSaveAccountLockProof> {
  assertPositiveAccountId(accountId);
  const locked = await db.query('SELECT id FROM accounts WHERE id = $1 FOR NO KEY UPDATE', [
    accountId,
  ]);
  if (Number(locked.rows[0]?.id) !== accountId) {
    throw new Error('character save account disappeared before parent lock');
  }
  return rememberCharacterSaveAccountLock(db, accountId);
}

/** Take the accounts-first KEY SHARE lock used by ordinary save effects and
 *  return a proof the later character-save helper can consume. This is the
 *  narrow lock for callers that only need the account FK parent to survive. */
export async function lockCharacterSaveAccountParentKeyShareOnClient(
  db: Queryable,
  accountId: number,
): Promise<CharacterSaveAccountLockProof> {
  assertPositiveAccountId(accountId);
  const locked = await db.query('SELECT id FROM accounts WHERE id = $1 FOR KEY SHARE', [accountId]);
  if (Number(locked.rows[0]?.id) !== accountId) {
    throw new Error('character save account disappeared before parent lock');
  }
  return rememberCharacterSaveAccountLock(db, accountId);
}

/** Build the one UPDATE whose EXISTS clause is the character-lease fence. */
export function characterUpdateStatement(
  characterId: number,
  level: number,
  stateJson: string,
  leaseHolder: string,
  leaseNonce: string | undefined,
): { text: string; values: unknown[] } {
  return leaseNonce === undefined
    ? {
        text: 'UPDATE characters SET level = $2, state = $3, updated_at = now() WHERE id = $1',
        values: [characterId, level, stateJson],
      }
    : {
        text: `UPDATE characters SET level = $2, state = $3, updated_at = now()
            WHERE id = $1
              AND EXISTS (
                SELECT 1 FROM character_leases
                 WHERE character_id = $1 AND holder = $4 AND nonce = $5
              )`,
        values: [characterId, level, stateJson, leaseHolder, leaseNonce],
      };
}

/** Validate all cross-effect identity before a save issues its first query. */
export function prepareBankLedgerSaveEffects(
  characterId: number,
  storageEffects: readonly StorageAppliedEffect[],
  ledgerEffects: BankLedgerSaveEffects | undefined,
  allowedGuildIds: readonly number[] = [],
): BankLedgerSaveEffects | undefined {
  for (const effect of storageEffects) {
    if (
      !effect ||
      effect.realm !== REALM ||
      effect.characterId !== characterId ||
      !Number.isSafeInteger(effect.characterId) ||
      effect.characterId <= 0 ||
      !Number.isSafeInteger(effect.accountId) ||
      effect.accountId <= 0 ||
      typeof effect.itemId !== 'string' ||
      effect.itemId.length === 0 ||
      !Number.isSafeInteger(effect.expectedCostClaudium) ||
      effect.expectedCostClaudium <= 0 ||
      typeof effect.idempotencyKey !== 'string' ||
      effect.idempotencyKey.length === 0 ||
      typeof effect.spendClaimToken !== 'string' ||
      effect.spendClaimToken.length === 0 ||
      !Number.isSafeInteger(effect.purchasedSlotsBefore) ||
      effect.purchasedSlotsBefore < 0 ||
      !Number.isSafeInteger(effect.purchasedSlotsAfter) ||
      effect.purchasedSlotsAfter <= effect.purchasedSlotsBefore
    ) {
      throw new Error('storage save effect does not match the character save');
    }
  }
  if (!ledgerEffects) return undefined;
  const { owner, batches } = ledgerEffects;
  if (
    !owner ||
    !Array.isArray(batches) ||
    owner.realm !== REALM ||
    owner.characterId !== characterId ||
    !Number.isSafeInteger(owner.accountId) ||
    owner.accountId <= 0
  ) {
    throw new Error('bank ledger save owner does not match the character save');
  }
  if (
    storageEffects.some(
      (effect) =>
        effect.realm !== owner.realm ||
        effect.characterId !== owner.characterId ||
        effect.accountId !== owner.accountId,
    )
  ) {
    throw new Error('bank ledger and storage save owners do not match');
  }
  const allowedGuilds = new Set(allowedGuildIds);
  for (const batch of batches) {
    // Full receipt/sidecar validation is deliberately synchronous. This also
    // rejects an ordinary guild row without its command-owned sidecar.
    bankLedgerCommandBatchFingerprintJson(batch);
    if (!bankLedgerBatchMatchesOwner(owner, batch)) {
      throw new Error('bank ledger batch does not match the character save owner');
    }
    if (batch.guildEffect && !allowedGuilds.has(batch.guildEffect.guildId)) {
      throw new Error('bank ledger guild effect requires a matching guild bank save');
    }
    for (const row of batch.rows) {
      if (
        row.container === 'guild' &&
        row.op !== 'create_fee' &&
        row.op !== 'escrow_deficit' &&
        row.op !== 'counterparty_orphan' &&
        (row.containerId === null || !allowedGuilds.has(row.containerId))
      ) {
        throw new Error('bank ledger guild rows require a matching guild bank save');
      }
    }
  }
  return batches.length > 0 ? ledgerEffects : undefined;
}

/** Lock account parents in lifecycle order before the character UPDATE. */
export async function lockCharacterSaveEffectAccountsOnClient(
  db: Queryable,
  storageEffects: readonly StorageAppliedEffect[],
  ledgerEffects: BankLedgerSaveEffects | undefined,
  existingLock?: CharacterSaveAccountLockProof,
): Promise<void> {
  if (existingLock) {
    const state = accountLockProofs.get(existingLock);
    if (!state || state.db !== db || state.consumed) {
      throw new Error('invalid or consumed character save account lock proof');
    }
    const effectAccountIds = characterSaveEffectAccountIds(storageEffects, ledgerEffects);
    // A save without external effects needs no parent lock. Do not consume a
    // proof the helper did not rely on, although the WOC caller keeps it local.
    if (effectAccountIds.length === 0) return;
    if (effectAccountIds.length !== 1 || effectAccountIds[0] !== state.accountId) {
      throw new Error('character save account lock proof does not match save effects');
    }
    state.consumed = true;
    return;
  }
  const orderedAccountIds = characterSaveEffectAccountIds(storageEffects, ledgerEffects);
  if (orderedAccountIds.length === 0) return;
  const locked = await db.query(
    `SELECT id FROM accounts
      WHERE id = ANY($1::int[])
      ORDER BY id
      FOR KEY SHARE`,
    [orderedAccountIds],
  );
  const lockedIds = locked.rows.map((row) => Number(row.id));
  if (
    lockedIds.length !== orderedAccountIds.length ||
    lockedIds.some((accountId, index) => accountId !== orderedAccountIds[index])
  ) {
    throw new Error('character save account disappeared before parent lock');
  }
}

/** Persist the already-validated exact prefix inside the caller's transaction. */
export async function writeBankLedgerSaveEffectsOnClient(
  db: Queryable,
  effects: BankLedgerSaveEffects | undefined,
): Promise<BankLedgerBatchWriteResult> {
  if (effects) return writeBankLedgerCommandBatches(db, effects.owner, effects.batches);
  return Object.freeze({ batches: Object.freeze([]), alreadyCommittedPrefix: Object.freeze([]) });
}
