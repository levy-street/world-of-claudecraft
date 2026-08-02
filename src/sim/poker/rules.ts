export const POKER_RAKE_BPS = 1000;

export function calculateRakeForPots(
  pots: readonly { amount: number }[],
  reachedFlop: boolean,
): number[] {
  if (!reachedFlop) return pots.map(() => 0);
  return pots.map((pot) => {
    if (!Number.isSafeInteger(pot.amount) || pot.amount < 0) {
      throw new RangeError('Poker pot amount must be a non-negative safe integer');
    }
    return Number((BigInt(pot.amount) * BigInt(POKER_RAKE_BPS)) / 10_000n);
  });
}
