import { describe, expect, it } from 'vitest';
import { handleDeath } from '../src/sim/combat/damage';
import {
  druidEngineCombatState,
  druidEngineOnHotPlanted,
  druidEngineOnLandedStrike,
  MOONTIDE_ID,
  OLD_BLOOD_ID,
  VERDANCE_ID,
} from '../src/sim/combat/druid_engines';
import { onCastCompleted } from '../src/sim/combat/talent_procs';
import { MOBS } from '../src/sim/data';
import { createMob, recalcPlayerStats } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { Aura, Entity } from '../src/sim/types';

function rig(spec: 'balance' | 'feral' | 'restoration', rows: Record<number, string> = {}) {
  const sim = new Sim({ seed: 29, playerClass: 'druid', autoEquip: true });
  sim.setPlayerLevel(20);
  expect(sim.applyTalents({ spec, rows })).toBe(true);
  sim.player.resource = sim.player.maxResource;
  return { sim, player: sim.player };
}

function ctx(sim: Sim): Parameters<typeof onCastCompleted>[0] {
  return (sim as unknown as { ctx: Parameters<typeof onCastCompleted>[0] }).ctx;
}

function completed(sim: Sim, abilityId: string, target: Entity | null = null): void {
  onCastCompleted(ctx(sim), sim.player, abilityId, target);
}

function stacks(player: Entity, id: string): number {
  return player.auras.find((aura) => aura.id === id)?.stacks ?? 0;
}

function formAura(player: Entity, kind: Aura['kind']): Aura {
  return {
    id: kind,
    name: kind,
    kind,
    remaining: 3600,
    duration: 3600,
    value: 0,
    sourceId: player.id,
    school: 'nature',
  };
}

function targetMob(sim: Sim): Entity {
  const player = sim.player;
  const mob = createMob(9820, MOBS.forest_wolf, 20, {
    x: player.pos.x,
    y: player.pos.y,
    z: player.pos.z + 2,
  });
  mob.hostile = true;
  mob.maxHp = mob.hp = 1_000_000;
  (sim as unknown as { addEntity(entity: Entity): void }).addEntity(mob);
  sim.targetEntity(mob.id);
  player.facing = 0;
  return mob;
}

describe('Moongrove engine', () => {
  it('keeps Moonseed and its engine effects inside Moonwing', () => {
    const { sim, player } = rig('balance');
    const mob = targetMob(sim);
    mob.level = 1;
    mob.auras.push({
      id: 'moonfire',
      name: 'Lunar Tempest',
      kind: 'dot',
      remaining: 6,
      duration: 12,
      value: 10,
      tickInterval: 3,
      tickTimer: 3,
      sourceId: player.id,
      school: 'arcane',
      extendedBy: 0,
    });
    const hpBefore = mob.hp;

    sim.castAbility('moonseed');

    expect(mob.hp).toBe(hpBefore);
    expect(mob.auras.find((aura) => aura.id === 'moonfire')?.remaining).toBe(6);
    expect(stacks(player, MOONTIDE_ID)).toBe(0);
    expect(player.cooldowns.has('moonseed')).toBe(false);

    player.auras.push(formAura(player, 'form_moonkin'));
    player.resource = player.maxResource;
    sim.castAbility('moonseed');
    for (let tick = 0; tick < 20; tick++) sim.tick();

    expect(player.cooldowns.has('moonseed')).toBe(true);
    expect(mob.auras.find((aura) => aura.id === 'moonfire')?.remaining).toBeGreaterThan(6);
    expect(mob.auras.find((aura) => aura.id === 'moonfire')?.extendedBy).toBe(6);
    expect(stacks(player, MOONTIDE_ID)).toBe(1);
  });

  it('arms both payoff choices at full Moontide and either press spends the bank', () => {
    const { sim, player } = rig('balance');

    completed(sim, 'wrath');
    expect(stacks(player, MOONTIDE_ID)).toBe(0);

    player.auras.push(formAura(player, 'form_moonkin'));
    completed(sim, 'wrath');
    completed(sim, 'starfire');
    completed(sim, 'moonseed');
    expect(stacks(player, MOONTIDE_ID)).toBe(3);
    expect(sim.resolvedAbility('moonseed')?.def.id).toBe('moonlash');
    expect(sim.resolvedAbility('starfire')?.def.id).toBe('sunlance');
    expect(sim.resolvedAbility('wrath')?.def.id).toBe('wrath');

    completed(sim, 'moonlash');
    expect(stacks(player, MOONTIDE_ID)).toBe(0);
    expect(sim.resolvedAbility('moonseed')?.def.id).toBe('moonseed');
    expect(sim.resolvedAbility('starfire')?.def.id).toBe('starfire');

    completed(sim, 'wrath');
    completed(sim, 'wrath');
    completed(sim, 'wrath');
    completed(sim, 'sunlance');
    expect(stacks(player, MOONTIDE_ID)).toBe(0);
    expect(sim.resolvedAbility('moonseed')?.def.id).toBe('moonseed');
    expect(sim.resolvedAbility('starfire')?.def.id).toBe('starfire');
  });

  it('freezes the bank outside Moonwing and disarms both payoffs', () => {
    const { sim, player } = rig('balance');
    const mob = targetMob(sim);
    player.auras.push(formAura(player, 'form_moonkin'));
    completed(sim, 'wrath');
    completed(sim, 'wrath');
    completed(sim, 'wrath');
    expect(sim.resolvedAbility('starfire')?.def.id).toBe('sunlance');

    player.auras = player.auras.filter((aura) => aura.kind !== 'form_moonkin');
    expect(stacks(player, MOONTIDE_ID)).toBe(3);
    expect(sim.resolvedAbility('moonseed')?.def.id).toBe('moonseed');
    expect(sim.resolvedAbility('starfire')?.def.id).toBe('starfire');

    // A base Skyfall hard-cast out of form is a plain nuke: it must not
    // touch the frozen bank.
    player.resource = player.maxResource;
    player.gcdRemaining = 0;
    sim.castAbility('starfire');
    for (let tick = 0; tick < 80; tick++) sim.tick();
    expect(mob.hp).toBeLessThan(mob.maxHp);
    expect(stacks(player, MOONTIDE_ID)).toBe(3);

    player.auras.push(formAura(player, 'form_moonkin'));
    expect(sim.resolvedAbility('moonseed')?.def.id).toBe('moonlash');
    expect(sim.resolvedAbility('starfire')?.def.id).toBe('sunlance');
  });

  it('fires Moonsurge through the Moonseed cooldown and spends the bank once', () => {
    const { sim, player } = rig('balance');
    const mob = targetMob(sim);
    player.auras.push(formAura(player, 'form_moonkin'));
    completed(sim, 'wrath');
    completed(sim, 'wrath');
    completed(sim, 'wrath');
    player.cooldowns.set('moonseed', 5);
    expect(sim.resolvedAbility('moonseed')?.def.id).toBe('moonlash');

    player.resource = player.maxResource;
    player.gcdRemaining = 0;
    sim.castAbility('moonseed');
    for (let tick = 0; tick < 5; tick++) sim.tick();

    expect(mob.hp).toBeLessThan(mob.maxHp);
    expect(stacks(player, MOONTIDE_ID)).toBe(0);
    expect(player.cooldowns.get('moonseed')).toBeGreaterThan(0);
    // With the bank spent, the button is Moonseed again and still recharging.
    expect(sim.resolvedAbility('moonseed')?.def.id).toBe('moonseed');
  });

  it('amplifies the full Sunwake burn through Wild Apex', () => {
    const baseline = rig('balance');
    const apex = rig('balance', { 20: 'dru_r20_berserk' });
    const baselineTarget = targetMob(baseline.sim);
    const apexTarget = targetMob(apex.sim);

    for (const { sim, player, target } of [
      { ...baseline, target: baselineTarget },
      { ...apex, target: apexTarget },
    ]) {
      player.auras.push(formAura(player, 'form_moonkin'));
      completed(sim, 'wrath');
      completed(sim, 'wrath');
      completed(sim, 'wrath');
      expect(sim.resolvedAbility('starfire')?.def.id).toBe('sunlance');
      const direct = sim
        .resolvedAbility('starfire')
        ?.effects.find((effect) => effect.type === 'directDamage');
      expect(direct).toMatchObject({ type: 'directDamage' });
      if (direct?.type !== 'directDamage') throw new Error('missing Sunlance damage');
      // Sunwake resolves to its rebalanced Nature strike (base 80-100, lifted by
      // the Balance spell-damage passive to ~98-123); the v0.29 pass moved its
      // ceiling down and onto a spell-power rider so a caster scales with gear.
      expect(direct.min).toBeGreaterThan(90);
      expect(direct.max).toBeGreaterThan(110);
      player.resource = player.maxResource;
      player.gcdRemaining = 0;
      sim.castAbility('starfire');
      for (let tick = 0; tick < 20; tick++) sim.tick();
      expect(target.auras.some((aura) => aura.id === 'sunlance')).toBe(true);
    }

    const baselineBurn = baselineTarget.auras.find((aura) => aura.id === 'sunlance')?.value;
    const apexBurn = apexTarget.auras.find((aura) => aura.id === 'sunlance')?.value;
    expect(baselineBurn).toBeGreaterThan(0);
    expect(apexBurn).toBeGreaterThanOrEqual(Math.floor((baselineBurn ?? 0) * 1.25));
    expect(apexBurn).toBeLessThanOrEqual(Math.ceil((baselineBurn ?? 0) * 1.25));
  });
});

describe('Wildfang engine', () => {
  it('preserves the original Wolf Form attack-power formula', () => {
    const { sim, player } = rig('feral');
    const meta = sim.meta(player.id);
    expect(meta).toBeDefined();
    if (!meta) throw new Error('missing Druid metadata');
    const casterAttackPower = player.attackPower;
    player.auras.push(formAura(player, 'form_cat'));
    recalcPlayerStats(player, meta.cls, meta.equipment, meta.talentMods, meta.equipmentInstance);

    expect(player.attackPower - casterAttackPower).toBe(8 + player.level * 2);
  });

  it('shares three landed stages across forms, spends through the live button, and clears after combat', () => {
    const { sim, player } = rig('feral');
    const mob = targetMob(sim);
    const engineCtx = ctx(sim);

    druidEngineOnLandedStrike(engineCtx, player, 'claw');
    druidEngineOnLandedStrike(engineCtx, player, 'rake');
    player.auras.push(formAura(player, 'form_cat'));
    druidEngineOnLandedStrike(engineCtx, player, 'maul');
    expect(stacks(player, OLD_BLOOD_ID)).toBe(3);
    expect(sim.resolvedAbility('ferocious_bite')?.def.id).toBe('redharvest');

    // Redharvest never requires combo points: at 0 the bank is the payment
    // and the base bite still lands (the post-Bloodrift press).
    player.comboPoints = 0;
    player.resource = player.maxResource;
    sim.castAbility('ferocious_bite');
    expect(mob.hp).toBeLessThan(mob.maxHp);
    expect(player.auras.some((aura) => aura.id === OLD_BLOOD_ID)).toBe(false);

    druidEngineOnLandedStrike(engineCtx, player, 'swipe');
    expect(stacks(player, OLD_BLOOD_ID)).toBe(1);
    player.inCombat = false;
    druidEngineCombatState(engineCtx, player);
    expect(player.auras.some((aura) => aura.id === OLD_BLOOD_ID)).toBe(false);
  });

  it('resolves offensive Marrowbreak through the Bruin button with mastery and snap threat', () => {
    const { sim, player } = rig('feral');
    const mob = targetMob(sim);
    player.auras.push(formAura(player, 'form_bear'));
    player.hp = Math.round(player.maxHp * 0.75);
    player.resourceType = 'rage';
    player.resource = 100;
    druidEngineOnLandedStrike(ctx(sim), player, 'claw');
    druidEngineOnLandedStrike(ctx(sim), player, 'rake');
    druidEngineOnLandedStrike(ctx(sim), player, 'swipe');

    const replacement = sim.resolvedAbility('maul');
    expect(replacement?.def.id).toBe('marrowbreak');
    expect(replacement?.effects.find((effect) => effect.type === 'directDamage')).toMatchObject({
      min: Math.round(78 * 1.5),
      max: Math.round(96 * 1.5),
    });
    sim.castAbility('maul');

    expect(mob.hp).toBeLessThan(mob.maxHp);
    expect(mob.threat.get(player.id)).toBeGreaterThan(110);
    expect(player.auras.some((aura) => aura.id === 'marrowbreak_guard')).toBe(false);
    expect(player.auras.some((aura) => aura.id === OLD_BLOOD_ID)).toBe(false);
  });

  it('converts Marrowbreak into an absorb and rage refund below half health', () => {
    const { sim, player } = rig('feral');
    const mob = targetMob(sim);
    player.auras.push(formAura(player, 'form_bear'));
    player.hp = Math.round(player.maxHp * 0.4);
    player.resourceType = 'rage';
    player.resource = 20;
    druidEngineOnLandedStrike(ctx(sim), player, 'claw');
    druidEngineOnLandedStrike(ctx(sim), player, 'rake');
    druidEngineOnLandedStrike(ctx(sim), player, 'swipe');

    sim.castAbility('maul');

    expect(mob.hp).toBe(mob.maxHp);
    expect(mob.threat.get(player.id)).toBeUndefined();
    expect(player.auras.find((aura) => aura.id === 'marrowbreak_guard')).toMatchObject({
      kind: 'absorb',
      value: Math.round(player.maxHp * 0.18),
    });
    expect(player.resource).toBe(20);
    expect(player.auras.some((aura) => aura.id === OLD_BLOOD_ID)).toBe(false);
  });

  it('clears Old Blood through the authoritative tick and on specialization change', () => {
    const { sim, player } = rig('feral');
    druidEngineOnLandedStrike(ctx(sim), player, 'claw');
    expect(stacks(player, OLD_BLOOD_ID)).toBe(1);
    player.inCombat = false;
    player.combatTimer = 99;
    sim.tick();
    expect(player.auras.some((aura) => aura.id === OLD_BLOOD_ID)).toBe(false);

    druidEngineOnLandedStrike(ctx(sim), player, 'claw');
    expect(sim.applyTalents({ spec: 'balance', rows: {} })).toBe(true);
    expect(player.auras.some((aura) => aura.id === OLD_BLOOD_ID)).toBe(false);
  });

  it('clears engine banks on death and does not persist them through logout', () => {
    const { sim, player } = rig('feral');
    druidEngineOnLandedStrike(ctx(sim), player, 'claw');
    expect(stacks(player, OLD_BLOOD_ID)).toBe(1);

    handleDeath(ctx(sim), player, null);
    expect(player.auras.some((aura) => aura.id === OLD_BLOOD_ID)).toBe(false);

    const state = sim.serializeCharacter(player.id);
    expect(state).not.toBeNull();
    const restored = new Sim({ seed: 30, playerClass: 'warrior', noPlayer: true });
    const restoredId = restored.addPlayer('druid', 'Returning', { state: state ?? undefined });
    expect(restored.entities.get(restoredId)?.auras.some((aura) => aura.id === OLD_BLOOD_ID)).toBe(
      false,
    );

    // Verdance rides the same death path.
    const resto = rig('restoration');
    druidEngineOnHotPlanted(ctx(resto.sim), resto.player, 'rejuvenation');
    expect(stacks(resto.player, VERDANCE_ID)).toBe(1);
    handleDeath(ctx(resto.sim), resto.player, null);
    expect(resto.player.auras.some((aura) => aura.id === VERDANCE_ID)).toBe(false);

    // Logout WITHOUT dying: a living druid's serialized character still
    // carries no engine bank (the death clear above must not be what saves us).
    const alive = rig('balance');
    alive.player.auras.push(formAura(alive.player, 'form_moonkin'));
    completed(alive.sim, 'wrath');
    expect(stacks(alive.player, MOONTIDE_ID)).toBe(1);
    const aliveState = alive.sim.serializeCharacter(alive.player.id);
    expect(aliveState).not.toBeNull();
    const relogged = new Sim({ seed: 31, playerClass: 'warrior', noPlayer: true });
    const reloggedId = relogged.addPlayer('druid', 'Relogged', {
      state: aliveState ?? undefined,
    });
    const reloggedPlayer = relogged.entities.get(reloggedId);
    expect(reloggedPlayer?.auras.some((aura) => aura.id === MOONTIDE_ID)).toBe(false);
    expect(reloggedPlayer?.auras.some((aura) => aura.id === VERDANCE_ID)).toBe(false);
  });
});

describe('Groveheart engine', () => {
  it('counts planted HoTs and Overbloom harvests then replants Wildbloom', () => {
    const { sim, player } = rig('restoration');
    for (let cast = 0; cast < 5; cast++) {
      druidEngineOnHotPlanted(ctx(sim), player, cast % 2 ? 'regrowth' : 'rejuvenation');
    }
    expect(stacks(player, VERDANCE_ID)).toBe(5);
    expect(sim.resolvedAbility('swiftmend')?.def.id).toBe('overbloom');

    player.hp = Math.round(player.maxHp * 0.25);
    player.auras.push({
      id: 'regrowth',
      name: 'Second Bloom',
      kind: 'hot',
      remaining: 12,
      duration: 21,
      value: 25,
      tickInterval: 3,
      tickTimer: 3,
      sourceId: player.id,
      school: 'nature',
    });
    sim.castAbility('swiftmend');

    expect(player.hp).toBeGreaterThan(Math.round(player.maxHp * 0.25));
    expect(player.auras.some((aura) => aura.id === 'regrowth')).toBe(false);
    expect(player.auras.some((aura) => aura.id === 'rejuvenation')).toBe(true);
    expect(player.auras.some((aura) => aura.id === VERDANCE_ID)).toBe(false);
  });

  it('does not grow Verdance when Wildbloom refreshes an existing owned HoT', () => {
    const { sim, player } = rig('restoration');
    sim.castAbility('rejuvenation');
    expect(stacks(player, VERDANCE_ID)).toBe(1);

    player.gcdRemaining = 0;
    player.resource = player.maxResource;
    sim.castAbility('rejuvenation');

    expect(stacks(player, VERDANCE_ID)).toBe(1);
  });

  it('runs Swiftmend and Overbloom on one shared slot cooldown', () => {
    const { sim, player } = rig('restoration');
    const selfHot = (): Aura => ({
      id: 'rejuvenation',
      name: 'Wildbloom',
      kind: 'hot',
      remaining: 12,
      duration: 15,
      value: 20,
      tickInterval: 3,
      tickTimer: 3,
      sourceId: player.id,
      school: 'nature',
    });

    player.hp = Math.round(player.maxHp * 0.4);
    player.auras.push(selfHot());
    sim.castAbility('swiftmend');
    expect(player.auras.some((aura) => aura.id === 'rejuvenation')).toBe(false);
    expect(player.cooldowns.has('swiftmend')).toBe(true);

    for (let cast = 0; cast < 5; cast++) {
      druidEngineOnHotPlanted(ctx(sim), player, cast % 2 ? 'regrowth' : 'rejuvenation');
    }
    player.auras.push(selfHot());
    expect(sim.resolvedAbility('swiftmend')?.def.id).toBe('overbloom');

    // The base press armed the slot clock, so the transformed press waits on it.
    player.gcdRemaining = 0;
    player.resource = player.maxResource;
    const hpBeforeRefused = player.hp;
    sim.castAbility('swiftmend');
    expect(player.hp).toBe(hpBeforeRefused);
    expect(stacks(player, VERDANCE_ID)).toBe(5);
    expect(player.auras.some((aura) => aura.id === 'rejuvenation')).toBe(true);

    // Past the clock the harvest fires and re-arms the SAME slot clock, so the
    // base button cannot immediately eat the fresh replant.
    player.cooldowns.delete('swiftmend');
    player.gcdRemaining = 0;
    player.resource = player.maxResource;
    player.hp = Math.round(player.maxHp * 0.4);
    sim.castAbility('swiftmend');
    expect(player.auras.some((aura) => aura.id === VERDANCE_ID)).toBe(false);
    expect(player.auras.some((aura) => aura.id === 'rejuvenation')).toBe(true);
    expect(player.cooldowns.has('swiftmend')).toBe(true);

    player.gcdRemaining = 0;
    player.resource = player.maxResource;
    const replantCount = player.auras.filter((aura) => aura.id === 'rejuvenation').length;
    const hpAfterHarvest = player.hp;
    sim.castAbility('swiftmend');
    expect(player.auras.filter((aura) => aura.id === 'rejuvenation')).toHaveLength(replantCount);
    expect(player.hp).toBe(hpAfterHarvest);
  });

  it('clears the bank on a same-spec row repick', () => {
    const { sim, player } = rig('restoration');
    druidEngineOnHotPlanted(ctx(sim), player, 'rejuvenation');
    expect(stacks(player, VERDANCE_ID)).toBe(1);

    expect(
      sim.applyTalents({
        spec: 'restoration',
        rows: { 5: 'dru_r5_improved_wrath' },
      }),
    ).toBe(true);
    expect(player.auras.some((aura) => aura.id === VERDANCE_ID)).toBe(false);
  });
});
