import { describe, expect, it } from 'vitest';
import type { ProcDef } from '../src/sim/content/talents';
import { ROW_TREES, TALENTS } from '../src/sim/content/talents';

// G3 guard (fix/talents2-balance-pass): every empowerNext a TALENT hands out
// must name the abilities that may consume it. An unscoped empower is eaten by
// the next matching cast of ANY ability, which lets a player bank it for their
// most expensive spell (and made several free-cast rows exploitable). The
// deliberate exceptions are the classic on-demand actives (Racing Mind,
// Primal Mastery, Stilled Mind): those are selfBuff ABILITIES with a real
// cooldown, not procs, and are not touched by this scan.

function procsInEffect(effect: { proc?: ProcDef } | undefined): ProcDef[] {
  return effect?.proc ? [effect.proc] : [];
}

describe('talent empowerNext scoping', () => {
  it('every empowerNext response in row and mastery procs is ability-scoped', () => {
    let scanned = 0;
    const offenders: string[] = [];
    const scan = (owner: string, procs: ProcDef[]) => {
      for (const def of procs) {
        for (const response of def.responses) {
          if (response.kind !== 'empowerNext') continue;
          scanned++;
          if (!response.abilities || response.abilities.length === 0) {
            offenders.push(`${owner} (${def.id})`);
          }
        }
      }
    };
    for (const [cls, tree] of Object.entries(ROW_TREES)) {
      for (const row of tree) {
        for (const option of row.options) {
          scan(`${cls} ${option.id}`, procsInEffect(option.effect));
        }
      }
    }
    for (const [cls, talents] of Object.entries(TALENTS)) {
      for (const spec of talents.specs) {
        scan(`${cls} spec ${spec.id} mastery`, procsInEffect(spec.mastery.effect));
      }
    }
    // The scan must actually cover the proc surface: a refactor that moves the
    // rows out from under ROW_TREES should redden this, not silently pass.
    expect(scanned).toBeGreaterThan(20);
    expect(offenders).toEqual([]);
  });
});
