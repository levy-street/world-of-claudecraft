// The cast-VFX readiness gate (src/render/cast_vfx_readiness_core.ts): the
// painter draws nothing until every cast program is linked, counts what it
// refused, latches once ready, and opens on its own deadline if the programs
// never arrive (a hold with no floor cost the whole session's cast VFX).

import { describe, expect, it, vi } from 'vitest';
import { CAST_VFX_READY_DEADLINE_MS } from '../src/render/cast_vfx_prewarm';
import { createCastVfxReadiness } from '../src/render/cast_vfx_readiness_core';
import { REVEAL_GATE_WATCHDOG_MS } from '../src/render/reveal_gate';

/** A material as the host answers for it: the program a settle PROVED for its
 *  CURRENT one, or null when the program it carries now is not proved. The
 *  answer is a handle rather than a boolean because the record answers per
 *  program while the gate asks per material. */
interface Mat {
  id: string;
  program: object | null;
}

/** Two distinct program handles: identity is all the core reads. */
const PROGRAM_A = { id: 'A' };
const PROGRAM_B = { id: 'B' };

const DEADLINE_MS = 30_000;

function harness(materials: Mat[], staged = true) {
  const state = { staged, materials, nowMs: 0 };
  const readiness = createCastVfxReadiness<Mat>({
    now: () => state.nowMs,
    deadlineMs: DEADLINE_MS,
    materials: () => state.materials,
    staged: () => state.staged,
    linked: (material) => material.program,
  });
  return { readiness, state };
}

describe('createCastVfxReadiness', () => {
  it('refuses while any cast material is unlinked, and counts each refusal', () => {
    const { readiness, state } = harness([
      { id: 'ring', program: PROGRAM_A },
      { id: 'decal', program: null },
    ]);
    expect(readiness.admit()).toBe(false);
    expect(readiness.admit()).toBe(false);
    expect(readiness.snapshot()).toEqual({ ready: false, refused: 2, pending: 1, forced: false });

    state.materials[1].program = PROGRAM_A;
    expect(readiness.admit()).toBe(true);
    expect(readiness.snapshot()).toEqual({ ready: true, refused: 2, pending: 0, forced: false });
  });

  it('refuses until the lazy stand-ins are staged, whatever the pools say', () => {
    const { readiness, state } = harness([{ id: 'ring', program: PROGRAM_A }], false);
    expect(readiness.admit()).toBe(false);
    expect(readiness.snapshot()).toMatchObject({ ready: false, pending: null });
    state.staged = true;
    expect(readiness.admit()).toBe(true);
  });

  it('latches ready: a material that arrives later never re-closes the gate', () => {
    // A linked program stays linked for its material's life, and the pools
    // and stand-ins are never disposed; a material minted live (a cast's own
    // clone) shares an already-linked program.
    const { readiness, state } = harness([{ id: 'ring', program: PROGRAM_A }]);
    expect(readiness.admit()).toBe(true);
    state.materials.push({ id: 'live-clone', program: null });
    expect(readiness.admit()).toBe(true);
    expect(readiness.snapshot().refused).toBe(0);
  });

  it('answers a per-frame consult without counting it', () => {
    const { readiness, state } = harness([{ id: 'ring', program: null }]);
    expect(readiness.ready()).toBe(false);
    expect(readiness.ready()).toBe(false);
    expect(readiness.snapshot().refused).toBe(0);
    state.materials[0].program = PROGRAM_A;
    expect(readiness.ready()).toBe(true);
  });

  it('reads the material set once, at the first consult after staging', () => {
    // The per-frame consult runs once per entity while the programs are still
    // linking; the set behind it is a scene walk, so it is collected once
    // (the pools and stand-ins are never disposed or replaced).
    const state = { staged: false, materials: [{ id: 'ring', program: null }] as Mat[] };
    const reads = vi.fn(() => state.materials);
    const readiness = createCastVfxReadiness<Mat>({
      now: () => 0,
      deadlineMs: DEADLINE_MS,
      materials: reads,
      staged: () => state.staged,
      linked: (material) => material.program,
    });
    expect(readiness.ready()).toBe(false);
    expect(reads).not.toHaveBeenCalled();
    state.staged = true;
    for (let i = 0; i < 5; i++) expect(readiness.ready()).toBe(false);
    expect(reads).toHaveBeenCalledTimes(1);
    state.materials[0].program = PROGRAM_A;
    expect(readiness.ready()).toBe(true);
    expect(reads).toHaveBeenCalledTimes(1);
  });

  it('re-asks every material each consult, so a program swap cannot hide behind an old answer', () => {
    // The answer is given FOR a program, and a material's current program can
    // change before the gate opens (a clone, a key change). A latch keyed on
    // the material alone would keep answering with a program that is gone.
    // The host read is a property lookup plus a record read, never a driver
    // query, so asking again costs a live frame nothing.
    const ring: Mat = { id: 'ring', program: PROGRAM_A };
    const decal: Mat = { id: 'decal', program: null };
    const asked: string[] = [];
    const readiness = createCastVfxReadiness<Mat>({
      now: () => 0,
      deadlineMs: DEADLINE_MS,
      materials: () => [ring, decal],
      staged: () => true,
      linked: (material) => {
        asked.push(material.id);
        return material.program;
      },
    });
    // Proved on A, but the gate is shut on the other material.
    expect(readiness.ready()).toBe(false);
    expect(readiness.snapshot().pending).toBe(1);
    expect(asked.filter((id) => id === 'ring')).toHaveLength(2);

    // Handed a program no settle has proved: pending again, however A
    // answered, and the gate stays shut for it too.
    ring.program = null;
    expect(readiness.ready()).toBe(false);
    expect(readiness.snapshot().pending).toBe(2);

    // Proved on B now: both answer, and the gate opens.
    ring.program = PROGRAM_B;
    decal.program = PROGRAM_B;
    expect(readiness.ready()).toBe(true);
    expect(readiness.snapshot()).toMatchObject({ ready: true, pending: 0, forced: false });
  });

  it('keeps the whole-gate latch: a swap after it opened never closes it again', () => {
    // The pools and stand-ins are never disposed, and a cast's own live clone
    // shares an already-proved program; re-closing an open gate would blank
    // the cast VFX mid-fight over a material nothing is waiting on.
    const ring: Mat = { id: 'ring', program: PROGRAM_A };
    const readiness = createCastVfxReadiness<Mat>({
      now: () => 0,
      deadlineMs: DEADLINE_MS,
      materials: () => [ring],
      staged: () => true,
      linked: (material) => material.program,
    });
    expect(readiness.admit()).toBe(true);
    ring.program = null;
    expect(readiness.admit()).toBe(true);
    expect(readiness.snapshot()).toMatchObject({ ready: true, pending: 0 });
  });

  it('is ready with nothing to link once staged', () => {
    const { readiness } = harness([]);
    expect(readiness.admit()).toBe(true);
  });

  it('opens on its deadline when the programs never arrive', () => {
    // The failure this bounds: a boot entry the budget dropped whose resume
    // never lands. Without a floor the gate stays shut for the session and the
    // player has no cast VFX at all, silently.
    const { readiness, state } = harness([{ id: 'a', program: null }]);
    expect(readiness.admit()).toBe(false);
    state.nowMs = DEADLINE_MS - 1;
    expect(readiness.admit()).toBe(false);
    expect(readiness.snapshot().forced).toBe(false);
    state.nowMs = DEADLINE_MS;
    expect(readiness.admit()).toBe(true);
    // And it SAYS it escaped, so a readout can tell this apart from a gate
    // that opened because its programs linked.
    expect(readiness.snapshot().forced).toBe(true);
    expect(readiness.snapshot().ready).toBe(true);
  });

  it('bounds the never-staged case too, not only the never-linked one', () => {
    // The deadline runs from the first CONSULT, so a stand-in group that is
    // never staged at all is bounded exactly like an unlinked one.
    const { readiness, state } = harness([], false);
    expect(readiness.admit()).toBe(false);
    state.nowMs = DEADLINE_MS;
    expect(readiness.admit()).toBe(true);
    expect(readiness.snapshot().forced).toBe(true);
  });

  it('does not report forced when the programs did arrive in time', () => {
    const { readiness, state } = harness([{ id: 'a', program: null }]);
    expect(readiness.admit()).toBe(false);
    state.nowMs = DEADLINE_MS - 1;
    state.materials[0].program = PROGRAM_A;
    expect(readiness.admit()).toBe(true);
    expect(readiness.snapshot().forced).toBe(false);
  });
});

describe('the deadline the scene gate runs on', () => {
  it('pins the cast-gate deadline to three times the reveal watchdog', () => {
    expect(CAST_VFX_READY_DEADLINE_MS).toBe(REVEAL_GATE_WATCHDOG_MS * 3);
    expect(CAST_VFX_READY_DEADLINE_MS).toBe(30_000);
  });
});
