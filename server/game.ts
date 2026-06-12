import type { WebSocket } from 'ws';
import { Sim } from '../src/sim/sim';
import type { PlayerMeta } from '../src/sim/sim';
import { DT, Entity, SimEvent, dist2d } from '../src/sim/types';
import { zoneAt, DUNGEONS } from '../src/sim/data';
import { saveCharacterState, openPlaySession, closePlaySession, insertChatLogs } from './db';
import { ChatLogger } from './chat_log';

const WORLD_SEED = 20061;
const INTEREST_RADIUS = 120;
const EVENT_RADIUS = 90;
const AUTOSAVE_SECONDS = 30;
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
  // serialized form of each delta self field as last sent to this client;
  // a field is omitted from a snapshot while its serialization is unchanged
  lastSent: Record<string, string>;
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

function wireEntity(e: Entity): Record<string, unknown> {
  const out: Record<string, unknown> = {
    id: e.id, k: e.kind, tid: e.templateId, nm: e.name, lv: e.level,
    x: round2(e.pos.x), y: round2(e.pos.y), z: round2(e.pos.z), f: round2(e.facing),
    hp: e.hp, mhp: e.maxHp,
  };
  if (e.dead) out.dead = 1;
  if (e.lootable) out.loot = 1;
  if (e.hostile) out.h = 1;
  if (e.dungeonId) out.dgn = e.dungeonId;
  if (e.scale !== 1) out.sc = e.scale;
  if (e.color !== 0xffffff) out.c = e.color;
  if (e.castingAbility) {
    out.cast = e.castingAbility;
    out.castRem = round2(e.castRemaining);
    out.castTot = round2(e.castTotal);
    if (e.channeling) out.chan = 1;
  }
  if (e.sitting || e.eating || e.drinking) out.sit = 1;
  if (e.aggroTargetId !== null) out.aggro = e.aggroTargetId;
  if (e.tappedById !== null) out.tap = e.tappedById;
  if (e.auras.length > 0) {
    out.auras = e.auras.map((a): WireAura => ({ id: a.id, name: a.name, kind: a.kind, rem: round2(a.remaining), dur: a.duration }));
  }
  if (e.kind === 'mob' && e.lootable && e.loot) {
    out.lootList = { copper: e.loot.copper, items: e.loot.items };
  }
  return out;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

export class GameServer {
  sim: Sim;
  clients = new Map<number, ClientSession>(); // by pid
  readonly chatLog = new ChatLogger(insertChatLogs);
  private interval: NodeJS.Timeout | null = null;
  private saveTimer = 0;
  private readonly startedAt = Date.now();
  private peakOnline = 0;
  private tickMsAvg = 0;

  constructor() {
    this.sim = new Sim({ seed: WORLD_SEED, playerClass: 'warrior', noPlayer: true });
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
      }
    }, 50);
  }

  stop(): void {
    if (this.interval) clearInterval(this.interval);
  }

  // -------------------------------------------------------------------------

  join(ws: WebSocket, accountId: number, characterId: number, name: string, cls: import('../src/sim/types').PlayerClass, state: import('../src/sim/sim').CharacterState | null, isGm = false): ClientSession | { error: string } {
    for (const c of this.clients.values()) {
      if (c.characterId === characterId) return { error: 'character already in world' };
    }
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
      lastSent: {},
    };
    this.clients.set(pid, session);
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
    });
    this.broadcastSystem(`${name} has entered World of Claudecraft.`);
    return session;
  }

  async leave(session: ClientSession, reason: string): Promise<void> {
    if (!this.clients.has(session.pid)) return;
    this.clients.delete(session.pid);
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
    for (const session of this.clients.values()) {
      await this.saveCharacter(session).catch((err) => console.error(`${reason} failed for ${session.name}:`, err));
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
      const mi = msg.mi ?? {};
      meta.moveInput.forward = !!mi.f;
      meta.moveInput.back = !!mi.b;
      meta.moveInput.turnLeft = !!mi.tl;
      meta.moveInput.turnRight = !!mi.tr;
      meta.moveInput.strafeLeft = !!mi.sl;
      meta.moveInput.strafeRight = !!mi.sr;
      meta.moveInput.jump = !!mi.j;
      if (typeof msg.facing === 'number' && isFinite(msg.facing) && !e.dead) {
        e.facing = msg.facing;
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
      case 'buy': if (typeof msg.npc === 'number' && typeof msg.item === 'string') sim.buyItem(msg.npc, msg.item, pid); break;
      case 'sell': if (typeof msg.item === 'string') sim.sellItem(msg.item, pid); break;
      case 'release': sim.releaseSpirit(pid); break;
      case 'chat': {
        if (typeof msg.text !== 'string') break;
        const sent = sim.chat(msg.text, pid);
        if (sent) {
          this.chatLog.log({
            accountId: session.accountId,
            characterId: session.characterId,
            characterName: session.name,
            channel: sent.channel,
            message: sent.message,
          });
        }
        break;
      }
      // party
      case 'pinvite': if (typeof msg.id === 'number') sim.partyInvite(msg.id, pid); break;
      case 'paccept': sim.partyAccept(pid); break;
      case 'pdecline': sim.partyDecline(pid); break;
      case 'pleave': sim.partyLeave(pid); break;
      case 'pkick': if (typeof msg.id === 'number') sim.partyKick(msg.id, pid); break;
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
    // each entity is serialized at most once per tick, shared by every
    // recipient whose interest area contains it
    const entJson = new Map<number, string>();
    const head = `{"t":"snap","tick":${this.sim.tickCount},"time":${round2(this.sim.time)}`;
    for (const session of this.clients.values()) {
      const p = this.sim.entities.get(session.pid);
      const meta = this.sim.meta(session.pid);
      if (!p || !meta) continue;
      const ents: string[] = [];
      this.sim.grid.forEachInRadius(p.pos.x, p.pos.z, INTEREST_RADIUS, (e) => {
        if (e.id === session.pid) return;
        let json = entJson.get(e.id);
        if (json === undefined) {
          json = JSON.stringify(wireEntity(e));
          entJson.set(e.id, json);
        }
        ents.push(json);
      });
      this.sendRaw(session, `${head},"self":${this.selfWireJson(session, p, meta)},"ents":[${ents.join(',')}]}`);
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
    maybe('equip', meta.equipment);
    maybe('qlog', [...meta.questLog.values()]);
    maybe('qdone', [...meta.questsDone]);
    maybe('cds', Object.fromEntries([...p.cooldowns.entries()].map(([k, v]) => [k, round2(v)])));
    maybe('stats', p.stats);
    maybe('weapon', p.weapon);
    maybe('party', this.partyWire(session.pid));
    maybe('trade', this.tradeWire(session.pid));
    maybe('duel', this.duelWire(session.pid));
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
          x: round2(e.pos.x), z: round2(e.pos.z), dead: e.dead ? 1 : 0,
        } : null;
      }).filter(Boolean),
    };
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
        if (ev.pid !== undefined) {
          if (ev.pid === session.pid) mine.push(ev);
          continue;
        }
        // world events: only those near this player
        const anchor = this.eventAnchor(ev);
        if (anchor === null || dist2d(p.pos, anchor) <= EVENT_RADIUS) mine.push(ev);
      }
      if (mine.length > 0) this.send(session, { t: 'events', list: mine });
    }
  }

  private eventAnchor(ev: SimEvent): { x: number; y: number; z: number } | null {
    let id: number | undefined;
    if ('targetId' in ev && typeof ev.targetId === 'number') id = ev.targetId;
    else if ('entityId' in ev && typeof ev.entityId === 'number') id = ev.entityId;
    if (id === undefined) return null; // chat/log etc: broadcast
    return this.sim.entities.get(id)?.pos ?? null;
  }

  private broadcastSystem(text: string): void {
    for (const session of this.clients.values()) {
      this.send(session, { t: 'events', list: [{ type: 'log', text, color: '#ffd100' }] });
    }
  }

  // the web client applies quest commands optimistically; force the next
  // snapshot to carry quest state even when the command changed nothing,
  // so a rejected command still converges back to the server's truth
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
