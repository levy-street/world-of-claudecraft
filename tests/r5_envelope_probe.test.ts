// The R5 measurement harness, pinned. `scripts/r5_envelope_probe.ts` is the
// artifact docs/design/power-verification.md sends a reader to when
// it says every figure in sections 9.2 and 9.5 is reproducible, so it is the
// packet's only reproducibility artifact and nothing was checking it.
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
// The TANK lane is pinned in full because it is the only deterministic one:
// it runs no fight, so it needs no seeds and returns the same body every time.
// The three throughput lanes stay Monte Carlo and belong in a measurement
// pass, not in the suite; what the Phase 15 QA added for them is (a) the
// dress-only furyBody readout, which pins the ESCALATION'S MECHANISM (the
// dead 355 hit, the equipped arm's hit-to-crit conversion) without a fight,
// and (b) one single-seed smoke per lane, floored between the measured
// dead-rotation and live values, so a dead or gutted rotation reds (a single
// renamed ability among several is not guaranteed to; the smoke arm's own
// comment carries the measured margins).
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
import { armorReduction, meleeMissChance } from '../src/sim/types';

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

  // MERGE-INHERITED, EXPECTED-FAIL (2026-08-30, the eighth v0.41.0 sync, release
  // tip 3e801dc925). The release's incumbent set-stack retune (d404eab938)
  // swapped hit for crit on five of the fury baseline's pieces
  // (heroic_crownforged dreadhelm and warspaulders 55 hit / 20 crit -> 20 /
  // 55; gravescale_girdle, bloodmane_war_legguards and tideworn_warboots 40
  // hit -> 40 crit), taking WAR_BIS from 355 hit to 165, and the span's
  // Crucible hit rebalance (c920f39c85) lowered the hit ramp itself
  // (ABOVE_LEVEL_MISS_PCT [0, 2.5, 14, 21] -> [0, 2.5, 8, 14]), so the merged
  // needs read 130 heroic / 190 S-rift: 165 hit is 35 OVER the merged heroic
  // need (dead rating persists there, smaller) and 25 UNDER the merged S-rift
  // need, the record's 355-against-190 arithmetic belongs to the pre-raid
  // catalog, and the twin arm (bloodmane hit / forgefold crit) now reads two
  // crit pieces.
  // Every literal here is an input of the RATIFIED R5 record (sections 3, 8.1
  // and 9.6; the four maintainer rulings of 2026-08-29), which the packet may
  // not rewrite: the test is kept exactly as authored and marked expected-fail
  // so the contradiction stays visible in every run. ESCALATED (state.md, the
  // Phase 19 table: re-measure R5 on the merged world, or ratify the record as
  // a measurement of the pre-raid catalog). Flip back to it() in the SAME
  // commit that executes the ruling.
  it.fails('pins the escalation mechanism: dead hit on the base arm, live crit on the equipped arm', () => {
    // Section 9.6's escalation driver, as assertions (the Phase 15 QA; the
    // 2026-08-28 suspension it drove is closed by ruling since 2026-08-29,
    // and the mechanism stays pinned as the record's accepted evidence). The
    // dress-only readout runs no fight, so this is deterministic.
    const base = furyBody('base');
    const full = furyBody('full');
    const equipped = furyBody('equipped');
    // The base arm carries exactly the 355 hit rating the record derives, and
    // effective SPECIAL-attack miss is zero at BOTH targets on BOTH arms: that
    // is what makes the surplus rating dead.
    expect(base.hitRating, 'the fury baseline hit budget').toBe(355);
    for (const body of [base, equipped]) {
      for (const target of [HEROIC_TARGET, SRIFT_TARGET]) {
        expect(
          Math.max(0, meleeMissChance(20, target.level) - body.hitBonus),
          `effective special miss at L${target.level}`,
        ).toBe(0);
      }
    }
    // The modelled arm moves ONLY primary stats over base (the "+2 lead stat"
    // model, plus the two weapon enchant steps): ratings identical.
    expect(full.str - base.str).toBe(4);
    expect(full.hitRating).toBe(base.hitRating);
    expect(full.critRating).toBe(base.critRating);
    expect(full.hasteRating).toBe(base.hasteRating);
    // The equipped arm's whole difference from the model is the rating swap
    // the record names: 40 dead hit becomes 40 live crit (the legs twin), the
    // ring swap trades 25 haste for 25 more dead hit plus 8 strength.
    expect(equipped.critRating - base.critRating, 'the legs twin turns dead hit live').toBe(40);
    expect(equipped.hitRating - base.hitRating, 'net hit change, dead on both sides').toBe(-15);
    expect(equipped.hasteRating - base.hasteRating, 'the ring swap forfeits haste').toBe(-25);
    expect(equipped.str - base.str, 'the ring swap plus Perfecting and enchants').toBe(12);
    // The two swapped items, by id, and the twin relation itself.
    expect(WAR_EQUIPPED_ITEMS).toEqual({ legs: 'forgefold_legguards', ring2: 'warhewn_signet' });
    const bloodmane = ITEMS.bloodmane_war_legguards as ItemDef;
    const forgefold = ITEMS.forgefold_legguards as ItemDef;
    expect(bloodmane.stats).toEqual(forgefold.stats);
    expect(bloodmane.hitRating, 'the baseline legs carry the hit line').toBe(40);
    expect(forgefold.hitRating).toBeUndefined();
    expect(forgefold.critRating, 'the apex legs carry it as crit').toBe(40);
    expect(bloodmane.critRating).toBeUndefined();
  });

  // MERGE-INHERITED, EXPECTED-FAIL (2026-08-30, the eighth v0.41.0 sync, release
  // tip 3e801dc925): the release's legendary band retune (4ed7a279b4) moved
  // heart_of_the_rift (sta 14 -> 18, str/agi/int 6 -> 8; measured +60 of the
  // move) and the incumbent set-stack retune (d404eab938) replaced the
  // crownforged 2pc bonus (ap 40 -> str 10 / sta 10, about +100 more, the
  // remainder its other lineage lines), so the tank baseline reads 3532
  // health against the record's 3332. Section 9.5 is part of the
  // ratified R5 record; same treatment, same escalation, same flip rule as the
  // arm above.
  it.fails('reproduces the section 9.5 tank effective-health table exactly', () => {
    // Every literal here is a figure power-verification.md section 9.5 prints.
    // If the harness drifts from the record, this is where it says so.
    const base = tankBody('base');
    expect(base.hp, 'baseline health').toBe(3332);
    expect(base.armor, 'baseline armour').toBe(3369);

    const consumables = tankBody('consumables');
    expect(consumables.hp).toBe(3432);
    expect(consumables.armor).toBe(3369);

    const withEnchant = tankBody('consumablesEnchant');
    expect(withEnchant.hp).toBe(3472);
    expect(withEnchant.armor).toBe(3369);

    const full = tankBody('full');
    expect(full.hp, 'the full kit adds no health over the enchant arm').toBe(3472);
    expect(full.armor, 'the two Perfected pieces add exactly 4 armour').toBe(3373);

    // The deltas the record reports, at both attacker levels.
    const ehp = (b: { hp: number; armor: number }, lvl: number): number =>
      b.hp / (1 - armorReduction(b.armor, lvl));
    const pct = (lvl: number): number => ((ehp(full, lvl) - ehp(base, lvl)) / ehp(base, lvl)) * 100;
    expect(Math.round(ehp(base, 22))).toBe(8277);
    expect(Math.round(ehp(full, 22))).toBe(8631);
    expect(pct(22).toFixed(2), 'heroic').toBe('4.28');
    expect(Math.round(ehp(base, 23))).toBe(8099);
    expect(Math.round(ehp(full, 23))).toBe(8445);
    expect(pct(23).toFixed(2), 'S-rift').toBe('4.27');
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
