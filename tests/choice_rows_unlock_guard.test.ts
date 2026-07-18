import { describe, expect, it } from 'vitest';
import { CHOICE_ROWS } from '../src/sim/content/choice_rows';
import { ABILITIES, CLASSES } from '../src/sim/content/classes';
import type { PlayerClass } from '../src/sim/types';

// Priest, Shaman, and Paladin rows are being redesigned. Empty this skip list
// when those rows land so this guard covers every class.
const ROW_REDESIGN_SKIP: ReadonlySet<PlayerClass> = new Set([]);
// Abilities whose row-modifier is intentionally offered before the ability is
// learnable (the pick banks and takes effect later). Empty: Flickerstep now
// joins the base kit at level 5, matching its level-5 choice-row modifiers.
const FUTURE_ABILITY_EXCEPTIONS = new Set<string>([]);

describe('choice row unlock ability guards', () => {
  it('does not modify abilities learned after the row unlocks', () => {
    const failures: string[] = [];

    for (const cls of Object.keys(CLASSES) as PlayerClass[]) {
      if (ROW_REDESIGN_SKIP.has(cls)) continue;

      for (const row of CHOICE_ROWS[cls].rows) {
        for (const option of row.options) {
          for (const mod of option.effect.ability ?? []) {
            const ability = ABILITIES[mod.ability];
            if (!ability) {
              failures.push(
                `${cls} row ${row.level} option ${option.id} references missing ability ${mod.ability}`,
              );
              continue;
            }
            if (
              ability.learnLevel > row.level &&
              !FUTURE_ABILITY_EXCEPTIONS.has(`${option.id}:${mod.ability}`)
            ) {
              failures.push(
                `${cls} row ${row.level} option ${option.id} modifies ${mod.ability}: ability learnLevel ${ability.learnLevel} > row unlock ${row.level}`,
              );
            }
          }
        }
      }
    }

    expect(failures).toEqual([]);
  });
});
