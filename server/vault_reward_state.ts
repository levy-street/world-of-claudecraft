// The character-save half of a direct vault claim. The live Sim applies the
// same immutable reward only after this patched snapshot commits with its
// claim marker, so a crash cannot split the two durable facts.

import { addStacked } from '../src/sim/bags';
import type { CharacterState } from '../src/sim/character_state';
import { creditHeroicMarks, isCurrencyGrantId } from '../src/sim/heroic_marks';
import { projectHoardRewardCollections } from '../src/sim/rift/hoard_reward_save';
import type { VaultRewardClaim } from './vault_rewards_db';

export function addVaultRewardToCharacterState(
  state: CharacterState,
  claim: VaultRewardClaim,
  attemptId: string,
  owner: boolean,
): CharacterState {
  const capped = claim.items.length === 0 && claim.copper === 0;
  if (!capped) {
    // Heroic Marks land on the saved balance, exactly as the live hub credits them.
    for (const item of claim.items) {
      if (isCurrencyGrantId(item.itemId)) creditHeroicMarks(state, item.count);
      else addStacked(state.inventory, item.itemId, item.count);
    }
    projectHoardRewardCollections(state, claim.items);
    const copper = state.copper + claim.copper;
    if (!Number.isSafeInteger(copper)) throw new Error('vault reward copper overflow');
    state.copper = copper;
  }
  if (!state.worldQuests) state.worldQuests = { cycle: '', progress: [] };
  if (owner && state.worldQuests.vaultAttempt?.id === attemptId) {
    delete state.worldQuests.vaultAttempt;
  }
  if (!capped) {
    state.worldQuests.clueCasketsOpened = (state.worldQuests.clueCasketsOpened ?? 0) + 1;
  }
  return state;
}
