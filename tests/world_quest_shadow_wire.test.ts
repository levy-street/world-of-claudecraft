import { describe, expect, it, vi } from 'vitest';
import { dispatchWorldQuestWire } from '../server/quest_command_wire';
import { applyQuestSelfWire, type QuestSelfMirrors } from '../src/net/quest_snapshot_wire';
import { Sim } from '../src/sim/sim';
import type { WorldQuestProgress } from '../src/sim/types';
import { activeWorldQuestsForCycle } from '../src/sim/world_quest_rotation';
import {
  decodeShadowState,
  sanitizeShadowCreditedObjects,
} from '../src/sim/world_quest_shadow_wire';
import { savedWorldQuestState } from '../src/sim/world_quest_state';
import { worldQuestProgressForWire } from '../src/sim/world_quest_trace_wire';
import { sanitizeWorldQuestProgress } from '../src/sim/world_quests';
import { bareClient } from './helpers/bare_client';

const ID = 'wq_eastbrook_shadow';
const GUARD = 2146900041;
function cycle(): string {
  for (let i = 0; i < 100; i++) {
    const key = `wq3_${i}`;
    if (activeWorldQuestsForCycle(key).some((quest) => quest.id === ID)) return key;
  }
  throw new Error('Shadow quest missing from rotation');
}
function row(): WorldQuestProgress {
  return {
    questId: ID,
    count: 1,
    state: 'active',
    creditedObjects: ['2146900042'],
    shadow: {
      phase: 'cloaked',
      suspicion: 0.25,
      cooldown: 0,
      stealing: { targetId: GUARD, remaining: 1.25, x: 120, z: -70 },
    },
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

describe('borrowed cloak owner wire and persistence', () => {
  it('deep-copies only known runtime fields through owner snapshots', () => {
    const original = row();
    const encoded = worldQuestProgressForWire(original);
    expect(encoded.shadow).toEqual(original.shadow);
    expect(encoded.shadow?.stealing).not.toBe(original.shadow?.stealing);
    const target = mirror();
    applyQuestSelfWire(target, { wqlog: [encoded] });
    expect(target.worldQuestLog.get(ID)?.shadow).toEqual(original.shadow);
    encoded.shadow!.stealing!.remaining = 0;
    expect(target.worldQuestLog.get(ID)?.shadow?.stealing?.remaining).toBe(1.25);
    expect(original.shadow?.stealing?.remaining).toBe(1.25);
    expect(decodeShadowState({ ...original.shadow, privateSecret: true }, ID)).toEqual(
      original.shadow,
    );
  });

  it('rejects malformed enums, nonfinite timers and forged guard channels atomically', () => {
    for (const patch of [
      { phase: 'invisible' },
      { phase: 'caught' },
      { suspicion: -1 },
      { suspicion: 1.01 },
      { suspicion: NaN },
      { cooldown: Infinity },
      { cooldown: '0' },
      { cooldown: 61 },
      { stealing: [] },
      { stealing: null },
      { stealing: { ...row().shadow!.stealing, targetId: 7 } },
      { stealing: { ...row().shadow!.stealing, x: NaN } },
      { stealing: { ...row().shadow!.stealing, remaining: -1 } },
    ]) {
      expect(decodeShadowState({ ...row().shadow, ...patch }, ID)).toBeUndefined();
    }
    for (const invalid of [undefined, null, [], {}, 'cloak'])
      expect(decodeShadowState(invalid, ID)).toBeUndefined();
    expect(decodeShadowState(row().shadow, '__proto__')).toBeUndefined();
    expect(decodeShadowState(row().shadow, 'wq_mirefen_infiltrator')).toBeUndefined();
    expect(decodeShadowState({ phase: 'caught', suspicion: 1, cooldown: 5 }, ID)).toEqual({
      phase: 'caught',
      suspicion: 1,
      cooldown: 5,
    });
  });

  it('keeps omitted deltas, clears malformed channels and never restores a completed cloak', () => {
    const target = mirror();
    applyQuestSelfWire(target, { wqlog: [row()] });
    const previous = target.worldQuestLog;
    applyQuestSelfWire(target, {});
    expect(target.worldQuestLog).toBe(previous);
    applyQuestSelfWire(target, { wqlog: [{ ...row(), shadow: { phase: 'bogus' } }] });
    expect(target.worldQuestLog.get(ID)?.shadow).toBeUndefined();
    expect(worldQuestProgressForWire({ ...row(), state: 'completed' }).shadow).toBeUndefined();
    applyQuestSelfWire(target, { wqlog: [] });
    expect(target.worldQuestLog.size).toBe(0);
  });

  it('never promotes another player entity payload to owner cloak state', () => {
    const client = bareClient(7);
    (client as unknown as { applySnapshot(value: unknown): void }).applySnapshot({
      t: 'snap',
      ents: [
        {
          id: 8,
          k: 'player',
          tid: 'warrior',
          nm: 'Other',
          x: 0,
          y: 0,
          z: 0,
          wqday: cycle(),
          wqlog: [worldQuestProgressForWire(row())],
        },
      ],
      self: {
        id: 7,
        k: 'player',
        tid: 'warrior',
        nm: 'Owner',
        x: 0,
        y: 0,
        z: 0,
        wqday: cycle(),
        wqlog: [],
      },
    });
    expect(client.worldQuestLog.size).toBe(0);
    client.resetQuestWorldWireState();
    expect(client.worldQuestLog.size).toBe(0);
  });

  it('persists stolen identities but strips cloak and prevents duplicate credit after restore', () => {
    const saved = savedWorldQuestState({
      worldQuestCycle: cycle(),
      worldQuestLog: new Map([[ID, row()]]),
    } as Parameters<typeof savedWorldQuestState>[0]);
    const savedRow = 'worldQuests' in saved ? saved.worldQuests!.progress[0] : undefined;
    expect(savedRow).toEqual({
      questId: ID,
      count: 1,
      state: 'active',
      creditedObjects: ['2146900042'],
    });
    const restored = sanitizeWorldQuestProgress(
      [
        {
          ...row(),
          count: 99,
          creditedObjects: ['2146900042', '2146900042', '__proto__', '2146900099', GUARD],
        },
      ],
      cycle(),
    )[0];
    expect(restored?.shadow).toBeUndefined();
    expect(restored?.creditedObjects).toEqual(['2146900042']);
    expect(restored?.count).toBe(1);
    expect(
      sanitizeShadowCreditedObjects(['2146900044', '2146900041', '2146900044', 2146900042]),
    ).toEqual(['2146900044', '2146900041']);
  });
});

describe('cloak character round trip', () => {
  it('never reloads the borrowed aura, stealthed flag or active channel from a save', () => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior', autoEquip: true });
    sim.setPlayerLevel(10);
    const meta = sim.players.get(sim.player.id)!;
    meta.worldQuestCycle = cycle();
    meta.worldQuestLog.set(ID, row());
    sim.player.auras.push({
      id: 'world_quest_shadow_cloak',
      name: 'Duskweave Cloak',
      kind: 'stealth',
      value: 1,
      remaining: 0,
      duration: 0,
      permanent: true,
      sourceId: sim.player.id,
      school: 'arcane',
    });
    sim.player.stealthed = true;
    const saved = sim.serializeCharacter(sim.player.id)!;
    const rejoined = sim.addPlayer('warrior', 'Returned', { state: saved });
    expect(sim.entities.get(rejoined)?.stealthed).toBe(false);
    expect(
      sim.entities.get(rejoined)?.auras.some((aura) => aura.id === 'world_quest_shadow_cloak'),
    ).toBe(false);
    expect(sim.players.get(rejoined)?.worldQuestLog.get(ID)?.shadow).toBeUndefined();
    expect(sim.players.get(rejoined)?.worldQuestLog.get(ID)?.creditedObjects).toEqual([
      '2146900042',
    ]);
  });
});

describe('shadow action command transport', () => {
  it('sends only intent and selected target; server binds the authenticated player', () => {
    const client = bareClient(7);
    const send = vi.fn();
    Object.assign(client, { cmd: send });
    client.shadowWorldQuestAction('pickpocket', GUARD);
    client.shadowWorldQuestAction('leave');
    expect(send.mock.calls).toEqual([
      [{ cmd: 'world_quest_shadow', action: 'pickpocket', targetId: GUARD }],
      [{ cmd: 'world_quest_shadow', action: 'leave' }],
    ]);
    const action = vi.fn();
    const sim = { shadowWorldQuestAction: action } as unknown as Sim;
    dispatchWorldQuestWire(
      sim,
      { ...send.mock.calls[0][0], pid: 123, count: 4, invisible: true },
      7,
    );
    dispatchWorldQuestWire(sim, send.mock.calls[1][0], 7);
    expect(action.mock.calls).toEqual([
      ['pickpocket', GUARD, 7],
      ['leave', undefined, 7],
    ]);
    for (const targetId of [
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
      dispatchWorldQuestWire(sim, { cmd: 'world_quest_shadow', action: 'pickpocket', targetId }, 7);
    for (const badAction of [undefined, null, 'cloak', {}, 1])
      dispatchWorldQuestWire(
        sim,
        { cmd: 'world_quest_shadow', action: badAction, targetId: GUARD },
        7,
      );
    dispatchWorldQuestWire(sim, { cmd: 'world_quest_shadow', action: 'leave', targetId: 'bad' }, 7);
    expect(action).toHaveBeenCalledTimes(2);
  });
});
