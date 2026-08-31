import type { DungeonDifficulty } from '../sim/types';
import type { WorldInteractionOutcome } from './interaction';

// One raid's lockout as projected to the HUD: the dungeon id plus the time left
// until it unlocks. The seam only ever surfaces still-locked raids.
export interface RaidLockout {
  id: string;
  msRemaining: number;
}

// The local player's active procedural Rift floor, or null when not in a rift.
// The renderer regenerates the floor's geometry + visual style from the descriptor
// (seed + baseLevel + floorIndex) via the same pure generator the server ran, so
// no geometry travels over the wire. Instance origin and content identity are
// explicit so two groups racing identical content never alias runtime identity.
export interface RiftFloorView {
  eventId: string | null;
  instanceId: number;
  seed: number;
  baseLevel: number;
  floorIndex: number;
  floorCount: number;
  origin: { x: number; z: number };
  contentId: string;
  contentHash: string;
  upgrade: import('../sim/rift/types').RiftUpgradeManifest | null;
  name: string;
  themeName: string;
  /** C/B/A/S rank of the run (null for dev-portal runs), for the minimap label. */
  tier: import('../sim/types').RiftTier | null;
}

/** A live lethal boss death zone on the current rift boss floor. Players inside
 * the radius when `remaining` reaches zero take flat lethal damage. The renderer
 * draws a pulsing red decal ring at (x, z). `total` is the full fuse the zone
 * spawned with, so the visual can show elapsed progress (`1 - remaining / total`)
 * as a closing timer sweep, not just an undated countdown. Accepted host
 * asymmetry: offline the first observable `remaining` is already one tick
 * (DT) below `total` (the fuse ticks in the same sim step that placed it),
 * while online it starts at exactly `total` when the spawn event lands; the
 * sweep consumer clamps, so the ~1% skew is invisible. */
export interface RiftBossDeathZoneView {
  x: number;
  z: number;
  radius: number;
  remaining: number;
  total: number;
}

export interface IWorldDungeons {
  enterDungeon(dungeonId: string): WorldInteractionOutcome;
  leaveDungeon(): WorldInteractionOutcome;
  // Still-locked raids for the local player (unlock countdown in ms), driving the
  // minimap raid-lockout badge + panel. Empty when nothing is locked.
  raidLockouts(): RaidLockout[];
  // The active procedural Rift floor for the local player (null outside a rift).
  riftFloor: RiftFloorView | null;
  // Key into the per-Sim rift collision registry (sim/colliders.ts). Per world
  // INSTANCE, not per seed; a fixed value allocated once per world (offline
  // Sim or online ClientWorld). Note this member's client-side reach is
  // narrower than the token's overall reach: the swept-landing crest
  // re-resolve behind Blink, Shadowstep, and Heroic Leap
  // (src/sim/combat/heroic_leap.ts) reads SimContext.riftCollisionToken,
  // which is always the authoritative Sim (offline, or the server's own),
  // never this ClientWorld member; that route was never inert online. This
  // member instead feeds the client's OWN two consumers: click-to-move
  // (findPlayerPath/resolvePlayerDestination in src/main.ts) and the
  // display-only self-motion predictor (src/render/self_motion.ts). Movement
  // resolution itself stays server-authoritative online either way; the
  // ONLINE client registers a region under this token purely so those two
  // local, display-only routes can resolve against real rift geometry
  // instead of treating a rift wall as open floor (src/net/online.ts
  // applyRiftStateEvent mirrors the riftFloor's colliders under it, and
  // endSession clears the region on session end). The token carries no
  // registered region (inert, matching outside-a-rift behavior) outside a
  // rift; 0 itself is reserved for "no token" (a caller like mob pathing that
  // never passes one).
  riftCollisionToken: number;
  // Live lethal death zones on the current rift boss floor (empty outside a rift or
  // before the A-rank mechanic fires). The renderer draws a pulsing red decal ring
  // at each zone position so players can see and react to the telegraph.
  riftBossDeathZones(): RiftBossDeathZoneView[];
  // Milliseconds remaining before the current rift's backing world event stops
  // admitting new parties (see closeNaturalRiftPortal in sim/rift/portals.ts: an
  // already in-progress run plays out past this deadline, only the overworld
  // entrance closes to new entrants). Null outside a rift (riftFloor is null) or
  // for a dev-spawned rift, which has no backing event. Recomputed fresh on every
  // call, like raidLockouts(), so the HUD "closes in" countdown ticks locally
  // without a snapshot round trip.
  riftEventMsRemaining(): number | null;
  dungeonDifficulty(): DungeonDifficulty;
  setDungeonDifficulty(difficulty: DungeonDifficulty): void;
  // Buy one Heroic Quartermaster offer (src/sim/content/heroic_vendor.ts),
  // paying its Heroic Marks price from the buyer's bags. Server-validated.
  buyHeroicVendorItem(itemId: string): void;
  // Redeem one Crucible Quartermaster set piece (src/sim/content/ignivar_loot.ts),
  // paying its matching-slot sigil from the buyer's bags. Server-validated,
  // class-gated sim-side.
  buyCrucibleVendorItem(itemId: string): void;
}
