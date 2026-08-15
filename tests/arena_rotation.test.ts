// Slot-parity map rotation (src/sim/social/arena.ts freeArenaSlot): even
// slots host the Ashen Coliseum, odd slots The Drowned Court. Ranked bouts
// prefer the parity of the id the next match will take (nextArenaMatchId % 2)
// and fall back to any free slot; Fiesta is hard-pinned to even slots; the
// Protect Yumi brackets play in their own maze band and never touch arena
// slots at all. Everything here is deterministic and rng-free.
import { describe, expect, it } from 'vitest';
import { arenaOrigin, isArenaPos, YUMI_MAZE_SLOT_COUNT, yumiMazeOrigin } from '../src/sim/data';
import { arenaMapForSlot } from '../src/sim/dungeon_layout';
import { Sim } from '../src/sim/sim';
import { ARENA_MIN_LEVEL } from '../src/sim/social/arena';
import type { PlayerClass } from '../src/sim/types';
import { groundHeight } from '../src/sim/world';

function makeWorld() {
  return new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
}

// Every fighter here clears the ranked (1v1/2v2) minimum-level gate; Fiesta
// and Protect Yumi (also driven through this helper below) don't need it,
// but a level-15 character queues into either the same as a level-1 one.
function addFighter(sim: Sim, cls: PlayerClass, name: string): number {
  const pid = sim.addPlayer(cls, name);
  sim.setPlayerLevel(ARENA_MIN_LEVEL, pid);
  const e = sim.entities.get(pid)!;
  e.pos.x = 0;
  e.pos.z = -40;
  e.pos.y = groundHeight(e.pos.x, e.pos.z, sim.cfg.seed);
  e.prevPos = { ...e.pos };
  (sim as any).rebucket(e);
  return pid;
}

function queue1v1Pair(sim: Sim): { a: number; b: number } {
  const a = addFighter(sim, 'warrior', `W${sim.ctx.nextArenaMatchId}a`);
  const b = addFighter(sim, 'mage', `M${sim.ctx.nextArenaMatchId}b`);
  sim.arenaQueueJoin(a);
  sim.arenaQueueJoin(b);
  sim.tick();
  return { a, b };
}

describe('arena rotation: ranked matchId-parity preference', () => {
  it('seats each ranked bout on the slot parity of its match id', () => {
    const sim = makeWorld();
    sim.ctx.nextArenaMatchId = 1; // odd id -> odd (Drowned Court) slot
    const { a } = queue1v1Pair(sim);
    const m1 = sim.arenaMatchFor(a)!;
    expect(m1.slot % 2).toBe(1);
    expect(arenaMapForSlot(m1.slot).id).toBe('drowned_court');

    // the next bout's id is even -> even (Coliseum) slot
    const { a: a2 } = queue1v1Pair(sim);
    const m2 = sim.arenaMatchFor(a2)!;
    expect(m2.slot % 2).toBe(0);
    expect(arenaMapForSlot(m2.slot).id).toBe('coliseum');
  });

  it('falls back to the other parity when the preferred one is fully busy', () => {
    const sim = makeWorld();
    sim.ctx.nextArenaMatchId = 1; // prefers odd
    sim.ctx.arenaBusySlots.add(1);
    sim.ctx.arenaBusySlots.add(3);
    const { a } = queue1v1Pair(sim);
    const m = sim.arenaMatchFor(a)!;
    expect(m.state).toBe('countdown'); // the bout still starts
    expect(m.slot % 2).toBe(0); // on the fallback parity
  });

  it("places fighters on the slot map's own spawns (Drowned Court)", () => {
    const sim = makeWorld();
    sim.ctx.nextArenaMatchId = 1; // odd -> Drowned Court
    const { a, b } = queue1v1Pair(sim);
    const m = sim.arenaMatchFor(a)!;
    const map = arenaMapForSlot(m.slot);
    expect(map.id).toBe('drowned_court');
    const o = arenaOrigin(m.slot);
    const ea = sim.entities.get(a)!;
    const eb = sim.entities.get(b)!;
    expect(ea.pos.x - o.x).toBeCloseTo(map.spawnA.x, 5);
    expect(ea.pos.z - o.z).toBeCloseTo(map.spawnA.z, 5);
    expect(eb.pos.x - o.x).toBeCloseTo(map.spawnB.x, 5);
    expect(eb.pos.z - o.z).toBeCloseTo(map.spawnB.z, 5);
  });
});

describe('arena rotation: fiesta is pinned to even (Coliseum) slots', () => {
  function queueFiestaFour(sim: Sim): number[] {
    const pids = [
      addFighter(sim, 'warrior', 'Fa'),
      addFighter(sim, 'mage', 'Fb'),
      addFighter(sim, 'rogue', 'Fc'),
      addFighter(sim, 'paladin', 'Fd'),
    ];
    for (const pid of pids) sim.arenaQueueJoin(pid, 'fiesta');
    sim.tick();
    return pids;
  }

  it('waits for an even slot rather than taking a free odd one', () => {
    const sim = makeWorld();
    sim.ctx.arenaBusySlots.add(0);
    sim.ctx.arenaBusySlots.add(2);
    const pids = queueFiestaFour(sim);
    // both even slots busy, odd slots free: the bout must NOT start
    for (let i = 0; i < 20; i++) sim.tick();
    expect(pids.every((pid) => sim.arenaMatchFor(pid) === null)).toBe(true);

    // an even slot frees up: the bout seats there on the next tick
    sim.ctx.arenaBusySlots.delete(2);
    sim.tick();
    const m = sim.arenaMatchFor(pids[0]);
    expect(m).not.toBeNull();
    expect(m!.slot).toBe(2);
    expect(arenaMapForSlot(m!.slot).id).toBe('coliseum');
  });

  it('an odd id does not pull a fiesta bout onto an odd slot', () => {
    const sim = makeWorld();
    sim.ctx.nextArenaMatchId = 1; // ranked would prefer odd here
    const pids = queueFiestaFour(sim);
    const m = sim.arenaMatchFor(pids[0])!;
    expect(m.slot % 2).toBe(0);
    expect(arenaMapForSlot(m.slot).id).toBe('coliseum');
  });
});

describe('arena rotation: yumi isolation', () => {
  it('every yumi maze origin lies outside the arena band entirely', () => {
    // Protect Yumi is not part of the rotation: its bouts play at
    // yumiMazeOrigin slots in their own x-band, so the parity maps can never
    // meet the maze (structural isolation, no slot-selection code involved).
    for (let slot = 0; slot < YUMI_MAZE_SLOT_COUNT; slot++) {
      expect(isArenaPos(yumiMazeOrigin(slot).x)).toBe(false);
    }
  });

  it('a yumi bout on an ODD maze slot still reports map coliseum', () => {
    // Yumi match.slot numbers come from the MAZE pool, whose values collide
    // with pit slot numbers; the arenaInfo map fact must not read maze-slot
    // parity as a Drowned Court assignment.
    const sim = makeWorld();
    sim.ctx.yumiBusySlots.add(0); // force the bout onto maze slot 1
    const pids: number[] = [];
    for (let i = 0; i < 6; i++) pids.push(addFighter(sim, i % 2 ? 'mage' : 'warrior', `Y${i}`));
    for (const pid of pids) sim.arenaQueueJoin(pid, 'yumi3');
    sim.tick();
    const m = sim.arenaMatchFor(pids[0])!;
    expect(m).not.toBeNull();
    expect(m.yumi).toBeTruthy();
    expect(m.slot).toBe(1);
    const info = sim.arenaInfoFor(pids[0])!;
    expect(info.match?.map).toBe('coliseum');
  });
});
