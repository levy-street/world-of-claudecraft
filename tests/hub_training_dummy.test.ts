// The Eastbrook hub training dummy (content/practice_dummies.ts
// HUB_PRACTICE_DUMMY_CAMPS): a second `training_dummy` camp on the quay pad
// where every new character first stands, so a build can be measured in town
// without the ride to the hill above Highwatch. Same template, same inert
// behavior; what this suite pins is the PLACEMENT (on its authored mark, a few
// yards from the player start, on ground the sim can spawn on) and the
// append-last contract that keeps every earlier entity id untouched.
import { describe, expect, it } from 'vitest';
import { isBlocked } from '../src/sim/colliders';
import {
  HUB_PRACTICE_DUMMY_CAMPS,
  HUB_PRACTICE_NPCS,
  HUB_TRAINING_DUMMY_POS,
} from '../src/sim/content/practice_dummies';
import { BUILTIN_WORLD, CAMPS, PLAYER_START } from '../src/sim/data';
import { Sim } from '../src/sim/sim';
import type { Entity, WorldContent } from '../src/sim/types';
import { groundHeight, waterLevelAt } from '../src/sim/world';

const SEED = 42;

// Only the hub dummy is targeted here; the rest of the world is Sim-construction
// overhead (the trimming tests/training_dummy.test.ts uses for the Highwatch one).
// The yard spawns off the sparring master's def (sim/hub_practice.ts), so the
// trimmed world keeps exactly that one NPC and no camps.
const HUB_DUMMY_WORLD: WorldContent = {
  ...BUILTIN_WORLD,
  camps: [],
  npcs: HUB_PRACTICE_NPCS,
  groundObjects: [],
};

function makeWorld(): Sim {
  return new Sim({ seed: SEED, playerClass: 'warrior', world: HUB_DUMMY_WORLD });
}

function dummyOf(sim: Sim): Entity {
  const { x, z } = HUB_TRAINING_DUMMY_POS;
  const d = [...sim.entities.values()].find(
    (e) => e.templateId === 'training_dummy' && !e.dead && Math.hypot(e.pos.x - x, e.pos.z - z) < 5,
  );
  if (!d) throw new Error('hub training dummy not spawned');
  return d;
}

describe('Eastbrook hub training dummy', () => {
  it('is NOT a camp: it spawns after the player so no construction-time id or rng draw moves', () => {
    expect(CAMPS.some((camp) => camp.center.z === HUB_TRAINING_DUMMY_POS.z)).toBe(false);
    expect(HUB_PRACTICE_DUMMY_CAMPS[0].mobId).toBe('training_dummy');
    // With the yard and without it, the player and every earlier entity keep
    // their ids; the yard's own two entities trail the player.
    const withYard = new Sim({ seed: SEED, playerClass: 'warrior', world: BUILTIN_WORLD });
    const { drillmaster_hale: _hale, ...npcsWithoutHale } = BUILTIN_WORLD.npcs;
    const withoutYard = new Sim({
      seed: SEED,
      playerClass: 'warrior',
      world: { ...BUILTIN_WORLD, npcs: npcsWithoutHale },
    });
    expect(withYard.playerId).toBe(withoutYard.playerId);
    expect(withYard.entities.size).toBe(withoutYard.entities.size + 2);
    expect(dummyOf(withYard).id).toBeGreaterThan(withYard.playerId);
    expect(
      [...withoutYard.entities.values()].some((e) => e.templateId === 'drillmaster_hale'),
    ).toBe(false);
  });

  it('stands on its authored mark, on dry standable ground, a few yards from the player start', () => {
    const { x, z } = HUB_TRAINING_DUMMY_POS;
    // Ground the sim can spawn on: not inside a prop or building, above water.
    expect(isBlocked(SEED, x, z, 0.5)).toBe(false);
    expect(groundHeight(x, z, SEED)).toBeGreaterThan(waterLevelAt(x, z, SEED));
    // The FULL built-in world here (npcs, ground objects, every camp): the
    // source comment claims clearance from the quay's NPCs and props, and a
    // trimmed world would stay green if a layout change parked one on the mark.
    const sim = new Sim({ seed: SEED, playerClass: 'warrior', world: BUILTIN_WORLD });
    const d = dummyOf(sim);
    for (const e of sim.entities.values()) {
      if (e.id === d.id || e.id === sim.player.id) continue;
      expect(Math.hypot(e.pos.x - d.pos.x, e.pos.z - d.pos.z)).toBeGreaterThan(3);
    }
    // findSafePos left it exactly where it was authored (nothing shoved it).
    expect(Math.round(d.pos.x)).toBe(x);
    expect(Math.round(d.pos.z)).toBe(z);
    const dist = Math.hypot(d.pos.x - PLAYER_START.x, d.pos.z - PLAYER_START.z);
    expect(dist).toBeGreaterThan(5); // not on top of the spawn point
    expect(dist).toBeLessThan(15); // in sight of a fresh character
  });

  it('is the same inert practice target as the Highwatch one: hit it, it never fights back', () => {
    const sim = makeWorld();
    const d = dummyOf(sim);
    expect(d.hostile).toBe(true);
    expect(d.maxHp).toBeGreaterThan(100000);
    const player = sim.player;
    sim.setPlayerLevel(20, player.id);
    player.pos.x = d.pos.x + 1;
    player.pos.z = d.pos.z;
    player.pos.y = groundHeight(player.pos.x, player.pos.z, SEED);
    player.targetId = d.id;
    player.autoAttack = true;
    const startHp = d.hp;
    for (let i = 0; i < 20 * 6; i++) sim.tick();
    expect(d.hp).toBeLessThan(startHp);
    expect(d.aggroTargetId).toBe(null);
    expect(d.aiState).toBe('idle');
    expect(player.hp).toBe(player.maxHp);
  });
});
