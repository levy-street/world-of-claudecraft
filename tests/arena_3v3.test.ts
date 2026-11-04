// Ranked 3v3 (src/sim/social/arena.ts): queueing (solos, pairs, trios, party
// guards), the matchmaker packing units into teams of three, both sides
// arriving stacked on their single spawn point, the Attrition heal ramp, the
// 300 s limit, and the bracket's own standing and Honor.
import { describe, expect, it } from 'vitest';
import { healingTakenMult } from '../src/sim/combat/heal';
import { BUILTIN_WORLD } from '../src/sim/data';
import type { ArenaMatch } from '../src/sim/sim';
import { Sim } from '../src/sim/sim';
import * as arena from '../src/sim/social/arena';
import type { PlayerClass, WorldContent } from '../src/sim/types';
import { groundHeight } from '../src/sim/world';

// Same trimmed world as tests/arena.test.ts: no ambient mobs in the way.
const WORLD: WorldContent = { ...BUILTIN_WORLD, camps: [], npcs: {}, groundObjects: [] };

function makeWorld(): Sim {
  const sim = new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true, world: WORLD });
  // A weekday, so nothing here meets the weekend battleground event.
  sim.resetDay = '2026-07-08';
  return sim;
}

function teleport(sim: Sim, pid: number, x: number, z: number): void {
  const e = sim.entities.get(pid)!;
  e.pos.x = x;
  e.pos.z = z;
  e.pos.y = groundHeight(x, z, sim.cfg.seed);
  e.prevPos = { ...e.pos };
  (sim as unknown as { rebucket(e: unknown): void }).rebucket(e);
}

const CLASSES: PlayerClass[] = ['warrior', 'mage', 'priest', 'rogue', 'paladin', 'hunter'];

function fighters(sim: Sim, count: number, prefix: string, firstId = 100): number[] {
  return Array.from({ length: count }, (_, i) => {
    const pid = sim.addPlayer(CLASSES[i % CLASSES.length], `${prefix}${i}`, {
      characterId: firstId + i,
    });
    sim.setPlayerLevel(arena.ARENA_MIN_LEVEL, pid);
    teleport(sim, pid, i, -40);
    return pid;
  });
}

function party(sim: Sim, leader: number, members: number[]): void {
  for (const m of members) {
    sim.partyInvite(m, leader);
    sim.partyAccept(m);
  }
}

function liveMatch(sim: Sim, pid: number): ArenaMatch {
  for (let i = 0; i < 20 * 8; i++) {
    sim.tick();
    const match = sim.arenaMatchFor(pid);
    if (match?.state === 'active') return match;
  }
  throw new Error('3v3 did not start');
}

const sorted = (pids: number[]) => [...pids].sort((a, b) => a - b);

describe('ranked 3v3: queue and matchmaking', () => {
  it('six solos make a 3v3 bout of two full teams', () => {
    const sim = makeWorld();
    const pids = fighters(sim, 6, 'Solo');
    for (const pid of pids) sim.arenaQueueJoin(pid, '3v3');
    expect(sim.arenaQueue3v3.length).toBe(6);
    sim.tick();
    const match = sim.arenaMatchFor(pids[0])!;
    expect(match).toBeTruthy();
    expect(match.format).toBe('3v3');
    expect(match.teamA).toHaveLength(3);
    expect(match.teamB).toHaveLength(3);
    expect(sorted([...match.teamA, ...match.teamB])).toEqual(sorted(pids));
    expect(sim.arenaQueue3v3).toHaveLength(0);
  });

  it('five queued players never start a bout', () => {
    const sim = makeWorld();
    const pids = fighters(sim, 5, 'Short');
    for (const pid of pids) sim.arenaQueueJoin(pid, '3v3');
    sim.tick();
    expect(sim.arenaMatchFor(pids[0])).toBeNull();
    expect(sim.arenaQueue3v3.reduce((n, u) => n + u.pids.length, 0)).toBe(5);
  });

  it('a premade trio meets a pair plus a solo', () => {
    const sim = makeWorld();
    const trio = fighters(sim, 3, 'Trio', 100);
    const pair = fighters(sim, 2, 'Pair', 200);
    const [solo] = fighters(sim, 1, 'Solo', 300);
    party(sim, trio[0], trio.slice(1));
    party(sim, pair[0], pair.slice(1));
    sim.arenaQueueJoin(trio[0], '3v3');
    sim.arenaQueueJoin(pair[0], '3v3');
    sim.arenaQueueJoin(solo, '3v3');
    expect(sim.arenaQueue3v3.map((u) => u.pids.length)).toEqual([3, 2, 1]);
    sim.tick();
    const match = sim.arenaMatchFor(trio[0])!;
    expect(match).toBeTruthy();
    expect(sorted(match.teamA)).toEqual(sorted(trio));
    expect(sorted(match.teamB)).toEqual(sorted([...pair, solo]));
  });

  it('fills a pair at the head of the queue with a later solo, skipping a second pair', () => {
    // Queue [pair, pair, solo, solo]: neither pair fits beside the other, so the
    // head pair takes the first solo and the second pair the other.
    const sim = makeWorld();
    const pairA = fighters(sim, 2, 'PairA', 100);
    const pairB = fighters(sim, 2, 'PairB', 200);
    const solos = fighters(sim, 2, 'Solo', 300);
    party(sim, pairA[0], [pairA[1]]);
    party(sim, pairB[0], [pairB[1]]);
    sim.arenaQueueJoin(pairA[0], '3v3');
    sim.arenaQueueJoin(pairB[0], '3v3');
    for (const s of solos) sim.arenaQueueJoin(s, '3v3');
    sim.tick();
    const match = sim.arenaMatchFor(pairA[0])!;
    expect(match).toBeTruthy();
    expect(match.teamA).toHaveLength(3);
    expect(match.teamB).toHaveLength(3);
    expect(match.teamA).toEqual(expect.arrayContaining(pairA));
    expect(match.teamB).toEqual(expect.arrayContaining(pairB));
  });

  it('refuses a party of four, a non-leader, and a below-level member', () => {
    const sim = makeWorld();
    const four = fighters(sim, 4, 'Four');
    party(sim, four[0], four.slice(1));
    sim.arenaQueueJoin(four[0], '3v3');
    expect(sim.arenaQueue3v3).toHaveLength(0);

    const sim2 = makeWorld();
    const trio = fighters(sim2, 3, 'Trio');
    party(sim2, trio[0], trio.slice(1));
    sim2.arenaQueueJoin(trio[1], '3v3');
    expect(sim2.arenaQueue3v3).toHaveLength(0);
    sim2.setPlayerLevel(arena.ARENA_MIN_LEVEL - 1, trio[2]);
    sim2.arenaQueueJoin(trio[0], '3v3');
    expect(sim2.arenaQueue3v3).toHaveLength(0);
    sim2.setPlayerLevel(arena.ARENA_MIN_LEVEL, trio[2]);
    sim2.arenaQueueJoin(trio[0], '3v3');
    expect(sim2.arenaQueue3v3.map((u) => sorted(u.pids))).toEqual([sorted(trio)]);
    expect(sim2.arenaInfoFor(trio[1])!.format).toBe('3v3');
  });

  it('leaving the queue removes the whole unit', () => {
    const sim = makeWorld();
    const trio = fighters(sim, 3, 'Trio');
    party(sim, trio[0], trio.slice(1));
    sim.arenaQueueJoin(trio[0], '3v3');
    expect(sim.arenaQueue3v3).toHaveLength(1);
    sim.arenaQueueLeave(trio[2]);
    expect(sim.arenaQueue3v3).toHaveLength(0);
  });
});

describe('ranked 3v3: the bout', () => {
  it('stacks each side on one spawn point', () => {
    const sim = makeWorld();
    const pids = fighters(sim, 6, 'Stack');
    for (const pid of pids) sim.arenaQueueJoin(pid, '3v3');
    sim.tick();
    const match = sim.arenaMatchFor(pids[0])!;
    const at = (pid: number) => {
      const e = sim.entities.get(pid)!;
      return { x: e.pos.x, z: e.pos.z };
    };
    const a0 = at(match.teamA[0]);
    const b0 = at(match.teamB[0]);
    for (const pid of match.teamA) {
      expect(at(pid).x).toBeCloseTo(a0.x, 3);
      expect(at(pid).z).toBeCloseTo(a0.z, 3);
    }
    for (const pid of match.teamB) {
      expect(at(pid).x).toBeCloseTo(b0.x, 3);
      expect(at(pid).z).toBeCloseTo(b0.z, 3);
    }
    expect(Math.hypot(a0.x - b0.x, a0.z - b0.z)).toBeGreaterThan(5);
  });

  it('ramps Attrition one percent per second from 150 s, capped at 75%', () => {
    expect(arena.arenaAttritionFraction(0)).toBe(0);
    expect(arena.arenaAttritionFraction(150)).toBe(0);
    expect(arena.arenaAttritionFraction(150.99)).toBe(0);
    expect(arena.arenaAttritionFraction(151)).toBe(0.01);
    expect(arena.arenaAttritionFraction(200)).toBe(0.5);
    expect(arena.arenaAttritionFraction(225)).toBe(0.75);
    expect(arena.arenaAttritionFraction(299)).toBe(0.75);
    expect(arena.ARENA_3V3_MAX_DURATION).toBe(300);
  });

  it('puts an undispellable Attrition debuff on every fighter that cuts healing taken', () => {
    const sim = makeWorld();
    const pids = fighters(sim, 6, 'Worn');
    for (const pid of pids) sim.arenaQueueJoin(pid, '3v3');
    const match = liveMatch(sim, pids[0]);
    // Before the 150th second nobody carries it.
    match.timer = 100;
    sim.tick();
    for (const pid of pids) {
      expect(sim.entities.get(pid)!.auras.some((a) => a.id === arena.ARENA_ATTRITION_AURA_ID)).toBe(
        false,
      );
    }
    match.timer = 170;
    sim.tick();
    for (const pid of pids) {
      const e = sim.entities.get(pid)!;
      const aura = e.auras.find((a) => a.id === arena.ARENA_ATTRITION_AURA_ID)!;
      expect(aura).toBeTruthy();
      expect(aura.kind).toBe('mortal_wound');
      expect(aura.undispellable).toBe(true);
      expect(aura.value).toBeCloseTo(0.2, 10);
      expect(aura.stacks).toBe(20);
      expect(healingTakenMult(sim.ctx, e)).toBeCloseTo(0.8, 10);
    }
    // The same aura is updated in place, never stacked.
    match.timer = 240;
    sim.tick();
    const e = sim.entities.get(pids[0])!;
    expect(e.auras.filter((a) => a.id === arena.ARENA_ATTRITION_AURA_ID)).toHaveLength(1);
    expect(healingTakenMult(sim.ctx, e)).toBeCloseTo(0.25, 10);
  });

  it('runs past 150 s and resolves at 300 s, stripping Attrition on the way out', () => {
    const sim = makeWorld();
    const pids = fighters(sim, 6, 'Long');
    for (const pid of pids) sim.arenaQueueJoin(pid, '3v3');
    const match = liveMatch(sim, pids[0]);
    match.timer = 200;
    sim.tick();
    expect(match.state).toBe('active');
    match.timer = arena.ARENA_3V3_MAX_DURATION - 0.001;
    sim.tick();
    expect(match.state).toBe('over');
    for (const pid of pids) {
      expect(sim.entities.get(pid)!.auras.some((a) => a.id === arena.ARENA_ATTRITION_AURA_ID)).toBe(
        false,
      );
    }
  });

  it('leaves 2v2 on its 150 s limit with no Attrition', () => {
    const sim = makeWorld();
    const pids = fighters(sim, 4, 'Duo');
    for (const pid of pids) sim.arenaQueueJoin(pid, '2v2');
    const match = liveMatch(sim, pids[0]);
    expect(match.format).toBe('2v2');
    match.timer = 149.99;
    sim.tick();
    expect(match.state).toBe('over');
    for (const pid of pids) {
      expect(sim.entities.get(pid)!.auras.some((a) => a.id === arena.ARENA_ATTRITION_AURA_ID)).toBe(
        false,
      );
    }
  });

  it('scores the 3v3 standing and pays 75 + the 100 first win to each winner', () => {
    const sim = makeWorld();
    const pids = fighters(sim, 6, 'Rated');
    for (const pid of pids) sim.arenaQueueJoin(pid, '3v3');
    const match = liveMatch(sim, pids[0]);
    arena.endArenaMatch(sim.ctx, match, 'A', 'defeat');
    for (const pid of match.teamA) {
      const meta = sim.meta(pid)!;
      expect(meta.arena3v3Wins).toBe(1);
      expect(meta.arena3v3Rating).toBeGreaterThan(arena.ARENA_BASE_RATING);
      expect(meta.arena2v2Wins).toBe(0);
      expect(meta.honor).toBe(175);
    }
    for (const pid of match.teamB) {
      const meta = sim.meta(pid)!;
      expect(meta.arena3v3Losses).toBe(1);
      expect(meta.honor).toBe(25);
    }
    const info = sim.arenaInfoFor(match.teamA[0])!;
    expect(info.standings['3v3'].wins).toBe(1);
    expect(info.ladders['3v3'].length).toBeGreaterThan(0);
  });

  it('persists the 3v3 standing only once the bracket has a result', () => {
    const sim = makeWorld();
    const [fresh] = fighters(sim, 1, 'Fresh');
    const blank = sim.serializeCharacter(fresh)!;
    expect(blank.arena3v3Rating).toBeUndefined();
    expect(blank.arena3v3Wins).toBeUndefined();

    const meta = sim.meta(fresh)!;
    arena.addArenaResult(meta, '3v3', 16, true);
    const saved = sim.serializeCharacter(fresh)!;
    expect(saved.arena3v3Rating).toBe(arena.ARENA_BASE_RATING + 16);
    expect(saved.arena3v3Wins).toBe(1);
    const loaded = makeWorld();
    const pid = loaded.addPlayer('warrior', 'Fresh0', { state: saved });
    expect(loaded.meta(pid)!.arena3v3Rating).toBe(arena.ARENA_BASE_RATING + 16);
    expect(loaded.meta(pid)!.arena3v3Wins).toBe(1);
  });
});
