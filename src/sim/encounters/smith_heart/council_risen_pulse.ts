// Stone Thrum, the Hammer Council's price on cover (docs/design/raid/
// smith_heart.md section 7.1; the owner's review of 2026-11-09): every pillar
// Wake the Stone raised (the Seam Singer's, or the Guardian's own rise as her
// heir) that still stands rings on the WHOLE raid every 2 s, per pillar, on
// every tier. The five carved columns never ring, the cursed pillar keeps its
// own pulse (council_rush.ts), and a soul pillar that was a risen one keeps
// ringing (the soul adds its own behaviour, council_soul.ts; it takes nothing
// away). So kicking a Wake is a choice: let through the one the next Wrath
// needs, kick the rest, and the raid's healing pays for every extra pillar.
//
// One hit a player a ring (the pillars' rings summed): its only rng is that
// damage roll, one draw a living player in claim-player order, and none at
// all while no risen pillar stands; no pick draws. One cue on each ringing
// pillar so the floor shows where the hum comes from. The blow is the Seam
// Singer's while she lives (the Wake is hers), else the Guardian's (her heir
// raising them), so it scales with that body's own factor and Memory.

import { DT } from '../../types';
import { COUNCIL_CUES, COUNCIL_NAMES, COUNCIL_TUNING as T } from './council_ids';
import { type CouncilPillar, councilPillars } from './council_pillars';
import { type CouncilScope, damageMult, living } from './council_scope';

/** The pillars that ring Stone Thrum: every risen one standing, the cursed
 *  pillar aside. Pure over the read. */
export function thrummingPillars(pillars: readonly CouncilPillar[]): CouncilPillar[] {
  return pillars.filter((p) => p.risen && !p.cursed);
}

/** One tick of Stone Thrum. Returns the players struck on a ring (the tests
 *  read it), else 0. */
export function stepRisenPulse(s: CouncilScope): number {
  const st = s.st;
  st.risenPulseTimer -= DT;
  if (st.risenPulseTimer > 1e-9) return 0;
  st.risenPulseTimer += T.risenPulseEvery;
  const source =
    (living(s.bodies.singer) ? s.bodies.singer : null) ??
    (living(s.bodies.guardian) ? s.bodies.guardian : null);
  if (!source) return 0;
  const ringing = thrummingPillars(councilPillars(s.ctx, s.inst));
  if (ringing.length === 0) return 0;
  for (const p of ringing) {
    s.ctx.emit({
      type: 'spellfx',
      sourceId: p.e.id,
      targetId: p.e.id,
      school: 'nature',
      fx: 'nova',
      ability: COUNCIL_CUES.risenPulse,
    });
  }
  const mult = damageMult(s, source) * ringing.length;
  let struck = 0;
  for (const pl of s.players) {
    if (pl.dead) continue;
    const amount = Math.max(
      1,
      Math.round(s.ctx.rng.range(s.rules.risenPulseMin, s.rules.risenPulseMax) * mult),
    );
    s.ctx.dealDamage(source, pl, amount, false, 'nature', COUNCIL_NAMES.risenPulse, 'hit', true);
    struck++;
  }
  return struck;
}
