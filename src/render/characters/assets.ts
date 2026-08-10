// Character asset preparation: preloads manifest glbs, assembles per-key
// model clones (accessory show/hide + weapon attachments), caches tinted
// material variants, and bakes a single static idle-pose geometry per key for
// the far-LOD / shadow-proxy path.
//
// Loading contract: fetches kick off at module import and register with the
// preload registry; main.ts awaits assetsReady() before the Renderer exists,
// so everything here can assume resolved GLTFs synchronously afterwards. The
// landing character-creation preview is the one exception: it awaits the
// narrower charactersReady() below instead (this file's boot GLBs + skin
// atlases only, with its own retries), since gating it on the site-wide
// assetsReady() left an unrelated preload failure anywhere on the site
// permanently blanking it on a cold, first-visit cache.
import * as THREE from 'three';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { offhandMirrorsWeaponSkin } from '../../sim/content/weapon_skin_rules';
import { WEAPON_SKINS } from '../../sim/content/weapon_skins';
import { retryDelayMs as gltfRetryDelayMs } from '../assets/load_retry';
import { loadGltf, loadKtx2Texture, loadTexture } from '../assets/loader';
import { registerPreload } from '../assets/preload';
import { addRimGlow, EMISSIVE_GLOW, GFX, type GfxSettings } from '../gfx';
import { applySurfaceDetail, riggedWornFamilyFor } from '../worn_stone';
import { backGripFor } from './back_grips';
import { dequantizeAttribute } from './dequantize_attribute';
import { type HandGrip, KAYKIT_SHIELD_ACCESSORIES, KAYKIT_SHIELD_GRIPS } from './held_item_grips';
import { buildMakeupDecal } from './makeup';
import {
  type AttachDef,
  characterPreloadUrls,
  itemOffhandModelUrl,
  itemWeaponModelUrl,
  manifestUrlsForGraphics,
  offhandModelUrl,
  SKIN_EMISSIVE,
  SKINS,
  SKINS_DIR,
  VISUALS,
  type VisualDef,
  visibleAttachmentsForGraphics,
  visualAssetUrlForGraphics,
  weaponSkinModelUrl,
  weaponSkinModelUrls,
} from './manifest';
import {
  bandMaterialSpec,
  DEFAULT_LOOK,
  type DyeRule,
  earringMaterialSpec,
  eyeColor,
  hairColor,
  isArmorMaterial,
  lashColor,
  lipColor,
  MAT_EYE,
  MAT_HAIR,
  MAT_LASH,
  MAT_SKIN,
  MAT_SKIN_DETAIL,
  MAT_STUBBLE,
  MORPH_SLIDER_TARGETS,
  type ModularAppearance,
  type ModularLook,
  makeupSelection,
  modularPartNames,
  morphInfluences,
  outfitDye,
  skinColor,
  stubbleDecals,
  wearsFaceDecal,
} from './modular';
import { animatedNodeNames, mergeSkinnedParts } from './rig_merge';
import { weaponSkinAttachBone, weaponSkinHandling } from './skin_attack';
import { optimizeSkinGpuLayout } from './skin_gpu_layout';
import { primeSkinnedSortSpheres } from './skinned_sort_spheres';
import { buildStubbleDecal, headNodeName } from './stubble';
import { TINTED_MATERIAL_IDLE_CACHE_MAX, TintedMaterialCache } from './tinted_material_cache_core';
import { variantGripTransform, WEAPON_GRIP_OVERRIDES } from './weapon_grip';
import { markOwnedWeaponSkinMaterials } from './weapon_skin_materials';

const DEFAULT_TINT_STRENGTH = 0.4;

// KayKit adventurer standalone weapon glbs ship a left-hand mesh offset on a
// lone child node. handslot.r/l children in the character glbs carry the
// authored grip — copy those (or this fallback table) after flattening.
const KAYKIT_WEAPON_ACCESSORY: Record<string, string> = {
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
  // drag); we attach at the origin and only clamp oversized models. VAR_* keys
  // route to applyVariantGrip (no rig node matches them).
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
  ice_fang: 'VAR_SWORD',
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
interface VariantGrip {
  lift: number;
  maxHeight: number;
}
const VARIANT_GRIPS: Record<string, VariantGrip> = {
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

const KAYKIT_HAND_GRIPS: Record<string, { r: HandGrip; l?: HandGrip }> = {
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

function isHandslotBone(name: string): boolean {
  const n = name.replace(/[[\].:/]/g, '');
  return n === 'handslotr' || n === 'handslotl';
}

function handSide(bone: string): 'r' | 'l' {
  return bone.replace(/[[\].:/]/g, '').endsWith('l') ? 'l' : 'r';
}

function kaykitAccessoryFor(url: string): string | null {
  const base =
    url
      .split('/')
      .pop()
      ?.replace(/\.glb$/, '') ?? '';
  return KAYKIT_WEAPON_ACCESSORY[base] ?? null;
}

function findAccessoryNode(root: THREE.Object3D, name: string): THREE.Object3D | null {
  return root.getObjectByName(name) ?? root.getObjectByName(name.replace(/[[\].:/]/g, '')) ?? null;
}

function accessoryNodeName(accessory: string, side: 'r' | 'l'): string {
  if (side === 'l' && accessory === 'Knife') return 'Knife_Offhand';
  if (side === 'l' && accessory === '1H_Sword') return '1H_Sword_Offhand';
  return accessory;
}

function copyAccessoryTransform(payload: THREE.Object3D, ref: THREE.Object3D): void {
  payload.position.copy(ref.position);
  payload.quaternion.copy(ref.quaternion);
  payload.scale.copy(ref.scale);
}

function applyHandGrip(
  payload: THREE.Object3D,
  root: THREE.Object3D,
  bone: string,
  url: string,
): void {
  const accessory = kaykitAccessoryFor(url);
  if (!accessory) return;
  const side = handSide(bone);
  const ref = findAccessoryNode(root, accessoryNodeName(accessory, side));
  if (ref) {
    copyAccessoryTransform(payload, ref);
    return;
  }
  const grips = KAYKIT_HAND_GRIPS[accessory];
  if (!grips) return;
  const grip = side === 'l' ? (grips.l ?? grips.r) : grips.r;
  payload.position.set(...grip.position);
  payload.quaternion.set(...grip.quaternion);
  payload.scale.setScalar(grip.scale);
}

function flattenWeaponScene(src: THREE.Object3D): THREE.Object3D {
  if (src.children.length !== 1) return src;
  const holder = new THREE.Group();
  const child = src.children[0];
  holder.scale.copy(child.scale);
  child.scale.set(1, 1, 1);
  child.position.set(0, 0, 0);
  child.rotation.set(0, 0, 0);
  src.remove(child);
  holder.add(child);
  return holder;
}

// Mainhand and actual offhand holders have separate replacement cycles, so a
// mainhand cosmetic swap cannot remove or reskin a shield or second weapon.
const SWAP_WEAPON_TAG = 'swapWeaponHolder';
const SWAP_OFFHAND_TAG = 'swapOffhandHolder';

// Marks EVERY attached prop holder (swap slots AND fixed offhands), so the
// sheathe toggle can strip and re-attach the full held set at once.
const HELD_PROP_TAG = 'heldPropHolder';

// Sheathed props re-parent onto the chest bone (shared KayKit Rig_Medium).
const STOW_BONE = 'chest';

// Grip for a variant-pack weapon. Its origin is authored AT the grip, so we attach
// at the origin (no recenter) and only clamp an oversized model so its blade does
// not drag. `lift` nudges along the hand bone; the side picks the 180-degree flip.
// A WEAPON_GRIP_OVERRIDES row (hand-tuned in the asset-pipeline inspector's grip
// bar) layers a per-weapon pos/rot/scale fine-tune on top, composed by the SAME
// pure variantGripTransform the inspector previews, so the editor fit IS the
// in-game fit. With no row the transform is exactly the bare lift/flip/clamp.
const variantBox = new THREE.Box3();
function variantGripFor(url: string): VariantGrip | null {
  const accessory = kaykitAccessoryFor(url);
  return accessory ? (VARIANT_GRIPS[accessory] ?? null) : null;
}
function modelBasename(url: string): string {
  return url.slice(url.lastIndexOf('/') + 1).replace(/\.glb$/, '');
}
function applyVariantGrip(
  payload: THREE.Object3D,
  bone: string,
  grip: VariantGrip,
  url: string,
): void {
  variantBox.setFromObject(payload);
  const height = variantBox.max.y - variantBox.min.y;
  const t = variantGripTransform(
    height,
    handSide(bone) === 'l',
    grip.lift,
    grip.maxHeight,
    WEAPON_GRIP_OVERRIDES[modelBasename(url)],
  );
  payload.position.set(t.position[0], t.position[1], t.position[2]);
  payload.quaternion.set(t.quaternion[0], t.quaternion[1], t.quaternion[2], t.quaternion[3]);
  payload.scale.setScalar(t.scale);
}

function attachProp(
  root: THREE.Object3D,
  bone: THREE.Object3D,
  att: AttachDef,
  swapKind: 'mainhand' | 'offhand' | null = null,
  stowed = false,
): THREE.Object3D {
  const payload = flattenWeaponScene(cloneSkinned(resolvedGltf(att.url).scene));
  primeSkinnedSortSpheres(payload);
  payload.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) o.userData.weaponMesh = true;
  });
  if (swapKind === 'mainhand') {
    payload.userData[SWAP_WEAPON_TAG] = true;
    payload.userData.heldSlot = 0;
  } else if (swapKind === 'offhand') {
    payload.userData[SWAP_OFFHAND_TAG] = true;
    payload.userData.heldSlot = 1;
  }
  payload.userData[HELD_PROP_TAG] = true;
  const variantGrip = isHandslotBone(att.bone) ? variantGripFor(att.url) : null;
  if (variantGrip) {
    applyVariantGrip(payload, att.bone, variantGrip, att.url);
  } else if (att.position || att.rotationY !== undefined) {
    if (att.position) payload.position.set(...att.position);
    if (att.rotationY !== undefined) payload.rotation.y = att.rotationY;
  } else if (att.gripRef) {
    const ref = findAccessoryNode(root, att.gripRef);
    if (ref) copyAccessoryTransform(payload, ref);
  } else if (isHandslotBone(att.bone)) {
    applyHandGrip(payload, root, att.bone, att.url);
  }
  // Sheathed: override where the prop SITS (on-back position/lean, chest-bone
  // space; the caller resolved the chest bone) but keep the SCALE the normal
  // grip pass just computed, so variant-pack size clamps carry over.
  if (stowed && isHandslotBone(att.bone)) {
    const grip = backGripFor(kaykitAccessoryFor(att.url), handSide(att.bone));
    payload.position.set(...grip.position);
    payload.quaternion.set(...grip.quaternion);
  }
  bone.add(payload);
  return payload;
}

// The AttachDef for the swappable mainhand slot, with the equipped item's model
// substituted when one is mapped (else the class default). An applied Season 1
// Armory weapon skin wins over the item model (that is the point of the skin).
// The grip resolves from the substituted model's own family
// (KAYKIT_WEAPON_ACCESSORY + WEAPON_GRIP_OVERRIDES), so any base position/
// rotationY/gripRef override is dropped for the substituted model.
function swapAttachDef(
  base: AttachDef,
  weaponItemId: string | null | undefined,
  weaponSkinId: string | null | undefined = null,
): AttachDef {
  // A DISPLAYED ranged skin takes the ranged hand rule here too, not only on
  // the fixed-attach path (rangedSkinAttachDef): the Combat Mech is a swap-slot
  // body that a hunter can wear, so a drawn bow must move to the left handslot
  // (the front arm) on it exactly as it does on the hunter rig. Keyed off the
  // RESIDENT skin url, so a skin still streaming leaves the equipped item's
  // model in its authored hand rather than relocating a sword.
  const skinUrl = residentOrEnsure(weaponSkinModelUrl(weaponSkinId));
  if (skinUrl) {
    const skin = weaponSkinId ? WEAPON_SKINS[weaponSkinId] : null;
    const bone = skin ? weaponSkinAttachBone(weaponSkinHandling(skin), base.bone) : base.bone;
    return { url: skinUrl, bone };
  }
  const url = itemWeaponModelUrl(weaponItemId);
  return url ? { url, bone: base.bone } : base;
}

// The AttachDef for the actual equipped offhand. Its model is the offhand item's
// own, EXCEPT when the active mainhand skin mirrors onto it (a matching-type
// offhand weapon), in which case the offhand renders the skin too.
// Shields, held offhands (orbs/tomes), and different-type weapons never mirror
// (offhandModelUrl gates it on the pure rule) and keep their item model.
function offhandAttachDef(
  base: AttachDef,
  offhandItemId: string | null | undefined,
  weaponSkinId: string | null | undefined = null,
): AttachDef | null {
  const url = offhandModelUrl(offhandItemId, weaponSkinId);
  // The mirrored-skin arm of offhandModelUrl can name a streamed skin GLB; the
  // item's own offhand model is always resident, so degrade to it.
  const resident = residentOrEnsure(url) ?? itemOffhandModelUrl(offhandItemId);
  return resident ? { url: resident, bone: base.bone } : null;
}

// Classes without weaponSlots keep a FIXED weapon visual (the hunter's ranged
// crossbow). A bow/crossbow skin replaces that fixed attach instead of a
// swappable slot, so those attaches join the swap/stale cycle too.
const RANGED_SWAP_BASENAMES = new Set(['crossbow_1handed', 'crossbow_2handed']);

function attachBasename(att: AttachDef): string {
  return modelBasename(att.url);
}

function isRangedSwapAttach(att: AttachDef): boolean {
  return RANGED_SWAP_BASENAMES.has(attachBasename(att));
}

// The fixed ranged attach with a bow/crossbow skin substituted, or null to keep
// the base def (no skin, or a skin of a non-ranged type). The bone follows the
// skin's HANDLING: drawn bows move to the left handslot (the draw animation's
// front arm); crossbow handling (real crossbows, and bow-slot guns that aim
// like them) keeps the base bone.
function rangedSkinAttachDef(base: AttachDef, weaponSkinId: string | null): AttachDef | null {
  if (!weaponSkinId) return null;
  const def = WEAPON_SKINS[weaponSkinId];
  if (!def || (def.weaponType !== 'bow' && def.weaponType !== 'crossbow')) return null;
  const url = residentOrEnsure(weaponSkinModelUrl(weaponSkinId));
  // Not resident yet: no override, the fixed class weapon renders until the
  // skin GLB streams in and the next rebuild applies it.
  return url ? { url, bone: weaponSkinAttachBone(weaponSkinHandling(def), base.bone) } : null;
}

function resolveBone(root: THREE.Object3D, name: string): THREE.Object3D | null {
  return root.getObjectByName(name) ?? root.getObjectByName(name.replace(/[[\].:/]/g, '')) ?? null;
}

// ---------------------------------------------------------------------------
// Preload
// ---------------------------------------------------------------------------

const gltfByUrl = new Map<string, GLTF>();

function assetUrl(url: string): string {
  return visualAssetUrlForGraphics(url, GFX.standardMaterials);
}

// Preload the character/weapon GLBs. characterPreloadUrls() is tier-INDEPENDENT (see
// manifest.ts): buildProps-style placement resolves asset URLs against the LIVE GFX
// tier via assetUrl(), and resolvedGltf() throws "character asset not preloaded"
// synchronously, so the preload set must be a superset of any tier's placement set or
// world entry crashes (the character-side twin of the v0.16.0 props P0).
const allPreloadUrls = characterPreloadUrls(false);

// Every iOS WebKit host (Mobile Safari, any other iOS browser, and the packaged
// native app: see GFX.iosMemoryProfile in gfx.ts) carves the mob bodies out of
// the boot gate and STREAMS them after first frame instead. They are the
// heaviest character content (creature + skeleton-family GLBs with embedded
// 1024-class atlases; 47 files, and by far the largest share of the decoded
// character residency) and nothing on the launcher, the character-select
// preview, or the player's own spawn needs them: mob views are created
// fail-soft (createCharacterVisual returns null and view_create_retry retries,
// the #2079 seam; mounts already stream exactly this way), so a mob whose GLB
// is still arriving pops in a beat later instead of crashing anything.
// Measured on an iPhone 17 Pro, decoding the full set inside the entry gate put
// WebContent at 1.54 GB before the renderer ever existed; streaming defers that
// mass to after the entry spike has cleared, and that WebContent ceiling is
// identical whether the process hosts Safari or the packaged app. Weapons and
// NPC bodies stay in the gate: the char-select preview builds CharacterVisual
// DIRECTLY (not through the fail-soft factory), so a missing held-weapon GLB
// there would throw.
const STREAMED_URL_PREFIXES = ['models/creatures/', 'models/chars/enemies/'];
// Armory weapon-SKIN models stream too (64 of the 78 weapon files): they are
// cosmetic replacements for base weapons that always stay in the gate, so a
// wearer whose skin GLB has not arrived yet degrades to their base weapon (the
// swapAttachDef guard below) instead of throwing. Base item weapons stay
// resident so the player's own hands are never empty at spawn.
const streamedSkinUrls = new Set(weaponSkinModelUrls());
const streamableUrls = allPreloadUrls.filter(
  (url) =>
    STREAMED_URL_PREFIXES.some((prefix) => url.includes(prefix)) || streamedSkinUrls.has(url),
);
let streamedUrls = GFX.iosMemoryProfile ? streamableUrls : [];
let streamedUrlSet = new Set(streamedUrls);
const preloadUrls = allPreloadUrls.filter((url) => !streamedUrlSet.has(url));
const characterLoadTasks = new Map<string, Promise<void>>();

function prepareCharacterUrl(url: string): Promise<void> {
  if (gltfByUrl.has(url)) return Promise.resolve();
  const existing = characterLoadTasks.get(url);
  if (existing) return existing;
  const task = loadGltf(url)
    .then((gltf) => {
      gltfByUrl.set(url, gltf);
    })
    .catch((err) => {
      characterLoadTasks.delete(url);
      throw err;
    });
  characterLoadTasks.set(url, task);
  return task;
}

/** True when a character GLB is resident and attach/build paths may resolve it. */
function characterAssetResident(url: string): boolean {
  return gltfByUrl.has(assetUrl(url));
}

/** Kick a streamed character GLB (memoized by loadGltf) and index it on arrival. */
export function ensureCharacterUrl(url: string | null | undefined): void {
  if (!url || characterAssetResident(url)) return;
  void loadGltf(url)
    .then((g) => {
      // Keyed on the RAW url like the eager boot loop; readers resolve through
      // assetUrl(url). Consistent today because no streamed url is aliased
      // (LOW_URL_ALIAS only rewrites the rogue body, never streamed); an alias
      // added inside models/creatures/ or the skin set would make this asset
      // look permanently non-resident, so key any such future entry resolved.
      gltfByUrl.set(url, g);
    })
    .catch(() => undefined);
}

/** A streamed url that has not arrived yet must degrade, never throw: return
 *  null so the caller falls back (base weapon / no ranged override) and kick
 *  the fetch so the cosmetic appears on the next swap or view rebuild. Eager
 *  platforms never take the branch: their streamed set is empty. */
function residentOrEnsure(url: string | null): string | null {
  if (!url) return null;
  if (!streamedUrlSet.has(url) || characterAssetResident(url)) return url;
  ensureCharacterUrl(url);
  return null;
}

for (const url of preloadUrls) {
  registerPreload(prepareCharacterUrl(url));
}

let streamedStarted = false;
/**
 * Start the post-entry mob-body stream (idempotent; returns how many fetches
 * this call started). main.ts calls it once the entry is past its allocation
 * spike (prewarm complete). Empty everywhere but iOS WebKit hosts (Safari,
 * other iOS browsers, and the packaged app), where the boot gate above
 * deliberately excluded these urls. A failed fetch re-arms
 * when a visual build next needs the body: resolvedGltf kicks
 * ensureCharacterUrl for a non-resident streamed url before its fail-soft
 * throw, and the view-create retry gate re-attempts the build.
 */
export function startStreamedCharacterPreloads(): number {
  if (streamedStarted) return 0;
  streamedStarted = true;
  for (const url of streamedUrls) {
    void loadGltf(url)
      .then((g) => {
        // Raw-url key on purpose: see the keying note in ensureCharacterUrl.
        gltfByUrl.set(url, g);
      })
      .catch(() => undefined);
  }
  return streamedUrls.length;
}

// Skin textures: player alternate body atlases, loaded sRGB + flipY=false so
// they line up with the glTF-embedded UVs. These load on every tier so skin
// selection previews and cosmetics keep distinct colours even on low graphics.
const skinTexByUrl = new Map<string, THREE.Texture>();
const skinEmisTexByUrl = new Map<string, THREE.Texture>();

// scripts/assets/compress_standalone_textures.mjs ships a `.ktx2` sibling next
// to every atlas under this prefix, so those ~34 1024x1024 atlases stay
// GPU-compressed in memory instead of decoding to full RGBA bitmaps (the
// eagerSkinAtlases comment below has the numbers). The player_mech chromas
// (MECH_DIR) are not under this prefix, stay on the plain PNG path, and are
// out of scope here: they are lazyPreload-only, never part of the eager boot
// sweep this pass targets.
const KTX2_ATLAS_PREFIX = `${SKINS_DIR}/`;

/** Load a skin/emissive atlas with the glTF body-UV conventions (sRGB, no flip). */
function loadSkinTexInto(url: string, into: Map<string, THREE.Texture>): Promise<void> {
  const load = url.startsWith(KTX2_ATLAS_PREFIX)
    ? loadKtx2Texture(`${url.slice(0, -'.png'.length)}.ktx2`)
    : loadTexture(url, { srgb: true });
  return load.then((t) => {
    t.flipY = false;
    t.needsUpdate = true;
    into.set(url, t);
  });
}

// Boot sweep skips lazyPreload keys (e.g. the cosmetic mech) - those load on
// demand via preloadMechAssets().
const bootSkinUrls = new Set<string>();
for (const [key, list] of Object.entries(SKINS)) {
  if (VISUALS[key]?.lazyPreload) continue;
  for (const u of list) if (u) bootSkinUrls.add(u);
}
// Every iOS WebKit host (Safari, other iOS browsers, and the packaged app) defers
// the whole alternate-atlas sweep out of the boot gate: ~34 1024x1024 atlases
// decode to well over 100 MB of RGBA inside the same WebContent process whose
// jetsam ceiling the entry spike already presses against (the iPhone 13 report),
// and almost all of them are OTHER players' cosmetics. skinTexture() fails soft
// to the embedded default and every apply site heals through ensureSkinTexture()
// (visual.ts constructor + setSkin, portrait.ts before its one-shot snapshot),
// so a deferred atlas costs a brief fallback, never a crash or a stall. Both
// profile hints derive from static boot signals (never the tier), so this
// import-time read cannot drift from the live profile the way an import-time
// TIER read would (the farmCrate P0).
const eagerSkinAtlases = !(GFX.iosMemoryProfile || GFX.tightMemory);
if (eagerSkinAtlases) {
  for (const url of bootSkinUrls) registerPreload(loadSkinTexInto(url, skinTexByUrl));
}

/** Prepare character sources and cosmetic atlases selected by an explicit target profile. */
export async function prepareCharacterProfileAssets(target: Readonly<GfxSettings>): Promise<void> {
  const nextStreamedUrls = target.iosMemoryProfile ? streamableUrls : [];
  const nextStreamedSet = new Set(nextStreamedUrls);
  const requiredGltf = manifestUrlsForGraphics(target.standardMaterials).filter(
    (url) => !nextStreamedSet.has(url),
  );
  const skinTasks =
    target.iosMemoryProfile || target.tightMemory
      ? []
      : [...bootSkinUrls].map((url) =>
          skinTexByUrl.has(url) ? Promise.resolve() : loadSkinTexInto(url, skinTexByUrl),
        );
  await Promise.all([...requiredGltf.map(prepareCharacterUrl), ...skinTasks]);
  const nextSignature = nextStreamedUrls.join('|');
  if (nextSignature !== streamedUrls.join('|')) streamedStarted = false;
  streamedUrls = nextStreamedUrls;
  streamedUrlSet = nextStreamedSet;
}

/** Resolve once every boot-time character GLB + skin atlas is cached, retrying
 *  whatever is still missing instead of depending on the site-wide assetsReady()
 *  barrier. That barrier is one shared promise over EVERY registered preload
 *  (terrain, dungeon, foliage, ...): an unrelated failure there must not sink the
 *  character-creation preview, and loadGltf/loadTexture already evict a failed
 *  URL from their own cache on rejection, so a fresh call here genuinely
 *  re-fetches rather than re-awaiting a permanently rejected promise. A transient
 *  failure is far more likely on a cold, first-visit cache (no warm HTTP cache to
 *  fall back on), which is exactly when this matters most.
 *
 *  Each outer attempt here already follows loadGltf's own three inner attempts
 *  (400/800ms backoff, see load_retry.ts), so a URL that reaches this loop's
 *  retry has already spent that whole window failing. Waiting again before the
 *  next outer attempt (same schedule, reused) widens the retry window instead
 *  of hammering a still-flaky connection three more times back to back in one
 *  tick. */
export async function charactersReady(maxAttempts = 3): Promise<void> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const missingGltf = preloadUrls.filter((u) => !gltfByUrl.has(assetUrl(u)));
    // Deferred atlases (every iOS WebKit host) are not boot assets: gating the
    // preview on them would re-create the exact entry-footprint spike the deferral removes.
    const missingSkins = eagerSkinAtlases
      ? [...bootSkinUrls].filter((url) => !skinTexByUrl.has(url))
      : [];
    if (missingGltf.length === 0 && missingSkins.length === 0) return;
    if (attempt > 1) {
      await new Promise((resolve) => setTimeout(resolve, gltfRetryDelayMs(attempt)));
    }
    const results = await Promise.allSettled([
      ...missingGltf.map((u) => loadGltf(u).then((g) => void gltfByUrl.set(u, g))),
      ...missingSkins.map((u) => loadSkinTexInto(u, skinTexByUrl)),
    ]);
    if (attempt === maxAttempts) {
      const failed = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
      if (failed.length > 0) {
        throw new Error(
          `character preview assets failed to load (${failed.length}): ${failed.map((f) => String(f.reason)).join('; ')}`,
        );
      }
    }
  }
}

/** Resolved skin texture for a visual key + skin index, or null for the model's
 *  embedded default (index 0, unknown key, or an atlas that is not loaded yet). */
export function skinTexture(key: string, skinIndex: number): THREE.Texture | null {
  const url = SKINS[key]?.[skinIndex] ?? null;
  return url ? (skinTexByUrl.get(url) ?? null) : null;
}

/** Ensure the alternate atlas for (key, skinIndex) is loaded. Returns a promise
 *  that resolves once it is cached (so the caller can re-read `skinTexture` and
 *  re-apply), or null when there is nothing to wait for — the skin has no atlas
 *  (embedded default) or it is already loaded. Hardens live skin swaps against a
 *  not-yet-loaded atlas (otherwise the body shows the default until a relog). */
export function ensureSkinTexture(key: string, skinIndex: number): Promise<void> | null {
  // applySkinMaterials consumes BOTH the base atlas and (when the skin has one)
  // the emissive atlas — warm whichever of the two is missing so a glow skin
  // doesn't re-apply with a not-yet-loaded emissive map.
  const baseUrl = SKINS[key]?.[skinIndex] ?? null;
  const emisUrl = SKIN_EMISSIVE[key]?.[skinIndex] ?? null;
  const pending: Promise<void>[] = [];
  if (baseUrl && !skinTexByUrl.has(baseUrl)) pending.push(loadSkinTexInto(baseUrl, skinTexByUrl));
  if (emisUrl && !skinEmisTexByUrl.has(emisUrl))
    pending.push(loadSkinTexInto(emisUrl, skinEmisTexByUrl));
  if (pending.length === 0) return null;
  return Promise.all(pending).then(() => undefined);
}

/** Resolved emissive (glow) map for a visual key + skin index, or null when the
 *  skin has no glow (most do) / it isn't loaded / low tier. */
export function skinEmissiveTexture(key: string, skinIndex: number): THREE.Texture | null {
  const url = SKIN_EMISSIVE[key]?.[skinIndex] ?? null;
  return url ? (skinEmisTexByUrl.get(url) ?? null) : null;
}

// Lazy fetch for cosmetic-only bodies (the Combat Mech) — the GLB plus every
// chroma + emissive map. Memoized: opening the preview repeatedly is free. Kept
// out of the boot sweep so the ~4 MB asset set never delays every client's load.
let mechAssetsPromise: Promise<void> | null = null;
export function preloadMechAssets(): Promise<void> {
  if (mechAssetsPromise) return mechAssetsPromise;
  const def = VISUALS.player_mech;
  if (!def) return Promise.resolve();
  const jobs: Promise<unknown>[] = [
    loadGltf(def.url).then((g) => {
      gltfByUrl.set(def.url, g);
    }),
  ];
  // Clip donors too (the bow draw): prepareVisual resolves every animUrls entry
  // and THROWS on one that is not resident. The mech's donor happens to be the
  // hunter's as well, so the eager sweep covers it today, but a lazyPreload def
  // must not depend on another def staying eager to load its own clips.
  for (const url of def.animUrls ?? []) {
    jobs.push(
      loadGltf(url).then((g) => {
        gltfByUrl.set(assetUrl(url), g);
      }),
    );
  }
  for (const url of SKINS.player_mech ?? []) if (url) jobs.push(loadSkinTexInto(url, skinTexByUrl));
  if (GFX.standardMaterials) {
    for (const url of SKIN_EMISSIVE.player_mech ?? [])
      if (url) jobs.push(loadSkinTexInto(url, skinEmisTexByUrl));
  }
  mechAssetsPromise = Promise.all(jobs).then(() => undefined);
  return mechAssetsPromise;
}

// Lazy fetch for the Training Dummy (models/creatures/training_dummy.glb):
// it appears in exactly one hub (zone3.ts, count: 1), so like the mech it is
// kept out of the eager boot sweep. Unlike the mech, nothing previously
// triggered this load: Renderer.createView called resolvedGltf() directly
// and threw "character asset not preloaded" every frame once a dummy became
// a view candidate, permanently stalling Renderer.sync() (the screen froze
// while the sim tick and audio, on a separate per-frame path, kept running).
// Mirrors preloadMechAssets/mechAssetsReady: memoized, no skin/emissive maps
// needed since the dummy has no cosmetic variants.
let trainingDummyAssetsPromise: Promise<void> | null = null;
export function preloadTrainingDummyAssets(): Promise<void> {
  if (trainingDummyAssetsPromise) return trainingDummyAssetsPromise;
  const def = VISUALS.mob_training_dummy;
  if (!def) return Promise.resolve();
  trainingDummyAssetsPromise = loadGltf(def.url)
    .then((g) => {
      gltfByUrl.set(def.url, g);
    })
    .then(() => undefined);
  return trainingDummyAssetsPromise;
}

export function trainingDummyAssetsReady(): boolean {
  const def = VISUALS.mob_training_dummy;
  return !!def && gltfByUrl.has(assetUrl(def.url));
}

export function mechAssetsReady(): boolean {
  const def = VISUALS.player_mech;
  if (!def || !gltfByUrl.has(assetUrl(def.url))) return false;
  // Clip donors gate readiness too: prepareVisual resolves them, so reporting
  // ready without them turns the first mech build into a throw.
  if (!(def.animUrls ?? []).every((url) => gltfByUrl.has(assetUrl(url)))) return false;
  const skinsReady = (SKINS.player_mech ?? []).every((url) => !url || skinTexByUrl.has(url));
  if (!GFX.standardMaterials) return skinsReady;
  return (
    skinsReady &&
    (SKIN_EMISSIVE.player_mech ?? []).every((url) => !url || skinEmisTexByUrl.has(url))
  );
}

// Lazy fetch for rideable mount GLBs (the mech pattern, per visual key): a
// mount loads on the first sight of a rider, so eight mount models never
// weigh on every client's boot. Memoized per key; mounts have no skin or
// emissive atlases, so the GLB is the whole job.
const mountAssetPromises = new Map<string, Promise<void>>();
export function preloadMountAssets(visualKey: string): Promise<void> {
  const existing = mountAssetPromises.get(visualKey);
  if (existing) return existing;
  const def = VISUALS[visualKey];
  if (!def) return Promise.resolve();
  const job = loadGltf(def.url).then((g) => {
    gltfByUrl.set(def.url, g);
  });
  mountAssetPromises.set(visualKey, job);
  return job;
}

export function mountAssetsReady(visualKey: string): boolean {
  const def = VISUALS[visualKey];
  return !!def && gltfByUrl.has(assetUrl(def.url));
}

/** Dev-channel residency accounting sources (see assets/residency_budget.ts). */
export function characterResidencySources(): { parsedScenes: THREE.Object3D[] } {
  return { parsedScenes: [...gltfByUrl.values()].map((g) => g.scene) };
}

function resolvedGltf(url: string): GLTF {
  const resolvedUrl = assetUrl(url);
  const g = gltfByUrl.get(resolvedUrl);
  if (!g) {
    // A streamed body whose stream fetch failed re-arms here: the fail-soft
    // visual build catches the throw, the retry gate re-attempts, and each
    // attempt re-kicks the fetch (the mount lazy-load pattern; loadGltf
    // evicts rejected promises so the re-call really re-fetches). A
    // non-streamed miss stays a loud preload-set bug: no masking fetch.
    if (streamedUrlSet.has(url)) ensureCharacterUrl(url);
    throw new Error(`character asset not preloaded: ${resolvedUrl}`);
  }
  return g;
}

// ---------------------------------------------------------------------------
// Per-url source optimization: KayKit characters ship several skinned body parts
// sharing one skeleton and one material — merge them into a single SkinnedMesh
// once per asset so every instance costs ~1 body draw instead of ~9 (and one
// Skeleton / bone texture instead of ~9). See rig_merge.ts for why the parts'
// per-primitive bind data has to be rebaked first.
// ---------------------------------------------------------------------------

const optimizedSceneCache = new Map<string, THREE.Object3D>();

function optimizedScene(url: string): THREE.Object3D {
  const hit = optimizedSceneCache.get(url);
  if (hit) return hit;
  const source = resolvedGltf(url);
  const clips = [...source.animations];
  for (const def of Object.values(VISUALS)) {
    if (def.url !== url) continue;
    for (const animationUrl of def.animUrls ?? []) {
      const animationSource = gltfByUrl.get(assetUrl(animationUrl));
      if (animationSource) clips.push(...animationSource.animations);
    }
  }
  const root = cloneSkinned(source.scene);
  mergeSkinnedParts(root, animatedNodeNames(clips));
  optimizeSkinGpuLayout(root);
  primeSkinnedSortSpheres(root);
  optimizedSceneCache.set(url, root);
  return root;
}

// ---------------------------------------------------------------------------
// Clone assembly: accessory visibility + weapon attachments
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Modular composition
//
// The modular GLB carries EVERY part (both genders, every hair/brow, every
// armour slot piece) on one shared Rig_Medium. A composed body is the parsed
// scene pruned to the picked nodes and then run through the same
// mergeSkinnedParts pass as a class rig, so a fully-kitted character still
// costs one draw per MATERIAL (skin / hair / eye / plate), not one per part.
// The pruned+merged result is cached per part set, because most players share a
// handful of loadouts; only the recolour below is per character, and that is a
// material swap over shared geometry.
// ---------------------------------------------------------------------------

// Never evicted, matching the shared per-asset caches this file already keeps
// (see src/render/characters/CLAUDE.md): SkeletonUtils clones SHARE geometry
// with their source, so dropping a variant would strand any live character
// still drawn from it. Growth is bounded by the part-set combinatorics
// (gender x hair x brows x worn slots), and creation only walks a few dozen.
const modularVariantCache = new Map<string, THREE.Object3D>();
/** Dev-only tripwire on that growth (see the warn at the bottom of the builder). */
const MODULAR_VARIANT_WARN_AT = 64;

function modularVariant(url: string, names: readonly string[]): THREE.Object3D {
  const key = `${url}|${names.join(',')}`;
  const hit = modularVariantCache.get(key);
  if (hit) return hit;
  const root = cloneSkinned(resolvedGltf(url).scene);
  const keep = new Set(names);
  const drop: THREE.Object3D[] = [];
  root.traverse((o) => {
    if (!(o as THREE.SkinnedMesh).isSkinnedMesh) return;
    if (keep.has(o.name)) return;
    // A part with more than one MATERIAL exports as a multi-primitive glTF mesh,
    // and GLTFLoader expands that into a GROUP named after the node holding one
    // SkinnedMesh per primitive, each named after the mesh datablock, not the
    // node. The mouth is the only such part (skin for the lips, dark for the
    // mouth line and cavity, white for the teeth), and matching on the mesh's
    // own name alone dropped every one of them: the parts list asks for
    // `M_Mouth_neutral` and the meshes are called `M_Mouth_neutral011`.
    if (o.parent && keep.has(o.parent.name)) return;
    drop.push(o);
  });
  for (const o of drop) o.removeFromParent();
  // the Group an unpicked multi-primitive part arrived in is now empty
  const empty: THREE.Object3D[] = [];
  root.traverse((o) => {
    if (o !== root && o.type === 'Group' && o.children.length === 0) empty.push(o);
  });
  for (const o of empty) o.removeFromParent();
  mergeSkinnedParts(root);
  primeSkinnedSortSpheres(root);
  modularVariantCache.set(key, root);
  // No silent growth: the key is the whole discrete part set (gender x eyes x
  // lashes x mouth x ears x brows x hair x beard x earrings x worn slots), and
  // Randomize rolls most of those at once, so a long creation session keeps a
  // merged body per combination it visited. Eviction is not the fix (clones
  // share geometry with the cached variant, so dropping one strands any live
  // character drawn from it): if this ever fires in anger the answer is a
  // variant budget on the creator. Say so rather than growing quietly.
  if (import.meta.env?.DEV && modularVariantCache.size === MODULAR_VARIANT_WARN_AT) {
    console.warn(
      `[modular] ${MODULAR_VARIANT_WARN_AT} composed variants cached this session (never evicted)`,
    );
  }
  return root;
}

// Bounded, because a colour WHEEL is a continuous input: dragging it emits a
// new hex every pointermove, and each distinct hex would otherwise strand a
// material here forever. (Its downstream twin in tintedMaterial's cache, keyed
// off this material's uuid, becomes a dead-source entry when the LRU evicts
// here; the tinted cache reclaims those through its own idle bound, see
// tinted_material_cache_core.ts.) An LRU keeps a drag's worth of shades warm,
// re-picking a recent colour is still free, and disposes what falls out.
const RECOLOR_CACHE_MAX = 48;
const recolorCache = new Map<string, THREE.Material>();

/**
 * The outfit-colorway dye, as a shader layer on a clone of an armour material.
 *
 * The class atlases ship ktx2-compressed, so a colorway cannot be painted into
 * the pixels, instead the fragment stage remaps HSV zones of the atlas right
 * after the map sample. A spec is a list of up to MAX_DYE_RULES rules; each
 * selects a zone (hue band + sat/val smoothstep windows, measured off the
 * atlases, steel, gold trim, leather, the set's cloth band) and remaps
 * hue/sat/val inside it. The additive sat/val terms are what let near-gray
 * steel take real gold or bone colour, a legacy hue colorway is one rule
 * whose windows reproduce the old single-band dye exactly.
 *
 * Every rule is evaluated from the ORIGINAL texel and the results are blended
 * in sequence, so overlapping selector edges cross-fade instead of compounding.
 *
 * One uniform-driven program serves every set and every colorway: the hook is
 * byte-identical across clones and customProgramCacheKey pins the key, so
 * picking through the customizer's swatches never compiles a second program.
 */
interface ArmorDyeSpec {
  rules: DyeRule[];
}

const MAX_DYE_RULES = 5;

/** Flatten a spec into the fixed-size uniform arrays the shader reads: per
 *  rule A=(ref, band, satLo0, satLo1), B=(satHi0, satHi1, valLo0, valLo1),
 *  C=(valHi0, valHi1, hueTarget, hueMode), D=(satMul, satAdd, valMul, valAdd).
 *  Unused slots get zero weight via an empty hue band. */
function dyeUniforms(dye: ArmorDyeSpec): {
  a: number[];
  b: number[];
  c: number[];
  d: number[];
  n: number;
} {
  const a: number[] = [];
  const b: number[] = [];
  const c: number[] = [];
  const d: number[] = [];
  const rules = dye.rules.slice(0, MAX_DYE_RULES);
  for (let i = 0; i < MAX_DYE_RULES; i++) {
    const r = rules[i];
    if (!r) {
      a.push(0, -1, 0, 0);
      b.push(0, 0, 0, 0);
      c.push(0, 0, 0, 0);
      d.push(1, 0, 1, 0);
      continue;
    }
    const mode = r.hueMode === 'keep' ? 0 : r.hueMode === 'abs' ? 1 : 2;
    a.push(r.ref, r.band, r.sat[0], r.sat[1]);
    b.push(r.sat[2], r.sat[3], r.val[0], r.val[1]);
    c.push(r.val[2], r.val[3], r.hue, mode);
    d.push(r.satMul, r.satAdd, r.valMul, r.valAdd);
  }
  return { a, b, c, d, n: rules.length };
}

/** Attach the dye hook to a material IN PLACE, recording a JSON-safe spec in
 *  userData: Material.clone() copies userData but silently DROPS
 *  onBeforeCompile (the worn_stone precedent), and tintedMaterial() clones
 *  again downstream of recolored(), so every clone site re-attaches from the
 *  spec it finds. */
function attachArmorDye(mat: THREE.MeshStandardMaterial, dye: ArmorDyeSpec): void {
  mat.userData.armorDye = {
    rules: dye.rules.map((r) => ({ ...r, sat: [...r.sat], val: [...r.val] })),
  };
  // Compose with whatever hook the material may already carry (the
  // surface-detail layer composes the same way from its side), and fold the
  // previous program key in rather than clobbering it.
  const prev = mat.onBeforeCompile;
  const prevKey = typeof prev === 'function' ? prev.toString() : '';
  const u = dyeUniforms(dye);
  mat.onBeforeCompile = (shader, renderer) => {
    prev?.call(mat, shader, renderer);
    shader.uniforms.uDyeA = { value: u.a };
    shader.uniforms.uDyeB = { value: u.b };
    shader.uniforms.uDyeC = { value: u.c };
    shader.uniforms.uDyeD = { value: u.d };
    shader.uniforms.uDyeCount = { value: u.n };
    shader.fragmentShader = shader.fragmentShader
      .replace(
        'void main() {',
        `uniform vec4 uDyeA[${MAX_DYE_RULES}];
uniform vec4 uDyeB[${MAX_DYE_RULES}];
uniform vec4 uDyeC[${MAX_DYE_RULES}];
uniform vec4 uDyeD[${MAX_DYE_RULES}];
uniform int uDyeCount;
vec3 wocRgb2Hsv(vec3 c) {
  vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
  float d = q.x - min(q.w, q.y);
  float e = 1.0e-10;
  return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}
vec3 wocHsv2Rgb(vec3 c) {
  vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}
// The dye works in sRGB: diffuseColor is LINEAR after map_fragment, and the
// zone selectors are calibrated against the atlases' sRGB values (a pale
// gold that measures s=0.31 in sRGB reads s=0.57 in linear, selectors
// written for one space silently miss in the other).
vec3 wocLin2Srgb(vec3 c) { return pow(max(c, vec3(0.0)), vec3(1.0 / 2.2)); }
vec3 wocSrgb2Lin(vec3 c) { return pow(max(c, vec3(0.0)), vec3(2.2)); }
void main() {`,
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
{
  vec3 dyeSrgb = wocLin2Srgb(diffuseColor.rgb);
  vec3 dyeHsv = wocRgb2Hsv(dyeSrgb);
  float dyeHueDeg = dyeHsv.x * 360.0;
  vec3 dyeOut = dyeSrgb;
  for (int i = 0; i < ${MAX_DYE_RULES}; i++) {
    if (i >= uDyeCount) break;
    float dHue = mod(dyeHueDeg - uDyeA[i].x + 540.0, 360.0) - 180.0;
    float w = 1.0 - smoothstep(uDyeA[i].y * 0.7, uDyeA[i].y, abs(dHue));
    w *= smoothstep(uDyeA[i].z, uDyeA[i].w, dyeHsv.y) * (1.0 - smoothstep(uDyeB[i].x, uDyeB[i].y, dyeHsv.y));
    w *= smoothstep(uDyeB[i].z, uDyeB[i].w, dyeHsv.z) * (1.0 - smoothstep(uDyeC[i].x, uDyeC[i].y, dyeHsv.z));
    if (w > 0.001) {
      float mode = uDyeC[i].w;
      float h = mode < 0.5 ? dyeHueDeg : mode < 1.5 ? uDyeC[i].z : uDyeC[i].z + dHue;
      vec3 dyed = wocHsv2Rgb(vec3(
        mod(h, 360.0) / 360.0,
        clamp(dyeHsv.y * uDyeD[i].x + uDyeD[i].y, 0.0, 1.0),
        clamp(dyeHsv.z * uDyeD[i].z + uDyeD[i].w, 0.0, 1.0)));
      dyeOut = mix(dyeOut, dyed, w);
    }
  }
  diffuseColor.rgb = wocSrgb2Lin(dyeOut);
}`,
      );
  };
  // One key for every colorway (the GLSL is identical; only uniforms differ),
  // with the PREVIOUS hook's source folded in so a dyed and an undyed armour
  // material can never share a program.
  mat.customProgramCacheKey = () => `woc_armor_dye|${prevKey}`;
}

function armorDyed(src: THREE.Material, dye: ArmorDyeSpec): THREE.Material {
  const mat = src.clone() as THREE.MeshStandardMaterial;
  attachArmorDye(mat, dye);
  return mat;
}

/** Per-character skin/hair colour. Applied BEFORE applyMaterials so the clone
 *  it snapshots as "source" already carries the tint (and so the low-graphics
 *  Lambert path inherits it too). Any other material passes straight through. */
function recolored(
  src: THREE.Material,
  look: ModularLook,
  onMouth = false,
  onJewel = false,
  onBand = false,
): THREE.Material {
  // JEWELLERY MATERIAL. The piercing sets ride the knight atlas by default,
  // which is what gives a set its authored per-piece metals; when the player
  // names a material instead, the whole set becomes that one substance (what
  // the Fit Studio bakes when a designer names a preset). Caught here rather
  // than by material name because the material IS the shared atlas, the E2
  // node name is the only thing that distinguishes an earring from a pauldron.
  //
  // A hair band is on the same path but answers to bandMaterialSpec, which
  // does not check the earring SLOT: the band is worn with the hair, so it
  // takes the picked metal even on a character wearing no piercings.
  const jewel = onJewel
    ? onBand
      ? bandMaterialSpec(look.app)
      : earringMaterialSpec(look.app)
    : null;
  if (jewel) {
    const jkey = `jewel|${jewel.color}|${jewel.metalness}|${jewel.roughness}`;
    const hit = recolorCache.get(jkey);
    if (hit) {
      recolorCache.delete(jkey);
      recolorCache.set(jkey, hit);
      return hit;
    }
    const jm = src.clone() as THREE.MeshStandardMaterial;
    jm.name = `mod_jewel_${jewel.color.toString(16)}`;
    if ('color' in jm) jm.color.setHex(jewel.color);
    // the atlas swatch would otherwise multiply the picked colour
    if ('map' in jm) jm.map = null;
    if ('metalness' in jm) jm.metalness = jewel.metalness;
    if ('roughness' in jm) jm.roughness = jewel.roughness;
    // metalness/roughness are standard-tier only: the low tier rebuilds
    // materials as Lambert (see tintedMaterial), which has neither. The
    // COLOUR survives there, so the pick still reads.
    recolorCache.set(jkey, jm);
    return jm;
  }
  // LIPSTICK. The mouth part carries the lip body on `mod_skin` (so a bare mouth
  // matches the face) and the mouth line on `mod_mouth`. Painting the first of
  // those is the whole feature, the shape is already a pair of lips, so there
  // is nothing to mask and nothing to add. It has to be caught HERE rather than
  // by a decal because the part stands proud of the head: paint on the head at
  // the lip band renders behind the lips.
  const lip =
    onMouth && src.name === MAT_SKIN
      ? lipColor(makeupSelection(look.app, look.worn).lipstick)
      : null;
  const hex =
    lip !== null
      ? lip
      : src.name === MAT_SKIN || src.name === MAT_SKIN_DETAIL
        ? skinColor(look.app)
        : src.name === MAT_HAIR || src.name === MAT_STUBBLE
          ? hairColor(look.app)
          : src.name === MAT_EYE
            ? eyeColor(look.app)
            : src.name === MAT_LASH
              ? lashColor(look.app)
              : null;
  // Armour rides the same clone-cache but dyes in the SHADER rather than via
  // material.color: a multiply tint over a coloured atlas can only darken,
  // while the dye rotates the set's cloth band to the picked colorway.
  const dye = hex === null ? outfitDye(src.name, look.app.outfit) : null;
  if (hex === null && dye === null) return src;
  const key = hex !== null ? `${src.uuid}|${hex}` : `${src.uuid}|outfit:${look.app.outfit}`;
  const cached = recolorCache.get(key);
  if (cached) {
    // refresh recency
    recolorCache.delete(key);
    recolorCache.set(key, cached);
    return cached;
  }
  const mat =
    dye !== null
      ? (armorDyed(src, dye) as THREE.MeshStandardMaterial)
      : (src.clone() as THREE.MeshStandardMaterial);
  if (hex !== null) mat.color.setHex(hex);
  // HAIR IS DOUBLE-SIDED. The sculpts ship as the designer anchored them
  // (hairimp.FAITHFUL_SCULPT), and a sculpt is a one-sided open shell: seen
  // from inside, through the gaps between strands, up under a fringe, along
  // the hollow of a ponytail, a single-sided face is simply not drawn and
  // reads as a hole in the hair. The Fit Studio previews these sculpts
  // DoubleSide for the same reason, so this is also what makes the game match
  // the tool. It replaces the build-time inner wall (close_shell), which cost
  // geometry and arrived shredded on hanging styles.
  // `side` survives the low tier: tintedMaterial's Lambert rebuild copies it.
  if (src.name === MAT_HAIR) mat.side = THREE.DoubleSide;
  recolorCache.set(key, mat);
  while (recolorCache.size > RECOLOR_CACHE_MAX) {
    const oldestKey = recolorCache.keys().next().value as string | undefined;
    if (oldestKey === undefined) break;
    const oldest = recolorCache.get(oldestKey);
    recolorCache.delete(oldestKey);
    // Safe to drop: any live clone derived from one owns its own instance, and
    // the only map any of these carries (the stubble decal's) is shared and
    // owned by stubble.ts, Material.dispose() never touches a texture.
    oldest?.dispose();
  }
  return mat;
}

/**
 * Add the stubble/buzz decal, if the look wears one.
 *
 * It is added to the CLONE rather than to the cached variant because it adds no
 * part name: buzz and bald pick the same nodes and so share one cached variant,
 * and the decal is the only thing that tells them apart. It has to go on before
 * the recolour sweep below, which is what paints it the hair colour, and before
 * `applyMorphs`, which drives it off the head's own morph dictionary.
 */
function attachStubbleDecal(root: THREE.Object3D, look: ModularLook): void {
  const sel = stubbleDecals(look.app, look.worn);
  if (!sel.scalp && !sel.beard) return;
  const name = headNodeName(look.app.gender);
  let head: THREE.SkinnedMesh | null = null;
  root.traverse((o) => {
    if (!head && (o as THREE.SkinnedMesh).isSkinnedMesh && o.name === name) {
      head = o as THREE.SkinnedMesh;
    }
  });
  if (!head) return;
  const decal = buildStubbleDecal(head, sel);
  // Sibling, not child: the head is skinned, so a child would inherit its
  // (bind-pose) transform on top of the skinning it already does.
  if (decal) (head as THREE.SkinnedMesh).parent?.add(decal);
}

/**
 * Blush and eyeshadow, on the same terms as the stubble decal above, cut from
 * the head's own surface at compose time, added as a SIBLING of the head, and
 * driven by the head's morph dictionary so a face slider moves the paint with
 * the skin.
 *
 * Lipstick is not here: it is a tint on the mouth part, applied by the recolour
 * sweep (see `recolored`), because the mouth is a part standing proud of the
 * skin and a decal on the head at the lip band renders behind it.
 */
function attachMakeupDecal(root: THREE.Object3D, look: ModularLook): void {
  const sel = makeupSelection(look.app, look.worn);
  if (!wearsFaceDecal(sel)) return;
  const name = headNodeName(look.app.gender);
  let head: THREE.SkinnedMesh | null = null;
  root.traverse((o) => {
    if (!head && (o as THREE.SkinnedMesh).isSkinnedMesh && o.name === name) {
      head = o as THREE.SkinnedMesh;
    }
  });
  if (!head) return;
  const decal = buildMakeupDecal(head, sel);
  if (decal) (head as THREE.SkinnedMesh).parent?.add(decal);
}

/** Compose a modular character: pick parts, recolour skin/hair, attach weapons. */
export function assembleModular(
  def: VisualDef,
  look: ModularLook,
  weaponItemId?: string | null,
  offhandItemId?: string | null,
): THREE.Object3D {
  const root = cloneSkinned(modularVariant(def.url, modularPartNames(look.app, look.worn)));
  attachStubbleDecal(root, look);
  attachMakeupDecal(root, look);
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    // Only PLATE is a "body mesh" here: that flag gates the legacy per-class
    // skin-atlas swap (SKINS/skinTexture), which must never repaint the
    // colour-picked skin and hair.
    if (mats.some((m) => m && isArmorMaterial(m.name))) mesh.userData.bodyMesh = true;
    // The mouth part is the one place `mod_skin` must not be the skin tone,
    // that primitive is the lips. GLTFLoader suffixes a multi-primitive mesh
    // (`M_Mouth_neutral_1`), so match on the node's stem rather than equality.
    const onMouth = mesh.name.includes('_Mouth_');
    // GLTFLoader suffixes multi-primitive meshes, so match the stem
    const onJewel = mesh.name.startsWith('E2_');
    // ...and a hair band is the E2_ subset that must ignore the earring slot
    const onBand = mesh.name.startsWith('E2_band_');
    mesh.material = Array.isArray(mesh.material)
      ? mesh.material.map((m) => recolored(m, look, onMouth, onJewel, onBand))
      : recolored(mesh.material, look, onMouth, onJewel, onBand);
  });
  applyMorphs(root, look);
  attachAllProps(root, def, weaponItemId ?? null, null, false, offhandItemId ?? null);
  return root;
}

/**
 * Push the face sliders onto the morph targets by NAME.
 *
 * Safe to do on the shared-geometry clone: three copies `morphTargetInfluences`
 * per instance in Mesh.copy(), so two characters can wear different faces off
 * one buffer. That is the whole reason the face is morphs rather than a CPU
 * deform: a deform would mint a cache entry per slider position, and the
 * variant cache is never evicted.
 */
function applyMorphs(root: THREE.Object3D, look: ModularLook): void {
  const want = morphInfluences(look.app);
  if (!want.size) return;
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    const dict = mesh.morphTargetDictionary;
    const infl = mesh.morphTargetInfluences;
    if (!dict || !infl) return;
    for (const [name, value] of want) {
      const i = dict[name];
      if (i !== undefined) infl[i] = value;
    }
  });
}

/**
 * Re-push the face/body SLIDER morphs onto a body that is already built.
 *
 * The reason the sliders are out of `modularBuildSignature`: they are
 * per-instance influences over shared geometry, so moving one is a few float
 * writes rather than a dispose plus a fresh clone, materials and decals. The
 * creation turntable emits on every `input` event (a face slider steps in 5%,
 * so one drag is about 40 of them), which rebuilt the whole character each
 * time.
 *
 * Writes EVERY slider target rather than only the non-zero half the build path
 * uses: this runs over a body that already carries influences, so a slider
 * returning to neutral has to clear the one it set.
 */
export function applyModularSliderMorphs(root: THREE.Object3D, app: ModularAppearance): void {
  const want = morphInfluences(app);
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    const dict = mesh.morphTargetDictionary;
    const infl = mesh.morphTargetInfluences;
    if (!dict || !infl) return;
    for (const name of MORPH_SLIDER_TARGETS) {
      const i = dict[name];
      if (i !== undefined) infl[i] = want.get(name) ?? 0;
    }
  });
}

/** Fresh SkeletonUtils clone of a manifest entry with its kit applied.
 *  Pure model space — normalization (scale/yaw/feet offset) happens upstream. */
export function assembleModel(
  def: VisualDef,
  weaponItemId?: string | null,
  offhandItemId?: string | null,
  look?: ModularLook | null,
): THREE.Object3D {
  if (def.modular) {
    return assembleModular(def, look ?? DEFAULT_LOOK, weaponItemId, offhandItemId);
  }
  const root = cloneSkinned(optimizedScene(def.url));
  // tag the character's own meshes (body + accessories share one texture atlas)
  // so a skin override hits them but not the separate weapons attached below
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) o.userData.bodyMesh = true;
  });
  // KayKit characters ship every accessory mesh visible; keep only the kit
  if (def.show) {
    const keep = new Set(def.show);
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh && !(mesh as THREE.SkinnedMesh).isSkinnedMesh && !keep.has(o.name)) {
        o.visible = false;
      }
    });
  }
  // Two-state prop mobs (the dragonkin egg) ship BOTH state meshes at the
  // origin: seed the ALIVE state (hide the corpse shell); CharacterVisual's
  // enterDeath/revive flip it (created-already-dead corpses flip on their
  // first diff, which always runs enterDeath).
  if (def.corpseMeshSwap) {
    const swap = def.corpseMeshSwap;
    root.traverse((o) => {
      if (o.name === swap.show) o.visible = false;
    });
  }
  // Weapons and held props are gameplay-readable silhouettes, not decoration.
  // Low tier still downgrades body/material cost, but keeps attachments visible.
  // Built SKINLESS and drawn: CharacterVisual applies the weapon skin (and any
  // active sheathe) on its first diff, right after assembly.
  attachAllProps(root, def, weaponItemId ?? null, null, false, offhandItemId ?? null);
  // Re-orient mis-baked built-in weapon nodes (e.g. the golem axe) in place.
  for (const fix of def.weaponFix ?? []) {
    const node =
      root.getObjectByName(fix.node) ?? root.getObjectByName(fix.node.replace(/[[\].:/]/g, ''));
    if (!node) continue;
    if (fix.rotX) node.rotateX(fix.rotX);
    if (fix.rotY) node.rotateY(fix.rotY);
    if (fix.rotZ) node.rotateZ(fix.rotZ);
  }
  return root;
}

// The target bone for one attachment: its authored bone normally, the chest bone
// while a handslot prop is sheathed. GLTFLoader sanitizes node names
// (PropertyBinding strips [].:/ chars), so "handslot.r" arrives as "handslotr";
// resolveBone tries both.
function attachTargetBone(
  root: THREE.Object3D,
  att: AttachDef,
  stowed: boolean,
): THREE.Object3D | null {
  return resolveBone(root, stowed && isHandslotBone(att.bone) ? STOW_BONE : att.bone);
}

// Attach every authored prop: swappable slots take the equipped item's model (or an
// applied weapon skin, which wins); the actual offhand slot takes the equipped
// offhand's model (or the same skin mirrored onto a matching-type weapon,
// or nothing while none is equipped); every other attachment is fixed (the warlock's
// spellbook offhand), except the hunter's fixed RANGED attach, which a bow/crossbow
// skin replaces in place. The rogue lists both hand slots so a dagger shows in both.
// A manifest/bone mismatch ships without that prop. Returns the WEAPON payload roots
// (the swap + ranged-swap ones), plus a skin-mirrored offhand payload, the set
// rarity VFX and orientation pins ride; a NON-mirrored offhand has its own cycle
// (setHeldOffhand) and stays out of the returned set.
function attachAllProps(
  root: THREE.Object3D,
  def: VisualDef,
  weaponItemId: string | null,
  weaponSkinId: string | null,
  stowed: boolean,
  offhandItemId: string | null = null,
): THREE.Object3D[] {
  const attachments = visibleAttachmentsForGraphics(def);
  // A skin mirrored onto the offhand rides the same rarity-VFX + material path as
  // the mainhand skin, so its payload joins the returned set (the caller runs the
  // VFX/isolation pass over these). A plain offhand (shield/held-offhand/different
  // -type weapon) stays out, untouched.
  const offhandSkinned = offhandMirrorsWeaponSkin(weaponSkinId, offhandItemId);
  const payloads: THREE.Object3D[] = [];
  for (let i = 0; i < attachments.length; i++) {
    const base = attachments[i];
    const isSwap = def.weaponSlots?.includes(i) ?? false;
    const isOffhandSwap = def.offhandSlot === i;
    const isWeapon = isSwap || isRangedSwapAttach(base);
    const att = isSwap
      ? swapAttachDef(base, weaponItemId, weaponSkinId)
      : isOffhandSwap
        ? offhandAttachDef(base, offhandItemId, weaponSkinId)
        : (rangedSkinAttachDef(base, weaponSkinId) ?? base);
    if (!att) continue;
    const bone = attachTargetBone(root, att, stowed);
    if (!bone) continue;
    const swapKind = isOffhandSwap ? 'offhand' : isWeapon ? 'mainhand' : null;
    const payload = attachProp(root, bone, att, swapKind, stowed);
    if (isWeapon || (isOffhandSwap && offhandSkinned)) payloads.push(payload);
  }
  return payloads;
}

/** Replace the equipped-weapon attachment(s) on an already-assembled model in place,
 *  for a runtime gear swap or a weapon-skin change. Re-attaches every swap slot (the
 *  rogue has two, so both hands update) plus, for classes with a fixed ranged visual
 *  (hunter), the fixed ranged attach that a bow/crossbow skin replaces, honoring an
 *  active sheathe. The actual equipped offhand has a separate replacement cycle
 *  (setHeldOffhand). Returns the attached weapon payload roots so the caller can
 *  hang rarity VFX off them. The caller must re-apply materials and re-snapshot the
 *  original-material map afterwards (see CharacterVisual.setWeapon), since the new
 *  weapon meshes start on the source GLB's raw materials. */
export function setHeldWeapon(
  root: THREE.Object3D,
  def: VisualDef,
  weaponItemId: string | null,
  weaponSkinId: string | null = null,
  stowed = false,
): THREE.Object3D[] {
  const attachments = def.attach ?? [];
  const targets: number[] = [];
  for (let i = 0; i < attachments.length; i++) {
    if (def.weaponSlots?.includes(i) || isRangedSwapAttach(attachments[i])) targets.push(i);
  }
  if (targets.length === 0) return [];
  const stale: THREE.Object3D[] = [];
  root.traverse((o) => {
    if (o.userData[SWAP_WEAPON_TAG]) stale.push(o);
  });
  for (const o of stale) o.removeFromParent();
  const payloads: THREE.Object3D[] = [];
  for (const i of targets) {
    const base = attachments[i];
    const att = def.weaponSlots?.includes(i)
      ? swapAttachDef(base, weaponItemId, weaponSkinId)
      : (rangedSkinAttachDef(base, weaponSkinId) ?? base);
    const bone = attachTargetBone(root, att, stowed);
    if (!bone) continue;
    payloads.push(attachProp(root, bone, att, 'mainhand', stowed));
  }
  return payloads;
}

/** Replace only the actual offhand attachment, honoring an active sheathe. The
 *  offhand renders its own item model UNLESS the active mainhand skin mirrors onto
 *  it (a matching-type weapon), in which case it shows the skin (and the
 *  caller must run the rarity-VFX/material pass over the returned payload). Mainhand
 *  item/cosmetic models and their rarity VFX remain untouched. */
export function setHeldOffhand(
  root: THREE.Object3D,
  def: VisualDef,
  offhandItemId: string | null,
  weaponSkinId: string | null = null,
  stowed = false,
): THREE.Object3D[] {
  if (def.offhandSlot === undefined) return [];
  const stale: THREE.Object3D[] = [];
  root.traverse((o) => {
    if (o.userData[SWAP_OFFHAND_TAG]) stale.push(o);
  });
  for (const o of stale) o.removeFromParent();

  const base = def.attach?.[def.offhandSlot];
  if (!base) return [];
  const att = offhandAttachDef(base, offhandItemId, weaponSkinId);
  if (!att) return [];
  const bone = attachTargetBone(root, att, stowed);
  return bone ? [attachProp(root, bone, att, 'offhand', stowed)] : [];
}

/** A standalone display clone of a weapon-skin model for the armory inspect
 *  turntable (weapon-only mode). Origin is the grip, like every held model.
 *  Materials are cloned per call: the VFX emissive derive mutates them in
 *  place, and SkeletonUtils.clone shares the cached GLTF source materials. */
export function weaponSkinDisplayModel(skinId: string): THREE.Object3D | null {
  const url = weaponSkinModelUrl(skinId);
  if (!url) return null;
  // Streamed skin not arrived yet (every iOS WebKit host: the Armory prewarm starts
  // microseconds after the stream pass): degrade to null, which the preview
  // rig treats as unavailable, and kick the fetch. Throwing here lost the
  // whole 29-skin warmup and could escape an ArmoryInspect click handler.
  if (residentOrEnsure(url) === null) return null;
  const payload = flattenWeaponScene(cloneSkinned(resolvedGltf(url).scene));
  payload.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.userData.weaponMesh = true;
    mesh.material = Array.isArray(mesh.material)
      ? mesh.material.map((m) => m.clone())
      : mesh.material.clone();
  });
  markOwnedWeaponSkinMaterials(payload);
  return payload;
}

/** Move every held prop (swap slots, the actual equipped offhand, AND fixed
 *  offhands: the rogue's second dagger, the hunter crossbow, the warlock
 *  spellbook) between the hands and the on-back sheathed pose, in place, keeping
 *  any applied weapon skin. Returns the weapon payload roots (same contract as
 *  setHeldWeapon: the caller re-applies materials, re-snapshots originals, and
 *  rebuilds the skin VFX afterwards). */
export function setWeaponsStowed(
  root: THREE.Object3D,
  def: VisualDef,
  weaponItemId: string | null,
  weaponSkinId: string | null,
  stowed: boolean,
  offhandItemId: string | null = null,
): THREE.Object3D[] {
  if (!def.attach?.length) return [];
  const stale: THREE.Object3D[] = [];
  root.traverse((o) => {
    if (o.userData[HELD_PROP_TAG]) stale.push(o);
  });
  for (const o of stale) o.removeFromParent();
  return attachAllProps(root, def, weaponItemId, weaponSkinId, stowed, offhandItemId);
}

// ---------------------------------------------------------------------------
// Tinted material cache (shared across all instances; claim-counted and
// bounded, see tinted_material_cache_core.ts). Two visuals asking for the
// same (source, tint, tier, atlases, role) still share one clone; a clone is
// disposed only once nothing claims it (idle LRU overflow, or a profile
// reset's retire-on-last-release), so eviction can never touch a material a
// live mesh still mounts.
// ---------------------------------------------------------------------------

const matCache = new TintedMaterialCache<THREE.Material>(TINTED_MATERIAL_IDLE_CACHE_MAX, (mat) =>
  mat.dispose(),
);
const sourceMaterials = new WeakMap<THREE.Mesh, THREE.Material | THREE.Material[]>();
const tintScratch = new THREE.Color();
const lowReadabilityWhite = new THREE.Color(0xffffff);
const weaponHighlight = new THREE.Color(0xfff0c2);
/** KayKit weapon materials whose NAME marks them as a wooden part. */
const WOOD_WEAPON_NAME = /handle|wood|shaft|bow|staff/i;
type MaterialRole = 'body' | 'weapon';

function applyLowReadabilityLift(
  mat: THREE.MeshStandardMaterial | THREE.MeshLambertMaterial | THREE.MeshBasicMaterial,
  role: MaterialRole,
): void {
  const lift = role === 'weapon' ? 0.14 : 0.075;
  const emissive = role === 'weapon' ? 0.075 : 0.045;
  mat.color.lerp(role === 'weapon' ? weaponHighlight : lowReadabilityWhite, lift);
  if ((mat as THREE.MeshLambertMaterial).isMeshLambertMaterial) {
    const lambert = mat as THREE.MeshLambertMaterial;
    lambert.emissive = mat.color.clone().multiplyScalar(emissive);
  }
}

function applyWeaponMaterialPolish(
  mat: THREE.MeshStandardMaterial | THREE.MeshLambertMaterial | THREE.MeshBasicMaterial,
): void {
  // Colorless sources never reach here: tintedMaterial returns them unchanged
  // before cloning, so every mat this helper sees carries a color.
  mat.color.lerp(weaponHighlight, 0.08);
  const std = mat as THREE.MeshStandardMaterial;
  if (std.isMeshStandardMaterial) {
    std.roughness = Math.min(std.roughness, 0.55);
    std.metalness = Math.max(std.metalness, 0.12);
    std.emissive.copy(mat.color).multiplyScalar(0.025);
    // Metal blades/heads get a per-material env boost so they pick up the sky
    // and dungeon IBL: scene.environment ships dim by design (~0.4 outdoors,
    // 0.05 in dungeons) and metals read as dull plastic under it. Per-material
    // envMapIntensity multiplies the scene value, so only metal brightens; the
    // 0.3 gate keeps leather grips and wood hafts out of the boost. VFX skins
    // stash and neutralize this while a rig owns the material (weapon_vfx.ts
    // deriveEmissive), so the boost never fights an active skin.
    if (std.metalness > 0.3) std.envMapIntensity = 1.6;
    // Wood-named weapon parts (hafts, bow limbs, staves) on materials that
    // ship NO roughness map get the shared wood surface-detail layer, in
    // OBJECT space so the grain rides the held weapon instead of swimming
    // through the world projection (AO + roughness only; see worn_stone.ts).
    // Metal blades without maps keep just the polish above, and faces/bodies
    // never take the layer: this helper only runs for role === 'weapon'.
    if (!std.roughnessMap && WOOD_WEAPON_NAME.test(std.name)) {
      applySurfaceDetail(std, 'wood', { strength: 0.3, tileScale: 1.6, objectSpace: true });
    }
  }
}

/**
 * A lease of shared tinted-material cache keys. A material sweep passes its
 * visual's lease so every cache entry it mounts stays claimed (pinned against
 * eviction) until the visual releases the lease via releaseTintedMaterials
 * (on the next full re-apply sweep, and at dispose). The set also makes
 * claims idempotent per lease: a sweep meeting the same source material on
 * several meshes claims its key once.
 *
 * A caller that passes NO lease (tests, tools) still shares the memoized
 * clone, but its entry stays evictable: never mount a leaseless result on a
 * long-lived mesh.
 */
export type TintedMaterialClaims = Set<string>;

/** Release one lease's claims (see TintedMaterialClaims). Keys the cache no
 *  longer tracks are a refused no-op, so a double release cannot underflow
 *  another visual's pin. */
export function releaseTintedMaterials(claims: Iterable<string>): void {
  for (const key of claims) matCache.release(key);
}

export function tintedMaterial(
  src: THREE.Material,
  tint: number | null,
  strength: number,
  skinTex: THREE.Texture | null = null,
  emisTex: THREE.Texture | null = null,
  role: MaterialRole = 'body',
  claims: TintedMaterialClaims | null = null,
): THREE.Material {
  // A source with no color property (the weapon-skin fresnel shell's
  // ShaderMaterial) has nothing this factory can tint, lift, or polish.
  // Return it unchanged: cloning would detach the rig's live uniform handles
  // (its per-frame uTime/uStr writes would land on a material nothing
  // renders), and caching that clone would strand it forever.
  if (!(src as THREE.MeshStandardMaterial).color) return src;
  const key = `${src.uuid}|${tint ?? 'n'}|${tint === null ? 0 : strength}|${GFX.standardMaterials ? 's' : 'l'}|${skinTex ? skinTex.uuid : 'n'}|${emisTex ? emisTex.uuid : 'n'}|${role}`;
  const build = () =>
    buildTintedClone(src as THREE.MeshStandardMaterial, tint, strength, skinTex, emisTex, role);
  if (claims) {
    if (claims.has(key)) {
      // This lease already claimed the key (the same source material on an
      // earlier mesh of the sweep): serve the held clone without a second
      // claim, keeping claims and releases exactly paired per lease.
      const held = matCache.peek(key);
      if (held) return held;
    }
    claims.add(key);
    return matCache.claim(key, build);
  }
  // Leaseless: share the memo and stay warm, but hold no claim (claim then
  // release parks the entry at the idle tail). Every production mount path
  // leases; see TintedMaterialClaims.
  const mat = matCache.claim(key, build);
  matCache.release(key);
  return mat;
}

/** The tinted-clone derivation: a pure function of its arguments plus the
 *  static graphics tier, which is why an evicted cache entry rebuilds
 *  identically on the next request (see tinted_material_cache_core.ts). */
function buildTintedClone(
  s: THREE.MeshStandardMaterial,
  tint: number | null,
  strength: number,
  skinTex: THREE.Texture | null,
  emisTex: THREE.Texture | null,
  role: MaterialRole,
): THREE.Material {
  const src: THREE.Material = s;
  let mat: THREE.MeshStandardMaterial | THREE.MeshLambertMaterial | THREE.MeshBasicMaterial;
  if (GFX.standardMaterials) {
    mat = s.clone();
    // The clone dropped any dye hook recolored() attached (clone keeps
    // userData, not onBeforeCompile), put the outfit colorway back before the
    // rim/detail layers compose over it.
    const dyeSpec = (mat.userData as { armorDye?: ArmorDyeSpec }).armorDye;
    if (dyeSpec) attachArmorDye(mat, dyeSpec);
    addRimGlow(mat); // dungeon silhouette rim (uRimBoost contract)
    // The skeletons and the necromancer share a `Glow` eye material authored
    // at strength 1, whose two tints straddled the old bloom threshold on luma
    // weights alone: the yellow pair (0.907) lit up, the cyan pair (0.842)
    // never did. Pin both to the glow band so a skull reads the same way
    // whatever color its eyes are. Case is load-bearing here: the weapons'
    // `weapons_glow` ships at strength 1.5, already over the line, and
    // weapon_vfx.ts animates its intensity per frame.
    if (mat.name.includes('Glow')) mat.emissiveIntensity = EMISSIVE_GLOW;
    // Cloth-named and armor-metal-named rig materials (paladin_metallic) take
    // the shared surface-detail layer at LOW strength in OBJECT space (rigs
    // animate; a world projection swims). Class-body/skin atlases and 'Glow'
    // materials never match (riggedWornFamilyFor's allowlist has no fallback).
    const worn = riggedWornFamilyFor(mat.name);
    if (worn) applySurfaceDetail(mat, worn.family, { strength: worn.strength, objectSpace: true });
  } else {
    if ((src as THREE.MeshBasicMaterial).isMeshBasicMaterial) {
      mat = (src as THREE.MeshBasicMaterial).clone();
    } else {
      // low tier: Lambert with the same texture map (no PBR, no rim)
      mat = new THREE.MeshLambertMaterial({
        map: s.map ?? null,
        color: s.color ? s.color.clone() : new THREE.Color(0xffffff),
        vertexColors: s.vertexColors,
        transparent: s.transparent,
        opacity: s.opacity,
        side: s.side,
        // Blend state, not shading: a decal that needs a depth bias and no
        // depth write needs them on EVERY tier. Rebuilding the material from
        // scratch used to drop both, so the stubble decal would have z-fought
        // the face it sits on for anyone on low graphics.
        depthWrite: s.depthWrite,
        alphaTest: s.alphaTest,
        polygonOffset: s.polygonOffset,
        polygonOffsetFactor: s.polygonOffsetFactor,
        polygonOffsetUnits: s.polygonOffsetUnits,
      });
    }
  }
  if (tint !== null) {
    // subtle pull toward the template color: hard multiplies turn the
    // hand-painted textures muddy
    mat.color.lerp(tintScratch.set(tint), strength);
  }
  if (skinTex) mat.map = skinTex; // alternate body atlas, same UVs as the default
  // Emissive glow map (mech epics): standard tier only - Lambert/Basic don't
  // glow, and adding a map where none existed needs a shader recompile.
  if (emisTex && GFX.standardMaterials) {
    const sm = mat as THREE.MeshStandardMaterial;
    sm.emissiveMap = emisTex;
    sm.emissive = new THREE.Color(0xffffff);
    sm.emissiveIntensity = 1.0;
    sm.needsUpdate = true;
  }
  if (role === 'weapon') {
    applyWeaponMaterialPolish(mat);
  } else if ((mat as THREE.MeshStandardMaterial).isMeshStandardMaterial) {
    // Body/armor: clamp the authored roughness into a matte cloth/leather band.
    // Some kit materials ship near-zero roughness (reads wet/plastic under the
    // key light) and others at 1.0 (dead flat); the band keeps every character
    // in one coherent painted-surface response without touching metalness.
    const std = mat as THREE.MeshStandardMaterial;
    std.roughness = Math.min(Math.max(std.roughness, 0.55), 0.9);
  }
  if (!GFX.standardMaterials) applyLowReadabilityLift(mat, role);
  return mat;
}

function tintFor(def: VisualDef, entityColor: number): number | null {
  if (def.tint === undefined) return null;
  return def.tint === 'entity' ? entityColor : def.tint;
}

/** Swap every mesh material in an assembled clone for the shared tinted
 *  (and tier-appropriate) variant. Returns nothing, mutates the clone. Pass
 *  the owning visual's `claims` lease so every mounted cache entry stays
 *  pinned against eviction until the visual releases it (see
 *  TintedMaterialClaims). */
export function applyMaterials(
  root: THREE.Object3D,
  def: VisualDef,
  entityColor: number,
  skinTex: THREE.Texture | null = null,
  emisTex: THREE.Texture | null = null,
  claims: TintedMaterialClaims | null = null,
): void {
  const tint = tintFor(def, entityColor);
  const strength = def.tintStrength ?? DEFAULT_TINT_STRENGTH;
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    // Weapon-skin VFX rigs own their ShaderMaterials, and a skinned weapon's
    // payload materials are per-instance clones the VFX emissive derive mutates
    // and restores. Tinting either (or re-deriving them from the shared cache
    // on a body-skin change) corrupts live handles, so both stay untouched.
    if (mesh.userData.weaponVfxMesh || mesh.userData.weaponSkinIsolated) return;
    // The class halo's shared additive material must never be re-mapped or
    // tinted (visual.ts adds it after the constructor's applyMaterials for the
    // same reason); a skin or weapon swap re-running this sweep used to wash
    // the golden ring toward the body tint until relog.
    if (mesh.name === 'class_halo') return;
    // Always derive a skin/material variant from the assembled model's source
    // material. Reusing the last applied variant would retain its alternate map
    // when skin 0 asks to restore the embedded default texture.
    const source = sourceMaterials.get(mesh) ?? mesh.material;
    sourceMaterials.set(mesh, source);
    const role: MaterialRole = mesh.userData.weaponMesh ? 'weapon' : 'body';
    const materialTint = role === 'weapon' ? null : tint;
    // skin/emissive override only touches the character's own atlas meshes, not weapons
    const sk = skinTex && mesh.userData.bodyMesh ? skinTex : null;
    const em = emisTex && mesh.userData.bodyMesh ? emisTex : null;
    if (Array.isArray(source)) {
      mesh.material = source.map((m) =>
        tintedMaterial(m, materialTint, strength, sk, em, role, claims),
      );
    } else {
      mesh.material = tintedMaterial(source, materialTint, strength, sk, em, role, claims);
    }
  });
}

/** Tint (and, since the materials are keyed 1:1 with `isBody`, skin) the far
 *  LOD's baked source materials. `isBody` mirrors applyMaterials' own gate: a
 *  skin/emissive atlas only ever replaces the character's own body texture,
 *  never a baked-in weapon's (the far mesh includes the class default weapon
 *  geometry too, see PreparedVisual.idleSrcMats), so the override is applied
 *  per material rather than uniformly across the whole baked set. */
export function tintedFarMaterials(
  def: VisualDef,
  entityColor: number,
  srcMats: THREE.Material[],
  isBody: boolean[],
  skinTex: THREE.Texture | null = null,
  emisTex: THREE.Texture | null = null,
  claims: TintedMaterialClaims | null = null,
): THREE.Material[] {
  const tint = tintFor(def, entityColor);
  const strength = def.tintStrength ?? DEFAULT_TINT_STRENGTH;
  return srcMats.map((m, i) =>
    tintedMaterial(
      m,
      tint,
      strength,
      isBody[i] ? skinTex : null,
      isBody[i] ? emisTex : null,
      'body',
      claims,
    ),
  );
}

// ---------------------------------------------------------------------------
// Per-key prepared data: normalization transform + baked idle-pose geometry
// ---------------------------------------------------------------------------

export interface PreparedVisual {
  key: string;
  def: VisualDef;
  /** uniform scale that brings the asset to def.height world units */
  normScale: number;
  /** lifts feet (or hover gap) onto the pivot plane, post-scale */
  yOffset: number;
  /** clip name -> clip, resolved from the source gltf */
  clips: Map<string, THREE.AnimationClip>;
  /** static idle-pose geometry in normalized space (far LOD + shadow proxy) */
  idleGeo: THREE.BufferGeometry | null;
  /** source materials aligned with idleGeo groups */
  idleSrcMats: THREE.Material[];
  /** parallel to idleSrcMats: whether that material belongs to the
   *  character's own body (vs. a baked-in weapon), the same distinction
   *  applyMaterials uses to gate the skin/emissive override */
  idleSrcIsBody: boolean[];
  /** click-capsule radius in world units (from measured XZ body extents —
   *  long/wide creatures like wolves need far more than a humanoid sliver) */
  clickRadius: number;
}

const prepared = new Map<string, PreparedVisual>();

/** Drop profile-derived character templates/materials while retaining loaded
 *  source assets. The tinted-material cache resets rather than clears: idle
 *  clones dispose now, and any clone a not-yet-torn-down visual still mounts
 *  is retired to dispose on that visual's release instead of leaking (see
 *  tinted_material_cache_core.ts). In the graphics-rebuild flow every visual
 *  is already disposed before this runs, so normally everything disposes
 *  here. */
export function resetCharacterProfileCaches(): void {
  optimizedSceneCache.clear();
  matCache.reset();
  prepared.clear();
}

/** Test-only observation window into the shared tinted-material cache. */
export const tintedMaterialInternalsForTest = {
  cacheSize: (): number => matCache.size,
  cacheIdleSize: (): number => matCache.idleSize,
};

export function prepareVisual(key: string): PreparedVisual {
  const hit = prepared.get(key);
  if (hit) return hit;
  const def = VISUALS[key];
  if (!def) throw new Error(`unknown visual key: ${key}`);
  const gltf = resolvedGltf(def.url);

  const clips = new Map<string, THREE.AnimationClip>();
  for (const clip of gltf.animations) clips.set(clip.name, clip);
  for (const url of def.animUrls ?? []) {
    for (const clip of resolvedGltf(url).animations) clips.set(clip.name, clip);
  }

  // Pose a throwaway clone mid-idle, measure it, and bake the static mesh.
  const temp = assembleModel(def);
  const idle = clips.get(def.clips.idle);
  if (idle) {
    const mixer = new THREE.AnimationMixer(temp);
    mixer.clipAction(idle).play();
    mixer.update(Math.min(0.5, idle.duration * 0.5));
    temp.updateMatrixWorld(true);
    temp.traverse((o) => {
      const sm = o as THREE.SkinnedMesh;
      if (sm.isSkinnedMesh) sm.skeleton.update();
    });
    mixer.stopAllAction();
    mixer.uncacheRoot(temp);
  } else {
    temp.updateMatrixWorld(true);
  }

  // body bounds from the skinned meshes only (weapons would skew the height)
  const bounds = new THREE.Box3();
  const v = new THREE.Vector3();
  temp.traverse((o) => {
    const sm = o as THREE.SkinnedMesh;
    if (!sm.isSkinnedMesh || !meshChainVisible(sm, temp)) return;
    const pos = sm.geometry.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos as THREE.BufferAttribute, i);
      sm.applyBoneTransform(i, v);
      v.applyMatrix4(sm.matrixWorld);
      bounds.expandByPoint(v);
    }
  });
  // Non-skinned models (procedural form GLBs animated by node transforms, with no
  // skeleton — e.g. the chicken-cow Travel Form) contribute no skinned meshes, so
  // the pass above leaves bounds empty; rawHeight then collapses to 1e-3 and
  // normScale explodes (~1500x), rendering the form off-screen/invisible. Fall back
  // to the plain posed mesh geometry. Only triggers when there are zero skinned
  // meshes, so skinned creatures/players are unaffected.
  if (bounds.isEmpty()) {
    temp.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (
        !mesh.isMesh ||
        (mesh as unknown as THREE.SkinnedMesh).isSkinnedMesh ||
        !meshChainVisible(mesh, temp)
      )
        return;
      const pos = mesh.geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
      if (!pos) return;
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i);
        v.applyMatrix4(mesh.matrixWorld);
        bounds.expandByPoint(v);
      }
    });
  }
  const rawHeight = Math.max(1e-3, bounds.max.y - bounds.min.y);
  const normScale = def.height / rawHeight;
  const yOffset = (def.hover ?? 0) - bounds.min.y * normScale;
  const clickRadius = Math.min(
    2.2,
    Math.max(
      0.5,
      Math.max(bounds.max.x, -bounds.min.x, bounds.max.z, -bounds.min.z) * normScale * 0.9,
    ),
  );

  const norm = new THREE.Matrix4()
    .makeTranslation(0, yOffset, 0)
    .multiply(new THREE.Matrix4().makeRotationY(def.yaw ?? 0))
    .multiply(new THREE.Matrix4().makeScale(normScale, normScale, normScale));

  const { geo, mats, isBody } = bakeStaticPose(temp, norm);

  const prep: PreparedVisual = {
    key,
    def,
    normScale,
    yOffset,
    clips,
    idleGeo: geo,
    idleSrcMats: mats,
    idleSrcIsBody: isBody,
    clickRadius,
  };
  prepared.set(key, prep);
  return prep;
}

function meshChainVisible(o: THREE.Object3D, stopAt: THREE.Object3D): boolean {
  let cur: THREE.Object3D | null = o;
  while (cur) {
    if (!cur.visible) return false;
    if (cur === stopAt) return true;
    cur = cur.parent;
  }
  return true;
}

/** Bake every visible mesh of a posed clone into one static BufferGeometry
 *  (skinned verts via applyBoneTransform), normalized into world units. */
function bakeStaticPose(
  root: THREE.Object3D,
  norm: THREE.Matrix4,
): { geo: THREE.BufferGeometry | null; mats: THREE.Material[]; isBody: boolean[] } {
  const geos: THREE.BufferGeometry[] = [];
  const mats: THREE.Material[] = [];
  const isBody: boolean[] = [];
  const v = new THREE.Vector3();
  const full = new THREE.Matrix4();

  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !meshChainVisible(mesh, root)) return;
    const srcGeo = mesh.geometry;
    const srcPos = srcGeo.getAttribute('position') as THREE.BufferAttribute;
    if (!srcPos) return;
    const out = new THREE.BufferGeometry();
    const baked = new Float32Array(srcPos.count * 3);
    const skinned = (mesh as unknown as THREE.SkinnedMesh).isSkinnedMesh
      ? (mesh as unknown as THREE.SkinnedMesh)
      : null;
    full.multiplyMatrices(norm, mesh.matrixWorld);
    for (let i = 0; i < srcPos.count; i++) {
      v.fromBufferAttribute(srcPos, i);
      if (skinned) {
        skinned.applyBoneTransform(i, v);
        v.applyMatrix4(skinned.matrixWorld).applyMatrix4(norm);
      } else {
        v.applyMatrix4(full);
      }
      baked[i * 3] = v.x;
      baked[i * 3 + 1] = v.y;
      baked[i * 3 + 2] = v.z;
    }
    out.setAttribute('position', new THREE.BufferAttribute(baked, 3));
    const uv = srcGeo.getAttribute('uv');
    // Different source primitives can quantize uv differently (e.g. a
    // normalized Uint16Array on one, a plain Float32Array on another);
    // dequantize so every baked geo's uv shares one typed-array type and
    // mergeGeometries below can combine them.
    if (uv) out.setAttribute('uv', dequantizeAttribute(uv as THREE.BufferAttribute));
    if (srcGeo.index) out.setIndex(srcGeo.index.clone());
    out.computeVertexNormals();
    geos.push(out);
    // GLTFLoader emits one Mesh per primitive — materials are never arrays here
    mats.push(Array.isArray(mesh.material) ? mesh.material[0] : mesh.material);
    isBody.push(!!mesh.userData.bodyMesh);
  });

  if (geos.length === 0) return { geo: null, mats: [], isBody: [] };
  // uv presence must agree for merging — drop uvs entirely if any geo lacks them
  const allHaveUv = geos.every((g) => g.getAttribute('uv'));
  if (!allHaveUv) for (const g of geos) g.deleteAttribute('uv');
  const geo = geos.length === 1 ? geos[0] : mergeGeometries(geos, true);
  if (geos.length === 1) {
    geo.clearGroups();
    geo.addGroup(0, geo.index ? geo.index.count : geo.getAttribute('position').count, 0);
  }
  return { geo, mats, isBody };
}
