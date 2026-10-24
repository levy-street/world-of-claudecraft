// Garrick Holt, Lantern Hall's quartermaster (content/guild_contracts.ts
// GUILD_QUARTERMASTER_STOCK): Lantern Seals for cosmetics only. Three kinds of offer:
//  - a title: a Book of Deeds feat granted through the one grant path (deeds.ts grantDeed), so
//    the Book and the title picker follow;
//  - the guild's war horse: its reins into the bags (a mount is owned while its reins are held,
//    src/sim/mounts.ts mountOwned), behind the same riding gate the stable's own reins keep;
//  - the guild's sword appearance: an ACCOUNT-wide weapon skin. The sim does not own that
//    ledger (the server's per-session cosmetics do, and the offline Sim's own mirror stands in
//    for them), so the host hands in a GuildAccountPort that answers "already owned?" and
//    performs the grant.
//
// Server-authoritative like the Heroic Quartermaster (instances/heroic_vendor.ts): the client
// only sends intent; everything re-validates here. Synchronous rewards land before seals
// leave the bags. Online account rewards reserve seals in the host's save FIFO and commit
// the character charge and account grant together before publishing success.
// Refusals are structured events (the client owns every visible string). Draws no rng.

import { DEEDS } from './content/deeds';
import {
  GUILD_QUARTERMASTER_STOCK_BY_ID,
  type GuildQuartermasterOffer,
  LANTERN_SEAL_ITEM_ID,
} from './content/guild_contracts';
import {
  GUILD_QUARTERMASTER_NPC_ID,
  HIGHWATCH_GUILD_ENTITY_IDS,
  HIGHWATCH_GUILD_TALK_RANGE,
} from './content/highwatch_guild';
import { WEAPON_SKINS } from './content/weapon_skins';
import { ITEMS } from './data';
import { grantDeed } from './deeds';
import { mountOwned } from './mounts';
import type { PlayerMeta } from './sim';
import type { SimContext } from './sim_context';
import type { Entity, GuildCosmeticRefusal } from './types';

/** The account-wide cosmetics ledger the buyer's host owns. Offline it is the Sim's own
 *  accountCosmetics mirror; on the server it is the acting session's cosmetics (never the
 *  realm-wide ctx.accountCosmetics, which no server ownership decision may read). */
export interface GuildAccountPort {
  ownsWeaponSkin(skinId: string): boolean;
  /** Online hosts reserve and persist the charge in their character-save FIFO. */
  purchaseWeaponSkin?(offerId: string): void;
  /** Grant the skin to the account. Returns false when it could not be granted, in which case
   *  the seals are kept. */
  grantWeaponSkin(skinId: string): boolean;
}

/** The offline host's port: the Sim's own account cosmetics mirror (replaced whole, never
 *  mutated in place, so consumers can diff by identity). The server never uses this: its
 *  ctx.accountCosmetics is realm-wide, so server/quest_command_wire.ts hands in the session's. */
export function localGuildAccountPort(ctx: SimContext): GuildAccountPort {
  return {
    ownsWeaponSkin: (skinId) => ctx.accountCosmetics.weaponSkinIds.includes(skinId),
    grantWeaponSkin: (skinId) => {
      const owned = ctx.accountCosmetics.weaponSkinIds;
      if (!owned.includes(skinId))
        ctx.accountCosmetics = { ...ctx.accountCosmetics, weaponSkinIds: [...owned, skinId] };
      return true;
    },
  };
}

/** The quartermaster within reach of the player (alive, beside him, on his floor). */
export function guildQuartermasterInRange(ctx: SimContext, player: Entity): boolean {
  const npc = ctx.entities.get(HIGHWATCH_GUILD_ENTITY_IDS[GUILD_QUARTERMASTER_NPC_ID]);
  if (!npc || npc.dead || npc.kind !== 'npc' || npc.templateId !== GUILD_QUARTERMASTER_NPC_ID)
    return false;
  if (Math.hypot(player.pos.x - npc.pos.x, player.pos.z - npc.pos.z) > HIGHWATCH_GUILD_TALK_RANGE)
    return false;
  return Math.abs(player.pos.y - npc.pos.y) <= 3;
}

/** The offer can be granted at all (its title, reins or skin exists in the catalogs). */
export function guildOfferResolves(offer: GuildQuartermasterOffer): boolean {
  switch (offer.kind) {
    case 'title':
      return Object.hasOwn(DEEDS, offer.deedId);
    case 'mount': {
      const def = Object.hasOwn(ITEMS, offer.itemId) ? ITEMS[offer.itemId] : undefined;
      return def?.kind === 'mount';
    }
    case 'weaponSkin':
      // only the guild's own arms: a skin reserved elsewhere (a future raid's) never sells here
      return (
        Object.hasOwn(WEAPON_SKINS, offer.skinId) &&
        WEAPON_SKINS[offer.skinId].earnedFrom === 'lantern_hall'
      );
  }
}

/** Whether the buyer already has what the offer grants. */
export function guildOfferOwned(
  meta: PlayerMeta,
  offer: GuildQuartermasterOffer,
  account: GuildAccountPort,
): boolean {
  switch (offer.kind) {
    case 'title':
      return meta.deedsEarned.has(offer.deedId);
    case 'mount': {
      const def = ITEMS[offer.itemId];
      return def?.kind === 'mount' && mountOwned(meta, def.mount);
    }
    case 'weaponSkin':
      return account.ownsWeaponSkin(offer.skinId);
  }
}

export function buyGuildCosmetic(
  ctx: SimContext,
  offerId: string,
  pid: number | undefined,
  account: GuildAccountPort = localGuildAccountPort(ctx),
): void {
  const resolved = ctx.resolve(pid);
  if (!resolved) return;
  const { meta, e: player } = resolved;
  if (!Object.hasOwn(GUILD_QUARTERMASTER_STOCK_BY_ID, offerId)) return;
  const offer = GUILD_QUARTERMASTER_STOCK_BY_ID[offerId];
  // never take the seals for something the catalogs cannot grant
  if (!guildOfferResolves(offer)) return;
  if (player.dead) return;
  const refuse = (reason: GuildCosmeticRefusal): void => {
    ctx.emit({ type: 'guildCosmeticRefused', offerId, reason, pid: meta.entityId });
  };
  if (!guildQuartermasterInRange(ctx, player)) {
    refuse('range');
    return;
  }
  if (guildOfferOwned(meta, offer, account)) {
    refuse('owned');
    return;
  }
  if (ctx.countItem(LANTERN_SEAL_ITEM_ID, meta.entityId) < offer.seals) {
    refuse('seals');
    return;
  }
  if (offer.kind === 'mount') {
    // the stable's own gate (items.ts buyItem): reins are no use to a rider who cannot ride
    if (!meta.ridingTrained) {
      refuse('riding');
      return;
    }
    if (!ctx.canAddItem(offer.itemId, 1, meta.entityId)) {
      refuse('bags');
      return;
    }
  }
  if (offer.kind === 'weaponSkin' && account.purchaseWeaponSkin) {
    account.purchaseWeaponSkin(offerId);
    return;
  }
  if (!grantOffer(ctx, meta, offer, account)) return;
  ctx.removeItem(LANTERN_SEAL_ITEM_ID, offer.seals, meta.entityId);
  ctx.emit({ type: 'guildCosmeticBought', offerId, pid: meta.entityId });
}

/** Reserve an online purchase inside the save FIFO. Reuse every ordinary purchase gate,
 * but publish neither ownership nor success until the host commits both durable writes. */
export function reserveGuildWeaponSkin(
  ctx: SimContext,
  offerId: string,
  pid: number,
  ownsWeaponSkin: (skinId: string) => boolean,
): Extract<GuildQuartermasterOffer, { kind: 'weaponSkin' }> | null {
  if (!Object.hasOwn(GUILD_QUARTERMASTER_STOCK_BY_ID, offerId)) return null;
  const offer = GUILD_QUARTERMASTER_STOCK_BY_ID[offerId];
  if (offer.kind !== 'weaponSkin') return null;
  let valid = false;
  buyGuildCosmetic(ctx, offerId, pid, {
    ownsWeaponSkin,
    grantWeaponSkin: () => {
      valid = true;
      return false;
    },
  });
  if (!valid) return null;
  ctx.removeItem(LANTERN_SEAL_ITEM_ID, offer.seals, pid);
  return offer;
}

function grantOffer(
  ctx: SimContext,
  meta: PlayerMeta,
  offer: GuildQuartermasterOffer,
  account: GuildAccountPort,
): boolean {
  switch (offer.kind) {
    case 'title':
      return grantDeed(ctx, meta, offer.deedId);
    case 'mount': {
      const before = ctx.countItem(offer.itemId, meta.entityId);
      ctx.addItem(offer.itemId, 1, meta.entityId);
      return ctx.countItem(offer.itemId, meta.entityId) > before;
    }
    case 'weaponSkin':
      return account.grantWeaponSkin(offer.skinId);
  }
}
