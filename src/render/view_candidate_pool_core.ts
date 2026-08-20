import type { Entity } from '../sim/types';

export interface ViewCandidate {
  id: number;
  d2: number;
  priority: number;
}

function compareViewCandidates(a: ViewCandidate, b: ViewCandidate): number {
  return a.priority - b.priority || a.d2 - b.d2 || a.id - b.id;
}

export function writeViewCandidate(
  pool: ViewCandidate[],
  active: ViewCandidate[],
  index: number,
  id: number,
  d2: number,
  priority: number,
): void {
  let candidate = pool[index];
  if (!candidate) {
    candidate = { id, d2, priority };
    pool.push(candidate);
  } else {
    candidate.id = id;
    candidate.d2 = d2;
    candidate.priority = priority;
  }
  active[index] = candidate;
}

export function finishViewCandidates(active: ViewCandidate[], count: number): void {
  active.length = count;
  if (active.length > 1) active.sort(compareViewCandidates);
}

/** How many created-view type samples a frame keeps for the perf reporter. */
export const VIEW_CREATED_TYPE_SAMPLE_LIMIT = 24;

export function createdViewType(e: Entity): string {
  const id = e.templateId || e.kind;
  return `${e.kind}:${id}`.slice(0, 64);
}

export function sampleCreatedViewType(into: string[], e: Entity): void {
  if (into.length < VIEW_CREATED_TYPE_SAMPLE_LIMIT) into.push(createdViewType(e));
}
