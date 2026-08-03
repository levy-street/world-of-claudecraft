// The presence-push counters block: the wire shape, its normalization, and the
// one property the whole design rests on, that telemetry can never cost a
// presence push.
//
// Two families of assertion here, and they fail for different reasons. The
// SHAPE cases pin the exact key set and key ORDER, because the block is
// serialized by JSON.stringify (which follows source order) and the server pins
// the same contract; a reordered literal is a silently different payload. The
// TOTALITY cases drive hostile readers, because the collector's whole job is to
// be the thing that absorbs a governor that answers with something unexpected
// instead of letting it reach the push.
import { describe, expect, it } from 'vitest';
import {
  collectPresenceCounters,
  PRESENCE_COUNTER_CAP,
  type PresenceCounters,
  withPresenceCounters,
} from '../bot/presence_counters';
import { type GovernorCounters, RateGovernor } from '../bot/rate_governor';

/** The wire contract, in the one order the payload may serialize in. */
const WIRE_KEYS = [
  'requests',
  'rateLimited',
  'rateLimitedByScope',
  'globalPauses',
  'banPauses',
  'breakerState',
  'breakerOpens',
  'queueDepth',
  'trackedBuckets',
  'trackedRoutes',
  'activeQueues',
  'forbiddenEntries',
  'forbiddenBlocks',
  'breakerBlocks',
  'queueFullBlocks',
];

/** The four scopes, and no fifth. */
const SCOPE_KEYS = ['user', 'global', 'shared', 'unknown'];

/**
 * A governor snapshot with a DISTINCT value in every numeric field. Distinct on
 * purpose: an all-zero or all-one fixture is satisfied by a collector that maps
 * requests to rateLimited, which is the realistic way a fifteen-field literal
 * goes wrong.
 */
function distinctSnapshot(): GovernorCounters {
  return {
    requests: 101,
    rateLimited: 102,
    rateLimitedByScope: { user: 201, global: 202, shared: 203, unknown: 204 },
    globalPauses: 103,
    banPauses: 104,
    breakerState: 'half-open',
    breakerOpens: 105,
    queueDepth: 106,
    trackedBuckets: 107,
    trackedRoutes: 108,
    activeQueues: 109,
    forbiddenEntries: 110,
    forbiddenBlocks: 111,
    breakerBlocks: 112,
    queueFullBlocks: 113,
  };
}

/** Read a hostile or partial object as if it were a governor snapshot. */
function readerFor(value: unknown): () => GovernorCounters {
  return () => value as GovernorCounters;
}

describe('collectPresenceCounters shape', () => {
  it('emits exactly the wire keys, in the wire order', () => {
    const out = collectPresenceCounters(() => distinctSnapshot());

    expect(out).not.toBe(null);
    // toEqual on the key ARRAY, so this fails on a reordered literal and not
    // only on a missing field: the order is what JSON.stringify emits.
    expect(Object.keys(out as PresenceCounters)).toEqual(WIRE_KEYS);
    expect(Object.keys((out as PresenceCounters).rateLimitedByScope)).toEqual(SCOPE_KEYS);
  });

  it('carries every field from its own source field', () => {
    const out = collectPresenceCounters(() => distinctSnapshot());

    expect(out).toEqual({
      requests: 101,
      rateLimited: 102,
      rateLimitedByScope: { user: 201, global: 202, shared: 203, unknown: 204 },
      globalPauses: 103,
      banPauses: 104,
      breakerState: 'half-open',
      breakerOpens: 105,
      queueDepth: 106,
      trackedBuckets: 107,
      trackedRoutes: 108,
      activeQueues: 109,
      forbiddenEntries: 110,
      forbiddenBlocks: 111,
      breakerBlocks: 112,
      queueFullBlocks: 113,
    });
  });

  it('covers every counter a real governor snapshot carries', () => {
    // The one thing the fixtures above cannot say. This module deliberately does
    // not spread the governor's snapshot, which means a counter the governor
    // grows later would be silently absent from the wire forever, with every
    // other assertion here green over the fixture that never learned about it.
    // Reading the REAL snapshot is what turns that into a decision someone has
    // to make: widen PresenceCounters, or record that the new counter stays
    // bot-side.
    const governor = new RateGovernor({
      clock: { now: () => 0, sleep: async () => {} },
      maxRps: 8,
      banPauseMs: 1000,
      breakerLimit: 10,
      forbiddenTtlMs: 1000,
    });

    expect(Object.keys(governor.snapshot()).sort()).toEqual([...WIRE_KEYS].sort());
    // Same guard one level down: the collector rebuilds the scope record from
    // four hard-coded keys, so a fifth RateLimitScope would type-check cleanly
    // and its 429s would silently vanish from the wire without this line.
    expect(Object.keys(governor.snapshot().rateLimitedByScope).sort()).toEqual(
      [...SCOPE_KEYS].sort(),
    );
  });

  it('builds a fresh object rather than aliasing the snapshot', () => {
    // The governor's own snapshot() already copies, but this collector is the
    // last line: a spread of the source would put a field the governor grows
    // later on the wire with nobody reviewing it, and an aliased scope record
    // would let a later governor mutation rewrite an already-sent payload.
    const source = distinctSnapshot();
    const out = collectPresenceCounters(() => source) as PresenceCounters;

    expect(out).not.toBe(source);
    expect(out.rateLimitedByScope).not.toBe(source.rateLimitedByScope);
  });

  it('never copies a key the contract does not name', () => {
    const source = {
      ...distinctSnapshot(),
      secretHeaderValue: 'x',
      rateLimitedByScope: { user: 1, global: 2, shared: 3, unknown: 4, invented: 5 },
    };

    const out = collectPresenceCounters(readerFor(source)) as PresenceCounters;

    expect(Object.keys(out)).toEqual(WIRE_KEYS);
    expect(Object.keys(out.rateLimitedByScope)).toEqual(SCOPE_KEYS);
    expect(JSON.stringify(out)).not.toContain('invented');
    expect(JSON.stringify(out)).not.toContain('secretHeaderValue');
  });
});

describe('collectPresenceCounters normalization', () => {
  // One row per KIND of bad value, each planted on a different field so a
  // collector that normalized only the first field cannot pass the set.
  const ARMS: readonly { name: string; field: keyof GovernorCounters; value: unknown }[] = [
    { name: 'NaN', field: 'requests', value: Number.NaN },
    { name: 'Infinity', field: 'rateLimited', value: Number.POSITIVE_INFINITY },
    { name: 'negative Infinity', field: 'globalPauses', value: Number.NEGATIVE_INFINITY },
    { name: 'a negative count', field: 'banPauses', value: -5 },
    { name: 'a string', field: 'breakerOpens', value: '7' },
    { name: 'null', field: 'queueDepth', value: null },
    { name: 'undefined (a missing field)', field: 'trackedBuckets', value: undefined },
    { name: 'a boolean', field: 'trackedRoutes', value: true },
    { name: 'an object', field: 'activeQueues', value: {} },
    { name: 'a fraction below one', field: 'forbiddenEntries', value: 0.9 },
    { name: 'NaN on the third-to-last field', field: 'forbiddenBlocks', value: Number.NaN },
    { name: 'a negative on the second-to-last field', field: 'breakerBlocks', value: -1 },
    { name: 'a string on the last field', field: 'queueFullBlocks', value: '9' },
  ];

  for (const arm of ARMS) {
    it(`reports 0 for ${arm.name}`, () => {
      const source: Record<string, unknown> = { ...distinctSnapshot() };
      source[arm.field] = arm.value;

      const out = collectPresenceCounters(readerFor(source)) as PresenceCounters;

      expect(out[arm.field]).toBe(0);
      // And only that field moved: a normalizer that zeroed the whole block on
      // one bad value would throw away every good counter beside it. The
      // control is a field this arm did not touch.
      if (arm.field === 'breakerBlocks') expect(out.forbiddenBlocks).toBe(111);
      else expect(out.breakerBlocks).toBe(112);
    });
  }

  it('truncates a fraction instead of rounding it', () => {
    const source = { ...distinctSnapshot(), queueDepth: 3.7 };

    expect((collectPresenceCounters(readerFor(source)) as PresenceCounters).queueDepth).toBe(3);
  });

  it('caps an implausibly large counter', () => {
    const source = { ...distinctSnapshot(), requests: 1e12 };

    const out = collectPresenceCounters(readerFor(source)) as PresenceCounters;

    expect(out.requests).toBe(PRESENCE_COUNTER_CAP);
    expect(PRESENCE_COUNTER_CAP).toBe(1_000_000_000);
    // The cap is a ceiling, not a clamp applied to everything: a value just
    // under it passes through untouched.
    const justUnder = { ...distinctSnapshot(), requests: PRESENCE_COUNTER_CAP - 1 };
    expect((collectPresenceCounters(readerFor(justUnder)) as PresenceCounters).requests).toBe(
      PRESENCE_COUNTER_CAP - 1,
    );
  });

  it('fills a missing scope key with 0 and keeps the others', () => {
    const source = { ...distinctSnapshot(), rateLimitedByScope: { user: 4, shared: 6 } };

    const out = collectPresenceCounters(readerFor(source)) as PresenceCounters;

    expect(out.rateLimitedByScope).toEqual({ user: 4, global: 0, shared: 6, unknown: 0 });
  });

  it('reports an all-zero scope record when the scope field is not a record', () => {
    // The array is typeof 'object' and would index as undefined; the collector
    // must refuse it like any other non-record, matching the server sanitizer.
    for (const scope of [null, undefined, 'user', 3, [201, 202]]) {
      const out = collectPresenceCounters(
        readerFor({ ...distinctSnapshot(), rateLimitedByScope: scope }),
      ) as PresenceCounters;

      expect(out.rateLimitedByScope).toEqual({ user: 0, global: 0, shared: 0, unknown: 0 });
      expect(out.requests).toBe(101);
    }
  });

  it('reports closed for any breaker state outside the allowlist', () => {
    for (const hostile of ['OPEN', 'tripped', '', null, undefined, 7, { state: 'open' }]) {
      const out = collectPresenceCounters(
        readerFor({ ...distinctSnapshot(), breakerState: hostile }),
      ) as PresenceCounters;

      expect(out.breakerState).toBe('closed');
    }
    // And the three legal states survive, so the arm above is a filter and not
    // a constant.
    for (const legal of ['closed', 'open', 'half-open'] as const) {
      const out = collectPresenceCounters(
        readerFor({ ...distinctSnapshot(), breakerState: legal }),
      ) as PresenceCounters;

      expect(out.breakerState).toBe(legal);
    }
  });
});

describe('collectPresenceCounters totality', () => {
  it('answers null when the reader throws', () => {
    expect(
      collectPresenceCounters(() => {
        throw new Error('governor exploded');
      }),
    ).toBe(null);
  });

  it('answers null when the reader hands back something that is not a record', () => {
    // An array included: it is typeof 'object', and reading it as a snapshot
    // would ship an all-zero block as if the governor had reported one.
    for (const value of [null, undefined, 'counters', 42, true, [distinctSnapshot()]]) {
      expect(collectPresenceCounters(readerFor(value))).toBe(null);
    }
  });

  it('answers null when reading a property throws', () => {
    // The realistic version of this is a getter (or a lazily computed snapshot)
    // that throws mid-read, which a top-level typeof check cannot see: the
    // object IS an object, and the failure happens field by field.
    const hostile = new Proxy(
      {},
      {
        get() {
          throw new Error('property access exploded');
        },
      },
    );

    expect(collectPresenceCounters(readerFor(hostile))).toBe(null);
  });
});

describe('withPresenceCounters', () => {
  const body = () => ({ onlineCount: 3, memberTotal: 9, voiceChannelName: null, voice: [] });

  it('attaches the counters as the LAST key of the body', () => {
    const out = withPresenceCounters(body(), () => distinctSnapshot());

    // Last, because the base body's serialization is pinned byte for byte by
    // the server-client envelope suite: counters appended cannot disturb it,
    // counters spliced in the middle would.
    expect(Object.keys(out)).toEqual([
      'onlineCount',
      'memberTotal',
      'voiceChannelName',
      'voice',
      'counters',
    ]);
    // A fresh literal, never `collectPresenceCounters(...)` itself: comparing
    // the attach seam against the function under test is a self-comparison
    // that a transposed pair of fields would satisfy on both sides.
    expect(out.counters).toEqual({
      requests: 101,
      rateLimited: 102,
      rateLimitedByScope: { user: 201, global: 202, shared: 203, unknown: 204 },
      globalPauses: 103,
      banPauses: 104,
      breakerState: 'half-open',
      breakerOpens: 105,
      queueDepth: 106,
      trackedBuckets: 107,
      trackedRoutes: 108,
      activeQueues: 109,
      forbiddenEntries: 110,
      forbiddenBlocks: 111,
      breakerBlocks: 112,
      queueFullBlocks: 113,
    });
  });

  it('leaves the body untouched, with no counters key, when the reader throws', () => {
    const original = body();

    const out = withPresenceCounters(original, () => {
      throw new Error('governor exploded');
    });

    // The SAME object, and no key at all: an attached `counters: null` would be
    // a wire change the server has to parse, which is exactly what the failure
    // path must not cost.
    expect(out).toBe(original);
    expect('counters' in out).toBe(false);
    expect(JSON.stringify(out)).toBe(
      '{"onlineCount":3,"memberTotal":9,"voiceChannelName":null,"voice":[]}',
    );
  });

  it('never throws for a hostile reader', () => {
    const hostile = new Proxy(
      {},
      {
        get() {
          throw new Error('property access exploded');
        },
      },
    );

    expect(() => withPresenceCounters(body(), readerFor(hostile))).not.toThrow();
    expect('counters' in withPresenceCounters(body(), readerFor(hostile))).toBe(false);
    expect('counters' in withPresenceCounters(body(), readerFor(null))).toBe(false);
  });

  it('does not read the counters until it is called', () => {
    // The reader is a thunk on purpose: main.ts wires it once at module scope,
    // and a value captured there would be the boot-time snapshot forever.
    let reads = 0;
    const read = () => {
      reads += 1;
      return distinctSnapshot();
    };

    expect(reads).toBe(0);
    withPresenceCounters(body(), read);
    expect(reads).toBe(1);
    withPresenceCounters(body(), read);
    expect(reads).toBe(2);
  });
});
