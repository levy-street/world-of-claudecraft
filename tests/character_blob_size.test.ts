// The character-blob size signal (server/character_blob_size.ts plus its one
// call site, characterUpdateStatement in server/db.ts).
//
// Three things are under test and they are deliberately different in kind. The
// pure helper is pinned on its own, including the threshold LITERAL: asserting
// the constant against itself would pass for any value, so the number 229_376 is
// written out here and a re-mint has to be a reviewed edit in two files. The
// call site is then exercised through the REAL saveCharacterState with a mocked
// pool, because the load-bearing claim is not "a warning is produced" but "an
// oversized character is still written, whole": the difference between this
// signal and the guild-bank hard bound it is modelled on. A source-text pin
// could not tell those apart. Finally, EVERY member of the save family is driven
// through the same oversized state, because the signal is only worth having if
// no write path can quietly skip it: it lives in the shared statement builder
// precisely so the autosave, the market/mail escrow flush and the guild bank
// escrow flush all inherit it rather than each needing to remember.
//
// NOT database-gated: pg is mocked, so this runs in the ordinary CI pipeline
// rather than only where TEST_DATABASE_URL is set.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// db.ts builds a pg Pool and requires DATABASE_URL at import time; stub both so
// the module loads and every statement lands on a spy (the character_db.test.ts
// idiom).
const dbMock = vi.hoisted(() => ({
  query: vi.fn(),
  connect: vi.fn(),
}));
vi.hoisted(() => {
  process.env.DATABASE_URL = 'postgres://test/test';
});
vi.mock('pg', () => ({
  Pool: function Pool() {
    return { query: dbMock.query, connect: dbMock.connect };
  },
}));

import {
  CHARACTER_BLOB_P99_WINDOW,
  CHARACTER_BLOB_WARN_BYTES,
  CHARACTER_BLOB_WARN_QUEUE_MAX,
  CHARACTER_BLOB_WARN_WINDOW_MS,
  characterBlobBytesHighWater,
  characterBlobBytesP99,
  characterBlobSizeWarning,
  createCharacterBlobSizeReporter,
  createWindowedPercentile,
  flushQueuedCharacterBlobWarnings,
  queueCharacterBlobWarning,
  queuedCharacterBlobWarningCount,
  recordCharacterBlobBytes,
} from '../server/character_blob_size';
import {
  openMarketWriteGate,
  saveCharacterAndGuildBankState,
  saveCharacterAndMarketState,
  saveCharacterState,
  saveCharacterStateOnClient,
} from '../server/db';
import { type CharacterState, type MailSave, type MarketSave, Sim } from '../src/sim/sim';

// A REAL serialized character, not a hand-built stub: the "an ordinary save is
// silent" claim is only worth anything if the thing measured is what the save
// path actually persists.
function realCharacterState(): CharacterState {
  const sim = new Sim({ seed: 7, playerClass: 'warrior', autoEquip: true });
  const state = sim.serializeCharacter(sim.playerId);
  if (!state) throw new Error('serializeCharacter returned null for the primary player');
  return state;
}

// Push a real state past the threshold through a field the save path passes
// through untouched (sanitizeRemovedZone1Content filters questsDone only against
// the removed-zone1 quest set, so unique synthetic ids survive). Padding a real
// state rather than fabricating a blob keeps the oversized case structurally
// valid, so the write path is exercised exactly as it would be in production.
function oversizedCharacterState(): CharacterState {
  const state = realCharacterState();
  const questsDone = [...state.questsDone];
  for (let i = questsDone.length; questsDone.length < 4000; i++) {
    questsDone.push(`synthetic_blob_padding_quest_${i}_${'x'.repeat(40)}`);
  }
  return { ...state, questsDone };
}

// A checked-out client that answers every statement, matching what
// runWithStatementTimeout drives (BEGIN, SET LOCAL, the UPDATE, COMMIT).
// The release/v0.41.0 save path wraps the client in DbTransactionDeadline,
// which attaches and detaches an 'error' listener, so the fake carries the
// EventEmitter pair too (no-ops: these tests never surface a client error).
function transactionClient() {
  const client = { query: vi.fn(), release: vi.fn(), on: vi.fn(), removeListener: vi.fn() };
  client.query.mockResolvedValue({ rows: [], rowCount: 1 } as never);
  return client;
}

function characterUpdateCall(client: ReturnType<typeof transactionClient>) {
  return client.query.mock.calls.find(
    (call) => typeof call[0] === 'string' && call[0].includes('UPDATE characters'),
  );
}

describe('characterBlobSizeWarning: the pure decision', () => {
  it('pins the warn threshold to its literal value', () => {
    // The number itself, not the constant compared against itself. 229,376 is
    // 224 KiB, the smallest 32-KiB step above the measured storage-rich fixture
    // (209,261 bytes, frozen by the professions_blob_growth whole-character arm)
    // and one 32-KiB step below the 262,144-byte guild-bank row scale. The
    // database review approved this re-mint from 163,840 after measuring legal
    // Crucible payloads through serialize/load. Moving it means re-measuring.
    expect(CHARACTER_BLOB_WARN_BYTES).toBe(229_376);
  });

  it('stays silent below the threshold and AT it (the bound is inclusive)', () => {
    expect(characterBlobSizeWarning(1, 0)).toBeNull();
    expect(characterBlobSizeWarning(1, 38_900)).toBeNull();
    expect(characterBlobSizeWarning(1, 209_261)).toBeNull();
    expect(characterBlobSizeWarning(1, 229_375)).toBeNull();
    expect(characterBlobSizeWarning(1, 229_376)).toBeNull();
  });

  it('warns one byte past the threshold and above', () => {
    expect(characterBlobSizeWarning(1, 229_377)).not.toBeNull();
    expect(characterBlobSizeWarning(1, 1_000_000)).not.toBeNull();
  });

  it('names the character and the measured size, so the line is actionable', () => {
    const warning = characterBlobSizeWarning(4291, 300_000);
    expect(warning).toContain('4291');
    expect(warning).toContain('300000');
    expect(warning).toContain('229376-byte');
  });

  it('leaves a real freshly serialized character far under the threshold', () => {
    // The evidence side of the derivation: if authored content ever pushes an
    // ORDINARY character near this bound, the threshold is wrong and this fails
    // before an operator ever sees a spurious line.
    const bytes = Buffer.byteLength(JSON.stringify(realCharacterState()), 'utf8');
    expect(bytes).toBeLessThan(CHARACTER_BLOB_WARN_BYTES / 4);
    expect(characterBlobSizeWarning(1, bytes)).toBeNull();
  });
});

describe('saveCharacterState: the size signal never gates the write', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let saveWindowMs = 1_800_000_000_000;

  beforeEach(() => {
    dbMock.query.mockReset();
    dbMock.connect.mockReset();
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // Own dampener window per case, same reasoning as the save-family block
    // below: the reporter is process-wide, so a shared window would let one
    // case silence the next.
    saveWindowMs += CHARACTER_BLOB_WARN_WINDOW_MS * 10;
    vi.spyOn(Date, 'now').mockReturnValue(saveWindowMs);
  });

  // Restore between cases: spying an ALREADY-spied console.warn hands back the
  // same mock, so without this the call log accumulates across tests and a
  // toHaveBeenCalledTimes(1) silently starts counting a previous case's line.
  afterEach(async () => {
    // Drain this test's deferred warn immediates into ITS spy before the
    // restore, so no oversized save leaks a warn into the next case.
    await new Promise((resolve) => setImmediate(resolve));
    vi.restoreAllMocks();
  });

  it('persists an ordinary character with no warning', async () => {
    const client = transactionClient();
    dbMock.connect.mockResolvedValue(client as never);

    const ok = await saveCharacterState(101, 12, realCharacterState());

    expect(ok).toBe(true);
    expect(characterUpdateCall(client)).toBeDefined();
    // Flush the deferral so this negative cannot pass on an unflushed warn.
    await new Promise((resolve) => setImmediate(resolve));
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('WARNS about an oversized character and writes it anyway, whole', async () => {
    const client = transactionClient();
    dbMock.connect.mockResolvedValue(client as never);
    const state = oversizedCharacterState();

    const ok = await saveCharacterState(102, 60, state);

    // The signal fired (deferred off the builder call via setImmediate so a
    // blocking stdout cannot lengthen a lock hold; flush it before asserting).
    await new Promise((resolve) => setImmediate(resolve));
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(String(warnSpy.mock.calls[0][0])).toContain('102');
    // ...and the write still happened and still reported success. This is the
    // whole difference from the guild-bank bound, which refuses the write.
    expect(ok).toBe(true);
    const call = characterUpdateCall(client);
    if (!call) throw new Error('the oversized save issued no UPDATE characters statement');
    // Not truncated, not replaced with a placeholder: the persisted third
    // parameter is the full serialization of the state handed in. Parsing it
    // back proves the bytes are intact rather than merely long.
    const persisted = (call[1] as unknown[])[2] as string;
    expect(Buffer.byteLength(persisted, 'utf8')).toBeGreaterThan(CHARACTER_BLOB_WARN_BYTES);
    expect((JSON.parse(persisted) as CharacterState).questsDone).toEqual(state.questsDone);
  });

  it('reports the lease-fenced refusal for size-independent reasons only', async () => {
    // A fenced UPDATE that matches no lease row returns false. Proving an
    // OVERSIZED save still returns false only for that reason (rowCount 0), and
    // true when the fence matches, pins that size never enters the return value.
    const displaced = transactionClient();
    displaced.query.mockResolvedValue({ rows: [], rowCount: 0 } as never);
    dbMock.connect.mockResolvedValue(displaced as never);
    expect(await saveCharacterState(103, 60, oversizedCharacterState(), 'nonce-a')).toBe(false);

    const held = transactionClient();
    dbMock.connect.mockResolvedValue(held as never);
    expect(await saveCharacterState(104, 60, oversizedCharacterState(), 'nonce-b')).toBe(true);
  });

  it('takes the characters row lock BEFORE the fenced UPDATE (qr-19-live-nonce-fence-write-loss)', async () => {
    // D145: the four live save paths run their fenced UPDATE through
    // runFencedCharacterUpdate, which issues the FOR NO KEY UPDATE row lock FIRST.
    // If the lock came after (or not at all) the fence's InitPlan is decided before
    // the row is held and a mid-wait lease displacement is invisible (the write
    // loss the offline twin red-proved against real Postgres). Position AND text,
    // so a mutant that drops the lock or moves it after the UPDATE reds.
    const client = transactionClient();
    dbMock.connect.mockResolvedValue(client as never);
    await saveCharacterState(105, 12, realCharacterState(), 'session-a');
    const statements = client.query.mock.calls.map((call) => String(call[0]));
    const lockIdx = statements.findIndex(
      (s) => s.includes('FROM characters') && s.includes('FOR NO KEY UPDATE'),
    );
    const updateIdx = statements.findIndex((s) => s.includes('UPDATE characters SET'));
    expect(lockIdx).toBeGreaterThanOrEqual(0);
    expect(updateIdx).toBeGreaterThanOrEqual(0);
    expect(lockIdx).toBeLessThan(updateIdx);
  });

  it('a no-nonce (none) save SKIPS the row lock (the D145 conditional)', async () => {
    // runFencedCharacterUpdate takes the lock only for a fenced (nonce) save; an
    // unfenced 'none' write has no uncorrelated subquery and no race, so it must
    // not pay the extra round trip. A revert to lock-always would red here (the
    // behavior 0e7ffa296d introduced was otherwise unpinned).
    const client = transactionClient();
    dbMock.connect.mockResolvedValue(client as never);
    await saveCharacterState(106, 12, realCharacterState()); // no leaseNonce -> 'none'
    const statements = client.query.mock.calls.map((call) => String(call[0]));
    expect(statements.some((s) => s.includes('FOR NO KEY UPDATE'))).toBe(false);
    expect(statements.some((s) => s.includes('UPDATE characters SET'))).toBe(true);
  });
});

// The whole point of measuring inside characterUpdateStatement rather than
// inside saveCharacterState: the character blob reaches the database through
// THREE functions, and the escrow flushes are exactly the ones a big-state
// player is most likely to hit (they run at logout). A signal on the autosave
// alone would go quiet on the paths that matter at the worst moment, so each
// member is driven here individually. One arm per SAVER, never a single joint
// case: a signal wired into two of the three would still pass a test that only
// proved "some path warns".
const MARKET = { listings: [], collections: {} } as unknown as MarketSave;
// The release's incremental mail write (#3561) narrowed the saver's fifth
// parameter from a whole MailSave to only the recipient mailboxes dirtied since
// the last save. Empty is the right fixture here: this suite is about the blob
// SIZE signal on the character half, and an empty partition list issues no mail
// SQL at all, so nothing else can be what warns.
const MAIL: readonly { recipientKey: string; letters: MailSave['mail'] }[] = [];

describe('every character write path inherits the signal (the shared chokepoint)', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let windowStartMs = 1_900_000_000_000;

  beforeEach(() => {
    dbMock.query.mockReset();
    dbMock.connect.mockReset();
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // Every case gets its OWN dampener window. reportCharacterBlobSize is one
    // process-wide instance by design (a fleet-wide crossing should print once a
    // minute, not once per save path), so without this the second and third
    // cases below would be legitimately suppressed by the first and their
    // assertions would be measuring the dampener rather than the path. Pushing
    // the clock a window forward per case is what keeps each arm decisive; it
    // also means these cases can never depend on their own ordering.
    windowStartMs += CHARACTER_BLOB_WARN_WINDOW_MS * 10;
    vi.spyOn(Date, 'now').mockReturnValue(windowStartMs);
    // saveCharacterAndMarketState refuses to run before the boot backfill has
    // opened the market write gate; opening it here is what makes that arm
    // reachable at all rather than throwing before it ever measures anything.
    openMarketWriteGate();
  });

  afterEach(async () => {
    // Drain this test's deferred warn immediates into ITS spy before the
    // restore, so no oversized save leaks a warn into the next case.
    await new Promise((resolve) => setImmediate(resolve));
    vi.restoreAllMocks();
  });

  it('warns on the market/mail escrow flush and still commits', async () => {
    const client = transactionClient();
    dbMock.connect.mockResolvedValue(client as never);

    const ok = await saveCharacterAndMarketState(201, 60, oversizedCharacterState(), MARKET, MAIL);

    expect(ok).toBe(true);
    // The warn is setImmediate-deferred; flush before asserting.
    await new Promise((resolve) => setImmediate(resolve));
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(String(warnSpy.mock.calls[0][0])).toContain('201');
    expect(characterUpdateCall(client)).toBeDefined();
    // Committed, not rolled back: the size never aborts an escrow transaction,
    // which would strand items between bags and the market book.
    const statements = client.query.mock.calls.map((call) => String(call[0]));
    expect(statements).toContain('COMMIT');
    expect(statements).not.toContain('ROLLBACK');
  });

  it('warns on the guild bank escrow flush and still commits', async () => {
    const client = transactionClient();
    dbMock.connect.mockResolvedValue(client as never);

    const ok = await saveCharacterAndGuildBankState(202, 60, oversizedCharacterState(), []);

    expect(ok).toBe(true);
    // The warn is setImmediate-deferred; flush before asserting.
    await new Promise((resolve) => setImmediate(resolve));
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(String(warnSpy.mock.calls[0][0])).toContain('202');
    expect(characterUpdateCall(client)).toBeDefined();
    const statements = client.query.mock.calls.map((call) => String(call[0]));
    expect(statements).toContain('COMMIT');
    expect(statements).not.toContain('ROLLBACK');
  });

  it('saveCharacterAndMarketState takes the row lock before the fenced UPDATE (D145)', async () => {
    // The other three live save paths run the fenced UPDATE through the same
    // runFencedCharacterUpdate, so pin the lock-before-update ordering on each
    // (a bare transaction.query on any one reinstates the write-loss race).
    const client = transactionClient();
    dbMock.connect.mockResolvedValue(client as never);
    await saveCharacterAndMarketState(203, 60, realCharacterState(), MARKET, MAIL, 'session-a');
    const statements = client.query.mock.calls.map((call) => String(call[0]));
    const lockIdx = statements.findIndex(
      (s) => s.includes('FROM characters') && s.includes('FOR NO KEY UPDATE'),
    );
    const updateIdx = statements.findIndex((s) => s.includes('UPDATE characters SET'));
    expect(lockIdx).toBeGreaterThanOrEqual(0);
    expect(lockIdx).toBeLessThan(updateIdx);
  });

  it('saveCharacterStateOnClient is EXCLUDED from the D145 row lock (escrow occupancy invariant)', async () => {
    // This arm's callers are the marketplace escrow and paid guild creation;
    // adding the D145 row lock there would push their base workload past the
    // autosave-period occupancy ceiling the tunables ladder pins
    // (baseWorkloadCeilingMs < autosaveMs). So it keeps its pre-D145 shape: the
    // fenced UPDATE with no separate row-lock SELECT. The three DIRECT live paths
    // do take the lock (pinned above and in guild_bank_db.test.ts).
    const client = transactionClient();
    await saveCharacterStateOnClient(client as never, 204, 60, realCharacterState(), 'session-a');
    const statements = client.query.mock.calls.map((call) => String(call[0]));
    expect(statements.some((s) => s.includes('FOR NO KEY UPDATE'))).toBe(false);
    expect(statements.some((s) => s.includes('UPDATE characters SET'))).toBe(true);
  });

  it('stays silent on all three paths for an ordinary character', async () => {
    // The negative arm per saver, so none of the three can be passing above for
    // the wrong reason (a warning that fires unconditionally would look
    // identical in the positive cases).
    const ordinary = realCharacterState();

    dbMock.connect.mockResolvedValue(transactionClient() as never);
    await saveCharacterState(203, 12, ordinary);
    dbMock.connect.mockResolvedValue(transactionClient() as never);
    await saveCharacterAndMarketState(204, 12, ordinary, MARKET, MAIL);
    dbMock.connect.mockResolvedValue(transactionClient() as never);
    await saveCharacterAndGuildBankState(205, 12, ordinary, []);

    // Flush the deferral so this negative cannot pass on an unflushed warn.
    await new Promise((resolve) => setImmediate(resolve));
    expect(warnSpy).not.toHaveBeenCalled();
  });
});

// The dampener, driven through an ISOLATED reporter with injected timestamps.
// createCharacterBlobSizeReporter exists precisely so these cases neither share
// state with the process-wide instance the save path uses nor need a test-only
// reset export, and so the window is exercised by passing times rather than by
// faking global time.
const OVER = CHARACTER_BLOB_WARN_BYTES + 1;
const UNDER = CHARACTER_BLOB_WARN_BYTES;

describe('createCharacterBlobSizeReporter: one line per window, nothing lost silently', () => {
  it('fires, suppresses inside the window, then fires again after it with the count', () => {
    const report = createCharacterBlobSizeReporter();
    const t0 = 5_000_000;

    // First crossing speaks.
    const first = report(1, OVER, t0);
    expect(first).not.toBeNull();
    expect(first).not.toContain('suppressed');

    // Everything inside the window is swallowed, including the instant the
    // window ends (the bound is exclusive: strictly less than one window).
    expect(report(2, OVER, t0 + 1)).toBeNull();
    expect(report(3, OVER, t0 + CHARACTER_BLOB_WARN_WINDOW_MS - 1)).toBeNull();

    // Past the window it speaks again AND reports what it swallowed, so the log
    // never quietly loses the fact that there were more.
    const next = report(4, OVER, t0 + CHARACTER_BLOB_WARN_WINDOW_MS);
    expect(next).not.toBeNull();
    expect(next).toContain('2 further oversized saves suppressed');
    expect(next).toContain('4'); // still names the character that got the line

    // The counter RESETS with the line that reported it: the next window's line
    // must not re-report the same two.
    const third = report(5, OVER, t0 + CHARACTER_BLOB_WARN_WINDOW_MS * 2);
    expect(third).not.toBeNull();
    expect(third).not.toContain('suppressed');
  });

  it('singularizes a lone suppressed save', () => {
    const report = createCharacterBlobSizeReporter();
    expect(report(1, OVER, 0)).not.toBeNull();
    expect(report(2, OVER, 1)).toBeNull();
    expect(report(3, OVER, CHARACTER_BLOB_WARN_WINDOW_MS)).toContain(
      '1 further oversized save suppressed',
    );
  });

  it('never counts an UNDER-threshold save as suppressed', () => {
    // The dampener must not turn ordinary saves into a phantom backlog: a
    // healthy realm saving constantly between two crossings would otherwise
    // report thousands "suppressed" that were never warnings at all.
    const report = createCharacterBlobSizeReporter();
    expect(report(1, OVER, 0)).not.toBeNull();
    for (let i = 0; i < 50; i++) expect(report(2, UNDER, 10 + i)).toBeNull();
    const next = report(3, OVER, CHARACTER_BLOB_WARN_WINDOW_MS);
    expect(next).not.toBeNull();
    expect(next).not.toContain('suppressed');
  });

  it('gives each instance its own window (no cross-talk between reporters)', () => {
    const a = createCharacterBlobSizeReporter();
    const b = createCharacterBlobSizeReporter();
    expect(a(1, OVER, 0)).not.toBeNull();
    // b has its own memory, so a's line does not silence it at the same instant.
    expect(b(1, OVER, 0)).not.toBeNull();
  });

  it('tracks a monotonic high-water mark for the scrape gauge', () => {
    // The gauge half (the Phase 17 database review): process-lifetime max,
    // never decaying, so a climbing gauge means a bigger blob than any before
    // it saved here. Monotonic within this process: assert relative movement
    // rather than absolute values so suite order cannot matter.
    const before = characterBlobBytesHighWater();
    recordCharacterBlobBytes(before + 100);
    expect(characterBlobBytesHighWater()).toBe(before + 100);
    // A smaller measurement never lowers it.
    recordCharacterBlobBytes(1);
    expect(characterBlobBytesHighWater()).toBe(before + 100);
    // A larger one raises it.
    recordCharacterBlobBytes(before + 250);
    expect(characterBlobBytesHighWater()).toBe(before + 250);
  });
});

describe('createWindowedPercentile: the p99 gauge core', () => {
  it('reads 0 while empty and the lone sample at any percentile with one', () => {
    const w = createWindowedPercentile(8);
    expect(w.count()).toBe(0);
    expect(w.percentile(99)).toBe(0);
    w.record(1_900);
    expect(w.count()).toBe(1);
    expect(w.percentile(1)).toBe(1_900);
    expect(w.percentile(99)).toBe(1_900);
  });

  it('is nearest-rank over the retained samples (p100 the max, p50 the upper median)', () => {
    const w = createWindowedPercentile(16);
    for (const v of [50, 10, 40, 20, 30]) w.record(v);
    expect(w.percentile(100)).toBe(50);
    expect(w.percentile(50)).toBe(30); // ceil(0.5 * 5) = rank 3 of [10,20,30,40,50]
    expect(w.percentile(20)).toBe(10); // rank 1
    expect(w.percentile(21)).toBe(20); // rank 2
    expect(w.percentile(99)).toBe(50); // ceil(4.95) = rank 5
  });

  it('p99 over a full window is the second-largest sample once 1% of it is more than one', () => {
    // 200 samples: rank ceil(0.99 * 200) = 198 of 200, so the two largest sit
    // above the p99. One outlier alone cannot move it; that is the whole point
    // of the gauge beside the monotonic max.
    const w = createWindowedPercentile(200);
    for (let i = 1; i <= 199; i++) w.record(20_000);
    w.record(9_000_000);
    expect(w.percentile(99)).toBe(20_000);
    expect(w.percentile(100)).toBe(9_000_000);
  });

  it('evicts the oldest sample once full (a fixed ring, never a growing array)', () => {
    const w = createWindowedPercentile(3);
    w.record(1);
    w.record(2);
    w.record(3);
    expect(w.count()).toBe(3);
    w.record(100);
    // The window is now [2, 3, 100]: the 1 aged out.
    expect(w.count()).toBe(3);
    expect(w.percentile(1)).toBe(2);
    expect(w.percentile(100)).toBe(100);
  });

  it('refuses a non-positive or fractional capacity at wiring time', () => {
    expect(() => createWindowedPercentile(0)).toThrow('positive integer');
    expect(() => createWindowedPercentile(2.5)).toThrow('positive integer');
    expect(() => createWindowedPercentile(-1)).toThrow('positive integer');
  });

  it('the save path records into the module window: p99 climbs only when the bulk climbs', () => {
    expect(CHARACTER_BLOB_P99_WINDOW).toBe(1024);
    // Fill the shared window whole with a modest size so earlier suite
    // samples age out, then add ONE giant: the max moves, the p99 does not.
    for (let i = 0; i < CHARACTER_BLOB_P99_WINDOW; i++) recordCharacterBlobBytes(18_000);
    expect(characterBlobBytesP99()).toBe(18_000);
    recordCharacterBlobBytes(5_000_000);
    expect(characterBlobBytesP99()).toBe(18_000);
    expect(characterBlobBytesHighWater()).toBeGreaterThanOrEqual(5_000_000);
    // The bulk moving IS the signal: refill at a bigger size and the p99 follows.
    for (let i = 0; i < CHARACTER_BLOB_P99_WINDOW; i++) recordCharacterBlobBytes(26_000);
    expect(characterBlobBytesP99()).toBe(26_000);
  });
});

describe('the deferred warn-line queue (the setImmediate shutdown trade, closed)', () => {
  it('queues off the call stack and writes on the next immediate', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      queueCharacterBlobWarning('line A');
      queueCharacterBlobWarning('line B');
      // Nothing written synchronously: the whole point is keeping the write
      // off a row-lock hold.
      expect(warn).not.toHaveBeenCalled();
      expect(queuedCharacterBlobWarningCount()).toBe(2);
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(warn.mock.calls.map((c) => c[0])).toEqual(['line A', 'line B']);
      expect(queuedCharacterBlobWarningCount()).toBe(0);
    } finally {
      warn.mockRestore();
    }
  });

  it('a synchronous flush (the shutdown drain) writes queued lines now, and the immediate finds nothing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      queueCharacterBlobWarning('shutdown-path line');
      expect(warn).not.toHaveBeenCalled();
      flushQueuedCharacterBlobWarnings();
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledWith('shutdown-path line');
      await new Promise<void>((resolve) => setImmediate(resolve));
      // Exactly once: the deferred immediate must not print a second copy.
      expect(warn).toHaveBeenCalledTimes(1);
      expect(queuedCharacterBlobWarningCount()).toBe(0);
    } finally {
      warn.mockRestore();
    }
  });

  it('caps the queue and reports the drop count as a tail line', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const over = 5;
      for (let i = 0; i < CHARACTER_BLOB_WARN_QUEUE_MAX + over; i++) {
        queueCharacterBlobWarning(`line ${i}`);
      }
      // The queue itself never grows past the cap, whatever the burst.
      expect(queuedCharacterBlobWarningCount()).toBe(CHARACTER_BLOB_WARN_QUEUE_MAX);
      await new Promise<void>((resolve) => setImmediate(resolve));
      const written = warn.mock.calls.map((c) => String(c[0]));
      // The cap keeps the OLDEST lines (the first crossing is the informative
      // one) plus one tail naming what it refused.
      expect(written).toHaveLength(CHARACTER_BLOB_WARN_QUEUE_MAX + 1);
      expect(written[0]).toBe('line 0');
      expect(written[CHARACTER_BLOB_WARN_QUEUE_MAX - 1]).toBe(
        `line ${CHARACTER_BLOB_WARN_QUEUE_MAX - 1}`,
      );
      expect(written[CHARACTER_BLOB_WARN_QUEUE_MAX]).toContain(String(over));
      expect(written[CHARACTER_BLOB_WARN_QUEUE_MAX]).toContain('dropped');
      expect(queuedCharacterBlobWarningCount()).toBe(0);
      // The drop counter resets with the flush: a later single line prints
      // alone, with no stale tail.
      queueCharacterBlobWarning('after the drain');
      flushQueuedCharacterBlobWarnings();
      expect(warn.mock.calls.map((c) => String(c[0])).slice(-1)).toEqual(['after the drain']);
    } finally {
      warn.mockRestore();
      flushQueuedCharacterBlobWarnings();
    }
  });

  it('an empty flush is a no-op and a throwing sink (EPIPE at shutdown) is swallowed', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {
      throw new Error('EPIPE');
    });
    try {
      expect(() => flushQueuedCharacterBlobWarnings()).not.toThrow();
      queueCharacterBlobWarning('doomed line');
      expect(() => flushQueuedCharacterBlobWarnings()).not.toThrow();
      expect(queuedCharacterBlobWarningCount()).toBe(0);
      await new Promise<void>((resolve) => setImmediate(resolve));
    } finally {
      warn.mockRestore();
    }
  });
});
