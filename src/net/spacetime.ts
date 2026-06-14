import { NPCS, abilitiesKnownAt } from '../sim/data';
import { computeQuestState } from '../sim/sim';
import type { ResolvedAbility } from '../sim/sim';
import {
  Entity, EquipSlot, InvSlot, MoveInput, PlayerClass, QuestProgress, QuestState, SimEvent,
  emptyMoveInput,
} from '../sim/types';
import { normalizeMoveFacing, sanitizeMoveInput } from '../sim/move_input';
import type { ArenaInfo, CharacterSearchResult, DuelInfo, MarketInfo, PartyInfo, SocialInfo, TradeInfo } from '../world_api';
import type { OnlineWorldClient } from './world_client';
import type { SpacetimeConnectionConfig } from './backend';
import { StdbClient, rows, table, type StdbConnection, type StdbSubscriptionHandle } from './spacetime_client';

type WorldSessionRow = {
  id: bigint;
  characterId: bigint;
  playerId: number;
  className: string;
  characterName: string;
  active: boolean;
  bridgeAttached: boolean;
  error: string;
};

type PayloadRow = {
  id?: bigint;
  sessionId: bigint;
  payloadJson: string;
};

type CharacterRow = {
  name: string;
  className: string;
  level: number;
};

function wrapAngle(d: number): number {
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

function copyPos(dst: { x: number; y: number; z: number }, src: { x: number; y: number; z: number }): void {
  dst.x = src.x;
  dst.y = src.y;
  dst.z = src.z;
}

const TELEPORT_SNAP_DIST_SQ = 40 * 40;

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
    auras: [], ccDr: new Map(), castingAbility: null, castRemaining: 0, castTotal: 0,
    channeling: false, channelTickTimer: 0, channelTickEvery: 0,
    gcdRemaining: 0, cooldowns: new Map(), queuedOnSwing: null, fiveSecondRule: 99,
    comboPoints: 0, comboTargetId: null, overpowerUntil: -1, potionCooldownUntil: -1, savedMana: 0,
    chargeTargetId: null, chargeTimeLeft: 0, chargePath: [],
    sitting: false, eating: null, drinking: null,
    aiState: 'idle', tappedById: null, pulseTimer: 0, firedSummons: 0, summonedIds: [], enraged: false,
    threat: new Map(), forcedTargetId: null, forcedTargetTimer: 0, ownerId: null, petTauntTimer: 0,
    spawnPos: { x: 0, y: 0, z: 0 }, leashAnchor: null, wanderTarget: null, wanderTimer: 0,
    aggroTargetId: null, respawnTimer: 0, corpseTimer: 0, lootable: false, loot: null,
    xpValue: 0, questIds: [], vendorItems: [], objectItemId: null, dungeonId: null,
    dead: false, scale: 1, color: 0xffffff,
  };
}

function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

export class SpacetimeWorld implements OnlineWorldClient {
  cfg: { seed: number; playerClass: PlayerClass };
  entities = new Map<number, Entity>();
  playerId = -1;
  moveInput: MoveInput = emptyMoveInput();
  inventory: InvSlot[] = [];
  vendorBuyback: InvSlot[] = [];
  equipment: Partial<Record<EquipSlot, string>> = {};
  copper = 0;
  xp = 0;
  known: ResolvedAbility[];
  questLog = new Map<string, QuestProgress>();
  questsDone = new Set<string>();
  partyInfo: PartyInfo | null = null;
  tradeInfo: TradeInfo | null = null;
  duelInfo: DuelInfo | null = null;
  socialInfo: SocialInfo | null = null;
  arenaInfo: ArenaInfo | null = null;
  marketInfo: MarketInfo | null = null;
  markers: Record<number, number> = {};
  realm = '';
  lastSnapAt = 0;
  snapInterval = 50;
  pendingFacingDelta = 0;
  connected = false;
  onDisconnect: ((reason: string) => void) | null = null;
  readonly characterId: number;
  readonly uri: string;
  readonly moduleName: string;

  private readonly client: StdbClient;
  private conn: StdbConnection | null = null;
  private subscription: StdbSubscriptionHandle | null = null;
  private sessionId: bigint | null = null;
  private eventQueue: SimEvent[] = [];
  private invChanged = false;
  private socialDirty = false;
  private pendingQuestCommands = new Map<string, 'accept' | 'turnin'>();
  private mouselookFacing: number | null = null;
  private sendTimer: ReturnType<typeof setInterval> | null = null;
  private seenEventIds = new Set<string>();
  private characterRows = new Map<string, CharacterRow>();

  constructor(config: SpacetimeConnectionConfig, _token: string, characterId: number, cls: PlayerClass) {
    this.characterId = characterId;
    this.uri = config.uri;
    this.moduleName = config.moduleName;
    this.client = new StdbClient(config);
    this.cfg = { seed: 20061, playerClass: cls };
    this.known = abilitiesKnownAt(cls, 1);
    this.client.onDisconnect((reason) => {
      this.connected = false;
      this.onDisconnect?.(reason);
    });
    this.sendTimer = setInterval(() => this.sendInput(), 50);
    queueMicrotask(() => void this.open());
  }

  get player(): Entity {
    return this.entities.get(this.playerId) ?? blankEntity(-1);
  }

  close(): void {
    if (this.sendTimer !== null) {
      clearInterval(this.sendTimer);
      this.sendTimer = null;
    }
    const conn = this.conn;
    const sessionId = this.sessionId;
    this.connected = false;
    this.subscription = null;
    if (conn?.isActive && sessionId !== null) {
      void conn.reducers.leaveWorld({ sessionId }).finally(() => this.client.disconnect());
    } else {
      this.client.disconnect();
    }
  }

  drainEvents(): SimEvent[] {
    const out = this.eventQueue;
    this.eventQueue = [];
    return out;
  }

  setMoveInput(input: unknown, facing?: unknown): void {
    Object.assign(this.moveInput, sanitizeMoveInput(input));
    if (arguments.length > 1) this.setMouselookFacing(facing);
  }

  setMouselookFacing(facing: unknown): void {
    this.mouselookFacing = normalizeMoveFacing(facing);
  }

  consumeInventoryChanged(): boolean {
    const v = this.invChanged;
    this.invChanged = false;
    return v;
  }

  consumeSocialChanged(): boolean {
    const v = this.socialDirty;
    this.socialDirty = false;
    return v;
  }

  private async open(): Promise<void> {
    try {
      const conn = await this.client.connect();
      this.conn = conn;
      this.watchTables(conn);
      await new Promise<void>((resolve, reject) => {
        this.subscription = conn
          .subscriptionBuilder()
          .onApplied(() => {
            this.scanInitialRows(conn);
            resolve();
          })
          .onError((ctx: any) => reject(new Error(ctx?.event?.message ?? 'SpacetimeDB subscription failed')))
          .subscribe([
            'SELECT * FROM world_session',
            'SELECT * FROM world_snapshot',
            'SELECT * FROM world_event',
            'SELECT * FROM social_snapshot',
            'SELECT * FROM character',
          ]);
      });
      await conn.reducers.enterWorld({ characterId: BigInt(this.characterId) });
    } catch (err) {
      this.connected = false;
      const message = err instanceof Error && err.message ? err.message : 'Could not connect to SpacetimeDB.';
      this.onDisconnect?.(message);
    }
  }

  private watchTables(conn: StdbConnection): void {
    const sessionTable = table(conn.db, 'worldSession', 'world_session');
    const snapshotTable = table(conn.db, 'worldSnapshot', 'world_snapshot');
    const eventTable = table(conn.db, 'worldEvent', 'world_event');
    const socialTable = table(conn.db, 'socialSnapshot', 'social_snapshot');
    const characterTable = table(conn.db, 'character');

    sessionTable.onInsert((_ctx: unknown, row: WorldSessionRow) => this.applySession(row));
    sessionTable.onUpdate((_ctx: unknown, _old: WorldSessionRow, row: WorldSessionRow) => this.applySession(row));
    snapshotTable.onInsert((_ctx: unknown, row: PayloadRow) => this.applySnapshotRow(row));
    snapshotTable.onUpdate((_ctx: unknown, _old: PayloadRow, row: PayloadRow) => this.applySnapshotRow(row));
    eventTable.onInsert((_ctx: unknown, row: PayloadRow) => this.applyEventRow(row));
    socialTable.onInsert((_ctx: unknown, row: PayloadRow) => this.applySocialRow(row));
    socialTable.onUpdate((_ctx: unknown, _old: PayloadRow, row: PayloadRow) => this.applySocialRow(row));
    characterTable.onInsert((_ctx: unknown, row: CharacterRow) => this.characterRows.set(row.name.toLowerCase(), row));
    characterTable.onUpdate((_ctx: unknown, old: CharacterRow, row: CharacterRow) => {
      this.characterRows.delete(old.name.toLowerCase());
      this.characterRows.set(row.name.toLowerCase(), row);
    });
    characterTable.onDelete((_ctx: unknown, row: CharacterRow) => this.characterRows.delete(row.name.toLowerCase()));
  }

  private scanInitialRows(conn: StdbConnection): void {
    const sessionTable = table(conn.db, 'worldSession', 'world_session');
    const snapshotTable = table(conn.db, 'worldSnapshot', 'world_snapshot');
    const eventTable = table(conn.db, 'worldEvent', 'world_event');
    const socialTable = table(conn.db, 'socialSnapshot', 'social_snapshot');
    const characterTable = table(conn.db, 'character');
    for (const row of rows<CharacterRow>(characterTable)) this.characterRows.set(row.name.toLowerCase(), row);
    for (const row of rows<WorldSessionRow>(sessionTable)) this.applySession(row);
    for (const row of rows<PayloadRow>(snapshotTable)) this.applySnapshotRow(row);
    for (const row of rows<PayloadRow>(eventTable)) this.applyEventRow(row);
    for (const row of rows<PayloadRow>(socialTable)) this.applySocialRow(row);
  }

  private applySession(row: WorldSessionRow): void {
    if (Number(row.characterId) !== this.characterId) return;
    if (!row.active) {
      if (this.sessionId === row.id && row.error) {
        this.connected = false;
        this.onDisconnect?.(row.error);
      }
      return;
    }
    this.sessionId = row.id;
    this.realm = this.realm || 'Claudemoon';
    if (row.bridgeAttached && row.playerId > 0) {
      this.playerId = row.playerId;
      this.connected = true;
    }
    if (row.error) {
      this.connected = false;
      this.onDisconnect?.(row.error);
    }
  }

  private matchesSession(row: PayloadRow): boolean {
    return this.sessionId !== null && row.sessionId === this.sessionId;
  }

  private applySnapshotRow(row: PayloadRow): void {
    if (!this.matchesSession(row)) return;
    this.onMessage(row.payloadJson);
  }

  private applyEventRow(row: PayloadRow): void {
    if (!this.matchesSession(row)) return;
    const eventId = row.id !== undefined ? String(row.id) : `${row.sessionId}:${row.payloadJson}`;
    if (this.seenEventIds.has(eventId)) return;
    this.seenEventIds.add(eventId);
    this.onMessage(row.payloadJson);
  }

  private applySocialRow(row: PayloadRow): void {
    if (!this.matchesSession(row)) return;
    this.onMessage(row.payloadJson);
  }

  private sendInput(): void {
    if (!this.connected || !this.conn?.isActive || this.sessionId === null) return;
    const mi = this.moveInput;
    void this.conn.reducers.setInput({
      sessionId: this.sessionId,
      forward: mi.forward,
      back: mi.back,
      turnLeft: mi.turnLeft,
      turnRight: mi.turnRight,
      strafeLeft: mi.strafeLeft,
      strafeRight: mi.strafeRight,
      jump: mi.jump,
      facingValid: this.mouselookFacing !== null,
      facing: this.mouselookFacing ?? 0,
    }).catch(() => {});
  }

  private canSendCommand(): boolean {
    return this.connected && this.conn?.isActive === true && this.sessionId !== null;
  }

  private cmd(payload: Record<string, unknown>): void {
    if (!this.canSendCommand() || this.sessionId === null || !this.conn) return;
    const kind = typeof payload.cmd === 'string' ? payload.cmd : '';
    void this.conn.reducers.command({
      sessionId: this.sessionId,
      kind,
      payloadJson: JSON.stringify({ t: 'cmd', ...payload }),
    }).catch(() => {});
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
      if (typeof msg.realm === 'string') this.realm = msg.realm;
      this.connected = true;
      return;
    }
    if (msg.t === 'error') {
      this.connected = false;
      this.onDisconnect?.(msg.error ?? 'rejected by server');
      return;
    }
    if (msg.t === 'events') {
      for (const ev of msg.list ?? []) this.eventQueue.push(ev as SimEvent);
      return;
    }
    if (msg.t === 'social') {
      this.socialInfo = { friends: msg.friends ?? [], blocks: msg.blocks ?? [], guild: msg.guild ?? null };
      this.socialDirty = true;
      return;
    }
    if (msg.t === 'snap') {
      this.applySnapshot(msg);
    }
  }

  private applySnapshot(snap: any): void {
    const now = nowMs();
    const contAlpha = this.lastSnapAt > 0
      ? Math.min(1.25, (now - this.lastSnapAt) / Math.max(20, this.snapInterval))
      : 1;
    if (this.lastSnapAt > 0) {
      const gap = now - this.lastSnapAt;
      if (gap > 5 && gap < 500) this.snapInterval = this.snapInterval * 0.9 + gap * 0.1;
    }
    this.lastSnapAt = now;

    const seen = new Set<number>();
    const prevSelf = this.entities.get(this.playerId);
    const prevSelfFacing = prevSelf?.facing;

    const applyWire = (w: any): Entity | null => {
      let e = this.entities.get(w.id);
      const hasIdentity = w.k !== undefined;
      if (!e) {
        if (!hasIdentity) return null;
        e = blankEntity(w.id);
        e.pos = { x: w.x, y: w.y, z: w.z };
        copyPos(e.prevPos, e.pos);
        e.facing = w.f;
        e.prevFacing = w.f;
        this.entities.set(w.id, e);
      }
      if (hasIdentity) {
        e.kind = w.k;
        e.templateId = w.tid;
        e.name = w.nm;
        e.level = w.lv;
        e.scale = w.sc ?? 1;
        e.color = w.c ?? 0xffffff;
        e.dungeonId = w.dgn ?? null;
        if (e.kind === 'npc') {
          const def = NPCS[e.templateId];
          e.questIds = def ? [...def.questIds] : [];
          e.vendorItems = def?.vendorItems ? [...def.vendorItems] : [];
        }
      }
      const prevUpdatedAt = e.netUpdatedAt;
      const prevInterval = e.netInterval;
      const entAlpha = w.id !== this.playerId && prevUpdatedAt !== undefined && prevInterval !== undefined
        ? Math.min(1.25, (now - prevUpdatedAt) / Math.max(20, prevInterval))
        : contAlpha;
      const entFacingAlpha = Math.min(1, entAlpha);
      if (prevUpdatedAt !== undefined) {
        const gap = now - prevUpdatedAt;
        if (gap > 5 && gap < 450) {
          e.netInterval = prevInterval === undefined ? gap : prevInterval * 0.7 + gap * 0.3;
        }
      }
      e.netUpdatedAt = now;
      const teleDx = w.x - e.pos.x, teleDz = w.z - e.pos.z;
      if (teleDx * teleDx + teleDz * teleDz > TELEPORT_SNAP_DIST_SQ) {
        e.prevPos = { x: w.x, y: w.y, z: w.z };
        e.prevFacing = w.f;
      } else {
        e.prevPos = {
          x: e.prevPos.x + (e.pos.x - e.prevPos.x) * entAlpha,
          y: e.prevPos.y + (e.pos.y - e.prevPos.y) * entAlpha,
          z: e.prevPos.z + (e.pos.z - e.prevPos.z) * entAlpha,
        };
        e.prevFacing = e.prevFacing + wrapAngle(e.facing - e.prevFacing) * entFacingAlpha;
      }
      e.pos.x = w.x; e.pos.y = w.y; e.pos.z = w.z;
      e.facing = w.f;
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
      e.ownerId = w.own ?? null;
      e.threat = new Map(w.thr ?? []);
      e.auras = (w.auras ?? []).map((a: any) => ({
        id: a.id, name: a.name, kind: a.kind, remaining: a.rem, duration: a.dur,
        value: 0, sourceId: 0, school: 'physical' as const,
      }));
      e.loot = w.lootList ?? null;
      return e;
    };

    for (const w of snap.ents ?? []) {
      if (applyWire(w) !== null) seen.add(w.id);
    }
    for (const id of snap.keep ?? []) seen.add(id);

    const s = snap.self;
    const e = s ? applyWire(s) : null;
    if (s && e) {
      seen.add(s.id);
      e.resource = s.res;
      e.maxResource = s.mres;
      e.resourceType = s.rtype;
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
      if (s.buyback !== undefined) { this.vendorBuyback = s.buyback; this.invChanged = true; }
      if (s.equip !== undefined) this.equipment = s.equip;
      if (s.qlog !== undefined) this.questLog = new Map((s.qlog as QuestProgress[]).map((q) => [q.questId, q]));
      if (s.qdone !== undefined) this.questsDone = new Set(s.qdone);
      if (s.qlog !== undefined || s.qdone !== undefined) this.pendingQuestCommands.clear();
      this.known = abilitiesKnownAt(this.cfg.playerClass, e.level);
      if (s.party !== undefined) this.partyInfo = s.party;
      if (s.marks !== undefined) this.markers = s.marks ?? {};
      if (s.trade !== undefined) this.tradeInfo = s.trade;
      if (s.duel !== undefined) this.duelInfo = s.duel;
      if (s.arena !== undefined) this.arenaInfo = s.arena;
      if (s.market !== undefined) this.marketInfo = s.market;
      if (prevSelfFacing !== undefined && this.mouselookFacing === null) {
        this.pendingFacingDelta += wrapAngle(e.facing - prevSelfFacing);
      }
    }

    for (const id of this.entities.keys()) {
      if (!seen.has(id)) this.entities.delete(id);
    }
  }

  questState(questId: string): QuestState {
    const state = computeQuestState(questId, this.questLog, this.questsDone, this.player.level);
    const pending = this.pendingQuestCommands.get(questId);
    if ((pending === 'accept' && state === 'available') || (pending === 'turnin' && state === 'ready')) {
      return 'active';
    }
    return state;
  }

  castAbility(abilityId: string): void { this.cmd({ cmd: 'cast', ability: abilityId }); }
  castAbilityBySlot(slot: number): void { this.cmd({ cmd: 'castSlot', slot }); }
  targetEntity(id: number | null): void {
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
  tabTarget(): void { this.cmd({ cmd: 'tab' }); }
  startAutoAttack(): void { this.cmd({ cmd: 'attack' }); }
  stopAutoAttack(): void { this.cmd({ cmd: 'stopattack' }); }
  interact(): void { this.cmd({ cmd: 'interact' }); }
  lootCorpse(id: number): void { this.cmd({ cmd: 'loot', id }); }
  pickUpObject(id: number): void { this.cmd({ cmd: 'pickup', id }); }
  acceptQuest(questId: string): void {
    if (!this.canSendCommand()) return;
    this.pendingQuestCommands.set(questId, 'accept');
    this.cmd({ cmd: 'accept', quest: questId });
  }
  turnInQuest(questId: string): void {
    if (!this.canSendCommand()) return;
    this.pendingQuestCommands.set(questId, 'turnin');
    this.cmd({ cmd: 'turnin', quest: questId });
  }
  abandonQuest(questId: string): void { this.cmd({ cmd: 'abandon', quest: questId }); }
  equipItem(itemId: string): void { this.cmd({ cmd: 'equip', item: itemId }); }
  useItem(itemId: string): void { this.cmd({ cmd: 'use', item: itemId }); }
  buyItem(npcId: number, itemId: string): void { this.cmd({ cmd: 'buy', npc: npcId, item: itemId }); }
  sellItem(itemId: string, count?: number): void { this.cmd({ cmd: 'sell', item: itemId, count }); }
  buyBackItem(itemId: string): void { this.cmd({ cmd: 'buyback', item: itemId }); }
  releaseSpirit(): void { this.cmd({ cmd: 'release' }); }
  chat(text: string): void { this.cmd({ cmd: 'chat', text }); }
  partyInvite(targetPid: number): void { this.cmd({ cmd: 'pinvite', id: targetPid }); }
  partyAccept(): void { this.cmd({ cmd: 'paccept' }); }
  partyDecline(): void { this.cmd({ cmd: 'pdecline' }); }
  partyLeave(): void { this.cmd({ cmd: 'pleave' }); }
  partyKick(targetPid: number): void { this.cmd({ cmd: 'pkick', id: targetPid }); }
  markerFor(entityId: number): number | null { return this.markers[entityId] ?? null; }
  setMarker(entityId: number, markerId: number): void { this.cmd({ cmd: 'setMarker', id: entityId, marker: markerId }); }
  clearMarker(entityId: number): void { this.cmd({ cmd: 'clearMarker', id: entityId }); }
  tradeRequest(targetPid: number): void { this.cmd({ cmd: 'trade_req', id: targetPid }); }
  tradeAccept(): void { this.cmd({ cmd: 'trade_accept' }); }
  tradeSetOffer(items: InvSlot[], copper: number): void { this.cmd({ cmd: 'trade_offer', items, copper }); }
  tradeConfirm(): void { this.cmd({ cmd: 'trade_confirm' }); }
  tradeCancel(): void { this.cmd({ cmd: 'trade_cancel' }); }
  duelRequest(targetPid: number): void { this.cmd({ cmd: 'duel_req', id: targetPid }); }
  duelAccept(): void { this.cmd({ cmd: 'duel_accept' }); }
  duelDecline(): void { this.cmd({ cmd: 'duel_decline' }); }
  friendAdd(name: string): void { this.cmd({ cmd: 'friend_add', name }); }
  friendRemove(name: string): void { this.cmd({ cmd: 'friend_remove', name }); }
  blockAdd(name: string): void { this.cmd({ cmd: 'block_add', name }); }
  blockRemove(name: string): void { this.cmd({ cmd: 'block_remove', name }); }
  guildCreate(name: string): void { this.cmd({ cmd: 'guild_create', name }); }
  guildInvite(name: string): void { this.cmd({ cmd: 'guild_invite', name }); }
  guildAccept(): void { this.cmd({ cmd: 'guild_accept' }); }
  guildDecline(): void { this.cmd({ cmd: 'guild_decline' }); }
  guildLeave(): void { this.cmd({ cmd: 'guild_leave' }); }
  guildKick(name: string): void { this.cmd({ cmd: 'guild_kick', name }); }
  guildPromote(name: string): void { this.cmd({ cmd: 'guild_promote', name }); }
  guildDemote(name: string): void { this.cmd({ cmd: 'guild_demote', name }); }
  guildTransfer(name: string): void { this.cmd({ cmd: 'guild_transfer', name }); }
  guildDisband(): void { this.cmd({ cmd: 'guild_disband' }); }
  async searchCharacters(query: string): Promise<CharacterSearchResult[]> {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return [...this.characterRows.values()]
      .filter((row) => row.name.toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, 8)
      .map((row) => ({ name: row.name, cls: row.className, level: Number(row.level) }));
  }
  arenaQueueJoin(): void { this.cmd({ cmd: 'arena_queue' }); }
  arenaQueueLeave(): void { this.cmd({ cmd: 'arena_leave' }); }
  marketList(itemId: string, count: number, price: number): void { this.cmd({ cmd: 'market_list', item: itemId, count, price }); }
  marketBuy(listingId: number): void { this.cmd({ cmd: 'market_buy', id: listingId }); }
  marketCancel(listingId: number): void { this.cmd({ cmd: 'market_cancel', id: listingId }); }
  marketCollect(): void { this.cmd({ cmd: 'market_collect' }); }
  enterDungeon(dungeonId: string): void { this.cmd({ cmd: 'enter_dungeon', dungeon: dungeonId }); }
  leaveDungeon(): void { this.cmd({ cmd: 'leave_dungeon' }); }
  enterCrypt(): void { this.enterDungeon('hollow_crypt'); }
  leaveCrypt(): void { this.leaveDungeon(); }
}
