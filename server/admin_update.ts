// Admin code-update endpoints. Two routes:
//
//   POST /admin/api/update         → triggers scripts/admin/update.sh; returns
//                                    {started, log_path} after detaching. The
//                                    script broadcasts a maintenance warning,
//                                    flips the .maintenance flag, pulls,
//                                    rebuilds, restarts the server.
//   GET  /admin/api/update/status  → returns the last N lines of the update
//                                    log + whether the .maintenance flag is
//                                    currently held + last-run timestamp.
//
// Plumbed in from server/admin.ts via maybeHandleAdminUpdate(). Self-disables
// when WOC_DISABLE_ADMIN_UPDATE=1 is set — useful for shared deploys where you
// don't want the admin UI to run shell scripts.

import * as http from 'node:http';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import { json } from './http_util';

const REPO_ROOT = path.join(__dirname, '..');
const UPDATE_SCRIPT = path.join(REPO_ROOT, 'scripts', 'admin', 'update.sh');
const LOG_PATH = process.env.WOC_LOG_FILE ?? '/var/log/woc-update.log';
const MAINT_FLAG = path.join(REPO_ROOT, '.maintenance');
const DISABLED = (process.env.WOC_DISABLE_ADMIN_UPDATE ?? '').trim() === '1';

function ok(res: http.ServerResponse, data: unknown): void {
  json(res, 200, { success: true, data, error: null });
}
function fail(res: http.ServerResponse, status: number, error: string): void {
  json(res, status, { success: false, data: null, error });
}

interface RunResult {
  started: boolean;
  pid: number;
  log_path: string;
}

function spawnUpdate(opts: { warnSeconds?: number; branch?: string }): RunResult {
  const env = {
    ...process.env,
    WOC_WARN_SECONDS: String(opts.warnSeconds ?? 300),
    WOC_BRANCH: opts.branch ?? 'master',
    WOC_LOG_FILE: LOG_PATH,
  };
  // Detach so the HTTP request returns immediately. The script touches
  // .maintenance up-front; clients should poll /admin/api/update/status.
  const child = spawn('/usr/bin/env', ['bash', UPDATE_SCRIPT], {
    cwd: REPO_ROOT,
    env,
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
  return { started: true, pid: child.pid ?? -1, log_path: LOG_PATH };
}

function readTail(file: string, maxLines: number): string {
  try {
    const buf = fs.readFileSync(file, 'utf8');
    const lines = buf.split(/\r?\n/);
    return lines.slice(Math.max(0, lines.length - maxLines)).join('\n');
  } catch {
    return '';
  }
}

function statusPayload(): {
  inMaintenance: boolean;
  logPath: string;
  log: string;
  scriptExists: boolean;
  disabled: boolean;
} {
  return {
    inMaintenance: fs.existsSync(MAINT_FLAG),
    logPath: LOG_PATH,
    log: readTail(LOG_PATH, 200),
    scriptExists: fs.existsSync(UPDATE_SCRIPT),
    disabled: DISABLED,
  };
}

/** Returns true when the path matched and we wrote a response. */
export async function maybeHandleAdminUpdate(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  pathname: string,
  readBody: (req: http.IncomingMessage) => Promise<Record<string, unknown>>,
): Promise<boolean> {
  if (pathname === '/admin/api/update/status' && req.method === 'GET') {
    ok(res, statusPayload());
    return true;
  }
  if (pathname === '/admin/api/update' && req.method === 'POST') {
    if (DISABLED) {
      fail(res, 403, 'admin update disabled (WOC_DISABLE_ADMIN_UPDATE=1)');
      return true;
    }
    if (!fs.existsSync(UPDATE_SCRIPT)) {
      fail(res, 500, `update script missing: ${UPDATE_SCRIPT}`);
      return true;
    }
    let body: Record<string, unknown> = {};
    try { body = await readBody(req); } catch { /* empty body is fine */ }
    const warnSeconds = typeof body.warnSeconds === 'number' ? body.warnSeconds : 300;
    const branch = typeof body.branch === 'string' ? body.branch : 'master';
    if (warnSeconds < 0 || warnSeconds > 3600) {
      fail(res, 400, 'warnSeconds must be 0–3600');
      return true;
    }
    try {
      const r = spawnUpdate({ warnSeconds, branch });
      ok(res, r);
    } catch (err) {
      fail(res, 500, err instanceof Error ? err.message : 'spawn failed');
    }
    return true;
  }
  return false;
}
