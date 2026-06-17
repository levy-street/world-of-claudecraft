import {
  ABILITIES, ARENA_SLOT_COUNT, CAMPS, CLASSES, DUNGEONS, DUNGEON_LIST, DungeonDef, arenaOrigin, dungeonAt,
  DUNGEON_X_THRESHOLD, GROUND_OBJECTS, GROUP_XP_BONUS, INSTANCE_SLOT_COUNT, isArenaPos,
  ITEMS, MOBS, NPCS, PLAYER_START, QUESTS, questRewardItemId, abilitiesKnownAt, instanceOrigin,
  DEEPFEN_SHALLOWS_LAKE,
  zoneAt, ZONES,
} from './data';
import { ARENA_SPAWN_A, ARENA_SPAWN_B, ARENA_SPAWNS_A_2v2, ARENA_SPAWNS_B_2v2 } from './dungeon_layout';
import { lineOfSightClear, resolvePosition } from './colliders';
import { findPath } from './pathfind';
import { createGroundObject, createMob, createNpc, createPlayer, recalcPlayerStats, PlayerEquipment } from './entity';
import {
  computeTalentModifiers, emptyAllocation, emptyModifiers, talentsFor, talentPointsAtLevel,
  validateAllocation, cloneAllocation, pointsSpent, FIRST_TALENT_LEVEL, MAX_LOADOUTS,
  type TalentAllocation, type TalentModifiers, type SavedLoadout, type Role,
} from './content/talents';
import { Rng } from './rng';
import { SpatialGrid } from './spatial';
import {
  HEAL_THREAT_FACTOR, MELEE_SWITCH_MULT, RANGED_SWITCH_MULT,
  TAUNT_FORCE_SECONDS, addThreat, clearThreat, stealthDetectionRadius, threatEntries, threatModifier, topThreatValue,
} from './threat';
import { groundHeight, WATER_LEVEL } from './world';
import type { LeaderboardEntry } from '../world_api';
import {
  AbilityDef, AbilityEffect, Aura, AuraKind, CAST_PUSHBACK_SEC, CHANNEL_PUSHBACK_FRACTION, CONSUME_DURATION,
  CONSUME_TICKS, CrowdControlDrCategory, DT, Entity, EquipSlot, FISHING_CAST_ID, FISHING_CAST_TIME, GCD,
  INTERACT_RANGE, InvSlot, LootEntry, LootSlot, MELEE_RANGE, MAX_LEVEL, MobFamily, MobTemplate,
  MoveInput, OverheadEmoteId, PetMode, PlayerClass, QuestProgress, QuestState, RUN_SPEED, SimConfig, SimEvent, TURN_SPEED, Vec3,
  angleTo, armorReduction, dist2d, emptyMoveInput, isConsuming, meleeMissChance, mobXpValue, normAngle,
  rageFromDealing, rageFromTaking, spellHitChance, xpForLevel,
  MILESTONES, virtualLevel, xpToReachLevel, canPrestige,
  ArenaFormat, ArenaCombatant,
} from './types';

const LEASH_DISTANCE = 45;
const DUNGEON_LEASH_DISTANCE = 70;
// Classic "trivial con": a wild mob this many levels below the player goes
// passive and will not auto-aggro from proximity (it still fights back if
// attacked). Elites, rares, and bosses are never trivial.
const TRIVIAL_LEVEL_GAP = 10;
const CORPSE_DURATION = 60;
const EVADE_SPEED_MULT = 1.6;
// An evading mob walks a straight line home (no pathfinding) and stalls if deep
// water or a collider sits between it and its spawn. Since evading mobs are
// immune while resetting, a permanent stall = a permanently unkillable mob. If it
// can't get closer to home for this long, it starts phasing through the blocker.
const EVADE_STALL_TIMEOUT = 3;
// Heading offsets (radians) a mob tries when its straight path is blocked, so it
// can slide around a prop instead of pinning on it. Desired heading (0) first;
// only evaluated past the first entry when that straight step is obstructed.
const MOVE_SLIDE_FAN = [0, 0.5, -0.5, 1.0, -1.0, 1.6, -1.6];
const BACKPEDAL_MULT = 0.65;
// Low-HP flee ("fear"): a cowardly mob at or below this HP fraction panics, turns
// and runs from its attacker for FLEE_DURATION seconds at FLEE_SPEED_MULT speed,
// calling same-family allies within FLEE_HELP_RADIUS to assist. It flees only once
// per pull, then recovers its nerve and re-engages if it survived.
const FLEE_HP_THRESHOLD = 0.2;
const FLEE_DURATION = 5;
const FLEE_SPEED_MULT = 1.4;
const FLEE_HELP_RADIUS = 8;
// Only sentient, cowardly families flee; beasts/undead/elementals/dragonkin fight
// to the death. Elites, rares, and bosses never flee regardless of family.
const FLEEING_FAMILIES: ReadonlySet<MobFamily> = new Set(['humanoid', 'kobold', 'murloc', 'troll']);
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
const PVP_ROOT_DR_RESET = 18; // seconds before a repeated PvP root is fresh again
const PVP_POLYMORPH_DR_RESET = 60;
const PVP_FEAR_DR_RESET = 60;
const PVP_CC_DR_MULTIPLIERS = [1, 0.5, 0.25] as const;
const PVP_POLYMORPH_DR_DURATIONS = [10, 5, 1] as const;
const PVP_FEAR_DR_DURATIONS = [8, 4, 2, 1] as const;
const SHAMAN_SHOCK_COOLDOWN_IDS = ['earth_shock', 'flame_shock', 'frost_shock'] as const;
const DEMON_HEAL_CAST_ID = 'demon_heal';
const SAY_RANGE = 25; // /say carries a short distance; /yell across a camp
const YELL_RANGE = 100;
const OVERHEAD_EMOTE_DURATION = 3.2;
const CAST_COMPLETE_EPS = 1e-9;

// Predefined social emotes. Each entry maps a command (and its aliases) to the
// third-person action text shown to everyone in /say range. `solo` is used with
// no target; `target` (when present) is used when the emote names another
// player and contains a `%t` placeholder for that player's name. The actor's
// own name is rendered separately by the client, so these strings start at the
// verb (e.g. "Aleph" + " waves.").
interface EmoteDef { solo: string; target?: string }
const EMOTES: Record<string, EmoteDef> = {
  wave: { solo: 'waves.', target: 'waves at %t.' },
  bow: { solo: 'bows.', target: 'bows before %t.' },
  cheer: { solo: 'cheers!', target: 'cheers at %t!' },
  dance: { solo: 'bursts into dance.', target: 'dances with %t.' },
  laugh: { solo: 'laughs.', target: 'laughs at %t.' },
  cry: { solo: 'cries.', target: "cries on %t's shoulder." },
  salute: { solo: 'salutes.', target: 'salutes %t.' },
  thank: { solo: 'thanks everyone.', target: 'thanks %t.' },
  clap: { solo: 'applauds. Bravo!', target: 'applauds %t. Bravo!' },
  greet: { solo: 'greets everyone with a hearty hello.', target: 'greets %t with a hearty hello.' },
  roar: { solo: 'lets out a mighty roar.', target: 'roars at %t.' },
  sigh: { solo: 'sighs.', target: 'sighs at %t.' },
  kneel: { solo: 'kneels down.', target: 'kneels before %t.' },
  point: { solo: 'points.', target: 'points at %t.' },
  flex: { solo: 'flexes.', target: 'flexes at %t.' },
  cower: { solo: 'cowers in fear.', target: 'cowers in fear at the sight of %t.' },
};
// Command aliases → canonical emote key above.
const EMOTE_ALIASES: Record<string, string> = {
  hi: 'greet', hello: 'greet', thanks: 'thank', applaud: 'clap',
};
// The auras a target carries that are working against it. Everything else
// (buff_*, hot, absorb, imbue, stances, forms, stealth, thorns, attackspeed
// haste) is treated as helpful/neutral. Used by /targetbuffs to tag each aura.
const HARMFUL_AURA_KINDS: ReadonlySet<AuraKind> = new Set<AuraKind>([
  'dot', 'slow', 'stun', 'root', 'incapacitate', 'polymorph', 'sunder',
]);

function isHarmfulAura(kind: AuraKind): boolean {
  return HARMFUL_AURA_KINDS.has(kind);
}
const NEARBY_RANGE = 40; // /nearby scan radius — wider than say, tighter than yell
const NEARBY_MAX = 10; // cap the /nearby list so a crowded camp can't spam chat
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
const PACK_FRENZY_AURA_ID = 'pack_frenzy'; // attack-speed buff granted to surviving packmates
const SWIM_SURFACE_Y = WATER_LEVEL - 0.75; // body bobs just below the water line
const SWIM_DEPTH = 0.8; // ground this far under the water line = deep water
const SWIM_SPEED_MULT = 0.65;
const FISHING_SAMPLE_DISTANCES = [4, 8, 12, 16, 20, 24];
const DEEPFEN_FISHING_SHORE_MARGIN = 10;
const THE_CODFATHER_ITEM_ID = 'the_codfather';
const THE_CODFATHER_QUEST_ID = 'q_the_codfather';
const DOOR_TRIGGER_RADIUS = 2.0; // walking this close to a dungeon door teleports you
const BODY_RADIUS = 0.5;
const CHARGE_SPEED_MULT = 3; // warrior charge runs at 3x normal speed
const CHARGE_MAX_DURATION = 3; // seconds before a blocked charge gives up
const CHARGE_ARRIVE_RANGE = MELEE_RANGE - 1; // stop inside melee range
const FOLLOW_STOP_DIST = 3; // /follow trails this close behind the leader (yards)
const FOLLOW_MAX_RANGE = 60; // give up follow once the leader is this far away
const PET_LEASH = 40; // yards from the owner before a pet gives up its target
const PET_FOLLOW_DISTANCE = 3.5;
const PET_TELEPORT_DISTANCE = 60; // owner this far away: pet warps to heel
const PET_ASSIST_RANGE = 50; // how far the pet scans for enemies engaging the pair
const PET_AGGRESSIVE_RANGE = 18; // aggressive pets look for idle enemies this close
const PET_TAUNT_RANGE = 5;
const PET_GROWL_INTERVAL = 10; // controlled pets can tank by forcing attention
const PET_FEED_DURATION = 5;
const PET_FEED_TICK = 1;
const DEMON_HEAL_MANA_COST = 55;
const DEMON_HEAL_DURATION = 5;
const DEMON_HEAL_TICK = 1;
const TAMED_TARGET_RESPAWN_SECONDS = 60;
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

export type { ArenaFormat } from './types';

export interface ArenaQueueUnit {
  pids: number[]; // length 1 (solo) or 2 (premade)
  rating: number; // avg member arenaRating
}

// A live arena bout. Combatants are teleported into a private arena instance
// slot; `returns` remembers where each was standing so the match can put them
// back when it ends. Ratings are snapshotted at the start purely for the
// result message — the authoritative values live on each PlayerMeta.
export interface ArenaMatch {
  id: number;
  format: ArenaFormat;
  teamA: number[];
  teamB: number[];
  slot: number; // arena instance slot
  state: 'countdown' | 'active' | 'over';
  timer: number; // countdown remaining, then elapsed once active, then return countdown
  returns: Map<number, { x: number; z: number; facing: number }>;
  ratingA: number; // team avg at start
  ratingB: number;
  defeated: Set<number>;
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
  cooldown: number;   // base def.cooldown, after talent cooldown modifiers
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
  channel: 'say' | 'yell' | 'whisper' | 'general' | 'party' | 'world' | 'lfg';
  message: string;
  target?: string;
}

// Opt-in global chat channels a player can /join and /leave. `general` is
// always-on (everyone hears /general), so it is intentionally not joinable here.
export const JOINABLE_CHANNELS = ['world', 'lfg'] as const;
export type JoinableChannel = (typeof JOINABLE_CHANNELS)[number];

// Per-player progression and bags. The entity holds combat state; this holds
// everything that belongs to the character sheet.
export interface PlayerMeta {
  entityId: number;
  cls: PlayerClass;
  name: string;
  skin: number; // appearance index into the render SKINS[player_<cls>]; persisted, synced
  moveInput: MoveInput;
  inventory: InvSlot[];
  vendorBuyback: InvSlot[];
  copper: number;
  equipment: PlayerEquipment;
  xp: number;
  // Post-cap progression (Max-Level XP Overflow). `lifetimeXp` is the monotonic
  // 64-bit-safe total of all XP ever earned — it keeps growing at the cap and is
  // the leaderboard sort key + virtual-level source. `prestigeRank` and
  // `unlockedMilestones` are cosmetic-only. All persisted in CharacterState.
  lifetimeXp: number;
  prestigeRank: number;
  unlockedMilestones: Set<string>;
  known: ResolvedAbility[];
  questLog: Map<string, QuestProgress>;
  questsDone: Set<string>;
  counters: RewardCounters;
  autoEquip: boolean;
  // sim.time when this character entered the world; powers /played. Session-only
  // (sim.time resets to 0 each server boot), so it reports time this session.
  joinedAt: number;
  // Ashen Coliseum standing — persisted in CharacterState
  arenaRating: number;
  arenaWins: number;
  arenaLosses: number;
  // Talents & Specializations. `talents` is the active allocation; `talentMods`
  // is its precomputed flat struct — resolved only on allocation/respec/loadout
  // change (recomputeTalents), never walked on the combat or stat hot path.
  talents: TalentAllocation;
  talentMods: TalentModifiers;
  loadouts: SavedLoadout[];
  activeLoadout: number; // index into loadouts, or -1 for none
  // Transient presence status. Set by /afk and /dnd, cleared when the player
  // chats again. Session-only — never persisted, so it resets on login.
  away: AwayStatus | null;
  // Session-only: name of the last player who whispered us, for "/r" replies.
  // Never persisted — a fresh login starts with no reply target.
  lastWhisperFrom?: string;
}

// Away-from-keyboard / do-not-disturb presence. `afk` still delivers whispers
// (the sender just gets a heads-up); `dnd` withholds them.
export interface AwayStatus {
  mode: 'afk' | 'dnd';
  message: string;
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
  // Post-cap progression. All optional so characters saved before the Max-Level
  // XP Overflow system load cleanly (addPlayer backfills lifetimeXp from level).
  lifetimeXp?: number;
  prestigeRank?: number;
  unlockedMilestones?: string[];
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
  // Talents & Specializations (JSONB; no schema migration). All optional so
  // characters saved before talents existed load cleanly (default: no points spent).
  talents?: TalentAllocation;
  loadouts?: SavedLoadout[];
  activeLoadout?: number;
  pet?: PetState | null;
  skin?: number; // appearance index (JSONB; optional so pre-skin saves load as 0)
}

export interface PetState {
  templateId: string;
  name: string;
  level: number;
  hp: number;
  dead: boolean;
  mode?: PetMode;
}

const PET_NAME_RE = /^[A-Za-z][A-Za-z '-]{1,15}$/;

interface PendingMobRespawn {
  templateId: string;
  level: number;
  pos: Vec3;
  facing: number;
  dungeonId: string | null;
  timer: number;
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
  if (ability.id === 'ghost_wolf') return true;
  return ability.effects.some((e) => e.type === 'selfBuff'
    && (e.kind === 'form_bear' || e.kind === 'form_cat' || e.kind === 'defensive_stance' || e.kind === 'stealth'));
}

function isStealthToggle(ability: AbilityDef): boolean {
  return ability.effects.some((e) => e.type === 'selfBuff' && e.kind === 'stealth');
}

function preservesStealth(ability: AbilityDef): boolean {
  return isStealthToggle(ability) || ability.id === 'sprint';
}

function isShamanShock(abilityId: string): boolean {
  return (SHAMAN_SHOCK_COOLDOWN_IDS as readonly string[]).includes(abilityId) || abilityId === 'lightning_shock';
}

function ignoresDamagePushback(abilityId: string): boolean {
  return abilityId === 'ghost_wolf';
}

function isPetClass(cls: PlayerClass): boolean {
  return cls === 'hunter' || cls === 'warlock';
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
  // arena: format-specific queues, live bouts keyed by every participant pid,
  // and the set of busy instance slots
  arenaQueue1v1: number[] = [];
  arenaQueue2v2: ArenaQueueUnit[] = [];
  arenaMatches = new Map<number, ArenaMatch>(); // pid -> shared match (both pids)
  private arenaBusySlots = new Set<number>();
  private nextArenaMatchId = 1;
  // per-player chat token bucket (anti-spam); refilled lazily by sim time
  private chatTokens = new Map<number, { tokens: number; at: number }>();
  // per-player set of opt-in global channels (world, lfg) joined via /join
  private channelSubs = new Map<number, Set<JoinableChannel>>();
  // dungeon instances
  instances: InstanceSlot[] = [];
  // the World Market: one shared listing book, per-seller collections keyed by
  // character name, and the Merchant entity these are anchored to
  marketListings: MarketListing[] = [];
  private marketCollections = new Map<string, MarketCollection>();
  private nextListingId = 1;
  private merchantId = -1;
  /** When true, /dev level|tp|give chat commands are accepted (local dev only). */
  readonly devCommands: boolean;
  private pendingMobRespawns: PendingMobRespawn[] = [];

  constructor(cfg: SimConfig) {
    this.devCommands = cfg.devCommands ?? false;
    this.cfg = {
      seed: cfg.seed,
      playerClass: cfg.playerClass,
      respawnSeconds: cfg.respawnSeconds ?? 25,
      autoEquip: cfg.autoEquip ?? false,
      playerName: cfg.playerName ?? 'Adventurer',
      devCommands: this.devCommands,
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
      // Aquatic/flagged swimmers may wade in the shallows; everyone else
      // still spawns on dry land even though combat movement can enter water.
      const minHeight = this.mobCanSpawnInWater(template) ? WATER_LEVEL - 0.5 : WATER_LEVEL + 0.4;
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

  private updatePendingMobRespawns(): void {
    if (this.pendingMobRespawns.length === 0) return;
    for (let i = this.pendingMobRespawns.length - 1; i >= 0; i--) {
      const pending = this.pendingMobRespawns[i];
      pending.timer -= DT;
      if (pending.timer > 0) continue;
      const template = MOBS[pending.templateId];
      if (template) {
        const mob = createMob(this.nextId++, template, pending.level, { ...pending.pos });
        mob.facing = pending.facing;
        mob.prevFacing = pending.facing;
        mob.dungeonId = pending.dungeonId;
        this.addEntity(mob);
      }
      this.pendingMobRespawns.splice(i, 1);
    }
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
      skin: opts?.state?.skin ?? 0,
      moveInput: emptyMoveInput(),
      inventory: [],
      vendorBuyback: [],
      copper: 0,
      equipment: { mainhand: classDef.startWeapon, chest: classDef.startChest },
      xp: 0,
      lifetimeXp: 0,
      prestigeRank: 0,
      unlockedMilestones: new Set(),
      known: [],
      questLog: new Map(),
      questsDone: new Set(),
      counters: freshCounters(),
      autoEquip: opts?.autoEquip ?? false,
      joinedAt: this.time,
      arenaRating: opts?.state?.arenaRating ?? ARENA_BASE_RATING,
      arenaWins: opts?.state?.arenaWins ?? 0,
      arenaLosses: opts?.state?.arenaLosses ?? 0,
      talents: emptyAllocation(),
      talentMods: emptyModifiers(),
      loadouts: [],
      activeLoadout: -1,
      away: null,
    };
    this.players.set(player.id, meta);
    player.skin = meta.skin; // mirror onto the entity so the renderer + wire can read it
    if (this.primaryId === -1) this.primaryId = player.id;

    if (opts?.state) {
      const s = opts.state;
      player.level = Math.max(1, Math.min(MAX_LEVEL, s.level));
      player.facing = s.facing;
      player.prevFacing = s.facing;
      meta.xp = s.xp;
      // Backfill lifetimeXp for pre-overflow saves from the level they reached
      // plus their current bar progress, so the leaderboard is meaningful for
      // existing characters from day one.
      meta.lifetimeXp = s.lifetimeXp ?? (xpToReachLevel(player.level) + Math.max(0, s.xp));
      meta.prestigeRank = s.prestigeRank ?? 0;
      if (s.unlockedMilestones) for (const id of s.unlockedMilestones) meta.unlockedMilestones.add(id);
      meta.copper = s.copper;
      meta.equipment = { ...s.equipment };
      meta.inventory = s.inventory.map((i) => ({ ...i }));
      meta.vendorBuyback = (s.vendorBuyback ?? []).map((i) => ({ ...i }));
      for (const q of s.questLog) {
        if (q.state !== 'done') meta.questLog.set(q.questId, { questId: q.questId, counts: [...q.counts], state: q.state });
      }
      for (const q of s.questsDone) meta.questsDone.add(q);
      if (s.talents) meta.talents = { spec: s.talents.spec ?? null, ranks: { ...s.talents.ranks }, choices: { ...s.talents.choices } };
      if (s.loadouts) meta.loadouts = s.loadouts.map((l) => ({ name: l.name, alloc: cloneAllocation(l.alloc), bar: [...(l.bar ?? [])] }));
      if (typeof s.activeLoadout === 'number') meta.activeLoadout = s.activeLoadout;
    }

    // Resolve the flat talent struct once, before the stat pass + ability
    // resolver below consume it (they only ever read these flat numbers).
    meta.talentMods = computeTalentModifiers(cls, meta.talents);
    this.refreshKnownAbilities(meta, false);
    recalcPlayerStats(player, cls, meta.equipment, meta.talentMods);
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
    if (opts?.state?.pet) this.restorePet(player, opts.state.pet);
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
    if (match) {
      const team = this.arenaTeamOf(match, pid);
      this.endArenaMatch(match, team === 'A' ? 'B' : team === 'B' ? 'A' : null, 'forfeit');
    }
    this.partyInvites.delete(pid);
    this.tradeInvites.delete(pid);
    this.duelInvites.delete(pid);
    // mobs forget the leaving player; persistent hunter pets are serialized
    // with the character and removed from the live world instead of released
    const pet = this.petOf(pid, true);
    if (pet) this.despawnPersistentPet(pet);
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
    this.channelSubs.delete(pid);
    if (this.primaryId === pid) this.primaryId = this.players.size > 0 ? [...this.players.keys()][0] : -1;
  }

  serializeCharacter(pid: number): CharacterState | null {
    const meta = this.players.get(pid);
    const e = this.entities.get(pid);
    if (!meta || !e) return null;
    return {
      level: e.level,
      xp: meta.xp,
      lifetimeXp: meta.lifetimeXp,
      prestigeRank: meta.prestigeRank,
      unlockedMilestones: [...meta.unlockedMilestones],
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
      talents: cloneAllocation(meta.talents),
      loadouts: meta.loadouts.map((l) => ({ name: l.name, alloc: cloneAllocation(l.alloc), bar: [...l.bar] })),
      activeLoadout: meta.activeLoadout,
      pet: this.serializePet(pid),
      skin: meta.skin,
    };
  }

  /** Set a player's appearance skin (meta + entity). Bounded; the renderer
   *  falls back to the default for an unknown index. Used by creation, the
   *  in-game changer, and the server's changeSkin command. */
  setPlayerSkin(pid: number, skin: number): boolean {
    const meta = this.players.get(pid);
    const e = this.entities.get(pid);
    if (!meta || !e) return false;
    const idx = Math.max(0, Math.min(7, Math.floor(skin)));
    meta.skin = idx;
    e.skin = idx;
    return true;
  }

  changeSkin(skin: number): void {
    this.setPlayerSkin(this.primaryId, skin);
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
  get lifetimeXp(): number {
    return this.primary.lifetimeXp;
  }
  get prestigeRank(): number {
    return this.primary.prestigeRank;
  }
  get unlockedMilestones(): string[] {
    return [...this.primary.unlockedMilestones];
  }
  // Offline leaderboard: rank the players the local sim knows about by lifetime
  // XP. Online play overrides this with the cached, realm-scoped server query.
  leaderboard(): Promise<LeaderboardEntry[]> {
    const rows = [...this.players.values()]
      .map((m) => {
        const e = this.entities.get(m.entityId);
        return e ? { meta: m, e } : null;
      })
      .filter((x): x is { meta: PlayerMeta; e: Entity } => x !== null)
      .sort((a, b) => b.meta.lifetimeXp - a.meta.lifetimeXp || b.e.level - a.e.level || a.meta.name.localeCompare(b.meta.name))
      .map(({ meta, e }, i) => ({
        rank: i + 1,
        name: meta.name,
        cls: meta.cls,
        level: e.level,
        virtualLevel: virtualLevel(meta.lifetimeXp),
        lifetimeXp: meta.lifetimeXp,
        prestigeRank: meta.prestigeRank,
      }));
    return Promise.resolve(rows);
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
  get talents(): TalentAllocation {
    return this.primary.talents;
  }
  get talentSpec(): string | null {
    return this.primary.talentMods.spec;
  }
  get talentRole(): Role | null {
    return this.primary.talentMods.role;
  }
  get loadouts(): SavedLoadout[] {
    return this.primary.loadouts;
  }
  get activeLoadout(): number {
    return this.primary.activeLoadout;
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
    meta.known = abilitiesKnownAt(meta.cls, e.level, meta.talentMods);
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
    // Keep lifetimeXp consistent with the level so post-cap progression starts
    // from a sane baseline (virtualLevel never falls below the real level). Only
    // ever raises it — lifetimeXp is monotonic.
    r.meta.lifetimeXp = Math.max(r.meta.lifetimeXp, xpToReachLevel(r.e.level));
    recalcPlayerStats(r.e, r.meta.cls, r.meta.equipment, r.meta.talentMods);
    r.e.hp = r.e.maxHp;
    if (r.e.resourceType === 'mana') r.e.resource = r.e.maxResource;
    this.refreshKnownAbilities(r.meta, false);
    this.syncPetLevel(r.e);
  }

  // -------------------------------------------------------------------------
  // Talents & Specializations (server-authoritative). Every allocation change
  // validates against the level-derived point budget + tree rules, then
  // recomputes the flat modifier struct. Restricted to out-of-combat (and not
  // mid-arena): talents never change during a fight.
  // -------------------------------------------------------------------------

  // The ONLY place a talent tree is walked. Re-resolves the flat modifier struct
  // and refreshes the stat pass + known-ability resolver that consume it.
  private recomputeTalents(meta: PlayerMeta): void {
    meta.talentMods = computeTalentModifiers(meta.cls, meta.talents);
    const e = this.entities.get(meta.entityId);
    if (e) recalcPlayerStats(e, meta.cls, meta.equipment, meta.talentMods);
    this.refreshKnownAbilities(meta, false);
  }

  private talentLockReason(p: Entity): string | null {
    if (p.inCombat) return 'You cannot change talents in combat.';
    if (this.arenaMatches.has(p.id)) return 'You cannot change talents during an arena match.';
    return null;
  }

  talentPoints(pid?: number): { total: number; spent: number } {
    const r = this.resolve(pid);
    if (!r) return { total: 0, spent: 0 };
    return { total: talentPointsAtLevel(r.e.level), spent: pointsSpent(r.meta.talents) };
  }

  private sanitizeTalentAllocation(alloc: TalentAllocation): TalentAllocation {
    const sanitized: TalentAllocation = { spec: alloc.spec ?? null, ranks: {}, choices: { ...alloc.choices } };
    for (const id in alloc.ranks) { const v = Math.floor(alloc.ranks[id]); if (v > 0) sanitized.ranks[id] = v; }
    return sanitized;
  }

  // Commit a whole staged allocation in one shot (the UI's "Apply"). Rejects any
  // allocation that fails server-side validation with a reason event (FR-4.5).
  applyTalents(alloc: TalentAllocation, pid?: number): boolean {
    const r = this.resolve(pid);
    if (!r) return false;
    const lock = this.talentLockReason(r.e);
    if (lock) { this.error(r.e.id, lock); return false; }
    const sanitized = this.sanitizeTalentAllocation(alloc);
    if (sanitized.spec && r.e.level < FIRST_TALENT_LEVEL) { this.error(r.e.id, `You may choose a specialization at level ${FIRST_TALENT_LEVEL}.`); return false; }
    const check = validateAllocation(r.meta.cls, sanitized, talentPointsAtLevel(r.e.level));
    if (!check.ok) { this.error(r.e.id, check.reason ?? 'Invalid talent build.'); return false; }
    r.meta.talents = sanitized;
    this.recomputeTalents(r.meta);
    this.emit({ type: 'log', pid: r.e.id, text: 'Talents updated.', color: '#ffd100' });
    return true;
  }

  // Spend a single point into a node (incremental API; the UI mostly stages then
  // applies). Validated identically by building + checking a candidate alloc.
  spendTalent(nodeId: string, pid?: number): boolean {
    const r = this.resolve(pid);
    if (!r) return false;
    const cand = cloneAllocation(r.meta.talents);
    cand.ranks[nodeId] = (cand.ranks[nodeId] ?? 0) + 1;
    return this.applyTalents(cand, pid);
  }

  // Choose / change specialization. Switching specs drops the previous spec
  // tree's points (they belonged to that tree); the class tree is untouched.
  setSpec(specId: string | null, pid?: number): boolean {
    const r = this.resolve(pid);
    if (!r) return false;
    const lock = this.talentLockReason(r.e);
    if (lock) { this.error(r.e.id, lock); return false; }
    const ct = talentsFor(r.meta.cls);
    if (specId !== null && !ct?.specs.some((s) => s.id === specId)) { this.error(r.e.id, 'Unknown specialization.'); return false; }
    const cand = cloneAllocation(r.meta.talents);
    cand.spec = specId;
    for (const id of Object.keys(cand.ranks)) {
      const node = ct?.nodes.find((n) => n.id === id);
      if (node?.tree === 'spec' && node.specId !== specId) { delete cand.ranks[id]; delete cand.choices[id]; }
    }
    return this.applyTalents(cand, pid);
  }

  // Free respec (out of combat): wipe all talent points. Spec is retained.
  respec(pid?: number): boolean {
    const r = this.resolve(pid);
    if (!r) return false;
    const lock = this.talentLockReason(r.e);
    if (lock) { this.error(r.e.id, lock); return false; }
    r.meta.talents = { spec: r.meta.talents.spec, ranks: {}, choices: {} };
    this.recomputeTalents(r.meta);
    this.emit({ type: 'log', pid: r.e.id, text: 'Talents reset.', color: '#ffd100' });
    return true;
  }

  // Save the current build (talents + spec + the given action-bar slot map) as a
  // named loadout. A same-named loadout is overwritten; otherwise appended up to
  // MAX_LOADOUTS. Returns the loadout index (-1 on failure).
  saveLoadout(name: string, bar: (string | null)[], pidOrAlloc?: number | TalentAllocation, allocMaybe?: TalentAllocation): number {
    const pid = typeof pidOrAlloc === 'number' ? pidOrAlloc : undefined;
    const alloc = typeof pidOrAlloc === 'object' ? pidOrAlloc : allocMaybe;
    const r = this.resolve(pid);
    if (!r) return -1;
    if (alloc) {
      const lock = this.talentLockReason(r.e);
      if (lock) { this.error(r.e.id, lock); return -1; }
      const sanitized = this.sanitizeTalentAllocation(alloc);
      if (sanitized.spec && r.e.level < FIRST_TALENT_LEVEL) { this.error(r.e.id, `You may choose a specialization at level ${FIRST_TALENT_LEVEL}.`); return -1; }
      const check = validateAllocation(r.meta.cls, sanitized, talentPointsAtLevel(r.e.level));
      if (!check.ok) { this.error(r.e.id, check.reason ?? 'Invalid talent build.'); return -1; }
      r.meta.talents = sanitized;
      this.recomputeTalents(r.meta);
    }
    const clean = (name || 'Build').toString().slice(0, 24);
    const safeBar = Array.isArray(bar) ? bar.slice(0, 16).map((b) => (typeof b === 'string' ? b : null)) : [];
    const lo: SavedLoadout = { name: clean, alloc: cloneAllocation(r.meta.talents), bar: safeBar };
    const existing = r.meta.loadouts.findIndex((l) => l.name === clean);
    if (existing >= 0) {
      r.meta.loadouts[existing] = lo;
      r.meta.activeLoadout = existing;
      this.emit({ type: 'log', pid: r.e.id, text: `Saved build "${clean}".`, color: '#ffd100' });
      return existing;
    }
    if (r.meta.loadouts.length >= MAX_LOADOUTS) { this.error(r.e.id, `You can save at most ${MAX_LOADOUTS} loadouts.`); return -1; }
    r.meta.loadouts.push(lo);
    r.meta.activeLoadout = r.meta.loadouts.length - 1;
    this.emit({ type: 'log', pid: r.e.id, text: `Saved build "${clean}".`, color: '#ffd100' });
    return r.meta.activeLoadout;
  }

  // Apply a saved loadout's talents (out of combat). The action bar is restored
  // client-side from the loadout's stored slot map. Re-validated server-side.
  switchLoadout(index: number, pid?: number): boolean {
    const r = this.resolve(pid);
    if (!r) return false;
    const lock = this.talentLockReason(r.e);
    if (lock) { this.error(r.e.id, lock); return false; }
    const lo = r.meta.loadouts[index];
    if (!lo) { this.error(r.e.id, 'No such loadout.'); return false; }
    if (lo.alloc.spec && r.e.level < FIRST_TALENT_LEVEL) { this.error(r.e.id, 'That loadout needs a higher level.'); return false; }
    const check = validateAllocation(r.meta.cls, lo.alloc, talentPointsAtLevel(r.e.level));
    if (!check.ok) { this.error(r.e.id, `Loadout invalid: ${check.reason ?? 'unknown'}`); return false; }
    r.meta.talents = cloneAllocation(lo.alloc);
    r.meta.activeLoadout = index;
    this.recomputeTalents(r.meta);
    this.emit({ type: 'log', pid: r.e.id, text: `Loadout "${lo.name}" applied.`, color: '#ffd100' });
    return true;
  }

  deleteLoadout(index: number, pid?: number): boolean {
    const r = this.resolve(pid);
    if (!r || index < 0 || index >= r.meta.loadouts.length) return false;
    const wasActive = r.meta.activeLoadout === index;
    const name = r.meta.loadouts[index].name;
    r.meta.loadouts.splice(index, 1);
    if (wasActive) {
      r.meta.activeLoadout = r.meta.loadouts.length > 0 ? Math.min(index, r.meta.loadouts.length - 1) : -1;
      const next = r.meta.activeLoadout >= 0 ? r.meta.loadouts[r.meta.activeLoadout] : null;
      if (next) {
        r.meta.talents = cloneAllocation(next.alloc);
        this.recomputeTalents(r.meta);
      }
    } else if (r.meta.activeLoadout > index) r.meta.activeLoadout -= 1;
    this.emit({ type: 'log', pid: r.e.id, text: `Deleted build "${name}".`, color: '#ffd100' });
    return true;
  }

  // Threat modifier including the tank-role talent bonus (e.g. Protection's
  // Vengeance Mastery). Reads the precomputed flat threatPct — no tree walk.
  private threatMod(source: Entity, school: string): number {
    let m = threatModifier(source, school);
    if (source.kind === 'player') {
      const meta = this.players.get(source.id);
      if (meta) m *= 1 + meta.talentMods.global.threatPct;
    }
    return m;
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
    this.updatePendingMobRespawns();

    for (const e of this.entities.values()) {
      copyPos(e.prevPos, e.pos);
      e.prevFacing = e.facing;
      if (e.overheadEmoteId && this.time >= e.overheadEmoteUntil) {
        e.overheadEmoteId = null;
        e.overheadEmoteUntil = 0;
      }
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
      if (e.kind !== 'mob' || e.dead) continue;
      // a wild mob actively engaged keeps its target in combat — and if that
      // target is someone's pet, the pet's owner stays in combat too, so a
      // hunter/warlock can't regen, eat/drink, or use out-of-combat abilities
      // while their pet tanks
      if (e.ownerId === null && (e.aiState === 'chase' || e.aiState === 'attack' || e.aiState === 'flee') && e.aggroTargetId !== null) {
        this.engagedPids.add(e.aggroTargetId);
        const tgt = this.entities.get(e.aggroTargetId);
        if (tgt && tgt.ownerId !== null) this.engagedPids.add(tgt.ownerId);
      }
      // a player's pet that is engaging an enemy keeps its owner in combat
      if (e.ownerId !== null && e.aggroTargetId !== null) this.engagedPids.add(e.ownerId);
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
  private fearAura(e: Entity): Aura | undefined {
    return e.auras.find((a) => a.id === 'fear_incap' && a.kind === 'incapacitate');
  }
  private updateFearMovement(e: Entity): boolean {
    const aura = this.fearAura(e);
    if (!aura || e.auras.some((a) => a.kind === 'root')) return false;
    const angle = Number.isFinite(aura.value) ? aura.value : e.facing;
    const dest = this.groundPos(e.pos.x + Math.sin(angle) * 10, e.pos.z + Math.cos(angle) * 10);
    this.moveToward(e, dest, e.moveSpeed * FLEE_SPEED_MULT * this.moveSpeedMult(e));
    return true;
  }
  // Silence locks out spell (non-physical) casts but leaves physical abilities,
  // movement and melee untouched — unlike a stun, which freezes everything.
  private isSilenced(e: Entity): boolean {
    return e.auras.some((a) => a.kind === 'silence');
  }
  private mobCanSwim(template: { family?: string; canSwim?: boolean } | undefined): boolean {
    return !!template;
  }
  private mobCanSpawnInWater(template: { family?: string; canSwim?: boolean } | undefined): boolean {
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
        else if (a.kind === 'debuff_ap') attackPower -= a.value;
      }
    }
    return Math.max(0, attackPower);
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

  private syncPetAspect(pet: Entity, owner: Entity): void {
    const ownerAspect = owner.auras.find((a) => a.id === 'aspect_of_the_hawk' || a.id === 'aspect_of_the_cheetah') ?? null;
    const aspectId = ownerAspect ? `pet_${ownerAspect.id}` : null;
    for (let i = pet.auras.length - 1; i >= 0; i--) {
      const aura = pet.auras[i];
      if (!aura.id.startsWith('pet_aspect_')) continue;
      if (aspectId !== aura.id) pet.auras.splice(i, 1);
    }
    if (!ownerAspect || !aspectId) return;
    const existing = pet.auras.find((a) => a.id === aspectId);
    if (existing) {
      existing.remaining = ownerAspect.remaining;
      existing.duration = ownerAspect.duration;
      existing.value = ownerAspect.value;
      return;
    }
    pet.auras.push({
      ...ownerAspect,
      id: aspectId,
      sourceId: owner.id,
    });
  }

  // swing interval multiplier: >1 = slower (thunder clap), haste divides
  private swingIntervalMult(e: Entity): number {
    let m = 1;
    for (const a of e.auras) {
      if (a.kind === 'attackspeed') m *= a.value;
      if (a.kind === 'buff_haste') m /= a.value;
    }
    // Enrage frenzy: an enraged mob swings faster (mirrors the inline dmgMult
    // applied in mobSwing). Composes with any slow/haste auras above.
    if (e.enraged) {
      const h = MOBS[e.templateId]?.enrage?.hasteMult;
      if (h && h > 0) m /= h;
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

  // /follow: a second forced-movement mode (like charge) that trails another
  // player. Returns true when it has taken over locomotion for this tick so the
  // normal input-driven movement below is skipped. Any manual movement, combat,
  // or the leader slipping out of range ends the follow.
  stopFollow(p: Entity, msg?: string): void {
    if (p.followTargetId === null) return;
    p.followTargetId = null;
    if (msg) this.error(p.id, msg);
  }

  private updateFollowMovement(p: Entity, meta: PlayerMeta): boolean {
    if (p.followTargetId === null) return false;
    const inp = meta.moveInput;
    // any manual locomotion (incl. camera turns) breaks follow, classic-style
    if (inp.forward || inp.back || inp.strafeLeft || inp.strafeRight || inp.jump
      || inp.turnLeft || inp.turnRight) {
      this.stopFollow(p, 'You stop following.');
      return false;
    }
    const t = this.entities.get(p.followTargetId);
    if (!t || t.dead || t.kind !== 'player' || !this.players.has(t.id)) {
      this.stopFollow(p, 'There is no one to follow.');
      return false;
    }
    if (p.inCombat) { this.stopFollow(p, 'You stop following — you are in combat.'); return false; }
    const d = dist2d(p.pos, t.pos);
    if (d > FOLLOW_MAX_RANGE) { this.stopFollow(p, `${t.name} is too far away to follow.`); return false; }
    // always turn to face the leader, even while held in place
    p.facing = angleTo(p.pos, t.pos);
    if (this.isStunned(p) || this.isRooted(p) || d <= FOLLOW_STOP_DIST) return true;
    let speed = RUN_SPEED * this.moveSpeedMult(p);
    if (this.isSwimming(p)) speed *= SWIM_SPEED_MULT;
    const step = Math.min(speed * DT, d - FOLLOW_STOP_DIST);
    const nx = p.pos.x + Math.sin(p.facing) * step;
    const nz = p.pos.z + Math.cos(p.facing) * step;
    const h0 = groundHeight(p.pos.x, p.pos.z, this.cfg.seed);
    const h1 = groundHeight(nx, nz, this.cfg.seed);
    if (h1 < WATER_LEVEL - SWIM_DEPTH) return true; // don't trail into deep water
    if (h1 > h0 && step > 1e-5 && (h1 - h0) / step > MAX_CLIMB_SLOPE) return true; // wall/cliff
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
    if (this.updateFollowMovement(p, meta)) return;
    if (this.updateFearMovement(p)) return;
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

    const hasMoveInput = mx !== 0 || mz !== 0;
    const moving = hasMoveInput && !this.isRooted(p);
    const swimming = this.isSwimming(p);
    let wishX = 0, wishZ = 0, wishSpeed = 0;
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
      wishX = wx;
      wishZ = wz;
      wishSpeed = speed;
    }

    const movingOnGround = moving && (p.onGround || swimming);
    if (movingOnGround || (!p.onGround && (p.vx !== 0 || p.vz !== 0))) {
      const stepX = movingOnGround ? wishX * wishSpeed : p.vx;
      const stepZ = movingOnGround ? wishZ * wishSpeed : p.vz;
      let nx = p.pos.x + stepX * DT;
      let nz = p.pos.z + stepZ * DT;
      // cliffs and the world rim are walls, not ramps
      if (p.onGround && !swimming) {
        const h0 = groundHeight(p.pos.x, p.pos.z, this.cfg.seed);
        const h1 = groundHeight(nx, nz, this.cfg.seed);
        const run = Math.hypot(nx - p.pos.x, nz - p.pos.z);
        if (h1 > h0 && run > 1e-5 && (h1 - h0) / run > MAX_CLIMB_SLOPE) {
          nx = p.pos.x;
          nz = p.pos.z;
          if (!p.onGround) { p.vx = 0; p.vz = 0; }
        }
      }
      // slide along buildings, trees, crypt walls
      const resolved = resolvePosition(this.cfg.seed, nx, nz, BODY_RADIUS);
      p.pos.x = resolved.x;
      p.pos.z = resolved.z;
      if (!p.onGround && (resolved.x !== nx || resolved.z !== nz)) {
        p.vx = (resolved.x - p.prevPos.x) / DT;
        p.vz = (resolved.z - p.prevPos.z) / DT;
      }
    }

    // Vertical: jumping, gravity, swimming, fall damage
    const ground = groundHeight(p.pos.x, p.pos.z, this.cfg.seed);
    const deepWater = ground < WATER_LEVEL - SWIM_DEPTH;
    if (deepWater && p.pos.y <= SWIM_SURFACE_Y + 0.05) {
      // treading water at the surface
      p.pos.y = SWIM_SURFACE_Y;
      p.vy = 0;
      p.vx = 0;
      p.vz = 0;
      p.onGround = true;
      p.fallStartY = p.pos.y;
      if (inp.jump && !this.isRooted(p)) {
        // small hop to climb onto shores and docks
        p.vy = JUMP_VELOCITY * 0.7;
        p.vx = wishX * wishSpeed;
        p.vz = wishZ * wishSpeed;
        p.onGround = false;
      }
      return;
    }
    if (inp.jump && p.onGround && !this.isRooted(p)) {
      p.vy = JUMP_VELOCITY;
      p.vx = wishX * wishSpeed;
      p.vz = wishZ * wishSpeed;
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
        p.vx = 0;
        p.vz = 0;
        p.onGround = true;
        p.fallStartY = p.pos.y;
        return;
      }
      if (p.pos.y <= ground) {
        p.pos.y = ground;
        p.vy = 0;
        p.vx = 0;
        p.vz = 0;
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
        p.vx = 0;
        p.vz = 0;
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
        const heal = Math.min(Math.round(c.hpPer2s * this.healingTakenMult(p)), p.maxHp - p.hp);
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
            const healed = Math.min(Math.round(a.value * this.healingTakenMult(e)), e.maxHp - e.hp);
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
      if (meta) recalcPlayerStats(e, meta.cls, meta.equipment, meta.talentMods);
    }
  }

  // -------------------------------------------------------------------------
  // Casting, channeling & abilities
  // -------------------------------------------------------------------------

  private updateCasting(p: Entity, meta: PlayerMeta): void {
    if (!p.castingAbility) return;
    if (this.isStunned(p)) { this.cancelCast(p); return; }
    // a silence breaks an in-progress spell, but never the fishing cast or a
    // physical channel (e.g. an aimed-shot kind) — those aren't spells.
    if (this.isSilenced(p) && p.castingAbility !== FISHING_CAST_ID) {
      const cast = this.resolvedAbility(p.castingAbility, p.id);
      if (cast && cast.def.school !== 'physical') { this.cancelCast(p); return; }
    }
    p.castRemaining -= DT;

    if (p.channeling) {
      p.channelTickTimer -= DT;
      if (p.channelTickTimer <= 0) {
        p.channelTickTimer += p.channelTickEvery;
        if (p.castingAbility === DEMON_HEAL_CAST_ID) {
          this.applyDemonHealTick(p);
        } else {
          const res = this.resolvedAbility(p.castingAbility, p.id);
          if (res) this.applyChannelTick(p, res);
        }
      }
      if (p.castRemaining <= CAST_COMPLETE_EPS) {
        p.castingAbility = null;
        p.channeling = false;
        this.emit({ type: 'castStop', entityId: p.id, success: true });
      }
      return;
    }

    if (p.castRemaining <= CAST_COMPLETE_EPS) {
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

  private abilityNeedsLineOfSight(ability: AbilityDef): boolean {
    if (!ability.requiresTarget) return false;
    return ability.school !== 'physical' || ability.range > MELEE_RANGE;
  }

  private hasLineOfSight(source: Entity, target: Entity): boolean {
    return lineOfSightClear(this.cfg.seed, source.pos, target.pos);
  }

  private lineOfSightBlocked(source: Entity, target: Entity, ability: AbilityDef): boolean {
    return this.abilityNeedsLineOfSight(ability) && !this.hasLineOfSight(source, target);
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
    if (ability.school !== 'physical' && this.isSilenced(p)) { this.error(p.id, 'You are silenced!'); return; }
    if (p.castingAbility) { this.error(p.id, 'You are busy.'); return; }
    if (!ability.offGcd && p.gcdRemaining > 0) return; // silent, classic spams this
    const togglingOff = isToggleBuff(ability) && p.auras.some((a) => a.id === ability.id);
    const sharedCooldown = isShamanShock(ability.id)
      ? SHAMAN_SHOCK_COOLDOWN_IDS.find((id) => p.cooldowns.has(id))
      : undefined;
    if ((p.cooldowns.has(ability.id) || sharedCooldown) && !togglingOff) { this.error(p.id, 'That ability is not ready yet.'); return; }
    // shifting out of a form is free; shifting across forms bills the parked
    // mana (the live bar is rage/energy in a form) — see spendAbilityCost
    if (p.resource < res.cost && !togglingOff && !this.formShiftKind(p, ability)) {
      this.error(p.id, p.resourceType === 'rage' ? 'Not enough rage!' : p.resourceType === 'energy' ? 'Not enough energy!' : 'Not enough mana!');
      return;
    }
    // casting is deliberate action — drop any active follow so you don't drift
    this.stopFollow(p);
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
        this.error(p.id, `You must be in ${ability.requiresForm === 'bear' ? 'Bear' : 'Wolf'} Form.`);
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
      if (this.lineOfSightBlocked(p, target, ability)) { this.error(p.id, 'Line of sight.'); return; }
    } else if (ability.requiresTarget) {
      target = p.targetId !== null ? this.entities.get(p.targetId) ?? null : null;
      if (!target || target.dead || !this.isHostileTo(p, target)) { this.error(p.id, 'You have no target.'); return; }
      const d = dist2d(p.pos, target.pos);
      const maxRange = ability.range > 0 ? ability.range : MELEE_RANGE;
      if (d > maxRange) { this.error(p.id, 'Out of range.'); return; }
      if (ability.minRange && d < ability.minRange) { this.error(p.id, 'Too close!'); return; }
      if (this.lineOfSightBlocked(p, target, ability)) { this.error(p.id, 'Line of sight.'); return; }
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
          if (target.kind === 'mob') {
            const fam = MOBS[target.templateId]?.family;
            if (fam === 'undead' || target.templateId === 'gorrak') { this.error(p.id, 'This creature cannot be polymorphed.'); return; }
          } else if (target.kind !== 'player') {
            this.error(p.id, 'This creature cannot be polymorphed.');
            return;
          }
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
    if (ability.id !== 'ghost_wolf' && p.auras.some((a) => a.id === 'ghost_wolf')) {
      this.breakGhostWolf(p);
    }

    // Heroic-strike style: queue on next swing, pay cost on the swing itself.
    if (ability.onNextSwing) {
      p.queuedOnSwing = p.queuedOnSwing === ability.id ? null : ability.id;
      if (!p.autoAttack && target) this.startAutoAttack(p.id);
      return;
    }

    const gcd = this.playerGcdFor(meta.cls);

    if (ability.channel) {
      this.spendResource(p, res.cost);
      this.armAbilityCooldown(p, ability.id, res.cooldown);
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

    if (res.castTime > 0 && !togglingOff) {
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
    if (isToggleBuff(res.def) && p.auras.some((a) => a.id === res.def.id)) return;
    const shift = this.formShiftKind(p, res.def);
    if (shift === 'off') return;
    if (shift === 'cross') {
      p.savedMana = Math.max(0, p.savedMana - res.cost);
      return;
    }
    this.spendResource(p, res.cost);
  }

  private armAbilityCooldown(p: Entity, abilityId: string, cooldown: number, togglingOff = false): void {
    if (cooldown <= 0 || togglingOff) return;
    if (isShamanShock(abilityId)) {
      for (const id of SHAMAN_SHOCK_COOLDOWN_IDS) p.cooldowns.set(id, cooldown);
      return;
    }
    p.cooldowns.set(abilityId, cooldown);
  }

  private applyChannelTick(p: Entity, res: ResolvedAbility): void {
    const target = p.targetId !== null ? this.entities.get(p.targetId) : null;
    if (!target || target.dead || !this.isHostileTo(p, target)) { this.cancelCast(p); return; }
    const maxRange = res.def.range > 0 ? res.def.range : MELEE_RANGE;
    if (dist2d(p.pos, target.pos) > maxRange) {
      this.error(p.id, 'Out of range.');
      this.cancelCast(p);
      return;
    }
    if (this.lineOfSightBlocked(p, target, res.def)) {
      this.error(p.id, 'Line of sight.');
      this.cancelCast(p);
      return;
    }
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

  // Combined incoming-healing multiplier from Mortal Wound debuffs (classic
  // Mortal Strike): each reduces healing the target receives; multiple stack
  // multiplicatively. 1 = unaffected, 0 = fully suppressed.
  private healingTakenMult(target: Entity): number {
    let mult = 1;
    for (const a of target.auras) {
      if (a.kind === 'mortal_wound') mult *= 1 - a.value;
    }
    return mult < 0 ? 0 : mult;
  }

  private applyHeal(source: Entity, target: Entity, amount: number, ability: string): void {
    if (target.dead) return;
    const crit = this.rng.chance(this.spellCrit(source));
    let healed = Math.round(amount * (crit ? 1.5 : 1) * this.healingTakenMult(target));
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
    const total = healed * HEAL_THREAT_FACTOR * this.threatMod(source, 'physical');
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
    const togglingOff = isToggleBuff(ability) && p.auras.some((a) => a.id === ability.id);
    if (ability.id === 'conjure_water') {
      this.spendResource(p, res.cost);
      // higher ranks conjure better water (falls back if the item isn't defined)
      const tiered = `conjured_water${res.rank}`;
      this.addItem(res.rank > 1 && ITEMS[tiered] ? tiered : 'conjured_water', 2, p.id);
      return;
    }
    if (ability.id === 'revive_pet') {
      const pet = this.petOf(p.id, true);
      if (!pet) { this.error(p.id, 'You have no pet.'); return; }
      if (!pet.dead) { this.error(p.id, 'Your pet is already alive.'); return; }
      this.spendResource(p, res.cost);
      this.armAbilityCooldown(p, ability.id, res.cooldown);
      this.revivePet(p.id);
      return;
    }

    let target: Entity | null = null;
    if (ability.requiresTarget && ability.targetType === 'friendly') {
      const cur = p.targetId !== null ? this.entities.get(p.targetId) ?? null : null;
      target = cur && !cur.dead && this.isFriendlyTo(p, cur) ? cur : p;
      if (dist2d(p.pos, target.pos) > Math.max(ability.range, 5) + 2) { this.error(p.id, 'Out of range.'); return; }
      if (this.lineOfSightBlocked(p, target, ability)) { this.error(p.id, 'Line of sight.'); return; }
    } else if (ability.requiresTarget) {
      target = p.targetId !== null ? this.entities.get(p.targetId) ?? null : null;
      if (!target || target.dead) { this.error(p.id, 'You have no target.'); return; }
      const d = dist2d(p.pos, target.pos);
      const maxRange = ability.range > 0 ? ability.range : MELEE_RANGE;
      if (d > maxRange + 2) { this.error(p.id, 'Out of range.'); return; }
      if (this.lineOfSightBlocked(p, target, ability)) { this.error(p.id, 'Line of sight.'); return; }
    }
    if (p.resource < res.cost && !togglingOff && !this.formShiftKind(p, ability)) { this.error(p.id, 'Not enough ' + (p.resourceType ?? 'resource') + '!'); return; }

    // helpful spells never miss
    if (ability.targetType === 'friendly') {
      this.spendAbilityCost(p, res);
      this.armAbilityCooldown(p, ability.id, res.cooldown, togglingOff);
      this.runEffects(p, meta, target, res);
      return;
    }

    if (target && ability.school !== 'physical') {
      this.spendAbilityCost(p, res);
      this.armAbilityCooldown(p, ability.id, res.cooldown, togglingOff);
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
    this.armAbilityCooldown(p, ability.id, res.cooldown, togglingOff);
    this.runEffects(p, meta, target, res);
  }

  private runEffects(p: Entity, meta: PlayerMeta, target: Entity | null, res: ResolvedAbility): void {
    const ability = res.def;
    const isSpell = ability.school !== 'physical';
    const spentCombo = ability.spendsCombo ? p.comboPoints : 0;
    let comboAwarded = false;
    // acting breaks stealth (the opener itself still lands first inside the swing).
    // Stealth toggles and Rogue Sprint are allowed while remaining hidden.
    if (!preservesStealth(ability)) this.breakStealth(p);
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
          const remaining = ability.id === 'fear'
            ? this.diminishedCrowdControlDuration(p, target, 'fear', eff.duration)
            : eff.duration;
          if (remaining === null) break;
          this.applyAura(target, {
            id: ability.id + '_incap', name: ability.name, kind: 'incapacitate',
            remaining, duration: remaining,
            value: ability.id === 'fear' ? this.rng.range(-Math.PI, Math.PI) : 0,
            sourceId: p.id, school: ability.school, breaksOnDamage: true,
          });
          if (ability.awardsCombo && !comboAwarded) { this.awardCombo(p, target, ability.awardsCombo); comboAwarded = true; }
          this.enterCombat(p, target);
          break;
        }
        case 'polymorph': {
          if (!target || target.dead) break;
          const remaining = this.diminishedCrowdControlDuration(p, target, 'polymorph', eff.duration);
          if (remaining === null) break;
          target.hp = target.maxHp;
          this.applyAura(target, {
            id: ability.id, name: ability.name, kind: 'polymorph',
            remaining, duration: remaining, value: 0,
            tickInterval: 1, tickTimer: 1,
            sourceId: p.id, school: ability.school, breaksOnDamage: true,
          });
          target.auras = target.auras.filter((a) => a.kind !== 'dot' || a.id === ability.id);
          this.enterCombat(p, target);
          break;
        }
        case 'aoeDamage': {
          this.emit({ type: 'spellfx', sourceId: p.id, targetId: p.id, school: ability.school, fx: 'nova' });
          for (const m of this.hostilesInRadius(p, p.pos, eff.radius)) {
            if (!this.hasLineOfSight(p, m)) continue;
            let dmg = this.rng.range(eff.min, eff.max);
            // Armor only mitigates physical damage, mirroring the single-target
            // path above — spell-school AoE (Arcane Explosion, Consecration) is
            // not reduced by the target's armor.
            if (!isSpell) dmg *= 1 - armorReduction(this.effectiveArmor(m), p.level);
            this.dealDamage(p, m, Math.round(dmg), false, ability.school, ability.name, 'hit', false, threatOpts);
          }
          break;
        }
        case 'aoeAttackSpeed': {
          for (const m of this.hostilesInRadius(p, p.pos, eff.radius)) {
            if (m.dead) continue;
            if (!this.hasLineOfSight(p, m)) continue;
            this.applyAura(m, {
              id: ability.id + '_as', name: ability.name, kind: 'attackspeed',
              remaining: eff.duration, duration: eff.duration, value: eff.mult,
              sourceId: p.id, school: ability.school,
            });
          }
          break;
        }
        case 'aoeAttackPower': {
          for (const m of this.hostilesInRadius(p, p.pos, eff.radius)) {
            if (m.dead) continue;
            this.applyAura(m, {
              id: ability.id + '_ap', name: ability.name, kind: 'debuff_ap',
              remaining: eff.duration, duration: eff.duration, value: eff.amount,
              sourceId: p.id, school: ability.school,
            });
            this.enterCombat(p, m);
            if (m.kind === 'mob' && m.hostile) addThreat(m, p.id, 10 * this.threatMod(p, ability.school));
          }
          break;
        }
        case 'aoeRoot': {
          this.emit({ type: 'spellfx', sourceId: p.id, targetId: p.id, school: ability.school, fx: 'nova' });
          for (const m of this.hostilesInRadius(p, p.pos, eff.radius)) {
            if (!this.hasLineOfSight(p, m)) continue;
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
            || eff.kind === 'defensive_stance' || eff.kind === 'stealth'
            || ability.id === 'ghost_wolf';
          if (isToggle) {
            const existing = p.auras.findIndex((a) => a.id === ability.id);
            if (existing >= 0) {
              p.auras.splice(existing, 1);
              this.emit({ type: 'aura', targetId: p.id, name: ability.name, gained: false });
              recalcPlayerStats(p, meta.cls, meta.equipment, meta.talentMods);
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
          recalcPlayerStats(p, meta.cls, meta.equipment, meta.talentMods);
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
          addThreat(target, p.id, res.threatFlat * this.threatMod(p, 'physical'));
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
        case 'summonPet': {
          this.summonPet(p, eff.templateId);
          break;
        }
        case 'dismissPet': {
          const pet = this.petOf(p.id);
          if (!pet) { this.error(p.id, 'You have no pet.'); break; }
          this.error(p.id, 'Permanent pets can only be abandoned from the pet frame.');
          break;
        }
        case 'summonDemon': {
          this.summonPet(p, eff.mobId);
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
      if (meta) recalcPlayerStats(target, meta.cls, meta.equipment, meta.talentMods);
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
    const reset = category === 'polymorph'
      ? PVP_POLYMORPH_DR_RESET
      : category === 'fear'
        ? PVP_FEAR_DR_RESET
        : PVP_ROOT_DR_RESET;
    if (category === 'polymorph') {
      target.ccDr.set(category, { stage: stage + 1, resetAt: this.time + reset });
      return PVP_POLYMORPH_DR_DURATIONS[Math.min(stage, PVP_POLYMORPH_DR_DURATIONS.length - 1)];
    }
    if (category === 'fear') {
      target.ccDr.set(category, { stage: stage + 1, resetAt: this.time + reset });
      return PVP_FEAR_DR_DURATIONS[Math.min(stage, PVP_FEAR_DR_DURATIONS.length - 1)];
    }
    if (stage >= PVP_CC_DR_MULTIPLIERS.length) return null;
    target.ccDr.set(category, { stage: stage + 1, resetAt: this.time + reset });
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

  private breakGhostWolf(e: Entity): void {
    const idx = e.auras.findIndex((a) => a.id === 'ghost_wolf');
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
    else if (mob.aiState === 'flee') { mob.aggroTargetId = p.id; mob.aiState = 'attack'; mob.fleeTimer = 0; }
    this.enterCombat(p, mob);
  }

  // -------------------------------------------------------------------------
  // Hunter pets
  // -------------------------------------------------------------------------

  petOf(ownerPid: number, includeDead = false): Entity | null {
    for (const e of this.entities.values()) {
      if (e.kind === 'mob' && e.ownerId === ownerPid && (includeDead || !e.dead)) return e;
    }
    return null;
  }

  private serializePet(ownerPid: number): PetState | null {
    const pet = this.petOf(ownerPid, true);
    if (!pet) return null;
    return {
      templateId: pet.templateId,
      name: pet.name,
      level: pet.level,
      hp: pet.dead ? 0 : Math.max(1, Math.min(pet.maxHp, pet.hp)),
      dead: pet.dead,
      mode: pet.petMode,
    };
  }

  private restorePet(owner: Entity, state: PetState): void {
    const template = MOBS[state.templateId];
    if (!template) return;
    const level = owner.level;
    const pos = this.groundPos(owner.pos.x + 2, owner.pos.z + 1);
    const pet = createMob(this.nextId++, template, level, pos);
    pet.name = this.cleanPetName(state.name) ?? template.name;
    pet.ownerId = owner.id;
    pet.petMode = state.mode ?? 'defensive';
    pet.petTauntTimer = 0;
    pet.hostile = false;
    pet.aiState = state.dead ? 'dead' : 'idle';
    pet.aggroTargetId = null;
    pet.inCombat = false;
    pet.tappedById = null;
    pet.loot = null;
    pet.lootable = false;
    pet.wanderTarget = null;
    clearThreat(pet);
    if (state.dead) {
      pet.dead = true;
      pet.hp = 0;
      pet.corpseTimer = Infinity;
      pet.respawnTimer = Infinity;
    } else {
      pet.hp = Math.max(1, Math.min(pet.maxHp, Math.round(state.hp) || pet.maxHp));
    }
    this.addEntity(pet);
  }

  private syncPetLevel(owner: Entity): void {
    const pet = this.petOf(owner.id, true);
    if (!pet || pet.level === owner.level) return;
    const template = MOBS[pet.templateId];
    if (!template) return;
    const hpFrac = pet.maxHp > 0 ? pet.hp / pet.maxHp : 1;
    const scaled = createMob(-1, template, owner.level, pet.pos);
    pet.level = scaled.level;
    pet.maxHp = scaled.maxHp;
    pet.weapon = scaled.weapon;
    pet.stats.armor = scaled.stats.armor;
    pet.moveSpeed = scaled.moveSpeed;
    pet.scale = scaled.scale;
    pet.color = scaled.color;
    pet.hp = pet.dead ? 0 : Math.max(1, Math.min(pet.maxHp, Math.round(pet.maxHp * hpFrac)));
  }

  private cleanPetName(raw: string): string | null {
    const name = raw.trim().replace(/\s+/g, ' ');
    return PET_NAME_RE.test(name) ? name : null;
  }

  private tameError(p: Entity, target: Entity): string | null {
    if (target.kind !== 'mob' || !target.hostile) return 'You cannot tame that.';
    const template = MOBS[target.templateId];
    if (!template || (template.family !== 'beast' && template.family !== 'spider')) return 'Only beasts can be tamed.';
    if (template.elite || template.boss || template.rare) return 'That beast is too strong to tame.';
    if (target.level > p.level) return 'That beast is too high level for you to tame.';
    if (target.spawnPos.x > DUNGEON_X_THRESHOLD) return 'You cannot tame dungeon creatures.';
    if (this.petOf(p.id, true)) return 'You already have a pet.';
    return null;
  }

  private completeTame(p: Entity, target: Entity): void {
    const err = this.tameError(p, target);
    if (err) { this.error(p.id, err); return; }
    const template = MOBS[target.templateId];
    const pet = createMob(this.nextId++, template, target.level, this.groundPos(p.pos.x + 2, p.pos.z + 1));
    pet.name = target.name;
    pet.ownerId = p.id;
    pet.petMode = 'defensive';
    pet.petTauntTimer = 0;
    pet.hostile = false;
    pet.aiState = 'idle';
    pet.aggroTargetId = null;
    pet.inCombat = false;
    pet.tappedById = null;
    pet.auras = [];
    pet.hp = pet.maxHp;
    pet.loot = null;
    pet.lootable = false;
    pet.wanderTarget = null;
    clearThreat(pet);

    this.pendingMobRespawns.push({
      templateId: target.templateId,
      level: target.level,
      pos: { ...target.spawnPos },
      facing: target.facing,
      dungeonId: target.dungeonId,
      timer: TAMED_TARGET_RESPAWN_SECONDS,
    });
    this.clearEntityMarker(target.id);
    this.dropEntity(target.id);

    // The owned copy is friendly now: nobody keeps swinging at the old target,
    // other mobs forget both the old entity and the new pet starts clean.
    for (const other of this.players.values()) {
      const e = this.entities.get(other.entityId);
      if (e && e.targetId === target.id) e.autoAttack = false;
    }
    for (const m of this.entities.values()) {
      if (m.kind !== 'mob') continue;
      m.threat.delete(target.id);
      if (m.aggroTargetId === target.id && !m.dead && m.aiState !== 'dead') this.retargetMob(m);
    }
    this.addEntity(pet);
    this.syncPetLevel(p);
    this.emit({ type: 'log', text: `${pet.name} is now your loyal companion.`, color: '#8f8', pid: p.id });
    this.emit({ type: 'aura', targetId: pet.id, name: 'Tamed', gained: true });
  }

  private summonPet(owner: Entity, templateId: string): void {
    const template = MOBS[templateId];
    if (!template) { this.error(owner.id, 'That summon is unavailable.'); return; }
    const existing = this.petOf(owner.id, true);
    if (existing) {
      this.despawnPersistentPet(existing);
      if (existing.templateId === templateId && !existing.dead) {
        this.emit({ type: 'log', text: `${existing.name} fades back into the void.`, color: '#b894ff', pid: owner.id });
        return;
      }
    }

    const pet = createMob(this.nextId++, template, owner.level, this.groundPos(owner.pos.x + 2, owner.pos.z + 1));
    pet.name = template.name;
    pet.ownerId = owner.id;
    pet.petMode = 'defensive';
    pet.petTauntTimer = 0;
    pet.hostile = false;
    pet.aiState = 'idle';
    pet.aggroTargetId = null;
    pet.inCombat = false;
    pet.tappedById = null;
    pet.auras = [];
    pet.hp = pet.maxHp;
    pet.loot = null;
    pet.lootable = false;
    pet.wanderTarget = null;
    clearThreat(pet);
    this.addEntity(pet);
    this.emit({ type: 'log', text: `${pet.name} answers your summons.`, color: '#b894ff', pid: owner.id });
    this.emit({ type: 'aura', targetId: pet.id, name: 'Summoned', gained: true });
  }

  private despawnPersistentPet(pet: Entity): void {
    this.clearNonPlayerStatAuras(pet);
    pet.auras = [];
    clearThreat(pet);
    for (const m of this.entities.values()) {
      if (m.kind !== 'mob' || m.id === pet.id) continue;
      m.threat.delete(pet.id);
      if (m.aggroTargetId === pet.id && !m.dead && m.aiState !== 'dead') this.retargetMob(m);
    }
    this.dropEntity(pet.id);
  }

  abandonPet(pid?: number): void {
    const r = this.resolve(pid);
    if (!r) return;
    if (r.meta.cls !== 'hunter') { this.error(r.e.id, 'Only hunters can abandon pets.'); return; }
    const pet = this.petOf(r.e.id, true);
    if (!pet) { this.error(r.e.id, 'You have no pet.'); return; }
    this.emit({ type: 'log', text: `You abandon ${pet.name}.`, color: '#f66', pid: r.e.id });
    this.despawnPersistentPet(pet);
  }

  renamePet(name: string, pid?: number): void {
    const r = this.resolve(pid);
    if (!r) return;
    if (!isPetClass(r.meta.cls)) { this.error(r.e.id, 'Only pet classes can rename pets.'); return; }
    const pet = this.petOf(r.e.id, true);
    if (!pet) { this.error(r.e.id, 'You have no pet.'); return; }
    const clean = this.cleanPetName(name);
    if (!clean) { this.error(r.e.id, 'Pet name must be 2-16 letters/spaces/hyphen/apostrophe and start with a letter.'); return; }
    pet.name = clean;
    this.emit({ type: 'log', text: `Your pet is now named ${clean}.`, color: '#8f8', pid: r.e.id });
  }

  revivePet(pid?: number): void {
    const r = this.resolve(pid);
    if (!r) return;
    if (!isPetClass(r.meta.cls)) { this.error(r.e.id, 'Only pet classes can revive pets.'); return; }
    const pet = this.petOf(r.e.id, true);
    if (!pet) { this.error(r.e.id, 'You have no pet.'); return; }
    if (!pet.dead) { this.error(r.e.id, 'Your pet is already alive.'); return; }
    pet.dead = false;
    pet.hostile = false;
    pet.ownerId = r.e.id;
    pet.aiState = 'idle';
    pet.aggroTargetId = null;
    pet.inCombat = false;
    pet.corpseTimer = 0;
    pet.respawnTimer = 0;
    pet.loot = null;
    pet.lootable = false;
    pet.tappedById = null;
    clearThreat(pet);
    pet.pos = this.groundPos(r.e.pos.x + 2, r.e.pos.z + 1);
    pet.prevPos = { ...pet.pos };
    this.rebucket(pet);
    pet.hp = Math.max(1, Math.round(pet.maxHp * 0.35));
    this.emit({ type: 'log', text: `${pet.name} returns to your side.`, color: '#8f8', pid: r.e.id });
  }

  petAttack(pid?: number): void {
    const r = this.resolve(pid);
    if (!r) return;
    if (!isPetClass(r.meta.cls)) { this.error(r.e.id, 'Only pet classes can command pets.'); return; }
    const pet = this.petOf(r.e.id);
    if (!pet) { this.error(r.e.id, 'You have no living pet.'); return; }
    const target = r.e.targetId !== null ? this.entities.get(r.e.targetId) : null;
    if (!target || target.dead || !this.isHostileTo(pet, target)) {
      this.error(r.e.id, 'Your pet needs a hostile target.');
      return;
    }
    pet.aggroTargetId = target.id;
    pet.inCombat = true;
    if (target.kind === 'mob' && target.hostile) addThreat(target, pet.id, 1);
  }

  petTaunt(pid?: number): void {
    const r = this.resolve(pid);
    if (!r) return;
    if (!isPetClass(r.meta.cls)) { this.error(r.e.id, 'Only pet classes can command pets.'); return; }
    const pet = this.petOf(r.e.id);
    if (!pet) { this.error(r.e.id, 'You have no living pet.'); return; }
    if (pet.petTauntTimer > 0) { this.error(r.e.id, 'Pet taunt is not ready.'); return; }
    const target = pet.aggroTargetId !== null
      ? this.entities.get(pet.aggroTargetId) ?? null
      : r.e.targetId !== null ? this.entities.get(r.e.targetId) ?? null : null;
    if (!target || target.kind !== 'mob' || target.dead || !target.hostile || target.ownerId !== null) {
      this.error(r.e.id, 'Your pet needs a hostile target.');
      return;
    }
    pet.aggroTargetId = target.id;
    pet.inCombat = true;
    addThreat(target, pet.id, 1);
    if (dist2d(pet.pos, target.pos) > PET_TAUNT_RANGE) return;
    this.applyTaunt(pet, target);
    pet.petTauntTimer = PET_GROWL_INTERVAL;
  }

  feedPet(itemId: string, pid?: number): void {
    const r = this.resolve(pid);
    if (!r) return;
    if (r.meta.cls !== 'hunter') { this.error(r.e.id, 'Only hunters can feed pets.'); return; }
    const pet = this.petOf(r.e.id);
    if (!pet) { this.error(r.e.id, 'You have no living pet.'); return; }
    const item = ITEMS[itemId];
    if (!item || item.kind !== 'food' || !item.foodHp) { this.error(r.e.id, 'Your pet can only eat food.'); return; }
    if (this.countItem(itemId, r.e.id) <= 0) { this.error(r.e.id, "You don't have that item."); return; }
    if (pet.hp >= pet.maxHp) { this.error(r.e.id, 'Your pet is already at full health.'); return; }
    this.removeItem(itemId, 1, r.e.id);
    pet.auras = pet.auras.filter((a) => a.id !== 'feed_pet');
    this.applyAura(pet, {
      id: 'feed_pet',
      name: 'Fed',
      kind: 'hot',
      value: Math.max(1, Math.ceil(item.foodHp / PET_FEED_DURATION)),
      duration: PET_FEED_DURATION,
      remaining: PET_FEED_DURATION,
      sourceId: r.e.id,
      school: 'nature',
      tickInterval: PET_FEED_TICK,
      tickTimer: PET_FEED_TICK,
    });
    this.emit({ type: 'log', text: `You feed ${pet.name}.`, color: '#8f8', pid: r.e.id });
  }

  healPet(pid?: number): void {
    const r = this.resolve(pid);
    if (!r) return;
    if (r.meta.cls !== 'warlock') { this.error(r.e.id, 'Only warlocks can channel demon healing.'); return; }
    if (r.e.dead) { this.error(r.e.id, 'You are dead.'); return; }
    if (this.isStunned(r.e)) { this.error(r.e.id, 'You are stunned.'); return; }
    if (r.e.castingAbility) { this.error(r.e.id, 'You are busy.'); return; }
    const pet = this.petOf(r.e.id);
    if (!pet) { this.error(r.e.id, 'You have no living demon.'); return; }
    if (pet.hp >= pet.maxHp) { this.error(r.e.id, 'Your demon is already at full health.'); return; }
    if (r.e.resource < DEMON_HEAL_MANA_COST) { this.error(r.e.id, 'Not enough mana!'); return; }
    this.spendResource(r.e, DEMON_HEAL_MANA_COST);
    r.e.castingAbility = DEMON_HEAL_CAST_ID;
    r.e.castTotal = DEMON_HEAL_DURATION;
    r.e.castRemaining = DEMON_HEAL_DURATION;
    r.e.channeling = true;
    r.e.channelTickEvery = DEMON_HEAL_TICK;
    r.e.channelTickTimer = DEMON_HEAL_TICK;
    r.e.gcdRemaining = Math.max(r.e.gcdRemaining, this.playerGcdFor(r.meta.cls));
    this.emit({ type: 'log', text: `You channel healing into ${pet.name}.`, color: '#b894ff', pid: r.e.id });
    this.emit({ type: 'castStart', entityId: r.e.id, ability: DEMON_HEAL_CAST_ID, time: DEMON_HEAL_DURATION });
  }

  private applyDemonHealTick(owner: Entity): void {
    const pet = this.petOf(owner.id);
    if (!pet) {
      this.cancelCast(owner);
      return;
    }
    const amount = Math.max(1, Math.ceil(pet.maxHp * 0.08));
    const healed = Math.min(amount, pet.maxHp - pet.hp);
    if (healed <= 0) return;
    pet.hp += healed;
    this.emit({ type: 'heal2', sourceId: owner.id, targetId: pet.id, amount: healed, crit: false, ability: 'Demon Heal' });
    this.healingThreat(owner, pet, healed);
  }

  setPetMode(mode: PetMode, pid?: number): void {
    const r = this.resolve(pid);
    if (!r) return;
    if (!isPetClass(r.meta.cls)) { this.error(r.e.id, 'Only pet classes can command pets.'); return; }
    const pet = this.petOf(r.e.id, true);
    if (!pet) { this.error(r.e.id, 'You have no pet.'); return; }
    pet.petMode = mode;
    if (mode === 'passive') {
      pet.aggroTargetId = null;
      pet.inCombat = false;
      pet.autoAttack = false;
    }
    this.emit({ type: 'log', text: `${pet.name} is now ${mode}.`, color: '#ffd100', pid: r.e.id });
  }

  /** Release a tamed beast back to the wild: it drops its owner, sheds pet
   *  auras, turns hostile/neutral again and evades home (or stays dead). */
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
  // Warlock demon pets — summoned (never tamed) demons that fight like hunter
  // pets but unravel (despawn) on dismiss/death/logout instead of going feral.
  // -------------------------------------------------------------------------

  /** Summon a demon pet (imp/voidwalker) just behind the warlock, replacing any
   *  existing pet. Created fresh at the owner's level — never a world mob. */
  private summonDemon(owner: Entity, mobId: string): void {
    const template = MOBS[mobId];
    if (!template) return;
    const existing = this.petOf(owner.id);
    if (existing) this.removePet(existing);
    // appear just behind the caster so the demon doesn't spawn inside the target
    const ang = owner.facing + Math.PI;
    const pos = this.groundPos(owner.pos.x + Math.sin(ang) * 2, owner.pos.z + Math.cos(ang) * 2);
    const pet = createMob(this.nextId++, template, owner.level, pos);
    pet.spawnPos = { ...pos };
    pet.ownerId = owner.id;
    pet.petTauntTimer = 0;
    pet.hostile = false;
    pet.aiState = 'idle';
    pet.aggroTargetId = null;
    pet.inCombat = false;
    pet.tappedById = null;
    pet.loot = null;
    pet.lootable = false;
    this.addEntity(pet);
    this.emit({ type: 'log', text: `You summon ${template.name}.`, color: '#a78bfa', pid: owner.id });
  }

  /** Tear-down for any pet: summoned demons vanish from the world; tamed beasts
   *  return to the wild and walk home. */
  private removePet(pet: Entity): void {
    if (MOBS[pet.templateId]?.family === 'demon') this.despawnPet(pet);
    else this.releasePetToWild(pet);
  }

  /** Remove a summoned demon from the world entirely, scrubbing any references
   *  (player targets/combo, other mobs' hate) the way boss adds are despawned. */
  private despawnPet(pet: Entity): void {
    for (const meta of this.players.values()) {
      const e = this.entities.get(meta.entityId);
      if (!e) continue;
      if (e.targetId === pet.id) e.targetId = null;
      if (e.comboTargetId === pet.id) { e.comboTargetId = null; e.comboPoints = 0; }
    }
    for (const m of this.entities.values()) {
      if (m.kind !== 'mob' || m.id === pet.id) continue;
      m.threat.delete(pet.id);
      if (m.aggroTargetId === pet.id && !m.dead && m.aiState !== 'dead') this.retargetMob(m);
    }
    this.dropEntity(pet.id);
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
      if (!this.hasLineOfSight(p, t)) return;
      this.breakGhostWolf(p);
      this.rangedSwing(p, t, ranged);
      p.swingTimer = ranged.speed * this.swingIntervalMult(p);
      return;
    }
    if (d > MELEE_RANGE) return;
    this.breakGhostWolf(p);

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
    // ranged white hits suffer the same higher-level crit suppression as melee
    const critChance = Math.max(0.005, attacker.critChance - Math.max(0, target.level - attacker.level) * 0.002);
    const crit = this.rng.chance(critChance);
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
      // innate "spiked hide" mobs (e.g. bristleback boars) reflect on every hit
      const spikes = MOBS[target.templateId]?.thorns;
      if (spikes && !attacker.dead) {
        this.dealDamage(target, attacker, spikes.value, false, spikes.school ?? 'physical', spikes.name ?? 'Spiked Hide', 'hit', true);
      }
    }
    return true;
  }

  // -------------------------------------------------------------------------
  // Damage / death
  // -------------------------------------------------------------------------

  private dealDamage(
    source: Entity | null,
    target: Entity,
    amount: number,
    crit: boolean,
    school: string,
    ability: string | null,
    kind: 'hit' | 'miss' | 'dodge',
    noRage = false,
    threatOpts?: { flat?: number; mult?: number },
  ): void {
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

    const sourcePlayer = this.pvpController(source);

    // duels end at 1 hp — nobody dies
    const duel = target.kind === 'player' ? this.duels.get(target.id) : undefined;
    if (duel && duel.state === 'active' && sourcePlayer && (sourcePlayer.id === duel.a || sourcePlayer.id === duel.b)) {
      if (target.hp - amount < 1) {
        amount = Math.max(0, target.hp - 1);
        target.hp = 1;
        this.emit({ type: 'damage', sourceId: source?.id ?? -1, targetId: target.id, amount, crit, school, ability, kind });
        this.endDuel(duel, sourcePlayer.id);
        return;
      }
    }

    // Arena eliminations use normal death state so clients and combat logic see
    // a real 0 HP defeat. The return timer revives everyone after the bout.
    const match = target.kind === 'player' ? this.arenaMatches.get(target.id) : undefined;
    if (match && match.state === 'active' && sourcePlayer && this.isArenaCrossTeam(match, sourcePlayer.id, target.id)) {
      if (match.defeated.has(target.id)) return;
      if (target.hp - amount <= 0) {
        amount = Math.max(0, target.hp);
        target.hp = 0;
        match.defeated.add(target.id);
        this.emit({ type: 'damage', sourceId: source?.id ?? -1, targetId: target.id, amount, crit, school, ability, kind });
        this.handleDeath(target, source);
        const loserTeam = this.arenaTeamOf(match, target.id);
        if (loserTeam && this.isArenaTeamWiped(match, loserTeam)) {
          this.endArenaMatch(match, loserTeam === 'A' ? 'B' : 'A', 'defeat');
        }
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
      if (source && source.id !== target.id) {
        this.breakStealth(source);
      }
    }

    if (source && source.id !== target.id) this.enterCombat(source, target);
    this.refreshMobLeashFromAction(source, target);

    // classic threat: damage (and the ability's flat bonus) lands on the mob's
    // hate table, scaled by the attacker's stance/form modifiers
    if (source && source.id !== target.id && target.kind === 'mob' && target.hostile
      && (source.kind === 'player' || source.ownerId !== null)) {
      const threat = (amount * (threatOpts?.mult ?? 1) + (threatOpts?.flat ?? 0)) * this.threatMod(source, school);
      addThreat(target, source.id, threat);
    }

    // tap rights: the first player (or their pet) to damage a mob owns it
    if (source && target.kind === 'mob' && target.hostile && target.tappedById === null && amount > 0) {
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
        target.resource = Math.min(target.maxResource, target.resource + rageFromTaking(amount, source.level));
      }
      if (isConsuming(target)) { target.eating = null; target.drinking = null; }
      if (target.sitting) target.sitting = false;
      // vanilla spell pushback: a landed hit delays the cast rather than
      // cancelling it (misses and fully absorbed hits don't push back)
      if (target.castingAbility && source && source.id !== target.id && amount > 0 && kind === 'hit') {
        if (target.castingAbility === FISHING_CAST_ID) this.cancelCast(target);
        else if (!ignoresDamagePushback(target.castingAbility)) this.pushbackCast(target);
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
      e.followTargetId = null;
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
        e.corpseTimer = Infinity;
        e.respawnTimer = Infinity;
        e.hostile = false;
        e.inCombat = false;
        this.emit({ type: 'log', text: `${e.name} dies.`, color: '#f66', pid: e.ownerId });
        // a slain summoned demon lingers only briefly, then unravels (updateMob)
        if (MOBS[e.templateId]?.family === 'demon') e.corpseTimer = 3;
        return; // owned pets drop no loot/credit; demons unravel, hunters revive or abandon
      }
      this.frenzyPackmates(e); // wild packmates fly into a frenzy when one falls
      this.armDeathThroes(e); // volatile corpses begin to destabilize, then burst

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
          // mobXpValue keeps the level-diff (anti-farm) scaling; grantXp now
          // routes the award to lifetimeXp even at the cap, so the party gate no
          // longer blocks max-level members — it just forwards every positive award.
          const xpGain = Math.round((mobXpValue(e.level, mE.level) * eliteMult * bonus) / eligible.length);
          if (xpGain > 0) this.grantXp(xpGain, member);
          this.onMobKilledForQuests(e, member);
        }
        this.rollLoot(e, meta, eligible);
      }
    }
  }

  grantXp(amount: number, meta: PlayerMeta = this.primary): void {
    const p = this.entities.get(meta.entityId);
    if (!p || amount <= 0) return;
    // Lifetime XP accrues for EVERY award, including at the cap — this is what
    // makes post-cap progression work. It feeds the virtual level, the
    // leaderboard, and cosmetic milestones. The level bar below only advances
    // while under the cap; once capped the remainder lives on in lifetimeXp
    // rather than being discarded to gold/zero (FR-1.4).
    this.accrueLifetimeXp(amount, meta, p);
    meta.counters.xpGained += amount;
    this.emit({ type: 'xp', amount, pid: p.id });

    if (p.level >= MAX_LEVEL) return; // bar frozen at cap; lifetimeXp already credited

    meta.xp += amount;
    while (p.level < MAX_LEVEL && meta.xp >= xpForLevel(p.level)) {
      meta.xp -= xpForLevel(p.level);
      p.level++;
      meta.counters.levelUps++;
      recalcPlayerStats(p, meta.cls, meta.equipment, meta.talentMods);
      p.hp = p.maxHp;
      if (p.resourceType === 'mana') p.resource = p.maxResource;
      this.emit({ type: 'levelup', level: p.level, pid: p.id });
      this.refreshKnownAbilities(meta, true);
      this.syncPetLevel(p);
    }
    // Dinged to cap mid-grant: clear the leftover from the BAR. It is not lost —
    // the full award was already added to lifetimeXp above (FR-1.4).
    if (p.level >= MAX_LEVEL) meta.xp = 0;
  }

  // Add to the monotonic lifetime counter, emitting cosmetic virtual-level-up
  // events past the cap and unlocking any newly crossed milestones. Cheap: one
  // add plus an O(log n) table lookup, never touched on the per-tick hot path.
  private accrueLifetimeXp(amount: number, meta: PlayerMeta, p: Entity): void {
    const atCap = p.level >= MAX_LEVEL;
    const beforeVL = atCap ? virtualLevel(meta.lifetimeXp) : 0;
    meta.lifetimeXp += amount;
    // 64-bit-safe invariant: JS numbers are exact to 2^53. A single character
    // reaching this is effectively impossible, but clamp + log if it ever does.
    if (meta.lifetimeXp >= Number.MAX_SAFE_INTEGER) {
      meta.lifetimeXp = Number.MAX_SAFE_INTEGER;
      console.warn(`lifetimeXp for ${meta.name} hit the 2^53 ceiling and was clamped`);
    }
    if (atCap) {
      const afterVL = virtualLevel(meta.lifetimeXp);
      for (let v = beforeVL + 1; v <= afterVL; v++) {
        this.emit({ type: 'virtualLevelUp', level: v, pid: p.id });
      }
    }
    this.checkMilestones(meta, p);
  }

  // Unlock any cosmetic milestone whose lifetime-XP threshold was just crossed.
  private checkMilestones(meta: PlayerMeta, p: Entity): void {
    for (const m of MILESTONES) {
      if (meta.lifetimeXp >= m.lifetimeXp && !meta.unlockedMilestones.has(m.id)) {
        meta.unlockedMilestones.add(m.id);
        this.emit({ type: 'milestoneUnlocked', milestoneId: m.id, pid: p.id });
      }
    }
  }

  // Opt-in cosmetic prestige (Phase 4): only at the cap. Resets the level XP
  // bar, bumps the prestige rank for a badge by the name + on the leaderboard,
  // and deliberately leaves lifetimeXp, level, gear, talents, and learned
  // abilities untouched — strictly cosmetic, zero power change (FR-6.1/6.3).
  prestige(pid?: number): boolean {
    const r = this.resolve(pid);
    if (!r) return false;
    // Authoritative anti-abuse gate: must be at the cap AND have earned a full
    // prestige bar of post-cap XP since the last rank. This caps prestigeRank at
    // what lifetimeXp supports, so spamming the `prestige` command (e.g. from a
    // hacked client) can never inflate the rank beyond XP actually earned.
    if (!canPrestige(r.e.level, r.meta.lifetimeXp, r.meta.prestigeRank)) return false;
    r.meta.xp = 0;
    r.meta.prestigeRank += 1;
    this.emit({ type: 'log', pid: r.e.id, text: `You have prestiged! Prestige Rank ${r.meta.prestigeRank}.`, color: '#ffd100' });
    return true;
  }

  private needsQuestDrop(entry: LootEntry, meta: PlayerMeta): boolean {
    if (!entry.questId || !entry.itemId) return false;
    const qp = meta.questLog.get(entry.questId);
    if (!qp || qp.state !== 'active') return false;
    const quest = QUESTS[entry.questId];
    const objIdx = quest.objectives.findIndex((o) => o.type === 'collect' && o.itemId === entry.itemId);
    // A quest-gated drop is only "needed" while the player has an actual collect
    // objective for this item that is still short of its required count. If the
    // quest has no matching collect objective, the player never needs the item,
    // so it must not drop (fail closed rather than dropping unconditionally).
    return objIdx >= 0 && this.countItem(entry.itemId, meta.entityId) < quest.objectives[objIdx].count;
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
    if (mob.dead || mob.aiState === 'evade' || mob.aiState === 'chase' || mob.aiState === 'attack' || mob.aiState === 'flee') return;
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

  // Classic "trivial con": a wild mob far below the player's level stops
  // auto-aggroing from proximity. Elites, rares, and bosses are never trivial.
  private isTrivialTo(mob: Entity, player: Entity): boolean {
    const template = MOBS[mob.templateId];
    if (template.elite || template.rare || template.boss) return false;
    return player.level - mob.level >= TRIVIAL_LEVEL_GAP;
  }

  private updateMob(mob: Entity): void {
    if (mob.dead) {
      if (mob.ownerId !== null && MOBS[mob.templateId]?.family !== 'demon') return;
      mob.corpseTimer -= DT;
      mob.respawnTimer -= DT;
      // Death Throes: a volatile corpse counts down its fuse, then detonates once.
      if (mob.detonateTimer !== Infinity) {
        mob.detonateTimer -= DT;
        if (mob.detonateTimer <= 0) {
          mob.detonateTimer = Infinity;
          this.detonateCorpse(mob);
        }
      }
      // a slain summoned demon unravels rather than respawning into the wild
      if (mob.ownerId !== null && MOBS[mob.templateId]?.family === 'demon') {
        if (mob.corpseTimer <= 0) this.despawnPet(mob);
        return;
      }
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
      if (this.updateFearMovement(mob)) return;
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
        let detected: Entity | null = null;
        let detectedD = Infinity;
        this.playerGrid.forEachInRadius(mob.pos.x, mob.pos.z, 25, (e, d2) => {
          if (e.dead) return;
          if (this.isTrivialTo(mob, e)) return;
          let radius = Math.max(4, Math.min(20, template.aggroRadius + (mob.level - e.level) * 1.5));
          // stealthed rogues are harder to detect, relative to observer level
          if (e.auras.some((a) => a.kind === 'stealth')) radius = stealthDetectionRadius(mob, e, radius);
          const d = Math.sqrt(d2);
          if (d < radius && d < detectedD) { detected = e; detectedD = d; }
        });
        if (detected) {
          this.aggroMob(mob, detected, true);
          break;
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
        if (this.maybeFlee(mob, target)) break;
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
        if (this.maybeFlee(mob, target)) break;
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
        // Boss/miniboss War Stomp: a periodic ground slam that stuns (and
        // optionally damages) nearby players. Telegraphed via createMob, which
        // seeds stompTimer to one full interval so the first slam never lands
        // the instant combat opens.
        const stomp = MOBS[mob.templateId]?.stomp;
        if (stomp) {
          mob.stompTimer -= DT;
          if (mob.stompTimer <= 0) {
            mob.stompTimer = stomp.every;
            const school = stomp.school ?? 'physical';
            this.emit({ type: 'spellfx', sourceId: mob.id, targetId: mob.id, school, fx: 'nova' });
            this.emit({ type: 'log', text: `${mob.name} unleashes ${stomp.name}!`, color: '#ff9933', entityId: mob.id });
            for (const meta of this.players.values()) {
              const pe = this.entities.get(meta.entityId);
              if (!pe || pe.dead || dist2d(pe.pos, mob.pos) > stomp.radius) continue;
              if (stomp.min !== undefined && stomp.max !== undefined) {
                const dmg = Math.round(this.rng.range(stomp.min, stomp.max));
                this.dealDamage(mob, pe, dmg, false, school, stomp.name, 'hit', true);
              }
              if (pe.dead) continue; // a fatal slam shouldn't also stun the corpse
              this.applyAura(pe, {
                id: 'stomp_stun', name: stomp.name, kind: 'stun',
                remaining: stomp.duration, duration: stomp.duration, value: 0,
                sourceId: mob.id, school: school as Aura['school'],
              });
            }
          }
        }
        break;
      }
      case 'flee': {
        const target = mob.aggroTargetId !== null ? this.entities.get(mob.aggroTargetId) : null;
        if (!target || target.dead) { this.retargetMob(mob); break; }
        // Outran the leash while panicking: drop the pull and reset home.
        const leash = mob.spawnPos.x > DUNGEON_X_THRESHOLD ? DUNGEON_LEASH_DISTANCE : LEASH_DISTANCE;
        const leashAnchor = mob.leashAnchor ?? mob.spawnPos;
        if (dist2d(mob.pos, leashAnchor) > leash) {
          mob.aiState = 'evade';
          mob.aggroTargetId = null;
          clearThreat(mob);
          mob.leashAnchor = null;
          break;
        }
        mob.fleeTimer -= DT;
        if (mob.fleeTimer <= 0) {
          // Recover nerve and turn to fight again; hasFled keeps it from re-fleeing.
          mob.aiState = 'attack';
          mob.swingTimer = Math.min(mob.swingTimer, 0.4);
          break;
        }
        // Run directly away from the attacker. A root pins it in place (it just
        // cowers facing away); a stun is already handled by the early return above.
        const away = angleTo(target.pos, mob.pos);
        mob.facing = away;
        if (!this.isRooted(mob)) {
          const fleePos = this.groundPos(mob.pos.x + Math.sin(away) * 10, mob.pos.z + Math.cos(away) * 10);
          this.moveToward(mob, fleePos, mob.moveSpeed * FLEE_SPEED_MULT * this.moveSpeedMult(mob));
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
    mob.fleeTimer = 0;
    mob.hasFled = false;
    clearThreat(mob);
    this.despawnSummonedAdds(mob);
    mob.firedSummons = 0;
    mob.enraged = false;
    mob.healedThisPull = false;
    mob.stompTimer = MOBS[mob.templateId]?.stomp?.every ?? 0;
    mob.mendTimer = MOBS[mob.templateId]?.mendAlly?.every ?? 0;
    mob.wanderTimer = this.rng.range(2, 8);
  }

  // Cowardly mobs panic once per pull at low HP: turn and run from the attacker
  // for a few seconds, rallying nearby same-family allies. Returns true if the mob
  // entered (or is already in) the flee state so the caller can stop its turn.
  private canFlee(mob: Entity): boolean {
    if (mob.hasFled || mob.enraged) return false;
    const tmpl = MOBS[mob.templateId];
    if (!tmpl || tmpl.boss || tmpl.elite || tmpl.rare) return false;
    return FLEEING_FAMILIES.has(tmpl.family);
  }

  private maybeFlee(mob: Entity, target: Entity): boolean {
    if (mob.maxHp <= 0 || mob.hp / mob.maxHp > FLEE_HP_THRESHOLD) return false;
    if (!this.canFlee(mob)) return false;
    mob.aiState = 'flee';
    mob.hasFled = true;
    mob.fleeTimer = FLEE_DURATION;
    this.emit({ type: 'log', text: `${mob.name} attempts to flee!`, color: '#ffd966', entityId: mob.id });
    this.callForHelp(mob, target);
    return true;
  }

  // A fleeing mob shouts for aid: nearby idle same-family mobs join the fight,
  // mirroring the social-pull seeding in aggroMob.
  private callForHelp(mob: Entity, target: Entity): void {
    const family = MOBS[mob.templateId]?.family;
    if (!family) return;
    this.grid.forEachInRadius(mob.pos.x, mob.pos.z, FLEE_HELP_RADIUS, (m, d2) => {
      if (m.kind === 'mob' && m.id !== mob.id && !m.dead && m.hostile && m.aiState === 'idle' && m.ownerId === null
        && MOBS[m.templateId]?.family === family && d2 < FLEE_HELP_RADIUS * FLEE_HELP_RADIUS) {
        m.aiState = 'chase';
        m.aggroTargetId = target.id;
        m.inCombat = true;
        m.leashAnchor = { ...m.pos };
        addThreat(m, target.id, 1);
      }
    });
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
    const rawDmg = dmg; // pre-armor, post-crit/enrage — basis for cleave splash
    dmg *= 1 - armorReduction(this.effectiveArmor(target), mob.level);
    const dealt = Math.max(1, Math.round(dmg));
    this.dealDamage(mob, target, dealt, crit, 'physical', null, 'hit');
    // Lifesteal: a landed swing heals the mob for a fraction of the damage it
    // just dealt. Hostile mobs only, so a friendly pet (mobSwing's other caller)
    // never drains for its owner; skip if the mob is already topped off or died
    // to the defender's thorns/reflect earlier this swing.
    const leech = MOBS[mob.templateId]?.lifeleech;
    if (leech && mob.hostile && !mob.dead && mob.hp < mob.maxHp && this.rng.chance(leech.chance ?? 1)) {
      const heal = Math.min(mob.maxHp - mob.hp, Math.max(1, Math.round(dealt * leech.healFrac)));
      if (heal > 0) {
        mob.hp += heal;
        this.emit({ type: 'heal', targetId: mob.id, amount: heal });
      }
    }
    // Cleave: the swing splashes onto other players standing near the primary
    // target, each taking the hit reduced by their own armor. Hostile mobs only,
    // so a friendly pet swinging through mobSwing never cleaves its owner's party.
    const cleave = MOBS[mob.templateId]?.cleave;
    if (cleave && mob.hostile && !mob.dead) {
      for (const meta of this.players.values()) {
        const pe = this.entities.get(meta.entityId);
        if (!pe || pe.dead || pe.id === target.id) continue;
        if (dist2d(pe.pos, target.pos) > cleave.radius) continue;
        let sd = rawDmg * cleave.mult;
        sd *= 1 - armorReduction(this.effectiveArmor(pe), mob.level);
        this.dealDamage(mob, pe, Math.max(1, Math.round(sd)), crit, 'physical', cleave.name ?? 'Cleave', 'hit', true);
      }
    }
    // venom: a landed swing may inflict a refreshing poison DoT (hostile mobs only,
    // never a friendly pet — mobSwing is also the pet attack path).
    const venom = MOBS[mob.templateId]?.venom;
    if (venom && mob.hostile && !target.dead && this.rng.chance(venom.chance)) {
      this.applyAura(target, {
        id: 'venom_' + mob.templateId, name: venom.name, kind: 'dot',
        remaining: venom.duration, duration: venom.duration,
        value: Math.max(1, Math.round(venom.perTick)),
        tickInterval: venom.interval, tickTimer: venom.interval,
        sourceId: mob.id, school: (venom.school as Aura['school']) ?? 'nature',
      });
    }
    // corrosive bite: a landed hit may shred the victim's armor (stacking sunder).
    // Guarded on hostile so a friendly pet (the other mobSwing caller) never debuffs an ally.
    const corrode = MOBS[mob.templateId]?.corrode;
    if (corrode && mob.hostile && !target.dead && this.rng.chance(corrode.chance)) {
      this.applyCorrosion(mob, target, corrode);
    }
    // silencing shriek: anti-caster mobs can lock the victim's spells on a hit.
    // Guard on hostile + alive so a friendly pet (the other mobSwing caller)
    // never silences the party. updateCasting interrupts any live spell next tick.
    const silence = MOBS[mob.templateId]?.silence;
    if (silence && mob.hostile && !target.dead && this.rng.chance(silence.chance)) {
      this.applyAura(target, {
        id: `silence_${mob.templateId}`, name: silence.name, kind: 'silence',
        remaining: silence.duration, duration: silence.duration, value: 0,
        sourceId: mob.id, school: (silence.school ?? 'shadow') as Aura['school'],
      });
    }
    // thorns / lightning shield on the defender
    if (!mob.dead) {
      for (const a of target.auras) {
        if (a.kind === 'thorns') {
          this.dealDamage(target, mob, a.value, false, a.school, a.name, 'hit', true);
        }
      }
    }
    // Mortal Strike: a landed hit can leave a healing-reduction debuff. Guarded on
    // `hostile` so a friendly pet (mobSwing's other caller) never debuffs the party.
    const ms = MOBS[mob.templateId]?.mortalStrike;
    if (ms && mob.hostile && !target.dead && this.rng.chance(ms.chance)) {
      this.applyAura(target, {
        id: `mortal_wound_${mob.templateId}`,
        name: ms.name,
        kind: 'mortal_wound',
        remaining: ms.duration,
        duration: ms.duration,
        value: ms.healReduction,
        sourceId: mob.id,
        school: (ms.school as Aura['school']) ?? 'physical',
      });
    }
    // Ensnare: a landed hit may web the victim in place (root). Hostile mobs only
    // (a friendly pet shares this swing path) and only roots players — `applyRootAura`
    // applies crowd-control DR so repeated webs from the same mob shrink and break.
    const ensnare = MOBS[mob.templateId]?.ensnare;
    if (ensnare && mob.hostile && target.kind === 'player' && !target.dead && this.rng.chance(ensnare.chance)) {
      this.applyRootAura(mob, target, ensnare.name, `ensnare_${mob.templateId}`, ensnare.duration, ensnare.school ?? 'nature');
    }
    // slowStrike: a landed hit may mire the victim, slowing their attack speed.
    // Rides the existing `attackspeed` aura (swingIntervalMult: value > 1 = slower);
    // refreshes by id and never stacks. Guarded on `hostile` so a friendly pet
    // (mobSwing's other caller) never debuffs the party.
    const slowStrike = MOBS[mob.templateId]?.slowStrike;
    if (slowStrike && mob.hostile && !target.dead && this.rng.chance(slowStrike.chance)) {
      this.applyAura(target, {
        id: `slowstrike_${mob.templateId}`,
        name: slowStrike.name,
        kind: 'attackspeed',
        remaining: slowStrike.duration,
        duration: slowStrike.duration,
        value: slowStrike.mult,
        sourceId: mob.id,
        school: (slowStrike.school as Aura['school']) ?? 'physical',
      });
    }
    // Mana Burn: a landed hit may sap a flat amount of mana from a mana-using
    // victim (casters). No effect on rage/energy users. Guarded on `hostile` so
    // a friendly pet (mobSwing's other caller) never drains an ally's mana. The
    // mana bar visibly drops and the affix is surfaced via an `aura` log line.
    const burn = MOBS[mob.templateId]?.manaBurn;
    if (burn && mob.hostile && !target.dead && target.resourceType === 'mana' && target.resource > 0 && this.rng.chance(burn.chance)) {
      target.resource = Math.max(0, target.resource - burn.amount);
      this.emit({ type: 'aura', targetId: target.id, name: burn.name, gained: true });
    }
    // Maddening curse: a landed hit can fog a caster's mind, draining Intellect
    // and thus shrinking their mana pool. Mana users only (it does nothing to
    // rage/energy users); hostile mobs only, so a friendly pet (mobSwing's other
    // caller) never debuffs the party. Rides buff_int with a negative value, so
    // recalcPlayerStats folds it through to maxResource with no new math.
    const enfeeble = MOBS[mob.templateId]?.enfeeble;
    if (enfeeble && mob.hostile && !target.dead && target.resourceType === 'mana' && this.rng.chance(enfeeble.chance)) {
      this.applyAura(target, {
        id: `enfeeble_${mob.templateId}`,
        name: enfeeble.name,
        kind: 'buff_int',
        remaining: enfeeble.duration,
        duration: enfeeble.duration,
        value: -Math.abs(enfeeble.int),
        sourceId: mob.id,
        school: enfeeble.school ?? 'shadow',
      });
    }
    // On-hit chill: frost-touched mobs numb the victim, slowing their movement.
    const chill = MOBS[mob.templateId]?.chillOnHit;
    if (chill && !mob.dead && !target.dead && this.rng.chance(chill.chance)) {
      this.applyAura(target, {
        id: mob.templateId + '_chill', name: chill.name, kind: 'slow',
        remaining: chill.duration, duration: chill.duration, value: chill.mult,
        sourceId: mob.id, school: 'frost',
      });
    }
    // Demoralizing affix: a successful hit saps the player victim's attack
    // power for a few seconds, weakening the damage they deal back.
    const demo = MOBS[mob.templateId]?.demoralize;
    if (demo && !mob.dead && target.kind === 'player' && this.rng.chance(demo.chance ?? 1)) {
      this.applyAura(target, {
        id: 'mob_demoralize',
        name: demo.name ?? 'Demoralized',
        kind: 'buff_ap',
        remaining: demo.duration,
        duration: demo.duration,
        value: -Math.abs(demo.ap),
        sourceId: mob.id,
        school: 'physical',
      });
    }
    // Dread: a landed hit can terrify the victim into fleeing. Reuses the exact
    // `fear_incap` incapacitate aura the player-cast Fear applies, so
    // `updateFearMovement` drives the panicked run — no new aura kind or hook.
    // Guarded on `hostile` (a friendly pet never fears the party) and on a player
    // target (mobs can't flee via this path). `diminishedCrowdControlDuration`
    // returns the full duration for a mob source (DR is PvP-only), so the victim
    // gets the authored fear length.
    const dread = MOBS[mob.templateId]?.dread;
    if (dread && mob.hostile && target.kind === 'player' && !target.dead && this.rng.chance(dread.chance)) {
      const remaining = this.diminishedCrowdControlDuration(mob, target, 'fear', dread.duration);
      if (remaining !== null) {
        this.applyAura(target, {
          id: 'fear_incap', name: dread.name, kind: 'incapacitate',
          remaining, duration: remaining,
          value: this.rng.range(-Math.PI, Math.PI),
          sourceId: mob.id, school: dread.school ?? 'shadow', breaksOnDamage: true,
        });
      }
    }
  }

  // Apply (or refresh + stack) a corrosive armor-shred debuff on the victim.
  // Mirrors the warrior Sunder Armor stacking: one shared `sunder` slot found by
  // kind, bumped up to `maxStacks`, with its timer fully refreshed each application.
  // effectiveArmor() already subtracts value*stacks, so the victim takes more
  // physical damage from every attacker until it expires.
  private applyCorrosion(mob: Entity, target: Entity, corrode: NonNullable<MobTemplate['corrode']>): void {
    const existing = target.auras.find((a) => a.kind === 'sunder');
    if (existing) {
      existing.stacks = Math.min(corrode.maxStacks, (existing.stacks ?? 1) + 1);
      existing.value = corrode.armor;
      existing.remaining = existing.duration;
      this.emit({ type: 'aura', targetId: target.id, name: corrode.name, gained: true });
    } else {
      this.applyAura(target, {
        id: `corrode_${mob.templateId}`, name: corrode.name, kind: 'sunder',
        remaining: corrode.duration, duration: corrode.duration,
        value: corrode.armor, stacks: 1,
        sourceId: mob.id, school: corrode.school ?? 'nature',
      });
    }
  }

  // Pet brain: assist the owner (attack whatever they fight or whatever
  // attacks either of you), otherwise heel. Pets swing like mobs and build
  // their own entries on enemy hate tables.
  private updatePet(pet: Entity): void {
    const owner = pet.ownerId !== null ? this.entities.get(pet.ownerId) : null;
    if (!owner || owner.kind !== 'player' || !this.players.has(owner.id)) {
      this.despawnPersistentPet(pet);
      return;
    }
    if (this.isStunned(pet)) return;
    this.syncPetAspect(pet, owner);
    pet.petTauntTimer = Math.max(0, pet.petTauntTimer - DT);
    if (!pet.inCombat && this.tickCount % 40 === 0 && pet.hp < pet.maxHp) {
      pet.hp = Math.min(pet.maxHp, pet.hp + Math.max(1, Math.round(pet.maxHp * 0.02)));
    }

    let target = pet.aggroTargetId !== null ? this.entities.get(pet.aggroTargetId) ?? null : null;
    if (target && (target.dead || !this.isHostileTo(pet, target))) target = null;
    if (target && dist2d(owner.pos, pet.pos) > PET_LEASH) target = null;
    if (!target && !owner.dead) target = this.petPickTarget(pet, owner);
    pet.aggroTargetId = target?.id ?? null;
    pet.inCombat = target !== null;

    if (target) {
      // ranged demon (imp) holds its distance and hurls bolts; melee pets close
      // in, taunt to hold threat (voidwalker tank), and swing
      const ranged = MOBS[pet.templateId]?.petRanged;
      const template = MOBS[pet.templateId];
      if (!ranged && template?.petRole === 'ranged_dps' && template.petSpell) {
        this.updateRangedPetAttack(pet, target, template.petSpell);
        return;
      }
      const reach = ranged ? ranged.range : MELEE_RANGE * 0.8;
      const d = dist2d(pet.pos, target.pos);
      if (d > reach) {
        if (!this.isRooted(pet)) this.moveToward(pet, target.pos, pet.moveSpeed * this.moveSpeedMult(pet));
        pet.swingTimer = Math.max(0, pet.swingTimer - DT);
      } else {
        pet.facing = angleTo(pet.pos, target.pos);
        if (target.kind === 'mob' && !ranged && pet.petTauntTimer <= 0) {
          this.applyTaunt(pet, target);
          pet.petTauntTimer = PET_GROWL_INTERVAL;
        }
        pet.swingTimer -= DT;
        if (pet.swingTimer <= 0) {
          if (ranged) this.petRangedAttack(pet, target, ranged);
          else this.mobSwing(pet, target);
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

  /** A ranged demon pet (imp) hurls a spell-school bolt: a telegraphed
   *  projectile that bypasses armor, mirroring the player caster path. Damage
   *  comes from the mob's weapon range + AP, exactly like its melee siblings. */
  private petRangedAttack(pet: Entity, target: Entity, ranged: { range: number; school: Aura['school'] }): void {
    this.emit({ type: 'spellfx', sourceId: pet.id, targetId: target.id, school: ranged.school, fx: 'projectile' });
    const crit = this.rng.chance(0.05);
    let dmg = this.rng.range(pet.weapon.min, pet.weapon.max) + (this.effectiveAttackPower(pet) / 14) * pet.weapon.speed;
    if (crit) dmg *= 2;
    this.dealDamage(pet, target, Math.max(1, Math.round(dmg)), crit, ranged.school, null, 'hit');
  }

  private updateRangedPetAttack(
    pet: Entity,
    target: Entity,
    spell: { name: string; school: 'physical' | 'fire' | 'frost' | 'arcane' | 'shadow' | 'holy' | 'nature'; min: number; max: number; range: number; every: number },
  ): void {
    const d = dist2d(pet.pos, target.pos);
    if (d > spell.range) {
      if (!this.isRooted(pet)) this.moveToward(pet, target.pos, pet.moveSpeed * this.moveSpeedMult(pet));
      pet.swingTimer = Math.max(0, pet.swingTimer - DT);
      return;
    }
    pet.facing = angleTo(pet.pos, target.pos);
    pet.swingTimer -= DT;
    if (pet.swingTimer > 0) return;
    this.emit({ type: 'spellfx', sourceId: pet.id, targetId: target.id, school: spell.school, fx: 'projectile' });
    if (!this.rng.chance(spellHitChance(pet.level, target.level))) {
      this.emit({ type: 'damage', sourceId: pet.id, targetId: target.id, amount: 0, crit: false, school: spell.school, ability: spell.name, kind: 'miss' });
      this.enterCombat(pet, target);
    } else {
      const dmg = Math.round(this.rng.range(spell.min + pet.level * 0.8, spell.max + pet.level * 1.1));
      this.dealDamage(pet, target, Math.max(1, dmg), false, spell.school, spell.name, 'hit');
    }
    pet.swingTimer = spell.every;
  }

  private petPickTarget(pet: Entity, owner: Entity): Entity | null {
    if (pet.petMode === 'passive') return null;
    let best: Entity | null = null;
    let bestD = pet.petMode === 'aggressive' ? PET_AGGRESSIVE_RANGE : PET_ASSIST_RANGE;
    for (const m of this.entities.values()) {
      if (m.id === pet.id || m.dead || !this.isHostileTo(pet, m)) continue;
      const engagingUs = m.kind === 'mob' && (m.aggroTargetId === owner.id || m.aggroTargetId === pet.id);
      const ownerOffense = owner.targetId === m.id && (owner.autoAttack || (m.kind === 'mob' && m.threat.has(owner.id)));
      const aggressive = pet.petMode === 'aggressive' && dist2d(pet.pos, m.pos) <= PET_AGGRESSIVE_RANGE;
      if (!engagingUs && !ownerOffense && !aggressive) continue;
      const d = dist2d(pet.pos, m.pos);
      if (d < bestD) { best = m; bestD = d; }
    }
    return best;
  }

  // Step `e` one tick toward `dest`. With `ignoreObstacles`, the mover phases
  // straight through props — used to free a stuck evader, never for normal
  // locomotion. Returns true on arrival.
  private moveToward(e: Entity, dest: Vec3, speed: number, ignoreObstacles = false): boolean {
    const d = dist2d(e.pos, dest);
    if (d < 0.3) return true;
    const desired = angleTo(e.pos, dest);
    e.facing = desired;
    const step = Math.min(speed * DT, d);
    const canSwim = this.mobCanSwim(MOBS[e.templateId]);

    if (ignoreObstacles) {
      const nx = e.pos.x + Math.sin(desired) * step;
      const nz = e.pos.z + Math.cos(desired) * step;
      e.pos.x = nx;
      e.pos.z = nz;
      const g = groundHeight(nx, nz, this.cfg.seed);
      e.pos.y = Math.max(g, SWIM_SURFACE_Y); // ride the surface while phasing, don't sink under terrain/water
      return d - step < 0.3;
    }
    // Mobs have no nav mesh. Try the straight path first; only if a prop or the
    // waterline eats it do we fan the heading out and take the best slide AROUND
    // the obstacle. That lets a mob round the camp props to reach its target
    // instead of pinning on them. Open-ground movers take the first branch.
    let bestX = e.pos.x, bestZ = e.pos.z, bestProgress = 1e-3;
    for (const off of MOVE_SLIDE_FAN) {
      const a = desired + off;
      const nx = e.pos.x + Math.sin(a) * step;
      const nz = e.pos.z + Math.cos(a) * step;
      // landlocked creatures stop at the waterline instead of walking under it
      if (!canSwim && groundHeight(nx, nz, this.cfg.seed) < WATER_LEVEL - SWIM_DEPTH) continue;
      const r = resolvePosition(this.cfg.seed, nx, nz, BODY_RADIUS);
      const progress = d - Math.hypot(r.x - dest.x, r.z - dest.z);
      if (progress > bestProgress) { bestProgress = progress; bestX = r.x; bestZ = r.z; }
      if (off === 0 && progress >= step - 1e-3) break; // straight path is clear
    }
    e.pos.x = bestX;
    e.pos.z = bestZ;
    const g = groundHeight(bestX, bestZ, this.cfg.seed);
    e.pos.y = canSwim && g < WATER_LEVEL - SWIM_DEPTH ? SWIM_SURFACE_Y : g;
    return dist2d(e.pos, dest) < 0.3;
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
    if (mob.ownerId !== null) {
      this.despawnPersistentPet(mob);
      return;
    }
    this.clearNonPlayerStatAuras(mob);
    mob.dead = false;
    mob.lootable = false;
    mob.loot = null;
    mob.tappedById = null;
    mob.ownerId = null;
    mob.hostile = true;
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
    mob.healedThisPull = false;
    mob.stompTimer = MOBS[mob.templateId]?.stomp?.every ?? 0;
    mob.mendTimer = MOBS[mob.templateId]?.mendAlly?.every ?? 0;
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

  // Classic beast "Frenzy": when a mob carrying the packFrenzy trait dies, the
  // surviving same-family hostile mobs nearby briefly attack faster. Modelled as
  // a refreshable buff_haste aura, so it rides the normal aura tick (expires on
  // its own) and the existing snapshot wire — no new Entity field is needed.
  private frenzyPackmates(dead: Entity): void {
    const fr = MOBS[dead.templateId]?.packFrenzy;
    if (!fr) return;
    const r2 = fr.radius * fr.radius;
    this.grid.forEachInRadius(dead.pos.x, dead.pos.z, fr.radius, (m, d2) => {
      if (m.id === dead.id || m.kind !== 'mob' || m.dead || m.aiState === 'dead') return;
      if (!m.hostile || m.ownerId !== null || d2 > r2) return;
      // packmates = same creature type (a wolf pack), matching the social-aggro convention
      if (m.templateId !== dead.templateId) return;
      const existing = m.auras.find((a) => a.id === PACK_FRENZY_AURA_ID);
      if (existing) {
        existing.remaining = fr.duration; // refresh on each further loss; don't stack
        return;
      }
      m.auras.push({
        id: PACK_FRENZY_AURA_ID,
        name: 'Pack Frenzy',
        kind: 'buff_haste',
        remaining: fr.duration,
        duration: fr.duration,
        value: fr.hasteMult,
        sourceId: m.id,
        school: 'physical',
      });
      this.emit({ type: 'aura', targetId: m.id, name: 'Pack Frenzy', gained: true });
      this.emit({ type: 'log', text: `${m.name} flies into a frenzy!`, color: '#ff8c00', entityId: m.id });
      this.emit({ type: 'spellfx', sourceId: m.id, targetId: m.id, school: 'physical', fx: 'nova' });
    });
  }

  // Death Throes (arm): a volatile creature does not explode the instant it
  // dies. Its corpse destabilizes for `delay` seconds — a telegraph players can
  // run from — by arming a fuse that the corpse tick (updateMob) counts down.
  private armDeathThroes(dead: Entity): void {
    const dt = MOBS[dead.templateId]?.deathThroes;
    if (!dt) return;
    dead.detonateTimer = dt.delay;
    const school = dt.school ?? 'nature';
    this.emit({ type: 'spellfx', sourceId: dead.id, targetId: dead.id, school, fx: 'nova' });
    this.emit({ type: 'log', text: `${dead.name} begins to swell — get clear!`, color: '#9acd32', entityId: dead.id });
  }

  // Death Throes (detonate): the corpse bursts for min..max `school` damage to
  // every living player within `radius`. Mirrors the aoePulse damage loop; the
  // dead mob is the damage source so credit/threat resolve as a normal hit.
  private detonateCorpse(dead: Entity): void {
    const dt = MOBS[dead.templateId]?.deathThroes;
    if (!dt) return;
    const school = dt.school ?? 'nature';
    this.emit({ type: 'spellfx', sourceId: dead.id, targetId: dead.id, school, fx: 'nova' });
    this.emit({ type: 'log', text: `${dead.name} bursts in a cloud of ${dt.name}!`, color: '#9acd32', entityId: dead.id });
    for (const meta of this.players.values()) {
      const pe = this.entities.get(meta.entityId);
      if (pe && !pe.dead && dist2d(pe.pos, dead.pos) <= dt.radius) {
        const dmg = Math.round(this.rng.range(dt.min, dt.max));
        this.dealDamage(dead, pe, dmg, false, school, dt.name, 'hit', true);
      }
    }
  }

  // Boss threshold mechanics: add waves (summonAdds) and enrage. Checked
  // every tick while the boss is in combat; thresholds fire once per pull
  // and reset on evade/respawn.
  private updateBossMechanics(mob: Entity): void {
    const tmpl = MOBS[mob.templateId];
    if (!tmpl || (!tmpl.summonAdds && !tmpl.enrage && !tmpl.desperateHeal && !tmpl.mendAlly)) return;
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
    if (tmpl.desperateHeal && !mob.healedThisPull && hpFrac <= tmpl.desperateHeal.belowHpPct) {
      mob.healedThisPull = true;
      const heal = Math.min(mob.maxHp - mob.hp, Math.round(mob.maxHp * tmpl.desperateHeal.healPct));
      if (heal > 0) {
        mob.hp += heal;
        this.emit({ type: 'heal', targetId: mob.id, amount: heal });
        this.emit({ type: 'log', text: `${mob.name} draws on a desperate second wind!`, color: '#66ff99', entityId: mob.id });
        this.emit({ type: 'spellfx', sourceId: mob.id, targetId: mob.id, school: 'nature', fx: 'nova' });
      }
    }
    // Support "Mend": periodically heal every wounded friendly mob in range
    // (including the caster). Telegraphed via createMob seeding mendTimer to a
    // full interval, so the first cast never lands the instant combat opens.
    if (tmpl.mendAlly) {
      mob.mendTimer -= DT;
      if (mob.mendTimer <= 0) {
        mob.mendTimer = tmpl.mendAlly.every;
        const wounded: Entity[] = [];
        for (const ally of this.entities.values()) {
          if (ally.kind !== 'mob' || ally.dead || ally.ownerId !== null) continue; // skip players, pets, corpses
          if (ally.hostile !== mob.hostile || ally.hp >= ally.maxHp) continue; // only wounded same-faction mobs
          if (dist2d(ally.pos, mob.pos) > tmpl.mendAlly.radius) continue;
          wounded.push(ally);
        }
        if (wounded.length > 0) {
          const school = tmpl.mendAlly.school ?? 'nature';
          this.emit({ type: 'spellfx', sourceId: mob.id, targetId: mob.id, school, fx: 'nova' });
          this.emit({ type: 'log', text: `${mob.name} channels ${tmpl.mendAlly.name}.`, color: '#66ff99', entityId: mob.id });
          for (const ally of wounded) {
            const amount = Math.round(this.rng.range(tmpl.mendAlly.healMin, tmpl.mendAlly.healMax));
            this.applyHeal(mob, ally, amount, tmpl.mendAlly.name);
          }
        }
      }
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
    // switching to a different target ends a follow (re-targeting is manual intent)
    if (p.followTargetId !== null && id !== p.followTargetId) this.stopFollow(p, 'You stop following.');
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
    const candidates = this.enemyCandidates(p);
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
      if (!this.isEnemyTargetCandidate(p, e)) return;
      if (d2 < bestD2) { bestD2 = d2; best = e; }
    });
    if (best) p.targetId = (best as Entity).id;
  }

  private enemyCandidates(p: Entity): { e: Entity; d: number }[] {
    const out: { e: Entity; d: number }[] = [];
    if (p.dead) return out;
    this.grid.forEachInRadius(p.pos.x, p.pos.z, 40, (e, d2) => {
      if (!this.isEnemyTargetCandidate(p, e)) return;
      out.push({ e, d: Math.sqrt(d2) });
    });
    return out;
  }

  private isEnemyTargetCandidate(attacker: Entity, target: Entity): boolean {
    if (attacker.dead) return false;
    if (target.id === attacker.id || target.dead) return false;
    if (this.isHostileTo(attacker, target)) return true;
    if (target.kind === 'mob' && target.ownerId !== null) {
      const owner = this.entities.get(target.ownerId);
      return !!owner && owner.kind === 'player' && this.isEnemyTargetCandidate(attacker, owner);
    }
    if (target.kind !== 'player') return false;
    const attackerPlayer = this.pvpController(attacker);
    if (!attackerPlayer || attackerPlayer.dead) return false;
    const match = this.arenaMatches.get(attackerPlayer.id);
    return !!match && match.state === 'countdown'
      && this.isArenaCrossTeam(match, attackerPlayer.id, target.id);
  }

  // Nearby allies a beneficial spell can land on: other players (and friendly
  // pets) within range, never yourself, never dead/hostile. Mirrors the enemy
  // targeting helpers so heals/buffs are reachable by keyboard, not just by
  // clicking party frames or world models (#133).
  private friendlyCandidates(p: Entity): { e: Entity; d: number }[] {
    const out: { e: Entity; d: number }[] = [];
    this.grid.forEachInRadius(p.pos.x, p.pos.z, 40, (e, d2) => {
      if (e.id === p.id || e.dead || !this.isFriendlyTo(p, e)) return;
      out.push({ e, d: Math.sqrt(d2) });
    });
    return out;
  }

  targetNearestFriendly(pid?: number): void {
    const r = this.resolve(pid);
    if (!r) return;
    const p = r.e;
    let best: Entity | null = null;
    let bestD = Infinity;
    for (const c of this.friendlyCandidates(p)) {
      if (c.d < bestD) { bestD = c.d; best = c.e; }
    }
    if (best) p.targetId = best.id;
  }

  friendlyTabTarget(pid?: number): void {
    const r = this.resolve(pid);
    if (!r) return;
    const p = r.e;
    const candidates = this.friendlyCandidates(p);
    if (candidates.length === 0) return;
    candidates.sort((a, b) => a.d - b.d);
    const curIdx = candidates.findIndex((c) => c.e.id === p.targetId);
    const next = candidates[(curIdx + 1) % candidates.length];
    p.targetId = next.e.id;
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

  discardItem(itemId: string, count = 1, pid?: number): void {
    const r = this.resolve(pid);
    if (!r) return;
    const { meta } = r;
    const def = ITEMS[itemId];
    const available = this.countItem(itemId, meta.entityId);
    if (!def || available <= 0) { this.error(meta.entityId, "You don't have that item."); return; }
    const discardCount = Number.isFinite(count) ? Math.min(Math.floor(count), available) : 0;
    if (discardCount <= 0) return;
    this.removeItem(itemId, discardCount, meta.entityId);
    this.emit({
      type: 'log',
      text: `Discarded ${def.name}${discardCount > 1 ? ' x' + discardCount : ''}.`,
      color: '#999',
      pid: meta.entityId,
    });
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
    recalcPlayerStats(p, meta.cls, meta.equipment, meta.talentMods);
    this.emit({ type: 'log', text: `Equipped ${def.name}.`, color: '#8f8', pid: meta.entityId });
  }

  private hasFishableWaterAhead(p: Entity): boolean {
    const sin = Math.sin(p.facing);
    const cos = Math.cos(p.facing);
    return FISHING_SAMPLE_DISTANCES.some((d) =>
      groundHeight(p.pos.x + sin * d, p.pos.z + cos * d, this.cfg.seed) < WATER_LEVEL - SWIM_DEPTH);
  }

  private isAtDeepfenShallowsFishingSpot(p: Entity): boolean {
    const d = Math.hypot(p.pos.x - DEEPFEN_SHALLOWS_LAKE.x, p.pos.z - DEEPFEN_SHALLOWS_LAKE.z);
    return d <= DEEPFEN_SHALLOWS_LAKE.radius + DEEPFEN_FISHING_SHORE_MARGIN;
  }

  private shouldCatchCodfather(p: Entity, meta: PlayerMeta): boolean {
    const qp = meta.questLog.get(THE_CODFATHER_QUEST_ID);
    return qp?.state === 'active'
      && this.countItem(THE_CODFATHER_ITEM_ID, meta.entityId) === 0
      && this.isAtDeepfenShallowsFishingSpot(p);
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
    if (this.shouldCatchCodfather(p, meta)) {
      this.addItem(THE_CODFATHER_ITEM_ID, 1, meta.entityId);
      return;
    }
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
      const restoresMana = (def.potionMana ?? 0) > 0 && p.resourceType === 'mana' && p.resource < p.maxResource;
      const restoresHp = (def.potionHp ?? 0) > 0 && p.hp < p.maxHp;
      if (!restoresHp && !restoresMana) {
        this.error(meta.entityId, p.hp >= p.maxHp && (def.potionMana ?? 0) === 0 ? 'You are already at full health.' : 'Nothing to restore.');
        return;
      }
      this.removeItem(itemId, 1, meta.entityId);
      p.potionCooldownUntil = this.time + POTION_COOLDOWN;
      if (restoresHp) {
        const heal = Math.min(Math.round(def.potionHp! * this.healingTakenMult(p)), p.maxHp - p.hp);
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
    const tapperParty = mob.tappedById !== null ? this.partyOf(mob.tappedById) : null;
    const hasSharedLootRights = mob.tappedById === null
      || mob.tappedById === meta.entityId
      || !!tapperParty?.members.includes(meta.entityId);
    const hasPersonalLoot = mob.loot.items.some((s) => s.personalFor?.includes(meta.entityId));
    if (!hasSharedLootRights && !hasPersonalLoot) {
      this.error(meta.entityId, "You don't have permission to loot that.");
      return;
    }
    if (dist2d(p.pos, mob.pos) > INTERACT_RANGE) { this.error(meta.entityId, 'Too far away.'); return; }
    if (hasSharedLootRights && mob.loot.copper > 0) {
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
      if (!hasSharedLootRights) continue;
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
      if (!qp || (qp.state !== 'active' && qp.state !== 'ready')) {
        this.error(meta.entityId, def.pickupDeny ?? `You cannot take the ${def.name} yet.`);
        return;
      }
      const quest = QUESTS[def.questId];
      const objIdx = quest.objectives.findIndex((o) => o.type === 'collect' && o.itemId === obj.objectItemId);
      if (objIdx >= 0 && this.countItem(obj.objectItemId, meta.entityId) >= quest.objectives[objIdx].count) {
        this.error(meta.entityId, def.pickupEnough ?? 'You have enough of those.');
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
    if (this.arenaMatches.has(p.id)) return;
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
    recalcPlayerStats(p, meta.cls, meta.equipment, meta.talentMods);
    p.hp = p.maxHp;
    p.resource = p.resourceType === 'mana' ? p.maxResource : p.resourceType === 'energy' ? 100 : 0;
    p.targetId = null;
    p.autoAttack = false;
    p.queuedOnSwing = null;
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

  // Dev chat cheats — only when Sim.devCommands is enabled (offline local play
  // or online server with ALLOW_DEV_COMMANDS=1). Returns null when handled
  // (no channel message), or undefined when not a dev command.
  private handleDevChat(raw: string, pid: number): SentChat | null | undefined {
    const levelM = /^\/(?:dev\s+level|devlevel)\s+(\d+)\s*$/i.exec(raw);
    if (levelM) {
      const level = Number(levelM[1]);
      this.setPlayerLevel(level, pid);
      this.emit({ type: 'log', text: `[dev] Level set to ${Math.max(1, Math.min(MAX_LEVEL, level))}.`, pid });
      return null;
    }
    const tpM = /^\/(?:dev\s+tp|devtp)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s*$/i.exec(raw);
    if (tpM) {
      const e = this.entities.get(pid);
      if (e) {
        const p = this.groundPos(Number(tpM[1]), Number(tpM[2]));
        e.pos = p;
        e.prevPos = { ...p };
        this.grid.update(e);
        this.playerGrid.update(e);
        this.emit({ type: 'log', text: `[dev] Teleported to ${p.x.toFixed(1)}, ${p.z.toFixed(1)}.`, pid });
      }
      return null;
    }
    const giveM = /^\/(?:dev\s+give|devgive)\s+(\S+)(?:\s+(\d+))?\s*$/i.exec(raw);
    if (giveM) {
      const itemId = giveM[1];
      const count = Math.max(1, Math.min(20, Number(giveM[2] ?? 1)));
      if (!ITEMS[itemId]) {
        this.error(pid, `[dev] Unknown item '${itemId}'.`);
        return null;
      }
      this.addItem(itemId, count, pid);
      return null;
    }
    if (/^\/dev(?:\s|$)/i.test(raw)) {
      this.error(pid, 'Dev commands: /dev level N, /dev tp X Z, /dev give itemId [count]');
      return null;
    }
    return undefined;
  }

  private whisperMessageForName(rest: string, name: string, exactCase: boolean): string | null {
    const input = exactCase ? rest : rest.toLowerCase();
    const prefix = exactCase ? name : name.toLowerCase();
    if (!input.startsWith(prefix)) return null;
    const next = rest.charAt(name.length);
    if (!next || !/\s/.test(next)) return null;
    const message = rest.slice(name.length).trim();
    return message ? message : null;
  }

  private resolveWhisperTarget(rest: string): { target: PlayerMeta; message: string } | { error: string } | null {
    const trimmed = rest.trim();
    if (!trimmed) return null;
    const matches: { target: PlayerMeta; message: string; exactCase: boolean }[] = [];
    for (const target of this.players.values()) {
      const exactMessage = this.whisperMessageForName(trimmed, target.name, true);
      if (exactMessage !== null) {
        matches.push({ target, message: exactMessage, exactCase: true });
        continue;
      }
      const insensitiveMessage = this.whisperMessageForName(trimmed, target.name, false);
      if (insensitiveMessage !== null) matches.push({ target, message: insensitiveMessage, exactCase: false });
    }
    matches.sort((a, b) => b.target.name.length - a.target.name.length);
    const longestLength = matches[0]?.target.name.length ?? 0;
    const longest = matches.filter((m) => m.target.name.length === longestLength);
    const exact = longest.filter((m) => m.exactCase);
    if (exact.length > 0) return exact[0];
    if (longest.length === 1) return longest[0];
    const typedName = trimmed.split(/\s+/, 1)[0] ?? trimmed;
    if (longest.length > 1) return { error: `Several players match '${typedName}'. Use exact capitalization.` };
    return { error: `There is no player named '${typedName}' online.` };
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

    // "/afk [message]" / "/dnd [message]" — set a presence status. Repeating
    // the same command with no message toggles it off. While away, anyone who
    // whispers you gets an auto-reply; /dnd also withholds the whisper itself.
    const awaym = /^\/(afk|dnd)(?:\s+([\s\S]+))?$/i.exec(raw);
    if (awaym) {
      const mode = awaym[1].toLowerCase() as AwayStatus['mode'];
      const custom = awaym[2]?.trim();
      if (r.meta.away?.mode === mode && !custom) {
        r.meta.away = null;
        this.emit({ type: 'log', text: mode === 'afk' ? 'You are no longer Away From Keyboard.' : 'You have left Do Not Disturb mode.', color: '#ffd100', pid: r.meta.entityId });
      } else {
        const message = custom || (mode === 'afk' ? 'Away From Keyboard' : 'Do Not Disturb');
        r.meta.away = { mode, message };
        this.emit({ type: 'log', text: mode === 'afk' ? `You are now Away From Keyboard: ${message}` : `You are now in Do Not Disturb mode: ${message}`, color: '#ffd100', pid: r.meta.entityId });
      }
      return null;
    }

    // Any other chat means you're back — clear a lingering away status.
    if (r.meta.away) {
      r.meta.away = null;
      this.emit({ type: 'log', text: 'You are no longer marked as away.', color: '#ffd100', pid: r.meta.entityId });
    }

    // "/party" (no message) is a self-only roster readout; "/party <msg>"
    // and "/p <msg>" stay party chat (the trailing \s in that branch below).
    if (/^\/(party|group|grp)\s*$/i.test(raw)) {
      this.error(r.meta.entityId, this.partyReadout(r.meta.entityId));
      return null;
    }

    if (this.devCommands) {
      const devHandled = this.handleDevChat(raw, r.meta.entityId);
      if (devHandled !== undefined && devHandled !== null) return devHandled;
    }

    if (/^\/who(?:\s|$)/i.test(raw)) {
      this.error(r.meta.entityId, 'The /who roster is available in online play.');
      return null;
    }

    // "/help" (or "/?" / "/commands") lists the available chat commands as a
    // system notice to the asker only. Like /who, it produces no chat message,
    // so it works identically offline and online without server wiring.
    if (/^\/(?:help|commands|\?)(?:\s|$)/i.test(raw)) {
      for (const line of this.helpLines()) this.error(r.meta.entityId, line);
      return null;
    }

    // "/roll", "/roll N", "/roll M-N" — a classic random roll for loot disputes
    // and social play. Rolled through the deterministic sim RNG so it is
    // server-authoritative (clients can't fake a result) and identical offline.
    const rollm = /^\/roll(?:\s+(\d+)(?:\s*-\s*(\d+))?)?\s*$/i.exec(raw);
    if (rollm) {
      let lo = 1, hi = 100;
      if (rollm[1] !== undefined) {
        const n = parseInt(rollm[1], 10);
        if (rollm[2] !== undefined) { lo = n; hi = parseInt(rollm[2], 10); }
        else { hi = n; }
      }
      const MAX_ROLL = 1_000_000;
      if (lo < 1 || hi > MAX_ROLL || lo > hi) {
        this.error(r.meta.entityId, `Invalid roll range. Use /roll, /roll N, or /roll M-N (1-${MAX_ROLL}).`);
        return null;
      }
      const result = this.rng.int(lo, hi);
      const text = `${result} (${lo}-${hi})`;
      const party = this.partyOf(r.meta.entityId);
      if (party) {
        for (const mPid of party.members) {
          this.emit({ type: 'chat', fromPid: r.meta.entityId, from: r.meta.name, text, channel: 'roll', pid: mPid });
        }
      } else {
        for (const meta of this.players.values()) {
          const e = this.entities.get(meta.entityId);
          if (!e || dist2d(r.e.pos, e.pos) > SAY_RANGE) continue;
          this.emit({ type: 'chat', fromPid: r.meta.entityId, from: r.meta.name, text, channel: 'roll', pid: meta.entityId });
        }
      }
      return null;
    }

    // "/r message" — reply to the last player who whispered us. Rewrite it to
    // the "/w <name> message" form so delivery, the echo, and case-matching
    // all stay in the single whisper handler below.
    const rm = /^\/r(?:eply)?\s+([\s\S]+)$/i.exec(raw);
    let line = raw;
    if (rm) {
      const replyTo = r.meta.lastWhisperFrom;
      if (!replyTo) { this.error(r.meta.entityId, 'You have no one to reply to.'); return null; }
      line = `/w ${replyTo} ${rm[1]}`;
    }

    // "/inspect name" — self-only readout of another online player's level,
    // class, and health. The first cross-player readout; mirrors WoW's Inspect.
    const im = /^\/(?:inspect|ins|examine)(?:\s+([\s\S]+))?$/i.exec(raw);
    if (im) {
      const targetName = (im[1] ?? '').trim();
      if (!targetName) { this.error(r.meta.entityId, 'Inspect whom? Usage: /inspect <name>.'); return null; }
      // resolve by name with the same exact-then-unambiguous-CI rule as /w
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
      const te = target ? this.entities.get(target.entityId) : null;
      if (!target || !te) { this.error(r.meta.entityId, `There is no player named '${targetName}' online.`); return null; }
      this.error(r.meta.entityId, this.inspectReadout(target, te));
      return null;
    }

    // "/unfollow" stops an active follow
    if (/^\/unfollow(?:\s|$)/i.test(raw)) {
      if (r.e.followTargetId === null) this.error(r.meta.entityId, 'You are not following anyone.');
      else this.stopFollow(r.e, 'You stop following.');
      return null;
    }

    // "/follow [name]" trails another player; with no name it follows the
    // current target. Movement, combat, casting, re-targeting, or the leader
    // moving out of range all end it (see updateFollowMovement).
    const fm = /^\/follow(?:\s+([\s\S]+))?$/i.exec(raw);
    if (fm) {
      if (r.e.inCombat) { this.error(r.meta.entityId, "You can't start following while in combat."); return null; }
      let target: PlayerMeta | null = null;
      const nameArg = (fm[1] ?? '').trim();
      if (nameArg) {
        const wanted = nameArg.toLowerCase();
        const ci: PlayerMeta[] = [];
        for (const meta of this.players.values()) {
          if (meta.name === nameArg) { target = meta; break; }
          if (meta.name.toLowerCase() === wanted) ci.push(meta);
        }
        if (!target) {
          if (ci.length === 1) target = ci[0];
          else if (ci.length > 1) { this.error(r.meta.entityId, `Several players match '${nameArg}'. Use exact capitalization.`); return null; }
        }
        if (!target) { this.error(r.meta.entityId, `There is no player named '${nameArg}' online.`); return null; }
      } else {
        const cur = r.e.targetId !== null ? this.players.get(r.e.targetId) : undefined;
        if (!cur) { this.error(r.meta.entityId, 'Target a player to follow, or use /follow <name>.'); return null; }
        target = cur;
      }
      if (target.entityId === r.meta.entityId) { this.error(r.meta.entityId, "You can't follow yourself."); return null; }
      r.e.followTargetId = target.entityId;
      this.error(r.meta.entityId, `Now following ${target.name}.`);
      return null;
    }

    // "/played" — report how long this character has been in the world this
    // session. Self-only informational line, like /who's reply.
    if (/^\/played(?:\s|$)/i.test(raw)) {
      const secs = Math.max(0, Math.floor(this.time - r.meta.joinedAt));
      const h = Math.floor(secs / 3600);
      const m = Math.floor((secs % 3600) / 60);
      const s = secs % 60;
      const parts: string[] = [];
      if (h) parts.push(`${h}h`);
      if (h || m) parts.push(`${m}m`);
      parts.push(`${s}s`);
      this.error(r.meta.entityId, `Time played this session: ${parts.join(' ')}.`);
      return null;
    }

    // Self-only readouts: emit a private system line and never become chat.
    if (/^\/(?:where|loc|zone)(?:\s|$)/i.test(raw)) {
      const zone = zoneAt(r.e.pos.z);
      const [lo, hi] = zone.levelRange;
      this.error(r.meta.entityId, `You are in ${zone.name} (levels ${lo}–${hi}) at (${Math.floor(r.e.pos.x)}, ${Math.floor(r.e.pos.z)}).`);
      return null;
    }
    if (/^\/(?:target|tar)(?:\s|$)/i.test(raw)) {
      const tid = r.e.targetId;
      const t = tid !== null ? this.entities.get(tid) ?? null : null;
      if (!t) this.error(r.meta.entityId, 'You have no target.');
      else this.error(r.meta.entityId, this.targetReadout(t));
      return null;
    }
    if (/^\/(?:xp|exp|experience)(?:\s|$)/i.test(raw)) { this.error(r.meta.entityId, this.xpReadout(r.meta, r.e.level)); return null; }
    if (/^\/(?:gold|money|coins)(?:\s|$)/i.test(raw)) { this.error(r.meta.entityId, this.goldReadout(r.meta.copper)); return null; }
    if (/^\/(?:stats|st|sheet)(?:\s|$)/i.test(raw)) { this.error(r.meta.entityId, this.statsReadout(r.meta, r.e)); return null; }
    if (/^\/(?:buffs?|auras)(?:\s|$)/i.test(raw)) { this.error(r.meta.entityId, this.buffsReadout(r.e)); return null; }
    if (/^\/(?:cooldowns?|cds?)(?:\s|$)/i.test(raw)) { this.error(r.meta.entityId, this.cooldownsReadout(r.e)); return null; }
    if (/^\/(?:bags|inv|inventory)(?:\s|$)/i.test(raw)) { this.error(r.meta.entityId, this.bagsReadout(r.meta)); return null; }
    if (/^\/(?:quests?|ql)(?:\s|$)/i.test(raw)) { this.error(r.meta.entityId, this.questReadout(r.meta)); return null; }
    if (/^\/(?:gear|equip|equipment)(?:\s|$)/i.test(raw)) { this.error(r.meta.entityId, this.gearReadout(r.meta)); return null; }
    if (/^\/(?:abilities|spells|spellbook)(?:\s|$)/i.test(raw)) { this.error(r.meta.entityId, this.abilitiesReadout(r.meta, r.e)); return null; }
    if (/^\/(?:pet|pets|companion)(?:\s|$)/i.test(raw)) { this.error(r.meta.entityId, this.petReadout(r.e)); return null; }
    if (/^\/(?:session|sess|sessionstats)(?:\s|$)/i.test(raw)) { this.error(r.meta.entityId, this.sessionReadout(r.meta)); return null; }
    if (/^\/(?:threat|aggro)(?:\s|$)/i.test(raw)) { this.error(r.meta.entityId, this.threatReadout(r.e)); return null; }
    if (/^\/(?:zones|zonelist|worldmap)(?:\s|$)/i.test(raw)) { this.error(r.meta.entityId, this.zonesReadout(r.e.pos.z)); return null; }
    if (/^\/(?:nearby|near|around)(?:\s|$)/i.test(raw)) { this.error(r.meta.entityId, this.nearbyReadout(r.e)); return null; }
    if (/^\/(?:arena|pvp|rating)(?:\s|$)/i.test(raw)) { this.error(r.meta.entityId, this.arenaReadout(r.meta)); return null; }
    if (/^\/(?:range|dist|distance)(?:\s|$)/i.test(raw)) { this.error(r.meta.entityId, this.rangeReadout(r.e)); return null; }
    if (/^\/(?:buyback|bb|repurchase)(?:\s|$)/i.test(raw)) { this.error(r.meta.entityId, this.buybackReadout(r.meta)); return null; }
    if (/^\/(?:combo|cp|combopoints)(?:\s|$)/i.test(raw)) { this.error(r.meta.entityId, this.comboReadout(r.e)); return null; }
    if (/^\/(?:combat|cb|incombat)(?:\s|$)/i.test(raw)) { this.error(r.meta.entityId, this.combatReadout(r.e)); return null; }
    if (/^\/(?:graveyard|gy|spirithealer)(?:\s|$)/i.test(raw)) { this.error(r.meta.entityId, this.graveyardReadout(r.e)); return null; }
    if (/^\/(?:dungeons|dungeon|instances)(?:\s|$)/i.test(raw)) { this.error(r.meta.entityId, this.dungeonsReadout()); return null; }
    if (/^\/(?:consider|con|difficulty)(?:\s|$)/i.test(raw)) { this.error(r.meta.entityId, this.considerReadout(r.e)); return null; }
    if (/^\/(?:pois|poi|landmarks)(?:\s|$)/i.test(raw)) { this.error(r.meta.entityId, this.poisReadout(r.e)); return null; }
    if (/^\/(?:completed|questsdone|qdone)(?:\s|$)/i.test(raw)) { this.error(r.meta.entityId, this.completedReadout(r.meta)); return null; }
    if (/^\/(?:listings|mylistings|auctions)(?:\s|$)/i.test(raw)) { this.error(r.meta.entityId, this.listingsReadout(r.meta)); return null; }
    if (/^\/(?:targetbuffs|debuffs|tb)(?:\s|$)/i.test(raw)) { this.error(r.meta.entityId, this.targetBuffsReadout(r.e)); return null; }
    if (/^\/(?:casting|cast|castbar)(?:\s|$)/i.test(raw)) { this.error(r.meta.entityId, this.castingReadout(r.e)); return null; }
    if (/^\/(?:speed|movespeed|ms)(?:\s|$)/i.test(raw)) { this.error(r.meta.entityId, this.speedReadout(r.e)); return null; }
    if (/^\/(?:attack|autoattack|aa)(?:\s|$)/i.test(raw)) { this.error(r.meta.entityId, this.attackReadout(r.e, r.meta)); return null; }
    if (/^\/(consumable|consumables|eat|drink)(?:\s|$)/i.test(raw)) { this.error(r.meta.entityId, this.consumableReadout(r.e)); return null; }
    if (/^\/(?:potion|potioncd|pot)(?:\s|$)/i.test(raw)) { this.error(r.meta.entityId, this.potionReadout(r.e)); return null; }
    if (/^\/(?:overpower|op|overpowered)(?:\s|$)/i.test(raw)) { this.error(r.meta.entityId, this.overpowerReadout(r.e, r.meta)); return null; }
    if (/^\/(form|stance|shapeshift)(?:\s|$)/i.test(raw)) { this.error(r.meta.entityId, this.formReadout(r.e)); return null; }
    if (/^\/(?:manaregen|regen|5sr)(?:\s|$)/i.test(raw)) { this.error(r.meta.entityId, this.manaRegenReadout(r.e)); return null; }
    if (/^\/(?:falling|jump|airborne)(?:\s|$)/i.test(raw)) { this.error(r.meta.entityId, this.fallingReadout(r.e)); return null; }
    if (/^\/(?:pettaunt|petgrowl|growl)(?:\s|$)/i.test(raw)) { this.error(r.meta.entityId, this.petTauntReadout(r.e)); return null; }
    if (/^\/(queued|onswing|swingqueue)(?:\s|$)/i.test(raw)) { this.error(r.meta.entityId, this.queuedReadout(r.e)); return null; }
    if (/^\/(?:savedmana|parkedmana|sm)(?:\s|$)/i.test(raw)) { this.error(r.meta.entityId, this.savedManaReadout(r.meta, r.e)); return null; }

    // "/w name message" — private whisper to an online player. Match against
    // `line` so a "/r" reply (rewritten to the /w form above) flows through the
    // same longest-online-name resolver.
    const wm = /^\/(?:w|whisper|t|tell)\s+([\s\S]+)$/i.exec(line);
    if (wm) {
      const resolved = this.resolveWhisperTarget(wm[1]);
      if (!resolved) return null;
      if ('error' in resolved) { this.error(r.meta.entityId, resolved.error); return null; }
      const { target, message: msg } = resolved;
      if (target.entityId === r.meta.entityId) { this.error(r.meta.entityId, 'You mutter to yourself. Nobody hears it.'); return null; }
      if (target.away) {
        const label = target.away.mode === 'afk' ? 'Away From Keyboard' : 'Do Not Disturb';
        this.emit({ type: 'log', text: `${target.name} is ${label}: ${target.away.message}`, color: '#ffd100', pid: r.meta.entityId });
        if (target.away.mode === 'dnd') {
          // Withhold the whisper, but still echo the sender's own line so they
          // see what they tried to send.
          this.emit({ type: 'chat', fromPid: r.meta.entityId, from: r.meta.name, to: target.name, text: msg, channel: 'whisper', pid: r.meta.entityId });
          return { channel: 'whisper', message: msg };
        }
      }
      // classic-WoW "/r": the recipient's reply target is whoever last
      // whispered them, so record it on the target (not the sender).
      target.lastWhisperFrom = r.meta.name;
      this.emit({ type: 'chat', fromPid: r.meta.entityId, from: r.meta.name, text: msg, channel: 'whisper', pid: target.entityId });
      this.emit({ type: 'chat', fromPid: r.meta.entityId, from: r.meta.name, to: target.name, text: msg, channel: 'whisper', pid: r.meta.entityId });
      return { channel: 'whisper', message: msg, target: target.name };
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

    // "/join <channel>" / "/leave <channel>" — opt-in global channels
    const jm = /^\/(join|leave)\b\s*(\S*)\s*$/i.exec(raw);
    if (jm) {
      this.handleChannelMembership(r.meta, jm[1].toLowerCase() as 'join' | 'leave', jm[2].toLowerCase());
      return null;
    }

    // "/world message" / "/lfg message" — talk in an opt-in channel; only
    // players who have /join-ed it hear the message (the sender included)
    const cm = /^\/(world|lfg)\s+([\s\S]+)$/i.exec(raw);
    if (cm) {
      const channel = cm[1].toLowerCase() as JoinableChannel;
      const clean = cm[2].trim();
      if (!clean) return null;
      const mine = this.channelSubs.get(r.meta.entityId);
      if (!mine || !mine.has(channel)) {
        this.error(r.meta.entityId, `You are not in the ${channel} channel. Type /join ${channel} first.`);
        return null;
      }
      for (const [subPid, set] of this.channelSubs) {
        if (set.has(channel) && this.players.has(subPid)) {
          this.emit({ type: 'chat', fromPid: r.meta.entityId, from: r.meta.name, text: clean, channel, pid: subPid });
        }
      }
      return { channel, message: clean };
    }

    // "/me <action>" — freeform third-person action text, e.g.
    // "/me ponders the void" → "Aleph ponders the void". Emotes never become
    // the player's sticky chat channel, so this returns null on success.
    const meMatch = /^\/(?:me|emote|e)\s+([\s\S]+)$/i.exec(raw);
    if (meMatch) {
      const action = meMatch[1].trim();
      if (action) this.broadcastEmote(r.meta, r.e, action);
      return null;
    }

    // "/wave", "/dance [name]" — predefined social emotes. An optional name
    // targets an online player (in range or not); unknown names fall back to
    // the untargeted form, matching the classic-MMO convention.
    const emMatch = /^\/([a-z]+)(?:\s+(\S+))?\s*$/i.exec(raw);
    if (emMatch) {
      const key = EMOTE_ALIASES[emMatch[1].toLowerCase()] ?? emMatch[1].toLowerCase();
      const def = EMOTES[key];
      if (def) {
        const targetName = emMatch[2];
        let text = def.solo;
        if (targetName && def.target) {
          const t = this.findPlayerByName(targetName);
          if (t) text = def.target.replace('%t', t.name === r.meta.name ? 'themselves' : t.name);
        }
        this.broadcastEmote(r.meta, r.e, text);
        return null;
      }
    }

    // bare text and "/s" are local say; "/y" carries further — both are
    // delivered per-player by range and carry the speaker for chat bubbles
    let channel: 'say' | 'yell' = 'say';
    let clean = raw;
    if (/^\/y(ell)?\s/i.test(raw)) { channel = 'yell'; clean = raw.replace(/^\/y(ell)?\s+/i, '').trim(); }
    else if (/^\/s(ay)?\s/i.test(raw)) { clean = raw.replace(/^\/s(ay)?\s+/i, '').trim(); }
    else if (raw.startsWith('/')) { this.error(r.meta.entityId, `Unknown command: ${raw.split(' ')[0]}. Type /help for a list.`); return null; }
    if (!clean) return null;
    const range = channel === 'yell' ? YELL_RANGE : SAY_RANGE;
    for (const meta of this.players.values()) {
      const e = this.entities.get(meta.entityId);
      if (!e || dist2d(r.e.pos, e.pos) > range) continue;
      this.emit({ type: 'chat', fromPid: r.meta.entityId, from: r.meta.name, text: clean, channel, entityId: r.e.id, pid: meta.entityId });
    }
    return { channel, message: clean };
  }

  playEmote(emoteId: OverheadEmoteId, pid?: number): void {
    const r = this.resolve(pid);
    if (!r) return;
    r.e.overheadEmoteId = emoteId;
    r.e.overheadEmoteUntil = this.time + OVERHEAD_EMOTE_DURATION;
    r.e.overheadEmoteSeq += 1;
  }

  // Resolve a player by name the same way whispers do: an exact-case match
  // wins outright, otherwise a case-insensitive match is used only when it is
  // unambiguous.
  private findPlayerByName(name: string): PlayerMeta | null {
    const wanted = name.toLowerCase();
    const ci: PlayerMeta[] = [];
    for (const meta of this.players.values()) {
      if (meta.name === name) return meta;
      if (meta.name.toLowerCase() === wanted) ci.push(meta);
    }
    return ci.length === 1 ? ci[0] : null;
  }

  // Send a third-person emote to every player within /say range (including the
  // actor). `from` carries the actor's name so the client can render it as a
  // clickable name; `text` is the action predicate (e.g. "waves at Bet.").
  private broadcastEmote(actor: PlayerMeta, actorEntity: Entity, text: string): void {
    const body = text.slice(0, 200);
    for (const meta of this.players.values()) {
      const e = this.entities.get(meta.entityId);
      if (!e || dist2d(actorEntity.pos, e.pos) > SAY_RANGE) continue;
      this.emit({ type: 'chat', fromPid: actor.entityId, from: actor.name, text: body, channel: 'emote', entityId: actorEntity.id, pid: meta.entityId });
    }
  }

  // -------------------------------------------------------------------------
  // Hostility: mobs are hostile to players; controlled pets inherit their
  // owner's PvP hostility during active duels and arena matches.
  // -------------------------------------------------------------------------

  private pvpController(e: Entity | null): Entity | null {
    if (!e) return null;
    if (e.kind === 'player') return e;
    if (e.kind === 'mob' && e.ownerId !== null) {
      const owner = this.entities.get(e.ownerId);
      return owner?.kind === 'player' ? owner : null;
    }
    return null;
  }

  isHostileTo(attacker: Entity, target: Entity): boolean {
    if (target.kind === 'mob') {
      if (target.ownerId !== null) {
        const owner = this.entities.get(target.ownerId);
        return !!owner && owner.kind === 'player' && this.isHostileTo(attacker, owner);
      }
      return target.hostile;
    }
    if (target.kind === 'player') {
      const attackerPlayer = this.pvpController(attacker);
      if (!attackerPlayer) return false;
      if (attackerPlayer.dead) return false;
      if (attackerPlayer.id === target.id) return false;
      const duel = this.duels.get(attackerPlayer.id);
      if (duel && duel.state === 'active'
        && ((duel.a === attackerPlayer.id && duel.b === target.id)
          || (duel.b === attackerPlayer.id && duel.a === target.id))) return true;
      const match = this.arenaMatches.get(attackerPlayer.id);
      return !!match && match.state === 'active' && !match.defeated.has(attackerPlayer.id)
        && this.isArenaCrossTeam(match, attackerPlayer.id, target.id);
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
    if (this.duels.has(invite.fromPid) || this.duels.has(r.meta.entityId)) {
      this.error(r.meta.entityId, 'A duel is already in progress.');
      return;
    }
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

  private clearAurasFromSource(target: Entity, sourceId: number): void {
    let statsDirty = false;
    for (let i = target.auras.length - 1; i >= 0; i--) {
      const a = target.auras[i];
      if (a.sourceId !== sourceId) continue;
      target.auras.splice(i, 1);
      this.emit({ type: 'aura', targetId: target.id, name: a.name, gained: false });
      if (a.kind.startsWith('buff') || a.kind.startsWith('form')) statsDirty = true;
    }
    if (statsDirty && target.kind === 'player') {
      const meta = this.players.get(target.id);
      if (meta) recalcPlayerStats(target, meta.cls, meta.equipment, meta.talentMods);
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
    if (ea) this.clearAurasFromSource(ea, duel.b);
    if (eb) this.clearAurasFromSource(eb, duel.a);
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
  // The Ashen Coliseum — ranked arena (1v1 + 2v2 queue, matchmaking, Elo)
  // -------------------------------------------------------------------------

  arenaQueueJoin(pidOrFormat?: number | ArenaFormat, format: ArenaFormat = '1v1'): void {
    let pid: number | undefined;
    let fmt: ArenaFormat = format;
    if (typeof pidOrFormat === 'string') { fmt = pidOrFormat; pid = undefined; }
    else { pid = pidOrFormat; }
    const r = this.resolve(pid);
    if (!r) return;
    const id = r.meta.entityId;
    if (this.isArenaQueued(id)) {
      const currentFmt = this.arenaQueuedFormat(id);
      if (currentFmt !== fmt) {
        this.error(id, `You are already in the ${currentFmt} queue. Leave it before queueing for ${fmt}.`);
        return;
      }
      const position = this.arenaQueuePosition(id, fmt);
      this.emit({ type: 'arenaQueued', position, format: fmt, pid: id });
      return;
    }
    if (this.arenaMatches.has(id)) { this.error(id, 'You are already in an arena match.'); return; }
    if (r.e.dead) { this.error(id, 'You cannot queue for the arena while dead.'); return; }
    if (this.duels.has(id)) { this.error(id, 'You cannot queue while dueling.'); return; }
    if (this.trades.has(id)) { this.error(id, 'Finish your trade before queueing.'); return; }
    if (r.e.pos.x > DUNGEON_X_THRESHOLD) { this.error(id, 'You cannot queue from inside an instance.'); return; }

    if (fmt === '1v1') {
      const party = this.partyOf(id);
      if (party && party.members.length > 1) {
        this.error(id, 'Leave your party before queueing for 1v1.');
        return;
      }
      this.arenaQueue1v1.push(id);
      this.emit({ type: 'arenaQueued', position: this.arenaQueue1v1.length, format: '1v1', pid: id });
      this.emit({ type: 'log', text: 'You join the Ashen Coliseum queue. Stand by for a worthy opponent…', color: '#ffa040', pid: id });
      return;
    }

    // 2v2
    const party = this.partyOf(id);
    let unitPids: number[];
    if (!party || party.members.length === 1) {
      unitPids = [id];
    } else if (party.members.length === 2) {
      if (party.leader !== id) {
        this.error(id, 'Only the party leader may queue your team for 2v2.');
        return;
      }
      unitPids = [...party.members];
    } else {
      this.error(id, '2v2 premade requires a party of exactly two.');
      return;
    }
    for (const mPid of unitPids) {
      if (mPid === id) continue;
      const e = this.entities.get(mPid);
      const mMeta = this.players.get(mPid);
      if (!e || !mMeta) { this.error(id, 'A party member is unavailable.'); return; }
      if (e.dead) { this.error(id, `${mMeta.name} cannot queue while dead.`); return; }
      if (this.arenaMatches.has(mPid)) { this.error(id, `${mMeta.name} is already in an arena match.`); return; }
      if (this.isArenaQueued(mPid)) { this.error(id, `${mMeta.name} is already in the arena queue.`); return; }
      if (this.duels.has(mPid)) { this.error(id, `${mMeta.name} cannot queue while dueling.`); return; }
      if (this.trades.has(mPid)) { this.error(id, `${mMeta.name} must finish trading before queueing.`); return; }
      if (e.pos.x > DUNGEON_X_THRESHOLD) { this.error(id, `${mMeta.name} cannot queue from inside an instance.`); return; }
    }
    const unit: ArenaQueueUnit = { pids: unitPids, rating: this.arenaTeamRating(unitPids) };
    this.arenaQueue2v2.push(unit);
    const position = this.arenaQueue2v2PlayerCount();
    for (const mPid of unitPids) {
      this.emit({ type: 'arenaQueued', position, format: '2v2', pid: mPid });
      this.emit({ type: 'log', text: 'You join the Ashen Coliseum 2v2 queue. Stand by for opponents…', color: '#ffa040', pid: mPid });
    }
  }

  arenaQueueLeave(pid?: number): void {
    const r = this.resolve(pid);
    if (!r) return;
    const id = r.meta.entityId;
    const fmt = this.arenaQueuedFormat(id);
    const unit = fmt === '2v2' ? this.arenaQueue2v2.find((u) => u.pids.includes(id)) : null;
    if (this.arenaDequeue(id)) {
      this.emit({ type: 'arenaUnqueued', pid: id });
      this.emit({ type: 'log', text: fmt === '2v2' ? 'You leave the Ashen Coliseum 2v2 queue.' : 'You leave the Ashen Coliseum queue.', color: '#ffa040', pid: id });
      if (unit) {
        for (const mPid of unit.pids) {
          if (mPid === id) continue;
          this.emit({ type: 'arenaUnqueued', pid: mPid });
          this.emit({ type: 'log', text: 'Your team leaves the Ashen Coliseum 2v2 queue.', color: '#ffa040', pid: mPid });
        }
      }
    }
  }

  private isArenaQueued(pid: number): boolean {
    return this.arenaQueue1v1.includes(pid) || this.arenaQueue2v2.some((u) => u.pids.includes(pid));
  }

  private arenaQueuedFormat(pid: number): ArenaFormat | null {
    if (this.arenaQueue1v1.includes(pid)) return '1v1';
    if (this.arenaQueue2v2.some((u) => u.pids.includes(pid))) return '2v2';
    return null;
  }

  private arenaQueuePosition(pid: number, format: ArenaFormat): number {
    if (format === '1v1') return this.arenaQueue1v1.indexOf(pid) + 1;
    let pos = 0;
    for (const unit of this.arenaQueue2v2) {
      if (unit.pids.includes(pid)) return pos + 1;
      pos += unit.pids.length;
    }
    return pos + 1;
  }

  private arenaQueue2v2PlayerCount(): number {
    return this.arenaQueue2v2.reduce((n, u) => n + u.pids.length, 0);
  }

  private arenaDequeue(pid: number): boolean {
    const i1 = this.arenaQueue1v1.indexOf(pid);
    if (i1 >= 0) { this.arenaQueue1v1.splice(i1, 1); return true; }
    const ui = this.arenaQueue2v2.findIndex((u) => u.pids.includes(pid));
    if (ui >= 0) { this.arenaQueue2v2.splice(ui, 1); return true; }
    return false;
  }

  private freeArenaSlot(): number | null {
    for (let i = 0; i < ARENA_SLOT_COUNT; i++) {
      if (!this.arenaBusySlots.has(i)) return i;
    }
    return null;
  }

  private arenaTeamOf(match: ArenaMatch, pid: number): 'A' | 'B' | null {
    if (match.teamA.includes(pid)) return 'A';
    if (match.teamB.includes(pid)) return 'B';
    return null;
  }

  arenaAllPids(match: ArenaMatch): number[] {
    return [...match.teamA, ...match.teamB];
  }

  private arenaTeamRating(pids: number[]): number {
    if (pids.length === 0) return ARENA_BASE_RATING;
    let sum = 0;
    for (const pid of pids) sum += this.players.get(pid)?.arenaRating ?? ARENA_BASE_RATING;
    return sum / pids.length;
  }

  private isArenaCrossTeam(match: ArenaMatch, attackerPid: number, targetPid: number): boolean {
    const atkTeam = this.arenaTeamOf(match, attackerPid);
    const tgtTeam = this.arenaTeamOf(match, targetPid);
    if (!atkTeam || !tgtTeam || atkTeam === tgtTeam) return false;
    if (match.defeated.has(attackerPid)) return false;
    return !match.defeated.has(targetPid);
  }

  private isArenaTeamWiped(match: ArenaMatch, team: 'A' | 'B'): boolean {
    const pids = team === 'A' ? match.teamA : match.teamB;
    return pids.every((pid) => match.defeated.has(pid));
  }

  private arenaTeamHpFrac(match: ArenaMatch, team: 'A' | 'B'): number {
    const pids = team === 'A' ? match.teamA : match.teamB;
    let sum = 0, count = 0;
    for (const pid of pids) {
      if (match.defeated.has(pid)) continue;
      const e = this.entities.get(pid);
      if (!e) continue;
      sum += e.hp / Math.max(1, e.maxHp);
      count++;
    }
    return count > 0 ? sum / count : 0;
  }

  private arenaCombatants(pids: number[]): ArenaCombatant[] {
    const out: ArenaCombatant[] = [];
    for (const pid of pids) {
      const meta = this.players.get(pid);
      const e = this.entities.get(pid);
      if (meta && e) out.push({ pid, name: meta.name, cls: meta.cls, level: e.level });
    }
    return out;
  }

  private updateArena(): void {
    this.matchmakeArena1v1();
    this.matchmakeArena2v2();
    const seen = new Set<ArenaMatch>();
    for (const match of this.arenaMatches.values()) {
      if (seen.has(match)) continue;
      seen.add(match);
      const missingA = match.teamA.some((pid) => !this.entities.get(pid));
      const missingB = match.teamB.some((pid) => !this.entities.get(pid));
      if (missingA || missingB) {
        if (match.state === 'over') this.returnFromArena(match);
        else {
          let winner: 'A' | 'B' | null = null;
          if (missingA && !missingB) winner = 'B';
          else if (missingB && !missingA) winner = 'A';
          this.endArenaMatch(match, winner, 'forfeit');
        }
        continue;
      }
      if (match.state === 'over') {
        match.timer -= DT;
        if (match.timer <= 0) this.returnFromArena(match);
        continue;
      }
      const fighters = this.arenaAllPids(match).map((pid) => this.entities.get(pid)!).filter(Boolean);
      if (match.state === 'countdown') {
        const before = Math.ceil(match.timer);
        match.timer -= DT;
        const after = Math.ceil(match.timer);
        if (after < before && after > 0) {
          for (const mPid of this.arenaAllPids(match)) this.emit({ type: 'arenaCountdown', seconds: after, pid: mPid });
        }
        if (match.timer <= 0) {
          match.state = 'active';
          match.timer = 0;
          for (const e of fighters) this.readyArenaFighter(e, { clearPrep: false });
          for (const mPid of this.arenaAllPids(match)) {
            this.emit({ type: 'log', text: 'Fight!', color: '#ff5a3c', pid: mPid });
            this.emit({ type: 'arenaStart', pid: mPid });
          }
        }
        continue;
      }
      match.timer += DT;
      if (match.timer >= ARENA_MAX_DURATION) {
        const fa = this.arenaTeamHpFrac(match, 'A');
        const fb = this.arenaTeamHpFrac(match, 'B');
        const winner = Math.abs(fa - fb) < 0.02 ? null : fa > fb ? 'A' : 'B';
        this.endArenaMatch(match, winner, 'timeout');
      }
    }
  }

  private matchmakeArena1v1(): void {
    let guard = ARENA_SLOT_COUNT + 1;
    while (guard-- > 0) {
      this.arenaQueue1v1 = this.arenaQueue1v1.filter((id) => {
        const e = this.entities.get(id);
        return !!e && !e.dead && !this.arenaMatches.has(id);
      });
      if (this.arenaQueue1v1.length < 2 || this.freeArenaSlot() === null) return;
      const aPid = this.arenaQueue1v1[0];
      const aRating = this.players.get(aPid)?.arenaRating ?? ARENA_BASE_RATING;
      let bPid = -1, bestGap = Infinity;
      for (let i = 1; i < this.arenaQueue1v1.length; i++) {
        const id = this.arenaQueue1v1[i];
        const gap = Math.abs((this.players.get(id)?.arenaRating ?? ARENA_BASE_RATING) - aRating);
        if (gap < bestGap) { bestGap = gap; bPid = id; }
      }
      if (bPid < 0) return;
      this.arenaDequeue(aPid);
      this.arenaDequeue(bPid);
      this.startArenaMatch('1v1', [aPid], [bPid]);
    }
  }

  private pruneArenaQueue2v2(): void {
    this.arenaQueue2v2 = this.arenaQueue2v2.filter((unit) =>
      unit.pids.every((id) => {
        const e = this.entities.get(id);
        return !!e && !e.dead && !this.arenaMatches.has(id);
      }),
    );
  }

  private removeArenaQueueUnits(units: ArenaQueueUnit[]): void {
    for (const unit of units) {
      const i = this.arenaQueue2v2.indexOf(unit);
      if (i >= 0) this.arenaQueue2v2.splice(i, 1);
    }
  }

  private matchmakeArena2v2(): void {
    let guard = ARENA_SLOT_COUNT + 1;
    while (guard-- > 0) {
      this.pruneArenaQueue2v2();
      if (this.freeArenaSlot() === null) return;

      const premades = this.arenaQueue2v2.filter((u) => u.pids.length === 2);
      if (premades.length >= 2) {
        const anchor = premades[0];
        let best = premades[1], bestGap = Math.abs(premades[1].rating - anchor.rating);
        for (let i = 2; i < premades.length; i++) {
          const gap = Math.abs(premades[i].rating - anchor.rating);
          if (gap < bestGap) { bestGap = gap; best = premades[i]; }
        }
        this.removeArenaQueueUnits([anchor, best]);
        this.startArenaMatch('2v2', anchor.pids, best.pids);
        continue;
      }

      if (premades.length >= 1) {
        const solos = this.arenaQueue2v2.filter((u) => u.pids.length === 1);
        if (solos.length >= 2) {
          const premade = premades[0];
          const anchorSolo = solos[0];
          let partner = solos[1], bestGap = Math.abs(solos[1].rating - anchorSolo.rating);
          for (let i = 2; i < solos.length; i++) {
            const gap = Math.abs(solos[i].rating - anchorSolo.rating);
            if (gap < bestGap) { bestGap = gap; partner = solos[i]; }
          }
          this.removeArenaQueueUnits([premade, anchorSolo, partner]);
          this.startArenaMatch('2v2', premade.pids, [anchorSolo.pids[0], partner.pids[0]]);
          continue;
        }
      }

      const solos = this.arenaQueue2v2.filter((u) => u.pids.length === 1);
      if (solos.length >= 4) {
        const anchor = solos[0];
        let partner = solos[1], bestGap = Math.abs(solos[1].rating - anchor.rating);
        for (let i = 2; i < solos.length; i++) {
          const gap = Math.abs(solos[i].rating - anchor.rating);
          if (gap < bestGap) { bestGap = gap; partner = solos[i]; }
        }
        const teamASet = new Set([anchor.pids[0], partner.pids[0]]);
        const rest = solos.filter((u) => !teamASet.has(u.pids[0]));
        if (rest.length >= 2) {
          this.removeArenaQueueUnits([anchor, partner, rest[0], rest[1]]);
          this.startArenaMatch('2v2', [anchor.pids[0], partner.pids[0]], [rest[0].pids[0], rest[1].pids[0]]);
          continue;
        }
      }
      return;
    }
  }

  private startArenaMatch(format: ArenaFormat, teamA: number[], teamB: number[]): void {
    const slot = this.freeArenaSlot();
    const allPids = [...teamA, ...teamB];
    const entities = allPids.map((pid) => this.entities.get(pid));
    const metas = allPids.map((pid) => this.players.get(pid));
    if (slot === null || entities.some((e) => !e) || metas.some((m) => !m)) {
      if (format === '1v1') {
        for (const pid of allPids) {
          if (this.entities.get(pid) && !this.arenaMatches.has(pid)) this.arenaQueue1v1.unshift(pid);
        }
      } else {
        const okA = teamA.every((pid) => this.entities.get(pid) && !this.arenaMatches.has(pid));
        const okB = teamB.every((pid) => this.entities.get(pid) && !this.arenaMatches.has(pid));
        if (okB) this.arenaQueue2v2.unshift({ pids: teamB, rating: this.arenaTeamRating(teamB) });
        if (okA) this.arenaQueue2v2.unshift({ pids: teamA, rating: this.arenaTeamRating(teamA) });
      }
      return;
    }
    this.arenaBusySlots.add(slot);
    const returns = new Map<number, { x: number; z: number; facing: number }>();
    for (let i = 0; i < allPids.length; i++) {
      const e = entities[i]!;
      returns.set(allPids[i], { x: e.pos.x, z: e.pos.z, facing: e.facing });
    }
    const match: ArenaMatch = {
      id: this.nextArenaMatchId++, format, teamA, teamB, slot, state: 'countdown', timer: ARENA_COUNTDOWN,
      returns, ratingA: this.arenaTeamRating(teamA), ratingB: this.arenaTeamRating(teamB),
      defeated: new Set(),
    };
    for (const pid of allPids) this.arenaMatches.set(pid, match);
    const origin = arenaOrigin(slot);
    if (format === '1v1') {
      this.placeInArena(entities[0]!, origin, ARENA_SPAWN_A);
      this.placeInArena(entities[1]!, origin, ARENA_SPAWN_B);
    } else {
      this.placeTeamInArena(teamA, origin, ARENA_SPAWNS_A_2v2);
      this.placeTeamInArena(teamB, origin, ARENA_SPAWNS_B_2v2);
    }
    for (const e of entities) this.resetForArena(e!);
    this.emitArenaFound(match);
    for (const mPid of allPids) {
      this.emit({ type: 'arenaCountdown', seconds: ARENA_COUNTDOWN, pid: mPid });
      this.emit({ type: 'log', text: 'You step onto the sands of the Ashen Coliseum.', color: '#ffa040', pid: mPid });
    }
  }

  private emitArenaFound(match: ArenaMatch): void {
    for (const pid of this.arenaAllPids(match)) {
      const myTeam = this.arenaTeamOf(match, pid)!;
      const allyPids = (myTeam === 'A' ? match.teamA : match.teamB).filter((p) => p !== pid);
      const enemyPids = myTeam === 'A' ? match.teamB : match.teamA;
      const allies = this.arenaCombatants(allyPids);
      const enemies = this.arenaCombatants(enemyPids);
      const primary = enemies[0];
      if (!primary) continue;
      this.emit({
        type: 'arenaFound', format: match.format,
        oppName: enemies.map((e) => e.name).join(' & '),
        oppClass: primary.cls, oppLevel: primary.level,
        allies, enemies, pid,
      });
    }
  }

  private placeInArena(e: Entity, origin: { x: number; z: number }, spawn: { x: number; z: number; facing: number }): void {
    e.pos = this.groundPos(origin.x + spawn.x, origin.z + spawn.z);
    e.prevPos = { ...e.pos };
    e.facing = spawn.facing;
    e.prevFacing = spawn.facing;
    this.rebucket(e);
  }

  private placeTeamInArena(pids: number[], origin: { x: number; z: number }, spawns: { x: number; z: number; facing: number }[]): void {
    for (let i = 0; i < pids.length; i++) {
      const e = this.entities.get(pids[i]);
      if (e) this.placeInArena(e, origin, spawns[i] ?? spawns[spawns.length - 1]);
    }
  }

  // A clean slate so the bout is decided by play, not by what each fighter
  // walked in carrying: full health/resource, cooldowns and combat reset.
  private resetForArena(e: Entity): void {
    this.readyArenaFighter(e, { clearPrep: true });
  }

  private readyArenaFighter(e: Entity, opts: { clearPrep: boolean }): void {
    e.dead = false;
    if (opts.clearPrep) {
      e.auras = [];
      e.cooldowns.clear();
      e.ccDr.clear();
    }
    const meta = this.players.get(e.id);
    if (meta) recalcPlayerStats(e, meta.cls, meta.equipment, meta.talentMods);
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
    e.followTargetId = null;
    e.combatTimer = 99;
    e.inCombat = false;
    e.sitting = false;
    e.eating = null;
    e.drinking = null;
  }

  // Decide a bout: score it (once), then either send survivors home now (a
  // forfeit) or hold everyone on the sands for a brief aftermath before
  // returning them. winnerTeam null = draw.
  private endArenaMatch(match: ArenaMatch, winnerTeam: 'A' | 'B' | null, reason: 'defeat' | 'timeout' | 'forfeit'): void {
    const ratingA0 = match.ratingA;
    const ratingB0 = match.ratingB;
    let deltaA: number;
    if (winnerTeam === null) {
      deltaA = eloDelta(ratingA0, ratingB0, 0.5);
    } else if (winnerTeam === 'A') {
      deltaA = eloDelta(ratingA0, ratingB0, 1);
    } else {
      deltaA = -eloDelta(ratingB0, ratingA0, 1);
    }

    const scoreTeam = (team: 'A' | 'B', delta: number, won: boolean | null) => {
      const pids = team === 'A' ? match.teamA : match.teamB;
      const enemies = team === 'A' ? match.teamB : match.teamA;
      const enemyNames = enemies.map((pid) => this.players.get(pid)?.name ?? '?').join(' & ');
      for (const pid of pids) {
        const meta = this.players.get(pid);
        if (!meta) continue;
        const ratingBefore = meta.arenaRating;
        meta.arenaRating = Math.max(ARENA_MIN_RATING, ratingBefore + delta);
        if (won === true) meta.arenaWins++;
        else if (won === false) meta.arenaLosses++;
        this.emit({
          type: 'arenaEnd', pid, format: match.format,
          draw: winnerTeam === null, won: won === true,
          oppName: enemyNames, ratingBefore, ratingAfter: meta.arenaRating,
          allies: this.arenaCombatants(pids.filter((p) => p !== pid)),
          enemies: this.arenaCombatants(enemies),
        });
      }
    };

    const wonA = winnerTeam === null ? null : winnerTeam === 'A';
    const wonB = winnerTeam === null ? null : winnerTeam === 'B';
    scoreTeam('A', deltaA, wonA);
    scoreTeam('B', -deltaA, wonB);

    if (reason === 'forfeit') { this.returnFromArena(match); return; }

    const allPresent = this.arenaAllPids(match).every((pid) => this.entities.get(pid));
    if (!allPresent) { this.returnFromArena(match); return; }

    for (const pid of this.arenaAllPids(match)) {
      if (match.defeated.has(pid)) continue;
      const e = this.entities.get(pid);
      if (e) this.resetForArena(e);
    }
    match.state = 'over';
    match.timer = ARENA_RETURN_DELAY;
    for (const mPid of this.arenaAllPids(match)) {
      this.emit({ type: 'log', text: 'The bout is decided. Returning to the world…', color: '#ffa040', pid: mPid });
    }
  }

  // Teleport all fighters back to where they queued, fully cleansed, and
  // release the instance slot.
  private returnFromArena(match: ArenaMatch): void {
    for (const pid of this.arenaAllPids(match)) this.arenaMatches.delete(pid);
    this.arenaBusySlots.delete(match.slot);
    for (const pid of this.arenaAllPids(match)) {
      const e = this.entities.get(pid);
      const ret = match.returns.get(pid);
      if (!e || !ret) continue;
      this.resetForArena(e);
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
    const queuedFmt = this.arenaQueuedFormat(pid);
    let matchInfo: import('../world_api').ArenaInfo['match'] = null;
    if (match) {
      const myTeam = this.arenaTeamOf(match, pid);
      if (myTeam) {
        const allyPids = (myTeam === 'A' ? match.teamA : match.teamB).filter((p) => p !== pid);
        const enemyPids = myTeam === 'A' ? match.teamB : match.teamA;
        const allies = this.arenaCombatants(allyPids);
        const enemies = this.arenaCombatants(enemyPids);
        const primary = enemies[0];
        if (primary) {
          matchInfo = {
            format: match.format, state: match.state,
            oppName: enemies.map((e) => e.name).join(' & '),
            oppClass: primary.cls, oppLevel: primary.level, oppPid: primary.pid,
            allies, enemies,
            returnIn: match.state === 'over' ? Math.max(0, Math.ceil(match.timer)) : undefined,
          };
        }
      }
    }
    const format = match?.format ?? queuedFmt;
    const queueSize = format === '2v2' ? this.arenaQueue2v2PlayerCount()
      : format === '1v1' ? this.arenaQueue1v1.length
      : 0;
    return {
      rating: meta.arenaRating,
      wins: meta.arenaWins,
      losses: meta.arenaLosses,
      format,
      queued: queuedFmt !== null,
      queueSize,
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
    if (this.trades.has(invite.fromPid) || this.trades.has(r.meta.entityId)) {
      this.error(r.meta.entityId, 'That player is already trading.');
      return;
    }
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
    if (!Number.isFinite(count)) { this.error(meta.entityId, 'Name how many you wish to sell.'); return; }
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

  // Builds the self-only "/stats" readout line from live entity state. The
  // resource clause is dropped for classes whose resourceType is null.
  private statsReadout(meta: PlayerMeta, e: Entity): string {
    const className = CLASSES[meta.cls].name;
    const crit = (e.critChance * 100).toFixed(1);
    let line = `Level ${e.level} ${className} — HP ${Math.round(e.hp)}/${Math.round(e.maxHp)}`;
    if (e.resourceType) {
      const res = e.resourceType.charAt(0).toUpperCase() + e.resourceType.slice(1);
      line += `, ${res} ${Math.round(e.resource)}/${Math.round(e.maxResource)}`;
    }
    line += `. AP ${Math.round(e.attackPower)}, Crit ${crit}%, Armor ${Math.round(e.stats.armor)}.`;
    return line;
  }
  // Self-only readout of carried items for "/bags": items sorted by quality
  // (epic first), ties keeping inventory order, with the purse appended via
  // formatMoney. Reads only PlayerMeta state, so it works online for free.
  private bagsReadout(meta: PlayerMeta): string {
    const purse = `Purse: ${formatMoney(meta.copper)}.`;
    if (meta.inventory.length === 0) return `Your bags are empty. ${purse}`;
    const rank: Record<string, number> = { epic: 0, rare: 1, uncommon: 2, common: 3, poor: 4 };
    const sorted = meta.inventory
      .map((s, i) => ({ s, i }))
      .sort((a, b) => {
        const qa = rank[ITEMS[a.s.itemId]?.quality ?? 'common'] ?? 3;
        const qb = rank[ITEMS[b.s.itemId]?.quality ?? 'common'] ?? 3;
        return qa - qb || a.i - b.i;
      });
    const parts = sorted.map(({ s }) => {
      const name = ITEMS[s.itemId]?.name ?? s.itemId;
      return s.count > 1 ? `${name} x${s.count}` : name;
    });
    return `Bags (${parts.length}): ${parts.join(', ')}. ${purse}`;
  }
  // Self-only readout of the player's party: each member in join order with
  // level, class, and HP% (or (dead)/(offline)), the leader tagged [leader].
  private partyReadout(pid: number): string {
    const party = this.partyOf(pid);
    if (!party) return 'You are not in a party.';
    const parts = party.members.map((mPid) => {
      const meta = this.players.get(mPid);
      const e = this.entities.get(mPid);
      if (!meta || !e) return meta ? `${meta.name} (offline)` : `Player ${mPid} (offline)`;
      const cls = CLASSES[meta.cls].name;
      const state = e.hp <= 0 ? '(dead)' : `${Math.round((e.hp / e.maxHp) * 100)}%`;
      const tag = mPid === party.leader ? ' [leader]' : '';
      return `${meta.name} (Lvl ${e.level} ${cls}, ${state})${tag}`;
    });
    return `Party (${party.members.length}/${PARTY_MAX}): ${parts.join(', ')}.`;
  }
  // Self-only readout for "/zones": lists every overworld zone in travel order
  // (south -> north) with its level range, tagging the zone the player is in.
  // `currentZ` is the player's world Z (use zoneAt(currentZ) to find their zone).
  // ZONES is the ordered ZoneDef[] from ./data; each has .name and
  // .levelRange = [min, max].
  private zonesReadout(currentZ: number): string {
    if (ZONES.length === 0) return 'No zones are defined.';
    const here = zoneAt(currentZ);
    const parts = ZONES.map((z) => {
      const line = `${z.name} (Lvl ${z.levelRange[0]}-${z.levelRange[1]})`;
      return z.id === here.id ? `${line} [you are here]` : line;
    });
    return `Zones (${ZONES.length}): ${parts.join(', ')}.`;
  }
  // Self-only readout of a character's Ashen Coliseum standing. Reads only the
  // persisted PlayerMeta arena fields (no new state). Draws count as neither a
  // win nor a loss (see resolveArena), so "matches played" is wins + losses.
  private arenaReadout(meta: PlayerMeta): string {
    const { arenaRating: rating, arenaWins: wins, arenaLosses: losses } = meta;
    const played = wins + losses;
    if (played <= 0) return `Arena: Rating ${rating} — no matches played yet.`;
    const pct = Math.round((wins / played) * 100);
    return `Arena: Rating ${rating} — ${wins} wins, ${losses} losses (${pct}% win rate).`;
  }
  private buybackReadout(meta: PlayerMeta): string {
    const slots = meta.vendorBuyback.filter((s) => ITEMS[s.itemId] && s.count > 0);
    if (slots.length === 0) return 'Your vendor buyback list is empty.';
    const parts = slots.map((s) => {
      const def = ITEMS[s.itemId];
      const qty = s.count > 1 ? ` x${s.count}` : '';
      return `${def.name}${qty} (${formatMoney(def.sellValue)} each)`;
    });
    return `Vendor buyback (${slots.length}): ${parts.join(', ')}. Repurchase at any merchant.`;
  }
  private comboReadout(e: Entity): string {
    if (e.comboPoints <= 0) return 'You have no combo points built up.';
    const target = e.comboTargetId !== null ? this.entities.get(e.comboTargetId) : undefined;
    const on = target ? ` on ${target.name}` : '';
    return `Combo points: ${e.comboPoints}/5${on}.`;
  }
  // Readout for "/combat": reads only the live Entity.inCombat / combatTimer
  // (no new fields). combatTimer is "time since last combat event"; a player
  // lingers in combat until it reaches COMBAT_LINGER (the literal 5s drop-out
  // window applied in updatePlayers, sim.ts where inCombat is recomputed). If
  // inCombat is still set past that window, an enemy is actively engaged, so no
  // countdown can be promised.
  private combatReadout(e: Entity): string {
    if (!e.inCombat) return 'You are not in combat.';
    const COMBAT_LINGER = 5;
    const remaining = COMBAT_LINGER - e.combatTimer;
    if (remaining > 0) {
      return `You are in combat — leaving in ${Math.ceil(remaining)}s if no further action.`;
    }
    return 'You are in combat (enemies still engaged).';
  }
  // Readout for "/graveyard": names the zone graveyard your spirit returns to
  // if you die here, and its coordinates. Reads only existing zone/dungeon
  // lookups (no new fields) and resolves the same target as releaseSpirit —
  // dying inside a dungeon resurrects you at the graveyard of the zone its door
  // sits in, dying outdoors at your current zone's graveyard.
  private graveyardReadout(p: Entity): string {
    const dungeon = dungeonAt(p.pos.x);
    const zone = zoneAt(dungeon ? dungeon.doorPos.z : p.pos.z);
    const gy = zone.graveyard;
    return `If you fall here, your spirit returns to the ${zone.name} graveyard at (${Math.floor(gy.x)}, ${Math.floor(gy.z)}).`;
  }
  // Readout for "/dungeons": lists every group instance in entrance order with
  // the overworld zone its door sits in and its suggested party size. Reads
  // only the static DUNGEON_LIST (already entrance-sorted by index) and the
  // door zone via zoneAt — no new fields.
  private dungeonsReadout(): string {
    const parts = DUNGEON_LIST.map((d) => `${d.name} (${zoneAt(d.doorPos.z).name}, ${d.suggestedPlayers} players)`);
    return `Dungeons (${parts.length}): ${parts.join(', ')}.`;
  }
  // Readout for "/consider": sizes up the current target's level versus yours.
  // The verdict bands track the real combat model — meleeMissChance (types.ts)
  // applies a sharp miss penalty once the target is 3+ levels above you (its
  // `diff > 2` cliff), and dodge/crit also scale with the level gap — so a
  // target 3+ levels up is flagged as a steep step beyond a merely tough one.
  // Reads only the live target Entity.level versus your own (no new fields).
  private considerReadout(self: Entity): string {
    const t = self.targetId !== null ? this.entities.get(self.targetId) : undefined;
    if (!t) return 'You have no target to consider.';
    const diff = t.level - self.level;
    let verdict: string;
    if (diff >= 5) verdict = 'an overwhelming fight';
    else if (diff >= 3) verdict = 'a daunting fight';
    else if (diff >= 1) verdict = 'a tough fight';
    else if (diff === 0) verdict = 'an even fight';
    else if (diff >= -2) verdict = 'a manageable fight';
    else verdict = 'an easy fight';
    return `${t.name} is level ${t.level} — ${verdict} for you (level ${self.level}).`;
  }
  // Readout for "/pois": the named landmarks of your current zone, nearest
  // first, each with its distance in yards. Reads only the static ZoneDef.pois
  // (the same labels the HUD pins on the map) and your live position — no new
  // fields.
  private poisReadout(self: Entity): string {
    const zone = zoneAt(self.pos.z);
    if (zone.pois.length === 0) return `${zone.name} has no notable landmarks.`;
    const parts = zone.pois
      .map((p) => ({ label: p.label, d: dist2d(self.pos, { x: p.x, y: 0, z: p.z }) }))
      .sort((a, b) => a.d - b.d)
      .map((p) => `${p.label} (${Math.round(p.d)}yd)`);
    return `Landmarks in ${zone.name} (${parts.length}): ${parts.join(', ')}.`;
  }
  // Readout for "/completed": the quests you have turned in, in completion
  // order (questsDone is a Set whose insertion order is preserved on save/load).
  // Reads only PlayerMeta.questsDone + the QUESTS registry for names (no new
  // fields); distinct from /quest, which lists the active log.
  private completedReadout(meta: PlayerMeta): string {
    const names = [...meta.questsDone].map((id) => QUESTS[id]?.name ?? id);
    if (names.length === 0) return 'You have not completed any quests yet.';
    return `Completed quests (${names.length}): ${names.join(', ')}.`;
  }
  // Readout for "/listings": your own active World Market listings (house stock
  // and other sellers excluded), each with item, asking price, and time left
  // before it returns unsold. Reads only the live marketListings, ITEMS names,
  // and this.time (no new fields); the count is shown against MARKET_MAX_LISTINGS
  // so you know how much room you have left, mirroring the cap in marketList.
  private listingsReadout(meta: PlayerMeta): string {
    const mine = this.marketListings.filter((l) => !l.house && l.sellerKey === meta.name);
    if (mine.length === 0) return 'You have no goods on the World Market.';
    const parts = mine.map((l) => {
      const name = ITEMS[l.itemId]?.name ?? l.itemId;
      const qty = l.count > 1 ? ` x${l.count}` : '';
      const secs = Math.max(0, Math.ceil(l.expiresAt - this.time));
      const h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60);
      const left = h > 0 ? `${h}h ${m}m` : m > 0 ? `${m}m` : `${secs}s`;
      return `${name}${qty} — ${formatMoney(l.price)} (${left} left)`;
    });
    return `Your market listings (${parts.length}/${MARKET_MAX_LISTINGS}): ${parts.join(', ')}.`;
  }
  // Self-only readout of the auras on the player's current target, each tagged
  // [buff] or [debuff]. Mirrors the self-aura readout but reaches across to the
  // target's live Entity.auras, so it works for mobs, pets, and other players.
  private targetBuffsReadout(self: Entity): string {
    const target = self.targetId !== null ? this.entities.get(self.targetId) : undefined;
    if (!target || target.hp <= 0) return 'You have no target.';
    const auras = target.auras;
    if (auras.length === 0) return `${target.name} has no active effects.`;
    const parts = auras.map((a) => {
      const stack = (a.stacks ?? 1) > 1 ? ` x${a.stacks}` : '';
      const tag = isHarmfulAura(a.kind) ? 'debuff' : 'buff';
      return `${a.name}${stack} [${tag}] (${Math.ceil(a.remaining)}s)`;
    });
    return `Effects on ${target.name} (${auras.length}): ${parts.join(', ')}.`;
  }
  // Self-only readout of current movement speed as a percent of normal run
  // speed. Effective speed is RUN_SPEED * moveSpeedMult(p), where the
  // multiplier folds slow/stealth auras against speed buffs; a root pins the
  // player regardless of the multiplier, so it is reported first.
  private speedReadout(e: Entity): string {
    if (this.isRooted(e)) return 'You are rooted in place and cannot move.';
    const mult = this.moveSpeedMult(e);
    const pct = Math.round(mult * 100);
    if (pct > 100) return `Movement speed: ${pct}% of normal (hastened).`;
    if (pct < 100) return `Movement speed: ${pct}% of normal (slowed).`;
    return 'Movement speed: 100% of normal.';
  }
  // Self-only readout for /attack: reads only live Entity auto-attack state
  // (autoAttack/swingTimer/targetId). The displayed swing interval reuses the
  // exact expression the engine resets the timer with (weapon.speed *
  // swingIntervalMult), so it reflects any active haste/slow auras.
  private attackReadout(p: Entity, meta: PlayerMeta): string {
    if (!p.autoAttack) return 'Auto-attack is off.';
    const t = p.targetId !== null ? this.entities.get(p.targetId) : null;
    if (!t || t.dead) return 'Auto-attack is on, but you have no valid target.';
    // ranged classes (hunter auto shot, caster wands) swing at their ranged
    // speed; everyone else uses the equipped weapon's speed
    const base = CLASSES[meta.cls].ranged?.speed ?? p.weapon.speed;
    const interval = base * this.swingIntervalMult(p);
    const next = p.swingTimer <= 0 ? 'now' : `in ${p.swingTimer.toFixed(1)}s`;
    return `Auto-attack is on against ${t.name} — next swing ${next} (${interval.toFixed(1)}s swing).`;
  }
  // Overpower is a warrior reactive: an enemy dodging the player's attack opens
  // a 5s window (overpowerUntil = time + 5) in which the ability becomes usable.
  // It is neither an aura nor a normal cooldown, so no other readout exposes it.
  private overpowerReadout(e: Entity, meta: PlayerMeta): string {
    if (meta.cls !== 'warrior') return 'Overpower is a warrior ability; your class cannot use it.';
    const remaining = Math.ceil(e.overpowerUntil - this.time);
    if (remaining > 0) {
      return `Overpower is ready — strike within ${remaining}s (an enemy dodged your attack).`;
    }
    return 'Overpower is not available. It opens for 5s after an enemy dodges your attack.';
  }
  // Reports the active shapeshift form or combat stance. Anchored to the
  // same toggle set the cast path treats as mutually-exclusive persistent
  // states (form_bear / form_cat / defensive_stance / stealth); realistically
  // only one is ever active, so the first match is the answer.
  private formReadout(e: Entity): string {
    const form = e.auras.find((a) =>
      a.kind === 'form_bear' || a.kind === 'form_cat'
      || a.kind === 'defensive_stance' || a.kind === 'stealth');
    if (!form) return 'You are not in any form or stance.';
    if (form.kind === 'stealth') return 'You are stealthed.';
    return `You are in ${form.name}.`;
  }
  // Self-only readout of the five-second-rule mana state (#103 out-of-combat
  // regen). `fiveSecondRule` is the seconds elapsed since the player last spent
  // mana on an ability (reset to 0 at sim.ts cast path, bumped by DT each tick);
  // out-of-combat mana regen only ticks once it reaches FSR_THRESHOLD. Only
  // mana users have meaningful state here — rage/energy classes never spend mana.
  private manaRegenReadout(e: Entity): string {
    const FSR_THRESHOLD = 5; // matches the `fiveSecondRule >= 5` gate in updateRegen
    if (e.resourceType !== 'mana') {
      return 'Mana regeneration does not apply to your class.';
    }
    if (e.fiveSecondRule >= FSR_THRESHOLD) {
      return 'Your mana is regenerating (out of combat for 5s+).';
    }
    const resumesIn = Math.ceil(FSR_THRESHOLD - e.fiveSecondRule);
    return `Mana regen is paused — resumes in ${resumesIn}s (you spent mana recently).`;
  }
  // Self-only readout of vertical/fall state — surfaces the otherwise-invisible
  // jump physics (sim.ts updatePlayerMovement). Reads only live Entity fields and
  // the same groundHeight()/FALL_SAFE_DISTANCE the landing-damage model uses, so
  // the "this will hurt" preview matches what an actual landing would deal.
  private fallingReadout(e: Entity): string {
    const ground = groundHeight(e.pos.x, e.pos.z, this.cfg.seed);
    if (e.onGround) return 'You are on solid ground.';
    const height = Math.max(0, Math.round(e.pos.y - ground));
    if (e.vy > 0) return `You are airborne and rising — ${height}yd above the ground.`;
    const drop = e.fallStartY - ground;
    const danger =
      drop > FALL_SAFE_DISTANCE
        ? ' Brace for impact — this fall is going to hurt.'
        : ' It should be a safe landing.';
    return `You are falling — ${height}yd above the ground.${danger}`;
  }
  // Self-only readout of the controlled pet's Growl (taunt) cooldown. Reads
  // only the live pet Entity's petTauntTimer (the same field updatePet counts
  // down at sim.ts ~2770 and resets to PET_GROWL_INTERVAL after each growl), so
  // it stays truthful without any new state. Distinct from /pet (vitals) and
  // /cooldowns (the player's own ability map, which never holds this timer).
  private petTauntReadout(owner: Entity): string {
    const pet = this.petOf(owner.id);
    if (!pet) return 'You do not have a pet.';
    if (pet.petTauntTimer <= 0) {
      return `Your pet's Growl is ready — it will taunt its target on the next melee swing.`;
    }
    return `Your pet's Growl is on cooldown — ready in ${Math.ceil(pet.petTauntTimer)}s.`;
  }
  // Druid forms park the mana bar in savedMana and run on rage/energy instead
  // (entity.ts:126-130). That parked pool has no in-game UI — the bar shows the
  // form's resource — so this readout is the only way to see what returns on
  // shift-out. Gates on the class's natural resource so non-casters get a clean
  // "never applies" rather than a misleading zero.
  private savedManaReadout(meta: PlayerMeta, e: Entity): string {
    if (CLASSES[meta.cls].resourceType !== 'mana') {
      return 'Only mana-using classes park mana; your class never does.';
    }
    if (e.resourceType === 'mana') {
      return 'Your mana is not parked — you are not shapeshifted.';
    }
    if (e.savedMana <= 0) {
      return 'You have no mana parked while shifted.';
    }
    return `You have ${Math.round(e.savedMana)} mana parked while shifted; it returns when you leave your form.`;
  }

  private error(pid: number, text: string): void {
    this.emit({ type: 'error', text, pid });
  }

  // Lines shown by the "/help" command, one system notice per entry. Keep this
  // in sync with the commands handled in chat() above.
  private helpLines(): string[] {
    return [
      'Chat channels: /s say, /y yell, /general, /p party, /world, /lfg.',
      'Whisper a player with /w <name> <message>, reply with /r.',
      'Other commands: /join <world|lfg>, /roll, /inspect <name>, /follow <name>, /unfollow, /afk, /dnd, /who.',
      'Character readouts: /played, /xp, /gold, /stats, /bags, /gear, /abilities, /buffs, /cooldowns, /quest, /completed.',
      'World readouts: /where, /zones, /nearby, /pois, /graveyard, /dungeons, /arena, /session, /listings, /buyback.',
      'Combat readouts: /target, /targetbuffs, /range, /attack, /casting, /combat, /threat, /consider, /combo, /overpower.',
      'State readouts: /pet, /pettaunt, /speed, /consumable, /potion, /form, /manaregen, /falling, /queued, /savedmana.',
    ];
  }

  // One-line readout for /inspect: another player's level, class, and health.
  private inspectReadout(target: PlayerMeta, e: Entity): string {
    const cls = CLASSES[target.cls]?.name ?? target.cls;
    const hp = e.hp <= 0
      ? 'dead'
      : `${Math.round(Math.max(0, Math.min(1, e.hp / e.maxHp)) * 100)}%`;
    return `${target.name}: Level ${e.level} ${cls} — HP ${hp}.`;
  }

  // A positive, personal chat-log notice (e.g. confirming a /join). Unlike
  // error(), this lands in the chat log rather than flashing the error toast.
  private notice(pid: number, text: string, color = '#ffd100'): void {
    this.emit({ type: 'log', text, color, pid });
  }

  // Handles /join and /leave for the opt-in global channels.
  private handleChannelMembership(meta: PlayerMeta, action: 'join' | 'leave', arg: string): void {
    const pid = meta.entityId;
    if (!arg) {
      this.error(pid, `Usage: /${action} <channel>. Channels: ${JOINABLE_CHANNELS.join(', ')}.`);
      return;
    }
    if (arg === 'general') {
      this.error(pid, 'The General channel is always on - just use /general.');
      return;
    }
    if (!JOINABLE_CHANNELS.includes(arg as JoinableChannel)) {
      this.error(pid, `There is no channel named '${arg}'. Channels: ${JOINABLE_CHANNELS.join(', ')}.`);
      return;
    }
    const channel = arg as JoinableChannel;
    let set = this.channelSubs.get(pid);
    if (action === 'join') {
      if (!set) { set = new Set(); this.channelSubs.set(pid, set); }
      if (set.has(channel)) { this.error(pid, `You are already in the ${channel} channel.`); return; }
      set.add(channel);
      this.notice(pid, `Joined the ${channel} channel. Type /${channel} <message> to talk.`);
    } else {
      if (!set || !set.has(channel)) { this.error(pid, `You are not in the ${channel} channel.`); return; }
      set.delete(channel);
      if (set.size === 0) this.channelSubs.delete(pid);
      this.notice(pid, `Left the ${channel} channel.`);
    }
  }
  // One-line description of an entity for the self-only "/target" readout:
  // name, level, what it is (player / pet / mob), and current health. A dead
  // body reports "dead" instead of a percentage so a lootable corpse reads
  // sensibly.
  private targetReadout(t: Entity): string {
    const kind = t.kind === 'player' ? 'player' : t.ownerId !== null ? 'pet' : 'mob';
    const health = t.dead ? 'dead' : `${Math.round((t.hp / t.maxHp) * 100)}% HP`;
    return `Target: ${t.name} (level ${t.level} ${kind}) — ${health}.`;
  }
  // One-line leveling summary for the /xp readout. At MAX_LEVEL there is no
  // "next level" so we avoid the percent/remaining math (xpForLevel is 0 there).
  private xpReadout(meta: PlayerMeta, level: number): string {
    if (level >= MAX_LEVEL) return `Level ${MAX_LEVEL} — maximum level reached.`;
    const need = xpForLevel(level);
    const have = Math.max(0, Math.min(meta.xp, need));
    const pct = Math.floor((have / need) * 100);
    const fmt = (n: number) => n.toLocaleString('en-US');
    return `Level ${level} — ${fmt(have)}/${fmt(need)} XP (${pct}%), ${fmt(need - have)} to go.`;
  }
  // Render the /gold readout. An empty purse gets flavor text rather than the
  // bare "You have 0c." that formatMoney would otherwise produce.
  private goldReadout(copper: number): string {
    if (copper <= 0) return 'Your purse is empty.';
    return `You have ${formatMoney(copper)}.`;
  }
  // Self-only readout for "/buffs": summarise the auras currently on the
  // entity. Auras carry no buff/debuff flag, only an AuraKind and a `remaining`
  // time in seconds; toggles (stances, forms, stealth) use a 3600s sentinel
  // duration rather than Infinity, so a raw "(3600s)" reads poorly.
  private buffsReadout(e: Entity): string {
    if (e.auras.length === 0) return 'You have no active effects.';
    const parts = e.auras.map((a) => this.auraLabel(a));
    return `Active effects (${e.auras.length}): ${parts.join(', ')}.`;
  }

  // Render one aura for the /buffs list, e.g. "Rend (4s)". `remaining` is a
  // float, so Math.ceil keeps a still-active 0.3s remainder showing as "(1s)".
  private auraLabel(a: Aura): string {
    return `${a.name} (${Math.ceil(a.remaining)}s)`;
  }
  // Self-only readout for "/cooldowns": summarise the abilities currently on
  // cooldown for this entity, soonest-ready first.
  //
  // `e.cooldowns` is a Map<abilityId, remainingSeconds> — entries exist ONLY
  // while an ability is cooling down (updateTimers deletes them at <= 0), so an
  // empty map means everything is ready. Resolve the display name via
  // ABILITIES[id]?.name (fall back to the raw id if an ability is ever missing
  // from the table). `remaining` is a float, so Math.ceil keeps a 0.3s
  // remainder showing as "(1s)", matching how /buffs renders aura timers.
  //
  private cooldownsReadout(e: Entity): string {
    if (e.cooldowns.size === 0) return 'No abilities are on cooldown.';
    const parts = [...e.cooldowns]
      .sort((a, b) => a[1] - b[1])
      .map(([id, remaining]) => `${ABILITIES[id]?.name ?? id} (${Math.ceil(remaining)}s)`);
    return `Abilities on cooldown (${parts.length}): ${parts.join(', ')}.`;
  }
  // Self-only readout of the active quest log: one entry per tracked quest with
  // per-objective progress. questLog only ever holds 'active'/'ready' quests
  // (turn-in deletes the entry), so iterating it gives exactly what to show.
  private questReadout(meta: PlayerMeta): string {
    const lines: string[] = [];
    for (const [qid, qp] of meta.questLog) {
      const quest = QUESTS[qid];
      if (!quest) continue;
      const objs = quest.objectives
        .map((o, i) => `${o.label} ${Math.min(qp.counts[i] ?? 0, o.count)}/${o.count}`)
        .join(', ');
      const tag = qp.state === 'ready' ? ' (ready)' : '';
      lines.push(`${quest.name}${tag} — ${objs}`);
    }
    if (lines.length === 0) return 'Your quest log is empty.';
    return `Quest log (${lines.length}): ${lines.join(' | ')}.`;
  }
  // Self-only readout of equipped items, walked in a fixed slot order so the
  // line is stable and empty slots are visible (the point of a gear check).
  private gearReadout(meta: PlayerMeta): string {
    const slots: [EquipSlot, string][] = [
      ['mainhand', 'Main Hand'],
      ['chest', 'Chest'],
      ['legs', 'Legs'],
      ['feet', 'Feet'],
    ];
    let worn = 0;
    const parts = slots.map(([slot, label]) => {
      const itemId = meta.equipment[slot];
      if (!itemId) return `${label}: (empty)`;
      worn++;
      return `${label}: ${ITEMS[itemId]?.name ?? itemId}`;
    });
    if (worn === 0) return 'You have nothing equipped.';
    return `Equipped (${worn}/${slots.length}): ${parts.join(', ')}.`;
  }
  private abilitiesReadout(meta: PlayerMeta, e: Entity): string {
    const known = abilitiesKnownAt(meta.cls, e.level);
    if (known.length === 0) return 'You have not learned any abilities yet.';
    const list = known.map((k) => `${k.def.name} (Rank ${k.rank})`).join(', ');
    return `Spellbook (${known.length}): ${list}.`;
  }
  // Self-only readout of the player's active pet: name, level, beast family,
  // and current health. Reads live pet state via petOf() so it stays accurate
  // regardless of how the pet was acquired (tame, summon).
  private petReadout(owner: Entity): string {
    const pet = this.petOf(owner.id);
    if (!pet) return 'You do not have a pet.';
    const family = MOBS[pet.templateId]?.family;
    const kind = family ? ` ${family}` : '';
    const pct = pet.maxHp > 0 ? Math.round((pet.hp / pet.maxHp) * 100) : 0;
    return `Your pet: ${pet.name} (level ${pet.level}${kind}) — HP ${pet.hp}/${pet.maxHp} (${pct}%).`;
  }
  // Build the self-only "/session" line from this session's RewardCounters.
  // Counters are reset each boot (freshCounters), so this is always per-session.
  // Format kills/deaths first, then a damage clause, then XP — using
  // toLocaleString('en-US') for thousands separators on the large numbers.
  private sessionReadout(meta: PlayerMeta): string {
    const c = meta.counters;
    const n = (v: number) => v.toLocaleString('en-US');
    const plural = (v: number, word: string) => `${n(v)} ${word}${v === 1 ? '' : 's'}`;
    return `Session: ${plural(c.kills, 'kill')}, ${plural(c.deaths, 'death')}. ` +
      `Damage dealt ${n(c.damageDealt)}, taken ${n(c.damageTaken)}. ` +
      `XP gained ${n(c.xpGained)}.`;
  }
  /** Self-only readout of the threat table on the player's current target,
   *  highest first, as a percentage of the current threat leader. */
  private threatReadout(self: Entity): string {
    const t = self.targetId !== null ? this.entities.get(self.targetId) : undefined;
    if (!t || t.hp <= 0) return 'You have no target.';
    if (t.kind !== 'mob') return `Threat is only tracked on enemies; ${t.name} is not one.`;
    const entries = threatEntries(t, 10);
    if (entries.length === 0) return `Nobody has any threat on ${t.name}.`;
    const top = entries[0][1] || 1;
    const parts = entries.map(([id, v], i) => {
      const pct = Math.round((v / top) * 100);
      const you = id === self.id ? ' (you)' : '';
      const lead = i === 0 ? ' [leader]' : '';
      return `${this.threatName(id)}${you} ${pct}%${lead}`;
    });
    return `Threat on ${t.name} (${entries.length}): ${parts.join(', ')}.`;
  }

  /** Display name for a threat-table source: a player by pid, else the entity
   *  (pet/mob) name, else a placeholder for sources that have despawned. */
  private threatName(id: number): string {
    const meta = this.players.get(id);
    if (meta) return meta.name;
    return this.entities.get(id)?.name || 'Unknown';
  }
  // One scannable entry per nearby entity: name, what it is, and how far.
  // Pets are mobs with a non-null ownerId; players have no level prefix.
  private nearbyLabel(e: Entity, d: number): string {
    const yd = `${Math.round(d)}yd`;
    if (e.kind === 'player') return `${e.name} (player, ${yd})`;
    const kind = e.kind === 'mob' && e.ownerId !== null ? 'pet' : e.kind;
    return `${e.name} (Lvl ${e.level} ${kind}, ${yd})`;
  }

  // Self-only readout of living entities within NEARBY_RANGE of `self`,
  // nearest first. Reads only live Entity state (pos/kind/level/hp), so it
  // never desyncs and adds no persisted fields.
  private nearbyReadout(self: Entity): string {
    const found: { e: Entity; d: number }[] = [];
    for (const e of this.entities.values()) {
      if (e.id === self.id || e.kind === 'object' || e.hp <= 0) continue;
      const d = dist2d(self.pos, e.pos);
      if (d <= NEARBY_RANGE) found.push({ e, d });
    }
    if (found.length === 0) return 'Nothing is nearby.';
    found.sort((a, b) => a.d - b.d);
    const shown = found.slice(0, NEARBY_MAX);
    const labels = shown.map(({ e, d }) => this.nearbyLabel(e, d));
    const more = found.length - shown.length;
    if (more > 0) labels.push(`(+${more} more)`);
    return `Nearby (${found.length}): ${labels.join(', ')}.`;
  }
  // Distance from the player to their current target. Reads only live Entity
  // state (targetId + positions), so it needs no new fields and works online
  // for free. The in-melee hint compares the RAW distance to MELEE_RANGE — the
  // same threshold the swing-resolution code uses — while the displayed yards
  // are rounded, so the hint stays truthful even when rounding lands on 5yd.
  private rangeReadout(self: Entity): string {
    if (self.targetId === null) return 'You have no target.';
    const t = this.entities.get(self.targetId);
    if (!t) return 'You have no target.';
    const d = dist2d(self.pos, t.pos);
    const reach = d <= MELEE_RANGE ? 'in melee range' : 'out of melee range';
    return `Your target ${t.name} is ${Math.round(d)}yd away (${reach}).`;
  }
  // Reads the live cast-bar state (no stored fields): castingAbility holds an
  // ability id or the FISHING_CAST_ID sentinel, channeling distinguishes a
  // channel from a normal cast. Times are fractional seconds, so toFixed(1)
  // stays truthful rather than rounding a 2.5s cast to "3s".
  private castingReadout(e: Entity): string {
    if (!e.castingAbility) return 'You are not casting anything.';
    const remaining = e.castRemaining.toFixed(1);
    const total = e.castTotal.toFixed(1);
    if (e.castingAbility === FISHING_CAST_ID) {
      return `You are fishing — ${remaining}s of ${total}s remaining.`;
    }
    const name = ABILITIES[e.castingAbility]?.name ?? e.castingAbility;
    const verb = e.channeling ? 'Channeling' : 'Casting';
    return `${verb} ${name} — ${remaining}s of ${total}s remaining.`;
  }
  // Self-only readout of what the player is currently eating/drinking. Food and
  // drink occupy separate slots and tick concurrently, each on its own remaining
  // timer, so both are reported with their own restore rate and time left.
  private consumableReadout(e: Entity): string {
    const parts: string[] = [];
    for (const c of [e.eating, e.drinking]) {
      if (!c) continue;
      const name = ITEMS[c.itemId]?.name ?? c.itemId;
      const restores: string[] = [];
      if (c.hpPer2s > 0) restores.push(`+${c.hpPer2s} HP/2s`);
      if (c.manaPer2s > 0) restores.push(`+${c.manaPer2s} mana/2s`);
      restores.push(`${Math.ceil(c.remaining)}s left`);
      const verb = c.kind === 'food' ? 'eating' : 'drinking';
      parts.push(`${verb} ${name} (${restores.join(', ')})`);
    }
    if (parts.length === 0) return 'You are not eating or drinking.';
    return `You are ${parts.join(' and ')}.`;
  }
  // Self-only readout of the shared combat-potion cooldown (#103). Distinct from
  // /cooldowns, which reads the per-ability Entity.cooldowns map and never shows
  // this separate 60s potion timer. potionCooldownUntil is an absolute sim-time
  // deadline, so the remaining time is computed against this.time.
  private potionReadout(e: Entity): string {
    const remaining = e.potionCooldownUntil - this.time;
    if (remaining <= 0) return 'Combat potion is ready to use.';
    return `Combat potion on cooldown — ready in ${Math.ceil(remaining)}s.`;
  }
  // Self-only readout of the ability armed to fire on the next melee swing
  // (Heroic Strike / Raptor Strike / Maul). Distinct from /casting (active
  // cast bar) and /cooldowns (recharge timers): an on-swing ability is neither
  // casting nor on cooldown, just waiting for the swing — and it silently
  // fizzles if the resource can't be paid when the swing lands (see swing
  // resolution), so the readout flags that case up front.
  private queuedReadout(e: Entity): string {
    if (!e.queuedOnSwing) return 'You have no ability queued for your next swing.';
    const queued = this.resolvedAbility(e.queuedOnSwing, e.id);
    const name = queued?.def.name ?? e.queuedOnSwing;
    if (!queued) return `${name} is queued for your next melee swing.`;
    const res = e.resourceType ?? 'resource';
    const have = Math.floor(e.resource);
    if (e.resource >= queued.cost) {
      return `${name} is queued for your next melee swing (costs ${queued.cost} ${res}; you have ${have}).`;
    }
    return `${name} is queued for your next melee swing, but you cannot afford it (costs ${queued.cost} ${res}; you have ${have}) — it will fizzle.`;
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
