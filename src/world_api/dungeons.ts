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

// One Source Cave mob as shown in the cave's roster display: the contributor login
// (spliced verbatim, D7) plus its rank flags. Not the wire Entity, just the static
// roster projection.
export interface SourceCaveMobDisplay {
  login: string;
  elite: boolean;
  boss: boolean;
  /** Whether this visible contributor participates in the current encounter budget. */
  combatant: boolean;
  /**
   * The contributor's own merged-PR rung ('tinkerer' to 'worldwright'), or null
   * below the first rung. This is PRESTIGE, not power: it names who the person is
   * and drives the friendly-phase nameplate title, while `combatTier` below names
   * what the mob does. The two diverge whenever the roster overflows the combat
   * budget (src/sim/source_cave/combatants.ts).
   */
  tier: string | null;
  /** Assigned combat role, or null for an overflow guardian. Drives the nameplate diamond tint. */
  combatTier: string | null;
}

export type SourceCaveSealState = 'idle' | 'active' | 'breached' | 'cleared';

// The Source Cave HUD view: the full visible roster (`mobs`) plus the fixed combat total
// and viewer progress (`totalMobs` / `killed`), with `cleared` from the active lockout.
export interface SourceCaveInfo {
  moduleCount: number;
  // Ordered module-type keys (delve module ids, e.g. 'reliquary_sunken_ossuary')
  // that assemble the cave, index-aligned with SourceCaveMobDisplay.moduleIndex
  // would be if that field existed on the wire. Render needs the actual sequence,
  // not just moduleCount, because delveModuleZOffset stacks modules by their real
  // per-type footprint (trash module types are not uniform length). Static for the
  // cave's lifetime, same length as moduleCount.
  modules: string[];
  mobs: SourceCaveMobDisplay[];
  totalMobs: number;
  killed: number;
  cleared: boolean;
  /** Centre-floor presentation state, always authoritative from the owning Sim. */
  sealState: SourceCaveSealState;
  playersInsideSeal: number;
  playersInInstance: number;
  activeWave: number;
  totalWaves: number;
}

export interface IWorldDungeons {
  enterDungeon(dungeonId: string): WorldInteractionOutcome;
  leaveDungeon(): WorldInteractionOutcome;
  // Still-locked raids for the local player (unlock countdown in ms), driving the
  // minimap raid-lockout badge + panel. Empty when nothing is locked.
  raidLockouts(): RaidLockout[];
  // The active procedural Rift floor for the local player (null outside a rift).
  riftFloor: RiftFloorView | null;
  // Key into the per-Sim rift collision registry (sim/colliders.ts). The client
  // threads this through findPlayerPath/resolvePlayerDestination (click-to-move)
  // and the swept-landing crest re-resolve behind Blink, Shadowstep, and Heroic
  // Leap (src/sim/combat/heroic_leap.ts), so those routes treat a rift wall as
  // solid instead of open floor. Per world INSTANCE, not per seed; 0 (inert,
  // matching outside-a-rift behavior) where no rift regions are registered, which
  // is always true for the online ClientWorld: collision resolution there is
  // server-authoritative, so it never registers a region of its own.
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
  // The Source Cave roster + the local player's progress, driving the cave HUD.
  // Null when no cave exists.
  sourceCaveInfo(): SourceCaveInfo | null;
  dungeonDifficulty(): DungeonDifficulty;
  setDungeonDifficulty(difficulty: DungeonDifficulty): void;
  // Buy one Heroic Quartermaster offer (src/sim/content/heroic_vendor.ts),
  // paying its Heroic Marks price from the buyer's bags. Server-validated.
  buyHeroicVendorItem(itemId: string): void;
}
