// Walks every branch of a seeded reward roll and returns each possible result with its
// chance. The wiki runs the game's own reward functions through this instead of copying
// their odds, so a retune in src/sim/ shows up on the page by itself.
import type { Rng } from '../../src/sim/rng';

export interface RollOutcome<T> {
  result: T;
  chance: number;
}

/** The draws a reward function may make. Anything else (raw next/range) cannot be enumerated. */
type EnumerableRng = Pick<Rng, 'chance' | 'int' | 'pick'>;

/**
 * Every result `roll` can return and the chance of each. Supports `chance`, `int` and
 * `pick`, which are the only draws the reward tables use; `next` and `range` throw.
 */
export function rollOutcomes<T>(roll: (rng: Rng) => T): RollOutcome<T>[] {
  const out: RollOutcome<T>[] = [];
  const visit = (path: number[], weight: number) => {
    let cursor = 0;
    let branch: number[] | undefined;
    const draw = (weights: number[]): number => {
      if (cursor < path.length) return path[cursor++];
      // The first draw past the known path: remember its options and finish the run with
      // placeholder answers. That run's result is thrown away.
      branch ??= weights;
      return 0;
    };
    const rng: EnumerableRng & Pick<Rng, 'next' | 'range'> = {
      chance: (p) => draw([1 - Math.min(1, Math.max(0, p)), Math.min(1, Math.max(0, p))]) === 1,
      int: (min, max) =>
        min + draw(Array.from({ length: max - min + 1 }, () => 1 / (max - min + 1))),
      pick: <U>(arr: readonly U[]) => arr[draw(arr.map(() => 1 / arr.length))],
      next: () => {
        throw new Error('rollOutcomes cannot enumerate a raw next() draw');
      },
      range: () => {
        throw new Error('rollOutcomes cannot enumerate a range() draw');
      },
    };
    const result = roll(rng as unknown as Rng);
    if (!branch) {
      out.push({ result, chance: weight });
      return;
    }
    branch.forEach((p, i) => {
      if (p > 0) visit([...path, i], weight * p);
    });
  };
  visit([], 1);
  return out;
}

/** Per item: the chance it is in the result, and how many come with it. */
export function itemChances(
  outcomes: RollOutcome<readonly { itemId: string; count: number }[]>[],
): Map<string, { chance: number; count: number }> {
  const chances = new Map<string, { chance: number; count: number }>();
  for (const { result, chance } of outcomes)
    for (const row of result) {
      const seen = chances.get(row.itemId);
      chances.set(row.itemId, { chance: (seen?.chance ?? 0) + chance, count: row.count });
    }
  return chances;
}

/** The chance the roll gives no items at all. */
export function emptyChance(
  outcomes: RollOutcome<readonly { itemId: string; count: number }[]>[],
): number {
  return outcomes.filter((o) => o.result.length === 0).reduce((sum, o) => sum + o.chance, 0);
}
