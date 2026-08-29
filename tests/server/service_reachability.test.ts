// Bank Storage phase 14: the transport classifier behind the outage arm.
//
// This predicate is the ONE place the flow is allowed to conclude "no debit is
// possible", so every case here is written from the failure direction that
// matters: an error it wrongly calls never-reached could settle a DEBITED
// purchase as refused. The shapes are the ones undici actually raises, built as
// literals rather than by provoking a real socket, so the pins say what they
// mean and run everywhere.
import { describe, expect, it } from 'vitest';
import { requestNeverReachedService } from '../../server/service_reachability';

/** undici's shape: TypeError('fetch failed') carrying the real error as cause. */
function fetchFailed(cause: unknown): Error {
  const err = new TypeError('fetch failed');
  (err as { cause?: unknown }).cause = cause;
  return err;
}

function coded(code: string, message = code): Error {
  const err = new Error(message);
  (err as { code?: string }).code = code;
  return err;
}

describe('requestNeverReachedService: what proves no request was delivered', () => {
  it('is true for a connect refusal and for name resolution failure', () => {
    expect(requestNeverReachedService(fetchFailed(coded('ECONNREFUSED')))).toBe(true);
    expect(requestNeverReachedService(fetchFailed(coded('ENOTFOUND')))).toBe(true);
    expect(requestNeverReachedService(fetchFailed(coded('EAI_AGAIN')))).toBe(true);
    // The bare error, with no fetch wrapper, classifies the same way.
    expect(requestNeverReachedService(coded('ECONNREFUSED'))).toBe(true);
  });

  it('is FALSE for every failure that could follow a delivered request', () => {
    // A timeout is the dangerous one: the service may be mid-debit with only
    // the reply lost. Both the abort shape and the socket-level codes.
    const abort = new Error('The operation was aborted due to timeout');
    abort.name = 'TimeoutError';
    expect(requestNeverReachedService(abort)).toBe(false);
    for (const code of ['ETIMEDOUT', 'ECONNRESET', 'EPIPE', 'UND_ERR_SOCKET', 'ERR_STREAM']) {
      expect(requestNeverReachedService(fetchFailed(coded(code)))).toBe(false);
    }
    // An http status never reaches here (the proxy classifies a non-2xx as
    // reached), but a hand-rolled Error carrying one must not slip through.
    expect(requestNeverReachedService(new Error('POST spend -> 503'))).toBe(false);
  });

  it('needs EVERY address attempt to have failed at connect', () => {
    const all = new AggregateError(
      [coded('ECONNREFUSED'), coded('ECONNREFUSED')],
      'all attempts failed',
    );
    expect(requestNeverReachedService(fetchFailed(all))).toBe(true);

    // One attempt that got further makes the whole call ambiguous: that socket
    // may have carried the request.
    const mixed = new AggregateError([coded('ECONNREFUSED'), coded('ECONNRESET')], 'mixed');
    expect(requestNeverReachedService(fetchFailed(mixed))).toBe(false);

    // An empty list proves nothing at all.
    const empty = new AggregateError([], 'nothing tried');
    expect(requestNeverReachedService(fetchFailed(empty))).toBe(false);
  });

  it("reads an error's OWN code before anything it carries", () => {
    // The ordering is the guarantee: an error that reports an ambiguous code of
    // its own AND carries an inner list of connect refusals must answer FALSE.
    // Reading the list first would discard the very code saying bytes may have
    // been delivered.
    const ambiguousOuter = new AggregateError(
      [coded('ECONNREFUSED'), coded('ECONNREFUSED')],
      'socket died mid-request',
    );
    (ambiguousOuter as { code?: string }).code = 'UND_ERR_SOCKET';
    expect(requestNeverReachedService(ambiguousOuter)).toBe(false);

    // The same shape with a connect-level OWN code still answers true, so the
    // arm above is the ordering and not a blanket refusal of nested errors.
    const refusedOuter = new AggregateError([coded('ECONNREFUSED')], 'all attempts failed');
    (refusedOuter as { code?: string }).code = 'ECONNREFUSED';
    expect(requestNeverReachedService(refusedOuter)).toBe(true);

    // And an ambiguous own code beats a connect-level CAUSE too.
    const outer = coded('ETIMEDOUT');
    (outer as { cause?: unknown }).cause = coded('ECONNREFUSED');
    expect(requestNeverReachedService(outer)).toBe(false);
  });

  it('answers false for anything it cannot read, and never spins on a cycle', () => {
    expect(requestNeverReachedService(undefined)).toBe(false);
    expect(requestNeverReachedService(null)).toBe(false);
    expect(requestNeverReachedService('ECONNREFUSED')).toBe(false);
    expect(requestNeverReachedService(new Error('plain'))).toBe(false);
    // A code that is not a string is not a code.
    const numeric = new Error('odd');
    (numeric as { code?: unknown }).code = 111;
    expect(requestNeverReachedService(numeric)).toBe(false);

    // A self-referential cause chain must terminate rather than recurse away.
    const loop = new Error('loop');
    (loop as { cause?: unknown }).cause = loop;
    expect(requestNeverReachedService(loop)).toBe(false);

    // Nesting deeper than the bound answers false rather than walking forever,
    // even when the leaf WOULD have qualified: the safe direction is ambiguity.
    let deep: unknown = coded('ECONNREFUSED');
    for (let i = 0; i < 12; i++) deep = fetchFailed(deep);
    expect(requestNeverReachedService(deep)).toBe(false);
    // ... while a chain inside the bound still resolves to the leaf.
    let shallow: unknown = coded('ECONNREFUSED');
    for (let i = 0; i < 3; i++) shallow = fetchFailed(shallow);
    expect(requestNeverReachedService(shallow)).toBe(true);
  });
});
