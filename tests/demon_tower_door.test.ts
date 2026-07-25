// The Demon Tower's door is a permanent landmark, not a scheduled world event.
// These assertions pin the two things that would quietly break it: the sentinel
// seed colliding with a rolled portal seed (which would make random rifts open
// the tower), and the door failing to mint, mutating, or duplicating.

import { describe, expect, it } from 'vitest';
import { DEMON_TOWER_SEED, isDemonTowerSeed } from '../src/sim/content/rift/demon_tower';
import { BUILTIN_WORLD } from '../src/sim/data';
import { RIFT_RANK_BASE_LEVEL } from '../src/sim/rift/ranks';
import { DEMON_TOWER_DOOR } from '../src/sim/rift/tower';
import { Sim } from '../src/sim/sim';
import type { Entity, WorldContent } from '../src/sim/types';
import { waterLevel } from '../src/sim/world';

const TOWER_WORLD: WorldContent = {
  ...BUILTIN_WORLD,
  camps: [],
  npcs: {},
  groundObjects: [],
};

function makeSim() {
  const sim = new Sim({
    seed: 4242,
    playerClass: 'warrior',
    autoEquip: true,
    devCommands: true,
    world: TOWER_WORLD,
  });
  sim.setPlayerLevel(20);
  sim.player.devGod = true;
  return sim;
}

function towerDoors(sim: Sim): Entity[] {
  return [...sim.entities.values()].filter(
    (e) => e.templateId === 'rift_portal' && e.riftSeed === DEMON_TOWER_SEED,
  );
}

describe('demon tower door', () => {
  // The scheduler rolls `rng.int(1, 1_000_000_000)` for a natural portal seed
  // (rift/portals.ts). If the sentinel ever fell inside that range, a random
  // world portal could open the tower.
  it('uses a sentinel seed a rolled portal can never produce', () => {
    expect(DEMON_TOWER_SEED).toBeGreaterThan(1_000_000_000);
    expect(isDemonTowerSeed(DEMON_TOWER_SEED)).toBe(true);
    // Sanity: nothing inside the rolled range reads as the tower.
    for (const seed of [1, 2, 999, 500_000_000, 1_000_000_000]) {
      expect(isDemonTowerSeed(seed)).toBe(false);
    }
  });

  it('mints exactly one door, at its fixed spot, on dry land', () => {
    const sim = makeSim();
    sim.tick();
    const doors = towerDoors(sim);
    expect(doors).toHaveLength(1);
    const door = doors[0];
    expect(door.pos.x).toBe(DEMON_TOWER_DOOR.x);
    expect(door.pos.z).toBe(DEMON_TOWER_DOOR.z);
    // A landmark under the waterline would be unreachable.
    expect(door.pos.y).toBeGreaterThan(waterLevel());
    // Endgame content: entered at the top rank's base level.
    expect(door.riftBaseLevel).toBe(RIFT_RANK_BASE_LEVEL.S);
  });

  it('never mints a second door, however long the world runs', () => {
    const sim = makeSim();
    for (let i = 0; i < 120; i++) sim.tick();
    expect(towerDoors(sim)).toHaveLength(1);
  });

  it('is a landmark, not a world event: no tier, no event, no expiry', () => {
    const sim = makeSim();
    sim.tick();
    const door = towerDoors(sim)[0];
    expect(door.riftTier).toBeUndefined();
    expect(door.riftEventId).toBeUndefined();
    // A scheduled portal registers for collapse/seal bookkeeping; the tower must not.
    expect(sim.naturalRiftPortals.some((p) => p.id === door.id)).toBe(false);
  });

  it('walking into it enters the tower, not a procedural rift', () => {
    const sim = makeSim();
    sim.tick();
    const door = towerDoors(sim)[0];
    sim.player.pos = { ...door.pos };
    sim.tick();
    const inst = sim.riftInstances.find((i) => i.partyKey !== null);
    expect(inst).toBeTruthy();
    expect(inst!.seed >>> 0).toBe(DEMON_TOWER_SEED);
    expect(inst!.floorCount).toBe(10);
  });
});
