// The crafting self-delta decodes, extracted whole from src/net/online.ts at
// Masterwrought phase 16 (the recorded monolith-ratchet payback): the `mst`
// mobile-station split and the `cprof` crafting-identity rebuild. One of the
// wire-decode siblings (snapshot_timer_wire.ts, guild_bank_log_wire.ts,
// mount_race_wire.ts, bank_snapshot_wire.ts): DOM-free, ClientWorld-free, so
// tests/crafting_wire.test.ts can pin both decode contracts directly while
// tests/snapshots.test.ts keeps exercising them through real snapshots.
import type { CraftingIdentityView } from '../world_api/professions';

// The one frozen empty craft set the mst mirror hands out (initial value and
// every empty transition), so the empty case is identity-stable and
// allocation-free exactly like the offline resolver's EMPTY_CRAFTS.
// Exported for tests/helpers/bare_client.ts, which mirrors ClientWorld's
// static defaults contract-for-contract.
export const EMPTY_MST_CRAFTS: readonly string[] = Object.freeze([]);

// Frozen: the cached array is shared with every reader until the
// raw string changes, so a consumer mutation would corrupt the
// mirror persistently. The empty arm reuses the one shared frozen
// empty, and a malformed empty STRING (the shipped server sends
// null for the empty set, never '') decodes as empty rather than
// [''], the drop-malformed wire idiom.
export function decodeMobileStationCrafts(raw: string | null): readonly string[] {
  return raw ? (Object.freeze(raw.split(',')) as readonly string[]) : EMPTY_MST_CRAFTS;
}

/** The atomic `cprof` (craftingIdentity) self-delta rebuild: the identity is
 *  replaced wholesale on every cprof delta, and `identity.craftSkills` IS the
 *  returned `craftSkills` object, so the caller can point both of its mirrors
 *  at the same map and the two reads can never disagree (the field contract on
 *  ClientWorld.craftSkills / ClientWorld.craftingIdentity). */
export function decodeCraftingIdentity(cprof: CraftingIdentityView): {
  craftSkills: Record<string, number>;
  identity: CraftingIdentityView;
} {
  const craftSkills: Record<string, number> = { ...(cprof.craftSkills ?? {}) };
  const identity: CraftingIdentityView = {
    version: 1,
    synced: true,
    craftSkills,
    activeArchetype: cprof.activeArchetype ?? null,
    pairedMajor: cprof.pairedMajor ?? null,
    hobbyCraft: cprof.hobbyCraft ?? null,
    attunedPairs: [...(cprof.attunedPairs ?? [])],
    switchCount: cprof.switchCount ?? 0,
    amendsProgress: cprof.amendsProgress ?? 0,
    amendsRequired: cprof.amendsRequired ?? 0,
    // The learned-recipe mirror. The identity is replaced
    // wholesale on every cprof delta (see the comment above), so a
    // train_recipe grant goes live the tick the server re-emits cprof
    // (its JSON diff fires on the sorted array changing). The ?? []
    // keeps an older server's payload (without the field) loading cleanly.
    knownRecipes: [...(cprof.knownRecipes ?? [])],
    // The server-computed work-order cooldown set (against ITS
    // tickCount). questState() feeds it into computeQuestState so a work
    // order on cooldown shows unavailable on the client too. The ?? []
    // keeps an older server's payload (without the field) loading cleanly.
    cadenceBlockedQuests: [...(cprof.cadenceBlockedQuests ?? [])],
    // The quested-hobby record, mirrored so the attunement preview can
    // promise the hobby a return will actually restore. Conditional
    // spread: absent stays absent (older server payloads, characters
    // without the feature).
    ...(cprof.questedHobbies ? { questedHobbies: { ...cprof.questedHobbies } } : {}),
  };
  return { craftSkills, identity };
}
