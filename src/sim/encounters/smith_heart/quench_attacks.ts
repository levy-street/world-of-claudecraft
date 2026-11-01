// The Guardian of the Quench's own attacks (docs/design/raid/smith_heart.md
// section 7.3): the two the phase-1 kit had, kept.
//
//   Quenching Breath  every 14 s (first at 6) a 2.5 s bar, planted, its cone
//                     (22 yd, 70 degrees) locked toward the tank when it
//                     begins: the tank turns it from the raid. It chills
//                     whoever it strikes. The content record keeps the look's
//                     numbers and is encounter-driven: this fight starts and
//                     lands it, never the trash engine.
//   Tempering Strike  the template's own swing cleave (every 4th landed
//                     swing, its arc before it): the template's own, no bar.
//
// Zero rng in every pick; the draws are the damage rolls, in player order.

import type { Entity } from '../../types';
import { addCold } from './quench_cold';
import { inAttackReach } from './quench_geometry';
import { QUENCH_CASTS, QUENCH_NAMES, QUENCH_TUNING as T } from './quench_ids';
import { at, beginBar, frostHit, livePlayers, local, type QuenchScope, roll } from './quench_scope';

/** The facing toward the guardian's tank (its current one if it has none). */
function towardTank(s: QuenchScope): number {
  const b = s.boss;
  const t = b.aggroTargetId !== null ? s.ctx.entities.get(b.aggroTargetId) : undefined;
  if (!t || t.dead) return b.facing;
  return Math.atan2(t.pos.x - b.pos.x, t.pos.z - b.pos.z);
}

/** Begin Quenching Breath toward the tank. Exported for the dev trigger. */
export function startBreath(s: QuenchScope): boolean {
  const facing = towardTank(s);
  beginBar(s, QUENCH_CASTS.breath, T.breathCast, facing);
  s.st.breathTimer = T.breathEvery;
  return true;
}

/** The breath lands down its locked cone: everyone in it is struck and
 *  chilled. Returns who (the tests read it). */
export function landBreath(s: QuenchScope, facing: number): Entity[] {
  const b = s.boss;
  s.ctx.emit({
    type: 'spellfx',
    sourceId: b.id,
    targetId: b.id,
    school: 'frost',
    fx: 'nova',
    ability: QUENCH_CASTS.breath,
  });
  const from = local(s.ctx, s.inst, b);
  const hit: Entity[] = [];
  for (const p of livePlayers(s)) {
    const here = at(s, p);
    if (!inAttackReach(from, facing, here, T.breathRange, T.breathArcDeg)) continue;
    hit.push(p);
    frostHit(s, p, roll(s, T.breathMin, T.breathMax), QUENCH_NAMES.breath);
    addCold(s, p, T.breathCold);
  }
  return hit;
}
