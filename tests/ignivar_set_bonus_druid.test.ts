// Druid Crucible set bonuses (docs/prd/ignivar-set-bonus-final.md): each
// bonus proven at the seam it rides, across the four form engines. Moonscorch
// 2pc is a RESOLVED rewrite of Moonseed's extendDot cap (6 to 12), the one
// number the extendOwnedDot dispatch and the {duration} tooltip splice both
// read; 4pc is a dmgPct pair on Moonsurge and Sunwake sized DELIVERED (0.3075
// against the 1.23 committed baseline: 0.08 spec floor plus the 0.15 Moonrage
// mastery). Wildfang 2pc rewrites Redharvest's resolved energy restore
// (floor(x1.5): 22/33/45 by rank); 4pc replants a fresh Flense after the
// consumeDot cash-out, aura-only. Cinderbark 2pc is the one wearer-only rng
// draw of the wave (a 30 percent extra Old Blood roll per landed Sweeping
// Claws, flag-gated so non-wearers draw nothing); 4pc is a dmgPct row sized
// DELIVERED (0.45 against the 1.5 Primal Heart baseline) plus the flag-gated
// skip of the one directDamage break, so the guard shields AND the strike
// lands with its authored threat. Grovespring 2pc prefers the caster's own
// blooms at the consumeMatchingAura pick (with the explicit any-HoT fallback)
// and rewrites the resolved consumeAura heal x1.25; 4pc rewrites the resolved
// harvest fraction (0.6 to 0.75) and banks 1 Verdance via setBank after the
// Nature's Fury seed.
import { describe, expect, it, vi } from 'vitest';
import {
  druidEngineOnHotPlanted,
  druidEngineOnLandedStrike,
  OLD_BLOOD_ID,
  VERDANCE_ID,
} from '../src/sim/combat/druid_engines';
import type { onCastCompleted } from '../src/sim/combat/talent_procs';
import { ABILITIES, abilitiesKnownAt } from '../src/sim/content/classes';
import {
  CINDERBARK_2PC_EXTRA_OLD_BLOOD_CHANCE,
  CINDERBARK_4PC_MARROWBREAK_DMG_PCT,
  GROVESPRING_2PC_SWIFTMEND_HEAL_MULT,
  GROVESPRING_4PC_OVERBLOOM_HARVEST_PCT,
  GROVESPRING_4PC_VERDANCE_BANK,
  MOONSCORCH_2PC_TEMPEST_EXTEND_CAP_SEC,
  MOONSCORCH_4PC_PAYOFF_DMG_PCT,
  setBonusFlag,
  WILDFANG_2PC_REDHARVEST_ENERGY_MULT,
} from '../src/sim/content/ignivar_set_bonuses';
import { specBaselineFor } from '../src/sim/content/spec_baselines';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { computeCharacterModifiers } from '../src/sim/set_bonus_mods';
import { Sim } from '../src/sim/sim';
import { resolveTalentHitMult } from '../src/sim/talent_hit_mult';
import type { Aura, Entity } from '../src/sim/types';
import { expectDefined } from './helpers/defined';

const SET_SLOTS = ['helmet', 'shoulder', 'chest', 'gloves', 'legs'] as const;

type DruidSpec = 'balance' | 'feral' | 'restoration';

function worn(setId: string, pieces: number): Partial<Record<string, string>> {
  const equipment: Partial<Record<string, string>> = {};
  for (const slot of SET_SLOTS.slice(0, pieces)) equipment[slot] = `${setId}_${slot}`;
  return equipment;
}

function druidMods(spec: DruidSpec, equipment: Partial<Record<string, string>>) {
  return computeCharacterModifiers('druid', { spec, rows: {} }, 25, equipment);
}

function entryOf(spec: DruidSpec, equipment: Partial<Record<string, string>>, abilityId: string) {
  return expectDefined(
    abilitiesKnownAt('druid', 25, druidMods(spec, equipment)).find(
      (known) => known.def.id === abilityId,
    ),
  );
}

function equipSet(sim: Sim, setId: string, pieces: number): void {
  for (const slot of SET_SLOTS.slice(0, pieces)) {
    sim.addItem(`${setId}_${slot}`, 1);
    sim.equipItem(`${setId}_${slot}`);
  }
}

function liveDruid(seed: number, spec: DruidSpec, rows: Record<number, string> = {}): Sim {
  const sim = new Sim({ seed, playerClass: 'druid', autoEquip: true });
  sim.setPlayerLevel(20);
  expect(sim.applyTalents({ spec, rows })).toBe(true);
  sim.player.resource = sim.player.maxResource;
  sim.player.hitBonus = 1;
  return sim;
}

function ctxOf(sim: Sim): Parameters<typeof onCastCompleted>[0] {
  return (sim as unknown as { ctx: Parameters<typeof onCastCompleted>[0] }).ctx;
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

function addHostileTarget(sim: Sim, z = 2): Entity {
  const host = sim as Sim & { nextId: number; addEntity(entity: Entity): void };
  const target = createMob(host.nextId++, MOBS.forest_wolf, 20, {
    x: sim.player.pos.x,
    y: sim.player.pos.y,
    z: sim.player.pos.z + z,
  });
  target.maxHp = 1_000_000;
  target.hp = target.maxHp;
  target.weapon.min = 0;
  target.weapon.max = 0;
  target.weapon.speed = 1000;
  target.swingTimer = 1000;
  target.moveSpeed = 0;
  target.hostile = true;
  host.addEntity(target);
  sim.targetEntity(target.id);
  sim.player.facing = 0;
  return target;
}

function readyCast(sim: Sim, abilityId: string): void {
  sim.player.cooldowns.delete(abilityId);
  sim.player.gcdRemaining = 0;
  sim.player.resource = sim.player.maxResource;
}

// Non-physical spells travel as projectiles: tick until every pending bolt
// has landed so an extendDot/dot payload has actually been applied.
function settleProjectiles(sim: Sim): void {
  const host = sim as unknown as { ctx: { pendingProjectiles: unknown[] } };
  for (let i = 0; i < 200 && host.ctx.pendingProjectiles.length > 0; i++) sim.tick();
}

function bankOldBlood(sim: Sim, stacksWanted: number): void {
  const current = sim.player.auras.find((aura) => aura.id === OLD_BLOOD_ID)?.stacks ?? 0;
  for (let i = current; i < stacksWanted; i++) {
    druidEngineOnLandedStrike(ctxOf(sim), sim.player, 'claw');
  }
}

function stacks(player: Entity, id: string): number {
  return player.auras.find((aura) => aura.id === id)?.stacks ?? 0;
}

function ownDot(target: Entity, sourceId: number, id: string): Aura | undefined {
  return target.auras.find(
    (aura) => aura.kind === 'dot' && aura.id === id && aura.sourceId === sourceId,
  );
}

describe('druid Crucible sets: the resolver registration', () => {
  it('registers both tiers per worn set and nothing one piece short', () => {
    for (const [setId, spec] of [
      ['moonscorch', 'balance'],
      ['wildfang_emberhide', 'feral'],
      ['cinderbark', 'feral'],
      ['grovespring', 'restoration'],
    ] as const) {
      const four = druidMods(spec, worn(setId, 4));
      expect(four.selected[setBonusFlag(setId, 2)], setId).toBe(true);
      expect(four.selected[setBonusFlag(setId, 4)], setId).toBe(true);
      const oneShort = druidMods(spec, worn(setId, 1));
      expect(oneShort.selected[setBonusFlag(setId, 2)], setId).toBeUndefined();
    }
  });

  it('only the two caster/healer 2pcs carry the pushback rider', () => {
    expect(druidMods('balance', worn('moonscorch', 2)).global.castPushbackReduction).toBe(1);
    expect(druidMods('restoration', worn('grovespring', 2)).global.castPushbackReduction).toBe(1);
    // The melee sets stay rider-free: a form druid is not a caster.
    expect(druidMods('feral', worn('wildfang_emberhide', 2)).global.castPushbackReduction).toBe(0);
    expect(druidMods('feral', worn('cinderbark', 2)).global.castPushbackReduction).toBe(0);
    expect(druidMods('balance', {}).global.castPushbackReduction).toBe(0);
  });
});

describe('Moonscorch 2pc: Moonseed extends Lunar Tempest twice per application', () => {
  it('the resolved cap: 12 for wearers, 6 base, and unequipping re-resolves to 6', () => {
    const capOf = (equipment: Partial<Record<string, string>>) => {
      const eff = entryOf('balance', equipment, 'moonseed').effects.find(
        (
          candidate,
        ): candidate is Extract<
          (typeof ABILITIES.moonseed.effects)[number],
          { type: 'extendDot' }
        > => candidate.type === 'extendDot',
      );
      return expectDefined(eff);
    };
    expect(capOf({}).maxBonus).toBe(6);
    expect(capOf(worn('moonscorch', 2)).maxBonus).toBe(MOONSCORCH_2PC_TEMPEST_EXTEND_CAP_SEC);
    // The per-press extension itself never moves: two 6-sec presses fill the
    // wearer cap, the copy's "twice per application".
    expect(capOf(worn('moonscorch', 2)).seconds).toBe(6);

    const sim = liveDruid(611, 'balance');
    equipSet(sim, 'moonscorch', 2);
    const resolvedCap = sim
      .resolvedAbility('moonseed')
      ?.effects.find((eff) => eff.type === 'extendDot');
    expect(resolvedCap && 'maxBonus' in resolvedCap ? resolvedCap.maxBonus : 0).toBe(
      MOONSCORCH_2PC_TEMPEST_EXTEND_CAP_SEC,
    );
    sim.unequipItem('helmet');
    const reResolved = sim
      .resolvedAbility('moonseed')
      ?.effects.find((eff) => eff.type === 'extendDot');
    expect(reResolved && 'maxBonus' in reResolved ? reResolved.maxBonus : 0).toBe(6);
  });

  it('two presses extend a wearer application by 12; the third stays dead (control caps at 6)', () => {
    function tempestAfterThreePresses(wearer: boolean): Aura {
      const sim = liveDruid(612, 'balance');
      if (wearer) equipSet(sim, 'moonscorch', 2);
      const target = addHostileTarget(sim, 8);
      sim.player.auras.push(formAura(sim.player, 'form_moonkin'));
      target.auras.push({
        id: 'moonfire',
        name: 'Lunar Tempest',
        kind: 'dot',
        remaining: 12,
        duration: 12,
        value: 10,
        tickInterval: 3,
        tickTimer: 3,
        sourceId: sim.player.id,
        school: 'arcane',
      });
      for (let press = 0; press < 3; press++) {
        readyCast(sim, 'moonseed');
        sim.castAbility('moonseed');
        settleProjectiles(sim);
      }
      return expectDefined(ownDot(target, sim.player.id, 'moonfire'));
    }
    // duration (unlike remaining) never decays, so it reads the extension
    // budget exactly: 12 authored + the extendedBy total.
    const bent = tempestAfterThreePresses(true);
    expect(bent.extendedBy).toBe(MOONSCORCH_2PC_TEMPEST_EXTEND_CAP_SEC);
    expect(bent.duration).toBe(12 + MOONSCORCH_2PC_TEMPEST_EXTEND_CAP_SEC);
    const control = tempestAfterThreePresses(false);
    expect(control.extendedBy).toBe(6);
    expect(control.duration).toBe(12 + 6);
  });

  it('a fresh application resets the budget (per application, not per target)', () => {
    const sim = liveDruid(613, 'balance');
    equipSet(sim, 'moonscorch', 2);
    const target = addHostileTarget(sim, 8);
    sim.player.auras.push(formAura(sim.player, 'form_moonkin'));
    const plant = () =>
      target.auras.push({
        id: 'moonfire',
        name: 'Lunar Tempest',
        kind: 'dot',
        remaining: 12,
        duration: 12,
        value: 10,
        tickInterval: 3,
        tickTimer: 3,
        sourceId: sim.player.id,
        school: 'arcane',
      });
    plant();
    for (let press = 0; press < 2; press++) {
      readyCast(sim, 'moonseed');
      sim.castAbility('moonseed');
      settleProjectiles(sim);
    }
    expect(expectDefined(ownDot(target, sim.player.id, 'moonfire')).extendedBy).toBe(12);
    // Re-apply: applyAura replaces the aura OBJECT, so extendedBy starts
    // clean and the wearer gets a full budget on the new application.
    target.auras = target.auras.filter((aura) => aura.id !== 'moonfire');
    plant();
    readyCast(sim, 'moonseed');
    sim.castAbility('moonseed');
    settleProjectiles(sim);
    expect(expectDefined(ownDot(target, sim.player.id, 'moonfire')).extendedBy).toBe(6);
  });
});

describe('Moonscorch 4pc: Moonsurge and Sunwake strike 25 percent harder, delivered', () => {
  it('the accumulator: 1.5375 for wearers against the 1.23 committed baseline', () => {
    for (const abilityId of ['moonlash', 'sunlance'] as const) {
      const wearerMult = resolveTalentHitMult(
        ABILITIES[abilityId],
        druidMods('balance', worn('moonscorch', 4)),
      ).dmgMult;
      const baseMult = resolveTalentHitMult(ABILITIES[abilityId], druidMods('balance', {})).dmgMult;
      expect(baseMult, abilityId).toBeCloseTo(1.23, 10);
      expect(wearerMult, abilityId).toBeCloseTo(1.23 + MOONSCORCH_4PC_PAYOFF_DMG_PCT, 10);
      // Delivered: exactly the 25 percent the copy promises.
      expect(wearerMult / baseMult, abilityId).toBeCloseTo(1.25, 10);
    }
    // The floors this sizing leans on: the spec baseline plus the fully
    // scaled Moonrage mastery at the raid's level 20+.
    expect(specBaselineFor('druid', 'balance')?.global?.spellDmgPct).toBeCloseTo(0.08, 10);
    expect(druidMods('balance', {}).global.spellDmgPct).toBeCloseTo(0.23, 10);
  });

  it('the resolved damage scales on both arms, including the Sunwake burn dot', () => {
    // Moonsurge and Sunwake only exist through the Moontide-3 transform, so
    // the pins resolve them the way play does: the armed payoff buttons.
    function payoffEffects(wearer: boolean) {
      const sim = liveDruid(624, 'balance');
      if (wearer) equipSet(sim, 'moonscorch', 4);
      sim.player.auras.push(formAura(sim.player, 'form_moonkin'));
      sim.player.auras.push({
        id: 'moontide',
        name: 'Moontide',
        kind: 'moontide',
        remaining: 3600,
        duration: 3600,
        value: 0,
        stacks: 3,
        sourceId: sim.player.id,
        school: 'nature',
      });
      const moonlash = expectDefined(sim.resolvedAbility('moonseed'));
      const sunlance = expectDefined(sim.resolvedAbility('starfire'));
      expect(moonlash.def.id).toBe('moonlash');
      expect(sunlance.def.id).toBe('sunlance');
      const direct = (res: typeof moonlash) =>
        expectDefined(res.effects.find((eff) => eff.type === 'directDamage'));
      const burn = expectDefined(sunlance.effects.find((eff) => eff.type === 'dot'));
      return { moonlash: direct(moonlash), sunlance: direct(sunlance), burn };
    }
    const base = payoffEffects(false);
    expect(base.moonlash).toMatchObject({ min: 167, max: 199 });
    expect(base.sunlance).toMatchObject({ min: 98, max: 123 });
    expect('total' in base.burn ? base.burn.total : 0).toBe(55);
    const bent = payoffEffects(true);
    expect(bent.moonlash).toMatchObject({ min: 209, max: 249 });
    expect(bent.sunlance).toMatchObject({ min: 123, max: 154 });
    expect('total' in bent.burn ? bent.burn.total : 0).toBe(69);
    // The 2pc alone must NOT move the damage (the rows are the 4pc's).
    expect(druidMods('balance', worn('moonscorch', 2)).abilities.moonlash?.dmgPct ?? 0).toBe(0);
    expect(druidMods('balance', worn('moonscorch', 2)).abilities.sunlance?.dmgPct ?? 0).toBe(0);
  });
});

describe('Wildfang 2pc: Redharvest restores 45 energy, up from 30', () => {
  it('the resolved restore: 45 for wearers at rank 3, the 22/33/45 ladder below', () => {
    // Redharvest only exists through the Old Blood transform, so the pin
    // resolves it the way play does: the armed Gorebite button.
    function resolvedRestore(wearer: boolean): number {
      const sim = liveDruid(625, 'feral');
      if (wearer) equipSet(sim, 'wildfang_emberhide', 2);
      sim.player.auras.push(formAura(sim.player, 'form_cat'));
      bankOldBlood(sim, 3);
      const res = expectDefined(sim.resolvedAbility('ferocious_bite'));
      expect(res.def.id).toBe('redharvest');
      const eff = res.effects.find((candidate) => candidate.type === 'gainResource');
      return eff && 'amount' in eff ? eff.amount : 0;
    }
    // Raid wearers are level 20+, so rank 3: 45, up from 30.
    expect(resolvedRestore(false)).toBe(30);
    expect(resolvedRestore(true)).toBe(45);
    // The rank ladder truth (a sub-20 wearer cannot exist in play, the
    // pieces require level 20; the rewrite itself is rank-agnostic): the
    // authored 15/22/30 becomes 22/33/45 through the same floor(x1.5).
    for (const [authored, bent] of [
      [15, 22],
      [22, 33],
      [30, 45],
    ] as const) {
      expect(Math.floor(authored * WILDFANG_2PC_REDHARVEST_ENERGY_MULT)).toBe(bent);
    }
    const rankAmounts = [
      ABILITIES.redharvest.effects,
      ...(ABILITIES.redharvest.ranks ?? []).map((rank) => rank.effects),
    ].map((effects) => {
      const eff = effects.find((candidate) => candidate.type === 'gainResource');
      return eff && 'amount' in eff ? eff.amount : 0;
    });
    expect(rankAmounts).toEqual([15, 22, 30]);
  });

  it('flips the button energy-positive through the real cast path (net +10 vs net -5)', () => {
    function energyAfterRedharvest(wearer: boolean): number {
      const sim = liveDruid(614, 'feral');
      if (wearer) equipSet(sim, 'wildfang_emberhide', 2);
      addHostileTarget(sim);
      sim.player.auras.push(formAura(sim.player, 'form_cat'));
      sim.player.resourceType = 'energy';
      bankOldBlood(sim, 3);
      expect(sim.resolvedAbility('ferocious_bite')?.def.id).toBe('redharvest');
      sim.player.comboPoints = 0;
      sim.player.gcdRemaining = 0;
      sim.player.maxResource = 100;
      sim.player.resource = 50;
      sim.castAbility('ferocious_bite');
      return sim.player.resource;
    }
    // Cost 35, restore 45: 50 - 35 + 45 = 60 for wearers; 45 base.
    expect(energyAfterRedharvest(true)).toBe(60);
    expect(energyAfterRedharvest(false)).toBe(45);
  });
});

describe('Wildfang 4pc: Redharvest plants a fresh Flense on the target', () => {
  function redharvestReplant(wearer: boolean): {
    replanted: Aura | undefined;
    realCastAura: Aura;
    combo: number;
    oldBlood: number;
  } {
    const sim = liveDruid(615, 'feral');
    if (wearer) equipSet(sim, 'wildfang_emberhide', 4);
    const target = addHostileTarget(sim);
    sim.player.auras.push(formAura(sim.player, 'form_cat'));
    sim.player.resourceType = 'energy';
    sim.player.maxResource = 100;
    readyCast(sim, 'rake');
    sim.castAbility('rake');
    const realCast = expectDefined(ownDot(target, sim.player.id, 'rake'));
    const realCastAura = { ...realCast };
    bankOldBlood(sim, 3);
    readyCast(sim, 'ferocious_bite');
    sim.player.comboPoints = 1;
    sim.castAbility('ferocious_bite');
    expect(sim.resolvedAbility('ferocious_bite')?.def.id).not.toBe('redharvest'); // bank spent
    return {
      replanted: ownDot(target, sim.player.id, 'rake'),
      realCastAura,
      combo: sim.player.comboPoints,
      oldBlood: stacks(sim.player, OLD_BLOOD_ID),
    };
  }

  it('the replant matches a REAL Flense application tick for tick (no arithmetic drift)', () => {
    const bent = redharvestReplant(true);
    const replanted = expectDefined(bent.replanted);
    // The consumeDot cash-out removed the live bleed; this aura is the fresh
    // replant. Deep-compare the WHOLE aura (progress fields zeroed) against
    // the real cast's shape: replantFlense hand-mirrors the effect_dispatch
    // dot arm, so a field the real arm gains (leechPct, a rider) that the
    // replant does not copy must fail HERE, not ship silently.
    expect(replanted.duration).toBe(18);
    expect(replanted.tickInterval).toBe(3);
    expect({ ...replanted, remaining: 0, tickTimer: 0 }).toEqual({
      ...bent.realCastAura,
      remaining: 0,
      tickTimer: 0,
    });
  });

  it('is aura-only: no combo point, no Old Blood bank, and non-wearers get nothing', () => {
    const bent = redharvestReplant(true);
    expect(bent.combo).toBe(0);
    expect(bent.oldBlood).toBe(0);
    const control = redharvestReplant(false);
    expect(control.replanted).toBeUndefined();
    expect(control.combo).toBe(0);
    expect(control.oldBlood).toBe(0);
  });
});

describe('Cinderbark 2pc: Sweeping Claws may bank an additional Old Blood', () => {
  function bearWithTarget(seed: number, wearer: boolean) {
    const sim = liveDruid(seed, 'feral');
    if (wearer) equipSet(sim, 'cinderbark', 2);
    addHostileTarget(sim);
    sim.player.auras.push(formAura(sim.player, 'form_bear'));
    sim.player.resourceType = 'rage';
    sim.player.maxResource = 100;
    sim.player.resource = 100;
    return sim;
  }

  it('rolls exactly one flag-gated 0.3 chance per landed cast; non-wearers roll none', () => {
    const wearer = bearWithTarget(616, true);
    const wearerSpy = vi.spyOn(ctxOf(wearer).rng, 'chance').mockReturnValue(false);
    wearer.castAbility('swipe');
    const wearerRolls = wearerSpy.mock.calls
      .map(([p]) => p)
      .filter((p) => p === CINDERBARK_2PC_EXTRA_OLD_BLOOD_CHANCE);
    expect(wearerRolls).toEqual([CINDERBARK_2PC_EXTRA_OLD_BLOOD_CHANCE]);
    expect(stacks(wearer.player, OLD_BLOOD_ID)).toBe(1);
    wearerSpy.mockRestore();

    const control = bearWithTarget(616, false);
    const controlSpy = vi.spyOn(ctxOf(control).rng, 'chance').mockReturnValue(false);
    control.castAbility('swipe');
    const controlRolls = controlSpy.mock.calls
      .map(([p]) => p)
      .filter((p) => p === CINDERBARK_2PC_EXTRA_OLD_BLOOD_CHANCE);
    expect(controlRolls).toEqual([]);
    expect(stacks(control.player, OLD_BLOOD_ID)).toBe(1);
    controlSpy.mockRestore();
  });

  it('a passed roll banks the additional stage; the 3-stack cap still holds', () => {
    const sim = bearWithTarget(617, true);
    const spy = vi
      .spyOn(ctxOf(sim).rng, 'chance')
      .mockImplementation((p) => p === CINDERBARK_2PC_EXTRA_OLD_BLOOD_CHANCE);
    sim.castAbility('swipe');
    expect(stacks(sim.player, OLD_BLOOD_ID)).toBe(2);
    // At 2 banked, the base landing fills the third and the passed extra
    // roll must NOT overflow the cap.
    readyCast(sim, 'swipe');
    sim.castAbility('swipe');
    expect(stacks(sim.player, OLD_BLOOD_ID)).toBe(3);
    spy.mockRestore();
  });

  it('survives a form round trip without double-applying (still one roll per swipe)', () => {
    // The bend keeps NO per-form state: the extra stack rides the shared Old
    // Blood bank (a persistent engine aura), so leaving and re-entering Bruin
    // must neither duplicate the bank nor change the one-roll-per-landed-cast
    // cadence.
    const sim = liveDruid(628, 'feral');
    equipSet(sim, 'cinderbark', 2);
    addHostileTarget(sim);
    sim.player.auras.push(formAura(sim.player, 'form_bear'));
    sim.player.resourceType = 'rage';
    sim.player.maxResource = 100;
    sim.player.resource = 100;
    const spy = vi
      .spyOn(ctxOf(sim).rng, 'chance')
      .mockImplementation((p) => p === CINDERBARK_2PC_EXTRA_OLD_BLOOD_CHANCE);
    sim.castAbility('swipe');
    expect(stacks(sim.player, OLD_BLOOD_ID)).toBe(2);
    // Round trip: out of Bruin into Wolf and back. The shared bank persists
    // by design (Wildfang's cross-form identity).
    sim.player.auras = sim.player.auras.filter((aura) => aura.kind !== 'form_bear');
    sim.player.auras.push(formAura(sim.player, 'form_cat'));
    sim.player.auras = sim.player.auras.filter((aura) => aura.kind !== 'form_cat');
    sim.player.auras.push(formAura(sim.player, 'form_bear'));
    expect(stacks(sim.player, OLD_BLOOD_ID)).toBe(2);
    spy.mockClear();
    readyCast(sim, 'swipe');
    sim.castAbility('swipe');
    const rolls = spy.mock.calls
      .map(([p]) => p)
      .filter((p) => p === CINDERBARK_2PC_EXTRA_OLD_BLOOD_CHANCE);
    expect(rolls).toEqual([CINDERBARK_2PC_EXTRA_OLD_BLOOD_CHANCE]);
    expect(stacks(sim.player, OLD_BLOOD_ID)).toBe(3); // capped through addStage
    spy.mockRestore();
  });

  it('other Old Blood strikes never roll (the bend is Sweeping Claws only)', () => {
    const sim = bearWithTarget(618, true);
    const spy = vi.spyOn(ctxOf(sim).rng, 'chance').mockReturnValue(false);
    druidEngineOnLandedStrike(ctxOf(sim), sim.player, 'claw');
    druidEngineOnLandedStrike(ctxOf(sim), sim.player, 'maul');
    const rolls = spy.mock.calls
      .map(([p]) => p)
      .filter((p) => p === CINDERBARK_2PC_EXTRA_OLD_BLOOD_CHANCE);
    expect(rolls).toEqual([]);
    expect(stacks(sim.player, OLD_BLOOD_ID)).toBe(2);
    spy.mockRestore();
  });
});

describe('Cinderbark 4pc: Marrowbreak hits harder and the guard keeps the strike', () => {
  it('the accumulator and the resolved damage: 1.95 against the 1.5 Primal Heart baseline', () => {
    const wearerMult = resolveTalentHitMult(
      ABILITIES.marrowbreak,
      druidMods('feral', worn('cinderbark', 4)),
    ).dmgMult;
    const baseMult = resolveTalentHitMult(ABILITIES.marrowbreak, druidMods('feral', {})).dmgMult;
    expect(baseMult).toBeCloseTo(1.5, 10);
    expect(wearerMult).toBeCloseTo(1.5 + CINDERBARK_4PC_MARROWBREAK_DMG_PCT, 10);
    // Delivered: exactly the 30 percent the copy promises.
    expect(wearerMult / baseMult).toBeCloseTo(1.3, 10);
    // Marrowbreak only exists through the Old Blood transform, so the pin
    // resolves it the way play does: the armed Bonecrush button.
    function resolvedDirect(wearer: boolean) {
      const sim = liveDruid(626, 'feral');
      if (wearer) equipSet(sim, 'cinderbark', 4);
      sim.player.auras.push(formAura(sim.player, 'form_bear'));
      bankOldBlood(sim, 3);
      const res = expectDefined(sim.resolvedAbility('maul'));
      expect(res.def.id).toBe('marrowbreak');
      return expectDefined(res.effects.find((eff) => eff.type === 'directDamage'));
    }
    expect(resolvedDirect(false)).toMatchObject({
      min: Math.round(78 * 1.5),
      max: Math.round(96 * 1.5),
    });
    expect(resolvedDirect(true)).toMatchObject({
      min: Math.round(78 * 1.95),
      max: Math.round(96 * 1.95),
    });
    // The 2pc alone must NOT move the damage (the row is the 4pc's).
    expect(druidMods('feral', worn('cinderbark', 2)).abilities.marrowbreak?.dmgPct ?? 0).toBe(0);
  });

  function marrowbreakBelowHalf(wearer: boolean) {
    const sim = liveDruid(619, 'feral');
    if (wearer) equipSet(sim, 'cinderbark', 4);
    const target = addHostileTarget(sim);
    sim.player.auras.push(formAura(sim.player, 'form_bear'));
    sim.player.resourceType = 'rage';
    sim.player.maxResource = 100;
    sim.player.hp = Math.round(sim.player.maxHp * 0.4);
    bankOldBlood(sim, 3);
    expect(sim.resolvedAbility('maul')?.def.id).toBe('marrowbreak');
    sim.player.gcdRemaining = 0;
    sim.player.resource = 20;
    sim.castAbility('maul');
    return { sim, target };
  }

  it('below half health a wearer keeps the guard AND lands the strike with its threat', () => {
    const { sim, target } = marrowbreakBelowHalf(true);
    expect(target.hp).toBeLessThan(target.maxHp);
    // The authored snap threat (flat 110, mult 2) rides the restored strike.
    expect(target.threat.get(sim.player.id) ?? 0).toBeGreaterThan(110);
    const guard = expectDefined(sim.player.auras.find((aura) => aura.id === 'marrowbreak_guard'));
    expect(guard.kind).toBe('absorb');
    expect(guard.value).toBe(Math.round(sim.player.maxHp * 0.18));
    expect(guard.duration).toBe(8);
    // Cost 15 spent, the guard's 15 rage refunded: parity at 20.
    expect(sim.player.resource).toBe(20);
  });

  it('below half health a non-wearer still gets the replacement (no strike, no threat)', () => {
    const { sim, target } = marrowbreakBelowHalf(false);
    expect(target.hp).toBe(target.maxHp);
    expect(target.threat.get(sim.player.id)).toBeUndefined();
    const guard = expectDefined(sim.player.auras.find((aura) => aura.id === 'marrowbreak_guard'));
    expect(guard.value).toBe(Math.round(sim.player.maxHp * 0.18));
    expect(sim.player.resource).toBe(20);
  });

  it('a mid-fight unequip restores the replacement on the very next press', () => {
    const { sim, target } = marrowbreakBelowHalf(true);
    const hpAfterFirst = target.hp;
    expect(hpAfterFirst).toBeLessThan(target.maxHp);
    sim.unequipItem('helmet'); // 4 worn pieces -> 3: the 4pc tier drops
    sim.player.auras = sim.player.auras.filter((aura) => aura.id !== 'marrowbreak_guard');
    bankOldBlood(sim, 3);
    sim.player.gcdRemaining = 0;
    sim.player.resource = 20;
    sim.castAbility('maul');
    expect(target.hp).toBe(hpAfterFirst); // the guard replaced the strike again
    expect(sim.player.auras.some((aura) => aura.id === 'marrowbreak_guard')).toBe(true);
  });
});

describe('Grovespring 2pc: own blooms first, and Swiftmend heals 25 percent more', () => {
  it('the resolved heal: 141 to 169 for wearers over the 113 to 135 base', () => {
    const healOf = (equipment: Partial<Record<string, string>>) => {
      const eff = entryOf('restoration', equipment, 'swiftmend').effects.find(
        (candidate) => candidate.type === 'consumeAura',
      );
      return eff && 'heal' in eff ? expectDefined(eff.heal) : expectDefined(undefined);
    };
    // Base: the authored 105-125 scaled by the restoration baseline's 0.08
    // healPct (round(105 x 1.08) = 113, 135). Wearer: exactly x1.25 on top.
    expect(healOf({})).toMatchObject({ min: 113, max: 135 });
    expect(healOf(worn('grovespring', 2))).toMatchObject({
      min: Math.round(113 * GROVESPRING_2PC_SWIFTMEND_HEAL_MULT),
      max: Math.round(135 * GROVESPRING_2PC_SWIFTMEND_HEAL_MULT),
    });
    expect(healOf(worn('grovespring', 2))).toMatchObject({ min: 141, max: 169 });
  });

  function restorationWithHots(seed: number, wearer: boolean, ownBloom: boolean) {
    const sim = liveDruid(seed, 'restoration');
    if (wearer) equipSet(sim, 'grovespring', 2);
    const player = sim.player;
    player.hp = Math.round(player.maxHp * 0.3);
    // A FOREIGN HoT first in aura order: the base pick would consume it.
    player.auras.push({
      id: 'rejuvenation',
      name: 'Wildbloom',
      kind: 'hot',
      remaining: 12,
      duration: 12,
      value: 10,
      tickInterval: 3,
      tickTimer: 3,
      sourceId: 999_999,
      school: 'nature',
    });
    if (ownBloom) {
      player.auras.push({
        id: 'regrowth',
        name: 'Second Bloom',
        kind: 'hot',
        remaining: 12,
        duration: 21,
        value: 10,
        tickInterval: 3,
        tickTimer: 3,
        sourceId: player.id,
        school: 'nature',
      });
    }
    sim.castAbility('swiftmend');
    return player;
  }

  it("a wearer consumes their OWN bloom and leaves the other healer's HoT alone", () => {
    const player = restorationWithHots(620, true, true);
    expect(player.auras.some((aura) => aura.id === 'regrowth')).toBe(false);
    expect(
      player.auras.some((aura) => aura.id === 'rejuvenation' && aura.sourceId === 999_999),
    ).toBe(true);
  });

  it('the explicit fallback: with no own bloom the paid cast still consumes and heals', () => {
    const player = restorationWithHots(621, true, false);
    expect(player.auras.some((aura) => aura.id === 'rejuvenation')).toBe(false);
    expect(player.hp).toBeGreaterThan(Math.round(player.maxHp * 0.3));
  });

  it('a non-wearer keeps the base pick (the first HoT, ownership-blind)', () => {
    const player = restorationWithHots(622, false, true);
    expect(
      player.auras.some((aura) => aura.id === 'rejuvenation' && aura.sourceId === 999_999),
    ).toBe(false);
    expect(player.auras.some((aura) => aura.id === 'regrowth')).toBe(true);
  });
});

describe('Grovespring 4pc: Overbloom harvests 75 percent and banks 1 Verdance', () => {
  it('the resolved harvest: 0.75 for wearers, the 0.6 base', () => {
    // Overbloom only exists through the Verdance transform, so the pin
    // resolves it the way play does: the armed Swiftmend button.
    function resolvedHarvest(wearer: boolean): number {
      const sim = liveDruid(627, 'restoration');
      if (wearer) equipSet(sim, 'grovespring', 4);
      for (let cast = 0; cast < 5; cast++) {
        druidEngineOnHotPlanted(ctxOf(sim), sim.player, 'rejuvenation');
      }
      const res = expectDefined(sim.resolvedAbility('swiftmend'));
      expect(res.def.id).toBe('overbloom');
      const eff = res.effects.find((candidate) => candidate.type === 'druidOverbloom');
      return eff && 'harvestPct' in eff ? eff.harvestPct : 0;
    }
    expect(resolvedHarvest(false)).toBe(0.6);
    expect(resolvedHarvest(true)).toBe(GROVESPRING_4PC_OVERBLOOM_HARVEST_PCT);
  });

  function overbloomHarvest(wearer: boolean, rows: Record<number, string> = {}) {
    const sim = liveDruid(623, 'restoration', rows);
    if (wearer) equipSet(sim, 'grovespring', 4);
    const player = sim.player;
    player.hp = Math.round(player.maxHp * 0.3);
    for (let cast = 0; cast < 5; cast++) {
      druidEngineOnHotPlanted(ctxOf(sim), player, 'rejuvenation');
    }
    // One owned HoT with 4 ticks of 10 left: 40 remaining healing to harvest.
    player.auras.push({
      id: 'rejuvenation',
      name: 'Wildbloom',
      kind: 'hot',
      remaining: 12,
      duration: 12,
      value: 10,
      tickInterval: 3,
      tickTimer: 3,
      sourceId: player.id,
      school: 'nature',
    });
    expect(sim.resolvedAbility('swiftmend')?.def.id).toBe('overbloom');
    sim.drainEvents();
    player.gcdRemaining = 0;
    player.resource = player.maxResource;
    sim.castAbility('swiftmend');
    const events = sim.drainEvents();
    const harvest = events.find(
      (event): event is Extract<(typeof events)[number], { type: 'heal2' }> =>
        event.type === 'heal2' && event.ability === 'Overbloom',
    );
    return { sim, player, harvest };
  }

  it('the harvest pays 75 percent of the remaining ticks (30 vs the control 24)', () => {
    const bent = overbloomHarvest(true);
    expect(expectDefined(bent.harvest).amount).toBe(
      Math.round(40 * GROVESPRING_4PC_OVERBLOOM_HARVEST_PCT),
    );
    const control = overbloomHarvest(false);
    expect(expectDefined(control.harvest).amount).toBe(Math.round(40 * 0.6));
  });

  it('banks exactly 1 Verdance after the cast (control banks none)', () => {
    const bent = overbloomHarvest(true);
    expect(stacks(bent.player, VERDANCE_ID)).toBe(GROVESPRING_4PC_VERDANCE_BANK);
    const control = overbloomHarvest(false);
    expect(stacks(control.player, VERDANCE_ID)).toBe(0);
  });

  it("is additive beside the Nature's Fury seed (2 with the row, 1 for its control)", () => {
    const naturesFury = { 20: 'dru_r20_improved_hurricane' };
    const bent = overbloomHarvest(true, naturesFury);
    expect(stacks(bent.player, VERDANCE_ID)).toBe(1 + GROVESPRING_4PC_VERDANCE_BANK);
    const control = overbloomHarvest(false, naturesFury);
    expect(stacks(control.player, VERDANCE_ID)).toBe(1);
  });
});

describe('the wearer literals against the authored copy', () => {
  it('pins every audited druid constant', () => {
    expect(MOONSCORCH_2PC_TEMPEST_EXTEND_CAP_SEC).toBe(12);
    expect(MOONSCORCH_4PC_PAYOFF_DMG_PCT).toBeCloseTo(0.3075, 10);
    expect(WILDFANG_2PC_REDHARVEST_ENERGY_MULT).toBeCloseTo(1.5, 10);
    expect(CINDERBARK_2PC_EXTRA_OLD_BLOOD_CHANCE).toBeCloseTo(0.3, 10);
    expect(CINDERBARK_4PC_MARROWBREAK_DMG_PCT).toBeCloseTo(0.45, 10);
    expect(GROVESPRING_2PC_SWIFTMEND_HEAL_MULT).toBeCloseTo(1.25, 10);
    expect(GROVESPRING_4PC_OVERBLOOM_HARVEST_PCT).toBeCloseTo(0.75, 10);
    expect(GROVESPRING_4PC_VERDANCE_BANK).toBe(1);
    // The base literals the copy's claims lean on.
    const extend = ABILITIES.moonseed.effects.find((eff) => eff.type === 'extendDot');
    expect(extend && 'maxBonus' in extend ? extend.maxBonus : 0).toBe(6);
    const guard = ABILITIES.marrowbreak.effects.find((eff) => eff.type === 'druidMarrowbreakGuard');
    expect(guard).toMatchObject({ belowFrac: 0.5, absorbPctMaxHp: 0.18, rage: 15 });
    expect(ABILITIES.marrowbreak.threat).toEqual({ flat: 110, mult: 2 });
    const overbloom = ABILITIES.overbloom.effects.find((eff) => eff.type === 'druidOverbloom');
    expect(overbloom && 'harvestPct' in overbloom ? overbloom.harvestPct : 0).toBe(0.6);
    const swiftmendHeal = ABILITIES.swiftmend.effects.find((eff) => eff.type === 'consumeAura');
    expect(swiftmendHeal && 'heal' in swiftmendHeal ? swiftmendHeal.heal : undefined).toEqual({
      min: 105,
      max: 125,
    });
  });

  it('extendDot and druidOverbloom stay single-user effect types (splice scoping)', () => {
    // The ability_damage $t/$b arms for these two types are unconditional
    // first-match returns, safe ONLY while each type has exactly one content
    // user. A second ability adopting either type must widen the splice
    // scoping (gate on the ability id) before this pin is re-anchored.
    const usersOf = (type: string): string[] =>
      Object.values(ABILITIES)
        .filter((def) => def.effects.some((eff) => eff.type === type))
        .map((def) => def.id)
        .sort();
    expect(usersOf('extendDot')).toEqual(['moonseed']);
    expect(usersOf('druidOverbloom')).toEqual(['overbloom']);
  });
});
