// Visual manifest: maps every sim identity (player class, mob template/family,
// NPC id, druid/polymorph form) onto a rigged glTF asset + clip names + kit.
// Pure data + dispatch — no three.js imports, no loading.

import { MECH_CHROMAS, type MechChroma } from '../../sim/content/skins';
import { offhandMirrorsWeaponSkin } from '../../sim/content/weapon_skin_rules';
import { WEAPON_SKINS } from '../../sim/content/weapon_skins';
import { ITEMS, MOBS } from '../../sim/data';
import type { Entity, PlayerClass } from '../../sim/types';
import { ITEM_WEAPON_VARIANTS } from '../../ui/weapon_variants';
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
  /** Optional per-ability swing or cast-gesture override. */
  attackByAbility?: Record<string, string>;
  /** Optional weapon-style override for plain auto attacks. */
  attackByHand?: { twohand?: string; dualwield?: string };
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
  /** Touchdown one-shot. Naming one opts the rig into the held-jump treatment:
   *  `jump` stops looping and CLAMPS on its last frame (its airborne pose) for
   *  however long the body stays off the ground, then this fires on the landing
   *  edge. A rig without it keeps looping `jump` exactly as before. */
  land?: string;
  walkBack?: string;
  /** one-shot played on respawn (skeleton awaken / boss taunt) */
  flourish?: string;
  /** arm gesture for the Z-key sheathe toggle; the held-prop swap lands at its
   *  midpoint (see visual.ts setWeaponStowed). Absent = snap with no gesture. */
  stow?: string;
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
  /** Indices into `attach` whose model is replaced by the entity's equipped mainhand
   *  weapon (mapped via ITEM_WEAPON_VARIANTS). undefined/empty = the held weapon never
   *  changes with gear (hunter keeps its crossbow; mobs/NPCs are fixed). A fixed
   *  offhand left off this list stays authored (the warlock spellbook); a live
   *  equipped offhand uses `offhandSlot` below. */
  weaponSlots?: number[];
  /** Index into `attach` replaced by the entity's actual equipped offhand. Kept
   *  separate from `weaponSlots` so mainhand cosmetics cannot overwrite a live
   *  shield or second weapon. */
  offhandSlot?: number;
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
  /** Glowing ring parented behind the head bone (the priest's Light halo).
   *  Value is the glow color; geometry/placement live in halo.ts. */
  halo?: number;
  /** Halo placement overrides, head-bone space (defaults in halo.ts): lift
   *  above the bone and ring radius, for models whose headgear the default
   *  ring would clip. */
  haloUpOffset?: number;
  haloRadius?: number;
  /** Two-state prop mob (the dragonkin egg): the GLB ships BOTH state meshes
   *  seated at the origin; alive shows `hide` only, and death swaps to `show`
   *  (the cracked-open shell IS the corpse). assembleModel seeds the alive
   *  state; CharacterVisual's enterDeath/revive flip it. Node names as
   *  authored in the GLB. */
  corpseMeshSwap?: { hide: string; show: string };
}

/** The slice of a VisualDef that decides how held weapons attach (which bones, and
 *  which slots swap to the equipped item). Lets a cosmetic body adopt a different
 *  class's hand layout without cloning the whole def. */
export type WeaponLayoutOverride = Pick<VisualDef, 'attach' | 'weaponSlots' | 'offhandSlot'>;

// ---------------------------------------------------------------------------
// Clip sets per source rig family
// ---------------------------------------------------------------------------

const KAYKIT_EMOTES: Partial<Record<OverheadEmoteId, EmoteClipSpec>> = {
  wave: { clips: ['Spellcast_Raise', 'Cheer'], timeScale: 0.9 },
  laugh: { clips: ['Hit_A', 'Cheer'], timeScale: 1.45, repeats: 2 },
  question: { clips: ['Block', 'Spellcast_Raise'], timeScale: 1.15 },
  cheer: { clips: ['Cheer'], timeScale: 1.05, repeats: 2 },
  dance: {
    clips: ['Running_Strafe_Left', 'Running_Strafe_Right', 'Cheer'],
    timeScale: 1.05,
    repeats: 2,
  },
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
  // The trimmed player GLBs ship no dedicated sheathe clip; the 1H chop WINDUP
  // (the clip's first ~40%, cut at the swap point by visual.ts) reaches over the
  // shoulder toward the back, which reads as grabbing/planting the hilt.
  stow: '1H_Melee_Attack_Chop',
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
  idle: 'Idle',
  walk: 'Walk',
  run: 'Gallop',
  attack,
  hit: ['Idle_HitReact_Left', 'Idle_HitReact_Right'],
  death: 'Death',
});

// Rideable mounts. The Tripo-lane rigs (bear, toad, griffin) ship clips baked
// locally by scripts/bake_mount_gaits.mjs (the Tripo quadruped retarget was
// near-static, 4-5 animated joints), which authors Idle/Walk/Run/Death gait
// cycles directly against each rig's bind pose. The horse and the gobbler
// ship AUTHORED clips from their source models, renamed to these same four
// names at import time. The clipless prop-lane mounts resolve no actions from
// this map and rest in their generated standing pose (procedural bob in
// src/render/mount_visuals.ts). No attack one-shots: the RIDER swings, the
// mount does not.
const MOUNT_RIGGED: ClipMap = {
  idle: 'Idle',
  walk: 'Walk',
  run: 'Run',
  attack: [],
  death: 'Death',
};

// The Drakelands dragonkin brood (tmp/dragonkin_build.mjs bakes): artist
// clips on the 25-bone mixamorig core. Run reuses the walk cycle (the rigs
// ship no separate sprint; visual timeScale matching covers the chase). The
// broodlord's specials resolve per mechanic: FireBreath rides the cast slot
// (breathCone shows a real bar), Cleave/Stun ride attackByAbility off the
// 'windup' spellfx ability ids, and Shout is the flourish one-shot the
// 'shout'/'flourish' spellfx cues play.
const DRAGONKIN_BROODLORD: ClipMap = {
  idle: 'Idle',
  walk: 'Walk',
  run: 'Run',
  attack: ['Attack'],
  attackByAbility: { brood_cleave: 'Cleave', brood_stun: 'Stun' },
  death: 'Death',
  cast: 'FireBreath',
  flourish: 'Shout',
};
const DRAGONKIN_BROODGUARD: ClipMap = {
  idle: 'Idle',
  walk: 'Walk',
  run: 'Run',
  attack: ['Attack'],
  death: 'Death',
  flourish: 'Shout',
};
const DRAGONKIN_WHELP: ClipMap = {
  idle: 'Idle',
  walk: 'Walk',
  run: 'Run',
  attack: ['JumpAttack'],
  death: 'Death',
  flourish: 'JumpAttack',
};
// Grubjaw the Glutton (the Mirefen Marsh rare): his own Tripo sculpt on the
// 25-bone mixamorig core, auto-skinned by tmp/grubjaw_build.mjs. Two authored
// swings rotate per attack (a bare Punch and the bigger WeaponA haymaker);
// Death is a synthesized hips topple, since the drop ships no death clip.
const GRUBJAW: ClipMap = {
  idle: 'Idle',
  walk: 'Walk',
  run: 'Run',
  attack: ['Punch', 'WeaponA'],
  death: 'Death',
};

// Clipless two-state prop mobs (the dragonkin egg): the GLB ships NO clips, so
// every action() lookup misses harmlessly (fadeTo null-guards) and the mesh
// just stands; state changes are mesh-visibility swaps
// (VisualDef.corpseMeshSwap), not clips. Names the nominal 'Idle' throughout
// and registers in CLIPLESS_RIGS (tests/character_clipmaps.test.ts), the same
// contract mob_spider_egg_sac holds: that registration is what exempts a
// clip-less prop from the per-clip and far-LOD bake guards.
const STATIC_PROP: ClipMap = {
  idle: 'Idle',
  walk: 'Idle',
  run: 'Idle',
  attack: ['Idle'],
  death: 'Idle',
};

// Custom baked wolf rig (wolf_basic/greyjaw, Dog_Animation donor skeleton): the
// animal() core plus the donor's Sit/Fall clips so player wolf forms sit and
// jump properly, and a Walk swim base (a paddling gait at the gentle clip
// pitch beats the steep no-clip procedural prone on a quadruped).
const WOLF_BAKED: ClipMap = {
  ...animal(['Attack']),
  sitIdle: 'Sit',
  swim: 'Walk',
  jump: 'Fall',
};

// Druid Bear Form: a purpose-built quadruped rig (29 deform bones; the gaits are
// authored as IK foot paths, so walkRef/runRef below are MEASURED off the clips
// rather than guessed). Jump/Land are a pair: `land` opts the rig into the held
// airborne treatment (see ClipMap.land).
//
// It deliberately names no `cast`, no `emote` and no `attackByAbility`. Bear-form
// abilities are instant, and the ability-VFX painter gates its ceremonial cast
// gesture on an authored per-ability clip (hasGestureClip) while the cast base
// state falls back to idle without a `cast` clip. Leaving all three out is what
// keeps an instant cast from firing a swipe; real attacks still resolve `attack`.
const BEAR_FORM: ClipMap = {
  idle: 'Idle',
  walk: 'Walk',
  run: 'Run',
  attack: ['Attack'],
  hit: ['Hit'],
  death: 'Death',
  jump: 'Jump',
  land: 'Land',
  sitIdle: 'Sit',
  // a paddling walk beats the steep no-clip procedural prone on a quadruped,
  // the same call the wolf forms make
  swim: 'Walk',
};

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
  idle: 'Idle',
  walk: 'Walk',
  run: 'Run',
  attack: ['Punch', 'Weapon'],
  hit: ['HitReact'],
  death: 'Death',
};

// Tripo biped rig. These creatures come through the current biped
// pipeline, which retargets and bakes the complete game vocabulary directly.
const TRIPO_BIPED_FULL_RIG: ClipMap = {
  idle: 'Idle',
  walk: 'Walk',
  run: 'Run',
  attack: ['Attack'],
  hit: ['Hit'],
  death: 'Death',
  cast: 'Cast',
  jump: 'Jump',
};

// 2023 enemy rig (goblin/giant)
const ENEMY7: ClipMap = {
  idle: 'Idle',
  walk: 'Walk',
  run: 'Run',
  attack: ['Attack'],
  hit: ['HitRecieve'],
  death: 'Death',
};

// floating/flying rigs (goleling/dragon) — hover instead of walking
const FLOATING: ClipMap = {
  idle: 'Flying_Idle',
  walk: 'Fast_Flying',
  run: 'Fast_Flying',
  attack: ['Headbutt', 'Punch'],
  hit: ['HitReact'],
  death: 'Death',
};

// 2023 enemy rig variant with a bite attack and no run clip (yeti)
const ENEMY_BITE: ClipMap = {
  idle: 'Idle',
  walk: 'Walk',
  run: 'Walk',
  attack: ['Bite_Front'],
  hit: ['HitRecieve'],
  death: 'Death',
};

// Procedurally authored Water Elemental. Node transforms ripple its layered
// translucent body and drive the hands through the Waterbolt casting motion.
const WATER_ELEMENTAL: ClipMap = {
  idle: 'Idle',
  walk: 'Move',
  run: 'Move',
  // Waterbolt uses the short one-shot Cast attack; Water Jet holds this
  // dedicated forward-arms loop for its full server-authoritative channel.
  cast: 'Channel',
  attack: ['Cast'],
  hit: ['Hit'],
  death: 'Death',
};

const SPIDER: ClipMap = {
  idle: 'Spider_Idle',
  walk: 'Spider_Walk',
  run: 'Spider_Walk',
  attack: ['Spider_Attack'],
  death: 'Spider_Death', // no hit-react in asset
};

// Velociraptor rig (velociraptor.glb): like the spider, no hit-react clips
const RAPTOR: ClipMap = {
  idle: 'Velociraptor_Idle',
  walk: 'Velociraptor_Walk',
  run: 'Velociraptor_Run',
  attack: ['Velociraptor_Attack'],
  death: 'Velociraptor_Death',
};

// Chicken-cow rig (chicken_cow.glb, procedurally authored — see
// scripts/gen_chicken_cow.mjs). Node-transform animations, no hit-react.
const CHICKEN_COW: ClipMap = {
  idle: 'Idle',
  walk: 'Walk',
  run: 'Run',
  attack: ['Attack'],
  death: 'Death',
  jump: 'Jump',
};

// Raid 02 asset-pipeline rig (stone_cantor.glb): Mixamo-rigged, ships
// Idle / Cast / Walk / Death plus a synthesized 'Hit' flinch authored by
// scripts/_add_cantor_hit_anim.mjs (the batch has no hit-react take). A
// caster, so attack aliases the cast clip; run aliases walk (no run clip).
const RAID_CASTER: ClipMap = {
  idle: 'Idle',
  walk: 'Walk',
  run: 'Walk',
  attack: ['Cast'],
  cast: 'Cast',
  hit: ['Hit'],
  death: 'Death',
};

// Tolling Bell rig (tolling_bell.glb, Meshy-generated + node-transform animated
// via scripts/_add_bell_anim.mjs, no skeleton). Non-combat, hostile:false, moved
// manually by the boss driver every tick, so walk/run/attack/death are never
// reached: they just alias the two real clips to satisfy ClipMap.
const TOLLING_BELL: ClipMap = {
  idle: 'Idle',
  walk: 'Roll',
  run: 'Roll',
  attack: [],
  death: 'Idle',
};

// ---------------------------------------------------------------------------
// Asset urls
// ---------------------------------------------------------------------------

const PLAYERS = 'models/chars/players';
const ENEMIES = 'models/chars/enemies';
const CREATURES = 'models/creatures';
const WEAPONS = 'models/weapons';
const MOUNTS_DIR = 'models/mounts';

const ITEM_OFFHAND_MODELS: Readonly<Record<string, string>> = {
  eastbrook_buckler: 'shield_round',
  highwatch_wallshield: 'shield_square',
  bonewrought_bulwark: 'shield_square',
  pearlward_aegis: 'shield_round', // the first caster (int/spi) shield
};

function itemModelKey(
  itemId: string | null | undefined,
  extra: Readonly<Record<string, string>> = {},
): string | null {
  if (!itemId) return null;
  const direct = Object.hasOwn(ITEM_WEAPON_VARIANTS, itemId)
    ? ITEM_WEAPON_VARIANTS[itemId]
    : undefined;
  const directExtra = Object.hasOwn(extra, itemId) ? extra[itemId] : undefined;
  if (direct || directExtra) return direct ?? directExtra ?? null;

  const item = Object.hasOwn(ITEMS, itemId) ? ITEMS[itemId] : undefined;
  const baseId = item?.heroicOf;
  if (!baseId) return null;
  const inherited = Object.hasOwn(ITEM_WEAPON_VARIANTS, baseId)
    ? ITEM_WEAPON_VARIANTS[baseId]
    : undefined;
  const inheritedExtra = Object.hasOwn(extra, baseId) ? extra[baseId] : undefined;
  return inherited ?? inheritedExtra ?? null;
}

/** GLB url for an equipped mainhand item's held weapon model, or null if the item
 *  has no mapped model (then the class default attach is kept). Mirrors the bag
 *  icon via the shared ITEM_WEAPON_VARIANTS map, so held weapon == inventory icon. */
export function itemWeaponModelUrl(itemId: string | null | undefined): string | null {
  const key = itemModelKey(itemId);
  return key ? `${WEAPONS}/${key}.glb` : null;
}

/** GLB url for an actual equipped offhand. One-handed weapons reuse the shared
 *  inventory/held-model map; shields use the narrow render-only table above. */
export function itemOffhandModelUrl(itemId: string | null | undefined): string | null {
  const key = itemModelKey(itemId, ITEM_OFFHAND_MODELS);
  return key ? `${WEAPONS}/${key}.glb` : null;
}

/** GLB url the offhand slot should render: the active weapon skin's model when it
 *  mirrors onto a matching-type offhand weapon (a rogue's second dagger
 *  under a dagger skin), otherwise the equipped offhand item's own model. A shield,
 *  held offhand (orb/tome), or different-type offhand weapon never mirrors, so it
 *  keeps its item model; null when the offhand has no mapped model. The mirror
 *  decision is the pure sim rule, so server and clients agree on both hands. */
export function offhandModelUrl(
  offhandItemId: string | null | undefined,
  weaponSkinId: string | null | undefined,
): string | null {
  if (offhandMirrorsWeaponSkin(weaponSkinId, offhandItemId)) {
    return weaponSkinModelUrl(weaponSkinId);
  }
  return itemOffhandModelUrl(offhandItemId);
}

/** Distinct held-weapon GLB urls (one per variant), for the boot preload sweep so
 *  setWeapon can attach any equipped weapon synchronously (resolvedGltf throws on
 *  an un-preloaded url). */
export function itemWeaponModelUrls(): string[] {
  return [...new Set(Object.values(ITEM_WEAPON_VARIANTS).map((key) => `${WEAPONS}/${key}.glb`))];
}

function itemOffhandModelUrls(): string[] {
  return [...new Set(Object.values(ITEM_OFFHAND_MODELS).map((key) => `${WEAPONS}/${key}.glb`))];
}

/** GLB url for a Season 1 Armory weapon-skin cosmetic, or null for no/unknown
 *  skin. The skin model replaces the equipped item's held model (same bone, its
 *  own KAYKIT_WEAPON_ACCESSORY grip family + WEAPON_GRIP_OVERRIDES fine-tune). */
export function weaponSkinModelUrl(skinId: string | null | undefined): string | null {
  if (!skinId) return null;
  const def = WEAPON_SKINS[skinId];
  return def ? `${WEAPONS}/${def.model}.glb` : null;
}

/** Distinct weapon-skin GLB urls, preloaded like item weapon models: any nearby
 *  player can have a skin applied, and the attach path is synchronous. */
export function weaponSkinModelUrls(): string[] {
  return [...new Set(Object.values(WEAPON_SKINS).map((def) => `${WEAPONS}/${def.model}.glb`))];
}

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
  player_warrior: [
    null,
    `${SKINS_DIR}/knight/alt_a.png`,
    `${SKINS_DIR}/knight/alt_b.png`,
    `${SKINS_DIR}/knight/alt_c.png`,
    `${SKINS_DIR}/knight/alt_suit_prismatic.png`,
    `${SKINS_DIR}/knight/alt_suit_chrome.png`,
  ],
  player_paladin: [
    null,
    `${SKINS_DIR}/paladin/alt_a.png`,
    `${SKINS_DIR}/paladin/alt_suit_prismatic.png`,
    `${SKINS_DIR}/paladin/alt_suit_chrome.png`,
  ],
  player_hunter: [
    null,
    `${SKINS_DIR}/ranger/alt_a.png`,
    `${SKINS_DIR}/ranger/alt_b.png`,
    `${SKINS_DIR}/ranger/alt_c.png`,
    `${SKINS_DIR}/ranger/alt_suit_prismatic.png`,
    `${SKINS_DIR}/ranger/alt_suit_chrome.png`,
  ],
  player_rogue: [
    null,
    `${SKINS_DIR}/rogue/alt_a.png`,
    `${SKINS_DIR}/rogue/alt_b.png`,
    `${SKINS_DIR}/rogue/alt_c.png`,
    `${SKINS_DIR}/rogue/alt_suit_prismatic.png`,
    `${SKINS_DIR}/rogue/alt_suit_chrome.png`,
  ],
  player_priest: [
    null,
    `${SKINS_DIR}/mage/alt_a.png`,
    `${SKINS_DIR}/mage/alt_b.png`,
    `${SKINS_DIR}/mage/alt_c.png`,
    `${SKINS_DIR}/mage/alt_suit_prismatic.png`,
    `${SKINS_DIR}/mage/alt_suit_chrome.png`,
  ],
  player_mage: [
    null,
    `${SKINS_DIR}/mage/alt_a.png`,
    `${SKINS_DIR}/mage/alt_b.png`,
    `${SKINS_DIR}/mage/alt_c.png`,
    `${SKINS_DIR}/mage/alt_suit_prismatic.png`,
    `${SKINS_DIR}/mage/alt_suit_chrome.png`,
  ],
  player_warlock: [
    null,
    `${SKINS_DIR}/mage/alt_a.png`,
    `${SKINS_DIR}/mage/alt_b.png`,
    `${SKINS_DIR}/mage/alt_c.png`,
    `${SKINS_DIR}/mage/alt_suit_prismatic.png`,
    `${SKINS_DIR}/mage/alt_suit_chrome.png`,
  ],
  player_shaman: [
    null,
    `${SKINS_DIR}/barbarian/alt_a.png`,
    `${SKINS_DIR}/barbarian/alt_b.png`,
    `${SKINS_DIR}/barbarian/alt_c.png`,
    `${SKINS_DIR}/barbarian/alt_suit_prismatic.png`,
    `${SKINS_DIR}/barbarian/alt_suit_chrome.png`,
  ],
  player_druid: [
    null,
    `${SKINS_DIR}/druid/alt_a.png`,
    `${SKINS_DIR}/druid/alt_b.png`,
    `${SKINS_DIR}/druid/alt_c.png`,
    `${SKINS_DIR}/druid/alt_suit_prismatic.png`,
    `${SKINS_DIR}/druid/alt_suit_chrome.png`,
  ],
  // Combat Mech chromas — every index is a real full-model texture (no null
  // default; the embedded base texture is not one of the rewards).
  player_mech: MECH_CHROMAS.map(mechChromaUrl),
  // Bursar Fernando (the Eastbrook banker easter egg): the rogue palette with
  // the skin swatch repainted light brown and the hair/brow swatch black, in
  // the real Fernando's likeness. Index 0 is the real texture (mech precedent):
  // NPCs always resolve skin 0, so the embedded default is deliberately unused.
  npc_fernando: [`${SKINS_DIR}/rogue/fernando.png`],
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

// Quaternius-style velociraptor rig (velociraptor.glb): no hit-react in the
// asset, same as the spider/raptor rigs noted in src/render/characters/CLAUDE.md.
const VELOCIRAPTOR: ClipMap = {
  idle: 'Velociraptor_Idle',
  walk: 'Velociraptor_Walk',
  run: 'Velociraptor_Run',
  attack: ['Velociraptor_Attack'],
  death: 'Velociraptor_Death',
  jump: 'Velociraptor_Jump',
};

// ---------------------------------------------------------------------------
// The manifest
// ---------------------------------------------------------------------------

export const VISUALS: Record<string, VisualDef> = {
  // -- player classes ------------------------------------------------------
  player_warrior: {
    url: `${PLAYERS}/knight.glb`,
    height: HUMANOID_H,
    clips: {
      ...kaykit(['1H_Melee_Attack_Chop', '1H_Melee_Attack_Slice_Diagonal']),
      attackByHand: {
        twohand: '2H_Melee_Attack_Chop',
        dualwield: 'Dualwield_Melee_Attack_Chop',
      },
      attackByAbility: {
        mortal_strike: '2H_Melee_Attack_Chop',
        execute: '2H_Melee_Attack_Chop',
        slam: '2H_Melee_Attack_Chop',
        red_harvest: '2H_Melee_Attack_Chop',
        breachmaker: '2H_Melee_Attack_Chop',
        // Shieldcrack slams the SHIELD (offhand arm), not the sword: the
        // synthesized bash (scripts/_add_shield_bash_anim.mjs) drives the
        // left arm carrying the handslot.l shield; the weapon hand stays back.
        shield_slam: 'Shield_Bash',
        raging_gale: 'Dualwield_Melee_Attack_Chop',
        bloodthirst: 'Dualwield_Melee_Attack_Chop',
        // Reaping Arc and Revenge hit everything in the frontal arc: the
        // synthesized flat reap (scripts/_add_sweep_slice_anim.mjs), not the
        // top-to-bottom chop (owner: "sideways sword sweep").
        cleave: '1H_Melee_Attack_Slice_Horizontal',
        revenge: '1H_Melee_Attack_Slice_Horizontal',
        thunder_clap: '1H_Melee_Attack_Chop',
        faultline: '1H_Melee_Attack_Chop',
        heroic_strike: '1H_Melee_Attack_Slice_Diagonal',
        overpower: '1H_Melee_Attack_Slice_Diagonal',
        hamstring: '1H_Melee_Attack_Slice_Diagonal',
        sanguine_aura: 'Spellcast_Raise',
        raised_guard: 'Block',
        // Jawcrack is a bare-fist interrupt: the synthesized punch
        // (scripts/_add_pummel_punch_anim.mjs), not a weapon swing.
        pummel: 'Punch_A',
      },
    },
    show: ['Knight_Helmet', 'Knight_Cape'], // v2 knight dropped the built-in Badge_Shield mesh
    attach: [
      { url: `${WEAPONS}/sword_1handed.glb`, bone: 'handslot.r' },
      { url: `${WEAPONS}/shield_round.glb`, bone: 'handslot.l' },
    ],
    weaponSlots: [0],
    offhandSlot: 1,
  },
  player_paladin: {
    url: `${PLAYERS}/paladin.glb`,
    height: HUMANOID_H,
    clips: {
      ...kaykit(['1H_Melee_Attack_Chop', '1H_Melee_Attack_Slice_Diagonal']),
      attackByHand: { twohand: '2H_Melee_Attack_Chop' },
    },
    // dedicated paladin model (helmeted variant) — ships its own Cape + Helmet
    // meshes and texture, so no show-list/tint. Shield + paladin hammer arrive
    // in the weapons pass; the gripped axe holds the slot until then.
    attach: [
      { url: `${WEAPONS}/axe_1handed.glb`, bone: 'handslot.r' },
      { url: `${WEAPONS}/shield_square.glb`, bone: 'handslot.l' },
    ],
    weaponSlots: [0],
    offhandSlot: 1,
  },
  player_hunter: {
    url: `${PLAYERS}/ranger.glb`,
    height: HUMANOID_H,
    clips: kaykit(['2H_Ranged_Shoot']),
    // Bow-draw clips for the Season 1 bow skins (scripts/build_bow_anims.mjs):
    // with a bow displayed the shot plays a draw instead of the crossbow
    // shoulder-aim (visual.ts weaponSkinAttackClips).
    animUrls: [`${PLAYERS}/bow_anims.glb`],
    // dedicated ranger model — the quiver is a built-in mesh, so it's no longer
    // a separate chest attachment
    attach: [{ url: `${WEAPONS}/crossbow_1handed.glb`, bone: 'handslot.r' }],
  },
  player_rogue: {
    url: `${PLAYERS}/rogue.glb`,
    height: HUMANOID_H,
    clips: {
      ...kaykit(['Dualwield_Melee_Attack_Chop']),
      attackByAbility: {
        // Throat Wire is a wire strangle, not a dagger swing: the synthesized
        // two-handed choke (scripts/_add_garrote_choke_anim.mjs) reaches to
        // neck height and yanks back to the chest with a brief hold.
        garrote: 'Garrote_Choke',
        // Boot is a kick, not a swing: the synthesized snap kick
        // (scripts/_add_boot_kick_anim.mjs) chambers the knee and fires the
        // leg forward at gut height.
        kick: 'Kick_A',
        // Dirt Toss throws dirt, not daggers: the synthesized crouch-scoop
        // and underhand fling (scripts/_add_dirt_throw_anim.mjs).
        blind: 'Dirt_Throw',
      },
    },
    show: ['Rogue_Cape'],
    attach: [
      { url: `${WEAPONS}/dagger.glb`, bone: 'handslot.r' },
      { url: `${WEAPONS}/dagger.glb`, bone: 'handslot.l' },
    ],
    weaponSlots: [0],
    offhandSlot: 1,
  },
  player_priest: {
    url: `${PLAYERS}/mage.glb`,
    height: HUMANOID_H,
    clips: {
      ...kaykit(['2H_Melee_Attack_Chop']),
      attackByAbility: {
        // Lingering Grace is a blessing, not a staff swing: the one-hand
        // raise (a stock mage.glb clip) reads as the priest offering the HoT.
        renew: 'Spellcast_Raise',
      },
    },
    // The priest's Light: a warm golden halo ring above the crown. The mage
    // model's pointed hat is canon here, and at the default lift the ring
    // plane crosses the hat cone where it is wide, clipping through it; +0.15
    // raises the plane to the cone tip, where the default-size ring clears it
    // on every side (tuned by screenshot against the current mage.glb; a hat
    // reshape in an asset update means re-tuning). Kept just below the hat's
    // bounding-box top so portrait/turntable framing is unchanged for priests.
    halo: 0xffd766,
    haloUpOffset: 1.45,
    // show is a no-op for the hat/cape: the current mage.glb rigs every
    // accessory as a SkinnedMesh, and the allowlist filter (assets.ts) only
    // hides non-skinned nodes, so the hat always renders. Sanctioned look.
    show: [],
    attach: [{ url: `${WEAPONS}/staff.glb`, bone: 'handslot.r' }],
    weaponSlots: [0],
    // Faint warm lift only, to tell this apart from the mage/warlock models it
    // shares mage.glb with. The whole rig is ONE merged material/atlas (skin,
    // hair, and robe together), so this lerp multiplies the entire body, not
    // just the cloth. Measured: 0xf0e9d6 is near white, so even at 0.5 the old
    // strength only shifted the body by roughly (0.983, 0.980, 0.956), a
    // near-no-op (issue #2678); dropped to 0.15 anyway for consistency with
    // shaman/warlock, where the saturated tints DID flatten the face and
    // hands at their old strengths. Kept low like the mob tints below that
    // hit the same one-material-per-rig trap (mob_troll, mob_kobold, mob_ogre).
    tint: 0xf0e9d6,
    tintStrength: 0.15,
  },
  player_shaman: {
    url: `${PLAYERS}/barbarian.glb`,
    height: HUMANOID_H,
    clips: {
      ...kaykit(['1H_Melee_Attack_Chop', '1H_Melee_Attack_Slice_Diagonal']),
      attackByHand: { twohand: '2H_Melee_Attack_Chop' },
    },
    show: ['Barbarian_BearHat'], // v2 barbarian renamed Hat→BearHat and dropped the round shield mesh
    attach: [
      { url: `${WEAPONS}/axe_1handed.glb`, bone: 'handslot.r' },
      { url: `${WEAPONS}/shield_round.glb`, bone: 'handslot.l' },
    ],
    weaponSlots: [0],
    offhandSlot: 1,
    // Faint cool lift only: barbarian.glb is one merged material for the whole
    // body (skin, fur, and leather together), so this lerp hits the face and
    // hands as hard as the cloth. 0.4 (the class default strength) desaturated
    // the whole model into a blue-grey wash on character create (issue #2678).
    tint: 0x6f8fc9,
    tintStrength: 0.15,
  },
  player_mage: {
    url: `${PLAYERS}/mage.glb`,
    height: HUMANOID_H,
    clips: kaykit(['2H_Melee_Attack_Chop']),
    // The hat and cape render regardless of this list: the current mage.glb
    // rigs every accessory as a SkinnedMesh, and the show allowlist
    // (assets.ts) only hides non-skinned nodes. The hatted silhouette is the
    // sanctioned mage look; listing Mage_Cape is inert but kept as intent.
    show: ['Mage_Cape'],
    attach: [{ url: `${WEAPONS}/staff.glb`, bone: 'handslot.r' }],
    weaponSlots: [0],
  },
  player_warlock: {
    url: `${PLAYERS}/mage.glb`,
    height: HUMANOID_H,
    clips: kaykit(['Spellcast_Shoot']), // wand zap reads better than a staff bonk
    show: [],
    attach: [
      { url: `${WEAPONS}/wand.glb`, bone: 'handslot.r' },
      { url: `${WEAPONS}/spellbook_open.glb`, bone: 'handslot.l', gripRef: 'Spellbook_open' },
    ],
    weaponSlots: [0], // mainhand (wand) swaps; spellbook offhand stays
    // Faint violet lift only, to tell this apart from the mage/priest models
    // it shares mage.glb with (same one-material-per-rig caveat as those two:
    // this multiplies skin and hair along with the robe). 0.45 read as a
    // saturated full-body purple wash on character create (issue #2678).
    tint: 0x8d5fd3,
    tintStrength: 0.15,
  },
  player_druid: {
    url: `${PLAYERS}/druid.glb`,
    height: HUMANOID_H,
    clips: kaykit(['2H_Melee_Attack_Chop']),
    // dedicated druid model (own texture, ships a Backpack mesh)
    attach: [{ url: `${WEAPONS}/staff.glb`, bone: 'handslot.r' }],
    weaponSlots: [0],
  },

  // -- cosmetic body skin (class-agnostic; both the skin preview and a live
  //    player whose skinCatalog === 'mech', see visualKeyFor) ----------------
  player_mech: {
    url: `${PLAYERS}/Mech/characters/CombatMech.glb`,
    height: HUMANOID_H,
    // The mech is rigged to the same KayKit Rig_Medium skeleton as every other
    // player class; its GLB shipped with no clips, so the full KayKit set is
    // baked in from knight.glb (scripts/bake_mech_anims.mjs) — these names now
    // resolve like any other class. Lazy-loaded; see preloadMechAssets().
    clips: kaykit(['1H_Melee_Attack_Chop']),
    // Class-agnostic cosmetic body, but it still holds the wearer's equipped
    // mainhand: the shared handslot.r bone carries the grip (the mech reuses the
    // exact KayKit rig), so weaponSlots swaps attach[0] to the equipped weapon's
    // model just like every other class. The sword is only the no-weapon default.
    attach: [{ url: `${WEAPONS}/sword_1handed.glb`, bone: 'handslot.r' }],
    weaponSlots: [0],
    lazyPreload: true,
  },

  // -- forms ---------------------------------------------------------------
  form_sheep: {
    url: `${CREATURES}/alpaca.glb`,
    height: 1.2,
    clips: animal(['Attack_Headbutt']),
  },
  // Purpose-built quadruped (replaced a brown-tinted yeti, which was a biped
  // standing in for a bear). No tint: the sculpt ships its own texture.
  // walkRef/runRef are measured from the clips themselves (a planted foot slides
  // backwards relative to the hips at exactly body speed), scaled by
  // height/rawHeight = 2.35/0.588. They put full run (RUN_SPEED 7) at timeScale
  // 1.30, clear of the 1.6 clamp where feet start skating.
  form_bear: {
    url: `${CREATURES}/bear_form.glb`,
    height: 2.35,
    clips: BEAR_FORM,
    walkRef: 1.6,
    runRef: 5.4,
    attackTimeScale: 1,
  },
  // Druid Wolf Form AND shaman Shadewolf (ghost_wolf renders this visual with
  // the ghost material on top). Same custom baked wolf as the world wolves;
  // the tawny tint keeps the druid form readable against grey pack wolves.
  form_cat: {
    url: `${CREATURES}/wolf_basic.glb`,
    height: 1.6,
    clips: WOLF_BAKED,
    tint: 0xd08b45,
    tintStrength: 0.35,
  },
  // Druid Travel Form: a daft chicken-cow hybrid (custom GLB). No tint: its
  // authored cow-spots/comb/beak colours carry the look.
  form_travel: {
    url: `${CREATURES}/chicken_cow.glb`,
    height: 2.3,
    clips: CHICKEN_COW,
  },

  // -- rideable mounts (src/sim/content/mounts.ts catalog) -------------------
  // All lazyPreload: fetched on the first sight of a mounted player
  // (preloadMountAssets in assets.ts), never in the boot sweep. Baked
  // textures, no tint. Seat heights + procedural bob live in
  // src/render/mount_visuals.ts. Heights are deliberately imposing (a mount
  // should tower over the 2.6 humanoid the way a horse towers over a person);
  // walkRef/runRef foot-match each model's Walk/Run cycle cadence (baked or
  // authored) to mounted ground speed.
  // The horse ships AUTHORED gait clips (Idle/Walk/Run baked from the source
  // model's own animation set, Sleep repurposed as Death), not the procedural
  // bake_mount_gaits.mjs cycles the Tripo mounts carry; walkRef/runRef are
  // re-matched to its 1.03s walk / 0.40s gallop cadence.
  mount_valorsteed: {
    url: `${MOUNTS_DIR}/valorsteed.glb`,
    height: 3.8,
    clips: MOUNT_RIGGED,
    walkRef: 2.3,
    runRef: 12,
    lazyPreload: true,
  },
  mount_grag_bear: {
    url: `${MOUNTS_DIR}/grag_bear.glb`,
    height: 4.0,
    clips: MOUNT_RIGGED,
    walkRef: 2.6,
    runRef: 9,
    lazyPreload: true,
  },
  mount_stalkglider_snail: {
    url: `${MOUNTS_DIR}/stalkglider_snail.glb`,
    height: 3.1,
    clips: MOUNT_RIGGED,
    lazyPreload: true,
  },
  mount_aether_hover_cycle: {
    url: `${MOUNTS_DIR}/aether_hover_cycle.glb`,
    height: 2.3,
    clips: MOUNT_RIGGED,
    hover: 0.6,
    lazyPreload: true,
  },
  mount_shadowjump_toad: {
    url: `${MOUNTS_DIR}/shadowjump_toad.glb`,
    height: 3.2,
    clips: MOUNT_RIGGED,
    walkRef: 2.6,
    runRef: 9,
    lazyPreload: true,
  },
  mount_stormfeather_griffin: {
    url: `${MOUNTS_DIR}/stormfeather_griffin.glb`,
    height: 4.1,
    clips: MOUNT_RIGGED,
    walkRef: 2.6,
    runRef: 9,
    lazyPreload: true,
  },
  // Epic world-boss turkey: one authored strut cycle serves as BOTH Walk and
  // Run (plus a baked breathing Idle), so the run reference is deliberately
  // low; at full mounted speed the strut plays fast, which is the joke.
  mount_thunderstrut_gobbler: {
    url: `${MOUNTS_DIR}/thunderstrut_gobbler.glb`,
    height: 3.5,
    clips: MOUNT_RIGGED,
    walkRef: 1.8,
    runRef: 4.5,
    lazyPreload: true,
  },
  // Compact fantasy tank. One wheel revolution per locomotion clip matches
  // its authored tread cadence at the reference ground speeds below.
  mount_terrorspark_groundshaker: {
    url: `${MOUNTS_DIR}/terrorspark_groundshaker.glb`,
    height: 2.8,
    clips: MOUNT_RIGGED,
    walkRef: 3,
    runRef: 4.4,
    lazyPreload: true,
  },
  // The Drakemaw Raptor (broodlord legendary drop): saddle-broken Tripo biped,
  // gait-baked by scripts/bake_mount_gaits.mjs like the bear/toad/griffin. The
  // imported source clips drove Hip TRANSLATION half a model unit off the bind
  // pose (baked-in root motion), which at this height threw the body clear of
  // the saddle and lurched it every stride; the baker authors rotation-only
  // keys plus a root Y bob, so that cannot recur. walkRef is MEASURED off the
  // baked clip (tmp/dragonkin_gait_measure.mjs): walk 3.02 yd/s.
  mount_drakemaw_raptor: {
    url: `${MOUNTS_DIR}/drakemaw_raptor.glb`,
    height: 3.4,
    clips: MOUNT_RIGGED,
    walkRef: 3.0,
    // runRef is deliberately the RIDDEN speed (RUN_SPEED 7 x +80% = 12.6), not
    // the Run clip's measured 9.04 yd/s, so timeScale lands on exactly 1.0 and
    // the clip plays at its authored 2.0 strides/sec (6.3 yd per bound).
    // Foot-matching instead (runRef 9.04) gives timeScale 1.48 and a 2.96/sec
    // cadence, which read as badly sped up on a 3.4 yd mount. That is the real
    // tradeoff on this rig: under a perfect foot match, cadence is
    // bodySpeed / (2 x stride x normScale) and so depends only on stride
    // LENGTH, never on clip duration, which timeScale rescales away. Short legs
    // therefore can only buy a calm cadence with slide. This costs 28%, well
    // inside what the other baked mounts already ship (grag_bear's 3.58 yd/s
    // natural against the same 12.6 leaves it sliding over half its travel).
    runRef: 12.6,
    lazyPreload: true,
  },

  // Ambient Highwatch stable horse (sim mob 'stable_horse', MOB_KEYS below). Reuses
  // the Valorsteed GLB + its authored gait clips so it renders and ambles as a real
  // horse through the STANDARD mob-visual path, never a humanoid capsule. Unlike the
  // rider mounts this is NOT lazyPreload: a mob body is built synchronously by
  // createCharacterVisual (which throws on a not-yet-fetched asset), so it must be
  // in the boot sweep. Shorter than the imposing 3.8 ridden Valorsteed so loose
  // paddock horses read at a natural size; no tint (authored colours).
  mob_stable_horse: {
    url: `${MOUNTS_DIR}/valorsteed.glb`,
    height: 2.9,
    clips: MOUNT_RIGGED,
    walkRef: 2.3,
    runRef: 12,
  },

  // -- mob families --------------------------------------------------------
  mob_wolf: {
    // Custom Tripo wolf auto-rigged onto the Dog_Animation quadruped skeleton
    // (same pipeline as greyjaw), clips renamed to the animal() names at bake
    // time. Baked basecolor texture; keeps a light entity tint so this doubles
    // as the beast-family fallback and each beast keeps its own colour.
    url: `${CREATURES}/wolf_basic.glb`,
    height: 1.6,
    clips: WOLF_BAKED,
    tint: 'entity',
    tintStrength: 0.35,
  },
  // The Gleamfolk pixie villager (Veiled Hollow): Tripo biped from the user's
  // game-style concept, auto-rigged, clips renamed to the game vocabulary at
  // bake time. A light entity tint gives individual villagers variety.
  mob_mushroom_pixie: {
    url: `${CREATURES}/mushroom_pixie.glb`,
    height: HUMANOID_H, // villagers stand player-height, cap and all
    // The Tripo rig rests facing +x; yaw swings the model onto the game's
    // +z-forward convention so walking and combat face the right way.
    yaw: -Math.PI / 2,
    clips: {
      idle: 'Idle',
      walk: 'Walk',
      run: 'Run',
      attack: ['Attack'],
      hit: ['Hit'],
      death: 'Death',
      cast: 'Cast',
      jump: 'Jump',
    },
    tint: 'entity',
    tintStrength: 0.2,
  },
  greyjaw: {
    // Custom Tripo wolf auto-rigged onto the Dog_Animation quadruped skeleton;
    // clips renamed to the animal() names at bake time. Baked texture, no tint.
    // Old Greyjaw's model: 2.2 at scale 1 (his template scale 1.25 makes the
    // rare ~2.75 in-world vs the 1.6 pack wolf).
    url: `${CREATURES}/greyjaw.glb`,
    height: 2.2,
    clips: WOLF_BAKED,
  },
  mob_boar: {
    url: `${CREATURES}/wild_boar.glb`,
    height: 1.45,
    clips: WILD_BOAR,
    tint: 'entity',
    tintStrength: 0.4,
  },
  // Quaternius animal rig (shares clip names with wolf) — fox/deer/critters that
  // would otherwise fall back to mob_wolf via FAMILY_KEYS['beast'].
  mob_fox: {
    url: `${CREATURES}/fox.glb`,
    height: 1.0,
    clips: animal(['Attack']),
    tint: 'entity',
    tintStrength: 0.35,
  },
  // smaller silhouette of the same rig for ground critters (hares, badgers);
  // no dedicated rabbit/mustelid asset ships, so this is the closest small beast.
  mob_critter: {
    url: `${CREATURES}/fox.glb`,
    height: 0.7,
    clips: animal(['Attack']),
    tint: 'entity',
    tintStrength: 0.35,
  },
  // Yumi, the Protect Yumi objective cat familiar (Meshy rig, scale baked by
  // scripts/_bake_meshy_scale.mjs, meshopt + 1024 webp). The GLB ships ONE
  // clip, the block: mapped as the HIT reaction so she blocks when struck
  // (playHit rides every landed damage event). No idle/walk clips on
  // purpose: the objective never moves on its own, and baseAction falls back
  // to the authored rest pose when a slot's clip is absent. Painted texture,
  // so no entity tint.
  mob_yumi_cat: {
    url: `${CREATURES}/yumi_cat.glb`,
    height: HUMANOID_H * 1.2, // the objective reads over player heads
    clips: {
      idle: 'None',
      walk: 'None',
      run: 'None',
      attack: [],
      death: 'None',
      hit: ['Armature|Block5|baselayer'],
    },
  },
  mob_stag: {
    url: `${CREATURES}/stag.glb`,
    height: 1.9,
    // Attack_Kick, not 'Attack': the rig ships no clip by that name, so every
    // second swing in the rotation resolved to nothing and played no animation
    // at all (the repainted siblings below always had it right).
    clips: animal(['Attack_Headbutt', 'Attack_Kick']),
    tint: 'entity',
    tintStrength: 0.35,
  },
  // the Veiled Hollow stags: the shipped stag rig repainted to the approved
  // concepts (tmp/make_hollow_stags.mjs): dusk coats baked into the materials
  // and the antlers split onto their own emissive amethyst material, so no
  // entity tint (a wash would muddy the baked palette and the antler glow)
  mob_veiled_stag: {
    url: `${CREATURES}/veiled_stag.glb`,
    height: 1.9,
    clips: animal(['Attack_Headbutt', 'Attack_Kick']),
  },
  mob_gleamstag: {
    url: `${CREATURES}/gleamstag.glb`,
    height: 1.9,
    clips: animal(['Attack_Headbutt', 'Attack_Kick']),
  },
  // the does: the same rig with the antler mesh removed and a softer coat
  mob_veiled_doe: {
    url: `${CREATURES}/veiled_doe.glb`,
    height: 1.6,
    clips: animal(['Attack_Headbutt', 'Attack_Kick']),
  },
  // Aurelhorn keeps the bull's bulk (height) but joins the herd's species:
  // the same repainted stag rig in the patriarch's gold
  mob_aurelhorn: {
    url: `${CREATURES}/aurelhorn.glb`,
    height: 2.1,
    clips: animal(['Attack_Headbutt', 'Attack_Kick']),
  },
  // Training dummy: the immortal practice target (zone3.ts training_dummy,
  // hpBase 999999, no drops). Custom Tripo humanoid auto-rigged onto the
  // biped skeleton, KAYKIT_CLIP_PLAN vocabulary. The dummy never casts or
  // jumps (sim's dummy handling holds it stationary and ability-less), so
  // those two clips are stripped from the shipped GLB rather than carried as
  // dead weight. It appears in exactly one hub (zone3.ts, count: 1, radius:
  // 0), so it is lazy-preloaded rather than joining every client's eager
  // boot set.
  mob_training_dummy: {
    url: `${CREATURES}/training_dummy.glb`,
    height: 2.3,
    clips: {
      idle: 'Idle',
      walk: 'Walk',
      run: 'Run',
      attack: ['Attack'],
      hit: ['Hit'],
      death: 'Death',
    },
    lazyPreload: true,
    tint: 'entity',
    tintStrength: 0.35,
  },
  // Deepfen Spearjaw (The Drowned Litany): unused Quaternius raptor rig, a
  // toothy quadruped that reads far more like a swamp predator than the
  // generic wolf fallback (docs/prd/drowned-litany-asset-generation-plan.md).
  mob_spearjaw: {
    url: `${CREATURES}/velociraptor.glb`,
    height: 1.8,
    clips: VELOCIRAPTOR,
    tint: 'entity',
    tintStrength: 0.3,
  },
  // brown-tinted yeti rig, same recipe as the druid Bear form.
  mob_bear: {
    url: `${CREATURES}/yetialt.glb`,
    height: 2.2,
    clips: BIPED14,
    tint: 0x5a4030,
    tintStrength: 0.5,
  },
  // the same rig worn honestly: an ice-white yeti for the Frostveil
  mob_yeti: {
    url: `${CREATURES}/yetialt.glb`,
    height: 2.5,
    clips: BIPED14,
    tint: 'entity',
    tintStrength: 0.55,
  },
  mob_spider: {
    url: `${CREATURES}/spider.glb`,
    height: 1.4,
    clips: SPIDER,
    tint: 'entity',
    tintStrength: 0.35,
  },
  mob_murloc: {
    url: `${CREATURES}/frog.glb`,
    height: 1.7,
    clips: BIPED14,
    tint: 'entity',
    tintStrength: 0.45,
  },
  mob_kobold: {
    url: `${CREATURES}/goblin.glb`,
    height: 2.1,
    clips: ENEMY7,
    tint: 'entity',
    tintStrength: 0.2, // keep the green readable
  },
  // The Mirefen Marsh rare, replacing his stand-in generic-troll body. Only
  // the `grubjaw` template maps here (MOB_KEYS below), so every other troll
  // keeps mob_troll. Gait refs measured (tmp/dragonkin_gait_measure.mjs) at
  // his template scale 2.275: walk 4.36 (wander 2.63 -> 0.60x, exactly at the
  // clamp floor, which is why the build slows his Walk clip) and run 10.94
  // (chase 7.5 -> 0.69x). Both inside the matcher's clamps, so the feet plant.
  mob_grubjaw: {
    url: `${CREATURES}/grubjaw.glb`,
    height: 2.9,
    clips: GRUBJAW,
    walkRef: 4.36,
    runRef: 10.94,
    // Barely-there wash. mob_troll tints 0.12 toward its template's BRIGHT
    // green, which is what makes a stock Mirefen Troll pop; Grubjaw's own
    // template colour is a dark 0x145a32, so the same strength only muddied
    // his authored olive hide and read as near-black beside them.
    tint: 'entity',
    tintStrength: 0.04,
  },
  mob_troll: {
    url: `${CREATURES}/orc.glb`,
    height: 2.4,
    // faint wash only — 0.35 flooded every material with the template green
    clips: BIPED14,
    tint: 'entity',
    tintStrength: 0.12,
  },
  mob_ogre: {
    url: `${CREATURES}/giant.glb`,
    height: 2.8,
    clips: ENEMY7,
    tint: 'entity',
    tintStrength: 0.2, // skin washes pink fast
  },
  // Five Wildheart troll silhouettes use the same complete biped vocabulary,
  // but preserve their woven cloth, bone paint, feathers, and jungle palette.
  mob_wildheart_stalker: {
    url: `${CREATURES}/wildheart_stalker.glb`,
    height: 2.5,
    yaw: -Math.PI / 2,
    clips: TRIPO_BIPED_FULL_RIG,
    tint: 'entity',
    tintStrength: 0.04,
  },
  mob_wildheart_ravager: {
    url: `${CREATURES}/wildheart_ravager.glb`,
    height: 2.7,
    yaw: -Math.PI / 2,
    clips: TRIPO_BIPED_FULL_RIG,
    tint: 'entity',
    tintStrength: 0.04,
  },
  mob_wildheart_hexcaller: {
    url: `${CREATURES}/wildheart_hexcaller.glb`,
    height: 2.5,
    yaw: -Math.PI / 2,
    clips: TRIPO_BIPED_FULL_RIG,
    tint: 'entity',
    tintStrength: 0.04,
  },
  mob_wildheart_beastmaster: {
    url: `${CREATURES}/wildheart_beastmaster.glb`,
    height: 3,
    yaw: -Math.PI / 2,
    clips: TRIPO_BIPED_FULL_RIG,
    tint: 'entity',
    tintStrength: 0.03,
  },
  mob_wildheart_high_priest: {
    url: `${CREATURES}/wildheart_high_priest.glb`,
    height: 3.2,
    yaw: -Math.PI / 2,
    clips: TRIPO_BIPED_FULL_RIG,
    tint: 'entity',
    tintStrength: 0.03,
  },
  mob_elemental: {
    url: `${CREATURES}/golelingevolved.glb`,
    height: 2.2,
    hover: 0.3,
    clips: FLOATING,
    tint: 'entity',
    tintStrength: 0.4,
  },
  mob_water_elemental: {
    url: `${CREATURES}/water_elemental.glb`,
    height: 2.65,
    hover: 0.12,
    clips: WATER_ELEMENTAL,
    attackTimeScale: 1.1,
  },
  mob_dragonkin: {
    url: `${CREATURES}/dragonevolved.glb`,
    height: 2.4,
    hover: 0.25,
    // light tint only — heavy washes crush the wyrm to black under the green
    // sanctum torchlight
    clips: FLOATING,
    tint: 'entity',
    tintStrength: 0.2,
  },
  // --- The Drakelands dragonkin brood (v0.35 rework) ---------------------
  // Tripo sculpts on the 25-bone mixamorig core with artist-authored clips,
  // baked by tmp/dragonkin_build.mjs. The brood replaces the old floating
  // dragonevolved wyrm ONLY in the Drakelands (per-template MOB_KEYS
  // overrides below); the other dragonkin-family mobs keep the family
  // fallback above.
  // The gait references below are MEASURED, not guessed
  // (tmp/dragonkin_gait_measure.mjs): ref = the clip's own natural world
  // speed, 2 x stride x normScale x entityScale / duration, which is exactly
  // what locomotionTimeScale divides the body speed by. They are per-DEF and
  // scale-dependent, which is why the matriarch has her own def below rather
  // than sharing the broodlord's: at scale 2.85 her stride covers 33% more
  // ground per cycle, and reusing the lord's refs over-strode her by 25%.
  mob_dragonkin_broodlord: {
    url: `${CREATURES}/dragonkin_elite.glb`,
    height: 2.6,
    clips: DRAGONKIN_BROODLORD,
    // scale 2.25: walk 4.24 (wander 3.3 -> 0.78x), run 7.92 (chase 9.5 ->
    // 1.20x). Both land inside the matcher's clamps, so the feet plant.
    walkRef: 4.24,
    runRef: 7.92,
    // 'entity' tint: the broodlords wash dark scale-brown (template color).
    tint: 'entity',
    tintStrength: 0.12,
  },
  // Cindraleth: the same GLB and clips as her broodlords, own refs for her
  // scale 2.85 body (walk 5.37, run 10.04 -> her 9.0 chase plays at 0.90x).
  // Her template color (0xf0b040) tints this shared body gold, so she reads
  // as the gilded mother of the same brood.
  mob_dragonkin_matriarch: {
    url: `${CREATURES}/dragonkin_elite.glb`,
    height: 2.6,
    clips: DRAGONKIN_BROODLORD,
    walkRef: 5.37,
    runRef: 10.04,
    tint: 'entity',
    tintStrength: 0.12,
  },
  mob_dragonkin_broodguard: {
    url: `${CREATURES}/dragonkin_mob.glb`,
    height: 2.2,
    clips: DRAGONKIN_BROODGUARD,
    // scale 1.5: walk 2.15 (wander 2.98 -> 1.39x), run 5.59 (chase 8.5 ->
    // 1.52x, a 0.55s sprint cadence). Feet plant at both speeds.
    walkRef: 2.15,
    runRef: 5.59,
    tint: 'entity',
    tintStrength: 0.1,
  },
  mob_dragonkin_whelp: {
    url: `${CREATURES}/dragonkin_baby.glb`,
    height: 1.05,
    clips: DRAGONKIN_WHELP,
    // scale 0.85: walk 0.54, run 1.87. A hatchling 0.9yd tall CANNOT
    // foot-match a 10 yd/s chase (11 body-lengths/sec, gecko territory: the
    // clip would need a 0.1s cycle), so this one keeps a residual slide by
    // physics, not by oversight. The compressed 0.32s cycle reads as a
    // frantic scurry, which is what hides it; the refs stay honest so the
    // slow wander gait (and any future speed change) still matches.
    walkRef: 0.54,
    runRef: 1.87,
    tint: 'entity',
    tintStrength: 0.1,
  },
  // The egg is a clipless two-shell prop mob: alive shows Egg_Closed, death
  // swaps to Egg_Open (the cracked shell IS the corpse; see corpseMeshSwap).
  mob_dragon_egg: {
    url: `${CREATURES}/dragon_egg.glb`,
    height: 0.95,
    clips: STATIC_PROP,
    corpseMeshSwap: { hide: 'Egg_Closed', show: 'Egg_Open' },
    tint: 'entity',
    tintStrength: 0.08,
  },
  // Bog Thrall (The Drowned Litany): unused floating ghost rig, a stronger
  // fit for an undead swarm add than the generic skel_minion skeleton
  // (docs/prd/drowned-litany-asset-generation-plan.md).
  mob_choir_thrall: {
    url: `${CREATURES}/ghost.glb`,
    height: 1.6,
    hover: 0.3,
    clips: FLOATING,
    // Strong pull toward the template's pale sage: the ghost's own materials
    // are charcoal-grey and vanish against the black Litany pools; undead in
    // this delve read bone-pale per the marsh palette brief in the asset plan.
    tint: 'entity',
    tintStrength: 0.6,
  },
  // Tolling Bell (The Drowned Litany): Meshy-generated, not a KayKit/Quaternius
  // reuse: a rolling bell has no obvious existing-asset stand-in
  // (docs/prd/drowned-litany-asset-generation-plan.md).
  mob_tolling_bell: {
    url: `${CREATURES}/tolling_bell.glb`,
    // Reads ~2m in world after the template's 0.6 scale: the rolling bell is a
    // boss projectile the player dodges, so it must loom, not look like a prop.
    height: 3.4,
    clips: TOLLING_BELL,
    tint: 'entity',
    tintStrength: 0.15,
  },
  // warlock demon pets (emberkin/gloomshade) — one biped rig, the entity colour and
  // the mob template's scale tell the little orange emberkin from the bulky gloomshade
  mob_demon: {
    url: `${CREATURES}/demonalt.glb`,
    height: 1.8,
    clips: BIPED14,
    tint: 'entity',
    tintStrength: 0.5,
  },
  mob_demon_flying: {
    url: `${CREATURES}/demon.glb`,
    height: 1.7,
    hover: 0.35,
    clips: FLOATING,
    tint: 'entity',
    tintStrength: 0.25,
  },
  // the Nightbloom's realm-only rigs, all first appearances: the moonfleece
  // herds (alpaca), the gloam striders (velociraptor), and the hovering
  // masked nightkin (tribal, a flying rig: they drift rather than walk)
  mob_alpaca: {
    url: `${CREATURES}/alpaca.glb`,
    height: 1.7,
    clips: animal(['Attack_Headbutt', 'Attack_Kick']),
    tint: 'entity',
    tintStrength: 0.3,
  },
  mob_raptor: {
    url: `${CREATURES}/velociraptor.glb`,
    height: 1.6,
    clips: RAPTOR,
    tint: 'entity',
    tintStrength: 0.35,
  },
  mob_nightkin: {
    url: `${CREATURES}/tribal.glb`,
    height: 1.9,
    hover: 0.3,
    clips: FLOATING,
    tint: 'entity',
    tintStrength: 0.3,
  },
  // the Veiled Hollow's spirits: the ghost rig, entity-tinted (teal hollow
  // remnants and the ice wisp still wear it)
  mob_ghost: {
    url: `${CREATURES}/ghost.glb`,
    height: 1.6,
    hover: 0.4,
    clips: FLOATING,
    tint: 'entity',
    tintStrength: 0.55,
  },
  // the Hollow wisps: bespoke static meshes from the approved concepts
  // (user-generated via Tripo). No rig on purpose: they drift and hover,
  // and every clip lookup null-guards, so FLOATING names simply no-op.
  // Baked palettes, so no entity tint. Front faces +x off the generator;
  // yaw turns it to the +z game convention.
  mob_glimmerwisp: {
    url: `${CREATURES}/glimmerwisp.glb`,
    height: 1.6,
    hover: 0.4,
    clips: FLOATING,
    yaw: -Math.PI / 2,
  },
  mob_duskwisp: {
    url: `${CREATURES}/duskwisp.glb`,
    height: 1.6,
    hover: 0.4,
    clips: FLOATING,
    yaw: -Math.PI / 2,
  },
  // spore-borne mushroom folk: the glub blob drifting just above the glade
  mob_glub: {
    url: `${CREATURES}/glubevolved.glb`,
    height: 1.4,
    hover: 0.15,
    clips: FLOATING,
    tint: 'entity',
    tintStrength: 0.45,
  },
  // the Hollow's wandering bosses: two more rigs no other zone uses
  mob_crab: {
    url: `${CREATURES}/crabenemy.glb`,
    height: 1.7,
    clips: ENEMY_BITE,
    tint: 'entity',
    tintStrength: 0.35,
  },
  mob_bull: {
    url: `${CREATURES}/bull.glb`,
    height: 2.1,
    // the bull rig has no plain Idle clip; grazing IS its idle
    clips: {
      idle: 'Eating',
      walk: 'Walk',
      run: 'Gallop',
      attack: ['Attack_Headbutt', 'Attack_Kick'],
      hit: ['Idle_HitReact_Left', 'Idle_HitReact_Right'],
      death: 'Death',
    },
    tint: 'entity',
    tintStrength: 0.3,
  },
  // mossy treant: the shaggy yeti under a bark-green entity wash
  mob_treant: {
    url: `${CREATURES}/yeti.glb`,
    height: 2.6,
    clips: ENEMY_BITE,
    tint: 'entity',
    tintStrength: 0.72, // the white pelt needs a heavy wash to read as moss
  },
  mob_demonalt: {
    url: `${CREATURES}/demonalt.glb`,
    height: 2.1,
    clips: BIPED14,
    tint: 'entity',
    tintStrength: 0.35,
  },

  // -- delve-specific variants (same rigs, colour-differentiated via mob.color) -
  delve_skel_wraith: {
    // Ledger Wraith: pale skeleton, no weapon, stronger wash reads as near-transparent
    url: `${ENEMIES}/skeleton_minion.glb`,
    height: 2.5,
    clips: skeletonClips(['1H_Melee_Attack_Chop', '1H_Melee_Attack_Slice_Diagonal']),
    tint: 'entity',
    tintStrength: 0.55,
  },
  delve_skel_ringer: {
    // Funeral Ringer: skeleton rogue rig, cloth-brown tint at mid strength
    url: `${ENEMIES}/skeleton_rogue.glb`,
    height: 2.5,
    clips: skeletonClips(['1H_Melee_Attack_Chop', '1H_Melee_Attack_Slice_Diagonal']),
    attach: [{ url: `${WEAPONS}/skeleton_axe.glb`, bone: 'handslot.r' }],
    tint: 'entity',
    tintStrength: 0.45,
  },
  delve_mob_acolyte: {
    // Gravecall Acolyte: hooded mage with hat + staff, deep dark-brown saturation
    url: `${PLAYERS}/mage.glb`,
    height: HUMANOID_H,
    clips: kaykit(['2H_Melee_Attack_Chop']),
    show: ['Mage_Hat'],
    attach: [{ url: `${WEAPONS}/staff.glb`, bone: 'handslot.r' }],
    tint: 'entity',
    tintStrength: 0.6,
  },
  delve_skel_effigy: {
    // Saintless Effigy: armoured skeleton, high stone-pale wash, reads as carved stone
    url: `${ENEMIES}/skeleton_warrior.glb`,
    height: 2.5,
    clips: skeletonClips(['1H_Melee_Attack_Chop', '1H_Melee_Attack_Slice_Diagonal']),
    attach: [
      { url: `${WEAPONS}/skeleton_blade.glb`, bone: 'handslot.r' },
      { url: `${WEAPONS}/skeleton_shield_large_a.glb`, bone: 'handslot.l' },
    ],
    tint: 'entity',
    tintStrength: 0.65,
  },
  delve_skel_varric: {
    // Deacon Varric: boss mage rig with Taunt flourish on pull
    url: `${ENEMIES}/skeleton_mage.glb`,
    height: 2.5,
    clips: skeletonClips(['2H_Melee_Attack_Chop'], 'Taunt'),
    attach: [{ url: `${WEAPONS}/skeleton_staff.glb`, bone: 'handslot.r' }],
    tint: 'entity',
    tintStrength: 0.35,
  },

  // -- undead (KayKit skeletons, shared 41-joint rig) ------------------------
  skel_minion: {
    url: `${ENEMIES}/skeleton_minion.glb`,
    height: 2.5,
    clips: skeletonClips(['1H_Melee_Attack_Chop', '1H_Melee_Attack_Slice_Diagonal']),
    tint: 'entity',
    tintStrength: 0.25,
  },
  skel_warrior: {
    url: `${ENEMIES}/skeleton_warrior.glb`,
    height: 2.5,
    clips: skeletonClips(['1H_Melee_Attack_Chop', '1H_Melee_Attack_Slice_Diagonal']),
    tint: 'entity',
    tintStrength: 0.25,
  },
  skel_rogue: {
    url: `${ENEMIES}/skeleton_rogue.glb`,
    height: 2.5,
    clips: skeletonClips(['1H_Melee_Attack_Chop', '1H_Melee_Attack_Slice_Diagonal']),
    tint: 'entity',
    tintStrength: 0.25,
  },
  skel_mage: {
    url: `${ENEMIES}/skeleton_mage.glb`,
    height: 2.5,
    clips: skeletonClips(['2H_Melee_Attack_Chop']),
    attach: [{ url: `${WEAPONS}/skeleton_staff.glb`, bone: 'handslot.r' }],
    tint: 'entity',
    tintStrength: 0.25,
  },
  skel_boss: {
    url: `${ENEMIES}/skeleton_mage.glb`,
    height: 2.5,
    clips: skeletonClips(['2H_Melee_Attack_Chop'], 'Taunt'),
    attach: [{ url: `${WEAPONS}/skeleton_staff.glb`, bone: 'handslot.r' }],
    tint: 'entity',
    tintStrength: 0.25,
  },
  skel_necromancer: {
    url: `${ENEMIES}/necromancer.glb`,
    height: 2.5,
    clips: skeletonClips(['2H_Melee_Attack_Chop']),
    tint: 'entity',
    tintStrength: 0.25,
  },
  // The Infernal Citadel's Magus Vel'Kor: the same necromancer rig, but drenched in
  // its entity colour (the shared skel_necromancer tints at 0.25 and stays
  // bone-white, which reads as a snowdrift under the citadel's blood-red grade).
  rift_ritualist: {
    url: `${ENEMIES}/necromancer.glb`,
    height: 2.5,
    clips: skeletonClips(['2H_Melee_Attack_Chop']),
    tint: 'entity',
    tintStrength: 0.8,
  },
  skel_golem: {
    url: `${ENEMIES}/skeleton_golem.glb`,
    height: 3.4,
    clips: skeletonLargeClips(['2H_Melee_Attack_Chop', '1H_Melee_Attack_Chop']),
    // the baked golem axe ships without the 180° grip flip the rig expects, so
    // the blade faces backwards; spin it about its handle (local Y) to face out.
    weaponFix: [{ node: 'Skeleton_Golem_Axe', rotY: Math.PI }],
    tint: 'entity',
    tintStrength: 0.25,
  },

  // -- humanoid mobs (KayKit adventurers) ------------------------------------
  mob_bandit: {
    url: `${PLAYERS}/rogue_hooded.glb`,
    height: HUMANOID_H,
    clips: kaykit(['1H_Melee_Attack_Chop', 'Dualwield_Melee_Attack_Chop']),
    // v2 rogue_hooded ships the hood/mask/cape as its default look (no show
    // filter needed); the knives are attached dual-wield from the weapon files
    attach: [
      { url: `${WEAPONS}/dagger.glb`, bone: 'handslot.r' },
      { url: `${WEAPONS}/dagger.glb`, bone: 'handslot.l' },
    ],
    // fixed outlaw leather — entity tints (faction greens) read as friendly
    // villagers; the dark red-brown keeps the hooded silhouette hostile
    tint: 0x6b3a32,
    tintStrength: 0.3,
  },
  mob_dark_caster: {
    url: `${PLAYERS}/mage.glb`,
    height: HUMANOID_H,
    clips: kaykit(['2H_Melee_Attack_Chop']),
    show: ['Mage_Hat'],
    attach: [{ url: `${WEAPONS}/staff.glb`, bone: 'handslot.r' }],
    tint: 'entity',
    tintStrength: 0.5,
  },
  mob_bruiser: {
    url: `${PLAYERS}/barbarian.glb`,
    height: HUMANOID_H,
    clips: kaykit(['2H_Melee_Attack_Chop']),
    show: ['Barbarian_BearHat'], // v2 barbarian: Hat→BearHat, no Cape, weapon now attached
    attach: [{ url: `${WEAPONS}/axe_2handed.glb`, bone: 'handslot.r' }],
    tint: 'entity',
    tintStrength: 0.3,
  },

  // -- NPCs ------------------------------------------------------------------
  npc_knight: {
    url: `${PLAYERS}/knight.glb`,
    height: HUMANOID_H,
    clips: kaykit(['1H_Melee_Attack_Chop']),
    show: ['Knight_Helmet', 'Knight_Cape'],
    attach: [{ url: `${WEAPONS}/sword_1handed.glb`, bone: 'handslot.r' }],
  },
  npc_mage: {
    url: `${PLAYERS}/mage.glb`,
    height: HUMANOID_H,
    clips: kaykit(['2H_Melee_Attack_Chop']),
    show: [],
    attach: [{ url: `${WEAPONS}/staff.glb`, bone: 'handslot.r' }],
    tint: 0xc9b98a,
    tintStrength: 0.3, // brown-robed brothers of the chapel
  },
  // Brother Aldric keeps his pre-v0.7 model (the old chars/mage.glb, restored as
  // mage_classic.glb with the staff built into the mesh). Aldric-only — every
  // other npc_mage uses the new KayKit full-pack model from #396.
  npc_aldric: {
    url: `${PLAYERS}/mage_classic.glb`,
    height: HUMANOID_H,
    clips: kaykit(['2H_Melee_Attack_Chop']),
    show: ['2H_Staff'],
    tint: 0xc9b98a,
    tintStrength: 0.3,
  },
  npc_smith: {
    url: `${PLAYERS}/barbarian.glb`,
    height: HUMANOID_H,
    clips: kaykit(['1H_Melee_Attack_Chop']),
    show: [],
    attach: [{ url: `${WEAPONS}/axe_1handed.glb`, bone: 'handslot.r' }],
  },
  npc_scout: {
    url: `${PLAYERS}/rogue.glb`,
    height: HUMANOID_H,
    clips: kaykit(['2H_Ranged_Shoot']),
    show: ['Rogue_Cape'],
    attach: [{ url: `${WEAPONS}/crossbow_1handed.glb`, bone: 'handslot.r' }],
  },
  npc_villager: {
    url: `${PLAYERS}/rogue.glb`,
    height: HUMANOID_H,
    clips: kaykit(['1H_Melee_Attack_Chop']),
    show: [],
    tint: 'entity',
    tintStrength: 0.35,
  },
  npc_villager_robed: {
    url: `${PLAYERS}/mage.glb`,
    height: HUMANOID_H,
    clips: kaykit(['2H_Melee_Attack_Chop']),
    show: [],
    tint: 'entity',
    tintStrength: 0.35,
  },
  // Bursar Fernando: the villager body with the likeness atlas (SKINS above)
  // carrying black shoulder-length hair and light brown skin. No entity tint:
  // the gold NpcDef color would wash the repaint back toward the villager look.
  npc_fernando: {
    url: `${PLAYERS}/rogue.glb`,
    height: HUMANOID_H,
    clips: kaykit(['1H_Melee_Attack_Chop']),
    show: [],
  },
  // Brother Halven, the Reliquary Keeper: a devout male guardian tending the crypt
  // door. Uses the KayKit paladin, one of the newer full-pack adventurer models
  // (unused elsewhere), for a sturdier, holier silhouette than the old hooded
  // rogue. Ships its accessories (helm/cape/shield) by default (no show filter).
  npc_reliquary_keeper: {
    url: `${PLAYERS}/paladin.glb`,
    height: HUMANOID_H,
    clips: kaykit(['1H_Melee_Attack_Chop']),
  },
  // Edda Reedhand (The Drowned Litany companion NPC, healer): the druid player
  // rig, staff in hand, backpack authored on the model (a traveling marsh
  // herbalist). The earlier Meshy mesh clashed with the KayKit proportions; a
  // player rig also gives her the full clip set, so her heals play the real
  // Spellcasting channel. Fixed staff (no weaponSlots: NPC gear never changes).
  npc_edda_reedhand: {
    url: `${PLAYERS}/druid.glb`,
    height: HUMANOID_H,
    clips: kaykit(['2H_Melee_Attack_Chop']),
    attach: [{ url: `${WEAPONS}/staff.glb`, bone: 'handslot.r' }],
  },
  // The three zone Chroniclers (Saul, Osric Fenn, Zenzie): one shared
  // scholarly-mage silhouette (hat, staff, open ledger in the off hand,
  // the warlock spellbook grip) with the per-NPC entity tint carrying each
  // identity. When the bespoke chronicler .glb files arrive, split this into
  // one def per chronicler with its own url.
  npc_chronicler: {
    url: `${PLAYERS}/mage.glb`,
    height: HUMANOID_H,
    clips: kaykit(['2H_Melee_Attack_Chop']),
    show: ['Mage_Hat'],
    attach: [
      { url: `${WEAPONS}/staff.glb`, bone: 'handslot.r' },
      { url: `${WEAPONS}/spellbook_open.glb`, bone: 'handslot.l', gripRef: 'Spellbook_open' },
    ],
    tint: 'entity',
    tintStrength: 0.55,
  },
  // Reedbound Acolyte (The Drowned Litany trash mob): Stone Cantor model from
  // the Raid 02 asset batch. The earlier Meshy mesh (reedbound_acolyte.glb) was
  // realistically proportioned and clashed with the chunky KayKit-style rigs;
  // this one matches the game's proportions, so the standard humanoid height
  // applies (the old def ran at 3.4 only to compensate for the thin mesh).
  mob_reedbound_acolyte: {
    url: `${CREATURES}/stone_cantor.glb`,
    height: HUMANOID_H,
    clips: RAID_CASTER,
    // The 2.6s Cast clip doubles as the vial-throw one-shot; at the default
    // 1.3x it fills nearly the whole 2.6s attack cadence, which reads
    // sluggish AND leaves no gap for the Hit flinch (one-shots never
    // interrupt one-shots). 1.7x makes the throw snap and frees ~1.1s of
    // every cycle for reactions.
    attackTimeScale: 1.7,
    tint: 'entity',
    tintStrength: 0.2,
  },
  // Spider Egg-Sac (Sinkhole Baptistry finale trigger, The Drowned Litany):
  // Meshy-generated static prop, no rig/clips (it never moves; it dies to a
  // single hit). The visual/animation pipeline no-ops gracefully when a clip
  // name below has no match in the GLB, so it just renders static, which is
  // exactly right for a stationary egg-sac.
  mob_spider_egg_sac: {
    url: `${CREATURES}/spider_egg_sac.glb`,
    height: 1.8,
    clips: {
      idle: 'Idle',
      walk: 'Idle',
      run: 'Idle',
      attack: ['Idle'],
      death: 'Idle',
    },
  },
};

// ---------------------------------------------------------------------------
// Dispatch: entity -> visual key (mirrors the old buildRigFor selection:
// e.kind + e.templateId + MOBS[id].family)
// ---------------------------------------------------------------------------

const MOB_KEYS: Record<string, string> = {
  wildheart_stalker: 'mob_wildheart_stalker',
  wildheart_ravager: 'mob_wildheart_ravager',
  wildheart_hexcaller: 'mob_wildheart_hexcaller',
  wildheart_beastmaster: 'mob_wildheart_beastmaster',
  wildheart_high_priest: 'mob_wildheart_high_priest',
  // The Drakelands dragonkin brood (v0.35): per-template overrides so the
  // rework replaces every dragon model IN THE DRAKELANDS (Cindraleth
  // included, re-tinted gold by her template color) while the dragonkin
  // family fallback (the floating dragonevolved wyrm) stays for the sanctum,
  // temple, rift, and Galecrest dragonkin.
  drakemaw_broodlord: 'mob_dragonkin_broodlord',
  cindraleth_maw_matriarch: 'mob_dragonkin_matriarch',
  dragonkin_broodguard: 'mob_dragonkin_broodguard',
  dragonkin_whelp: 'mob_dragonkin_whelp',
  dragonkin_egg: 'mob_dragon_egg',
  // Grubjaw the Glutton: his own body now, not the shared troll stand-in.
  grubjaw: 'mob_grubjaw',
  // Ambient Highwatch stable horse: the Valorsteed mount model (mob_stable_horse
  // above) so it renders as an animated horse, not a humanoid.
  stable_horse: 'mob_stable_horse',
  // Dawnhold's garrison: the armored knight body (helmet, cape, sword), not
  // the humanoid family's hooded outlaw fallback.
  hedge_knight: 'npc_knight',
  // Protect Yumi objective cat: the dedicated Meshy familiar
  // (docs/prd/protect-yumi-assets.md item 1, delivered).
  yumi_cat: 'mob_yumi_cat',
  training_dummy: 'mob_training_dummy',
  emberkin: 'mob_demon',
  water_elemental: 'mob_water_elemental',
  gloomshade: 'mob_demon',
  duskborn: 'mob_demon',
  warlock_imp: 'mob_demon_flying',
  warlock_voidwalker: 'mob_demonalt',
  wild_boar: 'mob_boar',
  // beasts that would otherwise fall back to the wolf model (FAMILY_KEYS.beast)
  old_cragmaw: 'mob_bear',
  bog_bloat: 'mob_murloc',
  // Old Greyjaw: the named rare wolf gets his own custom model (the pack
  // wolves keep the light mob_wolf)
  old_greyjaw: 'greyjaw',
  // The Drowned Litany (Mirefen Marsh): give marsh enemies the right silhouette
  // instead of the family fallback (beast -> wolf, undead -> skeleton minion).
  mirefen_widowling: 'mob_spider',
  spider_egg_sac: 'mob_spider_egg_sac',
  // Broodmother clutch (q_broodmother): the destructible eggs reuse the egg-sac
  // model (not a live spider), and the hatchling is a small spider.
  spider_egg: 'mob_spider_egg_sac',
  widow_hatchling: 'mob_spider',
  sump_troll_devourer: 'mob_troll',
  grave_silt_bulwark: 'mob_ogre',
  drowned_cantor: 'delve_mob_acolyte',
  deepfen_spearjaw: 'mob_spearjaw',
  choir_thrall: 'mob_choir_thrall',
  tolling_bell: 'mob_tolling_bell',
  reedbound_acolyte: 'mob_reedbound_acolyte',
  edda_reedhand: 'npc_edda_reedhand',
  // gravecaller cult + necromancers: dark-robed casters
  gravecaller_cultist: 'mob_dark_caster',
  gravecaller_summoner: 'mob_dark_caster',
  // BOTH Nhalias: the zone 2 overworld rare elite keeps her original template
  // id; the Drowned Litany boss is a separate renamed template.
  sister_nhalia: 'mob_dark_caster',
  sister_nhalia_drowned_canticle: 'mob_dark_caster',
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
  nythraxis_heroic_warrior_add: 'skel_warrior',
  nythraxis_heroic_priest_add: 'skel_necromancer',
  nythraxis_heroic_rogue_add: 'skel_rogue',
  brother_aldric_raid: 'npc_aldric',
  hollow_acolyte: 'skel_mage',
  sexton_marrow: 'skel_mage',
  morthen: 'skel_boss',
  crypt_shambler: 'skel_rogue',
  // delve enemies
  reliquary_ledger_wraith: 'delve_skel_wraith',
  reliquary_funeral_ringer: 'delve_skel_ringer',
  reliquary_gravecall_acolyte: 'delve_mob_acolyte',
  reliquary_saintless_effigy: 'delve_skel_effigy',
  deacon_varric: 'delve_skel_varric',
  fallen_captain_aldren: 'skel_warrior',
  corrupted_priest_malric: 'skel_necromancer',
  deathstalker_voss: 'skel_rogue',
  // The Nythraxis phase-2 heroic court is Aldren / Malric / Voss risen again, so
  // the "Spirit of X" adds reuse each character's crypt visual above. Without these
  // the ids fall through to FAMILY_KEYS.undead (skel_minion) and the whole court
  // renders as identical generic skeletons. See spawnNythraxisHeroicAdds.
  vision_aldren_warrior: 'player_warrior',
  vision_malric_mage: 'player_mage',
  vision_deathstalker_voss: 'player_rogue',
  // the Veiled Hollow: stags use the real stag rig instead of the beast-family
  // wolf; the court guardians borrow the golem rig as stone constructs; the
  // spirits, mushroom folk, and treants get realm-only rigs (ghost, glub,
  // yeti) that appear nowhere in the outer three zones
  veiled_stag: 'mob_veiled_stag',
  veiled_doe: 'mob_veiled_doe',
  gleamstag: 'mob_gleamstag',
  gilded_stag: 'mob_stag',
  gloam_fox: 'mob_fox',
  orchard_treant: 'mob_treant',
  lily_wisp: 'mob_ghost',
  ancient_guardian: 'skel_golem',
  waking_warden: 'skel_golem',
  glimmerwisp: 'mob_glimmerwisp',
  duskwisp: 'mob_duskwisp',
  ice_wisp: 'mob_ghost',
  frostmane_yeti: 'mob_yeti',
  // Frostveil quest pass: Wren renders as a tinted villager (escort NPC, mob-kind
  // so the escort driver can walk her); the howlers ride the beast/wolf fallback.
  apprentice_wren: 'npc_villager',
  sporeling_gatherer: 'mob_glub',
  corrupted_sporeling: 'mob_glub',
  mushroom_pixie: 'mob_mushroom_pixie',
  treant_elder: 'mob_treant',
  old_marrowshell: 'mob_crab',
  aurelhorn: 'mob_aurelhorn',
  // the Nightbloom: silver herds, night-running raptors, hovering star folk;
  // the Barrow King borrows the armored skeleton the other revenants wear
  moonfleece_grazer: 'mob_alpaca',
  gloam_strider: 'mob_raptor',
  nightkin_stargazer: 'mob_nightkin',
  barrow_king: 'skel_warrior',
  // the Wraithwood: drifting wraiths on the ghost rig, walking haunted
  // trees on the treant's, and the hooded Huntsman on the crypt rogue's
  // (the widowsilk spinners take the spider family default)
  wood_wraith: 'mob_ghost',
  gravenbark_shambler: 'mob_treant',
  pale_huntsman: 'skel_rogue',
  // Mosley is an escortee (mob-kind so the escort driver can walk him), and
  // every escortee needs an explicit body: the humanoid family default is the
  // hooded outlaw, so the townsfolk you walk home would read as the bandits you
  // are protecting them from. Tinted villager, exactly like Wren above.
  gravedigger_mosley: 'npc_villager',
  // the Palmreach: coral crabs, jungle boars, and the carved-stone guardian
  // (the canopy weavers take the spider family default)
  tide_scuttler: 'mob_crab',
  thicket_boar: 'mob_boar',
  idol_guardian: 'skel_golem',
  topiary_stag: 'mob_stag',
  the_topiary_bull: 'mob_bull',
  moor_ram: 'mob_alpaca',
  shoal_scuttler: 'mob_crab',
  // Navigator Suli, the Palmreach escortee (see gravedigger_mosley above).
  castaway_navigator: 'npc_villager',
  // The Wreck Warden walks as Mogger's hulking bruiser body, not a skeleton.
  the_wreck_warden: 'mob_bruiser',
  // the Farshore: Bram is the isle's escortee (see gravedigger_mosley above);
  // its wretches, stalkers and horrors keep their family fallbacks.
  fisher_bram: 'npc_villager',
  // The Infernal Citadel: the pact cult reads as robed casters, not the `undead`
  // family's default skeleton minion. Its demons keep the family fallback
  // (mob_demonalt), re-tinted deep red by the templates.
  rift_pact_acolyte: 'mob_dark_caster',
  rift_boss_ritualist: 'rift_ritualist',
};

const FAMILY_KEYS: Record<string, string> = {
  beast: 'mob_wolf',
  humanoid: 'mob_bandit',
  mudfin: 'mob_murloc',
  spider: 'mob_spider',
  burrower: 'mob_kobold',
  undead: 'skel_minion',
  troll: 'mob_troll',
  ogre: 'mob_ogre',
  elemental: 'mob_elemental',
  dragonkin: 'mob_dragonkin',
  demon: 'mob_demonalt',
  // deepfen_spearjaw already has an explicit MOB_KEYS override to mob_spearjaw
  // (visualKeyFor checks MOB_KEYS first), so this default stays unreachable
  // for it even after its family retag. It only matters for a future reptile
  // mob with no override of its own; reuse the same model so that fallback
  // is sane too.
  reptile: 'mob_spearjaw',
};

const NPC_KEYS: Record<string, string> = {
  bursar_fernando: 'npc_fernando',
  card_master: 'npc_villager_robed',
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
  brother_halven: 'npc_reliquary_keeper',
  brother_halven_marsh: 'npc_reliquary_keeper',
  chronicler_saul: 'npc_chronicler',
  chronicler_osric_fenn: 'npc_chronicler',
  chronicler_edda_hartwell: 'npc_chronicler',
  // The graveyard angel: a robed figure, rendered translucent (ethereal) with a
  // holy shimmer by the renderer (see the spirit_healer branches there).
  spirit_healer: 'npc_villager_robed',
  // Eldergleam, the Veiled Hollow
  keeper_saelwyn: 'npc_mage',
  loremother_bryn: 'npc_villager_robed',
  provisioner_fenna: 'npc_villager',
  wardsmith_orun: 'npc_smith',
  archivist_tullo: 'npc_villager_robed',
  // Professions 2.0 station masters: existing looks only (no new GLBs). The
  // forge and toolworks masters wear the smith's work apron; the weaver and
  // alchemist match the robed apothecary/herbalist look; the cook and tanner
  // read as working townsfolk.
  forgemistress_darva: 'npc_smith',
  tinker_gizzel: 'npc_smith',
  weaver_ottilie: 'npc_villager_robed',
  alchemist_verane: 'npc_villager_robed',
  cook_marlow: 'npc_villager',
  tanner_hesk: 'npc_villager',
  huntsman_deral: 'npc_scout',
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

/** Held-weapon layout override for the class-agnostic Combat Mech body. The mech
 *  keeps its own model and clips but adopts the WEARER class's hand layout, so a
 *  dual-wield class (the rogue) shows the equipped weapon in BOTH hands on the mech
 *  (it shares the KayKit handslot.r/.l bones). Non-dual classes return null and keep
 *  the mech's own single-mainhand default. Host-agnostic: the wearer's class arrives
 *  as a player entity's templateId, so this applies the same offline and online. */
export function mechHeldWeaponOverride(cls: PlayerClass): WeaponLayoutOverride | null {
  const classDef = VISUALS[`player_${cls}`];
  if (!classDef || ((classDef.weaponSlots?.length ?? 0) < 2 && classDef.offhandSlot === undefined))
    return null;
  return {
    attach: classDef.attach,
    weaponSlots: classDef.weaponSlots,
    offhandSlot: classDef.offhandSlot,
  };
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
  // Equipped-weapon models a player may swap to at runtime (any nearby player's
  // gear), so they are resolved-and-ready when setWeapon attaches them.
  for (const url of itemWeaponModelUrls()) urls.add(url);
  for (const url of itemOffhandModelUrls()) urls.add(url);
  // Season 1 Armory weapon-skin models: also attachable on any nearby player at
  // any moment (account-wide cosmetics), so they preload with the same sweep.
  for (const url of weaponSkinModelUrls()) urls.add(url);
  return [...urls];
}

export function visualAssetUrlForGraphics(url: string, standardMaterials: boolean): string {
  return standardMaterials ? url : (LOW_URL_ALIAS[url] ?? url);
}

export function manifestUrlsForGraphics(standardMaterials: boolean): string[] {
  return [
    ...new Set(manifestUrls().map((url) => visualAssetUrlForGraphics(url, standardMaterials))),
  ];
}

/**
 * The character/weapon GLB URLs to PRELOAD, given the graphics tier guessed when
 * assets.ts was first imported. This MUST be tier-INDEPENDENT (a superset of every
 * tier's placement set).
 *
 * Character placement resolves asset URLs against the LIVE GFX tier through
 * assetUrl()/visualAssetUrlForGraphics, and resolvedGltf() throws "character asset not
 * preloaded" synchronously when the resolved URL was never loaded. The live tier is
 * set by initGfxTier() inside the Renderer constructor, AFTER assets.ts froze its
 * import-time GFX best-guess. On low gfx, LOW_URL_ALIAS swaps one body GLB
 * (rogue_hooded.glb -> rogue.glb), so manifestUrlsForGraphics(false) is a STRICT
 * subset of manifestUrlsForGraphics(true). If the import-time guess is low but the
 * renderer resolves medium+, the very common mob_bandit body (rogue_hooded.glb, the
 * humanoid-family default AND the global mob fallback) is placed yet was never
 * preloaded, crashing world entry: the character-side twin of the v0.16.0 props P0.
 * So preload the UNION across both tiers, exactly as foliage.ts is immune by sourcing
 * one frozen list for both preload and placement.
 *
 * The arg is retained to document the invariant and to let the guard test assert it at
 * the lowest (most dangerous) import tier; the result intentionally ignores it.
 */
export function characterPreloadUrls(_importTierStandardMaterials: boolean): string[] {
  return [...new Set([...manifestUrlsForGraphics(true), ...manifestUrlsForGraphics(false)])];
}

export function visibleAttachmentsForGraphics(
  def: Pick<VisualDef, 'attach'>,
): readonly AttachDef[] {
  return def.attach ?? [];
}
