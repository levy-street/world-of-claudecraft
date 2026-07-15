// The consolidated-tunables gate: pins every consolidated server tunable to BOTH
// its literal value and (for the rate-limit policies) its derivation source, so a
// value can never drift silently and a re-inlined magic literal is caught. The
// repo's known trap is the constant-self-comparison pin (asserting only the SAME
// exported constant the code uses protects nothing); every pin here also asserts
// the literal expected number.

import * as fs from 'node:fs';
import * as http from 'node:http';
import * as path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { DESKTOP_LOGIN_TTL_MS } from '../../server/desktop_login';
import {
  ASSET_UPLOAD_POLICY,
  CARD_UPLOAD_POLICY,
  CHARACTER_CREATE_POLICY,
  CHARACTER_DELETE_POLICY,
  CHARACTER_RENAME_POLICY,
  CHARACTER_TAKEOVER_POLICY,
  CLAUDIUM_CONFIRM_POLICY,
  CLAUDIUM_CONFIRM_PRE_AUTH_POLICY,
  CLAUDIUM_PURCHASE_POLICY,
  CLAUDIUM_PURCHASE_PRE_AUTH_POLICY,
  CLAUDIUM_QUOTE_POLICY,
  CLAUDIUM_QUOTE_PRE_AUTH_POLICY,
  CLAUDIUM_SPEND_POLICY,
  CLAUDIUM_SPEND_PRE_AUTH_POLICY,
  DISCORD_POLICY,
  MAP_MUTATION_POLICY,
  PUBLIC_READ_POLICY,
  type RateLimitPolicy,
  REPORTS_CREATE_POLICY,
  STEAM_LINK_POLICY,
  WALLET_LINK_POLICY,
  WOC_BALANCE_POLICY,
} from '../../server/http/middleware/rate_limit';
import {
  applyServerTimeouts,
  HEADERS_TIMEOUT_MS,
  KEEP_ALIVE_TIMEOUT_MS,
  MAX_HEADER_SIZE_BYTES,
  REQUEST_TIMEOUT_MS,
} from '../../server/http/server_timeouts';
import { DEFAULT_JSON_BODY_MAX_BYTES } from '../../server/http_util';
import {
  MSG_RATE_BURST,
  MSG_RATE_REFILL_PER_SECOND,
  MSG_RATE_VIOLATIONS_FOR_KICK,
} from '../../server/msg_rate_limit';
import {
  ASSET_UPLOAD_MAX_PER_MINUTE,
  AUTH_MAX_PER_MINUTE,
  CARD_UPLOAD_MAX_PER_MINUTE,
  CHARACTER_MUTATION_MAX_PER_MINUTE,
  CLAUDIUM_CONFIRM_MAX_PER_MINUTE,
  CLAUDIUM_PURCHASE_MAX_PER_MINUTE,
  CLAUDIUM_QUOTE_MAX_PER_MINUTE,
  CLAUDIUM_SPEND_MAX_PER_MINUTE,
  DISCORD_MAX_PER_MINUTE,
  MAP_MUTATION_MAX_PER_MINUTE,
  PUBLIC_READ_MAX_PER_MINUTE,
  REPORTS_CREATE_MAX_PER_MINUTE,
  STEAM_LINK_MAX_PER_MINUTE,
  WALLET_LINK_MAX_PER_MINUTE,
  WINDOW_MS,
  WOC_BALANCE_MAX_PER_MINUTE,
} from '../../server/ratelimit';

// db.ts / player_card.ts / reports.ts / daily_rewards.ts evaluate a module-scope
// DATABASE_URL (throws if unset) and construct a pg Pool (no connection on
// construction). Provide a dummy URL so the dynamic imports below do not throw.
process.env.DATABASE_URL ||= 'postgres://test:test@127.0.0.1:5433/wocc_phase1_test';

const read = (rel: string): string => fs.readFileSync(path.resolve(process.cwd(), rel), 'utf8');
const count = (haystack: string, needle: string): number => haystack.split(needle).length - 1;

describe('server timeouts (server/http/server_timeouts.ts)', () => {
  it('the four constants equal the installed Node http defaults', () => {
    // Proof the codification is byte-equal: a bare createServer() (Node defaults) must
    // already carry each value, so setting them explicitly changes nothing.
    const bare = http.createServer();
    expect(bare.requestTimeout).toBe(REQUEST_TIMEOUT_MS);
    expect(bare.headersTimeout).toBe(HEADERS_TIMEOUT_MS);
    expect(bare.keepAliveTimeout).toBe(KEEP_ALIVE_TIMEOUT_MS);
    expect(http.maxHeaderSize).toBe(MAX_HEADER_SIZE_BYTES);
  });

  it('pins the literal expected values', () => {
    expect(REQUEST_TIMEOUT_MS).toBe(300_000);
    expect(HEADERS_TIMEOUT_MS).toBe(60_000);
    expect(KEEP_ALIVE_TIMEOUT_MS).toBe(5_000);
    expect(MAX_HEADER_SIZE_BYTES).toBe(16_384);
  });

  it('headersTimeout must exceed keepAliveTimeout (kept-alive reuse must not 408-race)', () => {
    expect(HEADERS_TIMEOUT_MS).toBeGreaterThan(KEEP_ALIVE_TIMEOUT_MS);
  });

  it('applyServerTimeouts sets each effective value on a bare http.Server', () => {
    // Construct with maxHeaderSize (read-only after construction, so it rides
    // createServer) then apply the three mutable timeouts, exactly as startServer does.
    const server = http.createServer({ maxHeaderSize: MAX_HEADER_SIZE_BYTES });
    // Prove applyServerTimeouts is what sets them: perturb first, then apply.
    server.requestTimeout = 1;
    server.headersTimeout = 1;
    server.keepAliveTimeout = 1;
    applyServerTimeouts(server);
    expect(server.requestTimeout).toBe(REQUEST_TIMEOUT_MS);
    expect(server.headersTimeout).toBe(HEADERS_TIMEOUT_MS);
    expect(server.keepAliveTimeout).toBe(KEEP_ALIVE_TIMEOUT_MS);
    // maxHeaderSize is exposed at runtime when passed to createServer but is not in
    // @types/node's Server type; cast to confirm the createServer option took.
    expect((server as unknown as { maxHeaderSize: number }).maxHeaderSize).toBe(
      MAX_HEADER_SIZE_BYTES,
    );
  });
});

describe('rate-limit POLICIES derive from the limiter constants and hold their values', () => {
  const WINDOW_SECONDS = WINDOW_MS / 1000;
  // Each row: the policy, the limiter constant it MUST derive from (a), and the
  // literal expected numbers (b). Asserting both is what defeats the
  // constant-self-comparison trap: (a) alone would pass even if both moved together.
  const rows: {
    policy: RateLimitPolicy;
    name: string;
    source: number;
    limit: number;
  }[] = [
    {
      policy: PUBLIC_READ_POLICY,
      name: 'public_read',
      source: PUBLIC_READ_MAX_PER_MINUTE,
      limit: 60,
    },
    {
      policy: WOC_BALANCE_POLICY,
      name: 'woc_balance',
      source: WOC_BALANCE_MAX_PER_MINUTE,
      limit: 20,
    },
    {
      policy: CARD_UPLOAD_POLICY,
      name: 'card_upload',
      source: CARD_UPLOAD_MAX_PER_MINUTE,
      limit: 10,
    },
    {
      policy: WALLET_LINK_POLICY,
      name: 'wallet_link',
      source: WALLET_LINK_MAX_PER_MINUTE,
      limit: 10,
    },
    {
      policy: CLAUDIUM_PURCHASE_PRE_AUTH_POLICY,
      name: 'claudium_purchase_pre_auth',
      source: CLAUDIUM_PURCHASE_MAX_PER_MINUTE,
      limit: 10,
    },
    {
      policy: CLAUDIUM_QUOTE_PRE_AUTH_POLICY,
      name: 'claudium_quote_pre_auth',
      source: CLAUDIUM_QUOTE_MAX_PER_MINUTE,
      limit: 20,
    },
    {
      policy: CLAUDIUM_CONFIRM_PRE_AUTH_POLICY,
      name: 'claudium_confirm_pre_auth',
      source: CLAUDIUM_CONFIRM_MAX_PER_MINUTE,
      limit: 60,
    },
    {
      policy: CLAUDIUM_SPEND_PRE_AUTH_POLICY,
      name: 'claudium_spend_pre_auth',
      source: CLAUDIUM_SPEND_MAX_PER_MINUTE,
      limit: 30,
    },
    {
      policy: CLAUDIUM_PURCHASE_POLICY,
      name: 'claudium_purchase',
      source: CLAUDIUM_PURCHASE_MAX_PER_MINUTE,
      limit: 10,
    },
    {
      policy: CLAUDIUM_QUOTE_POLICY,
      name: 'claudium_quote',
      source: CLAUDIUM_QUOTE_MAX_PER_MINUTE,
      limit: 20,
    },
    {
      policy: CLAUDIUM_CONFIRM_POLICY,
      name: 'claudium_confirm',
      source: CLAUDIUM_CONFIRM_MAX_PER_MINUTE,
      limit: 60,
    },
    {
      policy: CLAUDIUM_SPEND_POLICY,
      name: 'claudium_spend',
      source: CLAUDIUM_SPEND_MAX_PER_MINUTE,
      limit: 30,
    },
    {
      policy: STEAM_LINK_POLICY,
      name: 'steam_link',
      source: STEAM_LINK_MAX_PER_MINUTE,
      limit: 5,
    },
    {
      policy: CHARACTER_CREATE_POLICY,
      name: 'character_create',
      source: CHARACTER_MUTATION_MAX_PER_MINUTE,
      limit: 20,
    },
    {
      policy: CHARACTER_RENAME_POLICY,
      name: 'character_rename',
      source: CHARACTER_MUTATION_MAX_PER_MINUTE,
      limit: 20,
    },
    {
      policy: CHARACTER_DELETE_POLICY,
      name: 'character_delete',
      source: CHARACTER_MUTATION_MAX_PER_MINUTE,
      limit: 20,
    },
    {
      policy: CHARACTER_TAKEOVER_POLICY,
      name: 'character_takeover',
      source: CHARACTER_MUTATION_MAX_PER_MINUTE,
      limit: 20,
    },
    {
      policy: REPORTS_CREATE_POLICY,
      name: 'reports_create',
      source: REPORTS_CREATE_MAX_PER_MINUTE,
      limit: 10,
    },
    { policy: DISCORD_POLICY, name: 'discord', source: DISCORD_MAX_PER_MINUTE, limit: 15 },
    // v0.20.0 release merge: the map editor buckets (shared with the legacy arms).
    {
      policy: MAP_MUTATION_POLICY,
      name: 'map_mutation',
      source: MAP_MUTATION_MAX_PER_MINUTE,
      limit: 30,
    },
    {
      policy: ASSET_UPLOAD_POLICY,
      name: 'asset_upload',
      source: ASSET_UPLOAD_MAX_PER_MINUTE,
      limit: 10,
    },
  ];

  it.each(rows)('$name derives its limit + window and pins the literal', (row) => {
    expect(row.policy.name).toBe(row.name);
    // (a) derivation: the policy limit IS its source constant (cannot drift apart).
    expect(row.policy.limit).toBe(row.source);
    // (b) value: the source constant holds the literal expected number.
    expect(row.policy.limit).toBe(row.limit);
    // Window: derived from the single shared WINDOW_MS, pinned to the literal 60s.
    expect(row.policy.windowSeconds).toBe(WINDOW_SECONDS);
    expect(row.policy.windowSeconds).toBe(60);
  });

  it('the shared limiter window is 60s (single source WINDOW_MS)', () => {
    expect(WINDOW_MS).toBe(60_000);
    expect(WINDOW_SECONDS).toBe(60);
  });

  it('the auth (login/register/desktop-login) default budget is 20/min', () => {
    expect(AUTH_MAX_PER_MINUTE).toBe(20);
  });
});

describe('byte caps + page sizes hold their literal values', () => {
  it('WS + body + pool byte caps', async () => {
    const { DB_POOL_MAX_CLIENTS } = await import('../../server/db');
    const { MAX_CARD_BYTES } = await import('../../server/player_card');
    const { BUG_REPORT_MAX_BODY_BYTES } = await import('../../server/reports');
    expect(DB_POOL_MAX_CLIENTS).toBe(10);
    expect(MAX_CARD_BYTES).toBe(4_194_304); // 4 MiB
    expect(BUG_REPORT_MAX_BODY_BYTES).toBe(1_048_576); // 1 MiB
    expect(DEFAULT_JSON_BODY_MAX_BYTES).toBe(65_536); // 64 KiB
  });

  it('daily-rewards paginated decode defaults', async () => {
    const {
      DAILY_DEFAULT_PAGE,
      DAILY_PLAYER_LEADERBOARD_PAGE_SIZE,
      DAILY_HISTORY_LIMIT,
      DAILY_OPS_PENDING_PAYOUTS_LIMIT,
      DAILY_OPS_PAYOUT_HISTORY_LIMIT,
      DAILY_OPS_LEADERBOARD_PAGE_SIZE,
    } = await import('../../server/daily_rewards');
    expect(DAILY_DEFAULT_PAGE).toBe(0);
    expect(DAILY_PLAYER_LEADERBOARD_PAGE_SIZE).toBe(20);
    expect(DAILY_HISTORY_LIMIT).toBe(30);
    expect(DAILY_OPS_PENDING_PAYOUTS_LIMIT).toBe(20);
    expect(DAILY_OPS_PAYOUT_HISTORY_LIMIT).toBe(100);
    expect(DAILY_OPS_LEADERBOARD_PAGE_SIZE).toBe(50);
  });

  it('msg-rate trio + desktop-login TTL', () => {
    expect(MSG_RATE_BURST).toBe(60);
    expect(MSG_RATE_REFILL_PER_SECOND).toBe(40);
    expect(MSG_RATE_VIOLATIONS_FOR_KICK).toBe(200);
    expect(DESKTOP_LOGIN_TTL_MS).toBe(300_000); // 5 min
  });
});

describe('db pool timeouts hold their literal values and the query_timeout layering', () => {
  it('pins each literal and the strict layering the SET LOCAL exemption depends on', async () => {
    const {
      DB_POOL_CONNECT_TIMEOUT_MS,
      DB_STATEMENT_TIMEOUT_MS,
      DB_HEAVY_STATEMENT_TIMEOUT_MS,
      DB_QUERY_TIMEOUT_MS,
      getPoolClientErrorCount,
      pool,
    } = await import('../../server/db');
    // (b) values: each named timeout holds its literal.
    expect(DB_POOL_CONNECT_TIMEOUT_MS).toBe(5_000);
    expect(DB_STATEMENT_TIMEOUT_MS).toBe(15_000);
    expect(DB_HEAVY_STATEMENT_TIMEOUT_MS).toBe(60_000);
    expect(DB_QUERY_TIMEOUT_MS).toBe(65_000);
    // (a) derivation: the client-side backstop is defined as heavy + 5s, pinned as a
    // relation so the two cannot silently drift together (the constant-self-comparison
    // trap). query_timeout is per-connection and cannot be lifted by SET LOCAL, so it
    // MUST sit strictly above the heaviest server-side allowance or it would kill the
    // very queries runWithStatementTimeout raises the heavy allowance for.
    expect(DB_QUERY_TIMEOUT_MS).toBe(DB_HEAVY_STATEMENT_TIMEOUT_MS + 5_000);
    expect(DB_QUERY_TIMEOUT_MS).toBeGreaterThan(DB_HEAVY_STATEMENT_TIMEOUT_MS);
    // The ladder: heavy > default > connect wait, so an exempted read gets real
    // headroom, an ordinary query is bounded tighter, and a checkout fails fastest.
    expect(DB_HEAVY_STATEMENT_TIMEOUT_MS).toBeGreaterThan(DB_STATEMENT_TIMEOUT_MS);
    expect(DB_STATEMENT_TIMEOUT_MS).toBeGreaterThan(DB_POOL_CONNECT_TIMEOUT_MS);
    // The idle-client error handler is actually REGISTERED on the real pool (this
    // suite does not mock pg), not just present in source: emitting the pool's
    // 'error' event runs it, so the counter the getter exposes advances by one. An
    // unregistered handler would instead let node throw on an unhandled 'error'.
    const before = getPoolClientErrorCount();
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    pool.emit('error', new Error('idle client boom'));
    errSpy.mockRestore();
    expect(getPoolClientErrorCount()).toBe(before + 1);
  });

  it('runWithStatementTimeout rejects a non-integer or negative timeout before touching the pool', async () => {
    // SET LOCAL cannot bind a parameter, so the timeout is interpolated into the
    // statement text as an integer; the safe-integer validation is therefore the
    // injection guard. It must throw BEFORE any client is checked out (so a bad
    // value can never reach the SQL, and fn never runs).
    const { runWithStatementTimeout } = await import('../../server/db');
    const fn = vi.fn();
    await expect(runWithStatementTimeout(-1, fn)).rejects.toThrow(/non-negative safe integer/);
    await expect(runWithStatementTimeout(1.5, fn)).rejects.toThrow(/non-negative safe integer/);
    await expect(runWithStatementTimeout(Number.NaN, fn)).rejects.toThrow(
      /non-negative safe integer/,
    );
    expect(fn).not.toHaveBeenCalled();
  });

  it('runWithStatementTimeout opens the transaction before the raise and unwinds on error', async () => {
    // BEGIN must precede SET LOCAL (outside a transaction SET LOCAL is a silent
    // no-op, leaving the heavy read on the 15s default), fn's statements must run
    // on the SAME checked-out client, and both exits must return the client to
    // the pool: a leaked client on the heavy path eats one of the 10 slots
    // forever. Recorded on a stubbed checkout, no database touched.
    const { runWithStatementTimeout, pool } = await import('../../server/db');
    const calls: string[] = [];
    let released = 0;
    const client = {
      query: (text: string) => {
        calls.push(text);
        return Promise.resolve({ rows: [], rowCount: 0 });
      },
      release: () => {
        released++;
      },
    };
    const connectSpy = vi.spyOn(pool, 'connect').mockResolvedValue(client as never);
    try {
      const out = await runWithStatementTimeout(1234, async (query) => {
        await query('SELECT 1');
        return 'ok';
      });
      expect(out).toBe('ok');
      expect(calls).toEqual(['BEGIN', 'SET LOCAL statement_timeout = 1234', 'SELECT 1', 'COMMIT']);
      expect(released).toBe(1);

      // fn rejects: ROLLBACK (never COMMIT), the original error rethrows, and the
      // client is STILL released.
      calls.length = 0;
      await expect(
        runWithStatementTimeout(1234, async () => {
          throw new Error('boom');
        }),
      ).rejects.toThrow('boom');
      expect(calls).toEqual(['BEGIN', 'SET LOCAL statement_timeout = 1234', 'ROLLBACK']);
      expect(released).toBe(2);

      // A ROLLBACK that itself fails (dead connection) must neither mask the
      // original error nor skip the release.
      calls.length = 0;
      client.query = (text: string) => {
        calls.push(text);
        return text === 'ROLLBACK'
          ? Promise.reject(new Error('conn gone'))
          : Promise.resolve({ rows: [], rowCount: 0 });
      };
      await expect(
        runWithStatementTimeout(1234, async () => {
          throw new Error('original');
        }),
      ).rejects.toThrow('original');
      expect(released).toBe(3);
    } finally {
      connectSpy.mockRestore();
    }
  });
});

// Source-scan guard: each consolidated literal must live in exactly ONE place (its
// owning module) and every call site must reference the named constant, never a
// re-inlined magic number. Scoped to the SPECIFIC literals consolidated here
// (enumerated site + owner), not a generic all-numbers ban: 16 * 1024 and
// 1024 * 1024 each have OTHER independent owners (oauth request cap, perf-report
// summary; card + png-decode caps) that this consolidation deliberately does not touch.
describe('no consolidated tunable literal is duplicated at a call site', () => {
  const mainSrc = read('server/main.ts');
  const dbSrc = read('server/db.ts');
  const reportsSrc = read('server/reports.ts');
  const dailySrc = read('server/daily_rewards.ts');

  it('the WS maxPayload references WS_MAX_PAYLOAD_BYTES, defined once', () => {
    expect(mainSrc).toContain('maxPayload: WS_MAX_PAYLOAD_BYTES');
    expect(mainSrc).not.toContain('maxPayload: 16 * 1024');
    expect(mainSrc).toContain('const WS_MAX_PAYLOAD_BYTES = 16 * 1024;');
    expect(count(mainSrc, '16 * 1024')).toBe(1); // owner def only
    // Alternate spellings of the same value must not sneak in at a new call site
    // (the '16 * 1024' count above only pins that one spelling).
    expect(mainSrc).not.toMatch(/16_?384/);
  });

  it('startServer actually wires the timeouts: createServer maxHeaderSize + applyServerTimeouts', () => {
    // The unit tests prove applyServerTimeouts works on a bare server; these two
    // source pins prove startServer USES it, so deleting the boot wiring (which is
    // behavior-neutral on the pinned Node version, the constants equal its
    // defaults) cannot silently leave a future Node's different defaults live.
    expect(mainSrc).toContain(
      'http.createServer({ maxHeaderSize: MAX_HEADER_SIZE_BYTES }, routeHttpRequest)',
    );
    expect(mainSrc).toContain('applyServerTimeouts(server);');
  });

  it('the bug-report body cap references the reports.ts constant', () => {
    expect(mainSrc).toContain('readBody(req, BUG_REPORT_MAX_BODY_BYTES)');
    expect(mainSrc).not.toContain('readBody(req, 1024 * 1024)');
    expect(reportsSrc).toContain('export const BUG_REPORT_MAX_BODY_BYTES = 1024 * 1024;');
    // Ban the decimal spellings of 1 MiB too; the pins above only see '1024 * 1024'.
    expect(mainSrc).not.toMatch(/1_?048_?576/);
    expect(reportsSrc).not.toMatch(/1_?048_?576/);
  });

  it('the daily prune interval + DB boot loop reference named constants', () => {
    expect(mainSrc).toContain('const DAILY_PRUNE_INTERVAL_MS = 24 * 3600 * 1000;');
    expect(count(mainSrc, '24 * 3600 * 1000')).toBe(1); // owner def only, not the setInterval arg
    // Defined once + referenced at the setInterval call site (>= 2 total).
    expect(count(mainSrc, 'DAILY_PRUNE_INTERVAL_MS')).toBeGreaterThanOrEqual(2);
    expect(mainSrc).toContain('if (attempt >= DB_BOOT_MAX_ATTEMPTS)');
    expect(mainSrc).toContain('setTimeout(r, DB_BOOT_RETRY_MS)');
    expect(mainSrc).not.toContain('if (attempt >= 30)');
    expect(mainSrc).not.toContain('setTimeout(r, 2000)');
  });

  it('the pg pool max references DB_POOL_MAX_CLIENTS', () => {
    expect(dbSrc).toContain('max: DB_POOL_MAX_CLIENTS');
    expect(dbSrc).not.toContain('max: 10 }');
  });

  it('the pg pool timeouts wire the named constants at construction, never a re-inlined literal', () => {
    // Pool construction reads each timeout from its named constant.
    expect(dbSrc).toContain('connectionTimeoutMillis: DB_POOL_CONNECT_TIMEOUT_MS');
    expect(dbSrc).toContain('statement_timeout: DB_STATEMENT_TIMEOUT_MS');
    expect(dbSrc).toContain('query_timeout: DB_QUERY_TIMEOUT_MS');
    // No re-inlined magic number at the construction call site (the owner defs above
    // are `= 5000` / `= 15_000` / `= DB_HEAVY_STATEMENT_TIMEOUT_MS + 5000`, never the
    // `key: literal` spellings banned here).
    expect(dbSrc).not.toContain('connectionTimeoutMillis: 5000');
    expect(dbSrc).not.toContain('statement_timeout: 15000');
    expect(dbSrc).not.toContain('query_timeout: 65000');
  });

  it('an idle pooled-client error is handled, never left to crash the process', () => {
    expect(dbSrc).toContain("pool.on('error'");
  });

  it('every heavy-aggregate call site runs through the raised allowance, per function body', () => {
    // Dropping runWithStatementTimeout at ONE call site silently reverts that
    // read to the 15s session default while its own suite stays green (the
    // suites answer BEGIN/SET LOCAL and forward the real query through the same
    // spy), so pin each function BODY to the wrapper. Slices run to the next
    // export so a neighbor's wrapper cannot satisfy a body that lost its own.
    const bodyOf = (source: string, decl: string): string => {
      const start = source.indexOf(decl);
      expect(start, `${decl} not found`).toBeGreaterThan(-1);
      const next = source.indexOf('\nexport ', start + decl.length);
      return next === -1 ? source.slice(start) : source.slice(start, next);
    };
    for (const decl of [
      'export async function topArenaRatings',
      'export async function topLifetimeXp',
      'export async function topGuilds',
      'export async function deedsBoardRanked',
      'export async function saveCharacterState',
    ]) {
      expect(bodyOf(dbSrc, decl)).toContain(
        'runWithStatementTimeout(DB_HEAVY_STATEMENT_TIMEOUT_MS',
      );
    }
    // saveCharacterAndMarketState owns its escrow transaction and inlines the raise.
    expect(bodyOf(dbSrc, 'export async function saveCharacterAndMarketState')).toContain(
      'SET LOCAL statement_timeout = ${DB_HEAVY_STATEMENT_TIMEOUT_MS}',
    );
    const adminSrc = read('server/admin_db.ts');
    expect(bodyOf(adminSrc, 'export async function overviewCounts')).toContain(
      'runWithStatementTimeout(DB_HEAVY_STATEMENT_TIMEOUT_MS',
    );
    expect(bodyOf(read('server/deeds_db.ts'), 'export async function deedRarityCounts')).toContain(
      'runWithStatementTimeout(DB_HEAVY_STATEMENT_TIMEOUT_MS',
    );
    expect(
      bodyOf(
        read('server/client_perf_metrics_db.ts'),
        'export async function clientPerfMetricRows',
      ),
    ).toContain('runWithStatementTimeout(DB_HEAVY_STATEMENT_TIMEOUT_MS');
    // The on-demand admin reads carry the wrapper in the body that owns their
    // heaviest scan: sessionsByDay and accountDetail wrap directly; clientPerfSummary
    // threads the bound query into its private perf helpers from ONE wrapper call, so
    // the wrapper lives in its own body. pruneChatLogs (db.ts) wraps its delete.
    for (const decl of [
      'export async function sessionsByDay',
      'export async function clientPerfSummary',
      'export async function accountDetail',
    ]) {
      expect(bodyOf(adminSrc, decl)).toContain(
        'runWithStatementTimeout(DB_HEAVY_STATEMENT_TIMEOUT_MS',
      );
    }
    // clientPerfSummary inherits the allowance ONLY if it hands the bound query to
    // both perf helpers; pin the threading so a helper cannot silently drop back to a
    // pool.query outside the raised transaction without reddening this.
    const perfSummaryBody = bodyOf(adminSrc, 'export async function clientPerfSummary');
    expect(perfSummaryBody).toContain('perfAggregate(query,');
    expect(perfSummaryBody).toContain('perfBuckets(query,');
    // accountDetail wraps ONLY the account row whose correlated play_sessions sum
    // grows without bound; its four LIMIT-capped companion reads stay on the default.
    // Slice from the wrapper to the next pool.query and require the playtime
    // aggregate inside it, so moving the wrapper onto one of the capped reads (and
    // silently dropping the unbounded scan back to the default) reddens this.
    const accountDetailBody = bodyOf(adminSrc, 'export async function accountDetail');
    const wrapStart = accountDetailBody.indexOf(
      'runWithStatementTimeout(DB_HEAVY_STATEMENT_TIMEOUT_MS',
    );
    expect(wrapStart).toBeGreaterThan(-1);
    const nextPoolQuery = accountDetailBody.indexOf('pool.query', wrapStart);
    const wrappedRead =
      nextPoolQuery === -1
        ? accountDetailBody.slice(wrapStart)
        : accountDetailBody.slice(wrapStart, nextPoolQuery);
    expect(wrappedRead).toContain('playtime_seconds');
    expect(wrappedRead).toContain('FROM accounts WHERE id = $1');
    expect(bodyOf(dbSrc, 'export async function pruneChatLogs')).toContain(
      'runWithStatementTimeout(DB_HEAVY_STATEMENT_TIMEOUT_MS',
    );
  });

  it('the player character-select read stays on the default statement timeout', () => {
    // db.ts listCharacters is the login-path character-select read: it deliberately
    // stays on the 15s default so it fails fast during a database brownout rather than
    // pinning a client for up to the heavy allowance. It must NEVER gain the wrapper.
    const bodyOf = (source: string, decl: string): string => {
      const start = source.indexOf(decl);
      expect(start, `${decl} not found`).toBeGreaterThan(-1);
      const next = source.indexOf('\nexport ', start + decl.length);
      return next === -1 ? source.slice(start) : source.slice(start, next);
    };
    expect(bodyOf(dbSrc, 'export async function listCharacters')).not.toContain(
      'runWithStatementTimeout',
    );
  });

  it('the heavy-statement exemption interpolates the named constant and validates the integer', () => {
    // runWithStatementTimeout is the single SET LOCAL site; it interpolates the raw
    // integer (SET LOCAL cannot bind a parameter) after a safe-integer guard, which
    // is the injection guard. The named heavy constant is what the exempt call sites
    // pass, never a re-inlined 60000.
    expect(dbSrc).toMatch(/SET LOCAL statement_timeout = \$\{timeoutMs\}/);
    expect(dbSrc).toContain('Number.isSafeInteger(timeoutMs)');
    expect(dbSrc).toMatch(/SET LOCAL statement_timeout = \$\{DB_HEAVY_STATEMENT_TIMEOUT_MS\}/);
    // Boot DDL disables the timeout entirely for its advisory-lock-serialized wait.
    expect(dbSrc).toContain('SET LOCAL statement_timeout = 0');
    expect(dbSrc).not.toContain('SET LOCAL statement_timeout = 60000');
  });

  it('the rateLimited default budget binds AUTH_MAX_PER_MINUTE, not a re-inlined 20', () => {
    const ratelimitSrc = read('server/ratelimit.ts');
    expect(ratelimitSrc).toContain('maxPerMinute = AUTH_MAX_PER_MINUTE');
    expect(ratelimitSrc).not.toContain('maxPerMinute = 20');
  });

  it('the daily-rewards decode call sites reference named constants, not raw defaults', () => {
    expect(dailySrc).toContain('|| DAILY_DEFAULT_PAGE');
    expect(dailySrc).toContain('|| DAILY_PLAYER_LEADERBOARD_PAGE_SIZE');
    expect(dailySrc).toContain('|| DAILY_HISTORY_LIMIT');
    expect(dailySrc).toContain('|| DAILY_OPS_PENDING_PAYOUTS_LIMIT');
    expect(dailySrc).toContain('|| DAILY_OPS_PAYOUT_HISTORY_LIMIT');
    expect(dailySrc).toContain('|| DAILY_OPS_LEADERBOARD_PAGE_SIZE');
    expect(dailySrc).not.toContain("get('pageSize')) || 20");
    expect(dailySrc).not.toContain("get('pageSize')) || 50");
    expect(dailySrc).not.toContain("get('page')) || 0");
    expect(dailySrc).not.toContain("get('limit')) || 30");
    expect(dailySrc).not.toContain("get('limit')) || 20");
    expect(dailySrc).not.toContain("get('limit')) || 100");
    // Generic ban: ANY decode default in this module must be a named constant, so
    // a NEW query param with a re-typed numeric fallback is caught, not just the
    // six spellings above.
    expect(dailySrc).not.toMatch(/get\('[^']+'\)\)\s*\|\|\s*\d/);
  });
});
