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
  'delve_mob_acolyte',
  'form_bear',
  'form_cat',
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
  'mob_wildheart_beastmaster',
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
  'mob_asmon_hermit',
  'mob_roach_king',
  'mob_roachling',
  'mob_garbage_beetle',
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
  'mob_varkhul_forgefather',
  'mount_mech_bird',
  'mob_dragonkin_whelp',
  'mob_dragonkin_broodguard',
  'mob_dragonkin_broodlord',
  'mob_dragonkin_matriarch',
  'mob_dragon_egg',
  'mount_goblin_rocket_sled',
  'mount_rallycart_rxt',
];

describe('authored surfaces', () => {
  it('routes both Varkhul drops through the authored held-model arm', () => {
    expect(isAuthoredHeldModelUrl(itemWeaponModelUrl('varkhul_forgebreaker') ?? '')).toBe(true);
    expect(isAuthoredHeldModelUrl(itemOffhandModelUrl('varkhul_emberward') ?? '')).toBe(true);
  });

  it('leaves every other held model on the polish', () => {
    // the class defaults, the shields, an adv-set piece, and an authored PBR
    // craft weapon that was never reported: none of them are opted out
    for (const itemId of ['eastbrook_buckler', 'highwatch_wallshield']) {
      expect(isAuthoredHeldModelUrl(itemOffhandModelUrl(itemId) ?? ''), itemId).toBe(false);
    }
    expect(isAuthoredHeldModelUrl('models/weapons/sword_1handed.glb')).toBe(false);
    expect(isAuthoredHeldModelUrl('models/weapons/adv_sword_2handed.glb')).toBe(false);
    expect(isAuthoredHeldModelUrl('models/weapons/emberfang_sword.glb')).toBe(false);
    // a creature or player GLB can never match the held-model set
    expect(isAuthoredHeldModelUrl('models/creatures/ogre.glb')).toBe(false);
    expect(isAuthoredHeldModelUrl('')).toBe(false);
    expect(AUTHORED_HELD_MODELS.size).toBe(2);
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
      expect(key.startsWith('player_'), key).toBe(false);
      // and never a GLB a player body is composed from or a class rig NPCs share
      expect(VISUALS[key].url.startsWith('models/chars/'), `${key}: ${VISUALS[key].url}`).toBe(
        false,
      );
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
