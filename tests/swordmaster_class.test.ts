import { describe, expect, it } from 'vitest';
import { CLASSES, ITEMS } from '../src/sim/data';
import {
  canDualWield,
  canEquipItem,
  canEquipItemInSlot,
  maxArmorTypeForClass,
} from '../src/sim/equipment_rules';
import { Sim } from '../src/sim/sim';
import { ALL_CLASSES, type Entity, type PlayerClass } from '../src/sim/types';
import { terrainHeight } from '../src/sim/world';

type RuleTestSim = Sim & {
  moveSpeedMult(entity: Entity): number;
  playerGcdFor(cls: PlayerClass): number;
};

describe('SwordMaster class contract', () => {
  it('is the tenth melee DPS class with the canonical resource, color, and compact kit', () => {
    expect(ALL_CLASSES).toHaveLength(10);
    expect(ALL_CLASSES).toContain('swordmaster');
    expect(CLASSES.swordmaster).toMatchObject({
      id: 'swordmaster',
      name: 'SwordMaster',
      resourceType: 'energy',
      baseMana: 100,
      startWeapon: 'worn_sword',
      startOffhand: 'worn_sword',
      color: 0x22d3ee,
    });
    expect(CLASSES.swordmaster.abilities).toHaveLength(9);
    expect(CLASSES.swordmaster.abilities.slice(0, 6)).toEqual([
      'twin_slash',
      'crescent_sweep',
      'fleet_step',
      'sword_aura',
      'wind_lunge',
      'parrying_flow',
    ]);
  });

  it('starts at full Energy with a real one-handed sword in each hand', () => {
    const sim = new Sim({ seed: 71, playerClass: 'swordmaster' });

    expect(sim.player.resourceType).toBe('energy');
    expect(sim.player.resource).toBe(100);
    expect(sim.player.maxResource).toBe(100);
    expect(sim.equipment).toMatchObject({ mainhand: 'worn_sword', offhand: 'worn_sword' });
    expect(sim.player.weapon).toEqual(ITEMS.worn_sword.weapon);
    expect(sim.player.offhandWeapon).toEqual(ITEMS.worn_sword.weapon);
    expect(sim.player.dualWielding).toBe(true);
    expect(canDualWield('swordmaster', null)).toBe(true);
  });

  it('uses leather and permanent one-hand dual wield, but rejects shields and two-handers', () => {
    expect(maxArmorTypeForClass('swordmaster')).toBe('leather');
    expect(canEquipItem('swordmaster', ITEMS.greyjaw_hide_boots)).toBe(true);
    expect(canEquipItem('swordmaster', ITEMS.militia_vest)).toBe(false);
    expect(canEquipItem('swordmaster', ITEMS.eastbrook_buckler)).toBe(false);
    expect(canEquipItem('swordmaster', ITEMS.eastbrook_greatsword)).toBe(false);
    expect(canEquipItemInSlot('swordmaster', ITEMS.worn_sword, 'mainhand')).toBe(true);
    expect(canEquipItemInSlot('swordmaster', ITEMS.worn_sword, 'offhand')).toBe(true);
    expect(canEquipItemInSlot('swordmaster', ITEMS.eastbrook_greatsword, 'offhand')).toBe(false);
  });

  it('derives attack power from Strength plus Agility and uses the fast movement and GCD baselines', () => {
    const sim = new Sim({ seed: 72, playerClass: 'swordmaster' }) as unknown as RuleTestSim;

    expect(sim.player.attackPower).toBe(sim.player.stats.str + sim.player.stats.agi);
    expect(sim.moveSpeedMult(sim.player)).toBeCloseTo(1.08, 8);
    expect(sim.playerGcdFor('swordmaster')).toBe(1);
  });

  it('casts Fleet Step through the live ability lifecycle and composes with the class baseline', () => {
    const sim = new Sim({ seed: 73, playerClass: 'swordmaster' }) as unknown as RuleTestSim;
    sim.setPlayerLevel(3);

    sim.castAbility('fleet_step');

    expect(sim.player.auras).toContainEqual(
      expect.objectContaining({
        id: 'fleet_step',
        kind: 'buff_speed',
        value: 1.3,
        duration: 5,
        remaining: 5,
      }),
    );
    expect(sim.player.resource).toBe(90);
    expect(sim.player.cooldowns.get('fleet_step')).toBe(20);
    expect(sim.player.gcdRemaining).toBe(0);
    expect(sim.moveSpeedMult(sim.player)).toBeCloseTo(1.08 * 1.3, 8);
  });

  it('moves exactly 8% farther than the shared run baseline over fixed sim ticks', () => {
    const distanceFor = (playerClass: PlayerClass): number => {
      const sim = new Sim({ seed: 42, playerClass });
      sim.setPlayerLevel(20);
      for (const entity of sim.entities.values()) {
        if (entity.kind === 'mob') entity.dead = true;
      }
      const player = sim.player;
      player.pos = { x: 0, y: terrainHeight(0, -40, sim.cfg.seed), z: -40 };
      player.prevPos = { ...player.pos };
      player.facing = 0;
      player.prevFacing = 0;
      player.onGround = true;
      player.fallStartY = player.pos.y;
      sim.moveInput.forward = true;
      for (let tick = 0; tick < 20; tick++) sim.tick();
      return Math.hypot(player.pos.x, player.pos.z + 40);
    };

    const warriorDistance = distanceFor('warrior');
    const swordmasterDistance = distanceFor('swordmaster');
    expect(warriorDistance).toBeGreaterThan(6);
    expect(swordmasterDistance).toBeCloseTo(warriorDistance * 1.08, 6);
  });
});
