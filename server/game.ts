import { readFileSync } from 'node:fs';
import type { WebSocket } from 'ws';
import { Sim } from '../src/sim/sim';
import type { PlayerMeta } from '../src/sim/sim';
import { DT, Entity, SimEvent, dist2d } from '../src/sim/types';
import { parseMoveInputFrame } from '../src/sim/move_input';
import { stealthDetectionRadius, threatEntries } from '../src/sim/threat';
import { zoneAt, DUNGEONS } from '../src/sim/data';
import { saveCharacterState, openPlaySession, closePlaySession, insertChatLogs, pool, loadMarketState, saveMarketState } from './db';
import { ChatLogger } from './chat_log';
import { SocialService } from './social';
import type { Presence, PresenceStatus, SocialActor, SocialEvent, SocialTransport } from './social';
import { PgSocialDb } from './social_db';
import { REALM } from './realm';

const WORLD_SEED = 20061;
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
const CHAT_RATE_BURST = 5;
const CHAT_RATE_REFILL_PER_SECOND = 1 / 3; // sustained 20 messages/minute
const CHAT_RATE_ERROR_COOLDOWN_SECONDS = 4;
const CHAT_COOLDOWN_SECONDS = 20;
const CHAT_RATE_VIOLATIONS_FOR_COOLDOWN = 3;
const WHO_RESULT_LIMIT = 50;
// Exponential moving average weight for the per-tick duration stat.
const TICK_EMA_ALPHA = 0.05;

export interface ClientSession {
  ws: WebSocket;
  accountId: number;
  characterId: number;
  pid: number; // player entity id in the sim
  name: string;
  lastSave: number;
  alive: boolean;
  joinedAt: number;
  dbSessionId: number | null; // play_sessions row, set once the insert lands
  chatTokens: number;
  chatLastRefill: number;
  chatLastRateError: number;
  chatRateViolations: number;
  chatCooldownUntil: number;
  // character ids this player has ignored; chat from them is dropped before
  // delivery. Loaded from the DB on join, kept in sync by social commands.
  blockedIds: Set<number>;
  blockListLoaded: boolean;
  // name of the last player to whisper this session, for WoW's /r reply
  lastWhisperFrom: string | null;
  // last explicit channel this player sent to; plain text follows it.
  rememberedChat: RememberedChat;
  // serialized form of each delta self field as last sent to this client;
  // a field is omitted from a snapshot while its serialization is unchanged
  lastSent: Record<string, string>;
  // wire versions of each entity this client knows about: known entities
  // get identity-less "lite" records, unchanged ones ride in the keep list
  sentEnts: Map<number, SentEntityVersions>;
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
  | { channel: 'say' | 'yell' | 'general' | 'party' | 'guild' | 'officer' }
  | { channel: 'whisper'; target: string };

// Identity fields rarely change, so they ride only in "full" records: on an
// entity's first snapshot for a session and again whenever one of them
// changes. The client treats their absence in a record as "unchanged".
function identityFields(e: Entity): Record<string, unknown> {
  const out: Record<string, unknown> = { k: e.kind, tid: e.templateId, nm: e.name, lv: e.level };
  if (e.dungeonId) out.dgn = e.dungeonId;
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

const CONFUSABLE_CHARS: Record<string, string> = {
  '0': 'o',
  '1': 'i',
  '!': 'i',
  '|': 'i',
  '3': 'e',
  '4': 'a',
  '@': 'a',
  '5': 's',
  '$': 's',
  '7': 't',
  '+': 't',
  '8': 'b',
};

function normalizedCensorTerm(term: string): string {
  return term
    .toLowerCase()
    .replace(/[0134578!|@$+]/g, (ch) => CONFUSABLE_CHARS[ch] ?? ch)
    .replace(/[^a-z]/g, '');
}

function parseCensorList(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(/[\s,]+/)
    .map((term) => normalizedCensorTerm(term))
    .filter((term) => term.length > 0);
}

let censorCacheKey: string | null = null;
let censorCacheTerms: string[] = [];

function configuredChatCensorTerms(): string[] {
  const rawList = process.env.CHAT_CENSOR_LIST ?? '';
  const file = process.env.CHAT_CENSOR_FILE ?? '';
  const cacheKey = `${rawList}\0${file}`;
  if (cacheKey === censorCacheKey) return censorCacheTerms;

  const terms = parseCensorList(rawList);
  if (!file) {
    censorCacheTerms = terms;
    censorCacheKey = cacheKey;
    return censorCacheTerms;
  }
  try {
    censorCacheTerms = terms.concat(parseCensorList(readFileSync(file, 'utf8')));
  } catch (err) {
    console.warn(`could not read CHAT_CENSOR_FILE (${file}):`, err);
    return terms;
  }
  censorCacheKey = cacheKey;
  return censorCacheTerms;
}

export function censorChatText(text: string): string {
  const terms = configuredChatCensorTerms();
  if (terms.length === 0) return text;
  return text.replace(/[A-Za-z0-9_@$!|+]+/g, (token) => {
    const normalized = normalizedCensorTerm(token);
    return terms.some((term) => normalized.includes(term)) ? '*'.repeat(token.length) : token;
  });
}

export class GameServer {
  sim: Sim;
  clients = new Map<number, ClientSession>(); // by pid
  private readonly sessionsByCharacterId = new Map<number, ClientSession>();
  readonly chatLog = new ChatLogger(insertChatLogs);
  private readonly socialDb = new PgSocialDb(pool);
  readonly social: SocialService;
  private wireCache = new Map<number, EntityWireCache>();
  private lastWireSweepTick = 0;
  private interval: NodeJS.Timeout | null = null;
  private saveTimer = 0;
  private saveAllInFlight: Promise<void> | null = null;
  private readonly startedAt = Date.now();
  private peakOnline = 0;
  private tickMsAvg = 0;

  constructor() {
    this.sim = new Sim({ seed: WORLD_SEED, playerClass: 'warrior', noPlayer: true });
    this.social = new SocialService(this.socialDb, this.socialTransport());
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
    return { zone, status };
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
    };
  }

  private async sendSocialSnapshot(charId: number): Promise<void> {
    const session = this.sessionByCharacterId(charId);
    if (!session) return;
    try {
      const snap = await this.social.snapshot(charId);
      this.send(session, { t: 'social', ...snap });
    } catch (err) {
      console.error('social snapshot failed:', err);
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
        const events = this.sim.tick();
        this.routeEvents(events);
        acc -= DT;
      }
      this.broadcastSnapshots();
      const tickMs = Number(process.hrtime.bigint() - now) / 1e6;
      this.tickMsAvg = this.tickMsAvg === 0 ? tickMs : this.tickMsAvg + TICK_EMA_ALPHA * (tickMs - this.tickMsAvg);
      this.saveTimer += dt;
      if (this.saveTimer >= AUTOSAVE_SECONDS) {
        this.saveTimer = 0;
        void this.saveAll('autosave');
        void this.saveMarket();
      }
    }, 50);
  }

  stop(): void {
    if (this.interval) clearInterval(this.interval);
  }

  // -------------------------------------------------------------------------

  join(ws: WebSocket, accountId: number, characterId: number, name: string, cls: import('../src/sim/types').PlayerClass, state: import('../src/sim/sim').CharacterState | null, isGm = false): ClientSession | { error: string } {
    if (this.sessionsByCharacterId.has(characterId)) return { error: 'character already in world' };
    const pid = this.sim.addPlayer(cls, name, { state: state ?? undefined });
    if (isGm) {
      // GM characters: invulnerable, and always at the level cap (the row is
      // created without state, so the first join levels them up)
      this.sim.setGm(pid);
      const e = this.sim.entities.get(pid);
      if (e && e.level < 20) this.sim.setPlayerLevel(20, pid);
    }
    const session: ClientSession = {
      ws, accountId, characterId, pid, name,
      lastSave: Date.now(), alive: true, joinedAt: Date.now(), dbSessionId: null,
      chatTokens: CHAT_RATE_BURST, chatLastRefill: Date.now() / 1000, chatLastRateError: 0,
      chatRateViolations: 0, chatCooldownUntil: 0,
      blockedIds: new Set(),
      blockListLoaded: false,
      lastWhisperFrom: null,
      rememberedChat: { channel: 'say' },
      lastSent: {},
      sentEnts: new Map(),
    };
    this.clients.set(pid, session);
    this.sessionsByCharacterId.set(characterId, session);
    this.peakOnline = Math.max(this.peakOnline, this.clients.size);
    openPlaySession(accountId, characterId, name)
      .then((id) => { session.dbSessionId = id; })
      .catch((err) => console.error('failed to open play session:', err));

    this.send(session, {
      t: 'hello',
      pid,
      seed: this.sim.cfg.seed,
      name,
      cls,
      realm: REALM,
    });
    this.broadcastSystem(`${name} has entered World of Claudecraft.`);
    void this.initSocial(session);
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
    if (!this.clients.has(session.pid)) return;
    this.clients.delete(session.pid);
    this.sessionsByCharacterId.delete(session.characterId);
    this.social.forget(session.characterId);
    // delete from clients first so friends see them as offline in the notice
    void this.social.announcePresence({ characterId: session.characterId, name: session.name }, false)
      .catch((err) => console.error('presence announce failed:', err));
    if (session.dbSessionId !== null) {
      void closePlaySession(session.dbSessionId).catch((err) => console.error('failed to close play session:', err));
    }
    await this.saveCharacter(session).catch((err) => console.error('save on leave failed:', err));
    this.sim.removePlayer(session.pid);
    this.broadcastSystem(`${session.name} has left the world. (${reason})`);
  }

  async saveCharacter(session: ClientSession): Promise<void> {
    const state = this.sim.serializeCharacter(session.pid);
    const e = this.sim.entities.get(session.pid);
    if (state && e) {
      await saveCharacterState(session.characterId, e.level, state);
      session.lastSave = Date.now();
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

  // -------------------------------------------------------------------------
  // Input & commands
  // -------------------------------------------------------------------------

  handleMessage(session: ClientSession, raw: string): void {
    let msg: any;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    // a malformed payload must never take down the server for everyone
    try {
      this.dispatchMessage(session, msg);
    } catch (err) {
      console.error(`bad message from ${session.name} (cmd: ${String(msg?.cmd ?? msg?.t)}):`, err);
    }
  }

  private dispatchMessage(session: ClientSession, msg: any): void {
    // JSON.parse returns null / numbers / strings / arrays for valid JSON that
    // isn't an object — `null` in particular threw on `msg.t`. Drop anything
    // that isn't a plain object before touching its fields.
    if (typeof msg !== 'object' || msg === null || Array.isArray(msg)) return;
    const sim = this.sim;
    const pid = session.pid;
    if (msg.t === 'input') {
      const meta = sim.meta(pid);
      const e = sim.entities.get(pid);
      if (!meta || !e) return;
      const { moveInput, facing } = parseMoveInputFrame(msg);
      Object.assign(meta.moveInput, moveInput);
      if (facing !== null && !e.dead) {
        e.facing = facing;
      }
      return;
    }
    if (msg.t !== 'cmd') return;
    switch (msg.cmd) {
      case 'castSlot': sim.castAbilityBySlot(msg.slot | 0, pid); break;
      case 'cast': if (typeof msg.ability === 'string') sim.castAbility(msg.ability, pid); break;
      case 'target': sim.targetEntity(typeof msg.id === 'number' ? msg.id : null, pid); break;
      case 'tab': sim.tabTarget(pid); break;
      case 'targetNearest': sim.targetNearestEnemy(pid); break;
      case 'attack': sim.startAutoAttack(pid); break;
      case 'stopattack': sim.stopAutoAttack(pid); break;
      case 'interact': sim.interact(pid); break;
      case 'loot': if (typeof msg.id === 'number') sim.lootCorpse(msg.id, pid); break;
      case 'pickup': if (typeof msg.id === 'number') sim.pickUpObject(msg.id, pid); break;
      case 'accept': if (typeof msg.quest === 'string') { sim.acceptQuest(msg.quest, pid); this.resyncQuests(session); } break;
      case 'turnin': if (typeof msg.quest === 'string') { sim.turnInQuest(msg.quest, pid); this.resyncQuests(session); } break;
      case 'abandon': if (typeof msg.quest === 'string') { sim.abandonQuest(msg.quest, pid); this.resyncQuests(session); } break;
      case 'equip': if (typeof msg.item === 'string') sim.equipItem(msg.item, pid); break;
      case 'use': if (typeof msg.item === 'string') sim.useItem(msg.item, pid); break;
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
      case 'release': sim.releaseSpirit(pid); break;
      case 'chat': {
        if (typeof msg.text !== 'string') break;
        if (!this.consumeChatToken(session)) break;
        const text = msg.text.trim();
        if (/^\/who(?:\s|$)/i.test(text)) {
          this.sendWhoRoster(session);
          break;
        }
        // guild and officer chat are persistent + cross-zone, so they live in
        // the server's SocialService rather than the sim (no guild concept).
        // MMO convention: /g is guild; /general remains world chat.
        const gm = /^\/(?:g|gu|guild)\s+([\s\S]+)$/i.exec(text);
        const om = gm ? null : /^\/(?:o|officer)\s+([\s\S]+)$/i.exec(text);
        if (gm || om) {
          const channel = gm ? 'guild' : 'officer';
          const body = censorChatText((gm ?? om!)[1]);
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
        // WoW /r: reply to whoever last whispered you
        const rm = /^\/(?:r|reply)\s+([\s\S]+)$/i.exec(text);
        if (rm) {
          if (!session.lastWhisperFrom) {
            this.send(session, { t: 'events', list: [{ type: 'error', text: 'No one has whispered you recently.' }] });
            break;
          }
          session.rememberedChat = { channel: 'whisper', target: session.lastWhisperFrom };
          this.logChat(session, sim.chat(`/w ${session.lastWhisperFrom} ${censorChatText(rm[1])}`, pid));
          break;
        }
        this.logChat(session, this.routeRememberedChat(session, text, pid));
        break;
      }
      // party
      case 'pinvite': if (typeof msg.id === 'number') sim.partyInvite(msg.id, pid); break;
      case 'paccept': sim.partyAccept(pid); break;
      case 'pdecline': sim.partyDecline(pid); break;
      case 'pleave': sim.partyLeave(pid); break;
      case 'pkick': if (typeof msg.id === 'number') sim.partyKick(msg.id, pid); break;
      // raid/target markers
      case 'setMarker': if (typeof msg.id === 'number' && typeof msg.marker === 'number') sim.setMarker(msg.id, msg.marker, pid); break;
      case 'clearMarker': if (typeof msg.id === 'number') sim.clearMarker(msg.id, pid); break;
      // trade
      case 'trade_req': if (typeof msg.id === 'number') sim.tradeRequest(msg.id, pid); break;
      case 'trade_accept': sim.tradeAccept(pid); break;
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
      // arena (Ashen Coliseum 1v1 queue)
      case 'arena_queue': sim.arenaQueueJoin(pid); break;
      case 'arena_leave': sim.arenaQueueLeave(pid); break;
      // World Market (the Merchant's auction house)
      case 'market_list':
        if (typeof msg.item === 'string' && typeof msg.count === 'number' && typeof msg.price === 'number') {
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
      copper: meta.copper,
      gcd: round2(p.gcdRemaining),
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
    maybe('qlog', [...meta.questLog.values()]);
    maybe('qdone', [...meta.questsDone]);
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
          }
          continue;
        }
        // world events: only those near this player
        const anchor = this.eventAnchor(ev);
        if (anchor === null || dist2d(p.pos, anchor) <= EVENT_RADIUS) mine.push(ev);
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
    if (!text.startsWith('/')) {
      const body = censorChatText(text);
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
        case 'yell':
          return this.sim.chat(`/y ${body}`, pid);
        case 'say':
          return this.sim.chat(body, pid);
      }
    }

    const sent = this.sim.chat(censorChatText(text), pid);
    if (sent) {
      if (sent.channel === 'whisper') {
        const wm = /^\/(?:w|whisper|t|tell)\s+(\S+)\s+[\s\S]+$/i.exec(text);
        if (wm) session.rememberedChat = { channel: 'whisper', target: wm[1] };
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
