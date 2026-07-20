// Cost computation from per-1M-token USD rates.
//
// All arithmetic is done in micro-USD integers and converted back at the end,
// so metering never accumulates float drift.

export interface ModelRate {
  inputUsdPerMTokens: number;
  outputUsdPerMTokens: number;
}

const MICRO = 1_000_000;

/** USD cost of a single call, rounded to 8 decimal places (micro-USD ceil). */
export function computeCostUsd(rate: ModelRate, promptTokens: number, completionTokens: number): number {
  if (promptTokens < 0 || completionTokens < 0) throw new Error('negative token count');
  // rate is USD per 1M tokens, so micro-USD per token == rate.
  const microUsd =
    Math.ceil(promptTokens * rate.inputUsdPerMTokens) +
    Math.ceil(completionTokens * rate.outputUsdPerMTokens);
  return microUsd / MICRO;
}

/**
 * Seed rates (USD per 1M tokens) from Venice's published pricing at time of
 * writing. The live table is admin-editable — treat this as a starting point
 * and sync against https://venice.ai/pricing after deploy.
 */
export const SEED_PRICING: Record<string, ModelRate> = {
  'llama-3.2-3b': { inputUsdPerMTokens: 0.15, outputUsdPerMTokens: 0.6 },
  'llama-3.3-70b': { inputUsdPerMTokens: 0.7, outputUsdPerMTokens: 2.8 },
  'llama-3.1-405b': { inputUsdPerMTokens: 1.5, outputUsdPerMTokens: 6.0 },
  'qwen3-4b': { inputUsdPerMTokens: 0.15, outputUsdPerMTokens: 0.6 },
  'qwen3-235b': { inputUsdPerMTokens: 0.9, outputUsdPerMTokens: 4.5 },
  'mistral-31-24b': { inputUsdPerMTokens: 0.5, outputUsdPerMTokens: 2.0 },
  'deepseek-r1-671b': { inputUsdPerMTokens: 3.5, outputUsdPerMTokens: 14.0 },
  'venice-uncensored': { inputUsdPerMTokens: 0.5, outputUsdPerMTokens: 2.0 },
};

/**
 * Fallback applied when a response reports a model missing from the pricing
 * table (conservatively priced high so unknown models are never under-metered;
 * the usage row still records the real model name for admin follow-up).
 */
export const FALLBACK_RATE: ModelRate = { inputUsdPerMTokens: 4.0, outputUsdPerMTokens: 16.0 };
