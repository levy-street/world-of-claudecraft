// Trial 3, The Great Pull: a team tug of war played on shrinking circles.
// Two teams share one rope; each player faces one circle at a time (spawned
// after a rolled gap, shrinking at a rolled speed) and pulls by clicking it
// (gauntletPullCircle): the closer the size is to the target when the click
// arrives, the harder the pull, and a circle that shrinks to nothing unclicked
// is a miss. The surviving NPC field heaves for both sides on a fixed cadence,
// and the marker decides the trial when it crosses winThreshold or the clock
// runs out. Every draw is run.rng in a fixed order (circle deals in
// playerStates insertion order or at a click's arrival; NPC heaves team 0 then
// team 1), so the trial never perturbs the shared world stream.
//
// Frozen contracts (do not edit here): GauntletPullTuning (types.ts, read as
// GAUNTLET.pull), GauntletPullState (state.ts), the `pull` member of
// gauntletRunWire (runs.ts), and the trench geometry in GAUNTLET_VENUE.pull.

import { GAUNTLET, GAUNTLET_VENUE } from '../content/gauntlet';
import type { SimContext } from '../sim_context';
import type { GauntletPullState, GauntletRun } from './state';
import { aliveContestants, applyVitalityDamage, cullNpcsToward } from './vitality';

// The marker sign convention: team 0 heaves positive, team 1 heaves negative.
function pullDir(team: 0 | 1): 1 | -1 {
  return team === 0 ? 1 : -1;
}

// The slot-th grip on a team's half of the rope, instance-local: team 0 lines
// up on the -x half, team 1 on +x, single file with a small alternating
// stagger so no two bodies overlap, everyone facing the pit and the enemy.
function gripSpot(team: 0 | 1, slot: number): { x: number; z: number; facing: number } {
  const V = GAUNTLET_VENUE.pull;
  const dir = team === 0 ? -1 : 1;
  return {
    x: V.x + dir * (V.gripStart + slot * V.gripSpacing),
    z: V.z + (slot % 2 === 0 ? -0.35 : 0.35),
    facing: dir === -1 ? Math.PI / 2 : -Math.PI / 2,
  };
}

// Seat EVERY contestant on the rope itself: this trial is played standing in
// the line, not watching from a rim. Players take the grips nearest the pit
// (runs.ts pins them there; the drag pass slides the pins), NPC teammates
// fill in behind. Direct pos writes, no rng draws.
function seatRopeLine(
  ctx: SimContext,
  run: GauntletRun,
  teamOf: Map<number, 0 | 1>,
): Map<number, { x: number; z: number }> {
  const base = new Map<number, { x: number; z: number }>();
  const slots: [number, number] = [0, 0];
  const take = (entityId: number, team: 0 | 1) => {
    const e = ctx.entities.get(entityId);
    if (!e) return;
    const s = gripSpot(team, slots[team]++);
    e.pos = ctx.groundPos(run.origin.x + s.x, run.origin.z + s.z);
    e.prevPos = { ...e.pos };
    e.facing = s.facing;
    ctx.rebucket(e);
    base.set(entityId, { x: s.x, z: s.z });
  };
  for (const [pid, team] of teamOf) {
    const ps = run.playerStates.get(pid);
    if (!ps || ps.spectating) continue;
    take(pid, team);
  }
  const npcs = aliveContestants(run).filter((c) => !c.player);
  for (let i = 0; i < npcs.length; i++) take(npcs[i].entityId, (i % 2) as 0 | 1);
  return base;
}

export function startPull(ctx: SimContext, run: GauntletRun): GauntletPullState {
  // Team split: 2+ live players alternate 0, 1, 0, 1... in join (insertion)
  // order; a lone player is team 0 against an all-NPC team 1.
  const teamOf = new Map<number, 0 | 1>();
  const livePids: number[] = [];
  for (const [pid, ps] of run.playerStates) {
    if (!ps.spectating) livePids.push(pid);
  }
  if (livePids.length >= 2) {
    for (let i = 0; i < livePids.length; i++) teamOf.set(livePids[i], (i % 2) as 0 | 1);
  } else {
    for (const pid of livePids) teamOf.set(pid, 0);
  }

  const heaveAnchor = ctx.time + GAUNTLET.pull.leadInS;
  // The two per-team per-heave NPC pull means, drawn team 0 then team 1.
  const npcForce: [number, number] = [
    run.rng.range(GAUNTLET.pull.npcForceMin, GAUNTLET.pull.npcForceMax),
    run.rng.range(GAUNTLET.pull.npcForceMin, GAUNTLET.pull.npcForceMax),
  ];

  const gripBase = seatRopeLine(ctx, run, teamOf);

  const trial: GauntletPullState = {
    kind: 'pull',
    marker: 0,
    heaveAnchor,
    teamOf,
    npcForce,
    circles: new Map(),
    nextCircleId: 0,
    gripBase,
    kx: 0,
    resolved: false,
    wonBy: null,
  };
  // The opening circle deal, one per live player in playerStates insertion
  // order (the fixed-order determinism contract), anchored past the lead-in
  // so everyone has a beat to find the rope before the first circle appears.
  for (const [pid, ps] of run.playerStates) {
    if (ps.spectating || !teamOf.has(pid)) continue;
    dealCircle(run, trial, pid, ctx.time + GAUNTLET.pull.leadInS);
  }
  return trial;
}

// Deal the pid's next circle: a rolled gap after `at`, and a rolled
// full-shrink duration (the circle's "random speed"). Two run.rng draws, so
// call sites keep the fixed-order contract (playerStates iteration order in
// the tick sweep; a click's arrival is its own well-defined moment).
function dealCircle(run: GauntletRun, trial: GauntletPullState, pid: number, at: number): void {
  const P = GAUNTLET.pull;
  const gap = run.rng.range(P.circleSpawnMinS, P.circleSpawnMaxS);
  const shrinkS = run.rng.range(P.circleShrinkMinS, P.circleShrinkMaxS);
  trial.circles.set(pid, { id: trial.nextCircleId++, spawnAt: at + gap, shrinkS });
}

// The circle's abstract size at time t: startSize at spawnAt, shrinking
// linearly to 0 at spawnAt + shrinkS (floored there; expiry is a miss).
export function circleSizeAt(circle: { spawnAt: number; shrinkS: number }, t: number): number {
  const P = GAUNTLET.pull;
  return Math.max(
    0,
    P.circleStartSize - (P.circleStartSize / circle.shrinkS) * (t - circle.spawnAt),
  );
}

// A player clicks their live circle `id`. Graded by the size at RECEIPT
// (ctx.time, the honest authoritative clock; a client-reported size is never
// trusted): force falls off with distance from the target size in both
// directions, hitting zero at a full target-size of error. The circle is
// consumed and the next one dealt on the spot; a stale id (already resolved)
// or a not-yet-spawned circle drops silently.
export function gauntletPullCircleClick(
  ctx: SimContext,
  run: GauntletRun,
  trial: GauntletPullState,
  pid: number,
  id: number,
): void {
  if (trial.resolved) return;
  const team = trial.teamOf.get(pid);
  if (team === undefined) return; // not a tug contestant
  const c = trial.circles.get(pid);
  if (!c || c.id !== id) return; // replay or a stale circle: consumed already
  if (ctx.time < c.spawnAt) return; // not on screen yet
  const P = GAUNTLET.pull;
  const size = circleSizeAt(c, ctx.time);
  const grade = Math.max(0, 1 - Math.abs(size - P.circleTargetSize) / P.circleTargetSize);
  trial.marker += pullDir(team) * P.pullForceMax * grade ** P.gradePower;
  dealCircle(run, trial, pid, ctx.time);
}

// One tick of the tug. Returns true once the marker (or the clock) has decided
// the trial and the end-of-trial damage + NPC cull have been dealt.
export function updatePull(ctx: SimContext, run: GauntletRun, dt: number): boolean {
  const trial = run.trial;
  if (!trial || trial.kind !== 'pull') return true;
  if (trial.resolved) return true;

  const prevTime = ctx.time - dt;

  // Expire circles that shrank to nothing unclicked: a miss pulls nothing and
  // the next circle is dealt on the spot. Fixed iteration order (playerStates
  // insertion order); a knocked-out player's schedule is dropped without a
  // draw, so an elimination never shifts the survivors' deals.
  for (const [pid, ps] of run.playerStates) {
    if (ps.spectating) {
      trial.circles.delete(pid);
      continue;
    }
    const c = trial.circles.get(pid);
    if (c && ctx.time >= c.spawnAt + c.shrinkS) dealCircle(run, trial, pid, ctx.time);
  }

  // Every heave boundary since the last tick (a catch-up loop, so a slow tick
  // resolves every crossed heave deterministically), each side heaves with its
  // NPC field. Draw order is fixed: team 0 then team 1, per heave.
  const period = GAUNTLET.pull.npcHeavePeriodS;
  const prevHeave = Math.floor((prevTime - trial.heaveAnchor) / period);
  const nowHeave = Math.floor((ctx.time - trial.heaveAnchor) / period);
  for (let b = Math.max(0, prevHeave + 1); b <= nowHeave; b++) {
    heaveNpcField(run, trial);
  }

  dragRopeLine(ctx, run, trial, dt);

  const winner = resolveWinner(ctx, run, trial);
  if (winner === null) return false;
  finishPull(ctx, run, trial, winner);
  return true;
}

// Slide the whole line with the rope. The eased drag tracks the marker
// (+ marker = team 0 winning = the rope hauled toward team 0's side, -x), and
// every grip translates with it, players via their station pin so the winning
// team visibly steps back while the losers are dragged onto the pit. Purely
// deterministic (fixed DT ease, no rng); the venue eases its rope mesh toward
// the same target so hands stay on the rope.
function dragRopeLine(ctx: SimContext, run: GauntletRun, trial: GauntletPullState, dt: number) {
  const frac = Math.max(-1, Math.min(1, trial.marker / GAUNTLET.pull.winThreshold));
  const target = -frac * GAUNTLET_VENUE.pull.knotTravel;
  trial.kx += (target - trial.kx) * Math.min(1, dt * 8);
  for (const [entityId, base] of trial.gripBase) {
    const e = ctx.entities.get(entityId);
    if (!e) continue;
    const c = run.contestants.find((k) => k.entityId === entityId);
    if (!c || c.eliminatedAtTrial !== null) continue;
    const ps = run.playerStates.get(entityId);
    if (ps?.spectating) continue;
    const wx = run.origin.x + base.x + trial.kx;
    if (ps?.heldAt) ps.heldAt.x = wx;
    if (!c.player) e.prevPos = { ...e.pos };
    e.pos.x = wx;
  }
}

// One heave of NPC force: npcForce[team] is each side's WHOLE per-heave NPC
// force (deliberately NOT scaled by the surviving field size: with a ~29-NPC
// fresh field a per-NPC model swamps a player's graded clicks and the rope
// decides itself off the npcForce draw; playtest verdict was that the
// PLAYER's timing must be what wins the pull), plus a small per-heave jitter
// (band derived from the npcForce spread). With no NPCs on the rope there is
// no force and no draw.
function heaveNpcField(run: GauntletRun, trial: GauntletPullState): void {
  const npcCount = aliveContestants(run).filter((c) => !c.player).length;
  if (npcCount === 0) return;
  const jitterMag = (GAUNTLET.pull.npcForceMax - GAUNTLET.pull.npcForceMin) / 2;
  for (const team of [0, 1] as const) {
    const jitter = run.rng.range(-jitterMag, jitterMag);
    const force = trial.npcForce[team] + jitter;
    trial.marker += pullDir(team) * force;
  }
}

// The marker resolves to a winner on a threshold cross, or on the clock. On the
// clock the larger marker magnitude wins; a dead-even (0) marker breaks toward
// team 1, so team 0 loses the drama tiebreak.
function resolveWinner(ctx: SimContext, run: GauntletRun, trial: GauntletPullState): 0 | 1 | null {
  if (trial.marker >= GAUNTLET.pull.winThreshold) return 0;
  if (trial.marker <= -GAUNTLET.pull.winThreshold) return 1;
  if (ctx.time >= run.phaseEndsAt) return trial.marker > 0 ? 0 : 1;
  return null;
}

// End-of-trial resolution: every live player on the losing team eats lossDamage
// (a big chunk, not a kill unless they were already low); the winners take zero
// and record their finish. Then the NPC field thins toward the trial target.
function finishPull(
  ctx: SimContext,
  run: GauntletRun,
  trial: GauntletPullState,
  winner: 0 | 1,
): void {
  trial.resolved = true;
  trial.wonBy = winner;
  const loser: 0 | 1 = winner === 0 ? 1 : 0;
  for (const c of aliveContestants(run)) {
    if (!c.player) continue;
    const team = trial.teamOf.get(c.entityId);
    if (team === undefined) continue;
    if (team === loser) {
      applyVitalityDamage(ctx, run, c, GAUNTLET.pull.lossDamage, 'trial');
    } else {
      const ps = run.playerStates.get(c.entityId);
      if (ps && ps.finishedAt === null) ps.finishedAt = ctx.time;
    }
  }
  cullNpcsToward(ctx, run);
}
