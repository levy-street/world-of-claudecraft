// The R5 measurement harness, pinned. `scripts/r5_envelope_probe.ts` is the
// executable companion to docs/design/power-verification.md. The sampled
// throughput table is revision-bound; this suite pins the current deterministic
// inputs and keeps the live probe in the test import graph.
//
// Two things this file exists to prevent, both found by the Phase 15 audits:
//   1. The probe sat outside tsconfig's include and outside every test's import
//      graph, so a rename in src/sim broke it with every gate green. It carried
//      three real type errors that way, one of them a call to a helper an
//      earlier edit had deleted, which would have thrown in the tank lane.
//   2. Its kit deltas were hand-written literals rather than reads of the defs
//      they describe, so restoring a tuned magnitude left the probe reporting
//      the tuned number and handing a false PASS to exactly the reader the doc
//      sends there.
//
// The deterministic tank and fury dress-only bodies are pinned exactly. The
// three throughput lanes stay Monte Carlo and belong in a measurement pass,
// not in the suite; one single-seed smoke per lane still catches a dead or
// gutted rotation, while the rotation-id guard catches a single renamed cast.
import { describe, expect, it } from 'vitest';
import {
  assertRotationAbilitiesResolve,
  CASTER_APEX_CHEST_DELTA,
  CHEST_STA_STEP_PERFECTED,
  CHEST_STA_STEP_PLATE,
  casterLane,
  FEET_AGI_STEP,
  furyBody,
  furyLane,
  HEROIC_TARGET,
  ROTATION_ABILITY_IDS,
  rogueLane,
  SRIFT_TARGET,
  TANK_KIT_DELTA,
  TANK_KIT_ITEMS,
  tankBody,
  unresolvedRotationAbilityIds,
  WAR_EQUIPPED_DELTA,
  WAR_EQUIPPED_ITEMS,
  WEAPON_INT_STEP,
  WEAPON_STR_STEP,
} from '../scripts/r5_envelope_probe';
import { ABILITIES } from '../src/sim/content/classes';
import { HEROIC_DUNGEON_TUNING } from '../src/sim/content/dungeon_difficulty';
import { ENCHANTS } from '../src/sim/content/enchants';
import { ALL_RECIPES } from '../src/sim/content/recipes';
import { ITEMS } from '../src/sim/data';
import { perfectedBonusStats } from '../src/sim/professions/perfecting';
import { RIFT_HEROIC_TUNING, RIFT_S_LEVEL } from '../src/sim/rift/ranks';
import type { ItemDef } from '../src/sim/types';
import { armorReduction } from '../src/sim/types';

describe('the R5 envelope harness', () => {
  it('derives both targets from the live tuning tables, not from literals', () => {
    // power-verification.md section 5. armorPerLevel 42 on the Nythraxis
    // template, the heroic arena at level 22 x 1.2, the S rift at 23 x 1.4.
    expect(HEROIC_TARGET.level).toBe(22);
    expect(HEROIC_TARGET.armor).toBe(1058);
    expect(SRIFT_TARGET.level).toBe(23);
    expect(SRIFT_TARGET.armor).toBe(1294);
    // The WELD to the live tables (the Phase 15 QA: the probe used to bake the
    // level and multiplier as literals while this arm's title claimed a live
    // derivation). The probe now reads these rows, so the pins here are
    // LITERALS on the rows themselves, never row-vs-target comparisons (the
    // probe builds the target FROM the row, which would make those
    // self-comparisons): a tuning retune reds this suite and forces a
    // re-measure, the correct failure, instead of silently moving the
    // record's targets.
    const heroicRow = HEROIC_DUNGEON_TUNING.nythraxis_boss_arena;
    expect(heroicRow?.level, 'the boss-arena tuning row level').toBe(22);
    expect(heroicRow?.armorMultiplier, 'the boss-arena armour multiplier').toBe(1.2);
    expect(RIFT_S_LEVEL, 'the S rift level').toBe(23);
    expect(RIFT_HEROIC_TUNING.S?.armorMultiplier, 'the S rank armour multiplier').toBe(1.4);
    // The mitigation the record prints, to the same two decimals.
    expect((armorReduction(HEROIC_TARGET.armor, 20) * 100).toFixed(2)).toBe('33.50');
    expect((armorReduction(SRIFT_TARGET.armor, 20) * 100).toFixed(2)).toBe('38.13');
  });

  it('reproduces the current fury dress-only bodies exactly', () => {
    const base = furyBody('base');
    const full = furyBody('full');
    const equipped = furyBody('equipped');

    expect(base).toEqual({
      str: 201,
      sta: 194,
      hitRating: 165,
      critRating: 315,
      hasteRating: 50,
    });
    expect(full).toEqual({
      str: 205,
      sta: 197,
      hitRating: 165,
      critRating: 315,
      hasteRating: 50,
    });
    expect(equipped).toEqual({
      str: 213,
      sta: 202,
      hitRating: 190,
      critRating: 275,
      hasteRating: 65,
    });

    expect(WAR_EQUIPPED_ITEMS).toEqual({
      legs: 'forgefold_legguards',
      ring2: 'warhewn_signet',
    });
    const baselineLegs = ITEMS.bloodmane_war_legguards as ItemDef;
    const equippedLegs = ITEMS.forgefold_legguards as ItemDef;
    expect(equippedLegs.stats).toEqual(baselineLegs.stats);
    expect(baselineLegs.critRating).toBe(40);
    expect(baselineLegs.hasteRating).toBeUndefined();
    expect(equippedLegs.critRating).toBeUndefined();
    expect(equippedLegs.hasteRating).toBe(40);
    expect(ITEMS.architects_cornerstone.hasteRating).toBe(25);
    expect(ITEMS.warhewn_signet.hitRating).toBe(25);
  });

  it('reproduces the current tank effective-health table exactly', () => {
    const base = tankBody('base');
    const consumables = tankBody('consumables');
    const withEnchant = tankBody('consumablesEnchant');
    const full = tankBody('full');

    expect(base).toEqual({ hp: 3532, armor: 3383, sta: 332 });
    expect(consumables).toEqual({ hp: 3632, armor: 3383, sta: 342 });
    expect(withEnchant).toEqual({ hp: 3672, armor: 3383, sta: 346 });
    expect(full).toEqual({ hp: 3672, armor: 3386, sta: 346 });

    const ehp = (body: { hp: number; armor: number }, level: number): number =>
      body.hp / (1 - armorReduction(body.armor, level));
    const expected: Array<[number, number, number, string]> = [
      [22, 8796, 9149, '4.019'],
      [23, 8606, 8952, '4.018'],
    ];
    for (const [level, baseEhp, fullEhp, delta] of expected) {
      const deltaPct = ((ehp(full, level) - ehp(base, level)) / ehp(base, level)) * 100;
      expect(Math.round(ehp(base, level)), `level ${level} baseline EHP`).toBe(baseEhp);
      expect(Math.round(ehp(full, level)), `level ${level} full-kit EHP`).toBe(fullEhp);
      expect(deltaPct.toFixed(3), `level ${level} EHP delta`).toBe(delta);
    }
  });

  it('reads its kit deltas from the catalog rather than baking them in', () => {
    // The defect this arm exists for: a literal here keeps reporting the tuned
    // number after someone restores the def. Assert the RELATION the probe
    // derives, so a magnitude move is forced to move the harness too.
    const bonus = (id: string, axis: string): number =>
      (ENCHANTS[id] as { statBonus?: Record<string, number> } | undefined)?.statBonus?.[axis] ?? 0;

    // The weapon rung, the term Phase 15 tuned and the one that lands twice.
    expect(bonus('enchant_weapon_lucent_might', 'str')).toBe(6);
    expect(bonus('enchant_weapon_greater_might', 'str')).toBe(5);
    expect(bonus('enchant_weapon_lucent_spellpower', 'int')).toBe(6);
    expect(bonus('enchant_weapon_greater_spellpower', 'int')).toBe(5);
    // The twins stay byte-identical on magnitude (ruling D10-D1).
    expect(bonus('enchant_weapon_lucent_might', 'str')).toBe(
      bonus('enchant_weapon_lucent_spellpower', 'int'),
    );

    // The consumable terms the probe reads per KIND, one def each.
    const elixirValue = (id: string): number | undefined =>
      (ITEMS[id] as unknown as { elixir?: { value?: number } }).elixir?.value;
    const wellFedValue = (id: string): number | undefined =>
      (ITEMS[id] as unknown as { wellFed?: { value?: number } }).wellFed?.value;
    for (const id of ['ironhusk_flask', 'warboar_flask', 'runewater_flask']) {
      expect(elixirValue(id), `${id} flask band`).toBe(13);
    }
    for (const id of ['stonepot_stew', 'warspice_skewers', 'sageleaf_chowder']) {
      expect(wellFedValue(id), `${id} plate band`).toBe(6);
    }

    // The probe's DERIVED step constants, pinned both ways (the Phase 15 QA):
    // to the def relation each derives and to its literal. A def move reds
    // both pins immediately; a re-baked literal in the probe is caught the
    // moment a def moves (today it would equal the derivation, so the re-bake
    // itself does not red; the harmful END STATE, a stale baked step after a
    // def move, is what these pins refuse).
    const steps: Array<[string, number, number, string, string, string]> = [
      [
        'weapon str',
        WEAPON_STR_STEP,
        1,
        'enchant_weapon_lucent_might',
        'enchant_weapon_greater_might',
        'str',
      ],
      [
        'weapon int',
        WEAPON_INT_STEP,
        1,
        'enchant_weapon_lucent_spellpower',
        'enchant_weapon_greater_spellpower',
        'int',
      ],
      ['feet agi', FEET_AGI_STEP, 1, 'enchant_feet_lucent_agility', 'enchant_feet_agility', 'agi'],
      [
        'chest sta perfected',
        CHEST_STA_STEP_PERFECTED,
        6,
        'enchant_lucent_infusion',
        'enchant_chest_greater_stamina',
        'sta',
      ],
      [
        'chest sta plate',
        CHEST_STA_STEP_PLATE,
        3,
        'enchant_chest_lucent_stamina',
        'enchant_chest_greater_stamina',
        'sta',
      ],
    ];
    for (const [label, step, literal, apex, prior, axis] of steps) {
      expect(step, `${label} step derives from the defs`).toBe(
        bonus(apex, axis) - bonus(prior, axis),
      );
      expect(step, `${label} step literal`).toBe(literal);
    }

    // The SERPENT weld: the one consumable the probe carries as a literal aura
    // (both arms wear it, so it cancels in the throughput deltas, but the TANK
    // lane's +7 net depends on it tracking the real def).
    const serpent = ITEMS.elixir_of_the_serpent as unknown as {
      elixir?: { value?: number; duration?: number };
    };
    expect(serpent.elixir?.value, 'the SERPENT literal in the probe tracks this def').toBe(12);
    expect(serpent.elixir?.duration, 'and its duration').toBe(900);
  });

  it('pins the tank kit identity and its Perfecting deltas to the live formula', () => {
    // The Phase 15 QA's mutation pass proved the tank table alone is blind to
    // a kit-identity swap between EHP-identical twins (re-pointing the legs at
    // bloodmane_war_legguards survived every pin). The kit map is therefore
    // pinned by id, and each delta is welded to perfectedBonusStats for the
    // item the kit names, so a kit re-point or a Perfecting change reds the
    // harness instead of leaving it reproducing a stale record.
    expect(TANK_KIT_ITEMS).toEqual({ offhand: 'duskforged_bulwark', legs: 'forgefold_legguards' });
    for (const [slot, id] of Object.entries(TANK_KIT_ITEMS)) {
      const def = ITEMS[id] as ItemDef;
      const recipe = ALL_RECIPES.find((r) => r.resultItemId === id);
      expect(recipe, `${id} has an apex recipe`).toBeTruthy();
      const bonusStats = perfectedBonusStats(def, recipe as { level: number }) ?? {};
      // The formula returns zero-valued shares; the merge site skips zeroes,
      // and the kit's declared delta rightly omits them, so compare nonzero.
      const nonzero = Object.fromEntries(
        Object.entries(bonusStats).filter(([, v]) => (v as number) !== 0),
      );
      expect(nonzero, `${id} Perfecting delta matches the kit's declared ${slot} delta`).toEqual(
        TANK_KIT_DELTA[slot] ?? {},
      );
    }
    // The chest entry is the enchant step, not a Perfecting bonus.
    expect(TANK_KIT_DELTA.chest, 'the chest delta is the plate enchant step').toEqual({
      sta: CHEST_STA_STEP_PLATE,
    });

    // The SAME weld for the other two item-swapping arms (the round-2 reader:
    // welding only the tank kit left the fury equipped and caster apexChest
    // Perfecting components as unwelded hand literals, the exact drift class
    // this file exists to refuse). Enchant-step entries are excluded: they are
    // welded to the derived constants above.
    const perfectingPart = (id: string): Record<string, number> => {
      const recipe = ALL_RECIPES.find((r) => r.resultItemId === id);
      expect(recipe, `${id} has an apex recipe`).toBeTruthy();
      const bonusStats = perfectedBonusStats(ITEMS[id] as ItemDef, recipe as { level: number });
      return Object.fromEntries(
        Object.entries(bonusStats ?? {}).filter(([, v]) => (v as number) !== 0),
      ) as Record<string, number>;
    };
    expect(perfectingPart('forgefold_legguards'), 'fury equipped legs delta').toEqual(
      WAR_EQUIPPED_DELTA.legs,
    );
    expect(perfectingPart('warhewn_signet'), 'fury equipped ring2 delta').toEqual(
      WAR_EQUIPPED_DELTA.ring2,
    );
    const casterChest = { ...CASTER_APEX_CHEST_DELTA.chest } as Record<string, number>;
    delete casterChest.sta; // the enchant step rides the same slot entry
    expect(perfectingPart('sunspun_vestments'), 'caster apex chest delta').toEqual(casterChest);
    expect(
      CASTER_APEX_CHEST_DELTA.chest?.sta,
      'the caster chest sta entry is the Perfected enchant step',
    ).toBe(CHEST_STA_STEP_PERFECTED);
  });

  it('smokes each throughput lane on one seed so a dead or gutted rotation reds', () => {
    // Floors sit between the measured DEAD-rotation values (fury 65.5, rogue
    // 96.9, caster 0 when the rotation is a no-op with auto-attack still on)
    // and the live values (fury 183, rogue 198, caster 91 at these exact
    // inputs). A dead or gutted rotation reds; a SINGLE renamed ability among
    // several is not guaranteed to (castAbility no-ops silently on an unknown
    // id, e.g. renaming only bloodthirst measures 134, above the fury floor);
    // that gap is the id-existence guard's, in the describe below. Ordinary sim
    // tuning stays green. Durations are explicit so an
    // ambient WOC_R5_SECONDS cannot change what this arm measures.
    expect(furyLane(4242, 'full', 22, 1058, 180), 'fury').toBeGreaterThan(100);
    expect(rogueLane(4242, 'combat', 'full', 22, 1058, 180), 'rogue').toBeGreaterThan(150);
    expect(casterLane(4242, 'full', 22, 1058, 60), 'caster').toBeGreaterThan(40);
  });
});

describe('the R5 harness rotation ids resolve to live ability defs', () => {
  // The gap the smoke floors above cannot close: castAbility no-ops silently
  // on an unknown id, so ONE renamed ability def leaves a lane measuring a
  // thinner rotation at a number that still clears its floor. The guard is
  // output-invariant by construction (it reads the ability table and throws;
  // it touches no kit, floor, fixture or constant), so it moves nothing the R5
  // freeze protects.

  it('every id the three lanes cast is a live ability, against the shipped table', () => {
    expect(unresolvedRotationAbilityIds(), 'rotation ids with no ability def').toEqual([]);
    expect(() => assertRotationAbilitiesResolve()).not.toThrow();
    // Non-vacuity, both halves: the list is really the lanes' rotation (not an
    // empty array that trivially satisfies the sweep), and every entry really
    // is looked up in ABILITIES rather than assumed.
    expect(ROTATION_ABILITY_IDS.length, 'the rotation id list is populated').toBe(14);
    expect(new Set(ROTATION_ABILITY_IDS).size, 'no id is listed twice').toBe(
      ROTATION_ABILITY_IDS.length,
    );
    for (const id of ROTATION_ABILITY_IDS) expect(ABILITIES[id], id).toBeDefined();
  });

  it('a RENAMED ability def fails loudly, naming the id the harness would have dropped', () => {
    // The rename case exactly: the def is gone from the table under its old
    // key (renamed, not deleted), which is what a content rename does to a
    // literal the harness holds. Fed as a catalog rather than by mutating
    // ABILITIES, so the live table is never disturbed.
    const renamed: Record<string, unknown> = { ...ABILITIES };
    delete renamed.bloodthirst;
    renamed.crimson_thirst = ABILITIES.bloodthirst;
    expect(unresolvedRotationAbilityIds(renamed)).toEqual(['bloodthirst']);
    expect(() => assertRotationAbilitiesResolve(renamed)).toThrow(/bloodthirst/);
    // Two gone at once are BOTH named, so the message never hides a second
    // rename behind the first.
    const twoGone: Record<string, unknown> = { ...renamed };
    delete twoGone.frostbolt;
    expect(unresolvedRotationAbilityIds(twoGone)).toEqual(['bloodthirst', 'frostbolt']);
    expect(() => assertRotationAbilitiesResolve(twoGone)).toThrow(/bloodthirst, frostbolt/);
  });

  it('each throughput lane runs the guard BEFORE it measures anything', () => {
    // The WIRING, not just the guard. The lanes call the guard with the live
    // table, so the only honest proof is to take a rotation ability out of that
    // table and watch all three lanes refuse. Restored in a finally, and the
    // durations are 1 second so a lane that FORGOT the call returns a dps
    // number cheaply (and reds on the toThrow) instead of running a real fight.
    const original = ABILITIES.bloodthirst;
    try {
      delete (ABILITIES as Record<string, unknown>).bloodthirst;
      expect(() => furyLane(4242, 'full', 22, 1058, 1), 'fury').toThrow(/bloodthirst/);
      expect(() => rogueLane(4242, 'combat', 'full', 22, 1058, 1), 'rogue').toThrow(/bloodthirst/);
      expect(() => casterLane(4242, 'full', 22, 1058, 1), 'caster').toThrow(/bloodthirst/);
    } finally {
      ABILITIES.bloodthirst = original;
    }
    // The table really is whole again, so nothing after this file leaks: the
    // same three lanes measure a number once more.
    expect(ABILITIES.bloodthirst, 'the live ability table is restored').toBe(original);
    expect(unresolvedRotationAbilityIds()).toEqual([]);
    expect(furyLane(4242, 'full', 22, 1058, 1), 'fury measures again').toBeGreaterThan(0);
  });
});
