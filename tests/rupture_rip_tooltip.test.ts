// Regression test for the tooltip bug the reviewer found on PR #2447: Rupture
// and Rip have no primary effect, so `$d` falls back through
// abilitySecondaryEffect to the 'dot' arm in abilityEffectText, which used to
// render `total` alone. Under the #2447 model that `total` was the 0-combo-point
// base (16 for Rupture, 10 for Rip), a near-useless number that is not even a
// castable state (finishers require at least 1 combo point).
//
// The v0.31 rogue and druid overhauls retired that model (owner ruling
// 2026-07-29, see tests/rogue_finisher_scaling.test.ts and
// tests/bloodrift_combo_scaling.test.ts): Bleed Out now scales its DURATION with
// combo points at a fixed tick value, and Bloodrift scales its total through
// baseTotal/perComboTotal. Both spell the scaling out in prose and use `$d` for
// the FULL five-point spend, so `total` is no longer a base a player can never
// see. This pins the same invariant under the new model: `$d` renders the number
// the description promises, and the data still carries the scaling terms.
import { describe, expect, it } from 'vitest';
import { ABILITIES, abilitiesKnownAt } from '../src/sim/content/classes';
import { emptyModifiers } from '../src/sim/content/talents';
import { abilityEffectText } from '../src/ui/hud';

const NO_SCALING = { spellPower: 0, rangedPower: 0, attackPower: 0 };

describe('Bleed Out and Bloodrift tooltips: $d shows the full five-point spend', () => {
  it('Bleed Out renders its 5-combo total (96), not a bare 0-combo base', () => {
    const rupture = abilitiesKnownAt('rogue', 20, emptyModifiers()).find(
      (known) => known.def.id === 'rupture',
    );
    if (!rupture) throw new Error('missing rupture');

    expect(abilityEffectText(rupture, NO_SCALING)).toBe('96');
    // The description promises "(5 combo points: 16 sec and $d total damage)",
    // so $d must be the full-spend total and the prose must carry the scaling.
    expect(ABILITIES.rupture.description).toContain('$d total damage');
    expect(ABILITIES.rupture.description).toContain('2 sec per combo point');
  });

  it('Bloodrift renders its 5-combo total (156), not the 36 base', () => {
    const rip = abilitiesKnownAt('druid', 20, emptyModifiers()).find(
      (known) => known.def.id === 'rip',
    );
    if (!rip) throw new Error('missing rip');

    expect(abilityEffectText(rip, NO_SCALING)).toBe('156');
    expect(abilityEffectText(rip, NO_SCALING)).not.toBe('36');
    expect(ABILITIES.rip.description).toContain('24 per combo point spent');
  });

  it('both dots carry their scaling in data, so $d stays the full-spend number', () => {
    const bleedOut = ABILITIES.rupture.effects[0];
    if (bleedOut?.type !== 'dot') throw new Error('rupture is no longer a dot');
    // Duration scaling: 6 sec base plus 2 per point = the 16 sec `duration` the
    // tooltip and the sim both read at a five-point spend.
    expect(bleedOut.baseDuration).toBe(6);
    expect(bleedOut.perComboDuration).toBe(2);
    expect((bleedOut.baseDuration ?? 0) + (bleedOut.perComboDuration ?? 0) * 5).toBe(
      bleedOut.duration,
    );

    const bloodrift = ABILITIES.rip.effects[0];
    if (bloodrift?.type !== 'dot') throw new Error('rip is no longer a dot');
    // Total scaling: 36 base plus 24 per point = the 156 `total` above.
    expect(bloodrift.baseTotal).toBe(36);
    expect(bloodrift.perComboTotal).toBe(24);
    expect((bloodrift.baseTotal ?? 0) + (bloodrift.perComboTotal ?? 0) * 5).toBe(bloodrift.total);
  });
});
