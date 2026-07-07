// Trial 4, Keeper's Wager: a marble duel against a paired partner. STUB:
// teleports the field to the courtyard and resolves after a short beat; the
// real round machine lands in this file (contracts: GauntletWagerTuning in
// types.ts, GauntletWagerState/GauntletWagerPair in state.ts).

import {
  GAUNTLET,
  GAUNTLET_CONTESTANT_FIRST_NAMES,
  GAUNTLET_CONTESTANT_LAST_NAMES,
  GAUNTLET_VENUE,
} from '../content/gauntlet';
import type { SimContext } from '../sim_context';
import { placeContestantsAt } from './contestants';
import type { GauntletRun, GauntletWagerState } from './state';
import { cullNpcsToward } from './vitality';

export function startWager(ctx: SimContext, run: GauntletRun): GauntletWagerState {
  placeContestantsAt(ctx, run, GAUNTLET_VENUE.wager.x, GAUNTLET_VENUE.wager.z, 6);
  const pairs = new Map();
  for (const [pid, ps] of run.playerStates) {
    if (ps.spectating) continue;
    const first = run.rng.pick([...GAUNTLET_CONTESTANT_FIRST_NAMES]);
    const last = run.rng.pick([...GAUNTLET_CONTESTANT_LAST_NAMES]);
    pairs.set(pid, {
      pid,
      partnerName: `${first} ${last}`,
      partnerSkill: run.rng.range(GAUNTLET.npcSkillMin, GAUNTLET.npcSkillMax),
      mine: GAUNTLET.wager.startingMarbles,
      theirs: GAUNTLET.wager.startingMarbles,
      holder: run.rng.chance(0.5),
      stage: 'hold' as const,
      held: 0,
      wager: 1,
      roundEndsAt: ctx.time + GAUNTLET.wager.roundS,
      finished: false,
      won: false,
    });
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
  void ctx;
  void run;
  void trial;
  void pid;
  void action;
  void n;
}

export function updateWager(ctx: SimContext, run: GauntletRun, dt: number): boolean {
  void dt;
  const stubEndsAt = run.phaseEndsAt - GAUNTLET.wager.durationS + 6;
  if (ctx.time < stubEndsAt) return false;
  cullNpcsToward(ctx, run);
  return true;
}
