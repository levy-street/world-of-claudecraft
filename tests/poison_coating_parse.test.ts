import { assert, describe, expect, it } from 'vitest';
import { createParseCounters } from '../server/parse/counters';
import { ParseRecorder } from '../server/parse/recorder';
import { applyPoisonCoats } from '../src/sim/combat/poison_coating';
import { BUILTIN_WORLD } from '../src/sim/data';
import { Sim } from '../src/sim/sim';
import { FAKE_PARSE_FLAGS, fakeSim } from './helpers/parse_fake_sim';

describe('poison stack attribution in recorded fights', () => {
  it('records each applier and stack count when an older aura slot refreshes', () => {
    const sim = new Sim({
      seed: 3,
      playerClass: 'rogue',
      noPlayer: true,
      world: { ...BUILTIN_WORLD, camps: [], npcs: {}, groundObjects: [] },
    });
    const players = ['First', 'Second', 'Target', 'Partner'].map((name) => {
      const id = sim.addPlayer('rogue', name);
      sim.setPlayerLevel(20, id);
      const player = sim.entities.get(id);
      assert(player);
      return player;
    });
    const [first, second, target] = players;
    for (const rogue of [first, second]) {
      sim.castAbility('deadly_poison', rogue.id);
      for (let i = 0; i < 5; i++) sim.tick();
      expect(rogue.auras.some((a) => a.id === 'deadly_poison')).toBe(true);
    }
    sim.drainEvents();
    const observed = fakeSim();
    const match = {
      id: 1,
      format: '2v2',
      teamA: [first.id, second.id],
      teamB: [target.id, players[3].id],
      state: 'active',
      ratingA: 1500,
      ratingB: 1500,
      defeated: new Set<number>(),
    };
    for (const player of players) {
      observed.entities.set(player.id, player);
      observed.arenaMatches.set(player.id, match);
    }
    const records: Record<string, unknown>[] = [];
    const recorder = new ParseRecorder({
      flags: FAKE_PARSE_FLAGS,
      sim: observed,
      sink: { enqueue: (record) => records.push(record) },
      counters: createParseCounters(),
      resolveParticipant: (pid) => ({
        entityId: pid,
        characterId: pid + 1000,
        name: `Player${pid}`,
        class: 'rogue',
        spec: 'assassination',
        level: 20,
        team: null,
        snapshot: {},
      }),
      idFactory: () => 'poison-fight',
      clock: () => 0,
    });
    recorder.observe([]);
    for (const [attacker, stacks] of [
      [first, 1],
      [second, 1],
      [first, 2],
      [second, 2],
      [first, 3],
    ] as const) {
      applyPoisonCoats(sim.ctx, attacker, target);
      const events = sim.drainEvents();
      observed.tickCount++;
      recorder.observe(events);
      expect(events).toContainEqual(
        expect.objectContaining({
          type: 'aura',
          targetId: target.id,
          sourceId: attacker.id,
          abilityId: 'deadly_poison',
          stacks,
          gained: true,
          ...(stacks > 1 ? { refresh: true } : {}),
        }),
      );
      const recorded = records.filter((r) => r.t === 'ev').at(-1);
      expect(recorded?.x).toMatchObject({
        auraSourceId: attacker.id,
        auraId: 'deadly_poison',
        auraStacks: stacks,
      });
    }
    expect(
      target.auras.filter((a) => a.id === 'deadly_poison').map((a) => [a.sourceId, a.stacks]),
    ).toEqual([
      [first.id, 3],
      [second.id, 2],
    ]);
  });
});
