// The farm bot's decision brain: a pure state machine over a narrow BotWorld
// interface (the ClientWorld subset the bot actually uses). stepBrain() reads
// the current world snapshot plus the events drained since the last tick and
// issues commands (move input, facing, harvest, casts, loot, vendor sells,
// death handling) directly on BotWorld, returning human-readable log lines
// for state transitions and notable outcomes. It owns no IO and no clock:
// main.ts drives it at 10 Hz with drainEvents() output and its own time.
//
// States: TRAVEL (nearest-node steering via navigator.ts, stuck detection
// included), HARVEST (one gather cast per node, re-issued if the cast never
// starts), FISH_CAST / FISH_WAIT_BITE (facing probe for fishable water, bite
// -> reel inside the window, recast on result/got-away/empty-hook), COMBAT
// (pre-empts everything but DEAD: nearest attacker, auto-attack, round-robin
// over the configured ability slots), LOOT (auto-loot the corpses of recent
// attackers, with a timeout so it never wedges), RECOVER (eat/drink below the
// configured thresholds), DEAD (release, ghost-run to the recorded death
// position, resurrect at corpse, spirit-healer fallback), BAGS_FULL
// (sell-junk at a vendor or log out, per policy).
//
// Farming mode gate (config.mode, phase 2): 'gather' never fishes; 'fish'
// never gathers and chains casts at the fishing.spots rotation (or probes
// from the current position when no spots are configured); 'gather-fish'
// gathers and fishes only when the legacy fishing.enabled flag is true. That
// last rule keeps pre-mode minimal configs (mode defaults to 'gather-fish'
// while enabled defaults to false) behaving exactly as before.
//
// Node picking sorts candidates by (config.nodePriority index, distance) and
// applies the config-level nodeBlacklist/nodeWhitelist id filters, both
// independent of the runtime stuck/denial blacklist.
//
// Death handling (config.death.*): the ghost runs to player.corpsePos (the
// mirrored body position; the recorded last-alive pos is only the fallback
// when corpsePos is null) and resurrects inside CORPSE_REZ_RANGE, with the
// spirit healer as the timeout fallback. Every personal playerDeath event is
// counted (the circuit breaker logs out at death.maxDeaths when non-zero) and
// its position remembered: nodes and fish spots within 25 yd of a death spot
// are avoided for death.avoidDeathSpotMinutes. After any revive, when
// death.waitUntilFull is set and either pool is short, the bot RESTs: eats or
// drinks the configured items when below full, otherwise just stands out of
// combat, until hp >= 95% and (mana classes only) mana >= 95%.
//
// Vendor identification heuristic: snapshot entities of kind 'npc' carry a
// vendorItems array mirrored from their NpcDef (src/net/online.ts applySnapshot),
// so "is a vendor" is e.kind === 'npc' && e.vendorItems.length > 0. Selling is
// target vendor -> interact() (opens the window server-side) -> sellAllJunk(),
// throttled until the bags have room again or a timeout falls back to logout.
//
// Error-event texts matched here are the canonical sim strings
// (src/sim/bags.ts, src/sim/professions/fishing.ts): 'Your bags are full.'
// and 'You need to face fishable water.'. The ErrorReason union does not
// cover these, so text matching is the only signal on the wire.

import { GATHER_NODES } from '../src/sim/content/gather_nodes';
import {
  DUNGEON_X_THRESHOLD,
  DUNGEONS,
  ITEMS,
  instanceOrigin,
  instanceSlotForZ,
  PORTALS,
  ZONES,
  zoneAt,
} from '../src/sim/data';
import { MAIL_MAX_ATTACHMENTS } from '../src/sim/mail/post_office';
import { RESURRECTION_SICKNESS_ID } from '../src/sim/resurrection';
import type { ResolvedAbility } from '../src/sim/sim';
import { CORPSE_REZ_RANGE } from '../src/sim/spirit';
import {
  type DungeonDef,
  type Entity,
  FISHING_CAST_ID,
  FISHING_SESSION_CAP_SEC,
  GATHER_CAST_ID,
  type GatherNodeDef,
  type GatherNodeType,
  INTERACT_RANGE,
  type InvSlot,
  type ItemDef,
  type MoveInput,
  normAngle,
  type SimEvent,
} from '../src/sim/types';
import type { FarmBotConfig } from './config';
import {
  distance,
  distance2,
  type NavPos,
  pickNextNodeCandidates,
  StuckDetector,
  steerToward,
} from './navigator';
import {
  type GoldCast,
  HOLY_LIGHT_ID,
  pickAbility,
  pickGoldCombatAbility,
  pickGoldMaintainBuff,
  pickSelfHeal,
} from './rotation';
import { type EmergencyAction, pickEmergencyAction } from './survival';
import { routeViaGates, WALLED_HUBS } from './village_gates';
import { buildZoneGraph, findZonePath, type ZoneGraph, type ZoneHop } from './zone_graph';

// The ClientWorld subset the brain uses. Promise-returning ClientWorld
// commands are declared void here on purpose: the brain is fire-and-forget
// and learns outcomes from the world snapshot and events, never from
// awaiting a command.
export interface BotWorld {
  readonly player: Entity;
  readonly entities: ReadonlyMap<number, Entity>;
  readonly inventory: readonly InvSlot[];
  readonly bagCapacity: number;
  // Copper mirror (gold-farm accounting).
  readonly copper: number;
  // Mirrored known-ability list (rotationMode 'auto'); slot is the index.
  readonly known: readonly ResolvedAbility[];
  nodeHarvestableByMe(nodeId: string): boolean;
  setMoveInput(input: Partial<MoveInput>, facing?: number): void;
  setMouselookFacing(facing: number): void;
  targetEntity(id: number | null): void;
  startAutoAttack(): void;
  stopAutoAttack(): void;
  castAbilityBySlot(slot: number): void;
  castAbility(id: string): void;
  castAbilityOn(id: string, targetId: number): void;
  useItem(itemId: string): void;
  interact(): void;
  lootCorpse(id: number): void;
  autoLoot(id: number): void;
  harvestNode(nodeId: string): void;
  releaseSpirit(): void;
  resurrectAtCorpse(): void;
  resurrectAtSpiritHealer(): void;
  sellItem(itemId: string, count?: number): void;
  sellAllJunk(): void;
  // Ravenpost send; items are selectors the server re-resolves against the
  // sender's bags, max MAIL_MAX_ATTACHMENTS per letter. Proximity-gated
  // server-side (a mailbox within MAIL_RANGE), answered by a mailResult event.
  mailSend(to: string, subject: string, body: string, copper: number, items: InvSlot[]): void;
  discardItem(itemId: string, count?: number): void;
  enterDungeon(dungeonId: string): void;
  leaveDungeon(): void;
  sendLogout(): void;
}

export type ItemLookup = (itemId: string) => ItemDef | undefined;

// A fishing rod is any usable whose def routes to the fishing activity: the
// plain {type:'fishing'} poles and the tiered rods, which are gatherTool
// items for the fishing profession (src/sim/items.ts useItem).
export function findFishingRod(inventory: readonly InvSlot[], itemDef: ItemLookup): string | null {
  for (const slot of inventory) {
    const use = itemDef(slot.itemId)?.use;
    if (!use) continue;
    if (use.type === 'fishing') return slot.itemId;
    if (use.type === 'gatherTool' && use.professionId === 'fishing') return slot.itemId;
  }
  return null;
}

export function findGatherTool(
  inventory: readonly InvSlot[],
  itemDef: ItemLookup,
  professionId: string,
): string | null {
  for (const slot of inventory) {
    const use = itemDef(slot.itemId)?.use;
    if (use?.type === 'gatherTool' && use.professionId === professionId) return slot.itemId;
  }
  return null;
}

export type BrainMode =
  | 'TRAVEL'
  | 'HARVEST'
  | 'FISH_CAST'
  | 'FISH_WAIT_BITE'
  | 'COMBAT'
  | 'LOOT'
  | 'RECOVER'
  | 'REST'
  | 'PAUSED'
  | 'BREAK'
  | 'FLEE'
  | 'DEAD'
  | 'BAGS_FULL';

export interface BrainDeps {
  // Item def lookup for rod/tool search; defaults to the static ITEMS table.
  itemDef?: ItemLookup;
  // Node table to route over; defaults to GATHER_NODES. Tests inject a
  // handful of synthetic nodes instead of depending on shipped content.
  nodes?: GatherNodeDef[];
  // Local fishable-water probe (main.ts binds firstFishableSampleAhead with
  // the world seed). When present, fish spots are pre-validated with the same
  // 45-degree facing sweep the server probe uses, and dead spots are skipped
  // instead of walked to and probed blind. Undefined means no pre-validation.
  fishableAt?: (x: number, z: number, facing: number) => boolean;
  // Human jitter source (main.ts passes Math.random). Undefined keeps the
  // fully deterministic behavior: no pick spread and no action delays.
  rng?: () => number;
  // Zone hub lookup for FLEE steering (main.ts binds zoneAt(x, z).hub).
  // Undefined means flee runs directly away from the threat, never hub-ward.
  zoneHubAt?: (x: number, z: number) => { x: number; z: number } | null;
  // Position-to-zone lookup and the walkability graph for the multi-zone
  // rotation; both default to the real ZONES/PORTALS content.
  zoneIdAt?: (x: number, z: number) => string;
  zoneGraph?: ZoneGraph;
}

export interface BrainState {
  readonly config: FarmBotConfig;
  readonly nodes: GatherNodeDef[];
  readonly itemDef: ItemLookup;
  readonly fishableAt: ((x: number, z: number, facing: number) => boolean) | undefined;
  readonly zoneHubAt: ((x: number, z: number) => { x: number; z: number } | null) | undefined;
  readonly nodeTypes: Set<GatherNodeType>;
  // Config-level node id filters (whitelist empty = all allowed).
  readonly nodeBlacklistIds: ReadonlySet<string>;
  readonly nodeWhitelistIds: ReadonlySet<string>;
  readonly stuck: StuckDetector;
  mode: BrainMode;
  // True once the bot has logged out (bags-full 'stop' or max runtime);
  // main.ts should wind the loop down.
  done: boolean;
  startedAtMs: number | null;
  // nodeId -> blacklisted until ms (stuck: 120s, gatherDenied: 60s).
  readonly blacklist: Map<string, number>;
  travelNodeId: string | null;
  // HARVEST
  harvestNodeId: string | null;
  harvestIssuedAtMs: number;
  harvestRetries: number;
  sawGatherCast: boolean;
  // fishing
  fishProbeFacing: number;
  // When the current probe facing was pushed to the world (the facing rides
  // the input stream, so the cast must wait a beat behind it).
  fishFacingSetAtMs: number;
  // When the cast itself was sent; 0 while only the facing is armed.
  fishCastAtMs: number;
  fishAccepted: boolean;
  waterProbeCount: number;
  castsAtSpot: number;
  fishUnavailableUntilMs: number;
  // Index into config.fishing.spots for the rotation (wraps around).
  fishSpotIndex: number;
  // COMBAT / LOOT
  readonly recentAttackers: Map<number, string>; // entity id -> name
  readonly killLogged: Set<number>;
  readonly lootedIds: Set<number>;
  lootStartedAtMs: number;
  combatTargetId: number | null;
  castIndex: number;
  lastCastAtMs: number | null;
  // Emergency potion cooldown tracker (negative so the first potion is ready).
  lastPotionAtMs: number;
  // FLEE (combat.flee 'outleveled'): when the run started, for the timeout.
  fleeStartedAtMs: number;
  // Set when a flee timed out and the bot turned to fight: no second flee
  // from the same engagement, or the bot would bounce FLEE/COMBAT forever.
  // Cleared when the fight fully ends (LOOT transition or escape).
  fleeAttempted: boolean;
  // RECOVER
  recoverItemId: string | null;
  recoverThresholdPct: number;
  recoverStartedAtMs: number;
  // REST (post-death recovery): throttle for re-issuing eat/drink items.
  restLastItemAtMs: number | null;
  restStartedAtMs: number;
  // Safety: alert queue drained by main.ts (stdout + optional webhook).
  readonly alerts: { kind: string; text: string; atMs: number }[];
  // Player-density pause timers (safety.playerPause).
  playerNearSinceMs: number | null;
  playerClearSinceMs: number | null;
  // Session rhythm (safety.schedule).
  sessionStartedAtMs: number | null;
  breakUntilMs: number | null;
  // Human jitter (deps.rng): action gate and the rng itself.
  nextActionAtMs: number;
  readonly rng: (() => number) | undefined;
  // Session counters, the phase-8 stats payload seed.
  readonly stats: {
    harvests: number;
    catches: number;
    kills: number;
    deaths: number;
    copperGained: number;
    raresKept: number;
  };
  // Gold-farm mode (config.mode 'gold'): phase machine. Gathering, fishing
  // and node logic are bypassed entirely; TRAVEL delegates to stepGold.
  readonly goldDungeons: DungeonDef[];
  goldPhase: 'door' | 'enter' | 'clear' | 'exit';
  goldIndex: number;
  goldEnteredAtMs: number;
  goldEntryKills: number;
  goldAdvanceZ: number | null;
  goldNoMobSinceMs: number | null;
  goldLastPullAtMs: number;
  goldResetAtMs: Record<string, number>;
  goldWaitLogAtMs: number;
  // Last mirrored purse copper (session earn tracking for any mode).
  lastCopper: number | null;
  // Multi-zone rotation (config.zones non-empty).
  readonly zoneGraph: ZoneGraph;
  readonly zoneIdAt: (x: number, z: number) => string;
  zoneIndex: number;
  zonePath: ZoneHop[] | null;
  fishLapDone: boolean;
  // DEAD / danger memory
  deathCount: number;
  deathSpots: { x: number; z: number; atMs: number }[];
  // DEAD
  lastAlivePos: NavPos | null;
  corpseRunStartedAtMs: number;
  lastReleaseAtMs: number | null;
  lastResurrectAtMs: number | null;
  lastHealerAtMs: number | null;
  // BAGS_FULL
  bagsStartedAtMs: number;
  bagsVendorId: number | null;
  lastSellAtMs: number;
  // Mail offload (bags.mailTo): per-entry stage machine.
  mailState: 'untried' | 'sending' | 'done';
  lastMailAtMs: number;
  mailNoBoxLogged: boolean;
  sellEmptyLogged: boolean;
  // Guided walks (vendor, mailbox, gold door): gate-aware waypoint routing
  // through village walls, with next-gate retry and give-up tracking.
  walkKey: string | null;
  walkGateOffset: number;
  walkWaypoints: { x: number; z: number }[];
  walkGiveUpKey: string | null;
}

export function createBrain(config: FarmBotConfig, deps: BrainDeps = {}): BrainState {
  return {
    config,
    nodes: deps.nodes ?? GATHER_NODES,
    itemDef: deps.itemDef ?? ((id) => ITEMS[id]),
    fishableAt: deps.fishableAt,
    zoneHubAt: deps.zoneHubAt,
    nodeTypes: new Set(config.nodeTypes),
    nodeBlacklistIds: new Set(config.nodeBlacklist),
    nodeWhitelistIds: new Set(config.nodeWhitelist),
    stuck: new StuckDetector(),
    mode: 'TRAVEL',
    done: false,
    startedAtMs: null,
    blacklist: new Map(),
    travelNodeId: null,
    harvestNodeId: null,
    harvestIssuedAtMs: 0,
    harvestRetries: 0,
    sawGatherCast: false,
    fishProbeFacing: 0,
    fishFacingSetAtMs: 0,
    fishCastAtMs: 0,
    fishAccepted: false,
    waterProbeCount: 0,
    castsAtSpot: 0,
    fishUnavailableUntilMs: 0,
    fishSpotIndex: 0,
    recentAttackers: new Map(),
    killLogged: new Set(),
    lootedIds: new Set(),
    lootStartedAtMs: 0,
    combatTargetId: null,
    castIndex: 0,
    lastCastAtMs: null,
    lastPotionAtMs: -120_000,
    fleeStartedAtMs: 0,
    fleeAttempted: false,
    recoverItemId: null,
    recoverThresholdPct: 0,
    recoverStartedAtMs: 0,
    restLastItemAtMs: null,
    restStartedAtMs: 0,
    alerts: [],
    playerNearSinceMs: null,
    playerClearSinceMs: null,
    sessionStartedAtMs: null,
    breakUntilMs: null,
    nextActionAtMs: 0,
    rng: deps.rng,
    stats: { harvests: 0, catches: 0, kills: 0, deaths: 0, copperGained: 0, raresKept: 0 },
    goldDungeons: config.goldFarm.dungeons
      .map((id) => DUNGEONS[id])
      .filter((d): d is DungeonDef => d !== undefined),
    goldPhase: 'door',
    goldIndex: 0,
    goldEnteredAtMs: 0,
    goldEntryKills: 0,
    goldAdvanceZ: null,
    goldNoMobSinceMs: null,
    goldLastPullAtMs: 0,
    goldResetAtMs: {},
    goldWaitLogAtMs: 0,
    lastCopper: null,
    zoneGraph: deps.zoneGraph ?? buildZoneGraph(ZONES, PORTALS),
    zoneIdAt: deps.zoneIdAt ?? ((x, z) => zoneAt(x, z).id),
    zoneIndex: 0,
    zonePath: null,
    fishLapDone: false,
    deathCount: 0,
    deathSpots: [],
    lastAlivePos: null,
    corpseRunStartedAtMs: 0,
    lastReleaseAtMs: null,
    lastResurrectAtMs: null,
    lastHealerAtMs: null,
    bagsStartedAtMs: 0,
    bagsVendorId: null,
    lastSellAtMs: 0,
    mailState: 'untried',
    lastMailAtMs: 0,
    mailNoBoxLogged: false,
    sellEmptyLogged: false,
    walkKey: null,
    walkGateOffset: 0,
    walkWaypoints: [],
    walkGiveUpKey: null,
  };
}

// Timing and range constants. All ms values are compared against the caller's
// clock; nothing here reads the wall clock itself.
const STUCK_BLACKLIST_MS = 120_000;
const DENIED_BLACKLIST_MS = 60_000;
const HARVEST_RETRY_MS = 1_000;
const HARVEST_MAX_RETRIES = 3;
const CAST_ATTEMPT_INTERVAL_MS = 500;
const MELEE_CHASE_RANGE = INTERACT_RANGE - 1;
const LOOT_RANGE = INTERACT_RANGE;
const LOOT_TIMEOUT_MS = 5_000;
const RECOVER_TIMEOUT_MS = 30_000;
const RECOVER_EXIT_BUFFER_PCT = 5;
const FISH_ACCEPT_TIMEOUT_MS = 700;
const FISH_SESSION_TIMEOUT_MS = (FISHING_SESSION_CAP_SEC + 3) * 1000;
// Delay between pushing the probe facing and casting: the facing rides the
// input stream, and a cast issued in the same tick as the facing change is
// probed server-side against the STALE facing (verified live: 8 same-tick
// attempts from a fishable shore all drew "face fishable water"). The input
// stream beats at 20 Hz, so 300 ms lands several facing frames first.
const FISH_ARM_MS = 300;
const FISH_PROBE_STEP = Math.PI / 4; // 45 degrees per rejected cast
const FISH_MAX_PROBES = 8; // one full circle, then give up for a while
const FISH_GIVE_UP_MS = 60_000;
const FISH_SPOT_ARRIVE_RANGE = 2;
const CORPSE_ARRIVE_RANGE = CORPSE_REZ_RANGE; // corpse res works within 35 yd
const CORPSE_RUN_TIMEOUT_MS = 60_000;
const RELEASE_THROTTLE_MS = 2_000;
const RESURRECT_THROTTLE_MS = 2_000;
const HEALER_THROTTLE_MS = 5_000;
// Nodes and fish spots this close to a remembered death spot are avoided
// until the spot expires (death.avoidDeathSpotMinutes).
const DEATH_SPOT_RANGE = 25;
// REST exits at or above this fill on both pools.
const REST_FULL_PCT = 95;
// Re-issue throttle for eat/drink items while resting (the eating/drinking
// mirror is the real gate; this covers the command-to-mirror latency).
const REST_ITEM_THROTTLE_MS = 1_000;
// Hard cap on the post-death rest so a regen stall can never idle forever.
const REST_TIMEOUT_MS = 180_000;
// Say range for the chat watch (whispers have no range).
const SAY_WATCH_RANGE = 20;
// How long the area must be player-free before PAUSED lifts.
const PAUSE_CLEAR_MS = 10_000;
// Human jitter bounds (deps.rng present): the action gate delay before a
// harvest or fishing cast issue.
const ACTION_JITTER_MIN_MS = 500;
const ACTION_JITTER_MAX_MS = 2_000;
// The pick spreads uniformly over this many top candidates when jittered.
const JITTER_PICK_SPREAD = 3;
// FLEE (combat.flee 'outleveled'): run for at most this long, then turn and
// fight rather than die running.
const FLEE_TIMEOUT_MS = 15_000;
// Hub steering kicks in while farther than this from the zone hub.
const FLEE_HUB_RANGE = 10;
// Grind (combat.grind): pull a hostile within GRIND_MOB_RANGE when no ready
// node is within GRIND_NODE_RANGE.
const GRIND_NODE_RANGE = 30;
const GRIND_MOB_RANGE = 25;
// Gold-farm mode constants.
const GOLD_DOOR_RANGE = 6; // enterDungeon needs the door within 8 yd
const GOLD_ENTER_TIMEOUT_MS = 5_000;
const GOLD_PULL_RANGE = 30; // exorcism's reach; never melee-pull first
const GOLD_PULL_CADENCE_MS = 600;
const GOLD_SWEEP_STEP = 15; // nave advance per quiet tick, yd
const GOLD_NAVE_END_Z = 100; // crypt nave local z of the last packs
const GOLD_CLEAR_QUIET_MS = 6_000; // no mob seen this long at the end: cleared
const GOLD_RESET_WAIT_MS = 305_000; // INSTANCE_EMPTY_TIMEOUT (300 s) plus slack
const GOLD_WAIT_LOG_MS = 30_000;
const GOLD_HEAL_GATE_MS = 2_800; // pace Mending Light attempts to its 2.5 s cast
const FLASH_HEAL_GATE_MS = 1_800; // pace Lightmend attempts to its 1.5 s cast
// Out-of-combat self-heal: enter the heal-hold below this hp percent, keep
// casting until this one, then food/wait tops up the rest.
const SELF_HEAL_ENTER_PCT = 50;
const SELF_HEAL_TARGET_PCT = 90;
// Guided walks: arrival range at an intermediate gate waypoint.
const GATE_ARRIVE_RANGE = 3;
const BAGS_FULL_TIMEOUT_MS = 30_000;
const VENDOR_SELL_INTERVAL_MS = 1_000;
// How long a sent letter may go unanswered before the next one goes out (the
// mailResult event is the real gate).
const MAIL_RESULT_TIMEOUT_MS = 2_000;

const BAGS_FULL_TEXT = 'Your bags are full.';
const FACE_WATER_TEXT = 'You need to face fishable water.';

const NEUTRAL_INPUT: Partial<MoveInput> = {
  forward: false,
  back: false,
  turnLeft: false,
  turnRight: false,
  strafeLeft: false,
  strafeRight: false,
  jump: false,
};

function stopMoving(world: BotWorld): void {
  // Explicit false on every bit: ClientWorld.setMoveInput Object.assigns, so
  // an omitted key would leave the old bit latched.
  world.setMoveInput({ ...NEUTRAL_INPUT });
}

function transition(state: BrainState, mode: BrainMode, logs: string[], why = ''): void {
  if (state.mode === mode) return;
  logs.push(`state ${state.mode} -> ${mode}${why ? ` (${why})` : ''}`);
  state.mode = mode;
}

function pos2(e: { pos: { x: number; z: number } }): NavPos {
  return { x: e.pos.x, z: e.pos.z };
}

function hpPct(p: Entity): number {
  return p.maxHp > 0 ? (p.hp / p.maxHp) * 100 : 100;
}

function resourcePct(p: Entity): number {
  return p.maxResource > 0 ? (p.resource / p.maxResource) * 100 : 100;
}

function isBlacklisted(state: BrainState, nodeId: string, nowMs: number): boolean {
  const until = state.blacklist.get(nodeId);
  if (until === undefined) return false;
  if (nowMs >= until) {
    state.blacklist.delete(nodeId);
    return false;
  }
  return true;
}

function blacklistNode(state: BrainState, nodeId: string, durationMs: number, nowMs: number): void {
  state.blacklist.set(nodeId, nowMs + durationMs);
}

// Danger memory: death spots younger than death.avoidDeathSpotMinutes,
// expiring old entries in place so the list stays bounded.
function activeDeathSpots(state: BrainState, nowMs: number): readonly { x: number; z: number }[] {
  const windowMs = state.config.death.avoidDeathSpotMinutes * 60_000;
  const active = state.deathSpots.filter((s) => nowMs - s.atMs < windowMs);
  if (active.length !== state.deathSpots.length) state.deathSpots = active;
  return active;
}

function nearDeathSpot(spots: readonly { x: number; z: number }[], pos: NavPos): boolean {
  return spots.some((s) => distance2(s, pos) <= DEATH_SPOT_RANGE * DEATH_SPOT_RANGE);
}

// True when either pool is short of the REST exit bar; mana only counts for
// mana classes (rage and energy rest at or near zero by design).
function needsRest(p: Entity): boolean {
  if (hpPct(p) < REST_FULL_PCT) return true;
  return p.resourceType === 'mana' && resourcePct(p) < REST_FULL_PCT;
}

function alert(state: BrainState, kind: string, text: string, nowMs: number): void {
  state.alerts.push({ kind, text, atMs: nowMs });
}

// Any living player other than us within radiusYd (the playerPause watch).
function anyPlayerWithin(world: BotWorld, radiusYd: number): boolean {
  const me = world.player;
  for (const e of world.entities.values()) {
    if (e.id === me.id || e.kind !== 'player' || e.dead) continue;
    if (distance2(pos2(me), pos2(e)) <= radiusYd * radiusYd) return true;
  }
  return false;
}

// The jitter gate (deps.rng present only): the first call for an action arms
// the delay, later calls report whether it has elapsed. Deterministic pass
// when no rng is injected.
function actionGateOpen(state: BrainState, nowMs: number): boolean {
  if (!state.rng) return true;
  if (state.nextActionAtMs === 0) {
    state.nextActionAtMs =
      nowMs + ACTION_JITTER_MIN_MS + state.rng() * (ACTION_JITTER_MAX_MS - ACTION_JITTER_MIN_MS);
    return false;
  }
  if (nowMs < state.nextActionAtMs) return false;
  state.nextActionAtMs = 0;
  return true;
}

// The per-tick distillation of the drained SimEvents the brain reacts to.
interface TickEvents {
  bite: boolean;
  catchItemId: string | null;
  fishMissed: 'fishingGotAway' | 'fishingEmptyHook' | null;
  castCancelled: boolean;
  gatherDeniedNode: boolean;
  bagsFull: boolean;
  faceWater: boolean;
  // Personal death (playerDeath fires for every player; only ours counts).
  died: boolean;
  // Mail answer: 'sent' is the only success code; 'collected' is not about
  // sending and stays null, every refusal arm maps to 'failed'.
  mailResult: 'sent' | 'failed' | null;
  // Chat lines the safety watch may care about (whispers to us, nearby says).
  chats: { from: string; text: string; channel?: string; entityId?: number; to?: string }[];
}

function readEvents(world: BotWorld, events: readonly SimEvent[]): TickEvents {
  const t: TickEvents = {
    bite: false,
    catchItemId: null,
    fishMissed: null,
    castCancelled: false,
    gatherDeniedNode: false,
    bagsFull: false,
    faceWater: false,
    died: false,
    mailResult: null,
    chats: [],
  };
  for (const ev of events) {
    switch (ev.type) {
      case 'fishingBite':
        t.bite = true;
        break;
      case 'fishingResult':
        t.catchItemId = ev.itemId;
        break;
      case 'fishingGotAway':
      case 'fishingEmptyHook':
        t.fishMissed = ev.type;
        break;
      case 'castStop':
        if (ev.entityId === world.player.id && !ev.success) t.castCancelled = true;
        break;
      case 'playerDeath':
        if (ev.pid === world.player.id) t.died = true;
        break;
      case 'mailResult':
        if (ev.code === 'sent') t.mailResult = 'sent';
        else if (ev.code !== 'collected') t.mailResult = 'failed';
        break;
      case 'chat':
        // A whisper echo of our own outgoing line carries `to` (the bot never
        // whispers, but the filter is cheap); only incoming lines are watched.
        if ((ev.channel === 'whisper' && !ev.to) || ev.channel === 'say') {
          t.chats.push({
            from: ev.from,
            text: ev.text,
            channel: ev.channel,
            entityId: ev.entityId,
            to: ev.to,
          });
        }
        break;
      case 'gatherDenied':
        if (ev.surface === 'node') t.gatherDeniedNode = true;
        break;
      case 'error':
        if (ev.text === BAGS_FULL_TEXT) t.bagsFull = true;
        else if (ev.text === FACE_WATER_TEXT) t.faceWater = true;
        break;
      default:
        break;
    }
  }
  return t;
}

function findAttackers(world: BotWorld): Entity[] {
  const me = world.player.id;
  const out: Entity[] = [];
  for (const e of world.entities.values()) {
    if (e.id === me || e.dead) continue;
    if (e.aggroTargetId === me) out.push(e);
  }
  return out;
}

// Fire a gold-kit cast (self buff, no-target aura/AoE, or current enemy).
function issueGoldCast(world: BotWorld, cast: GoldCast): void {
  if (cast.target === 'self') world.castAbilityOn(cast.id, world.player.id);
  else if (cast.target === 'enemy') world.castAbility(cast.id);
  else world.castAbility(cast.id);
}

// Refresh Oath of Iron / aura when free. Returns true when a cast was issued
// so the caller can skip the rest of the tick's decision work.
function tryGoldMaintainBuff(world: BotWorld, nowMs: number, lastCastAtMs: number | null): boolean {
  if (lastCastAtMs !== null && nowMs - lastCastAtMs < CAST_ATTEMPT_INTERVAL_MS) return false;
  const pick = pickGoldMaintainBuff(world.known, world.player);
  if (!pick) return false;
  issueGoldCast(world, pick);
  return true;
}

function nearestVendor(world: BotWorld): Entity | null {
  let best: Entity | null = null;
  let bestD2 = Number.POSITIVE_INFINITY;
  for (const e of world.entities.values()) {
    if (e.kind !== 'npc' || e.dead || e.vendorItems.length === 0) continue;
    const dx = e.pos.x - world.player.pos.x;
    const dz = e.pos.z - world.player.pos.z;
    const d2 = dx * dx + dz * dz;
    if (d2 < bestD2) {
      bestD2 = d2;
      best = e;
    }
  }
  return best;
}

// Mailbox objects are kind 'object' entities with templateId 'mailbox'
// (sim.ts world init); the server gates sends on MAIL_RANGE proximity only.
function nearestMailbox(world: BotWorld): Entity | null {
  let best: Entity | null = null;
  let bestD2 = Number.POSITIVE_INFINITY;
  for (const e of world.entities.values()) {
    if (e.kind !== 'object' || e.templateId !== 'mailbox' || e.dead) continue;
    const d2 = distance2(pos2(world.player), pos2(e));
    if (d2 < bestD2) {
      bestD2 = d2;
      best = e;
    }
  }
  return best;
}

// The mats a mail offload sends: every bag slot that is not the fishing rod,
// not a gather tool, not the configured food/drink, and not grey junk; a
// bags.mailItems list narrows that to the listed ids (the exclusions still
// win, so a tool can never be mailed off by accident).
export function selectMailSlots(
  inventory: readonly InvSlot[],
  itemDef: ItemLookup,
  config: FarmBotConfig,
): InvSlot[] {
  const keep = new Set(
    [config.combat.eatItemId, config.combat.drinkItemId].filter((id): id is string => !!id),
  );
  const restrict = config.bags.mailItems === 'all' ? null : new Set(config.bags.mailItems);
  const out: InvSlot[] = [];
  for (const slot of inventory) {
    if (keep.has(slot.itemId)) continue;
    const def = itemDef(slot.itemId);
    if (def?.use && (def.use.type === 'fishing' || def.use.type === 'gatherTool')) continue;
    if (def?.quality === 'poor') continue;
    if (restrict && !restrict.has(slot.itemId)) continue;
    out.push({ itemId: slot.itemId, count: slot.count });
  }
  return out;
}

interface RecoverNeed {
  itemId: string;
  thresholdPct: number;
}

function recoverNeed(state: BrainState, world: BotWorld): RecoverNeed | null {
  const { combat } = state.config;
  if (
    combat.eatItemId &&
    combat.eatBelowHpPct !== undefined &&
    hpPct(world.player) < combat.eatBelowHpPct
  ) {
    return { itemId: combat.eatItemId, thresholdPct: combat.eatBelowHpPct };
  }
  // The drink threshold only makes sense for mana users: rage and energy sit
  // at or near zero out of combat by design, which would wedge the bot in
  // RECOVER forever.
  if (
    combat.drinkItemId &&
    combat.drinkBelowManaPct !== undefined &&
    world.player.resourceType === 'mana' &&
    resourcePct(world.player) < combat.drinkBelowManaPct
  ) {
    return { itemId: combat.drinkItemId, thresholdPct: combat.drinkBelowManaPct };
  }
  return null;
}

function recoverPct(state: BrainState, world: BotWorld): number {
  // The item id that triggered RECOVER decides which bar we watch: if it was
  // the drink item, watch the resource bar, otherwise hp.
  return state.recoverItemId === state.config.combat.drinkItemId
    ? resourcePct(world.player)
    : hpPct(world.player);
}

// The mode gate (see the header): 'gather' never fishes, 'fish' always does,
// 'gather-fish' defers to the legacy fishing.enabled flag.
function fishingEnabled(state: BrainState): boolean {
  if (state.config.mode === 'gather' || state.config.mode === 'gold') return false;
  if (state.config.mode === 'fish') return true;
  return state.config.fishing.enabled;
}

// Local pre-validation of a rotation spot: the same 45-degree facing sweep the
// server probe applies, answered by the injected fishableAt (world-seeded
// offline water math). Only called when the dep is present.
function spotLooksFishable(state: BrainState, spot: { x: number; z: number }): boolean {
  const probe = state.fishableAt;
  if (!probe) return true;
  for (let i = 0; i < FISH_MAX_PROBES; i++) {
    if (probe(spot.x, spot.z, normAngle(i * FISH_PROBE_STEP))) return true;
  }
  return false;
}

function countCastAtSpot(state: BrainState, logs: string[]): void {
  state.castsAtSpot += 1;
  const cap = state.config.fishing.castsPerSpot;
  if (cap !== undefined && state.castsAtSpot >= cap) {
    state.castsAtSpot = 0;
    const spots = state.config.fishing.spots;
    if (spots.length > 1) {
      state.fishSpotIndex = (state.fishSpotIndex + 1) % spots.length;
      if (state.fishSpotIndex === 0) state.fishLapDone = true; // full rotation circle
      transition(state, 'TRAVEL', logs, `casts per spot reached, next spot ${state.fishSpotIndex}`);
    } else {
      state.fishLapDone = true; // a lone spot's castsPerSpot is its whole lap
      transition(state, 'TRAVEL', logs, 'casts per spot reached');
    }
  } else {
    state.mode = 'FISH_CAST';
  }
}

// The zone the route currently works: the rotation entry when config.zones
// is non-empty, else the legacy single zoneId.
function currentZoneId(state: BrainState): string {
  return state.config.zones.length > 0
    ? state.config.zones[state.zoneIndex % state.config.zones.length]
    : state.config.zoneId;
}

// Zone rotation advance: pick the next rotation zone after `skipZoneId` (the
// zone just finished or abandoned) and arm the waypoint path to it. Zones
// with no walkable path are skipped with a log; if none are reachable the
// bot stays put and the caller falls through to fishing/idle.
function advanceZone(state: BrainState, world: BotWorld, logs: string[], skipZoneId: string): void {
  const zones = state.config.zones;
  // Point the index at the zone being left, then step past it.
  const skipIdx = zones.indexOf(skipZoneId);
  if (skipIdx >= 0) state.zoneIndex = skipIdx;
  const from = state.zoneIdAt(world.player.pos.x, world.player.pos.z);
  for (let step = 0; step < zones.length - 1; step++) {
    state.zoneIndex = (state.zoneIndex + 1) % zones.length;
    const target = zones[state.zoneIndex];
    if (target === from) {
      state.fishLapDone = false;
      return; // already inside the next zone: nothing to walk
    }
    const path = findZonePath(state.zoneGraph, from, target);
    if (path && path.length > 0) {
      state.zonePath = path;
      state.fishLapDone = false;
      state.stuck.reset();
      logs.push(`zone rotation: heading to ${target}`);
      return;
    }
    logs.push(`zone rotation: no walkable path to ${target}, skipping`);
  }
}

// --- gold-farm mode (mode 'gold') ------------------------------------------
// The dungeon rotation: walk the overworld (phase-7 zone waypoints when the
// door is in another zone) to the current dungeon's door, enter, sweep the
// nave pulling one mob at a time with the configured pull ability, loot
// copper/rare corpses and discard the rest, exit at the far end, rotate. The
// normal pre-empts (combat, death, bags, safety) all still apply: combat
// kills what was pulled, and the loot pass is goldLoot below, not stepLoot.

function goldBeginClear(state: BrainState, logs: string[]): void {
  state.goldPhase = 'clear';
  state.goldAdvanceZ = null;
  state.goldNoMobSinceMs = null;
  state.goldEntryKills = state.stats.kills;
  logs.push('gold: inside, sweeping the nave');
}

function nearestLivingHostile(world: BotWorld): Entity | null {
  let best: Entity | null = null;
  let bestD2 = Number.POSITIVE_INFINITY;
  for (const e of world.entities.values()) {
    if (e.kind !== 'mob' || e.dead || !e.hostile) continue;
    const d2 = distance2(pos2(world.player), pos2(e));
    if (d2 < bestD2) {
      bestD2 = d2;
      best = e;
    }
  }
  return best;
}

// The loot rule: take a corpse when it holds copper or a keep-quality item,
// then sweep the bags discarding everything that is neither keep-quality nor
// a tool/rod/configured food nor a bag. Returns true when it looted (the pull
// waits a tick so the corpse mirror can settle).
function goldLoot(state: BrainState, world: BotWorld, logs: string[]): boolean {
  const keep = new Set<string>(state.config.goldFarm.keepQualities);
  let looted = false;
  for (const e of world.entities.values()) {
    if (!e.lootable || !e.loot || state.lootedIds.has(e.id)) continue;
    if (distance2(pos2(world.player), pos2(e)) > LOOT_RANGE * LOOT_RANGE) continue;
    state.lootedIds.add(e.id);
    const keptItems = e.loot.items.filter((i) => keep.has(state.itemDef(i.itemId)?.quality ?? ''));
    if (e.loot.copper <= 0 && keptItems.length === 0) continue; // nothing we want: leave it
    world.lootCorpse(e.id);
    state.stats.raresKept += keptItems.length;
    const names = keptItems.map((i) => state.itemDef(i.itemId)?.name ?? i.itemId);
    logs.push(
      `gold: looted ${e.loot.copper}c${names.length > 0 ? ` + ${names.join(', ')}` : ''} from ${e.name}`,
    );
    looted = true;
  }
  if (!looted) return false;
  const keepIds = new Set(
    [state.config.combat.eatItemId, state.config.combat.drinkItemId].filter(
      (id): id is string => !!id,
    ),
  );
  for (const slot of world.inventory) {
    const def = state.itemDef(slot.itemId);
    if (!def) continue;
    if (keep.has(def.quality ?? '')) continue;
    // Consumables are never discarded, whatever their quality: the rest
    // logic auto-picks the best food/drink in the bags (see stepRest), so
    // common water and potions are supplies, not junk.
    if (
      def.kind === 'bag' ||
      def.kind === 'food' ||
      def.kind === 'drink' ||
      def.kind === 'potion'
    ) {
      continue;
    }
    if (def.use && (def.use.type === 'fishing' || def.use.type === 'gatherTool')) continue;
    if (keepIds.has(slot.itemId)) continue;
    world.discardItem(slot.itemId, slot.count);
    logs.push(`gold: discarded ${slot.count}x ${def.name}`);
  }
  return true;
}

function stepGold(state: BrainState, world: BotWorld, nowMs: number, logs: string[]): void {
  const p = world.player;
  const defs = state.goldDungeons;
  if (defs.length === 0) {
    stopMoving(world);
    if (state.goldWaitLogAtMs === 0) {
      state.goldWaitLogAtMs = nowMs;
      logs.push('gold: no known dungeons configured');
    }
    return;
  }
  const def = defs[state.goldIndex % defs.length];
  const inside = p.pos.x > DUNGEON_X_THRESHOLD;

  if (state.goldPhase === 'door') {
    if (inside) {
      goldBeginClear(state, logs); // rejoined a live claim (e.g. after a death)
      return;
    }
    const resetAt = state.goldResetAtMs[def.id] ?? 0;
    if (nowMs < resetAt) {
      stopMoving(world);
      if (state.goldWaitLogAtMs === 0 || nowMs - state.goldWaitLogAtMs >= GOLD_WAIT_LOG_MS) {
        state.goldWaitLogAtMs = nowMs;
        logs.push(`gold: waiting for ${def.name} to reset`);
      }
      return;
    }
    const doorZone = state.zoneIdAt(def.doorPos.x, def.doorPos.z);
    const hereZone = state.zoneIdAt(p.pos.x, p.pos.z);
    if (doorZone !== hereZone && state.zonePath === null) {
      const path = findZonePath(state.zoneGraph, hereZone, doorZone);
      if (path && path.length > 0) {
        state.zonePath = path;
        state.stuck.reset();
        logs.push(`gold: heading to ${def.name} (${doorZone})`);
        return;
      }
      if (path === null) logs.push(`gold: no walkable path to ${doorZone}`);
    }
    const status = stepGuidedWalk(
      state,
      world,
      nowMs,
      logs,
      `door:${def.id}`,
      def.doorPos,
      def.name,
    );
    if (status === 'gave-up') {
      state.walkGiveUpKey = null;
      state.goldIndex = (state.goldIndex + 1) % defs.length;
      logs.push(`gold: cannot reach ${def.name}, skipping to the next dungeon`);
      return;
    }
    if (distance(pos2(p), def.doorPos) <= GOLD_DOOR_RANGE) {
      stopMoving(world);
      world.enterDungeon(def.id);
      state.goldEnteredAtMs = nowMs;
      state.goldPhase = 'enter';
      logs.push(`gold: entering ${def.name}`);
    }
    return;
  }

  if (state.goldPhase === 'enter') {
    if (inside) {
      goldBeginClear(state, logs);
      return;
    }
    if (nowMs - state.goldEnteredAtMs >= GOLD_ENTER_TIMEOUT_MS) {
      state.goldPhase = 'door'; // entry did not take: re-approach
    }
    return;
  }

  if (state.goldPhase === 'clear') {
    if (!inside) {
      state.goldPhase = 'door';
      return;
    }
    // Recharge gate before any pull; the REST state does the waiting (and
    // the paladin self-heal hook lives in stepRest).
    const pct = state.config.goldFarm.restBelowPct;
    if (hpPct(p) < pct || (p.resourceType === 'mana' && resourcePct(p) < pct)) {
      state.restLastItemAtMs = null;
      state.restStartedAtMs = nowMs;
      transition(state, 'REST', logs, 'gold: recharging');
      return;
    }
    if (goldLoot(state, world, logs)) return;
    // Keep Oath of Iron / aura up between pulls (30 min timers, free GCD when
    // nothing is attacking). Combat path re-checks too when they drop mid-pack.
    if (!p.inCombat && tryGoldMaintainBuff(world, nowMs, state.lastCastAtMs)) {
      state.lastCastAtMs = nowMs;
      return;
    }
    const mob = nearestLivingHostile(world);
    if (mob) {
      state.goldNoMobSinceMs = null;
      if (distance(pos2(p), pos2(mob)) > GOLD_PULL_RANGE) {
        const steer = steerToward(pos2(p), p.facing, pos2(mob), GOLD_PULL_RANGE - 2);
        world.setMoveInput(steer.input, steer.facing);
        return;
      }
      stopMoving(world);
      const pullOnCooldown = (p.cooldowns.get(state.config.goldFarm.pullAbility) ?? 0) > 0;
      if (!pullOnCooldown && nowMs - state.goldLastPullAtMs >= GOLD_PULL_CADENCE_MS) {
        world.targetEntity(mob.id);
        world.castAbility(state.config.goldFarm.pullAbility);
        // Deliberately do NOT preset combatTargetId: when the combat
        // pre-empt fires, its retarget branch must run startAutoAttack, or
        // the bot tanks the pull without ever swinging (the v1 live bug).
        state.goldLastPullAtMs = nowMs;
        logs.push(`gold: pulling ${mob.name}`);
      }
      return;
    }
    // No mob visible: advance down the nave in steps; quiet at the far end
    // means the claim is cleared.
    const origin = instanceOrigin(def.index, instanceSlotForZ(p.pos.z));
    if (state.goldAdvanceZ === null) state.goldAdvanceZ = p.pos.z - origin.z;
    if (state.goldNoMobSinceMs === null) state.goldNoMobSinceMs = nowMs;
    if (state.goldAdvanceZ >= GOLD_NAVE_END_Z) {
      if (nowMs - state.goldNoMobSinceMs >= GOLD_CLEAR_QUIET_MS) {
        state.goldPhase = 'exit';
        logs.push(`gold: ${def.name} cleared`);
      }
      stopMoving(world);
      return;
    }
    state.goldAdvanceZ = Math.min(state.goldAdvanceZ + GOLD_SWEEP_STEP, GOLD_NAVE_END_Z);
    const target = { x: origin.x + def.entry.x, z: origin.z + state.goldAdvanceZ };
    const steer = steerToward(pos2(p), p.facing, target, 2);
    world.setMoveInput(steer.input, steer.facing);
    return;
  }

  // exit
  if (!inside) {
    // A visit with kills starts this dungeon's reset clock; a quick-exit
    // (re-entered an unreset claim) leaves it untouched.
    if (state.stats.kills > state.goldEntryKills) {
      state.goldResetAtMs[def.id] = nowMs + GOLD_RESET_WAIT_MS;
    }
    state.goldIndex = (state.goldIndex + 1) % defs.length;
    state.goldPhase = 'door';
    logs.push(`gold: rotating to ${defs[state.goldIndex % defs.length].name}`);
    return;
  }
  const origin = instanceOrigin(def.index, instanceSlotForZ(p.pos.z));
  let exitPos = {
    x: origin.x + def.entry.x + def.exitOffset.x,
    z: origin.z + def.entry.z + def.exitOffset.z,
  };
  for (const e of world.entities.values()) {
    if (e.kind === 'object' && e.templateId === 'dungeon_exit') {
      exitPos = pos2(e);
      break;
    }
  }
  const steer = steerToward(pos2(p), p.facing, exitPos, GOLD_DOOR_RANGE);
  world.setMoveInput(steer.input, steer.facing);
  if (steer.arrived) {
    stopMoving(world);
    world.leaveDungeon();
  }
}

function stepTravel(state: BrainState, world: BotWorld, nowMs: number, logs: string[]): void {
  const p = world.player;

  const need = recoverNeed(state, world);
  if (need) {
    stopMoving(world);
    world.useItem(need.itemId);
    state.recoverItemId = need.itemId;
    state.recoverThresholdPct = need.thresholdPct;
    state.recoverStartedAtMs = nowMs;
    transition(state, 'RECOVER', logs, `using ${need.itemId}`);
    return;
  }

  // Multi-zone travel in progress: walk the waypoint chain. Stuck escalation
  // here does not blacklist a node; it abandons the leg for the next zone.
  if (state.zonePath !== null) {
    if (state.zonePath.length === 0) {
      state.zonePath = null; // already inside the target zone
    } else {
      const hop = state.zonePath[0];
      const stuckRes = state.stuck.update(pos2(p), nowMs);
      if (stuckRes.escalation === 'blacklist') {
        state.stuck.reset();
        state.zonePath = null;
        logs.push(`stuck en route to ${hop.zoneId}, skipping the leg`);
        advanceZone(state, world, logs, hop.zoneId);
        return;
      }
      if (stuckRes.escalation === 'wiggle') logs.push('stuck: wiggling');
      const steer = steerToward(pos2(p), p.facing, hop.waypoint, 2);
      world.setMoveInput({ ...steer.input, ...stuckRes.input }, steer.facing);
      if (state.zoneIdAt(p.pos.x, p.pos.z) === hop.zoneId) {
        state.zonePath.shift();
        if (state.zonePath.length === 0) state.zonePath = null;
        state.stuck.reset();
        logs.push(`entered ${hop.zoneId}`);
      }
      return;
    }
  }

  // Gold mode bypasses gathering/fishing entirely: TRAVEL is the dungeon
  // rotation driver. Zone-travel legs (armed by the door phase) run above.
  if (state.config.mode === 'gold') {
    stepGold(state, world, nowMs, logs);
    return;
  }

  const danger = activeDeathSpots(state, nowMs);
  const nodeCandidates =
    danger.length > 0 ? state.nodes.filter((n) => !nearDeathSpot(danger, n.pos)) : state.nodes;

  // 'fish' mode skips node picking entirely. With jitter (deps.rng), the pick
  // spreads uniformly over the top candidates instead of always the best.
  let node: GatherNodeDef | null = null;
  if (state.config.mode !== 'fish') {
    const candidates = pickNextNodeCandidates(
      nodeCandidates,
      pos2(p),
      {
        types: state.nodeTypes,
        maxTier: state.config.maxNodeTier,
        zoneId: currentZoneId(state),
        priority: state.config.nodePriority,
        blacklistIds: state.nodeBlacklistIds,
        whitelistIds: state.nodeWhitelistIds,
      },
      (id) => world.nodeHarvestableByMe(id),
      (id) => isBlacklisted(state, id, nowMs),
    );
    if (candidates.length > 0) {
      if (state.rng && candidates.length > 1) {
        // Jitter pick, but sticky: re-roll only when the current target fell
        // out of the candidate set, or the bot would re-roll every tick and
        // wander between the top candidates without ever arriving.
        const current = candidates.findIndex((c) => c.id === state.travelNodeId);
        node =
          current >= 0
            ? candidates[current]
            : candidates[Math.floor(state.rng() * Math.min(JITTER_PICK_SPREAD, candidates.length))];
      } else {
        node = candidates[0];
      }
    }
  }

  // Grind: no ready node within reach and a hostile in pulling range, so
  // spend the respawn wait on XP. The normal COMBAT flow takes it from here.
  if (state.config.combat.grind) {
    const nodeFar = !node || distance2(pos2(p), node.pos) > GRIND_NODE_RANGE * GRIND_NODE_RANGE;
    if (nodeFar) {
      let mob: Entity | null = null;
      let mobD2 = GRIND_MOB_RANGE * GRIND_MOB_RANGE;
      for (const e of world.entities.values()) {
        if (e.kind !== 'mob' || e.dead || !e.hostile) continue;
        const d2 = distance2(pos2(p), pos2(e));
        if (d2 <= mobD2) {
          mobD2 = d2;
          mob = e;
        }
      }
      if (mob) {
        stopMoving(world);
        world.targetEntity(mob.id);
        world.startAutoAttack();
        state.combatTargetId = mob.id;
        state.castIndex = 0;
        transition(state, 'COMBAT', logs, `grind: pulling ${mob.name}`);
        return;
      }
    }
  }

  if (node) {
    if (state.travelNodeId !== node.id) {
      state.travelNodeId = node.id;
      state.stuck.reset();
    }
    const steer = steerToward(pos2(p), p.facing, node.pos);
    const stuckRes = state.stuck.update(pos2(p), nowMs);
    if (stuckRes.escalation === 'blacklist') {
      blacklistNode(state, node.id, STUCK_BLACKLIST_MS, nowMs);
      state.stuck.reset();
      state.travelNodeId = null;
      stopMoving(world);
      logs.push(`stuck: blacklisting ${node.id}`);
      return;
    }
    if (stuckRes.escalation === 'wiggle') logs.push('stuck: wiggling');
    world.setMoveInput({ ...steer.input, ...stuckRes.input }, steer.facing);
    if (steer.arrived) {
      if (!actionGateOpen(state, nowMs)) return; // human jitter: brief pause first
      world.harvestNode(node.id);
      state.harvestNodeId = node.id;
      state.harvestIssuedAtMs = nowMs;
      state.harvestRetries = 0;
      state.sawGatherCast = false;
      state.stuck.reset();
      transition(state, 'HARVEST', logs, `node ${node.id}`);
    }
    return;
  }

  state.travelNodeId = null;
  state.stuck.reset();

  // Zone rotation trigger: this zone's nodes are all dry, and fishing is
  // either off the table or the spot rotation finished a full lap.
  if (state.config.zones.length > 1) {
    const fishingOpen =
      fishingEnabled(state) &&
      findFishingRod(world.inventory, state.itemDef) !== null &&
      !state.fishLapDone &&
      nowMs >= state.fishUnavailableUntilMs;
    if (!fishingOpen) {
      advanceZone(state, world, logs, currentZoneId(state));
      if (state.zonePath !== null) return;
    }
  }

  // No node to work (or fish mode): fish when the mode gate allows and the
  // give-up window has passed.
  if (fishingEnabled(state) && nowMs >= state.fishUnavailableUntilMs) {
    const rod = findFishingRod(world.inventory, state.itemDef);
    if (rod) {
      const spots = state.config.fishing.spots;
      if (spots.length > 0) {
        // Skip spots that are near a remembered death spot, and pre-validate
        // water locally when a probe is injected: skip dead spots instead of
        // walking there and probing blind.
        let idx = state.fishSpotIndex % spots.length;
        if (state.fishableAt || danger.length > 0) {
          let checked = 0;
          while (checked < spots.length) {
            const skipReason = nearDeathSpot(danger, spots[idx])
              ? 'near a death spot'
              : spotLooksFishable(state, spots[idx])
                ? null
                : 'not fishable locally';
            if (skipReason === null) break;
            logs.push(`fishing: spot ${idx} ${skipReason}, skipping`);
            idx = (idx + 1) % spots.length;
            checked += 1;
          }
          if (checked === spots.length) {
            state.fishSpotIndex = idx;
            state.fishUnavailableUntilMs = nowMs + FISH_GIVE_UP_MS;
            logs.push('fishing: no usable spot in the rotation, pausing');
            stopMoving(world);
            return;
          }
          state.fishSpotIndex = idx;
        }
        const steer = steerToward(pos2(p), p.facing, spots[idx], FISH_SPOT_ARRIVE_RANGE);
        if (!steer.arrived) {
          world.setMoveInput(steer.input, steer.facing);
          return;
        }
        stopMoving(world);
        transition(state, 'FISH_CAST', logs, `at fish spot ${idx}`);
      } else {
        stopMoving(world);
        transition(
          state,
          'FISH_CAST',
          logs,
          state.config.mode === 'fish' ? 'fish mode' : 'no nodes ready',
        );
      }
      return;
    }
  }

  stopMoving(world); // nothing to do: idle until a node respawns
}

function stepHarvest(
  state: BrainState,
  world: BotWorld,
  tick: TickEvents,
  nowMs: number,
  logs: string[],
): void {
  const p = world.player;
  stopMoving(world);
  const nodeId = state.harvestNodeId;
  if (nodeId === null) {
    transition(state, 'TRAVEL', logs);
    return;
  }
  if (tick.gatherDeniedNode) {
    blacklistNode(state, nodeId, DENIED_BLACKLIST_MS, nowMs);
    logs.push(`harvest denied: ${nodeId}, blacklisting`);
    transition(state, 'TRAVEL', logs);
    return;
  }
  if (p.castingAbility === GATHER_CAST_ID) {
    state.sawGatherCast = true;
    return;
  }
  if (state.sawGatherCast) {
    state.stats.harvests += 1;
    logs.push(`harvested ${nodeId}`);
    transition(state, 'TRAVEL', logs);
    return;
  }
  if (nowMs - state.harvestIssuedAtMs >= HARVEST_RETRY_MS) {
    if (state.harvestRetries >= HARVEST_MAX_RETRIES) {
      blacklistNode(state, nodeId, DENIED_BLACKLIST_MS, nowMs);
      logs.push(`harvest failed: ${nodeId}, moving on`);
      transition(state, 'TRAVEL', logs);
      return;
    }
    world.harvestNode(nodeId);
    state.harvestIssuedAtMs = nowMs;
    state.harvestRetries += 1;
  }
}

function stepFishCast(state: BrainState, world: BotWorld, nowMs: number, logs: string[]): void {
  const rod = findFishingRod(world.inventory, state.itemDef);
  if (!rod) {
    transition(state, 'TRAVEL', logs, 'no fishing rod');
    return;
  }
  // Push the facing first; the cast follows in stepFishWaitBite after
  // FISH_ARM_MS so the server never probes against a stale facing.
  world.setMouselookFacing(state.fishProbeFacing);
  state.fishFacingSetAtMs = nowMs;
  state.fishCastAtMs = 0;
  state.fishAccepted = false;
  state.mode = 'FISH_WAIT_BITE'; // internal move, not log-worthy
}

function stepFishWaitBite(
  state: BrainState,
  world: BotWorld,
  tick: TickEvents,
  nowMs: number,
  logs: string[],
): void {
  const p = world.player;
  const rod = findFishingRod(world.inventory, state.itemDef);
  if (!rod) {
    transition(state, 'TRAVEL', logs, 'no fishing rod');
    return;
  }
  if (tick.faceWater) {
    state.fishProbeFacing = normAngle(state.fishProbeFacing + FISH_PROBE_STEP);
    state.waterProbeCount += 1;
    if (state.waterProbeCount >= FISH_MAX_PROBES) {
      state.waterProbeCount = 0;
      const spots = state.config.fishing.spots;
      if (spots.length > 1) {
        // A rotation spot that probes dry in every direction: move on instead
        // of pausing; the next TRAVEL tick targets the next spot.
        state.fishSpotIndex = (state.fishSpotIndex + 1) % spots.length;
        logs.push(`fishing: no fishable water here, moving to spot ${state.fishSpotIndex}`);
      } else {
        state.fishUnavailableUntilMs = nowMs + FISH_GIVE_UP_MS;
        logs.push('fishing: no fishable water in any direction, pausing');
      }
      transition(state, 'TRAVEL', logs);
    } else {
      state.mode = 'FISH_CAST';
    }
    return;
  }
  if (tick.castCancelled) {
    // A landed hit cancelled the session; the combat pre-empt picks it up.
    logs.push('fishing interrupted');
    transition(state, 'TRAVEL', logs);
    return;
  }
  if (state.fishCastAtMs === 0) {
    // Facing armed, cast not sent yet: give the input stream a beat to carry
    // the probe facing to the server (see FISH_ARM_MS), plus any jitter gate.
    if (nowMs - state.fishFacingSetAtMs >= FISH_ARM_MS && actionGateOpen(state, nowMs)) {
      world.useItem(rod);
      state.fishCastAtMs = nowMs;
    }
    return;
  }
  if (p.castingAbility === FISHING_CAST_ID) {
    state.fishAccepted = true;
    state.waterProbeCount = 0;
  }
  if (!state.fishAccepted) {
    // Cast never started and no error explained why (cooldown, bag-full on
    // the catch check, lag): retry until the facing probe or bags logic
    // moves us out.
    if (nowMs - state.fishCastAtMs >= FISH_ACCEPT_TIMEOUT_MS) state.mode = 'FISH_CAST';
    return;
  }
  if (tick.bite) {
    world.useItem(rod); // the reel: exactly one re-press inside the window
    logs.push('bite: reeling in');
    return;
  }
  if (tick.catchItemId) {
    state.stats.catches += 1;
    logs.push(`catch: ${tick.catchItemId}`);
    countCastAtSpot(state, logs);
    return;
  }
  if (tick.fishMissed) {
    logs.push(
      tick.fishMissed === 'fishingGotAway' ? 'got away: recasting' : 'empty hook: recasting',
    );
    countCastAtSpot(state, logs);
    return;
  }
  // Session ended silently (15s cap) or the cast marker vanished.
  if (
    p.castingAbility !== FISHING_CAST_ID ||
    nowMs - state.fishCastAtMs >= FISH_SESSION_TIMEOUT_MS
  ) {
    state.mode = 'FISH_CAST';
  }
}

// One defensive action per tick, replacing only that tick's rotation cast
// (auto-attack and movement continue). Returns true when it acted.
function issueEmergency(
  state: BrainState,
  world: BotWorld,
  action: EmergencyAction,
  nowMs: number,
  logs: string[],
): boolean {
  if (action.kind === 'cast') {
    if (action.selfTarget) world.castAbilityOn(action.id, world.player.id);
    else world.castAbility(action.id);
    const name = world.known.find((k) => k.def.id === action.id)?.def.name ?? action.id;
    logs.push(`emergency: ${name}`);
  } else {
    world.useItem(action.id);
    state.lastPotionAtMs = nowMs;
    logs.push(`emergency: ${state.itemDef(action.id)?.name ?? action.id}`);
  }
  return true;
}

function stepCombat(state: BrainState, world: BotWorld, nowMs: number, logs: string[]): void {
  const p = world.player;
  const attackers = findAttackers(world);
  let target: Entity | null = null;
  let bestD2 = Number.POSITIVE_INFINITY;
  for (const e of attackers) {
    const dx = e.pos.x - p.pos.x;
    const dz = e.pos.z - p.pos.z;
    const d2 = dx * dx + dz * dz;
    if (d2 < bestD2) {
      bestD2 = d2;
      target = e;
    }
  }
  if (!target && state.combatTargetId !== null) {
    // Grind pull in flight: the mob has not aggroed onto the mirror yet, but
    // we have a live target to keep walking into.
    const current = world.entities.get(state.combatTargetId);
    if (current && !current.dead) target = current;
  }
  if (target) {
    if (state.combatTargetId !== target.id) {
      world.targetEntity(target.id);
      world.startAutoAttack();
      state.combatTargetId = target.id;
    }
    const d = distance(pos2(p), pos2(target));
    if (d > MELEE_CHASE_RANGE) {
      const steer = steerToward(pos2(p), p.facing, pos2(target), MELEE_CHASE_RANGE);
      world.setMoveInput(steer.input, steer.facing);
    } else {
      stopMoving(world);
    }
    if (state.lastCastAtMs === null || nowMs - state.lastCastAtMs >= CAST_ATTEMPT_INTERVAL_MS) {
      // Emergency buttons first: one defensive action replaces this tick's
      // rotation cast; the normal rotation resumes next tick.
      const emergency = pickEmergencyAction(
        world.known,
        p,
        world.inventory,
        state.itemDef,
        state.lastPotionAtMs,
        nowMs,
      );
      if (emergency && issueEmergency(state, world, emergency, nowMs, logs)) {
        state.lastCastAtMs = nowMs;
      } else if (state.config.mode === 'gold') {
        // Gold mode ignores combat.rotationMode / abilitySlots: mana-lean kit
        // only (Crusader Strike, Holy Ground on multi-pull, buffs when down).
        // Rite of Expulsion stays pull-only in stepGold.
        if (tryGoldMaintainBuff(world, nowMs, null)) {
          state.lastCastAtMs = nowMs;
        } else {
          const attackers = findAttackers(world);
          const pick = pickGoldCombatAbility(world.known, p, target, attackers.length);
          if (pick) {
            issueGoldCast(world, pick);
            state.lastCastAtMs = nowMs;
          }
        }
      } else if (state.config.combat.rotationMode === 'auto') {
        // First ready damage ability by slot order; null means auto-attack only.
        const pick = pickAbility(world.known, p, target);
        if (pick) {
          world.castAbilityBySlot(pick.slot);
          state.lastCastAtMs = nowMs;
        }
      } else {
        const slots = state.config.combat.abilitySlots;
        if (slots.length > 0) {
          world.castAbilityBySlot(slots[state.castIndex % slots.length]);
          state.castIndex += 1;
          state.lastCastAtMs = nowMs;
        }
      }
    }
  } else {
    // inCombat with no visible attacker (out of snapshot range): hold still.
    stopMoving(world);
  }
}

// FLEE (combat.flee 'outleveled'): run from the nearest threat, hub-ward when
// the zone hub is far enough to be worth it. Ends when the aggro drops (loot
// pass as after a fight) or FLEE_TIMEOUT_MS expires, in which case the bot
// turns and fights rather than dying on the run.
function stepFlee(state: BrainState, world: BotWorld, nowMs: number, logs: string[]): void {
  const p = world.player;
  const attackers = findAttackers(world);
  if (attackers.length === 0 && !p.inCombat) {
    stopMoving(world);
    state.fleeAttempted = false;
    transition(state, 'LOOT', logs, 'escaped');
    return;
  }
  if (nowMs - state.fleeStartedAtMs >= FLEE_TIMEOUT_MS) {
    state.fleeAttempted = true; // no second flee from this engagement
    logs.push('flee failed: turning to fight');
    transition(state, 'COMBAT', logs);
    return;
  }
  // Emergency buttons fire while running too.
  const emergency = pickEmergencyAction(
    world.known,
    p,
    world.inventory,
    state.itemDef,
    state.lastPotionAtMs,
    nowMs,
  );
  if (emergency) issueEmergency(state, world, emergency, nowMs, logs);
  let threat: Entity | null = null;
  let bestD2 = Number.POSITIVE_INFINITY;
  for (const e of attackers) {
    const d2 = distance2(pos2(p), pos2(e));
    if (d2 < bestD2) {
      bestD2 = d2;
      threat = e;
    }
  }
  if (!threat) {
    stopMoving(world); // inCombat with the threat out of snapshot range
    return;
  }
  const hub = state.zoneHubAt ? state.zoneHubAt(p.pos.x, p.pos.z) : null;
  if (hub && distance2(pos2(p), hub) > FLEE_HUB_RANGE * FLEE_HUB_RANGE) {
    const steer = steerToward(pos2(p), p.facing, hub, FLEE_HUB_RANGE);
    world.setMoveInput(steer.input, steer.facing);
    return;
  }
  // Directly away from the threat, 30 yd out along the away vector.
  const dx = p.pos.x - threat.pos.x;
  const dz = p.pos.z - threat.pos.z;
  const len = Math.hypot(dx, dz) || 1;
  const away = { x: p.pos.x + (dx / len) * 30, z: p.pos.z + (dz / len) * 30 };
  const steer = steerToward(pos2(p), p.facing, away, 1);
  world.setMoveInput(steer.input, steer.facing);
}

function stepLoot(state: BrainState, world: BotWorld, nowMs: number, logs: string[]): void {
  const p = world.player;
  if (state.lootStartedAtMs === 0) state.lootStartedAtMs = nowMs;
  let nearest: Entity | null = null;
  let nearestD2 = Number.POSITIVE_INFINITY;
  for (const [id] of state.recentAttackers) {
    if (state.lootedIds.has(id)) continue;
    const e = world.entities.get(id);
    if (!e?.dead) continue;
    const d = distance(pos2(p), pos2(e));
    if (d <= LOOT_RANGE) {
      world.autoLoot(id);
      state.lootedIds.add(id);
      logs.push(`loot ${e.name}`);
    } else if (d * d < nearestD2) {
      nearestD2 = d * d;
      nearest = e;
    }
  }
  if (nearest) {
    const steer = steerToward(pos2(p), p.facing, pos2(nearest), LOOT_RANGE);
    world.setMoveInput(steer.input, steer.facing);
  } else {
    stopMoving(world);
  }
  const remaining = [...state.recentAttackers.keys()].some((id) => {
    const e = world.entities.get(id);
    return e?.dead === true && !state.lootedIds.has(id);
  });
  if (!remaining || nowMs - state.lootStartedAtMs >= LOOT_TIMEOUT_MS) {
    state.recentAttackers.clear();
    state.killLogged.clear();
    state.lootedIds.clear();
    state.lootStartedAtMs = 0;
    transition(state, 'TRAVEL', logs, remaining ? 'loot timed out' : 'loot done');
  }
}

function stepRecover(state: BrainState, world: BotWorld, nowMs: number, logs: string[]): void {
  stopMoving(world);
  const pct = recoverPct(state, world);
  if (pct >= state.recoverThresholdPct + RECOVER_EXIT_BUFFER_PCT) {
    logs.push('recovered');
    transition(state, 'TRAVEL', logs);
    return;
  }
  if (nowMs - state.recoverStartedAtMs >= RECOVER_TIMEOUT_MS) {
    logs.push('recover timed out');
    transition(state, 'TRAVEL', logs);
  }
}

// Post-death recovery (death.waitUntilFull): stand out of combat and top up.
// Eats/drinks the configured items when the matching pool is short (the
// eating/drinking mirrors gate re-issue, REST_ITEM_THROTTLE_MS covers the
// command-to-mirror latency); with no items configured this is a plain wait
// for natural regen. Exits at REST_FULL_PCT on hp and, for mana classes only,
// on mana.
//
// Priority is deliberate: never interrupt a live eat/drink channel (casts
// cancel them server-side), and top mana fully via drink before any self-heal.
// Healing while thirsty burns the mana the drink is restoring and thrashing
// (drink -> flash -> drink) is the live bug this ordering pins.
function stepRest(state: BrainState, world: BotWorld, nowMs: number, logs: string[]): void {
  const p = world.player;
  stopMoving(world);
  if (nowMs - state.restStartedAtMs >= REST_TIMEOUT_MS) {
    logs.push('rest timed out, resuming anyway');
    transition(state, 'TRAVEL', logs);
    return;
  }
  if (!needsRest(p)) {
    logs.push('rested');
    transition(state, 'TRAVEL', logs);
    return;
  }
  // Live channel: sit still until it finishes. Any cast here would cancel it.
  if (p.eating || p.drinking) return;
  if (state.restLastItemAtMs !== null && nowMs - state.restLastItemAtMs < REST_ITEM_THROTTLE_MS) {
    return;
  }
  const { combat } = state.config;
  // Mana first when short and a drink is available: commit to a full bar
  // before spending mana on heals or starting food.
  if (p.resourceType === 'mana' && resourcePct(p) < REST_FULL_PCT) {
    const itemId = restConsumable(state, world, combat.drinkItemId, 'drink');
    if (itemId) {
      world.useItem(itemId);
      state.restLastItemAtMs = nowMs;
      logs.push(`resting: drinking ${itemId}`);
      return;
    }
  }
  // Self-heal when castable (faster than food): Mending Light preferred,
  // Lightmend when mana only covers that. Only after mana is full (or no
  // drink is available). pickSelfHeal is null for non-paladins.
  const heal = pickSelfHeal(world.known, p);
  if (heal && hpPct(p) < SELF_HEAL_TARGET_PCT) {
    if (
      state.restLastItemAtMs === null ||
      nowMs - state.restLastItemAtMs >=
        (heal === HOLY_LIGHT_ID ? GOLD_HEAL_GATE_MS : FLASH_HEAL_GATE_MS)
    ) {
      world.castAbilityOn(heal, p.id);
      state.restLastItemAtMs = nowMs;
      logs.push(`resting: casting ${heal}`);
    }
    return; // hold still through the cast window either way
  }
  if (hpPct(p) < REST_FULL_PCT) {
    const itemId = restConsumable(state, world, combat.eatItemId, 'food');
    if (itemId) {
      world.useItem(itemId);
      state.restLastItemAtMs = nowMs;
      logs.push(`resting: eating ${itemId}`);
    }
  }
}

// The consumable a REST uses: the configured id when it is actually in the
// bags, otherwise the bag item of the given kind with the highest restore
// value (foodHp for food, drinkMana for drinks), else null (plain wait).
function restConsumable(
  state: BrainState,
  world: BotWorld,
  configuredId: string | undefined,
  kind: 'food' | 'drink',
): string | null {
  if (configuredId && world.inventory.some((s) => s.itemId === configuredId)) {
    return configuredId;
  }
  let best: string | null = null;
  let bestPower = 0;
  for (const slot of world.inventory) {
    const def = state.itemDef(slot.itemId);
    if (def?.kind !== kind) continue;
    const power = kind === 'food' ? (def.foodHp ?? 0) : (def.drinkMana ?? 0);
    if (power > bestPower) {
      bestPower = power;
      best = slot.itemId;
    }
  }
  return best;
}

// Player-density pause: stand still and take no actions while another player
// is in the radius; lift after PAUSE_CLEAR_MS of clear area. Combat and death
// pre-empt this state from the main flow.
function stepPaused(state: BrainState, world: BotWorld, nowMs: number, logs: string[]): void {
  stopMoving(world);
  const pauseCfg = state.config.safety.playerPause;
  if (anyPlayerWithin(world, pauseCfg.radiusYd)) {
    state.playerClearSinceMs = null;
    return;
  }
  if (state.playerClearSinceMs === null) state.playerClearSinceMs = nowMs;
  if (nowMs - state.playerClearSinceMs >= PAUSE_CLEAR_MS) {
    state.playerNearSinceMs = null;
    state.playerClearSinceMs = null;
    transition(state, 'TRAVEL', logs, 'area clear');
  }
}

// Session-rhythm break (idle arm; the logout arm ends the session at entry).
function stepBreak(state: BrainState, world: BotWorld, nowMs: number, logs: string[]): void {
  stopMoving(world);
  if (state.breakUntilMs !== null && nowMs >= state.breakUntilMs) {
    state.breakUntilMs = null;
    state.sessionStartedAtMs = nowMs; // the next session starts now
    transition(state, 'TRAVEL', logs, 'break over');
  }
}

function stepDead(state: BrainState, world: BotWorld, nowMs: number, logs: string[]): void {
  const p = world.player;
  if (state.mode !== 'DEAD') {
    stopMoving(world);
    transition(state, 'DEAD', logs, p.dead ? 'died' : 'ghost');
  }
  if (p.dead && !p.ghost) {
    state.corpseRunStartedAtMs = nowMs; // refreshed until the release lands
    if (state.lastReleaseAtMs === null || nowMs - state.lastReleaseAtMs >= RELEASE_THROTTLE_MS) {
      world.releaseSpirit();
      state.lastReleaseAtMs = nowMs;
      logs.push('releasing spirit');
    }
    return;
  }
  // Ghost: run back to the body (the mirrored corpsePos; the recorded
  // last-alive pos is only the fallback when the mirror has none), resurrect
  // inside CORPSE_REZ_RANGE, with a spirit healer fallback when the corpse
  // position is unknown or the run stalls. Gold mode: a corpse inside a
  // dungeon is unreachable from the overworld, so the ghost first walks back
  // to the door and re-enters the live claim, then runs the corpse down.
  const corpse = p.corpsePos ?? state.lastAlivePos;
  if (
    state.config.mode === 'gold' &&
    p.pos.x <= DUNGEON_X_THRESHOLD &&
    corpse &&
    corpse.x > DUNGEON_X_THRESHOLD &&
    state.goldDungeons.length > 0 &&
    nowMs - state.corpseRunStartedAtMs < CORPSE_RUN_TIMEOUT_MS
  ) {
    const def = state.goldDungeons[state.goldIndex % state.goldDungeons.length];
    const steer = steerToward(pos2(p), p.facing, def.doorPos, GOLD_DOOR_RANGE);
    if (!steer.arrived) {
      world.setMoveInput(steer.input, steer.facing);
      return;
    }
    stopMoving(world);
    world.enterDungeon(def.id);
    return;
  }
  if (corpse && nowMs - state.corpseRunStartedAtMs < CORPSE_RUN_TIMEOUT_MS) {
    const steer = steerToward(pos2(p), p.facing, corpse, CORPSE_ARRIVE_RANGE);
    if (!steer.arrived) {
      world.setMoveInput(steer.input, steer.facing);
      return;
    }
    stopMoving(world);
    if (
      state.lastResurrectAtMs === null ||
      nowMs - state.lastResurrectAtMs >= RESURRECT_THROTTLE_MS
    ) {
      world.resurrectAtCorpse();
      state.lastResurrectAtMs = nowMs;
      logs.push('resurrecting at corpse');
    }
    return;
  }
  stopMoving(world);
  if (state.lastHealerAtMs === null || nowMs - state.lastHealerAtMs >= HEALER_THROTTLE_MS) {
    world.resurrectAtSpiritHealer();
    state.lastHealerAtMs = nowMs;
    logs.push('resurrecting at spirit healer');
    alert(state, 'spirit-healer', 'resurrecting at spirit healer', nowMs);
  }
}

// Guided walk to a fixed target through village walls: routeViaGates plans
// the waypoint chain (gate crossing first when one side of a hub wall), the
// StuckDetector covers the leg, a first stuck escalation replans through the
// next-best gate, and a second gives up (walkGiveUpKey) so the caller can
// fall back to its own timeout policy. Used by the vendor walk, the mailbox
// walk, and the gold-mode door approach.
function stepGuidedWalk(
  state: BrainState,
  world: BotWorld,
  nowMs: number,
  logs: string[],
  key: string,
  target: NavPos,
  label: string,
): 'walking' | 'gave-up' {
  const p = world.player;
  if (state.walkGiveUpKey === key) {
    stopMoving(world);
    return 'gave-up';
  }
  if (state.walkKey !== key) {
    state.walkKey = key;
    state.walkGateOffset = 0;
    state.walkWaypoints = [];
    state.stuck.reset();
  }
  if (state.walkWaypoints.length === 0) {
    state.walkWaypoints = routeViaGates(pos2(p), target, WALLED_HUBS, state.walkGateOffset);
  }
  const hop = state.walkWaypoints[0];
  const arriveRange = state.walkWaypoints.length > 1 ? GATE_ARRIVE_RANGE : INTERACT_RANGE;
  const steer = steerToward(pos2(p), p.facing, hop, arriveRange);
  const stuckRes = state.stuck.update(pos2(p), nowMs);
  if (stuckRes.escalation === 'blacklist') {
    state.stuck.reset();
    if (state.walkGateOffset === 0) {
      state.walkGateOffset = 1;
      state.walkWaypoints = [];
      logs.push(`stuck reaching ${label}, trying another gate`);
      return 'walking';
    }
    state.walkGiveUpKey = key;
    state.walkWaypoints = [];
    stopMoving(world);
    logs.push(`stuck reaching ${label}, giving up`);
    return 'gave-up';
  }
  if (stuckRes.escalation === 'wiggle') logs.push('stuck: wiggling');
  world.setMoveInput({ ...steer.input, ...stuckRes.input }, steer.facing);
  if (steer.arrived && state.walkWaypoints.length > 1) {
    state.walkWaypoints.shift();
  }
  return 'walking';
}

function stepBagsFull(
  state: BrainState,
  world: BotWorld,
  tick: TickEvents,
  nowMs: number,
  logs: string[],
): void {
  const p = world.player;
  const stop = (): void => {
    world.sendLogout();
    state.done = true;
    logs.push('bags full: logging out');
    alert(state, 'bags-full', 'bags full: logging out', nowMs);
  };
  if (world.inventory.length < world.bagCapacity) {
    transition(state, 'TRAVEL', logs, 'bags have room');
    return;
  }
  if (state.config.bags.fullPolicy === 'stop') {
    stop();
    return;
  }

  // Mail offload runs before the vendor path: walk to a visible mailbox and
  // post the gathered mats to the configured alt, one letter at a time.
  const mailTo = state.config.bags.mailTo;
  if (mailTo && state.mailState !== 'done') {
    if (tick.mailResult === 'sent') {
      logs.push(`mail sent to ${mailTo}`);
      alert(state, 'mail', `mail sent to ${mailTo}`, nowMs);
      state.mailState = 'untried';
    } else if (tick.mailResult === 'failed') {
      logs.push('mail failed, falling back to vendor');
      state.mailState = 'done';
    }
    if (state.mailState !== 'done') {
      const box = nearestMailbox(world);
      if (!box) {
        if (!state.mailNoBoxLogged) {
          logs.push('bags full: no mailbox nearby, skipping mail');
          state.mailNoBoxLogged = true;
        }
        state.mailState = 'done';
      } else if (distance(pos2(p), pos2(box)) > INTERACT_RANGE) {
        const status = stepGuidedWalk(
          state,
          world,
          nowMs,
          logs,
          `mailbox:${box.id}`,
          pos2(box),
          'mailbox',
        );
        if (status === 'gave-up') {
          logs.push('bags full: mailbox unreachable, skipping mail');
          state.mailState = 'done';
        }
        return;
      } else {
        stopMoving(world);
        if (state.mailState === 'sending') {
          if (nowMs - state.lastMailAtMs < MAIL_RESULT_TIMEOUT_MS) return;
          state.mailState = 'untried'; // no answer: send the next letter anyway
        }
        const mats = selectMailSlots(world.inventory, state.itemDef, state.config);
        if (mats.length === 0) {
          state.mailState = 'done';
        } else {
          const letter = mats.slice(0, MAIL_MAX_ATTACHMENTS);
          world.mailSend(mailTo, 'farm mats', '', 0, letter);
          state.lastMailAtMs = nowMs;
          state.mailState = 'sending';
          logs.push(
            `mailing ${letter.map((s) => `${s.count}x ${s.itemId}`).join(', ')} to ${mailTo}`,
          );
          return;
        }
      }
    }
  }

  const vendor = nearestVendor(world);
  if (!vendor) {
    if (nowMs - state.bagsStartedAtMs >= BAGS_FULL_TIMEOUT_MS) {
      logs.push('bags full: no vendor nearby');
      stop();
    }
    return;
  }
  if (distance(pos2(p), pos2(vendor)) > INTERACT_RANGE) {
    if (nowMs - state.bagsStartedAtMs >= BAGS_FULL_TIMEOUT_MS) {
      // The walk branch now owns a real timeout: a vendor that stays
      // unreachable (fence, gate retry exhausted) must not grind forever.
      logs.push('bags full: vendor unreachable');
      stop();
      return;
    }
    stepGuidedWalk(state, world, nowMs, logs, `vendor:${vendor.id}`, pos2(vendor), 'vendor');
    return;
  }
  stopMoving(world);
  if (state.bagsVendorId !== vendor.id) {
    world.targetEntity(vendor.id);
    world.interact();
    state.bagsVendorId = vendor.id;
    state.lastSellAtMs = nowMs;
    logs.push(`selling junk to ${vendor.name}`);
    return;
  }
  if (nowMs - state.bagsStartedAtMs >= BAGS_FULL_TIMEOUT_MS) {
    logs.push('bags full: vendor sell timed out');
    stop();
    return;
  }
  if (nowMs - state.lastSellAtMs >= VENDOR_SELL_INTERVAL_MS) {
    state.lastSellAtMs = nowMs;
    const allowlist = state.config.bags.sellAllowlist;
    if (allowlist.length === 0) {
      world.sellAllJunk();
      return;
    }
    // Allowlist mode: only listed greys go; everything else stays in bags,
    // and an empty sellable set just rides out the timeout above.
    const sellable = world.inventory.filter(
      (s) => allowlist.includes(s.itemId) && state.itemDef(s.itemId)?.quality === 'poor',
    );
    if (sellable.length === 0) {
      if (!state.sellEmptyLogged) {
        logs.push('bags full: nothing on the sell allowlist left');
        state.sellEmptyLogged = true;
      }
      return;
    }
    for (const s of sellable) world.sellItem(s.itemId, s.count);
    logs.push(`sold ${sellable.length} allowlisted stacks to ${vendor.name}`);
  }
}

export function stepBrain(
  state: BrainState,
  world: BotWorld,
  events: readonly SimEvent[],
  nowMs: number,
): string[] {
  const logs: string[] = [];
  if (state.startedAtMs === null) state.startedAtMs = nowMs;
  if (state.sessionStartedAtMs === null) state.sessionStartedAtMs = nowMs;
  if (state.done) return logs;

  // Session copper earned (any mode): count only positive purse deltas so
  // vendor sells and dungeon loot add up, while spends re-baseline without
  // erasing the earned total. Exposed via FBSTAT stats.copperGained.
  if (state.lastCopper === null) {
    state.lastCopper = world.copper;
  } else {
    if (world.copper > state.lastCopper) {
      state.stats.copperGained += world.copper - state.lastCopper;
    }
    state.lastCopper = world.copper;
  }

  if (
    state.config.maxRuntimeMinutes > 0 &&
    nowMs - state.startedAtMs >= state.config.maxRuntimeMinutes * 60_000
  ) {
    world.sendLogout();
    state.done = true;
    logs.push('max runtime reached: logging out');
    alert(state, 'max-runtime', 'max runtime reached: logging out', nowMs);
    return logs;
  }

  const p = world.player;
  if (!p.dead && !p.ghost) state.lastAlivePos = { x: p.pos.x, z: p.pos.z };

  const tick = readEvents(world, events);

  // Personal death: count it (circuit breaker), remember the spot (danger
  // memory), then let the DEAD state take over below.
  if (tick.died) {
    state.deathCount += 1;
    state.stats.deaths += 1;
    state.deathSpots.push({ x: p.pos.x, z: p.pos.z, atMs: nowMs });
    logs.push(`death #${state.deathCount}`);
    alert(state, 'death', `death #${state.deathCount}`, nowMs);
    const maxDeaths = state.config.death.maxDeaths;
    if (maxDeaths > 0 && state.deathCount >= maxDeaths) {
      world.sendLogout();
      state.done = true;
      logs.push(`death circuit breaker: ${maxDeaths} deaths this session, logging out`);
      alert(
        state,
        'circuit-breaker',
        `death circuit breaker: ${maxDeaths} deaths, logging out`,
        nowMs,
      );
      return logs;
    }
  }

  // Death pre-empts everything.
  if (p.dead || p.ghost) {
    stepDead(state, world, nowMs, logs);
    return logs;
  }
  if (state.mode === 'DEAD') {
    state.combatTargetId = null;
    state.recentAttackers.clear();
    state.killLogged.clear();
    state.lootedIds.clear();
    state.stuck.reset();
    if (p.auras.some((a) => a.id === RESURRECTION_SICKNESS_ID)) {
      logs.push('resurrection sickness');
    }
    if (state.config.death.waitUntilFull && needsRest(p)) {
      state.restLastItemAtMs = null;
      state.restStartedAtMs = nowMs;
      transition(state, 'REST', logs, 'resurrected, resting');
    } else {
      transition(state, 'TRAVEL', logs, 'resurrected');
    }
  }

  // Track attackers and kills for combat targeting and the loot pass.
  const attackers = findAttackers(world);
  for (const e of attackers) {
    if (!state.recentAttackers.has(e.id)) logs.push(`aggro from ${e.name}`);
    state.recentAttackers.set(e.id, e.name);
  }
  for (const [id, name] of state.recentAttackers) {
    const e = world.entities.get(id);
    if (e?.dead && !state.killLogged.has(id)) {
      state.killLogged.add(id);
      state.stats.kills += 1;
      logs.push(`kill ${name}`);
    }
  }

  // Combat pre-empts every other activity, with one out: an attacker too far
  // above our level sends an 'outleveled' bot to FLEE instead of COMBAT.
  const shouldFlee =
    !state.fleeAttempted &&
    state.config.combat.flee === 'outleveled' &&
    attackers.some((e) => e.level > p.level + state.config.combat.fleeAboveLevelDelta);
  if ((attackers.length > 0 || p.inCombat) && state.mode !== 'COMBAT' && state.mode !== 'FLEE') {
    stopMoving(world);
    state.castIndex = 0;
    state.playerNearSinceMs = null; // pause/break timers restart after the fight
    state.playerClearSinceMs = null;
    if (shouldFlee) {
      state.fleeStartedAtMs = nowMs;
      transition(state, 'FLEE', logs, 'outleveled');
    } else {
      transition(state, 'COMBAT', logs);
    }
  } else if (state.mode === 'COMBAT' && shouldFlee) {
    world.stopAutoAttack();
    world.targetEntity(null);
    state.combatTargetId = null;
    stopMoving(world);
    state.fleeStartedAtMs = nowMs;
    transition(state, 'FLEE', logs, 'outleveled');
  } else if (state.mode === 'COMBAT' && attackers.length === 0 && !p.inCombat) {
    // Grind pulls keep a live target before the mob's aggro lands on the
    // mirror; only call the fight over when there is nothing left to swing at.
    const current =
      state.combatTargetId !== null ? world.entities.get(state.combatTargetId) : undefined;
    if (!current || current.dead) {
      world.stopAutoAttack();
      world.targetEntity(null);
      state.combatTargetId = null;
      state.fleeAttempted = false;
      stopMoving(world);
      // Gold mode: corpses belong to goldLoot's copper/rare rule, not the
      // auto-loot pass, so return to the rotation hub instead of LOOT.
      transition(state, state.config.mode === 'gold' ? 'TRAVEL' : 'LOOT', logs, 'fight over');
    }
  }

  // Safety watch: whispers addressed to us (an outgoing echo carries `to` and
  // is ignored) and says from an entity within SAY_WATCH_RANGE.
  const whisperAction = state.config.safety.whisperAction;
  for (const chat of tick.chats) {
    let label: string | null = null;
    if (chat.channel === 'whisper') {
      label = `whisper from ${chat.from}`;
    } else if (chat.channel === 'say' && chat.entityId !== undefined) {
      const speaker = world.entities.get(chat.entityId);
      if (speaker && distance2(pos2(p), pos2(speaker)) <= SAY_WATCH_RANGE * SAY_WATCH_RANGE) {
        label = `say from ${chat.from}`;
      }
    }
    if (label === null) continue;
    logs.push(`chat: ${label}: ${chat.text}`);
    if (whisperAction !== 'log') {
      alert(state, 'whisper', `${label}: ${chat.text}`, nowMs);
      if (whisperAction === 'logout') {
        world.sendLogout();
        state.done = true;
        logs.push('whisper watch: logging out');
        return logs;
      }
    }
  }

  // Player-density pause: another player inside the radius for the configured
  // duration pauses the bot until the area stays clear for PAUSE_CLEAR_MS.
  const pauseCfg = state.config.safety.playerPause;
  if (
    pauseCfg.enabled &&
    state.mode !== 'COMBAT' &&
    state.mode !== 'FLEE' &&
    state.mode !== 'PAUSED' &&
    state.mode !== 'BREAK'
  ) {
    if (anyPlayerWithin(world, pauseCfg.radiusYd)) {
      if (state.playerNearSinceMs === null) state.playerNearSinceMs = nowMs;
      if (nowMs - state.playerNearSinceMs >= pauseCfg.seconds * 1000) {
        stopMoving(world);
        state.playerClearSinceMs = null;
        transition(state, 'PAUSED', logs, 'player nearby');
        alert(state, 'player-pause', 'player nearby, pausing', nowMs);
      }
    } else {
      state.playerNearSinceMs = null;
    }
  }

  // Session rhythm: after sessionMinutes of farm time, take a break.
  const scheduleCfg = state.config.safety.schedule;
  const sessionStartedAtMs = state.sessionStartedAtMs ?? nowMs;
  if (
    scheduleCfg.sessionMinutes > 0 &&
    state.mode !== 'COMBAT' &&
    state.mode !== 'FLEE' &&
    state.mode !== 'BREAK'
  ) {
    if (state.breakUntilMs === null && state.mode !== 'PAUSED') {
      if (nowMs - sessionStartedAtMs >= scheduleCfg.sessionMinutes * 60_000) {
        alert(state, 'break', 'session break', nowMs);
        if (scheduleCfg.breakAction === 'logout') {
          world.sendLogout();
          state.done = true;
          logs.push('session break: logging out');
          return logs;
        }
        stopMoving(world);
        state.breakUntilMs = nowMs + scheduleCfg.breakMinutes * 60_000;
        transition(state, 'BREAK', logs, 'session break');
      }
    } else if (state.breakUntilMs !== null && state.mode !== 'PAUSED') {
      // A combat interruption does not cancel a break: re-enter it.
      transition(state, 'BREAK', logs, 'break resumes');
    }
  }

  // Bags pre-empt everything except combat and death.
  if (
    state.mode !== 'COMBAT' &&
    state.mode !== 'BAGS_FULL' &&
    (world.inventory.length >= world.bagCapacity || tick.bagsFull)
  ) {
    stopMoving(world);
    state.bagsStartedAtMs = nowMs;
    state.bagsVendorId = null;
    state.lastSellAtMs = 0;
    state.mailState = 'untried';
    state.lastMailAtMs = 0;
    state.mailNoBoxLogged = false;
    state.sellEmptyLogged = false;
    state.walkGiveUpKey = null;
    state.walkKey = null;
    transition(state, 'BAGS_FULL', logs);
  }

  // Self-heal watch: out of combat and badly hurt, with a castable paladin
  // heal in the spellbook, hold and heal up. Combat, death and bags-full
  // already pre-empted above; TRAVEL/gold/fishing yield to this.
  if (
    state.mode !== 'COMBAT' &&
    state.mode !== 'FLEE' &&
    state.mode !== 'REST' &&
    state.mode !== 'RECOVER' &&
    state.mode !== 'PAUSED' &&
    attackers.length === 0 &&
    !p.inCombat &&
    hpPct(p) < SELF_HEAL_ENTER_PCT &&
    pickSelfHeal(world.known, p) !== null
  ) {
    stopMoving(world);
    state.restLastItemAtMs = null;
    state.restStartedAtMs = nowMs;
    transition(state, 'REST', logs, 'self-heal');
  }

  switch (state.mode) {
    case 'TRAVEL':
      stepTravel(state, world, nowMs, logs);
      break;
    case 'HARVEST':
      stepHarvest(state, world, tick, nowMs, logs);
      break;
    case 'FISH_CAST':
      stepFishCast(state, world, nowMs, logs);
      break;
    case 'FISH_WAIT_BITE':
      stepFishWaitBite(state, world, tick, nowMs, logs);
      break;
    case 'COMBAT':
      stepCombat(state, world, nowMs, logs);
      break;
    case 'FLEE':
      stepFlee(state, world, nowMs, logs);
      break;
    case 'LOOT':
      stepLoot(state, world, nowMs, logs);
      break;
    case 'RECOVER':
      stepRecover(state, world, nowMs, logs);
      break;
    case 'REST':
      stepRest(state, world, nowMs, logs);
      break;
    case 'PAUSED':
      stepPaused(state, world, nowMs, logs);
      break;
    case 'BREAK':
      stepBreak(state, world, nowMs, logs);
      break;
    case 'DEAD':
      stepDead(state, world, nowMs, logs);
      break;
    case 'BAGS_FULL':
      stepBagsFull(state, world, tick, nowMs, logs);
      break;
  }
  return logs;
}
