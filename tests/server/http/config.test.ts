// Self-tests for the pure server config loader. loadConfig takes env as a
// parameter, so these run in plain Node with no real process.env and no DB.
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../../server/http/config';

// The one required field; every other field exercises a default unless overridden.
const MIN_ENV: NodeJS.ProcessEnv = { DATABASE_URL: 'postgres://x' };

describe('loadConfig', () => {
  it('throws fast when DATABASE_URL is missing or empty', () => {
    expect(() => loadConfig({})).toThrow(/DATABASE_URL/);
    expect(() => loadConfig({ DATABASE_URL: '' })).toThrow(/DATABASE_URL/);
  });

  it('never leaks a database url in the thrown message', () => {
    // There is no value to leak in the missing case, but the message must never
    // template the env in, so a future partial value can't surface in logs.
    expect(() => loadConfig({ DATABASE_URL: '' })).toThrow();
    try {
      loadConfig({ DATABASE_URL: '' });
    } catch (e) {
      expect(String((e as Error).message)).not.toMatch(/postgres:|:\/\//);
    }
  });

  it('applies every default given only DATABASE_URL', () => {
    const cfg = loadConfig({ ...MIN_ENV });
    expect(cfg.databaseUrl).toBe('postgres://x');
    expect(cfg.dispatch).toBe('new');
    expect(cfg.port).toBe(8787);
    expect(cfg.allowDevCommands).toBe(false);
    expect(cfg.turnstileSecret).toBe('');
    expect(cfg.maxWsPerIpHard).toBe(20);
    expect(cfg.maxPlayersPerRealm).toBe(5000);
    expect(cfg.githubRepo).toBe('levy-street/world-of-claudecraft');
    expect(cfg.githubToken).toBe('');
    expect(cfg.chatLogRetentionDays).toBe(90);
    expect(cfg.perfReportRetentionDays).toBe(14);
    expect(cfg.requireWebLogin).toBe(false);
    expect(cfg.metricsToken).toBe('');
  });

  it('parses API_DISPATCH=new to dispatch "new"', () => {
    expect(loadConfig({ ...MIN_ENV, API_DISPATCH: 'new' }).dispatch).toBe('new');
    expect(loadConfig({ ...MIN_ENV, API_DISPATCH: 'legacy' }).dispatch).toBe('legacy');
  });

  it('defaults an unset or empty API_DISPATCH to new but THROWS on a garbage value', () => {
    // DEFAULT_DISPATCH is 'new' (the new pipeline is the production
    // default); an unset or empty API_DISPATCH resolves to that default.
    expect(loadConfig({ ...MIN_ENV, API_DISPATCH: '' }).dispatch).toBe('new');
    expect(loadConfig({ ...MIN_ENV }).dispatch).toBe('new');
    // The former silent fallback is now a fail-fast throw naming the key + allowed
    // values (case-sensitive: 'NEW' is not 'new').
    expect(() => loadConfig({ ...MIN_ENV, API_DISPATCH: 'bogus' })).toThrow(/API_DISPATCH/);
    expect(() => loadConfig({ ...MIN_ENV, API_DISPATCH: 'bogus' })).toThrow(
      /legacy.*new|new.*legacy/,
    );
    expect(() => loadConfig({ ...MIN_ENV, API_DISPATCH: 'NEW' })).toThrow(/API_DISPATCH/);
  });

  it('is pure: it reads its env argument, never the global process.env', () => {
    // Poison the ambient process.env, then pass a crafted env with different values;
    // the result must reflect the ARGUMENT, proving loadConfig has no global dependency.
    // Two directions: (a) a key present in BOTH must resolve from the arg, and (b) a
    // key present ONLY in the ambient env must NOT leak through as a fallback (a
    // regression like `env[key] ?? process.env[key]` passes (a) but fails (b)).
    const savedPort = process.env.PORT;
    const savedDispatch = process.env.API_DISPATCH;
    const savedMetricsToken = process.env.METRICS_TOKEN;
    const savedGithubToken = process.env.GITHUB_TOKEN;
    process.env.PORT = '1';
    process.env.API_DISPATCH = 'new';
    process.env.METRICS_TOKEN = 'ambient-leak';
    process.env.GITHUB_TOKEN = 'ambient-leak';
    try {
      const cfg = loadConfig({
        DATABASE_URL: 'postgres://x',
        PORT: '9001',
        API_DISPATCH: 'legacy',
      });
      expect(cfg.port).toBe(9001);
      expect(cfg.dispatch).toBe('legacy');
      // (b): the arg omits these keys, so the defaults must win over the ambient env.
      expect(cfg.metricsToken).toBe('');
      expect(cfg.githubToken).toBe('');
    } finally {
      if (savedPort === undefined) delete process.env.PORT;
      else process.env.PORT = savedPort;
      if (savedDispatch === undefined) delete process.env.API_DISPATCH;
      else process.env.API_DISPATCH = savedDispatch;
      if (savedMetricsToken === undefined) delete process.env.METRICS_TOKEN;
      else process.env.METRICS_TOKEN = savedMetricsToken;
      if (savedGithubToken === undefined) delete process.env.GITHUB_TOKEN;
      else process.env.GITHUB_TOKEN = savedGithubToken;
    }
  });

  it('resolves requireWebLogin from REQUIRE_WEB_LOGIN and throws on a garbage value', () => {
    expect(loadConfig({ ...MIN_ENV, REQUIRE_WEB_LOGIN: '1' }).requireWebLogin).toBe(true);
    expect(loadConfig({ ...MIN_ENV, REQUIRE_WEB_LOGIN: 'true' }).requireWebLogin).toBe(true);
    expect(loadConfig({ ...MIN_ENV, REQUIRE_WEB_LOGIN: '0' }).requireWebLogin).toBe(false);
    expect(loadConfig({ ...MIN_ENV, REQUIRE_WEB_LOGIN: 'false' }).requireWebLogin).toBe(false);
    // Unset falls to the NODE_ENV default.
    expect(loadConfig({ ...MIN_ENV }).requireWebLogin).toBe(false);
    expect(loadConfig({ ...MIN_ENV, NODE_ENV: 'production' }).requireWebLogin).toBe(true);
    expect(
      loadConfig({ ...MIN_ENV, NODE_ENV: 'production', REQUIRE_WEB_LOGIN: '0' }).requireWebLogin,
    ).toBe(false);
    expect(() => loadConfig({ ...MIN_ENV, REQUIRE_WEB_LOGIN: 'yes' })).toThrow(/REQUIRE_WEB_LOGIN/);
  });

  it('validates the two API enforce flags: recognized values pass, garbage throws', () => {
    for (const key of ['API_CONTENT_TYPE_ENFORCE', 'API_ORIGIN_CHECK_ENFORCE']) {
      for (const ok of ['1', 'true', '0', 'false', 'TRUE']) {
        expect(() => loadConfig({ ...MIN_ENV, [key]: ok })).not.toThrow();
      }
      expect(() => loadConfig({ ...MIN_ENV, [key]: 'on' })).toThrow(new RegExp(key));
    }
  });

  it('validates PUBLIC_ORIGIN parseability: a bare origin passes, garbage throws, unset passes', () => {
    expect(() => loadConfig({ ...MIN_ENV, PUBLIC_ORIGIN: 'https://example.com' })).not.toThrow();
    // A trailing slash is tolerated (matches realm.resolvePublicOrigin).
    expect(() => loadConfig({ ...MIN_ENV, PUBLIC_ORIGIN: 'https://example.com/' })).not.toThrow();
    expect(() => loadConfig({ ...MIN_ENV })).not.toThrow();
    expect(() => loadConfig({ ...MIN_ENV, PUBLIC_ORIGIN: 'not-a-url' })).toThrow(/PUBLIC_ORIGIN/);
    // A path/query/credentials makes it not a bare origin.
    expect(() => loadConfig({ ...MIN_ENV, PUBLIC_ORIGIN: 'https://example.com/path' })).toThrow(
      /PUBLIC_ORIGIN/,
    );
    expect(() => loadConfig({ ...MIN_ENV, PUBLIC_ORIGIN: 'ftp://example.com' })).toThrow(
      /PUBLIC_ORIGIN/,
    );
    // Per-dimension negatives for the remaining isBareOrigin checks: credentials,
    // query, and hash each independently disqualify a "bare" origin.
    expect(() =>
      loadConfig({ ...MIN_ENV, PUBLIC_ORIGIN: 'https://user:pass@example.com' }),
    ).toThrow(/PUBLIC_ORIGIN/);
    expect(() => loadConfig({ ...MIN_ENV, PUBLIC_ORIGIN: 'https://example.com?x=1' })).toThrow(
      /PUBLIC_ORIGIN/,
    );
    expect(() => loadConfig({ ...MIN_ENV, PUBLIC_ORIGIN: 'https://example.com#frag' })).toThrow(
      /PUBLIC_ORIGIN/,
    );
  });

  it('validates REALMS: a usable entry passes, a garbage list throws, same-origin/unset pass', () => {
    expect(() =>
      loadConfig({ ...MIN_ENV, REALMS: 'Claudemoon=https://claudemoon.example.com=Normal' }),
    ).not.toThrow();
    // An empty url is the same-origin realm parseRealms keeps.
    expect(() => loadConfig({ ...MIN_ENV, REALMS: 'Claudemoon=' })).not.toThrow();
    expect(() => loadConfig({ ...MIN_ENV })).not.toThrow();
    // No '=' at all, or a non-bare url, yields zero usable entries.
    expect(() => loadConfig({ ...MIN_ENV, REALMS: 'Claudemoon' })).toThrow(/REALMS/);
    expect(() => loadConfig({ ...MIN_ENV, REALMS: 'Claudemoon=not-a-url' })).toThrow(/REALMS/);
    // A credentialed url is not a bare origin either (same isBareOrigin rule).
    expect(() =>
      loadConfig({ ...MIN_ENV, REALMS: 'Claudemoon=https://u:p@claudemoon.example.com' }),
    ).toThrow(/REALMS/);
  });

  it('reads METRICS_TOKEN as an optional secret string, defaulting to empty', () => {
    expect(loadConfig({ ...MIN_ENV }).metricsToken).toBe('');
    expect(loadConfig({ ...MIN_ENV, METRICS_TOKEN: 'scrape-me' }).metricsToken).toBe('scrape-me');
  });

  it('parses ALLOW_DEV_COMMANDS=1 as true and anything else as false', () => {
    expect(loadConfig({ ...MIN_ENV, ALLOW_DEV_COMMANDS: '1' }).allowDevCommands).toBe(true);
    expect(loadConfig({ ...MIN_ENV, ALLOW_DEV_COMMANDS: 'true' }).allowDevCommands).toBe(false);
    expect(loadConfig({ ...MIN_ENV, ALLOW_DEV_COMMANDS: '0' }).allowDevCommands).toBe(false);
  });

  it('reads the numeric and string overrides', () => {
    const cfg = loadConfig({
      ...MIN_ENV,
      PORT: '9000',
      MAX_WS_PER_IP_HARD: '5',
      TURNSTILE_SECRET: 'sekret',
      GITHUB_REPO: 'me/fork',
      GITHUB_TOKEN: 'ghtok',
      CHAT_LOG_RETENTION_DAYS: '7',
      PERF_REPORT_RETENTION_DAYS: '3',
    });
    expect(cfg.port).toBe(9000);
    expect(cfg.maxWsPerIpHard).toBe(5);
    expect(cfg.turnstileSecret).toBe('sekret');
    expect(cfg.githubRepo).toBe('me/fork');
    expect(cfg.githubToken).toBe('ghtok');
    expect(cfg.chatLogRetentionDays).toBe(7);
    expect(cfg.perfReportRetentionDays).toBe(3);
  });

  it('falls back to defaults for a non-numeric or empty numeric env', () => {
    const cfg = loadConfig({ ...MIN_ENV, PORT: 'abc', MAX_WS_PER_IP_HARD: '' });
    expect(cfg.port).toBe(8787);
    expect(cfg.maxWsPerIpHard).toBe(20);
  });

  it('treats a SET-BUT-EMPTY numeric as unset (default), a documented deploy hazard', () => {
    // DELIBERATE semantic pin: before loadConfig, main.ts used Number(env.KEY ?? default),
    // so 'CHAT_LOG_RETENTION_DAYS=' (an empty .env placeholder line) meant
    // Number('') = 0 = keep chat logs forever (pruneChatLogs(0) no-ops). numberOr
    // now reads empty as unset, so the SAME env line means the 90-day default and
    // pruning turns ON. The pre-ship deploy-env audit and the DEPLOY.md env-hygiene
    // note carry this; keep-forever is an EXPLICIT 'CHAT_LOG_RETENTION_DAYS=0' now.
    // If this pin surprises you, read those notes before changing numberOr.
    const cfg = loadConfig({ ...MIN_ENV, CHAT_LOG_RETENTION_DAYS: '', PORT: '' });
    expect(cfg.chatLogRetentionDays).toBe(90);
    expect(cfg.port).toBe(8787);
    // An explicit 0 is preserved: the keep-forever contract stays reachable.
    expect(loadConfig({ ...MIN_ENV, CHAT_LOG_RETENTION_DAYS: '0' }).chatLogRetentionDays).toBe(0);
  });

  it('reads MAX_PLAYERS_PER_REALM: a number overrides, empty or whitespace is the default, 0 passes through', () => {
    // A set value overrides the default.
    expect(loadConfig({ ...MIN_ENV, MAX_PLAYERS_PER_REALM: '75' }).maxPlayersPerRealm).toBe(75);
    // Set-but-empty (a stray '.env' placeholder line) reads as unset -> the default.
    expect(loadConfig({ ...MIN_ENV, MAX_PLAYERS_PER_REALM: '' }).maxPlayersPerRealm).toBe(5000);
    // Whitespace-only is trimmed to unset -> the default: Number('   ') is 0, so an
    // untrimmed read would take a stray-spaces line as an explicit 0 and silently
    // DISABLE the cap (fail-open, the unsafe direction for this key).
    expect(loadConfig({ ...MIN_ENV, MAX_PLAYERS_PER_REALM: '   ' }).maxPlayersPerRealm).toBe(5000);
    // An explicit 0 passes through numberOr unchanged: the disable rule lives at the
    // admission site (server/ws_auth.ts, a cap > 0 test), never in the loader. Stray
    // spaces around the 0 do not hide the intent.
    expect(loadConfig({ ...MIN_ENV, MAX_PLAYERS_PER_REALM: '0' }).maxPlayersPerRealm).toBe(0);
    expect(loadConfig({ ...MIN_ENV, MAX_PLAYERS_PER_REALM: ' 0 ' }).maxPlayersPerRealm).toBe(0);
  });

  it('returns a frozen Config whose fields cannot be mutated', () => {
    const cfg = loadConfig({ ...MIN_ENV });
    expect(Object.isFrozen(cfg)).toBe(true);
    // Strict mode (ESM) makes an assignment to a frozen property throw, and the
    // value is unchanged regardless.
    expect(() => {
      (cfg as { port: number }).port = 1;
    }).toThrow();
    expect(cfg.port).toBe(8787);
  });
});
