import { describe, expect, it } from 'vitest';
import { meleeSwing } from '../src/sim/combat/auto_attack';
import { runEffects } from '../src/sim/combat/effect_dispatch';
import {
  applyRequitalAutoAttack,
  masteredPaladinAuraValue,
} from '../src/sim/combat/paladin_talents';
import { applyThornsReaction } from '../src/sim/combat/thorns_charge';
import { PALADIN_CHOICE_ROWS } from '../src/sim/content/choice_rows_classic';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import {
  ASCENSION_DURATION,
  grantAbilityDevotion,
  grantDevotion,
  grantDevotionFromBlock,
  isDivineAscensionActive,
  MAX_DEVOTION,
  updatePaladinDevotion,
} from '../src/sim/paladin_devotion';
import { type ResolvedAbility, Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';

function rig(rows: Record<number, string>, spec: string | null = null) {
  const sim = new Sim({ seed: 91, playerClass: 'paladin', autoEquip: true });
  sim.setPlayerLevel(20);
  expect(sim.applyTalents({ spec, rows })).toBe(true);
  sim.player.resource = sim.player.maxResource;
  return sim;
}

function resolved(sim: Sim, id: string): ResolvedAbility {
  const ability = sim.resolvedAbility(id);
  if (!ability) throw new Error(`missing ${id}`);
  return ability;
}

function target(sim: Sim, distance = 3): Entity {
  const mob = createMob(50_000 + sim.entities.size, MOBS.forest_wolf, 20, {
    x: sim.player.pos.x + distance,
    y: sim.player.pos.y,
    z: sim.player.pos.z,
  });
  mob.hostile = true;
  mob.maxHp = 100_000;
  mob.hp = mob.maxHp;
  (sim as unknown as { addEntity(entity: Entity): void }).addEntity(mob);
  return mob;
}

function resolveNow(sim: Sim, abilityId: string, castTarget: Entity | null): void {
  const meta = sim.meta(sim.playerId);
  if (!meta) throw new Error('missing metadata');
  runEffects(sim.ctx, sim.player, meta, castTarget, resolved(sim, abilityId));
}

describe('paladin choice-row definitions', () => {
  it('ships the agreed six rows and eighteen choices', () => {
    expect(PALADIN_CHOICE_ROWS.rows.map((row) => row.level)).toEqual([5, 8, 11, 14, 17, 20]);
    expect(
      PALADIN_CHOICE_ROWS.rows.flatMap((row) => row.options.map((option) => option.id)),
    ).toEqual([
      'pal_r5_radiant_stride',
      'pal_r5_steadfast_step',
      'pal_r5_divine_steed',
      'pal_r8_enduring_protection',
      'pal_r8_steady_hands',
      'pal_r8_recurring_grace',
      'pal_r11_fist_of_justice',
      'pal_r11_double_sentence',
      'pal_r11_radiant_shackles',
      'pal_r14_zeal',
      'pal_r14_sacred_reserve',
      'pal_r14_divine_purpose',
      'pal_r17_extended_dawn',
      'pal_r17_radiant_wrath',
      'pal_r17_sanctified_fervor',
      'pal_r20_aura_mastery',
      'pal_r20_dawn_echo',
      'pal_r20_perpetual_sun',
    ]);
  });

  it('explains Divine Steed as Devotion scaling followed by an Ascension burst', () => {
    const divineSteed = PALADIN_CHOICE_ROWS.rows
      .flatMap((row) => row.options)
      .find((option) => option.id === 'pal_r5_divine_steed');

    expect(divineSteed?.description).toBe(
      'Gain 0.75% movement speed per Devotion, up to 15% at 20. Activating Divine Ascension spends your Devotion and grants 30% movement speed for 5 sec.',
    );
  });

  it('resolves the numerical ability modifiers exactly', () => {
    const ward = resolved(rig({ 8: 'pal_r8_enduring_protection' }), 'divine_protection');
    expect(ward.effects[0]).toMatchObject({
      type: 'absorb',
      amount: 0,
      casterMaxHpPct: 0.35,
      duration: 15,
    });

    expect(resolved(rig({ 8: 'pal_r8_steady_hands' }), 'lay_on_hands').cooldown).toBe(420);
    expect(resolved(rig({ 11: 'pal_r11_fist_of_justice' }), 'hammer_of_justice').cooldown).toBe(45);
    expect(resolved(rig({ 11: 'pal_r11_double_sentence' }), 'hammer_of_justice')).toMatchObject({
      charges: 2,
      bonusCharges: 1,
    });

    const wrath = resolved(rig({ 17: 'pal_r17_radiant_wrath' }), 'avenging_wrath');
    expect(wrath.cooldown).toBe(100);
    expect(
      wrath.effects.filter((effect) => effect.type === 'selfBuff').map((effect) => effect.duration),
    ).toEqual([20, 20]);

    const fervor = resolved(rig({ 17: 'pal_r17_sanctified_fervor' }), 'avenging_wrath');
    expect(fervor.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'selfBuff', kind: 'buff_crit', value: 0.15 }),
        expect.objectContaining({ type: 'selfBuff', kind: 'buff_haste', value: 1.15 }),
        expect.objectContaining({ type: 'selfBuff', kind: 'buff_spellhaste', value: 0.15 }),
      ]),
    );
  });
});

describe('paladin row runtime', () => {
  it('applies Hammer mobility, slow, and overheal shielding only on an effective hit', () => {
    const sim = rig({
      5: 'pal_r5_radiant_stride',
      8: 'pal_r8_recurring_grace',
      11: 'pal_r11_radiant_shackles',
    });
    const mob = target(sim);
    sim.player.hp = sim.player.maxHp;
    resolveNow(sim, 'hammer_of_grace', mob);

    expect(sim.player.auras).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'radiant_stride_speed', value: 1.3, duration: 4 }),
        expect.objectContaining({ id: 'recurring_grace_absorb', kind: 'absorb', duration: 10 }),
      ]),
    );
    expect(mob.auras).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'slow', value: 0.6, duration: 4 })]),
    );
    const shield = sim.player.auras.find((aura) => aura.id === 'recurring_grace_absorb');
    expect(shield?.value).toBeLessThanOrEqual(Math.round(sim.player.maxHp * 0.1));
  });

  it('extends Solar Step and rejects slows while it is active', () => {
    const sim = rig({ 5: 'pal_r5_steadfast_step' });
    const step = resolved(sim, 'solar_step');
    expect(step.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'buff_speed', duration: 4 }),
        expect.objectContaining({ kind: 'slow_immunity', duration: 4 }),
      ]),
    );
    resolveNow(sim, 'solar_step', null);
    sim.ctx.applyAura(sim.player, {
      id: 'test_slow',
      name: 'Test Slow',
      kind: 'slow',
      value: 0.5,
      remaining: 4,
      duration: 4,
      sourceId: 999,
      school: 'frost',
    });
    expect(sim.player.auras.some((aura) => aura.id === 'test_slow')).toBe(false);
  });

  it('scales Divine Steed with current Devotion and grants its post-spend burst', () => {
    const sim = rig({ 5: 'pal_r5_divine_steed' });
    grantDevotion(sim.player, 10);
    expect(sim.moveSpeedMult(sim.player)).toBeCloseTo(1.075);
    grantDevotion(sim.player, 10);
    expect(sim.moveSpeedMult(sim.player)).toBeCloseTo(1.15);
    resolveNow(sim, 'divine_ascension', null);
    expect(sim.player.paladinDevotion?.value).toBe(0);
    expect(sim.moveSpeedMult(sim.player)).toBeCloseTo(1.3);
  });

  it('turns Last Rite into a six-second follow-up heal', () => {
    const sim = rig({ 8: 'pal_r8_steady_hands' });
    sim.player.hp = 1;
    resolveNow(sim, 'lay_on_hands', sim.player);
    expect(sim.player.auras).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'steady_hands_hot', kind: 'hot', duration: 6 }),
      ]),
    );
    expect(sim.player.auras.find((aura) => aura.id === 'steady_hands_hot')?.value).toBe(
      Math.round(Math.round(sim.player.maxHp * 0.3) / 3),
    );
  });

  it('grants Zeal and repeats exactly 40% damage with one Devotion for an effective echo', () => {
    const sim = rig({ 14: 'pal_r14_zeal', 20: 'pal_r20_dawn_echo' });
    const mob = target(sim);
    const rng = sim.ctx.rng as typeof sim.ctx.rng & {
      range(min: number, max: number): number;
      chance(probability: number): boolean;
    };
    rng.range = (min) => min;
    rng.chance = () => false;
    if (sim.player.paladinDevotion) sim.player.paladinDevotion.value = 0;
    resolveNow(sim, 'avenging_wrath', null);
    sim.drainEvents();
    let primary = 0;
    let echo = 0;
    for (let cast = 0; cast < 3; cast++) {
      resolveNow(sim, 'hammer_of_grace', mob);
      const events = sim.drainEvents();
      const hammer = events.find(
        (event) => event.type === 'damage' && event.ability === 'Hammer of Grace',
      );
      if (cast === 0 && hammer?.type === 'damage') primary = hammer.amount;
      const copied = events.find(
        (event) => event.type === 'damage' && event.ability === 'Dawn Echo',
      );
      if (copied?.type === 'damage') echo = copied.amount;
    }
    expect(sim.player.paladinDevotion?.value).toBe(18);
    expect(echo).toBe(Math.round(primary * 0.4));
  });

  it('repeats exactly 40% effective healing with one Devotion but no Beacon or recursion', () => {
    const sim = rig({ 20: 'pal_r20_dawn_echo' });
    const rng = sim.ctx.rng as typeof sim.ctx.rng & {
      range(min: number, max: number): number;
      chance(probability: number): boolean;
    };
    rng.range = (min) => min;
    rng.chance = () => false;
    if (sim.player.paladinDevotion) sim.player.paladinDevotion.value = 0;
    resolveNow(sim, 'avenging_wrath', null);
    sim.drainEvents();
    let primary = 0;
    let echo = 0;
    for (let cast = 0; cast < 3; cast++) {
      sim.player.hp = 1;
      resolveNow(sim, 'holy_light', sim.player);
      const events = sim.drainEvents();
      const mending = events.find(
        (event) => event.type === 'heal2' && event.ability === 'Mending Light',
      );
      if (cast === 0 && mending?.type === 'heal2') primary = mending.amount;
      const copied = events.find(
        (event) => event.type === 'heal2' && event.ability === 'Dawn Echo',
      );
      if (copied?.type === 'heal2') echo = copied.amount;
      expect(
        events.some((event) => event.type === 'heal2' && event.ability === 'Beacon of Light'),
      ).toBe(false);
    }
    expect(echo).toBe(Math.round(primary * 0.4));
    expect(sim.player.paladinDevotion?.value).toBe(17);
  });

  it('does not grant echo Devotion when the repeated heal is entirely overhealing', () => {
    const sim = rig({ 20: 'pal_r20_dawn_echo' });
    const rng = sim.ctx.rng as typeof sim.ctx.rng & {
      range(min: number, max: number): number;
      chance(probability: number): boolean;
    };
    rng.range = (min) => min;
    rng.chance = () => false;
    if (sim.player.paladinDevotion) sim.player.paladinDevotion.value = 0;

    for (let cast = 0; cast < 3; cast++) {
      sim.player.hp = cast === 2 ? sim.player.maxHp - 1 : 1;
      resolveNow(sim, 'holy_light', sim.player);
      sim.drainEvents();
    }

    expect(sim.player.hp).toBe(sim.player.maxHp);
    expect(sim.player.paladinDevotion?.value).toBe(3);
  });

  it('does not grant echo Devotion when the primary hit leaves no living target', () => {
    const sim = rig({ 20: 'pal_r20_dawn_echo' });
    const mob = target(sim);
    const rng = sim.ctx.rng as typeof sim.ctx.rng & {
      range(min: number, max: number): number;
      chance(probability: number): boolean;
    };
    rng.range = (min) => min;
    rng.chance = () => false;
    if (sim.player.paladinDevotion) sim.player.paladinDevotion.value = 0;

    for (let cast = 0; cast < 3; cast++) {
      if (cast === 2) mob.hp = 1;
      resolveNow(sim, 'hammer_of_grace', mob);
      sim.drainEvents();
    }

    expect(mob.dead).toBe(true);
    expect(sim.player.paladinDevotion?.value).toBe(3);
  });
});

describe('Ascension talent invariants', () => {
  it('blocks every Devotion gain and does not arm the block ICD during Ascension', () => {
    const sim = rig({});
    grantDevotion(sim.player, MAX_DEVOTION);
    sim.castAbility('divine_ascension');
    expect(grantAbilityDevotion(sim.player, 10)).toBe(0);
    expect(grantDevotionFromBlock(sim.player)).toBe(false);
    expect(sim.player.paladinDevotion).toMatchObject({ value: 0, blockIcdRemaining: 0 });
  });

  it('wires Divine Purpose through real empowered casts and only the selected row', () => {
    const purpose = rig({ 14: 'pal_r14_divine_purpose' }, 'retribution');
    const sibling = rig({ 14: 'pal_r14_sacred_reserve' }, 'retribution');
    for (const sim of [purpose, sibling]) {
      const rng = sim.ctx.rng as typeof sim.ctx.rng & { chance(probability: number): boolean };
      rng.chance = () => true;
      grantDevotion(sim.player, MAX_DEVOTION);
      resolveNow(sim, 'divine_ascension', null);
      resolveNow(sim, 'final_edict', target(sim));
    }
    expect(purpose.player.paladinDevotion?.ascensionCharges).toBe(5);
    expect(sibling.player.paladinDevotion?.ascensionCharges).toBe(4);
  });

  it('grants Sacred Reserve on expiration without triggering Perpetual Sun', () => {
    const sim = rig({ 14: 'pal_r14_sacred_reserve', 20: 'pal_r20_perpetual_sun' });
    grantDevotion(sim.player, MAX_DEVOTION);
    sim.castAbility('divine_ascension');
    updatePaladinDevotion(sim.player, ASCENSION_DURATION, true);
    expect(isDivineAscensionActive(sim.player)).toBe(false);
    expect(sim.player.paladinDevotion?.value).toBe(5);
    expect(sim.player.auras.some((aura) => aura.id === 'perpetual_sun_generation')).toBe(false);
  });

  it('triggers Perpetual Sun only after the last charge, then doubles generation', () => {
    const sim = rig({ 14: 'pal_r14_sacred_reserve', 20: 'pal_r20_perpetual_sun' }, 'retribution');
    const mob = target(sim, 2);
    const farMob = target(sim, 11);
    const allyId = sim.addPlayer('warrior', 'Sun Ally');
    sim.partyInvite(allyId, sim.player.id);
    sim.partyAccept(allyId);
    const ally = sim.entities.get(allyId);
    if (!ally) throw new Error('missing ally');
    ally.pos = { ...sim.player.pos, x: sim.player.pos.x + 15 };
    ally.maxHp = 1_000;
    ally.hp = 1;
    sim.player.hp = Math.max(1, sim.player.maxHp - 500);
    grantDevotion(sim.player, MAX_DEVOTION);
    resolveNow(sim, 'divine_ascension', null);
    if (!sim.player.paladinDevotion) throw new Error('missing devotion');
    sim.player.paladinDevotion.ascensionCharges = 2;
    resolveNow(sim, 'final_edict', mob);
    expect(
      sim
        .drainEvents()
        .some(
          (event) =>
            (event.type === 'damage' || event.type === 'heal2') &&
            event.ability === 'Perpetual Sun',
        ),
    ).toBe(false);

    resolveNow(sim, 'final_edict', mob);
    const pulseEvents = sim.drainEvents();

    expect(isDivineAscensionActive(sim.player)).toBe(false);
    expect(sim.player.paladinDevotion.value).toBe(5);
    expect(pulseEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'damage',
          targetId: mob.id,
          ability: 'Perpetual Sun',
          amount: 150,
        }),
        expect.objectContaining({
          type: 'heal2',
          targetId: ally.id,
          ability: 'Perpetual Sun',
          amount: 150,
        }),
      ]),
    );
    expect(
      pulseEvents.some(
        (event) =>
          event.type === 'damage' &&
          event.targetId === farMob.id &&
          event.ability === 'Perpetual Sun',
      ),
    ).toBe(false);
    expect(sim.player.auras).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'perpetual_sun_generation', duration: 5 }),
      ]),
    );
    expect(grantAbilityDevotion(sim.player, 1)).toBe(2);
    expect(sim.player.paladinDevotion.value).toBe(7);
    sim.ctx.applyAura(sim.player, {
      id: 'avenging_wrath',
      name: 'Avenging Wrath',
      kind: 'buff_dmg_done',
      value: 0.2,
      remaining: 5,
      duration: 5,
      sourceId: sim.player.id,
      school: 'holy',
    });
    expect(grantAbilityDevotion(sim.player, 1)).toBe(2);
    expect(sim.player.paladinDevotion.value).toBe(9);
  });

  it('does not double Zeal bonus or trigger reserve/Sun for a dead Paladin', () => {
    const sim = rig({ 14: 'pal_r14_zeal', 20: 'pal_r20_perpetual_sun' }, 'retribution');
    const mob = target(sim);
    grantDevotion(sim.player, MAX_DEVOTION);
    resolveNow(sim, 'divine_ascension', null);
    if (!sim.player.paladinDevotion) throw new Error('missing devotion');
    sim.player.paladinDevotion.ascensionCharges = 1;
    resolveNow(sim, 'final_edict', mob);
    for (let cast = 0; cast < 3; cast++) resolveNow(sim, 'hammer_of_grace', mob);
    expect(sim.player.paladinDevotion.value).toBe(7);

    const dead = rig({ 14: 'pal_r14_sacred_reserve', 20: 'pal_r20_perpetual_sun' }, 'retribution');
    grantDevotion(dead.player, MAX_DEVOTION);
    resolveNow(dead, 'divine_ascension', null);
    if (!dead.player.paladinDevotion) throw new Error('missing devotion');
    dead.player.paladinDevotion.ascensionCharges = 1;
    dead.player.dead = true;
    resolveNow(dead, 'final_edict', target(dead));
    expect(dead.player.paladinDevotion.value).toBe(0);
    expect(dead.player.auras.some((aura) => aura.id === 'perpetual_sun_generation')).toBe(false);
  });

  it('clears Zeal and Dawn Echo progress when their talents are removed', () => {
    const sim = rig({ 14: 'pal_r14_zeal', 20: 'pal_r20_dawn_echo' });
    const mob = target(sim);
    resolveNow(sim, 'hammer_of_grace', mob);
    expect(sim.player.procState?.counters).toMatchObject({
      paladin_zeal: 1,
      paladin_dawn_echo: 1,
    });
    sim.player.inCombat = false;
    expect(
      sim.applyTalents({
        spec: null,
        rows: { 14: 'pal_r14_sacred_reserve', 20: 'pal_r20_aura_mastery' },
      }),
    ).toBe(true);
    expect(sim.player.procState?.counters.paladin_zeal).toBeUndefined();
    expect(sim.player.procState?.counters.paladin_dawn_echo).toBeUndefined();
  });
});

describe('Aura Mastery and Requital Aura', () => {
  it('grants an 8-second, 120-second-cooldown active capstone', () => {
    const sim = rig({ 20: 'pal_r20_aura_mastery' });
    const mastery = resolved(sim, 'aura_mastery');
    expect(mastery.cooldown).toBe(120);
    expect(mastery.effects[0]).toMatchObject({
      type: 'buffTarget',
      kind: 'buff_aura_mastery',
      duration: 8,
      party: true,
    });
  });

  it('boosts only Devotion and Requital values from 5 to 15', () => {
    const sim = rig({ 20: 'pal_r20_aura_mastery' });
    resolveNow(sim, 'aura_mastery', null);
    expect(masteredPaladinAuraValue(sim.player, 'devotion_ward', 0.05)).toBeCloseTo(0.15);
    expect(masteredPaladinAuraValue(sim.player, 'retribution_aura', 5)).toBe(15);
    expect(masteredPaladinAuraValue(sim.player, 'radiant_devotion', 0.05)).toBe(0.05);
  });

  it('turns a live 5% Devotion Aura into 15% reduction without changing the aura', () => {
    const sim = rig({ 20: 'pal_r20_aura_mastery' });
    const mob = target(sim);
    resolveNow(sim, 'devotion_ward', null);
    sim.player.hp = sim.player.maxHp;
    sim.ctx.dealDamage(mob, sim.player, 100, false, 'holy', 'Test Hit', 'hit');
    expect(sim.player.maxHp - sim.player.hp).toBe(95);

    sim.player.hp = sim.player.maxHp;
    resolveNow(sim, 'aura_mastery', null);
    sim.ctx.dealDamage(mob, sim.player, 100, false, 'holy', 'Test Hit', 'hit');
    expect(sim.player.maxHp - sim.player.hp).toBe(85);
    expect(sim.player.auras.find((aura) => aura.id === 'devotion_ward')?.value).toBe(0.05);
  });

  it('refreshes one group marker instead of stacking it', () => {
    const sim = rig({ 20: 'pal_r20_aura_mastery' });
    resolveNow(sim, 'aura_mastery', null);
    const first = sim.player.auras.find((aura) => aura.id === 'aura_mastery');
    if (!first) throw new Error('missing mastery');
    first.remaining = 2;
    sim.ctx.applyAura(sim.player, { ...first, sourceId: 999, remaining: 8 });
    const active = sim.player.auras.filter((aura) => aura.id === 'aura_mastery');
    expect(active).toHaveLength(1);
    expect(active[0]).toMatchObject({ sourceId: 999, remaining: 8 });
  });

  it('applies Aura Mastery to every current group member automatically', () => {
    const sim = rig({ 20: 'pal_r20_aura_mastery' });
    const allyId = sim.addPlayer('warrior', 'Aura Ally');
    sim.partyInvite(allyId, sim.player.id);
    sim.partyAccept(allyId);
    const ally = sim.entities.get(allyId);
    if (!ally) throw new Error('missing ally');

    resolveNow(sim, 'aura_mastery', null);
    expect(sim.player.auras.filter((aura) => aura.id === 'aura_mastery')).toHaveLength(1);
    expect(ally.auras.filter((aura) => aura.id === 'aura_mastery')).toHaveLength(1);
  });

  it('adds Requital damage to outgoing auto-attacks and boosts both directions', () => {
    const sim = rig({ 20: 'pal_r20_aura_mastery' });
    const mob = target(sim);
    sim.ctx.applyAura(sim.player, {
      id: 'retribution_aura',
      name: 'Requital Aura',
      kind: 'thorns',
      value: 5,
      remaining: 0,
      duration: 0,
      sourceId: sim.player.id,
      school: 'holy',
    });

    const base = mob.hp;
    applyRequitalAutoAttack(sim.ctx, sim.player, mob);
    expect(base - mob.hp).toBe(5);
    const afterOutgoing = mob.hp;
    applyThornsReaction(sim.ctx, sim.player, mob);
    expect(afterOutgoing - mob.hp).toBe(5);

    resolveNow(sim, 'aura_mastery', null);
    const mastered = mob.hp;
    applyRequitalAutoAttack(sim.ctx, sim.player, mob);
    expect(mastered - mob.hp).toBe(15);
    const masteredReflect = mob.hp;
    applyThornsReaction(sim.ctx, sim.player, mob);
    expect(masteredReflect - mob.hp).toBe(15);
  });

  it('routes the Requital rider through a real landed auto-attack, never a weapon ability', () => {
    const sim = rig({});
    const mob = target(sim);
    sim.ctx.applyAura(sim.player, {
      id: 'retribution_aura',
      name: 'Requital Aura',
      kind: 'thorns',
      value: 5,
      remaining: 0,
      duration: 0,
      sourceId: sim.player.id,
      school: 'holy',
    });
    const rng = sim.ctx.rng as typeof sim.ctx.rng & {
      next(): number;
      chance(probability: number): boolean;
    };
    rng.next = () => 0.99;
    rng.chance = () => false;

    expect(meleeSwing(sim.ctx, sim.player, mob, 0, null, { autoAttack: true })).toBe(true);
    expect(sim.drainEvents()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'damage', ability: 'Requital Aura', amount: 5 }),
      ]),
    );

    meleeSwing(sim.ctx, sim.player, mob, 0, 'Final Edict', {});
    expect(sim.drainEvents()).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'damage', ability: 'Requital Aura' }),
      ]),
    );
  });
});
