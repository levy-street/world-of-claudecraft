// Regression test for the tooltip bug the reviewer found on PR #2447: Rupture
// and Rip have no primary effect, so `$d` falls back through
// abilitySecondaryEffect to the 'dot' arm in abilityEffectText. Since the dot
// effect now carries a `perCombo` term (most of the ability's damage at high
// combo points), rendering `total` alone showed only the near-useless
// 0-combo-point base (16 for Rupture, 10 for Rip), which is not even a
// castable state (finishers require at least 1 combo point). This pins the
// fix: a dot with `perCombo` set renders through the same
// abilityUi.tooltip.finisherDamage base/perCombo composition every other
// combo-point finisher (Eviscerate, Slice and Dice, Kidney Shot) already used.
import { describe, expect, it } from 'vitest';
import { abilitiesKnownAt } from '../src/sim/content/classes';
import { emptyModifiers } from '../src/sim/content/talents';
import { abilityEffectText } from '../src/ui/hud';

describe('rupture and rip tooltip: $d shows base + perCombo, not the 0-combo-point base', () => {
  it('rupture shows "16 plus 16 per combo point", not the bare 0-combo-point 16', () => {
    const rupture = abilitiesKnownAt('rogue', 20, emptyModifiers()).find(
      (known) => known.def.id === 'rupture',
    );
    if (!rupture) throw new Error('missing rupture');

    const text = abilityEffectText(rupture, { spellPower: 0, rangedPower: 0, attackPower: 0 });
    expect(text).toBe('16 plus 16 per combo point');
    // The old bug rendered just the bare total, i.e. an unqualified "16".
    expect(text).not.toBe('16');
  });

  it('rip shows "10 plus 10 per combo point", not the bare 0-combo-point 10', () => {
    const rip = abilitiesKnownAt('druid', 20, emptyModifiers()).find(
      (known) => known.def.id === 'rip',
    );
    if (!rip) throw new Error('missing rip');

    const text = abilityEffectText(rip, { spellPower: 0, rangedPower: 0, attackPower: 0 });
    expect(text).toBe('10 plus 10 per combo point');
    expect(text).not.toBe('10');
  });
});
