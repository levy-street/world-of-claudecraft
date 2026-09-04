import { rekeyInstanceSigner } from '../src/sim/character_rename';
import { mutateOfflineCharacterState } from './offline_character_mutation_db';
import type { BoundedTransactionRunner } from './offline_character_save_db';

/** Read the latest signer-bearing regions inside the lock. A rename/reclaim's
 * earlier RETURNING blob may predate a completed name-moderation edit. */
export async function rekeyOfflineCharacterSigner(
  characterId: number,
  oldName: string,
  newName: string,
  runTransaction?: BoundedTransactionRunner,
): Promise<boolean> {
  const result = await mutateOfflineCharacterState(
    characterId,
    (state) => (rekeyInstanceSigner(state, oldName, newName) ? 1 : 0),
    runTransaction,
  );
  return result.ok;
}
