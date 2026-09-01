import { describe, expect, it } from 'vitest';
import { ZONES, zoneAt } from '../src/sim/data';
import { Sim } from '../src/sim/sim';
import type { SimEvent } from '../src/sim/types';
import { groundHeight } from '../src/sim/world';

function makeWorld() {
  return new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
}

function entityFor(sim: Sim, pid: number) {
  const entity = sim.entities.get(pid);
  expect(entity).toBeDefined();
  if (!entity) throw new Error(`missing entity ${pid}`);
  return entity;
}

function teleport(sim: Sim, pid: number, x: number, z: number) {
  const e = entityFor(sim, pid);
  e.pos.x = x;
  e.pos.z = z;
  e.pos.y = groundHeight(x, z, sim.cfg.seed);
  e.prevPos = { ...e.pos };
}

function errorText(events: SimEvent[]): string | undefined {
  return events.find((e): e is Extract<SimEvent, { type: 'error' }> => e.type === 'error')?.text;
}

function expectErrorText(events: SimEvent[]): string {
  const text = errorText(events);
  expect(text).toBeDefined();
  if (!text) throw new Error('missing error text');
  return text;
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
    const text = expectErrorText(sim.tick());
    for (const z of ZONES) {
      expect(text).toContain(z.name);
      expect(text).toContain(`${z.levelRange[0]}-${z.levelRange[1]}`);
    }
  });

  it('tags the zone the player is currently standing in', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    // Stand deep in the READOUT-order last zone, then read. The readout lists
    // travel order (south to north, west to east), and the Proving Shore
    // tutorial island appends LAST in ZONES while rendering FIRST (it sits in
    // the southwest corner), so append order no longer matches line order.
    const ordered = [...ZONES].sort(
      (a, b) => a.zMin - b.zMin || (a.xMin ?? -180) - (b.xMin ?? -180),
    );
    const last = ordered[ordered.length - 1];
    teleport(sim, a, last.hub.x, last.hub.z); // inside the zone's own rect (columns!)
    sim.tick();
    const player = entityFor(sim, a);
    expect(zoneAt(player.pos.x, player.pos.z).name).toBe(last.name);
    sim.chat('/zones', a);
    const text = expectErrorText(sim.tick());
    // The current-zone marker sits on the last zone's line, not the first.
    const here = text.indexOf('here');
    expect(here).toBeGreaterThan(text.indexOf(ordered[0].name));
    expect(here).toBeGreaterThan(text.indexOf(last.name));
  });

  it('responds the same way to the /zonelist and /worldmap aliases', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    sim.tick();
    for (const cmd of ['/zonelist', '/worldmap']) {
      sim.chat(cmd, a);
      const text = expectErrorText(sim.tick());
      expect(text).toContain(ZONES[0].name);
    }
  });
});
