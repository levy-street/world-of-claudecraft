import { redactSecrets } from './crypto';

// Thin client for the Venice API (OpenAI-compatible, Bearer auth).
// Error classification drives routing decisions, so it is centralized here.

export type VeniceErrorKind =
  | 'auth' // 401/403 — key revoked or invalid → provider INVALID
  | 'insufficient_credit' // daily DIEM credit exhausted → treat capacity as spent
  | 'rate_limited' // 429 without a credit hint → retryable, then degrade
  | 'bad_request' // 4xx caused by our payload — do NOT fail over, surface it
  | 'server' // upstream 5xx → retry/fail over
  | 'network'; // fetch/timeout → retry/fail over

export class VeniceError extends Error {
  constructor(
    public readonly kind: VeniceErrorKind,
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'VeniceError';
  }

  /** Worth one same-key retry before failing over. */
  get retryable(): boolean {
    return this.kind === 'server' || this.kind === 'network' || this.kind === 'rate_limited';
  }
}

export interface VeniceUsage {
  promptTokens: number;
  completionTokens: number;
}

export interface VeniceCallResult {
  body: unknown;
  usage: VeniceUsage;
  model: string;
  /** Remaining balance when Venice exposes it (headers); undefined otherwise. */
  balanceUsd?: number;
}

export interface VeniceClientOptions {
  baseUrl: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

const CREDIT_HINT = /insufficient|credit|balance|quota|exceed/i;

function classifyStatus(status: number, bodyText: string): VeniceErrorKind {
  if (status === 401 || status === 403) return 'auth';
  if (status === 402) return 'insufficient_credit';
  if (status === 429) return CREDIT_HINT.test(bodyText) ? 'insufficient_credit' : 'rate_limited';
  if (status >= 500) return 'server';
  return 'bad_request';
}

/** Venice returns balance/consumption info; sniff known header shapes defensively. */
function parseBalanceUsd(headers: Headers): number | undefined {
  for (const name of ['x-venice-balance-usd', 'x-venice-balance-diem', 'x-ratelimit-remaining-usd']) {
    const raw = headers.get(name);
    if (raw !== null) {
      const n = Number(raw);
      if (Number.isFinite(n)) return n;
    }
  }
  return undefined;
}

async function veniceFetch(
  apiKey: string,
  path: string,
  init: RequestInit,
  opts: VeniceClientOptions,
): Promise<Response> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 60_000);
  try {
    return await fetchImpl(`${opts.baseUrl}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
      },
      signal: controller.signal,
    });
  } catch (err) {
    // Never let the key ride along in a network error message.
    const msg = err instanceof Error ? redactSecrets(err.message, [apiKey]) : 'fetch failed';
    throw new VeniceError('network', `venice request failed: ${msg}`);
  } finally {
    clearTimeout(timer);
  }
}

async function readErrorBody(res: Response, apiKey: string): Promise<string> {
  try {
    const text = await res.text();
    return redactSecrets(text.slice(0, 300), [apiKey]);
  } catch {
    return '';
  }
}

export async function chatCompletion(
  apiKey: string,
  payload: Record<string, unknown>,
  opts: VeniceClientOptions,
): Promise<VeniceCallResult> {
  const res = await veniceFetch(
    apiKey,
    '/chat/completions',
    { method: 'POST', body: JSON.stringify({ ...payload, stream: false }) },
    opts,
  );

  if (!res.ok) {
    const bodyText = await readErrorBody(res, apiKey);
    const kind = classifyStatus(res.status, bodyText);
    throw new VeniceError(kind, `venice ${res.status}: ${bodyText}`, res.status);
  }

  const body = (await res.json()) as {
    model?: string;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  return {
    body,
    model: body.model ?? String(payload.model ?? 'unknown'),
    usage: {
      promptTokens: body.usage?.prompt_tokens ?? 0,
      completionTokens: body.usage?.completion_tokens ?? 0,
    },
    balanceUsd: parseBalanceUsd(res.headers),
  };
}

/**
 * Registration-time key check: a ~1-token completion against the cheapest
 * model. Proves the key is real AND funded (an unfunded key errors here).
 */
export async function validateKey(
  apiKey: string,
  model: string,
  opts: VeniceClientOptions,
): Promise<{ ok: true; balanceUsd?: number } | { ok: false; reason: string }> {
  try {
    const result = await chatCompletion(
      apiKey,
      { model, messages: [{ role: 'user', content: 'ping' }], max_tokens: 1 },
      { ...opts, timeoutMs: opts.timeoutMs ?? 20_000 },
    );
    return { ok: true, balanceUsd: result.balanceUsd };
  } catch (err) {
    if (err instanceof VeniceError) {
      if (err.kind === 'auth') return { ok: false, reason: 'key rejected by Venice (401/403)' };
      if (err.kind === 'insufficient_credit') {
        return { ok: false, reason: 'key has no available DIEM credit' };
      }
      return { ok: false, reason: `venice unreachable (${err.kind})` };
    }
    return { ok: false, reason: 'unexpected validation failure' };
  }
}

export type ProbeResult = 'healthy' | 'auth_failed' | 'rate_limited' | 'error';

/** Cheap health probe (GET /models burns no tokens but exercises auth). */
export async function probeKey(apiKey: string, opts: VeniceClientOptions): Promise<ProbeResult> {
  try {
    const res = await veniceFetch(apiKey, '/models', { method: 'GET' }, { ...opts, timeoutMs: 15_000 });
    if (res.ok) return 'healthy';
    if (res.status === 401 || res.status === 403) return 'auth_failed';
    if (res.status === 429 || res.status === 402) return 'rate_limited';
    return 'error';
  } catch {
    return 'error';
  }
}
