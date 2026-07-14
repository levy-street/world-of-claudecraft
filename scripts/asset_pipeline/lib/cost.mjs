// Per-asset cost accounting. Tripo bills in credits (1 credit = $0.01, per the
// published pricing page); every job records its Tripo task ids BEFORE polling,
// so the real spend is queryable per task via GET /tasks/{id} credits_consumed.
// gpt-image-2 is token-billed; the concept steps store the API's usage block
// and this prices it at the published per-1M-token rates.
import { getTask } from './tripo.mjs';

export const TRIPO_CREDIT_USD = 0.01;
// gpt-image-2 pricing (July 2026): text input $5/1M, image input $8/1M,
// image output $30/1M tokens.
export const OPENAI_USD_PER_TOKEN = {
  textIn: 5 / 1e6,
  imageIn: 8 / 1e6,
  out: 30 / 1e6,
};

export function priceOpenAiUsage(usage) {
  if (!usage) return null;
  const textIn = usage.input_tokens_details?.text_tokens ?? 0;
  const imageIn = usage.input_tokens_details?.image_tokens ?? 0;
  const out = usage.output_tokens ?? 0;
  return +(
    textIn * OPENAI_USD_PER_TOKEN.textIn +
    imageIn * OPENAI_USD_PER_TOKEN.imageIn +
    out * OPENAI_USD_PER_TOKEN.out
  ).toFixed(4);
}

/** Itemized real cost of a job: every recorded Tripo task priced from the API's
 *  own credits_consumed, plus any stored gpt-image-2 usage blocks. */
export async function jobCost(jobState) {
  const items = [];
  const rows = [
    ...Object.entries(jobState.tasks ?? {}).map(([label, taskId]) => ({ label, taskId })),
    ...(jobState.tasksSuperseded ?? []).map((t) => ({ ...t, superseded: true })),
  ];
  for (const { label, taskId, superseded } of rows) {
    let credits = null;
    let status = 'unknown';
    try {
      const t = await getTask(taskId);
      credits = t.credits_consumed ?? 0;
      status = t.status;
    } catch {
      // Task no longer queryable: leave unpriced rather than guessing.
    }
    items.push({
      kind: 'tripo',
      label: superseded ? `${label} (superseded)` : label,
      taskId,
      credits,
      usd: credits === null ? null : +(credits * TRIPO_CREDIT_USD).toFixed(3),
      status,
    });
  }
  for (const [step, entry] of Object.entries(jobState.steps ?? {})) {
    const usage = entry?.result?.usage;
    if (usage) {
      items.push({ kind: 'openai', label: step, usd: priceOpenAiUsage(usage) });
    }
  }
  const totalCredits = items.reduce((s, i) => s + (i.credits ?? 0), 0);
  const totalUsd = +items.reduce((s, i) => s + (i.usd ?? 0), 0).toFixed(3);
  const unpriced = items.filter((i) => i.usd === null).length;
  return { items, totalCredits, totalUsd, unpriced };
}
