// What the Guardian of the Quench SAYS (docs/design/raid/smith_heart.md
// section 7.3): yells to every player near the lake, carrying their catalog
// key (`hudChrome.quenchGuardian.say.<moment>`) so the client renders them
// through t(), with the English as the fallback and as the key a future voice
// clip is found by. The guardian's voice is an audition still to come.
//
//   pull     the shore ice heaves up round the lake
//   shatter  a player's frozen ice shatters (at most once in SAY_EVERY)
//   hole     the ice gives way under a huddle (at most once in SAY_EVERY)
//   wake     it raises its arms and the four blades tear free
//   echo     the blades' first echo
//   cross    heroic: two blades cross the lake (at most once in SAY_EVERY)
//   deepen   the cold deepens past its third step
//   wipe     the raid lies still on the ice
//   death    its fall
//
// Zero rng, no clock but the fight's: every line is ordered and once-gated.

import type { Entity } from '../../types';
import type { QuenchScope } from './quench_scope';
import { lakeListeners } from './quench_scope';

/** The moments the guardian speaks at. */
export type QuenchMoment =
  | 'pull'
  | 'shatter'
  | 'hole'
  | 'wake'
  | 'echo'
  | 'cross'
  | 'deepen'
  | 'wipe'
  | 'death';

/** Every line (English source; the catalog's `hudChrome.quenchGuardian.say.*`
 *  rows are the same text). */
export const QUENCH_LINES: Readonly<Record<QuenchMoment, string>> = {
  pull: 'Warm blood on my lake. It will not stay warm for long.',
  shatter: 'Frozen through. Now break.',
  hole: 'The ice remembers every step. Stand together, and it gives.',
  wake: 'Blades of the Smith, wake! Answer every blow I strike!',
  echo: 'Whatever I strike, they strike again.',
  cross: 'Cross, blades! Cut them a new shore!',
  deepen: 'Feel it? The cold is going deeper.',
  wipe: 'Still. Silent. Quenched.',
  death: 'The cold... lets go... The Quench is yours.',
};

/** The catalog key of a line. */
export function quenchLineKey(moment: QuenchMoment): string {
  return `hudChrome.quenchGuardian.say.${moment}`;
}

/** Seconds between two of the repeating lines. */
export const QUENCH_SAY_EVERY = 40;

/** The lines that repeat (each at most once in QUENCH_SAY_EVERY); every
 *  other line is said once a pull. */
const REPEATING: ReadonlySet<QuenchMoment> = new Set(['shatter', 'hole', 'cross']);

/**
 * The guardian (embodied by `from`) says its `moment` line, if it may now.
 * Returns true when it spoke.
 */
export function quenchSay(
  s: Pick<QuenchScope, 'ctx' | 'inst' | 'st'>,
  from: Entity,
  moment: QuenchMoment,
): boolean {
  const said = s.st.said[moment];
  if (REPEATING.has(moment)) {
    if (said !== undefined && s.st.clock - said < QUENCH_SAY_EVERY - 1e-9) return false;
  } else if (said !== undefined) return false;
  s.st.said[moment] = s.st.clock;
  for (const p of lakeListeners(s.ctx, s.inst)) {
    s.ctx.emit({
      type: 'chat',
      fromPid: from.id,
      from: from.name,
      entityId: from.id,
      text: QUENCH_LINES[moment],
      textKey: quenchLineKey(moment),
      channel: 'yell',
      pid: p.id,
    });
  }
  return true;
}
