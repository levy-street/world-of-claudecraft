// The Vale Cup: boarball at the Sowfield (docs/prd/vale-cup.md), a SimContext
// system module in the arena.ts/fiesta.ts mold. Owns the per-bracket queues,
// the ONE physical match slot, the match lifecycle (countdown / active / goal /
// golden / over), the sport-kit swap, the ball driver (pure math in
// src/sim/vale_cup_ball.ts over the src/sim/vale_cup_layout.ts walls), goals,
// the keeper's grip, pitch policing, desertion, and the CupInfo presentation.
//
// State stays on Sim as ONE holder object (`Sim.vcup`, a live `ctx.vcup` view):
// queues/deserters/botPids are mutated in place and the match slot is
// reassigned INSIDE the holder, so the seam needs no setter. Bots (practice +
// backfill) live in the sibling vale_cup_bots.ts because they need Sim-only
// affordances (addPlayer/removePlayer), the fiesta_bots precedent.
//
// Determinism: ZERO rng draws anywhere in this module (professions precedent);
// ball physics, matchmaking, bot heuristics, and every timer are pure functions
// of sim state, so the tick-path parity goldens are untouched. Match-theatre
// events carry a world x/z anchor at the pitch so walk-up spectators in the
// stands see the banners too.

import type {
  CupInfo,
  VcBetInfo,
  VcLiveMatch,
  VcMatchInfo,
  VcPhase,
  VcRosterPlayer,
} from '../../world_api/vale_cup';
import { isStunned } from '../combat/cc';
import {
  resolveSportKit,
  SPORT_ROLES,
  VALE_CUP_BALL_TEMPLATE_ID,
  vcNation,
} from '../content/vale_cup';
import { abilitiesKnownAt, DUNGEON_X_THRESHOLD, MOBS, NPCS } from '../data';
import { createMob, createNpc, recalcPlayerStats } from '../entity';
import { restorePetFromDelveStash, stowPetForDelve } from '../pet/pet_commands';
import type { PlayerMeta } from '../sim';
import type { SimContext } from '../sim_context';
import {
  DT,
  dist2d,
  type Entity,
  MELEE_RANGE,
  type SportRole,
  type VcBracket,
  type VcNationId,
} from '../types';
import {
  applyBodyTrap,
  applyDribbleNudge,
  launchBall,
  settleBallInPocket,
  stepBallPhysics,
  VC_BALL_RADIUS,
  type VcBallKinematics,
} from '../vale_cup_ball';
import {
  GOAL_BOX_DEPTH,
  GOAL_BOX_HALF_W,
  GOAL_HALF_W,
  GOAL_LINE_EAST_X,
  GOAL_LINE_WEST_X,
  GOAL_Z_MAX,
  GOAL_Z_MIN,
  isAtSowfield,
  isOnPitch,
  PITCH,
  PITCH_CENTER,
  VC_PRACTICE_SLOTS,
  VC_SPAWNS_A,
  VC_SPAWNS_B,
  vcPracticeOrigin,
} from '../vale_cup_layout';
import { arenaCombatants } from './arena';

// ---------------------------------------------------------------------------
// Tuning constants (fiesta style: all at the top).
// ---------------------------------------------------------------------------
export const VC_BRIEFING_DURATION = 30; // s of pre-match briefing before auto-ready
export const VC_COUNTDOWN = 3; // s of whistle before kickoff
// Parimutuel spectator betting (open during 'briefing').
export const VC_BET_MIN = 1; // copper: smallest accepted wager
export const VC_BET_MAX = 1_000_000; // copper (100g): a sane per-player cap
export const VC_MATCH_DURATION = 360; // s single period
export const VC_GOAL_CELEBRATE = 4; // s of celebrate + pocket settle per goal
export const VC_GOLDEN_CAP = 120; // s of golden goal before it is a draw
export const VC_OVER_DELAY = 8; // s of aftermath before going home
export const VC_SCORE_CAP = 5; // first to this many ends early
export const VC_DESERTER_LOCKOUT = 300; // s the Groundskeeper remembers
export const VC_BACKFILL_WAIT = 60; // s a human unit waits before bots fill in
export const VC_GRIP_RADIUS = 2.2; // yd a keeper's grip reaches inside the box
export const VC_GRIP_HOLD = 1.5; // s the ball sticks before it drops
export const VC_GRIP_MIN_BALL_SPEED = 2; // grip only catches a MOVING ball
export const VC_SAVE_SHOT_SPEED = 12; // yd/s toward goal that counts as a save
export const VC_HOLD_CARRY_DIST = 1.4; // yd the held ball rides in front
export const VC_DIVE_CATCH_RADIUS = 1.6; // yd a dive's crossing-ball catch reaches
export const VC_DRIBBLE_RADIUS = 1.3; // + body radius, player-to-ball contact
export const VC_KICKOFF_TAKER_GAP = 1.6; // yd the kickoff taker stands from the ball
// The whistle grace: for a beat after every kickoff the ball only accepts the
// short Kick's profile (long boots are clamped down to it), so an instant
// unchallenged Big Boot from the center spot cannot be the first touch.
export const VC_KICKOFF_GRACE = 0.7; // s after each kickoff
export const VC_GRACE_KICK_POWER = 16; // the sport_kick ground speed
export const VC_GRACE_KICK_LOFT = 3; // the sport_kick loft
// Touch: a kick's power scales with how far the aim point is, so a short pass
// is a soft roll and only a full-length aim gets the ability's top power. The
// fraction never drops below the floor (every kick still travels a meaningful
// touch), and it is 1 once the aim is at or beyond the ability's reach.
export const VC_KICK_MIN_FRAC = 0.42; // shortest kick is this fraction of full power
// Keepers line up ON their goal line at every kickoff (they never take the
// kickoff), so a center-spot shot arrives at a set keeper, not an open net.
export const VC_KEEPER_LINE_DEPTH = 1.2; // yd inside the goal line
// The defending team keeps out of the center circle at kickoff, so the taker
// gets first touch instead of an adjacent opponent stealing it on the whistle.
export const VC_KICKOFF_CIRCLE = 5; // yd
// Body control (finding: the ball sailed straight through fighters): a kicker
// cannot re-trap their OWN kick for a grace beat, or kicking from the feet
// would be impossible; everyone else (either team) traps it immediately.
export const VC_TRAP_KICK_GRACE = 0.4; // s the kicker is exempt from their own kick
const VC_PLAYER_BODY_RADIUS = 0.5; // mirrors pathfind PLAYER_BODY_RADIUS
// You may only STRIKE the loose ball (kick / pass / shoot) when it is genuinely
// at your feet, never merely within the ability's aim range (18 to 42 yd), which
// let a player launch the ball from anywhere on the pitch. This covers the
// dribble/trap contact (VC_DRIBBLE_RADIUS + body), a dribbled ball riding a
// stride ahead (its carry runs ~1.15x the dribbler's speed), and the bots'
// swing reach (BOT_KICK_REACH in vale_cup_bots.ts, which MUST stay <= this so a
// bot that commits to a kick actually connects). A keeper HOLDING the ball is
// always exempt.
export const VC_POSSESSION_RADIUS = 4; // yd from the ball you can play it
const VC_DRIBBLE_MAX_BALL_HEIGHT = 1.2; // a ball overhead cannot be dribbled
const VC_TRAP_MAX_BALL_HEIGHT = 1.8; // higher flight (the punt's arc) clears heads
// Passing (sport_pass): auto-paced so it arrives at a controllable weight. Power
// scales with the gap to the receiver plus a base touch, capped by the ability,
// and the aim leads the receiver's run by a few ticks of their own velocity so a
// pass into space meets a runner instead of trailing them.
export const VC_PASS_BASE_POWER = 6; // yd/s floor so a 1-yd give-and-go still moves
export const VC_PASS_PACE = 1.15; // extra yd/s of pace per yd of gap to the receiver
export const VC_PASS_LEAD_TICKS = 6; // ticks of receiver velocity the aim leads by
export const VC_PASS_MAX_RANGE = 42; // yd a contextual (untargeted) pass will seek a mate
// Contextual receiver pick when no valid teammate is TARGETED: the teammate whose
// bearing from the passer best matches the aim, inside this cone and range.
export const VC_PASS_CONE_DOT = 0.35; // min cos(angle) between aim and bearing to a mate
// Shoot (sport_shoot): the client encodes held charge as the aim distance; power
// and loft both scale with the charge fraction, so a maxed shot balloons over the
// bar. A tap still fires a real shot (the floor), never a dribble.
export const VC_SHOOT_MIN_FRAC = 0.35; // shortest charge fires this fraction of full power
export const VC_SHOOT_CORNER_BIAS = 1.4; // how hard facing steers the shot toward a post

export const VC_BRACKETS: readonly VcBracket[] = [1, 2, 3, 4, 5];

// Groundskeeper Bram's RESERVED entity id. He is spawned at world init OUTSIDE
// the nextId sequence: the parity goldens pin `nextId` (and every player pid)
// per frame, so allocating him normally would shift every ctor-spawned id and
// red all 48 goldens. nextId grows by roughly one per mob respawn; reaching
// 1e9 would take decades of continuous uptime, so a collision is unrealizable.
export const VALE_CUP_BRAM_ID = 1_000_000_000;

// ---------------------------------------------------------------------------
// State (lives on Sim as `Sim.vcup`, reached as the live `ctx.vcup` view).
// ---------------------------------------------------------------------------

export interface VcQueueUnit {
  pids: number[]; // 1..bracket size, party order (leader first)
  nation: VcNationId;
  roles: Record<number, SportRole>;
  joinedAtTick: number; // sim tick the unit queued (drives bot backfill)
  // Members entering UNDER their guild banner: pid -> the guild name recorded at
  // queue time (only for members whose captain opted in and who are in a guild).
  // A member is credited on the guild board only if they are STILL in this guild
  // when the match resolves (checked against the live entity), so a name here is
  // an intent, never a guarantee of credit.
  guilds: Record<number, string>;
}

// One side of a match as the matchmaker/backfill/practice hand it over.
export interface VcSide {
  pids: number[];
  nation: VcNationId;
  roles: Record<number, SportRole>;
  guilds?: Record<number, string>; // pid -> represented guild (queue entry only)
}

export interface VcCombatant {
  pid: number;
  name: string;
  role: SportRole;
  bot: boolean;
}

export interface VcBallState extends VcBallKinematics {
  entityId: number;
  holderPid: number | null; // keeper gripping the ball, if any
  holdUntil: number; // sim.time the grip lets go
  lastKickPid: number | null;
  lastKickTeam: 'A' | 'B' | null;
  lastKickAt: number; // sim.time of the last kick (scorer credit window)
  lastTouchPid: number | null;
  lastTouchTeam: 'A' | 'B' | null;
}

export interface VcMatch {
  id: number;
  bracket: VcBracket;
  phase: VcPhase;
  timer: number; // countdown remaining / celebrate remaining / return countdown
  clock: number; // elapsed ACTIVE play (s); pauses during 'goal'
  goldenClock: number; // elapsed golden-goal play (s)
  golden: boolean; // regulation ended level; next goal wins
  scoreA: number;
  scoreB: number;
  nationA: VcNationId;
  nationB: VcNationId;
  awayPalette: boolean; // both sides picked the same banner; B plays inverted
  teamA: number[]; // team A defends the WEST goal
  teamB: number[];
  rosterA: VcCombatant[]; // snapshot at start so leavers keep a team sheet
  rosterB: VcCombatant[];
  roles: Record<number, SportRole>;
  rated: boolean; // false whenever bots are seated: no standing changes
  ready: Set<number>; // fighters who readied up in the briefing (bots pre-added)
  briefingTimer: number; // s of briefing left before auto-ready ('briefing' only)
  benched: Set<number>; // deserters/vanished fighters; team plays short
  resolved: Set<number>; // standing already applied (desertion loss, end result)
  kickoffTeam: 'A' | 'B';
  kickoffGraceUntil: number; // sim.time the whistle grace ends (long boots clamp)
  returns: Map<number, { x: number; z: number; facing: number }>;
  ball: VcBallState | null; // spawned at kickoff, despawned at match end
  pocket: 'west' | 'east' | null; // which net the celebrating ball settles in
  pendingWinner: 'A' | 'B' | null | undefined; // decided during 'goal' celebrate
  ended: boolean; // result scored; phase is 'over'
  bets: VcBetPool; // parimutuel spectator wagers (open during 'briefing')
  // Fighters who entered under a guild banner: pid -> the guild name at seat
  // time. On a rated result each still-in-guild member credits their guild's
  // Vale Cup W/L (see applyStanding). Empty for practice/backfill/showcase.
  guildEntry: Map<number, string>;
  // World-space offset added to the Sowfield-frame pitch geometry. {0,0} for the
  // one real match at the Sowfield; a far practice-instance origin for a private
  // practice match (see vcPracticeOrigin). Every geometry read adds this.
  origin: { x: number; z: number };
  // Practice-instance bookkeeping (null for the real match): the practicing
  // player's pid and which instance slot (origin band) this match occupies.
  practice: { ownerPid: number; slot: number } | null;
}

// One spectator's wager: a single side and a running copper stake (topping up the
// same side accumulates). Betting on the opposite side is rejected.
export interface VcWager {
  side: 'A' | 'B';
  stake: number; // copper
}

// The parimutuel pool for a match. Winners split the WHOLE pool pro-rata to their
// stake on the winning side; a draw or a winner nobody backed refunds every stake.
export interface VcBetPool {
  poolA: number; // total copper staked on A
  poolB: number; // total copper staked on B
  wagers: Map<number, VcWager>; // bettor pid -> their wager
  settled: boolean;
}

export interface VcState {
  queues: Record<VcBracket, VcQueueUnit[]>;
  match: VcMatch | null; // the ONE physical Sowfield slot
  // Private parallel practice matches, each on its own instanced pitch copy far
  // from the Sowfield (match.origin). Independent of the one physical slot, so
  // many run at once without touching the real match or each other.
  practices: VcMatch[];
  deserters: Map<string, number>; // lower-cased name -> sim.time the lockout ends
  nextMatchId: number;
  botPids: number[]; // live practice/backfill bots (vale_cup_bots.ts)
  // Idle bot-showcase (vale_cup_bots.ts): sim.time of the last queue/match activity,
  // and a rotating counter so successive showcases pick different nations/bracket.
  lastActivityAt: number;
  showcaseCount: number;
}

export function createVcState(): VcState {
  return {
    queues: { 1: [], 2: [], 3: [], 4: [], 5: [] },
    match: null,
    practices: [],
    deserters: new Map(),
    nextMatchId: 1,
    botPids: [],
    lastActivityAt: 0,
    showcaseCount: 0,
  };
}

// The zero offset for the one real Sowfield match (a shared frozen singleton so
// every real match reads the exact same object and geometry stays byte-identical).
const VC_ORIGIN_ZERO: { x: number; z: number } = { x: 0, z: 0 };

// ---------------------------------------------------------------------------
// Small pure helpers (imported directly by damage.ts / targeting.ts / sim.ts).
// ---------------------------------------------------------------------------

export function vcupAllPids(match: VcMatch): number[] {
  return [...match.teamA, ...match.teamB];
}

export function vcupTeamOf(match: VcMatch, pid: number): 'A' | 'B' | null {
  if (match.teamA.includes(pid)) return 'A';
  if (match.teamB.includes(pid)) return 'B';
  return null;
}

/** Both pids are seated in this match (either team): the no-damage truce pair. */
export function vcupBothSeated(match: VcMatch, aPid: number, bPid: number): boolean {
  return vcupTeamOf(match, aPid) !== null && vcupTeamOf(match, bPid) !== null;
}

/** Opposing, non-benched fighters (the Shoulder's legal target pair). */
export function isVcupCrossTeam(match: VcMatch, attackerPid: number, targetPid: number): boolean {
  const atk = vcupTeamOf(match, attackerPid);
  const tgt = vcupTeamOf(match, targetPid);
  if (!atk || !tgt || atk === tgt) return false;
  if (match.benched.has(attackerPid)) return false;
  return !match.benched.has(targetPid);
}

function vcupPlayPhase(match: VcMatch): boolean {
  return match.phase === 'active' || match.phase === 'golden';
}

function normalizeRole(role: SportRole | string | undefined, bracket: VcBracket): SportRole {
  // 1v1 and 2v2 default to the all-rounder kit (PRD); unknown roles coerce too.
  if (bracket <= 2) return 'allrounder';
  return SPORT_ROLES.includes(role as SportRole) ? (role as SportRole) : 'allrounder';
}

// Autofill goalie: every 3v3+ side needs someone in goal. If nobody on the side
// picked keeper (bot-fill already guarantees one, so this only bites a fully
// human side where everyone chose outfield), promote the LAST-listed seat to
// keeper (deterministic; the last seat is packed from the latest queue unit, so
// the captain at seat 0 is never the one moved). A no-op when a keeper exists or
// the bracket is 1v1/2v2 (all-rounder, no dedicated keeper). Mutates `roles`.
function ensureSideKeeper(
  pids: number[],
  roles: Record<number, SportRole>,
  bracket: VcBracket,
): void {
  if (bracket < 3 || pids.length === 0) return;
  if (pids.some((pid) => roles[pid] === 'keeper')) return;
  roles[pids[pids.length - 1]] = 'keeper';
}

function deserterUntil(ctx: SimContext, name: string): number {
  const until = ctx.vcup.deserters.get(name.toLowerCase()) ?? 0;
  return until > ctx.time ? until : 0;
}

// ---------------------------------------------------------------------------
// World init: Groundskeeper Bram at the Sowfield gate (reserved id, see above).
// The caller (the Sim ctor) resolves `safe` through the SAME findSafePos path
// the generic NPC surface-placement loop uses, so Bram is nudged out of water
// or a building exactly like every other NPC; only his id allocation differs.
// ---------------------------------------------------------------------------

export function spawnGroundskeeper(ctx: SimContext, safe: { x: number; z: number }): void {
  const def = NPCS.groundskeeper_bram;
  if (!def || ctx.entities.has(VALE_CUP_BRAM_ID)) return;
  const npc = createNpc(VALE_CUP_BRAM_ID, def, ctx.groundPos(safe.x, safe.z));
  ctx.addEntity(npc);
}

// ---------------------------------------------------------------------------
// Queue
// ---------------------------------------------------------------------------

export function vcupQueuedUnitOf(
  ctx: SimContext,
  pid: number,
): { bracket: VcBracket; unit: VcQueueUnit } | null {
  for (const bracket of VC_BRACKETS) {
    const unit = ctx.vcup.queues[bracket].find((u) => u.pids.includes(pid));
    if (unit) return { bracket, unit };
  }
  return null;
}

export function vcupQueuePosition(ctx: SimContext, pid: number, bracket: VcBracket): number {
  let pos = 0;
  for (const unit of ctx.vcup.queues[bracket]) {
    if (unit.pids.includes(pid)) return pos + 1;
    pos += unit.pids.length;
  }
  return 0;
}

export function vcupQueueJoin(
  ctx: SimContext,
  bracket: VcBracket,
  nation: VcNationId,
  role: SportRole,
  enterAsGuild?: boolean,
  pid?: number,
): void {
  const r = ctx.resolve(pid);
  if (!r) return;
  const id = r.meta.entityId;
  if (!VC_BRACKETS.includes(bracket)) return; // malformed command; server validates types
  const queued = vcupQueuedUnitOf(ctx, id);
  if (queued) {
    if (queued.bracket === bracket) {
      ctx.emit({
        type: 'vcupQueued',
        bracket,
        position: vcupQueuePosition(ctx, id, bracket),
        pid: id,
      });
    } else {
      ctx.error(
        id,
        `You are already in the Vale Cup ${queued.bracket}v${queued.bracket} queue. Leave it before queueing for Vale Cup ${bracket}v${bracket}.`,
      );
    }
    return;
  }
  const match = ctx.vcup.match;
  if ((match && vcupTeamOf(match, id)) || ctx.arenaMatches.has(id)) {
    ctx.error(id, 'You are already in an arena match.');
    return;
  }
  if (r.e.dead) {
    ctx.error(id, 'You cannot queue for the arena while dead.');
    return;
  }
  if (ctx.duels.has(id)) {
    ctx.error(id, 'You cannot queue while dueling.');
    return;
  }
  if (ctx.trades.has(id)) {
    ctx.error(id, 'Finish your trade before queueing.');
    return;
  }
  if (r.e.pos.x > DUNGEON_X_THRESHOLD) {
    ctx.error(id, 'You cannot queue from inside an instance.');
    return;
  }
  if (deserterUntil(ctx, r.meta.name) > 0) {
    ctx.error(id, 'The Groundskeeper remembers. Come back later.');
    return;
  }
  if (!vcNation(nation)) {
    ctx.error(id, 'Pick a banner nation first.');
    return;
  }

  const party = ctx.partyOf(id);
  let unitPids: number[];
  if (!party || party.members.length === 1) {
    unitPids = [id];
  } else {
    if (party.leader !== id) {
      ctx.error(id, 'Only the party leader may queue your team for the Vale Cup.');
      return;
    }
    if (party.members.length > bracket) {
      ctx.error(id, 'That bracket needs a smaller party.');
      return;
    }
    unitPids = [...party.members];
  }
  for (const mPid of unitPids) {
    if (mPid === id) continue;
    const e = ctx.entities.get(mPid);
    const mMeta = ctx.players.get(mPid);
    if (!e || !mMeta) {
      ctx.error(id, 'A party member is unavailable.');
      return;
    }
    if (e.dead) {
      ctx.error(id, `${mMeta.name} cannot queue while dead.`);
      return;
    }
    if ((match && vcupTeamOf(match, mPid)) || ctx.arenaMatches.has(mPid)) {
      ctx.error(id, `${mMeta.name} is already in an arena match.`);
      return;
    }
    if (vcupQueuedUnitOf(ctx, mPid)) {
      ctx.error(id, `${mMeta.name} is already in the arena queue.`);
      return;
    }
    if (ctx.duels.has(mPid)) {
      ctx.error(id, `${mMeta.name} cannot queue while dueling.`);
      return;
    }
    if (ctx.trades.has(mPid)) {
      ctx.error(id, `${mMeta.name} must finish trading before queueing.`);
      return;
    }
    if (e.pos.x > DUNGEON_X_THRESHOLD) {
      ctx.error(id, `${mMeta.name} cannot queue from inside an instance.`);
      return;
    }
    if (deserterUntil(ctx, mMeta.name) > 0) {
      ctx.error(id, 'The Groundskeeper remembers. Come back later.');
      return;
    }
  }

  const roles: Record<number, SportRole> = {};
  const guilds: Record<number, string> = {};
  for (const mPid of unitPids) {
    roles[mPid] = normalizeRole(mPid === id ? role : 'allrounder', bracket);
    // Enter under the banner: each member reps their OWN guild (unusual mixed
    // guild parties still resolve correctly), only when the captain opted in and
    // the member is actually in a guild.
    if (enterAsGuild) {
      const guild = ctx.entities.get(mPid)?.guild;
      if (guild) guilds[mPid] = guild;
    }
  }
  ctx.vcup.queues[bracket].push({
    pids: unitPids,
    nation,
    roles,
    joinedAtTick: ctx.tickCount,
    guilds,
  });
  const position = ctx.vcup.queues[bracket].reduce((n, u) => n + u.pids.length, 0);
  for (const mPid of unitPids) {
    ctx.emit({ type: 'vcupQueued', bracket, position, pid: mPid });
  }
}

export function vcupQueueLeave(ctx: SimContext, pid?: number): void {
  const r = ctx.resolve(pid);
  if (!r) return;
  const id = r.meta.entityId;
  const queued = vcupQueuedUnitOf(ctx, id);
  if (!queued) return;
  const queue = ctx.vcup.queues[queued.bracket];
  const i = queue.indexOf(queued.unit);
  if (i >= 0) queue.splice(i, 1);
  for (const mPid of queued.unit.pids) ctx.emit({ type: 'vcupUnqueued', pid: mPid });
}

/** Silent removal of a leaver's whole unit (the removePlayer teardown arm). */
export function vcupDequeue(ctx: SimContext, pid: number): boolean {
  const queued = vcupQueuedUnitOf(ctx, pid);
  if (!queued) return false;
  const queue = ctx.vcup.queues[queued.bracket];
  const i = queue.indexOf(queued.unit);
  if (i >= 0) queue.splice(i, 1);
  return true;
}

export function vcupSetRole(ctx: SimContext, role: SportRole, pid?: number): void {
  const r = ctx.resolve(pid);
  if (!r) return;
  const id = r.meta.entityId;
  const queued = vcupQueuedUnitOf(ctx, id);
  if (!queued) return;
  queued.unit.roles[id] = normalizeRole(role, queued.bracket);
}

// Drop units whose members died, vanished, or got seated elsewhere (arena
// matchmaker prune pattern).
export function vcupPruneQueue(ctx: SimContext, bracket: VcBracket): void {
  const match = ctx.vcup.match;
  ctx.vcup.queues[bracket] = ctx.vcup.queues[bracket].filter((unit) =>
    unit.pids.every((id) => {
      const e = ctx.entities.get(id);
      if (!e || e.dead) return false;
      if (ctx.arenaMatches.has(id)) return false;
      return !(match && vcupTeamOf(match, id));
    }),
  );
}

// Greedy first-fit packing of queue units into two full teams of `size`.
// Deterministic: queue order only, no rng, no rating (the cup is W/L, not Elo).
export function vcupPackTeams(
  units: VcQueueUnit[],
  size: number,
): { a: VcQueueUnit[]; b: VcQueueUnit[] } | null {
  const a: VcQueueUnit[] = [];
  const b: VcQueueUnit[] = [];
  let an = 0;
  let bn = 0;
  for (const u of units) {
    if (an + u.pids.length <= size) {
      a.push(u);
      an += u.pids.length;
    } else if (bn + u.pids.length <= size) {
      b.push(u);
      bn += u.pids.length;
    }
    if (an === size && bn === size) break;
  }
  return an === size && bn === size ? { a, b } : null;
}

function sideFromUnits(units: VcQueueUnit[], bracket: VcBracket): VcSide {
  const pids: number[] = [];
  const roles: Record<number, SportRole> = {};
  const guilds: Record<number, string> = {};
  for (const u of units) {
    for (const pid of u.pids) {
      pids.push(pid);
      roles[pid] = normalizeRole(u.roles[pid], bracket);
      if (u.guilds[pid]) guilds[pid] = u.guilds[pid];
    }
  }
  return { pids, nation: units[0].nation, roles, guilds };
}

export function vcupRemoveQueueUnits(
  ctx: SimContext,
  bracket: VcBracket,
  units: VcQueueUnit[],
): void {
  const queue = ctx.vcup.queues[bracket];
  for (const unit of units) {
    const i = queue.indexOf(unit);
    if (i >= 0) queue.splice(i, 1);
  }
}

// Human-vs-human matchmaking for the one Sowfield slot. Every bracket that can
// pack two full teams is a candidate; the pitch goes to the candidate holding
// the OLDEST-waiting unit (FIFO across brackets), so a long-waiting 5v5 is never
// starved behind a stream of fresh 1v1 pairs. Deterministic (joinedAtTick only,
// no rng); ties break to the lower bracket. Starts a RATED match.
function matchmakeValeCup(ctx: SimContext): void {
  if (ctx.vcup.match) return;
  let bestBracket: VcBracket | null = null;
  let bestTick = Infinity;
  let bestPacked: { a: VcQueueUnit[]; b: VcQueueUnit[] } | null = null;
  for (const bracket of VC_BRACKETS) {
    vcupPruneQueue(ctx, bracket);
    const packed = vcupPackTeams(ctx.vcup.queues[bracket], bracket);
    if (!packed) continue;
    const earliest = Math.min(...[...packed.a, ...packed.b].map((u) => u.joinedAtTick));
    if (earliest < bestTick) {
      bestTick = earliest;
      bestBracket = bracket;
      bestPacked = packed;
    }
  }
  if (bestBracket === null || !bestPacked) return;
  vcupRemoveQueueUnits(ctx, bestBracket, [...bestPacked.a, ...bestPacked.b]);
  startCupMatch(
    ctx,
    bestBracket,
    sideFromUnits(bestPacked.a, bestBracket),
    sideFromUnits(bestPacked.b, bestBracket),
    true,
  );
}

// A bot-only exhibition (showcase) exists ONLY to fill an empty pitch, so it
// yields to real players. True when the live match is unrated and every seated
// fighter is a bot (a bot-BACKFILLED match always keeps >= 1 human, so this
// picks out showcases specifically, never a match someone is actually playing).
function isBotOnlyShowcase(ctx: SimContext, match: VcMatch): boolean {
  if (match.rated) return false;
  return vcupAllPids(match).every((pid) => ctx.vcup.botPids.includes(pid));
}

// Real players are ready to take the pitch when either a bracket can pack two
// full HUMAN teams right now (an immediate rated match), or a queued unit has
// waited out the backfill window (it is about to get a bot-filled match). Used
// to decide when to preempt a bot-only exhibition.
function humansReadyToPlay(ctx: SimContext): boolean {
  for (const bracket of VC_BRACKETS) {
    // Prune first: matchmaking's own prune is skipped while a showcase holds the
    // slot, so stale (dead/left) units could otherwise fake a ready pack.
    vcupPruneQueue(ctx, bracket);
    if (vcupPackTeams(ctx.vcup.queues[bracket], bracket)) return true;
    for (const unit of ctx.vcup.queues[bracket]) {
      if (ctx.tickCount - unit.joinedAtTick >= VC_BACKFILL_WAIT * 20) return true;
    }
  }
  return false;
}

// Preempt a live bot-only exhibition the moment real players are ready to play:
// void the book (settleBets refunds every stake on a null result) and free the
// pitch this tick, skipping the aftermath. A no-op for rated or human-seated
// matches, so a real game is never interrupted.
function maybePreemptShowcase(ctx: SimContext): void {
  const match = ctx.vcup.match;
  if (!match || match.ended) return;
  if (!isBotOnlyShowcase(ctx, match)) return;
  if (!humansReadyToPlay(ctx)) return;
  endCupMatch(ctx, match, null);
  match.timer = 0; // tear down on this tick's 'over' case, freeing the pitch now
}

// ---------------------------------------------------------------------------
// Sport kit swap (the fiesta standardize/restore split; level/xp/talents are
// UNTOUCHED so persistence is naturally safe with no restore snapshot).
// ---------------------------------------------------------------------------

export function valeCupStandardize(
  ctx: SimContext,
  meta: PlayerMeta,
  e: Entity,
  role: SportRole,
): void {
  if (meta.sportRole) return;
  // Pets are stowed for the match (the delve pet-park round-trip); a hunter's
  // wolf must not chase the ball.
  stowPetForDelve(ctx, meta.entityId);
  meta.sportRole = role;
  meta.known = resolveSportKit(role);
  meta.wireRev++; // the kit swap must reach the online action bar promptly
  // Arena-style clean slate: strips ALL auras (forms/stealth included), clears
  // cooldowns/ccDr/cast/combo/target, full hp/resource, recalcs real stats.
  ctx.resetForArena(e);
}

export function valeCupRestore(ctx: SimContext, meta: PlayerMeta, e: Entity): void {
  if (!meta.sportRole) return;
  meta.sportRole = null;
  meta.known = abilitiesKnownAt(meta.cls, e.level, ctx.playerMods(meta));
  meta.wireRev++;
  recalcPlayerStats(e, meta.cls, meta.equipment, ctx.playerMods(meta), meta.equipmentInstance);
  restorePetFromDelveStash(ctx, meta.entityId);
}

// ---------------------------------------------------------------------------
// Match lifecycle
// ---------------------------------------------------------------------------

function placeCupFighter(
  ctx: SimContext,
  e: Entity,
  spot: { x: number; z: number; facing: number },
): void {
  e.pos = ctx.groundPos(spot.x, spot.z);
  e.prevPos = { ...e.pos };
  e.facing = spot.facing;
  e.prevFacing = spot.facing;
  ctx.rebucket(e);
}

// Teams line up in their own halves; the kickoff team's taker (the first
// NON-keeper seat) steps up next to the ball, and every keeper lines up on
// their own goal line so a center-spot shot arrives at a set keeper, never an
// open net.
function placeCupFighters(ctx: SimContext, match: VcMatch): void {
  for (const team of ['A', 'B'] as const) {
    const pids = team === 'A' ? match.teamA : match.teamB;
    const spawns = team === 'A' ? VC_SPAWNS_A : VC_SPAWNS_B;
    const takerIdx = Math.max(
      0,
      pids.findIndex((pid) => match.roles[pid] !== 'keeper'),
    );
    for (let i = 0; i < pids.length; i++) {
      const e = ctx.entities.get(pids[i]);
      if (!e || match.benched.has(pids[i])) continue;
      let spot = spawns[i] ?? spawns[spawns.length - 1];
      if (match.roles[pids[i]] === 'keeper') {
        const line = team === 'A' ? GOAL_LINE_WEST_X : GOAL_LINE_EAST_X;
        spot = {
          x: line + (team === 'A' ? VC_KEEPER_LINE_DEPTH : -VC_KEEPER_LINE_DEPTH),
          z: PITCH_CENTER.z,
          facing: spot.facing,
        };
      } else if (i === takerIdx && match.kickoffTeam === team) {
        spot = {
          x: PITCH_CENTER.x + (team === 'A' ? -VC_KICKOFF_TAKER_GAP : VC_KICKOFF_TAKER_GAP),
          z: PITCH_CENTER.z,
          facing: spot.facing,
        };
      } else if (
        match.kickoffTeam !== team &&
        Math.hypot(spot.x - PITCH_CENTER.x, spot.z - PITCH_CENTER.z) < VC_KICKOFF_CIRCLE
      ) {
        // Defenders respect the center circle: the kickoff belongs to the taker.
        spot = {
          x: PITCH_CENTER.x + (team === 'A' ? -VC_KICKOFF_CIRCLE : VC_KICKOFF_CIRCLE),
          z: spot.z,
          facing: spot.facing,
        };
      }
      // spot is Sowfield-frame; shift onto this match's pitch copy (origin {0,0}
      // for the real match, a far offset for a practice instance).
      placeCupFighter(ctx, e, {
        x: spot.x + match.origin.x,
        z: spot.z + match.origin.z,
        facing: spot.facing,
      });
    }
  }
}

function buildRoster(ctx: SimContext, side: VcSide, botPids: number[]): VcCombatant[] {
  return side.pids.map((pid) => ({
    pid,
    name: ctx.players.get(pid)?.name ?? '?',
    role: side.roles[pid],
    bot: botPids.includes(pid),
  }));
}

/** Seat two sides at the Sowfield. Callers (matchmaker, backfill, practice)
 *  removed any queue units already; `rated` must be false when bots play. */
export function startCupMatch(
  ctx: SimContext,
  bracket: VcBracket,
  sideA: VcSide,
  sideB: VcSide,
  rated: boolean,
  opts?: { origin?: { x: number; z: number }; practice?: { ownerPid: number; slot: number } },
): VcMatch | null {
  const vc = ctx.vcup;
  // A practice match runs on its own instanced pitch, NOT the one physical slot,
  // so it never contends with (or is blocked by) the real Sowfield match.
  if (!opts?.practice && vc.match) return null;
  const allPids = [...sideA.pids, ...sideB.pids];
  const entities = allPids.map((pid) => ctx.entities.get(pid));
  const metas = allPids.map((pid) => ctx.players.get(pid));
  if (entities.some((e) => !e) || metas.some((m) => !m)) return null;
  const roles: Record<number, SportRole> = {};
  for (const pid of sideA.pids) roles[pid] = normalizeRole(sideA.roles[pid], bracket);
  for (const pid of sideB.pids) roles[pid] = normalizeRole(sideB.roles[pid], bracket);
  // Guarantee a keeper on each 3v3+ side (autofill goalie), then reflect the
  // resolved roles back onto the sides so the roster snapshot (buildRoster) and
  // the authoritative match.roles agree.
  ensureSideKeeper(sideA.pids, roles, bracket);
  ensureSideKeeper(sideB.pids, roles, bracket);
  for (const pid of sideA.pids) sideA.roles[pid] = roles[pid];
  for (const pid of sideB.pids) sideB.roles[pid] = roles[pid];
  const returns = new Map<number, { x: number; z: number; facing: number }>();
  for (let i = 0; i < allPids.length; i++) {
    const e = entities[i] as Entity;
    returns.set(allPids[i], { x: e.pos.x, z: e.pos.z, facing: e.facing });
  }
  // Guild banner entries carried from the queue (rated matches only credit these;
  // bots and practice never populate a guild, so the map is empty there).
  const guildEntry = new Map<number, string>();
  for (const src of [sideA.guilds, sideB.guilds]) {
    if (!src) continue;
    for (const [pid, guild] of Object.entries(src)) {
      if (guild) guildEntry.set(Number(pid), guild);
    }
  }
  const match: VcMatch = {
    id: vc.nextMatchId++,
    bracket,
    phase: 'briefing',
    timer: 0,
    briefingTimer: VC_BRIEFING_DURATION,
    ready: new Set<number>(),
    clock: 0,
    goldenClock: 0,
    golden: false,
    scoreA: 0,
    scoreB: 0,
    nationA: sideA.nation,
    nationB: sideB.nation,
    awayPalette: sideA.nation === sideB.nation,
    teamA: [...sideA.pids],
    teamB: [...sideB.pids],
    rosterA: buildRoster(ctx, sideA, vc.botPids),
    rosterB: buildRoster(ctx, sideB, vc.botPids),
    roles,
    rated,
    benched: new Set(),
    resolved: new Set(),
    kickoffTeam: 'A',
    kickoffGraceUntil: 0,
    returns,
    ball: null,
    pocket: null,
    pendingWinner: undefined,
    ended: false,
    bets: { poolA: 0, poolB: 0, wagers: new Map(), settled: false },
    guildEntry,
    origin: opts?.origin ?? VC_ORIGIN_ZERO,
    practice: opts?.practice
      ? { ownerPid: opts.practice.ownerPid, slot: opts.practice.slot }
      : null,
  };
  if (match.practice) vc.practices.push(match);
  else vc.match = match;
  // Bots ready up instantly (they have no briefing to read); the briefing then
  // only waits on the human fighters, and auto-readies them at the timer.
  for (const pid of allPids) {
    if (vc.botPids.includes(pid)) match.ready.add(pid);
  }
  for (let i = 0; i < allPids.length; i++) {
    const meta = metas[i] as PlayerMeta;
    const e = entities[i] as Entity;
    valeCupStandardize(ctx, meta, e, roles[allPids[i]]);
  }
  placeCupFighters(ctx, match);
  for (const pid of allPids) {
    const team = vcupTeamOf(match, pid) as 'A' | 'B';
    const allyPids = (team === 'A' ? match.teamA : match.teamB).filter((p) => p !== pid);
    const enemyPids = team === 'A' ? match.teamB : match.teamA;
    ctx.emit({
      type: 'vcupFound',
      bracket,
      nationA: match.nationA,
      nationB: match.nationB,
      team,
      allies: arenaCombatants(ctx, allyPids),
      enemies: arenaCombatants(ctx, enemyPids),
      pid,
    });
  }
  // The countdown does not start yet: the match opens on the pre-match briefing
  // (players ready up or auto-ready at the timer, see updateValeCup 'briefing').
  return match;
}

// Leave the briefing and begin the 3s whistle countdown.
function startCountdown(ctx: SimContext, match: VcMatch): void {
  match.phase = 'countdown';
  match.timer = VC_COUNTDOWN;
  const c = matchCenter(match);
  ctx.emit({ type: 'vcupCountdown', seconds: VC_COUNTDOWN, x: c.x, z: c.z });
}

// Ready up during the briefing. A no-op outside the briefing or for a
// non-fighter; when every human fighter is ready the countdown starts at once.
export function vcupReady(ctx: SimContext, pid?: number): void {
  const r = ctx.resolve(pid);
  if (!r) return;
  const id = r.meta.entityId;
  const match = vcupMatchOf(ctx, id);
  if (!match || match.phase !== 'briefing') return;
  match.ready.add(id);
}

// True when every un-benched fighter has readied (bots are pre-readied).
function allFightersReady(match: VcMatch): boolean {
  for (const pid of vcupAllPids(match)) {
    if (match.benched.has(pid)) continue;
    if (!match.ready.has(pid)) return false;
  }
  return true;
}

function spawnBall(ctx: SimContext, match: VcMatch): VcBallState {
  const template = MOBS[VALE_CUP_BALL_TEMPLATE_ID];
  const id = ctx.nextId++;
  const pos = ctx.groundPos(PITCH_CENTER.x + match.origin.x, PITCH_CENTER.z + match.origin.z);
  const ball = createMob(id, template, template.minLevel, pos);
  // Bell-pattern inert flip: no aggro, no auto-attack, no AI targeting.
  ball.hostile = false;
  ball.inCombat = false;
  ball.aggroTargetId = null;
  ball.aiState = 'idle';
  ctx.addEntity(ball);
  return {
    entityId: id,
    x: pos.x,
    y: pos.y,
    z: pos.z,
    vx: 0,
    vy: 0,
    vz: 0,
    holderPid: null,
    holdUntil: 0,
    lastKickPid: null,
    lastKickTeam: null,
    lastKickAt: -Infinity,
    lastTouchPid: null,
    lastTouchTeam: null,
  };
}

function writeBallEntity(ctx: SimContext, ball: VcBallState): void {
  const e = ctx.entities.get(ball.entityId);
  if (!e) return;
  e.pos.x = ball.x;
  e.pos.y = ball.y;
  e.pos.z = ball.z;
  ctx.rebucket(e);
}

function resetBallToCenter(ctx: SimContext, match: VcMatch): void {
  const ball = match.ball;
  if (!ball) return;
  const pos = ctx.groundPos(PITCH_CENTER.x + match.origin.x, PITCH_CENTER.z + match.origin.z);
  ball.x = pos.x;
  ball.y = pos.y;
  ball.z = pos.z;
  ball.vx = 0;
  ball.vy = 0;
  ball.vz = 0;
  ball.holderPid = null;
  ball.holdUntil = 0;
  ball.lastKickPid = null;
  ball.lastKickTeam = null;
  ball.lastKickAt = -Infinity;
  ball.lastTouchPid = null;
  ball.lastTouchTeam = null;
  writeBallEntity(ctx, ball);
}

// Pitch-center world coords for this match (the real Sowfield, or a practice
// instance's shifted copy). Theatre events anchor here so practice banners stay
// private to the offset pitch and never reach Sowfield walk-ups.
function matchCenter(match: VcMatch): { x: number; z: number } {
  return { x: PITCH_CENTER.x + match.origin.x, z: PITCH_CENTER.z + match.origin.z };
}

function kickoff(ctx: SimContext, match: VcMatch): void {
  if (!match.ball) match.ball = spawnBall(ctx, match);
  else resetBallToCenter(ctx, match);
  match.pocket = null;
  match.kickoffGraceUntil = ctx.time + VC_KICKOFF_GRACE;
  const c = matchCenter(match);
  ctx.emit({ type: 'vcupKickoff', x: c.x, z: c.z });
}

// Scorer credit: the scoring team's last kicker within 8s, else its last
// toucher; an own goal with no confident scorer stays nameless (empty string;
// the client shows the generic banner).
const VC_SCORER_KICK_WINDOW = 8;

function scorerNameFor(ctx: SimContext, match: VcMatch, team: 'A' | 'B'): string {
  const ball = match.ball;
  if (!ball) return '';
  if (ball.lastKickTeam === team && ctx.time - ball.lastKickAt <= VC_SCORER_KICK_WINDOW) {
    return ctx.players.get(ball.lastKickPid ?? -1)?.name ?? '';
  }
  if (ball.lastTouchTeam === team) {
    return ctx.players.get(ball.lastTouchPid ?? -1)?.name ?? '';
  }
  return '';
}

function onGoal(ctx: SimContext, match: VcMatch, scoringTeam: 'A' | 'B'): void {
  if (scoringTeam === 'A') match.scoreA++;
  else match.scoreB++;
  const c = matchCenter(match);
  ctx.emit({
    type: 'vcupGoal',
    scorerName: scorerNameFor(ctx, match, scoringTeam),
    team: scoringTeam,
    scoreA: match.scoreA,
    scoreB: match.scoreB,
    nationA: match.nationA,
    nationB: match.nationB,
    x: c.x,
    z: c.z,
  });
  // 'A' scores into the EAST goal; the ball settles in that pocket.
  match.pocket = scoringTeam === 'A' ? 'east' : 'west';
  match.kickoffTeam = scoringTeam === 'A' ? 'B' : 'A';
  match.phase = 'goal';
  match.timer = VC_GOAL_CELEBRATE;
  if (match.golden) match.pendingWinner = scoringTeam;
  else if (match.scoreA >= VC_SCORE_CAP || match.scoreB >= VC_SCORE_CAP) {
    match.pendingWinner = scoringTeam;
  }
}

function startGolden(ctx: SimContext, match: VcMatch): void {
  match.golden = true;
  match.phase = 'golden';
  match.kickoffTeam = 'B'; // A took the opening kickoff; golden alternates
  placeCupFighters(ctx, match);
  resetBallToCenter(ctx, match);
  match.kickoffGraceUntil = ctx.time + VC_KICKOFF_GRACE;
  const c = matchCenter(match);
  ctx.emit({ type: 'vcupGolden', x: c.x, z: c.z });
  ctx.emit({ type: 'vcupKickoff', x: c.x, z: c.z });
}

// Credit a fighter's guild for a rated result. Only fires when they entered
// under a banner (guildEntry) AND are STILL in that exact guild at resolution
// (checked against the live entity), so leaving the guild mid-match, or a stale
// entry, forfeits the credit. A draw credits neither guild (the board is W/L).
function creditGuildResult(
  ctx: SimContext,
  match: VcMatch,
  pid: number,
  result: 'win' | 'loss',
): void {
  const guild = match.guildEntry.get(pid);
  if (!guild || ctx.entities.get(pid)?.guild !== guild) return;
  const meta = ctx.players.get(pid);
  if (!meta) return;
  if (result === 'win') meta.vcupGuildWins++;
  else meta.vcupGuildLosses++;
}

function applyStanding(ctx: SimContext, match: VcMatch, winner: 'A' | 'B' | null): void {
  if (!match.rated) return; // bot-backfilled and practice matches count no standing
  for (const team of ['A', 'B'] as const) {
    const pids = team === 'A' ? match.teamA : match.teamB;
    for (const pid of pids) {
      if (match.resolved.has(pid)) continue; // deserters already took their loss
      const meta = ctx.players.get(pid);
      if (!meta) continue;
      if (winner === null) meta.vcupDraws++;
      else if (winner === team) {
        meta.vcupWins++;
        creditGuildResult(ctx, match, pid, 'win');
      } else {
        meta.vcupLosses++;
        creditGuildResult(ctx, match, pid, 'loss');
      }
      match.resolved.add(pid);
    }
  }
}

// A spectator places (or tops up) a parimutuel wager during the briefing window.
// Server-authoritative: debits copper immediately and records the stake on the
// match; settlement at the final whistle credits the winners.
export function vcupPlaceBet(ctx: SimContext, pid: number, side: 'A' | 'B', amount: number): void {
  // Authority checks. The HUD only offers the bet action when these hold (window
  // open, at the Sowfield, not a participant), so a rejection here means a stale
  // or hostile client: silently no-op rather than emit a new localized string.
  // The one exception is insufficient funds (a legit race), which reuses the
  // already-localized 'Not enough money.'.
  const match = ctx.vcup.match;
  if (!match || match.phase !== 'briefing') return; // betting window closed
  if (ctx.vcup.botPids.includes(pid)) return; // bots never bet
  if (vcupTeamOf(match, pid) !== null) return; // participants cannot bet on their own match
  const e = ctx.entities.get(pid);
  const meta = ctx.players.get(pid);
  if (!e || !meta) return;
  if (!isAtSowfield(e.pos.x, e.pos.z)) return; // must be at the arena
  const stake = Math.floor(amount);
  if (!Number.isFinite(stake) || stake < VC_BET_MIN) return;
  const existing = match.bets.wagers.get(pid);
  if (existing && existing.side !== side) return; // cannot back both sides
  const current = existing?.stake ?? 0;
  if (current + stake > VC_BET_MAX) return; // over the per-player cap
  if (meta.copper < stake) {
    ctx.error(pid, 'Not enough money.');
    return;
  }
  meta.copper -= stake;
  if (side === 'A') match.bets.poolA += stake;
  else match.bets.poolB += stake;
  match.bets.wagers.set(pid, { side, stake: current + stake });
}

// Settle the pool at the final whistle. Winners get their stake back plus a
// pro-rata share of the losing pool; a draw (or a winning side nobody backed)
// voids the book and refunds every stake. Rounding dust stays unpaid.
function settleBets(ctx: SimContext, match: VcMatch, winner: 'A' | 'B' | null): void {
  const pool = match.bets;
  if (pool.settled) return;
  pool.settled = true;
  if (pool.wagers.size === 0) return;
  const winPool = winner === 'A' ? pool.poolA : winner === 'B' ? pool.poolB : 0;
  const losePool = winner === 'A' ? pool.poolB : winner === 'B' ? pool.poolA : 0;
  const refundAll = winner === null || winPool === 0;
  for (const [pid, w] of pool.wagers) {
    const meta = ctx.players.get(pid);
    if (!meta) continue; // bettor left: their stake is forfeit (rare edge)
    if (refundAll) {
      meta.copper += w.stake;
      ctx.emit({
        type: 'vcupBetSettled',
        pid,
        outcome: 'refunded',
        stake: w.stake,
        payout: w.stake,
      });
      continue;
    }
    if (w.side === winner) {
      const winnings = Math.floor((w.stake * losePool) / winPool);
      const payout = w.stake + winnings;
      meta.copper += payout;
      meta.vcupBetWins++;
      meta.vcupBetNet += winnings;
      ctx.emit({ type: 'vcupBetSettled', pid, outcome: 'won', stake: w.stake, payout });
    } else {
      meta.vcupBetLosses++;
      meta.vcupBetNet -= w.stake;
      ctx.emit({ type: 'vcupBetSettled', pid, outcome: 'lost', stake: w.stake, payout: 0 });
    }
  }
}

export function endCupMatch(ctx: SimContext, match: VcMatch, winner: 'A' | 'B' | null): void {
  if (match.ended) return;
  match.ended = true;
  applyStanding(ctx, match, winner);
  settleBets(ctx, match, winner);
  const c = matchCenter(match);
  ctx.emit({
    type: 'vcupEnd',
    scoreA: match.scoreA,
    scoreB: match.scoreB,
    nationA: match.nationA,
    nationB: match.nationB,
    winner,
    x: c.x,
    z: c.z,
  });
  for (const pid of vcupAllPids(match)) {
    if (!ctx.entities.get(pid)) continue;
    const team = vcupTeamOf(match, pid);
    ctx.emit({
      type: 'vcupResult',
      won: winner !== null && winner === team,
      draw: winner === null,
      pid,
    });
  }
  match.phase = 'over';
  match.timer = VC_OVER_DELAY;
}

// The 'over' aftermath elapsed: restore every fighter (kit, pets, clean slate),
// send them home, despawn the ball, and free the slot. Bots are removed by
// vale_cup_bots on the next pass (entity removal needs Sim.removePlayer).
function teardownCupMatch(ctx: SimContext, match: VcMatch): void {
  for (const pid of vcupAllPids(match)) {
    const meta = ctx.players.get(pid);
    const e = ctx.entities.get(pid);
    if (!meta || !e) continue;
    valeCupRestore(ctx, meta, e);
    ctx.resetForArena(e); // wipes sport_* cooldowns; the arena accepts the same tradeoff
    const ret = match.returns.get(pid);
    if (ret) {
      e.pos = ctx.groundPos(ret.x, ret.z);
      e.prevPos = { ...e.pos };
      e.facing = ret.facing;
      ctx.rebucket(e);
      ctx.emit({ type: 'respawn', pid });
    }
  }
  if (match.ball) ctx.dropEntity(match.ball.entityId);
  match.ball = null;
  if (match.practice) {
    // Free this practice instance: unlist it. Its bots are reaped by
    // updateValeCupBots (they are no longer in any live match).
    const i = ctx.vcup.practices.indexOf(match);
    if (i >= 0) ctx.vcup.practices.splice(i, 1);
  } else {
    ctx.vcup.match = null;
  }
}

// ---------------------------------------------------------------------------
// Desertion (the Groundskeeper remembers)
// ---------------------------------------------------------------------------

// Idempotent: bench the fighter, take the counted loss, arm the lockout. The
// server calls this BEFORE the leave save so the loss persists; removePlayer
// calls it again harmlessly. Bots bench without standing or lockout.
export function vcupResolveDesertion(ctx: SimContext, pid: number): void {
  const vc = ctx.vcup;
  const match = vcupMatchOf(ctx, pid);
  if (!match || !vcupTeamOf(match, pid)) return;
  if (match.benched.has(pid)) return;
  match.benched.add(pid);
  if (match.ball?.holderPid === pid) {
    match.ball.holderPid = null;
    match.ball.vx = 0;
    match.ball.vy = 0;
    match.ball.vz = 0;
  }
  if (match.ended || match.phase === 'over') return; // the match was already decided
  if (vc.botPids.includes(pid)) return;
  if (!match.rated || match.resolved.has(pid)) return;
  const meta = ctx.players.get(pid);
  if (!meta) return;
  meta.vcupLosses++;
  creditGuildResult(ctx, match, pid, 'loss'); // deserting also costs your guild
  match.resolved.add(pid);
  vc.deserters.set(meta.name.toLowerCase(), ctx.time + VC_DESERTER_LOCKOUT);
}

/** The saved return position while seated in a match (serializeCharacter must
 *  persist the RETURN spot, never mid-pitch). */
export function vcupReturnFor(
  ctx: SimContext,
  pid: number,
): { x: number; z: number; facing: number } | null {
  const match = vcupMatchOf(ctx, pid);
  if (!match) return null;
  return match.returns.get(pid) ?? null;
}

// The live match a player is seated in: the one Sowfield match, OR their private
// practice instance. Sport abilities, desertion, return-on-logout, and the HUD
// all resolve through this, so practice plays exactly like the real match.
export function vcupMatchOf(ctx: SimContext, pid: number): VcMatch | null {
  const match = ctx.vcup.match;
  if (match && vcupTeamOf(match, pid)) return match;
  return ctx.vcup.practices.find((p) => vcupTeamOf(p, pid)) ?? null;
}

// ---------------------------------------------------------------------------
// Effect arms (consumed by combat/effect_dispatch.ts via the seam). All three
// silently no-op unless the caster is seated in the live match's play phase.
// ---------------------------------------------------------------------------

function ballVec(ball: VcBallState): { x: number; y: number; z: number } {
  return { x: ball.x, y: ball.y, z: ball.z };
}

export function vcupBallKick(
  ctx: SimContext,
  caster: Entity,
  power: number,
  loft: number,
  range: number,
): void {
  const match = vcupMatchOf(ctx, caster.id);
  if (!match || !vcupPlayPhase(match)) return;
  const team = vcupTeamOf(match, caster.id);
  if (!team || match.benched.has(caster.id)) return;
  const ball = match.ball;
  if (!ball) return;
  if (ball.holderPid !== null && ball.holderPid !== caster.id) return; // held: unkickable by others
  const maxRange = range > 0 ? range : MELEE_RANGE;
  // Possession gate: strike only a ball you actually have (holding it as keeper,
  // or the loose ball at your feet). maxRange below stays the aim/touch reach.
  if (ball.holderPid === null && dist2d(caster.pos, ballVec(ball)) > VC_POSSESSION_RADIUS) {
    return;
  }
  if (ball.holderPid === caster.id) {
    ball.holderPid = null; // launch from the hold
    ball.holdUntil = 0;
  }
  const aim = caster.castAim ?? {
    x: caster.pos.x + Math.sin(caster.facing) * maxRange,
    y: caster.pos.y,
    z: caster.pos.z + Math.cos(caster.facing) * maxRange,
  };
  // Direction: from the ball toward the aim point, blended toward (aim - caster)
  // when the ball sits at the caster's feet (a near-zero ball-to-aim vector
  // would make the kick direction unstable).
  let dirX = aim.x - ball.x;
  let dirZ = aim.z - ball.z;
  if (dist2d(caster.pos, ballVec(ball)) < 1.5 || Math.hypot(dirX, dirZ) < 0.5) {
    dirX = aim.x - caster.pos.x;
    dirZ = aim.z - caster.pos.z;
  }
  if (Math.hypot(dirX, dirZ) < 1e-6) {
    dirX = Math.sin(caster.facing);
    dirZ = Math.cos(caster.facing);
  }
  // Touch: scale the power (and loft) by how far the aim point is, so a short
  // pass rolls softly and only a full-reach aim gets the ability's top power.
  // maxRange is the ability's reach, so frac is 1 at/beyond it. This makes
  // passing and placement feel intentional instead of every kick a rocket.
  const aimDist = dist2d(ballVec(ball), aim);
  const frac = Math.max(VC_KICK_MIN_FRAC, Math.min(1, aimDist / maxRange));
  power *= frac;
  loft *= frac;
  // Whistle grace: right after a kickoff the ball only takes the short Kick's
  // profile, so an instant unchallenged Big Boot from the center spot cannot
  // be the first touch of the half (live-balance rule).
  if (ctx.time < match.kickoffGraceUntil) {
    power = Math.min(power, VC_GRACE_KICK_POWER);
    loft = Math.min(loft, VC_GRACE_KICK_LOFT);
  }
  launchBall(ball, dirX, dirZ, power, loft);
  ball.lastKickPid = caster.id;
  ball.lastKickTeam = team;
  ball.lastKickAt = ctx.time;
  ball.lastTouchPid = caster.id;
  ball.lastTouchTeam = team;
  writeBallEntity(ctx, ball);
}

function gripBall(ctx: SimContext, match: VcMatch, keeper: Entity, team: 'A' | 'B'): void {
  const ball = match.ball;
  if (!ball) return;
  // A shot moving toward the keeper's own goal fast enough counts as a save.
  const towardOwnGoal = team === 'A' ? -ball.vx : ball.vx;
  if (towardOwnGoal > VC_SAVE_SHOT_SPEED) {
    const name = ctx.players.get(keeper.id)?.name ?? '';
    ctx.emit({ type: 'vcupSave', keeperName: name, x: keeper.pos.x, z: keeper.pos.z });
  }
  ball.holderPid = keeper.id;
  ball.holdUntil = ctx.time + VC_GRIP_HOLD;
  ball.vx = 0;
  ball.vy = 0;
  ball.vz = 0;
  ball.lastTouchPid = keeper.id;
  ball.lastTouchTeam = team;
}

export function vcupSportDash(
  ctx: SimContext,
  caster: Entity,
  distance: number,
  catchBall: boolean,
): void {
  const match = vcupMatchOf(ctx, caster.id);
  if (!match || !vcupPlayPhase(match)) return;
  const team = vcupTeamOf(match, caster.id);
  if (!team || match.benched.has(caster.id)) return;
  const aim = caster.castAim;
  let dirX = aim ? aim.x - caster.pos.x : Math.sin(caster.facing);
  let dirZ = aim ? aim.z - caster.pos.z : Math.cos(caster.facing);
  const len = Math.hypot(dirX, dirZ);
  if (len < 1e-6) {
    dirX = Math.sin(caster.facing);
    dirZ = Math.cos(caster.facing);
  } else {
    dirX /= len;
    dirZ /= len;
  }
  // Reuse the terrain-clamped, collider-swept knockback walker to move the
  // CASTER: a fake source one yard behind them steers the push along the aim
  // (the Tolling Bell fake-source precedent).
  const fakeSource = {
    ...caster,
    pos: { x: caster.pos.x - dirX, y: caster.pos.y, z: caster.pos.z - dirZ },
  } as Entity;
  ctx.applyKnockback(fakeSource, caster, distance);
  const ball = match.ball;
  if (
    catchBall &&
    ball &&
    ball.holderPid === null &&
    dist2d(caster.pos, ballVec(ball)) <= VC_DIVE_CATCH_RADIUS + VC_BALL_RADIUS
  ) {
    gripBall(ctx, match, caster, team);
    updateHeldBall(ctx, match);
  }
}

export function vcupSportShove(
  ctx: SimContext,
  caster: Entity,
  target: Entity,
  distance: number,
): void {
  const match = vcupMatchOf(ctx, caster.id);
  if (!match || !vcupPlayPhase(match)) return;
  if (!isVcupCrossTeam(match, caster.id, target.id)) return; // only lands on cup opponents
  ctx.applyKnockback(caster, target, distance);
}

// The teammate a pass should go to: the caster's current friendly target when it
// is a live pitch team-mate (the "pass to your selected player" path), else the
// most on-line teammate toward the aim (a forgiving contextual pass). Keepers are
// eligible as a back-pass target only when explicitly selected, never picked
// contextually. Deterministic: fixed pid order breaks every tie.
function pickPassReceiver(
  ctx: SimContext,
  match: VcMatch,
  caster: Entity,
  team: 'A' | 'B',
  maxSeek: number = VC_PASS_MAX_RANGE,
): Entity | null {
  const mates = team === 'A' ? match.teamA : match.teamB;
  const selfPid = caster.id;
  const targetId = caster.targetId;
  if (
    targetId !== null &&
    targetId !== selfPid &&
    mates.includes(targetId) &&
    !match.benched.has(targetId)
  ) {
    const tgt = ctx.entities.get(targetId);
    if (tgt && !tgt.dead) return tgt; // an explicit team-mate target (keeper included)
  }
  // Contextual pick: aim direction from the passer, best-aligned team-mate.
  const aim = caster.castAim;
  let dirX = aim ? aim.x - caster.pos.x : Math.sin(caster.facing);
  let dirZ = aim ? aim.z - caster.pos.z : Math.cos(caster.facing);
  const dl = Math.hypot(dirX, dirZ);
  if (dl < 1e-6) {
    dirX = Math.sin(caster.facing);
    dirZ = Math.cos(caster.facing);
  } else {
    dirX /= dl;
    dirZ /= dl;
  }
  let best: Entity | null = null;
  let bestDot = VC_PASS_CONE_DOT;
  for (const pid of mates) {
    if (pid === selfPid || match.benched.has(pid)) continue;
    if (match.roles[pid] === 'keeper') continue; // never pick the keeper contextually
    const mate = ctx.entities.get(pid);
    if (!mate || mate.dead) continue;
    let mx = mate.pos.x - caster.pos.x;
    let mz = mate.pos.z - caster.pos.z;
    const ml = Math.hypot(mx, mz);
    if (ml < 1e-6 || ml > maxSeek) continue;
    mx /= ml;
    mz /= ml;
    const dot = dirX * mx + dirZ * mz;
    if (dot > bestDot) {
      bestDot = dot;
      best = mate;
    }
  }
  return best;
}

export function vcupBallPass(
  ctx: SimContext,
  caster: Entity,
  maxPower: number,
  loft: number,
  range: number,
): void {
  const match = vcupMatchOf(ctx, caster.id);
  if (!match || !vcupPlayPhase(match)) return;
  const team = vcupTeamOf(match, caster.id);
  if (!team || match.benched.has(caster.id)) return;
  const ball = match.ball;
  if (!ball) return;
  if (ball.holderPid !== null && ball.holderPid !== caster.id) return; // held by someone else
  const maxRange = range > 0 ? range : MELEE_RANGE;
  // Possession gate: you must have the ball (holding it, or loose at your feet),
  // not merely be within the pass's reach.
  if (ball.holderPid === null && dist2d(caster.pos, ballVec(ball)) > VC_POSSESSION_RADIUS) {
    return;
  }
  const receiver = pickPassReceiver(ctx, match, caster, team, maxRange);
  if (!receiver) return; // nobody to pass to: the whistle stays quiet, no wild boot
  if (ball.holderPid === caster.id) {
    ball.holderPid = null;
    ball.holdUntil = 0;
  }
  // Lead the receiver's run by a few ticks of their own velocity (prevPos delta).
  const rvx = receiver.pos.x - receiver.prevPos.x;
  const rvz = receiver.pos.z - receiver.prevPos.z;
  const aimX = receiver.pos.x + rvx * VC_PASS_LEAD_TICKS;
  const aimZ = receiver.pos.z + rvz * VC_PASS_LEAD_TICKS;
  // Direction from the ball toward the lead point (fall back to the passer when
  // the ball sits at their feet, mirroring vcupBallKick).
  let dirX = aimX - ball.x;
  let dirZ = aimZ - ball.z;
  if (dist2d(caster.pos, ballVec(ball)) < 1.5 || Math.hypot(dirX, dirZ) < 0.5) {
    dirX = aimX - caster.pos.x;
    dirZ = aimZ - caster.pos.z;
  }
  const gap = Math.hypot(aimX - ball.x, aimZ - ball.z);
  let power = Math.min(maxPower, VC_PASS_BASE_POWER + gap * VC_PASS_PACE);
  let passLoft = loft;
  // Whistle grace: a pass right after kickoff is capped to the short-touch profile
  // like any other first touch (live-balance rule shared with vcupBallKick).
  if (ctx.time < match.kickoffGraceUntil) {
    power = Math.min(power, VC_GRACE_KICK_POWER);
    passLoft = Math.min(passLoft, VC_GRACE_KICK_LOFT);
  }
  launchBall(ball, dirX, dirZ, power, passLoft);
  ball.lastKickPid = caster.id;
  ball.lastKickTeam = team;
  ball.lastKickAt = ctx.time;
  ball.lastTouchPid = caster.id;
  ball.lastTouchTeam = team;
  writeBallEntity(ctx, ball);
}

// Shoot at goal. The held charge (encoded by the client as the aim distance)
// scales BOTH the ground speed and the loft, so a max-power shot sails over the
// bar. The shot auto-aims at the enemy goal, biased toward the post the caster
// faces (so facing a corner picks it). Deterministic: draws no rng.
export function vcupShoot(
  ctx: SimContext,
  caster: Entity,
  maxPower: number,
  maxLoft: number,
  range: number,
): void {
  const match = vcupMatchOf(ctx, caster.id);
  if (!match || !vcupPlayPhase(match)) return;
  const team = vcupTeamOf(match, caster.id);
  if (!team || match.benched.has(caster.id)) return;
  const ball = match.ball;
  if (!ball) return;
  if (ball.holderPid !== null && ball.holderPid !== caster.id) return; // held by someone else
  const maxRange = range > 0 ? range : MELEE_RANGE;
  // Possession gate: only shoot a ball at your feet (or one you hold as keeper).
  // maxRange below is the charge/aim reach, not the possession radius.
  if (ball.holderPid === null && dist2d(caster.pos, ballVec(ball)) > VC_POSSESSION_RADIUS) {
    return;
  }
  if (ball.holderPid === caster.id) {
    ball.holderPid = null;
    ball.holdUntil = 0;
  }
  // Charge fraction from the aim distance the client encoded (near = tap, far =
  // full power). No aim (a bot's direct cast) fires at full power.
  const chargeDist = caster.castAim ? dist2d(caster.pos, caster.castAim) : maxRange;
  const frac = Math.max(VC_SHOOT_MIN_FRAC, Math.min(1, chargeDist / maxRange));
  let power = maxPower * frac;
  let loft = maxLoft * frac;
  // Aim: the enemy goal, with the target post biased by the caster's facing (its
  // lateral component picks near vs far corner). A little past the line so the
  // ball crosses at pace instead of dying on it. All landmarks are Sowfield-frame,
  // so shift onto this match's pitch copy (origin {0,0} for the real match) to
  // match the world-space ball position; without this a practice shot fires back
  // toward the Sowfield instead of at the practice goal.
  const { x: ox, z: oz } = match.origin;
  const enemyGoalX = (team === 'A' ? GOAL_LINE_EAST_X : GOAL_LINE_WEST_X) + ox;
  const targetX = enemyGoalX + (team === 'A' ? 3 : -3);
  const fz = Math.cos(caster.facing); // z-component of facing (lateral to the shot axis)
  const targetZ = Math.max(
    GOAL_Z_MIN + 0.6 + oz,
    Math.min(GOAL_Z_MAX - 0.6 + oz, PITCH_CENTER.z + oz + fz * GOAL_HALF_W * VC_SHOOT_CORNER_BIAS),
  );
  let dirX = targetX - ball.x;
  let dirZ = targetZ - ball.z;
  if (Math.hypot(dirX, dirZ) < 1e-6) {
    dirX = Math.sin(caster.facing);
    dirZ = Math.cos(caster.facing);
  }
  // Whistle grace: a shot right off the kickoff is clamped to the soft profile.
  if (ctx.time < match.kickoffGraceUntil) {
    power = Math.min(power, VC_GRACE_KICK_POWER);
    loft = Math.min(loft, VC_GRACE_KICK_LOFT);
  }
  launchBall(ball, dirX, dirZ, power, loft);
  ball.lastKickPid = caster.id;
  ball.lastKickTeam = team;
  ball.lastKickAt = ctx.time;
  ball.lastTouchPid = caster.id;
  ball.lastTouchTeam = team;
  writeBallEntity(ctx, ball);
}

// ---------------------------------------------------------------------------
// Per-tick drivers
// ---------------------------------------------------------------------------

function updateHeldBall(ctx: SimContext, match: VcMatch): void {
  const ball = match.ball;
  if (!ball || ball.holderPid === null) return;
  const holder = ctx.entities.get(ball.holderPid);
  if (!holder || holder.dead || ctx.time >= ball.holdUntil) {
    ball.holderPid = null;
    ball.vx = 0;
    ball.vy = 0;
    ball.vz = 0;
    return;
  }
  ball.x = holder.pos.x + Math.sin(holder.facing) * VC_HOLD_CARRY_DIST;
  ball.z = holder.pos.z + Math.cos(holder.facing) * VC_HOLD_CARRY_DIST;
  ball.y = ctx.groundPos(ball.x, ball.z).y;
  writeBallEntity(ctx, ball);
}

function keeperBox(
  team: 'A' | 'B',
  origin: { x: number; z: number },
): { xMin: number; xMax: number; zMin: number; zMax: number } {
  // Team A defends the WEST goal. Shifted onto this match's pitch copy.
  const xMin = (team === 'A' ? GOAL_LINE_WEST_X : GOAL_LINE_EAST_X - GOAL_BOX_DEPTH) + origin.x;
  return {
    xMin,
    xMax: xMin + GOAL_BOX_DEPTH,
    zMin: PITCH_CENTER.z - GOAL_BOX_HALF_W + origin.z,
    zMax: PITCH_CENTER.z + GOAL_BOX_HALF_W + origin.z,
  };
}

function inKeeperBox(
  team: 'A' | 'B',
  x: number,
  z: number,
  origin: { x: number; z: number },
): boolean {
  const box = keeperBox(team, origin);
  return x >= box.xMin && x <= box.xMax && z >= box.zMin && z <= box.zMax;
}

// Keeper's grip, body traps, and dribbling contacts, in fixed team/pid order
// (deterministic). The grip pass runs FIRST across every fighter so a keeper's
// box catch always beats a body trap resolved on the same tick (the Grip owns
// its box), then traps and dribbles resolve together.
function updateBallContacts(ctx: SimContext, match: VcMatch): void {
  const ball = match.ball;
  if (!ball || ball.holderPid !== null) return;
  const groundY = ctx.groundPos(ball.x, ball.z).y;
  const ballSpeed = Math.hypot(ball.vx, ball.vz);
  for (const team of ['A', 'B'] as const) {
    const pids = team === 'A' ? match.teamA : match.teamB;
    for (const pid of pids) {
      if (match.benched.has(pid) || match.roles[pid] !== 'keeper') continue;
      const e = ctx.entities.get(pid);
      if (!e || e.dead) continue;
      // Keeper's grip: a moving INBOUND ball entering the keeper's own box
      // sticks. Inbound (moving toward the own goal line) matters: without it
      // the keeper's own clearing punt would re-grip itself the same tick.
      const towardOwnGoal = team === 'A' ? -ball.vx : ball.vx;
      if (
        ballSpeed >= VC_GRIP_MIN_BALL_SPEED &&
        towardOwnGoal > 0 &&
        dist2d(e.pos, ballVec(ball)) <= VC_GRIP_RADIUS &&
        ball.y - groundY <= 2 &&
        inKeeperBox(team, e.pos.x, e.pos.z, match.origin)
      ) {
        gripBall(ctx, match, e, team);
        updateHeldBall(ctx, match);
        return;
      }
    }
  }
  for (const team of ['A', 'B'] as const) {
    const pids = team === 'A' ? match.teamA : match.teamB;
    for (const pid of pids) {
      if (match.benched.has(pid)) continue;
      const e = ctx.entities.get(pid);
      if (!e || e.dead) continue;
      const d = dist2d(e.pos, ballVec(ball));
      if (d > VC_DRIBBLE_RADIUS + VC_PLAYER_BODY_RADIUS) continue;
      // Body control: a fast ball never sails through a standing fighter; the
      // body traps it to a slow roll at their feet, so positioning and pass
      // interception are real for every role. Tumbled fighters cannot trap,
      // and the kicker is exempt from their own kick for the grace beat.
      if (
        ball.y - groundY <= VC_TRAP_MAX_BALL_HEIGHT &&
        !isStunned(e) &&
        !(pid === ball.lastKickPid && ctx.time - ball.lastKickAt < VC_TRAP_KICK_GRACE) &&
        applyBodyTrap(ball, e.pos.x - e.prevPos.x, e.pos.z - e.prevPos.z, e.facing)
      ) {
        ball.lastTouchPid = pid;
        ball.lastTouchTeam = team;
        continue;
      }
      // Dribbling: running into the ball carries it along.
      if (ball.y - groundY <= VC_DRIBBLE_MAX_BALL_HEIGHT) {
        if (applyDribbleNudge(ball, e.pos.x - e.prevPos.x, e.pos.z - e.prevPos.z)) {
          ball.lastTouchPid = pid;
          ball.lastTouchTeam = team;
        }
      }
    }
  }
}

function updateBallInPlay(ctx: SimContext, match: VcMatch): void {
  const ball = match.ball;
  if (!ball) return;
  // Resilience: the match ball STATE is authoritative; if the 1 hp entity ever
  // vanished (there is no legal damage path to it, belt and braces), respawn
  // the visual so play never continues around an invisible ball.
  if (!ctx.entities.get(ball.entityId)) {
    const fresh = spawnBall(ctx, match);
    ball.entityId = fresh.entityId;
    writeBallEntity(ctx, ball);
  }
  if (ball.holderPid !== null) {
    updateHeldBall(ctx, match);
    if (ball.holderPid !== null) return; // still carried; no physics this tick
  }
  const groundY = ctx.groundPos(ball.x, ball.z).y;
  // stepBallPhysics reasons in the absolute Sowfield frame (goal lines, boards),
  // so translate the ball into that frame for the step and back to world after.
  // The real match's origin is {0,0}, so this is a no-op there (byte-identical).
  const { x: ox, z: oz } = match.origin;
  ball.x -= ox;
  ball.z -= oz;
  const goal = stepBallPhysics(ball, groundY);
  ball.x += ox;
  ball.z += oz;
  updateBallContacts(ctx, match);
  writeBallEntity(ctx, ball);
  if (goal) onGoal(ctx, match, goal);
}

// The pitch is closed to non-participants while a match is on (any phase but the
// 'over' aftermath): a HARD barrier, not a gentle nudge. Anyone standing on the
// pitch is ejected to just outside the NEAREST edge, so a match starting under
// their feet teleports them off to the touchline, and walking in through the
// gate is bounced straight back out. Fully open again once the match ends (no
// match, or 'over'). The pitch boards keep them off the other three sides; this
// closes the gate. On a practice instance no non-participant is ever near the
// offset pitch, so it is a no-op there.
const VC_PITCH_EJECT_MARGIN = 1.05; // yd clear of the edge (fighter radius 0.55 + margin)

function policePitch(ctx: SimContext, match: VcMatch): void {
  if (match.phase === 'over') return; // aftermath: the pitch is free again
  const { x: ox, z: oz } = match.origin;
  for (const meta of ctx.players.values()) {
    const pid = meta.entityId;
    if (vcupTeamOf(match, pid)) continue; // the players ON the pitch
    const e = ctx.entities.get(pid);
    if (!e) continue;
    // Work in this match's pitch frame.
    const lx = e.pos.x - ox;
    const lz = e.pos.z - oz;
    if (!isOnPitch(lx, lz)) continue;
    // Eject to just outside whichever edge they are closest to (so they leave
    // where they tried to enter, not flung across the ground).
    const dN = PITCH.zMax - lz;
    const dS = lz - PITCH.zMin;
    const dE = PITCH.xMax - lx;
    const dW = lx - PITCH.xMin;
    const nearest = Math.min(dN, dS, dE, dW);
    let nlx = lx;
    let nlz = lz;
    if (nearest === dN) nlz = PITCH.zMax + VC_PITCH_EJECT_MARGIN;
    else if (nearest === dS) nlz = PITCH.zMin - VC_PITCH_EJECT_MARGIN;
    else if (nearest === dE) nlx = PITCH.xMax + VC_PITCH_EJECT_MARGIN;
    else nlx = PITCH.xMin - VC_PITCH_EJECT_MARGIN;
    e.pos = ctx.groundPos(nlx + ox, nlz + oz);
    e.prevPos = { ...e.pos }; // hard teleport: no interpolated streak across the boards
    ctx.rebucket(e);
  }
}

// Keep practice fighters on their offset pitch copy: unlike the real Sowfield,
// an instanced pitch has no board colliders out in the far band, so a hard clamp
// to the pitch bounds (plus a small margin) stands in for the boards. A no-op for
// the real match (never called for it).
function clampPracticeToPitch(ctx: SimContext, match: VcMatch): void {
  const { x: ox, z: oz } = match.origin;
  const margin = VC_FIGHTER_RADIUS;
  for (const pid of vcupAllPids(match)) {
    if (match.benched.has(pid)) continue;
    const e = ctx.entities.get(pid);
    if (!e) continue;
    const lx = Math.max(PITCH.xMin + margin, Math.min(PITCH.xMax - margin, e.pos.x - ox));
    const lz = Math.max(PITCH.zMin + margin, Math.min(PITCH.zMax - margin, e.pos.z - oz));
    const wx = lx + ox;
    const wz = lz + oz;
    if (wx !== e.pos.x || wz !== e.pos.z) {
      e.pos.x = wx;
      e.pos.z = wz;
      e.pos.y = ctx.groundPos(wx, wz).y;
      ctx.rebucket(e);
    }
  }
}

function activeFighter(ctx: SimContext, match: VcMatch, pid: number): boolean {
  return !match.benched.has(pid) && !!ctx.entities.get(pid);
}

// Fighters do not walk through each other while playing football: a symmetric
// circle separation resolved after movement each tick, in fixed team/pid order
// (deterministic). Each overlapping pair pushes apart along its center line,
// half each, capped per tick. The cap is set well ABOVE the fastest run speed
// (sprint ~10.5 yd/s = 0.53 yd/tick, so a 0.6 yd/tick push per fighter, 12 yd/s,
// out-paces any approach) so nobody walks THROUGH an opponent; but it is mutual,
// so a player contesting a ball shoves the camper off it rather than sticking.
// A perfectly stacked pair breaks along +x (pair order is fixed, so this is
// stable). Pushed positions resolve against the stadium colliders (nobody clips
// into the boards) and re-seat on the ground. prevPos is deliberately left
// alone: the shove counts as movement for the dribble nudge, so jostling FOR the
// ball nudges it.
export const VC_FIGHTER_RADIUS = 0.55; // per-fighter body radius on the pitch
const VC_SEPARATION_STEP = 0.6; // yd/tick max push per fighter (12 yd/s, > sprint)

function separateFighters(ctx: SimContext, match: VcMatch): void {
  if (match.phase !== 'briefing' && match.phase !== 'countdown' && !vcupPlayPhase(match)) return;
  const fighters: Entity[] = [];
  for (const pid of vcupAllPids(match)) {
    if (match.benched.has(pid)) continue;
    const e = ctx.entities.get(pid);
    if (e && !e.dead) fighters.push(e);
  }
  const minDist = VC_FIGHTER_RADIUS * 2;
  for (let i = 0; i < fighters.length; i++) {
    for (let j = i + 1; j < fighters.length; j++) {
      const p = fighters[i];
      const q = fighters[j];
      const dx = q.pos.x - p.pos.x;
      const dz = q.pos.z - p.pos.z;
      const d = Math.hypot(dx, dz);
      if (d >= minDist) continue;
      const nx = d > 1e-6 ? dx / d : 1;
      const nz = d > 1e-6 ? dz / d : 0;
      const push = Math.min((minDist - d) / 2, VC_SEPARATION_STEP);
      // The real Sowfield resolves the push against the stadium boards; a practice
      // instance has no colliders out in the far band (it routes through a foreign
      // instance region), so push raw and let clampPracticeToPitch hold the bounds.
      const pr = match.practice
        ? { x: p.pos.x - nx * push, z: p.pos.z - nz * push }
        : ctx.resolveMovePoint(p.pos.x - nx * push, p.pos.z - nz * push, VC_FIGHTER_RADIUS, p);
      const qr = match.practice
        ? { x: q.pos.x + nx * push, z: q.pos.z + nz * push }
        : ctx.resolveMovePoint(q.pos.x + nx * push, q.pos.z + nz * push, VC_FIGHTER_RADIUS, q);
      p.pos.x = pr.x;
      p.pos.z = pr.z;
      q.pos.x = qr.x;
      q.pos.z = qr.z;
      p.pos.y = ctx.groundPos(p.pos.x, p.pos.z).y;
      q.pos.y = ctx.groundPos(q.pos.x, q.pos.z).y;
      ctx.rebucket(p);
      ctx.rebucket(q);
    }
  }
}

// End-of-tick system phase, appended AFTER updateDelveRuns() in Sim.tick().
// Draws ZERO shared rng on any path.
export function updateValeCup(ctx: SimContext): void {
  const vc = ctx.vcup;
  // Lazy deserter-book cleanup (the read paths compare against ctx.time anyway).
  if (vc.deserters.size > 0 && ctx.tickCount % 100 === 0) {
    for (const [name, until] of vc.deserters) {
      if (until <= ctx.time) vc.deserters.delete(name);
    }
  }
  // A bot-only exhibition yields to real players before anything else this tick,
  // so the pitch frees and the rated/backfill match can seat below.
  maybePreemptShowcase(ctx);
  if (!vc.match) matchmakeValeCup(ctx);
  if (vc.match) stepCupMatch(ctx, vc.match);
  // Private practice matches step independently on their own instanced pitches.
  // A copy of the list: teardown mutates vc.practices.
  for (const pm of [...vc.practices]) stepCupMatch(ctx, pm);
}

// One match's per-tick lifecycle, shared by the real Sowfield match and every
// practice instance (all geometry reads add match.origin). Tears the match down
// on the 'over' timer.
function stepCupMatch(ctx: SimContext, match: VcMatch): void {
  if (!match.ended) {
    // Vanished fighters (disconnects handled out-of-band) bench as deserters.
    for (const pid of vcupAllPids(match)) {
      if (!match.benched.has(pid) && !ctx.entities.get(pid)) vcupResolveDesertion(ctx, pid);
    }
    const aliveA = match.teamA.some((pid) => activeFighter(ctx, match, pid));
    const aliveB = match.teamB.some((pid) => activeFighter(ctx, match, pid));
    if (!aliveA && !aliveB) endCupMatch(ctx, match, null);
    else if (!aliveA) endCupMatch(ctx, match, 'B');
    else if (!aliveB) endCupMatch(ctx, match, 'A');
  }

  const c = matchCenter(match);
  switch (match.phase) {
    case 'briefing': {
      match.briefingTimer -= DT;
      // With the public experience on, the briefing is a fixed betting/instructions
      // window: ready-up is informational and the whistle always waits out the full
      // timer, so spectators get their guaranteed >= 30s to wager. A practice match
      // is private (no spectators to wait for), so ready-up always shortcuts it.
      const timerDone = match.briefingTimer <= 0;
      const gated = ctx.cfg.valeCupShowcase && !match.practice;
      if (gated ? timerDone : allFightersReady(match) || timerDone) {
        startCountdown(ctx, match);
      }
      break;
    }
    case 'countdown': {
      const before = Math.ceil(match.timer);
      match.timer -= DT;
      const after = Math.ceil(match.timer);
      if (after < before && after > 0) {
        ctx.emit({ type: 'vcupCountdown', seconds: after, x: c.x, z: c.z });
      }
      if (match.timer <= 0) {
        match.phase = 'active';
        kickoff(ctx, match);
      }
      break;
    }
    case 'active': {
      match.clock += DT;
      updateBallInPlay(ctx, match);
      if (match.phase === 'active' && match.clock >= VC_MATCH_DURATION) {
        if (match.scoreA !== match.scoreB) {
          endCupMatch(ctx, match, match.scoreA > match.scoreB ? 'A' : 'B');
        } else {
          startGolden(ctx, match);
        }
      }
      break;
    }
    case 'golden': {
      match.goldenClock += DT;
      updateBallInPlay(ctx, match);
      if (match.phase === 'golden' && match.goldenClock >= VC_GOLDEN_CAP) {
        endCupMatch(ctx, match, null);
      }
      break;
    }
    case 'goal': {
      match.timer -= DT;
      const ball = match.ball;
      if (ball && match.pocket) {
        // Settle in this match's pitch frame, then write world coords back.
        const { x: ox, z: oz } = match.origin;
        ball.x -= ox;
        ball.z -= oz;
        settleBallInPocket(ball, match.pocket, ctx.groundPos(ball.x + ox, ball.z + oz).y);
        ball.x += ox;
        ball.z += oz;
        writeBallEntity(ctx, ball);
      }
      if (match.timer <= 0) {
        if (match.pendingWinner !== undefined) {
          endCupMatch(ctx, match, match.pendingWinner);
          match.pendingWinner = undefined;
        } else {
          placeCupFighters(ctx, match);
          resetBallToCenter(ctx, match);
          match.pocket = null;
          match.phase = match.golden ? 'golden' : 'active';
          match.kickoffGraceUntil = ctx.time + VC_KICKOFF_GRACE;
          ctx.emit({ type: 'vcupKickoff', x: c.x, z: c.z });
        }
      }
      break;
    }
    case 'over': {
      match.timer -= DT;
      if (match.timer <= 0) {
        teardownCupMatch(ctx, match);
        return;
      }
      break;
    }
  }

  policePitch(ctx, match);
  separateFighters(ctx, match);
  if (match.practice) clampPracticeToPitch(ctx, match);
}

// ---------------------------------------------------------------------------
// Presentation (IWorldValeCup)
// ---------------------------------------------------------------------------

const VC_BOARD_SIZE = 10;

function rosterInfo(
  ctx: SimContext,
  match: VcMatch,
  side: VcCombatant[],
  viewerPid: number,
): VcRosterPlayer[] {
  return side.map((c) => {
    const meta = ctx.players.get(c.pid);
    // The guild the fighter is repping: only shown when they ENTERED under the
    // banner and are still in it (guildEntry + live entity), so a private queuer
    // never flies a banner. Bots have no guild.
    const entered = match.guildEntry.get(c.pid);
    const live = ctx.entities.get(c.pid)?.guild;
    return {
      pid: c.pid,
      name: c.name,
      role: match.roles[c.pid] ?? c.role,
      me: c.pid === viewerPid,
      bot: c.bot,
      ready: match.ready.has(c.pid),
      wins: meta?.vcupWins ?? 0,
      losses: meta?.vcupLosses ?? 0,
      guild: entered && entered === live ? entered : '',
    };
  });
}

function betInfoFor(match: VcMatch, viewerPid: number): VcBetInfo {
  const w = match.bets.wagers.get(viewerPid);
  return {
    open: match.phase === 'briefing',
    poolA: match.bets.poolA,
    poolB: match.bets.poolB,
    count: match.bets.wagers.size,
    myStake: w?.stake ?? 0,
    mySide: w?.side ?? null,
  };
}

function matchInfoFor(ctx: SimContext, match: VcMatch, viewerPid: number): VcMatchInfo {
  const timeLeft = match.golden
    ? Math.max(0, Math.ceil(VC_GOLDEN_CAP - match.goldenClock))
    : Math.max(0, Math.ceil(VC_MATCH_DURATION - match.clock));
  return {
    id: match.id,
    phase: match.phase,
    countdown: match.phase === 'countdown' ? Math.max(0, Math.ceil(match.timer)) : 0,
    timeLeft,
    golden: match.golden,
    scoreA: match.scoreA,
    scoreB: match.scoreB,
    nationA: match.nationA,
    nationB: match.nationB,
    awayPalette: match.awayPalette,
    team: vcupTeamOf(match, viewerPid),
    teamA: rosterInfo(ctx, match, match.rosterA, viewerPid),
    teamB: rosterInfo(ctx, match, match.rosterB, viewerPid),
    ballId: match.ball?.entityId ?? null,
    kickoffTeam: match.kickoffTeam,
    holderPid: match.ball?.holderPid ?? null,
    briefingLeft: match.phase === 'briefing' ? Math.max(0, Math.ceil(match.briefingTimer)) : 0,
    iAmReady: match.ready.has(viewerPid),
    bets: betInfoFor(match, viewerPid),
    origin: { x: match.origin.x, z: match.origin.z },
    ...(match.phase === 'over' ? { returnIn: Math.max(0, Math.ceil(match.timer)) } : {}),
  };
}

function liveMatchInfo(match: VcMatch): VcLiveMatch {
  return {
    id: match.id,
    bracket: match.bracket,
    clock: Math.floor(match.clock + match.goldenClock),
    scoreA: match.scoreA,
    scoreB: match.scoreB,
    nationA: match.nationA,
    nationB: match.nationB,
  };
}

// Winners board: top online players by cup wins (arenaLadder pattern; bots and
// offline characters never appear because both live in the players roster only
// while connected, and bots are filtered explicitly).
function winnersBoard(ctx: SimContext): { name: string; wins: number }[] {
  const rows: { name: string; wins: number }[] = [];
  for (const meta of ctx.players.values()) {
    if (!ctx.entities.get(meta.entityId)) continue;
    if (ctx.vcup.botPids.includes(meta.entityId)) continue;
    rows.push({ name: meta.name, wins: meta.vcupWins });
  }
  rows.sort((a, b) => b.wins - a.wins || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return rows.slice(0, VC_BOARD_SIZE);
}

// Guild leaderboard: online guilds ranked by their members' accumulated Vale Cup
// guild W/L (the wins/losses earned while entering under the banner). Aggregated
// from the currently-connected members (the winners-board pattern), so it is a
// LIVE board, not a persisted guild ledger. Guilds with no cup record are hidden.
function guildBoard(ctx: SimContext): { name: string; wins: number; losses: number }[] {
  const agg = new Map<string, { wins: number; losses: number }>();
  for (const meta of ctx.players.values()) {
    const e = ctx.entities.get(meta.entityId);
    if (!e || ctx.vcup.botPids.includes(meta.entityId)) continue;
    const guild = e.guild;
    if (!guild) continue;
    if (meta.vcupGuildWins === 0 && meta.vcupGuildLosses === 0) continue;
    const cur = agg.get(guild) ?? { wins: 0, losses: 0 };
    cur.wins += meta.vcupGuildWins;
    cur.losses += meta.vcupGuildLosses;
    agg.set(guild, cur);
  }
  const rows = [...agg.entries()].map(([name, r]) => ({ name, wins: r.wins, losses: r.losses }));
  rows.sort(
    (a, b) =>
      b.wins - a.wins || a.losses - b.losses || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
  );
  return rows.slice(0, VC_BOARD_SIZE);
}

export function cupInfoFor(ctx: SimContext, pid: number): CupInfo | null {
  const meta = ctx.players.get(pid);
  if (!meta) return null;
  const vc = ctx.vcup;
  const queued = vcupQueuedUnitOf(ctx, pid);
  // My live match: the real Sowfield game if I am in it, else my private practice
  // instance. Either way it drives my in-match HUD (score, clock, banners).
  const match = vcupMatchOf(ctx, pid);
  // A non-participant standing at the Sowfield gets the walk-up spectator view
  // (rosters, phase, live betting pool) that drives the banner/card. Kept out of
  // `match` so every "am I playing?" gate that keys off cupInfo.match is untouched.
  const e = ctx.entities.get(pid);
  const spectate = !match && vc.match && e && isAtSowfield(e.pos.x, e.pos.z) ? vc.match : null;
  // Names of everyone currently off in a private practice instance (the HUD shows
  // this in the Sowfield region so walk-ups see who is practicing).
  const practicing = vc.practices
    .map((p) => ctx.players.get(p.practice?.ownerPid ?? -1)?.name ?? '')
    .filter((n) => n.length > 0);
  const queueSizes: Record<VcBracket, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const bracket of VC_BRACKETS) {
    queueSizes[bracket] = vc.queues[bracket].reduce((n, u) => n + u.pids.length, 0);
  }
  const until = deserterUntil(ctx, meta.name);
  return {
    standing: { wins: meta.vcupWins, losses: meta.vcupLosses, draws: meta.vcupDraws },
    queued: queued !== null,
    bracket: queued?.bracket ?? null,
    nation:
      queued?.unit.nation ??
      (match ? (vcupTeamOf(match, pid) === 'A' ? match.nationA : match.nationB) : null),
    role: match
      ? (match.roles[pid] ?? null)
      : queued
        ? (queued.unit.roles[pid] ?? null)
        : meta.sportRole,
    position: queued ? vcupQueuePosition(ctx, pid, queued.bracket) : 0,
    queueSizes,
    deserterFor: until > 0 ? Math.ceil(until - ctx.time) : 0,
    match: match ? matchInfoFor(ctx, match, pid) : null,
    spectate: spectate ? matchInfoFor(ctx, spectate, pid) : null,
    betRecord: { wins: meta.vcupBetWins, losses: meta.vcupBetLosses, net: meta.vcupBetNet },
    // The Sowfield's running match, for the persistent indicator, EXCEPT to a
    // player off in a private practice instance: they should not see the other
    // (main) game's live strip overlaid on their own bout.
    live: vc.match && !match?.practice ? liveMatchInfo(vc.match) : null,
    board: winnersBoard(ctx),
    guildBoard: guildBoard(ctx),
    myGuild: e?.guild || null,
    guildStanding: { wins: meta.vcupGuildWins, losses: meta.vcupGuildLosses },
    practicing,
  };
}
