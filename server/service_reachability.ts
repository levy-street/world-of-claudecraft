// Did an economy-service request PROVABLY never reach the service?
//
// server/claudium_proxy.ts collapses every failure into one ambiguous token
// ('unavailable'), which is the right default for a money call and lossy as a
// fact. A spend that was refused at connect, or whose hostname never resolved,
// delivered no bytes to any application, so it cannot have debited. That is a
// property of the transport, not an inference about the service, and it is what
// lets a purchase pressed during an outage settle without reserving the
// character's slot ladder against a GOLD buy (Bank Storage phase 14).
//
// THE CLASSIFICATION IS DELIBERATELY NARROW, and every omission is deliberate:
//   - a TIMEOUT is ambiguous: the request may be sitting in the service's
//     event loop, already debited, with only the reply lost;
//   - ANY http status is ambiguous: bytes reached an application, and a 5xx
//     can be raised after a debit;
//   - a mid-request socket error (ECONNRESET, EPIPE, UND_ERR_SOCKET) is
//     ambiguous: the connection was established, so the request may have been
//     delivered before it broke;
//   - only a CONNECT refusal and a name-resolution failure qualify. Both mean
//     no connection to the service ever existed.
// An interposed proxy does not weaken this: if the proxy is up the connect
// succeeds and any later failure lands in one of the ambiguous buckets, and if
// the proxy is down nothing reached the service through it either way.
//
// A caller must also decide WHICH attempt it may apply this to. The fact says
// nothing about an earlier attempt under the same idempotency key, so the
// purchase flow uses it only for a spend whose pending row this very call
// inserted (server/storage_purchases.ts).

/** Connect-level failures that prove no request was delivered. undici raises
 *  these as the `cause` of its own `TypeError: fetch failed`. */
const NEVER_REACHED_CODES = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN']);

// A rejected fetch can nest: TypeError -> cause -> AggregateError -> errors[].
// Bounded so a self-referential cause chain cannot spin.
const MAX_CAUSE_DEPTH = 8;

function codeOf(err: unknown): string | undefined {
  if (typeof err !== 'object' || err === null) return undefined;
  const code = (err as { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}

/** True only when EVERY leaf of a rejected fetch's error is a connect-level
 *  failure, so the request provably never reached the service. Anything
 *  unrecognized, empty, or mixed answers false: the safe direction is
 *  ambiguity, which keeps the money guarantee and costs only availability. */
export function requestNeverReachedService(err: unknown, depth = 0): boolean {
  if (depth > MAX_CAUSE_DEPTH) return false;
  if (typeof err !== 'object' || err === null) return false;
  // An error's OWN code is read FIRST, before descending into anything it
  // carries. Ordering it this way is safe by construction rather than by the
  // absence of a counterexample: an error that reported an ambiguous code of
  // its own AND an inner list of connect refusals would otherwise answer true
  // on the strength of the list, discarding the very code that says bytes may
  // have been delivered.
  const code = codeOf(err);
  if (code !== undefined) return NEVER_REACHED_CODES.has(code);
  const nested = (err as { errors?: unknown }).errors;
  if (Array.isArray(nested)) {
    // An AggregateError over several resolved addresses: never-reached only if
    // no attempt got anywhere, and an empty list proves nothing.
    return (
      nested.length > 0 && nested.every((inner) => requestNeverReachedService(inner, depth + 1))
    );
  }
  const cause = (err as { cause?: unknown }).cause;
  if (cause !== undefined && cause !== null) return requestNeverReachedService(cause, depth + 1);
  return false;
}
