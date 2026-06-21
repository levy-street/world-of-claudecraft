// Postgres-backed realm registry (#475). A `realms` row promotes a realm from
// an env-configured directory entry (server/realm.ts) into a first-class,
// ownable entity: a lifecycle (provisioning → active → decommissioning →
// lapsed → closed), an owner account, a stake tier, delegated operator roles,
// and a stable per-realm world seed. The schema is appended to the main
// ensureSchema() run in db.ts; the env default realm is upserted here on boot
// so even a single-shard deployment is a registry of one.
//
// SQL lives only in *_db.ts (see server/CLAUDE.md). The pure helpers — seed
// derivation (`worldSeedForRealm`), directory merge (`mergeRealmDirectory`),
// and the domain types — live in realm.ts; this module only persists.

import type { Pool, PoolClient } from 'pg';
import {
  REALM,
  REALM_TYPE,
  DEFAULT_REALM_NAME,
  resolveRealmType,
  worldSeedForRealm,
  isRealmStatus,
  type RealmType,
  type RealmStatus,
  type RealmRole,
  type DbRealmSummary,
} from './realm';

// Anything we can run a query against — the shared pool or a checked-out client
// (the boot seed runs on the ensureSchema() client, under its advisory lock).
type Queryable = Pick<Pool, 'query'> | PoolClient;

export const REALM_SCHEMA = `
-- Realms as first-class, ownable entities. A row here backs a player-provisioned
-- realm (or the env default realm, upserted on boot). characters.realm already
-- scopes a character to a realm by name; this table adds the realm's identity,
-- owner, tier, lifecycle, and stable world seed. Name is the join key to the
-- existing realm-scoped data, so it is unique case-insensitively while live.
CREATE TABLE IF NOT EXISTS realms (
  realm_id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'Normal' CHECK (type IN ('Normal', 'PvP', 'RP', 'RP-PvP')),
  owner_account_id INT REFERENCES accounts(id) ON DELETE SET NULL,
  tier SMALLINT NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('provisioning', 'active', 'decommissioning', 'lapsed', 'closed')),
  world_seed BIGINT NOT NULL,
  origin_url TEXT NOT NULL DEFAULT '',
  provisioned_at TIMESTAMPTZ,
  decommission_requested_at TIMESTAMPTZ,
  release_eligible_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- One live realm per name (case-insensitive). 'closed' realms release the name
-- so it can be re-provisioned, matching the character/guild name model.
CREATE UNIQUE INDEX IF NOT EXISTS realms_active_name
  ON realms(lower(name)) WHERE status <> 'closed';
CREATE INDEX IF NOT EXISTS realms_owner ON realms(owner_account_id);
CREATE INDEX IF NOT EXISTS realms_status ON realms(status);

-- Delegated operator roles. owner is the stake account; moderator/builder are
-- invited so a guild can run a realm without sharing the stake wallet. One row
-- per (realm, account, role); roles cascade away with the realm.
CREATE TABLE IF NOT EXISTS realm_roles (
  realm_id BIGINT NOT NULL REFERENCES realms(realm_id) ON DELETE CASCADE,
  account_id INT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner', 'moderator', 'builder')),
  granted_by INT REFERENCES accounts(id) ON DELETE SET NULL,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (realm_id, account_id, role)
);
CREATE INDEX IF NOT EXISTS realm_roles_account ON realm_roles(account_id);
`;

export interface RealmRow {
  realmId: number;
  name: string;
  type: RealmType;
  ownerAccountId: number | null;
  tier: number;
  status: RealmStatus;
  worldSeed: number;
  originUrl: string;
  provisionedAt: Date | null;
  decommissionRequestedAt: Date | null;
  releaseEligibleAt: Date | null;
  createdAt: Date;
}

export interface RealmRoleRow {
  realmId: number;
  accountId: number;
  role: RealmRole;
  grantedBy: number | null;
  grantedAt: Date;
}

const REALM_COLS = `realm_id, name, type, owner_account_id, tier, status, world_seed,
  origin_url, provisioned_at, decommission_requested_at, release_eligible_at, created_at`;

// pg returns BIGINT as a string to avoid precision loss; realm ids and the
// world seed both fit safely in a JS number, so coerce at the boundary.
function rowToRealm(r: Record<string, unknown>): RealmRow {
  const status = String(r.status);
  return {
    realmId: Number(r.realm_id),
    name: String(r.name),
    type: resolveRealmType(String(r.type)),
    ownerAccountId: r.owner_account_id == null ? null : Number(r.owner_account_id),
    tier: Number(r.tier),
    status: isRealmStatus(status) ? status : 'active',
    worldSeed: Number(r.world_seed),
    originUrl: String(r.origin_url),
    provisionedAt: (r.provisioned_at as Date | null) ?? null,
    decommissionRequestedAt: (r.decommission_requested_at as Date | null) ?? null,
    releaseEligibleAt: (r.release_eligible_at as Date | null) ?? null,
    createdAt: r.created_at as Date,
  };
}

// Upsert this process's env realm as an `active` registry row on boot, so the
// default single-shard deployment is a registry of one and the realm-list
// screen is DB-backed from the first request. Idempotent and race-safe: it runs
// on the ensureSchema() client under the shared advisory lock, and the
// case-insensitive active-name index makes a concurrent insert a no-op. The env
// realm is a system realm (no owner, tier 0) and keeps the canonical world seed.
export async function seedDefaultRealm(client: Queryable): Promise<void> {
  await client.query(
    `INSERT INTO realms (name, type, status, world_seed, origin_url, provisioned_at)
     SELECT $1, $2, 'active', $3, '', now()
     WHERE NOT EXISTS (SELECT 1 FROM realms WHERE lower(name) = lower($1) AND status <> 'closed')`,
    [REALM, REALM_TYPE, worldSeedForRealm(REALM)],
  );
}

// Active realms reduced to the realm-list summary (joined with the env
// directory by mergeRealmDirectory). 'closed' realms are excluded; everything
// else is shown so a newer client can render provisioning/decommissioning state.
export async function listRealmsForDirectory(db: Queryable): Promise<DbRealmSummary[]> {
  const res = await db.query(
    `SELECT realm_id, name, type, origin_url, status, owner_account_id, tier
       FROM realms WHERE status <> 'closed' ORDER BY created_at ASC`,
  );
  return res.rows.map((r: Record<string, unknown>) => ({
    realmId: Number(r.realm_id),
    name: String(r.name),
    type: resolveRealmType(String(r.type)),
    originUrl: String(r.origin_url),
    status: isRealmStatus(String(r.status)) ? (String(r.status) as RealmStatus) : 'active',
    ownerAccountId: r.owner_account_id == null ? null : Number(r.owner_account_id),
    tier: Number(r.tier),
  }));
}

export async function getRealmById(db: Queryable, realmId: number): Promise<RealmRow | null> {
  const res = await db.query(`SELECT ${REALM_COLS} FROM realms WHERE realm_id = $1`, [realmId]);
  return res.rows[0] ? rowToRealm(res.rows[0]) : null;
}

// The live (non-closed) realm with this name, if any. The name is the scoping
// key shared with characters/guilds, so this is how a connection resolves the
// realm it is operating in.
export async function getLiveRealmByName(db: Queryable, name: string): Promise<RealmRow | null> {
  const res = await db.query(
    `SELECT ${REALM_COLS} FROM realms WHERE lower(name) = lower($1) AND status <> 'closed' LIMIT 1`,
    [name],
  );
  return res.rows[0] ? rowToRealm(res.rows[0]) : null;
}

// Create a player-provisioned realm in the `provisioning` state (the stake lock
// is confirmed separately, which flips it to `active`). The world seed is
// derived from the name so it is stable and reproducible. Relies on the
// case-insensitive active-name unique index to reject a duplicate name; callers
// translate a 23505 unique violation into a 409.
export async function createProvisioningRealm(
  db: Queryable,
  opts: { name: string; type: RealmType; ownerAccountId: number; tier: number },
): Promise<RealmRow> {
  const res = await db.query(
    `INSERT INTO realms (name, type, owner_account_id, tier, status, world_seed)
     VALUES ($1, $2, $3, $4, 'provisioning', $5)
     RETURNING ${REALM_COLS}`,
    [opts.name, opts.type, opts.ownerAccountId, opts.tier, worldSeedForRealm(opts.name)],
  );
  return rowToRealm(res.rows[0]);
}

// Flip a realm to `active` once its stake lock is confirmed on-chain, stamping
// provisioned_at. Scoped to the provisioning realm so a confirm cannot reactivate
// a decommissioned realm. Returns the updated row, or null if it was not pending.
export async function activateRealm(db: Queryable, realmId: number): Promise<RealmRow | null> {
  const res = await db.query(
    `UPDATE realms SET status = 'active', provisioned_at = now()
       WHERE realm_id = $1 AND status = 'provisioning'
     RETURNING ${REALM_COLS}`,
    [realmId],
  );
  return res.rows[0] ? rowToRealm(res.rows[0]) : null;
}

// Begin decommissioning: start the unstake timelock. release_eligible_at is when
// the owner-signed on-chain release becomes valid (the timelock gives players a
// migration window and blunts grief). Only an active realm can decommission.
export async function requestDecommission(
  db: Queryable,
  realmId: number,
  releaseEligibleAt: Date,
): Promise<RealmRow | null> {
  const res = await db.query(
    `UPDATE realms
        SET status = 'decommissioning', decommission_requested_at = now(), release_eligible_at = $2
      WHERE realm_id = $1 AND status = 'active'
      RETURNING ${REALM_COLS}`,
    [realmId, releaseEligibleAt],
  );
  return res.rows[0] ? rowToRealm(res.rows[0]) : null;
}

// Set a realm's lifecycle status directly (e.g. freeze → 'lapsed' for a ToS
// violation, or 'closed' once the stake is released). Never touches funds; this
// is the server's authority over realm *state* only.
export async function setRealmStatus(
  db: Queryable,
  realmId: number,
  status: RealmStatus,
): Promise<RealmRow | null> {
  const res = await db.query(
    `UPDATE realms SET status = $2 WHERE realm_id = $1 RETURNING ${REALM_COLS}`,
    [realmId, status],
  );
  return res.rows[0] ? rowToRealm(res.rows[0]) : null;
}

// Grant a delegated role. Idempotent: re-granting the same role is a no-op.
export async function addRealmRole(
  db: Queryable,
  realmId: number,
  accountId: number,
  role: RealmRole,
  grantedBy: number | null,
): Promise<void> {
  await db.query(
    `INSERT INTO realm_roles (realm_id, account_id, role, granted_by)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (realm_id, account_id, role) DO NOTHING`,
    [realmId, accountId, role, grantedBy],
  );
}

// Revoke a delegated role. The owner role is set on the realm row itself and is
// never revoked here (it transfers with ownership), so callers guard against
// revoking 'owner'.
export async function removeRealmRole(
  db: Queryable,
  realmId: number,
  accountId: number,
  role: RealmRole,
): Promise<void> {
  await db.query(
    `DELETE FROM realm_roles WHERE realm_id = $1 AND account_id = $2 AND role = $3`,
    [realmId, accountId, role],
  );
}

export async function listRealmRoles(db: Queryable, realmId: number): Promise<RealmRoleRow[]> {
  const res = await db.query(
    `SELECT realm_id, account_id, role, granted_by, granted_at
       FROM realm_roles WHERE realm_id = $1 ORDER BY granted_at ASC`,
    [realmId],
  );
  return res.rows.map((r: Record<string, unknown>) => ({
    realmId: Number(r.realm_id),
    accountId: Number(r.account_id),
    role: String(r.role) as RealmRole,
    grantedBy: r.granted_by == null ? null : Number(r.granted_by),
    grantedAt: r.granted_at as Date,
  }));
}

// Every role an account holds on a realm, owner included. owner is read off the
// realms row (the authoritative owner), unioned with the delegated roles, so a
// caller can authorize "can this account customize/moderate this realm?".
export async function rolesForAccountOnRealm(
  db: Queryable,
  realmId: number,
  accountId: number,
): Promise<RealmRole[]> {
  const res = await db.query(
    `SELECT 'owner'::text AS role FROM realms WHERE realm_id = $1 AND owner_account_id = $2
     UNION
     SELECT role FROM realm_roles WHERE realm_id = $1 AND account_id = $2`,
    [realmId, accountId],
  );
  return res.rows.map((r: Record<string, unknown>) => String(r.role) as RealmRole);
}

// How many realms an account already owns — enforces the per-account
// provisioning cap (anti name-squatting). Counts only live realms.
export async function countOwnedRealms(db: Queryable, accountId: number): Promise<number> {
  const res = await db.query(
    `SELECT count(*)::int AS n FROM realms WHERE owner_account_id = $1 AND status <> 'closed'`,
    [accountId],
  );
  return Number(res.rows[0]?.n ?? 0);
}

// Re-export the canonical default name so callers don't reach past this module
// into realm.ts for it when working with the registry.
export { DEFAULT_REALM_NAME };
