import { describe, expect, it } from 'vitest';
import { applyEarthShield } from '../src/sim/combat/earth_shield';
import { maybeFulminationOverload } from '../src/sim/combat/fulmination';
import { onCastCompleted, onMeleeSwing } from '../src/sim/combat/talent_procs';
import { prepareWarspiritArcBolt, warspiritArcBoltCastTime } from '../src/sim/combat/warspirit';
import { SHAMAN_CHOICE_ROWS } from '../src/sim/content/choice_rows_classic';
import { computeTalentModifiers } from '../src/sim/content/talents';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';

function shaman(
  spec: 'elemental' | 'enhancement' | 'restoration',
  rows: Record<number, string> = {},
) {
  const sim = new Sim({ seed: 2800, playerClass: 'shaman', autoEquip: true });
  sim.setPlayerLevel(20);
  expect(sim.applyTalents({ spec, rows })).toBe(true);
  sim.player.resource = sim.player.maxResource;
  return sim;
}

function hostile(sim: Sim, id: number, distance: number): Entity {
  const mob = createMob(id, MOBS.forest_wolf, 20, {
    x: sim.player.pos.x,
    y: sim.player.pos.y,
    z: sim.player.pos.z + distance,
  });
  mob.hostile = true;
  mob.maxHp = mob.hp = 10_000;
  (sim as unknown as { addEntity(entity: Entity): void }).addEntity(mob);
  return mob;
}

describe('Shaman v0.28.0 owner pass', () => {
  it('follows the shared six-row design framework', () => {
    expect(SHAMAN_CHOICE_ROWS.rows.map((row) => [row.level, row.theme])).toEqual([
      [5, 'mobility'],
      [8, 'survival'],
      [11, 'control'],
      [14, 'amplify'],
      [17, 'cooldown'],
      [20, 'capstone'],
    ]);
    expect(SHAMAN_CHOICE_ROWS.rows.map((row) => row.options.map((option) => option.name))).toEqual([
      ['Rebounding Current', 'Guiding Spirits', 'Wolfstep'],
      ['Imbued Lifeblood', 'Stonewake Shell', 'Ancestral Mending'],
      ['Fault Rebuke', 'Rime Lock', 'Gripping Earth'],
      ['Fault Line', 'Imbued Tempo', 'Returning Current'],
      ['Elemental Discharge', 'Stone Aegis', 'Springwell'],
      ['Storm Chorus', 'Storm Recall', 'Undertow Promise'],
    ]);
  });

  it('bakes Fulmination, Skyrend, and Cleansing Tides automatically by spec', () => {
    const elemental = computeTalentModifiers('shaman', { spec: 'elemental', rows: {} }, 20);
    expect(elemental.procs.map((proc) => proc.id)).toEqual(['sha_fulmination']);
    expect(elemental.abilities.earth_shock.addEffects).toContainEqual({
      type: 'consumeAuraChargesDamage',
      auraId: 'lightning_shield',
      damagePerCharge: 8,
      radius: 8,
    });

    const enhancement = computeTalentModifiers('shaman', { spec: 'enhancement', rows: {} }, 20);
    expect(enhancement.procs.map((proc) => proc.id)).toEqual(['sha_skyrend']);
    expect(enhancement.stats).toMatchObject({ maxHpPct: 0.1, armorPct: 0.2 });
    expect(enhancement.global.rockbiterThreatPct).toBe(1);
    expect(enhancement.grants).toContainEqual({ ability: 'elemental_demand', rank: 1 });

    const restoration = computeTalentModifiers('shaman', { spec: 'restoration', rows: {} }, 20);
    expect(restoration.procs.map((proc) => proc.id)).toEqual(['sha_cleansing_tides']);
  });

  it('builds and caps Fulmination charges only while Thunder Ward is active', () => {
    const sim = shaman('elemental');
    const p = sim.player;
    p.auras.push({
      id: 'lightning_shield',
      name: 'Thunder Ward',
      kind: 'thorns',
      remaining: 60,
      duration: 60,
      value: 1,
      charges: 3,
      sourceId: p.id,
      school: 'nature',
    });

    for (let index = 0; index < 10; index++) onCastCompleted(sim.ctx, p, 'lightning_bolt');
    expect(p.auras[0].charges).toBe(9);

    p.auras.length = 0;
    onCastCompleted(sim.ctx, p, 'lightning_bolt');
    expect(p.auras).toHaveLength(0);
  });

  it('spends Fulmination as area damage and repeats Arc Bolt onto one neighbor', () => {
    const sim = shaman('elemental');
    const meta = sim.meta(sim.playerId);
    const jolt = sim.resolvedAbility('earth_shock');
    if (!meta || !jolt) throw new Error('missing Fulmination data');
    const primary = hostile(sim, 9281, 3);
    const neighbor = hostile(sim, 9282, 5);
    const distant = hostile(sim, 9283, 20);
    sim.player.auras.push({
      id: 'lightning_shield',
      name: 'Thunder Ward',
      kind: 'thorns',
      remaining: 60,
      duration: 60,
      value: 1,
      charges: 3,
      sourceId: sim.playerId,
      school: 'nature',
    });

    const neighborBefore = neighbor.hp;
    sim.ctx.runEffects(sim.player, meta, primary, jolt);
    expect(sim.player.auras.some((aura) => aura.id === 'lightning_shield')).toBe(false);
    expect(neighborBefore - neighbor.hp).toBe(27);
    expect(distant.hp).toBe(distant.maxHp);

    sim.player.auras.push({
      id: 'lightning_shield',
      name: 'Thunder Ward',
      kind: 'thorns',
      remaining: 60,
      duration: 60,
      value: 1,
      charges: 9,
      sourceId: sim.playerId,
      school: 'nature',
    });
    let rolledChance = 0;
    sim.ctx.rng.chance = (chance) => {
      rolledChance = chance;
      return true;
    };
    const primaryBefore = primary.hp;
    const chainBefore = neighbor.hp;
    maybeFulminationOverload(
      sim.ctx,
      sim.player,
      primary,
      'lightning_bolt',
      'Arc Bolt',
      'nature',
      100,
    );
    expect(rolledChance).toBeCloseTo(0.45);
    expect(primaryBefore - primary.hp).toBe(50);
    expect(chainBefore - neighbor.hp).toBe(50);
  });

  it('turns five landed Warspirit attacks into an instant, 50% stronger Arc Bolt', () => {
    const sim = shaman('enhancement');
    const meta = sim.meta(sim.playerId);
    const bolt = sim.resolvedAbility('lightning_bolt');
    if (!meta || !bolt) throw new Error('missing Warspirit data');

    for (let index = 0; index < 5; index++) {
      onMeleeSwing(sim.ctx, sim.player, index % 2 === 0 ? 'auto_attack' : 'stormstrike');
    }
    expect(sim.player.auras.find((aura) => aura.id === 'sha_skyrend')?.stacks).toBe(5);
    expect(warspiritArcBoltCastTime(sim.ctx, sim.player, meta, 'lightning_bolt', 3)).toBe(0);

    const prepared = prepareWarspiritArcBolt(sim.ctx, sim.player, meta, bolt);
    expect(prepared.damageMult).toBeCloseTo(1.5);
    expect(sim.player.auras.some((aura) => aura.id === 'sha_skyrend')).toBe(false);
  });

  it('makes Stonebound Weapon an Enhancement-only threat posture and grants its taunt', () => {
    const enhancement = shaman('enhancement');
    const rockbiter = enhancement.resolvedAbility('rockbiter_weapon');
    const enhancementMeta = enhancement.meta(enhancement.playerId);
    if (!rockbiter || !enhancementMeta) throw new Error('missing Stonebound Weapon');
    enhancement.ctx.runEffects(enhancement.player, enhancementMeta, null, rockbiter);

    expect(enhancement.ctx.threatMod(enhancement.player, 'physical')).toBe(2);
    expect(enhancement.resolvedAbility('elemental_demand')).not.toBeNull();

    const elemental = shaman('elemental');
    const elementalRockbiter = elemental.resolvedAbility('rockbiter_weapon');
    const elementalMeta = elemental.meta(elemental.playerId);
    if (!elementalRockbiter || !elementalMeta) {
      throw new Error('missing Elemental Stonebound Weapon');
    }
    elemental.ctx.runEffects(elemental.player, elementalMeta, null, elementalRockbiter);
    expect(elemental.ctx.threatMod(elemental.player, 'physical')).toBe(1);
    expect(elemental.resolvedAbility('elemental_demand')).toBeNull();
  });

  it('lets Warspirit taunt and gives Elemental Discharge an imbue-specific rider', () => {
    const sim = shaman('enhancement', { 17: 'sha_r17_elemental_discharge' });
    const meta = sim.meta(sim.playerId);
    const taunt = sim.resolvedAbility('elemental_demand');
    const discharge = sim.resolvedAbility('unleash_weapon');
    const rockbiter = sim.resolvedAbility('rockbiter_weapon');
    if (!meta || !taunt || !discharge || !rockbiter) throw new Error('missing Warspirit kit');
    const target = hostile(sim, 9291, 3);
    target.threat.set(77, 1_000);
    sim.ctx.runEffects(sim.player, meta, target, taunt);
    expect(target.forcedTargetId).toBe(sim.playerId);
    expect(target.threat.get(sim.playerId)).toBe(1_001);

    sim.ctx.runEffects(sim.player, meta, null, rockbiter);
    const threatBefore = target.threat.get(sim.playerId) ?? 0;
    sim.ctx.runEffects(sim.player, meta, target, discharge);
    expect(target.threat.get(sim.playerId) ?? 0).toBeGreaterThan(threatBefore + 60);

    for (const [imbueId, auraId, auraKind] of [
      ['flametongue_weapon', 'unleash_weapon_flame', 'dot'],
      ['frostbrand_weapon', 'unleash_weapon_slow', 'slow'],
    ] as const) {
      const elemental = shaman('enhancement', { 17: 'sha_r17_elemental_discharge' });
      const elementalMeta = elemental.meta(elemental.playerId);
      const imbue = elemental.resolvedAbility(imbueId);
      const elementalDischarge = elemental.resolvedAbility('unleash_weapon');
      if (!elementalMeta || !imbue || !elementalDischarge) throw new Error('missing imbue kit');
      const elementalTarget = hostile(elemental, auraKind === 'dot' ? 9292 : 9293, 3);
      elemental.ctx.runEffects(elemental.player, elementalMeta, null, imbue);
      elemental.ctx.runEffects(
        elemental.player,
        elementalMeta,
        elementalTarget,
        elementalDischarge,
      );
      expect(elementalTarget.auras).toContainEqual(
        expect.objectContaining({ id: auraId, kind: auraKind }),
      );
    }
  });

  it('spends exactly six Stone Aegis charges on direct attacks', () => {
    const sim = shaman('enhancement', { 17: 'sha_r17_stone_aegis' });
    const p = sim.player;
    p.auras.push({
      id: 'earth_shield',
      name: 'Stone Aegis',
      kind: 'earth_shield',
      remaining: 20,
      duration: 20,
      value: 0.2,
      charges: 6,
      sourceId: p.id,
      school: 'nature',
    });

    const amounts = Array.from({ length: 7 }, () => applyEarthShield(sim.ctx, p, 100));
    expect(amounts).toEqual([80, 80, 80, 80, 80, 80, 100]);
    expect(p.auras.some((aura) => aura.kind === 'earth_shield')).toBe(false);
  });

  it('turns Chain Heal into a cheaper Mending Waters follow-up for Spiritmend', () => {
    const sim = shaman('restoration');
    onCastCompleted(sim.ctx, sim.player, 'chain_heal');
    expect(sim.player.auras).toContainEqual(
      expect.objectContaining({
        id: 'sha_cleansing_tides',
        kind: 'next_cast_cheap',
        value: 0.5,
        empowerAbilities: ['healing_wave'],
      }),
    );
  });

  it('makes Undertow Promise sustain the Shaman rather than the heal target', () => {
    const sim = shaman('enhancement', { 20: 'sha_r20_tidal_waves' });
    const ally = { ...sim.player, id: 99, hp: 100, maxHp: 1000, auras: [] } as Entity;
    sim.player.hp = Math.round(sim.player.maxHp * 0.5);
    const before = sim.player.hp;

    onCastCompleted(sim.ctx, sim.player, 'healing_wave', ally);
    onCastCompleted(sim.ctx, sim.player, 'healing_wave', ally);
    onCastCompleted(sim.ctx, sim.player, 'healing_wave', ally);

    expect(sim.player.hp).toBeGreaterThanOrEqual(before + Math.round(sim.player.maxHp * 0.1));
    expect(ally.hp).toBe(100);
  });
});
