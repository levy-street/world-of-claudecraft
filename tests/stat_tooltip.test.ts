import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import { ALL_CLASSES, armorReduction, type PlayerClass } from '../src/sim/types';
import { CLASSES } from '../src/sim/content/classes';
import { ITEMS } from '../src/sim/data';
import {
  buildStatTooltip,
  healthFromStamina,
  manaFromIntellect,
  restingHealthPer5s,
  restingManaPer5s,
  isManaClass,
  strApPerPoint,
  agiMeleeApPerPoint,
  weaponDps,
  type StatEffect,
  type StatId,
  type StatTooltipInput,
} from '../src/ui/stat_tooltip';

// A gear-free, buff-free, talent-free player: autoEquip defaults to false, so the
// derived stats are a clean function of class base + per-level growth. That lets
// us reconcile the tooltip's per-stat breakdown against the ONE place the sim
// derives stats (recalcPlayerStats), so the displayed numbers cannot drift.
function freshPlayer(cls: PlayerClass, level: number) {
  const sim = new Sim({ seed: 1, playerClass: cls });
  sim.setPlayerLevel(level);
  return sim.player;
}

function inputFor(cls: PlayerClass, p: ReturnType<typeof freshPlayer>): StatTooltipInput {
  return {
    cls,
    stats: p.stats,
    level: p.level,
    attackPower: p.attackPower,
    critChance: p.critChance,
    dodgeChance: p.dodgeChance,
    dps: 0,
  };
}

const effect = (effects: StatEffect[], kind: StatEffect['kind']) => effects.find((e) => e.kind === kind);
const valueOf = (cls: PlayerClass, p: ReturnType<typeof freshPlayer>, stat: StatId, kind: StatEffect['kind']) =>
  effect(buildStatTooltip(stat, inputFor(cls, p)).effects, kind)?.value;

const LEVELS = [1, 10, 20];

describe('stat tooltip math reconciles with recalcPlayerStats', () => {
  for (const cls of ALL_CLASSES) {
    for (const level of LEVELS) {
      it(`${cls} L${level}: attack power breakdown sums to entity.attackPower`, () => {
        const p = freshPlayer(cls, level);
        const strAp = valueOf(cls, p, 'str', 'attackPower') ?? 0;
        const agiAp = valueOf(cls, p, 'agi', 'attackPower') ?? 0; // present for rogue/hunter only
        expect(strAp + agiAp).toBe(p.attackPower);
      });

      it(`${cls} L${level}: agility crit/dodge match the 5% base + 0.05%/agi curve`, () => {
        const p = freshPlayer(cls, level);
        const critPct = valueOf(cls, p, 'agi', 'critPct') ?? 0;
        const dodgePct = valueOf(cls, p, 'agi', 'dodgePct') ?? 0;
        expect(0.05 + critPct / 100).toBeCloseTo(p.critChance, 6);
        expect(0.05 + dodgePct / 100).toBeCloseTo(p.dodgeChance, 6);
      });

      it(`${cls} L${level}: agility armor is the agi*2 portion of total armor`, () => {
        const sim = new Sim({ seed: 1, playerClass: cls });
        sim.setPlayerLevel(level);
        const p = sim.player;
        const def = CLASSES[cls];
        // Players keep their class starting chest even with autoEquip off, so total
        // armor = class growth + that gear's armor + agility*2. Isolate the agi part.
        let gearArmor = 0;
        for (const id of Object.values(sim.equipment)) gearArmor += (id && ITEMS[id]?.stats?.armor) || 0;
        const baseArmor = def.baseStats.armor + def.statsPerLevel.armor * (level - 1);
        const agiArmor = valueOf(cls, p, 'agi', 'armor') ?? 0;
        expect(agiArmor).toBe(p.stats.armor - baseArmor - gearArmor); // proves the sim adds agi*2
        expect(agiArmor).toBe(p.stats.agi * 2); // proves the tooltip matches
      });

      it(`${cls} L${level}: stamina max-health contribution matches entity.maxHp`, () => {
        const p = freshPlayer(cls, level);
        const def = CLASSES[cls];
        const base = def.baseHp + def.hpPerLevel * (level - 1);
        const maxHealth = valueOf(cls, p, 'sta', 'maxHealth') ?? 0;
        expect(maxHealth).toBe(p.maxHp - base);
        expect(maxHealth).toBe(healthFromStamina(p.stats.sta));
      });

      it(`${cls} L${level}: armor cell damage reduction matches armorReduction()`, () => {
        const p = freshPlayer(cls, level);
        const dr = effect(buildStatTooltip('armor', inputFor(cls, p)).effects, 'damageReduction');
        expect(dr?.value).toBeCloseTo(armorReduction(p.stats.armor, level) * 100, 6);
        expect(dr?.level).toBe(level);
      });
    }
  }

  it('mana classes: intellect max-mana contribution matches entity.maxResource', () => {
    for (const cls of ALL_CLASSES) {
      if (!isManaClass(cls)) continue;
      const p = freshPlayer(cls, 20);
      const def = CLASSES[cls];
      const base = def.baseMana + def.manaPerLevel * (20 - 1);
      const maxMana = valueOf(cls, p, 'int', 'maxMana') ?? 0;
      expect(maxMana).toBe(p.maxResource - base);
      expect(maxMana).toBe(manaFromIntellect(p.stats.int));
    }
  });
});

describe('class-aware effect selection', () => {
  it('Strength grants 2 AP/point for warrior/paladin/shaman/druid, else 1', () => {
    expect(strApPerPoint('warrior')).toBe(2);
    expect(strApPerPoint('paladin')).toBe(2);
    expect(strApPerPoint('shaman')).toBe(2);
    expect(strApPerPoint('druid')).toBe(2);
    expect(strApPerPoint('rogue')).toBe(1);
    expect(strApPerPoint('hunter')).toBe(1);
    expect(strApPerPoint('mage')).toBe(1);
    expect(strApPerPoint('priest')).toBe(1);
    expect(strApPerPoint('warlock')).toBe(1);
  });

  it('Agility melee AP applies only to rogue and hunter', () => {
    expect(agiMeleeApPerPoint('rogue')).toBe(1);
    expect(agiMeleeApPerPoint('hunter')).toBe(1);
    for (const cls of ['warrior', 'paladin', 'shaman', 'druid', 'mage', 'priest', 'warlock'] as PlayerClass[]) {
      expect(agiMeleeApPerPoint(cls)).toBe(0);
    }
  });

  it('only hunters get a ranged attack power line from Agility', () => {
    const hunter = freshPlayer('hunter', 20);
    const ranged = effect(buildStatTooltip('agi', inputFor('hunter', hunter)).effects, 'rangedAttackPower');
    expect(ranged?.value).toBe(hunter.stats.agi * 2);
    const warrior = freshPlayer('warrior', 20);
    expect(effect(buildStatTooltip('agi', inputFor('warrior', warrior)).effects, 'rangedAttackPower')).toBeUndefined();
  });

  it('Intellect and Spirit show the minor-benefit note for non-mana classes only', () => {
    const rogue = freshPlayer('rogue', 20); // energy
    const warrior = freshPlayer('warrior', 20); // rage
    for (const cls of [rogue, warrior]) {
      const c = cls === rogue ? 'rogue' : 'warrior';
      const intM = buildStatTooltip('int', inputFor(c, cls));
      const spiM = buildStatTooltip('spi', inputFor(c, cls));
      expect(intM.minorForClass).toBe(true);
      expect(intM.effects).toHaveLength(0);
      expect(spiM.minorForClass).toBe(true);
      expect(spiM.effects).toHaveLength(0);
    }
    const mage = freshPlayer('mage', 20);
    const intMage = buildStatTooltip('int', inputFor('mage', mage));
    expect(intMage.minorForClass).toBe(false);
    expect(effect(intMage.effects, 'maxMana')).toBeDefined();
    expect(effect(intMage.effects, 'spellCritPct')).toBeDefined();
    expect(buildStatTooltip('spi', inputFor('mage', mage)).minorForClass).toBe(false);
  });

  it('treats a druid as a mana class in every form (Int/Spirit keep their mana lines)', () => {
    // A druid is fundamentally a mana class whose Int/Spirit govern the caster-form
    // mana pool, so its breakdown must NOT collapse to "of little benefit" the way a
    // true rage/energy class does, even while shapeshifted. isManaClass keys off the
    // base class (not the transient form resource) on purpose; lock that here.
    expect(isManaClass('druid')).toBe(true);
    const druid = freshPlayer('druid', 20);
    const intDruid = buildStatTooltip('int', inputFor('druid', druid));
    expect(intDruid.minorForClass).toBe(false);
    expect(effect(intDruid.effects, 'maxMana')).toBeDefined();
    expect(effect(intDruid.effects, 'spellCritPct')).toBeDefined();
    const spiDruid = buildStatTooltip('spi', inputFor('druid', druid));
    expect(spiDruid.minorForClass).toBe(false);
    expect(effect(spiDruid.effects, 'manaRegen')).toBeDefined();
  });

  it('derived cells carry their notes and no header', () => {
    const p = freshPlayer('warrior', 10);
    const crit = buildStatTooltip('critChance', inputFor('warrior', p));
    const dodge = buildStatTooltip('dodge', inputFor('warrior', p));
    const dps = buildStatTooltip('dps', { ...inputFor('warrior', p), dps: 12.3 });
    expect(crit.isPrimary).toBe(false);
    expect(crit.baseChanceNote).toBe(true);
    expect(dodge.baseChanceNote).toBe(true);
    expect(dps.dpsApproxNote).toBe(true);
    expect(dps.statValue).toBe(12.3);
    // primary stats are the left column only
    expect(buildStatTooltip('str', inputFor('warrior', p)).isPrimary).toBe(true);
    expect(buildStatTooltip('agi', inputFor('warrior', p)).isPrimary).toBe(true);
  });
});

describe('pure regen / pool helpers', () => {
  it('health from stamina uses the 20-point pivot (1 then 10 per point)', () => {
    expect(healthFromStamina(0)).toBe(0);
    expect(healthFromStamina(20)).toBe(20);
    expect(healthFromStamina(28)).toBe(20 + 8 * 10); // 100
    expect(healthFromStamina(-5)).toBe(0);
  });

  it('mana from intellect uses the 20-point pivot (1 then 15 per point)', () => {
    expect(manaFromIntellect(20)).toBe(20);
    expect(manaFromIntellect(24)).toBe(20 + 4 * 15); // 80
    expect(manaFromIntellect(-5)).toBe(0);
  });

  it('resting regen rounds the per-tick amount first (as the sim does), then scales to per-5s', () => {
    // The sim adds round(rate) every 2s; per-5s estimate = round(round(rate) * 2.5).
    expect(restingHealthPer5s(20)).toBe(Math.round(Math.round(20 * 0.3 + 2) * 2.5)); // 20
    expect(restingHealthPer5s(5)).toBe(Math.round(Math.round(5 * 0.3 + 2) * 2.5)); // round(4*2.5)=10
    expect(restingManaPer5s(30, 20)).toBe(Math.round(Math.round(30 / 3 + 4 + 4) * 2.5)); // 45
    expect(restingManaPer5s(0, 1)).toBe(Math.round(Math.round(0 + 4 + 0) * 2.5)); // 10
  });
});

describe('weaponDps', () => {
  it('falls back to the sim default weapon when unarmed, never 0', () => {
    // default {min:1,max:2,speed:2}: ((1+2)/2 + (ap/14)*2) / 2
    expect(weaponDps(null, 0)).toBeCloseTo(0.75, 6);
    expect(weaponDps(undefined, 14)).toBeCloseTo(1.75, 6);
    expect(weaponDps(null, 0)).toBeGreaterThan(0); // the unarmed-shows-0 bug is gone
  });

  it('uses the equipped weapon and folds in attack power (ap/14 per swing)', () => {
    expect(weaponDps({ min: 10, max: 20, speed: 3 }, 0)).toBeCloseTo(5, 6); // 15/3
    expect(weaponDps({ min: 10, max: 20, speed: 3 }, 42)).toBeCloseTo(8, 6); // (15 + 3*3)/3
  });
});

describe('effect wiring reconciles each effect kind with its source', () => {
  const effVal = (cls: PlayerClass, p: ReturnType<typeof freshPlayer>, stat: StatId, kind: StatEffect['kind']) =>
    valueOf(cls, p, stat, kind);

  it('attackPower cell emits dpsFromAp = attackPower / 14', () => {
    const p = freshPlayer('warrior', 20);
    expect(effVal('warrior', p, 'attackPower', 'dpsFromAp')).toBeCloseTo(p.attackPower / 14, 6);
  });

  it('stamina cell wires healthRegen = restingHealthPer5s(sta)', () => {
    const p = freshPlayer('warrior', 20);
    expect(effVal('warrior', p, 'sta', 'healthRegen')).toBe(restingHealthPer5s(p.stats.sta));
  });

  it('mana classes wire spirit -> manaRegen and intellect -> spellCritPct', () => {
    const p = freshPlayer('mage', 20);
    expect(effVal('mage', p, 'spi', 'manaRegen')).toBe(restingManaPer5s(p.stats.spi, p.level));
    // spell crit = 0.05 + int*0.0008 (sim.ts spellCrit); the line shows the int*0.0008 portion as a percent
    expect(effVal('mage', p, 'int', 'spellCritPct')).toBeCloseTo(p.stats.int * 0.0008 * 100, 6);
  });
});
