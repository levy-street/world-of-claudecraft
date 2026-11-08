// Tempering Strike read before it lands (docs/design/raid/smith_heart.md
// section 7.3). The strike is the template's own swing cleave (every
// `strikeEvery`th LANDED swing, mob_swing.ts), and its cue fires on the hit
// itself, so the guardian's two-fisted gesture used to start as the damage
// landed. Here the fight watches her count: once the swing under way is the
// cleaving one and it is `strikeWindup` seconds out, it cues the wind-up on
// her (spellfx 'windup', QUENCH_CUES.strikeReady), once per swing, so every
// client raises her fists over her head through that second and slams them
// down on the cleave. A swing that is dodged, parried or missed lands no
// cleave (the count waits): that swing is told too (QUENCH_CUES.strikeSpent,
// once), so her raised fists come down as a plain swing instead of a slam
// that hits nothing, and the next swing is cued again.
//
// Presentation only: it reads the count, the swing timer and the bar, and
// changes nothing the fight resolves. Zero rng.

import { QUENCH_CUES, QUENCH_TUNING as T } from './quench_ids';
import type { QuenchScope } from './quench_scope';

/** Is the guardian's swing under way the cleaving one, `strikeWindup`
 *  seconds or less out, on a target in her reach, with no bar? */
export function strikeWindupDue(boss: {
  swingCleaveCount?: number;
  autoAttack: boolean;
  swingTimer: number;
  castingAbility: string | null;
}): boolean {
  return (
    (boss.swingCleaveCount ?? 0) === T.strikeEvery - 1 &&
    boss.autoAttack &&
    boss.castingAbility === null &&
    boss.swingTimer > 0 &&
    boss.swingTimer <= T.strikeWindup
  );
}

/** Was the cued cleaving swing just thrown and avoided? Its count still
 *  waits on the cleave while a fresh swing wait has begun, her target still
 *  in reach and no bar on her (a landed swing would have moved the count on). */
export function strikeSpentDue(boss: {
  swingCleaveCount?: number;
  autoAttack: boolean;
  swingTimer: number;
  castingAbility: string | null;
}): boolean {
  return (
    (boss.swingCleaveCount ?? 0) === T.strikeEvery - 1 &&
    boss.autoAttack &&
    boss.castingAbility === null &&
    boss.swingTimer > T.strikeWindup
  );
}

/** One tick: cue her wind-up once for the cleaving swing, and tell an
 *  avoided one. */
export function watchStrikeWindup(s: QuenchScope): void {
  const b = s.boss;
  // The cued swing went off and the count still waits: it was avoided (a
  // landed swing moves the count on, a bar or a lost reach is no swing).
  if (s.st.strikeWound && strikeSpentDue(b)) {
    s.ctx.emit({
      type: 'spellfx',
      sourceId: b.id,
      targetId: b.id,
      school: 'frost',
      fx: 'windup',
      ability: QUENCH_CUES.strikeSpent,
    });
  }
  // A new swing's wait (or a count that moved on) arms the cue again, and so
  // does a bar or a target out of her reach: the swing they hold is cued
  // afresh once it counts down again (her swing interval, 2.6 s, is longer
  // than the lead, so an avoided cleaving swing re-arms on its next wait).
  if (
    (b.swingCleaveCount ?? 0) !== T.strikeEvery - 1 ||
    b.swingTimer > T.strikeWindup ||
    b.castingAbility !== null ||
    !b.autoAttack
  )
    s.st.strikeWound = false;
  if (s.st.strikeWound || !strikeWindupDue(b)) return;
  s.st.strikeWound = true;
  s.ctx.emit({
    type: 'spellfx',
    sourceId: b.id,
    targetId: b.id,
    school: 'frost',
    fx: 'windup',
    ability: QUENCH_CUES.strikeReady,
  });
}
