// Unit tests for the generic BOLA loader middleware
// (server/http/middleware/require_owned.ts): the load-then-authorize,
// scope-before-find seam the owner-gated :id routes mount after their auth guard.
// Driven directly (no compose/onion runtime): build a requireOwned middleware
// with an injected fake loader/deny-log and call it with a fakeCtx + a next spy.
//
// The load-bearing property under test is anti-enumeration: a cross-account id
// (owned by ANOTHER account) and a truly-absent id both make the account-scoped
// loader return null, so the observable output (the 404 body AND the deny-log
// shape) must be byte-identical, leaking no cross-account existence signal.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type AttackSignalSink,
  noopAttackSignalSink,
  setAttackSignalSink,
} from '../../../server/http/attack_signals';
import { HttpError } from '../../../server/http/errors';
import { logger } from '../../../server/http/logger';
import { requireOwned } from '../../../server/http/middleware/require_owned';
import type { Ctx, Next } from '../../../server/http/types';
import { fakeCtx } from '../helpers/fake_ctx';
import type { FakeRes } from '../helpers/fake_http';

/** Read the FakeRes backing a fakeCtx so we can assert on the captured result. */
function resOf(ctx: Ctx): FakeRes {
  return ctx.res as unknown as FakeRes;
}

/** A no-op next() spy typed as Next; its call count is the "did we continue" signal. */
function makeNext(): Next {
  return vi.fn(async () => {});
}

/**
 * The exact, documented key set of a BolaDenyEvent (sorted). The deny-log must
 * carry ONLY these: no `exists` / `otherAccount` field that could leak whether
 * the row exists for another account.
 */
const DENY_EVENT_KEYS = [
  'accountId',
  'event',
  'method',
  'path',
  'reqId',
  'requestedId',
  'resource',
];

describe('requireOwned: owned hit', () => {
  it('stashes the loaded row on ctx.state, calls next once, and writes nothing', async () => {
    const row = { id: 5, accountId: 7, name: 'Thrall' };
    const load = vi.fn().mockResolvedValue(row);
    const denyLog = vi.fn();
    const mw = requireOwned({
      resource: 'character',
      param: 'id',
      load,
      notFoundBody: { error: 'character not found' },
      denyLog,
    });
    const ctx = fakeCtx({ account: { accountId: 7, scope: 'full' }, params: { id: '5' } });
    const res = resOf(ctx);
    const next = makeNext();

    await mw(ctx, next);

    // The loader was called account-scoped, with the DECODED numeric id (5, not '5').
    expect(load).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledWith(7, 5);
    // The authorized row is stashed under the resource key for the handler.
    expect(ctx.state.get('character')).toBe(row);
    // We continued down the onion; no denial fired; nothing was written to res.
    expect(next).toHaveBeenCalledTimes(1);
    expect(denyLog).not.toHaveBeenCalled();
    expect(res.headersSent).toBe(false);
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('');
  });
});

describe('requireOwned: miss (cross-account or absent)', () => {
  it('writes the per-route 404 body, does NOT call next, and deny-logs a leak-free event', async () => {
    const load = vi.fn().mockResolvedValue(null);
    const denyLog = vi.fn();
    const mw = requireOwned({
      resource: 'character',
      param: 'id',
      load,
      notFoundBody: { error: 'character not found' },
      denyLog,
    });
    const ctx = fakeCtx({
      method: 'DELETE',
      path: '/api/characters/5',
      account: { accountId: 7, scope: 'full' },
      params: { id: '5' },
    });
    const res = resOf(ctx);
    const next = makeNext();

    await mw(ctx, next);

    expect(load).toHaveBeenCalledTimes(1);
    expect(next).not.toHaveBeenCalled();
    // The 404 carries this route's exact legacy { error } body, byte-for-byte.
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body)).toEqual({ error: 'character not found' });
    expect(res.body).toBe(JSON.stringify({ error: 'character not found' }));

    // Exactly one structured deny event, carrying only the caller's own request.
    expect(denyLog).toHaveBeenCalledTimes(1);
    const event = denyLog.mock.calls[0][0];
    expect(event.event).toBe('bola_denied');
    expect(event.resource).toBe('character');
    expect(event.method).toBe('DELETE');
    expect(event.path).toBe('/api/characters/5');
    expect(event.accountId).toBe(7);
    expect(event.requestedId).toBe(5);
    // The event keys are EXACTLY the documented set: no cross-account existence
    // signal (no `exists` / `otherAccount` field).
    expect(Object.keys(event).sort()).toEqual(DENY_EVENT_KEYS);
    expect(event).not.toHaveProperty('exists');
    expect(event).not.toHaveProperty('otherAccount');
  });

  it('uses the per-route notFoundBody (a different route emits a different body)', async () => {
    // Silence the default deny sink (now through the logger) for this body-only case.
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    try {
      const load = vi.fn().mockResolvedValue(null);
      const mw = requireOwned({
        resource: 'auction',
        param: 'id',
        load,
        notFoundBody: { error: 'not found' },
      });
      const ctx = fakeCtx({ account: { accountId: 7, scope: 'full' }, params: { id: '5' } });
      const res = resOf(ctx);
      const next = makeNext();

      await mw(ctx, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(404);
      expect(JSON.parse(res.body)).toEqual({ error: 'not found' });
      expect(res.body).toBe(JSON.stringify({ error: 'not found' }));
    } finally {
      warnSpy.mockRestore();
    }
  });
});

describe('requireOwned: anti-enumeration equivalence', () => {
  it('produces a byte-identical 404 body and deny-log for a cross-account vs a truly-absent id', async () => {
    const notFoundBody = { error: 'character not found' };
    // Drive the SAME config for the SAME requested id twice: the account-scoped
    // loader returns null in both realities (id owned by another account, and id
    // does not exist), so the observable output must be indistinguishable.
    const drive = async (load: (accountId: number, id: number) => Promise<unknown>) => {
      const denyLog = vi.fn();
      const mw = requireOwned({ resource: 'character', param: 'id', load, notFoundBody, denyLog });
      const ctx = fakeCtx({
        method: 'DELETE',
        path: '/api/characters/5',
        account: { accountId: 7, scope: 'full' },
        params: { id: '5' },
      });
      const res = resOf(ctx);
      const next = vi.fn(async () => {});
      await mw(ctx, next);
      return {
        status: res.statusCode,
        body: res.body,
        event: denyLog.mock.calls[0][0],
        nextCalls: next.mock.calls.length,
      };
    };

    // Case A: id 5 EXISTS but belongs to another account -> account-scoped loader returns null.
    const crossAccount = await drive(vi.fn().mockResolvedValue(null));
    // Case B: id 5 is TRULY ABSENT -> loader returns null.
    const absent = await drive(vi.fn().mockResolvedValue(null));

    expect(crossAccount.status).toBe(404);
    expect(absent.status).toBe(404);
    // Byte-identical response body and identical deny-log shape prove the two
    // cases are indistinguishable to any observer.
    expect(crossAccount.body).toBe(absent.body);
    expect(crossAccount.event).toEqual(absent.event);
    expect(crossAccount.nextCalls).toBe(0);
    expect(absent.nextCalls).toBe(0);
  });
});

describe('requireOwned: non-numeric / non-positive :id (422 decode failure)', () => {
  // Each id is rejected by num({ int, min: 1 }) BEFORE any DB call: the middleware
  // throws the raw decode failure { ok: false, issues } (the pipeline maps it to
  // 422), the loader is never called, next never runs, and res is untouched.
  const badIds = ['abc', '', '1.5', '0', '-3'];
  for (const id of badIds) {
    it(`throws a decode failure and never calls load for :id ${JSON.stringify(id)}`, async () => {
      const load = vi.fn().mockResolvedValue({ id: 1 });
      const mw = requireOwned({
        resource: 'character',
        param: 'id',
        load,
        notFoundBody: { error: 'character not found' },
      });
      const ctx = fakeCtx({ account: { accountId: 7, scope: 'full' }, params: { id } });
      const res = resOf(ctx);
      const next = makeNext();

      const err = await mw(ctx, next).then(
        () => {
          throw new Error('expected requireOwned to reject on a bad id');
        },
        (e) => e,
      );

      expect(err.ok).toBe(false);
      expect(Array.isArray(err.issues)).toBe(true);
      expect(err.issues.length).toBeGreaterThan(0);
      // Rejected before touching the DB or continuing the onion; nothing written.
      expect(load).not.toHaveBeenCalled();
      expect(next).not.toHaveBeenCalled();
      expect(res.headersSent).toBe(false);
      expect(res.body).toBe('');
    });
  }
});

describe('requireOwned: missing account (composition bug)', () => {
  it('throws HttpError(500, internal.error) when ctx.account is undefined, before any load', async () => {
    const load = vi.fn().mockResolvedValue({ id: 1 });
    const mw = requireOwned({
      resource: 'character',
      param: 'id',
      load,
      notFoundBody: { error: 'character not found' },
    });
    // A well-formed id, but no account: the loader was mounted ahead of auth.
    const ctx = fakeCtx({ params: { id: '5' } });
    const next = makeNext();

    const err = await mw(ctx, next).then(
      () => {
        throw new Error('expected requireOwned to reject without an account');
      },
      (e) => e,
    );

    expect(err).toBeInstanceOf(HttpError);
    expect(err.status).toBe(500);
    expect(err.code).toBe('internal.error');
    expect(load).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });
});

describe('requireOwned: default deny log', () => {
  it('emits one structured warn line through the logger on a miss when no denyLog is injected', async () => {
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    try {
      const load = vi.fn().mockResolvedValue(null);
      const mw = requireOwned({
        resource: 'character',
        param: 'id',
        load,
        notFoundBody: { error: 'character not found' },
      });
      const ctx = fakeCtx({ account: { accountId: 7, scope: 'full' }, params: { id: '5' } });
      const res = resOf(ctx);
      const next = makeNext();

      await mw(ctx, next);

      expect(res.statusCode).toBe(404);
      expect(warnSpy).toHaveBeenCalledTimes(1);
      // The default sink emits ONE structured deny line, never the player body.
      expect(warnSpy.mock.calls[0][1]).toBe('bola_denied');
      const fields = warnSpy.mock.calls[0][0] as Record<string, unknown>;
      expect(fields.event).toBe('bola_denied');
      expect(fields.resource).toBe('character');
      expect(fields.accountId).toBe(7);
    } finally {
      warnSpy.mockRestore();
    }
  });
});

describe('requireOwned: bola_denied_total attack-signal counter', () => {
  // A recording fake AttackSignalSink capturing the route LABELS bolaDenied is called
  // with, installed process-wide for the block and restored to the no-op after each.
  let recordedRoutes: string[];
  beforeEach(() => {
    recordedRoutes = [];
    const fake: AttackSignalSink = {
      rateLimitHit() {},
      authFailure() {},
      bolaDenied(route: string) {
        recordedRoutes.push(route);
      },
      pgLimiterWrite() {},
    };
    setAttackSignalSink(fake);
  });
  afterEach(() => {
    setAttackSignalSink(noopAttackSignalSink);
  });

  it('increments once with the :param route TEMPLATE (never the concrete path) on a miss', async () => {
    const load = vi.fn().mockResolvedValue(null);
    const denyLog = vi.fn();
    const mw = requireOwned({
      resource: 'character',
      param: 'id',
      load,
      notFoundBody: { error: 'character not found' },
      denyLog,
    });
    const ctx = fakeCtx({
      method: 'DELETE',
      route: '/api/characters/:id',
      url: '/api/characters/42',
      account: { accountId: 7, scope: 'full' },
      params: { id: '42' },
    });
    const next = makeNext();

    await mw(ctx, next);

    // Exactly one counter increment, labeled with the route TEMPLATE.
    expect(recordedRoutes).toEqual(['/api/characters/:id']);
    // And NEVER the concrete request path (which would leak the requested id and
    // explode the label cardinality).
    expect(recordedRoutes[0]).not.toBe('/api/characters/42');
  });

  it('records nothing on a successful (owned) load', async () => {
    const load = vi.fn().mockResolvedValue({ id: 42, accountId: 7 });
    const mw = requireOwned({
      resource: 'character',
      param: 'id',
      load,
      notFoundBody: { error: 'character not found' },
    });
    const ctx = fakeCtx({
      route: '/api/characters/:id',
      url: '/api/characters/42',
      account: { accountId: 7, scope: 'full' },
      params: { id: '42' },
    });
    const next = makeNext();

    await mw(ctx, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(recordedRoutes).toEqual([]);
  });

  it("labels the counter 'unknown' when the ctx carries no matched route", async () => {
    const load = vi.fn().mockResolvedValue(null);
    const denyLog = vi.fn();
    const mw = requireOwned({
      resource: 'character',
      param: 'id',
      load,
      notFoundBody: { error: 'character not found' },
      denyLog,
    });
    // No `route` override models a ctx built without a route match.
    const ctx = fakeCtx({ account: { accountId: 7, scope: 'full' }, params: { id: '42' } });
    const next = makeNext();

    await mw(ctx, next);

    expect(recordedRoutes).toEqual(['unknown']);
  });

  it('records nothing when a non-numeric :id is rejected (422) before any load', async () => {
    const load = vi.fn().mockResolvedValue({ id: 1 });
    const mw = requireOwned({
      resource: 'character',
      param: 'id',
      load,
      notFoundBody: { error: 'character not found' },
    });
    const ctx = fakeCtx({
      route: '/api/characters/:id',
      account: { accountId: 7, scope: 'full' },
      params: { id: 'abc' },
    });
    const next = makeNext();

    // The validator throws the decode failure (422) before any DB call, so the
    // deny counter (a load-authorize miss signal only) must not fire.
    await expect(mw(ctx, next)).rejects.toBeDefined();

    expect(load).not.toHaveBeenCalled();
    expect(recordedRoutes).toEqual([]);
  });
});
