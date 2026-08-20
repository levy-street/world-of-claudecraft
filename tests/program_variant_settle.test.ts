// The compile gate piece's variant settle (src/render/program_variant_settle.ts):
// after a piece's compileAsync resolves, EVERY program variant its materials
// carry is polled until ready or the piece's deadline fires, and each ready
// one is recorded for the touch tail. This is what closes the raced-pending
// link: three's compileAsync polls one slot per material (`currentProgram`),
// so a material's other variants (skinned vs rigid, the depth twin) linked
// unpolled, were never marked, and paid their link in a live frame.
//
// The driver is asked ONLY inside the poll: every stub below throws from
// isReady once the settle has resolved, so a query from the touch walk (the
// 5.6 s production freeze) fails the suite outright.

import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { CompileGateQueue, type PieceDeadline } from '../src/render/compile_gate';
import { linkPieceWork } from '../src/render/compile_gate_pieces';
import { isProgramKnownReady } from '../src/render/linked_program_readiness';
import type { MaterialPropertiesLike } from '../src/render/linked_program_touch';
import { runLinkedProgramTouchLane } from '../src/render/linked_program_touch_lane';
import { prewarmDepthMaterial } from '../src/render/prewarm_depth_material';
import {
  type ProgramVariantSettleScheduler,
  pieceMaterialsOf,
  pieceProgramSettle,
  type SettleProgramLike,
  settleProgramVariants,
} from '../src/render/program_variant_settle';
import {
  PROGRAM_VARIANT_POLL_INTERVAL_MAX_MS,
  PROGRAM_VARIANT_POLL_INTERVAL_MS,
} from '../src/render/program_variant_settle_core';

/** A program that answers ready from its `readyAfter`-th poll on. Sealed
 *  (`seal()`) it throws from isReady: the walk must never ask. */
function program(name: string, readyAfter: number) {
  let polls = 0;
  let sealed = false;
  const uniforms = vi.fn();
  const attributes = vi.fn();
  const built = {
    name,
    get polls() {
      return polls;
    },
    seal: () => {
      sealed = true;
    },
    isReady: () => {
      if (sealed) throw new Error(`${name}: the driver was asked outside the settle's poll`);
      polls++;
      return polls >= readyAfter;
    },
    getUniforms: uniforms,
    getAttributes: attributes,
    uniforms,
    attributes,
  };
  return built as typeof built & SettleProgramLike;
}

/** A hand-driven timer queue shared by the gate's deadline and the poll:
 *  `advance(ms)` fires what is due, in due order. */
function manualScheduler(): ProgramVariantSettleScheduler & {
  advance(ms: number): void;
  now(): number;
  armed: number[];
  passCostMs: number;
} {
  let clock = 0;
  let nextId = 1;
  let atPassEnd = false;
  const timers = new Map<number, { at: number; cb: () => void }>();
  const armed: number[] = [];
  const scheduler = {
    armed,
    // What a poll pass costs on the wall clock: 0 by default (cheap queries),
    // raised by a test to model a link-backlogged GPU process.
    passCostMs: 0,
    now: () => {
      // A pass reads the clock twice, at its start and its end: the second
      // read is passCostMs later, and the timer clock itself never drifts.
      const value = clock + (atPassEnd ? scheduler.passCostMs : 0);
      atPassEnd = !atPassEnd;
      return value;
    },
    setTimeout: (cb: () => void, ms: number) => {
      const id = nextId++;
      armed.push(ms);
      timers.set(id, { at: clock + ms, cb });
      return id;
    },
    clearTimeout: (id: number) => {
      timers.delete(id);
    },
    advance: (ms: number) => {
      const until = clock + ms;
      for (;;) {
        let dueId: number | null = null;
        let dueAt = Number.POSITIVE_INFINITY;
        for (const [id, timer] of timers) {
          if (timer.at <= until && timer.at < dueAt) {
            dueAt = timer.at;
            dueId = id;
          }
        }
        if (dueId === null) break;
        const timer = timers.get(dueId);
        timers.delete(dueId);
        clock = dueAt;
        timer?.cb();
      }
      clock = until;
    },
  };
  return scheduler;
}

interface MaterialSpec {
  programs: Map<string, SettleProgramLike>;
  current?: SettleProgramLike;
}

function propertiesFor(records: Map<THREE.Material, MaterialSpec>): MaterialPropertiesLike {
  return {
    get: (queried) => {
      const spec = records.get(queried as THREE.Material);
      return spec ? { programs: spec.programs, currentProgram: spec.current } : {};
    },
  };
}

const live: PieceDeadline = { fired: false };

async function flush(rounds = 8): Promise<void> {
  for (let index = 0; index < rounds; index++) await Promise.resolve();
}

describe('settleProgramVariants', () => {
  it('polls every variant of the material, not just the current slot, until each is ready, and records them all', async () => {
    // The finding: the rigid variant is `currentProgram` (compileAsync polled
    // it and resolved), the skinned sibling is still linking and would have
    // paid its link at first draw.
    const material = new THREE.MeshStandardMaterial({ name: 'mod_skin_detail' });
    const rigid = program('rigid', 1);
    const skinned = program('skinned', 3);
    const properties = propertiesFor(
      new Map([
        [
          material,
          {
            programs: new Map<string, SettleProgramLike>([
              ['rigid', rigid],
              ['skinned', skinned],
            ]),
            current: rigid,
          },
        ],
      ]),
    );
    const scheduler = manualScheduler();
    let result: Awaited<ReturnType<typeof settleProgramVariants>> | null = null;
    void settleProgramVariants(properties, [material], live, scheduler).then((settled) => {
      result = settled;
    });
    // The first pass ran synchronously: the ready variant is proved at once.
    expect(rigid.polls).toBe(1);
    expect(skinned.polls).toBe(1);
    expect(isProgramKnownReady(rigid)).toBe(true);
    expect(isProgramKnownReady(skinned)).toBe(false);
    expect(result).toBeNull();
    // Later passes ride the scheduler at three's cadence; the proved variant
    // is never asked again.
    scheduler.advance(PROGRAM_VARIANT_POLL_INTERVAL_MS);
    expect(skinned.polls).toBe(2);
    expect(rigid.polls).toBe(1);
    expect(result).toBeNull();
    scheduler.advance(PROGRAM_VARIANT_POLL_INTERVAL_MS);
    await flush();
    expect(skinned.polls).toBe(3);
    expect(isProgramKnownReady(skinned)).toBe(true);
    expect(result).toEqual({ settled: true, ready: 2, pending: 0 });
    expect(scheduler.armed).toEqual([
      PROGRAM_VARIANT_POLL_INTERVAL_MS,
      PROGRAM_VARIANT_POLL_INTERVAL_MS,
    ]);
  });

  it('after the settle, the touch walk warms BOTH variants without asking the driver', async () => {
    const material = new THREE.MeshStandardMaterial({ name: 'mod_jewel' });
    const rigid = program('rigid', 1);
    const skinned = program('skinned', 2);
    const properties = propertiesFor(
      new Map([
        [
          material,
          {
            programs: new Map<string, SettleProgramLike>([
              ['rigid', rigid],
              ['skinned', skinned],
            ]),
            current: rigid,
          },
        ],
      ]),
    );
    const scheduler = manualScheduler();
    const settled = settleProgramVariants(properties, [material], live, scheduler);
    scheduler.advance(PROGRAM_VARIANT_POLL_INTERVAL_MS);
    await expect(settled).resolves.toEqual({ settled: true, ready: 2, pending: 0 });
    rigid.seal();
    skinned.seal();

    const target = new THREE.Group();
    target.add(new THREE.Mesh(new THREE.BufferGeometry(), material));
    const queue = { run: <T>(work: () => T | Promise<T>) => Promise.resolve(work()) };
    await expect(runLinkedProgramTouchLane(queue, properties, target, 30)).resolves.toBe(2);
    expect(rigid.uniforms).toHaveBeenCalledTimes(1);
    expect(skinned.uniforms).toHaveBeenCalledTimes(1);
  });

  it('ends the poll when the deadline fires: the ready variant stays proved, the linking one is reported pending and never touched', async () => {
    const material = new THREE.MeshStandardMaterial({ name: 'paladin' });
    const rigid = program('rigid', 1);
    const never = program('never', Number.POSITIVE_INFINITY);
    const properties = propertiesFor(
      new Map([
        [
          material,
          {
            programs: new Map<string, SettleProgramLike>([
              ['rigid', rigid],
              ['never', never],
            ]),
            current: rigid,
          },
        ],
      ]),
    );
    const scheduler = manualScheduler();
    const deadline = { fired: false };
    const settled = settleProgramVariants(properties, [material], deadline, scheduler);
    scheduler.advance(PROGRAM_VARIANT_POLL_INTERVAL_MS * 3);
    expect(never.polls).toBe(4);
    deadline.fired = true;
    // One more pass past the deadline (the poll checks it after asking, so a
    // variant that became ready right at the deadline is still proved), then
    // the settle ends without another timer.
    scheduler.advance(PROGRAM_VARIANT_POLL_INTERVAL_MS);
    await expect(settled).resolves.toEqual({ settled: false, ready: 1, pending: 1 });
    expect(never.polls).toBe(5);
    expect(scheduler.armed).toHaveLength(4);
    expect(isProgramKnownReady(rigid)).toBe(true);
    expect(isProgramKnownReady(never)).toBe(false);
    rigid.seal();
    never.seal();

    const target = new THREE.Group();
    target.add(new THREE.Mesh(new THREE.BufferGeometry(), material));
    const queue = { run: <T>(work: () => T | Promise<T>) => Promise.resolve(work()) };
    // The tail of a timed-out gate: it marks nothing new and warms only what
    // the settle proved.
    await expect(
      runLinkedProgramTouchLane(queue, properties, target, 30, { settled: false }),
    ).resolves.toBe(1);
    expect(rigid.uniforms).toHaveBeenCalledTimes(1);
    expect(never.uniforms).not.toHaveBeenCalled();
  });

  it('runs one pass and resolves at once when the deadline had already fired (a compile slower than the gate)', async () => {
    const material = new THREE.MeshStandardMaterial({ name: 'mage' });
    const ready = program('ready', 1);
    const linking = program('linking', 2);
    const properties = propertiesFor(
      new Map([
        [
          material,
          {
            programs: new Map<string, SettleProgramLike>([
              ['ready', ready],
              ['linking', linking],
            ]),
          },
        ],
      ]),
    );
    const scheduler = manualScheduler();
    await expect(
      settleProgramVariants(properties, [material], { fired: true }, scheduler),
    ).resolves.toEqual({ settled: false, ready: 1, pending: 1 });
    expect(scheduler.armed).toEqual([]);
    expect(isProgramKnownReady(ready)).toBe(true);
    expect(isProgramKnownReady(linking)).toBe(false);
  });

  it('skips programs an earlier settle already proved, and resolves without a timer when nothing is pending', async () => {
    const material = new THREE.MeshStandardMaterial({ name: 'proved-before' });
    const proved = program('proved', 1);
    const properties = propertiesFor(
      new Map([[material, { programs: new Map<string, SettleProgramLike>([['only', proved]]) }]]),
    );
    const scheduler = manualScheduler();
    await expect(settleProgramVariants(properties, [material], live, scheduler)).resolves.toEqual({
      settled: true,
      ready: 1,
      pending: 0,
    });
    proved.seal();
    // A second settle over the same material (another body wearing it) asks
    // the driver nothing.
    await expect(settleProgramVariants(properties, [material], live, scheduler)).resolves.toEqual({
      settled: true,
      ready: 0,
      pending: 0,
    });
    expect(scheduler.armed).toEqual([]);
  });

  it('rejects when a poll throws, on the first pass or a later one, instead of hanging the piece', async () => {
    // A query that throws (a context on its way out) fails the piece, which
    // the gate treats fail-soft; a settle that never resolved would hold its
    // gate, and the reveal behind it, forever.
    const material = new THREE.MeshStandardMaterial({ name: 'dying' });
    const boom = program('boom', Number.POSITIVE_INFINITY);
    boom.seal();
    const properties = propertiesFor(
      new Map([[material, { programs: new Map<string, SettleProgramLike>([['boom', boom]]) }]]),
    );
    const scheduler = manualScheduler();
    await expect(settleProgramVariants(properties, [material], live, scheduler)).rejects.toThrow(
      'asked outside',
    );
    const late = program('late', Number.POSITIVE_INFINITY);
    const later = propertiesFor(
      new Map([[material, { programs: new Map<string, SettleProgramLike>([['late', late]]) }]]),
    );
    const settled = settleProgramVariants(later, [material], live, scheduler);
    late.seal();
    scheduler.advance(PROGRAM_VARIANT_POLL_INTERVAL_MS);
    await expect(settled).rejects.toThrow('asked outside');
  });

  it('settles at once for a material three never prepared, or no material at all', async () => {
    const cold = new THREE.MeshBasicMaterial({ name: 'cold' });
    const scheduler = manualScheduler();
    await expect(
      settleProgramVariants(propertiesFor(new Map()), [cold], live, scheduler),
    ).resolves.toEqual({ settled: true, ready: 0, pending: 0 });
    await expect(
      settleProgramVariants(propertiesFor(new Map()), [], live, scheduler),
    ).resolves.toEqual({ settled: true, ready: 0, pending: 0 });
    expect(scheduler.armed).toEqual([]);
  });

  it("backs off like three's own poll when a pass is expensive, and resets when passes come back cheap", async () => {
    const material = new THREE.MeshStandardMaterial({ name: 'backlogged' });
    const slow = program('slow', 5);
    const properties = propertiesFor(
      new Map([[material, { programs: new Map<string, SettleProgramLike>([['slow', slow]]) }]]),
    );
    const scheduler = manualScheduler();
    scheduler.passCostMs = 30;
    const settled = settleProgramVariants(properties, [material], live, scheduler);
    // expensive passes double the interval from the floor: 20, 40, 80
    expect(scheduler.armed).toEqual([20]);
    scheduler.advance(20);
    scheduler.advance(40);
    expect(scheduler.armed).toEqual([20, 40, 80]);
    scheduler.passCostMs = 0;
    scheduler.advance(80);
    // a cheap pass resets to the floor
    expect(scheduler.armed).toEqual([20, 40, 80, PROGRAM_VARIANT_POLL_INTERVAL_MS]);
    scheduler.advance(PROGRAM_VARIANT_POLL_INTERVAL_MS);
    await expect(settled).resolves.toEqual({ settled: true, ready: 1, pending: 0 });
    expect(slow.polls).toBe(5);
    // and the doubling never passes three's cap
    expect(Math.max(...scheduler.armed)).toBeLessThanOrEqual(PROGRAM_VARIANT_POLL_INTERVAL_MAX_MS);
  });
});

describe('pieceMaterialsOf', () => {
  it('lists the representative own tuple plus the depth twins the shadow arm cached for it, deduped', () => {
    const cache = new Map<string, THREE.MeshDepthMaterial>();
    const skin = new THREE.MeshStandardMaterial({ name: 'skin' });
    // an alpha-tested trim derives its own depth twin; a plain third material
    // shares the skin's (same depth inputs, same key), listed once
    const trim = new THREE.MeshStandardMaterial({ name: 'trim', alphaTest: 0.5 });
    const plain = new THREE.MeshStandardMaterial({ name: 'plain' });
    const caster = new THREE.SkinnedMesh(new THREE.BufferGeometry(), [skin, trim, skin, plain]);
    caster.castShadow = true;
    // what compileShadowPrograms minted for this caster
    const skinTwin = prewarmDepthMaterial(cache, skin, caster);
    const trimTwin = prewarmDepthMaterial(cache, trim, caster);
    expect(prewarmDepthMaterial(cache, plain, caster)).toBe(skinTwin);
    expect(trimTwin).not.toBe(skinTwin);
    expect(pieceMaterialsOf(caster, cache)).toEqual([skin, trim, plain, skinTwin, trimTwin]);
  });

  it('lists only the own materials for a mesh with no twin minted yet, and nothing for a bare group', () => {
    const cache = new Map<string, THREE.MeshDepthMaterial>();
    const skin = new THREE.MeshStandardMaterial({ name: 'skin' });
    const caster = new THREE.Mesh(new THREE.BufferGeometry(), skin);
    caster.castShadow = true;
    expect(pieceMaterialsOf(caster, cache)).toEqual([skin]);
    expect(pieceMaterialsOf(new THREE.Group(), cache)).toEqual([]);
  });
});

describe('the settle inside a pieced gate (runPieces + linkPieceWork)', () => {
  function gateHarness() {
    const scheduler = manualScheduler();
    const queue = new CompileGateQueue();
    const cache = new Map<string, THREE.MeshDepthMaterial>();
    const skin = new THREE.MeshStandardMaterial({ name: 'skin' });
    const caster = new THREE.SkinnedMesh(new THREE.BufferGeometry(), skin);
    caster.castShadow = true;
    const twin = prewarmDepthMaterial(cache, skin, caster);
    return { scheduler, queue, cache, skin, caster, twin };
  }

  it('resolves the gate SETTLED only once every variant of every piece material is ready, depth twin included', async () => {
    const { scheduler, queue, cache, skin, caster, twin } = gateHarness();
    const rigid = program('rigid', 1);
    const skinned = program('skinned', 2);
    const depth = program('depth', 3);
    const properties = propertiesFor(
      new Map<THREE.Material, MaterialSpec>([
        [
          skin,
          {
            programs: new Map<string, SettleProgramLike>([
              ['rigid', rigid],
              ['skinned', skinned],
            ]),
            current: rigid,
          },
        ],
        [
          twin,
          { programs: new Map<string, SettleProgramLike>([['depth', depth]]), current: depth },
        ],
      ]),
    );
    const settle = pieceProgramSettle(properties, cache, scheduler);
    const pieces = linkPieceWork(
      caster,
      () => Promise.resolve(),
      () => Promise.resolve(),
      settle,
    );
    expect(pieces).toHaveLength(1);
    let result: unknown = null;
    void queue.runPieces(pieces, 1500, { scheduler }).then((gate) => {
      result = gate;
    });
    await flush();
    // the piece's deadline (1500) then the settle's first reschedule (10)
    expect(scheduler.armed).toEqual([1500, PROGRAM_VARIANT_POLL_INTERVAL_MS]);
    expect(result).toBeNull();
    scheduler.advance(PROGRAM_VARIANT_POLL_INTERVAL_MS);
    await flush();
    expect(result).toBeNull();
    scheduler.advance(PROGRAM_VARIANT_POLL_INTERVAL_MS);
    await flush();
    expect(result).toEqual({ failed: false, timedOut: false });
    for (const p of [rigid, skinned, depth]) expect(isProgramKnownReady(p)).toBe(true);
  });

  it('resolves the gate TIMED OUT when a variant never links: the piece ends its poll at its deadline, the ready ones proved', async () => {
    const { scheduler, queue, cache, skin, caster } = gateHarness();
    const rigid = program('rigid', 1);
    const never = program('never', Number.POSITIVE_INFINITY);
    const properties = propertiesFor(
      new Map<THREE.Material, MaterialSpec>([
        [
          skin,
          {
            programs: new Map<string, SettleProgramLike>([
              ['rigid', rigid],
              ['never', never],
            ]),
            current: rigid,
          },
        ],
      ]),
    );
    const settle = pieceProgramSettle(properties, cache, scheduler);
    const pieces = linkPieceWork(
      caster,
      () => Promise.resolve(),
      () => Promise.resolve(),
      settle,
    );
    let result: unknown = null;
    void queue.runPieces(pieces, 100, { scheduler, recordTimeoutEvent: false }).then((gate) => {
      result = gate;
    });
    await flush();
    scheduler.advance(99);
    await flush();
    expect(result).toBeNull();
    // the deadline fires at 100; the poll's next pass sees it and ends
    scheduler.advance(PROGRAM_VARIANT_POLL_INTERVAL_MS + 1);
    await flush();
    expect(result).toEqual({ failed: false, timedOut: true });
    const pollsAtEnd = never.polls;
    // nothing keeps polling after the piece resolved
    scheduler.advance(1000);
    expect(never.polls).toBe(pollsAtEnd);
    expect(isProgramKnownReady(rigid)).toBe(true);
    expect(isProgramKnownReady(never)).toBe(false);
  });
});
