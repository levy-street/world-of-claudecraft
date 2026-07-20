import { redactSecrets } from '../crypto';
import { VeniceError, type ProbeResult, type VeniceCallResult } from '../venice';

// Anthropic Messages API adapter: the one vendor that is not
// OpenAI-compatible. Translates OpenAI-style chat payloads to /v1/messages
// requests and normalizes responses back to the OpenAI chat-completion shape
// so the game-facing contract never varies by vendor.

const ANTHROPIC_VERSION = '2023-06-01';
const DEFAULT_MAX_TOKENS = 1024;

interface AnthropicOptions {
  baseUrl: string; // includes /v1
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

type OpenAiMessage = { role: string; content: unknown };

function textOf(content: unknown, role: string): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (part && typeof part === 'object' && (part as { type?: string }).type === 'text') {
          return String((part as { text?: unknown }).text ?? '');
        }
        throw new VeniceError(
          'bad_request',
          `anthropic adapter: unsupported ${role} content part (only text parts are translated in v1)`,
        );
      })
      .join('');
  }
  if (content === null || content === undefined) return '';
  throw new VeniceError('bad_request', `anthropic adapter: unsupported ${role} content shape`);
}

/** OpenAI chat payload → Anthropic /v1/messages body. Exported for tests. */
export function translateRequest(
  payload: Record<string, unknown>,
  model: string,
): Record<string, unknown> {
  const messages = (payload.messages ?? []) as OpenAiMessage[];
  const systemParts: string[] = [];
  const turns: Array<{ role: 'user' | 'assistant'; content: string }> = [];

  for (const m of messages) {
    if (m.role === 'system') {
      systemParts.push(textOf(m.content, 'system'));
    } else if (m.role === 'user' || m.role === 'assistant') {
      turns.push({ role: m.role, content: textOf(m.content, m.role) });
    } else {
      throw new VeniceError(
        'bad_request',
        `anthropic adapter: role "${m.role}" is not supported in v1`,
      );
    }
  }
  if (turns.length === 0) {
    throw new VeniceError('bad_request', 'anthropic adapter: at least one user/assistant message required');
  }

  const body: Record<string, unknown> = {
    model,
    messages: turns,
    // Anthropic requires max_tokens; OpenAI callers may omit it.
    max_tokens: typeof payload.max_tokens === 'number' ? payload.max_tokens : DEFAULT_MAX_TOKENS,
  };
  if (systemParts.length) body.system = systemParts.join('\n');
  if (typeof payload.temperature === 'number') {
    // OpenAI range is [0,2], Anthropic's is [0,1].
    body.temperature = Math.min(payload.temperature, 1);
  }
  if (typeof payload.top_p === 'number') body.top_p = payload.top_p;
  if (Array.isArray(payload.stop)) body.stop_sequences = payload.stop;
  return body;
}

const STOP_REASON_MAP: Record<string, string> = {
  end_turn: 'stop',
  stop_sequence: 'stop',
  max_tokens: 'length',
};

/** Anthropic response body → OpenAI chat-completion shape. Exported for tests. */
export function normalizeResponse(body: {
  id?: string;
  model?: string;
  content?: Array<{ type: string; text?: string }>;
  stop_reason?: string;
  usage?: { input_tokens?: number; output_tokens?: number };
}): VeniceCallResult {
  const text = (body.content ?? [])
    .filter((block) => block.type === 'text')
    .map((block) => block.text ?? '')
    .join('');
  const promptTokens = body.usage?.input_tokens ?? 0;
  const completionTokens = body.usage?.output_tokens ?? 0;
  return {
    body: {
      id: body.id ?? 'msg-unknown',
      object: 'chat.completion',
      model: body.model ?? 'unknown',
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: text },
          finish_reason: STOP_REASON_MAP[body.stop_reason ?? ''] ?? (body.stop_reason || 'stop'),
        },
      ],
      usage: {
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: promptTokens + completionTokens,
      },
    },
    model: body.model ?? 'unknown',
    usage: { promptTokens, completionTokens },
  };
}

function classify(status: number, bodyText: string): VeniceError['kind'] {
  if (status === 401 || status === 403) return 'auth';
  if (status === 400 && /credit balance|billing/i.test(bodyText)) return 'insufficient_credit';
  if (status === 429) return 'rate_limited';
  // 529 = overloaded_error: transient upstream saturation, retry/fail over.
  if (status === 529 || status >= 500) return 'server';
  return 'bad_request';
}

async function anthropicFetch(
  key: string,
  path: string,
  init: RequestInit,
  opts: AnthropicOptions,
): Promise<Response> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 60_000);
  try {
    return await fetchImpl(`${opts.baseUrl}${path}`, {
      ...init,
      headers: {
        'x-api-key': key,
        'anthropic-version': ANTHROPIC_VERSION,
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
      },
      signal: controller.signal,
    });
  } catch (err) {
    const msg = err instanceof Error ? redactSecrets(err.message, [key]) : 'fetch failed';
    throw new VeniceError('network', `anthropic request failed: ${msg}`);
  } finally {
    clearTimeout(timer);
  }
}

export async function anthropicChat(
  key: string,
  payload: Record<string, unknown>,
  model: string,
  opts: AnthropicOptions,
): Promise<VeniceCallResult> {
  const body = translateRequest(payload, model);
  const res = await anthropicFetch(key, '/messages', { method: 'POST', body: JSON.stringify(body) }, opts);
  if (!res.ok) {
    const text = redactSecrets((await res.text().catch(() => '')).slice(0, 300), [key]);
    throw new VeniceError(classify(res.status, text), `anthropic ${res.status}: ${text}`, res.status);
  }
  return normalizeResponse(await res.json());
}

export async function anthropicProbe(key: string, opts: AnthropicOptions): Promise<ProbeResult> {
  try {
    const res = await anthropicFetch(key, '/models', { method: 'GET' }, { ...opts, timeoutMs: 15_000 });
    if (res.ok) return 'healthy';
    if (res.status === 401 || res.status === 403) return 'auth_failed';
    if (res.status === 429) return 'rate_limited';
    return 'error';
  } catch {
    return 'error';
  }
}

export async function anthropicValidateKey(
  key: string,
  model: string,
  opts: AnthropicOptions,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  try {
    await anthropicChat(
      key,
      { messages: [{ role: 'user', content: 'ping' }], max_tokens: 1 },
      model,
      { ...opts, timeoutMs: opts.timeoutMs ?? 20_000 },
    );
    return { ok: true };
  } catch (err) {
    if (err instanceof VeniceError) {
      if (err.kind === 'auth') return { ok: false, reason: 'key rejected by Anthropic (401/403)' };
      if (err.kind === 'insufficient_credit') return { ok: false, reason: 'key has no available credit' };
      return { ok: false, reason: `anthropic unreachable (${err.kind})` };
    }
    return { ok: false, reason: 'unexpected validation failure' };
  }
}
