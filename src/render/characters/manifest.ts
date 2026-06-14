// Visual manifest: maps every sim identity (player class, mob template/family,
// NPC id, druid/polymorph form) onto a rigged glTF asset + clip names + kit.
// Pure data + dispatch — no three.js imports, no loading.
import type { Entity } from '../../sim/types';
import { MOBS } from '../../sim/data';

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
  walkBack?: string;
  /** one-shot played on respawn (skeleton awaken / boss taunt) */
  flourish?: string;
}

export interface AttachDef {
  url: string;
  bone: string;
  position?: [number, number, number];
  rotationY?: number;
}

export interface VisualDef {
  url: string;
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
}

// ---------------------------------------------------------------------------
// Clip sets per source rig family
// ---------------------------------------------------------------------------

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
});

const skeletonClips = (attack: string[], flourish = 'Skeletons_Awaken_Standing'): ClipMap => ({
  ...kaykit(attack, 'Idle_Combat'),
  flourish,
});

// Quaternius 2021 animal rig (wolf/bull/alpaca/fox/stag)
const animal = (attack: string[]): ClipMap => ({
  idle: 'Idle', walk: 'Walk', run: 'Gallop', attack,
  hit: ['Idle_HitReact_Left', 'Idle_HitReact_Right'], death: 'Death',
});

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

// ---------------------------------------------------------------------------
// Asset urls
// ---------------------------------------------------------------------------

const CHARS = 'models/chars';
const CREATURES = 'models/creatures';
const WEAPONS = 'models/weapons';

const HUMANOID_H = 2.6;

// ---------------------------------------------------------------------------
// The manifest
// ---------------------------------------------------------------------------

export const VISUALS: Record<string, VisualDef> = {
  // -- player classes ------------------------------------------------------
  player_warrior: {
    url: `${CHARS}/knight.glb`, height: HUMANOID_H,
    clips: kaykit(['1H_Melee_Attack_Chop', '1H_Melee_Attack_Slice_Diagonal']),
    show: ['1H_Sword', 'Badge_Shield', 'Knight_Helmet', 'Knight_Cape'],
  },
  player_paladin: {
    url: `${CHARS}/knight.glb`, height: HUMANOID_H,
    clips: kaykit(['1H_Melee_Attack_Chop', '1H_Melee_Attack_Slice_Diagonal']),
    show: ['Round_Shield', 'Knight_Helmet', 'Knight_Cape'],
    attach: [{ url: `${WEAPONS}/axe_1handed.glb`, bone: 'handslot.r' }],
    tint: 0xe3c06a, tintStrength: 0.5,
  },
  player_hunter: {
    url: `${CHARS}/barbarian.glb`, height: HUMANOID_H,
    clips: kaykit(['2H_Ranged_Shoot']),
    show: ['Barbarian_Cape'],
    attach: [
      { url: `${WEAPONS}/crossbow_2handed.glb`, bone: 'handslot.r' },
      { url: `${WEAPONS}/quiver.glb`, bone: 'chest', position: [0, 0.05, -0.28], rotationY: Math.PI },
    ],
  },
  player_rogue: {
    url: `${CHARS}/rogue.glb`, height: HUMANOID_H,
    clips: kaykit(['Dualwield_Melee_Attack_Chop']),
    show: ['Knife', 'Knife_Offhand', 'Rogue_Cape'],
  },
  player_priest: {
    url: `${CHARS}/mage.glb`, height: HUMANOID_H,
    clips: kaykit(['2H_Melee_Attack_Chop']),
    show: ['2H_Staff'],
    tint: 0xf0e9d6, tintStrength: 0.5,
  },
  player_shaman: {
    url: `${CHARS}/barbarian.glb`, height: HUMANOID_H,
    clips: kaykit(['1H_Melee_Attack_Chop', '1H_Melee_Attack_Slice_Diagonal']),
    show: ['1H_Axe', 'Barbarian_Round_Shield', 'Barbarian_Hat'],
    tint: 0x6f8fc9, tintStrength: 0.4,
  },
  player_mage: {
    url: `${CHARS}/mage.glb`, height: HUMANOID_H,
    clips: kaykit(['2H_Melee_Attack_Chop']),
    // no Mage_Hat on players: the brim hides the whole body from the default
    // chase-camera pitch (NPC mages keep theirs — they're seen from the side)
    show: ['2H_Staff', 'Mage_Cape'],
  },
  player_warlock: {
    url: `${CHARS}/mage.glb`, height: HUMANOID_H,
    clips: kaykit(['Spellcast_Shoot']), // wand zap reads better than a staff bonk
    show: ['1H_Wand', 'Spellbook_open'],
    tint: 0x8d5fd3, tintStrength: 0.45,
  },
  player_druid: {
    url: `${CHARS}/mage.glb`, height: HUMANOID_H,
    clips: kaykit(['2H_Melee_Attack_Chop']),
    show: ['2H_Staff'],
    tint: 0x7da05c, tintStrength: 0.45,
  },

  // -- forms ---------------------------------------------------------------
  form_sheep: {
    url: `${CREATURES}/alpaca.glb`, height: 1.2,
    clips: animal(['Attack_Headbutt']),
  },
  form_bear: {
    url: `${CREATURES}/yetialt.glb`, height: 1.9,
    clips: BIPED14, tint: 0x5a4030, tintStrength: 0.55,
  },
  form_ghost_wolf: {
    url: `${CREATURES}/wolf.glb`, height: 1.6,
    clips: animal(['Attack']), tint: 0x9fb8c8, tintStrength: 0.6,
  },

  // -- mob families --------------------------------------------------------
  mob_wolf: {
    url: `${CREATURES}/wolf.glb`, height: 1.6,
    clips: animal(['Attack']), tint: 'entity', tintStrength: 0.35,
  },
  mob_boar: {
    url: `${CREATURES}/bull.glb`, height: 1.45,
    clips: animal(['Attack_Headbutt']), tint: 'entity', tintStrength: 0.4,
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

  // -- undead (KayKit skeletons, shared 41-joint rig) ------------------------
  skel_minion: {
    url: `${CHARS}/skeleton_minion.glb`, height: 2.5,
    clips: skeletonClips(['1H_Melee_Attack_Chop', '1H_Melee_Attack_Slice_Diagonal']),
    tint: 'entity', tintStrength: 0.25,
  },
  skel_warrior: {
    url: `${CHARS}/skeleton_warrior.glb`, height: 2.5,
    clips: skeletonClips(['1H_Melee_Attack_Chop', '1H_Melee_Attack_Slice_Diagonal']),
    attach: [
      { url: `${WEAPONS}/skeleton_blade.glb`, bone: 'handslot.r' },
      { url: `${WEAPONS}/skeleton_shield_large_a.glb`, bone: 'handslot.l' },
    ],
    tint: 'entity', tintStrength: 0.25,
  },
  skel_rogue: {
    url: `${CHARS}/skeleton_rogue.glb`, height: 2.5,
    clips: skeletonClips(['1H_Melee_Attack_Chop', '1H_Melee_Attack_Slice_Diagonal']),
    attach: [{ url: `${WEAPONS}/skeleton_axe.glb`, bone: 'handslot.r' }],
    tint: 'entity', tintStrength: 0.25,
  },
  skel_mage: {
    url: `${CHARS}/skeleton_mage.glb`, height: 2.5,
    clips: skeletonClips(['2H_Melee_Attack_Chop']),
    attach: [{ url: `${WEAPONS}/skeleton_staff.glb`, bone: 'handslot.r' }],
    tint: 'entity', tintStrength: 0.25,
  },
  skel_boss: {
    url: `${CHARS}/skeleton_mage.glb`, height: 2.5,
    clips: skeletonClips(['2H_Melee_Attack_Chop'], 'Taunt'),
    attach: [{ url: `${WEAPONS}/skeleton_staff.glb`, bone: 'handslot.r' }],
    tint: 'entity', tintStrength: 0.25,
  },

  // -- humanoid mobs (KayKit adventurers) ------------------------------------
  mob_bandit: {
    url: `${CHARS}/rogue_hooded.glb`, height: HUMANOID_H,
    clips: kaykit(['1H_Melee_Attack_Chop', 'Dualwield_Melee_Attack_Chop']),
    show: ['Knife', 'Knife_Offhand'],
    // fixed outlaw leather — entity tints (faction greens) read as friendly
    // villagers; the dark red-brown keeps the hooded silhouette hostile
    tint: 0x6b3a32, tintStrength: 0.3,
  },
  mob_dark_caster: {
    url: `${CHARS}/mage.glb`, height: HUMANOID_H,
    clips: kaykit(['2H_Melee_Attack_Chop']),
    show: ['2H_Staff', 'Mage_Hat'],
    tint: 'entity', tintStrength: 0.5,
  },
  mob_bruiser: {
    url: `${CHARS}/barbarian.glb`, height: HUMANOID_H,
    clips: kaykit(['2H_Melee_Attack_Chop']),
    show: ['2H_Axe', 'Barbarian_Hat', 'Barbarian_Cape'],
    tint: 'entity', tintStrength: 0.3,
  },

  // -- NPCs ------------------------------------------------------------------
  npc_knight: {
    url: `${CHARS}/knight.glb`, height: HUMANOID_H,
    clips: kaykit(['1H_Melee_Attack_Chop']),
    show: ['1H_Sword', 'Knight_Helmet', 'Knight_Cape'],
  },
  npc_mage: {
    url: `${CHARS}/mage.glb`, height: HUMANOID_H,
    clips: kaykit(['2H_Melee_Attack_Chop']),
    show: ['2H_Staff'],
    tint: 0xc9b98a, tintStrength: 0.3, // brown-robed brothers of the chapel
  },
  npc_smith: {
    url: `${CHARS}/barbarian.glb`, height: HUMANOID_H,
    clips: kaykit(['1H_Melee_Attack_Chop']),
    show: ['1H_Axe'],
  },
  npc_scout: {
    url: `${CHARS}/rogue.glb`, height: HUMANOID_H,
    clips: kaykit(['2H_Ranged_Shoot']),
    show: ['1H_Crossbow', 'Rogue_Cape'],
  },
  npc_villager: {
    url: `${CHARS}/rogue.glb`, height: HUMANOID_H,
    clips: kaykit(['1H_Melee_Attack_Chop']),
    show: [],
    tint: 'entity', tintStrength: 0.35,
  },
  npc_villager_robed: {
    url: `${CHARS}/mage.glb`, height: HUMANOID_H,
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
  wild_boar: 'mob_boar',
  elder_bristleback: 'mob_boar',
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
  hollow_acolyte: 'skel_mage',
  sexton_marrow: 'skel_mage',
  morthen: 'skel_boss',
  crypt_shambler: 'skel_rogue',
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
    return VISUALS[`player_${e.templateId}`] ? `player_${e.templateId}` : 'player_warrior';
  }
  if (e.kind === 'mob') {
    const override = MOB_KEYS[e.templateId];
    if (override) return override;
    const family = MOBS[e.templateId]?.family;
    return (family && FAMILY_KEYS[family]) || 'mob_bandit';
  }
  // npcs — Brother Aldric recurs in every hub under suffixed ids
  if (e.templateId.startsWith('brother_aldric')) return 'npc_mage';
  return NPC_KEYS[e.templateId] ?? 'npc_villager';
}

/** Every glb the manifest can reference (for preloading). */
export function manifestUrls(): string[] {
  const urls = new Set<string>();
  for (const def of Object.values(VISUALS)) {
    urls.add(def.url);
    for (const a of def.attach ?? []) urls.add(a.url);
  }
  return [...urls];
}
