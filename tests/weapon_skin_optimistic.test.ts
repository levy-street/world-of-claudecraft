import { describe, expect, it } from 'vitest';
import { optimisticWeaponSkinChange } from '../src/net/weapon_skin_optimistic';

// The own-player nudge ClientWorld.changeWeaponSkin applies before the
// identity wire confirms it. Warriors hold worn_sword (a sword); ice_fang_sword
// is a sword skin and glaciersplit_axe an axe skin.
const warrior = (loadout: Record<string, string> = {}) => ({
  templateId: 'warrior',
  mainhandItemId: 'worn_sword',
  weaponSkinLoadout: loadout,
  skinCatalog: 'class' as const,
});

describe('optimisticWeaponSkinChange', () => {
  it('applies a skin onto its own weapon type and resolves it for the held weapon', () => {
    const next = optimisticWeaponSkinChange(warrior(), 'ice_fang_sword');
    expect(next).not.toBeNull();
    expect(next?.type).toBe('sword');
    expect(next?.loadout).toEqual({ sword: 'ice_fang_sword' });
    expect(next?.loadoutRecord).toEqual({ sword: 'ice_fang_sword' });
    expect(next?.weaponSkinId).toBe('ice_fang_sword');
  });

  it('keeps another type applied but unresolved when the held weapon differs', () => {
    const next = optimisticWeaponSkinChange(
      warrior({ sword: 'ice_fang_sword' }),
      'glaciersplit_axe',
    );
    expect(next?.type).toBe('axe');
    expect(next?.loadout).toEqual({ sword: 'ice_fang_sword', axe: 'glaciersplit_axe' });
    // Still holding the sword: the sword skin stays the resolved look.
    expect(next?.weaponSkinId).toBe('ice_fang_sword');
  });

  it('detaches by weapon type and clears the resolved skin when it was the held one', () => {
    const next = optimisticWeaponSkinChange(
      warrior({ sword: 'ice_fang_sword', axe: 'glaciersplit_axe' }),
      null,
      'sword',
    );
    expect(next?.type).toBe('sword');
    expect(next?.loadout).toEqual({ axe: 'glaciersplit_axe' });
    expect(next?.loadoutRecord).toEqual({ axe: 'glaciersplit_axe' });
    expect(next?.weaponSkinId).toBeNull();
  });

  it('refuses an unknown skin and a detach with no type', () => {
    expect(optimisticWeaponSkinChange(warrior(), 'not_a_skin')).toBeNull();
    expect(optimisticWeaponSkinChange(warrior({ sword: 'ice_fang_sword' }), null)).toBeNull();
  });

  it('never mutates the input loadout', () => {
    const loadout = { sword: 'ice_fang_sword' };
    optimisticWeaponSkinChange(warrior(loadout), null, 'sword');
    optimisticWeaponSkinChange(warrior(loadout), 'glaciersplit_axe');
    expect(loadout).toEqual({ sword: 'ice_fang_sword' });
  });
});
