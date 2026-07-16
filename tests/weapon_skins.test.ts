import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { WEAPON_VFX } from '../src/render/weapon_vfx';
import {
  eligibleClassesForWeaponSkinType,
  resolveActiveWeaponSkin,
  skinnableWeaponTypesFor,
  WEAPON_TYPE_BY_ITEM,
  weaponSkinTypeMatches,
  weaponTypeForItem,
} from '../src/sim/content/weapon_skin_rules';
import {
  WEAPON_SKIN_COLLECTIONS,
  WEAPON_SKIN_LIST,
  WEAPON_SKINS,
} from '../src/sim/content/weapon_skins';
import { ITEMS } from '../src/sim/data';
import { armoryCollectionStrings, armorySkinStrings } from '../src/ui/i18n.catalog/armory';
import { ITEM_WEAPON_VARIANTS } from '../src/ui/weapon_variants';
import { armorySkinArt } from '../src/ui/woc_store_view';

const ROOT = join(__dirname, '..');

describe('season 1 weapon skin catalog', () => {
  it('ships exactly the 29 paid skins: 7 per collection plus the Fallen Star encore', () => {
    expect(WEAPON_SKIN_LIST.length).toBe(29);
    for (const collection of WEAPON_SKIN_COLLECTIONS) {
      const inCollection = WEAPON_SKIN_LIST.filter((s) => s.collection === collection);
      expect(inCollection.length, collection).toBe(collection === 'fallen_star' ? 8 : 7);
      // One skin per weapon type within a collection.
      expect(new Set(inCollection.map((s) => s.weaponType)).size).toBe(inCollection.length);
    }
  });

  it('keeps product pricing out of the game catalog', () => {
    for (const [key, skin] of Object.entries(WEAPON_SKINS)) {
      expect(skin.id).toBe(key);
      expect(skin).not.toHaveProperty('priceUsd');
      expect(skin).not.toHaveProperty('name');
      expect(skin).not.toHaveProperty('look');
      expect(skin).not.toHaveProperty('lore');
      expect(skin.season).toBe(1);
    }
  });

  it('every skin model ships a GLB and a bag icon', () => {
    for (const skin of WEAPON_SKIN_LIST) {
      expect(existsSync(join(ROOT, `public/models/weapons/${skin.model}.glb`)), skin.model).toBe(
        true,
      );
      expect(existsSync(join(ROOT, `public/ui/weapons/${skin.model}.jpg`)), skin.model).toBe(true);
    }
  });

  it('every skin ships its rarity-themed store thumbnail (scripts/armory_thumbs.mjs)', () => {
    for (const skin of WEAPON_SKIN_LIST) {
      expect(existsSync(join(ROOT, `public/ui/store/armory/${skin.id}.webp`)), skin.id).toBe(true);
      // The store card art url stays in lockstep with the shipped file.
      expect(armorySkinArt(skin.id)).toBe(`/ui/store/armory/${skin.id}.webp`);
    }
  });

  it('rare and above carry a VFX spec of the matching tier; uncommon has none', () => {
    for (const skin of WEAPON_SKIN_LIST) {
      const spec = WEAPON_VFX[skin.model];
      if (skin.rarity === 'uncommon') {
        expect(spec, skin.id).toBeUndefined();
      } else {
        expect(spec, skin.id).toBeDefined();
        expect(spec?.tier, skin.id).toBe(skin.rarity);
      }
    }
  });

  it('flagship and hero badges sit where the sheet says', () => {
    expect(WEAPON_SKINS.ice_fang_sword?.badge).toBe('flagship');
    expect(WEAPON_SKINS.solheim_sword?.badge).toBe('hero');
    expect(WEAPON_SKIN_LIST.filter((s) => s.badge).length).toBe(2);
  });

  it('copy is free of em and en dashes (repo rule)', () => {
    // Unicode escapes, not literal dashes: the pre-push copy scan reads this
    // file too.
    for (const copy of [
      ...Object.values(armoryCollectionStrings),
      ...Object.values(armorySkinStrings).flatMap((skin) => [skin.name, skin.look, skin.lore]),
    ]) {
      for (const text of [copy]) {
        expect(text.includes('\u2014'), `${text.slice(0, 32)} em dash`).toBe(false);
        expect(text.includes('\u2013'), `${text.slice(0, 32)} en dash`).toBe(false);
      }
    }
  });
});

describe('weapon type classification', () => {
  const weaponIds = Object.entries(ITEMS)
    .filter(([, def]) => def.kind === 'weapon')
    .map(([id]) => id);

  it('classifies every weapon item in the merged ITEMS table', () => {
    const missing = weaponIds.filter((id) => weaponTypeForItem(id) === null);
    expect(missing).toEqual([]);
  });

  it('has no orphan rows for items that do not exist', () => {
    const orphans = Object.keys(WEAPON_TYPE_BY_ITEM).filter((id) => !ITEMS[id]);
    expect(orphans).toEqual([]);
  });

  it('stays in lockstep with the render variant family for mapped items', () => {
    const familyOf = (variant: string): string | null => {
      if (/^(adv_)?sword/.test(variant)) return 'sword';
      if (/^(adv_)?dagger/.test(variant)) return 'dagger';
      if (/^(adv_)?(druid_)?staff|^adv_druid_staff/.test(variant)) return 'staff';
      if (/^hammer/.test(variant)) return 'mace';
      if (/^(adv_)?axe/.test(variant)) return 'axe';
      if (/^(adv_)?wand/.test(variant)) return 'wand';
      if (/^spear|^scythe/.test(variant)) return 'polearm';
      return null;
    };
    for (const id of weaponIds) {
      const variant = ITEM_WEAPON_VARIANTS[id];
      if (!variant) continue;
      const family = familyOf(variant);
      expect(family, `${id} variant ${variant} has no family`).not.toBeNull();
      expect(weaponTypeForItem(id), `${id} (${variant})`).toBe(family);
    }
  });

  it('every dagger-flagged weapon classifies as dagger', () => {
    for (const id of weaponIds) {
      const def = ITEMS[id];
      if (def.kind === 'weapon' && def.weapon.dagger) {
        expect(weaponTypeForItem(id), id).toBe('dagger');
      }
    }
  });

  it('heroic variants resolve through their base row', () => {
    expect(weaponTypeForItem('heroic_moggers_shiv')).toBe('dagger');
    expect(weaponTypeForItem('heroic_brutoks_maul')).toBe('mace');
  });
});

describe('skin apply rule', () => {
  it('requires an equipped mainhand weapon', () => {
    expect(skinnableWeaponTypesFor('warrior', null)).toEqual([]);
    expect(skinnableWeaponTypesFor('hunter', null)).toEqual([]);
  });

  it('matches the equipped item type for weapon-swapping classes', () => {
    expect(skinnableWeaponTypesFor('warrior', 'worn_sword')).toEqual(['sword']);
    expect(skinnableWeaponTypesFor('rogue', 'rusty_dagger')).toEqual(['dagger']);
    expect(weaponSkinTypeMatches('mage', 'gnarled_staff', 'staff')).toBe(true);
    expect(weaponSkinTypeMatches('warrior', 'worn_sword', 'axe')).toBe(false);
  });

  it('lets hunters use bow and crossbow skins (class-fixed ranged visual)', () => {
    expect(skinnableWeaponTypesFor('hunter', 'rusty_hatchet').sort()).toEqual(['bow', 'crossbow']);
  });

  it('offers nothing for polearms', () => {
    expect(skinnableWeaponTypesFor('warrior', 'tidereaver_gaff')).toEqual([]);
  });

  it('every paid skin type is reachable by some class and item', () => {
    const reachable = new Set<string>();
    for (const id of Object.keys(WEAPON_TYPE_BY_ITEM)) {
      for (const t of skinnableWeaponTypesFor('warrior', id)) reachable.add(t);
    }
    for (const t of skinnableWeaponTypesFor('hunter', 'worn_sword')) reachable.add(t);
    for (const skin of WEAPON_SKIN_LIST) {
      expect(reachable.has(skin.weaponType), `${skin.id} (${skin.weaponType})`).toBe(true);
    }
  });
});

describe('bow skin attack animation (hunter draw instead of crossbow aim)', () => {
  it('starts every typed player ranged shot at launch and suppresses its impact replay', async () => {
    const { playerRangedAttackAlreadyStarted, playerRangedAttackStartsAtLaunch } = await import(
      '../src/render/characters/skin_attack'
    );
    expect(playerRangedAttackStartsAtLaunch('player', 'ranged-shot')).toBe(true);
    expect(playerRangedAttackStartsAtLaunch('player', undefined)).toBe(false);
    expect(playerRangedAttackStartsAtLaunch('mob', 'ranged-shot')).toBe(false);
    expect(playerRangedAttackAlreadyStarted('player', true)).toBe(true);
    expect(playerRangedAttackAlreadyStarted('player', undefined)).toBe(false);
    expect(playerRangedAttackAlreadyStarted('mob', true)).toBe(false);
  });

  it('bow skins substitute the authored draw clip; every other type keeps its attack', async () => {
    const { weaponSkinAttackClips, SKIN_ATTACK_CLIP_NAMES } = await import(
      '../src/render/characters/skin_attack'
    );
    const { weaponSkinHandling } = await import('../src/render/characters/skin_attack');
    for (const skin of WEAPON_SKIN_LIST) {
      const sub = weaponSkinAttackClips(skin.id);
      if (weaponSkinHandling(skin) === 'bow') {
        expect(sub?.clips, skin.id).toContain('Bow_Draw_Shot');
        // This is a renderer-only substitution: it must not alter sim timing.
        expect(sub).not.toHaveProperty('releaseAt');
        // Every substitute clip must be one the constructor binds.
        for (const clip of sub?.clips ?? []) expect(SKIN_ATTACK_CLIP_NAMES).toContain(clip);
      } else {
        expect(sub, `${skin.id} (${skin.weaponType}) must keep the authored attack`).toBeNull();
      }
    }
    // The encore star-cannon is a bow-slot skin HANDLED like a crossbow: it
    // keeps the shoulder-aim and the right hand.
    expect(weaponSkinHandling(WEAPON_SKINS.encore_bow)).toBe('crossbow');
    expect(weaponSkinAttackClips('encore_bow')).toBeNull();
    expect(weaponSkinAttackClips(null)).toBeNull();
    expect(weaponSkinAttackClips('not_a_skin')).toBeNull();
  });

  it('bow handling sits in the LEFT hand (the draw front arm); crossbow handling stays right', async () => {
    const { weaponSkinAttachBone, weaponSkinHandling } = await import(
      '../src/render/characters/skin_attack'
    );
    expect(weaponSkinAttachBone('bow', 'handslot.r')).toBe('handslot.l');
    expect(weaponSkinAttachBone('crossbow', 'handslot.r')).toBe('handslot.r');
    // Slot vs handling: winterbite draws left-handed, the encore cannon
    // shoulders right-handed, both from the bow store slot.
    expect(weaponSkinAttachBone(weaponSkinHandling(WEAPON_SKINS.winterbite), 'handslot.r')).toBe(
      'handslot.l',
    );
    expect(weaponSkinAttachBone(weaponSkinHandling(WEAPON_SKINS.encore_bow), 'handslot.r')).toBe(
      'handslot.r',
    );
  });

  it('orientation pins: bows aim during the shot, bow-slot guns carry outside it', async () => {
    const { weaponSkinOrientPin } = await import('../src/render/characters/skin_attack');
    expect(weaponSkinOrientPin('winterbite')).toBe('aimDuringShot');
    expect(weaponSkinOrientPin('fletcher_s_guild_bow')).toBe('aimDuringShot');
    expect(weaponSkinOrientPin('encore_bow')).toBe('carryOutsideShot');
    expect(weaponSkinOrientPin('meteorlatch_crossbow')).toBeNull();
    expect(weaponSkinOrientPin('solheim_sword')).toBeNull();
    expect(weaponSkinOrientPin(null)).toBeNull();
  });

  it('the hunter ships the bow clip via animUrls and the GLB carries it', async () => {
    // Source scan, not an import: pulling the manifest into Node would kick
    // the module-import GLB preloads (assets.ts loading contract).
    const manifestSrc = readFileSync(join(ROOT, 'src/render/characters/manifest.ts'), 'utf8');
    const hunterBlock = manifestSrc.slice(
      manifestSrc.indexOf('player_hunter: {'),
      manifestSrc.indexOf('player_rogue: {'),
    );
    expect(hunterBlock).toContain('bow_anims.glb');
    // Parse the shipped GLB's JSON chunk and assert the clips are inside
    // (scripts/build_bow_anims.mjs output; regenerate from the CC0 pack).
    const glb = readFileSync(join(ROOT, 'public/models/chars/players/bow_anims.glb'));
    const jsonLen = glb.readUInt32LE(12);
    const doc = JSON.parse(glb.subarray(20, 20 + jsonLen).toString('utf8'));
    const clips = (doc.animations ?? []).map((a: { name?: string }) => a.name);
    expect(clips).toContain('Bow_Draw_Shot');
    // Mesh-free clip donor: nothing to render, just bones + tracks.
    expect(doc.meshes ?? []).toEqual([]);
    // The authored animation can carry a release pose without changing the
    // server-authoritative Auto Shot timeline.
    const script = readFileSync(join(ROOT, 'scripts/build_bow_anims.mjs'), 'utf8');
    const m = script.match(/BOW_RELEASE_AT = ([0-9.]+)/);
    expect(m, 'build_bow_anims.mjs must declare BOW_RELEASE_AT').toBeTruthy();
    expect(Number(m?.[1])).toBeGreaterThan(0);
  });

  it('uses typed launch correlation instead of a gameplay-system label dependency', () => {
    const renderer = readFileSync(join(ROOT, 'src/render/renderer.ts'), 'utf8');
    const launch = renderer.slice(
      renderer.indexOf("case 'spellfx':"),
      renderer.indexOf("case 'spellfxAt':"),
    );
    const damage = renderer.slice(
      renderer.indexOf("case 'damage':"),
      renderer.indexOf("case 'heal2':"),
    );
    expect(renderer).not.toContain("from '../sim/combat/auto_attack'");
    expect(launch).toContain("ev.attackAnimation === 'ranged-shot'");
    expect(damage).toContain('playerRangedAttackAlreadyStarted(');
    expect(damage).toContain('ev.attackAnimationStarted,');
    expect(launch).not.toContain('weaponSkinAttackClips(source.weaponSkinId)');
    expect(damage).not.toContain('weaponSkinAttackClips(source.weaponSkinId)');
  });
});

describe('grip override wiring (editor saves reach the game)', () => {
  it('the render attach path consumes WEAPON_GRIP_OVERRIDES via variantGripTransform', () => {
    // Round-1 port regression guard: weapon_grip.ts (the registry the
    // inspector's grip Save writes) was once dead code because assets.ts kept
    // its own bare lift/flip/clamp. The attach path must compose the per-weapon
    // override through the same pure transform the inspector previews.
    const src = readFileSync(join(ROOT, 'src/render/characters/assets.ts'), 'utf8');
    expect(src).toContain("from './weapon_grip'");
    expect(src).toContain('variantGripTransform(');
    expect(src).toContain('WEAPON_GRIP_OVERRIDES[');
  });

  it('variantGripTransform composes a saved override onto the bare grip', async () => {
    const { variantGripTransform, WEAPON_GRIP_OVERRIDES } = await import(
      '../src/render/characters/weapon_grip'
    );
    const bare = variantGripTransform(1.2, false, 0.05, 1.6, undefined);
    expect(bare.position).toEqual([0, 0.05, 0]);
    expect(bare.quaternion).toEqual([0, 1, 0, 0]);
    expect(bare.scale).toBe(1);
    const row = WEAPON_GRIP_OVERRIDES.solheim_last_light_of_the_dawn;
    expect(row).toBeTruthy();
    const tuned = variantGripTransform(1.2, false, 0.05, 1.6, row);
    expect(tuned.scale).toBeCloseTo((row?.scale ?? 1) * 1, 5);
    expect(tuned.position[0]).toBeCloseTo(row?.pos?.[0] ?? 0, 5);
    expect(tuned.position[1]).toBeCloseTo(0.05 + (row?.pos?.[1] ?? 0), 5);
    expect(tuned.quaternion).not.toEqual(bare.quaternion);
  });
});

describe('eligible classes per skin type (store card chips)', () => {
  it('bow and crossbow are hunter-only (class-fixed ranged visual)', () => {
    expect(eligibleClassesForWeaponSkinType('bow')).toEqual(['hunter']);
    expect(eligibleClassesForWeaponSkinType('crossbow')).toEqual(['hunter']);
  });

  it('hunters are never eligible for a non-ranged type (mainhand never displays)', () => {
    for (const skin of WEAPON_SKIN_LIST) {
      if (skin.weaponType === 'bow' || skin.weaponType === 'crossbow') continue;
      expect(
        eligibleClassesForWeaponSkinType(skin.weaponType),
        `${skin.weaponType} must not list hunter`,
      ).not.toContain('hunter');
    }
  });

  it('every paid skin type has at least one eligible class', () => {
    for (const skin of WEAPON_SKIN_LIST) {
      expect(
        eligibleClassesForWeaponSkinType(skin.weaponType).length,
        `${skin.id} (${skin.weaponType})`,
      ).toBeGreaterThan(0);
    }
  });

  it('proficiency groups decide the chips (spot checks against the item data)', () => {
    expect(eligibleClassesForWeaponSkinType('sword')).toContain('warrior');
    expect(eligibleClassesForWeaponSkinType('dagger')).toContain('rogue');
    expect(eligibleClassesForWeaponSkinType('staff')).toContain('mage');
    expect(eligibleClassesForWeaponSkinType('wand')).toContain('mage');
    expect(eligibleClassesForWeaponSkinType('mace')).toContain('paladin');
  });

  it('memoizes per type (static content)', () => {
    expect(eligibleClassesForWeaponSkinType('sword')).toBe(
      eligibleClassesForWeaponSkinType('sword'),
    );
  });
});

describe('active skin resolution', () => {
  it('skips a stale loadout entry whose skin no longer targets that type', () => {
    // An axe skin stranded under the sword key (a hand-edited save or a
    // catalog re-type) must never render on a sword.
    expect(
      resolveActiveWeaponSkin('warrior', 'worn_sword', { sword: 'glaciersplit_axe' }),
    ).toBeNull();
  });

  it('resolves null for a missing loadout or no equipped mainhand', () => {
    expect(resolveActiveWeaponSkin('warrior', 'worn_sword', null)).toBeNull();
    expect(resolveActiveWeaponSkin('warrior', 'worn_sword', undefined)).toBeNull();
    expect(resolveActiveWeaponSkin('warrior', null, { sword: 'ice_fang_sword' })).toBeNull();
  });

  it('prefers the crossbow skin over the bow skin for hunters (native visual)', () => {
    expect(
      resolveActiveWeaponSkin('hunter', 'rusty_hatchet', {
        bow: 'winterbite',
        crossbow: 'cinderlatch_crossbow',
      }),
    ).toBe('cinderlatch_crossbow');
    expect(resolveActiveWeaponSkin('hunter', 'rusty_hatchet', { bow: 'winterbite' })).toBe(
      'winterbite',
    );
  });
});

// The render registries are parsed as source text (the same pattern
// tests/asset_pipeline.test.ts uses): entries are 2-space-indented bare keys,
// so comment lines and nested props never count as entries.
describe('render registry integrity', () => {
  function registryKeys(file: string, anchor: string): string[] {
    const src = readFileSync(join(ROOT, file), 'utf8');
    const start = src.indexOf(anchor);
    expect(start, `${anchor} in ${file}`).toBeGreaterThanOrEqual(0);
    const end = src.indexOf('\n};', start);
    expect(end, `${anchor} block end`).toBeGreaterThan(start);
    return [...src.slice(start, end).matchAll(/^ {2}([a-z0-9_]+):/gm)].map((m) => m[1]);
  }

  it('every skin model has a KAYKIT_WEAPON_ACCESSORY grip family', () => {
    // Without a grip family the model attaches at the bone origin untransformed.
    const gripped = new Set(
      registryKeys('src/render/characters/assets.ts', 'const KAYKIT_WEAPON_ACCESSORY'),
    );
    expect(gripped.size).toBeGreaterThan(30);
    for (const skin of WEAPON_SKIN_LIST) {
      expect(gripped.has(skin.model), `${skin.id} model ${skin.model} has no grip family`).toBe(
        true,
      );
    }
  });

  it('WEAPON_GRIP_OVERRIDES carries no orphan keys', () => {
    // Every per-weapon fine-tune key must name a real held model: a Season 1
    // skin model, a legacy per-item variant, or a shipped GLB. A typo or a
    // removed model would otherwise leave a silent dead override.
    const keys = registryKeys(
      'src/render/characters/weapon_grip.ts',
      'export const WEAPON_GRIP_OVERRIDES',
    );
    expect(keys.length).toBeGreaterThan(0);
    const skinModels = new Set(WEAPON_SKIN_LIST.map((s) => s.model));
    const legacyVariants = new Set(Object.values(ITEM_WEAPON_VARIANTS));
    for (const key of keys) {
      const known =
        skinModels.has(key) ||
        legacyVariants.has(key) ||
        existsSync(join(ROOT, `public/models/weapons/${key}.glb`));
      expect(
        known,
        `WEAPON_GRIP_OVERRIDES.${key} matches no skin model, item variant, or shipped GLB`,
      ).toBe(true);
    }
  });
});
