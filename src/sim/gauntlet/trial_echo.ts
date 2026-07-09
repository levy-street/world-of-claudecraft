// Trial 4, the Keeper's Echo: a memory duel against the Keeper's rune stones.
// Each live player is seated at their own table row; every round the four
// stones flash a seeded sequence (drawn from run.rng at round start, rendered
// client-side from the absolute schedule on the wire), then the player clicks
// the stones back in the same order inside the answer window. A wrong stone
// or a timed-out round costs vitality and deals a FRESH sequence for the same
// round; clearing every round finishes the trial and banks the finish time.
// All state lives on the run; every numeric knob is GAUNTLET.echo.

import { echoStation, GAUNTLET } from '../content/gauntlet';
import type { SimContext } from '../sim_context';
import { seatAllContestantsAt } from './contestants';
import type { GauntletEchoPlayer, GauntletEchoState, GauntletRun } from './state';
import { applyVitalityDamage, cullNpcsToward, trialDamageFromScore } from './vitality';

// The breath between the round opening (or a miss) and the first flash.
const SHOW_LEAD_S = 1;

// Deal a round's fresh sequence and schedule its watch + answer windows. The
// sequence length grows with the round; every value is one run.rng draw, in a
// fixed order, so identical input streams stay deterministic.
function dealRound(ctx: SimContext, run: GauntletRun, ep: GauntletEchoPlayer): void {
  const t = GAUNTLET.echo;
  const len = t.baseLen + ep.round;
  ep.seq = [];
  for (let i = 0; i < len; i++) ep.seq.push(run.rng.int(0, t.stones - 1));
  ep.progress = 0;
  ep.showStartAt = ctx.time + SHOW_LEAD_S;
  ep.inputEndsAt = ep.showStartAt + len * t.stepS + t.inputS;
}

// A miss (wrong stone or timeout): a vitality chunk, then the SAME round is
// re-dealt with a fresh sequence (a knockout ends the duel instead).
function missRound(ctx: SimContext, run: GauntletRun, pid: number, ep: GauntletEchoPlayer): void {
  ep.misses++;
  const c = run.contestants.find((k) => k.entityId === pid);
  if (c) applyVitalityDamage(ctx, run, c, GAUNTLET.echo.missDamage, 'caught');
  if (c && c.eliminatedAtTrial !== null) {
    ep.done = true; // knocked out: the stones go dark
    return;
  }
  dealRound(ctx, run, ep);
}

// Seat EVERY alive contestant (players and the NPC field alike) at their own
// auto-assigned rune-stone desk, so the courtyard reads as a hall of memory
// desks with someone at each rather than one table ringed by a crowd. The venue
// draws a desk at every station and anchors the live rig to the viewer's own.
// Positioning only (no state, no rng: aliveContestants is a stable order), so
// runs.ts can call it during the interlude to stand everyone at their desks
// while the countdown runs, and startEcho reuses it.
export function seatEchoField(ctx: SimContext, run: GauntletRun): void {
  seatAllContestantsAt(ctx, run, (i) => {
    const s = echoStation(i);
    return { x: s.matX, z: s.matZ, facing: s.facing };
  });
}

export function startEcho(ctx: SimContext, run: GauntletRun): GauntletEchoState {
  const players = new Map<number, GauntletEchoPlayer>();
  const eligible = [...run.playerStates.keys()].filter(
    (pid) => !run.playerStates.get(pid)?.spectating,
  );
  for (const pid of eligible) {
    const ep: GauntletEchoPlayer = {
      round: 0,
      seq: [],
      showStartAt: 0,
      inputEndsAt: 0,
      progress: 0,
      misses: 0,
      done: false,
    };
    dealRound(ctx, run, ep);
    players.set(pid, ep);
  }
  // runs.ts pins the seated players at their desks for the trial; the same
  // seating already ran when the interlude opened.
  seatEchoField(ctx, run);
  return { kind: 'echo', players };
}

// A stone tap from the IWorld surface. Only counts during the answer window;
// taps while the stones are still flashing (or after finishing) drop silently.
export function gauntletEchoTap(
  ctx: SimContext,
  run: GauntletRun,
  trial: GauntletEchoState,
  pid: number,
  stone: number,
): void {
  const ep = trial.players.get(pid);
  if (!ep || ep.done) return;
  const c = run.contestants.find((k) => k.entityId === pid);
  if (!c || c.eliminatedAtTrial !== null) return;
  const t = GAUNTLET.echo;
  if (!Number.isInteger(stone) || stone < 0 || stone >= t.stones) return;
  const showEndsAt = ep.showStartAt + ep.seq.length * t.stepS;
  if (ctx.time < showEndsAt || ctx.time >= ep.inputEndsAt) return;
  // Every GRADED tap is judged to the clicker (out-of-window taps above drop
  // silently, they were never in play): the client flashes the clicked stone
  // green or red so success and failure both read instantly.
  if (stone !== ep.seq[ep.progress]) {
    ctx.emit({ type: 'gauntletEchoJudge', stone, ok: false, pid });
    missRound(ctx, run, pid, ep);
    return;
  }
  ctx.emit({ type: 'gauntletEchoJudge', stone, ok: true, pid });
  ep.progress++;
  if (ep.progress < ep.seq.length) return;
  // Round cleared: the next one grows, or the trial is beaten.
  ep.round++;
  if (ep.round >= t.rounds) {
    ep.done = true;
    const ps = run.playerStates.get(pid);
    if (ps && ps.finishedAt === null) ps.finishedAt = ctx.time;
    return;
  }
  dealRound(ctx, run, ep);
}

export function updateEcho(ctx: SimContext, run: GauntletRun, dt: number): boolean {
  void dt;
  const trial = run.trial;
  if (!trial || trial.kind !== 'echo') return true;

  let allDone = true;
  for (const [pid, ep] of trial.players) {
    if (ep.done) continue;
    // A player who left the run mid-duel orphans their entry.
    if (!run.playerStates.has(pid)) {
      ep.done = true;
      continue;
    }
    if (ctx.time >= ep.inputEndsAt) missRound(ctx, run, pid, ep);
    if (!ep.done) allDone = false;
  }

  if (!allDone && ctx.time < run.phaseEndsAt) return false;
  endEcho(ctx, run, trial);
  return true;
}

// End-of-trial damage: an unfinished player takes damage scaled by how few
// rounds they cleared (rounds / target as the 0..1 score); a finisher takes
// nothing. Then thin the NPC field toward this trial's target exactly once.
function endEcho(ctx: SimContext, run: GauntletRun, trial: GauntletEchoState): void {
  for (const c of run.contestants) {
    if (!c.player || c.eliminatedAtTrial !== null) continue;
    const ps = run.playerStates.get(c.entityId);
    if (!ps || ps.spectating) continue;
    const ep = trial.players.get(c.entityId);
    if (!ep) continue;
    if (ep.round >= GAUNTLET.echo.rounds) continue; // beat the stones: no toll
    const score = ep.round / GAUNTLET.echo.rounds;
    applyVitalityDamage(ctx, run, c, trialDamageFromScore(score, GAUNTLET.echo.damageMax), 'trial');
  }
  cullNpcsToward(ctx, run);
}
