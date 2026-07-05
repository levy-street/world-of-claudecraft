import { describe, expect, it } from 'vitest';
import { OVERHEAD_EMOTE_IDS, type OverheadEmoteId } from '../src/sim/types';
import { isOverheadEmoteId, OVERHEAD_EMOTES } from '../src/world_api/chat';

// The IWorld seam file src/world_api/chat.ts imports sim/ for TYPES only, so its
// runtime overhead-emote id set is derived from its own OVERHEAD_EMOTES array, not
// value-imported from sim/types' canonical OVERHEAD_EMOTE_IDS (the seam-purity scan
// in architecture.test.ts enforces the type-only import). That decoupling is only
// safe while the two lists stay in lockstep: an id added to OVERHEAD_EMOTE_IDS alone
// would silently drop out of isOverheadEmoteId and the emote wheel with no failure.
// These guards lock the two together at compile time and at run time.

// Compile-time: the local array's id union must EQUAL the canonical OverheadEmoteId
// union. The `satisfies` clause in chat.ts already proves every local id is valid (no
// extras); this proves the reverse (no missing), so tsc reddens the moment sim/types
// gains an id that OVERHEAD_EMOTES does not list. Type-only, so it adds no runtime
// sim import to the seam.
type Expect<T extends true> = T;
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type LocalOverheadEmoteId = (typeof OVERHEAD_EMOTES)[number]['id'];
type _OverheadEmoteIdsAreComplete = Expect<Equal<LocalOverheadEmoteId, OverheadEmoteId>>;

describe('overhead emote id parity (world_api/chat.ts vs sim/types)', () => {
  it('OVERHEAD_EMOTES lists exactly the canonical OVERHEAD_EMOTE_IDS, no drift either way', () => {
    const local = new Set<string>(OVERHEAD_EMOTES.map((e) => e.id));
    const canonical = new Set<string>(OVERHEAD_EMOTE_IDS);
    expect(local).toEqual(canonical);
  });

  it('isOverheadEmoteId accepts every canonical id and rejects a non-member or non-string', () => {
    for (const id of OVERHEAD_EMOTE_IDS) expect(isOverheadEmoteId(id)).toBe(true);
    expect(isOverheadEmoteId('not-an-emote')).toBe(false);
    expect(isOverheadEmoteId(123)).toBe(false);
    expect(isOverheadEmoteId(undefined)).toBe(false);
    expect(isOverheadEmoteId(null)).toBe(false);
  });
});
