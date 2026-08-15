import { describe, expect, test } from 'vitest';
import type { FightParticipant } from '../server/parse/contract';
import { createParseCounters } from '../server/parse/counters';
import { OpenFight } from '../server/parse/fights';
import { ParseRecorder } from '../server/parse/recorder';
import {
  MAX_SAMPLED_MOBS,
  RESOURCE_TYPE_CODES,
  ResourceSampler,
  resourceTypeCode,
  TICKS_PER_RESOURCE_SAMPLE,
} from '../server/parse/resource_sampler';
import type { RecorderEntityView, RecordSink, SegmenterHost } from '../server/parse/types';
import type { SimEvent } from '../src/sim/types';
import { FAKE_PARSE_FLAGS, type FakeSim, fakeSim } from './helpers/parse_fake_sim';

function player(id: number, over: Partial<RecorderEntityView> = {}): RecorderEntityView {
  return {
    id,
    templateId: 'warrior',
    name: `Player${id}`,
    level: 20,
    dead: false,
    hp: 900,
    maxHp: 1200,
    resource: 45,
    maxResource: 100,
    resourceType: 'rage',
    ...over,
  };
}

function participant(id: number): FightParticipant {
  return {
    entityId: id,
    characterId: id + 1000,
    name: `Char${id}`,
    class: 'warrior',
    spec: 'fury',
    level: 20,
    team: null,
    snapshot: null,
  };
}

interface Harness {
  sampler: ResourceSampler;
  host: SegmenterHost;
  fight: OpenFight;
  sim: FakeSim;
  samples: () => Record<string, unknown>[];
}

function harness(participants: FightParticipant[] = []): Harness {
  const sim = fakeSim();
  const records: Record<string, unknown>[] = [];
  const sink: RecordSink = { enqueue: (r) => records.push(r) };
  const counters = createParseCounters();
  const fight = new OpenFight(
    {
      fightId: 'fight-1',
      surface: 'raid',
      key: 'nythraxis',
      difficulty: 'heroic',
      segment: 'boss',
      groupType: 'raid',
      startedTick: 0,
      participants,
    },
    sink,
    counters,
  );
  const host: SegmenterHost = {
    sim,
    sink,
    counters,
    resolveParticipant: () => null,
    nextFightId: () => 'fight-x',
    surfaceEnabled: () => true,
    isBossTemplate: (templateId) => templateId.startsWith('boss_'),
  };
  return {
    sampler: new ResourceSampler(),
    host,
    fight,
    sim,
    samples: () => records.filter((r) => r.t === 'sample' && r.kind === 'res'),
  };
}

/** The sample's data rows, or [] when no sample was emitted. Keeps the
 * assertions free of indexing straight off an optional chain. */
function rows(sample: Record<string, unknown> | undefined): number[][] {
  return (sample?.data as number[][] | undefined) ?? [];
}

describe('resourceTypeCode', () => {
  test('maps every resource type to its wire code', () => {
    expect(resourceTypeCode('mana')).toBe(RESOURCE_TYPE_CODES.mana);
    expect(resourceTypeCode('rage')).toBe(RESOURCE_TYPE_CODES.rage);
    expect(resourceTypeCode('energy')).toBe(RESOURCE_TYPE_CODES.energy);
    expect(resourceTypeCode('focus')).toBe(RESOURCE_TYPE_CODES.focus);
  });

  test('codes a missing pool as 0, which is most mobs', () => {
    expect(resourceTypeCode(null)).toBe(0);
    expect(resourceTypeCode(undefined)).toBe(0);
  });

  test('gives every type a distinct non-zero code', () => {
    const codes = Object.values(RESOURCE_TYPE_CODES);
    expect(new Set(codes).size).toBe(codes.length);
    expect(codes).not.toContain(0);
  });
});

describe('ResourceSampler', () => {
  test('samples once per second, not every tick', () => {
    const h = harness([participant(5)]);
    h.sim.entities.set(5, player(5));

    for (let tick = 0; tick <= TICKS_PER_RESOURCE_SAMPLE * 3; tick++) {
      h.sampler.observe(h.host, tick, [h.fight]);
    }

    expect(h.samples().map((s) => s.tick)).toEqual([0, 20, 40, 60]);
  });

  test('encodes entity, health, resource and the type code', () => {
    const h = harness([participant(5)]);
    h.sim.entities.set(5, player(5, { hp: 900, maxHp: 1200, resource: 45, maxResource: 100 }));

    h.sampler.observe(h.host, 20, [h.fight]);

    const sample = h.samples()[0];
    expect(sample).toMatchObject({ t: 'sample', fightId: 'fight-1', tick: 20, kind: 'res' });
    expect(sample?.data).toEqual([[5, 900, 1200, 45, 100, RESOURCE_TYPE_CODES.rage]]);
  });

  test('rounds fractional pools, which the sim carries as floats', () => {
    const h = harness([participant(5)]);
    h.sim.entities.set(5, player(5, { hp: 899.6, resource: 44.4 }));

    h.sampler.observe(h.host, 20, [h.fight]);

    expect(rows(h.samples()[0])[0]?.slice(0, 4)).toEqual([5, 900, 1200, 44]);
  });

  test('samples a dead participant at zero health rather than dropping the row', () => {
    // The death and any rez are only visible if the row keeps being emitted.
    const h = harness([participant(5)]);
    h.sim.entities.set(5, player(5, { dead: true, hp: 0, resource: 0 }));

    h.sampler.observe(h.host, 20, [h.fight]);

    expect(rows(h.samples()[0])[0]).toEqual([5, 0, 1200, 0, 100, RESOURCE_TYPE_CODES.rage]);
  });

  test('samples every participant in the fight', () => {
    const h = harness([participant(5), participant(6), participant(7)]);
    for (const id of [5, 6, 7]) h.sim.entities.set(id, player(id));

    h.sampler.observe(h.host, 20, [h.fight]);

    expect(rows(h.samples()[0]).map((e) => e[0])).toEqual([5, 6, 7]);
  });

  test('carries a caster mana pool with its own type code', () => {
    const h = harness([participant(9)]);
    h.sim.entities.set(
      9,
      player(9, { templateId: 'priest', resource: 3200, maxResource: 5000, resourceType: 'mana' }),
    );

    h.sampler.observe(h.host, 20, [h.fight]);

    expect(rows(h.samples()[0])[0]).toEqual([9, 900, 1200, 3200, 5000, RESOURCE_TYPE_CODES.mana]);
  });

  test('samples boss health but not ordinary trash', () => {
    const h = harness([participant(5)]);
    h.sim.entities.set(5, player(5));
    h.sim.entities.set(
      500,
      player(500, { templateId: 'boss_nythraxis', hp: 40_000, maxHp: 50_000, resourceType: null }),
    );
    h.sim.entities.set(501, player(501, { templateId: 'thornpeak_wolf' }));
    h.fight.mobIds.add(500);
    h.fight.mobIds.add(501);

    h.sampler.observe(h.host, 20, [h.fight]);

    const ids = rows(h.samples()[0]).map((e) => e[0]);
    expect(ids).toContain(500);
    expect(ids).not.toContain(501);
  });

  test('caps the hostile side so a big pull cannot flood the stream', () => {
    const h = harness([participant(5)]);
    h.sim.entities.set(5, player(5));
    for (let i = 0; i < MAX_SAMPLED_MOBS + 5; i++) {
      const id = 600 + i;
      h.sim.entities.set(id, player(id, { templateId: `boss_add_${i}` }));
      h.fight.mobIds.add(id);
    }

    h.sampler.observe(h.host, 20, [h.fight]);

    // One participant plus the mob cap.
    expect(rows(h.samples()[0]).length).toBe(1 + MAX_SAMPLED_MOBS);
  });

  test('emits nothing for a fight with nobody left in the sim', () => {
    const h = harness([participant(5)]);

    h.sampler.observe(h.host, 20, [h.fight]);

    expect(h.samples()).toHaveLength(0);
  });
});

describe('ParseRecorder resource wiring', () => {
  test('ships resource samples for a live dungeon fight', () => {
    const sim = fakeSim();
    const records: Record<string, unknown>[] = [];
    sim.instances = [
      {
        dungeonId: 'hollow_crypt',
        difficulty: 'heroic',
        slot: 0,
        partyKey: 'party:1',
        mobIds: [500],
      },
    ];
    sim.entities.set(
      5,
      player(5, { templateId: 'mage', resourceType: 'mana', resource: 2500, maxResource: 4000 }),
    );
    sim.entities.set(500, {
      id: 500,
      templateId: 'morthen',
      name: 'Morthen the Gravecaller',
      level: 20,
      hp: 5000,
      maxHp: 5000,
      dead: false,
      inCombat: true,
    });
    const recorder = new ParseRecorder({
      flags: FAKE_PARSE_FLAGS,
      sim,
      sink: { enqueue: (r) => records.push(r) },
      counters: createParseCounters(),
      resolveParticipant: (pid): FightParticipant | null => (pid >= 100 ? null : participant(pid)),
      isBossTemplate: (templateId) => templateId === 'morthen',
      idFactory: () => 'fight-0',
      clock: () => 0,
    });
    const hit: SimEvent = {
      type: 'damage',
      sourceId: 5,
      targetId: 500,
      amount: 120,
      crit: false,
      school: 'physical',
      ability: 'Frostbolt',
      kind: 'hit',
    };

    sim.tickCount = 11;
    recorder.observe([hit]);
    sim.tickCount = 20;
    recorder.observe([]);

    const res = records.filter((r) => r.t === 'sample' && r.kind === 'res');
    expect(res).toHaveLength(1);
    expect(res[0]).toMatchObject({ fightId: 'fight-0', tick: 20, kind: 'res' });
    // The player's mana pool, then the boss's health with no pool of its own.
    expect(res[0]?.data).toEqual([
      [5, 900, 1200, 2500, 4000, RESOURCE_TYPE_CODES.mana],
      [500, 5000, 5000, 0, 0, 0],
    ]);
  });
});
