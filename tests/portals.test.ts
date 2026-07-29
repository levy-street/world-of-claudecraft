// Paired overworld portals (src/sim/portals.ts): the Duskfall passage between
// the Thornpeak cliffs and the Veiled Hollow. Walking into either cave mouth
// teleports to the far side's landing; arrivals never bounce back; the flavor
// line is emitted to the traveler only; and two same-seed sims stay identical.

import { describe, expect, it } from 'vitest';
import { REALM_PORTALS } from '../src/sim/content/realm';
import { PORTALS, zoneAt } from '../src/sim/data';
import { Sim } from '../src/sim/sim';
import type { SimEvent } from '../src/sim/types';
import { groundHeight } from '../src/sim/world';

const PORTAL = REALM_PORTALS[0];

function makeWorld() {
  return new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
}

function teleport(sim: Sim, pid: number, x: number, z: number) {
  const e = sim.entities.get(pid)!;
  e.pos.x = x;
  e.pos.z = z;
  e.pos.y = groundHeight(x, z, sim.cfg.seed);
  e.prevPos = { ...e.pos };
}

function logTexts(events: SimEvent[]): string[] {
  return events
    .filter((e): e is Extract<SimEvent, { type: 'log' }> => e.type === 'log')
    .map((e) => e.text);
}

describe('the Duskfall passage', () => {
  it('is registered in the merged portal table', () => {
    expect(PORTALS.some((p) => p.id === 'duskfall_passage')).toBe(true);
  });

  it('teleports a player who walks into the Thornpeak cave to the Hollow', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    sim.tick();
    teleport(sim, a, PORTAL.a.x, PORTAL.a.z);
    const events = sim.tick();
    const p = sim.entities.get(a)!;
    expect(zoneAt(p.pos.x, p.pos.z).id).toBe('veiled_hollow');
    expect(p.pos.x).toBeCloseTo(PORTAL.b.landing.x, 5);
    expect(p.pos.z).toBeCloseTo(PORTAL.b.landing.z, 5);
    expect(logTexts(events)).toContain(PORTAL.enterText);
  });

  it('teleports a player who walks into the Hollow cave back to Thornpeak', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    sim.tick();
    teleport(sim, a, PORTAL.b.x, PORTAL.b.z);
    const events = sim.tick();
    const p = sim.entities.get(a)!;
    expect(zoneAt(p.pos.x, p.pos.z).id).toBe('thornpeak_heights');
    expect(p.pos.x).toBeCloseTo(PORTAL.a.landing.x, 5);
    expect(p.pos.z).toBeCloseTo(PORTAL.a.landing.z, 5);
    expect(logTexts(events)).toContain(PORTAL.leaveText);
  });

  it('never ping-pongs: an arrival standing still stays put', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    sim.tick();
    teleport(sim, a, PORTAL.a.x, PORTAL.a.z);
    sim.tick();
    const p = sim.entities.get(a)!;
    const landed = { x: p.pos.x, z: p.pos.z };
    for (let i = 0; i < 100; i++) sim.tick();
    expect(p.pos.x).toBeCloseTo(landed.x, 5);
    expect(p.pos.z).toBeCloseTo(landed.z, 5);
    expect(zoneAt(p.pos.x, p.pos.z).id).toBe('veiled_hollow');
  });

  it('emits the flavor line to the traveler only', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    sim.addPlayer('mage', 'Beth');
    sim.tick();
    teleport(sim, a, PORTAL.a.x, PORTAL.a.z);
    const events = sim.tick();
    const line = events.find(
      (e): e is Extract<SimEvent, { type: 'log' }> =>
        e.type === 'log' && e.text === PORTAL.enterText,
    );
    expect(line).toBeDefined();
    expect(line!.pid).toBe(a);
  });

  it('respawns a player who dies in the Hollow at the realm graveyard', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    sim.tick();
    teleport(sim, a, PORTAL.a.x, PORTAL.a.z);
    sim.tick();
    const p = sim.entities.get(a)!;
    (sim as any).dealDamage(p, p, p.hp + 1000);
    sim.tick();
    expect(p.dead).toBe(true);
    sim.releaseSpirit(a);
    sim.tick();
    expect(zoneAt(p.pos.x, p.pos.z).id).toBe('veiled_hollow');
  });

  it('keeps two same-seed worlds identical through a portal crossing', () => {
    const run = () => {
      const sim = makeWorld();
      const a = sim.addPlayer('warrior', 'Aleph');
      sim.tick();
      teleport(sim, a, PORTAL.a.x, PORTAL.a.z);
      for (let i = 0; i < 50; i++) sim.tick();
      const p = sim.entities.get(a)!;
      return [p.pos.x, p.pos.y, p.pos.z, sim.rng.next()];
    };
    expect(run()).toEqual(run());
  });
});
