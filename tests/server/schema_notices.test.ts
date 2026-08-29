// The shared boot-notice forwarder (server/schema_notices.ts): the filter must
// drop every idempotent-DDL skip shape a steady-state boot emits by the
// hundreds while forwarding fragment RAISE NOTICE reports, and the attach
// helper must tolerate minimal test fakes. Notice shapes below are the REAL
// ones measured against PG 16 (drop-skips arrive as SQLSTATE 00000, the same
// code a plpgsql RAISE report carries, separated only by the reporting
// routine).
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  attachSchemaNoticeForwarder,
  isIdempotentSchemaSkipNotice,
} from '../../server/schema_notices';

describe('isIdempotentSchemaSkipNotice', () => {
  it('drops each already-exists skip code, per dimension', () => {
    const cases: Array<[string, string]> = [
      ['42P07', 'relation "accounts" already exists, skipping'],
      ['42701', 'column "locale" of relation "accounts" already exists, skipping'],
      ['42P06', 'schema "public" already exists, skipping'],
      ['42710', 'extension "pgcrypto" already exists, skipping'],
    ];
    for (const [code, message] of cases) {
      expect(isIdempotentSchemaSkipNotice({ code, message })).toBe(true);
    }
  });

  it('drops the does-not-exist drop-skips by routine, not by their 00000 code', () => {
    expect(
      isIdempotentSchemaSkipNotice({
        code: '00000',
        routine: 'does_not_exist_skipping',
        message:
          'trigger "storage_purchase_archive_applied" for relation "storage_purchases" does not exist, skipping',
      }),
    ).toBe(true);
    expect(
      isIdempotentSchemaSkipNotice({
        code: '00000',
        routine: 'DropErrorMsgNonExistent',
        message: 'index "woc_market_settlements_open" does not exist, skipping',
      }),
    ).toBe(true);
    // ALTER TABLE ... DROP CONSTRAINT IF EXISTS reports through its own
    // routine (measured on PG 16); the boot DDL carries three such statements
    // (server/social_db.ts, server/player_metrics_db.ts), so missing this
    // shape leaks three noise lines per boot per realm.
    expect(
      isIdempotentSchemaSkipNotice({
        code: '00000',
        routine: 'ATExecDropConstraint',
        message:
          'constraint "characters_name_key" of relation "characters" does not exist, skipping',
      }),
    ).toBe(true);
  });

  it('forwards a plpgsql RAISE report despite its shared 00000 code', () => {
    // The one report the forwarder exists to surface: same SQLSTATE as the
    // drop-skips, distinguished only by the exec_stmt_raise routine.
    expect(
      isIdempotentSchemaSkipNotice({
        code: '00000',
        routine: 'exec_stmt_raise',
        message:
          'storage_purchases: removed 3 legacy refused row(s) before installing the closed status constraint',
      }),
    ).toBe(false);
  });

  it('fails open: an unrecognized notice is forwarded, never dropped', () => {
    expect(isIdempotentSchemaSkipNotice({ code: '01000', message: 'some warning' })).toBe(false);
    expect(isIdempotentSchemaSkipNotice({ message: 'codeless, routineless' })).toBe(false);
  });
});

describe('attachSchemaNoticeForwarder', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('registers a filtered notice listener that prefixes forwarded lines', () => {
    const listeners: Array<
      (notice: { code?: string; routine?: string; message?: string }) => void
    > = [];
    attachSchemaNoticeForwarder({
      on: (event, listener) => {
        expect(event).toBe('notice');
        listeners.push(listener);
      },
    });
    expect(listeners).toHaveLength(1);
    const warns = vi.spyOn(console, 'warn').mockImplementation(() => {});
    listeners[0]({ code: '42P07', message: 'relation "accounts" already exists, skipping' });
    listeners[0]({
      code: '00000',
      routine: 'DropErrorMsgNonExistent',
      message: 'index "gone" does not exist, skipping',
    });
    expect(warns).not.toHaveBeenCalled();
    listeners[0]({ code: '00000', routine: 'exec_stmt_raise', message: 'removed 3 rows' });
    expect(warns).toHaveBeenCalledTimes(1);
    expect(String(warns.mock.calls[0][0])).toBe('[schema] removed 3 rows');
  });

  it('tolerates a minimal client fake with no on()', () => {
    expect(() => attachSchemaNoticeForwarder({})).not.toThrow();
  });
});
