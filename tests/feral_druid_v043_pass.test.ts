// The v0.43 Wildfang pass, one suite per change:
//   1. every melee attack a feral druid makes reaches 1 yd further
//   2. Slinkstrike and Lunge each bank 1 Old Blood (cap 3)
//   3. Nature's Boon: a landed autoattack has a 1-in-15 chance to arm one free
//      Wildbloom (any form) OR Oakhide (Bruin only) for 10 sec, 25% stronger
//   4. Savage Mending is a Bruin AND Cat button
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  druidEngineOnLandedStrike,
  OLD_BLOOD_ID,
  OLD_BLOOD_STAGES,
} from '../src/sim/combat/druid_engines';
import {
  applyDruidFormEntry,
  druidFormEntryOwed,
  druidFormEntryTarget,
} from '../src/sim/combat/druid_form_entry';
import {
  NATURES_BOON_ABILITIES,
  NATURES_BOON_CHANCE,
  NATURES_BOON_DURATION,
  NATURES_BOON_ID,
  NATURES_BOON_POWER,
  naturesBoonArmedFor,
  naturesBoonFormAllows,
  naturesBoonOnAutoAttack,
} from '../src/sim/combat/druid_natures_boon';
import { FERAL_MELEE_REACH_BONUS, feralMeleeReachBonus } from '../src/sim/combat/feral_reach';
import { willAutoUnshift } from '../src/sim/combat/form_auto_unshift';
import { formRequirementMet, requiredForms } from '../src/sim/combat/form_requirement';
import {
  effectivePlayerAttackRange,
  RAID_BOSS_PLAYER_MELEE_RANGE,
} from '../src/sim/combat/player_attack_reach';
import { talentsFor } from '../src/sim/content/talents';
import { ABILITIES, MOBS } from '../src/sim/data';
import { createMob, recalcPlayerStats } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { Aura, Entity } from '../src/sim/types';
import { IGNIVAR_BOSS_ID, MELEE_RANGE } from '../src/sim/types';
import { makeSlotState } from '../src/ui/hud/action_bar/action_bar_view';

type Spec = 'balance' | 'feral' | 'restoration';

/** Exact number of windows 600 landed autos arm through the real 1-in-15 roll
 *  for the seed-43 rig below (see the rate pin in suite 3). Re-measure only when
 *  the rig's draw order changes, never to make a drifted rate pass. */
const RATE_PIN_ARMS_AT_SEED_43 = 41;

function rig(spec: Spec) {
  const sim = new Sim({ seed: 43, playerClass: 'druid', autoEquip: true });
  sim.setPlayerLevel(20);
  expect(sim.applyTalents({ spec, rows: {} })).toBe(true);
  sim.player.resource = sim.player.maxResource;
  return { sim, player: sim.player };
}

function simCtx(sim: Sim): {
  rng: { setObserver(observer: ((value: number) => void) | null): void };
  players: Map<number, unknown>;
} {
  return (
    sim as unknown as {
      ctx: {
        rng: { setObserver(observer: ((value: number) => void) | null): void };
        players: Map<number, unknown>;
      };
    }
  ).ctx;
}

// biome-ignore lint/suspicious/noExplicitAny: the SimContext shape is internal to Sim.
function rawCtx(sim: Sim): any {
  return (sim as unknown as { ctx: unknown }).ctx;
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

function spawnMob(sim: Sim, distance: number, templateId = 'forest_wolf'): Entity {
  const player = sim.player;
  const mob = createMob(9930, MOBS[templateId] ?? MOBS.forest_wolf, 20, {
    x: player.pos.x,
    y: player.pos.y,
    z: player.pos.z + distance,
  });
  mob.templateId = templateId;
  mob.hostile = true;
  mob.maxHp = mob.hp = 1_000_000;
  (sim as unknown as { addEntity(entity: Entity): void }).addEntity(mob);
  sim.targetEntity(mob.id);
  player.facing = 0;
  return mob;
}

/** Shift for real (the form button, not a pushed aura) so the resource pool,
 *  stats, and form aura all land the way they do in play, then wait out the
 *  global cooldown the shift costs. */
function shiftInto(sim: Sim, formAbilityId: 'bear_form' | 'cat_form'): void {
  sim.player.resource = sim.player.maxResource;
  sim.castAbility(formAbilityId);
  for (let tick = 0; tick < 40; tick++) sim.tick();
  sim.player.resource = sim.player.maxResource;
}

/** Arm the window through the REAL hook with the 1-in-15 roll forced, in exactly
 *  one call and without drawing rng. Looping the hook until it happens would
 *  work too, but every failed roll advances the shared stream and so changes
 *  what the spell cast afterwards rolls on the hit table. */
function armBoon(sim: Sim): void {
  // biome-ignore lint/suspicious/noExplicitAny: reaching the Rng behind SimContext.
  const rng = rawCtx(sim).rng as any;
  const realChance = rng.chance.bind(rng);
  rng.chance = () => true;
  try {
    naturesBoonOnAutoAttack(rawCtx(sim), sim.player);
  } finally {
    rng.chance = realChance;
  }
}

function stacks(player: Entity, id: string): number {
  return player.auras.find((aura) => aura.id === id)?.stacks ?? 0;
}

function aura(player: Entity, id: string): Aura | undefined {
  return player.auras.find((entry) => entry.id === id);
}

/** Counts every rng draw a callback costs, through the Rng test observer. */
function countDraws(sim: Sim, run: () => void): number {
  let draws = 0;
  simCtx(sim).rng.setObserver(() => {
    draws++;
  });
  try {
    run();
  } finally {
    simCtx(sim).rng.setObserver(null);
  }
  return draws;
}

const FERAL = { cls: 'druid', spec: 'feral' } as const;
const BALANCE = { cls: 'druid', spec: 'balance' } as const;
const WARRIOR = { cls: 'warrior', spec: 'arms' } as const;
const WOLF = { kind: 'mob', templateId: 'forest_wolf' };
const RAID_BOSS = { kind: 'mob', templateId: IGNIVAR_BOSS_ID };

describe('1. Wildfang reach: +1 yd on melee attacks', () => {
  it('adds exactly one yard, and only for a committed feral druid', () => {
    expect(FERAL_MELEE_REACH_BONUS).toBe(1);
    expect(feralMeleeReachBonus(FERAL, 0)).toBe(1);
    expect(feralMeleeReachBonus(FERAL, MELEE_RANGE)).toBe(1);
    // Every other attacker, including the druid's other two specs.
    expect(feralMeleeReachBonus(BALANCE, 0)).toBe(0);
    expect(feralMeleeReachBonus({ cls: 'druid', spec: 'restoration' }, 0)).toBe(0);
    expect(feralMeleeReachBonus(WARRIOR, 0)).toBe(0);
    expect(feralMeleeReachBonus(null, 0)).toBe(0);
    expect(feralMeleeReachBonus({ cls: null, spec: 'feral' }, 0)).toBe(0);
    expect(feralMeleeReachBonus({ cls: 'druid', spec: null }, 0)).toBe(0);
  });

  it('leaves every non-melee range alone, Lunge and Slinkstrike included', () => {
    expect(ABILITIES.lunge.range).toBe(25);
    expect(ABILITIES.pounce.range).toBe(8);
    expect(feralMeleeReachBonus(FERAL, ABILITIES.lunge.range)).toBe(0);
    expect(feralMeleeReachBonus(FERAL, ABILITIES.pounce.range)).toBe(0);
    expect(feralMeleeReachBonus(FERAL, MELEE_RANGE + 1)).toBe(0);
    expect(feralMeleeReachBonus(FERAL, 30)).toBe(0);
  });

  it('rides the shared reach seam without moving anyone else', () => {
    // Omitting the attacker keeps the pre-v0.43 answer exactly.
    expect(effectivePlayerAttackRange(WOLF, MELEE_RANGE)).toBe(MELEE_RANGE);
    expect(effectivePlayerAttackRange(WOLF, 0)).toBe(MELEE_RANGE);
    expect(effectivePlayerAttackRange(WOLF, MELEE_RANGE, BALANCE)).toBe(MELEE_RANGE);
    expect(effectivePlayerAttackRange(WOLF, MELEE_RANGE, FERAL)).toBe(MELEE_RANGE + 1);
    expect(effectivePlayerAttackRange(WOLF, 0, FERAL)).toBe(MELEE_RANGE + 1);
    // A ranged button keeps its authored range for everybody.
    expect(effectivePlayerAttackRange(WOLF, 30, FERAL)).toBe(30);
    // The raid-boss hitbox allowance stacks with it rather than replacing it.
    expect(effectivePlayerAttackRange(RAID_BOSS, MELEE_RANGE, BALANCE)).toBe(
      RAID_BOSS_PLAYER_MELEE_RANGE,
    );
    expect(effectivePlayerAttackRange(RAID_BOSS, MELEE_RANGE, FERAL)).toBe(
      RAID_BOSS_PLAYER_MELEE_RANGE + 1,
    );
  });

  it('lets a feral druid land Claw at a range that refuses a balance druid', () => {
    const reach = MELEE_RANGE + 0.5;

    const feral = rig('feral');
    feral.player.auras.push(formAura(feral.player, 'form_cat'));
    const feralMob = spawnMob(feral.sim, reach);
    const feralHpBefore = feralMob.hp;
    feral.sim.castAbility('claw');
    for (let tick = 0; tick < 4; tick++) feral.sim.tick();
    expect(feralMob.hp).toBeLessThan(feralHpBefore);

    // Same distance, same button, a spec without the reach: nothing lands.
    const balance = rig('balance');
    balance.player.auras.push(formAura(balance.player, 'form_cat'));
    const balanceMob = spawnMob(balance.sim, reach);
    const balanceHpBefore = balanceMob.hp;
    balance.sim.castAbility('claw');
    for (let tick = 0; tick < 4; tick++) balance.sim.tick();
    expect(balanceMob.hp).toBe(balanceHpBefore);

    // Positive control for the balance rig: the same druid, same button, a
    // half yard INSIDE ordinary melee range does land, so the miss above is the
    // missing reach and not the pushed form aura or the mana pool.
    const control = rig('balance');
    control.player.auras.push(formAura(control.player, 'form_cat'));
    const controlMob = spawnMob(control.sim, MELEE_RANGE - 0.5);
    const controlHpBefore = controlMob.hp;
    control.sim.castAbility('claw');
    for (let tick = 0; tick < 4; tick++) control.sim.tick();
    expect(controlMob.hp).toBeLessThan(controlHpBefore);
  });
});

describe('2. Slinkstrike and Lunge bank Old Blood', () => {
  it('banks one stage each, capped at three', () => {
    const { sim, player } = rig('feral');
    const ctx = rawCtx(sim);

    druidEngineOnLandedStrike(ctx, player, 'pounce');
    expect(stacks(player, OLD_BLOOD_ID)).toBe(1);
    druidEngineOnLandedStrike(ctx, player, 'lunge');
    expect(stacks(player, OLD_BLOOD_ID)).toBe(2);
    druidEngineOnLandedStrike(ctx, player, 'pounce');
    expect(stacks(player, OLD_BLOOD_ID)).toBe(3);
    // The cap is the existing OLD_BLOOD_STAGES, not a second number.
    expect(OLD_BLOOD_STAGES).toBe(3);
    druidEngineOnLandedStrike(ctx, player, 'lunge');
    expect(stacks(player, OLD_BLOOD_ID)).toBe(OLD_BLOOD_STAGES);
  });

  it('stays feral-only: the other druid specs bank nothing', () => {
    for (const spec of ['balance', 'restoration'] as const) {
      const { sim, player } = rig(spec);
      druidEngineOnLandedStrike(rawCtx(sim), player, 'pounce');
      druidEngineOnLandedStrike(rawCtx(sim), player, 'lunge');
      expect(player.auras.some((entry) => entry.id === OLD_BLOOD_ID)).toBe(false);
    }
  });

  it('banks through the real Slinkstrike cast, on the tick its stun lands', () => {
    const { sim, player } = rig('feral');
    player.auras.push(formAura(player, 'form_cat'));
    player.auras.push(formAura(player, 'stealth'));
    const mob = spawnMob(sim, 3);

    sim.castAbility('pounce');
    for (let tick = 0; tick < 4; tick++) sim.tick();

    expect(mob.auras.some((entry) => entry.kind === 'stun')).toBe(true);
    expect(stacks(player, OLD_BLOOD_ID)).toBe(1);
    // The combo point the opener already paid is untouched by the new bank.
    expect(player.comboPoints).toBe(1);
  });
});

describe("3. Nature's Boon", () => {
  it('arms both spells at once for ten seconds', () => {
    // About one proc per 15 sec at Cat Form's fixed 1.0 sec swing.
    expect(NATURES_BOON_CHANCE).toBeCloseTo(1 / 15, 10);
    expect(NATURES_BOON_DURATION).toBe(10);
    expect(NATURES_BOON_POWER).toBe(1.25);
    expect([...NATURES_BOON_ABILITIES].sort()).toEqual(['barkskin', 'rejuvenation']);
  });

  it('advertises the shipped numbers in the Wildfang spec description', () => {
    // The spec text is the one place a player reads the passive, so its four
    // numbers are pinned to the constants that drive it rather than typed twice.
    const feral = talentsFor('druid')?.specs.find((spec) => spec.id === 'feral');
    expect(feral).toBeDefined();
    const text = feral?.description ?? '';
    expect(text).toContain(`Reaches ${FERAL_MELEE_REACH_BONUS} yd further`);
    expect(text).toContain(`about every ${Math.round(1 / NATURES_BOON_CHANCE)} sec`);
    expect(text).toContain(`for ${NATURES_BOON_DURATION} sec`);
    expect(text).toContain(`${Math.round((NATURES_BOON_POWER - 1) * 100)}% stronger`);
  });

  it('recognizes an armed window for either spell and nothing else', () => {
    const armed = [
      {
        id: NATURES_BOON_ID,
        kind: 'next_cast_free',
        empowerAbilities: [...NATURES_BOON_ABILITIES],
      },
    ];
    expect(naturesBoonArmedFor(armed, 'rejuvenation')).toBe(true);
    // Oakhide is bear-only, and this list carries no form aura.
    expect(naturesBoonArmedFor(armed, 'barkskin')).toBe(false);
    expect(naturesBoonArmedFor([...armed, { kind: 'form_bear' }], 'barkskin')).toBe(true);
    expect(naturesBoonArmedFor(armed, 'moonfire')).toBe(false);
    expect(naturesBoonArmedFor(armed, 'entangling_roots')).toBe(false);
    expect(naturesBoonArmedFor(armed, 'wrath')).toBe(false);
    expect(naturesBoonArmedFor(armed, 'claw')).toBe(false);
    expect(naturesBoonArmedFor(armed, undefined)).toBe(false);
    expect(naturesBoonArmedFor([], 'rejuvenation')).toBe(false);
    // A free-cast aura that is NOT this passive never opens the form gate.
    expect(
      naturesBoonArmedFor(
        [{ id: 'clearcasting', kind: 'next_cast_free', empowerAbilities: ['rejuvenation'] }],
        'rejuvenation',
      ),
    ).toBe(false);
    // The right id in the wrong state (already spent down to another kind).
    expect(
      naturesBoonArmedFor(
        [{ id: NATURES_BOON_ID, kind: 'buff_speed', empowerAbilities: ['rejuvenation'] }],
        'rejuvenation',
      ),
    ).toBe(false);
  });

  it('rolls once per landed autoattack for a feral druid, and arms on a hit', () => {
    const { sim, player } = rig('feral');
    const ctx = rawCtx(sim);
    const draws = countDraws(sim, () => {
      naturesBoonOnAutoAttack(ctx, player);
    });
    expect(draws).toBe(1);
  });

  it('arms at the 1-in-15 rate through the real roll (an exact seeded count)', () => {
    // The constant pin above says what the rate SHOULD be; this pins what the
    // hook actually rolls. 600 landed autos through the real hook and the real
    // seeded rng, each armed window cleared so the next proc is a fresh arm.
    // The count is exact for seed 43, and it separates the shipped 1-in-15
    // from both neighbours: the same stream arms 61 times at 1-in-10 and 33
    // at 1-in-20, so a drifted threshold reds this even when every other
    // test (which forces the roll through armBoon) stays green.
    const { sim, player } = rig('feral');
    const ctx = rawCtx(sim);
    const swings = 600;
    let armed = 0;
    for (let swing = 0; swing < swings; swing++) {
      naturesBoonOnAutoAttack(ctx, player);
      const index = player.auras.findIndex((entry) => entry.id === NATURES_BOON_ID);
      if (index < 0) continue;
      armed++;
      player.auras.splice(index, 1);
    }
    expect(armed).toBe(RATE_PIN_ARMS_AT_SEED_43);
    // Sanity on the band, so a future re-seed lands the new exact count near
    // the expectation rather than on a silently wrong rate.
    expect(Math.abs(armed - swings * NATURES_BOON_CHANCE)).toBeLessThan(12);
  });

  it('draws no rng at all for a player who is not a feral druid', () => {
    for (const spec of ['balance', 'restoration'] as const) {
      const { sim, player } = rig(spec);
      const ctx = rawCtx(sim);
      const draws = countDraws(sim, () => {
        naturesBoonOnAutoAttack(ctx, player);
      });
      expect(draws).toBe(0);
      expect(player.auras.some((entry) => entry.id === NATURES_BOON_ID)).toBe(false);
    }
    const warrior = new Sim({ seed: 43, playerClass: 'warrior', autoEquip: true });
    warrior.setPlayerLevel(20);
    expect(
      countDraws(warrior, () => {
        naturesBoonOnAutoAttack(rawCtx(warrior), warrior.player);
      }),
    ).toBe(0);
  });

  it('applies a ten second free-cast window scoped to the two spells', () => {
    const { sim, player } = rig('feral');
    armBoon(sim);
    const window = aura(player, NATURES_BOON_ID);
    expect(window).toBeDefined();
    expect(window?.kind).toBe('next_cast_free');
    expect(window?.duration).toBe(NATURES_BOON_DURATION);
    expect(window?.remaining).toBe(NATURES_BOON_DURATION);
    expect([...(window?.empowerAbilities ?? [])].sort()).toEqual(['barkskin', 'rejuvenation']);
  });

  it('keeps the druid in form: an armed window never auto-unshifts', () => {
    const bear = [{ kind: 'form_bear' } as Pick<Aura, 'kind'>];
    // Baseline, unchanged: both spells drop the form when nothing is armed.
    expect(willAutoUnshift(bear, ABILITIES.rejuvenation)).toBe(true);
    expect(willAutoUnshift(bear, ABILITIES.moonfire)).toBe(true);
    const armedBear = [
      { kind: 'form_bear' },
      {
        kind: 'next_cast_free',
        id: NATURES_BOON_ID,
        empowerAbilities: [...NATURES_BOON_ABILITIES],
      },
    ] as Parameters<typeof willAutoUnshift>[0];
    expect(willAutoUnshift(armedBear, ABILITIES.rejuvenation)).toBe(false);
    // Lunar Tempest is not a window member, so it unshifts as it always did.
    expect(willAutoUnshift(armedBear, ABILITIES.moonfire)).toBe(true);
    // A spell the window does not name still unshifts.
    expect(willAutoUnshift(armedBear, ABILITIES.wrath)).toBe(true);
  });

  it('casts Wildbloom from Cat Form for free, keeping the form, and spends the window', () => {
    const { sim, player } = rig('feral');
    player.auras.push(formAura(player, 'form_cat'));
    armBoon(sim);
    expect(aura(player, NATURES_BOON_ID)).toBeDefined();
    const energyBefore = player.resource;

    sim.castAbility('rejuvenation');
    for (let tick = 0; tick < 3; tick++) sim.tick();

    expect(player.auras.some((entry) => entry.kind === 'hot' && entry.id === 'rejuvenation')).toBe(
      true,
    );
    // Free, and still a cat.
    expect(player.resource).toBe(energyBefore);
    expect(player.auras.some((entry) => entry.kind === 'form_cat')).toBe(true);
    // One window, one cast.
    expect(aura(player, NATURES_BOON_ID)).toBeUndefined();

    // First cast wins: the OTHER member reverts. Oakhide pressed next, from
    // Bruin Form where the window would have paid for it, bills its full cost
    // and lands at its plain 20%, not the empowered 25%.
    shiftInto(sim, 'bear_form');
    player.resource = player.maxResource;
    const rageBefore = player.resource;
    sim.castAbility('barkskin');
    for (let tick = 0; tick < 3; tick++) sim.tick();
    expect(player.resource).toBe(rageBefore - ABILITIES.barkskin.cost);
    expect(player.auras.find((entry) => entry.kind === 'buff_armor_pct')?.value).toBe(20);
  });

  it('leaves the unarmed behavior exactly as it was: Wildbloom drops Cat Form', () => {
    const { sim, player } = rig('feral');
    player.auras.push(formAura(player, 'form_cat'));
    expect(aura(player, NATURES_BOON_ID)).toBeUndefined();

    sim.castAbility('rejuvenation');
    for (let tick = 0; tick < 3; tick++) sim.tick();

    expect(player.auras.some((entry) => entry.kind === 'form_cat')).toBe(false);
  });
});

describe('4. Savage Mending is a Bruin and Cat button', () => {
  it('declares both forms', () => {
    expect(requiredForms(ABILITIES.frenzied_regeneration)).toEqual(['bear', 'cat']);
    // The single-form buttons are untouched.
    expect(requiredForms(ABILITIES.maul)).toEqual(['bear']);
    expect(requiredForms(ABILITIES.claw)).toEqual(['cat']);
    expect(requiredForms(ABILITIES.wrath)).toEqual([]);
  });

  it('is satisfied by either form and by neither otherwise', () => {
    const mending = ABILITIES.frenzied_regeneration;
    expect(formRequirementMet([{ kind: 'form_bear' }], mending)).toBe(true);
    expect(formRequirementMet([{ kind: 'form_cat' }], mending)).toBe(true);
    expect(formRequirementMet([{ kind: 'form_travel' }], mending)).toBe(false);
    expect(formRequirementMet([], mending)).toBe(false);
    // Cat Form does not unlock a Bruin-only button.
    expect(formRequirementMet([{ kind: 'form_cat' }], ABILITIES.maul)).toBe(false);
    // An ability with no requirement is trivially satisfied.
    expect(formRequirementMet([], ABILITIES.wrath)).toBe(true);
  });

  it('keeps the authored cost and cooldown, so Cat pays 10 Energy', () => {
    expect(ABILITIES.frenzied_regeneration.cost).toBe(10);
    expect(ABILITIES.frenzied_regeneration.cooldown).toBe(60);

    const { sim, player } = rig('feral');
    shiftInto(sim, 'cat_form');
    // Cat Form runs on Energy, so the authored cost of 10 IS 10 Energy here.
    expect(player.resourceType).toBe('energy');
    const energyBefore = player.resource;

    sim.castAbility('frenzied_regeneration');
    sim.tick();

    expect(player.auras.some((entry) => entry.id === 'frenzied_regeneration')).toBe(true);
    expect(energyBefore - player.resource).toBe(10);
    expect(player.cooldowns.get('frenzied_regeneration')).toBeGreaterThan(50);
  });

  it('still works from Bruin Form', () => {
    const { sim, player } = rig('feral');
    shiftInto(sim, 'bear_form');
    expect(player.resourceType).toBe('rage');

    sim.castAbility('frenzied_regeneration');
    sim.tick();

    expect(player.auras.some((entry) => entry.id === 'frenzied_regeneration')).toBe(true);
  });

  it('is still refused out of form', () => {
    const { sim, player } = rig('feral');
    expect(player.auras.some((entry) => entry.kind.startsWith('form_'))).toBe(false);

    sim.castAbility('frenzied_regeneration');
    sim.tick();

    expect(player.auras.some((entry) => entry.id === 'frenzied_regeneration')).toBe(false);
    expect(player.cooldowns.has('frenzied_regeneration')).toBe(false);
  });
});

describe('5. Stalk enters Cat Form from anywhere', () => {
  it('no longer requires Cat Form and stays on the global cooldown', () => {
    const stalk = ABILITIES.prowl;
    expect(requiredForms(stalk)).toEqual([]);
    // usableInForm is what keeps the shapeshift lock from refusing the press
    // while wearing Bruin, Fleet or Moonwing.
    expect(stalk.usableInForm).toBe(true);
    // The press costs a GCD: offGcd is absent, which is what "on the GCD" means
    // for every other ability in the table.
    expect(stalk.offGcd).toBeUndefined();
    expect(stalk.requiresOutOfCombat).toBe(true);
  });

  it('knows when a shift is owed', () => {
    const druid = { cls: 'druid' as const };
    expect(druidFormEntryOwed(druid, [], 'prowl')).toBe(true);
    expect(druidFormEntryOwed(druid, [{ kind: 'form_bear' }], 'prowl')).toBe(true);
    expect(druidFormEntryOwed(druid, [{ kind: 'form_travel' }], 'prowl')).toBe(true);
    // Already a cat: nothing owed.
    expect(druidFormEntryOwed(druid, [{ kind: 'form_cat' }], 'prowl')).toBe(false);
    // Another class's button of the same id, and the druid's other buttons.
    expect(druidFormEntryOwed({ cls: 'rogue' }, [], 'prowl')).toBe(false);
    expect(druidFormEntryOwed(druid, [], 'claw')).toBe(false);
  });

  it('shifts a caster-form druid into Cat Form and stealths, in one press', () => {
    const { sim, player } = rig('feral');
    expect(player.auras.some((a) => a.kind.startsWith('form_'))).toBe(false);

    sim.castAbility('prowl');
    for (let tick = 0; tick < 5; tick++) sim.tick();

    expect(player.auras.some((a) => a.kind === 'form_cat')).toBe(true);
    expect(player.auras.some((a) => a.kind === 'stealth')).toBe(true);
    expect(player.stealthed).toBe(true);
    // The form aura carries the CAT FORM id, not Stalk's, so the Cat Form
    // button's own toggle-off can still find and clear it.
    expect(player.auras.find((a) => a.kind === 'form_cat')?.id).toBe('cat_form');
  });

  it('swaps Bruin Form for Cat Form rather than stacking them', () => {
    const { sim, player } = rig('feral');
    shiftInto(sim, 'bear_form');
    expect(player.auras.some((a) => a.kind === 'form_bear')).toBe(true);

    sim.castAbility('prowl');
    for (let tick = 0; tick < 5; tick++) sim.tick();

    expect(player.auras.some((a) => a.kind === 'form_bear')).toBe(false);
    expect(player.auras.filter((a) => a.kind === 'form_cat')).toHaveLength(1);
    expect(player.auras.some((a) => a.kind === 'stealth')).toBe(true);
    // Cat Form runs on Energy, so the shift really re-pooled the bar.
    expect(player.resourceType).toBe('energy');
  });

  it('leaves an existing Cat Form exactly as it was', () => {
    const { sim, player } = rig('feral');
    shiftInto(sim, 'cat_form');
    const before = player.auras.find((a) => a.kind === 'form_cat');
    expect(before).toBeDefined();

    expect(
      applyDruidFormEntry(rawCtx(sim), player, rawCtx(sim).players.get(player.id), 'prowl'),
    ).toBe(false);
    expect(player.auras.filter((a) => a.kind === 'form_cat')).toHaveLength(1);
    expect(player.auras.find((a) => a.kind === 'form_cat')).toBe(before);
  });

  it('is still refused in combat', () => {
    const { sim, player } = rig('feral');
    const mob = spawnMob(sim, 3);
    sim.castAbility('cat_form');
    for (let tick = 0; tick < 40; tick++) sim.tick();
    player.resource = player.maxResource;
    sim.castAbility('claw');
    for (let tick = 0; tick < 6; tick++) sim.tick();
    expect(player.inCombat).toBe(true);
    expect(mob.hp).toBeLessThan(mob.maxHp);

    sim.castAbility('prowl');
    sim.tick();

    expect(player.auras.some((a) => a.kind === 'stealth')).toBe(false);
  });
});

describe("Nature's Boon rolls on auto-attacks only", () => {
  it('costs no extra rng draw on an ability swing', () => {
    // The opts.autoAttack gate in combat/auto_attack.ts is the one thing that
    // keeps every weaponStrike ability from rolling the 1-in-15: Claw resolves
    // through the SAME meleeSwing shell that arms the passive.
    const { sim, player } = rig('feral');
    shiftInto(sim, 'cat_form');
    spawnMob(sim, 2);
    const armed = () => player.auras.some((a) => a.id === NATURES_BOON_ID);

    for (let cast = 0; cast < 40; cast++) {
      player.resource = player.maxResource;
      sim.castAbility('claw');
      for (let tick = 0; tick < 4; tick++) sim.tick();
      player.autoAttack = false;
    }
    expect(armed()).toBe(false);
  });
});

describe('6. Oakhide grants a percentage of armor, not a flat amount', () => {
  it('is authored as percentage points, not a flat buff', () => {
    const effects = ABILITIES.barkskin.effects;
    expect(effects).toHaveLength(1);
    const buff = effects[0];
    expect(buff.type).toBe('selfBuff');
    if (buff.type !== 'selfBuff') throw new Error('unreachable');
    expect(buff.kind).toBe('buff_armor_pct');
    expect(buff.value).toBe(20);
    expect(buff.duration).toBe(15);
    // The flat arm is gone: nothing here still adds a constant.
    expect(effects.some((e) => e.type === 'selfBuff' && e.kind === 'buff_armor')).toBe(false);
  });

  it('raises armor by 20% of what the druid actually has', () => {
    const { sim, player } = rig('feral');
    const before = player.stats.armor;
    expect(before).toBeGreaterThan(0);

    sim.castAbility('barkskin');
    for (let tick = 0; tick < 3; tick++) sim.tick();

    expect(player.auras.some((a) => a.kind === 'buff_armor_pct')).toBe(true);
    expect(player.stats.armor).toBe(Math.round(before * 1.2));
  });

  it('scales with the form multiplier, which a flat buff could not do', () => {
    // The whole point of the change: the same button is worth more to a bear,
    // because Bruin Form multiplies the armor the percentage then reads.
    const caster = rig('feral');
    const casterBase = caster.player.stats.armor;
    caster.sim.castAbility('barkskin');
    for (let tick = 0; tick < 3; tick++) caster.sim.tick();
    const casterGain = caster.player.stats.armor - casterBase;

    const bear = rig('feral');
    shiftInto(bear.sim, 'bear_form');
    const bearBase = bear.player.stats.armor;
    expect(bearBase).toBeGreaterThan(casterBase);
    bear.sim.castAbility('barkskin');
    for (let tick = 0; tick < 3; tick++) bear.sim.tick();
    const bearGain = bear.player.stats.armor - bearBase;

    expect(bearGain).toBeGreaterThan(casterGain);
    // Both are the same 25% of their own pool.
    expect(bearGain).toBe(Math.round(bearBase * 1.2) - bearBase);
    expect(casterGain).toBe(Math.round(casterBase * 1.2) - casterBase);
  });

  it('falls off cleanly, restoring the original armor', () => {
    const { sim, player } = rig('feral');
    const before = player.stats.armor;
    sim.castAbility('barkskin');
    for (let tick = 0; tick < 3; tick++) sim.tick();
    expect(player.stats.armor).toBeGreaterThan(before);

    // 15 sec at 20 Hz, plus slack for the expiry tick.
    for (let tick = 0; tick < 320; tick++) sim.tick();

    expect(player.auras.some((a) => a.kind === 'buff_armor_pct')).toBe(false);
    expect(player.stats.armor).toBe(before);
  });
});

describe('7. Bruin Rush and Lunge enter their form on use', () => {
  it('declares all three form-entry buttons and no form requirement on any', () => {
    expect(druidFormEntryTarget('prowl')).toBe('cat');
    expect(druidFormEntryTarget('lunge')).toBe('cat');
    expect(druidFormEntryTarget('bear_charge')).toBe('bear');
    expect(druidFormEntryTarget('claw')).toBeNull();
    for (const id of ['prowl', 'lunge', 'bear_charge']) {
      expect(requiredForms(ABILITIES[id])).toEqual([]);
      expect(ABILITIES[id].usableInForm).toBe(true);
    }
  });

  it('Bruin Rush shifts a caster-form druid into Bruin Form', () => {
    const { sim, player } = rig('feral');
    const mob = spawnMob(sim, 14);
    expect(player.auras.some((a) => a.kind.startsWith('form_'))).toBe(false);

    sim.castAbility('bear_charge');
    for (let tick = 0; tick < 5; tick++) sim.tick();

    expect(player.auras.some((a) => a.kind === 'form_bear')).toBe(true);
    expect(player.auras.find((a) => a.kind === 'form_bear')?.id).toBe('bear_form');
    expect(player.resourceType).toBe('rage');
    expect(mob.id).toBeGreaterThan(0);
  });

  it('Bruin Rush swaps Cat Form for Bruin Form rather than stacking', () => {
    const { sim, player } = rig('feral');
    shiftInto(sim, 'cat_form');
    spawnMob(sim, 14);
    expect(player.auras.some((a) => a.kind === 'form_cat')).toBe(true);

    sim.castAbility('bear_charge');
    for (let tick = 0; tick < 5; tick++) sim.tick();

    expect(player.auras.some((a) => a.kind === 'form_cat')).toBe(false);
    expect(player.auras.filter((a) => a.kind === 'form_bear')).toHaveLength(1);
  });

  it('Lunge shifts a caster-form druid into Cat Form and closes the gap', () => {
    // Lunge is reached through the Slinkstrike button, which action-replaces
    // to it whenever the druid is NOT stealthed (combat/action_replacement.ts),
    // so the real press is 'pounce' and the resolved id is 'lunge'.
    const { sim, player } = rig('feral');
    const mob = spawnMob(sim, 10);
    const distBefore = Math.abs(mob.pos.z - player.pos.z);

    sim.castAbility('pounce');
    for (let tick = 0; tick < 60; tick++) sim.tick();

    expect(player.auras.some((a) => a.kind === 'form_cat')).toBe(true);
    expect(player.resourceType).toBe('energy');
    // It actually cut the distance.
    expect(Math.abs(mob.pos.z - player.pos.z)).toBeLessThan(distBefore);
  });

  it('Lunge from Bruin Form is not refused for rage it will never be billed', () => {
    // The bar swaps on the shift: entering Cat hands over a full 100 energy,
    // so the 40 Lunge costs is payable even starting from 0 rage in Bruin.
    const { sim, player } = rig('feral');
    shiftInto(sim, 'bear_form');
    spawnMob(sim, 10);
    player.resource = 0;
    expect(player.resourceType).toBe('rage');

    sim.castAbility('pounce');
    for (let tick = 0; tick < 5; tick++) sim.tick();

    expect(player.auras.some((a) => a.kind === 'form_cat')).toBe(true);
    expect(player.resourceType).toBe('energy');
    // Billed once, against the energy the shift provided.
    expect(player.resource).toBe(60);
  });

  it('a Lunge pressed already in Cat Form keeps the ordinary energy check', () => {
    const { sim, player } = rig('feral');
    shiftInto(sim, 'cat_form');
    spawnMob(sim, 10);
    player.resource = 5;

    sim.castAbility('pounce');
    for (let tick = 0; tick < 5; tick++) sim.tick();

    // No shift was owed, so the press is refused for energy as it always was.
    expect(player.resource).toBe(5);
    expect(player.cooldowns.has('lunge')).toBe(false);
  });
});

describe("9. Nature's Boon never procs from a wand", () => {
  it('a wand bolt resolves outside the shell the proc hangs off', () => {
    // rangedSwing (combat/auto_attack.ts) resolves its hit inside its own
    // projectile callback and never calls meleeSwing, which is where
    // naturesBoonOnAutoAttack is invoked. This pins that separation: if a
    // future refactor routes ranged autos through the melee shell, a
    // caster-form druid would start arming the window by plinking, and this
    // test is what says no.
    const source = readFileSync('src/sim/combat/auto_attack.ts', 'utf8');
    const rangedStart = source.indexOf('export function rangedSwing(');
    const meleeStart = source.indexOf('export function meleeSwing(');
    expect(rangedStart).toBeGreaterThan(-1);
    expect(meleeStart).toBeGreaterThan(rangedStart);
    const rangedBody = source.slice(rangedStart, meleeStart);
    expect(rangedBody).not.toContain('naturesBoonOnAutoAttack');
    expect(rangedBody).not.toContain('meleeSwing(');
    // And the hook itself is inside the melee shell, gated on autoAttack.
    const meleeBody = source.slice(meleeStart);
    expect(meleeBody).toContain('if (opts.autoAttack) naturesBoonOnAutoAttack(ctx, attacker);');
  });

  it('a druid wanding a target arms nothing and draws no proc rng', () => {
    const { sim, player } = rig('feral');
    const mob = spawnMob(sim, 20);
    // Caster form, ranged auto profile: the wand path, not the melee path.
    expect(player.auras.some((a) => a.kind.startsWith('form_'))).toBe(false);
    sim.startAutoAttack(player.id);

    for (let tick = 0; tick < 400; tick++) sim.tick();

    expect(mob.hp).toBeLessThan(mob.maxHp);
    expect(aura(player, NATURES_BOON_ID)).toBeUndefined();
  });
});

describe('10. The action bar shows a golden rim while the window is armed', () => {
  it('lights exactly the spells the window pays for, and nothing else', () => {
    const armed = [
      {
        id: NATURES_BOON_ID,
        kind: 'next_cast_free',
        empowerAbilities: [...NATURES_BOON_ABILITIES],
      },
    ];
    // The view sets slot.naturesBoonGlow from this same predicate, so pinning
    // it here pins which slots wear the rim. Oakhide is bear-scoped, so the
    // bar lights it in Bruin Form and nowhere else.
    const armedBear = [...armed, { kind: 'form_bear' }];
    for (const id of NATURES_BOON_ABILITIES) {
      expect(naturesBoonArmedFor(armedBear, id)).toBe(true);
    }
    expect(naturesBoonArmedFor(armed, 'rejuvenation')).toBe(true);
    expect(naturesBoonArmedFor(armed, 'barkskin')).toBe(false);
    for (const id of ['claw', 'maul', 'wrath', 'healing_touch', 'prowl']) {
      expect(naturesBoonArmedFor(armed, id)).toBe(false);
    }
    // No window, no rim.
    for (const id of NATURES_BOON_ABILITIES) {
      expect(naturesBoonArmedFor([], id)).toBe(false);
    }
  });

  it('carries the flag through the slot state and the painter class', () => {
    const slot = makeSlotState();
    // Every slot starts dark, so a stale rim cannot survive a slot reuse.
    expect(slot.naturesBoonGlow).toBe(false);
    // The painter maps the flag to its own class name.
    const painterSource = readFileSync('src/ui/hud/action_bar/action_bar_painter.ts', 'utf8');
    expect(painterSource).toContain("const CLASS_NATURES_BOON = 'natures-boon';");
    expect(painterSource).toContain('toggleClass(el.btn, CLASS_NATURES_BOON, s.naturesBoonGlow)');
  });

  it('styles the rim as actionable info: gold, and never tier-gated', () => {
    const css = readFileSync('src/styles/hud.css', 'utf8');
    expect(css).toContain('.action-btn.natures-boon {');
    expect(css).toContain('border-color: var(--gold);');
    // Reduced motion drops the pulse but keeps the rim (both repo arms).
    expect(css).toMatch(/prefers-reduced-motion: reduce\)[\s\S]*?\.action-btn\.natures-boon/);
    expect(css).toMatch(/body\.reduce-motion \.action-btn\.natures-boon/);
    // Forced colors gets a non-colour cue.
    expect(css).toMatch(/forced-colors: active\)[\s\S]*?\.action-btn\.natures-boon/);
    const tokens = readFileSync('src/styles/tokens.css', 'utf8');
    expect(tokens).toContain('--glow-action-natures-boon:');
  });
});

describe('11. The rushes are off the GCD', () => {
  it('Lunge and Bruin Rush are both off the global cooldown', () => {
    expect(ABILITIES.lunge.offGcd).toBe(true);
    expect(ABILITIES.bear_charge.offGcd).toBe(true);
    // Stalk deliberately stays ON the GCD: it is an opener, not a gap closer.
    expect(ABILITIES.prowl.offGcd).toBeUndefined();
  });

  it('a Lunge leaves the GCD clear, so a strike can follow immediately', () => {
    const { sim, player } = rig('feral');
    shiftInto(sim, 'cat_form');
    const mob = spawnMob(sim, 10);
    player.resource = player.maxResource;
    expect(player.gcdRemaining).toBe(0);

    sim.castAbility('pounce');
    for (let tick = 0; tick < 40; tick++) sim.tick();

    // The gap closer ran without arming the global cooldown.
    expect(player.gcdRemaining).toBe(0);
    // And the follow-up strike lands rather than being swallowed by a GCD.
    player.resource = player.maxResource;
    const hpBefore = mob.hp;
    sim.castAbility('claw');
    for (let tick = 0; tick < 6; tick++) sim.tick();
    expect(mob.hp).toBeLessThan(hpBefore);
  });

  it('Oakhide Reflex lands on exactly 30% armor', () => {
    // The row 8 talent reads "50% more armor"; 20 base is chosen so that is 30.
    const { sim, player } = rig('feral');
    expect(sim.applyTalents({ spec: 'feral', rows: { 8: 'dru_r8_typhoon' } })).toBe(true);
    player.resource = player.maxResource;
    const before = player.stats.armor;

    sim.castAbility('barkskin');
    for (let tick = 0; tick < 3; tick++) sim.tick();

    const buff = player.auras.find((a) => a.kind === 'buff_armor_pct');
    expect(buff?.value).toBe(30);
    expect(player.stats.armor).toBe(Math.round(before * 1.3));
  });
});

describe('12. Oakhide rides the window, in Bruin Form only', () => {
  it('is armed only while the druid is a bear', () => {
    const boon = {
      id: NATURES_BOON_ID,
      kind: 'next_cast_free',
      empowerAbilities: [...NATURES_BOON_ABILITIES],
    };
    expect(naturesBoonFormAllows([], 'rejuvenation')).toBe(true);
    expect(naturesBoonFormAllows([], 'barkskin')).toBe(false);
    expect(naturesBoonFormAllows([{ kind: 'form_cat' }], 'barkskin')).toBe(false);
    expect(naturesBoonFormAllows([{ kind: 'form_bear' }], 'barkskin')).toBe(true);
    // The bar's rim reads the same predicate, so Oakhide glows in Bruin alone.
    expect(naturesBoonArmedFor([boon, { kind: 'form_cat' }], 'barkskin')).toBe(false);
    expect(naturesBoonArmedFor([boon, { kind: 'form_bear' }], 'barkskin')).toBe(true);
    // Wildbloom is form-free either way.
    expect(naturesBoonArmedFor([boon, { kind: 'form_cat' }], 'rejuvenation')).toBe(true);
  });

  it('pays for a free Oakhide in Bruin Form', () => {
    const { sim, player } = rig('feral');
    shiftInto(sim, 'bear_form');
    armBoon(sim);
    player.resource = player.maxResource;
    const rageBefore = player.resource;

    sim.castAbility('barkskin');
    for (let tick = 0; tick < 3; tick++) sim.tick();

    expect(player.auras.some((a) => a.kind === 'buff_armor_pct')).toBe(true);
    expect(player.resource).toBe(rageBefore);
    expect(aura(player, NATURES_BOON_ID)).toBeUndefined();

    // First cast wins: Wildbloom pressed next is an ordinary Wildbloom again.
    // With no window it can no longer be cast FROM Bruin Form (the auto-unshift
    // stands back up and drops the form), and its tick is the plain one, not
    // the empowered one.
    const plain = rig('feral');
    plain.sim.castAbility('rejuvenation');
    plain.sim.tick();
    const plainTick = plain.player.auras.find((a) => a.id === 'rejuvenation')?.value ?? 0;
    expect(plainTick).toBeGreaterThan(0);

    for (let tick = 0; tick < 40; tick++) sim.tick();
    sim.castAbility('rejuvenation');
    sim.tick();
    expect(player.auras.some((a) => a.kind === 'form_bear')).toBe(false);
    expect(player.auras.find((a) => a.id === 'rejuvenation')?.value).toBe(plainTick);
  });

  it('never pays for Oakhide out of Bruin Form, and never spends the window', () => {
    const { sim, player } = rig('feral');
    shiftInto(sim, 'cat_form');
    armBoon(sim);
    player.resource = player.maxResource;
    const energyBefore = player.resource;

    sim.castAbility('barkskin');
    for (let tick = 0; tick < 3; tick++) sim.tick();

    // Oakhide still goes off (it is usableInForm), but it pays its own cost...
    expect(player.auras.some((a) => a.kind === 'buff_armor_pct')).toBe(true);
    expect(player.resource).toBeLessThan(energyBefore);
    // ...and the window survives for the Wildbloom it is meant for.
    expect(aura(player, NATURES_BOON_ID)).toBeDefined();
  });
});

describe('13. An armed window makes its spell 25% stronger', () => {
  // Both arms run at a GEARED heal power, deliberately: the hot arm adds a
  // Spell Power rider on top of the authored base, and a multiplier that only
  // reached the base would read as 25% at zero heal power and shrink as gear
  // grew (a level-20 rig with no heal power cannot tell the two apart). The
  // printed 25% has to reach the whole tick.
  // Heal power is DERIVED (entity.ts recalcPlayerStats: Intellect times the
  // per-point rate, plus gear) and recalculated on the way through a cast, so a
  // value pushed onto the entity does not survive; a feral druid's own leather
  // carries almost none. A large Intellect buff is the lever the recalc keeps.
  const GEARED_HEAL_POWER_FLOOR = 100;

  function gearedRig() {
    const { sim, player } = rig('feral');
    player.auras.push({ ...formAura(player, 'buff_int'), id: 'test_geared_int', value: 2000 });
    const meta = rawCtx(sim).players.get(player.id);
    recalcPlayerStats(
      player,
      'druid',
      meta.equipment,
      rawCtx(sim).playerMods(meta),
      meta.equipmentInstance,
    );
    player.resource = player.maxResource;
    return { sim, player };
  }

  it('scales Wildbloom by a quarter, Spell Power rider included', () => {
    const plain = gearedRig();
    plain.sim.castAbility('rejuvenation');
    plain.sim.tick();
    const plainTick = plain.player.auras.find((a) => a.id === 'rejuvenation')?.value ?? 0;
    expect(plainTick).toBeGreaterThan(0);

    const boon = gearedRig();
    armBoon(boon.sim);
    boon.player.resource = boon.player.maxResource;
    boon.sim.castAbility('rejuvenation');
    boon.sim.tick();
    const boonTick = boon.player.auras.find((a) => a.id === 'rejuvenation')?.value ?? 0;

    // Both arms really carried a rider-sized heal power into the tick.
    expect(plain.player.healPower).toBeGreaterThanOrEqual(GEARED_HEAL_POWER_FLOOR);
    expect(boon.player.healPower).toBe(plain.player.healPower);
    expect(boonTick).toBeGreaterThan(plainTick);
    // The rider is most of the tick at this heal power, so a base-only scale
    // would land near 1.05 here; the band is one rounding step wide.
    expect(boonTick / plainTick).toBeCloseTo(NATURES_BOON_POWER, 1);
    expect(boonTick).toBe(Math.round(plainTick * NATURES_BOON_POWER));
  });

  it('scales Oakhide in Bruin Form, and leaves an unempowered one alone', () => {
    const plain = rig('feral');
    shiftInto(plain.sim, 'bear_form');
    plain.sim.castAbility('barkskin');
    for (let tick = 0; tick < 3; tick++) plain.sim.tick();
    const plainPct = plain.player.auras.find((a) => a.kind === 'buff_armor_pct')?.value;
    expect(plainPct).toBe(20);

    const boon = rig('feral');
    shiftInto(boon.sim, 'bear_form');
    armBoon(boon.sim);
    boon.sim.castAbility('barkskin');
    for (let tick = 0; tick < 3; tick++) boon.sim.tick();
    const boonPct = boon.player.auras.find((a) => a.kind === 'buff_armor_pct')?.value;
    expect(boonPct).toBe(25);
  });
});
