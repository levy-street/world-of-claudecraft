import { describe, expect, it } from 'vitest';
import { migrateCharacterState, migrateMarketState } from '../scripts/old_cragmaw_pelt_migration';

describe('migrate_old_cragmaw_pelt', () => {
  it('migrates retired pelt IDs in character inventory and buyback only', () => {
    const state = {
      inventory: [
        { itemId: 'pristine_ridge_stalker_pelt', count: 2 },
        { itemId: 'ridge_stalker_pelt', count: 8 },
      ],
      vendorBuyback: [{ itemId: 'pristine_ridge_stalker_pelt', count: 1 }],
      equipment: { mainhand: 'rusty_sword' },
    };

    const result = migrateCharacterState(state);

    expect(result.changed).toBe(true);
    expect(result.value).toEqual({
      inventory: [
        { itemId: 'old_cragmaws_pelt', count: 2 },
        { itemId: 'ridge_stalker_pelt', count: 8 },
      ],
      vendorBuyback: [{ itemId: 'old_cragmaws_pelt', count: 1 }],
      equipment: { mainhand: 'rusty_sword' },
    });
    expect(state.inventory[0]?.itemId).toBe('pristine_ridge_stalker_pelt');
  });

  it('migrates retired pelt IDs in market listings and collections', () => {
    const state = {
      listings: [
        {
          id: 12,
          sellerKey: 'Reuben',
          sellerName: 'Reuben',
          itemId: 'pristine_ridge_stalker_pelt',
          count: 1,
          price: 50,
          secondsLeft: 3600,
        },
      ],
      collections: [
        {
          key: 'Reuben',
          copper: 0,
          items: [
            { itemId: 'pristine_ridge_stalker_pelt', count: 3 },
            { itemId: 'ridge_stalker_pelt', count: 4 },
          ],
        },
      ],
      nextListingId: 13,
    };

    const result = migrateMarketState(state);

    expect(result.changed).toBe(true);
    expect(result.value).toEqual({
      listings: [
        {
          id: 12,
          sellerKey: 'Reuben',
          sellerName: 'Reuben',
          itemId: 'old_cragmaws_pelt',
          count: 1,
          price: 50,
          secondsLeft: 3600,
        },
      ],
      collections: [
        {
          key: 'Reuben',
          copper: 0,
          items: [
            { itemId: 'old_cragmaws_pelt', count: 3 },
            { itemId: 'ridge_stalker_pelt', count: 4 },
          ],
        },
      ],
      nextListingId: 13,
    });
  });

  it('is idempotent once retired pelt IDs are gone', () => {
    const state = {
      inventory: [{ itemId: 'old_cragmaws_pelt', count: 2 }],
      vendorBuyback: [],
      equipment: {},
    };

    const result = migrateCharacterState(state);

    expect(result.changed).toBe(false);
    expect(result.value).toBe(state);
  });
});
