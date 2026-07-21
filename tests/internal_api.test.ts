import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';

// server/internal imports server/db, which throws at import time when DATABASE_URL
// is unset (the PR-tier CI suite runs with no Postgres). This test only exercises
// the restart-countdown endpoint and never issues a query, so set a dummy URL
// before the module graph loads (the pg Pool stays lazy and never connects).
vi.hoisted(() => {
  process.env.DATABASE_URL ??= 'postgres://localhost:5432/woc_test';
});

import { handleInternalApi } from '../server/internal';

function fakeReq(opts: { method?: string; url?: string; secret?: string } = {}) {
  const req: any = new EventEmitter();
  req.method = opts.method ?? 'POST';
  req.url = opts.url ?? '/internal/restart-countdown';
  req.headers = opts.secret ? { 'x-woc-deploy-secret': opts.secret } : {};
  return req;
}

function fakeRes() {
  const res: any = {
    statusCode: 0,
    body: null as any,
    writeHead(status: number) {
      this.statusCode = status;
    },
    end(data?: string) {
      this.body = data ? JSON.parse(data) : null;
    },
  };
  return res;
}

describe('internal api', () => {
  const previousSecret = process.env.RESTART_COUNTDOWN_SECRET;

  afterEach(() => {
    if (previousSecret === undefined) delete process.env.RESTART_COUNTDOWN_SECRET;
    else process.env.RESTART_COUNTDOWN_SECRET = previousSecret;
    vi.clearAllMocks();
  });

  it('rejects restart countdown requests when the server secret is not configured', async () => {
    delete process.env.RESTART_COUNTDOWN_SECRET;
    const res = fakeRes();

    await handleInternalApi(fakeReq({ secret: 'deploy-secret' }), res, {
      startRestartCountdown: vi.fn(),
    } as any);

    expect(res.statusCode).toBe(404);
    expect(res.body.error).toBe('unknown endpoint');
  });

  it('rejects restart countdown requests with a missing or invalid deploy secret', async () => {
    process.env.RESTART_COUNTDOWN_SECRET = 'deploy-secret';
    const res = fakeRes();

    await handleInternalApi(fakeReq({ secret: 'wrong' }), res, {
      startRestartCountdown: vi.fn(),
    } as any);

    expect(res.statusCode).toBe(401);
    expect(res.body.error).toBe('not authenticated');
  });

  it('starts the restart countdown with a valid deploy secret', async () => {
    process.env.RESTART_COUNTDOWN_SECRET = 'deploy-secret';
    const game = {
      startRestartCountdown: vi.fn(() => ({
        started: true,
        active: true,
        totalSeconds: 600,
        remainingSeconds: 600,
      })),
    };
    const res = fakeRes();

    await handleInternalApi(fakeReq({ secret: 'deploy-secret' }), res, game as any);

    expect(res.statusCode).toBe(200);
    expect(res.body.data.totalSeconds).toBe(600);
    expect(game.startRestartCountdown).toHaveBeenCalledTimes(1);
  });

  it('returns conflict when a restart countdown is already active', async () => {
    process.env.RESTART_COUNTDOWN_SECRET = 'deploy-secret';
    const game = {
      startRestartCountdown: vi.fn(() => ({
        started: false,
        active: true,
        totalSeconds: 600,
        remainingSeconds: 540,
      })),
    };
    const res = fakeRes();

    await handleInternalApi(fakeReq({ secret: 'deploy-secret' }), res, game as any);

    expect(res.statusCode).toBe(409);
    expect(res.body.data.remainingSeconds).toBe(540);
  });
});
