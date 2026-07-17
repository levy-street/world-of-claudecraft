// Pure, dependency-free FIFO matchmaking core for the Card Duel minigame.
// Open to any class/entity (no eligibility gate beyond "not already queued or
// dueling"): unlike src/sim/social/arena.ts this holds no SimContext and draws
// no rng, so it is unit-testable directly.

export type CardDuelQueue = number[];

export function createCardDuelQueue(): CardDuelQueue {
  return [];
}

export type CardDuelJoinResult =
  | { ok: true }
  | { ok: false; reason: 'already_queued' | 'already_in_duel' };

export function joinCardDuelQueue(
  queue: CardDuelQueue,
  pid: number,
  inDuel: boolean,
): CardDuelJoinResult {
  if (inDuel) return { ok: false, reason: 'already_in_duel' };
  if (queue.includes(pid)) return { ok: false, reason: 'already_queued' };
  queue.push(pid);
  return { ok: true };
}

export function leaveCardDuelQueue(queue: CardDuelQueue, pid: number): boolean {
  const idx = queue.indexOf(pid);
  if (idx === -1) return false;
  queue.splice(idx, 1);
  return true;
}

export function isQueuedForCardDuel(queue: CardDuelQueue, pid: number): boolean {
  return queue.includes(pid);
}

export function cardDuelQueueSize(queue: CardDuelQueue): number {
  return queue.length;
}

// Pairs the two longest-waiting players, if at least two are queued. Removes
// them from the queue. Returns null if fewer than two are waiting.
export function tryPairCardDuel(queue: CardDuelQueue): [number, number] | null {
  if (queue.length < 2) return null;
  const a = queue.shift();
  const b = queue.shift();
  if (a === undefined || b === undefined) return null;
  return [a, b];
}
