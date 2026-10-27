// What the Guardian of the Heat SAYS (docs/design/raid/smith_heart.md
// section 7.4): yells to every player near the Hearth, carrying their catalog
// key (`hudChrome.heatGuardian.say.<moment>`) so the client renders them
// through t(), with the English as the fallback and as the key a future voice
// clip is found by. The guardian's voice is an audition still to come.
//
//   pull      the pull
//   shed      it pours its heat into the crystals (at most once in SAY_EVERY)
//   channel   the channel's first flow
//   windup    the heat passes 90 (at most once in SAY_EVERY)
//   overheat  Hearthburst
//   stoke     the Hearth's third stoking
//   wipe      the raid lies still in the Hearth
//   death     its fall
//
// Zero rng, no clock but the fight's: every line is ordered and once-gated.

import type { Entity } from '../../types';
import type { HeatScope } from './heat_scope';
import { hearthListeners } from './heat_scope';

export type HeatMoment =
  | 'pull'
  | 'shed'
  | 'channel'
  | 'windup'
  | 'overheat'
  | 'stoke'
  | 'wipe'
  | 'death';

/** Every line (English source; the catalog's `hudChrome.heatGuardian.say.*`
 *  rows are the same text). */
export const HEAT_LINES: Readonly<Record<HeatMoment, string>> = {
  pull: 'You walk into the first flame. Nothing leaves it unchanged.',
  shed: 'Take my heat, if you can hold it.',
  channel: 'The Hearth overflows. Choose your side.',
  windup: 'Too much fire for one body... it must go somewhere!',
  overheat: 'BURN WITH ME!',
  stoke: 'Every breath you take feeds the flame.',
  wipe: 'Ash, all of you. The Hearth burns on.',
  death: 'The flame... sinks back... into the stone. Carry it well.',
};

/** The catalog key of a line. */
export function heatLineKey(moment: HeatMoment): string {
  return `hudChrome.heatGuardian.say.${moment}`;
}

/** Seconds between two of the repeating lines. */
export const HEAT_SAY_EVERY = 45;

const REPEATING: ReadonlySet<HeatMoment> = new Set(['shed', 'windup', 'overheat']);

/**
 * The guardian (embodied by `from`) says its `moment` line, if it may now.
 * Returns true when it spoke.
 */
export function heatSay(
  s: Pick<HeatScope, 'ctx' | 'inst' | 'st'>,
  from: Entity,
  moment: HeatMoment,
): boolean {
  const said = s.st.said[moment];
  if (REPEATING.has(moment)) {
    if (said !== undefined && s.st.clock - said < HEAT_SAY_EVERY - 1e-9) return false;
  } else if (said !== undefined) return false;
  s.st.said[moment] = s.st.clock;
  for (const p of hearthListeners(s.ctx, s.inst)) {
    s.ctx.emit({
      type: 'chat',
      fromPid: from.id,
      from: from.name,
      entityId: from.id,
      text: HEAT_LINES[moment],
      textKey: heatLineKey(moment),
      channel: 'yell',
      pid: p.id,
    });
  }
  return true;
}
