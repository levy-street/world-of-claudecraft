// The Islands of the Wind's `/dev heart breath` verbs (dev-gated by their one
// caller, sim/dev/smith_heart_dev.ts through breath.ts breathDevTrigger):
//
//   isles [0|1]     the guardian raises its Gale Bulwark now and wakes the
//                   tier's isles (or the one named: 0 south-east, 1 south-west)
//   ride [0|1]      the calling player rides the gale out to an isle now
//   home            the calling player, on an isle, rides home now
//   killisle        every add of the round falls (its Homeward Gales rise)
//   bulwark         the Bulwark breaks now (the round ends)
//   windworn off    the calling player's Windworn goes
//
// Pure dispatch over breath_isles.ts; no rng.

import { BREATH_ISLES } from '../../content/smith_heart_layout';
import { isleAt } from './breath_isle_geometry';
import { ISLE_AURAS } from './breath_isle_ids';
import { islePlayers, startIsles, startRide } from './breath_isles';
import { type BreathScope, dropAura, living, local } from './breath_scope';

/** The verbs this module answers. */
export const ISLE_DEV_VERBS: ReadonlySet<string> = new Set([
  'isles',
  'isle',
  'shield',
  'ride',
  'home',
  'killisle',
  'bulwark',
  'windworn',
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
  const which = arg !== undefined && /^\d+$/.test(arg) ? Number(arg) % n : undefined;
  if (verb === 'isles' || verb === 'isle' || verb === 'shield') {
    if (s.st.half !== 'wind') return 'The isles wake only in the Wind half.';
    if (s.st.isles.round) return 'A Gale Bulwark already stands.';
    s.boss.castingAbility = null;
    s.st.bar = null;
    s.st.gap = 0;
    if (!startIsles(s, which)) return 'The guardian cannot raise its Bulwark now.';
    const woken = s.st.isles.round as { isles: number[] } | null;
    return `The Gale Bulwark rises; the isles wake (${woken?.isles.join(', ') ?? ''}).`;
  }
  if (verb === 'ride') {
    if (!living(me)) return 'Only a living player can ride the gale.';
    return startRide(s, me, which ?? 0, 'out')
      ? `You ride the gale to isle ${which ?? 0}.`
      : 'You cannot ride now.';
  }
  if (verb === 'home') {
    if (!living(me)) return 'Only a living player can ride the gale.';
    const at = local(s.ctx, s.inst, me);
    const i = isleAt(at.x, at.z);
    if (i < 0) return 'You do not stand on an isle.';
    return startRide(s, me, i, 'home') ? 'You ride the gale home.' : 'You cannot ride now.';
  }
  if (verb === 'killisle') {
    let n2 = 0;
    for (const a of s.st.isles.adds) {
      const e = s.ctx.entities.get(a.id);
      if (!living(e)) continue;
      s.ctx.dealDamage(me ?? null, e, e.hp + 1, false, 'physical', null, 'hit', true);
      n2++;
    }
    return `${n2} isle adds fall.`;
  }
  if (verb === 'bulwark') {
    if (!s.st.isles.round) return 'No Gale Bulwark stands.';
    dropAura(s.boss, ISLE_AURAS.bulwark);
    return 'The Gale Bulwark breaks.';
  }
  if (verb === 'windworn') {
    if (me) dropAura(me, ISLE_AURAS.windworn);
    return 'Windworn lifted.';
  }
  return null;
}

/** The isles' half of the readout. */
export function isleReadout(s: BreathScope): string {
  const st = s.st.isles;
  const r = st.round;
  const shield = s.boss.auras.find((a) => a.id === ISLE_AURAS.bulwark);
  const riders = islePlayers(s.ctx, s.inst).length;
  if (!r) return `isles: next mark ${st.next}/${s.rules.isleAt.length}, riders on isles ${riders}.`;
  return `isles: Bulwark ${Math.round(shield?.value ?? 0)}/${r.whole} (${r.elapsed.toFixed(0)} s), isles ${r.isles.join(',')}, adds ${st.adds.length}, riders ${riders}, rides ${st.rides.length}.`;
}
