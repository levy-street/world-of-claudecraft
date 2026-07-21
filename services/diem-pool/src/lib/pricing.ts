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
 * Seed rates (USD per 1M tokens) from each vendor's published pricing at time
 * of writing. The live table is admin-editable - treat this as a starting
 * point and sync against the vendors' pricing pages after deploy.
 */
export const SEED_PRICING_BY_VENDOR: Record<string, Record<string, ModelRate>> = {
  venice: {
    'llama-3.2-3b': { inputUsdPerMTokens: 0.15, outputUsdPerMTokens: 0.6 },
    'llama-3.3-70b': { inputUsdPerMTokens: 0.7, outputUsdPerMTokens: 2.8 },
    'llama-3.1-405b': { inputUsdPerMTokens: 1.5, outputUsdPerMTokens: 6.0 },
    'qwen3-4b': { inputUsdPerMTokens: 0.15, outputUsdPerMTokens: 0.6 },
    'qwen3-235b': { inputUsdPerMTokens: 0.9, outputUsdPerMTokens: 4.5 },
    'mistral-31-24b': { inputUsdPerMTokens: 0.5, outputUsdPerMTokens: 2.0 },
    'deepseek-r1-671b': { inputUsdPerMTokens: 3.5, outputUsdPerMTokens: 14.0 },
    'venice-uncensored': { inputUsdPerMTokens: 0.5, outputUsdPerMTokens: 2.0 },
  },
  openai: {
    'gpt-4o-mini': { inputUsdPerMTokens: 0.15, outputUsdPerMTokens: 0.6 },
    'gpt-4o': { inputUsdPerMTokens: 2.5, outputUsdPerMTokens: 10.0 },
    'gpt-4.1-mini': { inputUsdPerMTokens: 0.4, outputUsdPerMTokens: 1.6 },
    'gpt-4.1': { inputUsdPerMTokens: 2.0, outputUsdPerMTokens: 8.0 },
  },
  anthropic: {
    'claude-haiku-4-5': { inputUsdPerMTokens: 1.0, outputUsdPerMTokens: 5.0 },
    'claude-sonnet-4-5': { inputUsdPerMTokens: 3.0, outputUsdPerMTokens: 15.0 },
  },
  kimi: {
    'moonshot-v1-8k': { inputUsdPerMTokens: 0.2, outputUsdPerMTokens: 2.0 },
    'kimi-k2': { inputUsdPerMTokens: 0.6, outputUsdPerMTokens: 2.5 },
    'kimi-k2-thinking': { inputUsdPerMTokens: 0.6, outputUsdPerMTokens: 2.5 },
  },
};

/** Default purpose-tier → concrete model mappings, seeded per vendor. */
export const SEED_CLASS_MAP: Array<{
  class: 'fast' | 'standard' | 'smart';
  vendor: string;
  model: string;
  priority: number;
}> = [
  { class: 'fast', vendor: 'venice', model: 'llama-3.2-3b', priority: 10 },
  { class: 'fast', vendor: 'openai', model: 'gpt-4o-mini', priority: 10 },
  { class: 'fast', vendor: 'anthropic', model: 'claude-haiku-4-5', priority: 10 },
  { class: 'fast', vendor: 'kimi', model: 'moonshot-v1-8k', priority: 10 },
  { class: 'standard', vendor: 'venice', model: 'llama-3.3-70b', priority: 10 },
  { class: 'standard', vendor: 'openai', model: 'gpt-4.1-mini', priority: 10 },
  { class: 'standard', vendor: 'anthropic', model: 'claude-haiku-4-5', priority: 10 },
  { class: 'standard', vendor: 'kimi', model: 'kimi-k2', priority: 10 },
  { class: 'smart', vendor: 'venice', model: 'deepseek-r1-671b', priority: 10 },
  { class: 'smart', vendor: 'openai', model: 'gpt-4.1', priority: 10 },
  { class: 'smart', vendor: 'anthropic', model: 'claude-sonnet-4-5', priority: 10 },
  { class: 'smart', vendor: 'kimi', model: 'kimi-k2-thinking', priority: 10 },
];

/**
 * Fallback applied when a response reports a model missing from the pricing
 * table (conservatively priced high so unknown models are never under-metered;
 * the usage row still records the real model name for admin follow-up).
 */
export const FALLBACK_RATE: ModelRate = { inputUsdPerMTokens: 4.0, outputUsdPerMTokens: 16.0 };
