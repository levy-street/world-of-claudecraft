import { describe, expect, test } from 'vitest';
import type { FightParticipant } from '../server/parse/contract';
import { createParseCounters } from '../server/parse/counters';
import { OpenFight } from '../server/parse/fights';
import { ParseRecorder } from '../server/parse/recorder';
import {
  MAX_SAMPLED_MOBS,
  ThreatSampler,
  TICKS_PER_THREAT_SAMPLE,
  TOP_THREAT_ENTRIES,
} from '../server/parse/threat_sampler';
import type { RecorderEntityView, RecordSink, SegmenterHost } from '../server/parse/types';
import type { SimEvent } from '../src/sim/types';
import { FAKE_PARSE_FLAGS, type FakeSim, fakeSim } from './helpers/parse_fake_sim';

function mob(
  id: number,
  threat: [number, number][],
  opts: { boss?: boolean; aggroTargetId?: number | null } = {},
): RecorderEntityView {
  return {
    id,
    templateId: opts.boss === true ? 'boss_nythraxis' : 'thornpeak_wolf',
    name: `Mob${id}`,
    level: 20,
    threat: new Map(threat),
    aggroTargetId: opts.aggroTargetId ?? null,
  };
}

interface Harness {
  sampler: ThreatSampler;
  host: SegmenterHost;
  fight: OpenFight;
  sim: FakeSim;
  records: Record<string, unknown>[];
  samples: () => Record<string, unknown>[];
}

function harness(): Harness {
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
      participants: [],
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
    sampler: new ThreatSampler(),
    host,
    fight,
    sim,
    records,
    samples: () => records.filter((r) => r.t === 'sample' && r.kind === 'threat'),
  };
}

describe('ThreatSampler', () => {
  test('samples once per second, not every tick', () => {
    const h = harness();
    h.sim.entities.set(50, mob(50, [[5, 1200]]));
    h.fight.mobIds.add(50);

    for (let tick = 0; tick <= TICKS_PER_THREAT_SAMPLE * 3; tick++) {
      h.sampler.observe(h.host, tick, [h.fight]);
    }

    // Ticks 0, 20, 40 and 60 across a 3-second span.
    expect(h.samples()).toHaveLength(4);
    expect(h.samples().map((s) => s.tick)).toEqual([0, 20, 40, 60]);
  });

  test('encodes mob id, aggro target, then source and threat pairs highest first', () => {
    const h = harness();
    h.sim.entities.set(
      50,
      mob(
        50,
        [
          [5, 900],
          [6, 2400],
          [7, 1500],
        ],
        { aggroTargetId: 6 },
      ),
    );
    h.fight.mobIds.add(50);

    h.sampler.observe(h.host, 20, [h.fight]);

    const sample = h.samples()[0];
    expect(sample).toMatchObject({ t: 'sample', fightId: 'fight-1', tick: 20, kind: 'threat' });
    expect(sample?.data).toEqual([[50, 6, 6, 2400, 7, 1500, 5, 900]]);
  });

  test('writes 0 for the aggro target when the mob is locked on nobody', () => {
    const h = harness();
    h.sim.entities.set(50, mob(50, [[5, 100]], { aggroTargetId: null }));
    h.fight.mobIds.add(50);

    h.sampler.observe(h.host, 20, [h.fight]);

    expect(h.samples()[0]?.data).toEqual([[50, 0, 5, 100]]);
  });

  test('rounds fractional threat, matching the sim threatEntries wire shape', () => {
    const h = harness();
    h.sim.entities.set(50, mob(50, [[5, 1200.6]]));
    h.fight.mobIds.add(50);

    h.sampler.observe(h.host, 20, [h.fight]);

    expect(h.samples()[0]?.data).toEqual([[50, 0, 5, 1201]]);
  });

  test('keeps only the top table entries per mob', () => {
    const h = harness();
    const table: [number, number][] = [];
    for (let i = 0; i < TOP_THREAT_ENTRIES + 5; i++) table.push([i + 1, (i + 1) * 100]);
    h.sim.entities.set(50, mob(50, table));
    h.fight.mobIds.add(50);

    h.sampler.observe(h.host, 20, [h.fight]);

    const data = h.samples()[0]?.data as number[][] | undefined;
    const entry = data?.[0] ?? [];
    // Two header numbers plus a pair per kept entry.
    expect(entry).toHaveLength(2 + TOP_THREAT_ENTRIES * 2);
    expect(entry[2]).toBe(TOP_THREAT_ENTRIES + 5);
  });

  test('skips mobs with an empty hate table', () => {
    const h = harness();
    h.sim.entities.set(50, mob(50, []));
    h.sim.entities.set(51, mob(51, [[5, 300]]));
    h.fight.mobIds.add(50);
    h.fight.mobIds.add(51);

    h.sampler.observe(h.host, 20, [h.fight]);

    expect(h.samples()[0]?.data).toEqual([[51, 0, 5, 300]]);
  });

  test('emits nothing for a fight tracking no mobs', () => {
    const h = harness();

    h.sampler.observe(h.host, 20, [h.fight]);

    expect(h.samples()).toHaveLength(0);
  });

  test('emits nothing when every tracked mob has left the sim', () => {
    const h = harness();
    h.fight.mobIds.add(50);

    h.sampler.observe(h.host, 20, [h.fight]);

    expect(h.samples()).toHaveLength(0);
  });

  test('caps sampled mobs and keeps the boss when an add wave outnumbers the cap', () => {
    const h = harness();
    // The boss is added LAST, so insertion order alone would drop it.
    for (let i = 0; i < MAX_SAMPLED_MOBS + 6; i++) {
      const id = 100 + i;
      h.sim.entities.set(id, mob(id, [[5, 50]]));
      h.fight.mobIds.add(id);
    }
    h.sim.entities.set(999, mob(999, [[5, 9000]], { boss: true, aggroTargetId: 5 }));
    h.fight.mobIds.add(999);

    h.sampler.observe(h.host, 20, [h.fight]);

    const data = h.samples()[0]?.data as number[][];
    expect(data).toHaveLength(MAX_SAMPLED_MOBS);
    expect(data.map((entry) => entry[0])).toContain(999);
  });

  test('samples every open fight independently', () => {
    const h = harness();
    const second = new OpenFight(
      {
        fightId: 'fight-2',
        surface: 'raid',
        key: 'nythraxis',
        difficulty: 'heroic',
        segment: 'trash',
        groupType: 'raid',
        startedTick: 0,
        participants: [],
      },
      { enqueue: (r) => h.records.push(r) },
      createParseCounters(),
    );
    h.sim.entities.set(50, mob(50, [[5, 100]]));
    h.sim.entities.set(60, mob(60, [[6, 200]]));
    h.fight.mobIds.add(50);
    second.mobIds.add(60);

    h.sampler.observe(h.host, 20, [h.fight, second]);

    expect(h.samples().map((s) => s.fightId)).toEqual(['fight-1', 'fight-2']);
  });
});

describe('ParseRecorder threat wiring', () => {
  test('ships threat samples for a live dungeon fight', () => {
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
    sim.entities.set(5, { id: 5, templateId: 'mage', name: 'Player5', level: 20, dead: false });
    sim.entities.set(500, {
      id: 500,
      templateId: 'morthen',
      name: 'Morthen the Gravecaller',
      level: 20,
      hp: 5000,
      maxHp: 5000,
      dead: false,
      inCombat: true,
      threat: new Map([[5, 4300]]),
      aggroTargetId: 5,
    });
    const recorder = new ParseRecorder({
      flags: FAKE_PARSE_FLAGS,
      sim,
      sink: { enqueue: (r) => records.push(r) },
      counters: createParseCounters(),
      resolveParticipant: (pid): FightParticipant | null =>
        pid >= 100
          ? null
          : {
              entityId: pid,
              characterId: pid + 1000,
              name: `Char${pid}`,
              class: 'mage',
              spec: 'frost',
              level: 20,
              team: null,
              snapshot: null,
            },
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

    // The first player-vs-instance-mob hit event-opens the fight; the sampler
    // then fires on the next second boundary.
    sim.tickCount = 11;
    recorder.observe([hit]);
    sim.tickCount = 20;
    recorder.observe([]);

    const samples = records.filter((r) => r.t === 'sample' && r.kind === 'threat');
    expect(samples).toHaveLength(1);
    expect(samples[0]).toMatchObject({ fightId: 'fight-0', tick: 20, kind: 'threat' });
    expect(samples[0]?.data).toEqual([[500, 5, 5, 4300]]);
  });
});
