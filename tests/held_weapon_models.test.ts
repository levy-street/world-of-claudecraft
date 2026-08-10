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
  offhandModelUrl,
  VISUALS,
  weaponSkinModelUrl,
  weaponSkinModelUrls,
} from '../src/render/characters/manifest';
import { WEAPON_SKIN_LIST } from '../src/sim/content/weapon_skins';
import { ITEMS } from '../src/sim/data';
import { weaponHand } from '../src/sim/equipment_rules';
import { iconDataUrl, weaponIconUrl } from '../src/ui/icons';
import { ITEM_WEAPON_VARIANTS } from '../src/ui/weapon_variants';

function withTemporaryOwnProperty(
  target: object,
  key: PropertyKey,
  value: unknown,
  run: () => void,
): void {
  const original = Object.getOwnPropertyDescriptor(target, key);
  Object.defineProperty(target, key, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  });
  try {
    run();
  } finally {
    if (original) Object.defineProperty(target, key, original);
    else Reflect.deleteProperty(target, key);
  }
}

// Held-model mappings and painted inventory art are deliberately independent.
// ITEM_WEAPON_VARIANTS selects the in-world GLB and retains its legacy preview
// JPG, while weaponIconUrl selects bespoke per-item WebP artwork.
describe('held weapon models', () => {
  it('every weapon variant has a model GLB and legacy preview JPG on disk', () => {
    const keys = [...new Set(Object.values(ITEM_WEAPON_VARIANTS))];
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) {
      expect(existsSync(`public/models/weapons/${key}.glb`), `${key}.glb missing`).toBe(true);
      expect(existsSync(`public/ui/weapons/${key}.jpg`), `${key}.jpg missing`).toBe(true);
    }
  });

  it('every live heroic weapon inherits its base painted icon and held model', () => {
    const heroicWeapons = Object.values(ITEMS)
      .filter((item) => item.kind === 'weapon' && item.heroicOf !== undefined)
      .sort((a, b) => a.id.localeCompare(b.id));

    expect(heroicWeapons.map((item) => item.id)).toEqual([
      'heroic_bonewrought_greatsword',
      'heroic_deathless_heartwood',
      'heroic_direfang_greatblade',
      'heroic_fang_of_korzul',
      'heroic_fanglords_beastspear',
      'heroic_gravewyrm_thornmaul',
      'heroic_kingsbane_last_oath',
      'heroic_maul_of_the_scourged_wilds',
      'heroic_nightfangs_greatstaff',
      'heroic_staff_of_the_gravewyrm',
      'heroic_staff_of_velkhar',
      'heroic_wildheart_fangknife',
      'heroic_wildheart_hexwood_staff',
      'heroic_wildheart_tuskblade',
      'heroic_wyrmfang_greatblade',
    ]);

    for (const heroic of heroicWeapons) {
      const baseId = heroic.heroicOf;
      expect(baseId, `${heroic.id} must name a base item`).toBeDefined();
      if (!baseId) continue;

      const base = ITEMS[baseId];
      expect(base?.kind, `${heroic.id} base ${baseId} must be a weapon`).toBe('weapon');
      expect(Object.hasOwn(ITEM_WEAPON_VARIANTS, heroic.id), heroic.id).toBe(false);
      expect(Object.hasOwn(ITEM_WEAPON_VARIANTS, baseId), baseId).toBe(true);

      const variant = ITEM_WEAPON_VARIANTS[baseId];
      expect(variant, `${baseId} must have a real variant`).toBeTruthy();
      if (!variant) continue;

      expect(existsSync(`public/models/weapons/${variant}.glb`), `${variant}.glb missing`).toBe(
        true,
      );
      expect(existsSync(`public/ui/weapons/${variant}.jpg`), `${variant}.jpg missing`).toBe(true);
      expect(iconDataUrl('item', heroic.id), `${heroic.id} bag icon`).toBe(
        `/ui/items/${baseId}.webp`,
      );
      expect(itemWeaponModelUrl(heroic.id), `${heroic.id} held model`).toBe(
        `models/weapons/${variant}.glb`,
      );
      expect(iconDataUrl('item', heroic.id), `${heroic.id} inventory portrait`).toBe(
        iconDataUrl('item', baseId),
      );
    }

    expect(weaponIconUrl('worn_sword')).toBe('/ui/items/worn_sword.webp');
    for (const hostile of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
      expect(weaponIconUrl(hostile), hostile).toBeNull();
      expect(itemWeaponModelUrl(hostile), `${hostile} mainhand`).toBeNull();
      expect(itemOffhandModelUrl(hostile), `${hostile} offhand`).toBeNull();
    }
    expect(weaponIconUrl('stale_server_weapon_id')).toBeNull();
    expect(itemWeaponModelUrl('stale_server_weapon_id')).toBeNull();
    expect(itemOffhandModelUrl('stale_server_weapon_id')).toBeNull();
  });

  it('prefers direct painted and held identities over heroic inheritance', () => {
    const heroicId = 'heroic_wyrmfang_greatblade';
    const heroic = ITEMS[heroicId];
    const originalBaseId = heroic.heroicOf;
    expect(originalBaseId).toBe('wyrmfang_greatblade');
    expect(Object.hasOwn(ITEM_WEAPON_VARIANTS, heroicId)).toBe(false);

    withTemporaryOwnProperty(heroic, 'heroicOf', 'worn_sword', () => {
      withTemporaryOwnProperty(ITEM_WEAPON_VARIANTS, heroicId, 'dagger_a', () => {
        expect(weaponIconUrl(heroicId)).toBe(`/ui/items/${heroicId}.webp`);
        expect(iconDataUrl('item', heroicId)).toBe(`/ui/items/${heroicId}.webp`);
        expect(itemWeaponModelUrl(heroicId)).toBe('models/weapons/dagger_a.glb');
        expect(itemOffhandModelUrl(heroicId)).toBe('models/weapons/dagger_a.glb');
      });
    });

    expect(heroic.heroicOf).toBe(originalBaseId);
    expect(Object.hasOwn(ITEM_WEAPON_VARIANTS, heroicId)).toBe(false);
  });

  it('rejects prototype keys inherited through heroicOf for bag and held art', () => {
    const heroicId = 'heroic_wyrmfang_greatblade';
    const heroic = ITEMS[heroicId];
    const originalBaseId = heroic.heroicOf;
    expect(Object.hasOwn(ITEM_WEAPON_VARIANTS, heroicId)).toBe(false);

    for (const hostileBaseId of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
      withTemporaryOwnProperty(heroic, 'heroicOf', hostileBaseId, () => {
        expect(weaponIconUrl(heroicId), `${hostileBaseId} bag`).toBeNull();
        expect(itemWeaponModelUrl(heroicId), `${hostileBaseId} mainhand`).toBeNull();
        expect(itemOffhandModelUrl(heroicId), `${hostileBaseId} offhand`).toBeNull();
      });
    }

    expect(heroic.heroicOf).toBe(originalBaseId);
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

  // COVERAGE: every equippable weapon must map to a held model. An unmapped item
  // falls back asymmetrically in assets.ts: swapAttachDef keeps the class DEFAULT
  // mainhand model (renders the wrong weapon) while offhandAttachDef returns null
  // and attachAllProps silently skips the hand (renders nothing), so dual-wielding
  // two copies of an unmapped one-hander showed only the mainhand.
  it('every weapon item resolves a mainhand held model', () => {
    const weapons = Object.values(ITEMS).filter((item) => item.kind === 'weapon');
    expect(weapons.length).toBeGreaterThan(0);
    const unmapped = weapons.filter((item) => itemWeaponModelUrl(item.id) === null);
    expect(unmapped.map((item) => item.id)).toEqual([]);
  });

  // Anything that can sit in the offhand slot (a one-hander for a dual wielder, a
  // fury two-hander, a shield) must resolve there too, or the hand renders empty.
  // The held_offhand kind (caster orbs/tomes) is swept by the pin test below.
  it('every offhand-capable weapon and shield resolves an offhand held model', () => {
    const offhandCapable = Object.values(ITEMS).filter(
      (item) =>
        (item.kind === 'weapon' && weaponHand(item) !== 'mainhand') ||
        (item.kind === 'armor' && item.slot === 'offhand' && item.shield === true),
    );
    expect(offhandCapable.length).toBeGreaterThan(0);
    const unmapped = offhandCapable.filter((item) => itemOffhandModelUrl(item.id) === null);
    expect(unmapped.map((item) => item.id)).toEqual([]);
  });

  // The orbs, the lantern and the quivers (each with its generated heroic clone
  // where the source is heroic-eligible) are the known held model gaps: the
  // shared art set has no orb, lantern or quiver model to map them to, so they
  // need new art, not a table row. The quivers are a softer gap than the orbs:
  // the hunter's ranger.glb already carries a built-in quiver mesh, so an
  // unmapped quiver reads correctly on the body instead of showing nothing.
  // Pinning the exact set makes the exception conscious: a future held_offhand
  // item must either map to a model or extend this pin.
  it('pins the held_offhand items without a model (orbs, lantern and quivers)', () => {
    const heldOffhands = Object.values(ITEMS).filter((item) => item.kind === 'held_offhand');
    const unmapped = heldOffhands
      .filter((item) => itemOffhandModelUrl(item.id) === null)
      .map((item) => item.id)
      .sort();
    expect(unmapped).toEqual([
      'cragmaw_huntquiver',
      'direfang_quiver',
      'gravewyrm_bone_quiver',
      'heroic_direfang_quiver',
      'heroic_gravewyrm_bone_quiver',
      'heroic_wraithfire_orb',
      'moggers_hide_quiver',
      'valefire_lantern',
      'wraithfire_orb',
    ]);
  });

  it('resolves actual offhands independently from the mainhand model', () => {
    expect(itemOffhandModelUrl('eastbrook_buckler')).toBe('models/weapons/shield_round.glb');
    expect(itemOffhandModelUrl('highwatch_wallshield')).toBe('models/weapons/shield_square.glb');
    expect(itemOffhandModelUrl('rusty_dagger')).toBe('models/weapons/dagger_a.glb');
    expect(itemOffhandModelUrl('heroic_fang_of_korzul')).toBe('models/weapons/dagger_c.glb');
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
      // both hunter bodies: the fixed rig and its composed (modular) variant
      // share the class hand layout, so both keep the crossbow
      if (key === 'player_hunter' || key === 'player_hunter_modular') {
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

  // The offhand slot mirrors the active skin ONLY onto a matching-type weapon;
  // everything else keeps its own item model. This is the render half of
  // the pure offhandMirrorsWeaponSkin rule (its full truth table is in
  // tests/weapon_skins.test.ts).
  it('offhandModelUrl mirrors the skin onto a matching-type offhand weapon', () => {
    // Dagger skin + offhand dagger: the offhand renders the SKIN model.
    expect(offhandModelUrl('rusty_dagger', 'frostbite_dagger')).toBe(
      weaponSkinModelUrl('frostbite_dagger'),
    );
    expect(offhandModelUrl('heroic_fang_of_korzul', 'ashspark_dagger')).toBe(
      weaponSkinModelUrl('ashspark_dagger'),
    );
    // Sword skin + offhand one-hand sword: also mirrors.
    expect(offhandModelUrl('crossroads_saber', 'ice_fang_sword')).toBe(
      weaponSkinModelUrl('ice_fang_sword'),
    );
  });

  it('offhandModelUrl keeps the item model for a non-matching offhand', () => {
    // Different-type weapon, shield, and held offhand all fall back to the item.
    expect(offhandModelUrl('crossroads_saber', 'frostbite_dagger')).toBe(
      itemOffhandModelUrl('crossroads_saber'),
    );
    expect(offhandModelUrl('eastbrook_buckler', 'frostbite_dagger')).toBe(
      itemOffhandModelUrl('eastbrook_buckler'),
    );
    // No skin at all: unchanged item resolution (the common case).
    expect(offhandModelUrl('rusty_dagger', null)).toBe(itemOffhandModelUrl('rusty_dagger'));
    expect(offhandModelUrl('eastbrook_buckler', null)).toBe(
      itemOffhandModelUrl('eastbrook_buckler'),
    );
    expect(offhandModelUrl(null, 'frostbite_dagger')).toBeNull();
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
