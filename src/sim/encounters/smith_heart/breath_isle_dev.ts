// The Islands of the Wind's `/dev heart breath` verbs (dev-gated by their one
// caller, sim/dev/smith_heart_dev.ts through breath.ts breathDevTrigger):
//
//   isles           the guardian drops to half health and the phase begins now
//   ride <0..5>     the calling player rides the gale out to an isle now
//                   (0 to 2 the east chain, 3 to 5 the west)
//   home            the calling player, on an isle, rides home now
//   killisle [i]    every add of isle i (or of every woken isle) falls
//   still [0|1]     the side's Stillstone (0 east, 1 west; both without one)
//                   is stilled now (woken first if need be)
//   nova            Skyrend Nova runs out now
//
// Pure dispatch over breath_isles.ts; no rng.

import { BREATH_ISLES } from '../../content/smith_heart_layout';
import type { Entity } from '../../types';
import { livingIsleAdds } from './breath_isle_adds';
import { isleAt } from './breath_isle_geometry';
import { ISLE_TUNING } from './breath_isle_ids';
import { islePlayers, startIsles, startRide } from './breath_isles';
import { type BreathScope, local } from './breath_scope';

/** The verbs this module answers. */
/** A dev hit that fells an isle add through anything that turns a blow
 *  aside (the Squall Shieldbearer's ward takes up to 90 percent off the
 *  front, so a bare `hp + 1` left it standing and its isle never cleared). */
function devKill(e: Entity): number {
  return e.hp * 20 + 1;
}

export const ISLE_DEV_VERBS: ReadonlySet<string> = new Set([
  'isles',
  'isle',
  'ride',
  'home',
  'killisle',
  'still',
  'nova',
]);

/** One isle verb: the reply line, or null for an unknown verb. */
export function isleDevTrigger(
  s: BreathScope,
  words: readonly string[],
  pid?: number,
): string | null {
  const [verb, arg] = words;
  const me = pid !== undefined ? s.ctx.entities.get(pid) : undefined;
  const n = BREATH_ISLES.length;
  const isl = s.st.isles;
  if (verb === 'isles' || verb === 'isle') {
    if (s.st.half !== 'wind' || isl.stage !== 'idle')
      return 'The Islands of the Wind come once, at half health, in the Wind half.';
    if (s.st.bar) s.st.bar = null;
    s.boss.castingAbility = null;
    s.boss.hp = Math.min(s.boss.hp, Math.floor(s.boss.maxHp * ISLE_TUNING.at));
    return startIsles(s)
      ? 'The guardian closes its Gale Cocoon; Thessaly raises the Updrafts.'
      : 'The isles cannot begin now.';
  }
  if (verb === 'ride') {
    if (!me) return 'Nobody to ride.';
    const i = arg === undefined ? 0 : Number(arg);
    if (!Number.isInteger(i) || i < 0 || i >= n) return `ride takes an isle, 0 to ${n - 1}.`;
    return startRide(s, me, i, 'out') ? `You ride the gale to isle ${i}.` : 'You cannot ride now.';
  }
  if (verb === 'home') {
    if (!me) return 'Nobody to bring home.';
    const at = local(s.ctx, s.inst, me);
    const i = isleAt(at.x, at.z);
    if (i < 0) return 'You are not on an isle.';
    return startRide(s, me, i, 'home') ? 'You ride the gale home.' : 'You cannot ride now.';
  }
  if (verb === 'killisle') {
    const only = arg === undefined ? undefined : Number(arg);
    let k = 0;
    for (const e of livingIsleAdds(s, only)) {
      s.ctx.dealDamage(s.boss, e, devKill(e), false, 'nature', 'Dev', 'hit', true);
      k++;
    }
    return `${k} isle adds fall.`;
  }
  if (verb === 'still') {
    if (isl.stage !== 'nova') return 'No nova to cut.';
    const sides = arg === undefined ? [0, 1] : [Number(arg)];
    for (const side of sides) {
      const i = side * 3 + 2;
      const st = isl.isles[i];
      if (!st) continue;
      if (!st.woken || !st.cleared) {
        st.woken = true;
        for (const e of livingIsleAdds(s, i))
          s.ctx.dealDamage(s.boss, e, devKill(e), false, 'nature', 'Dev', 'hit', true);
      }
      const body = st.stoneId !== null ? s.ctx.entities.get(st.stoneId) : undefined;
      if (body && me) body.kitUseCompletedBy = me.id;
      else st.stilled = true;
    }
    return 'The Stillstone is stilled.';
  }
  if (verb === 'nova') {
    if (isl.stage !== 'nova') return 'No nova gathering.';
    isl.elapsed = 1e6;
    return 'Skyrend Nova runs out.';
  }
  return null;
}

/** The isles' half of the readout. */
export function isleReadout(s: BreathScope): string {
  const isl = s.st.isles;
  const riders = islePlayers(s.ctx, s.inst).length;
  if (isl.stage === 'idle')
    return `isles: at ${Math.round(ISLE_TUNING.at * 100)}%, riders ${riders}.`;
  const per = isl.isles
    .map(
      (st, i) =>
        `${i}:${st.woken ? (st.cleared ? 'clear' : 'up') : '-'}${st.closing !== null ? `/${st.closing.toFixed(0)}s` : ''}${st.stilled ? '/still' : ''}`,
    )
    .join(' ');
  return `isles: ${isl.stage} ${isl.elapsed.toFixed(0)} s, ${per}, adds ${isl.adds.length}, riders ${riders}, rides ${isl.rides.length}.`;
}
