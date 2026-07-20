import { describe, expect, it } from 'vitest';
import {
  anthropicChat,
  anthropicProbe,
  anthropicValidateKey,
  normalizeResponse,
  translateRequest,
} from '@/lib/vendors/anthropic';
import { VeniceError } from '@/lib/venice';

const KEY = 'sk-ant-secret-0123456789abcdef';
const BASE = 'https://anthropic.test/v1';

function optsWith(fetchImpl: typeof fetch) {
  return { baseUrl: BASE, fetchImpl, timeoutMs: 1_000 };
}

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
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

describe('translateRequest (OpenAI → Anthropic Messages)', () => {
  it('hoists system messages to the top-level system param', () => {
    const body = translateRequest(
      {
        messages: [
          { role: 'system', content: 'You are the DM.' },
          { role: 'user', content: 'Narrate.' },
          { role: 'assistant', content: 'The crypt looms.' },
          { role: 'user', content: 'Continue.' },
        ],
      },
      'claude-haiku-4-5',
    );
    expect(body.system).toBe('You are the DM.');
    expect(body.messages).toEqual([
      { role: 'user', content: 'Narrate.' },
      { role: 'assistant', content: 'The crypt looms.' },
      { role: 'user', content: 'Continue.' },
    ]);
    expect(body.model).toBe('claude-haiku-4-5');
  });

  it('defaults the required max_tokens and passes an explicit one through', () => {
    const base = { messages: [{ role: 'user', content: 'hi' }] };
    expect(translateRequest(base, 'm').max_tokens).toBe(1024);
    expect(translateRequest({ ...base, max_tokens: 77 }, 'm').max_tokens).toBe(77);
  });

  it('flattens OpenAI text-part arrays and joins multiple system messages', () => {
    const body = translateRequest(
      {
        messages: [
          { role: 'system', content: 'A.' },
          { role: 'system', content: 'B.' },
          { role: 'user', content: [{ type: 'text', text: 'part1 ' }, { type: 'text', text: 'part2' }] },
        ],
      },
      'm',
    );
    expect(body.system).toBe('A.\nB.');
    expect((body.messages as Array<{ content: string }>)[0].content).toBe('part1 part2');
  });

  it('clamps OpenAI temperature range [0,2] to Anthropic [0,1] and maps stop', () => {
    const body = translateRequest(
      { messages: [{ role: 'user', content: 'x' }], temperature: 1.8, stop: ['\n'] },
      'm',
    );
    expect(body.temperature).toBe(1);
    expect(body.stop_sequences).toEqual(['\n']);
  });

  it('rejects tool messages and image parts as bad_request (no silent drop)', () => {
    expect(() =>
      translateRequest({ messages: [{ role: 'tool', content: 'result' }] }, 'm'),
    ).toThrowError(/role "tool"/);
    expect(() =>
      translateRequest(
        { messages: [{ role: 'user', content: [{ type: 'image_url', image_url: {} }] }] },
        'm',
      ),
    ).toThrowError(/unsupported user content/);
    expect(() => translateRequest({ messages: [{ role: 'system', content: 's' }] }, 'm')).toThrowError(
      /at least one/,
    );
  });
});

describe('normalizeResponse (Anthropic → OpenAI shape)', () => {
  it('joins text blocks, maps stop reasons, and converts usage fields', () => {
    const result = normalizeResponse({
      id: 'msg_1',
      model: 'claude-haiku-4-5',
      content: [
        { type: 'text', text: 'Well met, ' },
        { type: 'text', text: 'traveler.' },
      ],
      stop_reason: 'end_turn',
      usage: { input_tokens: 12, output_tokens: 34 },
    });
    const body = result.body as {
      choices: Array<{ message: { content: string }; finish_reason: string }>;
      usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
    };
    expect(body.choices[0].message.content).toBe('Well met, traveler.');
    expect(body.choices[0].finish_reason).toBe('stop');
    expect(body.usage).toEqual({ prompt_tokens: 12, completion_tokens: 34, total_tokens: 46 });
    expect(result.usage).toEqual({ promptTokens: 12, completionTokens: 34 });
    expect(result.model).toBe('claude-haiku-4-5');
  });

  it('maps max_tokens stop to OpenAI "length"', () => {
    const result = normalizeResponse({
      content: [{ type: 'text', text: 'x' }],
      stop_reason: 'max_tokens',
      usage: { input_tokens: 1, output_tokens: 1 },
    });
    expect((result.body as { choices: Array<{ finish_reason: string }> }).choices[0].finish_reason).toBe('length');
  });
});

describe('anthropicChat error classification', () => {
  const PAYLOAD = { messages: [{ role: 'user', content: 'hi' }] };

  it('sends x-api-key + anthropic-version, never Bearer', async () => {
    let captured: RequestInit | null = null;
    const fetchImpl = (async (_url: any, init: any) => {
      captured = init;
      return jsonResponse(200, {
        content: [{ type: 'text', text: 'ok' }],
        usage: { input_tokens: 1, output_tokens: 1 },
      });
    }) as typeof fetch;
    await anthropicChat(KEY, PAYLOAD, 'claude-haiku-4-5', optsWith(fetchImpl));
    const headers = captured!.headers as Record<string, string>;
    expect(headers['x-api-key']).toBe(KEY);
    expect(headers['anthropic-version']).toBeTruthy();
    expect(headers.Authorization).toBeUndefined();
  });

  it.each([
    [401, {}, 'auth', false],
    [400, { error: { message: 'Your credit balance is too low' } }, 'insufficient_credit', false],
    [400, { error: { message: 'invalid model' } }, 'bad_request', false],
    [429, {}, 'rate_limited', true],
    [529, { error: { type: 'overloaded_error' } }, 'server', true],
    [500, {}, 'server', true],
  ] as const)('classifies HTTP %i as %s (retryable=%s)', async (status, body, kind, retryable) => {
    const fetchImpl = (async () => jsonResponse(status, body)) as typeof fetch;
    const err = await errorFrom(anthropicChat(KEY, PAYLOAD, 'm', optsWith(fetchImpl)));
    expect(err.kind).toBe(kind);
    expect(err.retryable).toBe(retryable);
  });

  it('redacts the key from error bodies and network failures', async () => {
    const withKey = (async () => new Response(`bad key ${KEY}`, { status: 500 })) as typeof fetch;
    expect((await errorFrom(anthropicChat(KEY, PAYLOAD, 'm', optsWith(withKey)))).message).not.toContain(KEY);

    const network = (async () => {
      throw new Error(`ECONNREFUSED with ${KEY}`);
    }) as typeof fetch;
    const err = await errorFrom(anthropicChat(KEY, PAYLOAD, 'm', optsWith(network)));
    expect(err.kind).toBe('network');
    expect(err.message).not.toContain(KEY);
  });
});

describe('anthropicProbe / anthropicValidateKey', () => {
  it.each([
    [200, 'healthy'],
    [401, 'auth_failed'],
    [429, 'rate_limited'],
    [500, 'error'],
  ] as const)('probe maps HTTP %i to %s', async (status, expected) => {
    const fetchImpl = (async () => jsonResponse(status, {})) as typeof fetch;
    expect(await anthropicProbe(KEY, optsWith(fetchImpl))).toBe(expected);
  });

  it('validateKey surfaces auth and credit reasons', async () => {
    const auth = (async () => jsonResponse(401, {})) as typeof fetch;
    expect(await anthropicValidateKey(KEY, 'm', optsWith(auth))).toEqual({
      ok: false,
      reason: 'key rejected by Anthropic (401/403)',
    });
    const broke = (async () =>
      jsonResponse(400, { error: { message: 'Your credit balance is too low' } })) as typeof fetch;
    expect(await anthropicValidateKey(KEY, 'm', optsWith(broke))).toEqual({
      ok: false,
      reason: 'key has no available credit',
    });
    const good = (async () =>
      jsonResponse(200, { content: [{ type: 'text', text: 'y' }], usage: { input_tokens: 1, output_tokens: 1 } })) as typeof fetch;
    expect(await anthropicValidateKey(KEY, 'm', optsWith(good))).toEqual({ ok: true });
  });
});
