import { describe, expect, it } from 'vitest';
import { sanitizeItemInstancePayloadOnLoad } from '../src/sim/item_instance_load';
import {
  createLootQuality,
  isValidLootQuality,
  lootQualityBonuses,
  lootQualityItemLevelBonus,
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
});
