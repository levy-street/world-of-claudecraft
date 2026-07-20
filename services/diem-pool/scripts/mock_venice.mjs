// Mock Venice API for E2E smoke testing: OpenAI-compatible surface with
// Bearer auth. Keys containing "bad" are rejected 401; keys containing
// "broke" get 429 insufficient-credit.
import http from 'node:http';

const server = http.createServer((req, res) => {
  const key = (req.headers.authorization ?? '').replace('Bearer ', '');
  const json = (code, body) => {
    res.writeHead(code, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  if (!key || key.includes('bad')) return json(401, { error: { message: 'invalid api key' } });
  if (key.includes('broke')) {
    return json(429, { error: { message: 'insufficient credit balance for request' } });
  }
  if (req.method === 'GET' && req.url.endsWith('/models')) {
    return json(200, { data: [{ id: 'llama-3.3-70b' }, { id: 'llama-3.2-3b' }] });
  }
  if (req.method === 'POST' && req.url.endsWith('/chat/completions')) {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const p = JSON.parse(body || '{}');
      json(200, {
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
        usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
      });
    });
    return;
  }
  json(404, { error: { message: 'not found' } });
});

server.listen(4567, () => console.log('mock venice listening on :4567'));
