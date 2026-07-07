// Trial 3, The Great Pull: team tug of war on a sim-defined beat. STUB:
// teleports the field to the trench and resolves after a short beat; the real
// beat machine lands in this file (contracts: GauntletPullTuning in types.ts,
// GauntletPullState in state.ts).

import { GAUNTLET, GAUNTLET_VENUE } from '../content/gauntlet';
import type { SimContext } from '../sim_context';
import { placeContestantsAt } from './contestants';
import type { GauntletPullState, GauntletRun } from './state';
import { cullNpcsToward } from './vitality';

export function startPull(ctx: SimContext, run: GauntletRun): GauntletPullState {
  placeContestantsAt(ctx, run, GAUNTLET_VENUE.pull.x, GAUNTLET_VENUE.pull.z + 12, 10);
  const teamOf = new Map<number, 0 | 1>();
  for (const [pid, ps] of run.playerStates) {
    if (!ps.spectating) teamOf.set(pid, 0);
  }
  return {
    kind: 'pull',
    beatAnchor: ctx.time + 2,
    marker: 0,
    braceUntil: ctx.time + 2 + GAUNTLET.pull.braceWindowS,
    braced: new Set(),
    claimed: new Map(),
    teamOf,
    npcForce: [
      run.rng.range(GAUNTLET.pull.npcForceMin, GAUNTLET.pull.npcForceMax),
      run.rng.range(GAUNTLET.pull.npcForceMin, GAUNTLET.pull.npcForceMax),
    ],
    resolved: false,
    wonBy: null,
  };
}

export function gauntletPullBeat(
  ctx: SimContext,
  run: GauntletRun,
  trial: GauntletPullState,
  pid: number,
  beat: number,
): void {
  void ctx;
  void run;
  void trial;
  void pid;
  void beat;
}

export function updatePull(ctx: SimContext, run: GauntletRun, dt: number): boolean {
  void dt;
  const stubEndsAt = run.phaseEndsAt - GAUNTLET.pull.durationS + 6;
  if (ctx.time < stubEndsAt) return false;
  cullNpcsToward(ctx, run);
  return true;
}
