import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import { createMob } from '../src/sim/entity';
import { MOBS } from '../src/sim/data';
import { SimEvent } from '../src/sim/types';
import { groundHeight } from '../src/sim/world';

function makeWorld() {
  return new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
}

function teleport(sim: Sim, id: number, x: number, z: number) {
  const e = sim.entities.get(id)!;
  e.pos.x = x; e.pos.z = z;
  e.pos.y = groundHeight(x, z, sim.cfg.seed);
  e.prevPos = { ...e.pos };
}

// Drop a mob directly into the world at a fixed spot near the origin.
function spawnMob(sim: Sim, id: number, template: string, level: number, x: number, z: number) {
  const mob = createMob(id, MOBS[template], level, sim.groundPos(x, z));
  sim.entities.set(id, mob);
  return mob;
}

function errors(events: SimEvent[]): string[] {
  return events.filter((e) => e.type === 'error').map((e) => (e as { text: string }).text);
}

function readout(sim: Sim, pid: number, cmd = '/nearby'): string {
  sim.tick();
  sim.chat(cmd, pid);
  const lines = errors(sim.tick());
  return lines[lines.length - 1] ?? '';
}

// A spot far from town hubs and camps, so only entities placed by the test
// fall within NEARBY_RANGE (the overworld seeds ambient NPCs/mobs near hubs).
const HX = -200, HZ = 0;

describe('/nearby command', () => {
  it('lists players and mobs within range, nearest first', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    const bet = sim.addPlayer('mage', 'Bet');
    teleport(sim, a, HX, HZ);
    teleport(sim, bet, HX + 20, HZ);          // 20yd, within range
    spawnMob(sim, 900001, 'forest_wolf', 5, HX + 5, HZ); // 5yd

    const line = readout(sim, a);
    expect(line.startsWith('Nearby (2): ')).toBe(true);
    // closest entry (the 5yd mob) comes before Bet (20yd)
    expect(line.indexOf('5yd')).toBeLessThan(line.indexOf('Bet (player, 20yd)'));
    expect(line).toContain('Bet (player, 20yd)');
    expect(line.endsWith('.')).toBe(true);
  });

  it('excludes the caller, the dead, and out-of-range entities', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    const far = sim.addPlayer('rogue', 'Gimel');
    teleport(sim, a, HX, HZ);
    teleport(sim, far, HX, HZ + 300);                   // far beyond NEARBY_RANGE
    const corpse = spawnMob(sim, 900002, 'forest_wolf', 5, HX + 5, HZ);
    corpse.hp = 0;                                       // dead → excluded

    expect(readout(sim, a)).toBe('Nothing is nearby.');
  });

  it('aliases /near and /around behave the same', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    teleport(sim, a, HX, HZ);
    const wolf = spawnMob(sim, 900003, 'forest_wolf', 5, HX + 5, HZ);
    // Pin the wolf: the two readouts tick the world sequentially, so a wandering
    // mob would drift a fraction of a yard between them and flip the rounded
    // distance. This test compares alias output, not mob movement.
    wolf.hostile = false;
    wolf.wanderTimer = 999;

    expect(readout(sim, a, '/near')).toBe(readout(sim, a, '/around'));
    expect(readout(sim, a, '/near').startsWith('Nearby (1): ')).toBe(true);
  });

  it('caps the list and reports the overflow honestly', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    teleport(sim, a, HX, HZ);
    for (let i = 0; i < 13; i++) spawnMob(sim, 901000 + i, 'forest_wolf', 5, HX + (i - 6), HZ + 2);

    const line = readout(sim, a);
    expect(line.startsWith('Nearby (13): ')).toBe(true); // true total, not the cap
    expect(line).toContain('(+3 more)');                 // 13 - 10 shown
  });

  it('produces a self-only error reply with no chat broadcast', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    sim.addPlayer('mage', 'Bet');
    teleport(sim, a, HX, HZ);
    sim.tick();
    sim.chat('/nearby', a);
    const events = sim.tick();
    expect(events.some((e) => e.type === 'chat')).toBe(false);
    const errs = events.filter((e) => e.type === 'error') as { pid: number }[];
    expect(errs.every((e) => e.pid === a)).toBe(true);
  });
});
