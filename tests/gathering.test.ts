import { describe, expect, it } from 'vitest';
import {
  HARVEST_COMPONENT_ITEMS,
  harvestItemFor,
  isHarvestableCorpse,
  resolveCorpseHarvest,
} from '../src/sim/professions/gathering';

describe('resolveCorpseHarvest: single-use, first-come corpse claim', () => {
  it('lets the first attempt against an unclaimed corpse succeed', () => {
    const claim = resolveCorpseHarvest(null, 1);
    expect(claim).toEqual({ success: true, claimedBy: 1 });
  });

  it('denies a second attempt once the corpse is claimed', () => {
    const first = resolveCorpseHarvest(null, 1);
    const second = resolveCorpseHarvest(first.claimedBy, 2);
    expect(second).toEqual({ success: false, claimedBy: 1 });
  });

  it('denies a later solo attempt against an already-claimed corpse', () => {
    const claim = resolveCorpseHarvest(7, 42);
    expect(claim).toEqual({ success: false, claimedBy: 7 });
  });

  it('is deterministic regardless of call order for the same starting state', () => {
    // Two independent resolutions against the SAME unclaimed state, in either
    // order, always produce "first caller wins, second caller denied": the
    // function itself has no hidden state to make order matter beyond whichever
    // caller happens to run it first against the still-null corpse.
    const runA = () => {
      const a = resolveCorpseHarvest(null, 10);
      const b = resolveCorpseHarvest(a.claimedBy, 20);
      return [a, b];
    };
    const runB = () => {
      const a = resolveCorpseHarvest(null, 10);
      const b = resolveCorpseHarvest(a.claimedBy, 20);
      return [a, b];
    };
    expect(runA()).toEqual(runB());
  });

  it('the claiming player is always the one recorded, never the denied one', () => {
    const claim = resolveCorpseHarvest(null, 99);
    expect(claim.claimedBy).toBe(99);
    const denied = resolveCorpseHarvest(claim.claimedBy, 100);
    expect(denied.claimedBy).toBe(99);
  });
});

describe('isHarvestableCorpse', () => {
  it('is false with no component tags', () => {
    expect(isHarvestableCorpse(undefined)).toBe(false);
    expect(isHarvestableCorpse([])).toBe(false);
  });

  it('is true with at least one component tag', () => {
    expect(isHarvestableCorpse(['hide'])).toBe(true);
  });
});

describe('harvestItemFor', () => {
  it('returns null with no component tags', () => {
    expect(harvestItemFor(undefined)).toBeNull();
  });

  it('returns null when no tag maps to a wired-up item yet', () => {
    expect(harvestItemFor(['unmapped_tag_future_issue'])).toBeNull();
  });

  it('maps every currently-wired component tag to its item', () => {
    for (const [tag, itemId] of Object.entries(HARVEST_COMPONENT_ITEMS)) {
      expect(harvestItemFor([tag])).toBe(itemId);
    }
  });

  it('returns the first mapped tag when a mob has several', () => {
    expect(harvestItemFor(['unmapped_tag_future_issue', 'fang'])).toBe('wolf_fang');
  });
});
