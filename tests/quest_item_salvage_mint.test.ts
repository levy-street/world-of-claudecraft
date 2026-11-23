// A quest's requiredItems are re-granted free whenever the player no longer holds a copy
// (quest_fallback.ts on accept, regrantMissingQuestItems on giver re-talk). Any of them
// that salvage or disenchant would accept is therefore an unbounded material mint: break
// it down, talk to the giver, break the new one. Skerrit's Shardpike was exactly that, a
// rare weapon handed out by q_socketwrights_due.
//
// The sweep covers every shipped quest, so a future quest that hands out real gear
// through requiredItems has to close the breakdown path (noSalvage, lentGear) too.
import { describe, expect, it } from 'vitest';
import { ITEMS, QUESTS } from '../src/sim/data';
import { isDisenchantable } from '../src/sim/professions/enchanting';
import { isSalvageable } from '../src/sim/professions/salvage';

describe('re-granted quest items never break down', () => {
  it("Skerrit's Shardpike is neither salvageable nor disenchantable", () => {
    const def = ITEMS.skerrits_shardpike;
    expect(def?.noSalvage).toBe(true);
    expect(isSalvageable(def)).toBe(false);
    expect(isDisenchantable(def)).toBe(false);
  });

  it('no quest re-grants an item salvage or disenchant would accept', () => {
    const minted: string[] = [];
    for (const quest of Object.values(QUESTS)) {
      for (const itemId of quest.requiredItems ?? []) {
        const def = ITEMS[itemId];
        if (isSalvageable(def) || isDisenchantable(def)) minted.push(`${quest.id}: ${itemId}`);
      }
    }
    expect(minted).toEqual([]);
  });
});
