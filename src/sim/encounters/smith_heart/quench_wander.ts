// The wandering blades (docs/design/raid/smith_heart.md section 7.3): from the
// awakening the Smith's blades glide round the lake on one fixed loop through their
// homes, slowly on Normal and Heroic, fast on Mythic. Their echoes fire from where
// they are, so the safe spot behind each one moves with it; a blade passing through
// a player knocks them aside and adds cold; the ice just behind it is thin
// (quench_geometry.ts onThinIce, read by the strain in quench_ice.ts). A blade held
// for a crossing waits until it has landed. Zero rng in the route; the draws are the
// damage rolls, in player order.

import { DT } from '../../types';
import { addCold } from './quench_cold';
import { routeLength, routePoint } from './quench_geometry';
import { QUENCH_NAMES, QUENCH_TUNING as T } from './quench_ids';
import { at, frostHit, livePlayers, moveFightObject, type QuenchScope, roll } from './quench_scope';
import type { QuenchBlade } from './quench_state';

/** A passing blade strikes whoever it touches, once per `wanderHitGap`. */
function strike(s: QuenchScope, b: QuenchBlade): void {
  const blade = s.ctx.entities.get(b.objectId);
  if (!blade) return;
  for (const p of livePlayers(s)) {
    const here = at(s, p);
    if (Math.hypot(here.x - b.x, here.z - b.z) > T.wanderHitR) continue;
    const last = b.struck[p.id];
    if (last !== undefined && s.st.clock - last < T.wanderHitGap) continue;
    b.struck[p.id] = s.st.clock;
    frostHit(s, p, roll(s, T.wanderMin, T.wanderMax), QUENCH_NAMES.blade);
    addCold(s, p, T.wanderCold);
    s.ctx.applyKnockback(blade, p, T.wanderKnock);
  }
}

/** One tick: every blade not held for a crossing glides on and strikes. */
export function stepWander(s: QuenchScope): void {
  const st = s.st;
  if (st.half !== 'echoes' || st.wanderOff) return;
  const d = st.dance;
  const step = s.rules.wanderSpeed * DT;
  const length = routeLength();
  st.blades.forEach((b, i) => {
    if (d && d.phase !== 'crack' && (i === d.a || i === d.b)) return;
    b.s = (b.s + step) % length;
    const p = routePoint(b.s);
    b.x = p.x;
    b.z = p.z;
    const e = s.ctx.entities.get(b.objectId);
    if (e) moveFightObject(s.ctx, s.inst, e, p.x, p.z);
    strike(s, b);
  });
}
