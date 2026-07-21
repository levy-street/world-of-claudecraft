// The old-vs-new parity driver: run two dispatchers over the same fixtures and
// diff their normalized responses, weighting error-path and status-code
// divergences heaviest.
//
// PER-PASS ISOLATION is the load-bearing property. Before EACH dispatcher pass
// the driver resets every limiter bucket in server/ratelimit (the IP/account
// sliding windows, the per-account failed-login bucket, and the clock) plus the
// optional injected `reset` hook, so a limiter tripped on the old pass cannot
// bleed into the new pass (or vice-versa) and falsely register as a divergence.
// The injected hook is where a caller adds a fresh-AsyncLocalStorage run and
// a reloaded config; the parity driver itself only needs the limiter resets.
import type * as http from 'node:http';
import {
  resetAuthFailures,
  resetCardUploadRateLimits,
  resetCharacterMutationRateLimits,
  resetDiscordRateLimits,
  resetPublicReadRateLimits,
  resetRateLimitClock,
  resetRateLimits,
  resetReportsCreateRateLimits,
  resetWalletLinkRateLimits,
  resetWocBalanceRateLimits,
} from '../../../server/ratelimit';
import { captureResponse, type Dispatch } from './golden';
import { type CapturedResponse, normalizeResponse, stableStringify } from './normalizer';

/** Divergence severity. Status-code divergences are weighted heaviest. */
export type Severity = 'high' | 'medium' | 'low';

/** A request descriptor. `req` is a factory so each pass gets a FRESH request. */
export interface ParityFixture {
  name: string;
  req: () => http.IncomingMessage;
}

/** One field-level difference between the old and new normalized responses. */
export interface ParityDivergence {
  fixture: string;
  /** 'status', 'body', or `header:<name>`. */
  field: string;
  oldValue: unknown;
  newValue: unknown;
  severity: Severity;
}

export interface ParityReport {
  ok: boolean;
  divergences: ParityDivergence[];
}

export interface RunParityOpts {
  oldDispatch: Dispatch;
  newDispatch: Dispatch;
  fixtures: ParityFixture[];
  /** Defaults to normalizeResponse. */
  normalizer?: typeof normalizeResponse;
  /** Extra per-pass isolation (fresh ALS, reloaded config) run AFTER the limiter
   *  resets. Invoked once before every dispatcher pass. */
  reset?: () => Promise<void> | void;
}

/** Reset all limiter state, then run the optional injected isolation hook. */
async function isolatePass(extraReset?: () => Promise<void> | void): Promise<void> {
  resetRateLimits();
  resetCardUploadRateLimits();
  resetWalletLinkRateLimits();
  resetDiscordRateLimits();
  resetWocBalanceRateLimits();
  resetPublicReadRateLimits();
  // The per-account character-mutation limiters are separate buckets, so a
  // create/rename/delete/takeover 429 on one pass must not bleed into the next.
  resetCharacterMutationRateLimits();
  // The per-account reports.create limiter is a separate bucket, so a
  // report-create 429 on one pass must not bleed into the next (harmless today,
  // since the reports corpus request 401s at activeGuard before the limiter runs).
  resetReportsCreateRateLimits();
  // The per-account failed-login bucket is a SEPARATE limiter (authThrottled /
  // recordAuthFailure on the login/register path), so a pass-1 login failure
  // must not bleed into pass 2 and falsely trip the new pass on the error path.
  resetAuthFailures();
  resetRateLimitClock();
  await extraReset?.();
}

function valueEqual(a: unknown, b: unknown): boolean {
  return stableStringify(a) === stableStringify(b);
}

/**
 * Diff two normalized responses. A status-code divergence (especially 404 vs 405
 * and any 4xx/5xx mismatch) is the heaviest ('high'); a body divergence is
 * 'medium' and a header-only divergence is 'low'.
 */
function diffResponses(
  name: string,
  oldCap: CapturedResponse,
  newCap: CapturedResponse,
): ParityDivergence[] {
  const divergences: ParityDivergence[] = [];

  if (oldCap.status !== newCap.status) {
    divergences.push({
      fixture: name,
      field: 'status',
      oldValue: oldCap.status,
      newValue: newCap.status,
      severity: 'high',
    });
  }

  if (!valueEqual(oldCap.body, newCap.body)) {
    divergences.push({
      fixture: name,
      field: 'body',
      oldValue: oldCap.body,
      newValue: newCap.body,
      severity: 'medium',
    });
  }

  const oldHeaders = oldCap.headers ?? {};
  const newHeaders = newCap.headers ?? {};
  const names = new Set([...Object.keys(oldHeaders), ...Object.keys(newHeaders)]);
  for (const header of [...names].sort()) {
    if (!valueEqual(oldHeaders[header], newHeaders[header])) {
      divergences.push({
        fixture: name,
        field: `header:${header}`,
        oldValue: oldHeaders[header],
        newValue: newHeaders[header],
        severity: 'low',
      });
    }
  }

  return divergences;
}

/**
 * Run both dispatchers over every fixture and return the divergence report. Each
 * dispatcher pass is preceded by a full limiter reset (plus the injected hook), so
 * the two passes for a fixture each start from clean state.
 */
export async function runParity(opts: RunParityOpts): Promise<ParityReport> {
  const normalize = opts.normalizer ?? normalizeResponse;
  const divergences: ParityDivergence[] = [];

  for (const fixture of opts.fixtures) {
    await isolatePass(opts.reset);
    const oldCap = normalize(await captureResponse(opts.oldDispatch, fixture.req()));

    await isolatePass(opts.reset);
    const newCap = normalize(await captureResponse(opts.newDispatch, fixture.req()));

    divergences.push(...diffResponses(fixture.name, oldCap, newCap));
  }

  return { ok: divergences.length === 0, divergences };
}
