import { describe, expect, it } from 'vitest';
import {
  chatCompletion,
  probeKey,
  validateKey,
  VeniceError,
  type VeniceClientOptions,
} from '@/lib/venice';

// The Venice client is exercised for real; only the network dependency is
// injected (fetchImpl), never the code under test.

const KEY = 'vn_secret_key_0123456789abcdef';
const BASE = 'https://venice.test/api/v1';

function optsWith(fetchImpl: typeof fetch): VeniceClientOptions {
  return { baseUrl: BASE, fetchImpl, timeoutMs: 1_000 };
}

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

async function errorFrom(promise: Promise<unknown>): Promise<VeniceError> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof VeniceError) return err;
    throw err;
  }
  throw new Error('expected VeniceError');
}

const PAYLOAD = { model: 'llama-3.3-70b', messages: [{ role: 'user', content: 'hi' }] };

describe('chatCompletion', () => {
  it('sends bearer auth, forces stream:false, and parses usage', async () => {
    let captured: { url: string; init: RequestInit } | null = null;
    const fetchImpl = (async (url: any, init: any) => {
      captured = { url: String(url), init };
      return jsonResponse(200, {
        model: 'llama-3.3-70b',
        usage: { prompt_tokens: 12, completion_tokens: 34 },
        choices: [],
      });
    }) as typeof fetch;

    const res = await chatCompletion(KEY, { ...PAYLOAD, stream: true }, optsWith(fetchImpl));
    expect(captured!.url).toBe(`${BASE}/chat/completions`);
    expect((captured!.init.headers as Record<string, string>).Authorization).toBe(`Bearer ${KEY}`);
    expect(JSON.parse(captured!.init.body as string).stream).toBe(false);
    expect(res.usage).toEqual({ promptTokens: 12, completionTokens: 34 });
    expect(res.model).toBe('llama-3.3-70b');
  });

  it('defaults usage to zeros and model to the request when the body omits them', async () => {
    const fetchImpl = (async () => jsonResponse(200, { choices: [] })) as typeof fetch;
    const res = await chatCompletion(KEY, PAYLOAD, optsWith(fetchImpl));
    expect(res.usage).toEqual({ promptTokens: 0, completionTokens: 0 });
    expect(res.model).toBe('llama-3.3-70b');
  });

  it('parses balance headers when Venice exposes them', async () => {
    const fetchImpl = (async () =>
      jsonResponse(200, { choices: [] }, { 'x-venice-balance-usd': '7.25' })) as typeof fetch;
    const res = await chatCompletion(KEY, PAYLOAD, optsWith(fetchImpl));
    expect(res.balanceUsd).toBe(7.25);
  });

  it.each([
    [401, 'auth', false],
    [403, 'auth', false],
    [402, 'insufficient_credit', false],
    [400, 'bad_request', false],
    [500, 'server', true],
    [503, 'server', true],
  ] as const)('classifies HTTP %i as %s (retryable=%s)', async (status, kind, retryable) => {
    const fetchImpl = (async () => jsonResponse(status, { error: { message: 'nope' } })) as typeof fetch;
    const err = await errorFrom(chatCompletion(KEY, PAYLOAD, optsWith(fetchImpl)));
    expect(err.kind).toBe(kind);
    expect(err.retryable).toBe(retryable);
    expect(err.status).toBe(status);
  });

  it('classifies 429 by body: credit exhaustion vs plain rate limiting', async () => {
    const broke = (async () =>
      jsonResponse(429, { error: { message: 'insufficient credit balance' } })) as typeof fetch;
    expect((await errorFrom(chatCompletion(KEY, PAYLOAD, optsWith(broke)))).kind).toBe(
      'insufficient_credit',
    );

    const busy = (async () =>
      jsonResponse(429, { error: { message: 'too many requests' } })) as typeof fetch;
    const err = await errorFrom(chatCompletion(KEY, PAYLOAD, optsWith(busy)));
    expect(err.kind).toBe('rate_limited');
    expect(err.retryable).toBe(true);
  });

  it('classifies thrown fetches as network errors and redacts the key', async () => {
    const fetchImpl = (async () => {
      throw new Error(`connect ECONNREFUSED while sending Bearer ${KEY}`);
    }) as typeof fetch;
    const err = await errorFrom(chatCompletion(KEY, PAYLOAD, optsWith(fetchImpl)));
    expect(err.kind).toBe('network');
    expect(err.retryable).toBe(true);
    expect(err.message).not.toContain(KEY);
  });

  it('redacts the key and truncates upstream error bodies', async () => {
    const fetchImpl = (async () =>
      new Response(`key ${KEY} invalid ` + 'x'.repeat(1000), { status: 500 })) as typeof fetch;
    const err = await errorFrom(chatCompletion(KEY, PAYLOAD, optsWith(fetchImpl)));
    expect(err.message).not.toContain(KEY);
    expect(err.message.length).toBeLessThan(400);
  });
});

describe('validateKey', () => {
  it('accepts a key that completes a ~1-token call', async () => {
    const fetchImpl = (async () =>
      jsonResponse(200, { usage: { prompt_tokens: 1, completion_tokens: 1 } })) as typeof fetch;
    expect(await validateKey(KEY, 'llama-3.2-3b', optsWith(fetchImpl))).toEqual({
      ok: true,
      balanceUsd: undefined,
    });
  });

  it.each([
    [401, 'key rejected by Venice (401/403)'],
    [402, 'key has no available DIEM credit'],
    [500, 'venice unreachable (server)'],
  ] as const)('rejects on HTTP %i with a specific reason', async (status, reason) => {
    const fetchImpl = (async () => jsonResponse(status, { error: {} })) as typeof fetch;
    expect(await validateKey(KEY, 'llama-3.2-3b', optsWith(fetchImpl))).toEqual({
      ok: false,
      reason,
    });
  });
});

describe('probeKey', () => {
  it.each([
    [200, 'healthy'],
    [401, 'auth_failed'],
    [403, 'auth_failed'],
    [429, 'rate_limited'],
    [402, 'rate_limited'],
    [500, 'error'],
  ] as const)('maps HTTP %i to %s', async (status, expected) => {
    const fetchImpl = (async () => jsonResponse(status, {})) as typeof fetch;
    expect(await probeKey(KEY, optsWith(fetchImpl))).toBe(expected);
  });

  it('maps network failure to error', async () => {
    const fetchImpl = (async () => {
      throw new Error('ECONNRESET');
    }) as typeof fetch;
    expect(await probeKey(KEY, optsWith(fetchImpl))).toBe('error');
  });
});
