import type { Pool, QueryConfig } from 'pg';

/** Append-only telemetry for terminal, accepted /unstuck attempts. */
export const UNSTUCK_SCHEMA = `
CREATE TABLE IF NOT EXISTS unstuck_reports (
  id BIGSERIAL PRIMARY KEY,
  attempt_id UUID NOT NULL UNIQUE,
  realm TEXT NOT NULL,
  account_id INT REFERENCES accounts(id) ON DELETE SET NULL,
  character_id INT REFERENCES characters(id) ON DELETE SET NULL,
  area_kind TEXT NOT NULL,
  area_id TEXT NOT NULL,
  instance_id TEXT,
  instance_slot INT,
  origin_raw_x DOUBLE PRECISION NOT NULL,
  origin_raw_y DOUBLE PRECISION NOT NULL,
  origin_raw_z DOUBLE PRECISION NOT NULL,
  origin_local_x DOUBLE PRECISION NOT NULL,
  origin_local_y DOUBLE PRECISION NOT NULL,
  origin_local_z DOUBLE PRECISION NOT NULL,
  destination_raw_x DOUBLE PRECISION,
  destination_raw_y DOUBLE PRECISION,
  destination_raw_z DOUBLE PRECISION,
  destination_local_x DOUBLE PRECISION,
  destination_local_y DOUBLE PRECISION,
  destination_local_z DOUBLE PRECISION,
  outcome TEXT NOT NULL,
  reason TEXT NOT NULL,
  invoked_at TIMESTAMPTZ NOT NULL,
  resolved_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT unstuck_reports_destination_complete CHECK (
    (
      destination_raw_x IS NULL
      AND destination_raw_y IS NULL
      AND destination_raw_z IS NULL
      AND destination_local_x IS NULL
      AND destination_local_y IS NULL
      AND destination_local_z IS NULL
    )
    OR
    (
      destination_raw_x IS NOT NULL
      AND destination_raw_y IS NOT NULL
      AND destination_raw_z IS NOT NULL
      AND destination_local_x IS NOT NULL
      AND destination_local_y IS NOT NULL
      AND destination_local_z IS NOT NULL
    )
  ),
  CONSTRAINT unstuck_reports_resolution_order CHECK (resolved_at >= invoked_at),
  CONSTRAINT unstuck_reports_outcome CHECK (
    outcome IN ('completed', 'cancelled', 'failed')
  ),
  CONSTRAINT unstuck_reports_outcome_destination CHECK (
    (
      outcome = 'completed'
      AND destination_raw_x IS NOT NULL
      AND destination_raw_y IS NOT NULL
      AND destination_raw_z IS NOT NULL
      AND destination_local_x IS NOT NULL
      AND destination_local_y IS NOT NULL
      AND destination_local_z IS NOT NULL
    )
    OR
    (
      outcome IN ('cancelled', 'failed')
      AND destination_raw_x IS NULL
      AND destination_raw_y IS NULL
      AND destination_raw_z IS NULL
      AND destination_local_x IS NULL
      AND destination_local_y IS NULL
      AND destination_local_z IS NULL
    )
  )
);
CREATE INDEX IF NOT EXISTS unstuck_reports_realm_id
  ON unstuck_reports(realm, id DESC);
CREATE INDEX IF NOT EXISTS unstuck_reports_realm_created
  ON unstuck_reports(realm, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS unstuck_reports_realm_area_local
  ON unstuck_reports(
    realm, area_kind, area_id, instance_id,
    origin_local_x, origin_local_y, origin_local_z
  );
CREATE INDEX IF NOT EXISTS unstuck_reports_created
  ON unstuck_reports(created_at ASC, id ASC);
-- The two nullable FK columns: every player-triggerable character delete
-- (and account delete) applies ON DELETE SET NULL, which without these
-- seq-scans the whole telemetry table per deletion. Partial (IS NOT NULL)
-- because the RI lookup always binds the column, and NULLed rows need no
-- entry. Built by the boot DDL transaction (timeout 0, advisory-locked):
-- acceptable ONLY because unstuck_reports is cooldown-gated, low-volume
-- telemetry (one row per terminal /unstuck, 90-day retention, shipped in
-- v0.32.0), so the first post-deploy build covers at most one release of
-- sparse rows and finishes in seconds. Do NOT copy this pattern onto a
-- busy table: there the build belongs in the post-commit CONCURRENTLY arm.
CREATE INDEX IF NOT EXISTS unstuck_reports_character
  ON unstuck_reports(character_id) WHERE character_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS unstuck_reports_account
  ON unstuck_reports(account_id) WHERE account_id IS NOT NULL;
`;

// The ADMIN VIEW's read-window ceiling, distinct from the retention knob
// (UNSTUCK_REPORT_RETENTION_DAYS in server/http/config.ts): rows older than
// the configured retention are pruned; rows within retention but past this
// cap exist without being viewable through the admin endpoints.
export const UNSTUCK_REPORT_MAX_DAYS = 90;
export const UNSTUCK_INSERT_QUERY_TIMEOUT_MS = 1_000;
export const UNSTUCK_REPORT_MAX_LIMIT = 200;
export const UNSTUCK_HOTSPOT_MAX_LIMIT = 50;
export const UNSTUCK_HOTSPOT_BUCKET_YARDS = 5;

const DEFAULT_DAYS = 30;
const DEFAULT_REPORT_LIMIT = 100;
const DEFAULT_HOTSPOT_LIMIT = 25;
const CODE_RE = /^[a-z0-9][a-z0-9._:-]*$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const OUTCOMES = new Set(['completed', 'cancelled', 'failed']);

export interface InsertUnstuckReportInput {
  attemptId: string;
  realm: string;
  accountId: number | null;
  characterId: number | null;
  areaKind: string;
  areaId: string;
  instanceId?: string | null;
  instanceSlot?: number | null;
  originRawX: number;
  originRawY: number;
  originRawZ: number;
  originLocalX: number;
  originLocalY: number;
  originLocalZ: number;
  destinationRawX?: number | null;
  destinationRawY?: number | null;
  destinationRawZ?: number | null;
  destinationLocalX?: number | null;
  destinationLocalY?: number | null;
  destinationLocalZ?: number | null;
  outcome: string;
  reason: string;
  invokedAt: Date;
  resolvedAt: Date;
}

export interface UnstuckReportRow {
  id: number;
  realm: string;
  accountId: number | null;
  characterId: number | null;
  characterName: string | null;
  areaKind: string;
  areaId: string;
  instanceId: string | null;
  instanceSlot: number | null;
  originRawX: number;
  originRawY: number;
  originRawZ: number;
  originLocalX: number;
  originLocalY: number;
  originLocalZ: number;
  destinationRawX: number | null;
  destinationRawY: number | null;
  destinationRawZ: number | null;
  destinationLocalX: number | null;
  destinationLocalY: number | null;
  destinationLocalZ: number | null;
  outcome: string;
  reason: string;
  invokedAt: string;
  resolvedAt: string;
  createdAt: string;
}

export interface ListUnstuckReportsOptions {
  realm: string;
  days: number;
  limit: number;
  beforeId?: number;
}

export interface UnstuckReportPage {
  rows: UnstuckReportRow[];
  hasMore: boolean;
  nextBeforeId: number | null;
}

export interface ListUnstuckHotspotsOptions {
  realm: string;
  days: number;
  limit: number;
}

export interface UnstuckHotspotRow {
  areaKind: string;
  areaId: string;
  instanceId: string | null;
  bucketLocalX: number;
  bucketLocalY: number;
  bucketLocalZ: number;
  reportCount: number;
  completedCount: number;
  cancelledCount: number;
  failedCount: number;
  firstInvokedAt: string;
  lastResolvedAt: string;
}

type DestinationTuple = [
  number | null,
  number | null,
  number | null,
  number | null,
  number | null,
  number | null,
];

type RawUnstuckReportRow = {
  id: number | string;
  realm: string;
  account_id: number | null;
  character_id: number | null;
  character_name: string | null;
  area_kind: string;
  area_id: string;
  instance_id: string | null;
  instance_slot: number | null;
  origin_raw_x: number | string;
  origin_raw_y: number | string;
  origin_raw_z: number | string;
  origin_local_x: number | string;
  origin_local_y: number | string;
  origin_local_z: number | string;
  destination_raw_x: number | string | null;
  destination_raw_y: number | string | null;
  destination_raw_z: number | string | null;
  destination_local_x: number | string | null;
  destination_local_y: number | string | null;
  destination_local_z: number | string | null;
  outcome: string;
  reason: string;
  invoked_at: Date | string;
  resolved_at: Date | string;
  created_at: Date | string;
};

type RawUnstuckHotspotRow = {
  area_kind: string;
  area_id: string;
  bucket_local_x: number | string;
  bucket_local_y: number | string;
  bucket_local_z: number | string;
  report_count: number | string;
  completed_count: number | string;
  cancelled_count: number | string;
  failed_count: number | string;
  first_invoked_at: Date | string;
  last_resolved_at: Date | string;
};

function finiteNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`${field} must be a finite number`);
  }
  return value;
}

function nullablePositiveId(value: unknown, field: string): number | null {
  if (value === null) return null;
  if (!Number.isSafeInteger(value) || Number(value) <= 0) {
    throw new TypeError(`${field} must be a positive safe integer or null`);
  }
  return Number(value);
}

function nullableSlot(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new TypeError('instanceSlot must be a non-negative safe integer or null');
  }
  return Number(value);
}

function requiredText(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > maxLength) {
    throw new TypeError(`${field} must be a non-empty string of at most ${maxLength} characters`);
  }
  return value;
}

function stableCode(value: unknown, field: string, maxLength = 64): string {
  const code = requiredText(value, field, maxLength);
  if (!CODE_RE.test(code)) throw new TypeError(`${field} must be a stable text code`);
  return code;
}

function nullableCode(value: unknown, field: string, maxLength = 128): string | null {
  if (value === undefined || value === null) return null;
  return stableCode(value, field, maxLength);
}

function validDate(value: unknown, field: string): Date {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new TypeError(`${field} must be a valid Date`);
  }
  return value;
}

function uuid(value: unknown, field: string): string {
  const text = requiredText(value, field, 36);
  if (!UUID_RE.test(text)) throw new TypeError(`${field} must be a UUID`);
  return text.toLowerCase();
}

function destinationCoordinates(input: InsertUnstuckReportInput): DestinationTuple {
  const values = [
    input.destinationRawX,
    input.destinationRawY,
    input.destinationRawZ,
    input.destinationLocalX,
    input.destinationLocalY,
    input.destinationLocalZ,
  ];
  const presentCount = values.filter((value) => value !== undefined && value !== null).length;
  if (presentCount === 0) return [null, null, null, null, null, null];
  if (presentCount !== values.length) {
    throw new TypeError('destination coordinates must be all present or all absent');
  }
  return values.map((value, index) =>
    finiteNumber(value, `destination coordinate ${index + 1}`),
  ) as DestinationTuple;
}

function boundedInteger(value: number, fallback: number, max: number): number {
  const integer = Number.isFinite(value) ? Math.floor(value) : fallback;
  return Math.min(max, Math.max(1, integer));
}

function beforeIdOrNull(value: number | undefined): number | null {
  if (value === undefined || !Number.isSafeInteger(value) || value <= 0) return null;
  return value;
}

function timestampString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

function nullableNumber(value: number | string | null): number | null {
  return value === null ? null : Number(value);
}

/** Persist one terminal accepted attempt. This module intentionally exposes no update/delete API. */
export async function insertUnstuckReport(
  pool: Pool,
  input: InsertUnstuckReportInput,
): Promise<void> {
  const attemptId = uuid(input.attemptId, 'attemptId');
  const realm = requiredText(input.realm, 'realm', 64);
  const accountId = nullablePositiveId(input.accountId, 'accountId');
  const characterId = nullablePositiveId(input.characterId, 'characterId');
  const areaKind = stableCode(input.areaKind, 'areaKind');
  const areaId = stableCode(input.areaId, 'areaId', 128);
  const instanceId = nullableCode(input.instanceId, 'instanceId');
  const instanceSlot = nullableSlot(input.instanceSlot);
  const origin = [
    finiteNumber(input.originRawX, 'originRawX'),
    finiteNumber(input.originRawY, 'originRawY'),
    finiteNumber(input.originRawZ, 'originRawZ'),
    finiteNumber(input.originLocalX, 'originLocalX'),
    finiteNumber(input.originLocalY, 'originLocalY'),
    finiteNumber(input.originLocalZ, 'originLocalZ'),
  ];
  const destination = destinationCoordinates(input);
  const outcome = stableCode(input.outcome, 'outcome');
  if (!OUTCOMES.has(outcome)) {
    throw new TypeError('outcome must be completed, cancelled, or failed');
  }
  const hasDestination = destination[0] !== null;
  if (outcome === 'completed' && !hasDestination) {
    throw new TypeError('completed reports require destination coordinates');
  }
  if (outcome !== 'completed' && hasDestination) {
    throw new TypeError('cancelled and failed reports must not include destination coordinates');
  }
  const reason = stableCode(input.reason, 'reason');
  const invokedAt = validDate(input.invokedAt, 'invokedAt');
  const resolvedAt = validDate(input.resolvedAt, 'resolvedAt');
  if (resolvedAt.getTime() < invokedAt.getTime()) {
    throw new TypeError('resolvedAt must not precede invokedAt');
  }

  const query: QueryConfig & { query_timeout: number } = {
    text: `INSERT INTO unstuck_reports (
       attempt_id, realm, account_id, character_id, area_kind, area_id, instance_id, instance_slot,
       origin_raw_x, origin_raw_y, origin_raw_z,
       origin_local_x, origin_local_y, origin_local_z,
       destination_raw_x, destination_raw_y, destination_raw_z,
       destination_local_x, destination_local_y, destination_local_z,
       outcome, reason, invoked_at, resolved_at
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8,
       $9, $10, $11, $12, $13, $14,
       $15, $16, $17, $18, $19, $20,
       $21, $22, $23, $24
     )
     ON CONFLICT (attempt_id) DO NOTHING`,
    values: [
      attemptId,
      realm,
      accountId,
      characterId,
      areaKind,
      areaId,
      instanceId,
      instanceSlot,
      ...origin,
      ...destination,
      outcome,
      reason,
      invokedAt,
      resolvedAt,
    ],
    query_timeout: UNSTUCK_INSERT_QUERY_TIMEOUT_MS,
  };
  await pool.query(query);
}

/**
 * One bounded retention delete, the shared-sweep primitive shape
 * (pruneChatLogsBatch contract): 0 or negative days keeps forever, a
 * fractional value clamps to at least one day, and the caller (the daily
 * retention sweep in server/main.ts) owns cadence, budget, and batching, so
 * this deliberately carries no advisory lock, no internal loop, and no
 * SKIP LOCKED: the sweep's verdict rule reads a SHORT batch as
 * caught-up, and lock-skipping would fake a short batch whenever a
 * concurrent character delete holds candidate rows.
 */
export async function pruneUnstuckReportsBatch(
  pool: Pool,
  retentionDays: number,
  batchSize: number,
): Promise<number> {
  if (!Number.isFinite(retentionDays) || retentionDays <= 0) return 0;
  const days = Math.max(1, Math.floor(retentionDays));
  const res = await pool.query(
    `DELETE FROM unstuck_reports
      WHERE id IN (
        SELECT id FROM unstuck_reports
         WHERE created_at < now() - ($1::int * INTERVAL '1 day')
         ORDER BY created_at ASC, id ASC
         LIMIT $2)`,
    [days, Math.max(1, Math.floor(batchSize))],
  );
  return res.rowCount ?? 0;
}

function reportFromRow(row: RawUnstuckReportRow): UnstuckReportRow {
  return {
    id: Number(row.id),
    realm: row.realm,
    accountId: row.account_id,
    characterId: row.character_id,
    characterName: row.character_name,
    areaKind: row.area_kind,
    areaId: row.area_id,
    instanceId: row.instance_id,
    instanceSlot: row.instance_slot,
    originRawX: Number(row.origin_raw_x),
    originRawY: Number(row.origin_raw_y),
    originRawZ: Number(row.origin_raw_z),
    originLocalX: Number(row.origin_local_x),
    originLocalY: Number(row.origin_local_y),
    originLocalZ: Number(row.origin_local_z),
    destinationRawX: nullableNumber(row.destination_raw_x),
    destinationRawY: nullableNumber(row.destination_raw_y),
    destinationRawZ: nullableNumber(row.destination_raw_z),
    destinationLocalX: nullableNumber(row.destination_local_x),
    destinationLocalY: nullableNumber(row.destination_local_y),
    destinationLocalZ: nullableNumber(row.destination_local_z),
    outcome: row.outcome,
    reason: row.reason,
    invokedAt: timestampString(row.invoked_at),
    resolvedAt: timestampString(row.resolved_at),
    createdAt: timestampString(row.created_at),
  };
}

/** Read one newest-first, realm-scoped keyset page. */
export async function listUnstuckReports(
  pool: Pool,
  options: ListUnstuckReportsOptions,
): Promise<UnstuckReportPage> {
  const realm = requiredText(options.realm, 'realm', 64);
  const days = boundedInteger(options.days, DEFAULT_DAYS, UNSTUCK_REPORT_MAX_DAYS);
  const limit = boundedInteger(options.limit, DEFAULT_REPORT_LIMIT, UNSTUCK_REPORT_MAX_LIMIT);
  const beforeId = beforeIdOrNull(options.beforeId);
  const res = await pool.query<RawUnstuckReportRow>(
    `SELECT
       r.id, r.realm, r.account_id, r.character_id, c.name AS character_name,
       r.area_kind, r.area_id, r.instance_id, r.instance_slot,
       origin_raw_x, origin_raw_y, origin_raw_z,
       origin_local_x, origin_local_y, origin_local_z,
       destination_raw_x, destination_raw_y, destination_raw_z,
       destination_local_x, destination_local_y, destination_local_z,
       outcome, reason, invoked_at, resolved_at, created_at
     FROM unstuck_reports r
     LEFT JOIN characters c ON c.id = r.character_id
     WHERE r.realm = $1
       AND r.created_at >= now() - ($2::int * INTERVAL '1 day')
       AND ($3::bigint IS NULL OR r.id < $3)
     ORDER BY r.id DESC
     LIMIT $4`,
    [realm, days, beforeId, limit + 1],
  );
  const hasMore = res.rows.length > limit;
  const rows = res.rows.slice(0, limit).map(reportFromRow);
  return {
    rows,
    hasMore,
    nextBeforeId: hasMore && rows.length > 0 ? rows[rows.length - 1].id : null,
  };
}

/** Aggregate reports into five-yard, content-local 3D buckets across cloned slots. */
export async function listUnstuckHotspots(
  pool: Pool,
  options: ListUnstuckHotspotsOptions,
): Promise<UnstuckHotspotRow[]> {
  const realm = requiredText(options.realm, 'realm', 64);
  const days = boundedInteger(options.days, DEFAULT_DAYS, UNSTUCK_REPORT_MAX_DAYS);
  const limit = boundedInteger(options.limit, DEFAULT_HOTSPOT_LIMIT, UNSTUCK_HOTSPOT_MAX_LIMIT);
  const res = await pool.query<RawUnstuckHotspotRow>(
    `WITH bucketed AS (
       SELECT
         area_kind, area_id, outcome, invoked_at, resolved_at,
         floor(origin_local_x / $3::double precision) * $3 AS bucket_local_x,
         floor(origin_local_y / $3::double precision) * $3 AS bucket_local_y,
         floor(origin_local_z / $3::double precision) * $3 AS bucket_local_z
       FROM unstuck_reports
       WHERE realm = $1
         AND created_at >= now() - ($2::int * INTERVAL '1 day')
     )
     SELECT
       area_kind, area_id,
       bucket_local_x, bucket_local_y, bucket_local_z,
       count(*)::int AS report_count,
       count(*) FILTER (WHERE outcome = 'completed')::int AS completed_count,
       count(*) FILTER (WHERE outcome = 'cancelled')::int AS cancelled_count,
       count(*) FILTER (WHERE outcome = 'failed')::int AS failed_count,
       min(invoked_at) AS first_invoked_at,
       max(resolved_at) AS last_resolved_at
     FROM bucketed
     GROUP BY
       area_kind, area_id,
       bucket_local_x, bucket_local_y, bucket_local_z
     ORDER BY report_count DESC, last_resolved_at DESC,
       area_kind ASC, area_id ASC,
       bucket_local_x ASC, bucket_local_y ASC, bucket_local_z ASC
     LIMIT $4`,
    [realm, days, UNSTUCK_HOTSPOT_BUCKET_YARDS, limit],
  );
  return res.rows.map((row) => ({
    areaKind: row.area_kind,
    areaId: row.area_id,
    instanceId: null,
    bucketLocalX: Number(row.bucket_local_x),
    bucketLocalY: Number(row.bucket_local_y),
    bucketLocalZ: Number(row.bucket_local_z),
    reportCount: Number(row.report_count),
    completedCount: Number(row.completed_count),
    cancelledCount: Number(row.cancelled_count),
    failedCount: Number(row.failed_count),
    firstInvokedAt: timestampString(row.first_invoked_at),
    lastResolvedAt: timestampString(row.last_resolved_at),
  }));
}
