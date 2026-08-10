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

// The env-tunable pool size is read at server/db.ts module init (which also
// loads .env from cwd), so a shell that legitimately exports the knob (the
// load-capture recipe tells operators to) would otherwise turn the literal
// default pin below into a confusing red. Cleared before any dynamic import
// of server/db can run; vitest gives this file a fresh module registry.
// Load-bearing and narrow: ESM hoists the static imports above this line, so
// the delete only protects the pin because server/db is reached EXCLUSIVELY
// through the dynamic import inside its test; a future static import that
// transitively pulls in server/db would silently defeat it. Narrower still:
// this covers the SHELL-export case only. server/env's loadEnvFile runs at
// that dynamic import and will re-set a just-deleted var from a local .env,
// so a developer keeping the knob in .env still sees this file red; the
// capture recipe passes the knob on the command line for exactly that
// reason.
delete process.env.DB_POOL_MAX_CLIENTS;

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
  EPIC_LINK_POLICY,
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
import { LIST_READ_BURST, LIST_READ_REFILL_PER_SECOND } from '../../server/list_read_guard';
import {
  MSG_LANE_CHAT_BURST,
  MSG_LANE_CHAT_REFILL_PER_SECOND,
  MSG_LANE_COMMAND_BURST,
  MSG_LANE_COMMAND_REFILL_PER_SECOND,
  MSG_LANE_MOVEMENT_BURST,
  MSG_LANE_MOVEMENT_REFILL_PER_SECOND,
} from '../../server/msg_lanes';
import {
  MSG_ABUSE_KICK_SECONDS,
  MSG_ABUSE_SECOND_DROP_FLOOR,
  MSG_ABUSE_WINDOW_SECONDS,
  MSG_BYTE_BURST,
  MSG_BYTE_REFILL_PER_SECOND,
  MSG_RATE_BURST,
  MSG_RATE_REFILL_PER_SECOND,
  MSG_SEQ_GAP_SANITY,
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
  EPIC_LINK_MAX_PER_MINUTE,
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
// A raw-source .toContain() is comment-gameable: commenting the pinned line out
// leaves its text sitting in the comment, so the pin stays falsely green while
// the wiring is dead (confirmed by experiment against the env-wiring pin
// below). Strip // line comments before any structural match, keeping ://
// protocol slashes.
const codeOnly = (src: string): string => src.replace(/(^|[^:])\/\/.*$/gm, '$1');

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
      policy: EPIC_LINK_POLICY,
      name: 'epic_link',
      source: EPIC_LINK_MAX_PER_MINUTE,
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
    // The env-dependent readout of the default. The AUTHORITATIVE default pin is
    // the pure parseDbPoolMaxClients(undefined) one below, which no shell export
    // or local .env can perturb; this line only adds that the module constant is
    // the parser's result in a clean environment (see the delete at the top).
    expect(DB_POOL_MAX_CLIENTS).toBe(10);
    expect(MAX_CARD_BYTES).toBe(4_194_304); // 4 MiB
    expect(BUG_REPORT_MAX_BODY_BYTES).toBe(1_048_576); // 1 MiB
    expect(DEFAULT_JSON_BODY_MAX_BYTES).toBe(65_536); // 64 KiB
  });

  it('DB_POOL_MAX_CLIENTS env parsing is strict and fail-safe, never a zero-client pool', async () => {
    const { parseDbPoolMaxClients } = await import('../../server/db');
    // unset / blank / whitespace stay on the default (Number('') === 0 must
    // NOT become a zero-client pool; the empty-numeric env trap)
    expect(parseDbPoolMaxClients(undefined)).toBe(10);
    expect(parseDbPoolMaxClients('')).toBe(10);
    expect(parseDbPoolMaxClients('   ')).toBe(10);
    // out-of-range and malformed values stay on the default per dimension. The
    // ceiling is the USABLE budget of stock postgres:16 (max_connections 100
    // minus 3 superuser-reserved), so 98 through 100 are refused too: the
    // values the comment itself says would break logins must not be blessed.
    expect(parseDbPoolMaxClients('0')).toBe(10);
    expect(parseDbPoolMaxClients('-5')).toBe(10);
    expect(parseDbPoolMaxClients('98')).toBe(10);
    expect(parseDbPoolMaxClients('100')).toBe(10);
    expect(parseDbPoolMaxClients('101')).toBe(10);
    expect(parseDbPoolMaxClients('abc')).toBe(10);
    expect(parseDbPoolMaxClients('30x')).toBe(10); // strict: a typo must not half-parse to 30
    expect(parseDbPoolMaxClients('2.5')).toBe(10); // whole clients only
    // decimal digits only: JS numeric spellings must not surprise an operator
    expect(parseDbPoolMaxClients('0x50')).toBe(10);
    expect(parseDbPoolMaxClients('8e1')).toBe(10);
    expect(parseDbPoolMaxClients('Infinity')).toBe(10);
    // valid values parse, at both range edges (97 is the last accepted one)
    expect(parseDbPoolMaxClients('40')).toBe(40);
    expect(parseDbPoolMaxClients(' 40 ')).toBe(40);
    expect(parseDbPoolMaxClients('1')).toBe(1);
    expect(parseDbPoolMaxClients('97')).toBe(97);
  });

  it('the pool size constant is genuinely FED by the env (the tunability claim itself)', () => {
    // A revert to `= 10` leaves every parser test green; this scrape is what
    // fails it (the max: DB_POOL_MAX_CLIENTS wiring pin lives below). Comment
    // stripped first: with the raw text, commenting the wiring line out and
    // re-adding a hardcoded export kept this pin green (measured).
    expect(codeOnly(read('server/db.ts'))).toContain(
      'parseDbPoolMaxClients(process.env.DB_POOL_MAX_CLIENTS)',
    );
  });

  it('the craftedBy/signer clamp equals the ENFORCED auth name ceiling, behaviorally', async () => {
    // src/sim cannot import server/, so the 16 lives twice; this cross-tie is
    // what turns a future name-cap raise into a loud failure instead of a
    // silent provenance drop (phase 16 review). Anchored to the shape
    // predicate that actually gates names (server/auth.ts validCharNameShape,
    // whose regex quantifier is the real cap), NOT to reclaim_name's local
    // sizing copy: a name exactly at the clamp must pass the gate and one
    // character longer must fail it, so raising the regex alone reddens here.
    const { validCharNameShape } = await import('../../server/auth');
    const { MAX_NAME_LEN } = await import('../../server/reclaim_name');
    const { MAX_CRAFTED_BY_LENGTH } = await import('../../src/sim/professions/tools');
    expect(validCharNameShape('A'.repeat(MAX_CRAFTED_BY_LENGTH))).toBe(true);
    expect(validCharNameShape('A'.repeat(MAX_CRAFTED_BY_LENGTH + 1))).toBe(false);
    expect(MAX_CRAFTED_BY_LENGTH).toBe(MAX_NAME_LEN);
    expect(MAX_CRAFTED_BY_LENGTH).toBe(16);
  });

  it('daily-rewards paginated decode defaults', async () => {
    const {
      DAILY_DEFAULT_PAGE,
      DAILY_PLAYER_LEADERBOARD_PAGE_SIZE,
      DAILY_HISTORY_LIMIT,
      DAILY_OPS_PENDING_PAYOUTS_LIMIT,
      DAILY_OPS_PAYOUT_HISTORY_LIMIT,
      DAILY_OPS_LEADERBOARD_PAGE_SIZE,
      DAILY_REWARD_WINNER_DAY_LIMIT,
      RUNTIME_CONFIG_CACHE_DAYS,
    } = await import('../../server/daily_rewards');
    expect(DAILY_DEFAULT_PAGE).toBe(0);
    expect(DAILY_PLAYER_LEADERBOARD_PAGE_SIZE).toBe(20);
    expect(DAILY_HISTORY_LIMIT).toBe(30);
    expect(DAILY_OPS_PENDING_PAYOUTS_LIMIT).toBe(20);
    expect(DAILY_OPS_PAYOUT_HISTORY_LIMIT).toBe(100);
    expect(DAILY_OPS_LEADERBOARD_PAGE_SIZE).toBe(50);
    // ONE winner day per outbox poll, the ask the winners cache reads at since
    // the standalone winners GET retired (#2791).
    expect(DAILY_REWARD_WINNER_DAY_LIMIT).toBe(1);
    // The per-day runtime-config map's bound, covering the full working set:
    // the reward-clock day, the plain utcRewardDay() default the eligibility
    // and price reads use (a different day inside the dayStartUtcMinutes
    // window), and the winners refresh's pending day plus its successor.
    expect(RUNTIME_CONFIG_CACHE_DAYS).toBe(4);
  });

  it('inbound gate constants + desktop-login TTL', () => {
    expect(MSG_RATE_BURST).toBe(180);
    expect(MSG_RATE_REFILL_PER_SECOND).toBe(120);
    expect(MSG_BYTE_BURST).toBe(131_072); // 128 KiB
    expect(MSG_BYTE_REFILL_PER_SECOND).toBe(65_536); // 64 KiB
    expect(MSG_ABUSE_WINDOW_SECONDS).toBe(10);
    expect(MSG_ABUSE_KICK_SECONDS).toBe(5);
    expect(MSG_ABUSE_SECOND_DROP_FLOOR).toBe(30);
    expect(MSG_SEQ_GAP_SANITY).toBe(1000);
    expect(DESKTOP_LOGIN_TTL_MS).toBe(300_000); // 5 min
  });

  it('inbound lane constants', () => {
    expect(MSG_LANE_MOVEMENT_REFILL_PER_SECOND).toBe(90);
    expect(MSG_LANE_MOVEMENT_BURST).toBe(120);
    expect(MSG_LANE_COMMAND_REFILL_PER_SECOND).toBe(30);
    expect(MSG_LANE_COMMAND_BURST).toBe(60);
    expect(MSG_LANE_CHAT_REFILL_PER_SECOND).toBe(4);
    expect(MSG_LANE_CHAT_BURST).toBe(8);
  });

  it('list-read guard constants', () => {
    expect(LIST_READ_BURST).toBe(10);
    expect(LIST_READ_REFILL_PER_SECOND).toBe(1);
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
  const unstuckDbSrc = read('server/unstuck_db.ts');
  const unstuckRecordsSrc = read('server/unstuck_records.ts');
  const retentionSrc = read('server/play_session_retention_db.ts');

  // Slice a function BODY: from its declaration to the next top-level export,
  // so a neighbor's match can never satisfy a body that lost its own.
  const bodyOf = (source: string, decl: string): string => {
    const start = source.indexOf(decl);
    expect(start, `${decl} not found`).toBeGreaterThan(-1);
    const next = source.indexOf('\nexport ', start + decl.length);
    return next === -1 ? source.slice(start) : source.slice(start, next);
  };

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

  it('routes the unstuck retention prune through the shared sweep, and ONLY there', () => {
    // The retention knob lives on the CONFIG (unstuckReportRetentionDays);
    // the module keeps only the ADMIN VIEW ceiling. The old whole-backlog
    // prune, its advisory lock, and its private batch constants are retired
    // with the boot one-shot; the sweep primitive carries the bounded LIMIT.
    expect(unstuckDbSrc).toContain('export const UNSTUCK_REPORT_MAX_DAYS = 90;');
    expect(unstuckDbSrc).not.toContain('UNSTUCK_REPORT_PRUNE_BATCH_SIZE');
    expect(unstuckDbSrc).not.toContain('pg_try_advisory_lock');
    expect(unstuckDbSrc).toContain('LIMIT $2');
    // Rewired at the v0.32.0 merge: the release shipped a boot-blocking
    // one-shot plus a bare interval, and the retention sweep's guard
    // (main_retention_wiring.test.ts) forbids both shapes. The prune now
    // rides the shared sweep exactly once, off the config key.
    expect(mainSrc).toContain(
      'pruneBatch: (n) => pruneUnstuckReportsBatch(pool, config.unstuckReportRetentionDays, n)',
    );
    expect(count(mainSrc, 'pruneUnstuckReportsBatch(pool')).toBe(1);
    // The retired whole-backlog name at zero occurrences, the retired-name
    // idiom: the '(' suffix cannot match the Batch name, so a re-added
    // one-shot in ANY spelling (await or void .catch) reds here.
    expect(count(mainSrc, 'pruneUnstuckReports(')).toBe(0);
  });

  it('bounds unstuck inserts and the shutdown drain with named timeouts', () => {
    expect(unstuckDbSrc).toContain('export const UNSTUCK_INSERT_QUERY_TIMEOUT_MS = 1_000;');
    expect(unstuckDbSrc).toContain('query_timeout: UNSTUCK_INSERT_QUERY_TIMEOUT_MS');
    expect(unstuckRecordsSrc).toContain('export const UNSTUCK_RECORD_SHUTDOWN_DRAIN_MS = 5_000;');
    expect(mainSrc).toContain(
      'const unstuckReportsDrained = await stopUnstuckRecords(UNSTUCK_RECORD_SHUTDOWN_DRAIN_MS);',
    );
    expect(mainSrc).not.toContain('await unstuckRecordsIdle();');
  });

  it('bounds unstuck recorder memory and rate-limits overflow warnings', () => {
    expect(unstuckRecordsSrc).toContain('export const UNSTUCK_RECORD_MAX_PENDING = 256;');
    expect(unstuckRecordsSrc).toContain(
      'export const UNSTUCK_RECORD_OVERFLOW_WARN_INTERVAL_MS = 60_000;',
    );
    expect(unstuckRecordsSrc).toContain('queueState.pending >= UNSTUCK_RECORD_MAX_PENDING');
  });

  it('the pg pool max references DB_POOL_MAX_CLIENTS', () => {
    // Comment stripped, like the env-wiring pin above: a commented-out
    // construction line must not keep this green.
    const dbCode = codeOnly(dbSrc);
    expect(dbCode).toContain('max: DB_POOL_MAX_CLIENTS');
    expect(dbCode).not.toContain('max: 10 }');
  });

  it('a rejected DB_POOL_MAX_CLIENTS is reported at boot, never silently equal to unset', () => {
    // The parser is fail-safe by design, so a typo and an unset var produce the
    // same 10 in every later readout: the call site has to SAY so once. Pinned
    // structurally (comment stripped) rather than by capturing console output,
    // which would need a set env var at import time plus a module-registry
    // reset, defeating the file's own delete process.env guard at the top.
    const dbCode = codeOnly(dbSrc);
    expect(dbCode).toContain(
      "const rawDbPoolMaxClients = (process.env.DB_POOL_MAX_CLIENTS ?? '').trim();",
    );
    const branchStart = dbCode.indexOf("if (rawDbPoolMaxClients !== ''");
    expect(branchStart).toBeGreaterThan(-1);
    // The guard fires only for a SET value that did not survive parsing; the
    // numeric comparison is what keeps a legitimately configured 10 (and
    // " 10 ") quiet. Pinned STRUCTURALLY (the condition text), not
    // behaviorally: the file-level delete of the env var means a behavior
    // arm would need a resetModules dance the source pin does not.
    expect(dbCode).toContain(
      "if (rawDbPoolMaxClients !== '' && Number(rawDbPoolMaxClients) !== DB_POOL_MAX_CLIENTS) {",
    );
    const branch = dbCode.slice(branchStart, dbCode.indexOf('\n}', branchStart));
    // The report names the raw value, the accepted range, and the default now
    // in force; these are the unevaluated template tokens in the raw source.
    expect(branch).toContain('console.error(');
    // biome-ignore lint/suspicious/noTemplateCurlyInString: pins the UNEVALUATED token in raw source
    expect(branch).toContain('${rawDbPoolMaxClients}');
    // biome-ignore lint/suspicious/noTemplateCurlyInString: pins the UNEVALUATED token in raw source
    expect(branch).toContain('${DB_POOL_MAX_CLIENTS_CEILING}');
    // biome-ignore lint/suspicious/noTemplateCurlyInString: pins the UNEVALUATED token in raw source
    expect(branch).toContain('${DB_POOL_MAX_CLIENTS_DEFAULT}');
  });

  it('logs the effective pool sizing at boot and warns on the realm multiplication', () => {
    const dbCode = codeOnly(dbSrc);
    // Nothing logged the effective pool size before this line, so a "too many
    // clients" incident could not be read back to a configured value.
    // biome-ignore lint/suspicious/noTemplateCurlyInString: pins the UNEVALUATED token in raw source
    expect(dbCode).toContain('db pool: DB_POOL_MAX_CLIENTS=${DB_POOL_MAX_CLIENTS}');
    // biome-ignore lint/suspicious/noTemplateCurlyInString: pins the UNEVALUATED token in raw source
    expect(dbCode).toContain('DB_POOL_CONNECT_TIMEOUT_MS=${DB_POOL_CONNECT_TIMEOUT_MS}');
    // The realm count comes from the PARSED realm directory (REALM_DIRECTORY,
    // which dedupes names and drops malformed or non-origin REALMS entries),
    // not raw comma segments, so the warning's arithmetic matches the realm
    // processes that will actually boot. The env literal itself now lives in
    // server/realm.ts where the directory is parsed.
    expect(dbCode).toContain('const configuredRealmCount = REALM_DIRECTORY.length');
    // And the OTHER half of the chain, so the whole REALMS -> REALM_DIRECTORY
    // -> configuredRealmCount derivation stays pinned end to end: the env
    // literal must still feed the directory parser where it now lives.
    expect(codeOnly(read('server/realm.ts'))).toContain('parseRealms(process.env.REALMS)');
    const warnStart = dbCode.indexOf('if (configuredRealmCount * DB_POOL_MAX_CLIENTS >');
    expect(warnStart).toBeGreaterThan(-1);
    const warnBranch = dbCode.slice(warnStart, dbCode.indexOf('\n}', warnStart));
    expect(warnBranch).toContain('console.warn(');
    // biome-ignore lint/suspicious/noTemplateCurlyInString: pins the UNEVALUATED token in raw source
    expect(warnBranch).toContain('${configuredRealmCount}');
    // The threshold IS the parser's accepted ceiling (one constant, so the two
    // can never drift), pinned here to its literal value, and to the default
    // beside it: the derivation plus the number, the trap this file exists for.
    expect(dbCode).toContain(
      'configuredRealmCount * DB_POOL_MAX_CLIENTS > DB_POOL_MAX_CLIENTS_CEILING',
    );
    expect(dbCode).toContain('const DB_POOL_MAX_CLIENTS_CEILING = 97;');
    expect(dbCode).toContain('const DB_POOL_MAX_CLIENTS_DEFAULT = 10;');
    // No re-inlined ceiling anywhere in the module (the parser bound and the
    // multiplication warning both read the constant).
    expect(dbCode).not.toContain('<= 97');
    expect(dbCode).not.toContain('> 97');
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
    // spy), so pin each function BODY to the wrapper via the shared bodyOf.
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
    // The on-demand admin reads carry the wrapper in the body that owns their
    // heaviest scan: sessionsByDay and accountDetail wrap directly; clientPerfSummary
    // runs its whole roll-up as ONE GROUPING SETS statement inside its own wrapper
    // call. The batched retention prunes (db.ts) stay on the default allowance;
    // batching is what makes the default safe for them (pinned below).
    for (const decl of [
      'export async function sessionsByDay',
      'export async function clientPerfSummary',
      'export async function accountDetail',
    ]) {
      expect(bodyOf(adminSrc, decl)).toContain(
        'runWithStatementTimeout(DB_HEAVY_STATEMENT_TIMEOUT_MS',
      );
    }
    // clientPerfSummary collapsed its seven serialized reads into one GROUPING SETS
    // statement issued through the bound query; pin the collapsed shape so the
    // roll-up cannot silently split back out or drop to a bare pool read outside
    // the raised transaction without reddening this.
    const perfSummaryBody = bodyOf(adminSrc, 'export async function clientPerfSummary');
    expect(perfSummaryBody).toContain('runWithStatementTimeout(DB_HEAVY_STATEMENT_TIMEOUT_MS');
    expect(perfSummaryBody).toContain('GROUPING SETS');
    expect(perfSummaryBody).not.toContain('pool.query');
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
    expect(wrappedRead).toContain('FROM accounts');
    expect(wrappedRead).toContain('WHERE id = $1');
    // The retention prunes are deliberately NOT heavy call sites anymore: each call
    // is one bounded DELETE batch on the default allowance, and the sweep drives
    // iteration. Batching is what makes the default safe; re-wrapping would be a
    // regression to the timed-out-forever one-shot DELETE.
    expect(bodyOf(dbSrc, 'export async function pruneChatLogsBatch')).not.toContain(
      'runWithStatementTimeout',
    );
    expect(bodyOf(dbSrc, 'export async function pruneClientPerfReportsBatch')).not.toContain(
      'runWithStatementTimeout',
    );
  });

  it('the play-session retention prunes stay batched on the default allowance', () => {
    // A batch primitive must never regress to an unbatched one-shot DELETE on
    // the heavy allowance: each call is ONE bounded batch (LIMIT $2) and the
    // sweep drives iteration, which is what makes the default statement
    // timeout safe here.
    const foldBody = bodyOf(retentionSrc, 'export async function prunePlaySessionsBatch');
    const agingBody = bodyOf(retentionSrc, 'export async function pruneAccountIpAssociationsBatch');
    expect(foldBody).not.toContain('runWithStatementTimeout');
    expect(agingBody).not.toContain('runWithStatementTimeout');
    expect(foldBody).toContain('LIMIT $2');
    expect(agingBody).toContain('LIMIT $2');
    // The fold prunes on session age (started_at) and the aging prune on link
    // age (last_seen_at); pin each body's cutoff predicate so the two can
    // never swap.
    expect(foldBody).toContain("started_at < now() - ($1 || ' days')::interval");
    expect(agingBody).toContain("last_seen_at < now() - ($1 || ' days')::interval");
  });

  it('the player-activity retention prune stays batched on the default allowance', () => {
    // Same contract as the sibling prunes: one bounded batch per call (LIMIT $2)
    // on the default statement timeout, with the sweep driving iteration.
    const metricsSrc = read('server/player_metrics_db.ts');
    const body = bodyOf(metricsSrc, 'export async function prunePlayerActivityDailyBatch');
    expect(body).not.toContain('runWithStatementTimeout');
    expect(body).toContain('LIMIT $2');
    // The cutoff rides the UTC activity-day clock the writers stamp; pin the
    // literal so the reward-clock helper (a different day boundary) can never
    // swap in.
    expect(body).toContain("day < (now() AT TIME ZONE 'UTC')::date - $1::int");
  });

  it('the retention floor stays strictly above the admin activity window', () => {
    // The fold must never delete a session an admin activity chart still
    // counts. Extract both literals from source so a widened admin window
    // (server/admin_activity_cache.ts, the shared TTL memo behind the four
    // admin.ts activity reads) that overtakes the floor reddens this pin.
    const adminActivityCacheSrc = read('server/admin_activity_cache.ts');
    const windowMatch = adminActivityCacheSrc.match(/export const ACTIVITY_WINDOW_DAYS = (\d+);/);
    const floorMatch = retentionSrc.match(
      /export const PLAY_SESSION_RETENTION_FLOOR_DAYS = (\d+);/,
    );
    expect(windowMatch).not.toBeNull();
    expect(floorMatch).not.toBeNull();
    expect(Number(floorMatch?.[1])).toBeGreaterThan(Number(windowMatch?.[1]));
  });

  it('the player character-select read stays on the default statement timeout', () => {
    // db.ts listCharacters is the login-path character-select read: it deliberately
    // stays on the 15s default so it fails fast during a database brownout rather than
    // pinning a client for up to the heavy allowance. It must NEVER gain the wrapper.
    expect(bodyOf(dbSrc, 'export async function listCharacters')).not.toContain(
      'runWithStatementTimeout',
    );
  });

  it('the character-select read joins the lifetime rollup so folds never shrink playtime', () => {
    // The fold deletes old sessions after folding them into play_session_totals;
    // without this join every player's character-select playtime and last-played
    // would silently shrink after the first fold. Pin the exact rollup terms.
    const body = bodyOf(dbSrc, 'export async function listCharacters');
    expect(body).toContain('LEFT JOIN play_session_totals totals');
    expect(body).toContain('ON totals.account_id = c.account_id AND totals.character_id = c.id');
    expect(body).toContain('GREATEST(ps.last_played, totals.last_played)');
    expect(body).toContain(
      'COALESCE(ps.playtime_seconds, 0) + COALESCE(totals.playtime_seconds, 0)',
    );
  });

  it('the account data export includes the retention rollups', () => {
    // play_session_totals and account_ip_associations are stored personal data;
    // a data export that omits them is unfaithful once raw sessions fold away.
    const body = bodyOf(dbSrc, 'export async function exportAccountData');
    expect(body).toContain('FROM play_session_totals');
    expect(body).toContain('FROM account_ip_associations');
  });

  it('topLifetimeXp predicates and orders on the bare indexed lifetime-XP expression', () => {
    // The two lifetime-XP expression indexes are built on the bare
    // ((state->>'lifetimeXp')::bigint); a COALESCE-wrapped WHERE or an
    // alias-based ORDER BY cannot match them, which silently reverts every 30s
    // leaderboard cache refresh to a full characters scan plus sort. dbSrc is
    // RAW source text, so the pins below match the unevaluated
    // ${LIFETIME_XP_EXPR} token exactly as it sits inside the template literal.
    expect(dbSrc).toContain(`const LIFETIME_XP_EXPR = "((state->>'lifetimeXp')::bigint)";`);
    const body = bodyOf(dbSrc, 'export async function topLifetimeXp');
    // One WHERE filter and one ORDER BY per arm (realm and global): two each,
    // so a reversion of a single arm reddens this too.
    expect(count(body, '${LIFETIME_XP_EXPR} >')).toBe(2);
    expect(count(body, '${LIFETIME_XP_EXPR} DESC')).toBe(2);
    // The old shapes must not return. COALESCE stays legal ONLY as the
    // SELECT-list output value (followed by ' AS'), never as the filter.
    expect(body).not.toContain(`COALESCE((state->>'lifetimeXp')::bigint, 0) >`);
    expect(body).not.toContain('ORDER BY lifetime_xp DESC');
    // NULLS LAST would re-break index usability (a DESC index defaults to
    // NULLS FIRST). Scoped to this body: listCharacterNamesForSitemap keeps
    // its own NULLS LAST deliberately.
    expect(body).not.toContain('NULLS LAST');
    // Tie the index DDL to the same constant so query and index cannot drift:
    // the SCHEMA region spanning both CREATE INDEX statements carries the
    // token once per index.
    const idxStart = dbSrc.indexOf('CREATE INDEX IF NOT EXISTS characters_lifetime_xp');
    expect(idxStart).toBeGreaterThan(-1);
    const globalStart = dbSrc.indexOf('CREATE INDEX IF NOT EXISTS characters_lifetime_xp_global');
    expect(globalStart).toBeGreaterThan(idxStart);
    const idxRegion = dbSrc.slice(idxStart, dbSrc.indexOf(';', globalStart) + 1);
    expect(count(idxRegion, '${LIFETIME_XP_EXPR} DESC')).toBe(2);
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

// A knob is only a knob where it is reachable. server/db.ts reads the env var,
// but the shipped compose deployment hands the game service an explicit
// environment allowlist (no env_file), so a var missing from that list never
// reaches the process however carefully the host .env sets it. The
// deploy_*.test.ts family owns this contract for the other runtime knobs;
// DB_POOL_MAX_CLIENTS rides here, with the rest of its pins.
describe('the DB pool knob reaches the shipped container', () => {
  it('passes DB_POOL_MAX_CLIENTS through to the game service, and documents it', () => {
    const compose = read('docker-compose.yml');
    // Scoped to the game service block: discord-bot runs the SAME image, so a
    // whole-file match would still pass with the line on the wrong service.
    // Bounded at the NEXT top-level service key rather than at discord-bot by
    // name, so inserting a service between the two cannot silently widen the
    // slice (fix-round audit).
    const gameStart = compose.indexOf('\n  game:');
    expect(gameStart).toBeGreaterThanOrEqual(0);
    const rest = compose.slice(gameStart + '\n  game:'.length);
    const next = rest.match(/\n {2}[a-z][a-z-]*:/);
    expect(next).toBeTruthy();
    const gameService = rest.slice(0, next?.index);
    // biome-ignore lint/suspicious/noTemplateCurlyInString: pins compose's own substitution syntax
    expect(gameService).toContain('DB_POOL_MAX_CLIENTS: ${DB_POOL_MAX_CLIENTS:-}');
    // Documented for operators, commented out so the built-in default applies.
    expect(read('.env.example')).toContain('#DB_POOL_MAX_CLIENTS=10');
  });
});
