// The Masterless Strength's own elements, as one part of its fight
// (final.ts calls these): Elemental Strike (final_strike.ts); its
// tick per stage, their end, their dev verbs and their readout.

import type { Entity } from '../../types';
import type { FinalScope } from './final_scope';
import { bossTank } from './final_scope';
import { clearStrike, elementalStrike, stepStatic, stepStrike, strikeStacks } from './final_strike';

/** One tick of its own elements: the strike in the quarter fight and the
 *  final phase, Static Charge's arcs always (its stacks run out). */
export function stepElements(s: FinalScope): void {
  const stage = s.st.phase.stage;
  const live = stage === 'fight' || stage === 'final';
  if (live) stepStrike(s);
  stepStatic(s);
}

/** Every element's footprint and mark gone (the fight's end). */
export function clearElements(
  _s: Pick<FinalScope, 'ctx' | 'inst' | 'st' | 'boss'>,
  players: readonly Entity[],
): void {
  clearStrike(players);
}

/** `/dev heart final strike [n]`: the reply, or
 *  null for another verb. */
export function elementsDev(
  s: FinalScope,
  verb: string,
  arg: string | undefined,
  arg2: string | undefined,
  me: Entity | null,
): string | null {
  switch (verb) {
    case 'strike': {
      const n = Number(arg);
      const target = bossTank(s) ?? me;
      if (!target) return 'Nobody to strike.';
      let stacks = 0;
      for (let k = 0; k < (Number.isFinite(n) && n > 0 ? Math.min(9, n) : 1); k++)
        stacks = elementalStrike(s, target);
      const now = strikeStacks(target);
      return `Elemental Strike on ${target.name}: ${stacks} stacks (${now.vein ?? 'none'}).`;
    }
    default:
      return null;
  }
}

/** The readout's elements half. */
export function elementsReadout(s: Pick<FinalScope, 'st'>): string {
  const el = s.st.elements;
  return `strikes ${el.strikes} (next ${el.strikeClock.toFixed(0)} s)`;
}
