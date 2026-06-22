import type { WebSocket } from 'ws';
import { Sim } from '../src/sim/sim';
import type { PlayerMeta } from '../src/sim/sim';
import { DT, Entity, EQUIP_SLOTS, EquipSlot, RUN_SPEED, SimEvent, dist2d, emptyMoveInput } from '../src/sim/types';
import { parseMoveInputFrame } from '../src/sim/move_input';
import { verifyChallenge } from '../src/sim/client_challenge';
import { stealthDetectionRadius, threatEntries } from '../src/sim/threat';
import { zoneAt, DUNGEONS } from '../src/sim/data';
import { MECH_CHROMAS, mechChromaItemId, mechChromaSkinIndex } from '../src/sim/content/skins';
import {
  grantAccountMechChroma, markAccountQuestComplete, revokeAccountMechChroma, saveCharacterState, openPlaySession, closePlaySession,
  insertChatLogs, pool, loadMarketState, saveMarketState, walletForAccount,
} from './db';
import { holderInfoForPubkey } from './woc_balance';
import type { AccountChatMuteStatus, AccountCosmetics, RequestMetadata } from './db';
import { ChatFilter } from './chat_filter';
import { loadChatFilterState, applyChatStrike, recordChatViolation } from './chat_filter_db';
import { IpBlockList } from './ip_block';
import { loadActiveBlockedIps } from './ip_block_db';
import { offensiveName } from './auth';
import { ChatLogger } from './chat_log';
import { SocialService } from './social';
import type { Presence, PresenceStatus, SocialActor, SocialEvent, SocialTransport } from './social';
import { PgSocialDb } from './social_db';
import { REALM } from './realm';
import { isOverheadEmoteId } from '../src/world_api';
import { createBotDetector } from '#bot-detector';
import type { BotDetector, BotTrackingContext } from './bot_detector/contract';

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
const AUTOSAVE_SECONDS = 30;
const SAVE_CONCURRENCY = 4;
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

// How often to re-broadcast online players' $WOC holder-tier flair. Each wallet
// read is served from the woc_balance.ts cache (CACHE_TTL_MS), which is the real
// freshness floor; keeping this loop at/under that TTL means a token change shows
// on the in-world badge within ~one cache window of it landing on chain.
const HOLDER_TIER_REFRESH_MS = 60_000;

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
  if (e.holderTier) out.ht = e.holderTier; // $WOC holder-tier flair (cosmetic)
  if (e.holderBalance) out.hb = Math.round(e.holderBalance); // exact $WOC, for inspect
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
    x: round2(e.pos.x), y: round2(e.pos.y), z: round2(e.pos.z), f: round2(e.facing),
    hp: e.hp, mhp: e.maxHp,
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
  }
  // top hate-table entries so the party threat meter shows real numbers
  if (e.kind === 'mob' && !e.dead && e.threat.size > 0) out.thr = threatEntries(e, 8);
  if (e.auras.length > 0) {
    out.auras = e.auras.map((a): WireAura => ({ id: a.id, name: a.name, kind: a.kind, rem: round2(a.remaining), dur: a.duration }));
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
  return e.auras.some((a) => a.kind === 'stealth');
}

// full rate close up and for anything the viewer is fighting; mid range
// updates every other tick, far entities every fourth. Measured against
// the per-session last-sent tick rather than a tick-parity stagger: when
// the event loop degrades and one broadcast covers several sim ticks, a
// parity check can stay permanently false and starve entities frozen
function isUpdateDue(tick: number, e: Entity, d2: number, viewer: Entity, sentAtTick: number): boolean {
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

// Human-readable mute duration for player-facing notices ("10 minutes").
function formatDuration(seconds: number): string {
  const s = Math.max(1, Math.round(seconds));
  if (s < 60) return `${s} second${s === 1 ? '' : 's'}`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} minute${m === 1 ? '' : 's'}`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? '' : 's'}`;
  const d = Math.round(h / 24);
  return `${d} day${d === 1 ? '' : 's'}`;
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
  private wireCache = new Map<number, EntityWireCache>();
  private lastWireSweepTick = 0;
  private interval: NodeJS.Timeout | null = null;
  private holderTierInterval: NodeJS.Timeout | null = null;
  private holderTierRefreshing = false; // overlap guard for the refresh cycle
  // pids whose holder tier was forced via the dev /woctier command — the chain
  // refresh leaves them alone so the override sticks during testing (dev only).
  private devTierPids = new Set<number>();
  private saveTimer = 0;
  private socialPosTimer = 0;
  private saveAllInFlight: Promise<void> | null = null;
  private readonly characterSaveQueues = new Map<number, Promise<void>>();
  private restartCountdownStartedAt: number | null = null;
  private readonly restartCountdownTimers: NodeJS.Timeout[] = [];
  private readonly startedAt = Date.now();
  private peakOnline = 0;
  private tickMsAvg = 0;
  private readonly ipSessionCounts = new Map<string, number>();

  constructor() {
    this.sim = new Sim({
      seed: WORLD_SEED,
      playerClass: 'warrior',
      noPlayer: true,
      devCommands: process.env.ALLOW_DEV_COMMANDS === '1',
      lockoutNowMs: () => Date.now(),
    });
    this.social = new SocialService(this.socialDb, this.socialTransport());
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
      if (s.name.toLowerCase() === lower) { ci = s; ciCount++; }
    }
    return ciCount === 1 ? ci : null;
  }

  // Live location + activity of an online character, for friend/guild rosters.
  private presenceOf(session: ClientSession): Presence {
    const e = this.sim.entities.get(session.pid);
    if (!e) return { zone: 'Unknown', status: 'online' };
    let status: PresenceStatus = 'online';
    if (e.dead) status = 'dead';
    else if (e.dungeonId) status = 'dungeon';
    else if (e.inCombat) status = 'combat';
    const zone = e.dungeonId ? (DUNGEONS[e.dungeonId]?.name ?? e.dungeonId) : zoneAt(e.pos.z).name;
    return { zone, status, x: e.pos.x, z: e.pos.z };
  }

  private socialTransport(): SocialTransport {
    const actor = (s: ClientSession): SocialActor => ({ characterId: s.characterId, name: s.name });
    return {
      byCharacterId: (id) => { const s = this.sessionByCharacterId(id); return s ? actor(s) : null; },
      byName: (name) => { const s = this.sessionByName(name); return s ? actor(s) : null; },
      isOnline: (id) => this.sessionByCharacterId(id) !== null,
      locationOf: (id) => { const s = this.sessionByCharacterId(id); return s ? this.presenceOf(s) : null; },
      deliver: (id, events) => {
        const s = this.sessionByCharacterId(id);
        if (s) this.send(s, { t: 'events', list: events });
      },
      pushSnapshot: (id) => { void this.sendSocialSnapshot(id); },
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
      const now = process.hrtime.bigint();
      let dt = Number(now - last) / 1e9;
      last = now;
      if (dt > 0.5) dt = 0.5;
      acc += dt;
      while (acc >= DT) {
        this.clearStaleInputs();
        const events = this.sim.tick();
        this.routeEvents(events);
        this.runAntibotTick();
        acc -= DT;
      }
      this.broadcastSnapshots();
      this.socialPosTimer += dt;
      if (this.socialPosTimer >= 1) {
        this.socialPosTimer = 0;
        this.broadcastSocialPositions();
      }
      const tickMs = Number(process.hrtime.bigint() - now) / 1e6;
      this.tickMsAvg = this.tickMsAvg === 0 ? tickMs : this.tickMsAvg + TICK_EMA_ALPHA * (tickMs - this.tickMsAvg);
      this.saveTimer += dt;
      if (this.saveTimer >= AUTOSAVE_SECONDS) {
        this.saveTimer = 0;
        void this.saveAll('autosave');
        void this.saveMarket();
      }
    }, 50);
    // Refresh every online player's $WOC holder-tier flair off the 20 Hz loop:
    // an RPC call per wallet (cached for minutes inside holderInfoForPubkey) has
    // no place in the tick. Catches mid-session balance changes.
    this.holderTierInterval = setInterval(() => { void this.refreshAllHolderTiers(); }, HOLDER_TIER_REFRESH_MS);
  }

  stop(): void {
    if (this.interval) clearInterval(this.interval);
    if (this.holderTierInterval) clearInterval(this.holderTierInterval);
  }

  // Update one player's holder-tier flair from their linked wallet's $WOC
  // balance. Best-effort and guarded against the player leaving mid-fetch.
  private async refreshHolderTier(session: ClientSession): Promise<void> {
    if (this.devTierPids.has(session.pid)) return; // dev override pinned this pid
    const wallet = await walletForAccount(session.accountId);
    const { tier, balance } = wallet ? await holderInfoForPubkey(wallet.pubkey) : { tier: 0, balance: 0 };
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

  private async refreshAllHolderTiers(): Promise<void> {
    if (this.holderTierRefreshing) return; // a slow cycle (RPC) must not pile up
    this.holderTierRefreshing = true;
    try {
      await Promise.all([...this.clients.values()].map((session) =>
        this.refreshHolderTier(session).catch((err) => console.error('holder-tier refresh failed:', err))));
    } finally {
      this.holderTierRefreshing = false;
    }
  }

  // -------------------------------------------------------------------------

  private runAntibotTick(): void {
    const now = Date.now();
    for (const session of this.clients.values()) {
      const action = this.botDetector.handleTick(session.botTrackingContext, now, ANTIBOT_ENFORCE);
      if (action === 'kick') {
        void this.leave(session, 'disconnected');
      }
    }
  }

  private clearStaleInputs(): void {
    for (const session of this.clients.values()) {
      if (this.sim.time - session.lastInputAt <= STALE_INPUT_SECONDS) continue;
      const meta = this.sim.meta(session.pid);
      if (!meta) continue;
      const mi = meta.moveInput;
      if (!(mi.forward || mi.back || mi.turnLeft || mi.turnRight || mi.strafeLeft || mi.strafeRight || mi.jump)) continue;
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

  private rememberAccountCosmetics(accountId: number, cosmetics: AccountCosmetics): AccountCosmetics {
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
    meta: RequestMetadata & Partial<AccountChatMuteStatus> & { accountCosmetics?: AccountCosmetics; chatStrikes?: number; isAdmin?: boolean; clientSeed?: string } = {},
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
    const pid = this.sim.addPlayer(cls, name, { state: state ?? undefined });
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
    const botTrackingContext = this.botDetector.createTrackingContext({ accountId, characterId, name, ip: sessionIp }, meta);
    const session: ClientSession = {
      ws, accountId, accountCosmetics, characterId, pid, name,
      lastSave: Date.now(), alive: true, joinedAt: Date.now(), dbSessionId: null, left: false,
      chatTokens: CHAT_RATE_BURST, chatLastRefill: Date.now() / 1000, chatLastRateError: 0,
      chatRateViolations: 0, chatCooldownUntil: 0,
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
      sentEnts: new Map(),
      ip: sessionIp,
      isAdmin: meta.isAdmin ?? false,
      clientSeed: meta.clientSeed ?? '',
      botTrackingContext,
    };
    this.ipSessionCounts.set(sessionIp, (this.ipSessionCounts.get(sessionIp) ?? 0) + 1);
    this.clients.set(pid, session);
    this.sessionsByCharacterId.set(characterId, session);
    this.peakOnline = Math.max(this.peakOnline, this.clients.size);
    openPlaySession(accountId, characterId, name, meta)
      .then((id) => {
        session.dbSessionId = id;
        // If the player disconnected before this insert landed, leave() saw a
        // null id and skipped the close. Close it now so the row isn't orphaned.
        if (session.left) {
          void closePlaySession(id).catch((err) => console.error('failed to close play session:', err));
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
    this.send(session, { t: 'events', list: [{ type: 'log', text: `${name} has entered World of ClaudeCraft.`, color: '#ffd100' }] });
    void this.initSocial(session);
    // Stamp the $WOC holder-tier flair (best-effort: a balance read must never
    // affect joining the world).
    void this.refreshHolderTier(session).catch((err) => console.error('holder-tier refresh failed:', err));
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
    await this.social.announcePresence({ characterId: session.characterId, name: session.name }, true)
      .catch((err) => console.error('presence announce failed:', err));
  }

  async leave(session: ClientSession, reason: string): Promise<void> {
    if (session.left || !this.clients.has(session.pid)) return;
    session.left = true;
    this.clients.delete(session.pid);
    this.botDetector.releaseTrackingContext(session.botTrackingContext);
    if (session.ip) {
      const prev = this.ipSessionCounts.get(session.ip) ?? 1;
      if (prev <= 1) this.ipSessionCounts.delete(session.ip);
      else this.ipSessionCounts.set(session.ip, prev - 1);
    }
    this.devTierPids.delete(session.pid);
    this.social.forget(session.characterId);
    // delete from clients first so friends see them as offline in the notice
    void this.social.announcePresence({ characterId: session.characterId, name: session.name }, false)
      .catch((err) => console.error('presence announce failed:', err));
    if (session.dbSessionId !== null) {
      void closePlaySession(session.dbSessionId).catch((err) => console.error('failed to close play session:', err));
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
        await this.saveCharacter(session);
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

  async saveCharacter(session: ClientSession): Promise<void> {
    const previous = this.characterSaveQueues.get(session.characterId);
    const run = (previous ? previous.catch(() => {}) : Promise.resolve()).then(async () => {
      const state = this.sim.serializeCharacter(session.pid);
      const e = this.sim.entities.get(session.pid);
      if (state && e) {
        // Use the SERIALIZED level (not e.level): during a 2v2 Fiesta bout e.level
        // is temporarily 20, but serializeCharacter reports the real level — so the
        // character-list/leaderboard `level` column never reflects the temp state.
        await saveCharacterState(session.characterId, state.level, state);
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
        await this.saveCharacter(session).catch((err) => console.error(`${reason} failed for ${session.name}:`, err));
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
      await saveMarketState(this.sim.serializeMarket());
    } catch (err) {
      console.error('failed to save world market:', err);
    }
  }

  // Close every open play_sessions row; called on graceful shutdown so the
  // sessions of currently-online players keep their real duration.
  async endAllPlaySessions(): Promise<void> {
    for (const session of this.clients.values()) {
      if (session.dbSessionId === null) continue;
      await closePlaySession(session.dbSessionId).catch((err) => console.error('failed to close play session:', err));
    }
  }

  // -------------------------------------------------------------------------
  // Admin dashboard views (read-only)
  // -------------------------------------------------------------------------

  adminStats(): AdminServerStats {
    const mem = process.memoryUsage();
    return {
      online: this.clients.size,
      peakOnline: this.peakOnline,
      uptimeSeconds: Math.round((Date.now() - this.startedAt) / 1000),
      tickMsAvg: Math.round(this.tickMsAvg * 100) / 100,
      simEntities: this.sim.entities.size,
      rssBytes: mem.rss,
      heapUsedBytes: mem.heapUsed,
    };
  }

  liveSessions(): AdminLivePlayer[] {
    const now = Date.now();
    const players: AdminLivePlayer[] = [];
    for (const session of this.clients.values()) {
      const e = this.sim.entities.get(session.pid);
      const meta = this.sim.meta(session.pid);
      if (!e || !meta) continue;
      const zone = e.dungeonId
        ? (DUNGEONS[e.dungeonId]?.name ?? e.dungeonId)
        : zoneAt(e.pos.z).name;
      const moveSpeedMultiplier = round2((this.sim as any).moveSpeedMult(e));
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

  reportTargetForPid(pid: number): { accountId: number; characterId: number; characterName: string } | null {
    const session = this.clients.get(pid);
    return session
      ? { accountId: session.accountId, characterId: session.characterId, characterName: session.name }
      : null;
  }

  disconnectAccount(accountId: number, reason: string): void {
    for (const session of [...this.clients.values()]) {
      if (session.accountId !== accountId) continue;
      this.send(session, { t: 'error', error: reason });
      try { session.ws.close(); } catch { /* connection already closing */ }
      void this.leave(session, 'moderation action');
    }
  }

  // Force-disconnect the live session (if any) for a character the requesting
  // account owns, so a fresh login can take its place. Awaits leave() so the
  // departing session's state is saved and the sessionsByCharacterId slot is
  // freed before the caller re-enters — otherwise the new login would race the
  // old save (clobbering progress) or be rejected with "character already in
  // world". Idempotent: a no-op (returns 'not-online') when nobody is online.
  async takeOverCharacter(accountId: number, characterId: number): Promise<'taken-over' | 'not-online'> {
    const session = this.sessionByCharacterId(characterId);
    // Ownership is also enforced at the REST layer; re-check here so this method
    // can never disconnect a session that belongs to another account.
    if (!session || session.accountId !== accountId) return 'not-online';
    this.send(session, { t: 'error', error: 'character taken over' });
    try { session.ws.close(); } catch { /* connection already closing */ }
    await this.leave(session, 'character taken over');
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
      this.send(session, { t: 'events', list: [{ type: 'error', text: this.chatMuteMessage(session) }] });
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
      this.send(session, { t: 'error', error: reason });
      try { session.ws.close(); } catch { /* connection already closing */ }
      void this.leave(session, 'moderation action');
    }
  }

  disconnectBlockedSessions(reason: string): void {
    const now = Date.now();
    for (const session of [...this.clients.values()]) {
      if (session.isAdmin || !this.ipBlockList.isBlocked(session.ip, now)) continue;
      this.send(session, { t: 'error', error: reason });
      try { session.ws.close(); } catch { /* connection already closing */ }
      void this.leave(session, 'moderation action');
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
    let msg: any;
    try {
      msg = JSON.parse(raw);
    } catch {
      this.botDetector.observeProtocolAnomaly(session.botTrackingContext, 'invalid_json', raw, receivedAtMs);
      return;
    }
    // a malformed payload must never take down the server for everyone
    try {
      this.dispatchMessage(session, msg, raw, receivedAtMs);
    } catch (err) {
      console.error(`bad message from ${session.name} (cmd: ${String(msg?.cmd ?? msg?.t)}):`, err);
    }
  }

  private dispatchMessage(session: ClientSession, msg: any, raw: string, receivedAtMs: number): void {
    // JSON.parse returns null / numbers / strings / arrays for valid JSON that
    // isn't an object — `null` in particular threw on `msg.t`. Drop anything
    // that isn't a plain object before touching its fields.
    if (typeof msg !== 'object' || msg === null || Array.isArray(msg)) {
      this.botDetector.observeProtocolAnomaly(session.botTrackingContext, 'non_object', raw, receivedAtMs);
      return;
    }
    const sim = this.sim;
    const pid = session.pid;
    if (msg.t === 'input') {
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
      this.botDetector.observeProtocolAnomaly(session.botTrackingContext, 'unknown_type', raw, receivedAtMs);
      return;
    }
    this.botDetector.observeCommand(session.botTrackingContext, String(msg.cmd ?? ''), receivedAtMs, msg);
    switch (msg.cmd) {
      case 'castSlot': sim.castAbilityBySlot(msg.slot | 0, pid); break;
      case 'cast': if (typeof msg.ability === 'string') sim.castAbility(msg.ability, pid); break;
      case 'target': sim.targetEntity(typeof msg.id === 'number' ? msg.id : null, pid); break;
      case 'tab': sim.tabTarget(pid); break;
      case 'targetNearest': sim.targetNearestEnemy(pid); break;
      case 'tabFriendly': sim.friendlyTabTarget(pid); break;
      case 'targetNearestFriendly': sim.targetNearestFriendly(pid); break;
      case 'attack': sim.startAutoAttack(pid); break;
      case 'stopattack': sim.stopAutoAttack(pid); break;
      case 'interact': sim.interact(pid); break;
      case 'loot': if (typeof msg.id === 'number') sim.lootCorpse(msg.id, pid); break;
      case 'lootRoll':
        if (typeof msg.rollId === 'number' && (msg.choice === 'need' || msg.choice === 'greed' || msg.choice === 'pass')) {
          sim.submitLootRoll(msg.rollId, msg.choice, pid);
        }
        break;
      case 'pickup': if (typeof msg.id === 'number') sim.pickUpObject(msg.id, pid); break;
      case 'accept': if (typeof msg.quest === 'string') { sim.acceptQuest(msg.quest, pid); this.resyncQuests(session); } break;
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
      case 'abandon': if (typeof msg.quest === 'string') { sim.abandonQuest(msg.quest, pid); this.resyncQuests(session); } break;
      case 'equip': if (typeof msg.item === 'string') sim.equipItem(msg.item, pid); break;
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
      case 'buy': if (typeof msg.npc === 'number' && typeof msg.item === 'string') sim.buyItem(msg.npc, msg.item, pid); break;
      case 'sell':
        if (typeof msg.item === 'string') {
          sim.sellItem(msg.item, typeof msg.count === 'number' ? msg.count : undefined, pid);
        }
        break;
      case 'buyback': if (typeof msg.item === 'string') sim.buyBackItem(msg.item, pid); break;
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
      case 'release': sim.releaseSpirit(pid); break;
      case 'challengeResponse':
        if (typeof msg.n === 'string' && typeof msg.r === 'string' && typeof msg.sig === 'string') {
          if (!verifyChallenge(msg.n, msg.r, msg.sig, session.clientSeed)) break;
        }
        break;
      case 'chat': {
        if (typeof msg.text !== 'string') break;
        if (this.isChatMuted(session)) break;
        if (!this.consumeChatToken(session)) break;
        const text = msg.text.trim();
        if (/^\/who(?:\s|$)/i.test(text)) {
          this.sendWhoRoster(session);
          break;
        }
        // Hard-word + mute enforcement gate, applied to every channel before the
        // message is routed anywhere. Soft (cosmetic) words are NOT touched here
        // — clients mask those locally when their profanity filter is on.
        if (this.enforceChatPolicy(session, text)) break;
        // guild and officer chat are persistent + cross-zone, so they live in
        // the server's SocialService rather than the sim (no guild concept).
        // MMO convention: /g is guild; /general remains world chat.
        const gm = /^\/(?:g|gu|guild)\s+([\s\S]+)$/i.exec(text);
        const om = gm ? null : /^\/(?:o|officer)\s+([\s\S]+)$/i.exec(text);
        if (gm || om) {
          const channel = gm ? 'guild' : 'officer';
          const body = (gm ?? om!)[1];
          session.rememberedChat = { channel };
          const route = gm ? this.social.guildChat(this.actorFor(session), body)
            : this.social.officerChat(this.actorFor(session), body);
          void route.then((sent) => {
            if (sent) {
              this.chatLog.log({
                accountId: session.accountId, characterId: session.characterId,
                characterName: session.name, channel, message: body.trim().slice(0, 200),
              });
            }
          }).catch((err) => console.error(`${channel} chat failed:`, err));
          break;
        }
        // /r: reply to whoever last whispered you
        const rm = /^\/(?:r|reply)\s+([\s\S]+)$/i.exec(text);
        if (rm) {
          if (!session.lastWhisperFrom) {
            this.send(session, { t: 'events', list: [{ type: 'error', text: 'No one has whispered you recently.' }] });
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
      case 'pinvite': if (typeof msg.id === 'number') sim.partyInvite(msg.id, pid); break;
      case 'paccept': sim.partyAccept(pid); break;
      case 'pdecline': sim.partyDecline(pid); break;
      case 'pleave': sim.partyLeave(pid); break;
      case 'pkick': if (typeof msg.id === 'number') sim.partyKick(msg.id, pid); break;
      case 'praid': sim.convertPartyToRaid(pid); break;
      case 'pmoveRaid': if (typeof msg.id === 'number' && (msg.group === 1 || msg.group === 2)) sim.moveRaidMember(msg.id, msg.group, pid); break;
      // raid/target markers
      case 'setMarker': if (typeof msg.id === 'number' && typeof msg.marker === 'number') sim.setMarker(msg.id, msg.marker, pid); break;
      case 'clearMarker': if (typeof msg.id === 'number') sim.clearMarker(msg.id, pid); break;
      // hunter pets
      case 'pet_abandon': sim.abandonPet(pid); break;
      case 'pet_rename':
        if (typeof msg.name === 'string') {
          if (offensiveName(msg.name)) this.send(session, { t: 'events', list: [{ type: 'error', text: 'Pet name is not allowed.' }] });
          else sim.renamePet(msg.name, pid);
        }
        break;
      case 'pet_revive': sim.revivePet(pid); break;
      case 'pet_attack': sim.petAttack(pid); break;
      case 'pet_taunt': sim.petTaunt(pid); break;
      case 'pet_feed': if (typeof msg.item === 'string') sim.feedPet(msg.item, pid); break;
      case 'pet_heal': sim.healPet(pid); break;
      case 'pet_mode':
        if (msg.mode === 'passive' || msg.mode === 'defensive' || msg.mode === 'aggressive') sim.setPetMode(msg.mode, pid);
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
      case 'trade_confirm': sim.tradeConfirm(pid); break;
      case 'trade_cancel': sim.tradeCancel(pid); break;
      // duels
      case 'duel_req': if (typeof msg.id === 'number') sim.duelRequest(msg.id, pid); break;
      case 'duel_accept': sim.duelAccept(pid); break;
      case 'duel_decline': sim.duelDecline(pid); break;
      // social: friends / ignore / guild (persistent, account-scoped)
      case 'friend_add': if (typeof msg.name === 'string') void this.social.friendAdd(this.actorFor(session), msg.name).catch(logSocialErr); break;
      case 'friend_remove': if (typeof msg.name === 'string') void this.social.friendRemove(this.actorFor(session), msg.name).catch(logSocialErr); break;
      case 'block_add': if (typeof msg.name === 'string') void this.social.blockAdd(this.actorFor(session), msg.name).catch(logSocialErr); break;
      case 'block_remove': if (typeof msg.name === 'string') void this.social.blockRemove(this.actorFor(session), msg.name).catch(logSocialErr); break;
      case 'social_refresh': void this.sendSocialSnapshot(session.characterId); break;
      case 'guild_create': if (typeof msg.name === 'string') void this.social.guildCreate(this.actorFor(session), msg.name).catch(logSocialErr); break;
      case 'guild_invite': if (typeof msg.name === 'string') void this.social.guildInvite(this.actorFor(session), msg.name).catch(logSocialErr); break;
      case 'guild_accept': void this.social.guildAccept(this.actorFor(session)).catch(logSocialErr); break;
      case 'guild_decline': this.social.guildDecline(this.actorFor(session)); break;
      case 'guild_leave': void this.social.guildLeave(this.actorFor(session)).catch(logSocialErr); break;
      case 'guild_kick': if (typeof msg.name === 'string') void this.social.guildKick(this.actorFor(session), msg.name).catch(logSocialErr); break;
      case 'guild_promote': if (typeof msg.name === 'string') void this.social.guildSetRank(this.actorFor(session), msg.name, 'officer').catch(logSocialErr); break;
      case 'guild_demote': if (typeof msg.name === 'string') void this.social.guildSetRank(this.actorFor(session), msg.name, 'member').catch(logSocialErr); break;
      case 'guild_transfer': if (typeof msg.name === 'string') void this.social.guildTransferLeader(this.actorFor(session), msg.name).catch(logSocialErr); break;
      case 'guild_disband': void this.social.guildDisband(this.actorFor(session)).catch(logSocialErr); break;
      // arena (Ashen Coliseum queue)
      case 'arena_queue': {
        const fmt = msg.format === '2v2' ? '2v2' : msg.format === 'fiesta' ? 'fiesta' : '1v1';
        sim.arenaQueueJoin(pid, fmt);
        break;
      }
      case 'arena_leave': sim.arenaQueueLeave(pid); break;
      case 'arena_augment': {
        if (typeof msg.augment === 'string' && msg.augment.length <= 64) sim.arenaAugmentPick(msg.augment, pid);
        break;
      }

      // post-cap cosmetic prestige (Max-Level XP Overflow)
      case 'prestige': sim.prestige(pid); break;

      // Talents & Specializations — every allocation re-validated in the Sim.
      case 'applyTalents': {
        const a = msg.alloc;
        if (a && typeof a === 'object') {
          sim.applyTalents({
            spec: typeof a.spec === 'string' ? a.spec : null,
            ranks: (a.ranks && typeof a.ranks === 'object') ? a.ranks : {},
            choices: (a.choices && typeof a.choices === 'object') ? a.choices : {},
          }, pid);
        }
        break;
      }
      case 'respec': sim.respec(pid); break;
      case 'setSpec': sim.setSpec(typeof msg.spec === 'string' ? msg.spec : null, pid); break;
      case 'saveLoadout': {
        const a = msg.alloc;
        const alloc = a && typeof a === 'object'
          ? {
            spec: typeof a.spec === 'string' ? a.spec : null,
            ranks: (a.ranks && typeof a.ranks === 'object') ? a.ranks : {},
            choices: (a.choices && typeof a.choices === 'object') ? a.choices : {},
          }
          : undefined;
        if (typeof msg.name === 'string') sim.saveLoadout(msg.name, Array.isArray(msg.bar) ? msg.bar : [], pid, alloc);
        break;
      }
      case 'switchLoadout': if (typeof msg.index === 'number') sim.switchLoadout(msg.index | 0, pid); break;
      case 'deleteLoadout': if (typeof msg.index === 'number') sim.deleteLoadout(msg.index | 0, pid); break;
      // World Market (the Merchant's auction house)
      case 'market_search': if (typeof msg.q === 'string') sim.marketSearch(msg.q, pid); break;
      case 'market_list':
        if (typeof msg.item === 'string' && Number.isFinite(msg.count) && Number.isFinite(msg.price)) {
          sim.marketList(msg.item, msg.count, msg.price, pid);
        }
        break;
      case 'market_buy': if (typeof msg.id === 'number') sim.marketBuy(msg.id, pid); break;
      case 'market_cancel': if (typeof msg.id === 'number') sim.marketCancel(msg.id, pid); break;
      case 'market_collect': sim.marketCollect(pid); break;
      // dev/ops commands, only when ALLOW_DEV_COMMANDS=1 (never in production)
      case 'dev_level': {
        if (process.env.ALLOW_DEV_COMMANDS === '1' && typeof msg.level === 'number') {
          sim.setPlayerLevel(msg.level, pid);
        }
        break;
      }
      case 'dev_teleport': {
        if (process.env.ALLOW_DEV_COMMANDS === '1' && typeof msg.x === 'number' && typeof msg.z === 'number') {
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
          sim.addItem(msg.item, Math.max(1, Math.min(20, msg.count | 0)), pid);
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
        const door = [...sim.entities.values()].find((x) => x.templateId === 'dungeon_door' && x.dungeonId === dungeonId);
        if (e && door && Math.hypot(e.pos.x - door.pos.x, e.pos.z - door.pos.z) < 8) sim.enterDungeon(dungeonId, pid);
        break;
      }
      case 'leave_crypt':
      case 'leave_dungeon': {
        const e = sim.entities.get(pid);
        const exit = e ? [...sim.entities.values()].find((x) => x.templateId === 'dungeon_exit' && Math.hypot(e.pos.x - x.pos.x, e.pos.z - x.pos.z) < 8) : null;
        if (exit) sim.leaveDungeon(pid);
        break;
      }
      // client telemetry should not be considered as unknown command. Used for offline stats computing.
      case 'telemetry':
        break;
      default:
        this.botDetector.observeProtocolAnomaly(session.botTrackingContext, 'unknown_command', raw, receivedAtMs);
    }
  }

  // -------------------------------------------------------------------------
  // Snapshots & events
  // -------------------------------------------------------------------------

  private broadcastSnapshots(): void {
    if (this.clients.size === 0) return;
    const tick = this.sim.tickCount;
    const head = `{"t":"snap","tick":${tick},"time":${round2(this.sim.time)}`;
    for (const session of this.clients.values()) {
      const p = this.sim.entities.get(session.pid);
      const meta = this.sim.meta(session.pid);
      if (!p || !meta) continue;
      const ents: string[] = [];
      const keep: number[] = [];
      const present = new Set<number>();
      this.sim.grid.forEachInRadius(p.pos.x, p.pos.z, INTEREST_QUERY_RADIUS, (e, d2) => {
        if (e.id === session.pid) return;
        if (!this.canObserveEntity(p, e, d2)) return;
        const known = session.sentEnts.get(e.id);
        // the viewer's current target stays in interest to the widest drop
        // radius so its unit frame doesn't vanish mid-chase
        const limitSq = p.targetId === e.id
          ? NPC_DROP_RADIUS * NPC_DROP_RADIUS
          : interestLimitSq(e, known !== undefined);
        if (d2 > limitSq) return;
        present.add(e.id);
        const cache = this.wireCacheFor(e);
        if (known === undefined) {
          // first sight carries the at-rest state exactly, so no settle
          // record is owed until it moves again
          ents.push(cache.fullJson);
          session.sentEnts.set(e.id, { idVer: cache.idVer, dynVer: cache.dynVer, sentAtTick: tick, settled: true });
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
        if (!isUpdateDue(tick, e, d2, p, known.sentAtTick) || (known.dynVer === cache.dynVer && known.settled)) {
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
      });
      // forget entities that left interest, so a re-entry sends identity again
      for (const id of session.sentEnts.keys()) {
        if (!present.has(id)) session.sentEnts.delete(id);
      }
      const keepJson = keep.length > 0 ? `,"keep":[${keep.join(',')}]` : '';
      this.sendRaw(session, `${head},"self":${this.selfWireJson(session, p, meta)},"ents":[${ents.join(',')}]${keepJson}}`);
    }
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
      cache = { tick: -1, idJson: '', dynJson: '', idVer: 0, dynVer: 0, fullJson: '', liteJson: '' };
      this.wireCache.set(e.id, cache);
    }
    if (cache.tick === this.sim.tickCount) return cache;
    cache.tick = this.sim.tickCount;
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
    return cache;
  }

  private sweepWireCache(): void {
    for (const id of this.wireCache.keys()) {
      if (!this.sim.entities.has(id)) this.wireCache.delete(id);
    }
  }

  private selfWireJson(session: ClientSession, p: Entity, meta: PlayerMeta): string {
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
      swing: round2(p.swingTimer),
      combo: p.comboPoints,
      comboTgt: p.comboTargetId,
      target: p.targetId,
      auto: p.autoAttack,
      queued: p.queuedOnSwing,
      ap: p.attackPower,
      crit: p.critChance,
      dodge: p.dodgeChance,
      eat: p.eating ? { remaining: round2(p.eating.remaining) } : null,
      drk: p.drinking ? { remaining: round2(p.drinking.remaining) } : null,
      opUntil: p.overpowerUntil > this.sim.time ? 1 : 0,
      ack: session.lastInputSeq,
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
    maybe('inv', meta.inventory);
    maybe('buyback', meta.vendorBuyback);
    maybe('equip', meta.equipment);
    maybe('cosmetics', session.accountCosmetics);
    maybe('qlog', [...meta.questLog.values()]);
    maybe('qdone', [...meta.questsDone]);
    maybe('milestones', [...meta.unlockedMilestones]);
    maybe('cds', Object.fromEntries([...p.cooldowns.entries()].map(([k, v]) => [k, round2(v)])));
    maybe('stats', p.stats);
    maybe('weapon', p.weapon);
    maybe('party', this.partyWire(session.pid));
    maybe('marks', this.markersWire(session.pid));
    maybe('trade', this.tradeWire(session.pid));
    maybe('duel', this.duelWire(session.pid));
    maybe('arena', this.sim.arenaInfoFor(session.pid));
    // market info is null unless the player is standing at the Merchant, so it
    // only rides the wire for players actually browsing the World Market
    maybe('market', this.sim.marketInfoFor(session.pid));
    // talents/spec/loadouts ride the wire only when they change (PR-5: never
    // every snapshot). The client recomputes its known abilities from this.
    maybe('tal', { alloc: meta.talents, spec: meta.talentMods.spec, role: meta.talentMods.role, loadouts: meta.loadouts, activeLoadout: meta.activeLoadout });
    return extra === '' ? json : json.slice(0, -1) + extra + '}';
  }

  private partyWire(pid: number): unknown {
    const party = this.sim.partyOf(pid);
    if (!party) return null;
    return {
      leader: party.leader,
      members: party.members.map((mPid) => {
        const meta = this.sim.meta(mPid);
        const e = this.sim.entities.get(mPid);
        return meta && e ? {
          pid: mPid, name: meta.name, cls: meta.cls, level: e.level,
          hp: e.hp, mhp: e.maxHp, res: Math.round(e.resource), mres: e.maxResource, rtype: e.resourceType,
          x: round2(e.pos.x), z: round2(e.pos.z), dead: e.dead ? 1 : 0, inCombat: e.inCombat ? 1 : 0,
        } : null;
      }).filter(Boolean),
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

  private routeEvents(events: SimEvent[]): void {
    if (events.length === 0 || this.clients.size === 0) return;
    const eventTime = Date.now();
    for (const session of this.clients.values()) {
      const p = this.sim.entities.get(session.pid);
      if (!p) continue;
      const mine: SimEvent[] = [];
      for (const ev of events) {
        // ignore list: drop chat originating from a character this player has
        // blocked, before it ever reaches their client
        if (ev.type === 'chat' && session.blockedIds.size > 0 && this.isBlockedSender(session, ev.fromPid)) continue;
        if (ev.pid !== undefined) {
          if (ev.pid === session.pid) {
            mine.push(ev);
            // remember the last person to whisper us, for /r reply (the
            // recipient copy of a whisper has no `to`; the sender echo does)
            if (ev.type === 'chat' && ev.channel === 'whisper' && ev.to === undefined && ev.fromPid !== session.pid) {
              session.lastWhisperFrom = ev.from;
            }
            this.botDetector.observeEvent(session.botTrackingContext, ev, eventTime);
          }
          continue;
        }
        // world events: only those near this player
        const anchor = this.eventAnchor(ev);
        if (anchor === null || dist2d(p.pos, anchor) <= EVENT_RADIUS) {
          mine.push(ev);
        }
      }
      if (mine.length > 0) this.send(session, { t: 'events', list: mine });
    }
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

  private routeRememberedChat(session: ClientSession, rawText: string, pid: number): import('../src/sim/sim').SentChat | null {
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
          const route = channel === 'guild'
            ? this.social.guildChat(this.actorFor(session), body)
            : this.social.officerChat(this.actorFor(session), body);
          void route.then((sent) => {
            if (sent) {
              this.chatLog.log({
                accountId: session.accountId, characterId: session.characterId,
                characterName: session.name, channel, message: body.trim().slice(0, 200),
              });
            }
          }).catch((err) => console.error(`${channel} chat failed:`, err));
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
        this.send(session, { t: 'events', list: [{ type: 'error', text: `Chat is on cooldown for ${remaining}s.` }] });
      }
      return false;
    }
    if (session.chatCooldownUntil > 0) {
      session.chatCooldownUntil = 0;
      session.chatRateViolations = 0;
      session.chatTokens = CHAT_RATE_BURST;
    }
    const elapsed = Math.max(0, now - session.chatLastRefill);
    session.chatTokens = Math.min(CHAT_RATE_BURST, session.chatTokens + elapsed * CHAT_RATE_REFILL_PER_SECOND);
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
      this.send(session, { t: 'events', list: [{ type: 'error', text: `Chat locked for ${CHAT_COOLDOWN_SECONDS}s because you are sending messages too quickly.` }] });
      return false;
    }
    if (now - session.chatLastRateError >= CHAT_RATE_ERROR_COOLDOWN_SECONDS) {
      session.chatLastRateError = now;
      this.send(session, { t: 'events', list: [{ type: 'error', text: 'You are sending messages too quickly. Slow down.' }] });
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
    this.send(session, { t: 'events', list: [{ type: 'error', text: this.chatMuteMessage(session) }] });
    return true;
  }

  private chatMuteMessage(session: ClientSession): string {
    const remainingMs = Math.max(0, (session.chatMutedUntil ?? Date.now()) - Date.now());
    const minutes = Math.max(1, Math.ceil(remainingMs / 60_000));
    const reason = session.chatMuteReason ? ` Reason: ${session.chatMuteReason}` : '';
    return `You are muted from chat for ${minutes} more minute${minutes === 1 ? '' : 's'}.${reason}`;
  }

  private sendWhoRoster(session: ClientSession): void {
    if (!session.blockListLoaded) {
      this.send(session, { t: 'events', list: [{ type: 'error', text: 'Your ignore list is still loading. Try /who again in a moment.' }] });
      return;
    }
    const rows = this.whoRosterFor(session);
    const total = rows.length;
    const list: { type: 'log'; text: string; color: string }[] = [{
      type: 'log',
      text: `Who: ${total} ${total === 1 ? 'player' : 'players'} online on ${REALM}.`,
      color: '#7fd4ff',
    }];
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
    if (candidate.characterId !== viewer.characterId && candidate.blockedIds.has(viewer.characterId)) return false;
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
  }

  private send(session: ClientSession, obj: unknown): void {
    this.sendRaw(session, JSON.stringify(obj));
  }

  private sendRaw(session: ClientSession, payload: string): void {
    if (session.ws.readyState === 1) {
      session.ws.send(payload);
    }
  }
}
