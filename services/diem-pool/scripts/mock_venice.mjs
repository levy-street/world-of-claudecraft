// Mock multi-vendor upstream for E2E smoke testing. Serves four dialects:
//   /api/v1/*        Venice   (OpenAI-compatible, Bearer)
//   /openai/v1/*     OpenAI   (OpenAI-compatible, Bearer)
//   /kimi/v1/*       Kimi     (OpenAI-compatible, Bearer)
//   /anthropic/v1/*  Anthropic (x-api-key, /messages, content blocks)
//
// Key modes (by substring), all dialects:
//   "bad"         → 401 on everything (invalid key)
//   "broke"       → credit exhausted on everything (unfunded key)
//   "flaky"       → passes the 1-token validation call, then 500s
//   "quota-later" → passes validation, then reports quota exhausted
//   "dies-later"  → passes validation, then 401s (stolen key killed upstream)
// Every successful chat call reports usage of 100 prompt / 50 completion
// tokens so metering assertions are exact.
import http from 'node:http';

const USAGE = { prompt: 100, completion: 50 };

function readBody(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => resolve(raw ? JSON.parse(raw) : {}));
  });
}

const server = http.createServer(async (req, res) => {
  const json = (code, body) => {
    res.writeHead(code, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  const url = req.url ?? '';
  const anthropic = url.startsWith('/anthropic/');
  const key = anthropic
    ? req.headers['x-api-key'] ?? ''
    : (req.headers.authorization ?? '').replace('Bearer ', '');

  if (!key || key.includes('bad')) {
    return anthropic
      ? json(401, { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } })
      : json(401, { error: { message: 'invalid api key' } });
  }
  if (key.includes('broke')) {
    return anthropic
      ? json(400, { type: 'error', error: { type: 'invalid_request_error', message: 'Your credit balance is too low' } })
      : json(429, { error: { message: 'You exceeded your current quota', code: 'insufficient_quota' } });
  }
  const deadAuth = () =>
    anthropic
      ? json(401, { type: 'error', error: { type: 'authentication_error', message: 'api key revoked' } })
      : json(401, { error: { message: 'api key revoked' } });
  if (key.includes('dies-later') && req.method === 'GET') return deadAuth();

  // ── Anthropic dialect ──────────────────────────────────────────────────────
  if (anthropic) {
    if (req.method === 'GET' && url.endsWith('/models')) {
      return json(200, { data: [{ id: 'claude-haiku-4-5' }, { id: 'claude-sonnet-4-5' }] });
    }
    if (req.method === 'POST' && url.endsWith('/messages')) {
      const p = await readBody(req);
      if (!p.model || !Array.isArray(p.messages) || typeof p.max_tokens !== 'number') {
        return json(400, { type: 'error', error: { type: 'invalid_request_error', message: 'model, messages, max_tokens required' } });
      }
      if (key.includes('dies-later') && p.max_tokens !== 1) return deadAuth();
      if (key.includes('flaky') && p.max_tokens !== 1) {
        return json(529, { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } });
      }
      if (key.includes('quota-later') && p.max_tokens !== 1) {
        return json(400, { type: 'error', error: { type: 'invalid_request_error', message: 'Your credit balance is too low' } });
      }
      return json(200, {
        id: 'msg-mock',
        type: 'message',
        role: 'assistant',
        model: p.model,
        content: [{ type: 'text', text: 'Well met, traveler of Claudemoon!' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: USAGE.prompt, output_tokens: USAGE.completion },
      });
    }
    return json(404, { type: 'error', error: { type: 'not_found_error', message: 'not found' } });
  }

  // ── OpenAI-compatible dialects (venice, openai, kimi) ──────────────────────
  if (req.method === 'GET' && url.endsWith('/models')) {
    return json(200, { data: [{ id: 'llama-3.3-70b' }, { id: 'gpt-4o-mini' }, { id: 'kimi-k2' }] });
  }
  if (req.method === 'POST' && url.endsWith('/chat/completions')) {
    const p = await readBody(req);
    if (key.includes('dies-later') && p.max_tokens !== 1) return deadAuth();
    if (key.includes('flaky') && p.max_tokens !== 1) {
      return json(500, { error: { message: 'upstream exploded' } });
    }
    if (key.includes('quota-later') && p.max_tokens !== 1) {
      return json(429, { error: { message: 'You exceeded your current quota', code: 'insufficient_quota' } });
    }
    return json(200, {
      id: 'chatcmpl-mock',
      object: 'chat.completion',
      model: p.model ?? 'unknown',
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: 'Well met, traveler of Claudemoon!' },
          finish_reason: 'stop',
        },
      ],
      usage: {
        prompt_tokens: USAGE.prompt,
        completion_tokens: USAGE.completion,
        total_tokens: USAGE.prompt + USAGE.completion,
      },
    });
  }
  json(404, { error: { message: 'not found' } });
});

server.listen(4567, () => console.log('mock multi-vendor upstream listening on :4567'));
