// The two safety claims the whole parse design leans on, pinned: a disabled
// subsystem is a true no-op, and an observer throw disables capture instead of
// unwinding into the tick loop.
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, test, vi } from 'vitest';
import { createParseSubsystem } from '../server/parse';
import type { ParseFlags } from '../server/parse/flags';
import type { RecorderSim } from '../server/parse/types';
import { fakeSim } from './helpers/parse_fake_sim';

function enabledFlags(): ParseFlags {
  return {
    enabled: true,
    ingestUrl: 'http://localhost:1/ingest',
    ingestToken: null,
    surfaces: new Set(['arena', 'battleground', 'raid', 'dungeon', 'rift']),
    spoolDir: mkdtempSync(path.join(os.tmpdir(), 'parse-subsys-')),
    spoolMaxBytes: 1024 * 1024,
    envLabel: 'dev',
    censusEnabled: false,
    censusUtcHour: 9,
  };
}

describe('createParseSubsystem', () => {
  test('the inert default is a true no-op: disabled, observe does nothing, stop resolves', async () => {
    const subsystem = createParseSubsystem({
      sim: fakeSim(),
      realm: 'Claudemoon',
      build: '0.35.0',
      resolveParticipant: () => null,
      flags: { ...enabledFlags(), enabled: false, ingestUrl: null },
    });

    expect(subsystem.enabled).toBe(false);
    subsystem.observe([
      {
        type: 'damage',
        sourceId: 1,
        targetId: 2,
        amount: 5,
        crit: false,
        school: 'physical',
        ability: 'Strike',
        kind: 'hit',
      },
    ]);
    expect(subsystem.counters.recordsEmitted).toBe(0);
    await expect(subsystem.stop()).resolves.toBeUndefined();
  });

  test('an observer throw disables capture for the process instead of unwinding', () => {
    const sim = fakeSim();
    // Poison the state the recorder reads each tick: the throw must be caught
    // by the subsystem guard, never reach the caller (the tick loop).
    Object.defineProperty(sim, 'arenaMatches', {
      get() {
        throw new Error('poisoned');
      },
    });
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const subsystem = createParseSubsystem({
      sim: sim as RecorderSim,
      realm: 'Claudemoon',
      build: '0.35.0',
      resolveParticipant: () => null,
      flags: enabledFlags(),
    });

    expect(() => subsystem.observe([])).not.toThrow();
    expect(subsystem.counters.captureDisabled).toBe(1);
    // Dead after the first throw: no further work, no further logging.
    const errorCount = errors.mock.calls.length;
    expect(() => subsystem.observe([])).not.toThrow();
    expect(errors.mock.calls.length).toBe(errorCount);
    errors.mockRestore();
  });
});
