import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  itemHeldModelUrl,
  mechHeldWeaponOverride,
  VISUALS,
} from '../src/render/characters/manifest';
import { ITEM_WEAPON_VARIANTS } from '../src/ui/weapon_variants';

// The per-item held weapon models: each weapon item maps (via the shared
// ITEM_WEAPON_VARIANTS table) to a variant key that must have BOTH a 3D model GLB
// (held in-hand) and a 2D icon JPG (bag), so the held weapon always matches its
// inventory icon.
describe('held weapon models', () => {
  it('every weapon variant has a model GLB and an icon JPG on disk', () => {
    const keys = [...new Set(Object.values(ITEM_WEAPON_VARIANTS))];
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) {
      expect(existsSync(`public/models/weapons/${key}.glb`), `${key}.glb missing`).toBe(true);
      expect(existsSync(`public/ui/weapons/${key}.jpg`), `${key}.jpg missing`).toBe(true);
    }
  });

  it('itemHeldModelUrl resolves mapped held items and ignores everything else', () => {
    expect(itemHeldModelUrl('worn_sword')).toBe('models/weapons/sword_a.glb');
    expect(itemHeldModelUrl('fen_reaver_glaive')).toBe('models/weapons/scythe.glb');
    expect(itemHeldModelUrl('eastbrook_buckler')).toBe('models/weapons/shield_round.glb');
    expect(itemHeldModelUrl('chest_armor_not_a_weapon')).toBeNull();
    expect(itemHeldModelUrl(null)).toBeNull();
    expect(itemHeldModelUrl(undefined)).toBeNull();
  });

  // Every weapon variant must belong to a family that has a hand-grip mapping in
  // src/render/characters/assets.ts (KAYKIT_WEAPON_ACCESSORY). Without one the
  // model would attach at the bone origin untransformed. This list MUST stay in
  // sync with the variant families gripped there; a new family (e.g. a spear) needs
  // both a grip entry and an addition here, or this fails loudly.
  it('every weapon variant belongs to a grip-mapped family', () => {
    // Each variant key must contain a known weapon-type token so it maps to a grip
    // family in KAYKIT_WEAPON_ACCESSORY (assets.ts). Covers both the bare variant
    // keys (sword_a) and the prefixed/extra models (adv_sword_1handed, spear_a).
    const TYPES = [
      'sword',
      'dagger',
      'staff',
      'hammer',
      'axe',
      'halberd',
      'spear',
      'scythe',
      'wand',
    ];
    for (const key of new Set(Object.values(ITEM_WEAPON_VARIANTS))) {
      const ok = TYPES.some((t) => key.includes(t));
      expect(ok, `${key} has no recognized weapon type (needs a grip mapping)`).toBe(true);
    }
  });

  // Every player class swaps its held mainhand to the equipped weapon, EXCEPT the
  // hunter, which keeps its crossbow regardless of the melee weapon equipped. The
  // cosmetic Combat Mech (player_mech) is class-agnostic but is included: it still
  // shows the wearer's equipped mainhand, like every other body.
  it('all player classes swap the mainhand except the hunter', () => {
    const players = Object.keys(VISUALS).filter((k) => k.startsWith('player_'));
    expect(players).toContain('player_hunter');
    expect(players).toContain('player_mech');
    for (const key of players) {
      const def = VISUALS[key];
      if (key === 'player_hunter') {
        expect(def.weaponSlots, 'hunter must keep its crossbow').toBeUndefined();
      } else {
        expect(def.weaponSlots?.includes(0), `${key} should swap its mainhand`).toBe(true);
      }
    }
    expect(VISUALS.player_warrior.weaponSlots).toEqual([0, 1]);
    expect(VISUALS.player_paladin.weaponSlots).toEqual([0, 1]);
    expect(VISUALS.player_shaman.weaponSlots).toEqual([0, 1]);
    expect(VISUALS.player_rogue.weaponSlots).toEqual([0, 1]);
  });

  // The class-agnostic Combat Mech adopts the wearer class hand layout, including
  // shield/offhand classes.
  it('the Combat Mech mirrors class hand layouts, including offhands', () => {
    const rogue = mechHeldWeaponOverride('rogue');
    expect(rogue?.weaponSlots).toEqual([0, 1]);
    expect(rogue?.attach?.length).toBe(2);
    const warrior = mechHeldWeaponOverride('warrior');
    expect(warrior?.weaponSlots).toEqual([0, 1]);
    expect(warrior?.attach?.length).toBe(2);
    expect(mechHeldWeaponOverride('hunter')).toBeNull();
  });
});
