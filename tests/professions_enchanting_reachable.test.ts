// Wheel-window reachability pin (Professions 2.0, deliverable 6):
// enchanting is a first-class craft in CRAFT_RING, so the read-only professions
// window already renders it. This pins that the composed view model contains an
// enchanting craft row whose skill bar reflects craftSkills.enchanting (display
// only), so a later content reorder or identity-view change that dropped the row
// would fail here rather than silently hide the profession from the wheel.

import { describe, expect, it } from 'vitest';
import { CRAFT_RING } from '../src/sim/content/professions';
import { buildProfessionsView } from '../src/ui/professions_view';
import type { CraftingIdentityView } from '../src/world_api/professions';

function identity(craftSkills: Record<string, number>): CraftingIdentityView {
  return {
    version: 1,
    synced: true,
    craftSkills,
    activeArchetype: null,
    pairedMajor: null,
    hobbyCraft: null,
    attunedPairs: [],
    switchCount: 0,
    amendsProgress: 0,
    amendsRequired: 0,
    knownRecipes: [],
  };
}

describe('professions wheel: enchanting is reachable', () => {
  it('is a craft in the ring', () => {
    expect(CRAFT_RING.some((craft) => craft.id === 'enchanting')).toBe(true);
  });

  it('renders an enchanting craft row whose bar reflects craftSkills.enchanting', () => {
    const model = buildProfessionsView({
      identity: identity({ enchanting: 40, weaponcrafting: 10 }),
      gathering: [],
    });
    const row = model.crafts.find((craft) => craft.identity.craftId === 'enchanting');
    if (!row) throw new Error('missing enchanting craft row');
    // Display-only: the bar reads the skill value straight from the identity.
    expect(row.bar.skill).toBe(40);
    expect(row.bar.fillFraction).toBeCloseTo(40 / row.bar.maxSkill, 5);
  });

  it('moves the enchanting bar when the skill value moves', () => {
    const low = buildProfessionsView({ identity: identity({ enchanting: 0 }), gathering: [] });
    const high = buildProfessionsView({ identity: identity({ enchanting: 100 }), gathering: [] });
    const skillOf = (m: ReturnType<typeof buildProfessionsView>) =>
      m.crafts.find((c) => c.identity.craftId === 'enchanting')?.bar.skill;
    expect(skillOf(low)).toBe(0);
    expect(skillOf(high)).toBe(100);
  });
});
