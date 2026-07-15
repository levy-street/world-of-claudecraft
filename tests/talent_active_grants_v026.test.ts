import { describe, expect, it } from 'vitest';
import { ABILITIES, abilitiesKnownAt } from '../src/sim/content/classes';
import { computeTalentModifiers, ROW_TREES } from '../src/sim/content/talents';
import { ALL_CLASSES } from '../src/sim/types';

describe('v0.26 active talent grants', () => {
  it('resolves every active row grant to a same-class castable ability definition', () => {
    const missing: string[] = [];
    const wrongClass: string[] = [];
    const passive: string[] = [];

    for (const cls of ALL_CLASSES) {
      for (const row of ROW_TREES[cls]) {
        for (const option of row.options) {
          const abilityId = option.effect.grant?.ability;
          if (!abilityId) continue;
          const ability = ABILITIES[abilityId];
          if (!ability) missing.push(`${cls}:${option.id}->${abilityId}`);
          else if (ability.class !== cls) wrongClass.push(`${cls}:${option.id}->${abilityId}`);
          else if (ability.passive) passive.push(`${cls}:${option.id}->${abilityId}`);
        }
      }
    }

    expect(missing).toEqual([]);
    expect(wrongClass).toEqual([]);
    expect(passive).toEqual([]);
  });

  it('keeps every row-granted ability out of the no-row baseline kit', () => {
    const leaked: string[] = [];

    for (const cls of ALL_CLASSES) {
      const baseline = new Set(
        abilitiesKnownAt(cls, 20, computeTalentModifiers(cls, { spec: null, rows: {} }, 20)).map(
          (entry) => entry.def.id,
        ),
      );
      for (const row of ROW_TREES[cls]) {
        for (const option of row.options) {
          const abilityId = option.effect.grant?.ability;
          if (abilityId && baseline.has(abilityId))
            leaked.push(`${cls}:${option.id}->${abilityId}`);
        }
      }
    }

    expect(leaked).toEqual([]);
  });
});
