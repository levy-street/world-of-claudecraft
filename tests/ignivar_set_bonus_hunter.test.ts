// Hunter Crucible set bonuses (docs/prd/ignivar-set-bonus-final.md): each
// bonus proven at the seam it rides. Packlord 2pc is the one generic
// resolved rewrite (a cooldownPct row asserted off abilitiesKnownAt); the
// other five are flag-gated module bends, proven with the warrior-shape
// minimal fake ctx plus live-cast Sim control pairs. No hunter bonus adds or
// removes an rng draw for anyone: Packlord 4pc moves only the threshold of
// the ONE existing reset roll (pinned below by comparing the drawn args),
// and Coldsight 4pc observes the crit the shared damage block already
// rolled. No probed seeds: every rng-adjacent assertion either spies the
// draw (the existing bad-luck-cap test's technique) or forces the outcome
// through critChance 0/1, which keeps the draw count identical.
import { describe, expect, it, vi } from 'vitest';
import {
  coldsightLongDrawCritExtensionSec,
  resolveColdsightAbilityForSpec,
} from '../src/sim/combat/hunter_coldsight';
import {
  FIELDCRAFT_REENTRY_ID,
  HUNTING_MOMENTUM_ID,
  onFieldcraftWeaponStrike,
  SLAGSNARE_MOMENTUM_PRESERVE_ICD_ID,
} from '../src/sim/combat/hunter_fieldcraft';
import { STAMPEDE_READY_AURA_ID, STAMPEDE_RESET_CHANCE } from '../src/sim/combat/hunter_packlord';
import {
  onHunterPrimaryDamage,
  resolveHunterSharedAbilityForTalents,
} from '../src/sim/combat/hunter_shared';
import { abilitiesKnownAt } from '../src/sim/content/classes';
import {
  COLDSIGHT_2PC_MEASURED_SHOT_FOCUS_BONUS,
  COLDSIGHT_4PC_CRIT_EXTENSION_SEC,
  COLDSIGHT_4PC_WINDOW_EXTENSION_CAP_SEC,
  PACKLORD_4PC_STAMPEDE_RESET_CHANCE,
  SLAGSNARE_2PC_GUTTING_STRIKE_FOCUS,
  SLAGSNARE_4PC_MOMENTUM_ICD_SEC,
  setBonusFlag,
} from '../src/sim/content/ignivar_set_bonuses';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { computeCharacterModifiers } from '../src/sim/set_bonus_mods';
import { type ResolvedAbility, Sim } from '../src/sim/sim';
import type { SimContext } from '../src/sim/sim_context';
import type { Aura, Entity, SimEvent } from '../src/sim/types';
import { expectDefined } from './helpers/defined';

const SET_SLOTS = ['helmet', 'shoulder', 'chest', 'gloves', 'legs'] as const;

type TestSim = Sim & {
  addEntity(entity: Entity): void;
  nextId: number;
  ctx: SimContext;
};

function worn(setId: string, pieces: number): Partial<Record<string, string>> {
  const equipment: Partial<Record<string, string>> = {};
  for (const slot of SET_SLOTS.slice(0, pieces)) equipment[slot] = `${setId}_${slot}`;
  return equipment;
}

function hunterMods(spec: string, equipment: Partial<Record<string, string>>) {
  return computeCharacterModifiers('hunter', { spec, rows: {} }, 25, equipment);
}

function measuredShotResolved(spec: string): ResolvedAbility {
  const known = abilitiesKnownAt('hunter', 25, hunterMods(spec, {}));
  return expectDefined(known.find((k) => k.def.id === 'measured_shot')) as ResolvedAbility;
}

function gainAmount(resolved: ResolvedAbility): number {
  const effect = expectDefined(resolved.effects.find((e) => e.type === 'gainResource'));
  return (effect as { amount: number }).amount;
}

function coldFocusAura(sourceId = 1, remaining = 8): Aura {
  return {
    id: 'cold_focus',
    name: 'Cold Focus',
    kind: 'hunter_cold_focus',
    remaining,
    duration: 12,
    value: 1,
    sourceId,
    school: 'physical',
  } satisfies Aura;
}

function momentumAura(sourceId: number, stacks: number): Aura {
  return {
    id: HUNTING_MOMENTUM_ID,
    name: 'Hunting Momentum',
    kind: 'hunter_momentum',
    remaining: 3,
    duration: 8,
    value: stacks,
    stacks,
    sourceId,
    school: 'physical',
  } satisfies Aura;
}

function advance(sim: Sim, seconds: number): SimEvent[] {
  const events: SimEvent[] = [];
  for (let tick = 0; tick < seconds * 20; tick++) events.push(...sim.tick());
  return events;
}

function ready(sim: Sim, abilityId: string): void {
  sim.player.gcdRemaining = 0;
  sim.player.cooldowns.delete(abilityId);
}

function equipSet(sim: Sim, setId: string, pieces: number): void {
  for (const slot of SET_SLOTS.slice(0, pieces)) {
    sim.addItem(`${setId}_${slot}`, 1);
    sim.equipItem(`${setId}_${slot}`);
  }
}

function hunterSim(spec: string, seed: number): TestSim {
  const sim = new Sim({ seed, playerClass: 'hunter', autoEquip: true }) as TestSim;
  sim.setPlayerLevel(25);
  expect(sim.setSpec(spec)).toBe(true);
  return sim;
}

function addTarget(sim: TestSim, distance: number): Entity {
  const target = createMob(
    sim.nextId++,
    MOBS.training_dummy,
    20,
    sim.groundPos(sim.player.pos.x, sim.player.pos.z + distance),
  );
  target.hostile = true;
  target.hp = target.maxHp = 1_000_000;
  sim.addEntity(target);
  return target;
}

function addHunterPet(sim: TestSim): Entity {
  const pet = createMob(sim.nextId++, MOBS.forest_wolf, 20, {
    x: sim.player.pos.x + 1,
    y: sim.player.pos.y,
    z: sim.player.pos.z + 2,
  });
  pet.hostile = false;
  pet.ownerId = sim.playerId;
  pet.hp = pet.maxHp = 1_000;
  sim.addEntity(pet);
  return pet;
}

// Minimal fake ctx (the warrior exemplar shape) whose applyAura keeps real
// same-id-replace semantics so momentum refreshes and lockouts land.
function fakeCtx(mods: ReturnType<typeof hunterMods>, player: Entity) {
  const dealDamageCalls: { ability: string; amount: number }[] = [];
  const ctx = {
    players: new Map([[1, { cls: 'hunter', talents: { spec: mods.spec, rows: {} } }]]),
    playerMods: () => mods,
    entities: new Map([[1, player]]),
    applyAura: (target: Entity, aura: Aura) => {
      const index = target.auras.findIndex((candidate) => candidate.id === aura.id);
      if (index >= 0) target.auras.splice(index, 1);
      target.auras.push(aura);
    },
    emit: () => {},
    dealDamage: (
      _source: Entity,
      _target: Entity,
      amount: number,
      _crit: boolean,
      _school: string,
      ability: string,
    ) => {
      dealDamageCalls.push({ ability, amount });
      return amount;
    },
  } as unknown as SimContext;
  return { ctx, dealDamageCalls };
}

function fakeHunter(auras: Aura[] = []): Entity {
  return {
    id: 1,
    kind: 'player',
    hp: 400,
    maxHp: 400,
    resource: 0,
    maxResource: 100,
    resourceType: 'focus',
    auras,
    cooldowns: new Map<string, number>(),
    dead: false,
  } as unknown as Entity;
}

describe('hunter Crucible sets: the resolver registration', () => {
  it('registers both tiers per worn set and nothing one piece short', () => {
    for (const [setId, spec] of [
      ['packlord_emberhide', 'beast_mastery'],
      ['coldsight_trackers', 'marksmanship'],
      ['slagsnare', 'survival'],
    ] as const) {
      const four = hunterMods(spec, worn(setId, 4));
      expect(four.selected[setBonusFlag(setId, 2)], setId).toBe(true);
      expect(four.selected[setBonusFlag(setId, 4)], setId).toBe(true);
      const oneShort = hunterMods(spec, worn(setId, 1));
      expect(oneShort.selected[setBonusFlag(setId, 2)], setId).toBeUndefined();
      expect(oneShort.selected[setBonusFlag(setId, 4)], setId).toBeUndefined();
    }
  });
});

describe('Packlord 2pc: the Pack Command cooldown row', () => {
  it('resolves Pack Command to a 3 sec cooldown, down from 4', () => {
    const base = abilitiesKnownAt('hunter', 25, hunterMods('beast_mastery', {}));
    const setw = abilitiesKnownAt(
      'hunter',
      25,
      hunterMods('beast_mastery', worn('packlord_emberhide', 2)),
    );
    expect(expectDefined(base.find((k) => k.def.id === 'pack_command')).cooldown).toBe(4);
    expect(expectDefined(setw.find((k) => k.def.id === 'pack_command')).cooldown).toBe(3);
  });
});

describe('Packlord 4pc: the Stampede reset threshold', () => {
  function packlordSim(pieces: number, seed = 4101): { sim: TestSim; target: Entity } {
    const sim = hunterSim('beast_mastery', seed);
    if (pieces > 0) equipSet(sim, 'packlord_emberhide', pieces);
    const target = addTarget(sim, 3);
    addHunterPet(sim);
    sim.targetEntity(target.id);
    return { sim, target };
  }

  function primeEligibleReset(sim: TestSim): void {
    // Stampede on cooldown, beasts expired: the reset roll is eligible on the
    // next landed Pack Command.
    sim.castAbility('stampede');
    advance(sim, 12.5);
    sim.player.auras = sim.player.auras.filter((aura) => aura.kind !== 'hunter_ferocity');
    ready(sim, 'pack_command');
  }

  it('moves only the threshold of the one reset roll: 0.3 for wearers, 0.2 for everyone else', () => {
    // The instant cast dispatches synchronously inside castAbility, so the
    // spy window opens BEFORE the cast (mock false = the pet strike lands and
    // the reset roll fails, leaving a clean arg capture).
    const wearer = packlordSim(4);
    const wearerSpy = vi.spyOn(wearer.sim.ctx.rng, 'chance').mockReturnValue(false);
    primeEligibleReset(wearer.sim);
    wearerSpy.mockClear();
    wearer.sim.castAbility('pack_command');
    advance(wearer.sim, 0.1);

    const control = packlordSim(0);
    const controlSpy = vi.spyOn(control.sim.ctx.rng, 'chance').mockReturnValue(false);
    primeEligibleReset(control.sim);
    controlSpy.mockClear();
    control.sim.castAbility('pack_command');
    advance(control.sim, 0.1);

    const wearerResetArgs = wearerSpy.mock.calls
      .map(([p]) => p)
      .filter((p) => p === STAMPEDE_RESET_CHANCE || p === PACKLORD_4PC_STAMPEDE_RESET_CHANCE);
    const controlResetArgs = controlSpy.mock.calls
      .map(([p]) => p)
      .filter((p) => p === STAMPEDE_RESET_CHANCE || p === PACKLORD_4PC_STAMPEDE_RESET_CHANCE);
    expect(wearerResetArgs).toEqual([PACKLORD_4PC_STAMPEDE_RESET_CHANCE]);
    expect(controlResetArgs).toEqual([STAMPEDE_RESET_CHANCE]);
    // The draw COUNT is identical for wearer and control across the same
    // window: the bend moves a threshold, never adds or removes a roll.
    expect(wearerSpy.mock.calls.length).toBe(controlSpy.mock.calls.length);

    wearerSpy.mockRestore();
    controlSpy.mockRestore();
  });

  it('a passed wearer roll arms the same Stampede Ready machinery', () => {
    const wearer = packlordSim(4, 4103);
    // Pass ONLY the wearer's reset roll: everything else (the pet strike's
    // miss and crit rolls) keeps failing, so the strike still lands.
    const spy = vi
      .spyOn(wearer.sim.ctx.rng, 'chance')
      .mockImplementation((p) => p === PACKLORD_4PC_STAMPEDE_RESET_CHANCE);
    primeEligibleReset(wearer.sim);
    wearer.sim.castAbility('pack_command');
    advance(wearer.sim, 0.1);
    expect(wearer.sim.player.auras.some((aura) => aura.id === STAMPEDE_READY_AURA_ID)).toBe(true);
    spy.mockRestore();
  });

  it('the worn cooldown row reaches the live Pack Command clock', () => {
    const wearer = packlordSim(4, 4104);
    wearer.sim.player.auras = wearer.sim.player.auras.filter(
      (aura) => aura.kind !== 'hunter_ferocity',
    );
    ready(wearer.sim, 'pack_command');
    wearer.sim.castAbility('pack_command');
    const clock = wearer.sim.player.cooldowns.get('pack_command') ?? 0;
    expect(clock).toBeGreaterThan(2.5);
    expect(clock).toBeLessThanOrEqual(3);
  });
});

describe('Coldsight 2pc: the post-rewrite Measured Shot focus hook', () => {
  const baseSelected = hunterMods('marksmanship', {}).selected;
  const wornSelected = hunterMods('marksmanship', worn('coldsight_trackers', 2)).selected;

  it('pins the set doc quartet: 20/30 base, 25/35 for wearers (the +5 lands AFTER the absolute rewrite)', () => {
    const resolved = measuredShotResolved('marksmanship');
    const outOfWindow = fakeHunter([]);
    const inWindow = fakeHunter([coldFocusAura()]);
    expect(
      gainAmount(
        resolveColdsightAbilityForSpec(resolved, outOfWindow, 'marksmanship', baseSelected),
      ),
    ).toBe(20);
    expect(
      gainAmount(resolveColdsightAbilityForSpec(resolved, inWindow, 'marksmanship', baseSelected)),
    ).toBe(30);
    expect(
      gainAmount(
        resolveColdsightAbilityForSpec(resolved, outOfWindow, 'marksmanship', wornSelected),
      ),
    ).toBe(20 + COLDSIGHT_2PC_MEASURED_SHOT_FOCUS_BONUS);
    expect(
      gainAmount(resolveColdsightAbilityForSpec(resolved, inWindow, 'marksmanship', wornSelected)),
    ).toBe(30 + COLDSIGHT_2PC_MEASURED_SHOT_FOCUS_BONUS);
  });

  it('Harrier multiplies AFTER the hook: the disclosed 38/53 wearer pair', () => {
    const resolved = measuredShotResolved('marksmanship');
    const talents = { spec: 'marksmanship' as const, rows: {} };
    const harrier: Aura = {
      id: 'hunter_guise_harrier',
      name: 'Guise Mastery: Harrier',
      kind: 'internal_cd',
      remaining: 6,
      duration: 6,
      value: 1.5,
      sourceId: 1,
      school: 'nature',
    };
    const outOfWindow = fakeHunter([harrier]);
    const inWindow = fakeHunter([harrier, coldFocusAura()]);
    const wornOut = resolveHunterSharedAbilityForTalents(
      resolveColdsightAbilityForSpec(resolved, outOfWindow, 'marksmanship', wornSelected),
      outOfWindow,
      talents,
    );
    const wornIn = resolveHunterSharedAbilityForTalents(
      resolveColdsightAbilityForSpec(resolved, inWindow, 'marksmanship', wornSelected),
      inWindow,
      talents,
    );
    expect(gainAmount(wornOut)).toBe(38); // round(25 * 1.5)
    expect(gainAmount(wornIn)).toBe(53); // round(35 * 1.5)
  });

  it('resolves live through the real Sim chain: 25 outside the window, 35 inside', () => {
    const sim = hunterSim('marksmanship', 4111);
    equipSet(sim, 'coldsight_trackers', 2);
    expect(sim.resolvedAbility('measured_shot')?.effects).toContainEqual({
      type: 'gainResource',
      amount: 25,
    });
    sim.castAbility('cold_focus');
    advance(sim, 0.1);
    expect(sim.resolvedAbility('measured_shot')?.effects).toContainEqual({
      type: 'gainResource',
      amount: 35,
    });
  });
});

describe('Coldsight 4pc: Long Draw criticals extend the window', () => {
  const wornMods = hunterMods('marksmanship', worn('coldsight_trackers', 4));

  it('extends the running window 2 sec per crit, capped at 6 per window', () => {
    const window = coldFocusAura();
    const hunter = fakeHunter([window]);
    const { ctx } = fakeCtx(wornMods, hunter);
    for (const [granted, total] of [
      [2, 2],
      [2, 4],
      [2, 6],
      [0, 6], // the cap
    ] as const) {
      expect(coldsightLongDrawCritExtensionSec(ctx, hunter, 'aimed_shot', true)).toBe(granted);
      expect(window.value2 ?? 0).toBe(total);
    }
    expect(window.remaining).toBe(8 + COLDSIGHT_4PC_WINDOW_EXTENSION_CAP_SEC);
    expect(window.duration).toBe(12 + COLDSIGHT_4PC_WINDOW_EXTENSION_CAP_SEC);
    expect(COLDSIGHT_4PC_CRIT_EXTENSION_SEC).toBe(2);
  });

  it('grants nothing without a crit, outside the window, on other shots, or without the set', () => {
    const inWindow = fakeHunter([coldFocusAura()]);
    const { ctx } = fakeCtx(wornMods, inWindow);
    expect(coldsightLongDrawCritExtensionSec(ctx, inWindow, 'aimed_shot', false)).toBe(0);
    // rapid_fire outranks aimed_shot in the probe (disclosed by the set doc)
    // but deliberately does NOT extend: the bonus reads Long Draw only.
    expect(coldsightLongDrawCritExtensionSec(ctx, inWindow, 'rapid_fire', true)).toBe(0);
    expect(coldsightLongDrawCritExtensionSec(ctx, inWindow, 'arcane_shot', true)).toBe(0);

    const noWindow = fakeHunter([]);
    const noWindowCtx = fakeCtx(wornMods, noWindow).ctx;
    expect(coldsightLongDrawCritExtensionSec(noWindowCtx, noWindow, 'aimed_shot', true)).toBe(0);

    const unworn = fakeHunter([coldFocusAura()]);
    const unwornCtx = fakeCtx(hunterMods('marksmanship', {}), unworn).ctx;
    expect(coldsightLongDrawCritExtensionSec(unwornCtx, unworn, 'aimed_shot', true)).toBe(0);
  });

  it('re-derives Apex Instinct alongside the window (the window + 4 relationship)', () => {
    const window = coldFocusAura();
    const apex: Aura = {
      id: 'hunter_apex_instinct',
      name: 'Apex Instinct',
      kind: 'internal_cd',
      remaining: 12,
      duration: 16,
      value: 3,
      stacks: 3,
      sourceId: 1,
      school: 'physical',
    };
    const hunter = fakeHunter([window, apex]);
    const { ctx } = fakeCtx(wornMods, hunter);
    const res = {
      def: { id: 'aimed_shot', name: 'Long Draw', school: 'physical' },
      effects: [],
    } as unknown as ResolvedAbility;
    onHunterPrimaryDamage(ctx, hunter, fakeHunter([]), res, 100, true);
    expect(window.remaining).toBe(8 + 2);
    expect(apex.remaining).toBe(12 + 2);
    expect(apex.duration).toBe(16 + 2);
    // The stacks are charges, not time: re-derivation never refunds them.
    expect(apex.stacks).toBe(3);
  });

  it('live control pair: a forced crit extends the wearer window, a forced non-crit does not', () => {
    // critChance 1 vs 0 forces the OUTCOME of the same single roll: both runs
    // draw once, so the wearer stream stays draw-identical across the pair.
    // The pin is re-applied every tick because recalcPlayerStats rewrites
    // critChance from gear during the projectile's flight.
    function longDrawRun(critChance: number): TestSim {
      const sim = hunterSim('marksmanship', 4121);
      equipSet(sim, 'coldsight_trackers', 4);
      const target = addTarget(sim, 20);
      sim.targetEntity(target.id);
      sim.player.hitBonus = 1;
      sim.castAbility('cold_focus');
      advance(sim, 0.1);
      sim.player.resource = sim.player.maxResource;
      sim.castAbility('aimed_shot');
      for (let tick = 0; tick < 4 * 20; tick++) {
        sim.player.critChance = critChance;
        sim.tick();
      }
      return sim;
    }
    const critRun = longDrawRun(1);
    const critWindow = expectDefined(critRun.player.auras.find((a) => a.id === 'cold_focus'));
    expect(critWindow.duration).toBe(12 + COLDSIGHT_4PC_CRIT_EXTENSION_SEC);
    expect(critWindow.value2).toBe(COLDSIGHT_4PC_CRIT_EXTENSION_SEC);

    const plainRun = longDrawRun(0);
    const plainWindow = expectDefined(plainRun.player.auras.find((a) => a.id === 'cold_focus'));
    expect(plainWindow.duration).toBe(12);
    expect(plainWindow.value2).toBeUndefined();
  });
});

describe('Slagsnare 2pc: the Gutting Strike focus constant', () => {
  it('grants 20 Focus for wearers and 15 for everyone else', () => {
    for (const [equipment, expected] of [
      [worn('slagsnare', 2), SLAGSNARE_2PC_GUTTING_STRIKE_FOCUS],
      [{}, 15],
    ] as const) {
      const hunter = fakeHunter([]);
      const { ctx } = fakeCtx(hunterMods('survival', equipment), hunter);
      onFieldcraftWeaponStrike(ctx, hunter, fakeHunter([]), 'raptor_strike', 40);
      expect(hunter.resource).toBe(expected);
      // The momentum grant beside the focus grant is untouched.
      expect(hunter.auras.find((aura) => aura.id === HUNTING_MOMENTUM_ID)?.stacks).toBe(1);
    }
  });

  it('the Harrier rider still applies AFTER the bend (preResolved stays false)', () => {
    const harrier: Aura = {
      id: 'hunter_guise_harrier',
      name: 'Guise Mastery: Harrier',
      kind: 'internal_cd',
      remaining: 6,
      duration: 6,
      value: 1.5,
      sourceId: 1,
      school: 'nature',
    };
    const hunter = fakeHunter([harrier]);
    const { ctx } = fakeCtx(hunterMods('survival', worn('slagsnare', 2)), hunter);
    onFieldcraftWeaponStrike(ctx, hunter, fakeHunter([]), 'raptor_strike', 40);
    expect(hunter.resource).toBe(Math.round(SLAGSNARE_2PC_GUTTING_STRIKE_FOCUS * 1.5));
  });
});

describe('Slagsnare 4pc: the Woundrend preserve and its 8 sec lockout', () => {
  const wornMods = hunterMods('survival', worn('slagsnare', 4));

  it('preserves the 3 consumed stacks once, then the lockout lets the next consume spend them', () => {
    const hunter = fakeHunter([momentumAura(1, 3)]);
    const { ctx, dealDamageCalls } = fakeCtx(wornMods, hunter);
    const target = fakeHunter([]);

    onFieldcraftWeaponStrike(ctx, hunter, target, 'mongoose_bite', 100);
    const momentum = expectDefined(hunter.auras.find((aura) => aura.id === HUNTING_MOMENTUM_ID));
    expect(momentum.stacks).toBe(3);
    // The :227 refresh restarted the window before the preserve, so the kept
    // stacks carry the full 8 sec the lockout mirrors.
    expect(momentum.remaining).toBe(momentum.duration);
    const lockout = expectDefined(
      hunter.auras.find((aura) => aura.id === SLAGSNARE_MOMENTUM_PRESERVE_ICD_ID),
    );
    expect(lockout.duration).toBe(SLAGSNARE_4PC_MOMENTUM_ICD_SEC);
    // The R3 wording alignment: the lockout MATCHES the Momentum window.
    expect(lockout.duration).toBe(momentum.duration);
    // The payoff stays at 3-stack value (0.15 per stack on the dealt 100).
    expect(dealDamageCalls).toContainEqual({ ability: 'Hunting Momentum', amount: 45 });

    // Inside the lockout the next Woundrend consume SPENDS the stacks.
    onFieldcraftWeaponStrike(ctx, hunter, target, 'mongoose_bite', 100);
    expect(hunter.auras.some((aura) => aura.id === HUNTING_MOMENTUM_ID)).toBe(false);
    expect(hunter.auras.some((aura) => aura.id === SLAGSNARE_MOMENTUM_PRESERVE_ICD_ID)).toBe(true);
  });

  it('non-wearers consume as before, and below 3 stacks nothing arms', () => {
    const control = fakeHunter([momentumAura(1, 3)]);
    const controlCtx = fakeCtx(hunterMods('survival', {}), control).ctx;
    onFieldcraftWeaponStrike(controlCtx, control, fakeHunter([]), 'mongoose_bite', 100);
    expect(control.auras.some((aura) => aura.id === HUNTING_MOMENTUM_ID)).toBe(false);
    expect(control.auras.some((aura) => aura.id === SLAGSNARE_MOMENTUM_PRESERVE_ICD_ID)).toBe(
      false,
    );

    const twoStacks = fakeHunter([momentumAura(1, 2)]);
    const twoCtx = fakeCtx(wornMods, twoStacks).ctx;
    onFieldcraftWeaponStrike(twoCtx, twoStacks, fakeHunter([]), 'mongoose_bite', 100);
    expect(twoStacks.auras.find((aura) => aura.id === HUNTING_MOMENTUM_ID)?.stacks).toBe(2);
    expect(twoStacks.auras.some((aura) => aura.id === SLAGSNARE_MOMENTUM_PRESERVE_ICD_ID)).toBe(
      false,
    );
  });

  it('stays scoped to the Woundrend site: the armed Re-entry consume still spends for wearers', () => {
    const hunter = fakeHunter([
      momentumAura(1, 2),
      {
        id: FIELDCRAFT_REENTRY_ID,
        name: 'Armed Re-entry',
        kind: 'hunter_reentry',
        remaining: 12,
        duration: 12,
        value: 2,
        stacks: 2,
        sourceId: 1,
        school: 'physical',
      },
    ]);
    const { ctx } = fakeCtx(wornMods, hunter);
    // The Gutting Strike re-entry consume reaches 3 stacks and spends them:
    // the 4pc never reaches this site.
    onFieldcraftWeaponStrike(ctx, hunter, fakeHunter([]), 'raptor_strike', 40);
    expect(hunter.auras.some((aura) => aura.id === HUNTING_MOMENTUM_ID)).toBe(false);
    expect(hunter.auras.some((aura) => aura.id === SLAGSNARE_MOMENTUM_PRESERVE_ICD_ID)).toBe(false);
  });

  it('live control pair: the wearer keeps 3 Hunting Momentum through a Woundrend tear', () => {
    function fieldcraftRun(pieces: number): TestSim {
      const sim = hunterSim('survival', 4131);
      if (pieces > 0) equipSet(sim, 'slagsnare', pieces);
      const target = addTarget(sim, 2);
      sim.targetEntity(target.id);
      sim.player.hitBonus = 1;
      // The weapon hit table can still whiff a strike (dodge stays live), so
      // build to 3 Momentum with a bounded re-strike loop instead of pinning
      // per-cast outcomes; the whole build stays inside the 8 sec window.
      const stacks = () =>
        sim.player.auras.find((aura) => aura.id === HUNTING_MOMENTUM_ID)?.stacks ?? 0;
      for (let cast = 0; cast < 12 && stacks() < 3; cast++) {
        ready(sim, 'raptor_strike');
        sim.castAbility('raptor_strike');
        advance(sim, 0.1);
      }
      expect(stacks()).toBe(3);
      // The Woundrend tear itself must land: retry a whiffed strike while the
      // preserved-or-not state is still untouched (no wound, no momentum drop
      // happens on a miss; onFieldcraftWeaponStrike requires dealt > 0).
      for (let cast = 0; cast < 12 && stacks() === 3; cast++) {
        sim.player.resource = sim.player.maxResource;
        ready(sim, 'mongoose_bite');
        sim.castAbility('mongoose_bite');
        advance(sim, 0.1);
        if (sim.player.auras.some((aura) => aura.id === SLAGSNARE_MOMENTUM_PRESERVE_ICD_ID)) {
          break; // the wearer's tear landed and preserved
        }
      }
      return sim;
    }

    const wearer = fieldcraftRun(4);
    expect(wearer.player.auras.find((aura) => aura.id === HUNTING_MOMENTUM_ID)?.stacks).toBe(3);
    expect(wearer.player.auras.some((aura) => aura.id === SLAGSNARE_MOMENTUM_PRESERVE_ICD_ID)).toBe(
      true,
    );
    // A second tear inside the lockout spends the stacks even for the wearer
    // (retrying a whiffed strike; the lockout far outlasts these ticks).
    for (
      let cast = 0;
      cast < 12 && wearer.player.auras.some((aura) => aura.id === HUNTING_MOMENTUM_ID);
      cast++
    ) {
      wearer.player.resource = wearer.player.maxResource;
      ready(wearer, 'mongoose_bite');
      wearer.castAbility('mongoose_bite');
      advance(wearer, 0.1);
    }
    expect(wearer.player.auras.some((aura) => aura.id === HUNTING_MOMENTUM_ID)).toBe(false);

    const control = fieldcraftRun(0);
    expect(control.player.auras.some((aura) => aura.id === HUNTING_MOMENTUM_ID)).toBe(false);
    expect(
      control.player.auras.some((aura) => aura.id === SLAGSNARE_MOMENTUM_PRESERVE_ICD_ID),
    ).toBe(false);
  });
});
