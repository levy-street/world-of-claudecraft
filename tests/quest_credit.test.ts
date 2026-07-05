// Direct unit tests for the quest-credit trio (src/sim/quests/quest_credit.ts),
// extracted from the Sim monolith in session Q1. The trio mutates the live
// PlayerMeta.questLog in place (immutability waiver) and draws no rng; here we drive
// each function against a minimal fake SimContext (capturing emitted events + a
// controllable countItem) and real QUESTS content (q_wolves kill-8, q_boars collect-5).

import { describe, expect, it } from 'vitest';
import { QUESTS } from '../src/sim/data';
import {
  checkQuestReady,
  onInventoryChangedForQuests,
  onMobKilledForQuests,
} from '../src/sim/quests/quest_credit';
import type { PlayerMeta } from '../src/sim/sim';
import type { SimContext } from '../src/sim/sim_context';
import type { Entity, QuestProgress, SimEvent } from '../src/sim/types';

type FakeCtx = SimContext & { events: SimEvent[] };

// A minimal SimContext: the trio only ever touches ctx.emit and ctx.countItem.
function makeCtx(itemCount: () => number = () => 0): FakeCtx {
  const events: SimEvent[] = [];
  return {
    events,
    emit: (ev: SimEvent) => {
      events.push(ev);
    },
    countItem: (_itemId: string, _pid?: number) => itemCount(),
  } as unknown as FakeCtx;
}

// A minimal PlayerMeta: the trio only reads questLog / counters.questProgress / entityId.
function makeMeta(entityId = 1): PlayerMeta {
  return {
    entityId,
    questLog: new Map<string, QuestProgress>(),
    counters: { questProgress: 0 },
  } as unknown as PlayerMeta;
}

const event = (events: SimEvent[], type: string): Record<string, unknown>[] =>
  events.filter((e) => e.type === type) as unknown as Record<string, unknown>[];

describe('quest_credit: onMobKilledForQuests (kill credit)', () => {
  it('increments per matching kill, emits questProgress, and promotes to ready at the target', () => {
    const ctx = makeCtx();
    const meta = makeMeta();
    const quest = QUESTS.q_wolves; // kill 8 forest_wolf
    const need = quest.objectives[0].count;
    const qp: QuestProgress = { questId: 'q_wolves', counts: [0], state: 'active' };
    meta.questLog.set('q_wolves', qp);
    const wolf = { templateId: 'forest_wolf' } as unknown as Entity;
    const boar = { templateId: 'forest_boar' } as unknown as Entity;

    // a non-matching mob death credits nothing
    onMobKilledForQuests(ctx, boar, meta);
    expect(qp.counts[0]).toBe(0);
    expect(ctx.events.length).toBe(0);

    for (let i = 1; i <= need; i++) {
      onMobKilledForQuests(ctx, wolf, meta);
      expect(qp.counts[0]).toBe(i);
    }
    // one counter bump + one questProgress per credited kill
    expect(meta.counters.questProgress).toBe(need);
    expect(event(ctx.events, 'questProgress').length).toBe(need);
    expect(event(ctx.events, 'questProgress').at(-1)?.text).toBe(
      `${quest.objectives[0].label}: ${need}/${need}`,
    );
    // checkQuestReady (via the trio) promoted exactly at the target
    expect(qp.state).toBe('ready');
    expect(event(ctx.events, 'questReady').some((e) => e.questId === 'q_wolves')).toBe(true);

    // a ready quest is no longer active, so overkill never over-credits
    onMobKilledForQuests(ctx, wolf, meta);
    expect(qp.counts[0]).toBe(need);
    expect(meta.counters.questProgress).toBe(need);
  });
});

describe('quest_credit: onInventoryChangedForQuests (collect credit)', () => {
  it('tracks countItem up to the target, promotes, then demotes when items are lost', () => {
    let held = 0;
    const ctx = makeCtx(() => held);
    const meta = makeMeta();
    const quest = QUESTS.q_boars; // collect 5 boar_hide
    const need = quest.objectives[0].count;
    const qp: QuestProgress = { questId: 'q_boars', counts: [0], state: 'active' };
    meta.questLog.set('q_boars', qp);

    // collect to completion one hide at a time
    for (let i = 1; i <= need; i++) {
      held = i;
      onInventoryChangedForQuests(ctx, meta);
      expect(qp.counts[0]).toBe(i);
    }
    expect(qp.state).toBe('ready');
    expect(meta.counters.questProgress).toBe(need); // +1 per positive delta
    expect(event(ctx.events, 'questReady').some((e) => e.questId === 'q_boars')).toBe(true);

    // demotion arm: drop one -> have < target -> counts down + ready demotes to active
    held = need - 1;
    onInventoryChangedForQuests(ctx, meta);
    expect(qp.counts[0]).toBe(need - 1);
    expect(qp.state).toBe('active');
    // a drop does NOT bump the progress counter (positive-delta-only)
    expect(meta.counters.questProgress).toBe(need);

    // re-collect -> promote again (one more positive delta)
    held = need;
    onInventoryChangedForQuests(ctx, meta);
    expect(qp.counts[0]).toBe(need);
    expect(qp.state).toBe('ready');
    expect(meta.counters.questProgress).toBe(need + 1);
  });

  it('clamps have to the objective count and ignores non-collect objectives', () => {
    let held = 0;
    const ctx = makeCtx(() => held);
    const meta = makeMeta();
    const quest = QUESTS.q_boars;
    const need = quest.objectives[0].count;
    const qp: QuestProgress = { questId: 'q_boars', counts: [0], state: 'active' };
    meta.questLog.set('q_boars', qp);

    // holding MORE than the target clamps to the target (min(count, have))
    held = need + 10;
    onInventoryChangedForQuests(ctx, meta);
    expect(qp.counts[0]).toBe(need);
    expect(meta.counters.questProgress).toBe(need);
    expect(qp.state).toBe('ready');
  });
});

describe('quest_credit: checkQuestReady (both arms)', () => {
  it('promotes active -> ready (with questReady + Complete log) when every objective is met', () => {
    const ctx = makeCtx();
    const meta = makeMeta();
    const quest = QUESTS.q_wolves;
    const qp: QuestProgress = {
      questId: 'q_wolves',
      counts: [quest.objectives[0].count],
      state: 'active',
    };
    meta.questLog.set('q_wolves', qp);

    checkQuestReady(ctx, qp, meta);
    expect(qp.state).toBe('ready');
    expect(event(ctx.events, 'questReady').length).toBe(1);
    expect(event(ctx.events, 'log').some((e) => e.text === `${quest.name} (Complete)`)).toBe(true);
  });

  it('demotes ready -> active (emitting nothing) when an objective regresses, and is a no-op otherwise', () => {
    const ctx = makeCtx();
    const meta = makeMeta();
    const quest = QUESTS.q_wolves;
    const qp: QuestProgress = {
      questId: 'q_wolves',
      counts: [quest.objectives[0].count - 1],
      state: 'ready',
    };
    meta.questLog.set('q_wolves', qp);

    // demotion arm: ready + below target -> active, no events
    checkQuestReady(ctx, qp, meta);
    expect(qp.state).toBe('active');
    expect(ctx.events.length).toBe(0);

    // active + still below target -> stays active, still no events
    checkQuestReady(ctx, qp, meta);
    expect(qp.state).toBe('active');
    expect(ctx.events.length).toBe(0);
  });
});
