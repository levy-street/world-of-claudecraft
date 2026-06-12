import {
  ABILITIES, CAMPS, CLASSES, DUNGEONS, DUNGEON_LIST, DungeonDef, dungeonAt,
  DUNGEON_X_THRESHOLD, GROUND_OBJECTS, GROUP_XP_BONUS, INSTANCE_SLOT_COUNT,
  ITEMS, MOBS, NPCS, PLAYER_START, QUESTS, REWARD_ARCHETYPE, abilitiesKnownAt, instanceOrigin,
  zoneAt,
} from './data';
import { resolvePosition } from './colliders';
import { createGroundObject, createMob, createNpc, createPlayer, recalcPlayerStats, PlayerEquipment } from './entity';
import { Rng } from './rng';
import { SpatialGrid } from './spatial';
import { groundHeight, WATER_LEVEL } from './world';
import {
  AbilityDef, AbilityEffect, Aura, CAST_PUSHBACK_SEC, CHANNEL_PUSHBACK_FRACTION, CONSUME_DURATION,
  CONSUME_TICKS, DT, Entity, EquipSlot, GCD,
  INTERACT_RANGE, InvSlot, MELEE_RANGE, MAX_LEVEL,
  MoveInput, PlayerClass, QuestProgress, QuestState, RUN_SPEED, SimConfig, SimEvent, TURN_SPEED, Vec3,
  angleTo, armorReduction, dist2d, emptyMoveInput, isConsuming, meleeMissChance, mobXpValue, normAngle,
  rageFromDealing, rageFromTaking, spellHitChance, xpForLevel,
} from './types';

const LEASH_DISTANCE = 45;
const DUNGEON_LEASH_DISTANCE = 70;
const CORPSE_DURATION = 60;
const EVADE_SPEED_MULT = 1.6;
const BACKPEDAL_MULT = 0.65;
const GRAVITY = 16;
const JUMP_VELOCITY = 6;
const MELEE_ARC = 2.2; // radians half-arc within which melee swings connect
const FALL_SAFE_DISTANCE = 12; // yards of free fall before damage
const OBJECT_RESPAWN = 30;
const PARTY_MAX = 5;
const PARTY_XP_RANGE = 80; // yards: members this close share kill xp/credit
const DUEL_COUNTDOWN = 3;
const SAY_RANGE = 25; // /say carries a short distance; /yell across a camp
const YELL_RANGE = 100;
const CHAT_BURST = 8; // messages a player may send back-to-back...
const CHAT_REFILL = 2; // ...then this many more per second (caps spam amplifiers)
const DUEL_FORFEIT_DISTANCE = 60;
const TRADE_RANGE = 10;
const INSTANCE_EMPTY_TIMEOUT = 300; // seconds before an empty instance resets
const HUNTER_RANGED_DEADZONE = 8;
const MAX_CLIMB_SLOPE = 1.5; // rise/run above which a ground move is blocked (cliffs, world rim)
const SWIM_SURFACE_Y = WATER_LEVEL - 0.75; // body bobs just below the water line
const SWIM_DEPTH = 0.8; // ground this far under the water line = deep water
const SWIM_SPEED_MULT = 0.65;
const DOOR_TRIGGER_RADIUS = 2.0; // walking this close to a dungeon door teleports you
const BODY_RADIUS = 0.5;

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
  copper: number;
  equipment: PlayerEquipment;
  xp: number;
  known: ResolvedAbility[];
  questLog: Map<string, QuestProgress>;
  questsDone: Set<string>;
  counters: RewardCounters;
  autoEquip: boolean;
}

// Persistable character state (stored as JSONB server-side).
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
  questLog: { questId: string; counts: number[]; state: 'active' | 'ready' | 'done' }[];
  questsDone: string[];
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

function freshCounters(): RewardCounters {
  return {
    damageDealt: 0, damageTaken: 0, kills: 0, deaths: 0, xpGained: 0,
    questsCompleted: 0, questProgress: 0, lootCopper: 0, levelUps: 0,
  };
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
  trades = new Map<number, TradeSession>(); // pid -> shared session (both pids point at it)
  tradeInvites = new Map<number, { fromPid: number; expires: number }>();
  duels = new Map<number, DuelState>(); // pid -> shared duel (both pids)
  duelInvites = new Map<number, { fromPid: number; expires: number }>();
  // per-player chat token bucket (anti-spam); refilled lazily by sim time
  private chatTokens = new Map<number, { tokens: number; at: number }>();
  // dungeon instances
  instances: InstanceSlot[] = [];

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
    }

    // Mobs from camps
    for (const camp of CAMPS) {
      const template = MOBS[camp.mobId];
      // murlocs may wade in the shallows; everyone else spawns on dry land
      const minHeight = template.family === 'murloc' ? WATER_LEVEL - 0.5 : WATER_LEVEL + 0.4;
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
      copper: 0,
      equipment: { mainhand: classDef.startWeapon, chest: classDef.startChest },
      xp: 0,
      known: [],
      questLog: new Map(),
      questsDone: new Set(),
      counters: freshCounters(),
      autoEquip: opts?.autoEquip ?? false,
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
    this.partyInvites.delete(pid);
    this.tradeInvites.delete(pid);
    this.duelInvites.delete(pid);
    // mobs chasing this player give up
    for (const m of this.entities.values()) {
      if (m.kind === 'mob' && m.aggroTargetId === pid) {
        m.aggroTargetId = null;
        if (!m.dead && m.aiState !== 'dead') m.aiState = 'evade';
      }
      if (m.kind === 'mob' && m.tappedById === pid && !m.dead) m.tappedById = null;
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
      questLog: [...meta.questLog.values()].map((q) => ({ questId: q.questId, counts: [...q.counts], state: q.state })),
      questsDone: [...meta.questsDone],
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
      e.prevPos = { ...e.pos };
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
    this.updateTradesAndInvites();
    this.updateInstances();

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
  private moveSpeedMult(e: Entity): number {
    let slow = 1, speed = 1;
    for (const a of e.auras) {
      if (a.kind === 'slow') slow = Math.min(slow, a.value);
      if (a.kind === 'buff_speed') speed = Math.max(speed, a.value);
    }
    return slow * speed;
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

  private updatePlayerMovement(p: Entity, meta: PlayerMeta): void {
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
        const regen = p.stats.spi / 4 + 2;
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
            }
          } else if (a.kind === 'polymorph') {
            const heal = Math.round(e.maxHp * 0.10);
            e.hp = Math.min(e.maxHp, e.hp + heal);
          }
        }
      }
      if (a.remaining <= 0) {
        e.auras.splice(i, 1);
        this.emit({ type: 'aura', targetId: e.id, name: a.name, gained: false });
        if (a.kind.startsWith('buff')) statsDirty = true;
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
      const res = this.resolvedAbility(p.castingAbility, p.id);
      p.castingAbility = null;
      p.castRemaining = 0;
      this.emit({ type: 'castStop', entityId: p.id, success: true });
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
    if (p.cooldowns.has(ability.id)) { this.error(p.id, 'That ability is not ready yet.'); return; }
    if (p.resource < res.cost) {
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
    if (p.resource < res.cost) { this.error(p.id, 'Not enough ' + (p.resourceType ?? 'resource') + '!'); return; }

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

    this.spendResource(p, res.cost);
    if (ability.cooldown > 0) p.cooldowns.set(ability.id, ability.cooldown);
    this.runEffects(p, meta, target, res);
  }

  private runEffects(p: Entity, meta: PlayerMeta, target: Entity | null, res: ResolvedAbility): void {
    const ability = res.def;
    const isSpell = ability.school !== 'physical';
    const spentCombo = ability.spendsCombo ? p.comboPoints : 0;
    let comboAwarded = false;

    for (const eff of res.effects) {
      switch (eff.type) {
        case 'weaponStrike': {
          if (!target) break;
          const hit = this.meleeSwing(p, target, eff.bonus, ability.name, {
            cannotBeDodged: eff.cannotBeDodged,
            weaponMult: eff.weaponMult ?? 1,
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
          if (!isSpell) dmg *= 1 - armorReduction(target.stats.armor, p.level);
          this.dealDamage(p, target, Math.round(dmg), crit, ability.school, ability.name, 'hit');
          if (!target.dead && ability.awardsCombo && !comboAwarded) {
            this.awardCombo(p, target, ability.awardsCombo);
            comboAwarded = true;
          }
          break;
        }
        case 'finisherDamage': {
          if (!target || spentCombo <= 0) break;
          let dmg = eff.base + eff.perCombo * spentCombo + this.rng.range(0, eff.variance) + (p.attackPower / 14);
          const crit = this.rng.chance(p.critChance);
          if (crit) dmg *= 2;
          dmg *= 1 - armorReduction(target.stats.armor, p.level);
          this.dealDamage(p, target, Math.round(dmg), crit, 'physical', ability.name, 'hit');
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
          this.applyAura(target, {
            id: ability.id + '_root', name: ability.name, kind: 'root',
            remaining: eff.duration, duration: eff.duration, value: 0,
            sourceId: p.id, school: ability.school,
          });
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
            dmg *= 1 - armorReduction(m.stats.armor, p.level);
            this.dealDamage(p, m, Math.round(dmg), false, ability.school, ability.name, 'hit');
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
          for (const m of this.mobsInRadius(p.pos, eff.radius)) {
            const dmg = this.rng.range(eff.min, eff.max);
            this.dealDamage(p, m, Math.round(dmg), false, ability.school, ability.name, 'hit');
            if (!m.dead) {
              this.applyAura(m, {
                id: ability.id + '_root', name: ability.name, kind: 'root',
                remaining: eff.duration, duration: eff.duration, value: 0,
                sourceId: p.id, school: ability.school,
              });
            }
          }
          break;
        }
        case 'selfBuff': {
          // forms are toggles: casting again shifts back
          if (eff.kind === 'form_bear') {
            const existing = p.auras.findIndex((a) => a.id === ability.id);
            if (existing >= 0) {
              p.auras.splice(existing, 1);
              this.emit({ type: 'aura', targetId: p.id, name: ability.name, gained: false });
              recalcPlayerStats(p, meta.cls, meta.equipment);
              break;
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
          const ang = angleTo(target.pos, p.pos);
          const nx = target.pos.x + Math.sin(ang) * 2.5;
          const nz = target.pos.z + Math.cos(ang) * 2.5;
          p.pos.x = nx; p.pos.z = nz;
          p.pos.y = groundHeight(nx, nz, this.cfg.seed);
          p.facing = angleTo(p.pos, target.pos);
          if (p.resourceType === 'rage') p.resource = Math.min(p.maxResource, p.resource + 9);
          this.enterCombat(p, target);
          this.startAutoAttack(p.id);
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
    const existing = target.auras.findIndex((a) => a.id === aura.id && a.sourceId === aura.sourceId);
    if (existing >= 0) target.auras.splice(existing, 1);
    target.auras.push(aura);
    this.emit({ type: 'aura', targetId: target.id, name: aura.name, gained: true });
    if (target.kind === 'player') {
      const meta = this.players.get(target.id);
      if (meta) recalcPlayerStats(target, meta.cls, meta.equipment);
    }
  }

  private mobsInRadius(pos: Vec3, radius: number): Entity[] {
    const out: Entity[] = [];
    this.grid.forEachInRadius(pos.x, pos.z, radius, (e) => {
      if (e.kind === 'mob' && !e.dead && e.hostile) out.push(e);
    });
    return out;
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

    // hunter auto shot: ranged auto-attack with a dead zone inside 8 yards
    const ranged = CLASSES[meta.cls].ranged;
    if (ranged && d >= HUNTER_RANGED_DEADZONE && d <= ranged.maxRange) {
      this.rangedSwing(p, t, ranged);
      p.swingTimer = ranged.speed * this.swingIntervalMult(p);
      return;
    }
    if (d > MELEE_RANGE) return;

    let bonus = 0;
    let abilityName: string | null = null;
    if (p.queuedOnSwing) {
      const queued = this.resolvedAbility(p.queuedOnSwing, p.id);
      if (queued) {
        const eff = queued.effects.find((e) => e.type === 'weaponDamage');
        if (p.resource >= queued.cost && eff && eff.type === 'weaponDamage') {
          this.spendResource(p, queued.cost);
          bonus = eff.bonus;
          abilityName = queued.def.name;
        }
      }
      p.queuedOnSwing = null;
    }
    this.meleeSwing(p, t, bonus, abilityName, {});
    p.swingTimer = p.weapon.speed * this.swingIntervalMult(p);
  }

  private rangedSwing(attacker: Entity, target: Entity, ranged: { min: number; max: number; speed: number }): void {
    this.emit({ type: 'spellfx', sourceId: attacker.id, targetId: target.id, school: 'physical', fx: 'projectile' });
    const missChance = meleeMissChance(attacker.level, target.level);
    if (this.rng.chance(missChance)) {
      this.emit({ type: 'damage', sourceId: attacker.id, targetId: target.id, amount: 0, crit: false, school: 'physical', ability: 'Auto Shot', kind: 'miss' });
      this.enterCombat(attacker, target);
      return;
    }
    let dmg = this.rng.range(ranged.min, ranged.max) + (attacker.rangedPower / 14) * ranged.speed;
    const crit = this.rng.chance(attacker.critChance);
    if (crit) dmg *= 2;
    dmg *= 1 - armorReduction(target.stats.armor, attacker.level);
    this.dealDamage(attacker, target, Math.max(1, Math.round(dmg)), crit, 'physical', 'Auto Shot', 'hit');
  }

  // Returns true if the swing connected.
  private meleeSwing(
    attacker: Entity, target: Entity, bonus: number, abilityName: string | null,
    opts: { cannotBeDodged?: boolean; weaponMult?: number },
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
    let dmg = (this.rng.range(attacker.weapon.min, attacker.weapon.max) + (attacker.attackPower / 14) * attacker.weapon.speed) * mult + bonus + imbueBonus;
    const critChance = Math.max(0.005, attacker.critChance - Math.max(0, target.level - attacker.level) * 0.002);
    const crit = this.rng.chance(critChance);
    if (crit) dmg *= 2;
    dmg *= 1 - armorReduction(target.stats.armor, attacker.level);
    this.dealDamage(attacker, target, Math.max(1, Math.round(dmg)), crit, 'physical', abilityName, 'hit');
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

  private dealDamage(source: Entity | null, target: Entity, amount: number, crit: boolean, school: string, ability: string | null, kind: 'hit' | 'miss' | 'dodge', noRage = false): void {
    if (target.dead) return;
    if (target.gm) return; // GM characters are invulnerable — every damage path funnels here
    amount = Math.max(0, amount);

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

    if (source && source.id !== target.id) this.enterCombat(source, target);

    // tap rights: first player to damage a mob owns it
    if (source && source.kind === 'player' && target.kind === 'mob' && target.tappedById === null && amount >= 0) {
      target.tappedById = source.id;
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
        this.pushbackCast(target);
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
    if (b.kind === 'mob' && !b.dead && a.kind === 'player' && b.aiState !== 'evade') {
      if (b.aiState === 'idle') this.aggroMob(b, a, true);
      else if (b.aggroTargetId === null) b.aggroTargetId = a.id;
    }
    if (a.kind === 'mob' && !a.dead && b.kind === 'player' && a.aiState === 'idle') {
      this.aggroMob(a, b, false);
    }
  }

  private handleDeath(e: Entity, killer: Entity | null): void {
    e.dead = true;
    e.hp = 0;
    e.auras = [];
    e.castingAbility = null;
    this.emit({ type: 'death', entityId: e.id, killerId: killer?.id ?? -1 });

    if (e.kind === 'player') {
      const meta = this.players.get(e.id);
      if (meta) meta.counters.deaths++;
      e.autoAttack = false;
      e.queuedOnSwing = null;
      e.comboPoints = 0;
      e.eating = null;
      e.drinking = null;
      e.sitting = false;
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
      e.aiState = 'dead';
      e.corpseTimer = CORPSE_DURATION;
      e.respawnTimer = this.cfg.respawnSeconds * (MOBS[e.templateId]?.rare ? 4 : 1);
      e.aggroTargetId = null;

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
        this.rollLoot(e, meta);
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

  private rollLoot(mob: Entity, meta: PlayerMeta): void {
    const template = MOBS[mob.templateId];
    if (!template) return;
    let copper = 0;
    const items: InvSlot[] = [];
    const rolledGroups = new Set<string>();
    for (const entry of template.loot) {
      // exclusive groups (boss "one of three" tables): a single rng draw is
      // partitioned by the group entries' chances so exactly one drops.
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
        const qp = meta.questLog.get(entry.questId);
        if (!qp || qp.state !== 'active') continue;
        const quest = QUESTS[entry.questId];
        const objIdx = quest.objectives.findIndex((o) => o.type === 'collect' && o.itemId === entry.itemId);
        if (objIdx >= 0 && this.countItem(entry.itemId!, meta.entityId) >= quest.objectives[objIdx].count) continue;
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

  // -------------------------------------------------------------------------
  // Mob AI
  // -------------------------------------------------------------------------

  // When a mob's target dies/leaves, swing to the nearest living player
  // nearby instead of resetting the fight (poor man's threat table).
  private retargetMob(mob: Entity): void {
    const next = this.nearestLivingPlayer(mob.pos, 35);
    if (next) {
      mob.aggroTargetId = next.e.id;
      mob.aiState = 'chase';
      mob.inCombat = true;
    } else {
      mob.aggroTargetId = null;
      mob.aiState = 'evade';
    }
  }

  private aggroMob(mob: Entity, target: Entity, social: boolean): void {
    if (mob.dead || mob.aiState === 'evade' || mob.aiState === 'chase' || mob.aiState === 'attack') return;
    mob.aiState = 'chase';
    mob.aggroTargetId = target.id;
    mob.inCombat = true;
    if (social) {
      const pullRadius = MOBS[mob.templateId]?.family === 'murloc' ? 18 : 12;
      this.grid.forEachInRadius(mob.pos.x, mob.pos.z, pullRadius, (m, d2) => {
        if (m.kind === 'mob' && m.id !== mob.id && !m.dead && m.aiState === 'idle'
          && m.templateId === mob.templateId && d2 < pullRadius * pullRadius) {
          m.aiState = 'chase';
          m.aggroTargetId = target.id;
          m.inCombat = true;
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
          const radius = Math.max(4, Math.min(20, template.aggroRadius + (mob.level - nearest.e.level) * 1.5));
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
        const target = mob.aggroTargetId !== null ? this.entities.get(mob.aggroTargetId) : null;
        if (!target || target.dead) {
          this.retargetMob(mob);
          break;
        }
        const leash = mob.spawnPos.x > DUNGEON_X_THRESHOLD ? DUNGEON_LEASH_DISTANCE : LEASH_DISTANCE;
        if (dist2d(mob.pos, mob.spawnPos) > leash) {
          mob.aiState = 'evade';
          mob.aggroTargetId = null;
          this.emit({ type: 'log', text: mob.name + ' returns home.', color: '#999', entityId: mob.id });
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
        // boss pulse mechanic (Morthen's Shadow Pulse)
        const pulse = MOBS[mob.templateId]?.aoePulse;
        if (pulse) {
          mob.pulseTimer -= DT;
          if (mob.pulseTimer <= 0) {
            mob.pulseTimer = pulse.every;
            this.emit({ type: 'spellfx', sourceId: mob.id, targetId: mob.id, school: 'shadow', fx: 'nova' });
            for (const meta of this.players.values()) {
              const pe = this.entities.get(meta.entityId);
              if (pe && !pe.dead && dist2d(pe.pos, mob.pos) <= pulse.radius) {
                const dmg = Math.round(this.rng.range(pulse.min, pulse.max));
                this.dealDamage(mob, pe, dmg, false, 'shadow', pulse.name, 'hit', true);
              }
            }
          }
        }
        break;
      }
      case 'evade': {
        const arrived = this.moveToward(mob, mob.spawnPos, mob.moveSpeed * EVADE_SPEED_MULT);
        if (arrived) {
          mob.aiState = 'idle';
          mob.hp = mob.maxHp;
          mob.auras = [];
          mob.inCombat = false;
          mob.tappedById = null;
          this.despawnSummonedAdds(mob);
          mob.firedSummons = 0;
          mob.enraged = false;
          mob.wanderTimer = this.rng.range(2, 8);
        }
        break;
      }
    }
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
    let dmg = this.rng.range(mob.weapon.min, mob.weapon.max);
    const crit = this.rng.chance(0.05);
    if (crit) dmg *= 2;
    const enrage = MOBS[mob.templateId]?.enrage;
    if (mob.enraged && enrage) dmg *= enrage.dmgMult;
    dmg *= 1 - armorReduction(target.stats.armor, mob.level);
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

  private moveToward(e: Entity, dest: Vec3, speed: number): boolean {
    const d = dist2d(e.pos, dest);
    if (d < 0.3) return true;
    e.facing = angleTo(e.pos, dest);
    const step = Math.min(speed * DT, d);
    const nx = e.pos.x + Math.sin(e.facing) * step;
    const nz = e.pos.z + Math.cos(e.facing) * step;
    const ground = groundHeight(nx, nz, this.cfg.seed);
    const canSwim = MOBS[e.templateId]?.family === 'murloc';
    // landlocked creatures stop at the waterline instead of walking under it
    if (!canSwim && ground < WATER_LEVEL - SWIM_DEPTH) return false;
    const resolved = resolvePosition(this.cfg.seed, nx, nz, BODY_RADIUS);
    e.pos.x = resolved.x;
    e.pos.z = resolved.z;
    const g = groundHeight(e.pos.x, e.pos.z, this.cfg.seed);
    e.pos.y = canSwim && g < WATER_LEVEL - SWIM_DEPTH ? SWIM_SURFACE_Y : g;
    return d - step < 0.3;
  }

  private respawnMob(mob: Entity): void {
    mob.dead = false;
    mob.lootable = false;
    mob.loot = null;
    mob.tappedById = null;
    mob.pos = { ...mob.spawnPos };
    mob.pos.y = groundHeight(mob.pos.x, mob.pos.z, this.cfg.seed);
    mob.prevPos = { ...mob.pos };
    this.rebucket(mob);
    mob.hp = mob.maxHp;
    mob.auras = [];
    mob.aiState = 'idle';
    mob.aggroTargetId = null;
    mob.inCombat = false;
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

  useItem(itemId: string, pid?: number): void {
    const r = this.resolve(pid);
    if (!r) return;
    const { meta, e: p } = r;
    const def = ITEMS[itemId];
    if (!def || this.countItem(itemId, meta.entityId) <= 0 || p.dead) return;
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
    if (!npc || npc.kind !== 'npc' || !npc.vendorItems.includes(itemId) || !def?.buyValue) return;
    if (dist2d(p.pos, npc.pos) > INTERACT_RANGE + 2) { this.error(meta.entityId, 'Too far away.'); return; }
    if (meta.copper < def.buyValue) { this.error(meta.entityId, 'Not enough money.'); return; }
    meta.copper -= def.buyValue;
    this.addItem(itemId, 1, meta.entityId);
    this.emit({ type: 'vendor', action: 'buy', itemId, pid: meta.entityId });
  }

  sellItem(itemId: string, pid?: number): void {
    const r = this.resolve(pid);
    if (!r) return;
    const { meta, e: p } = r;
    const def = ITEMS[itemId];
    if (!def || this.countItem(itemId, meta.entityId) <= 0 || p.dead) return;
    // mirror buyItem's gate: selling requires a vendor in interact range
    const nearVendor = [...this.entities.values()].some((e) =>
      e.kind === 'npc' && e.vendorItems.length > 0 && dist2d(p.pos, e.pos) <= INTERACT_RANGE + 2);
    if (!nearVendor) { this.error(meta.entityId, 'There is no merchant nearby.'); return; }
    if (def.kind === 'quest') { this.error(meta.entityId, 'You cannot sell quest items.'); return; }
    this.removeItem(itemId, 1, meta.entityId);
    meta.copper += def.sellValue;
    this.emit({ type: 'vendor', action: 'sell', itemId, pid: meta.entityId });
    this.emit({ type: 'loot', text: `Sold ${def.name} for ${formatMoney(def.sellValue)}.`, pid: meta.entityId });
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
    }
    for (const s of mob.loot.items) this.addItem(s.itemId, s.count, meta.entityId);
    mob.loot = null;
    mob.lootable = false;
    mob.corpseTimer = Math.min(mob.corpseTimer, 4);
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
      if (this.questState(qid, meta.entityId) === 'available') {
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

  acceptQuest(questId: string, pid?: number): void {
    const r = this.resolve(pid);
    if (!r) return;
    const { meta } = r;
    if (this.questState(questId, meta.entityId) !== 'available') return;
    const quest = QUESTS[questId];
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
    const qp = meta.questLog.get(questId);
    if (!qp || qp.state !== 'ready') return;
    const quest = QUESTS[questId];
    const npc = [...this.entities.values()].find((e) => e.kind === 'npc' && e.templateId === quest.turnInNpcId);
    if (!npc || dist2d(p.pos, npc.pos) > INTERACT_RANGE + 2) { this.error(meta.entityId, 'Too far away.'); return; }

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
    const rewardItem = quest.itemRewards[meta.cls] ?? quest.itemRewards[REWARD_ARCHETYPE[meta.cls]];
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
      this.emit({ type: 'chat', from: r.meta.name, text: msg, channel: 'whisper', pid: target.entityId });
      this.emit({ type: 'chat', from: r.meta.name, to: target.name, text: msg, channel: 'whisper', pid: r.meta.entityId });
      return { channel: 'whisper', message: msg };
    }

    // "/p message" goes to the party channel
    if (/^\/p(arty)?\s/i.test(raw)) {
      const clean = raw.replace(/^\/p(arty)?\s+/i, '').trim();
      if (!clean) return null;
      const party = this.partyOf(r.meta.entityId);
      if (!party) { this.error(r.meta.entityId, 'You are not in a party.'); return null; }
      for (const mPid of party.members) {
        this.emit({ type: 'chat', from: r.meta.name, text: clean, channel: 'party', pid: mPid });
      }
      return { channel: 'party', message: clean };
    }

    // "/g message" — world-wide general channel (no pid = broadcast to all)
    if (/^\/g(eneral)?\s/i.test(raw)) {
      const clean = raw.replace(/^\/g(eneral)?\s+/i, '').trim();
      if (!clean) return null;
      this.emit({ type: 'chat', from: r.meta.name, text: clean, channel: 'general' });
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
      this.emit({ type: 'chat', from: r.meta.name, text: clean, channel, entityId: r.e.id, pid: meta.entityId });
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
      return !!duel && duel.state === 'active' && (duel.a === target.id || duel.b === target.id);
    }
    return false;
  }

  private isFriendlyTo(caster: Entity, target: Entity): boolean {
    if (target.kind !== 'player') return false;
    return !this.isHostileTo(caster, target);
  }

  // -------------------------------------------------------------------------
  // Parties
  // -------------------------------------------------------------------------

  partyOf(pid: number): Party | null {
    const partyId = this.partyByPid.get(pid);
    return partyId !== undefined ? this.parties.get(partyId) ?? null : null;
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
    } else if (party.leader === pid) {
      party.leader = party.members[0];
      const newLeader = this.players.get(party.leader);
      for (const mPid of party.members) {
        this.emit({ type: 'log', text: `${newLeader?.name ?? 'Someone'} is now the party leader.`, color: '#aaf', pid: mPid });
      }
    }
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
          x: e.pos.x, z: e.pos.z, dead: e.dead ? 1 : 0,
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
