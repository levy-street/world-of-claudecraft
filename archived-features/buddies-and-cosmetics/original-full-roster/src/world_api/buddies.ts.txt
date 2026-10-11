import type { BuddyKey } from '../sim/content/buddies';

// Cosmetic followers. Zero GAMEPLAY effect: no stats, no combat. It is a
// real owned mob entity that heels via src/sim/pet/buddy_ai.ts, the same A*
// locomotion as a hunter pet (see src/sim/content/buddies.ts's header), and
// every client renders that entity through the ordinary per-mob view path,
// not by reading a field off the owner.
//
// Ownership is a per-CHARACTER collection (src/sim/buddies.ts): a companion
// attaches to the character (a boss roll, a deed, a grant token), never sits
// in a bag, and never trades. Cosmetics are a second per-character set, one
// of which can be worn per buddy. The live "which buddy is out" state rides
// the entity mirror (Entity.buddyKey, synced in identity fields like
// skin/mountKey), exactly like the active mount: there is deliberately no
// `activeBuddy()` read here, mirroring `IWorldMounts`. HUD/UI code reads
// `world.entities.get(pid)?.buddyKey` directly off the entity mirror for ANY
// player, local or remote, but that read is identity-only.
//
// Everything re-validates server-side (ownership, fit) in src/sim/buddies.ts.
export interface IWorldBuddies {
  /** The collected subset of the catalog, in catalog order. A fresh player
   *  owns nothing. */
  ownedBuddies(): readonly BuddyKey[];
  /** The unlocked cosmetic ids (src/sim/content/buddy_cosmetics.ts), sorted. */
  ownedBuddyCosmetics(): readonly string[];
  /** The worn cosmetic per buddy key; a buddy absent here wears its own look. */
  equippedBuddyCosmetics(): Readonly<Record<string, string>>;
  /** Companions won off a boss that have not revealed themselves yet (the
   *  player read the presence line; the reveal waits for the zone-out). */
  pendingBuddies(): readonly BuddyKey[];
  /** Summon a specific collected buddy, or dismiss it when it is the one out. */
  summonBuddy(key: BuddyKey): void;
  /** Wear `cosmeticId` on `key` (null = the buddy's own look). */
  equipBuddyCosmetic(key: BuddyKey, cosmeticId: string | null): void;
  /** Dismiss the active buddy, or bring the last summoned one back out. */
  toggleBuddy(): void;
  /** Enable/disable the buddy autoloot errand: while on, the buddy walks to
   *  the player's OWN lootable corpses within 30yd and loots them for them
   *  (src/sim/pet/buddy_autoloot.ts). A preference, settable with no buddy
   *  out; the live state rides the entity mirror (Entity.buddyAutoloot, terse
   *  `budal`) like buddyKey, so there is no read member here either. */
  setBuddyAutoloot(enabled: boolean): void;
}
