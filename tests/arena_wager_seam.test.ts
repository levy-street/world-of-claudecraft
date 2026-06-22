// Tests the server-driven wagered-bout seam (Sim.startWageredArena1v1): it must
// pair exactly the two staked players into one ordinary 1v1 bout, leave other
// queuers alone, reject invalid pairings, and resolve to the normal arenaEnd
// event the server settles on. Bout combat itself is covered by arena.test.ts;
// this proves the new entry point reuses that path faithfully.
import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import { groundHeight } from '../src/sim/world';
import type { PlayerClass, SimEvent } from '../src/sim/types';

const makeWorld = () => new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });

function add(sim: Sim, cls: PlayerClass, name: string, x: number, z: number): number {
  const pid = sim.addPlayer(cls, name);
  const e = sim.entities.get(pid)!;
  e.pos.x = x; e.pos.z = z; e.pos.y = groundHeight(x, z, sim.cfg.seed); e.prevPos = { ...e.pos };
  (sim as any).rebucket(e);
  return pid;
}
function startBout(sim: Sim): void {
  for (let i = 0; i < 20 * 6; i++) {
    sim.tick();
    const m = sim.arenaMatchFor([...sim.arenaMatches.keys()][0] ?? -1);
    if (m && m.state === 'active') return;
  }
}
const arenaEnds = (ev: SimEvent[]) => ev.filter((e): e is Extract<SimEvent, { type: 'arenaEnd' }> => e.type === 'arenaEnd');

describe('arena wager seam: startWageredArena1v1', () => {
  it('pairs exactly the two given players into one 1v1 match', () => {
    const sim = makeWorld();
    const a = add(sim, 'warrior', 'Aleph', 0, -40);
    const b = add(sim, 'mage', 'Bet', 6, -40);
    expect(sim.startWageredArena1v1(a, b)).toBe(true);
    const m = sim.arenaMatchFor(a)!;
    expect(sim.arenaMatchFor(b)).toBe(m);
    expect(m.format).toBe('1v1');
    expect([...m.teamA, ...m.teamB].sort((x, y) => x - y)).toEqual([a, b].sort((x, y) => x - y));
  });

  it('does not pull a third, open-queued player into the wagered bout', () => {
    const sim = makeWorld();
    const a = add(sim, 'warrior', 'Aleph', 0, -40);
    const b = add(sim, 'mage', 'Bet', 6, -40);
    const c = add(sim, 'rogue', 'Gimel', 12, -40);
    sim.arenaQueueJoin(c);
    expect(sim.startWageredArena1v1(a, b)).toBe(true);
    expect(sim.arenaMatches.has(c)).toBe(false);
    expect(sim.arenaQueue1v1.includes(c)).toBe(true);
  });

  it('dequeues a player who was waiting in the open 1v1 queue', () => {
    const sim = makeWorld();
    const a = add(sim, 'warrior', 'Aleph', 0, -40);
    const b = add(sim, 'mage', 'Bet', 6, -40);
    sim.arenaQueueJoin(a);
    expect(sim.arenaQueue1v1.includes(a)).toBe(true);
    expect(sim.startWageredArena1v1(a, b)).toBe(true);
    expect(sim.arenaQueue1v1.includes(a)).toBe(false);
  });

  it('refuses invalid pairings (same pid, missing, dead, already in a bout)', () => {
    const sim = makeWorld();
    const a = add(sim, 'warrior', 'Aleph', 0, -40);
    const b = add(sim, 'mage', 'Bet', 6, -40);
    const c = add(sim, 'rogue', 'Gimel', 12, -40);
    expect(sim.startWageredArena1v1(a, a)).toBe(false);
    expect(sim.startWageredArena1v1(a, 99999)).toBe(false);
    sim.entities.get(c)!.dead = true;
    expect(sim.startWageredArena1v1(a, c)).toBe(false);
    expect(sim.startWageredArena1v1(a, b)).toBe(true);
    expect(sim.startWageredArena1v1(a, b)).toBe(false); // a + b already in a bout
  });

  it('resolves to a normal arenaEnd naming the surviving player as winner', () => {
    const sim = makeWorld();
    const a = add(sim, 'warrior', 'Aleph', 0, -40);
    const b = add(sim, 'mage', 'Bet', 6, -40);
    expect(sim.startWageredArena1v1(a, b)).toBe(true);
    startBout(sim);
    (sim as any).dealDamage(sim.entities.get(a)!, sim.entities.get(b)!, 99999, false, 'physical', null, 'hit');
    const ends = arenaEnds(sim.tick());
    expect(ends.length).toBe(2);
    const aEnd = ends.find((e) => e.pid === a)!;
    const bEnd = ends.find((e) => e.pid === b)!;
    expect(aEnd.won).toBe(true);
    expect(aEnd.draw).toBe(false);
    expect(bEnd.won).toBe(false);
  });
});
