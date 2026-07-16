import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  itemWeaponModelUrl,
  manifestUrls,
  mechHeldWeaponOverride,
  VISUALS,
  weaponSkinModelUrl,
  weaponSkinModelUrls,
} from '../src/render/characters/manifest';
import { WEAPON_SKIN_LIST } from '../src/sim/content/weapon_skins';
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

  it('itemWeaponModelUrl resolves mapped items and ignores everything else', () => {
    expect(itemWeaponModelUrl('worn_sword')).toBe('models/weapons/sword_a.glb');
    expect(itemWeaponModelUrl('fen_reaver_glaive')).toBe('models/weapons/scythe.glb');
    expect(itemWeaponModelUrl('chest_armor_not_a_weapon')).toBeNull();
    expect(itemWeaponModelUrl(null)).toBeNull();
    expect(itemWeaponModelUrl(undefined)).toBeNull();
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
      'mace',
      'halberd',
      'spear',
      'scythe',
      'wand',
      'bow',
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
    // the rogue dual-wields: both hand slots swap so a dagger shows in BOTH hands
    expect(VISUALS.player_rogue.weaponSlots).toEqual([0, 1]);
  });

  // The class-agnostic Combat Mech adopts the WEARER class's hand layout, so a
  // rogue wearing the mech still dual-wields (weapon in both hands), while every
  // single-wield class keeps the mech's own one-hand default (no override).
  it('the Combat Mech mirrors a dual-wield class so a rogue mech holds both hands', () => {
    const rogue = mechHeldWeaponOverride('rogue');
    expect(rogue?.weaponSlots).toEqual([0, 1]);
    expect(rogue?.attach?.length).toBe(2);
    for (const cls of [
      'warrior',
      'paladin',
      'hunter',
      'priest',
      'mage',
      'warlock',
      'shaman',
      'druid',
    ] as const) {
      expect(mechHeldWeaponOverride(cls), `${cls} should not dual-wield on the mech`).toBeNull();
    }
  });
});

// Season 1 Armory weapon skins swap the held model exactly like per-item
// variants, so every skin GLB must resolve by skin id and ride the boot preload
// sweep: any nearby player can have any skin applied, and the attach path is
// synchronous (resolvedGltf throws on an un-preloaded url).
describe('weapon skin held models', () => {
  it('weaponSkinModelUrl resolves catalog skins and ignores everything else', () => {
    expect(weaponSkinModelUrl('ice_fang_sword')).toBe('models/weapons/ice_fang.glb');
    expect(weaponSkinModelUrl('not_a_skin')).toBeNull();
    expect(weaponSkinModelUrl(null)).toBeNull();
    expect(weaponSkinModelUrl(undefined)).toBeNull();
  });

  it('ships 29 distinct skin model urls, all in the boot preload manifest', () => {
    const urls = weaponSkinModelUrls();
    expect(urls.length).toBe(WEAPON_SKIN_LIST.length);
    expect(urls.length).toBe(29);
    expect(new Set(urls).size).toBe(29);
    const manifest = new Set(manifestUrls());
    for (const url of urls) {
      expect(url.startsWith('models/weapons/'), url).toBe(true);
      expect(manifest.has(url), `${url} missing from manifestUrls()`).toBe(true);
    }
  });
});
