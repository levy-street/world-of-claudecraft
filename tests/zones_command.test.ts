import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import { SimEvent } from '../src/sim/types';
import { ZONES, zoneAt } from '../src/sim/data';
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

function errorText(events: SimEvent[]): string | undefined {
  return events.find((e): e is Extract<SimEvent, { type: 'error' }> => e.type === 'error')?.text;
}

describe('/zones command', () => {
  it('is a self-only readout that is neither said nor logged', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    sim.tick();
    expect(sim.chat('/zones', a)).toBeNull();
    const events = sim.tick();
    expect(events.some((e) => e.type === 'chat')).toBe(false);
    const text = errorText(events);
    expect(text).toBeDefined();
  });

  it('lists every overworld zone with its level range', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    sim.tick();
    sim.chat('/zones', a);
    const text = errorText(sim.tick())!;
    for (const z of ZONES) {
      expect(text).toContain(z.name);
      expect(text).toContain(`${z.levelRange[0]}-${z.levelRange[1]}`);
    }
  });

  it('tags the zone the player is currently standing in', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    // Stand deep in the last zone, then read.
    const last = ZONES[ZONES.length - 1];
    teleport(sim, a, 0, last.zMin + 1);
    sim.tick();
    expect(zoneAt(sim.entities.get(a)!.pos.z).name).toBe(last.name);
    sim.chat('/zones', a);
    const text = errorText(sim.tick())!;
    // The current-zone marker sits on the last zone's line, not the first.
    const here = text.indexOf('here');
    expect(here).toBeGreaterThan(text.indexOf(ZONES[0].name));
    expect(here).toBeGreaterThan(text.indexOf(last.name));
  });

  it('responds the same way to the /zonelist and /worldmap aliases', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    sim.tick();
    for (const cmd of ['/zonelist', '/worldmap']) {
      sim.chat(cmd, a);
      const text = errorText(sim.tick())!;
      expect(text).toContain(ZONES[0].name);
    }
  });
});
