import { describe, expect, it, vi } from 'vitest';
import { QUESTS } from '../src/sim/data';
import { interactNpcForQuests } from '../src/sim/quest_npc_interaction';
import { checkQuestReady } from '../src/sim/quests/quest_credit';
import type { PlayerMeta } from '../src/sim/sim';
import type { SimContext } from '../src/sim/sim_context';
import type { Entity, QuestProgress, SimEvent } from '../src/sim/types';

const TALK_QUEST = 'q_hollow_the_huntsman';

function fixture(questId = TALK_QUEST) {
  const quest = QUESTS[questId];
  const progress: QuestProgress = {
    questId,
    state: 'active',
    counts: quest.objectives.map(() => 0),
  };
  const meta = {
    entityId: 7,
    questLog: new Map([[questId, progress]]),
    counters: { questProgress: 0 },
    bank: { inventory: [] },
    vault: { stock: {}, special: [] },
  } as unknown as PlayerMeta;
  const npc = { kind: 'npc', templateId: 'huntsman_deral' } as Entity;
  const events: SimEvent[] = [];
  const order: string[] = [];
  const inventory = new Map<string, number>();
  const ctx = {
    countItem: (id: string) => inventory.get(id) ?? 0,
    mailboxHoldsItem: () => false,
    marketListings: [],
    marketListingBelongsTo: () => false,
    addItem: vi.fn((id: string, count: number) => {
      inventory.set(id, (inventory.get(id) ?? 0) + count);
    }),
    emit: vi.fn((event: SimEvent) => {
      order.push(event.type);
      events.push(event);
    }),
  } as unknown as SimContext;
  ctx.checkQuestReady = vi.fn((qp, owner) => {
    order.push('checkReady');
    expect(owner).toBe(meta);
    expect(qp).toBe(progress);
    checkQuestReady(ctx, qp, owner);
  });
  return { ctx, meta, npc, progress, events, order, inventory };
}

describe('ordinary quest NPC interaction extraction', () => {
  it('credits the real huntsman objective, increments the counter and emits progress before readiness', () => {
    const { ctx, meta, npc, progress, events, order } = fixture();
    expect(QUESTS[TALK_QUEST].objectives).toEqual([
      { type: 'interact', targetNpcId: 'huntsman_deral', count: 1, label: 'Find Huntsman Deral' },
    ]);
    expect(interactNpcForQuests(ctx, npc, meta)).toBe(true);
    expect(progress).toMatchObject({ counts: [1], state: 'ready' });
    expect(meta.counters.questProgress).toBe(1);
    expect(order).toEqual(['questProgress', 'checkReady', 'questReady', 'log']);
    expect(events[0]).toEqual({
      type: 'questProgress',
      questId: TALK_QUEST,
      objectiveIndex: 0,
      current: 1,
      required: 1,
      text: 'Find Huntsman Deral: 1/1',
      pid: 7,
    });
    expect(ctx.checkQuestReady).toHaveBeenCalledExactlyOnceWith(progress, meta);
  });

  it('honors resolved objective counts, crediting once per talk and stopping at the requirement', () => {
    const { ctx, meta, npc, progress, events } = fixture();
    progress.resolvedCounts = [2];
    expect(interactNpcForQuests(ctx, npc, meta)).toBe(true);
    expect(progress).toMatchObject({ state: 'active', counts: [1] });
    expect(events[0]).toMatchObject({ current: 1, required: 2, text: 'Find Huntsman Deral: 1/2' });
    expect(interactNpcForQuests(ctx, npc, meta)).toBe(true);
    expect(progress).toMatchObject({ state: 'ready', counts: [2] });
    expect(interactNpcForQuests(ctx, npc, meta)).toBe(false);
    expect(meta.counters.questProgress).toBe(2);
    expect(ctx.checkQuestReady).toHaveBeenCalledTimes(2);
  });

  it.each(['ready', 'saturated', 'wrong-npc', 'kill-objective', 'empty-log'] as const)(
    'leaves %s unchanged without events, counters or readiness callbacks',
    (mode) => {
      const { ctx, meta, npc, progress, events } = fixture(
        mode === 'kill-objective' ? 'q_wolves' : TALK_QUEST,
      );
      if (mode === 'ready') progress.state = 'ready';
      if (mode === 'saturated') progress.counts[0] = 1;
      if (mode === 'wrong-npc') npc.templateId = 'provisioner_fenna';
      if (mode === 'empty-log') meta.questLog.clear();
      const before = structuredClone(progress);
      expect(interactNpcForQuests(ctx, npc, meta)).toBe(false);
      expect(progress).toEqual(before);
      expect(events).toEqual([]);
      expect(meta.counters.questProgress).toBe(0);
      expect(ctx.checkQuestReady).not.toHaveBeenCalled();
    },
  );

  it('regrants a truly missing firebottle without falsely crediting the object objective', () => {
    const { ctx, meta, npc, progress, inventory, events } = fixture('q_deepfen_purge');
    npc.templateId = 'warden_fenwick';
    expect(interactNpcForQuests(ctx, npc, meta)).toBe(false);
    expect(ctx.addItem).toHaveBeenCalledExactlyOnceWith('firebottle', 1, 7);
    expect(inventory.get('firebottle')).toBe(1);
    expect(events).toEqual([
      { type: 'log', text: 'You recover a quest item you were missing.', color: '#ff0', pid: 7 },
    ]);
    expect(progress).toMatchObject({ state: 'active', counts: [0] });
    expect(meta.counters.questProgress).toBe(0);
    expect(ctx.checkQuestReady).not.toHaveBeenCalled();
    interactNpcForQuests(ctx, npc, meta);
    expect(ctx.addItem).toHaveBeenCalledTimes(1);
    expect(events).toHaveLength(1);
  });

  it.each(['banked', 'ready', 'wrong-giver'] as const)(
    'does not regrant when the item is %s',
    (mode) => {
      const { ctx, meta, npc, progress, events } = fixture('q_deepfen_purge');
      npc.templateId = mode === 'wrong-giver' ? 'huntsman_deral' : 'warden_fenwick';
      if (mode === 'ready') progress.state = 'ready';
      if (mode === 'banked') meta.bank.inventory.push({ itemId: 'firebottle', count: 1 });
      expect(interactNpcForQuests(ctx, npc, meta)).toBe(false);
      expect(ctx.addItem).not.toHaveBeenCalled();
      expect(events).toEqual([]);
    },
  );
});
