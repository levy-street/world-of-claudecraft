// The Highwatch practice row: the three dummies that join the original training
// dummy on the hill above Highwatch so a rotation can be measured against the
// profiles the endgame actually presents (a geared ally, a normal boss, a heroic
// boss) instead of only against zero armor at level 20.
//
// Two things are being pinned here. First, the DERIVATIONS: the boss dummies copy
// Nythraxis, and the friendly dummy copies the best-in-slot reference player, and
// both must track their sources rather than drift into hand-typed numbers.
// Second, the BEHAVIOR contract shared with the training dummy: inert, unpullable,
// and self-resetting.
import { describe, expect, it } from 'vitest';
import { isPullEligible } from '../src/sim/combat/pull_eligibility';
import {
  FRIENDLY_PLAYER_DUMMY_ID,
  HEROIC_BOSS_DUMMY_ID,
  NORMAL_BOSS_DUMMY_ID,
  PRACTICE_ROW_ORDER,
  PRACTICE_ROW_SPACING,
  PRACTICE_ROW_Z,
} from '../src/sim/content/practice_dummies';
import { BUILTIN_WORLD, MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { mobTemplateForDungeonDifficulty } from '../src/sim/instances/difficulty';
import {
  PLAYER_DUMMY_REST_HP_FRACTION,
  playerDummyRestHp,
  playerDummyShedHp,
  playerDummyVitals,
} from '../src/sim/mob/practice_dummies';
import { Sim } from '../src/sim/sim';
import type { Entity, WorldContent } from '../src/sim/types';
import { groundHeight } from '../src/sim/world';

const NYTHRAXIS_ID = 'nythraxis_scourge_of_thornpeak';
const NYTHRAXIS_ARENA = 'nythraxis_boss_arena';

// Only the practice row is ever targeted here, so the rest of the world is pure
// Sim-construction overhead (same trimming as tests/training_dummy.test.ts).
const PRACTICE_ROW_WORLD: WorldContent = {
  ...BUILTIN_WORLD,
  camps: BUILTIN_WORLD.camps.filter((camp) => PRACTICE_ROW_ORDER.includes(camp.mobId)),
  npcs: {},
  groundObjects: [],
};

function makeWorld(): Sim {
  return new Sim({
    seed: 42,
    playerClass: 'warrior',
    noPlayer: true,
    world: PRACTICE_ROW_WORLD,
  });
}

function dummyOf(sim: Sim, templateId: string): Entity {
  const d = [...sim.entities.values()].find((e) => e.templateId === templateId && !e.dead);
  if (!d) throw new Error(`${templateId} not spawned`);
  return d;
}

function moveEntityTo(sim: Sim, entity: Entity, x: number, z: number): void {
  entity.pos.x = x;
  entity.pos.z = z;
  entity.pos.y = groundHeight(x, z, sim.cfg.seed);
  entity.prevPos = { ...entity.pos };
  (sim as unknown as { rebucket(e: Entity): void }).rebucket(entity);
}

function playerAt(sim: Sim, cls: 'warrior' | 'priest', name: string, x: number, z: number): Entity {
  const pid = sim.addPlayer(cls, name, { autoEquip: true });
  sim.setPlayerLevel(20, pid);
  const e = sim.entities.get(pid);
  if (!e) throw new Error('player not spawned');
  moveEntityTo(sim, e, x, z);
  return e;
}

/** The armor a real Nythraxis spawn carries at the given difficulty. */
function nythraxisArmor(difficulty: 'normal' | 'heroic'): number {
  const template = mobTemplateForDungeonDifficulty(MOBS[NYTHRAXIS_ID], NYTHRAXIS_ARENA, difficulty);
  return createMob(1, template, template.maxLevel, { x: 0, y: 0, z: 0 }).stats.armor;
}

describe('the Highwatch practice row', () => {
  it('stands the four dummies 2 yards apart in ally, trash, normal boss, heroic boss order', () => {
    const sim = makeWorld();
    const xs = PRACTICE_ROW_ORDER.map((id) => dummyOf(sim, id).pos.x);

    // The requested order, east to west (ascending x; engine east is minus x),
    // at the requested pitch.
    expect(xs.map(Math.round)).toEqual([-42, -40, -38, -36]);
    for (let i = 1; i < xs.length; i++) {
      expect(Math.round(xs[i] - xs[i - 1])).toBe(PRACTICE_ROW_SPACING);
    }
    // One line: the row is a row, not a cluster.
    for (const id of PRACTICE_ROW_ORDER) {
      expect(Math.round(dummyOf(sim, id).pos.z)).toBe(PRACTICE_ROW_Z);
    }
    // The original training dummy did not move off its shipped mark, which the
    // Wall Drills deed and tests/training_dummy.test.ts both name.
    expect(Math.round(dummyOf(sim, 'training_dummy').pos.x)).toBe(-40);
  });

  it('gives the normal boss dummy normal Nythraxis level and armor', () => {
    const sim = makeWorld();
    const d = dummyOf(sim, NORMAL_BOSS_DUMMY_ID);

    expect(d.level).toBe(MOBS[NYTHRAXIS_ID].maxLevel);
    expect(d.level).toBe(20);
    expect(d.stats.armor).toBe(nythraxisArmor('normal'));
    // Non-vacuous: normal Nythraxis is armored, unlike the zero-armor training
    // dummy this row is measured against.
    expect(d.stats.armor).toBe(798);
    expect(dummyOf(sim, 'training_dummy').stats.armor).toBe(0);
  });

  it('gives the heroic boss dummy heroic Nythraxis level and armor', () => {
    const sim = makeWorld();
    const d = dummyOf(sim, HEROIC_BOSS_DUMMY_ID);

    // Level 22 is the whole point of the heroic profile: it is what puts a
    // level-20 attacker on the heroic side of the melee and spell hit tables.
    expect(d.level).toBe(22);
    expect(d.stats.armor).toBe(nythraxisArmor('heroic'));
    expect(d.stats.armor).toBe(1058);
    // And it is strictly the harder target of the two, on both axes.
    const normal = dummyOf(sim, NORMAL_BOSS_DUMMY_ID);
    expect(d.stats.armor).toBeGreaterThan(normal.stats.armor);
    expect(d.level).toBeGreaterThan(normal.level);
  });

  it('gives the friendly dummy the best-in-slot reference player body, at rest', () => {
    const sim = makeWorld();
    const d = dummyOf(sim, FRIENDLY_PLAYER_DUMMY_ID);
    const vitals = playerDummyVitals();

    expect(d.level).toBe(20);
    expect(d.maxHp).toBe(vitals.maxHp);
    expect(d.stats.armor).toBe(vitals.armor);
    expect(d.hp).toBe(playerDummyRestHp(vitals.maxHp));
    // A player-sized pool, not the practice targets near-immortal one: heals
    // have to read as a real fraction of the bar.
    expect(d.maxHp).toBeGreaterThan(1000);
    expect(d.maxHp).toBeLessThan(20000);
    expect(dummyOf(sim, NORMAL_BOSS_DUMMY_ID).maxHp).toBeGreaterThan(100000);
  });

  it.each([NORMAL_BOSS_DUMMY_ID, HEROIC_BOSS_DUMMY_ID])(
    '%s takes damage without aggroing, moving, or retaliating',
    (templateId) => {
      const sim = makeWorld();
      const d = dummyOf(sim, templateId);
      const before = { x: d.pos.x, z: d.pos.z };
      const player = playerAt(sim, 'warrior', 'Tester', d.pos.x + 1, d.pos.z);
      player.targetId = d.id;
      player.autoAttack = true;

      const startHp = d.hp;
      for (let i = 0; i < 20 * 8; i++) sim.tick();

      expect(d.hp).toBeLessThan(startHp); // the damage lands and counts
      expect(d.aggroTargetId).toBe(null);
      expect(d.aiState).toBe('idle');
      expect(d.pos.x).toBe(before.x);
      expect(d.pos.z).toBe(before.z);
      expect(player.hp).toBe(player.maxHp); // never fights back
    },
  );

  it.each(PRACTICE_ROW_ORDER)('%s can never be pulled off its marker', (templateId) => {
    const sim = makeWorld();
    expect(isPullEligible(dummyOf(sim, templateId))).toBe(false);
  });

  it('heals the friendly dummy for real, then sheds it back to rest', () => {
    const sim = makeWorld();
    const d = dummyOf(sim, FRIENDLY_PLAYER_DUMMY_ID);
    const priest = playerAt(sim, 'priest', 'Healer', d.pos.x - 5, d.pos.z);
    priest.targetId = d.id;
    sim.tick();

    expect(d.hostile).toBe(false);
    expect(sim.isHostileTo(priest, d)).toBe(false);

    const rest = playerDummyRestHp(d.maxHp);
    expect(d.hp).toBe(rest);

    // The heal LANDS (effective healing, not overheal): the whole reason the
    // dummy rests below full.
    sim.castAbility('lesser_heal', priest.id);
    for (let i = 0; i < 20 * 2; i++) sim.tick();
    expect(d.hp).toBeGreaterThan(rest);

    // Healing an ally is not combat, for either side.
    expect(d.inCombat).toBe(false);
    expect(priest.inCombat).toBe(false);
    expect(d.threat.size).toBe(0);

    // ...and it drains back down on its own, so the next player finds it ready.
    for (let i = 0; i < 20 * 30; i++) sim.tick();
    expect(d.hp).toBe(rest);
    expect(d.dead).toBe(false);
  });
});

describe('playerDummyShedHp', () => {
  const maxHp = 4000;
  const rest = playerDummyRestHp(maxHp);

  it('rests at the resting fraction of the pool', () => {
    expect(rest).toBe(Math.round(maxHp * PLAYER_DUMMY_REST_HP_FRACTION));
    expect(rest).toBeLessThan(maxHp);
  });

  it('drains health above the resting mark and stops exactly there', () => {
    const shed = playerDummyShedHp(maxHp, maxHp, 1);
    expect(shed).toBeLessThan(maxHp);
    expect(shed).toBeGreaterThan(rest);
    // Far more than one top-off worth of time still lands on rest, never under.
    expect(playerDummyShedHp(maxHp, maxHp, 600)).toBe(rest);
  });

  it('leaves health at or below the resting mark alone, so a heal is what moves it', () => {
    expect(playerDummyShedHp(rest, maxHp, 1)).toBe(rest);
    expect(playerDummyShedHp(1, maxHp, 1)).toBe(1);
  });
});
