import type { BuddyKey } from '../sim/content/buddies';

// Cosmetic followers. Zero GAMEPLAY effect: no stats, no combat. It is a
// real owned mob entity that heels via src/sim/pet/buddy_ai.ts, the same A*
// locomotion as a hunter pet (see src/sim/content/buddies.ts's header), and
// every client renders that entity through the ordinary per-mob view path,
// not by reading a field off the owner.
//
// Ownership is account-wide online, mirrored in each player by the host.
// Pending rewards and equipped choices remain character-local. A companion
// never sits in a bag and never trades. The live "which buddy is out" state rides
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
  /** Companions won off a boss that have not revealed themselves yet (the
   *  player read the presence line; the reveal waits for the zone-out). */
  pendingBuddies(): readonly BuddyKey[];
  /** Summon a specific collected buddy, or dismiss it when it is the one out. */
  summonBuddy(key: BuddyKey): void;
  /** Legacy local helper; the online shortcut token is retired. UI uses summonBuddy. */
  toggleBuddy(): void;
  /** Rename the currently summoned buddy; its name persists per character and buddy. */
  renameBuddy(buddyId: number, name: string): void;
  /** Enable/disable the buddy autoloot errand: while on, the buddy walks to
   *  the player's OWN lootable corpses within 30yd and loots them for them
   *  (src/sim/pet/buddy_autoloot.ts). A preference, settable with no buddy
   *  out; the live state rides the entity mirror (Entity.buddyAutoloot, terse
   *  `budal`) like buddyKey, so there is no read member here either. */
  setBuddyAutoloot(enabled: boolean): void;
}
