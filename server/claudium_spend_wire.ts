// Runtime validation for the economy service's spend response. The service is
// outside this process, so a TypeScript generic on fetch is not evidence that
// its JSON is trustworthy. In particular, coercing `granted` would turn the
// string "false" into a paid storage grant.

export interface ParsedClaudiumSpendWireResult {
  granted: boolean;
  balance: number | null;
  costClaudium: number | null;
  reason: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nullableCurrencyInteger(value: unknown): number | null | undefined {
  if (value === undefined || value === null) return null;
  if (!Number.isSafeInteger(value) || (value as number) < 0) return undefined;
  return value as number;
}

/**
 * Parse a JSON spend response without coercion. Optional service fields retain
 * their historical null normalization, while any present field with the wrong
 * type invalidates the whole response. A caller must treat null as an
 * ambiguous transport outcome because the service may already have debited.
 */
export function parseClaudiumSpendWireResult(value: unknown): ParsedClaudiumSpendWireResult | null {
  if (!isRecord(value) || typeof value.granted !== 'boolean') return null;

  const balance = nullableCurrencyInteger(value.balance);
  const costClaudium = nullableCurrencyInteger(value.costClaudium);
  if (balance === undefined || costClaudium === undefined) return null;

  const reason = value.reason;
  if (reason !== undefined && reason !== null && typeof reason !== 'string') return null;

  return {
    granted: value.granted,
    balance,
    costClaudium,
    reason: typeof reason === 'string' ? reason : null,
  };
}
