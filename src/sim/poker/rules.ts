export const POKER_RAKE_BPS = 1000;

export function calculateRakeForPots(pots: readonly { amount: number }[], reachedFlop: boolean): number[] {
  if (!reachedFlop) return pots.map(() => 0);
  return pots.map((pot) => Math.floor((pot.amount * POKER_RAKE_BPS) / 10_000));
}
