import type { BuddyKey } from '../sim/content/buddies';

// Cosmetic followers. Zero GAMEPLAY effect: no stats, no combat. It is a
// real owned mob entity that heels via src/sim/pet/buddy_ai.ts, the same A*
// locomotion as a hunter pet (see src/sim/content/buddies.ts's header), and
// every client renders that entity through the ordinary per-mob view path,
// not by reading a field off the owner.
// The catalog itself is sim content (src/sim/content/buddies.ts); the live
// "which buddy is out" state rides the entity mirror (Entity.buddyKey, synced
// in identity fields like skin/mountKey), exactly like the active mount: there
// is deliberately no `activeBuddy()` read here, mirroring `IWorldMounts` (no
// `activeMount()` either). HUD/UI code reads `world.entities.get(pid)
// ?.buddyKey` directly off the entity mirror for ANY player, local or remote,
// but that read is identity-only (e.g. "is a buddy out at all"), never what
// puts the follower's body on screen.
// Summoning a SPECIFIC buddy is an item use (a whistle in bags or an
// action-bar slot, like mount reins), not a command here; toggleBuddy is
// dismiss-only, for a keybind/button with no item in hand. Everything
// re-validates server-side (ownership) in src/sim/buddies.ts.
export interface IWorldBuddies {
  /** The owned subset of the catalog, in catalog order: any buddy whose
   *  whistle item sits in bags or bank. A fresh player owns nothing. */
  ownedBuddies(): readonly BuddyKey[];
  /** Dismiss the active buddy (no-op when none is out). Summoning a specific
   *  buddy is an item use, not a keybind. */
  toggleBuddy(): void;
  /** Enable/disable the buddy autoloot errand: while on, the buddy walks to
   *  the player's OWN lootable corpses within 30yd and loots them for them
   *  (src/sim/pet/buddy_autoloot.ts). A preference, settable with no buddy
   *  out; the live state rides the entity mirror (Entity.buddyAutoloot, terse
   *  `budal`) like buddyKey, so there is no read member here either. */
  setBuddyAutoloot(enabled: boolean): void;
}
