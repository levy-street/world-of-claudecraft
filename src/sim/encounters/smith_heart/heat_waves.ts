// The Guardian of the Heat's lava waves (docs/design/raid/smith_heart.md
// section 7.4): the overflows at 70 and at 40 percent since the rework of
// 2026-11-18 (Duallam's playtest: "replace it with waves of lava from the
// middle, with gaps to run through"). They took the place of the overflow's
// rivers.
//
//   A ring        a wall of the first flame rolls out of the wellspring's lip
//                 across the whole Hearth, `speed` yards a second. It parts
//                 in `gaps` corridors (two, `gapSpread` 90 degrees apart, on
//                 the Wellspawn's side of the floor, each `gapHalf` either
//                 side of its line): whoever it rolls over outside a
//                 corridor is struck once.
//   The warning   the next ring's corridors glow on the floor from the moment
//                 the last ring leaves the lip (the first ring's from the
//                 moment the guardian is under), so the raid walks to them
//                 before the wall comes. Each ring's corridors sway a hashed
//                 15 to 25 degrees off the Wellspawn's side, the other way
//                 from the last ring's (ringGaps).
//   The overflow  the tier's `count` rings, `every` seconds apart (the
//                 first `lead` seconds in); it ends when the last one has
//                 rolled past the Hearth's walls. The second overflow (40
//                 percent) is quicker, its corridors narrower (HEAT_DIFFICULTY
//                 `waves`). Falling Cinders still strike random players every
//                 few seconds (heat_overflow.ts), and on Heroic the Wellspawn
//                 walk to the wellspring all the while (heat_wellspawn.ts).
//
// What the client reads: a ring is an object on the corridor line of its
// first gap, `front` yards from the wellspring's middle (it moves, so the
// online mirror carries it smoothly as it does a Molten Swell's wave), its
// gaps in its template and the corridor's half width in `scale`; a warning is
// an object at the wellspring per corridor, its line in `facing`, its half
// width in `scale`, its seconds to the launch in its template.
//
// Deterministic: the corridors are hashed; the only rng draws are the damage
// rolls, in player order.

import { HEARTH_WELL } from '../../content/smith_heart_layout';
import { DT, type Entity } from '../../types';
import { inRingWall, ringGaps } from './heat_geometry';
import {
  gapTemplate,
  HEAT_CUES,
  HEAT_NAMES,
  type HeatWaveRule,
  ringTemplate,
  HEAT_TUNING as T,
} from './heat_ids';
import {
  at,
  cueAt,
  dropFightObject,
  fireHit,
  type HeatScope,
  livePlayers,
  moveFightObject,
  roll,
  spawnFightObject,
} from './heat_scope';
import type { HeatOverflow, HeatRing, HeatRingPlan } from './heat_state';

/** The tier's rule for overflow `n` (1 at 70 percent, 2 at 40). */
export function waveRule(s: Pick<HeatScope, 'rules'>, n: 1 | 2): HeatWaveRule {
  return s.rules.waves[n - 1];
}

/** The next ring's corridors laid out as warnings, `launchIn` seconds to go. */
function planRing(s: HeatScope, o: HeatOverflow, launchIn: number): HeatRingPlan {
  const rule = waveRule(s, o.n);
  const gaps = ringGaps(o.n, o.planned, rule.gaps, rule.gapSpread);
  o.planned++;
  const gapIds = gaps.map((g) => {
    const obj = spawnFightObject(
      s.ctx,
      s.inst,
      gapTemplate(launchIn),
      HEAT_NAMES.overflow,
      HEARTH_WELL.x,
      HEARTH_WELL.z,
      rule.gapHalf,
    );
    obj.facing = g;
    return obj.id;
  });
  return { gaps, gapIds, launchIn };
}

/** Where a ring's object stands: on its first corridor's line, `front` out. */
function ringSpot(r: Pick<HeatRing, 'gaps' | 'front'>): { x: number; z: number } {
  const g = r.gaps[0] ?? 0;
  return {
    x: HEARTH_WELL.x + Math.sin(g) * r.front,
    z: HEARTH_WELL.z + Math.cos(g) * r.front,
  };
}

/** The planned ring leaves the lip: its warnings go, its wall comes. */
function launch(s: HeatScope, o: HeatOverflow, plan: HeatRingPlan): void {
  const rule = waveRule(s, o.n);
  for (const id of plan.gapIds) dropFightObject(s.ctx, s.inst, id);
  const ring: HeatRing = { objectId: -1, gaps: plan.gaps, front: T.ringStart, struck: [] };
  const spot = ringSpot(ring);
  const obj = spawnFightObject(
    s.ctx,
    s.inst,
    ringTemplate(plan.gaps),
    HEAT_NAMES.overflow,
    spot.x,
    spot.z,
    rule.gapHalf,
  );
  obj.facing = plan.gaps[0] ?? 0;
  ring.objectId = obj.id;
  o.rings.push(ring);
  o.launched++;
  cueAt(s, HEAT_CUES.ring, HEARTH_WELL.x, HEARTH_WELL.z, T.ringStart);
}

/** The first ring's warnings, as the guardian goes under. */
export function startWaves(s: HeatScope, o: HeatOverflow): void {
  o.next = planRing(s, o, waveRule(s, o.n).lead);
}

/** Who a ring's wall rolls over this tick (each once). */
export function ringStrikes(s: HeatScope, o: HeatOverflow, r: HeatRing): Entity[] {
  const half = waveRule(s, o.n).gapHalf;
  const out: Entity[] = [];
  for (const p of livePlayers(s)) {
    if (r.struck.includes(p.id)) continue;
    const here = at(s, p);
    if (!inRingWall(r.gaps, half, r.front, here.x, here.z)) continue;
    r.struck.push(p.id);
    out.push(p);
  }
  return out;
}

/** One tick of the waves: the next ring's countdown and launch, each ring
 *  rolling out and striking, a ring past the walls gone. */
export function stepWaves(s: HeatScope, o: HeatOverflow): void {
  const rule = waveRule(s, o.n);
  const plan = o.next;
  if (plan) {
    plan.launchIn -= DT;
    if (plan.launchIn <= 1e-9) {
      launch(s, o, plan);
      o.next = o.planned < rule.count ? planRing(s, o, rule.every) : null;
    }
  }
  const keep: HeatRing[] = [];
  for (const r of o.rings) {
    r.front += rule.speed * DT;
    if (r.front > T.ringEnd) {
      dropFightObject(s.ctx, s.inst, r.objectId);
      continue;
    }
    const obj = s.ctx.entities.get(r.objectId);
    if (obj) {
      const spot = ringSpot(r);
      moveFightObject(s.ctx, s.inst, obj, spot.x, spot.z);
    }
    for (const p of ringStrikes(s, o, r))
      fireHit(s, p, roll(s, T.ringMin, T.ringMax), HEAT_NAMES.overflow);
    keep.push(r);
  }
  o.rings = keep;
}

/** Every ring has rolled and none is to come. */
export function wavesDone(o: HeatOverflow): boolean {
  return o.next === null && o.rings.length === 0 && o.launched > 0;
}

/** Every ring and warning off the floor. */
export function clearWaves(s: Pick<HeatScope, 'ctx' | 'inst'>, o: HeatOverflow | null): void {
  if (!o) return;
  for (const r of o.rings) dropFightObject(s.ctx, s.inst, r.objectId);
  o.rings = [];
  if (o.next) for (const id of o.next.gapIds) dropFightObject(s.ctx, s.inst, id);
  o.next = null;
}
