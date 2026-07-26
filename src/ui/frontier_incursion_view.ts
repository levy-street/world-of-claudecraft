// Pure derivation of the Frontier incursion bar (the top-of-screen shared meter that
// appears while you are in the band). DOM-free so the label states snapshot-test
// directly; the painter (frontier_incursion_painter.ts) turns this into elided DOM
// writes. The rare's name is resolved by the painter (tEntity) and passed in, so this
// core stays a pure function of the incursion state + that name.
import type { FrontierIncursionView } from '../world_api';
import { formatNumber, t } from './i18n';

export interface FrontierIncursionBarInput {
  state: FrontierIncursionView | null; // null when not in the band (bar hides)
  rareName: string; // pre-localized rare name (painter resolves via tEntity)
}

export interface FrontierIncursionBarView {
  visible: boolean;
  active: boolean; // a rare is up: the bar shows its HP instead of the meter
  fillFrac: number; // 0..1: the meter while building, the rare HP while active
  label: string; // already-localized
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function pct(frac: number): string {
  return formatNumber(Math.floor(clamp01(frac) * 100) / 100, {
    style: 'percent',
    maximumFractionDigits: 0,
  });
}

export function frontierIncursionBarView(
  input: FrontierIncursionBarInput,
): FrontierIncursionBarView {
  const s = input.state;
  if (!s) return { visible: false, active: false, fillFrac: 0, label: '' };
  if (s.active) {
    // A rare is up: everyone converges. Show its name + HP so the whole band tracks it.
    return {
      visible: true,
      active: true,
      fillFrac: clamp01(s.rareHpFrac),
      label: `${input.rareName}  ${pct(s.rareHpFrac)}`,
    };
  }
  // Building: the shared meter toward the next spawn.
  return {
    visible: true,
    active: false,
    fillFrac: clamp01(s.progress),
    label: `${t('hudChrome.frontier.incursionTitle')}  ${pct(s.progress)}`,
  };
}
