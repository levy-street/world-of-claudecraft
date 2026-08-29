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
// The TANK lane is the one pinned here because it is the only deterministic
// one: it runs no fight, so it needs no seeds and returns the same body every
// time. The three throughput lanes are Monte Carlo over 25 to 1200 seeds and
// belong in a measurement pass, not in the suite.
import { describe, expect, it } from 'vitest';
import { HEROIC_TARGET, SRIFT_TARGET, tankBody } from '../scripts/r5_envelope_probe';
import { ENCHANTS } from '../src/sim/content/enchants';
import { ITEMS } from '../src/sim/data';
import { armorReduction } from '../src/sim/types';

describe('the R5 envelope harness', () => {
  it('derives both targets from the live tuning tables, not from literals', () => {
    // power-verification.md section 5. armorPerLevel 42 on the Nythraxis
    // template, the heroic arena at level 22 x 1.2, the S rift at 23 x 1.4.
    expect(HEROIC_TARGET.level).toBe(22);
    expect(HEROIC_TARGET.armor).toBe(1058);
    expect(SRIFT_TARGET.level).toBe(23);
    expect(SRIFT_TARGET.armor).toBe(1294);
    // The mitigation the record prints, to the same two decimals.
    expect((armorReduction(HEROIC_TARGET.armor, 20) * 100).toFixed(2)).toBe('33.50');
    expect((armorReduction(SRIFT_TARGET.armor, 20) * 100).toFixed(2)).toBe('38.13');
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
  });
});
