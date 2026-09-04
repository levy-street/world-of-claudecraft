// Atomic offline legendary-name moderation. Audit is recorded by the caller
// before entering the shared fresh-blob mutation transaction.
import {
  type ClearItemNameOutcome,
  type ClearItemNameTarget,
  stripLegendaryNames,
} from './clear_item_name';
import { mutateOfflineCharacterState } from './offline_character_mutation_db';
import type { BoundedTransactionRunner } from './offline_character_save_db';

export async function clearOfflineItemName(
  characterId: number,
  target: ClearItemNameTarget,
  runTransaction?: BoundedTransactionRunner,
): Promise<ClearItemNameOutcome> {
  const result = await mutateOfflineCharacterState(
    characterId,
    (state) => stripLegendaryNames(state, target),
    runTransaction,
  );
  if (!result.ok) return result;
  return result.changed > 0
    ? { ok: true, cleared: result.changed }
    : { ok: false, error: 'no named copy matched that target' };
}
