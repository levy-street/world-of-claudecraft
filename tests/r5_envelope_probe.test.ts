// The R5 measurement harness, pinned. `scripts/r5_envelope_probe.ts` is the
// artifact docs/prd/masterwrought/power-verification.md sends a reader to when
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
  CASTER_APEX_CHEST_DELTA,
  CHEST_STA_STEP_PERFECTED,
  CHEST_STA_STEP_PLATE,
  casterLane,
  FEET_AGI_STEP,
  furyBody,
  furyLane,
  HEROIC_TARGET,
  rogueLane,
  SRIFT_TARGET,
  TANK_KIT_DELTA,
  TANK_KIT_ITEMS,
  tankBody,
  WAR_EQUIPPED_DELTA,
  WAR_EQUIPPED_ITEMS,
  WEAPON_INT_STEP,
  WEAPON_STR_STEP,
} from '../scripts/r5_envelope_probe';
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

  it('pins the escalation mechanism: dead hit on the base arm, live crit on the equipped arm', () => {
    // Section 9.6's suspension driver, as assertions (the Phase 15 QA). The
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

  it('reproduces the section 9.5 tank effective-health table exactly', () => {
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
    // id, e.g. renaming only bloodthirst measures 134, above the fury floor),
    // and ordinary sim tuning stays green. Durations are explicit so an
    // ambient WOC_R5_SECONDS cannot change what this arm measures.
    expect(furyLane(4242, 'full', 22, 1058, 180), 'fury').toBeGreaterThan(100);
    expect(rogueLane(4242, 'combat', 'full', 22, 1058, 180), 'rogue').toBeGreaterThan(150);
    expect(casterLane(4242, 'full', 22, 1058, 60), 'caster').toBeGreaterThan(40);
  });
});
