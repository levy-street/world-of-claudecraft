// Direct unit tests for the pure leaf src/sim/instance_exit_memory.ts (issue #2653):
// the eligibility-window bookkeeping shared by the dungeon door scrub
// (instances/dungeons.ts) and the rift beacon/exit scrub (rift/runs.ts). No Sim
// needed; the map/window math is host-agnostic.

import { describe, expect, it } from 'vitest';
import {
  COMBAT_EXIT_MEMORY_SECONDS,
  type CombatExitMemory,
  recordCombatExit,
  takeCombatExit,
} from '../src/sim/instance_exit_memory';

describe('instance_exit_memory: recordCombatExit', () => {
  it('does nothing when there is no threat to remember (an out-of-combat exit)', () => {
    const memory: CombatExitMemory = new Map();
    recordCombatExit(memory, 1, 0, []);
    expect(memory.size).toBe(0);
  });

  it('remembers non-empty threat, expiring COMBAT_EXIT_MEMORY_SECONDS from now', () => {
    const memory: CombatExitMemory = new Map();
    recordCombatExit(memory, 1, 100, [[7, 42, 0]]);
    const rec = memory.get(1);
    expect(rec).toBeDefined();
    expect(rec?.mobThreat).toEqual([[7, 42, 0]]);
    expect(rec?.expiresAt).toBe(100 + COMBAT_EXIT_MEMORY_SECONDS);
  });

  it('overwrites an earlier record for the same pid with a fresh one', () => {
    const memory: CombatExitMemory = new Map();
    recordCombatExit(memory, 1, 0, [[7, 10, 0]]);
    recordCombatExit(memory, 1, 5, [
      [7, 20, 0],
      [8, 30, 0],
    ]);
    const rec = memory.get(1);
    expect(rec?.mobThreat).toEqual([
      [7, 20, 0],
      [8, 30, 0],
    ]);
    expect(rec?.expiresAt).toBe(5 + COMBAT_EXIT_MEMORY_SECONDS);
  });
});

describe('instance_exit_memory: takeCombatExit', () => {
  it('returns null and stays empty when nothing was ever recorded', () => {
    const memory: CombatExitMemory = new Map();
    expect(takeCombatExit(memory, 1, 0)).toBeNull();
    expect(memory.size).toBe(0);
  });

  it('returns the record while still inside the window, consuming it', () => {
    const memory: CombatExitMemory = new Map();
    recordCombatExit(memory, 1, 0, [[7, 42, 0]]);

    const rec = takeCombatExit(memory, 1, COMBAT_EXIT_MEMORY_SECONDS - 1);

    expect(rec?.mobThreat).toEqual([[7, 42, 0]]);
    // Consumed: a second read (even still inside the original window) finds nothing.
    expect(takeCombatExit(memory, 1, COMBAT_EXIT_MEMORY_SECONDS - 1)).toBeNull();
  });

  it('returns null once the window has lapsed, and still removes the stale entry', () => {
    const memory: CombatExitMemory = new Map();
    recordCombatExit(memory, 1, 0, [[7, 42, 0]]);

    expect(takeCombatExit(memory, 1, COMBAT_EXIT_MEMORY_SECONDS + 1)).toBeNull();
    expect(memory.size).toBe(0);
  });

  it('is exactly at the boundary: expiresAt itself no longer counts as inside the window', () => {
    const memory: CombatExitMemory = new Map();
    recordCombatExit(memory, 1, 0, [[7, 42, 0]]);

    expect(takeCombatExit(memory, 1, COMBAT_EXIT_MEMORY_SECONDS)).toBeNull();
  });

  it('keeps independent pids from clobbering each other', () => {
    const memory: CombatExitMemory = new Map();
    recordCombatExit(memory, 1, 0, [[7, 10, 0]]);
    recordCombatExit(memory, 2, 0, [[7, 20, 0]]);

    expect(takeCombatExit(memory, 1, 1)?.mobThreat).toEqual([[7, 10, 0]]);
    expect(takeCombatExit(memory, 2, 1)?.mobThreat).toEqual([[7, 20, 0]]);
  });
});
