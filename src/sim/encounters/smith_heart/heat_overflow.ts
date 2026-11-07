// The Guardian of the Heat's overflows (docs/design/raid/smith_heart.md
// section 7.4), at 70 and at 40 percent.
//
//   It sinks         2.5 s: the guardian sinks into the wellspring, out of
//                    reach (nobody's target, nothing harms it).
//   The overflow     the Hearth overflows: every 4.5 s three rivers of the
//                    first flame run out of the wellspring across the shore
//                    (2.5 s of warning down their lanes, then 3 s of fire),
//                    and every 3 s Falling Cinders strike random players
//                    (heal through them). Normal: 20 s of it, pure dodge and
//                    heal. Heroic: the Wellspawn climb out at the room's edge
//                    and walk to the wellspring (and at 40 percent two
//                    Wellkeepers rise; heat_wellspawn.ts); it lasts until
//                    they are gone (at least 8 s) or 45 s at most.
//   It rises         3 s, still out of reach, then the next phase begins.
//
// Deterministic: the rivers' bearings and the bolts' players are hashed; the
// only rng draws are the damage rolls, in player order.

import { HEARTH_WELL } from '../../content/smith_heart_layout';
import { DT, type Entity } from '../../types';
import { inLane } from './heat_geometry';
import {
  HEAT_CUES,
  HEAT_NAMES,
  heatHash,
  riverBearing,
  riverTemplate,
  HEAT_TUNING as T,
} from './heat_ids';
import {
  at,
  cueAt,
  cueOn,
  dropFightObject,
  fireHit,
  type HeatScope,
  livePlayers,
  pickPlayers,
  roll,
  spawnFightObject,
} from './heat_scope';
import type { HeatOverflow, HeatRiver } from './heat_state';

/** A fresh overflow's own state (its clocks). */
export function freshOverflow(n: 1 | 2): HeatOverflow {
  return {
    n,
    clock: 0,
    riverIn: T.riverFirst,
    boltIn: T.boltFirst,
    surges: 0,
    volleys: 0,
    rivers: [],
  };
}

/** The bearings (indices) of surge `surge`: `count` distinct, hashed. */
export function surgeBearings(surge: number, count: number): number[] {
  const out: number[] = [];
  const n = T.riverBearings;
  let k = 0;
  while (out.length < Math.min(count, n) && k < 64) {
    const i = heatHash(surge * 37 + 5, k) % n;
    if (!out.includes(i)) out.push(i);
    k++;
  }
  return out;
}

/** Three rivers start their warning (a surge). Exported for the tests. */
export function surge(s: HeatScope, o: HeatOverflow): void {
  for (const i of surgeBearings(o.surges, T.riverCount)) {
    const facing = riverBearing(i);
    const obj = spawnFightObject(
      s.ctx,
      s.inst,
      riverTemplate('warn', T.riverWarn),
      HEAT_NAMES.river,
      HEARTH_WELL.x,
      HEARTH_WELL.z,
      T.riverHalf,
    );
    obj.facing = facing;
    o.rivers.push({ objectId: obj.id, facing, state: 'warn', remaining: T.riverWarn, tick: 0 });
  }
  o.surges++;
}

/** Who stands in a flowing river (out on the shore, past the lip). */
export function inRiver(s: HeatScope, r: HeatRiver): Entity[] {
  const out: Entity[] = [];
  for (const p of livePlayers(s)) {
    const here = at(s, p);
    if (inLane(HEARTH_WELL.x, HEARTH_WELL.z, r.facing, T.riverLength, T.riverHalf, here.x, here.z))
      out.push(p);
  }
  return out;
}

/** One tick of the rivers: warning, flowing (its fire every half second),
 *  gone. */
function stepRivers(s: HeatScope, o: HeatOverflow): void {
  const keep: HeatRiver[] = [];
  for (const r of o.rivers) {
    r.remaining -= DT;
    if (r.state === 'warn') {
      if (r.remaining <= 1e-9) {
        r.state = 'flow';
        r.remaining = T.riverFlow;
        r.tick = DT;
        const obj = s.ctx.entities.get(r.objectId);
        if (obj) obj.templateId = riverTemplate('flow', T.riverFlow);
        cueAt(s, HEAT_CUES.river, HEARTH_WELL.x, HEARTH_WELL.z, T.riverHalf);
      }
      keep.push(r);
      continue;
    }
    if (r.remaining <= 1e-9) {
      dropFightObject(s.ctx, s.inst, r.objectId);
      continue;
    }
    r.tick -= DT;
    if (r.tick <= 1e-9) {
      r.tick += T.riverTick;
      for (const p of inRiver(s, r))
        fireHit(s, p, roll(s, T.riverMin, T.riverMax), HEAT_NAMES.river);
    }
    keep.push(r);
  }
  o.rivers = keep;
}

/** A volley of Falling Cinders on hashed players. Returns who. */
export function volley(s: HeatScope, o: HeatOverflow): Entity[] {
  const hit = pickPlayers(s, s.rules.bolts, 400 + o.volleys);
  o.volleys++;
  for (const p of hit) {
    cueOn(s, p, HEAT_CUES.bolt);
    fireHit(s, p, roll(s, T.boltMin, T.boltMax), HEAT_NAMES.bolt);
  }
  return hit;
}

/** One tick of the Hearth overflowing (rivers and bolts). */
export function stepFlood(s: HeatScope, o: HeatOverflow): void {
  o.clock += DT;
  o.riverIn -= DT;
  if (o.riverIn <= 1e-9) {
    o.riverIn += T.riverEvery;
    surge(s, o);
  }
  o.boltIn -= DT;
  if (o.boltIn <= 1e-9) {
    o.boltIn += T.boltEvery;
    volley(s, o);
  }
  stepRivers(s, o);
}

/** Every river off the floor. */
export function clearRivers(s: Pick<HeatScope, 'ctx' | 'inst'>, o: HeatOverflow | null): void {
  if (!o) return;
  for (const r of o.rivers) dropFightObject(s.ctx, s.inst, r.objectId);
  o.rivers = [];
}
