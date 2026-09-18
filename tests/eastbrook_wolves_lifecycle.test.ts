import { afterEach, describe, expect, it, vi } from 'vitest';
import { eastbrookWolvesGuide } from '../src/render/eastbrook_wolves_guidance_core';
import { onMobKilledForQuests } from '../src/sim/quests/quest_credit';
import { Sim } from '../src/sim/sim';
import type { QuestProgress } from '../src/sim/types';
import { QuestTrackingState } from '../src/ui/quest_tracking_core';
import { bareClient } from './helpers/bare_client';

const QUEST = 'q_wolves';

function atMarshal(): Sim {
  const sim = new Sim({ seed: 42, playerClass: 'warrior' });
  const marshal = [...sim.entities.values()].find(
    (entity) => entity.kind === 'npc' && entity.templateId === 'marshal_redbrook',
  );
  if (!marshal) throw new Error('Missing Marshal fixture');
  sim.player.pos = { ...marshal.pos };
  sim.player.prevPos = { ...sim.player.pos };
  return sim;
}

function creditWolf(sim: Sim): void {
  const wolf = [...sim.entities.values()].find(
    (entity) => entity.kind === 'mob' && entity.templateId === 'forest_wolf',
  );
  const meta = sim.players.get(sim.playerId);
  if (!wolf || !meta) throw new Error('Missing wolf or player fixture');
  // Exercise the authoritative kill-credit transition without a combat fixture.
  onMobKilledForQuests(sim.ctx, wolf, meta);
}

afterEach(() => vi.unstubAllGlobals());

describe('Eastbrook wolves guidance across quest and client lifecycles', () => {
  it('marks Marshal before acceptance, guides after acceptance, and ends on hand-in', () => {
    const sim = atMarshal();
    expect(sim.questState(QUEST)).toBe('available');
    expect(eastbrookWolvesGuide(sim, () => false).plan?.key).toBe('wolves:offer');

    sim.acceptQuest(QUEST);
    expect(sim.questLog.get(QUEST)?.state).toBe('active');
    expect(eastbrookWolvesGuide(sim, () => false).plan?.key).toBe('wolves:active');

    for (let i = 0; i < 7; i++) creditWolf(sim);
    expect(sim.questLog.get(QUEST)?.counts).toEqual([7]);
    expect(eastbrookWolvesGuide(sim, () => false).plan?.key).toBe('wolves:active');
    creditWolf(sim);
    expect(sim.questLog.get(QUEST)?.state).toBe('ready');
    expect(eastbrookWolvesGuide(sim, () => false).plan?.key).toBe('wolves:ready');

    sim.turnInQuest(QUEST);
    expect(sim.questsDone.has(QUEST)).toBe(true);
    expect(eastbrookWolvesGuide(sim, () => false).plan).toBeNull();
  });

  it('returns to Marshal on abandonment and resumes wolves only after accepting again', () => {
    const sim = atMarshal();
    sim.acceptQuest(QUEST);
    creditWolf(sim);
    sim.abandonQuest(QUEST);
    expect(sim.questState(QUEST)).toBe('available');
    expect(eastbrookWolvesGuide(sim, () => false).plan?.key).toBe('wolves:offer');
    expect(eastbrookWolvesGuide(sim, () => false).areaRing).toBeNull();

    sim.acceptQuest(QUEST);
    expect(sim.questLog.get(QUEST)?.counts).toEqual([0]);
    expect(eastbrookWolvesGuide(sim, () => false).plan?.key).toBe('wolves:active');
  });

  it('keeps the return route during an online turn-in and clears it on the authoritative acknowledgement', () => {
    const sim = atMarshal();
    const send = vi.fn();
    const client = bareClient(sim.playerId, { ws: { readyState: 1, send } });
    client.entities.set(sim.playerId, sim.player);
    vi.stubGlobal('WebSocket', { OPEN: 1 });
    const snapshot = client as unknown as { applySnapshot(snapshot: unknown): void };
    const self = {
      id: sim.playerId,
      ...sim.player.pos,
      f: sim.player.facing,
      hp: sim.player.hp,
      mhp: sim.player.maxHp,
      res: sim.player.resource,
      mres: sim.player.maxResource,
      rtype: sim.player.resourceType,
    };
    const acknowledge = (qlog: QuestProgress[], qdone: string[] = []) =>
      snapshot.applySnapshot({ t: 'snap', ents: [], self: { ...self, qlog, qdone } });

    client.acceptQuest(QUEST);
    expect(client.questState(QUEST)).toBe('active');
    expect(eastbrookWolvesGuide(client, () => false).plan).toBeNull();
    acknowledge([{ questId: QUEST, counts: [0], state: 'active' }]);
    expect(eastbrookWolvesGuide(client, () => false).plan?.key).toBe('wolves:active');
    acknowledge([{ questId: QUEST, counts: [8], state: 'ready' }]);
    client.turnInQuest(QUEST);
    expect(send).toHaveBeenLastCalledWith(
      JSON.stringify({ t: 'cmd', cmd: 'turnin', quest: QUEST }),
    );
    // Dialogue's optimistic state is active while the authoritative log is ready.
    expect(client.questState(QUEST)).toBe('active');
    expect(eastbrookWolvesGuide(client, () => false).plan?.key).toBe('wolves:ready');

    acknowledge([], [QUEST]);
    expect(client.questState(QUEST)).toBe('done');
    expect(eastbrookWolvesGuide(client, () => false).plan).toBeNull();
  });

  it('honors persisted untracking through reload, quest progress, and character switches', () => {
    const sim = atMarshal();
    sim.acceptQuest(QUEST);
    const rows = new Map<string, string>();
    const storage = {
      getItem: (key: string) => rows.get(key) ?? null,
      setItem: (key: string, value: string) => void rows.set(key, value),
    };
    const tracking = new QuestTrackingState(storage);
    tracking.useCharacter('warrior', 'Eastbrook');
    expect(eastbrookWolvesGuide(sim, () => !tracking.isTracked(QUEST)).plan?.key).toBe(
      'wolves:active',
    );
    tracking.setTracked(QUEST, false);
    expect(eastbrookWolvesGuide(sim, () => !tracking.isTracked(QUEST)).plan).toBeNull();

    const reloaded = new QuestTrackingState(storage);
    reloaded.useCharacter('warrior', 'Eastbrook');
    expect(eastbrookWolvesGuide(sim, () => !reloaded.isTracked(QUEST)).plan).toBeNull();
    for (let i = 0; i < 8; i++) creditWolf(sim);
    expect(sim.questLog.get(QUEST)?.state).toBe('ready');
    expect(eastbrookWolvesGuide(sim, () => !reloaded.isTracked(QUEST)).plan).toBeNull();

    reloaded.useCharacter('mage', 'Other character');
    expect(eastbrookWolvesGuide(sim, () => !reloaded.isTracked(QUEST)).plan?.key).toBe(
      'wolves:ready',
    );
    reloaded.useCharacter('warrior', 'Eastbrook');
    expect(eastbrookWolvesGuide(sim, () => !reloaded.isTracked(QUEST)).plan).toBeNull();
    reloaded.setTracked(QUEST, true);
    expect(eastbrookWolvesGuide(sim, () => !reloaded.isTracked(QUEST)).plan?.key).toBe(
      'wolves:ready',
    );
  });
});
