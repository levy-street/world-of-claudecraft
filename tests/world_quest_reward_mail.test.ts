// The full-bags grant rule for world quest reward items
// (src/sim/world_quest_reward_mail.ts): an item that fits lands in the bags,
// one that does not rides a Ravenpost reward letter instead of being lost or
// forced past the bag capacity, and one event names every mailed item so the
// HUD can pop the banner. Driven through the real Sim, PostOffice and the
// awardWorldQuest bundle for the fixed-extra arm.
import { describe, expect, it } from 'vitest';
import { bagPools, canAddItem } from '../src/sim/bags';
import { WORLD_QUEST_REWARD_LETTER } from '../src/sim/content/letters';
import { WORLD_QUESTS_BY_ID } from '../src/sim/content/world_quests';
import { ITEMS } from '../src/sim/data';
import { MAIL_MAX_ATTACHMENTS } from '../src/sim/mail/post_office';
import { type PlayerMeta, Sim } from '../src/sim/sim';
import type { SimEvent } from '../src/sim/types';
import { grantWorldQuestRewardItems } from '../src/sim/world_quest_reward_mail';
import { awardWorldQuest } from '../src/sim/world_quests';
import { EMPTY_TEST_WORLD } from './sim_shared';

const STACKABLE = 'rift_essence';

function makeSim(): Sim {
  const sim = new Sim({ seed: 7, playerClass: 'warrior', world: EMPTY_TEST_WORLD });
  sim.drainEvents();
  return sim;
}

function metaOf(sim: Sim): PlayerMeta {
  const meta = sim.players.get(sim.playerId);
  if (!meta) throw new Error('Missing player meta');
  return meta;
}

/** Unstackable filler until not even one more `itemId` fits. */
function fillBags(meta: PlayerMeta, itemId: string): void {
  const filler = Object.values(ITEMS).find(
    (item) => item.id !== itemId && item.kind === 'armor' && !!item.slot,
  );
  if (!filler) throw new Error('No filler item');
  while (canAddItem(meta.inventory, bagPools(meta.bags), itemId, 1))
    meta.inventory.push({ itemId: filler.id, count: 1 });
}

function rewardLetters(sim: Sim) {
  return sim.postOffice.mail.filter((m) => m.letterId === WORLD_QUEST_REWARD_LETTER.letterId);
}

function mailedEvents(events: SimEvent[]) {
  return events.filter((ev) => ev.type === 'worldQuestRewardMailed');
}

describe('grantWorldQuestRewardItems', () => {
  it('bags an item that fits and books nothing', () => {
    const sim = makeSim();
    const mailed = grantWorldQuestRewardItems(sim.ctx, metaOf(sim), [
      { itemId: STACKABLE, count: 2 },
    ]);
    expect(mailed).toEqual([]);
    expect(sim.countItem(STACKABLE)).toBe(2);
    expect(rewardLetters(sim)).toHaveLength(0);
    expect(mailedEvents(sim.drainEvents())).toHaveLength(0);
  });

  it('mails an item the full bags cannot hold, as an instant system letter that never expires', () => {
    const sim = makeSim();
    const meta = metaOf(sim);
    fillBags(meta, STACKABLE);
    const inventoryBefore = meta.inventory.length;
    const mailed = grantWorldQuestRewardItems(sim.ctx, meta, [{ itemId: STACKABLE, count: 2 }]);
    expect(mailed).toEqual([STACKABLE]);
    expect(sim.countItem(STACKABLE)).toBe(0);
    expect(meta.inventory.length).toBe(inventoryBefore);
    const letters = rewardLetters(sim);
    expect(letters).toHaveLength(1);
    const [letter] = letters;
    expect(letter.kind).toBe('system');
    expect(letter.recipientKey).toBe(sim.postOffice.mailKeyFor(meta));
    expect(letter.items.map((s) => ({ itemId: s.itemId, count: s.count }))).toEqual([
      { itemId: STACKABLE, count: 2 },
    ]);
    expect(letter.deliverAt).toBe(sim.ctx.time);
    expect(letter.expiresAt).toBe(Number.POSITIVE_INFINITY);
    expect(mailedEvents(sim.drainEvents())).toEqual([
      { type: 'worldQuestRewardMailed', itemIds: [STACKABLE], pid: sim.playerId },
    ]);
  });

  it('checks capacity per item in order, so only the overflow is mailed', () => {
    const sim = makeSim();
    const meta = metaOf(sim);
    const gear = Object.values(ITEMS).filter((item) => item.kind === 'weapon' && !!item.slot);
    const [first, second] = gear;
    fillBags(meta, first.id);
    meta.inventory.pop(); // exactly one free slot
    const mailed = grantWorldQuestRewardItems(sim.ctx, meta, [
      { itemId: first.id, count: 1 },
      { itemId: second.id, count: 1 },
    ]);
    expect(mailed).toEqual([second.id]);
    expect(sim.countItem(first.id)).toBe(1);
    expect(sim.countItem(second.id)).toBe(0);
    expect(rewardLetters(sim).map((m) => m.items.map((s) => s.itemId))).toEqual([[second.id]]);
  });

  it('splits a large overflow across letters of at most MAIL_MAX_ATTACHMENTS, under one event', () => {
    const sim = makeSim();
    const meta = metaOf(sim);
    const gear = Object.values(ITEMS)
      .filter((item) => item.kind === 'weapon' && !!item.slot)
      .slice(0, MAIL_MAX_ATTACHMENTS + 1)
      .map((item) => item.id);
    fillBags(meta, gear[0]);
    const mailed = grantWorldQuestRewardItems(
      sim.ctx,
      meta,
      gear.map((itemId) => ({ itemId, count: 1 })),
    );
    expect(mailed).toEqual(gear);
    expect(rewardLetters(sim).map((m) => m.items.map((s) => s.itemId))).toEqual([
      gear.slice(0, MAIL_MAX_ATTACHMENTS),
      gear.slice(MAIL_MAX_ATTACHMENTS),
    ]);
    expect(mailedEvents(sim.drainEvents())).toEqual([
      { type: 'worldQuestRewardMailed', itemIds: gear, pid: sim.playerId },
    ]);
  });
});

describe('collecting a mailed reward', () => {
  it('survives a save/load of the mail book and is taken at a raven pillar once there is room', () => {
    const sim = new Sim({ seed: 7, playerClass: 'warrior' });
    const meta = metaOf(sim);
    fillBags(meta, STACKABLE);
    grantWorldQuestRewardItems(sim.ctx, meta, [{ itemId: STACKABLE, count: 2 }]);
    sim.postOffice.loadMail(JSON.parse(JSON.stringify(sim.postOffice.serializeMail())));
    const [letter] = rewardLetters(sim);
    expect(letter.items.map((s) => [s.itemId, s.count])).toEqual([[STACKABLE, 2]]);
    const box = sim.entities.get(sim.postOffice.mailboxIds[0]);
    if (!box) throw new Error('Missing mailbox');
    sim.player.pos = { ...box.pos };
    sim.player.prevPos = { ...box.pos };
    sim.rebucket(sim.player);
    meta.inventory.pop(); // make room
    sim.mailTake(letter.id, sim.playerId);
    expect(sim.countItem(STACKABLE)).toBe(2);
    expect(rewardLetters(sim)[0]?.items ?? []).toEqual([]);
  });
});

describe('awardWorldQuest with full bags', () => {
  it("mails the quest's fixed extra instead of forcing it past the bag capacity", () => {
    const quest = WORLD_QUESTS_BY_ID.wq_drakelands_brood;
    expect(quest.reward?.extraItem).toEqual({ itemId: STACKABLE, count: 1 });
    const sim = makeSim();
    const meta = metaOf(sim);
    fillBags(meta, STACKABLE);
    const inventoryBefore = meta.inventory.length;
    awardWorldQuest(sim.ctx, meta, quest);
    expect(sim.countItem(STACKABLE)).toBe(0);
    expect(meta.inventory.length).toBe(inventoryBefore);
    expect(
      rewardLetters(sim).map((m) => m.items.map((s) => ({ itemId: s.itemId, count: s.count }))),
    ).toEqual([[{ itemId: STACKABLE, count: 1 }]]);
    expect(mailedEvents(sim.drainEvents())).toEqual([
      { type: 'worldQuestRewardMailed', itemIds: [STACKABLE], pid: sim.playerId },
    ]);
  });

  it('still bags the fixed extra when there is room', () => {
    const quest = WORLD_QUESTS_BY_ID.wq_drakelands_brood;
    const sim = makeSim();
    awardWorldQuest(sim.ctx, metaOf(sim), quest);
    expect(sim.countItem(STACKABLE)).toBe(1);
    expect(rewardLetters(sim)).toHaveLength(0);
  });
});
