// Shared source/target copy labels. Ordinals follow same-item bag order, not
// absolute inventory cells; confirmation callers retain the captured candidates.
import type { PerfectItemRef } from '../../../sim/professions/perfecting_copy';
import { formatNumber, t } from '../../i18n';
import { itemSlotLabel, sharedSlotLabelIndex } from '../../item_slot_labels';
import { baggedCopyOrdinal, type PerfectingCandidate } from './perfecting_view';

const whole = (value: number): string => formatNumber(value, { maximumFractionDigits: 0 });

export function perfectingCandidateRank(rank: number, ranks: number): string {
  return t('hudChrome.perfecting.rowRank', { rank: whole(rank), ranks: whole(ranks) });
}

export function perfectingCandidateState(
  state: PerfectingCandidate['state'],
  rank: number,
  ranks: number,
): string {
  if (state === 'promoted' && rank >= ranks) return t('hudChrome.perfecting.rowPromoted');
  if (state === 'perfected') return t('hudChrome.perfecting.rowPerfected');
  return perfectingCandidateRank(rank, ranks);
}

export function perfectingCandidateLocation(
  ref: PerfectItemRef,
  candidates: readonly PerfectingCandidate[],
): string | null {
  if ('slot' in ref) {
    const slot = itemSlotLabel(ref.slot);
    const index = sharedSlotLabelIndex(ref.slot);
    return index === undefined
      ? t('hudChrome.enchanting.wornTag', { slot })
      : t('hudChrome.enchanting.wornTagIndexed', { slot, index: whole(index) });
  }
  const anchor = baggedCopyOrdinal(candidates, ref);
  return anchor
    ? t('hudChrome.perfecting.bagCopy', {
        index: whole(anchor.ordinal + 1),
        count: whole(anchor.count),
      })
    : null;
}
