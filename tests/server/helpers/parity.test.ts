// Self-tests for the parity driver. They prove: identical dispatchers report
// parity; a 404-vs-405 pair flags a HIGH-severity status divergence; and the
// per-pass limiter reset prevents a pass-1 trip from bleeding into pass 2.
import { afterEach, describe, expect, it } from 'vitest';
import {
  authFailureCount,
  rateLimited,
  recordAuthFailure,
  resetAuthFailures,
  resetRateLimitClock,
  resetRateLimits,
} from '../../../server/ratelimit';
import { makeReq } from './fake_http';
import type { Dispatch } from './golden';
import { type ParityFixture, runParity } from './parity';

const jsonDispatch =
  (status: number, body: unknown): Dispatch =>
  (_req, res) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };

const fixture = (name = 'root'): ParityFixture => ({
  name,
  req: () => makeReq({ url: '/api/x' }),
});

afterEach(() => {
  // Keep the shared limiter maps isolated from sibling test files.
  resetRateLimits();
  resetAuthFailures();
  resetRateLimitClock();
});

describe('runParity', () => {
  it('reports parity for two identical dispatchers', async () => {
    const dispatch = jsonDispatch(200, { ok: true });
    const report = await runParity({
      oldDispatch: dispatch,
      newDispatch: dispatch,
      fixtures: [fixture()],
    });
    expect(report.ok).toBe(true);
    expect(report.divergences).toHaveLength(0);
  });

  it('flags a HIGH-severity status divergence for a 404-vs-405 pair', async () => {
    const report = await runParity({
      oldDispatch: jsonDispatch(404, { error: 'not found' }),
      newDispatch: jsonDispatch(405, { error: 'method not allowed' }),
      fixtures: [fixture('missing')],
    });
    expect(report.ok).toBe(false);
    const statusDivergence = report.divergences.find((d) => d.field === 'status');
    expect(statusDivergence).toBeDefined();
    expect(statusDivergence?.severity).toBe('high');
    expect(statusDivergence?.oldValue).toBe(404);
    expect(statusDivergence?.newValue).toBe(405);
  });
});

describe('runParity: per-pass limiter isolation', () => {
  // A dispatcher whose response depends on the SHARED limiter: with limit 1, the
  // first hit for an IP is allowed (count 1) and the second is limited (count 2).
  const limiterDispatch: Dispatch = (req, res) => {
    const limited = !rateLimited(req, 1).allowed;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ limited }));
  };

  it('two limiter hits WITHOUT a reset diverge (so isolation is what is being tested)', () => {
    resetRateLimits();
    const first = !rateLimited(makeReq({ url: '/api/x' }), 1).allowed;
    const second = !rateLimited(makeReq({ url: '/api/x' }), 1).allowed;
    expect(first).toBe(false);
    expect(second).toBe(true);
  });

  it('shows parity for the SAME limiter dispatcher used as both old and new', async () => {
    // Without the per-pass reset, pass 2 would inherit pass 1's count and falsely
    // diverge (false then true). The driver resets the limiter before each pass,
    // so both passes see a fresh window and agree.
    const report = await runParity({
      oldDispatch: limiterDispatch,
      newDispatch: limiterDispatch,
      fixtures: [fixture('limited')],
    });
    expect(report.ok).toBe(true);
    expect(report.divergences).toHaveLength(0);
  });

  it('runs the injected reset hook before every pass', async () => {
    let resetCalls = 0;
    await runParity({
      oldDispatch: jsonDispatch(200, { ok: true }),
      newDispatch: jsonDispatch(200, { ok: true }),
      fixtures: [fixture(), fixture('second')],
      reset: () => {
        resetCalls += 1;
      },
    });
    // Two fixtures, two passes each.
    expect(resetCalls).toBe(4);
  });
});

describe('runParity: failed-login bucket isolation', () => {
  // The per-account failed-login bucket (authThrottled / recordAuthFailure) is a
  // SEPARATE limiter from the IP/account sliding windows. Each dispatcher call
  // records a failure for a DISTINCT account and reports the tracked-account count.
  let seq = 0;
  const authDispatch: Dispatch = (_req, res) => {
    recordAuthFailure(`bleed-${seq++}`);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ tracked: authFailureCount() }));
  };

  it('failed-login records accumulate WITHOUT a reset (so the bucket reset is what is tested)', () => {
    resetAuthFailures();
    recordAuthFailure('bleed-ctl-a');
    expect(authFailureCount()).toBe(1);
    recordAuthFailure('bleed-ctl-b');
    expect(authFailureCount()).toBe(2);
    resetAuthFailures();
  });

  it('resets the failed-login bucket between passes (no auth bleed)', async () => {
    seq = 0;
    // With resetAuthFailures() in isolatePass, each pass starts from an empty map
    // and reports tracked=1; without it, pass 2 would inherit pass 1's account and
    // report tracked=2, a body divergence.
    const report = await runParity({
      oldDispatch: authDispatch,
      newDispatch: authDispatch,
      fixtures: [fixture('login')],
    });
    expect(report.ok).toBe(true);
    expect(report.divergences).toHaveLength(0);
  });
});
