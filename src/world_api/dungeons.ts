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

/** One authoritative Buried Hoard boss telegraph on the local player's floor. */
export interface HoardBossCueView {
  instanceId: number;
  cueId: number;
  kind: 'sweep' | 'mark';
  variant?: import('../sim/rift/types').HoardBossCueVariant;
  phase: 'warning' | 'hazard';
  x: number;
  z: number;
  radius: number;
  remaining: number;
  total: number;
  facing?: number;
  halfAngle?: number;
  innerRadius?: number;
  waveGap?: number;
  waveSpan?: number;
  waveLead?: number;
  targetId?: number;
}

/** One boss row of the dungeon run the local player stands in. */
export interface DungeonRunBossView {
  /** The boss's mob template id: the row's stable identity and its name key. */
  mobId: string;
  /** True while this encounter is over in this run. Dead bosses stay dead
   *  until the claim is freed, so in play a finished row stays finished. A
   *  boss of several bodies (the Mere Hydra's three heads) is over only while
   *  ALL of them lie dead: one or two fallen heads leave the row open. */
  defeated: boolean;
}

/**
 * The group dungeon run the local player is physically inside, or null
 * anywhere else (the open world, a delve, a rift, an arena, a raid room, or a
 * dungeon that authors no boss list). The rows are the dungeon's own boss
 * list in route order, decided by the sim (src/sim/instances/dungeon_run.ts),
 * so both hosts and every surface agree on what counts as a boss.
 *
 * Reference-stable: a world hands back the SAME object until the run changes
 * (a boss falls, the difficulty or the dungeon differs, the player leaves),
 * so a consumer may diff by identity.
 */
export interface DungeonRunView {
  dungeonId: string;
  /** The difficulty the CLAIM runs on, which is what the mobs were spawned
   *  at. Not the selector read by dungeonDifficulty(), which a leader can
   *  flip for the next run while standing inside this one. */
  difficulty: DungeonDifficulty;
  bosses: readonly DungeonRunBossView[];
}

export interface IWorldDungeons {
  enterDungeon(dungeonId: string): WorldInteractionOutcome;
  leaveDungeon(): WorldInteractionOutcome;
  // The group dungeon run the local player stands in, with each boss's
  // defeated state, driving the HUD's dungeon objectives tracker. Null outside
  // a tracked dungeon. Online it mirrors the self record's `dgrun` key.
  dungeonRun: DungeonRunView | null;
  // Still-locked raids for the local player (unlock countdown in ms), driving the
  // minimap raid-lockout badge + panel. Empty when nothing is locked.
  raidLockouts(): RaidLockout[];
  // Whether this fixed-position world boss is spawned and alive right now. Reward
  // eligibility remains a separate per-player raid-lockout read.
  worldBossActive(bossId: string): boolean;
  // Answer a dungeon guide's offer for the whole group ("Come with us" when
  // `accept`, "We go alone" otherwise). The sim validates everything (same
  // claim, in reach, offer still open); the guide's state rides his entity
  // (`guideState`), so this is a send with no return.
  answerDungeonGuide(npcId: number, accept: boolean): void;
  // The active procedural Rift floor for the local player (null outside a rift).
  riftFloor: RiftFloorView | null;
  // Key into the per-Sim rift collision registry (sim/colliders.ts). Per world
  // INSTANCE, not per seed; a fixed value allocated once per world (offline
  // Sim or online ClientWorld). Note this member's client-side reach is
  // narrower than the token's overall reach: the swept-landing crest
  // re-resolve behind Blink, Shadowstep, and Vaulting Charge
  // (src/sim/combat/heroic_leap.ts) reads SimContext.riftCollisionToken,
  // which is always the authoritative Sim (offline, or the server's own),
  // never this ClientWorld member; that route was never inert online. This
  // member instead feeds the client's OWN two consumers: click-to-move
  // (findPlayerPath/resolvePlayerDestination in src/main.ts) and the
  // display-only self-motion predictor (src/render/self_motion.ts), both of
  // which treat a rift wall as solid instead of open floor. Movement
  // resolution itself stays server-authoritative online either way; the
  // ONLINE client registers a region under this token purely so those two
  // local, display-only routes can resolve against real rift geometry
  // (src/net/online.ts applyRiftStateEvent mirrors the riftFloor's colliders
  // under it, and endSession clears the region on session end). The token
  // carries no registered region (inert, matching outside-a-rift behavior)
  // outside a rift; 0 itself is reserved for "no token" (a caller like mob
  // pathing that never passes one).
  riftCollisionToken: number;
  // Live lethal death zones on the current rift boss floor (empty outside a rift or
  // before the A-rank mechanic fires). The renderer draws a pulsing red decal ring
  // at each zone position so players can see and react to the telegraph.
  riftBossDeathZones(): RiftBossDeathZoneView[];
  // Live Buried Hoard boss telegraphs on the current floor. This stateful seam
  // keeps actionable warnings correct after reconnects and late interest entry.
  hoardBossCues(): HoardBossCueView[];
  // Milliseconds remaining before the current rift's backing world event stops
  // admitting new parties (see closeNaturalRiftPortal in sim/rift/portals.ts: an
  // already in-progress run plays out past this deadline, only the overworld
  // entrance closes to new entrants). Null outside a rift (riftFloor is null) or
  // for a dev-spawned rift, which has no backing event. Recomputed fresh on every
  // call, like raidLockouts(), so the HUD "closes in" countdown ticks locally
  // without a snapshot round trip.
  riftEventMsRemaining(): number | null;
  dungeonDifficulty(): DungeonDifficulty;
  activeDungeonDifficulty(): DungeonDifficulty | null;
  // The tier the group's existing instances still run on when the selection
  // above has not reached them (a refused or queued change), else null. The
  // portrait menu shows it beside the selection. Online it mirrors `udiff`.
  unappliedDungeonDifficulty(): DungeonDifficulty | null;
  setDungeonDifficulty(difficulty: DungeonDifficulty): void;
  // The viewer's Heroic Marks balance: a currency counter, never a bag stack
  // (src/sim/heroic_marks.ts). Online it mirrors the `hmarks` self key.
  readonly heroicMarks: number;
  // Buy one Heroic Quartermaster offer (src/sim/content/heroic_vendor.ts),
  // paying its Heroic Marks price from the buyer's balance. Server-validated.
  buyHeroicVendorItem(itemId: string): void;
  // Redeem one Crucible Quartermaster set piece (src/sim/content/ignivar_loot.ts),
  // paying its matching-slot sigil from the buyer's bags. Server-validated,
  // class-gated sim-side.
  buyCrucibleVendorItem(itemId: string): void;
}
