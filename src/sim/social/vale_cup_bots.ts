// The Vale Cup practice + backfill bots (fiesta_bots.ts precedent): lore-named
// player bots that fill out a Sowfield match. Unlike the fiesta harness these
// are driven INSIDE the sim tick (Sim.updateValeCup calls updateValeCupBots
// right after the match module), so the online server's 60s queue backfill and
// the offline Practice button run the exact same code.
//
// The functions take the `Sim` directly (type-only import, no runtime cycle)
// because bot lifecycle needs Sim-only affordances (addPlayer/removePlayer);
// everything match-scoped routes through the extracted vale_cup module.
//
// Deterministic with ZERO rng: bot heuristics are tick-staggered pure functions
// of sim state (pid parity picks the stagger slot, positions pick the play), so
// a backfilled match on the live server perturbs no shared rng draw order.

import { VC_NATION_IDS } from '../content/vale_cup';
import { DUNGEON_X_THRESHOLD } from '../data';
import type { PlayerMeta, Sim } from '../sim';
import {
  angleTo,
  dist2d,
  type Entity,
  emptyMoveInput,
  type SportRole,
  type VcBracket,
  type VcNationId,
} from '../types';
import {
  GOAL_BOX_DEPTH,
  GOAL_HALF_W,
  GOAL_LINE_EAST_X,
  GOAL_LINE_WEST_X,
  PITCH,
  PITCH_CENTER,
  VC_PRACTICE_SLOTS,
  vcPracticeOrigin,
} from '../vale_cup_layout';
import * as valeCupMod from './vale_cup';
import {
  VC_BACKFILL_WAIT,
  VC_BRACKETS,
  type VcMatch,
  type VcQueueUnit,
  type VcSide,
  vcupTeamOf,
} from './vale_cup';

// Idle bot-showcase: after this long with no match and nobody queued, the
// Sowfield auto-stages a bot-vs-bot exhibition so a walk-up always has a game to
// watch and bet on (gated by SimConfig.valeCupShowcase; off in tests).
const VC_SHOWCASE_IDLE = 60; // s of quiet before an exhibition kicks off
const VC_SHOWCASE_BRACKET: VcBracket = 3; // a lively 3v3 exhibition

// Vale/harvest-flavored bot names, enough for a full 5v5 (9 bots max: one side
// always holds at least one human). Names splice verbatim (identity text).
const VC_BOT_NAMES = [
  'Old Hobb',
  'Reeve Marlow',
  'Tally Cooper',
  'Bess Furrow',
  'Wick Thatcher',
  'Sorrel Dray',
  'Hen Barrow',
  'Pip Osier',
  'Mott Granger',
] as const;

// Bot kit assignment when filling a side, by seat index within the side:
// seat 0 keeps goal (3v3 and up), the last seat sweeps, the middle strikes.
function botRoleForSeat(seat: number, bracket: VcBracket): SportRole {
  if (bracket <= 2) return 'allrounder';
  if (seat === 0) return 'keeper';
  if (seat === bracket - 1) return 'sweeper';
  return 'striker';
}

function nextBotName(sim: Sim): string {
  const taken = new Set<string>();
  for (const meta of sim.players.values()) taken.add(meta.name.toLowerCase());
  for (const name of VC_BOT_NAMES) {
    if (!taken.has(name.toLowerCase())) return name;
  }
  // Every lore name is in use (nine bots is the ceiling, so only a name clash
  // with real players lands here): suffix deterministically.
  for (let i = 2; ; i++) {
    const name = `${VC_BOT_NAMES[0]} ${i}`;
    if (!taken.has(name.toLowerCase())) return name;
  }
}

// Cosmetic class variety for bots (sport abilities are class-agnostic: the kit
// swap overrides meta.known and the no-damage truce floors class stats, so class
// is purely visual here). The two pet classes are excluded so a hunter beast or
// warlock demon never wanders onto the pitch. Picked by deterministic spawn
// order (botPids length), so a run-twice replay and the online server agree.
const VC_BOT_CLASSES = [
  'warrior',
  'rogue',
  'mage',
  'priest',
  'paladin',
  'shaman',
  'druid',
] as const;

function spawnCupBot(sim: Sim, role: SportRole): { pid: number; role: SportRole } {
  const cls = VC_BOT_CLASSES[sim.vcup.botPids.length % VC_BOT_CLASSES.length];
  const pid = sim.addPlayer(cls, nextBotName(sim));
  sim.vcup.botPids.push(pid);
  return { pid, role };
}

// Fill `side` (possibly holding human units) with bots up to the bracket size.
function fillSideWithBots(sim: Sim, side: VcSide, bracket: VcBracket): void {
  while (side.pids.length < bracket) {
    const seat = side.pids.length;
    // Guarantee a keeper on any 3+ side (a human who queued outfield still gets
    // their goal defended in practice): if nobody keeps yet and this is the
    // last free seat, the bot keeps goal; otherwise the by-seat default.
    const hasKeeper = side.pids.some((p) => side.roles[p] === 'keeper');
    const lastSeat = side.pids.length === bracket - 1;
    const role: SportRole =
      bracket >= 3 && !hasKeeper && lastSeat ? 'keeper' : botRoleForSeat(seat, bracket);
    const bot = spawnCupBot(sim, role);
    side.pids.push(bot.pid);
    side.roles[bot.pid] = bot.role;
  }
}

function sideFromQueueUnits(units: VcQueueUnit[], fallbackNation: VcNationId): VcSide {
  const pids: number[] = [];
  const roles: Record<number, SportRole> = {};
  for (const u of units) {
    for (const pid of u.pids) {
      pids.push(pid);
      roles[pid] = u.roles[pid] ?? 'allrounder';
    }
  }
  return { pids, nation: units[0]?.nation ?? fallbackNation, roles };
}

// At least one human unit has waited out the backfill timer and the pitch is
// free: seat every waiting human that fits and fill both sides with bots.
// Backfilled matches are UNRATED (no standing changes).
function maybeBackfillBots(sim: Sim): void {
  const vc = sim.vcup;
  if (vc.match) return;
  let bestBracket: VcBracket | null = null;
  let bestTick = Infinity;
  for (const bracket of VC_BRACKETS) {
    valeCupMod.vcupPruneQueue(sim.ctx, bracket);
    for (const unit of vc.queues[bracket]) {
      if (sim.tickCount - unit.joinedAtTick < VC_BACKFILL_WAIT * 20) continue;
      if (unit.joinedAtTick < bestTick) {
        bestTick = unit.joinedAtTick;
        bestBracket = bracket;
      }
    }
  }
  if (bestBracket === null) return;
  const bracket = bestBracket;
  // Greedy first-fit of the waiting humans into the two sides (queue order).
  const aUnits: VcQueueUnit[] = [];
  const bUnits: VcQueueUnit[] = [];
  let an = 0;
  let bn = 0;
  for (const u of vc.queues[bracket]) {
    if (an + u.pids.length <= bracket) {
      aUnits.push(u);
      an += u.pids.length;
    } else if (bn + u.pids.length <= bracket) {
      bUnits.push(u);
      bn += u.pids.length;
    }
  }
  valeCupMod.vcupRemoveQueueUnits(sim.ctx, bracket, [...aUnits, ...bUnits]);
  const sideA = sideFromQueueUnits(aUnits, 'vale');
  const sideB = sideFromQueueUnits(bUnits, sideA.nation === 'coliseum' ? 'ogre' : 'coliseum');
  fillSideWithBots(sim, sideA, bracket);
  fillSideWithBots(sim, sideB, bracket);
  valeCupMod.startCupMatch(sim.ctx, bracket, sideA, sideB, false);
}

// The Practice affordance: a PRIVATE parallel bout against bots on its own
// instanced pitch copy far from the Sowfield, so it never touches (or waits on)
// the one physical match and many players can practice at once. Works offline
// AND online (the sim runs identically on the server). Seats you plus a full set
// of bots immediately.
export function startValeCupPractice(sim: Sim, bracket: VcBracket, pid?: number): void {
  const ctx = sim.ctx;
  const r = ctx.resolve(pid);
  if (!r) return;
  const id = r.meta.entityId;
  if (!VC_BRACKETS.includes(bracket)) return;
  const vc = sim.vcup;
  // Already playing (the real match OR a practice instance): no double-seating.
  if (valeCupMod.vcupMatchOf(ctx, id)) {
    ctx.error(id, 'You are already in an arena match.');
    return;
  }
  if (ctx.arenaMatches.has(id)) {
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
  if ((vc.deserters.get(r.meta.name.toLowerCase()) ?? 0) > ctx.time) {
    ctx.error(id, 'The Groundskeeper remembers. Come back later.');
    return;
  }
  // Claim a free practice-instance slot (bounded so bot fleets stay sane).
  const used = new Set(vc.practices.map((p) => p.practice?.slot));
  let slot = -1;
  for (let s = 0; s < VC_PRACTICE_SLOTS; s++) {
    if (!used.has(s)) {
      slot = s;
      break;
    }
  }
  if (slot < 0) {
    ctx.error(id, 'The practice pitches are all in use. Try again shortly.');
    return;
  }
  valeCupMod.vcupDequeue(ctx, id); // Practice overrides a waiting queue spot
  const sideA: VcSide = { pids: [id], nation: 'vale', roles: { [id]: 'allrounder' } };
  const sideB: VcSide = { pids: [], nation: 'coliseum', roles: {} };
  fillSideWithBots(sim, sideA, bracket);
  fillSideWithBots(sim, sideB, bracket);
  valeCupMod.startCupMatch(ctx, bracket, sideA, sideB, false, {
    origin: vcPracticeOrigin(slot),
    practice: { ownerPid: id, slot },
  });
}

function vcupAnyQueued(sim: Sim): boolean {
  for (const bracket of VC_BRACKETS) {
    if (sim.vcup.queues[bracket].length > 0) return true;
  }
  return false;
}

function vcupHasHumanOnline(sim: Sim): boolean {
  for (const meta of sim.players.values()) {
    if (sim.vcup.botPids.includes(meta.entityId)) continue;
    if (sim.entities.has(meta.entityId)) return true;
  }
  return false;
}

// The idle exhibition: when nothing is queued and no match is live, stage a
// deterministic bot-vs-bot showcase so a walk-up spectator always has a game to
// watch (and bet on). Rotating nation pairs give each exhibition its own look.
function maybeStartShowcase(sim: Sim): void {
  const vc = sim.vcup;
  if (!sim.cfg.valeCupShowcase || vc.match) return;
  if (sim.time - vc.lastActivityAt < VC_SHOWCASE_IDLE) return;
  if (!vcupHasHumanOnline(sim)) return; // no one to watch: stay quiet (no churn)
  const idx = vc.showcaseCount++;
  const bracket = VC_SHOWCASE_BRACKET;
  const nationA = VC_NATION_IDS[(idx * 2) % VC_NATION_IDS.length];
  const nationB = VC_NATION_IDS[(idx * 2 + 1) % VC_NATION_IDS.length];
  const sideA: VcSide = { pids: [], nation: nationA, roles: {} };
  const sideB: VcSide = { pids: [], nation: nationB, roles: {} };
  fillSideWithBots(sim, sideA, bracket);
  fillSideWithBots(sim, sideB, bracket);
  valeCupMod.startCupMatch(sim.ctx, bracket, sideA, sideB, false);
  vc.lastActivityAt = sim.time;
}

// Called once per tick from Sim.updateValeCup (after the match module): tops up
// backfill, runs the idle exhibition, steers seated bots, and removes bots once
// the pitch frees.
export function updateValeCupBots(sim: Sim): void {
  const vc = sim.vcup;
  // Reap orphan bots: any bot no longer seated in a live match (the real one OR a
  // practice instance) has had its match torn down, so it goes home (PRD). This
  // is per-match now that practice matches run in parallel.
  const seated = new Set<number>();
  if (vc.match) for (const pid of valeCupMod.vcupAllPids(vc.match)) seated.add(pid);
  for (const pm of vc.practices) for (const pid of valeCupMod.vcupAllPids(pm)) seated.add(pid);
  if (vc.botPids.length > 0) {
    const survivors: number[] = [];
    for (const pid of vc.botPids) {
      if (seated.has(pid)) survivors.push(pid);
      else if (sim.entities.has(pid)) sim.removePlayer(pid);
    }
    if (survivors.length !== vc.botPids.length) {
      vc.botPids = survivors;
      vc.lastActivityAt = sim.time; // next exhibition waits a fresh idle stretch
    }
  }
  if (!vc.match) maybeBackfillBots(sim);
  // Track activity: a live match or a waiting queue keeps the idle timer reset;
  // otherwise, once quiet long enough, stage a showcase. (Practice matches do NOT
  // count as activity: the showcase fills the PUBLIC pitch, private practice aside.)
  if (vc.match || vcupAnyQueued(sim)) {
    vc.lastActivityAt = sim.time;
  } else {
    maybeStartShowcase(sim);
  }
  // Steer every seated bot in its OWN live match (real + each practice instance).
  const liveMatches = vc.match ? [vc.match, ...vc.practices] : [...vc.practices];
  for (const m of liveMatches) {
    for (const pid of vc.botPids) if (vcupTeamOf(m, pid)) driveCupBot(sim, pid, m);
  }
}

// ---------------------------------------------------------------------------
// Per-tick bot steering: deterministic, tick-staggered, zero rng.
// ---------------------------------------------------------------------------

// Field bots decide on abilities at most once per ~1.6s (tick-staggered per
// pid) so play breathes between kicks; keepers keep the sharp cadence because
// their saves are what makes a bot match feel fair (never degrade those).
const BOT_CAST_PERIOD = 44; // ticks (~2.2s) between a field bot's ability decisions
const BOT_KEEPER_CAST_PERIOD = 8; // ticks between a keeper's dive/clear checks (stays sharp)
const BOT_KEEPER_SHADE = 5.2; // yd the keeper shades off center (tracks the wider goal mouth)
const VC_KEEPER_GUARD_DEPTH = 1; // yd the keeper stands off its own goal line
const BOT_KICK_REACH = 3.5; // yd from the ball a bot will swing a kick
const BOT_SPRINT_BALL_DIST = 13; // yd from a loose ball a chaser pops Fresh Legs to reach it
const BOT_SHOOT_RANGE = 14; // yd from the goal mouth a bot will shoot; farther: build up
const BOT_PASS_MIN_LEAD = 6; // a teammate this much nearer the enemy goal is "ahead"
const BOT_AIM_ERROR_MAX = 3.6; // yd of perpendicular aim error at the goal line
const BOT_AIM_ERROR_PERIOD = 90; // ticks of the aim-error triangle wave (4.5s)
const BOT_LANES = [-8, 0, 8, -4, 4]; // lane z offsets by seat index

// Deterministic aim error: a triangle wave over (tickCount, bot pid). Every
// shot and long pass drifts up to +/-BOT_AIM_ERROR_MAX yd perpendicular to the
// aim line, so some shots miss or clip a post. A pure function, NO rng: the
// shared-stream draw order and run-twice replays are untouched.
function botAimError(tick: number, pid: number): number {
  const half = BOT_AIM_ERROR_PERIOD / 2;
  const phase = (tick + pid * 37) % BOT_AIM_ERROR_PERIOD;
  return (Math.abs(phase - half) / half) * 2 * BOT_AIM_ERROR_MAX - BOT_AIM_ERROR_MAX;
}

function moveBotToward(e: Entity, meta: PlayerMeta, x: number, z: number, arrive = 0.8): void {
  const d = Math.hypot(x - e.pos.x, z - e.pos.z);
  if (d <= arrive) return;
  e.facing = angleTo(e.pos, { x, y: 0, z });
  meta.moveInput.forward = true;
}

const SPORT_SHOOT_RANGE = 34; // sport_shoot.range: the bot encodes charge as aim distance

// Fire a charged shot at goal. The bot faces a goal corner (spread by the aim
// error) and casts sport_shoot with an aim point whose DISTANCE encodes the
// charge: farther from goal wants more power, but it is capped below full so a
// bot shot does not balloon over the bar the way a maxed human charge can.
function botShoot(
  sim: Sim,
  e: Entity,
  pid: number,
  enemyGoalX: number,
  distToMouth: number,
  aimErr: number,
  centerZ: number,
): void {
  const cornerZ = Math.max(
    centerZ - GOAL_HALF_W + 1,
    Math.min(centerZ + GOAL_HALF_W - 1, centerZ + aimErr),
  );
  e.facing = angleTo(e.pos, { x: enemyGoalX, y: 0, z: cornerZ });
  // Charge just enough to reach with pace but keep the loft LOW so the shot stays
  // under the bar (bots are not meant to balloon shots over the way a maxed human
  // charge can). Scales gently with distance and never nears full power.
  const frac = Math.max(0.42, Math.min(0.6, 0.4 + distToMouth / 55));
  const r = frac * SPORT_SHOOT_RANGE;
  sim.castAbility('sport_shoot', pid, {
    x: e.pos.x + Math.sin(e.facing) * r,
    z: e.pos.z + Math.cos(e.facing) * r,
  });
}

const BOT_INTERCEPT_LEAD = 0.5; // s of ball travel a chasing bot leads by

function driveCupBot(sim: Sim, pid: number, match: VcMatch): void {
  const e = sim.entities.get(pid);
  const meta = sim.players.get(pid);
  if (!e || !meta) return;
  meta.moveInput = emptyMoveInput();
  if (match.benched.has(pid)) return;
  if (match.phase !== 'active' && match.phase !== 'golden') return;
  const ball = match.ball;
  if (!ball) return;
  const team = vcupTeamOf(match, pid);
  if (!team) return;
  const role = match.roles[pid] ?? 'allrounder';
  // Geometry is Sowfield-frame; shift onto this match's pitch copy (origin {0,0}
  // for the real match, a far offset for a practice instance). Ball and entity
  // positions are already world-space, so only the fixed landmarks add origin.
  const ox = match.origin.x;
  const oz = match.origin.z;
  const centerZ = PITCH_CENTER.z + oz;
  const enemyGoalX = (team === 'A' ? GOAL_LINE_EAST_X : GOAL_LINE_WEST_X) + ox;
  const ownGoalX = (team === 'A' ? GOAL_LINE_WEST_X : GOAL_LINE_EAST_X) + ox;
  const ballPos = { x: ball.x, y: 0, z: ball.z };
  const myDistToBall = dist2d(e.pos, ballPos);
  const castPeriod = role === 'keeper' ? BOT_KEEPER_CAST_PERIOD : BOT_CAST_PERIOD;
  const wantsCast = sim.tickCount % castPeriod === pid % castPeriod;
  const goalAim = { x: enemyGoalX, z: centerZ };
  const aimErr = botAimError(sim.tickCount, pid);

  // Holding the ball (keeper grip): clear it upfield immediately with a shot.
  if (ball.holderPid === pid) {
    if (wantsCast) {
      botShoot(
        sim,
        e,
        pid,
        enemyGoalX,
        Math.hypot(ball.x - enemyGoalX, ball.z - centerZ),
        aimErr,
        centerZ,
      );
    }
    return;
  }

  if (role === 'keeper') {
    // Shot-stopping: sit right on the line and put the BODY where the shot is
    // heading. When a ball is moving toward our goal, extrapolate its path to
    // the goal line and stand on that crossing z (clamped inside the posts) so
    // the keeper's body traps the shot; otherwise shade toward the ball's angle.
    // A fast inbound also triggers a dive as a bonus interception.
    const guardX = ownGoalX + (team === 'A' ? VC_KEEPER_GUARD_DEPTH : -VC_KEEPER_GUARD_DEPTH);
    const towardOwnGoal = team === 'A' ? -ball.vx : ball.vx;
    let trackZ = ball.z;
    if (towardOwnGoal > 2 && Math.abs(ball.vx) > 1) {
      const tCross = Math.abs(guardX - ball.x) / Math.abs(ball.vx);
      trackZ = ball.z + ball.vz * tCross; // where the shot will cross the line
    }
    const guardZ = Math.max(
      centerZ - BOT_KEEPER_SHADE,
      Math.min(centerZ + BOT_KEEPER_SHADE, trackZ),
    );
    if (wantsCast && myDistToBall <= BOT_KICK_REACH) {
      // On the ball at the keeper's feet: clear it long before anything else.
      botShoot(
        sim,
        e,
        pid,
        enemyGoalX,
        Math.hypot(ball.x - enemyGoalX, ball.z - centerZ),
        aimErr,
        centerZ,
      );
    } else if (wantsCast && towardOwnGoal > 6 && ball.holderPid === null) {
      // A fast ball is coming in: dive to its predicted goal-line crossing
      // point (the dive catches a crossing ball) whenever that lands in reach.
      const ballSpeed = Math.hypot(ball.vx, ball.vz);
      const t = ballSpeed > 1 ? Math.abs(guardX - ball.x) / Math.max(1, Math.abs(ball.vx)) : 0;
      const crossZ = ball.z + ball.vz * t;
      if (t > 0 && t < 1.2 && Math.abs(crossZ - centerZ) <= BOT_KEEPER_SHADE + 1) {
        sim.castAbility('sport_dive', pid, { x: guardX, z: crossZ });
      }
    }
    moveBotToward(e, meta, guardX, guardZ, 0.4);
    return;
  }

  // Whoever on the team is nearest the ball chases it (ties break to the
  // lower pid); everyone else spreads to a lane between the ball and our goal.
  const myPids = team === 'A' ? match.teamA : match.teamB;
  let chaser = -1;
  let best = Infinity;
  for (const tPid of myPids) {
    if (match.benched.has(tPid)) continue;
    if (match.roles[tPid] === 'keeper') continue; // keepers keep goal
    const te = sim.entities.get(tPid);
    if (!te || te.dead) continue;
    const d = dist2d(te.pos, ballPos);
    if (d < best || (d === best && tPid < chaser)) {
      best = d;
      chaser = tPid;
    }
  }
  if (chaser === pid) {
    const onBall = myDistToBall <= BOT_KICK_REACH && ball.holderPid === null;
    if (wantsCast && onBall) {
      const distToMouth = dist2d(ballPos, { x: goalAim.x, y: 0, z: goalAim.z });
      const mate = botMateAhead(sim, match, team, pid, ball.x, enemyGoalX);
      if (distToMouth <= BOT_SHOOT_RANGE) {
        // In shooting range: a charged shot at a corner, spread by the aim error
        // so the set keeper saves the central ones and the outer tails miss.
        botShoot(sim, e, pid, enemyGoalX, distToMouth, aimErr, centerZ);
      } else if (mate) {
        // Too far to shoot with a teammate up the field: play a crisp lead PASS
        // (the sport_pass handler auto-paces it and leads their run). Target the
        // mate so the pass seeks them exactly.
        e.targetId = mate.id;
        e.facing = angleTo(e.pos, mate.pos);
        sim.castAbility('sport_pass', pid, { x: mate.pos.x, z: mate.pos.z });
      }
      // else: dribble toward goal (movement below).
    } else if (
      wantsCast &&
      !onBall &&
      myDistToBall > BOT_SPRINT_BALL_DIST &&
      ball.holderPid === null &&
      !e.cooldowns.has('sport_second_wind')
    ) {
      // A long way from a loose ball: find your legs and sprint onto it.
      sim.castAbility('sport_second_wind', pid);
    }
    if (myDistToBall > 1.6) {
      // Chase the INTERCEPT point, not the ball's tail: lead a moving ball by
      // a beat (clamped to the pitch) so a rolling shot can be cut off.
      const ix = Math.max(
        PITCH.xMin + 1 + ox,
        Math.min(PITCH.xMax - 1 + ox, ball.x + ball.vx * BOT_INTERCEPT_LEAD),
      );
      const iz = Math.max(
        PITCH.zMin + 1 + oz,
        Math.min(PITCH.zMax - 1 + oz, ball.z + ball.vz * BOT_INTERCEPT_LEAD),
      );
      moveBotToward(e, meta, ix, iz, 0.3);
    } else {
      // On the ball: run through it toward the enemy goal (dribbling is just
      // running with the ball).
      moveBotToward(e, meta, goalAim.x, goalAim.z, 0.3);
    }
    return;
  }
  const seat = Math.max(0, myPids.indexOf(pid));
  const laneZ = centerZ + BOT_LANES[seat % BOT_LANES.length];
  // Strikers push AHEAD of the ball into the attacking half (a real target for
  // the build-up pass); everyone else holds between the ball and our own goal.
  const holdX = role === 'striker' ? (ball.x + enemyGoalX) / 2 : (ball.x + ownGoalX) / 2;
  const clampedX = Math.max(PITCH.xMin + 2 + ox, Math.min(PITCH.xMax - 2 + ox, holdX));
  moveBotToward(e, meta, clampedX, laneZ, 1.5);
}

// The most advanced un-benched field teammate at least BOT_PASS_MIN_LEAD yd
// nearer the enemy goal than the ball (keepers never receive the build-up
// pass). Deterministic: fixed pid order breaks ties toward the earlier seat.
function botMateAhead(
  sim: Sim,
  match: VcMatch,
  team: 'A' | 'B',
  pid: number,
  ballX: number,
  enemyGoalX: number,
): Entity | null {
  const myPids = team === 'A' ? match.teamA : match.teamB;
  const ballGap = Math.abs(enemyGoalX - ballX);
  let bestE: Entity | null = null;
  let bestGap = Infinity;
  for (const tPid of myPids) {
    if (tPid === pid || match.benched.has(tPid)) continue;
    if (match.roles[tPid] === 'keeper') continue;
    const te = sim.entities.get(tPid);
    if (!te || te.dead) continue;
    const gap = Math.abs(enemyGoalX - te.pos.x);
    if (gap <= ballGap - BOT_PASS_MIN_LEAD && gap < bestGap) {
      bestGap = gap;
      bestE = te;
    }
  }
  return bestE;
}
