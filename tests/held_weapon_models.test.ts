import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  KAYKIT_SHIELD_ACCESSORIES,
  KAYKIT_SHIELD_GRIPS,
} from '../src/render/characters/held_item_grips';
import {
  itemOffhandModelUrl,
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
    expect(itemWeaponModelUrl('eastbrook_greatsword')).toBe('models/weapons/adv_sword_2handed.glb');
    expect(itemWeaponModelUrl('highwatch_greatsword')).toBe('models/weapons/adv_sword_2handed.glb');
    expect(itemWeaponModelUrl('deathless_greatblade')).toBe(
      'models/weapons/adv_sword_2handed_color.glb',
    );
    expect(itemWeaponModelUrl('heroic_wyrmfang_greatblade')).toBe(
      'models/weapons/adv_sword_2handed_color.glb',
    );
    expect(itemWeaponModelUrl('chest_armor_not_a_weapon')).toBeNull();
    expect(itemWeaponModelUrl(null)).toBeNull();
    expect(itemWeaponModelUrl(undefined)).toBeNull();
  });

  it('resolves actual offhands independently from the mainhand model', () => {
    expect(itemOffhandModelUrl('eastbrook_buckler')).toBe('models/weapons/shield_round.glb');
    expect(itemOffhandModelUrl('highwatch_wallshield')).toBe('models/weapons/shield_square.glb');
    expect(itemOffhandModelUrl('rusty_dagger')).toBe('models/weapons/dagger_a.glb');
    expect(itemOffhandModelUrl('heroic_moggers_shiv')).toBe('models/weapons/dagger_c.glb');
    expect(itemOffhandModelUrl('chest_armor_not_an_offhand')).toBeNull();
    expect(itemOffhandModelUrl(null)).toBeNull();
    expect(itemOffhandModelUrl(undefined)).toBeNull();
  });

  it('preloads every live shield model used by an actual offhand', () => {
    const manifest = new Set(manifestUrls());
    for (const url of [
      itemOffhandModelUrl('eastbrook_buckler'),
      itemOffhandModelUrl('highwatch_wallshield'),
    ]) {
      expect(url).not.toBeNull();
      if (!url) continue;
      expect(existsSync(`public/${url}`), `${url} missing`).toBe(true);
      expect(manifest.has(url), `${url} missing from manifestUrls()`).toBe(true);
    }
  });

  it('uses KayKit authored per-variant shield seats in both hands', () => {
    const seats = [
      [
        'shield_round',
        'Round_Shield',
        {
          position: [0, 0.017, 0.1771],
          scale: 0.4413,
        },
      ],
      [
        'shield_square',
        'Rectangle_Shield',
        {
          position: [0, 0.017, 0.1617],
          scale: 0.5964,
        },
      ],
      [
        'shield_badge',
        'Badge_Shield',
        {
          position: [0, -0.0123, 0.1341],
          scale: 0.5108,
        },
      ],
    ] as const;

    for (const [file, node, grip] of seats) {
      expect(KAYKIT_SHIELD_ACCESSORIES[file]).toBe(node);
      expect(KAYKIT_SHIELD_GRIPS[node]).toEqual({
        r: { ...grip, quaternion: [0, 1, 0, 0] },
        l: { ...grip, quaternion: [0, 0, 0, 1] },
      });
    }
    expect(KAYKIT_SHIELD_GRIPS).not.toHaveProperty('Shield');
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
    // The rogue dual-wields through independent mainhand and offhand slots.
    expect(VISUALS.player_rogue.weaponSlots).toEqual([0]);
    expect(VISUALS.player_rogue.offhandSlot).toBe(1);
  });

  it('gives winning Warrior one mainhand swap and one independent live offhand', () => {
    expect(VISUALS.player_warrior.weaponSlots).toEqual([0]);
    expect(VISUALS.player_warrior.offhandSlot).toBe(1);
    expect(VISUALS.player_warrior.attach).toEqual([
      { url: 'models/weapons/sword_1handed.glb', bone: 'handslot.r' },
      { url: 'models/weapons/shield_round.glb', bone: 'handslot.l' },
    ]);
  });

  it('keeps every real offhand independent from mainhand cosmetics', () => {
    expect(VISUALS.player_rogue.offhandSlot).toBe(1);
    expect(VISUALS.player_paladin).toMatchObject({
      weaponSlots: [0],
      offhandSlot: 1,
      attach: [
        { url: 'models/weapons/axe_1handed.glb', bone: 'handslot.r' },
        { url: 'models/weapons/shield_square.glb', bone: 'handslot.l' },
      ],
    });
    expect(VISUALS.player_shaman).toMatchObject({
      weaponSlots: [0],
      offhandSlot: 1,
      attach: [
        { url: 'models/weapons/axe_1handed.glb', bone: 'handslot.r' },
        { url: 'models/weapons/shield_round.glb', bone: 'handslot.l' },
      ],
    });
  });

  // The class-agnostic Combat Mech adopts the wearer's real offhand layout, so
  // rogues keep their second weapon and shield classes keep their shield.
  it('the Combat Mech mirrors every class with an independent offhand', () => {
    const rogue = mechHeldWeaponOverride('rogue');
    expect(rogue?.weaponSlots).toEqual([0]);
    expect(rogue?.offhandSlot).toBe(1);
    expect(rogue?.attach?.length).toBe(2);
    expect(mechHeldWeaponOverride('paladin')?.offhandSlot).toBe(1);
    expect(mechHeldWeaponOverride('shaman')?.offhandSlot).toBe(1);
    for (const cls of ['hunter', 'priest', 'mage', 'warlock', 'druid'] as const) {
      expect(mechHeldWeaponOverride(cls), `${cls} should keep the mech default`).toBeNull();
    }

    const warrior = mechHeldWeaponOverride('warrior');
    expect(warrior?.weaponSlots).toEqual([0]);
    expect(warrior?.offhandSlot).toBe(1);
    expect(warrior?.attach?.[1]).toEqual({
      url: 'models/weapons/shield_round.glb',
      bone: 'handslot.l',
    });
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
