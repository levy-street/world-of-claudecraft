// Unit tests for the Content-Type 415 gate (server/http/middleware/content_type.ts):
// the log-only default (records a mismatch but never blocks), the declared-metadata
// exemptions (binary card upload, non-'api' surface, non-mutating method), the
// application/json pass cases (any case, with/without parameters), and enforce mode
// (a 415 problem+json with the stable code, the handler never reached). The
// contentTypeEnforced flag parse and the default console.warn sink are pinned too.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { compose } from '../../../server/http/compose';
import { HttpError } from '../../../server/http/errors';
import { logger } from '../../../server/http/logger';
import {
  CONTENT_TYPE_ENFORCE_ENV,
  type ContentTypeMismatch,
  contentTypeEnforced,
  createContentTypeMismatchSink,
  defaultContentTypeMismatchSink,
  withContentType,
} from '../../../server/http/middleware/content_type';
import { withErrors } from '../../../server/http/middleware/with_errors';
import { createMismatchWarnThrottle } from '../../../server/http/mismatch_warn_throttle';
import type { Ctx, Method, Middleware, RouteDef } from '../../../server/http/types';
import { fakeCtx } from '../helpers/fake_ctx';
import type { FakeRes } from '../helpers/fake_http';

/** The enforce-mode env: sets the named flag to '1'. */
const ENFORCE_ENV: NodeJS.ProcessEnv = { [CONTENT_TYPE_ENFORCE_ENV]: '1' };
/** The log-only env: the flag is absent (the shipping default). */
const LOGONLY_ENV: NodeJS.ProcessEnv = {};

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

/** Build a POST ctx (optionally) carrying a Content-Type header. */
function postCtx(contentType?: string, method: Method = 'POST'): Ctx {
  const headers = contentType === undefined ? undefined : { 'content-type': contentType };
  return fakeCtx({ method, headers });
}

/**
 * Run the gate over a request and collect any mismatch records. Returns the
 * captured records, whether the terminal handler ran, and the FakeRes.
 */
async function runGate(args: {
  route: RouteDef;
  contentType?: string;
  method?: Method;
  env: NodeJS.ProcessEnv;
}): Promise<{ records: ContentTypeMismatch[]; state: HandlerState; res: FakeRes }> {
  const records: ContentTypeMismatch[] = [];
  const state: HandlerState = { ran: false };
  const ctx = postCtx(args.contentType, args.method ?? 'POST');
  const gate = withContentType(args.route, { env: args.env, sink: (m) => records.push(m) });
  await compose([gate, terminal(state)])(ctx);
  return { records, state, res: resOf(ctx) };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('withContentType: log-only default', () => {
  it('records exactly one mismatch (enforced:false) and RUNS the handler on text/plain', async () => {
    const { records, state, res } = await runGate({
      route: makeRoute(),
      contentType: 'text/plain',
      env: LOGONLY_ENV,
    });
    expect(state.ran).toBe(true);
    expect(res.statusCode).toBe(200);
    expect(records).toHaveLength(1);
    expect(records[0]).toEqual({
      route: '/api/thing',
      method: 'POST',
      contentType: 'text/plain',
      enforced: false,
    });
  });

  it('gates every mutating method, not just POST (a DELETE mismatch records too)', async () => {
    const { records, state } = await runGate({
      route: makeRoute({ method: 'DELETE' }),
      contentType: 'text/plain',
      method: 'DELETE',
      env: LOGONLY_ENV,
    });
    expect(state.ran).toBe(true);
    expect(records).toHaveLength(1);
    expect(records[0].method).toBe('DELETE');
  });

  it('passes with ZERO records when the Content-Type header is absent', async () => {
    const { records, state } = await runGate({ route: makeRoute(), env: LOGONLY_ENV });
    expect(state.ran).toBe(true);
    expect(records).toHaveLength(0);
  });

  it('passes with ZERO records when the Content-Type header is empty', async () => {
    const { records, state } = await runGate({
      route: makeRoute(),
      contentType: '   ',
      env: LOGONLY_ENV,
    });
    expect(state.ran).toBe(true);
    expect(records).toHaveLength(0);
  });
});

describe('withContentType: application/json always passes', () => {
  const JSON_TYPES = ['application/json', 'application/json; charset=utf-8', 'Application/JSON'];
  for (const env of [LOGONLY_ENV, ENFORCE_ENV]) {
    const label = env === ENFORCE_ENV ? 'enforce' : 'log-only';
    for (const contentType of JSON_TYPES) {
      it(`passes ${contentType} with zero records in ${label} mode`, async () => {
        const { records, state, res } = await runGate({
          route: makeRoute(),
          contentType,
          env,
        });
        expect(state.ran).toBe(true);
        expect(res.statusCode).toBe(200);
        expect(records).toHaveLength(0);
      });
    }
  }
});

describe('withContentType: never gates a non-mutating method', () => {
  for (const env of [LOGONLY_ENV, ENFORCE_ENV]) {
    const label = env === ENFORCE_ENV ? 'enforce' : 'log-only';
    it(`lets a GET with text/plain through with zero records in ${label} mode`, async () => {
      const { records, state } = await runGate({
        route: makeRoute({ method: 'GET' }),
        contentType: 'text/plain',
        method: 'GET',
        env,
      });
      expect(state.ran).toBe(true);
      expect(records).toHaveLength(0);
    });

    it(`lets a HEAD with text/plain through with zero records in ${label} mode`, async () => {
      const { records, state } = await runGate({
        route: makeRoute({ method: 'GET' }),
        contentType: 'text/plain',
        method: 'HEAD',
        env,
      });
      expect(state.ran).toBe(true);
      expect(records).toHaveLength(0);
    });
  }
});

describe('withContentType: exempt by declared metadata', () => {
  for (const env of [LOGONLY_ENV, ENFORCE_ENV]) {
    const label = env === ENFORCE_ENV ? 'enforce' : 'log-only';
    it(`exempts a meta.requestBody 'binary' route from an image/png POST in ${label} mode`, async () => {
      const { records, state } = await runGate({
        route: makeRoute({ meta: { requestBody: 'binary' } }),
        contentType: 'image/png',
        env,
      });
      expect(state.ran).toBe(true);
      expect(records).toHaveLength(0);
    });

    it(`passes a non-'api' (oauth) form-encoded POST with zero records in ${label} mode`, async () => {
      const { records, state } = await runGate({
        route: makeRoute({ surface: 'oauth', path: '/oauth/token' }),
        contentType: 'application/x-www-form-urlencoded',
        env,
      });
      expect(state.ran).toBe(true);
      expect(records).toHaveLength(0);
    });

    // The three response-envelope exemption arms are live branches too: a
    // mutating /api route DECLARING a non-JSON response contract is skipped
    // entirely (no gate, no record), not merely allowed through.
    for (const envelope of ['binary', 'html', 'redirect'] as const) {
      it(`exempts a meta.envelope '${envelope}' route from a text/plain POST in ${label} mode`, async () => {
        const { records, state } = await runGate({
          route: makeRoute({ meta: { envelope } }),
          contentType: 'text/plain',
          env,
        });
        expect(state.ran).toBe(true);
        expect(records).toHaveLength(0);
      });
    }
  }
});

describe('withContentType: enforce mode', () => {
  it('rejects text/plain with a 415 problem+json and never reaches the handler', async () => {
    const records: ContentTypeMismatch[] = [];
    const state: HandlerState = { ran: false };
    const ctx = postCtx('text/plain');
    const route = makeRoute();
    // withErrors({ surface: undefined }) defaults to the problem+json serializer.
    await compose([
      withErrors({ surface: undefined }),
      withContentType(route, { env: ENFORCE_ENV, sink: (m) => records.push(m) }),
      terminal(state),
    ])(ctx);
    const res = resOf(ctx);
    expect(res.statusCode).toBe(415);
    const body = JSON.parse(res.body);
    expect(body.code).toBe('body.unsupported_media_type');
    // Pin the serialized English developer text to LITERALS: the STATUS_REASON
    // 415 title and the DETAILS sentence added for this code (the client
    // code-matcher localizes by code, but the emitted prose is still contract).
    expect(body.title).toBe('Unsupported Media Type');
    expect(body.detail).toBe('The request Content-Type must be application/json.');
    expect(state.ran).toBe(false);
    expect(records).toHaveLength(1);
    expect(records[0].enforced).toBe(true);
  });

  it('lets application/json through to the handler with a 200', async () => {
    const records: ContentTypeMismatch[] = [];
    const state: HandlerState = { ran: false };
    const ctx = postCtx('application/json');
    await compose([
      withErrors({ surface: undefined }),
      withContentType(makeRoute(), { env: ENFORCE_ENV, sink: (m) => records.push(m) }),
      terminal(state),
    ])(ctx);
    expect(resOf(ctx).statusCode).toBe(200);
    expect(state.ran).toBe(true);
    expect(records).toHaveLength(0);
  });

  // The load-bearing native-client allowance MUST hold under enforce too: a gate
  // refactor that moved the absent/empty guard below the throw would 415 every
  // client that omits Content-Type the moment the flag flips, and only these two
  // cases would catch it (the log-only arms above cannot).
  it('passes an ABSENT Content-Type with ZERO records even in enforce mode', async () => {
    const { records, state, res } = await runGate({ route: makeRoute(), env: ENFORCE_ENV });
    expect(state.ran).toBe(true);
    expect(res.statusCode).toBe(200);
    expect(records).toHaveLength(0);
  });

  it('passes an EMPTY Content-Type with ZERO records even in enforce mode', async () => {
    const { records, state, res } = await runGate({
      route: makeRoute(),
      contentType: '   ',
      env: ENFORCE_ENV,
    });
    expect(state.ran).toBe(true);
    expect(res.statusCode).toBe(200);
    expect(records).toHaveLength(0);
  });
});

describe('contentTypeEnforced: named-flag parse', () => {
  it('is true only for "1" or "true", and false otherwise', () => {
    expect(contentTypeEnforced({ [CONTENT_TYPE_ENFORCE_ENV]: '1' })).toBe(true);
    expect(contentTypeEnforced({ [CONTENT_TYPE_ENFORCE_ENV]: 'true' })).toBe(true);
    expect(contentTypeEnforced({ [CONTENT_TYPE_ENFORCE_ENV]: '0' })).toBe(false);
    expect(contentTypeEnforced({ [CONTENT_TYPE_ENFORCE_ENV]: 'false' })).toBe(false);
    expect(contentTypeEnforced({})).toBe(false);
  });

  it('pins the env-var name literal', () => {
    expect(CONTENT_TYPE_ENFORCE_ENV).toBe('API_CONTENT_TYPE_ENFORCE');
  });
});

describe('defaultContentTypeMismatchSink', () => {
  it('emits exactly one structured warn line through the logger', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    try {
      defaultContentTypeMismatchSink({
        route: '/api/thing',
        method: 'POST',
        contentType: 'text/plain',
        enforced: false,
      });
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][1]).toBe('content-type mismatch');
      expect(warn.mock.calls[0][0]).toMatchObject({
        route: '/api/thing',
        contentType: 'text/plain',
      });
    } finally {
      warn.mockRestore();
    }
  });

  it('is the sink the gate uses when none is injected (mismatch reaches the logger)', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    try {
      const state: HandlerState = { ran: false };
      const ctx = postCtx('text/plain');
      // No sink in opts: the gate falls back to defaultContentTypeMismatchSink.
      await compose([withContentType(makeRoute(), { env: LOGONLY_ENV }), terminal(state)])(ctx);
      expect(state.ran).toBe(true);
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
    }
  });
});

describe('createContentTypeMismatchSink: flood bound', () => {
  /** One mismatch record on the given route template. */
  function mismatchOn(route: string): ContentTypeMismatch {
    return { route, method: 'POST', contentType: 'text/plain', enforced: false };
  }

  it('emits at most 5 warn lines per window for one template; the tally rides the next window', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    try {
      let t = 0;
      const sink = createContentTypeMismatchSink(createMismatchWarnThrottle({ now: () => t }));
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

  it('is flood-bounded AS SHIPPED: the default sink collapses 20 mismatches to 5 lines', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    try {
      // Drives the exported default (real process-wide throttle, real clock), so a
      // revert of the default wiring to an unthrottled sink fails here. Uses a route
      // no other test sends through the default sink: its window state persists
      // across this file's tests.
      for (let i = 0; i < 20; i++) {
        defaultContentTypeMismatchSink({
          route: '/api/flood-probe',
          method: 'POST',
          contentType: 'text/plain',
          enforced: false,
        });
      }
      expect(warn).toHaveBeenCalledTimes(5);
    } finally {
      warn.mockRestore();
    }
  });

  it('bounds two different route templates independently (per-template cardinality)', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    try {
      const sink = createContentTypeMismatchSink(createMismatchWarnThrottle({ now: () => 0 }));
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

  it('never touches the enforce decision: every flooded request still 415s past the bound', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    try {
      const sink = createContentTypeMismatchSink(createMismatchWarnThrottle({ now: () => 0 }));
      const gate = withContentType(makeRoute(), { env: ENFORCE_ENV, sink });
      let rejected = 0;
      for (let i = 0; i < 8; i++) {
        try {
          await gate(postCtx('text/plain'), async () => {});
        } catch (err) {
          if (err instanceof HttpError && err.status === 415) rejected += 1;
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
