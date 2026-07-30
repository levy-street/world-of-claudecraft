import { EVENT_SKIN_TIERS, MECH_CHROMAS, skinRankOrder } from '../../../sim/content/skins';
import type { SkinRank } from '../../../sim/types';

export type SkinEventMode = 'class' | 'mech';

export interface SkinEventChoice {
  rank: SkinRank;
  index: number;
  key: string;
  id?: string;
}

export function skinEventChoices(mode: SkinEventMode): SkinEventChoice[] {
  if (mode === 'mech') {
    return MECH_CHROMAS.map((chroma, index) => ({
      rank: chroma.rank,
      index,
      key: `mech:${index}`,
      id: chroma.id,
    }));
  }
  return EVENT_SKIN_TIERS.map((tier) => ({
    rank: tier.rank,
    index: tier.skin,
    key: `${tier.rank}:${tier.skin}`,
  }));
}

export function defaultSkinEventChoice(
  rank: SkinRank,
  choices: readonly SkinEventChoice[],
  available: (choice: SkinEventChoice) => boolean,
): SkinEventChoice | null {
  const granted = skinRankOrder(rank);
  let best: SkinEventChoice | null = null;
  let bestOrder = -1;
  for (const choice of choices) {
    const order = skinRankOrder(choice.rank);
    if (order > granted || !available(choice)) continue;
    if (order > bestOrder) {
      bestOrder = order;
      best = choice;
    }
  }
  return best;
}

export function skinEventLandingAngle(rank: SkinRank, random: () => number): number {
  const jitter = (span: number): number => (random() - 0.5) * span;
  switch (rank) {
    case 'uncommon':
      return -15 + jitter(150);
    case 'rare':
      return -172.5 + jitter(72);
    case 'epic':
      return -247.5 + jitter(28);
    default:
      return 0;
  }
}
