// ---------------------------------------------------------------------------
// What KIND of thing an item is for the $WOC Exchange, and which transfer locks
// hold for that kind whatever an operator's policy says.
//
// One definition, because there are four enforcement points and they must
// agree: the server's listingEligibility (server/woc_market_rules.ts, the
// authoritative one), the sim's extractTradableCopy (src/sim/inventory_extract.ts,
// defence in depth at the bags), and the two client pre-filters, sellableRows
// (src/ui/woc_market_view.ts, the Sell picker) and wocTradableSlot
// (src/ui/trade_woc_view.ts, the trade window's exchange arm). Each carried its
// own copy of the same checks, so a category the server accepted could still be
// refused at escrow, or never offered in the picker at all. That is what earns a
// shared module (the repo's rule of three), and this is the shared one.
//
// The per-copy half is shared one level further out: the locks that depend on
// the INSTANCE rather than the def come from isTransferLockedInstance
// (transfer_lock.ts, re-exported by item_instance_transfer.ts), the same
// predicate the gold market, Ravenpost
// mail and the guild bank gate on. Every one of those is an anonymous pipe with
// nobody for a bind-on-trade stamp to land on, so a state one of them refuses
// and this rail accepts would be a laundering route rather than a difference of
// opinion. The face-to-face gold trade (social/trade.ts isTradeLocked) is the
// deliberate exception: it has a named recipient, so an armed copy passes there.
// A DIRECTED $WOC offer also names its recipient but stays refused on purpose:
// its delivery path stamps no boundTo, so the copy would arrive still armed
// and re-listable (whether directed delivery should stamp its recipient and
// inherit the trade-window exception is an open design call).
//
// The split of responsibility matters and is deliberate: this module owns the
// CONTENT TAXONOMY (a mount is a mount because src/sim/content says so) and the
// locks that are true of a category regardless of configuration. It owns NO
// policy. Whether a category trades at all, what the price floor is, and which
// ids an operator has excluded stay on the server, which is the only layer
// entitled to decide them.
//
// `src/sim`-pure: no DOM/Three/render-ui-game-net imports, no rng, no clock. It
// is a leaf (no SimContext, and the two predicates it borrows come from
// dependency-free leaves of their own, transfer_lock.ts and item_lock_flag.ts,
// so neither drags a runtime graph), so a Vitest imports it directly. It
// carries no wallet, token, or
// settlement vocabulary, so the token firewall over src/sim
// (tests/architecture.test.ts) still holds with this file inside it.
// ---------------------------------------------------------------------------

import { weaponTypeForItem } from './content/weapon_skin_rules';
import { isItemLocked } from './item_lock_flag';
import { isTransferLockedInstance } from './transfer_lock';
import type { ItemDef, ItemInstancePayload } from './types';

/**
 * The exchange-facing category of an item def.
 *
 * `other` is the closed default: anything this taxonomy does not recognize is
 * not tradable, so a new content kind is refused until someone decides
 * otherwise rather than silently becoming sellable.
 */
export type ExchangeItemCategory = 'mount' | 'mech_chroma' | 'equipment' | 'other';

/**
 * Classify a def. Order is load-bearing where the tests overlap: a mount item
 * carries no equip slot today, but classifying by the explicit `kind`/`use`
 * discriminators FIRST means a mount or a chroma plate that later gains a slot
 * keeps its own category instead of silently becoming equipment and picking up
 * the equipment quality floor.
 */
export function exchangeItemCategory(def: ItemDef): ExchangeItemCategory {
  if (def.kind === 'mount') return 'mount';
  if (def.use?.type === 'mechChroma') return 'mech_chroma';
  if (def.slot !== undefined) return 'equipment';
  return 'other';
}

/**
 * The Browse filter's PLAYER-facing category split, distinct from
 * ExchangeItemCategory on purpose: eligibility groups all gear as
 * 'equipment' because one policy floor covers it, while a browsing player
 * filters weapons and armor apart. Derived, never stored on the def, and
 * shared by the server (which stamps it onto the listing row at escrow) and
 * the client (which builds the filter controls from the same vocabulary).
 */
export type ExchangeBrowseCategory = 'weapon' | 'armor' | 'mount' | 'chroma' | 'other';

export function exchangeBrowseCategory(def: ItemDef): ExchangeBrowseCategory {
  if (def.kind === 'mount') return 'mount';
  if (def.use?.type === 'mechChroma') return 'chroma';
  if (def.kind === 'weapon') return 'weapon';
  // held_offhand rides the armor arm: it equips in an armor slot and a
  // browsing player looks for it there, not under weapons.
  if (def.kind === 'armor' || def.kind === 'held_offhand') return 'armor';
  return 'other';
}

/**
 * The category's finer axis: a weapon's type (the weapon-skin vocabulary
 * plus polearm) or an armor piece's slot (the def's own ItemSlot: items
 * declare the slot KIND, 'ring', never ring1/ring2). Null for the
 * categories with no finer axis, and for a weapon whose type the vocabulary
 * cannot name (the filter simply cannot reach it, which is honest).
 */
export function exchangeBrowseSubcategory(def: ItemDef): string | null {
  const category = exchangeBrowseCategory(def);
  if (category === 'weapon') return weaponTypeForItem(def.id);
  if (category === 'armor') return def.slot ?? null;
  return null;
}

/**
 * The locks no configuration may lift.
 *
 * `quest_item`, `bound_copy` and `bind_armed` are absolute: a quest item is not
 * property, a copy already bound to a character cannot become someone else's,
 * and an armed copy (commissioned gear carrying bindOnTrade with no stamp yet)
 * binds to whoever receives it next, which an anonymous escrow has nobody to
 * be. Unbinding clears `boundTo` and leaves `bindOnTrade`, so a peeled copy
 * returns to the armed state rather than to a plain one.
 *
 * The DIRECTED $WOC rail keeps the bind_armed refusal too, on a DIFFERENT
 * ground (judged in the directed-rail hardening; the gold trade window's
 * named-recipient exception deliberately does NOT extend to it). A directed
 * deal has a named recipient, so the anonymity premise above does not apply;
 * what does is the ESCROW LIFECYCLE: an armed copy admitted into escrow makes
 * every exit rail a binding decision (the delivery grant would have to stamp,
 * the expiry return flight, the compensation restore, the mail parcel, and
 * the operator claims park must each NOT), and the mail rail refuses armed
 * copies for every other sender. Lifting the refusal for named deals means
 * building and testing a stamp-at-delivery arm across all of those first; it
 * is recorded as an offered product follow-up, not a hardening change.
 *
 * `soulbound` and `no_market_list` are absolute only for the categories that do
 * not tolerate them, which is where the two collectible categories differ from
 * everything else:
 *
 * - A MOUNT may be soulbound, and the tolerance exists so that a soulbound one
 *   still trades here. This was written when EVERY reins item was soulbound,
 *   because holding the reins IS owning the mount (src/sim/mounts.ts mountOwned
 *   reads the bags and the bank). v0.35.0 then un-soulbound the player reins on
 *   purpose, so ownership now transfers through the ordinary economy too
 *   (MountItemDef in types.ts), and only the developer-only tank stays bound.
 *   The tolerance is kept rather than removed: it is what guarantees the stated
 *   product rule that EVERY mount trades regardless of tier, whichever ones
 *   content decides to bind in future.
 * - A MECH CHROMA plate is flagged noMarketList, which keeps it off the in-game
 *   gold market for the same reason. Tolerated here for the same scope.
 *
 * Everything else keeps both refusals exactly as before.
 */
export type ExchangeLock =
  | 'soulbound'
  | 'quest_item'
  | 'no_market_list'
  | 'bound_copy'
  | 'bind_armed'
  | 'locked';

export function exchangeHardLock(
  def: ItemDef,
  instance: ItemInstancePayload | undefined,
): ExchangeLock | null {
  const category = exchangeItemCategory(def);
  if (def.kind === 'quest') return 'quest_item';
  // The sibling pipes' predicate, so parity holds by construction rather than by
  // two lists agreeing today. It answers WHETHER the copy is locked; which of
  // the two states it is in decides what the player is told, and the stamp wins
  // because `boundTo` is the stronger fact (pid 0 is a real character id, so the
  // read is presence, never truthiness).
  if (isTransferLockedInstance(instance)) {
    return instance?.boundTo !== undefined ? 'bound_copy' : 'bind_armed';
  }
  if (def.soulbound && category !== 'mount') return 'soulbound';
  if (def.noMarketList && category !== 'mech_chroma') return 'no_market_list';
  // The player's own item lock (issue 3042, R10): a copy its owner locked
  // against salvage, crafting, and vendor sale refuses the $WOC exchange the
  // same way; the seller unlocks it first. Deliberately the LAST arm: the
  // permanent locks above name the stronger fact, and only a copy nothing
  // else refuses reports the one the player can lift themselves. The gold
  // market keeps its allow posture by ruling; it does not consult this
  // predicate.
  if (isItemLocked(instance)) return 'locked';
  return null;
}

/**
 * True when a category's price floor is the equipment one.
 *
 * Mounts and chromas are collectibles whose rarity is a look, not power, and
 * they are traded at ANY tier by design, so the equipment floor (epic by
 * default) must not reach them: applying it would silently hide every common,
 * uncommon and rare mount from the Exchange while reporting them ineligible.
 */
export function exchangeCategoryUsesQualityFloor(category: ExchangeItemCategory): boolean {
  return category === 'equipment';
}
