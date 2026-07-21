// Direct unit tests for the moved Duels module (src/sim/social/duel.ts, session A2).
// These call the module functions DIRECTLY against a real Sim's SimContext (not via
// Sim's thin delegates), proving the slice works behind the seam in isolation:
// request/accept formation and endDuel winner/draw resolution + duel-map cleanup.

import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import * as duel from '../src/sim/social/duel';
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

function seatedDuel(): { sim: AnySim; a: number; b: number; d: any } {
  const sim = makeWorld();
  const a = sim.addPlayer('warrior', 'Aleph');
  const b = sim.addPlayer('mage', 'Bet');
  teleport(sim, a, 0, -40);
  teleport(sim, b, 4, -40);
  duel.duelRequest(sim.ctx, b, a); // Aleph challenges Bet
  duel.duelAccept(sim.ctx, b); // Bet accepts -> countdown duel
  return { sim, a, b, d: duel.duelFor(sim.ctx, a) };
}

describe('duel module: request/accept formation', () => {
  it('an accepted challenge seats one shared countdown duel for both players', () => {
    const { sim, a, b, d } = seatedDuel();
    expect(d).toBeTruthy();
    expect(d.state).toBe('countdown');
    expect(d.a).toBe(a);
    expect(d.b).toBe(b);
    // both pids key the SAME duel object (shared by reference).
    expect(duel.duelFor(sim.ctx, b)).toBe(d);
    expect(sim.duelInvites.has(b)).toBe(false); // invite consumed on accept
  });

  it('rejects a self-challenge and a far-away target', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    const b = sim.addPlayer('mage', 'Bet');
    teleport(sim, a, 0, -40);
    teleport(sim, b, 400, -40); // well past the 30yd request range
    duel.duelRequest(sim.ctx, a, a); // self
    duel.duelRequest(sim.ctx, b, a); // too far
    expect(sim.duelInvites.size).toBe(0);
    expect(sim.duels.size).toBe(0);
  });
});

describe('duel module: endDuel resolution', () => {
  it('a winner resolution emits duelEnd (winner/loser) and clears both duel entries', () => {
    const { sim, a, b, d } = seatedDuel();
    sim.drainEvents();
    duel.endDuel(sim.ctx, d, a); // Aleph wins
    const ev = sim.drainEvents();
    const end = ev.find((e: any) => e.type === 'duelEnd') as any;
    expect(end).toBeTruthy();
    expect(end.winnerName).toBe('Aleph');
    expect(end.loserName).toBe('Bet');
    expect(sim.duels.has(a)).toBe(false);
    expect(sim.duels.has(b)).toBe(false);
  });

  it('a draw resolution (null winner) ends the bout with no duelEnd, just a notice', () => {
    const { sim, d } = seatedDuel();
    sim.drainEvents();
    duel.endDuel(sim.ctx, d, null);
    const ev = sim.drainEvents();
    expect(ev.some((e: any) => e.type === 'duelEnd')).toBe(false);
    const endedLogs = ev.filter((e: any) => e.type === 'log' && e.text === 'The duel has ended.');
    expect(endedLogs.length).toBe(2); // one to each combatant
    expect(sim.duels.size).toBe(0);
  });
});
