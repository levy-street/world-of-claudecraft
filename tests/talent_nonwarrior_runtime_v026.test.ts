import { describe, expect, it } from 'vitest';
import { runEffects } from '../src/sim/combat/effect_dispatch';
import { onShamanCastCompleted } from '../src/sim/combat/shaman_talents';
import { thunderCharges, thundercallOnArcBoltImpact } from '../src/sim/combat/shaman_thundercall';
import { onCastCompleted } from '../src/sim/combat/talent_procs';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { type ResolvedAbility, Sim } from '../src/sim/sim';
import type { Aura, Entity, PlayerClass } from '../src/sim/types';
import { placePlayerInOpenField } from './helpers/open_field';

type TestSim = Sim & {
  nextId: number;
  addEntity(entity: Entity): void;
};

function harness(sim: Sim): TestSim {
  return sim as TestSim;
}

function simWithRows(cls: PlayerClass, rows: Record<number, string>): TestSim {
  const sim = harness(new Sim({ seed: 1756, playerClass: cls, autoEquip: false }));
  sim.setPlayerLevel(20);
  placePlayerInOpenField(sim);
  expect(sim.applyTalents({ spec: null, rows })).toBe(true);
  return sim;
}

function addTarget(sim: TestSim, distance = 3, hostile = true): Entity {
  const player = sim.player;
  const target = createMob(sim.nextId++, MOBS.forest_wolf, 20, {
    x: player.pos.x,
    y: player.pos.y,
    z: player.pos.z + distance,
  });
  target.hostile = hostile;
  target.moveSpeed = 0;
  target.maxHp = 100_000;
  target.hp = target.maxHp;
  sim.addEntity(target);
  player.facing = Math.atan2(target.pos.x - player.pos.x, target.pos.z - player.pos.z);
  sim.targetEntity(target.id);
  return target;
}

function resolved(sim: Sim, abilityId: string): ResolvedAbility {
  const ability = sim.resolvedAbility(abilityId);
  if (!ability) throw new Error(`missing resolved ability ${abilityId}`);
  return ability;
}

function runResolved(sim: Sim, target: Entity | null, ability: ResolvedAbility): void {
  const meta = sim.meta(sim.playerId);
  if (!meta) throw new Error('missing player metadata');
  runEffects(sim.ctx, sim.player, meta, target, ability);
}

function aura(
  id: string,
  kind: Aura['kind'],
  sourceId: number,
  school: Aura['school'],
  value = 1,
): Aura {
  return {
    id,
    name: id,
    kind,
    remaining: 30,
    duration: 30,
    value,
    sourceId,
    school,
  };
}

function settle(sim: Sim): void {
  for (let tick = 0; tick < 40; tick++) sim.tick();
}

describe('retained v0.26 non-Warrior row runtime contracts', () => {
  it('banks a second Sundering Gavel with Double Sentence', () => {
    const charges = simWithRows('paladin', { 11: 'pal_r11_double_sentence' });
    expect(resolved(charges, 'hammer_of_justice')).toMatchObject({
      charges: 2,
      bonusCharges: 1,
    });
  });

  it('restores energy on every third Wicked Slash with Ceaseless Cuts', () => {
    const sim = simWithRows('rogue', { 14: 'rog_r14_ceaseless_cuts' });
    const target = addTarget(sim);
    sim.player.resource = 0;

    onCastCompleted(sim.ctx, sim.player, 'sinister_strike', target);
    onCastCompleted(sim.ctx, sim.player, 'sinister_strike', target);
    expect(sim.player.resource).toBe(0);
    onCastCompleted(sim.ctx, sim.player, 'sinister_strike', target);

    expect(sim.player.resource).toBe(50);
  });

  it('Borrowed Tempo makes Cutthroat Tempo free without spending banked combo points (issue #2426)', () => {
    // The v0.29 rogue rework retired rog_r11_improved_slice_and_dice (Borrowed
    // Tempo's arming talent), so the empowerment is applied directly: the pin
    // is the DISPATCH contract (a next_cast_free cast banks its combo points),
    // not the arming vehicle.
    const sim = simWithRows('rogue', {});
    addTarget(sim);
    sim.player.resource = sim.player.maxResource;
    sim.player.comboPoints = 5;

    sim.player.auras.push({
      id: 'rog_borrowed_tempo',
      name: 'Borrowed Tempo',
      kind: 'next_cast_free',
      remaining: 8,
      duration: 8,
      value: 0,
      sourceId: sim.player.id,
      school: 'physical',
      empowerAbilities: ['slice_and_dice'],
    });
    expect(sim.player.auras.some((a) => a.kind === 'next_cast_free')).toBe(true);

    const resourceBefore = sim.player.resource;
    const comboBefore = sim.player.comboPoints;
    sim.castAbility('slice_and_dice');

    expect(sim.player.resource).toBe(resourceBefore); // the whole cast was free: no energy spent
    expect(sim.player.comboPoints).toBe(comboBefore); // combo points banked, not consumed
    // the finisher still applied its buff, scaled off the banked combo points
    // (v0.29 rogue rework tuning: 12 sec base plus 4 sec per combo point)
    const haste = sim.player.auras.find((a) => a.kind === 'buff_haste');
    expect(haste?.duration).toBeCloseTo(12 + 4 * comboBefore, 5);
  });

  it('a normal (non-empowered) Cutthroat Tempo still spends its combo points', () => {
    const sim = simWithRows('rogue', {});
    addTarget(sim);
    sim.player.resource = sim.player.maxResource;
    sim.player.comboPoints = 5;

    sim.castAbility('slice_and_dice');

    expect(sim.player.comboPoints).toBe(0);
    expect(sim.player.resource).toBeLessThan(sim.player.maxResource);
  });

  it('adds one talent charge for Twin Icebind', () => {
    // The mage rework replaced Twin Embers (mag_r5_impulse, fire_blast) with
    // Twin Icebind (mag_r11_twin_nova, frost_nova) as the charge-model row.
    const mage = simWithRows('mage', { 11: 'mag_r11_twin_nova' });

    expect(resolved(mage, 'frost_nova')).toMatchObject({ charges: 2, bonusCharges: 1 });
  });

  it('arms Flowing Elements only after a Jolt', () => {
    const sim = simWithRows('shaman', { 5: 'sha_r5_imbue_mastery' });
    onShamanCastCompleted(sim.ctx, sim.player, 'lightning_bolt');
    expect(sim.player.auras.some((candidate) => candidate.id === 'shaman_flowing_elements')).toBe(
      false,
    );
    onShamanCastCompleted(sim.ctx, sim.player, 'earth_shock');
    expect(
      sim.player.auras.find((candidate) => candidate.id === 'shaman_flowing_elements'),
    ).toMatchObject({
      kind: 'ice_floes',
      duration: 8,
      empowerAbilities: ['lightning_bolt', 'healing_wave'],
    });
  });

  it('leaves Consume unchanged when Deep Hunger empowers Soulwell', () => {
    const sim = simWithRows('warlock', { 11: 'wlk_r11_demon_armor' });
    expect(resolved(sim, 'drain_life').damagePushbackImmune).toBeFalsy();
    expect(resolved(sim, 'drain_life').castWhileMoving).toBeFalsy();
  });

  it('Blood Credit pays 50% more mana per tap and arms nothing', () => {
    const sim = simWithRows('warlock', { 14: 'wlk_r14_ruin' });
    sim.player.hp = 1;
    sim.player.resource = 0;

    sim.castAbility('life_tap');

    expect(sim.player.hp).toBe(1);
    expect(sim.player.resource).toBe(0);
    expect(sim.player.gcdRemaining).toBe(0);

    sim.player.hp = 100;
    sim.castAbility('life_tap');
    expect(sim.player.hp).toBe(15);
    expect(sim.player.resource).toBe(128);
    expect(sim.player.auras.some((entry) => entry.id === 'wlk_blood_credit')).toBe(false);
  });

  it('casts Typhoon in caster form and Red Haze after shifting', () => {
    const sim = simWithRows('druid', {
      11: 'dru_r11_innervate',
      17: 'dru_r17_improved_barkskin',
    });
    const target = addTarget(sim);
    const distanceBefore = Math.hypot(
      target.pos.x - sim.player.pos.x,
      target.pos.z - sim.player.pos.z,
    );
    sim.player.resource = sim.player.maxResource;

    sim.castAbility('typhoon');

    expect(
      Math.hypot(target.pos.x - sim.player.pos.x, target.pos.z - sim.player.pos.z),
    ).toBeGreaterThan(distanceBefore);
    expect(target.auras).toContainEqual(
      expect.objectContaining({ kind: 'slow', value: 0.5, remaining: 4 }),
    );

    settle(sim);
    sim.player.resource = sim.player.maxResource;
    sim.castAbility('cat_form');
    settle(sim);
    expect(sim.player.auras.some((entry) => entry.kind === 'form_cat')).toBe(true);
    sim.castAbility('berserk');
    expect(sim.player.auras).toContainEqual(
      expect.objectContaining({ id: 'berserk', kind: 'buff_ap', value: 70 }),
    );
  });

  it('adds an extra Pyrebrand charge every third Arc Bolt with Imbue Mastery', () => {
    const sim = simWithRows('shaman', { 14: 'sha_r14_improved_flame_shock' });
    expect(
      sim.applyTalents({ spec: 'elemental', rows: { 14: 'sha_r14_improved_flame_shock' } }),
    ).toBe(true);
    sim.player.auras.push(aura('flametongue_weapon', 'imbue', sim.playerId, 'fire'));
    thundercallOnArcBoltImpact(sim.ctx, sim.player);
    thundercallOnArcBoltImpact(sim.ctx, sim.player);
    thundercallOnArcBoltImpact(sim.ctx, sim.player);
    expect(thunderCharges(sim.player)).toBe(4);
    expect(
      resolved(sim, 'earth_shock').effects.some((effect) => effect.type === 'consumeDot'),
    ).toBe(false);
  });
});
