import { describe, expect, it } from 'vitest';
import { ABILITIES, CLASSES } from '../src/sim/content/classes';
import type { PlayerClass } from '../src/sim/types';

// New-player onboarding rule (first-hour feedback, Aug 2026): every class must
// hand out its early kit one or two abilities at a time instead of a dead zone
// at 2-3 followed by a cliff at 5 (the level that also opens the first talent
// row). Enforced over the authored class kit only:
//   1. At least one castable, non-spec-gated ability learns at EVERY level
//      from 2 through 6 - a new player should have something new to press on
//      each of their first six dings.
//   2. No more than two such abilities learn at any single level from 2
//      through 7 - spec kits and talent grants land on top, so the core kit
//      must never dump a pile on one ding. Level 1 is the starting kit and
//      exempt; level 8+ sits past the onboarding window.
// Passives never count (they are not buttons). Spec-gated abilities are the
// spec's budget, not the core kit's. Quest-gated abilities (Recall the Fallen)
// still count for the cap but not for coverage, since a player may not have
// the quest done on the ding.

const CORE_LEVEL_MIN = 2;
const COVERAGE_LEVEL_MAX = 6;
const CAP_LEVEL_MAX = 7;
const MAX_NEW_PER_LEVEL = 2;

function coreKitAtLevel(cls: PlayerClass, level: number) {
  return CLASSES[cls].abilities
    .map((id) => ABILITIES[id])
    .filter(
      (a) =>
        a !== undefined &&
        !a.hiddenFromPlayer &&
        !a.passive &&
        a.specs === undefined &&
        a.learnLevel === level,
    );
}

describe('early ability curve', () => {
  const classes = Object.keys(CLASSES) as PlayerClass[];

  for (const cls of classes) {
    it(`${cls}: one new core active on every ding from ${CORE_LEVEL_MIN} to ${COVERAGE_LEVEL_MAX}`, () => {
      for (let level = CORE_LEVEL_MIN; level <= COVERAGE_LEVEL_MAX; level++) {
        const fresh = coreKitAtLevel(cls, level).filter((a) => !a.requiresQuest);
        expect(
          fresh.length,
          `${cls} learns no core active at level ${level} - a new player dings and gets nothing to press`,
        ).toBeGreaterThanOrEqual(1);
      }
    });

    it(`${cls}: never more than ${MAX_NEW_PER_LEVEL} new core actives on one ding before 8`, () => {
      for (let level = CORE_LEVEL_MIN; level <= CAP_LEVEL_MAX; level++) {
        const fresh = coreKitAtLevel(cls, level);
        expect(
          fresh.length,
          `${cls} dumps ${fresh.length} core actives at level ${level}: ${fresh
            .map((a) => a.name)
            .join(', ')} - spread them out`,
        ).toBeLessThanOrEqual(MAX_NEW_PER_LEVEL);
      }
    });
  }

  it('warlock spec signatures no longer learn at level 1', () => {
    // A brand-new warlock should not be asked to commit to a spec before
    // their first quest; the three former level-1 spec abilities now arrive
    // with the rest of the spec kit at 5.
    for (const id of CLASSES.warlock.abilities) {
      const a = ABILITIES[id];
      if (!a || a.hiddenFromPlayer || !a.specs) continue;
      expect(
        a.learnLevel,
        `warlock spec ability ${a.name} (${id}) learns at level ${a.learnLevel}`,
      ).toBeGreaterThanOrEqual(5);
    }
  });
});
