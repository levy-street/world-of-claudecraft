// Trial 3, The Great Pull: a team tug of war on a sim-defined beat. Two teams
// share one rope; players heave by claiming beat indexes (gauntletPullBeat),
// the surviving NPC field heaves for both sides on every beat, and the marker
// decides the trial when it crosses winThreshold or the clock runs out. Every
// draw is run.rng in a fixed order (per beat: team 0 then team 1), so the trial
// never perturbs the shared world stream.
//
// Frozen contracts (do not edit here): GauntletPullTuning (types.ts, read as
// GAUNTLET.pull), GauntletPullState (state.ts), the `pull` member of
// gauntletRunWire (runs.ts), and the trench geometry in GAUNTLET_VENUE.pull.

import { GAUNTLET, GAUNTLET_VENUE } from '../content/gauntlet';
import type { SimContext } from '../sim_context';
import { placeContestantsAt, seatLivePlayersAt } from './contestants';
import type { GauntletPullState, GauntletRun } from './state';
import { aliveContestants, applyVitalityDamage, cullNpcsToward } from './vitality';

// The marker sign convention: team 0 heaves positive, team 1 heaves negative.
function pullDir(team: 0 | 1): 1 | -1 {
  return team === 0 ? 1 : -1;
}

// Where the i-th of n live players stands for the pull: the south rim of the
// trench, spread along the rope, facing -z toward it and the beat drum
// (runs.ts pins them there for the trial).
function trenchRimSpot(i: number, n: number): { x: number; z: number; facing: number } {
  const { x, z, width } = GAUNTLET_VENUE.pull;
  return { x: x + (i - (n - 1) / 2) * 3, z: z + width / 2 + 4, facing: Math.PI };
}

export function startPull(ctx: SimContext, run: GauntletRun): GauntletPullState {
  // The NPC crowd fans along the banks below; the players watch the whole
  // rope from the south rim.
  placeContestantsAt(ctx, run, GAUNTLET_VENUE.pull.x, GAUNTLET_VENUE.pull.z + 12, 10);
  seatLivePlayersAt(ctx, run, trenchRimSpot);

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

  const beatAnchor = ctx.time + 2;
  // The two per-team per-beat NPC pull means, drawn team 0 then team 1.
  const npcForce: [number, number] = [
    run.rng.range(GAUNTLET.pull.npcForceMin, GAUNTLET.pull.npcForceMax),
    run.rng.range(GAUNTLET.pull.npcForceMin, GAUNTLET.pull.npcForceMax),
  ];

  lineUpRopeNpcs(ctx, run);

  return {
    kind: 'pull',
    beatAnchor,
    marker: 0,
    braceUntil: beatAnchor + GAUNTLET.pull.braceWindowS,
    braced: new Set(),
    claimed: new Map(),
    teamOf,
    npcForce,
    resolved: false,
    wonBy: null,
  };
}

// Cosmetic only: fan the surviving NPC contestants along both banks of the
// trench (team 0 on the -x bank, team 1 on the +x bank). Direct pos writes, no
// rng draws, no gameplay effect.
function lineUpRopeNpcs(ctx: SimContext, run: GauntletRun): void {
  const V = GAUNTLET_VENUE.pull;
  const cx = run.origin.x + V.x;
  const cz = run.origin.z + V.z;
  const npcs = aliveContestants(run).filter((c) => !c.player);
  for (let i = 0; i < npcs.length; i++) {
    const e = ctx.entities.get(npcs[i].entityId);
    if (!e) continue;
    const dir = i % 2 === 0 ? -1 : 1; // even -> team 0 bank, odd -> team 1 bank
    const rank = Math.floor(i / 2);
    const along = Math.min(2 + rank * 1.4, V.length / 2);
    const lateral = ((rank % 3) - 1) * (V.width / 4);
    e.pos = { x: cx + dir * along, y: 0, z: cz + lateral };
    e.prevPos = { x: e.pos.x, y: e.pos.y, z: e.pos.z };
    e.facing = dir === -1 ? Math.PI / 2 : -Math.PI / 2; // face across the rope
    ctx.rebucket(e);
  }
}

// A player claims beat index `beat` (derived client-side from beatAnchor +
// beatPeriodS). The claim heaves the marker toward the puller's side when it
// lands inside acceptWindowS/2 of the beat's true time, harder on a perfect
// (perfectWindowS/2) hit. A claim landed before braceUntil also lands the
// opening brace for that pid.
export function gauntletPullBeat(
  ctx: SimContext,
  run: GauntletRun,
  trial: GauntletPullState,
  pid: number,
  beat: number,
): void {
  void run;
  if (trial.resolved) return;
  const team = trial.teamOf.get(pid);
  if (team === undefined) return; // not a tug contestant
  if (beat < 0) return;
  // claimed holds the highest beat this pid already consumed: reject replays and
  // out-of-order (<=) claims.
  const highest = trial.claimed.get(pid);
  if (highest !== undefined && beat <= highest) return;
  const beatTime = trial.beatAnchor + beat * GAUNTLET.pull.beatPeriodS;
  const off = Math.abs(ctx.time - beatTime);
  if (off > GAUNTLET.pull.acceptWindowS / 2) return;
  const perfect = off <= GAUNTLET.pull.perfectWindowS / 2;
  const force = GAUNTLET.pull.pullForce * (perfect ? GAUNTLET.pull.perfectMult : 1);
  trial.marker += pullDir(team) * force;
  trial.claimed.set(pid, beat);
  if (ctx.time < trial.braceUntil) trial.braced.add(pid);
}

// One tick of the tug. Returns true once the marker (or the clock) has decided
// the trial and the end-of-trial damage + NPC cull have been dealt.
export function updatePull(ctx: SimContext, run: GauntletRun, dt: number): boolean {
  const trial = run.trial;
  if (!trial || trial.kind !== 'pull') return true;
  if (trial.resolved) return true;

  const prevTime = ctx.time - dt;

  // The opening brace resolves once, on the first tick to cross braceUntil: any
  // team whose live players did not all land a pull in time eats the yank toward
  // its opponent. A team with no live players (all-NPC, or empty) always braces.
  if (prevTime < trial.braceUntil && ctx.time >= trial.braceUntil) {
    for (const team of [0, 1] as const) {
      if (teamMissedBrace(run, trial, team)) {
        trial.marker += -pullDir(team) * GAUNTLET.pull.openingYank;
      }
    }
  }

  // Every beat boundary since the last tick (a catch-up loop, so a slow tick
  // resolves every crossed beat deterministically), each side heaves with its
  // NPC field. Draw order is fixed: team 0 then team 1, per beat.
  const period = GAUNTLET.pull.beatPeriodS;
  const prevBeat = Math.floor((prevTime - trial.beatAnchor) / period);
  const nowBeat = Math.floor((ctx.time - trial.beatAnchor) / period);
  for (let b = Math.max(0, prevBeat + 1); b <= nowBeat; b++) {
    heaveNpcBeat(run, trial);
  }

  const winner = resolveWinner(ctx, run, trial);
  if (winner === null) return false;
  finishPull(ctx, run, trial, winner);
  return true;
}

// A team missed the brace when a live (attached, non-spectating) player on it
// never landed a pull before braceUntil. Zero live players counts as braced.
function teamMissedBrace(run: GauntletRun, trial: GauntletPullState, team: 0 | 1): boolean {
  for (const [pid, t] of trial.teamOf) {
    if (t !== team) continue;
    const ps = run.playerStates.get(pid);
    if (!ps || ps.spectating) continue; // left or knocked-out players do not count
    if (!trial.braced.has(pid)) return true;
  }
  return false;
}

// One beat of NPC heave: npcForce[team] is each side's WHOLE per-beat NPC
// force (deliberately NOT scaled by the surviving field size: with a ~29-NPC
// fresh field a per-NPC model swamps a player's 1.15..1.84 per beat and the
// rope decides itself off the npcForce draw; playtest verdict was that the
// PLAYER's timing must be what wins the pull), plus a small per-beat jitter
// (band derived from the npcForce spread). With no NPCs on the rope there is
// no force and no draw.
function heaveNpcBeat(run: GauntletRun, trial: GauntletPullState): void {
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
