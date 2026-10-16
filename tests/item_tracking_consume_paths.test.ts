// The remaining ends of a tracked copy (docs/design/item-tracking.md
// "Lineage"): the paths beyond the professions verbs that spend an epic or
// legendary copy each write its final `consume` ledger row (the server-only
// itemTracked event), and the $WOC escrow extract writes a `transfer` row
// instead, since that copy lives on. Every case drives the real Sim verb
// (quest turn-in and abandon, item use, the skin claim, charm slotting, the
// broker extract), never a hand-emitted event; the server rows the
// character-delete purges write are pinned in
// tests/server/character_purge_item_ledger.test.ts.
import { afterEach, describe, expect, it } from 'vitest';
import { TREASURE_CASKET_ITEM_ID } from '../src/sim/content/clue_hunts';
import { EVENT_SKIN_TIERS, EVENT_SKIN_TOKEN_ID } from '../src/sim/content/skins';
import { ITEMS, QUESTS } from '../src/sim/data';
import { isItemGuid } from '../src/sim/item_provenance';
import { isTrackedItem } from '../src/sim/item_tracking';
import { turnInQuestCore } from '../src/sim/quests/quest_commands';
import { type PlayerMeta, Sim } from '../src/sim/sim';
import type { ItemDef, SimEvent } from '../src/sim/types';

type ItemTrackedEvent = Extract<SimEvent, { type: 'itemTracked' }>;

const RAID_EPIC = 'crownforged_dreadhelm'; // epic armor: a collect target here
const TRADABLE_EPIC = 'duskforged_warblade'; // epic, market-listable: the escrow copy
const CHROMA_PLATE = 'imperial_crimson_armor_plate'; // epic mech chroma plate
const CHARM = 'makers_charm'; // epic tool-effect charm
const PICK = 'arcanite_mining_pick'; // the mining tool the slot needs

// Throwaway fixtures, registered per case and always removed (the
// tests/craft_from_vault.test.ts synthetic-quest idiom).
const TEST_QUEST = '__tracked_consume_quest';
const TEST_RELIC = '__tracked_quest_relic'; // the quest's own required item
const TEST_FOOD = '__tracked_epic_bread'; // a tracked consumable for the generic arm

afterEach(() => {
  delete QUESTS[TEST_QUEST];
  delete ITEMS[TEST_RELIC];
  delete ITEMS[TEST_FOOD];
});

function makeSim(seed = 42): Sim {
  return new Sim({
    seed,
    playerClass: 'warrior',
    autoEquip: false,
    lockoutNowMs: () => 1_700_000_000_000,
  });
}

function playerOf(sim: Sim): { meta: PlayerMeta; pid: number } {
  const pid = sim.playerId;
  const meta = sim.players.get(pid);
  if (!meta) throw new Error('player missing');
  return { meta, pid };
}

function trackedEvents(events: SimEvent[]): ItemTrackedEvent[] {
  return events.filter((e): e is ItemTrackedEvent => e.type === 'itemTracked');
}

function rowsOfKind(sim: Sim, kind: ItemTrackedEvent['kind']): ItemTrackedEvent[] {
  return trackedEvents(sim.drainEvents()).filter((e) => e.kind === kind);
}

/** The one tracked copy of `itemId` in the bags, with its guid. */
function guidOf(meta: PlayerMeta, itemId: string): string {
  const slots = meta.inventory.filter((s) => s.itemId === itemId);
  expect(slots).toHaveLength(1);
  const guid = slots[0].instance?.guid;
  if (!isItemGuid(guid)) throw new Error(`${itemId} carries no guid`);
  return guid;
}

function registerQuest(overrides: Partial<(typeof QUESTS)[string]>): void {
  QUESTS[TEST_QUEST] = { ...QUESTS.q_widows, id: TEST_QUEST, ...overrides };
}

function registerRelic(): void {
  ITEMS[TEST_RELIC] = {
    id: TEST_RELIC,
    name: 'Tracked Quest Relic',
    kind: 'quest',
    quality: 'epic',
    questId: TEST_QUEST,
    stackSize: 1,
    sellValue: 0,
  } as ItemDef;
}

function registerFood(): void {
  ITEMS[TEST_FOOD] = {
    ...ITEMS.baked_bread,
    id: TEST_FOOD,
    quality: 'epic',
    stackSize: 1,
  } as ItemDef;
}

describe('fixtures are tracked', () => {
  it('every copy this suite spends is an epic one-per-slot def', () => {
    registerRelic();
    registerFood();
    for (const id of [
      RAID_EPIC,
      TRADABLE_EPIC,
      CHROMA_PLATE,
      CHARM,
      EVENT_SKIN_TOKEN_ID,
      TREASURE_CASKET_ITEM_ID,
      TEST_RELIC,
      TEST_FOOD,
    ]) {
      expect(isTrackedItem(ITEMS[id]), id).toBe(true);
    }
  });
});

describe('quest turn-in and required-item removal', () => {
  it('a handed-in collect copy writes one consume row naming the quest', () => {
    const sim = makeSim();
    const { meta, pid } = playerOf(sim);
    meta.inventory = [];
    registerQuest({
      objectives: [{ type: 'collect', itemId: RAID_EPIC, count: 1, label: 'Helm' }],
    });
    sim.addItem(RAID_EPIC, 1, pid);
    const guid = guidOf(meta, RAID_EPIC);
    meta.questLog.set(TEST_QUEST, { questId: TEST_QUEST, counts: [1], state: 'ready' });
    sim.drainEvents();
    expect(turnInQuestCore(sim.ctx, TEST_QUEST, QUESTS[TEST_QUEST], meta)).toBe(true);
    expect(sim.countItem(RAID_EPIC, pid)).toBe(0);
    const rows = rowsOfKind(sim, 'consume');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      guid,
      itemId: RAID_EPIC,
      source: 'questTurnIn',
      detail: TEST_QUEST,
      pid,
    });
  });

  it('an ownership turn-in keeps the copy and writes nothing', () => {
    const sim = makeSim();
    const { meta, pid } = playerOf(sim);
    meta.inventory = [];
    registerQuest({
      keepsCollectedItems: true,
      objectives: [{ type: 'collect', itemId: RAID_EPIC, count: 1, label: 'Helm' }],
    });
    sim.addItem(RAID_EPIC, 1, pid);
    meta.questLog.set(TEST_QUEST, { questId: TEST_QUEST, counts: [1], state: 'ready' });
    sim.drainEvents();
    expect(turnInQuestCore(sim.ctx, TEST_QUEST, QUESTS[TEST_QUEST], meta)).toBe(true);
    expect(sim.countItem(RAID_EPIC, pid)).toBe(1);
    expect(rowsOfKind(sim, 'consume')).toHaveLength(0);
  });

  it('the quest-owned required item stripped at turn-in writes a questTurnIn row', () => {
    const sim = makeSim();
    const { meta, pid } = playerOf(sim);
    meta.inventory = [];
    registerRelic();
    registerQuest({ objectives: [], requiredItems: [TEST_RELIC] });
    sim.addItem(TEST_RELIC, 1, pid);
    const guid = guidOf(meta, TEST_RELIC);
    meta.questLog.set(TEST_QUEST, { questId: TEST_QUEST, counts: [], state: 'ready' });
    sim.drainEvents();
    expect(turnInQuestCore(sim.ctx, TEST_QUEST, QUESTS[TEST_QUEST], meta)).toBe(true);
    expect(sim.countItem(TEST_RELIC, pid)).toBe(0);
    const rows = rowsOfKind(sim, 'consume');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ guid, source: 'questTurnIn', detail: TEST_QUEST });
  });

  it('abandoning the quest strips the required item with a questAbandon row', () => {
    const sim = makeSim();
    const { meta, pid } = playerOf(sim);
    meta.inventory = [];
    registerRelic();
    registerQuest({ objectives: [], requiredItems: [TEST_RELIC] });
    sim.addItem(TEST_RELIC, 1, pid);
    const guid = guidOf(meta, TEST_RELIC);
    meta.questLog.set(TEST_QUEST, { questId: TEST_QUEST, counts: [], state: 'active' });
    sim.drainEvents();
    sim.abandonQuest(TEST_QUEST, pid);
    expect(meta.questLog.has(TEST_QUEST)).toBe(false);
    expect(sim.countItem(TEST_RELIC, pid)).toBe(0);
    const rows = rowsOfKind(sim, 'consume');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ guid, source: 'questAbandon', detail: TEST_QUEST });
  });
});

describe('item use', () => {
  it('opening the Treasure Casket writes ONE row naming the payout', () => {
    const sim = makeSim();
    const { meta, pid } = playerOf(sim);
    meta.inventory = [];
    sim.addItem(TREASURE_CASKET_ITEM_ID, 1, pid);
    const guid = guidOf(meta, TREASURE_CASKET_ITEM_ID);
    sim.drainEvents();
    sim.useItem(TREASURE_CASKET_ITEM_ID, pid);
    const events = sim.drainEvents();
    const opened = events.find(
      (e): e is Extract<SimEvent, { type: 'clueCasketOpened' }> => e.type === 'clueCasketOpened',
    );
    if (!opened) throw new Error('the casket did not open');
    expect(sim.countItem(TREASURE_CASKET_ITEM_ID, pid)).toBe(0);
    // Exactly one consume row: the casket's own, never the generic use row too.
    const rows = trackedEvents(events).filter((e) => e.kind === 'consume');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      guid,
      itemId: TREASURE_CASKET_ITEM_ID,
      source: 'casketOpen',
      detail: opened.itemIds.join(','),
    });
  });

  it('the casket row draws no rng: the payout matches a twin Sim with no tracked copy', () => {
    const tracked = makeSim(7);
    const twin = makeSim(7);
    for (const sim of [tracked, twin]) {
      const { meta } = playerOf(sim);
      meta.inventory = [];
    }
    tracked.addItem(TREASURE_CASKET_ITEM_ID, 1, tracked.playerId);
    // The twin's copy has its identity stripped: same open, no ledger row.
    twin.addItem(TREASURE_CASKET_ITEM_ID, 1, twin.playerId);
    const twinSlot = playerOf(twin).meta.inventory[0];
    twinSlot.instance = undefined;
    for (const sim of [tracked, twin]) {
      sim.drainEvents();
      sim.useItem(TREASURE_CASKET_ITEM_ID, sim.playerId);
    }
    const payout = (sim: Sim) =>
      sim.drainEvents().find((e) => e.type === 'clueCasketOpened') as
        | Extract<SimEvent, { type: 'clueCasketOpened' }>
        | undefined;
    expect(payout(tracked)?.itemIds).toEqual(payout(twin)?.itemIds);
    expect(tracked.rng.next()).toBe(twin.rng.next());
  });

  it('the generic consumable arm writes a use row (the bag-walk removal)', () => {
    registerFood();
    const sim = makeSim();
    const { meta, pid } = playerOf(sim);
    meta.inventory = [];
    sim.addItem(TEST_FOOD, 1, pid);
    const guid = guidOf(meta, TEST_FOOD);
    sim.drainEvents();
    sim.useItem(TEST_FOOD, pid);
    expect(sim.countItem(TEST_FOOD, pid)).toBe(0);
    const rows = rowsOfKind(sim, 'consume');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ guid, itemId: TEST_FOOD, source: 'use', detail: 'food' });
  });

  it('the generic consumable arm writes a use row (the selected-slot removal)', () => {
    registerFood();
    const sim = makeSim();
    const { meta, pid } = playerOf(sim);
    meta.inventory = [];
    sim.addItem('linen_scrap', 2, pid);
    sim.addItem(TEST_FOOD, 1, pid);
    const guid = guidOf(meta, TEST_FOOD);
    const index = meta.inventory.findIndex((s) => s.itemId === TEST_FOOD);
    sim.drainEvents();
    sim.useItem(TEST_FOOD, pid, index);
    expect(sim.countItem(TEST_FOOD, pid)).toBe(0);
    const rows = rowsOfKind(sim, 'consume');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ guid, source: 'use', detail: 'food' });
  });

  it('a refused use (already eating) spends nothing and writes nothing', () => {
    registerFood();
    const sim = makeSim();
    const { meta, pid } = playerOf(sim);
    meta.inventory = [];
    sim.addItem(TEST_FOOD, 2, pid);
    sim.useItem(TEST_FOOD, pid);
    sim.drainEvents();
    sim.useItem(TEST_FOOD, pid);
    expect(sim.countItem(TEST_FOOD, pid)).toBe(1);
    expect(rowsOfKind(sim, 'consume')).toHaveLength(0);
  });

  it('a mech chroma plate writes a mechChroma row naming the chroma', () => {
    const sim = makeSim();
    const { meta, pid } = playerOf(sim);
    meta.inventory = [];
    sim.addItem(CHROMA_PLATE, 1, pid);
    const guid = guidOf(meta, CHROMA_PLATE);
    const def = ITEMS[CHROMA_PLATE];
    if (def.use?.type !== 'mechChroma') throw new Error('not a chroma plate');
    sim.drainEvents();
    expect(sim.useItem(CHROMA_PLATE, pid)).toEqual({
      type: 'mechChroma',
      chromaId: def.use.chromaId,
    });
    expect(sim.countItem(CHROMA_PLATE, pid)).toBe(0);
    const rows = rowsOfKind(sim, 'consume');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ guid, source: 'mechChroma', detail: def.use.chromaId });
  });
});

describe('the skin-select token claim', () => {
  function withPendingToken(catalog: 'class' | 'mech'): { sim: Sim; guid: string } {
    const sim = makeSim();
    const { meta, pid } = playerOf(sim);
    meta.inventory = [];
    sim.addItem(EVENT_SKIN_TOKEN_ID, 1, pid);
    const guid = guidOf(meta, EVENT_SKIN_TOKEN_ID);
    meta.pendingSkinRank = 'epic';
    meta.pendingSkinCatalog = catalog;
    meta.pendingSkinItemId = EVENT_SKIN_TOKEN_ID;
    sim.drainEvents();
    return { sim, guid };
  }

  it('a class skin claim writes a skinToken row naming the skin', () => {
    const { sim, guid } = withPendingToken('class');
    const skin = EVENT_SKIN_TIERS[0].skin;
    expect(sim.claimEventSkin(skin)).toEqual({ catalog: 'class', skin });
    const rows = rowsOfKind(sim, 'consume');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ guid, source: 'skinToken', detail: `class:${skin}` });
  });

  it('a mech chroma claim writes a skinToken row naming the chroma', () => {
    const { sim, guid } = withPendingToken('mech');
    const claim = sim.claimEventSkin(0);
    if (claim?.catalog !== 'mech') throw new Error('expected a mech claim');
    const rows = rowsOfKind(sim, 'consume');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      guid,
      source: 'skinToken',
      detail: `mech:${claim.chromaId}`,
    });
  });

  it('a refused claim (no pending rank) spends nothing and writes nothing', () => {
    const { sim } = withPendingToken('class');
    playerOf(sim).meta.pendingSkinRank = null;
    expect(sim.claimEventSkin(EVENT_SKIN_TIERS[0].skin)).toBeNull();
    expect(sim.countItem(EVENT_SKIN_TOKEN_ID, sim.playerId)).toBe(1);
    expect(rowsOfKind(sim, 'consume')).toHaveLength(0);
  });
});

describe('charm slotting', () => {
  it("slotting the Maker's Charm writes a charmSlot row naming the slot", () => {
    const sim = makeSim();
    const { meta, pid } = playerOf(sim);
    meta.inventory = [];
    sim.addItem(PICK, 1, pid);
    sim.addItem(CHARM, 1, pid);
    const guid = guidOf(meta, CHARM);
    sim.drainEvents();
    sim.slotToolEffect('mining', CHARM, 'always', pid);
    expect(meta.toolEffectSlots?.mining?.effectId).toBe(CHARM);
    expect(sim.countItem(CHARM, pid)).toBe(0);
    const rows = rowsOfKind(sim, 'consume');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ guid, source: 'charmSlot', detail: `mining:${CHARM}` });
  });

  it('a refused slot (no tool carried) keeps the charm and writes nothing', () => {
    const sim = makeSim();
    const { meta, pid } = playerOf(sim);
    meta.inventory = [];
    sim.addItem(CHARM, 1, pid);
    sim.drainEvents();
    sim.slotToolEffect('mining', CHARM, 'always', pid);
    expect(sim.countItem(CHARM, pid)).toBe(1);
    expect(rowsOfKind(sim, 'consume')).toHaveLength(0);
  });
});

describe('the $WOC escrow extract', () => {
  function listed(): { sim: Sim; seller: number; buyer: number; guid: string } {
    const sim = new Sim({
      seed: 42,
      playerClass: 'warrior',
      noPlayer: true,
      lockoutNowMs: () => 1_700_000_000_000,
    });
    const seller = sim.addPlayer('warrior', 'Lister', { characterId: 71 });
    const buyer = sim.addPlayer('mage', 'Buyer', { characterId: 72 });
    sim.addItem(TRADABLE_EPIC, 1, seller);
    const meta = sim.players.get(seller);
    if (!meta) throw new Error('seller missing');
    const guid = guidOf(meta, TRADABLE_EPIC);
    sim.drainEvents();
    return { sim, seller, buyer, guid };
  }

  function extract(sim: Sim, seller: number) {
    const meta = sim.players.get(seller);
    if (!meta) throw new Error('seller missing');
    const index = meta.inventory.findIndex((s) => s.itemId === TRADABLE_EPIC);
    const out = sim.extractTradableCopy(seller, { index, itemId: TRADABLE_EPIC });
    if (!out.ok) throw new Error(`extract refused: ${out.reason}`);
    return out.extracted;
  }

  it('writes a transfer row out of the seller, never a consume', () => {
    const { sim, seller, guid } = listed();
    const extracted = extract(sim, seller);
    expect(extracted.instance?.guid).toBe(guid);
    const rows = trackedEvents(sim.drainEvents());
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: 'transfer',
      guid,
      itemId: TRADABLE_EPIC,
      by: 'Lister',
      byId: 71,
      source: 'wocEscrow',
      detail: 'escrow',
      pid: seller,
    });
  });

  it('a delivery to the buyer then writes the ordinary transfer naming the buyer', () => {
    const { sim, seller, buyer, guid } = listed();
    const extracted = extract(sim, seller);
    sim.drainEvents();
    expect(sim.grantTradableCopy(buyer, extracted)).toBe(true);
    const rows = trackedEvents(sim.drainEvents());
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: 'transfer', guid, by: 'Buyer', byId: 72 });
  });

  it('a copy returned to the seller writes nothing more (the same holder)', () => {
    const { sim, seller, guid } = listed();
    const extracted = extract(sim, seller);
    sim.drainEvents();
    expect(sim.grantTradableCopy(seller, extracted)).toBe(true);
    expect(trackedEvents(sim.drainEvents())).toHaveLength(0);
    const meta = sim.players.get(seller);
    if (!meta) throw new Error('seller missing');
    expect(guidOf(meta, TRADABLE_EPIC)).toBe(guid);
  });
});
