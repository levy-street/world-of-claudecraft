import { describe, expect, it } from 'vitest';
import { GROUND_OBJECTS, ITEMS, QUESTS } from '../src/sim/data';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';

const QUEST_ID = 'q_bastion_door';
const WARD_ITEM_ID = 'bastion_ward_stone';

function teleportTo(sim: Sim, x: number, z: number): void {
  const pos = sim.groundPos(x, z);
  sim.player.pos = { ...pos };
  sim.player.prevPos = { ...pos };
}

describe('The Sunken Bastion ward stone', () => {
  it('collects an overworld ward stone for q_bastion_door', () => {
    // The quest "The Sunken Bastion" collects the ward-stone ground object.
    const quest = QUESTS[QUEST_ID];
    expect(quest.objectives).toEqual([
      { type: 'collect', itemId: WARD_ITEM_ID, count: 1, label: 'Bastion Ward Stone' },
    ]);
    expect(ITEMS[WARD_ITEM_ID]?.questId).toBe(QUEST_ID);
    expect(GROUND_OBJECTS.find((o) => o.itemId === WARD_ITEM_ID)).toBeTruthy();

    const sim = new Sim({ seed: 20061, playerClass: 'warrior', playerName: 'Reuben', autoEquip: false });
    sim.player.level = 15;
    sim.questLog.set(QUEST_ID, { questId: QUEST_ID, counts: [0], state: 'active' });
    expect(sim.questState(QUEST_ID)).toBe('active');

    // The overworld ward stone shares its item id with the Nythraxis raid
    // wardstones. Before the fix, tryStartNythraxisWardChannel claimed the
    // interaction for ANY ward stone, even with no boss nearby, so the quest
    // pickup never ran and the objective could never be completed.
    const wardStone = [...sim.entities.values()]
      .find((e): e is Entity => e.kind === 'object' && e.objectItemId === WARD_ITEM_ID);
    expect(wardStone).toBeTruthy();
    teleportTo(sim, wardStone!.pos.x + 1, wardStone!.pos.z);

    sim.pickUpObject(wardStone!.id);

    expect(sim.countItem(WARD_ITEM_ID)).toBe(1);
    expect(sim.questState(QUEST_ID)).toBe('ready');
  });
});
