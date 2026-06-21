// Visual manifest: maps every sim identity (player class, mob template/family,
// NPC id, druid/polymorph form) onto a rigged glTF asset + clip names + kit.
// Pure data + dispatch — no three.js imports, no loading.
import type { Entity } from '../../sim/types';
import { MOBS } from '../../sim/data';
import { MECH_CHROMAS, type MechChroma } from '../../sim/content/skins';
import type { OverheadEmoteId } from '../../world_api';

export interface EmoteClipSpec {
  clips: readonly string[];
  timeScale?: number;
  repeats?: number;
}

export interface ClipMap {
  idle: string;
  walk: string;
  run: string;
  /** one-shot swing clips, rotated per attack */
  attack: string[];
  death: string;
  /** hit-react one-shots (optional — spider/raptor rigs have none) */
  hit?: string[];
  /** looping cast channel */
  cast?: string;
  sitDown?: string;
  sitIdle?: string;
  /** swim base (prone pitch is procedural on top) */
  swim?: string;
  /** airborne base pose while jumping/falling */
  jump?: string;
  walkBack?: string;
  /** one-shot played on respawn (skeleton awaken / boss taunt) */
  flourish?: string;
  /** player-facing overhead emote one-shots; clips are sourced from the GLB. */
  emote?: Partial<Record<OverheadEmoteId, EmoteClipSpec>>;
}

export interface AttachDef {
  url: string;
  bone: string;
  position?: [number, number, number];
  rotationY?: number;
  /** Copy grip from a built-in accessory node on the character rig (e.g. Spellbook_open). */
  gripRef?: string;
}

export interface VisualDef {
  url: string;
  /** Optional extra GLBs that provide animation clips for static rig files. */
  animUrls?: string[];
  /** world-unit height (pivot->crown) at e.scale = 1 */
  height: number;
  clips: ClipMap;
  /** floating rigs hover: mesh bottom sits this far above the pivot */
  hover?: number;
  /** yaw applied so the model faces +Z (facing-0 convention) */
  yaw?: number;
  /** KayKit chars ship every accessory visible: non-skinned mesh nodes to KEEP.
   *  undefined = keep everything (creature GLBs have no accessories). */
  show?: string[];
  attach?: AttachDef[];
  /** material tint: explicit color, 'entity' (use e.color), or none */
  tint?: number | 'entity';
  /** lerp amount toward the tint (default 0.4) */
  tintStrength?: number;
  /** u/s at which the walk/run cycles look right (timeScale matching) */
  walkRef?: number;
  runRef?: number;
  attackTimeScale?: number;
  deathTimeScale?: number;
  /** Skip the boot preload sweep (manifestUrls); the asset is fetched on demand
   *  instead — e.g. the cosmetic-only Combat Mech, loaded via preloadMechAssets()
   *  when the skin-select preview opens, so it never bloats every client's boot. */
  lazyPreload?: boolean;
  /** Post-load orientation fixups for weapon/prop nodes baked INTO a creature
   *  GLB at the wrong angle (some KayKit handslot weapons ship without the grip
   *  flip the standalone weapon files carry). Node name as authored in the GLB;
   *  applied as a local-space rotation (radians) after the bind transform. */
  weaponFix?: { node: string; rotX?: number; rotY?: number; rotZ?: number }[];
}

// ---------------------------------------------------------------------------
// Clip sets per source rig family
// ---------------------------------------------------------------------------

const KAYKIT_EMOTES: Partial<Record<OverheadEmoteId, EmoteClipSpec>> = {
  wave: { clips: ['Spellcast_Raise', 'Cheer'], timeScale: 0.9 },
  laugh: { clips: ['Hit_A', 'Cheer'], timeScale: 1.45, repeats: 2 },
  question: { clips: ['Block', 'Spellcast_Raise'], timeScale: 1.15 },
  cheer: { clips: ['Cheer'], timeScale: 1.05, repeats: 2 },
  dance: { clips: ['Running_Strafe_Left', 'Running_Strafe_Right', 'Cheer'], timeScale: 1.05, repeats: 2 },
  point: { clips: ['Spellcast_Shoot', '2H_Ranged_Shoot'], timeScale: 0.95 },
  flex: { clips: ['Block', 'Cheer'], timeScale: 0.8 },
  salute: { clips: ['Spellcast_Raise', 'Block'], timeScale: 1.18 },
  cry: { clips: ['Hit_A', 'Sit_Floor_Down'], timeScale: 0.65 },
  bow: { clips: ['Sit_Floor_Down', 'Spellcast_Raise'], timeScale: 1.35 },
  clap: { clips: ['1H_Melee_Attack_Slice_Diagonal', 'Cheer'], timeScale: 1.55, repeats: 2 },
  roar: { clips: ['2H_Melee_Attack_Chop', '1H_Melee_Attack_Chop', 'Cheer'], timeScale: 0.9 },
  kneel: { clips: ['Sit_Floor_Down'], timeScale: 0.85 },
};

const kaykit = (attack: string[], idle = 'Idle'): ClipMap => ({
  idle,
  walk: 'Walking_A',
  run: 'Running_A',
  walkBack: 'Walking_Backwards',
  attack,
  hit: ['Hit_A'],
  death: 'Death_A',
  cast: 'Spellcasting',
  sitDown: 'Sit_Floor_Down',
  sitIdle: 'Sit_Floor_Idle',
  swim: 'Lie_Idle',
  jump: 'Jump_Idle',
  emote: KAYKIT_EMOTES,
});

const skeletonClips = (attack: string[], flourish = 'Skeletons_Awaken_Standing'): ClipMap => ({
  ...kaykit(attack, 'Idle_Combat'),
  flourish,
});

const skeletonLargeClips = (attack: string[]): ClipMap => ({
  idle: 'Idle',
  walk: 'Walking_A',
  run: 'Running_A',
  attack,
  hit: ['Hit_A'],
  death: 'Death_A',
});

// Quaternius 2021 animal rig (wolf/bull/alpaca/fox/stag)
const animal = (attack: string[]): ClipMap => ({
  idle: 'Idle', walk: 'Walk', run: 'Gallop', attack,
  hit: ['Idle_HitReact_Left', 'Idle_HitReact_Right'], death: 'Death',
});

// Custom wild boar rig (wild_boar.glb)
const WILD_BOAR: ClipMap = {
  idle: 'Idle1',
  walk: 'Move2 (shuffle)',
  run: 'Move1 (jump)',
  attack: ['Attack1 (marracca)', 'Attack2 (tusks)'],
  hit: ['Hurt'],
  death: 'Dying',
};

// 14-clip biped rig (orc/frog/demonalt/yetialt)
const BIPED14: ClipMap = {
  idle: 'Idle', walk: 'Walk', run: 'Run', attack: ['Punch', 'Weapon'],
  hit: ['HitReact'], death: 'Death',
};

// 2023 enemy rig (goblin/giant)
const ENEMY7: ClipMap = {
  idle: 'Idle', walk: 'Walk', run: 'Run', attack: ['Attack'],
  hit: ['HitRecieve'], death: 'Death',
};

// floating/flying rigs (goleling/dragon) — hover instead of walking
const FLOATING: ClipMap = {
  idle: 'Flying_Idle', walk: 'Fast_Flying', run: 'Fast_Flying',
  attack: ['Headbutt', 'Punch'], hit: ['HitReact'], death: 'Death',
};

const SPIDER: ClipMap = {
  idle: 'Spider_Idle', walk: 'Spider_Walk', run: 'Spider_Walk',
  attack: ['Spider_Attack'], death: 'Spider_Death', // no hit-react in asset
};

// Chicken-cow rig (chicken_cow.glb, procedurally authored — see
// scripts/gen_chicken_cow.mjs). Node-transform animations, no hit-react.
const CHICKEN_COW: ClipMap = {
  idle: 'Idle', walk: 'Walk', run: 'Run',
  attack: ['Attack'], death: 'Death', jump: 'Jump',
};

// ---------------------------------------------------------------------------
// Asset urls
// ---------------------------------------------------------------------------

const PLAYERS = 'models/chars/players';
const ENEMIES = 'models/chars/enemies';
const CREATURES = 'models/creatures';
const WEAPONS = 'models/weapons';

const LOW_URL_ALIAS: Record<string, string> = {
  'models/chars/players/rogue_hooded.glb': 'models/chars/players/rogue.glb',
};

const HUMANOID_H = 2.6;

const SKINS_DIR = 'textures/skins';

// ---------------------------------------------------------------------------
// Combat Mech — a class-agnostic cosmetic body. Unlike the per-class skins
// below (which swap a body atlas onto an existing class rig), the mech is a
// SEPARATE model with its own visual key (`player_mech`) and a set of chroma
// textures grouped across the three skin-event rarity tiers. Epics additionally
// ship an emissive glow map. Cosmetic preview only for now — lazy-loaded via
// preloadMechAssets() so it never bloats every client's boot.
// ---------------------------------------------------------------------------
const MECH_DIR = `${PLAYERS}/Mech/textures`;

function mechChromaUrl(c: MechChroma): string {
  if (c.rank === 'uncommon') return `${MECH_DIR}/uncommon/combatmech_${c.id}.png`;
  if (c.rank === 'rare') return `${MECH_DIR}/rares/combatmech_rare_${c.id}.png`;
  return `${MECH_DIR}/epics/combatmech_epic_${c.id}.png`;
}
function mechEmissiveUrl(c: MechChroma): string | null {
  return c.rank === 'epic' ? `${MECH_DIR}/epics/combatmech_epic_${c.id}_emis.png` : null;
}

// Per-class alternate body textures ("skins"). Index 0 = null = the model's
// embedded default texture (no swap). Index >0 = a full-atlas alternate applied
// to the body material's .map (same UVs). Classes sharing a model share its skin
// set. Players only — mobs/npcs keep their default look. See public/textures/skins/.
export const SKINS: Record<string, (string | null)[]> = {
  player_warrior: [null, `${SKINS_DIR}/knight/alt_a.png`, `${SKINS_DIR}/knight/alt_b.png`, `${SKINS_DIR}/knight/alt_c.png`],
  player_paladin: [null, `${SKINS_DIR}/paladin/alt_a.png`],
  player_hunter: [null, `${SKINS_DIR}/ranger/alt_a.png`, `${SKINS_DIR}/ranger/alt_b.png`, `${SKINS_DIR}/ranger/alt_c.png`],
  player_rogue: [null, `${SKINS_DIR}/rogue/alt_a.png`, `${SKINS_DIR}/rogue/alt_b.png`, `${SKINS_DIR}/rogue/alt_c.png`],
  player_priest: [null, `${SKINS_DIR}/mage/alt_a.png`, `${SKINS_DIR}/mage/alt_b.png`, `${SKINS_DIR}/mage/alt_c.png`],
  player_mage: [null, `${SKINS_DIR}/mage/alt_a.png`, `${SKINS_DIR}/mage/alt_b.png`, `${SKINS_DIR}/mage/alt_c.png`],
  player_warlock: [null, `${SKINS_DIR}/mage/alt_a.png`, `${SKINS_DIR}/mage/alt_b.png`, `${SKINS_DIR}/mage/alt_c.png`],
  player_shaman: [null, `${SKINS_DIR}/barbarian/alt_a.png`, `${SKINS_DIR}/barbarian/alt_b.png`, `${SKINS_DIR}/barbarian/alt_c.png`],
  player_druid: [null, `${SKINS_DIR}/druid/alt_a.png`, `${SKINS_DIR}/druid/alt_b.png`, `${SKINS_DIR}/druid/alt_c.png`],
  // Combat Mech chromas — every index is a real full-model texture (no null
  // default; the embedded base texture is not one of the rewards).
  player_mech: MECH_CHROMAS.map(mechChromaUrl),
};

// Emissive (glow) maps keyed exactly like SKINS, applied to .emissiveMap when a
// skin index has one. Only the Combat Mech epics glow; null entries mean no glow.
export const SKIN_EMISSIVE: Record<string, (string | null)[]> = {
  player_mech: MECH_CHROMAS.map(mechEmissiveUrl),
};

/** Number of skins (including the default) available for a visual key — min 1. */
export function skinCount(key: string): number {
  return SKINS[key]?.length ?? 1;
}

/** Texture url to preview a skin option (default index 0 → the model's base.png). */
export function skinThumbUrl(key: string, index: number): string | null {
  const arr = SKINS[key];
  if (!arr || index < 0 || index >= arr.length) return null;
  if (arr[index]) return arr[index];
  const firstAlt = arr.find((u): u is string => !!u); // derive dir from an alt
  return firstAlt ? firstAlt.replace(/\/[^/]+$/, '/base.png') : null;
}

// ---------------------------------------------------------------------------
// The manifest
// ---------------------------------------------------------------------------

export const VISUALS: Record<string, VisualDef> = {
  // -- player classes ------------------------------------------------------
  player_warrior: {
    url: `${PLAYERS}/knight.glb`, height: HUMANOID_H,
    clips: kaykit(['1H_Melee_Attack_Chop', '1H_Melee_Attack_Slice_Diagonal']),
    show: ['Knight_Helmet', 'Knight_Cape'], // v2 knight dropped the built-in Badge_Shield mesh
    attach: [{ url: `${WEAPONS}/sword_1handed.glb`, bone: 'handslot.r' }],
  },
  player_paladin: {
    url: `${PLAYERS}/paladin.glb`, height: HUMANOID_H,
    clips: kaykit(['1H_Melee_Attack_Chop', '1H_Melee_Attack_Slice_Diagonal']),
    // dedicated paladin model (helmeted variant) — ships its own Cape + Helmet
    // meshes and texture, so no show-list/tint. Shield + paladin hammer arrive
    // in the weapons pass; the gripped axe holds the slot until then.
    attach: [{ url: `${WEAPONS}/axe_1handed.glb`, bone: 'handslot.r' }],
  },
  player_hunter: {
    url: `${PLAYERS}/ranger.glb`, height: HUMANOID_H,
    clips: kaykit(['2H_Ranged_Shoot']),
    // dedicated ranger model — the quiver is a built-in mesh, so it's no longer
    // a separate chest attachment
    attach: [{ url: `${WEAPONS}/crossbow_1handed.glb`, bone: 'handslot.r' }],
  },
  player_rogue: {
    url: `${PLAYERS}/rogue.glb`, height: HUMANOID_H,
    clips: kaykit(['Dualwield_Melee_Attack_Chop']),
    show: ['Rogue_Cape'],
    attach: [
      { url: `${WEAPONS}/dagger.glb`, bone: 'handslot.r' },
      { url: `${WEAPONS}/dagger.glb`, bone: 'handslot.l' },
    ],
  },
  player_priest: {
    url: `${PLAYERS}/mage.glb`, height: HUMANOID_H,
    clips: kaykit(['2H_Melee_Attack_Chop']),
    show: [],
    attach: [{ url: `${WEAPONS}/staff.glb`, bone: 'handslot.r' }],
    tint: 0xf0e9d6, tintStrength: 0.5,
  },
  player_shaman: {
    url: `${PLAYERS}/barbarian.glb`, height: HUMANOID_H,
    clips: kaykit(['1H_Melee_Attack_Chop', '1H_Melee_Attack_Slice_Diagonal']),
    show: ['Barbarian_BearHat'], // v2 barbarian renamed Hat→BearHat and dropped the round shield mesh
    attach: [{ url: `${WEAPONS}/axe_1handed.glb`, bone: 'handslot.r' }],
    tint: 0x6f8fc9, tintStrength: 0.4,
  },
  player_mage: {
    url: `${PLAYERS}/mage.glb`, height: HUMANOID_H,
    clips: kaykit(['2H_Melee_Attack_Chop']),
    // no Mage_Hat on players: the brim hides the whole body from the default
    // chase-camera pitch (NPC mages keep theirs — they're seen from the side)
    show: ['Mage_Cape'],
    attach: [{ url: `${WEAPONS}/staff.glb`, bone: 'handslot.r' }],
  },
  player_warlock: {
    url: `${PLAYERS}/mage.glb`, height: HUMANOID_H,
    clips: kaykit(['Spellcast_Shoot']), // wand zap reads better than a staff bonk
    show: [],
    attach: [
      { url: `${WEAPONS}/wand.glb`, bone: 'handslot.r' },
      { url: `${WEAPONS}/spellbook_open.glb`, bone: 'handslot.l', gripRef: 'Spellbook_open' },
    ],
    tint: 0x8d5fd3, tintStrength: 0.45,
  },
  player_druid: {
    url: `${PLAYERS}/druid.glb`, height: HUMANOID_H,
    clips: kaykit(['2H_Melee_Attack_Chop']),
    // dedicated druid model (own texture, ships a Backpack mesh)
    attach: [{ url: `${WEAPONS}/staff.glb`, bone: 'handslot.r' }],
  },

  // -- cosmetic body skin (class-agnostic; both the skin preview and a live
  //    player whose skinCatalog === 'mech', see visualKeyFor) ----------------
  player_mech: {
    url: `${PLAYERS}/Mech/characters/CombatMech.glb`, height: HUMANOID_H,
    // The mech is rigged to the same KayKit Rig_Medium skeleton as every other
    // player class; its GLB shipped with no clips, so the full KayKit set is
    // baked in from knight.glb (scripts/bake_mech_anims.mjs) — these names now
    // resolve like any other class. Lazy-loaded; see preloadMechAssets().
    clips: kaykit(['1H_Melee_Attack_Chop']),
    lazyPreload: true,
  },

  // -- forms ---------------------------------------------------------------
  form_sheep: {
    url: `${CREATURES}/alpaca.glb`, height: 1.2,
    clips: animal(['Attack_Headbutt']),
  },
  form_bear: {
    url: `${CREATURES}/yetialt.glb`, height: 2.4,
    clips: BIPED14, tint: 0x5a4030, tintStrength: 0.55,
  },
  form_cat: {
    url: `${CREATURES}/wolf.glb`, height: 1.6,
    clips: animal(['Attack']), tint: 0xd08b45, tintStrength: 0.35,
  },
  // Druid Travel Form: a daft chicken-cow hybrid (custom GLB). No tint — its
  // authored cow-spots/comb/beak colours carry the look.
  form_travel: {
    url: `${CREATURES}/chicken_cow.glb`, height: 2.3,
    clips: CHICKEN_COW,
  },

  // -- mob families --------------------------------------------------------
  mob_wolf: {
    url: `${CREATURES}/wolf.glb`, height: 1.6,
    clips: animal(['Attack']), tint: 'entity', tintStrength: 0.35,
  },
  mob_boar: {
    url: `${CREATURES}/wild_boar.glb`, height: 1.45,
    clips: WILD_BOAR, tint: 'entity', tintStrength: 0.4,
  },
  // Quaternius animal rig (shares clip names with wolf) — fox/deer/critters that
  // would otherwise fall back to mob_wolf via FAMILY_KEYS['beast'].
  mob_fox: {
    url: `${CREATURES}/fox.glb`, height: 1.0,
    clips: animal(['Attack']), tint: 'entity', tintStrength: 0.35,
  },
  // smaller silhouette of the same rig for ground critters (hares, badgers);
  // no dedicated rabbit/mustelid asset ships, so this is the closest small beast.
  mob_critter: {
    url: `${CREATURES}/fox.glb`, height: 0.7,
    clips: animal(['Attack']), tint: 'entity', tintStrength: 0.35,
  },
  mob_stag: {
    url: `${CREATURES}/stag.glb`, height: 1.9,
    clips: animal(['Attack_Headbutt', 'Attack']), tint: 'entity', tintStrength: 0.35,
  },
  // brown-tinted yeti rig, same recipe as the druid Bear form.
  mob_bear: {
    url: `${CREATURES}/yetialt.glb`, height: 2.2,
    clips: BIPED14, tint: 0x5a4030, tintStrength: 0.5,
  },
  mob_spider: {
    url: `${CREATURES}/spider.glb`, height: 1.4,
    clips: SPIDER, tint: 'entity', tintStrength: 0.35,
  },
  mob_murloc: {
    url: `${CREATURES}/frog.glb`, height: 1.7,
    clips: BIPED14, tint: 'entity', tintStrength: 0.45,
  },
  mob_kobold: {
    url: `${CREATURES}/goblin.glb`, height: 2.1,
    clips: ENEMY7, tint: 'entity', tintStrength: 0.2, // keep the green readable
  },
  mob_troll: {
    url: `${CREATURES}/orc.glb`, height: 2.4,
    // faint wash only — 0.35 flooded every material with the template green
    clips: BIPED14, tint: 'entity', tintStrength: 0.12,
  },
  mob_ogre: {
    url: `${CREATURES}/giant.glb`, height: 2.8,
    clips: ENEMY7, tint: 'entity', tintStrength: 0.2, // skin washes pink fast
  },
  mob_elemental: {
    url: `${CREATURES}/golelingevolved.glb`, height: 2.2, hover: 0.3,
    clips: FLOATING, tint: 'entity', tintStrength: 0.4,
  },
  mob_dragonkin: {
    url: `${CREATURES}/dragonevolved.glb`, height: 2.4, hover: 0.25,
    // light tint only — heavy washes crush the wyrm to black under the green
    // sanctum torchlight
    clips: FLOATING, tint: 'entity', tintStrength: 0.2,
  },
  // warlock demon pets (imp/voidwalker) — one biped rig, the entity colour and
  // the mob template's scale tell the little orange imp from the bulky voidwalker
  mob_demon: {
    url: `${CREATURES}/demonalt.glb`, height: 1.8,
    clips: BIPED14, tint: 'entity', tintStrength: 0.5,
  },
  mob_demon_flying: {
    url: `${CREATURES}/demon.glb`, height: 1.7, hover: 0.35,
    clips: FLOATING, tint: 'entity', tintStrength: 0.25,
  },
  mob_demonalt: {
    url: `${CREATURES}/demonalt.glb`, height: 2.1,
    clips: BIPED14, tint: 'entity', tintStrength: 0.35,
  },

  // -- undead (KayKit skeletons, shared 41-joint rig) ------------------------
  skel_minion: {
    url: `${ENEMIES}/skeleton_minion.glb`, height: 2.5,
    clips: skeletonClips(['1H_Melee_Attack_Chop', '1H_Melee_Attack_Slice_Diagonal']),
    tint: 'entity', tintStrength: 0.25,
  },
  skel_warrior: {
    url: `${ENEMIES}/skeleton_warrior.glb`, height: 2.5,
    clips: skeletonClips(['1H_Melee_Attack_Chop', '1H_Melee_Attack_Slice_Diagonal']),
    tint: 'entity', tintStrength: 0.25,
  },
  skel_rogue: {
    url: `${ENEMIES}/skeleton_rogue.glb`, height: 2.5,
    clips: skeletonClips(['1H_Melee_Attack_Chop', '1H_Melee_Attack_Slice_Diagonal']),
    tint: 'entity', tintStrength: 0.25,
  },
  skel_mage: {
    url: `${ENEMIES}/skeleton_mage.glb`, height: 2.5,
    clips: skeletonClips(['2H_Melee_Attack_Chop']),
    attach: [{ url: `${WEAPONS}/skeleton_staff.glb`, bone: 'handslot.r' }],
    tint: 'entity', tintStrength: 0.25,
  },
  skel_boss: {
    url: `${ENEMIES}/skeleton_mage.glb`, height: 2.5,
    clips: skeletonClips(['2H_Melee_Attack_Chop'], 'Taunt'),
    attach: [{ url: `${WEAPONS}/skeleton_staff.glb`, bone: 'handslot.r' }],
    tint: 'entity', tintStrength: 0.25,
  },
  skel_necromancer: {
    url: `${ENEMIES}/necromancer.glb`, height: 2.5,
    clips: skeletonClips(['2H_Melee_Attack_Chop']),
    tint: 'entity', tintStrength: 0.25,
  },
  skel_golem: {
    url: `${ENEMIES}/skeleton_golem.glb`, height: 3.4,
    clips: skeletonLargeClips(['2H_Melee_Attack_Chop', '1H_Melee_Attack_Chop']),
    // the baked golem axe ships without the 180° grip flip the rig expects, so
    // the blade faces backwards; spin it about its handle (local Y) to face out.
    weaponFix: [{ node: 'Skeleton_Golem_Axe', rotY: Math.PI }],
    tint: 'entity', tintStrength: 0.25,
  },

  // -- humanoid mobs (KayKit adventurers) ------------------------------------
  mob_bandit: {
    url: `${PLAYERS}/rogue_hooded.glb`, height: HUMANOID_H,
    clips: kaykit(['1H_Melee_Attack_Chop', 'Dualwield_Melee_Attack_Chop']),
    // v2 rogue_hooded ships the hood/mask/cape as its default look (no show
    // filter needed); the knives are attached dual-wield from the weapon files
    attach: [
      { url: `${WEAPONS}/dagger.glb`, bone: 'handslot.r' },
      { url: `${WEAPONS}/dagger.glb`, bone: 'handslot.l' },
    ],
    // fixed outlaw leather — entity tints (faction greens) read as friendly
    // villagers; the dark red-brown keeps the hooded silhouette hostile
    tint: 0x6b3a32, tintStrength: 0.3,
  },
  mob_dark_caster: {
    url: `${PLAYERS}/mage.glb`, height: HUMANOID_H,
    clips: kaykit(['2H_Melee_Attack_Chop']),
    show: ['Mage_Hat'],
    attach: [{ url: `${WEAPONS}/staff.glb`, bone: 'handslot.r' }],
    tint: 'entity', tintStrength: 0.5,
  },
  mob_bruiser: {
    url: `${PLAYERS}/barbarian.glb`, height: HUMANOID_H,
    clips: kaykit(['2H_Melee_Attack_Chop']),
    show: ['Barbarian_BearHat'], // v2 barbarian: Hat→BearHat, no Cape, weapon now attached
    attach: [{ url: `${WEAPONS}/axe_2handed.glb`, bone: 'handslot.r' }],
    tint: 'entity', tintStrength: 0.3,
  },

  // -- NPCs ------------------------------------------------------------------
  npc_knight: {
    url: `${PLAYERS}/knight.glb`, height: HUMANOID_H,
    clips: kaykit(['1H_Melee_Attack_Chop']),
    show: ['Knight_Helmet', 'Knight_Cape'],
    attach: [{ url: `${WEAPONS}/sword_1handed.glb`, bone: 'handslot.r' }],
  },
  npc_mage: {
    url: `${PLAYERS}/mage.glb`, height: HUMANOID_H,
    clips: kaykit(['2H_Melee_Attack_Chop']),
    show: [],
    attach: [{ url: `${WEAPONS}/staff.glb`, bone: 'handslot.r' }],
    tint: 0xc9b98a, tintStrength: 0.3, // brown-robed brothers of the chapel
  },
  // Brother Aldric keeps his pre-v0.7 model (the old chars/mage.glb, restored as
  // mage_classic.glb with the staff built into the mesh). Aldric-only — every
  // other npc_mage uses the new KayKit full-pack model from #396.
  npc_aldric: {
    url: `${PLAYERS}/mage_classic.glb`, height: HUMANOID_H,
    clips: kaykit(['2H_Melee_Attack_Chop']),
    show: ['2H_Staff'],
    tint: 0xc9b98a, tintStrength: 0.3,
  },
  npc_smith: {
    url: `${PLAYERS}/barbarian.glb`, height: HUMANOID_H,
    clips: kaykit(['1H_Melee_Attack_Chop']),
    show: [],
    attach: [{ url: `${WEAPONS}/axe_1handed.glb`, bone: 'handslot.r' }],
  },
  npc_scout: {
    url: `${PLAYERS}/rogue.glb`, height: HUMANOID_H,
    clips: kaykit(['2H_Ranged_Shoot']),
    show: ['Rogue_Cape'],
    attach: [{ url: `${WEAPONS}/crossbow_1handed.glb`, bone: 'handslot.r' }],
  },
  npc_villager: {
    url: `${PLAYERS}/rogue.glb`, height: HUMANOID_H,
    clips: kaykit(['1H_Melee_Attack_Chop']),
    show: [],
    tint: 'entity', tintStrength: 0.35,
  },
  npc_villager_robed: {
    url: `${PLAYERS}/mage.glb`, height: HUMANOID_H,
    clips: kaykit(['2H_Melee_Attack_Chop']),
    show: [],
    tint: 'entity', tintStrength: 0.35,
  },
};

// ---------------------------------------------------------------------------
// Dispatch: entity -> visual key (mirrors the old buildRigFor selection:
// e.kind + e.templateId + MOBS[id].family)
// ---------------------------------------------------------------------------

const MOB_KEYS: Record<string, string> = {
  imp: 'mob_demon',
  voidwalker: 'mob_demon',
  succubus: 'mob_demon',
  warlock_imp: 'mob_demon_flying',
  warlock_voidwalker: 'mob_demonalt',
  wild_boar: 'mob_boar',
  elder_bristleback: 'mob_boar',
  grovetusk_boar: 'mob_boar',
  // beasts that would otherwise fall back to the wolf model (FAMILY_KEYS.beast)
  glade_fox: 'mob_fox',
  brightwood_hare: 'mob_critter',
  thornpelt_badger: 'mob_critter',
  spotted_fawn: 'mob_stag',
  dawnmane_doe: 'mob_stag',
  brightwood_stag: 'mob_stag',
  brightwood_monarch: 'mob_stag',
  sunhide_bear: 'mob_bear',
  old_cragmaw: 'mob_bear',
  bog_bloat: 'mob_murloc',
  // gravecaller cult + necromancers: dark-robed casters
  gravecaller_cultist: 'mob_dark_caster',
  gravecaller_summoner: 'mob_dark_caster',
  sister_nhalia: 'mob_dark_caster',
  deacon_voss: 'mob_dark_caster',
  wyrmcult_necromancer: 'mob_dark_caster',
  vael_the_mistcaller: 'mob_dark_caster',
  grand_necromancer_velkhar: 'mob_dark_caster',
  gorrak: 'mob_bruiser',
  mogger: 'mob_bruiser',
  // undead variants by role
  boneclad_revenant: 'skel_warrior',
  marrowlord_varkas: 'skel_warrior',
  bastion_revenant: 'skel_warrior',
  knight_commander_olen: 'skel_warrior',
  sanctum_boneguard: 'skel_warrior',
  nythraxis_scourge_of_thornpeak: 'skel_golem',
  nythraxis_skeleton_warrior: 'skel_warrior',
  brother_aldric_raid: 'npc_aldric',
  hollow_acolyte: 'skel_mage',
  sexton_marrow: 'skel_mage',
  morthen: 'skel_boss',
  crypt_shambler: 'skel_rogue',
  fallen_captain_aldren: 'skel_warrior',
  corrupted_priest_malric: 'skel_necromancer',
  deathstalker_voss: 'skel_rogue',
  vision_aldren_warrior: 'player_warrior',
  vision_malric_mage: 'player_mage',
  vision_deathstalker_voss: 'player_rogue',
};

const FAMILY_KEYS: Record<string, string> = {
  beast: 'mob_wolf',
  humanoid: 'mob_bandit',
  murloc: 'mob_murloc',
  spider: 'mob_spider',
  kobold: 'mob_kobold',
  undead: 'skel_minion',
  troll: 'mob_troll',
  ogre: 'mob_ogre',
  elemental: 'mob_elemental',
  dragonkin: 'mob_dragonkin',
  demon: 'mob_demonalt',
};

const NPC_KEYS: Record<string, string> = {
  marshal_redbrook: 'npc_knight',
  warden_fenwick: 'npc_knight',
  captain_thessaly: 'npc_knight',
  loremaster_caddis: 'npc_mage',
  smith_haldren: 'npc_smith',
  armorer_hode: 'npc_smith',
  foreman_odell: 'npc_smith',
  scout_maren: 'npc_scout',
  scout_maren_highwatch: 'npc_scout',
  apothecary_lin: 'npc_villager_robed',
  herbalist_yara: 'npc_villager_robed',
  trader_wilkes: 'npc_villager',
  fisherman_brandt: 'npc_villager',
  provisioner_hale: 'npc_villager',
  quartermaster_bree: 'npc_villager',
};

export function visualKeyFor(e: Entity): string {
  if (e.kind === 'player') {
    if (e.skinCatalog === 'mech') return 'player_mech';
    return VISUALS[`player_${e.templateId}`] ? `player_${e.templateId}` : 'player_warrior';
  }
  if (e.kind === 'mob') {
    const override = MOB_KEYS[e.templateId];
    if (override) return override;
    const family = MOBS[e.templateId]?.family;
    return (family && FAMILY_KEYS[family]) || 'mob_bandit';
  }
  // npcs — Brother Aldric recurs in every hub under suffixed ids
  if (e.templateId.startsWith('brother_aldric')) return 'npc_aldric';
  return NPC_KEYS[e.templateId] ?? 'npc_villager';
}

/** Every glb the manifest can reference (for preloading). */
export function manifestUrls(): string[] {
  const urls = new Set<string>();
  for (const def of Object.values(VISUALS)) {
    if (def.lazyPreload) continue; // fetched on demand, not at boot
    urls.add(def.url);
    for (const url of def.animUrls ?? []) urls.add(url);
    for (const a of def.attach ?? []) urls.add(a.url);
  }
  return [...urls];
}

export function visualAssetUrlForGraphics(url: string, standardMaterials: boolean): string {
  return standardMaterials ? url : (LOW_URL_ALIAS[url] ?? url);
}

export function manifestUrlsForGraphics(standardMaterials: boolean): string[] {
  return [...new Set(manifestUrls().map((url) => visualAssetUrlForGraphics(url, standardMaterials)))];
}

export function visibleAttachmentsForGraphics(def: Pick<VisualDef, 'attach'>): readonly AttachDef[] {
  return def.attach ?? [];
}
