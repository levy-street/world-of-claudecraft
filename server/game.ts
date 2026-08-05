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
import { isStunned } from '../src/sim/combat/cc';
import { damageTakenWithin } from '../src/sim/combat/damage_history';
import { rewindHealAmount } from '../src/sim/combat/rewind';
import { DEEDS } from '../src/sim/content/deeds';
import { isFinderListingTag, isFinderRole } from '../src/sim/content/dungeon_finder';
import { MECH_CHROMAS, mechChromaItemId, mechChromaSkinIndex } from '../src/sim/content/skins';
import { SPORT_ROLES, VALE_CUP_BALL_TEMPLATE_ID, VC_NATION_IDS } from '../src/sim/content/vale_cup';
import { withWeaponSkinApplied } from '../src/sim/content/weapon_skin_rules';
import { isWeaponSkinType, WEAPON_SKINS } from '../src/sim/content/weapon_skins';
import {
  bgOriginAt,
  DELVES,
  DUNGEON_X_THRESHOLD,
  DUNGEONS,
  delveAt,
  dungeonAt,
  ITEMS,
  isBgPos,
  isDelvePos,
  MOBS,
  ZONES,
  zoneAt,
} from '../src/sim/data';
import { devTierIndexForMergedPrs } from '../src/sim/dev_tier';
import { parseRelayCommand } from '../src/sim/discord_relay';
import { specialRoleChatTag } from '../src/sim/discord_roles';
import {
  GUILD_CREATION_FEE_COPPER,
  type GuildBankOpDelta,
  guildBankRungsBought,
} from '../src/sim/guild_bank';
import { itemInstancePayloadsEqual } from '../src/sim/item_instance_merge';
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
import { lootHasGoneFfa } from '../src/sim/loot/loot_ffa';
import { sanitizeMarketQuery } from '../src/sim/market_query';
import { parseMoveInputFrame } from '../src/sim/move_input';
import {
  partyFrameAbsorb,
  partyFrameAggroTargets,
  partyFrameIncomingHeals,
  partyFrameRole,
} from '../src/sim/party_frame_info';
import { effectiveFishingBand } from '../src/sim/professions/fishing';
import { cancelProfessionSessionOnDisplacement } from '../src/sim/professions/session_teardown';
import { restoreToolEffectSlotAction } from '../src/sim/professions/tool_effect_actions';
import type { ToolEffectConfirmMode } from '../src/sim/professions/tools';
import { questProgressForWire } from '../src/sim/quests/interact_object_credit';
import { loadRiftWorldState, serializeRiftWorldState } from '../src/sim/rift/persistence';
import type { CharacterState, PetState, PlayerMeta } from '../src/sim/sim';
import { MAX_CHAT_MESSAGE_LEN, Sim } from '../src/sim/sim';
import { drainBgOutcomes } from '../src/sim/social/battleground_outcomes';
import { RAID_MAX } from '../src/sim/social/party';
import type { VcMatch } from '../src/sim/social/vale_cup';
import {
  parseTalentAllocation,
  parseTalentLoadoutIndex,
  parseTalentOptionId,
  parseTalentRowLevel,
} from '../src/sim/talent_allocation_input';
import { stealthDetectionRadius, threatEntries } from '../src/sim/threat';
import {
  type Aura,
  DT,
  dist2d,
  type Entity,
  emptyMoveInput,
  FISHING_CAST_ID,
  type InvSlot,
  type ItemInstancePayload,
  isDungeonDifficulty,
  isEquipSlot,
  MAX_LEVEL,
  type MobFamily,
  RUN_SPEED,
  type SimEvent,
  type SportRole,
  type UnstuckBlockedReason,
  type VcBracket,
  type VcNationId,
} from '../src/sim/types';
import { isAtSowfield } from '../src/sim/vale_cup_layout';
import { WORLD_SEED } from '../src/sim/world_seed';
import {
  type BankBonusSource,
  type BgLadderEntry,
  COMMAND_NAMES,
  type CommandName,
  type DungeonFinderBoard,
  isOverheadEmoteId,
  STABLE_TIMER_WIRE_VERSION,
  type StableTimerWireVersion,
  type VcSharedCupInfo,
  type VcViewerReadout,
} from '../src/world_api';
import { type ActionBarLayout, sanitizeActionBarLayout } from '../src/world_api/action_bar';
import { recordOnlineSample } from './admin_db';
import { type AdminGuildBankView, adminGuildBankView } from './admin_guild_bank_view';
import { offensiveName } from './auth';
import {
  diffGuildBankOp,
  type GuildBankLedgerOp,
  guildCreateFeeDelta,
  recordBankOp,
  recordGuildBankCounterpartyOrphan,
  recordGuildBankDeltas,
  recordGuildBankEscrowRollback,
} from './bank_ledger';
import { reportBgOutcomes } from './battleground_telemetry';
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
import { RESTORE_ITEM_MAX_COUNT } from './character_professions';
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
  GUILD_BANK_ROW_MAX_BYTES,
  grantAccountMechChroma,
  grantAccountWeaponSkins,
  heartbeatCharacterLeases,
  insertChatLogs,
  loadAccountFlair,
  loadGuildBankRows,
  loadMailState,
  loadMarketState,
  loadRiftState,
  markAccountQuestComplete,
  openPlaySession,
  pool,
  releaseCharacterLease,
  revokeAccountMechChroma,
  saveCharacterAndGuildBankState,
  saveCharacterAndMarketState,
  saveCharacterState,
  saveMailState,
  saveMarketState,
  saveRiftState,
  setAccountWeaponSkinLoadout,
  setCharacterHotbarLayout,
  touchCharacterLogin,
  walletForAccount,
} from './db';
import { getDeedBroadcasts } from './deeds_db';
import {
  deedRecordsIdle,
  discordFeedDeed,
  isHiddenDeedId,
  isMarqueeDeed,
  reconcileCharacterDeeds,
  recordDeedUnlocks,
} from './deeds_records';
import { claimDedupeKey, enqueueActivity, releaseDedupeKey } from './discord_activity';
import { discordFlairForAccount, grantRewardPoints } from './discord_db';
import { enqueueLinkChange } from './discord_link_changes';
import { enqueueRelay } from './discord_relay';
import { formatDuration } from './duration';
import {
  copperFlowSourceForCommand,
  harvestBandForNode,
  harvestTierForNode,
} from './economy_telemetry';
// Imported from the mirror modules DIRECTLY (not the ./steam or ./epic
// barrels), the same way deeds_records imports onDeedRecorded: the barrels
// drag routes.ts (and its load-time requireAccount over the db module) into
// every test that partial-mocks the db, the known overlay-mock breakage class.
// Dual fan-out (D21): Steam and Epic reconcile independently.
import { reconcileOnLogin as reconcileEpicOnLogin } from './epic/mirror';
import { shouldDeliverCombatEventToViewer } from './event_delivery';
import { assembleEventsFrame, serializeEventFragments } from './event_frame';
import { fishingBandLabel, isKoi, isRodFeeRecipe } from './fishing_telemetry';
import { mergedPrsForLogin } from './github_contributors';
import { githubForAccount } from './github_db';
import { forEachGuarded, runGuarded } from './guarded_iter';
import {
  type CounterpartyActor,
  type CounterpartyMovement,
  counterpartyIdle,
  counterpartyMovement,
  counterpartyOrphan,
  counterpartyOrphanEvidence,
  counterpartySnapshot,
  stampCounterpartyDeltas,
} from './guild_bank_counterparty';
import { readGuildBankLog } from './guild_bank_log';
import {
  consumeGuildBankOpToken,
  createGuildBankOpGuard,
  type GuildBankOpGuardState,
} from './guild_bank_op_guard';
import { compactGuildBankOpLog } from './guild_bank_op_log';
import {
  collectGuildBankDeltas,
  // Imported from the module that DEFINES it, never through ./db: every test
  // that partial-mocks the db module would otherwise have to re-export it for
  // the `instanceof` below to resolve at all.
  GuildBankEscrowRefused,
  type GuildBankWriteResult,
  loadGuildBanksIntoSim,
} from './guild_bank_state';
import { gameMetricsCounters, type WsDropCause } from './http/game_signals';
import { buildSharedInterestCandidates } from './interest_candidates';
import { IpBlockList } from './ip_block';
import { loadActiveBlockedIps } from './ip_block_db';
import { keepaliveSweepDelayed } from './keepalive_sweep';
import { LINKDEAD_GRACE_MS, planJoin } from './linkdead';
import {
  consumeListReadToken,
  createListReadGuard,
  type ListReadGuardState,
} from './list_read_guard';
import { type LiveSharedIp, sharedIpsFromLiveSessions } from './live_shared_ips';
import { trackReachedLevel5 } from './meta_capi';
import {
  applyMobScanTick,
  createMobScanTickStats,
  resetMobScanCaptureAccumulators,
} from './mob_scan_tick_stats';
import { parseModerationChatCommand } from './moderation_commands';
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
import {
  classifyMsgLane,
  consumeLaneToken,
  createMsgLanes,
  type MsgLane,
  type MsgLaneState,
} from './msg_lanes';
import {
  consumeInboundFrame,
  createMsgRateBucket,
  MSG_RATE_KICK_REASON,
  MSG_SEQ_GAP_SANITY,
  type MsgRateBucketState,
  tallyDrop,
} from './msg_rate_limit';
import { PartyFrameProjectionCache } from './party_frame_projection';
import { applyBoostKitToPlayer, pbeBoostEnabled } from './pbe_boost';
import { nextRaidResetMs } from './raid_reset';
import { REALM, REALM_PUBLIC_ORIGIN, REALM_RESET_TIME_ZONE } from './realm';
import { createRealmReadoutMemo, realmReadoutJson, realmReadoutObject } from './realm_readout_memo';
import { RiftAssetCoordinator, riftAssetConfigFromEnv } from './rift_assets';
import { RiftUpgradeCoordinator, riftUpgraderConfigFromEnv } from './rift_upgrader';
import { createSerialWriter } from './serial_writer';
import {
  jsonWithField,
  StableAuraWireCache,
  StableSelfTimerWireCache,
} from './snapshot_timer_wire';
import type { GuildRank, Presence, PresenceStatus, SocialActor, SocialTransport } from './social';
import { SocialService } from './social';
import { PgSocialDb } from './social_db';
import { reconcileOnLogin as reconcileSteamOnLogin } from './steam/mirror';
import { TickProfiler } from './tick_profiler';
import { hrtimeToMs, TickRateMeter } from './tick_rate_meter';
import { recordUnstuckEvent } from './unstuck_records';
import { holderInfoForPubkey } from './woc_balance';
import { isBackpressureExceeded } from './ws_backpressure';

const ALDRIC_METEOR_QUEST_ID = 'q_aldrics_fallen_star';
// Interest management: the client renders entities out to 80yd, so new
// entities enter interest just past that, and known entities persist a
// little farther so the boundary doesn't churn create/destroy cycles.
const INTEREST_RADIUS = 90;
// Exported so the idle-mob-tick radius below (and its test) stay pinned to this
// exact number instead of drifting into a second copy.
export const INTEREST_DROP_RADIUS = 100;
// Stationary quest/vendor npcs anchor map markers, so they keep the legacy
// radius; once known they cost a handful of bytes per snapshot anyway.
const NPC_INTEREST_RADIUS = 120;
const NPC_DROP_RADIUS = 130;
// the widest OPEN-WORLD radius any entity kind can be relevant at (the
// battleground band widens past this: BG_MATCH_DROP_RADIUS below)
const INTEREST_QUERY_RADIUS = NPC_DROP_RADIUS;
// Thornhollow Fields: the 100x280 field (diagonal ~297yd) fits inside this
// raised radius, so a fighter's OWN SIDE and the field's furniture stay
// tracked across the whole field. It is deliberately NOT a blanket same-slot
// widening (see bgWideInterestApplies): it applies to
//   (a) SAME-TEAM player pairs of one match, which the M map plots as teammate
//       positions and the party frames read, and
//   (b) the slot's non-player entities (flags, runes, props), which both sides
//       are meant to track.
// An ENEMY player falls back to the open-world radii above, so their position,
// facing, health, resource, cast bar and auras are never SHIPPED past normal
// interest. Hiding enemies is the server's job here, not the client's: fog is
// presentation, and a client that ignores it must learn nothing extra.
// Same-slot only in every arm: slot spacing (BG_SLOT_SPACING in
// src/sim/data.ts) puts cross-slot pairs beyond BG_MATCH_DROP_RADIUS, pinned by
// the cross-slot corner check in tests/battleground_band.test.ts.
export const BG_MATCH_INTEREST_RADIUS = 300;
export const BG_MATCH_DROP_RADIUS = 320;
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
// Queue depth past which the shared market serial writer warns (rate-limited
// to once a minute): the observable form of the accepted dirty-book-autosave
// coupling documented at the writer's declaration.
const MARKET_WRITE_QUEUE_WARN_DEPTH = 16;
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
  'frozenOrbs',
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
  // The Drakelands dragonkin brood pass (src/sim/mob/dragonkin_brood.ts):
  // egg proximity/chain/hatch, whelp upkeep, broodlord counter-stun.
  'dragonkinBrood',
  'engaged',
  'duels',
  'cardDuel',
  'arena',
  'trades',
  'lootRolls',
  'instances',
  'delves',
  'valecup',
  'battleground',
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
  return MOB_ZONE_PHASE_BY_ID.get(zoneAt(mob.pos.x, mob.pos.z).id) ?? MOB_ZONE_PHASE_OTHER;
}

const ARENA_WIRE_HZ = 0.1;
const ARENA_WIRE_INTERVAL_TICKS = Math.max(1, Math.round(1 / (DT * ARENA_WIRE_HZ)));
// Thornhollow Fields `bg` self key: 1 Hz covers the in-match clocks (wave respawn,
// match cap, carrier vulnerability) that tick by whole seconds; queue and match
// transitions force a fresh readout via lastBgWireTick resets (the arena
// staleness fix), and the flag/score events ride the event queue instantly.
const BG_WIRE_HZ = 1;
const BG_WIRE_INTERVAL_TICKS = Math.max(1, Math.round(1 / (DT * BG_WIRE_HZ)));
// Personal battleground events that change the throttled `bg` readout the
// moment they land (found/start/flag plays/result/queue churn).
const BG_WIRE_RESET_EVENTS = new Set([
  'bgQueued',
  'bgUnqueued',
  'bgFound',
  'bgStart',
  'bgFlag',
  'bgKill', // the board tallies moved: refresh them with the feed line
  'bgEnd',
]);
// A respawn is NOT in that set: the sim emits it pid-scoped for the RESPAWNER
// only, while the readout it invalidates (the match-wide `dead` column) is read
// by every member. A per-recipient reset would leave the other nine scoreboards
// showing bodies for up to one BG_WIRE_HZ period, which the offline host, which
// recomputes the view every frame, never does. So a respawn fans out to the
// whole match instead (bgRespawnRefreshPids), the shape the bgKill events
// already have because the sim emits one copy per member.
const BG_RESPAWN_EVENT = 'respawn';
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
  mount?: string;
  nation?: string;
  node?: string;
  npc?: number;
  objectId?: number;
  optionId?: unknown;
  price?: number;
  q?: string;
  quest?: string;
  r?: string;
  rid?: number;
  role?: string;
  roles?: unknown;
  rollId?: number;
  seq?: number;
  sid?: string;
  sig?: string;
  skin?: number;
  slot?: number | string;
  spec?: unknown;
  stat?: string;
  gem?: string;
  t?: string;
  tags?: unknown;
  text?: string;
  tierId?: string;
  x?: number;
  z?: number;
};

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
// Runtime membership for the dispatched command vocabulary (the CommandName
// union as data). The command-lane check consults it so a KNOWN command draws
// its lane token before the switch, while an unknown cmd draws in the default
// arm AFTER its protocol-anomaly observation (R5: lane drops must never mute
// the anomaly channel).
const KNOWN_COMMANDS: ReadonlySet<string> = new Set(COMMAND_NAMES);
// Lane-drop cause labels (R8): the map keeps the counter's cause vocabulary
// closed at the seam's fixed WS_DROP_CAUSES set, never a raw lane string.
const LANE_DROP_CAUSE = {
  movement: 'lane_movement',
  command: 'lane_command',
  chat: 'lane_chat',
} as const satisfies Record<MsgLane, WsDropCause>;
const JAILED_BLOCKED_COMMANDS = new Set<string>([
  'arena_queue',
  'bg_queue',
  'vcup_queue',
  'vcup_ready',
  'vcup_practice',
  'enter_dungeon',
  'enter_crypt',
  'enter_delve',
  'duel_req',
  'duel_accept',
  'unstuck',
  'card_queue_join',
]);
const HEAVY_SELF_CMDS = new Set<string>([
  'equip',
  'inv_move', // rewrites the inventory array order: the self snapshot must resend it
  'unequip_item',
  'salvage_item',
  'rift_upgrade_item',
  'rift_enchant_item',
  'rift_socket_gem',
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
  'selectTalentRow',
  'saveLoadout',
  'switchLoadout',
  'deleteLoadout',
  'change_skin',
  'unequip_mech_chroma',
  'claim_event_skin',
  'mount_toggle',
  'change_weapon_skin',
  'prestige',
  'market_list',
  'market_list_instance',
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
  // Guild bank ops that touch a HEAVY self field: the two item moves rewrite
  // the carried inventory (heavy-gated `inv`). The gold ops and buy_slots are
  // deliberately absent: copper rides the ALWAYS-SENT base self object (not
  // the heavy gate) and the treasury/slots ride the ungated maybe('guildBank')
  // stream, so listing them would only buy a redundant heavy re-serialize.
  'guild_bank_deposit',
  'guild_bank_withdraw',
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
  // The acquisition craft's slot/recharge outcome: a successful slot consumes
  // a charm copy and a successful recharge consumes arcane materials, neither
  // through a loot-event path, so the self inv mirror re-diffs off this event.
  // Deny arms ride along and force the same re-diff for no state change,
  // ACCEPTED as the family's standing shape: enchantResult/unbindResult are
  // members on the same terms, and HEAVY_SELF_CMDS already dirties on receipt
  // regardless of outcome, so a denial-spamming client buys nothing another
  // command does not already offer it.
  'toolEffectResult',
  // Maker's Bond unbind (Professions 2.0): a successful unbind can
  // clear boundTo IN PLACE (the single-copy arm emits no loot event), so the
  // result event itself must re-diff the heavy self keys or the holder's inv
  // mirror goes stale until the staggered refresh. Also refreshes the purse
  // for the fee debit.
  'unbindResult',
  // Apply-enchant, for the same reason as unbindResult above: the WORN arm
  // (src/sim/professions/enchanting.ts resolveApplyEnchantWorn) enchants in
  // place, so it only REMOVES reagents and emits no loot event. Without this the
  // enchant itself would show at once (it rides the `eqi` identity diff, which
  // recalcPlayerStats rebuilds) while the spent reagents lingered in the bag
  // mirror until the staggered refresh, and re-opening the picker could still
  // offer an enchant the player can no longer afford. The bagged arm's loot
  // event already covered it; this makes both arms explicit.
  'enchantResult',
  // Commission order board delivery (issue #1298): the crafter's arm
  // removes the delivered copy directly from PlayerMeta.inventory (no
  // addItem/removeItem call, so no loot event fires on that side), so the
  // result event itself must re-diff the crafter's heavy self keys or their
  // inv mirror goes stale until the staggered refresh. The requester's side
  // already gets a loot event from the ordinary addItemInstance grant.
  'commissionOrderResult',
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
  // The level the characters row currently carries, as of the last save that
  // actually landed. Seeded at join from the loaded blob (joining is not a
  // transition) and compared against the SERIALIZED level after every successful
  // save, so the linked-member change feed learns about a level move exactly once
  // instead of once per 30 s autosave. A GM/PBE join-time setPlayerLevel raises the
  // in-memory level above this seed, so its first save reports the move.
  lastPersistedLevel: number;
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
  // Pre-parse inbound gate state (#978): the frame and byte token buckets
  // plus the windowed abuse score, covering every frame (input, cast, cmd,
  // ...), separate from the chat-only bucket above, so a client flooding
  // non-chat frames is throttled/kicked instead of processed unconditionally.
  msgRate: MsgRateBucketState;
  // Post-parse per-class lanes (movement / command / chat) beside the global
  // bucket above, so one class can never starve another; lane drops tally
  // into msgRate's abuse window (R6).
  msgLanes: MsgLaneState;
  // The ignore/block list-readout bucket (the phase 06 maintainer ruling):
  // the readouts stay chat-token-free per R5 but are per-call DB reads, so
  // refusals above the far-above-human budget drop and tally into the same
  // abuse window.
  listReadGuard: ListReadGuardState;
  // Token bucket for the five guild bank ops (Guild Bank Phase 3 QA): every
  // allowed op is a keep-forever bank_ledger write plus an unflushed-delta
  // log entry, so the rate is capped far above human banking cadence and
  // refusals tally into the shared abuse window like every other shed frame.
  guildBankOpGuard: GuildBankOpGuardState;
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
  // Recipient-negotiated timer representation. Legacy remains the default for
  // old and unknown clients throughout a rolling deploy.
  timerWireVersion: 1 | StableTimerWireVersion;
  timerWireCache: StableSelfTimerWireCache;
  // arena readout is reconciled at UI cadence instead of snapshot cadence
  lastArenaWireTick: number;
  // Thornhollow Fields battleground readout, same idea at its own cadence (BG_WIRE_HZ)
  lastBgWireTick: number;
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
  // Monotonic fence for the sim guild stamps (name + membership). Bumped by
  // every SYNCHRONOUS stamp from a committed membership/rank mutation
  // (onGuildMembershipChanged); sendSocialSnapshot captures it before its DB
  // read and skips its own (possibly staler) stamp when the fence moved, so an
  // in-flight snapshot can never roll the guild bank's officer gate back to a
  // pre-demote rank.
  guildStampSeq: number;
  // Guild books this session dirtied (guild id -> a per-mark seq), awaiting the
  // fenced escrow save (Guild Bank Phase 3). Marked when a dispatched guild
  // bank op's before/after diff is non-empty (and at guild_create's seed);
  // cleared per guild after a SUCCESSFUL save only if the seq is unchanged, so
  // an op landing mid-save keeps the book scheduled for the next save.
  dirtyGuildBanks: Map<number, number>;
  // The UNFLUSHED book deltas behind those dirty marks, in op order (guild id
  // -> the diffGuildBankOp output of every successful op not yet committed by
  // an escrow save). This log is this session's UNCOMMITTED WORK and it is the
  // escrow save's WRITE PAYLOAD: the save persists "durable truth plus these
  // deltas", never the whole shared live book, so one officer's save can never
  // carry another officer's not-yet-durable op into the row. Consumed from the
  // front when a save commits; replayed BACKWARD onto the live book when this
  // session's escrow can never commit again (fence-out, or the leave flush
  // exhausted its retries), leaving every other session's ops intact. Bounded
  // per guild by GUILD_BANK_UNFLUSHED_OP_CAP, which COMPACTS the log
  // (server/guild_bank_op_log.ts) rather than dropping it: dropping the write
  // payload would silently discard committed-intent work.
  unflushedGuildBankOps: Map<number, GuildBankOpDelta[]>;
  // Consecutive escrow REFUSALS per guild. A refusal rolls the whole save back
  // (character half included), so nothing is ever half-committed; the count
  // only bounds how long a session waits for the other officer's commit before
  // it is rolled back and disconnected instead.
  guildBankDeficitSkips: Map<number, number>;
  // Set once this session's book work can never become durable and its live
  // state has therefore been abandoned. A quarantined session persists
  // NOTHING, ever again: its character half is the half that would carry the
  // value its book half could not, so letting it save is the mint the refusal
  // exists to prevent. It is kicked and reloads from its durable row.
  escrowQuarantined: boolean;
  // How many leading log entries per guild an IN-FLIGHT escrow save captured.
  // The post-commit release consumes exactly that many by index, so the cap's
  // compaction must leave that prefix alone while the write is awaited or the
  // splice would eat the wrong entries (persisting work twice, or dropping
  // it). Set when the payload is captured, cleared when the save settles,
  // including on a throw.
  inFlightGuildBankOps: Map<number, number>;
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
  // The character's stored action-bar layout as loaded at join (already
  // bounds-validated), or null when the character has never saved one. Sent to
  // the owning client exactly once via the `hbl` self field (self-scoped: never
  // an entity/broadcast field), then frozen; subsequent client saves persist to
  // the DB and never re-echo here. null wires as an explicit "seed from local".
  initialHotbarLayout: ActionBarLayout | null;
}

interface SentEntityVersions {
  idVer: number;
  dynVer: number;
  // Stable timer-wire recipients diff aura composition separately from the
  // ordinary dynamic record, so a deferred distance-tier update cannot lose an
  // aura change. Legacy recipients leave this at 0.
  auraVer: number;
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
  // Optional secondary aura values: imbue judgement's min/max damage range and
  // Greater Invisibility's reduction/aftereffect duration.
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
  // Next-cast empowerment scope. Omitted for unscoped empowerment auras, which match any
  // eligible cast just like the sim helper.
  emp?: string[];
  // The caster's entity id, so the client's target strip can lead with and enlarge the
  // viewer's OWN dots/hots (auras_view ownFirst). A shared per-entity value (never
  // per-viewer), so the per-entity dyn cache keeps eliding; an old client ignores it and
  // an old server's omission decodes to 0, which matches no player id.
  src?: number;
  // Encounter-owned control marker. Omitted for ordinary auras.
  ub?: 1;
  // No-player-counter-may-shed marker (the recovery sicknesses). Presence only: the
  // client reads it through the same isPlayerRemovableAura predicate the sim uses, so
  // the buff bar never offers a right-click cancel the server would refuse. Omitted for
  // ordinary auras, and an old server's omission decodes to undefined, as before.
  und?: 1;
  // Break-threshold ARMED marker (Lingering Dread's soak-before-snap fear):
  // presence only, never the live soak value - the number decrements per hit
  // and would churn the stable aura cache, while the client (the victim-worn
  // dread band in src/render/ability_vfx) only keys on whether the talent
  // armed the fear at all. Omitted for ordinary auras.
  bt?: 1;
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
  // Active rideable mount ('' omitted). This identity field is intentionally
  // distinct from the self-only persisted pick (`mntSel`): using `mnt` for both
  // made the appended self delta overwrite the live riding state in JSON.
  if (e.mountKey) out.mnt = e.mountKey;
  if (e.mainhandItemId) out.mh = e.mainhandItemId; // equipped mainhand → held weapon model (render-only)
  if (e.offhandItemId) out.oh = e.offhandItemId; // equipped offhand → held weapon model (render-only)
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
    // Per-slot ItemInstancePayloads of the worn set (masterwork/enchant rolls),
    // for the inspect window (Professions 2.0). Same sparse rule as
    // `eq` above: players only, only when at least one worn piece carries a
    // payload, riding the identity record (wireCacheFor diffs the identity
    // JSON, so an equip/unequip of an instanced piece re-emits automatically).
    // Data minimization: only the cosmetic inspect fields (signer, enchant,
    // rolled) leave the server; boundTo, charges, and the bindOnTrade
    // arm are gameplay state no inspecting client needs and never ride this key.
    // The pub allowlist below (signer/enchant/rolled ONLY) is what enforces this,
    // so a new non-cosmetic ItemInstancePayload field is excluded by construction;
    // the owner still sees their own payload in full via the self `inv` mirror.
    let eqi: Record<string, unknown> | undefined;
    for (const [slot, inst] of Object.entries(e.equippedInstances)) {
      if (!inst) continue;
      const pub: Record<string, unknown> = {};
      if (inst.signer !== undefined) pub.signer = inst.signer;
      if (inst.enchant !== undefined) pub.enchant = inst.enchant;
      if (inst.rolled !== undefined) pub.rolled = inst.rolled;
      for (const _ in pub) {
        if (eqi === undefined) eqi = {};
        eqi[slot] = pub;
        break;
      }
    }
    if (eqi) out.eqi = eqi;
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
  if (e.riftTier) out.rt = e.riftTier; // ranked rift portal badge (render-only)
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
  // Optional secondary aura values (imbue range or Greater Invisibility aftereffect);
  // dot/hot cadence; non-physical school. Each rides only when it carries meaning, so
  // ordinary auras stay lean and decode to their defaults.
  if (a.value2 !== undefined) w.value2 = a.value2;
  if (a.value3 !== undefined) w.value3 = a.value3;
  if (a.tickInterval !== undefined) w.tickInterval = a.tickInterval;
  if (a.school !== 'physical') w.school = a.school;
  if (a.stacks && a.stacks > 1) w.stacks = a.stacks;
  // Carry the remaining charges only for a charge-limited aura (Lightning Shield), so the
  // buff icon can badge the count online exactly as offline; undefined for every other aura.
  if (a.charges !== undefined) w.charges = a.charges;
  // Next-cast empowerment scope. Omitted for unscoped empowerment auras, which match any
  // eligible cast just like the sim helper.
  if (a.empowerAbilities !== undefined) w.emp = a.empowerAbilities;
  // The caster's entity id, for the client's own-aura prominence on the target strip
  // (auras_view ownFirst). Omitted for the rare 0/absent source, which decodes to 0.
  if (a.sourceId) w.src = a.sourceId;
  if (a.unbreakableControl) w.ub = 1;
  if (a.undispellable) w.und = 1;
  if (a.breakThreshold !== undefined) w.bt = 1;
  return w;
}

// Dynamic fields are re-sent whole in every full or lite record, so the
// conditional ones keep their absent-means-unset semantics.
function dynamicFields(e: Entity, includeAuras = true): Record<string, unknown> {
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
  if (e.afk) out.ak = 1; // /afk display bit: other clients tag the nameplate + presence dot
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
  // Mount summon/dismount transition, so every client can time the summon FX / call
  // pose and the self-extrapolator can root the local player in lockstep. Volatile
  // (rides the per-tick dynamic fields, not identity): mcr omitted when idle (0), mck
  // omitted while dismounting or idle (''). The sim reads mountCastRemaining (movement
  // root), so it is actionable and always rides when non-zero.
  if (e.mountCastRemaining) out.mcr = round2(e.mountCastRemaining);
  if (e.mountCastKey) out.mck = e.mountCastKey;
  if (e.sitting || e.eating || e.drinking) out.sit = 1;
  if (e.riftSliding) out.sld = 1; // ice-slide: render a frozen gliding pose
  // Ledge climb: quantized progress (1..99), not the arc. The client never
  // re-simulates the pull (the server owns it and streams the resulting
  // positions); it needs to know a climb is running, to stop predicting a
  // fall, and how far through it is so the pull-up pose tracks the motion.
  // Any non-zero value reads as "climbing" on older clients.
  if (e.climb) {
    const t = e.climb.elapsed / e.climb.duration;
    out.cl = Math.max(1, Math.min(99, Math.round(t * 100)));
  }
  if (e.weaponStowed) out.ws = 1; // Z-key sheathe: weapons render on the back
  if (e.aggroTargetId !== null) out.aggro = e.aggroTargetId;
  if (e.forcedTargetId !== null) out.ft = e.forcedTargetId;
  if (e.forcedTargetTimer > 0) out.ftm = round2(e.forcedTargetTimer);
  // A player's/bot's SELECTED target (mobs use aggroTargetId above): rides so the
  // client can render the target-of-target frame for a PLAYER target, exactly as
  // `aggro` already enables it for a mob/pet target. Emitted only for an entity that
  // HAS a target (players/bots in combat), so idle mobs (targetId stays null) add
  // nothing. The SELF record still carries its own precise `target` field.
  if (e.targetId !== null) out.tgt = e.targetId;
  if (e.tappedById !== null) out.tap = e.tappedById;
  // corpse harvest claim (single-use, first-come): the online corpse picker
  // must stop offering a corpse another player already harvested
  if (e.harvestClaimedBy !== null) out.hcb = e.harvestClaimedBy;
  // loot owner-lock lapse (FFA): the online corpse picker must offer a
  // stranger's aged-out corpse again for a deliberate manual loot, the same
  // reliability contract hcb gives harvest claims. Flips once per corpse, so
  // the per-entity dyn cache re-serializes exactly one changed record.
  if (e.kind === 'mob' && e.lootable && lootHasGoneFfa(e.lootFfaTimer)) out.ffa = 1;
  if (e.ownerId !== null) out.own = e.ownerId;
  if (e.overheadEmoteId) {
    out.emo = e.overheadEmoteId;
    out.emoSeq = e.overheadEmoteSeq;
  }
  if (e.ownerId !== null) {
    out.pm = e.petMode;
    out.pt = round2(e.petTauntTimer);
    if (e.petAutoTaunt) out.pa = 1;
    if (e.petAutoWaterJet) out.pw = 1;
  }
  if (e.rangedPower) out.rp = e.rangedPower;
  // top hate-table entries so the party threat meter shows real numbers
  if (e.kind === 'mob' && !e.dead && e.threat.size > 0) out.thr = threatEntries(e, 8);
  if (includeAuras && e.auras.length > 0) {
    out.auras = e.auras.map(wireAura);
  }
  if (e.kind === 'mob' && e.lootable && e.loot) {
    out.lootList = { copper: e.loot.copper, items: e.loot.items };
  }
  return out;
}

export function wireEntity(e: Entity, includeAuras = true): Record<string, unknown> {
  return { id: e.id, ...identityFields(e), ...dynamicFields(e, includeAuras) };
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

// Both endpoints inside the SAME battleground slot: the necessary condition for
// the raised match-wide interest (never across slots, never to the open world).
function inSameBgSlot(a: Entity, b: Entity): boolean {
  if (!isBgPos(a.pos.x) || !isBgPos(b.pos.x)) return false;
  return bgOriginAt(a.pos.z).slot === bgOriginAt(b.pos.z).slot;
}

// The raised battleground interest, narrowed to what the mode actually needs a
// client to hold (see BG_MATCH_INTEREST_RADIUS): a same-slot TEAMMATE, or a
// same-slot non-player entity (flag, rune, prop). `viewerBgTeam` is the pid
// list of the viewer's own team, or null when the viewer is not in a match.
// An enemy player, and anything an enemy owns, returns false and falls back to
// the open-world radii in interestLimitSq.
function bgWideInterestApplies(
  viewer: Entity,
  e: Entity,
  viewerBgTeam: readonly number[] | null,
): boolean {
  if (!inSameBgSlot(viewer, e)) return false;
  // A summoned mob (pet, guardian, totem) inherits its OWNER's arm: an enemy's
  // pet trails the enemy, so widening it would leak the same position by proxy.
  const subjectId = e.kind === 'player' ? e.id : e.ownerId;
  if (subjectId === null) return true; // flags, runes, props, npcs, wild mobs
  return viewerBgTeam !== null && viewerBgTeam.includes(subjectId);
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
interface EntityWireVariantCache {
  tick: number;
  idVer: number;
  dynJson: string;
  dynVer: number;
  auraVer: number;
  builtIdVer: number;
  builtDynVer: number;
  builtAuraVer: number;
  fullJson: string;
  liteJson: string;
  fullAuraJson: string;
  liteAuraJson: string;
}

interface EntityWireCache {
  tick: number;
  idJson: string;
  baseDynJson: string;
  idVer: number;
  baseDynVer: number;
  auraCache: StableAuraWireCache;
  legacy: EntityWireVariantCache;
  stable: EntityWireVariantCache;
}

interface EntityWireView {
  idVer: number;
  dynVer: number;
  auraVer: number;
  fullJson: string;
  liteJson: string;
  fullAuraJson: string;
  liteAuraJson: string;
}

// One session's resolved interest anchor for a broadcast pass: the entity whose
// position seeds the interest scan (self, or the spectated target), plus the
// meta/session the self payload is built from. Resolved once up front so a
// single padded grid query per occupied cell can be shared across every session
// anchored in that cell. sessionId keys the shared candidate lookup and equals
// session.pid (unique per session), so it also satisfies the module's AnchorRef.
interface SnapshotAnchor {
  sessionId: number;
  session: ClientSession;
  anchor: Entity;
  anchorMeta: PlayerMeta;
  anchorSession: ClientSession;
  stableTimerWire: boolean;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

function emptyWireVariant(): EntityWireVariantCache {
  return {
    tick: -1,
    idVer: 0,
    dynJson: '',
    dynVer: 0,
    auraVer: 0,
    builtIdVer: -1,
    builtDynVer: -1,
    builtAuraVer: -1,
    fullJson: '',
    liteJson: '',
    fullAuraJson: '',
    liteAuraJson: '',
  };
}

function fullEntityJson(id: number, idJson: string, dynJson: string): string {
  return `{"id":${id},${idJson.slice(1, -1)},${dynJson.slice(1, -1)}}`;
}

function liteEntityJson(id: number, dynJson: string): string {
  return `{"id":${id},${dynJson.slice(1, -1)}}`;
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

// The creation fee as WHOLE GOLD, computed once for the two refusal emits.
//
// The client matcher splices an INTEGER (src/ui/server_i18n.ts guild.createFee,
// `You need (\\d+) gold to found a guild.`), so a fee that stopped being whole
// gold would emit "1.5" and silently ship raw English to every locale with
// nothing reddening. The requirement is asserted HERE, where the number is
// made, rather than left to a comment: a non-whole fee fails at import (and so
// in every server test) instead of at a player's screen.
const GUILD_CREATION_FEE_GOLD = ((): number => {
  const gold = GUILD_CREATION_FEE_COPPER / 10_000;
  if (!Number.isInteger(gold) || gold <= 0) {
    throw new Error(
      `GUILD_CREATION_FEE_COPPER must be a positive whole number of gold for the guild.createFee matcher, got ${GUILD_CREATION_FEE_COPPER}`,
    );
  }
  return gold;
})();

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
  // Guild creation fees reserved at the guild_create dispatch gate (Guild Bank
  // Phase 3 QA, reserve-at-gate), keyed by character id and consumed by
  // exactly one of: the create's committed success arm (onGuildCreated writes
  // the create_fee ledger row) or the refusal/error arm
  // (refundGuildCreateFee returns the copper). A character can hold at most
  // one reservation; the gate refuses a second guild_create while one is
  // pending, so a pipelined double-create can never double-charge or
  // double-refund.
  private readonly pendingGuildCreateFees = new Map<
    number,
    // `pursePaid` is the SIGNED copper the founder's purse was observed to
    // move across the charge (negative), snapshotted at the gate rather than
    // derived from `amount`, so the create_fee ledger row's two halves are two
    // independent measurements and their balance check can actually fail.
    { accountId: number; amount: number; pursePaid: number }
  >();
  // Guilds whose bank is CLOSED because a guild-delete is in flight: the
  // window between the empty-bank guard passing and the guilds DELETE (which
  // cascades the guild_banks row away) plus its post-commit hooks. Guild bank
  // ops for a guild in this set are refused, so nothing can be deposited into
  // a bank that is about to stop existing (server/social.ts
  // beginGuildBankDelete / endGuildBankDelete). Entries live for the two
  // awaited DB steps of one command and are removed on every arm, including
  // a throw.
  private readonly guildBankDeleteWindows = new Set<number>();
  private readonly moderation: ModerationService<ClientSession>;
  private wireCache = new Map<number, EntityWireCache>();
  // partyFrameAggroTargets / partyFrameIncomingHeals scan the whole entity set and
  // are GLOBAL (identical for every grouped session), yet partyWire runs once for
  // each grouped session. Memoize both for one broadcast so each party does one
  // scan, not one per member. (see review #1864, finding 1)
  private partyFrameGlobalsCache: {
    tick: number;
    aggroTargets: ReturnType<typeof partyFrameAggroTargets>;
    incomingHeals: ReturnType<typeof partyFrameIncomingHeals>;
  } | null = null;
  // Realm-wide Vale Cup readout, built and stringified once per broadcast pass and
  // shared across every viewer (keyed on sim.tickCount inside selfWireJson), the
  // same once-per-tick memo shape as wireCache / partyFrameGlobalsCache.
  private readonly realmReadout = createRealmReadoutMemo<VcSharedCupInfo>();
  // Realm-wide dungeon-finder board (`dfb`), the memo's second tenant: the board
  // is viewer-independent (dungeonFinderBoardView takes no pid), so sessions whose
  // per-session cadence gates open on the same tick share one build + stringify
  // instead of each re-stringifying the same listings. Unlike the Vale Cup memo
  // above there is no realm-global dueness tracker: each session keeps its own
  // lastDfWireTick gate, and the memo only collapses same-tick evaluations.
  private readonly dfBoardReadout = createRealmReadoutMemo<DungeonFinderBoard>();
  // Live Thornhollow Fields online ladder, the memo's third tenant. It rides
  // INSIDE each viewer's own `bg` key (so no shared JSON fragment of its own,
  // hence realmReadoutObject and never realmReadoutJson), but the ROWS are
  // viewer-identical and scanning every online player once per session per
  // BG_WIRE_HZ tick is exactly the uncached viewer-identical read the hot-path
  // rules call a defect. Built once per broadcast pass and handed to every
  // bgInfoFor call in that pass instead.
  private readonly bgLadderReadout = createRealmReadoutMemo<BgLadderEntry[]>();
  // When the realm-wide Vale Cup readout is next due, tracked realm-global (not
  // per session) so every viewer still gates together in one pass and the memo
  // above builds once. `>=` against this, never `tickCount % interval`:
  // broadcastSnapshots runs once per callback OUTSIDE the catch-up loop, so
  // tickCount can stride past an interval multiple under load and a modulo gate
  // would skip the aligned pass. Init a full interval back so the first pass is due.
  private lastVcupWireTick = -VC_WIRE_INTERVAL_TICKS;
  private readonly partyFrameProjectionCache = new PartyFrameProjectionCache();
  private lastWireSweepTick = 0;
  private interval: NodeJS.Timeout | null = null;
  private draining = false;
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
  private readonly characterSaveQueues = new Map<number, Promise<boolean>>();
  // Weapon-skin loadouts are whole-record replacements in their dedicated paid
  // state row. Keep one FIFO per account so rapid apply/detach commands cannot
  // commit on separate pool clients in reverse order and resurrect stale state.
  private readonly weaponSkinLoadoutSaveQueues = new Map<number, Promise<void>>();
  // Action-bar layout is a whole-record replacement in its own character column.
  // One FIFO per character so a burst of debounced client saves cannot commit on
  // separate pool clients in reverse order and persist a stale layout.
  private readonly hotbarLayoutSaveQueues = new Map<number, Promise<void>>();
  // Serializes every write of the single global Market blob (the 30s autosave
  // and the leave-path combined save). Both serialize the whole market; without
  // a queue their transactions could commit out of capture order and persist an
  // older snapshot over a newer one. Snapshots are captured inside the queued
  // thunk, so commit order equals capture order equals freshness order.
  // ACCEPTED (Guild Bank Phase 3 QA, database-performance review): dirty-book
  // character autosaves ALSO ride this one writer (the locked design: the
  // leave flush writes market, mail, AND books in one transaction, so a
  // second queue would reopen the interleaving this writer exists to
  // prevent), which collapses their effective save concurrency to 1 and can
  // queue a leave flush behind an autosave batch. The depth watch below makes
  // that collapse loud; if the warn fires in production, the escalation path
  // is a per-guild serializer for the autosave arm (state.md records it).
  private readonly marketSerialWriter = createSerialWriter();
  private marketWriteQueueDepth = 0;
  private lastMarketQueueWarnMs = 0;
  private readonly enqueueMarketWrite = <T>(write: () => Promise<T>): Promise<T> => {
    this.marketWriteQueueDepth++;
    if (
      this.marketWriteQueueDepth > MARKET_WRITE_QUEUE_WARN_DEPTH &&
      Date.now() - this.lastMarketQueueWarnMs > 60_000
    ) {
      this.lastMarketQueueWarnMs = Date.now();
      console.warn(
        `market serial writer queue depth ${this.marketWriteQueueDepth}: dirty-book autosaves are queueing behind the shared writer; escrow save latency is rising`,
      );
    }
    return this.marketSerialWriter(write).finally(() => {
      this.marketWriteQueueDepth--;
    });
  };
  private readonly enqueueRiftWrite = createSerialWriter();
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
  private bcBaseSerializes = 0;
  private bcLegacySerializes = 0;
  private bcStableSerializes = 0;
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
  private readonly riftUpgrader: RiftUpgradeCoordinator;
  private readonly riftAssets: RiftAssetCoordinator;

  constructor() {
    this.sim = new Sim({
      seed: WORLD_SEED,
      playerClass: 'warrior',
      noPlayer: true,
      devCommands: process.env.ALLOW_DEV_COMMANDS === '1',
      // Thunzharr is up as soon as the realm boots; subsequent rises keep the
      // normal interval cadence (see src/sim/world_boss.ts).
      worldBossAtBoot: true,
      // Ranked rift portals spawn on the live realm (dev/test worlds opt in).
      riftPortals: true,
      // Distance-cull idle-mob AI (issue #2703): shouldSkipIdleMobTick skips a
      // wild, unbuffed, out-of-combat mob's per-tick aggro scan and wander
      // movement while it sits farther than this from EVERY connected player,
      // and it plainly never fires when nobody is connected at all. The world
      // grew from 3 zones to 11 (vite.config.ts) with it, so a realm's total mob
      // count and its per-mob terrain-height cost both grew well past what this
      // knob was originally sized against, and this Sim never opted in: every
      // mob everywhere paid full AI cost on every 50 ms tick regardless of
      // player proximity, which is what turned "nobody online" into a
      // multiples-of-idle CPU baseline as the world grew. INTEREST_DROP_RADIUS
      // is the exact distance a mob remains rendered to a viewer, so a culled
      // mob can never be one a player can actually see sit still, and it is
      // well past MAX_AGGRO_RADIUS (20 yd, mob/aggro_ranges.ts), so culling
      // never skips a scan that could have pulled someone.
      idleMobTickRadius: INTEREST_DROP_RADIUS,
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
    this.riftUpgrader = new RiftUpgradeCoordinator(riftUpgraderConfigFromEnv());
    this.riftAssets = new RiftAssetCoordinator(riftAssetConfigFromEnv());
    this.social = new SocialService(
      this.socialDb,
      this.socialTransport(),
      () => Date.now(),
      // Guild names run the same offensive-name screen as character names.
      (name) => offensiveName(name),
    );
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

  // Cheap admin readout: character ids with a live socket only. Linkdead
  // sessions stay resident for resume semantics but are not shown as online.
  liveCharacterIds(): Set<number> {
    const ids = new Set<number>();
    for (const session of this.sessionsByCharacterId.values()) {
      if (!session.linkdead && session.ws.readyState === 1) ids.add(session.characterId);
    }
    return ids;
  }

  // -------------------------------------------------------------------------
  // Social presence/transport: bridges the persistent SocialService to the
  // live client map + sim. Keyed by character id (stable across sessions),
  // not pid (per-login).
  // -------------------------------------------------------------------------

  private actorFor(session: ClientSession): SocialActor {
    // activeTitle and cls both ride from the LIVE sim meta so the guild/officer
    // relay can stamp the sender's Book of Deeds title and class without
    // SocialService ever touching the sim; a session with no live meta stays
    // untitled and classless.
    const meta = this.sim.meta(session.pid);
    return {
      characterId: session.characterId,
      name: session.name,
      activeTitle: meta?.activeTitle ?? null,
      cls: meta?.cls,
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
      cancelProfessionSessionOnDisplacement(this.sim.ctx, moderatorEntity);
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
    moderator.lastDfWireTick = -DF_WIRE_INTERVAL_TICKS;
    moderator.sentEnts.clear();
    // force the heavy self block (tal/inv/equip/bags/...) to re-run next
    // snapshot: it is gated on meta.wireRev vs session.lastWireRev, and that
    // comparison is keyed to whichever entity's meta is being wired, so
    // without this the target's heavy fields can silently fail to resend.
    moderator.selfHeavyDirty = true;
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
      cancelProfessionSessionOnDisplacement(this.sim.ctx, moderatorEntity);
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
    moderator.lastDfWireTick = -DF_WIRE_INTERVAL_TICKS;
    moderator.sentEnts.clear();
    // same as enterSpectate: force the heavy self block to re-run so the
    // moderator's OWN talents/inventory/equip/etc. resend immediately
    // instead of staying stuck on the spectated target's last-sent values.
    moderator.selfHeavyDirty = true;
    this.send(moderator, { t: 'spectate', name: null });
    if (announce) this.sendSystemNotice(moderator, 'Stopped spectating.');
  }

  private teleportSessionEntity(session: ClientSession, pos: { x: number; z: number }): void {
    const entity = this.sim.entities.get(session.pid);
    if (!entity) return;
    // Server-side teleports bypass the sim's own paths, so the shared
    // displacement teardown runs here too: a jailed or moderated angler's
    // live session never travels with them.
    cancelProfessionSessionOnDisplacement(this.sim.ctx, entity);
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
    // A live arena/fiesta match resolves as a desertion too: leaving the
    // arenaMatches entry behind silently gated releaseSpirit for the rest of
    // the mode's duration (and let the arena timeout teleport a prisoner).
    this.sim.arenaResolveDesertion(target.pid);
    this.sim.vcupQueueLeave(target.pid);
    this.sim.vcupResolveDesertion(target.pid);
    this.sim.leaveCardMinigameEntirely(target.pid);
    // Thornhollow Fields: leave the queue and desert any live match (the deserter takes
    // the rating loss; the team fights on) so the jail sweep never fights the
    // battleground for control of the prisoner's entity.
    this.sim.bgQueueLeave(target.pid);
    this.sim.bgResolveDesertion(target.pid);
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
    // AFK is the lowest-priority active state: a dead/instanced/in-combat player
    // reports that first, but an idle /afk player shows 'afk' over plain 'online'.
    else if (this.sim.meta(session.pid)?.away?.mode === 'afk') status = 'afk';
    // The Sowfield is overworld ground (no instance band, no status change),
    // but the stadium is the presence players expect on match days: fighters
    // and walk-up spectators inside the footprint report the venue, not the
    // vale. English at the source like the dungeon/delve names above; the
    // client re-localizes the label (src/ui/server_i18n.ts localizeZone).
    const zone =
      instanceZone ?? (isAtSowfield(pos.x, pos.z) ? 'The Sowfield' : zoneAt(pos.x, pos.z).name);
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
      onGuildRenamed: (id, guildId, oldName, newName) => {
        const s = this.sessionByCharacterId(id);
        if (!s) return;
        // Vale Cup banner/credit identity moves before the live entity stamp;
        // this is a rename, never a leave/rejoin or a deed transition.
        this.sim.renamePlayerGuild(s.pid, oldName, newName);
        this.send(s, {
          t: 'events',
          list: [{ type: 'guildRenamed', guildId, newName }],
        });
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
      // The ONE combined guild stamp entry point (Guild Bank Phase 2): every
      // committed membership/rank mutation lands here SYNCHRONOUSLY from its
      // SocialService call site, pairing the nameplate name stamp
      // (setPlayerGuild) with the session-only membership stamp
      // (setPlayerGuildMembership) so the two can never diverge. The seq bump
      // fences the async snapshot chokepoint (sendSocialSnapshot): a snapshot
      // whose DB read STARTED before this commit must never re-apply its stale
      // rank over this fresher stamp, because the guild bank's officer gate
      // reads it (a stale officer stamp is privilege-escalation-shaped).
      onGuildMembershipChanged: (id, membership) => {
        const s = this.sessionByCharacterId(id);
        if (!s) return; // offline: nothing live to stamp; the join path covers them
        s.guildStampSeq++;
        this.sim.setPlayerGuild(s.pid, membership?.guildName ?? '');
        this.sim.setPlayerGuildMembership(
          s.pid,
          membership ? { guildId: membership.guildId, rank: membership.rank } : null,
        );
      },
      // Guild Bank Phase 3: the create commit's book seed + creation fee.
      onGuildCreated: (id, guildId) => {
        // Seed the empty book into the LIVE sim in the same success arm that
        // stamped the founder: ops never lazily create a book (loadGuildBank
        // is load-once; a lazy book would shadow the persisted row after a
        // restart), so without this seed the founder's bank would be silently
        // inert until a realm restart boot-loads it.
        this.sim.loadGuildBank(guildId, null);
        // RESERVE-AT-GATE (Phase 3 QA, revising create-then-charge): the fee
        // was already deducted synchronously at the guild_create dispatch
        // gate, so this success arm only consumes the pending reservation:
        // it writes the create_fee ledger row and schedules the escrow save.
        // A founder who vanished mid-flight already paid at the gate (their
        // leave flush persists the charged purse), so the fee can no longer
        // be dodged by logging out before the commit.
        const fee = this.pendingGuildCreateFees.get(id);
        this.pendingGuildCreateFees.delete(id);
        const s = this.sessionByCharacterId(id);
        if (!s) {
          // Offline founder: the charge was applied at the gate and their leave
          // flush is what persists the charged purse, so there is no live
          // session to ride and nothing here can verify it either way. The row
          // is written on the same terms it always was.
          if (fee && fee.amount > 0) {
            recordGuildBankDeltas(
              'create_fee',
              { characterId: id, accountId: fee.accountId },
              guildId,
              [guildCreateFeeDelta(fee.amount, fee.pursePaid)],
            );
          }
          return;
        }
        // Persist the charged purse and the seeded (empty) book together
        // through the fenced escrow save, and only call the fee PAID once that
        // write is durable (see persistGuildCreateFee).
        void this.persistGuildCreateFee(s, guildId, fee ?? null);
      },
      // Disband committed (the empty-bank guard passed): evict the book so the
      // map stays bounded and a re-created guild id can never inherit a stale
      // book. The guild_banks row cascaded away with the guilds DELETE. Every
      // session's pending dirty mark (and unflushed-op log) for the guild
      // clears too: with the book evicted the null-serialize skip already
      // keeps saves from writing it, but a cleared mark also stops
      // re-serialization attempts against a guild id whose row no longer
      // exists. (With the fail-closed holdings read below, a disband can no
      // longer commit while any session holds a mark, so this loop is
      // belt-and-suspenders.)
      onGuildDisbanded: (guildId) => {
        this.sim.evictGuildBank(guildId);
        for (const s of this.sessionsByCharacterId.values()) {
          s.dirtyGuildBanks.delete(guildId);
          s.unflushedGuildBankOps.delete(guildId);
          s.guildBankDeficitSkips.delete(guildId);
        }
      },
      // The disband guard's read, and the OPEN of the guild-delete window it
      // has to hold. Returns the LIVE sim book's holdings, or null (the guard
      // fails closed) when:
      //  - no book is loaded, so nothing can prove the DB row is empty;
      //  - ANY session holds an unflushed dirty mark for the guild, because
      //    the live book proves only live state and a disband would
      //    cascade-delete the DURABLE row while the ops that emptied it are
      //    not yet durable (scanned over sessionsByCharacterId, not clients:
      //    a mid-leave session's flush is still in flight);
      //  - another guild-delete already holds the window.
      // Taking the window is what closes the TOCTOU: the guard is
      // synchronous, but two awaits and a DELETE follow it, and dispatched
      // guild bank ops run straight off the socket event. While the window is
      // held runGuildBankOp refuses every op for this guild, so nothing can
      // land in the bank between the guard passing and the row cascading
      // away. Self-heals within one autosave interval; the guard's refusal
      // line already tells the actor to retry.
      beginGuildBankDelete: (guildId) => {
        if (this.guildBankDeleteWindows.has(guildId)) return null;
        for (const s of this.sessionsByCharacterId.values()) {
          if (s.dirtyGuildBanks.has(guildId)) return null;
        }
        const holdings = this.sim.guildBankHoldings(guildId);
        if (!holdings) return null;
        this.guildBankDeleteWindows.add(guildId);
        return holdings;
      },
      endGuildBankDelete: (guildId) => {
        this.guildBankDeleteWindows.delete(guildId);
      },
      isBlocking: (recipientId, senderCharacterId) => {
        const s = this.sessionByCharacterId(recipientId);
        return s ? s.blockedIds.has(senderCharacterId) : false;
      },
      // Offline characters have nothing loaded and no live presence to leak,
      // so they report loaded (true); an online session reports its own
      // blockListLoaded flag, set once initSocial's DB read resolves.
      blockListLoaded: (characterId) => {
        const s = this.sessionByCharacterId(characterId);
        return s ? s.blockListLoaded : true;
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
      // Capture the stamp fence BEFORE the DB read: if a synchronous
      // membership stamp (onGuildMembershipChanged) lands while the snapshot
      // is in flight, this read may be staler than the live stamps and must
      // not overwrite them below.
      const seqBefore = session.guildStampSeq;
      const snap = await this.social.snapshot(charId);
      this.send(session, { t: 'social', ...snap });
      // Stamp the guild name onto the player's world entity so it rides the
      // identity wire and shows under their nameplate for everyone nearby,
      // PAIRED with the session-only membership stamp the guild bank's
      // officer-plus gate reads (the two must never diverge). This chokepoint
      // is hit on join and on every membership change; committed mutations
      // ALSO stamp synchronously at their SocialService call sites, and the
      // fence check keeps this async arm from rolling one of those back.
      // On the FIRST join-time stamp (firstJoin), a pre-existing guild arrives a
      // beat after addPlayer's retro pass (the name lives in the social DB, not
      // the blob), so retroDeeds re-credits soc_guild_joined silently instead of
      // firing the live banner for an existing member; later changes are genuine
      // live joins and pass firstJoin false.
      if (session.guildStampSeq === seqBefore) {
        this.sim.setPlayerGuild(session.pid, snap.guild?.name ?? '', { retroDeeds: firstJoin });
        this.sim.setPlayerGuildMembership(
          session.pid,
          snap.guild ? { guildId: snap.guild.id, rank: snap.guild.rank } : null,
        );
      }
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
        // A friend/guild edge on the OTHER side survives a block (blockAdd only
        // cleans the blocker's own outgoing friend edge, never guild
        // membership), so this tracked id can stay in socialTrackedIds long
        // after a block either way. Refuse to leak live position across it,
        // the same bidirectional rule canShowInWho already applies to /who.
        if (!this.canShowInWho(session, other)) continue;
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
          this.bcBaseSerializes = 0;
          this.bcLegacySerializes = 0;
          this.bcStableSerializes = 0;
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
            this.riftUpgrader.drain(this.sim.ctx);
            this.riftAssets.drain(this.sim.ctx);
            if (this.perfDetailActive) this.simLapMark = process.hrtime.bigint();
            const events = this.sim.tick();
            this.riftUpgrader.observe(this.sim.ctx);
            this.riftAssets.observe(this.sim.ctx);
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
            this.recordBattlegroundOutcomes();
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
      void this.saveRifts();
      void heartbeatCharacterLeases().catch((err) => console.error('lease heartbeat failed:', err));
    }
  }

  /**
   * Drain this tick's resolved rated Thornhollow Fields matches onto the
   * /metrics counters (server/battleground_telemetry.ts).
   *
   * Off the sim's own drained record rather than the `bgEnd` events, and that is
   * the load-bearing choice: `bgEnd` is PERSONAL (one copy per fighter), so a
   * counter driven from the event stream would book every match ten times and
   * quietly overstate every rate built on it. The sim writes exactly one record
   * per resolve, and only for a rated match.
   */
  private recordBattlegroundOutcomes(): void {
    reportBgOutcomes(drainBgOutcomes(this.sim.bgOutcomes), gameMetricsCounters());
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

  /**
   * Freeze inbound gameplay before the shutdown snapshot and terminally record
   * every accepted recovery attempt while its session identity is still live.
   * Synchronous flagging and cancellation make repeated calls idempotent and
   * leave no window for a buffered /unstuck command to start after the sweep.
   */
  beginShutdown(): number {
    this.draining = true;
    let cancelled = 0;
    for (const session of this.clients.values()) {
      if (this.cancelAndRecordUnstuck(session)) cancelled++;
    }
    return cancelled;
  }

  // Grant playtime reward points to each online account that has been ACTIVE (gave
  // input recently), so points reflect real engagement rather than idling. Lifetime
  // points are monotonic, so this also nudges the Discord status tier over time.
  private async grantPlaytimePoints(): Promise<void> {
    const windowSecs = PLAYTIME_GRANT_MS / 1000;
    for (const session of this.clients.values()) {
      // A linkdead session is held in this.clients for the whole disconnect grace,
      // and the activity window (windowSecs) equals LINKDEAD_GRACE_MS exactly (both
      // 5 minutes), so without this guard a player who gave input any time in the 5
      // minutes before the socket dropped keeps passing the idle check for the
      // entire grace and banks a durable grant while offline. Guarding here rather
      // than rewinding lastInputAt on drop: resumeSession resets it to sim.time on
      // resume, and other consumers (idle sweep, daily activity) read it too.
      if (session.linkdead) continue; // disconnected: no playtime credit during grace
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
        : zoneAt(e.pos.x, e.pos.z).name
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

  private enqueueHotbarLayoutSave(characterId: number, layout: ActionBarLayout): void {
    const previous = this.hotbarLayoutSaveQueues.get(characterId);
    const run = (previous ? previous.catch(() => {}) : Promise.resolve()).then(async () => {
      await setCharacterHotbarLayout(characterId, layout);
    });
    this.hotbarLayoutSaveQueues.set(characterId, run);
    const cleanup = (): void => {
      if (this.hotbarLayoutSaveQueues.get(characterId) === run) {
        this.hotbarLayoutSaveQueues.delete(characterId);
      }
    };
    void run.then(cleanup, (err) => {
      console.error('failed to save hotbar layout:', err);
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
        timerWireVersion?: 1 | StableTimerWireVersion;
        // Server-recomputed bank bonus slots (ws_auth.ts, fresh-join arm) stamped into
        // the character state via addPlayer. Absent on a resume and for callers that
        // pass no meta (tests, the bot-detector overlay), which keep the saved value.
        bankBonus?: { bonusSlots: number; sources: BankBonusSource[] };
        // The character's stored action-bar layout (characters.hotbar_layout),
        // passed through from the join handler's DB read. Untrusted at rest, so
        // it is re-validated here before it reaches the client.
        hotbarLayout?: ActionBarLayout | null;
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
    // PBE only (PBE_BOOST_ACCOUNTS=1): top the character up to the current
    // boost kit once per BOOST_KIT_VERSION (true-BiS gear for every spec, BiS
    // bags, riding, attunement), so a roster created before the boost existed,
    // or before a kit revision, re-kits at its next login. The stamp rides the
    // character state and persists through the normal save path. Never
    // allowed to fail the join.
    if (pbeBoostEnabled()) {
      try {
        if (applyBoostKitToPlayer(this.sim, pid)) {
          console.log(`pbe boost kit topped up: ${name} (character ${characterId})`);
        }
      } catch (err) {
        console.error('pbe boost kit top-up failed:', err);
      }
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
      // The PERSISTED level, not initialLevel: a GM or PBE join-time level raise has
      // already moved the entity but not the row, so seeding from the loaded blob
      // lets the first save report that move to the change feed.
      lastPersistedLevel: state?.level ?? 1,
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
      msgLanes: createMsgLanes(Date.now() / 1000),
      listReadGuard: createListReadGuard(Date.now() / 1000),
      guildBankOpGuard: createGuildBankOpGuard(Date.now() / 1000),
      chatMutedUntil: meta.mutedUntil ? new Date(meta.mutedUntil).getTime() : null,
      chatMuteReason: meta.reason ?? '',
      chatStrikes: meta.chatStrikes ?? 0,
      blockedIds: new Set(),
      blockListLoaded: false,
      guildStampSeq: 0,
      dirtyGuildBanks: new Map(),
      unflushedGuildBankOps: new Map(),
      guildBankDeficitSkips: new Map(),
      escrowQuarantined: false,
      inFlightGuildBankOps: new Map(),
      ignoredIds: new Set(),
      lastWhisperFrom: null,
      rememberedChat: { channel: 'say' },
      lastInputSeq: 0,
      lastInputAt: this.sim.time,
      lastSent: {},
      timerWireVersion:
        meta.timerWireVersion === STABLE_TIMER_WIRE_VERSION ? STABLE_TIMER_WIRE_VERSION : 1,
      timerWireCache: new StableSelfTimerWireCache(),
      lastArenaWireTick: -ARENA_WIRE_INTERVAL_TICKS,
      lastBgWireTick: -BG_WIRE_INTERVAL_TICKS,
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
      // Re-validate the stored layout (untrusted at rest) before it can wire out.
      initialHotbarLayout: sanitizeActionBarLayout(meta.hotbarLayout),
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
    // onDeedRecorded, so it never drives storefront mirrors; each storefront's
    // own login catch-up is reconcileOnLogin below). Fire-and-forget: it never
    // blocks or reorders the join, and resumes skip it (they return above
    // without reloading state).
    reconcileCharacterDeeds({ characterId, accountId }, [
      ...(this.sim.meta(pid)?.deedsEarned.keys() ?? []),
    ]);
    // Storefront mirror drift heal (the steady-state counterpart to the
    // link-time reconcile): a live achievement push can exhaust its retry
    // ladder and drop, and an already-linked account never re-links, so the
    // login reconcile is the only path that replays it. Chained BEHIND the
    // deeds records FIFO rather than run beside it: each reconcileOnLogin
    // stamps a 6h TTL then reads earnedDeedIds, so if it ran before the
    // reconcile above healed a dropped character_deeds row it would miss that
    // id and the TTL would throttle the retry for 6h. Awaiting the tail first
    // guarantees its read observes the healed rows. deedRecordsIdle is NOT
    // awaited on the join path (join latency is unchanged); the continuation
    // is fire-and-forget, fully guarded, per-account throttled, and a no-op
    // unless each storefront's flag is on and the account is linked. Steam and
    // Epic run independently (D21): one outage must not block the other.
    void deedRecordsIdle()
      .then(() => {
        reconcileSteamOnLogin(accountId);
        reconcileEpicOnLogin(accountId);
      })
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
    // Re-validate the freshly-read layout (untrusted at rest), same as a fresh
    // join. Without this, a mid-session save that already landed durably would
    // be clobbered by the stale join-time snapshot once lastSent resets below
    // forces a resend. Only refresh when the caller actually supplies a layout:
    // ws_auth.ts always does on the real reconnect path, but an in-process/test
    // caller that omits it (meta = {}) must keep the session's saved value
    // rather than being reset to null, matching the sibling bankBonus
    // "absent means keep" pattern above.
    if (meta.hotbarLayout !== undefined) {
      session.initialHotbarLayout = sanitizeActionBarLayout(meta.hotbarLayout);
    }
    session.lastInputSeq = 0;
    session.lastInputAt = this.sim.time;
    session.lastSent = {};
    session.timerWireVersion =
      meta.timerWireVersion === STABLE_TIMER_WIRE_VERSION ? STABLE_TIMER_WIRE_VERSION : 1;
    session.timerWireCache = new StableSelfTimerWireCache();
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
  //
  // withMarket (default true) chooses whether the safety flush below also
  // writes the realm-global World Market and mail escrow. The one caller that
  // passes false is the mid-handshake death re-check in server/ws_auth.ts: that
  // session processed zero input (game.join returns synchronously and the
  // re-check runs before any message handling), so it cannot have touched the
  // realm-global market or mail escrow, and those halves would write nothing
  // new. It matters because that death happens exactly when the pool is
  // exhausted: one whole-realm market+mail transaction per dead handshake, all
  // serialized on the process-global market queue, feeds back into the resource
  // that caused the death. Every ordinary dropped socket keeps the default.
  socketClosed(
    session: ClientSession,
    ws: WebSocket,
    opts: { withMarket?: boolean } = {},
  ): boolean {
    // A late close/error from a socket that a resume already replaced must
    // not tear down the live session riding the new socket.
    if (session.ws !== ws) return false;
    if (session.left || session.linkdead || !this.clients.has(session.pid)) return false;
    if (session.spectating) this.exitSpectate(session, false);
    if (session.jailVisit) this.exitJailVisit(session, false);
    this.cancelAndRecordUnstuck(session);
    session.linkdead = true;
    session.graceUntil = Date.now() + LINKDEAD_GRACE_MS;
    this.botDetector.setTrackingConnection(session.botTrackingContext, false);
    // Stop any held movement now; the sim keeps ticking this entity (it can
    // still be attacked, healed, or die while linkdead, like any player).
    const meta = this.sim.meta(session.pid);
    if (meta) Object.assign(meta.moveInput, emptyMoveInput());
    // Safety flush so a process crash during the grace window loses nothing.
    void this.saveCharacter(session, { withMarket: opts.withMarket ?? true }).catch((err) =>
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
    this.cancelAndRecordUnstuck(session);
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
    // Card Duel: drop the queue slot and forfeit any live match on disconnect,
    // same idempotent-before-persistence shape as the two lines above.
    this.sim.leaveCardMinigameEntirely(session.pid);
    // Thornhollow Fields desertion also resolves before the leave save so the leaver's
    // recorded loss and rating delta are in the persisted state (idempotent;
    // removePlayer repeats it harmlessly).
    this.sim.bgResolveDesertion(session.pid);
    // Freeze reward eligibility and reconcile pending loot before the leave
    // snapshot. saveCharacterOnLeave awaits the database; without this
    // synchronous prefix, a roll or boss death can mutate the character after
    // serialization and removePlayer then discards that unsaved reward.
    this.sim.preparePlayerLeave(session.pid);
    await this.saveCharacterOnLeave(session);
    // Whatever book work this session still holds can never commit now: it has
    // no save left. Undo the part whose character half never landed, and
    // record the part whose character half did (an escrow deficit that ran out
    // of saves to retry on). The exhausted-retry arm inside saveCharacterOnLeave
    // already cleared its own marks, so this is a no-op there.
    if (session.dirtyGuildBanks.size > 0) {
      this.revertOwnGuildBookOps(session, [...session.dirtyGuildBanks.keys()]);
    }
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
        await this.saveCharacter(session, { withMarket: true, final: true });
        return;
      } catch (err) {
        if (attempt === LEAVE_SAVE_MAX_ATTEMPTS) {
          console.error(`save on leave failed after ${attempt} attempts for ${session.name}:`, err);
          // This session will never save again, so any guild books it
          // dirtied are permanently unflushable: the live book is ahead of
          // durable truth with no session left to converge it, and the
          // disband guard (which scans session marks) loses sight of it the
          // moment this session tears down. Reconcile now, exactly like the
          // fence-out arm (Guild Bank Phase 3 QA).
          if (session.dirtyGuildBanks.size > 0) {
            this.revertOwnGuildBookOps(session, [...session.dirtyGuildBanks.keys()]);
          }
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

  // Resolves false when the blob DID NOT PERSIST, which is now three shapes:
  // the lease-fenced write matched no row (a same-account takeover rotated the
  // nonce, the original meaning), the escrow refused a book half so the whole
  // transaction rolled back, and this session is quarantined so it may never
  // save again. True means "did not fence out and was not refused", not
  // "landed": the no-state arm (pid already gone from the sim, unreachable
  // from the restore paths which hold a live session) is a silent no-op
  // that resolves true. Callers that must know their write was not fenced
  // (the audited GM restores) read it; every legacy void caller ignores it.
  async saveCharacter(
    session: ClientSession,
    opts: { withMarket?: boolean; final?: boolean } = {},
  ): Promise<boolean> {
    // A quarantined session's live state was abandoned when its escrow was
    // rolled back: its character half is the half that would carry the value
    // its book half could not, so persisting it is exactly the mint the
    // refusal prevented. It reloads from its durable row instead.
    if (session.escrowQuarantined) return false;
    const previous = this.characterSaveQueues.get(session.characterId);
    const run = (previous ? previous.catch(() => {}) : Promise.resolve()).then(async () => {
      // Re-checked INSIDE the queue, not only at entry: a save enqueued before
      // the rollback would otherwise run after it, and by then this session's
      // book ops have been undone while its character blob still reflects
      // them, so committing it is exactly the mint the rollback prevented.
      if (session.escrowQuarantined) return false;
      const state = this.sim.serializeCharacter(session.pid);
      const e = this.sim.entities.get(session.pid);
      // Captured at serialize time: only unlocks already inside THIS blob may
      // publish when it lands. An unlock granted while the write is in flight
      // stays pending for the save queued behind it, so the character_deeds
      // index (and Steam, chained off it) never runs ahead of durable state.
      const recordUpTo = session.pendingDeedRecords.length;
      if (state && e) {
        // The session-position/jail fixups, applicable to ANY snapshot of this
        // character (the T0 one below, or a re-serialized one inside the
        // queued escrow thunk).
        const applyFixups = (s: NonNullable<typeof state>): NonNullable<typeof state> => {
          if (session.spectating) {
            s.pos = {
              x: session.spectating.savedPos.x,
              z: session.spectating.savedPos.z,
            };
            s.pet = session.spectating.stowedPet;
          }
          if (session.jailVisit) {
            s.pos = {
              x: session.jailVisit.savedPos.x,
              z: session.jailVisit.savedPos.z,
            };
            s.facing = session.jailVisit.savedFacing;
            s.pet = session.jailVisit.stowedPet;
          }
          if (session.jailed) {
            const jailPos = this.jailSpawnFor(session);
            s.pos = { x: jailPos.x, z: jailPos.z };
            s.jail = session.jailed;
            s.dead = false;
            s.ghost = false;
            s.corpsePos = null;
            s.hp = Math.max(1, s.hp);
          } else {
            delete s.jail;
          }
          return s;
        };
        applyFixups(state);
        // Use the SERIALIZED level (not e.level): during a 2v2 Fiesta bout e.level
        // is temporarily 20, but serializeCharacter reports the real level — so the
        // character-list/leaderboard `level` column never reflects the temp state.
        let saved: boolean;
        // The level the row will actually carry. The escrow arm below
        // re-serializes a FRESH snapshot inside the queued thunk (snap), so a
        // silent level move landing during the queue wait persists snap.level
        // while the T0 `state.level` stays behind; the linked-member level
        // feed must gate on the PERSISTED value or it reports the move a save
        // late (or never, when that save was the leave flush). Release-merge
        // mirror of the v0.34.0 lastPersistedLevel change onto this branch's
        // three-path saveCharacter.
        let persistedLevel = state.level;
        // Guild books this save will carry (Guild Bank Phase 3, reshaped by
        // the escrow root fix). The payload is NOT the shared live book: it is
        // this session's OWN unflushed delta log per guild, and the write is a
        // read-modify-write inside the fenced transaction
        // (server/db.ts writeGuildBankRow: SELECT ... FOR UPDATE, then
        // mergeGuildBankRow, then the upsert). That is the whole guarantee:
        //
        //   A session persists DURABLE TRUTH PLUS ITS OWN DELTAS, so its
        //   commit can only ever contain its own work. Another officer's
        //   not-yet-durable op is not in this payload and cannot ride it into
        //   the row, so the fence means exactly what its comments say: a
        //   fenced-out session's ops reach durable state through NO path.
        //
        // The marks and log lengths are still captured at write time inside
        // the queued closure, exactly like the market snapshot, so an op
        // dispatched during the serial-writer wait re-schedules itself instead
        // of being dropped. A guild whose serializeGuildBank returns null (no
        // loaded book: unloaded, oversized, or malformed at boot) is SKIPPED
        // entirely (collectGuildBankDeltas), so an unloaded book's row is
        // never touched.
        const carriedGuildBankSeqs: [number, number][] = [];
        // How many unflushed-op log entries per guild this save's payload
        // includes (captured with the marks): a commit consumes exactly that
        // many from the front of each log, so a mid-save op's entry survives
        // alongside its surviving dirty mark.
        const carriedGuildBankOpCounts = new Map<number, number>();
        // What each book write actually did, filled by the db layer inside the
        // transaction (see GuildBankWriteResult).
        const guildBankResults: GuildBankWriteResult[] = [];
        // Guilds the payload SKIPPED (no loaded book: unloaded, oversized, or
        // malformed at boot). Their rows are not this process's to touch, so
        // their marks and logs must survive the commit: releasing them would
        // leave a character half durable with a book half never written.
        const skippedGuildBanks = new Set<number>();
        const collectDeltas = () => {
          carriedGuildBankSeqs.length = 0;
          carriedGuildBankOpCounts.clear();
          guildBankResults.length = 0;
          skippedGuildBanks.clear();
          session.inFlightGuildBankOps.clear();
          for (const entry of session.dirtyGuildBanks) {
            carriedGuildBankSeqs.push(entry);
            const carried = session.unflushedGuildBankOps.get(entry[0])?.length ?? 0;
            carriedGuildBankOpCounts.set(entry[0], carried);
            session.inFlightGuildBankOps.set(entry[0], carried);
          }
          const saves = collectGuildBankDeltas(
            (guildId) => this.sim.serializeGuildBank(guildId),
            (guildId) => session.unflushedGuildBankOps.get(guildId) ?? [],
            carriedGuildBankSeqs.map(([guildId]) => guildId),
          );
          const carriedIds = new Set(saves.map((save) => save.guildId));
          for (const [guildId] of carriedGuildBankSeqs) {
            if (!carriedIds.has(guildId)) skippedGuildBanks.add(guildId);
          }
          return saves;
        };
        // Captured BEFORE the await: a save that carries a guild book is the
        // dupe-sensitive escrow shape, and the dirty marks it would clear are
        // still set while the write is in flight, so a throw below must be
        // attributable even though carriedGuildBankSeqs is filled only once
        // the queued closure actually runs.
        const carriesGuildBooks = session.dirtyGuildBanks.size > 0;
        if (opts.withMarket || carriesGuildBooks) {
          // Atomic on the leave path so a logout bag-flush can never tear away
          // from the global Market escrow (see saveCharacterAndMarketState),
          // and on any save carrying a guild book so the character half and
          // the book half commit or vanish together (the same escrow shape;
          // both siblings ride the character-lease fence). Run through the
          // market queue and capture the market/book snapshots at write time
          // so this commit can't clobber newer ones.
          try {
            saved = await this.enqueueMarketWrite(() => {
              // BOTH escrow halves are captured HERE, in one synchronous step at
              // write time, after the serial-writer wait: an op dispatched
              // during the wait mutates the live character AND the live book,
              // so a character blob serialized before the wait paired with a
              // book serialized inside it would commit two different instants
              // (a deposit lands in both halves, a withdraw in neither: the
              // Phase 3 QA database-review BLOCKING). Re-serializing may fail
              // only if the player left mid-wait; then the T0 snapshot (whose
              // ops are all pre-wait) is still self-consistent with the books
              // its session could have dirtied. recordUpTo stays captured at
              // T0: the fresher blob can only contain MORE than it publishes,
              // never less (publish never runs ahead of durable state).
              const fresh = this.sim.serializeCharacter(session.pid);
              const snap = fresh ? applyFixups(fresh) : state;
              persistedLevel = snap.level;
              return opts.withMarket
                ? saveCharacterAndMarketState(
                    session.characterId,
                    snap.level,
                    snap,
                    this.sim.serializeMarket(),
                    this.sim.serializeMail(),
                    session.leaseNonce,
                    collectDeltas(),
                    guildBankResults,
                  )
                : saveCharacterAndGuildBankState(
                    session.characterId,
                    snap.level,
                    snap,
                    collectDeltas(),
                    session.leaseNonce,
                    guildBankResults,
                  );
            });
          } catch (err) {
            // The whole escrow rolled back: the character half AND every book
            // half. The live sim is now ahead of durable truth for those books
            // until a later save or a reconcile lands, which is exactly the
            // window the dupe guards live in, so it must be visible in
            // production, not only in a log line. The counter observes, it
            // never swallows: the refusal arm still runs below and a foreign
            // error is still rethrown.
            //
            // A REFUSAL is deliberately not counted here. Two officers of one
            // guild contending is ordinary concurrency and the usual outcome is
            // "refused, will retry, resolves in a round trip", which is not a
            // failure and must not share a counter kind with one (an operator
            // alerting on escrow_save_failed > 0 was getting that noise).
            // handleGuildBankEscrowRefusal below owns the vocabulary instead:
            // escrow_refused_retry per guild on the retry arm, and this
            // escrow_save_failed once for the session on the TERMINAL arm,
            // where the save really did fail for good.
            if (carriesGuildBooks && !(err instanceof GuildBankEscrowRefused)) {
              gameMetricsCounters().guildBankIncident('escrow_save_failed');
            }
            // A REFUSED book half aborts the whole transaction, character row
            // included, so this save persisted nothing at all. Skip every
            // post-save step (no lastSave, no deed publish, no mark release:
            // the log is exactly as it was) and decide whether to retry or
            // roll the session back.
            if (err instanceof GuildBankEscrowRefused) {
              this.handleGuildBankEscrowRefusal(session, err.results, opts.final === true);
              // Nothing persisted, character row included, so this reports the
              // same "did not land" as a fence-out to any caller reading it.
              return false;
            }
            throw err;
          } finally {
            // Whatever happened to the write, no payload is in flight any
            // more: the cap's compaction may touch the whole log again.
            session.inFlightGuildBankOps.clear();
          }
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
          // Same dupe-sensitive shape as the throw above, reached the other
          // way: the write matched no row, so nothing persisted. Counted only
          // when this save actually carried books (an ordinary fenced-out
          // character save is not a guild bank incident).
          if (carriedGuildBankSeqs.length > 0) {
            gameMetricsCounters().guildBankIncident('save_fenced_out');
          }
          console.warn(
            `character ${session.characterId} (${session.name}) save fenced out by a same-account takeover; skipping deed publish and lastSave`,
          );
          // Guild books this save carried were mutated in the LIVE sim by ops
          // whose character half just rolled back, so the LIVE book is ahead
          // of what this session can ever make durable. Undo exactly this
          // session's own ops on the live book; no other session's payload can
          // contain them, so there is nothing else to converge.
          this.revertOwnGuildBookOps(
            session,
            carriedGuildBankSeqs.map(([guildId]) => guildId),
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
          return false;
        }
        session.lastSave = Date.now();
        // The carried books: release their dirty marks where the write
        // actually landed AND the seq is unchanged (a mid-save op re-dirtied
        // the book with state this commit did not include), consuming the
        // committed prefix of each unflushed-op log (a mid-save op's entry
        // survives). A book whose write was SKIPPED keeps its mark and its log
        // for a later retry; see resolveGuildBankDeficit.
        // Reaching here means the transaction COMMITTED, so every book half it
        // CARRIED landed: a refused one aborts the whole transaction and throws
        // (GuildBankEscrowRefused), so there is no partial arm to handle. A
        // guild the payload SKIPPED is the one thing that still needs guarding:
        // nothing was written for it, so nothing may be released.
        for (const [guildId, seq] of carriedGuildBankSeqs) {
          if (skippedGuildBanks.has(guildId)) continue;
          const written = guildBankResults.find((r) => r.guildId === guildId);
          if (written && !written.written) continue; // defensive: a refusal throws
          const carried = carriedGuildBankOpCounts.get(guildId) ?? 0;
          if (session.dirtyGuildBanks.get(guildId) === seq) {
            session.dirtyGuildBanks.delete(guildId);
          }
          session.guildBankDeficitSkips.delete(guildId);
          const log = session.unflushedGuildBankOps.get(guildId);
          if (log) {
            log.splice(0, carried);
            if (log.length === 0) session.unflushedGuildBankOps.delete(guildId);
          }
        }
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
        // Same durability ordering as the deed publish above: the level the bot can
        // read only moved once this write landed. Delta-gated on the SERIALIZED level
        // (never e.level, which a Fiesta bout temporarily raises), so this covers the
        // autosave sweep, leave, shutdown, and every silent Sim.setPlayerLevel path
        // (dev_level, the GM join arm, the PBE boost) while staying silent on the
        // overwhelming majority of saves that move no level.
        // DELIBERATE EXCLUSION: lifetimeXp-only movement is not enqueued. It can only
        // flip the highestCharacterForAccount tiebreak between two same-level
        // characters on one account, and it rises on nearly every save of an active
        // player, so gating on it would turn the 30 s autosave sweep into a per-player
        // metronome. The bot's periodic full resync heals that rare tiebreak flip.
        if (persistedLevel !== session.lastPersistedLevel) {
          session.lastPersistedLevel = persistedLevel;
          // Date.now(), like every other enqueue site: the feed's dedupe window is
          // measured against wall-clock now, so handing it a stamp coupled to the
          // save bookkeeping buys nothing and a stale one would merge where it
          // should mint.
          enqueueLinkChange({ accountId: session.accountId, kinds: ['flex'] }, Date.now());
        }
      }
      return true;
    });
    this.characterSaveQueues.set(session.characterId, run);
    try {
      return await run;
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
    // SHUTDOWN gets a second pass over whoever is still dirty. A guild book
    // whose escrow replay stalled on another officer's not-yet-durable work
    // keeps its mark and resolves on the session's NEXT save, and at shutdown
    // there is otherwise no next save: the residue would go durable unrecorded
    // and heal only if the realm came back with both officers online. One
    // extra pass is enough because the first pass made every other session's
    // work durable. The 30 s autosave sweep does not need it (its next tick is
    // the retry) and must not pay for it.
    if (reason !== 'shutdown') return;
    const stillDirty = sessions.filter((s) => s.dirtyGuildBanks.size > 0);
    for (const session of stillDirty) {
      // FINAL: there is no pass three, so a refusal here resolves now rather
      // than waiting for a retry that will never come.
      await this.saveCharacter(session, { final: true }).catch((err) =>
        console.error(`${reason} retry failed for ${session.name}:`, err),
      );
    }
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

  // Guild bank books (Guild Bank Phase 3): boot-load every realm guild's book
  // into the live sim BEFORE players join (a guild with no row gets an empty
  // book), releasing the deliberately silent-inert Phase 2 wire. An oversized
  // row is SKIPPED loudly (that guild's ops stay inert and its row survives on
  // disk); a load failure leaves every book absent, which is safe (ops refuse
  // silently) but logged. There is no periodic saveGuildBanks sibling BY
  // DESIGN: books persist only through the fenced escrow save that carries the
  // acting character (saveCharacter below), never standalone.
  async loadGuildBanks(): Promise<void> {
    // A failed boot load leaves EVERY guild bank on the realm silently inert
    // until restart (ops refuse, and last-member-leave/disband fail closed on
    // the unloaded books, refusing guild deletion), so a transient DB blip is
    // retried before giving up LOUDLY. Never throws: the realm still boots.
    const attempts = 3;
    let rows: Awaited<ReturnType<typeof loadGuildBankRows>> | null = null;
    for (let attempt = 1; attempt <= attempts && rows === null; attempt++) {
      try {
        rows = await loadGuildBankRows();
      } catch (err) {
        console.error(`guild bank boot load attempt ${attempt}/${attempts} failed:`, err);
        if (attempt < attempts) await new Promise((r) => setTimeout(r, 500 * attempt));
      }
    }
    if (rows === null) {
      console.error(
        'GUILD BANKS UNAVAILABLE: the boot load failed after every retry; all guild bank ops on this realm stay inert and guild deletion (disband, last-member leave) is refused fail-closed until a restart loads the books',
      );
      return;
    }
    // Soft size watch (a quarter of the hard bound): a legitimate 48-slot
    // book is a few KB, so a row this large is growing toward the skip bound
    // (or corrupt-but-well-shaped) and deserves operator eyes BEFORE it trips
    // the hard skip and goes inert.
    for (const row of rows) {
      if (!row.oversized && (row.dataBytes ?? 0) > GUILD_BANK_ROW_MAX_BYTES / 4) {
        console.warn(
          `guild bank row for guild ${row.guildId} is ${row.dataBytes} bytes (soft watch threshold ${GUILD_BANK_ROW_MAX_BYTES / 4}); it still loads, but investigate before it reaches the hard bound and goes inert`,
        );
      }
    }
    const result = loadGuildBanksIntoSim(this.sim, rows);
    // Each of these leaves ONE guild's book unloaded until a restart: its ops
    // are inert and its disband is refused fail-closed, an outage for that
    // guild rather than a transient. Counted per guild beside the loud log
    // (the guild id stays in the log; it is never a metric label).
    for (const guildId of result.oversized) {
      gameMetricsCounters().guildBankIncident('book_unloaded');
      console.error(
        `guild bank row for guild ${guildId} exceeds the size bound; left unloaded (ops stay inert, the row is preserved)`,
      );
    }
    for (const guildId of result.malformed) {
      gameMetricsCounters().guildBankIncident('book_unloaded');
      console.error(
        `guild bank row for guild ${guildId} is structurally not a book; left unloaded (ops stay inert, the row is preserved)`,
      );
    }
    for (const guildId of result.missing) {
      gameMetricsCounters().guildBankIncident('book_unloaded');
      console.error(`guild bank book for guild ${guildId} failed to load into the sim`);
    }
  }

  // Upper bound on one session's per-guild unflushed-op log (Guild Bank
  // Phase 3 QA): at the guarded op rate (guild_bank_op_guard.ts) reaching it
  // takes minutes of continuously failing commits. Crossing it COMPACTS the
  // log (server/guild_bank_op_log.ts), semantics-preserving, rather than
  // dropping it: the log is the escrow save's write payload, so a drop would
  // silently discard committed-intent work. Pinned in
  // tests/guild_bank_persistence.test.ts.
  static readonly GUILD_BANK_UNFLUSHED_OP_CAP = 500;

  /** Make the reserve-at-gate creation fee DURABLE, and only then book it.
   *
   *  THE HOLE THIS CLOSES: the fee is deducted from the LIVE purse at the
   *  guild_create gate, the create commits, and the charge reaches the database
   *  only through this session's character half. Fire-and-forgetting that save
   *  meant a save which never became durable (a same-account takeover fence-out
   *  discards the session's state; a crash loses it) left the guild created and
   *  the founder's DURABLE purse untouched: a free guild. The book half cannot
   *  rescue it either, because revertOwnGuildBookOps replays BOOK deltas and
   *  the fee is not one: it lives on the character.
   *
   *  What is fixable here is fixable automatically: while the session is alive
   *  the deduction sits in the live purse, so the autosave, the next op's save,
   *  or the leave flush all persist it. What is NOT fixable is a session whose
   *  live state is thrown away, and for that arm the honest answer is to make
   *  the failure LOUD and MACHINE-READABLE rather than to book a payment that
   *  did not happen.
   *
   *  So the `create_fee` ledger row is written AFTER the write commits (the
   *  durability ordering the deed publish beside it already uses). A failed
   *  save writes no row, which keeps the audit honest in the only direction
   *  that matters: a guild with no create_fee row is a guild that was not paid
   *  for, and it is findable with one query. The incident counter
   *  (`create_fee_unpaid`) is the alerting half; the loud log carries the
   *  guild, the character, and the amount an operator has to collect. */
  private async persistGuildCreateFee(
    session: ClientSession,
    guildId: number,
    fee: { accountId: number; amount: number; pursePaid: number } | null,
  ): Promise<void> {
    this.markGuildBankDirty(session, guildId);
    let durable = false;
    try {
      durable = await this.saveCharacter(session);
    } catch (err) {
      console.error(`guild create fee save failed for ${session.name}:`, err);
    }
    if (!fee || fee.amount <= 0) return;
    if (!durable) {
      // The live purse still holds the deduction, so an ordinary transient
      // failure self-heals on the next save of a session that is still alive.
      // This line is for the arm that cannot: a fenced-out or quarantined
      // session's live state is abandoned, and the fee goes with it.
      gameMetricsCounters().guildBankIncident('create_fee_unpaid');
      console.error(
        `guild create fee for guild ${guildId} did not become durable for character ${session.characterId} (${session.name}): ${fee.amount} copper may be uncollected, and no create_fee row was written`,
      );
      return;
    }
    recordGuildBankDeltas(
      'create_fee',
      { characterId: session.characterId, accountId: fee.accountId },
      guildId,
      [guildCreateFeeDelta(fee.amount, fee.pursePaid)],
    );
  }

  // Schedule a guild's book for the next fenced escrow save of this session.
  private markGuildBankDirty(session: ClientSession, guildId: number): void {
    session.dirtyGuildBanks.set(guildId, (session.dirtyGuildBanks.get(guildId) ?? 0) + 1);
  }

  // The refusal/error arm of the reserve-at-gate creation fee: return the
  // reserved copper to the founder's purse. Consumes the pending reservation
  // exactly once (the success arm consumed it instead when the create
  // committed). A founder who left before the refusal arm ran cannot be
  // refunded in the live sim; that arm is logged LOUDLY for operator
  // compensation (rare: it needs a refused create racing a logout).
  private refundGuildCreateFee(characterId: number): void {
    const fee = this.pendingGuildCreateFees.get(characterId);
    if (!fee) return; // already consumed by the success arm
    this.pendingGuildCreateFees.delete(characterId);
    if (fee.amount <= 0) return;
    const s = this.sessionsByCharacterId.get(characterId);
    const refunded = s ? this.sim.refundGuildCreationFeeFor(s.pid, fee.amount) : 0;
    if (refunded !== fee.amount) {
      console.error(
        `guild create fee refund could not be applied for character ${characterId}: reserved ${fee.amount}, refunded ${refunded}; operator compensation needed`,
      );
    }
  }

  // When this session's escrow can never commit again, its guild-book
  // mutations remain in the LIVE book while the character half rolled back
  // (fence-out: a same-account takeover) or never landed (the leave flush
  // exhausted its retries). SYNCHRONOUS and unconditional: replay exactly this
  // session's own unflushed deltas BACKWARD onto the live book, leaving every
  // other session's unflushed ops untouched.
  //
  // There is deliberately no evict-and-reload arm any more, and no
  // cross-session dirty scan to choose between arms. Under the escrow root fix
  // a session's payload contains only its own deltas, so a dead session's ops
  // are in NO other session's payload and durable truth can never have been
  // advanced by them: reloading the row would restore state that is either
  // identical (a no-op) or another officer's newer work (destroying it).
  //
  // EVERY unflushed delta is undone, with no exceptions to reason about: a
  // save either commits both halves or commits neither, so an unflushed delta
  // never has a durable character half behind it.
  private revertOwnGuildBookOps(dead: ClientSession, guildIds: number[]): void {
    for (const guildId of guildIds) {
      const log = dead.unflushedGuildBankOps.get(guildId) ?? [];
      dead.dirtyGuildBanks.delete(guildId);
      dead.unflushedGuildBankOps.delete(guildId);
      dead.guildBankDeficitSkips.delete(guildId);
      if (log.length === 0) continue;
      // Counted per GUILD, the unit the remedy applies to: reaching this at
      // all means a session that can never commit again held unflushed book
      // ops, the shape the Phase 3 QA dupe lived in. This is the ONE reconcile
      // site under the escrow root fix (the fence-out, the exhausted leave
      // flush, the teardown sweep, and the escrow-refusal quarantine all land
      // here), so the counter lives here rather than at four call sites. A
      // guild whose log is already empty is a bookkeeping no-op, not an
      // incident, and is not counted.
      gameMetricsCounters().guildBankIncident('reconcile');
      this.sim.revertGuildBankDeltas(guildId, log);
    }
  }

  // How many consecutive escrow REFUSALS one session tolerates for one guild
  // before it is rolled back rather than retried. Deliberately SMALL: while a
  // refusal is outstanding this character persists NOTHING, including progress
  // that has nothing to do with the guild bank, so every extra retry is
  // unrelated progress an adversary can put at risk by keeping the book short.
  // Two is enough because a refusal immediately flushes the sessions it is
  // waiting on (see handleGuildBankEscrowRefusal), which turns the wait into a
  // round trip instead of an autosave interval.
  static readonly GUILD_BANK_DEFICIT_MAX_SKIPS = 2;

  // The escrow REFUSAL arm. The book half could not be replayed onto durable
  // truth, so the whole transaction rolled back and this save persisted
  // NOTHING: not the books, not the character. That is the invariant the
  // feature rests on, stated as a rule rather than as a residue:
  //
  //   If the book half cannot be applied, the character half must not commit.
  //
  // Carrying the shortfall and recording it was the alternative, and it is a
  // two-account money printer: officer A deposits without flushing, officer B
  // withdraws, B's character half commits while the book half does not, then A
  // gets itself fenced (an ordinary re-login) so nothing will ever make A's
  // deposit durable. B keeps the copper, A's stake comes back, repeatable on
  // demand. Refusing removes it: B's purse can never durably gain what the
  // book never durably lost.
  //
  // Two outcomes:
  // - RETRY, while another session still holds unflushed work for the guild:
  //   their commit is what makes this replay applicable, and it lands within
  //   an autosave interval. Nothing is consumed; the marks and the log are
  //   exactly as they were.
  // - ROLL BACK, when no other session holds unflushed work (so nothing will
  //   ever make the missing value durable) or the retries ran out. This
  //   session's live state is abandoned: its own book ops come back off the
  //   live book, it is QUARANTINED so it can never persist again, one
  //   aggregate anomaly row records the incident, and it is disconnected to
  //   reload from its durable row. Everything it did since its last successful
  //   save is lost, which is exactly what a lease fence-out already does, and
  //   it conserves precisely because none of it was ever durable.
  private handleGuildBankEscrowRefusal(
    session: ClientSession,
    results: readonly GuildBankWriteResult[],
    // True when this is the LAST save this session will ever get (the leave
    // flush, or the shutdown flush's second pass). There is no later retry to
    // wait for, so the refusal is resolved now rather than left to a save that
    // will never come: otherwise the session would tear down with its progress
    // discarded and no log line and no ledger row to say why.
    final = false,
  ): void {
    let quarantine = false;
    for (const result of results) {
      if (result.written) continue;
      const guildId = result.guildId;
      let anotherSessionDirty = false;
      for (const s of this.sessionsByCharacterId.values()) {
        // A quarantined or departing session's marks are NOT a reason to wait:
        // it will never commit them, so counting it would burn every retry
        // (blocking this session's character saves the whole time) before
        // reaching the same rollback.
        if (s === session || s.escrowQuarantined || s.left) continue;
        if (s.dirtyGuildBanks.has(guildId)) {
          anotherSessionDirty = true;
          break;
        }
      }
      const skips = (session.guildBankDeficitSkips.get(guildId) ?? 0) + 1;
      const canResolve =
        !final &&
        anotherSessionDirty &&
        !result.rowUnusable &&
        skips < GameServer.GUILD_BANK_DEFICIT_MAX_SKIPS;
      if (canResolve) {
        // ORDINARY CONCURRENCY, not a failure: another officer of this guild
        // holds unflushed work, their commit is what makes this replay
        // applicable, and the flush below makes that a round trip rather than
        // an autosave interval. Nothing was consumed and nothing is lost, so
        // it gets its own counter kind: sharing escrow_save_failed made that
        // counter unusable for `> 0` alerting. Counted per GUILD, the unit the
        // retry applies to.
        gameMetricsCounters().guildBankIncident('escrow_refused_retry');
        session.guildBankDeficitSkips.set(guildId, skips);
        // Do not wait out an autosave interval: FLUSH the sessions whose
        // unflushed work this replay is waiting on, so the retry lands a round
        // trip later rather than 30 seconds later. This is what keeps the
        // blocked window (during which THIS character persists nothing at all,
        // including progress that has nothing to do with the guild bank) to
        // the shortest it can be, and it is why the skip bound is small.
        //
        // Only on the FIRST refusal: if that flush is itself refused it will
        // flush back, and an unbounded ping-pong of fire-and-forget saves
        // between two mutually-stuck sessions is worse than the wait it saves.
        if (skips > 1) continue;
        for (const s of this.sessionsByCharacterId.values()) {
          if (s === session || s.escrowQuarantined || s.left) continue;
          if (!s.dirtyGuildBanks.has(guildId)) continue;
          void this.saveCharacter(s).catch((err) =>
            console.error(`guild bank deficit flush failed for ${s.name}:`, err),
          );
        }
        continue;
      }
      const log = session.unflushedGuildBankOps.get(guildId) ?? [];
      recordGuildBankEscrowRollback(session, guildId, log, result.deficit);
      console.error(
        `guild bank escrow rolled back for guild ${guildId} (character ${session.characterId}): ${
          result.rowUnusable
            ? 'the stored row is oversized or malformed, or the merged book would cross the size bound, so it is preserved untouched'
            : `${result.deficit?.kind} shortfall ${result.deficit?.shortfall} on ${result.deficit?.op}${result.deficit?.itemId ? ` (${result.deficit.itemId})` : ''}, and ${
                anotherSessionDirty
                  ? `it did not resolve within ${skips} escrow saves`
                  : 'no other session holds unflushed work for this guild, so it never can'
              }`
        }. The session is quarantined and disconnected; nothing it did since its last save was durable, so nothing is lost that was.`,
      );
      quarantine = true;
    }
    if (!quarantine) return;
    // TERMINAL: this refusal will never resolve, so the save really did fail
    // for good (character half included, nothing durable). That is what
    // escrow_save_failed means, and it is booked here rather than at the throw
    // site so a refusal that merely RETRIES never reaches it. Counted once per
    // SAVE, matching the db-threw arm above.
    gameMetricsCounters().guildBankIncident('escrow_save_failed');
    // The terminal arm of the escrow design and the one an operator should
    // alert on: a live session is being abandoned because its book half can
    // never be replayed onto durable truth. Counted once per SESSION (the unit
    // the remedy applies to; the per-guild reverts it triggers are counted as
    // 'reconcile' inside revertOwnGuildBookOps), beside the loud log that
    // carries the guild id and the deficit.
    gameMetricsCounters().guildBankIncident('escrow_quarantined');
    // The character half is the half that would carry the value the book half
    // could not, so this session must never save again.
    session.escrowQuarantined = true;
    // Undo EVERY book this session dirtied, not only the refused one: the
    // session as a whole is abandoned, so its deltas in a second guild's book
    // are live value nobody will ever make durable, and another officer
    // withdrawing that phantom value would be refused in turn.
    this.revertOwnGuildBookOps(session, [...session.dirtyGuildBanks.keys()]);
    if (!session.left) {
      void this.kickSession(session, 'guild bank escrow rollback', 'character taken over');
    }
  }

  // Run one guild bank op with the observer pair around it: the before/after
  // book diff (the personal bank's recordBankOp idiom) detects success, writes
  // the fire-and-forget ledger rows, and marks the guild book dirty for the
  // escrow save. Never awaited, never a gameplay dependency; a refused op
  // diffs empty and does nothing.
  //
  // THE ONLY server-side guild book mutation path. `target` says how to read
  // the book around the mutation:
  //  - `{ pid }`  a dispatched player op: the gated guildBankInfoFor read, and
  //    the guild id comes from that player's membership stamp.
  //  - `{ guildId, actorAccountId }`  the OPERATOR path (the admin dormant-slot
  //    purge), which has no acting player: the ungated guild-scoped read, the
  //    guild id is explicit, and the LEDGER ROW IS ATTRIBUTED TO THE OPERATOR'S
  //    ACCOUNT rather than the carrier's owner, so the evidence names who
  //    ordered the removal. `session` is then only the CARRIER whose fenced
  //    escrow save takes the book (see adminPurgeGuildBankSlot).
  // Extending this seam rather than writing a second mutation path is the
  // Phase 3 acceptance line: the diff feeds BOTH the bank_ledger rows and the
  // per-session unflushed-delta log the fence-out revert depends on, so a
  // mutation outside it would be invisible to the audit and unrevertable.
  private runGuildBankOp(
    session: ClientSession,
    target: { pid: number } | { guildId: number; actorAccountId: number },
    op: GuildBankLedgerOp,
    run: () => void,
  ): void {
    // A guild whose DELETE is already in flight has passed its empty-bank
    // guard, so its row is about to cascade away: an op landing now would be
    // destroyed by that cascade with its dirty mark and unflushed log wiped by
    // the post-commit hook (onGuildDisbanded), leaving an orphaned ledger row
    // behind. Refuse before the sim runs, so nothing mutates, no ledger row is
    // written and no book is marked dirty. The window's contract
    // (beginGuildBankDelete) is stated over THIS method, so it covers the
    // operator arm too; only the player arm has somebody to TELL, and it is
    // told, because the window is only two DB round trips wide but a deposit
    // that appears to do nothing at all is worse than one that says to try
    // again. The operator arm's answer is shaped by adminPurgeGuildBankSlot,
    // which pre-checks the same window so it can name the reason.
    const actingGuildId =
      'pid' in target ? this.sim.meta(target.pid)?.guildMembership?.guildId : target.guildId;
    if (actingGuildId !== undefined && this.guildBankDeleteWindows.has(actingGuildId)) {
      // English on the wire, re-localized by the client matcher
      // (src/ui/server_i18n.ts guild.bankClosing), the server-text contract:
      // src/sim and server stay language-agnostic.
      if ('pid' in target) {
        this.sendChatNotice(session, 'The guild bank is closing. Try again in a moment.');
      }
      return;
    }
    const read = () =>
      'pid' in target
        ? this.sim.guildBankInfoFor(target.pid)
        : this.sim.guildBankInfoForGuild(target.guildId);
    // The COUNTERPARTY read, taken from the SAME instants as the book read so
    // both halves of the op describe one moment. Server-derived throughout:
    // the acting character's live purse and bags off the sim's own meta, never
    // anything the client sent. The operator purge path has no acting
    // character, so its counterparty is null on both sides and the movement
    // resolves to a recorded ZERO (the copy is destroyed, not handed to
    // anybody), which is what lets the audit check a purge instead of skipping
    // it.
    //
    // counterpartySnapshot COPIES the quantities out. `meta.inventory` is the
    // live array the sim mutates in place, so holding it across run() would
    // difference every item movement to zero and pass everything silently.
    const readCounterparty = () => {
      if (!('pid' in target)) return null;
      const meta = this.sim.meta(target.pid);
      const actor: CounterpartyActor | null = meta
        ? { copper: meta.copper, inventory: meta.inventory }
        : null;
      return counterpartySnapshot(actor);
    };
    const before = read();
    const actorBefore = readCounterparty();
    run();
    const after = read();
    const movement = counterpartyMovement(actorBefore, readCounterparty());
    // Rung 0 of the ladder OPENS the bank from the acting officer's own PURSE
    // (the sim decides which rung is next off the BEFORE book); it gets its
    // own ledger op name so the audit's treasury replay can exclude the
    // purse-paid copper like create_fee, and so the revert path never credits
    // the treasury for money it never held. The rung is derived EXACTLY as
    // the sim's buy op derives it (guildBankRungsBought, which floors a
    // non-position count): a tampered live count below the opened base still
    // charges the purse, so naming it buy_slots here would corrupt the audit
    // replay and let a revert mint treasury copper.
    const effectiveOp: GuildBankLedgerOp =
      op === 'buy_slots' && before !== null && guildBankRungsBought(before.purchasedSlots) === 0
        ? 'open_bank'
        : op;
    const deltas = diffGuildBankOp(effectiveOp, before, after);
    // A successful player op requires a stamped officer-plus membership, and
    // the stamp cannot change inside the synchronous run() above. The operator
    // path names its guild outright (it has no acting player to read).
    const guildId =
      'pid' in target ? this.sim.meta(target.pid)?.guildMembership?.guildId : target.guildId;
    // Attribution: a player op is the acting character's own; an operator op
    // keeps the carrier's character (the column is NOT NULL and an operator may
    // hold no character) but books the OPERATOR'S account, so the row names who
    // ordered it instead of the bystander who lent the escrow transaction.
    const who =
      'pid' in target
        ? session
        : { characterId: session.characterId, accountId: target.actorAccountId };
    // Movement of the acting character's purse or bags that NO ledger row
    // accounts for. Two ways to get here, and both are the same defect seen
    // from different sides:
    //  - the book did not move at all (deltas empty), so no ordinary row is
    //    written and the value that left the purse would leave no trace;
    //  - the book moved, but the purse/bags ALSO moved under an id no row
    //    names, so every written row balances by construction and the extra
    //    movement is invisible again.
    // Neither can happen legitimately (an op moves both sides or refuses and
    // moves neither), so both get the loud path: an anomaly ledger row for the
    // offline audit, a counter for production alerting, and a log line naming
    // the guild. Never a silent drop.
    const reportOrphan = (unaccounted: CounterpartyMovement) => {
      if (guildId === undefined || counterpartyIdle(unaccounted)) return;
      const orphan = counterpartyOrphan(unaccounted);
      if (!orphan) return;
      gameMetricsCounters().guildBankIncident('counterparty_orphan');
      console.error(
        `guild bank counterparty orphan on ${effectiveOp} for guild ${guildId} (character ${session.characterId}): the acting character's purse/bags moved value no ledger row accounts for (copper ${orphan.copperDelta}${orphan.itemId ? `, ${orphan.count} x ${orphan.itemId}` : ''})`,
      );
      recordGuildBankCounterpartyOrphan(
        who,
        guildId,
        after?.purchasedSlots ?? before?.purchasedSlots ?? 0,
        orphan,
        counterpartyOrphanEvidence(effectiveOp, unaccounted),
      );
    };
    if (deltas.length === 0) {
      reportOrphan(movement);
      return;
    }
    if (guildId === undefined) return;
    // Stamp the payer/payee half onto the rows the book diff produced. The
    // stamp DRAINS the movement across the deltas, so the recorded numbers sum
    // to exactly what moved and a multi-row op can never book one purse
    // movement twice. Whatever is LEFT is movement no row claimed, and it goes
    // down the orphan path rather than being dropped.
    const unaccounted = stampCounterpartyDeltas(deltas, movement);
    this.markGuildBankDirty(session, guildId);
    // Record the op in the session's unflushed log: this log is the escrow
    // save's WRITE PAYLOAD (replayed forward onto durable truth) and the
    // reconcile's undo list (replayed backward onto the live book).
    let log = session.unflushedGuildBankOps.get(guildId) ?? [];
    for (const d of deltas) {
      log.push({
        op: effectiveOp,
        itemId: d.itemId,
        count: d.count,
        instance: (d.instance ?? null) as GuildBankOpDelta['instance'],
        craftedRecipeId: d.craftedRecipeId ?? null,
        copperDelta: d.copperDelta,
        // diffGuildBankOp always sets the before witness on the guild path
        // (pinned in tests/bank_ledger.test.ts); the fallback is defensive.
        purchasedSlotsBefore: d.purchasedSlotsBefore ?? 0,
        purchasedSlotsAfter: d.purchasedSlotsAfter,
      });
    }
    if (log.length > GameServer.GUILD_BANK_UNFLUSHED_OP_CAP) {
      // Overflow (commits failing for minutes at the guarded op rate):
      // COMPACT, never drop. The log is what this session will persist, so
      // dropping it would silently discard committed-intent work; compaction
      // is semantics-preserving (server/guild_bank_op_log.ts). The settled
      // prefix (character half durable, book half pending) is compacted
      // separately so the boundary survives.
      // An IN-FLIGHT save's captured prefix must survive compaction verbatim:
      // it already captured that many entries and will consume them BY INDEX
      // when it commits, so reshuffling them would make the splice eat the
      // wrong ones (persisting work twice, or dropping it).
      const protect = Math.min(session.inFlightGuildBankOps.get(guildId) ?? 0, log.length);
      const head = log.slice(0, protect);
      log = [...head, ...compactGuildBankOpLog(log.slice(protect))];
    }
    session.unflushedGuildBankOps.set(guildId, log);
    recordGuildBankDeltas(effectiveOp, who, guildId, deltas);
    // AFTER the op's own rows, so the anomaly reads as a follow-on to them:
    // purse/bags movement that none of those rows accounts for.
    reportOrphan(unaccounted);
  }

  /** Answer a `guild_bank_log` request with the guild's visible bank history,
   *  or refuse it.
   *
   *  THE GATE IS THE BANK'S OWN GATE, deliberately not a looser one:
   *  `guildBankInfoFor(pid)` is non-null only for an alive, officer-plus member
   *  of a guild whose book is loaded, standing at a banker (the shared
   *  GUILD_BANK_RANKS allowlist). A MEMBER is refused by exactly the same
   *  predicate that denies them the bank itself, so the log can never become a
   *  side channel around the officer-only design, and the guild id comes from
   *  the server's own membership STAMP, never from the request: a client cannot
   *  name a guild to read.
   *
   *  The gate is re-checked AFTER the awaited read, because the read may share
   *  an in-flight query and a demotion, a leave, a death, or a walk-away can
   *  land in that window; the answer must reflect the authority at DELIVERY
   *  time, not at request time. A refusal is an explicit frame rather than
   *  silence, so the pane can say so instead of rendering an empty history that
   *  reads as "no officer has ever done anything". */
  private sendGuildBankLog(session: ClientSession, pid: number): void {
    const guildId = this.guildBankLogGuildFor(pid);
    if (guildId === null) {
      this.send(session, { t: 'gbanklog', ok: false });
      return;
    }
    readGuildBankLog(guildId)
      .then((entries) => {
        // Same session, same character, same guild, still authorized. A
        // linkdead or replaced session is caught by sendRaw's readyState guard
        // as well; this is the AUTHORIZATION half.
        if (session.left || session.pid !== pid || this.guildBankLogGuildFor(pid) !== guildId) {
          this.send(session, { t: 'gbanklog', ok: false });
          return;
        }
        this.send(session, { t: 'gbanklog', ok: true, entries });
      })
      .catch((err) => {
        // A cold cache whose query failed or timed out. Never a stack trace to
        // the player, and never a silent drop: the pane needs an answer to
        // leave its loading state, and "refused" is the honest one (we do not
        // know the history right now).
        //
        // COUNTED, because the frame a player gets is byte-identical to the
        // "you are not an officer" refusal: without its own incident kind a
        // total read outage would look exactly like ordinary refusals at the
        // wire and nothing would ever page. The counter sits beside the loud
        // log, never instead of it.
        gameMetricsCounters().guildBankIncident('log_read_failed');
        console.error(`guild bank log read failed for guild ${guildId}:`, err);
        this.send(session, { t: 'gbanklog', ok: false });
      });
  }

  /** The guild whose bank log this pid may read, or null when it may read
   *  none. The single place the log's authorization is decided, shared by the
   *  request gate and the post-await re-check so the two can never drift. */
  private guildBankLogGuildFor(pid: number): number | null {
    const guildId = this.sim.meta(pid)?.guildMembership?.guildId;
    if (guildId === undefined) return null;
    // The rank + proximity + alive + book-loaded gate, reused verbatim.
    return this.sim.guildBankInfoFor(pid) === null ? null : guildId;
  }

  /** The OPERATOR READ of one guild's live bank (the admin route in
   *  server/admin.ts), null when that guild has no loaded book. The discovery
   *  half of the escape hatch below: the purge takes a slot index plus the
   *  itemId at it, and before this an operator had to dig both out of
   *  guild_banks by hand.
   *
   *  Reads the SAME ungated snapshot the purge mutates through
   *  (sim.guildBankInfoForGuild), never a second book read, so a listing and the
   *  refusal that follows it agree slot for slot; adminGuildBankView then drops
   *  the per-copy instance payload, which is where the operator boundary is (see
   *  server/admin_guild_bank_view.ts). A pure live-map read plus a clone: no db,
   *  no mutation, nothing marked dirty. */
  adminGuildBankState(guildId: number): AdminGuildBankView | null {
    if (!Number.isInteger(guildId) || guildId <= 0) return null;
    const info = this.sim.guildBankInfoForGuild(guildId);
    return info === null ? null : adminGuildBankView(info);
  }

  /** The OPERATOR escape hatch for a dormant guild bank slot (the admin route
   *  in server/admin.ts). A slot holding an item a later content change flagged
   *  soulbound / noMarketList / transfer-locked is refused in BOTH directions,
   *  so it can never be withdrawn, guildBankHoldings stays non-zero forever,
   *  and the guild can never disband. No player action clears it; this does.
   *
   *  Runs through runGuildBankOp like every other book mutation, so the removal
   *  gets its bank_ledger row (op 'admin_purge', carrying the item id, count,
   *  and the REAL instance payload as evidence) and its per-session unflushed
   *  delta, and rides the same fenced escrow save. There is no standalone book
   *  write by design.
   *
   *  ATTRIBUTION: the ledger row's ACCOUNT is the acting operator
   *  (`actorAccountId`), never the carrier's owner, so the evidence trail names
   *  who ordered the removal rather than a bystander. Its character column is
   *  the carrier (the column is NOT NULL and an operator may hold no character
   *  at all); an `admin_purge` row is therefore the one shape where account and
   *  character belong to different people, which is the signal, not a defect.
   *  The operator's REASON rides the audited guild_moderation_actions row the
   *  admin route writes beside this (the rename precedent).
   *
   *  THE CARRIER: books persist only inside a character's fenced escrow
   *  transaction, so the purge needs a live session to ride. It uses a session
   *  of the TARGET GUILD (officer-plus first, any member otherwise), never an
   *  unrelated player's, so the dirty mark and the fence-out revert stay among
   *  that guild's own sessions. With nobody from the guild online there is no
   *  carrier and the purge is refused rather than mutating a live book it could
   *  not persist. Membership is a FRESH DATABASE READ (see
   *  guildBankSaveCarrier): it used to be the session stamp, on the reasoning
   *  that a stale carrier is harmless because it only lends its transaction,
   *  which is true right up to the arm that matters: a REFUSED escrow
   *  quarantines and DISCONNECTS the carrier, so a stamp lagging a kick would
   *  put a player who is no longer in the guild on a rollback-and-kick path for
   *  an operator's act.
   *
   *  OPERATOR-VISIBLE CONSEQUENCE, stated because it is not obvious: a purge
   *  rides a live guild member's save. In the rare refusal arm that member's
   *  session is rolled back and disconnected (they reconnect and lose nothing
   *  durable, but they ARE kicked). The dashboard says so before the operator
   *  confirms.
   *
   *  DURABILITY IS AWAITED, not optimistic: a fenced-out escrow save REVERTS
   *  the purge (revertOwnGuildBookOps replays the admin_purge delta backward
   *  onto the live book, exactly as it does a player withdraw), and a REFUSED
   *  escrow rolls the whole transaction back and quarantines the carrier, so
   *  answering before the save landed would tell an operator a slot is cleared
   *  while the copy is on its way back. This awaits the save and reports
   *  'save_failed' unless the book actually still lacks the copy afterwards. */
  async adminPurgeGuildBankSlot(
    guildId: number,
    slotIndex: number,
    expectItemId: string,
    actorAccountId: number,
  ): Promise<
    | { ok: true; removed: { itemId: string; count: number }; carrierCharacterId: number }
    | {
        ok: false;
        reason: 'no_book' | 'no_carrier' | 'not_dormant' | 'save_failed' | 'delete_in_flight';
      }
  > {
    if (!Number.isInteger(guildId) || guildId <= 0) return { ok: false, reason: 'no_book' };
    // The guild-delete window refuses every book mutation (runGuildBankOp
    // pre-empts the operator arm too), so pre-check it here rather than let the
    // purge read back as 'that slot is not a stuck item'.
    //
    // Its OWN reason, not save_failed: nothing was attempted, so nothing was
    // saved and nothing was rolled back, and telling an operator their change
    // "was rolled back" describes an event that did not happen. What actually
    // happened is that the guild is being deleted right now, which is both a
    // different instruction (the bank is going away; do not retry the purge)
    // and a different state (no mutation, no ledger row, no dirty mark).
    // Effectively unreachable, because a guild only takes the window after
    // proving its bank EMPTY and a dormant slot is exactly what keeps that
    // guard failing; kept because the window's contract is stated over every
    // op, not over the player ones.
    if (this.guildBankDeleteWindows.has(guildId)) {
      console.error(
        `guild bank admin purge for guild ${guildId} refused: a guild delete is in flight for it`,
      );
      return { ok: false, reason: 'delete_in_flight' };
    }
    // The book-loaded gate (the holdings read fails closed on an absent book).
    if (this.sim.guildBankHoldings(guildId) === null) return { ok: false, reason: 'no_book' };
    const carrier = await this.guildBankSaveCarrier(guildId);
    if (!carrier) return { ok: false, reason: 'no_carrier' };
    let purged: InvSlot | null = null;
    this.runGuildBankOp(carrier, { guildId, actorAccountId }, 'admin_purge', () => {
      purged = this.sim.purgeDormantGuildBankSlot(guildId, slotIndex, expectItemId);
    });
    // Read through an explicitly typed local: the assignment above happens
    // inside a callback, which the control-flow analysis cannot see.
    const removedSlot = purged as InvSlot | null;
    // Null means the sim refused: no such index, the slot does not hold the
    // named item, or it is an ordinary withdrawable copy. Nothing mutated, so
    // the observer diffed empty too.
    if (removedSlot === null) return { ok: false, reason: 'not_dormant' };
    const removed = { itemId: removedSlot.itemId, count: removedSlot.count };
    // The witness for the durability check below, taken from the SPECIFIC copy
    // that was removed rather than from a total item count: a concurrent
    // withdraw of an UNRELATED item inside the save window would otherwise
    // lower the total and make a reverted purge read as a success.
    const copiesAfterOp = this.guildBankCopiesOf(guildId, removedSlot);
    try {
      await this.saveCharacter(carrier);
    } catch (err) {
      // The live book is purged and the dirty mark survives, so a later save
      // still converges; the operator is told it did not land YET, which is the
      // honest answer to "is this guild disbandable now".
      console.error(`guild bank admin purge save failed for guild ${guildId}:`, err);
      return { ok: false, reason: 'save_failed' };
    }
    // A fence-out inside that save reverts (or reloads away) the removal, so
    // confirm against live state rather than trusting the call returned. The
    // witness is THIS COPY (item id, craft provenance, instance payload), not
    // the book's total item count: totals move for reasons that have nothing to
    // do with this purge, and a concurrent withdraw of another item would then
    // make a REVERTED purge look like a success, which is the one direction a
    // destructive tool must never err in. A concurrent deposit of an identical
    // copy can still make this read conservative (reporting save_failed on a
    // purge that did land); erring toward "go and check" is the right way round.
    const copiesNow = this.guildBankCopiesOf(guildId, removedSlot);
    if (copiesAfterOp === null || copiesNow === null || copiesNow > copiesAfterOp) {
      console.error(
        `guild bank admin purge for guild ${guildId} did not survive its escrow save (fence-out or reload)`,
      );
      return { ok: false, reason: 'save_failed' };
    }
    console.warn(
      `guild bank admin purge: account ${actorAccountId} removed ${removed.count}x ${removed.itemId} from guild ${guildId} (carried by character ${carrier.characterId})`,
    );
    return { ok: true, removed, carrierCharacterId: carrier.characterId };
  }

  /** How many copies of ONE specific slot identity (item id, craft provenance,
   *  and instance payload) a guild's live book holds, or null when no book is
   *  loaded. The durability witness for the operator purge: it answers "is THIS
   *  copy still gone", which a total item count cannot.
   *
   *  Both sides of the comparison are LIVE book reads, so structural payload
   *  equality is the right predicate here; the JSON-shaped canonical form in
   *  src/sim/guild_bank.ts exists for the live-vs-DURABLE comparison instead. */
  private guildBankCopiesOf(guildId: number, slot: InvSlot): number | null {
    const info = this.sim.guildBankInfoForGuild(guildId);
    if (info === null) return null;
    let copies = 0;
    for (const held of info.slots) {
      if (held.itemId !== slot.itemId) continue;
      if ((held.craftedRecipeId ?? null) !== (slot.craftedRecipeId ?? null)) continue;
      if (!itemInstancePayloadsEqual(held.instance, slot.instance)) continue;
      copies += held.count;
    }
    return copies;
  }

  /** A live session that can carry guild `guildId`'s book into a fenced escrow
   *  save: an officer-plus member first (the rank that already moves this book
   *  every day), else any member. Null when nobody from the guild is online.
   *
   *  Membership comes from a FRESH database read, not the session stamp. The
   *  stamp can lag a kick or a leave, and carrying is NOT a free favour: if the
   *  escrow save is refused, the carrier's session is QUARANTINED and
   *  DISCONNECTED (the rollback arm), so a stale stamp would put a player who
   *  is no longer even a member of the guild on a rollback-and-kick path for an
   *  operator's act. One indexed read per operator purge is the right price for
   *  that. A read failure answers null (fail closed: no carrier, no purge)
   *  rather than falling back to the stamp.
   *
   *  Which BOOK gets flushed does not depend on this choice: the flush is
   *  driven by the session's own `dirtyGuildBanks` mark, which runGuildBankOp
   *  set for the target guild. The carrier only lends its escrow transaction;
   *  it is never charged, credited, or named as the actor. */
  private async guildBankSaveCarrier(guildId: number): Promise<ClientSession | null> {
    let rankByCharacterId: Map<number, GuildRank>;
    try {
      const members = await this.socialDb.guildMembers(guildId);
      rankByCharacterId = new Map(members.map((m) => [m.id, m.rank]));
    } catch (err) {
      console.error(`guild bank carrier lookup failed for guild ${guildId}:`, err);
      return null;
    }
    let fallback: ClientSession | null = null;
    for (const session of this.sessionsByCharacterId.values()) {
      const rank = rankByCharacterId.get(session.characterId);
      if (rank === undefined) continue;
      if (rank === 'leader' || rank === 'officer') return session;
      fallback ??= session;
    }
    return fallback;
  }

  async loadRifts(): Promise<void> {
    try {
      loadRiftWorldState(this.sim.ctx, await loadRiftState(), Date.now());
    } catch (err) {
      console.error('failed to load shared Rift state:', err);
    }
  }

  private async persistRifts(): Promise<void> {
    await this.enqueueRiftWrite(() =>
      saveRiftState(serializeRiftWorldState(this.sim.ctx, Date.now())),
    );
  }

  async saveRifts(): Promise<void> {
    try {
      await this.persistRifts();
    } catch (err) {
      console.error('failed to save shared Rift state:', err);
    }
  }

  rekeyMarketSeller(characterId: number, oldName: string, newName: string): boolean {
    return this.sim.rekeyMarketSeller(characterId, oldName, newName);
  }

  rekeyMailOwner(characterId: number, oldName: string, newName: string): boolean {
    return this.sim.rekeyMailOwner(characterId, oldName, newName);
  }

  // Character deletion (R43): the purge runs against the LIVE books, never the
  // persisted blobs alone. flushPeriodicSaves re-persists this in-memory market
  // and mail every AUTOSAVE_SECONDS, so a blob-only edit would be clobbered
  // within half a minute; the caller follows these with saveMarket/saveMail so
  // the purge reaches Postgres through the same serial writer.
  purgeMarketSeller(characterId: number, name: string): boolean {
    return this.sim.purgeMarketSeller(characterId, name);
  }

  purgeMailOwner(characterId: number, name: string): boolean {
    return this.sim.purgeMailOwner(characterId, name);
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
        ` | visits=${this.bcVisits} serializes=${this.bcSerializes} baseSerializes=${this.bcBaseSerializes} serializeMs=${round2(Number(this.bcSerializeNs) / 1e6)} timerVariants=${this.bcLegacySerializes}/${this.bcStableSerializes} aggroVisits=${this.mobScanTickStats.lastAggroScanVisits} threatVisits=${this.mobScanTickStats.lastThreatEntryVisits}`,
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
      const zone = dungeon
        ? zoneAt(dungeon.doorPos.x, dungeon.doorPos.z)
        : zoneAt(e.pos.x, e.pos.z);
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
      const zone = delve ? zoneAt(delve.doorPos.x, delve.doorPos.z) : zoneAt(e.pos.x, e.pos.z);
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

    const zone = zoneAt(e.pos.x, e.pos.z);
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

  // Force-close every live session for the account. A bearer token is a reusable
  // wire credential, not a per-socket identity: an earlier revision tried to spare
  // the caller's own session by comparing the live socket's auth token against the
  // request's bearer token, but a stolen/shared token authenticates identically on
  // both, so that comparison could just as easily spare an attacker's connection.
  // Kick unconditionally; a legitimate caller's own other tab reconnects with the
  // fresh credentials the same as any other client would.
  disconnectAccount(accountId: number, reason: string): void {
    for (const session of [...this.clients.values()]) {
      if (session.accountId !== accountId) continue;
      void this.kickSession(session, reason, 'moderation action');
    }
  }

  // R35 GM professions tooling: a fresh serializeCharacter of a LIVE
  // character (the stored blob lags the 30s autosave), or null when the
  // character is not online on this realm process (the liveLevelForCharacter
  // idiom above).
  adminCharacterState(characterId: number): CharacterState | null {
    const session = this.sessionByCharacterId(characterId);
    return session ? this.sim.serializeCharacter(session.pid) : null;
  }

  // R35: the cheap online predicate the restore pre-checks use. A full
  // serializeCharacter as an online test is synchronous game-loop work
  // thrown away; the inspector alone needs the snapshot.
  adminCharacterOnline(characterId: number): boolean {
    return this.sessionByCharacterId(characterId) !== null;
  }

  // R35 GM restore: mint a lost item back onto a LIVE character through the
  // sim's normal grant hub (grants reaching addItem always land). The count
  // is re-clamped defensively even though the admin handler validates it
  // (the dev_give 1..20 clamp); EVERY non-integer (NaN and finite fractions
  // alike) clamps to 1, deliberately stricter than a Math.floor would be,
  // because a non-integer here means the validator was bypassed.
  adminRestoreItem(
    characterId: number,
    itemId: string,
    count: number,
  ): 'ok' | 'offline' | 'invalid_item' {
    const session = this.sessionByCharacterId(characterId);
    if (!session) return 'offline';
    if (!Object.hasOwn(ITEMS, itemId)) return 'invalid_item';
    const clamped = Number.isInteger(count)
      ? Math.max(1, Math.min(RESTORE_ITEM_MAX_COUNT, count))
      : 1;
    this.sim.addItem(itemId, clamped, session.pid);
    // Close the audit-durability window: the audit row is already committed,
    // so the grant must not wait up to AUTOSAVE_SECONDS to become durable (a
    // crash inside that window would leave a row for a grant that vanished).
    // Fire-and-forget, the deed-unlock durability pattern. A fenced-out save
    // (same-account takeover rotated the lease) resolves false without
    // throwing: the audited grant died with the displaced session's memory,
    // so say so loudly instead of letting the generic fence warn swallow it.
    void this.saveCharacter(session)
      .then((landed) => {
        if (!landed) {
          console.error(
            `restore-item for ${session.name}: audited grant did not persist (save fenced by a same-account takeover); re-check via the inspector and re-issue if missing`,
          );
        }
      })
      .catch((err) => console.error(`restore-item save failed for ${session.name}:`, err));
    return 'ok';
  }

  // R35 GM restore: re-mint a lost tool-effect slot row on a LIVE character.
  // The sim action owns validation, tool-rarity charge sizing, and the
  // success event the player sees; it is server-admin-only by design (the
  // free-grant incident), so this runtime method is its ONLY caller.
  adminRestoreToolEffectSlot(
    characterId: number,
    professionId: string,
    effectId: string,
  ): 'ok' | 'offline' | 'invalid_request' | 'no_tool' | 'already_slotted' {
    const session = this.sessionByCharacterId(characterId);
    if (!session) return 'offline';
    const result = restoreToolEffectSlotAction(this.sim.ctx, professionId, effectId, session.pid);
    if (result === 'ok') {
      // Same audit-durability and fence-visibility reasoning as
      // adminRestoreItem above.
      void this.saveCharacter(session)
        .then((landed) => {
          if (!landed) {
            console.error(
              `restore-slot for ${session.name}: audited grant did not persist (save fenced by a same-account takeover); re-check via the inspector and re-issue if missing`,
            );
          }
        })
        .catch((err) => console.error(`restore-slot save failed for ${session.name}:`, err));
    }
    return result;
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
    // beginShutdown flips this before its cancellation sweep. Buffered frames
    // must not mutate gameplay after that point or create an unstuck attempt
    // that can neither tick nor be included in the shutdown snapshot.
    if (this.draining) return;
    gameMetricsCounters().wsMessage('in');
    const receivedAtMs = Date.now();
    const gate = consumeInboundFrame(session.msgRate, receivedAtMs / 1000, raw.length);
    if (gate.verdict !== 'allow') {
      // R8: the loss is visible by cause. A kick verdict is the crossing drop
      // plus the kick, so it counts under both counters.
      gameMetricsCounters().wsMessageDropped(gate.cause);
      if (gate.verdict === 'kick') {
        gameMetricsCounters().wsRateKick();
        void this.kickSession(session, MSG_RATE_KICK_REASON, 'message flood');
      }
      return;
    }
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
    const cmd = this.messageCommand(msg);
    // Economy telemetry: sample the acting player's copper across this one
    // dispatch, so a command's own credit or debit is attributed to its
    // economic surface with no sim-side signal and no gameplay effect. Two
    // O(1) map reads, and the 20 Hz movement lane is skipped outright since an
    // input frame can never move copper. The skip reads isInputFrame, NOT
    // cmd === 'input': messageCommand reports `cmd` first, so a frame of
    // {"t":"input","cmd":"x"} is dispatched as movement while reporting a
    // different name. Sampled AFTER the catch as well as the happy path: a
    // command that threw halfway may still have moved coin.
    const copperBefore = this.isInputFrame(msg) ? undefined : this.sim.meta(session.pid)?.copper;
    // a malformed payload must never take down the server for everyone
    try {
      this.dispatchMessage(session, msg, raw, receivedAtMs);
    } catch (err) {
      console.error(`bad message from ${session.name} (cmd: ${cmd}):`, err);
    }
    if (copperBefore !== undefined) this.recordCopperFlow(session, cmd, copperBefore);
  }

  /**
   * Book the acting player's copper delta from one command dispatch onto the
   * bounded-cardinality flow counters. Deliberately NOT a complete ledger, in
   * two ways. A credit that lands on a THIRD party (a party fair-split to a
   * non-acting looter) is never booked at all, having no dispatch of its own to
   * attribute it to. A tick-driven payout to the acting player is worse than
   * unbooked: it lands between two dispatches and is then MISATTRIBUTED to
   * whichever command happens to be sampled next. Operators read these series
   * as per-surface trend, never as a sum that reconciles against total coin in
   * the world. server/economy_telemetry.ts carries the same warning.
   */
  private recordCopperFlow(session: ClientSession, command: string, before: number): void {
    // A session that left during its own dispatch (logout) has no meta to read
    // back; skip rather than book a phantom drain of the player's whole purse.
    const after = this.sim.meta(session.pid)?.copper;
    if (after === undefined || after === before) return;
    const source = copperFlowSourceForCommand(command);
    if (after > before) gameMetricsCounters().copperCredited(source, after - before);
    else gameMetricsCounters().copperSpent(source, before - after);
  }

  private messageCommand(msg: unknown): string {
    if (typeof msg !== 'object' || msg === null || Array.isArray(msg)) return 'unknown';
    const record = msg as Record<string, unknown>;
    // TOTAL BY CONSTRUCTION, no coercion. `cmd` and `t` are client-supplied, and
    // String() THROWS on an object whose toString is not callable, so a frame of
    // {"cmd":{"toString":1}} used to die here. This runs outside the
    // malformed-payload try in handleMessage, so a throw would escape the very
    // guard that exists to keep one bad frame from reaching the process handler,
    // taking the anomaly observation and the command-lane token down with it.
    const raw = record.cmd ?? record.t;
    return typeof raw === 'string' ? raw : 'unknown';
  }

  /** True for a movement frame, keyed on the SAME field dispatchMessage routes
   *  movement on (`t`), never on the `cmd`-first name messageCommand reports: a
   *  frame of {"t":"input","cmd":"x"} is dispatched as movement, so anything
   *  that skips work for the 20 Hz lane has to agree with the dispatcher. */
  private isInputFrame(msg: unknown): boolean {
    if (typeof msg !== 'object' || msg === null || Array.isArray(msg)) return false;
    return (msg as Record<string, unknown>).t === 'input';
  }

  /** Draw a post-parse lane token (R5). On a drop the frame is discarded,
   *  never queued, and the drop tallies into the same per-second abuse window
   *  as the pre-parse gate (R6), so a sustained lane flood reaches the kick
   *  verdict through the identical path. Returns whether to keep processing. */
  private consumeLane(session: ClientSession, lane: MsgLane, nowSec: number): boolean {
    if (consumeLaneToken(session.msgLanes, lane, nowSec) === 'allow') return true;
    gameMetricsCounters().wsMessageDropped(LANE_DROP_CAUSE[lane]);
    if (tallyDrop(session.msgRate, nowSec) === 'kick') {
      gameMetricsCounters().wsRateKick();
      void this.kickSession(session, MSG_RATE_KICK_REASON, 'message flood');
    }
    return false;
  }

  /** Draw a list-read guard token (the phase 06 maintainer ruling): the
   *  ignore/block list readouts stay chat-token-free per R5, but each is a
   *  live DB read, so a refusal above the far-above-human budget drops the
   *  readout and tallies into the same abuse window as every other shed
   *  frame, making a sustained read flood kickable. Returns whether to run
   *  the readout. */
  private consumeListRead(session: ClientSession, nowSec: number): boolean {
    if (consumeListReadToken(session.listReadGuard, nowSec)) return true;
    gameMetricsCounters().wsMessageDropped('list_read');
    if (tallyDrop(session.msgRate, nowSec) === 'kick') {
      gameMetricsCounters().wsRateKick();
      void this.kickSession(session, MSG_RATE_KICK_REASON, 'message flood');
    }
    return false;
  }

  /** Draw a guild-bank op guard token (Guild Bank Phase 3 QA): every allowed
   *  op can write a keep-forever bank_ledger row, so ops above the
   *  far-above-human budget are dropped and tally into the same abuse window
   *  as every other shed frame, making a sustained ledger-write flood
   *  kickable. Returns whether to run the op. */
  private consumeGuildBankOp(session: ClientSession, nowSec: number): boolean {
    if (consumeGuildBankOpToken(session.guildBankOpGuard, nowSec)) return true;
    gameMetricsCounters().wsMessageDropped('guild_bank');
    if (tallyDrop(session.msgRate, nowSec) === 'kick') {
      gameMetricsCounters().wsRateKick();
      void this.kickSession(session, MSG_RATE_KICK_REASON, 'message flood');
    }
    return false;
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
      // Garbage draws a command-lane token AFTER its anomaly observation (R5):
      // the lane bounds sub-ceiling garbage without muting the anomaly channel.
      this.consumeLane(session, 'command', receivedAtMs / 1000);
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
      // The movement lane verdicts at the top of the arm, before the sim
      // moveInput assignment and before observeInput (R5): a dropped movement
      // frame reaches neither the sim nor the detector, which is FP-safe
      // because input_absence only counts input frames toward ACTIVE time.
      if (!this.consumeLane(session, 'movement', receivedAtMs / 1000)) return;
      if (session.spectating) return;
      const meta = sim.meta(pid);
      const e = sim.entities.get(pid);
      if (!meta || !e) return;
      const frame = parseMoveInputFrame(msg);
      Object.assign(meta.moveInput, frame.moveInput);
      session.lastInputAt = sim.time;
      if (typeof msg.seq === 'number' && Number.isFinite(msg.seq) && msg.seq > 0) {
        const seq = Math.floor(msg.seq);
        // R9: the client seq is a per-send increment on an ordered socket, so
        // a forward jump past lastInputSeq + 1 proves the missing seqs were
        // sent and never processed (the input-frame-attributed share of the
        // server's own drops). Guarded to a positive high-water because resume
        // zeroes it while the client restarts its counter on reconnect, and
        // capped so a reset mismatch never books a giant gap.
        if (session.lastInputSeq > 0 && seq > session.lastInputSeq + 1) {
          gameMetricsCounters().wsInputSeqGap(
            Math.min(seq - session.lastInputSeq - 1, MSG_SEQ_GAP_SANITY),
          );
        }
        session.lastInputSeq = Math.max(session.lastInputSeq, seq);
      }
      // A released spirit turns with the camera like the living; only a corpse that
      // has not yet released (dead and not a ghost) keeps its facing frozen. Without
      // this the server drops the ghost's mouselook facing and its run feels inverted.
      // A stun locks facing too (issue #2426): the offline kernel already blocks its
      // own turnLeft/turnRight (player_motion.ts), but mouselook facing streams in on
      // this out-of-band channel and must be rejected here, the authoritative side,
      // not trusted to a client that could simply keep sending it.
      if (frame.facing !== null && (!e.dead || e.ghost) && !isStunned(e)) {
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
      // Same rule as non_object above: anomaly first, then the command lane.
      this.consumeLane(session, 'command', receivedAtMs / 1000);
      return;
    }
    if (session.spectating) {
      if (msg.cmd === 'unstuck') {
        this.sendUnstuckBlocked(session, 'spectating');
        return;
      }
      if (msg.cmd !== 'chat' || typeof msg.text !== 'string') return;
      const text = msg.text.trim();
      // Staff moderation rides the chat case but is COMMAND work (target
      // resolution plus an audited DB write per action), so a claimed
      // moderation text pays the command lane exactly like /unstuck below
      // it; a lane-refused frame is dropped whole and tallies toward the
      // flood-kick verdict (the /unstuck audit finding's sibling).
      if (canAttemptModerationCommands(session) && parseModerationChatCommand(text)) {
        if (!this.consumeLane(session, 'command', receivedAtMs / 1000)) return;
        this.moderation.handleChatCommand(session, text);
        return;
      }
      if (/^\/unstuck\s*$/i.test(text)) {
        this.sendUnstuckBlocked(session, 'spectating');
        return;
      }
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
    // The command lane verdicts AFTER observeCommand (R5, observe-then-drop):
    // the detector keeps seeing the traffic shape even when the handler never
    // runs. Chat draws from its own lane beside consumeChatToken; telemetry
    // and challengeResponse are exempt; an unknown cmd draws in the default
    // arm below, after its protocol-anomaly observation. It also verdicts
    // BEFORE the jailed notice and the HEAVY_SELF_CMDS dirty flag below: a
    // lane-dropped frame must neither send a jailed notice nor force a heavy
    // self re-diff (drops are drops).
    if (
      classifyMsgLane(msg) === 'command' &&
      KNOWN_COMMANDS.has(String(msg.cmd)) &&
      !this.consumeLane(session, 'command', receivedAtMs / 1000)
    ) {
      return;
    }
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
      if (msg.cmd === 'unstuck') this.sendUnstuckBlocked(session, 'jailed');
      else this.sendChatNotice(session, 'You cannot do that while jailed.');
      this.sendCommandOutcome(session, msg, false);
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
        if (typeof msg.ability === 'string') {
          // Optional mouseover-cast override: an explicit friendly-target id.
          // The sim validates it (friendly, alive, in range) and falls back to
          // the classic current-target-else-self resolution when invalid.
          if (typeof msg.target === 'number') {
            sim.castAbilityOn(msg.ability, msg.target | 0, pid);
          } else {
            sim.castAbility(msg.ability, pid);
          }
        }
        break;
      case 'releaseEmpowered':
        if (typeof msg.ability === 'string') sim.releaseEmpoweredAbility(msg.ability, pid);
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
      case 'stopAutoAttackOnTargetSwitch':
        sim.setStopAutoAttackOnTargetSwitch(!!msg.enabled, pid);
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
        this.sendCommandOutcome(
          session,
          msg,
          typeof msg.id === 'number' && sim.lootCorpse(msg.id, pid),
        );
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
        this.sendCommandOutcome(
          session,
          msg,
          typeof msg.id === 'number' && sim.pickUpObject(msg.id, pid),
        );
        break;
      case 'accept':
        if (typeof msg.quest === 'string') {
          sim.acceptQuest(
            msg.quest,
            typeof msg.selection === 'string' ? msg.selection : undefined,
            pid,
          );
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
            typeof msg.slot === 'string' && isEquipSlot(msg.slot) ? msg.slot : undefined;
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
        if (typeof msg.slot === 'string' && isEquipSlot(msg.slot)) {
          sim.unequipItem(msg.slot, pid);
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
        // The options bag third, pid fourth (the one explicit shape; see
        // Sim.buyItem). A non-number count is dropped like sell's, a hostile
        // number reaches the sim's sanitize and denies there.
        if (typeof msg.npc === 'number' && typeof msg.item === 'string')
          sim.buyItem(
            msg.npc,
            msg.item,
            {
              count: typeof msg.count === 'number' ? msg.count : undefined,
              bulk: msg.bulk === true,
            },
            pid,
          );
        break;
      case 'sell':
        if (typeof msg.item === 'string') {
          sim.sellItem(msg.item, typeof msg.count === 'number' ? msg.count : undefined, pid);
        }
        break;
      case 'buyback':
        if (typeof msg.item === 'string')
          sim.buyBackItem(
            msg.item,
            typeof msg.index === 'number' ? msg.index : undefined,
            msg.instance && typeof msg.instance === 'object' ? msg.instance : undefined,
            pid,
            typeof msg.craftedRecipeId === 'string' ? msg.craftedRecipeId : undefined,
          );
        break;
      case 'harvest_node':
        // `confirmUse` (R40): strict boolean-true, the `commission` idiom; a
        // missing or malformed flag reads unconfirmed, the fail-safe arm (a
        // 'prompt' slot skips its effect and keeps the charge).
        this.sendCommandOutcome(
          session,
          msg,
          typeof msg.node === 'string' && sim.harvestNode(msg.node, msg.confirmUse === true, pid),
        );
        break;
      case 'craft_item':
        // `commission` (Professions 2.0): a strict boolean-true
        // check (the dispatch type-guard rule); anything else reads as false.
        // The sim honors it only for eligible equipment outputs and mints the
        // bindOnTrade arm itself, so nothing here trusts client data.
        if (typeof msg.recipe === 'string') sim.craftItem(msg.recipe, msg.commission === true, pid);
        break;
      // Enchanting profession commands (Professions 2.0): the sim
      // resolvers re-validate ownership/eligibility/throttle (nothing trusted
      // from the client); the outcome reaches this client as the pid-scoped
      // disenchantResult/enchantResult/salvageResult event plus the denc/ench/salv
      // self-delta. A successful disenchant/salvage, and a bagged apply, emit a
      // `loot` event (a HEAVY_SELF_EVENTS member) via the inventory hub, so the self
      // inventory refreshes exactly like a craft; no explicit dirty-marking is needed
      // here. The WORN apply arm mints nothing and so emits no loot event, which is
      // why `enchantResult` is itself a HEAVY_SELF_EVENTS member (the unbindResult
      // precedent): otherwise the spent reagents would linger in the bag mirror.
      case 'disenchant_item':
        if (typeof msg.item === 'string') {
          const slot = Number.isInteger(msg.slot) ? Number(msg.slot) : undefined;
          sim.disenchantItem(msg.item, pid, slot);
        }
        break;
      case 'apply_enchant':
        if (typeof msg.item === 'string' && typeof msg.enchant === 'string') {
          // The optional worn target (the in-place enchant arm) is accepted only
          // when it names a real equipment key, the same untrusted-input rule the
          // 'equip' case above applies to its aimed slot; anything else falls back
          // to undefined, which is the bagged arm. The sim then re-validates that
          // the named slot is actually wearing this item id and, without the
          // confirm flag below, that the worn copy is not already enchanted.
          const worn = typeof msg.slot === 'string' && isEquipSlot(msg.slot) ? msg.slot : undefined;
          // `confirm` (#2415): the explicit consent to replace an existing
          // enchant. A strict boolean-true check (the dispatch type-guard
          // rule, the craft_item `commission` precedent); anything else reads
          // as false. The sim re-validates the target and picks the pinned
          // victim itself, so nothing here trusts client data: the flag can
          // only ever unlock the dedicated replace arm, never aim it.
          // Note the two tokens are independent: an unrecognized `slot` falls
          // back to undefined ABOVE, so a hand-crafted {slot: bogus, confirm:
          // true} becomes a confirmed BAGGED replace rather than being
          // rejected. Harmless by construction (the victim is still the sim's
          // own pin over the SENDER's inventory, so the worst case is that
          // sender destroying one of their own enchants), and an honest client
          // never emits an invalid slot.
          sim.applyEnchant(msg.item, msg.enchant, worn, msg.confirm === true, pid);
        }
        break;
      case 'salvage_item':
        if (typeof msg.item === 'string') sim.salvageItem(msg.item, pid);
        break;
      case 'unbind_item':
        // Maker's Bond unbind service (Professions 2.0): the sim
        // resolver re-validates eligibility/bound-ness/station range/fee
        // (nothing trusted from the client); the outcome reaches this client
        // as the pid-scoped text-free unbindResult event, a HEAVY_SELF_EVENTS
        // member so the cleared payload and the fee debit re-diff the self
        // inv/purse mirrors on the next snapshot.
        if (typeof msg.item === 'string') sim.unbindItem(msg.item, pid);
        break;
      // Commission order board (Professions 2.0, issue #1298): the sim
      // resolvers re-validate every field (recipe/eligibility/scope/state/
      // range/space, nothing trusted from the client); the outcome reaches
      // this client as the pid-scoped text-free commissionOrderResult event,
      // a HEAVY_SELF_EVENTS member so a delivery's bag change re-diffs the
      // crafter's own inv mirror on the next snapshot (the requester's side
      // rides the ordinary addItemInstance loot event). The durable order
      // list itself converges through the per-tick `corder` self-delta for
      // every affected viewer, not through this event.
      case 'open_commission_order':
        if (typeof msg.recipe === 'string' && (msg.scope === 'open' || msg.scope === 'crafter')) {
          sim.openCommissionOrder(
            msg.recipe,
            msg.scope,
            typeof msg.crafter === 'string' ? msg.crafter : undefined,
            pid,
          );
        }
        break;
      case 'cancel_commission_order':
        if (typeof msg.order === 'number') sim.cancelCommissionOrder(msg.order, pid);
        break;
      case 'accept_commission_order':
        if (typeof msg.order === 'number') sim.acceptCommissionOrder(msg.order, pid);
        break;
      case 'deliver_commission_order':
        if (typeof msg.order === 'number') sim.deliverCommissionOrder(msg.order, pid);
        break;
      case 'rift_upgrade_item':
        if (typeof msg.item === 'string') sim.upgradeRiftItem(msg.item, pid);
        break;
      case 'rift_enchant_item':
        if (typeof msg.item === 'string' && typeof msg.stat === 'string') {
          sim.enchantRiftItem(msg.item, msg.stat, pid);
        }
        break;
      case 'rift_socket_gem':
        if (typeof msg.item === 'string' && typeof msg.gem === 'string') {
          sim.socketRiftGem(msg.item, msg.gem, pid);
        }
        break;
      case 'place_mobile_station':
        if (typeof msg.craft === 'string') sim.placeMobileStation(msg.craft, pid);
        break;
      case 'train_recipe':
        // Professions 2.0: fee + grant resolve inside the sim
        // (Sim.trainRecipe -> professions/training.ts resolveTrain); the
        // outcome reaches this client as the pid-scoped trainResult event and
        // the learned set rides the per-tick cprof diff (knownRecipes is part
        // of craftingIdentityFor's JSON), so no dirty-marking is needed here.
        if (typeof msg.recipe === 'string') sim.trainRecipe(msg.recipe, pid);
        break;
      case 'slot_tool_effect':
        // UNGATED since the acquisition craft shipped: slotting now consumes
        // a crafted charm from the sender's own bags through
        // resolveSlotToolEffect (the one mint authority), so the command is
        // no longer its own acquisition path (the dev gate that closed the
        // free-grant incident retired with the free grant itself). Every
        // refusal answers with the pid-scoped text-free toolEffectResult
        // event, a HEAVY_SELF_EVENTS member, so the consumed charm re-diffs
        // the self inventory mirror on the next snapshot.
        //
        // `mode` is passed THROUGH unchanged rather than normalized here: the
        // sim's guard is the single definition of what a legal mode is, and
        // laundering an unrecognized value into `undefined` would hand it the
        // default and turn a refusal into a success (the two hosts would then
        // disagree about the same message). The cast names the sim's own
        // union rather than `never` so the compiler keeps tracking the
        // parameter type; the runtime pass-through is identical.
        if (typeof msg.profession === 'string' && typeof msg.effect === 'string') {
          sim.slotToolEffect(msg.profession, msg.effect, msg.mode as ToolEffectConfirmMode, pid);
        }
        break;
      case 'recharge_tool_effect':
        // The R39/R30 recharge: owner-performed, priced sim-side off the
        // sender's own bags and slot (nothing trusted from the frame), the
        // outcome carried by the same toolEffectResult event as the slot.
        if (typeof msg.profession === 'string') {
          sim.rechargeToolEffect(msg.profession, pid);
        }
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
      // Rideable mounts: the Sim re-validates everything (catalog key, level
      // gate, combat gate); the entity mirror + self `mnt` field carry the result.
      case 'mount_toggle':
        sim.toggleMountFor(pid);
        break;
      // Riding lesson: the Sim re-validates everything (level, range, quest
      // state, fee, session state).
      case 'mount_train_begin':
        sim.mountTrainBeginFor(pid);
        break;
      case 'mount_train_answer':
        // Deprecated no-op (the removed lean-cue lesson's answer command). The
        // token stays in COMMAND_NAMES (append-only, dispatch-only); the server
        // ignores it and a modern client never sends it.
        break;
      case 'mount_train_abort':
        // Dispatch-only (no HUD sends it anymore): abandons an active lesson,
        // the fee stays paid.
        sim.mountTrainAbortFor(pid);
        break;
      // Riding skill purchase: player buys Riding from Marla for 80g. The Sim
      // re-validates NPC identity, range, level, and funds.
      case 'learn_riding':
        if (typeof msg.npc === 'number' && Number.isInteger(msg.npc))
          sim.learnRidingFor(msg.npc, pid);
        break;
      // Show-jumping race: the Sim re-validates the glowing platform, lesson or
      // mount eligibility, and liveness before arming the countdown.
      case 'mount_race_start':
        sim.mountRaceStartFor(pid);
        break;
      case 'mount_race_cancel':
        sim.mountRaceCancelFor(pid);
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
      // Per-character action-bar layout upload (untrusted client input). Validate
      // + bound the payload; a malformed/oversized layout is dropped silently
      // (never crashes the session). A clean layout is persisted to the
      // character's own JSONB column via the per-character FIFO save queue.
      case 'save_hotbar_layout': {
        const layout = sanitizeActionBarLayout(msg.layout);
        if (layout) this.enqueueHotbarLayoutSave(session.characterId, layout);
        break;
      }
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
      case 'unstuck':
        sim.unstuck(pid);
        break;
      case 'resurrect_corpse':
        sim.resurrectAtCorpse(pid);
        break;
      case 'resurrect_healer':
        this.sendCommandOutcome(session, msg, sim.resurrectAtSpiritHealer(pid));
        break;
      case 'resurrect_respond':
        if (typeof msg.accept === 'boolean') sim.respondToResurrection(msg.accept, pid);
        break;
      case 'challengeResponse':
        if (typeof msg.n === 'string' && typeof msg.r === 'string' && typeof msg.sig === 'string') {
          if (!verifyChallenge(msg.n, msg.r, msg.sig, session.clientSeed)) break;
        }
        break;
      case 'chat': {
        if (typeof msg.text !== 'string') break;
        const text = msg.text.trim();
        // Staff moderation is COMMAND work riding the chat case (target
        // resolution plus an audited DB write per action): a claimed
        // moderation text pays the command lane exactly like /unstuck
        // below, so a compromised staff account cannot flood /kick or
        // /ban at wire rate with zero tokens drawn on any lane. The parse
        // predicate claims the SAME texts handleChatCommand claims, so
        // ordinary chat (and /who, /unstuck) never pays this draw.
        if (canAttemptModerationCommands(session) && parseModerationChatCommand(text)) {
          if (!this.consumeLane(session, 'command', receivedAtMs / 1000)) break;
          this.moderation.handleChatCommand(session, text);
          break;
        }
        // Recovery is a gameplay command, not broadcast chat. Keep it usable
        // while muted and outside the chat token bucket, then route through the
        // same authoritative system as the dedicated Settings action. It still
        // pays the COMMAND lane the dedicated action pays: riding the chat
        // case skipped the top-of-dispatch draw (classifyMsgLane says 'chat'),
        // so without this a /unstuck chat frame reached the sim with zero
        // tokens drawn on any lane and never tallied toward the flood-kick
        // verdict (the release-merge audit's finding).
        if (/^\/unstuck\s*$/i.test(text)) {
          if (!this.consumeLane(session, 'command', receivedAtMs / 1000)) break;
          sim.unstuck(pid);
          break;
        }
        // The player's own ignore/block commands. Deliberately BEFORE isChatMuted
        // and the rate limiter: a GM-silenced player must still be able to manage
        // their own lists, and a list readout must not burn a chat token toward
        // the rate-limit cooldown. Deliberately AFTER the moderation router, so
        // the ADMIN "/mute" is always claimed as the account silence and can
        // never be shadowed by a player command. The two list READOUTS carry
        // their own DB-read guard inside (the phase 06 maintainer ruling).
        if (this.handleChatFilterCommand(session, text, receivedAtMs / 1000)) break;
        if (this.isChatMuted(session)) break;
        // The chat lane is a pre-guard CO-LOCATED with the ladder, not at the
        // case entry (R5): the moderation router and the ignore/block/filter
        // management above stay unthrottled, and because the lane is more
        // generous than the ladder, the ladder's cooldown messaging still
        // fires on the subset the lane passes.
        if (!this.consumeLane(session, 'chat', receivedAtMs / 1000)) break;
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
          // A curate-phase roll's candidates are the tapping group's loot-eligible
          // members, so a full raid roster is the most an honest client can check
          // (#2524). Over cap the frame is rejected outright, the way the other
          // capped cases here reject theirs, rather than truncated to a selection
          // the master looter never made. Tested BEFORE the element scan so the
          // per-element work is bounded too; the Sim re-validates every pid.
          // Never tighten this below the honest ceiling: the reject path is
          // silent, so a cap a real roster can exceed would not fail visibly, it
          // would livelock the looter against the #2526 regrace (the row clears,
          // returns after the grace, and re-sending is dropped again).
          msg.pids.length <= RAID_MAX &&
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
      case 'pet_water_jet':
        sim.petWaterJet(pid);
        break;
      case 'pet_taunt':
        sim.petTaunt(pid);
        break;
      case 'pet_auto_taunt':
        if (typeof msg.enabled === 'boolean') sim.setPetAutoTaunt(msg.enabled, pid);
        break;
      case 'pet_auto_water_jet':
        if (typeof msg.enabled === 'boolean') sim.setPetAutoWaterJet(msg.enabled, pid);
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
        if (typeof msg.name === 'string') {
          // The creation-fee gate, BEFORE any DB work (Guild Bank Phase 3):
          // a founder whose sim purse cannot cover GUILD_CREATION_FEE_COPPER
          // is refused right here, so a refused create never touches the
          // database. RESERVE-AT-GATE (Phase 3 QA, revising the original
          // create-then-charge decision in state.md): the fee is deducted
          // SYNCHRONOUSLY here, in the same tick as the gate check, and
          // refunded on every refusal arm (guildCreate returning false) or
          // error. Charging after the commit left a deterministic exploit: a
          // client could pipeline guild_create with a spend so the deferred
          // clamped charge collected residue, or log out before the commit
          // and pay nothing. A crash between this reserve and the commit
          // loses at most the fee for at most one autosave window, the
          // deliberate trade. The English literal is re-localized client-side
          // (src/ui/server_i18n.ts guild.createFee, pinned byte-for-byte in
          // tests/server_i18n.test.ts).
          const meta = this.sim.meta(pid);
          if (!meta || meta.copper < GUILD_CREATION_FEE_COPPER) {
            this.sendChatNotice(
              session,
              `You need ${GUILD_CREATION_FEE_GOLD} gold to found a guild.`,
            );
            break;
          }
          // At most one reservation per character: a pipelined second create
          // while one is in flight is dropped (the double-click race), so the
          // success/refund arms can never mismatch reservations.
          if (this.pendingGuildCreateFees.has(session.characterId)) break;
          const purseBefore = meta.copper;
          const charged = this.sim.chargeGuildCreationFeeFor(pid);
          // What the PURSE actually did, read back from the sim rather than
          // inferred from `charged`: the create_fee row records both, so a
          // charge the sim reported taking that the purse never gave up is a
          // finding instead of an arithmetic identity.
          const pursePaid = (this.sim.meta(pid)?.copper ?? purseBefore) - purseBefore;
          if (charged < GUILD_CREATION_FEE_COPPER) {
            // The purse check above passed but the charge came back short: the
            // pid resolved meta-only (no live entity) or a state edge. Never
            // found a discounted or free guild: return whatever was taken and
            // refuse with the same line.
            if (charged > 0) this.sim.refundGuildCreationFeeFor(pid, charged);
            this.sendChatNotice(
              session,
              `You need ${GUILD_CREATION_FEE_GOLD} gold to found a guild.`,
            );
            break;
          }
          this.pendingGuildCreateFees.set(session.characterId, {
            accountId: session.accountId,
            amount: charged,
            pursePaid,
          });
          void this.social
            .guildCreate(this.actorFor(session), msg.name)
            .then((created) => {
              if (!created) this.refundGuildCreateFee(session.characterId);
            })
            .catch((err) => {
              logSocialErr(err);
              this.refundGuildCreateFee(session.characterId);
            });
        }
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
      case 'guild_set_motd':
        // Guild billboard: player text, so it flows through the same mute +
        // rate + hard-word gates as chat (the guild_event_create stack) before
        // the service applies its own officer/clamp validation.
        if (typeof msg.text === 'string') {
          if (this.isChatMuted(session)) break;
          if (!this.consumeChatToken(session)) break;
          if (this.enforceChatPolicy(session, msg.text)) break;
          void this.social.guildSetMotd(this.actorFor(session), msg.text).catch(logSocialErr);
        }
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
        // ARENA_WIRE_HZ throttles the `arena` self key to once per 10s (the
        // #940 perf fix for the uncached arenaLadder() sort), so without this
        // the Arena window would keep showing the stale Queue button for up to
        // 10s after the player just clicked it. Force the next snapshot to
        // carry fresh arenaInfo, same reset used at the spectate transitions.
        session.lastArenaWireTick = -ARENA_WIRE_INTERVAL_TICKS;
        break;
      }
      case 'arena_leave':
        sim.arenaQueueLeave(pid);
        // Same staleness fix as arena_queue above: surface the cleared queue
        // state immediately instead of on the next throttled tick.
        session.lastArenaWireTick = -ARENA_WIRE_INTERVAL_TICKS;
        break;
      case 'arena_augment': {
        if (typeof msg.augment === 'string' && msg.augment.length <= 64)
          sim.arenaAugmentPick(msg.augment, pid);
        break;
      }

      // Thornhollow Fields (5v5 capture-the-flag). The sim owns every rule; the resets
      // surface the changed queue/match state on the next snapshot instead of
      // the throttled BG_WIRE_HZ tick (the arena staleness fix).
      case 'bg_queue':
        sim.bgQueueJoin(pid);
        session.lastBgWireTick = -BG_WIRE_INTERVAL_TICKS;
        break;
      case 'bg_leave':
        sim.bgQueueLeave(pid);
        session.lastBgWireTick = -BG_WIRE_INTERVAL_TICKS;
        break;
      case 'bg_flag':
        sim.bgFlagAction(pid);
        session.lastBgWireTick = -BG_WIRE_INTERVAL_TICKS;
        break;
      case 'dev_bg_start': {
        if (process.env.ALLOW_DEV_COMMANDS === '1') sim.devStartBg();
        break;
      }

      // Card Duel minigame (the Card Master NPC, docs: src/sim/social/card_duel.ts).
      case 'card_queue_join':
        sim.joinCardDuelQueue(pid);
        break;
      case 'card_queue_leave':
        sim.leaveCardDuelQueue(pid);
        break;
      case 'play_card':
        if (typeof msg.value === 'number' && Number.isInteger(msg.value))
          sim.playCardInDuel(msg.value, pid);
        break;
      case 'card_forfeit':
        sim.forfeitCardDuel(pid);
        break;

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
        const alloc = parseTalentAllocation(msg.alloc);
        if (alloc) sim.applyTalents(alloc, pid);
        break;
      }
      case 'respec':
        sim.respec(pid);
        break;
      case 'setSpec': {
        const spec = parseTalentOptionId(msg.spec);
        if (spec !== undefined) sim.setSpec(spec, pid);
        break;
      }
      case 'selectTalentRow': {
        const level = parseTalentRowLevel(msg.level);
        const optionId = parseTalentOptionId(msg.optionId);
        if (level !== null && optionId !== undefined) sim.selectTalentRow(level, optionId, pid);
        break;
      }
      case 'saveLoadout': {
        const hasAlloc = Object.hasOwn(msg, 'alloc');
        if (hasAlloc) {
          const alloc = parseTalentAllocation(msg.alloc);
          if (typeof msg.name === 'string' && alloc) {
            sim.saveLoadout(msg.name, Array.isArray(msg.bar) ? msg.bar : [], pid, alloc);
          }
        } else if (typeof msg.name === 'string') {
          sim.saveLoadout(msg.name, Array.isArray(msg.bar) ? msg.bar : [], pid);
        }
        break;
      }
      case 'switchLoadout': {
        const index = parseTalentLoadoutIndex(msg.index);
        if (index !== null) sim.switchLoadout(index, pid);
        break;
      }
      case 'deleteLoadout': {
        const index = parseTalentLoadoutIndex(msg.index);
        if (index !== null) sim.deleteLoadout(index, pid);
        break;
      }
      // World Market (the Merchant's auction house)
      case 'market_search':
        sim.marketSearch(
          sanitizeMarketQuery({
            search: typeof msg.q === 'string' ? msg.q : '',
            itemType: msg.itemType,
            subtype: msg.subtype,
            armorClass: msg.armorClass,
            primaryStat: msg.primaryStat,
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
      case 'market_list_instance':
        // The instance object is only an equality needle: the sim re-resolves
        // it against the sender's own bags and escrows the actual held copy's
        // payload, so no wire-supplied field ever enters the book directly.
        if (
          typeof msg.item === 'string' &&
          typeof msg.price === 'number' &&
          Number.isFinite(msg.price) &&
          typeof msg.instance === 'object' &&
          msg.instance !== null &&
          !Array.isArray(msg.instance)
        ) {
          sim.marketListInstance(msg.item, msg.price, msg.instance as ItemInstancePayload, pid);
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
        const items: { itemId: string; count: number; instance?: ItemInstancePayload }[] = [];
        let itemsOk = true;
        for (const raw of msg.items as unknown[]) {
          const slot = raw as { itemId?: unknown; count?: unknown; instance?: unknown } | null;
          if (
            !slot ||
            typeof slot.itemId !== 'string' ||
            typeof slot.count !== 'number' ||
            !Number.isFinite(slot.count)
          ) {
            itemsOk = false;
            break;
          }
          // The instance is only an equality needle (the market_list_instance
          // rule): the sim re-resolves it against the sender's own bags and
          // escrows the actual held copy's payload.
          const instance =
            slot.instance !== null &&
            typeof slot.instance === 'object' &&
            !Array.isArray(slot.instance)
              ? (slot.instance as ItemInstancePayload)
              : undefined;
          items.push({
            itemId: slot.itemId,
            count: Math.floor(slot.count),
            ...(instance ? { instance } : {}),
          });
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
      // Guild Bank: the officer-plus shared treasury + item store. Shape-only
      // checks here (the bank_* idiom): the Sim owns every gameplay rule
      // (banker proximity, officer-plus rank via the session membership stamp,
      // quest-bind, treasury cap, table price, capacity). `slot` is a container
      // index, `count` optional (omit = whole stack), `amount` copper. Every op
      // runs through runGuildBankOp: the before/after guildBankInfoFor diff is
      // the ONE success signal, feeding both the fire-and-forget bank_ledger
      // rows (container='guild') and the dirty mark that schedules the book
      // for the fenced escrow save. A refusal diffs empty: no row, no mark.
      case 'guild_bank_deposit_gold':
        if (!this.consumeGuildBankOp(session, receivedAtMs / 1000)) break;
        if (typeof msg.amount === 'number') {
          const amount = msg.amount;
          this.runGuildBankOp(session, { pid }, 'deposit_gold', () =>
            sim.guildBankDepositGoldFor(pid, amount),
          );
        }
        break;
      case 'guild_bank_withdraw_gold':
        if (!this.consumeGuildBankOp(session, receivedAtMs / 1000)) break;
        if (typeof msg.amount === 'number') {
          const amount = msg.amount;
          this.runGuildBankOp(session, { pid }, 'withdraw_gold', () =>
            sim.guildBankWithdrawGoldFor(pid, amount),
          );
        }
        break;
      case 'guild_bank_deposit':
        if (!this.consumeGuildBankOp(session, receivedAtMs / 1000)) break;
        if (typeof msg.slot === 'number') {
          const slot = msg.slot;
          const count = typeof msg.count === 'number' ? msg.count : undefined;
          this.runGuildBankOp(session, { pid }, 'deposit', () =>
            sim.guildBankDepositFor(pid, slot, count),
          );
        }
        break;
      case 'guild_bank_withdraw':
        if (!this.consumeGuildBankOp(session, receivedAtMs / 1000)) break;
        if (typeof msg.slot === 'number') {
          const slot = msg.slot;
          const count = typeof msg.count === 'number' ? msg.count : undefined;
          this.runGuildBankOp(session, { pid }, 'withdraw', () =>
            sim.guildBankWithdrawFor(pid, slot, count),
          );
        }
        break;
      case 'guild_bank_buy_slots':
        if (!this.consumeGuildBankOp(session, receivedAtMs / 1000)) break;
        this.runGuildBankOp(session, { pid }, 'buy_slots', () => sim.guildBankBuySlotsFor(pid));
        break;
      // The activity log READ (no mutation, no sim call). It shares the guild
      // bank op guard rather than getting a second bucket: it is the same
      // window, the same officer, and the same abuse shape, and the honest
      // client asks at most once per its own TTL, so a legitimate session never
      // notices while a flooder is stopped by machinery that already exists.
      case 'guild_bank_log':
        if (!this.consumeGuildBankOp(session, receivedAtMs / 1000)) break;
        this.sendGuildBankLog(session, pid);
        break;
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
            cancelProfessionSessionOnDisplacement(sim.ctx, e);
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
      case 'dev_profiler_invulnerable': {
        if (process.env.ALLOW_DEV_COMMANDS === '1') {
          const entity = sim.entities.get(pid);
          if (entity) entity.profilerInvulnerable = true;
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
        if (typeof dungeonId !== 'string') {
          this.sendCommandOutcome(session, msg, false);
          break;
        }
        const e = sim.entities.get(pid);
        const door = [...sim.entities.values()].find(
          (x) => x.templateId === 'dungeon_door' && x.dungeonId === dungeonId,
        );
        const succeeded =
          !!e &&
          !!door &&
          Math.hypot(e.pos.x - door.pos.x, e.pos.z - door.pos.z) < 8 &&
          sim.enterDungeon(dungeonId, pid);
        this.sendCommandOutcome(session, msg, succeeded);
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
        this.sendCommandOutcome(session, msg, !!exit && sim.leaveDungeon(pid));
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
        this.sendCommandOutcome(
          session,
          msg,
          typeof msg.objectId === 'number' && sim.delveInteract(msg.objectId, pid),
        );
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
        // Unknown cmds draw their command-lane token here, AFTER the anomaly
        // observation (R5), so the lane never mutes the anomaly channel.
        this.consumeLane(session, 'command', receivedAtMs / 1000);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Snapshots & events
  // -------------------------------------------------------------------------

  private broadcastSnapshots(): void {
    if (this.clients.size === 0) return;
    this.partyFrameGlobalsCache = null;
    this.partyFrameProjectionCache.beginBroadcast();
    const tick = this.sim.tickCount;
    // Vale Cup wire dueness, decided ONCE per broadcast pass and realm-global so the
    // shared readout memo still builds a single time this pass, then threaded into
    // every session's selfWireJson. `>=` a per-pass tracker, never a modulo of
    // tickCount: this pass runs once per callback outside the catch-up loop, so
    // tickCount can jump past a VC_WIRE_INTERVAL_TICKS multiple under load and a
    // modulo gate would skip the aligned pass and stall the readout (the arena,
    // Dungeon Finder, and wire-cache sibling gates all use `>=` for this reason).
    const vcupDue = tick - this.lastVcupWireTick >= VC_WIRE_INTERVAL_TICKS;
    if (vcupDue) this.lastVcupWireTick = tick;
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
    const activeFrostRings = this.sim.activeFrostRings;
    const activeTemporalHourglasses = this.sim.activeTemporalHourglasses;
    // Resolve every live session's interest anchor up front, each inside its own
    // guard so a throw building one anchor cannot starve every other session's
    // snapshot this tick (server/CLAUDE.md, guarded_iter.ts). Positions are read
    // fresh here, off the live Entity.pos, never cached across passes: the shared
    // per-cell query below is a strict superset of every per-viewer query ONLY
    // because Sim.tick's end-of-tick grid.refresh leaves buckets fresh, so an
    // anchor's CURRENT cell is the right one to query. The one mutation reachable
    // here is the vanished-spectate exitSpectate fallback, which re-buckets the
    // moderator back to savedPos; hoisting it ahead of the shared-candidate build
    // makes every co-located session see the moderator at savedPos this pass, a
    // tick earlier than the old inline ordering (gameplay-neutral: a moderator
    // leaving spectate limbo becomes visible to co-located viewers one tick
    // sooner, never later, and it never changes combat, loot, interest, or what
    // the spectated players see).
    const anchors: SnapshotAnchor[] = [];
    forEachGuarded(
      this.clients.values(),
      (session) => {
        // no transport while linkdead; the resume path resets sentEnts/lastSent
        // so the fresh socket starts from a full snapshot anyway
        if (session.linkdead) return;
        const p = this.sim.entities.get(session.pid);
        const meta = this.sim.meta(session.pid);
        if (!p || !meta) return;
        const stableTimerWire = session.timerWireVersion === STABLE_TIMER_WIRE_VERSION;
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
        anchors.push({
          sessionId: session.pid,
          session,
          anchor: anchorEntity,
          anchorMeta,
          anchorSession,
          stableTimerWire,
        });
      },
      (err, session) =>
        console.error(`[snap] failed to resolve anchor for pid ${session.pid}, skipping:`, err),
    );

    // One padded grid query per occupied anchor cell, shared by every session
    // anchored there, replacing the old one-query-per-viewer interest scan. The
    // pad (half the cell diagonal) makes a query from the cell center a strict
    // superset of every viewer-exact INTEREST_QUERY_RADIUS query for any viewer
    // in that cell; each session below re-applies its exact viewer-relative
    // cutoff. Timed into bcastGridNs (the shared build once), the same counter
    // that brackets the per-session lookup+filter work below.
    const sharedStart = this.perfDetailActive ? process.hrtime.bigint() : 0n;
    const candidates = buildSharedInterestCandidates(
      this.sim.grid,
      anchors,
      INTEREST_QUERY_RADIUS,
      {
        radius: BG_MATCH_DROP_RADIUS,
        covers: isBgPos,
      },
    );
    if (this.perfDetailActive) this.bcastGridNs += process.hrtime.bigint() - sharedStart;
    const queryLimitSq = INTEREST_QUERY_RADIUS * INTEREST_QUERY_RADIUS;
    const bgQueryLimitSq = BG_MATCH_DROP_RADIUS * BG_MATCH_DROP_RADIUS;

    // Build each session's snapshot from its shared candidate list, still guarded
    // per session so one throw cannot starve the rest.
    forEachGuarded(
      anchors,
      ({ session, anchor: anchorEntity, anchorMeta, anchorSession, stableTimerWire }) => {
        const ents: string[] = [];
        const keep: number[] = [];
        const present = new Set<number>();
        // Resolved ONCE per viewer per pass (a map lookup, no allocation): the
        // pid list of this viewer's own battleground team, which decides who
        // rides the raised match radius below.
        const bgTeam = this.bgTeamPidsFor(anchorEntity);
        const gridStart = this.perfDetailActive ? process.hrtime.bigint() : 0n;
        for (const e of candidates.forSession(session.pid)) {
          // Re-apply the exact viewer-relative cutoff the single grid query used
          // to apply for us: the shared candidate list is padded and larger, and
          // its own callback d2 was cell-center-relative, so recompute d2 here
          // from this anchor's live position. Every downstream filter stays
          // viewer-relative (canObserveEntity, interestLimitSq, isUpdateDue).
          const dx = e.pos.x - anchorEntity.pos.x;
          const dz = e.pos.z - anchorEntity.pos.z;
          const d2 = dx * dx + dz * dz;
          if (d2 > (isBgPos(anchorEntity.pos.x) ? bgQueryLimitSq : queryLimitSq)) continue;
          // bcVisits counts the exact per-viewer in-range set (self included):
          // increment only AFTER the exact-d2 cutoff, never on the padded
          // per-cell candidate list. Band viewers use the wider battleground
          // cutoff, so their counts are larger than an open-world viewer's.
          if (this.perfDetailActive) this.bcVisits++;
          if (e.id === anchorEntity.id) continue;
          if (!this.canObserveEntity(anchorEntity, e, d2)) continue;
          const known = session.sentEnts.get(e.id);
          // the viewer's current target stays in interest to the widest drop
          // radius so its unit frame doesn't vanish mid-chase
          const limitSq =
            anchorEntity.targetId === e.id
              ? NPC_DROP_RADIUS * NPC_DROP_RADIUS
              : bgWideInterestApplies(anchorEntity, e, bgTeam)
                ? known !== undefined
                  ? BG_MATCH_DROP_RADIUS * BG_MATCH_DROP_RADIUS
                  : BG_MATCH_INTEREST_RADIUS * BG_MATCH_INTEREST_RADIUS
                : interestLimitSq(e, known !== undefined);
          if (d2 > limitSq) continue;
          present.add(e.id);
          const cache = this.wireCacheFor(e, stableTimerWire);
          if (known === undefined) {
            // first sight carries the at-rest state exactly, so no settle
            // record is owed until it moves again
            ents.push(stableTimerWire ? cache.fullAuraJson : cache.fullJson);
            session.sentEnts.set(e.id, {
              idVer: cache.idVer,
              dynVer: cache.dynVer,
              auraVer: cache.auraVer,
              sentAtTick: tick,
              settled: true,
            });
            continue;
          }
          const auraChanged = stableTimerWire && known.auraVer !== cache.auraVer;
          if (known.idVer !== cache.idVer) {
            ents.push(auraChanged ? cache.fullAuraJson : cache.fullJson);
            known.idVer = cache.idVer;
            known.dynVer = cache.dynVer;
            known.auraVer = cache.auraVer;
            known.sentAtTick = tick;
            known.settled = false;
            continue;
          }
          if (
            !isUpdateDue(tick, e, d2, anchorEntity, known.sentAtTick) ||
            (known.dynVer === cache.dynVer && !auraChanged && known.settled)
          ) {
            // not due at this distance tier yet, or unchanged and already
            // settled: a bare id keeps it alive on the client
            keep.push(e.id);
            continue;
          }
          // due, and either changed or owing its one settle record
          known.settled = known.dynVer === cache.dynVer;
          known.dynVer = cache.dynVer;
          known.auraVer = cache.auraVer;
          known.sentAtTick = tick;
          ents.push(auraChanged ? cache.liteAuraJson : cache.liteJson);
        }
        // forget entities that left interest, so a re-entry sends identity again
        for (const id of session.sentEnts.keys()) {
          if (!present.has(id)) session.sentEnts.delete(id);
        }
        const selfStart = this.perfDetailActive ? process.hrtime.bigint() : 0n;
        if (this.perfDetailActive) this.bcastGridNs += selfStart - gridStart;
        const selfJson = this.selfWireJson(
          session,
          anchorEntity,
          anchorMeta,
          anchorSession,
          vcupDue,
        );
        if (this.perfDetailActive) this.bcastSelfNs += process.hrtime.bigint() - selfStart;
        const keepJson = keep.length > 0 ? `,"keep":[${keep.join(',')}]` : '';
        // Ground-AoE warnings (frost rings, temporal hourglasses) are anonymous
        // ground effects, not entities: they carry a position, radius and timer
        // and no caster identity or team, and a player must be able to react to
        // one wherever it lands. They therefore keep the widened match horizon
        // inside the band, unlike the enemy PLAYERS above, whose records the
        // narrowed rule holds to the open-world radii.
        const aoeBase = isBgPos(anchorEntity.pos.x) ? BG_MATCH_DROP_RADIUS : INTEREST_QUERY_RADIUS;
        const frostRings = activeFrostRings
          .filter((ring) => {
            const dx = ring.x - anchorEntity.pos.x;
            const dz = ring.z - anchorEntity.pos.z;
            const limit = aoeBase + ring.radius;
            return dx * dx + dz * dz <= limit * limit;
          })
          .map(
            (ring) =>
              `{"id":${JSON.stringify(ring.id)},"x":${round2(ring.x)},"z":${round2(ring.z)},"r":${round2(ring.radius)},"i":${round2(ring.innerRadius)},"dur":${round2(ring.duration)},"rem":${round2(ring.remaining)}}`,
          );
        const frostRingsJson = frostRings.length > 0 ? `,"rings":[${frostRings.join(',')}]` : '';
        const temporalHourglasses = activeTemporalHourglasses
          .filter((hourglass) => {
            const dx = hourglass.x - anchorEntity.pos.x;
            const dz = hourglass.z - anchorEntity.pos.z;
            const limit = aoeBase + hourglass.radius;
            return dx * dx + dz * dz <= limit * limit;
          })
          .map(
            (hourglass) =>
              `{"id":${JSON.stringify(hourglass.id)},"x":${round2(hourglass.x)},"z":${round2(hourglass.z)},"r":${round2(hourglass.radius)},"dur":${round2(hourglass.duration)},"rem":${round2(hourglass.remaining)}}`,
          );
        const temporalHourglassesJson =
          temporalHourglasses.length > 0 ? `,"hourglasses":[${temporalHourglasses.join(',')}]` : '';
        const timerWireJson = stableTimerWire ? `,"tw":${STABLE_TIMER_WIRE_VERSION}` : '';
        this.sendRaw(
          session,
          `${head}${timerWireJson},"self":${selfJson},"ents":[${ents.join(',')}]${frostRingsJson}${temporalHourglassesJson}${keepJson}}`,
        );
      },
      (err, resolved) =>
        console.error(
          `[snap] failed to build snapshot for pid ${resolved.session.pid}, skipping:`,
          err,
        ),
    );
    // >= rather than a modulo check: catch-up broadcasts can skip ticks
    if (tick - this.lastWireSweepTick >= WIRE_CACHE_SWEEP_TICKS) {
      this.lastWireSweepTick = tick;
      this.sweepWireCache();
    }
  }

  // The pid list of the viewer's OWN battleground team, or null when the viewer
  // is not a player in a live match. Returns the sim's own array by reference:
  // read-only here, and this runs once per viewer per broadcast pass.
  private bgTeamPidsFor(viewer: Entity): readonly number[] | null {
    if (viewer.kind !== 'player' || !isBgPos(viewer.pos.x)) return null;
    const match = this.sim.bgMatchFor(viewer.id);
    if (!match) return null;
    return match.teams[1].includes(viewer.id) ? match.teams[1] : match.teams[0];
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

  private entityWireCacheFor(e: Entity): EntityWireCache {
    let cache = this.wireCache.get(e.id);
    if (!cache) {
      cache = {
        tick: -1,
        idJson: '',
        baseDynJson: '',
        idVer: 0,
        baseDynVer: 0,
        auraCache: new StableAuraWireCache(),
        legacy: emptyWireVariant(),
        stable: emptyWireVariant(),
      };
      this.wireCache.set(e.id, cache);
    }
    return cache;
  }

  // Identity and non-aura dynamics are serialized once per entity/tick. The
  // negotiated legacy and stable aura variants are then built lazily, at most
  // once each, and shared by every compatible recipient.
  private wireCacheFor(e: Entity, stableTimerWire: boolean): EntityWireView {
    const cache = this.entityWireCacheFor(e);
    const t0 = this.perfDetailActive ? process.hrtime.bigint() : 0n;
    if (cache.tick !== this.sim.tickCount) {
      cache.tick = this.sim.tickCount;
      const idJson = JSON.stringify(identityFields(e));
      const baseDynJson = JSON.stringify(dynamicFields(e, false));
      if (idJson !== cache.idJson) {
        cache.idJson = idJson;
        cache.idVer++;
      }
      if (baseDynJson !== cache.baseDynJson) {
        cache.baseDynJson = baseDynJson;
        cache.baseDynVer++;
      }
      if (this.perfDetailActive) {
        this.bcBaseSerializes++;
        this.bcSerializes++;
      }
    }

    const variant = stableTimerWire ? cache.stable : cache.legacy;
    variant.idVer = cache.idVer;
    if (variant.tick !== this.sim.tickCount) {
      variant.tick = this.sim.tickCount;
      if (stableTimerWire) {
        const aura = cache.auraCache.encode(e.auras, this.sim.time, e.dead);
        variant.dynJson = cache.baseDynJson;
        variant.dynVer = cache.baseDynVer;
        variant.auraVer = aura.revision;

        const baseChanged =
          variant.builtIdVer !== cache.idVer || variant.builtDynVer !== variant.dynVer;
        const auraChanged = variant.builtAuraVer !== variant.auraVer;
        if (baseChanged) {
          variant.fullJson = fullEntityJson(e.id, cache.idJson, variant.dynJson);
          variant.liteJson = liteEntityJson(e.id, variant.dynJson);
        }
        if (baseChanged || auraChanged) {
          const dynWithAuras = jsonWithField(variant.dynJson, 'auras', aura.json);
          variant.fullAuraJson = fullEntityJson(e.id, cache.idJson, dynWithAuras);
          variant.liteAuraJson = liteEntityJson(e.id, dynWithAuras);
          if (this.perfDetailActive) this.bcStableSerializes++;
        }
        variant.builtIdVer = cache.idVer;
        variant.builtDynVer = variant.dynVer;
        variant.builtAuraVer = variant.auraVer;
      } else {
        const auraJson = e.auras.length > 0 ? JSON.stringify(e.auras.map(wireAura)) : null;
        const dynJson = auraJson
          ? jsonWithField(cache.baseDynJson, 'auras', auraJson)
          : cache.baseDynJson;
        if (dynJson !== variant.dynJson) {
          variant.dynJson = dynJson;
          variant.dynVer++;
        }
        if (variant.builtIdVer !== cache.idVer || variant.builtDynVer !== variant.dynVer) {
          variant.fullJson = fullEntityJson(e.id, cache.idJson, variant.dynJson);
          variant.liteJson = liteEntityJson(e.id, variant.dynJson);
          variant.fullAuraJson = variant.fullJson;
          variant.liteAuraJson = variant.liteJson;
          variant.builtIdVer = cache.idVer;
          variant.builtDynVer = variant.dynVer;
          if (this.perfDetailActive) this.bcLegacySerializes++;
        }
      }
    }
    if (this.perfDetailActive) this.bcSerializeNs += process.hrtime.bigint() - t0;
    return variant;
  }

  private stableAuraWireFor(e: Entity): ReturnType<StableAuraWireCache['encode']> {
    return this.entityWireCacheFor(e).auraCache.encode(e.auras, this.sim.time, e.dead);
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
    vcupDue = false,
  ): string {
    const stableTimerWire = session.timerWireVersion === STABLE_TIMER_WIRE_VERSION;
    const self = wireEntity(p, !stableTimerWire);
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
      fcd: round2(p.firebottleCdRemaining),
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
      blk: p.blockChance,
      bval: p.blockValue,
      crat: p.critRating,
      hrat: p.hasteRating,
      hirat: p.hitRating,
      eat: p.eating ? { remaining: round2(p.eating.remaining) } : null,
      drk: p.drinking ? { remaining: round2(p.drinking.remaining) } : null,
      opUntil: p.overpowerUntil > this.sim.time ? 1 : 0,
      opRem: round2(Math.max(0, p.overpowerUntil - this.sim.time)),
      ack: session.spectating ? 0 : anchorSession.lastInputSeq,
      ddiff: this.sim.dungeonDifficulty(anchorSession.pid),
    });
    const json = JSON.stringify(self);
    // heavy, rarely-changing fields ride along only when their serialized
    // form differs from what this session last received; the client treats
    // an absent field as "unchanged" (a fresh session always gets them all)
    const sent = session.lastSent;
    let extra = '';
    const maybeSerialized = (key: string, s: string): void => {
      if (sent[key] !== s) {
        sent[key] = s;
        extra += `,"${key}":${s}`;
      }
    };
    // Like `maybe`, but for a value already serialized once (the realm-wide Vale
    // Cup fragment and the dungeon-finder board are each JSON.stringify'd a single
    // time per tick by their realm-readout memos): skip the per-session
    // re-stringify and only diff the pre-serialized string against what this
    // session last received.
    const maybeRaw = (key: string, serialized: string): void => {
      if (sent[key] !== serialized) {
        sent[key] = serialized;
        extra += `,"${key}":${serialized}`;
      }
    };
    const maybe = (key: string, value: unknown): void => {
      maybeSerialized(key, JSON.stringify(value ?? null));
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
    if (stableTimerWire) {
      maybeSerialized('auras', this.stableAuraWireFor(p).json);
      maybeSerialized(
        'cds',
        session.timerWireCache.encodeCooldowns(anchorSession.pid, p, this.sim.time).json,
      );
    } else {
      maybe('cds', Object.fromEntries([...p.cooldowns.entries()].map(([k, v]) => [k, round2(v)])));
    }
    // Per-player gather-node respawn cooldowns (#1866), same shape/semantics as
    // `cds` above: remaining seconds AS OF THIS TICK, ticking down tick over
    // tick (so `maybe` re-ships it while any node is still cooling down and
    // drops a node's key the tick it clears), matching
    // PlayerMeta.nodeHarvestReadyAt's own "absent means ready" contract (see
    // src/sim/professions/gathering.ts isNodeHarvestableBy). Only entries with
    // remaining time survive the filter, an already-elapsed timer reads as ready.
    if (stableTimerWire) {
      maybeSerialized(
        'ncd',
        session.timerWireCache.encodeNodeCooldowns(
          anchorSession.pid,
          meta.nodeHarvestReadyAt,
          this.sim.time,
        ).json,
      );
    } else {
      // Fast path first: while NOTHING is cooling (a fresh session, or every
      // timer elapsed), the projected map is always {}, and the alloc-free
      // for..in probe replaces the unconditional entries/filter/map/
      // fromEntries chain (about 2N+4 allocations per player per tick against
      // a readyAt map that only ever grows within a session). Byte-identical
      // to maybe('ncd', {}) on the wire. Precondition making for..in exactly
      // equivalent to the Object.entries filter below: nodeHarvestReadyAt is
      // always a plain {} built by applyNodeReadiness / the gathering write
      // site (own enumerable keys only, no prototype chain).
      let anyCooling = false;
      for (const k in meta.nodeHarvestReadyAt) {
        if (meta.nodeHarvestReadyAt[k] > this.sim.time) {
          anyCooling = true;
          break;
        }
      }
      if (!anyCooling) {
        maybeSerialized('ncd', '{}');
      } else {
        maybe(
          'ncd',
          Object.fromEntries(
            Object.entries(meta.nodeHarvestReadyAt)
              .filter(([, until]) => until > this.sim.time)
              .map(([k, until]) => [k, round2(until - this.sim.time)]),
          ),
        );
      }
    }
    // Charge-limited ability live counts (abilityCharges, the one recharge
    // model: Twinstrike, Double Charge, Frost's second Ice Block): {abilityId:
    // charges}. The empty-pool recharge timer rides `cds`; the client derives
    // the max from its own known-list rebake (1 + bonusCharges).
    if (stableTimerWire) {
      maybeSerialized(
        'achg',
        session.timerWireCache.encodeCharges(anchorSession.pid, p.abilityCharges).json,
      );
      // The companion recharge timers ({abilityId: [deadline, length]}), so the
      // bar can show the thin recharge sweep while the pool still holds a use
      // (the empty-pool timer keeps riding `cds` unchanged). Additive key: an
      // older client simply ignores it.
      maybeSerialized(
        'achr',
        session.timerWireCache.encodeChargeRecharges(
          anchorSession.pid,
          p.abilityCharges,
          this.sim.time,
        ).json,
      );
    } else {
      maybe(
        'achg',
        p.abilityCharges
          ? Object.fromEntries(Object.entries(p.abilityCharges).map(([k, v]) => [k, v.charges]))
          : {},
      );
      // Legacy arm: raw remaining seconds ({abilityId: [remaining, length]}),
      // resent per snapshot like every legacy timer.
      maybe(
        'achr',
        p.abilityCharges
          ? Object.fromEntries(
              Object.entries(p.abilityCharges)
                .filter(([, v]) => v.recharge > 0 && Number.isFinite(v.recharge))
                .map(([k, v]) => [k, [v.recharge, v.rechargeLength]]),
            )
          : {},
      );
    }
    maybe('stats', p.stats);
    maybe('weapon', p.weapon);
    maybe('party', this.partyWire(anchorSession.pid));
    maybe('marks', this.markersWire(anchorSession.pid));
    maybe('trade', this.tradeWire(anchorSession.pid));
    maybe('duel', this.duelWire(anchorSession.pid));
    maybe('cardDuel', this.sim.cardMinigameInfoFor(anchorSession.pid));
    // Small PvP-ledger scalars. Delta-guarded like delve marks: a fresh
    // session receives both, then they ride only on earn/spend changes.
    maybe('honor', meta.honor);
    maybe('lhonor', meta.lifetimeHonor);
    if (this.sim.tickCount - session.lastArenaWireTick >= ARENA_WIRE_INTERVAL_TICKS) {
      session.lastArenaWireTick = this.sim.tickCount;
      maybe('arena', this.sim.arenaInfoFor(anchorSession.pid));
    }
    // Thornhollow Fields readout at its own UI cadence (BG_WIRE_HZ). The viewer-identical
    // match core is memoized per tick inside the sim (sharedMatchView), so ten
    // in-match viewers share one build; only the per-viewer scalars differ.
    if (this.sim.tickCount - session.lastBgWireTick >= BG_WIRE_INTERVAL_TICKS) {
      session.lastBgWireTick = this.sim.tickCount;
      // The live online ladder inside that readout is realm-wide and identical
      // for every viewer, so it is built once per broadcast pass through the
      // realm-readout memo and reused (the dfb/vcupb precedent).
      const ladder = realmReadoutObject(this.bgLadderReadout, this.sim.tickCount, () =>
        this.sim.bgLadder(),
      );
      maybe('bg', this.sim.bgInfoFor(anchorSession.pid, ladder));
    }
    // Vale Cup readout at its own UI cadence (VC_WIRE_HZ). Dueness (`vcupDue`) is
    // decided once per broadcast pass in broadcastSnapshots and realm-global, so the
    // shared bundle is built once per due pass rather than on each session's own
    // offset gate. The per-viewer remainder (standing, queue slot, my match/spectate
    // view, my bets, my guild line) rides `vcup`; the realm-wide fragment (queue
    // sizes, the live strip, the winners and guild boards, who is practicing) rides
    // `vcupb`, serialized ONCE per broadcast pass by the realm-readout memo and
    // reused across every viewer. A fresh join or a spectate enter/exit clears
    // lastSent, so the `sent.vcup === undefined` arm re-ships both keys
    // immediately even between due passes (the old per-session negative-init did
    // this; the dueness gate alone would not, so keep this arm).
    if (vcupDue || sent.vcup === undefined) {
      const shared = realmReadoutObject(this.realmReadout, this.sim.tickCount, () =>
        this.sim.cupSharedInfoFor(),
      );
      const full = this.sim.cupInfoFor(anchorSession.pid, shared);
      if (full) {
        // liveHidden: this viewer is off in a private practice instance, so the
        // Sowfield live strip carried in the shared fragment must be suppressed for
        // them. Derived from the two values we already hold (the raw shared live is
        // non-null but this viewer's effective live is null), so this per-viewer
        // suppression needs no flag of its own on the match sub-object
        // (VcMatchInfo.practice describes the MATCH for the briefing copy, not
        // this viewer's live-strip visibility); the client reapplies liveHidden
        // on recompose and never surfaces it on CupInfo. The raw strip still rides vcupb to every
        // viewer (it is public match state, no PII), so a practicer receives the
        // bytes but this per-viewer flag keeps their client from ever rendering it.
        const liveHidden = shared.live !== null && full.live === null;
        // Typed as VcViewerReadout so a future CupInfo per-viewer field addition
        // fails compile here rather than silently dropping from the wire remainder.
        const viewerReadout: VcViewerReadout = {
          standing: full.standing,
          queued: full.queued,
          bracket: full.bracket,
          nation: full.nation,
          role: full.role,
          position: full.position,
          deserterFor: full.deserterFor,
          match: full.match,
          spectate: full.spectate,
          betRecord: full.betRecord,
          myGuild: full.myGuild,
          guildStanding: full.guildStanding,
          liveHidden,
        };
        maybe('vcup', viewerReadout);
        maybeRaw(
          'vcupb',
          realmReadoutJson(this.realmReadout, this.sim.tickCount, () =>
            this.sim.cupSharedInfoFor(),
          ),
        );
      } else {
        maybe('vcup', null);
      }
    }
    // Dungeon Finder at its own UI cadence (DF_WIRE_HZ): the personal `df`
    // blob carries whole-second clocks (queue wait, proposal countdown), so
    // re-evaluating every tick would re-serialize it 20 times per visible
    // change. The shared `dfb` board is a separate key so a live countdown
    // never re-sends the listings; it is viewer-independent, so its JSON rides
    // the realm-readout memo (built + stringified at most once per tick, reused
    // by every session whose gate opens on that tick) and ships via `maybeRaw`.
    // The per-session `>=` gate itself is unchanged: sessions keep their own
    // offsets, and the memo only collapses same-tick evaluations.
    if (this.sim.tickCount - session.lastDfWireTick >= DF_WIRE_INTERVAL_TICKS) {
      session.lastDfWireTick = this.sim.tickCount;
      maybe('df', this.sim.dungeonFinderInfoFor(anchorSession.pid));
      maybeRaw(
        'dfb',
        realmReadoutJson(this.dfBoardReadout, this.sim.tickCount, () =>
          this.sim.dungeonFinderBoardView(),
        ),
      );
    }
    // market info is null unless the player is standing at the Merchant, so it
    // only rides the wire for players actually browsing the World Market
    maybe('market', this.sim.marketInfoFor(anchorSession.pid));
    // the lightweight collect-indicator bit streams ALWAYS (the mailU pattern),
    // so the minimap badge lights anywhere while proceeds/items wait
    maybe('mktU', this.sim.marketCollectPendingFor(anchorSession.pid) ? 1 : 0);
    maybe('mail', this.sim.mailInfoFor(anchorSession.pid));
    maybe('mailU', this.sim.mailUnreadFor(anchorSession.pid));
    // bank info is null unless the player is standing at a banker, so it only
    // rides the wire for players actually browsing their deposit box (the mail
    // pattern). Not heavy-gated: it appears from proximity, not this session's
    // own dirty-marking commands.
    maybe('bank', this.sim.bankInfoFor(anchorSession.pid));
    // guild bank info follows the same pattern with a stricter gate: null
    // unless the player is alive, at a banker, AND stamped officer-plus in a
    // guild whose book is loaded (sim guildBankInfoFor), so members and
    // walked-away/dead/demoted/departed officers all read null. Not
    // heavy-gated for the same reason as bank: it can change from OTHER
    // officers' deposits, not just this session's own commands.
    maybe('guildBank', this.sim.guildBankInfoFor(anchorSession.pid));
    // open need-greed rolls this player can still answer, so a client that
    // missed the transient lootRoll event re-shows the prompt from state. Stays
    // per-tick (it's interactive state that appears from others' actions).
    maybe('lroll', this.sim.activeLootRolls(anchorSession.pid));
    // group-visible choices on those rolls (who has answered need/greed/pass),
    // so every party member's roll frame shows the live vote strip and stays up
    // after they answer. Per-tick for the same reason as lroll.
    maybe('lrollg', this.sim.lootRollGroupStatus(anchorSession.pid));
    // curate-phase master-loot assignments this player is the MASTER LOOTER of,
    // so a refused assignment (the sim leaves the roll open) or a missed
    // masterLoot event can restore the prompt inside the 300s window instead of
    // stranding the looter (#2526). Empty for every non-looter, so after the first
    // snapshot of a session (which carries `"mloot":[]`, as every registered key
    // does while lastSent is empty) the key delta-elides away for them. Per-tick
    // like lroll, and like lroll it costs one pendingLootRolls scan per session.
    maybe('mloot', this.sim.activeMasterLootRolls(anchorSession.pid));
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
    // Craft skills and identity must arrive as one value so the client never
    // evaluates a recipe against a pair from one tick and skills from another.
    maybe('cprof', this.sim.craftingIdentityFor(anchorSession.pid));
    // The viewer's own active mobile crafting station craft id (Professions
    // 2.0), or null. Expiry resolves server-side (Sim.
    // activeMobileStationCraftFor checks its own tickCount), so the delta
    // naturally flips to null the tick a station lapses and the client never
    // reasons about tick domains. Small scalar, diffed per tick like atitle.
    maybe('mst', this.sim.activeMobileStationCraftFor(anchorSession.pid));
    // Commission order board (issue #1298): the viewer's own projection
    // (their requests, any order they accepted, and the open board), small
    // and diffed per tick like `prof`/`cprof` above; this is how BOTH sides
    // of an accept/deliver converge, not the commissionOrderResult event.
    maybe('corder', this.sim.commissionOrdersFor(anchorSession.pid));
    // The viewer's own most recent enchanting-action outcomes (Professions
    // 2.0), or null. Small per-player reads diffed per tick like the other
    // scalars above (a successful action already refreshed the self inventory via
    // its loot event); the convergence arm for lastDisenchantResult/lastEnchantResult/
    // lastSalvageResult, alongside the pid-scoped disenchantResult/enchantResult/
    // salvageResult event. See TERSE_TO_IWORLD/ALL_DELTA_KEYS in tests/snapshots.test.ts.
    maybe('denc', this.sim.lastDisenchantResultFor(anchorSession.pid));
    maybe('ench', this.sim.lastEnchantResultFor(anchorSession.pid));
    maybe('salv', this.sim.lastSalvageResultFor(anchorSession.pid));
    maybe('tfocus', this.sim.townFocusFor(anchorSession.pid));
    // Raw gathering-profession proficiency map (IWorld `gatheringProficiency`,
    // #1119), a second small read alongside `prof` for the ORIGINAL flat-map
    // shape used by the `/dev gather` chat cheat and existing consumers. Wire
    // key `gprof`; see TERSE_TO_IWORLD/ALL_DELTA_KEYS in tests/snapshots.test.ts.
    maybe('gprof', this.sim.gatheringProficiencyFor(anchorSession.pid));
    // Slotted tool effects (IWorld `toolEffectSlots`). Wire key `tslot`; see
    // TERSE_TO_IWORLD/ALL_DELTA_KEYS in tests/snapshots.test.ts. Empty for
    // every player who has never slotted one, so after the first snapshot of a
    // session (which carries `"tslot":[]`, as every registered key does while
    // lastSent is empty) the key delta-elides away for almost everyone. The
    // charge counter moves only on a harvest that actually spends one, so this
    // is a cheap diff rather than a per-tick churn. The empty arm compares the
    // constant '[]' directly (byte-identical to maybe(...)): stringifying the
    // shared frozen empty projection per player per tick bought nothing.
    const tslotRows = this.sim.toolEffectSlotsFor(anchorSession.pid);
    if (tslotRows.length === 0) maybeSerialized('tslot', '[]');
    else maybe('tslot', tslotRows);
    // Riding skill: persisted, so the client knows whether to show the riding
    // trainer UI without waiting on a mount/select command to fail. Wire key
    // `mntRtd`; delta-guarded, only changes once (false to true, never back).
    maybe('mntRtd', meta.ridingTrained === true ? true : null);
    // Session-only lesson and race state must still reconcile after linkdead:
    // events sent while the socket is absent are not replayed on resume. These
    // self deltas are authoritative and clear stale client mirrors with false/null.
    maybe('mntLesson', this.sim.mountLessonActiveFor(anchorSession.pid));
    maybe('mntRace', this.sim.mountRaceViewFor(anchorSession.pid));
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
      // The owned mount collection (IWorldMounts.ownedMounts): the horse plus
      // every mount whose reins item sits in bags or bank. Its inputs are
      // meta.inventory (heavy-gated above) and meta.bank.inventory, which is
      // NOT itself behind this gate; the gating is safe anyway because the
      // only writers of the bank inventory are the deposit and withdraw
      // commands, and both are in HEAVY_SELF_CMDS, so every input change
      // marks this session heavy dirty. The staggered modulo refresh is the
      // backstop, with the known family caveat that broadcastSnapshots runs
      // outside the catch-up loop, so under sustained catch-up the stride
      // can skip a pid's modulo slot and the backstop stretches; the dirty
      // flag, not the modulo, is what carries correctness here. Wire key
      // `mntOwn`.
      maybe('mntOwn', this.sim.ownedMountsFor(anchorSession.pid));
      maybe('buyback', meta.vendorBuyback);
      maybe('equip', meta.equipment);
      maybe('einst', meta.equipmentInstance);
      maybe('cosmetics', anchorSession.accountCosmetics);
      // questProgressForWire strips the server-only per-object interact ledger:
      // the client never reads it, and this snapshot's build + stringify is the
      // dominant avoidable broadcast cost, so it does not carry bookkeeping.
      maybe('qlog', [...meta.questLog.values()].map(questProgressForWire));
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
        loadouts: meta.loadouts,
        activeLoadout: meta.activeLoadout,
      });
      // IWorldActionBar login restore (self-scoped, never a broadcast/entity
      // field): the VIEWER's own stored layout, or an explicit null meaning "the
      // server has no copy, seed from this device". Bound to the frozen join-time
      // value, so lastSent-diffing sends it exactly once and a later client save
      // never round-trips back to clobber an in-flight edit.
      maybe('hbl', session.initialHotbarLayout);
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
  // per broadcast and shared by every partyWire call in that broadcast.
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
    return this.partyFrameProjectionCache.forViewer(
      {
        id: party.id,
        leader: party.leader,
        raid: party.raid,
        master: party.lootStrategies.master,
        members: party.members,
      },
      pid,
      (mPid) => {
        const meta = this.sim.meta(mPid);
        const e = this.sim.entities.get(mPid);
        const pos = this.clients.get(mPid)?.spectating?.savedPos ?? e?.pos;
        if (!meta || !e || !pos) return null;
        return {
          member: {
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
            // Effective health Rewind could currently restore to this member
            // (combat/rewind.ts); 0 for members with no recent recorded loss.
            rewind: rewindHealAmount(damageTakenWithin(e, this.sim.tickCount), e.hp, e.maxHp),
            connected:
              meta.isDevBot || (this.clients.has(mPid) && !this.clients.get(mPid)?.linkdead)
                ? 1
                : 0,
            hasAggro: aggroTargets.has(mPid) ? 1 : 0,
            incomingHeal: incomingHeals.get(mPid) ?? 0,
          },
          auras: e.auras,
        };
      },
    );
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
  //
  // This is also the tick's ONE observer pass over the event list, so the
  // per-band harvest counter rides it rather than adding a second O(n) walk.
  private detectActivity(events: SimEvent[]): void {
    const now = Date.now();
    // Deed unlocks accumulate per session and record AFTER the loop, behind a
    // durable character save (see below); only the cosmetic broadcast stays
    // inline.
    const deedUnlocks = new Map<ClientSession, string[]>();
    for (const ev of events) {
      if (ev.type === 'unstuck' && ev.pid !== undefined) {
        const session = this.clients.get(ev.pid);
        if (session) {
          recordUnstuckEvent(
            {
              realm: REALM,
              accountId: session.accountId,
              characterId: session.characterId,
            },
            ev,
          );
        }
      }
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
          // Marquee unlocks fan out to guildmates and followers, and
          // feed-worthy unlocks (titles, the first koi) to the Discord
          // activity feed; retro unlocks NEVER fan out anywhere (a veteran's
          // first login after rollout must not spam their guild or the feed).
          if (ev.retro !== true) this.fanOutDeedUnlock(s, ev.deedId, now);
        }
      }
      // Economy telemetry: one granted node harvest, counted under the ZONE
      // of the node that yielded it (R3) and the node's own tool TIER (R31, so
      // a starter-zone bare-hands faucet reads apart from the tool-gated veins
      // beside it). Bots emit this too and are counted like anyone else,
      // deliberately: the series exists to show where the world is harvesting.
      if (ev.type === 'gatherResult') {
        gameMetricsCounters().harvest(harvestBandForNode(ev.nodeId), harvestTierForNode(ev.nodeId));
      }
      // Fishing telemetry: the three outcome events the sim emits (catch,
      // got-away, empty hook), each carrying the session's pinned water zone
      // and the effective band, plus the cast itself and the rod training fee.
      // Same no-session-filter reasoning as the harvest arm above.
      //
      // A cast has no dedicated event: it is the generic castStart with the
      // fishing ability, and the zone lives on the CASTER (the rod gate pinned
      // it at cast start), so this arm resolves both from the entity rather
      // than from the event. It is the denominator for every rate below.
      // Observed post-tick: a cast cancelled in the SAME tick it started has
      // already cleared the pin, so that cast falls back to the position
      // zone and the band reads post-tick state, and a caster who left the
      // world that same tick is not counted at all. Both are accepted over
      // a dedicated wire event.
      if (ev.type === 'castStart' && ev.ability === FISHING_CAST_ID) {
        const caster = this.sim.entities.get(ev.entityId);
        const casterMeta = this.sim.players.get(ev.entityId);
        if (caster && casterMeta) {
          gameMetricsCounters().fishingCast(
            caster.fishCastZoneId || zoneAt(caster.pos.x, caster.pos.z).id,
            fishingBandLabel(effectiveFishingBand(casterMeta)),
          );
        }
      }
      if (ev.type === 'fishingResult') {
        gameMetricsCounters().fishingCatch(ev.zoneId, fishingBandLabel(ev.band), isKoi(ev.itemId));
      }
      if (ev.type === 'fishingGotAway') {
        gameMetricsCounters().fishingGotAway(ev.zoneId, fishingBandLabel(ev.band));
      }
      if (ev.type === 'fishingEmptyHook') {
        gameMetricsCounters().fishingEmptyHook(ev.zoneId, fishingBandLabel(ev.band));
      }
      // One rod training fee paid. Only the ok arm charges (Sim.trainRecipe
      // debits exactly once and a duplicate resolves train_already_known), so
      // the ok check is what makes this a payment count and not an attempt
      // count. The fee amount is static content, published as woc_rod_fee_copper.
      if (ev.type === 'trainResult' && ev.ok && isRodFeeRecipe(ev.recipeId)) {
        gameMetricsCounters().rodFeePaid(ev.recipeId);
      }
      if (ev.type === 'levelup' && ev.pid !== undefined) {
        const session = this.clients.get(ev.pid);
        if (session) {
          session.metricsMaxLevel = Math.max(session.metricsMaxLevel, ev.level);
          // EVERY levelup, not just the milestone arms below: this is the server's
          // real-time knowledge of the move. The characters row the bot reads still
          // carries the old level until the next save, which enqueues again from
          // saveCharacter, so an early drain re-reads once the row catches up.
          enqueueLinkChange({ accountId: session.accountId, kinds: ['flex'] }, now);
        }
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
      } else if (ev.type === 'masterwork' && ev.pid !== undefined) {
        // A masterwork proc: the professions moment the rareloot arm above
        // cannot see (a craft fires no loot roll). The ACCOUNT-scoped dedupe
        // key (unlike rareloot's per-drop rollId) collapses a crafting
        // session to at most one card per dedupe TTL, and the card rides the
        // same deed_broadcasts opt-out as the deed fan-out below: masterwork
        // procs REPEAT (3 to 15 percent of crafts), so unlike the once-ever
        // levelup/rareloot arms, publishing them to a third-party channel
        // needs the player-controllable gate. Fire-and-forget off the loop
        // (the fanOutDeedUnlock shape); identity captured before the await.
        // Bots have no session, so this.clients.get filters them naturally.
        const s = this.clients.get(ev.pid);
        if (!s) continue;
        // The dedupe key is claimed SYNCHRONOUSLY, ahead of the opt-out read:
        // procs repeat, and a check inside the enqueue would fire one db read
        // per proc while all but one card is provably discarded (a same-tick
        // burst would even pass a plain pre-check together). Claimed = this
        // proc owns the TTL window; the enqueue then carries a null key.
        const { accountId, name } = s;
        if (!claimDedupeKey(`masterwork:${accountId}`, now)) continue;
        const profileUrl = this.profileUrlFor(name);
        const itemName = ITEMS[ev.itemId]?.name ?? ev.itemId;
        void getDeedBroadcasts(accountId)
          .then((enabled) => {
            if (!enabled) return;
            enqueueActivity(
              {
                kind: 'masterwork',
                accountIds: [accountId],
                names: [name],
                realm: REALM,
                profileUrl,
                itemName,
              },
              null,
              now,
            );
          })
          .catch((err) => {
            // The claim gated work that FAILED: release it, or one db blip
            // silently drops this account's cards for the whole TTL. The
            // claim stamp rides along so a LATE rejection cannot delete a
            // window a newer claimant owns, and the release re-stamps with
            // a short retry backoff rather than deleting outright (R60).
            releaseDedupeKey(`masterwork:${accountId}`, now);
            console.error('masterwork activity failed:', err);
          });
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

  // Every pid whose throttled `bg` readout a respawn in this batch invalidated:
  // the full membership of each respawning fighter's match, since the readout
  // carries the match-wide `dead` column (see BG_RESPAWN_EVENT). Returns null
  // when no respawn in the batch belongs to a match, so the ordinary batch pays
  // one type comparison per event and allocates nothing.
  private bgRespawnRefreshPids(events: SimEvent[]): Set<number> | null {
    let pids: Set<number> | null = null;
    for (const ev of events) {
      if (ev.type !== BG_RESPAWN_EVENT || ev.pid === undefined) continue;
      const match = this.sim.bgMatchFor(ev.pid);
      if (!match) continue;
      pids ??= new Set<number>();
      for (const p of match.teams[0]) pids.add(p);
      for (const p of match.teams[1]) pids.add(p);
    }
    return pids;
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
      // The sender's top STAFF Discord role (the anti-impersonation chat tag)
      // is composed here from the SENDER's entity rather than folded into the
      // cached session.chatFlair: e.discordRole is written by the bot's
      // members-meta push on its own cadence, so reading it live at fan-out
      // cannot go stale. Gated on the catalog's chatTag flag so community
      // roles (Artist, Content Creator, LEGEND, SHILL) stay nameplate-only
      // and the chat tag remains a pure authority signal. Allocates only for
      // staff senders.
      const role = this.sim.entities.get(ev.fromPid)?.discordRole;
      // `flair` may be undefined here; spreading undefined is a spec-defined
      // no-op, so a role-only sender yields a clean { role } object.
      if (role && specialRoleChatTag(role)) ev.flair = { ...flair, role };
      else if (flair) ev.flair = flair;
    }
    // ignore list: social invites from blocked senders are resolved once per
    // batch (dropped for every session and declined in the sim), not per
    // receiving session, so spectators of the target never see them either.
    const suppressedInvites = this.suppressBlockedSocialInvites(events);
    // Serialize each event exactly once for the whole batch (after the flair stamp
    // above, so the fragment carries the final wire shape). Every recipient's frame is
    // then assembled by joining the fragments it selects, index-aligned with `events`,
    // instead of re-stringifying a per-session { t:'events', list } object. Byte-for-byte
    // identical to the old per-session JSON.stringify; only the fan-out cost changes.
    // INVARIANT: nothing in the per-session loop below may mutate a SimEvent after this
    // point, or a recipient's fragment would stop matching its event. The one in-loop
    // visitor that takes `ev` is botDetector.observeEvent, an observer that writes the
    // tracking context and never the event; the once-per-batch flair stamp above is the
    // only event mutation and correctly precedes this serialization.
    const fragments = serializeEventFragments(events);
    // Resolved once per batch, applied per session below against that session's
    // ANCHOR pid (so a spectator watching a fighter refreshes with them).
    const bgRespawnRefresh = this.bgRespawnRefreshPids(events);
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
        // A wave raised somebody in this session's match: the match-wide `dead`
        // column just changed for everyone, not only the fighter who stood up.
        if (bgRespawnRefresh?.has(anchorPid)) session.lastBgWireTick = -BG_WIRE_INTERVAL_TICKS;
        const anchorParty = this.sim.partyOf(anchorPid);
        const mine: string[] = [];
        for (let i = 0; i < events.length; i++) {
          const ev = events[i];
          if (suppressedInvites?.has(ev)) continue;
          if (!shouldDeliverCombatEventToViewer(ev, anchorPid, anchorParty)) continue;
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
              mine.push(fragments[i]);
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
              mine.push(fragments[i]);
              // a sim-driven change to a heavy self field (loot, level-up, quest
              // credit, ...) refreshes those fields on the next snapshot
              if (HEAVY_SELF_EVENTS.has(ev.type)) session.selfHeavyDirty = true;
              // A match concluding (win, loss, draw, or forfeit) changes rating
              // and standings on the throttled `arena` self key (ARENA_WIRE_HZ):
              // force it fresh next snapshot instead of leaving the Arena
              // window showing the pre-match rating for up to 10s.
              if (ev.type === 'arenaEnd') session.lastArenaWireTick = -ARENA_WIRE_INTERVAL_TICKS;
              // Same staleness fix for the Thornhollow Fields readout: queue churn,
              // match lifecycle, and flag plays refresh `bg` next snapshot.
              if (BG_WIRE_RESET_EVENTS.has(ev.type))
                session.lastBgWireTick = -BG_WIRE_INTERVAL_TICKS;
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
            mine.push(fragments[i]);
          }
        }
        // sendRaw (not send) so the pre-serialized fragments are not re-stringified;
        // the assembled string is byte-identical to send({ t:'events', list: events }).
        if (mine.length > 0) this.sendRaw(session, assembleEventsFrame(mine));
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
  private handleChatFilterCommand(session: ClientSession, text: string, nowSec: number): boolean {
    const parsed = parseChatFilterCommand(text);
    if (!parsed) return false;
    const actor = this.actorFor(session);

    // The two list commands are reads and stay chat-token-free: they must work
    // even for a GM-silenced player, and echoing your own list back must never
    // burn a token toward the chat cooldown. Each readout is a live DB read
    // though, so it draws from the dedicated list-read guard below (the phase
    // 06 maintainer ruling). The four WRITE commands each cost a chat token:
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
    if (kind === 'ignoreList' || kind === 'blockList') {
      if (!this.consumeListRead(session, nowSec)) return true;
      if (kind === 'ignoreList') void this.social.ignoreList(actor).catch(logErr);
      else void this.social.blockList(actor).catch(logErr);
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

  private sendUnstuckBlocked(session: ClientSession, reason: UnstuckBlockedReason): void {
    this.send(session, { t: 'events', list: [{ type: 'unstuck', phase: 'blocked', reason }] });
  }

  private cancelAndRecordUnstuck(session: ClientSession): boolean {
    // Do not enqueue this event on the sim bus: linkdead sessions remain in the
    // client map, where detectActivity would otherwise record it a second time.
    const event = this.sim.cancelUnstuckForDisconnect(session.pid, false);
    if (!event) return false;
    recordUnstuckEvent(
      {
        realm: REALM,
        accountId: session.accountId,
        characterId: session.characterId,
      },
      event,
    );
    return true;
  }

  private sendSystemNotice(session: ClientSession, text: string): void {
    this.send(session, { t: 'events', list: [{ type: 'log', text, color: '#ffd100' }] });
  }

  // Fan a non-retro deed unlock out to its two audiences, the earner's online
  // guildmates and followers (marquee deeds) and the Discord activity feed
  // (title deeds + the first koi, via discordFeedDeed's fail-closed gate),
  // unless the account opted out (accounts.deed_broadcasts, ONE read serving
  // both audiences; a Discord post is a wider audience than the guild marquee,
  // so the opt-out covers it a fortiori). Fire-and-forget off the loop (the
  // daily-reward observer pattern): the opt-out read and the audience
  // resolution are async DB work the tick never awaits, and a failure logs
  // without touching gameplay. The earner's own toast is client-side from the
  // sim event; no frame is sent to them here. Session identity is captured
  // BEFORE the await so a leave between tick and resolution changes nothing.
  private fanOutDeedUnlock(session: ClientSession, deedId: string, now: number): void {
    const def = DEEDS[deedId];
    if (!def) return;
    // Hidden deeds are invisible until earned, EXISTENCE included (the
    // deeds_records contract every third-party surface honors): a reward can
    // make one marquee, but the fan-out would hand its id and name to viewers
    // who have not earned their own copy. discordFeedDeed applies the same
    // contract fail-closed for the feed card.
    const marquee = isMarqueeDeed(def) && !isHiddenDeedId(deedId);
    const feed = discordFeedDeed(deedId);
    if (!marquee && !feed) return;
    const { accountId, characterId, name } = session;
    const profileUrl = this.profileUrlFor(name);
    void getDeedBroadcasts(accountId)
      .then((enabled) => {
        if (!enabled) return;
        if (feed) {
          enqueueActivity(
            {
              kind: 'deed',
              accountIds: [accountId],
              names: [name],
              realm: REALM,
              profileUrl,
              deedId,
              ...feed,
            },
            `deed:${accountId}:${deedId}`,
            now,
          );
        }
        if (marquee) {
          return this.social.broadcastDeedUnlock({ characterId, name }, deedId);
        }
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
    // Fail closed while the candidate's block list is still loading: showing
    // them in /who before we know their blocks could leak presence to
    // someone they've blocked.
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

  private sendCommandOutcome(session: ClientSession, msg: ClientMessage, succeeded: boolean): void {
    if (!Number.isSafeInteger(msg.rid) || (msg.rid ?? 0) <= 0) return;
    this.send(session, { t: 'commandOutcome', rid: msg.rid, ok: succeeded });
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
