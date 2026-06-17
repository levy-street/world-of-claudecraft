import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import { dist2d, FAST_TRAVEL_COST } from '../src/sim/types';
import { NPCS } from '../src/sim/data';
import type { Entity } from '../src/sim/types';

const makeSim = (seed = 11) => new Sim({ seed, playerClass: 'warrior', autoEquip: true });

function npc(sim: Sim, templateId: string): Entity {
  for (const e of sim.entities.values()) {
    if (e.kind === 'npc' && e.templateId === templateId) return e;
  }
  throw new Error(`npc ${templateId} not spawned`);
}

// stand on top of an NPC so range checks pass
function standAt(sim: Sim, e: Entity): void {
  const p = sim.player;
  p.pos = { ...e.pos };
  p.prevPos = { ...e.pos };
}

describe('fast travel', () => {
  it('places a wayfinder in each of the three towns', () => {
    for (const id of ['wayfinder_eastbrook', 'wayfinder_fenbridge', 'wayfinder_highwatch']) {
      expect(NPCS[id]?.wayfinder).toBe(true);
    }
  });

  it('charges 1 silver and fast-travels the player to the chosen town hub', () => {
    const sim = makeSim();
    const fm = npc(sim, 'wayfinder_eastbrook');
    standAt(sim, fm);
    sim.copper = 500;
    sim.travelTo(fm.id, 1); // -> Fenbridge (z 300)
    expect(sim.copper).toBe(500 - FAST_TRAVEL_COST);
    expect(dist2d(sim.player.pos, { x: 0, y: 0, z: 300 })).toBeLessThan(2);
  });

  it('refuses without enough money — no charge, no teleport', () => {
    const sim = makeSim();
    const fm = npc(sim, 'wayfinder_eastbrook');
    standAt(sim, fm);
    const before = { ...sim.player.pos };
    sim.copper = FAST_TRAVEL_COST - 1;
    sim.travelTo(fm.id, 2); // -> Highwatch
    expect(sim.copper).toBe(FAST_TRAVEL_COST - 1);
    expect(dist2d(sim.player.pos, before)).toBeLessThan(0.01);
  });

  it('refuses when out of range of the wayfinder', () => {
    const sim = makeSim();
    const fm = npc(sim, 'wayfinder_eastbrook');
    sim.copper = 500;
    sim.player.pos = { x: 200, y: 0, z: 200 }; // far from the NPC
    sim.player.prevPos = { ...sim.player.pos };
    sim.travelTo(fm.id, 1);
    expect(sim.copper).toBe(500); // not charged
    expect(sim.player.pos.x).toBe(200);
  });

  it('is a no-op when traveling to the town you are already in', () => {
    const sim = makeSim();
    const fm = npc(sim, 'wayfinder_eastbrook');
    standAt(sim, fm);
    sim.copper = 500;
    sim.travelTo(fm.id, 0); // Eastbrook = current zone
    expect(sim.copper).toBe(500);
  });
});
