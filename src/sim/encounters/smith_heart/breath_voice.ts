// What the Guardian of the Breath and Captain Thessaly SAY (docs/design/raid/
// smith_heart.md section 7.2): yells to every player near the Cornice,
// carrying their catalog key (`hudChrome.breathGuardian.say.<speaker>_<moment>`) so
// the client renders them through t(), with the English as the fallback and
// as the key a future voice clip is found by. The guardian's voice is an
// audition still to come (the brief's later step); Thessaly keeps the
// Highwatch captain's.
//
//   guardian   the pull, its first blow, each indrawn breath (at most once in
//              SAY_EVERY), the storm breaking, the cradle and the drawn
//              lightning (once in SAY_EVERY each), a wipe, its fall
//   thessaly   the pull, each circle of calm (three lines in turn), the
//              indrawn breath, the storm breaking, a player over the lip (at
//              most once in SAY_EVERY), the victory, a wipe
//
// Zero rng, no clock but the fight's: every line is ordered and once-gated.

import type { Entity } from '../../types';
import type { BreathScope } from './breath_scope';
import { corniceListeners } from './breath_scope';

export type BreathSpeaker = 'guardian' | 'thessaly';

/** The moments a speaker speaks at. */
export type BreathMoment =
  | 'pull'
  | 'blow'
  | 'inhale'
  | 'storm'
  | 'cradle'
  | 'drawn'
  | 'circle_a'
  | 'circle_b'
  | 'circle_c'
  | 'fall'
  | 'wipe'
  | 'death'
  | 'victory';

/** Every line, by speaker and moment (English source; the catalog's
 *  `hudChrome.breathGuardian.say.*` rows are the same text). */
export const BREATH_LINES: Readonly<Record<BreathSpeaker, Partial<Record<BreathMoment, string>>>> =
  {
    guardian: {
      pull: 'You climbed to the top of the mountain to steal its breath? Then breathe with me.',
      blow: 'Feel the wind turn. The edge is closer than you think.',
      inhale: 'Come closer. All of you.',
      storm: 'Enough breath. Now the storm!',
      cradle: 'Rise, little one. Let them catch you.',
      drawn: 'The sky has chosen you. Run, and it follows.',
      wipe: 'Blown away, like dust from the summit.',
      death: 'The Breath... goes back... to the mountain...',
    },
    thessaly: {
      pull: 'Highwatch stands with you! Mind the gaps in the wall: the wind will throw you through them!',
      circle_a: 'Into my calm, quickly! It holds three, no more!',
      circle_b: 'Here! Stand with me and let the wind break on us!',
      circle_c: 'Calm on the stone! Three of you, now!',
      inhale: 'It is drawing breath! Get to its sides, never before its mouth!',
      storm: 'The storm is breaking! My calm cannot hold this. Spread out!',
      fall: 'Hold on to the stone!',
      victory: 'The Breath is free. Highwatch will remember this climb.',
      wipe: 'Fall back and catch your breath. We go again.',
    },
  };

/** The catalog key of a line. */
export function breathLineKey(speaker: BreathSpeaker, moment: BreathMoment): string {
  return `hudChrome.breathGuardian.say.${speaker}_${moment}`;
}

/** Seconds between two of a speaker's repeating lines. */
export const SAY_EVERY = 40;
/** Thessaly speaks her pull line this long after the guardian's. */
export const THESSALY_PULL_DELAY = 4;

/** The lines that repeat (each at most once in SAY_EVERY); every other line
 *  is said once a pull. */
const REPEATING: ReadonlySet<BreathMoment> = new Set([
  'inhale',
  'cradle',
  'drawn',
  'circle_a',
  'circle_b',
  'circle_c',
  'fall',
]);

/** Speak one line from `from` to everyone near the Cornice. */
function yell(
  s: Pick<BreathScope, 'ctx' | 'inst'>,
  from: Entity,
  speaker: BreathSpeaker,
  moment: BreathMoment,
): void {
  const text = BREATH_LINES[speaker][moment];
  if (!text) return;
  for (const p of corniceListeners(s.ctx, s.inst)) {
    s.ctx.emit({
      type: 'chat',
      fromPid: from.id,
      from: from.name,
      entityId: from.id,
      text,
      textKey: breathLineKey(speaker, moment),
      channel: 'yell',
      pid: p.id,
    });
  }
}

/**
 * `speaker` (embodied by `from`) says its `moment` line, if it has one and
 * may now. Returns true when it spoke.
 */
export function breathSay(
  s: Pick<BreathScope, 'ctx' | 'inst' | 'st'>,
  from: Entity | null,
  speaker: BreathSpeaker,
  moment: BreathMoment,
): boolean {
  if (!from || !BREATH_LINES[speaker][moment]) return false;
  const tag = `${speaker}_${moment}`;
  const said = s.st.said[tag];
  if (REPEATING.has(moment)) {
    if (said !== undefined && s.st.clock - said < SAY_EVERY - 1e-9) return false;
  } else if (said !== undefined) return false;
  s.st.said[tag] = s.st.clock;
  yell(s, from, speaker, moment);
  return true;
}

/** Thessaly's circle line: her three in turn (the n-th circle's). */
export function circleMoment(n: number): BreathMoment {
  return (['circle_a', 'circle_b', 'circle_c'] as const)[((n % 3) + 3) % 3];
}
