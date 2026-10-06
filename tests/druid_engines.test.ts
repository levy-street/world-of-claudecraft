import { describe, expect, it } from 'vitest';
import { isRooted } from '../src/sim/combat/cc';
import { handleDeath } from '../src/sim/combat/damage';
import {
  druidEngineCombatState,
  druidEngineOnHotPlanted,
  druidEngineOnLandedStrike,
  LOPING_STRIDE_SPEED,
  MOONTIDE_ID,
  OLD_BLOOD_ID,
  VERDANCE_ID,
  VERDANCE_STAGES,
  VERDANCE_WILDMEND_CAST_TIMES,
  verdanceWildmendCastTime,
  WILDMEND_ID,
} from '../src/sim/combat/druid_engines';
import { runEffects } from '../src/sim/combat/effect_dispatch';
import { spellHasteMult } from '../src/sim/combat/spell_combat';
import { onCastCompleted } from '../src/sim/combat/talent_procs';
import { ABILITIES, MOBS } from '../src/sim/data';
import { createMob, recalcPlayerStats } from '../src/sim/entity';
import { moveSpeedMult } from '../src/sim/player_motion';
import { Sim } from '../src/sim/sim';
import { directHealBonus } from '../src/sim/spell_scaling';
import type { Aura, Entity } from '../src/sim/types';
import { abilityDamageBonus } from '../src/ui/ability_damage';

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
  it('applies Wildfang AP tuning to the Cat Form bonus', () => {
    const { sim, player } = rig('feral');
    const meta = sim.meta(player.id);
    expect(meta).toBeDefined();
    if (!meta) throw new Error('missing Druid metadata');
    // Remove only the new AP factor to recover the unrounded caster base.
    const baselineMods = { ...meta.talentMods, stats: { ...meta.talentMods.stats, apPct: 0 } };
    recalcPlayerStats(player, meta.cls, meta.equipment, baselineMods, meta.equipmentInstance);
    const casterAttackPower = player.attackPower;
    player.auras.push(formAura(player, 'form_cat'));
    recalcPlayerStats(player, meta.cls, meta.equipment, meta.talentMods, meta.equipmentInstance);

    expect(player.attackPower).toBe(Math.round((casterAttackPower + 8 + player.level * 2) * 1.1));
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

  it('casts rank 1 Redharvest through the transformed button at level 8', () => {
    // Redharvest now ranks 1/2/3 at levels 5/10/16 and Gorebite learns at 8,
    // so a level-8 feral is the first with the transforming button. The
    // transform resolves the actor-level rank: rank 1 bites for 35 plus 20 per
    // combo and refunds 15, so the cast nets minus 20 energy (35 cost, 15 back).
    const sim = new Sim({ seed: 29, playerClass: 'druid', autoEquip: true });
    sim.setPlayerLevel(8);
    expect(sim.applyTalents({ spec: 'feral', rows: {} })).toBe(true);
    const player = sim.player;
    const mob = targetMob(sim);
    const engineCtx = ctx(sim);
    player.auras.push(formAura(player, 'form_cat'));
    druidEngineOnLandedStrike(engineCtx, player, 'claw');
    druidEngineOnLandedStrike(engineCtx, player, 'rake');
    druidEngineOnLandedStrike(engineCtx, player, 'claw');
    expect(stacks(player, OLD_BLOOD_ID)).toBe(3);
    const resolvedRank = sim.resolvedAbility('ferocious_bite');
    expect(resolvedRank?.def.id).toBe('redharvest');
    expect(resolvedRank?.rank).toBe(1);

    player.comboPoints = 0;
    player.resource = 50;
    sim.castAbility('ferocious_bite');
    expect(mob.hp).toBeLessThan(mob.maxHp);
    expect(player.resource).toBe(30);
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
      min: Math.round(78 * 1.65),
      max: Math.round(96 * 1.65),
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
    expect(VERDANCE_STAGES).toBe(3);
    for (let cast = 0; cast < 5; cast++) {
      druidEngineOnHotPlanted(ctx(sim), player, cast % 2 ? 'regrowth' : 'rejuvenation');
      // Fleetmend arms only at the cap, never a plant earlier.
      expect(sim.resolvedAbility('swiftmend')?.def.id).toBe(
        cast + 1 >= VERDANCE_STAGES ? 'overbloom' : 'swiftmend',
      );
    }
    expect(stacks(player, VERDANCE_ID)).toBe(3);
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

  it('grows Verdance when Wildbloom refreshes an existing owned HoT', () => {
    const { sim, player } = rig('restoration');
    sim.castAbility('rejuvenation');
    expect(stacks(player, VERDANCE_ID)).toBe(1);
    expect(player.auras.filter((aura) => aura.id === 'rejuvenation')).toHaveLength(1);

    // The second press refreshes the bloom still ticking on the same target
    // (still one aura), and the refresh banks Verdance like a fresh plant.
    player.gcdRemaining = 0;
    player.resource = player.maxResource;
    sim.castAbility('rejuvenation');
    expect(player.auras.filter((aura) => aura.id === 'rejuvenation')).toHaveLength(1);
    expect(stacks(player, VERDANCE_ID)).toBe(2);

    player.gcdRemaining = 0;
    player.resource = player.maxResource;
    sim.castAbility('rejuvenation');
    expect(stacks(player, VERDANCE_ID)).toBe(3);
    expect(sim.resolvedAbility('swiftmend')?.def.id).toBe('overbloom');

    // Capped: a fourth refresh holds at 3.
    player.gcdRemaining = 0;
    player.resource = player.maxResource;
    sim.castAbility('rejuvenation');
    expect(stacks(player, VERDANCE_ID)).toBe(3);
  });

  it('banks 1 Verdance per completed Wildmend, Groveheart only', () => {
    const resto = rig('restoration');
    for (let cast = 1; cast <= 4; cast++) {
      completed(resto.sim, WILDMEND_ID, resto.player);
      expect(stacks(resto.player, VERDANCE_ID)).toBe(Math.min(cast, VERDANCE_STAGES));
    }
    expect(resto.sim.resolvedAbility('swiftmend')?.def.id).toBe('overbloom');

    // Moongrove and Wildfang druids carry no Verdance engine.
    for (const spec of ['balance', 'feral'] as const) {
      const other = rig(spec);
      completed(other.sim, WILDMEND_ID, other.player);
      expect(other.player.auras.some((aura) => aura.id === VERDANCE_ID)).toBe(false);
    }
  });

  it('speeds Wildmend to 2.2, 1.9, then 1.5 sec as Verdance banks, on the real cast bar', () => {
    const { sim, player } = rig('restoration');
    expect(VERDANCE_WILDMEND_CAST_TIMES).toEqual([2.2, 1.9, 1.5]);
    // The Groveheart Wildmend with no Verdance: the 3.0 sec rank cast less
    // the spec baseline's 16%.
    const baseCast = sim.resolvedAbility(WILDMEND_ID)?.castTime ?? 0;
    expect(baseCast).toBeCloseTo(2.52, 10);

    const seen: number[] = [];
    for (let cast = 0; cast <= VERDANCE_STAGES; cast++) {
      const resolvedCast = sim.resolvedAbility(WILDMEND_ID)?.castTime ?? 0;
      seen.push(resolvedCast);
      // The real cast start reads the same resolved number (spell haste
      // divides it, exactly as for every other cast).
      player.gcdRemaining = 0;
      player.resource = player.maxResource;
      player.hp = Math.round(player.maxHp * 0.2);
      sim.castAbility(WILDMEND_ID);
      expect(player.castingAbility).toBe(WILDMEND_ID);
      expect(player.castTotal).toBeCloseTo(resolvedCast / spellHasteMult(player), 10);
      // Finish the cast: its completion banks the next Verdance.
      for (let tick = 0; tick < 200 && player.castingAbility; tick++) sim.tick();
      expect(player.castingAbility).toBeNull();
      expect(stacks(player, VERDANCE_ID)).toBe(Math.min(cast + 1, VERDANCE_STAGES));
    }
    expect(seen).toEqual([baseCast, 2.2, 1.9, 1.5]);

    // Spending Overbloom empties the bank and Wildmend slows back down.
    player.gcdRemaining = 0;
    player.resource = player.maxResource;
    player.cooldowns.delete('swiftmend');
    sim.castAbility('swiftmend');
    expect(player.auras.some((aura) => aura.id === VERDANCE_ID)).toBe(false);
    expect(sim.resolvedAbility(WILDMEND_ID)?.castTime).toBe(baseCast);
  });

  it("keeps Wildmend's full Spell Power rider while Verdance speeds the cast", () => {
    // One Wildmend heal through the real combat arm, with and without 3
    // Verdance. Same seed and no ticks in between, so both draw the identical
    // roll (and crit roll): any difference is the Spell Power rider alone.
    const healOnce = (banked: number) => {
      const { sim, player } = rig('restoration');
      for (let stage = 0; stage < banked; stage++) {
        druidEngineOnHotPlanted(ctx(sim), player, 'rejuvenation');
      }
      player.healPower = 400;
      player.hp = 1;
      const res = sim.resolvedAbility(WILDMEND_ID);
      if (!res) throw new Error('Wildmend not known');
      const meta = ctx(sim).players.get(player.id);
      if (!meta) throw new Error('missing meta');
      sim.drainEvents();
      runEffects(ctx(sim), player, meta, player, res);
      const heal = sim
        .drainEvents()
        .find((event) => event.type === 'heal2' && event.ability === 'Wildmend');
      const tooltipBonus = abilityDamageBonus(res, res.effects[0], {
        spellPower: player.spellPower,
        healPower: player.healPower,
        rangedPower: player.rangedPower,
        attackPower: player.attackPower,
      });
      return {
        castTime: res.castTime,
        heal: heal && 'amount' in heal ? heal.amount : -1,
        tooltipBonus,
      };
    };
    const plain = healOnce(0);
    const banked = healOnce(VERDANCE_STAGES);
    expect(plain.castTime).toBeCloseTo(2.52, 10);
    expect(banked.castTime).toBe(1.5);
    expect(plain.heal).toBeGreaterThan(0);
    expect(banked.heal).toBe(plain.heal);
    expect(banked.tooltipBonus).toBe(plain.tooltipBonus);
    // Decisive: reading the sped-up cast time would have cut the rider.
    expect(directHealBonus(400, 1.5)).toBeLessThan(directHealBonus(400, 2.52));
  });

  it('reads Verdance from the aura list alone and never stretches a faster cast', () => {
    const actor = (count: number) =>
      ({ auras: count > 0 ? [{ kind: 'verdance', stacks: count }] : [] }) as unknown as Entity;
    expect(verdanceWildmendCastTime(actor(0), WILDMEND_ID, 2.52)).toBe(2.52);
    expect(verdanceWildmendCastTime(actor(1), WILDMEND_ID, 2.52)).toBe(2.2);
    expect(verdanceWildmendCastTime(actor(2), WILDMEND_ID, 2.52)).toBe(1.9);
    expect(verdanceWildmendCastTime(actor(3), WILDMEND_ID, 2.52)).toBe(1.5);
    // Rank 1 Groveheart Wildmend (2.5 sec less 16%) is already under 2.2.
    expect(verdanceWildmendCastTime(actor(1), WILDMEND_ID, 2.1)).toBe(2.1);
    expect(verdanceWildmendCastTime(actor(3), WILDMEND_ID, 0)).toBe(0);
    // Only Wildmend reads the bank.
    expect(verdanceWildmendCastTime(actor(3), 'regrowth', 2)).toBe(2);
    expect(verdanceWildmendCastTime(actor(3), 'wrath', 1.84)).toBe(1.84);
  });

  it('keeps the authored gates and tooltips on the Verdance cap and cast times', () => {
    const fleetmendRule = ABILITIES.swiftmend.actionReplacement;
    expect(Array.isArray(fleetmendRule) ? undefined : fleetmendRule?.minStacks).toBe(
      VERDANCE_STAGES,
    );
    expect(ABILITIES.overbloom.requiresAuraStacks).toBe(VERDANCE_STAGES);
    const note = ABILITIES.healing_touch.specNotes?.restoration ?? '';
    expect(note).toContain(`(max ${VERDANCE_STAGES})`);
    const [one, two, three] = VERDANCE_WILDMEND_CAST_TIMES;
    expect(note).toContain(`${one} sec at 1 Verdance, ${two} sec at 2, and ${three} sec at 3`);
    for (const id of ['rejuvenation', 'regrowth'] as const) {
      expect(ABILITIES[id].specNotes?.restoration).toContain(`(max ${VERDANCE_STAGES})`);
    }
    expect(ABILITIES.overbloom.description).toContain(`Spends your ${VERDANCE_STAGES} Verdance`);
    expect(ABILITIES.swiftmend.description).toContain(`at ${VERDANCE_STAGES} Verdance`);
  });

  it('runs Fleetmend and Overbloom on one shared slot cooldown', () => {
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

    for (let cast = 0; cast < VERDANCE_STAGES; cast++) {
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
    expect(stacks(player, VERDANCE_ID)).toBe(3);
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

describe('Loping Stride', () => {
  it('stamps a real move-speed multiplier so shapeshifting actually sprints', () => {
    // Baseline since the Wildfang kit pass 2: no row 5 talent selected.
    const { sim, player } = rig('feral');
    expect(moveSpeedMult(player)).toBe(1);

    completed(sim, 'bear_form');
    const stride = player.auras.find((aura) => aura.id === 'loping_stride');
    expect(stride?.kind).toBe('buff_speed');
    // buff_speed carries a 1+fraction multiplier (1.6 = +60%), the same
    // convention every other speed buff and form_travel use.
    expect(stride?.value).toBe(LOPING_STRIDE_SPEED);
    expect(moveSpeedMult(player)).toBeCloseTo(1.6);

    // Travel form's own 1.4 must not win over the stronger 3s sprint.
    player.auras.push({ ...formAura(player, 'form_travel'), value: 1.4 });
    expect(moveSpeedMult(player)).toBeCloseTo(1.6);
  });

  it('holds the 20s internal cooldown between shifts', () => {
    const { sim, player } = rig('feral');
    completed(sim, 'cat_form');
    player.auras = player.auras.filter((aura) => aura.id !== 'loping_stride');
    completed(sim, 'bear_form');
    expect(player.auras.some((aura) => aura.id === 'loping_stride')).toBe(false);
    expect(moveSpeedMult(player)).toBe(1);

    // The ICD decays through the authoritative tick: past 20s the next shift
    // grants the sprint again.
    for (let tick = 0; tick < 20 * 20 + 1; tick++) sim.tick();
    completed(sim, 'cat_form');
    expect(player.auras.some((aura) => aura.id === 'loping_stride')).toBe(true);
    expect(moveSpeedMult(player)).toBeCloseTo(1.6);
  });
});

describe('Fleet Form control break (baseline) and the Wildshift gate', () => {
  // A breakable root or slow the way an enemy would stamp it; unbreakable
  // control carries the unbreakableControl flag (encounter-owned CC).
  function control(
    player: Entity,
    kind: 'root' | 'slow',
    id: string,
    options: { unbreakable?: boolean } = {},
  ): Aura {
    const aura: Aura = { ...formAura(player, kind), id, name: id };
    aura.value = kind === 'slow' ? 0.5 : 0;
    aura.sourceId = -1;
    if (options.unbreakable) aura.unbreakableControl = true;
    return aura;
  }
  const wears = (player: Entity, kind: Aura['kind']) =>
    player.auras.some((aura) => aura.kind === kind);

  it('Fleet Form strips a breakable root and slow with NO talent selected', () => {
    const { sim, player } = rig('feral');
    player.auras.push(
      control(player, 'root', 'entangling_roots'),
      control(player, 'slow', 'crippling_poison'),
    );
    expect(isRooted(player)).toBe(true);
    expect(moveSpeedMult(player)).toBeCloseTo(0.5);

    completed(sim, 'travel_form');
    expect(wears(player, 'root')).toBe(false);
    expect(wears(player, 'slow')).toBe(false);
    expect(isRooted(player)).toBe(false);
    // One aura-lost event per stripped control, the same emit Wildshift makes.
    const lost = sim
      .tick()
      .filter(
        (event) =>
          event.type === 'aura' &&
          event.targetId === player.id &&
          event.gained === false &&
          (event.name === 'entangling_roots' || event.name === 'crippling_poison'),
      )
      .map((event) => (event as { name: string }).name)
      .sort();
    expect(lost).toEqual(['crippling_poison', 'entangling_roots']);
  });

  it('Fleet Form leaves unbreakable control in place', () => {
    const { sim, player } = rig('feral');
    player.auras.push(
      control(player, 'root', 'boss_grasp', { unbreakable: true }),
      control(player, 'slow', 'crippling_poison'),
    );
    completed(sim, 'travel_form');
    expect(player.auras.some((aura) => aura.id === 'boss_grasp')).toBe(true);
    expect(isRooted(player)).toBe(true);
    expect(wears(player, 'slow')).toBe(false);
  });

  it('the real cast path breaks the root: a rooted druid casts Fleet Form and is free', () => {
    const { sim, player } = rig('feral');
    player.auras.push(control(player, 'root', 'entangling_roots'));
    player.gcdRemaining = 0;
    player.resource = player.maxResource;
    sim.castAbility('travel_form');
    sim.tick();
    expect(wears(player, 'form_travel')).toBe(true);
    expect(wears(player, 'root')).toBe(false);
  });

  it('Cat Form strips nothing without Wildshift', () => {
    const { sim, player } = rig('feral');
    player.auras.push(
      control(player, 'root', 'entangling_roots'),
      control(player, 'slow', 'crippling_poison'),
    );
    completed(sim, 'cat_form');
    expect(wears(player, 'root')).toBe(true);
    expect(wears(player, 'slow')).toBe(true);
  });

  it('Cat Form strips both with Wildshift selected', () => {
    const { sim, player } = rig('feral', { 5: 'dru_r5_improved_wrath' });
    player.auras.push(
      control(player, 'root', 'entangling_roots'),
      control(player, 'slow', 'crippling_poison'),
    );
    completed(sim, 'cat_form');
    expect(wears(player, 'root')).toBe(false);
    expect(wears(player, 'slow')).toBe(false);
  });

  it('Bruin and Moonwing keep the talent gate (only Fleet Form is baseline)', () => {
    for (const form of ['bear_form', 'moonkin_form']) {
      const { sim, player } = rig('feral');
      player.auras.push(control(player, 'root', 'entangling_roots'));
      completed(sim, form);
      expect(wears(player, 'root'), form).toBe(true);
    }
  });
});
