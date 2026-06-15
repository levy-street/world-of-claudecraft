import {
  ABILITIES, ARENA_SLOT_COUNT, CAMPS, CLASSES, DUNGEONS, DUNGEON_LIST, DungeonDef, arenaOrigin, dungeonAt,
  DUNGEON_X_THRESHOLD, GROUND_OBJECTS, GROUP_XP_BONUS, INSTANCE_SLOT_COUNT, isArenaPos,
  ITEMS, MOBS, NPCS, PLAYER_START, QUESTS, questRewardItemId, abilitiesKnownAt, instanceOrigin,
  zoneAt,
} from './data';
import { ARENA_SPAWN_A, ARENA_SPAWN_B } from './dungeon_layout';
import { resolvePosition } from './colliders';
import { findPath } from './pathfind';
import { createGroundObject, createMob, createNpc, createPlayer, recalcPlayerStats, PlayerEquipment } from './entity';
import { Rng } from './rng';
import { SpatialGrid } from './spatial';
import {
  HEAL_THREAT_FACTOR, MELEE_SWITCH_MULT, RANGED_SWITCH_MULT,
  TAUNT_FORCE_SECONDS, addThreat, clearThreat, stealthDetectionRadius, threatModifier, topThreatValue,
} from './threat';
import { groundHeight, WATER_LEVEL } from './world';
import {
  AbilityDef, AbilityEffect, Aura, AuraKind, CAST_PUSHBACK_SEC, CHANNEL_PUSHBACK_FRACTION, CONSUME_DURATION,
  CONSUME_TICKS, CrowdControlDrCategory, DT, Entity, EquipSlot, FISHING_CAST_ID, FISHING_CAST_TIME, GCD,
  INTERACT_RANGE, InvSlot, LootEntry, LootSlot, MELEE_RANGE, MAX_LEVEL, MobFamily,
  MoveInput, PlayerClass, QuestProgress, QuestState, RUN_SPEED, SimConfig, SimEvent, TURN_SPEED, Vec3,
  angleTo, armorReduction, dist2d, emptyMoveInput, isConsuming, meleeMissChance, mobXpValue, normAngle,
  rageFromDealing, rageFromTaking, spellHitChance, xpForLevel,
} from './types';

const LEASH_DISTANCE = 45;
const DUNGEON_LEASH_DISTANCE = 70;
const CORPSE_DURATION = 60;
const EVADE_SPEED_MULT = 1.6;
// An evading mob walks a straight line home (no pathfinding) and stalls if deep
// water or a collider sits between it and its spawn. Since evading mobs are
// immune while resetting, a permanent stall = a permanently unkillable mob. If it
// can't get closer to home for this long, it starts phasing through the blocker.
const EVADE_STALL_TIMEOUT = 3;
const BACKPEDAL_MULT = 0.65;
const GRAVITY = 16;
const JUMP_VELOCITY = 6;
const MELEE_ARC = 2.2; // radians half-arc within which melee swings connect
const FALL_SAFE_DISTANCE = 12; // yards of free fall before damage
const OBJECT_RESPAWN = 30;
const PARTY_MAX = 5;
const PARTY_XP_RANGE = 80; // yards: members this close share kill xp/credit
const DUEL_COUNTDOWN = 3;
// Ashen Coliseum 1v1 arena
const ARENA_COUNTDOWN = 5; // gates pre-fight: heal up, no swings land yet
const ARENA_RETURN_DELAY = 5; // aftermath: hold on the sands before going home
const ARENA_MAX_DURATION = 150; // seconds; a stalling match resolves on hp%
const ARENA_BASE_RATING = 1500; // every character starts here, unranked
const ARENA_MIN_RATING = 100; // a rating floor so a losing streak can't go absurd
const ARENA_K_FACTOR = 32; // Elo sensitivity per match
const ARENA_LADDER_SIZE = 10; // live online standings shipped to clients
const PVP_CC_DR_RESET = 18; // seconds before a repeated PvP CC category is fresh again
const PVP_CC_DR_MULTIPLIERS = [1, 0.5, 0.25] as const;
const SAY_RANGE = 25; // /say carries a short distance; /yell across a camp
const YELL_RANGE = 100;
const CHAT_BURST = 8; // messages a player may send back-to-back...
const CHAT_REFILL = 2; // ...then this many more per second (caps spam amplifiers)
const DUEL_FORFEIT_DISTANCE = 60;
const TRADE_RANGE = 10;
// The World Market (the Merchant's auction house)
const MARKET_RANGE = INTERACT_RANGE + 2; // you must stand at the Merchant to deal
const MARKET_MAX_LISTINGS = 12; // active player listings per seller
const MARKET_MIN_PRICE = 1; // copper
const MARKET_MAX_PRICE = 5_000_000; // 500g ceiling — guards against overflow / fat-finger
const MARKET_CUT = 0.05; // the Merchant's cut on a completed sale (a gold sink)
const MARKET_LISTING_DURATION = 48 * 3600; // sim-seconds an unsold listing lingers before returning
const MARKET_WIRE_LIMIT = 120; // most listings shipped to one client at a time
const VENDOR_BUYBACK_LIMIT = 12;
const INSTANCE_EMPTY_TIMEOUT = 300; // seconds before an empty instance resets
const MAX_CLIMB_SLOPE = 1.5; // rise/run above which a ground move is blocked (cliffs, world rim)

// How far a mob pulls same-family neighbours into a fight ("social aggro").
// Murlocs (the clustered water mobs players call "frogs") used to pull too much,
// chain-aggroing the whole pond and making solo pulls impossible (#102). Tune
// per family here; everything else falls back to the default.
const POTION_COOLDOWN = 60; // seconds; shared cooldown across combat potions (#103)
const DEFAULT_SOCIAL_PULL_RADIUS = 5;
const SOCIAL_PULL_RADIUS: Partial<Record<MobFamily, number>> = {
  murloc: 8,
};
const SWIM_SURFACE_Y = WATER_LEVEL - 0.75; // body bobs just below the water line
const SWIM_DEPTH = 0.8; // ground this far under the water line = deep water
const SWIM_SPEED_MULT = 0.65;
const FISHING_SAMPLE_DISTANCES = [4, 8, 12, 16, 20, 24];
const DOOR_TRIGGER_RADIUS = 2.0; // walking this close to a dungeon door teleports you
const BODY_RADIUS = 0.5;
const CHARGE_SPEED_MULT = 3; // warrior charge runs at 3x normal speed
const CHARGE_MAX_DURATION = 3; // seconds before a blocked charge gives up
const CHARGE_ARRIVE_RANGE = MELEE_RANGE - 1; // stop inside melee range
const PET_LEASH = 40; // yards from the owner before a pet gives up its target
const PET_FOLLOW_DISTANCE = 3.5;
const PET_TELEPORT_DISTANCE = 60; // owner this far away: pet warps to heel
const PET_ASSIST_RANGE = 50; // how far the pet scans for enemies engaging the pair
const PET_GROWL_INTERVAL = 8; // controlled pets can tank by forcing attention
const FRIENDLY_NPC_REJECTED_AURA_KINDS: ReadonlySet<AuraKind> = new Set([
  'dot', 'slow', 'stun', 'root', 'incapacitate', 'polymorph', 'attackspeed', 'sunder',
]);

function isRejectedFriendlyNpcAura(aura: Aura): boolean {
  return FRIENDLY_NPC_REJECTED_AURA_KINDS.has(aura.kind);
}

export interface Party {
  id: number;
  leader: number; // pid
  members: number[]; // pids
}

export interface TradeSession {
  a: number;
  b: number;
  offerA: { items: InvSlot[]; copper: number };
  offerB: { items: InvSlot[]; copper: number };
  acceptedA: boolean;
  acceptedB: boolean;
}

export interface DuelState {
  a: number;
  b: number;
  state: 'countdown' | 'active';
  timer: number; // countdown remaining / elapsed
}

// A live 1v1 arena bout. Both combatants are teleported into a private arena
// instance slot; `return*` remembers where each was standing so the match can
// put them back when it ends. Ratings are snapshotted at the start purely for
// the result message — the authoritative values live on each PlayerMeta.
export interface ArenaMatch {
  id: number;
  a: number; // pid
  b: number; // pid
  slot: number; // arena instance slot
  state: 'countdown' | 'active' | 'over';
  timer: number; // countdown remaining, then elapsed once active, then return countdown
  returnA: { x: number; z: number; facing: number };
  returnB: { x: number; z: number; facing: number };
  ratingA: number;
  ratingB: number;
}

// Standard Elo. Returns the points the winner gains (and the loser loses) for
// an outright result; a draw moves each toward its expected score by half.
export function eloDelta(winnerRating: number, loserRating: number, score = 1): number {
  const expected = 1 / (1 + 10 ** ((loserRating - winnerRating) / 400));
  return Math.round(ARENA_K_FACTOR * (score - expected));
}

export interface InstanceSlot {
  dungeonId: string;
  slot: number;
  partyKey: string | null; // party id or 'solo:<pid>'
  mobIds: number[];
  exitId: number | null;
  emptyFor: number;
}

export interface ResolvedAbility {
  def: AbilityDef;
  rank: number;
  cost: number;
  castTime: number;
  effects: AbilityEffect[];
  threatFlat: number; // classic bonus threat on a successful use
  threatMult: number; // classic multiplier on this ability's damage-threat
}

export interface RewardCounters {
  damageDealt: number;
  damageTaken: number;
  kills: number;
  deaths: number;
  xpGained: number;
  questsCompleted: number;
  questProgress: number;
  lootCopper: number;
  levelUps: number;
}

export interface SentChat {
  channel: 'say' | 'yell' | 'whisper' | 'general' | 'party';
  message: string;
}

// Per-player progression and bags. The entity holds combat state; this holds
// everything that belongs to the character sheet.
export interface PlayerMeta {
  entityId: number;
  cls: PlayerClass;
  name: string;
  moveInput: MoveInput;
  inventory: InvSlot[];
  vendorBuyback: InvSlot[];
  copper: number;
  equipment: PlayerEquipment;
  xp: number;
  known: ResolvedAbility[];
  questLog: Map<string, QuestProgress>;
  questsDone: Set<string>;
  counters: RewardCounters;
  autoEquip: boolean;
  // Ashen Coliseum standing — persisted in CharacterState
  arenaRating: number;
  arenaWins: number;
  arenaLosses: number;
}

// ---------------------------------------------------------------------------
// The World Market — a single shared, server-authoritative auction house run
// by the Merchant NPC. Listings live in the sim (so offline play has a market
// too and the rules are testable); the server persists them to Postgres.
// Sellers are keyed by character name, which is globally unique, so proceeds
// and returns reach the right player even while they are offline.
// ---------------------------------------------------------------------------

export interface MarketListing {
  id: number;
  sellerKey: string; // stable seller identity (character name); '' for house stock
  sellerName: string; // display name
  itemId: string;
  count: number;
  price: number; // total copper buyout for the whole stack
  expiresAt: number; // sim.time seconds; Infinity for the Merchant's own stock
  house: boolean; // the Merchant's standing stock: never expires, never depletes, pays no one
}

// Gold + items awaiting pickup at the Merchant (sale proceeds, expired
// listings), keyed by seller name so an offline seller can collect later.
export interface MarketCollection {
  copper: number;
  items: InvSlot[];
}

// Persistable market state. `secondsLeft` is stored instead of an absolute
// expiry because sim.time resets to 0 each server boot — on load it becomes
// `this.time + secondsLeft`, so a restart never silently expires everything.
export interface MarketSave {
  listings: { id: number; sellerKey: string; sellerName: string; itemId: string; count: number; price: number; secondsLeft: number }[];
  collections: { key: string; copper: number; items: InvSlot[] }[];
  nextListingId: number;
}

// Persistable character state (stored as JSONB server-side). The arena fields
// are optional so characters saved before the Ashen Coliseum existed load
// cleanly (addPlayer falls back to the unranked defaults).
export interface CharacterState {
  level: number;
  xp: number;
  copper: number;
  hp: number;
  resource: number;
  pos: { x: number; z: number };
  facing: number;
  equipment: PlayerEquipment;
  inventory: InvSlot[];
  vendorBuyback?: InvSlot[];
  questLog: { questId: string; counts: number[]; state: 'active' | 'ready' | 'done' }[];
  questsDone: string[];
  arenaRating?: number;
  arenaWins?: number;
  arenaLosses?: number;
}

// Pure quest-state computation, shared by the sim and the network client.
export function computeQuestState(
  questId: string,
  questLog: Map<string, QuestProgress>,
  questsDone: Set<string>,
  playerLevel: number,
): QuestState {
  if (questsDone.has(questId)) return 'done';
  const qp = questLog.get(questId);
  if (qp) return qp.state === 'ready' ? 'ready' : 'active';
  const quest = QUESTS[questId];
  if (!quest) return 'unavailable';
  if (quest.requiresQuest && !questsDone.has(quest.requiresQuest)) return 'unavailable';
  if (quest.minLevel && playerLevel < quest.minLevel) return 'unavailable';
  return 'available';
}

function copyPos(dst: { x: number; y: number; z: number }, src: { x: number; y: number; z: number }): void {
  dst.x = src.x;
  dst.y = src.y;
  dst.z = src.z;
}

function freshCounters(): RewardCounters {
  return {
    damageDealt: 0, damageTaken: 0, kills: 0, deaths: 0, xpGained: 0,
    questsCompleted: 0, questProgress: 0, lootCopper: 0, levelUps: 0,
  };
}

// Shapeshifts stay castable while shapeshifted (that's how you shift out).
function isFormToggle(ability: AbilityDef): boolean {
  return ability.effects.some((e) => e.type === 'selfBuff' && (e.kind === 'form_bear' || e.kind === 'form_cat'));
}

// Forms, stances and stealth are toggles: re-casting cancels the aura, and
// cancelling is never gated by cost or cooldown (the cooldown gates re-entry).
function isToggleBuff(ability: AbilityDef): boolean {
  return ability.effects.some((e) => e.type === 'selfBuff'
    && (e.kind === 'form_bear' || e.kind === 'form_cat' || e.kind === 'defensive_stance' || e.kind === 'stealth'));
}

export class Sim {
  cfg: Required<Omit<SimConfig, 'noPlayer'>>;
  rng: Rng;
  time = 0;
  tickCount = 0;
  entities = new Map<number, Entity>();
  players = new Map<number, PlayerMeta>(); // keyed by entity id
  // spatial indexes for radius queries; re-bucketed at the end of each tick
  // and kept roster-exact on spawn/despawn/teleport
  readonly grid = new SpatialGrid();
  readonly playerGrid = new SpatialGrid();
  private engagedPids = new Set<number>();
  primaryId = -1; // the local/RL player in single-player contexts
  nextId = 1;
  events: SimEvent[] = [];
  // social systems
  parties = new Map<number, Party>();
  partyByPid = new Map<number, number>(); // pid -> party id
  partyInvites = new Map<number, { fromPid: number; expires: number }>(); // invitee pid -> invite
  nextPartyId = 1;
  // raid/target markers: partyId -> (enemy entityId -> markerId 0..7). A
  // cosmetic, party-scoped overlay — never read by tick()/obs/persistence.
  partyMarkers = new Map<number, Map<number, number>>();
  trades = new Map<number, TradeSession>(); // pid -> shared session (both pids point at it)
  tradeInvites = new Map<number, { fromPid: number; expires: number }>();
  duels = new Map<number, DuelState>(); // pid -> shared duel (both pids)
  duelInvites = new Map<number, { fromPid: number; expires: number }>();
  // arena: a matchmaking queue (pids, oldest first), live bouts keyed by both
  // pids, and the set of busy instance slots
  arenaQueue: number[] = [];
  arenaMatches = new Map<number, ArenaMatch>(); // pid -> shared match (both pids)
  private arenaBusySlots = new Set<number>();
  private nextArenaMatchId = 1;
  // per-player chat token bucket (anti-spam); refilled lazily by sim time
  private chatTokens = new Map<number, { tokens: number; at: number }>();
  // dungeon instances
  instances: InstanceSlot[] = [];
  // the World Market: one shared listing book, per-seller collections keyed by
  // character name, and the Merchant entity these are anchored to
  marketListings: MarketListing[] = [];
  private marketCollections = new Map<string, MarketCollection>();
  private nextListingId = 1;
  private merchantId = -1;

  constructor(cfg: SimConfig) {
    this.cfg = {
      seed: cfg.seed,
      playerClass: cfg.playerClass,
      respawnSeconds: cfg.respawnSeconds ?? 25,
      autoEquip: cfg.autoEquip ?? false,
      playerName: cfg.playerName ?? 'Adventurer',
    };
    this.rng = new Rng(cfg.seed);

    // NPCs — nudged out of buildings and deep water if their data position is bad
    for (const npcDef of Object.values(NPCS)) {
      const safe = this.findSafePos(npcDef.pos.x, npcDef.pos.z, WATER_LEVEL + 0.6);
      const npc = createNpc(this.nextId++, npcDef, this.groundPos(safe.x, safe.z));
      this.addEntity(npc);
      if (npcDef.market) this.merchantId = npc.id; // the World Market is anchored here
    }
    this.seedHouseListings();

    // Mobs from camps
    for (const camp of CAMPS) {
      const template = MOBS[camp.mobId];
      // Swimmers may wade in the shallows; everyone else spawns on dry land.
      const minHeight = this.mobCanSwim(template) ? WATER_LEVEL - 0.5 : WATER_LEVEL + 0.4;
      for (let i = 0; i < camp.count; i++) {
        const ang = this.rng.range(0, Math.PI * 2);
        const r = Math.sqrt(this.rng.next()) * camp.radius;
        const safe = this.findSafePos(camp.center.x + Math.sin(ang) * r, camp.center.z + Math.cos(ang) * r, minHeight);
        const pos = this.groundPos(safe.x, safe.z);
        const level = this.rng.int(template.minLevel, template.maxLevel);
        const mob = createMob(this.nextId++, template, level, pos);
        mob.facing = this.rng.range(-Math.PI, Math.PI);
        mob.prevFacing = mob.facing;
        mob.wanderTimer = this.rng.range(2, 10);
        this.addEntity(mob);
      }
    }

    // Ground objects
    for (const objDef of GROUND_OBJECTS) {
      for (const p of objDef.positions) {
        const obj = createGroundObject(this.nextId++, objDef.itemId, objDef.name, this.groundPos(p.x, p.z));
        this.addEntity(obj);
      }
    }

    // Dungeon entrances + their private instance slots
    for (const dungeon of DUNGEON_LIST) {
      const door = createGroundObject(this.nextId++, '', dungeon.name, this.groundPos(dungeon.doorPos.x, dungeon.doorPos.z));
      door.templateId = 'dungeon_door';
      door.dungeonId = dungeon.id;
      door.objectItemId = null;
      door.lootable = true; // interactable
      this.addEntity(door);
      for (let i = 0; i < INSTANCE_SLOT_COUNT; i++) {
        this.instances.push({ dungeonId: dungeon.id, slot: i, partyKey: null, mobIds: [], exitId: null, emptyFor: 0 });
      }
    }

    if (!cfg.noPlayer) {
      this.addPlayer(this.cfg.playerClass, this.cfg.playerName, { autoEquip: this.cfg.autoEquip });
    }
  }

  // -------------------------------------------------------------------------
  // Entity roster: every add/remove/teleport goes through these so the
  // spatial indexes always match the entities map
  // -------------------------------------------------------------------------

  private addEntity(e: Entity): void {
    this.entities.set(e.id, e);
    this.grid.insert(e);
    if (e.kind === 'player') this.playerGrid.insert(e);
  }

  private dropEntity(id: number): void {
    this.clearEntityMarker(id); // a despawned entity keeps no raid marker
    const e = this.entities.get(id);
    if (!e) return;
    this.grid.remove(e);
    if (e.kind === 'player') this.playerGrid.remove(e);
    this.entities.delete(id);
  }

  private rebucket(e: Entity): void {
    this.grid.update(e);
    if (e.kind === 'player') this.playerGrid.update(e);
  }

  // -------------------------------------------------------------------------
  // Players: join / leave / persistence
  // -------------------------------------------------------------------------

  addPlayer(cls: PlayerClass, name: string, opts?: { autoEquip?: boolean; state?: CharacterState }): number {
    // Characters saved inside a dungeon instance rejoin at its entrance —
    // their old instance is gone (or belongs to someone else) by now.
    let savedPos = opts?.state?.pos ?? null;
    if (savedPos && savedPos.x > DUNGEON_X_THRESHOLD) {
      const dungeon = dungeonAt(savedPos.x) ?? DUNGEON_LIST[0];
      savedPos = { x: dungeon.doorPos.x, z: dungeon.doorPos.z - 4 };
    }
    const startPos = savedPos
      ? this.groundPos(savedPos.x, savedPos.z)
      : this.groundPos(PLAYER_START.x, PLAYER_START.z);
    const player = createPlayer(this.nextId++, cls, startPos, name);
    this.addEntity(player);
    const classDef = CLASSES[cls];
    const meta: PlayerMeta = {
      entityId: player.id,
      cls,
      name,
      moveInput: emptyMoveInput(),
      inventory: [],
      vendorBuyback: [],
      copper: 0,
      equipment: { mainhand: classDef.startWeapon, chest: classDef.startChest },
      xp: 0,
      known: [],
      questLog: new Map(),
      questsDone: new Set(),
      counters: freshCounters(),
      autoEquip: opts?.autoEquip ?? false,
      arenaRating: opts?.state?.arenaRating ?? ARENA_BASE_RATING,
      arenaWins: opts?.state?.arenaWins ?? 0,
      arenaLosses: opts?.state?.arenaLosses ?? 0,
    };
    this.players.set(player.id, meta);
    if (this.primaryId === -1) this.primaryId = player.id;

    if (opts?.state) {
      const s = opts.state;
      player.level = Math.max(1, Math.min(MAX_LEVEL, s.level));
      player.facing = s.facing;
      player.prevFacing = s.facing;
      meta.xp = s.xp;
      meta.copper = s.copper;
      meta.equipment = { ...s.equipment };
      meta.inventory = s.inventory.map((i) => ({ ...i }));
      meta.vendorBuyback = (s.vendorBuyback ?? []).map((i) => ({ ...i }));
      for (const q of s.questLog) {
        if (q.state !== 'done') meta.questLog.set(q.questId, { questId: q.questId, counts: [...q.counts], state: q.state });
      }
      for (const q of s.questsDone) meta.questsDone.add(q);
    }

    this.refreshKnownAbilities(meta, false);
    recalcPlayerStats(player, cls, meta.equipment);
    if (opts?.state) {
      player.hp = Math.max(1, Math.min(player.maxHp, opts.state.hp));
      player.resource = classDef.resourceType === 'mana'
        ? Math.min(player.maxResource, Math.max(0, opts.state.resource))
        : classDef.resourceType === 'energy' ? 100 : 0;
    } else {
      player.hp = player.maxHp;
      player.resource = classDef.resourceType === 'mana' ? player.maxResource
        : classDef.resourceType === 'energy' ? 100 : 0;
    }
    player.swingTimer = 0;
    return player.id;
  }

  removePlayer(pid: number): void {
    const meta = this.players.get(pid);
    if (!meta) return;
    // leave social systems cleanly
    this.removeFromParty(pid, 'has left the party');
    const trade = this.trades.get(pid);
    if (trade) this.tradeCancel(pid);
    const duel = this.duels.get(pid);
    if (duel) this.endDuel(duel, duel.a === pid ? duel.b : duel.a);
    // arena: leaving the queue is free; disconnecting mid-bout forfeits it
    this.arenaDequeue(pid);
    const match = this.arenaMatches.get(pid);
    if (match) this.endArenaMatch(match, match.a === pid ? match.b : match.a, 'forfeit');
    this.partyInvites.delete(pid);
    this.tradeInvites.delete(pid);
    this.duelInvites.delete(pid);
    // a leaving player's pet goes wild, and mobs forget the player entirely
    const pet = this.petOf(pid);
    if (pet) this.releasePetToWild(pet);
    for (const m of this.entities.values()) {
      if (m.kind !== 'mob') continue;
      m.threat.delete(pid);
      if (m.forcedTargetId === pid) {
        m.forcedTargetId = null;
        m.forcedTargetTimer = 0;
      }
      if (m.aggroTargetId === pid) {
        m.aggroTargetId = null;
        if (!m.dead && m.aiState !== 'dead' && m.ownerId === null) this.retargetMob(m);
      }
      if (m.tappedById === pid && !m.dead) m.tappedById = null;
    }
    for (const other of this.players.values()) {
      const e = this.entities.get(other.entityId);
      if (e && e.targetId === pid) e.targetId = null;
    }
    this.dropEntity(pid);
    this.players.delete(pid);
    this.chatTokens.delete(pid);
    if (this.primaryId === pid) this.primaryId = this.players.size > 0 ? [...this.players.keys()][0] : -1;
  }

  serializeCharacter(pid: number): CharacterState | null {
    const meta = this.players.get(pid);
    const e = this.entities.get(pid);
    if (!meta || !e) return null;
    return {
      level: e.level,
      xp: meta.xp,
      copper: meta.copper,
      hp: e.hp,
      resource: e.resource,
      pos: { x: e.pos.x, z: e.pos.z },
      facing: e.facing,
      equipment: { ...meta.equipment },
      inventory: meta.inventory.map((i) => ({ ...i })),
      vendorBuyback: meta.vendorBuyback.map((i) => ({ ...i })),
      questLog: [...meta.questLog.values()].map((q) => ({ questId: q.questId, counts: [...q.counts], state: q.state })),
      questsDone: [...meta.questsDone],
      arenaRating: meta.arenaRating,
      arenaWins: meta.arenaWins,
      arenaLosses: meta.arenaLosses,
    };
  }

  // -------------------------------------------------------------------------
  // Back-compat accessors: single-player contexts (offline game, RL env, tests)
  // address "the" player; these delegate to the primary player.
  // -------------------------------------------------------------------------

  get playerId(): number {
    return this.primaryId;
  }
  get player(): Entity {
    return this.entities.get(this.primaryId)!;
  }
  private get primary(): PlayerMeta {
    return this.players.get(this.primaryId)!;
  }
  get moveInput(): MoveInput {
    return this.primary.moveInput;
  }
  get inventory(): InvSlot[] {
    return this.primary.inventory;
  }
  get vendorBuyback(): InvSlot[] {
    return this.primary.vendorBuyback;
  }
  get equipment(): PlayerEquipment {
    return this.primary.equipment;
  }
  get copper(): number {
    return this.primary.copper;
  }
  set copper(v: number) {
    this.primary.copper = v;
  }
  get xp(): number {
    return this.primary.xp;
  }
  set xp(v: number) {
    this.primary.xp = v;
  }
  get known(): ResolvedAbility[] {
    return this.primary.known;
  }
  get questLog(): Map<string, QuestProgress> {
    return this.primary.questLog;
  }
  get questsDone(): Set<string> {
    return this.primary.questsDone;
  }
  get counters(): RewardCounters {
    return this.primary.counters;
  }

  meta(pid: number): PlayerMeta | null {
    return this.players.get(pid) ?? null;
  }

  private resolve(pid?: number): { meta: PlayerMeta; e: Entity } | null {
    const id = pid ?? this.primaryId;
    const meta = this.players.get(id);
    const e = this.entities.get(id);
    if (!meta || !e) return null;
    return { meta, e };
  }

  playerGcdFor(cls: PlayerClass): number {
    return cls === 'rogue' ? 1.0 : GCD; // rogue GCD is 1.0 sec
  }
  get playerGcd(): number {
    return this.playerGcdFor(this.primary.cls);
  }

  groundPos(x: number, z: number): Vec3 {
    return { x, y: groundHeight(x, z, this.cfg.seed), z };
  }

  // Deterministic outward spiral to the nearest spot that is on dry-enough
  // ground and not inside a building/prop. Keeps NPCs out of houses and lakes.
  findSafePos(x: number, z: number, minHeight: number): { x: number; z: number } {
    const seed = this.cfg.seed;
    const ok = (px: number, pz: number): boolean => {
      if (groundHeight(px, pz, seed) < minHeight) return false;
      const res = resolvePosition(seed, px, pz, 0.6);
      return Math.abs(res.x - px) < 1e-4 && Math.abs(res.z - pz) < 1e-4;
    };
    if (ok(x, z)) return { x, z };
    const GOLDEN = 2.39996; // radians; even angular coverage
    for (let i = 1; i <= 80; i++) {
      const r = 0.9 * Math.sqrt(i) * 2.2;
      const a = i * GOLDEN;
      const px = x + Math.sin(a) * r;
      const pz = z + Math.cos(a) * r;
      if (ok(px, pz)) return { x: px, z: pz };
    }
    return { x, z };
  }

  emit(ev: SimEvent): void {
    this.events.push(ev);
  }

  private refreshKnownAbilities(meta: PlayerMeta, announce: boolean): void {
    const e = this.entities.get(meta.entityId);
    if (!e) return;
    const before = new Map(meta.known.map((k) => [k.def.id, k.rank]));
    meta.known = abilitiesKnownAt(meta.cls, e.level);
    if (announce) {
      for (const k of meta.known) {
        const prev = before.get(k.def.id);
        if (prev === undefined || prev < k.rank) {
          this.emit({ type: 'learnAbility', abilityId: k.def.id, rank: k.rank, pid: meta.entityId });
          this.emit({
            type: 'log',
            pid: meta.entityId,
            text: prev === undefined
              ? `You have learned a new ability: ${k.def.name}.`
              : `Your ${k.def.name} has improved to Rank ${k.rank}.`,
            color: '#ffd100',
          });
        }
      }
    }
  }

  // Mark a player as a GM: invulnerable (see dealDamage). Server-side only —
  // set at join time from the characters.is_gm column.
  setGm(pid?: number): void {
    const r = this.resolve(pid);
    if (r) r.e.gm = true;
  }

  // Dev/test convenience: jump a player to a level (learns abilities, recalcs stats).
  setPlayerLevel(level: number, pid?: number): void {
    const r = this.resolve(pid);
    if (!r) return;
    r.e.level = Math.max(1, Math.min(MAX_LEVEL, level));
    recalcPlayerStats(r.e, r.meta.cls, r.meta.equipment);
    r.e.hp = r.e.maxHp;
    if (r.e.resourceType === 'mana') r.e.resource = r.e.maxResource;
    this.refreshKnownAbilities(r.meta, false);
  }

  resolvedAbility(abilityId: string, pid?: number): ResolvedAbility | null {
    const r = this.resolve(pid);
    if (!r) return null;
    return r.meta.known.find((k) => k.def.id === abilityId) ?? null;
  }

  // -------------------------------------------------------------------------
  // Main tick
  // -------------------------------------------------------------------------

  tick(): SimEvent[] {
    this.time += DT;
    this.tickCount++;

    for (const e of this.entities.values()) {
      copyPos(e.prevPos, e.pos);
      e.prevFacing = e.facing;
    }

    for (const meta of this.players.values()) {
      const p = this.entities.get(meta.entityId);
      if (!p) continue;
      if (!p.dead) {
        this.updatePlayerMovement(p, meta);
        this.updateDoorTriggers(p);
        this.updateCasting(p, meta);
        this.updatePlayerAutoAttack(p, meta);
        this.updateRegen(p, meta);
      }
      this.updateTimers(p);
      this.updateAuras(p);
    }

    for (const e of this.entities.values()) {
      if (e.kind === 'mob') {
        this.updateMob(e);
        this.updateAuras(e);
      } else if (e.kind === 'npc') {
        this.cleanseFriendlyNpcAuras(e);
      } else if (e.kind === 'object') {
        if (!e.lootable) {
          e.respawnTimer -= DT;
          if (e.respawnTimer <= 0) e.lootable = true;
        }
      }
    }

    // one pass over the entities collects every player a mob is engaged
    // with, instead of one full scan per player
    this.engagedPids.clear();
    for (const e of this.entities.values()) {
      if (e.kind === 'mob' && !e.dead && (e.aiState === 'chase' || e.aiState === 'attack') && e.aggroTargetId !== null) {
        this.engagedPids.add(e.aggroTargetId);
      }
    }
    for (const meta of this.players.values()) {
      const p = this.entities.get(meta.entityId);
      if (p) p.inCombat = this.engagedPids.has(p.id) || p.combatTimer < 5;
    }

    this.updateDuels();
    this.updateArena();
    this.updateTradesAndInvites();
    this.updateInstances();
    this.updateMarket();

    // movement re-bucketing: queries during the next tick and the server's
    // snapshot broadcast right after this one see fresh cells
    this.grid.refresh(this.entities.values());
    this.playerGrid.refresh(this.playerEntities());

    const out = this.events;
    this.events = [];
    return out;
  }

  private *playerEntities(): Iterable<Entity> {
    for (const meta of this.players.values()) {
      const e = this.entities.get(meta.entityId);
      if (e) yield e;
    }
  }

  // -------------------------------------------------------------------------
  // Player movement
  // -------------------------------------------------------------------------

  private isStunned(e: Entity): boolean {
    return e.auras.some((a) => a.kind === 'stun' || a.kind === 'incapacitate' || a.kind === 'polymorph');
  }
  private isRooted(e: Entity): boolean {
    return this.isStunned(e) || e.auras.some((a) => a.kind === 'root');
  }
  private mobCanSwim(template: { family?: string; canSwim?: boolean } | undefined): boolean {
    return !!template && (template.canSwim === true || template.family === 'murloc');
  }
  private isControlAura(kind: AuraKind): boolean {
    return kind === 'stun' || kind === 'root' || kind === 'incapacitate' || kind === 'polymorph';
  }
  private itemRequiresGroupRoll(itemId: string): boolean {
    const q = ITEMS[itemId]?.quality ?? 'common';
    return q === 'uncommon' || q === 'rare' || q === 'epic';
  }
  private moveSpeedMult(e: Entity): number {
    let slow = 1, speed = 1;
    for (const a of e.auras) {
      if (a.kind === 'slow' || a.kind === 'stealth') slow = Math.min(slow, a.value);
      if (a.kind === 'buff_speed') speed = Math.max(speed, a.value);
    }
    return slow * speed;
  }

  // Sunder Armor stacks shave flat armor off the defender for physical hits.
  private effectiveArmor(e: Entity): number {
    let armor = e.stats.armor;
    for (const a of e.auras) {
      if (e.kind !== 'player' && a.kind === 'buff_armor') armor += a.value;
      if (a.kind === 'sunder') armor -= a.value * (a.stacks ?? 1);
    }
    return Math.max(0, armor);
  }

  private effectiveAttackPower(e: Entity): number {
    let attackPower = e.attackPower;
    if (e.kind !== 'player') {
      for (const a of e.auras) {
        if (a.kind === 'buff_ap') attackPower += a.value;
      }
    }
    return attackPower;
  }

  private nonPlayerAuraHp(aura: Aura): number {
    if (aura.kind === 'buff_sta') return aura.value * 10;
    if (aura.kind === 'buff_allstats') return aura.value * 10;
    return 0;
  }

  private applyNonPlayerStatAura(target: Entity, aura: Aura, direction: 1 | -1): void {
    if (target.kind === 'player') return;
    const hpDelta = this.nonPlayerAuraHp(aura) * direction;
    if (hpDelta === 0) return;
    const hpFrac = target.maxHp > 0 ? target.hp / target.maxHp : 1;
    target.maxHp = Math.max(1, target.maxHp + hpDelta);
    target.hp = target.dead ? 0 : Math.max(1, Math.min(target.maxHp, Math.round(target.maxHp * hpFrac)));
  }

  private clearNonPlayerStatAuras(target: Entity): void {
    if (target.kind === 'player') return;
    for (const aura of target.auras) this.applyNonPlayerStatAura(target, aura, -1);
  }

  // swing interval multiplier: >1 = slower (thunder clap), haste divides
  private swingIntervalMult(e: Entity): number {
    let m = 1;
    for (const a of e.auras) {
      if (a.kind === 'attackspeed') m *= a.value;
      if (a.kind === 'buff_haste') m /= a.value;
    }
    return m;
  }

  isSwimming(e: Entity): boolean {
    return groundHeight(e.pos.x, e.pos.z, this.cfg.seed) < WATER_LEVEL - SWIM_DEPTH
      && e.pos.y <= SWIM_SURFACE_Y + 0.15;
  }

  private findChargePath(p: Entity, target: Entity): Vec3[] {
    return findPath(p.pos, target.pos, {
      seed: this.cfg.seed,
      bodyRadius: BODY_RADIUS,
      maxClimbSlope: MAX_CLIMB_SLOPE,
      minGround: WATER_LEVEL - SWIM_DEPTH,
    }).map((w) => ({ x: w.x, y: 0, z: w.z }));
  }

  // Charge in flight: forced movement toward the target along the pathfound
  // route. Returns true while it owns the player's movement this tick.
  private updateChargeMovement(p: Entity): boolean {
    if (p.chargeTargetId === null) return false;
    const target = this.entities.get(p.chargeTargetId);
    p.chargeTimeLeft -= DT;
    const done = (arrived: boolean): boolean => {
      p.chargeTargetId = null;
      p.chargePath = [];
      if (target) p.facing = angleTo(p.pos, target.pos);
      if (arrived) this.startAutoAttack(p.id);
      return true;
    };
    if (!target || target.dead || p.chargeTimeLeft <= 0 || this.isRooted(p)) return done(false);
    if (dist2d(p.pos, target.pos) <= CHARGE_ARRIVE_RANGE) return done(true);
    if (p.sitting) this.standUp(p);
    // re-route when the target has run well away from where the path ends
    const pathEnd = p.chargePath[p.chargePath.length - 1];
    if (!pathEnd || dist2d(pathEnd, target.pos) > 4) p.chargePath = this.findChargePath(p, target);
    // steer at the next waypoint; the final leg homes on the live target
    while (p.chargePath.length > 1 && dist2d(p.pos, p.chargePath[0]) < 1) p.chargePath.shift();
    const wp = p.chargePath.length > 1 ? p.chargePath[0] : target.pos;
    p.facing = angleTo(p.pos, wp);
    const step = Math.min(RUN_SPEED * CHARGE_SPEED_MULT * DT, Math.max(0.01, dist2d(p.pos, wp)));
    const nx = p.pos.x + Math.sin(p.facing) * step;
    const nz = p.pos.z + Math.cos(p.facing) * step;
    // deep water and cliffs end the charge early rather than dragging the player in
    const h0 = groundHeight(p.pos.x, p.pos.z, this.cfg.seed);
    const h1 = groundHeight(nx, nz, this.cfg.seed);
    if (h1 < WATER_LEVEL - SWIM_DEPTH) return done(false);
    if (h1 > h0 && (h1 - h0) / step > MAX_CLIMB_SLOPE) return done(false);
    const resolved = resolvePosition(this.cfg.seed, nx, nz, BODY_RADIUS);
    p.pos.x = resolved.x;
    p.pos.z = resolved.z;
    p.pos.y = groundHeight(resolved.x, resolved.z, this.cfg.seed);
    p.vy = 0;
    p.onGround = true;
    p.fallStartY = p.pos.y;
    return true;
  }

  private updatePlayerMovement(p: Entity, meta: PlayerMeta): void {
    if (this.updateChargeMovement(p)) return;
    const inp = meta.moveInput;
    // Convention: facing f points along (sin f, cos f); the camera sits behind
    // the player, so screen-right is the world vector (-cos f, sin f).
    // Turning right therefore DECREASES facing.
    if (!this.isStunned(p)) {
      if (inp.turnLeft) p.facing = normAngle(p.facing + TURN_SPEED * DT);
      if (inp.turnRight) p.facing = normAngle(p.facing - TURN_SPEED * DT);
    }

    let mx = 0, mz = 0; // local: z forward, x strafe-right
    if (inp.forward) mz += 1;
    if (inp.back) mz -= 1;
    if (inp.strafeLeft) mx -= 1;
    if (inp.strafeRight) mx += 1;

    const wantsMove = mx !== 0 || mz !== 0 || inp.jump;
    if (wantsMove && p.sitting) this.standUp(p);

    const moving = (mx !== 0 || mz !== 0) && !this.isRooted(p);
    const swimming = this.isSwimming(p);
    if (moving) {
      if (p.castingAbility) this.cancelCast(p);
      const len = Math.hypot(mx, mz);
      mx /= len; mz /= len;
      let speed = RUN_SPEED * this.moveSpeedMult(p);
      if (mz < 0) speed *= BACKPEDAL_MULT;
      if (swimming) speed *= SWIM_SPEED_MULT;
      // world = forward * mz + right * mx, with right = (-cos f, sin f)
      const sin = Math.sin(p.facing), cos = Math.cos(p.facing);
      const wx = mz * sin - mx * cos;
      const wz = mz * cos + mx * sin;
      let nx = p.pos.x + wx * speed * DT;
      let nz = p.pos.z + wz * speed * DT;
      // cliffs and the world rim are walls, not ramps
      if (p.onGround && !swimming) {
        const h0 = groundHeight(p.pos.x, p.pos.z, this.cfg.seed);
        const h1 = groundHeight(nx, nz, this.cfg.seed);
        const run = Math.hypot(nx - p.pos.x, nz - p.pos.z);
        if (h1 > h0 && run > 1e-5 && (h1 - h0) / run > MAX_CLIMB_SLOPE) {
          nx = p.pos.x;
          nz = p.pos.z;
        }
      }
      // slide along buildings, trees, crypt walls
      const resolved = resolvePosition(this.cfg.seed, nx, nz, BODY_RADIUS);
      p.pos.x = resolved.x;
      p.pos.z = resolved.z;
    }

    // Vertical: jumping, gravity, swimming, fall damage
    const ground = groundHeight(p.pos.x, p.pos.z, this.cfg.seed);
    const deepWater = ground < WATER_LEVEL - SWIM_DEPTH;
    if (deepWater && p.pos.y <= SWIM_SURFACE_Y + 0.05) {
      // treading water at the surface
      p.pos.y = SWIM_SURFACE_Y;
      p.vy = 0;
      p.onGround = true;
      p.fallStartY = p.pos.y;
      if (inp.jump && !this.isRooted(p)) {
        // small hop to climb onto shores and docks
        p.vy = JUMP_VELOCITY * 0.7;
        p.onGround = false;
      }
      return;
    }
    if (inp.jump && p.onGround && !this.isRooted(p)) {
      p.vy = JUMP_VELOCITY;
      p.onGround = false;
      p.fallStartY = p.pos.y;
    }
    if (!p.onGround) {
      p.vy -= GRAVITY * DT;
      p.pos.y += p.vy * DT;
      p.fallStartY = Math.max(p.fallStartY, p.pos.y);
      if (deepWater && p.pos.y <= SWIM_SURFACE_Y) {
        // splashing into deep water breaks the fall
        p.pos.y = SWIM_SURFACE_Y;
        p.vy = 0;
        p.onGround = true;
        p.fallStartY = p.pos.y;
        return;
      }
      if (p.pos.y <= ground) {
        p.pos.y = ground;
        p.vy = 0;
        p.onGround = true;
        const drop = p.fallStartY - ground;
        if (drop > FALL_SAFE_DISTANCE) {
          const dmg = Math.round(p.maxHp * (drop - FALL_SAFE_DISTANCE) * 0.07);
          if (dmg > 0) this.dealDamage(null, p, dmg, false, 'physical', 'Falling', 'hit', true);
        }
        p.fallStartY = ground;
      }
    } else {
      if (ground < p.pos.y - 0.4) {
        p.onGround = false;
        p.vy = 0;
        p.fallStartY = p.pos.y;
      } else {
        p.pos.y = ground;
        p.fallStartY = ground;
      }
    }
  }

  private standUp(p: Entity): void {
    p.sitting = false;
    if (isConsuming(p)) {
      p.eating = null;
      p.drinking = null;
      this.emit({ type: 'log', text: 'You stand up.', color: '#999', pid: p.id });
    }
  }

  // -------------------------------------------------------------------------
  // Regen, timers, auras
  // -------------------------------------------------------------------------

  private updateRegen(p: Entity, meta: PlayerMeta): void {
    if (this.tickCount % 40 !== 0) return; // every 2 seconds (the classic tick)
    if (p.resourceType === 'mana') {
      if (p.fiveSecondRule >= 5) {
        // out-of-combat mana regen: faster than before and scales with spirit
        // (gear/level) plus a small flat per-level floor so low-spirit casters
        // still recover at a reasonable pace (#103)
        const regen = p.stats.spi / 3 + 4 + Math.floor(p.level / 5);
        p.resource = Math.min(p.maxResource, p.resource + Math.round(regen));
      }
    } else if (p.resourceType === 'energy') {
      p.resource = Math.min(p.maxResource, p.resource + 20);
    } else if (p.resourceType === 'rage' && !p.inCombat) {
      p.resource = Math.max(0, p.resource - 2);
    }
    if (!p.inCombat && p.hp < p.maxHp && !p.eating) {
      const regen = p.stats.sta * 0.3 + 2;
      p.hp = Math.min(p.maxHp, p.hp + Math.round(regen));
    }
    // food and drink tick independently, so both can run at once
    for (const slot of ['eating', 'drinking'] as const) {
      const c = p[slot];
      if (!c) continue;
      if (c.hpPer2s > 0 && p.hp < p.maxHp) {
        const heal = Math.min(c.hpPer2s, p.maxHp - p.hp);
        p.hp += heal;
        this.emit({ type: 'heal', targetId: p.id, amount: heal });
      }
      if (c.manaPer2s > 0 && p.resourceType === 'mana') {
        p.resource = Math.min(p.maxResource, p.resource + c.manaPer2s);
      }
      c.remaining -= 2;
      if (c.remaining <= 0) p[slot] = null;
    }
  }

  private updateTimers(p: Entity): void {
    p.gcdRemaining = Math.max(0, p.gcdRemaining - DT);
    p.fiveSecondRule += DT;
    p.combatTimer += DT;
    for (const [k, v] of p.cooldowns) {
      const nv = v - DT;
      if (nv <= 0) p.cooldowns.delete(k);
      else p.cooldowns.set(k, nv);
    }
  }

  private cleanseFriendlyNpcAuras(e: Entity): void {
    for (let i = e.auras.length - 1; i >= 0; i--) {
      const aura = e.auras[i];
      if (!isRejectedFriendlyNpcAura(aura)) continue;
      e.auras.splice(i, 1);
      this.emit({ type: 'aura', targetId: e.id, name: aura.name, gained: false });
    }
  }

  private updateAuras(e: Entity): void {
    if (e.dead) return;
    let statsDirty = false;
    for (let i = e.auras.length - 1; i >= 0; i--) {
      const a = e.auras[i];
      a.remaining -= DT;
      if (a.tickInterval) {
        a.tickTimer = (a.tickTimer ?? a.tickInterval) - DT;
        if (a.tickTimer <= 0) {
          a.tickTimer += a.tickInterval;
          if (a.kind === 'dot') {
            this.emit({ type: 'spellfx', sourceId: a.sourceId, targetId: e.id, school: a.school, fx: 'tick' });
            this.dealDamage(this.entities.get(a.sourceId) ?? null, e, a.value, false, a.school, a.name, 'hit', true);
            if (e.dead) return;
          } else if (a.kind === 'hot') {
            const healed = Math.min(a.value, e.maxHp - e.hp);
            if (healed > 0) {
              e.hp += healed;
              this.emit({ type: 'heal2', sourceId: a.sourceId, targetId: e.id, amount: healed, crit: false, ability: a.name });
              const src = this.entities.get(a.sourceId);
              if (src) this.healingThreat(src, e, healed);
            }
          } else if (a.kind === 'polymorph') {
            const heal = Math.round(e.maxHp * 0.10);
            e.hp = Math.min(e.maxHp, e.hp + heal);
          }
        }
      }
      if (a.remaining <= 0) {
        e.auras.splice(i, 1);
        this.applyNonPlayerStatAura(e, a, -1);
        this.emit({ type: 'aura', targetId: e.id, name: a.name, gained: false });
        if (a.kind.startsWith('buff') || a.kind.startsWith('form')) statsDirty = true;
      }
    }
    if (statsDirty && e.kind === 'player') {
      const meta = this.players.get(e.id);
      if (meta) recalcPlayerStats(e, meta.cls, meta.equipment);
    }
  }

  // -------------------------------------------------------------------------
  // Casting, channeling & abilities
  // -------------------------------------------------------------------------

  private updateCasting(p: Entity, meta: PlayerMeta): void {
    if (!p.castingAbility) return;
    if (this.isStunned(p)) { this.cancelCast(p); return; }
    p.castRemaining -= DT;

    if (p.channeling) {
      p.channelTickTimer -= DT;
      if (p.channelTickTimer <= 0) {
        p.channelTickTimer += p.channelTickEvery;
        const res = this.resolvedAbility(p.castingAbility, p.id);
        if (res) this.applyChannelTick(p, res);
      }
      if (p.castRemaining <= 0) {
        p.castingAbility = null;
        p.channeling = false;
        this.emit({ type: 'castStop', entityId: p.id, success: true });
      }
      return;
    }

    if (p.castRemaining <= 0) {
      const castId = p.castingAbility;
      p.castingAbility = null;
      p.castRemaining = 0;
      this.emit({ type: 'castStop', entityId: p.id, success: true });
      if (castId === FISHING_CAST_ID) {
        this.completeFishing(p, meta);
        return;
      }
      const res = this.resolvedAbility(castId, p.id);
      if (res) this.applyAbility(p, meta, res);
    }
  }

  private cancelCast(p: Entity): void {
    p.castingAbility = null;
    p.castRemaining = 0;
    p.channeling = false;
    this.emit({ type: 'castStop', entityId: p.id, success: false });
  }

  private pushbackCast(p: Entity): void {
    if (p.channeling) {
      p.castRemaining = Math.max(0, p.castRemaining - p.castTotal * CHANNEL_PUSHBACK_FRACTION);
    } else {
      p.castRemaining += CAST_PUSHBACK_SEC;
      p.castTotal += CAST_PUSHBACK_SEC;
    }
  }

  castAbilityBySlot(slot: number, pid?: number): void {
    const r = this.resolve(pid);
    if (!r) return;
    const known = r.meta.known[slot];
    if (known) this.castAbility(known.def.id, pid);
  }

  castAbility(abilityId: string, pid?: number): void {
    const r = this.resolve(pid);
    if (!r) return;
    const { meta, e: p } = r;
    const res = this.resolvedAbility(abilityId, p.id);
    if (!res || p.dead) return;
    const ability = res.def;
    if (this.isStunned(p)) { this.error(p.id, 'You are stunned!'); return; }
    if (p.castingAbility) { this.error(p.id, 'You are busy.'); return; }
    if (!ability.offGcd && p.gcdRemaining > 0) return; // silent, classic spams this
    const togglingOff = isToggleBuff(ability) && p.auras.some((a) => a.id === ability.id);
    if (p.cooldowns.has(ability.id) && !togglingOff) { this.error(p.id, 'That ability is not ready yet.'); return; }
    // shifting out of a form is free; shifting across forms bills the parked
    // mana (the live bar is rage/energy in a form) — see spendAbilityCost
    if (p.resource < res.cost && !togglingOff && !this.formShiftKind(p, ability)) {
      this.error(p.id, p.resourceType === 'rage' ? 'Not enough rage!' : p.resourceType === 'energy' ? 'Not enough energy!' : 'Not enough mana!');
      return;
    }
    if (ability.requiresDodgeProc && this.time > p.overpowerUntil) {
      this.error(p.id, 'Your target must dodge first.');
      return;
    }
    if (ability.spendsCombo && (p.comboPoints <= 0 || p.comboTargetId !== p.targetId)) {
      this.error(p.id, 'That ability requires combo points.');
      return;
    }
    // druid forms gate their kit both ways: form abilities need the form, and
    // everything else (the caster kit) is locked while shapeshifted
    const form = p.auras.find((a) => a.kind === 'form_bear' || a.kind === 'form_cat');
    if (ability.requiresForm) {
      const need = ability.requiresForm === 'bear' ? 'form_bear' : 'form_cat';
      if (!form || form.kind !== need) {
        this.error(p.id, `You must be in ${ability.requiresForm === 'bear' ? 'Bear' : 'Cat'} Form.`);
        return;
      }
    } else if (form && !isFormToggle(ability)) {
      this.error(p.id, "You can't do that while shapeshifted.");
      return;
    }
    if (ability.requiresStealth && !p.auras.some((a) => a.kind === 'stealth')) {
      this.error(p.id, 'You must be stealthed.');
      return;
    }
    if (ability.requiresOutOfCombat && p.inCombat) {
      this.error(p.id, "You can't do that while in combat.");
      return;
    }

    let target: Entity | null = null;
    if (ability.requiresTarget && ability.targetType === 'friendly') {
      // heals/buffs: current friendly target, else yourself
      const cur = p.targetId !== null ? this.entities.get(p.targetId) ?? null : null;
      target = cur && !cur.dead && this.isFriendlyTo(p, cur) ? cur : p;
      const d = dist2d(p.pos, target.pos);
      if (d > Math.max(ability.range, 5)) { this.error(p.id, 'Out of range.'); return; }
    } else if (ability.requiresTarget) {
      target = p.targetId !== null ? this.entities.get(p.targetId) ?? null : null;
      if (!target || target.dead || !this.isHostileTo(p, target)) { this.error(p.id, 'You have no target.'); return; }
      const d = dist2d(p.pos, target.pos);
      const maxRange = ability.range > 0 ? ability.range : MELEE_RANGE;
      if (d > maxRange) { this.error(p.id, 'Out of range.'); return; }
      if (ability.minRange && d < ability.minRange) { this.error(p.id, 'Too close!'); return; }
      const facingDiff = Math.abs(normAngle(angleTo(p.pos, target.pos) - p.facing));
      if (facingDiff > MELEE_ARC) { this.error(p.id, 'You must be facing your target.'); return; }
      // execute-style gate: only usable while the target is nearly dead
      if (ability.requiresTargetHpBelow !== undefined
        && target.hp > target.maxHp * ability.requiresTargetHpBelow) {
        this.error(p.id, `That ability requires the target below ${Math.round(ability.requiresTargetHpBelow * 100)}% health.`);
        return;
      }
      for (const eff of res.effects) {
        if (eff.type === 'weaponStrike' && eff.requiresBehind) {
          if (!p.weapon.dagger) { this.error(p.id, 'You must wield a dagger.'); return; }
          const behindDiff = Math.abs(normAngle(angleTo(target.pos, p.pos) - target.facing));
          if (behindDiff < Math.PI / 2) { this.error(p.id, 'You must be behind your target.'); return; }
        }
        if (eff.type === 'polymorph') {
          if (target.kind !== 'mob') { this.error(p.id, 'This creature cannot be polymorphed.'); return; }
          const fam = MOBS[target.templateId]?.family;
          if (fam === 'undead' || target.templateId === 'gorrak') { this.error(p.id, 'This creature cannot be polymorphed.'); return; }
        }
        if (eff.type === 'judgement' && !p.auras.some((a) => a.kind === 'imbue' && a.value2 !== undefined)) {
          this.error(p.id, 'You have no active Seal.');
          return;
        }
        if (eff.type === 'taunt' && target.kind !== 'mob') {
          this.error(p.id, 'You cannot taunt that.');
          return;
        }
        if (eff.type === 'tamePet') {
          const err = this.tameError(p, target);
          if (err) { this.error(p.id, err); return; }
        }
      }
    }
    if (p.sitting) this.standUp(p);

    // Heroic-strike style: queue on next swing, pay cost on the swing itself.
    if (ability.onNextSwing) {
      p.queuedOnSwing = p.queuedOnSwing === ability.id ? null : ability.id;
      if (!p.autoAttack && target) this.startAutoAttack(p.id);
      return;
    }

    const gcd = this.playerGcdFor(meta.cls);

    if (ability.channel) {
      this.spendResource(p, res.cost);
      if (ability.cooldown > 0) p.cooldowns.set(ability.id, ability.cooldown);
      p.castingAbility = ability.id;
      p.castTotal = ability.channel.duration;
      p.castRemaining = ability.channel.duration;
      p.channeling = true;
      p.channelTickEvery = ability.channel.duration / ability.channel.ticks;
      p.channelTickTimer = p.channelTickEvery;
      p.gcdRemaining = Math.max(p.gcdRemaining, gcd);
      this.emit({ type: 'castStart', entityId: p.id, ability: ability.id, time: ability.channel.duration });
      return;
    }

    if (res.castTime > 0) {
      p.castingAbility = ability.id;
      p.castTotal = res.castTime;
      p.castRemaining = res.castTime;
      p.gcdRemaining = Math.max(p.gcdRemaining, gcd);
      this.emit({ type: 'castStart', entityId: p.id, ability: ability.id, time: res.castTime });
      return;
    }

    if (!ability.offGcd) p.gcdRemaining = Math.max(p.gcdRemaining, gcd);
    this.applyAbility(p, meta, res);
  }

  private spendResource(p: Entity, cost: number): void {
    p.resource = Math.max(0, p.resource - cost);
    if (p.resourceType === 'mana' && cost > 0) p.fiveSecondRule = 0;
  }

  /** Is this cast a form toggle while already shapeshifted? 'off' = leaving
   *  the form (free, classic), 'cross' = bear<->cat (costs the parked mana). */
  private formShiftKind(p: Entity, ability: AbilityDef): 'off' | 'cross' | null {
    if (!isFormToggle(ability)) return null;
    if (p.auras.some((a) => a.id === ability.id)) return 'off';
    if (p.auras.some((a) => a.kind === 'form_bear' || a.kind === 'form_cat')) return 'cross';
    return null;
  }

  private spendAbilityCost(p: Entity, res: ResolvedAbility): void {
    const shift = this.formShiftKind(p, res.def);
    if (shift === 'off') return;
    if (shift === 'cross') {
      p.savedMana = Math.max(0, p.savedMana - res.cost);
      return;
    }
    this.spendResource(p, res.cost);
  }

  private applyChannelTick(p: Entity, res: ResolvedAbility): void {
    const target = p.targetId !== null ? this.entities.get(p.targetId) : null;
    if (!target || target.dead) { this.cancelCast(p); return; }
    this.emit({ type: 'spellfx', sourceId: p.id, targetId: target.id, school: res.def.school, fx: 'projectile' });
    for (const eff of res.effects) {
      if (eff.type === 'directDamage') {
        const crit = this.rng.chance(this.spellCrit(p));
        let dmg = this.rng.range(eff.min, eff.max);
        if (crit) dmg *= 1.5;
        this.dealDamage(p, target, Math.round(dmg), crit, res.def.school, res.def.name, 'hit');
      } else if (eff.type === 'drainTick') {
        const dmg = Math.round(this.rng.range(eff.min, eff.max));
        this.dealDamage(p, target, dmg, false, res.def.school, res.def.name, 'hit');
        if (!p.dead) {
          const healed = Math.min(Math.round(dmg * eff.healFrac), p.maxHp - p.hp);
          if (healed > 0) {
            p.hp += healed;
            this.emit({ type: 'heal2', sourceId: p.id, targetId: p.id, amount: healed, crit: false, ability: res.def.name });
            this.healingThreat(p, p, healed);
          }
        }
      }
    }
  }

  private spellCrit(p: Entity): number {
    return 0.05 + p.stats.int * 0.0008;
  }

  private applyHeal(source: Entity, target: Entity, amount: number, ability: string): void {
    if (target.dead) return;
    const crit = this.rng.chance(this.spellCrit(source));
    let healed = Math.round(amount * (crit ? 1.5 : 1));
    healed = Math.min(healed, target.maxHp - target.hp);
    target.hp += healed;
    this.emit({ type: 'heal2', sourceId: source.id, targetId: target.id, amount: healed, crit, ability });
    this.healingThreat(source, target, healed);
  }

  // Classic healing threat: 0.5 per point of EFFECTIVE healing (overheal is
  // free), split evenly among every mob already fighting the healed target.
  // Party membership does not change threat; it only affects social systems.
  private healingThreat(source: Entity, target: Entity, healed: number): void {
    if (source.kind !== 'player' || healed <= 0) return;
    const total = healed * HEAL_THREAT_FACTOR * threatModifier(source, 'physical');
    const aware: Entity[] = [];
    for (const m of this.entities.values()) {
      if (m.kind !== 'mob' || m.dead || !m.hostile || !m.inCombat || m.threat.size === 0) continue;
      if (this.threatEntryMatchesEntity(m, target)) aware.push(m);
    }
    if (aware.length === 0) return;
    const per = total / aware.length;
    for (const m of aware) addThreat(m, source.id, per);
  }

  /** True when a hate-table entry belongs to the healed entity or its pet. */
  private threatEntryMatchesEntity(mob: Entity, e: Entity): boolean {
    if (mob.threat.has(e.id)) return true;
    if (e.kind !== 'player') return false;
    for (const id of mob.threat.keys()) {
      const entry = this.entities.get(id);
      if (entry?.ownerId === e.id) return true;
    }
    return false;
  }

  private applyAbility(p: Entity, meta: PlayerMeta, res: ResolvedAbility): void {
    const ability = res.def;
    if (ability.id === 'conjure_water') {
      this.spendResource(p, res.cost);
      // higher ranks conjure better water (falls back if the item isn't defined)
      const tiered = `conjured_water${res.rank}`;
      this.addItem(res.rank > 1 && ITEMS[tiered] ? tiered : 'conjured_water', 2, p.id);
      return;
    }

    let target: Entity | null = null;
    if (ability.requiresTarget && ability.targetType === 'friendly') {
      const cur = p.targetId !== null ? this.entities.get(p.targetId) ?? null : null;
      target = cur && !cur.dead && this.isFriendlyTo(p, cur) ? cur : p;
      if (dist2d(p.pos, target.pos) > Math.max(ability.range, 5) + 2) { this.error(p.id, 'Out of range.'); return; }
    } else if (ability.requiresTarget) {
      target = p.targetId !== null ? this.entities.get(p.targetId) ?? null : null;
      if (!target || target.dead) { this.error(p.id, 'You have no target.'); return; }
      const d = dist2d(p.pos, target.pos);
      const maxRange = ability.range > 0 ? ability.range : MELEE_RANGE;
      if (d > maxRange + 2) { this.error(p.id, 'Out of range.'); return; }
    }
    if (p.resource < res.cost && !this.formShiftKind(p, ability)) { this.error(p.id, 'Not enough ' + (p.resourceType ?? 'resource') + '!'); return; }

    // helpful spells never miss
    if (ability.targetType === 'friendly') {
      this.spendResource(p, res.cost);
      if (ability.cooldown > 0) p.cooldowns.set(ability.id, ability.cooldown);
      this.runEffects(p, meta, target, res);
      return;
    }

    if (target && ability.school !== 'physical') {
      this.spendResource(p, res.cost);
      if (ability.cooldown > 0) p.cooldowns.set(ability.id, ability.cooldown);
      this.emit({ type: 'spellfx', sourceId: p.id, targetId: target.id, school: ability.school, fx: 'projectile' });
      if (!this.rng.chance(spellHitChance(p.level, target.level))) {
        this.emit({ type: 'damage', sourceId: p.id, targetId: target.id, amount: 0, crit: false, school: ability.school, ability: ability.name, kind: 'miss' });
        this.enterCombat(p, target);
        return;
      }
      this.runEffects(p, meta, target, res);
      return;
    }

    this.spendAbilityCost(p, res);
    if (ability.cooldown > 0) p.cooldowns.set(ability.id, ability.cooldown);
    this.runEffects(p, meta, target, res);
  }

  private runEffects(p: Entity, meta: PlayerMeta, target: Entity | null, res: ResolvedAbility): void {
    const ability = res.def;
    const isSpell = ability.school !== 'physical';
    const spentCombo = ability.spendsCombo ? p.comboPoints : 0;
    let comboAwarded = false;
    // acting breaks stealth (the ambush itself still lands first inside the swing)
    if (ability.id !== 'stealth') this.breakStealth(p);
    const threatOpts = { flat: res.threatFlat, mult: res.threatMult };

    for (const eff of res.effects) {
      switch (eff.type) {
        case 'weaponStrike': {
          if (!target) break;
          const hit = this.meleeSwing(p, target, eff.bonus, ability.name, {
            cannotBeDodged: eff.cannotBeDodged,
            weaponMult: eff.weaponMult ?? 1,
            threatFlat: res.threatFlat,
            threatMult: res.threatMult,
          });
          if (hit && ability.awardsCombo) { this.awardCombo(p, target, ability.awardsCombo); comboAwarded = true; }
          if (ability.requiresDodgeProc) p.overpowerUntil = -1;
          break;
        }
        case 'directDamage': {
          if (!target) break;
          const critChance = isSpell ? this.spellCrit(p) : p.critChance;
          let dmg = this.rng.range(eff.min, eff.max);
          const crit = this.rng.chance(critChance);
          if (crit) dmg *= isSpell ? 1.5 : 2;
          if (!isSpell) dmg *= 1 - armorReduction(this.effectiveArmor(target), p.level);
          this.dealDamage(p, target, Math.round(dmg), crit, ability.school, ability.name, 'hit', false, threatOpts);
          if (!target.dead && ability.awardsCombo && !comboAwarded) {
            this.awardCombo(p, target, ability.awardsCombo);
            comboAwarded = true;
          }
          break;
        }
        case 'finisherDamage': {
          if (!target || spentCombo <= 0) break;
          let dmg = eff.base + eff.perCombo * spentCombo + this.rng.range(0, eff.variance) + (this.effectiveAttackPower(p) / 14);
          const crit = this.rng.chance(p.critChance);
          if (crit) dmg *= 2;
          dmg *= 1 - armorReduction(this.effectiveArmor(target), p.level);
          this.dealDamage(p, target, Math.round(dmg), crit, 'physical', ability.name, 'hit', false, threatOpts);
          break;
        }
        case 'finisherHaste': {
          if (spentCombo <= 0) break;
          this.applyAura(p, {
            id: ability.id, name: ability.name, kind: 'buff_haste',
            remaining: eff.basedur + eff.perCombo * spentCombo,
            duration: eff.basedur + eff.perCombo * spentCombo,
            value: eff.mult, sourceId: p.id, school: 'physical',
          });
          break;
        }
        case 'finisherStun': {
          if (!target || target.dead || spentCombo <= 0) break;
          const dur = eff.base + eff.perCombo * spentCombo;
          this.applyAura(target, {
            id: ability.id + '_stun', name: ability.name, kind: 'stun',
            remaining: dur, duration: dur, value: 0,
            sourceId: p.id, school: ability.school,
          });
          this.enterCombat(p, target);
          break;
        }
        case 'weaponDamage':
          break;
        case 'heal': {
          const healTarget = target ?? p;
          this.applyHeal(p, healTarget, this.rng.range(eff.min, eff.max), ability.name);
          break;
        }
        case 'hot': {
          const hotTarget = target ?? p;
          this.applyAura(hotTarget, {
            id: ability.id, name: ability.name, kind: 'hot',
            remaining: eff.duration, duration: eff.duration,
            value: Math.max(1, Math.round(eff.total / (eff.duration / eff.interval))),
            tickInterval: eff.interval, tickTimer: eff.interval,
            sourceId: p.id, school: ability.school,
          });
          break;
        }
        case 'absorb': {
          const shieldTarget = target ?? p;
          this.applyAura(shieldTarget, {
            id: ability.id, name: ability.name, kind: 'absorb',
            remaining: eff.duration, duration: eff.duration, value: eff.amount,
            sourceId: p.id, school: ability.school,
          });
          break;
        }
        case 'imbue': {
          this.applyAura(p, {
            id: ability.id, name: ability.name, kind: 'imbue',
            remaining: eff.duration, duration: eff.duration, value: eff.bonus,
            value2: eff.judgeMin, value3: eff.judgeMax,
            sourceId: p.id, school: ability.school,
          });
          break;
        }
        case 'judgement': {
          if (!target) break;
          const sealIdx = p.auras.findIndex((a) => a.kind === 'imbue' && a.value2 !== undefined);
          if (sealIdx < 0) { this.error(p.id, 'You have no active Seal.'); break; }
          const seal = p.auras[sealIdx];
          p.auras.splice(sealIdx, 1);
          this.emit({ type: 'aura', targetId: p.id, name: seal.name, gained: false });
          let dmg = this.rng.range(seal.value2 ?? 10, seal.value3 ?? 15);
          const crit = this.rng.chance(this.spellCrit(p));
          if (crit) dmg *= 1.5;
          this.dealDamage(p, target, Math.round(dmg), crit, 'holy', ability.name, 'hit');
          break;
        }
        case 'lifeTap': {
          if (p.hp <= eff.hp) { this.error(p.id, 'Not enough health.'); break; }
          p.hp -= eff.hp;
          this.emit({ type: 'damage', sourceId: p.id, targetId: p.id, amount: eff.hp, crit: false, school: 'shadow', ability: ability.name, kind: 'hit' });
          p.resource = Math.min(p.maxResource, p.resource + eff.mana);
          break;
        }
        case 'drainTick':
          break; // handled per channel tick
        case 'buffTarget': {
          const buffTarget = target ?? p;
          this.applyAura(buffTarget, {
            id: ability.id, name: ability.name, kind: eff.kind,
            remaining: eff.duration, duration: eff.duration, value: eff.value,
            sourceId: p.id, school: ability.school,
          });
          break;
        }
        case 'dot': {
          if (!target || target.dead) break;
          this.applyAura(target, {
            id: ability.id, name: ability.name, kind: 'dot',
            remaining: eff.duration, duration: eff.duration,
            value: Math.max(1, Math.round(eff.total / (eff.duration / eff.interval))),
            tickInterval: eff.interval, tickTimer: eff.interval,
            sourceId: p.id, school: ability.school,
          });
          this.enterCombat(p, target);
          break;
        }
        case 'slow': {
          if (!target || target.dead) break;
          this.applyAura(target, {
            id: ability.id + '_slow', name: ability.name, kind: 'slow',
            remaining: eff.duration, duration: eff.duration, value: eff.mult,
            sourceId: p.id, school: ability.school,
          });
          this.enterCombat(p, target);
          break;
        }
        case 'root': {
          if (!target || target.dead) break;
          this.applyRootAura(p, target, ability.name, ability.id + '_root', eff.duration, ability.school);
          this.enterCombat(p, target);
          break;
        }
        case 'stun': {
          if (!target || target.dead) break;
          this.applyAura(target, {
            id: ability.id + '_stun', name: ability.name, kind: 'stun',
            remaining: eff.duration, duration: eff.duration, value: 0,
            sourceId: p.id, school: ability.school,
          });
          this.enterCombat(p, target);
          break;
        }
        case 'incapacitate': {
          if (!target || target.dead) break;
          this.applyAura(target, {
            id: ability.id + '_incap', name: ability.name, kind: 'incapacitate',
            remaining: eff.duration, duration: eff.duration, value: 0,
            sourceId: p.id, school: ability.school, breaksOnDamage: true,
          });
          if (ability.awardsCombo && !comboAwarded) { this.awardCombo(p, target, ability.awardsCombo); comboAwarded = true; }
          this.enterCombat(p, target);
          break;
        }
        case 'polymorph': {
          if (!target || target.dead) break;
          this.applyAura(target, {
            id: ability.id, name: ability.name, kind: 'polymorph',
            remaining: eff.duration, duration: eff.duration, value: 0,
            tickInterval: 1, tickTimer: 1,
            sourceId: p.id, school: ability.school, breaksOnDamage: true,
          });
          target.auras = target.auras.filter((a) => a.kind !== 'dot' || a.id === ability.id);
          this.enterCombat(p, target);
          break;
        }
        case 'aoeDamage': {
          this.emit({ type: 'spellfx', sourceId: p.id, targetId: p.id, school: ability.school, fx: 'nova' });
          for (const m of this.mobsInRadius(p.pos, eff.radius)) {
            let dmg = this.rng.range(eff.min, eff.max);
            dmg *= 1 - armorReduction(this.effectiveArmor(m), p.level);
            this.dealDamage(p, m, Math.round(dmg), false, ability.school, ability.name, 'hit', false, threatOpts);
          }
          break;
        }
        case 'aoeAttackSpeed': {
          for (const m of this.mobsInRadius(p.pos, eff.radius)) {
            if (m.dead) continue;
            this.applyAura(m, {
              id: ability.id + '_as', name: ability.name, kind: 'attackspeed',
              remaining: eff.duration, duration: eff.duration, value: eff.mult,
              sourceId: p.id, school: ability.school,
            });
          }
          break;
        }
        case 'aoeRoot': {
          this.emit({ type: 'spellfx', sourceId: p.id, targetId: p.id, school: ability.school, fx: 'nova' });
          for (const m of this.hostilesInRadius(p, p.pos, eff.radius)) {
            const dmg = this.rng.range(eff.min, eff.max);
            this.dealDamage(p, m, Math.round(dmg), false, ability.school, ability.name, 'hit');
            if (!m.dead && this.isHostileTo(p, m)) {
              this.applyRootAura(p, m, ability.name, ability.id + '_root', eff.duration, ability.school);
            }
          }
          break;
        }
        case 'selfBuff': {
          // forms, stances and stealth are toggles: casting again cancels
          const isToggle = eff.kind === 'form_bear' || eff.kind === 'form_cat'
            || eff.kind === 'defensive_stance' || eff.kind === 'stealth';
          if (isToggle) {
            const existing = p.auras.findIndex((a) => a.id === ability.id);
            if (existing >= 0) {
              p.auras.splice(existing, 1);
              this.emit({ type: 'aura', targetId: p.id, name: ability.name, gained: false });
              recalcPlayerStats(p, meta.cls, meta.equipment);
              break;
            }
          }
          // shapeshifting out of one form into the other
          if (eff.kind === 'form_bear' || eff.kind === 'form_cat') {
            for (let i = p.auras.length - 1; i >= 0; i--) {
              const a = p.auras[i];
              if ((a.kind === 'form_bear' || a.kind === 'form_cat') && a.kind !== eff.kind) {
                p.auras.splice(i, 1);
                this.emit({ type: 'aura', targetId: p.id, name: a.name, gained: false });
              }
            }
          }
          this.applyAura(p, {
            id: ability.id, name: ability.name, kind: eff.kind,
            remaining: eff.duration, duration: eff.duration, value: eff.value,
            sourceId: p.id, school: ability.school,
          });
          recalcPlayerStats(p, meta.cls, meta.equipment);
          break;
        }
        case 'gainResource': {
          p.resource = Math.min(p.maxResource, p.resource + eff.amount);
          break;
        }
        case 'selfDamagePctMax': {
          const dmg = Math.round(p.maxHp * eff.pct);
          p.hp = Math.max(1, p.hp - dmg);
          this.emit({ type: 'damage', sourceId: p.id, targetId: p.id, amount: dmg, crit: false, school: 'physical', ability: ability.name, kind: 'hit' });
          break;
        }
        case 'charge': {
          if (!target) break;
          // the stun effect in the same ability lands this tick; the player
          // then runs the route at charge speed instead of teleporting
          p.chargeTargetId = target.id;
          p.chargeTimeLeft = CHARGE_MAX_DURATION;
          p.chargePath = this.findChargePath(p, target);
          if (p.resourceType === 'rage') p.resource = Math.min(p.maxResource, p.resource + 9);
          this.enterCombat(p, target);
          break;
        }
        case 'sunder': {
          if (!target || target.dead) break;
          // a sunder can miss like any melee attack — a miss causes no threat
          if (this.rng.chance(meleeMissChance(p.level, target.level))) {
            this.emit({ type: 'damage', sourceId: p.id, targetId: target.id, amount: 0, crit: false, school: 'physical', ability: ability.name, kind: 'miss' });
            this.enterCombat(p, target);
            break;
          }
          const existing = target.auras.find((a) => a.kind === 'sunder');
          if (existing) {
            existing.stacks = Math.min(eff.maxStacks, (existing.stacks ?? 1) + 1);
            existing.value = eff.armor;
            existing.remaining = existing.duration;
            this.emit({ type: 'aura', targetId: target.id, name: ability.name, gained: true });
          } else {
            this.applyAura(target, {
              id: ability.id, name: ability.name, kind: 'sunder',
              remaining: 30, duration: 30, value: eff.armor, stacks: 1,
              sourceId: p.id, school: 'physical',
            });
          }
          // sunder deals no damage: its threat is the flat value, stance-scaled
          addThreat(target, p.id, res.threatFlat * threatModifier(p, 'physical'));
          this.enterCombat(p, target);
          break;
        }
        case 'taunt': {
          if (!target || target.kind !== 'mob' || target.dead) break;
          this.applyTaunt(p, target);
          break;
        }
        case 'tamePet': {
          if (target) this.completeTame(p, target);
          break;
        }
        case 'dismissPet': {
          const pet = this.petOf(p.id);
          if (!pet) { this.error(p.id, 'You have no pet.'); break; }
          this.emit({ type: 'log', text: `You dismiss ${pet.name}.`, color: '#999', pid: p.id });
          this.releasePetToWild(pet);
          break;
        }
      }
      if (target?.dead) target = null;
    }

    if (ability.spendsCombo && spentCombo > 0) {
      p.comboPoints = 0;
      this.emit({ type: 'comboPoint', points: 0, pid: p.id });
    }
  }

  private awardCombo(p: Entity, target: Entity, points: number): void {
    if (p.comboTargetId !== target.id) {
      p.comboPoints = 0;
      p.comboTargetId = target.id;
    }
    p.comboPoints = Math.min(5, p.comboPoints + points);
    this.emit({ type: 'comboPoint', points: p.comboPoints, pid: p.id });
  }

  private applyAura(target: Entity, aura: Aura): void {
    if (target.kind === 'npc' && isRejectedFriendlyNpcAura(aura)) return;
    if (target.kind === 'mob' && MOBS[target.templateId]?.ccImmune && this.isControlAura(aura.kind)) return;
    const existing = target.auras.findIndex((a) => a.id === aura.id && a.sourceId === aura.sourceId);
    if (existing >= 0) {
      this.applyNonPlayerStatAura(target, target.auras[existing], -1);
      target.auras.splice(existing, 1);
    }
    target.auras.push(aura);
    this.applyNonPlayerStatAura(target, aura, 1);
    this.emit({ type: 'aura', targetId: target.id, name: aura.name, gained: true });
    const source = this.entities.get(aura.sourceId);
    this.refreshMobLeashFromAction(source ?? null, target);
    if (target.kind === 'player') {
      const meta = this.players.get(target.id);
      if (meta) recalcPlayerStats(target, meta.cls, meta.equipment);
    }
  }

  private applyRootAura(source: Entity, target: Entity, name: string, id: string, duration: number, school: Aura['school']): void {
    const remaining = this.diminishedCrowdControlDuration(source, target, 'root', duration);
    if (remaining === null) return;
    this.applyAura(target, {
      id, name, kind: 'root',
      remaining, duration: remaining, value: 0,
      sourceId: source.id, school,
    });
  }

  private diminishedCrowdControlDuration(
    source: Entity,
    target: Entity,
    category: CrowdControlDrCategory,
    duration: number,
  ): number | null {
    if (source.kind !== 'player' || target.kind !== 'player' || !this.isHostileTo(source, target)) {
      return duration;
    }
    const existing = target.ccDr.get(category);
    const stage = existing && existing.resetAt > this.time ? existing.stage : 0;
    if (stage >= PVP_CC_DR_MULTIPLIERS.length) return null;
    target.ccDr.set(category, { stage: stage + 1, resetAt: this.time + PVP_CC_DR_RESET });
    return duration * PVP_CC_DR_MULTIPLIERS[stage];
  }

  private mobsInRadius(pos: Vec3, radius: number): Entity[] {
    const out: Entity[] = [];
    this.grid.forEachInRadius(pos.x, pos.z, radius, (e) => {
      if (e.kind === 'mob' && !e.dead && e.hostile) out.push(e);
    });
    return out;
  }

  private hostilesInRadius(source: Entity, pos: Vec3, radius: number): Entity[] {
    const out: Entity[] = [];
    this.grid.forEachInRadius(pos.x, pos.z, radius, (e) => {
      if (e.id !== source.id && !e.dead && this.isHostileTo(source, e)) out.push(e);
    });
    return out;
  }

  private breakStealth(e: Entity): void {
    const idx = e.auras.findIndex((a) => a.kind === 'stealth');
    if (idx < 0) return;
    const name = e.auras[idx].name;
    e.auras.splice(idx, 1);
    this.emit({ type: 'aura', targetId: e.id, name, gained: false });
  }

  // Taunt/Growl, classic semantics: never misses, lifts the caster's threat to
  // the top of the table, and forces the mob onto the caster for 3 seconds.
  private applyTaunt(p: Entity, mob: Entity): void {
    const top = topThreatValue(mob);
    const mine = mob.threat.get(p.id) ?? 0;
    mob.threat.set(p.id, Math.max(mine, top, 1));
    mob.forcedTargetId = p.id;
    mob.forcedTargetTimer = TAUNT_FORCE_SECONDS;
    if (mob.aiState === 'idle') this.aggroMob(mob, p, false);
    else if (mob.aiState === 'chase' || mob.aiState === 'attack') mob.aggroTargetId = p.id;
    this.enterCombat(p, mob);
  }

  // -------------------------------------------------------------------------
  // Hunter pets
  // -------------------------------------------------------------------------

  petOf(ownerPid: number): Entity | null {
    for (const e of this.entities.values()) {
      if (e.kind === 'mob' && e.ownerId === ownerPid && !e.dead) return e;
    }
    return null;
  }

  private tameError(p: Entity, target: Entity): string | null {
    if (target.kind !== 'mob' || !target.hostile) return 'You cannot tame that.';
    const template = MOBS[target.templateId];
    if (!template || (template.family !== 'beast' && template.family !== 'spider')) return 'Only beasts can be tamed.';
    if (template.elite || template.boss || template.rare) return 'That beast is too strong to tame.';
    if (target.level > p.level) return 'That beast is too high level for you to tame.';
    if (target.spawnPos.x > DUNGEON_X_THRESHOLD) return 'You cannot tame dungeon creatures.';
    if (this.petOf(p.id)) return 'You already have a pet.';
    return null;
  }

  private completeTame(p: Entity, target: Entity): void {
    const err = this.tameError(p, target);
    if (err) { this.error(p.id, err); return; }
    target.ownerId = p.id;
    target.petTauntTimer = 0;
    target.hostile = false;
    target.aiState = 'idle';
    target.aggroTargetId = null;
    target.inCombat = false;
    target.tappedById = null;
    target.auras = [];
    target.hp = target.maxHp;
    target.loot = null;
    target.lootable = false;
    target.wanderTarget = null;
    clearThreat(target);
    this.clearEntityMarker(target.id); // a tamed pet is no longer a markable enemy
    // it's friendly now: nobody keeps swinging at it, other mobs forget it
    for (const other of this.players.values()) {
      const e = this.entities.get(other.entityId);
      if (e && e.targetId === target.id) e.autoAttack = false;
    }
    for (const m of this.entities.values()) {
      if (m.kind !== 'mob' || m.id === target.id) continue;
      m.threat.delete(target.id);
      if (m.aggroTargetId === target.id && !m.dead && m.aiState !== 'dead') this.retargetMob(m);
    }
    this.emit({ type: 'log', text: `${target.name} is now your loyal companion.`, color: '#8f8', pid: p.id });
    this.emit({ type: 'aura', targetId: target.id, name: 'Tamed', gained: true });
  }

  /** Dismissal, owner logout, or pet respawn: the beast goes back to the wild
   *  and walks home. Mobs that were fighting it forget it. */
  private releasePetToWild(pet: Entity): void {
    this.clearNonPlayerStatAuras(pet);
    pet.auras = [];
    pet.ownerId = null;
    pet.petTauntTimer = 0;
    pet.hostile = true;
    pet.aggroTargetId = null;
    pet.inCombat = false;
    pet.aiState = pet.dead ? 'dead' : 'evade';
    clearThreat(pet);
    for (const m of this.entities.values()) {
      if (m.kind !== 'mob' || m.id === pet.id) continue;
      m.threat.delete(pet.id);
      if (m.aggroTargetId === pet.id && !m.dead && m.aiState !== 'dead') this.retargetMob(m);
    }
  }

  // -------------------------------------------------------------------------
  // Auto-attack & melee
  // -------------------------------------------------------------------------

  startAutoAttack(pid?: number): void {
    const r = this.resolve(pid);
    if (!r) return;
    const p = r.e;
    if (p.dead) return;
    const t = p.targetId !== null ? this.entities.get(p.targetId) : null;
    if (!t || t.dead || !this.isHostileTo(p, t)) { this.error(p.id, 'Invalid attack target.'); return; }
    if (p.sitting) this.standUp(p);
    p.autoAttack = true;
  }

  stopAutoAttack(pid?: number): void {
    const r = this.resolve(pid);
    if (r) r.e.autoAttack = false;
  }

  private updatePlayerAutoAttack(p: Entity, meta: PlayerMeta): void {
    p.swingTimer = Math.max(0, p.swingTimer - DT);
    if (!p.autoAttack || p.castingAbility) return;
    const t = p.targetId !== null ? this.entities.get(p.targetId) : null;
    if (!t || t.dead || !this.isHostileTo(p, t)) { p.autoAttack = false; return; }
    if (p.swingTimer > 0) return;
    if (this.isStunned(p)) return;
    const d = dist2d(p.pos, t.pos);
    const facingDiff = Math.abs(normAngle(angleTo(p.pos, t.pos) - p.facing));
    if (facingDiff > MELEE_ARC) return;

    // ranged auto-attack: hunters (auto shot, dead zone inside minRange) and
    // casters (wand-style, no dead zone so they don't run into melee — #94)
    const ranged = CLASSES[meta.cls].ranged;
    if (ranged && d <= ranged.maxRange && d >= (ranged.wand ? 0 : ranged.minRange)) {
      this.rangedSwing(p, t, ranged);
      p.swingTimer = ranged.speed * this.swingIntervalMult(p);
      return;
    }
    if (d > MELEE_RANGE) return;

    let bonus = 0;
    let abilityName: string | null = null;
    let threatFlat = 0;
    let threatMult = 1;
    if (p.queuedOnSwing) {
      const queued = this.resolvedAbility(p.queuedOnSwing, p.id);
      if (queued) {
        const eff = queued.effects.find((e) => e.type === 'weaponDamage');
        if (p.resource >= queued.cost && eff && eff.type === 'weaponDamage') {
          this.spendResource(p, queued.cost);
          // on-next-swing abilities (e.g. Raptor Strike) resolve here rather than
          // in castAbility, so their cooldown must be applied on the swing too (#56)
          if (queued.def.cooldown > 0) p.cooldowns.set(queued.def.id, queued.def.cooldown);
          bonus = eff.bonus;
          abilityName = queued.def.name;
          threatFlat = queued.threatFlat;
          threatMult = queued.threatMult;
        }
      }
      p.queuedOnSwing = null;
    }
    this.meleeSwing(p, t, bonus, abilityName, { threatFlat, threatMult });
    p.swingTimer = p.weapon.speed * this.swingIntervalMult(p);
  }

  private rangedSwing(
    attacker: Entity, target: Entity,
    ranged: { min: number; max: number; speed: number; wand?: boolean; school?: string },
  ): void {
    const school = ranged.wand ? (ranged.school ?? 'arcane') : 'physical';
    const label = ranged.wand ? 'Wand' : 'Auto Shot';
    this.emit({ type: 'spellfx', sourceId: attacker.id, targetId: target.id, school, fx: 'projectile' });
    const missChance = meleeMissChance(attacker.level, target.level);
    if (this.rng.chance(missChance)) {
      this.emit({ type: 'damage', sourceId: attacker.id, targetId: target.id, amount: 0, crit: false, school, ability: label, kind: 'miss' });
      this.enterCombat(attacker, target);
      return;
    }
    let dmg = this.rng.range(ranged.min, ranged.max) + (attacker.rangedPower / 14) * ranged.speed;
    const crit = this.rng.chance(attacker.critChance);
    if (crit) dmg *= 2;
    // wand bolts are magic — armor doesn't apply; physical auto shot is mitigated
    if (!ranged.wand) dmg *= 1 - armorReduction(this.effectiveArmor(target), attacker.level);
    this.dealDamage(attacker, target, Math.max(1, Math.round(dmg)), crit, school, label, 'hit');
  }

  // Returns true if the swing connected.
  private meleeSwing(
    attacker: Entity, target: Entity, bonus: number, abilityName: string | null,
    opts: { cannotBeDodged?: boolean; weaponMult?: number; threatFlat?: number; threatMult?: number },
  ): boolean {
    const missChance = meleeMissChance(attacker.level, target.level);
    const dodgeChance = opts.cannotBeDodged ? 0
      : (target.kind === 'player' ? target.dodgeChance : 0.05 + Math.max(0, target.level - attacker.level) * 0.005);
    const roll = this.rng.next();
    if (roll < missChance) {
      this.emit({ type: 'damage', sourceId: attacker.id, targetId: target.id, amount: 0, crit: false, school: 'physical', ability: abilityName, kind: 'miss' });
      this.enterCombat(attacker, target);
      return false;
    }
    if (roll < missChance + dodgeChance) {
      this.emit({ type: 'damage', sourceId: attacker.id, targetId: target.id, amount: 0, crit: false, school: 'physical', ability: abilityName, kind: 'dodge' });
      this.enterCombat(attacker, target);
      if (attacker.kind === 'player') attacker.overpowerUntil = this.time + 5;
      return false;
    }
    const mult = opts.weaponMult ?? 1;
    // weapon imbues (seals, rockbiter) add flat damage to every swing
    let imbueBonus = 0;
    for (const a of attacker.auras) if (a.kind === 'imbue') imbueBonus += a.value;
    let dmg = (this.rng.range(attacker.weapon.min, attacker.weapon.max) + (this.effectiveAttackPower(attacker) / 14) * attacker.weapon.speed) * mult + bonus + imbueBonus;
    const critChance = Math.max(0.005, attacker.critChance - Math.max(0, target.level - attacker.level) * 0.002);
    const crit = this.rng.chance(critChance);
    if (crit) dmg *= 2;
    dmg *= 1 - armorReduction(this.effectiveArmor(target), attacker.level);
    this.dealDamage(attacker, target, Math.max(1, Math.round(dmg)), crit, 'physical', abilityName, 'hit', false,
      { flat: opts.threatFlat ?? 0, mult: opts.threatMult ?? 1 });
    // thorns / lightning shield: melee attackers take damage back
    if (!attacker.dead) {
      for (const a of target.auras) {
        if (a.kind === 'thorns') {
          this.dealDamage(target, attacker, a.value, false, a.school, a.name, 'hit', true);
        }
      }
    }
    return true;
  }

  // -------------------------------------------------------------------------
  // Damage / death
  // -------------------------------------------------------------------------

  private dealDamage(source: Entity | null, target: Entity, amount: number, crit: boolean, school: string, ability: string | null, kind: 'hit' | 'miss' | 'dodge', noRage = false, threatOpts?: { flat?: number; mult?: number }): void {
    if (target.dead) return;
    if (target.gm) return; // GM characters are invulnerable — every damage path funnels here
    // A mob that broke leash (or a pet freed to the wild) is in 'evade': it has
    // dropped its hate table and walks home without fighting back, healing to
    // full only on arrival. Classic mechanics make it immune while it retreats,
    // so it can't be chipped down — or killed outright — for a risk-free kill.
    if (target.kind === 'mob' && target.aiState === 'evade') return;
    amount = Math.max(0, amount);

    // Defensive Stance, classic: deal 10% less, take 10% less (and +30% threat below)
    if (source && source.id !== target.id && source.auras.some((a) => a.kind === 'defensive_stance')) {
      amount = Math.round(amount * 0.9);
    }
    if (source && source.id !== target.id && target.auras.some((a) => a.kind === 'defensive_stance')) {
      amount = Math.round(amount * 0.9);
    }

    // absorb shields soak damage first
    if (amount > 0) {
      for (let i = target.auras.length - 1; i >= 0 && amount > 0; i--) {
        const a = target.auras[i];
        if (a.kind !== 'absorb') continue;
        const soaked = Math.min(a.value, amount);
        a.value -= soaked;
        amount -= soaked;
        if (a.value <= 0) {
          target.auras.splice(i, 1);
          this.emit({ type: 'aura', targetId: target.id, name: a.name, gained: false });
        }
      }
    }

    // duels end at 1 hp — nobody dies
    const duel = target.kind === 'player' ? this.duels.get(target.id) : undefined;
    if (duel && duel.state === 'active' && source && (source.id === duel.a || source.id === duel.b)) {
      if (target.hp - amount < 1) {
        amount = Math.max(0, target.hp - 1);
        target.hp = 1;
        this.emit({ type: 'damage', sourceId: source.id, targetId: target.id, amount, crit, school, ability, kind });
        this.endDuel(duel, source.id);
        return;
      }
    }

    // arena bouts also end at 1 hp — the loser yields, nobody actually dies
    const match = target.kind === 'player' ? this.arenaMatches.get(target.id) : undefined;
    if (match && match.state === 'active' && source && (source.id === match.a || source.id === match.b)) {
      if (target.hp - amount < 1) {
        amount = Math.max(0, target.hp - 1);
        target.hp = 1;
        this.emit({ type: 'damage', sourceId: source.id, targetId: target.id, amount, crit, school, ability, kind });
        this.endArenaMatch(match, source.id, 'defeat');
        return;
      }
    }

    target.hp = Math.max(0, target.hp - amount);
    this.emit({ type: 'damage', sourceId: source?.id ?? -1, targetId: target.id, amount, crit, school, ability, kind });

    if (amount > 0) {
      for (let i = target.auras.length - 1; i >= 0; i--) {
        if (target.auras[i].breaksOnDamage) {
          this.emit({ type: 'aura', targetId: target.id, name: target.auras[i].name, gained: false });
          target.auras.splice(i, 1);
        }
      }
    }

    // taking or dealing real damage breaks stealth
    if (amount > 0) {
      this.breakStealth(target);
      if (source && source.id !== target.id) this.breakStealth(source);
    }

    if (source && source.id !== target.id) this.enterCombat(source, target);
    this.refreshMobLeashFromAction(source, target);

    // classic threat: damage (and the ability's flat bonus) lands on the mob's
    // hate table, scaled by the attacker's stance/form modifiers
    if (source && source.id !== target.id && target.kind === 'mob' && target.hostile
      && (source.kind === 'player' || source.ownerId !== null)) {
      const threat = (amount * (threatOpts?.mult ?? 1) + (threatOpts?.flat ?? 0)) * threatModifier(source, school);
      addThreat(target, source.id, threat);
    }

    // tap rights: the first player (or their pet) to damage a mob owns it
    if (source && target.kind === 'mob' && target.hostile && target.tappedById === null && amount >= 0) {
      if (source.kind === 'player') target.tappedById = source.id;
      else if (source.ownerId !== null) target.tappedById = source.ownerId;
    }

    if (source && source.kind === 'player' && source.id !== target.id) {
      const meta = this.players.get(source.id);
      if (meta) meta.counters.damageDealt += amount;
      if (source.resourceType === 'rage' && !noRage && school === 'physical' && !ability) {
        source.resource = Math.min(source.maxResource, source.resource + rageFromDealing(amount, source.level));
      }
    }
    if (target.kind === 'player') {
      const meta = this.players.get(target.id);
      if (meta) meta.counters.damageTaken += amount;
      if (target.resourceType === 'rage' && source && source.id !== target.id) {
        target.resource = Math.min(target.maxResource, target.resource + rageFromTaking(amount, target.level));
      }
      if (isConsuming(target)) { target.eating = null; target.drinking = null; }
      if (target.sitting) target.sitting = false;
      // vanilla spell pushback: a landed hit delays the cast rather than
      // cancelling it (misses and fully absorbed hits don't push back)
      if (target.castingAbility && source && source.id !== target.id && amount > 0 && kind === 'hit') {
        if (target.castingAbility === FISHING_CAST_ID) this.cancelCast(target);
        else this.pushbackCast(target);
      }
    }

    if (target.hp <= 0) {
      this.handleDeath(target, source);
    }
  }

  private enterCombat(a: Entity, b: Entity): void {
    a.combatTimer = 0;
    b.combatTimer = 0;
    a.inCombat = true;
    b.inCombat = true;
    // players and their pets pull wild mobs; pets never run wild-mob AI
    const aAttacker = a.kind === 'player' || (a.kind === 'mob' && a.ownerId !== null);
    if (b.kind === 'mob' && b.ownerId === null && !b.dead && aAttacker && b.aiState !== 'evade') {
      if (b.aiState === 'idle') this.aggroMob(b, a, true);
      else if (b.aggroTargetId === null) b.aggroTargetId = a.id;
    }
    if (a.kind === 'mob' && a.ownerId === null && !a.dead && b.kind === 'player' && a.aiState === 'idle') {
      this.aggroMob(a, b, false);
    }
  }

  private handleDeath(e: Entity, killer: Entity | null): void {
    e.dead = true;
    e.hp = 0;
    this.clearNonPlayerStatAuras(e);
    e.auras = [];
    e.ccDr.clear();
    e.castingAbility = null;
    this.emit({ type: 'death', entityId: e.id, killerId: killer?.id ?? -1 });

    // a dead mob keeps no raid marker — respawnMob reuses the same entity id,
    // so a stale mark would otherwise reappear on the respawn
    if (e.kind === 'mob') this.clearEntityMarker(e.id);

    // the dead drop off every hate table (and any taunt lock on them)
    for (const m of this.entities.values()) {
      if (m.kind !== 'mob' || m.id === e.id) continue;
      m.threat.delete(e.id);
      if (m.forcedTargetId === e.id) {
        m.forcedTargetId = null;
        m.forcedTargetTimer = 0;
      }
    }

    if (e.kind === 'player') {
      const meta = this.players.get(e.id);
      if (meta) meta.counters.deaths++;
      e.autoAttack = false;
      e.queuedOnSwing = null;
      e.comboPoints = 0;
      e.eating = null;
      e.drinking = null;
      e.sitting = false;
      e.chargeTargetId = null;
      e.chargePath = [];
      this.emit({ type: 'playerDeath', pid: e.id });
      for (const m of this.entities.values()) {
        if (m.kind === 'mob' && !m.dead && m.aggroTargetId === e.id && m.aiState !== 'dead') {
          // turn on the next nearby attacker; go home only if nobody is left
          this.retargetMob(m);
        }
      }
      return;
    }

    if (e.kind === 'mob') {
      const template = MOBS[e.templateId];
      e.aiState = 'dead';
      e.corpseTimer = CORPSE_DURATION;
      e.respawnTimer = this.cfg.respawnSeconds * (template?.respawnMult ?? (template?.rare ? 4 : 1));
      e.aggroTargetId = null;
      clearThreat(e);
      if (e.ownerId !== null) {
        this.emit({ type: 'log', text: `${e.name} dies.`, color: '#f66', pid: e.ownerId });
        return; // pets drop no loot and grant no credit; they respawn wild
      }

      // credit goes to the tapping player (fall back to the killer)
      const creditId = e.tappedById ?? (killer?.kind === 'player' ? killer.id : null);
      const meta = creditId !== null ? this.players.get(creditId) : null;
      const creditEntity = creditId !== null ? this.entities.get(creditId) : null;
      if (meta && creditEntity) {
        const eliteMult = MOBS[e.templateId]?.elite ? 2 : 1;
        // party play: kill credit, xp split and quest progress shared with
        // members alive and nearby (classic group rules + group bonus)
        const party = this.partyOf(creditEntity.id);
        const eligible: PlayerMeta[] = [];
        if (party) {
          for (const mPid of party.members) {
            const mMeta = this.players.get(mPid);
            const mE = this.entities.get(mPid);
            if (mMeta && mE && !mE.dead && dist2d(mE.pos, e.pos) <= PARTY_XP_RANGE) eligible.push(mMeta);
          }
        }
        if (eligible.length === 0) eligible.push(meta);
        const bonus = GROUP_XP_BONUS[Math.min(eligible.length, GROUP_XP_BONUS.length) - 1];

        meta.counters.kills++;
        if (creditEntity.targetId === e.id) creditEntity.autoAttack = false;
        if (creditEntity.comboTargetId === e.id) {
          creditEntity.comboPoints = 0;
          creditEntity.comboTargetId = null;
          this.emit({ type: 'comboPoint', points: 0, pid: creditEntity.id });
        }
        for (const member of eligible) {
          const mE = this.entities.get(member.entityId);
          if (!mE) continue;
          const xpGain = Math.round((mobXpValue(e.level, mE.level) * eliteMult * bonus) / eligible.length);
          if (xpGain > 0 && mE.level < MAX_LEVEL) this.grantXp(xpGain, member);
          this.onMobKilledForQuests(e, member);
        }
        this.rollLoot(e, meta, eligible);
      }
    }
  }

  grantXp(amount: number, meta: PlayerMeta = this.primary): void {
    const p = this.entities.get(meta.entityId);
    if (!p || p.level >= MAX_LEVEL) return;
    meta.xp += amount;
    meta.counters.xpGained += amount;
    this.emit({ type: 'xp', amount, pid: p.id });
    while (p.level < MAX_LEVEL && meta.xp >= xpForLevel(p.level)) {
      meta.xp -= xpForLevel(p.level);
      p.level++;
      meta.counters.levelUps++;
      recalcPlayerStats(p, meta.cls, meta.equipment);
      p.hp = p.maxHp;
      if (p.resourceType === 'mana') p.resource = p.maxResource;
      this.emit({ type: 'levelup', level: p.level, pid: p.id });
      this.refreshKnownAbilities(meta, true);
    }
    if (p.level >= MAX_LEVEL) meta.xp = 0;
  }

  private needsQuestDrop(entry: LootEntry, meta: PlayerMeta): boolean {
    if (!entry.questId || !entry.itemId) return false;
    const qp = meta.questLog.get(entry.questId);
    if (!qp || qp.state !== 'active') return false;
    const quest = QUESTS[entry.questId];
    const objIdx = quest.objectives.findIndex((o) => o.type === 'collect' && o.itemId === entry.itemId);
    return objIdx < 0 || this.countItem(entry.itemId, meta.entityId) < quest.objectives[objIdx].count;
  }

  private rollLoot(mob: Entity, meta: PlayerMeta, eligible: PlayerMeta[] = [meta]): void {
    const template = MOBS[mob.templateId];
    if (!template) return;
    let copper = 0;
    const items: LootSlot[] = [];
    const rolledGroups = new Set<string>();
    for (const entry of template.loot) {
      // Exclusive groups: a single rng draw is partitioned by the group
      // entries' chances, so at most one matching entry drops.
      // Exactly one rng.next() per group keeps replays deterministic.
      if (entry.rollGroup) {
        if (rolledGroups.has(entry.rollGroup)) continue;
        rolledGroups.add(entry.rollGroup);
        const group = template.loot.filter((l) => l.rollGroup === entry.rollGroup);
        const roll = this.rng.next();
        let cumulative = 0;
        for (const g of group) {
          cumulative += g.chance;
          if (roll < cumulative) {
            if (g.itemId) items.push({ itemId: g.itemId, count: 1 });
            break;
          }
        }
        continue;
      }
      if (entry.questId) {
        const questRecipients = eligible.filter((m) => this.needsQuestDrop(entry, m));
        if (questRecipients.length === 0) continue;
        if (!this.rng.chance(entry.chance)) continue;
        items.push({ itemId: entry.itemId!, count: 1, personalFor: questRecipients.map((m) => m.entityId) });
        continue;
      }
      if (!this.rng.chance(entry.chance)) continue;
      if (entry.copper) copper += this.rng.int(Math.ceil(entry.copper * 0.6), Math.ceil(entry.copper * 1.4));
      if (entry.itemId) items.push({ itemId: entry.itemId, count: 1 });
    }
    if (copper > 0 || items.length > 0) {
      mob.loot = { copper, items };
      mob.lootable = true;
    }
  }

  private rollGroupLoot(itemId: string, mob: Entity, looter: PlayerMeta): boolean {
    if (!this.itemRequiresGroupRoll(itemId) || mob.tappedById === null) return false;
    const party = this.partyOf(mob.tappedById);
    if (!party || party.members.length <= 1) return false;
    const candidates: PlayerMeta[] = [];
    for (const pid of party.members) {
      const candidate = this.players.get(pid);
      const e = this.entities.get(pid);
      if (candidate && e && !e.dead && dist2d(e.pos, mob.pos) <= PARTY_XP_RANGE) candidates.push(candidate);
    }
    if (candidates.length <= 1) return false;
    let winner = candidates[0];
    let bestRoll = -1;
    for (const candidate of candidates) {
      const roll = this.rng.int(1, 100);
      if (roll > bestRoll) {
        bestRoll = roll;
        winner = candidate;
      }
    }
    const itemName = ITEMS[itemId]?.name ?? itemId;
    for (const candidate of candidates) {
      this.emit({ type: 'loot', text: `${winner.name} wins ${itemName} (${bestRoll})`, pid: candidate.entityId });
    }
    this.addItem(itemId, 1, winner.entityId);
    return true;
  }

  private lootSlotVisibleTo(slot: LootSlot, pid: number): boolean {
    return !slot.personalFor || slot.personalFor.includes(pid);
  }

  private pruneCorpseLoot(mob: Entity): void {
    if (!mob.loot) return;
    mob.loot.items = mob.loot.items.filter((s) => s.count > 0 && (!s.personalFor || s.personalFor.length > 0));
    if (mob.loot.copper <= 0 && mob.loot.items.length === 0) {
      mob.loot = null;
      mob.lootable = false;
      mob.corpseTimer = Math.min(mob.corpseTimer, 4);
    }
  }

  // -------------------------------------------------------------------------
  // Mob AI
  // -------------------------------------------------------------------------

  private refreshMobLeashFromAction(source: Entity | null, target: Entity): void {
    if (!source || source.id === target.id || target.kind !== 'mob' || target.ownerId !== null || target.dead) return;
    if (source.kind !== 'player' && source.ownerId === null) return;
    target.leashAnchor = { ...target.pos };
  }

  // When a mob's target dies/leaves it swings to its next-highest-threat
  // attacker. With no living threat left, it evades home instead of grabbing a
  // nearby bystander who never acted on the mob.
  private retargetMob(mob: Entity): void {
    const next = this.highestThreatTarget(mob);
    if (next) {
      mob.aggroTargetId = next.id;
      mob.aiState = 'chase';
      mob.inCombat = true;
      return;
    }
    mob.aggroTargetId = null;
    mob.aiState = 'evade';
  }

  /** Highest-threat living attacker on the table; prunes stale entries. */
  private highestThreatTarget(mob: Entity): Entity | null {
    let best: Entity | null = null;
    let bestT = -1;
    for (const [id, t] of mob.threat) {
      const e = this.entities.get(id);
      if (!e || e.dead) { mob.threat.delete(id); continue; }
      if (t > bestT) { bestT = t; best = e; }
    }
    return best;
  }

  // Classic pull-over rules, applied every AI tick while fighting: an attacker
  // takes aggro past 110% of the current target's threat in melee range of
  // the mob, or past 130% at range. A taunt forces the target outright.
  private updateMobTarget(mob: Entity): void {
    if (mob.forcedTargetTimer > 0) {
      mob.forcedTargetTimer -= DT;
      const forced = mob.forcedTargetId !== null ? this.entities.get(mob.forcedTargetId) : null;
      if (forced && !forced.dead) {
        mob.aggroTargetId = forced.id;
        return;
      }
    }
    if (mob.forcedTargetTimer <= 0) mob.forcedTargetId = null;
    const cur = mob.aggroTargetId !== null ? this.entities.get(mob.aggroTargetId) : null;
    if (!cur || cur.dead) {
      const next = this.highestThreatTarget(mob);
      if (next) mob.aggroTargetId = next.id;
      return;
    }
    const curThreat = mob.threat.get(cur.id) ?? 0;
    let best = cur;
    let bestT = curThreat;
    for (const [id, t] of mob.threat) {
      if (id === cur.id || t <= bestT) continue;
      const e = this.entities.get(id);
      if (!e || e.dead) { mob.threat.delete(id); continue; }
      const inMelee = dist2d(mob.pos, e.pos) <= MELEE_RANGE * 1.2;
      const needed = curThreat * (inMelee ? MELEE_SWITCH_MULT : RANGED_SWITCH_MULT);
      if (t > needed) { best = e; bestT = t; }
    }
    if (best !== cur) mob.aggroTargetId = best.id;
  }

  private aggroMob(mob: Entity, target: Entity, social: boolean): void {
    if (mob.dead || mob.aiState === 'evade' || mob.aiState === 'chase' || mob.aiState === 'attack') return;
    mob.aiState = 'chase';
    mob.aggroTargetId = target.id;
    mob.inCombat = true;
    mob.leashAnchor = { ...mob.pos };
    addThreat(mob, target.id, 1); // seed the hate table so taunts/heals have a baseline
    if (social) {
      const family = MOBS[mob.templateId]?.family;
      const pullRadius = (family && SOCIAL_PULL_RADIUS[family]) ?? DEFAULT_SOCIAL_PULL_RADIUS;
      this.grid.forEachInRadius(mob.pos.x, mob.pos.z, pullRadius, (m, d2) => {
        if (m.kind === 'mob' && m.id !== mob.id && !m.dead && m.hostile && m.aiState === 'idle' && m.ownerId === null
          && m.templateId === mob.templateId && d2 < pullRadius * pullRadius) {
          m.aiState = 'chase';
          m.aggroTargetId = target.id;
          m.inCombat = true;
          m.leashAnchor = { ...m.pos };
          addThreat(m, target.id, 1);
        }
      });
    }
  }

  private nearestLivingPlayer(pos: Vec3, maxDist: number): { e: Entity; d: number } | null {
    let best: Entity | null = null;
    let bestD2 = maxDist * maxDist;
    this.playerGrid.forEachInRadius(pos.x, pos.z, maxDist, (e, d2) => {
      if (!e.dead && d2 < bestD2) { bestD2 = d2; best = e; }
    });
    return best ? { e: best, d: Math.sqrt(bestD2) } : null;
  }

  private updateMob(mob: Entity): void {
    if (mob.dead) {
      mob.corpseTimer -= DT;
      mob.respawnTimer -= DT;
      // dungeon mobs stay dead until the instance resets
      const isInstanceMob = mob.spawnPos.x > DUNGEON_X_THRESHOLD;
      if (!isInstanceMob && mob.respawnTimer <= 0 && (mob.corpseTimer <= 0 || !mob.lootable)) {
        this.respawnMob(mob);
      }
      return;
    }

    mob.combatTimer += DT;

    if (mob.ownerId !== null) {
      this.updatePet(mob);
      return;
    }

    // Self-healing safety net (#113/#99): every mob spawns hostile and only
    // taming clears that (which always assigns an owner). A live, owner-less,
    // non-hostile mob is therefore a leak — exactly the "immortal, invalid
    // target" wolves players hit. Restore hostility so no mob can ever be left
    // permanently untargetable, whatever path corrupted it.
    if (!mob.hostile) mob.hostile = true;

    if (mob.inCombat) this.updateBossMechanics(mob);

    if (this.isStunned(mob)) {
      if (mob.auras.some((a) => a.kind === 'polymorph')) {
        mob.wanderTimer -= DT;
        if (mob.wanderTimer <= 0) {
          mob.wanderTimer = this.rng.range(0.8, 2);
          mob.facing = this.rng.range(-Math.PI, Math.PI);
        }
        const step = 1.6 * DT;
        mob.pos.x += Math.sin(mob.facing) * step;
        mob.pos.z += Math.cos(mob.facing) * step;
        mob.pos.y = groundHeight(mob.pos.x, mob.pos.z, this.cfg.seed);
      }
      return;
    }

    switch (mob.aiState) {
      case 'idle': {
        const template = MOBS[mob.templateId];
        const nearest = this.nearestLivingPlayer(mob.pos, 25);
        if (nearest) {
          let radius = Math.max(4, Math.min(20, template.aggroRadius + (mob.level - nearest.e.level) * 1.5));
          // stealthed rogues are harder to detect, relative to observer level
          if (nearest.e.auras.some((a) => a.kind === 'stealth')) radius = stealthDetectionRadius(mob, nearest.e, radius);
          if (nearest.d < radius) {
            this.aggroMob(mob, nearest.e, true);
            break;
          }
        }
        mob.wanderTimer -= DT;
        if (mob.wanderTimer <= 0) {
          if (mob.wanderTarget) {
            mob.wanderTarget = null;
            mob.wanderTimer = this.rng.range(3, 10);
          } else {
            const ang = this.rng.range(0, Math.PI * 2);
            const r = this.rng.range(2, 9);
            mob.wanderTarget = this.groundPos(mob.spawnPos.x + Math.sin(ang) * r, mob.spawnPos.z + Math.cos(ang) * r);
            mob.wanderTimer = 30;
          }
        }
        if (mob.wanderTarget) {
          const arrived = this.moveToward(mob, mob.wanderTarget, mob.moveSpeed * 0.35);
          if (arrived) {
            mob.wanderTarget = null;
            mob.wanderTimer = this.rng.range(3, 10);
          }
        }
        break;
      }
      case 'chase': {
        this.updateMobTarget(mob);
        const target = mob.aggroTargetId !== null ? this.entities.get(mob.aggroTargetId) : null;
        if (!target || target.dead) {
          this.retargetMob(mob);
          break;
        }
        const leash = mob.spawnPos.x > DUNGEON_X_THRESHOLD ? DUNGEON_LEASH_DISTANCE : LEASH_DISTANCE;
        const leashAnchor = mob.leashAnchor ?? mob.spawnPos;
        if (dist2d(mob.pos, leashAnchor) > leash) {
          mob.aiState = 'evade';
          mob.aggroTargetId = null;
          clearThreat(mob);
          mob.leashAnchor = null;
          break;
        }
        const d = dist2d(mob.pos, target.pos);
        if (d <= MELEE_RANGE * 0.8) {
          mob.aiState = 'attack';
          mob.swingTimer = Math.min(mob.swingTimer, 0.4);
          break;
        }
        if (!this.isRooted(mob)) this.moveToward(mob, target.pos, mob.moveSpeed * this.moveSpeedMult(mob));
        else mob.facing = angleTo(mob.pos, target.pos);
        break;
      }
      case 'attack': {
        this.updateMobTarget(mob);
        const target = mob.aggroTargetId !== null ? this.entities.get(mob.aggroTargetId) : null;
        if (!target || target.dead) { this.retargetMob(mob); break; }
        const d = dist2d(mob.pos, target.pos);
        if (d > MELEE_RANGE) { mob.aiState = 'chase'; break; }
        mob.facing = angleTo(mob.pos, target.pos);
        mob.swingTimer -= DT;
        if (mob.swingTimer <= 0) {
          this.mobSwing(mob, target);
          mob.swingTimer = mob.weapon.speed * this.swingIntervalMult(mob);
        }
        // Boss/miniboss pulse mechanic.
        const pulse = MOBS[mob.templateId]?.aoePulse;
        if (pulse) {
          mob.pulseTimer -= DT;
          if (mob.pulseTimer <= 0) {
            mob.pulseTimer = pulse.every;
            const school = pulse.school ?? 'shadow';
            this.emit({ type: 'spellfx', sourceId: mob.id, targetId: mob.id, school, fx: pulse.fx ?? 'nova' });
            for (const meta of this.players.values()) {
              const pe = this.entities.get(meta.entityId);
              if (pe && !pe.dead && dist2d(pe.pos, mob.pos) <= pulse.radius) {
                const dmg = Math.round(this.rng.range(pulse.min, pulse.max));
                this.dealDamage(mob, pe, dmg, false, school, pulse.name, 'hit', true);
              }
            }
          }
        }
        break;
      }
      case 'evade': {
        // moveToward has no pathfinding: a straight line home that crosses a prop
        // (the camp tent/crate/campfire) or deep water makes no progress, so the
        // mob stays evading — and therefore immune — forever. Walk home normally,
        // but once stalled, phase straight through the blocker just until a normal
        // step works again. Phasing always makes progress, so arrival is the
        // backstop: worst case it phases the rest of the way home.
        const phasing = mob.evadeStall >= EVADE_STALL_TIMEOUT;
        const distBefore = dist2d(mob.pos, mob.spawnPos);
        const arrived = this.moveToward(mob, mob.spawnPos, mob.moveSpeed * EVADE_SPEED_MULT, phasing);
        if (arrived) {
          this.resetEvadingMob(mob);
        } else if (phasing) {
          if (!this.blockedTowardSpawn(mob, mob.spawnPos)) mob.evadeStall = 0; // cleared the obstacle
        } else if (dist2d(mob.pos, mob.spawnPos) < distBefore - 1e-3) {
          mob.evadeStall = 0; // walking home fine
        } else {
          mob.evadeStall += DT; // pinned on something
        }
        break;
      }
    }
  }

  // An evading mob has reached its spawn (walking or phasing): drop the pull
  // entirely and return to idle at full health, ready to be pulled again.
  private resetEvadingMob(mob: Entity): void {
    mob.aiState = 'idle';
    mob.hp = mob.maxHp;
    mob.auras = [];
    mob.inCombat = false;
    mob.tappedById = null;
    mob.leashAnchor = null;
    mob.evadeStall = 0;
    clearThreat(mob);
    this.despawnSummonedAdds(mob);
    mob.firedSummons = 0;
    mob.enraged = false;
    mob.wanderTimer = this.rng.range(2, 8);
  }

  private mobSwing(mob: Entity, target: Entity): void {
    const missChance = meleeMissChance(mob.level, target.level);
    const dodgeChance = target.kind === 'player' ? target.dodgeChance : 0.05;
    const roll = this.rng.next();
    if (roll < missChance) {
      this.emit({ type: 'damage', sourceId: mob.id, targetId: target.id, amount: 0, crit: false, school: 'physical', ability: null, kind: 'miss' });
      return;
    }
    if (roll < missChance + dodgeChance) {
      this.emit({ type: 'damage', sourceId: mob.id, targetId: target.id, amount: 0, crit: false, school: 'physical', ability: null, kind: 'dodge' });
      return;
    }
    let dmg = this.rng.range(mob.weapon.min, mob.weapon.max) + (this.effectiveAttackPower(mob) / 14) * mob.weapon.speed;
    const crit = this.rng.chance(0.05);
    if (crit) dmg *= 2;
    const enrage = MOBS[mob.templateId]?.enrage;
    if (mob.enraged && enrage) dmg *= enrage.dmgMult;
    dmg *= 1 - armorReduction(this.effectiveArmor(target), mob.level);
    this.dealDamage(mob, target, Math.max(1, Math.round(dmg)), crit, 'physical', null, 'hit');
    // thorns / lightning shield on the defender
    if (!mob.dead) {
      for (const a of target.auras) {
        if (a.kind === 'thorns') {
          this.dealDamage(target, mob, a.value, false, a.school, a.name, 'hit', true);
        }
      }
    }
  }

  // Pet brain: assist the owner (attack whatever they fight or whatever
  // attacks either of you), otherwise heel. Pets swing like mobs and build
  // their own entries on enemy hate tables.
  private updatePet(pet: Entity): void {
    const owner = pet.ownerId !== null ? this.entities.get(pet.ownerId) : null;
    if (!owner || owner.kind !== 'player' || !this.players.has(owner.id)) {
      this.releasePetToWild(pet);
      return;
    }
    if (this.isStunned(pet)) return;
    pet.petTauntTimer = Math.max(0, pet.petTauntTimer - DT);

    let target = pet.aggroTargetId !== null ? this.entities.get(pet.aggroTargetId) ?? null : null;
    if (target && (target.dead || target.kind !== 'mob' || !target.hostile)) target = null;
    if (target && dist2d(owner.pos, pet.pos) > PET_LEASH) target = null;
    if (!target && !owner.dead) target = this.petPickTarget(pet, owner);
    pet.aggroTargetId = target?.id ?? null;
    pet.inCombat = target !== null;

    if (target) {
      const d = dist2d(pet.pos, target.pos);
      if (d > MELEE_RANGE * 0.8) {
        if (!this.isRooted(pet)) this.moveToward(pet, target.pos, pet.moveSpeed * this.moveSpeedMult(pet));
        pet.swingTimer = Math.max(0, pet.swingTimer - DT);
      } else {
        pet.facing = angleTo(pet.pos, target.pos);
        if (pet.petTauntTimer <= 0) {
          this.applyTaunt(pet, target);
          pet.petTauntTimer = PET_GROWL_INTERVAL;
        }
        pet.swingTimer -= DT;
        if (pet.swingTimer <= 0) {
          this.mobSwing(pet, target);
          pet.swingTimer = pet.weapon.speed * this.swingIntervalMult(pet);
        }
      }
      return;
    }

    // heel
    pet.swingTimer = Math.max(0, pet.swingTimer - DT);
    const d = dist2d(pet.pos, owner.pos);
    if (d > PET_TELEPORT_DISTANCE) {
      pet.pos = { ...owner.pos };
      pet.prevPos = { ...pet.pos };
      // a warp is a teleport: keep the spatial grid exact this tick instead of
      // waiting for the end-of-tick refresh, so same-tick aggro/AoE queries
      // don't miss the pet at its old cell (matches every other teleport site)
      this.rebucket(pet);
    } else if (d > PET_FOLLOW_DISTANCE && !this.isRooted(pet)) {
      this.moveToward(pet, owner.pos, Math.max(pet.moveSpeed, RUN_SPEED * 1.1) * this.moveSpeedMult(pet));
    }
  }

  private petPickTarget(pet: Entity, owner: Entity): Entity | null {
    let best: Entity | null = null;
    let bestD = PET_ASSIST_RANGE;
    for (const m of this.entities.values()) {
      if (m.kind !== 'mob' || m.dead || !m.hostile || m.ownerId !== null) continue;
      const engagingUs = m.aggroTargetId === owner.id || m.aggroTargetId === pet.id;
      const ownerOffense = owner.targetId === m.id && (owner.autoAttack || m.threat.has(owner.id));
      if (!engagingUs && !ownerOffense) continue;
      const d = dist2d(pet.pos, m.pos);
      if (d < bestD) { best = m; bestD = d; }
    }
    return best;
  }

  // Step `e` one tick toward `dest`. With `ignoreObstacles`, the mover phases
  // straight through props and water — used to free a stuck evader, never for
  // normal locomotion. Returns true on arrival.
  private moveToward(e: Entity, dest: Vec3, speed: number, ignoreObstacles = false): boolean {
    const d = dist2d(e.pos, dest);
    if (d < 0.3) return true;
    e.facing = angleTo(e.pos, dest);
    const step = Math.min(speed * DT, d);
    const nx = e.pos.x + Math.sin(e.facing) * step;
    const nz = e.pos.z + Math.cos(e.facing) * step;
    const canSwim = this.mobCanSwim(MOBS[e.templateId]);
    if (ignoreObstacles) {
      e.pos.x = nx;
      e.pos.z = nz;
      const g = groundHeight(nx, nz, this.cfg.seed);
      e.pos.y = Math.max(g, SWIM_SURFACE_Y); // ride the surface while phasing, don't sink under terrain/water
      return d - step < 0.3;
    }
    const ground = groundHeight(nx, nz, this.cfg.seed);
    // landlocked creatures stop at the waterline instead of walking under it
    if (!canSwim && ground < WATER_LEVEL - SWIM_DEPTH) return false;
    const resolved = resolvePosition(this.cfg.seed, nx, nz, BODY_RADIUS);
    e.pos.x = resolved.x;
    e.pos.z = resolved.z;
    const g = groundHeight(e.pos.x, e.pos.z, this.cfg.seed);
    e.pos.y = canSwim && g < WATER_LEVEL - SWIM_DEPTH ? SWIM_SURFACE_Y : g;
    return d - step < 0.3;
  }

  // Would a normal (collision- and water-aware) step toward `dest` be blocked —
  // i.e. is a prop or deep water right in front of this mob? Used to decide when
  // a phasing evader has cleared the obstacle and can walk normally again.
  private blockedTowardSpawn(e: Entity, dest: Vec3): boolean {
    const d = dist2d(e.pos, dest);
    if (d < 0.3) return false;
    const facing = angleTo(e.pos, dest);
    const step = Math.min(e.moveSpeed * EVADE_SPEED_MULT * DT, d);
    const nx = e.pos.x + Math.sin(facing) * step;
    const nz = e.pos.z + Math.cos(facing) * step;
    if (!this.mobCanSwim(MOBS[e.templateId]) && groundHeight(nx, nz, this.cfg.seed) < WATER_LEVEL - SWIM_DEPTH) return true;
    const resolved = resolvePosition(this.cfg.seed, nx, nz, BODY_RADIUS);
    // a collider ate most of the intended movement -> still blocked
    return Math.hypot(nx - resolved.x, nz - resolved.z) > step * 0.5;
  }

  private respawnMob(mob: Entity): void {
    this.clearNonPlayerStatAuras(mob);
    mob.dead = false;
    mob.lootable = false;
    mob.loot = null;
    mob.tappedById = null;
    mob.ownerId = null; // a dead pet returns to the wild at its old camp
    mob.hostile = true; // ...and is wild again: a tamed beast must not respawn neutral
    mob.pos = { ...mob.spawnPos };
    mob.pos.y = groundHeight(mob.pos.x, mob.pos.z, this.cfg.seed);
    mob.prevPos = { ...mob.pos };
    this.rebucket(mob);
    mob.hp = mob.maxHp;
    mob.auras = [];
    mob.aiState = 'idle';
    mob.aggroTargetId = null;
    mob.inCombat = false;
    mob.leashAnchor = null;
    mob.evadeStall = 0;
    clearThreat(mob);
    this.despawnSummonedAdds(mob);
    mob.firedSummons = 0;
    mob.enraged = false;
    mob.wanderTimer = this.rng.range(2, 8);
    for (const meta of this.players.values()) {
      const e = this.entities.get(meta.entityId);
      if (e && e.targetId === mob.id) e.targetId = null;
    }
  }

  // Encounter reset: remove the adds a boss summoned this pull so retries
  // start clean (firedSummons re-fires a fresh wave per pull). Player
  // target/combo refs are cleared first, like freeInstance does.
  private despawnSummonedAdds(boss: Entity): void {
    if (boss.summonedIds.length === 0) return;
    for (const id of boss.summonedIds) {
      if (!this.entities.has(id)) continue;
      for (const meta of this.players.values()) {
        const e = this.entities.get(meta.entityId);
        if (e?.targetId === id) e.targetId = null;
        if (e?.comboTargetId === id) { e.comboTargetId = null; e.comboPoints = 0; }
      }
      this.dropEntity(id);
    }
    boss.summonedIds = [];
  }

  // Boss threshold mechanics: add waves (summonAdds) and enrage. Checked
  // every tick while the boss is in combat; thresholds fire once per pull
  // and reset on evade/respawn.
  private updateBossMechanics(mob: Entity): void {
    const tmpl = MOBS[mob.templateId];
    if (!tmpl || (!tmpl.summonAdds && !tmpl.enrage)) return;
    const hpFrac = mob.hp / Math.max(1, mob.maxHp);
    if (tmpl.summonAdds) {
      const thresholds = tmpl.summonAdds.atHpPct;
      while (mob.firedSummons < thresholds.length && hpFrac <= thresholds[mob.firedSummons]) {
        mob.firedSummons++;
        this.spawnBossAdds(mob, tmpl.summonAdds.mobId, tmpl.summonAdds.count);
      }
    }
    if (tmpl.enrage && !mob.enraged && hpFrac <= tmpl.enrage.belowHpPct) {
      mob.enraged = true;
      this.emit({ type: 'aura', targetId: mob.id, name: 'Enrage', gained: true });
      this.emit({ type: 'log', text: `${mob.name} becomes enraged!`, color: '#ff6666', entityId: mob.id });
      this.emit({ type: 'spellfx', sourceId: mob.id, targetId: mob.id, school: 'fire', fx: 'nova' });
    }
  }

  private spawnBossAdds(boss: Entity, mobId: string, count: number): void {
    const template = MOBS[mobId];
    if (!template) return;
    this.emit({ type: 'log', text: `${boss.name} calls for aid!`, color: '#ff6666', entityId: boss.id });
    this.emit({ type: 'spellfx', sourceId: boss.id, targetId: boss.id, school: 'shadow', fx: 'nova' });
    // adds spawned inside a claimed instance despawn with it
    const inst = this.instances.find((i) => {
      if (i.partyKey === null) return false;
      const o = this.instanceOriginOf(i);
      return Math.abs(boss.pos.x - o.x) < 120 && Math.abs(boss.pos.z - o.z) < 250;
    });
    const victim = boss.aggroTargetId !== null ? this.entities.get(boss.aggroTargetId) : null;
    for (let k = 0; k < count; k++) {
      const ang = (k / count) * Math.PI * 2 + 0.7;
      const pos = this.groundPos(boss.pos.x + Math.sin(ang) * 3.5, boss.pos.z + Math.cos(ang) * 3.5);
      const level = this.rng.int(template.minLevel, template.maxLevel);
      const add = createMob(this.nextId++, template, level, pos);
      add.spawnPos = { ...boss.spawnPos }; // leashes with the boss; stays dead in instances
      add.tappedById = boss.tappedById;
      this.addEntity(add);
      boss.summonedIds.push(add.id);
      inst?.mobIds.push(add.id);
      if (victim && !victim.dead && victim.kind === 'player') this.aggroMob(add, victim, false);
    }
  }

  // -------------------------------------------------------------------------
  // Targeting
  // -------------------------------------------------------------------------

  targetEntity(id: number | null, pid?: number): void {
    const r = this.resolve(pid);
    if (!r) return;
    const p = r.e;
    if (id === null) { p.targetId = null; p.autoAttack = false; return; }
    const e = this.entities.get(id);
    if (!e || (e.dead && !e.lootable)) return;
    p.targetId = id;
    if (!e.hostile || e.dead) p.autoAttack = false;
  }

  tabTarget(pid?: number): void {
    const r = this.resolve(pid);
    if (!r) return;
    const p = r.e;
    const candidates: { e: Entity; d: number }[] = [];
    this.grid.forEachInRadius(p.pos.x, p.pos.z, 40, (e, d2) => {
      if (e.kind !== 'mob' || e.dead || !e.hostile) return;
      candidates.push({ e, d: Math.sqrt(d2) });
    });
    if (candidates.length === 0) return;
    candidates.sort((a, b) => a.d - b.d);
    const curIdx = candidates.findIndex((c) => c.e.id === p.targetId);
    const next = candidates[(curIdx + 1) % candidates.length];
    p.targetId = next.e.id;
  }

  targetNearestEnemy(pid?: number): void {
    const r = this.resolve(pid);
    if (!r) return;
    const p = r.e;
    let best: Entity | null = null;
    let bestD2 = 40 * 40;
    this.grid.forEachInRadius(p.pos.x, p.pos.z, 40, (e, d2) => {
      if (e.kind !== 'mob' || e.dead || !e.hostile) return;
      if (d2 < bestD2) { bestD2 = d2; best = e; }
    });
    if (best) p.targetId = (best as Entity).id;
  }

  // -------------------------------------------------------------------------
  // Inventory, items, vendor
  // -------------------------------------------------------------------------

  countItem(itemId: string, pid?: number): number {
    const r = this.resolve(pid);
    if (!r) return 0;
    let n = 0;
    for (const s of r.meta.inventory) if (s.itemId === itemId) n += s.count;
    return n;
  }

  addItem(itemId: string, count: number, pid?: number): void {
    const r = this.resolve(pid);
    if (!r) return;
    const { meta } = r;
    const def = ITEMS[itemId];
    const existing = meta.inventory.find((s) => s.itemId === itemId);
    if (existing) existing.count += count;
    else meta.inventory.push({ itemId, count });
    this.emit({ type: 'loot', text: `You receive: ${def?.name ?? itemId}${count > 1 ? ' x' + count : ''}.`, pid: meta.entityId });
    this.onInventoryChangedForQuests(meta);
    if (meta.autoEquip && (def?.kind === 'weapon' || def?.kind === 'armor')) {
      this.maybeAutoEquip(itemId, meta);
    }
  }

  removeItem(itemId: string, count: number, pid?: number): void {
    const r = this.resolve(pid);
    if (!r) return;
    const { meta } = r;
    for (let i = meta.inventory.length - 1; i >= 0 && count > 0; i--) {
      const s = meta.inventory[i];
      if (s.itemId !== itemId) continue;
      const take = Math.min(s.count, count);
      s.count -= take;
      count -= take;
      if (s.count <= 0) meta.inventory.splice(i, 1);
    }
    this.onInventoryChangedForQuests(meta);
  }

  equipItem(itemId: string, pid?: number): void {
    const r = this.resolve(pid);
    if (!r) return;
    const { meta, e: p } = r;
    const def = ITEMS[itemId];
    if (!def || !def.slot || (def.kind !== 'weapon' && def.kind !== 'armor')) return;
    if (this.countItem(itemId, meta.entityId) <= 0) return;
    if (def.requiredClass && !def.requiredClass.includes(meta.cls)) {
      this.error(meta.entityId, 'You cannot equip that.');
      return;
    }
    const slot = def.slot;
    const old = meta.equipment[slot];
    this.removeItem(itemId, 1, meta.entityId);
    if (old) this.addItemSilent(old, 1, meta);
    meta.equipment[slot] = itemId;
    recalcPlayerStats(p, meta.cls, meta.equipment);
    this.emit({ type: 'log', text: `Equipped ${def.name}.`, color: '#8f8', pid: meta.entityId });
  }

  private hasFishableWaterAhead(p: Entity): boolean {
    const sin = Math.sin(p.facing);
    const cos = Math.cos(p.facing);
    return FISHING_SAMPLE_DISTANCES.some((d) =>
      groundHeight(p.pos.x + sin * d, p.pos.z + cos * d, this.cfg.seed) < WATER_LEVEL - SWIM_DEPTH);
  }

  private startFishing(p: Entity, meta: PlayerMeta): void {
    if (p.dead) { this.error(meta.entityId, "You can't do that while dead."); return; }
    if (p.inCombat) { this.error(meta.entityId, "You can't do that while in combat."); return; }
    if (this.isSwimming(p)) { this.error(meta.entityId, "You can't do that while swimming."); return; }
    if (p.castingAbility || isConsuming(p)) { this.error(meta.entityId, 'You are busy.'); return; }
    if (!this.hasFishableWaterAhead(p)) { this.error(meta.entityId, 'You need to face fishable water.'); return; }
    if (p.sitting) this.standUp(p);
    p.castingAbility = FISHING_CAST_ID;
    p.castTotal = FISHING_CAST_TIME;
    p.castRemaining = FISHING_CAST_TIME;
    p.channeling = false;
    this.emit({ type: 'castStart', entityId: p.id, ability: FISHING_CAST_ID, time: FISHING_CAST_TIME });
  }

  private completeFishing(p: Entity, meta: PlayerMeta): void {
    const roll = this.rng.next();
    if (roll < 0.7) {
      this.addItem('raw_mirror_trout', 1, meta.entityId);
    } else if (roll < 0.9) {
      this.addItem('tangled_weed', 1, meta.entityId);
    } else {
      this.emit({ type: 'log', text: 'No fish are biting.', color: '#999', pid: p.id });
    }
  }

  useItem(itemId: string, pid?: number): void {
    const r = this.resolve(pid);
    if (!r) return;
    const { meta, e: p } = r;
    const def = ITEMS[itemId];
    if (!def) return;
    if (this.countItem(itemId, meta.entityId) <= 0) { this.error(meta.entityId, "You don't have that item."); return; }
    if (def.use?.type === 'fishing') {
      this.startFishing(p, meta);
      return;
    }
    if (p.castingAbility === FISHING_CAST_ID) { this.error(meta.entityId, 'You are busy.'); return; }
    if (p.dead) return;
    if (def.kind === 'food' || def.kind === 'drink') {
      if (p.inCombat) { this.error(meta.entityId, "You can't do that while in combat."); return; }
      if (this.isSwimming(p)) { this.error(meta.entityId, "You can't do that while swimming."); return; }
      this.removeItem(itemId, 1, meta.entityId);
      p.sitting = true;
      // food and drink occupy separate slots, so you can do both at once
      const slot = def.kind === 'food' ? 'eating' : 'drinking';
      p[slot] = {
        itemId,
        kind: def.kind,
        hpPer2s: def.foodHp ? Math.round(def.foodHp / CONSUME_TICKS) : 0,
        manaPer2s: def.drinkMana ? Math.round(def.drinkMana / CONSUME_TICKS) : 0,
        remaining: CONSUME_DURATION,
      };
      this.emit({ type: 'log', text: def.kind === 'food' ? 'You sit down to eat.' : 'You sit down to drink.', color: '#999', pid: meta.entityId });
    } else if (def.kind === 'potion') {
      // instant, usable in combat, on a shared 60s cooldown (#103)
      if (this.time < p.potionCooldownUntil) {
        this.error(meta.entityId, 'That potion is not ready yet.');
        return;
      }
      const restoresMana = (def.potionMana ?? 0) > 0 && p.resourceType === 'mana';
      const restoresHp = (def.potionHp ?? 0) > 0 && p.hp < p.maxHp;
      if (!restoresHp && !restoresMana) {
        this.error(meta.entityId, p.hp >= p.maxHp && (def.potionMana ?? 0) === 0 ? 'You are already at full health.' : 'Nothing to restore.');
        return;
      }
      this.removeItem(itemId, 1, meta.entityId);
      p.potionCooldownUntil = this.time + POTION_COOLDOWN;
      if (restoresHp) {
        const heal = Math.min(def.potionHp!, p.maxHp - p.hp);
        p.hp += heal;
        this.emit({ type: 'heal', targetId: p.id, amount: heal });
      }
      if (restoresMana) {
        p.resource = Math.min(p.maxResource, p.resource + def.potionMana!);
      }
      this.emit({ type: 'log', text: `You quaff ${def.name}.`, color: '#c9f', pid: meta.entityId });
    } else if (def.kind === 'weapon' || def.kind === 'armor') {
      this.equipItem(itemId, meta.entityId);
    }
  }

  buyItem(npcId: number, itemId: string, pid?: number): void {
    const r = this.resolve(pid);
    if (!r) return;
    const { meta, e: p } = r;
    const npc = this.entities.get(npcId);
    const def = ITEMS[itemId];
    if (!npc || npc.kind !== 'npc' || npc.vendorItems.length === 0) {
      this.error(meta.entityId, 'That merchant is not available.');
      return;
    }
    if (!npc.vendorItems.includes(itemId)) { this.error(meta.entityId, 'That item is not sold here.'); return; }
    if (!def?.buyValue) { this.error(meta.entityId, 'That item is not for sale.'); return; }
    if (dist2d(p.pos, npc.pos) > INTERACT_RANGE + 2) { this.error(meta.entityId, 'Too far away.'); return; }
    if (meta.copper < def.buyValue) { this.error(meta.entityId, 'Not enough money.'); return; }
    meta.copper -= def.buyValue;
    this.addItem(itemId, 1, meta.entityId);
    this.emit({ type: 'vendor', action: 'buy', itemId, pid: meta.entityId });
  }

  private vendorInRange(p: Entity): boolean {
    return [...this.entities.values()].some((e) =>
      e.kind === 'npc' && e.vendorItems.length > 0 && dist2d(p.pos, e.pos) <= INTERACT_RANGE + 2);
  }

  private recordVendorBuyback(meta: PlayerMeta, itemId: string, count: number): void {
    const existingIndex = meta.vendorBuyback.findIndex((s) => s.itemId === itemId);
    if (existingIndex >= 0) {
      const [existing] = meta.vendorBuyback.splice(existingIndex, 1);
      existing.count += count;
      meta.vendorBuyback.unshift(existing);
    } else {
      meta.vendorBuyback.unshift({ itemId, count });
    }
    while (meta.vendorBuyback.length > VENDOR_BUYBACK_LIMIT) meta.vendorBuyback.pop();
  }

  sellItem(itemId: string, count = 1, pid?: number): void {
    const r = this.resolve(pid);
    if (!r) return;
    const { meta, e: p } = r;
    const def = ITEMS[itemId];
    const available = this.countItem(itemId, meta.entityId);
    if (!def || available <= 0) { this.error(meta.entityId, "You don't have that item."); return; }
    if (p.dead) { this.error(meta.entityId, "You can't do that while dead."); return; }
    const sellCount = Number.isFinite(count) ? Math.min(Math.floor(count), available) : 0;
    if (sellCount <= 0) return;
    if (!this.vendorInRange(p)) { this.error(meta.entityId, 'There is no merchant nearby.'); return; }
    if (def.kind === 'quest') { this.error(meta.entityId, 'You cannot sell quest items.'); return; }
    this.removeItem(itemId, sellCount, meta.entityId);
    this.recordVendorBuyback(meta, itemId, sellCount);
    const payout = def.sellValue * sellCount;
    meta.copper += payout;
    this.emit({ type: 'vendor', action: 'sell', itemId, pid: meta.entityId });
    this.emit({ type: 'loot', text: `Sold ${def.name}${sellCount > 1 ? ' x' + sellCount : ''} for ${formatMoney(payout)}.`, pid: meta.entityId });
  }

  buyBackItem(itemId: string, pid?: number): void {
    const r = this.resolve(pid);
    if (!r) return;
    const { meta, e: p } = r;
    const def = ITEMS[itemId];
    const slot = meta.vendorBuyback.find((s) => s.itemId === itemId);
    if (!def || !slot || slot.count <= 0) { this.error(meta.entityId, 'That item is not available for buyback.'); return; }
    if (p.dead) { this.error(meta.entityId, "You can't do that while dead."); return; }
    if (!this.vendorInRange(p)) { this.error(meta.entityId, 'There is no merchant nearby.'); return; }
    if (meta.copper < def.sellValue) { this.error(meta.entityId, 'Not enough money.'); return; }
    meta.copper -= def.sellValue;
    slot.count -= 1;
    if (slot.count <= 0) meta.vendorBuyback = meta.vendorBuyback.filter((s) => s !== slot);
    this.addItemSilent(itemId, 1, meta);
    this.onInventoryChangedForQuests(meta);
    this.emit({ type: 'vendor', action: 'buyback', itemId, pid: meta.entityId });
    this.emit({ type: 'loot', text: `Bought back ${def.name} for ${formatMoney(def.sellValue)}.`, pid: meta.entityId });
  }

  private addItemSilent(itemId: string, count: number, meta: PlayerMeta): void {
    const existing = meta.inventory.find((s) => s.itemId === itemId);
    if (existing) existing.count += count;
    else meta.inventory.push({ itemId, count });
  }

  private maybeAutoEquip(itemId: string, meta: PlayerMeta): void {
    const def = ITEMS[itemId];
    if (!def?.slot) return;
    if (def.requiredClass && !def.requiredClass.includes(meta.cls)) return;
    if (def.kind === 'weapon') {
      const cur = meta.equipment.mainhand ? ITEMS[meta.equipment.mainhand]?.weapon : null;
      const next = def.weapon;
      if (next && (!cur || next.min + next.max > cur.min + cur.max)) this.equipItem(itemId, meta.entityId);
    } else {
      const cur = meta.equipment[def.slot] ? ITEMS[meta.equipment[def.slot]!] : null;
      if (!cur || (def.stats?.armor ?? 0) > (cur.stats?.armor ?? 0)) this.equipItem(itemId, meta.entityId);
    }
  }

  // -------------------------------------------------------------------------
  // Interaction: looting, quest NPCs, ground objects
  // -------------------------------------------------------------------------

  lootCorpse(mobId: number, pid?: number): void {
    const r = this.resolve(pid);
    if (!r) return;
    const { meta, e: p } = r;
    const mob = this.entities.get(mobId);
    if (!mob || !mob.lootable || !mob.loot) return;
    if (mob.tappedById !== null && mob.tappedById !== meta.entityId) {
      // party members of the tapper share loot rights
      const tapperParty = this.partyOf(mob.tappedById);
      if (!tapperParty || !tapperParty.members.includes(meta.entityId)) {
        this.error(meta.entityId, "You don't have permission to loot that.");
        return;
      }
    }
    if (dist2d(p.pos, mob.pos) > INTERACT_RANGE) { this.error(meta.entityId, 'Too far away.'); return; }
    if (mob.loot.copper > 0) {
      meta.copper += mob.loot.copper;
      meta.counters.lootCopper += mob.loot.copper;
      this.emit({ type: 'loot', text: `You loot ${formatMoney(mob.loot.copper)}.`, pid: meta.entityId });
      mob.loot.copper = 0;
    }
    for (const s of [...mob.loot.items]) {
      if (!this.lootSlotVisibleTo(s, meta.entityId)) continue;
      if (s.personalFor) {
        this.addItem(s.itemId, 1, meta.entityId);
        s.personalFor = s.personalFor.filter((id) => id !== meta.entityId);
        continue;
      }
      for (let i = 0; i < s.count; i++) {
        if (!this.rollGroupLoot(s.itemId, mob, meta)) this.addItem(s.itemId, 1, meta.entityId);
      }
      s.count = 0;
    }
    this.pruneCorpseLoot(mob);
    if (p.targetId === mobId) p.targetId = null;
  }

  pickUpObject(objId: number, pid?: number): void {
    const r = this.resolve(pid);
    if (!r) return;
    const { meta, e: p } = r;
    const obj = this.entities.get(objId);
    if (!obj || obj.kind !== 'object' || !obj.lootable || !obj.objectItemId) return;
    if (dist2d(p.pos, obj.pos) > INTERACT_RANGE) { this.error(meta.entityId, 'Too far away.'); return; }
    const def = ITEMS[obj.objectItemId];
    if (def?.questId) {
      const qp = meta.questLog.get(def.questId);
      if (!qp || qp.state !== 'active') { this.error(meta.entityId, 'It is nailed shut.'); return; }
      const quest = QUESTS[def.questId];
      const objIdx = quest.objectives.findIndex((o) => o.type === 'collect' && o.itemId === obj.objectItemId);
      if (objIdx >= 0 && this.countItem(obj.objectItemId, meta.entityId) >= quest.objectives[objIdx].count) {
        this.error(meta.entityId, 'You have enough of those.');
        return;
      }
    }
    this.addItem(obj.objectItemId, 1, meta.entityId);
    obj.lootable = false;
    obj.respawnTimer = OBJECT_RESPAWN;
  }

  interact(pid?: number): void {
    const r = this.resolve(pid);
    if (!r) return;
    const p = r.e;
    let bestCorpse: Entity | null = null;
    let bestCorpseD2 = INTERACT_RANGE * INTERACT_RANGE;
    let bestObj: Entity | null = null;
    let bestObjD2 = INTERACT_RANGE * INTERACT_RANGE;
    let bestNpc: Entity | null = null;
    let bestNpcD2 = INTERACT_RANGE * INTERACT_RANGE;
    this.grid.forEachInRadius(p.pos.x, p.pos.z, INTERACT_RANGE, (e, d2) => {
      if (e.kind === 'mob' && e.lootable && d2 < bestCorpseD2) { bestCorpse = e; bestCorpseD2 = d2; }
      if (e.kind === 'object' && e.lootable && d2 < bestObjD2) { bestObj = e; bestObjD2 = d2; }
      if (e.kind === 'npc' && d2 < bestNpcD2) { bestNpc = e; bestNpcD2 = d2; }
    });
    // re-read through wider types: TS cannot see the closure assignments above
    const corpse = bestCorpse as Entity | null;
    const obj = bestObj as Entity | null;
    const npc = bestNpc as Entity | null;
    if (corpse) { this.lootCorpse(corpse.id, p.id); return; }
    if (obj) {
      if (obj.templateId === 'dungeon_door' && obj.dungeonId) { this.enterDungeon(obj.dungeonId, p.id); return; }
      if (obj.templateId === 'dungeon_exit') { this.leaveDungeon(p.id); return; }
      this.pickUpObject(obj.id, p.id);
      return;
    }
    if (npc) this.talkToNpc(npc.id, p.id);
  }

  talkToNpc(npcId: number, pid?: number): void {
    const r = this.resolve(pid);
    if (!r) return;
    const { meta } = r;
    const npc = this.entities.get(npcId);
    if (!npc || npc.kind !== 'npc') return;
    for (const qid of npc.questIds) {
      if (QUESTS[qid].turnInNpcId === npc.templateId && meta.questLog.get(qid)?.state === 'ready') {
        this.turnInQuest(qid, meta.entityId);
        return;
      }
    }
    for (const qid of npc.questIds) {
      if (QUESTS[qid].giverNpcId === npc.templateId && this.questState(qid, meta.entityId) === 'available') {
        this.acceptQuest(qid, meta.entityId);
        return;
      }
    }
  }

  // -------------------------------------------------------------------------
  // Quests
  // -------------------------------------------------------------------------

  questState(questId: string, pid?: number): QuestState {
    const r = this.resolve(pid);
    if (!r) return 'unavailable';
    return computeQuestState(questId, r.meta.questLog, r.meta.questsDone, r.e.level);
  }

  private questNpcFor(questId: string, role: 'giver' | 'turnIn', p: Entity): { npc: Entity | null; tooFar: boolean } {
    const quest = QUESTS[questId];
    const templateId = role === 'giver' ? quest.giverNpcId : quest.turnInNpcId;
    let sawNpc = false;
    for (const e of this.entities.values()) {
      if (e.kind !== 'npc' || e.templateId !== templateId) continue;
      sawNpc = true;
      if (dist2d(p.pos, e.pos) <= INTERACT_RANGE + 2) return { npc: e, tooFar: false };
    }
    return { npc: null, tooFar: sawNpc };
  }

  acceptQuest(questId: string, pid?: number): void {
    const r = this.resolve(pid);
    if (!r) return;
    const quest = QUESTS[questId];
    const { meta, e: p } = r;
    if (!quest) { this.error(meta.entityId, 'That quest is not available.'); return; }
    if (this.questState(questId, meta.entityId) !== 'available') { this.error(meta.entityId, 'That quest is not available.'); return; }
    const nearby = this.questNpcFor(questId, 'giver', p);
    if (!nearby.npc) {
      this.error(meta.entityId, nearby.tooFar ? 'Too far away.' : 'That quest giver is not nearby.');
      return;
    }
    meta.questLog.set(questId, { questId, counts: quest.objectives.map(() => 0), state: 'active' });
    this.emit({ type: 'questAccepted', questId, pid: meta.entityId });
    this.emit({ type: 'log', text: `Quest accepted: ${quest.name}`, color: '#ff0', pid: meta.entityId });
    this.onInventoryChangedForQuests(meta);
  }

  abandonQuest(questId: string, pid?: number): void {
    const r = this.resolve(pid);
    if (!r) return;
    const { meta } = r;
    if (!meta.questLog.has(questId)) return;
    meta.questLog.delete(questId);
    this.emit({ type: 'log', text: `Quest abandoned: ${QUESTS[questId].name}`, color: '#f66', pid: meta.entityId });
  }

  turnInQuest(questId: string, pid?: number): void {
    const r = this.resolve(pid);
    if (!r) return;
    const { meta, e: p } = r;
    const quest = QUESTS[questId];
    if (!quest) { this.error(meta.entityId, 'That quest is not available.'); return; }
    const qp = meta.questLog.get(questId);
    if (!qp) { this.error(meta.entityId, 'That quest is not in your log.'); return; }
    if (qp.state !== 'ready') { this.error(meta.entityId, 'That quest is not complete.'); return; }
    const nearby = this.questNpcFor(questId, 'turnIn', p);
    if (!nearby.npc) {
      this.error(meta.entityId, nearby.tooFar ? 'Too far away.' : 'That quest turn-in is not nearby.');
      return;
    }

    for (const obj of quest.objectives) {
      if (obj.type === 'collect' && obj.itemId) this.removeItem(obj.itemId, obj.count, meta.entityId);
    }
    qp.state = 'done';
    meta.questLog.delete(questId);
    meta.questsDone.add(questId);
    meta.counters.questsCompleted++;
    if (quest.copperReward > 0) {
      meta.copper += quest.copperReward;
      this.emit({ type: 'loot', text: `You receive ${formatMoney(quest.copperReward)}.`, pid: meta.entityId });
    }
    const rewardItem = questRewardItemId(quest, meta.cls);
    if (rewardItem) this.addItem(rewardItem, 1, meta.entityId);
    this.grantXp(quest.xpReward, meta);
    this.emit({ type: 'questDone', questId, pid: meta.entityId });
    this.emit({ type: 'log', text: `Quest completed: ${quest.name}`, color: '#ff0', pid: meta.entityId });
  }

  private onMobKilledForQuests(mob: Entity, meta: PlayerMeta): void {
    for (const qp of meta.questLog.values()) {
      if (qp.state !== 'active') continue;
      const quest = QUESTS[qp.questId];
      let changed = false;
      quest.objectives.forEach((obj, i) => {
        if (obj.type === 'kill' && obj.targetMobId === mob.templateId && qp.counts[i] < obj.count) {
          qp.counts[i]++;
          changed = true;
          meta.counters.questProgress++;
          this.emit({ type: 'questProgress', questId: qp.questId, text: `${obj.label}: ${qp.counts[i]}/${obj.count}`, pid: meta.entityId });
        }
      });
      if (changed) this.checkQuestReady(qp, meta);
    }
  }

  private onInventoryChangedForQuests(meta: PlayerMeta): void {
    for (const qp of meta.questLog.values()) {
      const quest = QUESTS[qp.questId];
      let changed = false;
      quest.objectives.forEach((obj, i) => {
        if (obj.type === 'collect' && obj.itemId) {
          const have = Math.min(obj.count, this.countItem(obj.itemId, meta.entityId));
          if (have !== qp.counts[i]) {
            if (have > qp.counts[i]) meta.counters.questProgress += have - qp.counts[i];
            qp.counts[i] = have;
            changed = true;
            this.emit({ type: 'questProgress', questId: qp.questId, text: `${obj.label}: ${have}/${obj.count}`, pid: meta.entityId });
          }
        }
      });
      if (changed) this.checkQuestReady(qp, meta);
    }
  }

  private checkQuestReady(qp: QuestProgress, meta: PlayerMeta): void {
    const quest = QUESTS[qp.questId];
    const ready = quest.objectives.every((obj, i) => qp.counts[i] >= obj.count);
    if (ready && qp.state === 'active') {
      qp.state = 'ready';
      this.emit({ type: 'questReady', questId: qp.questId, pid: meta.entityId });
      this.emit({ type: 'log', text: `${quest.name} (Complete)`, color: '#ff0', pid: meta.entityId });
    } else if (!ready && qp.state === 'ready') {
      qp.state = 'active';
    }
  }

  // -------------------------------------------------------------------------
  // Player death / respawn
  // -------------------------------------------------------------------------

  releaseSpirit(pid?: number): void {
    const r = this.resolve(pid);
    if (!r) return;
    const { meta, e: p } = r;
    if (!p.dead) return;
    p.dead = false;
    // dying in a dungeon sends you to the graveyard of the zone its door is
    // in; dying outdoors, to your current zone's graveyard
    const dungeon = dungeonAt(p.pos.x);
    const graveyard = zoneAt(dungeon ? dungeon.doorPos.z : p.pos.z).graveyard;
    p.pos = this.groundPos(graveyard.x, graveyard.z);
    p.prevPos = { ...p.pos };
    this.rebucket(p);
    p.facing = 0;
    p.auras = [];
    p.ccDr.clear();
    recalcPlayerStats(p, meta.cls, meta.equipment);
    p.hp = p.maxHp;
    p.resource = p.resourceType === 'mana' ? p.maxResource : p.resourceType === 'energy' ? 100 : 0;
    p.targetId = null;
    p.combatTimer = 99;
    p.inCombat = false;
    this.emit({ type: 'respawn', pid: meta.entityId });
  }

  // Token-bucket throttle: returns false (and notifies the player once) when
  // they are out of chat tokens. Keeps /g and /w from being spam amplifiers.
  private chatAllowed(pid: number): boolean {
    let b = this.chatTokens.get(pid);
    if (!b) { b = { tokens: CHAT_BURST, at: this.time }; this.chatTokens.set(pid, b); }
    b.tokens = Math.min(CHAT_BURST, b.tokens + (this.time - b.at) * CHAT_REFILL);
    b.at = this.time;
    if (b.tokens < 1) return false;
    b.tokens -= 1;
    return true;
  }

  chat(text: string, pid?: number): SentChat | null {
    const r = this.resolve(pid);
    if (!r) return null;
    const raw = text.trim().slice(0, 200);
    if (!raw) return null;
    if (!this.chatAllowed(r.meta.entityId)) {
      this.error(r.meta.entityId, 'You are sending messages too quickly.');
      return null;
    }

    if (/^\/who(?:\s|$)/i.test(raw)) {
      this.error(r.meta.entityId, 'The /who roster is available in online play.');
      return null;
    }

    // "/w name message" — private whisper to an online player
    const wm = /^\/(?:w|whisper|t|tell)\s+(\S+)\s+([\s\S]+)$/i.exec(raw);
    if (wm) {
      const targetName = wm[1];
      const msg = wm[2].trim();
      if (!msg) return null;
      // exact case wins outright; otherwise a case-insensitive match is used
      // only when unambiguous, so 'Bet' and 'bet' can't silently intercept
      // each other's whispers
      let target: PlayerMeta | null = null;
      const ciMatches: PlayerMeta[] = [];
      const wanted = targetName.toLowerCase();
      for (const meta of this.players.values()) {
        if (meta.name === targetName) { target = meta; break; }
        if (meta.name.toLowerCase() === wanted) ciMatches.push(meta);
      }
      if (!target) {
        if (ciMatches.length === 1) target = ciMatches[0];
        else if (ciMatches.length > 1) { this.error(r.meta.entityId, `Several players match '${targetName}'. Use exact capitalization.`); return null; }
      }
      if (!target) { this.error(r.meta.entityId, `There is no player named '${targetName}' online.`); return null; }
      if (target.entityId === r.meta.entityId) { this.error(r.meta.entityId, 'You mutter to yourself. Nobody hears it.'); return null; }
      this.emit({ type: 'chat', fromPid: r.meta.entityId, from: r.meta.name, text: msg, channel: 'whisper', pid: target.entityId });
      this.emit({ type: 'chat', fromPid: r.meta.entityId, from: r.meta.name, to: target.name, text: msg, channel: 'whisper', pid: r.meta.entityId });
      return { channel: 'whisper', message: msg };
    }

    // "/p message" goes to the party channel
    if (/^\/p(arty)?\s/i.test(raw)) {
      const clean = raw.replace(/^\/p(arty)?\s+/i, '').trim();
      if (!clean) return null;
      const party = this.partyOf(r.meta.entityId);
      if (!party) { this.error(r.meta.entityId, 'You are not in a party.'); return null; }
      for (const mPid of party.members) {
        this.emit({ type: 'chat', fromPid: r.meta.entityId, from: r.meta.name, text: clean, channel: 'party', pid: mPid });
      }
      return { channel: 'party', message: clean };
    }

    // "/g message" — world-wide general channel (no pid = broadcast to all)
    if (/^\/g(eneral)?\s/i.test(raw)) {
      const clean = raw.replace(/^\/g(eneral)?\s+/i, '').trim();
      if (!clean) return null;
      this.emit({ type: 'chat', fromPid: r.meta.entityId, from: r.meta.name, text: clean, channel: 'general' });
      return { channel: 'general', message: clean };
    }

    // bare text and "/s" are local say; "/y" carries further — both are
    // delivered per-player by range and carry the speaker for chat bubbles
    let channel: 'say' | 'yell' = 'say';
    let clean = raw;
    if (/^\/y(ell)?\s/i.test(raw)) { channel = 'yell'; clean = raw.replace(/^\/y(ell)?\s+/i, '').trim(); }
    else if (/^\/s(ay)?\s/i.test(raw)) { clean = raw.replace(/^\/s(ay)?\s+/i, '').trim(); }
    else if (raw.startsWith('/')) { this.error(r.meta.entityId, `Unknown command: ${raw.split(' ')[0]}. Try /s /y /w /p /g.`); return null; }
    if (!clean) return null;
    const range = channel === 'yell' ? YELL_RANGE : SAY_RANGE;
    for (const meta of this.players.values()) {
      const e = this.entities.get(meta.entityId);
      if (!e || dist2d(r.e.pos, e.pos) > range) continue;
      this.emit({ type: 'chat', fromPid: r.meta.entityId, from: r.meta.name, text: clean, channel, entityId: r.e.id, pid: meta.entityId });
    }
    return { channel, message: clean };
  }

  // -------------------------------------------------------------------------
  // Hostility: mobs are hostile to players; players are hostile to each other
  // only while dueling.
  // -------------------------------------------------------------------------

  isHostileTo(attacker: Entity, target: Entity): boolean {
    if (target.kind === 'mob') return target.hostile;
    if (target.kind === 'player' && attacker.kind === 'player') {
      const duel = this.duels.get(attacker.id);
      if (duel && duel.state === 'active' && (duel.a === target.id || duel.b === target.id)) return true;
      const match = this.arenaMatches.get(attacker.id);
      return !!match && match.state === 'active' && (match.a === target.id || match.b === target.id);
    }
    return false;
  }

  private isFriendlyTo(caster: Entity, target: Entity): boolean {
    if (target.kind === 'player') return !this.isHostileTo(caster, target);
    if (target.kind === 'mob' && target.ownerId !== null) {
      const owner = this.entities.get(target.ownerId);
      return !!owner && owner.kind === 'player' && !this.isHostileTo(caster, owner);
    }
    return false;
  }

  // -------------------------------------------------------------------------
  // Parties
  // -------------------------------------------------------------------------

  partyOf(pid: number): Party | null {
    const partyId = this.partyByPid.get(pid);
    return partyId !== undefined ? this.parties.get(partyId) ?? null : null;
  }

  private hasActiveInvite(map: Map<number, { fromPid: number; expires: number }>, targetPid: number): boolean {
    const invite = map.get(targetPid);
    if (!invite) return false;
    if (invite.expires < this.time) {
      map.delete(targetPid);
      return false;
    }
    return true;
  }

  private hasPendingSocialInvite(targetPid: number): boolean {
    return this.hasActiveInvite(this.partyInvites, targetPid)
      || this.hasActiveInvite(this.tradeInvites, targetPid)
      || this.hasActiveInvite(this.duelInvites, targetPid);
  }

  partyInvite(targetPid: number, pid?: number): void {
    const r = this.resolve(pid);
    const target = this.players.get(targetPid);
    if (!r || !target) return;
    if (targetPid === r.meta.entityId) return;
    const myParty = this.partyOf(r.meta.entityId);
    if (myParty && myParty.leader !== r.meta.entityId) { this.error(r.meta.entityId, 'Only the party leader may invite.'); return; }
    if (myParty && myParty.members.length >= PARTY_MAX) { this.error(r.meta.entityId, 'Your party is full.'); return; }
    if (this.partyOf(targetPid)) { this.error(r.meta.entityId, `${target.name} is already in a party.`); return; }
    if (this.hasPendingSocialInvite(targetPid)) { this.error(r.meta.entityId, `${target.name} already has a pending invitation.`); return; }
    this.partyInvites.set(targetPid, { fromPid: r.meta.entityId, expires: this.time + 30 });
    this.emit({ type: 'partyInvite', fromPid: r.meta.entityId, fromName: r.meta.name, pid: targetPid });
    this.emit({ type: 'log', text: `You have invited ${target.name} to your party.`, color: '#aaf', pid: r.meta.entityId });
  }

  partyAccept(pid?: number): void {
    const r = this.resolve(pid);
    if (!r) return;
    const invite = this.partyInvites.get(r.meta.entityId);
    if (!invite || invite.expires < this.time) { this.error(r.meta.entityId, 'The invitation has expired.'); return; }
    this.partyInvites.delete(r.meta.entityId);
    // A player can hold a stale incoming invite while having since joined or
    // formed a party of their own (inviting others never consumes one's own
    // pending invite). Accepting now would add them to a second party's member
    // list, corrupting the "at most one party" invariant.
    if (this.partyOf(r.meta.entityId)) { this.error(r.meta.entityId, 'You are already in a party.'); return; }
    const leaderMeta = this.players.get(invite.fromPid);
    if (!leaderMeta) return;
    let party = this.partyOf(invite.fromPid);
    if (!party) {
      party = { id: this.nextPartyId++, leader: invite.fromPid, members: [invite.fromPid] };
      this.parties.set(party.id, party);
      this.partyByPid.set(invite.fromPid, party.id);
    }
    if (party.members.length >= PARTY_MAX) { this.error(r.meta.entityId, 'That party is full.'); return; }
    party.members.push(r.meta.entityId);
    this.partyByPid.set(r.meta.entityId, party.id);
    for (const mPid of party.members) {
      this.emit({ type: 'log', text: `${r.meta.name} joins the party.`, color: '#aaf', pid: mPid });
    }
  }

  partyDecline(pid?: number): void {
    const r = this.resolve(pid);
    if (!r) return;
    const invite = this.partyInvites.get(r.meta.entityId);
    this.partyInvites.delete(r.meta.entityId);
    if (invite) {
      this.emit({ type: 'log', text: `${r.meta.name} declines your invitation.`, color: '#aaf', pid: invite.fromPid });
    }
  }

  partyLeave(pid?: number): void {
    const r = this.resolve(pid);
    if (!r) return;
    this.removeFromParty(r.meta.entityId, 'leaves the party');
  }

  partyKick(targetPid: number, pid?: number): void {
    const r = this.resolve(pid);
    if (!r) return;
    const party = this.partyOf(r.meta.entityId);
    if (!party || party.leader !== r.meta.entityId) { this.error(r.meta.entityId, 'You are not the party leader.'); return; }
    if (!party.members.includes(targetPid) || targetPid === r.meta.entityId) return;
    this.removeFromParty(targetPid, 'has been removed from the party');
  }

  private removeFromParty(pid: number, verb: string): void {
    const party = this.partyOf(pid);
    if (!party) return;
    const meta = this.players.get(pid);
    party.members = party.members.filter((m) => m !== pid);
    this.partyByPid.delete(pid);
    for (const mPid of [...party.members, pid]) {
      this.emit({ type: 'log', text: `${meta?.name ?? 'Someone'} ${verb}.`, color: '#aaf', pid: mPid });
    }
    if (party.members.length <= 1) {
      for (const mPid of party.members) {
        this.partyByPid.delete(mPid);
        this.emit({ type: 'log', text: 'Your party has disbanded.', color: '#aaf', pid: mPid });
      }
      this.parties.delete(party.id);
      this.partyMarkers.delete(party.id);
    } else if (party.leader === pid) {
      party.leader = party.members[0];
      const newLeader = this.players.get(party.leader);
      for (const mPid of party.members) {
        this.emit({ type: 'log', text: `${newLeader?.name ?? 'Someone'} is now the party leader.`, color: '#aaf', pid: mPid });
      }
    }
  }

  // -------------------------------------------------------------------------
  // Raid markers (party-scoped target markers)
  // -------------------------------------------------------------------------

  // Every mark visible to the actor's party, as { entityId: markerId }. Empty
  // when the actor is not in a party. Pure read — cleanup happens on the
  // death/despawn/disband hooks, never here.
  markersFor(pid: number): Record<number, number> {
    const party = this.partyOf(pid);
    if (!party) return {};
    const marks = this.partyMarkers.get(party.id);
    if (!marks) return {};
    const out: Record<number, number> = {};
    for (const [eid, mid] of marks) out[eid] = mid;
    return out;
  }

  setMarker(entityId: number, markerId: number, pid?: number): void {
    const r = this.resolve(pid);
    if (!r) return;
    const party = this.partyOf(r.meta.entityId);
    if (!party) { this.error(r.meta.entityId, 'You must be in a party to use raid markers.'); return; }
    if (!Number.isInteger(markerId) || markerId < 0 || markerId > 7) return;
    // markable: a live, wild, hostile mob (not players, NPCs, corpses, or pets)
    const target = this.entities.get(entityId);
    if (!target || target.kind !== 'mob' || target.dead || !target.hostile || target.ownerId !== null) return;
    let marks = this.partyMarkers.get(party.id);
    if (!marks) { marks = new Map(); this.partyMarkers.set(party.id, marks); }
    // re-applying the same symbol to the same mob toggles it off
    if (marks.get(entityId) === markerId) { marks.delete(entityId); return; }
    // a symbol is unique within the party: take it off whatever held it
    for (const [eid, mid] of marks) { if (mid === markerId) marks.delete(eid); }
    marks.set(entityId, markerId);
  }

  clearMarker(entityId: number, pid?: number): void {
    const r = this.resolve(pid);
    if (!r) return;
    const party = this.partyOf(r.meta.entityId);
    if (!party) return;
    this.partyMarkers.get(party.id)?.delete(entityId);
  }

  // The local player's view of one entity's mark (for the renderer). Direct
  // lookup, no per-call allocation.
  markerFor(entityId: number): number | null {
    const party = this.partyOf(this.primaryId);
    if (!party) return null;
    return this.partyMarkers.get(party.id)?.get(entityId) ?? null;
  }

  // Strip an entity's mark from every party — used when it dies or despawns.
  private clearEntityMarker(entityId: number): void {
    for (const marks of this.partyMarkers.values()) marks.delete(entityId);
  }

  // -------------------------------------------------------------------------
  // Duels
  // -------------------------------------------------------------------------

  duelRequest(targetPid: number, pid?: number): void {
    const r = this.resolve(pid);
    const target = this.players.get(targetPid);
    const targetE = this.entities.get(targetPid);
    if (!r || !target || !targetE) return;
    if (targetPid === r.meta.entityId) return;
    if (this.duels.has(r.meta.entityId) || this.duels.has(targetPid)) { this.error(r.meta.entityId, 'A duel is already in progress.'); return; }
    if (dist2d(r.e.pos, targetE.pos) > 30) { this.error(r.meta.entityId, 'Target is too far away.'); return; }
    if (this.hasPendingSocialInvite(targetPid)) { this.error(r.meta.entityId, `${target.name} already has a pending invitation.`); return; }
    this.duelInvites.set(targetPid, { fromPid: r.meta.entityId, expires: this.time + 30 });
    this.emit({ type: 'duelRequest', fromPid: r.meta.entityId, fromName: r.meta.name, pid: targetPid });
    this.emit({ type: 'log', text: `You have challenged ${target.name} to a duel.`, color: '#fa6', pid: r.meta.entityId });
  }

  duelAccept(pid?: number): void {
    const r = this.resolve(pid);
    if (!r) return;
    const invite = this.duelInvites.get(r.meta.entityId);
    if (!invite || invite.expires < this.time) { this.error(r.meta.entityId, 'The challenge has expired.'); return; }
    this.duelInvites.delete(r.meta.entityId);
    const other = this.players.get(invite.fromPid);
    if (!other) return;
    const duel: DuelState = { a: invite.fromPid, b: r.meta.entityId, state: 'countdown', timer: DUEL_COUNTDOWN };
    this.duels.set(duel.a, duel);
    this.duels.set(duel.b, duel);
    for (const dPid of [duel.a, duel.b]) {
      this.emit({ type: 'duelCountdown', seconds: DUEL_COUNTDOWN, pid: dPid });
    }
  }

  duelDecline(pid?: number): void {
    const r = this.resolve(pid);
    if (!r) return;
    const invite = this.duelInvites.get(r.meta.entityId);
    this.duelInvites.delete(r.meta.entityId);
    if (invite) {
      this.emit({ type: 'log', text: `${r.meta.name} declines your challenge.`, color: '#fa6', pid: invite.fromPid });
    }
  }

  // Persistent social systems (friends / ignore / guilds) require an account
  // and database, so they only exist in online play. The offline Sim satisfies
  // the IWorld surface with inert stubs.
  realm = '';
  socialInfo: null = null;
  friendAdd(_name: string): void {}
  friendRemove(_name: string): void {}
  blockAdd(_name: string): void {}
  blockRemove(_name: string): void {}
  guildCreate(_name: string): void {}
  guildInvite(_name: string): void {}
  guildAccept(): void {}
  guildDecline(): void {}
  guildLeave(): void {}
  guildKick(_name: string): void {}
  guildPromote(_name: string): void {}
  guildDemote(_name: string): void {}
  guildTransfer(_name: string): void {}
  guildDisband(): void {}
  searchCharacters(_query: string): Promise<import('../world_api').CharacterSearchResult[]> { return Promise.resolve([]); }

  private updateDuels(): void {
    const seen = new Set<DuelState>();
    for (const duel of this.duels.values()) {
      if (seen.has(duel)) continue;
      seen.add(duel);
      const ea = this.entities.get(duel.a);
      const eb = this.entities.get(duel.b);
      if (!ea || !eb) { this.endDuel(duel, null); continue; }
      if (duel.state === 'countdown') {
        const before = Math.ceil(duel.timer);
        duel.timer -= DT;
        const after = Math.ceil(duel.timer);
        if (after < before && after > 0) {
          for (const dPid of [duel.a, duel.b]) this.emit({ type: 'duelCountdown', seconds: after, pid: dPid });
        }
        if (duel.timer <= 0) {
          duel.state = 'active';
          for (const dPid of [duel.a, duel.b]) {
            this.emit({ type: 'log', text: 'The duel has begun!', color: '#fa6', pid: dPid });
            this.emit({ type: 'duelStart', pid: dPid });
          }
        }
        continue;
      }
      // forfeit by running away or dying to something else
      if (dist2d(ea.pos, eb.pos) > DUEL_FORFEIT_DISTANCE) {
        this.endDuel(duel, null);
      } else if (ea.dead) {
        this.endDuel(duel, duel.b);
      } else if (eb.dead) {
        this.endDuel(duel, duel.a);
      }
    }
  }

  // winnerPid null = draw/cancelled
  private endDuel(duel: DuelState, winnerPid: number | null): void {
    this.duels.delete(duel.a);
    this.duels.delete(duel.b);
    const aMeta = this.players.get(duel.a);
    const bMeta = this.players.get(duel.b);
    const ea = this.entities.get(duel.a);
    const eb = this.entities.get(duel.b);
    // stop the combatants from swinging at each other
    for (const e of [ea, eb]) {
      if (e) e.ccDr.clear();
      if (e && e.targetId !== null && (e.targetId === duel.a || e.targetId === duel.b)) {
        e.autoAttack = false;
      }
    }
    if (winnerPid !== null && aMeta && bMeta) {
      const winner = winnerPid === duel.a ? aMeta : bMeta;
      const loser = winnerPid === duel.a ? bMeta : aMeta;
      this.emit({ type: 'duelEnd', winnerName: winner.name, loserName: loser.name });
    } else if (aMeta && bMeta) {
      for (const dPid of [duel.a, duel.b]) {
        this.emit({ type: 'log', text: 'The duel has ended.', color: '#fa6', pid: dPid });
      }
    }
  }

  duelFor(pid: number): DuelState | null {
    return this.duels.get(pid) ?? null;
  }

  // -------------------------------------------------------------------------
  // The Ashen Coliseum — 1v1 ranked arena (queue, matchmaking, Elo)
  // -------------------------------------------------------------------------

  arenaQueueJoin(pid?: number): void {
    const r = this.resolve(pid);
    if (!r) return;
    const id = r.meta.entityId;
    if (this.arenaQueue.includes(id)) {
      // already waiting — just re-affirm their place in line
      this.emit({ type: 'arenaQueued', position: this.arenaQueue.indexOf(id) + 1, pid: id });
      return;
    }
    if (this.arenaMatches.has(id)) { this.error(id, 'You are already in an arena match.'); return; }
    if (r.e.dead) { this.error(id, 'You cannot queue for the arena while dead.'); return; }
    if (this.duels.has(id)) { this.error(id, 'You cannot queue while dueling.'); return; }
    if (this.trades.has(id)) { this.error(id, 'Finish your trade before queueing.'); return; }
    if (r.e.pos.x > DUNGEON_X_THRESHOLD) { this.error(id, 'You cannot queue from inside an instance.'); return; }
    this.arenaQueue.push(id);
    this.emit({ type: 'arenaQueued', position: this.arenaQueue.length, pid: id });
    this.emit({ type: 'log', text: 'You join the Ashen Coliseum queue. Stand by for a worthy opponent…', color: '#ffa040', pid: id });
  }

  arenaQueueLeave(pid?: number): void {
    const r = this.resolve(pid);
    if (!r) return;
    if (this.arenaDequeue(r.meta.entityId)) {
      this.emit({ type: 'arenaUnqueued', pid: r.meta.entityId });
      this.emit({ type: 'log', text: 'You leave the Ashen Coliseum queue.', color: '#ffa040', pid: r.meta.entityId });
    }
  }

  private arenaDequeue(pid: number): boolean {
    const i = this.arenaQueue.indexOf(pid);
    if (i < 0) return false;
    this.arenaQueue.splice(i, 1);
    return true;
  }

  private freeArenaSlot(): number | null {
    for (let i = 0; i < ARENA_SLOT_COUNT; i++) {
      if (!this.arenaBusySlots.has(i)) return i;
    }
    return null;
  }

  private updateArena(): void {
    this.matchmakeArena();
    const seen = new Set<ArenaMatch>();
    for (const match of this.arenaMatches.values()) {
      if (seen.has(match)) continue;
      seen.add(match);
      const ea = this.entities.get(match.a);
      const eb = this.entities.get(match.b);
      if (!ea || !eb) {
        // someone logged out: an already-decided bout just sends the survivor
        // home; an in-progress one is forfeited to the remaining fighter
        if (match.state === 'over') this.returnFromArena(match);
        else this.endArenaMatch(match, ea ? match.a : eb ? match.b : null, 'forfeit');
        continue;
      }
      if (match.state === 'over') {
        // aftermath: both already cleansed and scored — count down, then go home
        match.timer -= DT;
        if (match.timer <= 0) this.returnFromArena(match);
        continue;
      }
      if (match.state === 'countdown') {
        const before = Math.ceil(match.timer);
        match.timer -= DT;
        const after = Math.ceil(match.timer);
        if (after < before && after > 0) {
          for (const mPid of [match.a, match.b]) this.emit({ type: 'arenaCountdown', seconds: after, pid: mPid });
        }
        if (match.timer <= 0) {
          match.state = 'active';
          match.timer = 0;
          for (const e of [ea, eb]) this.readyArenaFighter(e, { clearPrep: false });
          for (const mPid of [match.a, match.b]) {
            this.emit({ type: 'log', text: 'Fight!', color: '#ff5a3c', pid: mPid });
            this.emit({ type: 'arenaStart', pid: mPid });
          }
        }
        continue;
      }
      // active: a stalling bout resolves on remaining-health fraction
      match.timer += DT;
      if (match.timer >= ARENA_MAX_DURATION) {
        const fa = ea.hp / Math.max(1, ea.maxHp);
        const fb = eb.hp / Math.max(1, eb.maxHp);
        const winner = Math.abs(fa - fb) < 0.02 ? null : fa > fb ? match.a : match.b;
        this.endArenaMatch(match, winner, 'timeout');
      }
    }
  }

  // Pair the longest-waiting contender with the nearest-rated opponent still in
  // line, one bout per free slot. Skips (and drops) anyone who went offline or
  // died while waiting.
  private matchmakeArena(): void {
    let guard = ARENA_SLOT_COUNT + 1;
    while (guard-- > 0) {
      this.arenaQueue = this.arenaQueue.filter((id) => {
        const e = this.entities.get(id);
        return !!e && !e.dead && !this.arenaMatches.has(id);
      });
      if (this.arenaQueue.length < 2 || this.freeArenaSlot() === null) return;
      const aPid = this.arenaQueue[0];
      const aRating = this.players.get(aPid)?.arenaRating ?? ARENA_BASE_RATING;
      let bPid = -1, bestGap = Infinity;
      for (let i = 1; i < this.arenaQueue.length; i++) {
        const id = this.arenaQueue[i];
        const gap = Math.abs((this.players.get(id)?.arenaRating ?? ARENA_BASE_RATING) - aRating);
        if (gap < bestGap) { bestGap = gap; bPid = id; }
      }
      if (bPid < 0) return;
      this.arenaDequeue(aPid);
      this.arenaDequeue(bPid);
      this.startArenaMatch(aPid, bPid);
    }
  }

  private startArenaMatch(aPid: number, bPid: number): void {
    const slot = this.freeArenaSlot();
    const aMeta = this.players.get(aPid);
    const bMeta = this.players.get(bPid);
    const ea = this.entities.get(aPid);
    const eb = this.entities.get(bPid);
    if (slot === null || !aMeta || !bMeta || !ea || !eb) {
      // couldn't seat them — put them back so the next tick retries
      if (this.entities.get(aPid)) this.arenaQueue.unshift(aPid);
      if (this.entities.get(bPid)) this.arenaQueue.unshift(bPid);
      return;
    }
    this.arenaBusySlots.add(slot);
    const match: ArenaMatch = {
      id: this.nextArenaMatchId++, a: aPid, b: bPid, slot, state: 'countdown', timer: ARENA_COUNTDOWN,
      returnA: { x: ea.pos.x, z: ea.pos.z, facing: ea.facing },
      returnB: { x: eb.pos.x, z: eb.pos.z, facing: eb.facing },
      ratingA: aMeta.arenaRating, ratingB: bMeta.arenaRating,
    };
    this.arenaMatches.set(aPid, match);
    this.arenaMatches.set(bPid, match);
    const origin = arenaOrigin(slot);
    this.placeInArena(ea, origin, ARENA_SPAWN_A);
    this.placeInArena(eb, origin, ARENA_SPAWN_B);
    this.resetForArena(ea);
    this.resetForArena(eb);
    this.emit({ type: 'arenaFound', oppName: bMeta.name, oppClass: bMeta.cls, oppLevel: eb.level, pid: aPid });
    this.emit({ type: 'arenaFound', oppName: aMeta.name, oppClass: aMeta.cls, oppLevel: ea.level, pid: bPid });
    for (const mPid of [aPid, bPid]) {
      this.emit({ type: 'arenaCountdown', seconds: ARENA_COUNTDOWN, pid: mPid });
      this.emit({ type: 'log', text: 'You step onto the sands of the Ashen Coliseum.', color: '#ffa040', pid: mPid });
    }
  }

  private placeInArena(e: Entity, origin: { x: number; z: number }, spawn: { x: number; z: number; facing: number }): void {
    e.pos = this.groundPos(origin.x + spawn.x, origin.z + spawn.z);
    e.prevPos = { ...e.pos };
    e.facing = spawn.facing;
    e.prevFacing = spawn.facing;
    this.rebucket(e);
  }

  // A clean slate so the bout is decided by play, not by what each fighter
  // walked in carrying: full health/resource, cooldowns and combat reset.
  private resetForArena(e: Entity): void {
    this.readyArenaFighter(e, { clearPrep: true });
  }

  private readyArenaFighter(e: Entity, opts: { clearPrep: boolean }): void {
    if (opts.clearPrep) {
      e.auras = [];
      e.cooldowns.clear();
      e.ccDr.clear();
    }
    const meta = this.players.get(e.id);
    if (meta) recalcPlayerStats(e, meta.cls, meta.equipment);
    e.hp = e.maxHp;
    e.resource = e.resourceType === 'mana' ? e.maxResource : e.resourceType === 'energy' ? 100 : 0;
    e.targetId = null;
    e.autoAttack = false;
    e.queuedOnSwing = null;
    e.castingAbility = null;
    e.castRemaining = 0;
    e.channeling = false;
    e.comboPoints = 0;
    e.comboTargetId = null;
    e.gcdRemaining = 0;
    e.swingTimer = 0;
    e.chargeTargetId = null;
    e.chargePath = [];
    e.combatTimer = 99;
    e.inCombat = false;
    e.sitting = false;
    e.eating = null;
    e.drinking = null;
  }

  // Decide a bout: score it (once), then either send a survivor home now (a
  // forfeit, where the other fighter is gone) or hold both on the sands for a
  // brief aftermath before returning them. winnerPid null = draw; reason is
  // informational (defeat/timeout/forfeit).
  private endArenaMatch(match: ArenaMatch, winnerPid: number | null, reason: 'defeat' | 'timeout' | 'forfeit'): void {
    const aMeta = this.players.get(match.a);
    const bMeta = this.players.get(match.b);
    const ea = this.entities.get(match.a);
    const eb = this.entities.get(match.b);

    // rating: zero-sum Elo. A draw nudges each toward its expected score.
    if (aMeta && bMeta) {
      const ratingA0 = aMeta.arenaRating;
      const ratingB0 = bMeta.arenaRating;
      let deltaA: number;
      if (winnerPid === null) {
        deltaA = eloDelta(ratingA0, ratingB0, 0.5);
        aMeta.arenaWins += 0; bMeta.arenaWins += 0; // draws count as neither
      } else if (winnerPid === match.a) {
        deltaA = eloDelta(ratingA0, ratingB0, 1);
        aMeta.arenaWins++; bMeta.arenaLosses++;
      } else {
        deltaA = -eloDelta(ratingB0, ratingA0, 1);
        bMeta.arenaWins++; aMeta.arenaLosses++;
      }
      aMeta.arenaRating = Math.max(ARENA_MIN_RATING, ratingA0 + deltaA);
      bMeta.arenaRating = Math.max(ARENA_MIN_RATING, ratingB0 - deltaA);
      this.emit({
        type: 'arenaEnd', pid: match.a, draw: winnerPid === null, won: winnerPid === match.a,
        oppName: bMeta.name, ratingBefore: ratingA0, ratingAfter: aMeta.arenaRating,
      });
      this.emit({
        type: 'arenaEnd', pid: match.b, draw: winnerPid === null, won: winnerPid === match.b,
        oppName: aMeta.name, ratingBefore: ratingB0, ratingAfter: bMeta.arenaRating,
      });
    }

    // a forfeit (rage-quit / disconnect) has no aftermath — send the survivor
    // home immediately rather than leaving them on empty sands
    if (reason === 'forfeit' || !ea || !eb) { this.returnFromArena(match); return; }

    // decided bout: cleanse both right now so no arena auras/DoTs tick during
    // the wait, then hold them on the sands for the aftermath countdown
    this.resetForArena(ea);
    this.resetForArena(eb);
    match.state = 'over';
    match.timer = ARENA_RETURN_DELAY;
    for (const mPid of [match.a, match.b]) {
      this.emit({ type: 'log', text: 'The bout is decided. Returning to the world…', color: '#ffa040', pid: mPid });
    }
  }

  // Teleport both fighters back to where they queued, fully cleansed (no arena
  // auras, DoTs, debuffs, cooldowns or combat state follow them out), and
  // release the instance slot.
  private returnFromArena(match: ArenaMatch): void {
    this.arenaMatches.delete(match.a);
    this.arenaMatches.delete(match.b);
    this.arenaBusySlots.delete(match.slot);
    for (const [e, ret] of [[this.entities.get(match.a), match.returnA], [this.entities.get(match.b), match.returnB]] as const) {
      if (!e) continue;
      this.resetForArena(e); // strips every aura/effect/cooldown and heals to full
      e.pos = this.groundPos(ret.x, ret.z);
      e.prevPos = { ...e.pos };
      e.facing = ret.facing;
      e.dead = false;
      this.rebucket(e);
      this.emit({ type: 'respawn', pid: e.id });
    }
  }

  arenaMatchFor(pid: number): ArenaMatch | null {
    return this.arenaMatches.get(pid) ?? null;
  }

  // Live standings of rated players currently online, best first.
  arenaLadder(): import('../world_api').ArenaLadderEntry[] {
    const rows: import('../world_api').ArenaLadderEntry[] = [];
    for (const meta of this.players.values()) {
      const e = this.entities.get(meta.entityId);
      if (!e) continue;
      rows.push({ pid: meta.entityId, name: meta.name, cls: meta.cls, rating: meta.arenaRating, wins: meta.arenaWins, losses: meta.arenaLosses });
    }
    rows.sort((x, y) => y.rating - x.rating || y.wins - x.wins);
    return rows.slice(0, ARENA_LADDER_SIZE);
  }

  arenaInfoFor(pid: number): import('../world_api').ArenaInfo | null {
    const meta = this.players.get(pid);
    if (!meta) return null;
    const match = this.arenaMatches.get(pid);
    let matchInfo: import('../world_api').ArenaInfo['match'] = null;
    if (match) {
      const oppPid = match.a === pid ? match.b : match.a;
      const oppMeta = this.players.get(oppPid);
      const oppE = this.entities.get(oppPid);
      if (oppMeta && oppE) {
        matchInfo = {
          state: match.state, oppName: oppMeta.name, oppClass: oppMeta.cls, oppLevel: oppE.level, oppPid,
          returnIn: match.state === 'over' ? Math.max(0, Math.ceil(match.timer)) : undefined,
        };
      }
    }
    return {
      rating: meta.arenaRating,
      wins: meta.arenaWins,
      losses: meta.arenaLosses,
      queued: this.arenaQueue.includes(pid),
      queueSize: this.arenaQueue.length,
      match: matchInfo,
      ladder: this.arenaLadder(),
    };
  }

  // -------------------------------------------------------------------------
  // Trading
  // -------------------------------------------------------------------------

  tradeRequest(targetPid: number, pid?: number): void {
    const r = this.resolve(pid);
    const target = this.players.get(targetPid);
    const targetE = this.entities.get(targetPid);
    if (!r || !target || !targetE) return;
    if (targetPid === r.meta.entityId) return;
    if (this.trades.has(r.meta.entityId) || this.trades.has(targetPid)) { this.error(r.meta.entityId, 'A trade is already in progress.'); return; }
    if (dist2d(r.e.pos, targetE.pos) > TRADE_RANGE) { this.error(r.meta.entityId, 'Target is too far away to trade.'); return; }
    if (this.hasPendingSocialInvite(targetPid)) { this.error(r.meta.entityId, `${target.name} already has a pending invitation.`); return; }
    this.tradeInvites.set(targetPid, { fromPid: r.meta.entityId, expires: this.time + 30 });
    this.emit({ type: 'tradeRequest', fromPid: r.meta.entityId, fromName: r.meta.name, pid: targetPid });
    this.emit({ type: 'log', text: `You have requested to trade with ${target.name}.`, color: '#8df', pid: r.meta.entityId });
  }

  tradeAccept(pid?: number): void {
    const r = this.resolve(pid);
    if (!r) return;
    const invite = this.tradeInvites.get(r.meta.entityId);
    if (!invite || invite.expires < this.time) { this.error(r.meta.entityId, 'The trade request has expired.'); return; }
    this.tradeInvites.delete(r.meta.entityId);
    if (!this.players.get(invite.fromPid)) return;
    const session: TradeSession = {
      a: invite.fromPid, b: r.meta.entityId,
      offerA: { items: [], copper: 0 }, offerB: { items: [], copper: 0 },
      acceptedA: false, acceptedB: false,
    };
    this.trades.set(session.a, session);
    this.trades.set(session.b, session);
    for (const tPid of [session.a, session.b]) {
      this.emit({ type: 'log', text: 'Trade window opened.', color: '#8df', pid: tPid });
    }
  }

  tradeSetOffer(items: InvSlot[], copper: number, pid?: number): void {
    const r = this.resolve(pid);
    if (!r) return;
    const session = this.trades.get(r.meta.entityId);
    if (!session) return;
    // validate the offer against the player's bags; merge duplicate slots so
    // the offered total per item is checked, not each slot in isolation
    const merged = new Map<string, number>();
    for (const slot of items.slice(0, 6)) {
      // slots come straight off the wire — reject anything malformed
      if (!slot || typeof slot.itemId !== 'string' || !Number.isFinite(slot.count)) continue;
      const count = Math.max(1, Math.floor(slot.count));
      const def = ITEMS[slot.itemId];
      if (!def || def.kind === 'quest') continue; // quest items are soulbound-ish
      merged.set(slot.itemId, (merged.get(slot.itemId) ?? 0) + count);
    }
    const cleaned: InvSlot[] = [];
    for (const [itemId, count] of merged) {
      if (this.countItem(itemId, r.meta.entityId) < count) continue;
      cleaned.push({ itemId, count });
    }
    const offer = { items: cleaned, copper: Math.max(0, Math.min(Math.floor(copper), r.meta.copper)) };
    if (session.a === r.meta.entityId) session.offerA = offer;
    else session.offerB = offer;
    session.acceptedA = false;
    session.acceptedB = false;
  }

  tradeConfirm(pid?: number): void {
    const r = this.resolve(pid);
    if (!r) return;
    const session = this.trades.get(r.meta.entityId);
    if (!session) return;
    if (session.a === r.meta.entityId) session.acceptedA = true;
    else session.acceptedB = true;
    if (!(session.acceptedA && session.acceptedB)) return;

    const metaA = this.players.get(session.a);
    const metaB = this.players.get(session.b);
    if (!metaA || !metaB) { this.tradeCancel(session.a); return; }
    // final validation before the atomic swap
    const valid =
      session.offerA.copper <= metaA.copper &&
      session.offerB.copper <= metaB.copper &&
      this.offerCovered(session.offerA.items, session.a) &&
      this.offerCovered(session.offerB.items, session.b);
    if (!valid) {
      for (const tPid of [session.a, session.b]) this.error(tPid, 'Trade failed: items or money no longer available.');
      this.closeTrade(session);
      return;
    }
    // swap
    metaA.copper = metaA.copper - session.offerA.copper + session.offerB.copper;
    metaB.copper = metaB.copper - session.offerB.copper + session.offerA.copper;
    for (const s of session.offerA.items) {
      this.removeItem(s.itemId, s.count, session.a);
      this.addItem(s.itemId, s.count, session.b);
    }
    for (const s of session.offerB.items) {
      this.removeItem(s.itemId, s.count, session.b);
      this.addItem(s.itemId, s.count, session.a);
    }
    for (const tPid of [session.a, session.b]) {
      this.emit({ type: 'log', text: 'Trade complete.', color: '#8df', pid: tPid });
      this.emit({ type: 'tradeDone', pid: tPid });
    }
    this.closeTrade(session);
  }

  tradeCancel(pid?: number): void {
    const r = this.resolve(pid);
    if (!r) return;
    const session = this.trades.get(r.meta.entityId);
    if (!session) return;
    for (const tPid of [session.a, session.b]) {
      this.emit({ type: 'log', text: 'Trade cancelled.', color: '#8df', pid: tPid });
    }
    this.closeTrade(session);
  }

  // true when the player's bags cover the offered totals per item, summing
  // duplicate slots — a per-slot check would let duplicates each pass alone
  private offerCovered(items: InvSlot[], pid: number): boolean {
    const totals = new Map<string, number>();
    for (const s of items) totals.set(s.itemId, (totals.get(s.itemId) ?? 0) + s.count);
    for (const [itemId, count] of totals) {
      if (this.countItem(itemId, pid) < count) return false;
    }
    return true;
  }

  private closeTrade(session: TradeSession): void {
    this.trades.delete(session.a);
    this.trades.delete(session.b);
  }

  tradeFor(pid: number): TradeSession | null {
    return this.trades.get(pid) ?? null;
  }

  private updateTradesAndInvites(): void {
    // expire stale invites
    for (const map of [this.partyInvites, this.tradeInvites, this.duelInvites]) {
      for (const [pid, invite] of map) {
        if (invite.expires < this.time) map.delete(pid);
      }
    }
    // cancel trades when the parties drift apart
    const seen = new Set<TradeSession>();
    for (const session of this.trades.values()) {
      if (seen.has(session)) continue;
      seen.add(session);
      const ea = this.entities.get(session.a);
      const eb = this.entities.get(session.b);
      if (!ea || !eb || dist2d(ea.pos, eb.pos) > TRADE_RANGE + 4 || ea.dead || eb.dead) {
        this.tradeCancel(session.a);
      }
    }
  }

  // -------------------------------------------------------------------------
  // The World Market — the Merchant's auction house
  // -------------------------------------------------------------------------

  private merchantEntity(): Entity | null {
    const e = this.entities.get(this.merchantId);
    return e && e.kind === 'npc' ? e : null;
  }

  private nearMerchant(e: Entity): boolean {
    const m = this.merchantEntity();
    return !!m && dist2d(e.pos, m.pos) <= MARKET_RANGE;
  }

  private metaByName(name: string): PlayerMeta | null {
    if (!name) return null;
    for (const m of this.players.values()) if (m.name === name) return m;
    return null;
  }

  private collectionFor(key: string): MarketCollection {
    let c = this.marketCollections.get(key);
    if (!c) { c = { copper: 0, items: [] }; this.marketCollections.set(key, c); }
    return c;
  }

  // The Merchant always keeps a little stock so the market is never empty —
  // standing consignments that never expire, never deplete, and pay no one.
  private seedHouseListings(): void {
    const stock: { itemId: string; count: number; price: number }[] = [
      { itemId: 'roasted_boar', count: 5, price: 700 },
      { itemId: 'spring_water', count: 5, price: 160 },
      { itemId: 'oiled_boots', count: 1, price: 1900 },
      { itemId: 'quilted_trousers', count: 1, price: 2400 },
      { itemId: 'greyjaw_pelt_cloak', count: 1, price: 2900 },
    ];
    for (const s of stock) {
      if (!ITEMS[s.itemId]) continue;
      this.marketListings.push({
        id: this.nextListingId++, sellerKey: '', sellerName: 'The Merchant',
        itemId: s.itemId, count: s.count, price: s.price, expiresAt: Infinity, house: true,
      });
    }
  }

  // List a stack from your bags for sale. The goods are escrowed (pulled from
  // your bags immediately) and held by the Merchant until bought or reclaimed.
  marketList(itemId: string, count: number, price: number, pid?: number): void {
    const r = this.resolve(pid);
    if (!r) return;
    const { meta, e: p } = r;
    if (p.dead) return;
    if (!this.nearMerchant(p)) { this.error(meta.entityId, 'You must bring your goods to the Merchant.'); return; }
    const def = ITEMS[itemId];
    if (!def) return;
    if (def.kind === 'quest') { this.error(meta.entityId, 'The Merchant will not broker quest items.'); return; }
    const want = Math.max(1, Math.floor(count));
    if (this.countItem(itemId, meta.entityId) < want) { this.error(meta.entityId, 'You do not have that many to sell.'); return; }
    const ask = Math.floor(price);
    if (!Number.isFinite(ask) || ask < MARKET_MIN_PRICE) { this.error(meta.entityId, 'Name a price of at least 1 copper.'); return; }
    if (ask > MARKET_MAX_PRICE) { this.error(meta.entityId, 'That price is beyond what the Merchant will broker.'); return; }
    const mine = this.marketListings.reduce((n, l) => n + (!l.house && l.sellerKey === meta.name ? 1 : 0), 0);
    if (mine >= MARKET_MAX_LISTINGS) { this.error(meta.entityId, `You may keep at most ${MARKET_MAX_LISTINGS} goods on the market at once.`); return; }
    this.removeItem(itemId, want, meta.entityId); // escrow
    this.marketListings.push({
      id: this.nextListingId++, sellerKey: meta.name, sellerName: meta.name,
      itemId, count: want, price: ask, expiresAt: this.time + MARKET_LISTING_DURATION, house: false,
    });
    this.emit({ type: 'loot', text: `Listed ${def.name}${want > 1 ? ' x' + want : ''} on the World Market for ${formatMoney(ask)}.`, pid: meta.entityId });
  }

  // Buy a listing outright. Coin leaves the buyer, goods enter their bags, and
  // the seller's proceeds (less the Merchant's cut) wait in their collection.
  marketBuy(listingId: number, pid?: number): void {
    const r = this.resolve(pid);
    if (!r) return;
    const { meta, e: p } = r;
    if (p.dead) return;
    if (!this.nearMerchant(p)) { this.error(meta.entityId, 'You are too far from the Merchant.'); return; }
    const idx = this.marketListings.findIndex((l) => l.id === listingId);
    if (idx < 0) { this.error(meta.entityId, 'That listing is no longer available.'); return; }
    const listing = this.marketListings[idx];
    const def = ITEMS[listing.itemId];
    if (!def) { this.marketListings.splice(idx, 1); return; }
    if (!listing.house && listing.sellerKey === meta.name) {
      this.error(meta.entityId, 'That is your own listing — cancel it to reclaim it.');
      return;
    }
    if (meta.copper < listing.price) { this.error(meta.entityId, 'You cannot afford that.'); return; }
    meta.copper -= listing.price;
    this.addItem(listing.itemId, listing.count, meta.entityId);
    if (!listing.house) {
      const proceeds = Math.max(0, Math.floor(listing.price * (1 - MARKET_CUT)));
      this.collectionFor(listing.sellerKey).copper += proceeds;
      this.marketListings.splice(idx, 1);
      const sellerMeta = this.metaByName(listing.sellerKey);
      if (sellerMeta) {
        this.emit({ type: 'loot', text: `${meta.name} bought your ${def.name} for ${formatMoney(listing.price)} — collect ${formatMoney(proceeds)} from the Merchant.`, pid: sellerMeta.entityId });
      }
    }
    this.emit({ type: 'loot', text: `Bought ${def.name}${listing.count > 1 ? ' x' + listing.count : ''} for ${formatMoney(listing.price)}.`, pid: meta.entityId });
  }

  // Reclaim your own listing; the escrowed goods go straight back to your bags.
  marketCancel(listingId: number, pid?: number): void {
    const r = this.resolve(pid);
    if (!r) return;
    const { meta, e: p } = r;
    if (!this.nearMerchant(p)) { this.error(meta.entityId, 'You are too far from the Merchant.'); return; }
    const idx = this.marketListings.findIndex((l) => l.id === listingId);
    if (idx < 0) return;
    const listing = this.marketListings[idx];
    if (listing.house || listing.sellerKey !== meta.name) { this.error(meta.entityId, 'That is not your listing.'); return; }
    this.marketListings.splice(idx, 1);
    this.addItem(listing.itemId, listing.count, meta.entityId);
    const def = ITEMS[listing.itemId];
    this.emit({ type: 'loot', text: `Reclaimed ${def?.name ?? listing.itemId}${listing.count > 1 ? ' x' + listing.count : ''} from the market.`, pid: meta.entityId });
  }

  // Take everything waiting for you at the Merchant: sale gold and any items
  // returned from expired listings.
  marketCollect(pid?: number): void {
    const r = this.resolve(pid);
    if (!r) return;
    const { meta, e: p } = r;
    if (!this.nearMerchant(p)) { this.error(meta.entityId, 'You are too far from the Merchant.'); return; }
    const col = this.marketCollections.get(meta.name);
    if (!col || (col.copper <= 0 && col.items.length === 0)) { this.error(meta.entityId, 'You have nothing to collect.'); return; }
    if (col.copper > 0) {
      meta.copper += col.copper;
      this.emit({ type: 'loot', text: `You collect ${formatMoney(col.copper)} from the Merchant.`, pid: meta.entityId });
    }
    for (const s of col.items) this.addItem(s.itemId, s.count, meta.entityId);
    this.marketCollections.delete(meta.name);
  }

  // Once a second: return expired player listings to their seller's collection.
  private updateMarket(): void {
    if (this.tickCount % 20 !== 0) return;
    for (let i = this.marketListings.length - 1; i >= 0; i--) {
      const l = this.marketListings[i];
      if (l.house || this.time < l.expiresAt) continue;
      this.marketListings.splice(i, 1);
      this.collectionFor(l.sellerKey).items.push({ itemId: l.itemId, count: l.count });
      const sellerMeta = this.metaByName(l.sellerKey);
      if (sellerMeta) {
        const def = ITEMS[l.itemId];
        this.emit({ type: 'log', text: `Your market listing of ${def?.name ?? l.itemId} expired and waits at the Merchant.`, color: '#caa472', pid: sellerMeta.entityId });
      }
    }
  }

  marketInfoFor(pid: number): import('../world_api').MarketInfo | null {
    const meta = this.players.get(pid);
    const e = this.entities.get(pid);
    if (!meta || !e) return null;
    // the World Market is a place you visit — only stream it while standing by
    // the Merchant, which also bounds the per-snapshot wire cost
    if (!this.nearMerchant(e)) return null;
    const sorted = [...this.marketListings].sort((a, b) => {
      const na = ITEMS[a.itemId]?.name ?? a.itemId;
      const nb = ITEMS[b.itemId]?.name ?? b.itemId;
      return na.localeCompare(nb) || a.price - b.price;
    });
    const listings = sorted.slice(0, MARKET_WIRE_LIMIT).map((l) => ({
      id: l.id, sellerName: l.sellerName, itemId: l.itemId, count: l.count,
      price: l.price, mine: !l.house && l.sellerKey === meta.name, house: l.house,
    }));
    const col = this.marketCollections.get(meta.name);
    const myListingCount = this.marketListings.reduce((n, l) => n + (!l.house && l.sellerKey === meta.name ? 1 : 0), 0);
    return {
      listings,
      collectionCopper: col?.copper ?? 0,
      collectionItems: col ? col.items.map((s) => ({ ...s })) : [],
      cutPct: Math.round(MARKET_CUT * 100),
      maxListings: MARKET_MAX_LISTINGS,
      myListingCount,
    };
  }

  // Persist only player listings + collections; house stock is reseeded each
  // boot so content edits take effect. secondsLeft survives the time reset.
  serializeMarket(): MarketSave {
    return {
      listings: this.marketListings.filter((l) => !l.house).map((l) => ({
        id: l.id, sellerKey: l.sellerKey, sellerName: l.sellerName, itemId: l.itemId,
        count: l.count, price: l.price,
        secondsLeft: Number.isFinite(l.expiresAt) ? Math.max(0, Math.round(l.expiresAt - this.time)) : MARKET_LISTING_DURATION,
      })),
      collections: [...this.marketCollections.entries()].map(([key, c]) => ({
        key, copper: c.copper, items: c.items.map((s) => ({ ...s })),
      })),
      nextListingId: this.nextListingId,
    };
  }

  loadMarket(save: MarketSave | null | undefined): void {
    if (!save) return;
    for (const l of save.listings ?? []) {
      if (!l || typeof l.itemId !== 'string' || !ITEMS[l.itemId]) continue;
      this.marketListings.push({
        id: l.id, sellerKey: String(l.sellerKey ?? ''), sellerName: String(l.sellerName ?? l.sellerKey ?? '?'),
        itemId: l.itemId, count: Math.max(1, l.count | 0),
        price: Math.max(MARKET_MIN_PRICE, Math.min(MARKET_MAX_PRICE, Math.floor(l.price) || MARKET_MIN_PRICE)),
        expiresAt: this.time + (Number.isFinite(l.secondsLeft) ? Math.max(0, l.secondsLeft) : MARKET_LISTING_DURATION),
        house: false,
      });
    }
    for (const c of save.collections ?? []) {
      if (!c || typeof c.key !== 'string') continue;
      this.marketCollections.set(c.key, {
        copper: Math.max(0, Math.floor(c.copper) || 0),
        items: (c.items ?? []).filter((s) => s && ITEMS[s.itemId]).map((s) => ({ itemId: s.itemId, count: Math.max(1, s.count | 0) })),
      });
    }
    const maxId = this.marketListings.reduce((m, l) => Math.max(m, l.id + 1), 1);
    this.nextListingId = Math.max(this.nextListingId, save.nextListingId ?? 1, maxId);
  }

  // -------------------------------------------------------------------------
  // Dungeons: party-instanced elite content (the Hollow Crypt and friends)
  // -------------------------------------------------------------------------

  private instanceKeyFor(pid: number): string {
    const party = this.partyOf(pid);
    return party ? `party:${party.id}` : `solo:${pid}`;
  }

  private instanceOriginOf(inst: InstanceSlot): { x: number; z: number } {
    return instanceOrigin(DUNGEONS[inst.dungeonId].index, inst.slot);
  }

  // Walking into a dungeon door teleports you through it (no click needed).
  // Party members who walk in land in the same instance via instanceKeyFor.
  private dungeonDoorIds: number[] | null = null;

  private updateDoorTriggers(p: Entity): void {
    if (p.kind !== 'player') return;
    if (p.pos.x > DUNGEON_X_THRESHOLD) {
      // inside: walking into the exit portal climbs back out
      for (const inst of this.instances) {
        if (inst.exitId === null) continue;
        const exit = this.entities.get(inst.exitId);
        if (exit && dist2d(p.pos, exit.pos) < DOOR_TRIGGER_RADIUS) {
          this.leaveDungeon(p.id);
          return;
        }
      }
      return;
    }
    if (this.dungeonDoorIds === null) {
      this.dungeonDoorIds = [];
      for (const e of this.entities.values()) {
        if (e.templateId === 'dungeon_door') this.dungeonDoorIds.push(e.id);
      }
    }
    for (const doorId of this.dungeonDoorIds) {
      const door = this.entities.get(doorId);
      if (door && door.dungeonId && dist2d(p.pos, door.pos) < DOOR_TRIGGER_RADIUS) {
        this.enterDungeon(door.dungeonId, p.id);
        return;
      }
    }
  }

  enterDungeon(dungeonId: string, pid?: number): void {
    const r = this.resolve(pid);
    const dungeon = DUNGEONS[dungeonId];
    if (!r || !dungeon || r.e.dead) return;
    const key = this.instanceKeyFor(r.meta.entityId);
    let inst = this.instances.find((i) => i.dungeonId === dungeonId && i.partyKey === key);
    if (!inst) {
      inst = this.instances.find((i) => i.dungeonId === dungeonId && i.partyKey === null);
      if (!inst) { this.error(r.meta.entityId, `All instances of ${dungeon.name} are busy. Try again soon.`); return; }
      this.claimInstance(inst, key);
    }
    const party = this.partyOf(r.meta.entityId);
    if (!party || party.members.length < dungeon.suggestedPlayers) {
      this.emit({ type: 'log', text: `${dungeon.name} is meant for a full party of ${dungeon.suggestedPlayers}. Tread carefully.`, color: '#f96', pid: r.meta.entityId });
    }
    const origin = this.instanceOriginOf(inst);
    const p = r.e;
    p.pos = this.groundPos(origin.x + dungeon.entry.x, origin.z + dungeon.entry.z);
    p.prevPos = { ...p.pos };
    this.rebucket(p);
    p.facing = 0;
    p.targetId = null;
    p.autoAttack = false;
    inst.emptyFor = 0;
    this.emit({ type: 'log', text: dungeon.enterText, color: '#b9f', pid: r.meta.entityId });
  }

  leaveDungeon(pid?: number): void {
    const r = this.resolve(pid);
    if (!r || r.e.dead) return;
    const p = r.e;
    // not inside any instance: nothing to leave (no DUNGEON_LIST[0] fallback —
    // that silently teleported outdoor callers to the Hollow Crypt door)
    const dungeon = dungeonAt(p.pos.x);
    if (!dungeon) return;
    p.pos = this.groundPos(dungeon.doorPos.x, dungeon.doorPos.z - 4);
    p.prevPos = { ...p.pos };
    this.rebucket(p);
    p.targetId = null;
    p.autoAttack = false;
    this.emit({ type: 'log', text: dungeon.leaveText, color: '#b9f', pid: r.meta.entityId });
  }

  // Legacy single-dungeon entry points (tests + scripts use these).
  enterCrypt(pid?: number): void {
    this.enterDungeon('hollow_crypt', pid);
  }

  leaveCrypt(pid?: number): void {
    this.leaveDungeon(pid);
  }

  private claimInstance(inst: InstanceSlot, key: string): void {
    const dungeon = DUNGEONS[inst.dungeonId];
    inst.partyKey = key;
    inst.emptyFor = 0;
    const origin = this.instanceOriginOf(inst);
    for (const spawn of dungeon.spawns) {
      const template = MOBS[spawn.mobId];
      const level = this.rng.int(template.minLevel, template.maxLevel);
      const mob = createMob(this.nextId++, template, level, this.groundPos(origin.x + spawn.x, origin.z + spawn.z));
      mob.facing = Math.PI; // face the entrance
      mob.prevFacing = mob.facing;
      this.addEntity(mob);
      inst.mobIds.push(mob.id);
    }
    const exit = createGroundObject(this.nextId++, '', `${dungeon.name} Exit`, this.groundPos(origin.x + dungeon.exitOffset.x, origin.z + dungeon.exitOffset.z));
    exit.templateId = 'dungeon_exit';
    exit.dungeonId = dungeon.id;
    exit.objectItemId = null;
    exit.lootable = true;
    this.addEntity(exit);
    inst.exitId = exit.id;
  }

  private freeInstance(inst: InstanceSlot): void {
    for (const id of inst.mobIds) {
      if (!this.entities.has(id)) continue;
      // drop any player targets on the despawning mob so the delete is clean
      for (const meta of this.players.values()) {
        const e = this.entities.get(meta.entityId);
        if (e?.targetId === id) e.targetId = null;
        if (e?.comboTargetId === id) { e.comboTargetId = null; e.comboPoints = 0; }
      }
      this.dropEntity(id);
    }
    if (inst.exitId !== null) this.dropEntity(inst.exitId);
    inst.partyKey = null;
    inst.mobIds = [];
    inst.exitId = null;
    inst.emptyFor = 0;
  }

  private updateInstances(): void {
    if (this.tickCount % 20 !== 0) return; // once a second
    for (const inst of this.instances) {
      if (inst.partyKey === null) continue;
      const origin = this.instanceOriginOf(inst);
      let occupied = false;
      for (const meta of this.players.values()) {
        const e = this.entities.get(meta.entityId);
        if (e && Math.abs(e.pos.x - origin.x) < 120 && Math.abs(e.pos.z - origin.z) < 250) {
          occupied = true;
          break;
        }
      }
      if (occupied) {
        inst.emptyFor = 0;
      } else {
        inst.emptyFor += 1;
        if (inst.emptyFor >= INSTANCE_EMPTY_TIMEOUT) this.freeInstance(inst);
      }
    }
  }

  // UI-facing info objects (the same shapes the server sends over the wire)
  get partyInfo(): import('../world_api').PartyInfo | null {
    const party = this.partyOf(this.primaryId);
    if (!party) return null;
    return {
      leader: party.leader,
      members: party.members.flatMap((mPid) => {
        const meta = this.players.get(mPid);
        const e = this.entities.get(mPid);
        return meta && e ? [{
          pid: mPid, name: meta.name, cls: meta.cls, level: e.level,
          hp: e.hp, mhp: e.maxHp, res: Math.round(e.resource), mres: e.maxResource, rtype: e.resourceType,
          x: e.pos.x, z: e.pos.z, dead: e.dead ? 1 : 0, inCombat: e.inCombat ? 1 : 0,
        }] : [];
      }),
    };
  }

  get tradeInfo(): import('../world_api').TradeInfo | null {
    const t = this.tradeFor(this.primaryId);
    if (!t) return null;
    const mine = t.a === this.primaryId;
    const otherPid = mine ? t.b : t.a;
    return {
      otherPid,
      otherName: this.players.get(otherPid)?.name ?? '?',
      myOffer: mine ? t.offerA : t.offerB,
      theirOffer: mine ? t.offerB : t.offerA,
      myAccepted: mine ? t.acceptedA : t.acceptedB,
      theirAccepted: mine ? t.acceptedB : t.acceptedA,
    };
  }

  get duelInfo(): import('../world_api').DuelInfo | null {
    const d = this.duelFor(this.primaryId);
    if (!d) return null;
    const otherPid = d.a === this.primaryId ? d.b : d.a;
    return { otherPid, otherName: this.players.get(otherPid)?.name ?? '?', state: d.state };
  }

  get arenaInfo(): import('../world_api').ArenaInfo | null {
    return this.primaryId === -1 ? null : this.arenaInfoFor(this.primaryId);
  }

  get marketInfo(): import('../world_api').MarketInfo | null {
    return this.primaryId === -1 ? null : this.marketInfoFor(this.primaryId);
  }

  instanceSlotAt(pos: Vec3): number | null {
    for (const inst of this.instances) {
      const origin = this.instanceOriginOf(inst);
      if (Math.abs(pos.x - origin.x) < 120 && Math.abs(pos.z - origin.z) < 250) return inst.slot;
    }
    return null;
  }

  private error(pid: number, text: string): void {
    this.emit({ type: 'error', text, pid });
  }
}

export function formatMoney(copper: number): string {
  const g = Math.floor(copper / 10000);
  const s = Math.floor((copper % 10000) / 100);
  const c = copper % 100;
  const parts: string[] = [];
  if (g > 0) parts.push(`${g}g`);
  if (s > 0) parts.push(`${s}s`);
  if (c > 0 || parts.length === 0) parts.push(`${c}c`);
  return parts.join(' ');
}
