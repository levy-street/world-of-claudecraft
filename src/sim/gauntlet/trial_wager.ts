// Trial 4, Keeper's Wager: a marble duel against a paired partner. Each live
// player is matched with a seeded NPC partner and they trade a hidden odd/even
// bet under a per-round clock. On a hold round the player hides 1..5 of their
// own marbles and the partner guesses the parity (a skill-biased roll); on a
// guess round the partner hides and the player calls odd or even. Winning a
// round moves `wager` marbles from loser to winner; the roles flip every round.
// First side to zero marbles ends the pair (a zero-marble player takes the
// elimination-scale lossDamage). Timing out a round forfeits the wager, and at
// the trial cap an unfinished pair pays for its marble deficit. All state lives
// on the run; every numeric knob comes from GAUNTLET.wager (content/gauntlet.ts).

import {
  GAUNTLET,
  GAUNTLET_CONTESTANT_FIRST_NAMES,
  GAUNTLET_CONTESTANT_LAST_NAMES,
  GAUNTLET_VENUE,
} from '../content/gauntlet';
import type { SimContext } from '../sim_context';
import { placeContestantsAt } from './contestants';
import type { GauntletRun, GauntletWagerPair, GauntletWagerState } from './state';
import { applyVitalityDamage, cullNpcsToward } from './vitality';

// The stakes never exceed either purse and never drop below 1. Re-applied each
// round (marble counts shrink) and whenever the player sets a new bet.
function clampWager(pair: GauntletWagerPair, desired: number): number {
  const cap = Math.max(1, Math.min(GAUNTLET.wager.maxWager, pair.mine, pair.theirs));
  const want = Math.floor(desired);
  if (!Number.isFinite(want)) return 1;
  return Math.max(1, Math.min(cap, want));
}

// How many marbles the hider tucks away this round: 1..min(5, own purse).
function hiddenCount(rng: GauntletRun['rng'], purse: number): number {
  return rng.int(1, Math.max(1, Math.min(5, purse)));
}

// Open a fresh round for a pair. The stage mirrors who hides; on a guess round
// the partner's hidden count is drawn NOW (one draw, a well-defined moment) so
// the player's later guess resolves with no further randomness.
function beginRound(ctx: SimContext, run: GauntletRun, pair: GauntletWagerPair): void {
  pair.stage = pair.holder ? 'hold' : 'guess';
  pair.wager = clampWager(pair, pair.wager);
  pair.held = pair.holder ? 0 : hiddenCount(run.rng, pair.theirs);
  pair.roundEndsAt = ctx.time + GAUNTLET.wager.roundS;
}

// Finish the duel once a purse empties: the winner banks a finish time, the
// broke player takes the elimination-scale loss.
function finishPair(ctx: SimContext, run: GauntletRun, pair: GauntletWagerPair): void {
  pair.finished = true;
  pair.stage = 'done';
  pair.won = pair.theirs === 0 && pair.mine > 0;
  if (pair.won) {
    const ps = run.playerStates.get(pair.pid);
    if (ps && ps.finishedAt === null) ps.finishedAt = ctx.time;
    return;
  }
  const c = run.contestants.find((k) => k.entityId === pair.pid);
  if (c) applyVitalityDamage(ctx, run, c, GAUNTLET.wager.lossDamage, 'trial');
}

// Move marbles between the purses. delta > 0 is the player winning `delta` from
// the partner; delta < 0 is the player losing. Clamped so neither purse goes
// negative; a purse hitting zero finishes the pair.
function transferMarbles(
  ctx: SimContext,
  run: GauntletRun,
  pair: GauntletWagerPair,
  delta: number,
): void {
  if (delta > 0) {
    const move = Math.min(delta, pair.theirs);
    pair.mine += move;
    pair.theirs -= move;
  } else {
    const move = Math.min(-delta, pair.mine);
    pair.mine -= move;
    pair.theirs += move;
  }
  if (pair.mine <= 0 || pair.theirs <= 0) finishPair(ctx, run, pair);
}

// Resolve a round in the player's favor (won === true moves the wager to them),
// then flip roles and open the next round unless the pair just finished.
function resolveRound(
  ctx: SimContext,
  run: GauntletRun,
  pair: GauntletWagerPair,
  playerWon: boolean,
): void {
  transferMarbles(ctx, run, pair, playerWon ? pair.wager : -pair.wager);
  if (pair.finished) return;
  pair.holder = !pair.holder;
  beginRound(ctx, run, pair);
}

export function startWager(ctx: SimContext, run: GauntletRun): GauntletWagerState {
  placeContestantsAt(ctx, run, GAUNTLET_VENUE.wager.x, GAUNTLET_VENUE.wager.z, 6);
  const pairs = new Map<number, GauntletWagerPair>();
  for (const [pid, ps] of run.playerStates) {
    if (ps.spectating) continue;
    const first = run.rng.pick([...GAUNTLET_CONTESTANT_FIRST_NAMES]);
    const last = run.rng.pick([...GAUNTLET_CONTESTANT_LAST_NAMES]);
    const pair: GauntletWagerPair = {
      pid,
      partnerName: `${first} ${last}`,
      partnerSkill: run.rng.range(GAUNTLET.npcSkillMin, GAUNTLET.npcSkillMax),
      mine: GAUNTLET.wager.startingMarbles,
      theirs: GAUNTLET.wager.startingMarbles,
      holder: run.rng.chance(0.5),
      stage: 'hold',
      held: 0,
      wager: 1,
      roundEndsAt: ctx.time + GAUNTLET.wager.roundS,
      finished: false,
      won: false,
    };
    beginRound(ctx, run, pair);
    pairs.set(pid, pair);
  }
  return { kind: 'wager', pairs };
}

export function gauntletWagerAct(
  ctx: SimContext,
  run: GauntletRun,
  trial: GauntletWagerState,
  pid: number,
  action: string,
  n: number,
): void {
  const pair = trial.pairs.get(pid);
  if (!pair || pair.finished) return;

  // Re-bet: legal any time before the round resolves; auto-clamped to the purses.
  if (action === 'wager') {
    pair.wager = clampWager(pair, n);
    return;
  }

  // The player hides: pick 1..min(5, own purse), then the partner guesses the
  // parity with one skill-biased draw. A correct guess loses the player the wager.
  if (action === 'hold') {
    if (!pair.holder || pair.stage !== 'hold') return;
    pair.held = Math.max(1, Math.min(Math.min(5, pair.mine), Math.floor(n) || 1));
    const partnerGuessedRight = run.rng.chance(0.5 + 0.3 * pair.partnerSkill);
    resolveRound(ctx, run, pair, !partnerGuessedRight);
    return;
  }

  // The player guesses the partner's hidden parity (n === 1 odd, else even).
  // The hidden count was drawn at the round's start, so this resolves with no
  // further randomness.
  if (action === 'guess') {
    if (pair.holder || pair.stage !== 'guess') return;
    const guessOdd = n === 1;
    const trueOdd = pair.held % 2 === 1;
    resolveRound(ctx, run, pair, guessOdd === trueOdd);
  }
}

// One unfinished pair timing out its round: the player forfeits the wager, then
// the next round opens.
function forfeitRound(ctx: SimContext, run: GauntletRun, pair: GauntletWagerPair): void {
  transferMarbles(ctx, run, pair, -pair.wager);
  if (pair.finished) return;
  pair.holder = !pair.holder;
  beginRound(ctx, run, pair);
}

// The trial cap caught an unfinished pair: a purse behind its partner pays the
// per-marble deficit toll; even or ahead walks away clean.
function resolveCap(ctx: SimContext, run: GauntletRun, trial: GauntletWagerState): void {
  for (const pair of trial.pairs.values()) {
    if (pair.finished) continue;
    pair.stage = 'done';
    pair.finished = true;
    if (pair.mine < pair.theirs) {
      const deficit = pair.theirs - pair.mine;
      const c = run.contestants.find((k) => k.entityId === pair.pid);
      if (c) {
        applyVitalityDamage(ctx, run, c, GAUNTLET.wager.damagePerMarbleShort * deficit, 'timeout');
      }
    }
  }
}

export function updateWager(ctx: SimContext, run: GauntletRun, dt: number): boolean {
  void dt;
  const trial = run.trial;
  if (!trial || trial.kind !== 'wager') return true;

  for (const pair of trial.pairs.values()) {
    if (!pair.finished && ctx.time >= pair.roundEndsAt) forfeitRound(ctx, run, pair);
  }

  const capHit = ctx.time >= run.phaseEndsAt;
  let allDone = true;
  for (const pair of trial.pairs.values()) {
    if (!pair.finished) {
      allDone = false;
      break;
    }
  }
  if (allDone || capHit) {
    if (capHit) resolveCap(ctx, run, trial);
    cullNpcsToward(ctx, run);
    return true;
  }
  return false;
}
