// Shared audit trail for map-editor content moderation: unpublishing a map
// and blocking/unblocking an uploaded GLB asset. Mirrors blocked_ip_actions
// (server/ip_block_db.ts): the owning *_db.ts module writes its status-change
// UPDATE and the audit INSERT here inside the SAME transaction, so the log
// can never drift from the row it describes. The schema is appended to the
// main ensureSchema() run in db.ts (idempotent, applied at every boot under
// the advisory lock), like MAPS_SCHEMA and USER_ASSETS_SCHEMA.

import type { Pool, PoolClient } from 'pg';

// Kept forever, like account_moderation_actions and blocked_ip_actions: this
// is a moderation audit log, not per-event telemetry, so it is deliberately
// exempt from the retention sweep (server/retention_sweep.ts).
export const CONTENT_MODERATION_SCHEMA = `
CREATE TABLE IF NOT EXISTS content_moderation_actions (
  id BIGSERIAL PRIMARY KEY,
  resource_kind TEXT NOT NULL,
  resource_id INT NOT NULL,
  owner_account_id INT REFERENCES accounts(id) ON DELETE SET NULL,
  admin_account_id INT REFERENCES accounts(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS content_moderation_actions_resource ON content_moderation_actions(resource_kind, resource_id, created_at DESC);
CREATE INDEX IF NOT EXISTS content_moderation_actions_created ON content_moderation_actions(created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS content_moderation_actions_admin_created ON content_moderation_actions(admin_account_id, created_at DESC, id DESC);
`;

/** The resources this audit trail covers. */
export type ContentModerationResourceKind = 'map' | 'user_asset';

// The closed set of values ever written to content_moderation_actions.action.
// The column is free-text in SQL, so this const is the single source of
// truth, mirroring MODERATION_ACTIONS in moderation_db.ts.
export const CONTENT_MODERATION_ACTIONS = ['unpublish', 'block', 'unblock'] as const;
export type ContentModerationAction = (typeof CONTENT_MODERATION_ACTIONS)[number];

const REASON_MAX = 500;

/** Trims and bounds an admin-supplied moderation reason; never throws. */
export function cleanContentModerationReason(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim().slice(0, REASON_MAX) : '';
}

// A pg pool or a pinned pool client (both expose query); lets the audit-log
// INSERT run inside the caller's own status-change transaction.
type Queryable = Pick<Pool, 'query'> | Pick<PoolClient, 'query'>;

export function recordContentModerationAction(
  db: Queryable,
  params: {
    resourceKind: ContentModerationResourceKind;
    resourceId: number;
    ownerAccountId: number | null;
    adminAccountId: number;
    action: ContentModerationAction;
    reason: string;
  },
): Promise<unknown> {
  return db.query(
    `INSERT INTO content_moderation_actions
       (resource_kind, resource_id, owner_account_id, admin_account_id, action, reason)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      params.resourceKind,
      params.resourceId,
      params.ownerAccountId,
      params.adminAccountId,
      params.action,
      params.reason,
    ],
  );
}
