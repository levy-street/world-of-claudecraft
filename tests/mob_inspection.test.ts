// The mob inspect window's sim half: the shared spawn-stat formula owner
// (src/sim/mob/combat_stats.ts, which createMob now stamps from) and the cold
// live read (src/sim/mob/inspection.ts, Sim.mobInspectInfo), driven through a
// REAL Sim on the empty test world like tests/corpse_harvest_inspection.test.ts.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DUNGEONS, MOBS, setActiveWorldContent } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { applyDungeonSpawnMinibossTuning } from '../src/sim/instances/dungeon_spawn_miniboss';
import { mobCombatStats } from '../src/sim/mob/combat_stats';
import { MOB_INSPECT_RANGE, mobInspectInfo } from '../src/sim/mob/inspection';
import { Sim } from '../src/sim/sim';
import {
  type Entity,
  type MobTemplate,
  PLAYER_INTEREST_DROP_RADIUS,
  type WorldContent,
} from '../src/sim/types';
import { expectDefined } from './helpers/defined';
import { placeInDungeon } from './helpers/instanced_contexts';
import { EMPTY_TEST_WORLD } from './sim_shared';

const TEST_WORLD: WorldContent = { ...EMPTY_TEST_WORLD, roads: [] };

beforeAll(() => setActiveWorldContent(TEST_WORLD));
afterAll(() => setActiveWorldContent(null));

const WOLF: MobTemplate = MOBS.forest_wolf;

function place(sim: Sim, e: Entity, x: number, z: number): void {
  e.pos = sim.groundPos(x, z);
  e.prevPos = { ...e.pos };
  e.vx = 0;
  e.vy = 0;
  e.vz = 0;
  e.onGround = true;
}

function setup() {
  const sim = new Sim({ seed: 7, playerClass: 'warrior', noPlayer: true, world: TEST_WORLD });
  const pid = sim.addPlayer('warrior', 'Alpha');
  sim.tick();
  place(sim, expectDefined(sim.entities.get(pid)), 0, 0);
  const mob = createMob(9001, WOLF, WOLF.maxLevel, sim.groundPos(10, 0));
  sim.entities.set(mob.id, mob);
  return { sim, pid, mob };
}

describe('mobCombatStats (the spawn formula owner)', () => {
  it('computes the classic level curve for a normal mob', () => {
    const t: MobTemplate = {
      ...WOLF,
      elite: false,
      hpBase: 40,
      hpPerLevel: 10,
      dmgBase: 4,
      dmgPerLevel: 2,
      armorPerLevel: 15,
      attackSpeed: 2,
    };
    // level 5: hp 40+40=80, dmg 4+8=12 -> 9.6..15 rounded, armor 60.
    expect(mobCombatStats(t, 5)).toEqual({
      maxHp: 80,
      weaponMin: 10,
      weaponMax: 15,
      attackSpeed: 2,
      armor: 60,
    });
  });

  it('applies the elite multipliers (2.3x health, 1.5x damage) and leaves armor alone', () => {
    const base: MobTemplate = {
      ...WOLF,
      hpBase: 100,
      hpPerLevel: 0,
      dmgBase: 10,
      dmgPerLevel: 0,
      armorPerLevel: 10,
    };
    const normal = mobCombatStats({ ...base, elite: false }, 3);
    const elite = mobCombatStats({ ...base, elite: true }, 3);
    expect(normal.maxHp).toBe(100);
    expect(elite.maxHp).toBe(230);
    expect(normal.weaponMin).toBe(8);
    expect(normal.weaponMax).toBe(13);
    expect(elite.weaponMin).toBe(12);
    expect(elite.weaponMax).toBe(19);
    expect(elite.armor).toBe(normal.armor);
  });

  it('is exactly what createMob stamps on a fresh spawn', () => {
    for (const template of Object.values(MOBS).slice(0, 40)) {
      const level = template.maxLevel;
      const mob = createMob(1, template, level, { x: 0, y: 0, z: 0 });
      const stats = mobCombatStats(template, level);
      expect(mob.maxHp, template.id).toBe(stats.maxHp);
      expect(mob.weapon, template.id).toEqual({
        min: stats.weaponMin,
        max: stats.weaponMax,
        speed: stats.attackSpeed,
      });
      expect(mob.stats.armor, template.id).toBe(stats.armor);
    }
  });
});

describe('Sim.mobInspectInfo (the live read)', () => {
  it('reports the spawn-stamped combat block of a nearby unowned mob', () => {
    const { sim, pid, mob } = setup();
    expect(sim.mobInspectInfo(mob.id, pid)).toEqual({
      mobId: mob.id,
      templateId: 'forest_wolf',
      level: mob.level,
      maxHp: mob.maxHp,
      weaponMin: mob.weapon.min,
      weaponMax: mob.weapon.max,
      attackSpeed: mob.weapon.speed,
      armor: mob.stats.armor,
      ccImmune: false,
      slowImmune: false,
    });
  });

  it('reports a promoted dungeon miniboss as immune, from its SPAWN flags', () => {
    const { sim, pid } = setup();
    // The shipped Crucible Warden promotion (content/dungeons.ts): the template
    // carries neither immunity, the spawn tuning grants both, and combat
    // (Sim.applyAura) honours the template OR the entity flag.
    const spawn = Object.values(DUNGEONS)
      .flatMap((d) => d.spawns)
      .find((s) => s.mobId === 'ignivar_crucible_warden' && s.miniboss?.ccImmune);
    const tuning = expectDefined(spawn?.miniboss);
    const template = MOBS.ignivar_crucible_warden;
    expect(template.ccImmune === true).toBe(false);
    expect(template.slowImmune === true).toBe(false);
    const warden = createMob(9002, template, template.maxLevel, sim.groundPos(12, 0));
    applyDungeonSpawnMinibossTuning(warden, tuning);
    sim.entities.set(warden.id, warden);
    const info = expectDefined(sim.mobInspectInfo(warden.id, pid));
    expect(info.ccImmune).toBe(true);
    expect(info.slowImmune).toBe(true);
    // The same template unpromoted reads neither.
    const plain = createMob(9003, template, template.maxLevel, sim.groundPos(14, 0));
    sim.entities.set(plain.id, plain);
    const plainInfo = expectDefined(sim.mobInspectInfo(plain.id, pid));
    expect([plainInfo.ccImmune, plainInfo.slowImmune]).toEqual([false, false]);
  });

  it('reads the LIVE entity, not the template (instance tuning rewrites the spawn)', () => {
    const { sim, pid, mob } = setup();
    mob.maxHp = 12345;
    mob.weapon = { min: 111, max: 222, speed: 1.5 };
    mob.stats.armor = 777;
    const info = expectDefined(sim.mobInspectInfo(mob.id, pid));
    expect(info.maxHp).toBe(12345);
    expect([info.weaponMin, info.weaponMax, info.attackSpeed]).toEqual([111, 222, 1.5]);
    expect(info.armor).toBe(777);
  });

  it('answers for a dead mob too (a corpse can still be inspected)', () => {
    const { sim, pid, mob } = setup();
    mob.dead = true;
    expect(sim.mobInspectInfo(mob.id, pid)?.mobId).toBe(mob.id);
  });

  it('refuses a player, an owned pet, and an unknown id', () => {
    const { sim, pid, mob } = setup();
    const other = sim.addPlayer('mage', 'Bravo');
    place(sim, expectDefined(sim.entities.get(other)), 2, 0);
    expect(sim.mobInspectInfo(other, pid)).toBeNull();
    mob.ownerId = other;
    expect(sim.mobInspectInfo(mob.id, pid)).toBeNull();
    expect(sim.mobInspectInfo(424242, pid)).toBeNull();
  });

  it('refuses past the interest drop edge and answers inside it', () => {
    const { sim, pid, mob } = setup();
    expect(MOB_INSPECT_RANGE).toBe(PLAYER_INTEREST_DROP_RADIUS);
    mob.pos = sim.groundPos(MOB_INSPECT_RANGE - 1, 0);
    expect(sim.mobInspectInfo(mob.id, pid)).not.toBeNull();
    mob.pos = sim.groundPos(MOB_INSPECT_RANGE + 1, 0);
    expect(sim.mobInspectInfo(mob.id, pid)).toBeNull();
  });

  it('refuses a mob outside the viewer instance scope', () => {
    const { sim, pid, mob } = setup();
    const before = expectDefined(sim.mobInspectInfo(mob.id, pid));
    expect(before.mobId).toBe(mob.id);
    placeInDungeon(sim, pid);
    // Stand the open-world mob right beside the player's new dungeon position:
    // position alone must not grant scope.
    const me = expectDefined(sim.entities.get(pid));
    mob.pos = { ...me.pos, x: me.pos.x + 2 };
    expect(sim.mobInspectInfo(mob.id, pid)).toBeNull();
  });

  it('draws no rng and mutates nothing', () => {
    const { sim, pid, mob } = setup();
    let draws = 0;
    sim.rng.setObserver(() => {
      draws++;
    });
    const snapshot = JSON.stringify(mob);
    mobInspectInfo(sim.ctx, mob.id, pid);
    mobInspectInfo(sim.ctx, mob.id, pid);
    sim.rng.setObserver(null);
    expect(draws).toBe(0);
    expect(JSON.stringify(mob)).toBe(snapshot);
  });
});
