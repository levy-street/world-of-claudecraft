// Trial 6, The Final Court: the closing duel (attacker reaches the head zone,
// defender pushes them out, roles swap on a timer). STUB: teleports the field
// to the ring and resolves after a short beat; the real duel machine lands in
// this file (contracts: GauntletCourtTuning in types.ts, GauntletCourtState /
// GauntletCourtDuel in state.ts).

import { GAUNTLET, GAUNTLET_VENUE } from '../content/gauntlet';
import type { SimContext } from '../sim_context';
import { placeContestantsAt } from './contestants';
import type { GauntletCourtState, GauntletRun } from './state';
import { cullNpcsToward } from './vitality';

export function startCourt(ctx: SimContext, run: GauntletRun): GauntletCourtState {
  placeContestantsAt(ctx, run, GAUNTLET_VENUE.court.x, GAUNTLET_VENUE.court.z, 6);
  return { kind: 'court', duels: new Map() };
}

export function gauntletCourtShove(
  ctx: SimContext,
  run: GauntletRun,
  trial: GauntletCourtState,
  pid: number,
): void {
  void ctx;
  void run;
  void trial;
  void pid;
}

export function updateCourt(ctx: SimContext, run: GauntletRun, dt: number): boolean {
  void dt;
  const stubEndsAt = run.phaseEndsAt - GAUNTLET.court.durationS + 6;
  if (ctx.time < stubEndsAt) return false;
  cullNpcsToward(ctx, run);
  return true;
}
