// The ServerClient request envelope: what actually reaches the game server's
// secret-gated /internal/discord/* endpoints, and how the per-call abort
// deadline is armed and cleared. Everything runs through the injected fetch and
// timer seams, so there is no network IO and no real 8 second wait; the last
// block constructs the client the way bot/main.ts does (two arguments) to prove
// the production defaults are still the real globals.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type PresenceCounters, withPresenceCounters } from '../bot/presence_counters';
import {
  DEFAULT_OUTBOX_TIMEOUT_MS,
  FLEX_BATCH_LIMIT,
  SERVER_CALL_TIMEOUT_MS,
  ServerClient,
  type TimerHandle,
  type TimerSeam,
} from '../bot/server_client';

interface FetchCall {
  url: string;
  init: RequestInit;
}

/** A response carrying only the three fields `call()` touches. `reads` records
 *  every body read, so a test can prove a body was never parsed. */
function fakeResponse(opts: { status?: number; body?: unknown; reads?: string[] } = {}): Response {
  const status = opts.status ?? 200;
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => {
      opts.reads?.push('json');
      return opts.body;
    },
  } as unknown as Response;
}

/** A fetch that logs every call and answers from the supplied responder. */
function recordingFetch(respond: (call: FetchCall) => Promise<Response> | Response): {
  calls: FetchCall[];
  impl: typeof fetch;
} {
  const calls: FetchCall[] = [];
  const impl: typeof fetch = async (input, init) => {
    const call: FetchCall = { url: String(input), init: init ?? {} };
    calls.push(call);
    return respond(call);
  };
  return { calls, impl };
}

/** A timer pair that arms nothing: the test fires the deadline by hand. */
function fakeTimers(): {
  armed: { fn: () => void; ms: number }[];
  cleared: TimerHandle[];
  seam: TimerSeam;
} {
  const armed: { fn: () => void; ms: number }[] = [];
  const cleared: TimerHandle[] = [];
  let nextHandle = 1;
  const seam: TimerSeam = {
    setTimeout: (fn, ms) => {
      armed.push({ fn, ms });
      return nextHandle++;
    },
    clearTimeout: (handle) => {
      cleared.push(handle);
    },
  };
  return { armed, cleared, seam };
}

/** A timer pair over a VIRTUAL clock, for the deadlines that differ per call:
 *  `advance(ms)` moves the clock and fires everything that has come due, so a
 *  test can prove a call was still alive at one deadline and dead at another. */
function clockTimers(): {
  advance: (ms: number) => void;
  armed: { ms: number }[];
  seam: TimerSeam;
} {
  let now = 0;
  let nextHandle = 1;
  const armed: { ms: number }[] = [];
  const pending = new Map<TimerHandle, { at: number; fn: () => void }>();
  const seam: TimerSeam = {
    setTimeout: (fn, ms) => {
      const handle = nextHandle++;
      armed.push({ ms });
      pending.set(handle, { at: now + ms, fn });
      return handle;
    },
    clearTimeout: (handle) => {
      pending.delete(handle);
    },
  };
  const advance = (ms: number) => {
    now += ms;
    for (const [handle, timer] of [...pending]) {
      if (timer.at <= now) {
        pending.delete(handle);
        timer.fn();
      }
    }
  };
  return { advance, armed, seam };
}

/** Yield past the microtask queue so a settled promise has run its handlers. */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** A client whose every call succeeds with `data`, plus the recorded calls. */
function clientReturning(data: unknown): { calls: FetchCall[]; client: ServerClient } {
  const { calls, impl } = recordingFetch(() =>
    fakeResponse({ body: { success: true, data, error: null } }),
  );
  return { calls, client: new ServerClient('http://host', 'sekrit', impl, fakeTimers().seam) };
}

const ROLES_ENVELOPE = {
  success: true,
  data: { linked: true, statusTier: 3, points: 12, lifetimePoints: 40 },
  error: null,
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('ServerClient request envelope', () => {
  it('sends the method, the RAW baseUrl + path concatenation, and the secret header', async () => {
    const timers = fakeTimers();
    const { calls, impl } = recordingFetch(() => fakeResponse({ body: ROLES_ENVELOPE }));
    // The trailing slash on the base is deliberate: nothing normalizes the URL.
    const client = new ServerClient('http://host:8787/', 'sekrit', impl, timers.seam);

    const roles = await client.roles('u 1');

    expect(calls.length).toBe(1);
    expect(calls[0].init.method).toBe('GET');
    // Both slashes survive, and the id is percent-encoded by the caller.
    expect(calls[0].url).toBe('http://host:8787//internal/discord/roles?discord_user_id=u%201');
    // Lowercase header name, the secret verbatim, no Bearer prefix, and the
    // JSON content type even though this GET carries no body.
    expect(calls[0].init.headers).toEqual({
      'x-woc-discord-secret': 'sekrit',
      'Content-Type': 'application/json',
    });
    expect(roles).toEqual({ linked: true, statusTier: 3, points: 12, lifetimePoints: 40 });
  });

  it('sends no body on a GET', async () => {
    // Note this does NOT pin the `body === undefined ? undefined :` ternary in
    // call(): JSON.stringify(undefined) is itself undefined, so the guard is
    // defensive rather than load-bearing and no assertion can distinguish it.
    // What this DOES pin is that a GET reaches fetch with no body at all.
    const timers = fakeTimers();
    const { calls, impl } = recordingFetch(() =>
      fakeResponse({ body: { success: true, data: { ids: [] }, error: null } }),
    );
    const client = new ServerClient('http://host', 'sekrit', impl, timers.seam);

    await client.flairedIds();

    expect(calls[0].init.body).toBe(undefined);
    expect('body' in calls[0].init).toBe(true);
  });

  it('POSTs the body as JSON.stringify output, byte for byte', async () => {
    const timers = fakeTimers();
    const { calls, impl } = recordingFetch(() =>
      fakeResponse({ body: { success: true, data: null, error: null } }),
    );
    const client = new ServerClient('http://host', 'sekrit', impl, timers.seam);

    await client.markDailyRewardWinners('2026-07-30');
    expect(calls[0].init.method).toBe('POST');
    expect(calls[0].url).toBe('http://host/internal/discord/daily-rewards-winners/mark');
    expect(calls[0].init.body).toBe('{"day":"2026-07-30"}');

    // An absent dedupe key is dropped by JSON.stringify, not sent as null: the
    // server treats a null key as a real value and would dedupe against it.
    await client.grant('u1', 'daily', 5);
    expect(calls[1].init.body).toBe('{"discord_user_id":"u1","reason":"daily","points":5}');

    await client.grant('u1', 'daily', 5, 'k1');
    expect(calls[2].init.body).toBe(
      '{"discord_user_id":"u1","reason":"daily","points":5,"dedupeKey":"k1"}',
    );
  });
});

/**
 * One filled counters block, every numeric field distinct so a payload that
 * transposed two of them cannot match the byte pin below.
 */
const PRESENCE_COUNTERS: PresenceCounters = {
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

/**
 * The presence POST body, byte for byte, with the counters attached. Written
 * out as a literal rather than derived from the constant above: a pin computed
 * from the same object it is checking would agree with any key order at all,
 * and key order is half of what this pins.
 */
const PRESENCE_BODY_WITH_COUNTERS =
  '{"onlineCount":3,"memberTotal":9,"voiceChannelName":null,"voice":[],"counters":{"requests":101,"rateLimited":102,"rateLimitedByScope":{"user":201,"global":202,"shared":203,"unknown":204},"globalPauses":103,"banPauses":104,"breakerState":"half-open","breakerOpens":105,"queueDepth":106,"trackedBuckets":107,"trackedRoutes":108,"activeQueues":109,"forbiddenEntries":110,"forbiddenBlocks":111,"breakerBlocks":112,"queueFullBlocks":113}}';

const ROUTE_ROWS: {
  name: string;
  methodName: string;
  drive: (c: ServerClient) => Promise<unknown>;
  method: string;
  path: string;
  body: string | undefined;
  data: unknown;
}[] = [
  {
    name: 'flexBatch',
    methodName: 'flexBatch',
    drive: (c) => c.flexBatch(['u1', 'u2']),
    method: 'POST',
    // A POST, unlike the per-id `flex` GET: the id list travels in the body.
    path: '/internal/discord/flex-batch',
    body: '{"discord_user_ids":["u1","u2"]}',
    data: { requested: 2, members: [] },
  },
  {
    name: 'drainOutbox',
    methodName: 'drainOutbox',
    drive: (c) => c.drainOutbox(),
    method: 'GET',
    path: '/internal/discord/outbox',
    body: undefined,
    data: {
      relay: { items: [] },
      activity: { items: [] },
      winners: { days: [] },
      linkChanges: { items: [] },
    },
  },
  {
    name: 'roles',
    methodName: 'roles',
    drive: (c) => c.roles('u 1'),
    method: 'GET',
    path: '/internal/discord/roles?discord_user_id=u%201',
    body: undefined,
    data: {},
  },
  {
    // Presence WITHOUT counters, which is not a legacy shape: the Phase 8 seam
    // omits the key entirely whenever the governor snapshot could not be read,
    // so this exact byte string is what the server still has to accept.
    name: 'pushPresence (no counters)',
    methodName: 'pushPresence',
    drive: (c) =>
      c.pushPresence({ onlineCount: 3, memberTotal: 9, voiceChannelName: null, voice: [] }),
    method: 'POST',
    path: '/internal/discord/presence',
    body: '{"onlineCount":3,"memberTotal":9,"voiceChannelName":null,"voice":[]}',
    data: {},
  },
  {
    // And with them. The counters block is a wire contract the server pins too,
    // so what is pinned here is the whole serialized payload: field order
    // included, because JSON.stringify follows source order. The body is built
    // through the PRODUCTION attach seam (withPresenceCounters reading a
    // governor-shaped snapshot), so the key order this byte string pins is the
    // one bot/presence_counters.ts actually emits: a reordered literal there is
    // a different payload and reds this row.
    name: 'pushPresence (with counters)',
    methodName: 'pushPresence',
    drive: (c) =>
      c.pushPresence(
        withPresenceCounters(
          { onlineCount: 3, memberTotal: 9, voiceChannelName: null, voice: [] },
          () => PRESENCE_COUNTERS,
        ),
      ),
    method: 'POST',
    path: '/internal/discord/presence',
    body: PRESENCE_BODY_WITH_COUNTERS,
    data: {},
  },
  {
    name: 'setMember',
    methodName: 'setMember',
    drive: (c) => c.setMember('u1', true),
    method: 'POST',
    path: '/internal/discord/member',
    body: '{"discord_user_id":"u1","guildMember":true}',
    data: {},
  },
  {
    name: 'grant',
    methodName: 'grant',
    drive: (c) => c.grant('u1', 'daily', 5, 'k1'),
    method: 'POST',
    // The points-granting call: a path swap here silently stops every reward.
    path: '/internal/discord/grant',
    body: '{"discord_user_id":"u1","reason":"daily","points":5,"dedupeKey":"k1"}',
    data: {},
  },
  {
    name: 'markDailyRewardWinners',
    methodName: 'markDailyRewardWinners',
    drive: (c) => c.markDailyRewardWinners('2026-07-30'),
    method: 'POST',
    path: '/internal/discord/daily-rewards-winners/mark',
    body: '{"day":"2026-07-30"}',
    data: {},
  },
  {
    name: 'pushMembersMeta',
    methodName: 'pushMembersMeta',
    drive: (c) =>
      c.pushMembersMeta([{ discord_user_id: 'u1', name: 'A', joinedAtMs: 1, role: null }]),
    method: 'POST',
    path: '/internal/discord/members-meta',
    body: '{"members":[{"discord_user_id":"u1","name":"A","joinedAtMs":1,"role":null}]}',
    data: { updated: 1 },
  },
  {
    name: 'flairedIds',
    methodName: 'flairedIds',
    drive: (c) => c.flairedIds(),
    method: 'GET',
    path: '/internal/discord/flaired-ids',
    body: undefined,
    data: { ids: [] },
  },
];

describe('ServerClient per-endpoint routes', () => {
  // Each row is the ONE wire contract only that method can get wrong. A typo in
  // any path 404s, call() returns null, and the drain methods answer with an
  // empty array, so the feed stops with no error surface at all.

  for (const row of ROUTE_ROWS) {
    it(`${row.name} sends ${row.method} ${row.path}`, async () => {
      const { calls, client } = clientReturning(row.data);

      await row.drive(client);

      expect(calls.length).toBe(1);
      expect(calls[0].init.method).toBe(row.method);
      expect(calls[0].url).toBe(`http://host${row.path}`);
      expect(calls[0].init.body).toBe(row.body);
    });
  }
});

describe('ServerClient envelope handling', () => {
  it('returns null for a { success: false } envelope on an HTTP 200', async () => {
    const timers = fakeTimers();
    const { impl } = recordingFetch(() =>
      // Data IS present: only the success flag decides, so a server-side
      // failure never reaches the caller as a half-filled record.
      fakeResponse({ body: { success: false, data: { linked: true }, error: 'nope' } }),
    );
    const client = new ServerClient('http://host', 'sekrit', impl, timers.seam);

    expect(await client.roles('u1')).toBe(null);
    expect(timers.cleared).toEqual([1]);
  });

  it('returns null on a non-ok status and never reads the body', async () => {
    const errors: unknown[][] = [];
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      errors.push(args);
    });
    const reads: string[] = [];
    const timers = fakeTimers();
    const { impl } = recordingFetch(() =>
      fakeResponse({ status: 500, body: { success: true, data: { items: [1] } }, reads }),
    );
    const client = new ServerClient('http://host', 'sekrit', impl, timers.seam);

    expect(await client.flairedIds()).toBe(null);
    expect(reads).toEqual([]);
    expect(errors).toEqual([['[bot] server GET /internal/discord/flaired-ids -> 500']]);
  });

  it('treats a 3xx as not-ok, not just a 5xx', async () => {
    // 200 and 500 agree under every plausible rewrite of `!resp.ok`, including
    // `resp.status >= 400`. A redirect is where they part: the game server
    // answering 301 (a proxy misconfiguration, the realistic case) must not be
    // read as success and parsed as an envelope.
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const reads: string[] = [];
    const timers = fakeTimers();
    const { impl } = recordingFetch(() =>
      fakeResponse({ status: 301, body: { success: true, data: { items: [1] } }, reads }),
    );
    const client = new ServerClient('http://host', 'sekrit', impl, timers.seam);

    expect(await client.flairedIds()).toBe(null);
    expect(reads).toEqual([]);
  });

  it('returns null when the fetch itself rejects, and still clears the deadline', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const timers = fakeTimers();
    const { impl } = recordingFetch(() => Promise.reject(new Error('socket hang up')));
    const client = new ServerClient('http://host', 'sekrit', impl, timers.seam);

    expect(await client.roles('u1')).toBe(null);
    expect(timers.cleared).toEqual([1]); // the finally runs on the throwing path too
  });
});

describe('ServerClient response unwrapping', () => {
  it('covers every public method of the class in the route table', () => {
    // Ties the table to the SURFACE: a method added to ServerClient without a
    // row here would otherwise ship with no path assertion at all, which is the
    // state seven of the twelve were in before this suite grew.
    const publicMethods = Object.getOwnPropertyNames(ServerClient.prototype)
      // `call` is the private shared helper; TS `private` is erased at runtime.
      .filter((n) => n !== 'constructor' && n !== 'call')
      .sort();
    const covered = [...new Set(ROUTE_ROWS.map((r) => r.methodName))].sort();
    expect(covered).toEqual(publicMethods);
  });
});

describe('ServerClient flairedIds null-versus-empty contract', () => {
  it('returns the ids, keeping only the strings', async () => {
    // The reconcile treats every id it gets back as "still flaired"; a stray
    // number would stringify into an id that matches nobody and silently drop
    // that member's flair.
    const { client } = clientReturning({ ids: ['a', 1, null, 'b', { id: 'c' }] });
    expect(await client.flairedIds()).toEqual(['a', 'b']);
  });

  it('returns an EMPTY ARRAY for a real "nothing flagged" answer', async () => {
    const { client } = clientReturning({ ids: [] });
    expect(await client.flairedIds()).toEqual([]);
  });

  it('returns NULL when the server is unreachable or the payload is malformed', async () => {
    // Null means "change nothing" per the method's own doc comment. Collapsing
    // it to an empty array would tell the departed-member reconcile that every
    // linked member lost their flair, and strip the lot.
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const timers = fakeTimers();

    const unreachable = new ServerClient(
      'http://host',
      'sekrit',
      recordingFetch(() => fakeResponse({ status: 503 })).impl,
      timers.seam,
    );
    expect(await unreachable.flairedIds()).toBe(null);

    for (const ids of [undefined, null, 'a,b', { 0: 'a' }, 7]) {
      const { client } = clientReturning({ ids });
      expect(await client.flairedIds()).toBe(null);
    }
  });
});

describe('ServerClient flexBatch', () => {
  it('pins the batch cap at the server literal', () => {
    // The server caps the id ARRAY at 1000 (FLEX_BATCH_CAP in server/internal.ts)
    // and keeps the first 1000, so a caller that batches above this loses the
    // tail with a 200 to show for it.
    expect(FLEX_BATCH_LIMIT).toBe(1000);
  });

  it('sends the id list VERBATIM: no slice at the cap and no de-duplication', async () => {
    // Batching belongs to the caller. A slice here would drop ids without saying
    // so, and the `requested` echo is the caller's only way to tell a truncated
    // request from a genuinely unlinked set: it counts what the caller BELIEVES
    // it sent, so a client that quietly changed the list would make the echo
    // answer a question nobody asked.
    const overCap = [...Array(FLEX_BATCH_LIMIT + 2)].map((_v, i) => `u${i}`);
    const withRepeats = [...overCap, 'u0', 'u1'];
    const { calls, client } = clientReturning({ requested: FLEX_BATCH_LIMIT, members: [] });

    await client.flexBatch(withRepeats);

    const sent = JSON.parse(String(calls[0].init.body)).discord_user_ids as string[];
    // Past the cap, so the assertion cannot pass on a list that never reached it.
    expect(sent.length).toBe(FLEX_BATCH_LIMIT + 4);
    expect(sent[FLEX_BATCH_LIMIT + 1]).toBe(`u${FLEX_BATCH_LIMIT + 1}`);
    expect(sent.slice(-2)).toEqual(['u0', 'u1']);
  });

  it('sends the discord_user_ids key even for an empty ask', async () => {
    // The server reads body.discord_user_ids and answers an absent key with an
    // empty list, so a renamed key looks exactly like "nobody is linked".
    const { calls, client } = clientReturning({ requested: 0, members: [] });
    await client.flexBatch([]);
    expect(calls[0].init.body).toBe('{"discord_user_ids":[]}');
  });

  it('returns requested and members unwrapped from the envelope', async () => {
    const { client } = clientReturning({
      requested: 2,
      members: [
        {
          discord_user_id: 'u1',
          linked: true,
          found: true,
          username: 'ann',
          statusTier: 3,
          points: 12,
          character: { name: 'Annthar', class: 'warrior', level: 20, profileUrl: '/c/Annthar' },
        },
        {
          discord_user_id: 'u2',
          linked: true,
          found: false,
          username: null,
          statusTier: 0,
          points: 0,
          character: null,
        },
      ],
    });

    // Spelled out fresh rather than compared against the response object: the
    // fake hands the client the very object it would then be asserted against,
    // and a self-comparison passes however the client mangles it.
    expect(await client.flexBatch(['u1', 'u2'])).toEqual({
      requested: 2,
      members: [
        {
          discord_user_id: 'u1',
          linked: true,
          found: true,
          username: 'ann',
          statusTier: 3,
          points: 12,
          character: { name: 'Annthar', class: 'warrior', level: 20, profileUrl: '/c/Annthar' },
        },
        {
          discord_user_id: 'u2',
          linked: true,
          found: false,
          username: null,
          statusTier: 0,
          points: 0,
          character: null,
        },
      ],
    });
  });

  it('answers null on a non-ok status, a failed envelope, and a thrown fetch', async () => {
    // Null is the whole failure vocabulary. It matters here more than on the
    // older calls: absence from `members` MEANS unlinked, so a caller must never
    // read a failure as a well-formed answer about nobody.
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const timers = fakeTimers();
    const from = (respond: () => Promise<Response> | Response) =>
      new ServerClient('http://host', 'sekrit', recordingFetch(respond).impl, timers.seam);

    expect(await from(() => fakeResponse({ status: 500 })).flexBatch(['u1'])).toBe(null);
    expect(
      await from(() =>
        fakeResponse({
          body: { success: false, data: { requested: 1, members: [] }, error: 'no' },
        }),
      ).flexBatch(['u1']),
    ).toBe(null);
    expect(await from(() => Promise.reject(new Error('socket hang up'))).flexBatch(['u1'])).toBe(
      null,
    );
  });
});

describe('ServerClient drainOutbox', () => {
  it('returns all four streams unwrapped from the envelope', async () => {
    const { client } = clientReturning({
      relay: { items: [{ commandId: 'c1', message: 'lfg deadmines' }] },
      activity: { items: [{ kind: 'levelup', level: 20 }] },
      winners: { days: [{ day: '2026-07-31', taskName: 'gather' }] },
      linkChanges: {
        items: [
          {
            accountId: 7,
            kinds: ['link', 'flex'],
            discordUserId: 'u1',
            discordUsername: 'ann',
            discordAvatar: null,
          },
        ],
      },
    });

    // Fresh literal, not the response object: distinct payloads per stream, so
    // reading the wrong key (activity from `relay`, winners from `items`) fails
    // instead of quietly yielding undefined the consumer reads as an empty feed.
    expect(await client.drainOutbox()).toEqual({
      relay: { items: [{ commandId: 'c1', message: 'lfg deadmines' }] },
      activity: { items: [{ kind: 'levelup', level: 20 }] },
      winners: { days: [{ day: '2026-07-31', taskName: 'gather' }] },
      linkChanges: {
        items: [
          {
            accountId: 7,
            kinds: ['link', 'flex'],
            discordUserId: 'u1',
            discordUsername: 'ann',
            discordAvatar: null,
          },
        ],
      },
    });
  });

  it('answers null on a non-ok status, a failed envelope, and a thrown fetch', async () => {
    // A null here means "nothing was acknowledged", and that is exactly right:
    // the server preserves its three in-memory streams unless it answered 200,
    // so a failed poll costs one cycle of latency and nothing else.
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const timers = fakeTimers();
    const empty = { relay: { items: [] }, activity: { items: [] } };
    const from = (respond: () => Promise<Response> | Response) =>
      new ServerClient('http://host', 'sekrit', recordingFetch(respond).impl, timers.seam);

    expect(await from(() => fakeResponse({ status: 503 })).drainOutbox()).toBe(null);
    expect(
      await from(() =>
        fakeResponse({ body: { success: false, data: empty, error: 'busy' } }),
      ).drainOutbox(),
    ).toBe(null);
    expect(await from(() => Promise.reject(new Error('ECONNRESET'))).drainOutbox()).toBe(null);
  });

  it('pins the outbox deadline above the server read deadline', () => {
    // 70 s, chosen against the server's 65 s driver-side backstop
    // (DB_QUERY_TIMEOUT_MS in server/db.ts). Under it, the client could abandon a
    // poll the server goes on to answer 200 to, and a 200 is what CONSUMES the
    // three queues: those items would be delivered to nobody.
    expect(DEFAULT_OUTBOX_TIMEOUT_MS).toBe(70_000);
    expect(DEFAULT_OUTBOX_TIMEOUT_MS).toBeGreaterThan(65_000);
    expect(DEFAULT_OUTBOX_TIMEOUT_MS).toBeGreaterThan(SERVER_CALL_TIMEOUT_MS);
  });

  it('stays alive past 8000 ms and aborts at 70000 ms', async () => {
    // The two literals in one run. Firing only the ordinary per-call deadline
    // leaves the poll untouched, which is the arm that fails if drainOutbox
    // stops passing its override down to call(); the abort then lands at 70000.
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const timers = clockTimers();
    const signals: AbortSignal[] = [];
    const impl: typeof fetch = (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal as AbortSignal;
        signals.push(signal);
        signal.addEventListener('abort', () => reject(new Error('The operation was aborted')));
      });
    const client = new ServerClient('http://host', 'sekrit', impl, timers.seam);

    let settled = false;
    const pending = client.drainOutbox().then((r) => {
      settled = true;
      return r;
    });
    expect(timers.armed.map((a) => a.ms)).toEqual([70_000]);

    timers.advance(SERVER_CALL_TIMEOUT_MS);
    await flush();
    expect(signals[0].aborted).toBe(false);
    expect(settled).toBe(false);

    timers.advance(DEFAULT_OUTBOX_TIMEOUT_MS - SERVER_CALL_TIMEOUT_MS);
    expect(signals[0].aborted).toBe(true);
    expect(await pending).toBe(null);
  });

  it('leaves every OTHER call on the 8000 ms deadline', async () => {
    // The complement, and the one that fails if the override was implemented by
    // raising the shared default instead: on the same client and the same clock,
    // a roles() call started beside the poll dies at 8000 while the poll lives.
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const timers = clockTimers();
    const signals: AbortSignal[] = [];
    const impl: typeof fetch = (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal as AbortSignal;
        signals.push(signal);
        signal.addEventListener('abort', () => reject(new Error('The operation was aborted')));
      });
    const client = new ServerClient('http://host', 'sekrit', impl, timers.seam);

    const poll = client.drainOutbox();
    const roles = client.roles('u1');
    expect(timers.armed.map((a) => a.ms)).toEqual([70_000, 8000]);

    timers.advance(SERVER_CALL_TIMEOUT_MS);
    expect(signals[0].aborted).toBe(false);
    expect(signals[1].aborted).toBe(true);
    expect(await roles).toBe(null);

    timers.advance(DEFAULT_OUTBOX_TIMEOUT_MS);
    expect(await poll).toBe(null);
  });

  it('honors a caller-supplied deadline over the default', async () => {
    const timers = clockTimers();
    const { impl } = recordingFetch(() =>
      fakeResponse({
        body: {
          success: true,
          data: { relay: { items: [] }, activity: { items: [] } },
          error: null,
        },
      }),
    );
    const client = new ServerClient('http://host', 'sekrit', impl, timers.seam);

    await client.drainOutbox(1234);

    expect(timers.armed.map((a) => a.ms)).toEqual([1234]);
  });
});

describe('ServerClient pushMembersMeta silent-drop warning', () => {
  it('warns when a NON-EMPTY push processed zero rows', async () => {
    // The server coerces an over-cap body to an empty member list and still
    // answers 200 { updated: 0 }, so this is the one silent-drop signature.
    const errors: unknown[][] = [];
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      errors.push(args);
    });
    const { client } = clientReturning({ updated: 0 });

    await client.pushMembersMeta([
      { discord_user_id: 'u1', name: 'A', joinedAtMs: null, role: null },
      { discord_user_id: 'u2', name: 'B', joinedAtMs: null, role: null },
    ]);

    expect(errors).toEqual([['[bot] members-meta push of 2 processed 0 rows']]);
  });

  it('REPORTS the silent drop as a failure, not just as a log line', async () => {
    // Load bearing since the caller started diffing. The caller marks a batch as
    // successfully pushed from this return value, so answering the truthy
    // `{ updated: 0 }` here would let it record a batch the server demonstrably
    // dropped, and the diff would then suppress the retry for the life of the
    // process instead of for one sweep. Before diffing existed the roster was
    // re-pushed wholesale every sweep, so the drop healed itself and only a
    // warning was needed.
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { client } = clientReturning({ updated: 0 });
    const result = await client.pushMembersMeta([
      { discord_user_id: 'u1', name: 'A', joinedAtMs: null, role: null },
    ]);
    expect(result).toBeNull();
  });

  it('still returns the payload when rows WERE processed', async () => {
    // The complement: a real success must not be reported as a failure, or every
    // push would be retried forever and the diff would never settle.
    const { client } = clientReturning({ updated: 2 });
    const result = await client.pushMembersMeta([
      { discord_user_id: 'u1', name: 'A', joinedAtMs: null, role: null },
      { discord_user_id: 'u2', name: 'B', joinedAtMs: null, role: null },
    ]);
    expect(result).toEqual({ updated: 2 });
  });

  it('stays quiet when rows were processed, when the push was empty, and on failure', async () => {
    const errors: unknown[][] = [];
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      errors.push(args);
    });
    const member = { discord_user_id: 'u1', name: 'A', joinedAtMs: null, role: null };

    // Rows processed: nothing to report.
    await clientReturning({ updated: 1 }).client.pushMembersMeta([member]);
    // An empty push legitimately updates nothing, so the guard is on the
    // REQUEST being non-empty, not on the response alone.
    await clientReturning({ updated: 0 }).client.pushMembersMeta([]);

    expect(errors).toEqual([]);

    // A failed call returns null, which must not be read as a zero-row success.
    const timers = fakeTimers();
    const failed = new ServerClient(
      'http://host',
      'sekrit',
      recordingFetch(() => fakeResponse({ status: 500 })).impl,
      timers.seam,
    );
    await failed.pushMembersMeta([member]);
    expect(errors).toEqual([['[bot] server POST /internal/discord/members-meta -> 500']]);
  });
});

describe('ServerClient pushMembersMeta result shape', () => {
  const MEMBER = { discord_user_id: 'u1', name: 'A', joinedAtMs: null, role: null };

  it('hands the caller changed, skipped and unapplied, not just updated', async () => {
    // The server has answered all four since Phase 4. `unapplied` is the one the
    // caller cannot do without: those ids have no link row, so their meta was
    // accepted and applied to nothing, and a caller that marked them clean would
    // never re-push them once they link.
    const { client } = clientReturning({
      updated: 3,
      changed: 1,
      skipped: 1,
      unapplied: ['u3'],
    });

    const result = await client.pushMembersMeta([
      MEMBER,
      { discord_user_id: 'u2', name: 'B', joinedAtMs: 2, role: null },
      { discord_user_id: 'u3', name: 'C', joinedAtMs: 3, role: null },
    ]);

    // Fresh literal: the fake returns the same object the assertion would
    // otherwise be comparing against itself.
    expect(result).toEqual({ updated: 3, changed: 1, skipped: 1, unapplied: ['u3'] });
  });

  it('does NOT read unapplied ids as a failed push', async () => {
    // A batch where every id is unlinked is a complete, successful push: the
    // server read the records and there was nowhere to put them. Refusing it
    // would stop the sweep on a routine answer, and the refusal arm sits right
    // beside this one.
    const { client } = clientReturning({
      updated: 1,
      changed: 0,
      skipped: 0,
      unapplied: ['u1'],
    });

    expect(await client.pushMembersMeta([MEMBER])).toEqual({
      updated: 1,
      changed: 0,
      skipped: 0,
      unapplied: ['u1'],
    });
  });

  it('still refuses a non-empty push that processed zero rows, with all four fields present', async () => {
    // The L14 regression pin. The wider return type must not have relaxed the
    // one response the client treats as a hard failure: `updated: 0` on a
    // non-empty push is the server's over-cap silent-drop signature, and the
    // caller marks a batch clean from this return value.
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { client } = clientReturning({ updated: 0, changed: 0, skipped: 0, unapplied: [] });

    expect(await client.pushMembersMeta([MEMBER])).toBeNull();
  });
});

describe('ServerClient call deadline', () => {
  it('pins the per-call deadline at 8000 ms', () => {
    expect(SERVER_CALL_TIMEOUT_MS).toBe(8000);
  });

  it('arms the deadline at 8000 ms and aborts the in-flight request when it fires', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const timers = fakeTimers();
    const signals: AbortSignal[] = [];
    // A fetch that never settles on its own: only the abort ends it.
    const impl: typeof fetch = (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        if (signal) {
          signals.push(signal);
          signal.addEventListener('abort', () => reject(new Error('The operation was aborted')));
        }
      });
    const client = new ServerClient('http://host', 'sekrit', impl, timers.seam);

    const pending = client.roles('u1');
    expect(timers.armed.length).toBe(1);
    expect(timers.armed[0].ms).toBe(8000);
    expect(signals[0].aborted).toBe(false);

    timers.armed[0].fn(); // fire the deadline

    expect(signals[0].aborted).toBe(true);
    expect(await pending).toBe(null);
    expect(timers.cleared).toEqual([1]);
  });

  it('arms and clears one deadline PER call, each with its own signal', async () => {
    const timers = fakeTimers();
    const { calls, impl } = recordingFetch(() => fakeResponse({ body: ROLES_ENVELOPE }));
    const client = new ServerClient('http://host', 'sekrit', impl, timers.seam);

    await client.roles('u1');
    await client.roles('u2');

    expect(timers.armed.map((t) => t.ms)).toEqual([8000, 8000]);
    // Cleared on the success path too: without the finally, every call would
    // leak an 8 second handle.
    expect(timers.cleared).toEqual([1, 2]);
    expect(calls[0].init.signal).not.toBe(calls[1].init.signal);
  });

  it('keeps each in-flight call on its OWN handle and signal when they overlap', async () => {
    // The sequential test above cannot see a shared handle: call 2 arms after
    // call 1 has already cleared. The bot's calls genuinely overlap (the sweep
    // and the outbox poll both tick every 3 seconds, and the event handlers fire
    // between them), so a shared controller would let one call's deadline abort
    // another's request.
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const timers = fakeTimers();
    const settle: ((r: Response) => void)[] = [];
    const signals: (AbortSignal | null | undefined)[] = [];
    const impl: typeof fetch = (_input, init) => {
      signals.push(init?.signal);
      return new Promise<Response>((resolve, reject) => {
        settle.push(resolve);
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      });
    };
    const client = new ServerClient('http://host', 'sekrit', impl, timers.seam);

    const first = client.roles('u1');
    const second = client.roles('u2');
    expect(timers.armed.length).toBe(2);
    expect(signals[0]).not.toBe(signals[1]);

    // Firing only the FIRST deadline must abort only the first request.
    timers.armed[0].fn();
    expect(signals[0]?.aborted).toBe(true);
    expect(signals[1]?.aborted).toBe(false);

    expect(await first).toBe(null);
    settle[1](fakeResponse({ body: ROLES_ENVELOPE }));
    expect(await second).toEqual({ linked: true, statusTier: 3, points: 12, lifetimePoints: 40 });
    expect([...timers.cleared].sort((a, b) => Number(a) - Number(b))).toEqual([1, 2]);
  });
});

describe('ServerClient production defaults', () => {
  it('reads the global fetch and timers at CALL time, and clears the handle it armed', async () => {
    // Exactly the construction in bot/main.ts: no fetch, no timer seam. It
    // happens BEFORE the stubs deliberately, because a capture-form default
    // (`= fetch`, `= { setTimeout, clearTimeout }`) would bind the pre-stub
    // globals and never see the swap. That is the regression bot/CLAUDE.md's
    // forward-to-the-global invariant exists to prevent, and a
    // stub-then-construct ordering cannot detect it.
    const client = new ServerClient('http://host:8787', 'sekrit');

    const seen: { url: string; init: RequestInit | undefined }[] = [];
    const armed: { ms: number; handle: unknown }[] = [];
    const cleared: unknown[] = [];
    const realSetTimeout = globalThis.setTimeout;
    const realClearTimeout = globalThis.clearTimeout;
    // Both parameters, deliberately. A one-parameter stub cannot tell
    // `(...args) => fetch(...args)` from `(input) => fetch(input)`, and the
    // arity-reduced form type-checks, so every internal call would lose its
    // secret header, its method, its body, and its abort signal unnoticed.
    vi.stubGlobal('fetch', async (input: unknown, init?: RequestInit) => {
      seen.push({ url: String(input), init });
      return fakeResponse({ body: { success: true, data: { ids: ['u7'] }, error: null } });
    });
    // Delegates to the real timer so the deadline is a genuine handle the
    // client's finally can clear.
    vi.stubGlobal('setTimeout', (fn: () => void, ms?: number) => {
      const handle = realSetTimeout(fn, ms);
      armed.push({ ms: ms ?? -1, handle });
      return handle;
    });
    vi.stubGlobal('clearTimeout', (handle: unknown) => {
      cleared.push(handle);
      realClearTimeout(handle as Parameters<typeof clearTimeout>[0]);
    });

    try {
      expect(await client.flairedIds()).toEqual(['u7']);
    } finally {
      vi.unstubAllGlobals();
    }

    expect(seen.length).toBe(1);
    expect(seen[0].url).toBe('http://host:8787/internal/discord/flaired-ids');
    expect(seen[0].init?.method).toBe('GET');
    // The shared secret is the whole authentication story for /internal/*: a
    // forwarder that drops `init` would strip it and every call would 401.
    expect(seen[0].init?.headers).toEqual({
      'x-woc-discord-secret': 'sekrit',
      'Content-Type': 'application/json',
    });
    expect(seen[0].init?.signal).toBeInstanceOf(AbortSignal);
    // Exactly one arm, at the real deadline: the defaults read the globals and
    // pass the production timeout, not an injected one.
    expect(armed.map((a) => a.ms)).toEqual([8000]);
    // And the default clearTimeout really cancels THAT handle. Without this the
    // member could be a no-op and every call would leak a live 8 second timer;
    // the outbox poll runs every 3 seconds, so the backlog is permanent.
    expect(cleared).toEqual([armed[0].handle]);
  });
});
