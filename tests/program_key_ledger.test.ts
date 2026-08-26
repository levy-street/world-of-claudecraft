// The program-key ledger host: swept from the watch's readouts, off without
// the perf flags, bounded, and carrying the full key with a timestamp.
import { afterEach, describe, expect, it } from 'vitest';
import * as liveProgramWatch from '../src/render/live_program_watch';
import { resetLiveProgramWatchForTest } from '../src/render/live_program_watch';
import type { LiveProgramEntry } from '../src/render/live_program_watch_core';
import {
  PROGRAM_KEY_LEDGER_LIMIT,
  programKeyLedgerEnabled,
  programKeyLedgerSnapshot,
  resetProgramKeyLedgerForTest,
  sweepProgramKeyLedger,
} from '../src/render/program_key_ledger';

const program = (id: number, name = 'MeshStandardMaterial'): LiveProgramEntry => ({
  id,
  name,
  cacheKey: `physical,highp,srgb,${id}`,
});

function host(programs: LiveProgramEntry[]) {
  return { info: { programs, memory: { textures: 0 } } };
}

afterEach(() => {
  resetProgramKeyLedgerForTest();
  resetLiveProgramWatchForTest();
});

describe('programKeyLedger', () => {
  it('is off without the perf flags and on with either of them', () => {
    resetProgramKeyLedgerForTest('');
    expect(programKeyLedgerEnabled()).toBe(false);
    expect(sweepProgramKeyLedger(host([program(1)]), 10)).toBe(0);
    expect(programKeyLedgerSnapshot().entries).toEqual([]);

    resetProgramKeyLedgerForTest('?perf');
    expect(programKeyLedgerEnabled()).toBe(true);
    resetProgramKeyLedgerForTest('?perfTrace=1&other=2');
    expect(programKeyLedgerEnabled()).toBe(true);
    resetProgramKeyLedgerForTest('?perfTrace=0');
    expect(programKeyLedgerEnabled()).toBe(false);
  });

  it('records each new program once, with its full key and the sweep time', () => {
    resetProgramKeyLedgerForTest('?perf');
    const programs = [program(1), program(2)];
    expect(sweepProgramKeyLedger(host(programs), 100.4)).toBe(2);
    expect(sweepProgramKeyLedger(host(programs), 200)).toBe(0);
    programs.push(program(3, 'ShaderMaterial'));
    expect(sweepProgramKeyLedger(host(programs), 300)).toBe(1);
    expect(programKeyLedgerSnapshot()).toEqual({
      enabled: true,
      dropped: 0,
      entries: [
        { key: 'physical,highp,srgb,1', atMs: 100, id: 1, name: 'MeshStandardMaterial' },
        { key: 'physical,highp,srgb,2', atMs: 100, id: 2, name: 'MeshStandardMaterial' },
        { key: 'physical,highp,srgb,3', atMs: 300, id: 3, name: 'ShaderMaterial' },
      ],
    });
  });

  it('stays bounded and says how much it dropped', () => {
    resetProgramKeyLedgerForTest('?perf');
    const programs: LiveProgramEntry[] = [];
    for (let id = 0; id < PROGRAM_KEY_LEDGER_LIMIT + 5; id++) programs.push(program(id));
    expect(sweepProgramKeyLedger(host(programs), 1)).toBe(PROGRAM_KEY_LEDGER_LIMIT);
    const snapshot = programKeyLedgerSnapshot();
    expect(snapshot.entries).toHaveLength(PROGRAM_KEY_LEDGER_LIMIT);
    expect(snapshot.dropped).toBe(5);
  });

  it('is swept by the watch readouts the renderer already calls', () => {
    resetProgramKeyLedgerForTest('?perf');
    const programs = [program(1)];
    const webgl = host(programs);
    // The manifest reads the counts before and after every entry.
    liveProgramWatch.programCounts(webgl);
    expect(programKeyLedgerSnapshot().entries).toHaveLength(1);
    // The reveal arms the watch; a live frame absorbs before and records after.
    programs.push(program(2));
    liveProgramWatch.armLiveProgramWatch(webgl);
    expect(programKeyLedgerSnapshot().entries).toHaveLength(2);
    programs.push(program(3));
    liveProgramWatch.absorbLivePrograms(webgl);
    expect(programKeyLedgerSnapshot().entries).toHaveLength(3);
    programs.push(program(4));
    liveProgramWatch.recordNewLivePrograms(webgl);
    expect(programKeyLedgerSnapshot().entries.map((e) => e.id)).toEqual([1, 2, 3, 4]);
  });
});
