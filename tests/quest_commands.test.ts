// Direct unit tests for the W4 quest command module (src/sim/quests/quest_commands.ts),
// distinct from the server-dispatch readout test (tests/quest_command.test.ts). These
// call the ctx-first module functions with the live SimContext (sim.ctx) to exercise
// the moved bodies directly: questState/computeQuestState projection, acceptQuest
// (near / too-far / unavailable), the linked-share party gate + the fallback re-grant,
// abandonQuest, and turnInQuest (reward item-less copper + XP path).

import { describe, expect, it } from 'vitest';
import { QUESTS } from '../src/sim/data';
import {
  abandonQuest,
  acceptLinkedQuest,
  acceptQuest,
  computeQuestState,
  questState,
  turnInQuest,
} from '../src/sim/quests/quest_commands';
import { Sim } from '../src/sim/sim';
import type { Entity, QuestProgress, SimEvent } from '../src/sim/types';
import { terrainHeight } from '../src/sim/world';

type AnySim = Sim & Record<string, any>;
type AnyEntity = Entity & Record<string, any>;

function teleport(sim: AnySim, e: AnyEntity, x: number, z: number): void {
  e.pos.x = x;
  e.pos.z = z;
  e.pos.y = terrainHeight(x, z, sim.cfg.seed);
  e.prevPos = { ...e.pos };
  sim.rebucket(e);
}

function findNpc(sim: AnySim, templateId: string): AnyEntity {
  const npc = [...sim.entities.values()].find(
    (e: AnyEntity) => e.kind === 'npc' && e.templateId === templateId,
  );
  if (!npc) throw new Error(`npc ${templateId} not in world`);
  return npc as AnyEntity;
}

function logsTo(events: SimEvent[], pid: number): string[] {
  return events
    .filter((e): e is Extract<SimEvent, { type: 'log' }> => e.type === 'log' && e.pid === pid)
    .map((e) => e.text);
}

function errorsTo(events: SimEvent[], pid: number): string[] {
  return events
    .filter((e): e is Extract<SimEvent, { type: 'error' }> => e.type === 'error' && e.pid === pid)
    .map((e) => e.text);
}

describe('quest_commands: computeQuestState projection', () => {
  it('maps done / active / ready / unavailable / available', () => {
    const done = new Set<string>(['q_wolves']);
    const log = new Map<string, QuestProgress>([
      ['q_boars', { questId: 'q_boars', counts: [0], state: 'active' }],
      ['q_greyjaw', { questId: 'q_greyjaw', counts: [0], state: 'ready' }],
    ]);

    expect(computeQuestState('q_wolves', new Map(), done, 1)).toBe('done');
    expect(computeQuestState('q_boars', log, new Set(), 1)).toBe('active');
    expect(computeQuestState('q_greyjaw', log, new Set(), 1)).toBe('ready');
    // unknown quest id -> unavailable.
    expect(computeQuestState('q_nonexistent', new Map(), new Set(), 99)).toBe('unavailable');
    // requiresQuest prerequisite not yet done -> unavailable; satisfied -> available.
    expect(computeQuestState('q_greyjaw', new Map(), new Set(), 1)).toBe('unavailable');
    expect(computeQuestState('q_greyjaw', new Map(), new Set(['q_wolves']), 1)).toBe('available');
    // minLevel gate (q_nythraxis_bound_guardian is level 20) with its prereq satisfied.
    expect(
      computeQuestState(
        'q_nythraxis_bound_guardian',
        new Map(),
        new Set(['q_nythraxis_sealed_crypt']),
        1,
      ),
    ).toBe('unavailable');
    // fresh, gateless quest -> available.
    expect(computeQuestState('q_wolves', new Map(), new Set(), 1)).toBe('available');
  });
});

describe('quest_commands: questState delegate', () => {
  it('returns unavailable for an unresolvable pid and the projection for a real player', () => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior' }) as AnySim;
    const pid = sim.playerId;
    expect(questState(sim.ctx, 'q_wolves', 999999)).toBe('unavailable'); // no such player
    expect(questState(sim.ctx, 'q_wolves', pid)).toBe('available');
    expect(questState(sim.ctx, 'q_nonexistent', pid)).toBe('unavailable');
  });
});

describe('quest_commands: acceptQuest', () => {
  it('accepts at the giver NPC (records the log + the accepted event)', () => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior' }) as AnySim;
    const pid = sim.playerId;
    const giver = findNpc(sim, QUESTS.q_wolves.giverNpcId);
    teleport(sim, sim.player as AnyEntity, giver.pos.x, giver.pos.z);

    acceptQuest(sim.ctx, 'q_wolves', pid);
    const ev = sim.drainEvents();
    expect(ev.some((e) => e.type === 'questAccepted' && (e as any).questId === 'q_wolves')).toBe(
      true,
    );
    expect(logsTo(ev, pid)).toContain('Quest accepted: Wolves at the Door');
    expect(sim.players.get(pid)!.questLog.has('q_wolves')).toBe(true);
  });

  it('rejects when out of range (Too far away.)', () => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior' }) as AnySim;
    const pid = sim.playerId;
    // The giver exists in the world but the player is nowhere near it.
    teleport(sim, sim.player as AnyEntity, 900, 900);
    acceptQuest(sim.ctx, 'q_wolves', pid);
    const ev = sim.drainEvents();
    expect(errorsTo(ev, pid)).toContain('Too far away.');
    expect(sim.players.get(pid)!.questLog.has('q_wolves')).toBe(false);
  });

  it('rejects an unknown quest and a re-accept of a held quest (not available)', () => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior' }) as AnySim;
    const pid = sim.playerId;
    const giver = findNpc(sim, QUESTS.q_wolves.giverNpcId);
    teleport(sim, sim.player as AnyEntity, giver.pos.x, giver.pos.z);

    acceptQuest(sim.ctx, 'q_nonexistent', pid);
    expect(errorsTo(sim.drainEvents(), pid)).toContain('That quest is not available.');

    acceptQuest(sim.ctx, 'q_wolves', pid); // first accept succeeds
    sim.drainEvents();
    acceptQuest(sim.ctx, 'q_wolves', pid); // second: already active -> not available
    expect(errorsTo(sim.drainEvents(), pid)).toContain('That quest is not available.');
  });
});

describe('quest_commands: abandonQuest', () => {
  it('clears a held quest with a log, and no-ops on a quest not in the log', () => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior' }) as AnySim;
    const pid = sim.playerId;
    const giver = findNpc(sim, QUESTS.q_wolves.giverNpcId);
    teleport(sim, sim.player as AnyEntity, giver.pos.x, giver.pos.z);
    acceptQuest(sim.ctx, 'q_wolves', pid);
    sim.drainEvents();

    abandonQuest(sim.ctx, 'q_wolves', pid);
    const ev = sim.drainEvents();
    expect(logsTo(ev, pid)).toContain('Quest abandoned: Wolves at the Door');
    expect(sim.players.get(pid)!.questLog.has('q_wolves')).toBe(false);

    // Abandoning a quest not in the log is a silent early return (no emit).
    abandonQuest(sim.ctx, 'q_wolves', pid);
    expect(sim.drainEvents().length).toBe(0);
  });
});

describe('quest_commands: turnInQuest', () => {
  it('grants copper + XP, marks done, and rejects an incomplete quest', () => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior' }) as AnySim;
    const pid = sim.playerId;
    const meta = sim.players.get(pid)!;
    const giver = findNpc(sim, QUESTS.q_wolves.giverNpcId);
    teleport(sim, sim.player as AnyEntity, giver.pos.x, giver.pos.z);

    acceptQuest(sim.ctx, 'q_wolves', pid);
    sim.drainEvents();

    // Not complete yet (still active) -> rejected.
    turnInQuest(sim.ctx, 'q_wolves', pid);
    expect(errorsTo(sim.drainEvents(), pid)).toContain('That quest is not complete.');

    // Force the objective complete, then turn in at the (same) turn-in NPC.
    meta.questLog.get('q_wolves')!.state = 'ready';
    const copperBefore = meta.copper;
    const lifetimeXpBefore = meta.lifetimeXp;
    const completedBefore = meta.counters.questsCompleted;

    turnInQuest(sim.ctx, 'q_wolves', pid);
    const ev = sim.drainEvents();
    expect(ev.some((e) => e.type === 'questDone' && (e as any).questId === 'q_wolves')).toBe(true);
    expect(logsTo(ev, pid)).toContain('Quest completed: Wolves at the Door');
    expect(ev.some((e) => e.type === 'loot' && /^You receive /.test(String((e as any).text)))).toBe(
      true,
    );

    expect(meta.questsDone.has('q_wolves')).toBe(true);
    expect(meta.questLog.has('q_wolves')).toBe(false);
    expect(meta.copper - copperBefore).toBe(QUESTS.q_wolves.copperReward);
    expect(meta.lifetimeXp).toBeGreaterThan(lifetimeXpBefore);
    expect(meta.counters.questsCompleted).toBe(completedBefore + 1);
  });
});

describe('quest_commands: acceptLinkedQuest', () => {
  it('gates on shared party membership, then shares (with a sharer notice)', () => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true }) as AnySim;
    const a = sim.addPlayer('warrior', 'Aleph'); // sharer
    const b = sim.addPlayer('mage', 'Bet'); // acceptor

    // Not partied: the party gate rejects with the sharer's name.
    acceptLinkedQuest(sim.ctx, 'q_wolves', a, b);
    expect(errorsTo(sim.drainEvents(), b)).toContain(
      "You must be in Aleph's party to accept that quest.",
    );
    expect(sim.players.get(b)!.questLog.has('q_wolves')).toBe(false);

    // A non-existent quest can never be shared.
    acceptLinkedQuest(sim.ctx, 'q_nonexistent', a, b);
    expect(errorsTo(sim.drainEvents(), b)).toContain("This quest can't be shared.");

    // Form a party, then the share goes through and A gets a notice.
    sim.partyInvite(b, a);
    sim.partyAccept(b);
    sim.drainEvents();
    acceptLinkedQuest(sim.ctx, 'q_wolves', a, b);
    const ev = sim.drainEvents();
    expect(
      ev.some(
        (e) =>
          e.type === 'questAccepted' && (e as any).questId === 'q_wolves' && (e as any).pid === b,
      ),
    ).toBe(true);
    expect(logsTo(ev, a)).toContain('Bet accepted your shared quest.');
    expect(sim.players.get(b)!.questLog.has('q_wolves')).toBe(true);
  });

  it('re-grants a missing requiredItem through finalizeQuestAccept (fallback re-grant)', () => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true }) as AnySim;
    const a = sim.addPlayer('warrior', 'Aleph');
    const b = sim.addPlayer('mage', 'Bet');
    const quest = 'q_nythraxis_bound_guardian'; // requiredItems: ['crypt_keystone']
    const item = QUESTS[quest].requiredItems![0];

    const bMeta = sim.players.get(b)!;
    sim.setPlayerLevel(20, b); // clear the minLevel 20 gate
    bMeta.questsDone.add(QUESTS[quest].requiresQuest!); // satisfy the prerequisite
    expect(sim.countItem(item, b)).toBe(0); // player lacks the prerequisite item

    sim.partyInvite(b, a);
    sim.partyAccept(b);
    sim.drainEvents();

    acceptLinkedQuest(sim.ctx, quest, a, b);
    sim.drainEvents();
    expect(bMeta.questLog.has(quest)).toBe(true);
    // finalizeQuestAccept's re-grant loop handed the missing keystone back.
    expect(sim.countItem(item, b)).toBe(1);
  });
});
