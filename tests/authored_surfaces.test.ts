// Pins the per-model opt-outs that keep an authored baked atlas free of the
// kit-era readability floors (the flat grey film): the Varkhul drops on the
// held-weapon polish, and the replaced creature rigs on the low-tier lift.
// Explicit lists on purpose: a model NOT named here renders exactly as before.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { glbJsonChunk } from '../scripts/assets/lib/glb_texture_compression_core.mjs';
import {
  AUTHORED_HELD_MODELS,
  ITEM_OFFHAND_MODELS,
  isAuthoredHeldModelUrl,
  itemOffhandModelUrl,
  itemWeaponModelUrl,
  VISUALS,
} from '../src/render/characters/manifest';
import { ITEM_WEAPON_VARIANTS } from '../src/ui/weapon_variants';

const MODELS = path.resolve(__dirname, '..', 'public', 'models');

/** The KayKit kit palettes: the flat swatch atlases every kit rig, prop and
 *  weapon ships. A base texture under one of these names is NOT an authored
 *  atlas; anything else with a base texture is. This is a NAME heuristic over
 *  the GLB's material list, not a texture-content test: a kit material renamed
 *  in a re-export reads as authored (add the name here), and an authored atlas
 *  that happens to reuse a kit name would slip through. */
const KIT_PALETTE_NAMES = new Set([
  'Atlas',
  'Glow',
  'barbarian',
  'barbarian_texture',
  'combatMech', // the player mech skin
  'druid',
  'knight',
  'knight_texture',
  'mage',
  'mage_texture',
  'mod_skin_detail', // the modular player body
  'paladin',
  'paladin_metallic',
  'ranger',
  'rogue',
  'rogue_texture',
  'skeleton',
  'weapons',
  'weapons_glow',
]);

interface GlbMaterial {
  name?: string;
  pbrMetallicRoughness?: { baseColorTexture?: unknown };
}

/** Material names of a GLB that carry a base texture outside the kit palettes. */
function authoredMaterialsOf(file: string): string[] {
  const json = glbJsonChunk(fs.readFileSync(file)) as { materials?: GlbMaterial[] };
  return (json.materials ?? [])
    .filter((m) => m.pbrMetallicRoughness?.baseColorTexture !== undefined)
    .map((m) => m.name ?? '(unnamed)')
    .filter((n) => !KIT_PALETTE_NAMES.has(n) && !/Glow$/.test(n));
}

/** Defs that ship an authored atlas and were DELIBERATELY left on the uniform
 *  low-tier floor (never reported, not re-rendered on request). Adding a new
 *  authored rig here instead of flagging it is a conscious choice, not the
 *  default: a new Tripo or Blender creature sets `authoredAtlas: true`. */
const LEGACY_UNFLAGGED_DEFS = new Set([
  // Retained buddies keep their existing low-tier material response.
  'buddy_horse',
  'buddy_crystal_lich',
  'buddy_forgemaw',
  'delve_mob_acolyte',
  'form_bear',
  'form_ghost_wolf',
  'form_metamorph',
  'mob_boar',
  'mob_duskwisp',
  'mob_emberkin',
  'mob_glimmerwisp',
  'mob_gloomshade',
  'mob_gravewing',
  'mob_grubjaw',
  'mob_mech',
  'mob_mushroom_pixie',
  // Nythraxis raid prop rig (models/props, Tripo): landed on the release base after
  // this guard was cut and was tuned under the uniform floor, so it stays there.
  'mob_nythraxis_bone_spike',
  'mob_pyre_colossus',
  'mob_reedbound_acolyte',
  'mob_spider_egg_sac',
  'mob_tolling_bell',
  'mob_training_dummy',
  'mob_wildheart_hexcaller',
  'mob_wildheart_high_priest',
  'mob_wildheart_ravager',
  'mob_wildheart_stalker',
  'mob_yumi_cat',
  'mount_aether_hover_cycle',
  'mount_chimeglass_tortoise',
  'mount_drakemaw_raptor',
  'mount_grag_bear',
  'mount_lanternback_troll',
  'mount_rickshaw_mount',
  'mount_shadowjump_toad',
  'mount_stalkglider_snail',
  'mount_stormfeather_griffin',
  'mount_terrorspark_groundshaker',
  'mount_thunderstrut_gobbler',
  // The five-dungeon rework's re-tints of a legacy body above: they spread the
  // base def (the Wildheart Basin's Howdah Hexcaller over
  // mob_wildheart_hexcaller), so it keeps the floor its shared GLB was
  // tuned under.
  'wildheart_howdah_hexcaller',
]);

/** Held ITEM models with authored materials that still take the kit polish
 *  (left as shipped on request). A new authored weapon goes in
 *  AUTHORED_HELD_MODELS instead. */
const LEGACY_POLISHED_HELD_MODELS = new Set([
  'ice_fang',
  'purple_axe', // same Tripo family as purple_dagger; landed after this guard was cut
  'purple_dagger',
  'purple_sword', // same Tripo family as purple_dagger; landed after this guard was cut
  'redskull_dagger',
  'whittler_s_knife',
]);

/** The creature and mount defs whose authored atlas showed the low-tier film. */
const AUTHORED_ATLAS_DEFS = [
  'form_cat',
  // The one authored PLAYER body: the WOC warrior (woc_warrior.glb, its own
  // baked Tripo atlases on the artist's rig, never a KayKit palette), which the
  // loop below exempts from the "never a player body" rule by its wocCharacter
  // manifest rather than by name.
  'player_warrior',
  // ...and the paladin, the same WOC body under its own armor pack.
  'player_paladin',
  // ...and the female warrior body, the creation pick's file for the class.
  'player_warrior_female',
  'player_paladin_female',
  // ...and the seven class sets of 2026-09-18, both fits.
  'player_hunter',
  'player_hunter_female',
  'player_rogue',
  'player_rogue_female',
  'player_mage',
  'player_mage_female',
  'player_priest',
  'player_priest_female',
  'player_warlock',
  'player_warlock_female',
  'player_druid',
  'player_druid_female',
  'player_shaman',
  'player_shaman_female',
  'mob_wolf',
  'greyjaw',
  'mob_ogre',
  'mob_drogmar',
  'mob_kobold_digger',
  'mob_grix',
  'mob_ignivar',
  'mob_ignivar_heart_of_the_end',
  'mob_ignivar_crucible_warden',
  'mob_ignivar_ember_sentinel',
  'mob_ignivar_cinder_artificer',
  'mob_healing_tide_totem',
  'mob_hoard_abyssal_maw',
  'mob_hoard_hoarfrost_warden',
  'mob_hoard_emberforge_tyrant',
  'mob_hoard_archon_nyxaris',
  'mob_hoard_tempest_vharok',
  // The Buried Hoard room mobs, the Coinsack Scurrier, and the cave bosses with
  // their adds: Tripo and Blender bodies with their own authored atlases.
  'mob_hoard_tide_thrall',
  'mob_hoard_deep_lurker',
  'mob_hoard_frost_revenant',
  'mob_hoard_ember_fiend',
  'mob_hoard_magma_brute',
  'mob_hoard_void_acolyte',
  'mob_hoard_storm_caller',
  'mob_hoard_boneclad_warrior',
  'mob_hoard_dread_stalker',
  'mob_hoard_stormscale_drake',
  'mob_hoard_venom_weaver',
  'mob_hoard_thornback_stalker',
  'mob_hoard_rime_elemental',
  'mob_hoard_coinsack_scurrier',
  'mob_hoard_boss_mushroom',
  'mob_hoard_sporeling',
  'mob_hoard_bloat_cap',
  'mob_hoard_boss_mole',
  'mob_hoard_boss_bat',
  'mob_hoard_bat_swarmling',
  'mob_hoard_boss_mimic',
  'mob_varkhul_forgefather',
  'mount_mech_bird',
  'mob_dragonkin_whelp',
  'mob_dragonkin_broodguard',
  'mob_dragonkin_broodlord',
  'mob_dragonkin_matriarch',
  'mob_dragon_egg',
  'mount_goblin_rocket_sled',
  'mount_rallycart_rxt',
  'mob_balgath_cyclops',
  // The Knucklebone of Balgath's Shape of the Foreman: his own authored stone body.
  'form_foreman',
  'mount_avian_strider',
  // the Blender-built dungeon bosses and bodies: the Sunken Bastion's Vael,
  // Iron Cage, Drowned Anchor and Gaol Turnkey, and the Hollow Crypt's Lich
  // Bishop (Morthen); and the Bastion's sculpted drowned (the Revenant first)
  'bastion_vael',
  'bastion_drowned_revenant',
  'bastion_warhound',
  'bastion_skel_watchman',
  'bastion_skel_arbalest',
  'bastion_skel_sergeant',
  'bastion_mistweaver',
  'bastion_acolyte',
  'bastion_prisoner',
  'bastion_gaol_cage',
  // the Sunken Bastion's Blender bosses Olen and Ossick, and Laverock, the
  // Drowned Temple's lore guide (flagged in manifest.ts, listed here late)
  'bastion_olen',
  'bastion_ossick',
  'npc_laverock',
  'bastion_drowned_anchor',
  'bastion_turnkey',
  'crypt_morthen_lich',
  // the Hollow Crypt's bosses on the art guide's models: Sexton Marrow (the skeletal
  // gravedigger), the Lady of the Bonechill (the frozen bride's ghost), Cantor Ilvane
  // (the skeletal choir mistress), and the rime egg sacs the Lady's spiders hatch from
  'crypt_skel_sexton',
  'crypt_lady_bonechill',
  'crypt_skel_cantor',
  'crypt_rime_egg_sac',
  // the art guide's skeleton minion (Tripo P2, rigged in Blender) on its three keys
  'skel_minion',
  'delve_skel_wraith',
  'crypt_skel_minion',
  // the Sunken Bastion's Blender crawler and the Stormbrass Foundry's turretback, flagged in
  // manifest.ts on the v0.45.0 integration and listed here late
  'bastion_crawler',
  'mob_turretback',
  // the Drowned Temple's Reflections: copies of the WOC class bodies (their flag
  // comes with the body they spread)
  'temple_reflection_druid',
  'temple_reflection_hunter',
  'temple_reflection_mage',
  'temple_reflection_paladin',
  'temple_reflection_priest',
  'temple_reflection_rogue',
  'temple_reflection_shaman',
  'temple_reflection_warlock',
  'temple_reflection_warrior',
  // the art guide's Hollow Crypt trash bodies (Tripo P2, rigged in Blender)
  'crypt_skel_warrior',
  'crypt_skel_adept',
  'crypt_skel_necromancer',
  'crypt_skel_cutthroat',
  'crypt_skel_brute',
  'crypt_skel_chorister',
  // the Gravewyrm Sanctum's three Blender bosses (characters/sanctum_boss_looks.ts)
  'sanctum_korgath',
  'sanctum_velkhar',
  'sanctum_korzul',
  'sanctum_seal_shackle',
  // the Hollow Crypt's Blender gargoyle, drake and Knellwyrm, the Drowned
  // Temple's Ysolei, the Gravewyrm Sanctum's Sledge Tusker and Soul Brazier
  // prop, and the Wildheart Basin's Blender bodies and mask-totem prop
  'mob_crypt_gargoyle',
  'mob_crypt_drake',
  'mob_crypt_knellwyrm',
  'temple_ysolei',
  // the Drowned Temple's Blender Tide Pilgrim (the sacred sea snail)
  'temple_pilgrim',
  // the Drowned Temple's Blender Nacre Templeguard (the seahorse temple knight)
  'temple_templeguard',
  // the Drowned Temple's Blender Pale Choir Acolyte (the moon-jelly priestess)
  'temple_acolyte',
  // the Drowned Temple's Blender Moonlit Siren (the priestess on her waterspout)
  'temple_siren',
  // the Drowned Temple's Blender Tidewisp (the drop of moon-water)
  'temple_tidewisp',
  // the Drowned Temple's Blender Glimmerscale Lurker (the sacred mantis shrimp)
  'temple_lurker',
  // the Drowned Temple's Blender Pearlguard Sentinel (the Moonmantle Ray)
  'temple_sentinel',
  // the Drowned Temple's Blender Choirmother Selthe (the siren matriarch)
  'temple_selthe',
  // the Drowned Temple's Blender Lagoon Snapper (the sacred nautilus)
  'temple_snapper',
  // the Drowned Temple's Blender Tideglass Colossus (the sea-glass giant)
  'temple_colossus',
  // the Drowned Temple's Blender Moonspawn (the moon spirit of water)
  'temple_moonspawn',
  // the Drowned Temple's Ice Wraith (a Tripo sculpt)
  'temple_ice_wraith',
  'sanctum_sledge_tusker',
  'sanctum_soul_brazier',
  // the Gravewyrm Sanctum trash's Blender bodies (sanctum_trash_looks.ts)
  'sanctum_boneguard',
  'sanctum_raised_bonewalker',
  'sanctum_scaleguard',
  'sanctum_thawcaller',
  'sanctum_goadsmith',
  'sanctum_pyre_tender',
  'sanctum_rime_whelp',
  'sanctum_sledge_hauler',
  'sanctum_glacier_splinter',
  'wildheart_great_saurian',
  'wildheart_gorgebloom',
  'wildheart_vine_lasher',
  'wildheart_thorn_sprout',
  'wildheart_fanglord_jaguar',
  // the Blender Basin Raptor (scripts/assets/wildheart_basin_raptor)
  'wildheart_basin_raptor',
  // the Blender Spore Toad (scripts/assets/wildheart_spore_toad) and the Toad Hex's toad on it
  'wildheart_spore_toad',
  'form_toad',
  // the Blender Sunbone Totem-Binder (scripts/assets/wildheart_totem_binder)
  'wildheart_totem_binder',
  // the Fanglord Beastmaster's Blender body (scripts/assets/wildheart_beastmaster)
  'mob_wildheart_beastmaster',
  'wildheart_sunbone_totem',
  // its Dread Totem (scripts/assets/wildheart_sunbone_totem, both Blender bodies)
  'wildheart_sunbone_dread_totem',
];

describe('authored surfaces', () => {
  it('routes both Varkhul drops through the authored held-model arm', () => {
    expect(isAuthoredHeldModelUrl(itemWeaponModelUrl('varkhul_forgebreaker') ?? '')).toBe(true);
    expect(isAuthoredHeldModelUrl(itemOffhandModelUrl('varkhul_emberward') ?? '')).toBe(true);
  });

  // The starter weapons are painted Tripo atlases with their own shading, the same kind
  // of surface the Varkhul drops are: under the kit polish they would wear its cream lift
  // and emissive floor as a grey film.
  it('routes the starting kit through the authored held-model arm too', () => {
    for (const itemId of [
      'worn_sword',
      'rusty_dagger',
      'training_mace',
      'rusty_hatchet',
      'gnarled_staff',
    ]) {
      expect(isAuthoredHeldModelUrl(itemWeaponModelUrl(itemId) ?? ''), itemId).toBe(true);
    }
    expect(isAuthoredHeldModelUrl(itemOffhandModelUrl('eastbrook_buckler') ?? '')).toBe(true);
    expect(isAuthoredHeldModelUrl(VISUALS.player_hunter.attach?.[0]?.url ?? '')).toBe(true);
    expect(isAuthoredHeldModelUrl(VISUALS.player_warlock.attach?.[1]?.url ?? '')).toBe(true);
  });

  // The common and uncommon field set comes from the same painted pipeline as the starters.
  it('routes the common and uncommon field set through the authored held-model arm too', () => {
    for (const itemId of [
      'eastbrook_arming_sword',
      'eastbrook_greatsword',
      'vale_carving_knife',
      'bronzework_mace',
      'ironshod_maul',
      'copper_bearded_axe',
      'hickory_shortstaff',
      'ironbark_boar_spear',
      'palecoil_rod',
    ]) {
      expect(isAuthoredHeldModelUrl(itemWeaponModelUrl(itemId) ?? ''), itemId).toBe(true);
    }
    expect(isAuthoredHeldModelUrl(itemOffhandModelUrl('highwatch_wallshield') ?? '')).toBe(true);
  });

  it('routes the rare set through the authored held-model arm too', () => {
    for (const itemId of [
      'thorium_warblade',
      'moggers_shiv',
      'crag_warden_cudgel',
      'gravewyrm_thornmaul',
      'arcanite_war_axe',
      'gravecaller_staff',
      'fen_reaver_glaive',
      'drowned_tide_scepter',
    ]) {
      expect(isAuthoredHeldModelUrl(itemWeaponModelUrl(itemId) ?? ''), itemId).toBe(true);
    }
    expect(isAuthoredHeldModelUrl(itemOffhandModelUrl('pearlward_aegis') ?? '')).toBe(true);
  });

  it('routes the epic set through the authored held-model arm too', () => {
    for (const itemId of [
      'bonewrought_greatsword',
      'fang_of_korzul',
      'wildsoul_maul',
      'springtouched_crozier',
      'gravewyrm_cleaver',
      'nightfangs_greatstaff',
      'stormcallers_focus',
    ]) {
      expect(isAuthoredHeldModelUrl(itemWeaponModelUrl(itemId) ?? ''), itemId).toBe(true);
    }
    for (const itemId of ['bonewrought_bulwark', 'bulwark_of_the_inner_crucible']) {
      expect(isAuthoredHeldModelUrl(itemOffhandModelUrl(itemId) ?? ''), itemId).toBe(true);
    }
  });

  it('leaves every other held model on the polish', () => {
    // the class bodies' stock hands, the kit shields, an adv-set piece, and an authored
    // PBR craft weapon that was never reported: none of them are opted out. No item draws
    // a kit model any more, so these are named by file.
    for (const key of ['sword_1handed', 'staff', 'dagger', 'shield_round', 'shield_square']) {
      expect(isAuthoredHeldModelUrl(`models/weapons/${key}.glb`), key).toBe(false);
    }
    expect(isAuthoredHeldModelUrl('models/weapons/adv_sword_2handed_color.glb')).toBe(false);
    expect(isAuthoredHeldModelUrl('models/weapons/emberfang_sword.glb')).toBe(false);
    // every epic shield and weapon draws the rare set now, an authored one
    for (const itemId of ['duskforged_bulwark', 'storm_tuned_buckler']) {
      expect(isAuthoredHeldModelUrl(itemOffhandModelUrl(itemId) ?? ''), itemId).toBe(true);
    }
    expect(isAuthoredHeldModelUrl(itemWeaponModelUrl('first_blood_razor') ?? '')).toBe(true);
    // a creature or player GLB can never match the held-model set
    expect(isAuthoredHeldModelUrl('models/creatures/ogre.glb')).toBe(false);
    expect(isAuthoredHeldModelUrl('')).toBe(false);
    // ...and only a model under models/weapons/ can: the worn-gear directory the
    // harbormaster's set once opted in is no arm of the rule any more
    expect(isAuthoredHeldModelUrl('models/chars/npc_gear/hammer_varkhul.glb')).toBe(false);
    expect(isAuthoredHeldModelUrl('models/weapons/hammer_varkhul.glb')).toBe(true);
    // the two Varkhul drops, the eight starter models, the 23 field models, the 50
    // rare models (37 pack finishes and 13 repaints of them) and the 27 epic models
    // plus Balgath's three on the v0.45.0 integration (the Foreman's Barrowmaul, the
    // Shardpike and the Craterglass Stave)
    expect(AUTHORED_HELD_MODELS.size).toBe(113);
  });

  it('flags exactly the replaced creature and mount rigs, never a player body', () => {
    for (const key of AUTHORED_ATLAS_DEFS) {
      expect(VISUALS[key]?.authoredAtlas, key).toBe(true);
    }
    const flagged = Object.entries(VISUALS)
      .filter(([, def]) => def.authoredAtlas)
      .map(([key]) => key)
      .sort();
    expect(flagged).toEqual([...AUTHORED_ATLAS_DEFS].sort());
    for (const key of flagged) {
      // A WOC modular body IS an authored atlas on a player rig: the one
      // sanctioned player-body flag, carried by its part manifest.
      if (VISUALS[key].wocCharacter) {
        expect(VISUALS[key].url.startsWith('models/chars/players/'), key).toBe(true);
        continue;
      }
      expect(key.startsWith('player_'), key).toBe(false);
      // and never a GLB a player body is composed from or a class rig NPCs share. A
      // shapeshift form (models/chars/forms/, e.g. the Knucklebone's Shape of the
      // Foreman) is a whole replacement body of its own, neither of those.
      const url = VISUALS[key].url;
      const sharedCharGlb =
        url.startsWith('models/chars/') && !url.startsWith('models/chars/forms/');
      expect(sharedCharGlb, `${key}: ${url}`).toBe(false);
    }
  });

  // The two guards below are what stops the next drop from shipping with the
  // film: a NEW rig or held model whose GLB carries an authored atlas has to
  // declare itself (flag it, or add it to the legacy list on purpose).
  it('every VISUALS def that ships an authored atlas is flagged or deliberately legacy', () => {
    const undeclared: string[] = [];
    let scanned = 0;
    for (const [key, def] of Object.entries(VISUALS)) {
      // player bodies (composed from the modular part library, or a class rig)
      // are never candidates: the flag is for creature and prop atlases only
      if (def.modular || key.startsWith('player_')) continue;
      const file = path.join(MODELS, def.url.replace(/^models\//, ''));
      if (!fs.existsSync(file)) continue;
      scanned += 1;
      const authored = authoredMaterialsOf(file);
      if (authored.length === 0) continue;
      if (def.authoredAtlas || LEGACY_UNFLAGGED_DEFS.has(key)) continue;
      undeclared.push(`${key} (${def.url}: ${authored.join(', ')})`);
    }
    expect(
      undeclared,
      'a new authored-atlas rig needs `authoredAtlas: true` on its VisualDef (or a deliberate LEGACY_UNFLAGGED_DEFS entry)',
    ).toEqual([]);
    // the sweep is only a guard when it actually read the shipped GLBs
    expect(scanned, 'public/models is missing: the guard scanned nothing').toBeGreaterThan(80);
    // and the legacy list stays honest: every entry still exists and is still unflagged
    for (const key of LEGACY_UNFLAGGED_DEFS) {
      expect(VISUALS[key], key).toBeDefined();
      expect(
        VISUALS[key].authoredAtlas,
        `${key} is flagged now, drop it from the legacy list`,
      ).toBeFalsy();
    }
  });

  it('every held item model with authored materials is opted out or deliberately legacy', () => {
    // every held model key the manifest can resolve: the shared item map plus
    // the offhand (shield) table, by construction rather than a copied list
    const modelKeys = new Set<string>([
      ...Object.values(ITEM_WEAPON_VARIANTS),
      ...Object.values(ITEM_OFFHAND_MODELS),
    ]);
    const undeclared: string[] = [];
    let scanned = 0;
    for (const key of [...modelKeys].sort()) {
      const file = path.join(MODELS, 'weapons', `${key}.glb`);
      if (!fs.existsSync(file)) continue;
      scanned += 1;
      const authored = authoredMaterialsOf(file);
      if (authored.length === 0) continue;
      if (AUTHORED_HELD_MODELS.has(key) || LEGACY_POLISHED_HELD_MODELS.has(key)) continue;
      undeclared.push(`${key} (${authored.join(', ')})`);
    }
    expect(
      undeclared,
      'a new authored held model goes in AUTHORED_HELD_MODELS (or a deliberate LEGACY_POLISHED_HELD_MODELS entry)',
    ).toEqual([]);
    expect(scanned, 'public/models/weapons is missing: the guard scanned nothing').toBeGreaterThan(
      40,
    );
    for (const key of LEGACY_POLISHED_HELD_MODELS) {
      expect(
        AUTHORED_HELD_MODELS.has(key),
        `${key} is opted out now, drop it from the legacy list`,
      ).toBe(false);
    }
  });
});
