import { randomUUID } from 'node:crypto';
import type { WebSocket } from 'ws';
import { createBotDetector } from '#bot-detector';
import {
  type AccountFlair,
  type ChatSenderFlair,
  EMPTY_ACCOUNT_FLAIR,
  hasStreamerLink,
  wireStreamerLinks,
} from '../src/sim/account_flair';
import { verifyChallenge } from '../src/sim/client_challenge';
import { DEEDS } from '../src/sim/content/deeds';
import { isFinderListingTag, isFinderRole } from '../src/sim/content/dungeon_finder';
import { MECH_CHROMAS, mechChromaItemId, mechChromaSkinIndex } from '../src/sim/content/skins';
import type { TalentAllocation } from '../src/sim/content/talents';
import { SPORT_ROLES, VALE_CUP_BALL_TEMPLATE_ID, VC_NATION_IDS } from '../src/sim/content/vale_cup';
import { withWeaponSkinApplied } from '../src/sim/content/weapon_skin_rules';
import { isWeaponSkinType, WEAPON_SKINS } from '../src/sim/content/weapon_skins';
import {
  DELVES,
  DUNGEON_X_THRESHOLD,
  DUNGEONS,
  delveAt,
  dungeonAt,
  isDelvePos,
  MOBS,
  ZONES,
  zoneAt,
} from '../src/sim/data';
import { devTierIndexForMergedPrs } from '../src/sim/dev_tier';
import { parseRelayCommand } from '../src/sim/discord_relay';
import {
  isInJailCage,
  JAIL_CENTER,
  JAIL_OUTER_HALF,
  JAIL_VISITOR_POS,
  type JailState,
  jailCageSpawn,
  jailGateTeleport,
} from '../src/sim/jail';
import type { PickAction } from '../src/sim/lockpick';
import { sanitizeMarketQuery } from '../src/sim/market_query';
import { parseMoveInputFrame } from '../src/sim/move_input';
import {
  partyFrameAbsorb,
  partyFrameAggroTargets,
  partyFrameAuras,
  partyFrameIncomingHeals,
  partyFrameRole,
} from '../src/sim/party_frame_info';
import type { PetState, PlayerMeta } from '../src/sim/sim';
import { MAX_CHAT_MESSAGE_LEN, Sim } from '../src/sim/sim';
import type { VcMatch } from '../src/sim/social/vale_cup';
import { stealthDetectionRadius, threatEntries } from '../src/sim/threat';
import {
  type Aura,
  DT,
  dist2d,
  type Entity,
  EQUIP_SLOTS,
  type EquipSlot,
  emptyMoveInput,
  isDungeonDifficulty,
  MAX_LEVEL,
  type MobFamily,
  PARTY_MEMBER_AURA_CAP,
  RUN_SPEED,
  type SimEvent,
  type SportRole,
  type VcBracket,
  type VcNationId,
} from '../src/sim/types';
import { isAtSowfield } from '../src/sim/vale_cup_layout';
import { type BankBonusSource, type CommandName, isOverheadEmoteId } from '../src/world_api';
import { recordOnlineSample } from './admin_db';
import { offensiveName } from './auth';
import { recordBankOp } from './bank_ledger';
import type {
  BotDetector,
  BotTrackingContext,
  ConfigApplyResult,
  ConfigField,
  SessionRuntimeSnapshot,
  SuspiciousPlayer,
} from './bot_detector/contract';
import {
  buildDetectionCalibrationSnapshot,
  type DetectionCalibrationSnapshot,
} from './calibration_snapshot';
import { ChatFilter } from './chat_filter';
import {
  isChatFilterWrite,
  isIgnorableChannel,
  parseChatFilterCommand,
} from './chat_filter_commands';
import { applyChatStrike, loadChatFilterState, recordChatViolation } from './chat_filter_db';
import { ChatLogger } from './chat_log';
import { dailyRewardService } from './daily_rewards';
import type { AccountChatMuteStatus, AccountCosmetics, RequestMetadata } from './db';
import {
  closePlaySession,
  grantAccountMechChroma,
  grantAccountWeaponSkins,
  heartbeatCharacterLeases,
  insertChatLogs,
  loadAccountFlair,
  loadMailState,
  loadMarketState,
  markAccountQuestComplete,
  openPlaySession,
  pool,
  releaseCharacterLease,
  revokeAccountMechChroma,
  saveCharacterAndMarketState,
  saveCharacterState,
  saveMailState,
  saveMarketState,
  setAccountWeaponSkinLoadout,
  touchCharacterLogin,
  walletForAccount,
} from './db';
import { getDeedBroadcasts } from './deeds_db';
import {
  deedRecordsIdle,
  isHiddenDeedId,
  isMarqueeDeed,
  reconcileCharacterDeeds,
  recordDeedUnlocks,
} from './deeds_records';
import { enqueueActivity } from './discord_activity';
import { discordFlairForAccount, grantRewardPoints } from './discord_db';
import { enqueueRelay } from './discord_relay';
import { formatDuration } from './duration';
import { mergedPrsForLogin } from './github_contributors';
import { githubForAccount } from './github_db';
import { forEachGuarded, runGuarded } from './guarded_iter';
import { gameMetricsCounters } from './http/game_signals';
import { IpBlockList } from './ip_block';
import { loadActiveBlockedIps } from './ip_block_db';
import { keepaliveSweepDelayed } from './keepalive_sweep';
import { LINKDEAD_GRACE_MS, planJoin } from './linkdead';
import { type LiveSharedIp, sharedIpsFromLiveSessions } from './live_shared_ips';
import { trackReachedLevel5 } from './meta_capi';
import {
  applyMobScanTick,
  createMobScanTickStats,
  resetMobScanCaptureAccumulators,
} from './mob_scan_tick_stats';
import {
  forceCharacterRename,
  moderateAccount,
  muteAccountChat,
  recordInGameAction,
} from './moderation_db';
import {
  canAttemptModerationCommands,
  type ModerationHost,
  ModerationService,
} from './moderation_service';
import { consumeMsgToken, createMsgRateBucket, type MsgRateBucketState } from './msg_rate_limit';
import { nextRaidResetMs } from './raid_reset';
import { REALM, REALM_PUBLIC_ORIGIN, REALM_RESET_TIME_ZONE } from './realm';
import { createSerialWriter } from './serial_writer';
import type { Presence, PresenceStatus, SocialActor, SocialTransport } from './social';
import { SocialService } from './social';
import { PgSocialDb } from './social_db';
// Imported from the mirror module DIRECTLY (not the ./steam barrel), the same
// way deeds_records imports onDeedRecorded: the barrel drags routes.ts (and its
// load-time requireAccount over the db module) into every test that
// partial-mocks the db, the known overlay-mock breakage class.
import { reconcileOnLogin } from './steam/mirror';
import { TickProfiler } from './tick_profiler';
import { hrtimeToMs, TickRateMeter } from './tick_rate_meter';
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
// How often the achieved tick rate rides the snapshot head. The meter's 3s
// sliding window moves slowly and the client holds the last value across
// omissions, so ~2 Hz keeps the overlay live without paying the scalar on
// every 20 Hz head. In sim seconds (the head already carries sim.time).
const TICK_HZ_HEAD_INTERVAL_S = 0.5;
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
// Usage notices for the two PLAYER chat-suppression tiers. Kept as constants
// because the S3 localization guard scans sendChatNotice literals, and
// src/ui/server_i18n.ts carries the matching rules. (A "mute" is the ADMIN
// account silence and lives in moderation_commands.ts, not here.)
const IGNORE_USAGE = 'Usage: /ignore <name>, /unignore <name>, /ignorelist.';
const BLOCK_USAGE = 'Usage: /block <name>, /unblock <name>, /blocklist.';

const CHAT_RATE_BURST = 5;
const CHAT_RATE_REFILL_PER_SECOND = 1 / 3; // sustained 20 messages/minute
const CHAT_RATE_ERROR_COOLDOWN_SECONDS = 4;
const CHAT_COOLDOWN_SECONDS = 20;
const CHAT_RATE_VIOLATIONS_FOR_COOLDOWN = 3;
const WHO_RESULT_LIMIT = 50;
// One live session per account: Ravenpost mail (v0.20.0) moves coin and goods
// between an account's characters, so the old allowance of a second online
// character (self-trade by dual-boxing) is no longer needed. GMs are exempt.
const MAX_ACTIVE_SESSIONS_PER_ACCOUNT = 1;
// WS protocol-level ping cadence; see the keepalive interval in start().
const WS_KEEPALIVE_PING_MS = 30_000;
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
// Clients stream movement intent every 50ms. If that stream goes silent while
// the last packet held a key down, stop applying it instead of turning/running
// forever. 750ms leaves room for normal jitter and short browser stalls.
const STALE_INPUT_SECONDS = 0.75;
// Exponential moving average weight for the per-tick duration stat.
const TICK_EMA_ALPHA = 0.05;
// On-demand server tick-loop capture window bounds (ms), clamped in startPerfCapture.
// The default when the admin caller sends none. Max 30s stays inside the profiler's
// 1200-tick (60s) ring.
const PERF_CAPTURE_MIN_MS = 3_000;
const PERF_CAPTURE_MAX_MS = 30_000;
const PERF_CAPTURE_DEFAULT_MS = 10_000;
// The mob.update sim lap is additionally bucketed by mob family so a hot family
// (a spider swarm, a pack of humanoids) shows up in the profile instead of hiding
// inside one aggregate number. Every MobFamily value (src/sim/types.ts) plus an
// 'other' catch-all for any templateId whose family does not resolve. A family
// missing from this list would derive a bucket name TickProfiler never registered
// and silently drop its timing: the satisfies clause rejects a non-family typo, and
// the registry pin test type-checks union coverage and asserts the derived names as
// literals. Exported for those pins.
export const MOB_UPDATE_BUCKETS = [
  'beast',
  'humanoid',
  'mudfin',
  'spider',
  'burrower',
  'undead',
  'troll',
  'ogre',
  'elemental',
  'dragonkin',
  'demon',
  'reptile',
  'other',
] as const satisfies readonly (MobFamily | 'other')[];
// sim.tick() internal phase names (already `sim.`-prefixed): must match the
// lap?.(...) call sites in src/sim/sim.ts tick(). Fed by the injected cfg.perfLap
// probe while a detailed capture is active (an admin capture or PERF_TICK_LOG=1).
// TickProfiler.add() silently ignores an unregistered phase, so a name drift would
// drop that timing without a trace: tests/server/tick_perf_capture.test.ts pins the
// sim's emitted phase set against this list, exported for that guard.
export const SIM_LAP_PHASES = [
  'respawns',
  'worldBosses',
  'groundAoEs',
  'despawnDecay',
  'projectiles',
  'p.move',
  'p.doors',
  'p.casting',
  'p.autoAtk',
  'p.regen',
  'p.auras',
  'mob.update',
  'mob.auras',
  'ent.misc',
  'engaged',
  'duels',
  'arena',
  'trades',
  'lootRolls',
  'instances',
  'delves',
  'valecup',
  'dfinder',
  'market',
  'postOffice',
  'delayedEv',
  'deeds',
  'gridRefresh',
  // Per-family mob.update buckets, appended after the base lap names so those
  // stay byte-identical and first. The `sim.${n}` map turns each into the registered
  // `sim.mob.update|<family>` the perfLap probe adds to.
  ...MOB_UPDATE_BUCKETS.map((b) => `mob.update|${b}`),
].map((n) => `sim.${n}`);

// Per-zone attribution buckets for the mob.update phase. The mob loop
// tags each mob.update lap with its entity; the host splits that slice of the phase
// time by the mob's zone/group so a stall localizes to "which zone froze" instead of
// only the phase total. These are HOST-DERIVED (the sim never emits them), so they are
// registered in the profiler but deliberately kept OUT of SIM_LAP_PHASES (which pins
// the sim's own emissions). Overworld mobs bucket by zone id; instance/delve mobs
// (x beyond DUNGEON_X_THRESHOLD) share one 'instance' bucket; 'other' is a safety net.
const MOB_ZONE_PHASE_PREFIX = 'sim.mob.z:';
const MOB_ZONE_PHASE_INSTANCE = `${MOB_ZONE_PHASE_PREFIX}instance`;
const MOB_ZONE_PHASE_OTHER = `${MOB_ZONE_PHASE_PREFIX}other`;
// Pre-interned zone-id -> phase-name map so the per-mob probe allocates no strings.
const MOB_ZONE_PHASE_BY_ID = new Map<string, string>(
  ZONES.map((z) => [z.id, `${MOB_ZONE_PHASE_PREFIX}${z.id}`]),
);
export const SIM_MOB_ZONE_PHASES = [
  ...ZONES.map((z) => `${MOB_ZONE_PHASE_PREFIX}${z.id}`),
  MOB_ZONE_PHASE_INSTANCE,
  MOB_ZONE_PHASE_OTHER,
];

// The zone/group bucket a mob's update cost is attributed to. Pure and allocation-free
// (a cheap zoneAt band scan plus a Map lookup of an interned string).
export function mobZonePhase(mob: Entity): string {
  if (mob.pos.x > DUNGEON_X_THRESHOLD) return MOB_ZONE_PHASE_INSTANCE;
  return MOB_ZONE_PHASE_BY_ID.get(zoneAt(mob.pos.z).id) ?? MOB_ZONE_PHASE_OTHER;
}

const ARENA_WIRE_HZ = 0.1;
const ARENA_WIRE_INTERVAL_TICKS = Math.max(1, Math.round(1 / (DT * ARENA_WIRE_HZ)));
// Vale Cup readout cadence: the CupInfo payload carries whole-second clocks and
// queue sizes, so 2 Hz keeps the window/indicator live without re-serializing
// the rosters at 20 Hz. Instant transitions ride the pid-scoped vcup* events.
const VC_WIRE_HZ = 2;
const VC_WIRE_INTERVAL_TICKS = Math.max(1, Math.round(1 / (DT * VC_WIRE_HZ)));
// Dungeon Finder personal readout cadence: the `df` payload carries
// whole-second clocks (queue wait, proposal countdown), so 2 Hz keeps the
// window live without re-serializing it at 20 Hz. The shared `dfb` board rides
// the same cadence and only re-sends when a listing actually changes.
const DF_WIRE_HZ = 2;
const DF_WIRE_INTERVAL_TICKS = Math.max(1, Math.round(1 / (DT * DF_WIRE_HZ)));

type ClientMessage = Record<string, unknown> & {
  ability?: string;
  accept?: boolean;
  action?: string;
  activities?: unknown;
  activity?: string;
  alloc?: unknown;
  ante?: number;
  applicant?: number;
  augment?: string;
  bar?: unknown;
  bracket?: number;
  catalog?: string;
  choice?: 'need' | 'greed' | 'pass';
  chroma?: string;
  cmd?: string;
  companionId?: string;
  count?: number;
  copper?: number;
  delveId?: string;
  difficulty?: unknown;
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
  listing?: number;
  marker?: number;
  mi?: unknown;
  mode?: string;
  n?: string;
  name?: string;
  nation?: string;
  node?: string;
  npc?: number;
  objectId?: number;
  price?: number;
  q?: string;
  quest?: string;
  r?: string;
  role?: string;
  roles?: unknown;
  rollId?: number;
  seq?: number;
  sid?: string;
  sig?: string;
  skin?: number;
  slot?: number | string;
  spec?: string;
  t?: string;
  tags?: unknown;
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

// Vale Cup wire validation (anti-cheat: every field type-checked against the
// known token sets before the sim is touched, the LOCKPICK_ACTIONS pattern).
const VC_NATION_SET: ReadonlySet<string> = new Set(VC_NATION_IDS);
const SPORT_ROLE_SET: ReadonlySet<string> = new Set(SPORT_ROLES);

function isVcNationId(value: unknown): value is VcNationId {
  return typeof value === 'string' && VC_NATION_SET.has(value);
}

function isSportRole(value: unknown): value is SportRole {
  return typeof value === 'string' && SPORT_ROLE_SET.has(value);
}

function isVcBracket(value: unknown): value is VcBracket {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 5;
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
// Commands a jailed session may not send: everything that queues into or
// enters instanced content (ranked arena in all formats: 1v1, 2v2, fiesta,
// yumi3, yumi5; the Vale Cup; dungeons; delves) plus starting or accepting a
// duel. The dungeon/delve entries are door-proximity-gated anyway (a prisoner
// can never stand at a door), listed here as explicit policy. Leave/abort
// commands stay allowed.
const JAILED_BLOCKED_COMMANDS = new Set<string>([
  'arena_queue',
  'vcup_queue',
  'vcup_ready',
  'vcup_practice',
  'enter_dungeon',
  'enter_crypt',
  'enter_delve',
  'duel_req',
  'duel_accept',
]);
const HEAVY_SELF_CMDS = new Set<string>([
  'equip',
  'inv_move', // rewrites the inventory array order: the self snapshot must resend it
  'unequip_item',
  'equip_bag',
  'unequip_bag',
  'use',
  'discard',
  'buy',
  'sell',
  'buyback',
  'vcup_bet', // debits copper: refresh the self snapshot so the purse updates
  'loot',
  'harvestCorpse',
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
  'change_weapon_skin',
  'prestige',
  'market_list',
  'market_buy',
  'market_cancel',
  'market_collect',
  'mail_send',
  'mail_take',
  'mail_delete',
  'mail_read',
  'bank_deposit',
  'bank_withdraw',
  'bank_buy_slots',
  'pet_feed',
  'dev_give',
  'dev_level',
]);
const HEAVY_SELF_EVENTS = new Set<string>([
  'loot',
  'vcupBetSettled', // credits copper to the bettor: refresh their purse
  'mailArrived',
  'mailResult',
  'levelup',
  'virtualLevelUp',
  'deedUnlocked', // the earned map + stat block ride the heavy-gated deeds/dstats keys
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
const DAILY_REWARD_ACTIVITY_MS = 60_000;
const RELAY_COOLDOWN_MS = 8_000; // min gap between a player's "!" community posts
const ADMIN_LOCATION_POI_RADIUS = 32;

export interface ClientSession {
  ws: WebSocket;
  accountId: number;
  accountCosmetics: AccountCosmetics;
  // Operator-set account flair (AI mark + streamer links), loaded at join and kept
  // current by applyAccountFlairLive. Held on the SESSION, not just the entity,
  // because chat fan-out has to read the SENDER's flair for recipients who are
  // nowhere near them (general/world/guild chat crosses the interest scope, where
  // no entity record exists for the sender).
  accountFlair: AccountFlair;
  // The wire-ready ChatSenderFlair derived from accountFlair, or undefined for the
  // ordinary player with no flair. Cached here (recomputed only in stampAccountFlair,
  // i.e. at join and when an operator edits) because deriving it re-parses every
  // stored link through `new URL()`, and the chat path would otherwise pay that on
  // EVERY line a streamer sends, to every channel.
  chatFlair: ChatSenderFlair | undefined;
  characterId: number;
  pid: number; // player entity id in the sim
  name: string;
  lastSave: number;
  alive: boolean;
  joinedAt: number;
  dbSessionId: number | null; // play_sessions row, set once the insert lands
  metricsMaxLevel: number;
  left: boolean; // set in leave(); guards against the open-session insert landing after disconnect
  // linkdead grace: true while the socket has dropped but the character is
  // held in-world awaiting a reconnect. graceUntil is the epoch-ms deadline
  // at which the held session is fully torn down via leave().
  linkdead: boolean;
  graceUntil: number;
  // true while a keepalive ping is outstanding; the pong handler (attached
  // next to the close/error handlers in ws_auth.ts) clears it. Still set at
  // the next sweep means the socket is black-holed: terminate into the grace.
  awaitingPong: boolean;
  chatTokens: number;
  chatLastRefill: number;
  chatLastRateError: number;
  chatRateViolations: number;
  chatCooldownUntil: number;
  // Global inbound-message token bucket (#978): covers every frame (input,
  // cast, cmd, ...), separate from the chat-only bucket above, so a client
  // flooding non-chat frames is throttled/kicked instead of processed unconditionally.
  msgRate: MsgRateBucketState;
  chatMutedUntil: number | null;
  chatMuteReason: string;
  // Hard-word enforcement strike count driving the mute ladder. Account-scoped:
  // seeded from the DB at join, kept live by enforcement/admin actions.
  chatStrikes: number;
  // character ids this player has ignored; chat from them is dropped before
  // delivery. Loaded from the DB on join, kept in sync by social commands.
  blockedIds: Set<number>;
  blockListLoaded: boolean;
  // character ids this player has IGNORED. An ignore is the chat-only sibling of
  // a block: their PUBLIC chat is dropped before delivery, but their whispers,
  // rolls, invites and mail still arrive. Loaded on join, kept in sync by the
  // ignore commands. Distinct from `chatMutedUntil`, which is the ADMIN silence
  // applied TO this player by staff.
  ignoredIds: Set<number>;
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
  // Vale Cup readout, same idea at its own cadence (VC_WIRE_HZ)
  lastVcupWireTick: number;
  // Dungeon Finder readout, same idea at its own cadence (DF_WIRE_HZ)
  lastDfWireTick: number;
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
  userAgent: string;
  fbp: string;
  fbc: string;
  sourceUrl: string;
  isAdmin: boolean;
  // Expanded admin permissions, snapshotted at join like isAdmin (a role change
  // applies at the next login). Gates the in-game moderation commands.
  adminPermissions: ReadonlySet<string>;
  // Seed the client sends at auth; signs its challenge answers.
  clientSeed: string;
  // Per-join fence for this session's DB load lease (server/db.ts
  // character_leases). leave() releases with it so a stale release from an
  // earlier join cannot delete a lease a reconnect has since re-acquired.
  // undefined for sessions created without the lease path (direct game.join in
  // tests); a resume keeps the original session's nonce.
  leaseNonce: string | undefined;
  // Behavioral bot-detection state. Ephemeral — reset on every join.
  botTrackingContext: BotTrackingContext;
  // Deed unlocks awaiting a SUCCESSFUL authoritative save before they may be
  // published to the character_deeds index (and, chained off it, Steam).
  // Publishing before the blob is durable creates the one drift direction the
  // insert-only join reconcile can never heal: records claiming a deed the
  // character does not have. Event-ordered; drained by saveCharacter up to
  // the count captured when the blob was serialized.
  pendingDeedRecords: string[];
  spectating: {
    characterId: number;
    name: string;
    savedPos: { x: number; y: number; z: number };
    priorGm: boolean;
    stowedPet: PetState | null;
  } | null;
  jailed: JailState | null;
  jailVisit: {
    savedPos: { x: number; y: number; z: number };
    savedFacing: number;
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
  // The caster's entity id, so the client's target strip can lead with and enlarge the
  // viewer's OWN dots/hots (auras_view ownFirst). A shared per-entity value (never
  // per-viewer), so the per-entity dyn cache keeps eliding; an old client ignores it and
  // an old server's omission decodes to 0, which matches no player id.
  src?: number;
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
  if (e.weaponSkinId) out.wsk = e.weaponSkinId; // active weapon-skin cosmetic (render-only, like mh)
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
  if (e.aiAccount) out.ai = 1; // operator-set AI-operated mark (name prefix)
  // Official streamer's platform links (player menu). Already gated by
  // wireStreamerLinks at the point they were set on the entity, so an account whose
  // streamer flag is off has none here, whatever is stored against it.
  if (e.streamerLinks && hasStreamerLink(e.streamerLinks)) out.slk = e.streamerLinks;
  if (e.guild) out.gd = e.guild;
  if (e.title) out.title = e.title; // Book of Deeds active title (a deed id; the client localizes)
  if (e.dungeonId) out.dgn = e.dungeonId;
  if (e.objectItemId) out.obj = e.objectItemId;
  if (e.scale !== 1) out.sc = e.scale;
  if (e.color !== 0xffffff) out.c = e.color;
  return out;
}

/**
 * The flair a chat line carries for its SENDER, or undefined when the account has
 * none, so an ordinary player's chat event is byte-unchanged on the wire. The links
 * run through the same wireStreamerLinks gate the entity encoding uses: an account
 * whose streamer flag is off ships no links here either, whatever is stored.
 */
function chatSenderFlair(flair: AccountFlair): ChatSenderFlair | undefined {
  const links = wireStreamerLinks(flair);
  if (!flair.ai && !links) return undefined;
  const out: ChatSenderFlair = {};
  if (flair.ai) out.ai = true;
  if (links) out.links = links;
  return out;
}

// Builds one aura's wire record via direct assignment rather than chained
// conditional spreads (`...(cond ? {...} : {})`), which allocated a throwaway
// object literal per branch regardless of which side taken. This runs for
// every aura on every entity every tick (dynamicFields below is unconditional
// per-entity, per-tick, even when wireCacheFor's diff ends up eliding the
// result), so at raid-sized entity/aura counts and 20 Hz the spread form was a
// measurable source of short-lived garbage. Output is byte-identical to the
// prior spread chain; only the allocation shape changed.
function wireAura(a: Aura): WireAura {
  const w: WireAura = {
    id: a.id,
    name: a.name,
    kind: a.kind,
    rem: round2(a.remaining),
    dur: a.duration,
  };
  // Carry the aura's magnitude so buff/debuff hover tooltips show the real numbers online,
  // not 0 (the descriptor in src/ui/aura_effect.ts reads value per kind). Sent RAW (like
  // `dur`, not round2) so the exact number and its sign survive JSON, keeping a negative
  // stat-sap's isAuraDebuff classification intact (round2 could turn a tiny negative into
  // -0 -> 0). Omitted only when exactly 0, which decodes back to 0, so value-less auras and
  // an old server are unchanged. A hover tooltip magnitude is non-actionable cosmetic text,
  // so sending it cannot let a graphics preset hide anything (graphics-settings fairness).
  if (a.value !== 0) w.value = a.value;
  // imbue judgement min/max range; dot/hot tick cadence; non-physical school. Each rides
  // only when it carries meaning, so ordinary auras stay lean and decode to their defaults.
  if (a.value2 !== undefined) w.value2 = a.value2;
  if (a.value3 !== undefined) w.value3 = a.value3;
  if (a.tickInterval !== undefined) w.tickInterval = a.tickInterval;
  if (a.school !== 'physical') w.school = a.school;
  if (a.stacks && a.stacks > 1) w.stacks = a.stacks;
  // Carry the remaining charges only for a charge-limited aura (Lightning Shield), so the
  // buff icon can badge the count online exactly as offline; undefined for every other aura.
  if (a.charges !== undefined) w.charges = a.charges;
  // The caster's entity id, for the client's own-aura prominence on the target strip
  // (auras_view ownFirst). Omitted for the rare 0/absent source, which decodes to 0.
  if (a.sourceId) w.src = a.sourceId;
  return w;
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
  if (e.ghost) out.gh = 1; // released spirit (ghost form); renders translucent
  if (e.lootable) out.loot = 1;
  if (e.hostile) out.h = 1;
  // The target frame's resource bar: type + current/max, sent only for entities
  // that HAVE a resource (players and caster mobs; a resource-less wolf omits all
  // three and the frame hides its bar). The rounded res keeps an idle entity's
  // serialized record byte-stable so the per-entity dyn cache keeps eliding; the
  // SELF record still overrides with its own precise res/mres/rtype fields.
  if (e.resourceType) {
    out.rtype = e.resourceType;
    out.res = Math.round(e.resource);
    out.mres = e.maxResource;
  }
  if (e.castingAbility) {
    out.cast = e.castingAbility;
    out.castRem = round2(e.castRemaining);
    out.castTot = round2(e.castTotal);
    if (e.channeling) out.chan = 1;
  }
  if (e.sitting || e.eating || e.drinking) out.sit = 1;
  if (e.weaponStowed) out.ws = 1; // Z-key sheathe: weapons render on the back
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
    out.auras = e.auras.map(wireAura);
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
  // The one Vale Cup ball is watched by the whole Sowfield: a far keeper sits
  // past the 55yd full-rate tier and the stands past 80yd, where a ~25 yd/s
  // ball turns visibly steppy at half/quarter rate. One entity at full rate
  // costs one lite record per tick, so it is always due.
  if (e.templateId === VALE_CUP_BALL_TEMPLATE_ID) return true;
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

// A frozen server tick-loop profile captured over one on-demand window, plus the
// context needed to read it: when it was taken, how long the window was, and the
// crowd it was taken under. The admin dashboard renders this.
export interface PerfCaptureResult {
  captureId: string; // server-generated correlation id returned when the window starts
  capturedAt: number; // epoch ms the window closed
  durationMs: number; // the (clamped) capture window length
  loopCallbacks: number; // setInterval callbacks observed during the window
  simTicks: number; // authoritative sim ticks run across those callbacks
  catchUpCallbacks: number; // callbacks that ran more than one sim tick
  maxTicksPerCallback: number;
  online: number; // live sessions at capture close
  simEntities: number; // sim entity count at capture close
  aggroVisitsTotal: number; // aggro-scan player visits summed across the window
  aggroVisitsMaxPerTick: number; // peak aggro-scan player visits in any one tick
  threatVisitsTotal: number; // threat-table entry visits summed across the window
  threatVisitsMaxPerTick: number; // peak threat-table entry visits in any one tick
  profile: ReturnType<TickProfiler['profile']>;
}

// The /admin/api/perf/tick status envelope: whether a capture is currently running
// (with when it ends, so the UI can show a countdown), plus the last frozen result.
export interface PerfCaptureStatus {
  captureId: string | null; // id of the in-flight capture, or null while idle
  capturing: boolean;
  endsAt: number | null; // epoch ms the in-flight capture closes, or null
  last: PerfCaptureResult | null;
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
  // partyFrameAggroTargets / partyFrameIncomingHeals scan the whole entity set and
  // are GLOBAL (identical for every grouped session), yet partyWire runs once per
  // grouped session per tick. Memoize both once per tick so a 40-raid does one scan,
  // not one per member. (see review #1864, finding 1)
  private partyFrameGlobalsCache: {
    tick: number;
    aggroTargets: ReturnType<typeof partyFrameAggroTargets>;
    incomingHeals: ReturnType<typeof partyFrameIncomingHeals>;
  } | null = null;
  private lastWireSweepTick = 0;
  private interval: NodeJS.Timeout | null = null;
  private holderTierInterval: NodeJS.Timeout | null = null;
  private keepaliveInterval: NodeJS.Timeout | null = null;
  // Wall-clock ms at which the keepalive sweep last ran, so a sweep can tell whether
  // it fired on time. A late sweep proves the process stalled, not that clients died.
  private lastKeepaliveSweepAt = Date.now();
  private holderTierRefreshing = false; // overlap guard for the refresh cycle
  private playtimeInterval: NodeJS.Timeout | null = null;
  private lastPlaytimeGrantAt = new Map<number, number>(); // accountId -> sim time of last grant
  private dailyRewardActivityInterval: NodeJS.Timeout | null = null;
  private readonly valeCupRewardCompletions = new WeakMap<
    VcMatch,
    { completionId: string; completedAtIso: string }
  >();
  private relayCooldown = new Map<number, number>(); // accountId -> last "!" relay post (ms)
  // pids whose holder tier was forced via the dev /woctier command — the chain
  // refresh leaves them alone so the override sticks during testing (dev only).
  private devTierPids = new Set<number>();
  private saveTimer = 0;
  private socialPosTimer = 0;
  private saveAllInFlight: Promise<void> | null = null;
  private readonly characterSaveQueues = new Map<number, Promise<void>>();
  // Weapon-skin loadouts are whole-record replacements in their dedicated paid
  // state row. Keep one FIFO per account so rapid apply/detach commands cannot
  // commit on separate pool clients in reverse order and resurrect stale state.
  private readonly weaponSkinLoadoutSaveQueues = new Map<number, Promise<void>>();
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
  // Achieved sim ticks per wall-clock second. The cost metrics above go blind
  // when the dt clamp discards wall time under saturation; this is the number
  // that actually sags. Rides the snapshot head (throttled) + perfProfile().
  private readonly tickRateMeter = new TickRateMeter();
  private tickHz: number | null = null;
  // Wall clock (epoch millis) of the last COMPLETED tick pass, null until the
  // first one lands. Written at the very END of the guarded body, so a pass that
  // throws leaves it untouched: once one pass has completed, a loop that then wedges
  // reads as stale. A loop that throws on its FIRST pass never stamps this at all, so
  // liveness falls back to loopStartedAtMs to still catch a boot-time wedge.
  private lastTickCompletedAt: number | null = null;
  // Wall clock (epoch millis) when start() last installed the loop, null before it.
  // The liveness backstop for the never-completed-a-pass case: without it, a loop that
  // throws every tick from the first one leaves lastTickCompletedAt null forever and
  // /livez would read that as warmup (200) for the life of the process.
  private loopStartedAtMs: number | null = null;
  // sim.time (seconds) of the last head that carried tickHz; throttles the
  // scalar to TICK_HZ_HEAD_INTERVAL_S so it does not ride every 20 Hz head.
  private lastTickHzHeadTime: number | null = null;
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
    // sim.tick() internal phases, fed by the injected cfg.perfLap probe below.
    // Populated only while the detailed capture is active (an on-demand admin
    // capture or PERF_TICK_LOG=1); zero otherwise.
    ...SIM_LAP_PHASES,
    // Per-zone breakdown of the mob.update phase, with the same capture gating.
    ...SIM_MOB_ZONE_PHASES,
  ]);
  // Detailed-timing switch. When true, the per-client broadcast sub-phase timing
  // (bcastGrid/bcastSelf/visits) AND the sim.tick() perfLap sub-phases are measured;
  // when false those hrtime reads are skipped so the steady-state loop pays nothing.
  // Seeded from PERF_TICK_LOG for the CLI/local path, and flipped on for the duration
  // of an admin-triggered capture (startPerfCapture) via the /admin/api/perf/tick route.
  private perfDetailActive = process.env.PERF_TICK_LOG === '1';
  // The host-side mark the injected sim perfLap probe diffs against; refreshed just
  // before each sim.tick() call while a detailed capture is active.
  private simLapMark = 0n;
  // templateId -> its registered `sim.mob.update|<family>` bucket name, so the perfLap
  // probe pays one Map.get (plus one ring add) per mob per tick in steady state.
  // Unbounded is fine: templateIds are a finite content set (MOBS).
  private readonly mobUpdateBucketNames = new Map<string, string>();
  // On-demand capture state (admin-triggered). The deadline is wall-clock based:
  // a saturated sim may commit far fewer or many more ticks than nominal, but a
  // requested 30-second incident capture must still finish after about 30 seconds.
  // Only the single latest result is kept, in memory.
  private perfCaptureDeadlineNs: bigint | null = null;
  private perfCaptureEndsAtMs = 0;
  private perfCaptureId: string | null = null;
  private perfCaptureDurationMs = 0;
  private perfCaptureLoopCallbacks = 0;
  private perfCaptureSimTicks = 0;
  private perfCaptureCatchUpCallbacks = 0;
  private perfCaptureMaxTicksPerCallback = 0;
  private lastPerfCapture: PerfCaptureResult | null = null;
  private bcastGridNs = 0n;
  private bcastSelfNs = 0n;
  // Crowd diagnostics (PERF_TICK_LOG only): the interest scan is O(viewers x
  // neighbors), so `visits` exposes the real driver of broadcast cost in a
  // crowd, vs the comparatively tiny entity-JSON build time (`serializeMs`).
  private bcSerializeNs = 0n;
  private bcVisits = 0;
  private bcSerializes = 0;
  // Mob-scan observability folded out of the loop body (server/mob_scan_tick_stats.ts):
  // the latest tick's aggro/threat visit counts surfaced on the [perf] heartbeat, plus
  // the four capture-window accumulators frozen into a PerfCaptureResult.
  private readonly mobScanTickStats = createMobScanTickStats();
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
      // Thunzharr is up as soon as the realm boots; subsequent rises keep the
      // normal interval cadence (see src/sim/world_boss.ts).
      worldBossAtBoot: true,
      lockoutNowMs: () => Date.now(),
      // Raid lockouts end at the next 3 AM (the classic daily reset) in this realm's civil
      // time zone, so the whole realm shares one predictable reset (via REALM_RESET_TZ).
      raidResetMs: (nowMs) => nextRaidResetMs(nowMs, REALM_RESET_TIME_ZONE),
      // Per-phase timing inside sim.tick(). The clock stays host-side (sim purity);
      // `simLapMark` is refreshed right before each sim.tick() call in the loop. The
      // probe is always passed but early-returns unless a detailed capture is active,
      // so the steady-state loop pays only a branch per phase.
      perfLap: (phase, entity) => {
        if (!this.perfDetailActive) return;
        const t = process.hrtime.bigint();
        const dt = Number(t - this.simLapMark) / 1e6;
        this.tickProfiler.add(`sim.${phase}`, dt);
        // The mob loop tags each mob.update lap with its entity, so the SAME measured
        // slice also lands in that mob's family bucket (via its templateId) AND its
        // per-zone bucket. One clock read, no extra wall-clock, no sim-side work: a
        // mob.update blowup now localizes to a family and a zone in the same
        // [perf.sim] report instead of only the phase total.
        if (entity !== undefined) {
          this.tickProfiler.add(this.mobUpdateBucketName(entity.templateId), dt);
          this.tickProfiler.add(mobZonePhase(entity), dt);
        }
        this.simLapMark = t;
      },
      valeCupShowcase: true, // idle Sowfield auto-runs a bot exhibition to watch/bet on
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

  // True when this process already holds a live session for the character. Read
  // by the WS auth handshake (server/ws_auth.ts): when game.join refuses after
  // the per-character load lease was taken, this decides whether a live session
  // owns that lease (keep it) or the lease is an orphan to release.
  hasSessionForCharacter(characterId: number): boolean {
    return this.sessionsByCharacterId.has(characterId);
  }

  // -------------------------------------------------------------------------
  // Social presence/transport: bridges the persistent SocialService to the
  // live client map + sim. Keyed by character id (stable across sessions),
  // not pid (per-login).
  // -------------------------------------------------------------------------

  private actorFor(session: ClientSession): SocialActor {
    // activeTitle rides from the LIVE sim meta so the guild/officer relay can
    // stamp the sender's Book of Deeds title (a deed id) without SocialService
    // ever touching the sim; a session with no live meta stays untitled.
    return {
      characterId: session.characterId,
      name: session.name,
      activeTitle: this.sim.meta(session.pid)?.activeTitle ?? null,
    };
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
      enterJailVisit: (moderator) => this.enterJailVisit(moderator),
      exitJailVisit: (moderator) => this.exitJailVisit(moderator),
      isJailed: (session) => session.jailed !== null,
      jail: (moderator, target, minutes) => this.jailSession(moderator, target, minutes),
      unjail: (moderator, target) => this.unjailSession(moderator, target),
    };
  }

  private enterSpectate(moderator: ClientSession, target: ClientSession): void {
    if (moderator.jailVisit) this.exitJailVisit(moderator, false);
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
    moderator.lastVcupWireTick = -VC_WIRE_INTERVAL_TICKS;
    moderator.lastDfWireTick = -DF_WIRE_INTERVAL_TICKS;
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
    moderator.lastVcupWireTick = -VC_WIRE_INTERVAL_TICKS;
    moderator.lastDfWireTick = -DF_WIRE_INTERVAL_TICKS;
    moderator.sentEnts.clear();
    this.send(moderator, { t: 'spectate', name: null });
    if (announce) this.sendSystemNotice(moderator, 'Stopped spectating.');
  }

  private teleportSessionEntity(session: ClientSession, pos: { x: number; z: number }): void {
    const entity = this.sim.entities.get(session.pid);
    if (!entity) return;
    const ground = this.sim.groundPos(pos.x, pos.z);
    entity.pos = ground;
    entity.prevPos = { ...ground };
    entity.vy = 0;
    entity.onGround = true;
    entity.fallStartY = ground.y;
    this.sim.grid.update(entity);
    this.sim.playerGrid.update(entity);
    const meta = this.sim.meta(session.pid);
    if (meta) Object.assign(meta.moveInput, emptyMoveInput());
  }

  private jailSpawnFor(session: ClientSession): { x: number; z: number } {
    return jailCageSpawn(session.characterId || session.pid);
  }

  private jailSession(_moderator: ClientSession, target: ClientSession, minutes: number): void {
    const sentencedAtMs = Date.now();
    const targetEntity = this.sim.entities.get(target.pid);
    if (!targetEntity) return;
    target.jailed = {
      returnPos: { x: targetEntity.pos.x, z: targetEntity.pos.z },
      returnFacing: targetEntity.facing,
      until: sentencedAtMs + minutes * 60_000,
    };
    // Drop the target out of any match queues (a match popping later would
    // teleport them out of the cage; queueing anew is blocked by
    // JAILED_BLOCKED_COMMANDS). A live Vale Cup match resolves as a desertion,
    // same as leave(); idempotent when they are in neither.
    this.sim.arenaQueueLeave(target.pid);
    this.sim.vcupQueueLeave(target.pid);
    this.sim.vcupResolveDesertion(target.pid);
    this.teleportJailedSession(target);
    // System notice (chat log), not the fading error toast: the prisoner must be
    // able to read the sentence after alt-tabbing back, like other moderation
    // actions leave a durable record.
    this.sendSystemNotice(
      target,
      `A moderator has moved you to jail for ${formatDuration(minutes * 60)}.`,
    );
  }

  private unjailSession(_moderator: ClientSession, target: ClientSession): void {
    if (this.releaseJailedSession(target)) {
      this.sendSystemNotice(target, 'A moderator has released you from jail.');
    }
  }

  // Restore a jailed session to its pre-jail position and clear the prisoner
  // state. Shared by /unjail and the timed-sentence expiry (which differ only
  // in the notice, kept at the call sites so the S3 literal scan sees both).
  private releaseJailedSession(target: ClientSession): boolean {
    const state = target.jailed;
    if (!state) return false;
    target.jailed = null;
    this.sim.setJailed(false, target.pid);
    const pos = this.sim.groundPos(state.returnPos.x, state.returnPos.z);
    const entity = this.sim.entities.get(target.pid);
    if (entity?.dead || entity?.ghost) this.sim.revivePlayerAt(target.pid, pos, 1);
    else this.teleportSessionEntity(target, state.returnPos);
    const updated = this.sim.entities.get(target.pid);
    if (updated) {
      updated.facing = state.returnFacing;
      updated.prevFacing = state.returnFacing;
    }
    const meta = this.sim.meta(target.pid);
    if (meta) Object.assign(meta.moveInput, emptyMoveInput());
    target.lastSent = {};
    target.sentEnts.clear();
    return true;
  }

  private teleportJailedSession(session: ClientSession): void {
    // Every path that materializes a jailed session in the world funnels here
    // (the /jail command, both join/reconnect restores, the escape
    // enforcement), so this is where the sim-side prisoner flag (the jail
    // brawl hostility, isHostileTo) is stamped. Idempotent.
    this.sim.setJailed(true, session.pid);
    const spawn = this.jailSpawnFor(session);
    const pos = this.sim.groundPos(spawn.x, spawn.z);
    const entity = this.sim.entities.get(session.pid);
    if (entity?.dead || entity?.ghost) this.sim.revivePlayerAt(session.pid, pos, 1);
    else this.teleportSessionEntity(session, spawn);
    const updated = this.sim.entities.get(session.pid);
    if (updated) {
      updated.facing = 0;
      updated.prevFacing = 0;
    }
    const meta = this.sim.meta(session.pid);
    if (meta) Object.assign(meta.moveInput, emptyMoveInput());
    session.lastSent = {};
    session.sentEnts.clear();
  }

  private enterJailVisit(moderator: ClientSession): void {
    if (moderator.spectating) this.exitSpectate(moderator, false);
    const entity = this.sim.entities.get(moderator.pid);
    if (!entity) return;
    if (!moderator.jailVisit) {
      moderator.jailVisit = {
        savedPos: { ...entity.pos },
        savedFacing: entity.facing,
        priorGm: !!entity.gm,
        stowedPet: this.sim.stowPetForSpectate(moderator.pid),
      };
    }
    this.teleportSessionEntity(moderator, JAIL_VISITOR_POS);
    this.sim.setGm(moderator.pid);
    this.sendSystemNotice(moderator, 'Moved to jail visitor area.');
  }

  private exitJailVisit(moderator: ClientSession, announce = true): void {
    const state = moderator.jailVisit;
    if (!state) {
      if (announce) this.sendChatNotice(moderator, 'You are not visiting jail.');
      return;
    }
    moderator.jailVisit = null;
    const entity = this.sim.entities.get(moderator.pid);
    if (entity?.dead || entity?.ghost) this.sim.revivePlayerAt(moderator.pid, state.savedPos, 1);
    else this.teleportSessionEntity(moderator, state.savedPos);
    const updated = this.sim.entities.get(moderator.pid);
    if (updated) {
      updated.facing = state.savedFacing;
      updated.prevFacing = state.savedFacing;
    }
    this.sim.setGm(moderator.pid, state.priorGm);
    this.sim.restorePetAfterSpectate(moderator.pid, state.stowedPet);
    moderator.lastSent = {};
    moderator.sentEnts.clear();
    if (announce) this.sendSystemNotice(moderator, 'Returned from jail visitor area.');
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
    // The Sowfield is overworld ground (no instance band, no status change),
    // but the stadium is the presence players expect on match days: fighters
    // and walk-up spectators inside the footprint report the venue, not the
    // vale. English at the source like the dungeon/delve names above; the
    // client re-localizes the label (src/ui/server_i18n.ts localizeZone).
    const zone = instanceZone ?? (isAtSowfield(pos.x, pos.z) ? 'The Sowfield' : zoneAt(pos.z).name);
    return { zone, status, x: pos.x, z: pos.z };
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
      onGuildFounded: (id) => {
        // The one server-produced deed stat (DeedStatKey doc, src/sim/types.ts):
        // guild creation resolves in the social layer, so the founder credit is
        // observed here; the sim's tick tail then grants soc_guild_founded and
        // the normal unlock observer records and broadcasts it.
        const s = this.sessionByCharacterId(id);
        const meta = s ? this.sim.meta(s.pid) : null;
        if (meta) this.sim.ctx.bumpDeedStat(meta, 'guildsFounded', 1);
      },
      isBlocking: (recipientId, senderCharacterId) => {
        const s = this.sessionByCharacterId(recipientId);
        return s ? s.blockedIds.has(senderCharacterId) : false;
      },
      onIgnoresChanged: (id, ids) => {
        const s = this.sessionByCharacterId(id);
        if (s) s.ignoredIds = new Set(ids);
      },
      isIgnoringChat: (recipientId, senderCharacterId) => {
        const s = this.sessionByCharacterId(recipientId);
        return s ? s.ignoredIds.has(senderCharacterId) : false;
      },
      chatFlairFor: (senderCharacterId) => this.sessionByCharacterId(senderCharacterId)?.chatFlair,
    };
  }

  private async sendSocialSnapshot(charId: number, firstJoin = false): Promise<void> {
    const session = this.sessionByCharacterId(charId);
    if (!session) return;
    try {
      const snap = await this.social.snapshot(charId);
      this.send(session, { t: 'social', ...snap });
      // Stamp the guild name onto the player's world entity so it rides the
      // identity wire and shows under their nameplate for everyone nearby. This
      // is the single chokepoint hit on join and on every membership change.
      // On the FIRST join-time stamp (firstJoin), a pre-existing guild arrives a
      // beat after addPlayer's retro pass (the name lives in the social DB, not
      // the blob), so retroDeeds re-credits soc_guild_joined silently instead of
      // firing the live banner for an existing member; later changes are genuine
      // live joins and pass firstJoin false.
      this.sim.setPlayerGuild(session.pid, snap.guild?.name ?? '', { retroDeeds: firstJoin });
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
      const list: {
        id: number;
        x: number;
        z: number;
        zone: string;
        status: PresenceStatus;
        title: string | null;
      }[] = [];
      for (const id of ids) {
        const other = this.sessionByCharacterId(id);
        if (!other) continue; // offline — snapshots own the online/offline flip
        const loc = this.presenceOf(other);
        if (loc.x === undefined || loc.z === undefined) continue;
        // The live Book of Deeds title (sim meta, no DB read); the `social`
        // frame's DB-sourced roster value lags the autosave, so this keeps
        // non-nearby friends/guildmates current without a relog. Always
        // present so a cleared title propagates as an explicit null.
        const title = this.sim.meta(other.pid)?.activeTitle ?? null;
        list.push({ id, x: loc.x, z: loc.z, zone: loc.zone, status: loc.status, title });
      }
      if (list.length > 0) this.send(session, { t: 'socialpos', list });
    }
  }

  start(): void {
    let last = process.hrtime.bigint();
    let acc = 0;
    // Stamp the loop-start clock before the first fire: it is the liveness backstop for
    // a loop that never completes a pass (every tick throws), so /livez still goes stale
    // instead of reading a boot-time wedge as warmup forever.
    this.loopStartedAtMs = Date.now();
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
          let ticksRun = 0;
          while (acc >= DT) {
            this.clearStaleInputs();
            lap('stale');
            if (this.perfDetailActive) this.simLapMark = process.hrtime.bigint();
            const events = this.sim.tick();
            lap('tick');
            // Fold this tick's mob-scan counts before the next tick resets them: the
            // latest-tick values feed the heartbeat, and an in-flight capture sums and
            // peaks them across its window.
            const scan = this.sim.mobScanCounters;
            applyMobScanTick(
              this.mobScanTickStats,
              scan.aggroScanPlayerVisits,
              scan.threatEntryVisits,
              this.perfCaptureDeadlineNs !== null,
            );
            this.enforceJailStates();
            this.routeEvents(events);
            this.detectActivity(events);
            lap('events');
            this.runAntibotTick();
            lap('antibot');
            ticksRun++;
            acc -= DT;
          }
          this.recordPerfCaptureCallback(ticksRun);
          this.expireLinkdeadSessions();
          // Anchor the achieved-rate meter to the wall clock (hrtime), never to
          // callback counts: late timer fires and the dt clamp are exactly the
          // losses it exists to expose.
          const nowMs = hrtimeToMs(now);
          this.tickRateMeter.record(nowMs, ticksRun);
          this.tickHz = this.tickRateMeter.rate(nowMs);
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
          this.finalizePerfCaptureIfDue();
          this.tickMsAvg =
            this.tickMsAvg === 0
              ? tickMs
              : this.tickMsAvg + TICK_EMA_ALPHA * (tickMs - this.tickMsAvg);
          this.flushPeriodicSaves(dt);
          // LAST statement of the guarded body, deliberately: this timestamp is the
          // liveness signal /livez reads, so only a pass that ran to completion may
          // refresh it (a body that throws every tick must go stale, not look alive).
          this.lastTickCompletedAt = Date.now();
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
    this.dailyRewardActivityInterval = setInterval(() => {
      void this.recordDailyRewardActivity();
    }, DAILY_REWARD_ACTIVITY_MS);
    this.lastKeepaliveSweepAt = Date.now();
    this.keepaliveInterval = setInterval(() => {
      this.pingLiveSessions();
    }, WS_KEEPALIVE_PING_MS);
  }

  // The periodic persistence flush, advanced by the loop each tick. Every
  // AUTOSAVE_SECONDS it kicks off the character/market/mail saves and, riding the
  // same cadence, heartbeats this process's character load leases so an online
  // character's lease never lapses under a peer. Extracted from the interval body
  // so it can be unit-tested directly (the loop calls it one line). Every write is
  // fire-and-forget: a slow or failed save must not stall the 20 Hz loop.
  private flushPeriodicSaves(dt: number): void {
    this.saveTimer += dt;
    if (this.saveTimer >= AUTOSAVE_SECONDS) {
      this.saveTimer = 0;
      void this.saveAll('autosave');
      void this.saveMarket();
      void this.saveMail();
      void heartbeatCharacterLeases().catch((err) => console.error('lease heartbeat failed:', err));
    }
  }

  private enforceJailStates(): void {
    for (const session of this.clients.values()) {
      this.applyModeratorJailGate(session);
      if (session.jailVisit) {
        const entity = this.sim.entities.get(session.pid);
        if (!entity || entity.dead || !this.isInJailRoom(entity.pos)) {
          this.exitJailVisit(session, false);
        }
        continue;
      }
      if (!session.jailed) continue;
      // Timed sentence served: release to the pre-jail position.
      if (session.jailed.until !== undefined && Date.now() >= session.jailed.until) {
        if (this.releaseJailedSession(session)) {
          this.sendSystemNotice(session, 'Your jail sentence has ended.');
        }
        continue;
      }
      const entity = this.sim.entities.get(session.pid);
      if (!entity || entity.dead || entity.ghost || !isInJailCage(entity.pos)) {
        this.teleportJailedSession(session);
      }
    }
  }

  // The cage gate: walking into the marked bar panel teleports a moderator to
  // the other side. Moderators only (the 'moderation.act' permission, the same
  // one /jail requires); a jailed session never passes, even a jailed
  // moderator, so the cage stays authoritative for its prisoners.
  private applyModeratorJailGate(session: ClientSession): void {
    if (session.jailed) return;
    if (!session.isAdmin || !session.adminPermissions.has('moderation.act')) return;
    const entity = this.sim.entities.get(session.pid);
    if (!entity || entity.dead || entity.ghost) return;
    const target = jailGateTeleport(entity.pos);
    if (target) this.teleportSessionEntity(session, target);
  }

  private isInJailRoom(pos: { x: number; z: number }): boolean {
    return (
      Math.abs(pos.x - JAIL_CENTER.x) <= JAIL_OUTER_HALF &&
      Math.abs(pos.z - JAIL_CENTER.z) <= JAIL_OUTER_HALF
    );
  }

  // Protocol-level WS liveness sweep, every WS_KEEPALIVE_PING_MS. Two jobs:
  // the pings keep NAT/proxy idle timers from silently dropping a quiet
  // connection (an AFK player's client sends no input frames, the classic
  // "kicked while AFK" report), and a peer that missed a whole ping interval
  // (no pong; browsers answer automatically) is a black-holed socket (no
  // FIN/RST ever arrives, e.g. a mobile WiFi-to-cellular handoff), so it is
  // terminated into the linkdead grace. Without the pong check, a re-auth for
  // the same character keeps hitting 'character already in world' until TCP
  // gives up on the dead socket, which can take minutes; with it, the
  // client's reconnect backoff resumes within a ping interval or two (the
  // client tolerates that rejection mid-reconnect, src/net/reconnect_policy.ts).
  pingLiveSessions(): void {
    const now = Date.now();
    // A sweep that fired far later than its interval proves the process stalled, so
    // pong silence is not evidence of a dead client: queued pong frames went
    // unprocessed during the stall. On such a sweep terminate nobody; re-arm every
    // live session (ping again) so the next on-time sweep can judge honestly.
    const delayed = keepaliveSweepDelayed(now, this.lastKeepaliveSweepAt, WS_KEEPALIVE_PING_MS);
    for (const session of this.clients.values()) {
      if (session.linkdead || session.ws.readyState !== 1) continue;
      if (session.awaitingPong && !delayed) {
        const ws = session.ws;
        try {
          ws.terminate();
        } catch {
          /* socket already torn down */
        }
        this.socketClosed(session, ws);
        continue;
      }
      session.awaitingPong = true;
      try {
        session.ws.ping();
      } catch {
        /* socket torn down mid-iteration */
      }
    }
    this.lastKeepaliveSweepAt = now;
  }

  stop(): void {
    if (this.interval) clearInterval(this.interval);
    if (this.holderTierInterval) clearInterval(this.holderTierInterval);
    if (this.playtimeInterval) clearInterval(this.playtimeInterval);
    if (this.dailyRewardActivityInterval) clearInterval(this.dailyRewardActivityInterval);
    if (this.keepaliveInterval) clearInterval(this.keepaliveInterval);
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

  private async recordDailyRewardActivity(): Promise<void> {
    const activeSeconds = await dailyRewardService.activeSeconds();
    for (const session of this.clients.values()) {
      if (this.sim.time - session.lastInputAt > activeSeconds) continue;
      try {
        await dailyRewardService.recordOnlineMinute(session.accountId);
      } catch (err) {
        console.error('daily reward activity record failed:', err);
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

  // Load one player's operator-set account flair (AI mark + streamer links) and
  // stamp it on their entity + session. Best-effort and guarded against the player
  // leaving mid-fetch, exactly like the Discord/holder/dev flair refreshes above.
  private async refreshAccountFlair(session: ClientSession): Promise<void> {
    const flair = await loadAccountFlair(session.accountId);
    if (this.clients.get(session.pid) !== session) return;
    this.stampAccountFlair(session, flair);
  }

  /**
   * Apply an account's flair to one live session: the entity fields the wire encodes
   * (the identity diff re-broadcasts them to nearby players on the next snapshot) and
   * the session copy the chat fan-out reads. `streamerLinks` is set through
   * wireStreamerLinks, so the entity never carries links for an account whose
   * streamer flag is off.
   */
  private stampAccountFlair(session: ClientSession, flair: AccountFlair): void {
    session.accountFlair = flair;
    // Derived once, here, and read straight off the session by every chat fan-out.
    session.chatFlair = chatSenderFlair(flair);
    const e = this.sim.entities.get(session.pid);
    if (!e) return;
    e.aiAccount = flair.ai ? true : undefined;
    e.streamerLinks = wireStreamerLinks(flair);
  }

  /**
   * Push an operator's account-flair edit onto every live session of that account, so
   * the AI mark and the streamer links change with no reconnect. Injected into the
   * admin routes via configureAdminRuntime (server/admin.ts); a no-op when the
   * account is offline (the next join loads the new row anyway).
   */
  applyAccountFlairLive(accountId: number, flair: AccountFlair): void {
    for (const live of this.clients.values()) {
      if (live.accountId !== accountId) continue;
      this.stampAccountFlair(live, flair);
    }
  }

  /** The chat flair of the session at `pid`, read from the SESSION, never an entity. */
  private chatFlairForPid(pid: number): ChatSenderFlair | undefined {
    return this.clients.get(pid)?.chatFlair;
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
      // Enforcement gating lives in the detector's own runtime config (which
      // defaults to the ANTIBOT_ENFORCE env var and is operator-tunable live),
      // so the host-side kill-switch parameter is always granted here.
      const action = this.botDetector.handleTick(
        session.botTrackingContext,
        now,
        true,
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
    // The bare adds bypass the quest-credit mark site, and the lockout quests
    // can satisfy quest/meta deed triggers: request a full evaluator pass.
    if (cosmetics.completedQuestIds.length > 0) this.sim.ctx.markDeedsDirty(pid);
  }

  private mergeAccountCosmetics(a: AccountCosmetics, b: AccountCosmetics): AccountCosmetics {
    // The weapon-skin reads stay nullish-tolerant: pre-weapon-skin callers and
    // test doubles still hand over the older two-field shape at runtime.
    return {
      completedQuestIds: [...new Set([...a.completedQuestIds, ...b.completedQuestIds])],
      mechChromaIds: [...new Set([...a.mechChromaIds, ...b.mechChromaIds])],
      // Ownership is additive (a purchase is never un-bought here); the applied
      // loadout is last-write-wins so a detach (key removed in the fresh state)
      // never resurrects from the stale side.
      weaponSkinIds: [...new Set([...(a.weaponSkinIds ?? []), ...(b.weaponSkinIds ?? [])])],
      weaponSkinLoadout: { ...(b.weaponSkinLoadout ?? {}) },
    };
  }

  /** The account loadout filtered to owned skins, as the Sim seeds it. */
  private ownedWeaponSkinLoadout(cosmetics: AccountCosmetics): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [t, skinId] of Object.entries(cosmetics.weaponSkinLoadout ?? {})) {
      if (skinId && (cosmetics.weaponSkinIds ?? []).includes(skinId)) out[t] = skinId;
    }
    return out;
  }

  private rememberAccountCosmetics(
    accountId: number,
    cosmetics: AccountCosmetics,
  ): AccountCosmetics {
    const merged = this.mergeAccountCosmetics(
      this.accountCosmeticsByAccount.get(accountId) ?? {
        completedQuestIds: [],
        mechChromaIds: [],
        weaponSkinIds: [],
        weaponSkinLoadout: {},
      },
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
      this.sim.setWeaponSkinLoadout(live.pid, this.ownedWeaponSkinLoadout(merged));
      this.resyncQuests(live);
    }
  }

  private replaceLiveAccountCosmetics(accountId: number, cosmetics: AccountCosmetics): void {
    const exact = {
      completedQuestIds: [...new Set(cosmetics.completedQuestIds)],
      mechChromaIds: [...new Set(cosmetics.mechChromaIds)],
      weaponSkinIds: [...new Set(cosmetics.weaponSkinIds ?? [])],
      weaponSkinLoadout: { ...(cosmetics.weaponSkinLoadout ?? {}) },
    };
    this.accountCosmeticsByAccount.set(accountId, exact);
    for (const live of this.clients.values()) {
      if (live.accountId !== accountId) continue;
      live.accountCosmetics = exact;
      this.applyAccountQuestLockouts(live.pid, exact);
      this.sim.setWeaponSkinLoadout(live.pid, this.ownedWeaponSkinLoadout(exact));
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

  /**
   * Grant a mech-chroma cosmetic to an account by id (a Discord swag claim, whose
   * points/claim are already resolved durably server-side). Best-effort live update:
   * persist the grant, then push the refreshed cosmetics to any online session on the
   * account. The live push is a no-op when the account is offline. Injected into the
   * ported Discord swag route via configureDiscordRuntime (server/discord.ts).
   */
  grantMechChromaToAccount(accountId: number, chromaId: string): void {
    void grantAccountMechChroma(accountId, chromaId)
      .then((cosmetics) => this.updateLiveAccountCosmetics(accountId, cosmetics))
      .catch((err) => console.error('failed to grant swag mech chroma:', err));
  }

  /**
   * Mirror Season 1 Armory weapon-skin ownership into accounts.cosmetics and
   * push it to any live session on the account. Injected into the Claudium
   * spend/store routes via configureClaudiumRuntime (server/claudium.ts); the
   * economy service's grant ledger stays the purchase source of truth.
   */
  grantWeaponSkinsToAccount(accountId: number, skinIds: string[]): void {
    const known = skinIds.filter((id) => WEAPON_SKINS[id]);
    if (known.length === 0) return;
    const current = this.accountCosmeticsByAccount.get(accountId);
    if (current && known.every((id) => current.weaponSkinIds.includes(id))) return;
    // Optimistic live union first (mirrors noteAccountMechChroma): the buyer can
    // hit Apply the moment the spend response lands, without racing the write.
    if (current) {
      this.updateLiveAccountCosmetics(accountId, {
        ...current,
        weaponSkinIds: [...new Set([...current.weaponSkinIds, ...known])],
      });
    }
    void grantAccountWeaponSkins(accountId, known)
      .then((cosmetics) => this.updateLiveAccountCosmetics(accountId, cosmetics))
      .catch((err) => console.error('failed to grant account weapon skins:', err));
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

  /** Apply (skinId set) or detach (skinId null + wtype) a Season 1 Armory weapon
   *  skin. Server-authoritative: the account must own the skin, and the Sim
   *  re-validates that a weapon of the skin's type is equipped right now. The
   *  loadout is account state, so every session on the account updates live. */
  private changeAccountWeaponSkin(
    session: ClientSession,
    skinId: string | null,
    wtype?: string,
  ): void {
    const current = session.accountCosmetics;
    let weaponSkinLoadout: Record<string, string>;
    if (skinId !== null) {
      const def = WEAPON_SKINS[skinId];
      if (!def) return;
      if (!current.weaponSkinIds.includes(skinId)) return; // must own it (anti-forge)
      if (!this.sim.setWeaponSkin(session.pid, skinId)) return; // type-match gate
      weaponSkinLoadout = withWeaponSkinApplied(current.weaponSkinLoadout, skinId) ?? {};
    } else {
      if (!wtype || !isWeaponSkinType(wtype)) return;
      if (!current.weaponSkinLoadout[wtype]) return;
      this.sim.setWeaponSkin(session.pid, null, wtype);
      weaponSkinLoadout = { ...current.weaponSkinLoadout };
      delete weaponSkinLoadout[wtype];
    }
    this.updateLiveAccountCosmetics(session.accountId, { ...current, weaponSkinLoadout });
    this.enqueueWeaponSkinLoadoutSave(session.accountId, weaponSkinLoadout);
  }

  private enqueueWeaponSkinLoadoutSave(
    accountId: number,
    weaponSkinLoadout: Record<string, string>,
  ): void {
    const snapshot = { ...weaponSkinLoadout };
    const previous = this.weaponSkinLoadoutSaveQueues.get(accountId);
    const run = (previous ? previous.catch(() => {}) : Promise.resolve()).then(async () => {
      await setAccountWeaponSkinLoadout(accountId, snapshot);
    });
    this.weaponSkinLoadoutSaveQueues.set(accountId, run);
    const cleanup = (): void => {
      if (this.weaponSkinLoadoutSaveQueues.get(accountId) === run) {
        this.weaponSkinLoadoutSaveQueues.delete(accountId);
      }
    };
    void run.then(cleanup, (err) => {
      console.error('failed to save weapon skin loadout:', err);
      cleanup();
    });
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
        adminPermissions?: readonly string[];
        clientSeed?: string;
        fbp?: string | null;
        fbc?: string | null;
        sourceUrl?: string | null;
        leaseNonce?: string;
        // Server-recomputed bank bonus slots (ws_auth.ts, fresh-join arm) stamped into
        // the character state via addPlayer. Absent on a resume and for callers that
        // pass no meta (tests, the bot-detector overlay), which keep the saved value.
        bankBonus?: { bonusSlots: number; sources: BankBonusSource[] };
      } = {},
  ): ClientSession | { error: string } {
    // Anti-bot: cap simultaneous online characters per account. Accounts can
    // still own up to 10 characters; this only limits live sessions. GMs are
    // exempt for supervision. Linkdead sessions are special-cased (planJoin):
    // the same character resumes its held session, and a different character
    // on the account displaces them instead of being blocked by them.
    const sameCharacter = this.sessionsByCharacterId.get(characterId) ?? null;
    let liveOtherSessions = 0;
    const linkdeadOthers: ClientSession[] = [];
    for (const s of this.clients.values()) {
      if (s.accountId !== accountId || s === sameCharacter) continue;
      if (s.linkdead) linkdeadOthers.push(s);
      else liveOtherSessions++;
    }
    const plan = planJoin({
      accountId,
      isGm,
      sameCharacter,
      liveOtherSessions,
      maxPerAccount: MAX_ACTIVE_SESSIONS_PER_ACCOUNT,
    });
    if (plan.action === 'reject') return { error: plan.error };
    if (plan.action === 'resume' && sameCharacter) {
      return this.resumeSession(sameCharacter, ws, cls, meta);
    }
    // Logging in on a different character ends the account's linkdead grace
    // now instead of at the end of its window: the player has moved on, so
    // the held character logs out. leave() removes it from `clients`
    // synchronously, so the new session's slot accounting stays correct.
    for (const s of linkdeadOthers) {
      void this.leave(s, 'replaced by a new character login');
    }
    const pid = this.sim.addPlayer(cls, name, {
      state: state ?? undefined,
      characterId,
      bankBonus: meta.bankBonus,
    });
    if (isGm) {
      // GM characters: invulnerable, and always at the level cap (the row is
      // created without state, so the first join levels them up)
      this.sim.setGm(pid);
      const e = this.sim.entities.get(pid);
      if (e && e.level < 20) this.sim.setPlayerLevel(20, pid);
    }
    const accountCosmetics = this.rememberAccountCosmetics(
      accountId,
      meta.accountCosmetics ?? {
        completedQuestIds: [],
        mechChromaIds: [],
        weaponSkinIds: [],
        weaponSkinLoadout: {},
      },
    );
    this.applyAccountQuestLockouts(pid, accountCosmetics);
    // Seed the account-wide weapon-skin loadout onto the fresh sim entity so the
    // applied skin shows from the first snapshot (owned skins only).
    this.sim.setWeaponSkinLoadout(pid, this.ownedWeaponSkinLoadout(accountCosmetics));
    const sessionIp = meta.ip ?? '';
    const initialLevel = this.sim.entities.get(pid)?.level ?? state?.level ?? 1;
    const botTrackingContext = this.botDetector.createTrackingContext(
      { accountId, characterId, name, ip: sessionIp },
      meta,
    );
    const session: ClientSession = {
      ws,
      accountId,
      accountCosmetics,
      // Loaded right below by refreshAccountFlair; an account with no flair (every
      // ordinary player) keeps these empty values and never touches the wire.
      accountFlair: EMPTY_ACCOUNT_FLAIR,
      chatFlair: undefined,
      characterId,
      pid,
      name,
      lastSave: Date.now(),
      alive: true,
      joinedAt: Date.now(),
      dbSessionId: null,
      metricsMaxLevel: initialLevel,
      left: false,
      linkdead: false,
      graceUntil: 0,
      awaitingPong: false,
      chatTokens: CHAT_RATE_BURST,
      chatLastRefill: Date.now() / 1000,
      chatLastRateError: 0,
      chatRateViolations: 0,
      chatCooldownUntil: 0,
      msgRate: createMsgRateBucket(Date.now() / 1000),
      chatMutedUntil: meta.mutedUntil ? new Date(meta.mutedUntil).getTime() : null,
      chatMuteReason: meta.reason ?? '',
      chatStrikes: meta.chatStrikes ?? 0,
      blockedIds: new Set(),
      blockListLoaded: false,
      ignoredIds: new Set(),
      lastWhisperFrom: null,
      rememberedChat: { channel: 'say' },
      lastInputSeq: 0,
      lastInputAt: this.sim.time,
      lastSent: {},
      lastArenaWireTick: -ARENA_WIRE_INTERVAL_TICKS,
      lastVcupWireTick: -VC_WIRE_INTERVAL_TICKS,
      lastDfWireTick: -DF_WIRE_INTERVAL_TICKS,
      selfHeavyDirty: true,
      lastWireRev: -1,
      sentEnts: new Map(),
      ip: sessionIp,
      userAgent: meta.userAgent ?? '',
      fbp: meta.fbp ?? '',
      fbc: meta.fbc ?? '',
      sourceUrl: meta.sourceUrl ?? '',
      isAdmin: meta.isAdmin ?? false,
      // Permissions come only from the explicit set main.ts computes from the
      // account's roles; no is_admin fallback (fail closed, matching
      // staff_db.effectiveAdminRoles). A staff member with zero permissions has
      // no in-game moderation commands.
      adminPermissions: new Set(meta.adminPermissions ?? []),
      clientSeed: meta.clientSeed ?? '',
      leaseNonce: meta.leaseNonce,
      botTrackingContext,
      pendingDeedRecords: [],
      spectating: null,
      jailed: state?.jail ?? null,
      jailVisit: null,
    };
    if (session.jailed) this.teleportJailedSession(session);
    this.ipSessionCounts.set(sessionIp, (this.ipSessionCounts.get(sessionIp) ?? 0) + 1);
    this.clients.set(pid, session);
    this.sessionsByCharacterId.set(characterId, session);
    this.peakOnline = Math.max(this.peakOnline, this.clients.size);
    void this.recordOnlineSnapshot();
    // Stamp this character's last world-entry time for the guild-roster "last
    // seen" readout. Best-effort: a failed write must never block joining.
    void touchCharacterLogin(characterId).catch((err) =>
      console.error('failed to stamp character last_login:', err),
    );
    // Book of Deeds drift heal: the character_deeds index is written
    // fire-and-forget per unlock, and the sim never re-emits a deed already in
    // the state blob, so a transient per-unlock insert failure leaves the index
    // one row short forever. Replay this character's whole LIVE earned set
    // (deedsEarned after addPlayer's retro pass) into the index once per join,
    // idempotently (ON CONFLICT DO NOTHING). That set is the loaded blob deeds
    // PLUS the retro/legacy grants the retro pass just added, not only the
    // loaded ids: every join-time grant is a deterministic function of the
    // already-durable blob, so a crash that loses the index rows costs nothing
    // to replay, and the batch is a DB write only (it never calls
    // onDeedRecorded, so it never drives Steam; Steam's own login catch-up is
    // reconcileOnLogin below). Fire-and-forget: it never blocks or reorders the
    // join, and resumes skip it (they return above without reloading state).
    reconcileCharacterDeeds({ characterId, accountId }, [
      ...(this.sim.meta(pid)?.deedsEarned.keys() ?? []),
    ]);
    // Steam mirror drift heal (the steady-state counterpart to the link-time
    // reconcile): a live achievement push can exhaust its retry ladder and
    // drop, and an already-linked account never re-links, so the login
    // reconcile is the only path that replays it. Chained BEHIND the deeds
    // records FIFO rather than run beside it: reconcileOnLogin stamps a 6h TTL
    // then reads earnedDeedIds, so if it ran before the reconcile above healed a
    // dropped character_deeds row it would miss that id and the TTL would
    // throttle the retry for 6h. Awaiting the tail first guarantees its read
    // observes the healed rows. deedRecordsIdle is NOT awaited on the join path
    // (join latency is unchanged); the continuation is fire-and-forget, fully
    // guarded, per-account throttled, and a no-op unless STEAM_ENABLED and the
    // account is linked.
    void deedRecordsIdle()
      .then(() => reconcileOnLogin(accountId))
      .catch(() => {});
    openPlaySession(accountId, characterId, name, meta, initialLevel)
      .then((id) => {
        session.dbSessionId = id;
        // If the player disconnected before this insert landed, leave() saw a
        // null id and skipped the close. Close it now so the row isn't orphaned.
        if (session.left) {
          void closePlaySession(id, session.metricsMaxLevel).catch((err) =>
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
    // firstJoin: the fresh-join path (a resume takes resumeSession, which stamps
    // the guild with firstJoin false since the entity already carries it), so
    // the first guild stamp retro-credits an existing member's soc_guild_joined
    // silently instead of firing the live banner.
    void this.initSocial(session, true);
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
    // Stamp the operator-set account flair (AI mark + streamer links), same
    // best-effort contract: a flair read must never affect joining the world.
    void this.refreshAccountFlair(session).catch((err) =>
      console.error('account flair refresh failed:', err),
    );
    return session;
  }

  // Rebind a linkdead session to a fresh socket. The character never left the
  // world, so this only swaps the transport, refreshes the per-login account
  // metadata, and resets the per-connection wire/input state so the new client
  // receives a full snapshot (its input sequence also restarts at 1). The play
  // session row stays open (the player was online the whole time) and no
  // presence announce fires (friends never saw them leave).
  private resumeSession(
    session: ClientSession,
    ws: WebSocket,
    cls: import('../src/sim/types').PlayerClass,
    meta: Parameters<GameServer['join']>[7] = {},
  ): ClientSession {
    session.ws = ws;
    session.linkdead = false;
    session.graceUntil = 0;
    session.awaitingPong = false;
    const sessionIp = meta.ip ?? '';
    if (sessionIp !== session.ip) {
      this.releaseIpSession(session.ip);
      session.ip = sessionIp;
      this.ipSessionCounts.set(sessionIp, (this.ipSessionCounts.get(sessionIp) ?? 0) + 1);
    }
    session.userAgent = meta.userAgent ?? '';
    session.clientSeed = meta.clientSeed ?? '';
    this.botDetector.setTrackingConnection(session.botTrackingContext, true, meta);
    // per-login account state, freshly loaded by the auth path like any join
    session.chatMutedUntil = meta.mutedUntil ? new Date(meta.mutedUntil).getTime() : null;
    session.chatMuteReason = meta.reason ?? '';
    session.chatStrikes = meta.chatStrikes ?? session.chatStrikes;
    session.isAdmin = meta.isAdmin ?? false;
    session.adminPermissions = new Set(meta.adminPermissions ?? []);
    session.lastInputSeq = 0;
    session.lastInputAt = this.sim.time;
    session.lastSent = {};
    session.sentEnts = new Map();
    session.selfHeavyDirty = true;
    session.lastWireRev = -1;
    session.lastArenaWireTick = -ARENA_WIRE_INTERVAL_TICKS;
    this.send(session, {
      t: 'hello',
      pid: session.pid,
      seed: this.sim.cfg.seed,
      name: session.name,
      cls,
      realm: REALM,
      softWords: this.chatFilter.softWords(),
      chatMutedUntil: session.chatMutedUntil ?? null,
    });
    // No self "entered the world" notice here: on a seamless reconnect the
    // player never saw themselves leave (and friends never got a presence
    // flap), so the fresh join notice would read as a glitch.
    if (session.jailed) this.teleportJailedSession(session);
    void this.sendSocialSnapshot(session.characterId);
    return session;
  }

  // Entry point for a dropped socket (the ws 'close'/'error' handlers in
  // main.ts, plus the backpressure terminate). Instead of logging the
  // character out, hold the session linkdead for LINKDEAD_GRACE_MS so an
  // accidental disconnect can resume seamlessly; the character stays in the
  // sim and stays online for friends, analytics, and the play session row.
  // Returns true when grace began (false: the session was already torn down,
  // already linkdead, or the event came from a stale pre-resume socket).
  socketClosed(session: ClientSession, ws: WebSocket): boolean {
    // A late close/error from a socket that a resume already replaced must
    // not tear down the live session riding the new socket.
    if (session.ws !== ws) return false;
    if (session.left || session.linkdead || !this.clients.has(session.pid)) return false;
    if (session.spectating) this.exitSpectate(session, false);
    if (session.jailVisit) this.exitJailVisit(session, false);
    session.linkdead = true;
    session.graceUntil = Date.now() + LINKDEAD_GRACE_MS;
    this.botDetector.setTrackingConnection(session.botTrackingContext, false);
    // Stop any held movement now; the sim keeps ticking this entity (it can
    // still be attacked, healed, or die while linkdead, like any player).
    const meta = this.sim.meta(session.pid);
    if (meta) Object.assign(meta.moveInput, emptyMoveInput());
    // Safety flush so a process crash during the grace window loses nothing.
    void this.saveCharacter(session, { withMarket: true }).catch((err) =>
      console.error(`linkdead save failed for ${session.name}:`, err),
    );
    return true;
  }

  // Tick-driven teardown of linkdead sessions whose grace window ran out.
  private expireLinkdeadSessions(): void {
    if (this.clients.size === 0) return;
    const now = Date.now();
    for (const session of this.clients.values()) {
      if (!session.linkdead || now < session.graceUntil) continue;
      console.log(
        `- ${session.name} left (linkdead grace expired), ${this.clients.size - 1} online`,
      );
      void this.leave(session, 'linkdead grace expired');
    }
  }

  private releaseIpSession(ip: string): void {
    if (!ip) return;
    const prev = this.ipSessionCounts.get(ip) ?? 1;
    if (prev <= 1) this.ipSessionCounts.delete(ip);
    else this.ipSessionCounts.set(ip, prev - 1);
  }

  // Load the player's block list, send their friends/ignore/guild panel, and
  // let friends + guildmates know they've come online.
  private async initSocial(session: ClientSession, firstJoin = false): Promise<void> {
    try {
      session.blockedIds = new Set(await this.socialDb.blockedIds(session.characterId));
      session.blockListLoaded = true;
    } catch (err) {
      console.error('failed to load block list:', err);
    }
    try {
      session.ignoredIds = new Set(await this.socialDb.ignoredIds(session.characterId));
    } catch (err) {
      console.error('failed to load ignore list:', err);
    }
    await this.sendSocialSnapshot(session.characterId, firstJoin);
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
    if (session.jailVisit) this.exitJailVisit(session, false);
    session.left = true;
    this.clients.delete(session.pid);
    this.botDetector.releaseTrackingContext(session.botTrackingContext);
    this.releaseIpSession(session.ip);
    void this.recordOnlineSnapshot();
    this.devTierPids.delete(session.pid);
    this.social.forget(session.characterId);
    // delete from clients first so friends see them as offline in the notice
    void this.social
      .announcePresence({ characterId: session.characterId, name: session.name }, false)
      .catch((err) => console.error('presence announce failed:', err));
    if (session.dbSessionId !== null) {
      void closePlaySession(session.dbSessionId, session.metricsMaxLevel).catch((err) =>
        console.error('failed to close play session:', err),
      );
    }
    // Deserting a live Vale Cup match resolves BEFORE the leave save so the
    // benched slot and the counted loss are in the state serializeCharacter
    // persists (idempotent: removePlayer runs it again harmlessly below).
    this.sim.vcupResolveDesertion(session.pid);
    // Arena forfeit accounting also resolves before persistence. This keeps the
    // remaining player's win/honor durable if both combatants disconnect close
    // together; removePlayer repeats the idempotent cleanup after the save.
    this.sim.arenaResolveDesertion(session.pid);
    // Freeze reward eligibility and reconcile pending loot before the leave
    // snapshot. saveCharacterOnLeave awaits the database; without this
    // synchronous prefix, a roll or boss death can mutate the character after
    // serialization and removePlayer then discards that unsaved reward.
    this.sim.preparePlayerLeave(session.pid);
    await this.saveCharacterOnLeave(session);
    this.sessionsByCharacterId.delete(session.characterId);
    // Release the per-character load lease so a fresh login (here or on another
    // process) can reload the character without waiting out the TTL. Order
    // matters: only after saveCharacterOnLeave has awaited above, so the lease
    // outlives the atomic leave-flush. Awaiting it (unlike the fire-and-forget
    // closePlaySession) makes the sequential takeover path prompt: takeOverCharacter
    // awaits leave(), so this DELETE lands before the client's rejoin re-acquires.
    // The grace-expiry sweep instead calls leave() fire-and-forget, so a reconnect
    // CAN interleave; the NONCE fence covers that, the reconnect's acquire re-stamps
    // the row with a new nonce and this DELETE, carrying the session's own (now
    // stale) nonce, matches nothing, so it never eats the live session's re-acquired
    // lease. The fence only sees fresh acquires, so planJoin refuses to RESUME a
    // session whose left flag is already set (the resume arm never re-acquires);
    // the refused client retries into the fresh-acquire arm once this teardown
    // finishes. The holder guard keeps a cross-process reclaim untouched; an
    // unreleased lease self-expires after a crash.
    await releaseCharacterLease(session.characterId, session.leaseNonce).catch((err) =>
      console.error('lease release failed:', err),
    );
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
      // Captured at serialize time: only unlocks already inside THIS blob may
      // publish when it lands. An unlock granted while the write is in flight
      // stays pending for the save queued behind it, so the character_deeds
      // index (and Steam, chained off it) never runs ahead of durable state.
      const recordUpTo = session.pendingDeedRecords.length;
      if (state && e) {
        if (session.spectating) {
          state.pos = {
            x: session.spectating.savedPos.x,
            z: session.spectating.savedPos.z,
          };
          state.pet = session.spectating.stowedPet;
        }
        if (session.jailVisit) {
          state.pos = {
            x: session.jailVisit.savedPos.x,
            z: session.jailVisit.savedPos.z,
          };
          state.facing = session.jailVisit.savedFacing;
          state.pet = session.jailVisit.stowedPet;
        }
        if (session.jailed) {
          const jailPos = this.jailSpawnFor(session);
          state.pos = { x: jailPos.x, z: jailPos.z };
          state.jail = session.jailed;
          state.dead = false;
          state.ghost = false;
          state.corpsePos = null;
          state.hp = Math.max(1, state.hp);
        } else {
          delete state.jail;
        }
        // Use the SERIALIZED level (not e.level): during a 2v2 Fiesta bout e.level
        // is temporarily 20, but serializeCharacter reports the real level — so the
        // character-list/leaderboard `level` column never reflects the temp state.
        let saved: boolean;
        if (opts.withMarket) {
          // Atomic on the leave path so a logout bag-flush can never tear away
          // from the global Market escrow (see saveCharacterAndMarketState). Run
          // through the market queue and capture the market snapshot at write
          // time so this commit can't clobber a newer one.
          saved = await this.enqueueMarketWrite(() =>
            saveCharacterAndMarketState(
              session.characterId,
              state.level,
              state,
              this.sim.serializeMarket(),
              this.sim.serializeMail(),
              session.leaseNonce,
            ),
          );
        } else {
          saved = await saveCharacterState(
            session.characterId,
            state.level,
            state,
            session.leaseNonce,
          );
        }
        // A same-account takeover can reclaim this character's lease and rotate the
        // nonce out from under a displaced session; the lease-fenced save then matches
        // no row and reports false, meaning nothing persisted. Skip every post-save
        // step: never stamp lastSave (the write did not land) and never drain
        // pendingDeedRecords into the durable index (a deed must never publish ahead
        // of the blob that proves it). The ids stay queued and simply never drain for
        // this doomed session; the live holder records its own unlocks from its own
        // saves. Only an explicit false is a fence-out: the no-nonce legacy path
        // returns true, so a strict comparison never mistakes an ordinary save for one.
        if (saved === false) {
          console.warn(
            `character ${session.characterId} (${session.name}) save fenced out by a same-account takeover; skipping deed publish and lastSave`,
          );
          // The lease is gone: this session is a displaced zombie whose writes
          // can never land again. Give the player the same explicit signal an
          // in-process takeover sends instead of letting them keep playing an
          // unsaved session. Deliberately not awaited: kickSession -> leave ->
          // the leave save queues behind this closure on the per-character save
          // queue, so awaiting here would deadlock. leave() is idempotent
          // (session.left), so that leave save fencing out again cannot re-kick.
          if (!session.left) {
            void this.kickSession(session, 'character taken over', 'character taken over');
          }
          return;
        }
        session.lastSave = Date.now();
        // The blob is durable: publish every unlock it contains. A rejected
        // save skips this (the throw propagates past it), leaving the ids
        // pending for the next save attempt (the 30s autosave, the next
        // unlock's save, or the leave save), so a transient failure delays
        // the public record instead of publishing it ahead of the source.
        // A returning veteran's first save flushes many pending unlocks at
        // once; recordDeedUnlocks mirrors the whole spliced slice in ONE
        // multi-row insert (a single id still takes the single-row path), so a
        // login storm never serializes N single-row round trips ahead of the
        // index and the Steam pushes. The capture-at-serialize recordUpTo
        // watermark is preserved: only ids already inside THIS blob drain now.
        recordDeedUnlocks(
          { characterId: session.characterId, accountId: session.accountId },
          session.pendingDeedRecords.splice(0, recordUpTo),
        );
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

  // The Ravenpost mail book: shared global state like the market, persisted as
  // a single per-realm JSONB blob. Writes ride the market queue so a mail
  // snapshot can never interleave with the atomic leave-path write.
  async loadMail(): Promise<void> {
    try {
      this.sim.loadMail(await loadMailState());
    } catch (err) {
      console.error('failed to load mail:', err);
    }
  }

  async saveMail(): Promise<void> {
    try {
      await this.enqueueMarketWrite(() => saveMailState(this.sim.serializeMail()));
    } catch (err) {
      console.error('failed to save mail:', err);
    }
  }

  rekeyMarketSeller(characterId: number, oldName: string, newName: string): boolean {
    return this.sim.rekeyMarketSeller(characterId, oldName, newName);
  }

  rekeyMailOwner(characterId: number, oldName: string, newName: string): boolean {
    return this.sim.rekeyMailOwner(characterId, oldName, newName);
  }

  // Close every open play_sessions row; called on graceful shutdown so the
  // sessions of currently-online players keep their real duration.
  async endAllPlaySessions(): Promise<void> {
    for (const session of this.clients.values()) {
      if (session.dbSessionId === null) continue;
      await closePlaySession(session.dbSessionId, session.metricsMaxLevel).catch((err) =>
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
  perfProfile(): { online: number; simEntities: number; tickHz: number | null } & ReturnType<
    TickProfiler['profile']
  > {
    return {
      online: this.clients.size,
      simEntities: this.sim.entities.size,
      tickHz: this.tickHz == null ? null : round2(this.tickHz),
      ...this.tickProfiler.profile(),
    };
  }

  // Achieved sim Hz for the /metrics exporter (server/http/game_metrics.ts), or
  // null while the rate meter is still warming up (its first second of uptime).
  simTickHz(): number | null {
    return this.tickHz == null ? null : round2(this.tickHz);
  }

  // Wall clock (epoch millis) of the last COMPLETED tick pass for the /livez
  // staleness read (server/http/health.ts), or null while the loop is still
  // warming up (before its first pass completes).
  lastTickAt(): number | null {
    return this.lastTickCompletedAt;
  }

  // Wall clock (epoch millis) when start() last installed the loop, or null before it.
  // The /livez staleness read (server/http/health.ts) falls back to this when no pass
  // has completed yet, so a loop that starts but never completes one still goes stale.
  loopStartedAt(): number | null {
    return this.loopStartedAtMs;
  }

  // Per-phase loop timing (p95 + max, in MILLISECONDS) for the /metrics exporter,
  // keyed by phase name. The exporter converts to seconds and surfaces only its
  // fixed WOC_TICK_PHASES subset, so the exported label set stays bounded.
  tickPhaseMillis(): Record<string, { p95: number; max: number }> {
    const { phases } = this.tickProfiler.profile();
    const out: Record<string, { p95: number; max: number }> = {};
    for (const [name, stats] of Object.entries(phases)) {
      out[name] = { p95: stats.p95, max: stats.max };
    }
    return out;
  }

  // Start an on-demand detailed capture (admin-triggered). Clears the profiler so the
  // window is clean, flips the detailed sub-phase timing on, and schedules the close
  // `durationMs` (clamped) out in wall time. A second call while one is running just
  // restarts the window. Returns the resulting status for the caller to echo back.
  startPerfCapture(durationMs = PERF_CAPTURE_DEFAULT_MS): PerfCaptureStatus {
    const clamped = Math.round(
      Math.min(PERF_CAPTURE_MAX_MS, Math.max(PERF_CAPTURE_MIN_MS, durationMs)),
    );
    this.tickProfiler.reset();
    this.perfDetailActive = true;
    this.perfCaptureDurationMs = clamped;
    this.perfCaptureId = randomUUID();
    this.perfCaptureLoopCallbacks = 0;
    this.perfCaptureSimTicks = 0;
    this.perfCaptureCatchUpCallbacks = 0;
    this.perfCaptureMaxTicksPerCallback = 0;
    resetMobScanCaptureAccumulators(this.mobScanTickStats);
    this.perfCaptureEndsAtMs = Date.now() + clamped;
    this.perfCaptureDeadlineNs = process.hrtime.bigint() + BigInt(clamped) * 1_000_000n;
    return this.perfCaptureStatus();
  }

  // The current capture status: whether one is in flight (with its close time for a UI
  // countdown) and the last frozen result. Read by GET /admin/api/perf/tick.
  perfCaptureStatus(): PerfCaptureStatus {
    const capturing = this.perfCaptureDeadlineNs !== null;
    return {
      captureId: capturing ? this.perfCaptureId : null,
      capturing,
      endsAt: capturing ? this.perfCaptureEndsAtMs : null,
      last: this.lastPerfCapture,
    };
  }

  private recordPerfCaptureCallback(ticksRun: number): void {
    if (this.perfCaptureDeadlineNs === null) return;
    this.perfCaptureLoopCallbacks++;
    this.perfCaptureSimTicks += ticksRun;
    if (ticksRun > 1) this.perfCaptureCatchUpCallbacks++;
    this.perfCaptureMaxTicksPerCallback = Math.max(this.perfCaptureMaxTicksPerCallback, ticksRun);
  }

  // Resolve (and memoize) the registered profiler bucket for a mob template. A
  // templateId whose family does not resolve falls into 'other'; every result is a
  // name registered via MOB_UPDATE_BUCKETS, so TickProfiler.add never drops it.
  private mobUpdateBucketName(templateId: string): string {
    let name = this.mobUpdateBucketNames.get(templateId);
    if (name === undefined) {
      const family = MOBS[templateId]?.family ?? 'other';
      name = `sim.mob.update|${family}`;
      this.mobUpdateBucketNames.set(templateId, name);
    }
    return name;
  }

  // Close an in-flight capture once its monotonic deadline passes: freeze the profile
  // and revert the detailed-timing switch to its baseline (env, so PERF_TICK_LOG keeps
  // working). Called once per loop body, right after commit.
  private finalizePerfCaptureIfDue(): void {
    if (this.perfCaptureDeadlineNs === null) return;
    if (process.hrtime.bigint() < this.perfCaptureDeadlineNs) return;
    if (this.perfCaptureId === null) return;
    this.lastPerfCapture = {
      captureId: this.perfCaptureId,
      capturedAt: Date.now(),
      durationMs: this.perfCaptureDurationMs,
      loopCallbacks: this.perfCaptureLoopCallbacks,
      simTicks: this.perfCaptureSimTicks,
      catchUpCallbacks: this.perfCaptureCatchUpCallbacks,
      maxTicksPerCallback: this.perfCaptureMaxTicksPerCallback,
      online: this.clients.size,
      simEntities: this.sim.entities.size,
      aggroVisitsTotal: this.mobScanTickStats.aggroVisitsTotal,
      aggroVisitsMaxPerTick: this.mobScanTickStats.aggroVisitsMaxPerTick,
      threatVisitsTotal: this.mobScanTickStats.threatVisitsTotal,
      threatVisitsMaxPerTick: this.mobScanTickStats.threatVisitsMaxPerTick,
      profile: this.tickProfiler.profile(),
    };
    this.perfCaptureDeadlineNs = null;
    this.perfCaptureId = null;
    this.perfDetailActive = process.env.PERF_TICK_LOG === '1';
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
      `[perf] online=${this.clients.size} ents=${this.sim.entities.size} tickHz=${this.tickHz == null ? 'n/a' : round2(this.tickHz)} tickMs=${round2(tickMs)}${overBudget ? ' OVER' : ''}` +
        ` | p95/max ${['total', 'tick', 'broadcast', 'bcastSelf', 'bcastGrid', 'events', 'social'].map(fmt).join(' ')}` +
        ` | visits=${this.bcVisits} serializes=${this.bcSerializes} serializeMs=${round2(Number(this.bcSerializeNs) / 1e6)} aggroVisits=${this.mobScanTickStats.lastAggroScanVisits} threatVisits=${this.mobScanTickStats.lastThreatEntryVisits}`,
    );
    // The sim.tick() internal breakdown, mean-sorted so the phase that actually eats
    // the average (not just a spike) leads. Populated only while detailed timing is on.
    const simPhases = SIM_LAP_PHASES.filter((n) => p[n] && p[n].mean > 0).sort(
      (a, b) => p[b].mean - p[a].mean,
    );
    if (simPhases.length > 0) {
      const fmtMean = (n: string) => `${n.slice(4)}=${p[n].mean}/${p[n].p95}/${p[n].max}`;
      console.log(`[perf.sim] mean/p95/max ${simPhases.slice(0, 14).map(fmtMean).join(' ')}`);
    }
    // Per-zone split of mob.update, mean-sorted so the zone eating the
    // phase leads. Only prints when the mob.update cost is actually attributed to a
    // zone, so a normal tick stays quiet.
    const zonePhases = SIM_MOB_ZONE_PHASES.filter((n) => p[n] && p[n].mean > 0).sort(
      (a, b) => p[b].mean - p[a].mean,
    );
    if (zonePhases.length > 0) {
      const fmtZone = (n: string) =>
        `${n.slice(MOB_ZONE_PHASE_PREFIX.length)}=${p[n].mean}/${p[n].p95}/${p[n].max}`;
      console.log(`[perf.sim.mob] zone mean/p95/max ${zonePhases.map(fmtZone).join(' ')}`);
    }
  }

  suspiciousPlayers(): SuspiciousPlayer[] {
    return this.botDetector.listSuspiciousPlayers();
  }

  antibotConfigFields(): ConfigField[] {
    return this.botDetector.describeConfig();
  }

  // Validates and applies live (invalid entries are skipped and reported; the
  // admin save path rejects on any error and re-applies its previous document).
  applyAntibotConfig(overrides: Record<string, unknown>): ConfigApplyResult {
    return this.botDetector.applyConfig(overrides);
  }

  detectionCalibration(): DetectionCalibrationSnapshot {
    return buildDetectionCalibrationSnapshot(
      this.botDetector.listCalibrationHistograms(),
      this.startedAt,
      Date.now(),
    );
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
    // A socket can deliver already-buffered frames after leave() removes its
    // session and starts the awaited persistence flush. Never let that stale
    // authority mutate live state after the character snapshot was captured.
    if (session.left || this.clients.get(session.pid) !== session) return;
    gameMetricsCounters().wsMessage('in');
    const receivedAtMs = Date.now();
    const verdict = consumeMsgToken(session.msgRate, receivedAtMs / 1000);
    if (verdict === 'kick') {
      void this.kickSession(session, 'rejected by server', 'moderation action');
      return;
    }
    if (verdict === 'drop') return;
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
    // Deliberate logout: the client wants a clean leave, not a linkdead grace.
    // Calling leave() immediately sets session.left = true, so the subsequent
    // WebSocket close event (from the page reload) is a no-op in socketClosed().
    if (msg.t === 'logout') {
      void this.leave(session, 'logout');
      return;
    }
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
      // A released spirit turns with the camera like the living; only a corpse that
      // has not yet released (dead and not a ghost) keeps its facing frozen. Without
      // this the server drops the ghost's mouselook facing and its run feels inverted.
      if (frame.facing !== null && (!e.dead || e.ghost)) {
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
      if (canAttemptModerationCommands(session) && this.moderation.handleChatCommand(session, text))
        return;
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
    // A jailed session cannot enrol in instanced content: a popped match or an
    // instance entry would teleport it out of the cage and the jail enforcement
    // straight back, ruining the match for everyone else in it.
    if (session.jailed && typeof msg.cmd === 'string' && JAILED_BLOCKED_COMMANDS.has(msg.cmd)) {
      this.sendChatNotice(session, 'You cannot do that while jailed.');
      return;
    }
    // A command that can change a heavy self field forces the next snapshot to
    // re-diff those fields (combat-only commands like cast/target/attack do not,
    // which is what keeps the gating a win during a fight).
    if (typeof msg.cmd === 'string' && HEAVY_SELF_CMDS.has(msg.cmd)) session.selfHeavyDirty = true;
    switch (command) {
      case 'castSlot':
        if (typeof msg.slot === 'number') sim.castAbilityBySlot(msg.slot | 0, pid);
        break;
      case 'castAt':
        // Ground-targeted cast: the client proposes a world point; the sim clamps
        // it to the ability's range from the caster (server-authoritative).
        if (
          typeof msg.ability === 'string' &&
          typeof msg.x === 'number' &&
          typeof msg.z === 'number' &&
          Number.isFinite(msg.x) &&
          Number.isFinite(msg.z)
        ) {
          sim.castAbility(msg.ability, pid, { x: msg.x, z: msg.z });
        }
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
      case 'autoloot':
        if (typeof msg.id === 'number') sim.autoLoot(msg.id, pid);
        break;
      case 'harvestCorpse':
        if (typeof msg.id === 'number') {
          const components = Array.isArray(msg.components)
            ? msg.components.filter((c): c is string => typeof c === 'string')
            : undefined;
          sim.harvestCorpse(msg.id, components, pid);
        }
        break;
      case 'set_town_focus':
        if (msg.allocation && typeof msg.allocation === 'object') {
          const allocation: Record<string, number> = {};
          for (const [k, v] of Object.entries(msg.allocation as Record<string, unknown>)) {
            if (typeof v === 'number') allocation[k] = v;
          }
          sim.setTownFocus(allocation, pid);
        }
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
          if (!beforeDone && afterDone) {
            void dailyRewardService
              .recordQuestCompletion(session.accountId, session.characterId, msg.quest)
              .then((points) => {
                if (points > 0) this.sendDailyRewardPointsGained(session, points);
              })
              .catch((err) => console.error('daily reward quest task failed:', err));
            if (msg.quest === ALDRIC_METEOR_QUEST_ID) {
              this.noteAccountQuestComplete(session, msg.quest);
            }
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
        if (typeof msg.item === 'string') {
          // The optional aimed slot (the paperdoll drop target) is accepted only
          // when it names a real equipment key; anything else falls back to the
          // sim's own resolver rather than trusting the client. The sim then
          // re-validates the slot against the item itself.
          const aimed =
            typeof msg.slot === 'string' && (EQUIP_SLOTS as readonly string[]).includes(msg.slot)
              ? (msg.slot as EquipSlot)
              : undefined;
          if (aimed) sim.equipItemToSlot(msg.item, aimed, pid);
          else sim.equipItem(msg.item, pid);
        }
        break;
      case 'inv_move':
        // Manual bag order (a drag between bag cells). Both indices are re-validated
        // inside the sim against the live bag, so a bogus pair is simply refused.
        if (typeof msg.from === 'number' && typeof msg.to === 'number') {
          sim.moveInventoryItem(msg.from, msg.to, pid);
        }
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
      case 'harvest_node':
        if (typeof msg.node === 'string') sim.harvestNode(msg.node, pid);
        break;
      case 'craft_item':
        if (typeof msg.recipe === 'string') sim.craftItem(msg.recipe, pid);
        break;
      case 'sell_all_junk':
        sim.sellAllJunk(pid);
        break;
      case 'equip_bag':
        if (typeof msg.item === 'string') {
          const socket =
            typeof msg.socket === 'number' && Number.isInteger(msg.socket) ? msg.socket : undefined;
          sim.equipBag(msg.item, socket, pid);
        }
        break;
      case 'unequip_bag':
        if (typeof msg.socket === 'number' && Number.isInteger(msg.socket)) {
          sim.unequipBag(msg.socket, pid);
        }
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
      // Season 1 Armory: apply (skin: string) or detach (skin: null + wtype) a
      // purchased weapon skin. Ownership is checked against account cosmetics
      // here; the Sim re-validates the equipped-weapon-type match.
      case 'change_weapon_skin': {
        const skinId = typeof msg.skin === 'string' ? msg.skin : null;
        const wtype = typeof msg.wtype === 'string' ? msg.wtype : undefined;
        if (skinId !== null || wtype) this.changeAccountWeaponSkin(session, skinId, wtype);
        break;
      }
      // Z-key sheathe toggle: cosmetic, no payload; the Sim owns the dead-gate
      // and the combat auto-unsheathe rule.
      case 'stow_weapon':
        sim.toggleWeaponStow(pid);
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
      case 'resurrect_corpse':
        sim.resurrectAtCorpse(pid);
        break;
      case 'resurrect_healer':
        sim.resurrectAtSpiritHealer(pid);
        break;
      case 'challengeResponse':
        if (typeof msg.n === 'string' && typeof msg.r === 'string' && typeof msg.sig === 'string') {
          if (!verifyChallenge(msg.n, msg.r, msg.sig, session.clientSeed)) break;
        }
        break;
      case 'chat': {
        if (typeof msg.text !== 'string') break;
        const text = msg.text.trim();
        if (
          canAttemptModerationCommands(session) &&
          this.moderation.handleChatCommand(session, text)
        )
          break;
        // The player's own ignore/block commands. Deliberately BEFORE isChatMuted
        // and the rate limiter: a GM-silenced player must still be able to manage
        // their own lists, and a list readout must not burn a chat token toward
        // the rate-limit cooldown. Deliberately AFTER the moderation router, so
        // the ADMIN "/mute" is always claimed as the account silence and can
        // never be shadowed by a player command.
        if (this.handleChatFilterCommand(session, text)) break;
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
                gameMetricsCounters().chatMessage();
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
      case 'readyrespond':
        sim.readyCheckRespond(msg.ready === true, pid);
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
      case 'ignore_add':
        if (typeof msg.name === 'string')
          void this.social.ignoreAdd(this.actorFor(session), msg.name).catch(logSocialErr);
        break;
      case 'ignore_remove':
        if (typeof msg.name === 'string')
          void this.social.ignoreRemove(this.actorFor(session), msg.name).catch(logSocialErr);
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
      case 'guild_event_create':
        // Guild calendar booking: title/note are player text, so they flow
        // through the same mute + rate + hard-word gates as chat before the
        // service applies its own officer/date/cap validation.
        if (
          typeof msg.day === 'string' &&
          typeof msg.title === 'string' &&
          typeof msg.note === 'string' &&
          (msg.hour === null || typeof msg.hour === 'number')
        ) {
          if (this.isChatMuted(session)) break;
          if (!this.consumeChatToken(session)) break;
          if (this.enforceChatPolicy(session, `${msg.title}\n${msg.note}`)) break;
          void this.social
            .guildEventCreate(this.actorFor(session), {
              day: msg.day,
              hour: msg.hour === null ? null : msg.hour,
              title: msg.title,
              note: msg.note,
            })
            .catch(logSocialErr);
        }
        break;
      case 'guild_event_remove':
        if (typeof msg.id === 'number')
          void this.social.guildEventRemove(this.actorFor(session), msg.id).catch(logSocialErr);
        break;
      // arena (Ashen Coliseum queue)
      case 'arena_queue': {
        const fmt =
          msg.format === '2v2'
            ? '2v2'
            : msg.format === 'fiesta'
              ? 'fiesta'
              : msg.format === 'yumi3'
                ? 'yumi3'
                : msg.format === 'yumi5'
                  ? 'yumi5'
                  : '1v1';
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

      // The Vale Cup (boarball queue at the Sowfield, docs/prd/vale-cup.md).
      // Deliberately NOT in HEAVY_SELF_CMDS: queueing mutates no heavy self
      // field (queue state rides the throttled 'vcup' delta key + the pid-
      // scoped vcup* events), and the kickoff kit swap happens at match start
      // inside the sim tick, where the wireRev bump already forces the heavy
      // refresh for that session.
      case 'vcup_queue':
        if (isVcBracket(msg.bracket) && isVcNationId(msg.nation) && isSportRole(msg.role))
          sim.vcupQueueJoin(msg.bracket, msg.nation, msg.role, msg.guild === true, pid);
        break;
      case 'vcup_leave':
        sim.vcupQueueLeave(pid);
        break;
      case 'vcup_role':
        if (isSportRole(msg.role)) sim.vcupSetRole(msg.role, pid);
        break;
      case 'vcup_ready':
        sim.vcupReady(pid);
        break;
      case 'vcup_practice':
        // Private instanced practice bout vs bots (parallel to the real match).
        if (isVcBracket(msg.bracket)) sim.vcupPracticeStart(msg.bracket, pid);
        break;
      case 'vcup_bet':
        // Server-authoritative: the Sim re-validates the window, proximity, side,
        // and balance, and debits copper. Amount clamped to a sane integer here.
        if (
          (msg.side === 'A' || msg.side === 'B') &&
          typeof msg.amount === 'number' &&
          Number.isFinite(msg.amount)
        ) {
          sim.vcupBet(msg.side, Math.floor(msg.amount), pid);
        }
        break;

      // Dungeon Finder (docs/prd/dungeon-finder.md). Deliberately NOT in
      // HEAVY_SELF_CMDS: finder state rides its own `df`/`dfb` delta keys, and
      // group formation bumps the party key through the normal snapshot path.
      // Every field is validated here; the Sim re-validates eligibility, roles,
      // capacity, and party state authoritatively.
      case 'df_roles': {
        if (Array.isArray(msg.roles) && msg.roles.length <= 3) {
          const roles = msg.roles.filter(isFinderRole);
          if (roles.length === msg.roles.length) sim.dungeonFinderSetRoles(roles, pid);
        }
        break;
      }
      case 'df_queue': {
        if (Array.isArray(msg.activities) && msg.activities.length <= 16) {
          const activities = msg.activities.filter(
            (a): a is string => typeof a === 'string' && a.length <= 64,
          );
          if (activities.length === msg.activities.length)
            sim.dungeonFinderQueueJoin(activities, pid);
        }
        break;
      }
      case 'df_queue_leave':
        sim.dungeonFinderQueueLeave(pid);
        break;
      case 'df_proposal':
        sim.dungeonFinderRespond(msg.accept === true, pid);
        break;
      case 'df_list_create': {
        if (
          typeof msg.activity === 'string' &&
          msg.activity.length <= 64 &&
          Array.isArray(msg.tags) &&
          msg.tags.length <= 8
        ) {
          const tags = msg.tags.filter(isFinderListingTag);
          if (tags.length === msg.tags.length)
            sim.dungeonFinderListingCreate(msg.activity, tags, pid);
        }
        break;
      }
      case 'df_list_close':
        sim.dungeonFinderListingClose(pid);
        break;
      case 'df_apply':
        if (typeof msg.listing === 'number' && Number.isFinite(msg.listing))
          sim.dungeonFinderApply(msg.listing, pid);
        break;
      case 'df_apply_cancel':
        sim.dungeonFinderApplyCancel(pid);
        break;
      case 'df_app_respond':
        if (typeof msg.applicant === 'number' && Number.isFinite(msg.applicant))
          sim.dungeonFinderApplicationRespond(msg.applicant, msg.accept === true, pid);
        break;

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
      case 'mail_send': {
        if (
          typeof msg.to !== 'string' ||
          typeof msg.subject !== 'string' ||
          typeof msg.body !== 'string' ||
          typeof msg.copper !== 'number' ||
          !Number.isFinite(msg.copper) ||
          !Array.isArray(msg.items) ||
          msg.items.length > 3 // MAIL_MAX_ATTACHMENTS; the Sim re-validates
        )
          break;
        const items: { itemId: string; count: number }[] = [];
        let itemsOk = true;
        for (const raw of msg.items as unknown[]) {
          const slot = raw as { itemId?: unknown; count?: unknown } | null;
          if (
            !slot ||
            typeof slot.itemId !== 'string' ||
            typeof slot.count !== 'number' ||
            !Number.isFinite(slot.count)
          ) {
            itemsOk = false;
            break;
          }
          items.push({ itemId: slot.itemId, count: Math.floor(slot.count) });
        }
        if (!itemsOk) break;
        // Player-written subject/body flow through the same gates as chat
        // (mute, rate limit, hard-word policy); authored system/NPC letters
        // never come this way. The escrow itself resolves inside the Sim.
        if (this.isChatMuted(session)) break;
        if (!this.consumeChatToken(session)) break;
        const subject = msg.subject.slice(0, 64);
        const body = msg.body.slice(0, 600);
        if (this.enforceChatPolicy(session, `${subject}\n${body}`)) break;
        const to = msg.to.trim().slice(0, 32);
        const copper = msg.copper;
        const live = this.sessionByName(to);
        if (live) {
          // A recipient who has blocked (== ignored) the sender never receives
          // their letter. Refuse BEFORE the sim escrow so no copper, postage or
          // items are taken, and reveal nothing more than "no such recipient".
          if (live.blockedIds.has(session.characterId)) {
            this.send(session, {
              t: 'events',
              list: [{ type: 'mailResult', code: 'noRecipient', pid }],
            });
            break;
          }
          sim.mailSendResolved(
            { key: String(live.characterId), name: live.name },
            subject,
            body,
            copper,
            items,
            pid,
          );
          break;
        }
        // Offline recipient: resolve against the character DB (realm-scoped),
        // then book the letter on the loop's turn. Re-check the sender is
        // still this session before touching the sim.
        void this.socialDb
          .findCharacterByName(to)
          .then(async (target) => {
            if (this.clients.get(pid) !== session) return;
            if (!target) {
              // Structured outcome, localized client-side (the sim's mailResult shape).
              this.send(session, {
                t: 'events',
                list: [{ type: 'mailResult', code: 'noRecipient', pid }],
              });
              return;
            }
            // Offline recipient block check (same rule as the online path above):
            // a sender the recipient has blocked is refused before any escrow.
            const blockedBy = await this.socialDb.blockedIds(target.id);
            if (this.clients.get(pid) !== session) return;
            if (blockedBy.includes(session.characterId)) {
              this.send(session, {
                t: 'events',
                list: [{ type: 'mailResult', code: 'noRecipient', pid }],
              });
              return;
            }
            sim.mailSendResolved(
              { key: String(target.id), name: target.name },
              subject,
              body,
              copper,
              items,
              pid,
            );
            session.selfHeavyDirty = true;
          })
          .catch((err) => console.error('mail send resolve failed:', err));
        break;
      }
      case 'mail_take':
        if (typeof msg.id === 'number') sim.mailTake(msg.id, pid);
        break;
      case 'mail_delete':
        if (typeof msg.id === 'number') sim.mailDelete(msg.id, pid);
        break;
      case 'mail_read':
        if (typeof msg.id === 'number') sim.mailMarkRead(msg.id, pid);
        break;
      // Bank: the per-character deposit box. `slot` is a container index (the
      // castAbilityBySlot wire idiom); `count` is optional (omit = whole stack).
      // The Sim owns every gameplay rule (banker proximity, capacity, quest-bind,
      // alive-state, exact-copper cost + purchase cap); `bonusSlots` is never
      // client-supplied. bank_buy_slots is an economy action bounded by the
      // blanket per-frame message limiter plus the Sim's escalating-price cap.
      // The bank_ledger write is OBSERVATIONAL and fire-and-forget: the sim methods
      // return void and emit no success event, so recordBankOp derives success by
      // diffing the bankInfoFor snapshot before and after each call. It is never
      // awaited and never a gameplay dependency; a refused/no-op call diffs empty.
      case 'bank_deposit':
        if (typeof msg.slot === 'number') {
          const before = sim.bankInfoFor(pid);
          sim.bankDeposit(msg.slot, typeof msg.count === 'number' ? msg.count : undefined, pid);
          recordBankOp('deposit', session, before, sim.bankInfoFor(pid));
        }
        break;
      case 'bank_withdraw':
        if (typeof msg.slot === 'number') {
          const before = sim.bankInfoFor(pid);
          sim.bankWithdraw(msg.slot, typeof msg.count === 'number' ? msg.count : undefined, pid);
          recordBankOp('withdraw', session, before, sim.bankInfoFor(pid));
        }
        break;
      case 'bank_buy_slots': {
        const before = sim.bankInfoFor(pid);
        sim.bankBuySlots(pid);
        recordBankOp('buy_slots', session, before, sim.bankInfoFor(pid));
        break;
      }
      // Book of Deeds: select/clear the displayed title. The sim validator
      // owns every rule (deed earned + title reward; null clears; invalid
      // input is a silent no-op); the server only shape-checks the payload.
      case 'deed_set_title':
        if (msg.deedId === null || typeof msg.deedId === 'string') {
          sim.setActiveTitle(msg.deedId, pid);
        }
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
      case 'set_dungeon_difficulty': {
        if (isDungeonDifficulty(msg.difficulty)) sim.setDungeonDifficulty(msg.difficulty, pid);
        break;
      }
      case 'heroic_buy': {
        // Range, stock, balance, and bag space all re-validate in the sim
        // handler (instances/heroic_vendor.ts); the client only sends intent.
        if (typeof msg.itemId === 'string') sim.buyHeroicVendorItem(msg.itemId, pid);
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
      case 'delve_rite_choose': {
        if (msg.intensity !== 'easy' && msg.intensity !== 'medium' && msg.intensity !== 'hard')
          break;
        sim.delveRiteChoose(msg.intensity, pid);
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
    // tickHz rides the head at ~2 Hz, not on every snapshot: it is omitted while
    // the meter warms up (first ~1s, so a fresh server never shows a bogus
    // reading), and between-emissions the client holds the last value. A warmed
    // meter reports a positive rate: a window with zero committed ticks cannot
    // coexist with a firing broadcast (acc accrues every callback), and a fully
    // stalled loop sends nothing. Old clients and warm-up read alike as absent.
    let tickHzJson = '';
    if (this.tickHz != null) {
      const now = this.sim.time;
      if (
        this.lastTickHzHeadTime == null ||
        now - this.lastTickHzHeadTime >= TICK_HZ_HEAD_INTERVAL_S
      ) {
        tickHzJson = `,"tickHz":${round2(this.tickHz)}`;
        this.lastTickHzHeadTime = now;
      }
    }
    const head = `{"t":"snap","tick":${tick},"time":${round2(this.sim.time)}${tickHzJson}`;
    // Guard each session: a throw while building one player's snapshot must not
    // starve every other session of its snapshot this tick (server/CLAUDE.md).
    forEachGuarded(
      this.clients.values(),
      (session) => {
        // no transport while linkdead; the resume path resets sentEnts/lastSent
        // so the fresh socket starts from a full snapshot anyway
        if (session.linkdead) return;
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
        const gridStart = this.perfDetailActive ? process.hrtime.bigint() : 0n;
        this.sim.grid.forEachInRadius(
          anchorEntity.pos.x,
          anchorEntity.pos.z,
          INTEREST_QUERY_RADIUS,
          (e, d2) => {
            if (this.perfDetailActive) this.bcVisits++;
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
        const selfStart = this.perfDetailActive ? process.hrtime.bigint() : 0n;
        if (this.perfDetailActive) this.bcastGridNs += selfStart - gridStart;
        const selfJson = this.selfWireJson(session, anchorEntity, anchorMeta, anchorSession);
        if (this.perfDetailActive) this.bcastSelfNs += process.hrtime.bigint() - selfStart;
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
    const t0 = this.perfDetailActive ? process.hrtime.bigint() : 0n;
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
    if (this.perfDetailActive) {
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
      target: p.targetId,
      auto: p.autoAttack,
      queued: p.queuedOnSwing,
      ap: p.attackPower,
      sp: p.spellPower,
      sh: p.spellHaste,
      crit: p.critChance,
      dodge: p.dodgeChance,
      crat: p.critRating,
      hrat: p.hasteRating,
      hirat: p.hitRating,
      eat: p.eating ? { remaining: round2(p.eating.remaining) } : null,
      drk: p.drinking ? { remaining: round2(p.drinking.remaining) } : null,
      opUntil: p.overpowerUntil > this.sim.time ? 1 : 0,
      ack: session.spectating ? 0 : anchorSession.lastInputSeq,
      ddiff: this.sim.dungeonDifficulty(anchorSession.pid),
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
    // Where the player's corpse lies while their spirit is a ghost (null otherwise).
    // Delta-guarded: ships on death-release and clears on resurrect. The client
    // draws the corpse marker and gates the resurrect-at-corpse button on it.
    maybe('corpse', p.corpsePos);
    maybe('cds', Object.fromEntries([...p.cooldowns.entries()].map(([k, v]) => [k, round2(v)])));
    // Per-player gather-node respawn cooldowns (#1866), same shape/semantics as
    // `cds` above: remaining seconds AS OF THIS TICK, ticking down tick over
    // tick (so `maybe` re-ships it while any node is still cooling down and
    // drops a node's key the tick it clears), matching
    // PlayerMeta.nodeHarvestReadyAt's own "absent means ready" contract (see
    // src/sim/professions/gathering.ts isNodeHarvestableBy). Only entries with
    // remaining time survive the filter, an already-elapsed timer reads as ready.
    maybe(
      'ncd',
      Object.fromEntries(
        Object.entries(meta.nodeHarvestReadyAt)
          .filter(([, until]) => until > this.sim.time)
          .map(([k, until]) => [k, round2(until - this.sim.time)]),
      ),
    );
    maybe('stats', p.stats);
    maybe('weapon', p.weapon);
    maybe('party', this.partyWire(anchorSession.pid));
    maybe('marks', this.markersWire(anchorSession.pid));
    maybe('trade', this.tradeWire(anchorSession.pid));
    maybe('duel', this.duelWire(anchorSession.pid));
    // Small PvP-ledger scalars. Delta-guarded like delve marks: a fresh
    // session receives both, then they ride only on earn/spend changes.
    maybe('honor', meta.honor);
    maybe('lhonor', meta.lifetimeHonor);
    if (this.sim.tickCount - session.lastArenaWireTick >= ARENA_WIRE_INTERVAL_TICKS) {
      session.lastArenaWireTick = this.sim.tickCount;
      maybe('arena', this.sim.arenaInfoFor(anchorSession.pid));
    }
    // Vale Cup readout at its own UI cadence (VC_WIRE_HZ): CupInfo carries
    // whole-second clocks and queue sizes, so re-evaluating every tick would
    // re-serialize the rosters 20 times per wire-visible change. Instant
    // queue/match transitions ride the pid-scoped vcup* events instead.
    if (this.sim.tickCount - session.lastVcupWireTick >= VC_WIRE_INTERVAL_TICKS) {
      session.lastVcupWireTick = this.sim.tickCount;
      maybe('vcup', this.sim.cupInfoFor(anchorSession.pid));
    }
    // Dungeon Finder at its own UI cadence (DF_WIRE_HZ): the personal `df`
    // blob carries whole-second clocks (queue wait, proposal countdown), so
    // re-evaluating every tick would re-serialize it 20 times per visible
    // change. The shared `dfb` board is a separate key so a live countdown
    // never re-sends the listings.
    if (this.sim.tickCount - session.lastDfWireTick >= DF_WIRE_INTERVAL_TICKS) {
      session.lastDfWireTick = this.sim.tickCount;
      maybe('df', this.sim.dungeonFinderInfoFor(anchorSession.pid));
      maybe('dfb', this.sim.dungeonFinderBoardView());
    }
    // market info is null unless the player is standing at the Merchant, so it
    // only rides the wire for players actually browsing the World Market
    maybe('market', this.sim.marketInfoFor(anchorSession.pid));
    maybe('mail', this.sim.mailInfoFor(anchorSession.pid));
    maybe('mailU', this.sim.mailUnreadFor(anchorSession.pid));
    // bank info is null unless the player is standing at a banker, so it only
    // rides the wire for players actually browsing their deposit box (the mail
    // pattern). Not heavy-gated: it appears from proximity, not this session's
    // own dirty-marking commands.
    maybe('bank', this.sim.bankInfoFor(anchorSession.pid));
    // open need-greed rolls this player can still answer, so a client that
    // missed the transient lootRoll event re-shows the prompt from state. Stays
    // per-tick (it's interactive state that appears from others' actions).
    maybe('lroll', this.sim.activeLootRolls(anchorSession.pid));
    // group-visible choices on those rolls (who has answered need/greed/pass),
    // so every party member's roll frame shows the live vote strip and stays up
    // after they answer. Per-tick for the same reason as lroll.
    maybe('lrollg', this.sim.lootRollGroupStatus(anchorSession.pid));
    maybe('drun', this.sim.delveRunWire(anchorSession.pid));
    maybe('dcompanion', this.sim.delveCompanionWire(anchorSession.pid));
    maybe('dmarks', this.sim.delveMarksFor(anchorSession.pid));
    maybe('dcomp', this.sim.companionUpgradesFor(anchorSession.pid));
    maybe('dclears', this.sim.delveClearsFor(anchorSession.pid));
    maybe('delveDaily', this.sim.delveDailyWire(anchorSession.pid));
    // per-player read, so kept per-tick like the other small maps above. Wire
    // key `prof` and IWorld member `professionsState` are the settled names
    // for the professions facet (#1164, src/sim/professions/CLAUDE.md). `gprof`
    // mirrors the raw per-craft proficiency map for the `gatheringProficiency`
    // IWorld data member (#1119), independent of the `professionsState` view.
    maybe('prof', this.sim.professionsStateFor(anchorSession.pid));
    maybe('tfocus', this.sim.townFocusFor(anchorSession.pid));
    // Raw gathering-profession proficiency map (IWorld `gatheringProficiency`,
    // #1119), a second small read alongside `prof` for the ORIGINAL flat-map
    // shape used by the `/dev gather` chat cheat and existing consumers. Wire
    // key `gprof`; see TERSE_TO_IWORLD/ALL_DELTA_KEYS in tests/snapshots.test.ts.
    maybe('gprof', this.sim.gatheringProficiencyFor(anchorSession.pid));
    // Book of Deeds: the Renown total and the selected title id, cheap
    // scalars diffed per tick (grants land from sim sites that never mark
    // this session dirty, and the title echo must not wait on the heavy gate).
    maybe('renown', meta.renown);
    maybe('atitle', meta.activeTitle);
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
      maybe('bags', meta.bags);
      maybe('buyback', meta.vendorBuyback);
      maybe('equip', meta.equipment);
      maybe('cosmetics', anchorSession.accountCosmetics);
      maybe('qlog', [...meta.questLog.values()]);
      maybe('qdone', [...meta.questsDone]);
      maybe('milestones', [...meta.unlockedMilestones]);
      // Book of Deeds: the earned map (deed id -> utcDay) and the COMPLETE
      // lifetime stat block. Maps and Sets do not survive JSON.stringify, so
      // both wire as plain objects/arrays and ClientWorld rebuilds the Map
      // and both Sets on apply. Heavy-gated: deedUnlocked is a
      // HEAVY_SELF_EVENTS member, so an unlock re-diffs on the next snapshot.
      // DELIBERATE freshness floor: a stat bump that crosses no unlock
      // threshold re-wires only on the staggered safety refresh (<=2s), never
      // per increment; flushing per kill would re-serialize every heavy field
      // each combat tick, the exact cost this gate exists to avoid.
      maybe('deeds', Object.fromEntries(meta.deedsEarned));
      maybe('dstats', {
        counters: meta.deedStats.counters,
        itemsDiscovered: [...meta.deedStats.itemsDiscovered],
        visited: [...meta.deedStats.visited],
        dungeonClears: meta.deedStats.dungeonClears,
      });
      // talents/spec/loadouts: the client recomputes its known abilities from this.
      maybe('tal', {
        alloc: meta.talents,
        spec: meta.talentMods.spec,
        role: meta.talentMods.role,
        loadouts: meta.loadouts,
        activeLoadout: meta.activeLoadout,
      });
      // Vale Cup sport-kit flag ({ role } | null): while set, the client's
      // action bar rebuilds the role kit instead of the class kit. Rides the
      // wireRev-gated block because the sim bumps wireRev on BOTH the kickoff
      // swap and the restore, so maybe() serializes each flip, including the
      // restore's EXPLICIT null (delta omission means "unchanged" and would
      // strand the client on the sport kit).
      maybe('sport', meta.sportRole ? { role: meta.sportRole } : null);
    }
    return extra === '' ? json : `${json.slice(0, -1)}${extra}}`;
  }

  // Global party-frame aggregates (aggro holders + incoming heals), scanned once
  // per tick and shared by every partyWire call in that tick.
  private partyFrameGlobals(): {
    aggroTargets: ReturnType<typeof partyFrameAggroTargets>;
    incomingHeals: ReturnType<typeof partyFrameIncomingHeals>;
  } {
    const tick = this.sim.tickCount;
    const cache = this.partyFrameGlobalsCache;
    if (cache && cache.tick === tick) return cache;
    const fresh = {
      tick,
      aggroTargets: partyFrameAggroTargets(this.sim.entities.values()),
      incomingHeals: partyFrameIncomingHeals(this.sim.entities.values(), (abilityId, casterId) =>
        this.sim.resolvedAbility(abilityId, casterId),
      ),
    };
    this.partyFrameGlobalsCache = fresh;
    return fresh;
  }

  private partyWire(pid: number): unknown {
    const party = this.sim.partyOf(pid);
    if (!party) return null;
    const { aggroTargets, incomingHeals } = this.partyFrameGlobals();
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
                absorb: partyFrameAbsorb(e.auras),
                role: partyFrameRole(meta.talentMods.role),
                connected: this.clients.get(mPid)?.linkdead ? 0 : 1,
                hasAggro: aggroTargets.has(mPid) ? 1 : 0,
                incomingHeal: incomingHeals.get(mPid) ?? 0,
                auras: partyFrameAuras(e.auras),
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

  private valeCupRewardCompletion(match: VcMatch): {
    completionId: string;
    completedAtIso: string;
  } {
    const existing = this.valeCupRewardCompletions.get(match);
    if (existing) return existing;
    const completion = {
      completionId: randomUUID(),
      completedAtIso: new Date().toISOString(),
    };
    this.valeCupRewardCompletions.set(match, completion);
    return completion;
  }

  // Scan a tick's events for "significant activity" (max-level ding, rare drop,
  // duel result, arena win) and enqueue a card for the Discord bot to post. The
  // drain endpoint resolves which players are linked and tags them; the queue
  // dedupes so one moment yields one card.
  private detectActivity(events: SimEvent[]): void {
    const now = Date.now();
    // Deed unlocks accumulate per session and record AFTER the loop, behind a
    // durable character save (see below); only the cosmetic broadcast stays
    // inline.
    const deedUnlocks = new Map<ClientSession, string[]>();
    for (const ev of events) {
      if (ev.type === 'deedUnlocked' && ev.pid !== undefined) {
        const s = this.clients.get(ev.pid);
        if (s) {
          // Observer only: mirror the sim's decision into character_deeds
          // (fire-and-forget FIFO; retro re-emits and crash-replays are free
          // under the UNIQUE constraint). Bots have no session, so
          // this.clients.get filters them naturally, and no client message
          // reaches this path: the sim alone emits deedUnlocked.
          const ids = deedUnlocks.get(s);
          if (ids) ids.push(ev.deedId);
          else deedUnlocks.set(s, [ev.deedId]);
          // Marquee unlocks fan out to guildmates and followers; retro
          // unlocks NEVER broadcast (a veteran's first login after rollout
          // must not spam their guild).
          if (ev.retro !== true) this.maybeBroadcastDeedUnlock(s, ev.deedId);
        }
      }
      if (ev.type === 'levelup' && ev.pid !== undefined) {
        const session = this.clients.get(ev.pid);
        if (session) session.metricsMaxLevel = Math.max(session.metricsMaxLevel, ev.level);
      }
      if (ev.type === 'levelup' && ev.level === 5 && ev.pid !== undefined) {
        const s = this.clients.get(ev.pid);
        if (s) {
          void trackReachedLevel5(
            s.characterId,
            {
              clientIp: s.ip,
              clientUserAgent: s.userAgent,
              fbp: s.fbp,
              fbc: s.fbc,
            },
            s.sourceUrl,
          );
        }
      }
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
      } else if (ev.type === 'arenaEnd' && !ev.draw && ev.pid !== undefined) {
        const s = this.clients.get(ev.pid);
        if (!s) continue;
        void dailyRewardService
          .recordArenaResult(s.accountId, {
            won: ev.won,
            format: ev.format,
            ratingBefore: ev.ratingBefore,
            ratingAfter: ev.ratingAfter,
          })
          .then((points) => {
            if (points > 0) this.sendDailyRewardPointsGained(s, points);
          })
          .catch((err) => console.error('daily reward arena task failed:', err));
        if (!ev.won) continue;
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
      } else if (ev.type === 'delveObjectiveComplete' && ev.pid !== undefined) {
        const s = this.clients.get(ev.pid);
        if (!s) continue;
        void dailyRewardService
          .recordDelveClear(s.accountId, s.characterId, ev.delveId, ev.tierId)
          .then((points) => {
            if (points > 0) this.sendDailyRewardPointsGained(s, points);
          })
          .catch((err) => console.error('daily reward delve task failed:', err));
      } else if (ev.type === 'delveChestLoot' && ev.pid !== undefined) {
        const s = this.clients.get(ev.pid);
        if (!s) continue;
        void dailyRewardService
          .recordDelveChestOpen(
            s.accountId,
            s.characterId,
            ev.delveId,
            ev.tierId,
            ev.lootTier,
            ev.bountiful,
          )
          .then((points) => {
            if (points > 0) this.sendDailyRewardPointsGained(s, points);
          })
          .catch((err) => console.error('daily reward delve chest task failed:', err));
      } else if (ev.type === 'vcupResult' && !ev.draw && ev.pid !== undefined) {
        // A decided Vale Cup bout. The match record survives through the
        // 'over' aftermath. Rated wins earn the full task value; bot-filled
        // and practice wins earn the reduced bot-match value. Bots have no
        // session, so this.clients.get filters bot result events naturally.
        const s = this.clients.get(ev.pid);
        if (!s) continue;
        const match = this.sim.vcupMatchOf(ev.pid);
        if (!match) continue;
        const practice = Boolean(match.practice);
        const matchHasBots =
          practice || [...match.rosterA, ...match.rosterB].some((player) => player.bot);
        if (!match.rated && !matchHasBots) continue;
        if (!ev.won) continue;
        const completion = this.valeCupRewardCompletion(match);
        void dailyRewardService
          .recordValeCupResult(s.accountId, {
            won: true,
            bracket: match.bracket,
            matchId: match.id,
            rated: match.rated,
            hasBots: matchHasBots,
            practice,
            completionId: completion.completionId,
            completedAt: new Date(completion.completedAtIso),
          })
          .then((points) => {
            if (points > 0) this.sendDailyRewardPointsGained(s, points);
          })
          .catch((err) => console.error('daily reward vale cup task failed:', err));
        if (!match.rated) continue;
        // One card per decided match: every winner's vcupResult lands on the
        // same tick and the match-id dedupe key collapses them, so the first
        // one enumerates the whole winning side (linked teammates get tagged
        // on the one card, the duel [winner, loser] convention).
        const winnerPids = match.teamA.includes(ev.pid) ? match.teamA : match.teamB;
        const accountIds = [s.accountId];
        const names = [s.name];
        for (const pid of winnerPids) {
          if (pid === ev.pid) continue;
          const ally = this.clients.get(pid);
          if (!ally) continue;
          accountIds.push(ally.accountId);
          names.push(ally.name);
        }
        enqueueActivity(
          {
            kind: 'vale_cup',
            accountIds,
            names,
            realm: REALM,
            profileUrl: this.profileUrlFor(s.name),
            bracket: match.bracket,
            scoreA: match.scoreA,
            scoreB: match.scoreB,
            winnerNation: match.teamA.includes(ev.pid) ? match.nationA : match.nationB,
          },
          `vale_cup:${match.id}`,
          now,
        );
      }
    }
    // Durability ordering: the authoritative blob otherwise persists only on
    // the 30s autosave, so an unlock recorded inline could sit in
    // character_deeds (and on Steam, which chains off the insert) for up to
    // 30s before the Book itself is durable; a hard crash in that window
    // leaves the public record ahead of the source, the one drift direction
    // the join-time reconcile cannot heal (it is insert-only). So the ids are
    // queued on the session and saveCharacter publishes them only AFTER its
    // write lands: a rejected save leaves them pending for the next save
    // attempt (30s autosave, next unlock, or the leave save) instead of
    // publishing a record the source never persisted; if no save ever lands
    // before the process dies, blob and index stay CONSISTENTLY without the
    // deed, and the marquee broadcast (cosmetic, no durability contract)
    // already fired above. One save covers every unlock the tick produced for
    // a session (a retro burst on join is a single blob write);
    // characterSaveQueues plus the recorder's FIFO preserve per-character
    // unlock order.
    for (const [session, deedIds] of deedUnlocks) {
      session.pendingDeedRecords.push(...deedIds);
      void this.saveCharacter(session).catch((err) =>
        console.error(`deed-unlock save failed for ${session.name}:`, err),
      );
    }
  }

  private routeEvents(events: SimEvent[]): void {
    if (events.length === 0 || this.clients.size === 0) return;
    const eventTime = Date.now();
    // Account flair of each chat line's SENDER, resolved once per event (not once
    // per recipient) and read from the sender's SESSION rather than an entity:
    // general/world/lfg chat reaches players far outside the sender's interest
    // scope, where the recipient has no entity record for them. Sparse by design:
    // an ordinary player's chat event is untouched.
    for (const ev of events) {
      if (ev.type !== 'chat') continue;
      const flair = this.chatFlairForPid(ev.fromPid);
      if (flair) ev.flair = flair;
    }
    // ignore list: social invites from blocked senders are resolved once per
    // batch (dropped for every session and declined in the sim), not per
    // receiving session, so spectators of the target never see them either.
    const suppressedInvites = this.suppressBlockedSocialInvites(events);
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
          if (suppressedInvites !== null && suppressedInvites.has(ev)) continue;
          // ignore list: drop chat originating from a character this player has
          // blocked, before it ever reaches their client
          if (
            !session.spectating &&
            ev.type === 'chat' &&
            session.blockedIds.size > 0 &&
            this.isBlockedSender(session, ev.fromPid)
          )
            continue;
          // ignore list: drop PUBLIC chat from an ignored character. Unlike a
          // block this is chat-only, so their whispers and rolls still come through.
          if (
            !session.spectating &&
            ev.type === 'chat' &&
            session.ignoredIds.size > 0 &&
            isIgnorableChannel(ev.channel) &&
            this.isIgnoredSender(session, ev.fromPid)
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

  // Same pid-to-character-id hop as isBlockedSender, against the ignore set.
  private isIgnoredSender(recipient: ClientSession, fromPid: number): boolean {
    if (fromPid === recipient.pid) return false;
    const sender = this.clients.get(fromPid);
    return sender ? recipient.ignoredIds.has(sender.characterId) : false;
  }

  // The player's two chat-filter tiers: ignore (/ignore, /unignore, /ignorelist)
  // and block (/block, /unblock, /blocklist). Returns true when the text was one
  // of them and has been handled, so the caller stops before the chat pipeline
  // treats it as something to broadcast. The ADMIN /mute is a different command
  // entirely and is claimed earlier, by the moderation router.
  private handleChatFilterCommand(session: ClientSession, text: string): boolean {
    const parsed = parseChatFilterCommand(text);
    if (!parsed) return false;
    const actor = this.actorFor(session);

    // The two list commands are reads and stay free: they must work even for a
    // GM-silenced player, and echoing your own list back must never burn a token
    // toward the chat cooldown. The four WRITE commands each cost a chat token:
    // they INSERT/DELETE and then push a full social snapshot, so they are the
    // most expensive thing on the chat path and must not be the one thing on it
    // that is unmetered.
    if (isChatFilterWrite(parsed) && !this.consumeChatToken(session)) return true;

    // An if-chain, NOT a switch: tests/command_schema.test.ts scrapes `case '<x>':`
    // labels out of this region of game.ts to derive the dispatched wire
    // vocabulary, so switching on these kinds would register 'ignore'/'block'/...
    // as phantom wire commands and fail the gate.
    const logErr = (err: unknown) => console.error('ignore/block command failed:', err);
    const kind = parsed.kind;
    if (kind === 'ignoreList') {
      void this.social.ignoreList(actor).catch(logErr);
    } else if (kind === 'blockList') {
      void this.social.blockList(actor).catch(logErr);
    } else if (kind === 'ignore') {
      if (!parsed.name) this.sendChatNotice(session, IGNORE_USAGE);
      else void this.social.ignoreAdd(actor, parsed.name).catch(logErr);
    } else if (kind === 'unignore') {
      if (!parsed.name) this.sendChatNotice(session, IGNORE_USAGE);
      else void this.social.ignoreRemove(actor, parsed.name).catch(logErr);
    } else if (kind === 'block') {
      if (!parsed.name) this.sendChatNotice(session, BLOCK_USAGE);
      else void this.social.blockAdd(actor, parsed.name).catch(logErr);
    } else {
      if (!parsed.name) this.sendChatNotice(session, BLOCK_USAGE);
      else void this.social.blockRemove(actor, parsed.name).catch(logErr);
    }
    return true;
  }

  // ignore list: a party invite, trade request, or duel challenge from a
  // character the target has blocked never reaches the target's client (every
  // path: pinvite/trade_req/duel_req by id, and /invite by name via sim chat).
  // The sim has already recorded a pending invite by the time the event routes,
  // so it is declined on the target's behalf through the same sim call a real
  // decline command dispatches: the pending state clears immediately (an
  // unblocked player can invite right away) and the sender sees only the
  // ordinary declined outcome on the next tick. Trade has no decline command (a
  // real target simply lets the request lapse), so its invite is removed
  // silently, which is exactly what the sender would observe anyway. Returns
  // the events to drop for every session, or null when nothing is suppressed.
  private suppressBlockedSocialInvites(events: SimEvent[]): Set<SimEvent> | null {
    let suppressed: Set<SimEvent> | null = null;
    for (const ev of events) {
      if (ev.type !== 'partyInvite' && ev.type !== 'tradeRequest' && ev.type !== 'duelRequest')
        continue;
      if (ev.pid === undefined) continue;
      const target = this.clients.get(ev.pid);
      if (!target || target.blockedIds.size === 0) continue;
      if (!this.isBlockedSender(target, ev.fromPid)) continue;
      suppressed ??= new Set();
      suppressed.add(ev);
      if (ev.type === 'partyInvite') this.sim.partyDecline(ev.pid);
      else if (ev.type === 'duelRequest') this.sim.duelDecline(ev.pid);
      else this.sim.tradeInvites.delete(ev.pid);
    }
    return suppressed;
  }

  private eventAnchor(ev: SimEvent): { x: number; y: number; z: number } | null {
    let id: number | undefined;
    if ('targetId' in ev && typeof ev.targetId === 'number') id = ev.targetId;
    else if ('entityId' in ev && typeof ev.entityId === 'number') id = ev.entityId;
    if (id !== undefined) return this.sim.entities.get(id)?.pos ?? null;
    // world-coordinate events (spellfxAt: a ground-targeted impact) anchor at
    // their own point so they interest-scope like entity-anchored fx instead
    // of fanning out server-wide (dist2d ignores y)
    if ('x' in ev && 'z' in ev && typeof ev.x === 'number' && typeof ev.z === 'number') {
      return { x: ev.x, y: 0, z: ev.z };
    }
    return null; // chat/log etc: broadcast
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
                gameMetricsCounters().chatMessage();
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
    gameMetricsCounters().chatMessage();
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

  // Fan a non-retro marquee deed unlock out to the earner's online guildmates
  // and followers unless the account opted out (accounts.deed_broadcasts).
  // Fire-and-forget off the loop (the daily-reward observer pattern): the
  // opt-out read and the audience resolution are async DB work the tick never
  // awaits, and a failure logs without touching gameplay. The earner's own
  // toast is client-side from the sim event; no frame is sent to them here.
  private maybeBroadcastDeedUnlock(session: ClientSession, deedId: string): void {
    const def = DEEDS[deedId];
    if (!def || !isMarqueeDeed(def)) return;
    // Hidden deeds are invisible until earned, EXISTENCE included (the
    // deeds_records contract every third-party surface honors): a reward can
    // make one marquee, but the fan-out would hand its id and name to viewers
    // who have not earned their own copy.
    if (isHiddenDeedId(deedId)) return;
    void getDeedBroadcasts(session.accountId)
      .then((enabled) => {
        if (!enabled) return;
        return this.social.broadcastDeedUnlock(
          { characterId: session.characterId, name: session.name },
          deedId,
        );
      })
      .catch((err) => console.error('deed broadcast failed:', err));
  }

  private sendDailyRewardPointsGained(session: ClientSession, points: number): void {
    this.send(session, {
      t: 'events',
      list: [
        {
          type: 'log',
          text: `${Math.max(0, Math.floor(points))} daily rewards points gained.`,
          color: '#ffe27a',
        },
      ],
    });
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
          { type: 'error', text: 'Your block list is still loading. Try /who again in a moment.' },
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
        const ws = session.ws;
        try {
          ws.terminate();
        } catch {
          /* socket already torn down */
        }
        // a stuck reader is a network-quality problem, exactly what the
        // linkdead grace exists for: hold the character and let the client
        // reconnect on a fresh socket (terminate's own close event is a
        // no-op after this; socketClosed is idempotent per socket)
        this.socketClosed(session, ws);
      }
      return;
    }
    gameMetricsCounters().wsMessage('out');
    session.ws.send(payload);
  }
}
