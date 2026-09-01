// Source-text order pins for the retention-sweep wiring in server/main.ts.
// main.ts cannot be imported (it boots a server + connects to Postgres on
// import), so the boot-order and teardown-order guarantees are verified
// structurally, in the tests/companion_read_api.test.ts idiom. Every needle is
// a CALL-form token (trailing '(') so an import line can never satisfy a pin.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { stripComments } from '../helpers/strip_comments';

// Comment-stripped so a commented-out call can never satisfy an order pin.
const MAIN_PATH = join(__dirname, '..', '..', 'server', 'main.ts');
const MAIN = stripComments(readFileSync(MAIN_PATH, 'utf8'));
// The RAW read, for the ONE pin whose subject IS a comment: the bank_ledger
// no-sweep asymmetry is a decision that lives beside the table list, and reading
// it out of MAIN would ask a comment-stripped source for a comment. Everything
// else keeps MAIN, so a commented-out call still cannot satisfy an order pin.
const MAIN_RAW = readFileSync(MAIN_PATH, 'utf8');
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
    // boot prunes held boot hostage to an unbounded DELETE on a large table
    // (and v0.32.0 shipped exactly that shape again for unstuck_reports, which
    // this list caught at the release merge). EVERY prune call-form plus the
    // fold is named: a prune MOVED (not copied) to a pre-listen one-shot keeps
    // its exactly-once count and only this list catches it.
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
      'pruneUnstuckReports(',
      'pruneUnstuckReportsBatch(',
      'foldOnlinePeak(',
      'prunePasswordResetRequestsBatch(',
      'pruneEmailChangeRequestsBatch(',
      'pruneEmailLogBatch(',
      'prunePlayerReportsBatch(',
      'pruneBugReportsBatch(',
      'pruneChatViolationsBatch(',
      'pruneLevelUpEventsBatch(',
      'pruneFtueEventsBatch(',
      'pruneWocBuyNowAbandonsBatch(',
      'pruneResolvedWocOffersBatch(',
      'pruneBookedWocCustodyClaimsBatch(',
      'pruneExpiredWocStepUpChallengesBatch(',
      'pruneMailCustodyParcelsBatch(',
      'pruneClosedWocListingsBatch(',
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
      'pruneUnstuckReportsBatch(',
      'foldOnlinePeak(',
      'distinctOnlineSampleRealms(',
      'dailyRewardEventsCutoffDay(',
      // password_reset_requests / email_change_requests / email_log used to be
      // absent from this table list entirely: each completed reset or email
      // change left a permanent row (the per-account supersede DELETE in db.ts
      // only removes a duplicate PENDING row, never a consumed one), and every
      // outbound email attempt logged forever. These three close that gap.
      'prunePasswordResetRequestsBatch(',
      'pruneEmailChangeRequestsBatch(',
      'pruneEmailLogBatch(',
      // player_reports / bug_reports / chat_violations used to be absent from
      // this table list entirely: moderation reports piled up with no bound
      // (a closed report is never re-read but was never deleted either), bug
      // reports could each carry a ~900 KB screenshot, and the hard-word
      // incident log grew forever even though its only reader is already
      // LIMIT-bounded. These three close that gap.
      'prunePlayerReportsBatch(',
      'pruneBugReportsBatch(',
      'pruneChatViolationsBatch(',
      // The UA progression event logs (level_up_events / ftue_events) grow
      // per event; each registers its bounded prune with the sweep.
      'pruneLevelUpEventsBatch(',
      'pruneFtueEventsBatch(',
      // The $WOC Exchange retention set; exactly-once is what catches the
      // splice-duplication hazard the listings entry's own comment records.
      // Custody claims prune BOOKED rows only (unbooked rows are the operator
      // queue) and the step-up drain exists for realms that stopped issuing.
      'pruneWocBuyNowAbandonsBatch(',
      'pruneResolvedWocOffersBatch(',
      'pruneBookedWocCustodyClaimsBatch(',
      'pruneExpiredWocStepUpChallengesBatch(',
      'pruneMailCustodyParcelsBatch(',
      'pruneClosedWocListingsBatch(',
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
    expect(MAIN).toContain('pruneUnstuckReportsBatch(pool, config.unstuckReportRetentionDays, n)');
    expect(MAIN).toContain(
      'prunePasswordResetRequestsBatch(config.passwordResetRequestRetentionDays, n)',
    );
    expect(MAIN).toContain(
      'pruneEmailChangeRequestsBatch(config.emailChangeRequestRetentionDays, n)',
    );
    expect(MAIN).toContain('pruneEmailLogBatch(config.emailLogRetentionDays, n)');
    expect(MAIN).toContain('prunePlayerReportsBatch(config.playerReportRetentionDays, n)');
    expect(MAIN).toContain('pruneBugReportsBatch(config.bugReportRetentionDays, n)');
    expect(MAIN).toContain('pruneChatViolationsBatch(config.chatViolationRetentionDays, n)');
    expect(MAIN).toContain(
      'pruneWocBuyNowAbandonsBatch(pool, config.wocMarketAbandonsRetentionDays, n)',
    );
    expect(MAIN).toContain(
      'pruneResolvedWocOffersBatch(pool, config.wocMarketOffersRetentionDays, n)',
    );
    expect(MAIN).toContain(
      'pruneBookedWocCustodyClaimsBatch(pool, config.wocMarketCustodyClaimsRetentionDays, n)',
    );
    // Deliberately knobless: expired step-up nonces are garbage, not history,
    // so the drain takes no retention-days argument to misthread.
    expect(MAIN).toContain('pruneExpiredWocStepUpChallengesBatch(pool, n)');
    // The custody-mail overlay residue prune is knobless too (constant
    // 30-day window inside the module, no retention-days argument).
    expect(MAIN).toContain('pruneMailCustodyParcelsBatch(n)');
    // The custody-claims window relation check must actually be WIRED (the
    // helper is unit-tested in the market SQL floor; this catches dead code),
    // with both knobs threaded in the documented order (whitespace-collapsed
    // so a formatter reflow cannot red it).
    const flat = MAIN.replace(/\s+/g, ' ');
    expect(flat).toContain(
      'wocCustodyClaimsRetentionWarning( config.wocMarketCustodyClaimsRetentionDays, config.wocMarketListingsRetentionDays, )',
    );
    // And the answer must reach an operator, not be computed and dropped.
    expect(flat).toContain('if (claimsRetentionWarn !== null) console.warn(claimsRetentionWarn)');
    expect(MAIN).toContain(
      'pruneClosedWocListingsBatch(pool, config.wocMarketListingsRetentionDays, n)',
    );
  });

  it('keeps the woc listings prune LAST in the table array', () => {
    // The tail is the one position a rebase auto-merge cannot splice a new
    // entry into the preceding object (it has happened twice; the comment at
    // the entry records it). Order also carries semantics: abandons cascades
    // and directed offers SET NULL on listing_id, so sweeping listings first
    // would forge "this offer never became a listing". The old pin only
    // compared two indexOf positions, so a new entry appended AFTER listings
    // (the natural landing spot for a merge) stayed green; this one scrapes
    // the real array and pins the whole order plus the tail.
    const start = MAIN.indexOf('tables: [');
    expect(start).toBeGreaterThan(-1);
    const block = MAIN.slice(start, MAIN.indexOf('onlineSamples:', start));
    const names = [...block.matchAll(/name: '([a-z_]+)'/g)].map((m) => m[1]);
    expect(names).toEqual([
      'chat_logs',
      'client_perf_reports',
      'daily_reward_events',
      'player_activity_daily',
      'admin_site_presence_samples',
      'site_presence_sessions',
      'play_sessions',
      'account_ip_associations',
      'unstuck_reports',
      'password_reset_requests',
      'email_change_requests',
      'email_log',
      'player_reports',
      'bug_reports',
      'chat_violations',
      'level_up_events',
      'ftue_events',
      'woc_market_buy_now_abandons',
      'woc_market_directed_offers',
      'woc_market_custody_claims',
      'woc_market_stepup_challenges',
      'mail_custody_parcels',
      'woc_market_listings',
    ]);
    expect(new Set(names).size).toBe(names.length);
    expect(names.at(-1)).toBe('woc_market_listings');
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

  it('neither storage receipts nor bank_ledger are placed on the retention sweep', () => {
    // Refusals now delete synchronously, while successful receipts and the
    // audit ledger are durable exactly-once evidence. Neither has a sweep arm.
    const listStart = MAIN.indexOf('saveLastSweepDay:');
    expect(listStart).toBeGreaterThan(-1);
    expect(MAIN).not.toContain('pruneRefusedStoragePurchasesBatch');
    expect(MAIN).not.toContain('storagePurchaseRetentionDays');
    expect(MAIN).not.toContain('pruneBankLedger');
    expect(MAIN).not.toContain('DELETE FROM bank_ledger');
    // And the reason survives next to the list, so the asymmetry reads as a
    // decision rather than an omission.
    expect(MAIN_RAW).toContain('bank_ledger is deliberately ABSENT from this table list');
  });

  it('the login recovery kick is armed BEFORE the socket can deliver a command', () => {
    // server/ws_auth.ts arms the provisional gold-rail hold synchronously on a
    // fresh join, and the whole point is that it happens before the message
    // handler exists: a gold rung buy arriving first would race the
    // pending-row scan after a restart. This pin is STRUCTURAL and that is all
    // it is: it compares the index of two literals in a file it never loads, so
    // it catches deletion and a straight relocation and nothing else. The
    // EXECUTED covenant, which catches a deferred, conditional or arm-scoped
    // kick, lives in tests/server/ws_auth_login_covenant.test.ts (ws_auth IS
    // importable, unlike main.ts; an earlier version of this comment said
    // otherwise and that is why the behaviour went undriven for nineteen
    // phases). Both are kept: this one is free and guards the call site's
    // existence next to the rest of the retention wiring.
    // Comment-stripped, like MAIN above: read RAW, a commented-out
    // `// kickStoragePurchaseRecovery(session.characterId);` sitting anywhere
    // above the handler satisfied both halves of this pin while the real call
    // was gone.
    const WS_AUTH = stripComments(
      readFileSync(join(__dirname, '..', '..', 'server', 'ws_auth.ts'), 'utf8'),
    );
    const kick = WS_AUTH.indexOf('kickStoragePurchaseRecovery(session.characterId)');
    expect(kick).toBeGreaterThan(-1);
    const handler = WS_AUTH.indexOf("ws.on('message'", kick - 4000 > 0 ? kick - 4000 : 0);
    expect(handler).toBeGreaterThan(-1);
    expect(kick).toBeLessThan(handler);
  });

  it('the storage purchase host resolves sessions through the live-character resolver module', () => {
    // The quarantined-counts-as-absent predicate and the ambiguity rule moved
    // to server/live_character_resolver.ts, where they are behaviorally
    // unit-tested (tests/server/live_character_resolver.test.ts). main.ts's
    // remaining job, pinned here because main.ts boots a server on import, is
    // to wire the IMPORTED module functions against the live session table,
    // exactly once each, and to keep the save flags the flow depends on.
    expect(MAIN).toContain(
      'resolveLiveCharacter: (accountId) => resolveLiveCharacterFrom(game.clients.values(), accountId)',
    );
    expect(count(MAIN, 'resolveLiveCharacterFrom(')).toBe(1);

    const saveAt = MAIN.indexOf('saveCharacter: (characterId, shouldStart, signal) => {');
    expect(saveAt).toBeGreaterThan(-1);
    const saveEnd = MAIN.indexOf('\n    },', saveAt);
    expect(saveEnd).toBeGreaterThan(saveAt);
    const saveBody = MAIN.slice(saveAt, saveEnd);
    expect(saveBody).toContain('findLiveSessionForCharacter(game.clients.values(), characterId)');
    expect(saveBody).toContain(
      'game.saveCharacter(session, { shouldStart, signal, backgroundDbPermit: true })',
    );
    expect(count(MAIN, 'findLiveSessionForCharacter(')).toBe(1);
    expect(count(MAIN, 'saveCharacter: (characterId, shouldStart, signal) => {')).toBe(1);
  });

  it('the storage purchase host stages the atomic save effect on the live game', () => {
    // The database helper owns receipt + Claudium ledger insertion now. Main's
    // security-critical job is to stage that immutable payload synchronously
    // on the exact live GameServer before the coordinator requests its save.
    const factory = MAIN.indexOf('function storagePurchaseHost()');
    expect(factory).toBeGreaterThan(-1);
    // End-anchored to the factory's own registration call, never a fixed
    // character window (a window overruns into the sibling closures below,
    // exactly what the resolver pin above rejects).
    const factoryEnd = MAIN.indexOf(
      'configureStoragePurchaseRuntime(storagePurchaseHost)',
      factory,
    );
    expect(factoryEnd).toBeGreaterThan(factory);
    const body = MAIN.slice(factory, factoryEnd);
    expect(body).toContain(
      'stageAppliedEffect: (effect) => game.stageStorageAppliedEffect(effect)',
    );
    expect(count(MAIN, 'stageAppliedEffect:')).toBe(1);
  });

  it('shares one major-background database gate across game, market, storage, and metrics', () => {
    // Independent subsystem tests can each pass with independent gates while
    // their combined production concurrency exceeds the pool headroom. Pin the
    // composition root: one instance, threaded into every major producer and
    // the readout that operators use to judge its aggregate pressure.
    expect(count(MAIN, 'createBackgroundDbGate(')).toBe(1);
    expect(MAIN).toContain(
      'const majorBackgroundDbGate = createBackgroundDbGate(DB_POOL_MAX_CLIENTS)',
    );
    expect(MAIN).toContain('new GameServer(undefined, majorBackgroundDbGate)');
    expect(MAIN).toContain(
      'acquireBackgroundPermit: (signal) => majorBackgroundDbGate.acquire(signal)',
    );
    expect(MAIN).toContain('tryAcquireBackgroundPermit: () => majorBackgroundDbGate.tryAcquire()');
    expect(MAIN).toContain('backgroundDbGate: () => majorBackgroundDbGate.stats()');
    // Paid guild creation composes under the SAME gate: game.ts builds the
    // deps, so the composition root registers the acquirer, exactly once.
    expect(count(MAIN, 'configurePaidGuildCreateBackgroundGate(')).toBe(1);
    expect(MAIN).toContain(
      'configurePaidGuildCreateBackgroundGate((signal) => majorBackgroundDbGate.acquire(signal))',
    );

    // The escrow enqueue closure: a BOUNDED permit wait (the unbounded form
    // pinned the character FIFO slot and an escrow-gate hold until the 400s
    // leak reclaim), and the job NEVER runs on a null permit (the refusal
    // throw precedes job()).
    expect(MAIN).toContain('const WOC_ESCROW_BACKGROUND_PERMIT_WAIT_MS = 15_000');
    const custodyStart = MAIN.indexOf('enqueueCharacterWrite: (characterId, job) =>');
    const custodyEnd = MAIN.indexOf('serializeCharacterForPersist:', custodyStart);
    const custody = MAIN.slice(custodyStart, custodyEnd);
    expect(custodyStart).toBeGreaterThan(-1);
    expect(custodyEnd).toBeGreaterThan(custodyStart);
    // Whitespace-tolerant (the guild_create pin shape): an indentation-only
    // reformat must not break the wiring pin.
    expect(custody).toMatch(
      /majorBackgroundDbGate\.acquire\(\s*AbortSignal\.timeout\(WOC_ESCROW_BACKGROUND_PERMIT_WAIT_MS\),?\s*\)/,
    );
    expect(custody.indexOf('enqueueCharacterWrite(characterId, async () => {')).toBeLessThan(
      custody.indexOf('majorBackgroundDbGate.acquire('),
    );
    expect(custody.indexOf('majorBackgroundDbGate.acquire(')).toBeLessThan(
      custody.indexOf('job()'),
    );
    const refusal = custody.indexOf(
      "throw new Error('woc escrow refused: no background database permit')",
    );
    expect(refusal).toBeGreaterThan(-1);
    expect(custody.indexOf('if (!permit)')).toBeGreaterThan(-1);
    expect(custody.indexOf('if (!permit)')).toBeLessThan(custody.indexOf('job()'));
    expect(refusal).toBeLessThan(custody.indexOf('job()'));
  });

  it('stops admitting storage recovery before the database pool closes', () => {
    const shutdown = MAIN.indexOf('const shutdown = async () => {');
    const stopRecovery = MAIN.indexOf('await stopStoragePurchaseRecovery();', shutdown);
    const closePool = MAIN.indexOf('await pool.end();', shutdown);
    expect(shutdown).toBeGreaterThan(-1);
    expect(stopRecovery).toBeGreaterThan(shutdown);
    expect(stopRecovery).toBeLessThan(closePool);
    expect(count(MAIN, 'await stopStoragePurchaseRecovery();')).toBe(1);
  });

  it('starts the ledger-growth monitor after listen and drains it before pool close', () => {
    const listen = MAIN.indexOf('server.listen(');
    const start = MAIN.indexOf('bankLedgerGrowthMonitor.start()');
    const shutdown = MAIN.indexOf('const shutdown = async () => {');
    const stop = MAIN.indexOf('await bankLedgerGrowthMonitor.stop();', shutdown);
    const closePool = MAIN.indexOf('await pool.end();', shutdown);
    expect(listen).toBeGreaterThan(-1);
    expect(start).toBeGreaterThan(listen);
    expect(stop).toBeGreaterThan(shutdown);
    expect(stop).toBeLessThan(closePool);
    expect(count(MAIN, 'bankLedgerGrowthMonitor.start()')).toBe(1);
    expect(count(MAIN, 'await bankLedgerGrowthMonitor.stop();')).toBe(1);
  });
});
