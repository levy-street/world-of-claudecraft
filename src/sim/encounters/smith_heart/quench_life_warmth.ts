// Living Warmth, the Guardian of the Quench's healer lever (the owner's review
// of 2026-11-09; docs/design/raid/smith_heart.md section 7.3): healing a
// player RECEIVES lowers their cold.
//
//   The rate   the tier's `lifeWarmth` cold for every 1% of the receiver's
//              maximum health healed: 0.5 on Normal (a point per 2%), 0.25 on
//              Heroic and Mythic (half). A 400 heal on a 1,200 health body
//              takes about 17 cold off on Normal, 8 on Heroic.
//   Effective  only healing that LANDED counts (combat/heal_taken.ts: heals,
//              HoTs, leeches, Beacon, Cascade and the Hourglass, after any heal
//              absorb and the missing-health clamp), so it needs a
//              wound to land on: a full-health body is warmed by nothing,
//              and healing Living Rime drinks warms nobody. That keeps it a
//              lever for a hurt raid, never a way to ignore the cold: a
//              healthy loner still freezes.
//   Frozen     a frozen body takes none (the rime holds it until the shatter).
//   The hunt   Mythic's Blades Hunt holds the cold still: no warmth either
//              (a huddle's own warmth is the one thing that moves it then).
//
// Runs before the cold's own tick (quench.ts), which shows the bar. Every
// player on the lake has their tally read each tick (read or not, it empties),
// so healing taken elsewhere never arrives here late. Zero rng.

import { takeHealTaken } from '../../combat/heal_taken';
import { chillOf, isFrozen } from './quench_cold';
import type { QuenchScope } from './quench_scope';

/** The cold `healed` effective healing takes off a body of `maxHp` at a
 *  tier's `rate` (cold per 1% of maximum health). Pure. */
export function lifeWarmthCold(healed: number, maxHp: number, rate: number): number {
  if (!(healed > 0) || !(maxHp > 0) || !(rate > 0)) return 0;
  return (healed / maxHp) * 100 * rate;
}

/** One tick of Living Warmth: every lake player's healing since the last
 *  tick, off their cold. */
export function stepLifeWarmth(s: QuenchScope): void {
  for (const p of s.players) {
    const healed = takeHealTaken(s.ctx, p);
    if (healed <= 0 || p.dead || s.st.flurry || isFrozen(s, p.id)) continue;
    const c = chillOf(s, p.id);
    if (c.cold <= 0) continue;
    c.cold = Math.max(0, c.cold - lifeWarmthCold(healed, p.maxHp, s.rules.lifeWarmth));
  }
}
