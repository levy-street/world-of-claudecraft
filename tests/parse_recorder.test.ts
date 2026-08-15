import { describe, expect, test } from 'vitest';
import type { FightParticipant } from '../server/parse/contract';
import { createParseCounters } from '../server/parse/counters';
import { MAX_RAW_EVENTS_PER_FIGHT } from '../server/parse/fights';
import { ParseRecorder } from '../server/parse/recorder';
import type { ArenaMatchView, BgMatchView, RecorderEntityView } from '../server/parse/types';
import type { SimEvent } from '../src/sim/types';
import { FAKE_PARSE_FLAGS, type FakeSim, fakeSim } from './helpers/parse_fake_sim';

function player(id: number): RecorderEntityView {
  return { id, templateId: 'mage', name: `Player${id}`, level: 20 };
}

function participantResolver(sim: FakeSim): (pid: number) => FightParticipant | null {
  return (pid) => {
    const entity = sim.entities.get(pid);
    if (entity === undefined) return null;
    return {
      entityId: pid,
      characterId: pid + 1000,
      name: `Char${pid}`,
      class: entity.templateId,
      spec: 'frost',
      level: entity.level,
      team: null,
      snapshot: { level: entity.level },
    };
  };
}

const FLAGS = FAKE_PARSE_FLAGS;

function makeRecorder(sim: FakeSim, clock?: () => number) {
  const records: Record<string, unknown>[] = [];
  const counters = createParseCounters();
  let seq = 0;
  const recorder = new ParseRecorder({
    flags: FLAGS,
    sim,
    sink: { enqueue: (r) => records.push(r) },
    counters,
    resolveParticipant: participantResolver(sim),
    idFactory: () => `fight-${seq++}`,
    clock: clock ?? (() => 0),
  });
  return { recorder, records, counters };
}

type MutableArenaMatch = Omit<ArenaMatchView, 'defeated'> & { defeated: Set<number> };

function arenaMatch(overrides: Partial<MutableArenaMatch> = {}): MutableArenaMatch {
  return {
    id: 1,
    format: '2v2',
    teamA: [5, 6],
    teamB: [7, 8],
    state: 'active',
    ratingA: 1512,
    ratingB: 1497,
    defeated: new Set<number>(),
    ...overrides,
  };
}

function seedArena(sim: FakeSim, match: MutableArenaMatch): void {
  for (const pid of [...match.teamA, ...match.teamB]) sim.entities.set(pid, player(pid));
  // The live map is pid -> shared match object for every member.
  for (const pid of [...match.teamA, ...match.teamB]) sim.arenaMatches.set(pid, match);
}

function dmg(sourceId: number, targetId: number, amount: number, absorbed = 0): SimEvent {
  return {
    type: 'damage',
    sourceId,
    targetId,
    amount,
    crit: false,
    school: 'physical',
    ability: 'Strike',
    kind: 'hit',
    ...(absorbed > 0 ? { absorbed } : {}),
  };
}

describe('ParseRecorder arena lifecycle', () => {
  test('opens a fight with both teams when a match turns active', () => {
    const sim = fakeSim();
    const match = arenaMatch();
    seedArena(sim, match);
    const { recorder, records } = makeRecorder(sim);

    sim.tickCount = 10;
    recorder.observe([]);

    const open = records.find((r) => r.t === 'fight_open');
    expect(open).toMatchObject({
      surface: 'arena',
      key: 'arena_2v2',
      segment: 'match',
      groupType: 'team',
      startedTick: 10,
      arena: { format: '2v2', ratingA: 1512, ratingB: 1497, practice: false },
    });
    const participants = (open as { participants: FightParticipant[] }).participants;
    expect(participants).toHaveLength(4);
    expect(participants.filter((p) => p.team === 'a').map((p) => p.entityId)).toEqual([5, 6]);
    expect(participants.filter((p) => p.team === 'b').map((p) => p.entityId)).toEqual([7, 8]);
  });

  test('routes participant events and drops everything else on the first lookup', () => {
    const sim = fakeSim();
    seedArena(sim, arenaMatch());
    sim.entities.set(99, player(99));
    const { recorder, records } = makeRecorder(sim);

    sim.tickCount = 10;
    recorder.observe([]);
    sim.tickCount = 11;
    recorder.observe([dmg(5, 7, 120), dmg(99, 98, 500)]);

    const evs = records.filter((r) => r.t === 'ev');
    expect(evs).toHaveLength(1);
    expect(evs[0]).toMatchObject({ fightId: 'fight-0', tick: 11 });
    expect((evs[0] as { ev: { amount: number } }).ev.amount).toBe(120);
  });

  test('the killing blow shares the batch with the over transition and still lands', () => {
    const sim = fakeSim();
    const match = arenaMatch();
    seedArena(sim, match);
    const { recorder, records } = makeRecorder(sim);

    sim.tickCount = 10;
    recorder.observe([]);
    // Same tick: both teamB players die, the match flips to 'over'.
    sim.tickCount = 50;
    match.defeated.add(7);
    match.defeated.add(8);
    (match as { state: string }).state = 'over';
    recorder.observe([
      dmg(5, 7, 900),
      { type: 'death', entityId: 7, killerId: 5 },
      { type: 'death', entityId: 8, killerId: 6 },
    ]);

    const close = records.find((r) => r.t === 'fight_close') as Record<string, unknown>;
    expect(close).toMatchObject({ fightId: 'fight-0', outcome: 'win_a', endedTick: 50 });
    const rollup = (
      close.rollup as { perParticipant: Record<string, { damage: number; deaths: number }> }
    ).perParticipant;
    expect(rollup['1005']?.damage).toBe(900);
    expect(rollup['1007']?.deaths).toBe(1);
    // The kill events themselves were recorded before the close.
    const evTicks = records.filter((r) => r.t === 'ev').map((r) => r.tick);
    expect(evTicks).toContain(50);
    const closeIndex = records.findIndex((r) => r.t === 'fight_close');
    const lastEvIndex = records.map((r) => r.t).lastIndexOf('ev');
    expect(lastEvIndex).toBeLessThan(closeIndex);
  });

  test('a match that vanishes without reaching over closes as abandon', () => {
    const sim = fakeSim();
    const match = arenaMatch();
    seedArena(sim, match);
    const { recorder, records } = makeRecorder(sim);

    sim.tickCount = 10;
    recorder.observe([]);
    sim.arenaMatches.clear();
    sim.tickCount = 20;
    recorder.observe([]);

    expect(records.find((r) => r.t === 'fight_close')).toMatchObject({ outcome: 'abandon' });
  });

  test('fiesta and practice matches are flagged so balance queries can exclude them', () => {
    const sim = fakeSim();
    seedArena(sim, arenaMatch({ fiesta: { mode: 'chaos' } }));
    const { recorder, records } = makeRecorder(sim);

    sim.tickCount = 10;
    recorder.observe([]);

    const open = records.find((r) => r.t === 'fight_open') as { arena: { practice: boolean } };
    expect(open.arena.practice).toBe(true);
  });
});

describe('ParseRecorder enrichment', () => {
  test('pet damage carries the owner enrichment and credits the owner totals', () => {
    const sim = fakeSim();
    const match = arenaMatch();
    seedArena(sim, match);
    sim.entities.set(77, { id: 77, templateId: 'wolf', name: 'Wolf', level: 20, ownerId: 5 });
    const { recorder, records } = makeRecorder(sim);

    sim.tickCount = 10;
    recorder.observe([]);
    sim.tickCount = 11;
    recorder.observe([dmg(77, 7, 250)]);
    match.defeated.add(7);
    match.defeated.add(8);
    (match as { state: string }).state = 'over';
    sim.tickCount = 12;
    recorder.observe([]);

    const ev = records.find((r) => r.t === 'ev') as Record<string, unknown>;
    expect(ev.x).toMatchObject({ ownerId: 5 });
    const close = records.find((r) => r.t === 'fight_close') as Record<string, unknown>;
    const rollup = (close.rollup as { perParticipant: Record<string, { damage: number }> })
      .perParticipant;
    expect(rollup['1005']?.damage).toBe(250);
  });

  test('gained aura events are enriched with source, id, and stacks from live state', () => {
    const sim = fakeSim();
    seedArena(sim, arenaMatch());
    const target = sim.entities.get(7);
    if (target !== undefined) {
      (target as { auras: unknown }).auras = [{ id: 'rend', name: 'Rend', sourceId: 5, stacks: 3 }];
    }
    const { recorder, records } = makeRecorder(sim);

    sim.tickCount = 10;
    recorder.observe([]);
    sim.tickCount = 11;
    recorder.observe([{ type: 'aura', targetId: 7, name: 'Rend', gained: true }]);

    const ev = records.find((r) => r.t === 'ev') as Record<string, unknown>;
    expect(ev.x).toMatchObject({ auraSourceId: 5, auraId: 'rend', auraStacks: 3 });
  });

  test('cue-only heal2 events never enter the parse', () => {
    const sim = fakeSim();
    seedArena(sim, arenaMatch());
    const { recorder, records } = makeRecorder(sim);

    sim.tickCount = 10;
    recorder.observe([]);
    sim.tickCount = 11;
    recorder.observe([
      {
        type: 'heal2',
        sourceId: 5,
        targetId: 6,
        amount: 0,
        crit: false,
        ability: 'Renew',
        cueOnly: true,
      },
    ]);

    expect(records.filter((r) => r.t === 'ev')).toHaveLength(0);
  });

  test('absorbed damage accrues to the target totals', () => {
    const sim = fakeSim();
    const match = arenaMatch();
    seedArena(sim, match);
    const { recorder, records } = makeRecorder(sim);

    sim.tickCount = 10;
    recorder.observe([]);
    sim.tickCount = 11;
    recorder.observe([dmg(5, 7, 100, 40)]);
    match.defeated.add(7);
    match.defeated.add(8);
    (match as { state: string }).state = 'over';
    sim.tickCount = 12;
    recorder.observe([]);

    const close = records.find((r) => r.t === 'fight_close') as Record<string, unknown>;
    const rollup = (
      close.rollup as { perParticipant: Record<string, { taken: number; absorbed: number }> }
    ).perParticipant;
    expect(rollup['1007']).toMatchObject({ taken: 100, absorbed: 40 });
  });
});

describe('ParseRecorder battleground lifecycle', () => {
  function bgMatch(overrides: Partial<BgMatchView> = {}): BgMatchView {
    return {
      id: 3,
      teams: [
        [11, 12],
        [13, 14],
      ],
      state: 'active',
      winner: null,
      scores: [0, 0],
      rated: true,
      devEnded: false,
      grouped: false,
      ratingAvg: [1500, 1480],
      ...overrides,
    };
  }

  function seedBg(sim: FakeSim, match: BgMatchView): void {
    for (const pid of [...match.teams[0], ...match.teams[1]]) {
      sim.entities.set(pid, player(pid));
      sim.bgMatches.set(pid, match);
    }
  }

  test('opens with team ratings and closes win_b from the explicit winner', () => {
    const sim = fakeSim();
    const match = bgMatch();
    seedBg(sim, match);
    const { recorder, records } = makeRecorder(sim);

    sim.tickCount = 10;
    recorder.observe([]);
    (match as { state: string }).state = 'ended';
    (match as { winner: number | null }).winner = 1;
    sim.tickCount = 400;
    recorder.observe([]);

    expect(records.find((r) => r.t === 'fight_open')).toMatchObject({
      surface: 'battleground',
      key: 'thornhollow_5v5',
      arena: { format: 'thornhollow_5v5', ratingA: 1500, ratingB: 1480, practice: false },
    });
    expect(records.find((r) => r.t === 'fight_close')).toMatchObject({ outcome: 'win_b' });
  });

  test('capture score changes emit objective records', () => {
    const sim = fakeSim();
    const match = bgMatch();
    seedBg(sim, match);
    const { recorder, records } = makeRecorder(sim);

    sim.tickCount = 10;
    recorder.observe([]);
    (match.scores as [number, number])[0] = 1;
    sim.tickCount = 60;
    recorder.observe([]);

    expect(records.find((r) => r.t === 'mech')).toMatchObject({
      kind: 'objective',
      detail: 'capture_a:1',
      tick: 60,
    });
  });

  test('an unrated or dev-ended match is flagged as practice', () => {
    const sim = fakeSim();
    seedBg(sim, bgMatch({ rated: false }));
    const { recorder, records } = makeRecorder(sim);

    sim.tickCount = 10;
    recorder.observe([]);

    const open = records.find((r) => r.t === 'fight_open') as { arena: { practice: boolean } };
    expect(open.arena.practice).toBe(true);
  });
});

describe('ParseRecorder budget breaker', () => {
  test('three consecutive over-budget ticks disable capture and reset open fights', () => {
    const sim = fakeSim();
    seedArena(sim, arenaMatch());
    // Clock: every observe pass appears to take 10ms (start 0, end 10).
    let calls = 0;
    const clock = () => (calls++ % 2 === 0 ? 0 : 10);
    const { recorder, records, counters } = makeRecorder(sim, clock);

    sim.tickCount = 10;
    recorder.observe([]);
    sim.tickCount = 11;
    recorder.observe([]);
    sim.tickCount = 12;
    recorder.observe([]);
    sim.tickCount = 13;
    recorder.observe([dmg(5, 7, 10)]);

    expect(recorder.isDisabled).toBe(true);
    expect(counters.captureDisabled).toBe(1);
    expect(records.find((r) => r.t === 'fight_close')).toMatchObject({ outcome: 'reset' });
    // Nothing recorded after the breaker tripped.
    expect(records.filter((r) => r.t === 'ev')).toHaveLength(0);
  });
});

describe('ParseRecorder outcome arms', () => {
  test('teamA fully defeated closes win_b, neither team fully defeated closes draw', () => {
    for (const [defeated, expected] of [
      [[5, 6], 'win_b'],
      [[5], 'draw'],
    ] as const) {
      const sim = fakeSim();
      const match = arenaMatch();
      seedArena(sim, match);
      const { recorder, records } = makeRecorder(sim);

      sim.tickCount = 10;
      recorder.observe([]);
      for (const pid of defeated) match.defeated.add(pid);
      (match as { state: string }).state = 'over';
      sim.tickCount = 60;
      recorder.observe([]);

      expect(records.find((r) => r.t === 'fight_close')).toMatchObject({ outcome: expected });
    }
  });

  test('practice and yumi matches are flagged like fiesta ones', () => {
    for (const overrides of [{ practice: true }, { yumi: { mode: 'duo' } }]) {
      const sim = fakeSim();
      seedArena(sim, arenaMatch(overrides));
      const { recorder, records } = makeRecorder(sim);

      sim.tickCount = 10;
      recorder.observe([]);

      const open = records.find((r) => r.t === 'fight_open') as { arena: { practice: boolean } };
      expect(open.arena.practice).toBe(true);
    }
  });
});

describe('ParseRecorder surface gating', () => {
  test('a disabled arena surface opens no fight for an active match', () => {
    const sim = fakeSim();
    seedArena(sim, arenaMatch());
    const records: Record<string, unknown>[] = [];
    const recorder = new ParseRecorder({
      flags: { ...FLAGS, surfaces: new Set(['battleground', 'raid', 'dungeon', 'rift']) },
      sim,
      sink: { enqueue: (r) => records.push(r) },
      counters: createParseCounters(),
      resolveParticipant: participantResolver(sim),
      idFactory: () => 'x',
      clock: () => 0,
    });

    sim.tickCount = 10;
    recorder.observe([]);
    sim.tickCount = 11;
    recorder.observe([dmg(5, 7, 100)]);

    expect(records).toHaveLength(0);
  });

  test('a disabled battleground surface opens no fight for an active match', () => {
    const sim = fakeSim();
    const match = {
      id: 3,
      teams: [
        [11, 12],
        [13, 14],
      ] as [number[], number[]],
      state: 'active',
      winner: null,
      scores: [0, 0] as [number, number],
      rated: true,
      devEnded: false,
      grouped: false,
      ratingAvg: [1500, 1500] as [number, number],
    };
    for (const pid of [11, 12, 13, 14]) {
      sim.entities.set(pid, player(pid));
      sim.bgMatches.set(pid, match);
    }
    const records: Record<string, unknown>[] = [];
    const recorder = new ParseRecorder({
      flags: { ...FLAGS, surfaces: new Set(['arena', 'raid', 'dungeon', 'rift']) },
      sim,
      sink: { enqueue: (r) => records.push(r) },
      counters: createParseCounters(),
      resolveParticipant: participantResolver(sim),
      idFactory: () => 'x',
      clock: () => 0,
    });

    sim.tickCount = 10;
    recorder.observe([]);

    expect(records).toHaveLength(0);
  });
});

describe('ParseRecorder lifecycle bookkeeping', () => {
  test('a closed fight is deindexed: later events between its members record nothing', () => {
    const sim = fakeSim();
    const match = arenaMatch();
    seedArena(sim, match);
    const { recorder, records } = makeRecorder(sim);

    sim.tickCount = 10;
    recorder.observe([]);
    match.defeated.add(7);
    match.defeated.add(8);
    (match as { state: string }).state = 'over';
    sim.tickCount = 50;
    recorder.observe([]);
    sim.arenaMatches.clear();
    const closedCount = records.length;

    sim.tickCount = 60;
    recorder.observe([dmg(5, 7, 999)]);

    expect(records).toHaveLength(closedCount);
  });

  test('stop() closes open fights as reset and empties the open gauge', () => {
    const sim = fakeSim();
    seedArena(sim, arenaMatch());
    const { recorder, records, counters } = makeRecorder(sim);

    sim.tickCount = 10;
    recorder.observe([]);
    recorder.stop();

    expect(records.find((r) => r.t === 'fight_close')).toMatchObject({ outcome: 'reset' });
    expect(counters.fightsOpen).toBe(0);
  });

  test('arena fights never accept late joins from uninvolved players', () => {
    const sim = fakeSim();
    seedArena(sim, arenaMatch());
    sim.entities.set(9, player(9));
    const { recorder, records } = makeRecorder(sim);

    sim.tickCount = 10;
    recorder.observe([]);
    sim.tickCount = 11;
    recorder.observe([dmg(9, 7, 100)]);

    expect(records.filter((r) => r.t === 'join')).toHaveLength(0);
  });

  test('a non-consecutive slow tick never trips the breaker', () => {
    const sim = fakeSim();
    seedArena(sim, arenaMatch());
    // Durations per observe: over, over, under, over, over.
    const durations = [10, 10, 1, 10, 10];
    let call = 0;
    const clock = () => {
      const observeIndex = Math.floor(call / 2);
      const isEnd = call % 2 === 1;
      call++;
      return isEnd ? (durations[observeIndex] ?? 0) : 0;
    };
    const { recorder } = makeRecorder(sim, clock);

    for (let tick = 10; tick < 15; tick++) {
      sim.tickCount = tick;
      recorder.observe([]);
    }

    expect(recorder.isDisabled).toBe(false);
  });
});

describe('ParseRecorder truncation cap', () => {
  test('past the raw-line cap, lines stop but rollup totals stay complete', () => {
    const sim = fakeSim();
    const match = arenaMatch();
    seedArena(sim, match);
    const { recorder, records, counters } = makeRecorder(sim);

    sim.tickCount = 10;
    recorder.observe([]);
    const overCap = MAX_RAW_EVENTS_PER_FIGHT + 5;
    const batch: SimEvent[] = [];
    for (let i = 0; i < 500; i++) batch.push(dmg(5, 7, 1));
    let sent = 0;
    let tick = 11;
    while (sent < overCap) {
      sim.tickCount = tick++;
      const remaining = overCap - sent;
      recorder.observe(remaining >= 500 ? batch : batch.slice(0, remaining));
      sent += Math.min(500, remaining);
    }
    match.defeated.add(7);
    match.defeated.add(8);
    (match as { state: string }).state = 'over';
    sim.tickCount = tick;
    recorder.observe([]);

    expect(records.filter((r) => r.t === 'ev')).toHaveLength(MAX_RAW_EVENTS_PER_FIGHT);
    expect(counters.fightsTruncated).toBe(1);
    const close = records.find((r) => r.t === 'fight_close') as Record<string, unknown>;
    expect(close.truncated).toBe(true);
    const rollup = (close.rollup as { perParticipant: Record<string, { damage: number }> })
      .perParticipant;
    expect(rollup['1005']?.damage).toBe(overCap);
  });
});
