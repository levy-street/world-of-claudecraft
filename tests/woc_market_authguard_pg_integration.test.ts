// Real-Postgres coverage for the marketplace auth-guard read cache rider: the
// token probe's expires_at qual against real rows (live, expired, deleted are
// one indistinguishable null), the raw-row fetchers the cache composes, and
// the REAL writer-to-bust chain end to end for every auth_tokens revocation
// writer (revokeToken with a raw-SQL warm-stale control, revokeReadToken,
// revokeCompanionToken with a seeded sibling survivor, revokeTokensExcept,
// consumePasswordResetRequest) and the moderation writers (moderateAccount's
// ban/suspend/unban arms, chat mute and unmute, the audited reactivate and
// strike reset, the live strike writers, the quota policy setter both
// directions, the deactivation flip): each fires its bust from inside the
// real function (post-COMMIT), and the cache singleton configured over the
// REAL fetchers refuses or refreshes on the very next read. The rig pins a
// LONG cache TTL so every proof is decisive by construction (the control
// proves a warm entry still serves until the bust), never by wall-clock
// accident. The unit suites prove the cache mechanics over fakes; THIS
// suite proves the SQL and the wiring those tests assume.
//
// Gate: TEST_DATABASE_URL (an admin URL on the dev Postgres from npm run
// db:up). The suite creates and drops its own database and never touches the
// database the URL points at. Pattern: tests/woc_market_stepup_pg_integration.test.ts.
import { Pool } from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  configureWocAuthGuardCache,
  resetWocAuthGuardCache,
  type WocAuthGuardCache,
} from '../server/woc_auth_guard_cache';

const ADMIN_URL = process.env.TEST_DATABASE_URL;
const VERIFY_DB = 'wocc_woc_market_authguard_verify';

function verifyUrl(admin: string): string {
  const u = new URL(admin);
  u.pathname = `/${VERIFY_DB}`;
  return u.toString();
}

// server/db.ts reads DATABASE_URL at module load and builds its pool from it.
// Nothing above is a static import of a pg-bearing server module (the cache
// module and its pure core import no database code), so this assignment runs
// first and points the boot path at the disposable database.
if (ADMIN_URL) process.env.DATABASE_URL = verifyUrl(ADMIN_URL);

const describeDb = ADMIN_URL ? describe : describe.skip;

describeDb('woc market auth-guard reads against real Postgres', () => {
  let admin: Pool;
  let pool: Pool;
  let db: typeof import('../server/db');
  let moderationDb: typeof import('../server/moderation_db');
  let chatFilterDb: typeof import('../server/chat_filter_db');
  let quotaDb: typeof import('../server/general_chat_quota_db');
  let cache: WocAuthGuardCache;
  let seq = 0;

  beforeAll(async () => {
    admin = new Pool({ connectionString: ADMIN_URL, max: 2 });
    const own = new URL(ADMIN_URL as string).pathname.replace(/^\//, '');
    // Never drop the database the caller pointed us at.
    expect(own).not.toBe(VERIFY_DB);
    await admin.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [VERIFY_DB],
    );
    await admin.query(`DROP DATABASE IF EXISTS ${VERIFY_DB}`);
    await admin.query(`CREATE DATABASE ${VERIFY_DB}`);

    db = await import('../server/db');
    moderationDb = await import('../server/moderation_db');
    chatFilterDb = await import('../server/chat_filter_db');
    quotaDb = await import('../server/general_chat_quota_db');

    // The REAL boot path, so the tables and quals under test are the ones
    // production gets.
    await db.ensureSchema();

    pool = new Pool({ connectionString: verifyUrl(ADMIN_URL as string), max: 6 });
  }, 120_000);

  afterAll(async () => {
    resetWocAuthGuardCache();
    await pool?.end().catch(() => {});
    await quotaDb?.closeGeneralChatQuotaPool().catch(() => {});
    await db?.pool?.end().catch(() => {});
    await admin?.end().catch(() => {});
  }, 30_000);

  afterEach(() => {
    resetWocAuthGuardCache();
  });

  /** The singleton over the REAL fetchers: what production wires at boot, so
   *  the writers' free bust calls reach exactly this instance. */
  function armCache(): WocAuthGuardCache {
    cache = configureWocAuthGuardCache(
      {
        fetchTokenRow: db.authTokenRowForToken,
        fetchModerationRow: db.moderationRowForAccount,
      },
      // A LONG TTL: on the real clock the production 5s could lapse between
      // the warm read and the post-write read on a loaded box, making every
      // bust proof pass for the wrong reason. With five minutes, only the
      // BUST can explain a fresh answer.
      { ttlMs: 300_000 },
    );
    return cache;
  }

  async function seedAccount(): Promise<number> {
    seq++;
    const res = await pool.query(
      `INSERT INTO accounts (username, password_hash) VALUES ($1, 'x') RETURNING id`,
      [`woc-authguard-fixture-${seq}`],
    );
    return Number(res.rows[0].id);
  }

  function newToken(): string {
    seq++;
    return seq.toString(16).padStart(8, '0') + 'c'.repeat(56);
  }

  /** The armed instance's token-arm refresh counter: unchanged across a
   *  read proves the answer came from the warm entry, not a re-probe. */
  function cacheTokenRefreshes(): number {
    return cache.stats().tokens.refreshes;
  }

  it('probes a live token row with its expiry, and the qual hides an expired row', async () => {
    const account = await seedAccount();
    const live = newToken();
    await db.saveToken(live, account, 24, 'full', null);
    const row = await db.authTokenRowForToken(live);
    expect(row?.accountId).toBe(account);
    expect(row?.scope).toBe('full');
    // The fetcher surfaces the REAL expires_at as epoch ms (the read-time
    // re-check's input), roughly 24h out.
    expect(row?.expiresAtMs).toBeGreaterThan(Date.now() + 23 * 3600 * 1000);
    expect(row?.expiresAtMs).toBeLessThan(Date.now() + 25 * 3600 * 1000);

    // An EXPIRED row: present in the table, invisible to the probe, exactly
    // like a deleted one (no caller distinguishes the two).
    const expired = newToken();
    await pool.query(
      `INSERT INTO auth_tokens (token, account_id, expires_at, scope) VALUES ($1, $2, now() - interval '1 hour', 'full')`,
      [expired, account],
    );
    expect(await db.authTokenRowForToken(expired)).toBeNull();
    expect(await db.accountAndScopeForToken(expired)).toBeNull();
    expect(await db.authTokenRowForToken(newToken())).toBeNull();
  });

  it('fetches the raw moderation row with the LEFT-JOINed policy columns', async () => {
    const account = await seedAccount();
    const bare = await db.moderationRowForAccount(account);
    expect(bare).not.toBeNull();
    expect(bare?.banned_at).toBeNull();
    expect(bare?.messages).toBeNull();
    expect(await db.moderationRowForAccount(999_999_999)).toBeNull();
  });

  it('refuses a revoked token on the next cached read (revokeToken fires the bust)', async () => {
    const account = await seedAccount();
    const token = newToken();
    await db.saveToken(token, account, 24, 'full', null);
    armCache();
    await expect(cache.accountAndScopeForToken(token)).resolves.toEqual({
      accountId: account,
      scope: 'full',
    });
    // CONTROL: delete the row with RAW SQL (no bust fires): the warm entry
    // still answers, proving the entry is load-bearing and the fresh
    // refusals in this suite can only come from the writers' busts.
    await pool.query('DELETE FROM auth_tokens WHERE token = $1', [token]);
    await expect(cache.accountAndScopeForToken(token)).resolves.toEqual({
      accountId: account,
      scope: 'full',
    });
    // The REAL writer (row already gone; the bust is what it contributes).
    await db.revokeToken(token);
    await expect(cache.accountAndScopeForToken(token)).resolves.toBeNull();
  });

  it('refuses a revoked READ token on the next cached read (revokeReadToken fires the bust)', async () => {
    const account = await seedAccount();
    const token = newToken();
    const fullToken = newToken();
    await db.createCompanionToken(token, account, 'companion');
    // The scope qual's violating fixture: a FULL token with the same value
    // shape must survive a read-scoped revocation (the `scope = 'read'` arm
    // is what makes revokeReadToken safe to expose to companion clients).
    await db.saveToken(fullToken, account, 24, 'full', null);
    armCache();
    await expect(cache.accountAndScopeForToken(token)).resolves.toEqual({
      accountId: account,
      scope: 'read',
    });
    const removed = await db.revokeReadToken(token);
    expect(removed).toBe(true);
    await expect(cache.accountAndScopeForToken(token)).resolves.toBeNull();
    // The full token's ROW survived the scoped delete (fresh probe: the
    // token-keyed bust dropped only the revoked value's entry anyway).
    await expect(cache.accountAndScopeForToken(fullToken)).resolves.toEqual({
      accountId: account,
      scope: 'full',
    });
    // And revoking a FULL token through the read-scoped endpoint deletes
    // nothing (the qual refuses, rowCount 0).
    expect(await db.revokeReadToken(fullToken)).toBe(false);
  });

  it('refuses a revoked companion token AND its cached siblings (the prefix over-bust)', async () => {
    const account = await seedAccount();
    const strangerAccount = await seedAccount();
    const doomed = newToken();
    const sibling = newToken();
    // The account_id qual's violating fixture: ANOTHER account's companion
    // token sharing the doomed 8-char prefix must survive the delete.
    const strangerSamePrefix = doomed.slice(0, 8) + 'd'.repeat(56);
    await db.createCompanionToken(doomed, account, 'doomed');
    await db.createCompanionToken(sibling, account, 'sibling');
    await db.createCompanionToken(strangerSamePrefix, strangerAccount, 'stranger');
    armCache();
    await expect(cache.accountAndScopeForToken(doomed)).resolves.toEqual({
      accountId: account,
      scope: 'read',
    });
    await expect(cache.accountAndScopeForToken(sibling)).resolves.toEqual({
      accountId: account,
      scope: 'read',
    });
    // The REAL prefix-keyed delete: the writer holds only accountId + prefix,
    // so the account-keyed bust must drop BOTH cached tokens; the survivor
    // re-fetches and still answers, the revoked one refuses.
    const removed = await db.revokeCompanionToken(account, doomed.slice(0, 8));
    expect(removed).toBe(true);
    await expect(cache.accountAndScopeForToken(doomed)).resolves.toBeNull();
    await expect(cache.accountAndScopeForToken(sibling)).resolves.toEqual({
      accountId: account,
      scope: 'read',
    });
    // The same-prefix stranger's ROW survived the account-scoped delete.
    await expect(cache.accountAndScopeForToken(strangerSamePrefix)).resolves.toEqual({
      accountId: strangerAccount,
      scope: 'read',
    });
  });

  it('keeps only the kept token after revokeTokensExcept, freshly probed', async () => {
    const account = await seedAccount();
    const strangerAccount = await seedAccount();
    const kept = newToken();
    const dropped = newToken();
    const strangerToken = newToken();
    await db.saveToken(kept, account, 24, 'full', null);
    await db.saveToken(dropped, account, 24, 'full', null);
    // The account_id qual's violating fixture: another account's token must
    // survive the sweep (a dropped qual would sign out the whole realm).
    await db.saveToken(strangerToken, strangerAccount, 24, 'full', null);
    armCache();
    await cache.accountAndScopeForToken(kept);
    await cache.accountAndScopeForToken(dropped);
    await db.revokeTokensExcept(account, kept);
    await expect(cache.accountAndScopeForToken(dropped)).resolves.toBeNull();
    await expect(cache.accountAndScopeForToken(kept)).resolves.toEqual({
      accountId: account,
      scope: 'full',
    });
    await expect(cache.accountAndScopeForToken(strangerToken)).resolves.toEqual({
      accountId: strangerAccount,
      scope: 'full',
    });
  });

  it('signs out every cached session when a password reset consumes', async () => {
    const account = await seedAccount();
    const strangerAccount = await seedAccount();
    const token = newToken();
    const strangerToken = newToken();
    await db.saveToken(token, account, 24, 'full', null);
    // The in-transaction DELETE is account-wide, not realm-wide: a stranger's
    // session survives the reset (the account_id qual's violating fixture).
    await db.saveToken(strangerToken, strangerAccount, 24, 'full', null);
    await db.createPasswordResetRequest(account, 'reset-hash-1', 1);
    armCache();
    await cache.accountAndScopeForToken(token);
    await cache.accountAndScopeForToken(strangerToken);
    const consumed = await db.consumePasswordResetRequest('reset-hash-1', 'new-hash');
    expect(consumed?.accountId).toBe(account);
    await expect(cache.accountAndScopeForToken(token)).resolves.toBeNull();
    const before = cacheTokenRefreshes();
    await expect(cache.accountAndScopeForToken(strangerToken)).resolves.toEqual({
      accountId: strangerAccount,
      scope: 'full',
    });
    // Still warm: the account-keyed bust did not touch the stranger's entry.
    expect(cacheTokenRefreshes()).toBe(before);
  });

  it('locks a cached account on the next read after a REAL ban, and unlocks on unban', async () => {
    const target = await seedAccount();
    const operator = await seedAccount();
    armCache();
    expect((await cache.moderationStatusForAccount(target)).locked).toBe(false);
    // The real four-arm chokepoint (writes + audit row + report resolution,
    // one transaction, bust after COMMIT).
    await moderationDb.moderateAccount({
      accountId: target,
      adminAccountId: operator,
      action: 'ban',
      reason: 'rmt',
    });
    const banned = await cache.moderationStatusForAccount(target);
    expect(banned.locked).toBe(true);
    expect(banned.banned).toBe(true);
    expect(banned.message).toBe('This account has been banned.');
    await moderationDb.moderateAccount({
      accountId: target,
      adminAccountId: operator,
      action: 'unban',
      reason: 'appeal',
    });
    expect((await cache.moderationStatusForAccount(target)).locked).toBe(false);
  });

  it('computes an active suspension from the REAL timestamptz row', async () => {
    const target = await seedAccount();
    const operator = await seedAccount();
    const until = new Date(Date.now() + 2 * 3600 * 1000);
    armCache();
    await cache.moderationStatusForAccount(target);
    await moderationDb.moderateAccount({
      accountId: target,
      adminAccountId: operator,
      action: 'suspend',
      reason: 'griefing',
      expiresAt: until.toISOString(),
    });
    const status = await cache.moderationStatusForAccount(target);
    expect(status.locked).toBe(true);
    expect(status.banned).toBe(false);
    expect(status.suspendedUntil).toBe(until.toISOString());
    expect(status.message).toBe(`This account is suspended until ${until.toUTCString()}.`);
  });

  it('serves a fresh strike and mute after the live chat writer busts', async () => {
    const target = await seedAccount();
    armCache();
    expect((await cache.moderationStatusForAccount(target)).chatStrikes).toBe(0);
    const applied = await chatFilterDb.applyChatStrike(target, 600);
    expect(applied.strikes).toBe(1);
    const status = await cache.moderationStatusForAccount(target);
    expect(status.chatStrikes).toBe(1);
    expect(status.chatMutedUntil).not.toBeNull();
    // The unaudited strike reset (the second live writer) busts too.
    await chatFilterDb.resetChatStrikes(target);
    expect((await cache.moderationStatusForAccount(target)).chatStrikes).toBe(0);
  });

  it('serves a fresh quota policy after the setter busts (LEFT JOIN both ways)', async () => {
    const target = await seedAccount();
    const operator = await seedAccount();
    armCache();
    expect((await cache.moderationStatusForAccount(target)).generalChatRateLimit).toBeNull();
    await quotaDb.setGeneralChatRateLimit({
      accountId: target,
      adminAccountId: operator,
      rateLimit: { messages: 5, windowMinutes: 10 },
      reason: 'flood',
    });
    expect((await cache.moderationStatusForAccount(target)).generalChatRateLimit).toEqual({
      messages: 5,
      windowMinutes: 10,
    });
    // The DELETE side of the policy writer: back to Unlimited on the next read.
    await quotaDb.setGeneralChatRateLimit({
      accountId: target,
      adminAccountId: operator,
      rateLimit: null,
      reason: 'lifted',
    });
    expect((await cache.moderationStatusForAccount(target)).generalChatRateLimit).toBeNull();
  });

  it('serves each audited moderation writer fresh: mute, unmute, strike reset, reactivate', async () => {
    const target = await seedAccount();
    const operator = await seedAccount();
    armCache();
    expect((await cache.moderationStatusForAccount(target)).chatMutedUntil).toBeNull();
    await moderationDb.muteAccountChat({
      accountId: target,
      adminAccountId: operator,
      reason: 'spam',
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    });
    expect((await cache.moderationStatusForAccount(target)).chatMutedUntil).not.toBeNull();
    await moderationDb.liftAccountChatMute({
      accountId: target,
      adminAccountId: operator,
      reason: 'appeal',
    });
    expect((await cache.moderationStatusForAccount(target)).chatMutedUntil).toBeNull();
    await chatFilterDb.applyChatStrike(target, 0);
    expect((await cache.moderationStatusForAccount(target)).chatStrikes).toBe(1);
    const reset = await moderationDb.resetChatStrikesAudited({
      accountId: target,
      adminAccountId: operator,
      reason: 'appeal',
    });
    expect(reset).toBe(true);
    expect((await cache.moderationStatusForAccount(target)).chatStrikes).toBe(0);
    await db.setAccountDeactivated(target, true);
    expect((await cache.moderationStatusForAccount(target)).deactivated).toBe(true);
    await moderationDb.reactivateAccountAudited({
      accountId: target,
      adminAccountId: operator,
      reason: 'owner request',
    });
    expect((await cache.moderationStatusForAccount(target)).locked).toBe(false);
  });

  it('locks a self-deactivated account on the next cached read', async () => {
    const target = await seedAccount();
    armCache();
    expect((await cache.moderationStatusForAccount(target)).locked).toBe(false);
    await db.setAccountDeactivated(target, true);
    const status = await cache.moderationStatusForAccount(target);
    expect(status.locked).toBe(true);
    expect(status.deactivated).toBe(true);
    await db.setAccountDeactivated(target, false);
    expect((await cache.moderationStatusForAccount(target)).locked).toBe(false);
  });
});
