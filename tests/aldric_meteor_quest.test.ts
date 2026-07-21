import { describe, expect, it } from 'vitest';
import { GROUND_OBJECTS, ITEMS, NPCS, QUESTS, questRewardItemId } from '../src/sim/data';
import { Sim } from '../src/sim/sim';
import type { Entity, SimEvent } from '../src/sim/types';

const QUEST_ID = 'q_aldrics_fallen_star';
const METEOR_ITEM_ID = 'unknown_alien_weaponry';
const REWARD_ITEM_ID = 'alien_armor_plate';
const RETURNED_CHROMA_ITEM_ID = 'amber_crimson_armor_plate';

type SkinEvent = Extract<SimEvent, { type: 'skinEvent' }>;

function drainSkinEvent(sim: Sim): SkinEvent | undefined {
  return sim.tick().find((e): e is SkinEvent => e.type === 'skinEvent');
}

function teleportTo(sim: Sim, x: number, z: number): void {
  const pos = sim.groundPos(x, z);
  sim.player.pos = { ...pos };
  sim.player.prevPos = { ...pos };
}

function standAtMerchant(sim: Sim): void {
  const merchant = [...sim.entities.values()].find(
    (e): e is Entity => e.kind === 'npc' && e.templateId === 'the_merchant',
  );
  if (!merchant) throw new Error('merchant not found');
  teleportTo(sim, merchant.pos.x, merchant.pos.z);
}

describe('Brother Aldric fallen star quest', () => {
  it('keeps existing accepted players able to finish and claim the mech cosmetic roll', () => {
    const quest = QUESTS[QUEST_ID];
    expect(quest).toBeTruthy();
    expect(quest).toMatchObject({ retired: true });
    expect(quest.giverNpcId).toBe('brother_aldric_fen');
    expect(quest.turnInNpcId).toBe('brother_aldric_fen');
    expect(quest.objectives).toEqual([
      { type: 'collect', itemId: METEOR_ITEM_ID, count: 1, label: 'Unknown Alien Weaponry' },
    ]);
    expect(NPCS.brother_aldric_fen.questIds).toContain(QUEST_ID);
    expect(ITEMS[METEOR_ITEM_ID]?.questId).toBe(QUEST_ID);
    expect(ITEMS[REWARD_ITEM_ID]?.kind).toBe('tool');
    expect(ITEMS[REWARD_ITEM_ID]?.name).toBe('Alien Armor Plate');
    expect(ITEMS[REWARD_ITEM_ID]?.quality).toBe('rare');
    expect(ITEMS[REWARD_ITEM_ID]?.use).toEqual({ type: 'skinSelect', catalog: 'mech' });
    expect(ITEMS[REWARD_ITEM_ID]?.noVendorSell).toBe(true);
    expect(ITEMS[REWARD_ITEM_ID]?.noDiscard).toBe(true);
    expect(ITEMS[REWARD_ITEM_ID]?.noMarketList).toBe(true);
    expect(ITEMS[RETURNED_CHROMA_ITEM_ID]?.name).toBe('Amber Crimson');
    expect(ITEMS[RETURNED_CHROMA_ITEM_ID]?.quality).toBe('uncommon');
    expect(ITEMS[RETURNED_CHROMA_ITEM_ID]?.use).toEqual({
      type: 'mechChroma',
      chromaId: 'amber_crimson',
    });
    expect(questRewardItemId(quest, 'warrior')).toBe(REWARD_ITEM_ID);

    const meteorObjectDef = GROUND_OBJECTS.find((obj) => obj.itemId === METEOR_ITEM_ID);
    expect(meteorObjectDef).toBeTruthy();
    expect(
      meteorObjectDef!.positions.some((pos) => Math.hypot(pos.x - 152, pos.z - 294) <= 8),
    ).toBe(true);

    const sim = new Sim({
      seed: 20061,
      playerClass: 'warrior',
      playerName: 'Reuben',
      autoEquip: false,
    });
    sim.player.level = 8;

    const aldric = [...sim.entities.values()].find(
      (e) => e.kind === 'npc' && e.templateId === 'brother_aldric_fen',
    );
    expect(aldric).toBeTruthy();
    teleportTo(sim, aldric!.pos.x + 1, aldric!.pos.z);

    sim.questLog.set(QUEST_ID, { questId: QUEST_ID, counts: [0], state: 'active' });
    expect(sim.questState(QUEST_ID)).toBe('active');

    const meteorObject = [...sim.entities.values()].find(
      (e) => e.kind === 'object' && e.objectItemId === METEOR_ITEM_ID,
    );
    expect(meteorObject).toBeTruthy();
    teleportTo(sim, meteorObject!.pos.x + 1, meteorObject!.pos.z);

    sim.pickUpObject(meteorObject!.id);
    expect(sim.countItem(METEOR_ITEM_ID)).toBe(1);
    expect(sim.questState(QUEST_ID)).toBe('ready');

    teleportTo(sim, aldric!.pos.x + 1, aldric!.pos.z);
    sim.turnInQuest(QUEST_ID);

    expect(sim.questState(QUEST_ID)).toBe('done');
    expect(sim.countItem(METEOR_ITEM_ID)).toBe(0);
    expect(sim.countItem(REWARD_ITEM_ID)).toBe(1);

    sim.useItem(REWARD_ITEM_ID);
    const roll = drainSkinEvent(sim);
    expect(roll?.catalog).toBe('mech');
    expect(sim.countItem(REWARD_ITEM_ID)).toBe(1);
    expect(sim.accountCosmetics.mechChromaIds).not.toContain('amber_crimson');
    expect(sim.player.skinCatalog).not.toBe('mech');

    const claim = sim.claimEventSkin(0);
    expect(claim).toEqual({ catalog: 'mech', skin: 0, chromaId: 'amber_crimson' });
    expect(sim.accountCosmetics.mechChromaIds).toContain('amber_crimson');
    expect(sim.player.skinCatalog).toBe('mech');
    expect(sim.countItem(REWARD_ITEM_ID)).toBe(0);
    expect(sim.equipment.chest).not.toBe(REWARD_ITEM_ID);
  });

  it('is retired for fresh players while preserving existing ready turn-ins', () => {
    expect(QUESTS[QUEST_ID].minLevel).toBe(5);
    expect(QUESTS[QUEST_ID]).toMatchObject({ retired: true });

    const sim = new Sim({
      seed: 20061,
      playerClass: 'warrior',
      playerName: 'Reuben',
      autoEquip: false,
    });
    const aldric = [...sim.entities.values()].find(
      (e) => e.kind === 'npc' && e.templateId === 'brother_aldric_fen',
    );
    expect(aldric).toBeTruthy();
    teleportTo(sim, aldric!.pos.x + 1, aldric!.pos.z);

    sim.setPlayerLevel(5);
    expect(sim.questState(QUEST_ID)).toBe('unavailable');
    sim.acceptQuest(QUEST_ID);
    expect(sim.questLog.has(QUEST_ID)).toBe(false);
    expect(sim.questState(QUEST_ID)).toBe('unavailable');

    sim.talkToNpc(aldric!.id);
    expect(sim.questLog.has(QUEST_ID)).toBe(false);

    sim.questLog.set(QUEST_ID, { questId: QUEST_ID, counts: [1], state: 'ready' });
    sim.addItem(METEOR_ITEM_ID, 1);
    expect(sim.questState(QUEST_ID)).toBe('ready');

    sim.turnInQuest(QUEST_ID);
    expect(sim.questState(QUEST_ID)).toBe('done');
    expect(sim.countItem(METEOR_ITEM_ID)).toBe(0);
    expect(sim.countItem(REWARD_ITEM_ID)).toBe(1);
  });

  it('keeps the cosmetic item out of vendor sell, destroy, and market flows while allowing trade', () => {
    const sim = new Sim({ seed: 20061, playerClass: 'warrior', playerName: 'Seller' });
    sim.addItem(REWARD_ITEM_ID, 1);

    standAtMerchant(sim);
    sim.sellItem(REWARD_ITEM_ID);
    expect(sim.countItem(REWARD_ITEM_ID)).toBe(1);
    expect(sim.vendorBuyback.some((s) => s.itemId === REWARD_ITEM_ID)).toBe(false);

    sim.discardItem(REWARD_ITEM_ID);
    expect(sim.countItem(REWARD_ITEM_ID)).toBe(1);

    sim.marketList(REWARD_ITEM_ID, 1, 100);
    expect(sim.countItem(REWARD_ITEM_ID)).toBe(1);
    expect(sim.marketListings.find((l) => l.itemId === REWARD_ITEM_ID)).toBeUndefined();

    const buyer = sim.addPlayer('mage', 'Buyer');
    teleportTo(sim, sim.player.pos.x + 1, sim.player.pos.z);
    const buyerPos = sim.groundPos(sim.player.pos.x + 2, sim.player.pos.z);
    sim.entities.get(buyer)!.pos = { ...buyerPos };
    sim.entities.get(buyer)!.prevPos = { ...buyerPos };
    sim.tradeRequest(buyer);
    sim.tradeAccept(buyer);
    sim.tradeSetOffer([{ itemId: REWARD_ITEM_ID, count: 1 }], 0);
    expect(sim.tradeFor(sim.playerId)?.offerA.items).toEqual([
      { itemId: REWARD_ITEM_ID, count: 1 },
    ]);
  });
});
