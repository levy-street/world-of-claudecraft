// Warfare Season 2 ("Vanguard") set bonuses, group A: warrior, paladin,
// hunter, rogue and priest (docs/design/warfare-season-2.md). Every one of the
// 30 tiers is proven present at its piece count and absent one piece below,
// at the seam it rides: resolved-ability rewrites off abilitiesKnownAt, procs
// through the real proc engine, and the bespoke class-module bends through
// live casts on a real Sim. The last block pins every number in the tooltip
// text against the engine constants.
import { describe, expect, it } from 'vitest';
import { tonguesMult } from '../src/sim/combat/cc';
import { SHIELDVOW_CAST_SLOW_AURA_ID } from '../src/sim/combat/paladin_control';
import { onCastCompleted, onShieldConsumed } from '../src/sim/combat/talent_procs';
import { ABILITIES, abilitiesKnownAt } from '../src/sim/content/classes';
import { setBonusFlag } from '../src/sim/content/ignivar_set_bonuses';
import { VANGUARD_ITEM_SETS } from '../src/sim/content/vanguard_item_sets';
import * as V from '../src/sim/content/vanguard_set_bonuses_a';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { computeCharacterModifiers } from '../src/sim/set_bonus_mods';
import { Sim } from '../src/sim/sim';
import type { SimContext } from '../src/sim/sim_context';
import type { AbilityEffect, Aura, Entity, PlayerClass } from '../src/sim/types';
import { MAX_LEVEL } from '../src/sim/types';
import { expectDefined } from './helpers/defined';
import { EMPTY_TEST_WORLD } from './sim_shared';

// The five Season 2 slots, in the order pieces are put on.
const SET_SLOTS = ['helmet', 'shoulder', 'chest', 'legs', 'gloves'] as const;

type AnySim = Sim & { nextId: number; addEntity(entity: Entity): void };

function worn(setId: string, pieces: number): Partial<Record<string, string>> {
  const equipment: Partial<Record<string, string>> = {};
  for (const slot of SET_SLOTS.slice(0, pieces)) equipment[slot] = `${setId}_${slot}`;
  return equipment;
}

function modsFor(cls: PlayerClass, spec: string, setId: string, pieces: number) {
  return computeCharacterModifiers(cls, { spec, rows: {} }, MAX_LEVEL, worn(setId, pieces));
}

function resolvedEntry(
  cls: PlayerClass,
  spec: string,
  setId: string,
  pieces: number,
  abilityId: string,
) {
  const known = abilitiesKnownAt(cls, MAX_LEVEL, modsFor(cls, spec, setId, pieces));
  return expectDefined(
    known.find((k) => k.def.id === abilityId),
    `${abilityId} known`,
  );
}

/** A cooldown-cut 2pc: the resolved cooldown drops by `cut` at `pieces` and
 *  stays at base one piece below. */
function expectCooldownCut(
  cls: PlayerClass,
  spec: string,
  setId: string,
  pieces: number,
  abilityId: string,
  base: number,
  cut: number,
): void {
  expect(resolvedEntry(cls, spec, setId, pieces - 1, abilityId).cooldown, 'one short').toBe(base);
  expect(resolvedEntry(cls, spec, setId, pieces, abilityId).cooldown, 'at tier').toBe(base - cut);
}

function effectsOf(
  cls: PlayerClass,
  spec: string,
  setId: string,
  pieces: number,
  abilityId: string,
): AbilityEffect[] {
  return resolvedEntry(cls, spec, setId, pieces, abilityId).effects;
}

/** The proc engine against a fake context: the real talent_procs module
 *  with the wearer's real resolved mods. */
function procHarness(cls: PlayerClass, spec: string, setId: string, pieces: number) {
  const mods = modsFor(cls, spec, setId, pieces);
  const applied: { target: Entity; aura: Aura }[] = [];
  const p = {
    id: 1,
    kind: 'player',
    hp: 1000,
    maxHp: 1000,
    auras: [] as Aura[],
    cooldowns: new Map<string, number>(),
    dead: false,
  } as unknown as Entity;
  const ally = {
    id: 2,
    kind: 'player',
    hp: 500,
    maxHp: 500,
    auras: [] as Aura[],
  } as unknown as Entity;
  const ctx = {
    players: new Map([[1, { cls }]]),
    playerMods: () => mods,
    applyAura: (target: Entity, aura: Aura) => applied.push({ target, aura }),
    applyHeal: () => {},
    emit: () => {},
    entities: new Map([
      [1, p],
      [2, ally],
    ]),
  } as unknown as SimContext;
  return { mods, p, ally, ctx, applied };
}

function hasProc(cls: PlayerClass, spec: string, setId: string, pieces: number, id: string) {
  return modsFor(cls, spec, setId, pieces).procs.some((proc) => proc.id === id);
}

function makeSim(cls: PlayerClass, spec: string, seed = 11): AnySim {
  const sim = new Sim({
    seed,
    playerClass: cls,
    autoEquip: true,
    world: EMPTY_TEST_WORLD,
  }) as AnySim;
  sim.setPlayerLevel(MAX_LEVEL);
  expect(sim.setSpec(spec)).toBe(true);
  return sim;
}

function equipSet(sim: Sim, setId: string, pieces: number): void {
  for (const slot of SET_SLOTS.slice(0, pieces)) {
    sim.addItem(`${setId}_${slot}`, 1);
    sim.equipItem(`${setId}_${slot}`);
  }
  const meta = (
    sim as unknown as { players: Map<number, { equipment: Record<string, string> }> }
  ).players.get(sim.player.id);
  for (const slot of SET_SLOTS.slice(0, pieces)) {
    expect(meta?.equipment[slot], `${setId} ${slot} equipped`).toBe(`${setId}_${slot}`);
  }
}

function addMob(sim: AnySim, dz: number, dx = 0, template = 'forest_wolf'): Entity {
  const mob = createMob(sim.nextId++, expectDefined(MOBS[template], template), 20, {
    x: sim.player.pos.x + dx,
    y: sim.player.pos.y,
    z: sim.player.pos.z + dz,
  });
  mob.maxHp = 100_000;
  mob.hp = mob.maxHp;
  mob.hostile = true;
  mob.aiState = 'idle';
  mob.weapon.min = 0;
  mob.weapon.max = 0;
  mob.swingTimer = 1000;
  mob.moveSpeed = 0;
  sim.addEntity(mob);
  return mob;
}

function ticks(sim: Sim, n: number): void {
  for (let i = 0; i < n; i++) sim.tick();
}

function flag(cls: PlayerClass, spec: string, setId: string, pieces: number, tier: number) {
  return modsFor(cls, spec, setId, pieces).selected[setBonusFlag(setId, tier)];
}

// ---------------------------------------------------------------------------
describe('Warrior Season 2 sets', () => {
  it('Bladewake 2pc: Maiming Strike refunds 1 sec of Onrush, only at 2 pieces', () => {
    const id = 'set_vanguard_warrior_arms_2pc';
    expect(hasProc('warrior', 'arms', 'vanguard_warrior_arms', 1, id)).toBe(false);
    const { p, ctx } = procHarness('warrior', 'arms', 'vanguard_warrior_arms', 2);
    p.cooldowns.set('charge', 10);
    onCastCompleted(ctx, p, 'mortal_strike');
    expect(p.cooldowns.get('charge')).toBe(10 - V.VANGUARD_ARMS_2PC_ONRUSH_REFUND_SEC);
    const short = procHarness('warrior', 'arms', 'vanguard_warrior_arms', 1);
    short.p.cooldowns.set('charge', 10);
    onCastCompleted(short.ctx, short.p, 'mortal_strike');
    expect(short.p.cooldowns.get('charge')).toBe(10);
  });

  it('Bladewake 4pc: Onrush grants one Redhand empower stack, only at 4 pieces', () => {
    const empower = (pieces: number) =>
      effectsOf('warrior', 'arms', 'vanguard_warrior_arms', pieces, 'charge').find(
        (e) => e.type === 'selfBuff' && e.kind === 'overpower_charge',
      );
    expect(empower(3)).toBeUndefined();
    expect(empower(4)).toMatchObject({
      value: V.VANGUARD_ARMS_4PC_EMPOWER_PCT,
      duration: V.VANGUARD_ARMS_4PC_EMPOWER_DURATION_SEC,
    });

    // Live: Onrush lands the empower, and a following Maiming Strike eats it.
    const onrush = (pieces: number) => {
      const sim = makeSim('warrior', 'arms');
      equipSet(sim, 'vanguard_warrior_arms', pieces);
      const mob = addMob(sim, 15);
      sim.targetEntity(mob.id);
      sim.player.gcdRemaining = 0;
      sim.castAbility('charge');
      return sim.player.auras.find((a) => a.kind === 'overpower_charge');
    };
    expect(onrush(3)).toBeUndefined();
    const stack = expectDefined(onrush(4));
    expect(stack.value).toBe(V.VANGUARD_ARMS_4PC_EMPOWER_PCT);
    expect(stack.stacks).toBe(1);
  });

  it('Bloodmarch 2pc: Vaulting Charge cooldown 30 to 22, only at 2 pieces', () => {
    expectCooldownCut(
      'warrior',
      'fury',
      'vanguard_warrior_fury',
      2,
      'heroic_leap',
      30,
      V.VANGUARD_FURY_2PC_LEAP_COOLDOWN_CUT_SEC,
    );
  });

  it('Bloodmarch 4pc: landing Vaulting Charge Enrages, only at 4 pieces', () => {
    const leap = (pieces: number) => {
      const sim = makeSim('warrior', 'fury');
      equipSet(sim, 'vanguard_warrior_fury', pieces);
      const p = sim.player;
      p.gcdRemaining = 0;
      sim.castAbility('heroic_leap', p.id, { x: p.pos.x + 10, z: p.pos.z });
      expect(p.leap, 'flight armed').not.toBeNull();
      // Not at cast: the Enrage waits for the landing.
      expect(p.auras.some((a) => a.id === 'fury_enrage')).toBe(false);
      for (let i = 0; i < 25 && p.leap; i++) sim.tick();
      expect(p.leap).toBeNull();
      return p.auras.find((a) => a.id === 'fury_enrage');
    };
    expect(leap(3)).toBeUndefined();
    const enrage = expectDefined(leap(4));
    expect(enrage.kind).toBe('enrage');
    expect(enrage.duration).toBe(V.VANGUARD_FURY_4PC_ENRAGE_DURATION_SEC);
  });

  it('Ironmarch 2pc: Faultline cooldown 30 to 25, only at 2 pieces', () => {
    expectCooldownCut(
      'warrior',
      'prot',
      'vanguard_warrior_prot',
      2,
      'faultline',
      30,
      V.VANGUARD_PROT_2PC_FAULTLINE_COOLDOWN_CUT_SEC,
    );
  });

  it('Ironmarch 4pc: Faultline grants 10 percent damage reduction for 6 sec, only at 4 pieces', () => {
    const faultline = (pieces: number) => {
      const sim = makeSim('warrior', 'prot');
      equipSet(sim, 'vanguard_warrior_prot', pieces);
      const p = sim.player;
      p.resource = p.maxResource;
      p.gcdRemaining = 0;
      sim.castAbility('faultline');
      expect(p.cooldowns.has('faultline'), 'Faultline was cast').toBe(true);
      return p.auras.find((a) => a.kind === 'buff_dr');
    };
    expect(faultline(3)).toBeUndefined();
    const dr = expectDefined(faultline(4));
    expect(dr.value).toBe(V.VANGUARD_PROT_4PC_FAULTLINE_DR_PCT);
    expect(dr.duration).toBe(V.VANGUARD_PROT_4PC_FAULTLINE_DR_DURATION_SEC);
    expect(dr.name).toBe('Faultline');
    // The removed Shieldcrack refund stays gone.
    expect(
      hasProc('warrior', 'prot', 'vanguard_warrior_prot', 5, 'set_vanguard_warrior_prot_4pc'),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe('Paladin Season 2 sets', () => {
  it('Sunvigil 2pc: Life Covenant cooldown 90 to 60, only at 2 pieces', () => {
    expectCooldownCut(
      'paladin',
      'holy',
      'vanguard_paladin_holy',
      2,
      'life_covenant',
      90,
      V.VANGUARD_HOLY_PALADIN_2PC_COVENANT_COOLDOWN_CUT_SEC,
    );
  });

  it('Sunvigil 4pc: Life Covenant shields the ally for 8 percent of THEIR max health', () => {
    const run = (pieces: number) => {
      const { p, ally, ctx, applied } = procHarness(
        'paladin',
        'holy',
        'vanguard_paladin_holy',
        pieces,
      );
      onCastCompleted(ctx, p, 'life_covenant', ally);
      return applied.find((a) => a.aura.kind === 'absorb');
    };
    expect(run(3)).toBeUndefined();
    const shield = expectDefined(run(4));
    expect(shield.target.id).toBe(2);
    expect(shield.aura.value).toBe(Math.round(500 * V.VANGUARD_HOLY_PALADIN_4PC_SHIELD_PCT_MAX));
    expect(shield.aura.duration).toBe(V.VANGUARD_HOLY_PALADIN_4PC_SHIELD_DURATION_SEC);
    expect(shield.aura.name).toBe('Life Covenant');
  });

  it('Shieldvow 2pc: Oath Chain cooldown 18 to 16, only at 2 pieces', () => {
    expectCooldownCut(
      'paladin',
      'protection',
      'vanguard_paladin_protection',
      2,
      'oath_chain',
      18,
      V.VANGUARD_PROT_PALADIN_2PC_OATH_CHAIN_COOLDOWN_CUT_SEC,
    );
  });

  it('Shieldvow 4pc: Oath Chain slows the pulled enemy casts 30 percent and grants Solar Reprisal', () => {
    const chain = (pieces: number) => {
      const sim = makeSim('paladin', 'protection');
      equipSet(sim, 'vanguard_paladin_protection', pieces);
      sim.player.resource = sim.player.maxResource;
      sim.player.facing = 0;
      const mob = addMob(sim, 15);
      mob.castingAbility = 'fireball';
      mob.castRemaining = 2;
      mob.castTotal = 2;
      sim.targetEntity(mob.id);
      sim.castAbility('oath_chain');
      return { sim, mob };
    };
    const short = chain(3);
    expect(short.mob.auras.some((a) => a.kind === 'tongues')).toBe(false);
    expect(tonguesMult(short.mob)).toBe(1);
    expect(short.sim.player.auras.some((a) => a.kind === 'paladin_solar_reprisal')).toBe(false);

    const full = chain(4);
    expect(full.mob.auras.some((a) => a.id === 'oath_chain_pull')).toBe(true);
    const slow = expectDefined(full.mob.auras.find((a) => a.id === SHIELDVOW_CAST_SLOW_AURA_ID));
    expect(slow.kind).toBe('tongues');
    expect(slow.value).toBe(V.VANGUARD_PROT_PALADIN_4PC_CAST_SLOW_MULT);
    expect(slow.duration).toBe(V.VANGUARD_PROT_PALADIN_4PC_CAST_SLOW_DURATION_SEC);
    expect(slow.sourceId).toBe(full.sim.player.id);
    expect(tonguesMult(full.mob)).toBe(V.VANGUARD_PROT_PALADIN_4PC_CAST_SLOW_MULT);
    // No interrupt any more: the cast keeps going and no school is locked.
    expect(full.mob.castingAbility).toBe('fireball');
    expect(full.mob.auras.some((a) => a.kind === 'lockout')).toBe(false);
    expect(
      effectsOf('paladin', 'protection', 'vanguard_paladin_protection', 5, 'oath_chain').some(
        (e) => e.type === 'interrupt',
      ),
    ).toBe(false);
    expect(full.sim.player.auras.some((a) => a.kind === 'paladin_solar_reprisal')).toBe(true);
  });

  it('Shieldvow 4pc: no Solar Reprisal off an enemy that cannot be pulled', () => {
    const sim = makeSim('paladin', 'protection');
    equipSet(sim, 'vanguard_paladin_protection', 4);
    sim.player.resource = sim.player.maxResource;
    sim.player.facing = 0;
    // A practice dummy is a fixed combat anchor (pull_eligibility.ts), like a boss.
    const anchor = addMob(sim, 15, 0, 'training_dummy');
    sim.targetEntity(anchor.id);
    sim.castAbility('oath_chain');
    expect(sim.player.cooldowns.has('oath_chain'), 'the chain was cast').toBe(true);
    expect(sim.player.auras.some((a) => a.kind === 'paladin_solar_reprisal')).toBe(false);
    expect(anchor.auras.some((a) => a.kind === 'tongues')).toBe(false);
  });

  it("Lightbrand 2pc: Valkyr's Calling cooldown 60 to 45, only at 2 pieces", () => {
    expectCooldownCut(
      'paladin',
      'retribution',
      'vanguard_paladin_retribution',
      2,
      'valkyrs_calling',
      60,
      V.VANGUARD_RET_2PC_VALKYR_COOLDOWN_CUT_SEC,
    );
  });

  it("Lightbrand 4pc: Valkyr's Calling resets Final Edict, only at 4 pieces", () => {
    const run = (pieces: number) => {
      const { p, ctx } = procHarness(
        'paladin',
        'retribution',
        'vanguard_paladin_retribution',
        pieces,
      );
      p.cooldowns.set('final_edict', 7);
      onCastCompleted(ctx, p, 'valkyrs_calling');
      return p.cooldowns.get('final_edict');
    };
    expect(run(3)).toBe(7);
    expect(run(4)).toBeUndefined();
  });

  it('Lightbrand 4pc: the landing arms a 15 percent Final Edict that the next Edict spends', () => {
    const land = (pieces: number) => {
      const sim = makeSim('paladin', 'retribution', 5);
      equipSet(sim, 'vanguard_paladin_retribution', pieces);
      sim.player.resource = sim.player.maxResource;
      sim.player.facing = 0;
      const mob = addMob(sim, 12);
      sim.targetEntity(mob.id);
      sim.castAbility('valkyrs_calling');
      ticks(sim, 60);
      return { sim, mob };
    };
    const markerOf = (sim: Sim) =>
      sim.player.auras.find((a) => a.id === 'vanguard_lightbrand_edict');
    expect(markerOf(land(3).sim)).toBeUndefined();
    const armed = expectDefined(markerOf(land(4).sim));
    expect(armed.value).toBe(V.VANGUARD_RET_4PC_EDICT_DAMAGE_PCT);
    expect(armed.duration).toBe(V.VANGUARD_RET_4PC_EDICT_WINDOW_SEC);

    // Two identical wearers; the control drops its marker before the Edict.
    const edictDamage = (keepMarker: boolean) => {
      const { sim, mob } = land(4);
      if (!keepMarker) {
        sim.player.auras = sim.player.auras.filter((a) => a.id !== 'vanguard_lightbrand_edict');
      }
      sim.player.hitBonus = 1;
      sim.player.critChance = 0;
      sim.player.resource = sim.player.maxResource;
      sim.player.gcdRemaining = 0;
      sim.player.cooldowns.delete('final_edict');
      const before = mob.hp;
      sim.castAbility('final_edict');
      expect(markerOf(sim), 'the Edict spends the marker').toBeUndefined();
      return before - mob.hp;
    };
    const control = edictDamage(false);
    const empowered = edictDamage(true);
    expect(control).toBeGreaterThan(0);
    expect(empowered / control).toBeGreaterThan(1.12);
    expect(empowered / control).toBeLessThan(1.18);
  });
});

// ---------------------------------------------------------------------------
describe('Hunter Season 2 sets', () => {
  it('Packwarden 2pc: Rattling Shot cooldown 12 to 8, only at 2 pieces', () => {
    expectCooldownCut(
      'hunter',
      'beast_mastery',
      'vanguard_hunter_beast_mastery',
      2,
      'concussive_shot',
      12,
      V.VANGUARD_BM_2PC_RATTLING_COOLDOWN_CUT_SEC,
    );
  });

  it('Packwarden 4pc: Rattling Shot refunds 1 sec of Howling Rage, only at 4 pieces', () => {
    const run = (pieces: number) => {
      const { p, ctx } = procHarness(
        'hunter',
        'beast_mastery',
        'vanguard_hunter_beast_mastery',
        pieces,
      );
      p.cooldowns.set('bestial_wrath', 60);
      onCastCompleted(ctx, p, 'concussive_shot');
      return p.cooldowns.get('bestial_wrath');
    };
    expect(run(3)).toBe(60);
    expect(run(4)).toBe(60 - V.VANGUARD_BM_4PC_HOWLING_RAGE_REFUND_SEC);
  });

  it('Farsight 2pc: Trailbreak cooldown 15 to 11, only at 2 pieces', () => {
    expectCooldownCut(
      'hunter',
      'marksmanship',
      'vanguard_hunter_marksmanship',
      2,
      'trailbreak',
      15,
      V.VANGUARD_MM_2PC_TRAILBREAK_COOLDOWN_CUT_SEC,
    );
  });

  it('Farsight 4pc: Trailbreak makes the next Long Draw instant, once per 15 sec', () => {
    const run = (pieces: number) => {
      const harness = procHarness('hunter', 'marksmanship', 'vanguard_hunter_marksmanship', pieces);
      onCastCompleted(harness.ctx, harness.p, 'trailbreak');
      return harness;
    };
    expect(run(3).applied).toHaveLength(0);
    const { p, ctx, applied } = run(4);
    expect(applied).toHaveLength(1);
    const empower = applied[0].aura;
    expect(empower.kind).toBe('next_cast_instant');
    expect(empower.empowerAbilities).toEqual(['aimed_shot']);
    expect(empower.duration).toBe(V.VANGUARD_MM_4PC_INSTANT_WINDOW_SEC);
    // A second Trailbreak inside the internal cooldown grants nothing.
    onCastCompleted(ctx, p, 'trailbreak');
    expect(applied).toHaveLength(1);
    expect(p.procState?.icds.set_vanguard_hunter_marksmanship_4pc).toBe(V.VANGUARD_MM_4PC_ICD_SEC);
  });

  it('Snaretooth 2pc: Bloodhook cooldown 15 to 12, only at 2 pieces', () => {
    expectCooldownCut(
      'hunter',
      'survival',
      'vanguard_hunter_survival',
      2,
      'bloodhook',
      15,
      V.VANGUARD_SURVIVAL_2PC_BLOODHOOK_COOLDOWN_CUT_SEC,
    );
  });

  it('Snaretooth 4pc: a Bloodhook that arrives grants 1 Hunting Momentum', () => {
    const hook = (pieces: number) => {
      const sim = makeSim('hunter', 'survival', 2913);
      equipSet(sim, 'vanguard_hunter_survival', pieces);
      const mob = addMob(sim, 12);
      sim.targetEntity(mob.id);
      sim.player.resource = sim.player.maxResource;
      sim.castAbility('bloodhook');
      ticks(sim, 40);
      expect(
        mob.auras.some((a) => a.id === 'bloodhook_bleed'),
        'the hook arrived',
      ).toBe(true);
      return sim.player.auras.find((a) => a.id === 'hunting_momentum');
    };
    expect(hook(3)).toBeUndefined();
    const momentum = expectDefined(hook(4));
    expect(momentum.stacks).toBe(V.VANGUARD_SURVIVAL_4PC_MOMENTUM_STACKS);
    expect(momentum.duration).toBe(8);
  });
});

// ---------------------------------------------------------------------------
describe('Rogue Season 2 sets', () => {
  function rogueAt(spec: string, setId: string, pieces: number) {
    const sim = makeSim('rogue', spec, 23);
    equipSet(sim, setId, pieces);
    const mob = addMob(sim, 2);
    sim.player.facing = 0;
    sim.targetEntity(mob.id);
    sim.player.resource = sim.player.maxResource;
    sim.player.hitBonus = 1;
    return { sim, mob };
  }

  /** Combo points one LANDED cast of the builder awards: the hit table can
   *  dodge a frontal strike, so retry (fresh GCD, energy, combo) until a
   *  strike lands; a dodge awards nothing and is not what is measured. */
  function landedComboGain(sim: Sim, abilityId: string, abilityName: string): number {
    for (let attempt = 0; attempt < 12; attempt++) {
      sim.player.gcdRemaining = 0;
      sim.player.resource = sim.player.maxResource;
      sim.player.comboPoints = 0;
      sim.castAbility(abilityId);
      const landed = sim
        .tick()
        .some(
          (e) =>
            e.type === 'damage' &&
            e.sourceId === sim.player.id &&
            e.ability === abilityName &&
            e.amount > 0,
        );
      if (landed) return sim.player.comboPoints;
    }
    throw new Error(`${abilityId} never landed`);
  }

  it('Nightcut 2pc: Low Blow costs 10 less Energy, only at 2 pieces', () => {
    const setId = 'vanguard_rogue_assassination';
    const base = V.VANGUARD_ASSASSINATION_LOW_BLOW_BASE_ENERGY;
    expect(expectDefined(ABILITIES.kidney_shot).cost, 'authored base cost').toBe(base);
    const entry = (pieces: number) =>
      resolvedEntry('rogue', 'assassination', setId, pieces, 'kidney_shot');
    expect(entry(1).cost, 'one short').toBe(base);
    expect(entry(2).cost, 'at tier').toBe(base - V.VANGUARD_ASSASSINATION_2PC_LOW_BLOW_ENERGY_CUT);
    // The stun's cooldown is no longer cut.
    expect(entry(5).cooldown).toBe(20);

    // Live: the cast spends the resolved cost.
    const spent = (pieces: number) => {
      const { sim } = rogueAt('assassination', setId, pieces);
      sim.player.comboPoints = 1;
      const before = sim.player.resource;
      sim.castAbility('kidney_shot');
      expect(sim.player.cooldowns.has('kidney_shot'), 'Low Blow was cast').toBe(true);
      return before - sim.player.resource;
    };
    expect(spent(1)).toBe(base);
    expect(spent(2)).toBe(base - V.VANGUARD_ASSASSINATION_2PC_LOW_BLOW_ENERGY_CUT);
  });

  it('Nightcut 4pc: Low Blow arms a 6 sec sure crit, only at 4 pieces', () => {
    const lowBlow = (pieces: number) => {
      const { sim } = rogueAt('assassination', 'vanguard_rogue_assassination', pieces);
      sim.player.comboPoints = 1;
      sim.castAbility('kidney_shot');
      expect(sim.player.cooldowns.has('kidney_shot'), 'Low Blow was cast').toBe(true);
      return sim.player.auras.find((a) => a.kind === 'next_attack_crit');
    };
    expect(lowBlow(3)).toBeUndefined();
    const crit = expectDefined(lowBlow(4));
    expect(crit.duration).toBe(V.VANGUARD_ASSASSINATION_4PC_CRIT_WINDOW_SEC);
  });

  it('Brawlmark 2pc: Swift Heels cooldown 300 to 240, only at 2 pieces', () => {
    expectCooldownCut(
      'rogue',
      'combat',
      'vanguard_rogue_combat',
      2,
      'sprint',
      300,
      V.VANGUARD_COMBAT_2PC_SWIFT_HEELS_COOLDOWN_CUT_SEC,
    );
  });

  it('Brawlmark 4pc: Wicked Slash awards 1 more combo point while Swift Heels runs', () => {
    const slash = (pieces: number, sprinting: boolean) => {
      const { sim } = rogueAt('combat', 'vanguard_rogue_combat', pieces);
      if (sprinting) {
        sim.castAbility('sprint');
        expect(sim.player.auras.some((a) => a.id === 'sprint')).toBe(true);
        sim.player.gcdRemaining = 0;
      }
      return landedComboGain(sim, 'sinister_strike', 'Wicked Slash');
    };
    expect(slash(3, true)).toBe(1);
    expect(slash(4, false)).toBe(1);
    expect(slash(4, true)).toBe(1 + V.VANGUARD_COMBAT_4PC_BONUS_COMBO);
  });

  it('Shadewalk 2pc: Smokefade cooldown 300 to 240, only at 2 pieces', () => {
    expectCooldownCut(
      'rogue',
      'subtlety',
      'vanguard_rogue_subtlety',
      2,
      'vanish',
      300,
      V.VANGUARD_SUBTLETY_2PC_SMOKEFADE_COOLDOWN_CUT_SEC,
    );
  });

  it('Shadewalk 4pc: a Gut Punch from Smokefade awards 2 more combo points', () => {
    const gutPunch = (pieces: number) => {
      const { sim, mob } = rogueAt('subtlety', 'vanguard_rogue_subtlety', pieces);
      sim.castAbility('vanish');
      expect(sim.player.auras.some((a) => a.id === 'vanish' && a.kind === 'stealth')).toBe(true);
      // Smokefade drops the current target; pick the mob back up from stealth.
      sim.targetEntity(mob.id);
      sim.player.gcdRemaining = 0;
      sim.player.comboPoints = 0;
      sim.castAbility('cheap_shot');
      expect(
        mob.auras.some((a) => a.kind === 'stun'),
        'the Gut Punch landed',
      ).toBe(true);
      return sim.player.comboPoints;
    };
    expect(gutPunch(3)).toBe(2);
    expect(gutPunch(4)).toBe(2 + V.VANGUARD_SUBTLETY_4PC_BONUS_COMBO);
  });

  it('Shadewalk 4pc: a Gut Punch from plain Duskveil awards only the base 2', () => {
    const { sim, mob } = rogueAt('subtlety', 'vanguard_rogue_subtlety', 4);
    sim.castAbility('stealth');
    expect(sim.player.auras.some((a) => a.id === 'stealth' && a.kind === 'stealth')).toBe(true);
    sim.targetEntity(mob.id);
    sim.player.gcdRemaining = 0;
    sim.player.comboPoints = 0;
    sim.castAbility('cheap_shot');
    expect(
      mob.auras.some((a) => a.kind === 'stun'),
      'the Gut Punch landed',
    ).toBe(true);
    expect(sim.player.comboPoints).toBe(2);
  });
});

// ---------------------------------------------------------------------------
describe('Priest Season 2 sets', () => {
  it('Veilpsalm 2pc: Terror Canticle cooldown 30 to 27, only at 2 pieces', () => {
    expectCooldownCut(
      'priest',
      'discipline',
      'vanguard_priest_discipline',
      2,
      'psychic_scream',
      30,
      V.VANGUARD_DISC_2PC_CANTICLE_COOLDOWN_CUT_SEC,
    );
  });

  it('Veilpsalm 4pc: a consumed Psalm speeds the SHIELDED ally 20 percent for 3 sec', () => {
    const consume = (pieces: number) => {
      const sim = makeSim('priest', 'discipline');
      equipSet(sim, 'vanguard_priest_discipline', pieces);
      const id = sim.addPlayer('warrior', 'Warded');
      sim.setPlayerLevel(MAX_LEVEL, id);
      const ally = expectDefined(sim.entities.get(id));
      ally.pos.x = sim.player.pos.x + 4;
      ally.pos.z = sim.player.pos.z;
      sim.partyInvite(id, sim.player.id);
      sim.partyAccept(id);
      sim.player.resource = sim.player.maxResource;
      sim.targetEntity(ally.id);
      sim.castAbility('power_word_shield');
      const shield = expectDefined(
        ally.auras.find((a) => a.id === 'power_word_shield' && a.kind === 'absorb'),
        'the Psalm landed',
      );
      const mob = addMob(sim, 8);
      sim.ctx.dealDamage(mob, ally, shield.value + 10, false, 'physical', 'Bite', 'hit');
      expect(
        ally.auras.some((a) => a.id === 'power_word_shield'),
        'the Psalm was fully consumed',
      ).toBe(false);
      return { sim, ally };
    };
    const speedOf = (e: Entity) => e.auras.find((a) => a.kind === 'buff_speed');
    const short = consume(3);
    expect(speedOf(short.ally)).toBeUndefined();

    const full = consume(4);
    const burst = expectDefined(speedOf(full.ally));
    expect(burst.id).toBe('set_vanguard_priest_discipline_4pc');
    expect(burst.value).toBe(V.VANGUARD_DISC_4PC_SPEED_MULT);
    expect(burst.duration).toBe(V.VANGUARD_DISC_4PC_SPEED_DURATION_SEC);
    expect(burst.sourceId).toBe(full.sim.player.id);
    // It lands on the shielded ally, never the priest.
    expect(speedOf(full.sim.player)).toBeUndefined();
  });

  it('Veilpsalm 4pc: the speed burst cannot occur more than once every 8 sec', () => {
    const { p, ally, ctx, applied } = procHarness(
      'priest',
      'discipline',
      'vanguard_priest_discipline',
      4,
    );
    onShieldConsumed(ctx, p, 'power_word_shield', ally);
    expect(applied.filter((a) => a.aura.kind === 'buff_speed').map((a) => a.target.id)).toEqual([
      2,
    ]);
    onShieldConsumed(ctx, p, 'power_word_shield', ally);
    expect(applied.filter((a) => a.aura.kind === 'buff_speed')).toHaveLength(1);
    expect(p.procState?.icds.set_vanguard_priest_discipline_4pc).toBe(V.VANGUARD_DISC_4PC_ICD_SEC);
    // The removed Terror Canticle refund stays gone.
    const fresh = procHarness('priest', 'discipline', 'vanguard_priest_discipline', 4);
    fresh.p.cooldowns.set('psychic_scream', 20);
    onShieldConsumed(fresh.ctx, fresh.p, 'power_word_shield', fresh.ally);
    expect(fresh.p.cooldowns.get('psychic_scream')).toBe(20);
  });

  it('Gracewing 2pc: Veilstep cooldown 18 to 12, only at 2 pieces', () => {
    expectCooldownCut(
      'priest',
      'holy',
      'vanguard_priest_holy',
      2,
      'veilstep',
      18,
      V.VANGUARD_HOLY_PRIEST_2PC_VEILSTEP_COOLDOWN_CUT_SEC,
    );
  });

  it('Gracewing 4pc: Veilstep shields the priest for 8 percent of max health', () => {
    const run = (pieces: number) => {
      const { p, ally, ctx, applied } = procHarness(
        'priest',
        'holy',
        'vanguard_priest_holy',
        pieces,
      );
      // Even with an ally targeted, the shield lands on the priest.
      onCastCompleted(ctx, p, 'veilstep', ally);
      return applied.find((a) => a.aura.kind === 'absorb');
    };
    expect(run(3)).toBeUndefined();
    const shield = expectDefined(run(4));
    expect(shield.target.id).toBe(1);
    expect(shield.aura.value).toBe(Math.round(1000 * V.VANGUARD_HOLY_PRIEST_4PC_SHIELD_PCT_MAX));
    expect(shield.aura.duration).toBe(V.VANGUARD_HOLY_PRIEST_4PC_SHIELD_DURATION_SEC);
  });

  it('Duskhymn 2pc: Litany of Woe slows its target for the channel, only at 2 pieces', () => {
    const channel = (pieces: number) => {
      const sim = makeSim('priest', 'shadow');
      equipSet(sim, 'vanguard_priest_shadow', pieces);
      sim.player.resource = sim.player.maxResource;
      sim.player.facing = 0;
      const mob = addMob(sim, 10);
      sim.targetEntity(mob.id);
      sim.castAbility('mind_flay');
      expect(sim.player.castingAbility, 'channeling').toBe('mind_flay');
      return { sim, mob };
    };
    const slowOf = (mob: Entity) => mob.auras.find((a) => a.id === 'vanguard_duskhymn_slow');
    const short = channel(1);
    ticks(short.sim, 10);
    expect(slowOf(short.mob)).toBeUndefined();

    const full = channel(2);
    const slow = expectDefined(slowOf(full.mob));
    expect(slow.kind).toBe('slow');
    expect(slow.value).toBe(V.VANGUARD_SHADOW_2PC_SLOW_MULT);
    ticks(full.sim, 30);
    expect(full.sim.player.castingAbility, 'still channeling').toBe('mind_flay');
    expect(slowOf(full.mob)).toBeDefined();
    // The slow ends with the channel.
    for (let i = 0; i < 80 && full.sim.player.castingAbility === 'mind_flay'; i++) full.sim.tick();
    expect(full.sim.player.castingAbility).toBeNull();
    expect(slowOf(full.mob)).toBeUndefined();
  });

  it('Duskhymn 2pc: cancelling the channel early strips the slow', () => {
    const sim = makeSim('priest', 'shadow');
    equipSet(sim, 'vanguard_priest_shadow', 2);
    sim.player.resource = sim.player.maxResource;
    sim.player.facing = 0;
    const mob = addMob(sim, 10);
    sim.targetEntity(mob.id);
    sim.castAbility('mind_flay');
    ticks(sim, 5);
    expect(mob.auras.some((a) => a.id === 'vanguard_duskhymn_slow')).toBe(true);
    (sim as unknown as { ctx: SimContext }).ctx.cancelCast(sim.player);
    expect(sim.player.castingAbility).toBeNull();
    expect(mob.auras.some((a) => a.id === 'vanguard_duskhymn_slow')).toBe(false);
  });

  it('Duskhymn 2pc: the priest dying mid-channel strips the slow too', () => {
    // The death hub clears the cast without going through cancelCast.
    const sim = makeSim('priest', 'shadow');
    equipSet(sim, 'vanguard_priest_shadow', 2);
    sim.player.resource = sim.player.maxResource;
    sim.player.facing = 0;
    const mob = addMob(sim, 10);
    sim.targetEntity(mob.id);
    sim.castAbility('mind_flay');
    ticks(sim, 5);
    expect(mob.auras.some((a) => a.id === 'vanguard_duskhymn_slow')).toBe(true);
    const host = sim as unknown as {
      dealDamage(...args: unknown[]): void;
    };
    host.dealDamage(null, sim.player, sim.player.maxHp + 100, false, 'physical', null, 'hit', true);
    expect(sim.player.dead).toBe(true);
    expect(mob.auras.some((a) => a.id === 'vanguard_duskhymn_slow')).toBe(false);
  });

  it('Duskhymn 4pc: Call Tithefiend shields the priest for 10 percent of max health', () => {
    const run = (pieces: number) => {
      const { p, ctx, applied } = procHarness('priest', 'shadow', 'vanguard_priest_shadow', pieces);
      onCastCompleted(ctx, p, 'summon_tithefiend');
      return applied.find((a) => a.aura.kind === 'absorb');
    };
    expect(run(3)).toBeUndefined();
    const shield = expectDefined(run(4));
    expect(shield.target.id).toBe(1);
    expect(shield.aura.value).toBe(Math.round(1000 * V.VANGUARD_SHADOW_4PC_SHIELD_PCT_MAX));
    expect(shield.aura.duration).toBe(V.VANGUARD_SHADOW_4PC_SHIELD_DURATION_SEC);
  });
});

// ---------------------------------------------------------------------------
describe('Season 2 group A tooltips match the engine constants', () => {
  const pct = (fraction: number) => Math.round(fraction * 100);
  // Every number the tooltip prints, in reading order, derived from the
  // constants the engine reads. [2-piece numbers, 4-piece numbers].
  const EXPECTED: Record<string, [number[], number[]]> = {
    vanguard_warrior_arms: [
      [V.VANGUARD_ARMS_2PC_ONRUSH_REFUND_SEC],
      [pct(V.VANGUARD_ARMS_4PC_EMPOWER_PCT)],
    ],
    vanguard_warrior_fury: [[V.VANGUARD_FURY_2PC_LEAP_COOLDOWN_CUT_SEC], []],
    vanguard_warrior_prot: [
      [V.VANGUARD_PROT_2PC_FAULTLINE_COOLDOWN_CUT_SEC],
      [pct(V.VANGUARD_PROT_4PC_FAULTLINE_DR_PCT), V.VANGUARD_PROT_4PC_FAULTLINE_DR_DURATION_SEC],
    ],
    vanguard_paladin_holy: [
      [V.VANGUARD_HOLY_PALADIN_2PC_COVENANT_COOLDOWN_CUT_SEC],
      [
        pct(V.VANGUARD_HOLY_PALADIN_4PC_SHIELD_PCT_MAX),
        V.VANGUARD_HOLY_PALADIN_4PC_SHIELD_DURATION_SEC,
      ],
    ],
    vanguard_paladin_protection: [
      [V.VANGUARD_PROT_PALADIN_2PC_OATH_CHAIN_COOLDOWN_CUT_SEC],
      [
        pct(V.VANGUARD_PROT_PALADIN_4PC_CAST_SLOW_MULT - 1),
        V.VANGUARD_PROT_PALADIN_4PC_CAST_SLOW_DURATION_SEC,
      ],
    ],
    vanguard_paladin_retribution: [
      [V.VANGUARD_RET_2PC_VALKYR_COOLDOWN_CUT_SEC],
      [V.VANGUARD_RET_4PC_EDICT_WINDOW_SEC, pct(V.VANGUARD_RET_4PC_EDICT_DAMAGE_PCT)],
    ],
    vanguard_hunter_beast_mastery: [
      [V.VANGUARD_BM_2PC_RATTLING_COOLDOWN_CUT_SEC],
      [V.VANGUARD_BM_4PC_HOWLING_RAGE_REFUND_SEC],
    ],
    vanguard_hunter_marksmanship: [
      [V.VANGUARD_MM_2PC_TRAILBREAK_COOLDOWN_CUT_SEC],
      [V.VANGUARD_MM_4PC_INSTANT_WINDOW_SEC, V.VANGUARD_MM_4PC_ICD_SEC],
    ],
    vanguard_hunter_survival: [
      [V.VANGUARD_SURVIVAL_2PC_BLOODHOOK_COOLDOWN_CUT_SEC],
      [V.VANGUARD_SURVIVAL_4PC_MOMENTUM_STACKS],
    ],
    vanguard_rogue_assassination: [
      [V.VANGUARD_ASSASSINATION_2PC_LOW_BLOW_ENERGY_CUT],
      [V.VANGUARD_ASSASSINATION_4PC_CRIT_WINDOW_SEC],
    ],
    vanguard_rogue_combat: [
      [V.VANGUARD_COMBAT_2PC_SWIFT_HEELS_COOLDOWN_CUT_SEC],
      [V.VANGUARD_COMBAT_4PC_BONUS_COMBO],
    ],
    vanguard_rogue_subtlety: [
      [V.VANGUARD_SUBTLETY_2PC_SMOKEFADE_COOLDOWN_CUT_SEC],
      [V.VANGUARD_SUBTLETY_4PC_BONUS_COMBO],
    ],
    vanguard_priest_discipline: [
      [V.VANGUARD_DISC_2PC_CANTICLE_COOLDOWN_CUT_SEC],
      [
        pct(V.VANGUARD_DISC_4PC_SPEED_MULT - 1),
        V.VANGUARD_DISC_4PC_SPEED_DURATION_SEC,
        V.VANGUARD_DISC_4PC_ICD_SEC,
      ],
    ],
    vanguard_priest_holy: [
      [V.VANGUARD_HOLY_PRIEST_2PC_VEILSTEP_COOLDOWN_CUT_SEC],
      [
        pct(V.VANGUARD_HOLY_PRIEST_4PC_SHIELD_PCT_MAX),
        V.VANGUARD_HOLY_PRIEST_4PC_SHIELD_DURATION_SEC,
      ],
    ],
    vanguard_priest_shadow: [
      [pct(1 - V.VANGUARD_SHADOW_2PC_SLOW_MULT)],
      [pct(V.VANGUARD_SHADOW_4PC_SHIELD_PCT_MAX), V.VANGUARD_SHADOW_4PC_SHIELD_DURATION_SEC],
    ],
  };

  it('covers exactly the 15 group A sets, each with a 2 and a 4 piece engine tier', () => {
    expect(Object.keys(V.VANGUARD_BONUSES_A).sort()).toEqual(Object.keys(EXPECTED).sort());
    for (const [setId, tiers] of Object.entries(V.VANGUARD_BONUSES_A)) {
      expect(
        tiers.map((t) => t.pieces),
        setId,
      ).toEqual([2, 4]);
      expect(
        VANGUARD_ITEM_SETS[setId]?.bonuses.map((b) => b.pieces),
        setId,
      ).toEqual([2, 4]);
    }
  });

  it('every printed number is the engine constant', () => {
    for (const [setId, [two, four]] of Object.entries(EXPECTED)) {
      const set = expectDefined(VANGUARD_ITEM_SETS[setId], setId);
      const numbers = (text: string) => (text.match(/\d+(?:\.\d+)?/g) ?? []).map(Number);
      expect(numbers(set.bonuses[0].text ?? ''), `${setId} 2pc`).toEqual(two);
      expect(numbers(set.bonuses[1].text ?? ''), `${setId} 4pc`).toEqual(four);
    }
  });

  it('the cooldown-cut 2pcs print the resolved cut against the live base cooldown', () => {
    const cuts: [PlayerClass, string, string, string, number][] = [
      ['warrior', 'fury', 'vanguard_warrior_fury', 'heroic_leap', 30],
      ['warrior', 'prot', 'vanguard_warrior_prot', 'faultline', 30],
      ['paladin', 'holy', 'vanguard_paladin_holy', 'life_covenant', 90],
      ['paladin', 'protection', 'vanguard_paladin_protection', 'oath_chain', 18],
      ['paladin', 'retribution', 'vanguard_paladin_retribution', 'valkyrs_calling', 60],
      ['hunter', 'beast_mastery', 'vanguard_hunter_beast_mastery', 'concussive_shot', 12],
      ['hunter', 'marksmanship', 'vanguard_hunter_marksmanship', 'trailbreak', 15],
      ['hunter', 'survival', 'vanguard_hunter_survival', 'bloodhook', 15],
      ['rogue', 'combat', 'vanguard_rogue_combat', 'sprint', 300],
      ['rogue', 'subtlety', 'vanguard_rogue_subtlety', 'vanish', 300],
      ['priest', 'discipline', 'vanguard_priest_discipline', 'psychic_scream', 30],
      ['priest', 'holy', 'vanguard_priest_holy', 'veilstep', 18],
    ];
    for (const [cls, spec, setId, abilityId, base] of cuts) {
      const printed = EXPECTED[setId][0][0];
      expect(resolvedEntry(cls, spec, setId, 0, abilityId).cooldown, setId).toBe(base);
      expect(resolvedEntry(cls, spec, setId, 2, abilityId).cooldown, setId).toBe(base - printed);
    }
  });

  it('the Bloodmarch 4pc Enrage lasts as long as the base Enrage it copies', () => {
    const bloodletting = effectsOf('warrior', 'fury', 'vanguard_warrior_fury', 0, 'bloodthirst');
    const base = expectDefined(bloodletting.find((e) => e.type === 'enrageChance')) as {
      duration: number;
    };
    expect(V.VANGUARD_FURY_4PC_ENRAGE_DURATION_SEC).toBe(base.duration);
    expect(flag('warrior', 'fury', 'vanguard_warrior_fury', 4, 4)).toBe(true);
    expect(flag('warrior', 'fury', 'vanguard_warrior_fury', 3, 4)).toBeUndefined();
  });
});
