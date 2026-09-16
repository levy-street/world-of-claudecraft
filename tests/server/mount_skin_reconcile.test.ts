import { describe, expect, it } from 'vitest';
import { wornMountSkinAllowed } from '../../server/mount_skin_reconcile';
import { RETIRED_MOUNT_SKIN_IDS } from '../../src/sim/content/mount_skins';

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

  it('takes off a retired skin the ownership row still carries', () => {
    // The Rallycart RXT left the catalog (RETIRED_MOUNT_SKIN_IDS) while its
    // grant row stays as dormant data: a save still naming it comes off at
    // join, and so does any id this binary has never heard of. The row itself
    // is untouched, so a rollback that restores the skin restores the GRANT;
    // the wear is gone for good once the next save omits the cleared id.
    for (const retired of RETIRED_MOUNT_SKIN_IDS) {
      const cosmetics = { mountSkinIds: [retired, 'mech_bird'] };
      expect(wornMountSkinAllowed(cosmetics, retired)).toBe(false);
      expect(cosmetics.mountSkinIds).toEqual([retired, 'mech_bird']);
    }
    expect(wornMountSkinAllowed({ mountSkinIds: ['not_a_skin'] }, 'not_a_skin')).toBe(false);
  });
});
