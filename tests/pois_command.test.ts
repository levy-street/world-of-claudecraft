import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import { SimEvent, dist2d } from '../src/sim/types';
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

function expected(sim: Sim, pid: number): string {
  const pos = sim.entities.get(pid)!.pos;
  const zone = zoneAt(pos.z);
  const parts = zone.pois
    .map((p) => ({ label: p.label, d: dist2d(pos, { x: p.x, y: 0, z: p.z }) }))
    .sort((a, b) => a.d - b.d)
    .map((p) => `${p.label} (${Math.round(p.d)}yd)`);
  return `Landmarks in ${zone.name} (${parts.length}): ${parts.join(', ')}.`;
}

describe('/pois command', () => {
  it('lists the current zone landmarks nearest first', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    sim.tick();
    teleport(sim, a, 0, 0); // first zone
    const want = expected(sim, a);

    sim.chat('/pois', a);
    expect(lastError(sim.tick())).toBe(want);
    // sanity: nearest-first ordering puts the closest landmark first
    expect(want).toMatch(/^Landmarks in .+ \(\d+\): .+\(\d+yd\)/);
  });

  it('tracks the zone you stand in, via the /landmarks alias', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    sim.tick();
    teleport(sim, a, 0, 600); // deeper zone
    const want = expected(sim, a);

    sim.chat('/landmarks', a);
    expect(lastError(sim.tick())).toBe(want);
  });

  it('is self-only and never logged or spoken', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    sim.tick();
    const result = sim.chat('/poi', a);
    expect(result).toBeNull();
    expect(sim.tick().some((e) => e.type === 'chat')).toBe(false);
  });
});
