import { describe, expect, it, vi } from 'vitest';
import { dispatchWorldQuestWire } from '../server/quest_command_wire';
import { applyQuestSelfWire, type QuestSelfMirrors } from '../src/net/quest_snapshot_wire';
import type { Sim } from '../src/sim/sim';
import type { WorldQuestProgress } from '../src/sim/types';
import { decodeInvestigationState } from '../src/sim/world_quest_investigation_wire';
import { activeWorldQuestsForCycle } from '../src/sim/world_quest_rotation';
import { savedWorldQuestState } from '../src/sim/world_quest_state';
import { worldQuestProgressForWire } from '../src/sim/world_quest_trace_wire';
import { sanitizeWorldQuestProgress } from '../src/sim/world_quests';
import { bareClient } from './helpers/bare_client';

const ID = 'wq_mirefen_infiltrator';
function cycle(): string {
  for (let i = 0; i < 30; i++) {
    const key = `wq3_${i}`;
    if (activeWorldQuestsForCycle(key).some((quest) => quest.id === ID)) return key;
  }
  throw new Error('Investigation missing from the world quest rotation');
}
function row(): WorldQuestProgress {
  return {
    questId: ID,
    count: 0,
    state: 'active',
    investigation: { heard: 15, clues: 3, cleared: 5, mobId: 2146900099 },
  };
}
function mirror(): QuestSelfMirrors {
  return {
    questLog: new Map(),
    questsDone: new Set(),
    worldQuestCycle: cycle(),
    worldQuestExpiresAtMs: 0,
    worldQuestLog: new Map(),
  };
}

describe('investigation owner wire and save boundary', () => {
  it('copies only bounded evidence and live actor identity through the owner projection', () => {
    const original = row();
    const encoded = worldQuestProgressForWire(original);
    expect(encoded.investigation).toEqual(original.investigation);
    expect(encoded.investigation).not.toBe(original.investigation);
    const target = mirror();
    applyQuestSelfWire(target, { wqlog: [encoded] });
    expect(target.worldQuestLog.get(ID)?.investigation).toEqual(original.investigation);
    encoded.investigation!.heard = 0;
    expect(target.worldQuestLog.get(ID)?.investigation?.heard).toBe(15);
    expect(original.investigation?.heard).toBe(15);
    expect(decodeInvestigationState({ ...original.investigation, secret: 'discard' }, ID)).toEqual(
      original.investigation,
    );
  });

  it('rejects malformed, oversized and version-skewed masks and actor IDs atomically', () => {
    for (const patch of [
      { heard: -1 },
      { heard: 16 },
      { heard: 1.5 },
      { heard: undefined },
      { clues: 4 },
      { clues: NaN },
      { clues: '3' },
      { cleared: 16 },
      { cleared: Infinity },
      { cleared: null },
      { mobId: 0 },
      { mobId: -1 },
      { mobId: 1.5 },
      { mobId: Infinity },
      { mobId: Number.MAX_SAFE_INTEGER + 1 },
      { mobId: '1' },
    ])
      expect(decodeInvestigationState({ ...row().investigation, ...patch }, ID)).toBeUndefined();
    for (const invalid of [undefined, null, [], {}, 'evidence'])
      expect(decodeInvestigationState(invalid, ID)).toBeUndefined();
    expect(decodeInvestigationState(row().investigation, 'wq_eastbrook_bandits')).toBeUndefined();
    expect(decodeInvestigationState(row().investigation, '__proto__')).toBeUndefined();
    expect(decodeInvestigationState({ heard: 0, clues: 0, cleared: 0 }, ID)).toEqual({
      heard: 0,
      clues: 0,
      cleared: 0,
    });
  });

  it('retains omitted deltas, drops malformed evidence and clears an explicit empty log', () => {
    const target = mirror();
    applyQuestSelfWire(target, { wqlog: [row()] });
    const previous = target.worldQuestLog;
    applyQuestSelfWire(target, {});
    expect(target.worldQuestLog).toBe(previous);
    applyQuestSelfWire(target, { wqlog: [{ ...row(), investigation: { heard: 100 } }] });
    expect(target.worldQuestLog.get(ID)?.state).toBe('active');
    expect(target.worldQuestLog.get(ID)?.investigation).toBeUndefined();
    applyQuestSelfWire(target, { wqlog: [] });
    expect(target.worldQuestLog.size).toBe(0);
  });

  it('mirrors live ClientWorld snapshots and never persists or restores session evidence', () => {
    const client = bareClient(1);
    (client as unknown as { applySnapshot(value: unknown): void }).applySnapshot({
      t: 'snap',
      ents: [],
      self: {
        id: 1,
        k: 'player',
        tid: 'warrior',
        nm: 'Detective',
        x: 0,
        y: 0,
        z: 0,
        wqday: cycle(),
        wqlog: [worldQuestProgressForWire(row())],
      },
    });
    expect(client.worldQuestLog.get(ID)?.investigation).toEqual(row().investigation);
    const saved = savedWorldQuestState({
      worldQuestCycle: cycle(),
      worldQuestLog: new Map([[ID, row()]]),
    } as Parameters<typeof savedWorldQuestState>[0]);
    const savedRow = 'worldQuests' in saved ? saved.worldQuests!.progress[0] : undefined;
    expect(savedRow).toEqual({ questId: ID, count: 0, state: 'active' });
    expect(sanitizeWorldQuestProgress([row()], cycle())[0]?.investigation).toBeUndefined();
  });
});

describe('investigation accusation command transport', () => {
  it('sends only the selected NPC identity and validates it before authoritative dispatch', () => {
    const client = bareClient(7);
    const send = vi.fn();
    Object.assign(client, { cmd: send });
    client.accuseWorldQuestSuspect(2146900099);
    expect(send).toHaveBeenCalledExactlyOnceWith({ cmd: 'world_quest_accuse', npcId: 2146900099 });
    const accuse = vi.fn();
    const sim = { accuseWorldQuestSuspect: accuse } as unknown as Sim;
    dispatchWorldQuestWire(sim, send.mock.calls[0][0], 7);
    expect(accuse).toHaveBeenCalledExactlyOnceWith(2146900099, 7);
    for (const npcId of [
      undefined,
      null,
      '2',
      0,
      -1,
      2.5,
      NaN,
      Infinity,
      Number.MAX_SAFE_INTEGER + 1,
    ])
      dispatchWorldQuestWire(sim, { cmd: 'world_quest_accuse', npcId }, 7);
    expect(accuse).toHaveBeenCalledTimes(1);
  });
});
