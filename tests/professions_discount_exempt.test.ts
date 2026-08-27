// The discount-exempt reagent flag (raid profession recipes,
// docs/prd/ignivar-raid-professions.md "The discount exemption"): a reagent
// carrying `noDiscount` is charged at its authored count for every crafter,
// always. Rationale pinned here so the numbers stay legible: every crafter
// eligible to LEARN a raid recipe is specialized in its craft by construction
// (the learn floor sits above the specialization perk threshold), so without
// the flag the 20 percent material discount would silently reprice the core
// reagent for literally everyone who can craft, and the authored economy
// (3/6/15 cores) would never be the real one. The ordinary gathering
// reagents on the same recipe keep every discount.
import { describe, expect, it } from 'vitest';
import { requiredReagentCountFor } from '../src/sim/professions/crafting';
import type { ProfessionReagent } from '../src/sim/professions/types';

// Skill 80 clears the specialization threshold (75) in armorcrafting, so the
// 20 percent material discount is live for this craft.
const SPECIALIZED_SKILLS = { armorcrafting: 80 };
const UNSPECIALIZED_SKILLS = { armorcrafting: 10 };

const core = (count: number): ProfessionReagent => ({
  itemId: 'raid_core_test',
  count,
  noDiscount: true,
});

describe('discount-exempt reagents (noDiscount)', () => {
  it('control: an unflagged reagent still composes every discount', () => {
    const plain: ProfessionReagent = { itemId: 'iron_ore', count: 6 };
    // Specialization alone: floor(6 * 0.8) = 4.
    expect(requiredReagentCountFor(false, plain, SPECIALIZED_SKILLS, 'armorcrafting').count).toBe(
      4,
    );
    // Self-signed minus one, then specialization: floor(5 * 0.8) = 4.
    const selfSigned = requiredReagentCountFor(true, plain, SPECIALIZED_SKILLS, 'armorcrafting');
    expect(selfSigned.count).toBe(4);
    expect(selfSigned.selfSignedBonusApplied).toBe(true);
    // All three composed (Jack adds 0.9): floor(5 * 0.8 * 0.9) = 3.
    expect(
      requiredReagentCountFor(true, plain, SPECIALIZED_SKILLS, 'armorcrafting', true).count,
    ).toBe(3);
  });

  it('a flagged reagent never discounts under any composition', () => {
    for (const count of [3, 6, 15]) {
      // The strongest possible stack: self-signed + specialized + Jack.
      const result = requiredReagentCountFor(
        true,
        core(count),
        SPECIALIZED_SKILLS,
        'armorcrafting',
        true,
      );
      expect(result.count).toBe(count);
      expect(result.selfSignedBonusApplied).toBe(false);
    }
  });

  it('a flagged reagent charges the authored count for the unspecialized too', () => {
    const result = requiredReagentCountFor(false, core(6), UNSPECIALIZED_SKILLS, 'armorcrafting');
    expect(result.count).toBe(6);
    expect(result.selfSignedBonusApplied).toBe(false);
  });
});
