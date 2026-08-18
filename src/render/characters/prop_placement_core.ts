// The ONE answer to "where does a held prop sit on a rig". Pure: no three.js, no DOM,
// no loading, so every surface that draws a character shares it instead of deriving
// its own.
//
// WHY THIS EXISTS. Four surfaces used to answer this question independently, and they
// disagreed: the game (`assets.ts`), the /wiki guide viewer and its committed stills
// (`src/guide/viewer/model.ts`), the asset-pipeline live inspector
// (`scripts/asset_pipeline/viewer_live.js`), and the Blender concept-art pipeline
// (`scripts/assets/last_bell_crew/`). A warrior's sword sat half a yard down the arm
// and rotated 180 degrees on /wiki versus in game, and nothing failed when they drifted
// because nothing compared them. One function, one answer, every caller.
//
// FRAME CONTRACT, and it is load-bearing. The returned transform is in the CARRYING
// BONE's local space, and it applies to a payload that has already been FLATTENED: a
// single-child weapon scene collapses to a holder carrying the child's scale, with the
// child's own translation and rotation dropped. A caller that flattens differently gets
// a different answer, which is the bug this module exists to end. Mount through
// `prop_mount.ts` rather than hand-rolling the apply step.
//
// The three tables below moved here VERBATIM from `assets.ts`; they are data, and this
// module is their home now.
import { backGripFor } from './back_grips';
import { type HandGrip, KAYKIT_SHIELD_ACCESSORIES, KAYKIT_SHIELD_GRIPS } from './held_item_grips';
import { variantGripTransform, WEAPON_GRIP_OVERRIDES } from './weapon_grip';

// KayKit adventurer standalone weapon glbs ship a left-hand mesh offset on a
// lone child node. handslot.r/l children in the character glbs carry the
// authored grip, copy those (or this fallback table) after flattening.
export const KAYKIT_WEAPON_ACCESSORY: Record<string, string> = {
  axe_1handed: '1H_Axe',
  axe_2handed: '2H_Axe',
  crossbow_1handed: '1H_Crossbow',
  crossbow_2handed: '2H_Crossbow',
  sword_1handed: '1H_Sword',
  sword_2handed: '2H_Sword',
  staff: '2H_Staff',
  dagger: 'Knife',
  wand: '1H_Wand',
  // Per-item weapon variants (ITEM_WEAPON_VARIANTS / public/models/weapons/<key>.glb)
  // come from a different pack than the KayKit generics. Crucially, each variant's
  // mesh ORIGIN is authored AT the grip (the handle/guard): minY is consistent
  // within a family (~-0.4 for swords) while the blade length (maxY) varies. So we
  // do NOT recenter (that would move the grip to mid-blade and make long blades
  // drag); we attach at the origin and only clamp oversized models. VAR_* keys take the
  // variant-pack branch of resolvePropPlacement below (no rig node matches them).
  sword_a: 'VAR_SWORD',
  sword_b: 'VAR_SWORD',
  sword_c: 'VAR_SWORD',
  sword_d: 'VAR_SWORD',
  sword_e: 'VAR_SWORD',
  sword_f: 'VAR_SWORD',
  sword_g: 'VAR_SWORD',
  dagger_a: 'VAR_DAGGER',
  dagger_b: 'VAR_DAGGER',
  dagger_c: 'VAR_DAGGER',
  staff_a: 'VAR_STAFF',
  staff_b: 'VAR_STAFF',
  staff_c: 'VAR_STAFF',
  staff_d: 'VAR_STAFF',
  axe_a: 'VAR_AXE',
  axe_b: 'VAR_AXE',
  axe_c: 'VAR_AXE',
  axe_d: 'VAR_AXE',
  hammer_a: 'VAR_AXE',
  hammer_b: 'VAR_AXE',
  hammer_c: 'VAR_AXE',
  hammer_d: 'VAR_AXE',
  halberd: 'VAR_POLEARM',
  // additional distinct models (KayKit Adventurers set + spears/scythe/wands) for
  // weapon variety. adv_* swords/dagger/staff/axe share the variant-pack convention
  // (float geo, origin-at-grip) so they reuse the same family grips.
  adv_sword_1handed: 'VAR_SWORD',
  adv_sword_2handed: 'VAR_SWORD',
  adv_sword_2handed_color: 'VAR_SWORD',
  adv_dagger: 'VAR_DAGGER',
  adv_staff: 'VAR_STAFF',
  adv_druid_staff: 'VAR_STAFF',
  adv_axe_1handed: 'VAR_AXE',
  adv_axe_2handed: 'VAR_AXE',
  spear_a: 'VAR_POLEARM',
  spear_b: 'VAR_POLEARM',
  scythe: 'VAR_POLEARM',
  wand_a: 'VAR_WAND',
  wand_b: 'VAR_WAND',
  adv_wand: 'VAR_WAND',
  emberfang_sword: 'VAR_SWORD',
  redskull_sword: 'VAR_SWORD',
  redskull_dagger: 'VAR_DAGGER',
  redskull_staff: 'VAR_STAFF',
  redskull_wand: 'VAR_WAND',
  redskull_hammer: 'VAR_AXE',
  purple_sword: 'VAR_SWORD',
  purple_dagger: 'VAR_DAGGER',
  purple_axe: 'VAR_AXE',
  purple_staff: 'VAR_STAFF',
  purple_wand: 'VAR_WAND',
  wrought_iron_longsword: 'VAR_SWORD',
  notched_woodaxe: 'VAR_AXE',
  iron_field_hammer: 'VAR_AXE',
  peeled_birch_wand: 'VAR_WAND',
  simple_farmhand_crossbow: 'VAR_CROSSBOW',
  guildmark_arming_sword: 'VAR_SWORD',
  skyrender_the_firmament_s_wound: 'VAR_AXE',
  cosmarch_spire_of_the_endless_void: 'VAR_STAFF',
  emberwish_mote_of_the_dying_sun: 'VAR_WAND',
  meteorlatch_the_sky_s_last_judgment: 'VAR_CROSSBOW',
  starfall_judgment_of_the_heavens: 'VAR_MACE',
  // A fang-shaped blade carries like a dagger, not a sword (the release's
  // fang-weapons ruling; ported here when the grip tables moved).
  ice_fang: 'VAR_DAGGER',
  glaciersplit: 'VAR_AXE',
  rimecrusher: 'VAR_MACE',
  frostbite: 'VAR_DAGGER',
  hoarfrost_vigil: 'VAR_STAFF',
  shard_of_everwinter: 'VAR_WAND',
  solheim_last_light_of_the_dawn: 'VAR_SWORD',
  astravyr_fang_of_the_fallen_star: 'VAR_DAGGER',
  brasscap_hatchet: 'VAR_AXE',
  knotted_oak_stave: 'VAR_STAFF',
  whittler_s_knife: 'VAR_DAGGER',
  winterbite: 'VAR_BOW',
  cinderbrand: 'VAR_SWORD',
  emberbite: 'VAR_AXE',
  smoulderfall: 'VAR_HAMMER',
  ashspark_shiv: 'VAR_DAGGER',
  forgeheart_stave: 'VAR_STAFF',
  emberwrought_wand: 'VAR_WAND',
  cinderlatch: 'VAR_CROSSBOW',
  tempered_flanged_mace: 'VAR_MACE',
  guildmark_dirk: 'VAR_DAGGER',
  brasscrown_walking_staff: 'VAR_STAFF',
  lacquered_rod: 'VAR_WAND',
  fletcher_s_guild_bow: 'VAR_BOW',
  rude_awakening_sword: 'VAR_SWORD',
  // Bow-SLOT skin with crossbow HANDLING (a gun aims, it is not drawn): the
  // grip family follows the handling, like the attach bone below.
  encore_the_second_falling_star: 'VAR_CROSSBOW',
  ...KAYKIT_SHIELD_ACCESSORIES,
};

// Per-family grip for the variant pack. The model origin IS the grip, so we attach
// at it: `lift` nudges the grip along the hand bone (tuned against the generic
// look), `maxHeight` clamps an oversized model so a long blade doesn't drag (scale
// is only ever reduced, so normal-size weapons keep their native scale and variety).
export interface VariantGrip {
  lift: number;
  maxHeight: number;
}
export const VARIANT_GRIPS: Record<string, VariantGrip> = {
  VAR_SWORD: { lift: 0.04, maxHeight: 2.0 },
  VAR_DAGGER: { lift: 0.04, maxHeight: 1.4 },
  VAR_STAFF: { lift: 0.18, maxHeight: 2.4 },
  VAR_AXE: { lift: 0.04, maxHeight: 1.5 },
  VAR_HAMMER: { lift: 0.04, maxHeight: 1.5 },
  VAR_MACE: { lift: 0.04, maxHeight: 1.5 },
  VAR_POLEARM: { lift: 0.18, maxHeight: 2.5 },
  VAR_WAND: { lift: 0.04, maxHeight: 1.2 },
  VAR_BOOK: { lift: 0.04, maxHeight: 1.2 },
  VAR_CROSSBOW: { lift: 0.04, maxHeight: 1.6 },
  VAR_BOW: { lift: 0.04, maxHeight: 2.0 },
};

export const KAYKIT_HAND_GRIPS: Record<string, { r: HandGrip; l?: HandGrip }> = {
  '1H_Axe': {
    r: { position: [0.231697, 0.382471, 0], quaternion: [0, 1, 0, 0], scale: 0.622211 },
    l: { position: [-0.231697, 0.382471, 0], quaternion: [0, 0, 0, 1], scale: 0.622211 },
  },
  '2H_Axe': {
    r: { position: [0, 0.4626, 0], quaternion: [0, 1, 0, 0], scale: 0.8623 },
  },
  '1H_Crossbow': {
    r: {
      position: [0.2286, 0.0213, -0.0012],
      quaternion: [0, 0.7071068, 0, 0.7071067],
      scale: 0.6109,
    },
  },
  '2H_Crossbow': {
    r: { position: [0.3381, 0.058, 0], quaternion: [0, 0.7071068, 0, 0.7071067], scale: 0.7204 },
  },
  '1H_Sword': {
    r: { position: [0, 0.555174, 0], quaternion: [0, 1, 0, 0], scale: 0.8876 },
    l: { position: [0, 0.555174, 0], quaternion: [0, 0, 0, 1], scale: 0.8876 },
  },
  '2H_Sword': {
    r: { position: [0, 0.8148, 0], quaternion: [0, 1, 0, 0], scale: 1.1829 },
  },
  '2H_Staff': {
    r: { position: [-0.0427, 0.1769, 0], quaternion: [0, 1, 0, 0], scale: 1.0773 },
  },
  Knife: {
    r: { position: [-0.0095, 0.378, 0], quaternion: [0, 1, 0, 0], scale: 0.6029 },
    l: { position: [0.0095, 0.378, 0], quaternion: [0, 0, 0, 1], scale: 0.6029 },
  },
  '1H_Wand': {
    r: { position: [0, 0.2174, 0], quaternion: [0, 1, 0, 0], scale: 0.4831 },
  },
  ...KAYKIT_SHIELD_GRIPS,
};

// ---------------------------------------------------------------------------
// Identification: bones, models, families
// ---------------------------------------------------------------------------

// GLTFLoader sanitizes node names (PropertyBinding strips [].:/ ), so an authored
// "handslot.r" arrives as "handslotr". Every name comparison here goes through this.
function sanitize(name: string): string {
  return name.replace(/[[\].:/]/g, '');
}

export function isHandslotBone(name: string): boolean {
  const n = sanitize(name);
  return n === 'handslotr' || n === 'handslotl';
}

export function handSide(bone: string): 'r' | 'l' {
  return sanitize(bone).endsWith('l') ? 'l' : 'r';
}

/** The `<key>` in `<key>.glb`: the key both grip tables are keyed by. */
export function modelBasename(url: string): string {
  return url.slice(url.lastIndexOf('/') + 1).replace(/\.glb$/, '');
}

export function kaykitAccessoryFor(url: string): string | null {
  return KAYKIT_WEAPON_ACCESSORY[modelBasename(url)] ?? null;
}

function accessoryNodeName(accessory: string, side: 'r' | 'l'): string {
  if (side === 'l' && accessory === 'Knife') return 'Knife_Offhand';
  if (side === 'l' && accessory === '1H_Sword') return '1H_Sword_Offhand';
  return accessory;
}

/** The built-in accessory node a rig MIGHT carry for this prop on this bone, or null
 *  when the model is not one of the known KayKit families. The caller looks the name up
 *  on the character rig and feeds whatever it found back in as `accessoryNode`, so this
 *  module stays free of any scene-graph knowledge. */
export function accessoryNodeNameFor(url: string, bone: string): string | null {
  const accessory = kaykitAccessoryFor(url);
  return accessory ? accessoryNodeName(accessory, handSide(bone)) : null;
}

function variantGripFor(url: string): VariantGrip | null {
  const accessory = kaykitAccessoryFor(url);
  return accessory ? (VARIANT_GRIPS[accessory] ?? null) : null;
}

// ---------------------------------------------------------------------------
// The resolver
// ---------------------------------------------------------------------------

/** A node transform read off a rig (bone-local), or any full placement. Scale is
 *  per-axis because a rig node's scale legitimately is. */
export interface PropTransform {
  position: [number, number, number];
  quaternion: [number, number, number, number];
  scale: [number, number, number];
}

/** What to write onto the flattened payload. An ABSENT field means "leave what the
 *  flatten step produced", which is how the weakest authored knob (`rotationY` alone)
 *  keeps the model's native scale. `rotationY` is kept distinct from `quaternion`
 *  because the legacy knob sets euler Y only. */
export interface PropPlacement {
  position?: [number, number, number];
  quaternion?: [number, number, number, number];
  rotationY?: number;
  scale?: number | [number, number, number];
}

export interface PropPlacementInput {
  /** Prop model url, e.g. `models/weapons/sword_1handed.glb`. */
  url: string;
  /** The AUTHORED carrying bone, even while stowed (the caller re-parents; the answer
   *  still keys off where the prop belongs in the hand). */
  bone: string;
  /** Authored `AttachDef` knobs, if any. */
  position?: [number, number, number];
  rotationY?: number;
  gripRef?: string;
  /** Reads a node's own local transform off the character rig by name, or null when the
   *  rig has no such node. Called at most once, and ONLY when the precedence chain below
   *  actually reaches a node lookup, so the caller never pays for a scene traversal the
   *  answer does not use. Keeping it lazy is also what keeps precedence in one place: no
   *  caller has to predict which nodes will be consulted.
   *
   *  A `gripRef` naming a node the GLB does not carry therefore resolves to no placement
   *  at all. That is a real, currently live case: the warlock's `Spellbook_open`. */
  lookupNode?: (name: string) => PropTransform | null;
  /** Native height of the FLATTENED payload, world units. Only the variant-pack clamp
   *  reads it, and only through this, so the bounding-box walk is likewise skipped
   *  whenever the answer does not depend on it. */
  measureNativeHeight?: () => number;
  /** Sheathed: the prop rides the chest bone on its back-carry transform. */
  stowed?: boolean;
}

function fromNode(out: PropPlacement, t: PropTransform): void {
  out.position = t.position;
  out.quaternion = t.quaternion;
  out.scale = t.scale;
}

/** Resolve where one prop sits, in its carrying bone's local space.
 *
 *  Precedence, strongest first. This mirrors the game's historical order EXACTLY so the
 *  extraction is behavior-preserving; the known defect in it (a family grip beating an
 *  authored per-character one) is a separate, tested change:
 *    1. the variant-pack family grip, for a handslot prop whose model has a VAR_* row
 *    2. an authored `position` / `rotationY`
 *    3. an authored `gripRef`, when the named node exists on the rig
 *    4. the KayKit hand grip: the rig's own accessory node, else the family table
 *  A sheathed handslot prop then has its position and orientation replaced by the
 *  back-carry transform, keeping whatever SCALE the pass above computed. */
export function resolvePropPlacement(input: PropPlacementInput): PropPlacement {
  const { url, bone } = input;
  const handslot = isHandslotBone(bone);
  const out: PropPlacement = {};

  const variant = handslot ? variantGripFor(url) : null;
  if (variant) {
    const t = variantGripTransform(
      input.measureNativeHeight?.() ?? 0,
      handSide(bone) === 'l',
      variant.lift,
      variant.maxHeight,
      WEAPON_GRIP_OVERRIDES[modelBasename(url)],
    );
    out.position = t.position;
    out.quaternion = t.quaternion;
    out.scale = t.scale;
  } else if (input.position || input.rotationY !== undefined) {
    if (input.position) out.position = input.position;
    if (input.rotationY !== undefined) out.rotationY = input.rotationY;
  } else if (input.gripRef) {
    const ref = input.lookupNode?.(input.gripRef) ?? null;
    if (ref) fromNode(out, ref);
  } else if (handslot) {
    const accessory = kaykitAccessoryFor(url);
    if (accessory) {
      const side = handSide(bone);
      const ref = input.lookupNode?.(accessoryNodeName(accessory, side)) ?? null;
      if (ref) {
        fromNode(out, ref);
      } else {
        const grips = KAYKIT_HAND_GRIPS[accessory];
        if (grips) {
          const grip = side === 'l' ? (grips.l ?? grips.r) : grips.r;
          out.position = grip.position;
          out.quaternion = grip.quaternion;
          out.scale = grip.scale;
        }
      }
    }
  }

  if (input.stowed && handslot) {
    // Writing a quaternion supersedes a euler-Y knob, so drop it rather than leave a
    // field a caller might apply after: the hand path behaves the same way.
    const back = backGripFor(kaykitAccessoryFor(url), handSide(bone));
    out.position = back.position;
    out.quaternion = back.quaternion;
    delete out.rotationY;
  }
  return out;
}
