// Death in a Valdris zone must ghost the player at THAT zone's graveyard, not
// back on the tutorial island (bug: OVERWORLD_GRAVEYARDS only listed the three
// island zones, so the nearest-graveyard pick for any death past z=900 was the
// Thornpeak cairns). Every open Valdris zone contributes its declared
// graveyard; the sealed frontier (z >= SEALED_FRONTIER_Z) stays off the list.

import { describe, expect, it } from 'vitest';
import { OVERWORLD_GRAVEYARDS, SEALED_FRONTIER_Z, ZONES } from '../src/sim/data';
import { Sim } from '../src/sim/sim';
import { terrainHeight } from '../src/sim/world';

type AnySim = Sim & Record<string, any>;

function makeSim(): AnySim {
  return new Sim({ seed: 42, playerClass: 'warrior', autoEquip: true }) as AnySim;
}

function teleport(sim: AnySim, x: number, z: number): void {
  const e = sim.player;
  e.pos.x = x;
  e.pos.z = z;
  e.pos.y = terrainHeight(x, z, sim.cfg.seed);
  e.prevPos = { ...e.pos };
  sim.rebucket(e);
}

describe('valdris graveyards', () => {
  it('every open zone has a graveyard on the overworld list (sealed zones none)', () => {
    for (const zone of ZONES) {
      const near = OVERWORLD_GRAVEYARDS.some((g) => g.z >= zone.zMin - 60 && g.z <= zone.zMax + 60);
      if (zone.zMin >= SEALED_FRONTIER_Z) continue; // sealed: no ghost anchors
      expect(near, `zone ${zone.id} has no graveyard in reach`).toBe(true);
    }
    for (const g of OVERWORLD_GRAVEYARDS) {
      expect(g.z, `${g.id} sits in the sealed frontier`).toBeLessThan(SEALED_FRONTIER_Z);
    }
  });

  it('dying in Ossara ghosts you at an Ossara graveyard, not on the island', () => {
    const sim = makeSim();
    sim.setPlayerLevel(30);
    teleport(sim, 0, 1100); // mid Ossara Domain
    const killer = [...sim.entities.values()].find(
      (e: any) => e.kind === 'mob' && e.hostile && !e.dead,
    )!;
    sim.dealDamage(killer, sim.player, 9999999, false, 'physical', null, 'hit');
    expect(sim.player.dead).toBe(true);
    sim.releaseSpirit();
    expect(sim.player.pos.z).toBeGreaterThan(900); // stays in Valdris
    expect(sim.player.pos.z).toBeLessThan(1290); // at an Ossara graveyard band
  });

  it('dying at the Thornfen palisade ghosts you in the contested south', () => {
    const sim = makeSim();
    sim.setPlayerLevel(35);
    teleport(sim, 25, 2300);
    const killer = [...sim.entities.values()].find(
      (e: any) => e.kind === 'mob' && e.hostile && !e.dead,
    )!;
    sim.dealDamage(killer, sim.player, 9999999, false, 'physical', null, 'hit');
    sim.releaseSpirit();
    expect(sim.player.pos.z).toBeGreaterThan(2070);
    expect(sim.player.pos.z).toBeLessThan(2970);
  });
});
