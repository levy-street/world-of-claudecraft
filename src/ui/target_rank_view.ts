// Pure, allocation-free target-rank resolution for the target frame. The HUD
// supplies template flags mirrored identically by offline and online hosts, then
// uses the rank discriminator to drive its write-elided classes and localized
// tag. Boss rank wins over elite rank and selects the generic dragon emblem.

export type TargetRank = 'normal' | 'elite' | 'boss';

export interface TargetRankSource {
  elite?: boolean;
  boss?: boolean;
}

export function targetRankView(source: TargetRankSource | undefined): TargetRank {
  if (source?.boss) return 'boss';
  return source?.elite ? 'elite' : 'normal';
}

export function targetUsesEliteFrame(rank: TargetRank): boolean {
  return rank !== 'normal';
}
