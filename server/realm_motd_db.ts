// SQL boundary for the realm message of the day (the *_db.ts convention). One
// row per realm, present only while a message is set, so realm_motd is bounded
// by the realm count. realm_motd_changes is the durable trail of who set or
// cleared what (the moderation-history row the other staff chat commands
// write): one row per admin edit, a human-rate action, so it is deliberately
// kept forever like admin_role_changes, with no retention registration.
//
// Takes a pool getter (read at query time, never at construction): db.ts
// applies REALM_MOTD_SCHEMA at boot, so this module stays './db'-free.

import type { Pool } from 'pg';
import type { RealmMotdStore } from './realm_motd';

export const REALM_MOTD_SCHEMA = `
CREATE TABLE IF NOT EXISTS realm_motd (
  realm TEXT PRIMARY KEY,
  message TEXT NOT NULL,
  set_by INT REFERENCES accounts(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS realm_motd_changes (
  id BIGSERIAL PRIMARY KEY,
  realm TEXT NOT NULL,
  message TEXT,
  changed_by INT REFERENCES accounts(id) ON DELETE SET NULL,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS realm_motd_changes_realm_time
  ON realm_motd_changes (realm, changed_at DESC);
`;

export const LOAD_REALM_MOTD_SQL = 'SELECT message FROM realm_motd WHERE realm = $1';

// Each write records its change row in the SAME statement, so the live value
// and its trail can never disagree. A NULL message in the trail is a clear.
export const UPSERT_REALM_MOTD_SQL = `
WITH change AS (
  INSERT INTO realm_motd_changes (realm, message, changed_by) VALUES ($1, $2, $3)
)
INSERT INTO realm_motd (realm, message, set_by, updated_at)
VALUES ($1, $2, $3, now())
ON CONFLICT (realm) DO UPDATE
  SET message = EXCLUDED.message, set_by = EXCLUDED.set_by, updated_at = now()
`;

export const DELETE_REALM_MOTD_SQL = `
WITH change AS (
  INSERT INTO realm_motd_changes (realm, message, changed_by) VALUES ($1, NULL, $2)
)
DELETE FROM realm_motd WHERE realm = $1
`;

export function realmMotdStore(getPool: () => Pool, realm: string): RealmMotdStore {
  return {
    async load() {
      const { rows } = await getPool().query<{ message: string }>(LOAD_REALM_MOTD_SQL, [realm]);
      return rows[0]?.message ?? null;
    },
    async save(message, setByAccountId) {
      if (message === null) await getPool().query(DELETE_REALM_MOTD_SQL, [realm, setByAccountId]);
      else await getPool().query(UPSERT_REALM_MOTD_SQL, [realm, message, setByAccountId]);
    },
  };
}
