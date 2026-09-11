// The deepball fighters: nine of them, none of them the same, and every one of
// them wrong about something.
//
// The first roster was a tracker. It read the ball's true position and velocity
// every single tick, aimed at the enemy ring with a wobble, and struck the
// instant the ball was in range. It never lost a ball it had decided to chase,
// never went the wrong way, never had to look for the ball at all, and the tell
// was not that it was too good, because a handicap on the body fixed that in a
// line. The tell was that it was never SURPRISED. A deflection off a shoulder
// re-aimed the whole roster on the same tick, and there is no human in that.
//
// So the brain in this module never reads the ball. It reads its own BELIEF
// about the ball (see {@link DgBotBelief}), refreshed on a glance every few
// ticks and dead-reckoned forward in between, which is what a player looking at
// a 2.4-yard ball across 76 yards of water is actually doing. Every mistake
// worth having falls out of that one decision:
//
//   - a ball that changes direction between glances leaves the bot committed to
//     where it thought the ball was going, and it has to turn around;
//   - a curling shot bends off the believed straight line, so keepers get beaten
//     by curve without a single line of code about curve;
//   - a bot can strike at a ball that is no longer there and whiff outright;
//   - the roster reacts in a ragged stagger, because no two bots glance on the
//     same tick.
//
// On top of that each fighter has a fixed temperament ({@link DgBotTraits}), // touch, nerve, greed, discipline, flair, so the same situation gets a different
// answer from Hask than from Mira, and the answers stay consistent all bout.
//
// Determinism, as everywhere in deepball: no rng. Every "random" choice is a
// hash of (pid, salt, tick, channel), so a bout replays to the tick.

import { DT, type Entity, type MoveInput } from '../types';
import { DG_BALL_BUOYANCY, DG_BALL_RADIUS, DG_BODY_CENTRE_Y, DG_BODY_RADIUS } from './ball';
import { DG_DASH_COST } from './flight';
import { clampToBell, DEEPGLASS_CENTER, type DgBoostPad, type Vec3 } from './layout';

// ---------------------------------------------------------------------------
// Deterministic noise. Two channels of the same hash the vale_cup bots use, one
// signed and one unrolled: a bot needs "how much" and "did it happen" and using
// the same draw for both correlates them into a tell.
// ---------------------------------------------------------------------------

/** 0..1, pure in its arguments. */
export function botNoise(a: number, b: number, c: number, d = 0): number {
  const h = Math.sin(a * 12.9898 + b * 78.233 + c * 37.719 + d * 4.1414) * 43758.5453;
  return h - Math.floor(h);
}

/** -1..1, pure in its arguments. */
export function botSigned(a: number, b: number, c: number, d = 0): number {
  return botNoise(a, b, c, d) * 2 - 1;
}

// ---------------------------------------------------------------------------
// Temperament
// ---------------------------------------------------------------------------

/**
 * A fighter's fixed temperament, drawn once at kickoff.
 *
 * Every field is 0..1 and every one of them is allowed to be BAD: a roster where
 * the worst bot is merely average plays like a roster of one bot. The spread is
 * deliberately wide, and the names in DG_BOT_NAMES are seated in a fixed order,
 * so "Onn is a hothead who cannot pass" stays true for the whole bout and a
 * player can learn it.
 */
export interface DgBotTraits {
  /** Touch: aim, timing, and how cleanly a strike comes off. */
  skill: number;
  /** How often they look at the ball. Derived from skill, kept separate because
   *  a sharp player with a slow head is a real kind of player. */
  vision: number;
  /** Eagerness to leave a lane and contest. High = out of position often. */
  aggression: number;
  /** Boost economy. High = keeps a reserve; low = flies the tank dry. */
  discipline: number;
  /** Nerve under pressure near their own ring. Low = hoofs it anywhere. */
  composure: number;
  /** Taste for the spectacular: dashes, curlers, shots from distance. */
  flair: number;
}

/**
 * How well suited a temperament is to keeping goal. Higher is better.
 *
 * A side PICKS its keeper rather than posting whoever happens to sit in the last
 * seat, which is what the first pass did, and with temperaments in play that
 * meant a bout could open with a fearless 0.2-touch hothead in goal and be
 * effectively over. Sides field their steadiest, and the bout stops swinging on
 * a coin flip nobody saw.
 */
export function keeperFitness(t: DgBotTraits): number {
  return t.composure * 1.4 + t.skill * 1.1 + (1 - t.aggression) * 0.9 + t.vision * 0.6;
}

export function botTraits(pid: number, salt: number): DgBotTraits {
  const n = (ch: number) => botNoise(pid + 1, salt + 1, ch);
  // Skill is pulled toward the middle (average of two draws) so the roster has
  // few outliers at either end; the rest are flat, because a flat draw is what
  // produces the odd fighter who is fearless and useless.
  const skill = (n(1) + n(2)) / 2;
  return {
    skill,
    vision: 0.25 + 0.75 * ((skill + n(3)) / 2),
    aggression: n(4),
    discipline: n(5),
    composure: 0.2 + 0.8 * n(6),
    flair: n(7),
  };
}

// ---------------------------------------------------------------------------
// Belief
// ---------------------------------------------------------------------------

/**
 * What a bot thinks the ball is doing.
 *
 * Refreshed on a glance and dead-reckoned in between. `hold` is the commitment
 * window: after a misread a bot does not simply re-look next tick and correct
 * itself, because a player who has decided the ball is going left spends the
 * best part of a second going left.
 */
export interface DgBotBelief {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** Ticks until the next glance. */
  next: number;
  /** Ticks of forced commitment to this reading, right or wrong. */
  hold: number;
  /** This reading is a misread. Only used to decide how long to commit. */
  wrong: boolean;
}

export type DgBotRole = 'chase' | 'support' | 'cover' | 'keeper' | 'refuel';

/** Everything a bot remembers between ticks. */
export interface DgBotBrain {
  pid: number;
  traits: DgBotTraits;
  belief: DgBotBelief;
  role: DgBotRole;
  /** Ticks before the role may change again. */
  roleHold: number;
  /** Ticks of pure ball-watching: caught flat, doing nothing at all. */
  stare: number;
  /** Ticks until this bot may strike again. */
  strikeHold: number;
  /** Ticks of dither before a committed strike actually comes off. */
  windUp: number;
  /** The dash this tick asks for, if any: the key held with the click (the
   *  same MoveInput.dash a player's left click sets). */
  dashKey: 'forward' | 'back' | 'strafeLeft' | 'strafeRight' | null;
  /** Ticks the bot has been holding the throttle down this burn. */
  burning: number;
  /**
   * A keeper's alarm: seconds until the believed ball reaches its ring plane, or
   * -1 for no shot inbound. Written by {@link keeperStation} and read by the
   * flight decisions, so the lunge and the throttle answer the same read the
   * positioning did.
   */
  alarm: number;
}

export function makeBotBrain(pid: number, salt: number, ball: Vec3): DgBotBrain {
  return {
    pid,
    traits: botTraits(pid, salt),
    belief: {
      x: ball.x,
      y: ball.y,
      z: ball.z,
      vx: 0,
      vy: 0,
      vz: 0,
      next: 0,
      hold: 0,
      wrong: false,
    },
    role: 'cover',
    roleHold: 0,
    stare: 0,
    strikeHold: 0,
    windUp: 0,
    dashKey: null,
    burning: 0,
    alarm: -1,
  };
}

// ---------------------------------------------------------------------------
// Tuning
// ---------------------------------------------------------------------------

/** Ticks between glances, best and worst vision. */
const GLANCE_MIN = 2;
const GLANCE_MAX = 8;
/** Per-axis positional misjudgement: a floor plus this share of the range. */
const SIGHT_ERR_FLOOR = 0.5;
const SIGHT_ERR_PER_YD = 0.055;
/** Velocity misjudgement, as a share of the ball's pace. */
const SIGHT_VEL_ERR = 0.16;
/** Chance a glance is a MISREAD, and how much worse it is when it is. */
const MISREAD_BASE = 0.06;
const MISREAD_SKILL = 0.12;
const MISREAD_MULT = 4.5;
/** Ticks a misread is committed to. */
const MISREAD_HOLD = Math.round(0.7 / DT);
/** Chance per tick of simply ball-watching for a beat, and how long. */
const STARE_CHANCE = 0.004;
const STARE_TICKS = Math.round(0.45 / DT);

/** Turn rate, rad/s, worst and best touch. */
const TURN_SLOW = 1.5;
const TURN_FAST = 2.9;
/** Strike cooldown. */
const STRIKE_HOLD_TICKS = Math.round(1.3 / DT);
/** Ticks of wind-up before a decided strike lands. A human sees the chance, then
 *  takes it; striking on the same tick the ball entered range is a tell. */
const WINDUP_MIN = 1;
const WINDUP_MAX = 4;
/** Chance a strike comes off scuffed, worst and best touch. */
const SCUFF_WORST = 0.34;
const SCUFF_BEST = 0.07;
const SCUFF_POWER = 0.52;
/** Aim spread in yards per 30 yards of range, worst and best touch. */
const SPREAD_WORST = 13;
const SPREAD_BEST = 5;
/** Range past which even a greedy bot looks for a pass. */
const PASS_RANGE_MIN = 30;
const PASS_RANGE_MAX = 52;
/** How far ahead of a receiver to lead a pass, seconds. */
const PASS_LEAD = 0.45;
/** Charge a bot will not go below on a whim, worst and best discipline. */
const RESERVE_LOOSE = 8;
const RESERVE_TIGHT = 46;
/** Charge under which an off-the-ball bot breaks off to refuel. */
const REFUEL_BELOW = 32;
/** Distance past which the throttle is worth opening at all. */
const BOOST_MIN_DIST = 14;
/** How far off the ring line a keeper holds station. It never leaves the line to
 *  chase (the old KEEPER_CHARGE_R behaviour is gone): with a projected crossing
 *  point and a lunge to reach it, a keeper that abandoned its post to contest a
 *  loose ball was simply an open net with extra steps. */
const KEEPER_STANDOFF = 7;
/** Separation: mates closer than this push apart. */
const SPACING = 8;
/** How far ahead of the ball a supporting run sits. */
const SUPPORT_AHEAD = 16;
/** How hard a bot brakes rather than overrunning a close target, and the touch
 *  below which it does not think to. */
const BRAKE_DIST = 7;
const BRAKE_SKILL = 0.35;
/** Alignment (dot) under which a bot dashes sideways instead of turning. */
const DASH_LATERAL = 0.35;
const DASH_MIN_DIST = 6;
const DASH_MAX_DIST = 22;

// ---------------------------------------------------------------------------
// The view the driver is given. Built by the match each tick; bots never touch
// the match singleton, which is what keeps this module testable on its own.
// ---------------------------------------------------------------------------

export interface DgBotBall {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  lastTouchTeam: 'A' | 'B' | null;
  lastTouchPid: number | null;
}

export interface DgBotView {
  tick: number;
  salt: number;
  ball: DgBotBall;
  /** The TRUE ball, only ever read to resolve a strike that has already been
   *  committed, never to decide anything. */
  team: 'A' | 'B';
  /** Own side, in seat order, flying. */
  mates: Entity[];
  /** The other side, flying. */
  foes: Entity[];
  /** The pid keeping goal on this side, or -1. */
  keeperPid: number;
  ownRing: Vec3;
  foeRing: Vec3;
  /** Vents that are lit right now. */
  litPads: readonly DgBoostPad[];
  /** Commit a strike. The match owns the ball, the touch record and the whiff:
   *  `aim` need not be normalised, and `power` is the speed asked for. */
  strike: (e: Entity, aim: Vec3, power: number) => void;
}

// Scratch, reused every tick over the whole roster.
const TARGET: Vec3 = { x: 0, y: 0, z: 0 };
const AIM: Vec3 = { x: 0, y: 0, z: 0 };

// ---------------------------------------------------------------------------
// Perception
// ---------------------------------------------------------------------------

/**
 * Advance a bot's belief about the ball: dead-reckon it forward, and glance at
 * the real thing when the head is due to come up.
 *
 * The reckoning carries buoyancy at half strength, a fighter knows the Tidesow
 * floats but does not integrate it, and nothing else. Every acceleration the
 * ball is actually under (currents, the radial return, Magnus off a curler) is
 * invisible to the bot until its next glance, which is exactly the ignorance
 * that makes a curling shot beat a keeper.
 */
export function advanceBelief(brain: DgBotBrain, view: DgBotView, self: Entity): void {
  const bel = brain.belief;
  bel.x += bel.vx * DT;
  bel.y += bel.vy * DT;
  bel.z += bel.vz * DT;
  bel.vy += DG_BALL_BUOYANCY * 0.5 * DT;
  if (bel.hold > 0) bel.hold--;
  if (bel.next > 0) {
    bel.next--;
    return;
  }
  if (bel.hold > 0) return; // committed to the last reading, right or wrong

  const t = brain.traits;
  const ball = view.ball;
  const dist = Math.hypot(ball.x - self.pos.x, ball.y - self.pos.y, ball.z - self.pos.z);
  const sloppy = 1 - t.skill;
  const misreadChance = MISREAD_BASE + MISREAD_SKILL * sloppy;
  const wrong = botNoise(brain.pid, view.salt, view.tick, 11) < misreadChance;
  const spread = (SIGHT_ERR_FLOOR + SIGHT_ERR_PER_YD * dist) * sloppy * (wrong ? MISREAD_MULT : 1);
  const pace = Math.hypot(ball.vx, ball.vy, ball.vz);
  const vErr = SIGHT_VEL_ERR * sloppy * pace * (wrong ? MISREAD_MULT : 1);
  const tk = view.tick;
  bel.x = ball.x + botSigned(brain.pid, view.salt, tk, 21) * spread;
  bel.y = ball.y + botSigned(brain.pid, view.salt, tk, 22) * spread;
  bel.z = ball.z + botSigned(brain.pid, view.salt, tk, 23) * spread;
  bel.vx = ball.vx + botSigned(brain.pid, view.salt, tk, 24) * vErr;
  bel.vy = ball.vy + botSigned(brain.pid, view.salt, tk, 25) * vErr;
  bel.vz = ball.vz + botSigned(brain.pid, view.salt, tk, 26) * vErr;
  bel.wrong = wrong;
  bel.hold = wrong ? MISREAD_HOLD : 0;
  bel.next = Math.round(GLANCE_MIN + (GLANCE_MAX - GLANCE_MIN) * (1 - t.vision));
}

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------

/**
 * Decide who on this side is going for the ball.
 *
 * Two things make this read as a team rather than as five copies of one bot.
 * COMMITMENT: the chaser keeps the job for a beat even once a mate is nominally
 * closer, because a side that re-elects its chaser every tick produces two
 * fighters swapping the ball between them and neither ever arriving. And the
 * claim is scored on the bot's OWN belief, so a bot that has misread the bounce
 * can win the race to a place the ball is not.
 */
export function assignBotRoles(
  view: DgBotView,
  brains: Map<number, DgBotBrain>,
  ballOurs: boolean,
): void {
  let bestPid = -1;
  let bestScore = Infinity;
  let heldPid = -1;
  for (const e of view.mates) {
    const brain = brains.get(e.id);
    if (!brain) continue;
    if (e.id === view.keeperPid) continue;
    if (brain.role === 'chase') heldPid = e.id;
    const bel = brain.belief;
    const dx = bel.x - e.pos.x;
    const dy = bel.y - (e.pos.y + DG_BODY_CENTRE_Y);
    const dz = bel.z - e.pos.z;
    const dist = Math.hypot(dx, dy, dz) || 1;
    // Facing the ball is worth yards: a bot pointed the other way is genuinely
    // further from it than one already flying at it.
    const align = (Math.sin(e.facing) * dx + Math.cos(e.facing) * dz) / dist;
    const charge = e.dgCharge ?? 0;
    const t = brain.traits;
    const score =
      dist -
      align * 6 -
      charge * 0.05 -
      t.aggression * 7 +
      (e.dgFrozenTicks ?? 0) * 0.5 +
      (brain.stare > 0 ? 12 : 0);
    if (score < bestScore) {
      bestScore = score;
      bestPid = e.id;
    }
  }
  // Commitment: the sitting chaser keeps the job unless it is clearly beaten.
  if (heldPid >= 0 && heldPid !== bestPid) {
    const held = brains.get(heldPid);
    if (held && held.roleHold > 0) bestPid = heldPid;
  }

  for (const e of view.mates) {
    const brain = brains.get(e.id);
    if (!brain) continue;
    if (brain.roleHold > 0) brain.roleHold--;
    const want: DgBotRole =
      e.id === view.keeperPid
        ? 'keeper'
        : e.id === bestPid
          ? 'chase'
          : (e.dgCharge ?? 0) < REFUEL_BELOW && view.litPads.length > 0
            ? 'refuel'
            : ballOurs
              ? 'support'
              : 'cover';
    if (want !== brain.role) {
      brain.role = want;
      brain.roleHold = Math.round(0.8 / DT);
    }
  }
}

// ---------------------------------------------------------------------------
// Steering
// ---------------------------------------------------------------------------

/** The nearest lit vent, big ones weighted as worth a longer trip. */
function nearestLitPad(view: DgBotView, e: Entity): DgBoostPad | null {
  let best: DgBoostPad | null = null;
  let bestD = Infinity;
  for (const p of view.litPads) {
    const d = Math.hypot(p.x - e.pos.x, p.y - e.pos.y, p.z - e.pos.z);
    const weighted = p.big ? d * 0.6 : d;
    if (weighted >= bestD) continue;
    bestD = weighted;
    best = p;
  }
  return best;
}

/** Push a target point away from team-mates so a side spreads out. */
function separate(view: DgBotView, self: Entity, out: Vec3): void {
  for (const mate of view.mates) {
    if (mate.id === self.id) continue;
    const dx = out.x - mate.pos.x;
    const dy = out.y - mate.pos.y;
    const dz = out.z - mate.pos.z;
    const d = Math.hypot(dx, dy, dz);
    if (d > SPACING || d < 1e-3) continue;
    const push = (SPACING - d) / d;
    out.x += dx * push;
    out.y += dy * push;
    out.z += dz * push;
  }
}

/**
 * Where this bot is trying to be. Written into {@link TARGET}.
 *
 * Interception, not tailing: a chaser aims at where it believes the ball will BE
 * when it can get there, solved from its own closing speed. That is the one place
 * a bot is allowed to be sharp, because it is also the place its belief is
 * wrongest, leading a ball you have misread takes you further from it, which is
 * precisely the mistake a real player makes at pace.
 */
function chooseTarget(view: DgBotView, brain: DgBotBrain, e: Entity): void {
  const bel = brain.belief;
  const t = brain.traits;
  if (brain.role === 'refuel') {
    const pad = nearestLitPad(view, e);
    if (pad) {
      TARGET.x = pad.x;
      TARGET.y = pad.y;
      TARGET.z = pad.z;
      return;
    }
  }
  if (brain.role === 'chase') {
    const dist = Math.hypot(bel.x - e.pos.x, bel.y - e.pos.y, bel.z - e.pos.z);
    // Rough time to arrive, from a cruise-ish closing speed. Better touch leads
    // further, which is what makes a good bot meet the ball and a poor one tail
    // it, and both of them are working from the same wrong belief.
    const eta = Math.min(1.4, dist / 18) * (0.4 + t.skill * 0.9);
    TARGET.x = bel.x + bel.vx * eta;
    TARGET.y = bel.y + bel.vy * eta;
    TARGET.z = bel.z + bel.vz * eta;
    return;
  }
  if (brain.role === 'keeper') {
    keeperStation(view, brain, TARGET);
    return;
  }
  if (brain.role === 'support') {
    // An attacking run: ahead of the ball, toward the enemy ring, fanned out by
    // seat so two runners do not occupy the same yard of water.
    const seat = view.mates.findIndex((m) => m.id === e.id);
    const dx = view.foeRing.x - bel.x;
    const dy = view.foeRing.y - bel.y;
    const dz = view.foeRing.z - bel.z;
    const l = Math.hypot(dx, dy, dz) || 1;
    const ahead = SUPPORT_AHEAD * (0.6 + t.aggression * 0.8);
    TARGET.x = bel.x + (dx / l) * ahead;
    TARGET.y = bel.y + (dy / l) * ahead + (seat % 2 === 0 ? 8 : -8);
    TARGET.z = bel.z + (dz / l) * ahead + (seat % 3 === 0 ? 11 : -11);
    separate(view, e, TARGET);
    return;
  }
  // Cover: sit between the ball and our own ring, on the side a shot would come
  // from, offset by seat. Aggressive bots hold a higher line.
  const seat = view.mates.findIndex((m) => m.id === e.id);
  const depth = 0.46 - t.aggression * 0.16;
  TARGET.x = bel.x + (view.ownRing.x - bel.x) * depth;
  TARGET.y = bel.y + (view.ownRing.y - bel.y) * depth + (seat % 2 === 0 ? 7 : -7);
  TARGET.z = bel.z + (view.ownRing.z - bel.z) * depth + (seat % 3 === 0 ? 9 : -9);
  separate(view, e, TARGET);
}

/**
 * The keeper's station: on the line the ball would travel to the ring, standing
 * off it, and pulled toward the ball's projected crossing point when a shot is
 * actually inbound.
 *
 * The projection uses the BELIEVED velocity, so a curling shot, whose Magnus
 * bend is invisible to the belief, is projected as a straight line and the
 * keeper stations itself where the ball is not going to be. That is a keeper
 * beaten by curve, and there is not a word about curve in it.
 */
function keeperStation(view: DgBotView, brain: DgBotBrain, out: Vec3): void {
  const bel = brain.belief;
  const ring = view.ownRing;
  const towardRing = ring.x - bel.x;
  const closing = towardRing > 0 ? bel.vx > 1 : bel.vx < -1;
  brain.alarm = -1;
  if (closing) {
    const eta = Math.abs(towardRing / (bel.vx || 1e-3));
    if (eta < 2.2) {
      // Meet the projected crossing, a little off the ring line. The projection
      // is straight, because the belief has no idea the ball is curling.
      brain.alarm = eta;
      const cy = bel.y + bel.vy * eta;
      const cz = bel.z + bel.vz * eta;
      const off = Math.min(KEEPER_STANDOFF, 2.5 + eta * 2.5);
      out.x = ring.x + Math.sign(DEEPGLASS_CENTER.x - ring.x) * off;
      out.y = cy;
      out.z = cz;
      clampToBell(out, 30);
      return;
    }
  }
  const bx = bel.x - ring.x;
  const by = bel.y - ring.y;
  const bz = bel.z - ring.z;
  const bl = Math.hypot(bx, by, bz) || 1;
  const out2 = Math.min(KEEPER_STANDOFF, bl * 0.5);
  out.x = ring.x + (bx / bl) * out2;
  out.y = ring.y + (by / bl) * out2;
  out.z = ring.z + (bz / bl) * out2;
}

// ---------------------------------------------------------------------------
// The driver
// ---------------------------------------------------------------------------

/**
 * One tick of one bot: perceive, position, fly, and maybe strike.
 *
 * The bot writes the SAME {@link MoveInput} a human sends, including the aim
 * pitch, the throttle and the click dash, so it is flown by exactly the
 * physics the player is flown by. Nothing here touches velocity directly, which
 * is the rule that keeps "the bots feel different to play against" from being a
 * bug in the flight model.
 */
export function driveBot(
  view: DgBotView,
  brain: DgBotBrain,
  e: Entity,
  inp: MoveInput,
  playing: boolean,
): void {
  inp.forward = false;
  inp.back = false;
  inp.strafeLeft = false;
  inp.strafeRight = false;
  inp.jump = false;
  inp.dive = false;
  inp.surface = false;
  inp.boost = false;
  inp.swimSteer = 1;
  inp.aimPitch = e.dgAimPitch ?? 0;
  if (!playing) return;

  advanceBelief(brain, view, e);
  if (brain.strikeHold > 0) brain.strikeHold--;

  // Ball-watching: caught flat for a beat, hands off everything. Rare, brief,
  // and the single cheapest thing in here that reads as a person.
  if (brain.stare > 0) {
    brain.stare--;
    return;
  }
  if (botNoise(brain.pid, view.salt, view.tick, 31) < STARE_CHANCE * (1.6 - brain.traits.skill)) {
    brain.stare = STARE_TICKS;
    return;
  }

  chooseTarget(view, brain, e);
  const t = brain.traits;
  const dx = TARGET.x - e.pos.x;
  const dy = TARGET.y - (e.pos.y + DG_BODY_CENTRE_Y);
  const dz = TARGET.z - e.pos.z;
  const dist = Math.hypot(dx, dy, dz);
  const horiz = Math.hypot(dx, dz) || 1e-3;

  // ---- flying ------------------------------------------------------------
  // Yaw is rate-limited (a body turns, it does not snap) and the aim pitch is
  // the same continuous control a player's camera writes, so a bot climbs by
  // pointing its nose up and burning, exactly as a human does.
  const wantYaw = Math.atan2(dx, dz);
  let dYaw = wantYaw - e.facing;
  while (dYaw > Math.PI) dYaw -= Math.PI * 2;
  while (dYaw < -Math.PI) dYaw += Math.PI * 2;
  const turn = (TURN_SLOW + (TURN_FAST - TURN_SLOW) * t.skill) * DT;
  e.facing += Math.max(-turn, Math.min(turn, dYaw));

  const wantPitch = Math.atan2(dy, horiz);
  const aimed = e.dgAimPitch ?? 0;
  // The head follows the target on the same lag the body does.
  const pitchStep = 3.2 * DT;
  inp.aimPitch = aimed + Math.max(-pitchStep, Math.min(pitchStep, wantPitch - aimed));

  const speed = Math.hypot(e.vx, e.vy, e.vz);
  const closingOnTarget =
    dist > 1e-3 ? (e.vx * dx + e.vy * dy + e.vz * dz) / (dist * (speed || 1)) : 0;
  // Brake rather than overrun a target you are nearly on top of, but only if
  // you are the kind of fighter who thinks of it.
  const shouldBrake =
    dist < BRAKE_DIST && speed > 9 && closingOnTarget > 0.4 && t.skill > BRAKE_SKILL;
  if (shouldBrake) {
    inp.back = true;
  } else if (Math.abs(dYaw) < 1.15 || dist > 12) {
    inp.forward = true;
  }

  // Fine vertical trim on top of the nose: the trim keys are what a player uses
  // for the last couple of yards, and a bot that only ever pitched its nose
  // wallowed above and below the ball forever.
  if (dist < 14) {
    if (dy > 1.6) inp.jump = true;
    else if (dy < -1.6) inp.dive = true;
  }

  // Sideways adjustments close in, so a bot slides onto a ball rather than
  // circling it.
  if (dist < 18 && Math.abs(dYaw) > 0.5) {
    if (dYaw > 0) inp.strafeRight = true;
    else inp.strafeLeft = true;
  }

  // ---- the throttle ------------------------------------------------------
  // A disciplined bot keeps a burn in hand for the next exchange; an
  // undisciplined one flies the tank dry and then cannot answer anything. Both
  // are recognisable opponents, which is the point.
  const reserve = RESERVE_LOOSE + (RESERVE_TIGHT - RESERVE_LOOSE) * t.discipline;
  const charge = e.dgCharge ?? 0;
  // A keeper with a shot coming is the most urgent body in the bell: it has
  // fractions of a second to cover a 12-yard mouth.
  const saving = brain.role === 'keeper' && brain.alarm >= 0 && brain.alarm < 1.4;
  const urgent = brain.role === 'chase' || brain.role === 'refuel' || saving;
  const wantBoost = dist > BOOST_MIN_DIST * (urgent ? (saving ? 0.2 : 0.7) : 1.2) && !shouldBrake;
  inp.boost = wantBoost && (charge > reserve || (urgent && charge > 6));
  brain.burning = inp.boost ? brain.burning + 1 : 0;

  // ---- the dash ----------------------------------------------------------
  // The player's own gesture: a click with a key held (MoveInput.dash plus the
  // direction), so the bot goes through exactly the flight pass a human does.
  // One tick is enough; the pass reads it on the tick it is set.
  inp.dash = false;
  brain.dashKey = null;
  if (saving && dist > 3.5 && charge > DG_DASH_COST && (e.dgDashCd ?? 0) <= 0) {
    // The save. A keeper that can only fly at its station cannot cover a mouth
    // twelve yards across; a lunge along its own nose can, and it spends the same
    // dash a player spends. This is why keepers read as keepers.
    brain.dashKey = 'forward';
  } else if (
    dist > DASH_MIN_DIST &&
    dist < DASH_MAX_DIST &&
    charge > reserve + 20 &&
    Math.abs(dYaw) > 0.9 &&
    Math.abs(dYaw) < 2.4 &&
    Math.abs(Math.sin(dYaw)) > DASH_LATERAL &&
    botNoise(brain.pid, view.salt, view.tick, 41) < 0.03 + t.flair * 0.09
  ) {
    brain.dashKey = dYaw > 0 ? 'strafeRight' : 'strafeLeft';
  }
  if (brain.dashKey) {
    inp[brain.dashKey] = true;
    inp.dash = true;
  }

  // ---- the strike --------------------------------------------------------
  strikeIfOn(view, brain, e);
}

/**
 * Decide and (after a beat) commit a strike.
 *
 * The reach test is against the BELIEVED ball, which is the whole reason a bot
 * can whiff: the match resolves the strike against the real one, and if the real
 * one is no longer there the swing hits water and the cooldown is spent anyway.
 */
function strikeIfOn(view: DgBotView, brain: DgBotBrain, e: Entity): void {
  if (brain.strikeHold > 0) return;
  const t = brain.traits;
  const bel = brain.belief;
  const reach = DG_BODY_RADIUS + DG_BALL_RADIUS + 1.6;
  const bd = Math.hypot(bel.x - e.pos.x, bel.y - (e.pos.y + DG_BODY_CENTRE_Y), bel.z - e.pos.z);
  if (bd > reach) {
    brain.windUp = 0;
    return;
  }
  // Wind-up: see the chance, then take it. Poor touch dithers longer.
  if (brain.windUp <= 0) {
    brain.windUp = Math.round(WINDUP_MIN + (WINDUP_MAX - WINDUP_MIN) * (1 - t.skill));
    return;
  }
  brain.windUp--;
  if (brain.windUp > 0) return;

  const scuffChance = SCUFF_WORST + (SCUFF_BEST - SCUFF_WORST) * t.skill;
  const scuffed = botNoise(brain.pid, view.salt, view.tick, 51) < scuffChance;
  const power = DG_BOT_STRIKE_POWER * (scuffed ? SCUFF_POWER : 1);
  const spread = SPREAD_WORST + (SPREAD_BEST - SPREAD_WORST) * t.skill;

  const ownDist = Math.hypot(
    bel.x - view.ownRing.x,
    bel.y - view.ownRing.y,
    bel.z - view.ownRing.z,
  );
  const keeper = e.id === view.keeperPid;
  const panicking = ownDist < 20 && botNoise(brain.pid, view.salt, view.tick, 52) > t.composure;

  if (keeper || panicking) {
    // A clearance: up the middle, away from our own ring, and a panicking
    // fighter's clearance is worse than a keeper's.
    const slop = panicking && !keeper ? spread * 1.8 : spread;
    AIM.x = view.foeRing.x - bel.x;
    AIM.y = DEEPGLASS_CENTER.y - bel.y + botSigned(brain.pid, view.salt, view.tick, 53) * slop;
    AIM.z = DEEPGLASS_CENTER.z - bel.z + botSigned(brain.pid, view.salt, view.tick, 54) * slop;
    view.strike(e, AIM, power);
    brain.strikeHold = STRIKE_HOLD_TICKS;
    return;
  }

  const range = Math.hypot(view.foeRing.x - bel.x, view.foeRing.y - bel.y, view.foeRing.z - bel.z);
  // Shoot or pass. Greed is flair plus aggression: a showman takes it on from
  // distance and usually should not have.
  const shootRange =
    PASS_RANGE_MIN + (PASS_RANGE_MAX - PASS_RANGE_MIN) * (t.flair * 0.6 + t.aggression * 0.4);
  const mate = range > shootRange ? bestOutlet(view, e) : null;
  if (mate) {
    AIM.x = mate.pos.x + mate.vx * PASS_LEAD - bel.x;
    AIM.y = mate.pos.y + DG_BODY_CENTRE_Y + mate.vy * PASS_LEAD - bel.y;
    AIM.z = mate.pos.z + mate.vz * PASS_LEAD - bel.z;
    // A pass is aimed better than a shot, and a bad passer still sprays it.
    const slop = spread * 0.45;
    AIM.y += botSigned(brain.pid, view.salt, view.tick, 55) * slop;
    AIM.z += botSigned(brain.pid, view.salt, view.tick, 56) * slop;
  } else {
    const err = (spread * range) / 30;
    AIM.x = view.foeRing.x - bel.x;
    AIM.y = view.foeRing.y - bel.y + botSigned(brain.pid, view.salt, view.tick, 57) * err;
    AIM.z = view.foeRing.z - bel.z + botSigned(brain.pid, view.salt, view.tick, 58) * err;
  }
  view.strike(e, AIM, power);
  brain.strikeHold = STRIKE_HOLD_TICKS;
}

/** The best mate to pass to: advanced, and not screened by an opponent sitting
 *  on the line. A bot that only picked "most advanced" fed the ball straight
 *  into a defender's chest every time. */
function bestOutlet(view: DgBotView, self: Entity): Entity | null {
  let best: Entity | null = null;
  let bestScore = -Infinity;
  const forward = view.team === 'A' ? 1 : -1;
  for (const mate of view.mates) {
    if (mate.id === self.id || mate.id === view.keeperPid) continue;
    const dx = mate.pos.x - self.pos.x;
    const dy = mate.pos.y - self.pos.y;
    const dz = mate.pos.z - self.pos.z;
    const d = Math.hypot(dx, dy, dz);
    if (d < 6 || d > 60) continue;
    // How covered is the lane? Nearest opponent's perpendicular distance to it.
    let cover = Infinity;
    for (const foe of view.foes) {
      const fx = foe.pos.x - self.pos.x;
      const fy = foe.pos.y - self.pos.y;
      const fz = foe.pos.z - self.pos.z;
      const along = (fx * dx + fy * dy + fz * dz) / (d * d);
      if (along <= 0 || along >= 1) continue;
      const px = fx - dx * along;
      const py = fy - dy * along;
      const pz = fz - dz * along;
      cover = Math.min(cover, Math.hypot(px, py, pz));
    }
    const openness = Math.min(12, cover === Infinity ? 12 : cover);
    const advance = mate.pos.x * forward;
    const score = advance * 0.5 + openness * 1.4 - d * 0.12;
    if (score > bestScore) {
      bestScore = score;
      best = mate;
    }
  }
  return best;
}

/** Base power off a bot's strike. Lower than a player's Shot on purpose: the
 *  human has a button, a cooldown and a wind-up to manage, and should be
 *  rewarded for it. */
export const DG_BOT_STRIKE_POWER = 25;
