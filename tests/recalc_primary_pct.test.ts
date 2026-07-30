import { describe, expect, it } from 'vitest';
import { emptyModifiers, type TalentModifiers } from '../src/sim/content/talents';
import { createPlayer, recalcPlayerStats } from '../src/sim/entity';
import { type PlayerClass, SPELL_POWER_PER_INT } from '../src/sim/types';

// recalcPlayerStats is the ONE place derived stats are computed (src/sim/CLAUDE.md). These
// lock the primary-attribute multipliers (strPct/agiPct/intPct/spiPct) that back talents
// like Lightning Reflexes (+10% Agility) and Arcane Mind (+8% Intellect): the multiplier
// must reach the fully-summed attribute AND flow into everything derived from it
// (agiPct -> armor/dodge/crit/ranged AP, intPct -> Spell Power, strPct -> attack power).

interface Derived {
  str: number;
  agi: number;
  int: number;
  spi: number;
  armor: number;
  attackPower: number;
  rangedPower: number;
  spellPower: number;
  crit: number;
  dodge: number;
}

function derive(cls: PlayerClass, level: number, mut?: (m: TalentModifiers) => void): Derived {
  const e = createPlayer(0, cls, { x: 0, y: 0, z: 0 }, 'Test');
  e.level = level;
  let mods: TalentModifiers | undefined;
  if (mut) {
    mods = emptyModifiers();
    mut(mods);
  }
  recalcPlayerStats(e, cls, {}, mods, {});
  return {
    str: e.stats.str,
    agi: e.stats.agi,
    int: e.stats.int,
    spi: e.stats.spi,
    armor: e.stats.armor,
    attackPower: e.attackPower,
    rangedPower: e.rangedPower,
    spellPower: e.spellPower,
    crit: e.critChance,
    dodge: e.dodgeChance,
  };
}

describe('recalcPlayerStats primary-attribute multipliers', () => {
  it('agiPct scales Agility and everything derived from it', () => {
    const base = derive('hunter', 40);
    const buffed = derive('hunter', 40, (m) => {
      m.stats.agiPct = 0.1;
    });
    expect(buffed.agi).toBe(Math.round(base.agi * 1.1));
    // Armor adds exactly 2 per Agility point (armorPct is 0 here, no form), so the delta
    // must equal the added Agility times 2: proves agiPct lands before the armor derivation.
    expect(buffed.armor - base.armor).toBe((buffed.agi - base.agi) * 2);
    expect(buffed.dodge).toBeGreaterThan(base.dodge);
    expect(buffed.crit).toBeGreaterThan(base.crit);
    // Hunter ranged attack power is 2 per Agility, so it rises too.
    expect(buffed.rangedPower).toBeGreaterThan(base.rangedPower);
  });

  it('intPct scales Intellect and the Spell Power it feeds', () => {
    const base = derive('mage', 40);
    const buffed = derive('mage', 40, (m) => {
      m.stats.intPct = 0.08;
    });
    expect(buffed.int).toBe(Math.round(base.int * 1.08));
    expect(buffed.spellPower).toBe(Math.round(buffed.int * SPELL_POWER_PER_INT));
    expect(buffed.spellPower).toBeGreaterThan(base.spellPower);
  });

  it('strPct scales Strength and melee attack power', () => {
    const base = derive('warrior', 40);
    const buffed = derive('warrior', 40, (m) => {
      m.stats.strPct = 0.2;
    });
    expect(buffed.str).toBe(Math.round(base.str * 1.2));
    expect(buffed.attackPower).toBeGreaterThan(base.attackPower);
  });

  it('spiPct scales Spirit', () => {
    const base = derive('priest', 40);
    const buffed = derive('priest', 40, (m) => {
      m.stats.spiPct = 0.15;
    });
    expect(buffed.spi).toBe(Math.round(base.spi * 1.15));
    expect(buffed.spi).toBeGreaterThan(base.spi);
  });
});
