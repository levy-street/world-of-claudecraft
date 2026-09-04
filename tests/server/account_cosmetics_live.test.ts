import { describe, expect, it } from 'vitest';
import {
  EMPTY_LIVE_ACCOUNT_COSMETICS,
  mergeAccountCosmetics,
  ownedWeaponSkinLoadout,
  withAccountSkinsGranted,
} from '../../server/account_cosmetics_live';
import type { AccountCosmetics } from '../../src/world_api';

const full = (over: Partial<AccountCosmetics> = {}): AccountCosmetics => ({
  completedQuestIds: [],
  mechChromaIds: [],
  weaponSkinIds: [],
  weaponSkinLoadout: {},
  mountSkinIds: [],
  ...over,
});

describe('mergeAccountCosmetics', () => {
  it('unions every ownership list and takes the fresh loadout verbatim', () => {
    const merged = mergeAccountCosmetics(
      full({
        completedQuestIds: ['q1'],
        mechChromaIds: ['amber_crimson'],
        weaponSkinIds: ['ice_fang_sword'],
        weaponSkinLoadout: { sword: 'ice_fang_sword', axe: 'glaciersplit_axe' },
        mountSkinIds: ['mech_bird'],
      }),
      full({
        completedQuestIds: ['q1', 'q2'],
        mechChromaIds: ['onyx_gold'],
        weaponSkinIds: ['glaciersplit_axe'],
        // The axe was detached on the fresh side: last write wins, no resurrection.
        weaponSkinLoadout: { sword: 'ice_fang_sword' },
        mountSkinIds: ['chimeglass_tortoise', 'mech_bird'],
      }),
    );
    expect(merged).toEqual({
      completedQuestIds: ['q1', 'q2'],
      mechChromaIds: ['amber_crimson', 'onyx_gold'],
      weaponSkinIds: ['ice_fang_sword', 'glaciersplit_axe'],
      weaponSkinLoadout: { sword: 'ice_fang_sword' },
      mountSkinIds: ['mech_bird', 'chimeglass_tortoise'],
    });
  });

  it('tolerates the older narrower shapes test doubles still hand over', () => {
    const legacy = { completedQuestIds: [], mechChromaIds: [] } as unknown as AccountCosmetics;
    expect(mergeAccountCosmetics(legacy, legacy)).toEqual(EMPTY_LIVE_ACCOUNT_COSMETICS);
    expect(
      mergeAccountCosmetics(legacy, full({ mountSkinIds: ['mech_bird'] })).mountSkinIds,
    ).toEqual(['mech_bird']);
  });

  it('never aliases the inputs', () => {
    const a = full({ mountSkinIds: ['mech_bird'] });
    const merged = mergeAccountCosmetics(a, full());
    expect(merged.mountSkinIds).not.toBe(a.mountSkinIds);
    expect(merged.weaponSkinLoadout).not.toBe(a.weaponSkinLoadout);
  });
});

describe('ownedWeaponSkinLoadout', () => {
  it('keeps only loadout entries the account actually owns', () => {
    expect(
      ownedWeaponSkinLoadout(
        full({
          weaponSkinIds: ['ice_fang_sword'],
          weaponSkinLoadout: { sword: 'ice_fang_sword', axe: 'glaciersplit_axe', bow: '' },
        }),
      ),
    ).toEqual({ sword: 'ice_fang_sword' });
    expect(ownedWeaponSkinLoadout(full())).toEqual({});
  });
});

describe('withAccountSkinsGranted', () => {
  it('returns the optimistic union for a live account with something new', () => {
    const current = full({ mountSkinIds: ['mech_bird'] });
    const next = withAccountSkinsGranted(
      current,
      ['mech_bird', 'chimeglass_tortoise'],
      'mountSkinIds',
    );
    expect(next).toEqual(full({ mountSkinIds: ['mech_bird', 'chimeglass_tortoise'] }));
    // The remembered view is untouched (a new object is returned).
    expect(current.mountSkinIds).toEqual(['mech_bird']);
  });

  it('is null when every id is already owned, and null with no live account', () => {
    expect(
      withAccountSkinsGranted(full({ mountSkinIds: ['mech_bird'] }), ['mech_bird'], 'mountSkinIds'),
    ).toBeNull();
    expect(withAccountSkinsGranted(undefined, ['mech_bird'], 'mountSkinIds')).toBeNull();
  });

  it('addresses the weapon family independently of the mount family', () => {
    const current = full({ weaponSkinIds: ['ice_fang_sword'], mountSkinIds: ['mech_bird'] });
    const next = withAccountSkinsGranted(current, ['glaciersplit_axe'], 'weaponSkinIds');
    expect(next?.weaponSkinIds).toEqual(['ice_fang_sword', 'glaciersplit_axe']);
    expect(next?.mountSkinIds).toEqual(['mech_bird']);
  });
});
