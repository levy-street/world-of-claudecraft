// Self-test for the allocation-budget probe (tests/util/alloc_probe.ts), the
// canonical per-frame allocation assertion the per-frame painters reuse. Proves
// the probe has teeth: it PASSES an in-place-mutating core
// (the contract) and FAILS a reallocating one, both for the reallocated-container
// case and the reallocated-slot case, while correctly IGNORING primitive fields
// that legitimately mutate in place every frame.

import { describe, expect, it } from 'vitest';
import { assertAllocationStable, probeAllocationStability } from './util/alloc_probe';

// A correct core: preallocate once, mutate the slots' primitive fields in place.
function makeInPlaceArrayCore(slots: number): () => Array<{ cd: number; usable: boolean }> {
  const state = Array.from({ length: slots }, () => ({ cd: 0, usable: false }));
  let frame = 0;
  return () => {
    frame++;
    for (let i = 0; i < slots; i++) {
      state[i].cd = (frame + i) % 10;
      state[i].usable = state[i].cd === 0;
    }
    return state;
  };
}

// The bug we catch: a fresh array of fresh objects every frame.
function makeReallocArrayCore(slots: number): () => Array<{ cd: number; usable: boolean }> {
  let frame = 0;
  return () => {
    frame++;
    return Array.from({ length: slots }, (_unused, i) => ({
      cd: (frame + i) % 10,
      usable: (frame + i) % 10 === 0,
    }));
  };
}

// A subtler bug: the SAME container is returned, but a slot is replaced with a
// fresh object each frame.
function makeReallocSlotCore(slots: number): () => Array<{ cd: number }> {
  const state: Array<{ cd: number }> = Array.from({ length: slots }, () => ({ cd: 0 }));
  let frame = 0;
  return () => {
    frame++;
    state[0] = { cd: frame }; // reallocate slot 0 only
    return state;
  };
}

// A reused pool OBJECT (not array) with a reference-typed slot and a primitive
// counter; the counter mutates every frame and must be ignored.
function makeInPlaceObjectCore(): () => { count: number; rows: Array<{ x: number }> } {
  const pool = { count: 0, rows: [{ x: 0 }, { x: 0 }] };
  let frame = 0;
  return () => {
    frame++;
    pool.count = frame;
    pool.rows[0].x = frame;
    pool.rows[1].x = frame * 2;
    return pool;
  };
}

describe('probeAllocationStability', () => {
  it('passes an in-place-mutating array core (the contract)', () => {
    const result = probeAllocationStability(makeInPlaceArrayCore(4), 64);
    expect(result.stable).toBe(true);
    expect(result.firstUnstableIndex).toBe(-1);
  });

  it('fails a core that reallocates the whole container, naming the top level', () => {
    const result = probeAllocationStability(makeReallocArrayCore(4), 64);
    expect(result.stable).toBe(false);
    expect(result.firstUnstableIndex).toBe(-1);
    expect(result.detail).toContain('top-level array reference changed');
  });

  it('fails a core that reallocates a single slot, naming the index', () => {
    const result = probeAllocationStability(makeReallocSlotCore(4), 64);
    expect(result.stable).toBe(false);
    expect(result.firstUnstableIndex).toBe(0);
    expect(result.detail).toContain('[0]');
  });

  it('passes a reused pool object whose primitive counter mutates in place', () => {
    const result = probeAllocationStability(makeInPlaceObjectCore(), 64);
    expect(result.stable).toBe(true);
  });

  it('rejects a thunk that returns a primitive (no reusable identity)', () => {
    let n = 0;
    const result = probeAllocationStability(() => n++, 8);
    expect(result.stable).toBe(false);
    expect(result.detail).toContain('must return a reused object or array');
  });

  it('treats fewer than two calls as trivially stable', () => {
    const result = probeAllocationStability(makeReallocArrayCore(4), 1);
    expect(result.stable).toBe(true);
  });
});

describe('assertAllocationStable', () => {
  it('does not throw for an in-place core', () => {
    expect(() => assertAllocationStable(makeInPlaceArrayCore(4), 64, 'demo core')).not.toThrow();
  });

  it('throws a labelled, descriptive error for a reallocating core', () => {
    expect(() => assertAllocationStable(makeReallocArrayCore(4), 64, 'demo core')).toThrow(
      /demo core: allocation budget violated: top-level array reference changed/,
    );
  });
});
