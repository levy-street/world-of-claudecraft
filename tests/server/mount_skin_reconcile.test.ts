import { describe, expect, it } from 'vitest';
import { wornMountSkinAllowed } from '../../server/mount_skin_reconcile';

// The join-time ownership rule for the worn mount skin: the save names the
// skin, the account owns it, and only the account's word counts.
describe('wornMountSkinAllowed', () => {
  it('always allows wearing nothing', () => {
    expect(wornMountSkinAllowed({ mountSkinIds: [] }, null)).toBe(true);
    expect(wornMountSkinAllowed({ mountSkinIds: [] }, undefined)).toBe(true);
    expect(wornMountSkinAllowed({ mountSkinIds: [] }, '')).toBe(true);
  });

  it('allows a worn skin the account owns', () => {
    expect(wornMountSkinAllowed({ mountSkinIds: ['mech_bird'] }, 'mech_bird')).toBe(true);
    expect(
      wornMountSkinAllowed({ mountSkinIds: ['chimeglass_tortoise', 'mech_bird'] }, 'mech_bird'),
    ).toBe(true);
  });

  it('refuses a worn skin the account does not own, and never heals ownership', () => {
    const cosmetics = { mountSkinIds: ['chimeglass_tortoise'] };
    expect(wornMountSkinAllowed(cosmetics, 'mech_bird')).toBe(false);
    expect(wornMountSkinAllowed({ mountSkinIds: [] }, 'mech_bird')).toBe(false);
    // The decision is read-only: the ownership list is untouched.
    expect(cosmetics.mountSkinIds).toEqual(['chimeglass_tortoise']);
  });
});
