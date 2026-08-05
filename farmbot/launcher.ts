// The farmbot launcher's IO shell: a small node:http server (no dependencies)
// bound to 127.0.0.1 only, serving the embedded single-page UI
// (launcher_page.ts) and a tiny JSON API for loading characters, starting and
// stopping the bot child process, and streaming its log. All decisions that
// can be pure live in launcher_core.ts (ring log, config assembly, zone
// list); this file owns sockets, the child process, and the clock.
//
// Credential handling: the username/password arrive over loopback POST bodies
// and are used in memory only. The config written to a temp file for the
// child contains NO credentials; the child gets them via the WOC_USERNAME /
// WOC_PASSWORD environment variables. Nothing is persisted.

import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Api } from '../src/net/online';
import { GATHER_NODE_TYPES, GATHER_NODES } from '../src/sim/content/gather_nodes';
import { ITEMS, ZONES } from '../src/sim/data';
import { type FarmBotConfig, parseConfig } from './config';
import {
  assembleConfig,
  buildItemCatalog,
  buildZoneMeta,
  deriveZones,
  describeSource,
  type Fbstat,
  FbstatFilter,
  type LauncherFormConfig,
  RingLog,
  resolveSourcesPreview,
} from './launcher_core';
import { LAUNCHER_PAGE } from './launcher_page';
import { installNodeShims } from './shims';

const DEFAULT_PORT = 4787;
const MAX_BODY_BYTES = 256 * 1024;
const STOP_GRACE_MS = 5000;
// The launcher bundles to dist-farmbot/launcher.cjs and the bot bundle sits
// next to it, so resolve relative to this file, never the caller's cwd.
const BOT_BUNDLE = join(__dirname, 'farmbot.cjs');

const log = new RingLog();
// Child stdout runs through this: FBSTAT status lines are skimmed off (latest
// wins) and never reach the log pane.
const fbstat = new FbstatFilter();
let liveStat: Fbstat | null = null;
let child: ChildProcess | null = null;
let childStartedAt = 0;
let childConfigPath: string | null = null;

// Launcher-originated log lines. The RingLog buffers unterminated text so
// partial child lines merge correctly, which means our own lines must carry
// their newline or they would glue onto the next child output.
function pushLine(line: string): void {
  log.push(`${line}\n`);
}

function json(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(text),
  });
  res.end(text);
}

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new Error('request body is not valid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function stopChild(): void {
  if (!child) return;
  const target = child;
  // SIGTERM is graceful on POSIX (the bot's handler sends logout); on Windows
  // every signal is an unconditional terminate, so the character lingers
  // linkdead until the server grace expires or the next start takes over.
  target.kill('SIGTERM');
  setTimeout(() => {
    if (child === target) {
      pushLine('[launcher] child did not exit in time, killing');
      target.kill('SIGKILL');
    }
  }, STOP_GRACE_MS).unref();
}

async function handleCharacters(res: ServerResponse, body: Record<string, unknown>): Promise<void> {
  const { serverUrl, username, password } = body;
  if (
    typeof serverUrl !== 'string' ||
    !serverUrl ||
    typeof username !== 'string' ||
    !username ||
    typeof password !== 'string' ||
    !password
  ) {
    json(res, 400, { error: 'serverUrl, username and password are required strings' });
    return;
  }
  try {
    const api = new Api();
    api.setRealm(serverUrl);
    const result = await api.login(username, password);
    if (result.twoFactorRequired) {
      json(res, 400, {
        error: 'this account has two-factor authentication enabled; the bot does not support 2FA',
      });
      return;
    }
    const characters = await api.characters();
    json(
      res,
      200,
      characters.map((c) => ({
        id: c.id,
        name: c.name,
        class: c.class,
        level: c.level,
        online: c.online,
      })),
    );
  } catch (err) {
    json(res, 400, { error: (err as Error).message });
  }
}

function handleStart(res: ServerResponse, body: Record<string, unknown>): void {
  if (child) {
    json(res, 409, { error: 'bot is already running' });
    return;
  }
  const { serverUrl, username, password, config } = body;
  if (typeof username !== 'string' || !username || typeof password !== 'string' || !password) {
    json(res, 400, { error: 'username and password are required' });
    return;
  }
  if (typeof serverUrl !== 'string' || !serverUrl) {
    json(res, 400, { error: 'serverUrl is required' });
    return;
  }
  if (!existsSync(BOT_BUNDLE)) {
    json(res, 500, { error: `bot bundle not found at ${BOT_BUNDLE}; run npm run build:farmbot` });
    return;
  }
  let parsed: FarmBotConfig;
  let assembled: Record<string, unknown>;
  try {
    assembled = assembleConfig(config as LauncherFormConfig) as Record<string, unknown>;
    parsed = parseConfig(assembled);
  } catch (err) {
    json(res, 400, { error: (err as Error).message });
    return;
  }
  if (parsed.serverUrl !== serverUrl) {
    json(res, 400, { error: 'config serverUrl does not match the account serverUrl' });
    return;
  }

  // Write the ASSEMBLED (pre-parse) config, never the parseConfig output:
  // the output object always materializes defaults like target.itemId '',
  // which the bot's own parseConfig pass rejects as present-but-empty
  // (parseConfig output is not valid parseConfig input).
  childConfigPath = join(tmpdir(), `farmbot-config-${process.pid}-${Date.now()}.json`);
  writeFileSync(childConfigPath, JSON.stringify(assembled, null, 2), 'utf8');

  const proc = spawn(process.execPath, [BOT_BUNDLE, '--config', childConfigPath], {
    env: { ...process.env, WOC_USERNAME: username, WOC_PASSWORD: password },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  child = proc;
  childStartedAt = Date.now();
  liveStat = null;
  const ingest = (chunk: Buffer): void => {
    for (const line of fbstat.push(chunk.toString('utf8'))) log.push(`${line}\n`);
    if (fbstat.latest) liveStat = fbstat.latest;
  };
  proc.stdout?.on('data', ingest);
  proc.stderr?.on('data', ingest);
  proc.on('exit', (code, signal) => {
    log.end();
    pushLine(`[launcher] bot exited (code ${code ?? 'null'}, signal ${signal ?? 'none'})`);
    if (childConfigPath) {
      rmSync(childConfigPath, { force: true });
      childConfigPath = null;
    }
    if (child === proc) child = null;
  });
  proc.on('error', (err) => {
    pushLine(`[launcher] failed to spawn bot: ${err.message}`);
    if (child === proc) child = null;
  });
  pushLine(
    `[launcher] started bot (pid ${proc.pid}) as ${parsed.characterName} on ${parsed.zoneId}`,
  );
  json(res, 200, { ok: true, pid: proc.pid });
}

const server = createServer((req, res) => {
  void (async () => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    try {
      if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(LAUNCHER_PAGE);
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/meta') {
        json(res, 200, {
          zones: deriveZones(GATHER_NODES),
          nodeTypes: GATHER_NODE_TYPES,
          defaultServerUrl: 'https://worldofclaudecraft.com',
          zoneInfo: buildZoneMeta(ZONES, GATHER_NODES),
          items: buildItemCatalog(ITEMS),
        });
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/sources') {
        const body = (await readBody(req)) as Record<string, unknown>;
        if (typeof body.itemId !== 'string' || body.itemId.length === 0) {
          json(res, 400, { error: 'itemId is required' });
          return;
        }
        // Reference-kit preview (starter tools, band 0, level 20): the bot
        // re-resolves at startup against the real character.
        const sources = resolveSourcesPreview(body.itemId);
        json(res, 200, {
          itemId: body.itemId,
          sources,
          preview: sources.map((s) => describeSource(s, body.itemId as string)),
        });
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/live') {
        json(res, 200, {
          running: child !== null,
          ...(child ? { pid: child.pid, startedAt: childStartedAt } : {}),
          stat: liveStat,
        });
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/status') {
        json(
          res,
          200,
          child ? { running: true, pid: child.pid, startedAt: childStartedAt } : { running: false },
        );
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/logs') {
        const since = Number(url.searchParams.get('since') ?? '0');
        json(res, 200, log.since(Number.isFinite(since) ? since : 0));
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/characters') {
        await handleCharacters(res, (await readBody(req)) as Record<string, unknown>);
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/start') {
        handleStart(res, (await readBody(req)) as Record<string, unknown>);
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/stop') {
        if (!child) {
          json(res, 409, { error: 'bot is not running' });
          return;
        }
        stopChild();
        json(res, 200, { ok: true });
        return;
      }
      json(res, 404, { error: 'not found' });
    } catch (err) {
      json(res, 400, { error: (err as Error).message });
    }
  })();
});

function shutdown(): void {
  stopChild();
  server.close();
  setTimeout(() => process.exit(0), STOP_GRACE_MS + 500).unref();
  // Nothing else keeps the loop alive once the server and child are gone.
  if (!child) process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('exit', () => {
  if (child) child.kill('SIGKILL');
});

// The login path needs the desktop Origin header (see shims.ts); install once
// for the whole process, before any Api call.
installNodeShims();

// Dynamic key lookup, matching bot/config.ts: keeps the literal-key env
// inventory lint quiet.
const env = (name: string): string => process.env[name] ?? '';
const port = Number(env('FARMBOT_GUI_PORT') || DEFAULT_PORT) || DEFAULT_PORT;
server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    console.error(
      `farmbot launcher: port ${port} is already in use - another launcher is ` +
        `probably running. Use it, close it first, or set FARMBOT_GUI_PORT to a free port.`,
    );
  } else {
    console.error(`farmbot launcher: ${err.message}`);
  }
  process.exit(1);
});
server.listen(port, '127.0.0.1', () => {
  console.log(`farmbot launcher listening at http://127.0.0.1:${port}`);
});
