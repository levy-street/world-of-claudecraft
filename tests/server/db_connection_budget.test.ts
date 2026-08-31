// The boot connection-budget guard's pure core (server/db_connection_budget.ts).
// The load-bearing case is DEPLOY.md's own arithmetic: at the default pool of
// 10 a realm is 14 at cancel peak, so SEVEN realms peak at 98 against the 97
// usable on stock postgres:16 and the guard must fire there; the pre-fix
// arithmetic (no cancel term) computed 91 and stayed silent on exactly that
// configuration.
import { describe, expect, it } from 'vitest';
import { DB_CANCEL_POOL_MAX_CLIENTS } from '../../server/db_backend_cancel';
import {
  configuredPeakDbConnections,
  dbConnectionBudgetWarning,
} from '../../server/db_connection_budget';
import {
  GENERAL_CHAT_QUOTA_DB_POOL_MAX_CLIENTS,
  GENERAL_CHAT_QUOTA_LISTENER_CONNECTIONS,
} from '../../server/general_chat_quota_config';

const STOCK_USABLE = 97;
const DEFAULT_POOL = 10;

describe('configuredPeakDbConnections', () => {
  it('counts the cancel side pool in the per-realm term (14 at the default pool)', () => {
    // 10 shared + 2 quota + 1 listener + 1 deadline-cancel. The literal 14 is
    // the point: dropping the cancel term reverts to the silent 13.
    expect(configuredPeakDbConnections(1, DEFAULT_POOL)).toBe(14);
  });

  it('reproduces DEPLOY.md: seven default realms peak at 98', () => {
    expect(configuredPeakDbConnections(7, DEFAULT_POOL)).toBe(98);
  });

  it('sums the constants its owners export, so none can drift silently', () => {
    expect(configuredPeakDbConnections(3, 20)).toBe(
      3 *
        (20 +
          GENERAL_CHAT_QUOTA_DB_POOL_MAX_CLIENTS +
          GENERAL_CHAT_QUOTA_LISTENER_CONNECTIONS +
          DB_CANCEL_POOL_MAX_CLIENTS),
    );
    // The owners' literal values, so a widened pool constant is a conscious
    // edit here too (the arithmetic above alone would follow it silently).
    expect(GENERAL_CHAT_QUOTA_DB_POOL_MAX_CLIENTS).toBe(2);
    expect(GENERAL_CHAT_QUOTA_LISTENER_CONNECTIONS).toBe(1);
    expect(DB_CANCEL_POOL_MAX_CLIENTS).toBe(1);
  });
});

describe('dbConnectionBudgetWarning', () => {
  it('fires at seven default realms, the configuration DEPLOY.md says does not fit', () => {
    const warning = dbConnectionBudgetWarning(7, DEFAULT_POOL, STOCK_USABLE);
    expect(warning).not.toBeNull();
    expect(warning).toContain('7 realms');
    expect(warning).toContain('= 98 peak connections');
    expect(warning).toContain('deadline-cancel');
    expect(warning).toContain('too many clients');
  });

  it('stays silent at six default realms, the largest count that fits with peak headroom', () => {
    expect(dbConnectionBudgetWarning(6, DEFAULT_POOL, STOCK_USABLE)).toBeNull();
  });

  it('stays silent exactly at the ceiling and fires one connection past it', () => {
    // 97 realms of 1-connection terms cannot exist; drive the boundary with
    // the pool knob instead: one realm at pool 93 is 97 (fits), 94 is 98.
    expect(dbConnectionBudgetWarning(1, 93, STOCK_USABLE)).toBeNull();
    expect(dbConnectionBudgetWarning(1, 94, STOCK_USABLE)).not.toBeNull();
  });
});
