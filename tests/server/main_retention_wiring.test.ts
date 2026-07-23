// Source-text order pins for the retention-sweep wiring in server/main.ts.
// main.ts cannot be imported (it boots a server + connects to Postgres on
// import), so the boot-order and teardown-order guarantees are verified
// structurally, in the tests/companion_read_api.test.ts idiom. Every needle is
// a CALL-form token (trailing '(') so an import line can never satisfy a pin.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const MAIN = readFileSync(join(__dirname, '..', '..', 'server', 'main.ts'), 'utf8');
const count = (haystack: string, needle: string): number => haystack.split(needle).length - 1;

describe('retention sweep wiring in server/main.ts', () => {
  it('keeps orphan-session cleanup a boot precondition, ahead of listen', () => {
    // Orphan cleanup must stay ahead of listen: a fresh process must reconcile
    // stale play sessions before it starts accepting traffic.
    expect(count(MAIN, 'closeOrphanSessions(')).toBeGreaterThanOrEqual(1);
    expect(MAIN.indexOf('closeOrphanSessions(')).toBeLessThan(MAIN.indexOf('server.listen('));
  });

  it('runs no retention DELETE before the server is listening', () => {
    // No retention prune may ever block or precede boot again: the old one-shot
    // boot prunes held boot hostage to an unbounded DELETE on a large table.
    // ALL nine prune call-forms plus the fold are named: a prune MOVED (not
    // copied) to a pre-listen one-shot keeps its exactly-once count and only
    // this list catches it.
    const preListen = MAIN.slice(0, MAIN.indexOf('server.listen('));
    for (const call of [
      'pruneChatLogs(',
      'pruneClientPerfReports(',
      'pruneChatLogsBatch(',
      'pruneClientPerfReportsBatch(',
      'pruneDailyRewardEventsBatch(',
      'prunePlayerActivityDailyBatch(',
      'pruneOnlineSamplesBatch(',
      'pruneSitePresenceSamplesBatch(',
      'pruneSitePresenceSessionsBatch(',
      'prunePlaySessionsBatch(',
      'pruneAccountIpAssociationsBatch(',
      'foldOnlinePeak(',
    ]) {
      expect(preListen).not.toContain(call);
    }
  });

  it('arms the sweep only after the server is accepting traffic', () => {
    // Retention work must never compete with boot; the sweep starts post-listen.
    expect(MAIN.indexOf('retentionSweep.start()')).toBeGreaterThan(-1);
    expect(MAIN.indexOf('server.listen(')).toBeLessThan(MAIN.indexOf('retentionSweep.start()'));
  });

  it('wires each batched prune exactly once and fully retires the old names', () => {
    // Exactly one call site each: the sweep deps closures. A second call site
    // would mean an old one-shot prune path crept back in.
    expect(count(MAIN, 'pruneChatLogsBatch(')).toBe(1);
    expect(count(MAIN, 'pruneClientPerfReportsBatch(')).toBe(1);
    // The old unbounded prune names are fully retired (the Batch names cannot
    // match these needles: 'B' follows the name, never '(').
    expect(count(MAIN, 'pruneChatLogs(')).toBe(0);
    expect(count(MAIN, 'pruneClientPerfReports(')).toBe(0);
  });

  it('wires every sweep table and online-samples hook exactly once', () => {
    // One call site each, inside the sweep deps closures: deleting a deps entry
    // silently disables that table's retention with everything else green.
    for (const call of [
      'pruneDailyRewardEventsBatch(',
      'prunePlayerActivityDailyBatch(',
      'pruneOnlineSamplesBatch(',
      'pruneSitePresenceSamplesBatch(',
      'pruneSitePresenceSessionsBatch(',
      'prunePlaySessionsBatch(',
      'pruneAccountIpAssociationsBatch(',
      'foldOnlinePeak(',
      'distinctOnlineSampleRealms(',
      'dailyRewardEventsCutoffDay(',
    ]) {
      expect(count(MAIN, call)).toBe(1);
    }
  });

  it('derives the daily_reward_events cutoff from the reward clock, behind the keep-forever guard', () => {
    // The clock-derived cutoff and the keep-forever guard are load-bearing and
    // live only here. The derivation itself (sign, clamp) is unit-tested in
    // tests/daily_rewards_cutoff.test.ts; this pin proves main.ts actually
    // calls it and honors the null (keep forever) contract.
    expect(MAIN).toContain(
      'const cutoff = await dailyRewardEventsCutoffDay(config.dailyRewardEventsRetentionDays);',
    );
    expect(MAIN).toContain('if (cutoff === null) return 0;');
  });

  it('threads each sweep knob from config, never a hardcoded literal', () => {
    // Hardcoding any of these orphans its env key: the knob would keep passing
    // the config tests while the sweep silently ignores it.
    expect(MAIN).toContain('utcHour: config.retentionSweepUtcHour');
    expect(MAIN).toContain('maxRowsPerRun: config.retentionSweepMaxRowsPerRun');
    expect(MAIN).toContain('batchSize: RETENTION_SWEEP_BATCH_SIZE');
  });

  it('threads each retention-days knob into its own prune closure', () => {
    // The unit suites call the primitives directly with correct arguments, so
    // only these pins catch a closure that swaps arguments or threads the
    // WRONG config key (a 1000-day retention passed as a batch size, or the
    // online-samples days feeding a site-presence prune).
    expect(MAIN).toContain('pruneChatLogsBatch(config.chatLogRetentionDays, n)');
    expect(MAIN).toContain('pruneClientPerfReportsBatch(config.perfReportRetentionDays, n)');
    expect(MAIN).toContain(
      'prunePlayerActivityDailyBatch(pool, config.playerActivityRetentionDays, n)',
    );
    expect(MAIN).toContain('pruneSitePresenceSamplesBatch(config.sitePresenceRetentionDays, n)');
    expect(MAIN).toContain('pruneSitePresenceSessionsBatch(config.sitePresenceRetentionDays, n)');
    expect(MAIN).toContain('pruneOnlineSamplesBatch(realm, config.onlineSamplesRetentionDays, n)');
    expect(MAIN).toContain('prunePlaySessionsBatch(pool, config.playSessionRetentionDays, n)');
    expect(MAIN).toContain(
      'pruneAccountIpAssociationsBatch(pool, config.accountIpAssociationRetentionDays, n)',
    );
  });

  it('sweeps the play-session fold before the association ager', () => {
    // The fold WRITES account_ip_associations, so the feeder must precede the
    // ager in the tables array (the sweep runs entries in array order): an
    // anciently-dated link folded in tonight's run is then aged out in the
    // same run instead of surviving an extra day.
    expect(MAIN.indexOf("name: 'play_sessions'")).toBeGreaterThan(-1);
    expect(MAIN.indexOf("name: 'play_sessions'")).toBeLessThan(
      MAIN.indexOf("name: 'account_ip_associations'"),
    );
  });

  it('gates the whole online-samples group on retention being enabled', () => {
    // Retention off must skip the group INCLUDING the folds, so quiet configs
    // write nothing to world_state.
    expect(MAIN).toContain('config.onlineSamplesRetentionDays > 0');
  });

  it('persists the last-swept day under one world_state key on both sides', () => {
    // The marker key must match on load and save: a drifted key reads null on
    // every boot and re-runs the sweep after every mid-day restart.
    expect(MAIN).toContain("loadWorldState<{ day?: unknown }>('retention_sweep:last_run')");
    expect(MAIN).toContain("saveWorldState('retention_sweep:last_run', { day })");
  });

  it('stops the sweep during shutdown, after the collectors and before the pool close', () => {
    // An in-flight prune batch must never race pool.end(). The needle for the
    // pool close is the await-call form: the bare token also appears in shutdown
    // rationale comments that precede the stop call.
    const stopAt = MAIN.indexOf('retentionSweep.stop()');
    expect(stopAt).toBeGreaterThan(-1);
    expect(stopAt).toBeLessThan(MAIN.indexOf('await pool.end()'));
    // It sits with the other collector teardown, right after the metrics stop.
    expect(stopAt).toBeGreaterThan(MAIN.indexOf('businessMetrics.stop()'));
  });

  it('keeps the five OAuth and pending-login prunes on the daily interval', () => {
    // Scope guard: only the retention prunes moved to the sweep; the cheap
    // token/state prunes stay on DAILY_PRUNE_INTERVAL_MS. Assert inside the
    // interval callback's slice: a presence-anywhere pin would still pass if
    // one of these drifted out of the interval but stayed in the file.
    const end = MAIN.indexOf(', DAILY_PRUNE_INTERVAL_MS).unref()');
    expect(end).toBeGreaterThan(-1);
    const start = MAIN.lastIndexOf('setInterval', end);
    expect(start).toBeGreaterThan(-1);
    const interval = MAIN.slice(start, end);
    for (const call of [
      'pruneExpiredOAuthGrants(',
      'pruneDiscordOAuthStates(',
      'pruneDiscordPendingLogins(',
      'pruneApplePendingLogins(',
      'pruneGitHubOAuthStates(',
    ]) {
      expect(interval).toContain(call);
    }
  });
});
