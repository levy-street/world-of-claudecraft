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
 * draws a pulsing red decal ring at (x, z). */
export interface RiftBossDeathZoneView {
  x: number;
  z: number;
  radius: number;
  remaining: number;
}

export interface IWorldDungeons {
  enterDungeon(dungeonId: string): WorldInteractionOutcome;
  leaveDungeon(): WorldInteractionOutcome;
  // Still-locked raids for the local player (unlock countdown in ms), driving the
  // minimap raid-lockout badge + panel. Empty when nothing is locked.
  raidLockouts(): RaidLockout[];
  // The active procedural Rift floor for the local player (null outside a rift).
  riftFloor: RiftFloorView | null;
  // Key into the per-Sim rift collision registry (sim/colliders.ts), used by the
  // renderer's camera occlusion inside a rift. Per world INSTANCE, not per seed;
  // 0 where no rift regions are registered (the online ClientWorld).
  riftCollisionToken: number;
  // Live lethal death zones on the current rift boss floor (empty outside a rift or
  // before the A-rank mechanic fires). The renderer draws a pulsing red decal ring
  // at each zone position so players can see and react to the telegraph.
  riftBossDeathZones(): RiftBossDeathZoneView[];
  dungeonDifficulty(): DungeonDifficulty;
  setDungeonDifficulty(difficulty: DungeonDifficulty): void;
  // Buy one Heroic Quartermaster offer (src/sim/content/heroic_vendor.ts),
  // paying its Heroic Marks price from the buyer's bags. Server-validated.
  buyHeroicVendorItem(itemId: string): void;
}
