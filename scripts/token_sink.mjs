// token_sink.mjs — tiny LOCAL http server. The browser (via an injected fetch
// interceptor) beacons captured /api/login bearer tokens here; we write them to
// multibox.tokens.json (which multibox.mjs auto-reads). The token goes
// browser → localhost → file and never passes through the AI's context.
import http from 'node:http';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const PORT = Number(process.env.TOKEN_SINK_PORT ?? 9988);
const FILE = 'multibox.tokens.json';

http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  if (req.method === 'POST' && req.url.startsWith('/token')) {
    const user = new URL(req.url, 'http://x').searchParams.get('user') || '';
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const token = body.trim();
      if (user && token) {
        let store = {};
        try { if (existsSync(FILE)) store = JSON.parse(readFileSync(FILE, 'utf8')); } catch {}
        store[user] = token;
        writeFileSync(FILE, JSON.stringify(store, null, 2));
        console.log(`captured token for ${user} (${token.length} chars) -> ${FILE}  [have: ${Object.keys(store).join(', ')}]`);
      }
      res.writeHead(200); res.end('ok');
    });
    return;
  }
  res.writeHead(404); res.end();
}).listen(PORT, () => console.log(`token sink listening on http://localhost:${PORT} -> ${FILE}`));
