export interface CrowdBatchCandidate {
  slot: number;
  generation: number;
  variant: string;
  mode: 'rig' | 'localFar' | 'batchedFar';
  actionable: boolean;
}

export interface CrowdBatchGroup {
  variant: string;
  slots: number[];
  generations: number[];
}

export function groupBatchedCrowd(
  candidates: readonly CrowdBatchCandidate[],
  groups: CrowdBatchGroup[],
): number {
  for (const group of groups) {
    group.slots.length = 0;
    group.generations.length = 0;
  }
  let groupCount = 0;
  for (const candidate of candidates) {
    if (candidate.mode !== 'batchedFar' || candidate.actionable) continue;
    let groupIndex = -1;
    for (let index = 0; index < groupCount; index++) {
      if (groups[index]!.variant === candidate.variant) {
        groupIndex = index;
        break;
      }
    }
    if (groupIndex < 0) {
      groupIndex = groupCount++;
      const group = groups[groupIndex];
      if (group) {
        group.variant = candidate.variant;
      } else {
        groups.push({ variant: candidate.variant, slots: [], generations: [] });
      }
    }
    groups[groupIndex]!.slots.push(candidate.slot);
    groups[groupIndex]!.generations.push(candidate.generation);
  }
  return groupCount;
}
