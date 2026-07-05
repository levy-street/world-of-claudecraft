import { pool } from './db';

// Bug reports are a separate lane from the player-vs-player moderation reports
// in moderation_db.ts: this captures technical feedback (realm, position,
// screenshot, free-text) rather than reporting another player.

export const BUG_DESCRIPTION_MAX = 2000;
// A downscaled JPEG (1280px longest edge, q0.7) is ~150-300 KB as a base64 data
// URL; cap well under the endpoint's ~1 MB body limit so a single oversized
// frame is rejected as a screenshot rather than killing the whole request.
export const BUG_SCREENSHOT_MAX = 900 * 1024;
// Per-account submissions allowed in the trailing hour before a 429.
export const BUG_REPORT_RATE_LIMIT = 5;
// Per-string cap for the auto-collected meta (mirrors the client clamp in
// src/ui/bug_report.ts). The server re-clamps because a direct API caller never
// runs the client assembly.
const META_STR_MAX = 512;

// The real client only ever produces a downscaled JPEG data URL. Allow the common
// raster image data-URL types and nothing else, so a hand-crafted payload (e.g.
// data:text/html,... that the admin would otherwise render as a clickable link)
// can never be stored as a "screenshot".
const SCREENSHOT_DATA_URL = /^data:image\/(?:jpeg|png|webp);base64,/;

// Server-side screenshot gate: a base64 raster image data URL within the size cap.
// Enforced here (not just at the route) so every insert path is protected.
export function isStorableScreenshot(value: unknown): value is string {
  return typeof value === 'string'
    && value.length <= BUG_SCREENSHOT_MAX
    && SCREENSHOT_DATA_URL.test(value);
}

// Bounded, fixed-shape view of the client metadata. Mirrors BugReportMeta in
// src/ui/bug_report.ts so the JSONB stays small and well-formed even when posted
// directly to the endpoint (where the client assembly clamp never ran). Unknown
// fields are dropped; strings are truncated; non-finite numbers collapse to 0.
export interface BugReportMeta {
  build: string;
  userAgent: string;
  viewport: { w: number; h: number; dpr: number };
  zone: string;
  level: number;
  className: string;
  cameraYaw: number;
}

function metaStr(value: unknown): string {
  return typeof value === 'string' ? value.slice(0, META_STR_MAX) : '';
}

function metaNum(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

export function clampBugReportMeta(value: unknown): BugReportMeta {
  const m = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const vp = m.viewport && typeof m.viewport === 'object' ? (m.viewport as Record<string, unknown>) : {};
  return {
    build: metaStr(m.build),
    userAgent: metaStr(m.userAgent),
    viewport: { w: metaNum(vp.w), h: metaNum(vp.h), dpr: metaNum(vp.dpr) || 1 },
    zone: metaStr(m.zone),
    level: metaNum(m.level),
    className: metaStr(m.className),
    cameraYaw: metaNum(m.cameraYaw),
  };
}

export class BugReportRateLimitError extends Error {
  constructor() {
    super('too many bug reports, try again later');
    this.name = 'BugReportRateLimitError';
  }
}

export interface BugReportInput {
  accountId: number;
  characterId: number | null;
  characterName: string;
  realm: string;
  pos: { x: number; y: number; z: number };
  description: string;
  screenshot: string | null;
  meta: unknown;
}

// The admin list row never carries the full base64 screenshot (each can be
// hundreds of KB; a page of them is many MB). It exposes only whether one exists;
// the bytes are fetched per report via getBugReportScreenshot.
export interface BugReportRow {
  id: number;
  account_id: number | null;
  character_id: number | null;
  character_name: string;
  realm: string;
  pos_x: number;
  pos_y: number;
  pos_z: number;
  description: string;
  has_screenshot: boolean;
  meta: unknown;
  status: string;
  created_at: string;
}

function finiteOr0(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

export async function createBugReport(
  input: BugReportInput,
): Promise<{ id: number; screenshotStored: boolean }> {
  // Count this account's reports in the trailing hour. The TOCTOU gap between
  // this check and the insert lets a burst slip one or two extra through, which
  // is harmless for an abuse cap (unlike a uniqueness constraint).
  const recent = await pool.query(
    `SELECT count(*)::int AS n FROM bug_reports
     WHERE account_id = $1 AND created_at > now() - interval '1 hour'`,
    [input.accountId],
  );
  if ((recent.rows[0]?.n ?? 0) >= BUG_REPORT_RATE_LIMIT) throw new BugReportRateLimitError();

  // Sanitize at the data layer so no caller (route or otherwise) can store an
  // arbitrary screenshot string or an unbounded meta blob.
  const screenshot = isStorableScreenshot(input.screenshot) ? input.screenshot : null;
  const meta = clampBugReportMeta(input.meta);

  const res = await pool.query(
    `INSERT INTO bug_reports (
       account_id, character_id, character_name, realm,
       pos_x, pos_y, pos_z, description, screenshot, meta
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     RETURNING id`,
    [
      input.accountId,
      input.characterId,
      input.characterName.slice(0, 64),
      input.realm.slice(0, 64),
      finiteOr0(input.pos.x),
      finiteOr0(input.pos.y),
      finiteOr0(input.pos.z),
      input.description.slice(0, BUG_DESCRIPTION_MAX),
      screenshot,
      JSON.stringify(meta),
    ],
  );
  return { id: Number(res.rows[0].id), screenshotStored: screenshot !== null };
}

export async function listBugReports(limit = 100, offset = 0): Promise<{ rows: BugReportRow[]; total: number }> {
  const capped = Math.max(1, Math.min(200, Math.floor(limit)));
  const off = Math.max(0, Math.floor(offset));
  const res = await pool.query(
    `SELECT id, account_id, character_id, character_name, realm,
            pos_x, pos_y, pos_z, description,
            (screenshot IS NOT NULL) AS has_screenshot, meta, status, created_at
     FROM bug_reports
     ORDER BY created_at DESC
     LIMIT $1 OFFSET $2`,
    [capped, off],
  );
  const totalRes = await pool.query(`SELECT count(*)::int AS total FROM bug_reports`);
  return {
    rows: res.rows.map((r) => ({ ...r, id: Number(r.id), has_screenshot: !!r.has_screenshot })),
    total: totalRes.rows[0]?.total ?? 0,
  };
}

// Fetch a single report's screenshot on demand (the list query omits it). Returns
// null when the report has none or does not exist.
export async function getBugReportScreenshot(id: number): Promise<string | null> {
  if (!Number.isFinite(id)) return null;
  const res = await pool.query(`SELECT screenshot FROM bug_reports WHERE id = $1`, [Math.floor(id)]);
  return res.rows[0]?.screenshot ?? null;
}
