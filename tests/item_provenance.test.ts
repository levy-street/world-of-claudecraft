// The tracked-item provenance leaf (src/sim/item_provenance.ts): the guid
// shape gate, the deterministic host-less mint, the transfer rule over the
// bounded owner chain, the atomic load bound, and the deep clone. Every
// arm is pinned here once; the grant-side behaviour rides
// tests/item_tracking.test.ts.
import { describe, expect, it } from 'vitest';
import { sanitizeItemInstancePayloadOnLoad } from '../src/sim/item_instance_load';
import {
  cloneItemProvenance,
  currentItemHolder,
  deterministicItemGuid,
  ITEM_GUID_LENGTH,
  isItemGuid,
  isLoadableItemOwnerRecord,
  isLoadableItemProvenance,
  isSameItemHolder,
  MAX_ITEM_OWNER_HISTORY,
  MAX_ITEM_PROVENANCE_NAME_LENGTH,
  MAX_ITEM_PROVENANCE_SOURCE_LENGTH,
  recordItemTransfer,
  TRACKED_ITEM_QUALITIES,
} from '../src/sim/item_provenance';
import type { ItemProvenance } from '../src/sim/types';

const HOST_GUID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

function origin(): ItemProvenance {
  return {
    at: 1_700_000_000_000,
    by: 'Aaa',
    byId: 11,
    source: 'mob:forest_wolf',
    zone: 'eastbrook',
  };
}

describe('isItemGuid', () => {
  it('accepts a canonical lowercase v4 host mint and the v8 deterministic shape', () => {
    expect(isItemGuid(HOST_GUID)).toBe(true);
    expect(isItemGuid(deterministicItemGuid(42, 1, 1, 'ridgebreaker', 1))).toBe(true);
  });

  it('refuses uppercase, wrong length, wrong variant, and non-strings', () => {
    expect(isItemGuid(HOST_GUID.toUpperCase())).toBe(false);
    expect(isItemGuid(HOST_GUID.slice(0, -1))).toBe(false);
    expect(isItemGuid('3f2504e0-4f89-41d3-1a0c-0305e82c3301')).toBe(false);
    expect(isItemGuid('3f2504e0-4f89-01d3-9a0c-0305e82c3301')).toBe(false);
    expect(isItemGuid(42)).toBe(false);
    expect(isItemGuid(null)).toBe(false);
    expect(HOST_GUID).toHaveLength(ITEM_GUID_LENGTH);
  });
});

describe('deterministicItemGuid', () => {
  it('is a pure function of its inputs and distinct across any one input', () => {
    const a = deterministicItemGuid(42, 10, 1, 'ridgebreaker', 7);
    expect(deterministicItemGuid(42, 10, 1, 'ridgebreaker', 7)).toBe(a);
    expect(deterministicItemGuid(43, 10, 1, 'ridgebreaker', 7)).not.toBe(a);
    expect(deterministicItemGuid(42, 11, 1, 'ridgebreaker', 7)).not.toBe(a);
    expect(deterministicItemGuid(42, 10, 2, 'ridgebreaker', 7)).not.toBe(a);
    expect(deterministicItemGuid(42, 10, 1, 'duskforged_warblade', 7)).not.toBe(a);
    expect(deterministicItemGuid(42, 10, 1, 'ridgebreaker', 8)).not.toBe(a);
  });

  it('stamps the version 8 nibble and the RFC variant', () => {
    const guid = deterministicItemGuid(1, 1, 1, 'x', 1);
    expect(guid[14]).toBe('8');
    expect(['8', '9', 'a', 'b']).toContain(guid[19]);
  });
});

describe('recordItemTransfer', () => {
  it('appends a new holder and counts it; the same holder records nothing', () => {
    const p = origin();
    expect(recordItemTransfer(p, { at: 5, by: 'Aaa', byId: 11 })).toBe(false);
    expect(p.owners).toBeUndefined();
    expect(p.transfers).toBeUndefined();
    expect(recordItemTransfer(p, { at: 6, by: 'Bbb', byId: 12 })).toBe(true);
    expect(p.owners).toEqual([{ at: 6, by: 'Bbb', byId: 12 }]);
    expect(p.transfers).toBe(1);
    expect(currentItemHolder(p)).toEqual({ at: 6, by: 'Bbb', byId: 12 });
    // Back to Bbb again: still the holder, so nothing appended.
    expect(recordItemTransfer(p, { at: 7, by: 'Bbb', byId: 12 })).toBe(false);
    expect(p.transfers).toBe(1);
  });

  it('keys on the stable id when both sides carry one, on the name otherwise', () => {
    expect(isSameItemHolder({ at: 0, by: 'Old', byId: 3 }, { at: 0, by: 'New', byId: 3 })).toBe(
      true,
    );
    expect(isSameItemHolder({ at: 0, by: 'Same', byId: 3 }, { at: 0, by: 'Same', byId: 4 })).toBe(
      false,
    );
    expect(isSameItemHolder({ at: 0, by: 'Same' }, { at: 0, by: 'Same', byId: 4 })).toBe(true);
    expect(isSameItemHolder({ at: 0, by: 'A' }, { at: 0, by: 'B' })).toBe(false);
  });

  it('rolls the oldest hand off past MAX_ITEM_OWNER_HISTORY while transfers keeps counting', () => {
    const p = origin();
    for (let i = 0; i < MAX_ITEM_OWNER_HISTORY + 3; i++) {
      expect(recordItemTransfer(p, { at: 100 + i, by: `H${i}`, byId: 100 + i })).toBe(true);
    }
    expect(p.owners).toHaveLength(MAX_ITEM_OWNER_HISTORY);
    expect(p.owners?.[0].by).toBe('H3');
    expect(p.owners?.[MAX_ITEM_OWNER_HISTORY - 1].by).toBe(`H${MAX_ITEM_OWNER_HISTORY + 2}`);
    expect(p.transfers).toBe(MAX_ITEM_OWNER_HISTORY + 3);
  });
});

describe('isLoadableItemProvenance (the atomic load bound)', () => {
  it('accepts the origin alone and a fully loaded record', () => {
    expect(isLoadableItemProvenance(origin())).toBe(true);
    const full = origin();
    for (let i = 0; i < MAX_ITEM_OWNER_HISTORY; i++)
      recordItemTransfer(full, { at: i + 1, by: `H${i}` });
    expect(isLoadableItemProvenance(full)).toBe(true);
  });

  it.each([
    ['not an object', 'x'],
    ['an array', []],
    ['unknown key', { ...origin(), extra: 1 }],
    [
      'missing at',
      (() => {
        const p: Partial<ItemProvenance> = origin();
        delete p.at;
        return p;
      })(),
    ],
    ['negative at', { ...origin(), at: -1 }],
    ['empty by', { ...origin(), by: '' }],
    ['overlong by', { ...origin(), by: 'x'.repeat(MAX_ITEM_PROVENANCE_NAME_LENGTH + 1) }],
    ['non-printable by', { ...origin(), by: 'A\u0007' }],
    ['zero byId', { ...origin(), byId: 0 }],
    ['float byId', { ...origin(), byId: 1.5 }],
    [
      'missing source',
      (() => {
        const p: Partial<ItemProvenance> = origin();
        delete p.source;
        return p;
      })(),
    ],
    ['overlong source', { ...origin(), source: 's'.repeat(MAX_ITEM_PROVENANCE_SOURCE_LENGTH + 1) }],
    ['empty zone', { ...origin(), zone: '' }],
    ['owners not an array', { ...origin(), owners: {} }],
    [
      'owners past the ceiling',
      {
        ...origin(),
        owners: Array.from({ length: MAX_ITEM_OWNER_HISTORY + 1 }, (_, i) => ({ at: i, by: 'H' })),
      },
    ],
    ['owner with an unknown key', { ...origin(), owners: [{ at: 1, by: 'H', extra: true }] }],
    ['owner missing by', { ...origin(), owners: [{ at: 1 }] }],
    ['negative transfers', { ...origin(), transfers: -1 }],
    ['fractional transfers', { ...origin(), transfers: 1.5 }],
    ['null transfers', { ...origin(), transfers: null }],
  ])('refuses %s', (_label, value) => {
    expect(isLoadableItemProvenance(value)).toBe(false);
  });

  it('keeps a canonical derivedFrom parent guid and drops the whole record on a malformed one', () => {
    const parent = '9b2e7c1a-5d34-4f6e-8a1b-2c3d4e5f6071';
    expect(isLoadableItemProvenance({ ...origin(), derivedFrom: parent })).toBe(true);
    expect(isLoadableItemProvenance({ ...origin(), derivedFrom: HOST_GUID })).toBe(true);
    for (const bad of [parent.toUpperCase(), 'not-a-guid', '', 42, null, `${parent}0`]) {
      expect(isLoadableItemProvenance({ ...origin(), derivedFrom: bad }), JSON.stringify(bad)).toBe(
        false,
      );
    }
    // Through the real payload load bound: a valid parent rides through, a
    // malformed one drops the provenance record whole while the guid stays.
    const kept = sanitizeItemInstancePayloadOnLoad({
      guid: HOST_GUID,
      provenance: { ...origin(), derivedFrom: parent },
    });
    expect(kept.dropped).toEqual([]);
    expect(kept.payload?.provenance?.derivedFrom).toBe(parent);
    const dropped = sanitizeItemInstancePayloadOnLoad({
      guid: HOST_GUID,
      provenance: { ...origin(), derivedFrom: 'NOPE' },
    });
    expect(dropped.dropped).toEqual(['provenance']);
    expect(dropped.payload).toEqual({ guid: HOST_GUID });
  });

  it('judges an owner record on its own', () => {
    expect(isLoadableItemOwnerRecord({ at: 1, by: 'H' })).toBe(true);
    expect(isLoadableItemOwnerRecord({ at: 1, by: 'H', byId: 4 })).toBe(true);
    expect(isLoadableItemOwnerRecord({ at: 1, by: 'H', source: 'x' })).toBe(false);
    expect(isLoadableItemOwnerRecord(null)).toBe(false);
  });
});

describe('cloneItemProvenance', () => {
  it('never aliases the owner chain or its entries', () => {
    const p = origin();
    recordItemTransfer(p, { at: 2, by: 'Bbb' });
    const copy = cloneItemProvenance(p);
    expect(copy).toEqual(p);
    expect(copy.owners).not.toBe(p.owners);
    expect(copy.owners?.[0]).not.toBe(p.owners?.[0]);
    copy.owners?.push({ at: 3, by: 'Ccc' });
    expect(p.owners).toHaveLength(1);
  });

  it('is total over a malformed owners field (left for the load bound)', () => {
    const bad = { ...origin(), owners: 'junk' } as unknown as ItemProvenance;
    expect(() => cloneItemProvenance(bad)).not.toThrow();
  });
});

describe('TRACKED_ITEM_QUALITIES', () => {
  it('is exactly epic and legendary', () => {
    expect([...TRACKED_ITEM_QUALITIES].sort()).toEqual(['epic', 'legendary']);
  });
});
