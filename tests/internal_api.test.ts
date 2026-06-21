import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
    writeHead(status: number) { this.statusCode = status; },
    end(data?: string) { this.body = data ? JSON.parse(data) : null; },
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

    await handleInternalApi(fakeReq({ secret: 'deploy-secret' }), res, { startRestartCountdown: vi.fn() } as any);

    expect(res.statusCode).toBe(404);
    expect(res.body.error).toBe('unknown endpoint');
  });

  it('rejects restart countdown requests with a missing or invalid deploy secret', async () => {
    process.env.RESTART_COUNTDOWN_SECRET = 'deploy-secret';
    const res = fakeRes();

    await handleInternalApi(fakeReq({ secret: 'wrong' }), res, { startRestartCountdown: vi.fn() } as any);

    expect(res.statusCode).toBe(401);
    expect(res.body.error).toBe('not authenticated');
  });

  it('starts the restart countdown with a valid deploy secret', async () => {
    process.env.RESTART_COUNTDOWN_SECRET = 'deploy-secret';
    const game = { startRestartCountdown: vi.fn(() => ({ started: true, active: true, totalSeconds: 600, remainingSeconds: 600 })) };
    const res = fakeRes();

    await handleInternalApi(fakeReq({ secret: 'deploy-secret' }), res, game as any);

    expect(res.statusCode).toBe(200);
    expect(res.body.data.totalSeconds).toBe(600);
    expect(game.startRestartCountdown).toHaveBeenCalledTimes(1);
  });

  it('returns conflict when a restart countdown is already active', async () => {
    process.env.RESTART_COUNTDOWN_SECRET = 'deploy-secret';
    const game = { startRestartCountdown: vi.fn(() => ({ started: false, active: true, totalSeconds: 600, remainingSeconds: 540 })) };
    const res = fakeRes();

    await handleInternalApi(fakeReq({ secret: 'deploy-secret' }), res, game as any);

    expect(res.statusCode).toBe(409);
    expect(res.body.data.remainingSeconds).toBe(540);
  });
});

describe('internal api — $WOC season ops', () => {
  const previousSecret = process.env.WOC_OPS_SECRET;
  const game = { startRestartCountdown: vi.fn() } as any;
  const fakeSeasonOps = () => ({ openSeason: vi.fn(async () => {}), closeSeason: vi.fn(async () => {}) });

  afterEach(() => {
    if (previousSecret === undefined) delete process.env.WOC_OPS_SECRET;
    else process.env.WOC_OPS_SECRET = previousSecret;
    vi.clearAllMocks();
  });

  function seasonReq(url: string, secret?: string) {
    const req: any = new EventEmitter();
    req.method = 'POST';
    req.url = url;
    req.headers = secret ? { 'x-woc-ops-secret': secret } : {};
    return req;
  }
  // readBody attaches its stream listeners synchronously inside handleInternalApi
  // (before the await suspends), so feeding the body right after the call works.
  async function call(req: any, res: any, ops: any, body?: unknown): Promise<void> {
    const p = handleInternalApi(req, res, game, ops);
    if (body !== undefined) { req.emit('data', Buffer.from(JSON.stringify(body))); req.emit('end'); }
    await p;
  }

  it('404s the season endpoint when season ops are not wired in', async () => {
    process.env.WOC_OPS_SECRET = 'ops';
    const res = fakeRes();
    await call(seasonReq('/internal/woc/season/open', 'ops'), res, undefined);
    expect(res.statusCode).toBe(404);
  });

  it('404s when WOC_OPS_SECRET is not configured', async () => {
    delete process.env.WOC_OPS_SECRET;
    const res = fakeRes();
    await call(seasonReq('/internal/woc/season/open', 'ops'), res, fakeSeasonOps());
    expect(res.statusCode).toBe(404);
  });

  it('401s on a wrong ops secret', async () => {
    process.env.WOC_OPS_SECRET = 'ops';
    const ops = fakeSeasonOps();
    const res = fakeRes();
    await call(seasonReq('/internal/woc/season/open', 'wrong'), res, ops);
    expect(res.statusCode).toBe(401);
    expect(ops.openSeason).not.toHaveBeenCalled();
  });

  it('opens a season with a valid secret + body', async () => {
    process.env.WOC_OPS_SECRET = 'ops';
    const ops = fakeSeasonOps();
    const res = fakeRes();
    await call(seasonReq('/internal/woc/season/open', 'ops'), res, ops, { seasonId: 4, label: 'S4', endsAt: '2026-07-01T00:00:00.000Z' });
    expect(res.statusCode).toBe(200);
    expect(res.body.data.seasonId).toBe(4);
    expect(ops.openSeason).toHaveBeenCalledWith({ seasonId: 4, label: 'S4', endsAt: '2026-07-01T00:00:00.000Z' });
  });

  it('rejects a non-integer seasonId with 400 (no DB write)', async () => {
    process.env.WOC_OPS_SECRET = 'ops';
    const ops = fakeSeasonOps();
    const res = fakeRes();
    await call(seasonReq('/internal/woc/season/open', 'ops'), res, ops, { label: 'no id' });
    expect(res.statusCode).toBe(400);
    expect(ops.openSeason).not.toHaveBeenCalled();
  });

  it('rejects a malformed endsAt with 400', async () => {
    process.env.WOC_OPS_SECRET = 'ops';
    const ops = fakeSeasonOps();
    const res = fakeRes();
    await call(seasonReq('/internal/woc/season/open', 'ops'), res, ops, { seasonId: 1, endsAt: 'not-a-date' });
    expect(res.statusCode).toBe(400);
    expect(ops.openSeason).not.toHaveBeenCalled();
  });

  it('closes a season with a valid secret + body', async () => {
    process.env.WOC_OPS_SECRET = 'ops';
    const ops = fakeSeasonOps();
    const res = fakeRes();
    await call(seasonReq('/internal/woc/season/close', 'ops'), res, ops, { seasonId: 4 });
    expect(res.statusCode).toBe(200);
    expect(ops.closeSeason).toHaveBeenCalledWith(4);
  });
});
