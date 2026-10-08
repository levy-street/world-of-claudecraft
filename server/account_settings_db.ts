import type { AccountSettingsEntries, DeviceType } from '../src/account_settings_contract';
import { sanitizeAccountSettingsEntries } from '../src/account_settings_contract';
import {
  type AccountSettingsTransactionRunner,
  runAccountSettingsTransaction,
} from './account_settings_transaction_db';

// Keep forever: bounded to three profiles and one acknowledgment per account,
// cascading with account deletion. No session/event history or realm-wide scans.
export const ACCOUNT_SETTINGS_SCHEMA = `
CREATE TABLE IF NOT EXISTS account_settings_ack (
  account_id INT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS account_device_settings (
  account_id INT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  device_type TEXT NOT NULL CHECK (device_type IN ('desktop', 'phone', 'tablet')),
  entries JSONB NOT NULL CHECK (jsonb_typeof(entries) = 'object' AND octet_length(entries::text) <= 65536),
  PRIMARY KEY (account_id, device_type)
);`;

export interface AccountSettingsDb {
  acknowledged(accountId: number): Promise<boolean>;
  acknowledge(accountId: number): Promise<void>;
  initialize(
    accountId: number,
    device: DeviceType,
    characterId: number,
    entries: AccountSettingsEntries,
  ): Promise<AccountSettingsEntries | null>;
  save(accountId: number, device: DeviceType, entries: AccountSettingsEntries): Promise<boolean>;
}
type Query = Parameters<Parameters<AccountSettingsTransactionRunner>[1]>[0];
function bounded<T>(
  run: AccountSettingsTransactionRunner,
  fn: (query: Query) => Promise<T>,
): Promise<T> {
  return run(2_000, fn);
}
export function createAccountSettingsDb(
  run: AccountSettingsTransactionRunner = runAccountSettingsTransaction,
): AccountSettingsDb {
  return {
    acknowledged: (accountId) =>
      bounded(
        run,
        async (query) =>
          (await query('SELECT 1 FROM account_settings_ack WHERE account_id = $1', [accountId]))
            .rowCount === 1,
      ),
    acknowledge: (accountId) =>
      bounded(run, async (query) => {
        await query(
          'INSERT INTO account_settings_ack (account_id) VALUES ($1) ON CONFLICT DO NOTHING',
          [accountId],
        );
      }),
    initialize: (accountId, device, characterId, entries) =>
      bounded(run, async (query) => {
        const owned = await query(
          `SELECT 1 FROM characters c WHERE c.id = $1 AND c.account_id = $2
      AND EXISTS (SELECT 1 FROM account_settings_ack WHERE account_id = $2)`,
          [characterId, accountId],
        );
        if (owned.rowCount !== 1) return null;
        // INSERT then SELECT are separate READ COMMITTED statements: a concurrent
        // winner becomes visible after ON CONFLICT waits for its transaction.
        await query(
          `INSERT INTO account_device_settings (account_id, device_type, entries)
      VALUES ($1, $2, $3::jsonb) ON CONFLICT (account_id, device_type) DO NOTHING`,
          [accountId, device, JSON.stringify(entries)],
        );
        const result = await query(
          'SELECT entries FROM account_device_settings WHERE account_id = $1 AND device_type = $2',
          [accountId, device],
        );
        return sanitizeAccountSettingsEntries(result.rows[0]?.entries);
      }),
    save: (accountId, device, entries) =>
      bounded(
        run,
        async (query) =>
          (
            await query(
              `UPDATE account_device_settings SET entries = $3::jsonb
      WHERE account_id = $1 AND device_type = $2`,
              [accountId, device, JSON.stringify(entries)],
            )
          ).rowCount === 1,
      ),
  };
}
export const accountSettingsDb = createAccountSettingsDb();
