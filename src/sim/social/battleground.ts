// The Gravemarch, the 5v5 battleground (docs/prd/battlegrounds.md), a
// SimContext system module modeled on social/arena.ts + social/fiesta.ts:
// queue + matchmaking, the match lifecycle (countdown / active / over /
// return), the module-driven battleground entities (minion columns, Bulwark
// towers, Warstones, the neutral Knell Warden), the fiesta-pattern bench
// respawn, Elo, desertion, and the BgInfo presentation read.
//
// State stays on Sim (bgQueue / bgMatches / bgBusySlots / nextBgMatchId /
// bgDeserters as live SimContext views); this module holds only functions.
// Sim keeps thin same-named delegates for every foreign caller (the IWorld
// facet, server helpers, combat/damage.ts arms via ctx, removePlayer, tests).
//
// DETERMINISM CONTRACT: every MODULE-DRIVEN battleground roll (minion damage,
// bulwark bolts, warden swings) draws from the PER-MATCH sub-stream
// `match.rng`, seeded off the sim clock + match id with ZERO shared-stream
// draws (the fiesta.ts per-match-stream mechanism). Player/pet/bot abilities
// that hit battleground entities resolve through the normal combat pipeline
// and draw from the shared stream like all combat, which is correct.
// updateBattlegrounds performs ZERO shared-rng draws and ZERO state changes
// on ticks with no queue entries and no live matches, so the parity goldens
// never fork and idle worlds are byte-identical with the feature unused.
//
// `src/sim`-pure: no DOM/Three/render/ui/game/net imports, no Math.random /
// Date.now (enforced by tests/architecture.test.ts). Player-facing error
// strings reuse the arena.ts literals verbatim (already covered by the
// sim_i18n matchers) plus the pinned Gravemarch literals the client matcher
// adds in this change set.

import type {
  BgAllyPosition,
  BgInfo,
  BgLadderEntry,
  BgLiveMatch,
  BgMatchInfo,
  BgScoreboardPlayer,
  BgStanding,
  BgStructureView,
} from '../../world_api/battleground';
import {
  BG_KNELL_POS,
  BG_STRUCTURES,
  type BgLane,
  type BgStructureDef,
  type BgTeam,
  bgLaneWaypoints,
  bgMinionMuster,
  bgSpawns,
} from '../battleground_layout';
import {
  BATTLEGROUND_MOBS,
  BG_MINION_ROLES,
  BG_MOB_LEVEL,
  type BgMinionRole,
} from '../content/battleground';
import { BATTLEGROUND_SLOT_COUNT, battlegroundOrigin, DUNGEON_X_THRESHOLD } from '../data';
import { createMob } from '../entity';
import { Rng } from '../rng';
import type { PlayerMeta } from '../sim';
import type { SimContext } from '../sim_context';
import { clearThreat } from '../threat';
import { angleTo, DT, dist2d, type Entity, type SimEvent, type Vec3 } from '../types';
import * as arenaMod from './arena';
import { ARENA_BASE_RATING, eloDelta } from './arena';
import { fiestaDownEntity } from './fiesta';

// Gravemarch tuning consts (fiesta.ts comment style; every knob named here).
export const BG_TEAM_SIZE = 5; // fighters per company
export const BG_MIN_LEVEL = 10; // queue floor
export const BG_COUNTDOWN = 10; // s the companies stand at their warstones
export const BG_RETURN_DELAY = 8; // s of aftermath before everyone goes home
export const BG_MAX_DURATION = 900; // hard cap (s); the timeout ladder resolves it
export const BG_BOT_BACKFILL_WAIT = 75; // s a human unit waits before bots fill the field
export const BG_FIRST_WAVE_AT = 5; // s into the fight the first columns muster
export const BG_WAVE_INTERVAL = 32; // s between minion waves (per team per lane)
export const BG_SERGEANT_EVERY = 3; // every Nth wave adds a banner sergeant
export const BG_LANE_MINION_CAP = 8; // live minions per team per lane; spawns skip when full
export const BG_MINION_AGGRO_RADIUS = 12; // yd a marching column notices enemies
export const BG_BULWARK_RANGE = 18; // yd bolt range
export const BG_BULWARK_BOLT_EVERY = 1.6; // s between bolts
export const BG_BULWARK_BOLT_MIN = 90; // ~15-20 percent of a standardized fighter's hp
export const BG_BULWARK_BOLT_MAX = 115;
export const BG_KNELL_FIRST_SPAWN = 120; // s of match time before the Warden first rises
export const BG_KNELL_RESPAWN = 120; // s after death before it rises again
export const BG_KNELL_LEASH = 12; // yd from the chapel before it drops all and heals
export const BG_KNELL_SILENCE_DURATION = 60; // s of the felled-Warden team buffs
export const BG_KNELL_EMPOWERED_WAVES = 3; // waves that muster empowered after a silence
export const BG_EMPOWER_MULT = 1.5; // empowered minion hp/damage (and vs-structure bonus)
export const BG_SILENCE_STRUCTURE_DMG_MULT = 1.1; // silencing team's players vs structures
export const BG_RESPAWN_BASE = 8; // s for a first death
export const BG_RESPAWN_PER_DEATH = 1; // each prior death lengthens the next wait
export const BG_RESPAWN_PER_MINUTE = 1.5; // and the match dragging on lengthens it too
export const BG_RESPAWN_MAX = 30; // cap
export const BG_KILL_CREDIT_WINDOW = 10; // s a player's last hit still earns the takedown
export const BG_WARSTONE_THREAT_THROTTLE = 10; // s between bgWarstoneThreat warnings
export const BG_DESERTER_LOCKOUT = 300; // s of Deserter's Knell after abandoning a match
export const BG_CORPSE_LINGER = 5; // s a battleground corpse persists before despawn
export const BG_BASE_RATING = ARENA_BASE_RATING; // 1500, arena Elo reused
export const BG_LADDER_SIZE = 10; // live online ladder rows
const BG_TIMEOUT_DRAW_EPSILON = 0.02; // structure-hp fraction gap that still draws
const BG_KNELL_TARGET_SLACK = 4; // yd beyond the leash a target may stand and still be hit

// ---------------------------------------------------------------------------
// Match / queue state shapes (backing fields live on Sim; see sim.ts).
// ---------------------------------------------------------------------------

export interface BgQueueUnit {
  pids: number[]; // 1 (solo) .. BG_TEAM_SIZE (premade queued by its leader)
  rating: number; // avg member bgRating for rating-nearest packing
  queuedAt: number; // sim.time the unit joined (backfill timer + waitSec)
}

export interface BgMinion {
  entityId: number;
  team: BgTeam;
  lane: BgLane;
  role: BgMinionRole;
  waypoint: number; // index into bgLaneWaypoints(team, lane)
  swingTimer: number;
  empowered: boolean;
}

export interface BgStructureState {
  def: BgStructureDef;
  entityId: number;
  alive: boolean;
  boltTimer: number; // bulwarks only
  targetId: number | null; // bulwark current target (punish rule can force it)
}

export interface BgMatch {
  id: number;
  slot: number;
  state: 'countdown' | 'active' | 'over';
  timer: number; // countdown remaining, then elapsed once active, then return countdown
  teamA: number[]; // the Ember Company (south base)
  teamB: number[]; // the Pale Company (north base)
  rated: boolean; // false with bot backfill; flips false when a human deserts
  botPids: Set<number>;
  returns: Map<number, { x: number; z: number; facing: number }>;
  ratingA: number; // team avg at start (Elo snapshot, arena pattern)
  ratingB: number;
  rng: Rng; // the per-match sub-stream (see the determinism contract above)
  killsA: number;
  killsB: number;
  kills: Map<number, number>; // pid -> takedowns
  deaths: Map<number, number>; // pid -> deaths (drives respawn growth)
  down: Map<number, number>; // pid -> seconds until revive (absent = alive)
  deserted: Set<number>; // pids removed mid-match; team plays short-handed
  lastHitBy: Map<number, { pid: number; at: number }>; // victim -> last enemy player hit
  structures: BgStructureState[];
  minions: BgMinion[];
  corpses: { entityId: number; at: number }[]; // sim.time each despawns
  waveTimer: number;
  waveCount: number;
  empoweredWaves: { A: number; B: number };
  knellEntityId: number | null;
  knellSpawnIn: number; // s until the Warden (re)rises
  knellSwingTimer: number;
  knellSilencedBy: BgTeam | null;
  knellSilencedUntil: number; // match.timer deadline of the silence buffs
  warstoneThreatAt: { A: number; B: number }; // match.timer of the last warning
  winner?: BgTeam | null; // set once decided (null = draw)
  endReason?: 'defeat' | 'timeout' | 'forfeit';
}

function otherTeam(team: BgTeam): BgTeam {
  return team === 'A' ? 'B' : 'A';
}

// ---------------------------------------------------------------------------
// Standings + Elo (arena eloDelta reuse). PlayerMeta keeps the bg fields
// OPTIONAL and absent until first touched, so an untouched character samples
// identically in the parity goldens.
// ---------------------------------------------------------------------------

export function bgStanding(meta: PlayerMeta): BgStanding {
  return {
    rating: meta.bgRating ?? BG_BASE_RATING,
    wins: meta.bgWins ?? 0,
    losses: meta.bgLosses ?? 0,
  };
}

export function addBgResult(
  meta: PlayerMeta,
  delta: number,
  won: boolean | null,
): { before: number; after: number } {
  const before = bgStanding(meta).rating;
  const after = Math.max(100, before + delta);
  meta.bgRating = after;
  if (won === true) meta.bgWins = (meta.bgWins ?? 0) + 1;
  else if (won === false) meta.bgLosses = (meta.bgLosses ?? 0) + 1;
  return { before, after };
}

export function bgRatingForPid(ctx: SimContext, pid: number): number {
  const meta = ctx.players.get(pid);
  return meta ? bgStanding(meta).rating : BG_BASE_RATING;
}

export function bgTeamRating(ctx: SimContext, pids: number[]): number {
  if (pids.length === 0) return BG_BASE_RATING;
  let sum = 0;
  for (const pid of pids) sum += bgRatingForPid(ctx, pid);
  return sum / pids.length;
}

// ---------------------------------------------------------------------------
// Team / down predicates (the arena isArenaCrossTeam family, bg-shaped).
// ---------------------------------------------------------------------------

export function bgTeamOf(match: BgMatch, pid: number): BgTeam | null {
  if (match.teamA.includes(pid)) return 'A';
  if (match.teamB.includes(pid)) return 'B';
  return null;
}

export function bgAllPids(match: BgMatch): number[] {
  return [...match.teamA, ...match.teamB];
}

export function isBgDown(match: BgMatch, pid: number): boolean {
  return match.down.has(pid) || match.deserted.has(pid);
}

export function isBgCrossTeam(match: BgMatch, attackerPid: number, targetPid: number): boolean {
  const atkTeam = bgTeamOf(match, attackerPid);
  const tgtTeam = bgTeamOf(match, targetPid);
  if (!atkTeam || !tgtTeam || atkTeam === tgtTeam) return false;
  if (isBgDown(match, attackerPid)) return false;
  return !isBgDown(match, targetPid);
}

// Hostility arm for battleground mob-kind entities (minions / structures /
// the Warden). Consulted by Sim.isHostileTo when the TARGET carries a
// bgMatchId: a fighter (or their pet) is hostile to the enemy company's
// entities and to the neutral Warden; battleground mobs of opposing teams are
// hostile to each other. Everyone else sees them as inert scenery.
export function isBgMobHostileTo(ctx: SimContext, attacker: Entity, target: Entity): boolean {
  const match = bgMatchById(ctx, target.bgMatchId);
  if (!match || match.state !== 'active') return false;
  const attackerPlayer = ctx.pvpController(attacker);
  if (attackerPlayer) {
    if (ctx.bgMatches.get(attackerPlayer.id) !== match) return false;
    if (isBgDown(match, attackerPlayer.id)) return false;
    if (target.bgTeam === undefined) return true; // the neutral Knell Warden
    return bgTeamOf(match, attackerPlayer.id) !== target.bgTeam;
  }
  if (attacker.bgMatchId === target.bgMatchId) {
    if (attacker.bgTeam === undefined || target.bgTeam === undefined) return true;
    return attacker.bgTeam !== target.bgTeam;
  }
  return false;
}

export function bgMatchById(ctx: SimContext, id: number | undefined): BgMatch | null {
  if (id === undefined) return null;
  for (const match of ctx.bgMatches.values()) {
    if (match.id === id) return match;
  }
  return null;
}

export function bgMatchFor(ctx: SimContext, pid: number): BgMatch | null {
  return ctx.bgMatches.get(pid) ?? null;
}

function uniqueBgMatches(ctx: SimContext): BgMatch[] {
  const seen = new Set<BgMatch>();
  const out: BgMatch[] = [];
  for (const match of ctx.bgMatches.values()) {
    if (seen.has(match)) continue;
    seen.add(match);
    out.push(match);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Queue
// ---------------------------------------------------------------------------

export function isBgQueued(ctx: SimContext, pid: number): boolean {
  return ctx.bgQueue.some((u) => u.pids.includes(pid));
}

export function bgQueuePosition(ctx: SimContext, pid: number): number {
  let pos = 0;
  for (const unit of ctx.bgQueue) {
    if (unit.pids.includes(pid)) return pos + 1;
    pos += unit.pids.length;
  }
  return 0;
}

export function bgQueueSize(ctx: SimContext): number {
  return ctx.bgQueue.reduce((n, u) => n + u.pids.length, 0);
}

/** Deserter's Knell seconds remaining for a character name (0 = free). Lazily
 *  drops expired entries so the in-memory map never grows stale. */
export function bgDeserterFor(ctx: SimContext, name: string): number {
  const key = name.toLowerCase();
  const until = ctx.bgDeserters.get(key);
  if (until === undefined) return 0;
  const left = until - ctx.time;
  if (left <= 0) {
    ctx.bgDeserters.delete(key);
    return 0;
  }
  return left;
}

// One member's eligibility, shared by the self and per-member paths. Returns
// the error literal to emit, or null when eligible. Every literal reuses the
// arena.ts emit (already matched by sim_i18n) or one of the pinned Gravemarch
// strings the client matcher adds alongside this module.
function bgMemberGuard(ctx: SimContext, pid: number, self: boolean): string | null {
  const e = ctx.entities.get(pid);
  const meta = ctx.players.get(pid);
  if (!e || !meta) return 'A party member is unavailable.';
  const name = meta.name;
  if (ctx.bgMatches.has(pid) || ctx.arenaMatches.has(pid)) {
    return self ? 'You are already in an arena match.' : `${name} is already in an arena match.`;
  }
  if (isBgQueued(ctx, pid) || arenaMod.isArenaQueued(ctx, pid)) {
    return `${name} is already in the arena queue.`;
  }
  if (e.dead) {
    return self ? 'You cannot queue for the arena while dead.' : `${name} cannot queue while dead.`;
  }
  if (ctx.duels.has(pid)) {
    return self ? 'You cannot queue while dueling.' : `${name} cannot queue while dueling.`;
  }
  if (ctx.trades.has(pid)) {
    return self
      ? 'Finish your trade before queueing.'
      : `${name} must finish trading before queueing.`;
  }
  if (e.pos.x > DUNGEON_X_THRESHOLD) {
    return self
      ? 'You cannot queue from inside an instance.'
      : `${name} cannot queue from inside an instance.`;
  }
  if (e.level < BG_MIN_LEVEL) return 'You must be at least level 10 to join the Gravemarch.';
  if (bgDeserterFor(ctx, name) > 0) return "You cannot queue while the Deserter's Knell tolls.";
  return null;
}

export function bgQueueJoin(ctx: SimContext, pid?: number): void {
  const r = ctx.resolve(pid);
  if (!r) return;
  const id = r.meta.entityId;
  if (isBgQueued(ctx, id)) {
    ctx.emit({ type: 'bgQueued', position: bgQueuePosition(ctx, id), pid: id });
    return;
  }
  const selfErr = bgMemberGuard(ctx, id, true);
  if (selfErr) {
    ctx.error(id, selfErr);
    return;
  }
  const party = ctx.partyOf(id);
  let unitPids: number[];
  if (!party || party.members.length === 1) {
    unitPids = [id];
  } else {
    if (party.leader !== id) {
      ctx.error(id, 'Only the party leader may queue your team for the Gravemarch.');
      return;
    }
    if (party.members.length > BG_TEAM_SIZE) {
      // A raid group can exceed five; the Gravemarch takes 2..5.
      ctx.error(id, 'A Gravemarch company takes five at most.');
      return;
    }
    for (const mPid of party.members) {
      if (mPid === id) continue;
      const err = bgMemberGuard(ctx, mPid, false);
      if (err) {
        ctx.error(id, err);
        return;
      }
    }
    unitPids = [...party.members];
  }
  ctx.bgQueue.push({ pids: unitPids, rating: bgTeamRating(ctx, unitPids), queuedAt: ctx.time });
  for (const mPid of unitPids) {
    ctx.emit({ type: 'bgQueued', position: bgQueuePosition(ctx, mPid), pid: mPid });
  }
}

export function bgQueueLeave(ctx: SimContext, pid?: number): void {
  const r = ctx.resolve(pid);
  if (!r) return;
  bgDequeue(ctx, r.meta.entityId);
}

/** Remove the whole queue unit containing pid (a party leaves together, the
 *  arena unit pattern). Emits bgUnqueued to every removed member. */
export function bgDequeue(ctx: SimContext, pid: number): boolean {
  const i = ctx.bgQueue.findIndex((u) => u.pids.includes(pid));
  if (i < 0) return false;
  const unit = ctx.bgQueue[i];
  ctx.bgQueue.splice(i, 1);
  for (const mPid of unit.pids) {
    if (ctx.entities.has(mPid)) ctx.emit({ type: 'bgUnqueued', pid: mPid });
  }
  return true;
}

export function pruneBgQueue(ctx: SimContext): void {
  ctx.bgQueue = ctx.bgQueue.filter((unit) =>
    unit.pids.every((id) => {
      const e = ctx.entities.get(id);
      return !!e && !e.dead && !ctx.bgMatches.has(id) && !ctx.arenaMatches.has(id);
    }),
  );
}

export function freeBgSlot(ctx: SimContext): number | null {
  for (let i = 0; i < BATTLEGROUND_SLOT_COUNT; i++) {
    if (!ctx.bgBusySlots.has(i)) return i;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Matchmaking: greedy rating-nearest packing of queue units into two teams of
// BG_TEAM_SIZE, premades kept intact. The anchor (longest waiter) always
// seats; candidates are tried in rating-gap order with backtracking, so the
// first feasible packing is the greedy rating-nearest one. Pure and exported
// for direct unit tests.
// ---------------------------------------------------------------------------

const PACK_STEP_BUDGET = 5000; // hard cap on backtracking steps (determinism-safe bail)

export function packBgTeams(
  units: readonly BgQueueUnit[],
  size = BG_TEAM_SIZE,
): { a: number[]; b: number[]; used: BgQueueUnit[] } | null {
  if (units.length === 0) return null;
  const total = 2 * size;
  const anchor = units[0];
  if (anchor.pids.length > size) return null;
  const rest = units
    .slice(1)
    .map((u, i) => ({ u, gap: Math.abs(u.rating - anchor.rating), i }))
    .sort((x, y) => x.gap - y.gap || x.i - y.i)
    .map((x) => x.u);
  const ordered = [anchor, ...rest];
  // seats still reachable from index i onward (prunes the search)
  const suffix: number[] = new Array(ordered.length + 1).fill(0);
  for (let i = ordered.length - 1; i >= 0; i--) {
    suffix[i] = suffix[i + 1] + ordered[i].pids.length;
  }
  const chosen: BgQueueUnit[] = [];
  let steps = 0;
  const dfs = (idx: number, seats: number): BgQueueUnit[] | null => {
    if (steps++ > PACK_STEP_BUDGET) return null;
    if (seats === total) return splitBgTeams(chosen, size, anchor) ? [...chosen] : null;
    if (idx >= ordered.length || seats + suffix[idx] < total) return null;
    const unit = ordered[idx];
    if (seats + unit.pids.length <= total) {
      chosen.push(unit);
      const withUnit = dfs(idx + 1, seats + unit.pids.length);
      if (withUnit) return withUnit;
      chosen.pop();
    }
    if (idx === 0) return null; // the anchor always seats
    return dfs(idx + 1, seats);
  };
  const used = dfs(0, 0);
  if (!used) return null;
  const split = splitBgTeams(used, size, anchor);
  if (!split) return null;
  return {
    a: split.a.flatMap((u) => u.pids),
    b: split.b.flatMap((u) => u.pids),
    used,
  };
}

/** Split a set of units (total seats = 2*size) into two exact halves, units
 *  intact; the half holding the anchor becomes team A. Null when infeasible
 *  (e.g. units sized 4+3+3 cannot split 5/5). */
export function splitBgTeams(
  units: readonly BgQueueUnit[],
  size: number,
  anchor: BgQueueUnit,
): { a: BgQueueUnit[]; b: BgQueueUnit[] } | null {
  const pick: BgQueueUnit[] = [];
  const go = (i: number, seats: number): boolean => {
    if (seats === size) return true;
    if (i >= units.length || seats > size) return false;
    pick.push(units[i]);
    if (go(i + 1, seats + units[i].pids.length)) return true;
    pick.pop();
    return go(i + 1, seats);
  };
  if (!go(0, 0)) return null;
  const other = units.filter((u) => !pick.includes(u));
  return pick.includes(anchor) ? { a: pick, b: other } : { a: other, b: pick };
}

export function removeBgQueueUnits(ctx: SimContext, units: BgQueueUnit[]): void {
  for (const unit of units) {
    const i = ctx.bgQueue.indexOf(unit);
    if (i >= 0) ctx.bgQueue.splice(i, 1);
  }
}

export function matchmakeBg(ctx: SimContext): void {
  let guard = BATTLEGROUND_SLOT_COUNT + 1;
  while (guard-- > 0) {
    pruneBgQueue(ctx);
    if (freeBgSlot(ctx) === null) return;
    const pack = packBgTeams(ctx.bgQueue);
    if (!pack) return;
    removeBgQueueUnits(ctx, pack.used);
    if (!startBgMatch(ctx, pack.a, pack.b)) {
      // seat claim failed (entity vanished under us): requeue the survivors
      for (const unit of [...pack.used].reverse()) {
        if (unit.pids.every((id) => ctx.entities.get(id) && !ctx.bgMatches.has(id))) {
          ctx.bgQueue.unshift(unit);
        }
      }
      return;
    }
  }
}

// ---------------------------------------------------------------------------
// Match lifecycle
// ---------------------------------------------------------------------------

export function startBgMatch(
  ctx: SimContext,
  teamA: number[],
  teamB: number[],
  opts: { rated?: boolean; botPids?: number[] } = {},
): boolean {
  const slot = freeBgSlot(ctx);
  const allPids = [...teamA, ...teamB];
  const entities = allPids.map((pid) => ctx.entities.get(pid));
  const metas = allPids.map((pid) => ctx.players.get(pid));
  if (slot === null || entities.some((e) => !e) || metas.some((m) => !m)) return false;
  // A fighter still waiting in a Coliseum queue: the Gravemarch claims them
  // first, so the arena matchmaker can never teleport them out mid-match.
  for (const pid of allPids) {
    if (arenaMod.isArenaQueued(ctx, pid)) arenaMod.arenaQueueLeave(ctx, pid);
  }
  ctx.bgBusySlots.add(slot);
  const returns = new Map<number, { x: number; z: number; facing: number }>();
  for (let i = 0; i < allPids.length; i++) {
    const e = entities[i]!;
    returns.set(allPids[i], { x: e.pos.x, z: e.pos.z, facing: e.facing });
  }
  const botPids = opts.botPids ?? [];
  const rated = opts.rated ?? !metas.some((m) => m!.isBgBot);
  const match: BgMatch = {
    id: ctx.nextBgMatchId++,
    slot,
    state: 'countdown',
    timer: BG_COUNTDOWN,
    teamA,
    teamB,
    rated,
    botPids: new Set(botPids),
    returns,
    ratingA: bgTeamRating(ctx, teamA),
    ratingB: bgTeamRating(ctx, teamB),
    // Per-match deterministic stream, seeded off the sim clock + match id
    // (the exact fiesta.ts mechanism): ZERO shared-stream draws, so a match
    // start never perturbs the shared rng other systems consume.
    rng: new Rng((ctx.tickCount * 2654435761 + ctx.nextBgMatchId * 40503) >>> 0),
    killsA: 0,
    killsB: 0,
    kills: new Map(),
    deaths: new Map(),
    down: new Map(),
    deserted: new Set(),
    lastHitBy: new Map(),
    structures: [],
    minions: [],
    corpses: [],
    waveTimer: BG_FIRST_WAVE_AT,
    waveCount: 0,
    empoweredWaves: { A: 0, B: 0 },
    knellEntityId: null,
    knellSpawnIn: BG_KNELL_FIRST_SPAWN,
    knellSwingTimer: 0,
    knellSilencedBy: null,
    knellSilencedUntil: 0,
    warstoneThreatAt: { A: -Infinity, B: -Infinity },
  };
  for (const pid of allPids) ctx.bgMatches.set(pid, match);
  const origin = battlegroundOrigin(slot);
  placeBgTeam(ctx, teamA, origin, 'A');
  placeBgTeam(ctx, teamB, origin, 'B');
  // Fiesta-style standardization: everyone fights at level 20 on the default
  // build, then the arena clean-slate reset readies them for the countdown.
  for (let i = 0; i < allPids.length; i++) {
    const m = metas[i];
    const e = entities[i];
    if (m && e) ctx.fiestaStandardize(m, e);
  }
  for (const e of entities) ctx.resetForArena(e!);
  spawnBgStructures(ctx, match, origin);
  emitBgFound(ctx, match);
  for (const pid of allPids) ctx.emit({ type: 'bgCountdown', seconds: BG_COUNTDOWN, pid });
  return true;
}

function placeBgTeam(
  ctx: SimContext,
  pids: number[],
  origin: { x: number; z: number },
  team: BgTeam,
): void {
  const spawns = bgSpawns(team);
  for (let i = 0; i < pids.length; i++) {
    const e = ctx.entities.get(pids[i]);
    if (e) arenaMod.placeInArena(ctx, e, origin, spawns[i] ?? spawns[spawns.length - 1]);
  }
}

function emitBgFound(ctx: SimContext, match: BgMatch): void {
  for (const pid of bgAllPids(match)) {
    const myTeam = bgTeamOf(match, pid)!;
    const allyPids = (myTeam === 'A' ? match.teamA : match.teamB).filter((p) => p !== pid);
    const enemyPids = myTeam === 'A' ? match.teamB : match.teamA;
    ctx.emit({
      type: 'bgFound',
      team: myTeam,
      allies: arenaMod.arenaCombatants(ctx, allyPids),
      enemies: arenaMod.arenaCombatants(ctx, enemyPids),
      rated: match.rated,
      pid,
    });
  }
}

function spawnBgMob(
  ctx: SimContext,
  match: BgMatch,
  templateId: string,
  pos: { x: number; z: number },
  team: BgTeam | undefined,
): Entity {
  const template = BATTLEGROUND_MOBS[templateId];
  const mob = createMob(ctx.nextId++, template, BG_MOB_LEVEL, ctx.groundPos(pos.x, pos.z));
  mob.bgMatchId = match.id;
  if (team !== undefined) mob.bgTeam = team;
  ctx.addEntity(mob);
  return mob;
}

function spawnBgStructures(
  ctx: SimContext,
  match: BgMatch,
  origin: { x: number; z: number },
): void {
  for (const def of BG_STRUCTURES) {
    const mob = spawnBgMob(
      ctx,
      match,
      def.kind === 'warstone' ? 'bg_warstone' : 'bg_bulwark',
      { x: origin.x + def.x, z: origin.z + def.z },
      def.team,
    );
    mob.name = `${def.team === 'A' ? 'Ember' : 'Pale'} ${def.kind === 'warstone' ? 'Warstone' : 'Bulwark'}`;
    mob.facing = def.team === 'A' ? 0 : Math.PI;
    mob.prevFacing = mob.facing;
    match.structures.push({
      def,
      entityId: mob.id,
      alive: true,
      boltTimer: BG_BULWARK_BOLT_EVERY,
      targetId: null,
    });
  }
}

// The per-tick driver, called from tick()'s end-of-tick system block directly
// AFTER updateArena. Does nothing (and draws nothing) when idle.
export function updateBattlegrounds(ctx: SimContext): void {
  if (ctx.bgQueue.length > 0) {
    pruneBgQueue(ctx);
    matchmakeBg(ctx);
  }
  if (ctx.bgMatches.size === 0) return;
  for (const match of uniqueBgMatches(ctx)) updateBgMatch(ctx, match);
}

function teamConnected(ctx: SimContext, match: BgMatch, team: BgTeam): number {
  const pids = team === 'A' ? match.teamA : match.teamB;
  let n = 0;
  for (const pid of pids) {
    if (!match.deserted.has(pid) && ctx.entities.has(pid)) n++;
  }
  return n;
}

export function updateBgMatch(ctx: SimContext, match: BgMatch): void {
  // Fighters whose entity vanished without passing removePlayer (defensive:
  // the disconnect path routes through bgHandleDesertion already).
  for (const pid of bgAllPids(match)) {
    if (!match.deserted.has(pid) && !ctx.entities.has(pid)) bgHandleDesertion(ctx, match, pid);
  }
  if (match.state !== 'over') {
    const aliveA = teamConnected(ctx, match, 'A');
    const aliveB = teamConnected(ctx, match, 'B');
    if (aliveA === 0 || aliveB === 0) {
      const winner = aliveA === 0 && aliveB === 0 ? null : aliveA === 0 ? 'B' : 'A';
      endBgMatch(ctx, match, winner, 'forfeit');
      return;
    }
  }
  if (match.state === 'over') {
    match.timer -= DT;
    if (match.timer <= 0) returnFromBgMatch(ctx, match);
    return;
  }
  if (match.state === 'countdown') {
    const before = Math.ceil(match.timer);
    match.timer -= DT;
    const after = Math.ceil(match.timer);
    if (after < before && after > 0) {
      for (const pid of bgAllPids(match)) {
        if (ctx.entities.has(pid)) ctx.emit({ type: 'bgCountdown', seconds: after, pid });
      }
    }
    if (match.timer <= 0) {
      match.state = 'active';
      match.timer = 0;
      for (const pid of bgAllPids(match)) {
        const e = ctx.entities.get(pid);
        if (e) ctx.readyArenaFighter(e, { clearPrep: false });
      }
      for (const pid of bgAllPids(match)) {
        if (ctx.entities.has(pid)) ctx.emit({ type: 'bgStart', pid });
      }
    }
    return;
  }
  // active
  match.timer += DT;
  if (match.knellSilencedBy && match.timer >= match.knellSilencedUntil) {
    match.knellSilencedBy = null;
  }
  // endBgMatch can flip the state mid-pass (a warstone fell to a bolt or
  // minion swing), so re-read it through a widening helper between phases.
  const stillActive = () => (match.state as BgMatch['state']) === 'active';
  updateBgStructures(ctx, match);
  updateBgWaves(ctx, match);
  updateBgMinions(ctx, match);
  if (!stillActive()) return;
  updateBgKnell(ctx, match);
  updateBgRespawns(ctx, match);
  updateBgCorpses(ctx, match);
  if (!stillActive()) return;
  if (match.timer >= BG_MAX_DURATION) {
    endBgMatch(ctx, match, bgTimeoutWinnerFor(ctx, match), 'timeout');
  }
}

// ---------------------------------------------------------------------------
// Structures: stationary, control-immune (module-enforced), bulwark bolt AI.
// ---------------------------------------------------------------------------

/** Structural protection: an inner bulwark is untouchable while its lane's
 *  outer stands; a warstone until one of its own lanes lost BOTH bulwarks. */
export function bgStructureShielded(
  structures: readonly { def: BgStructureDef; alive: boolean }[],
  def: BgStructureDef,
): boolean {
  if (def.kind === 'bulwark') {
    if (def.tier !== 'inner') return false;
    const outer = structures.find(
      (s) => s.def.team === def.team && s.def.lane === def.lane && s.def.tier === 'outer',
    );
    return !!outer?.alive;
  }
  for (const lane of ['west', 'east'] as BgLane[]) {
    const laneOpen = structures
      .filter((s) => s.def.team === def.team && s.def.lane === lane)
      .every((s) => !s.alive);
    if (laneOpen) return false;
  }
  return true;
}

/** Bulwark target pick, pure for unit tests: a valid punished target holds;
 *  otherwise nearest enemy minion, then nearest enemy player. */
export function bgPickBulwarkTarget(
  punishedValid: boolean,
  currentId: number | null,
  minions: readonly { id: number; d: number }[],
  players: readonly { id: number; d: number }[],
): number | null {
  if (punishedValid && currentId !== null) return currentId;
  let best: number | null = null;
  let bestD = Infinity;
  for (const m of minions) {
    if (m.d < bestD) {
      bestD = m.d;
      best = m.id;
    }
  }
  if (best !== null) return best;
  for (const p of players) {
    if (p.d < bestD) {
      bestD = p.d;
      best = p.id;
    }
  }
  return best;
}

function bgEnemyFightersIn(
  ctx: SimContext,
  match: BgMatch,
  team: BgTeam,
  pos: Vec3,
  radius: number,
): { e: Entity; d: number }[] {
  const out: { e: Entity; d: number }[] = [];
  const enemies = team === 'A' ? match.teamB : match.teamA;
  for (const pid of enemies) {
    if (isBgDown(match, pid)) continue;
    const e = ctx.entities.get(pid);
    if (!e || e.dead || e.stealthed) continue;
    const d = dist2d(e.pos, pos);
    if (d <= radius) out.push({ e, d });
  }
  return out;
}

function bgEnemyMinionsIn(
  ctx: SimContext,
  match: BgMatch,
  team: BgTeam,
  pos: Vec3,
  radius: number,
): { e: Entity; d: number }[] {
  const out: { e: Entity; d: number }[] = [];
  for (const m of match.minions) {
    if (m.team === team) continue;
    const e = ctx.entities.get(m.entityId);
    if (!e || e.dead) continue;
    const d = dist2d(e.pos, pos);
    if (d <= radius) out.push({ e, d });
  }
  return out;
}

function updateBgStructures(ctx: SimContext, match: BgMatch): void {
  const origin = battlegroundOrigin(match.slot);
  for (const s of match.structures) {
    if (!s.alive) continue;
    const e = ctx.entities.get(s.entityId);
    if (!e || e.dead) continue;
    // Immune to movement: re-pin against knockbacks and any other shove.
    const ax = origin.x + s.def.x;
    const az = origin.z + s.def.z;
    if (e.pos.x !== ax || e.pos.z !== az) {
      e.pos = ctx.groundPos(ax, az);
      e.prevPos = { ...e.pos };
      ctx.rebucket(e);
    }
    // Immune to control: the templates live outside MOBS, so the applyAura
    // ccImmune lookup cannot cover them; strip any control aura that landed.
    if (e.auras.length > 0) {
      for (let i = e.auras.length - 1; i >= 0; i--) {
        const a = e.auras[i];
        if (!ctx.isControlAura(a.kind)) continue;
        e.auras.splice(i, 1);
        ctx.emit({ type: 'aura', targetId: e.id, name: a.name, gained: false });
      }
    }
    if (s.def.kind !== 'bulwark') continue;
    s.boltTimer -= DT;
    // Validate the current (possibly punished) target.
    let target: Entity | null = null;
    if (s.targetId !== null) {
      const t = ctx.entities.get(s.targetId);
      const tMatch = t ? ctx.bgMatches.get(t.id) : undefined;
      if (
        t &&
        !t.dead &&
        tMatch === match &&
        !isBgDown(match, t.id) &&
        bgTeamOf(match, t.id) !== s.def.team &&
        dist2d(t.pos, e.pos) <= BG_BULWARK_RANGE
      ) {
        target = t;
      } else {
        s.targetId = null;
      }
    }
    if (!target) {
      const minions = bgEnemyMinionsIn(ctx, match, s.def.team, e.pos, BG_BULWARK_RANGE);
      const players = bgEnemyFightersIn(ctx, match, s.def.team, e.pos, BG_BULWARK_RANGE);
      const picked = bgPickBulwarkTarget(
        false,
        null,
        minions.map((m) => ({ id: m.e.id, d: m.d })),
        players.map((p) => ({ id: p.e.id, d: p.d })),
      );
      if (picked !== null) {
        s.targetId = picked;
        target = ctx.entities.get(picked) ?? null;
      }
    }
    if (target && s.boltTimer <= 0) {
      s.boltTimer += BG_BULWARK_BOLT_EVERY;
      e.facing = angleTo(e.pos, target.pos);
      const dmg = match.rng.int(BG_BULWARK_BOLT_MIN, BG_BULWARK_BOLT_MAX);
      ctx.emit({
        type: 'spellfx',
        sourceId: e.id,
        targetId: target.id,
        school: 'arcane',
        fx: 'projectile',
      });
      ctx.dealDamage(e, target, dmg, false, 'arcane', null, 'hit');
    }
    if (!target && s.boltTimer < 0) s.boltTimer = 0; // never bank shots while idle
  }
}

// ---------------------------------------------------------------------------
// Minion waves + column drive
// ---------------------------------------------------------------------------

function bgLiveMinionCount(ctx: SimContext, match: BgMatch, team: BgTeam, lane: BgLane): number {
  let n = 0;
  for (const m of match.minions) {
    if (m.team !== team || m.lane !== lane) continue;
    const e = ctx.entities.get(m.entityId);
    if (e && !e.dead) n++;
  }
  return n;
}

function updateBgWaves(ctx: SimContext, match: BgMatch): void {
  match.waveTimer -= DT;
  if (match.waveTimer > 0) return;
  match.waveTimer += BG_WAVE_INTERVAL;
  match.waveCount++;
  const withSergeant = match.waveCount % BG_SERGEANT_EVERY === 0;
  for (const team of ['A', 'B'] as BgTeam[]) {
    const empowered = match.empoweredWaves[team] > 0;
    if (empowered) match.empoweredWaves[team]--;
    for (const lane of ['west', 'east'] as BgLane[]) {
      spawnBgColumn(ctx, match, team, lane, withSergeant, empowered);
    }
  }
}

function spawnBgColumn(
  ctx: SimContext,
  match: BgMatch,
  team: BgTeam,
  lane: BgLane,
  withSergeant: boolean,
  empowered: boolean,
): void {
  const roles: BgMinionRole[] = ['footman', 'footman', 'footman', 'arbalist'];
  if (withSergeant) roles.push('sergeant');
  const origin = battlegroundOrigin(match.slot);
  const muster = bgMinionMuster(team, lane);
  for (let i = 0; i < roles.length; i++) {
    if (bgLiveMinionCount(ctx, match, team, lane) >= BG_LANE_MINION_CAP) return;
    const role = roles[i];
    const off = {
      x: (i % 2) * 1.8 - 0.9,
      z: Math.floor(i / 2) * 1.8 * (team === 'A' ? -1 : 1),
    };
    const mob = spawnBgMob(
      ctx,
      match,
      BG_MINION_ROLES[role].templateId,
      { x: origin.x + muster.x + off.x, z: origin.z + muster.z + off.z },
      team,
    );
    if (empowered) {
      mob.maxHp = Math.round(mob.maxHp * BG_EMPOWER_MULT);
      mob.hp = mob.maxHp;
      mob.weapon = {
        ...mob.weapon,
        min: Math.round(mob.weapon.min * BG_EMPOWER_MULT),
        max: Math.round(mob.weapon.max * BG_EMPOWER_MULT),
      };
    }
    mob.facing = team === 'A' ? 0 : Math.PI;
    mob.prevFacing = mob.facing;
    match.minions.push({
      entityId: mob.id,
      team,
      lane,
      role,
      waypoint: 0,
      swingTimer: mob.weapon.speed,
      empowered,
    });
  }
}

function bgAcquireMinionTarget(
  ctx: SimContext,
  match: BgMatch,
  m: BgMinion,
  e: Entity,
): Entity | null {
  // Enemy minions first, then players, then (unshielded) structures.
  let best: Entity | null = null;
  let bestD = Infinity;
  for (const c of bgEnemyMinionsIn(ctx, match, m.team, e.pos, BG_MINION_AGGRO_RADIUS)) {
    if (c.d < bestD) {
      bestD = c.d;
      best = c.e;
    }
  }
  if (best) return best;
  for (const c of bgEnemyFightersIn(ctx, match, m.team, e.pos, BG_MINION_AGGRO_RADIUS)) {
    if (c.d < bestD) {
      bestD = c.d;
      best = c.e;
    }
  }
  if (best) return best;
  for (const s of match.structures) {
    if (!s.alive || s.def.team === m.team) continue;
    if (bgStructureShielded(match.structures, s.def)) continue;
    const se = ctx.entities.get(s.entityId);
    if (!se || se.dead) continue;
    const d = dist2d(se.pos, e.pos);
    if (d <= BG_MINION_AGGRO_RADIUS && d < bestD) {
      bestD = d;
      best = se;
    }
  }
  return best;
}

function updateBgMinions(ctx: SimContext, match: BgMatch): void {
  const origin = battlegroundOrigin(match.slot);
  // A minion's swing can kill another minion (splicing match.minions), so
  // iterate a snapshot and re-validate each entry.
  for (const m of [...match.minions]) {
    const e = ctx.entities.get(m.entityId);
    if (!e || e.dead) continue;
    if (m.swingTimer > 0) m.swingTimer -= DT;
    if (ctx.isStunned(e)) continue;
    const target = bgAcquireMinionTarget(ctx, match, m, e);
    if (target) {
      e.facing = angleTo(e.pos, target.pos);
      const range = BG_MINION_ROLES[m.role].attackRange;
      const d = dist2d(e.pos, target.pos);
      if (d > range) {
        if (!ctx.isRooted(e)) ctx.moveToward(e, target.pos, e.moveSpeed);
      } else if (m.swingTimer <= 0) {
        m.swingTimer = e.weapon.speed;
        if (m.role === 'arbalist') {
          ctx.emit({
            type: 'spellfx',
            sourceId: e.id,
            targetId: target.id,
            school: 'physical',
            fx: 'projectile',
          });
        }
        const dmg = match.rng.int(e.weapon.min, e.weapon.max);
        ctx.dealDamage(e, target, dmg, false, 'physical', null, 'hit');
      }
      continue;
    }
    // March the lane.
    const wps = bgLaneWaypoints(m.team, m.lane);
    if (m.waypoint >= wps.length) continue; // parked at the enemy warstone
    if (ctx.isRooted(e)) continue;
    const wp = wps[m.waypoint];
    const dest = ctx.groundPos(origin.x + wp.x, origin.z + wp.z);
    if (ctx.moveToward(e, dest, e.moveSpeed) || dist2d(e.pos, dest) < 1.5) m.waypoint++;
  }
}

// ---------------------------------------------------------------------------
// The Knell Warden
// ---------------------------------------------------------------------------

function spawnKnellWarden(ctx: SimContext, match: BgMatch): void {
  const origin = battlegroundOrigin(match.slot);
  const mob = spawnBgMob(
    ctx,
    match,
    'bg_knell_warden',
    { x: origin.x + BG_KNELL_POS.x, z: origin.z + BG_KNELL_POS.z },
    undefined, // neutral: hostile to both companies
  );
  match.knellEntityId = mob.id;
  match.knellSpawnIn = 0;
  match.knellSwingTimer = mob.weapon.speed;
}

function updateBgKnell(ctx: SimContext, match: BgMatch): void {
  if (match.knellEntityId === null) {
    match.knellSpawnIn -= DT;
    if (match.knellSpawnIn <= 0) spawnKnellWarden(ctx, match);
    return;
  }
  const e = ctx.entities.get(match.knellEntityId);
  if (!e || e.dead) return; // the fall is handled in bgMobKilled
  const origin = battlegroundOrigin(match.slot);
  const home = ctx.groundPos(origin.x + BG_KNELL_POS.x, origin.z + BG_KNELL_POS.z);
  // Chapel leash: pulled out, it drops everything, heals, and walks home.
  if (dist2d(e.pos, home) > BG_KNELL_LEASH) {
    clearThreat(e);
    e.targetId = null;
    e.hp = e.maxHp;
    ctx.moveToward(e, home, e.moveSpeed * 1.4, true);
    return;
  }
  if (match.knellSwingTimer > 0) match.knellSwingTimer -= DT;
  if (ctx.isStunned(e)) return;
  // Fight back at its attackers: highest hate-table entry still near the
  // chapel (entries that ran beyond the leash are dropped, not chased).
  let target: Entity | null = null;
  let bestThreat = -Infinity;
  for (const [id, threat] of e.threat) {
    const t = ctx.entities.get(id);
    if (!t || t.dead) {
      e.threat.delete(id);
      continue;
    }
    const controller = ctx.pvpController(t);
    if (!controller || ctx.bgMatches.get(controller.id) !== match) continue;
    if (isBgDown(match, controller.id)) continue;
    if (dist2d(t.pos, home) > BG_KNELL_LEASH + BG_KNELL_TARGET_SLACK) {
      e.threat.delete(id);
      continue;
    }
    if (threat > bestThreat) {
      bestThreat = threat;
      target = t;
    }
  }
  if (!target) {
    e.targetId = null;
    if (dist2d(e.pos, home) > 1) ctx.moveToward(e, home, e.moveSpeed);
    return;
  }
  e.targetId = target.id;
  e.facing = angleTo(e.pos, target.pos);
  const d = dist2d(e.pos, target.pos);
  if (d > 2.6) {
    if (!ctx.isRooted(e)) ctx.moveToward(e, target.pos, e.moveSpeed);
  } else if (match.knellSwingTimer <= 0) {
    match.knellSwingTimer = e.weapon.speed;
    const dmg = match.rng.int(e.weapon.min, e.weapon.max);
    ctx.dealDamage(e, target, dmg, false, 'physical', null, 'hit');
  }
}

// ---------------------------------------------------------------------------
// Bench respawn (fiesta pattern: nobody truly dies on the Gravemarch)
// ---------------------------------------------------------------------------

export function bgRespawnTime(deaths: number, elapsed: number): number {
  const t =
    BG_RESPAWN_BASE +
    (deaths - 1) * BG_RESPAWN_PER_DEATH +
    Math.floor(elapsed / 60) * BG_RESPAWN_PER_MINUTE;
  return Math.min(BG_RESPAWN_MAX, t);
}

function emitToFighters(ctx: SimContext, match: BgMatch, build: (pid: number) => SimEvent): void {
  for (const pid of bgAllPids(match)) {
    if (match.deserted.has(pid) || !ctx.entities.has(pid)) continue;
    ctx.emit(build(pid));
  }
}

// Note the damage for kill credit and apply the Bulwark punish rule: an enemy
// player who damages an allied PLAYER inside a bulwark's range is instantly
// retargeted. Called from the dealDamage battleground arm on every cross-team
// player hit.
export function bgNotePlayerDamage(
  ctx: SimContext,
  match: BgMatch,
  victim: Entity,
  attackerPlayer: Entity,
): void {
  match.lastHitBy.set(victim.id, { pid: attackerPlayer.id, at: match.timer });
  const victimTeam = bgTeamOf(match, victim.id);
  if (!victimTeam) return;
  for (const s of match.structures) {
    if (!s.alive || s.def.kind !== 'bulwark' || s.def.team !== victimTeam) continue;
    const se = ctx.entities.get(s.entityId);
    if (!se || se.dead) continue;
    if (dist2d(attackerPlayer.pos, se.pos) <= BG_BULWARK_RANGE) s.targetId = attackerPlayer.id;
  }
}

// A fighter hit 0 hp: bench them (never a real death), credit the killer, and
// start the growing respawn countdown. Called from the dealDamage arm.
export function bgPlayerDown(
  ctx: SimContext,
  match: BgMatch,
  victim: Entity,
  source: Entity | null,
): void {
  if (match.down.has(victim.id)) return;
  const victimTeam = bgTeamOf(match, victim.id);
  if (!victimTeam) return;
  // Killer: the damaging player; else the last enemy player to hit within the
  // credit window (a minion/tower landed the blow); else no player credit.
  let killerPid: number | null = null;
  const sourcePlayer = ctx.pvpController(source);
  if (sourcePlayer && bgTeamOf(match, sourcePlayer.id) === otherTeam(victimTeam)) {
    killerPid = sourcePlayer.id;
  } else {
    const last = match.lastHitBy.get(victim.id);
    if (
      last &&
      match.timer - last.at <= BG_KILL_CREDIT_WINDOW &&
      bgTeamOf(match, last.pid) === otherTeam(victimTeam) &&
      ctx.entities.has(last.pid)
    ) {
      killerPid = last.pid;
    }
  }
  const killerEntity = killerPid !== null ? (ctx.entities.get(killerPid) ?? null) : source;
  const killerTeam: BgTeam =
    killerPid !== null ? bgTeamOf(match, killerPid)! : (source?.bgTeam ?? otherTeam(victimTeam));
  if (killerTeam === 'A') match.killsA++;
  else match.killsB++;
  if (killerPid !== null) match.kills.set(killerPid, (match.kills.get(killerPid) ?? 0) + 1);
  const deaths = (match.deaths.get(victim.id) ?? 0) + 1;
  match.deaths.set(victim.id, deaths);
  fiestaDownEntity(ctx, victim, killerEntity);
  const respawnIn = bgRespawnTime(deaths, match.timer);
  match.down.set(victim.id, respawnIn);
  ctx.emit({ type: 'bgDown', seconds: Math.ceil(respawnIn), pid: victim.id });
  const killerName =
    killerPid !== null ? (ctx.players.get(killerPid)?.name ?? '?') : (source?.name ?? '?');
  const victimName = ctx.players.get(victim.id)?.name ?? '?';
  for (const pid of bgAllPids(match)) {
    if (match.deserted.has(pid) || !ctx.entities.has(pid)) continue;
    ctx.emit({
      type: 'bgKill',
      killerName,
      victimName,
      killerTeam,
      killsA: match.killsA,
      killsB: match.killsB,
      mine: pid === killerPid,
      pid,
    });
  }
}

function updateBgRespawns(ctx: SimContext, match: BgMatch): void {
  for (const [pid, t] of [...match.down]) {
    const e = ctx.entities.get(pid);
    if (!e) {
      match.down.delete(pid);
      continue;
    }
    const nt = t - DT;
    if (nt <= 0) bgRevive(ctx, match, e);
    else match.down.set(pid, nt);
  }
}

function bgRevive(ctx: SimContext, match: BgMatch, e: Entity): void {
  match.down.delete(e.id);
  const team = bgTeamOf(match, e.id);
  if (!team) return;
  const origin = battlegroundOrigin(match.slot);
  const spawns = bgSpawns(team);
  const teamPids = team === 'A' ? match.teamA : match.teamB;
  const idx = Math.max(0, teamPids.indexOf(e.id));
  arenaMod.placeInArena(ctx, e, origin, spawns[idx] ?? spawns[0]);
  ctx.readyArenaFighter(e, { clearPrep: true });
  ctx.emit({ type: 'respawn', pid: e.id });
}

// ---------------------------------------------------------------------------
// Battleground mob deaths (minions / structures / the Warden). Routed here by
// the dealDamage arm INSTEAD of handleDeath: no xp, no loot, no wild respawn.
// ---------------------------------------------------------------------------

export function bgMobKilled(ctx: SimContext, mob: Entity, source: Entity | null): void {
  const match = bgMatchById(ctx, mob.bgMatchId);
  mob.dead = true;
  mob.hp = 0;
  mob.aiState = 'dead';
  mob.aggroTargetId = null;
  mob.targetId = null;
  clearThreat(mob);
  ctx.emit({ type: 'death', entityId: mob.id, killerId: source?.id ?? -1 });
  // The dead drop off every hate table (mirrors handleDeath's shared sweep).
  for (const m of ctx.entities.values()) {
    if (m.kind !== 'mob' || m.id === mob.id) continue;
    m.threat.delete(mob.id);
    if (m.forcedTargetId === mob.id) {
      m.forcedTargetId = null;
      m.forcedTargetTimer = 0;
    }
  }
  if (!match) return;
  match.corpses.push({ entityId: mob.id, at: ctx.time + BG_CORPSE_LINGER });
  const killerPlayer = ctx.pvpController(source);
  const killerTeam: BgTeam | null = killerPlayer
    ? ctx.bgMatches.get(killerPlayer.id) === match
      ? bgTeamOf(match, killerPlayer.id)
      : null
    : (source?.bgTeam ?? null);
  const minionIdx = match.minions.findIndex((m) => m.entityId === mob.id);
  if (minionIdx >= 0) {
    match.minions.splice(minionIdx, 1);
    return;
  }
  if (mob.id === match.knellEntityId) {
    match.knellEntityId = null;
    match.knellSpawnIn = BG_KNELL_RESPAWN;
    if (killerTeam) {
      match.knellSilencedBy = killerTeam;
      match.knellSilencedUntil = match.timer + BG_KNELL_SILENCE_DURATION;
      match.empoweredWaves[killerTeam] = BG_KNELL_EMPOWERED_WAVES;
      emitToFighters(ctx, match, (pid) => ({ type: 'bgKnell', team: killerTeam, pid }));
    }
    return;
  }
  const s = match.structures.find((st) => st.entityId === mob.id);
  if (!s) return;
  s.alive = false;
  const byTeam = killerTeam ?? otherTeam(s.def.team);
  emitToFighters(ctx, match, (pid) => ({
    type: 'bgStructure',
    structureId: s.def.id,
    team: s.def.team,
    kind: s.def.kind,
    byTeam,
    pid,
  }));
  if (s.def.kind === 'warstone' && match.state === 'active') {
    endBgMatch(ctx, match, otherTeam(s.def.team), 'defeat');
  }
}

// Structure damage gate, called from the dealDamage arm BEFORE hp changes:
// shielded structures (and structures of inactive matches) soak to zero, the
// Knell-silence player bonus and the empowered-minion structure bonus are
// applied, and warstone damage warns the owning team (throttled).
export function bgAdjustStructureDamage(
  ctx: SimContext,
  target: Entity,
  source: Entity | null,
  amount: number,
): number {
  const match = bgMatchById(ctx, target.bgMatchId);
  if (!match) return 0;
  const s = match.structures.find((st) => st.entityId === target.id);
  if (!s) return amount; // a minion or the Warden: no structure rules apply
  if (match.state !== 'active' || !s.alive) return 0;
  if (bgStructureShielded(match.structures, s.def)) return 0;
  let out = amount;
  const sourcePlayer = ctx.pvpController(source);
  if (
    sourcePlayer &&
    match.knellSilencedBy &&
    match.timer < match.knellSilencedUntil &&
    ctx.bgMatches.get(sourcePlayer.id) === match &&
    bgTeamOf(match, sourcePlayer.id) === match.knellSilencedBy
  ) {
    out = Math.round(out * BG_SILENCE_STRUCTURE_DMG_MULT);
  }
  if (source && source.bgMatchId === match.id) {
    const ms = match.minions.find((m) => m.entityId === source.id);
    if (ms?.empowered) out = Math.round(out * BG_EMPOWER_MULT);
  }
  if (s.def.kind === 'warstone' && out > 0) {
    const team = s.def.team;
    if (match.timer - match.warstoneThreatAt[team] >= BG_WARSTONE_THREAT_THROTTLE) {
      match.warstoneThreatAt[team] = match.timer;
      for (const pid of team === 'A' ? match.teamA : match.teamB) {
        if (match.deserted.has(pid) || !ctx.entities.has(pid)) continue;
        ctx.emit({ type: 'bgWarstoneThreat', pid });
      }
    }
  }
  return out;
}

function updateBgCorpses(ctx: SimContext, match: BgMatch): void {
  for (let i = match.corpses.length - 1; i >= 0; i--) {
    if (ctx.time >= match.corpses[i].at) {
      ctx.dropEntity(match.corpses[i].entityId);
      match.corpses.splice(i, 1);
    }
  }
}

// ---------------------------------------------------------------------------
// Win / end / return
// ---------------------------------------------------------------------------

/** Timeout ladder, pure for unit tests: more enemy structures destroyed wins;
 *  then the higher own-structure total hp fraction; within epsilon = draw. */
export function bgTimeoutWinner(
  structures: readonly { team: BgTeam; alive: boolean; hpFrac: number }[],
  epsilon = BG_TIMEOUT_DRAW_EPSILON,
): BgTeam | null {
  const destroyedByA = structures.filter((s) => s.team === 'B' && !s.alive).length;
  const destroyedByB = structures.filter((s) => s.team === 'A' && !s.alive).length;
  if (destroyedByA !== destroyedByB) return destroyedByA > destroyedByB ? 'A' : 'B';
  const frac = (team: BgTeam) => {
    const own = structures.filter((s) => s.team === team);
    if (own.length === 0) return 0;
    let sum = 0;
    for (const s of own) sum += s.alive ? s.hpFrac : 0;
    return sum / own.length;
  };
  const fa = frac('A');
  const fb = frac('B');
  if (Math.abs(fa - fb) < epsilon) return null;
  return fa > fb ? 'A' : 'B';
}

function bgTimeoutWinnerFor(ctx: SimContext, match: BgMatch): BgTeam | null {
  return bgTimeoutWinner(
    match.structures.map((s) => {
      const e = ctx.entities.get(s.entityId);
      const hpFrac = s.alive && e && e.maxHp > 0 ? e.hp / e.maxHp : 0;
      return { team: s.def.team, alive: s.alive, hpFrac };
    }),
  );
}

export function endBgMatch(
  ctx: SimContext,
  match: BgMatch,
  winner: BgTeam | null,
  reason: 'defeat' | 'timeout' | 'forfeit',
): void {
  if (match.winner !== undefined) return; // already decided
  match.winner = winner;
  match.endReason = reason;
  const ranked = match.rated;
  let deltaA: number;
  if (!ranked) deltaA = 0;
  else if (winner === null) deltaA = eloDelta(match.ratingA, match.ratingB, 0.5);
  else if (winner === 'A') deltaA = eloDelta(match.ratingA, match.ratingB, 1);
  else deltaA = -eloDelta(match.ratingB, match.ratingA, 1);

  const scoreTeam = (team: BgTeam, delta: number, won: boolean | null) => {
    for (const pid of team === 'A' ? match.teamA : match.teamB) {
      if (match.deserted.has(pid)) continue; // deserters already took their loss
      const meta = ctx.players.get(pid);
      if (!meta) continue;
      let ratingBefore: number;
      let ratingAfter: number;
      if (ranked) {
        ({ before: ratingBefore, after: ratingAfter } = addBgResult(meta, delta, won));
      } else {
        ratingBefore = ratingAfter = bgStanding(meta).rating;
      }
      ctx.emit({
        type: 'bgEnd',
        won: won === true,
        draw: winner === null,
        rated: ranked,
        killsA: match.killsA,
        killsB: match.killsB,
        ratingBefore,
        ratingAfter,
        pid,
      });
    }
  };
  scoreTeam('A', deltaA, winner === null ? null : winner === 'A');
  scoreTeam('B', -deltaA, winner === null ? null : winner === 'B');

  // Nobody truly dies on the Gravemarch: everyone stands for the aftermath.
  for (const pid of bgAllPids(match)) {
    if (match.deserted.has(pid)) continue;
    const e = ctx.entities.get(pid);
    if (e) ctx.readyArenaFighter(e, { clearPrep: true });
  }
  match.down.clear();

  if (reason === 'forfeit') {
    returnFromBgMatch(ctx, match);
    return;
  }
  match.state = 'over';
  match.timer = BG_RETURN_DELAY;
}

export function returnFromBgMatch(ctx: SimContext, match: BgMatch): void {
  for (const pid of bgAllPids(match)) ctx.bgMatches.delete(pid);
  ctx.bgBusySlots.delete(match.slot);
  // Despawn every battleground entity of this match.
  for (const s of match.structures) {
    if (ctx.entities.has(s.entityId)) ctx.dropEntity(s.entityId);
  }
  for (const m of match.minions) {
    if (ctx.entities.has(m.entityId)) ctx.dropEntity(m.entityId);
  }
  for (const c of match.corpses) {
    if (ctx.entities.has(c.entityId)) ctx.dropEntity(c.entityId);
  }
  if (match.knellEntityId !== null && ctx.entities.has(match.knellEntityId)) {
    ctx.dropEntity(match.knellEntityId);
  }
  match.minions = [];
  match.corpses = [];
  match.knellEntityId = null;
  // Undo the level-20 standardization BEFORE the reset recomputes real stats
  // (the arena returnFromArena ordering), then send everyone home.
  for (const pid of bgAllPids(match)) {
    const e = ctx.entities.get(pid);
    const ret = match.returns.get(pid);
    if (!e || !ret) continue;
    const meta = ctx.players.get(pid);
    if (meta) ctx.fiestaRestoreChar(meta, e);
    ctx.resetForArena(e);
    e.pos = ctx.groundPos(ret.x, ret.z);
    e.prevPos = { ...e.pos };
    e.facing = ret.facing;
    e.dead = false;
    ctx.rebucket(e);
    ctx.emit({ type: 'respawn', pid: e.id });
  }
}

// Mid-match removal (disconnect / logout): the fighter is benched permanently,
// takes the loss delta on a rated match (which then plays on unrated), and
// rings the Deserter's Knell. Called from Sim.removePlayer while the leaver's
// meta/entity still exist.
export function bgHandleDesertion(ctx: SimContext, match: BgMatch, pid: number): void {
  ctx.bgMatches.delete(pid);
  if (match.winner !== undefined || match.state === 'over') return; // already decided
  if (match.deserted.has(pid)) return;
  match.deserted.add(pid);
  match.down.delete(pid);
  const meta = ctx.players.get(pid);
  if (meta && !meta.isBgBot) {
    ctx.bgDeserters.set(meta.name.toLowerCase(), ctx.time + BG_DESERTER_LOCKOUT);
    if (match.rated) {
      const myTeam = bgTeamOf(match, pid);
      const lossDelta =
        myTeam === 'A'
          ? -eloDelta(match.ratingB, match.ratingA, 1)
          : -eloDelta(match.ratingA, match.ratingB, 1);
      addBgResult(meta, lossDelta, false);
      match.rated = false; // the short-handed match plays on unrated
    }
  }
}

// ---------------------------------------------------------------------------
// Server helpers + the BgInfo presentation read (IWorldBattleground facet)
// ---------------------------------------------------------------------------

export function bgLiveMatchIds(ctx: SimContext): number[] {
  return uniqueBgMatches(ctx)
    .filter((m) => m.state !== 'over')
    .map((m) => m.id);
}

/** Connected fighters of a match, team A first (server snapshot anchoring). */
export function bgMatchPids(ctx: SimContext, matchId: number): number[] {
  const match = bgMatchById(ctx, matchId);
  if (!match) return [];
  return bgAllPids(match).filter((pid) => !match.deserted.has(pid) && ctx.entities.has(pid));
}

export function bgLadder(ctx: SimContext): BgLadderEntry[] {
  const rows: BgLadderEntry[] = [];
  for (const meta of ctx.players.values()) {
    if (!ctx.entities.has(meta.entityId)) continue;
    if (meta.isBgBot) continue;
    const standing = bgStanding(meta);
    if (standing.wins + standing.losses === 0) continue; // rated players only
    rows.push({
      pid: meta.entityId,
      name: meta.name,
      cls: meta.cls,
      rating: standing.rating,
      wins: standing.wins,
      losses: standing.losses,
    });
  }
  rows.sort((x, y) => y.rating - x.rating || y.wins - x.wins);
  return rows.slice(0, BG_LADDER_SIZE);
}

function bgLiveMatchViews(ctx: SimContext): BgLiveMatch[] {
  return uniqueBgMatches(ctx)
    .filter((m) => m.state !== 'over')
    .map((m) => ({
      id: m.id,
      elapsed: m.state === 'active' ? Math.floor(m.timer) : 0,
      killsA: m.killsA,
      killsB: m.killsB,
      structuresDownA: m.structures.filter((s) => s.def.team === 'A' && !s.alive).length,
      structuresDownB: m.structures.filter((s) => s.def.team === 'B' && !s.alive).length,
      players: bgAllPids(m).filter(
        (pid) => !m.deserted.has(pid) && !m.botPids.has(pid) && ctx.entities.has(pid),
      ).length,
    }));
}

function bgMatchInfoFor(ctx: SimContext, match: BgMatch, pid: number): BgMatchInfo | null {
  const myTeam = bgTeamOf(match, pid);
  if (!myTeam) return null;
  const origin = battlegroundOrigin(match.slot);
  const structures: BgStructureView[] = match.structures.map((s) => {
    const e = ctx.entities.get(s.entityId);
    return {
      id: s.def.id,
      team: s.def.team,
      kind: s.def.kind,
      lane: s.def.lane,
      tier: s.def.tier,
      x: origin.x + s.def.x,
      z: origin.z + s.def.z,
      hpFrac: s.alive && e && e.maxHp > 0 ? e.hp / e.maxHp : 0,
      alive: s.alive,
      shielded: s.alive && bgStructureShielded(match.structures, s.def),
    };
  });
  const roster = (pids: number[]): BgScoreboardPlayer[] =>
    pids.map((p) => {
      const m = ctx.players.get(p);
      return {
        pid: p,
        name: m?.name ?? '?',
        cls: m?.cls ?? 'warrior',
        kills: match.kills.get(p) ?? 0,
        deaths: match.deaths.get(p) ?? 0,
        down: isBgDown(match, p),
        respawnIn: Math.ceil(match.down.get(p) ?? 0),
        me: p === pid,
        bot: match.botPids.has(p) || ctx.players.get(p)?.isBgBot === true,
      };
    });
  const allies: BgAllyPosition[] = [];
  for (const p of myTeam === 'A' ? match.teamA : match.teamB) {
    if (p === pid || match.deserted.has(p)) continue;
    const e = ctx.entities.get(p);
    if (!e) continue;
    allies.push({ pid: p, x: e.pos.x, z: e.pos.z });
  }
  return {
    id: match.id,
    state: match.state,
    countdown: match.state === 'countdown' ? Math.max(0, Math.ceil(match.timer)) : 0,
    timeLeft:
      match.state === 'active'
        ? Math.max(0, Math.ceil(BG_MAX_DURATION - match.timer))
        : match.state === 'countdown'
          ? BG_MAX_DURATION
          : 0,
    team: myTeam,
    killsA: match.killsA,
    killsB: match.killsB,
    structures,
    knell: {
      alive: match.knellEntityId !== null,
      spawnsIn: match.knellEntityId !== null ? 0 : Math.max(0, Math.ceil(match.knellSpawnIn)),
      x: origin.x + BG_KNELL_POS.x,
      z: origin.z + BG_KNELL_POS.z,
    },
    knellSilencedBy: match.knellSilencedBy,
    knellSilencedFor: match.knellSilencedBy
      ? Math.max(0, Math.ceil(match.knellSilencedUntil - match.timer))
      : 0,
    teamA: roster(match.teamA),
    teamB: roster(match.teamB),
    down: isBgDown(match, pid),
    respawnIn: Math.ceil(match.down.get(pid) ?? 0),
    allies,
    origin: { x: origin.x, z: origin.z },
    rated: match.rated,
    ...(match.state === 'over'
      ? {
          returnIn: Math.max(0, Math.ceil(match.timer)),
          outcome:
            match.winner === null
              ? ('draw' as const)
              : match.winner === myTeam
                ? ('win' as const)
                : ('loss' as const),
        }
      : {}),
  };
}

export function bgInfoFor(ctx: SimContext, pid: number): BgInfo | null {
  const meta = ctx.players.get(pid);
  if (!meta) return null;
  const match = ctx.bgMatches.get(pid) ?? null;
  const unit = ctx.bgQueue.find((u) => u.pids.includes(pid)) ?? null;
  return {
    standing: bgStanding(meta),
    queued: unit !== null,
    queueSize: bgQueueSize(ctx),
    position: unit ? bgQueuePosition(ctx, pid) : 0,
    waitSec: unit ? Math.max(0, Math.floor(ctx.time - unit.queuedAt)) : 0,
    deserterFor: Math.ceil(bgDeserterFor(ctx, meta.name)),
    match: match ? bgMatchInfoFor(ctx, match, pid) : null,
    liveMatches: bgLiveMatchViews(ctx),
    ladder: bgLadder(ctx),
    spectating: null, // offline worlds never spectate; the online mirror overrides
  };
}
