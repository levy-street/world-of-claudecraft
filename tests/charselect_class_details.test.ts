import { describe, expect, it } from 'vitest';
import { ABILITIES, CLASSES } from '../src/sim/content/classes';
import { TALENTS } from '../src/sim/content/talents';
import type { PlayerClass } from '../src/sim/types';
import { CLASS_DETAILS, SIGNATURE_ABILITIES, SPEC_CARD_INFO } from '../src/ui/class_details_data';

// Guards the hand-maintained character-select showcase data against drift from
// the sim's source of truth. If a class's ability kit or roster changes, these
// assertions force the showcase metadata to be updated in the same change.

const classIds = Object.keys(CLASSES) as PlayerClass[];

describe('character-select class details parity', () => {
  it('covers every playable class exactly once', () => {
    for (const cls of classIds) {
      expect(CLASS_DETAILS[cls], `missing CLASS_DETAILS for ${cls}`).toBeTruthy();
      expect(SIGNATURE_ABILITIES[cls], `missing SIGNATURE_ABILITIES for ${cls}`).toBeTruthy();
    }
    expect(Object.keys(CLASS_DETAILS).sort()).toEqual([...classIds].sort());
    expect(Object.keys(SIGNATURE_ABILITIES).sort()).toEqual([...classIds].sort());
  });

  for (const cls of classIds) {
    describe(cls, () => {
      const picks = SIGNATURE_ABILITIES[cls];

      it('lists three signature abilities', () => {
        expect(picks).toHaveLength(3);
        expect(new Set(picks).size).toBe(3); // no duplicates
      });

      for (const id of picks) {
        it(`"${id}" is a real ability that ${cls} can learn`, () => {
          const ability = ABILITIES[id];
          expect(ability, `ability "${id}" does not exist`).toBeTruthy();
          expect(ability.class, `"${id}" belongs to ${ability?.class}, not ${cls}`).toBe(cls);
          expect(
            CLASSES[cls].abilities,
            `"${id}" is not in ${cls}'s learnable ability list`,
          ).toContain(id);
        });
      }
    });
  }
});

describe('specialization card metadata', () => {
  it('covers all 27 specs of all nine classes with complete panel data', () => {
    const specCount = Object.values(TALENTS).reduce(
      (count, classTalents) => count + classTalents.specs.length,
      0,
    );
    expect(specCount).toBe(27);
    for (const [cls, classTalents] of Object.entries(TALENTS) as [
      PlayerClass,
      (typeof TALENTS)[PlayerClass],
    ][]) {
      // Exactly the class's real specs: no missing panels, no orphan cards.
      expect(Object.keys(SPEC_CARD_INFO[cls]).sort(), cls).toEqual(
        classTalents.specs.map((spec) => spec.id).sort(),
      );
      for (const spec of classTalents.specs) {
        const card = SPEC_CARD_INFO[cls][spec.id];
        expect(card, `missing spec card for ${cls}:${spec.id}`).toBeTruthy();
        expect(['str', 'agi', 'int', 'spi', 'sta'], `${cls}:${spec.id}`).toContain(
          card.primaryStat,
        );
        expect(['low', 'medium', 'high'], `${cls}:${spec.id}`).toContain(card.complexity);
        expect(card.examples.length, `${cls}:${spec.id}`).toBeGreaterThanOrEqual(3);
        expect(card.examples.length, `${cls}:${spec.id}`).toBeLessThanOrEqual(4);
        expect(new Set(card.examples).size, `${cls}:${spec.id} duplicate example`).toBe(
          card.examples.length,
        );
        for (const abilityId of card.examples) {
          const ability = ABILITIES[abilityId];
          expect(ability, `ability "${abilityId}" does not exist (${cls}:${spec.id})`).toBeTruthy();
          expect(ability.class, `"${abilityId}" belongs to ${ability?.class}, not ${cls}`).toBe(
            cls,
          );
          expect(
            ability.specs === undefined || ability.specs.includes(spec.id),
            `ability "${abilityId}" is not offered by ${cls}:${spec.id}`,
          ).toBe(true);
        }
      }
    }
  });

  it('keeps the mage cards int-scaled', () => {
    for (const id of ['fire', 'frost', 'arcane']) {
      expect(SPEC_CARD_INFO.mage[id].primaryStat, id).toBe('int');
    }
  });

  it('showcases the Hourglass as Chronomancy identity instead of Perfect Moment', () => {
    expect(SPEC_CARD_INFO.mage.arcane.examples).toContain('temporal_hourglass');
    expect(SPEC_CARD_INFO.mage.arcane.examples).not.toContain('perfect_moment');
  });
});
