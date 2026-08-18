// Direct unit coverage for src/sim/mech_chroma_ownership.ts, the module the
// nineteenth-absorb sync extracted out of sim.ts under the monolith ratchet.
// The Sim seam already exercises the moved bodies end to end
// (tests/skin_event.test.ts, tests/appearance_skin.test.ts); this file proves
// the module against a literal fake host, the stated point of the structural
// MechChromaOwnershipHost shape.
import { describe, expect, it } from 'vitest';
import { MECH_CHROMAS, mechChromaSkinIndex } from '../src/sim/content/skins';
import {
  type MechChromaOwnershipHost,
  unequipWornMechChroma,
  unlockMechChromaFromItem,
} from '../src/sim/mech_chroma_ownership';

const CHROMA = MECH_CHROMAS[0];
const CHROMA_SKIN = mechChromaSkinIndex(CHROMA.id);

interface FakeHost extends MechChromaOwnershipHost {
  removed: Array<{ itemId: string; count: number; pid?: number }>;
  skins: Array<{ pid: number; skin: number; catalog?: string }>;
}

function makeHost(counts: Record<string, number> = {}): FakeHost {
  const host: FakeHost = {
    accountCosmetics: { mechChromaIds: [] },
    removed: [],
    skins: [],
    countItem: (itemId) => counts[itemId] ?? 0,
    removeItem(itemId, count, pid) {
      host.removed.push({ itemId, count, pid });
      return [];
    },
    setPlayerSkin(pid, skin, catalog) {
      host.skins.push({ pid, skin, catalog });
      return true;
    },
  };
  return host;
}

describe('unlockMechChromaFromItem', () => {
  it('consumes the item, records ownership, and wears the chroma', () => {
    const host = makeHost({ chroma_item: 1 });
    const result = unlockMechChromaFromItem(host, { entityId: 7 }, 'chroma_item', CHROMA.id);
    expect(result).toEqual({ type: 'mechChroma', chromaId: CHROMA.id });
    expect(host.removed).toEqual([{ itemId: 'chroma_item', count: 1, pid: 7 }]);
    expect(host.accountCosmetics.mechChromaIds).toEqual([CHROMA.id]);
    expect(host.skins).toEqual([{ pid: 7, skin: CHROMA_SKIN, catalog: 'mech' }]);
  });

  it('refuses an unknown chroma id before touching the bags', () => {
    const host = makeHost({ chroma_item: 1 });
    expect(unlockMechChromaFromItem(host, { entityId: 7 }, 'chroma_item', 'no_such')).toBe(
      undefined,
    );
    expect(host.removed).toEqual([]);
    expect(host.skins).toEqual([]);
  });

  it('refuses when the item is not held, consuming nothing', () => {
    const host = makeHost({});
    expect(unlockMechChromaFromItem(host, { entityId: 7 }, 'chroma_item', CHROMA.id)).toBe(
      undefined,
    );
    expect(host.removed).toEqual([]);
    expect(host.accountCosmetics.mechChromaIds).toEqual([]);
  });

  it('does not duplicate an already-owned chroma id', () => {
    const host = makeHost({ chroma_item: 1 });
    host.accountCosmetics = { mechChromaIds: [CHROMA.id] };
    const before = host.accountCosmetics;
    const result = unlockMechChromaFromItem(host, { entityId: 7 }, 'chroma_item', CHROMA.id);
    expect(result).toEqual({ type: 'mechChroma', chromaId: CHROMA.id });
    expect(host.accountCosmetics.mechChromaIds).toEqual([CHROMA.id]);
    // The already-owned branch reuses the ids array rather than growing it.
    expect(host.accountCosmetics.mechChromaIds).toBe(before.mechChromaIds);
  });
});

describe('unequipWornMechChroma', () => {
  it('reverts a worn chroma to the class body and keeps ownership', () => {
    const host = makeHost();
    host.accountCosmetics = { mechChromaIds: [CHROMA.id] };
    const worn = { entityId: 7, skinCatalog: 'mech' as const, skin: CHROMA_SKIN };
    expect(unequipWornMechChroma(host, worn, CHROMA.id)).toBe(true);
    expect(host.skins).toEqual([{ pid: 7, skin: 0, catalog: 'class' }]);
    expect(host.accountCosmetics.mechChromaIds).toEqual([CHROMA.id]);
  });

  it('refuses an unknown chroma id', () => {
    const host = makeHost();
    expect(
      unequipWornMechChroma(host, { entityId: 7, skinCatalog: 'mech', skin: CHROMA_SKIN }, 'nope'),
    ).toBe(false);
    expect(host.skins).toEqual([]);
  });

  it('refuses when the player is not wearing that chroma', () => {
    const host = makeHost();
    expect(
      unequipWornMechChroma(host, { entityId: 7, skinCatalog: 'class', skin: 0 }, CHROMA.id),
    ).toBe(false);
    expect(host.skins).toEqual([]);
  });
});
