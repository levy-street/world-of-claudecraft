// What the Guardian of the Heat SAYS (docs/design/raid/
// smith_heart.md section 7.4): yells to every player near the Hearth,
// carrying their catalog key (`hudChrome.heatGuardian.say.<moment>`) so the
// client renders them through t(), with the English as the fallback and as
// the key its voice clip is found by (scripts/voices/smith_heart_voice_pack.mjs).
//
//   intro      its entrance (heat_intro.ts): the first time the raid comes
//              near it wakes from cold coal, and this is the line it burns
//              to (the fx beats ride the clip's sentences)
//   pull       the pull (not on the first pull right after the entrance:
//              the entrance has just said it)
//   fist       Basalt Fist (at most once in SAY_EVERY)
//   sink       the first overflow: it sinks into the wellspring
//   sinkAgain  the second overflow
//   feed       a Wellspawn reaches the wellspring
//   rise       it rises from an overflow (at most once in SAY_EVERY)
//   seeds      the Hearthseeds fall (at most once in SAY_EVERY)
//   zones      Wakefire's first run
//   cinder     a Rolling Cinder falls (at most once in SAY_EVERY)
//   wheel      mythic's Wheel of the Hearth (at most once in SAY_EVERY)
//   slay_*     a player falls: its three kill lines in turn, at most one in
//              SLAY_EVERY (voice_slain.ts)
//   wipe       the raid lies still in the Hearth
//   death      its fall
//
// Zero rng, no clock but the fight's: every line is ordered and once-gated.

import type { Entity } from '../../types';
import type { HeatScope } from './heat_scope';
import { hearthListeners } from './heat_scope';
import { isSlayMoment, SLAY_EVERY, slayMoment, watchSlain } from './voice_slain';

export type HeatMoment =
  | 'intro'
  | 'pull'
  | 'fist'
  | 'sink'
  | 'sinkAgain'
  | 'feed'
  | 'rise'
  | 'seeds'
  | 'zones'
  | 'cinder'
  | 'wheel'
  | 'slay_a'
  | 'slay_b'
  | 'slay_c'
  | 'wipe'
  | 'death';

/** Every line (English source; the catalog's `hudChrome.heatGuardian.say.*`
 *  rows are the same text). */
export const HEAT_LINES: Readonly<Record<HeatMoment, string>> = {
  intro:
    'Insects. You crawl into the first flame and expect to leave? I was burning before your kind learned fire. Then burn with it!',
  pull: 'You walk into the first flame. Nothing leaves it unchanged.',
  fist: 'Stand where the stone falls, and be part of it.',
  sink: 'The wellspring rises to meet you!',
  sinkAgain: 'Again the Hearth overflows. Again you burn.',
  feed: 'Yes... come home to the flame.',
  rise: 'I rise with the first fire!',
  seeds: 'Every spark I scatter takes root.',
  zones: 'The Hearth wakes beneath your feet.',
  cinder: 'Run, little ember. The flame is hungry.',
  wheel: 'The Hearth turns! Keep pace with it, or burn!',
  slay_a: 'Another spark goes home to the flame.',
  slay_b: 'Burned clean.',
  slay_c: 'The first flame takes its due.',
  wipe: 'Ash, all of you. The Hearth burns on.',
  death: 'The flame... sinks back... into the stone. Carry it well.',
};

/** The catalog key of a line. */
export function heatLineKey(moment: HeatMoment): string {
  return `hudChrome.heatGuardian.say.${moment}`;
}

/** Seconds between two of the repeating lines. */
export const HEAT_SAY_EVERY = 45;

const REPEATING: ReadonlySet<HeatMoment> = new Set(['fist', 'rise', 'seeds', 'cinder', 'wheel']);

/**
 * The guardian (embodied by `from`) says its `moment` line, if it may now.
 * Returns true when it spoke.
 */
export function heatSay(
  s: Pick<HeatScope, 'ctx' | 'inst' | 'st'>,
  from: Entity,
  moment: HeatMoment,
): boolean {
  const tag = isSlayMoment(moment) ? 'slay' : moment;
  const said = s.st.said[tag];
  if (isSlayMoment(moment)) {
    if (said !== undefined && s.st.clock - said < SLAY_EVERY - 1e-9) return false;
  } else if (REPEATING.has(moment)) {
    if (said !== undefined && s.st.clock - said < HEAT_SAY_EVERY - 1e-9) return false;
  } else if (said !== undefined) return false;
  s.st.said[tag] = s.st.clock;
  heatYell(s.ctx, s.inst, from, moment);
  return true;
}

/** The guardian (embodied by `from`) yells its `moment` line to everyone
 *  near the Hearth, ungated (the entrance's own line, said once by
 *  heat_intro.ts before any fight state exists). */
export function heatYell(
  ctx: HeatScope['ctx'],
  inst: HeatScope['inst'],
  from: Entity,
  moment: HeatMoment,
): void {
  for (const p of hearthListeners(ctx, inst)) {
    ctx.emit({
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
}

/** Watch the Hearth for a player's fall (called every tick of the fight):
 *  the guardian says its kill lines in turn. */
export function watchHeatSlain(s: Pick<HeatScope, 'ctx' | 'inst' | 'st' | 'boss'>): void {
  if (watchSlain(s.st.slain, hearthListeners(s.ctx, s.inst)) === 0) return;
  heatSay(s, s.boss, slayMoment(s.st.slain.kills, 3));
}
