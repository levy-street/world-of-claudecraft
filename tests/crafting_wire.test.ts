// Paired test for src/net/crafting_wire.ts, the wire-decode sibling extracted
// from online.ts's applySnapshot (Masterwrought phase 16 ratchet payback):
// pins the `mst` mobile-station split and the `cprof` crafting-identity
// rebuild directly, while tests/snapshots.test.ts and
// tests/crafting_view_combo_liveness.test.ts keep exercising both through the
// real ClientWorld snapshot spine.
import { describe, expect, it } from 'vitest';
import {
  decodeCraftingIdentity,
  decodeMobileStationCrafts,
  EMPTY_MST_CRAFTS,
} from '../src/net/crafting_wire';
import type { CraftingIdentityView } from '../src/world_api/professions';

describe('decodeMobileStationCrafts', () => {
  it('decodes null (the shipped empty-set wire value) to the one shared frozen empty by identity', () => {
    expect(decodeMobileStationCrafts(null)).toBe(EMPTY_MST_CRAFTS);
    expect(Object.isFrozen(EMPTY_MST_CRAFTS)).toBe(true);
  });

  it("decodes a malformed empty STRING to the shared empty, never [''] (drop-malformed idiom)", () => {
    // The shipped server sends null for the empty set and a non-empty join
    // can never be '', so this arm only fires on a buggy or adversarial
    // server; it must reuse the same shared frozen empty by identity.
    expect(decodeMobileStationCrafts('')).toBe(EMPTY_MST_CRAFTS);
  });

  it('splits a comma-joined scalar and freezes the result', () => {
    const crafts = decodeMobileStationCrafts('a,b');
    expect(crafts).toEqual(['a', 'b']);
    expect(Object.isFrozen(crafts)).toBe(true);
  });
});

describe('decodeCraftingIdentity', () => {
  // A fully populated modern payload, as the server's cprof delta ships it.
  const fullPayload = {
    version: 1,
    synced: true,
    craftSkills: { alchemy: 3, weaponcrafting: 7 },
    activeArchetype: 'artisan',
    pairedMajor: 'weaponcrafting',
    hobbyCraft: 'cooking',
    attunedPairs: ['weaponcrafting:jewelcrafting'],
    switchCount: 2,
    amendsProgress: 1,
    amendsRequired: 4,
    knownRecipes: ['recipe_a', 'recipe_b'],
    cadenceBlockedQuests: ['work_order_daily'],
    questedHobbies: { 'weaponcrafting:jewelcrafting': 'cooking' },
  } as CraftingIdentityView;

  it('marks the rebuilt identity synced: true regardless of the payload flag', () => {
    const stale = { ...fullPayload, synced: false } as CraftingIdentityView;
    expect(decodeCraftingIdentity(stale).identity.synced).toBe(true);
  });

  it('aliases identity.craftSkills to the returned craftSkills object', () => {
    // The two-reads-can-never-disagree contract: the caller points BOTH of
    // its mirrors (craftSkills and craftingIdentity.craftSkills) at the one
    // returned map, which is a copy, never the wire payload's own object.
    const decoded = decodeCraftingIdentity(fullPayload);
    expect(decoded.identity.craftSkills).toBe(decoded.craftSkills);
    expect(decoded.craftSkills).not.toBe(fullPayload.craftSkills);
    expect(decoded.craftSkills).toEqual({ alchemy: 3, weaponcrafting: 7 });
  });

  it('defaults every ?? arm cleanly against an older server payload', () => {
    // An older server's cprof carries none of the later fields at all; the
    // ?? []/?? 0/?? null arms must load it as the zero-value identity.
    const decoded = decodeCraftingIdentity({} as CraftingIdentityView);
    expect(decoded.craftSkills).toEqual({});
    expect(decoded.identity).toEqual({
      version: 1,
      synced: true,
      craftSkills: {},
      activeArchetype: null,
      pairedMajor: null,
      hobbyCraft: null,
      attunedPairs: [],
      switchCount: 0,
      amendsProgress: 0,
      amendsRequired: 0,
      knownRecipes: [],
      cadenceBlockedQuests: [],
    });
  });

  it('spreads questedHobbies conditionally: absent stays absent, present is copied', () => {
    const older = decodeCraftingIdentity({} as CraftingIdentityView);
    expect('questedHobbies' in older.identity).toBe(false);
    const modern = decodeCraftingIdentity(fullPayload);
    expect(modern.identity.questedHobbies).toEqual({ 'weaponcrafting:jewelcrafting': 'cooking' });
    expect(modern.identity.questedHobbies).not.toBe(fullPayload.questedHobbies);
  });

  it('copies the array fields rather than aliasing the payload rows', () => {
    const decoded = decodeCraftingIdentity(fullPayload);
    expect(decoded.identity.knownRecipes).toEqual(['recipe_a', 'recipe_b']);
    expect(decoded.identity.knownRecipes).not.toBe(fullPayload.knownRecipes);
    expect(decoded.identity.attunedPairs).not.toBe(fullPayload.attunedPairs);
    expect(decoded.identity.cadenceBlockedQuests).not.toBe(fullPayload.cadenceBlockedQuests);
  });
});
