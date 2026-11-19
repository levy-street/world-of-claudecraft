// The Masterless Strength's own elements, as one part of its fight
// (final.ts calls these): Elemental Strike (final_strike.ts), Elemental
// Fusion (final_fusion.ts); their
// tick per stage, their end, their dev verbs and their readout.

import type { SmithHeartVein } from '../../content/smith_heart_layout';
import { HEART_QUARTER_ORDER } from '../../content/smith_heart_quarters';
import type { Entity } from '../../types';
import { FUSION_COMBOS, type FusionCombo } from './final_elements_ids';
import {
  clearFusion,
  fireCombo,
  queueFusion,
  startFusion,
  stepCombos,
  stepFusion,
} from './final_fusion';
import type { FinalScope } from './final_scope';
import { bossTank } from './final_scope';
import { clearStrike, elementalStrike, stepStatic, stepStrike, strikeStacks } from './final_strike';

/** One tick of its own elements: the strike in the quarter fight and the
 *  final phase; the fusion's trigger in the quarter
 *  fight; the combos on the floor always (they run out). */
export function stepElements(s: FinalScope): void {
  const stage = s.st.phase.stage;
  const live = stage === 'fight' || stage === 'final';
  if (live) stepStrike(s);
  stepStatic(s);
  stepFusion(s);
  stepCombos(s);
}

/** A change of quarter (final.ts watchZone, the quarter fight only): the
 *  fusion of the one it left and the one it entered. */
export function quarterChanged(
  s: FinalScope,
  from: SmithHeartVein | null,
  to: SmithHeartVein,
): void {
  if (from !== null && from !== to && s.st.phase.stage === 'fight') queueFusion(s, from, to);
}

/** Every element's footprint and mark gone (the fight's end). */
export function clearElements(
  s: Pick<FinalScope, 'ctx' | 'inst' | 'st' | 'boss'>,
  players: readonly Entity[],
): void {
  clearFusion(s, players);
  clearStrike(players);
}

/** The pair that makes a combo (its first two quarters in the table's
 *  order), for the dev verb. */
const COMBO_PAIRS: Readonly<Record<FusionCombo, [SmithHeartVein, SmithHeartVein]>> = {
  steam: ['heat', 'quench'],
  magma: ['heat', 'hammer'],
  firestorm: ['heat', 'breath'],
  hail: ['quench', 'breath'],
  avalanche: ['quench', 'hammer'],
  spires: ['breath', 'hammer'],
};

/** `/dev heart final strike|fusion <combo|a b>`: the reply, or
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
    case 'fusion': {
      const veins = HEART_QUARTER_ORDER as readonly string[];
      let pair: [SmithHeartVein, SmithHeartVein] | null = null;
      if (arg && (FUSION_COMBOS as readonly string[]).includes(arg))
        pair = COMBO_PAIRS[arg as FusionCombo];
      else if (arg && arg2 && veins.includes(arg) && veins.includes(arg2) && arg !== arg2)
        pair = [arg as SmithHeartVein, arg2 as SmithHeartVein];
      if (!pair)
        return `Elemental Fusion: name a combo (${FUSION_COMBOS.join(', ')}) or two quarters.`;
      const here = s.st.zone !== 'ring' ? s.st.zone : pair[1];
      const to = pair.includes(here) ? here : pair[1];
      const from = pair[0] === to ? pair[1] : pair[0];
      if (arg2 === 'now' || arg === 'now') {
        const combo = fireCombo(s, from, to);
        return `Elemental Fusion (${from} into ${to}): ${combo} at once.`;
      }
      s.st.bar = null;
      s.st.gap = 0;
      return startFusion(s, from, to)
        ? `Elemental Fusion (${from} into ${to}): 3 s, then its combo in the ${to} quarter.`
        : null;
    }
    default:
      return null;
  }
}

/** The readout's elements half. */
export function elementsReadout(s: Pick<FinalScope, 'st'>): string {
  const el = s.st.elements;
  return `strikes ${el.strikes} (next ${el.strikeClock.toFixed(0)} s), fusions ${el.fusions} (last ${el.lastCombo ?? 'none'})`;
}
