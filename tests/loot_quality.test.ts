import { describe, expect, it } from 'vitest';
import { sanitizeItemInstancePayloadOnLoad } from '../src/sim/item_instance_load';
import {
  allocateQualityPoints,
  createLootQuality,
  isValidLootQuality,
  lootQualityBonuses,
  lootQualityItemLevelBonus,
  lootQualityTier,
} from '../src/sim/loot_quality';
import { Rng } from '../src/sim/rng';
import { cloneItemInstancePayload, type ItemDef, type ItemInstancePayload } from '../src/sim/types';

describe('loot quality immutable identity', () => {
  it('rejects every malformed version, tier and tuple atomically', () => {
    const valid = { version: 1, tier: 2, weights: [1, 2, 3, 4, 5] };
    const sparse = Array(5);
    sparse[0] = 1;
    for (const invalid of [
      { ...valid, version: 0 },
      { ...valid, version: 2 },
      { ...valid, version: '1' },
      { ...valid, tier: 0 },
      { ...valid, tier: 5 },
      { ...valid, tier: 1.5 },
      { ...valid, tier: '2' },
      { ...valid, weights: [1, 2, 3, 4, 5, 6] },
      { ...valid, weights: sparse },
      { ...valid, weights: [1, 2, 3, 4, 1.5] },
    ]) {
      expect(isValidLootQuality(invalid)).toBe(false);
      const clean = sanitizeItemInstancePayloadOnLoad({ signer: 'Alice', lootQuality: invalid });
      expect(clean).toEqual({ payload: { signer: 'Alice' }, dropped: ['lootQuality'] });
    }
  });
  it('replays the same real RNG stream and preserves the stream tail', () => {
    const run = () => {
      const rng = new Rng(92031);
      return {
        qualities: Array.from({ length: 1000 }, () => createLootQuality(rng)),
        tail: rng.next(),
      };
    };
    const first = run();
    expect(first).toEqual(run());
    expect(first.qualities.some((q) => q !== undefined)).toBe(true);
    expect(first.qualities.some((q) => q === undefined)).toBe(true);
  });
  it.each([
    [0, 0],
    [8999, 0],
    [9000, 1],
    [9899, 1],
    [9900, 2],
    [9989, 2],
    [9990, 3],
    [9998, 3],
    [9999, 4],
  ])('draw %i mints tier %i', (draw, tier) => {
    const rng = new Rng(1);
    let calls = 0;
    rng.int = (min, max) => {
      calls++;
      return max === 9999 ? draw : min;
    };
    const quality = createLootQuality(rng);
    expect(quality?.tier ?? 0).toBe(tier);
    expect(calls).toBe(tier ? 6 : 1);
    expect(lootQualityItemLevelBonus({ lootQuality: quality })).toBe(tier * 2);
  });
  it('deep-clones the descriptor and atomically drops corruption', () => {
    const source: ItemInstancePayload = {
      lootQuality: { version: 1, tier: 4, weights: [1, 2, 3, 4, 5] },
    };
    const copy = cloneItemInstancePayload(source);
    copy.lootQuality!.weights[0] = 999;
    expect(source.lootQuality!.weights[0]).toBe(1);
    for (const weights of [
      null,
      {},
      [1, 2],
      [0, 1, 1, 1, 1],
      [1, 1, 1, 1, Infinity],
      [1, 1, 1, 1, 1001],
    ]) {
      const dirty = {
        signer: 'Alice',
        lootQuality: { version: 1, tier: 4, weights },
      } as unknown as ItemInstancePayload;
      const clean = sanitizeItemInstancePayloadOnLoad(cloneItemInstancePayload(dirty));
      expect(clean.payload).toEqual({ signer: 'Alice' });
      expect(clean.dropped).toEqual(['lootQuality']);
    }
    expect(isValidLootQuality({ ...source.lootQuality, extra: { huge: 'x'.repeat(2000) } })).toBe(
      false,
    );
  });
  it('preserves ordinary stats and keeps random allocation on existing primary types', () => {
    const item = {
      id: 'probe',
      name: 'Probe',
      kind: 'armor',
      slot: 'chest',
      quality: 'epic',
      stats: { str: 80, sta: 20, armor: 200 },
    } as ItemDef;
    expect(lootQualityBonuses(item, undefined, 30)).toEqual({});
    for (let seed = 1; seed < 100; seed++) {
      const instance: ItemInstancePayload = {
        lootQuality: { version: 1, tier: 4, weights: [seed, 100, 1000 - seed, 1, 1] },
      };
      const bonuses = lootQualityBonuses(item, instance, 30);
      expect(Object.keys(bonuses).every((k) => ['str', 'sta', 'armor'].includes(k))).toBe(true);
      expect(Object.values(bonuses).every((v) => v >= 0)).toBe(true);
      expect(bonuses.str).toBeGreaterThanOrEqual(3);
    }
  });
  it('lets the five weights decide the per-copy split, pinned to literals', () => {
    // Highest-averages apportionment over the stats the item carries (str and
    // sta here; agi/int/spi weights are inert because the line has none).
    const profile = { str: 80, sta: 20 };
    expect(allocateQualityPoints(profile, [1000, 1, 1, 1, 1], 5)).toEqual({ str: 5 });
    expect(allocateQualityPoints(profile, [1, 1, 1000, 1, 1], 5)).toEqual({ sta: 5 });
    // 300 vs 100: str takes 300/1, 300/2, then the 300/3 = 100/1 tie (first
    // key wins a tie), and sta takes the fourth point at 100 over 300/4.
    expect(allocateQualityPoints(profile, [300, 1, 100, 1, 1], 4)).toEqual({ str: 3, sta: 1 });
    // Equal weights alternate (1/1 tie to str, then 1/2 vs 1/1 to sta, then the
    // 1/2 tie back to str); the inert agi/int/spi weights never enter.
    expect(allocateQualityPoints(profile, [1, 1000, 1, 1000, 1000], 3)).toEqual({ str: 2, sta: 1 });
    expect(allocateQualityPoints({ agi: 10 }, [1, 1, 1, 1, 1], 2)).toEqual({ agi: 2 });
    expect(allocateQualityPoints({ armor: 10 }, [1, 1, 1, 1, 1], 2)).toEqual({});
    // Through the real bonus path: two descriptors that differ ONLY in
    // weights resolve to different splits of the same random budget.
    const item = {
      id: 'probe',
      name: 'Probe',
      kind: 'armor',
      slot: 'chest',
      quality: 'epic',
      stats: { str: 80, sta: 20, armor: 200 },
    } as ItemDef;
    const strHeavy = lootQualityBonuses(
      item,
      { lootQuality: { version: 1, tier: 4, weights: [1000, 1, 1, 1, 1] } },
      30,
    );
    const staHeavy = lootQualityBonuses(
      item,
      { lootQuality: { version: 1, tier: 4, weights: [1, 1, 1000, 1, 1] } },
      30,
    );
    expect(strHeavy).not.toEqual(staHeavy);
    expect(strHeavy.str).toBeGreaterThan(staHeavy.str);
    expect(staHeavy.sta ?? 0).toBeGreaterThan(strHeavy.sta ?? 0);
    expect((strHeavy.str ?? 0) + (strHeavy.sta ?? 0)).toBe(
      (staHeavy.str ?? 0) + (staHeavy.sta ?? 0),
    );
    expect(strHeavy.armor).toBe(staHeavy.armor);
  });
  it('draws the tier from 0..9999 and every weight from 1..1000, in that order', () => {
    const rng = new Rng(1);
    const calls: Array<[number, number]> = [];
    rng.int = (min, max) => {
      calls.push([min, max]);
      return max === 9999 ? 9999 : max;
    };
    expect(createLootQuality(rng)).toEqual({
      version: 1,
      tier: 4,
      weights: [1000, 1000, 1000, 1000, 1000],
    });
    expect(calls).toEqual([
      [0, 9999],
      [1, 1000],
      [1, 1000],
      [1, 1000],
      [1, 1000],
      [1, 1000],
    ]);
    // The maximum weight is inside the validator's bound, as is the minimum.
    expect(isValidLootQuality({ version: 1, tier: 4, weights: [1000, 1, 1000, 1, 1000] })).toBe(
      true,
    );
  });
  it('loads a payload with no lootQuality key unchanged and reads it as ordinary', () => {
    const clean = sanitizeItemInstancePayloadOnLoad({ signer: 'Alice', enchant: 'ench_probe' });
    expect(clean).toEqual({ payload: { signer: 'Alice', enchant: 'ench_probe' }, dropped: [] });
    expect(Object.hasOwn(clean.payload ?? {}, 'lootQuality')).toBe(false);
    expect(lootQualityTier(clean.payload)).toBe(0);
    expect(lootQualityTier(undefined)).toBe(0);
    expect(lootQualityTier({})).toBe(0);
    expect(lootQualityItemLevelBonus({ signer: 'Alice' })).toBe(0);
  });
});
