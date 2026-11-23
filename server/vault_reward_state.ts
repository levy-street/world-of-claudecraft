// The character-save half of a direct vault claim. The live Sim applies the
// same immutable reward only after this patched snapshot commits with its
// claim marker, so a crash cannot split the two durable facts.

import { addStacked } from '../src/sim/bags';
import type { CharacterState } from '../src/sim/character_state';
import {
  assertHeroicMarksGrantsFit,
  creditHeroicMarks,
  isCurrencyGrantId,
} from '../src/sim/heroic_marks';
import { hoardRewardGrantItems } from '../src/sim/rift/hoard_reward_items';
import { projectHoardRewardCollections } from '../src/sim/rift/hoard_reward_save';
import { cloneItemInstancePayload, type InvSlot } from '../src/sim/types';
import type { VaultRewardClaim } from './vault_rewards_db';

export function addVaultRewardToCharacterState(
  state: CharacterState,
  claim: VaultRewardClaim,
  preparedItems?: readonly InvSlot[],
): CharacterState {
  assertHeroicMarksGrantsFit(state, claim.items);
  const capped = claim.items.length === 0 && claim.copper === 0;
  if (!capped) {
    // Heroic Marks land on the saved balance, exactly as the live hub credits them.
    const grants = preparedItems ?? hoardRewardGrantItems(claim.items);
    for (const item of grants) {
      if (isCurrencyGrantId(item.itemId)) creditHeroicMarks(state, item.count);
      else {
        addStacked(
          state.inventory,
          item.itemId,
          item.count,
          item.instance ? cloneItemInstancePayload(item.instance) : undefined,
        );
      }
    }
    projectHoardRewardCollections(state, claim.items);
    const copper = state.copper + claim.copper;
    if (!Number.isSafeInteger(copper)) throw new Error('vault reward copper overflow');
    state.copper = copper;
  }
  if (!state.worldQuests) state.worldQuests = { cycle: '', progress: [] };
  if (!capped) {
    state.worldQuests.clueCasketsOpened = (state.worldQuests.clueCasketsOpened ?? 0) + 1;
  }
  return state;
}
