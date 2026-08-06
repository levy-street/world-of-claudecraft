import { describe, expect, test } from 'vitest';
import type { FightParticipant } from '../server/parse/contract';
import { createParseCounters } from '../server/parse/counters';
import { ParseRecorder } from '../server/parse/recorder';
import type { InstanceSlotView, RecorderEntityView, RiftInstanceView } from '../server/parse/types';
import type { SimEvent } from '../src/sim/types';
import { FAKE_PARSE_FLAGS, type FakeSim, fakeSim } from './helpers/parse_fake_sim';

function player(id: number): RecorderEntityView {
  return { id, templateId: 'mage', level: 20, dead: false };
}

const FLAGS = FAKE_PARSE_FLAGS;

/** Players are ids under 100 (they have sessions); mobs never resolve. */
function makeRecorder(sim: FakeSim) {
  const records: Record<string, unknown>[] = [];
  const counters = createParseCounters();
  let seq = 0;
  const recorder = new ParseRecorder({
    flags: FLAGS,
    sim,
    sink: { enqueue: (r) => records.push(r) },
    counters,
    resolveParticipant: (pid): FightParticipant | null => {
      if (pid >= 100) return null;
      const entity = sim.entities.get(pid);
      if (entity === undefined) return null;
      return {
        entityId: pid,
        characterId: pid + 1000,
        name: `Char${pid}`,
        class: entity.templateId,
        spec: null,
        level: entity.level,
        team: null,
        snapshot: null,
      };
    },
    isBossTemplate: (templateId) => templateId === 'morthen' || templateId === 'nythraxis',
    idFactory: () => `fight-${seq++}`,
    clock: () => 0,
  });
  return { recorder, records, counters };
}

function dmg(sourceId: number, targetId: number, amount: number): SimEvent {
  return {
    type: 'damage',
    sourceId,
    targetId,
    amount,
    crit: false,
    school: 'physical',
    ability: 'Strike',
    kind: 'hit',
  };
}

function seedDungeon(sim: FakeSim, overrides: Partial<InstanceSlotView> = {}): InstanceSlotView {
  const slot: InstanceSlotView = {
    dungeonId: 'hollow_crypt',
    difficulty: 'heroic',
    slot: 0,
    partyKey: 'party:1',
    mobIds: [500, 501],
    ...overrides,
  };
  sim.instances = [slot];
  sim.entities.set(5, player(5));
  sim.entities.set(6, player(6));
  sim.entities.set(500, {
    id: 500,
    templateId: 'morthen',
    level: 20,
    hp: 5000,
    maxHp: 5000,
    dead: false,
    inCombat: true,
    threat: new Map([
      [5, 100],
      [6, 40],
    ]),
  });
  sim.entities.set(501, {
    id: 501,
    templateId: 'crypt_skeleton',
    level: 19,
    hp: 400,
    maxHp: 400,
    dead: false,
    inCombat: true,
  });
  return slot;
}

describe('DungeonSegmenter via ParseRecorder', () => {
  test('first player-vs-boss damage opens a boss fight seeded from the threat table', () => {
    const sim = fakeSim();
    seedDungeon(sim);
    const { recorder, records } = makeRecorder(sim);

    sim.tickCount = 10;
    recorder.observe([]);
    sim.tickCount = 11;
    recorder.observe([dmg(5, 500, 120)]);

    const open = records.find((r) => r.t === 'fight_open');
    expect(open).toMatchObject({
      surface: 'dungeon',
      key: 'hollow_crypt',
      difficulty: 'heroic',
      segment: 'boss',
      groupType: 'party',
    });
    const participants = (open as { participants: FightParticipant[] }).participants;
    expect(participants.map((p) => p.entityId).sort()).toEqual([5, 6]);
    expect(records.filter((r) => r.t === 'ev')).toHaveLength(1);
  });

  test('boss death closes the fight as a kill with the death event inside', () => {
    const sim = fakeSim();
    seedDungeon(sim);
    const { recorder, records } = makeRecorder(sim);

    sim.tickCount = 10;
    recorder.observe([]);
    sim.tickCount = 11;
    recorder.observe([dmg(5, 500, 120)]);
    const boss = sim.entities.get(500);
    if (boss !== undefined) boss.dead = true;
    sim.tickCount = 30;
    recorder.observe([dmg(5, 500, 5000), { type: 'death', entityId: 500, killerId: 5 }]);

    const close = records.find((r) => r.t === 'fight_close');
    expect(close).toMatchObject({ outcome: 'kill', endedTick: 30 });
    const deathEvents = records.filter(
      (r) => r.t === 'ev' && (r.ev as { type: string }).type === 'death',
    );
    expect(deathEvents).toHaveLength(1);
  });

  test('a boss leash-reset with participants alive closes as reset, all dead as wipe', () => {
    for (const [aliveAfter, expected] of [
      [true, 'reset'],
      [false, 'wipe'],
    ] as const) {
      const sim = fakeSim();
      seedDungeon(sim);
      const { recorder, records } = makeRecorder(sim);

      sim.tickCount = 10;
      recorder.observe([]);
      sim.tickCount = 11;
      recorder.observe([dmg(5, 500, 120)]);
      const boss = sim.entities.get(500);
      if (boss !== undefined) {
        boss.inCombat = false;
        boss.hp = 5000;
      }
      for (const pid of [5, 6]) {
        const p = sim.entities.get(pid);
        if (p !== undefined) p.dead = !aliveAfter;
      }
      sim.tickCount = 40;
      recorder.observe([]);

      expect(records.find((r) => r.t === 'fight_close')).toMatchObject({ outcome: expected });
    }
  });

  test('non-boss combat opens a trash segment that closes after 5 quiet seconds', () => {
    const sim = fakeSim();
    seedDungeon(sim);
    const { recorder, records } = makeRecorder(sim);

    sim.tickCount = 10;
    recorder.observe([]);
    sim.tickCount = 11;
    recorder.observe([dmg(5, 501, 60)]);

    expect(records.find((r) => r.t === 'fight_open')).toMatchObject({ segment: 'trash' });

    sim.tickCount = 111;
    recorder.observe([]);
    sim.tickCount = 112;
    recorder.observe([]);

    expect(records.find((r) => r.t === 'fight_close')).toMatchObject({ outcome: 'clear' });
  });

  test('a boss pull during trash closes the trash segment and opens the boss fight', () => {
    const sim = fakeSim();
    seedDungeon(sim);
    const { recorder, records } = makeRecorder(sim);

    sim.tickCount = 10;
    recorder.observe([]);
    sim.tickCount = 11;
    recorder.observe([dmg(5, 501, 60)]);
    sim.tickCount = 12;
    recorder.observe([dmg(5, 500, 120)]);

    const opens = records.filter((r) => r.t === 'fight_open');
    expect(opens.map((o) => o.segment)).toEqual(['trash', 'boss']);
    const closes = records.filter((r) => r.t === 'fight_close');
    expect(closes).toHaveLength(1);
    expect(closes[0]).toMatchObject({ outcome: 'clear' });
  });

  test('nythraxis_boss_arena fights record as raid fights', () => {
    const sim = fakeSim();
    seedDungeon(sim, { dungeonId: 'nythraxis_boss_arena', mobIds: [500] });
    const boss = sim.entities.get(500);
    if (boss !== undefined) boss.templateId = 'nythraxis';
    const { recorder, records } = makeRecorder(sim);

    sim.tickCount = 10;
    recorder.observe([]);
    sim.tickCount = 11;
    recorder.observe([dmg(5, 500, 120)]);

    expect(records.find((r) => r.t === 'fight_open')).toMatchObject({
      surface: 'raid',
      groupType: 'raid',
      segment: 'boss',
    });
  });

  test('slot vacancy closes an open boss fight as reset', () => {
    const sim = fakeSim();
    const slot = seedDungeon(sim);
    const { recorder, records } = makeRecorder(sim);

    sim.tickCount = 10;
    recorder.observe([]);
    sim.tickCount = 11;
    recorder.observe([dmg(5, 500, 120)]);
    (slot as { partyKey: string | null }).partyKey = null;
    sim.tickCount = 20;
    recorder.observe([]);

    expect(records.find((r) => r.t === 'fight_close')).toMatchObject({ outcome: 'reset' });
  });

  test('a healer never on the threat table late-joins on their first heal', () => {
    const sim = fakeSim();
    seedDungeon(sim);
    sim.entities.set(7, player(7));
    const { recorder, records } = makeRecorder(sim);

    sim.tickCount = 10;
    recorder.observe([]);
    sim.tickCount = 11;
    recorder.observe([dmg(5, 500, 120)]);
    sim.tickCount = 12;
    recorder.observe([
      {
        type: 'heal2',
        sourceId: 7,
        targetId: 5,
        amount: 300,
        crit: false,
        ability: 'Renew',
      },
    ]);

    const join = records.find((r) => r.t === 'join');
    expect(join).toMatchObject({ tick: 12 });
    expect((join as { participant: FightParticipant }).participant.entityId).toBe(7);
  });
});

describe('RiftSegmenter via ParseRecorder', () => {
  function seedRift(sim: FakeSim, overrides: Partial<RiftInstanceView> = {}): RiftInstanceView {
    sim.entities.set(5, player(5));
    sim.entities.set(6, player(6));
    const inst: RiftInstanceView = {
      instanceId: 42,
      tier: 'A',
      baseLevel: 52,
      floorIndex: 0,
      floorCount: 3,
      bossId: 600,
      outcome: 'active',
      memberIds: new Set([5, 6]),
      portalId: 9,
      ...overrides,
    };
    sim.riftInstances = [inst];
    sim.naturalRiftPortals = [{ id: 9, zoneName: 'Galecrest' }];
    return inst;
  }

  test('an active rift opens a floor fight with the rift frame', () => {
    const sim = fakeSim();
    seedRift(sim);
    const { recorder, records } = makeRecorder(sim);

    sim.tickCount = 10;
    recorder.observe([]);

    expect(records.find((r) => r.t === 'fight_open')).toMatchObject({
      surface: 'rift',
      segment: 'floor',
      difficulty: 'A',
      rift: { rank: 'A', baseLevel: 52, floor: 0, portalZone: 'Galecrest' },
    });
  });

  test('descending closes the floor as clear and opens the next floor', () => {
    const sim = fakeSim();
    const inst = seedRift(sim);
    const { recorder, records } = makeRecorder(sim);

    sim.tickCount = 10;
    recorder.observe([]);
    (inst as { floorIndex: number }).floorIndex = 1;
    sim.tickCount = 200;
    recorder.observe([]);

    expect(records.filter((r) => r.t === 'fight_open')).toHaveLength(2);
    expect(records.find((r) => r.t === 'fight_close')).toMatchObject({ outcome: 'clear' });
    const second = records.filter((r) => r.t === 'fight_open')[1] as { rift: { floor: number } };
    expect(second.rift.floor).toBe(1);
  });

  test('rift outcomes map to clear, wipe, and abandon', () => {
    for (const [riftOutcome, expected] of [
      ['won', 'clear'],
      ['lost', 'wipe'],
      ['abandoned', 'abandon'],
    ] as const) {
      const sim = fakeSim();
      const inst = seedRift(sim);
      const { recorder, records } = makeRecorder(sim);

      sim.tickCount = 10;
      recorder.observe([]);
      (inst as { outcome: string }).outcome = riftOutcome;
      sim.tickCount = 500;
      recorder.observe([]);

      expect(records.find((r) => r.t === 'fight_close')).toMatchObject({ outcome: expected });
    }
  });
});

describe('BossCastSynthesizer via ParseRecorder', () => {
  test('boss casting transitions synthesize start, interrupted, and stop records', () => {
    const sim = fakeSim();
    seedDungeon(sim);
    const boss = sim.entities.get(500);
    const { recorder, records } = makeRecorder(sim);

    sim.tickCount = 10;
    recorder.observe([]);
    sim.tickCount = 11;
    recorder.observe([dmg(5, 500, 100)]);

    if (boss !== undefined) {
      boss.castingAbility = 'grave_bolt';
      boss.castTotal = 2.5;
      boss.castRemaining = 2.5;
    }
    sim.tickCount = 12;
    recorder.observe([]);
    // Interrupted: the cast vanishes with most of it remaining.
    if (boss !== undefined) {
      boss.castingAbility = null;
      boss.castRemaining = 2.1;
    }
    sim.tickCount = 13;
    recorder.observe([]);
    // A second cast that completes: remaining decays to ~0 before it clears.
    if (boss !== undefined) {
      boss.castingAbility = 'grave_bolt';
      boss.castRemaining = 2.5;
    }
    sim.tickCount = 14;
    recorder.observe([]);
    if (boss !== undefined) boss.castRemaining = 0.05;
    sim.tickCount = 15;
    recorder.observe([]);
    if (boss !== undefined) boss.castingAbility = null;
    sim.tickCount = 16;
    recorder.observe([]);

    const casts = records.filter((r) => r.t === 'bosscast');
    expect(casts.map((c) => c.action)).toEqual(['start', 'interrupted', 'start', 'stop']);
    expect(casts[0]).toMatchObject({ bossId: 500, ability: 'grave_bolt', castTotal: 2.5 });
  });
});

describe('DungeonSegmenter remaining arms', () => {
  test('slot vacancy closes an open trash segment as abandon', () => {
    const sim = fakeSim();
    const slot = seedDungeon(sim);
    const { recorder, records } = makeRecorder(sim);

    sim.tickCount = 10;
    recorder.observe([]);
    sim.tickCount = 11;
    recorder.observe([dmg(5, 501, 60)]);
    (slot as { partyKey: string | null }).partyKey = null;
    sim.tickCount = 20;
    recorder.observe([]);

    expect(records.find((r) => r.t === 'fight_close')).toMatchObject({ outcome: 'abandon' });
  });

  test('a closed boss fight is deindexed: the next pull opens a fresh fight', () => {
    const sim = fakeSim();
    seedDungeon(sim);
    const { recorder, records } = makeRecorder(sim);

    sim.tickCount = 10;
    recorder.observe([]);
    sim.tickCount = 11;
    recorder.observe([dmg(5, 500, 120)]);
    const boss = sim.entities.get(500);
    if (boss !== undefined) boss.dead = true;
    sim.tickCount = 30;
    recorder.observe([]);
    const firstFightId = (records.find((r) => r.t === 'fight_open') as { fightId: string }).fightId;

    if (boss !== undefined) boss.dead = false;
    sim.tickCount = 40;
    recorder.observe([dmg(5, 500, 50)]);

    const evsToClosed = records.filter(
      (r) => r.t === 'ev' && r.fightId === firstFightId && r.tick === 40,
    );
    expect(evsToClosed).toHaveLength(0);
    const opens = records.filter((r) => r.t === 'fight_open');
    expect(opens).toHaveLength(2);
  });

  test('a disabled dungeon surface records nothing for instance combat', () => {
    const sim = fakeSim();
    seedDungeon(sim);
    const records: Record<string, unknown>[] = [];
    const recorder = new ParseRecorder({
      flags: { ...FLAGS, surfaces: new Set(['arena', 'battleground', 'raid', 'rift']) },
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
              spec: null,
              level: 20,
              team: null,
              snapshot: null,
            },
      isBossTemplate: (t) => t === 'morthen',
      idFactory: () => 'x',
      clock: () => 0,
    });

    sim.tickCount = 10;
    recorder.observe([]);
    sim.tickCount = 11;
    recorder.observe([dmg(5, 500, 120)]);

    expect(records).toHaveLength(0);
  });
});

describe('RiftSegmenter remaining arms', () => {
  function seedRift2(sim: FakeSim, overrides: Partial<RiftInstanceView> = {}): RiftInstanceView {
    sim.entities.set(5, player(5));
    sim.entities.set(6, player(6));
    const inst: RiftInstanceView = {
      instanceId: 42,
      tier: 'A',
      baseLevel: 52,
      floorIndex: 0,
      floorCount: 3,
      bossId: 600,
      outcome: 'active',
      memberIds: new Set([5]),
      portalId: 9,
      ...overrides,
    };
    sim.riftInstances = [inst];
    sim.naturalRiftPortals = [{ id: 9, zoneName: 'Galecrest' }];
    return inst;
  }

  test('a vanished rift instance closes as abandon', () => {
    const sim = fakeSim();
    seedRift2(sim);
    const { recorder, records } = makeRecorder(sim);

    sim.tickCount = 10;
    recorder.observe([]);
    sim.riftInstances = [];
    sim.tickCount = 20;
    recorder.observe([]);

    expect(records.find((r) => r.t === 'fight_close')).toMatchObject({ outcome: 'abandon' });
  });

  test('membership growth late-joins the new member', () => {
    const sim = fakeSim();
    const inst = seedRift2(sim);
    const { recorder, records } = makeRecorder(sim);

    sim.tickCount = 10;
    recorder.observe([]);
    (inst.memberIds as Set<number>).add(6);
    sim.tickCount = 20;
    recorder.observe([]);

    const join = records.find((r) => r.t === 'join');
    expect(join).toBeDefined();
    expect((join as { participant: FightParticipant }).participant.entityId).toBe(6);
  });

  test('a portal-less dev rift frames with empty zone and dev rank', () => {
    const sim = fakeSim();
    seedRift2(sim, { portalId: null, tier: null });
    const { recorder, records } = makeRecorder(sim);

    sim.tickCount = 10;
    recorder.observe([]);

    expect(records.find((r) => r.t === 'fight_open')).toMatchObject({
      rift: { rank: 'dev', portalZone: '' },
    });
  });

  test('a disabled rift surface opens nothing for an active instance', () => {
    const sim = fakeSim();
    seedRift2(sim);
    const records: Record<string, unknown>[] = [];
    const recorder = new ParseRecorder({
      flags: { ...FLAGS, surfaces: new Set(['arena', 'battleground', 'raid', 'dungeon']) },
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
              spec: null,
              level: 20,
              team: null,
              snapshot: null,
            },
      idFactory: () => 'x',
      clock: () => 0,
    });

    sim.tickCount = 10;
    recorder.observe([]);

    expect(records).toHaveLength(0);
  });
});

describe('BossCastSynthesizer ability change', () => {
  test('switching casts mid-cast emits the interrupted end and the new start in one tick', () => {
    const sim = fakeSim();
    seedDungeon(sim);
    const boss = sim.entities.get(500);
    const { recorder, records } = makeRecorder(sim);

    sim.tickCount = 10;
    recorder.observe([]);
    sim.tickCount = 11;
    recorder.observe([dmg(5, 500, 100)]);
    if (boss !== undefined) {
      boss.castingAbility = 'grave_bolt';
      boss.castTotal = 2.5;
      boss.castRemaining = 2.5;
    }
    sim.tickCount = 12;
    recorder.observe([]);
    if (boss !== undefined) {
      boss.castingAbility = 'bone_shield';
      boss.castTotal = 1.5;
      boss.castRemaining = 1.5;
    }
    sim.tickCount = 13;
    recorder.observe([]);

    const casts = records.filter((r) => r.t === 'bosscast');
    expect(casts.map((c) => [c.ability, c.action])).toEqual([
      ['grave_bolt', 'start'],
      ['grave_bolt', 'interrupted'],
      ['bone_shield', 'start'],
    ]);
  });
});

describe('review regressions: relog and slot teardown', () => {
  test('a mid-fight relog re-points the entity index without a duplicate join or lost rollup', () => {
    const sim = fakeSim();
    seedDungeon(sim);
    // Pid 55 is the SAME character as pid 5 (a relog: pids are per-login).
    sim.entities.set(55, player(55));
    const records: Record<string, unknown>[] = [];
    const counters = createParseCounters();
    let resolves = 0;
    const recorder = new ParseRecorder({
      flags: FLAGS,
      sim,
      sink: { enqueue: (r) => records.push(r) },
      counters,
      resolveParticipant: (pid): FightParticipant | null => {
        if (pid >= 100) return null;
        const entity = sim.entities.get(pid);
        if (entity === undefined) return null;
        resolves++;
        const characterId = pid === 55 ? 1005 : pid + 1000;
        return {
          entityId: pid,
          characterId,
          name: `Char${characterId}`,
          class: 'mage',
          spec: null,
          level: 20,
          team: null,
          snapshot: null,
        };
      },
      isBossTemplate: (t) => t === 'morthen',
      idFactory: () => 'fight-0',
      clock: () => 0,
    });

    sim.tickCount = 10;
    recorder.observe([]);
    sim.tickCount = 11;
    recorder.observe([dmg(5, 500, 100)]);
    // The relogged entity acts twice; only the FIRST event may re-resolve.
    const resolvesBeforeRelog = resolves;
    sim.tickCount = 12;
    recorder.observe([dmg(55, 500, 40)]);
    sim.tickCount = 13;
    recorder.observe([dmg(55, 500, 60)]);
    const boss = sim.entities.get(500);
    if (boss !== undefined) boss.dead = true;
    sim.tickCount = 20;
    recorder.observe([]);

    expect(records.filter((r) => r.t === 'join')).toHaveLength(0);
    const close = records.find((r) => r.t === 'fight_close') as Record<string, unknown>;
    const rollup = (close.rollup as { perParticipant: Record<string, { damage: number }> })
      .perParticipant;
    expect(rollup['1005']?.damage).toBe(200);
    // Exactly one extra resolve for the relogged pid, then the index serves.
    expect(resolves).toBe(resolvesBeforeRelog + 1);
  });

  test('a freed slot whose live mobIds were emptied in place still unregisters its roster', () => {
    const sim = fakeSim();
    const slot = seedDungeon(sim);
    const { recorder, records } = makeRecorder(sim);

    sim.tickCount = 10;
    recorder.observe([]);
    // freeInstance nulls partyKey AND reassigns mobIds = [] on the SAME live
    // object the segmenter holds; the unregister set must not come from it.
    (slot as { partyKey: string | null }).partyKey = null;
    (slot as { mobIds: readonly number[] }).mobIds = [];
    sim.tickCount = 20;
    recorder.observe([]);

    sim.tickCount = 21;
    recorder.observe([dmg(5, 501, 60)]);

    // A stale mobToSlot entry would open a fight against the dead slot state.
    expect(records.filter((r) => r.t === 'fight_open')).toHaveLength(0);
  });
});
