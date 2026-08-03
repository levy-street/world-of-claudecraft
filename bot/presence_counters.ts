// The rate-limit governor's counters, shaped for the presence push.
//
// Phase 8 ships the governor's counters to the game server by riding the
// presence POST that already runs on its own debounced cadence, rather than
// adding a telemetry loop of its own. Two rules follow from that and they are
// what this module exists to hold:
//
//  1. The shape is a WIRE CONTRACT. The server pins the same field set, so the
//     block is built as a fresh object literal in one fixed key order, never a
//     spread of whatever the governor happens to hold. A spread would put any
//     field a future governor grows on the wire unreviewed, and JSON.stringify
//     follows source key order, so the order here is what the byte-for-byte
//     envelope pin in tests/discord_bot_server_client.test.ts sees.
//  2. Telemetry may NEVER cost a presence push. Presence is what the HUD's
//     Discord widget renders; counters are diagnostics. So collection is a
//     TOTAL function: a snapshot accessor that throws, or that answers with
//     something that is not a record at all, yields null and the push goes out
//     with no counters block; an individual field of the wrong type normalizes
//     to 0 inside an otherwise-shipped block. Either way the push itself never
//     fails for a diagnostic reason.
//
// Nothing here reads a clock, a socket or the governor's internals: it takes a
// reader callback, so a test drives every arm with a plain function.
import type { GovernorCounters } from './rate_governor';

/**
 * The counters block as it travels on the presence POST.
 *
 * Field for field the governor's own `GovernorCounters`, deliberately declared
 * separately rather than aliased: this is the shape the server parses, so it
 * must change only when someone decides to change the wire, never as a
 * side effect of the governor growing a counter.
 */
export interface PresenceCounters {
  requests: number;
  rateLimited: number;
  rateLimitedByScope: { user: number; global: number; shared: number; unknown: number };
  globalPauses: number;
  banPauses: number;
  breakerState: 'closed' | 'open' | 'half-open';
  breakerOpens: number;
  queueDepth: number;
  trackedBuckets: number;
  trackedRoutes: number;
  activeQueues: number;
  forbiddenEntries: number;
  forbiddenBlocks: number;
  breakerBlocks: number;
  queueFullBlocks: number;
}

/**
 * The ceiling every numeric field is clamped to.
 *
 * A counter is a monotonic process-lifetime total, so a value above a billion
 * is not a busy bot, it is a corrupted read; capping keeps one bad number from
 * becoming an unbounded payload or a nonsense series on the server's side.
 */
export const PRESENCE_COUNTER_CAP = 1_000_000_000;

/** The breaker states that may reach the wire. Anything else reports 'closed'. */
const BREAKER_STATES: readonly PresenceCounters['breakerState'][] = ['closed', 'open', 'half-open'];

/**
 * One numeric field, normalized: anything that is not a finite positive number
 * becomes 0, a fraction truncates, and the value is capped.
 */
function normalizeCount(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return 0;
  const whole = Math.trunc(value);
  return whole > PRESENCE_COUNTER_CAP ? PRESENCE_COUNTER_CAP : whole;
}

function normalizeBreakerState(value: unknown): PresenceCounters['breakerState'] {
  return BREAKER_STATES.find((state) => state === value) ?? 'closed';
}

function asRecord(value: unknown): Record<string, unknown> | null {
  // An array is typeof 'object' but is not a record; treating one as a snapshot
  // would read every field as undefined and ship an all-zero block as if the
  // governor had reported it. The server-side sanitizer rejects arrays the same
  // way, so the two sides stay symmetric.
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * Read one governor snapshot and normalize it into the wire shape, or answer
 * null when there is nothing trustworthy to send.
 *
 * Total by construction: `read` is called inside the guard, so a thrown
 * accessor, a getter that throws, and a proxy that throws on property access
 * are all just "no counters this push". The scope record is rebuilt from
 * exactly the four known keys, so a fifth scope the governor learns is ignored
 * until someone widens this contract on purpose.
 */
export function collectPresenceCounters(read: () => GovernorCounters): PresenceCounters | null {
  try {
    const source = asRecord(read());
    if (!source) return null;
    const scope = asRecord(source.rateLimitedByScope) ?? {};
    return {
      requests: normalizeCount(source.requests),
      rateLimited: normalizeCount(source.rateLimited),
      rateLimitedByScope: {
        user: normalizeCount(scope.user),
        global: normalizeCount(scope.global),
        shared: normalizeCount(scope.shared),
        unknown: normalizeCount(scope.unknown),
      },
      globalPauses: normalizeCount(source.globalPauses),
      banPauses: normalizeCount(source.banPauses),
      breakerState: normalizeBreakerState(source.breakerState),
      breakerOpens: normalizeCount(source.breakerOpens),
      queueDepth: normalizeCount(source.queueDepth),
      trackedBuckets: normalizeCount(source.trackedBuckets),
      trackedRoutes: normalizeCount(source.trackedRoutes),
      activeQueues: normalizeCount(source.activeQueues),
      forbiddenEntries: normalizeCount(source.forbiddenEntries),
      forbiddenBlocks: normalizeCount(source.forbiddenBlocks),
      breakerBlocks: normalizeCount(source.breakerBlocks),
      queueFullBlocks: normalizeCount(source.queueFullBlocks),
    };
  } catch {
    return null;
  }
}

/**
 * Attach the counters block to a presence body, or hand the body back exactly
 * as it came.
 *
 * This is the seam that keeps telemetry off the presence push's critical path:
 * a failed collection returns the ORIGINAL body, with no `counters` key at all
 * rather than a null or an empty one, so the server sees precisely the payload
 * it saw before Phase 8 and the push itself cannot fail for a diagnostic
 * reason. The counters land LAST because the base body's key order is pinned
 * byte for byte by the server-client envelope suite.
 */
export function withPresenceCounters<T extends object>(
  body: T,
  read: () => GovernorCounters,
): T & { counters?: PresenceCounters } {
  const counters = collectPresenceCounters(read);
  if (!counters) return body as T & { counters?: PresenceCounters };
  return { ...body, counters };
}
