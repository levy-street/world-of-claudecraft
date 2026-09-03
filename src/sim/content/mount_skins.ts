// ---------------------------------------------------------------------------
// Mount skins: account-wide cosmetic looks a player wears OVER whatever mount
// they ride. Shared host-agnostic data (sim, server, renderer, HUD).
//
// A mount skin is NOT a mount. The ridden mount (Entity.mountKey, a reins item
// the character owns) keeps every gameplay number: speed, the melee block, the
// crit hook. The skin only decides which mount visual the renderer draws and
// which mount audio set plays, so real money buys a look and never a stat, the
// same line the Season 1 Armory weapon skins hold (content/weapon_skins.ts).
//
// Ownership is ACCOUNT-wide (AccountCosmetics.mountSkinIds, mirrored from the
// economy service's grant ledger into the rollback-safe
// account_mount_cosmetics row). The WORN skin is per character
// (PlayerMeta.mountSkinId, persisted in the character save, mirrored to
// Entity.mountSkinId and the identity wire as `msk`), mirroring how the Combat
// Mech chromas are owned by the account and worn by one character at a time.
//
// The skin id doubles as the economy SKU item id (kind 'skin', the same family
// as weapon skins), so ids here must stay in lockstep with the service catalog.
// `visualKey` names the render VISUALS entry (src/render/characters/manifest.ts)
// and the mount visual spec (src/render/mount_visuals.ts MOUNT_SKIN_VISUAL_SPECS);
// the sim never loads models, it carries the key so server and clients agree on
// what everyone sees. Audio clips stay keyed by the skin id
// (mount_run_<id>, mount_idle_<id>, the summon cue), see mountPresentationKey.
//
// Sim-pure data: no DOM, no server imports, safe for all three hosts.
// ---------------------------------------------------------------------------

import type { MountRarity } from './mounts';

export type MountSkinId = 'mech_bird' | 'chimeglass_tortoise';

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
export const MOUNT_SKINS: Record<MountSkinId, MountSkinDef> = {
  // The Cluckwork Mech Bird: the first store cosmetic that was a rideable
  // mount (reins_mech_bird, kind 'item') before mount skins existed. Authored
  // rigid-servo clips, powered idle hum and engine take set under its own key.
  mech_bird: {
    id: 'mech_bird',
    name: 'Cluckwork Mech Bird',
    rarity: 'rare',
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
};

/** Catalog order (see MOUNT_SKINS). */
export const MOUNT_SKIN_IDS = Object.keys(MOUNT_SKINS) as readonly MountSkinId[];

export function isMountSkinId(id: string): id is MountSkinId {
  return Object.hasOwn(MOUNT_SKINS, id);
}

export function mountSkinDef(id: string): MountSkinDef | null {
  return isMountSkinId(id) ? MOUNT_SKINS[id] : null;
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
