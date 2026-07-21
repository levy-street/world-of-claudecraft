import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import { SimEvent } from '../src/sim/types';
import { zoneAt } from '../src/sim/data';
import { groundHeight } from '../src/sim/world';

function makeWorld() {
  return new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
}

function teleport(sim: Sim, pid: number, x: number, z: number) {
  const e = sim.entities.get(pid)!;
  e.pos.x = x; e.pos.z = z;
  e.pos.y = groundHeight(x, z, sim.cfg.seed);
  e.prevPos = { ...e.pos };
}

function lastError(events: SimEvent[]): string | undefined {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.type === 'error') return e.text;
  }
  return undefined;
}

describe('/graveyard command', () => {
  it('names the current zone graveyard your spirit returns to', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    sim.tick();
    teleport(sim, a, 0, 0); // overworld, first zone
    const zone = zoneAt(0);
    const gy = zone.graveyard;
    const expected = `If you fall here, your spirit returns to the ${zone.name} graveyard at (${Math.floor(gy.x)}, ${Math.floor(gy.z)}).`;

    sim.chat('/graveyard', a);
    expect(lastError(sim.tick())).toBe(expected);
  });

  it('tracks the zone you stand in', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    sim.tick();
    teleport(sim, a, 0, 600); // deeper zone (Thornpeak range, zMin 540)
    const zone = zoneAt(600);
    const gy = zone.graveyard;
    const expected = `If you fall here, your spirit returns to the ${zone.name} graveyard at (${Math.floor(gy.x)}, ${Math.floor(gy.z)}).`;

    sim.chat('/gy', a);
    expect(lastError(sim.tick())).toBe(expected);
  });

  it('is self-only and never logged or spoken', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    sim.tick();
    const result = sim.chat('/spirithealer', a);
    expect(result).toBeNull();
    expect(sim.tick().some((e) => e.type === 'chat')).toBe(false);
  });
});
