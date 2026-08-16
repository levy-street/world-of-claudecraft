import { describe, expect, it } from 'vitest';
import { collapseIdentity, collapseToLowestPerItem } from '../src/sim/market_collapse';

describe('collapseToLowestPerItem', () => {
  it('keeps only the lowest-priced listing per distinct item id', () => {
    const listings = [
      { id: 1, itemId: 'sword_basic', price: 500 },
      { id: 2, itemId: 'sword_basic', price: 300 },
      { id: 3, itemId: 'shield_basic', price: 200 },
      { id: 4, itemId: 'sword_basic', price: 400 },
    ];
    const result = collapseToLowestPerItem(listings);
    expect(result).toEqual([
      { id: 2, itemId: 'sword_basic', price: 300 },
      { id: 3, itemId: 'shield_basic', price: 200 },
    ]);
  });

  it('breaks an exact price tie by the smaller (older) listing id, deterministically', () => {
    const listings = [
      { id: 10, itemId: 'sword_basic', price: 300 },
      { id: 5, itemId: 'sword_basic', price: 300 },
      { id: 7, itemId: 'sword_basic', price: 300 },
    ];
    expect(collapseToLowestPerItem(listings)).toEqual([
      { id: 5, itemId: 'sword_basic', price: 300 },
    ]);
    // Order of the tied rows in the input must not change the winner.
    expect(collapseToLowestPerItem([...listings].reverse())).toEqual([
      { id: 5, itemId: 'sword_basic', price: 300 },
    ]);
  });

  it('preserves first-occurrence item order, independent of price order within the input', () => {
    const listings = [
      { id: 1, itemId: 'b_item', price: 100 },
      { id: 2, itemId: 'a_item', price: 50 },
      { id: 3, itemId: 'b_item', price: 10 },
    ];
    const result = collapseToLowestPerItem(listings);
    expect(result.map((l) => l.itemId)).toEqual(['b_item', 'a_item']);
    expect(result.find((l) => l.itemId === 'b_item')).toEqual({
      id: 3,
      itemId: 'b_item',
      price: 10,
    });
  });

  it('passes through a stack whose cheapest row is a multi-count listing unchanged', () => {
    const listings = [
      { id: 1, itemId: 'ore', price: 50, count: 1 },
      { id: 2, itemId: 'ore', price: 40, count: 8 },
    ];
    expect(collapseToLowestPerItem(listings)).toEqual([
      { id: 2, itemId: 'ore', price: 40, count: 8 },
    ]);
  });

  it('keeps copies with DIFFERENT enchants or rolls as separate rows', () => {
    const listings = [
      { id: 1, itemId: 'sword_basic', price: 100 },
      { id: 2, itemId: 'sword_basic', price: 300, instance: { enchant: 'enchant_weapon_might' } },
      { id: 3, itemId: 'sword_basic', price: 250, instance: { enchant: 'enchant_weapon_agility' } },
      {
        id: 4,
        itemId: 'sword_basic',
        price: 400,
        instance: { rolled: { masterwork: true, stats: { str: 2 } } },
      },
    ];
    // Each materially distinct copy survives: plain, Might, Agility, masterwork.
    expect(collapseToLowestPerItem(listings)).toEqual(listings);
  });

  it('folds same-item, same-enchant copies to the cheapest, IGNORING the signer (issue 3383)', () => {
    // The live bug: five Deathless Greatblades, all with the same enchant but each a
    // distinct crafted copy (unique listing id + signer), showed as five rows because the
    // old key was the listing id. They are the same purchase; collapse to the cheapest.
    const listings = [
      {
        id: 1,
        itemId: 'greatblade',
        price: 900,
        instance: { enchant: 'enchant_weapon_might', signer: 'Ada' },
      },
      {
        id: 2,
        itemId: 'greatblade',
        price: 700,
        instance: { enchant: 'enchant_weapon_might', signer: 'Ben' },
      },
      { id: 3, itemId: 'greatblade', price: 800, instance: { enchant: 'enchant_weapon_might' } },
    ];
    expect(collapseToLowestPerItem(listings)).toEqual([
      {
        id: 2,
        itemId: 'greatblade',
        price: 700,
        instance: { enchant: 'enchant_weapon_might', signer: 'Ben' },
      },
    ]);
  });

  it('folds same rolled stats regardless of key order, and signer-only differences', () => {
    const listings = [
      {
        id: 1,
        itemId: 'ring',
        price: 500,
        instance: { rolled: { masterwork: true, stats: { str: 2, agi: 1 } }, signer: 'Ada' },
      },
      {
        id: 2,
        itemId: 'ring',
        price: 400,
        instance: { rolled: { masterwork: true, stats: { agi: 1, str: 2 } }, signer: 'Ben' },
      },
    ];
    expect(collapseToLowestPerItem(listings)).toEqual([listings[1]]);
  });

  it('folds a signer-only instanced copy together with the plain fungible stack', () => {
    // A payload carrying only a signer (no enchant, no roll) is the same goods as the
    // plain item to a buyer, so it must not spawn its own row.
    const listings = [
      { id: 1, itemId: 'ore', price: 50, instance: { signer: 'Ada' } },
      { id: 2, itemId: 'ore', price: 40 },
    ];
    expect(collapseToLowestPerItem(listings)).toEqual([{ id: 2, itemId: 'ore', price: 40 }]);
  });

  it('returns an empty array for an empty input, and a single row unchanged', () => {
    expect(collapseToLowestPerItem([])).toEqual([]);
    const solo = [{ id: 1, itemId: 'x', price: 10 }];
    expect(collapseToLowestPerItem(solo)).toEqual(solo);
  });
});

describe('collapseIdentity', () => {
  it('is the bare item id for a plain stack and for a payload with no buyer-relevant facts', () => {
    expect(collapseIdentity({ id: 1, itemId: 'ore', price: 1 })).toBe('ore');
    expect(collapseIdentity({ id: 2, itemId: 'ore', price: 1, instance: { signer: 'Ada' } })).toBe(
      'ore',
    );
  });

  it('is stable across signer differences but distinct across enchant differences', () => {
    const might = collapseIdentity({
      id: 1,
      itemId: 'sword',
      price: 1,
      instance: { enchant: 'enchant_weapon_might', signer: 'Ada' },
    });
    const mightOther = collapseIdentity({
      id: 2,
      itemId: 'sword',
      price: 1,
      instance: { enchant: 'enchant_weapon_might', signer: 'Ben' },
    });
    const agility = collapseIdentity({
      id: 3,
      itemId: 'sword',
      price: 1,
      instance: { enchant: 'enchant_weapon_agility' },
    });
    expect(might).toBe(mightOther);
    expect(might).not.toBe(agility);
  });

  it('cannot collide two materially different goods onto one key (separator safety)', () => {
    // The key is `i:${itemId}|e:${enchant}|r:${rolled}`. Even for adversarial ids that
    // contain the delimiter characters, a plain item id can never equal an instanced key
    // (an instanced key always contains '|'), and two different (item, enchant) pairs
    // never map to the same string.
    const plain = collapseIdentity({ id: 1, itemId: 'i:sword|e:x|r:', price: 1 });
    const instanced = collapseIdentity({
      id: 2,
      itemId: 'sword',
      price: 1,
      instance: { enchant: 'x' },
    });
    expect(plain).not.toBe(instanced);
    // Splitting the item/enchant boundary differently must not collide either.
    const a = collapseIdentity({ id: 3, itemId: 'a', price: 1, instance: { enchant: 'b_c' } });
    const b = collapseIdentity({ id: 4, itemId: 'a_b', price: 1, instance: { enchant: 'c' } });
    expect(a).not.toBe(b);
  });

  it('keeps a masterwork copy distinct from a plain copy, and folds two identical masterworks', () => {
    // rolled present with masterwork but no explicit stats still yields a NON-empty rolled
    // fragment ('m:'), so it stays its own row (different goods), and two such copies fold.
    const mwA = collapseIdentity({
      id: 1,
      itemId: 'ring',
      price: 1,
      instance: { rolled: { masterwork: true } },
    });
    const mwB = collapseIdentity({
      id: 2,
      itemId: 'ring',
      price: 1,
      instance: { rolled: { masterwork: true }, signer: 'Ada' },
    });
    const plain = collapseIdentity({ id: 3, itemId: 'ring', price: 1 });
    expect(mwA).toBe(mwB); // signer ignored, same masterwork goods fold
    expect(mwA).not.toBe(plain); // masterwork is not the plain item
  });

  it('excludes legacy rolled.quality from the fold key (same-stats copies fold regardless)', () => {
    const q1 = collapseIdentity({
      id: 1,
      itemId: 'ring',
      price: 1,
      instance: { rolled: { masterwork: true, stats: { str: 2 }, quality: 'fine' } },
    });
    const q2 = collapseIdentity({
      id: 2,
      itemId: 'ring',
      price: 1,
      instance: { rolled: { masterwork: true, stats: { str: 2 }, quality: 'superior' } },
    });
    expect(q1).toBe(q2);
  });
});
