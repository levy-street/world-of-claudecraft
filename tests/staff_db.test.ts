import type { PoolClient, QueryResult, QueryResultRow } from 'pg';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type TestQuery = (
  text: string,
  values?: readonly unknown[],
) => Promise<QueryResult<Record<string, unknown>>>;

const db = vi.hoisted(() => ({
  query: vi.fn<TestQuery>(),
  connect: vi.fn<() => Promise<PoolClient>>(),
}));

vi.mock('../server/db', () => ({
  pool: db,
}));

import {
  adminRolesForAccount,
  effectiveAdminRoles,
  listStaff,
  roleChangeHistory,
  setAccountAdminRoles,
} from '../server/staff_db';

const { query, connect } = db;

function queryResult<T extends QueryResultRow>(rows: T[], rowCount = rows.length): QueryResult<T> {
  return {
    command: '',
    rowCount,
    oid: 0,
    fields: [],
    rows,
  };
}

// A pooled-client stub whose query()/release() calls we can inspect. Pinning a
// single client for the whole transaction is what makes BEGIN/.../COMMIT
// atomic, so the tests assert every transactional statement runs through it.
function clientStub() {
  const cquery = vi.fn<TestQuery>().mockResolvedValue(queryResult([]));
  const release = vi.fn();
  return { query: cquery, release };
}

beforeEach(() => {
  query.mockReset();
  connect.mockReset();
});

describe('effectiveAdminRoles', () => {
  it('makes is_admin the single kill switch: FALSE is never staff', () => {
    expect(effectiveAdminRoles(false, [])).toEqual([]);
    // A manual "SET is_admin = FALSE" revokes even with stale roles left over.
    expect(effectiveAdminRoles(false, ['moderator'])).toEqual([]);
  });

  it('never derives superadmin from is_admin: empty roles read as no permissions', () => {
    // Fail closed. A stale is_admin TRUE with empty roles is NOT a superadmin;
    // legacy accounts are migrated to `admin` once by the boot backfill instead.
    expect(effectiveAdminRoles(true, [])).toEqual([]);
    expect(effectiveAdminRoles(true, ['viewer', 'moderator'])).toEqual(['viewer', 'moderator']);
  });
});

describe('adminRolesForAccount', () => {
  it('returns null for a missing account and for a non-staff account', async () => {
    query.mockResolvedValueOnce(queryResult([]));
    expect(await adminRolesForAccount(404)).toBeNull();

    query.mockResolvedValueOnce(
      queryResult([{ username: 'player', is_admin: false, admin_roles: [] }]),
    );
    expect(await adminRolesForAccount(2)).toBeNull();
  });

  it('returns the stored roles, and null when is_admin is set but roles are empty', async () => {
    query.mockResolvedValueOnce(
      queryResult([{ username: 'mat', is_admin: true, admin_roles: ['viewer', 'moderator'] }]),
    );
    expect(await adminRolesForAccount(1)).toEqual({
      username: 'mat',
      roles: ['viewer', 'moderator'],
    });

    // A stale is_admin TRUE with undefined/empty roles (a legacy pre-backfill
    // row, or a manual half-revoke) reads as not-staff, never superadmin.
    query.mockResolvedValueOnce(
      queryResult([{ username: 'founder', is_admin: true, admin_roles: null }]),
    );
    expect(await adminRolesForAccount(3)).toBeNull();
    expect(query).toHaveBeenLastCalledWith(expect.stringContaining('WHERE id = $1'), [3]);
  });
});

describe('listStaff', () => {
  it('maps rows to their stored roles (no derived superadmin) and normalizes last_login', async () => {
    query.mockResolvedValueOnce(
      queryResult([
        {
          id: 1,
          username: 'founder',
          is_admin: true,
          admin_roles: ['admin'],
          last_login: '2026-07-01T10:00:00Z',
        },
        { id: 2, username: 'modbob', is_admin: true, admin_roles: ['moderator'], last_login: null },
      ]),
    );

    expect(await listStaff()).toEqual([
      {
        accountId: 1,
        username: 'founder',
        roles: ['admin'],
        lastLogin: '2026-07-01T10:00:00.000Z',
      },
      { accountId: 2, username: 'modbob', roles: ['moderator'], lastLogin: null },
    ]);
    expect(query.mock.calls[0][0]).toContain('WHERE is_admin');
  });
});

describe('setAccountAdminRoles', () => {
  it('locks the row, writes roles with is_admin in sync, audits, and commits', async () => {
    const client = clientStub();
    client.query.mockImplementation(async (text: string) =>
      text.includes('FOR UPDATE')
        ? queryResult([{ is_admin: false, admin_roles: [] }])
        : queryResult([]),
    );
    connect.mockResolvedValue(client as unknown as PoolClient);

    const change = await setAccountAdminRoles({
      accountId: 9,
      roles: ['moderator'],
      actorAccountId: 7,
    });

    expect(change).toEqual({ before: [], after: ['moderator'] });
    const statements = client.query.mock.calls.map((call) => String(call[0]));
    expect(statements[0]).toBe('BEGIN');
    expect(statements[1]).toContain('FOR UPDATE');
    expect(statements[2]).toContain('UPDATE accounts SET admin_roles = $2, is_admin = $3');
    expect(client.query.mock.calls[2][1]).toEqual([9, ['moderator'], true]);
    expect(statements[3]).toContain('INSERT INTO admin_role_changes');
    expect(client.query.mock.calls[3][1]).toEqual([9, 7, [], ['moderator']]);
    expect(statements[4]).toBe('COMMIT');
    expect(client.release).toHaveBeenCalled();
  });

  it('clears is_admin on a full revoke so the boot backfill cannot resurrect it', async () => {
    const client = clientStub();
    client.query.mockImplementation(async (text: string) =>
      text.includes('FOR UPDATE')
        ? queryResult([{ is_admin: true, admin_roles: ['moderator'] }])
        : queryResult([]),
    );
    connect.mockResolvedValue(client as unknown as PoolClient);

    const change = await setAccountAdminRoles({ accountId: 9, roles: [], actorAccountId: 7 });

    expect(change).toEqual({ before: ['moderator'], after: [] });
    const update = client.query.mock.calls.find((call) =>
      String(call[0]).includes('UPDATE accounts'),
    );
    expect(update?.[1]).toEqual([9, [], false]);
  });

  it('skips the audit row on a no-op write', async () => {
    const client = clientStub();
    client.query.mockImplementation(async (text: string) =>
      text.includes('FOR UPDATE')
        ? queryResult([{ is_admin: true, admin_roles: ['viewer'] }])
        : queryResult([]),
    );
    connect.mockResolvedValue(client as unknown as PoolClient);

    const change = await setAccountAdminRoles({
      accountId: 9,
      roles: ['viewer'],
      actorAccountId: 7,
    });

    expect(change).toEqual({ before: ['viewer'], after: ['viewer'] });
    const statements = client.query.mock.calls.map((call) => String(call[0]));
    expect(statements.some((text) => text.includes('INSERT INTO admin_role_changes'))).toBe(false);
    expect(statements.at(-1)).toBe('COMMIT');
  });

  it('rolls back and returns null when the account does not exist', async () => {
    const client = clientStub();
    connect.mockResolvedValue(client as unknown as PoolClient);

    expect(
      await setAccountAdminRoles({ accountId: 404, roles: ['viewer'], actorAccountId: 7 }),
    ).toBeNull();
    const statements = client.query.mock.calls.map((call) => String(call[0]));
    expect(statements.at(-1)).toBe('ROLLBACK');
    expect(statements.some((text) => text.includes('UPDATE accounts'))).toBe(false);
    expect(client.release).toHaveBeenCalled();
  });

  it('rolls back, releases, and rethrows on a write failure', async () => {
    const client = clientStub();
    client.query.mockImplementation(async (text: string) => {
      if (text.includes('FOR UPDATE')) {
        return queryResult([{ is_admin: false, admin_roles: [] }]);
      }
      if (text.includes('UPDATE accounts')) throw new Error('db down');
      return queryResult([]);
    });
    connect.mockResolvedValue(client as unknown as PoolClient);

    await expect(
      setAccountAdminRoles({ accountId: 9, roles: ['viewer'], actorAccountId: 7 }),
    ).rejects.toThrow('db down');
    const statements = client.query.mock.calls.map((call) => String(call[0]));
    expect(statements.at(-1)).toBe('ROLLBACK');
    expect(client.release).toHaveBeenCalled();
  });
});

describe('roleChangeHistory', () => {
  it('maps audit rows and coalesces deleted accounts and script actors', async () => {
    query.mockResolvedValueOnce(
      queryResult([
        {
          id: '12',
          account_id: 9,
          username: 'modbob',
          admin_username: null,
          roles_before: [],
          roles_after: ['moderator'],
          created_at: '2026-07-01T10:00:00Z',
        },
        {
          id: '11',
          account_id: 8,
          username: null,
          admin_username: 'founder',
          roles_before: ['viewer'],
          roles_after: null,
          created_at: '2026-06-30T10:00:00Z',
        },
      ]),
    );

    expect(await roleChangeHistory(50)).toEqual([
      {
        id: 12,
        accountId: 9,
        username: 'modbob',
        adminUsername: null,
        rolesBefore: [],
        rolesAfter: ['moderator'],
        createdAt: '2026-07-01T10:00:00.000Z',
      },
      {
        id: 11,
        accountId: 8,
        username: null,
        adminUsername: 'founder',
        rolesBefore: ['viewer'],
        rolesAfter: [],
        createdAt: '2026-06-30T10:00:00.000Z',
      },
    ]);
    expect(query).toHaveBeenCalledWith(expect.stringContaining('LIMIT $1'), [50]);
  });
});
