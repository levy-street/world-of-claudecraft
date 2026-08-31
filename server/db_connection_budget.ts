// The boot connection-budget guard's pure core. Every realm process builds
// its own pools on the one DATABASE_URL with no cross-process coordination,
// so the multi-realm multiplication must be warned about where it is decided
// rather than left to the operator's arithmetic. The per-realm term counts
// the shared pool, the two General-quota consume clients, the one quota
// LISTEN client, AND the max-1 deadline-cancel side pool: the cancel
// connection is transient, but it is demanded exactly when Postgres is most
// contended, and DEPLOY.md's budget arithmetic counts it (at the default
// pool size a realm is 13 steady and 14 at cancel peak, so seven realms peak
// at 98 against the 97 usable on stock postgres:16), so the guard must fire
// where that arithmetic does. Boot clients, tooling, and rolling-restart
// overlap ride on top; the warning names them instead of modelling them.

import { DB_CANCEL_POOL_MAX_CLIENTS } from './db_backend_cancel';
import {
  GENERAL_CHAT_QUOTA_DB_POOL_MAX_CLIENTS,
  GENERAL_CHAT_QUOTA_LISTENER_CONNECTIONS,
} from './general_chat_quota_config';

/** Peak connections the configured realm directory claims on one database. */
export function configuredPeakDbConnections(realmCount: number, poolMaxClients: number): number {
  return (
    realmCount *
    (poolMaxClients +
      GENERAL_CHAT_QUOTA_DB_POOL_MAX_CLIENTS +
      GENERAL_CHAT_QUOTA_LISTENER_CONNECTIONS +
      DB_CANCEL_POOL_MAX_CLIENTS)
  );
}

/**
 * The boot warning line when the configured peak breaks the usable budget,
 * or null while it fits. Dev-channel English: a log line, never player text.
 */
export function dbConnectionBudgetWarning(
  realmCount: number,
  poolMaxClients: number,
  usableCeiling: number,
): string | null {
  const peak = configuredPeakDbConnections(realmCount, poolMaxClients);
  if (peak <= usableCeiling) return null;
  return (
    `db pool: ${realmCount} realms x (${poolMaxClients} shared + ` +
    `${GENERAL_CHAT_QUOTA_DB_POOL_MAX_CLIENTS} quota + ` +
    `${GENERAL_CHAT_QUOTA_LISTENER_CONNECTIONS} listener + ` +
    `${DB_CANCEL_POOL_MAX_CLIENTS} deadline-cancel) = ${peak} peak connections, past the ` +
    `${usableCeiling} usable on stock postgres:16 (max_connections 100, 3 superuser-reserved), ` +
    'before tooling, the boot schema and concurrent-index clients, and rolling-restart ' +
    'overlap. If every realm shares this DATABASE_URL, logins will fail with ' +
    '"too many clients" at peak: lower DB_POOL_MAX_CLIENTS or raise max_connections.'
  );
}
