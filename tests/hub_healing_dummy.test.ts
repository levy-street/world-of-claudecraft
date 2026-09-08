// The Eastbrook hub healing dummy (content/practice_dummies.ts
// HUB_HEALING_DUMMY_ID): a level-5 friendly Healing Dummy beside Hale's
// damage dummy, so the four healing-capable classes can practice the
// Healing tab of the Damage Meters without needing another player to stand
// in front of them. What this suite pins: literal level 5 (never the
// level-20 best-in-slot stamp the Highwatch row's own friendly dummy
// carries), a plain non-BIS pool, friendly/inert behavior, the authored
// placement, and the begin-injured/repeated-shed-to-rest mechanic shared
// with the Highwatch row.
import { describe, expect, it } from 'vitest';
import { isBlocked } from '../src/sim/colliders';
import {
  HUB_HEALING_DUMMY_ID,
  HUB_HEALING_DUMMY_POS,
  HUB_PRACTICE_NPCS,
  HUB_SPARRING_MASTER_POS,
  HUB_TRAINING_DUMMY_POS,
} from '../src/sim/content/practice_dummies';
import { BUILTIN_WORLD, MOBS } from '../src/sim/data';
import {
  PLAYER_DUMMY_LEVEL,
  playerDummyRestHp,
  playerDummyVitals,
} from '../src/sim/mob/practice_dummies';
import { Sim } from '../src/sim/sim';
import type { Entity, WorldContent } from '../src/sim/types';
import { groundHeight, waterLevelAt } from '../src/sim/world';

const SEED = 42;

const HUB_DUMMY_WORLD: WorldContent = {
  ...BUILTIN_WORLD,
  camps: [],
  npcs: HUB_PRACTICE_NPCS,
  groundObjects: [],
};

function makeWorld(): Sim {
  return new Sim({ seed: SEED, playerClass: 'priest', world: HUB_DUMMY_WORLD });
}

function healingDummyOf(sim: Sim): Entity {
  const { x, z } = HUB_HEALING_DUMMY_POS;
  const d = [...sim.entities.values()].find(
    (e) =>
      e.templateId === HUB_HEALING_DUMMY_ID && !e.dead && Math.hypot(e.pos.x - x, e.pos.z - z) < 5,
  );
  if (!d) throw new Error('hub healing dummy not spawned');
  return d;
}

describe('the hub healing dummy is a level-5 template of its own', () => {
  it('never borrows the Highwatch row`s level-20 best-in-slot stamp', () => {
    const template = MOBS[HUB_HEALING_DUMMY_ID];
    expect(template.minLevel).toBe(5);
    expect(template.maxLevel).toBe(5);
    expect(template.minLevel).not.toBe(PLAYER_DUMMY_LEVEL);
    expect(template.friendlyPracticeTarget).toBe(true);
    expect(template.dummy).toBe(true);
    expect(template.dmgBase).toBe(0);
    expect(template.loot).toEqual([]);
    // Its own plain pool, not the level-20 reference kit's.
    const bisVitals = playerDummyVitals();
    const level5Hp = template.hpBase + template.hpPerLevel * (5 - 1);
    expect(level5Hp).toBeLessThan(bisVitals.maxHp);
    expect(level5Hp).toBeGreaterThan(50); // a meaningful pool, not the 999,999 dummy row
    expect(level5Hp).toBeLessThan(500);
  });

  it('spawns at literal level 5 in a real Sim', () => {
    const sim = makeWorld();
    const d = healingDummyOf(sim);
    expect(d.level).toBe(5);
    expect(d.hostile).toBe(false);
    expect(d.friendlyPracticeTarget).toBe(true);
  });
});

describe('placement: near Hale, clear of the road and every quay neighbour', () => {
  it('stands on dry, unblocked ground a few yards from Hale and the damage dummy', () => {
    const { x, z } = HUB_HEALING_DUMMY_POS;
    expect(isBlocked(SEED, x, z, 0.5)).toBe(false);
    expect(groundHeight(x, z, SEED)).toBeGreaterThan(waterLevelAt(x, z, SEED));
    const toHale = Math.hypot(x - HUB_SPARRING_MASTER_POS.x, z - HUB_SPARRING_MASTER_POS.z);
    expect(toHale).toBeGreaterThan(2.5); // not on top of him
    expect(toHale).toBeLessThan(8); // "beside it" is true
    const toDamageDummy = Math.hypot(x - HUB_TRAINING_DUMMY_POS.x, z - HUB_TRAINING_DUMMY_POS.z);
    expect(toDamageDummy).toBeGreaterThan(2.5); // its own mark, not stacked on the other dummy
  });

  it('findSafePos leaves it exactly on its authored mark, clear of every other quay entity', () => {
    const sim = new Sim({ seed: SEED, playerClass: 'priest', world: BUILTIN_WORLD });
    const d = healingDummyOf(sim);
    expect(Math.round(d.pos.x)).toBe(HUB_HEALING_DUMMY_POS.x);
    expect(Math.round(d.pos.z)).toBe(HUB_HEALING_DUMMY_POS.z);
    for (const e of sim.entities.values()) {
      if (e.id === d.id || e.id === sim.player.id) continue;
      expect(Math.hypot(e.pos.x - d.pos.x, e.pos.z - d.pos.z)).toBeGreaterThan(2.5);
    }
  });

  it('is NOT a camp: it trails the damage dummy and Hale, so neither of their ids move', () => {
    const withYard = new Sim({ seed: SEED, playerClass: 'priest', world: BUILTIN_WORLD });
    const { drillmaster_hale: _hale, ...npcsWithoutHale } = BUILTIN_WORLD.npcs;
    const withoutYard = new Sim({
      seed: SEED,
      playerClass: 'priest',
      world: { ...BUILTIN_WORLD, npcs: npcsWithoutHale },
    });
    expect(withYard.entities.size).toBe(withoutYard.entities.size + 3);
    const damageDummy = [...withYard.entities.values()].find(
      (e) => e.templateId === 'hub_training_dummy',
    )!;
    const hale = [...withYard.entities.values()].find((e) => e.templateId === 'drillmaster_hale')!;
    const healingDummy = healingDummyOf(withYard);
    expect(healingDummy.id).toBeGreaterThan(hale.id);
    expect(hale.id).toBeGreaterThan(damageDummy.id);
  });
});

describe('inert and friendly: no damage, no loot, never fights back', () => {
  it('is unhostile and un-lootable, and stays put under repeated ticks', () => {
    const sim = makeWorld();
    const d = healingDummyOf(sim);
    expect(d.hostile).toBe(false);
    const startPos = { ...d.pos };
    for (let i = 0; i < 20 * 5; i++) sim.tick();
    expect(d.pos.x).toBe(startPos.x);
    expect(d.pos.z).toBe(startPos.z);
    expect(d.dead).toBe(false);
  });
});

describe('begins injured and repeatedly sheds healing back toward its rest mark', () => {
  it('spawns below full health, at the same shared rest fraction as the Highwatch ally dummy', () => {
    const sim = makeWorld();
    const d = healingDummyOf(sim);
    expect(d.hp).toBeLessThan(d.maxHp);
    expect(d.hp).toBe(playerDummyRestHp(d.maxHp));
  });

  it('a real heal lands, then repeated ticks shed it back down to rest: practice repeats forever', () => {
    const sim = makeWorld();
    const d = healingDummyOf(sim);
    const restHp = playerDummyRestHp(d.maxHp);
    expect(d.hp).toBe(restHp);
    // Top it off directly (heal math itself is exercised in
    // hub_healing_drill.test.ts): simulate a healer's work finishing.
    d.hp = d.maxHp;
    for (let i = 0; i < 20 * 60; i++) sim.tick(); // up to a minute of shedding
    expect(d.hp).toBe(restHp); // settled back at rest, never below it
    // Healable again immediately: the next player finds the same lesson.
    expect(d.maxHp - d.hp).toBeGreaterThan(0);
  });
});
