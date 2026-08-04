// The DiscordApi request envelope and its injected IO seams. Every method funnels
// through the one private `request()`, so driving a representative call covers the
// shared envelope, and a table drives the per-method method/path/body triples that
// only that method can get wrong. The production-defaults block constructs the
// client the way bot/main.ts does (token only) to prove the defaults are still the
// real global fetch and a real setTimeout-backed sleep, which is the arm a broken
// default parameter would otherwise silently replace.
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AUDIT_LOG_REASON,
  DISCORD_CALL_TIMEOUT_MS,
  DiscordApi,
  governorFromConfig,
  ROLE_AUDIT_LOG_REASON,
  sanitizeAuditReason,
} from '../bot/discord_api';
import {
  DEFAULT_BAN_PAUSE_MS,
  DEFAULT_BREAKER_LIMIT,
  DEFAULT_FORBIDDEN_TTL_MS,
  DEFAULT_MAX_RPS,
  RateGovernor,
  type RateGovernorOptions,
} from '../bot/rate_governor';
import type { TimerHandle, TimerSeam } from '../bot/server_client';
import { syntheticClock } from './helpers/synthetic_clock';

const API = 'https://discord.com/api/v10';

interface FetchCall {
  url: string;
  init: RequestInit;
}

/** A response carrying only the fields `request()` touches. `reads` records every
 *  body read, so a test can prove a body was never parsed. */
function fakeResponse(
  opts: {
    status?: number;
    body?: unknown;
    text?: string;
    reads?: string[];
    jsonThrows?: boolean;
    textThrows?: boolean;
    headers?: Record<string, string>;
  } = {},
): Response {
  const status = opts.status ?? 200;
  const headers = opts.headers ?? {};
  return {
    ok: status >= 200 && status < 300,
    status,
    // Modeled on a real Headers: iteration hands back (value, key) in that
    // order, which is the argument order the shell's collector relies on.
    headers: {
      forEach: (fn: (value: string, key: string) => void) => {
        for (const [key, value] of Object.entries(headers)) fn(value, key);
      },
    },
    json: async () => {
      opts.reads?.push('json');
      if (opts.jsonThrows) throw new SyntaxError('Unexpected token < in JSON');
      return opts.body;
    },
    text: async () => {
      opts.reads?.push('text');
      if (opts.textThrows) throw new Error('body already consumed');
      // A 429 body is read as TEXT and parsed from that, so a fixture that only
      // sets `body` still has to serialize into the text view the way a real
      // Response would; otherwise every JSON 429 would look like a ban page.
      if (opts.text !== undefined) return opts.text;
      return opts.body === undefined ? '' : JSON.stringify(opts.body);
    },
  } as unknown as Response;
}

/** A governor wired to a synthetic clock, so no shell test ever waits for real. */
function testGovernor(overrides: Partial<RateGovernorOptions> = {}): {
  governor: RateGovernor;
  slept: number[];
  logs: { level: string; message: string; fields: Record<string, string | number> }[];
} {
  const slept: number[] = [];
  const logs: { level: string; message: string; fields: Record<string, string | number> }[] = [];
  let now = 0;
  const governor = new RateGovernor({
    clock: {
      now: () => now,
      sleep: async (ms) => {
        slept.push(ms);
        now += ms;
      },
    },
    maxRps: 1000,
    banPauseMs: DEFAULT_BAN_PAUSE_MS,
    breakerLimit: DEFAULT_BREAKER_LIMIT,
    forbiddenTtlMs: DEFAULT_FORBIDDEN_TTL_MS,
    log: (level, message, fields) => logs.push({ level, message, fields }),
    ...overrides,
  });
  return { governor, slept, logs };
}

function recordingFetch(responses: Response[]): { calls: FetchCall[]; impl: typeof fetch } {
  const calls: FetchCall[] = [];
  const queue = [...responses];
  const impl: typeof fetch = async (input, init) => {
    calls.push({ url: String(input), init: init ?? {} });
    const next = queue.shift();
    if (!next) throw new Error('recordingFetch ran out of queued responses');
    return next;
  };
  return { calls, impl };
}

/** A TimerSeam that records rather than runs, so a deadline fires on command. */
function manualTimers(): {
  armed: { ms: number; fn: () => void }[];
  cleared: TimerHandle[];
  seam: TimerSeam;
} {
  const armed: { ms: number; fn: () => void }[] = [];
  const cleared: TimerHandle[] = [];
  let nextHandle = 1;
  return {
    armed,
    cleared,
    seam: {
      setTimeout: (fn, ms) => {
        armed.push({ fn, ms });
        return nextHandle++;
      },
      clearTimeout: (handle) => {
        cleared.push(handle);
      },
    },
  };
}

/** The AbortError shape `fetch` rejects with, without reaching for DOMException. */
function abortError(): Error {
  return Object.assign(new Error('The operation was aborted'), { name: 'AbortError' });
}

/** A fetch that never answers, and rejects only when its signal is aborted. */
function hangingFetch(): { impl: typeof fetch; signals: AbortSignal[] } {
  const signals: AbortSignal[] = [];
  const impl: typeof fetch = (_input, init) => {
    const signal = init?.signal ?? undefined;
    if (signal) signals.push(signal);
    return new Promise<Response>((_resolve, reject) => {
      signal?.addEventListener('abort', () => reject(abortError()));
    });
  };
  return { impl, signals };
}

/** Let every already-resolved continuation run, without moving any clock. */
async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 50; i++) await Promise.resolve();
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('DiscordApi request envelope', () => {
  it('sends the bot token, the JSON content type, and the pinned User-Agent to /api/v10', async () => {
    const { calls, impl } = recordingFetch([fakeResponse({ body: { url: 'wss://gw.test' } })]);
    const api = new DiscordApi('tok', impl);

    expect(await api.gatewayUrl()).toBe('wss://gw.test');

    expect(calls.length).toBe(1);
    expect(calls[0].url).toBe('https://discord.com/api/v10/gateway/bot');
    expect(calls[0].init.method).toBe('GET');
    expect(calls[0].init.headers).toEqual({
      // `Bot ` prefix, not `Bearer`: a bot token is rejected as a bearer token.
      Authorization: 'Bot tok',
      'Content-Type': 'application/json',
      'User-Agent': 'WorldOfClaudeCraftBot (https://worldofclaudecraft.com, 1.0)',
    });
    // No body key value on a GET.
    expect(calls[0].init.body).toBe(undefined);
  });

  it('falls back to the public gateway URL when the payload has none', async () => {
    const { impl } = recordingFetch([fakeResponse({ body: {} })]);
    expect(await new DiscordApi('tok', impl).gatewayUrl()).toBe('wss://gateway.discord.gg');
  });

  it('falls back to the public gateway URL for an EMPTY url, not just a missing one', async () => {
    // `||`, not `??`: Discord answering with an empty string would otherwise
    // hand the Gateway '' and every connect would target the bare query string.
    const { impl } = recordingFetch([fakeResponse({ body: { url: '' } })]);
    expect(await new DiscordApi('tok', impl).gatewayUrl()).toBe('wss://gateway.discord.gg');
  });

  it('returns null on a 204 WITHOUT reading the body', async () => {
    // The empty-body short circuit, pinned by the absent read rather than by the
    // return value alone: a 204 has no body, so falling through to resp.json()
    // relies entirely on its .catch to paper over the parse failure.
    const reads: string[] = [];
    const { impl } = recordingFetch([fakeResponse({ status: 204, reads })]);

    expect(await new DiscordApi('tok', impl).createGuildRole('g1', 'WoC Initiate')).toBe(null);
    expect(reads).toEqual([]);
  });

  it('returns null rather than throwing when a 200 body is not JSON', async () => {
    // Cloudflare and Discord both answer with HTML on some errors; the parse
    // guard is what stops that from throwing an unexpected shape at the caller.
    const { impl } = recordingFetch([fakeResponse({ jsonThrows: true })]);
    expect(await new DiscordApi('tok', impl).createGuildRole('g1', 'WoC Initiate')).toBe(null);
  });

  it('throws with the status and the response text TRUNCATED to 200 characters', async () => {
    const { impl } = recordingFetch([fakeResponse({ status: 403, text: 'x'.repeat(300) })]);
    const api = new DiscordApi('tok', impl);

    // An Error argument is message EQUALITY in vitest; a bare string would be a
    // substring match, which a 300-character slice would also satisfy, leaving
    // the truncation this test is named for completely unpinned.
    await expect(api.guildRoles('g1')).rejects.toThrow(
      new Error(`[bot] discord GET /guilds/g1/roles -> 403 ${'x'.repeat(200)}`),
    );
  });

  it('still throws with the status when the error body cannot be read', async () => {
    const { impl } = recordingFetch([fakeResponse({ status: 500, textThrows: true })]);
    await expect(new DiscordApi('tok', impl).guildRoles('g1')).rejects.toThrow(
      new Error('[bot] discord GET /guilds/g1/roles -> 500 '),
    );
  });

  it('normalizes a non-array roles payload to an empty array', async () => {
    // Discord answers this route with an error OBJECT on a permissions change;
    // without the guard the caller's role diff iterates a non-array and throws.
    const { impl } = recordingFetch([fakeResponse({ body: { message: 'Missing Access' } })]);
    expect(await new DiscordApi('tok', impl).guildRoles('g1')).toEqual([]);
  });
});

describe('DiscordApi per-method call envelopes', () => {
  // Every row is a method whose ONLY wire contract is its verb, path, and body.
  // A copy-paste slip between the add/remove role pair, or a lost EPHEMERAL
  // flag, is invisible to the shared-envelope tests above.
  const ROWS: {
    name: string;
    drive: (api: DiscordApi) => Promise<unknown>;
    method: string;
    path: string;
    body: string | undefined;
    response?: Response;
  }[] = [
    {
      name: 'registerGuildCommands',
      drive: (api) => api.registerGuildCommands('c1', 'g1', [{ name: 'whoami' }]),
      method: 'PUT',
      path: '/applications/c1/guilds/g1/commands',
      body: '[{"name":"whoami"}]',
    },
    {
      name: 'respondInteraction',
      drive: (api) => api.respondInteraction('i1', 'tkn', { content: 'hi' }),
      method: 'POST',
      path: '/interactions/i1/tkn/callback',
      // type 4 is CHANNEL_MESSAGE_WITH_SOURCE: the immediate visible reply.
      body: '{"type":4,"data":{"content":"hi"}}',
    },
    {
      name: 'deferInteraction (ephemeral)',
      drive: (api) => api.deferInteraction('i1', 'tkn', true),
      method: 'POST',
      path: '/interactions/i1/tkn/callback',
      // 64 is the EPHEMERAL flag; losing it posts a private reply publicly.
      body: '{"type":5,"data":{"flags":64}}',
    },
    {
      name: 'deferInteraction (public)',
      drive: (api) => api.deferInteraction('i1', 'tkn', false),
      method: 'POST',
      path: '/interactions/i1/tkn/callback',
      body: '{"type":5,"data":{}}',
    },
    {
      name: 'editOriginalResponse',
      drive: (api) => api.editOriginalResponse('app1', 'tkn', { content: 'done' }),
      method: 'PATCH',
      path: '/webhooks/app1/tkn/messages/@original',
      body: '{"content":"done"}',
    },
    {
      name: 'guildRoles',
      drive: (api) => api.guildRoles('g1'),
      method: 'GET',
      path: '/guilds/g1/roles',
      body: undefined,
      response: fakeResponse({ body: [] }),
    },
    {
      name: 'createGuildRole (default color)',
      drive: (api) => api.createGuildRole('g1', 'WoC Initiate'),
      method: 'POST',
      path: '/guilds/g1/roles',
      // color 0 means "no color"; hoist/mentionable false keep the tier roles
      // out of the member sidebar and out of @-mention range.
      body: '{"name":"WoC Initiate","color":0,"mentionable":false,"hoist":false}',
    },
    {
      name: 'createGuildRole (explicit color)',
      drive: (api) => api.createGuildRole('g1', 'WoC Champion', 0xff8800),
      method: 'POST',
      path: '/guilds/g1/roles',
      body: '{"name":"WoC Champion","color":16746496,"mentionable":false,"hoist":false}',
    },
    {
      name: 'addMemberRole',
      drive: (api) => api.addMemberRole('g1', 'u1', 'r1'),
      method: 'PUT',
      path: '/guilds/g1/members/u1/roles/r1',
      body: undefined,
    },
    {
      name: 'removeMemberRole',
      drive: (api) => api.removeMemberRole('g1', 'u1', 'r1'),
      method: 'DELETE',
      path: '/guilds/g1/members/u1/roles/r1',
      body: undefined,
    },
    {
      name: 'setNickname',
      drive: (api) => api.setNickname('g1', 'u1', 'Aran (12)'),
      method: 'PATCH',
      path: '/guilds/g1/members/u1',
      body: '{"nick":"Aran (12)"}',
    },
    {
      name: 'createMessage',
      drive: (api) => api.createMessage('ch1', { content: 'hello' }),
      method: 'POST',
      path: '/channels/ch1/messages',
      body: '{"content":"hello"}',
    },
  ];

  for (const row of ROWS) {
    it(`${row.name} sends ${row.method} ${row.path}`, async () => {
      const { calls, impl } = recordingFetch([row.response ?? fakeResponse({ body: {} })]);

      await row.drive(new DiscordApi('tok', impl));

      expect(calls.length).toBe(1);
      expect(calls[0].init.method).toBe(row.method);
      expect(calls[0].url).toBe(`${API}${row.path}`);
      expect(calls[0].init.body).toBe(row.body);
    });
  }
});

describe('DiscordApi 429 handling through the governor', () => {
  it('honors the FULL retry_after with no ceiling, the incident regression', async () => {
    // THE pin for this phase. The client this replaced computed
    // `Math.min(10_000, ...)`, so a 60 second Discord penalty became a 10 second
    // wait and the bot came back four times too early, every time, which is what
    // escalated the 2026-07-29 incident. 60000, not 10000.
    const { governor, slept } = testGovernor();
    const { calls, impl } = recordingFetch([
      fakeResponse({ status: 429, body: { retry_after: 60 } }),
      fakeResponse({ body: [{ id: 'r1', name: 'WoC Initiate' }] }),
    ]);

    expect(await new DiscordApi('tok', impl, governor).guildRoles('g1')).toEqual([
      { id: 'r1', name: 'WoC Initiate' },
    ]);

    expect(slept).toEqual([60_000]);
    expect(calls.length).toBe(2);
    // Both sides pinned to a literal, not just to each other: a relation-only
    // assertion holds even if BOTH requests go somewhere wrong.
    expect(calls[1].url).toBe(`${API}/guilds/g1/roles`);
    expect(calls[1].init.method).toBe('GET');
  });

  it('replays the BODY too, not just the method and path', async () => {
    // The likeliest 429 in this bot is a relay post, which a replay that dropped
    // the body would resend as an empty message.
    const { governor } = testGovernor();
    const { calls, impl } = recordingFetch([
      fakeResponse({ status: 429, body: { retry_after: 1 } }),
      fakeResponse({ body: {} }),
    ]);

    await new DiscordApi('tok', impl, governor).createMessage('ch1', { content: 'hello' });

    expect(calls.length).toBe(2);
    expect(calls[1].init.body).toBe('{"content":"hello"}');
    expect(calls[1].url).toBe(`${API}/channels/ch1/messages`);
  });

  it('logs the X-RateLimit-Scope on every 429 (D14)', async () => {
    // O5 is answered from these lines after deploy: whether member-write 429s
    // come back as `user` or `shared` decides the ban-counter exposure.
    const { governor, logs } = testGovernor();
    const { impl } = recordingFetch([
      fakeResponse({
        status: 429,
        body: { retry_after: 1 },
        headers: { 'x-ratelimit-scope': 'user' },
      }),
      fakeResponse({ body: [] }),
    ]);

    await new DiscordApi('tok', impl, governor).guildRoles('g1');

    const limited = logs.filter((l) => l.message === '[bot] discord rate limited');
    expect(limited.length).toBe(1);
    expect(limited[0].fields.scope).toBe('user');
    expect(limited[0].fields.route).toBe('GET /guilds/g1/roles');
  });

  it('treats a non-JSON 429 body as a ban: long pause, error log, NO short retry', async () => {
    // The other half of the incident. Cloudflare answers with HTML once it
    // starts refusing, and the old client parsed that to `{}`, defaulted
    // retry_after to 1, and came back one second later into an active ban.
    const { governor, slept, logs } = testGovernor();
    const { calls, impl } = recordingFetch([
      fakeResponse({ status: 429, text: '<html>error 1015</html>' }),
      fakeResponse({ body: [] }),
    ]);

    await expect(new DiscordApi('tok', impl, governor).guildRoles('g1')).rejects.toThrow(
      '-> 429 <html>error 1015</html>',
    );

    // No retry at all, and above all not a 1000 ms one.
    expect(calls.length).toBe(1);
    expect(slept).toEqual([]);
    const banned = logs.filter((l) => l.level === 'error');
    expect(banned.length).toBe(1);
    expect(banned[0].fields.pauseMs).toBe(DEFAULT_BAN_PAUSE_MS);
  });

  it('retries a 429 whose body read failed as a normal 429, never as a ban', async () => {
    // The realistic non-JSON-429 trigger is not Cloudflare: it is the call
    // deadline aborting mid-body-read, or a reset after headers, on a genuine
    // Discord 429 (which always carries a JSON body). The shell reports that as
    // jsonParsed:false WITHOUT the nonJsonBody ban signal, so the governor
    // waits the floor and retries instead of pausing the whole process for
    // banPauseMs and counting an invalid request.
    const { governor, slept, logs } = testGovernor();
    const { calls, impl } = recordingFetch([
      fakeResponse({ status: 429, textThrows: true }),
      fakeResponse({ body: [] }),
    ]);

    expect(await new DiscordApi('tok', impl, governor).guildRoles('g1')).toEqual([]);

    // One retry after the MISSING_RETRY_AFTER floor (no readable body, no
    // Retry-After header), and no ban: no error log, no ban pause counted.
    expect(calls.length).toBe(2);
    expect(slept).toEqual([1000]);
    expect(logs.filter((l) => l.level === 'error').length).toBe(0);
    expect(governor.snapshot().banPauses).toBe(0);
  });

  it('bounds the retries: a route that answers 429 forever gives up and throws', async () => {
    const { governor, slept } = testGovernor();
    const { calls, impl } = recordingFetch([
      fakeResponse({ status: 429, body: { retry_after: 1 } }),
      fakeResponse({ status: 429, body: { retry_after: 1 } }),
      fakeResponse({ status: 429, body: { retry_after: 1 }, text: 'rate limited' }),
    ]);

    await expect(new DiscordApi('tok', impl, governor).guildRoles('g1')).rejects.toThrow(
      '-> 429 rate limited',
    );
    // Three attempts, so two waits: the third gives up rather than looping.
    expect(calls.length).toBe(3);
    expect(slept).toEqual([1000, 1000]);
  });
});

describe('DiscordApi governor wiring', () => {
  it('pins the REST base to /api/v10 as a literal (D14)', async () => {
    // Spelled out rather than built from the API constant, so a change to the
    // constant cannot quietly move every call to another API version.
    const { governor } = testGovernor();
    const { calls, impl } = recordingFetch([fakeResponse({ body: {} })]);
    await new DiscordApi('tok', impl, governor).createMessage('ch1', { content: 'hi' });
    expect(calls[0].url).toBe('https://discord.com/api/v10/channels/ch1/messages');
  });

  it('sends X-Audit-Log-Reason on the member PATCH (D14)', async () => {
    const { governor } = testGovernor();
    const { calls, impl } = recordingFetch([fakeResponse({ status: 204 })]);

    await new DiscordApi('tok', impl, governor).setNickname('g1', 'u1', 'Aran (12)');

    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers['X-Audit-Log-Reason']).toBe(AUDIT_LOG_REASON);
    // Discord's own bound on the header.
    expect(AUDIT_LOG_REASON.length).toBeGreaterThanOrEqual(1);
    expect(AUDIT_LOG_REASON.length).toBeLessThanOrEqual(512);
    // Plain ASCII: a non-ASCII byte does not survive the header round trip.
    expect(/^[\x20-\x7E]+$/.test(AUDIT_LOG_REASON)).toBe(true);
  });

  it('sends its OWN X-Audit-Log-Reason on both role member edits (D14)', async () => {
    // Role grants and revokes are member edits too, and the guild audit log is
    // the operator surface D14 exists for; the pair carries the status-tier
    // reason, distinct from the nickname's level one, so an entry names which
    // sync wrote it.
    const { governor } = testGovernor();
    const { calls, impl } = recordingFetch([
      fakeResponse({ status: 204 }),
      fakeResponse({ status: 204 }),
    ]);
    const api = new DiscordApi('tok', impl, governor);

    await api.addMemberRole('g1', 'u1', 'r1');
    await api.removeMemberRole('g1', 'u1', 'r1');

    for (const call of calls) {
      const headers = call.init.headers as Record<string, string>;
      expect(headers['X-Audit-Log-Reason']).toBe(ROLE_AUDIT_LOG_REASON);
    }
    // Same Discord bounds as the nickname reason, and distinct from it so the
    // audit log can actually tell the two syncs apart.
    expect(ROLE_AUDIT_LOG_REASON.length).toBeGreaterThanOrEqual(1);
    expect(ROLE_AUDIT_LOG_REASON.length).toBeLessThanOrEqual(512);
    expect(/^[\x20-\x7E]+$/.test(ROLE_AUDIT_LOG_REASON)).toBe(true);
    expect(ROLE_AUDIT_LOG_REASON).not.toBe(AUDIT_LOG_REASON);
  });

  it('does NOT send an audit reason on calls that are not member PATCHes', async () => {
    // The all-headers equality tests above would still pass if the reason were
    // attached to every request, because they assert the header BAG; this is the
    // arm that says the option is actually per call site.
    const { governor } = testGovernor();
    const { calls, impl } = recordingFetch([fakeResponse({ body: {} })]);
    await new DiscordApi('tok', impl, governor).createMessage('ch1', { content: 'hi' });
    expect('X-Audit-Log-Reason' in (calls[0].init.headers as Record<string, string>)).toBe(false);
  });

  it('clamps and ASCII-folds an audit reason', () => {
    expect(sanitizeAuditReason('x'.repeat(600)).length).toBe(512);
    // Each non-ASCII code point becomes one space, and the surrounding ASCII is
    // left alone. Written as an ESCAPE rather than a literal accented character
    // on purpose: as a literal the expected string depends on whether the file
    // stores the accent precomposed (one code point, so one space, giving
    // 'caf  sync') or decomposed (a plain 'e' plus a combining mark, so the 'e'
    // survives, giving 'cafe  sync'). Those are different answers, so a literal
    // fixture is a test that flips the day an editor normalizes the file.
    expect(sanitizeAuditReason('caf\u00e9 sync')).toBe('caf  sync');
    // An all-non-ASCII reason still has to yield a legal 1 to 512 character
    // value, because Discord rejects an empty header outright.
    expect(sanitizeAuditReason('\u00e9\u00e9')).toBe(AUDIT_LOG_REASON);
  });

  it('redacts the interaction token out of the thrown message (L1)', async () => {
    // The token is a live bearer credential for about 15 minutes and the throw
    // reaches a bare console.error in bot/main.ts, so it must never carry it.
    const token = 'aW50ZXJhY3Rpb250b2tlbnZhbHVlMTIzNDU2Nzg5';
    const { governor } = testGovernor();
    const { impl } = recordingFetch([fakeResponse({ status: 404, text: 'Unknown interaction' })]);

    const failure = await new DiscordApi('tok', impl, governor)
      .respondInteraction('1234567890123456789', token, { content: 'hi' })
      .catch((e: Error) => e);

    expect((failure as Error).message).not.toContain(token);
    expect((failure as Error).message).toBe(
      '[bot] discord POST /interactions/1234567890123456789/:token/callback -> 404 Unknown interaction',
    );
  });

  it('keeps the guild-route message shape unchanged, ids and all', async () => {
    // Redaction is token-only: losing the ids would cost the operator the one
    // detail that makes a failure diagnosable.
    const { governor } = testGovernor();
    const { impl } = recordingFetch([fakeResponse({ status: 403, text: 'Missing Permissions' })]);
    await expect(new DiscordApi('tok', impl, governor).guildRoles('g1')).rejects.toThrow(
      new Error('[bot] discord GET /guilds/g1/roles -> 403 Missing Permissions'),
    );
  });

  it('caches a 403 member so the NEXT write for them is never sent (D4)', async () => {
    const { governor } = testGovernor();
    const { calls, impl } = recordingFetch([
      fakeResponse({ status: 403, text: 'Missing Permissions' }),
    ]);
    const api = new DiscordApi('tok', impl, governor);

    await expect(api.setNickname('g1', 'u1', 'Aran (12)')).rejects.toThrow('-> 403');
    // The recording fetch has no second queued response, so a second dispatch
    // would throw "ran out of queued responses" rather than the block message.
    await expect(api.setNickname('g1', 'u1', 'Aran (13)')).rejects.toThrow(
      'subject previously answered 400, 401 or 403',
    );
    expect(calls.length).toBe(1);
  });
});

describe('DiscordApi essential traffic survives an open breaker', () => {
  /** A governor whose breaker is already open, driven there by counted 401s. */
  async function openBreakerGovernor(): Promise<RateGovernor> {
    const { governor } = testGovernor({ breakerLimit: 2 });
    const { impl } = recordingFetch([
      fakeResponse({ status: 401, text: 'no' }),
      fakeResponse({ status: 401, text: 'no' }),
    ]);
    const api = new DiscordApi('tok', impl, governor);
    await expect(api.createMessage('c1', { content: 'a' })).rejects.toThrow('-> 401');
    await expect(api.createMessage('c2', { content: 'b' })).rejects.toThrow('-> 401');
    expect(governor.snapshot().breakerState).toBe('open');
    return governor;
  }

  // `essential: true` on the three interaction methods had no assertion anywhere:
  // deleting it from all three left every suite green, while a slash-command
  // reply would then be refused with 'breaker-open' for the whole quiet window
  // and the user would see "the application did not respond". The breaker exists
  // to stop SWEEPS, never a reply on a 3 second deadline.
  // Snowflake ids and a token-shaped token, because these three routes are the
  // ones that carry a live bearer credential. Short stand-ins ('i1', 'tok1') are
  // not variable segments, so routeTemplate keeps them verbatim and the fixture
  // stops having the shape of the path it stands in for, which is how a :token
  // redaction regression would go unnoticed here.
  const IID = '111111111111111111';
  const APPID = '222222222222222222';
  const TOKEN = 'aW50ZXJhY3Rpb250b2tlbnZhbHVlMTIzNDU2Nzg5';
  const ESSENTIAL: { name: string; call: (api: DiscordApi) => Promise<void>; path: string }[] = [
    {
      name: 'respondInteraction',
      call: (api) => api.respondInteraction(IID, TOKEN, { content: 'hi' }),
      path: `/interactions/${IID}/${TOKEN}/callback`,
    },
    {
      name: 'deferInteraction',
      call: (api) => api.deferInteraction(IID, TOKEN, true),
      path: `/interactions/${IID}/${TOKEN}/callback`,
    },
    {
      name: 'editOriginalResponse',
      call: (api) => api.editOriginalResponse(APPID, TOKEN, { content: 'done' }),
      path: `/webhooks/${APPID}/${TOKEN}/messages/@original`,
    },
  ];

  for (const row of ESSENTIAL) {
    it(`still dispatches ${row.name} while the breaker is open`, async () => {
      const governor = await openBreakerGovernor();
      const { calls, impl } = recordingFetch([fakeResponse({ status: 204 })]);
      const api = new DiscordApi('tok', impl, governor);

      await row.call(api);

      // Actually reached the network, rather than being refused unsent.
      expect(calls.length).toBe(1);
      expect(calls[0].url).toBe(`${API}${row.path}`);
      expect(governor.snapshot().breakerBlocks).toBe(0);
    });
  }

  it('refuses a non-essential member write while the breaker is open', async () => {
    // The contrast arm. Without it the three cases above would also pass for a
    // breaker that never refused anything at all.
    const governor = await openBreakerGovernor();
    const { calls, impl } = recordingFetch([fakeResponse({ status: 204 })]);
    const api = new DiscordApi('tok', impl, governor);

    await expect(api.addMemberRole('g1', 'u1', 'r1')).rejects.toThrow(
      'invalid-request breaker is open',
    );
    expect(calls.length).toBe(0);
    expect(governor.snapshot().breakerBlocks).toBe(1);
  });
});

describe('governorFromConfig', () => {
  it('maps each config knob onto its OWN governor option', async () => {
    // bot/main.ts calls `main()` at module scope, so nothing in that file is
    // reachable from a test and the construction site was unpinned: transposing
    // two knobs, or replacing all four with the DEFAULT_* constants, shipped in
    // silence. The mapping lives here so it can be observed.
    //
    // Four values that are pairwise distinct AND none of them that knob's own
    // default, so a transposition cannot land on the value it displaced and a
    // dropped option cannot be masked by the fallback. maxRps 2 is 500 ms of
    // spacing, which is distinguishable from every other number here.
    const config = {
      maxRps: 2,
      banPauseMs: 4321,
      breakerLimit: 3,
      forbiddenTtlMs: 8765,
    };
    expect(new Set(Object.values(config)).size).toBe(4);
    expect(config.maxRps).not.toBe(DEFAULT_MAX_RPS);
    expect(config.banPauseMs).not.toBe(DEFAULT_BAN_PAUSE_MS);
    expect(config.breakerLimit).not.toBe(DEFAULT_BREAKER_LIMIT);
    expect(config.forbiddenTtlMs).not.toBe(DEFAULT_FORBIDDEN_TTL_MS);

    // All four knobs are observed on the governor the FACTORY built, through its
    // injected clock and log. Observing them on a separately constructed governor
    // would be a self-comparison: it would pin the option names, not the mapping.
    const clock = syntheticClock();
    const logs: { level: string; message: string; fields: Record<string, string | number> }[] = [];
    const governor = governorFromConfig(config, clock, (level, message, fields) =>
      logs.push({ level, message, fields }),
    );

    // maxRps: two sends into DIFFERENT buckets are spaced ceil(1000 / 2) ms apart.
    const sentAt: number[] = [];
    const paced = [
      governor.run({ method: 'POST', path: '/channels/1/messages' }, async () => {
        sentAt.push(clock.now());
        return { status: 204, headers: {}, jsonParsed: false } as const;
      }),
      governor.run({ method: 'POST', path: '/channels/2/messages' }, async () => {
        sentAt.push(clock.now());
        return { status: 204, headers: {}, jsonParsed: false } as const;
      }),
    ];
    await clock.runAll();
    await Promise.all(paced);
    expect(sentAt).toEqual([0, 500]);

    // banPauseMs: a non-JSON 429 pauses for exactly the configured interval.
    const banned = governor.run({ method: 'GET', path: '/guilds/1/roles' }, async () => ({
      status: 429,
      headers: {},
      jsonParsed: false,
      nonJsonBody: true,
    }));
    await clock.runAll();
    await banned;
    const banLog = logs.find((l) => l.fields.pauseMs !== undefined);
    expect(banLog?.fields.pauseMs).toBe(config.banPauseMs);

    // breakerLimit: the ban above counted once, so two more counted failures
    // reach the configured limit of three and open it.
    expect(governor.snapshot().breakerState).toBe('closed');
    // The cache time is captured from inside the send, because the TTL is
    // measured from THERE and the clock keeps moving afterwards: advancing by the
    // TTL from a later "now" would expire the entry early and pin nothing.
    let cachedAt = -1;
    const cached = governor.run(
      { method: 'PATCH', path: '/guilds/1/members/1', subjectKey: 'nick:g1:u0' },
      async () => {
        cachedAt = clock.now();
        return { status: 403, headers: {}, jsonParsed: false };
      },
    );
    await clock.runAll();
    await cached;
    expect(governor.snapshot().breakerState).toBe('closed');

    const opener = governor.run(
      { method: 'PATCH', path: '/guilds/1/members/2', subjectKey: 'nick:g1:u1' },
      async () => ({ status: 403, headers: {}, jsonParsed: false }),
    );
    await clock.runAll();
    await opener;
    // Three counted failures (the ban 429 plus these two) reach the configured
    // limit of three. A transposed breakerLimit would trip at a different count.
    expect(governor.snapshot().breakerState).toBe('open');

    // forbiddenTtlMs: the subject cached above expires exactly at the configured
    // TTL measured from its own cache time, and not a millisecond before.
    expect(cachedAt).toBeGreaterThanOrEqual(0);
    expect(governor.isForbidden('nick:g1:u0')).toBe(true);
    await clock.advanceTo(cachedAt + config.forbiddenTtlMs - 1);
    expect(governor.isForbidden('nick:g1:u0')).toBe(true);
    await clock.advanceTo(cachedAt + config.forbiddenTtlMs);
    expect(governor.isForbidden('nick:g1:u0')).toBe(false);
  });

  it('defaults to the production clock and log when the seams are omitted', async () => {
    // The seams exist for the pin above, so the no-argument form has to stay the
    // real production client. Constructed BEFORE the global is stubbed, because a
    // capture-form default would pass a stub-then-construct test either way.
    const governor = governorFromConfig({
      maxRps: 1000,
      banPauseMs: 1,
      breakerLimit: 99,
      forbiddenTtlMs: 1,
    });
    const errors: unknown[][] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      errors.push(args);
    });

    // A non-JSON 429 is the governor's one error-level log line.
    await governor.run({ method: 'GET', path: '/guilds/1/roles' }, async () => ({
      status: 429,
      headers: {},
      jsonParsed: false,
      nonJsonBody: true,
    }));

    expect(errors.length).toBe(1);
    expect(String(errors[0][0])).toContain('[bot] discord returned a non-JSON 429');
    // The default log formats the fields, which is consoleGovernorLog's job and
    // not the governor's: a bare sink would print the object instead.
    expect(String(errors[0][0])).toContain('pauseMs=1');
    spy.mockRestore();

    // And the CLOCK half, which the log assertions above cannot reach: a
    // non-JSON 429 never sleeps, so a default clock replaced by a no-op would
    // pass everything so far. Two sends into different buckets at 2 rps make the
    // second wait out a real 500 ms slot, which the production clock serves from
    // the global setTimeout. Stubbed AFTER construction on purpose: a
    // capture-form default would pass a stub-then-construct test either way.
    const paced = governorFromConfig({
      maxRps: 2,
      banPauseMs: 1,
      breakerLimit: 99,
      forbiddenTtlMs: 1,
    });
    const delays: number[] = [];
    const realSetTimeout = globalThis.setTimeout;
    vi.stubGlobal('setTimeout', (cb: () => void, ms?: number) => {
      delays.push(ms ?? 0);
      // Fire immediately, so the test does not actually wait half a second.
      return realSetTimeout(cb, 0);
    });

    const ok = async () => ({ status: 204, headers: {}, jsonParsed: false }) as const;
    await Promise.all([
      paced.run({ method: 'POST', path: '/channels/1/messages' }, ok),
      paced.run({ method: 'POST', path: '/channels/2/messages' }, ok),
    ]);

    // The real global was asked for the slot spacing the config implies.
    // `toContain` rather than an exact array: the stub is global for this window,
    // so an unrelated runtime timer would make an equality pin flake without
    // saying anything about the default clock.
    expect(delays).toContain(500);
    vi.unstubAllGlobals();
  });
});

describe('DiscordApi per-call deadline (L10/L17)', () => {
  it('pins the deadline against a literal, well clear of an ordinary Discord answer', () => {
    // Against a literal, not against itself. Its job is to bound a socket that
    // stopped talking, not to police a slow but live Discord, so it is
    // deliberately generous: the failure it prevents is a run that never settles,
    // and the scheduler arms the next delay only after a run settles, so ONE hung
    // request stops that loop for the life of the process.
    expect(DISCORD_CALL_TIMEOUT_MS).toBe(15000);
  });

  it('aborts a call that never answers, once the deadline fires', async () => {
    const timers = manualTimers();
    const { impl, signals } = hangingFetch();
    const { governor } = testGovernor();
    const api = new DiscordApi('tok', impl, governor, timers.seam);

    const failure = api.guildRoles('g1').catch((e: Error) => e);
    await flushMicrotasks();

    // Armed at DISPATCH, with the signal handed to fetch and nothing aborted yet.
    expect(timers.armed.map((t) => t.ms)).toEqual([DISCORD_CALL_TIMEOUT_MS]);
    expect(signals.length).toBe(1);
    expect(signals[0].aborted).toBe(false);

    timers.armed[0].fn();

    const err = await failure;
    expect(signals[0].aborted).toBe(true);
    // The rejection PROPAGATES rather than being swallowed into a null: this
    // shell's convention is to throw on failure, and every scheduler task above
    // it settles by rejection, which is what the always-settle rule needs.
    expect((err as Error).name).toBe('AbortError');
    // And the timer is released on the abort path too, not only on success.
    expect(timers.cleared.length).toBe(1);
  });

  it('clears the deadline on a normal response', async () => {
    // The other half: a timer left armed after every successful call would hold
    // the event loop open and, at the sweep's request volume, accumulate.
    const timers = manualTimers();
    const { governor } = testGovernor();
    const { impl } = recordingFetch([fakeResponse({ body: [] })]);

    await new DiscordApi('tok', impl, governor, timers.seam).guildRoles('g1');

    expect(timers.armed.map((t) => t.ms)).toEqual([DISCORD_CALL_TIMEOUT_MS]);
    expect(timers.cleared).toEqual([1]);
  });

  it('arms the deadline per DISPATCH, never across the governor wait', async () => {
    // The distinction the whole placement turns on. The governor queues requests
    // and dispatches them later, and a 429 pause is honored in full, so a deadline
    // wrapped around `governor.run` would time the QUEUE WAIT and abort calls that
    // were waiting exactly as designed. Driven with a 30 second retry_after,
    // which is twice the deadline: two sends, two separate deadlines, and the
    // first one released before the wait even starts.
    const timers = manualTimers();
    const { governor, slept } = testGovernor();
    const { impl } = recordingFetch([
      fakeResponse({ status: 429, body: { retry_after: 30 } }),
      fakeResponse({ body: [] }),
    ]);

    await new DiscordApi('tok', impl, governor, timers.seam).guildRoles('g1');

    expect(slept).toEqual([30000]);
    expect(timers.armed.map((t) => t.ms)).toEqual([
      DISCORD_CALL_TIMEOUT_MS,
      DISCORD_CALL_TIMEOUT_MS,
    ]);
    // BOTH released, and the first before the 30 second sleep: a single deadline
    // spanning the pair would show one arm here instead of two.
    expect(timers.cleared).toEqual([1, 2]);
  });
});

describe('DiscordApi production defaults', () => {
  it('reads the global fetch at CALL time, not at construction', async () => {
    // Construction happens BEFORE the stub deliberately. A capture-form default
    // (`= fetch`) would bind the pre-stub global here and never see the swap,
    // which is exactly the regression bot/CLAUDE.md's forward-to-the-global
    // invariant exists to prevent, and which a stub-then-construct ordering
    // cannot detect.
    const api = new DiscordApi('tok');

    const seen: { url: string; init: RequestInit | undefined }[] = [];
    // The stub takes BOTH parameters. A one-parameter stub cannot tell
    // `(...args) => fetch(...args)` from `(input) => fetch(input)`, and the
    // latter type-checks fine (TypeScript allows an arity-reduced function
    // where a wider one is expected), so every Discord call would go out with
    // no method, no Authorization, no User-Agent, and no body while the suite
    // stayed green.
    vi.stubGlobal('fetch', async (input: unknown, init?: RequestInit) => {
      seen.push({ url: String(input), init });
      return fakeResponse({ status: 204 });
    });

    try {
      await api.setNickname('g1', 'u1', 'Aran (12)');
    } finally {
      vi.unstubAllGlobals();
    }

    expect(seen.length).toBe(1);
    expect(seen[0].url).toBe('https://discord.com/api/v10/guilds/g1/members/u1');
    expect(seen[0].init?.method).toBe('PATCH');
    expect(seen[0].init?.headers).toEqual({
      Authorization: 'Bot tok',
      'Content-Type': 'application/json',
      'User-Agent': 'WorldOfClaudeCraftBot (https://worldofclaudecraft.com, 1.0)',
      'X-Audit-Log-Reason': AUDIT_LOG_REASON,
    });
    expect(seen[0].init?.body).toBe('{"nick":"Aran (12)"}');
  });

  it('backs the DEFAULT governor clock with the real global setTimeout', async () => {
    // Fake timers prove the default clock is a genuine timer rather than an
    // accidental no-op: nothing resolves until the clock is advanced. The wait
    // is now the governor's, not a sleep parameter, but the seam it guards is
    // the same one.
    //
    // Constructed BEFORE the fake clock, per R16: the default governor is built
    // at construction, so a clock that CAPTURED setTimeout would bind the real
    // one here and never resolve under the fake clock. Installing the fake first
    // passes for both forms and therefore guards nothing.
    const api = new DiscordApi('tok');
    vi.useFakeTimers();
    let settled = false;
    let call = 0;
    vi.stubGlobal('fetch', async () => {
      call++;
      return call === 1
        ? fakeResponse({ status: 429, body: { retry_after: 5 } })
        : fakeResponse({ body: [] });
    });

    try {
      const pending = api
        .guildRoles('g1')
        .then(() => {
          settled = true;
        })
        .catch(() => {
          settled = true;
        });

      await vi.advanceTimersByTimeAsync(4999);
      expect(settled).toBe(false); // still inside the FULL 5000 ms retry_after

      // Assert BEFORE awaiting `pending`. Awaiting first would wait out a REAL
      // timer too, so a clock that captured setTimeout at construction (and
      // therefore scheduled on the real clock, ignoring the fake) would still
      // settle eventually and pass. Advancing the FAKE clock has to be what
      // resolves it.
      await vi.advanceTimersByTimeAsync(1);
      expect(settled).toBe(true);
      expect(call).toBe(2);
      await pending;
    } finally {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });

  it('arms the per-call deadline on the REAL global setTimeout', async () => {
    // The third default seam, and the one whose absence is invisible: with the
    // deadline armed on a no-op timer every call still works, and the only case
    // that ever differs is the hung socket the deadline exists for.
    //
    // Constructed BEFORE the fake clock, per R16: the default seam FORWARDS to
    // the global, so it reads the fake installed after construction. A capture
    // form would have bound the real setTimeout here and nothing below would ever
    // abort, however far the fake clock was advanced.
    const api = new DiscordApi('tok');
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      (_input: unknown, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(abortError()));
        }),
    );

    try {
      let outcome: Error | null = null;
      const pending = api.guildRoles('g1').catch((e: Error) => {
        outcome = e;
      });

      await vi.advanceTimersByTimeAsync(DISCORD_CALL_TIMEOUT_MS - 1);
      expect(outcome).toBe(null); // still inside the deadline

      await vi.advanceTimersByTimeAsync(1);
      await pending;
      expect((outcome as Error | null)?.name).toBe('AbortError');
    } finally {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });
});
