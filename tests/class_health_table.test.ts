// The class health table (src/sim/content/classes.ts), set by design on
// 2026-09-11 after the gear stamina baseline model (item_budget.ts) made gear
// health a pure function of item level: the class table is the only
// class-dependent health lever left, so it is pinned here as a table, not
// inherited. Every class gains 2 Stamina per level (the same uniform rule the
// gear carries), and HP per level runs by armor class: plate 17 to 18, mail and
// the leather and cloth DPS classes 15, the druid 13. Rationale and the
// measured outcome: docs/design/class-health-table-2026-09-11.md.
import { describe, expect, it } from 'vitest';
import { CLASSES } from '../src/sim/content/classes';
import { Sim } from '../src/sim/sim';
import type { PlayerClass } from '../src/sim/types';

const CLASS_IDS = Object.keys(CLASSES) as PlayerClass[];

// HP per level by class, the armor-class ladder.
const HP_PER_LEVEL: Record<PlayerClass, number> = {
  warrior: 18,
  paladin: 17,
  hunter: 15,
  shaman: 15,
  rogue: 15,
  druid: 13,
  mage: 15,
  priest: 15,
  warlock: 15,
};

// A naked level-20 character's pool: baseHp + hpPerLevel * 19 + the classic
// stamina conversion (first 20 points one each, the rest ten each) over
// baseStats.sta + 2 * 19. Pinned as literals so a table edit reds with a
// named class rather than moving the derivation silently.
const NAKED_LEVEL_20_HP: Record<PlayerClass, number> = {
  warrior: 822,
  paladin: 808,
  hunter: 725,
  shaman: 733,
  rogue: 700,
  druid: 662,
  mage: 665,
  priest: 653,
  warlock: 677,
};

function nakedMaxHp(cls: PlayerClass): number {
  const sim = new Sim({ seed: 1, playerClass: cls, autoEquip: false });
  sim.setPlayerLevel(20);
  sim.tick();
  return sim.player.maxHp;
}

describe('class health table', () => {
  it('covers every class exactly once', () => {
    expect(CLASS_IDS.sort()).toEqual(Object.keys(HP_PER_LEVEL).sort());
    expect(CLASS_IDS.sort()).toEqual(Object.keys(NAKED_LEVEL_20_HP).sort());
  });

  it('gives every class 2 Stamina per level, the same uniform rule the gear carries', () => {
    for (const cls of CLASS_IDS) {
      expect(CLASSES[cls].statsPerLevel.sta, `${cls} stamina per level`).toBe(2);
    }
  });

  it('runs HP per level on the armor-class ladder', () => {
    for (const cls of CLASS_IDS) {
      expect(CLASSES[cls].hpPerLevel, `${cls} hp per level`).toBe(HP_PER_LEVEL[cls]);
    }
    // No class sits under the cloth line any more, and plate stays on top.
    expect(Math.min(...Object.values(HP_PER_LEVEL))).toBe(13);
    expect(Math.max(...Object.values(HP_PER_LEVEL))).toBe(18);
    expect(HP_PER_LEVEL.warrior).toBeGreaterThan(HP_PER_LEVEL.mage);
  });

  it('lands every naked level-20 character on its pinned pool', () => {
    for (const cls of CLASS_IDS) {
      expect(nakedMaxHp(cls), `${cls} naked at 20`).toBe(NAKED_LEVEL_20_HP[cls]);
    }
  });

  it('keeps cloth inside the designed band against plate, naked at 20', () => {
    // The design target: cloth around four fifths of a plate DPS class at the
    // top of the tier. Naked the ratio is the class table alone; the geared
    // ratios are measured in the design doc and pinned by the raid best-in-slot
    // probe there, not here.
    // Read from the Sim rather than from the literal table above, so this is a
    // guard in its own right and not a self-comparison of two pinned numbers.
    const cloth = Math.min(nakedMaxHp('mage'), nakedMaxHp('priest'), nakedMaxHp('warlock'));
    const plate = nakedMaxHp('warrior');
    expect(cloth / plate).toBeGreaterThanOrEqual(0.78);
    expect(cloth / plate).toBeLessThanOrEqual(0.9);
  });
});
