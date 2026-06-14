import * as http from 'node:http';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { WebSocketServer, WebSocket } from 'ws';
import {
  ensureSchema, pool, createAccount, findAccount, touchLogin, saveToken, accountForToken,
  listCharacters, getCharacter, createCharacter, deleteCharacter, closeOrphanSessions,
  pruneChatLogs, topArenaRatings,
} from './db';
import { hashPassword, verifyPassword, newToken, validUsername, validPassword, validCharName } from './auth';
import { json, readBody } from './http_util';
import { rateLimited } from './ratelimit';
import { handleAdminApi } from './admin';
import { GameServer } from './game';
import { cacheControlFor, etagFor, isNotModified } from './static_cache';

const PORT = Number(process.env.PORT ?? 8787);
const STATIC_DIR = path.join(__dirname, '..', 'dist');
// How long chat logs are kept (0 = forever); pruned at boot and daily.
const CHAT_LOG_RETENTION_DAYS = Number(process.env.CHAT_LOG_RETENTION_DAYS ?? 90);

const game = new GameServer();

async function bearerAccount(req: http.IncomingMessage): Promise<number | null> {
  const auth = req.headers.authorization ?? '';
  const m = /^Bearer ([a-f0-9]{64})$/.exec(auth);
  if (!m) return null;
  return accountForToken(m[1]);
}

const MIME: Record<string, string> = {
  '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json',
  '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.bin': 'application/octet-stream',
  '.hdr': 'application/octet-stream', '.ktx2': 'image/ktx2', '.wasm': 'application/wasm',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
};

// The admin dashboard is reached via the admin.* subdomain (Caddy proxies it
// to this same port) or /admin for local dev. The hostname only picks which
// HTML shell is served — the admin API itself is gated by admin tokens.
function isAdminRequest(req: http.IncomingMessage): boolean {
  const host = String(req.headers.host ?? '').toLowerCase();
  const urlPath = (req.url ?? '/').split('?')[0];
  return host.startsWith('admin.') || urlPath === '/admin' || urlPath === '/admin/';
}

function serveStatic(req: http.IncomingMessage, res: http.ServerResponse): void {
  const shell = isAdminRequest(req) ? 'admin.html' : 'index.html';
  let urlPath = (req.url ?? '/').split('?')[0];
  if (urlPath === '/' || urlPath === '/admin' || urlPath === '/admin/') urlPath = `/${shell}`;
  // normalize once and reuse for BOTH file resolution and cache policy —
  // otherwise /assets/../x would serve a mutable file with immutable caching
  urlPath = path.posix.normalize(urlPath).replace(/^([.][.][/\\])+/, '');
  const file = path.join(STATIC_DIR, urlPath);
  const stats = file.startsWith(STATIC_DIR) && fs.existsSync(file) ? fs.statSync(file) : null;
  if (!stats?.isFile()) {
    // Asset paths must 404, not SPA-fall-back: a missing .glb served as index.html
    // surfaces as a cryptic GLTFLoader parse error instead of a clear 404.
    if (path.extname(urlPath) && path.extname(urlPath) !== '.html') {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('not found');
      return;
    }
    // SPA fallback
    const index = path.join(STATIC_DIR, shell);
    if (fs.existsSync(index)) {
      res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-cache' });
      fs.createReadStream(index).pipe(res);
    } else {
      res.writeHead(404);
      res.end('not found (run `npm run build` to serve the client from the game server)');
    }
    return;
  }
  const isReadMethod = req.method === 'GET' || req.method === 'HEAD';
  const etag = etagFor(stats);
  const validators = {
    'Cache-Control': cacheControlFor(urlPath),
    'ETag': etag,
    'Last-Modified': stats.mtime.toUTCString(),
  };
  if (isReadMethod && isNotModified(req.headers, etag, stats.mtime)) {
    res.writeHead(304, validators);
    res.end();
    return;
  }
  res.writeHead(200, {
    ...validators,
    'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream',
    'Content-Length': stats.size,
  });
  if (req.method === 'HEAD') {
    // don't read a multi-MB asset from disk just to discard the bytes
    res.end();
    return;
  }
  fs.createReadStream(file).pipe(res);
}

// ---------------------------------------------------------------------------
// REST API
// ---------------------------------------------------------------------------

async function handleApi(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const url = (req.url ?? '').split('?')[0];
  try {
    if (req.method === 'POST' && (url === '/api/register' || url === '/api/login') && rateLimited(req)) {
      return json(res, 429, { error: 'too many attempts — wait a minute and try again' });
    }
    if (req.method === 'POST' && url === '/api/register') {
      const body = await readBody(req);
      if (!validUsername(body.username)) return json(res, 400, { error: 'username must be 3-24 chars (letters, digits, _)' });
      if (!validPassword(body.password)) return json(res, 400, { error: 'password must be at least 6 chars' });
      const existing = await findAccount(body.username);
      if (existing) return json(res, 409, { error: 'username already taken' });
      const account = await createAccount(body.username, await hashPassword(body.password));
      const token = newToken();
      await saveToken(token, account.id);
      return json(res, 200, { token, username: account.username });
    }
    if (req.method === 'POST' && url === '/api/login') {
      const body = await readBody(req);
      const account = typeof body.username === 'string' ? await findAccount(body.username) : null;
      if (!account || !(await verifyPassword(String(body.password ?? ''), account.password_hash))) {
        return json(res, 401, { error: 'invalid username or password' });
      }
      await touchLogin(account.id);
      const token = newToken();
      await saveToken(token, account.id);
      return json(res, 200, { token, username: account.username });
    }
    if (url === '/api/characters') {
      const accountId = await bearerAccount(req);
      if (accountId === null) return json(res, 401, { error: 'not authenticated' });
      if (req.method === 'GET') {
        const chars = await listCharacters(accountId);
        return json(res, 200, {
          characters: chars.map((c) => ({
            id: c.id, name: c.name, class: c.class, level: c.level,
            online: [...game.clients.values()].some((s) => s.characterId === c.id),
          })),
        });
      }
      if (req.method === 'POST') {
        const body = await readBody(req);
        if (!validCharName(body.name)) return json(res, 400, { error: 'invalid character name (2-16 letters; Latin or Chinese)' });
        const validClasses = ['warrior', 'paladin', 'hunter', 'rogue', 'priest', 'shaman', 'mage', 'warlock', 'druid'];
        if (!validClasses.includes(body.class)) return json(res, 400, { error: 'invalid class' });
        const chars = await listCharacters(accountId);
        if (chars.length >= 10) return json(res, 400, { error: 'character limit reached' });
        try {
          const c = await createCharacter(accountId, body.name, body.class);
          return json(res, 200, { id: c.id, name: c.name, class: c.class, level: c.level });
        } catch (err: any) {
          if (String(err?.message).includes('unique') || err?.code === '23505') {
            return json(res, 409, { error: 'that name is taken' });
          }
          throw err;
        }
      }
    }
    const delMatch = /^\/api\/characters\/(\d+)$/.exec(url);
    if (req.method === 'DELETE' && delMatch) {
      const accountId = await bearerAccount(req);
      if (accountId === null) return json(res, 401, { error: 'not authenticated' });
      const ok = await deleteCharacter(accountId, Number(delMatch[1]));
      return json(res, ok ? 200 : 404, ok ? { ok: true } : { error: 'not found' });
    }
    if (req.method === 'GET' && url === '/api/status') {
      return json(res, 200, {
        ok: true,
        players_online: game.clients.size,
        names: [...game.clients.values()].map((s) => s.name),
      });
    }
    if (req.method === 'GET' && url === '/api/arena/leaderboard') {
      // public all-time Ashen Coliseum ladder (top rated characters)
      return json(res, 200, { leaders: await topArenaRatings(20) });
    }
    json(res, 404, { error: 'unknown endpoint' });
  } catch (err: any) {
    console.error('api error:', err);
    json(res, 500, { error: 'internal error' });
  }
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  // wait for the database (it may still be starting in docker)
  for (let attempt = 1; ; attempt++) {
    try {
      await pool.query('SELECT 1');
      break;
    } catch (err) {
      if (attempt >= 30) throw err;
      console.log(`waiting for postgres (attempt ${attempt})...`);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  await ensureSchema();
  const orphans = await closeOrphanSessions();
  if (orphans > 0) console.log(`closed ${orphans} orphaned play session(s) from a previous run`);
  const pruned = await pruneChatLogs(CHAT_LOG_RETENTION_DAYS);
  if (pruned > 0) console.log(`pruned ${pruned} chat log row(s) older than ${CHAT_LOG_RETENTION_DAYS} days`);
  await game.loadMarket();
  setInterval(() => {
    void pruneChatLogs(CHAT_LOG_RETENTION_DAYS).catch((err) => console.error('chat log prune failed:', err));
  }, 24 * 3600 * 1000).unref();
  console.log('database ready');

  const server = http.createServer((req, res) => {
    const url = req.url ?? '';
    if (url.startsWith('/admin/api/')) void handleAdminApi(req, res, game);
    else if (url.startsWith('/api/')) void handleApi(req, res);
    else serveStatic(req, res);
  });

  // cap frame size: the largest legitimate client message is a small JSON
  // command; without this the ws default (~100 MiB) lets one socket force a
  // huge allocation + parse before any field-level validation runs
  const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 });
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname !== '/ws') {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      void onConnection(ws);
    });
  });

  async function authenticateWebSocket(ws: WebSocket, raw: string): Promise<void> {
    let msg: any;
    try {
      msg = JSON.parse(raw);
    } catch {
      ws.send(JSON.stringify({ t: 'error', error: 'bad auth message' }));
      ws.close();
      return;
    }
    if (msg?.t !== 'auth') {
      ws.send(JSON.stringify({ t: 'error', error: 'authentication required' }));
      ws.close();
      return;
    }

    const token = typeof msg.token === 'string' ? msg.token : '';
    const characterId = Number(msg.character ?? 'NaN');
    const accountId = await accountForToken(token);
    if (accountId === null || !Number.isFinite(characterId)) {
      ws.send(JSON.stringify({ t: 'error', error: 'not authenticated' }));
      ws.close();
      return;
    }
    const character = await getCharacter(accountId, characterId);
    if (!character) {
      ws.send(JSON.stringify({ t: 'error', error: 'no such character' }));
      ws.close();
      return;
    }
    const result = game.join(ws, accountId, character.id, character.name, character.class, character.state, character.is_gm);
    if ('error' in result) {
      ws.send(JSON.stringify({ t: 'error', error: result.error }));
      ws.close();
      return;
    }
    const session = result;
    console.log(`+ ${character.name} (${character.class}) joined — ${game.clients.size} online`);
    ws.on('message', (data) => {
      game.handleMessage(session, String(data));
    });
    ws.on('close', () => {
      void game.leave(session, 'disconnected');
      console.log(`- ${character.name} left — ${game.clients.size} online`);
    });
    ws.on('error', () => {
      void game.leave(session, 'connection error');
    });
  }

  async function onConnection(ws: WebSocket): Promise<void> {
    const authTimer = setTimeout(() => {
      ws.send(JSON.stringify({ t: 'error', error: 'authentication timed out' }));
      ws.close();
    }, 10_000);

    // Pre-auth socket errors (e.g. a first frame over maxPayload, which ws
    // surfaces as an 'error' event) would otherwise be an unhandled exception
    // and crash the process. Tear the connection down quietly instead. The
    // post-auth game.leave handler is attached separately once joined.
    ws.on('error', () => {
      clearTimeout(authTimer);
      try { ws.close(); } catch { /* already closing */ }
    });

    ws.once('message', (data) => {
      clearTimeout(authTimer);
      void authenticateWebSocket(ws, String(data));
    });
  }

  game.start();
  server.listen(PORT, () => {
    console.log(`World of Claudecraft server listening on http://localhost:${PORT}`);
    console.log(`  REST: /api/register /api/login /api/characters /api/status`);
    console.log(`  WS:   /ws, then first message {t:"auth",token,character}`);
  });

  const shutdown = async () => {
    console.log('shutting down: saving characters...');
    game.stop();
    await game.saveAll('shutdown');
    await game.saveMarket();
    await game.endAllPlaySessions();
    await game.chatLog.stop();
    await pool.end();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Last-resort net: one player's request must never crash the process and
  // disconnect everyone. handleMessage already guards itself, but any future
  // uncaught throw in a timer or async path would otherwise be fatal. Log and
  // keep serving — a live world staying up beats a clean crash-loop. Genuinely
  // fatal startup errors are still handled by main().catch() below.
  process.on('uncaughtException', (err) => {
    console.error('uncaughtException (kept alive):', err);
  });
  process.on('unhandledRejection', (reason) => {
    console.error('unhandledRejection (kept alive):', reason);
  });
}

main().catch((err) => {
  console.error('fatal:', err);
  process.exit(1);
});
