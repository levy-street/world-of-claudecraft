// Shaman Crucible set bonuses (docs/prd/ignivar-set-bonus-final.md): each
// bonus proven at the seam it rides. Stormkindled 2pc/4pc are flag-gated
// constant bends at the Pyrebrand grant site and the ONE vent-multiplier
// read; Warspirit Emberscale 2pc is the widened-steps call-site selection in
// the auto-attack shell and 4pc a RESOLVED dmgPct row whose 0.51 value is
// derived from the REAL additive baseline (0.6 spec row + 0.1 Skyrend
// mastery = 1.7, so delivered is exactly the printed 30 percent); Stonehearth
// 2pc is the consume-order-safe free Stormcast Mending Waters plus the
// cast-scoped whole-heal multiplier and 4pc the rng-free cadence-completion
// heal; Springmender 2pc is a RESOLVED cooldownFlat rewrite the parallel
// charge model reads, and 4pc the bespoke fourth chain hop plus the
// chain-scoped 150 percent harvest. Non-wearer rng stays byte-identical
// everywhere; the one wearer-only draw (the fourth hop's heal-crit roll) is
// the set doc's disclosed extra hop.
import { describe, expect, it } from 'vitest';
import {
  consumeMendingCurrent,
  MENDING_CURRENT_ID,
  unleashMendingCurrent,
} from '../src/sim/combat/shaman_spiritmend';
import { PRIMAL_EXALTATION_ID, SHAMAN_TALENT_IDS } from '../src/sim/combat/shaman_talents';
import {
  addThunderCharges,
  armPrimalMastery,
  THUNDER_CHARGE_CAP,
  thunderCharges,
  thundercallDamageMultiplier,
} from '../src/sim/combat/shaman_thundercall';
import { PYREBRAND_UNLEASH_THUNDER } from '../src/sim/combat/shaman_unleash_weapon';
import {
  advanceWarspiritCadence,
  applyWarspiritPosture,
  onStormcastConsumed,
  STORMCAST_CHEAP_ID,
  STORMCAST_ID,
  warspiritCadence,
} from '../src/sim/combat/shaman_warspirit';
import { abilitiesKnownAt } from '../src/sim/content/classes';
import {
  SPRINGMENDER_2PC_TIDECALL_COOLDOWN_CUT_SEC,
  SPRINGMENDER_4PC_BONUS_JUMPS,
  SPRINGMENDER_4PC_CHAIN_HARVEST_MULT,
  STONEHEARTH_2PC_MENDING_HEAL_BONUS,
  STONEHEARTH_4PC_CADENCE_HEAL_PCT_MAX,
  STORMKINDLED_2PC_UNLEASH_THUNDER,
  STORMKINDLED_4PC_EARTHEN_JOLT_BONUS_PER_CHARGE,
  setBonusFlag,
  WARSPIRIT_EMBERSCALE_2PC_CADENCE_STEPS,
  WARSPIRIT_EMBERSCALE_4PC_STORMSTRIKE_DMG_PCT,
} from '../src/sim/content/ignivar_set_bonuses';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { computeCharacterModifiers } from '../src/sim/set_bonus_mods';
import { Sim } from '../src/sim/sim';
import { resolveTalentHitMult } from '../src/sim/talent_hit_mult';
import type { Aura, Entity, SimEvent } from '../src/sim/types';
import { expectDefined } from './helpers/defined';

const SET_SLOTS = ['helmet', 'shoulder', 'chest', 'gloves', 'legs'] as const;

function worn(setId: string, pieces: number): Partial<Record<string, string>> {
  const equipment: Partial<Record<string, string>> = {};
  for (const slot of SET_SLOTS.slice(0, pieces)) equipment[slot] = `${setId}_${slot}`;
  return equipment;
}

function shamanMods(spec: string, equipment: Partial<Record<string, string>>) {
  return computeCharacterModifiers('shaman', { spec, rows: {} }, 25, equipment);
}

function equipSet(sim: Sim, setId: string, pieces: number): void {
  for (const slot of SET_SLOTS.slice(0, pieces)) {
    sim.addItem(`${setId}_${slot}`, 1);
    sim.equipItem(`${setId}_${slot}`);
  }
}

function liveShaman(seed: number, spec: 'elemental' | 'enhancement' | 'restoration'): Sim {
  const sim = new Sim({ seed, playerClass: 'shaman', autoEquip: true });
  sim.setPlayerLevel(20);
  expect(sim.setSpec(spec)).toBe(true);
  return sim;
}

function addHostileMob(sim: Sim, distance = 3): Entity {
  const host = sim as Sim & { nextId: number; addEntity(entity: Entity): void };
  const mob = createMob(host.nextId++, MOBS.forest_wolf, 20, {
    x: sim.player.pos.x,
    y: sim.player.pos.y,
    z: sim.player.pos.z + distance,
  });
  mob.maxHp = 999_999;
  mob.hp = mob.maxHp;
  mob.hostile = true;
  mob.aiState = 'idle';
  mob.swingTimer = 999;
  host.addEntity(mob);
  return mob;
}

function addAlly(sim: Sim, name: string, offsetZ: number): Entity {
  const id = sim.addPlayer('warrior', name);
  sim.setPlayerLevel(20, id);
  const ally = expectDefined(sim.entities.get(id));
  ally.pos.x = sim.player.pos.x;
  ally.pos.z = sim.player.pos.z + offsetZ;
  sim.partyInvite(id, sim.player.id);
  sim.partyAccept(id);
  return ally;
}

/** Drives one landed Ancestral Strike through the REAL auto-attack shell (the
 *  call site that selects 2 vs 3 cadence steps for wearers). */
function landedAncestralStrike(sim: Sim, shaman: Entity, target: Entity): void {
  const host = sim as unknown as {
    meleeSwing(
      attacker: Entity,
      defender: Entity,
      bonus: number,
      ability: string | null,
      opts: { cannotBeDodged: boolean },
    ): boolean;
  };
  for (let attempt = 0; attempt < 20; attempt++) {
    if (host.meleeSwing(shaman, target, 0, 'Ancestral Strike', { cannotBeDodged: true })) return;
  }
  throw new Error('could not land an Ancestral Strike');
}

/** Direct-heal heal2 events, matched by DISPLAY name: applyHeal's emit
 *  carries the ability NAME in `ability` (the optional abilityId field is set
 *  only on HoT tick/application emits, never on a direct heal). */
function heal2Events(events: readonly SimEvent[], abilityName: string) {
  return events.filter(
    (event): event is Extract<SimEvent, { type: 'heal2' }> =>
      event.type === 'heal2' && event.ability === abilityName,
  );
}

describe('shaman Crucible sets: the resolver registration', () => {
  it('registers both tiers per worn set and nothing one piece short', () => {
    for (const [setId, spec] of [
      ['stormkindled', 'elemental'],
      ['warspirit_emberscale', 'enhancement'],
      ['stonehearth', 'enhancement'],
      ['springmender', 'restoration'],
    ] as const) {
      const four = shamanMods(spec, worn(setId, 4));
      expect(four.selected[setBonusFlag(setId, 2)], setId).toBe(true);
      expect(four.selected[setBonusFlag(setId, 4)], setId).toBe(true);
      const oneShort = shamanMods(spec, worn(setId, 1));
      expect(oneShort.selected[setBonusFlag(setId, 2)], setId).toBeUndefined();
    }
  });

  it('only the caster and healer 2pcs carry the pushback rider', () => {
    expect(shamanMods('elemental', worn('stormkindled', 2)).global.castPushbackReduction).toBe(1);
    expect(shamanMods('restoration', worn('springmender', 2)).global.castPushbackReduction).toBe(1);
    // The two melee sets deliberately carry NO rider.
    expect(
      shamanMods('enhancement', worn('warspirit_emberscale', 2)).global.castPushbackReduction,
    ).toBe(0);
    expect(shamanMods('enhancement', worn('stonehearth', 2)).global.castPushbackReduction).toBe(0);
  });
});

describe('Stormkindled 2pc: Unleash Weapon on Pyrebrand grants 3 Thunder', () => {
  function unleashThunder(wearer: boolean, banked = 0): number {
    const sim = liveShaman(733, 'elemental');
    if (wearer) equipSet(sim, 'stormkindled', 2);
    const mob = addHostileMob(sim);
    sim.player.resource = sim.player.maxResource;
    sim.castAbility('flametongue_weapon');
    if (banked > 0) addThunderCharges(sim.ctx, sim.player, banked);
    sim.player.gcdRemaining = 0;
    sim.player.resource = sim.player.maxResource;
    sim.targetEntity(mob.id);
    sim.castAbility('unleash_weapon');
    return thunderCharges(sim.player);
  }

  it('grants 3 at the live grant site for wearers (control 2)', () => {
    expect(unleashThunder(true)).toBe(STORMKINDLED_2PC_UNLEASH_THUNDER);
    expect(unleashThunder(false)).toBe(PYREBRAND_UNLEASH_THUNDER);
  });

  it('overcaps partially at the 5-charge bank (the disclosed waste)', () => {
    expect(unleashThunder(true, 4)).toBe(THUNDER_CHARGE_CAP);
  });
});

describe("Stormkindled 4pc: Earthen Jolt's per-Thunder bonus rises to 30 percent", () => {
  function ventMultiplier(wearer: boolean, primal: boolean, abilityId = 'earth_shock'): number {
    const sim = liveShaman(734, 'elemental');
    if (wearer) equipSet(sim, 'stormkindled', 4);
    addThunderCharges(sim.ctx, sim.player, THUNDER_CHARGE_CAP);
    if (primal) armPrimalMastery(sim.ctx, sim.player);
    return thundercallDamageMultiplier(sim.ctx, sim.player, abilityId);
  }

  it('full vent 2.25x -> 2.5x, and Primal Mastery still multiplies (3.125x)', () => {
    // Control: 1 + 5 x 0.25 = 2.25. Wearer: 1 + 5 x 0.30 = 2.5. In the
    // Primal Mastery vent window the 1.25 multiplies the result: 3.125.
    expect(ventMultiplier(false, false)).toBeCloseTo(2.25, 10);
    expect(ventMultiplier(true, false)).toBeCloseTo(
      1 + 5 * STORMKINDLED_4PC_EARTHEN_JOLT_BONUS_PER_CHARGE,
      10,
    );
    expect(ventMultiplier(true, false)).toBeCloseTo(2.5, 10);
    expect(ventMultiplier(true, true)).toBeCloseTo(2.5 * 1.25, 10);
  });

  it("Faultwake's earthquake coefficient stays untouched for wearers", () => {
    expect(ventMultiplier(true, false, 'earthquake')).toBeCloseTo(1 + 5 * 0.2, 10);
    expect(ventMultiplier(false, false, 'earthquake')).toBeCloseTo(1 + 5 * 0.2, 10);
  });
});

describe('Warspirit Emberscale 2pc: Ancestral Strike advances the cadence 3 steps', () => {
  function strikeOnce(wearer: boolean): { stormcast: boolean; cadence: number } {
    const sim = liveShaman(2821, 'enhancement');
    if (wearer) equipSet(sim, 'warspirit_emberscale', 2);
    applyWarspiritPosture(sim.ctx, sim.player, 'galeheart');
    const mob = addHostileMob(sim);
    landedAncestralStrike(sim, sim.player, mob);
    return {
      stormcast: sim.player.auras.some((aura) => aura.id === STORMCAST_ID),
      cadence: warspiritCadence(sim.player),
    };
  }

  it('one strike completes a whole cadence for wearers (control banks 2 of 3)', () => {
    expect(strikeOnce(true)).toEqual({ stormcast: true, cadence: 0 });
    expect(strikeOnce(false)).toEqual({ stormcast: false, cadence: 2 });
  });

  it('the Primal Exaltation clamp: a 3-step strike completes and carries 1', () => {
    // Under Exaltation the cadence target clamps to 2, so total 3 completes
    // and carries min(target - 1, total - target) = min(1, 1) = 1, the
    // disclosed interplay.
    const sim = liveShaman(2822, 'enhancement');
    equipSet(sim, 'warspirit_emberscale', 2);
    applyWarspiritPosture(sim.ctx, sim.player, 'galeheart');
    const mob = addHostileMob(sim);
    sim.ctx.applyAura(sim.player, {
      id: PRIMAL_EXALTATION_ID,
      name: 'Primal Exaltation',
      kind: 'internal_cd',
      value: 0,
      remaining: 12,
      duration: 12,
      sourceId: sim.player.id,
      school: 'nature',
    });
    expect(
      advanceWarspiritCadence(
        sim.ctx,
        sim.player,
        mob,
        100,
        WARSPIRIT_EMBERSCALE_2PC_CADENCE_STEPS,
      ),
    ).toBe(true);
    expect(warspiritCadence(sim.player)).toBe(1);
  });

  it('Deep Reservoir shares the cadence currency (the disclosed amplification)', () => {
    // The talent's Stormcast-consume refund writes cadence 1 through the SAME
    // setCadence the strike advances: an amplification of the loop, never a
    // second currency. Proven at the engine seam with the talent selected.
    const sim = new Sim({ seed: 2823, playerClass: 'shaman', autoEquip: true });
    sim.setPlayerLevel(20);
    expect(
      sim.applyTalents({ spec: 'enhancement', rows: { 20: SHAMAN_TALENT_IDS.deepReservoir } }),
    ).toBe(true);
    applyWarspiritPosture(sim.ctx, sim.player, 'galeheart');
    sim.rng.next = () => 0.99; // no Stormsurge proc: isolate the refund
    onStormcastConsumed(sim.ctx, sim.player);
    expect(warspiritCadence(sim.player)).toBe(1);
  });
});

describe('Warspirit Emberscale 4pc: Ancestral Strike hits 30 percent harder, delivered', () => {
  it('derives 0.51 from the REAL 1.7 additive baseline (0.6 row + 0.1 mastery)', () => {
    const control = shamanMods('enhancement', {});
    const wearer = shamanMods('enhancement', worn('warspirit_emberscale', 4));
    const def = expectDefined(
      abilitiesKnownAt('shaman', 25, control).find((known) => known.def.id === 'stormstrike'),
    ).def;
    const base = resolveTalentHitMult(def, control).dmgMult;
    const bent = resolveTalentHitMult(def, wearer).dmgMult;
    // The additive accumulator: 1 + meleeDmgPct + dmgPct. A committed
    // Warspirit at level 20+ carries the 0.6 spec-baseline stormstrike row
    // plus the fully scaled Skyrend mastery's 0.1 meleeDmgPct, so the true
    // baseline is 1.7, not the set doc's assumed 1.6 (deviation recorded).
    expect(base).toBeCloseTo(1.7, 10);
    expect(bent).toBeCloseTo(1.7 + WARSPIRIT_EMBERSCALE_4PC_STORMSTRIKE_DMG_PCT, 10);
    // Delivered: exactly the printed 30 percent for the committed spec.
    expect(bent / base).toBeCloseTo(1.3, 10);
    expect(WARSPIRIT_EMBERSCALE_4PC_STORMSTRIKE_DMG_PCT).toBeCloseTo(0.3 * 1.7, 10);
  });
});

describe('Stonehearth 2pc: Stormcast Mending Waters while Stonebound is free and heals 25% more', () => {
  function armStormcastByCadence(sim: Sim, mob: Entity): void {
    for (let step = 0; step < 3; step++) {
      advanceWarspiritCadence(sim.ctx, sim.player, mob, 100, 1);
    }
    expect(sim.player.auras.some((aura) => aura.id === STORMCAST_ID)).toBe(true);
  }

  it('bills zero AFTER consuming the cheap charge, and the whole heal rises 25 percent', () => {
    const sim = liveShaman(947, 'enhancement');
    equipSet(sim, 'stonehearth', 2);
    const mob = addHostileMob(sim);
    // Open a wide health deficit through the real pipeline, then pin the heal
    // rolls so the two casts below share the exact same base roll.
    sim.ctx.dealDamage(
      mob,
      sim.player,
      Math.ceil(sim.player.maxHp * 0.8),
      false,
      'physical',
      'Test Blow',
      'hit',
    );
    sim.rng.next = () => 0.5;
    sim.rng.chance = () => false;

    // Control cast: Stormcast while GALEHEART (not Stonebound): the normal
    // half-cost bill and the unscaled heal.
    applyWarspiritPosture(sim.ctx, sim.player, 'galeheart');
    armStormcastByCadence(sim, mob);
    const definition = expectDefined(sim.resolvedAbility('healing_wave', sim.player.id));
    sim.targetEntity(sim.player.id);
    sim.player.gcdRemaining = 0;
    sim.player.resource = sim.player.maxResource;
    sim.drainEvents();
    sim.castAbility('healing_wave');
    expect(sim.player.castingAbility).toBeNull(); // Stormcast instant
    expect(sim.player.maxResource - sim.player.resource).toBe(Math.ceil(definition.cost * 0.5));
    const controlHeal = expectDefined(heal2Events(sim.drainEvents(), 'Mending Waters')[0]).amount;

    // Wearer cast: Stormcast while STONEBOUND: zero bill, both Stormcast
    // components consumed (the consume-order trap), heal exactly x1.25.
    applyWarspiritPosture(sim.ctx, sim.player, 'stonebound', 14);
    armStormcastByCadence(sim, mob);
    sim.player.gcdRemaining = 0;
    sim.player.resource = sim.player.maxResource;
    sim.drainEvents();
    sim.castAbility('healing_wave');
    expect(sim.player.castingAbility).toBeNull();
    expect(sim.player.maxResource - sim.player.resource).toBe(0);
    // The consume order kept both Stormcast components spent: zeroing the
    // cost EARLY would have skipped the cheap consume and left the half-cost
    // aura alive for a later cast.
    expect(sim.player.auras.some((aura) => aura.id === STORMCAST_ID)).toBe(false);
    expect(sim.player.auras.some((aura) => aura.id === STORMCAST_CHEAP_ID)).toBe(false);
    const bentHeal = expectDefined(heal2Events(sim.drainEvents(), 'Mending Waters')[0]).amount;
    expect(bentHeal).toBe(Math.round(controlHeal * (1 + STONEHEARTH_2PC_MENDING_HEAL_BONUS)));
  });

  it('a wearer at ZERO mana can still press the empowered heal (the pre-gate bend)', () => {
    const sim = liveShaman(948, 'enhancement');
    equipSet(sim, 'stonehearth', 2);
    const mob = addHostileMob(sim);
    sim.ctx.dealDamage(
      mob,
      sim.player,
      Math.ceil(sim.player.maxHp * 0.5),
      false,
      'physical',
      'Test Blow',
      'hit',
    );
    applyWarspiritPosture(sim.ctx, sim.player, 'stonebound', 14);
    armStormcastByCadence(sim, mob);
    sim.targetEntity(sim.player.id);
    sim.player.gcdRemaining = 0;
    sim.player.resource = 0;
    sim.drainEvents();
    sim.castAbility('healing_wave');
    expect(heal2Events(sim.drainEvents(), 'Mending Waters')).toHaveLength(1);
    expect(sim.player.resource).toBe(0);
  });

  it('a NON-wearer while Stonebound still pays the normal half cost', () => {
    const sim = liveShaman(949, 'enhancement');
    const mob = addHostileMob(sim);
    applyWarspiritPosture(sim.ctx, sim.player, 'stonebound', 14);
    armStormcastByCadence(sim, mob);
    const definition = expectDefined(sim.resolvedAbility('healing_wave', sim.player.id));
    sim.targetEntity(sim.player.id);
    sim.player.gcdRemaining = 0;
    sim.player.resource = sim.player.maxResource;
    sim.castAbility('healing_wave');
    expect(sim.player.maxResource - sim.player.resource).toBe(Math.ceil(definition.cost * 0.5));
  });
});

describe('Stonehearth 4pc: completing a cadence while Stonebound heals 3 percent max health', () => {
  function cadenceCompletionHeals(
    pieces: number,
    posture: 'galeheart' | 'stonebound',
  ): { amounts: number[]; expected: number; hpGained: number } {
    const sim = liveShaman(1123, 'enhancement');
    equipSet(sim, 'stonehearth', pieces);
    const mob = addHostileMob(sim);
    applyWarspiritPosture(sim.ctx, sim.player, posture, 14);
    sim.ctx.recalcPlayer(sim.player);
    sim.player.hp = Math.round(sim.player.maxHp * 0.4);
    const hpBefore = sim.player.hp;
    if (posture === 'stonebound') {
      // A HEAL that draws NO rng: any chance() call under the completion
      // would throw here (canCrit false skips the crit roll entirely).
      sim.rng.chance = () => {
        throw new Error('the cadence completion must not draw rng');
      };
    }
    sim.drainEvents();
    advanceWarspiritCadence(sim.ctx, sim.player, mob, 100, 2);
    advanceWarspiritCadence(sim.ctx, sim.player, mob, 100, 2); // total 4 >= 3: completes
    return {
      amounts: heal2Events(sim.drainEvents(), 'Warspirit Cadence').map((event) => event.amount),
      expected: Math.max(1, Math.round(sim.player.maxHp * STONEHEARTH_4PC_CADENCE_HEAL_PCT_MAX)),
      hpGained: sim.player.hp - hpBefore,
    };
  }

  it('wearers heal exactly 3 percent at the completion point (a heal, not an absorb)', () => {
    const wearer = cadenceCompletionHeals(4, 'stonebound');
    expect(wearer.amounts).toEqual([wearer.expected]);
    expect(wearer.hpGained).toBe(wearer.expected);
  });

  it('two pieces heal nothing; Galeheart wearers heal nothing', () => {
    expect(cadenceCompletionHeals(2, 'stonebound').amounts).toEqual([]);
    expect(cadenceCompletionHeals(4, 'galeheart').amounts).toEqual([]);
  });
});

describe("Springmender 2pc: Tidecall's cooldown drops 12 to 8, charges intact", () => {
  it('the resolved cooldown: 8 for wearers, 12 base, both parallel charges kept', () => {
    const entryOf = (equipment: Partial<Record<string, string>>) =>
      expectDefined(
        abilitiesKnownAt('shaman', 25, shamanMods('restoration', equipment)).find(
          (known) => known.def.id === 'tidecall',
        ),
      );
    expect(entryOf({}).cooldown).toBe(12);
    const bent = entryOf(worn('springmender', 2));
    expect(bent.cooldown).toBe(12 - SPRINGMENDER_2PC_TIDECALL_COOLDOWN_CUT_SEC);
    // The charge model reads this resolved cooldown as each charge's PARALLEL
    // recharge duration, and the two stored uses survive the rewrite.
    expect(bent.charges).toBe(2);
    expect(bent.bonusCharges).toBe(1);
  });
});

describe('Springmender 4pc: a fourth ally and the 150 percent chain harvest', () => {
  function mendingCurrentAura(sourceId: number, value: number): Aura {
    return {
      id: MENDING_CURRENT_ID,
      name: 'Mending Current',
      kind: 'hot',
      value,
      remaining: 12,
      duration: 12,
      tickInterval: 3,
      tickTimer: 3,
      sourceId,
      school: 'nature',
    } as Aura;
  }

  it('Cascading Mend reaches a FOURTH ally for wearers (control three)', () => {
    function chainTargets(wearer: boolean): number {
      const sim = liveShaman(358, 'restoration');
      if (wearer) equipSet(sim, 'springmender', 4);
      const allies = [2, 4, 6, 8].map((offset) => addAlly(sim, `Chained${offset}`, offset));
      for (const ally of allies) ally.hp = Math.round(ally.maxHp * 0.4);
      sim.player.resource = sim.player.maxResource;
      sim.targetEntity(expectDefined(allies[0]).id);
      sim.drainEvents();
      sim.castAbility('chain_heal');
      const events: SimEvent[] = [];
      for (let tick = 0; tick < 70; tick++) events.push(...sim.tick());
      return heal2Events(events, 'Cascading Mend').length;
    }
    // 1 + jumps hops: the wearer's extra hop is the doc's fourth ally (its
    // heal draws the disclosed wearer-only crit roll; control draws are
    // untouched).
    expect(chainTargets(true)).toBe(3 + SPRINGMENDER_4PC_BONUS_JUMPS);
    expect(chainTargets(false)).toBe(3);
  });

  it('the chain-path harvest pays 150 percent for wearers (control 125)', () => {
    function chainHarvest(wearer: boolean): number {
      const sim = liveShaman(359, 'restoration');
      if (wearer) equipSet(sim, 'springmender', 4);
      const ally = addAlly(sim, 'Pooled', 4);
      ally.hp = Math.max(1, ally.maxHp - 500);
      ally.auras.push(mendingCurrentAura(sim.player.id, 100));
      return consumeMendingCurrent(sim.ctx, sim.player, ally);
    }
    expect(chainHarvest(true)).toBe(Math.round(100 * SPRINGMENDER_4PC_CHAIN_HARVEST_MULT));
    expect(chainHarvest(false)).toBe(125);
  });

  it("Unleash Weapon's collapse deliberately keeps 1.25 for wearers", () => {
    const sim = liveShaman(360, 'restoration');
    equipSet(sim, 'springmender', 4);
    const ally = addAlly(sim, 'Rescued', 4);
    ally.hp = Math.max(1, ally.maxHp - 500);
    ally.auras.push(mendingCurrentAura(sim.player.id, 100));
    sim.rng.chance = () => false; // no heal crit: the exact base collapse
    expect(unleashMendingCurrent(sim.ctx, sim.player, ally)).toBe(Math.round(100 * 1.25));
  });
});

describe('the wearer literals against the authored copy', () => {
  it('pins every audited shaman constant', () => {
    expect(STORMKINDLED_2PC_UNLEASH_THUNDER).toBe(3);
    expect(STORMKINDLED_4PC_EARTHEN_JOLT_BONUS_PER_CHARGE).toBeCloseTo(0.3, 10);
    expect(WARSPIRIT_EMBERSCALE_2PC_CADENCE_STEPS).toBe(3);
    expect(STONEHEARTH_2PC_MENDING_HEAL_BONUS).toBeCloseTo(0.25, 10);
    expect(STONEHEARTH_4PC_CADENCE_HEAL_PCT_MAX).toBeCloseTo(0.03, 10);
    expect(SPRINGMENDER_2PC_TIDECALL_COOLDOWN_CUT_SEC).toBe(4);
    expect(SPRINGMENDER_4PC_BONUS_JUMPS).toBe(1);
    expect(SPRINGMENDER_4PC_CHAIN_HARVEST_MULT).toBeCloseTo(1.5, 10);
  });
});
