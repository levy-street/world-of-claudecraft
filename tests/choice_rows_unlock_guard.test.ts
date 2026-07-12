import { describe, expect, it } from 'vitest';
import { CHOICE_ROWS } from '../src/sim/content/choice_rows';
import { ABILITIES, CLASSES } from '../src/sim/content/classes';
import type { PlayerClass } from '../src/sim/types';

// Priest, Shaman, and Paladin rows are being redesigned. Empty this skip list
// when those rows land so this guard covers every class.
const ROW_REDESIGN_SKIP: ReadonlySet<PlayerClass> = new Set([]);

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
            if (ability.learnLevel > row.level) {
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

  it('every proc has a trigger and payoff that are usable when its row unlocks', () => {
    const failures: string[] = [];

    for (const cls of Object.keys(CLASSES) as PlayerClass[]) {
      const baseline = new Set(CLASSES[cls].abilities);
      for (const row of CHOICE_ROWS[cls].rows) {
        for (const option of row.options) {
          const proc = option.effect.proc;
          if (!proc) continue;
          const granted = option.effect.grant?.ability;
          const usable = (id: string) =>
            id === granted ||
            (baseline.has(id) && (ABILITIES[id]?.learnLevel ?? Infinity) <= row.level);
          const trigger = proc.trigger;
          let triggerAbilities: string[] = [];
          if (trigger.on === 'castNth' || trigger.on === 'spellCrit') {
            triggerAbilities = trigger.abilities ?? [];
          } else if (trigger.on === 'shieldConsumed' || trigger.on === 'hotExpired') {
            triggerAbilities = [trigger.ability];
          }
          if (triggerAbilities.length > 0 && !triggerAbilities.some(usable)) {
            failures.push(
              `${cls} row ${row.level} option ${option.id} has no usable proc trigger at unlock: ${triggerAbilities.join(', ')}`,
            );
          }

          const payoffAbilities = proc.responses.flatMap((response) => {
            if (response.kind === 'empowerNext') return response.abilities ?? [];
            if (response.kind === 'cooldownRefund') return [response.ability];
            return [];
          });
          if (payoffAbilities.length > 0 && !payoffAbilities.some(usable)) {
            failures.push(
              `${cls} row ${row.level} option ${option.id} has no usable proc payoff at unlock: ${payoffAbilities.join(', ')}`,
            );
          }
        }
      }
    }

    expect(failures).toEqual([]);
  });
});
