import type { PoolClient } from 'pg';
import type { CharacterState } from '../src/sim/character_state';
import { sanitizeRemovedZone1Content } from '../src/sim/removed_zone1_content';
import type { CharacterSaveAccountLockProof } from './bank_ledger_save_effects_db';
import { bankLedgerSaveEffects } from './bank_ledger_session';
import { journalCharacterSaveSources } from './character_material_sources_db';
import {
  CHARACTER_SAVE_PREIMAGE_SELECT,
  characterUpdateStatement,
  readCharacterSavePreimage,
} from './character_save_statement';
import { saveCharacterStateOnClient } from './db';
import type { DbTransactionDeadline } from './db_transaction_deadline';
import type { CharacterSaveArgs } from './woc_market_character_save';

/** The store owns the transaction, account/character locks and expired-lease cleanup.
 * Both halves retain the canonical material-source audit in that same transaction. */
export function saveReferralCharacter(
  tx: DbTransactionDeadline,
  save: CharacterSaveArgs,
  proof: CharacterSaveAccountLockProof,
): Promise<boolean> {
  return saveCharacterStateOnClient(
    tx as unknown as PoolClient,
    save.characterId,
    save.level,
    save.state,
    save.leaseNonce,
    save.storageEffects,
    save.bankLedgerSnapshot ? bankLedgerSaveEffects(save.bankLedgerSnapshot) : undefined,
    proof,
  );
}

export async function saveOfflineReferralCharacter(
  tx: DbTransactionDeadline,
  characterId: number,
  state: CharacterState,
  realm: string,
): Promise<boolean> {
  const clean = sanitizeRemovedZone1Content(state).state;
  const locked = await tx.query(
    `SELECT ${CHARACTER_SAVE_PREIMAGE_SELECT} FROM characters WHERE id=$1 AND realm=$2 FOR UPDATE`,
    [characterId, realm],
  );
  const statement = characterUpdateStatement(characterId, clean.level, JSON.stringify(clean), {
    kind: 'unleased',
    realm,
  });
  const saved = await tx.query(statement.text, statement.values);
  await journalCharacterSaveSources(
    tx,
    characterId,
    readCharacterSavePreimage(locked.rows[0]),
    saved,
    clean,
  );
  return (saved.rowCount ?? 0) > 0;
}
