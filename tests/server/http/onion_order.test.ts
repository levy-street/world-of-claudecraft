// Onion-order integration test for the pipeline middleware set. It composes the
// real middlewares in the ONE canonical order the dispatcher mounts them in
// (plus the global origin/content-type hardening gates, which dispatch.ts
// inserts right after the metric hook, ahead of every route-local frame):
//
//   withErrors -> metric hook -> originCheck -> contentType -> requestId
//     -> withCors -> rateLimit(ip) -> withBody -> requireAccount
//     -> rateLimit(ip+account) -> handler
//
// and pins both the sequence and the load-bearing ordering guarantees: the
// IP-keyed limit rejects BEFORE the body is parsed or the account resolved
// (cheap-reject-first), requireAccount populates ctx.account BEFORE the
// account-keyed limiter reads it, withCors sets headers BEFORE a downstream
// throw so a 429 still carries CORS, and the metric hook (inside withErrors)
// observes the FINAL mapped status. Capture probes only RECORD state; they never
// assert inside the onion, so withErrors cannot swallow a test assertion.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { compose } from '../../../server/http/compose';
import { currentReqId } from '../../../server/http/context';
import { withBody } from '../../../server/http/middleware/body';
import {
  type ContentTypeMismatch,
  withContentType,
} from '../../../server/http/middleware/content_type';
import { withCors } from '../../../server/http/middleware/cors';
import {
  type MetricEvent,
  type MetricSink,
  withMetrics,
} from '../../../server/http/middleware/metric_sink';
import {
  type CrossSiteMismatch,
  withOriginCheck,
} from '../../../server/http/middleware/origin_check';
import {
  CARD_UPLOAD_POLICY,
  PUBLIC_READ_POLICY,
  type RateLimitPolicy,
  rateLimit,
} from '../../../server/http/middleware/rate_limit';
import { withRequestId } from '../../../server/http/middleware/request_id';
import { requireAccount } from '../../../server/http/middleware/require_account';
import { withErrors } from '../../../server/http/middleware/with_errors';
import type { Ctx, Middleware, RouteDef } from '../../../server/http/types';
import {
  resetCardUploadRateLimits,
  resetPublicReadRateLimits,
  resetRateLimitClock,
  setRateLimitClock,
} from '../../../server/ratelimit';
import { fakeCtx } from '../helpers/fake_ctx';
import { type FakeRes, makeReq } from '../helpers/fake_http';

const ROUTE = '/api/probe';
const ORIGIN = 'https://example.test';
const PINNED = 1_000_000;

// The matched RouteDef the global gates close over (dispatch.ts builds them
// per matched route). Plain 'api' surface, no exemption metadata, so both gates
// actively inspect the probe request.
const GATE_ROUTE: RouteDef = {
  method: 'POST',
  path: ROUTE,
  surface: 'api',
  handler: async () => undefined,
};

/** A stub that resolves any bearer token to a full-scope account. */
const okLookup = async () => ({ accountId: 1, scope: 'full' as const });
/** A stub moderation status for an account in good standing. */
const okModeration = async () => ({
  locked: false,
  banned: false,
  suspendedUntil: null,
  reason: '',
  message: '',
  chatMutedUntil: null,
  chatStrikes: 0,
});

/** Read the FakeRes backing a fakeCtx so we can assert on the captured result. */
function resOf(ctx: Ctx): FakeRes {
  return ctx.res as unknown as FakeRes;
}

/** A POST ctx with a JSON body plus a bearer token and an Origin, body unset until withBody runs. */
function buildCtx(): Ctx {
  const req = makeReq({
    method: 'POST',
    url: ROUTE,
    headers: {
      authorization: `Bearer ${'a'.repeat(64)}`,
      origin: ORIGIN,
      'content-type': 'application/json',
    },
    body: { hello: 'world' },
  });
  return fakeCtx({ method: 'POST', url: ROUTE, req });
}

interface StackOpts {
  ipPolicy: RateLimitPolicy;
  sink: MetricSink;
  clock: () => number;
  seq: string[];
  captured: Record<string, unknown>;
  onHandler: (ctx: Ctx) => void;
  originRecords: CrossSiteMismatch[];
  contentTypeRecords: ContentTypeMismatch[];
}

/**
 * The ONE definition of the canonical onion order. Both tests build from here so
 * a reorder breaks the sequence assertion. Capture probes sit between the real
 * middlewares and only record state (never assert), so an ordering regression
 * shows up as a state-capture or sequence mismatch, not a swallowed throw.
 */
function canonicalStack(opts: StackOpts): Middleware[] {
  const { seq, captured } = opts;
  const probe =
    (label: string, capture?: (ctx: Ctx) => void): Middleware =>
    async (ctx, next) => {
      seq.push(label);
      capture?.(ctx);
      await next();
    };
  return [
    withErrors({ surface: 'problem' }),
    withMetrics(opts.sink, ROUTE, opts.clock),
    // The global gates, in dispatch.ts's mounted order (origin first,
    // both ahead of every route-local frame). Log-only by default (env {}), so
    // they record and pass through; the probes prove nothing downstream is lost.
    withOriginCheck(GATE_ROUTE, { sink: (m) => opts.originRecords.push(m) }),
    probe('origin'),
    withContentType(GATE_ROUTE, { sink: (m) => opts.contentTypeRecords.push(m) }),
    probe('content-type'),
    withRequestId(),
    probe('reqId', (ctx) => {
      captured.reqIdMatch = currentReqId() === ctx.reqId;
    }),
    withCors('api', () => true),
    probe('cors', (ctx) => {
      captured.acao = ctx.res.getHeader('access-control-allow-origin');
    }),
    rateLimit(opts.ipPolicy),
    probe('ip-limit', (ctx) => {
      captured.bodyAtIpLimit = ctx.body;
    }),
    withBody(),
    probe('body', (ctx) => {
      captured.bodyAfter = ctx.body;
    }),
    requireAccount({ scope: 'full', lookupToken: okLookup, moderationStatus: okModeration }),
    probe('auth', (ctx) => {
      captured.accountAfter = ctx.account;
    }),
    rateLimit(CARD_UPLOAD_POLICY),
    probe('acct-limit'),
    async (ctx) => {
      seq.push('handler');
      opts.onHandler(ctx);
    },
  ];
}

beforeEach(() => {
  setRateLimitClock(() => PINNED);
  resetPublicReadRateLimits();
  resetCardUploadRateLimits();
});

afterEach(() => {
  resetRateLimitClock();
  resetPublicReadRateLimits();
  resetCardUploadRateLimits();
});

describe('onion order: successful request', () => {
  it('runs the middlewares in the canonical sequence and records the final status', async () => {
    const seq: string[] = [];
    const captured: Record<string, unknown> = {};
    const events: MetricEvent[] = [];
    const sink: MetricSink = { record: (e) => events.push(e) };
    let clockCalls = 0;
    const clock = () => (clockCalls++ === 0 ? 1000 : 1050);
    const ctx = buildCtx();
    let handlerRan = false;
    const originRecords: CrossSiteMismatch[] = [];
    const contentTypeRecords: ContentTypeMismatch[] = [];

    const stack = canonicalStack({
      ipPolicy: PUBLIC_READ_POLICY,
      sink,
      clock,
      seq,
      captured,
      onHandler: (c) => {
        handlerRan = true;
        c.res.writeHead(200, { 'Content-Type': 'application/json' });
        c.res.end('{"ok":true}');
      },
      originRecords,
      contentTypeRecords,
    });
    await compose(stack)(ctx);

    // Canonical sequence, outermost to innermost.
    expect(seq).toEqual([
      'origin',
      'content-type',
      'reqId',
      'cors',
      'ip-limit',
      'body',
      'auth',
      'acct-limit',
      'handler',
    ]);
    expect(handlerRan).toBe(true);
    expect(resOf(ctx).statusCode).toBe(200);

    // The global gates in LOG-ONLY mode: the probe Origin is neither
    // same-origin (no Host on the fake req) nor allowlisted, so the origin gate
    // RECORDED the mismatch yet every downstream stage still ran (the 200 above);
    // the JSON Content-Type is a match, so the 415 gate recorded nothing.
    expect(originRecords).toHaveLength(1);
    expect(originRecords[0]).toMatchObject({
      route: ROUTE,
      method: 'POST',
      origin: ORIGIN,
      enforced: false,
    });
    expect(contentTypeRecords).toEqual([]);

    // State transitions prove each stage landed before the next.
    expect(captured.reqIdMatch).toBe(true); // requestId bound the ALS before downstream
    expect(captured.acao).toBe(ORIGIN); // withCors reflected the origin before the body
    expect(captured.bodyAtIpLimit).toBeUndefined(); // rateLimit(ip) ran BEFORE withBody
    expect(captured.bodyAfter).toEqual({ hello: 'world' }); // withBody parsed before auth
    expect(captured.accountAfter).toEqual({ accountId: 1, scope: 'full' }); // auth before acct-limit

    // The metric hook, inside withErrors, saw the final status and full duration.
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ route: ROUTE, method: 'POST', status: 200, durationMs: 50 });
  });
});

describe('onion order: cheap-reject-first', () => {
  it('rejects at rateLimit(ip) before the body or account, and withCors + withErrors still shape the 429', async () => {
    const seq: string[] = [];
    const captured: Record<string, unknown> = {};
    const events: MetricEvent[] = [];
    const sink: MetricSink = { record: (e) => events.push(e) };
    const ctx = buildCtx();
    let handlerRan = false;
    const blockIp: RateLimitPolicy = {
      name: 'ip-block',
      keyClass: 'ip',
      limit: 60,
      windowSeconds: 60,
      // tier-1 always rejects; tier2 'none' keeps this onion-order probe independent
      // of the pg store (the reject is the point, not the backstop).
      tier1: () => ({ allowed: false, remaining: 0, resetSeconds: 60 }),
      tier2: 'none',
    };

    const stack = canonicalStack({
      ipPolicy: blockIp,
      sink,
      clock: () => 0,
      seq,
      captured,
      onHandler: (c) => {
        handlerRan = true;
        c.res.writeHead(200);
        c.res.end();
      },
      originRecords: [],
      contentTypeRecords: [],
    });
    await compose(stack)(ctx);

    // Stopped at rateLimit(ip): the ip-limit probe, body, auth, and handler never
    // ran. The log-only global gates upstream passed the request through.
    expect(seq).toEqual(['origin', 'content-type', 'reqId', 'cors']);
    expect(handlerRan).toBe(false);
    expect(ctx.body).toBeUndefined();
    expect(ctx.account).toBeUndefined();

    // withErrors (outermost) mapped a single 429 carrying the stable code.
    expect(resOf(ctx).statusCode).toBe(429);
    expect(JSON.parse(resOf(ctx).body).code).toBe('rate_limit.exceeded');
    // withCors set the header BEFORE the throw, so the 429 still carries CORS.
    expect(resOf(ctx).getHeader('access-control-allow-origin')).toBe(ORIGIN);
    // The metric hook derived and recorded the mapped 429.
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ route: ROUTE, method: 'POST', status: 429 });
  });
});
