import { describe, expect, it } from 'vitest';
import { updateRegen } from '../src/sim/combat/auras';
import { runEffects } from '../src/sim/combat/effect_dispatch';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import type { PlayerMeta, ResolvedAbility } from '../src/sim/sim';
import { Sim } from '../src/sim/sim';
import type { AbilityEffect, Entity } from '../src/sim/types';

type TestSim = Sim & {
  nextId: number;
  addEntity(entity: Entity): void;
};

function harness(sim: Sim): TestSim {
  return sim as TestSim;
}

function warriorAtCap(seed = 2620): TestSim {
  const sim = harness(new Sim({ seed, playerClass: 'warrior', autoEquip: false }));
  sim.setPlayerLevel(20);
  return sim;
}

function metaOf(sim: Sim, pid = sim.player.id): PlayerMeta {
  const meta = sim.meta(pid);
  if (!meta) throw new Error(`missing player meta for ${pid}`);
  return meta;
}

function entityOf(sim: Sim, pid: number): Entity {
  const entity = sim.entities.get(pid);
  if (!entity) throw new Error(`missing entity for ${pid}`);
  return entity;
}

function spawnTarget(sim: TestSim, source: Entity, distance = 2): Entity {
  const target = createMob(sim.nextId++, MOBS.forest_wolf, 1, {
    x: source.pos.x,
    y: source.pos.y,
    z: source.pos.z + distance,
  });
  target.maxHp = 100_000;
  target.hp = target.maxHp;
  target.hostile = true;
  target.aiState = 'idle';
  sim.addEntity(target);
  source.facing = Math.atan2(target.pos.x - source.pos.x, target.pos.z - source.pos.z);
  sim.targetEntity(target.id, source.id);
  return target;
}

function effectOnly(
  sim: Sim,
  abilityId: string,
  effects: AbilityEffect[],
  def: Partial<ResolvedAbility['def']> = {},
): ResolvedAbility {
  const base = sim.resolvedAbility(abilityId);
  if (!base) throw new Error(`missing resolved ability ${abilityId}`);
  return { ...base, def: { ...base.def, ...def }, effects };
}

function killTarget(sim: TestSim, target: Entity): void {
  target.hp = 1;
  sim.dealDamage(sim.player, target, 5, false, 'physical', null, 'hit', true);
  expect(target.dead).toBe(true);
}

describe('v0.26 winning Warrior authored row and mastery runtime', () => {
  it('Master Armorer reads the live mainhand and increases all outgoing damage only with a two-hander', () => {
    const sim = warriorAtCap();
    expect(sim.setSpec('arms')).toBe(true);
    const player = sim.player;
    const meta = metaOf(sim);
    const target = spawnTarget(sim, player);

    const hit = (school: string) => {
      const hpBefore = target.hp;
      sim.dealDamage(player, target, 100, false, school, 'Test Ability', 'hit', true);
      return hpBefore - target.hp;
    };

    meta.equipment.mainhand = 'highwatch_greatsword';
    expect(hit('physical')).toBe(110);
    expect(hit('fire')).toBe(110);

    meta.equipment.mainhand = 'worn_sword';
    expect(hit('physical')).toBe(100);
    expect(hit('fire')).toBe(100);
  });

  it('Anger Management scales auto rage by 10 percent without drawing RNG', () => {
    const rageFromHit = (selected: boolean) => {
      const sim = warriorAtCap(2621);
      if (selected) expect(sim.selectTalentRow(14, 'war_row_anger_management')).toBe(true);
      const target = spawnTarget(sim, sim.player);
      sim.player.resource = 0;
      let draws = 0;
      sim.ctx.rng.setObserver(() => draws++);
      sim.dealDamage(sim.player, target, 40, false, 'physical', null, 'hit');
      sim.ctx.rng.setObserver(null);
      return { rage: sim.player.resource, draws };
    };

    const baseline = rageFromHit(false);
    const talented = rageFromHit(true);
    // v0.27.1 rage fix: trimmed from 25 percent.
    expect(talented.rage).toBeCloseTo(baseline.rage * 1.1);
    expect(baseline.draws).toBe(0);
    expect(talented.draws).toBe(0);
  });

  it('Anger Management scales gainResource, Charge, and rageOnHit by 5 percent without extra RNG', () => {
    const sim = warriorAtCap(2622);
    expect(sim.selectTalentRow(14, 'war_row_anger_management')).toBe(true);
    const player = sim.player;
    const meta = metaOf(sim);
    const target = spawnTarget(sim, player, 12);
    let draws = 0;
    sim.ctx.rng.setObserver(() => draws++);

    player.resource = 0;
    runEffects(
      sim.ctx,
      player,
      meta,
      null,
      effectOnly(sim, 'battle_shout', [{ type: 'gainResource', amount: 10 }]),
    );
    expect(player.resource).toBeCloseTo(10 * 1.05 * 1.1);
    expect(draws).toBe(0);

    player.resource = 0;
    runEffects(sim.ctx, player, meta, target, effectOnly(sim, 'charge', [{ type: 'charge' }]));
    expect(player.resource).toBeCloseTo(9 * 1.05 * 1.1);
    expect(draws).toBe(0);

    const aoeTarget = spawnTarget(sim, player, 0);
    player.resource = 0;
    runEffects(
      sim.ctx,
      player,
      meta,
      aoeTarget,
      effectOnly(sim, 'battle_shout', [
        {
          type: 'aoeDamage',
          min: 0,
          max: 0,
          radius: 0.1,
          rageOnHit: { base: 5, perTarget: 1, capTargets: 5 },
        },
      ]),
    );
    expect(player.resource).toBeCloseTo(6 * 1.05 * 1.1);
    expect(draws).toBe(1);
    sim.ctx.rng.setObserver(null);
  });

  it('Pursuit grants 30 percent movement speed for six seconds on a credited kill', () => {
    const sim = warriorAtCap(2623);
    expect(sim.selectTalentRow(5, 'war_row_pursuit')).toBe(true);
    killTarget(sim, spawnTarget(sim, sim.player));

    const pursuit = sim.player.auras.find((aura) => aura.id === 'pursuit');
    expect(pursuit).toMatchObject({
      name: 'Pursuit',
      kind: 'buff_speed',
      value: 1.3,
      remaining: 6,
      duration: 6,
    });
    expect(sim.moveSpeedMult(sim.player)).toBeCloseTo(1.3);
  });

  it('Second Wind restores 1.5 percent max health per second below 35 percent, including in combat', () => {
    const sim = warriorAtCap(2624);
    expect(sim.selectTalentRow(8, 'war_row_second_wind')).toBe(true);
    const player = sim.player;
    player.inCombat = true;
    player.hp = Math.floor(player.maxHp * 0.3);
    const lowHp = player.hp;

    updateRegen(sim.ctx, player, metaOf(sim));
    expect(player.hp).toBe(lowHp + Math.round(player.maxHp * 0.015 * 2));

    player.hp = Math.floor(player.maxHp * 0.45);
    const highHp = player.hp;
    updateRegen(sim.ctx, player, metaOf(sim));
    expect(player.hp).toBe(highHp);
  });

  it('Battle Rhythm empowers exactly every third ability for generated rage only', () => {
    const sim = warriorAtCap(2625);
    expect(sim.selectTalentRow(14, 'war_row_battle_rhythm')).toBe(true);
    const player = sim.player;
    const meta = metaOf(sim);
    const target = spawnTarget(sim, player);
    player.resource = 0;
    const emptyCast = effectOnly(sim, 'battle_shout', []);

    runEffects(sim.ctx, player, meta, null, emptyCast);
    runEffects(sim.ctx, player, meta, null, emptyCast);
    let draws = 0;
    sim.ctx.rng.setObserver(() => draws++);
    const rhythmStrike = effectOnly(sim, 'battle_shout', [{ type: 'gainResource', amount: 10 }], {
      id: 'test_battle_rhythm_strike',
      name: 'Test Battle Rhythm Strike',
    });
    runEffects(sim.ctx, player, meta, target, rhythmStrike);
    sim.ctx.rng.setObserver(null);

    const empoweredRage = player.resource;
    const empoweredDraws = draws;
    expect(player.auras).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'battle_rhythm_rage', kind: 'buff_rage_gen', value: 0.2 }),
      ]),
    );
    expect(player.auras.some((aura) => aura.id === 'battle_rhythm')).toBe(false);
    const hpBefore = target.hp;
    sim.dealDamage(player, target, 100, false, 'fire', 'Test Battle Rhythm Strike', 'hit', true);
    const empoweredDamage = hpBefore - target.hp;
    sim.tick();
    expect(player.auras.some((aura) => aura.id.startsWith('battle_rhythm'))).toBe(false);

    player.resource = 0;
    const fourthHpBefore = target.hp;
    let normalDraws = 0;
    sim.ctx.rng.setObserver(() => normalDraws++);
    runEffects(sim.ctx, player, meta, target, rhythmStrike);
    sim.ctx.rng.setObserver(null);
    sim.dealDamage(player, target, 100, false, 'fire', 'Test Battle Rhythm Strike', 'hit', true);
    const normalDamage = fourthHpBefore - target.hp;
    expect(empoweredDamage).toBe(normalDamage);
    expect(empoweredRage).toBeCloseTo(10 * 1.3);
    expect(player.resource).toBeCloseTo(10 * 1.1);
    expect(empoweredDraws).toBe(normalDraws);
  });

  it('Bloodbath stacks five percent crit and damage per kill for eight seconds, capped at 25 percent', () => {
    const sim = warriorAtCap(2626);
    expect(sim.selectTalentRow(17, 'war_row_bloodbath')).toBe(true);
    const player = sim.player;
    const baseCrit = player.critChance;

    for (let kill = 0; kill < 6; kill++) {
      const target = spawnTarget(sim, player);
      const existing = player.auras.find((aura) => aura.kind === 'bloodbath');
      if (existing) existing.remaining = 1;
      killTarget(sim, target);
    }

    const bloodbath = player.auras.find((aura) => aura.kind === 'bloodbath');
    expect(bloodbath).toMatchObject({
      id: 'bloodbath',
      name: 'Bloodbath',
      value: 0.25,
      stacks: 5,
      remaining: 8,
      duration: 8,
    });
    expect(player.critChance).toBeCloseTo(baseCrit + 0.25);

    const target = spawnTarget(sim, player);
    const hpBefore = target.hp;
    sim.dealDamage(player, target, 100, false, 'physical', 'Test Ability', 'hit', true);
    expect(hpBefore - target.hp).toBe(125);

    if (!bloodbath) throw new Error('missing Bloodbath aura');
    bloodbath.remaining = 0.01;
    sim.tick();
    expect(player.auras.some((aura) => aura.kind === 'bloodbath')).toBe(false);
    expect(player.critChance).toBeCloseTo(baseCrit);
  });

  it('Sanguine Aura buffs only the caster and melee party members with one composite aura', () => {
    const sim = harness(new Sim({ seed: 2627, playerClass: 'warrior', noPlayer: true }));
    const warrior = sim.addPlayer('warrior', 'Warrior');
    const paladin = sim.addPlayer('paladin', 'Paladin');
    const mage = sim.addPlayer('mage', 'Mage');
    for (const pid of [warrior, paladin, mage]) sim.setPlayerLevel(20, pid);
    sim.partyInvite(paladin, warrior);
    sim.partyAccept(paladin);
    sim.partyInvite(mage, warrior);
    sim.partyAccept(mage);
    const warriorEntity = entityOf(sim, warrior);
    const paladinEntity = entityOf(sim, paladin);
    const mageEntity = entityOf(sim, mage);
    paladinEntity.pos.x += 500;
    mageEntity.pos.x += 500;
    expect(sim.selectTalentRow(20, 'war_row_sanguine_aura', warrior)).toBe(true);

    sim.castAbility('sanguine_aura', warrior);

    for (const melee of [warriorEntity, paladinEntity]) {
      expect(melee.auras.filter((aura) => aura.kind === 'sanguine')).toEqual([
        expect.objectContaining({
          id: 'sanguine_aura',
          value: 1 / 1.1,
          value2: 0.1,
          remaining: 20,
          duration: 20,
        }),
      ]);
    }
    expect(mageEntity.auras.some((aura) => aura.kind === 'sanguine')).toBe(false);
    expect(sim.swingIntervalMult(warriorEntity)).toBeCloseTo(1 / 1.1);

    const target = spawnTarget(sim, warriorEntity);
    const hpBefore = target.hp;
    sim.dealDamage(warriorEntity, target, 100, false, 'physical', 'Test Ability', 'hit', true);
    expect(hpBefore - target.hp).toBe(110);
  });

  it('Sanguine Aura from a second Warrior refreshes one shared party buff', () => {
    const sim = harness(new Sim({ seed: 2628, playerClass: 'warrior', noPlayer: true }));
    const first = sim.addPlayer('warrior', 'First');
    const second = sim.addPlayer('warrior', 'Second');
    const recipient = sim.addPlayer('paladin', 'Recipient');
    for (const pid of [first, second, recipient]) sim.setPlayerLevel(20, pid);
    sim.partyInvite(second, first);
    sim.partyAccept(second);
    sim.partyInvite(recipient, first);
    sim.partyAccept(recipient);
    expect(sim.selectTalentRow(20, 'war_row_sanguine_aura', first)).toBe(true);
    expect(sim.selectTalentRow(20, 'war_row_sanguine_aura', second)).toBe(true);

    sim.castAbility('sanguine_aura', first);
    const recipientEntity = entityOf(sim, recipient);
    const firstAura = recipientEntity.auras.find((aura) => aura.id === 'sanguine_aura');
    expect(firstAura).toBeTruthy();
    if (firstAura) firstAura.remaining = 3;
    sim.castAbility('sanguine_aura', second);

    expect(recipientEntity.auras.filter((aura) => aura.id === 'sanguine_aura')).toEqual([
      expect.objectContaining({ sourceId: second, remaining: 20, duration: 20 }),
    ]);
  });

  it('Bladestorm follows the moving Warrior and uses the smaller 6 yard radius', () => {
    const sim = warriorAtCap(2629);
    expect(sim.selectTalentRow(20, 'war_row_bladestorm')).toBe(true);
    const player = sim.player;
    player.resource = player.maxResource;
    const spawnDummy = (x: number, z: number): Entity => {
      const dummy = createMob(sim.nextId++, MOBS.training_dummy, 20, {
        x,
        y: player.pos.y,
        z,
      });
      dummy.hostile = true;
      dummy.maxHp = dummy.hp = 100_000;
      sim.addEntity(dummy);
      return dummy;
    };
    const oldCenterTarget = spawnDummy(player.pos.x, player.pos.z + 5.5);
    const movedCenterTarget = spawnDummy(player.pos.x + 7, player.pos.z);
    const outsideRadius = spawnDummy(player.pos.x, player.pos.z + 6.5);
    const bladestorm = sim.resolvedAbility('bladestorm');
    expect(bladestorm?.effects).toEqual([
      expect.objectContaining({ type: 'aoeDamage', radius: 6 }),
    ]);

    sim.castAbility('bladestorm');
    for (let i = 0; i < 20; i++) sim.tick();
    expect(oldCenterTarget.hp).toBeLessThan(oldCenterTarget.maxHp);
    expect(movedCenterTarget.hp).toBe(movedCenterTarget.maxHp);
    expect(outsideRadius.hp).toBe(outsideRadius.maxHp);
    metaOf(sim).moveInput.strafeLeft = true;
    for (let i = 0; i < 40; i++) sim.tick();
    metaOf(sim).moveInput.strafeLeft = false;
    expect(player.pos.x).toBeGreaterThan(oldCenterTarget.pos.x + 6);
    expect(movedCenterTarget.hp).toBeLessThan(movedCenterTarget.maxHp);
  });
});
