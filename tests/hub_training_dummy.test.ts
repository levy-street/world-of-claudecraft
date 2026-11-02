// The Eastbrook hub training dummy (content/practice_dummies.ts
// HUB_PRACTICE_DUMMY_CAMPS): a DEDICATED level-5 `hub_training_dummy` in
// town, so a build can be measured without the ride to the hill above
// Highwatch. The Studio town rework (#4593) moved it off the quay pad to the
// Sableweb practice ground north of the player start. What this suite pins
// is the PLACEMENT (on its authored mark, on ground the sim can spawn on),
// its own level-5 body
// (never the shared level-20 zone3.ts `training_dummy`), and the
// append-last contract that keeps every earlier entity id untouched.
import { describe, expect, it } from 'vitest';
import { isBlocked } from '../src/sim/colliders';
import {
  HEALING_DUMMY_IDS,
  HEALING_TRAINING_ENTITY_IDS,
} from '../src/sim/content/healing_training';
import {
  HUB_PRACTICE_DUMMY_CAMPS,
  HUB_PRACTICE_NPCS,
  HUB_TRAINING_DUMMY_ID,
  HUB_TRAINING_DUMMY_POS,
} from '../src/sim/content/practice_dummies';
import { BUILTIN_WORLD, CAMPS, MOBS, PLAYER_START } from '../src/sim/data';
import { Sim } from '../src/sim/sim';
import type { Entity, WorldContent } from '../src/sim/types';
import { groundHeight, waterLevelAt } from '../src/sim/world';
import { HUB_TRAINING_DUMMY_MARK } from './helpers/hub_yard';

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
  const { x, z } = HUB_TRAINING_DUMMY_MARK;
  const d = [...sim.entities.values()].find(
    (e) =>
      e.templateId === HUB_TRAINING_DUMMY_ID && !e.dead && Math.hypot(e.pos.x - x, e.pos.z - z) < 5,
  );
  if (!d) throw new Error('hub training dummy not spawned');
  return d;
}

describe('Eastbrook hub training dummy', () => {
  it('is a dedicated level-5 template, never the shared level-20 training_dummy', () => {
    expect(HUB_TRAINING_DUMMY_ID).not.toBe('training_dummy');
    const template = MOBS[HUB_TRAINING_DUMMY_ID];
    expect(template.minLevel).toBe(5);
    expect(template.maxLevel).toBe(5);
    expect(template.dummy).toBe(true);
    expect(template.dmgBase).toBe(0);
    expect(template.loot).toEqual([]);
    // The Highwatch row's own body is untouched by this addition.
    expect(MOBS.training_dummy.minLevel).toBe(20);
    expect(MOBS.training_dummy.maxLevel).toBe(20);
  });

  it('is NOT a camp: it spawns after the player so no construction-time id or rng draw moves', () => {
    expect(CAMPS.some((camp) => camp.center.z === HUB_TRAINING_DUMMY_POS.z)).toBe(false);
    expect(CAMPS.some((camp) => camp.center.z === HUB_TRAINING_DUMMY_MARK.z)).toBe(false);
    expect(HUB_PRACTICE_DUMMY_CAMPS[0].mobId).toBe(HUB_TRAINING_DUMMY_ID);
    // With the yard and without it, the player and every earlier entity keep
    // their ids; Hale's local practice yard adds the three hub entities. The
    // Studio town rework (#4593) deleted the five high-id healing training
    // allies from the shipped world (their object moves are `removed`), so
    // none of them spawn here.
    const withYard = new Sim({ seed: SEED, playerClass: 'warrior', world: BUILTIN_WORLD });
    const { drillmaster_hale: _hale, ...npcsWithoutHale } = BUILTIN_WORLD.npcs;
    const withoutYard = new Sim({
      seed: SEED,
      playerClass: 'warrior',
      world: { ...BUILTIN_WORLD, npcs: npcsWithoutHale },
    });
    expect(withYard.playerId).toBe(withoutYard.playerId);
    expect(withYard.entities.size).toBe(withoutYard.entities.size + 3);
    expect(dummyOf(withYard).id).toBeGreaterThan(withYard.playerId);
    for (const id of HEALING_DUMMY_IDS) {
      expect(withYard.entities.has(HEALING_TRAINING_ENTITY_IDS[id])).toBe(false);
      expect([...withYard.entities.values()].some((e) => e.templateId === id)).toBe(false);
    }
    expect(
      [...withoutYard.entities.values()].some((e) => e.templateId === 'drillmaster_hale'),
    ).toBe(false);
  });

  it('stands on its authored mark, on dry standable ground, north of the player start', () => {
    // The Studio town rework (#4593) mark, as a literal: the map's spot, the
    // native content constant now (no touch-up object move rides over it).
    expect(HUB_TRAINING_DUMMY_MARK).toEqual({ x: -71.2, z: -6.56 });
    expect(HUB_TRAINING_DUMMY_MARK).toBe(HUB_TRAINING_DUMMY_POS);
    const { x, z } = HUB_TRAINING_DUMMY_MARK;
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
    // Nothing shoved it: it stands exactly where it was authored.
    expect(d.pos.x).toBeCloseTo(x, 6);
    expect(d.pos.z).toBeCloseTo(z, 6);
    // The rework moved the yard from eleven yards inland of the player start
    // to the practice ground about 56 yards north of it.
    const dist = Math.hypot(d.pos.x - PLAYER_START.x, d.pos.z - PLAYER_START.z);
    expect(dist).toBeGreaterThan(50);
    expect(dist).toBeLessThan(60);
  });

  it('spawns at literal level 5, inert like the Highwatch dummy: hit it, it never fights back', () => {
    const sim = makeWorld();
    const d = dummyOf(sim);
    expect(d.level).toBe(5);
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
