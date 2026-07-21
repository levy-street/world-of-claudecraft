// Unit tests for the cross-site Origin check (server/http/middleware/origin_check.ts):
// the log-only default (records a mismatch but never blocks), the pass-through carve-outs
// (same-origin, allowlisted native/desktop origin via the REAL default allowOrigin, an
// injected realm-origin allow, an ABSENT Origin, a non-mutating method, a non-'api'
// surface), and enforce mode (a 403 problem+json with the stable code, the handler never
// reached). The originCheckEnforced flag parse and the named default console.warn sink are
// pinned too. Every recorded mismatch is asserted field-by-field.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { compose } from '../../../server/http/compose';
import { HttpError } from '../../../server/http/errors';
import { logger } from '../../../server/http/logger';
import { defaultContentTypeMismatchSink } from '../../../server/http/middleware/content_type';
import {
  type CrossSiteMismatch,
  createCrossSiteMismatchSink,
  defaultCrossSiteMismatchSink,
  ORIGIN_CHECK_ENFORCE_ENV,
  originCheckEnforced,
  withOriginCheck,
} from '../../../server/http/middleware/origin_check';
import { withErrors } from '../../../server/http/middleware/with_errors';
import { createMismatchWarnThrottle } from '../../../server/http/mismatch_warn_throttle';
import type { Ctx, Method, Middleware, RouteDef } from '../../../server/http/types';
import { fakeCtx } from '../helpers/fake_ctx';
import type { FakeRes } from '../helpers/fake_http';

/** The enforce-mode env: sets the named flag to '1'. */
const ENFORCE_ENV: NodeJS.ProcessEnv = { [ORIGIN_CHECK_ENFORCE_ENV]: '1' };
/** The log-only env: the flag is absent (the shipping default). */
const LOGONLY_ENV: NodeJS.ProcessEnv = {};
/** Both modes, for the pass-through carve-outs that must never gate in either. */
const BOTH_ENVS: ReadonlyArray<readonly [string, NodeJS.ProcessEnv]> = [
  ['log-only', LOGONLY_ENV],
  ['enforce', ENFORCE_ENV],
];

function resOf(ctx: Ctx): FakeRes {
  return ctx.res as unknown as FakeRes;
}

/** A minimal /api POST RouteDef with a no-op handler; override any field. */
function makeRoute(overrides: Partial<RouteDef> = {}): RouteDef {
  return {
    method: 'POST',
    path: '/api/thing',
    surface: 'api',
    handler: async () => ({ ok: true }),
    ...overrides,
  };
}

/** Build a ctx with the given method plus any Origin / Host / Sec-Fetch-Site headers. */
function makeCtx(args: {
  method?: Method;
  origin?: string;
  host?: string;
  secFetchSite?: string;
}): Ctx {
  const headers: Record<string, string> = {};
  if (args.host !== undefined) headers.host = args.host;
  if (args.origin !== undefined) headers.origin = args.origin;
  if (args.secFetchSite !== undefined) headers['sec-fetch-site'] = args.secFetchSite;
  return fakeCtx({ method: args.method ?? 'POST', headers });
}

interface HandlerState {
  ran: boolean;
}

/** A terminal middleware that flags it ran and writes a 200 JSON body. */
function terminal(state: HandlerState): Middleware {
  return async (ctx) => {
    state.ran = true;
    ctx.res.writeHead(200, { 'Content-Type': 'application/json' });
    ctx.res.end('{"ok":true}');
  };
}

/**
 * Run the check directly (used for pass-through and log-only cases, which never
 * throw). Collects mismatch records and whether next() ran.
 */
async function runDirect(args: {
  route: RouteDef;
  ctx: Ctx;
  env: NodeJS.ProcessEnv;
  allowOrigin?: (origin: string) => boolean;
}): Promise<{ records: CrossSiteMismatch[]; ran: boolean }> {
  const records: CrossSiteMismatch[] = [];
  let ran = false;
  const mw = withOriginCheck(args.route, {
    env: args.env,
    sink: (m) => records.push(m),
    allowOrigin: args.allowOrigin,
  });
  await mw(args.ctx, async () => {
    ran = true;
  });
  return { records, ran };
}

/**
 * Run the check through the real [withErrors, withOriginCheck, terminal] onion
 * (used for enforce cases, where the throw is mapped to a response).
 */
async function runStack(args: {
  route: RouteDef;
  ctx: Ctx;
  env: NodeJS.ProcessEnv;
}): Promise<{ records: CrossSiteMismatch[]; ran: boolean; res: FakeRes }> {
  const records: CrossSiteMismatch[] = [];
  const state: HandlerState = { ran: false };
  await compose([
    withErrors({ surface: undefined }),
    withOriginCheck(args.route, { env: args.env, sink: (m) => records.push(m) }),
    terminal(state),
  ])(args.ctx);
  return { records, ran: state.ran, res: resOf(args.ctx) };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('withOriginCheck: pass-through carve-outs (never gated, both modes)', () => {
  for (const [label, env] of BOTH_ENVS) {
    it(`allows a same-origin POST (Origin host equals request Host) in ${label} mode`, async () => {
      const ctx = makeCtx({ origin: 'https://game.example', host: 'game.example' });
      const { records, ran } = await runDirect({ route: makeRoute(), ctx, env });
      expect(ran).toBe(true);
      expect(records).toEqual([]);
    });

    it(`allows a same-origin POST via X-Forwarded-Host in ${label} mode`, async () => {
      // isWebClientRequest compares the Origin host against the FIRST X-Forwarded-Host
      // value too; mirror that so a proxied same-origin request is not flagged.
      const ctx = fakeCtx({
        method: 'POST',
        headers: {
          origin: 'https://game.example',
          host: 'internal-upstream:8787',
          'x-forwarded-host': 'game.example, proxy.internal',
        },
      });
      const { records, ran } = await runDirect({ route: makeRoute(), ctx, env });
      expect(ran).toBe(true);
      expect(records).toEqual([]);
    });

    it(`allows the native Capacitor origin via the REAL default allowOrigin in ${label} mode`, async () => {
      // No injected allowOrigin: exercises the real allowedCorsOrigin allowlist.
      const ctx = makeCtx({ origin: 'capacitor://localhost' });
      const { records, ran } = await runDirect({ route: makeRoute(), ctx, env });
      expect(ran).toBe(true);
      expect(records).toEqual([]);
    });

    it(`allows the Electron desktop app:// origin via the REAL default allowOrigin in ${label} mode`, async () => {
      const ctx = makeCtx({ origin: 'app://worldofclaudecraft' });
      const { records, ran } = await runDirect({ route: makeRoute(), ctx, env });
      expect(ran).toBe(true);
      expect(records).toEqual([]);
    });

    it(`allows an ABSENT Origin on a POST in ${label} mode (the load-bearing allowance)`, async () => {
      const ctx = makeCtx({});
      const { records, ran } = await runDirect({ route: makeRoute(), ctx, env });
      expect(ran).toBe(true);
      expect(records).toEqual([]);
    });

    it(`never gates a GET carrying a cross-site Origin in ${label} mode`, async () => {
      const ctx = makeCtx({ method: 'GET', origin: 'https://evil.example' });
      const { records, ran } = await runDirect({
        route: makeRoute({ method: 'GET' }),
        ctx,
        env,
      });
      expect(ran).toBe(true);
      expect(records).toEqual([]);
    });

    it(`never gates a HEAD carrying a cross-site Origin in ${label} mode`, async () => {
      const ctx = makeCtx({ method: 'HEAD', origin: 'https://evil.example' });
      const { records, ran } = await runDirect({
        route: makeRoute({ method: 'GET' }),
        ctx,
        env,
      });
      expect(ran).toBe(true);
      expect(records).toEqual([]);
    });

    it(`never gates a non-'api' (oauth) POST carrying a cross-site Origin in ${label} mode`, async () => {
      const ctx = makeCtx({ origin: 'https://evil.example' });
      const { records, ran } = await runDirect({
        route: makeRoute({ surface: 'oauth', path: '/oauth/token' }),
        ctx,
        env,
      });
      expect(ran).toBe(true);
      expect(records).toEqual([]);
    });
  }
});

describe('withOriginCheck: injected allowOrigin (realm origin)', () => {
  it('allows an origin the injected allowlist accepts, and consults it with that origin', async () => {
    // REALM_ORIGINS is env-derived (empty under test), so inject a stub to keep the
    // realm-origin case deterministic; assert the stub actually decided the request.
    const seen: string[] = [];
    const ctx = makeCtx({ origin: 'https://claudemoon.example.com' });
    const { records, ran } = await runDirect({
      route: makeRoute(),
      ctx,
      env: LOGONLY_ENV,
      allowOrigin: (origin) => {
        seen.push(origin);
        return true;
      },
    });
    expect(ran).toBe(true);
    expect(records).toEqual([]);
    expect(seen).toEqual(['https://claudemoon.example.com']);
  });
});

describe('withOriginCheck: clear cross-site Origin', () => {
  it('records exactly one mismatch (enforced:false) and RUNS the handler in log-only mode', async () => {
    const ctx = makeCtx({ origin: 'https://evil.example', secFetchSite: 'cross-site' });
    const { records, ran } = await runDirect({ route: makeRoute(), ctx, env: LOGONLY_ENV });
    expect(ran).toBe(true);
    expect(records).toEqual([
      {
        route: '/api/thing',
        method: 'POST',
        origin: 'https://evil.example',
        secFetchSite: 'cross-site',
        enforced: false,
      },
    ]);
  });

  it('rejects with a 403 problem+json carrying the stable code in enforce mode', async () => {
    const ctx = makeCtx({ origin: 'https://evil.example', secFetchSite: 'cross-site' });
    const { records, ran, res } = await runStack({ route: makeRoute(), ctx, env: ENFORCE_ENV });
    expect(res.statusCode).toBe(403);
    const body = JSON.parse(res.body);
    expect(body.code).toBe('origin.cross_site');
    // Pin the serialized English developer text to LITERALS: the 403 reason
    // phrase and the DETAILS sentence added for this code (the client code-matcher
    // localizes by code, but the emitted prose is still contract).
    expect(body.title).toBe('Forbidden');
    expect(body.detail).toBe('The request origin is not allowed.');
    expect(ran).toBe(false);
    expect(records).toEqual([
      {
        route: '/api/thing',
        method: 'POST',
        origin: 'https://evil.example',
        secFetchSite: 'cross-site',
        enforced: true,
      },
    ]);
  });

  it('gates every mutating method, not just POST (a DELETE mismatch records too)', async () => {
    const ctx = makeCtx({ method: 'DELETE', origin: 'https://evil.example' });
    const { records, ran } = await runDirect({
      route: makeRoute({ method: 'DELETE' }),
      ctx,
      env: LOGONLY_ENV,
    });
    expect(ran).toBe(true);
    expect(records).toHaveLength(1);
    expect(records[0].method).toBe('DELETE');
  });

  it("treats the literal 'null' Origin as cross-site: one record log-only, 403 in enforce", async () => {
    const logCtx = makeCtx({ origin: 'null' });
    const logRun = await runDirect({ route: makeRoute(), ctx: logCtx, env: LOGONLY_ENV });
    expect(logRun.ran).toBe(true);
    expect(logRun.records).toEqual([
      {
        route: '/api/thing',
        method: 'POST',
        origin: 'null',
        secFetchSite: undefined,
        enforced: false,
      },
    ]);

    const enforceCtx = makeCtx({ origin: 'null' });
    const enforceRun = await runStack({ route: makeRoute(), ctx: enforceCtx, env: ENFORCE_ENV });
    expect(enforceRun.res.statusCode).toBe(403);
    expect(JSON.parse(enforceRun.res.body).code).toBe('origin.cross_site');
    expect(enforceRun.ran).toBe(false);
  });
});

describe('originCheckEnforced: named-flag parse', () => {
  it('is true only for "1" or "true", and false otherwise', () => {
    expect(originCheckEnforced({ [ORIGIN_CHECK_ENFORCE_ENV]: '1' })).toBe(true);
    expect(originCheckEnforced({ [ORIGIN_CHECK_ENFORCE_ENV]: 'true' })).toBe(true);
    expect(originCheckEnforced({ [ORIGIN_CHECK_ENFORCE_ENV]: '0' })).toBe(false);
    expect(originCheckEnforced({ [ORIGIN_CHECK_ENFORCE_ENV]: 'false' })).toBe(false);
    expect(originCheckEnforced({})).toBe(false);
  });

  it('pins the env-var name literal', () => {
    expect(ORIGIN_CHECK_ENFORCE_ENV).toBe('API_ORIGIN_CHECK_ENFORCE');
  });
});

describe('defaultCrossSiteMismatchSink', () => {
  it('emits exactly one structured warn line through the logger', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    try {
      defaultCrossSiteMismatchSink({
        route: '/api/thing',
        method: 'POST',
        origin: 'https://evil.example',
        secFetchSite: 'cross-site',
        enforced: false,
      });
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][1]).toBe('cross-site origin on mutating /api request');
      expect(warn.mock.calls[0][0]).toMatchObject({ origin: 'https://evil.example' });
    } finally {
      warn.mockRestore();
    }
  });

  it('is the sink the check uses when none is injected (mismatch reaches the logger)', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    try {
      let ran = false;
      const ctx = makeCtx({ origin: 'https://evil.example' });
      // No sink in opts: the check falls back to defaultCrossSiteMismatchSink.
      await withOriginCheck(makeRoute(), { env: LOGONLY_ENV })(ctx, async () => {
        ran = true;
      });
      expect(ran).toBe(true);
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
    }
  });
});

describe('createCrossSiteMismatchSink: flood bound', () => {
  /** One mismatch record on the given route template. */
  function mismatchOn(route: string): CrossSiteMismatch {
    return {
      route,
      method: 'POST',
      origin: 'https://evil.example',
      secFetchSite: 'cross-site',
      enforced: false,
    };
  }

  it('emits at most 5 warn lines per window for one template; the tally rides the next window', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    try {
      let t = 0;
      const sink = createCrossSiteMismatchSink(createMismatchWarnThrottle({ now: () => t }));
      for (let i = 0; i < 20; i++) sink(mismatchOn('/api/register'));
      // 20 same-window mismatches collapse to the default cap of 5 lines.
      expect(warn).toHaveBeenCalledTimes(5);
      // In-window lines never carry a suppressed tally.
      expect(warn.mock.calls[4][0]).not.toHaveProperty('suppressed');
      t = 60000;
      sink(mismatchOn('/api/register'));
      // The first line of the new window surfaces the 15 suppressed lines.
      expect(warn).toHaveBeenCalledTimes(6);
      expect(warn.mock.calls[5][0]).toMatchObject({ route: '/api/register', suppressed: 15 });
      // The tally rides ONLY that first line: the next admitted line omits it.
      sink(mismatchOn('/api/register'));
      expect(warn).toHaveBeenCalledTimes(7);
      expect(warn.mock.calls[6][0]).not.toHaveProperty('suppressed');
    } finally {
      warn.mockRestore();
    }
  });

  it('is flood-bounded AS SHIPPED, with window state separate from the sibling default', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    try {
      // Drives the exported default (real process-wide throttle, real clock), so a
      // revert of the default wiring to an unthrottled sink fails here. Uses a route
      // no other test sends through the default sink: its window state persists
      // across this file's tests.
      for (let i = 0; i < 20; i++) defaultCrossSiteMismatchSink(mismatchOn('/api/flood-probe'));
      expect(warn).toHaveBeenCalledTimes(5);
      // The sibling gate's default sink keeps its OWN budget on the same key: the
      // two module defaults never share one throttle instance.
      defaultContentTypeMismatchSink({
        route: '/api/flood-probe',
        method: 'POST',
        contentType: 'text/plain',
        enforced: false,
      });
      expect(warn).toHaveBeenCalledTimes(6);
    } finally {
      warn.mockRestore();
    }
  });

  it('bounds two different route templates independently (per-template cardinality)', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    try {
      const sink = createCrossSiteMismatchSink(createMismatchWarnThrottle({ now: () => 0 }));
      for (let i = 0; i < 20; i++) sink(mismatchOn('/api/register'));
      expect(warn).toHaveBeenCalledTimes(5);
      // A different template still has its own full budget in the same window.
      for (let i = 0; i < 20; i++) sink(mismatchOn('/api/login'));
      expect(warn).toHaveBeenCalledTimes(10);
      expect(warn.mock.calls[5][0]).toMatchObject({ route: '/api/login' });
    } finally {
      warn.mockRestore();
    }
  });

  it('never touches the enforce decision: every flooded request still 403s past the bound', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    try {
      const sink = createCrossSiteMismatchSink(createMismatchWarnThrottle({ now: () => 0 }));
      const check = withOriginCheck(makeRoute(), { env: ENFORCE_ENV, sink });
      let rejected = 0;
      for (let i = 0; i < 8; i++) {
        try {
          await check(makeCtx({ origin: 'https://evil.example' }), async () => {});
        } catch (err) {
          if (err instanceof HttpError && err.status === 403) rejected += 1;
        }
      }
      // All 8 rejections stand; only the warn lines are bounded.
      expect(rejected).toBe(8);
      expect(warn).toHaveBeenCalledTimes(5);
      expect(warn.mock.calls[0][0]).toMatchObject({ enforced: true });
    } finally {
      warn.mockRestore();
    }
  });
});
