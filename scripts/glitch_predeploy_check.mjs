#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const TITLE_ID = '8254e0f9-6c3a-4c94-8a16-570157b9df3b';
const SERVER_BUNDLE = path.join(ROOT, 'dist-server/server.cjs');
const START_TIMEOUT_MS = 90_000;
const FETCH_TIMEOUT_MS = 10_000;

loadEnvFile(path.join(ROOT, '.env'));
loadEnvFile(path.join(ROOT, '.env.local'));

const env = { ...process.env };

if (!env.DATABASE_URL) fail('DATABASE_URL is required for the Glitch node predeploy check.');
if (!env.GLITCH_SERVER_TITLE_TOKEN) {
  fail('GLITCH_SERVER_TITLE_TOKEN is required for the Glitch node predeploy check.');
}
const port = Number(env.GLITCH_PREFLIGHT_PORT || (await freePort()));
const baseUrl = `http://127.0.0.1:${port}`;
const realmName =
  env.GLITCH_PREFLIGHT_REALM_NAME ||
  `Pf${Date.now().toString(36).slice(-8)}${process.pid.toString(36).slice(-6)}`;
const preflightEnv = {
  ...env,
  ALLOW_DEV_COMMANDS: '0',
  GLITCH_ENABLED: env.GLITCH_ENABLED || '1',
  GLITCH_TITLE_ID: env.GLITCH_TITLE_ID || TITLE_ID,
  NODE_ENV: 'production',
  PUBLIC_ORIGIN: baseUrl,
  REALM_NAME: realmName,
  REALM_SINGLETON_LOCK: '1',
  VITE_DESKTOP_RELATIVE_API: '1',
  VITE_GLITCH_ENABLED: '1',
  VITE_GLITCH_TITLE_ID: env.VITE_GLITCH_TITLE_ID || TITLE_ID,
};

if (!env.VITE_GLITCH_TITLE_TOKEN) {
  fail('VITE_GLITCH_TITLE_TOKEN is required for the Glitch node predeploy check.');
}

console.log('Glitch predeploy: running local production build.');
await run('npm', ['run', 'build'], preflightEnv);
await run('npm', ['run', 'build:server'], preflightEnv);

if (!existsSync(SERVER_BUNDLE)) {
  fail('Glitch predeploy: dist-server/server.cjs was not built.');
}

const serverEnv = {
  ...preflightEnv,
  PORT: String(port),
};

console.log(`Glitch predeploy: starting built server on ${baseUrl} with a temporary realm.`);
const server = spawn(process.execPath, [SERVER_BUNDLE], {
  cwd: ROOT,
  env: serverEnv,
  stdio: ['ignore', 'pipe', 'pipe'],
});

let exited = false;
let exitCode = null;
let serverLog = '';
server.on('exit', (code) => {
  exited = true;
  exitCode = code;
});
server.stdout.on('data', (chunk) => appendServerLog(chunk));
server.stderr.on('data', (chunk) => appendServerLog(chunk));

try {
  await waitForProjectStats(baseUrl);
  await expectJson(`${baseUrl}/api/site-presence`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'woc-glitch-predeploy/1',
    },
    body: JSON.stringify({
      visitorId: `glitch-preflight-${Date.now().toString(36)}`,
      page: 'home',
    }),
  });
  console.log('Glitch predeploy: local server smoke passed.');
} catch (err) {
  console.error(`Glitch predeploy failed: ${err instanceof Error ? err.message : String(err)}`);
  printServerLog();
  process.exitCode = 1;
} finally {
  await stopServer();
}

async function waitForProjectStats(base) {
  const deadline = Date.now() + START_TIMEOUT_MS;
  let lastError = '';
  while (Date.now() < deadline) {
    if (exited) {
      throw new Error(`server exited before readiness check completed with code ${exitCode}`);
    }
    try {
      await expectJson(`${base}/api/project-stats`, { method: 'GET' });
      return;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
    await sleep(500);
  }
  throw new Error(`server did not pass /api/project-stats within 90s: ${lastError}`);
}

async function expectJson(url, init) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    const contentType = res.headers.get('content-type') || '';
    const text = await res.text();
    let body = null;
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
    }
    if (res.status !== 200) {
      throw new Error(`${url} returned HTTP ${res.status}: ${JSON.stringify(body).slice(0, 240)}`);
    }
    if (!contentType.includes('application/json')) {
      throw new Error(`${url} did not return JSON content-type: ${contentType || 'missing'}`);
    }
    if (url.endsWith('/api/site-presence') && body?.ok !== true) {
      throw new Error(`${url} returned unexpected body: ${JSON.stringify(body).slice(0, 240)}`);
    }
    return body;
  } finally {
    clearTimeout(timeout);
  }
}

function appendServerLog(chunk) {
  serverLog += String(chunk);
  if (serverLog.length > 20_000) serverLog = serverLog.slice(-20_000);
}

function printServerLog() {
  const redacted = redact(serverLog).trim();
  if (!redacted) return;
  console.error('Glitch predeploy server log tail:');
  console.error(redacted.split(/\r?\n/).slice(-120).join('\n'));
}

function redact(value) {
  let out = value;
  for (const key of [
    'DATABASE_URL',
    'GLITCH_TITLE_TOKEN',
    'GLITCH_API_TOKEN',
    'GLITCH_SERVER_TITLE_TOKEN',
    'VITE_GLITCH_TITLE_TOKEN',
  ]) {
    const secret = env[key];
    if (secret) out = out.split(secret).join('[REDACTED]');
  }
  return out
    .replace(/postgres:\/\/[^\s"'`]+/g, '[DATABASE_URL_REDACTED]')
    .replace(/gl_deploy_[A-Za-z0-9]+/g, '[DEPLOY_TOKEN_REDACTED]')
    .replace(/[0-9a-f]{8}-[0-9a-f-]{27,}\.[A-Za-z0-9]+/gi, '[TITLE_TOKEN_REDACTED]');
}

async function stopServer() {
  if (exited) return;
  server.kill('SIGTERM');
  const deadline = Date.now() + 5_000;
  while (!exited && Date.now() < deadline) await sleep(100);
  if (!exited) server.kill('SIGKILL');
}

function run(command, args, commandEnv, cwd = ROOT) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: commandEnv,
      stdio: 'inherit',
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} exited with status ${code}`));
    });
  });
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('unable to allocate preflight port'));
        return;
      }
      server.close(() => resolve(address.port));
    });
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function loadEnvFile(file) {
  if (!existsSync(file)) return;
  process.loadEnvFile?.(file);
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
