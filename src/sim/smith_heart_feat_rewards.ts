// What the Smith's Heart's deeds pay (content/smith_heart_rewards.ts): each encounter feat
// its encounter's weapon appearance (SMITHS_HEART_WEAPON_SKINS), the meta the Quarryheart
// Charger (SMITHS_HEART_META_MOUNT). Cosmetic only, like every deed reward.
//
// Ownership follows each cosmetic's own model:
//  - A weapon appearance is ACCOUNT-wide. The sim writes it into ctx.accountCosmetics (the
//    offline host's own mirror, the authority there; replaced whole, never mutated). Online
//    the server is the authority: it observes the deedUnlocked event and persists the grant
//    into the account's weapon cosmetics row (server/account_cosmetics_service.ts
//    grantDeedRewardSkins), and re-derives it from the earned deeds at every join, so a lost
//    write heals itself. No server ownership decision reads the sim's mirror.
//  - The mount is its soulbound reins in the bags (src/sim/mounts.ts mountOwned), so the sim
//    grants it on every host and the server's account mount projection follows the bags.
//    Bags too full: a line says so and the join heal below delivers it at the next login.
//
// Called from grantDeed (src/sim/deeds.ts) on every grant, retro included, and from the join
// pass (retroFallbackGrants) to heal a missed delivery. Idempotent; draws no rng.

import { SMITHS_HEART_META_MOUNT } from './content/mounts';
import {
  SMITH_HEART_FEAT_DEEDS,
  SMITH_HEART_FEAT_ORDER,
  SMITH_HEART_META_DEED,
  smithHeartFeatEncounter,
} from './content/smith_heart_rewards';
import { SMITHS_HEART_WEAPON_SKINS } from './content/weapon_skins';
import { mountItemId } from './mounts';
import type { PlayerMeta } from './sim';
import type { SimContext } from './sim_context';

/** The weapon appearance a deed pays, or null (only the five encounter feats pay one). */
export function smithHeartDeedSkin(deedId: string): string | null {
  const encounter = smithHeartFeatEncounter(deedId);
  return encounter ? SMITHS_HEART_WEAPON_SKINS[encounter] : null;
}

/** The weapon appearances a set of earned deeds pays, in encounter order. */
export function smithHeartSkinsForDeeds(deedIds: Iterable<string>): string[] {
  const earned = new Set(deedIds);
  return SMITH_HEART_FEAT_ORDER.filter((e) => earned.has(SMITH_HEART_FEAT_DEEDS[e])).map(
    (e) => SMITHS_HEART_WEAPON_SKINS[e],
  );
}

/** The mount a deed pays, or null (only the meta pays one). */
export function smithHeartDeedMount(deedId: string): string | null {
  return deedId === SMITH_HEART_META_DEED ? SMITHS_HEART_META_MOUNT : null;
}

function grantSkinToMirror(ctx: SimContext, skinId: string): void {
  const owned = ctx.accountCosmetics.weaponSkinIds;
  if (owned.includes(skinId)) return;
  ctx.accountCosmetics = { ...ctx.accountCosmetics, weaponSkinIds: [...owned, skinId] };
}

/** The reins sit in this character's own bags, bank or courier (never the account
 *  projection alone, which may still be loading at a join). */
function holdsReins(meta: PlayerMeta, itemId: string): boolean {
  return (
    meta.inventory.some((s) => s.itemId === itemId) ||
    meta.bank.inventory.some((s) => s.itemId === itemId) ||
    !!meta.courier?.cargo.some((s) => s.itemId === itemId)
  );
}

/** Deliver the meta's reins unless THIS character already holds them. Every earner gets its
 *  own soulbound reins on every host: the check is the character's own containers, never the
 *  account's mount projection (online that would hand an alt nothing because a sibling holds
 *  a pair, and offline it reads only these same containers). Returns true when the reins
 *  were placed in the bags. */
function deliverMount(ctx: SimContext, meta: PlayerMeta, key: string, quiet: boolean): boolean {
  const itemId = mountItemId(key);
  if (!itemId) return false;
  if (holdsReins(meta, itemId)) return false;
  if (!ctx.canAddItem(itemId, 1, meta.entityId)) {
    // English re-localized at the client (src/ui/sim_i18n.ts).
    if (!quiet)
      ctx.error(
        meta.entityId,
        'Your bags are full. The Quarryheart Charger will wait for you until your next login.',
      );
    return false;
  }
  ctx.addItem(itemId, 1, meta.entityId);
  return true;
}

/** grantDeed's hook: pay whatever cosmetic the freshly granted deed carries. */
export function paySmithHeartDeedReward(ctx: SimContext, meta: PlayerMeta, deedId: string): void {
  const skin = smithHeartDeedSkin(deedId);
  if (skin) grantSkinToMirror(ctx, skin);
  const mount = smithHeartDeedMount(deedId);
  if (mount) deliverMount(ctx, meta, mount, false);
}

/** The join heal: every earned feat's appearance is in the mirror and an earned meta's reins
 *  are held (a delivery the bags refused lands now, silently when they are still full). */
export function healSmithHeartRewards(ctx: SimContext, meta: PlayerMeta): void {
  for (const skin of smithHeartSkinsForDeeds(meta.deedsEarned.keys())) grantSkinToMirror(ctx, skin);
  if (meta.deedsEarned.has(SMITH_HEART_META_DEED))
    deliverMount(ctx, meta, SMITHS_HEART_META_MOUNT, true);
}
