import { describe, expect, it } from 'vitest';
import { emitActivitySelfKeys } from '../server/quest_snapshot_wire';
import type { ClientWorld } from '../src/net/online';
import { decodeHauntedPumpkinsWire, SeasonalWireState } from '../src/net/seasonal_wire_state';
import { GOURDLIGHT_PUMPKINS } from '../src/sim/content/gourdlight_pumpkins';
import { Sim } from '../src/sim/sim';
import { bareClient } from './helpers/bare_client';

function apply(client: ClientWorld, self: Record<string, unknown>): void {
  (client as unknown as { applySnapshot(snapshot: unknown): void }).applySnapshot({
    t: 'snap',
    self: {
      k: 'player',
      tid: 'warrior',
      nm: 'Pumpkinwatch',
      lv: 1,
      x: 0,
      y: 0,
      z: 0,
      f: 0,
      hp: 100,
      mhp: 100,
      ...self,
    },
    ents: [],
  });
}

describe('personal haunted pumpkin wire state', () => {
  it('keeps guild snapshots and Heroic Marks invalidation through the seasonal layer', () => {
    const state = new SeasonalWireState();
    expect(
      state.applyQuestSelfSnapshot({
        hmarks: 3,
        gcon: { week: '2026-10-26', offered: [], done: [], lifetime: 2 },
      }),
    ).toBe(true);
    expect(state.heroicMarks).toBe(3);
    expect(state.guildContracts.week).toBe('2026-10-26');
    expect(state.guildContracts.lifetime).toBe(2);
    expect(state.applyQuestSelfSnapshot({ hmarks: 3, hpf: [] })).toBe(false);
    expect(state.applyQuestSelfSnapshot({})).toBe(false);
    expect(state.guildContracts.lifetime).toBe(2);
    state.resetQuestWorldWireState();
    expect(state.heroicMarks).toBe(0);
    expect(state.guildContracts.lifetime).toBe(0);
  });

  it('accepts only distinct catalog ids and freezes the decoded result', () => {
    const ids = GOURDLIGHT_PUMPKINS.slice(0, 2).map((pumpkin) => pumpkin.id);
    expect(ids).toHaveLength(2);
    const decoded = decodeHauntedPumpkinsWire([
      ids[1],
      ids[0],
      ids[1],
      'unknown_pumpkin',
      '__proto__',
      null,
      123,
      {},
    ]);
    expect(decoded).toEqual([...ids].sort());
    expect(Object.isFrozen(decoded)).toBe(true);
    for (const invalid of [null, undefined, {}, 'pumpkin', 42]) {
      expect(decodeHauntedPumpkinsWire(invalid)).toEqual([]);
    }
  });

  it('never inspects more input entries than the finite pumpkin catalog', () => {
    const values: unknown[] = new Array(GOURDLIGHT_PUMPKINS.length).fill(null);
    Object.defineProperty(values, GOURDLIGHT_PUMPKINS.length, {
      get: () => {
        throw new Error('decoder exceeded catalog bound');
      },
    });
    expect(decodeHauntedPumpkinsWire(values)).toEqual([]);
    const ids = GOURDLIGHT_PUMPKINS.map((pumpkin) => pumpkin.id);
    expect(decodeHauntedPumpkinsWire(ids)).toEqual([...ids].sort());
  });

  it('preserves omitted deltas, applies explicit clears and resets on a fresh session', () => {
    const state = new SeasonalWireState();
    const id = GOURDLIGHT_PUMPKINS[0].id;
    state.applyQuestSelfSnapshot({ hpf: [id] });
    const previous = state.hauntedPumpkinsFound;
    state.applyQuestSelfSnapshot({});
    expect(state.hauntedPumpkinsFound).toBe(previous);
    state.applyQuestSelfSnapshot({ hpf: [] });
    expect(state.hauntedPumpkinsFound).toEqual([]);
    state.applyQuestSelfSnapshot({ hpf: [id] });
    state.resetQuestWorldWireState();
    expect(state.hauntedPumpkinsFound).toEqual([]);
    expect(bareClient(1).hauntedPumpkinsFound).toEqual([]);
  });

  it('round trips the owner-only server emission through the real client snapshot decoder', () => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
    const pid = sim.addPlayer('warrior', 'Pumpkinwatch');
    const otherPid = sim.addPlayer('warrior', 'Otherwatch');
    const meta = sim.meta(pid)!;
    const id = GOURDLIGHT_PUMPKINS[0].id;
    meta.hauntedPumpkins.add(id);
    const client = bareClient(pid);
    const emit = (owner: number): Record<string, unknown> => {
      const self: Record<string, unknown> = { id: owner };
      emitActivitySelfKeys(
        (key, value) => {
          self[key] = value;
        },
        sim,
        sim.meta(owner)!,
        owner,
      );
      return JSON.parse(JSON.stringify(self));
    };
    const self = emit(pid);
    expect(self.hpf).toEqual([id]);
    expect(emit(otherPid).hpf).toEqual([]);
    apply(client, self);
    expect(client.hauntedPumpkinsFound).toEqual([id]);
    apply(client, { id: pid });
    expect(client.hauntedPumpkinsFound).toEqual([id]);
    meta.hauntedPumpkins.clear();
    apply(client, emit(pid));
    expect(client.hauntedPumpkinsFound).toEqual([]);
  });
});
