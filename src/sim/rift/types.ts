// Procedural "Rift" dungeons: the seed-driven, infinitely varied instanced
// dungeon system. A rift is generated ENTIRELY from a compact descriptor
// (seed + baseLevel), so the authoritative server and every client regenerate
// byte-identical geometry, mobs, and mechanics from the same pure functions in
// rift_gen.ts. Nothing about a rift is transmitted except that descriptor plus
// the player's current floor + the instance origin.
//
// Sim layer: no DOM/Three imports. This file is types only.

import type { DungeonLayout, InteriorStyle } from '../dungeon_layout';
import type { CombatExitMemory } from '../instance_exit_memory';
import type { LockSession } from '../lockpick';
import type { DelveHazardZone, RiftTier } from '../types';

export type RiftEventStatus = 'open' | 'active' | 'cleared' | 'collapsed';
export type RiftInstanceOutcome = 'active' | 'won' | 'lost' | 'abandoned';
export type RiftUpgradeStatus = 'heuristic' | 'pending' | 'ready' | 'fallback';
export type RiftEncounterPacing = 'breather' | 'pressure' | 'climax';

export interface RiftFloorUpgrade {
  floorIndex: number;
  themeId: string;
  pacing: RiftEncounterPacing;
  monsterIds: string[];
  specialEvent: 'none' | 'ambush' | 'ritual' | 'hazard' | 'treasure';
  environmentalDetails: string[];
}

export interface RiftAssetRequest {
  requestId: string;
  kind: 'boss_model' | 'prop_model' | 'texture';
  prompt: string;
  required: boolean;
}

export interface RiftAssetPipelineState {
  status: 'none' | 'pending' | 'queued' | 'failed';
  jobId: string | null;
  requestIds: string[];
}

/** Bounded, data-only output accepted from an AI/heuristic Dungeon Upgrader.
 * It can select from indexed mechanics and visual kits, but can never inject
 * executable code, arbitrary stats, or untrusted asset URLs into the sim. */
export interface RiftUpgradeManifest {
  schemaVersion: 1;
  title: string;
  synopsis: string;
  lore: string[];
  floors: RiftFloorUpgrade[];
  boss: {
    templateId: string;
    name: string;
    concept: string;
  };
  rewards: {
    lootMultiplier: number;
    craftingMaterialBias: number;
  };
  assetRequests: RiftAssetRequest[];
}

/** The one shared world event behind a natural portal. Every group receives a
 * separate RiftInstance, but all of those instances race against this record. */
export interface RiftEvent {
  eventId: string;
  ordinal: number;
  portalId: number | null;
  status: RiftEventStatus;
  tier: RiftTier;
  zoneId: string;
  zoneName: string;
  riftName: string;
  seed: number;
  baseLevel: number;
  openedAt: number;
  expiresAt: number;
  position: { x: number; z: number };
  contentId: string;
  contentHash: string;
  /** Fairness lock: once any party enters, every competing instance must keep
   * this exact artifact even if a late AI response arrives. */
  contentLocked: boolean;
  upgradeStatus: RiftUpgradeStatus;
  upgrade: RiftUpgradeManifest | null;
  /** Optional external generation job. Generated binaries are not hot-loaded:
   * they must first land in the immutable asset manifest, preserving graphics
   * fairness and preventing untrusted runtime URLs. */
  assetPipeline: RiftAssetPipelineState;
  firstClear: {
    partyKey: string;
    memberIds: number[];
    memberNames: string[];
    duration: number;
    clearedAt: number;
  } | null;
}

/** The whole wire/persistence footprint of a rift instance. Both hosts turn this
 * into identical content via rift_gen. `origin` is the instance-space anchor the
 * floor's local coordinates are offset by (see rift/runs.ts). */
export interface RiftDescriptor {
  seed: number;
  baseLevel: number;
  floorIndex: number;
  origin: { x: number; z: number };
}

/** One placed creature, instance-local. `color`/`scale` are per-run re-grades of
 * the base template so the same creature reads differently across rifts; when
 * omitted the template's own values are used. `level` is already resolved. */
export interface RiftSpawn {
  templateId: string;
  /** Optional safe display override from a validated upgrade artifact. Combat
   * mechanics still come exclusively from templateId. */
  name?: string;
  x: number;
  z: number;
  level: number;
  boss?: boolean;
  /** An authored floor's SECONDARY boss: tracked separately (RiftInstance.minibossId)
   * because the floor's `boss` is the one whose death opens the exit and pays out.
   * Killing the miniboss drives the floor's own gate (see the Blood Orb). */
  miniboss?: boolean;
  color?: number;
  scale?: number;
}

export type RiftObjectKind =
  | 'descent'
  | 'exit'
  | 'rune_pylon'
  | 'chest'
  | 'treasure' // an off-path reward chest tucked against a wall (interact -> loot)
  | 'gate' // a portcullis blocking the nave until its switch is thrown
  | 'switch' // a pressure plate that raises the linked gate (Pokemon-style)
  // Puzzle nodes:
  | 'ice_goal' // ice-slide destination the party must slide onto
  | 'boulder' // a pushable strength boulder
  | 'boulder_pad' // the socket a boulder must be pushed onto
  | 'seq_rune' // a numbered rune in a Simon-style step-in-order sequence
  | 'infernal_orb'; // an authored altar orb: dormant until its miniboss dies, then opens the gate

/** A placed interactable, instance-local. `descent` sinks the party to the next
 * floor; `exit` returns them to the overworld; `chest` is the floor reward; the
 * rest are puzzle nodes (see RiftPuzzleKind). `slot` orders sequence runes. */
export interface RiftObjectPlan {
  kind: RiftObjectKind;
  x: number;
  z: number;
  name: string;
  /** Ordering index for `seq_rune` (its position in the required sequence). */
  slot?: number;
}

/** The floor's gate mechanic, layered ON TOP of the clear-the-room requirement.
 * - `none`: clear-to-open.
 * - `rune_pylons`: light every pylon (walk-on).
 * - `ice_slide`: slide across the ice sheet and stop on the goal tile (FFX/Pokemon).
 * - `boulder_push`: shove every strength boulder onto its socket pad (Pokemon Strength).
 * - `sequence`: step the runes in the shown order (Simon / pattern memory). */
export type RiftPuzzleKind = 'none' | 'rune_pylons' | 'ice_slide' | 'boulder_push' | 'sequence';

export interface RiftPuzzle {
  kind: RiftPuzzleKind;
  /** Pylon interactable count for `rune_pylons` (and the sequence-rune count for
   * `sequence`); 0 otherwise. The `sequence` step order is not stored here: it is
   * derived at spawn by z-sorting the placed runes south-to-north (see runs.ts). */
  pylonCount: number;
}

/** A rolling-boulder hazard lane (Indiana-Jones style): a boulder rolls down a
 * fixed x lane from z0 to z1, wraps back to z0, and knocks back + damages anyone
 * it overtakes (jumping clears it). Instance-local; purely a traversal hazard,
 * it never blocks pathing (it is a moving entity, not a collider). `phase` staggers
 * multiple rollers along the lane; `speed` is in world units per second. */
export interface RiftRoller {
  x: number;
  z0: number;
  z1: number;
  r: number;
  speed: number;
  phase: number;
}

/** A Pokemon-style gate: a portcullis spanning the nave at `z` (a runtime clamp box
 * x +/- hw, z +/- hd, NEVER a static collider, so the spine-clear invariant holds)
 * that blocks passage north until the player steps its pressure plate at
 * (switchX, switchZ), south of the gate. Reached only on floors with no other
 * mechanic, so it is the floor's headline gate. */
export interface RiftGate {
  x: number;
  z: number;
  hw: number;
  hd: number;
  switchX: number;
  switchZ: number;
  /** Authored floors only: the gate has no pressure plate and is opened by touching
   * the floor's `infernal_orb` once its miniboss has fallen. `switchX/switchZ` are
   * unused (no switch object is placed), so the plate trigger never fires. */
  openOnOrb?: boolean;
}

/** A raised rear "sanctum" tier: the floor steps UP toward the dais over a full
 * width staircase band, so the boss/descent stand on an elevated platform. It is a
 * single-valued height field (a function of instance-local z only), applied as a
 * post-movement Y lift to everything standing in the rift; the render builds a
 * matching raised deck + stairs. `rampZ0` is where the stairs begin, `rampZ1` the
 * top (platform floor), `height` the world-unit rise. Collision stays 2D; the
 * stairs are a walkable ramp, so there is no edge to clip through. */
export interface RiftPlatform {
  rampZ0: number;
  rampZ1: number;
  height: number;
}

/** A fully-resolved floor: geometry + visual style + spawn plan + gate. */
export interface RiftFloorPlan {
  seed: number;
  baseLevel: number;
  floorIndex: number;
  floorCount: number;
  isBoss: boolean;
  /** Human-facing floor label, e.g. "Emberforge Reaches: Depth 2". */
  name: string;
  /** Short environment-type label for the HUD, e.g. "Emberforge". */
  themeName: string;
  layout: DungeonLayout;
  style: InteriorStyle;
  /** Player arrival point, instance-local (just inside the entrance porch). */
  entry: { x: number; z: number };
  spawns: RiftSpawn[];
  objects: RiftObjectPlan[];
  puzzle: RiftPuzzle;
  /** Environmental damage zones (lava/blackwater), instance-local. Standing in one
   * ticks unblockable damage; jumping over it is safe. Same shape as delve hazards. */
  hazards: DelveHazardZone[];
  /** For an `ice_slide` floor: the frictionless sheet region (instance-local, an
   * axis box) the player slides across until a wall stops them. */
  iceZone: { x: number; z: number; hw: number; hd: number } | null;
  /** Rolling-boulder hazard lanes (instance-local); empty on boss floors. */
  rollers: RiftRoller[];
  /** A raised rear sanctum tier reached by a full-width staircase, or null for a
   * single-level floor. Boss floors get one whenever the room is long enough (the
   * giga-boss looms on the elevated sanctum); other floors ~30% (never with a
   * rolling boulder, lava, or ice, so one headline mechanic reads at a time). */
  platform: RiftPlatform | null;
  /** A switch-gated portcullis blocking the nave, or null. Only on otherwise-plain
   * floors (no puzzle/hazard/roller/platform), so it is the floor's one mechanic. */
  gate: RiftGate | null;
  /** True for a HAND-AUTHORED set-piece floor (its `layout` carries `rooms`/`doors`/
   * `decor` instead of a generated single-room shell). The procedural playability
   * invariants (one nave, a clear central spine, a dais at the far end) do not apply. */
  authored?: boolean;
}

/** Live per-instance state for an active rift (a Sim field, one per slot in the
 * rift pool). A slot holds ONE floor at a time; descending regenerates it in
 * place. `partyKey` null = the slot is free. */
export interface RiftInstance {
  slot: number;
  /** Monotonic runtime identity. A seed is content, never instance identity. */
  instanceId: number;
  /** Shared natural-world event this group is racing in; null for dev runs. */
  eventId: string | null;
  partyKey: string | null;
  /** Players who actually entered this instance. Party membership may change
   * while a run is live, so runtime ownership cannot be reconstructed later. */
  memberIds: Set<number>;
  startedAt: number;
  finishedAt: number | null;
  outcome: RiftInstanceOutcome;
  /** True once the run is SPOILED: any mob killed, or the off-path cache
   * plundered. A progressed run never recycles and binds its members WoW-raid
   * style (enterRift routes them back and never into a sibling instance).
   * Survives descent (floor teardown must not erase progress); reset only when
   * the slot itself is freed. */
  progressed: boolean;
  /** Snapshot of the event artifact at entry. Never changes mid-race. */
  upgrade: RiftUpgradeManifest | null;
  seed: number;
  baseLevel: number;
  floorIndex: number;
  floorCount: number;
  mobIds: number[];
  objectIds: number[];
  bossId: number | null;
  /** Tick the floor boss was first seen dead (stamped at TICK resolution by
   * updateRiftInstances' pre-pass, so same-window race clears rank by who
   * actually killed first, not by slot order). Null until the kill. */
  bossDiedAtTick: number | null;
  exitId: number | null;
  /** Planned descent-portal position (instance-local), spawned on clear. */
  descentAt: { x: number; z: number } | null;
  descentId: number | null;
  descentOpen: boolean;
  pylonIds: number[];
  litPylons: Set<number>;
  pylonTotal: number;
  /** Extra-puzzle progress (ice/boulder/sequence). `puzzleSolved` gates the descent
   * alongside the room clear, exactly like a full set of lit pylons. */
  puzzleSolved: boolean;
  /** Live pushable boulder entity ids + their target pad positions (instance-local)
   * for `boulder_push`. A boulder counts when it sits within PAD_RADIUS of any pad. */
  boulderIds: number[];
  boulderPads: Array<{ x: number; z: number }>;
  /** `sequence` progress: the ordered rune entity ids and how many are lit so far
   * (a wrong step resets to 0). */
  seqRuneIds: number[];
  seqStep: number;
  /** The always-available "way out" beacon entity id (spawned at the floor entry). */
  beaconId: number | null;
  /** Live rolling-boulder entity ids (one per lane in `floor.rollers`). Each rolls
   * down its lane every tick; overlap knocks the player back and chips their HP. */
  rollerIds: number[];
  /** Switch-gate state: the portcullis + plate entity ids, and whether the gate has
   * been raised (a closed gate clamps players out of `floor.gate`'s box). */
  gateId: number | null;
  switchId: number | null;
  gateOpen: boolean;
  /** Authored set-piece state. `minibossId` is the secondary boss whose death arms
   * the Blood Orb (`orbId`); touching the armed orb raises the gate. `orbActive`
   * mirrors the orb entity's lit template so a re-entering client reads the state. */
  minibossId: number | null;
  orbId: number | null;
  orbActive: boolean;
  /** Overworld position to return the player to when they leave. */
  returnPos: { x: number; z: number };
  emptyFor: number;
  /** Rank of the world-spawned portal this run came through (null for dev
   * portals): drives the Heroic Mark payout and the sealed announcement. */
  tier: RiftTier | null;
  /** Overworld portal entity id the run came through (null for dev portals);
   * the portal is sealed (despawned + announced) when the final boss dies. */
  portalId: number | null;
  /** True once the final boss kill has paid out (gear + seal), so a slot that
   * lingers after the kill never double-pays. */
  rewarded: boolean;
  /** The sealed reward cache the giga-boss drops (`rift_locked_chest`), opened via
   * the shared lockpicking minigame; null until the boss falls. */
  cacheId: number | null;
  /** The in-progress lockpick attempt on this rift's cache (reuses the pure
   * `lockpick` engine + the shared HUD/wire), or null. Rift-hosted, so the delve
   * lockpick controller stays untouched. */
  lockpick: LockSession | null;
  /** Sim time of the last "the runes go dark" sequence-reset notice broadcast to
   * this instance. Instance-level (not per-player) so N party members standing on
   * a wrong rune together still produce only one notice per cooldown window. */
  seqResetAt: number;
  /** Active lethal death zones placed by the floor boss (deathZoneCast /
   * deathZoneStrike mechanics). Each zone starts with a `remaining` fuse equal
   * to the boss's cast time; at zero it detonates (lethal to anyone inside `radius`).
   * Cleared on boss death or floor reset. */
  bossDeathZones: Array<{ x: number; z: number; radius: number; remaining: number; total: number }>;
  /** Recently-exited-mid-combat memory (issue #2653): a player who left this run
   * through the beacon/exit while a mob was actively fighting them has their
   * dropped threat snapshotted here for a short window. Re-entering before it
   * lapses resumes the fight instead of granting a free, unengaged reset
   * (rift/runs.ts). Session state, cleared with the claim. */
  combatExitMemory: CombatExitMemory;
}

/** The rift as a whole (derived from the descriptor's seed + baseLevel), used for
 * naming/announcements and to know how many floors deep it runs. */
export interface RiftPlan {
  seed: number;
  baseLevel: number;
  /** Rift proper noun, e.g. "The Emberforge Abyss". */
  name: string;
  /** Theme id of the final (boss) floor, which names the rift. */
  themeId: string;
  floorCount: number;
}
