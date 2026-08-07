import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { WEAPON_VFX } from '../src/render/weapon_vfx';
import {
  eligibleClassesForWeaponSkinType,
  offhandMirrorsWeaponSkin,
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

  it('every dagger-classified weapon carries the dagger gameplay flag', () => {
    // The reverse of the check above: an item skinned as a dagger must also set
    // weapon.dagger, the flag Backstab/Ambush (weaponStrike + requiresBehind) gate
    // on in casting_lifecycle. Without it the item renders as a dagger but the
    // positional rogue abilities reject it with "You must wield a dagger." This
    // pins that the two dagger notions never drift apart (regression: mistcallers_fang).
    for (const id of weaponIds) {
      if (weaponTypeForItem(id) !== 'dagger') continue;
      const def = ITEMS[id];
      expect(def.kind === 'weapon' && def.weapon.dagger === true, id).toBe(true);
    }
  });

  it('heroic variants resolve through their base row', () => {
    expect(weaponTypeForItem('heroic_fang_of_korzul')).toBe('dagger');
    expect(weaponTypeForItem('heroic_staff_of_velkhar')).toBe('staff');
  });
});

describe('skin apply rule', () => {
  it('requires an equipped mainhand weapon', () => {
    expect(skinnableWeaponTypesFor('warrior', null, 'class')).toEqual([]);
    expect(skinnableWeaponTypesFor('hunter', null, 'class')).toEqual([]);
    expect(skinnableWeaponTypesFor('hunter', null, 'mech')).toEqual([]);
  });

  it('matches the equipped item type for weapon-swapping classes', () => {
    expect(skinnableWeaponTypesFor('warrior', 'worn_sword', 'class')).toEqual(['sword']);
    expect(skinnableWeaponTypesFor('rogue', 'rusty_dagger', 'class')).toEqual(['dagger']);
    expect(weaponSkinTypeMatches('mage', 'gnarled_staff', 'staff', 'class')).toBe(true);
    expect(weaponSkinTypeMatches('warrior', 'worn_sword', 'axe', 'class')).toBe(false);
  });

  it('lets hunters use bow and crossbow skins (class-fixed ranged visual)', () => {
    expect(skinnableWeaponTypesFor('hunter', 'rusty_hatchet', 'class').sort()).toEqual([
      'bow',
      'crossbow',
    ]);
  });

  it('the mech body ALSO lets a hunter skin the weapon it really shows', () => {
    // The hunter rig displays a fixed crossbow and never the equipped item, so
    // a melee skin there would be invisible. The mech swaps in the mainhand, so
    // the held weapon's own type joins the list.
    expect(skinnableWeaponTypesFor('hunter', 'direfang_greatblade', 'mech')).toEqual([
      'crossbow',
      'bow',
      'sword',
    ]);
    expect(weaponSkinTypeMatches('hunter', 'direfang_greatblade', 'sword', 'mech')).toBe(true);
    // ...and NOT on the class rig, where it could never render.
    expect(weaponSkinTypeMatches('hunter', 'direfang_greatblade', 'sword', 'class')).toBe(false);
    // Ranged stays FIRST, so a hunter who already had a bow skin keeps that
    // look when they put the suit on.
    expect(skinnableWeaponTypesFor('hunter', 'direfang_greatblade', 'mech')[0]).toBe('crossbow');
    // A type no skin targets adds nothing, mech or not: spears stay bare.
    expect(skinnableWeaponTypesFor('hunter', 'ironbark_boar_spear', 'mech')).toEqual([
      'crossbow',
      'bow',
    ]);
    // Every other class is unaffected by the body it wears.
    expect(skinnableWeaponTypesFor('warrior', 'worn_sword', 'mech')).toEqual(['sword']);
    expect(skinnableWeaponTypesFor('rogue', 'rusty_dagger', 'mech')).toEqual(['dagger']);
  });

  it('offers nothing for polearms', () => {
    expect(skinnableWeaponTypesFor('warrior', 'tidereaver_gaff', 'class')).toEqual([]);
    expect(skinnableWeaponTypesFor('warrior', 'tidereaver_gaff', 'mech')).toEqual([]);
  });

  it('every paid skin type is reachable by some class and item', () => {
    const reachable = new Set<string>();
    for (const id of Object.keys(WEAPON_TYPE_BY_ITEM)) {
      for (const t of skinnableWeaponTypesFor('warrior', id, 'class')) reachable.add(t);
    }
    for (const t of skinnableWeaponTypesFor('hunter', 'worn_sword', 'class')) reachable.add(t);
    for (const skin of WEAPON_SKIN_LIST) {
      expect(reachable.has(skin.weaponType), `${skin.id} (${skin.weaponType})`).toBe(true);
    }
  });
});

describe('offhand weapon-skin mirror rule', () => {
  it('mirrors the skin onto a matching-type offhand weapon (rogue dual-wield)', () => {
    // A rogue with two daggers and a dagger skin shows both blades skinned.
    expect(offhandMirrorsWeaponSkin('frostbite_dagger', 'rusty_dagger')).toBe(true);
    expect(offhandMirrorsWeaponSkin('ashspark_dagger', 'keen_dirk')).toBe(true);
    expect(offhandMirrorsWeaponSkin('ice_fang_sword', 'crossroads_saber')).toBe(true);
  });

  it('mirrors onto a matching-type TWO-HAND offhand weapon (Fury dual-wield pair)', () => {
    // Hand is deliberately not consulted: equipment_rules.canDualWieldTwoHand lets
    // a Fury warrior offhand a two-hander, and the mainhand rule already skins a
    // matching-type two-hander (greatswords classify as 'sword'), so the mirror
    // must treat the offhand the same way or a Fury pair would render a skinned
    // mainhand next to a bare offhand greatsword: the asymmetry this rule removes.
    expect(WEAPON_TYPE_BY_ITEM.eastbrook_greatsword).toBe('sword');
    expect(
      resolveActiveWeaponSkin(
        'warrior',
        'eastbrook_greatsword',
        { sword: 'ice_fang_sword' },
        'class',
      ),
    ).toBe('ice_fang_sword');
    expect(offhandMirrorsWeaponSkin('ice_fang_sword', 'eastbrook_greatsword')).toBe(true);
    // A different-type two-hander stays bare, same as the one-hand arm.
    expect(offhandMirrorsWeaponSkin('frostbite_dagger', 'eastbrook_greatsword')).toBe(false);
  });

  it('leaves a different-type offhand weapon untouched', () => {
    expect(offhandMirrorsWeaponSkin('frostbite_dagger', 'crossroads_saber')).toBe(false);
    expect(offhandMirrorsWeaponSkin('ice_fang_sword', 'rusty_dagger')).toBe(false);
  });

  it('never mirrors onto a shield (armor, no weapon type)', () => {
    expect(offhandMirrorsWeaponSkin('ice_fang_sword', 'eastbrook_buckler')).toBe(false);
    expect(offhandMirrorsWeaponSkin('frostbite_dagger', 'highwatch_wallshield')).toBe(false);
  });

  it('never mirrors onto a held offhand (orb/tome, no weapon type)', () => {
    expect(offhandMirrorsWeaponSkin('ice_fang_sword', 'wraithfire_orb')).toBe(false);
  });

  it('resolves a heroic-prefixed offhand item to its base weapon type', () => {
    expect(offhandMirrorsWeaponSkin('frostbite_dagger', 'heroic_fang_of_korzul')).toBe(true);
    expect(offhandMirrorsWeaponSkin('ice_fang_sword', 'heroic_fang_of_korzul')).toBe(false);
  });

  it('returns false for an unknown or absent skin, or an empty offhand', () => {
    expect(offhandMirrorsWeaponSkin('not_a_skin', 'rusty_dagger')).toBe(false);
    expect(offhandMirrorsWeaponSkin(null, 'rusty_dagger')).toBe(false);
    expect(offhandMirrorsWeaponSkin(undefined, 'rusty_dagger')).toBe(false);
    expect(offhandMirrorsWeaponSkin('frostbite_dagger', null)).toBe(false);
    expect(offhandMirrorsWeaponSkin('frostbite_dagger', undefined)).toBe(false);
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
      const handling = weaponSkinHandling(skin);
      if (handling === 'bow') {
        expect(sub?.clips, skin.id).toContain('Bow_Draw_Shot');
        // This is a renderer-only substitution: it must not alter sim timing.
        expect(sub).not.toHaveProperty('releaseAt');
      } else if (handling === 'crossbow') {
        // Named, not inherited: the mech authors a melee chop, so a crossbow
        // skin has to ask for the shoulder-aim by name to shoulder it there.
        expect(sub?.clips, skin.id).toEqual(['2H_Ranged_Shoot']);
        // On the hunter this IS the authored attack, so re-timing it would
        // change the shot speed of a rig that was already correct.
        expect(sub?.timeScale, skin.id).toBeUndefined();
      } else {
        expect(sub, `${skin.id} (${skin.weaponType}) must keep the authored attack`).toBeNull();
      }
      // Every substitute clip must be one the constructor binds.
      for (const clip of sub?.clips ?? []) expect(SKIN_ATTACK_CLIP_NAMES).toContain(clip);
    }
    // The encore star-cannon is a bow-slot skin HANDLED like a crossbow: it
    // keeps the shoulder-aim and the right hand.
    expect(weaponSkinHandling(WEAPON_SKINS.encore_bow)).toBe('crossbow');
    expect(weaponSkinAttackClips('encore_bow')?.clips).toEqual(['2H_Ranged_Shoot']);
    // Melee skins never substitute: a sword swings whatever the rig authors.
    expect(weaponSkinAttackClips('solheim_sword')).toBeNull();
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

  it('the aim pin tracks SHOOTING, not merely "some one-shot is playing"', async () => {
    const { rangedSkinAiming } = await import('../src/render/characters/skin_attack');
    // The release: the attack one-shot is the moment the pin was written for.
    expect(rangedSkinAiming('attack', null)).toBe(true);
    // The DRAW: a cast-time shot (Long Draw, castTime 3.0) is a held base
    // state, not a one-shot, so the old "is a one-shot playing" test missed
    // the whole three seconds the bow should have been up.
    expect(rangedSkinAiming(null, 'aimed_shot')).toBe(true);
    // ...but only for a SHOT. Reported by review on PR 2941: a hunter's pet
    // utility casts also set the cast state, and holding a bow aimed through a
    // six-second beast taming is wrong.
    expect(rangedSkinAiming(null, 'tame_beast')).toBe(false);
    expect(rangedSkinAiming(null, 'revive_pet')).toBe(false);
    // Taking a hit plays a one-shot and is NOT shooting. This is the case
    // that made a bow jerk upright through the flinch.
    expect(rangedSkinAiming('other', null)).toBe(false);
    // Emotes were already excluded and stay excluded.
    expect(rangedSkinAiming('emote', null)).toBe(false);
    // Idle, doing nothing at all.
    expect(rangedSkinAiming(null, null)).toBe(false);
    // A one-shot that is not the attack wins over a concurrent cast flag:
    // whatever interrupted the draw is what the body is actually playing.
    expect(rangedSkinAiming('other', 'aimed_shot')).toBe(false);
    // ...and the attack one-shot during a cast stays aimed (the release frame
    // of a channelled shot, where both are briefly true).
    expect(rangedSkinAiming('attack', 'aimed_shot')).toBe(true);
  });

  it('every cast-time ranged shot in the ability table is classified', async () => {
    const { isDrawnShotCast } = await import('../src/render/characters/skin_attack');
    const { ABILITIES } = await import('../src/sim/data');
    // A DRAWN shot is the intersection the allowlist exists to name: it takes
    // cast time (so the held pose is visible at all) and carries the classic
    // ranged dead zone. Instant shots need no held pose, and a cast without a
    // dead zone is a spell or a pet utility, not something a bow draws.
    const candidates = Object.values(ABILITIES)
      .filter((a) => (a.castTime ?? 0) > 0 && ((a as { minRange?: number }).minRange ?? 0) > 0)
      .map((a) => a.id);
    expect(candidates.length, 'the scan must not be vacuous').toBeGreaterThan(0);
    const unclassified = candidates.filter((id) => !isDrawnShotCast(id));
    expect(
      unclassified,
      `new cast-time ranged shot(s) with no DRAWN_SHOT_CAST_IDS row: ${unclassified.join(', ')}`,
    ).toEqual([]);
    // And the list must not creep the other way onto things that are not shots.
    expect(isDrawnShotCast('tame_beast')).toBe(false);
    expect(isDrawnShotCast('charge')).toBe(false);
    expect(isDrawnShotCast(null)).toBe(false);
  });

  it('visual.ts asks the shared predicate rather than re-deriving the trigger', () => {
    const src = readFileSync(join(ROOT, 'src/render/characters/visual.ts'), 'utf8');
    const fn = src.slice(
      src.indexOf('private applySkinOrientation('),
      src.indexOf('/** Re-scale VFX point sprites'),
    );
    expect(fn).toContain('rangedSkinAiming(');
    // The old inline trigger must be gone, not merely supplemented.
    expect(fn).not.toContain('this.currentIsOneShot && !this.currentOneShotIsEmote');
  });

  it('a live skin swap mid-cast re-selects the cast action', () => {
    // The cast pose depends on the displayed skin, but the base action is only
    // re-selected on a base-state EDGE, and applying a skin does not edge the
    // state. Without an explicit re-drive the rig keeps Spellcasting after a
    // bow is equipped mid-cast (or keeps the draw after it is removed) for the
    // rest of that cast. Reported by review on PR 2950.
    const src = readFileSync(join(ROOT, 'src/render/characters/visual.ts'), 'utf8');
    const fn = src.slice(
      src.indexOf('setWeaponSkin(weaponSkinId: string | null)'),
      src.indexOf('private reattachHeldWeapon('),
    );
    expect(fn).toContain("this.baseState === 'cast'");
    expect(fn).toContain('this.baseAction()');
    // Guarded so it cannot fight a clamped one-shot or the death pose, both of
    // which own the rig outright (the zero-weight rules in this directory).
    expect(fn).toContain('!this.currentIsOneShot');
    expect(fn).toContain('!this.deadLock');
  });

  it('a drawn bow holds its draw while CASTING, instead of the caster gesture', async () => {
    const { weaponSkinCastClip, weaponSkinHandling, SKIN_ATTACK_CLIP_NAMES } = await import(
      '../src/render/characters/skin_attack'
    );
    // Casting is a HELD base state, and every class takes `Spellcasting` from
    // the shared kaykit() ClipMap, so a hunter part-way through Long Draw
    // (castTime 3.0) played a caster's arm circle while holding a bow.
    expect(weaponSkinCastClip('winterbite', 'aimed_shot')).toBe('Bow_Draw_Hold');
    expect(weaponSkinCastClip('fletcher_s_guild_bow', 'aimed_shot')).toBe('Bow_Draw_Hold');
    // Only for a drawn SHOT: a bow skin is still a bow during a pet cast, and
    // holding a full draw through tame_beast (6s) is the POSE half of the same
    // bug the aim pin gates. Reported by review on PR 2941.
    expect(weaponSkinCastClip('winterbite', 'tame_beast')).toBeNull();
    expect(weaponSkinCastClip('winterbite', 'revive_pet')).toBeNull();
    expect(weaponSkinCastClip('winterbite', null)).toBeNull();
    // Crossbow handling is shouldered, not drawn: it keeps the authored cast
    // until a pose exists for it. The encore gun aims like a crossbow.
    expect(weaponSkinCastClip('meteorlatch_crossbow', 'aimed_shot')).toBeNull();
    expect(weaponSkinHandling(WEAPON_SKINS.encore_bow)).toBe('crossbow');
    expect(weaponSkinCastClip('encore_bow', 'aimed_shot')).toBeNull();
    // Melee skins and no skin never substitute a cast pose.
    expect(weaponSkinCastClip('ice_fang_sword', 'aimed_shot')).toBeNull();
    expect(weaponSkinCastClip(null, 'aimed_shot')).toBeNull();
    expect(weaponSkinCastClip('not_a_skin', 'aimed_shot')).toBeNull();
    // The constructor only binds names in this list, so an unlisted clip would
    // resolve to no action and silently fall through to the caster gesture.
    expect(SKIN_ATTACK_CLIP_NAMES).toContain('Bow_Draw_Hold');
  });

  it('the cast pose GLB ships, holds a STATIC pose, and shares the draw rig', () => {
    const parse = (rel: string) => {
      const b = readFileSync(join(ROOT, rel));
      return JSON.parse(b.subarray(20, 20 + b.readUInt32LE(12)).toString('utf8'));
    };
    const hold = parse('public/models/chars/players/bow_hold_anim.glb');
    const draw = parse('public/models/chars/players/bow_anims.glb');
    expect((hold.animations ?? []).map((a: { name?: string }) => a.name)).toEqual([
      'Bow_Draw_Hold',
    ]);
    // Clip donor only: no mesh rides along (the draw GLB's contract too).
    expect(hold.meshes ?? []).toEqual([]);
    // Same skeleton as the draw it was resampled from, so the pose binds on any
    // rig the draw already binds on.
    const names = (d: { nodes?: { name?: string }[] }) =>
      new Set((d.nodes ?? []).flatMap((n) => (n.name ? [n.name] : [])));
    const held = names(hold);
    expect([...names(draw)].filter((n) => !held.has(n))).toEqual([]);
    // STATIC: both keys carry the same value, or the "hold" would drift.
    const anim = hold.animations[0];
    const sampler = anim.samplers[0];
    const acc = hold.accessors[sampler.output];
    expect(acc.count).toBe(2);
    // The hunter loads it.
    const manifestSrc = readFileSync(join(ROOT, 'src/render/characters/manifest.ts'), 'utf8');
    const hunterBlock = manifestSrc.slice(
      manifestSrc.indexOf('player_hunter: {'),
      manifestSrc.indexOf('player_rogue: {'),
    );
    expect(hunterBlock).toContain('bow_hold_anim.glb');
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

  it('a rig missing the substitute clip keeps its authored attack (the Combat Mech)', async () => {
    const { pickSkinAttackClips } = await import('../src/render/characters/skin_attack');
    // The hunter ships Bow_Draw_Shot via animUrls, so the draw substitutes.
    expect(pickSkinAttackClips('winterbite', () => true)?.clips).toEqual(['Bow_Draw_Shot']);
    // The Combat Mech is a separate model with no animUrls entry, so the clip
    // is never bound on it. Substituting a clip the rig does not have makes
    // playOneShot a silent no-op and the attack plays NOTHING; fall back to
    // the rig's own authored attack instead.
    expect(pickSkinAttackClips('winterbite', () => false)).toBeNull();
    // Partial availability still falls back: every named clip must be bound.
    expect(pickSkinAttackClips('winterbite', (c) => c !== 'Bow_Draw_Shot')).toBeNull();
    // Crossbow handling gets the shoulder-aim, and both live rigs ship it, so
    // this arm resolves rather than falling back.
    expect(pickSkinAttackClips('meteorlatch_crossbow', () => true)?.clips).toEqual([
      '2H_Ranged_Shoot',
    ]);
    expect(pickSkinAttackClips('encore_bow', () => true)?.clips).toEqual(['2H_Ranged_Shoot']);
    // ...and it falls back the same way on a rig that lacks it.
    expect(pickSkinAttackClips('meteorlatch_crossbow', () => false)).toBeNull();
    // Melee skins never substitute, so there is nothing to resolve.
    expect(pickSkinAttackClips('solheim_sword', () => true)).toBeNull();
    expect(pickSkinAttackClips(null, () => true)).toBeNull();
    expect(pickSkinAttackClips('not_a_skin', () => true)).toBeNull();
  });

  it('playAttack resolves the substitute against the clips the rig actually bound', () => {
    // Wiring pin: the fallback is worthless if the coordinator still asks for
    // the substitute unconditionally.
    const src = readFileSync(join(ROOT, 'src/render/characters/visual.ts'), 'utf8');
    const playAttack = src.slice(
      src.indexOf('playAttack(abilityId?: string)'),
      src.indexOf('playWhirl()'),
    );
    expect(playAttack).toContain('pickSkinAttackClips(');
    expect(playAttack).toContain('this.action(');
    expect(playAttack).not.toContain('weaponSkinAttackClips(');
  });

  it('the mech ships both ranged clips: the bow donor by animUrls, the shot in its GLB', () => {
    const manifestSrc = readFileSync(join(ROOT, 'src/render/characters/manifest.ts'), 'utf8');
    const mechBlock = manifestSrc.slice(
      manifestSrc.indexOf('player_mech: {'),
      manifestSrc.indexOf('npc_fernando: {'),
    );
    expect(mechBlock).toContain('bow_anims.glb');

    // The crossbow/gun arm needs no donor: CombatMech.glb already carries the
    // shoulder-aim, it was just never named by the mech's ClipMap. If a future
    // re-bake drops it, a crossbow skin silently loses its animation.
    const glb = readFileSync(
      join(ROOT, 'public/models/chars/players/Mech/characters/CombatMech.glb'),
    );
    const doc = JSON.parse(glb.subarray(20, 20 + glb.readUInt32LE(12)).toString('utf8'));
    const clips = (doc.animations ?? []).map((a: { name?: string }) => a.name);
    expect(clips).toContain('2H_Ranged_Shoot');
  });

  it('the bow draw retargets onto the mech: every bone it drives exists on both rigs', () => {
    // The substitution is bind-by-name through the AnimationMixer, so the clip
    // only plays if the mech carries the bones the tracks target. Held against
    // the HUNTER (the rig the clip was authored for) rather than an absolute
    // count: the donor names some IK-control nodes neither exported rig keeps,
    // and those are inert. What must not differ is the two rigs' answer.
    const parse = (p: string) => {
      const b = readFileSync(join(ROOT, p));
      return JSON.parse(b.subarray(20, 20 + b.readUInt32LE(12)).toString('utf8'));
    };
    const bow = parse('public/models/chars/players/bow_anims.glb');
    const names = (doc: { nodes?: { name?: string }[] }) =>
      new Set((doc.nodes ?? []).flatMap((n) => (n.name ? [n.name] : [])));
    const mech = names(parse('public/models/chars/players/Mech/characters/CombatMech.glb'));
    const hunter = names(parse('public/models/chars/players/ranger.glb'));

    const draw = (bow.animations ?? []).find(
      (a: { name?: string }) => a.name === 'Bow_Draw_Shot',
    ) as { channels?: { target?: { node?: number } }[] } | undefined;
    expect(draw, 'bow_anims.glb must carry Bow_Draw_Shot').toBeTruthy();
    const targets = new Set<string>();
    for (const ch of draw?.channels ?? []) {
      const n = bow.nodes?.[ch.target?.node as number];
      if (n?.name) targets.add(n.name);
    }
    expect(targets.size).toBeGreaterThan(20);
    const missingOn = (rig: Set<string>) => [...targets].filter((t) => !rig.has(t)).sort();
    expect(missingOn(mech)).toEqual(missingOn(hunter));
  });

  it('the swap-slot path applies the ranged hand rule too (bow on the mech)', () => {
    // rangedSkinAttachDef already moved a drawn bow to the left handslot, but
    // that path only serves the hunter's FIXED attach. The mech shows a
    // hunter's weapon through the weaponSlots swap path, so the rule has to
    // live there as well or the bow renders backwards in the right hand.
    const src = readFileSync(join(ROOT, 'src/render/characters/assets.ts'), 'utf8');
    const swap = src.slice(
      src.indexOf('function swapAttachDef('),
      src.indexOf('function resolveBone('),
    );
    expect(swap).toContain('weaponSkinAttachBone(');
    expect(swap).toContain('weaponSkinHandling(');
    // Gated on the resident skin url: a not-yet-streamed skin must leave the
    // equipped item's own model in its authored hand.
    expect(swap).toContain('residentOrEnsure(');
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

  it('mirrors a per-weapon offset onto the off-hand (X and Z flip, Y shared)', async () => {
    // The override is authored against the right hand; the off-hand is the mirror
    // image (a 180-degree turn about Y), so a large offset must flip X and Z or the
    // off-hand model sits off the grip (a legendary sword skin on a dual-wielder).
    const { variantGripTransform } = await import('../src/render/characters/weapon_grip');
    const override = { pos: [-0.1787, -0.0279, -0.273] as [number, number, number] };
    const right = variantGripTransform(1.2, false, 0.05, 1.6, override);
    const left = variantGripTransform(1.2, true, 0.05, 1.6, override);
    expect(left.position[0]).toBeCloseTo(-right.position[0], 5);
    expect(left.position[2]).toBeCloseTo(-right.position[2], 5);
    // Y is the along-bone lift, shared by both hands.
    expect(left.position[1]).toBeCloseTo(right.position[1], 5);
    // A scale-only override (ice_fang and friends) has no X/Z to flip, so the grip
    // position is identical in both hands, off-hand skins render byte-identically.
    const scaleOnlyR = variantGripTransform(1.2, false, 0.05, 1.6, { scale: 1.3 });
    const scaleOnlyL = variantGripTransform(1.2, true, 0.05, 1.6, { scale: 1.3 });
    for (let i = 0; i < 3; i++) {
      expect(scaleOnlyL.position[i]).toBeCloseTo(scaleOnlyR.position[i], 5);
      expect(scaleOnlyL.position[i]).toBeCloseTo([0, 0.05, 0][i], 5);
    }
  });
});

describe('eligible classes per skin type (store card chips)', () => {
  it('bow and crossbow are hunter-only (class-fixed ranged visual)', () => {
    expect(eligibleClassesForWeaponSkinType('bow')).toEqual(['hunter']);
    expect(eligibleClassesForWeaponSkinType('crossbow')).toEqual(['hunter']);
  });

  it('hunters ARE eligible for the melee types they can equip (the mech body shows them)', () => {
    // They were excluded while no body could render a hunter's held weapon.
    // The Combat Mech does, so the chip would be lying; the item data decides
    // per type instead, and canApplyNow still gates the body worn right now.
    expect(eligibleClassesForWeaponSkinType('axe')).toContain('hunter');
    expect(eligibleClassesForWeaponSkinType('sword')).toContain('hunter');
    // Not a blanket add: a type hunters cannot equip still omits them.
    expect(eligibleClassesForWeaponSkinType('wand')).not.toContain('hunter');
    // Every type still lists whoever the item data says, hunter or not.
    for (const skin of WEAPON_SKIN_LIST) {
      expect(
        eligibleClassesForWeaponSkinType(skin.weaponType).length,
        `${skin.weaponType} must list someone`,
      ).toBeGreaterThan(0);
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
      resolveActiveWeaponSkin('warrior', 'worn_sword', { sword: 'glaciersplit_axe' }, 'class'),
    ).toBeNull();
  });

  it('resolves null for a missing loadout or no equipped mainhand', () => {
    expect(resolveActiveWeaponSkin('warrior', 'worn_sword', null, 'class')).toBeNull();
    expect(resolveActiveWeaponSkin('warrior', 'worn_sword', undefined, 'class')).toBeNull();
    expect(
      resolveActiveWeaponSkin('warrior', null, { sword: 'ice_fang_sword' }, 'class'),
    ).toBeNull();
  });

  it('prefers the crossbow skin over the bow skin for hunters (native visual)', () => {
    expect(
      resolveActiveWeaponSkin(
        'hunter',
        'rusty_hatchet',
        { bow: 'winterbite', crossbow: 'cinderlatch_crossbow' },
        'class',
      ),
    ).toBe('cinderlatch_crossbow');
    expect(resolveActiveWeaponSkin('hunter', 'rusty_hatchet', { bow: 'winterbite' }, 'class')).toBe(
      'winterbite',
    );
  });

  it('a mech hunter shows the weapon skin only when no ranged skin is applied', () => {
    const both = { bow: 'winterbite', sword: 'ice_fang_sword' };
    // Ranged first: putting the suit on never silently changes the look a
    // hunter already had.
    expect(resolveActiveWeaponSkin('hunter', 'direfang_greatblade', both, 'mech')).toBe(
      'winterbite',
    );
    // Clearing the ranged entry (Sim.setWeaponSkin(pid, null, 'bow')) reveals
    // the weapon skin, so neither look is ever locked out.
    expect(
      resolveActiveWeaponSkin('hunter', 'direfang_greatblade', { sword: 'ice_fang_sword' }, 'mech'),
    ).toBe('ice_fang_sword');
    // The same loadout on the class rig resolves the bow and NEVER the sword,
    // which that body cannot render.
    expect(resolveActiveWeaponSkin('hunter', 'direfang_greatblade', both, 'class')).toBe(
      'winterbite',
    );
    expect(
      resolveActiveWeaponSkin(
        'hunter',
        'direfang_greatblade',
        { sword: 'ice_fang_sword' },
        'class',
      ),
    ).toBeNull();
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
