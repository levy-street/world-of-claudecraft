// Trial 5, The Brittle Span: paired floor panels over the pit, one brittle
// per pair, reveals shared by every crosser's fate. STUB: teleports the field
// to the span and resolves after a short beat; the real step detection lands
// in this file (contracts: GauntletSpanTuning in types.ts, GauntletSpanState
// in state.ts).

import { GAUNTLET, GAUNTLET_VENUE } from '../content/gauntlet';
import { Rng } from '../rng';
import type { SimContext } from '../sim_context';
import { placeContestantsAt } from './contestants';
import type { GauntletRun, GauntletSpanState } from './state';
import { cullNpcsToward } from './vitality';

export function startSpan(ctx: SimContext, run: GauntletRun): GauntletSpanState {
  const t = GAUNTLET.span;
  placeContestantsAt(
    ctx,
    run,
    GAUNTLET_VENUE.span.x,
    GAUNTLET_VENUE.span.z - GAUNTLET_VENUE.span.length / 2 - 6,
    8,
  );
  // A salted sub-stream so the layout is one fixed draw regardless of when
  // mid-trial draws happen around it.
  const layoutRng = new Rng((run.seed ^ 0x5eed5) >>> 0);
  const safeSide: number[] = [];
  for (let i = 0; i < t.steps; i++) safeSide.push(layoutRng.chance(0.5) ? 0 : 1);
  return {
    kind: 'span',
    safeSide,
    revealed: safeSide.map(() => -1),
    npcCrossers: [],
    nextNpcStepAt: ctx.time + 2,
    playerStep: new Map(),
    finished: new Set(),
  };
}

export function updateSpan(ctx: SimContext, run: GauntletRun, dt: number): boolean {
  void dt;
  const stubEndsAt = run.phaseEndsAt - GAUNTLET.span.durationS + 6;
  if (ctx.time < stubEndsAt) return false;
  cullNpcsToward(ctx, run);
  return true;
}
