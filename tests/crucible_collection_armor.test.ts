import { describe, expect, it } from 'vitest';
import {
  CRUCIBLE_COLLECTION_ITEMS,
  CRUCIBLE_COLLECTIONS,
} from '../src/sim/content/crucible_collections';

describe('crafted collection armor stays alongside the current raid', () => {
  it('uses the current raid boot ceiling for all three armor weights', () => {
    const ceilings = { mail: 255, leather: 145, cloth: 70 };
    for (const collection of CRUCIBLE_COLLECTIONS) {
      const boots = CRUCIBLE_COLLECTION_ITEMS[collection.itemIds[2]];
      expect(boots.slot).toBe('feet');
      expect(boots.stats?.armor, collection.id).toBe(ceilings[collection.armorType]);
    }
  });
});
