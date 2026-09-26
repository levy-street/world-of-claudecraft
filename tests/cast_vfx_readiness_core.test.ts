// The cast-VFX readiness gate (src/render/cast_vfx_readiness_core.ts): one
// ready bit per program family. A cast asks for the families it draws from
// (a mask); the gate refuses while any of them has an unlinked program,
// counts what it refused, latches each family once ready, and opens a family
// on its own deadline if its programs never arrive (a hold with no floor cost
// the whole session's cast VFX). The pools' own fail-closed check reads the
// same bits and counts a requirement miss.

import { describe, expect, it, vi } from 'vitest';
import { CAST_VFX_READY_DEADLINE_MS } from '../src/render/cast_vfx_prewarm';
import {
  type CastVfxFamilyDeps,
  createCastVfxReadiness,
} from '../src/render/cast_vfx_readiness_core';
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

const ENGINE = 1;
const KIT = 2;
const WARRIOR = ENGINE | KIT;
const DEADLINE_MS = 30_000;

function harness(
  engine: Mat[],
  kit: Mat[] = [],
  over: { declined?: () => boolean; reads?: (id: string) => void } = {},
) {
  const state = { engine, kit, nowMs: 0, frame: 0, frameStamped: false };
  const asked: string[] = [];
  const family = (id: string, bit: number, list: () => Mat[]): CastVfxFamilyDeps<Mat> => ({
    id,
    bit,
    materials: () => {
      over.reads?.(id);
      return list();
    },
    declined: id === 'kit' ? over.declined : undefined,
  });
  const readiness = createCastVfxReadiness<Mat>({
    now: () => state.nowMs,
    // Unstamped by default: every consult walks, as in a host with no frame.
    frame: () => (state.frameStamped ? state.frame : Number.NaN),
    deadlineMs: DEADLINE_MS,
    families: [family('engine', ENGINE, () => state.engine), family('kit', KIT, () => state.kit)],
    linked: (material) => {
      asked.push(material.id);
      return material.program;
    },
  });
  return { readiness, state, asked };
}

describe('createCastVfxReadiness', () => {
  it('refuses while a family the cast asks for is unlinked, and counts each refusal', () => {
    const { readiness, state } = harness([
      { id: 'ring', program: PROGRAM_A },
      { id: 'decal', program: null },
    ]);
    expect(readiness.admit(ENGINE)).toBe(false);
    expect(readiness.admit(ENGINE)).toBe(false);
    expect(readiness.snapshot()).toMatchObject({
      ready: false,
      refused: 2,
      pending: 1,
      forced: false,
      requirementMiss: 0,
    });
    expect(readiness.snapshot().families[0]).toMatchObject({ id: 'engine', refused: 2 });

    state.engine[1].program = PROGRAM_A;
    expect(readiness.admit(ENGINE)).toBe(true);
    expect(readiness.snapshot()).toMatchObject({ ready: true, refused: 2, pending: 0 });
  });

  it('holds a Warrior cast on the kit while a Mage cast draws on the engine alone', () => {
    const { readiness, state } = harness(
      [{ id: 'ring', program: PROGRAM_A }],
      [{ id: 'crest', program: null }],
    );
    expect(readiness.admit(ENGINE)).toBe(true);
    expect(readiness.admit(WARRIOR)).toBe(false);
    const snapshot = readiness.snapshot();
    expect(snapshot).toMatchObject({ ready: false, refused: 1, pending: 1 });
    expect(snapshot.families).toEqual([
      expect.objectContaining({ id: 'engine', ready: true, pending: 0, refused: 0 }),
      expect.objectContaining({ id: 'kit', ready: false, pending: 1, refused: 1 }),
    ]);
    state.kit[0].program = PROGRAM_A;
    expect(readiness.admit(WARRIOR)).toBe(true);
  });

  it('charges a refusal only to the families that held it', () => {
    const { readiness } = harness(
      [{ id: 'ring', program: null }],
      [{ id: 'crest', program: null }],
    );
    expect(readiness.admit(WARRIOR)).toBe(false);
    expect(readiness.admit(ENGINE)).toBe(false);
    expect(readiness.snapshot().refused).toBe(2);
    expect(readiness.snapshot().families.map((f) => f.refused)).toEqual([2, 1]);
  });

  it('latches ready: a material that arrives later never re-closes a family', () => {
    // A linked program stays linked for its material's life, and the pools
    // are never disposed; a material minted live (a cast's own clone) shares
    // an already-linked program.
    const { readiness, state } = harness([{ id: 'ring', program: PROGRAM_A }]);
    expect(readiness.admit(ENGINE)).toBe(true);
    state.engine.push({ id: 'live-clone', program: null });
    expect(readiness.admit(ENGINE)).toBe(true);
    expect(readiness.snapshot().refused).toBe(0);
  });

  it('answers a per-frame consult without counting it', () => {
    const { readiness, state } = harness([{ id: 'ring', program: null }]);
    expect(readiness.ready(ENGINE)).toBe(false);
    expect(readiness.ready(ENGINE)).toBe(false);
    expect(readiness.snapshot().refused).toBe(0);
    state.engine[0].program = PROGRAM_A;
    expect(readiness.ready(ENGINE)).toBe(true);
  });

  it('reads each family set once, at its first read', () => {
    // The per-frame consult runs once per entity while the programs are still
    // linking; the set behind it is a scene walk, so it is collected once
    // (the pools are built before it and never disposed or replaced).
    const reads = vi.fn();
    const { readiness, state } = harness(
      [{ id: 'ring', program: null }],
      [{ id: 'crest', program: null }],
      { reads },
    );
    expect(reads).not.toHaveBeenCalled();
    for (let i = 0; i < 5; i++) expect(readiness.ready(ENGINE)).toBe(false);
    expect(reads.mock.calls).toEqual([['engine'], ['kit']]);
    state.engine[0].program = PROGRAM_A;
    state.kit[0].program = PROGRAM_A;
    expect(readiness.ready(WARRIOR)).toBe(true);
    expect(reads).toHaveBeenCalledTimes(2);
  });

  it('walks the unready families at most once per frame stamp, and a ready one never again', () => {
    const { readiness, state, asked } = harness(
      [{ id: 'ring', program: PROGRAM_A }],
      [{ id: 'crest', program: null }],
    );
    state.frameStamped = true;
    for (let i = 0; i < 20; i++) readiness.ready(i % 2 ? ENGINE : WARRIOR);
    // One walk this frame: the engine latched on it, the kit stayed pending.
    expect(asked).toEqual(['ring', 'crest']);
    state.frame++;
    readiness.ready(WARRIOR);
    expect(asked).toEqual(['ring', 'crest', 'crest']);
    state.kit[0].program = PROGRAM_A;
    readiness.ready(WARRIOR);
    // Same stamp: the cached answer stands until the next frame.
    expect(readiness.ready(WARRIOR)).toBe(false);
    state.frame++;
    expect(readiness.ready(WARRIOR)).toBe(true);
    state.frame++;
    readiness.ready(WARRIOR);
    expect(asked).toEqual(['ring', 'crest', 'crest', 'crest']);
  });

  it('re-asks every material each read, so a program swap cannot hide behind an old answer', () => {
    // The answer is given FOR a program, and a material's current program can
    // change before the family opens (a clone, a key change). A latch keyed on
    // the material alone would keep answering with a program that is gone.
    const ring: Mat = { id: 'ring', program: PROGRAM_A };
    const decal: Mat = { id: 'decal', program: null };
    const { readiness, asked } = harness([ring, decal]);
    expect(readiness.ready(ENGINE)).toBe(false);
    expect(readiness.snapshot().pending).toBe(1);
    expect(asked.filter((id) => id === 'ring')).toHaveLength(2);

    ring.program = null;
    expect(readiness.ready(ENGINE)).toBe(false);
    expect(readiness.snapshot().pending).toBe(2);

    ring.program = PROGRAM_B;
    decal.program = PROGRAM_B;
    expect(readiness.ready(ENGINE)).toBe(true);
    expect(readiness.snapshot()).toMatchObject({ ready: true, pending: 0, forced: false });
  });

  it('keeps the family latch: a swap after it opened never closes it again', () => {
    const ring: Mat = { id: 'ring', program: PROGRAM_A };
    const { readiness } = harness([ring]);
    expect(readiness.admit(ENGINE)).toBe(true);
    ring.program = null;
    expect(readiness.admit(ENGINE)).toBe(true);
    expect(readiness.snapshot()).toMatchObject({ ready: true, pending: 0 });
  });

  it('is ready with nothing to link, and admits an empty mask', () => {
    const { readiness } = harness([]);
    expect(readiness.admit(WARRIOR)).toBe(true);
    expect(harness([{ id: 'ring', program: null }]).readiness.admit(0)).toBe(true);
  });
});

describe('the per-family deadline', () => {
  it('opens a family on its deadline when its programs never arrive, and says so', () => {
    // The failure this bounds: a boot entry the budget dropped whose resume
    // never lands. Without a floor the family stays shut for the session and
    // its casts draw nothing, silently.
    const { readiness, state } = harness([{ id: 'a', program: null }]);
    expect(readiness.admit(ENGINE)).toBe(false);
    state.nowMs = DEADLINE_MS - 1;
    expect(readiness.admit(ENGINE)).toBe(false);
    expect(readiness.snapshot().forced).toBe(false);
    state.nowMs = DEADLINE_MS;
    expect(readiness.admit(ENGINE)).toBe(true);
    expect(readiness.snapshot()).toMatchObject({ ready: true, forced: true });
    expect(readiness.snapshot().families[0]).toMatchObject({ ready: true, forced: true });
  });

  it('starts a family clock at the first consult that asks for it, not at the first consult', () => {
    // A Mage session consults the engine for minutes before a Warrior walks
    // in: the kit's bound is counted from that first Warrior cast.
    const { readiness, state } = harness(
      [{ id: 'ring', program: PROGRAM_A }],
      [{ id: 'crest', program: null }],
    );
    expect(readiness.admit(ENGINE)).toBe(true);
    state.nowMs = 10 * DEADLINE_MS;
    expect(readiness.admit(WARRIOR)).toBe(false);
    state.nowMs += DEADLINE_MS - 1;
    expect(readiness.admit(WARRIOR)).toBe(false);
    state.nowMs += 1;
    expect(readiness.admit(WARRIOR)).toBe(true);
    expect(readiness.snapshot().families.map((f) => f.forced)).toEqual([false, true]);
  });

  it('starts a family clock at a per-frame consult too: a hold asks for its families', () => {
    const { readiness, state } = harness(
      [{ id: 'ring', program: PROGRAM_A }],
      [{ id: 'crest', program: null }],
    );
    expect(readiness.ready(WARRIOR)).toBe(false);
    state.nowMs = DEADLINE_MS;
    expect(readiness.admit(WARRIOR)).toBe(true);
    expect(readiness.snapshot().families[1]).toMatchObject({ forced: true, refused: 0 });
  });

  it('starts no clock on a diagnostics read', () => {
    const { readiness, state } = harness([{ id: 'a', program: null }]);
    for (let i = 0; i < 3; i++) readiness.snapshot();
    state.nowMs = 5 * DEADLINE_MS;
    expect(readiness.admit(ENGINE)).toBe(false);
    expect(readiness.snapshot().forced).toBe(false);
    state.nowMs += DEADLINE_MS;
    expect(readiness.admit(ENGINE)).toBe(true);
  });

  it('does not report forced when the programs did arrive in time', () => {
    const { readiness, state } = harness([{ id: 'a', program: null }]);
    expect(readiness.admit(ENGINE)).toBe(false);
    state.nowMs = DEADLINE_MS - 1;
    state.engine[0].program = PROGRAM_A;
    expect(readiness.admit(ENGINE)).toBe(true);
    expect(readiness.snapshot().forced).toBe(false);
  });
});

describe('a declined family', () => {
  it('never holds a cast and is never forced', () => {
    const { readiness, state } = harness(
      [{ id: 'ring', program: PROGRAM_A }],
      [{ id: 'crest', program: null }],
      { declined: () => true },
    );
    expect(readiness.admit(WARRIOR)).toBe(true);
    state.nowMs = 3 * DEADLINE_MS;
    expect(readiness.admit(WARRIOR)).toBe(true);
    const snapshot = readiness.snapshot();
    expect(snapshot).toMatchObject({ ready: true, forced: false, refused: 0 });
    expect(snapshot.families[1]).toMatchObject({
      id: 'kit',
      ready: false,
      declined: true,
      forced: false,
      pending: null,
    });
  });

  it('answers on the fast path once latched: no clock, no frame stamp, no second question', () => {
    const declined = vi.fn(() => true);
    const now = vi.fn(() => 0);
    const frame = vi.fn(() => Number.NaN);
    const readiness = createCastVfxReadiness<Mat>({
      now,
      frame,
      deadlineMs: DEADLINE_MS,
      families: [
        { id: 'engine', bit: ENGINE, materials: () => [{ id: 'ring', program: PROGRAM_A }] },
        { id: 'kit', bit: KIT, materials: () => [], declined },
      ],
      linked: (material) => material.program,
    });
    expect(readiness.admit(WARRIOR)).toBe(true);
    const calls = [declined.mock.calls.length, now.mock.calls.length, frame.mock.calls.length];
    for (let i = 0; i < 50; i++) {
      expect(readiness.admit(WARRIOR)).toBe(true);
      expect(readiness.ready(WARRIOR)).toBe(true);
      expect(readiness.spawnAllowed(KIT)).toBe(false);
    }
    expect([declined.mock.calls.length, now.mock.calls.length, frame.mock.calls.length]).toEqual(
      calls,
    );
    expect(readiness.snapshot().families[1]).toMatchObject({ declined: true, requirementMiss: 0 });
  });

  it('keeps its pools shut without counting a miss', () => {
    const { readiness } = harness([], [{ id: 'crest', program: PROGRAM_A }], {
      declined: () => true,
    });
    readiness.ready(WARRIOR);
    expect(readiness.spawnAllowed(KIT)).toBe(false);
    expect(readiness.snapshot().requirementMiss).toBe(0);
  });
});

describe('the pool-side check', () => {
  it('lets a ready family spawn and counts a miss for an unready one', () => {
    const { readiness, state } = harness(
      [{ id: 'ring', program: PROGRAM_A }],
      [{ id: 'crest', program: null }],
    );
    readiness.ready(WARRIOR);
    expect(readiness.spawnAllowed(ENGINE)).toBe(true);
    expect(readiness.spawnAllowed(KIT)).toBe(false);
    expect(readiness.spawnAllowed(KIT)).toBe(false);
    const snapshot = readiness.snapshot();
    expect(snapshot.requirementMiss).toBe(2);
    expect(snapshot.families.map((f) => f.requirementMiss)).toEqual([0, 2]);
    state.kit[0].program = PROGRAM_A;
    readiness.ready(WARRIOR);
    expect(readiness.spawnAllowed(KIT)).toBe(true);
  });

  it('starts no clock and walks nothing', () => {
    const reads = vi.fn();
    const { readiness, state } = harness([{ id: 'ring', program: null }], [], { reads });
    expect(readiness.spawnAllowed(ENGINE)).toBe(false);
    expect(reads).not.toHaveBeenCalled();
    state.nowMs = 2 * DEADLINE_MS;
    expect(readiness.admit(ENGINE)).toBe(false);
  });
});

describe('the deadline the scene gate runs on', () => {
  it('pins the cast-gate deadline to three times the reveal watchdog', () => {
    expect(CAST_VFX_READY_DEADLINE_MS).toBe(REVEAL_GATE_WATCHDOG_MS * 3);
    expect(CAST_VFX_READY_DEADLINE_MS).toBe(30_000);
  });
});

describe('the linked answer is a handle, never a boolean', () => {
  it('refuses a host written the boolean way at the type level, so false cannot read as a proof', () => {
    // tsc is the pin: a boolean-returning host must not compile (a `false`
    // would otherwise be a non-null value the core reads as linked).
    const build = () =>
      createCastVfxReadiness<Mat>({
        now: () => 0,
        frame: () => 0,
        deadlineMs: DEADLINE_MS,
        families: [],
        // @ts-expect-error a boolean is not a proof: the host returns the proved program or null
        linked: () => false,
      });
    expect(typeof build).toBe('function');
  });
});
