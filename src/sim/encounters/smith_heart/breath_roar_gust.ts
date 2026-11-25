// The Summit Roar's follow-through (Jose's call of 2026-11-25, after its
// short hard throw came back): the moment a body's throw settles, a strong
// wind blows it ON the way it was thrown, outward from the guardian toward
// the rim, for the tier's `roarGustSeconds`. It is the shared motion
// kernel's steady wind (wind_drift.ts WIND_GUST_AURA, value the heading,
// value2 the speed), steered to the walk like the blow: a body walking
// straight back against it gains ground slowly (its run is a little faster
// than the gust), a body left standing is carried toward the edge. Both
// hosts step it, so the online client predicts it (no server-driven slide).
//
//   The ramp     it rises in two steps over its first `rampSeconds` (a gust,
//                not a wall) and eases in two steps over its last, so the
//                reconciler meets only a few small edges.
//   Normal       the tier's `roarSafe`: the gust lets go of a body that comes
//                within `safeMargin` yards of an open lip, so on Normal only a
//                body that walks itself over goes; on Heroic and Mythic a body
//                that stands through the whole gust is carried off.
//   Held         the anchored and the Knotted Gale's carrier keep their feet
//                (heldFast): none starts on them, and an anchor caught mid-gust
//                ends it (breath_gale.ts syncWindAuras drops the aura; the
//                entry goes with it here).
//
// The gust ends early with the fight's reset (clearWindAuras drops every
// wind aura the guardian put down), the isles' lock and the storm. Zero rng.

import { DT, type Entity } from '../../types';
import { WIND_GUST_AURA } from '../../wind_drift';
import { lipDistance } from './breath_geometry';
import { BREATH_NAMES } from './breath_ids';
import { auraOf, type BreathScope, heldFast, local, putMarker } from './breath_scope';
import { dropAura } from './fight_kit';

/** The gust's fixed shape: its ramp in and out (seconds, two steps each) and
 *  Normal's lip margin (yards). */
export const ROAR_GUST = { rampSeconds: 0.2, safeMargin: 2.5 } as const;

/** One body's gust in flight (rides the fight's state, in tick order). */
export interface RoarGust {
  id: number;
  /** Its heading (sim radians: it blows toward (sin h, cos h)). */
  heading: number;
  /** Seconds it has blown. */
  t: number;
}

/** The gust's share of its full speed `t` seconds into `seconds`: half, then
 *  whole after the ramp, half again over its last ramp. Pure. */
export function roarGustShare(t: number, seconds: number): number {
  const R = ROAR_GUST.rampSeconds;
  if (t < R / 2 || t > seconds - R / 2) return 0.5;
  return 1;
}

/** Begin `p`'s gust along the unit (ux, uz) (the way it was thrown). The
 *  held keep their feet; a body already gusted is gusted afresh. Returns
 *  whether one began. Exported for the tests. */
export function startRoarGust(s: BreathScope, p: Entity, ux: number, uz: number): boolean {
  const speed = s.rules.roarGustSpeed;
  const seconds = s.rules.roarGustSeconds;
  if (p.dead || heldFast(p) || p.carriedBy !== undefined || !(speed > 0) || !(seconds > 0))
    return false;
  const heading = Math.atan2(ux, uz);
  const list = s.st.roarGusts;
  const old = list.findIndex((g) => g.id === p.id);
  if (old >= 0) list.splice(old, 1);
  list.push({ id: p.id, heading, t: 0 });
  putMarker(p, WIND_GUST_AURA, BREATH_NAMES.gust, seconds + 0.5, s.boss.id, {
    value: heading,
    value2: speed * roarGustShare(0, seconds),
  });
  return true;
}

/** Every gust one tick on: its speed stepped by the ramp, Normal's let go at
 *  a lip, the spent ones dropped. */
export function stepRoarGusts(s: BreathScope): void {
  const list = s.st.roarGusts;
  const seconds = s.rules.roarGustSeconds;
  const speed = s.rules.roarGustSpeed;
  for (let i = list.length - 1; i >= 0; i--) {
    const g = list[i];
    const p = s.ctx.entities.get(g.id);
    const a = p ? auraOf(p, WIND_GUST_AURA) : undefined;
    g.t += DT;
    // Gone (a death, the fight's scope left, an anchor, a reset), or spent.
    if (!p || !a || p.dead || !s.players.includes(p) || g.t >= seconds) {
      if (p) dropAura(p, WIND_GUST_AURA);
      list.splice(i, 1);
      continue;
    }
    if (s.rules.roarSafe) {
      const at = local(s.ctx, s.inst, p);
      if (lipDistance(at.x, at.z) < ROAR_GUST.safeMargin) {
        dropAura(p, WIND_GUST_AURA);
        list.splice(i, 1);
        continue;
      }
    }
    // Only a step's change touches the aura (each write is a wire edge).
    const want = speed * roarGustShare(g.t, seconds);
    if (a.value2 !== want) a.value2 = want;
  }
}

/** Drop every gust (a reset; the auras go with clearWindAuras). */
export function clearRoarGusts(s: Pick<BreathScope, 'ctx'>, st: { roarGusts: RoarGust[] }): void {
  for (const g of st.roarGusts) {
    const p = s.ctx.entities.get(g.id);
    if (p) dropAura(p, WIND_GUST_AURA);
  }
  st.roarGusts.length = 0;
}
