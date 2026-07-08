// The consolidated-tunables gate: pins every consolidated server tunable to BOTH
// its literal value and (for the rate-limit policies) its derivation source, so a
// value can never drift silently and a re-inlined magic literal is caught. The
// repo's known trap is the constant-self-comparison pin (asserting only the SAME
// exported constant the code uses protects nothing); every pin here also asserts
// the literal expected number.

import * as fs from 'node:fs';
import * as http from 'node:http';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DESKTOP_LOGIN_TTL_MS } from '../../server/desktop_login';
import {
  ASSET_UPLOAD_POLICY,
  CARD_UPLOAD_POLICY,
  CHARACTER_CREATE_POLICY,
  CHARACTER_DELETE_POLICY,
  CHARACTER_RENAME_POLICY,
  CHARACTER_TAKEOVER_POLICY,
  DISCORD_POLICY,
  MAP_MUTATION_POLICY,
  PUBLIC_READ_POLICY,
  type RateLimitPolicy,
  REPORTS_CREATE_POLICY,
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
  DISCORD_MAX_PER_MINUTE,
  MAP_MUTATION_MAX_PER_MINUTE,
  PUBLIC_READ_MAX_PER_MINUTE,
  REPORTS_CREATE_MAX_PER_MINUTE,
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
