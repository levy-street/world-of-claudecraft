// Asset queues sample priority at dequeue time so a moving camera can promote
// its nearest still-pending GLBs. Lower values win; equal values remain FIFO.
export type AssetLoadPriority = () => number;

export function minimumLoadPriority(priorities: Iterable<AssetLoadPriority>): number {
  let minimum = Infinity;
  for (const priority of priorities) {
    const value = priority();
    if (value < minimum) minimum = value;
  }
  return minimum;
}

export function nextPendingIndex(pending: readonly { priority?: AssetLoadPriority }[]): number {
  let best = -1;
  let bestPriority = Infinity;
  for (let index = 0; index < pending.length; index++) {
    const value = pending[index].priority?.() ?? 0;
    if (best === -1 || value < bestPriority) {
      best = index;
      bestPriority = Number.isNaN(value) ? Infinity : value;
    }
  }
  return best;
}
