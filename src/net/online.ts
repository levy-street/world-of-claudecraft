// Online play: REST auth client + WebSocket world mirror.

import { NPCS, QUESTS, abilitiesKnownAt } from '../sim/data';
import { computeQuestState, ResolvedAbility } from '../sim/sim';
import {
  Entity, EquipSlot, InvSlot, MoveInput, PlayerClass, QuestProgress, QuestState, SimEvent,
  emptyMoveInput,
} from '../sim/types';
import type { DuelInfo, IWorld, PartyInfo, TradeInfo } from '../world_api';

// ---------------------------------------------------------------------------
// REST
// ---------------------------------------------------------------------------

export interface CharacterSummary {
  id: number;
  name: string;
  class: PlayerClass;
  level: number;
  online: boolean;
}

export function buildWebSocketUrl(protocol: string, host: string): string {
  const proto = protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${host}/ws`;
}

export function buildWebSocketAuthMessage(token: string, characterId: number): { t: 'auth'; token: string; character: number } {
  return { t: 'auth', token, character: characterId };
}

export class Api {
  token: string | null = null;
  username: string | null = null;

  private async post(path: string, body: unknown): Promise<any> {
    const res = await fetch(path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
      },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error ?? `request failed (${res.status})`);
    return data;
  }

  private async get(path: string): Promise<any> {
    const res = await fetch(path, {
      headers: this.token ? { Authorization: `Bearer ${this.token}` } : {},
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error ?? `request failed (${res.status})`);
    return data;
  }

  async register(username: string, password: string): Promise<void> {
    const data = await this.post('/api/register', { username, password });
    this.token = data.token;
    this.username = data.username;
  }

  async login(username: string, password: string): Promise<void> {
    const data = await this.post('/api/login', { username, password });
    this.token = data.token;
    this.username = data.username;
  }

  async characters(): Promise<CharacterSummary[]> {
    return (await this.get('/api/characters')).characters;
  }

  async createCharacter(name: string, cls: PlayerClass): Promise<void> {
    await this.post('/api/characters', { name, class: cls });
  }
}

// ---------------------------------------------------------------------------
// World mirror
// ---------------------------------------------------------------------------

function wrapAngle(d: number): number {
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

function blankEntity(id: number): Entity {
  return {
    id, kind: 'mob', templateId: '', name: '', level: 1,
    pos: { x: 0, y: 0, z: 0 }, prevPos: { x: 0, y: 0, z: 0 }, facing: 0, prevFacing: 0,
    vy: 0, onGround: true, fallStartY: 0,
    hp: 1, maxHp: 1, resource: 0, maxResource: 0, resourceType: null,
    stats: { str: 0, agi: 0, sta: 0, int: 0, spi: 0, armor: 0 },
    weapon: { min: 1, max: 2, speed: 2 },
    attackPower: 0, rangedPower: 0, critChance: 0.05, dodgeChance: 0.05, moveSpeed: 7, hostile: false,
    targetId: null, autoAttack: false, swingTimer: 0,
    inCombat: false, combatTimer: 99,
    auras: [], castingAbility: null, castRemaining: 0, castTotal: 0,
    channeling: false, channelTickTimer: 0, channelTickEvery: 0,
    gcdRemaining: 0, cooldowns: new Map(), queuedOnSwing: null, fiveSecondRule: 99,
    comboPoints: 0, comboTargetId: null, overpowerUntil: -1,
    chargeTargetId: null, chargeTimeLeft: 0, chargePath: [],
    sitting: false, eating: null, drinking: null,
    aiState: 'idle', tappedById: null, pulseTimer: 0, firedSummons: 0, summonedIds: [], enraged: false,
    spawnPos: { x: 0, y: 0, z: 0 }, wanderTarget: null, wanderTimer: 0,
    aggroTargetId: null, respawnTimer: 0, corpseTimer: 0, lootable: false, loot: null,
    xpValue: 0, questIds: [], vendorItems: [], objectItemId: null, dungeonId: null,
    dead: false, scale: 1, color: 0xffffff,
  };
}

export class ClientWorld implements IWorld {
  cfg: { seed: number; playerClass: PlayerClass };
  entities = new Map<number, Entity>();
  playerId = -1;
  moveInput: MoveInput = emptyMoveInput();
  inventory: InvSlot[] = [];
  equipment: Partial<Record<EquipSlot, string>> = {};
  copper = 0;
  xp = 0;
  known: ResolvedAbility[] = [];
  questLog = new Map<string, QuestProgress>();
  questsDone = new Set<string>();
  partyInfo: PartyInfo | null = null;
  tradeInfo: TradeInfo | null = null;
  duelInfo: DuelInfo | null = null;
  // snapshot interpolation
  lastSnapAt = 0;
  snapInterval = 50; // ms, adapts to measured cadence
  // camera follow for keyboard turns applied by the main loop
  pendingFacingDelta = 0;
  connected = false;
  onDisconnect: ((reason: string) => void) | null = null;

  private ws: WebSocket;
  private eventQueue: SimEvent[] = [];
  // inventory deltas arrive in snapshots, separate from the event frames the
  // HUD redraws on — the frame loop polls this so open panels re-render
  private invChanged = false;
  private mouselookFacing: number | null = null;
  private sendTimer: number | undefined;

  constructor(token: string, characterId: number, cls: PlayerClass) {
    this.cfg = { seed: 20061, playerClass: cls };
    this.ws = new WebSocket(buildWebSocketUrl(location.protocol, location.host));
    this.ws.onopen = () => {
      this.ws.send(JSON.stringify(buildWebSocketAuthMessage(token, characterId)));
    };
    this.ws.onmessage = (ev) => this.onMessage(String(ev.data));
    this.ws.onclose = () => {
      this.connected = false;
      clearInterval(this.sendTimer);
      this.onDisconnect?.('Connection to the server was lost.');
    };
    // input stream at sim rate
    this.sendTimer = window.setInterval(() => this.sendInput(), 50);
  }

  close(): void {
    clearInterval(this.sendTimer);
    this.ws.onclose = null;
    this.ws.close();
  }

  get player(): Entity {
    return this.entities.get(this.playerId) ?? blankEntity(-1);
  }

  drainEvents(): SimEvent[] {
    const out = this.eventQueue;
    this.eventQueue = [];
    return out;
  }

  setMouselookFacing(facing: number | null): void {
    this.mouselookFacing = facing;
  }

  // -----------------------------------------------------------------------
  // Socket
  // -----------------------------------------------------------------------

  private sendInput(): void {
    if (!this.connected || this.ws.readyState !== WebSocket.OPEN) return;
    const mi = this.moveInput;
    const msg: Record<string, unknown> = {
      t: 'input',
      mi: {
        f: mi.forward ? 1 : 0, b: mi.back ? 1 : 0,
        tl: mi.turnLeft ? 1 : 0, tr: mi.turnRight ? 1 : 0,
        sl: mi.strafeLeft ? 1 : 0, sr: mi.strafeRight ? 1 : 0,
        j: mi.jump ? 1 : 0,
      },
    };
    if (this.mouselookFacing !== null) msg.facing = this.mouselookFacing;
    this.ws.send(JSON.stringify(msg));
  }

  private cmd(payload: Record<string, unknown>): void {
    if (!this.connected || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ t: 'cmd', ...payload }));
  }

  private onMessage(raw: string): void {
    let msg: any;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (msg.t === 'hello') {
      this.playerId = msg.pid;
      this.cfg.seed = msg.seed;
      this.connected = true;
      return;
    }
    if (msg.t === 'error') {
      this.connected = false;
      this.onDisconnect?.(msg.error ?? 'rejected by server');
      return;
    }
    if (msg.t === 'events') {
      for (const ev of msg.list) this.eventQueue.push(ev as SimEvent);
      return;
    }
    if (msg.t === 'snap') {
      this.applySnapshot(msg);
    }
  }

  private applySnapshot(snap: any): void {
    const now = performance.now();
    // the interpolation alpha the render loop reached on its last frame
    // (same formula and caps as main.ts); used below to re-anchor the new
    // interpolation segment at the pose currently on screen
    const contAlpha = this.lastSnapAt > 0
      ? Math.min(1.25, (now - this.lastSnapAt) / Math.max(20, this.snapInterval))
      : 1;
    const contFacingAlpha = Math.min(1, contAlpha);
    if (this.lastSnapAt > 0) {
      const gap = now - this.lastSnapAt;
      if (gap > 5 && gap < 500) this.snapInterval = this.snapInterval * 0.9 + gap * 0.1;
    }
    this.lastSnapAt = now;

    const seen = new Set<number>();
    const prevSelf = this.entities.get(this.playerId);
    const prevSelfFacing = prevSelf?.facing;

    const applyWire = (w: any): Entity => {
      let e = this.entities.get(w.id);
      if (!e) {
        e = blankEntity(w.id);
        e.kind = w.k;
        e.templateId = w.tid;
        e.name = w.nm;
        e.scale = w.sc ?? 1;
        e.color = w.c ?? 0xffffff;
        e.pos = { x: w.x, y: w.y, z: w.z };
        e.prevPos = { x: w.x, y: w.y, z: w.z };
        e.facing = w.f;
        e.prevFacing = w.f;
        e.dungeonId = w.dgn ?? null;
        if (e.kind === 'npc') {
          const def = NPCS[e.templateId];
          e.questIds = def ? [...def.questIds] : [];
          e.vendorItems = def?.vendorItems ? [...def.vendorItems] : [];
        }
        this.entities.set(w.id, e);
      }
      // interpolation bases: re-anchor at the pose the renderer last drew,
      // not at the previous server pose — when a frame extrapolated past the
      // last snapshot, restarting from the server pose snapped entities
      // backwards every snapshot (visible rubber-banding while running)
      e.prevPos = {
        x: e.prevPos.x + (e.pos.x - e.prevPos.x) * contAlpha,
        y: e.prevPos.y + (e.pos.y - e.prevPos.y) * contAlpha,
        z: e.prevPos.z + (e.pos.z - e.prevPos.z) * contAlpha,
      };
      e.prevFacing = e.prevFacing + wrapAngle(e.facing - e.prevFacing) * contFacingAlpha;
      e.pos.x = w.x; e.pos.y = w.y; e.pos.z = w.z;
      e.facing = w.f;
      e.level = w.lv;
      e.hp = w.hp;
      e.maxHp = w.mhp;
      e.dead = !!w.dead;
      e.lootable = !!w.loot;
      e.hostile = !!w.h;
      e.castingAbility = w.cast ?? null;
      e.castRemaining = w.castRem ?? 0;
      e.castTotal = w.castTot ?? 0;
      e.channeling = !!w.chan;
      e.sitting = !!w.sit;
      e.aggroTargetId = w.aggro ?? null;
      e.tappedById = w.tap ?? null;
      e.auras = (w.auras ?? []).map((a: any) => ({
        id: a.id, name: a.name, kind: a.kind, remaining: a.rem, duration: a.dur,
        value: 0, sourceId: 0, school: 'physical' as const,
      }));
      e.loot = w.lootList ?? null;
      return e;
    };

    for (const w of snap.ents) {
      seen.add(w.id);
      applyWire(w);
    }

    // self with extended state
    const s = snap.self;
    if (s) {
      seen.add(s.id);
      const e = applyWire(s);
      e.resource = s.res;
      e.maxResource = s.mres;
      e.resourceType = s.rtype;
      // delta fields: the server omits them while unchanged, so only the
      // snapshots that carry them rebuild the local structures
      if (s.cds !== undefined) e.cooldowns = new Map(Object.entries(s.cds).map(([k, v]) => [k, Number(v)]));
      e.gcdRemaining = s.gcd ?? 0;
      e.comboPoints = s.combo ?? 0;
      e.comboTargetId = s.comboTgt ?? null;
      e.targetId = s.target ?? null;
      e.autoAttack = !!s.auto;
      e.queuedOnSwing = s.queued ?? null;
      e.stats = s.stats ?? e.stats;
      e.attackPower = s.ap ?? 0;
      e.critChance = s.crit ?? 0.05;
      e.dodgeChance = s.dodge ?? 0.05;
      e.weapon = s.weapon ?? e.weapon;
      e.eating = s.eat
        ? { itemId: '', kind: 'food', hpPer2s: 0, manaPer2s: 0, remaining: s.eat.remaining }
        : null;
      e.drinking = s.drk
        ? { itemId: '', kind: 'drink', hpPer2s: 0, manaPer2s: 0, remaining: s.drk.remaining }
        : null;
      this.xp = s.xp ?? 0;
      this.copper = s.copper ?? 0;
      if (s.inv !== undefined) { this.inventory = s.inv; this.invChanged = true; }
      if (s.equip !== undefined) this.equipment = s.equip;
      if (s.qlog !== undefined) this.questLog = new Map((s.qlog as QuestProgress[]).map((q) => [q.questId, q]));
      if (s.qdone !== undefined) this.questsDone = new Set(s.qdone);
      this.known = abilitiesKnownAt(this.cfg.playerClass, e.level);
      if (s.party !== undefined) this.partyInfo = s.party;
      if (s.trade !== undefined) this.tradeInfo = s.trade;
      if (s.duel !== undefined) this.duelInfo = s.duel;
      // camera follows server-side facing changes when not mouselooking
      if (prevSelfFacing !== undefined && this.mouselookFacing === null) {
        let d = e.facing - prevSelfFacing;
        while (d > Math.PI) d -= 2 * Math.PI;
        while (d < -Math.PI) d += 2 * Math.PI;
        this.pendingFacingDelta += d;
      }
    }

    // prune entities that left our interest area
    for (const [id, e] of this.entities) {
      if (!seen.has(id)) this.entities.delete(id);
    }
  }

  // -----------------------------------------------------------------------
  // IWorld commands -> network
  // -----------------------------------------------------------------------

  questState(questId: string): QuestState {
    return computeQuestState(questId, this.questLog, this.questsDone, this.player.level);
  }

  consumeInventoryChanged(): boolean {
    const v = this.invChanged;
    this.invChanged = false;
    return v;
  }

  castAbility(abilityId: string): void {
    this.cmd({ cmd: 'cast', ability: abilityId });
  }
  castAbilityBySlot(slot: number): void {
    this.cmd({ cmd: 'castSlot', slot });
  }
  targetEntity(id: number | null): void {
    // optimistic local update for snappy UI
    const p = this.entities.get(this.playerId);
    if (p) {
      if (id === null) p.targetId = null;
      else {
        const e = this.entities.get(id);
        if (e && (!e.dead || e.lootable)) p.targetId = id;
      }
    }
    this.cmd({ cmd: 'target', id });
  }
  tabTarget(): void {
    this.cmd({ cmd: 'tab' });
  }
  startAutoAttack(): void {
    this.cmd({ cmd: 'attack' });
  }
  stopAutoAttack(): void {
    this.cmd({ cmd: 'stopattack' });
  }
  interact(): void {
    this.cmd({ cmd: 'interact' });
  }
  lootCorpse(id: number): void {
    this.cmd({ cmd: 'loot', id });
  }
  pickUpObject(id: number): void {
    this.cmd({ cmd: 'pickup', id });
  }
  // Quest commands update local state optimistically so the dialog can't be
  // re-used in the window before the next server snapshot lands. The server
  // remains authoritative; the following snapshot overwrites this state.
  acceptQuest(questId: string): void {
    const quest = QUESTS[questId];
    if (quest && !this.questLog.has(questId) && !this.questsDone.has(questId)) {
      this.questLog.set(questId, { questId, counts: quest.objectives.map(() => 0), state: 'active' });
    }
    this.cmd({ cmd: 'accept', quest: questId });
  }
  turnInQuest(questId: string): void {
    if (this.questLog.get(questId)?.state === 'ready') {
      this.questLog.delete(questId);
      this.questsDone.add(questId);
    }
    this.cmd({ cmd: 'turnin', quest: questId });
  }
  abandonQuest(questId: string): void {
    this.cmd({ cmd: 'abandon', quest: questId });
  }
  equipItem(itemId: string): void {
    this.cmd({ cmd: 'equip', item: itemId });
  }
  useItem(itemId: string): void {
    this.cmd({ cmd: 'use', item: itemId });
  }
  buyItem(npcId: number, itemId: string): void {
    this.cmd({ cmd: 'buy', npc: npcId, item: itemId });
  }
  sellItem(itemId: string): void {
    this.cmd({ cmd: 'sell', item: itemId });
  }
  releaseSpirit(): void {
    this.cmd({ cmd: 'release' });
  }
  chat(text: string): void {
    this.cmd({ cmd: 'chat', text });
  }
  // social systems
  partyInvite(targetPid: number): void {
    this.cmd({ cmd: 'pinvite', id: targetPid });
  }
  partyAccept(): void {
    this.cmd({ cmd: 'paccept' });
  }
  partyDecline(): void {
    this.cmd({ cmd: 'pdecline' });
  }
  partyLeave(): void {
    this.cmd({ cmd: 'pleave' });
  }
  partyKick(targetPid: number): void {
    this.cmd({ cmd: 'pkick', id: targetPid });
  }
  tradeRequest(targetPid: number): void {
    this.cmd({ cmd: 'trade_req', id: targetPid });
  }
  tradeAccept(): void {
    this.cmd({ cmd: 'trade_accept' });
  }
  tradeSetOffer(items: InvSlot[], copper: number): void {
    this.cmd({ cmd: 'trade_offer', items, copper });
  }
  tradeConfirm(): void {
    this.cmd({ cmd: 'trade_confirm' });
  }
  tradeCancel(): void {
    this.cmd({ cmd: 'trade_cancel' });
  }
  duelRequest(targetPid: number): void {
    this.cmd({ cmd: 'duel_req', id: targetPid });
  }
  duelAccept(): void {
    this.cmd({ cmd: 'duel_accept' });
  }
  duelDecline(): void {
    this.cmd({ cmd: 'duel_decline' });
  }
  enterDungeon(dungeonId: string): void {
    this.cmd({ cmd: 'enter_dungeon', dungeon: dungeonId });
  }
  leaveDungeon(): void {
    this.cmd({ cmd: 'leave_dungeon' });
  }
  // legacy aliases kept for older scripts
  enterCrypt(): void {
    this.enterDungeon('hollow_crypt');
  }
  leaveCrypt(): void {
    this.leaveDungeon();
  }
}
