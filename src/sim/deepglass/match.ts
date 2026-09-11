// The deepball match driver: kickoff, play, goals, boost pads and the 3D bots.
//
// Scoped to the OFFLINE event build. The match lives in a module singleton
// rather than on Sim, so nothing in the Sim class, its serialization or the
// online wire has to know deepball exists yet — the Vale Cup integration
// (docs/prd/deepglass.md section 8) is what moves this onto ctx.vcup.
//
// Determinism: no rng anywhere on this path. Bot aim error is a pure function
// of tick and pid (the vale_cup_bots precedent), currents come off the match
// clock, and everything else is arithmetic.

import { DEEPGLASS_BALL_TEMPLATE_ID, resolveDeepballKit } from './abilities';
import { abilitiesKnownAt, MOBS } from '../data';
import { createMob } from '../entity';
import type { SimContext } from '../sim_context';
import { DT, type Entity, type MoveInput } from '../types';
import { terrainHeight } from '../world';
import {
  applyBodyContact,
  DG_BALL_RADIUS,
  DG_BODY_CENTRE_Y,
  DG_BODY_RADIUS,
  DG_KICKOFF_UP_SPEED,
  type DgBallKinematics,
  type DgContactBody,
  launchBall,
  setBallSpin,
  settleBallInPocket,
  stepBallFluid,
  sweptContactTime,
} from './ball';
import {
  assignBotRoles,
  botNoise,
  botSigned,
  type DgBotBrain,
  type DgBotView,
  driveBot,
  keeperFitness,
  makeBotBrain,
} from './bots';
import {
  despawnDeepglassCrowd,
  respawnDeepglassCrowdAfterMatch,
  updateDeepglassCrowd,
} from './crowd';
import { currentAt } from './currents';
import {
  aimPitchOf,
  DG_CHARGE_MAX,
  deepglassFlightPass,
  endDeepglassFlight,
  lookDirection,
  refillCharge,
} from './flight';
import {
  clampToBell,
  DG_BALL_KICKOFF,
  DG_BOOST_PADS,
  DG_PAD_RADIUS,
  DG_POWERUP_RADIUS,
  DG_POWERUP_SITES,
  DG_SPAWNS_A,
  DG_SPAWNS_B,
  type DgBoostPad,
  ringCentreFor,
  targetRingFor,
  type Vec3,
  DG_RESPAWN_A,
  DG_RESPAWN_B,
} from './layout';
import { DG_ARRIVAL } from './world';

// ---------------------------------------------------------------------------
// Tuning
// ---------------------------------------------------------------------------
/** Fighters a side when nobody says otherwise (the steward's booking, and the
 *  bare `/deepglass` dev command). */
export const DEEPGLASS_DEFAULT_PER_SIDE = 3;
export const DG_COUNTDOWN = 3; // s of whistle before kickoff
export const DG_MATCH_DURATION = 300; // s of play
export const DG_GOAL_CELEBRATE = 4; // s of celebration per goal
export const DG_SCORE_CAP = 5; // first to this ends it early
export const DG_PLAY_RADIUS = 3.2; // yd from the ball you can strike it
export const DG_PAD_RESPAWN_TICKS = Math.round(7 / DT);
/** The five full vents are worth waiting for, so they take longer to relight —
 *  which is what makes holding the middle mean something. */
export const DG_BIG_PAD_RESPAWN_TICKS = Math.round(13 / DT);
export const DG_POWERUP_RESPAWN_TICKS = Math.round(22 / DT);
/**
 * How fast a bot flies next to a human.
 *
 * The first roster read the ball's true position and velocity every tick, which
 * in a 3D bell is an enormous edge, and the handicap here was what stood in for
 * fallibility. The brains in ./bots.ts are fallible for real now — they work off
 * a belief that lags and errs — so the body handicap can come back up: it is
 * there to leave a human room on a straight race, not to hide the AI.
 */
export const DG_BOT_SPEED_SCALE = 0.9;
// Bot roles. A side of this many or more posts a keeper. At 2 a pair plays one
// out, one back; only a 1v1 has nobody home, which is the point of a 1v1.
export const DG_KEEPER_MIN_SIDE = 2;

export type DgPhase = 'countdown' | 'active' | 'goal' | 'over';

/** How the ball was last played: a deliberate strike, or a body it hit. */
export type DgTouchKind = 'strike' | 'body';

/** Bout tallies, for the HUD and for tuning. */
export interface DgMatchStats {
  /** Strikes committed by anyone, whether or not they connected. */
  strikes: number;
  /** ...of which met no ball: a bot swinging at where it believed the ball was,
   *  or a player mistiming a Shot. */
  whiffs: number;
  /** Body-to-body contacts, and the ones hard enough to spin someone out. */
  bumps: number;
  tumbles: number;
  /** Own goals, counted separately from the score they fed. */
  ownGoals: number;
  /** Goals off a struck shot, and goals off a body in a scramble. Both are
   *  legitimate deepball; the SPLIT is the thing worth watching, because a bout
   *  that is nearly all scrambles is pinball rather than a sport. */
  goalsStruck: number;
  goalsScrambled: number;
}

export interface DgBall extends DgBallKinematics {
  entityId: number;
  lastTouchPid: number | null;
  lastTouchTeam: 'A' | 'B' | null;
}

export interface DgMatch {
  phase: DgPhase;
  timer: number; // countdown / celebrate / aftermath remaining
  clock: number; // elapsed ACTIVE play
  scoreA: number;
  scoreB: number;
  teamA: number[];
  teamB: number[];
  botPids: number[];
  humanPid: number | null;
  ball: DgBall | null;
  /** Ticks until each pad relights; 0 = available. */
  padCooldown: number[];
  /** Ticks until each powerup site respawns; 0 = there for the taking. */
  powerupCooldown: number[];
  /** One brain per bot: temperament, belief, role, cooldowns (./bots.ts). */
  botBrains: Map<number, DgBotBrain>;
  /** Where each body stood before the bout seated it, so the final whistle can
   *  put them back rather than dropping them out of the sky. */
  returnTo: Map<number, { x: number; z: number; facing: number }>;
  tick: number;
  lastGoalBy: 'A' | 'B' | null;
  /** Who put the last goal in, who set it up, and whether they meant to. Read
   *  by the HUD; an own goal is credited to the side that benefits and called
   *  out by name, because "who scored that" is the first thing anyone asks. */
  lastGoalScorer: number | null;
  lastGoalAssist: number | null;
  lastGoalOwn: boolean;
  /**
   * The last few touches, newest first: who, which side, which tick. Assists
   * come off this, and so does the own-goal test.
   */
  touches: { pid: number; team: 'A' | 'B'; tick: number; kind: DgTouchKind }[];
  /**
   * Sudden death. A drawn bout used to simply stop on the whistle, which is a
   * flat ending to a sport whose whole shape is a comeback; now the clock runs
   * out and the next goal wins.
   */
  overtime: boolean;
  /** Rolling count of ticks each side has held the ball, for the HUD. */
  possessionA: number;
  possessionB: number;
  /** Bout tallies. Cheap, and they are what makes the roster's behaviour
   *  measurable instead of a matter of opinion — a tuning pass on the bots reads
   *  these rather than watching and guessing. */
  stats: DgMatchStats;
  /** Ticks left in the wall-pinch window after a body contact: a bank off
   *  the glass inside it is a squeeze, not a plain bounce (ball.ts). Runtime
   *  only, reset by every contact. */
  pinchTicks?: number;
  /**
   * Varies the bots' aim between bouts. Their error is a pure function of
   * (tick, pid) for determinism, which meant every bout from a fresh Sim played
   * out IDENTICALLY — same score, same goal times, to the tick. Salting with the
   * sim tick at kickoff keeps the tick path rng-free (this is read once, at
   * start) while making no two bouts the same.
   */
  salt: number;
}

let active: DgMatch | null = null;

export function deepglassMatch(): DgMatch | null {
  return active;
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

/** Bot classes, for VISUAL variety only — deepball moves are class-agnostic and
 *  the truce floors every combat stat, so class here is purely who you look
 *  like. The two pet classes are out so no wolf or demon paddles onto the
 *  pitch. Every bot used to be a mage (spawnDevBot's default), which is why a
 *  bout was six identical witches. */
const DG_BOT_CLASSES = [
  'warrior',
  'rogue',
  'mage',
  'priest',
  'paladin',
  'shaman',
  'druid',
] as const;

/** Skin slots to roll across. Every class ships at least this many alternates
 *  in SKINS, and an out-of-range index falls back to the default texture. */
const DG_BOT_SKINS = 4;

const DG_BOT_NAMES = [
  'Bram Tidewright',
  'Sela Copperdive',
  'Onn Glassfoot',
  'Mira Deepwell',
  'Hask Brinemantle',
  'Yorrel Sowlight',
  'Pell Undertow',
  'Kesh Ninefathom',
  'Rowan Bellhand',
];

function seatBody(
  ctx: SimContext,
  pid: number,
  spawn: { x: number; y: number; z: number; facing: number },
): void {
  const e = ctx.entities.get(pid);
  if (!e) return;
  e.pos.x = spawn.x;
  e.pos.y = spawn.y;
  e.pos.z = spawn.z;
  e.prevPos = { ...e.pos };
  e.facing = spawn.facing;
  e.vx = 0;
  e.vy = 0;
  e.vz = 0;
  e.dgFlight = true;
  e.dgCharge = DG_CHARGE_MAX;
  e.dgBoosting = false;
  e.dgRegenHold = 0;
  // The brassgill feeds air: nothing in the bell drowns. Reset the lungful so a
  // player who swam in here does not arrive already short of breath.
  e.breathUsedTicks = 0;
  e.drownTicks = 0;
  ctx.rebucket(e);
}

/**
 * Swap the caster's bar to the deepball kit for the bout, the way
 * valeCupStandardize does it for boarball: ONLY meta.known changes, so level,
 * xp, talents and gear are untouched and persistence needs no snapshot. The
 * client's hotbar picks the moves up through the existing 'sport' form.
 */
function swapToDeepballKit(ctx: SimContext, pid: number): void {
  const meta = ctx.players.get(pid);
  if (!meta) return;
  meta.known = resolveDeepballKit();
  meta.wireRev++;
}

function restoreKit(ctx: SimContext, pid: number): void {
  const meta = ctx.players.get(pid);
  const e = ctx.entities.get(pid);
  if (!meta || !e) return;
  meta.known = abilitiesKnownAt(meta.cls, e.level, ctx.playerMods(meta));
  meta.wireRev++;
}

function spawnBall(ctx: SimContext): DgBall {
  const template = MOBS[DEEPGLASS_BALL_TEMPLATE_ID];
  const id = ctx.nextId++;
  const ball = createMob(id, template, template.minLevel, { ...DG_BALL_KICKOFF });
  // Bell-pattern inert flip, exactly as the Vale Cup ball does it: no aggro, no
  // auto-attack, no AI targeting, so the ball rides the ordinary entity wire
  // with zero custom net code.
  ball.hostile = false;
  ball.inCombat = false;
  ball.aggroTargetId = null;
  ball.aiState = 'idle';
  // The template is the Vale Cup's "Boarball"; in the bell the same inert mob
  // IS the Tidesow, and a click-target frame saying otherwise reads as a bug.
  ball.name = 'The Tidesow';
  ball.pos = { ...DG_BALL_KICKOFF };
  ball.prevPos = { ...DG_BALL_KICKOFF };
  ctx.addEntity(ball);
  return {
    entityId: id,
    x: DG_BALL_KICKOFF.x,
    y: DG_BALL_KICKOFF.y,
    z: DG_BALL_KICKOFF.z,
    vx: 0,
    vy: 0,
    vz: 0,
    lastTouchPid: null,
    lastTouchTeam: null,
  };
}

/** Start a bout. `perSide` fighters a side; the human takes team A seat 0. */
export function startDeepglassMatch(
  ctx: SimContext,
  humanPid: number | null,
  perSide = 3,
): DgMatch {
  if (active) endDeepglassMatch(ctx);
  // Match day clears the concourse: the city-event crowd, sitters and
  // stallkeepers despawn so the bout runs without twenty-three composed
  // characters in the scene (crowd.ts brings them back at the whistle).
  despawnDeepglassCrowd(ctx);

  const teamA: number[] = [];
  const teamB: number[] = [];
  const botPids: number[] = [];
  const taken = new Set<string>();
  for (const meta of ctx.players.values()) taken.add(meta.name.toLowerCase());
  let nameIdx = 0;
  const nextName = (): string => {
    while (nameIdx < DG_BOT_NAMES.length) {
      const n = DG_BOT_NAMES[nameIdx++];
      if (!taken.has(n.toLowerCase())) {
        taken.add(n.toLowerCase());
        return n;
      }
    }
    // Fallback numbering must ALSO dodge `taken`: a stale "Deepball N" in the
    // roster would fail spawnDevBot and short the team by a seat.
    let n = `Deepball ${nameIdx++}`;
    while (taken.has(n.toLowerCase())) n = `Deepball ${nameIdx++}`;
    taken.add(n.toLowerCase());
    return n;
  };

  if (humanPid !== null) teamA.push(humanPid);
  for (const team of [teamA, teamB]) {
    while (team.length < perSide) {
      // Spread class and skin across the roster so the two sides read as a
      // crowd of individuals. Deterministic in spawn order, so a replay seats
      // the same faces.
      const n = botPids.length;
      const cls = DG_BOT_CLASSES[(n * 3 + 1) % DG_BOT_CLASSES.length];
      const pid = ctx.spawnDevBot(nextName(), cls);
      if (pid < 0) break; // name clash or a full roster: play short rather than spin
      const e = ctx.entities.get(pid);
      const meta = ctx.players.get(pid);
      const skin = (n * 5 + 2) % DG_BOT_SKINS;
      if (e) e.skin = skin;
      if (meta) {
        meta.skin = skin;
        meta.wireRev++;
      }
      botPids.push(pid);
      team.push(pid);
    }
  }

  // Remember where everyone was standing BEFORE the bell swallowed them. The
  // final whistle puts them back there; without it the teardown simply cleared
  // the flight state and left the body hanging 40 yards up, which fell the
  // whole way to the slate and killed the player on their own kickoff spot.
  const returnTo = new Map<number, { x: number; z: number; facing: number }>();
  for (const pid of [...teamA, ...teamB]) {
    const e = ctx.entities.get(pid);
    if (e) returnTo.set(pid, { x: e.pos.x, z: e.pos.z, facing: e.facing });
  }

  for (let i = 0; i < teamA.length; i++)
    seatBody(ctx, teamA[i], DG_SPAWNS_A[i % DG_SPAWNS_A.length]);
  for (let i = 0; i < teamB.length; i++)
    seatBody(ctx, teamB[i], DG_SPAWNS_B[i % DG_SPAWNS_B.length]);
  // Only the human needs a bar; the bots never cast.
  if (humanPid !== null) swapToDeepballKit(ctx, humanPid);

  clearLastBeam();
  const salt = ctx.tickCount;
  const ball = spawnBall(ctx);
  active = {
    phase: 'countdown',
    timer: DG_COUNTDOWN,
    clock: 0,
    scoreA: 0,
    scoreB: 0,
    teamA,
    teamB,
    botPids,
    humanPid,
    ball,
    padCooldown: DG_BOOST_PADS.map(() => 0),
    powerupCooldown: DG_POWERUP_SITES.map(() => 0),
    botBrains: new Map(botPids.map((pid) => [pid, makeBotBrain(pid, salt, ball)])),
    returnTo,
    tick: 0,
    lastGoalBy: null,
    lastGoalScorer: null,
    lastGoalAssist: null,
    lastGoalOwn: false,
    touches: [],
    overtime: false,
    possessionA: 0,
    possessionB: 0,
    stats: {
      strikes: 0,
      whiffs: 0,
      bumps: 0,
      tumbles: 0,
      ownGoals: 0,
      goalsStruck: 0,
      goalsScrambled: 0,
    },
    salt,
  };
  return active;
}

/**
 * Set a body back down on solid ground after the bell lets go of it.
 *
 * Two things matter and both were missing. The body has to land on the actual
 * terrain height rather than keep the bell's mid-air Y — and `fallStartY` has
 * to be reset with it, because the fall-damage rule is "how far below your
 * highest point did you land", and a body released at y=41 measured its fall
 * from up there and died on impact the instant it was handed back to ordinary
 * ground motion.
 */
function landSafely(
  ctx: SimContext,
  e: Entity,
  back: { x: number; z: number; facing: number } | undefined,
): void {
  const x = back?.x ?? DG_ARRIVAL.x;
  const z = back?.z ?? DG_ARRIVAL.z;
  const y = terrainHeight(x, z, ctx.cfg.seed);
  e.pos.x = x;
  e.pos.y = y;
  e.pos.z = z;
  e.prevPos = { ...e.pos };
  if (back) e.facing = back.facing;
  e.vx = 0;
  e.vy = 0;
  e.vz = 0;
  e.onGround = true;
  e.jumping = false;
  e.fallStartY = y;
  e.swimStroke = 0;
  e.swimDiving = false;
  ctx.rebucket(e);
}

export function endDeepglassMatch(ctx: SimContext): void {
  if (!active) return;
  clearLastBeam();
  if (active.humanPid !== null) restoreKit(ctx, active.humanPid);
  for (const pid of [...active.teamA, ...active.teamB]) {
    const e = ctx.entities.get(pid);
    if (!e) continue;
    endDeepglassFlight(e);
    // The bots are dropped outright below; only real players need setting down.
    if (!active.botPids.includes(pid)) landSafely(ctx, e, active.returnTo.get(pid));
  }
  if (active.ball) ctx.dropEntity(active.ball.entityId);
  // Dev build: the bots are ordinary dev-spawn players. Removed FULLY (entity
  // and player meta) — dropEntity alone left the meta behind, which burned the
  // roster names one bout at a time until a "3v3" seated 1v3.
  for (const pid of active.botPids) ctx.removeDevBot(pid);
  active = null;
  // The final whistle: the city event comes back (only if this match's start
  // despawned it; a world with no crowd stays crowdless).
  respawnDeepglassCrowdAfterMatch(ctx);
}

// ---------------------------------------------------------------------------
// Tick
// ---------------------------------------------------------------------------

const CURRENT: Vec3 = { x: 0, y: 0, z: 0 };
/** Scratch for the dash magnet's aim point, rebuilt once a tick. */
const MAGNET: Vec3 = { x: 0, y: 0, z: 0 };
/** Seconds of ball travel the dash magnet aims ahead of. Roughly how long the
 *  impulse takes to cover the last few yards. */
const DG_DASH_MAGNET_LEAD = 0.12;

/** Is this body shepherding the Tidesow right now? Carrying is not a flag
 *  anybody sets — it is simply "the ball is on my chest", which is also what
 *  slows the carrier down (DG_CARRY_MULT). */
function isCarrying(m: DgMatch, e: Entity): boolean {
  const ball = m.ball;
  if (!ball) return false;
  const dx = ball.x - e.pos.x;
  const dy = ball.y - (e.pos.y + DG_BODY_CENTRE_Y);
  const dz = ball.z - e.pos.z;
  const reach = DG_BODY_RADIUS + DG_BALL_RADIUS + 0.6;
  return dx * dx + dy * dy + dz * dz <= reach * reach;
}

function teamOf(m: DgMatch, pid: number): 'A' | 'B' | null {
  if (m.teamA.includes(pid)) return 'A';
  if (m.teamB.includes(pid)) return 'B';
  return null;
}

function resetForKickoff(ctx: SimContext, m: DgMatch): void {
  for (let i = 0; i < m.teamA.length; i++)
    seatBody(ctx, m.teamA[i], DG_SPAWNS_A[i % DG_SPAWNS_A.length]);
  for (let i = 0; i < m.teamB.length; i++)
    seatBody(ctx, m.teamB[i], DG_SPAWNS_B[i % DG_SPAWNS_B.length]);
  if (m.ball) {
    m.ball.x = DG_BALL_KICKOFF.x;
    m.ball.y = DG_BALL_KICKOFF.y;
    m.ball.z = DG_BALL_KICKOFF.z;
    m.ball.vx = 0;
    m.ball.vy = 0;
    m.ball.vz = 0;
    setBallSpin(m.ball, 0, 0, 0);
    m.ball.lastTouchPid = null;
    m.ball.lastTouchTeam = null;
  }
  m.touches.length = 0;
  // Every brain forgets where it thought the ball was: it is on the spot in
  // front of them now, and a stale belief would have half the roster set off for
  // the corner the last goal was scored in.
  for (const brain of m.botBrains.values()) {
    const bel = brain.belief;
    bel.x = DG_BALL_KICKOFF.x;
    bel.y = DG_BALL_KICKOFF.y;
    bel.z = DG_BALL_KICKOFF.z;
    bel.vx = 0;
    bel.vy = 0;
    bel.vz = 0;
    bel.next = 0;
    bel.hold = 0;
    brain.strikeHold = 0;
    brain.windUp = 0;
    brain.stare = 0;
    brain.dashKey = null;
  }
  m.phase = 'countdown';
  m.timer = DG_COUNTDOWN;
}

/**
 * The jump ball: the whistle fires the Tidesow at the crown.
 *
 * A kickoff that left the ball sitting on the spot made the opening of every
 * bout the same race to the same place, won by whoever spawned nearest. Thrown
 * up, it climbs to the top of the bell, scatters off it (ball.ts, the crown
 * cap), and everyone has to READ the drop instead of memorising it. The small
 * lateral kick is what stops it going up and down the same line; both it and
 * the bounce are pure functions of the bout's salt, so a replay is exact.
 */
function throwUpKickoff(m: DgMatch): void {
  const ball = m.ball;
  if (!ball) return;
  // A different lean every bout, and a different one after every goal.
  const a = botNoise(m.salt, m.scoreA + m.scoreB, 91) * Math.PI * 2;
  const lean = DG_KICKOFF_LEAN * botNoise(m.salt, m.scoreA + m.scoreB, 92);
  ball.vx = Math.cos(a) * lean;
  ball.vy = DG_KICKOFF_UP_SPEED;
  ball.vz = Math.sin(a) * lean;
  setBallSpin(ball, 0, 0, 0);
}

/** Sideways kick on the throw-up, yd/s. Small: the ball should go UP, not
 *  across — the lean is only there so it never comes back down its own line. */
const DG_KICKOFF_LEAN = 3.5;

export function updateDeepglass(ctx: SimContext): void {
  // The idle arena's city event: promenade walkers advance, sitters hold
  // their decks. One Map miss and out in any world without the crowd.
  if (!active) updateDeepglassCrowd(ctx);
  const m = active;
  if (!m) return;
  m.tick++;

  // ---- phase machine -----------------------------------------------------
  if (m.phase === 'countdown') {
    m.timer -= DT;
    if (m.timer <= 0) {
      m.phase = 'active';
      throwUpKickoff(m);
    }
  } else if (m.phase === 'active') {
    m.clock += DT;
    if (m.clock >= DG_MATCH_DURATION && !m.overtime) {
      // Level on the whistle: the clock stops mattering and the next goal wins.
      if (m.scoreA === m.scoreB) m.overtime = true;
      else {
        m.phase = 'over';
        m.timer = 8;
      }
    }
  } else if (m.phase === 'goal') {
    m.timer -= DT;
    if (m.timer <= 0) {
      if (m.overtime || m.scoreA >= DG_SCORE_CAP || m.scoreB >= DG_SCORE_CAP) {
        m.phase = 'over';
        m.timer = 8;
      } else {
        resetForKickoff(ctx, m);
      }
    }
  } else if (m.phase === 'over') {
    m.timer -= DT;
    if (m.timer <= 0) {
      endDeepglassMatch(ctx);
      return;
    }
  }

  const playing = m.phase === 'active';

  // ---- pads and powerups -------------------------------------------------
  for (let i = 0; i < m.padCooldown.length; i++) {
    if (m.padCooldown[i] > 0) m.padCooldown[i]--;
  }
  for (let i = 0; i < m.powerupCooldown.length; i++) {
    if (m.powerupCooldown[i] > 0) m.powerupCooldown[i]--;
  }

  // ---- possession --------------------------------------------------------
  if (playing && m.ball?.lastTouchTeam === 'A') m.possessionA++;
  else if (playing && m.ball?.lastTouchTeam === 'B') m.possessionB++;

  // ---- the brains --------------------------------------------------------
  // Roles first, per side, so the whole side agrees on who is going for the ball
  // before any of them commits to a line. Every bot then perceives and flies on
  // its own clock (./bots.ts) — nothing about the roster is synchronised, which
  // is what makes their reactions ragged rather than choral.
  driveBots(m, ctx, playing);

  // ---- bodies ------------------------------------------------------------
  // Where the Tidesow will be in a moment: what a dash thrown near it bends
  // onto (flight.ts DG_DASH_MAGNET_RANGE). LED rather than taken raw, because
  // a dash is an impulse a body then FLIES down — aiming at where the ball is
  // now sends you through the space it just left.
  const magnet = playing && m.ball ? MAGNET : null;
  if (magnet && m.ball) {
    MAGNET.x = m.ball.x + m.ball.vx * DG_DASH_MAGNET_LEAD;
    MAGNET.y = m.ball.y + m.ball.vy * DG_DASH_MAGNET_LEAD;
    MAGNET.z = m.ball.z + m.ball.vz * DG_DASH_MAGNET_LEAD;
  }
  for (const pid of [...m.teamA, ...m.teamB]) {
    const e = ctx.entities.get(pid);
    const meta = ctx.players.get(pid);
    if (!e || !meta || !e.dgFlight) continue;

    // Demolished: no flight, no pads, no powerups; just the respawn clock.
    if ((e.dgDeadTicks ?? 0) > 0) {
      respawnDemolished(ctx, m, e, pid);
      continue;
    }
    const isBot = m.botPids.includes(pid);
    const inp = meta.moveInput;
    currentAt(e.pos.x, e.pos.y, e.pos.z, m.clock, CURRENT);
    const prevX = e.pos.x;
    const prevY = e.pos.y;
    const prevZ = e.pos.z;
    // Kickoff freeze: bodies hold station through the whistle.
    deepglassFlightPass(
      e,
      playing ? inp : EMPTY_INPUT,
      isCarrying(m, e),
      playing ? CURRENT : ZERO,
      isBot ? DG_BOT_SPEED_SCALE : 1,
      magnet,
    );
    e.prevPos = { x: prevX, y: prevY, z: prevZ };
    ctx.rebucket(e);

    if (!playing) continue;

    // Boost vents. A big one fills the tank; the rest top it up.
    for (let i = 0; i < DG_BOOST_PADS.length; i++) {
      if (m.padCooldown[i] > 0) continue;
      const p = DG_BOOST_PADS[i];
      const dx = e.pos.x - p.x;
      const dy = e.pos.y - p.y;
      const dz = e.pos.z - p.z;
      if (dx * dx + dy * dy + dz * dz > DG_PAD_RADIUS * DG_PAD_RADIUS) continue;
      if (refillCharge(e, p.big ? DG_CHARGE_MAX : undefined)) {
        m.padCooldown[i] = p.big ? DG_BIG_PAD_RESPAWN_TICKS : DG_PAD_RESPAWN_TICKS;
      }
    }

    // Powerups. One slot: taking a second one replaces the first.
    for (let i = 0; i < DG_POWERUP_SITES.length; i++) {
      if (m.powerupCooldown[i] > 0) continue;
      const site = DG_POWERUP_SITES[i];
      // A bot leaves the Lance alone. It has no aim routine to spend it with,
      // so it would sit on the orb denying it to a human — and a bot that DID
      // fire it would demolish you with no counterplay, which is the "the bots
      // are too good" complaint coming back wearing a hat. Overburn it takes
      // and uses: that one only ever helps its owner.
      if (isBot && site.kind === 'zap') continue;
      const dx = e.pos.x - site.x;
      const dy = e.pos.y - site.y;
      const dz = e.pos.z - site.z;
      if (dx * dx + dy * dy + dz * dz > DG_POWERUP_RADIUS * DG_POWERUP_RADIUS) continue;
      e.dgPowerup = site.kind;
      m.powerupCooldown[i] = DG_POWERUP_RESPAWN_TICKS;
    }

    // A buffered Shot/Pass fires the moment the ball comes into reach, and
    // quietly expires otherwise. Humans only in practice (bots strike through
    // botStrike), but the gate is the buffer's presence, not who set it.
    const buf = e.dgStrikeBuf;
    if (buf && m.ball) {
      if (withinReach(e, m.ball)) {
        e.dgStrikeBuf = undefined;
        const bufTeam = teamOf(m, pid);
        if (bufTeam) performStrike(ctx, m, e, bufTeam, buf.move, buf.power);
      } else if (--buf.ticks <= 0) {
        e.dgStrikeBuf = undefined;
      }
    }

    // A bot spends its Overburn the moment it wants pace it does not have.
    if (isBot && e.dgPowerup === 'overburn' && (e.dgCharge ?? 0) < 40) {
      e.dgPowerup = undefined;
      e.dgOverburnTicks = DG_POWERUP_OVERBURN_TICKS;
      e.dgCharge = DG_CHARGE_MAX;
    }
  }

  // Fighters are solid to each other, and they are resolved AFTER every body
  // has flown: a pass that moved one body at a time would resolve a pair against
  // half-updated positions and jitter.
  if (playing) resolveBodyBumps(m, ctx);

  // ---- the ball ----------------------------------------------------------
  const ball = m.ball;
  if (!ball) return;
  const ballEntity = ctx.entities.get(ball.entityId);

  if (m.phase === 'goal') {
    settleBallInPocket(ball);
  } else if (playing) {
    if ((m.pinchTicks ?? 0) > 0) m.pinchTicks = (m.pinchTicks ?? 0) - 1;
    const consumed = resolveBallContacts(m, ctx, ball);
    currentAt(ball.x, ball.y, ball.z, m.clock, CURRENT);
    // The crown scatter (only a bounce off the top of the bell reads it), as a
    // pure function of the bout salt and the tick — no rng on this path.
    const scored = stepBallFluid(
      ball,
      CURRENT,
      botSigned(m.salt, m.tick, 93),
      1 - consumed,
      (m.pinchTicks ?? 0) > 0,
    );
    if (scored) {
      if (scored === 'A') m.scoreA++;
      else m.scoreB++;
      m.lastGoalBy = scored;
      creditGoal(m, scored);
      m.phase = 'goal';
      m.timer = DG_GOAL_CELEBRATE;
    }
  }

  if (ballEntity) {
    // No prevPos snapshot here. The tick prologue (runDespawnDecay) already took
    // one, from the position the ball genuinely held last tick, and it is the
    // single owner of that field. Re-taking it HERE reads whatever any pass
    // earlier in this tick happened to leave behind — which is how an immobile
    // mob being ground-snapped by the chase arm turned into the drawn ball
    // strobing between the slate and the bell every frame. Even with that
    // fixed (Sim.moveToward), a late second snapshot is a trap, not a safeguard.
    ballEntity.pos.x = ball.x;
    ballEntity.pos.y = ball.y;
    ballEntity.pos.z = ball.z;
    ctx.rebucket(ballEntity);
  }
}

// ---------------------------------------------------------------------------
// Contact resolution. Scratch records, reused every tick — this runs 20 times a
// second over every body in the bell.
// ---------------------------------------------------------------------------
const BALL_FROM: Vec3 = { x: 0, y: 0, z: 0 };
const BALL_TO: Vec3 = { x: 0, y: 0, z: 0 };
const BODY: DgContactBody = {
  prev: { x: 0, y: 0, z: 0 },
  cur: { x: 0, y: 0, z: 0 },
  vel: { x: 0, y: 0, z: 0 },
};
const HIT: DgContactBody = {
  prev: { x: 0, y: 0, z: 0 },
  cur: { x: 0, y: 0, z: 0 },
  vel: { x: 0, y: 0, z: 0 },
};

/**
 * Find the FIRST body the ball meets over this tick's travel and resolve that
 * one contact.
 *
 * Two deliberate choices. The segment swept is the ball's straight travel for
 * the coming tick (the accelerations that {@link stepBallFluid} adds are tenths
 * of a yard per second against yards of travel, so the straight line is the
 * right thing to test). And only the EARLIEST contact is resolved: a ball can
 * only be played by one fighter at a time, and resolving a pile-up in seat
 * order used to let a body behind the ball overwrite the touch of the body that
 * actually met it.
 */
function resolveBallContacts(m: DgMatch, ctx: SimContext, ball: DgBall): number {
  BALL_FROM.x = ball.x;
  BALL_FROM.y = ball.y;
  BALL_FROM.z = ball.z;
  BALL_TO.x = ball.x + ball.vx * DT;
  BALL_TO.y = ball.y + ball.vy * DT;
  BALL_TO.z = ball.z + ball.vz * DT;

  const reach = DG_BODY_RADIUS + DG_BALL_RADIUS;
  let bestT = Infinity;
  let bestPid = -1;
  let bestDash = false;
  for (const pid of [...m.teamA, ...m.teamB]) {
    const e = ctx.entities.get(pid);
    if (!dgAlive(e)) continue;
    BODY.prev.x = e.prevPos.x;
    BODY.prev.y = e.prevPos.y + DG_BODY_CENTRE_Y;
    BODY.prev.z = e.prevPos.z;
    BODY.cur.x = e.pos.x;
    BODY.cur.y = e.pos.y + DG_BODY_CENTRE_Y;
    BODY.cur.z = e.pos.z;
    BODY.vel.x = e.vx;
    BODY.vel.y = e.vy;
    BODY.vel.z = e.vz;
    const t = sweptContactTime(BALL_FROM, BALL_TO, BODY, reach);
    if (t < 0 || t >= bestT) continue;
    bestT = t;
    bestPid = pid;
    bestDash = (e.dgDashTicks ?? 0) > 0;
    HIT.prev.x = BODY.prev.x;
    HIT.prev.y = BODY.prev.y;
    HIT.prev.z = BODY.prev.z;
    HIT.cur.x = BODY.cur.x;
    HIT.cur.y = BODY.cur.y;
    HIT.cur.z = BODY.cur.z;
    HIT.vel.x = BODY.vel.x;
    HIT.vel.y = BODY.vel.y;
    HIT.vel.z = BODY.vel.z;
  }
  if (bestPid < 0) return 0;

  // Walk the ball to where it actually met the body before resolving, so a
  // struck ball leaves from the fighter rather than from wherever the tick
  // would have carried it.
  ball.x += ball.vx * DT * bestT;
  ball.y += ball.vy * DT * bestT;
  ball.z += ball.vz * DT * bestT;
  applyBodyContact(ball, HIT, bestDash);
  // A bank off the glass within a breath of this contact is a WALL PINCH:
  // the squeeze pumps the ball (ball.ts DG_PINCH_RESTITUTION).
  m.pinchTicks = 2;
  const team = teamOf(m, bestPid);
  if (team) recordTouch(m, bestPid, team, 'body');
  // How much of the tick this contact consumed: the caller integrates only
  // what is left, so a struck ball does not cover two ticks of ground in one.
  return bestT;
}

const EMPTY_INPUT: MoveInput = {
  forward: false,
  back: false,
  turnLeft: false,
  turnRight: false,
  strafeLeft: false,
  strafeRight: false,
  jump: false,
  dive: false,
  surface: false,
};
const ZERO: Vec3 = { x: 0, y: 0, z: 0 };

// ---------------------------------------------------------------------------
// Bots. The brains live in ./bots.ts — belief, temperament, roles, mistakes —
// and everything here is the plumbing that hands them a view of the bell and
// takes their strikes back. Nothing on this path uses rng: the brains are pure
// in (pid, salt, tick), so a bout still replays to the tick.
// ---------------------------------------------------------------------------

/** Scratch for the view handed to the brains, rebuilt in place each side each
 *  tick. The roster is small and this runs 20 times a second; the arrays and the
 *  view are reused so a bout allocates nothing per tick. */
const MATES: Entity[] = [];
const FOES: Entity[] = [];
const LIT: DgBoostPad[] = [];
const SWIPE: Vec3 = { x: 0, y: 0, z: 0 };

// The strike callback must be a STABLE function (a fresh closure per tick would
// be an allocation on the hot path and a new shape for the view every time), so
// the match it needs is parked here for the duration of the sweep.
let strikeMatch: DgMatch | null = null;

const BOT_VIEW: DgBotView = {
  tick: 0,
  salt: 0,
  ball: { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, lastTouchTeam: null, lastTouchPid: null },
  team: 'A',
  mates: MATES,
  foes: FOES,
  keeperPid: -1,
  ownRing: { x: 0, y: 0, z: 0 },
  foeRing: { x: 0, y: 0, z: 0 },
  litPads: LIT,
  strike: (e, aim, power) => {
    if (strikeMatch) botStrike(strikeMatch, e, aim, power);
  },
};

/**
 * Which pid keeps goal on a side.
 *
 * A side of two or more posts a keeper, and it posts its STEADIEST bot
 * (keeperFitness) rather than whoever happens to sit in the last seat. Only bots
 * are eligible: a human came here to fly at the ball, not to be volunteered into
 * goal. Stable for the whole bout, because the temperaments it reads are.
 */
function keeperPidFor(m: DgMatch, roster: number[]): number {
  if (roster.length < DG_KEEPER_MIN_SIDE) return -1;
  let best = -1;
  let bestFit = -Infinity;
  for (const pid of roster) {
    const brain = m.botBrains.get(pid);
    if (!brain) continue;
    const fit = keeperFitness(brain.traits);
    if (fit > bestFit) {
      bestFit = fit;
      best = pid;
    }
  }
  return best;
}

function clearInput(inp: MoveInput): void {
  inp.forward = false;
  inp.back = false;
  inp.strafeLeft = false;
  inp.strafeRight = false;
  inp.turnLeft = false;
  inp.turnRight = false;
  inp.jump = false;
  inp.dive = false;
  inp.surface = false;
  inp.boost = false;
}

/**
 * Drive every bot on both sides for one tick.
 *
 * Roles are settled for a whole side before any of that side flies, so the
 * fighters agree on who is going for the ball; each of them then perceives and
 * decides on its own clock, which is what stops the roster reacting in unison.
 */
function driveBots(m: DgMatch, ctx: SimContext, playing: boolean): void {
  if (m.botPids.length === 0) return;
  if (!playing || !m.ball) {
    for (const pid of m.botPids) {
      const meta = ctx.players.get(pid);
      if (meta) clearInput(meta.moveInput);
    }
    return;
  }
  const ball = m.ball;
  strikeMatch = m;
  BOT_VIEW.tick = m.tick;
  BOT_VIEW.salt = m.salt;
  BOT_VIEW.ball = ball;
  LIT.length = 0;
  for (let i = 0; i < DG_BOOST_PADS.length; i++) {
    if (m.padCooldown[i] <= 0) LIT.push(DG_BOOST_PADS[i]);
  }

  for (const team of ['A', 'B'] as const) {
    const roster = team === 'A' ? m.teamA : m.teamB;
    const others = team === 'A' ? m.teamB : m.teamA;
    MATES.length = 0;
    FOES.length = 0;
    for (const pid of roster) {
      const e = ctx.entities.get(pid);
      if (dgAlive(e)) MATES.push(e);
    }
    for (const pid of others) {
      const e = ctx.entities.get(pid);
      if (dgAlive(e)) FOES.push(e);
    }
    if (MATES.length === 0) continue;
    BOT_VIEW.team = team;
    BOT_VIEW.keeperPid = keeperPidFor(m, roster);
    BOT_VIEW.ownRing = ringCentreFor(team);
    BOT_VIEW.foeRing = targetRingFor(team);
    assignBotRoles(BOT_VIEW, m.botBrains, ball.lastTouchTeam === team);
    for (const e of MATES) {
      const brain = m.botBrains.get(e.id);
      const meta = ctx.players.get(e.id);
      if (!brain || !meta) continue;
      driveBot(BOT_VIEW, brain, e, meta.moveInput, playing);
    }
  }
  strikeMatch = null;
}

/**
 * Resolve a strike a bot has already committed to.
 *
 * The reach test here is against the REAL ball, and it is the whole point: the
 * brain decided to swing because its BELIEF said the ball was in front of it. If
 * the ball has moved on, the swing hits water and the strike cooldown is spent
 * anyway — a whiff, exactly like a player's mistimed Shot, and the most legible
 * mistake in the roster's repertoire.
 */
function botStrike(m: DgMatch, e: Entity, aim: Vec3, power: number): void {
  const ball = m.ball;
  if (!ball || m.phase !== 'active') return;
  const team = teamOf(m, e.id);
  if (!team) return;
  const d = Math.hypot(ball.x - e.pos.x, ball.y - (e.pos.y + DG_BODY_CENTRE_Y), ball.z - e.pos.z);
  m.stats.strikes++;
  if (d > DG_PLAY_RADIUS + DG_BALL_RADIUS) {
    m.stats.whiffs++;
    return; // swung at water
  }
  // A bot's own motion across the shot line curls the ball, exactly as a
  // player's does — so a fighter cutting across a clearance bends it, and the
  // keeper on the far end is reading a straight line (./bots.ts).
  SWIPE.x = e.vx;
  SWIPE.y = e.vy;
  SWIPE.z = e.vz;
  launchBall(ball, aim, power, SWIPE);
  recordTouch(m, e.id, team, 'strike');
}

// ---------------------------------------------------------------------------
// Touches, assists and own goals
// ---------------------------------------------------------------------------

/** How long a touch stays live as a potential assist. */
const DG_ASSIST_TICKS = Math.round(6 / DT);
const DG_TOUCH_LOG = 6;

/** Record who last played the ball. The log is what the goal credit reads. */
function recordTouch(m: DgMatch, pid: number, team: 'A' | 'B', kind: DgTouchKind): void {
  const ball = m.ball;
  if (!ball) return;
  ball.lastTouchPid = pid;
  ball.lastTouchTeam = team;
  const head = m.touches[0];
  if (head && head.pid === pid && head.kind === kind) {
    head.tick = m.tick; // a run of touches by one carrier is one touch
    return;
  }
  m.touches.unshift({ pid, team, tick: m.tick, kind });
  if (m.touches.length > DG_TOUCH_LOG) m.touches.length = DG_TOUCH_LOG;
}

/**
 * Work out who gets the goal.
 *
 * The last toucher scores it; if they were on the other side it is an own goal
 * and it is called one. An assist is the previous DIFFERENT touch by the scoring
 * side, and only if no opponent touched the ball in between — a ball won off a
 * defender is not that defender's assist.
 */
function creditGoal(m: DgMatch, scored: 'A' | 'B'): void {
  const last = m.touches[0];
  m.lastGoalScorer = last ? last.pid : null;
  m.lastGoalOwn = last !== undefined && last.team !== scored;
  if (m.lastGoalOwn) m.stats.ownGoals++;
  if (last?.kind === 'strike') m.stats.goalsStruck++;
  else m.stats.goalsScrambled++;
  m.lastGoalAssist = null;
  if (!last || m.lastGoalOwn) return;
  for (let i = 1; i < m.touches.length; i++) {
    const t = m.touches[i];
    if (t.team !== scored) break;
    if (t.pid !== last.pid && m.tick - t.tick <= DG_ASSIST_TICKS) {
      m.lastGoalAssist = t.pid;
      break;
    }
  }
}

// ---------------------------------------------------------------------------
// Body contact between fighters
// ---------------------------------------------------------------------------

/** How much of the closing speed a bump gives back. Low: bodies in water thud
 *  rather than ping. */
const DG_BUMP_RESTITUTION = 0.4;
/** Closing speed above which a bump spins the slower body out for a beat. A
 *  fighter flying through a pack at boost pace SHOULD scatter it. */
const DG_BUMP_TUMBLE_SPEED = 20;
const DG_BUMP_TUMBLE_TICKS = Math.round(0.45 / DT);

/**
 * Fighters are solid to each other.
 *
 * They were not, and it was the strangest thing in the bell: six bodies would
 * converge on the Tidesow and simply occupy the same yard of water, so a pack
 * had no shape, screening was impossible, and flying through an opponent cost
 * nothing. Equal masses, one impulse along the contact normal, and the overlap
 * split between them — the cheapest possible model, and the difference between a
 * crowd and a hologram.
 */
function resolveBodyBumps(m: DgMatch, ctx: SimContext): void {
  BODIES.length = 0;
  for (const pid of m.teamA) {
    const e = ctx.entities.get(pid);
    if (dgAlive(e)) BODIES.push(e);
  }
  for (const pid of m.teamB) {
    const e = ctx.entities.get(pid);
    if (dgAlive(e)) BODIES.push(e);
  }
  const reach = DG_BODY_RADIUS * 2;
  for (let i = 0; i < BODIES.length; i++) {
    const a = BODIES[i];
    for (let j = i + 1; j < BODIES.length; j++) {
      const b = BODIES[j];
      let nx = b.pos.x - a.pos.x;
      let ny = b.pos.y - a.pos.y;
      let nz = b.pos.z - a.pos.z;
      const d = Math.hypot(nx, ny, nz);
      if (d >= reach) continue;
      m.stats.bumps++;
      if (d < 1e-4) {
        // Exactly coincident: shove them apart along the bell's own vertical so
        // the pair can never share a point and stay there.
        nx = 0;
        ny = 1;
        nz = 0;
      } else {
        nx /= d;
        ny /= d;
        nz /= d;
      }
      // Split the overlap.
      const push = (reach - d) * 0.5;
      a.pos.x -= nx * push;
      a.pos.y -= ny * push;
      a.pos.z -= nz * push;
      b.pos.x += nx * push;
      b.pos.y += ny * push;
      b.pos.z += nz * push;
      clampToBell(a.pos);
      clampToBell(b.pos);
      // Equal-mass impulse along the normal, only while closing.
      const rel = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny + (b.vz - a.vz) * nz;
      if (rel < 0) {
        const jj = (-(1 + DG_BUMP_RESTITUTION) * rel) / 2;
        a.vx -= jj * nx;
        a.vy -= jj * ny;
        a.vz -= jj * nz;
        b.vx += jj * nx;
        b.vy += jj * ny;
        b.vz += jj * nz;
        if (-rel > DG_BUMP_TUMBLE_SPEED) {
          // The slower body is the one that gets spun out.
          const sa = Math.hypot(a.vx, a.vy, a.vz);
          const sb = Math.hypot(b.vx, b.vy, b.vz);
          const loser = sa < sb ? a : b;
          loser.dgTumbleTicks = Math.max(loser.dgTumbleTicks ?? 0, DG_BUMP_TUMBLE_TICKS);
          m.stats.tumbles++;
        }
      }
      ctx.rebucket(a);
      ctx.rebucket(b);
    }
  }
}

const BODIES: Entity[] = [];

// ---------------------------------------------------------------------------
// Player moves. Reached from the ONE 'deepball' effect arm in
// combat/effect_dispatch.ts; each no-ops silently outside a live bout, so the
// abilities are harmless if they ever leak onto a bar somewhere else.
// ---------------------------------------------------------------------------

/** How far from the ball a player move still connects. Deliberately more
 *  generous than the bots' strike range: a chibi third-person camera has none
 *  of the precision a mouse-aimed shooter does, and whiffing a 2.4 yd ball you
 *  are flying past at 30 yd/s is not interesting, it is just annoying. */
export const DG_PLAYER_REACH = 6.4;
/** How long a mistimed Shot/Pass stays live waiting for the ball to arrive
 *  (Entity.dgStrikeBuf). The other half of hit reg: at closing speeds of
 *  30+ yd/s, "pressed it a third of a second early" and "hit it" should be
 *  the same thing. */
export const DG_STRIKE_BUFFER_TICKS = Math.round(0.35 / DT);
/** Fraction of a Shot's aim pulled toward the enemy ring when the ring is
 *  roughly ahead. Not auto-aim: at 0.3 you still miss a bad line, but a good
 *  line is rewarded rather than lost to camera slop. */
const DG_SHOT_ASSIST = 0.3;
/** How much of the striker's own pace a strike carries onto the ball. */
const DG_SPEED_INTO_SHOT = 0.32;
const DG_OVERBURN_TICKS = Math.round(4 / DT);
const DG_TUMBLE_TICKS = Math.round(1 / DT);
export const DG_CHECK_MIN_SPEED = 14; // yd/s the checker must be doing
const DG_CHECK_KNOCK = 26; // yd/s the checked body is thrown at
/** How far a Check reaches. The old requiresTarget click supplied the range
 *  check through the ability's `range: 7`; auto-targeting owns it now. */
export const DG_CHECK_RANGE = 9;

/** The closest opposing fighter still in the bell, or null. The one auto-aim
 *  primitive both attacks (Check, and the Lance's fallback) share. */
function nearestEnemy(ctx: SimContext, m: DgMatch, caster: Entity, team: 'A' | 'B'): Entity | null {
  let best: Entity | null = null;
  let bestD2 = Infinity;
  for (const pid of team === 'A' ? m.teamB : m.teamA) {
    const o = ctx.entities.get(pid);
    if (!dgAlive(o)) continue;
    const dx = o.pos.x - caster.pos.x;
    const dy = o.pos.y - caster.pos.y;
    const dz = o.pos.z - caster.pos.z;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 < bestD2) {
      bestD2 = d2;
      best = o;
    }
  }
  return best;
}

/**
 * The direction a body is aiming: its yaw, pitched by the camera — the same
 * vector the flight pass thrusts along, so you shoot where you fly.
 *
 * Continuous now. It used to read the latched dive/surface BANDS, so a shot could
 * only ever leave at one of three pitches (-0.85, 0, +0.85 in y) no matter where
 * the player was actually looking; lifting a ball into a ring above you was not
 * a thing you could aim, only a thing that happened. The pitch comes off
 * `dgAimPitch`, which the flight pass resolved from this same frame's camera, so
 * the aim and the thrust cannot disagree.
 */
function aimOf(ctx: SimContext, e: Entity, out: Vec3): void {
  const inp = ctx.players.get(e.id)?.moveInput;
  const pitch = inp ? aimPitchOf(inp) : (e.dgAimPitch ?? 0);
  lookDirection(e.facing, pitch, out);
}

const AIM: Vec3 = { x: 0, y: 0, z: 0 };

// ---------------------------------------------------------------------------
// The Tidewarden's Lance: the Zap Shot off the bell's floor.
// ---------------------------------------------------------------------------

/** Seconds a zapped body stays demolished before it respawns at its own goal
 *  (Rocket League's demo timer). */
export const DG_RESPAWN_SECONDS = 3;
const DG_RESPAWN_TICKS = Math.round(DG_RESPAWN_SECONDS / DT);
/** Charge a respawned body comes back with: a third of a tank, like a car
 *  respawning with 33 boost. */
export const DG_RESPAWN_CHARGE = 34;

/** Alive and in the bell: the filter every roster loop uses, so a demolished
 *  body is out of every play (no ball contact, no target, no mate) until it
 *  respawns. */
export function dgAlive(e: Entity | undefined): e is Entity {
  return e !== undefined && e.dgFlight === true && (e.dgDeadTicks ?? 0) <= 0;
}
/** How far the beam carries, and how forgiving its cone is. Hitscan rather
 *  than a projectile: a travelling bolt across 76 yards of water would be
 *  dodged by accident more often than on purpose. */
export const DG_BEAM_RANGE = 42;
/** Cosine of the half-angle the beam accepts. ~14 degrees: you have to be
 *  pointing at them, but not to the pixel. */
const DG_BEAM_COS = 0.97;
/** Overburn from the crown orb runs longer than the old bar ability's 4s. */
const DG_POWERUP_OVERBURN_TICKS = Math.round(10 / DT);

/** The last beam fired, for the render to draw. Cleared once drawn. */
export interface DgBeamShot {
  from: Vec3;
  to: Vec3;
  hit: boolean;
  /** The demolished body, when it hit (the render blows it up there). */
  victimId?: number;
  /** Match tick it was fired on, so a stale shot is never redrawn. */
  tick: number;
}
let lastBeam: DgBeamShot | null = null;

/** The most recent beam, or null. Render-only; never read by the sim. */
export function deepglassLastBeam(): DgBeamShot | null {
  return lastBeam;
}

/** Forget the last beam. Called on every kickoff and teardown: the record is a
 *  module singleton keyed by MATCH tick, and a match starts its tick count over
 *  at zero — so a shot left over from the previous bout would flash across the
 *  bell the moment the next one started. */
function clearLastBeam(): void {
  lastBeam = null;
}

/**
 * Fire the Zap Shot down the caster's aim. The first OPPONENT inside the cone
 * and in range takes it and is DEMOLISHED (see demolish); a clean miss still
 * draws its beam out to full range, because a shot that leaves no mark reads
 * as the button not working.
 */
function fireZapShot(ctx: SimContext, m: DgMatch, caster: Entity, team: 'A' | 'B'): boolean {
  aimOf(ctx, caster, AIM);
  const al = Math.hypot(AIM.x, AIM.y, AIM.z) || 1;
  const ax = AIM.x / al;
  const ay = AIM.y / al;
  const az = AIM.z / al;
  const ox = caster.pos.x;
  const oy = caster.pos.y + DG_BODY_CENTRE_Y;
  const oz = caster.pos.z;

  let best: Entity | null = null;
  let bestD = Infinity;
  for (const pid of [...m.teamA, ...m.teamB]) {
    if (pid === caster.id) continue;
    const o = ctx.entities.get(pid);
    if (!dgAlive(o) || teamOf(m, pid) === team) continue;
    const dx = o.pos.x - ox;
    const dy = o.pos.y + DG_BODY_CENTRE_Y - oy;
    const dz = o.pos.z - oz;
    const d = Math.hypot(dx, dy, dz);
    if (d < 1e-3 || d > DG_BEAM_RANGE || d >= bestD) continue;
    if ((dx * ax + dy * ay + dz * az) / d < DG_BEAM_COS) continue;
    bestD = d;
    best = o;
  }
  // Nobody in the cone: the Lance snaps to the CLOSEST opponent in range
  // instead of burning the orb on water. Same auto-target contract as the
  // Check — the aim cone is a bonus for pointing well, not a tax for not.
  if (!best) {
    const near = nearestEnemy(ctx, m, caster, team);
    if (near) {
      const d = Math.hypot(near.pos.x - ox, near.pos.y + DG_BODY_CENTRE_Y - oy, near.pos.z - oz);
      if (d <= DG_BEAM_RANGE && d > 1e-3) {
        best = near;
        bestD = d;
      }
    }
  }

  const to =
    best !== null
      ? {
          x: best.pos.x,
          y: best.pos.y + DG_BODY_CENTRE_Y,
          z: best.pos.z,
        }
      : { x: ox + ax * DG_BEAM_RANGE, y: oy + ay * DG_BEAM_RANGE, z: oz + az * DG_BEAM_RANGE };
  lastBeam = {
    from: { x: ox, y: oy, z: oz },
    to,
    hit: best !== null,
    victimId: best?.id,
    tick: m.tick,
  };
  if (!best) return false;
  demolish(best, caster.id);
  return true;
}

/** Blow a body up. It drops out of play on the spot (dgAlive is false, so no
 *  loop touches it and the renderer hides it), keeps its seat in the roster,
 *  and respawns by its own goal when the timer runs out (respawnDemolished).
 *  A carried ball is simply left where it was: the body stops existing for the
 *  contact pass, so the Tidesow floats free from the next tick. */
function demolish(victim: Entity, byPid: number): void {
  victim.dgDeadTicks = DG_RESPAWN_TICKS;
  victim.dgZappedBy = byPid;
  victim.vx = 0;
  victim.vy = 0;
  victim.vz = 0;
  victim.dgBoosting = false;
  victim.dgDashTicks = 0;
  victim.dgStrikeBuf = undefined;
}

/** Count a demolished body down, and seat it back by its goal on zero. */
function respawnDemolished(ctx: SimContext, m: DgMatch, e: Entity, pid: number): void {
  const left = (e.dgDeadTicks ?? 0) - 1;
  if (left > 0) {
    e.dgDeadTicks = left;
    e.prevPos = { ...e.pos };
    return;
  }
  e.dgDeadTicks = undefined;
  const seat = teamOf(m, pid) === 'B' ? DG_RESPAWN_B : DG_RESPAWN_A;
  seatBody(ctx, pid, seat);
  e.dgCharge = DG_RESPAWN_CHARGE;
  e.dgDashCd = 0;
}

/** True when the caster is close enough to play the ball. Measured from the
 *  CHEST, not the entity origin at the soles — a ball level with your eyeline
 *  used to read as a yard further away than it looked. */
function withinReach(e: Entity, ball: DgBall): boolean {
  const d = Math.hypot(ball.x - e.pos.x, ball.y - (e.pos.y + DG_BODY_CENTRE_Y), ball.z - e.pos.z);
  return d <= DG_PLAYER_REACH + DG_BALL_RADIUS;
}

/**
 * Every deepball ability, behind one entry point. Returns a short outcome tag
 * so a caller can surface feedback ('volley' is the one worth shouting about).
 */
export function deepballMove(
  ctx: SimContext,
  caster: Entity,
  move: 'shot' | 'pass' | 'check' | 'overburn' | 'power',
  target: Entity | null,
  power?: number,
): 'ok' | 'volley' | 'miss' | 'slow' | 'empty' | 'zap' | null {
  const m = active;
  // A demolished body has no moves until it respawns.
  if (!m || !dgAlive(caster)) return null;
  const team = teamOf(m, caster.id);
  if (!team) return null;

  if (move === 'overburn') {
    caster.dgOverburnTicks = DG_OVERBURN_TICKS;
    caster.dgCharge = DG_CHARGE_MAX;
    return 'ok';
  }

  // The carried powerup, spent. ONE bar button for both: which one fires is
  // whichever orb you went and fetched, so the interesting decision is made out
  // on the map rather than on the hotbar.
  if (move === 'power') {
    const held = caster.dgPowerup;
    if (!held) return 'empty';
    caster.dgPowerup = undefined;
    if (held === 'overburn') {
      caster.dgOverburnTicks = DG_POWERUP_OVERBURN_TICKS;
      caster.dgCharge = DG_CHARGE_MAX;
      return 'ok';
    }
    return fireZapShot(ctx, m, caster, team) ? 'zap' : 'miss';
  }

  if (move === 'check') {
    // Auto-targeted: the victim is always the CLOSEST opponent, whatever the
    // click-target happens to be — in a 3-axis scrum at 26 yd/s, selecting a
    // body by hand is not a skill, it is a lottery. The passed `target` is
    // deliberately ignored.
    void target;
    const victim = nearestEnemy(ctx, m, caster, team);
    if (!victim) return 'miss';
    const dx = victim.pos.x - caster.pos.x;
    const dy = victim.pos.y - caster.pos.y;
    const dz = victim.pos.z - caster.pos.z;
    const d = Math.hypot(dx, dy, dz) || 1;
    if (d > DG_CHECK_RANGE) return 'miss';
    const speed = Math.hypot(caster.vx, caster.vy, caster.vz);
    // The gate is the whole point: a check costs a burn, so a drifting body
    // cannot spam it.
    if (speed < DG_CHECK_MIN_SPEED) return 'slow';
    victim.vx = (dx / d) * DG_CHECK_KNOCK;
    victim.vy = (dy / d) * DG_CHECK_KNOCK;
    victim.vz = (dz / d) * DG_CHECK_KNOCK;
    victim.dgTumbleTicks = DG_TUMBLE_TICKS;
    return 'ok';
  }

  // shot / pass both strike the ball, and both need to be on it. A press with
  // the ball still inbound is BUFFERED rather than thrown away: the tick loop
  // fires it the moment the ball is in reach (hit reg, half two — see
  // DG_STRIKE_BUFFER_TICKS).
  const ball = m.ball;
  if (!ball || m.phase !== 'active') return null;
  if (!withinReach(caster, ball)) {
    caster.dgStrikeBuf = { move, power: power ?? 40, ticks: DG_STRIKE_BUFFER_TICKS };
    return 'miss';
  }
  caster.dgStrikeBuf = undefined;
  return performStrike(ctx, m, caster, team, move, power ?? 40);
}

/**
 * Execute a Shot or Pass NOW (the caster is already within reach of the ball).
 * Shared by the direct cast and the strike buffer so the two cannot drift.
 */
function performStrike(
  ctx: SimContext,
  m: DgMatch,
  caster: Entity,
  team: 'A' | 'B',
  move: 'shot' | 'pass',
  power: number,
): 'ok' | 'volley' {
  const ball = m.ball;
  if (!ball) return 'ok';
  aimOf(ctx, caster, AIM);
  if (move === 'pass') {
    // Feed the most advanced teammate, leading their run.
    const mates = team === 'A' ? m.teamA : m.teamB;
    let best: Entity | null = null;
    let bestAdv = -Infinity;
    for (const pid of mates) {
      if (pid === caster.id) continue;
      const o = ctx.entities.get(pid);
      if (!dgAlive(o)) continue;
      const adv = team === 'A' ? o.pos.x : -o.pos.x;
      if (adv > bestAdv) {
        bestAdv = adv;
        best = o;
      }
    }
    if (best) {
      const lead = 0.35; // seconds of the receiver's run to aim ahead of
      AIM.x = best.pos.x + best.vx * lead - ball.x;
      AIM.y = best.pos.y + best.vy * lead - ball.y;
      AIM.z = best.pos.z + best.vz * lead - ball.z;
    }
  } else {
    // Shot: blend the player's line toward the ring, but only when the ring is
    // already roughly where they are pointing.
    const ring = targetRingFor(team);
    const rx = ring.x - ball.x;
    const ry = ring.y - ball.y;
    const rz = ring.z - ball.z;
    const rl = Math.hypot(rx, ry, rz) || 1;
    const al = Math.hypot(AIM.x, AIM.y, AIM.z) || 1;
    const dot = (AIM.x * rx + AIM.y * ry + AIM.z * rz) / (al * rl);
    if (dot > 0.55) {
      AIM.x = AIM.x / al + (rx / rl) * DG_SHOT_ASSIST;
      AIM.y = AIM.y / al + (ry / rl) * DG_SHOT_ASSIST;
      AIM.z = AIM.z / al + (rz / rl) * DG_SHOT_ASSIST;
    }
  }

  // Pace on the ball is pace you brought. A shot struck by a body flying at the
  // ball carries a slice of that speed, so the reward for a good run at it is a
  // harder shot — which is the loop the whole sport is built on, and it used to
  // pay exactly the same as tapping it from a standstill.
  SWIPE.x = caster.vx;
  SWIPE.y = caster.vy;
  SWIPE.z = caster.vz;
  const carried = Math.hypot(caster.vx, caster.vy, caster.vz) * DG_SPEED_INTO_SHOT;
  m.stats.strikes++;
  const volley = launchBall(ball, AIM, power + (move === 'pass' ? carried * 0.5 : carried), SWIPE);
  recordTouch(m, caster.id, team, 'strike');
  return volley ? 'volley' : 'ok';
}
