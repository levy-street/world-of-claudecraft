import * as http from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { json, readBody } from './http_util';
import type { GameServer } from './game';

// Season ops are INJECTED (not imported) so this module stays free of the DB
// layer — server/db throws at import without DATABASE_URL, and this module is
// unit-tested without one. main.ts passes the real flow_ledger_db functions.
export interface SeasonOps {
  openSeason(p: { seasonId: number; label?: string; endsAt?: string | null }): Promise<void>;
  closeSeason(seasonId: number): Promise<void>;
}

function ok(res: http.ServerResponse, data: unknown): void {
  json(res, 200, { success: true, data, error: null });
}

function fail(res: http.ServerResponse, status: number, error: string, data: unknown = null): void {
  json(res, status, { success: false, data, error });
}

function secretsMatch(actual: string, expected: string): boolean {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

// Gate on a per-endpoint secret. Returns true only when the configured secret is
// present AND the request's header matches it (constant-time). An UNSET secret is
// a hard 404 — an op nobody enabled is indistinguishable from one that does not
// exist, so it can't be probed.
function authorize(req: http.IncomingMessage, res: http.ServerResponse, envVar: string, header: string): boolean {
  const expected = process.env[envVar] ?? '';
  if (!expected) { fail(res, 404, 'unknown endpoint'); return false; }
  const actual = String(req.headers[header] ?? '');
  if (!secretsMatch(actual, expected)) { fail(res, 401, 'not authenticated'); return false; }
  return true;
}

// Normalize a caller-supplied season end time: absent/null → open-ended; a string
// → validated ISO; anything else → invalid.
function normalizeEndsAt(v: unknown): { ok: true; value: string | null } | { ok: false } {
  if (v == null) return { ok: true, value: null };
  if (typeof v !== 'string') return { ok: false };
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return { ok: false };
  return { ok: true, value: d.toISOString() };
}

export async function handleInternalApi(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  game: GameServer,
  seasonOps?: SeasonOps,
): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (req.method !== 'POST') return fail(res, 404, 'unknown endpoint');

  // Deploy ops: begin the in-world restart countdown.
  if (url.pathname === '/internal/restart-countdown') {
    if (!authorize(req, res, 'RESTART_COUNTDOWN_SECRET', 'x-woc-deploy-secret')) return;
    const status = game.startRestartCountdown();
    if (!status.started) return fail(res, 409, 'restart countdown already active', status);
    return ok(res, status);
  }

  // $WOC season ops (the #479/#480 season-roll jobs call these): open/re-open a
  // reward season with an optional end time, or close one. Gated by WOC_OPS_SECRET;
  // a 404 when season ops are not wired in (e.g. unit tests / a build without them).
  if (url.pathname === '/internal/woc/season/open') {
    if (!seasonOps) return fail(res, 404, 'unknown endpoint');
    if (!authorize(req, res, 'WOC_OPS_SECRET', 'x-woc-ops-secret')) return;
    const body = await readBody(req);
    const seasonId = Number(body?.seasonId);
    if (!Number.isInteger(seasonId)) return fail(res, 400, 'seasonId must be an integer');
    const label = typeof body?.label === 'string' ? body.label.slice(0, 120) : '';
    const endsAt = normalizeEndsAt(body?.endsAt);
    if (!endsAt.ok) return fail(res, 400, 'endsAt must be an ISO timestamp or omitted');
    await seasonOps.openSeason({ seasonId, label, endsAt: endsAt.value });
    return ok(res, { seasonId, label, endsAt: endsAt.value });
  }

  if (url.pathname === '/internal/woc/season/close') {
    if (!seasonOps) return fail(res, 404, 'unknown endpoint');
    if (!authorize(req, res, 'WOC_OPS_SECRET', 'x-woc-ops-secret')) return;
    const body = await readBody(req);
    const seasonId = Number(body?.seasonId);
    if (!Number.isInteger(seasonId)) return fail(res, 400, 'seasonId must be an integer');
    await seasonOps.closeSeason(seasonId);
    return ok(res, { seasonId, closed: true });
  }

  return fail(res, 404, 'unknown endpoint');
}
