// The /admin/api/antibot-config routes (server/admin.ts): the GET catalog, the
// POST validate-apply-persist path, and the rollback branch (an invalid override
// document must 400, re-apply the previously saved document, and persist
// nothing). The detector itself is faked through the GameServer delegates; its
// real validation semantics are covered by the private repo's config tests.
import { EventEmitter } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../server/db', () => ({
  pool: { query: vi.fn(async () => ({ rows: [] })) },
  findAccount: vi.fn(),
  touchLogin: vi.fn(),
  saveToken: vi.fn(),
  accountForToken: vi.fn(),
  isAdminAccount: vi.fn(),
  accountMailTarget: vi.fn(async () => null),
}));
vi.mock('../server/antibot_config_db', () => ({
  loadAntibotConfig: vi.fn(async () => ({ data: {}, updatedAt: null })),
  listAntibotConfigHistory: vi.fn(async () => []),
  saveAntibotConfigChange: vi.fn(async () => ({
    changed: true,
    updatedAt: '2026-07-04T00:00:01.000Z',
  })),
}));
vi.mock('../server/staff_db', () => ({
  adminRolesForAccount: vi.fn(),
  listStaff: vi.fn(async () => []),
  roleChangeHistory: vi.fn(async () => []),
  setAccountAdminRoles: vi.fn(),
}));

import { handleAdminApi } from '../server/admin';
import {
  listAntibotConfigHistory,
  loadAntibotConfig,
  saveAntibotConfigChange,
} from '../server/antibot_config_db';
import type { ConfigField } from '../server/bot_detector/contract';
import { accountForToken, isAdminAccount } from '../server/db';
import { adminRolesForAccount } from '../server/staff_db';

const VALID_TOKEN = 'a'.repeat(64);

function fakeReq(opts: { method?: string; url?: string; body?: unknown } = {}): IncomingMessage {
  const req = new EventEmitter() as EventEmitter & {
    method: string;
    url: string;
    headers: { authorization?: string };
    socket: { remoteAddress: string };
  };
  req.method = opts.method ?? 'GET';
  req.url = opts.url ?? '/admin/api/antibot-config';
  req.headers = { authorization: `Bearer ${VALID_TOKEN}` };
  req.socket = { remoteAddress: '10.0.0.1' };
  if (opts.method === 'POST') {
    setImmediate(() => {
      if (opts.body !== undefined) req.emit('data', JSON.stringify(opts.body));
      req.emit('end');
    });
  }
  return req as unknown as IncomingMessage;
}

interface FakeResponse {
  statusCode: number;
  body: { success: boolean; data: Record<string, unknown> | null; error: string | null };
}

function fakeRes(): FakeResponse & ServerResponse {
  const res = {
    statusCode: 0,
    body: { success: false, data: null, error: null },
    writeHead(status: number) {
      this.statusCode = status;
    },
    end(data?: string) {
      this.body = data ? JSON.parse(data) : null;
    },
  };
  return res as unknown as FakeResponse & ServerResponse;
}

// A stateful stand-in for the detector behind the GameServer delegates: one
// number field whose only valid override is a finite number; every applied
// document is recorded so the rollback re-apply is observable.
function fakeGame() {
  const applied: Record<string, unknown>[] = [];
  let value = 1;
  const game = {
    antibotConfigFields: (): ConfigField[] => [
      {
        id: 'gate.kick_score',
        group: 'Gate',
        label: 'Kick score threshold',
        type: 'number',
        defaultValue: 1,
        value,
      },
    ],
    applyAntibotConfig: (overrides: Record<string, unknown>) => {
      applied.push(overrides);
      const errors: string[] = [];
      for (const [id, raw] of Object.entries(overrides)) {
        if (id !== 'gate.kick_score') errors.push(`unknown config field: ${id}`);
        else if (typeof raw !== 'number') errors.push(`${id}: expected a finite number`);
      }
      if (errors.length === 0) {
        value =
          typeof overrides['gate.kick_score'] === 'number'
            ? (overrides['gate.kick_score'] as number)
            : 1;
      }
      return { errors };
    },
  };
  return { game: game as unknown as Parameters<typeof handleAdminApi>[2], applied };
}

async function settle(res: FakeResponse): Promise<void> {
  await vi.waitFor(() => {
    expect(res.statusCode).not.toBe(0);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(accountForToken).mockResolvedValue(7);
  vi.mocked(isAdminAccount).mockResolvedValue(true);
  vi.mocked(adminRolesForAccount).mockResolvedValue({
    username: 'admin',
    roles: ['admin'],
  });
  vi.mocked(loadAntibotConfig).mockResolvedValue({ data: {}, updatedAt: null });
});

describe('GET /admin/api/antibot-config', () => {
  it('returns the detector catalog and the saved timestamp', async () => {
    const { game } = fakeGame();
    const res = fakeRes();
    vi.mocked(loadAntibotConfig).mockResolvedValue({
      data: { 'gate.kick_score': 1.5 },
      updatedAt: '2026-07-04T00:00:00.000Z',
    });
    await handleAdminApi(fakeReq(), res, game);
    expect(res.statusCode).toBe(200);
    expect(res.body.data?.updatedAt).toBe('2026-07-04T00:00:00.000Z');
    expect((res.body.data?.fields as ConfigField[])[0].id).toBe('gate.kick_score');
  });
});

describe('POST /admin/api/antibot-config', () => {
  it('applies a valid document live and persists the effective override set with its note', async () => {
    const { game, applied } = fakeGame();
    const res = fakeRes();
    await handleAdminApi(
      fakeReq({
        method: 'POST',
        body: {
          overrides: { 'gate.kick_score': 1.5 },
          note: 'Tune after calibration',
        },
      }),
      res,
      game,
    );
    await settle(res);
    expect(res.statusCode).toBe(200);
    expect(applied).toEqual([{ 'gate.kick_score': 1.5 }]);
    expect(vi.mocked(saveAntibotConfigChange)).toHaveBeenCalledWith(
      { 'gate.kick_score': 1.5 },
      7,
      'Tune after calibration',
    );
    expect((res.body.data?.fields as ConfigField[])[0].value).toBe(1.5);
    expect(res.body.data?.updatedAt).toBe('2026-07-04T00:00:01.000Z');
  });

  it('does not persist a value equal to the default', async () => {
    const { game } = fakeGame();
    const res = fakeRes();
    await handleAdminApi(
      fakeReq({ method: 'POST', body: { overrides: { 'gate.kick_score': 1 } } }),
      res,
      game,
    );
    await settle(res);
    expect(res.statusCode).toBe(200);
    expect(vi.mocked(saveAntibotConfigChange)).toHaveBeenCalledWith({}, 7, '');
  });

  it('rejects an invalid document with 400, re-applies the previous one, and saves nothing', async () => {
    const { game, applied } = fakeGame();
    const res = fakeRes();
    vi.mocked(loadAntibotConfig).mockResolvedValue({
      data: { 'gate.kick_score': 1.2 },
      updatedAt: '2026-07-04T00:00:00.000Z',
    });
    await handleAdminApi(
      fakeReq({ method: 'POST', body: { overrides: { 'no.such_field': 1 } } }),
      res,
      game,
    );
    await settle(res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toContain('unknown config field');
    // The failed document was tried, then the previous effective live state restored.
    expect(applied).toEqual([{ 'no.such_field': 1 }, {}]);
    expect(vi.mocked(saveAntibotConfigChange)).not.toHaveBeenCalled();
  });

  it('rejects a body without an overrides object', async () => {
    const { game, applied } = fakeGame();
    const res = fakeRes();
    await handleAdminApi(fakeReq({ method: 'POST', body: { overrides: [1, 2] } }), res, game);
    await settle(res);
    expect(res.statusCode).toBe(400);
    expect(applied).toEqual([]);
    expect(vi.mocked(saveAntibotConfigChange)).not.toHaveBeenCalled();
  });

  it('restores the previous live config when persistence fails', async () => {
    const { game, applied } = fakeGame();
    const res = fakeRes();
    vi.mocked(saveAntibotConfigChange).mockRejectedValueOnce(new Error('database unavailable'));
    await handleAdminApi(
      fakeReq({ method: 'POST', body: { overrides: { 'gate.kick_score': 1.5 } } }),
      res,
      game,
    );
    await settle(res);
    expect(res.statusCode).toBe(500);
    expect(applied).toEqual([{ 'gate.kick_score': 1.5 }, {}]);
  });

  it('serializes concurrent saves so live application order matches persistence order', async () => {
    let resolveFirst: ((value: { changed: boolean; updatedAt: string }) => void) | undefined;
    vi.mocked(saveAntibotConfigChange)
      .mockImplementationOnce(
        async () =>
          await new Promise((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockResolvedValueOnce({
        changed: true,
        updatedAt: '2026-07-04T00:00:02.000Z',
      });
    const { game, applied } = fakeGame();
    const firstRes = fakeRes();
    const secondRes = fakeRes();
    const first = handleAdminApi(
      fakeReq({ method: 'POST', body: { overrides: { 'gate.kick_score': 1.5 } } }),
      firstRes,
      game,
    );
    await vi.waitFor(() => expect(saveAntibotConfigChange).toHaveBeenCalledTimes(1));
    const second = handleAdminApi(
      fakeReq({ method: 'POST', body: { overrides: { 'gate.kick_score': 2 } } }),
      secondRes,
      game,
    );
    await new Promise((resolve) => setImmediate(resolve));
    expect(applied).toEqual([{ 'gate.kick_score': 1.5 }]);

    resolveFirst?.({ changed: true, updatedAt: '2026-07-04T00:00:01.000Z' });
    await Promise.all([first, second]);
    expect(applied).toEqual([{ 'gate.kick_score': 1.5 }, { 'gate.kick_score': 2 }]);
    expect(firstRes.statusCode).toBe(200);
    expect(secondRes.statusCode).toBe(200);
  });
});

describe('GET /admin/api/antibot-config/history', () => {
  it('returns the realm audit history', async () => {
    const history = [
      {
        id: 2,
        beforeData: {},
        afterData: { 'gate.kick_score': 1.5 },
        note: 'Tune after calibration',
        createdAt: '2026-07-04T00:00:01.000Z',
        adminAccountId: 7,
        adminUsername: 'admin',
      },
    ];
    vi.mocked(listAntibotConfigHistory).mockResolvedValueOnce(history);
    const { game } = fakeGame();
    const res = fakeRes();
    await handleAdminApi(fakeReq({ url: '/admin/api/antibot-config/history' }), res, game);
    expect(res.statusCode).toBe(200);
    expect(res.body.data?.entries).toEqual(history);
  });
});
