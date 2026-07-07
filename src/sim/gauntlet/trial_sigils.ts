// Trial 2, Sugarglass Sigils: trace a seeded etched outline without cracking
// it. STUB: teleports the field to the pavilion and resolves after a short
// beat; the real trace scoring lands in this file (see GauntletSigilsTuning in
// types.ts and GauntletSigilsState in state.ts for the fixed contracts).

import { GAUNTLET, GAUNTLET_VENUE } from '../content/gauntlet';
import type { SimContext } from '../sim_context';
import { placeContestantsAt } from './contestants';
import type { GauntletRun, GauntletSigilsState } from './state';
import { cullNpcsToward } from './vitality';

export function startSigils(ctx: SimContext, run: GauntletRun): GauntletSigilsState {
  placeContestantsAt(ctx, run, GAUNTLET_VENUE.sigils.x, GAUNTLET_VENUE.sigils.z + 14, 10);
  const players = new Map();
  for (const [pid, ps] of run.playerStates) {
    if (ps.spectating) continue;
    players.set(pid, {
      shapeSeed: run.rng.int(1, 0x7fffffff),
      shapeId: run.rng.int(0, 3),
      crack: 0,
      progress: 0,
      lastPointAt: ctx.time,
      shatters: 0,
      done: false,
    });
  }
  return { kind: 'sigils', players };
}

export function gauntletTraceSigils(
  ctx: SimContext,
  run: GauntletRun,
  trial: GauntletSigilsState,
  pid: number,
  pts: number[],
): void {
  void ctx;
  void run;
  void trial;
  void pid;
  void pts;
}

export function updateSigils(ctx: SimContext, run: GauntletRun, dt: number): boolean {
  void dt;
  const stubEndsAt = run.phaseEndsAt - GAUNTLET.sigils.durationS + 6;
  if (ctx.time < stubEndsAt) return false;
  cullNpcsToward(ctx, run);
  return true;
}
