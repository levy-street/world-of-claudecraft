// The suspicion-flag emitters + the Flagged-view cache (server/suspicion_flags.ts).
// The SQL module is mocked, so this suite drives the pure input builders, the
// per-account detector throttle, the fire-and-forget FIFO, and the cache's
// bust-on-write wiring without a pool.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SuspiciousPlayer } from '../server/bot_detector/contract';

const dbMock = vi.hoisted(() => ({
  upsertSuspicionFlag: vi.fn(async (_input: unknown) => {}),
}));

vi.mock('../server/suspicion_flags_db', () => ({
  SUSPICION_FLAG_DETAILS_MAX: 1000,
  upsertSuspicionFlag: dbMock.upsertSuspicionFlag,
}));

import {
  bustSuspicionFlagCache,
  configureSuspicionFlagDataset,
  DETECTOR_FLAG_KIND,
  DETECTOR_FLAG_RERECORD_MS,
  detectorFlagDetails,
  detectorFlagInputs,
  flagRegistrationBurst,
  readSuspicionFlagDataset,
  recordDetectorSuspicionFlags,
  resetDetectorFlagThrottleForTests,
  resetSuspicionFlagDatasetForTests,
  suspicionFlagsIdle,
} from '../server/suspicion_flags';

function suspicious(overrides: Partial<SuspiciousPlayer> = {}): SuspiciousPlayer {
  return {
    ref: { accountId: 42, characterId: 7, name: 'Botly', ip: '203.0.113.9' },
    snapshot: null,
    state: 'CONFIRMED',
    score: 12.4,
    evidence: [
      {
        kind: 'input_cadence',
        weight: 5,
        detail: 'metronomic',
        expiresAt: Infinity,
        occurrences: 3,
      },
      { kind: 'protocol_anomaly', weight: 2, detail: 'unknown command', expiresAt: Infinity },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  dbMock.upsertSuspicionFlag.mockClear();
  resetDetectorFlagThrottleForTests();
  resetSuspicionFlagDatasetForTests();
});

afterEach(async () => {
  await suspicionFlagsIdle();
  resetSuspicionFlagDatasetForTests();
});

describe('detectorFlagInputs', () => {
  it('persists only CONFIRMED sessions with a sane account id', () => {
    const inputs = detectorFlagInputs([
      suspicious(),
      suspicious({
        state: 'SUSPICIOUS',
        ref: { accountId: 43, characterId: 1, name: 'Maybe', ip: '' },
      }),
      suspicious({ ref: { accountId: 0, characterId: 1, name: 'Bad', ip: '' } }),
    ]);
    expect(inputs).toHaveLength(1);
    expect(inputs[0]).toMatchObject({
      accountId: 42,
      source: 'bot_detector',
      kind: DETECTOR_FLAG_KIND,
      severity: 'high',
    });
  });

  it('summarizes the evidence with recurrence counts', () => {
    const details = detectorFlagDetails(suspicious());
    expect(details).toContain('score 12');
    expect(details).toContain('input_cadence x3');
    expect(details).toContain('protocol_anomaly');
    expect(details).toContain('(Botly)');
  });
});

describe('recordDetectorSuspicionFlags', () => {
  it('writes once per account per throttle window, then again after it', async () => {
    const t0 = 1_700_000_000_000;
    recordDetectorSuspicionFlags([suspicious()], t0);
    recordDetectorSuspicionFlags([suspicious()], t0 + 1_000);
    await suspicionFlagsIdle();
    expect(dbMock.upsertSuspicionFlag).toHaveBeenCalledTimes(1);

    recordDetectorSuspicionFlags([suspicious()], t0 + DETECTOR_FLAG_RERECORD_MS);
    await suspicionFlagsIdle();
    expect(dbMock.upsertSuspicionFlag).toHaveBeenCalledTimes(2);
  });

  it('never throws into the tick when a write fails (fire-and-forget)', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    dbMock.upsertSuspicionFlag.mockRejectedValueOnce(new Error('db down'));
    recordDetectorSuspicionFlags([suspicious()], 1_700_000_000_000);
    await suspicionFlagsIdle();
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });
});

describe('flagRegistrationBurst', () => {
  it('mints a burst flag carrying the cohort as related accounts', async () => {
    flagRegistrationBurst({
      accountId: 42,
      signals: ['8 accounts from IP 203.0.113.9 in 10 minutes'],
      cohortAccountIds: [41, 40],
    });
    await suspicionFlagsIdle();
    expect(dbMock.upsertSuspicionFlag).toHaveBeenCalledWith({
      accountId: 42,
      source: 'registration_burst',
      kind: 'registration_burst',
      severity: 'medium',
      details: 'Automated registration pattern: 8 accounts from IP 203.0.113.9 in 10 minutes',
      relatedAccountIds: [41, 40],
    });
  });

  it('escalates a multi-signal burst to high and ignores an empty signal set', async () => {
    flagRegistrationBurst({ accountId: 1, signals: ['a', 'b'], cohortAccountIds: [] });
    flagRegistrationBurst({ accountId: 2, signals: [], cohortAccountIds: [] });
    await suspicionFlagsIdle();
    expect(dbMock.upsertSuspicionFlag).toHaveBeenCalledTimes(1);
    expect(dbMock.upsertSuspicionFlag.mock.calls[0][0]).toMatchObject({
      accountId: 1,
      severity: 'high',
    });
  });
});

describe('the Flagged-view cache', () => {
  const dataset = () => ({
    rows: [],
    countsByStatus: { new: 0, under_review: 0, cleared: 0, actioned: 0 },
    truncated: false,
  });

  it('serves through one single-flight cached read and refuses when unconfigured', async () => {
    resetSuspicionFlagDatasetForTests();
    expect(() => readSuspicionFlagDataset()).toThrow(/not configured/);
    const source = vi.fn(async () => dataset());
    configureSuspicionFlagDataset(source);
    await readSuspicionFlagDataset();
    await readSuspicionFlagDataset();
    expect(source).toHaveBeenCalledTimes(1);
  });

  it('busts on every flag write, so a workflow change is visible on the next read', async () => {
    const source = vi.fn(async () => dataset());
    configureSuspicionFlagDataset(source);
    await readSuspicionFlagDataset();
    expect(source).toHaveBeenCalledTimes(1);

    // A direct bust (the transition handlers call this).
    bustSuspicionFlagCache();
    await readSuspicionFlagDataset();
    expect(source).toHaveBeenCalledTimes(2);

    // An emitter write busts through the FIFO tail.
    flagRegistrationBurst({ accountId: 9, signals: ['x'], cohortAccountIds: [] });
    await suspicionFlagsIdle();
    await readSuspicionFlagDataset();
    expect(source).toHaveBeenCalledTimes(3);
  });
});
