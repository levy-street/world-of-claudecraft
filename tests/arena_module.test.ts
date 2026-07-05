// Direct unit tests for the moved ranked-Arena module (src/sim/social/arena.ts,
// session A2). Pure helpers (eloDelta / addArenaResult / arenaStanding) are tested in
// isolation; the ctx-dependent lifecycle (queue -> matchmake -> endArenaMatch) is
// driven DIRECTLY through a real Sim's SimContext, proving the slice resolves a ranked
// bout (to a defeat and to a timeout draw) behind the seam without Sim's delegates.

import { describe, expect, it } from 'vitest';
import type { PlayerMeta } from '../src/sim/sim';
import { Sim } from '../src/sim/sim';
import * as arena from '../src/sim/social/arena';
import { ARENA_BASE_RATING, eloDelta } from '../src/sim/social/arena';
import { groundHeight } from '../src/sim/world';

type AnySim = Sim & Record<string, any>;

function makeWorld(): AnySim {
  return new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true }) as AnySim;
}

function teleport(sim: AnySim, pid: number, x: number, z: number): void {
  const e = sim.entities.get(pid)!;
  e.pos.x = x;
  e.pos.z = z;
  e.pos.y = groundHeight(x, z, sim.cfg.seed);
  e.prevPos = { ...e.pos };
  sim.rebucket(e);
}

// A minimal standings-bearing PlayerMeta for the pure rating accounting.
function fakeMeta(over: Partial<PlayerMeta> = {}): PlayerMeta {
  return {
    arenaRating: 1500,
    arenaWins: 0,
    arenaLosses: 0,
    arena2v2Rating: 1500,
    arena2v2Wins: 0,
    arena2v2Losses: 0,
    ...over,
  } as PlayerMeta;
}

describe('arena module: Elo math (K=32)', () => {
  it('even ratings split 16 points; a draw moves nobody', () => {
    expect(eloDelta(1500, 1500, 1)).toBe(16);
    expect(eloDelta(1500, 1500, 0.5)).toBe(0);
  });

  it('caps near K=32 at the extremes (a near-certain upset gains ~K, a lock gains ~0)', () => {
    expect(eloDelta(0, 4000, 1)).toBe(32); // the no-hoper who wins
    expect(eloDelta(4000, 0, 1)).toBe(0); // the lock who wins
  });

  it('an upset is worth strictly more than the favorite winning', () => {
    expect(eloDelta(1400, 1800, 1)).toBeGreaterThan(eloDelta(1800, 1400, 1));
  });
});

describe('arena module: rating accounting (floor 100, base 1500)', () => {
  it('floors a rating at 100 on a heavy loss and counts the loss', () => {
    const m = fakeMeta({ arenaRating: 120 });
    const { before, after } = arena.addArenaResult(m, '1v1', -50, false);
    expect(before).toBe(120);
    expect(after).toBe(100); // max(100, 120 - 50)
    expect(m.arenaRating).toBe(100);
    expect(m.arenaLosses).toBe(1);
    expect(m.arenaWins).toBe(0);
  });

  it('a win raises rating + wins and keeps 1v1 / 2v2 brackets independent', () => {
    const m = fakeMeta();
    arena.addArenaResult(m, '1v1', 16, true);
    expect(m.arenaRating).toBe(1516);
    expect(m.arenaWins).toBe(1);
    expect(m.arena2v2Rating).toBe(1500); // untouched by a 1v1 result
    arena.addArenaResult(m, '2v2', 16, true);
    expect(m.arena2v2Rating).toBe(1516);
    expect(m.arena2v2Wins).toBe(1);
    expect(m.arenaRating).toBe(1516); // unchanged by the 2v2 result
  });

  it('arenaStanding reads the requested bracket; an unrated pid defaults to base 1500', () => {
    const m = fakeMeta({ arenaRating: 1700, arena2v2Rating: 1300 });
    expect(arena.arenaStanding(m, '1v1').rating).toBe(1700);
    expect(arena.arenaStanding(m, '2v2').rating).toBe(1300);
    const sim = makeWorld();
    expect(arena.arenaRatingForPid(sim.ctx, 999999, '1v1')).toBe(ARENA_BASE_RATING);
    expect(ARENA_BASE_RATING).toBe(1500);
  });
});

describe('arena module: ranked match resolution', () => {
  function liveBout(): { sim: AnySim; a: number; b: number; match: any } {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    const b = sim.addPlayer('mage', 'Bet');
    teleport(sim, a, 0, -40);
    teleport(sim, b, 6, -40);
    arena.arenaQueueJoin(sim.ctx, a);
    arena.arenaQueueJoin(sim.ctx, b);
    for (let i = 0; i < 20 * 8; i++) {
      sim.tick();
      const m = arena.arenaMatchFor(sim.ctx, a);
      if (m && m.state === 'active') break;
    }
    return { sim, a, b, match: arena.arenaMatchFor(sim.ctx, a) };
  }

  it('queue + matchmake seats a live 1v1 bout', () => {
    const { match, a, b } = liveBout();
    expect(match).toBeTruthy();
    expect(match.state).toBe('active');
    expect([...match.teamA, ...match.teamB].sort()).toEqual([a, b].sort());
  });

  it('ends a bout to a defeat with a symmetric Elo swing and over state', () => {
    const { sim, a, b, match } = liveBout();
    const rA0 = sim.meta(a)!.arenaRating;
    const rB0 = sim.meta(b)!.arenaRating;
    arena.endArenaMatch(sim.ctx, match, 'A', 'defeat');
    expect(sim.meta(a)!.arenaRating).toBe(rA0 + 16);
    expect(sim.meta(b)!.arenaRating).toBe(rB0 - 16);
    expect(sim.meta(a)!.arenaWins).toBe(1);
    expect(sim.meta(b)!.arenaLosses).toBe(1);
    expect(match.state).toBe('over');
  });

  it('ends a bout to a timeout draw (null winner) without moving wins/losses', () => {
    const { sim, a, b, match } = liveBout();
    const rA0 = sim.meta(a)!.arenaRating;
    const rB0 = sim.meta(b)!.arenaRating;
    arena.endArenaMatch(sim.ctx, match, null, 'timeout');
    // a draw between equals (1500 each) is worth 0 points and no win/loss.
    expect(sim.meta(a)!.arenaRating).toBe(rA0);
    expect(sim.meta(b)!.arenaRating).toBe(rB0);
    expect(sim.meta(a)!.arenaWins).toBe(0);
    expect(sim.meta(a)!.arenaLosses).toBe(0);
    expect(match.state).toBe('over');
  });
});
