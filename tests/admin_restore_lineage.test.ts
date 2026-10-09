// The GM item restore's optional lost-copy link (derivedFrom) on the LEGACY
// handleAdminApi ladder arm of POST /admin/api/moderation/characters/:id/restore-item.
// The RouteDef twin is pinned in tests/server/admin.test.ts; this file holds
// the ladder arm to the same contract: the guid is validated before any audit
// write, lowercased, recorded in the audit detail, and passed to the runtime
// so the restored tracked copy is minted as a `derive` of the lost one.
import { EventEmitter } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../server/db', () => ({
  DATABASE_URL: 'postgres://test:test@127.0.0.1:1/test',
  pool: { query: vi.fn(async () => ({ rows: [] })) },
  findAccount: vi.fn(),
  touchLogin: vi.fn(),
  saveToken: vi.fn(),
  accountAndScopeForToken: vi.fn(async () => ({ accountId: 7, scope: 'full' as const })),
  isAdminAccount: vi.fn(async () => true),
  accountMailTarget: vi.fn(async () => null),
  accountById: vi.fn(),
  updatePasswordHash: vi.fn(),
  revokeTokensExcept: vi.fn(),
}));
vi.mock('../server/account', () => ({
  verifyLoginTwoFactor: vi.fn(async () => false),
}));
vi.mock('../server/staff_db', () => ({
  adminRolesForAccount: vi.fn(async () => ({ username: 'admin', roles: ['superadmin'] })),
  listStaff: vi.fn(async () => []),
  setAccountAdminRoles: vi.fn(),
  roleChangeHistory: vi.fn(async () => []),
}));
vi.mock('../server/moderation_db', () => ({
  forceCharacterRename: vi.fn(),
  recordProfessionsRestore: vi.fn(async () => ({ accountId: 9 })),
  moderationQueue: vi.fn(),
  moderationReportsForAccount: vi.fn(),
  ignoreReport: vi.fn(),
  liftAccountChatMute: vi.fn(),
  moderateAccount: vi.fn(),
  muteAccountChat: vi.fn(),
  reactivateAccountAudited: vi.fn(),
  recordPasswordReset: vi.fn(),
  resetChatStrikesAudited: vi.fn(),
}));

import { handleAdminApi } from '../server/admin';
import { recordProfessionsRestore } from '../server/moderation_db';

const TOKEN = 'a'.repeat(64);
const LOST = '9b2e7c1a-5d34-4f6e-8a1b-2c3d4e5f6071';

function postRestore(body: unknown): IncomingMessage {
  const req = new EventEmitter() as EventEmitter & {
    method: string;
    url: string;
    headers: { authorization?: string };
    socket: { remoteAddress: string };
  };
  req.method = 'POST';
  req.url = '/admin/api/moderation/characters/42/restore-item';
  req.headers = { authorization: `Bearer ${TOKEN}` };
  req.socket = { remoteAddress: '10.0.0.9' };
  setImmediate(() => {
    req.emit('data', JSON.stringify(body));
    req.emit('end');
  });
  return req as unknown as IncomingMessage;
}

interface FakeRes {
  statusCode: number;
  body: { success?: boolean; error?: string | null } | null;
}

function fakeRes(): FakeRes & ServerResponse {
  const res = {
    statusCode: 0,
    body: null,
    writeHead(status: number) {
      this.statusCode = status;
    },
    end(data?: string) {
      this.body = data ? JSON.parse(data) : null;
    },
  };
  return res as unknown as FakeRes & ServerResponse;
}

const adminRestoreItem = vi.fn((): 'ok' | 'offline' | 'invalid_item' => 'ok');
const game = {
  adminCharacterOnline: vi.fn(() => true),
  adminRestoreItem,
} as unknown as Parameters<typeof handleAdminApi>[2];

beforeEach(() => {
  vi.mocked(recordProfessionsRestore).mockClear();
  adminRestoreItem.mockClear();
});

describe('restore-item lost-copy link (LEGACY dispatch arm)', () => {
  it('lowercases the lost copy guid, audits it, then mints it as derivedFrom', async () => {
    const res = fakeRes();
    await handleAdminApi(
      postRestore({
        itemId: 'duskforged_warblade',
        count: 1,
        derivedFrom: LOST.toUpperCase(),
        reason: 'lost to issue 4305',
      }),
      res,
      game,
    );
    expect(res.statusCode).toBe(200);
    expect(recordProfessionsRestore).toHaveBeenCalledWith({
      characterId: 42,
      adminAccountId: 7,
      action: 'restore_item',
      detail: `duskforged_warblade x1 derived from ${LOST}`,
      reason: 'lost to issue 4305',
    });
    expect(adminRestoreItem).toHaveBeenCalledWith(42, 'duskforged_warblade', 1, LOST);
    const auditOrder = vi.mocked(recordProfessionsRestore).mock.invocationCallOrder[0];
    expect(auditOrder).toBeLessThan(adminRestoreItem.mock.invocationCallOrder[0]);
  });

  it('keeps a restore with no lost copy a plain one', async () => {
    const res = fakeRes();
    await handleAdminApi(
      postRestore({ itemId: 'copper_mining_pick', count: 2, reason: 'lost' }),
      res,
      game,
    );
    expect(res.statusCode).toBe(200);
    expect(vi.mocked(recordProfessionsRestore).mock.calls[0]?.[0]).toMatchObject({
      detail: 'copper_mining_pick x2',
    });
    expect(adminRestoreItem).toHaveBeenCalledWith(42, 'copper_mining_pick', 2, undefined);
  });

  it('refuses a malformed lost copy guid before any audit write', async () => {
    const res = fakeRes();
    await handleAdminApi(
      postRestore({ itemId: 'duskforged_warblade', count: 1, derivedFrom: 'nope', reason: 'x' }),
      res,
      game,
    );
    expect(res.statusCode).toBe(400);
    expect(res.body?.error).toBe('derived-from must be an item id');
    expect(recordProfessionsRestore).not.toHaveBeenCalled();
    expect(adminRestoreItem).not.toHaveBeenCalled();
  });
});
