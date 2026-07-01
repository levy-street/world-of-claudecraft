import type { WebSocket } from 'ws';
import { createBotDetector } from '#bot-detector';
import { verifyChallenge } from '../src/sim/client_challenge';
import { MECH_CHROMAS, mechChromaItemId, mechChromaSkinIndex } from '../src/sim/content/skins';
import type { TalentAllocation } from '../src/sim/content/talents';
import {
  DELVES,
  DUNGEON_X_THRESHOLD,
  DUNGEONS,
  delveAt,
  dungeonAt,
  isDelvePos,
  zoneAt,
} from '../src/sim/data';
import { devTierIndexForMergedPrs } from '../src/sim/dev_tier';
import { parseRelayCommand } from '../src/sim/discord_relay';
import type { PickAction } from '../src/sim/lockpick';
import { sanitizeMarketQuery } from '../src/sim/market_query';
import { parseMoveInputFrame } from '../src/sim/move_input';
import type { PetState, PlayerMeta } from '../src/sim/sim';
import { MAX_CHAT_MESSAGE_LEN, Sim } from '../src/sim/sim';
import { stealthDetectionRadius, threatEntries } from '../src/sim/threat';
import {
  DT,
  dist2d,
  type Entity,
  EQUIP_SLOTS,
  type EquipSlot,
  emptyMoveInput,
  MAX_LEVEL,
  RUN_SPEED,
  type SimEvent,
} from '../src/sim/types';
import { type CommandName, isOverheadEmoteId } from '../src/world_api';
import { recordOnlineSample } from './admin_db';
import { offensiveName } from './auth';
import type {
  BotDetector,
  BotTrackingContext,
  SessionRuntimeSnapshot,
  SuspiciousPlayer,
} from './bot_detector/contract';
import { ChatFilter } from './chat_filter';
import { applyChatStrike, loadChatFilterState, recordChatViolation } from './chat_filter_db';
import { ChatLogger } from './chat_log';
import type { AccountChatMuteStatus, AccountCosmetics, RequestMetadata } from './db';
import {
  closePlaySession,
  grantAccountMechChroma,
  insertChatLogs,
  loadMarketState,
  markAccountQuestComplete,
  openPlaySession,
  pool,
  revokeAccountMechChroma,
  saveCharacterAndMarketState,
  saveCharacterState,
  saveMarketState,
  walletForAccount,
} from './db';
import { enqueueActivity } from './discord_activity';
import { discordFlairForAccount, grantRewardPoints } from './discord_db';
import { enqueueRelay } from './discord_relay';
import { formatDuration } from './duration';
import { mergedPrsForLogin } from './github_contributors';
import { githubForAccount } from './github_db';
import { forEachGuarded, runGuarded } from './guarded_iter';
import { IpBlockList } from './ip_block';
import { loadActiveBlockedIps } from './ip_block_db';
import { type LiveSharedIp, sharedIpsFromLiveSessions } from './live_shared_ips';
import {
  forceCharacterRename,
  moderateAccount,
  muteAccountChat,
  recordInGameAction,
} from './moderation_db';
import { type ModerationHost, ModerationService } from './moderation_service';
import { nextRaidResetMs } from './raid_reset';
import { REALM, REALM_PUBLIC_ORIGIN, REALM_RESET_TIME_ZONE } from './realm';
import { createSerialWriter } from './serial_writer';
import type { Presence, PresenceStatus, SocialActor, SocialTransport } from './social';
import { SocialService } from './social';
import { PgSocialDb } from './social_db';
import { TickProfiler } from './tick_profiler';
import { holderInfoForPubkey } from './woc_balance';
import { isBackpressureExceeded } from './ws_backpressure';

const WORLD_SEED = 20061;
const ALDRIC_METEOR_QUEST_ID = 'q_aldrics_fallen_star';
// Interest management: the client renders entities out to 80yd, so new
// entities enter interest just past that, and known entities persist a
// little farther so the boundary doesn't churn create/destroy cycles.
const INTEREST_RADIUS = 90;
const INTEREST_DROP_RADIUS = 100;
// Stationary quest/vendor npcs anchor map markers, so they keep the legacy
// radius; once known they cost a handful of bytes per snapshot anyway.
const NPC_INTEREST_RADIUS = 120;
const NPC_DROP_RADIUS = 130;
// the widest radius any entity kind can be relevant at
const INTEREST_QUERY_RADIUS = NPC_DROP_RADIUS;
// Distance-tiered update rates: full snapshot rate inside nameplate range
// (55yd, beyond every ability range), half rate out to the 80yd draw range,
// quarter rate beyond. The viewer's target and anything attacking the
// viewer always update at full rate regardless of distance.
const FULL_RATE_RADIUS_SQ = 55 * 55;
const HALF_RATE_RADIUS_SQ = 80 * 80;
const HALF_RATE_DIVISOR = 2;
const QUARTER_RATE_DIVISOR = 4;
// cached wire fragments of despawned entities are swept once a minute
const WIRE_CACHE_SWEEP_TICKS = 1200;
const EVENT_RADIUS = 90;
const SPECTATE_LIMBO_X = -10_000;
const SPECTATE_LIMBO_Z = -10_000;
const AUTOSAVE_SECONDS = 30;
const SAVE_CONCURRENCY = 4;
// Valid lockpicking action enums accepted from the client (anti-cheat: reject
// anything else before it reaches the Sim).
const LOCKPICK_ACTIONS = new Set<PickAction>(['hardSet', 'set', 'steady', 'ease', 'drop', 'abort']);
const LEAVE_SAVE_MAX_ATTEMPTS = 5;
const LEAVE_SAVE_RETRY_BASE_MS = 250;
const LEAVE_SAVE_RETRY_MAX_MS = 4000;
const CHAT_RATE_BURST = 5;
const CHAT_RATE_REFILL_PER_SECOND = 1 / 3; // sustained 20 messages/minute
const CHAT_RATE_ERROR_COOLDOWN_SECONDS = 4;
const CHAT_COOLDOWN_SECONDS = 20;
const CHAT_RATE_VIOLATIONS_FOR_COOLDOWN = 3;
const WHO_RESULT_LIMIT = 50;
const MAX_ACTIVE_SESSIONS_PER_ACCOUNT = 2;
const RESTART_COUNTDOWN_TOTAL_SECONDS = 600;
const RESTART_COUNTDOWN_STEPS = [
  { atSeconds: 0, text: 'Server restart in 10 minutes.' },
  { atSeconds: 300, text: 'Server restart in 5 minutes.' },
  { atSeconds: 480, text: 'Server restart in 2 minutes.' },
  { atSeconds: 540, text: 'Server restart in 1 minute.' },
  { atSeconds: 570, text: 'Server restart in 30 seconds.' },
  { atSeconds: 590, text: 'Server restart in 10 seconds.' },
  { atSeconds: 600, text: 'Server restarting now.' },
] as const;
const ANTIBOT_ENFORCE = process.env.ANTIBOT_ENFORCE === '1';
// Clients stream movement intent every 50ms. If that stream goes silent while
// the last packet held a key down, stop applying it instead of turning/running
// forever. 750ms leaves room for normal jitter and short browser stalls.
const STALE_INPUT_SECONDS = 0.75;
// Exponential moving average weight for the per-tick duration stat.
const TICK_EMA_ALPHA = 0.05;
const ARENA_WIRE_HZ = 0.1;
const ARENA_WIRE_INTERVAL_TICKS = Math.max(1, Math.round(1 / (DT * ARENA_WIRE_HZ)));

type ClientMessage = Record<string, unknown> & {
  ability?: string;
  action?: string;
  alloc?: unknown;
  ante?: number;
  augment?: string;
  bar?: unknown;
  catalog?: string;
  choice?: 'need' | 'greed' | 'pass';
  chroma?: string;
  cmd?: string;
  companionId?: string;
  count?: number;
  copper?: number;
  delveId?: string;
  dungeon?: string;
  emote?: unknown;
  enabled?: boolean;
  facing?: unknown;
  format?: string;
  from?: number;
  group?: number;
  id?: number;
  index?: number;
  item?: string;
  itemId?: string;
  level?: number;
  marker?: number;
  mi?: unknown;
  mode?: string;
  n?: string;
  name?: string;
  npc?: number;
  objectId?: number;
  price?: number;
  q?: string;
  quest?: string;
  r?: string;
  rollId?: number;
  seq?: number;
  sid?: string;
  sig?: string;
  skin?: number;
  slot?: number | string;
  spec?: string;
  t?: string;
  text?: string;
  tierId?: string;
  x?: number;
  z?: number;
};

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function numberRecord(value: unknown): Record<string, number> {
  const source = recordValue(value);
  if (!source) return {};
  const out: Record<string, number> = {};
  for (const [key, raw] of Object.entries(source)) {
    if (typeof raw === 'number') out[key] = raw;
  }
  return out;
}

function stringRecord(value: unknown): Record<string, string> {
  const source = recordValue(value);
  if (!source) return {};
  const out: Record<string, string> = {};
  for (const [key, raw] of Object.entries(source)) {
    if (typeof raw === 'string') out[key] = raw;
  }
  return out;
}

function talentAllocationFromWire(value: unknown): TalentAllocation | null {
  const source = recordValue(value);
  if (!source) return null;
  return {
    spec: typeof source.spec === 'string' ? source.spec : null,
    ranks: numberRecord(source.ranks),
    choices: stringRecord(source.choices),
  };
}

function isPickAction(value: unknown): value is PickAction {
  return typeof value === 'string' && LOCKPICK_ACTIONS.has(value as PickAction);
}

// Heavy, rarely-changing self fields (inventory, equipment, stats, talents,
// quests, milestones, cosmetics) are re-serialized into a snapshot only when a
// command or sim event that can change them lands for that session, or on a
// per-session staggered safety refresh. Without this the 20 Hz loop re-stringifies
// these large, usually-identical structures (and allocates throwaway arrays for
// each) for every player every tick, the dominant avoidable broadcast cost, and
// a steady source of GC pressure, when a crowd gathers. The small/dynamic fields
// (position, resource, target, party HP, cooldowns, ...) still diff every tick.
const HEAVY_SELF_REFRESH_TICKS = 40; // ~2 s backstop; staggered per session so refreshes don't synchronize into a spike
const HEAVY_SELF_CMDS = new Set<string>([
  'equip',
  'unequip_item',
  'use',
  'discard',
  'buy',
  'sell',
  'buyback',
  'loot',
  'pickup',
  'interact',
  'accept',
  'turnin',
  'abandon',
  'applyTalents',
  'respec',
  'setSpec',
  'saveLoadout',
  'switchLoadout',
  'deleteLoadout',
  'change_skin',
  'unequip_mech_chroma',
  'claim_event_skin',
  'prestige',
  'market_list',
  'market_buy',
  'market_cancel',
  'market_collect',
  'pet_feed',
  'dev_give',
  'dev_level',
]);
const HEAVY_SELF_EVENTS = new Set<string>([
  'loot',
  'levelup',
  'virtualLevelUp',
  'milestoneUnlocked',
  'questAccepted',
  'questProgress',
  'questReady',
  'questDone',
  'learnAbility',
  'mechChroma',
  'skinEvent',
  'skinSelect',
  'tradeDone',
  'vendor',
  'tamePet',
  'summonPet',
  'dismissPet',
  'summonDemon',
]);

// How often to re-broadcast online players' $WOC holder-tier flair. Each wallet
// read is served from the woc_balance.ts cache (CACHE_TTL_MS), which is the real
// freshness floor; keeping this loop at/under that TTL means a token change shows
// on the in-world badge within ~one cache window of it landing on chain.
const HOLDER_TIER_REFRESH_MS = 60_000;
// Reward points for in-game playtime: a grant every PLAYTIME_GRANT_MS to each
// online account that was active (gave input) since the last grant. Ties points
// to real engagement, not idling. Discord activity grants the rest (bot-driven).
const PLAYTIME_GRANT_MS = 5 * 60_000;
const PLAYTIME_POINTS = 10;
const RELAY_COOLDOWN_MS = 8_000; // min gap between a player's "!" community posts
const ADMIN_LOCATION_POI_RADIUS = 32;

export interface ClientSession {
  ws: WebSocket;
  accountId: number;
  accountCosmetics: AccountCosmetics;
  characterId: number;
  pid: number; // player entity id in the sim
  name: string;
  lastSave: number;
  alive: boolean;
  joinedAt: number;
  dbSessionId: number | null; // play_sessions row, set once the insert lands
  left: boolean; // set in leave(); guards against the open-session insert landing after disconnect
  chatTokens: number;
  chatLastRefill: number;
  chatLastRateError: number;
  chatRateViolations: number;
  chatCooldownUntil: number;
  chatMutedUntil: number | null;
  chatMuteReason: string;
  // Hard-word enforcement strike count driving the mute ladder. Account-scoped:
  // seeded from the DB at join, kept live by enforcement/admin actions.
  chatStrikes: number;
  // character ids this player has ignored; chat from them is dropped before
  // delivery. Loaded from the DB on join, kept in sync by social commands.
  blockedIds: Set<number>;
  blockListLoaded: boolean;
  // name of the last player to whisper this session, for the /r reply
  lastWhisperFrom: string | null;
  // last explicit channel this player sent to; plain text follows it.
  rememberedChat: RememberedChat;
  // last client input sequence processed; echoed in snapshots for latency telemetry
  lastInputSeq: number;
  // sim time of the last movement input frame, used to clear stale held input
  lastInputAt: number;
  // serialized form of each delta self field as last sent to this client;
  // a field is omitted from a snapshot while its serialization is unchanged
  lastSent: Record<string, string>;
  // arena readout is reconciled at UI cadence instead of snapshot cadence
  lastArenaWireTick: number;
  // set when a command or sim event that can change a heavy self field (bags,
  // gear, quests, talents, stats, ...) lands for this session, so the next
  // snapshot re-diffs those fields. Otherwise they're skipped (see
  // HEAVY_SELF_* and selfWireJson). Starts true so the first snapshot is full.
  selfHeavyDirty: boolean;
  // last PlayerMeta.wireRev serialized for this session. The sim bumps wireRev
  // on any inventory change (however triggered, including paths that emit no
  // routed event), so this is the authoritative dirty signal for bags + derived
  // quest state; -1 forces the first snapshot to send them.
  lastWireRev: number;
  // wire versions of each entity this client knows about: known entities
  // get identity-less "lite" records, unchanged ones ride in the keep list
  sentEnts: Map<number, SentEntityVersions>;
  // character ids of this player's friends + guild members, captured from the
  // last social snapshot. Drives the cheap periodic position push (no DB) that
  // keeps allies live on the world map.
  socialTrackedIds?: number[];
  // IP address at join time (from requestMetadata); used for per-IP session counting.
  ip: string;
  isAdmin: boolean;
  // Seed the client sends at auth; signs its challenge answers.
  clientSeed: string;
  // Behavioral bot-detection state. Ephemeral — reset on every join.
  botTrackingContext: BotTrackingContext;
  spectating: {
    characterId: number;
    name: string;
    savedPos: { x: number; y: number; z: number };
    priorGm: boolean;
    stowedPet: PetState | null;
  } | null;
}

interface SentEntityVersions {
  idVer: number;
  dynVer: number;
  // sim tick of the last full/lite record, so distance-tiered rates hold
  // even when one broadcast covers several catch-up sim ticks
  sentAtTick: number;
  // an entity whose state stopped changing gets one final "settle" record
  // before riding the keep list — without it the client's extrapolation
  // would leave it rendered slightly past where it actually stopped
  settled: boolean;
}

export interface AdminServerStats {
  online: number;
  onlineAccounts: number;
  peakOnline: number;
  uptimeSeconds: number;
  tickMsAvg: number;
  simEntities: number;
  rssBytes: number;
  heapUsedBytes: number;
}

export interface AdminLiveAura {
  id: string;
  name: string;
  kind: string;
  value: number;
  remaining: number;
  duration: number;
}

export interface AdminLiveLocation {
  kind: 'overworld' | 'dungeon' | 'delve';
  zoneId: string | null;
  zone: string;
  instanceId: string | null;
  instance: string | null;
  instanceSlot: number | null;
  poiIndex: number | null;
  poi: string | null;
  poiDistance: number | null;
}

export interface AdminLivePlayer {
  pid: number;
  accountId: number;
  characterId: number;
  name: string;
  class: string;
  level: number;
  hp: number;
  maxHp: number;
  x: number;
  z: number;
  zone: string;
  location: AdminLiveLocation;
  sessionSeconds: number;
  lastSaveSecondsAgo: number;
  moveSpeedMultiplier: number;
  runSpeed: number;
  swimming: boolean;
  auras: AdminLiveAura[];
}

export interface RestartCountdownStatus {
  started: boolean;
  active: boolean;
  totalSeconds: number;
  remainingSeconds: number;
}

interface WireAura {
  id: string;
  name: string;
  kind: string;
  rem: number;
  dur: number;
  // The aura's magnitude, so buff/debuff hover tooltips show the REAL numbers online, exactly
  // as offline (the descriptor in src/ui/aura_effect.ts reads value per kind: flat stat amount,
  // slow/haste multiplier, dot/hot per-tick, absorb remaining, ...). Sent RAW (like `dur`, not
  // round2) so the exact number and its sign survive JSON: round2 could turn a tiny negative
  // into -0 -> 0 and flip a stat-sap's isAuraDebuff classification. Omitted only when exactly 0,
  // which decodes back to 0, so value-less auras and an old server are unchanged.
  value?: number;
  // imbue judgement min/max bonus-damage range (aura_effect imbueRange); only imbue sets these.
  value2?: number;
  value3?: number;
  // dot/hot tick cadence in seconds, so the tooltip's "every N sec" is right online.
  tickInterval?: number;
  // damage/heal school for dot/absorb/thorns tooltips. Physical is the client's decode default,
  // so only a non-physical school needs to ride the wire.
  school?: string;
  stacks?: number;
  // Remaining charges on a charge-limited aura (Lightning Shield's reflect count). Sent only
  // when defined, so ordinary auras stay off the wire and decode to undefined as before; the
  // client badge prefers this over stacks (auras_view). A pure cosmetic count, not actionable
  // information a graphics preset could hide, so it rides the wire unconditionally when present.
  charges?: number;
}

interface WhoRosterRow {
  name: string;
  cls: string;
  level: number;
  zone: string;
  status: PresenceStatus;
}

type RememberedChat =
  | { channel: 'say' | 'yell' | 'general' | 'party' | 'guild' | 'officer' | 'world' | 'lfg' }
  | { channel: 'whisper'; target: string };

// Identity fields rarely change, so they ride only in "full" records: on an
// entity's first snapshot for a session and again whenever one of them
// changes. The client treats their absence in a record as "unchanged".
function identityFields(e: Entity): Record<string, unknown> {
  const out: Record<string, unknown> = { k: e.kind, tid: e.templateId, nm: e.name, lv: e.level };
  if (e.skinCatalog === 'mech') out.cat = 'mech';
  if (e.skin) out.sk = e.skin;
  if (e.mainhandItemId) out.mh = e.mainhandItemId; // equipped mainhand → held weapon model (render-only)
  // Full worn set, for the inspect-another-player window. Players only and only
  // when something is equipped; rides the identity record (first appearance +
  // on change), never the per-tick dynamic fields. Render-only, like `mh`.
  if (e.kind === 'player') {
    const eq = e.equippedItems;
    for (const _ in eq) {
      out.eq = eq;
      break;
    }
  }
  if (e.holderTier) out.ht = e.holderTier; // $WOC holder-tier flair (cosmetic)
  if (e.holderBalance) out.hb = Math.round(e.holderBalance); // exact $WOC, for inspect
  if (e.discordTier) out.dt = e.discordTier; // Discord status-tier flair (cosmetic)
  if (e.discordAvatar) out.dav = e.discordAvatar; // Discord PFP (linked indicator)
  if (e.discordName) out.dnm = e.discordName; // Discord handle / nickname (nameplate)
  if (e.discordJoined) out.dj = e.discordJoined; // Discord join epoch ms (member since)
  if (e.discordRole) out.dr = e.discordRole; // top staff/special role key (name color + tag)
  if (e.devTier) out.dvt = e.devTier; // developer-badge tier (cosmetic)
  if (e.devMergedPrs) out.dvc = e.devMergedPrs; // merged-PR count, for inspect/card
  if (e.githubLogin) out.dgl = e.githubLogin; // GitHub login (inspect readout + profile link)
  if (e.guild) out.gd = e.guild;
  if (e.dungeonId) out.dgn = e.dungeonId;
  if (e.objectItemId) out.obj = e.objectItemId;
  if (e.scale !== 1) out.sc = e.scale;
  if (e.color !== 0xffffff) out.c = e.color;
  return out;
}

// Dynamic fields are re-sent whole in every full or lite record, so the
// conditional ones keep their absent-means-unset semantics.
function dynamicFields(e: Entity): Record<string, unknown> {
  const out: Record<string, unknown> = {
    x: round2(e.pos.x),
    y: round2(e.pos.y),
    z: round2(e.pos.z),
    f: round2(e.facing),
    hp: e.hp,
    mhp: e.maxHp,
  };
  if (e.dead) out.dead = 1;
  if (e.lootable) out.loot = 1;
  if (e.hostile) out.h = 1;
  if (e.castingAbility) {
    out.cast = e.castingAbility;
    out.castRem = round2(e.castRemaining);
    out.castTot = round2(e.castTotal);
    if (e.channeling) out.chan = 1;
  }
  if (e.sitting || e.eating || e.drinking) out.sit = 1;
  if (e.aggroTargetId !== null) out.aggro = e.aggroTargetId;
  if (e.tappedById !== null) out.tap = e.tappedById;
  if (e.ownerId !== null) out.own = e.ownerId;
  if (e.overheadEmoteId) {
    out.emo = e.overheadEmoteId;
    out.emoSeq = e.overheadEmoteSeq;
  }
  if (e.ownerId !== null) {
    out.pm = e.petMode;
    out.pt = round2(e.petTauntTimer);
    if (e.petAutoTaunt) out.pa = 1;
  }
  if (e.rangedPower) out.rp = e.rangedPower;
  // top hate-table entries so the party threat meter shows real numbers
  if (e.kind === 'mob' && !e.dead && e.threat.size > 0) out.thr = threatEntries(e, 8);
  if (e.auras.length > 0) {
    out.auras = e.auras.map(
      (a): WireAura => ({
        id: a.id,
        name: a.name,
        kind: a.kind,
        rem: round2(a.remaining),
        dur: a.duration,
        // Carry the aura's magnitude so buff/debuff hover tooltips show the real numbers online,
        // not 0 (the descriptor in src/ui/aura_effect.ts reads value per kind). Sent RAW (like
        // `dur`, not round2) so the exact number and its sign survive JSON, keeping a negative
        // stat-sap's isAuraDebuff classification intact (round2 could turn a tiny negative into
        // -0 -> 0). Omitted only when exactly 0, which decodes back to 0, so value-less auras and
        // an old server are unchanged. A hover tooltip magnitude is non-actionable cosmetic text,
        // so sending it cannot let a graphics preset hide anything (graphics-settings fairness).
        ...(a.value !== 0 ? { value: a.value } : {}),
        // imbue judgement min/max range; dot/hot tick cadence; non-physical school. Each rides
        // only when it carries meaning, so ordinary auras stay lean and decode to their defaults.
        ...(a.value2 !== undefined ? { value2: a.value2 } : {}),
        ...(a.value3 !== undefined ? { value3: a.value3 } : {}),
        ...(a.tickInterval !== undefined ? { tickInterval: a.tickInterval } : {}),
        ...(a.school !== 'physical' ? { school: a.school } : {}),
        ...(a.stacks && a.stacks > 1 ? { stacks: a.stacks } : {}),
        // Carry the remaining charges only for a charge-limited aura (Lightning Shield), so the
        // buff icon can badge the count online exactly as offline; undefined for every other aura.
        ...(a.charges !== undefined ? { charges: a.charges } : {}),
      }),
    );
  }
  if (e.kind === 'mob' && e.lootable && e.loot) {
    out.lootList = { copper: e.loot.copper, items: e.loot.items };
  }
  return out;
}

export function wireEntity(e: Entity): Record<string, unknown> {
  return { id: e.id, ...identityFields(e), ...dynamicFields(e) };
}

// npcs stay visible to the legacy radius (see the constants above);
// everything else enters at INTEREST_RADIUS and known entities persist to
// the drop radius — hysteresis against churn at the boundary
function interestLimitSq(e: Entity, known: boolean): number {
  if (e.kind === 'npc') {
    return known ? NPC_DROP_RADIUS * NPC_DROP_RADIUS : NPC_INTEREST_RADIUS * NPC_INTEREST_RADIUS;
  }
  return known ? INTEREST_DROP_RADIUS * INTEREST_DROP_RADIUS : INTEREST_RADIUS * INTEREST_RADIUS;
}

function isStealthed(e: Entity): boolean {
  return e.stealthed; // cached in the sim's updateAuras; see Entity.stealthed
}

// full rate close up and for anything the viewer is fighting; mid range
// updates every other tick, far entities every fourth. Measured against
// the per-session last-sent tick rather than a tick-parity stagger: when
// the event loop degrades and one broadcast covers several sim ticks, a
// parity check can stay permanently false and starve entities frozen
function isUpdateDue(
  tick: number,
  e: Entity,
  d2: number,
  viewer: Entity,
  sentAtTick: number,
): boolean {
  if (d2 <= FULL_RATE_RADIUS_SQ) return true;
  if (viewer.targetId === e.id || e.aggroTargetId === viewer.id) return true;
  const divisor = d2 <= HALF_RATE_RADIUS_SQ ? HALF_RATE_DIVISOR : QUARTER_RATE_DIVISOR;
  return tick - sentAtTick >= divisor;
}

// Per-entity wire fragments, refreshed lazily at most once per tick and
// shared by every recipient. The version counters bump only when the
// serialized form actually changes, making per-session diffing O(1).
interface EntityWireCache {
  tick: number;
  idJson: string;
  dynJson: string;
  idVer: number;
  dynVer: number;
  fullJson: string;
  liteJson: string;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

function logSocialErr(err: unknown): void {
  console.error('social command failed:', err);
}

// Best-effort channel label for the violation log: the hard-word gate runs
// before the message is routed, so infer the channel from its command prefix
// (falling back to the player's last-used channel).
function chatChannelHint(session: ClientSession, text: string): string {
  if (/^\/(?:g|gu|guild)\s/i.test(text)) return 'guild';
  if (/^\/(?:o|officer)\s/i.test(text)) return 'officer';
  if (/^\/(?:w|whisper|t|tell|r|reply)\s/i.test(text)) return 'whisper';
  if (/^\/(?:y|yell)\s/i.test(text)) return 'yell';
  if (/^\/(?:p|party)\s/i.test(text)) return 'party';
  if (/^\/(?:general|world)\s/i.test(text)) return 'general';
  if (/^\/(?:s|say)\s/i.test(text)) return 'say';
  return session.rememberedChat.channel;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class GameServer {
  sim: Sim;
  clients = new Map<number, ClientSession>(); // by pid
  private readonly sessionsByCharacterId = new Map<number, ClientSession>();
  private readonly accountCosmeticsByAccount = new Map<number, AccountCosmetics>();
  private readonly botDetector: BotDetector = createBotDetector();
  readonly chatLog = new ChatLogger(insertChatLogs);
  // Admin-managed soft/hard word lists + escalation config. Loaded from the DB
  // at boot (loadChatFilter) and refreshed whenever an admin edits the lists.
  readonly chatFilter = new ChatFilter();
  private readonly ipBlockList = new IpBlockList();
  private readonly socialDb = new PgSocialDb(pool);
  readonly social: SocialService;
  private readonly moderation: ModerationService<ClientSession>;
  private wireCache = new Map<number, EntityWireCache>();
  private lastWireSweepTick = 0;
  private interval: NodeJS.Timeout | null = null;
  private holderTierInterval: NodeJS.Timeout | null = null;
  private holderTierRefreshing = false; // overlap guard for the refresh cycle
  private playtimeInterval: NodeJS.Timeout | null = null;
  private lastPlaytimeGrantAt = new Map<number, number>(); // accountId -> sim time of last grant
  private relayCooldown = new Map<number, number>(); // accountId -> last "!" relay post (ms)
  // pids whose holder tier was forced via the dev /woctier command — the chain
  // refresh leaves them alone so the override sticks during testing (dev only).
  private devTierPids = new Set<number>();
  private saveTimer = 0;
  private socialPosTimer = 0;
  private saveAllInFlight: Promise<void> | null = null;
  private readonly characterSaveQueues = new Map<number, Promise<void>>();
  // Serializes every write of the single global Market blob (the 30s autosave
  // and the leave-path combined save). Both serialize the whole market; without
  // a queue their transactions could commit out of capture order and persist an
  // older snapshot over a newer one. Snapshots are captured inside the queued
  // thunk, so commit order equals capture order equals freshness order.
  private readonly enqueueMarketWrite = createSerialWriter();
  private restartCountdownStartedAt: number | null = null;
  private readonly restartCountdownTimers: NodeJS.Timeout[] = [];
  private readonly startedAt = Date.now();
  private peakOnline = 0;
  private tickMsAvg = 0;
  // Rolling per-phase loop timing, localizes a stutter to a phase. Always-on
  // (the hot path allocates nothing); read via perfProfile() for admin/ops.
  private readonly tickProfiler = new TickProfiler([
    'stale',
    'tick',
    'events',
    'antibot',
    'broadcast',
    'bcastGrid',
    'bcastSelf',
    'social',
  ]);
  // Per-loop scratch for broadcast sub-phase timing (ns), summed across clients.
  // Only measured when PERF_TICK_LOG=1, the per-client hrtime reads would
  // otherwise add needless work (and BigInt churn) to the hot path.
  private readonly profileBroadcastPhases = process.env.PERF_TICK_LOG === '1';
  private bcastGridNs = 0n;
  private bcastSelfNs = 0n;
  // Crowd diagnostics (PERF_TICK_LOG only): the interest scan is O(viewers x
  // neighbors), so `visits` exposes the real driver of broadcast cost in a
  // crowd, vs the comparatively tiny entity-JSON build time (`serializeMs`).
  private bcSerializeNs = 0n;
  private bcVisits = 0;
  private bcSerializes = 0;
  // Ops kill-switch: SELF_SNAPSHOT_FULL=1 re-diffs every heavy self field every
  // tick (pre-optimization behavior), for A/B benchmarking or rollback.
  private readonly heavySelfGate = process.env.SELF_SNAPSHOT_FULL !== '1';
  // Throttle for the optional over-budget stutter log (PERF_TICK_LOG=1).
  private lastPerfLogTick = 0;
  private readonly ipSessionCounts = new Map<string, number>();

  constructor() {
    this.sim = new Sim({
      seed: WORLD_SEED,
      playerClass: 'warrior',
      noPlayer: true,
      devCommands: process.env.ALLOW_DEV_COMMANDS === '1',
      lockoutNowMs: () => Date.now(),
      // Raid lockouts end at the next 3 AM (the classic daily reset) in this realm's civil
      // time zone, so the whole realm shares one predictable reset (via REALM_RESET_TZ).
      raidResetMs: (nowMs) => nextRaidResetMs(nowMs, REALM_RESET_TIME_ZONE),
    });
    this.social = new SocialService(this.socialDb, this.socialTransport());
    this.moderation = new ModerationService(this.moderationHost(), {
      recordAction: (input) => recordInGameAction(input),
      mute: (input) => muteAccountChat(input),
      ban: (input) => moderateAccount({ ...input, action: 'ban' }),
      suspend: (input) => moderateAccount({ ...input, action: 'suspend' }),
      forceRename: (input) => forceCharacterRename(input),
    });
  }

  // Returns the number of currently active WS sessions from the given IP.
  // Called by main.ts before join() for the hard-reject check.
  countIpSessions(ip: string): number {
    return this.ipSessionCounts.get(ip) ?? 0;
  }

  // -------------------------------------------------------------------------
  // Social presence/transport: bridges the persistent SocialService to the
  // live client map + sim. Keyed by character id (stable across sessions),
  // not pid (per-login).
  // -------------------------------------------------------------------------

  private actorFor(session: ClientSession): SocialActor {
    return { characterId: session.characterId, name: session.name };
  }

  private sessionByCharacterId(id: number): ClientSession | null {
    return this.sessionsByCharacterId.get(id) ?? null;
  }

  private sessionByName(name: string): ClientSession | null {
    const wanted = name.trim();
    let ci: ClientSession | null = null;
    let ciCount = 0;
    const lower = wanted.toLowerCase();
    for (const s of this.clients.values()) {
      if (s.name === wanted) return s; // exact case wins
      if (s.name.toLowerCase() === lower) {
        ci = s;
        ciCount++;
      }
    }
    return ciCount === 1 ? ci : null;
  }

  private moderationHost(): ModerationHost<ClientSession> {
    return {
      sessionByName: (name) => this.sessionByName(name),
      notice: (session, text) => this.sendChatNotice(session, text),
      systemNotice: (session, text) => this.sendSystemNotice(session, text),
      kick: (target) => {
        void this.kickSession(target, 'moderation action', 'moderation action');
      },
      muteLive: (accountId, untilISO, reason) => this.muteAccountChat(accountId, untilISO, reason),
      disconnect: (accountId, reason) => this.disconnectAccount(accountId, reason),
      killEntity: (entityId) => {
        const target = this.sim.entities.get(entityId);
        if (!target || target.dead) return;
        this.sim.dealDamage(null, target, target.maxHp + 1, false, 'physical', null, 'hit', true);
      },
      enterSpectate: (moderator, target) => this.enterSpectate(moderator, target),
      exitSpectate: (moderator) => this.exitSpectate(moderator),
    };
  }

  private enterSpectate(moderator: ClientSession, target: ClientSession): void {
    const moderatorEntity = this.sim.entities.get(moderator.pid);
    if (!moderatorEntity) return;

    if (moderator.spectating) {
      moderator.spectating.characterId = target.characterId;
      moderator.spectating.name = target.name;
    } else {
      const savedPos = { ...moderatorEntity.pos };
      const priorGm = !!moderatorEntity.gm;
      const stowedPet = this.sim.stowPetForSpectate(moderator.pid);
      const limbo = this.sim.groundPos(SPECTATE_LIMBO_X, SPECTATE_LIMBO_Z);
      moderatorEntity.pos = limbo;
      moderatorEntity.prevPos = { ...limbo };
      this.sim.grid.update(moderatorEntity);
      this.sim.playerGrid.update(moderatorEntity);
      this.sim.setGm(moderator.pid);
      const meta = this.sim.meta(moderator.pid);
      if (meta) Object.assign(meta.moveInput, emptyMoveInput());
      moderator.spectating = {
        characterId: target.characterId,
        name: target.name,
        savedPos,
        priorGm,
        stowedPet,
      };
    }

    moderator.lastSent = {};
    moderator.lastArenaWireTick = -ARENA_WIRE_INTERVAL_TICKS;
    moderator.sentEnts.clear();
    this.send(moderator, { t: 'spectate', name: target.name });
    this.sendSystemNotice(moderator, `Now spectating ${target.name}.`);
  }

  private exitSpectate(moderator: ClientSession, announce = true): void {
    const state = moderator.spectating;
    if (!state) {
      if (announce) this.sendChatNotice(moderator, 'You are not spectating anyone.');
      return;
    }
    const moderatorEntity = this.sim.entities.get(moderator.pid);
    if (moderatorEntity) {
      moderatorEntity.pos = { ...state.savedPos };
      moderatorEntity.prevPos = { ...state.savedPos };
      this.sim.grid.update(moderatorEntity);
      this.sim.playerGrid.update(moderatorEntity);
      this.sim.setGm(moderator.pid, state.priorGm);
      this.sim.restorePetAfterSpectate(moderator.pid, state.stowedPet);
    }
    moderator.spectating = null;
    moderator.lastSent = {};
    moderator.lastArenaWireTick = -ARENA_WIRE_INTERVAL_TICKS;
    moderator.sentEnts.clear();
    this.send(moderator, { t: 'spectate', name: null });
    if (announce) this.sendSystemNotice(moderator, 'Stopped spectating.');
  }

  // The instance (dungeon OR delve) an entity is inside, named as its own zone,
  // or null when the entity is in the overworld (or an arena, which is not a
  // dungeon). Resolved in order: an explicit dungeonId portal field, then a
  // delve position, then any other far-off instance-space x as a dungeon. A
  // failed lookup returns null so callers fall back to the overworld zone
  // rather than ever surfacing a raw id. `pos` defaults to the entity's live
  // position but callers pass a spectator's saved position so a spectating
  // moderator reports where they really are, not the limbo they were parked in.
  private instanceZoneName(e: Entity, pos: { x: number; z: number } = e.pos): string | null {
    if (e.dungeonId) return DUNGEONS[e.dungeonId]?.name ?? e.dungeonId;
    if (isDelvePos(pos.x)) return delveAt(pos.x)?.name ?? null;
    if (pos.x > DUNGEON_X_THRESHOLD) return dungeonAt(pos.x)?.name ?? null;
    return null;
  }

  // Live location + activity of an online character, for friend/guild rosters
  // and /who. A player inside any instance (dungeon or delve) reports the
  // instance name and the 'dungeon' status, not the overworld zone the instance
  // coordinates happen to fall under.
  private presenceOf(session: ClientSession): Presence {
    const e = this.sim.entities.get(session.pid);
    if (!e) return { zone: 'Unknown', status: 'online' };
    const pos = session.spectating?.savedPos ?? e.pos;
    const instanceZone = this.instanceZoneName(e, pos);
    let status: PresenceStatus = 'online';
    if (e.dead) status = 'dead';
    else if (instanceZone != null) status = 'dungeon';
    else if (e.inCombat) status = 'combat';
    return { zone: instanceZone ?? zoneAt(pos.z).name, status, x: pos.x, z: pos.z };
  }

  private socialTransport(): SocialTransport {
    const actor = (s: ClientSession): SocialActor => ({ characterId: s.characterId, name: s.name });
    return {
      byCharacterId: (id) => {
        const s = this.sessionByCharacterId(id);
        return s ? actor(s) : null;
      },
      byName: (name) => {
        const s = this.sessionByName(name);
        return s ? actor(s) : null;
      },
      isOnline: (id) => this.sessionByCharacterId(id) !== null,
      locationOf: (id) => {
        const s = this.sessionByCharacterId(id);
        return s ? this.presenceOf(s) : null;
      },
      deliver: (id, events) => {
        const s = this.sessionByCharacterId(id);
        if (s) this.send(s, { t: 'events', list: events });
      },
      pushSnapshot: (id) => {
        void this.sendSocialSnapshot(id);
      },
      onBlocksChanged: (id, ids) => {
        const s = this.sessionByCharacterId(id);
        if (s) s.blockedIds = new Set(ids);
      },
      isIgnoring: (recipientId, senderCharacterId) => {
        const s = this.sessionByCharacterId(recipientId);
        return s ? s.blockedIds.has(senderCharacterId) : false;
      },
    };
  }

  private async sendSocialSnapshot(charId: number): Promise<void> {
    const session = this.sessionByCharacterId(charId);
    if (!session) return;
    try {
      const snap = await this.social.snapshot(charId);
      this.send(session, { t: 'social', ...snap });
      // Stamp the guild name onto the player's world entity so it rides the
      // identity wire and shows under their nameplate for everyone nearby. This
      // is the single chokepoint hit on join and on every membership change.
      this.sim.setPlayerGuild(session.pid, snap.guild?.name ?? '');
      // remember who to track for the live position push (friends + guildmates)
      session.socialTrackedIds = [
        ...snap.friends.map((f) => f.id),
        ...(snap.guild ? snap.guild.members.map((m) => m.id) : []),
      ];
    } catch (err) {
      console.error('social snapshot failed:', err);
    }
  }

  // Cheap (no-DB) periodic push: refresh the live positions of each client's
  // already-known friends/guildmates so they stay current on the world map.
  private broadcastSocialPositions(): void {
    for (const session of this.clients.values()) {
      const ids = session.socialTrackedIds;
      if (!ids || ids.length === 0) continue;
      const list: { id: number; x: number; z: number; zone: string; status: PresenceStatus }[] = [];
      for (const id of ids) {
        const other = this.sessionByCharacterId(id);
        if (!other) continue; // offline — snapshots own the online/offline flip
        const loc = this.presenceOf(other);
        if (loc.x === undefined || loc.z === undefined) continue;
        list.push({ id, x: loc.x, z: loc.z, zone: loc.zone, status: loc.status });
      }
      if (list.length > 0) this.send(session, { t: 'socialpos', list });
    }
  }

  start(): void {
    let last = process.hrtime.bigint();
    let acc = 0;
    this.interval = setInterval(() => {
      // The whole tick body runs guarded: an unguarded throw here (sim tick, a
      // broadcast, an autosave kick-off) would unwind the callback and skip the
      // rest of this tick for everyone. Log and let the next tick self-heal so a
      // transient fault never starves the loop (server/CLAUDE.md).
      runGuarded(
        () => {
          const now = process.hrtime.bigint();
          let dt = Number(now - last) / 1e9;
          last = now;
          if (dt > 0.5) dt = 0.5;
          acc += dt;
          // Feed the authoritative UTC day to the sim so the delve daily reset (FR-5.1)
          // works without the sim reading the wall clock itself (determinism invariant).
          this.sim.utcDay = new Date().toISOString().slice(0, 10);
          this.bcastGridNs = 0n;
          this.bcastSelfNs = 0n;
          this.bcSerializeNs = 0n;
          this.bcVisits = 0;
          this.bcSerializes = 0;
          let mark = now;
          const lap = (phase: string): void => {
            const t = process.hrtime.bigint();
            this.tickProfiler.add(phase, Number(t - mark) / 1e6);
            mark = t;
          };
          while (acc >= DT) {
            this.clearStaleInputs();
            lap('stale');
            const events = this.sim.tick();
            lap('tick');
            this.routeEvents(events);
            this.detectActivity(events);
            lap('events');
            this.runAntibotTick();
            lap('antibot');
            acc -= DT;
          }
          this.broadcastSnapshots();
          lap('broadcast');
          this.tickProfiler.add('bcastGrid', Number(this.bcastGridNs) / 1e6);
          this.tickProfiler.add('bcastSelf', Number(this.bcastSelfNs) / 1e6);
          this.socialPosTimer += dt;
          if (this.socialPosTimer >= 1) {
            this.socialPosTimer = 0;
            this.broadcastSocialPositions();
          }
          lap('social');
          const tickMs = Number(process.hrtime.bigint() - now) / 1e6;
          this.tickProfiler.commit(tickMs);
          this.maybeLogTickPerf(tickMs);
          this.tickMsAvg =
            this.tickMsAvg === 0
              ? tickMs
              : this.tickMsAvg + TICK_EMA_ALPHA * (tickMs - this.tickMsAvg);
          this.saveTimer += dt;
          if (this.saveTimer >= AUTOSAVE_SECONDS) {
            this.saveTimer = 0;
            void this.saveAll('autosave');
            void this.saveMarket();
          }
        },
        (err) => console.error('[tick] guarded tick body threw, skipping this tick:', err),
      );
    }, 50);
    // Refresh every online player's $WOC holder-tier flair off the 20 Hz loop:
    // an RPC call per wallet (cached for minutes inside holderInfoForPubkey) has
    // no place in the tick. Catches mid-session balance changes.
    this.holderTierInterval = setInterval(() => {
      void this.refreshAllHolderTiers();
    }, HOLDER_TIER_REFRESH_MS);
    // Reward in-game playtime: grant points to active online accounts off-loop.
    this.playtimeInterval = setInterval(() => {
      void this.grantPlaytimePoints();
    }, PLAYTIME_GRANT_MS);
  }

  stop(): void {
    if (this.interval) clearInterval(this.interval);
    if (this.holderTierInterval) clearInterval(this.holderTierInterval);
    if (this.playtimeInterval) clearInterval(this.playtimeInterval);
  }

  // Grant playtime reward points to each online account that has been ACTIVE (gave
  // input recently), so points reflect real engagement rather than idling. Lifetime
  // points are monotonic, so this also nudges the Discord status tier over time.
  private async grantPlaytimePoints(): Promise<void> {
    const windowSecs = PLAYTIME_GRANT_MS / 1000;
    for (const session of this.clients.values()) {
      if (this.sim.time - session.lastInputAt > windowSecs) continue; // idle: skip
      const last = this.lastPlaytimeGrantAt.get(session.accountId);
      if (last !== undefined && this.sim.time - last < windowSecs) continue;
      this.lastPlaytimeGrantAt.set(session.accountId, this.sim.time);
      try {
        await grantRewardPoints(pool, session.accountId, PLAYTIME_POINTS, 'playtime');
      } catch (err) {
        console.error('playtime reward grant failed:', err);
      }
    }
  }

  // Refresh one player's linked-Discord flair (status tier + PFP + nickname +
  // member-since + staff role) for nearby players' nameplates / inspect cards.
  private async refreshDiscordFlair(session: ClientSession): Promise<void> {
    const flair = await discordFlairForAccount(pool, session.accountId);
    if (this.clients.get(session.pid) !== session) return;
    const e = this.sim.entities.get(session.pid);
    if (!e) return;
    const tier = flair?.tier ?? 0;
    const avatar = flair?.avatarUrl ?? undefined;
    const name = flair?.name ?? undefined;
    const joined = flair?.joinedAtMs ?? undefined;
    const role = flair?.role ?? undefined;
    if (
      e.discordTier !== tier ||
      e.discordAvatar !== avatar ||
      e.discordName !== name ||
      e.discordJoined !== joined ||
      e.discordRole !== role
    ) {
      // identity diff re-broadcasts the linked-Discord flair to nearby players
      e.discordTier = tier;
      e.discordAvatar = avatar;
      e.discordName = name;
      e.discordJoined = joined;
      e.discordRole = role;
    }
  }

  // Intercept a leading "!" community command in chat (lfg/wts/...): broadcast it
  // in-world and hand it to the bot for Discord cross-post. Returns true when it
  // consumed the line (so it is not sent as normal chat).
  private handleRelayCommand(session: ClientSession, text: string): boolean {
    const parsed = parseRelayCommand(text);
    if (!parsed) return false; // unknown "!word" -> treat as normal chat
    const now = Date.now();
    if (now - (this.relayCooldown.get(session.accountId) ?? 0) < RELAY_COOLDOWN_MS) return true;
    this.relayCooldown.set(session.accountId, now);
    const { command, message } = parsed;
    const e = this.sim.entities.get(session.pid);
    const cls = e ? e.templateId.charAt(0).toUpperCase() + e.templateId.slice(1) : '';
    const zone = e
      ? e.dungeonId
        ? (DUNGEONS[e.dungeonId]?.name ?? e.dungeonId)
        : zoneAt(e.pos.z).name
      : REALM;
    // In-game: a system broadcast everyone sees (variable-routed; S3 guard skips it).
    this.broadcastSystem(`[${command.tag}] ${session.name}: ${message || command.label}`);
    // Out-of-game: hand off to the bot, which posts a rich embed with a Respond button.
    enqueueRelay({
      commandId: command.id,
      tag: command.tag,
      label: command.label,
      color: command.color,
      accountId: session.accountId,
      characterName: session.name,
      level: e?.level ?? 1,
      className: cls,
      realm: REALM,
      zone,
      message,
      profileUrl: REALM_PUBLIC_ORIGIN
        ? `${REALM_PUBLIC_ORIGIN}/c/${encodeURIComponent(session.name)}`
        : null,
    });
    return true;
  }

  // Update one player's holder-tier flair from their linked wallet's $WOC
  // balance. Best-effort and guarded against the player leaving mid-fetch.
  private async refreshHolderTier(session: ClientSession): Promise<void> {
    if (this.devTierPids.has(session.pid)) return; // dev override pinned this pid
    const wallet = await walletForAccount(session.accountId);
    const { tier, balance } = wallet
      ? await holderInfoForPubkey(wallet.pubkey)
      : { tier: 0, balance: 0 };
    // The player may have left during the await; only apply if still the live
    // session for this pid.
    if (this.clients.get(session.pid) !== session) return;
    const e = this.sim.entities.get(session.pid);
    if (e && ((e.holderTier ?? 0) !== tier || (e.holderBalance ?? 0) !== balance)) {
      e.holderTier = tier; // identity diff re-broadcasts it to nearby players
      e.holderBalance = balance;
      console.log(`[woc] ${session.name} holder tier → ${tier} (${balance} $WOC)`);
    }
  }

  // Update one player's developer-badge flair from their linked GitHub login and
  // the cached repo merged-PR stats. Best-effort and guarded against the player
  // leaving mid-fetch. Only an actual contributor (tier > 0, so >= 1 merged PR)
  // carries the flair on the wire; a linked non-contributor reads as no badge.
  private async refreshDevBadge(session: ClientSession): Promise<void> {
    const link = await githubForAccount(pool, session.accountId);
    const login = link?.github_login ?? null;
    const mergedPrs = login ? await mergedPrsForLogin(login) : 0;
    const tier = devTierIndexForMergedPrs(mergedPrs);
    // The player may have left during the await; only apply if still the live
    // session for this pid.
    if (this.clients.get(session.pid) !== session) return;
    const e = this.sim.entities.get(session.pid);
    if (!e) return;
    const githubLogin = tier > 0 ? (login ?? undefined) : undefined;
    const devMergedPrs = tier > 0 ? mergedPrs : undefined;
    if (
      (e.devTier ?? 0) !== tier ||
      (e.devMergedPrs ?? 0) !== (devMergedPrs ?? 0) ||
      e.githubLogin !== githubLogin
    ) {
      // identity diff re-broadcasts the developer-badge flair to nearby players
      e.devTier = tier;
      e.devMergedPrs = devMergedPrs;
      e.githubLogin = githubLogin;
      if (tier > 0) {
        console.log(
          `[dev] ${session.name} dev tier → ${tier} (${mergedPrs} merged PRs, @${login})`,
        );
      }
    }
  }

  private async refreshAllHolderTiers(): Promise<void> {
    if (this.holderTierRefreshing) return; // a slow cycle (RPC) must not pile up
    this.holderTierRefreshing = true;
    try {
      await Promise.all(
        [...this.clients.values()].map((session) =>
          Promise.all([
            this.refreshHolderTier(session).catch((err) =>
              console.error('holder-tier refresh failed:', err),
            ),
            this.refreshDiscordFlair(session).catch((err) =>
              console.error('discord flair refresh failed:', err),
            ),
            this.refreshDevBadge(session).catch((err) =>
              console.error('dev badge refresh failed:', err),
            ),
          ]),
        ),
      );
    } finally {
      this.holderTierRefreshing = false;
    }
  }

  // -------------------------------------------------------------------------

  private runAntibotTick(): void {
    const now = Date.now();
    for (const session of this.clients.values()) {
      const action = this.botDetector.handleTick(
        session.botTrackingContext,
        now,
        ANTIBOT_ENFORCE,
        this.captureBotDetectionSnapshot(session, now),
      );
      if (action === 'kick') {
        void this.kickSession(session, 'rejected by server', 'disconnected');
      }
    }
  }

  private captureBotDetectionSnapshot(
    session: ClientSession,
    capturedAt: number,
  ): SessionRuntimeSnapshot | null {
    const e = this.sim.entities.get(session.pid);
    if (!e) return null;
    const instance = this.sim.instanceInfoAt(e.pos);
    return {
      capturedAt,
      simTime: this.sim.time,
      x: e.pos.x,
      z: e.pos.z,
      facing: e.facing,
      dead: e.dead,
      inCombat: e.inCombat,
      targetId: e.targetId,
      instanceSlot: instance?.slot ?? null,
      instanceDungeonId: instance?.dungeonId ?? null,
      level: e.level,
      classId: e.templateId,
      hp: e.hp,
      maxHp: e.maxHp,
      resource: e.resource,
      maxResource: e.maxResource,
      resourceType: e.resourceType,
      autoAttack: e.autoAttack,
      followTargetId: e.followTargetId,
      moveSpeed: e.moveSpeed,
      onGround: e.onGround,
    };
  }

  private clearStaleInputs(): void {
    for (const session of this.clients.values()) {
      if (this.sim.time - session.lastInputAt <= STALE_INPUT_SECONDS) continue;
      const meta = this.sim.meta(session.pid);
      if (!meta) continue;
      const mi = meta.moveInput;
      if (
        !(
          mi.forward ||
          mi.back ||
          mi.turnLeft ||
          mi.turnRight ||
          mi.strafeLeft ||
          mi.strafeRight ||
          mi.jump
        )
      )
        continue;
      Object.assign(meta.moveInput, emptyMoveInput());
    }
  }

  // -------------------------------------------------------------------------

  private applyAccountQuestLockouts(pid: number, cosmetics: AccountCosmetics): void {
    const meta = this.sim.meta(pid);
    if (!meta) return;
    for (const questId of cosmetics.completedQuestIds) {
      meta.questsDone.add(questId);
      meta.questLog.delete(questId);
    }
  }

  private mergeAccountCosmetics(a: AccountCosmetics, b: AccountCosmetics): AccountCosmetics {
    return {
      completedQuestIds: [...new Set([...a.completedQuestIds, ...b.completedQuestIds])],
      mechChromaIds: [...new Set([...a.mechChromaIds, ...b.mechChromaIds])],
    };
  }

  private rememberAccountCosmetics(
    accountId: number,
    cosmetics: AccountCosmetics,
  ): AccountCosmetics {
    const merged = this.mergeAccountCosmetics(
      this.accountCosmeticsByAccount.get(accountId) ?? { completedQuestIds: [], mechChromaIds: [] },
      cosmetics,
    );
    this.accountCosmeticsByAccount.set(accountId, merged);
    return merged;
  }

  private updateLiveAccountCosmetics(accountId: number, cosmetics: AccountCosmetics): void {
    const merged = this.rememberAccountCosmetics(accountId, cosmetics);
    for (const live of this.clients.values()) {
      if (live.accountId !== accountId) continue;
      live.accountCosmetics = merged;
      this.applyAccountQuestLockouts(live.pid, merged);
      this.resyncQuests(live);
    }
  }

  private replaceLiveAccountCosmetics(accountId: number, cosmetics: AccountCosmetics): void {
    const exact = {
      completedQuestIds: [...new Set(cosmetics.completedQuestIds)],
      mechChromaIds: [...new Set(cosmetics.mechChromaIds)],
    };
    this.accountCosmeticsByAccount.set(accountId, exact);
    for (const live of this.clients.values()) {
      if (live.accountId !== accountId) continue;
      live.accountCosmetics = exact;
      this.applyAccountQuestLockouts(live.pid, exact);
      this.resyncQuests(live);
    }
  }

  private noteAccountQuestComplete(session: ClientSession, questId: string): void {
    const current = session.accountCosmetics;
    const completedQuestIds = current.completedQuestIds.includes(questId)
      ? current.completedQuestIds
      : [...current.completedQuestIds, questId];
    this.updateLiveAccountCosmetics(session.accountId, { ...current, completedQuestIds });
    void markAccountQuestComplete(session.accountId, questId)
      .then((cosmetics) => this.updateLiveAccountCosmetics(session.accountId, cosmetics))
      .catch((err) => console.error('failed to save account quest cosmetic state:', err));
  }

  private noteAccountMechChroma(session: ClientSession, chromaId: string): void {
    const current = session.accountCosmetics;
    const mechChromaIds = current.mechChromaIds.includes(chromaId)
      ? current.mechChromaIds
      : [...current.mechChromaIds, chromaId];
    this.updateLiveAccountCosmetics(session.accountId, { ...current, mechChromaIds });
    void grantAccountMechChroma(session.accountId, chromaId)
      .then((cosmetics) => this.updateLiveAccountCosmetics(session.accountId, cosmetics))
      .catch((err) => console.error('failed to save account mech chroma:', err));
  }

  private unequipAccountMechChroma(session: ClientSession, chromaId: string): void {
    const skin = mechChromaSkinIndex(chromaId);
    const itemId = mechChromaItemId(chromaId);
    if (skin < 0 || !itemId || !session.accountCosmetics.mechChromaIds.includes(chromaId)) return;
    const nextCosmetics = {
      ...session.accountCosmetics,
      mechChromaIds: session.accountCosmetics.mechChromaIds.filter((id) => id !== chromaId),
    };
    this.replaceLiveAccountCosmetics(session.accountId, nextCosmetics);
    for (const live of this.clients.values()) {
      if (live.accountId !== session.accountId) continue;
      const e = this.sim.entities.get(live.pid);
      if (e?.skinCatalog === 'mech' && e.skin === skin) {
        this.sim.setPlayerSkin(live.pid, 0, 'class');
      }
    }
    this.sim.addItem(itemId, 1, session.pid);
    void revokeAccountMechChroma(session.accountId, chromaId)
      .then((cosmetics) => this.replaceLiveAccountCosmetics(session.accountId, cosmetics))
      .catch((err) => console.error('failed to remove account mech chroma:', err));
  }

  join(
    ws: WebSocket,
    accountId: number,
    characterId: number,
    name: string,
    cls: import('../src/sim/types').PlayerClass,
    state: import('../src/sim/sim').CharacterState | null,
    isGm = false,
    meta: RequestMetadata &
      Partial<AccountChatMuteStatus> & {
        accountCosmetics?: AccountCosmetics;
        chatStrikes?: number;
        isAdmin?: boolean;
        clientSeed?: string;
      } = {},
  ): ClientSession | { error: string } {
    if (this.sessionsByCharacterId.has(characterId)) return { error: 'character already in world' };
    // Anti-bot: cap simultaneous online characters per account. Accounts can
    // still own up to 10 characters; this only limits live sessions. GMs are
    // exempt for supervision.
    if (!isGm) {
      let activeForAccount = 0;
      for (const s of this.clients.values()) {
        if (s.accountId === accountId) activeForAccount++;
      }
      if (activeForAccount >= MAX_ACTIVE_SESSIONS_PER_ACCOUNT) {
        return { error: 'too many characters on this account are already in the world' };
      }
    }
    const pid = this.sim.addPlayer(cls, name, { state: state ?? undefined, characterId });
    if (isGm) {
      // GM characters: invulnerable, and always at the level cap (the row is
      // created without state, so the first join levels them up)
      this.sim.setGm(pid);
      const e = this.sim.entities.get(pid);
      if (e && e.level < 20) this.sim.setPlayerLevel(20, pid);
    }
    const accountCosmetics = this.rememberAccountCosmetics(
      accountId,
      meta.accountCosmetics ?? { completedQuestIds: [], mechChromaIds: [] },
    );
    this.applyAccountQuestLockouts(pid, accountCosmetics);
    const sessionIp = meta.ip ?? '';
    const botTrackingContext = this.botDetector.createTrackingContext(
      { accountId, characterId, name, ip: sessionIp },
      meta,
    );
    const session: ClientSession = {
      ws,
      accountId,
      accountCosmetics,
      characterId,
      pid,
      name,
      lastSave: Date.now(),
      alive: true,
      joinedAt: Date.now(),
      dbSessionId: null,
      left: false,
      chatTokens: CHAT_RATE_BURST,
      chatLastRefill: Date.now() / 1000,
      chatLastRateError: 0,
      chatRateViolations: 0,
      chatCooldownUntil: 0,
      chatMutedUntil: meta.mutedUntil ? new Date(meta.mutedUntil).getTime() : null,
      chatMuteReason: meta.reason ?? '',
      chatStrikes: meta.chatStrikes ?? 0,
      blockedIds: new Set(),
      blockListLoaded: false,
      lastWhisperFrom: null,
      rememberedChat: { channel: 'say' },
      lastInputSeq: 0,
      lastInputAt: this.sim.time,
      lastSent: {},
      lastArenaWireTick: -ARENA_WIRE_INTERVAL_TICKS,
      selfHeavyDirty: true,
      lastWireRev: -1,
      sentEnts: new Map(),
      ip: sessionIp,
      isAdmin: meta.isAdmin ?? false,
      clientSeed: meta.clientSeed ?? '',
      botTrackingContext,
      spectating: null,
    };
    this.ipSessionCounts.set(sessionIp, (this.ipSessionCounts.get(sessionIp) ?? 0) + 1);
    this.clients.set(pid, session);
    this.sessionsByCharacterId.set(characterId, session);
    this.peakOnline = Math.max(this.peakOnline, this.clients.size);
    void this.recordOnlineSnapshot();
    openPlaySession(accountId, characterId, name, meta)
      .then((id) => {
        session.dbSessionId = id;
        // If the player disconnected before this insert landed, leave() saw a
        // null id and skipped the close. Close it now so the row isn't orphaned.
        if (session.left) {
          void closePlaySession(id).catch((err) =>
            console.error('failed to close play session:', err),
          );
        }
      })
      .catch((err) => console.error('failed to open play session:', err));

    this.send(session, {
      t: 'hello',
      pid,
      seed: this.sim.cfg.seed,
      name,
      cls,
      realm: REALM,
      // Soft (cosmetic) words the client masks locally when its profanity
      // filter is on. Hard words are never sent — they're enforced server-side.
      softWords: this.chatFilter.softWords(),
      // Epoch ms of an active chat mute, or null. Lets the client show status
      // at login; sending is still gated server-side regardless.
      chatMutedUntil: session.chatMutedUntil ?? null,
    });
    // Only the entering player sees their own world-entry notice; we don't
    // broadcast it to everyone (and likewise don't broadcast departures below).
    this.send(session, {
      t: 'events',
      list: [{ type: 'log', text: `${name} has entered World of ClaudeCraft.`, color: '#ffd100' }],
    });
    void this.initSocial(session);
    // Stamp the $WOC holder-tier flair (best-effort: a balance read must never
    // affect joining the world).
    void this.refreshHolderTier(session).catch((err) =>
      console.error('holder-tier refresh failed:', err),
    );
    void this.refreshDiscordFlair(session).catch((err) =>
      console.error('discord flair refresh failed:', err),
    );
    // Stamp the developer-badge flair from the linked GitHub login (best-effort:
    // a contributor-stats read must never affect joining the world).
    void this.refreshDevBadge(session).catch((err) =>
      console.error('dev badge refresh failed:', err),
    );
    return session;
  }

  // Load the player's block list, send their friends/ignore/guild panel, and
  // let friends + guildmates know they've come online.
  private async initSocial(session: ClientSession): Promise<void> {
    try {
      session.blockedIds = new Set(await this.socialDb.blockedIds(session.characterId));
      session.blockListLoaded = true;
    } catch (err) {
      console.error('failed to load block list:', err);
    }
    await this.sendSocialSnapshot(session.characterId);
    await this.social
      .announcePresence({ characterId: session.characterId, name: session.name }, true)
      .catch((err) => console.error('presence announce failed:', err));
  }

  // Tear down a live session as a kick: tell the client why, close the socket,
  // then run the normal leave() cleanup. Sending the error frame and closing the
  // socket (not just calling leave) is what lets net/online.ts surface the
  // disconnect and return the app to character select, so a kicked player can
  // rejoin. Every forced-disconnect path (moderation, IP block, character
  // takeover, and the anti-bot tick) funnels through here so none can
  // half-tear-down a session, leaving the world without the client and wedging
  // the player "connected" with no way back in.
  private kickSession(
    session: ClientSession,
    clientError: string,
    leaveReason: string,
  ): Promise<void> {
    this.send(session, { t: 'error', error: clientError });
    try {
      session.ws.close();
    } catch {
      /* connection already closing */
    }
    return this.leave(session, leaveReason);
  }

  async leave(session: ClientSession, _reason: string): Promise<void> {
    if (session.left || !this.clients.has(session.pid)) return;
    if (session.spectating) this.exitSpectate(session, false);
    session.left = true;
    this.clients.delete(session.pid);
    this.botDetector.releaseTrackingContext(session.botTrackingContext);
    if (session.ip) {
      const prev = this.ipSessionCounts.get(session.ip) ?? 1;
      if (prev <= 1) this.ipSessionCounts.delete(session.ip);
      else this.ipSessionCounts.set(session.ip, prev - 1);
    }
    void this.recordOnlineSnapshot();
    this.devTierPids.delete(session.pid);
    this.social.forget(session.characterId);
    // delete from clients first so friends see them as offline in the notice
    void this.social
      .announcePresence({ characterId: session.characterId, name: session.name }, false)
      .catch((err) => console.error('presence announce failed:', err));
    if (session.dbSessionId !== null) {
      void closePlaySession(session.dbSessionId).catch((err) =>
        console.error('failed to close play session:', err),
      );
    }
    await this.saveCharacterOnLeave(session);
    this.sessionsByCharacterId.delete(session.characterId);
    this.sim.removePlayer(session.pid);
    // Departures are no longer broadcast to the realm — the leaving player has
    // already disconnected, so there is no one to show their own notice to.
  }

  private async saveCharacterOnLeave(session: ClientSession): Promise<void> {
    for (let attempt = 1; attempt <= LEAVE_SAVE_MAX_ATTEMPTS; attempt++) {
      try {
        // Flush the character AND the World Market together: a Market escrow
        // straddles both (item out of bags, into a listing), and the autosave
        // timer only persists the market every 30s. Without this, a crash right
        // after the leave-flush of bags would tear the escrow in half (item lost
        // or duplicated). saveCharacter(withMarket) writes both in one transaction.
        await this.saveCharacter(session, { withMarket: true });
        return;
      } catch (err) {
        if (attempt === LEAVE_SAVE_MAX_ATTEMPTS) {
          console.error(`save on leave failed after ${attempt} attempts for ${session.name}:`, err);
          return;
        }
        const retryMs = Math.min(
          LEAVE_SAVE_RETRY_BASE_MS * 2 ** (attempt - 1),
          LEAVE_SAVE_RETRY_MAX_MS,
        );
        console.error(`save on leave failed for ${session.name}; retrying in ${retryMs}ms:`, err);
        await delay(retryMs);
      }
    }
  }

  async saveCharacter(session: ClientSession, opts: { withMarket?: boolean } = {}): Promise<void> {
    const previous = this.characterSaveQueues.get(session.characterId);
    const run = (previous ? previous.catch(() => {}) : Promise.resolve()).then(async () => {
      const state = this.sim.serializeCharacter(session.pid);
      const e = this.sim.entities.get(session.pid);
      if (state && e) {
        if (session.spectating) {
          state.pos = {
            x: session.spectating.savedPos.x,
            z: session.spectating.savedPos.z,
          };
          state.pet = session.spectating.stowedPet;
        }
        // Use the SERIALIZED level (not e.level): during a 2v2 Fiesta bout e.level
        // is temporarily 20, but serializeCharacter reports the real level — so the
        // character-list/leaderboard `level` column never reflects the temp state.
        if (opts.withMarket) {
          // Atomic on the leave path so a logout bag-flush can never tear away
          // from the global Market escrow (see saveCharacterAndMarketState). Run
          // through the market queue and capture the market snapshot at write
          // time so this commit can't clobber a newer one.
          await this.enqueueMarketWrite(() =>
            saveCharacterAndMarketState(
              session.characterId,
              state.level,
              state,
              this.sim.serializeMarket(),
            ),
          );
        } else {
          await saveCharacterState(session.characterId, state.level, state);
        }
        session.lastSave = Date.now();
      }
    });
    this.characterSaveQueues.set(session.characterId, run);
    try {
      await run;
    } finally {
      if (this.characterSaveQueues.get(session.characterId) === run) {
        this.characterSaveQueues.delete(session.characterId);
      }
    }
  }

  async saveAll(reason: string): Promise<void> {
    while (this.saveAllInFlight) {
      const inFlight = this.saveAllInFlight;
      if (reason !== 'shutdown') return;
      await inFlight;
    }
    const run = this.saveAllSnapshot(reason);
    this.saveAllInFlight = run;
    try {
      await run;
    } finally {
      if (this.saveAllInFlight === run) this.saveAllInFlight = null;
    }
  }

  private async saveAllSnapshot(reason: string): Promise<void> {
    const sessions = [...this.clients.values()];
    let next = 0;
    const worker = async () => {
      for (;;) {
        const session = sessions[next++];
        if (!session) return;
        await this.saveCharacter(session).catch((err) =>
          console.error(`${reason} failed for ${session.name}:`, err),
        );
      }
    };
    await Promise.all(Array.from({ length: Math.min(SAVE_CONCURRENCY, sessions.length) }, worker));
  }

  // The World Market is shared global state, persisted as a single JSONB blob.
  async loadMarket(): Promise<void> {
    try {
      this.sim.loadMarket(await loadMarketState());
    } catch (err) {
      console.error('failed to load world market:', err);
    }
  }

  async saveMarket(): Promise<void> {
    try {
      await this.enqueueMarketWrite(() => saveMarketState(this.sim.serializeMarket()));
    } catch (err) {
      console.error('failed to save world market:', err);
    }
  }

  rekeyMarketSeller(characterId: number, oldName: string, newName: string): boolean {
    return this.sim.rekeyMarketSeller(characterId, oldName, newName);
  }

  // Close every open play_sessions row; called on graceful shutdown so the
  // sessions of currently-online players keep their real duration.
  async endAllPlaySessions(): Promise<void> {
    for (const session of this.clients.values()) {
      if (session.dbSessionId === null) continue;
      await closePlaySession(session.dbSessionId).catch((err) =>
        console.error('failed to close play session:', err),
      );
    }
  }

  // -------------------------------------------------------------------------
  // Admin dashboard views (read-only)
  // -------------------------------------------------------------------------

  adminStats(): AdminServerStats {
    const mem = process.memoryUsage();
    return {
      online: this.clients.size,
      onlineAccounts: this.liveAccountIds().size,
      peakOnline: this.peakOnline,
      uptimeSeconds: Math.round((Date.now() - this.startedAt) / 1000),
      tickMsAvg: Math.round(this.tickMsAvg * 100) / 100,
      simEntities: this.sim.entities.size,
      rssBytes: mem.rss,
      heapUsedBytes: mem.heapUsed,
    };
  }

  // Rolling per-phase loop timing for the admin/ops perf view + load harness.
  perfProfile(): { online: number; simEntities: number } & ReturnType<TickProfiler['profile']> {
    return {
      online: this.clients.size,
      simEntities: this.sim.entities.size,
      ...this.tickProfiler.profile(),
    };
  }

  // Optional stutter trace (PERF_TICK_LOG=1): log a per-phase p95/max breakdown
  // when a loop body blows the 50 ms budget (throttled to ~1/s), plus a steady
  // heartbeat every 5 s. Off by default so production logs stay quiet.
  private maybeLogTickPerf(tickMs: number): void {
    if (process.env.PERF_TICK_LOG !== '1') return;
    const tick = this.sim.tickCount;
    const overBudget = tickMs > 50 && tick - this.lastPerfLogTick >= 20;
    const heartbeat = tick - this.lastPerfLogTick >= 100;
    if (!overBudget && !heartbeat) return;
    this.lastPerfLogTick = tick;
    const p = this.tickProfiler.profile().phases;
    const fmt = (n: string) => `${n}=${p[n].p95}/${p[n].max}`;
    console.log(
      `[perf] online=${this.clients.size} ents=${this.sim.entities.size} tickMs=${round2(tickMs)}${overBudget ? ' OVER' : ''}` +
        ` | p95/max ${['total', 'tick', 'broadcast', 'bcastSelf', 'bcastGrid', 'events', 'social'].map(fmt).join(' ')}` +
        ` | visits=${this.bcVisits} serializes=${this.bcSerializes} serializeMs=${round2(Number(this.bcSerializeNs) / 1e6)}`,
    );
  }

  suspiciousPlayers(): SuspiciousPlayer[] {
    return this.botDetector.listSuspiciousPlayers();
  }

  private liveLocationFor(e: Entity): AdminLiveLocation {
    const instance = this.sim.instanceInfoAt(e.pos);
    const dungeonId = e.dungeonId ?? instance?.dungeonId ?? null;
    if (dungeonId) {
      const dungeon = DUNGEONS[dungeonId];
      const zone = dungeon ? zoneAt(dungeon.doorPos.z) : zoneAt(e.pos.z);
      return {
        kind: 'dungeon',
        zoneId: zone.id,
        zone: zone.name,
        instanceId: dungeonId,
        instance: dungeon?.name ?? dungeonId,
        instanceSlot: instance?.slot ?? null,
        poiIndex: null,
        poi: null,
        poiDistance: null,
      };
    }

    const delveRun = this.sim.delveRunForPlayer(e.id);
    if (delveRun) {
      const delve = DELVES[delveRun.delveId];
      const zone = delve ? zoneAt(delve.doorPos.z) : zoneAt(e.pos.z);
      return {
        kind: 'delve',
        zoneId: zone.id,
        zone: zone.name,
        instanceId: delveRun.delveId,
        instance: delve?.name ?? delveRun.delveId,
        instanceSlot: delveRun.slot,
        poiIndex: null,
        poi: null,
        poiDistance: null,
      };
    }

    const zone = zoneAt(e.pos.z);
    let bestIndex: number | null = null;
    let bestDistance = ADMIN_LOCATION_POI_RADIUS;
    for (let i = 0; i < zone.pois.length; i++) {
      const poi = zone.pois[i];
      const distance = Math.hypot(e.pos.x - poi.x, e.pos.z - poi.z);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = i;
      }
    }
    const poi = bestIndex === null ? null : zone.pois[bestIndex];
    return {
      kind: 'overworld',
      zoneId: zone.id,
      zone: zone.name,
      instanceId: null,
      instance: null,
      instanceSlot: null,
      poiIndex: bestIndex,
      poi: poi?.label ?? null,
      poiDistance: poi ? round2(bestDistance) : null,
    };
  }

  liveSessions(): AdminLivePlayer[] {
    const now = Date.now();
    const players: AdminLivePlayer[] = [];
    for (const session of this.clients.values()) {
      const e = this.sim.entities.get(session.pid);
      const meta = this.sim.meta(session.pid);
      if (!e || !meta) continue;
      const location = this.liveLocationFor(e);
      const zone = location.instance ?? location.zone;
      const moveSpeedMultiplier = round2(this.sim.moveSpeedMult(e));
      players.push({
        pid: session.pid,
        accountId: session.accountId,
        characterId: session.characterId,
        name: session.name,
        class: meta.cls,
        level: e.level,
        hp: e.hp,
        maxHp: e.maxHp,
        x: round2(e.pos.x),
        z: round2(e.pos.z),
        zone,
        location,
        sessionSeconds: Math.round((now - session.joinedAt) / 1000),
        lastSaveSecondsAgo: Math.round((now - session.lastSave) / 1000),
        moveSpeedMultiplier,
        runSpeed: round2(RUN_SPEED * moveSpeedMultiplier),
        swimming: this.sim.isSwimming(e),
        auras: e.auras.map((a) => ({
          id: a.id,
          name: a.name,
          kind: a.kind,
          value: a.value,
          remaining: round2(a.remaining),
          duration: a.duration,
        })),
      });
    }
    return players.sort((a, b) => b.sessionSeconds - a.sessionSeconds);
  }

  liveAccountIds(): Set<number> {
    return new Set([...this.clients.values()].map((s) => s.accountId));
  }

  liveSharedIps(): LiveSharedIp[] {
    return sharedIpsFromLiveSessions(this.clients.values());
  }

  async recordOnlineSnapshot(): Promise<void> {
    await recordOnlineSample(this.clients.size, this.liveAccountIds().size).catch((err) =>
      console.error('failed to record online sample:', err),
    );
  }

  reportTargetForPid(
    pid: number,
  ): { accountId: number; characterId: number; characterName: string } | null {
    const session = this.clients.get(pid);
    return session
      ? {
          accountId: session.accountId,
          characterId: session.characterId,
          characterName: session.name,
        }
      : null;
  }

  // Live authoritative level for a currently-online character. This uses the
  // serialized character state rather than entity.level so temporary event
  // scaling does not leak into shared-card metadata. Callers must verify
  // ownership before reading by raw character id.
  liveLevelForCharacter(characterId: number): number | null {
    const session = this.sessionsByCharacterId.get(characterId);
    if (!session) return null;
    const state = this.sim.serializeCharacter(session.pid);
    return state ? state.level : null;
  }

  disconnectAccount(accountId: number, reason: string): void {
    for (const session of [...this.clients.values()]) {
      if (session.accountId !== accountId) continue;
      void this.kickSession(session, reason, 'moderation action');
    }
  }

  // Force-disconnect the live session (if any) for a character the requesting
  // account owns, so a fresh login can take its place. Awaits leave() so the
  // departing session's state is saved and the sessionsByCharacterId slot is
  // freed before the caller re-enters — otherwise the new login would race the
  // old save (clobbering progress) or be rejected with "character already in
  // world". Idempotent: a no-op (returns 'not-online') when nobody is online.
  async takeOverCharacter(
    accountId: number,
    characterId: number,
  ): Promise<'taken-over' | 'not-online'> {
    const session = this.sessionByCharacterId(characterId);
    // Ownership is also enforced at the REST layer; re-check here so this method
    // can never disconnect a session that belongs to another account.
    if (!session || session.accountId !== accountId) return 'not-online';
    await this.kickSession(session, 'character taken over', 'character taken over');
    return 'taken-over';
  }

  startRestartCountdown(): RestartCountdownStatus {
    if (this.restartCountdownStartedAt !== null) {
      return {
        started: false,
        active: true,
        totalSeconds: RESTART_COUNTDOWN_TOTAL_SECONDS,
        remainingSeconds: this.restartCountdownRemainingSeconds(),
      };
    }
    this.restartCountdownStartedAt = Date.now();
    for (const step of RESTART_COUNTDOWN_STEPS) {
      if (step.atSeconds === 0) {
        this.broadcastSystem(step.text);
        continue;
      }
      const timer = setTimeout(() => {
        this.broadcastSystem(step.text);
        if (step.atSeconds === RESTART_COUNTDOWN_TOTAL_SECONDS) this.clearRestartCountdown();
      }, step.atSeconds * 1000);
      timer.unref?.();
      this.restartCountdownTimers.push(timer);
    }
    return {
      started: true,
      active: true,
      totalSeconds: RESTART_COUNTDOWN_TOTAL_SECONDS,
      remainingSeconds: RESTART_COUNTDOWN_TOTAL_SECONDS,
    };
  }

  private restartCountdownRemainingSeconds(): number {
    if (this.restartCountdownStartedAt === null) return 0;
    const elapsedSeconds = Math.floor((Date.now() - this.restartCountdownStartedAt) / 1000);
    return Math.max(0, RESTART_COUNTDOWN_TOTAL_SECONDS - elapsedSeconds);
  }

  private clearRestartCountdown(): void {
    this.restartCountdownStartedAt = null;
    this.restartCountdownTimers.length = 0;
  }

  muteAccountChat(accountId: number, mutedUntil: string, reason: string): void {
    const until = new Date(mutedUntil);
    if (!Number.isFinite(until.getTime())) return;
    for (const session of this.clients.values()) {
      if (session.accountId !== accountId) continue;
      session.chatMutedUntil = until.getTime();
      session.chatMuteReason = reason.trim();
      this.send(session, {
        t: 'events',
        list: [{ type: 'error', text: this.chatMuteMessage(session) }],
      });
    }
  }

  // -------------------------------------------------------------------------
  // Chat filter: load at boot, refresh + push to clients on admin edits, and
  // sync admin mute/strike actions to any live sessions of the target account.
  // -------------------------------------------------------------------------

  async loadChatFilter(): Promise<void> {
    try {
      this.chatFilter.load(await loadChatFilterState());
    } catch (err) {
      console.error('failed to load chat filter:', err);
    }
  }

  /** Reload word lists/config from the DB and push the new soft list to clients. */
  async reloadChatFilter(): Promise<void> {
    await this.loadChatFilter();
    const words = this.chatFilter.softWords();
    for (const session of this.clients.values()) {
      this.send(session, { t: 'censor', words });
    }
  }

  // -------------------------------------------------------------------------
  // IP blocklist
  // -------------------------------------------------------------------------

  async loadBlockedIps(): Promise<void> {
    try {
      this.ipBlockList.setEntries(await loadActiveBlockedIps());
    } catch (err) {
      console.error('failed to load blocked IPs:', err);
    }
  }

  async reloadBlockedIps(): Promise<void> {
    await this.loadBlockedIps();
  }

  isIpBlocked(ip: string): boolean {
    return this.ipBlockList.isBlocked(ip, Date.now());
  }

  disconnectByIp(ip: string, reason: string): void {
    for (const session of [...this.clients.values()]) {
      if (session.ip !== ip || session.isAdmin) continue;
      void this.kickSession(session, reason, 'moderation action');
    }
  }

  disconnectBlockedSessions(reason: string): void {
    const now = Date.now();
    for (const session of [...this.clients.values()]) {
      if (session.isAdmin || !this.ipBlockList.isBlocked(session.ip, now)) continue;
      void this.kickSession(session, reason, 'moderation action');
    }
  }

  /** Reflect an admin "lift mute" on any live sessions so chat unlocks at once. */
  liftChatMuteLive(accountId: number): void {
    for (const session of this.clients.values()) {
      if (session.accountId === accountId) {
        session.chatMutedUntil = null;
        session.chatMuteReason = '';
      }
    }
  }

  /** Reflect an admin "reset strikes" on any live sessions. */
  resetChatStrikesLive(accountId: number): void {
    for (const session of this.clients.values()) {
      if (session.accountId === accountId) session.chatStrikes = 0;
    }
  }

  // -------------------------------------------------------------------------
  // Input & commands
  // -------------------------------------------------------------------------

  handleMessage(session: ClientSession, raw: string): void {
    const receivedAtMs = Date.now();
    let msg: unknown;
    try {
      msg = JSON.parse(raw);
    } catch {
      this.botDetector.observeProtocolAnomaly(
        session.botTrackingContext,
        'invalid_json',
        raw,
        receivedAtMs,
      );
      return;
    }
    // a malformed payload must never take down the server for everyone
    try {
      this.dispatchMessage(session, msg, raw, receivedAtMs);
    } catch (err) {
      const cmd = this.messageCommand(msg);
      console.error(`bad message from ${session.name} (cmd: ${cmd}):`, err);
    }
  }

  private messageCommand(msg: unknown): string {
    if (typeof msg !== 'object' || msg === null || Array.isArray(msg)) return 'unknown';
    const record = msg as Record<string, unknown>;
    return String(record.cmd ?? record.t ?? 'unknown');
  }

  private dispatchMessage(
    session: ClientSession,
    rawMsg: unknown,
    raw: string,
    receivedAtMs: number,
  ): void {
    // JSON.parse returns null / numbers / strings / arrays for valid JSON that
    // isn't an object — `null` in particular threw on `msg.t`. Drop anything
    // that isn't a plain object before touching its fields.
    if (typeof rawMsg !== 'object' || rawMsg === null || Array.isArray(rawMsg)) {
      this.botDetector.observeProtocolAnomaly(
        session.botTrackingContext,
        'non_object',
        raw,
        receivedAtMs,
      );
      return;
    }
    const msg = rawMsg as ClientMessage;
    const sim = this.sim;
    const pid = session.pid;
    if (msg.t === 'input') {
      if (session.spectating) return;
      const meta = sim.meta(pid);
      const e = sim.entities.get(pid);
      if (!meta || !e) return;
      const frame = parseMoveInputFrame(msg);
      Object.assign(meta.moveInput, frame.moveInput);
      session.lastInputAt = sim.time;
      if (typeof msg.seq === 'number' && Number.isFinite(msg.seq) && msg.seq > 0) {
        session.lastInputSeq = Math.max(session.lastInputSeq, Math.floor(msg.seq));
      }
      if (frame.facing !== null && !e.dead) {
        e.facing = frame.facing;
      }
      this.botDetector.observeInput(session.botTrackingContext, frame, receivedAtMs);
      return;
    }
    if (msg.t !== 'cmd') {
      this.botDetector.observeProtocolAnomaly(
        session.botTrackingContext,
        'unknown_type',
        raw,
        receivedAtMs,
      );
      return;
    }
    if (session.spectating) {
      if (msg.cmd !== 'chat' || typeof msg.text !== 'string') return;
      const text = msg.text.trim();
      if (session.isAdmin && this.moderation.handleChatCommand(session, text)) return;
      if (this.isSpectateLocalChat(session, text)) {
        this.sendChatNotice(session, 'Local chat is unavailable while spectating.');
        return;
      }
    }
    this.botDetector.observeCommand(
      session.botTrackingContext,
      String(msg.cmd ?? ''),
      receivedAtMs,
      msg,
    );
    // W0b command-schema lockstep: cast the untyped wire token to the shared
    // CommandName union so tsc proves every `case` label below is a member of
    // COMMAND_NAMES (a typo or out-of-table token is a compile error) and that
    // the switch covers the whole vocabulary (the `never` assignment in
    // `default` reddens if a token is missing). Unknown wire input is not a
    // CommandName at runtime; it still falls through to `default` and is flagged
    // as a protocol anomaly, exactly as before.
    const command = msg.cmd as CommandName;
    // A command that can change a heavy self field forces the next snapshot to
    // re-diff those fields (combat-only commands like cast/target/attack do not,
    // which is what keeps the gating a win during a fight).
    if (typeof msg.cmd === 'string' && HEAVY_SELF_CMDS.has(msg.cmd)) session.selfHeavyDirty = true;
    switch (command) {
      case 'castSlot':
        if (typeof msg.slot === 'number') sim.castAbilityBySlot(msg.slot | 0, pid);
        break;
      case 'cast':
        if (typeof msg.ability === 'string') sim.castAbility(msg.ability, pid);
        break;
      case 'cancel_aura':
        if (typeof msg.aura === 'string') sim.cancelAura(msg.aura, pid);
        break;
      case 'target':
        sim.targetEntity(typeof msg.id === 'number' ? msg.id : null, pid);
        break;
      case 'tab':
        sim.tabTarget(pid);
        break;
      case 'targetNearest':
        sim.targetNearestEnemy(pid);
        break;
      case 'tabFriendly':
        sim.friendlyTabTarget(pid);
        break;
      case 'targetNearestFriendly':
        sim.targetNearestFriendly(pid);
        break;
      case 'attack':
        sim.startAutoAttack(pid);
        break;
      case 'stopattack':
        sim.stopAutoAttack(pid);
        break;
      case 'interact':
        sim.interact(pid);
        break;
      case 'loot':
        if (typeof msg.id === 'number') sim.lootCorpse(msg.id, pid);
        break;
      case 'lootRoll':
        if (
          typeof msg.rollId === 'number' &&
          (msg.choice === 'need' || msg.choice === 'greed' || msg.choice === 'pass')
        ) {
          sim.submitLootRoll(msg.rollId, msg.choice, pid);
        }
        break;
      case 'pickup':
        if (typeof msg.id === 'number') sim.pickUpObject(msg.id, pid);
        break;
      case 'accept':
        if (typeof msg.quest === 'string') {
          sim.acceptQuest(msg.quest, pid);
          this.resyncQuests(session);
        }
        break;
      case 'turnin':
        if (typeof msg.quest === 'string') {
          const beforeDone = sim.meta(pid)?.questsDone.has(msg.quest) ?? false;
          sim.turnInQuest(msg.quest, pid);
          const afterDone = sim.meta(pid)?.questsDone.has(msg.quest) ?? false;
          if (!beforeDone && afterDone && msg.quest === ALDRIC_METEOR_QUEST_ID) {
            this.noteAccountQuestComplete(session, msg.quest);
          }
          this.resyncQuests(session);
        }
        break;
      case 'abandon':
        if (typeof msg.quest === 'string') {
          sim.abandonQuest(msg.quest, pid);
          this.resyncQuests(session);
        }
        break;
      case 'qlinkaccept':
        if (typeof msg.quest === 'string' && typeof msg.from === 'number') {
          sim.acceptLinkedQuest(msg.quest, msg.from, pid);
          this.resyncQuests(session);
        }
        break;
      case 'equip':
        if (typeof msg.item === 'string') sim.equipItem(msg.item, pid);
        break;
      case 'unequip_item':
        if (typeof msg.slot === 'string' && (EQUIP_SLOTS as readonly string[]).includes(msg.slot)) {
          sim.unequipItem(msg.slot as EquipSlot, pid);
        }
        break;
      case 'use':
        if (typeof msg.item === 'string') {
          const result = sim.useItem(msg.item, pid);
          if (result?.type === 'mechChroma') this.noteAccountMechChroma(session, result.chromaId);
        }
        break;
      case 'discard':
        if (typeof msg.item === 'string') {
          sim.discardItem(msg.item, typeof msg.count === 'number' ? msg.count : undefined, pid);
        }
        break;
      case 'buy':
        if (typeof msg.npc === 'number' && typeof msg.item === 'string')
          sim.buyItem(msg.npc, msg.item, pid);
        break;
      case 'sell':
        if (typeof msg.item === 'string') {
          sim.sellItem(msg.item, typeof msg.count === 'number' ? msg.count : undefined, pid);
        }
        break;
      case 'buyback':
        if (typeof msg.item === 'string') sim.buyBackItem(msg.item, pid);
        break;
      case 'sell_all_junk':
        sim.sellAllJunk(pid);
        break;
      case 'change_skin':
        if (typeof msg.skin === 'number') {
          if (msg.catalog === 'mech') {
            const idx = Math.max(0, Math.floor(msg.skin));
            const chroma = MECH_CHROMAS[idx];
            if (chroma && session.accountCosmetics.mechChromaIds.includes(chroma.id)) {
              sim.setPlayerSkin(pid, idx, 'mech');
            }
          } else {
            sim.setPlayerSkin(pid, msg.skin, 'class');
          }
        }
        break;
      case 'unequip_mech_chroma':
        if (typeof msg.chroma === 'string') this.unequipAccountMechChroma(session, msg.chroma);
        break;
      // Skin-select event lock-in. The Sim re-validates the skin against the
      // rank it rolled and consumes the event token; a forged claim no-ops.
      case 'claim_event_skin':
        if (typeof msg.skin === 'number') {
          const claim = sim.claimEventSkin(msg.skin, pid);
          if (claim?.catalog === 'mech' && claim.chromaId) {
            this.noteAccountMechChroma(session, claim.chromaId);
          }
        }
        break;
      case 'release':
        sim.releaseSpirit(pid);
        break;
      case 'challengeResponse':
        if (typeof msg.n === 'string' && typeof msg.r === 'string' && typeof msg.sig === 'string') {
          if (!verifyChallenge(msg.n, msg.r, msg.sig, session.clientSeed)) break;
        }
        break;
      case 'chat': {
        if (typeof msg.text !== 'string') break;
        const text = msg.text.trim();
        if (session.isAdmin && this.moderation.handleChatCommand(session, text)) break;
        if (this.isChatMuted(session)) break;
        if (!this.consumeChatToken(session)) break;
        const whoMatch = /^\/who(?:\s+([\s\S]+))?$/i.exec(text);
        if (whoMatch) {
          // Optional filter: "/who Mr" lists only players whose name OR zone
          // contains "Mr" (case-insensitive). Zone names carry spaces
          // ("Thornpeak Heights"), so keep spaces: strip only double-quotes
          // and control chars, collapse internal whitespace, and cap the
          // length, so the echoed query stays a clean, single-line token.
          const filter = (whoMatch[1] ?? '')
            .replace(/[\p{Cc}"]/gu, '')
            .trim()
            .replace(/\s+/g, ' ')
            .slice(0, 32);
          this.sendWhoRoster(session, filter || undefined);
          break;
        }
        // Hard-word + mute enforcement gate, applied to every channel before the
        // message is routed anywhere. Soft (cosmetic) words are NOT touched here
        // — clients mask those locally when their profanity filter is on.
        if (this.enforceChatPolicy(session, text)) break;
        // "!" community commands (lfg/wts/...): broadcast in-world + cross-post to
        // Discord, then stop (not normal chat).
        if (text.startsWith('!') && this.handleRelayCommand(session, text)) break;
        // guild and officer chat are persistent + cross-zone, so they live in
        // the server's SocialService rather than the sim (no guild concept).
        // MMO convention: /g is guild; /general remains world chat.
        const gm = /^\/(?:g|gu|guild)\s+([\s\S]+)$/i.exec(text);
        const om = gm ? null : /^\/(?:o|officer)\s+([\s\S]+)$/i.exec(text);
        if (gm || om) {
          const channel = gm ? 'guild' : 'officer';
          const match = gm ?? om;
          if (!match) break;
          const body = match[1];
          session.rememberedChat = { channel };
          const route = gm
            ? this.social.guildChat(this.actorFor(session), body)
            : this.social.officerChat(this.actorFor(session), body);
          void route
            .then((sent) => {
              if (sent) {
                this.chatLog.log({
                  accountId: session.accountId,
                  characterId: session.characterId,
                  characterName: session.name,
                  channel,
                  message: body.trim().slice(0, MAX_CHAT_MESSAGE_LEN),
                });
              }
            })
            .catch((err) => console.error(`${channel} chat failed:`, err));
          break;
        }
        // /r: reply to whoever last whispered you
        const rm = /^\/(?:r|reply)\s+([\s\S]+)$/i.exec(text);
        if (rm) {
          if (!session.lastWhisperFrom) {
            this.send(session, {
              t: 'events',
              list: [{ type: 'error', text: 'No one has whispered you recently.' }],
            });
            break;
          }
          session.rememberedChat = { channel: 'whisper', target: session.lastWhisperFrom };
          this.logChat(session, sim.chat(`/w ${session.lastWhisperFrom} ${rm[1]}`, pid));
          break;
        }
        this.logChat(session, this.routeRememberedChat(session, text, pid));
        break;
      }
      case 'emote':
        if (isOverheadEmoteId(msg.emote)) sim.playEmote(msg.emote, pid);
        break;
      // party
      case 'pinvite':
        if (typeof msg.id === 'number') sim.partyInvite(msg.id, pid);
        break;
      case 'paccept':
        sim.partyAccept(pid);
        break;
      case 'pdecline':
        sim.partyDecline(pid);
        break;
      case 'pleave':
        sim.partyLeave(pid);
        break;
      case 'pkick':
        if (typeof msg.id === 'number') sim.partyKick(msg.id, pid);
        break;
      case 'ppromote':
        if (typeof msg.id === 'number') sim.partyPromote(msg.id, pid);
        break;
      case 'praid':
        sim.convertPartyToRaid(pid);
        break;
      case 'punraid':
        sim.convertRaidToParty(pid);
        break;
      case 'pmoveRaid':
        if (typeof msg.id === 'number' && (msg.group === 1 || msg.group === 2))
          sim.moveRaidMember(msg.id, msg.group, pid);
        break;
      case 'setLootMaster':
        if (
          typeof msg.enabled === 'boolean' &&
          typeof msg.looter === 'number' &&
          (msg.threshold === 'uncommon' || msg.threshold === 'rare' || msg.threshold === 'epic')
        )
          sim.setPartyLootMaster(msg.enabled, msg.looter, msg.threshold, pid);
        break;
      case 'masterAssign':
        if (
          typeof msg.rollId === 'number' &&
          Array.isArray(msg.pids) &&
          msg.pids.length > 0 &&
          msg.pids.every((p: unknown) => typeof p === 'number')
        )
          sim.assignMasterLoot(msg.rollId, msg.pids, pid);
        break;
      // raid/target markers
      case 'setMarker':
        if (typeof msg.id === 'number' && typeof msg.marker === 'number')
          sim.setMarker(msg.id, msg.marker, pid);
        break;
      case 'clearMarker':
        if (typeof msg.id === 'number') sim.clearMarker(msg.id, pid);
        break;
      // hunter pets
      case 'pet_abandon':
        sim.abandonPet(pid);
        break;
      case 'pet_rename':
        if (typeof msg.name === 'string') {
          if (offensiveName(msg.name))
            this.send(session, {
              t: 'events',
              list: [{ type: 'error', text: 'Pet name is not allowed.' }],
            });
          else sim.renamePet(msg.name, pid);
        }
        break;
      case 'pet_revive':
        sim.revivePet(pid);
        break;
      case 'pet_attack':
        sim.petAttack(pid);
        break;
      case 'pet_taunt':
        sim.petTaunt(pid);
        break;
      case 'pet_auto_taunt':
        if (typeof msg.enabled === 'boolean') sim.setPetAutoTaunt(msg.enabled, pid);
        break;
      case 'pet_feed':
        if (typeof msg.item === 'string') sim.feedPet(msg.item, pid);
        break;
      case 'pet_heal':
        sim.healPet(pid);
        break;
      case 'pet_mode':
        if (msg.mode === 'passive' || msg.mode === 'defensive' || msg.mode === 'aggressive')
          sim.setPetMode(msg.mode, pid);
        break;
      // trade
      case 'trade_req':
        if (typeof msg.id === 'number') sim.tradeRequest(msg.id, pid);
        break;
      case 'trade_accept':
        sim.tradeAccept(pid);
        break;
      case 'trade_offer':
        if (Array.isArray(msg.items)) sim.tradeSetOffer(msg.items, Number(msg.copper) || 0, pid);
        break;
      case 'trade_confirm':
        sim.tradeConfirm(pid);
        break;
      case 'trade_cancel':
        sim.tradeCancel(pid);
        break;
      // duels
      case 'duel_req':
        if (typeof msg.id === 'number') sim.duelRequest(msg.id, pid);
        break;
      case 'duel_accept':
        sim.duelAccept(pid);
        break;
      case 'duel_decline':
        sim.duelDecline(pid);
        break;
      // social: friends / ignore / guild (persistent, account-scoped)
      case 'friend_add':
        if (typeof msg.name === 'string')
          void this.social.friendAdd(this.actorFor(session), msg.name).catch(logSocialErr);
        break;
      case 'friend_remove':
        if (typeof msg.name === 'string')
          void this.social.friendRemove(this.actorFor(session), msg.name).catch(logSocialErr);
        break;
      case 'block_add':
        if (typeof msg.name === 'string')
          void this.social.blockAdd(this.actorFor(session), msg.name).catch(logSocialErr);
        break;
      case 'block_remove':
        if (typeof msg.name === 'string')
          void this.social.blockRemove(this.actorFor(session), msg.name).catch(logSocialErr);
        break;
      case 'social_refresh':
        void this.sendSocialSnapshot(session.characterId);
        break;
      case 'guild_create':
        if (typeof msg.name === 'string')
          void this.social.guildCreate(this.actorFor(session), msg.name).catch(logSocialErr);
        break;
      case 'guild_invite':
        if (typeof msg.name === 'string')
          void this.social.guildInvite(this.actorFor(session), msg.name).catch(logSocialErr);
        break;
      case 'guild_accept':
        void this.social.guildAccept(this.actorFor(session)).catch(logSocialErr);
        break;
      case 'guild_decline':
        this.social.guildDecline(this.actorFor(session));
        break;
      case 'guild_leave':
        void this.social.guildLeave(this.actorFor(session)).catch(logSocialErr);
        break;
      case 'guild_kick':
        if (typeof msg.name === 'string')
          void this.social.guildKick(this.actorFor(session), msg.name).catch(logSocialErr);
        break;
      case 'guild_promote':
        if (typeof msg.name === 'string')
          void this.social
            .guildSetRank(this.actorFor(session), msg.name, 'officer')
            .catch(logSocialErr);
        break;
      case 'guild_demote':
        if (typeof msg.name === 'string')
          void this.social
            .guildSetRank(this.actorFor(session), msg.name, 'member')
            .catch(logSocialErr);
        break;
      case 'guild_transfer':
        if (typeof msg.name === 'string')
          void this.social
            .guildTransferLeader(this.actorFor(session), msg.name)
            .catch(logSocialErr);
        break;
      case 'guild_disband':
        void this.social.guildDisband(this.actorFor(session)).catch(logSocialErr);
        break;
      // arena (Ashen Coliseum queue)
      case 'arena_queue': {
        const fmt = msg.format === '2v2' ? '2v2' : msg.format === 'fiesta' ? 'fiesta' : '1v1';
        sim.arenaQueueJoin(pid, fmt);
        break;
      }
      case 'arena_leave':
        sim.arenaQueueLeave(pid);
        break;
      case 'arena_augment': {
        if (typeof msg.augment === 'string' && msg.augment.length <= 64)
          sim.arenaAugmentPick(msg.augment, pid);
        break;
      }

      // post-cap cosmetic prestige (Max-Level XP Overflow)
      case 'prestige':
        sim.prestige(pid);
        break;

      // Talents & Specializations — every allocation re-validated in the Sim.
      case 'applyTalents': {
        const alloc = talentAllocationFromWire(msg.alloc);
        if (alloc) sim.applyTalents(alloc, pid);
        break;
      }
      case 'respec':
        sim.respec(pid);
        break;
      case 'setSpec':
        sim.setSpec(typeof msg.spec === 'string' ? msg.spec : null, pid);
        break;
      case 'saveLoadout': {
        const alloc = talentAllocationFromWire(msg.alloc) ?? undefined;
        if (typeof msg.name === 'string')
          sim.saveLoadout(msg.name, Array.isArray(msg.bar) ? msg.bar : [], pid, alloc);
        break;
      }
      case 'switchLoadout':
        if (typeof msg.index === 'number') sim.switchLoadout(msg.index | 0, pid);
        break;
      case 'deleteLoadout':
        if (typeof msg.index === 'number') sim.deleteLoadout(msg.index | 0, pid);
        break;
      // World Market (the Merchant's auction house)
      case 'market_search':
        sim.marketSearch(
          sanitizeMarketQuery({
            search: typeof msg.q === 'string' ? msg.q : '',
            itemType: msg.itemType,
            subtype: msg.subtype,
            rarity: msg.rarity,
            page: typeof msg.page === 'number' ? msg.page : 0,
          }),
          pid,
        );
        break;
      case 'market_list':
        if (
          typeof msg.item === 'string' &&
          typeof msg.count === 'number' &&
          Number.isFinite(msg.count) &&
          typeof msg.price === 'number' &&
          Number.isFinite(msg.price)
        ) {
          sim.marketList(msg.item, msg.count, msg.price, pid);
        }
        break;
      case 'market_buy':
        if (typeof msg.id === 'number') sim.marketBuy(msg.id, pid);
        break;
      case 'market_cancel':
        if (typeof msg.id === 'number') sim.marketCancel(msg.id, pid);
        break;
      case 'market_collect':
        sim.marketCollect(pid);
        break;
      // dev/ops commands, only when ALLOW_DEV_COMMANDS=1 (never in production)
      case 'dev_level': {
        if (process.env.ALLOW_DEV_COMMANDS === '1' && typeof msg.level === 'number') {
          sim.setPlayerLevel(msg.level, pid);
        }
        break;
      }
      case 'dev_teleport': {
        if (
          process.env.ALLOW_DEV_COMMANDS === '1' &&
          typeof msg.x === 'number' &&
          typeof msg.z === 'number'
        ) {
          const e = sim.entities.get(pid);
          if (e) {
            const p = sim.groundPos(msg.x, msg.z);
            e.pos = p;
            e.prevPos = { ...p };
            sim.grid.update(e);
            sim.playerGrid.update(e);
          }
        }
        break;
      }
      case 'dev_give': {
        if (process.env.ALLOW_DEV_COMMANDS === '1' && typeof msg.item === 'string') {
          const count = typeof msg.count === 'number' ? msg.count : 1;
          sim.addItem(msg.item, Math.max(1, Math.min(20, count | 0)), pid);
        }
        break;
      }
      case 'dev_complete_quest': {
        if (process.env.ALLOW_DEV_COMMANDS === '1' && typeof msg.quest === 'string') {
          const beforeDone = sim.meta(pid)?.questsDone.has(msg.quest) ?? false;
          sim.completeQuestForDev(msg.quest, pid);
          const afterDone = sim.meta(pid)?.questsDone.has(msg.quest) ?? false;
          if (!beforeDone && afterDone && msg.quest === ALDRIC_METEOR_QUEST_ID) {
            this.noteAccountQuestComplete(session, msg.quest);
          }
          this.resyncQuests(session);
        }
        break;
      }
      case 'dev_complete_all_quests': {
        if (process.env.ALLOW_DEV_COMMANDS === '1') {
          const beforeDone = sim.meta(pid)?.questsDone.has(ALDRIC_METEOR_QUEST_ID) ?? false;
          sim.completeCurrentQuestsForDev(pid);
          const afterDone = sim.meta(pid)?.questsDone.has(ALDRIC_METEOR_QUEST_ID) ?? false;
          if (!beforeDone && afterDone) {
            this.noteAccountQuestComplete(session, ALDRIC_METEOR_QUEST_ID);
          }
          this.resyncQuests(session);
        }
        break;
      }
      // dungeons ('enter_crypt'/'leave_crypt' kept as aliases for older bots)
      case 'enter_crypt':
      case 'enter_dungeon': {
        // must actually be near that dungeon's door
        const dungeonId = msg.cmd === 'enter_crypt' ? 'hollow_crypt' : msg.dungeon;
        if (typeof dungeonId !== 'string') break;
        const e = sim.entities.get(pid);
        const door = [...sim.entities.values()].find(
          (x) => x.templateId === 'dungeon_door' && x.dungeonId === dungeonId,
        );
        if (e && door && Math.hypot(e.pos.x - door.pos.x, e.pos.z - door.pos.z) < 8)
          sim.enterDungeon(dungeonId, pid);
        break;
      }
      case 'leave_crypt':
      case 'leave_dungeon': {
        const e = sim.entities.get(pid);
        const exit = e
          ? [...sim.entities.values()].find(
              (x) =>
                x.templateId === 'dungeon_exit' &&
                Math.hypot(e.pos.x - x.pos.x, e.pos.z - x.pos.z) < 8,
            )
          : null;
        if (exit) sim.leaveDungeon(pid);
        break;
      }
      case 'enter_delve': {
        if (typeof msg.delveId !== 'string' || typeof msg.tierId !== 'string') break;
        const e = sim.entities.get(pid);
        const delve = DELVES[msg.delveId];
        if (!e || !delve || e.dead) break;
        if (Math.hypot(e.pos.x - delve.doorPos.x, e.pos.z - delve.doorPos.z) > 12) break;
        sim.enterDelve(msg.delveId, msg.tierId, pid);
        this.resyncDelves(session);
        break;
      }
      case 'leave_delve': {
        const e = sim.entities.get(pid);
        if (!e || !sim.delveRunForPlayer(pid)) break;
        sim.leaveDelve(pid);
        this.resyncDelves(session);
        break;
      }
      case 'delve_interact': {
        if (typeof msg.objectId !== 'number') break;
        sim.delveInteract(msg.objectId, pid);
        break;
      }
      case 'companion_upgrade': {
        if (typeof msg.companionId !== 'string') break;
        const e = sim.entities.get(pid);
        if (!e || e.dead) break;
        // Geo-gate to the board NPC (at the delve door), like enter_delve / delve_buy:
        // the companion is ranked up at Brother Halven, not from anywhere in the world.
        const delve = Object.values(DELVES).find((d) => d.autoCompanionId === msg.companionId);
        if (!delve || Math.hypot(e.pos.x - delve.doorPos.x, e.pos.z - delve.doorPos.z) > 12) break;
        sim.companionUpgrade(msg.companionId, pid);
        break;
      }
      case 'delve_buy': {
        if (typeof msg.delveId !== 'string' || typeof msg.itemId !== 'string') break;
        const e = sim.entities.get(pid);
        const delve = DELVES[msg.delveId];
        if (!e || !delve || e.dead) break;
        // Geo-gate to the board NPC (at the delve door), like enter_delve.
        if (Math.hypot(e.pos.x - delve.doorPos.x, e.pos.z - delve.doorPos.z) > 12) break;
        sim.delveBuyShopItem(msg.delveId, msg.itemId, pid);
        this.resyncDelves(session);
        break;
      }
      case 'lockpick_engage': {
        if (typeof msg.objectId !== 'number') break;
        if (msg.ante !== 1 && msg.ante !== 2 && msg.ante !== 3) break;
        sim.lockpickEngage(msg.objectId, msg.ante, pid);
        break;
      }
      case 'lockpick_action': {
        if (!isPickAction(msg.action)) break;
        const sid = typeof msg.sid === 'string' ? msg.sid : undefined;
        sim.lockpickAction(msg.action, pid, sid);
        break;
      }
      case 'lockpick_abort': {
        const sid = typeof msg.sid === 'string' ? msg.sid : undefined;
        sim.lockpickAbort(pid, sid);
        break;
      }
      case 'collect_delve_chest_loot': {
        if (typeof msg.objectId !== 'number') break;
        sim.collectDelveChestLoot(msg.objectId, pid);
        break;
      }
      // client telemetry should not be considered as unknown command. Used for offline stats computing.
      case 'telemetry':
        break;
      default: {
        // Exhaustiveness guard: `command` is `never` here when the cases above
        // cover every CommandName. At runtime an unrecognised wire token lands
        // in this branch (the cast above is the deliberate boundary) and is
        // reported as a protocol anomaly, unchanged from before.
        const _exhaustive: never = command;
        void _exhaustive;
        this.botDetector.observeProtocolAnomaly(
          session.botTrackingContext,
          'unknown_command',
          raw,
          receivedAtMs,
        );
      }
    }
  }

  // -------------------------------------------------------------------------
  // Snapshots & events
  // -------------------------------------------------------------------------

  private broadcastSnapshots(): void {
    if (this.clients.size === 0) return;
    const tick = this.sim.tickCount;
    const head = `{"t":"snap","tick":${tick},"time":${round2(this.sim.time)}`;
    // Guard each session: a throw while building one player's snapshot must not
    // starve every other session of its snapshot this tick (server/CLAUDE.md).
    forEachGuarded(
      this.clients.values(),
      (session) => {
        const p = this.sim.entities.get(session.pid);
        const meta = this.sim.meta(session.pid);
        if (!p || !meta) return;
        let anchorEntity = p;
        let anchorMeta = meta;
        let anchorSession = session;
        if (session.spectating) {
          const spectateName = session.spectating.name;
          const target = this.sessionByCharacterId(session.spectating.characterId);
          const targetEntity = target ? this.sim.entities.get(target.pid) : null;
          const targetMeta = target ? this.sim.meta(target.pid) : null;
          if (!target || target.left || !targetEntity || !targetMeta) {
            this.exitSpectate(session, false);
            this.sendChatNotice(session, `${spectateName} is no longer online; spectate ended.`);
          } else {
            anchorEntity = targetEntity;
            anchorMeta = targetMeta;
            anchorSession = target;
          }
        }
        const ents: string[] = [];
        const keep: number[] = [];
        const present = new Set<number>();
        const gridStart = this.profileBroadcastPhases ? process.hrtime.bigint() : 0n;
        this.sim.grid.forEachInRadius(
          anchorEntity.pos.x,
          anchorEntity.pos.z,
          INTEREST_QUERY_RADIUS,
          (e, d2) => {
            if (this.profileBroadcastPhases) this.bcVisits++;
            if (e.id === anchorEntity.id) return;
            if (!this.canObserveEntity(anchorEntity, e, d2)) return;
            const known = session.sentEnts.get(e.id);
            // the viewer's current target stays in interest to the widest drop
            // radius so its unit frame doesn't vanish mid-chase
            const limitSq =
              anchorEntity.targetId === e.id
                ? NPC_DROP_RADIUS * NPC_DROP_RADIUS
                : interestLimitSq(e, known !== undefined);
            if (d2 > limitSq) return;
            present.add(e.id);
            const cache = this.wireCacheFor(e);
            if (known === undefined) {
              // first sight carries the at-rest state exactly, so no settle
              // record is owed until it moves again
              ents.push(cache.fullJson);
              session.sentEnts.set(e.id, {
                idVer: cache.idVer,
                dynVer: cache.dynVer,
                sentAtTick: tick,
                settled: true,
              });
              return;
            }
            if (known.idVer !== cache.idVer) {
              ents.push(cache.fullJson);
              known.idVer = cache.idVer;
              known.dynVer = cache.dynVer;
              known.sentAtTick = tick;
              known.settled = false;
              return;
            }
            if (
              !isUpdateDue(tick, e, d2, anchorEntity, known.sentAtTick) ||
              (known.dynVer === cache.dynVer && known.settled)
            ) {
              // not due at this distance tier yet, or unchanged and already
              // settled: a bare id keeps it alive on the client
              keep.push(e.id);
              return;
            }
            // due, and either changed or owing its one settle record
            known.settled = known.dynVer === cache.dynVer;
            known.dynVer = cache.dynVer;
            known.sentAtTick = tick;
            ents.push(cache.liteJson);
          },
        );
        // forget entities that left interest, so a re-entry sends identity again
        for (const id of session.sentEnts.keys()) {
          if (!present.has(id)) session.sentEnts.delete(id);
        }
        const selfStart = this.profileBroadcastPhases ? process.hrtime.bigint() : 0n;
        if (this.profileBroadcastPhases) this.bcastGridNs += selfStart - gridStart;
        const selfJson = this.selfWireJson(session, anchorEntity, anchorMeta, anchorSession);
        if (this.profileBroadcastPhases) this.bcastSelfNs += process.hrtime.bigint() - selfStart;
        const keepJson = keep.length > 0 ? `,"keep":[${keep.join(',')}]` : '';
        this.sendRaw(session, `${head},"self":${selfJson},"ents":[${ents.join(',')}]${keepJson}}`);
      },
      (err, session) =>
        console.error(`[snap] failed to build snapshot for pid ${session.pid}, skipping:`, err),
    );
    // >= rather than a modulo check: catch-up broadcasts can skip ticks
    if (tick - this.lastWireSweepTick >= WIRE_CACHE_SWEEP_TICKS) {
      this.lastWireSweepTick = tick;
      this.sweepWireCache();
    }
  }

  private canObserveEntity(viewer: Entity, e: Entity, d2: number): boolean {
    if (e.kind !== 'player' || !isStealthed(e)) return true;
    if (this.sim.isHostileTo(viewer, e)) return false;
    const party = this.sim.partyOf(viewer.id);
    const sameParty = party?.members.includes(e.id) ?? false;
    const duel = this.sim.duelFor(viewer.id);
    const duelingEachOther = duel !== null && (duel.a === e.id || duel.b === e.id);
    if (sameParty && !duelingEachOther) return true;
    const radius = stealthDetectionRadius(viewer, e, INTEREST_RADIUS);
    return d2 <= radius * radius;
  }

  // each entity is serialized at most once per tick, shared by every
  // recipient whose interest area contains it
  private wireCacheFor(e: Entity): EntityWireCache {
    let cache = this.wireCache.get(e.id);
    if (!cache) {
      cache = {
        tick: -1,
        idJson: '',
        dynJson: '',
        idVer: 0,
        dynVer: 0,
        fullJson: '',
        liteJson: '',
      };
      this.wireCache.set(e.id, cache);
    }
    if (cache.tick === this.sim.tickCount) return cache;
    cache.tick = this.sim.tickCount;
    const t0 = this.profileBroadcastPhases ? process.hrtime.bigint() : 0n;
    const idJson = JSON.stringify(identityFields(e));
    const dynJson = JSON.stringify(dynamicFields(e));
    let changed = false;
    if (idJson !== cache.idJson) {
      cache.idJson = idJson;
      cache.idVer++;
      changed = true;
    }
    if (dynJson !== cache.dynJson) {
      cache.dynJson = dynJson;
      cache.dynVer++;
      changed = true;
    }
    if (changed) {
      cache.fullJson = `{"id":${e.id},${idJson.slice(1, -1)},${dynJson.slice(1, -1)}}`;
      cache.liteJson = `{"id":${e.id},${dynJson.slice(1, -1)}}`;
    }
    if (this.profileBroadcastPhases) {
      this.bcSerializeNs += process.hrtime.bigint() - t0;
      this.bcSerializes++;
    }
    return cache;
  }

  private sweepWireCache(): void {
    for (const id of this.wireCache.keys()) {
      if (!this.sim.entities.has(id)) this.wireCache.delete(id);
    }
  }

  private selfWireJson(
    session: ClientSession,
    p: Entity,
    meta: PlayerMeta,
    anchorSession: ClientSession = session,
  ): string {
    const self = wireEntity(p);
    Object.assign(self, {
      res: Math.round(p.resource * 10) / 10,
      mres: p.maxResource,
      rtype: p.resourceType,
      xp: meta.xp,
      lxp: meta.lifetimeXp,
      rxp: Math.round(meta.restedXp),
      prk: meta.prestigeRank,
      copper: meta.copper,
      gcd: round2(p.gcdRemaining),
      pcd: round2(p.potionCdRemaining),
      swing: round2(p.swingTimer),
      combo: p.comboPoints,
      comboTgt: p.comboTargetId,
      target: p.targetId,
      auto: p.autoAttack,
      queued: p.queuedOnSwing,
      ap: p.attackPower,
      sp: p.spellPower,
      crit: p.critChance,
      dodge: p.dodgeChance,
      eat: p.eating ? { remaining: round2(p.eating.remaining) } : null,
      drk: p.drinking ? { remaining: round2(p.drinking.remaining) } : null,
      opUntil: p.overpowerUntil > this.sim.time ? 1 : 0,
      ack: session.spectating ? 0 : anchorSession.lastInputSeq,
    });
    const json = JSON.stringify(self);
    // heavy, rarely-changing fields ride along only when their serialized
    // form differs from what this session last received; the client treats
    // an absent field as "unchanged" (a fresh session always gets them all)
    const sent = session.lastSent;
    let extra = '';
    const maybe = (key: string, value: unknown): void => {
      const s = JSON.stringify(value ?? null);
      if (sent[key] !== s) {
        sent[key] = s;
        extra += `,"${key}":${s}`;
      }
    };
    // Dynamic / latency-sensitive fields: diffed every tick. These change from
    // outside this session's own commands/events, party member HP from another
    // player taking damage, cooldowns counting down, an incoming trade/duel,
    // so they can't be gated behind this session's dirty flag. They're also
    // cheap (mostly null, or a small map) so the per-tick diff is negligible.
    // Raid lockouts as {dungeonId: expiryEpochMs}, future-only. Absolute expiry
    // (not a countdown) so the serialized form is stable between resets and the
    // delta guard ships it only on grant / reset / expiry; the client derives the
    // remaining time from its own clock. Small, and granted from sim events that
    // don't mark this session dirty, so kept per-tick rather than gated.
    maybe(
      'lockouts',
      Object.fromEntries([...meta.raidLockouts].filter(([, until]) => until > Date.now())),
    );
    maybe('cds', Object.fromEntries([...p.cooldowns.entries()].map(([k, v]) => [k, round2(v)])));
    maybe('stats', p.stats);
    maybe('weapon', p.weapon);
    maybe('party', this.partyWire(anchorSession.pid));
    maybe('marks', this.markersWire(anchorSession.pid));
    maybe('trade', this.tradeWire(anchorSession.pid));
    maybe('duel', this.duelWire(anchorSession.pid));
    if (this.sim.tickCount - session.lastArenaWireTick >= ARENA_WIRE_INTERVAL_TICKS) {
      session.lastArenaWireTick = this.sim.tickCount;
      maybe('arena', this.sim.arenaInfoFor(anchorSession.pid));
    }
    // market info is null unless the player is standing at the Merchant, so it
    // only rides the wire for players actually browsing the World Market
    maybe('market', this.sim.marketInfoFor(anchorSession.pid));
    // open need-greed rolls this player can still answer, so a client that
    // missed the transient lootRoll event re-shows the prompt from state. Stays
    // per-tick (it's interactive state that appears from others' actions).
    maybe('lroll', this.sim.activeLootRolls(anchorSession.pid));
    maybe('drun', this.sim.delveRunWire(anchorSession.pid));
    maybe('dcompanion', this.sim.delveCompanionWire(anchorSession.pid));
    maybe('dmarks', this.sim.delveMarksFor(anchorSession.pid));
    maybe('dcomp', this.sim.companionUpgradesFor(anchorSession.pid));
    maybe('dclears', this.sim.delveClearsFor(anchorSession.pid));
    maybe('delveDaily', this.sim.delveDailyWire(anchorSession.pid));
    // stats + weapon stay per-tick: recalcPlayerStats re-derives them on every
    // stat-affecting aura gain/loss (Bear/Cat Form, shouts, debuffs, elixir
    // wear-off, a buff cast on you by someone else), none of which mark this
    // session dirty, gating them would lag the character sheet mid-fight. Both
    // are tiny (a handful of numbers), so the per-tick diff is negligible.
    maybe('stats', p.stats);
    maybe('weapon', p.weapon);
    // Heavy, rarely-changing fields: building + stringifying these every tick for
    // every player is the dominant avoidable broadcast cost. Skip them unless a
    // heavy command/event marked this session dirty, or its staggered safety
    // refresh is due (the modulo is offset by pid so refreshes don't all land on
    // the same tick and re-create a synchronized spike).
    const heavyDue =
      !this.heavySelfGate ||
      session.selfHeavyDirty ||
      meta.wireRev !== session.lastWireRev ||
      (this.sim.tickCount + session.pid) % HEAVY_SELF_REFRESH_TICKS === 0;
    if (heavyDue) {
      session.selfHeavyDirty = false;
      session.lastWireRev = meta.wireRev;
      maybe('inv', meta.inventory);
      maybe('buyback', meta.vendorBuyback);
      maybe('equip', meta.equipment);
      maybe('cosmetics', anchorSession.accountCosmetics);
      maybe('qlog', [...meta.questLog.values()]);
      maybe('qdone', [...meta.questsDone]);
      maybe('milestones', [...meta.unlockedMilestones]);
      // talents/spec/loadouts: the client recomputes its known abilities from this.
      maybe('tal', {
        alloc: meta.talents,
        spec: meta.talentMods.spec,
        role: meta.talentMods.role,
        loadouts: meta.loadouts,
        activeLoadout: meta.activeLoadout,
      });
    }
    return extra === '' ? json : `${json.slice(0, -1)}${extra}}`;
  }

  private partyWire(pid: number): unknown {
    const party = this.sim.partyOf(pid);
    if (!party) return null;
    return {
      leader: party.leader,
      raid: party.raid,
      master: { ...party.lootStrategies.master },
      members: party.members
        .map((mPid) => {
          const meta = this.sim.meta(mPid);
          const e = this.sim.entities.get(mPid);
          const pos = this.clients.get(mPid)?.spectating?.savedPos ?? e?.pos;
          return meta && e && pos
            ? {
                pid: mPid,
                name: meta.name,
                cls: meta.cls,
                level: e.level,
                hp: e.hp,
                mhp: e.maxHp,
                res: Math.round(e.resource),
                mres: e.maxResource,
                rtype: e.resourceType,
                x: round2(pos.x),
                z: round2(pos.z),
                dead: e.dead ? 1 : 0,
                inCombat: e.inCombat ? 1 : 0,
                group: party.raidGroups.get(mPid) ?? 1,
              }
            : null;
        })
        .filter(Boolean),
    };
  }

  // Raid markers the player's party can see, as { entityId: markerId }; null
  // when the player is in no party. Pure read — the sim owns marker cleanup.
  private markersWire(pid: number): unknown {
    const party = this.sim.partyOf(pid);
    if (!party) return null;
    return this.sim.markersFor(pid);
  }

  private tradeWire(pid: number): unknown {
    const t = this.sim.tradeFor(pid);
    if (!t) return null;
    const mine = t.a === pid;
    const otherPid = mine ? t.b : t.a;
    const other = this.sim.meta(otherPid);
    return {
      otherPid,
      otherName: other?.name ?? '?',
      myOffer: mine ? t.offerA : t.offerB,
      theirOffer: mine ? t.offerB : t.offerA,
      myAccepted: mine ? t.acceptedA : t.acceptedB,
      theirAccepted: mine ? t.acceptedB : t.acceptedA,
    };
  }

  private duelWire(pid: number): unknown {
    const d = this.sim.duelFor(pid);
    if (!d) return null;
    const otherPid = d.a === pid ? d.b : d.a;
    return { otherPid, otherName: this.sim.meta(otherPid)?.name ?? '?', state: d.state };
  }

  // Public profile URL for a character name, or null when no public origin is set.
  private profileUrlFor(name: string): string | null {
    return REALM_PUBLIC_ORIGIN ? `${REALM_PUBLIC_ORIGIN}/c/${encodeURIComponent(name)}` : null;
  }

  // Scan a tick's events for "significant activity" (max-level ding, rare drop,
  // duel result, arena win) and enqueue a card for the Discord bot to post. The
  // drain endpoint resolves which players are linked and tags them; the queue
  // dedupes so one moment yields one card.
  private detectActivity(events: SimEvent[]): void {
    const now = Date.now();
    for (const ev of events) {
      if (ev.type === 'levelup' && ev.level === MAX_LEVEL && ev.pid !== undefined) {
        const s = this.clients.get(ev.pid);
        if (!s) continue;
        enqueueActivity(
          {
            kind: 'levelup',
            accountIds: [s.accountId],
            names: [s.name],
            realm: REALM,
            profileUrl: this.profileUrlFor(s.name),
            level: ev.level,
          },
          `levelup:${s.accountId}`,
          now,
        );
      } else if (
        (ev.type === 'lootRoll' || ev.type === 'masterLoot') &&
        (ev.quality === 'epic' || ev.quality === 'legendary')
      ) {
        // A genuinely rare item dropped (roll-worthy); one card per drop (rollId).
        const s = ev.pid !== undefined ? this.clients.get(ev.pid) : undefined;
        enqueueActivity(
          {
            kind: 'rareloot',
            accountIds: s ? [s.accountId] : [],
            names: s ? [s.name] : [],
            realm: REALM,
            profileUrl: s ? this.profileUrlFor(s.name) : null,
            itemName: ev.itemName,
            quality: ev.quality,
          },
          `rareloot:${ev.rollId}`,
          now,
        );
      } else if (ev.type === 'duelEnd') {
        const w = this.sessionByName(ev.winnerName);
        const l = this.sessionByName(ev.loserName);
        const accountIds: number[] = [];
        const names: string[] = [];
        if (w) {
          accountIds.push(w.accountId);
          names.push(w.name);
        }
        if (l) {
          accountIds.push(l.accountId);
          names.push(l.name);
        }
        enqueueActivity(
          {
            kind: 'duel',
            accountIds,
            names,
            realm: REALM,
            profileUrl: this.profileUrlFor(ev.winnerName),
            winnerName: ev.winnerName,
            loserName: ev.loserName,
          },
          `duel:${ev.winnerName}:${ev.loserName}`,
          now,
        );
      } else if (ev.type === 'arenaEnd' && ev.won && !ev.draw && ev.pid !== undefined) {
        const s = this.clients.get(ev.pid);
        if (!s) continue;
        enqueueActivity(
          {
            kind: 'arena',
            accountIds: [s.accountId],
            names: [s.name],
            realm: REALM,
            profileUrl: this.profileUrlFor(s.name),
            ratingDelta: ev.ratingAfter - ev.ratingBefore,
          },
          `arena:${s.accountId}:${ev.ratingAfter}`,
          now,
        );
      }
    }
  }

  private routeEvents(events: SimEvent[]): void {
    if (events.length === 0 || this.clients.size === 0) return;
    const eventTime = Date.now();
    // Guard each session: a throw while routing events to one player must not
    // drop this tick's events for every other session (server/CLAUDE.md).
    forEachGuarded(
      this.clients.values(),
      (session) => {
        const p = this.sim.entities.get(session.pid);
        if (!p) return;
        let anchorPid = session.pid;
        let anchorPos = p.pos;
        if (session.spectating) {
          const target = this.sessionByCharacterId(session.spectating.characterId);
          const targetEntity = target ? this.sim.entities.get(target.pid) : null;
          if (!target || target.left || !targetEntity) return;
          anchorPid = target.pid;
          anchorPos = targetEntity.pos;
        }
        const mine: SimEvent[] = [];
        for (const ev of events) {
          // ignore list: drop chat originating from a character this player has
          // blocked, before it ever reaches their client
          if (
            !session.spectating &&
            ev.type === 'chat' &&
            session.blockedIds.size > 0 &&
            this.isBlockedSender(session, ev.fromPid)
          )
            continue;
          if (ev.pid !== undefined) {
            if (
              session.spectating &&
              ev.pid === session.pid &&
              ev.type === 'chat' &&
              ev.channel !== 'say' &&
              ev.channel !== 'yell'
            ) {
              if (this.isBlockedSender(session, ev.fromPid)) continue;
              mine.push(ev);
              if (ev.channel === 'whisper' && ev.to === undefined && ev.fromPid !== session.pid) {
                session.lastWhisperFrom = ev.from;
              }
              this.botDetector.observeEvent(session.botTrackingContext, ev, eventTime);
              continue;
            }
            if (ev.pid === anchorPid) {
              if (
                session.spectating &&
                ev.type === 'chat' &&
                ev.channel !== 'say' &&
                ev.channel !== 'yell'
              ) {
                continue;
              }
              mine.push(ev);
              // a sim-driven change to a heavy self field (loot, level-up, quest
              // credit, ...) refreshes those fields on the next snapshot
              if (HEAVY_SELF_EVENTS.has(ev.type)) session.selfHeavyDirty = true;
              // remember the last person to whisper us, for /r reply (the
              // recipient copy of a whisper has no `to`; the sender echo does)
              if (
                ev.type === 'chat' &&
                ev.channel === 'whisper' &&
                ev.to === undefined &&
                ev.fromPid !== session.pid &&
                !session.spectating
              ) {
                session.lastWhisperFrom = ev.from;
              }
              if (!session.spectating) {
                this.botDetector.observeEvent(session.botTrackingContext, ev, eventTime);
              }
            }
            continue;
          }
          // world events: only those near this player
          const anchor = this.eventAnchor(ev);
          if (anchor === null || dist2d(anchorPos, anchor) <= EVENT_RADIUS) {
            mine.push(ev);
          }
        }
        if (mine.length > 0) this.send(session, { t: 'events', list: mine });
      },
      (err, session) =>
        console.error(`[events] failed to route events for pid ${session.pid}, skipping:`, err),
    );
  }

  // Maps a chat event's source pid to its character id and checks the
  // recipient's ignore set. Self-echoes (fromPid === own pid) are never
  // blocked so you always see your own messages.
  private isBlockedSender(recipient: ClientSession, fromPid: number): boolean {
    if (fromPid === recipient.pid) return false;
    const sender = this.clients.get(fromPid);
    return sender ? recipient.blockedIds.has(sender.characterId) : false;
  }

  private eventAnchor(ev: SimEvent): { x: number; y: number; z: number } | null {
    let id: number | undefined;
    if ('targetId' in ev && typeof ev.targetId === 'number') id = ev.targetId;
    else if ('entityId' in ev && typeof ev.entityId === 'number') id = ev.entityId;
    if (id === undefined) return null; // chat/log etc: broadcast
    return this.sim.entities.get(id)?.pos ?? null;
  }

  private isSpectateLocalChat(session: ClientSession, text: string): boolean {
    if (/^\/(?:s|say|y|yell)(?:\s|$)/i.test(text)) return true;
    if (text.startsWith('/')) return false;
    return session.rememberedChat.channel === 'say' || session.rememberedChat.channel === 'yell';
  }

  private routeRememberedChat(
    session: ClientSession,
    rawText: string,
    pid: number,
  ): import('../src/sim/sim').SentChat | null {
    const text = rawText.trim();
    if (!text) return null;
    // Dev-only: force this character's $WOC holder-tier flair so the in-world
    // nameplate badge can be exercised without a funded linked wallet. Gated by
    // ALLOW_DEV_COMMANDS (never set in production). Reset on the next balance
    // refresh or rejoin.
    if (process.env.ALLOW_DEV_COMMANDS === '1' && /^\/woctier\b/.test(text)) {
      const n = Math.max(0, Math.min(10, parseInt(text.split(/\s+/)[1] ?? '', 10) || 0));
      const e = this.sim.entities.get(pid);
      if (e) {
        e.holderTier = n;
        // Demo balance so the inspect readout shows a plausible amount for the tier.
        e.holderBalance = n > 0 ? 10 ** (n - 1) : 0;
      }
      this.devTierPids.add(pid); // keep the chain refresh from clobbering it
      this.broadcastSystem(`[dev] ${session.name} $WOC holder tier → ${n}`);
      return null;
    }
    if (!text.startsWith('/')) {
      const body = text;
      if (!body.trim()) return null;
      switch (session.rememberedChat.channel) {
        case 'guild':
        case 'officer': {
          const channel = session.rememberedChat.channel;
          const route =
            channel === 'guild'
              ? this.social.guildChat(this.actorFor(session), body)
              : this.social.officerChat(this.actorFor(session), body);
          void route
            .then((sent) => {
              if (sent) {
                this.chatLog.log({
                  accountId: session.accountId,
                  characterId: session.characterId,
                  characterName: session.name,
                  channel,
                  message: body.trim().slice(0, MAX_CHAT_MESSAGE_LEN),
                });
              }
            })
            .catch((err) => console.error(`${channel} chat failed:`, err));
          return null;
        }
        case 'whisper':
          return this.sim.chat(`/w ${session.rememberedChat.target} ${body}`, pid);
        case 'party':
          return this.sim.chat(`/p ${body}`, pid);
        case 'general':
          return this.sim.chat(`/general ${body}`, pid);
        case 'world':
          return this.sim.chat(`/world ${body}`, pid);
        case 'lfg':
          return this.sim.chat(`/lfg ${body}`, pid);
        case 'yell':
          return this.sim.chat(`/y ${body}`, pid);
        case 'say':
          return this.sim.chat(body, pid);
      }
    }

    const sent = this.sim.chat(text, pid);
    if (sent) {
      if (sent.channel === 'whisper') {
        if (sent.target) session.rememberedChat = { channel: 'whisper', target: sent.target };
      } else {
        session.rememberedChat = { channel: sent.channel };
      }
    }
    return sent;
  }

  private logChat(session: ClientSession, sent: import('../src/sim/sim').SentChat | null): void {
    if (!sent) return;
    this.chatLog.log({
      accountId: session.accountId,
      characterId: session.characterId,
      characterName: session.name,
      channel: sent.channel,
      message: sent.message,
    });
  }

  // One-off, player-facing chat notice (reuses the generic error event path the
  // client already renders for rate-limit / cooldown messages).
  private sendChatNotice(session: ClientSession, text: string): void {
    this.send(session, { t: 'events', list: [{ type: 'error', text }] });
  }

  private sendSystemNotice(session: ClientSession, text: string): void {
    this.send(session, { t: 'events', list: [{ type: 'log', text, color: '#ffd100' }] });
  }

  /**
   * Enforce the hard-word + mute policy on an outgoing chat message. Returns
   * true when the message must be dropped (sender is muted, or it contained a
   * slur). Soft/cosmetic words are deliberately untouched here — those are a
   * client-side display choice. Applies to every channel because it runs before
   * the message is routed.
   */
  private enforceChatPolicy(session: ClientSession, text: string): boolean {
    const now = Date.now();
    if ((session.chatMutedUntil ?? 0) > now) {
      this.sendChatNotice(
        session,
        `You are muted and can't chat for another ${formatDuration(((session.chatMutedUntil ?? now) - now) / 1000)}.`,
      );
      return true;
    }
    const hit = this.chatFilter.findHardHit(text);
    if (!hit) return false;

    const outcome = this.chatFilter.escalate(session.chatStrikes);
    const channel = chatChannelHint(session, text);
    // Optimistically advance the session so a rapid follow-up is already gated;
    // the DB write below returns the authoritative values and corrects any drift
    // (e.g. a second character on the same account raising strikes concurrently).
    session.chatStrikes = outcome.strikes;
    if (outcome.kind === 'mute') {
      session.chatMutedUntil = now + outcome.muteSeconds * 1000;
      session.chatMuteReason = 'Chat filter enforcement';
      this.sendChatNotice(
        session,
        `That language isn't allowed here. You're muted for ${formatDuration(outcome.muteSeconds)}.`,
      );
    } else {
      this.sendChatNotice(
        session,
        `Warning: that language isn't allowed here. Continued use will mute you.`,
      );
    }

    void applyChatStrike(session.accountId, outcome.muteSeconds)
      .then((applied) => {
        session.chatStrikes = applied.strikes;
        session.chatMutedUntil = applied.chatMutedUntil
          ? new Date(applied.chatMutedUntil).getTime()
          : session.chatMutedUntil;
      })
      .catch((err) => console.error('applyChatStrike failed:', err));
    void recordChatViolation({
      accountId: session.accountId,
      characterId: session.characterId,
      characterName: session.name,
      term: hit,
      channel,
      message: text,
      action: outcome.kind,
      muteSeconds: outcome.muteSeconds,
    }).catch((err) => console.error('recordChatViolation failed:', err));
    return true;
  }

  private consumeChatToken(session: ClientSession): boolean {
    const now = Date.now() / 1000;
    if (session.chatCooldownUntil > now) {
      if (now - session.chatLastRateError >= CHAT_RATE_ERROR_COOLDOWN_SECONDS) {
        session.chatLastRateError = now;
        const remaining = Math.ceil(session.chatCooldownUntil - now);
        this.send(session, {
          t: 'events',
          list: [{ type: 'error', text: `Chat is on cooldown for ${remaining}s.` }],
        });
      }
      return false;
    }
    if (session.chatCooldownUntil > 0) {
      session.chatCooldownUntil = 0;
      session.chatRateViolations = 0;
      session.chatTokens = CHAT_RATE_BURST;
    }
    const elapsed = Math.max(0, now - session.chatLastRefill);
    session.chatTokens = Math.min(
      CHAT_RATE_BURST,
      session.chatTokens + elapsed * CHAT_RATE_REFILL_PER_SECOND,
    );
    session.chatLastRefill = now;
    if (session.chatTokens >= 1) {
      session.chatTokens -= 1;
      session.chatRateViolations = 0;
      return true;
    }
    session.chatRateViolations++;
    if (session.chatRateViolations >= CHAT_RATE_VIOLATIONS_FOR_COOLDOWN) {
      session.chatCooldownUntil = now + CHAT_COOLDOWN_SECONDS;
      session.chatTokens = 0;
      session.chatLastRateError = now;
      this.send(session, {
        t: 'events',
        list: [
          {
            type: 'error',
            text: `Chat locked for ${CHAT_COOLDOWN_SECONDS}s because you are sending messages too quickly.`,
          },
        ],
      });
      return false;
    }
    if (now - session.chatLastRateError >= CHAT_RATE_ERROR_COOLDOWN_SECONDS) {
      session.chatLastRateError = now;
      this.send(session, {
        t: 'events',
        list: [{ type: 'error', text: 'You are sending messages too quickly. Slow down.' }],
      });
    }
    return false;
  }

  private isChatMuted(session: ClientSession): boolean {
    if (session.chatMutedUntil === null) return false;
    if (session.chatMutedUntil <= Date.now()) {
      session.chatMutedUntil = null;
      session.chatMuteReason = '';
      return false;
    }
    this.send(session, {
      t: 'events',
      list: [{ type: 'error', text: this.chatMuteMessage(session) }],
    });
    return true;
  }

  private chatMuteMessage(session: ClientSession): string {
    const remainingMs = Math.max(0, (session.chatMutedUntil ?? Date.now()) - Date.now());
    const minutes = Math.max(1, Math.ceil(remainingMs / 60_000));
    const reason = session.chatMuteReason ? ` Reason: ${session.chatMuteReason}` : '';
    return `You are muted from chat for ${minutes} more minute${minutes === 1 ? '' : 's'}.${reason}`;
  }

  private sendWhoRoster(session: ClientSession, filter?: string): void {
    if (!session.blockListLoaded) {
      this.send(session, {
        t: 'events',
        list: [
          { type: 'error', text: 'Your ignore list is still loading. Try /who again in a moment.' },
        ],
      });
      return;
    }
    let rows = this.whoRosterFor(session);
    if (filter) {
      const q = filter.toLowerCase();
      rows = rows.filter(
        (row) => row.name.toLowerCase().includes(q) || row.zone.toLowerCase().includes(q),
      );
    }
    const total = rows.length;
    const header = filter
      ? `Who: ${total} ${total === 1 ? 'player' : 'players'} matching "${filter}" on ${REALM}.`
      : `Who: ${total} ${total === 1 ? 'player' : 'players'} online on ${REALM}.`;
    const list: { type: 'log'; text: string; color: string }[] = [
      {
        type: 'log',
        text: header,
        color: '#7fd4ff',
      },
    ];
    for (const row of rows.slice(0, WHO_RESULT_LIMIT)) {
      const status = row.status === 'online' ? '' : ` (${row.status})`;
      list.push({
        type: 'log',
        text: `${row.name} - level ${row.level} ${row.cls} - ${row.zone}${status}`,
        color: '#c9b27a',
      });
    }
    if (total > WHO_RESULT_LIMIT) {
      list.push({
        type: 'log',
        text: `...and ${total - WHO_RESULT_LIMIT} more.`,
        color: '#998d6a',
      });
    }
    this.send(session, { t: 'events', list });
  }

  private whoRosterFor(viewer: ClientSession): WhoRosterRow[] {
    const rows: WhoRosterRow[] = [];
    for (const session of this.clients.values()) {
      if (!this.canShowInWho(viewer, session)) continue;
      const e = this.sim.entities.get(session.pid);
      const meta = this.sim.meta(session.pid);
      if (!e || !meta) continue;
      rows.push({
        name: session.name,
        cls: meta.cls,
        level: e.level,
        ...this.presenceOf(session),
      });
    }
    return rows.sort((a, b) => a.name.localeCompare(b.name));
  }

  private canShowInWho(viewer: ClientSession, candidate: ClientSession): boolean {
    if (!candidate.blockListLoaded) return false;
    if (viewer.blockedIds.has(candidate.characterId)) return false;
    if (
      candidate.characterId !== viewer.characterId &&
      candidate.blockedIds.has(viewer.characterId)
    )
      return false;
    return true;
  }

  private broadcastSystem(text: string): void {
    for (const session of this.clients.values()) {
      this.send(session, { t: 'events', list: [{ type: 'log', text, color: '#ffd100' }] });
    }
  }

  // force the next snapshot to carry quest state even when a quest command
  // changed nothing, so stale client UI converges back to the server's truth
  private resyncQuests(session: ClientSession): void {
    delete session.lastSent.qlog;
    delete session.lastSent.qdone;
    session.selfHeavyDirty = true; // ensure the gated heavy block re-runs next snapshot
  }

  private resyncDelves(session: ClientSession): void {
    delete session.lastSent.drun;
    delete session.lastSent.dcompanion;
    delete session.lastSent.dmarks;
    delete session.lastSent.dcomp;
    delete session.lastSent.dclears;
    delete session.lastSent.delveDaily;
  }

  private send(session: ClientSession, obj: unknown): void {
    this.sendRaw(session, JSON.stringify(obj));
  }

  private sendRaw(session: ClientSession, payload: string): void {
    if (session.ws.readyState !== 1) return;
    // A client that has stopped draining its socket lets ws.bufferedAmount grow
    // without bound (send() never blocks); left unchecked one stuck reader OOMs
    // the process and starves everyone. Terminate the offender instead. close()
    // would try to flush the already-huge buffer, so destroy the socket: the
    // 'close' handler funnels into the idempotent leave() for normal cleanup.
    if (isBackpressureExceeded(session.ws.bufferedAmount)) {
      if (!session.left) {
        try {
          session.ws.terminate();
        } catch {
          /* socket already torn down */
        }
        void this.leave(session, 'backpressure');
      }
      return;
    }
    session.ws.send(payload);
  }
}
