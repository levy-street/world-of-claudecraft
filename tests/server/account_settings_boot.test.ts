import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { build } from 'esbuild';
import { describe, expect, it } from 'vitest';

describe('account settings server boot', () => {
  it('db-first bundled boot defers reading the pool until the first transaction', async () => {
    // Keep the generated executable under node_modules so bundled external
    // dependency resolution matches the server without touching tracked files.
    const dir = mkdtempSync(join(process.cwd(), 'node_modules', '.account-settings-boot-'));
    const output = join(dir, 'boot.cjs');
    try {
      await build({
        stdin: {
          resolveDir: process.cwd(),
          contents: `
          import { EventEmitter } from 'node:events';
          import { pool } from './server/db';
          import { runAccountSettingsTransaction } from './server/account_settings_transaction_db';
          class Client extends EventEmitter {
            query() { return Promise.resolve({rows:[],rowCount:0}); }
            release() {}
          }
          pool.connect = async () => new Client();
          runAccountSettingsTransaction(2000, async query => {
            await query('SELECT 1'); return 'settings-boot-ok';
          }).then(result => { console.log(result); return pool.end(); }).catch(error => {
            console.error(error); process.exitCode = 1;
          });
        `,
        },
        outfile: output,
        bundle: true,
        platform: 'node',
        format: 'cjs',
        packages: 'external',
      });
      const stdout = execFileSync(process.execPath, [output], {
        encoding: 'utf8',
        timeout: 10_000,
      });
      expect(stdout).toContain('settings-boot-ok');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
