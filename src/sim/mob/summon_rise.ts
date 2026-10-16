// The rise cue for a summoned body. A boss's add wave lands in the world on the tick it
// is called, so the renderer has no body for an add yet when it would want to show it
// arriving: the sim tags the moment with a visual-only 'flourish' spellfx carrying
// SUMMON_RISE_CUE, and the renderer plays the add's entrance as soon as its body exists
// (src/render/summon_rise_fx.ts; the skeleton minion pulls itself up out of a heap of
// bones). Undead only: the summoned dead climb out of the earth, a summoned beast or
// spirit just arrives. Pure: it draws no rng and changes no state.

import { MOBS } from '../data';
import type { SimContext } from '../sim_context';
import type { Entity } from '../types';

/** The spellfx `ability` tag on a summoned add's rise cue, and the gesture a body that
 *  rises on it names as its VisualDef.entranceGesture. */
export const SUMMON_RISE_CUE = 'summon_rise';

/** Whether a summoned add of this template rises out of the ground. */
export function risesWhenSummoned(templateId: string): boolean {
  return MOBS[templateId]?.family === 'undead';
}

/** Cue the renderer that a just-summoned add is rising where it stands. */
export function emitSummonRise(ctx: Pick<SimContext, 'emit'>, add: Entity): void {
  if (!risesWhenSummoned(add.templateId)) return;
  ctx.emit({
    type: 'spellfx',
    sourceId: add.id,
    targetId: add.id,
    school: 'shadow',
    fx: 'flourish',
    ability: SUMMON_RISE_CUE,
  });
}
