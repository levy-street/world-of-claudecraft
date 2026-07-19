// Characterization goldens for the MAIN /api surface (the handleApi
// route table in server/main.ts). Every case drives a real request through the
// exported routeHttpRequest, which exercises the genuine CORS + prefix ladder and
// the module-scope (pool-less) GameServer, then captures the deterministic
// CONTRACT response (status + normalized body + contracted headers) into a golden
// fixture under tests/server/fixtures/main/. These goldens record what the server
// emits TODAY; they assert nothing about whether that behavior is correct, so a
// later change that renames a code or relocalizes a string updates the
// golden in the same change.
//
// Determinism rules this file obeys:
//   - It NEVER captures a 500 produced by the pool-less db (a test artifact). Every
//     captured case returns BEFORE touching Postgres, or returns an empty payload
//     because the leaderboard cache swallows the db error. Db-dependent success
//     paths (project-stats, arena ladder, populated leaderboards, the OAuth/Discord
//     success bounces) are DEFERRED, see the trailing comment block.
//   - The harness normalizer masks the dynamic fields (challengeId/nonce) by key, so
//     the native-attestation challenge golden is byte-stable across runs.
//   - The GitHub releases proxy does a network fetch; it is pinned deterministic by
//     stubbing global fetch to reject (the real graceful-degradation contract when
//     GitHub is unreachable returns an empty feed), never by editing source.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { type Dispatch, goldenMaster, makeReq } from '../helpers';
import { goldenContentTypeMismatch } from './content_type_consistency';

// A failing-auth Postgres so the pg pool constructs but every query rejects fast
// and identically. This is the "pool-less" db the guardrail describes: contract
// paths return before it, and the leaderboard cache catches its rejection and
// serves an empty (deterministic) payload.
process.env.DATABASE_URL ||= 'postgres://test:test@127.0.0.1:5433/wocc_phase3';

// routeHttpRequest is synchronous fire-and-forget (void handleApi(...)), so the
// dispatcher must poll res.writableEnded before the captured triple is readable.
const MAX_POLL_TICKS = 200_000;
// See the matching comment in parity.test.ts: a local dev Postgres reachable on
// the dummy DATABASE_URL's port turns the leaderboard cases' DB reads (and this
// suite's cold ensureSchema boot) into real work that can exceed vitest's
// default 10s hookTimeout.
const BEFORE_ALL_HOOK_TIMEOUT_MS = 60_000;
// Where this surface's goldens live: tests/server/fixtures/main/.
const FIXTURE_DIR = `${__dirname}/../fixtures/main`;

// Header names + sentinel values used by the contract cases (named, never inline).
const HEADER_CONTENT_LENGTH = 'content-length';
// Far above any player-card byte cap, so the pre-auth 413 reject fires before the db.
const OVERSIZE_CONTENT_LENGTH = '999999999';
const DEV_COMMANDS_ENV = 'ALLOW_DEV_COMMANDS';
const DISCORD_ENV_KEYS = [
  'DISCORD_CLIENT_ID',
  'DISCORD_CLIENT_SECRET',
  'DISCORD_GUILD_ID',
] as const;

function clearDiscordConfigEnv(): void {
  for (const key of DISCORD_ENV_KEYS) delete process.env[key];
}

async function loadDispatch(): Promise<Dispatch> {
  const main = await import('../../../server/main');
  return async (req, res) => {
    main.routeHttpRequest(req, res);
    let ticks = 0;
    while (!(res as unknown as { writableEnded: boolean }).writableEnded) {
      if (ticks++ > MAX_POLL_TICKS) throw new Error('response never ended');
      await new Promise((r) => setImmediate(r));
    }
  };
}

let dispatch: Dispatch;
let main: typeof import('../../../server/main');
let savedDiscordEnv: Partial<Record<(typeof DISCORD_ENV_KEYS)[number], string | undefined>>;

beforeAll(async () => {
  savedDiscordEnv = {};
  for (const key of DISCORD_ENV_KEYS) {
    savedDiscordEnv[key] = process.env[key];
  }
  clearDiscordConfigEnv();
  main = await import('../../../server/main');
  // server/db.ts loads .env during the main import, so clear again after import.
  clearDiscordConfigEnv();
  // These goldens characterize the LEGACY handleApi ladder. The boot default
  // flipped to 'new', so pin the dispatch mode to 'legacy' EXPLICITLY here:
  // otherwise status_get and search_get_noauth_401 would capture the migrated
  // new-pipeline shapes, which are intentionally DIFFERENT (the statusNameListTrim
  // and realmsSearchAuthzGapClose deviations). Making it explicit keeps this the
  // legacy characterization it has always been, immune to the default flip.
  main.setApiDispatchModeForTests('legacy');
  dispatch = await loadDispatch();
}, BEFORE_ALL_HOOK_TIMEOUT_MS);

afterAll(() => {
  for (const key of DISCORD_ENV_KEYS) {
    const value = savedDiscordEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

// One golden per case: 'written' on the first ever run (fixture absent -> written),
// 'match' on every run thereafter; a 'mismatch' fails the case.
async function characterize(fixture: string, req: ReturnType<typeof makeReq>): Promise<void> {
  const fixturePath = `${FIXTURE_DIR}/${fixture}.json`;
  const r = await goldenMaster({ dispatch, req, fixturePath });
  expect(r.status, r.status === 'mismatch' ? `${fixture}\n${r.actual}` : fixture).not.toBe(
    'mismatch',
  );
  // The captured golden's content-type must match its route's classified class.
  const ctMismatch = goldenContentTypeMismatch(req.method ?? 'GET', req.url ?? '', fixturePath);
  expect(ctMismatch, ctMismatch ?? fixture).toBeNull();
}

async function characterizeDiscordUnconfigured(
  fixture: string,
  req: ReturnType<typeof makeReq>,
): Promise<void> {
  clearDiscordConfigEnv();
  await characterize(fixture, req);
}

describe('main /api characterization: preflight + dispatcher fallthrough', () => {
  it('OPTIONS /api/login returns the 204 preflight short-circuit (no body)', async () => {
    await characterize('options_login_204', makeReq({ method: 'OPTIONS', url: '/api/login' }));
  });

  it('GET /api/site-presence is method-gated 405 ok:false (handler-level, not handleApi)', async () => {
    await characterize(
      'site_presence_get_405',
      makeReq({ method: 'GET', url: '/api/site-presence' }),
    );
  });

  it('GET an unknown /api endpoint falls through to 404 unknown endpoint', async () => {
    await characterize(
      'unknown_endpoint_404',
      makeReq({ method: 'GET', url: '/api/this-route-does-not-exist' }),
    );
  });

  it('GET /api/perf with the dev gate off is 404 unknown endpoint', async () => {
    const saved = process.env[DEV_COMMANDS_ENV];
    process.env[DEV_COMMANDS_ENV] = '0';
    try {
      await characterize('perf_devgate_off_404', makeReq({ method: 'GET', url: '/api/perf' }));
    } finally {
      if (saved === undefined) delete process.env[DEV_COMMANDS_ENV];
      else process.env[DEV_COMMANDS_ENV] = saved;
    }
  });
});

describe('main /api characterization: public read contracts (no db / empty cache)', () => {
  it('GET /api/status returns the in-memory realm + online snapshot', async () => {
    await characterize('status_get', makeReq({ method: 'GET', url: '/api/status' }));
  });

  it('GET /api/realms (unauthenticated) returns the realm directory with empty counts', async () => {
    await characterize('realms_get_noauth', makeReq({ method: 'GET', url: '/api/realms' }));
  });

  it('POST /api/native-attestation/challenge returns a masked challenge (id + nonce + ttl)', async () => {
    await characterize(
      'native_attestation_challenge_post',
      makeReq({ method: 'POST', url: '/api/native-attestation/challenge', body: {} }),
    );
  });
});

describe('main /api characterization: GitHub releases proxy (network stubbed to empty)', () => {
  beforeEach(() => {
    // Pin the proxy deterministic: a rejected fetch exercises the real
    // graceful-degradation contract (an unreachable GitHub yields an empty feed),
    // never the live, non-deterministic release list.
    vi.stubGlobal('fetch', () =>
      Promise.reject(new Error('network disabled for characterization')),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('GET /api/releases serves the empty feed when GitHub is unreachable', async () => {
    await characterize('releases_get_empty', makeReq({ method: 'GET', url: '/api/releases' }));
  });
});

describe('main /api characterization: leaderboard payload shapes (empty cache)', () => {
  // Unlike the rest of this file's contract paths, the leaderboard board reads
  // (getLeaderboard/getGuildLeaderboard/getDeedsLeaderboard) genuinely await the
  // db pool before falling back to an empty page. A dummy DATABASE_URL that
  // nothing answers on rejects fast, but a contributor whose local dev Postgres
  // happens to be reachable on that same port pays a real query round trip;
  // give these three real headroom above vitest's 5s default.
  const LEADERBOARD_TEST_TIMEOUT_MS = 30_000;

  it(
    'GET /api/leaderboard default paged board',
    async () => {
      await characterize(
        'leaderboard_default',
        makeReq({ method: 'GET', url: '/api/leaderboard' }),
      );
    },
    LEADERBOARD_TEST_TIMEOUT_MS,
  );

  it(
    'GET /api/leaderboard?board=guilds guild board',
    async () => {
      await characterize(
        'leaderboard_guilds',
        makeReq({ method: 'GET', url: '/api/leaderboard?board=guilds' }),
      );
    },
    LEADERBOARD_TEST_TIMEOUT_MS,
  );

  it(
    'GET /api/leaderboard?board=deeds Renown board (anonymous, empty cache)',
    async () => {
      // The account-level Renown board: fixed scope 'global', metric 'renown',
      // no self row for an anonymous caller. The pool-less refresh serves the
      // deterministic empty page, like the other board fixtures.
      await characterize(
        'leaderboard_deeds',
        makeReq({ method: 'GET', url: '/api/leaderboard?board=deeds' }),
      );
    },
    LEADERBOARD_TEST_TIMEOUT_MS,
  );

  it(
    'GET /api/leaderboard?scope=global global scope',
    async () => {
      await characterize(
        'leaderboard_scope_global',
        makeReq({ method: 'GET', url: '/api/leaderboard?scope=global' }),
      );
    },
    LEADERBOARD_TEST_TIMEOUT_MS,
  );

  it(
    'GET /api/leaderboard?scope=realm realm scope',
    async () => {
      await characterize(
        'leaderboard_scope_realm',
        makeReq({ method: 'GET', url: '/api/leaderboard?scope=realm' }),
      );
    },
    LEADERBOARD_TEST_TIMEOUT_MS,
  );

  it(
    'GET /api/leaderboard?limit=5 legacy single-page board',
    async () => {
      await characterize(
        'leaderboard_limit5',
        makeReq({ method: 'GET', url: '/api/leaderboard?limit=5' }),
      );
    },
    LEADERBOARD_TEST_TIMEOUT_MS,
  );
});

describe('main /api characterization: binary request class (player card)', () => {
  it('POST /api/card over the size cap is a pre-auth 413 with Connection: close', async () => {
    await characterize(
      'card_too_large_413',
      makeReq({
        method: 'POST',
        url: '/api/card',
        headers: { [HEADER_CONTENT_LENGTH]: OVERSIZE_CONTENT_LENGTH },
      }),
    );
  });
});

describe('main /api characterization: email link endpoints (public, no token = no db)', () => {
  it('GET /api/email/unsubscribe with no token returns ok:true before any db read', async () => {
    await characterize(
      'email_unsubscribe_no_token',
      makeReq({ method: 'GET', url: '/api/email/unsubscribe' }),
    );
  });

  // The verify endpoint short-circuits on an empty token with a 400 application/json
  // body BEFORE consumeEmailChangeRequest (its only db call). This pins the route's
  // real content-type (JSON, not HTML) so the classification cannot silently drift.
  it('GET /api/account/email/verify with no token returns the 400 invalid-link JSON', async () => {
    await characterize(
      'email_verify_no_token_400',
      makeReq({ method: 'GET', url: '/api/account/email/verify' }),
    );
  });
});

// Wrong-method-on-a-known-path baseline for the planned405BeforeAuth deviation:
// today a known path requested with an unsupported method falls through to the
// shared 404 "unknown endpoint" arm (no method-aware 405). The table router
// flips these to a uniform pre-auth 405; these goldens anchor today's 404 so that
// change diffs against a real baseline rather than an unstated assumption.
describe('main /api characterization: wrong-method fallthrough (planned 405 baseline)', () => {
  it('GET /api/register (POST-only path, wrong method) is today a 404 unknown endpoint', async () => {
    await characterize(
      'register_get_wrong_method_404',
      makeReq({ method: 'GET', url: '/api/register' }),
    );
  });

  it('POST /api/me/characters (GET-only path, wrong method) is today a 404 unknown endpoint', async () => {
    await characterize(
      'me_characters_post_wrong_method_404',
      makeReq({ method: 'POST', url: '/api/me/characters', body: {} }),
    );
  });
});

describe('main /api characterization: Discord contract paths (unconfigured / no auth)', () => {
  it('POST /api/auth/discord/start is 503 when Discord is unconfigured', async () => {
    await characterizeDiscordUnconfigured(
      'discord_start_unconfigured_503',
      makeReq({ method: 'POST', url: '/api/auth/discord/start', body: {} }),
    );
  });

  it('GET /api/discord without a bearer token is 401 not authenticated', async () => {
    await characterize(
      'discord_status_get_noauth_401',
      makeReq({ method: 'GET', url: '/api/discord' }),
    );
  });

  it('DELETE /api/discord without a bearer token is 401 not authenticated', async () => {
    await characterize(
      'discord_unlink_delete_noauth_401',
      makeReq({ method: 'DELETE', url: '/api/discord' }),
    );
  });

  it('GET /api/auth/discord/callback unconfigured returns the 503 error bounce (no token)', async () => {
    await characterizeDiscordUnconfigured(
      'discord_callback_error_bounce',
      makeReq({ method: 'GET', url: '/api/auth/discord/callback?code=x&state=y' }),
    );
  });
});

describe('main /api characterization: bearer-auth denial contracts (no Authorization)', () => {
  it('GET /api/characters (full session) without auth is 401', async () => {
    await characterize(
      'characters_get_noauth_401',
      makeReq({ method: 'GET', url: '/api/characters' }),
    );
  });

  it('GET /api/me/characters (read scope) without auth is 401', async () => {
    await characterize(
      'me_characters_get_noauth_401',
      makeReq({ method: 'GET', url: '/api/me/characters' }),
    );
  });

  it('GET /api/account without auth is 401', async () => {
    await characterize('account_get_noauth_401', makeReq({ method: 'GET', url: '/api/account' }));
  });

  it('POST /api/account/logout without auth is 401', async () => {
    await characterize(
      'account_logout_post_noauth_401',
      makeReq({ method: 'POST', url: '/api/account/logout', body: {} }),
    );
  });

  it('GET /api/wallet without auth is 401', async () => {
    await characterize('wallet_get_noauth_401', makeReq({ method: 'GET', url: '/api/wallet' }));
  });

  it('GET /api/referrals without auth is 401', async () => {
    await characterize(
      'referrals_get_noauth_401',
      makeReq({ method: 'GET', url: '/api/referrals' }),
    );
  });

  it('POST /api/reports without auth is 401 (auth resolves before the body)', async () => {
    await characterize(
      'reports_post_noauth_401',
      makeReq({ method: 'POST', url: '/api/reports', body: {} }),
    );
  });

  it('GET /api/search without auth is 401', async () => {
    await characterize(
      'search_get_noauth_401',
      makeReq({ method: 'GET', url: '/api/search?q=ab' }),
    );
  });

  it('GET /api/characters/:id/sheet (read scope, path param) without auth is 401', async () => {
    await characterize(
      'owner_sheet_get_noauth_401',
      makeReq({ method: 'GET', url: '/api/characters/1/sheet' }),
    );
  });

  it('GET /api/characters/:id/standing (full session, path param) without auth is 401', async () => {
    await characterize(
      'standing_get_noauth_401',
      makeReq({ method: 'GET', url: '/api/characters/1/standing' }),
    );
  });
});

describe('main /api characterization: register + login validation (empty body, pre-db)', () => {
  it('POST /api/register with an empty body is the 400 username-shape rejection', async () => {
    await characterize(
      'register_post_empty_400',
      makeReq({ method: 'POST', url: '/api/register', body: {} }),
    );
  });

  it('POST /api/login with an empty body is the 401 anti-enumeration rejection', async () => {
    await characterize(
      'login_post_empty_401',
      makeReq({ method: 'POST', url: '/api/login', body: {} }),
    );
  });
});

describe('main /api characterization: late-arrival backfill (github + desktop-login + daily-rewards)', () => {
  // These routes arrived via release merges AFTER the original capture (the
  // v0.18.0 github family, the v0.19.0 desktop-login pair and daily-rewards
  // player trio), so their db-free contract points are backfilled here
  // write-if-absent, freezing the legacy contract on disk before the dispatch
  // default flipped to 'new'. The desktop-login create 401 reflects the full-scope
  // arm (bearerActiveAccount), identical prose to the pre-fix no-auth reject.
  it('POST /api/auth/github/start with no auth is the bearer 401', async () => {
    await characterize(
      'github_start_post_noauth_401',
      makeReq({ method: 'POST', url: '/api/auth/github/start', body: {} }),
    );
  });

  it('GET /api/auth/github/callback with the feature unconfigured is the 503 HTML bounce', async () => {
    const savedId = process.env.GITHUB_OAUTH_CLIENT_ID;
    const savedSecret = process.env.GITHUB_OAUTH_CLIENT_SECRET;
    delete process.env.GITHUB_OAUTH_CLIENT_ID;
    delete process.env.GITHUB_OAUTH_CLIENT_SECRET;
    try {
      await characterize(
        'github_callback_unconfigured_503',
        makeReq({ method: 'GET', url: '/api/auth/github/callback?code=x&state=y' }),
      );
    } finally {
      if (savedId === undefined) delete process.env.GITHUB_OAUTH_CLIENT_ID;
      else process.env.GITHUB_OAUTH_CLIENT_ID = savedId;
      if (savedSecret === undefined) delete process.env.GITHUB_OAUTH_CLIENT_SECRET;
      else process.env.GITHUB_OAUTH_CLIENT_SECRET = savedSecret;
    }
  });

  it('GET /api/github with no auth is the bearer 401', async () => {
    await characterize(
      'github_status_get_noauth_401',
      makeReq({ method: 'GET', url: '/api/github' }),
    );
  });

  it('DELETE /api/github with no auth is the bearer 401', async () => {
    await characterize(
      'github_unlink_delete_noauth_401',
      makeReq({ method: 'DELETE', url: '/api/github' }),
    );
  });

  it('POST /api/desktop-login/create with no auth is the bearer 401 (full-scope arm)', async () => {
    await characterize(
      'desktop_login_create_post_noauth_401',
      makeReq({ method: 'POST', url: '/api/desktop-login/create', body: {} }),
    );
  });

  it('POST /api/desktop-login/exchange with an invalid code is the 401 (in-process code store)', async () => {
    await characterize(
      'desktop_login_exchange_post_bad_code_401',
      makeReq({ method: 'POST', url: '/api/desktop-login/exchange', body: { code: 'nope' } }),
    );
  });

  it('GET /api/daily-rewards with no auth is the bearer 401 (prefix arm)', async () => {
    await characterize(
      'daily_rewards_status_get_noauth_401',
      makeReq({ method: 'GET', url: '/api/daily-rewards' }),
    );
  });

  it('POST /api/daily-rewards/spin with no auth is the bearer 401 (prefix arm)', async () => {
    await characterize(
      'daily_rewards_spin_post_noauth_401',
      makeReq({ method: 'POST', url: '/api/daily-rewards/spin', body: {} }),
    );
  });

  it('GET /api/daily-rewards/history with no auth is the bearer 401 (prefix arm)', async () => {
    await characterize(
      'daily_rewards_history_get_noauth_401',
      makeReq({ method: 'GET', url: '/api/daily-rewards/history' }),
    );
  });
});

afterAll(() => {
  vi.unstubAllGlobals();
  main.resetApiDispatchModeForTests();
});

// DEFERRED /api routes (db- or network-dependent success paths; capturing them
// here would either bless a pool-less 500 or record a non-deterministic body):
//   - GET  /api/project-stats          getAccountsCount() hits the db -> pool-less 500.
//   - GET  /api/arena/leaderboard      topArenaRatings() hits the db per request -> 500.
//   - GET  /api/woc/balance            live Solana RPC fetch -> non-deterministic.
//   - GET  /api/email/unsubscribe?token=<non-empty>   accountByUnsubscribeToken() -> db 500.
//   - GET  /api/search?q=<term> WITH a valid bearer    searchCharacters() -> db.
//   - the populated leaderboard / character / account success bodies (need seeded db rows).
//   - GET  /api/auth/discord/callback SUCCESS bounce   embeds a real session token VERBATIM
//     inside inlined <script> JSON the normalizer returns as-is (HTML), so it is both a
//     determinism break and a privacy-coverage flag for the reviewer. Only the error bounce
//     is captured here.
