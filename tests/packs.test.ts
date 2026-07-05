import { describe, expect, it } from 'vitest';
import {
  PACK_CATALOG,
  PACKS_BY_ID,
  PackDef,
  eligibleRewards,
  pickByWeight,
  oddsForPolicy,
  rollPack,
  validatePackCatalog,
  WeightedReward,
} from '../server/packs';
import { PackPowerPolicy } from '../server/engagement_config';
import { ITEMS } from '../src/sim/data';
import { AUGMENTS_BY_ID } from '../src/sim/content/augments';

const itemQuality = (ref: string) => ITEMS[ref]?.quality;
const augmentIds = new Set(Object.keys(AUGMENTS_BY_ID));
const POLICIES: PackPowerPolicy[] = ['cosmetic', 'seasonal', 'open'];

describe('PACK_CATALOG referential integrity (against the live registries)', () => {
  it('every reward ref resolves and every declared rarity matches real content', () => {
    const v = validatePackCatalog(PACK_CATALOG, itemQuality, augmentIds);
    expect(v.errors).toEqual([]);
    expect(v.ok).toBe(true);
  });

  it('indexes packs by id', () => {
    expect(PACKS_BY_ID.common_cache.priceWoc).toBe(250);
    expect(Object.keys(PACKS_BY_ID).sort()).toEqual(['common_cache', 'prismatic_cache', 'rare_cache']);
  });

  it('the validator actually rejects a broken catalog', () => {
    const badRef: PackDef = {
      id: 'bad',
      name: 'Bad',
      priceWoc: 1,
      rolls: 1,
      table: [{ reward: { kind: 'gear', ref: 'no_such_item', qty: 1, minPolicy: 'cosmetic' }, rarity: 'common', weight: 1 }],
    };
    expect(validatePackCatalog([badRef], itemQuality, augmentIds).errors).toContain('bad: unknown item ref no_such_item');

    const mismatched: PackDef = {
      id: 'mm',
      name: 'MM',
      priceWoc: 1,
      rolls: 1,
      table: [{ reward: { kind: 'gear', ref: 'worn_sword', qty: 1, minPolicy: 'cosmetic' }, rarity: 'rare', weight: 1 }],
    };
    expect(validatePackCatalog([mismatched], itemQuality, augmentIds).errors).toContain('mm/worn_sword: rarity rare != item quality common');

    const badAug: PackDef = {
      id: 'ba',
      name: 'BA',
      priceWoc: 1,
      rolls: 1,
      table: [{ reward: { kind: 'buff', ref: 'aug_nope', qty: 1, minPolicy: 'cosmetic' }, rarity: 'uncommon', weight: 1 }],
    };
    expect(validatePackCatalog([badAug], itemQuality, augmentIds).errors).toContain('ba: unknown augment ref aug_nope');

    const badShape: PackDef = { id: 'bs', name: 'BS', priceWoc: 0, rolls: 0, table: [] };
    const errs = validatePackCatalog([badShape], itemQuality, augmentIds).errors;
    expect(errs).toContain('bs: bad priceWoc 0');
    expect(errs).toContain('bs: bad rolls 0');
    expect(errs).toContain('bs: empty table');
  });
});

describe('eligibleRewards (realm policy filter)', () => {
  it('cosmetic excludes every seasonal/open reward; open includes all', () => {
    for (const pack of PACK_CATALOG) {
      const cos = eligibleRewards(pack.table, 'cosmetic');
      expect(cos.length).toBeGreaterThan(0);
      expect(cos.every((w) => w.reward.minPolicy === 'cosmetic')).toBe(true);

      const sea = eligibleRewards(pack.table, 'seasonal');
      expect(sea.every((w) => w.reward.minPolicy !== 'open')).toBe(true);
      expect(sea.length).toBeGreaterThanOrEqual(cos.length);

      const open = eligibleRewards(pack.table, 'open');
      expect(open.length).toBe(pack.table.length);
      expect(open.length).toBeGreaterThanOrEqual(sea.length);
    }
  });
});

describe('pickByWeight', () => {
  const entries: WeightedReward[] = [
    { reward: { kind: 'consumable', ref: 'a', qty: 1, minPolicy: 'cosmetic' }, rarity: 'common', weight: 70 },
    { reward: { kind: 'gear', ref: 'b', qty: 1, minPolicy: 'cosmetic' }, rarity: 'rare', weight: 30 },
  ];

  it('maps unit ranges to cumulative slices and clamps out-of-range', () => {
    expect(pickByWeight(entries, 0).reward.ref).toBe('a');
    expect(pickByWeight(entries, 0.69).reward.ref).toBe('a');
    expect(pickByWeight(entries, 0.7).reward.ref).toBe('b');
    expect(pickByWeight(entries, -1).reward.ref).toBe('a');
    expect(pickByWeight(entries, 5).reward.ref).toBe('b');
  });

  it('throws on an empty entry list', () => {
    expect(() => pickByWeight([], 0.5)).toThrow(/no entries/);
  });
});

describe('oddsForPolicy', () => {
  it('normalized probabilities sum to 1 under each policy', () => {
    for (const pack of PACK_CATALOG) {
      for (const policy of POLICIES) {
        const odds = oddsForPolicy(pack, policy);
        const sum = odds.reduce((s, o) => s + o.probability, 0);
        expect(sum).toBeCloseTo(1, 10);
      }
    }
  });

  it('a looser policy exposes at least as many distinct drops', () => {
    const pack = PACKS_BY_ID.rare_cache;
    expect(oddsForPolicy(pack, 'open').length).toBeGreaterThan(oddsForPolicy(pack, 'cosmetic').length);
  });
});

describe('rollPack', () => {
  const pity: PackDef = {
    id: 'test_pity',
    name: 'T',
    priceWoc: 1,
    rolls: 2,
    pity: { rarity: 'rare', within: 3 },
    table: [
      { reward: { kind: 'consumable', ref: 'c', qty: 1, minPolicy: 'cosmetic' }, rarity: 'common', weight: 90 },
      { reward: { kind: 'gear', ref: 'r', qty: 1, minPolicy: 'cosmetic' }, rarity: 'rare', weight: 10 },
    ],
  };

  it('is deterministic and returns exactly pack.rolls rewards', () => {
    const a = rollPack(pity, 'cosmetic', [0.1, 0.2, 0.3], 0);
    const b = rollPack(pity, 'cosmetic', [0.1, 0.2, 0.3], 0);
    expect(a).toEqual(b);
    expect(a.rewards).toHaveLength(2);
  });

  it('only grants policy-eligible rewards', () => {
    for (const pack of PACK_CATALOG) {
      const res = rollPack(pack, 'cosmetic', [0.01, 0.5, 0.99, 0.5], 0);
      expect(res.rewards.every((r) => r.reward.minPolicy === 'cosmetic')).toBe(true);
    }
  });

  it('increments the pity counter when no pity-rarity drops and the streak is short', () => {
    // units [0,0] always pick the 90-weight common.
    expect(rollPack(pity, 'cosmetic', [0, 0], 0).opensSincePityAfter).toBe(1);
    expect(rollPack(pity, 'cosmetic', [0, 0], 1).opensSincePityAfter).toBe(2);
  });

  it('forces a guaranteed pity reward when the streak hits the threshold', () => {
    const res = rollPack(pity, 'cosmetic', [0, 0], 2); // opens becomes 3 == within
    expect(res.opensSincePityAfter).toBe(0);
    const guaranteed = res.rewards.filter((r) => r.pity);
    expect(guaranteed).toHaveLength(1);
    expect(guaranteed[0].rarity).toBe('rare');
  });

  it('resets the counter on a natural pity-rarity hit without flagging it as pity', () => {
    // unit 0.99 on the first roll picks the rare; the second stays common.
    const res = rollPack(pity, 'cosmetic', [0.99, 0], 2);
    expect(res.opensSincePityAfter).toBe(0);
    expect(res.rewards.some((r) => r.rarity === 'rare' && !r.pity)).toBe(true);
    expect(res.rewards.some((r) => r.pity)).toBe(false);
  });

  it('does not fire pity when the realm policy filters every pity-rarity reward out', () => {
    const seasonalOnlyRare: PackDef = {
      id: 'so',
      name: 'SO',
      priceWoc: 1,
      rolls: 1,
      pity: { rarity: 'rare', within: 1 },
      table: [
        { reward: { kind: 'consumable', ref: 'c', qty: 1, minPolicy: 'cosmetic' }, rarity: 'common', weight: 90 },
        { reward: { kind: 'gear', ref: 'r', qty: 1, minPolicy: 'open' }, rarity: 'rare', weight: 10 },
      ],
    };
    // Under cosmetic the only rare is filtered out, so no guarantee can apply.
    const res = rollPack(seasonalOnlyRare, 'cosmetic', [0, 0], 5);
    expect(res.rewards.every((r) => r.rarity === 'common')).toBe(true);
    expect(res.rewards.some((r) => r.pity)).toBe(false);
    expect(res.opensSincePityAfter).toBe(6);
  });

  it('throws on no eligible rewards or too few units (config bugs, not runtime)', () => {
    const allOpen: PackDef = {
      id: 'ao',
      name: 'AO',
      priceWoc: 1,
      rolls: 1,
      table: [{ reward: { kind: 'gear', ref: 'r', qty: 1, minPolicy: 'open' }, rarity: 'rare', weight: 1 }],
    };
    expect(() => rollPack(allOpen, 'cosmetic', [0.5], 0)).toThrow(/no eligible rewards/);
    expect(() => rollPack(pity, 'cosmetic', [0.5], 0)).toThrow(/needs 2 units/);
  });
});
