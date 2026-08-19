export class PokerRuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PokerRuleError';
  }
}

export function pokerInvariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new PokerRuleError(message);
}
