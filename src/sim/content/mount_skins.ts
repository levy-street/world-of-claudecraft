// Account-wide mount appearances. Paid store grants are permanent and remain
// in their own SKU catalog. Collectible skins are available only while a reins
// item is held in an account character's bags or bank. Selection is per character;
// all movement speed comes from riding training, never from a skin.

import { MOUNT_KEYS, MOUNTS, type MountKey, type MountRarity, mountDef } from './mounts';

export type StoreMountSkinId =
  | 'mech_bird'
  | 'chimeglass_tortoise'
  | 'rickshaw_mount'
  | 'goblin_rocket_sled';

export type MountSkinId = StoreMountSkinId | MountKey;

export interface MountSkinDef {
  /** Store SKU / economy-service item id (kind 'skin'). */
  id: MountSkinId;
  /** Canonical English display name (the HUD localizes via hudChrome.mounts.name_*). */
  name: string;
  /** Rarity chip only: a skin never carries a speed tier. */
  rarity: MountRarity;
  /** VISUALS key of the mount body this skin draws (lazyPreload GLB). */
  visualKey: string;
  season: 1;
}

// Catalog order is store order: rarity tier, then declaration order.
export const MOUNT_SKINS: Record<StoreMountSkinId, MountSkinDef> = {
  // The Cluckwork Mech Bird: the first store cosmetic that was a rideable
  // mount (reins_mech_bird, kind 'item') before mount skins existed. Authored
  // rigid-servo clips, powered idle hum and engine take set under its own key.
  mech_bird: {
    id: 'mech_bird',
    name: 'Cluckwork Mech Bird',
    rarity: 'epic',
    visualKey: 'mount_mech_bird',
    season: 1,
  },
  // Tolliver the Chimeglass: a salt-flat tortoise with storm-glass spectacles
  // and a bronze throat bell. Rider sits astride the shell (saddle bone + the
  // straddle ride pose); the lenses carry a cold blue lamp and two halos.
  chimeglass_tortoise: {
    id: 'chimeglass_tortoise',
    name: 'Tolliver the Chimeglass',
    rarity: 'epic',
    visualKey: 'mount_chimeglass_tortoise',
    season: 1,
  },
  // The Bonebound Rickshaw: a rattling bone-cart with a skeleton puller (its
  // own rig, skel_rickshaw_puller, composed at runtime by
  // src/render/rickshaw_mount.ts off this visualKey) and wheels that roll
  // from real ground travel. It shipped as a developer-only catalog mount
  // first, so the id keeps that catalog key: the GLB, the puller hook, the
  // rolling loop and the summon cue (mount_loop_ / mount_summon_rickshaw_mount)
  // are all keyed by it, and the store SKU follows the id.
  rickshaw_mount: {
    id: 'rickshaw_mount',
    name: 'Bonebound Rickshaw',
    rarity: 'epic',
    visualKey: 'mount_rickshaw_mount',
    season: 1,
  },
  goblin_rocket_sled: {
    id: 'goblin_rocket_sled',
    name: 'Goblin Rocket Sled',
    rarity: 'epic',
    visualKey: 'mount_goblin_rocket_sled',
    season: 1,
  },
};

/** Skins withdrawn from the game. Their assets, audio, legacy reins items and
 *  locale rows stay in the tree as dormant data (a load never destroys what a
 *  save carries), but nothing here sells, grants, wears, lists, or renders
 *  them: `isMountSkinId` is false, so the store and Cosmetics screen omit the
 *  card, the account mirror filters the grant, `normalizeMountSkinId` refuses
 *  the wear, the join reconcile takes a worn one off, and the renderer falls
 *  back to the ridden mount's own look. The Rallycart RXT (2026-09-10) was
 *  pulled after player feedback; its economy catalog row went first. */
export const RETIRED_MOUNT_SKIN_IDS: readonly string[] = ['rallycart_rxt'];

/** Catalog order (see MOUNT_SKINS). */
export const MOUNT_SKIN_IDS = Object.keys(MOUNT_SKINS) as readonly StoreMountSkinId[];

/** Item-backed skins never join the paid SKU catalog. Their ownership is revocable. */
export const COLLECTIBLE_MOUNT_SKINS = Object.fromEntries(
  MOUNT_KEYS.map((id) => [
    id,
    {
      id,
      name: MOUNTS[id].name,
      rarity: MOUNTS[id].rarity,
      visualKey: `mount_${id}`,
      season: 1,
    },
  ]),
) as Record<MountKey, MountSkinDef>;

export const ALL_MOUNT_SKIN_IDS: readonly MountSkinId[] = [...MOUNT_KEYS, ...MOUNT_SKIN_IDS];

export function isStoreMountSkinId(id: string): id is StoreMountSkinId {
  return Object.hasOwn(MOUNT_SKINS, id);
}

export function isMountSkinId(id: string): id is MountSkinId {
  return isStoreMountSkinId(id) || mountDef(id) !== null;
}

export function mountSkinDef(id: string): MountSkinDef | null {
  return isStoreMountSkinId(id)
    ? MOUNT_SKINS[id]
    : mountDef(id)
      ? COLLECTIBLE_MOUNT_SKINS[id as MountKey]
      : null;
}

/** Coerce a persisted/wire value to a catalog skin id, or null when absent or
 *  unknown (a save from a build that retired a skin loads cleanly unskinned). */
export function normalizeMountSkinId(value: unknown): MountSkinId | null {
  return typeof value === 'string' && isMountSkinId(value) ? value : null;
}

/** The key a ridden mount PRESENTS as: the worn skin's id when the rider wears
 *  one, else the mount's own catalog key. Every look-and-sound lookup (visual
 *  spec, engine/idle/stride audio, the summon cue, the cast-bar name) keys off
 *  this; every gameplay read keeps keying off Entity.mountKey. Dismounted ('')
 *  stays '' whatever skin is worn. */
export function mountPresentationKey(
  mountKey: string,
  mountSkinId: string | null | undefined,
): string {
  if (!mountKey) return '';
  return mountSkinId && isMountSkinId(mountSkinId) ? mountSkinId : mountKey;
}
