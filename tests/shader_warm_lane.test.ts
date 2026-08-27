// The shader warm worker for the lanes that link WHOLE ROOTS as queue units
// (src/render/shader_warm_lane.ts): the streamed-zone prepares and the
// post-paint resume of the boot manifest. The shape it exists to keep is
// what the cases below read: the dry assembly rides the caller's queue as
// its own unit, the WAIT for the worker happens between units and never
// inside one (the queue is serial, so a unit that waited would hold the head
// for the whole link), and a bypass costs one policy read and nothing else.

import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import { GPU_WORK_PRIORITY } from '../src/render/background_gpu_queue';
import { type CompileArmHost, setCompileArmObserver } from '../src/render/compile_arms';
import type { DryProgramSource } from '../src/render/program_sources';
import { REVEAL_GATE_WATCHDOG_MS } from '../src/render/reveal_gate';
import {
  resetShaderWarmAuditForTest,
  shaderWarmAuditSnapshot,
} from '../src/render/shader_warm_audit';
import {
  armShaderWarm,
  resetShaderWarmForTest,
  shaderWarmSnapshot,
} from '../src/render/shader_warm_client';
import {
  holdForWarm,
  SHADER_WARM_LANE_HOLD_CAP_MS,
  type WarmLaneRun,
  warmRootBeforeLink,
  warmRootsBeforeLink,
} from '../src/render/shader_warm_lane';
import type { ShaderWarmWorkerMessage } from '../src/render/shader_warm_protocol';

afterEach(() => {
  resetShaderWarmForTest();
  resetShaderWarmAuditForTest();
  setCompileArmObserver(null);
});

const COSMETIC = GPU_WORK_PRIORITY.VISIBLE_PREWARM;

function dry(cacheKey: string): DryProgramSource {
  return {
    cacheKey,
    name: 'physical',
    vertexGlsl: `vertex:${cacheKey}`,
    fragmentGlsl: 'precision highp float;',
    index0Attribute: 'position',
  };
}

interface ArmsRigOptions {
  /** What the dry compile serves, by root name; absent means no program. */
  sources?: Record<string, DryProgramSource[]>;
  throwOnCollect?: boolean;
  context?: 'present' | 'missing' | 'throws';
}

function armsRig(options: ArmsRigOptions = {}) {
  const scene = new THREE.Scene();
  let current: THREE.WebGLRenderTarget | null = null;
  const assembled: string[] = [];
  const webgl = {
    getRenderTarget: () => current,
    setRenderTarget: (target: THREE.WebGLRenderTarget | null) => {
      current = target;
    },
    compileAsync: () => Promise.resolve(scene),
    collectProgramSources: (root: THREE.Object3D): DryProgramSource[] => {
      assembled.push(root.name);
      if (options.throwOnCollect) throw new Error('the dry compile blew up');
      return options.sources?.[root.name] ?? [];
    },
  };
  const glContext = {
    getContextAttributes: () => ({ antialias: false }),
    getExtension: (name: string) => (name === 'KHR_parallel_shader_compile' ? { name } : null),
  };
  const arms: CompileArmHost = {
    webgl: () => webgl,
    camera: () => new THREE.PerspectiveCamera(),
    scene: () => scene,
    shadowCamera: () => new THREE.OrthographicCamera(),
    offscreen: () => false,
    offscreenTarget: () => ({}) as THREE.WebGLRenderTarget,
    depthMaterials: () => new Map(),
    shadowArm: () => false,
  };
  if (options.context !== 'missing') {
    arms.context = () => {
      if (options.context === 'throws') throw new Error('context on its way out');
      return glContext;
    };
  }
  return { arms, assembled };
}

function rootNamed(name: string): THREE.Group {
  const group = new THREE.Group();
  group.name = name;
  group.add(new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial()));
  return group;
}

interface RunCall {
  priority: number;
  label: string;
  /** The queue unit's own promise has resolved. */
  settled: boolean;
}

/** The caller's queue: the work runs on a microtask, as a queue unit does. */
function runRig(options: { reject?: boolean } = {}) {
  const calls: RunCall[] = [];
  const run: WarmLaneRun = (work, priority, label) => {
    const call: RunCall = { priority, label, settled: false };
    calls.push(call);
    if (options.reject) return Promise.reject(new Error('the queue is shut'));
    return Promise.resolve()
      .then(work)
      .then((value) => {
        call.settled = true;
        return value;
      });
  };
  return { calls, run };
}

interface LaneWorker {
  postMessage(message: unknown): void;
  terminate(): void;
  onmessage: ((event: MessageEvent<ShaderWarmWorkerMessage>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  emit(message: ShaderWarmWorkerMessage): void;
  askedIds(): number[];
}

/** A worker that comes up at once and, in `auto` mode, answers every program
 *  warm as it arrives, so a lane's own sequencing is what the case reads. */
function laneWorker(auto = true): LaneWorker {
  const asked: number[] = [];
  const worker: LaneWorker = {
    onmessage: null,
    onerror: null,
    terminate() {},
    postMessage(message) {
      const payload = message as { kind: string; sources?: { id: number }[] };
      if (payload.kind === 'init') {
        worker.emit({ kind: 'ready', ok: true, reason: null, extensions: [], adapter: 'test' });
        return;
      }
      if (payload.kind !== 'warm') return;
      for (const source of payload.sources ?? []) {
        asked.push(source.id);
        if (auto) worker.emit({ kind: 'warmed', id: source.id, linkMs: 5 });
      }
    },
    emit(message) {
      worker.onmessage?.({ data: message } as MessageEvent<ShaderWarmWorkerMessage>);
    },
    askedIds: () => asked.slice(),
  };
  return worker;
}

/** Reset the client onto a lane worker, in the reveal lane, armed. */
function armedLane(auto = true, search = '?shaderwarm=reveal'): LaneWorker {
  const worker = laneWorker(auto);
  resetShaderWarmForTest({
    search,
    mobile: false,
    spawn: () => worker,
    schedule: () => () => {},
  });
  armShaderWarm();
  return worker;
}

describe('the cap a lane hold is bounded by', () => {
  it('is the gates own cap, half the reveal watchdog', () => {
    // A lane that gave up later than a gate would leave the hard escape no
    // room to link the root cold before it is revealed.
    expect(SHADER_WARM_LANE_HOLD_CAP_MS).toBe(REVEAL_GATE_WATCHDOG_MS / 2);
    expect(SHADER_WARM_LANE_HOLD_CAP_MS).toBe(5_000);
  });
});

describe('holdForWarm', () => {
  /** A clock that answers each reading in turn, so a hold's duration is a
   *  number the case chose. */
  function clockOf(readings: number[]): () => number {
    let at = 0;
    return () => readings[Math.min(at++, readings.length - 1)] ?? 0;
  }

  it('resolves warm, with the time the hold actually took', async () => {
    const outcome = await holdForWarm(
      Promise.resolve(true),
      5_000,
      clockOf([1_000, 1_030]),
      () => () => {},
    );
    expect(outcome).toEqual({ warm: true, timedOut: false, holdMs: 30 });
  });

  it('resolves not warm when the worker answered but could not link it', async () => {
    // Not a timeout: the hold ended on the worker's answer, and the caller
    // links cold knowing why.
    const outcome = await holdForWarm(
      Promise.resolve(false),
      5_000,
      clockOf([1_000, 1_005]),
      () => () => {},
    );
    expect(outcome).toEqual({ warm: false, timedOut: false, holdMs: 5 });
  });

  it('resolves not warm when the warm promise rejects', async () => {
    const outcome = await holdForWarm(
      Promise.reject(new Error('the worker died')),
      5_000,
      clockOf([0, 4]),
      () => () => {},
    );
    expect(outcome).toEqual({ warm: false, timedOut: false, holdMs: 4 });
  });

  it('cancels the cap the moment the warm answers', async () => {
    let cancels = 0;
    let armed = 0;
    await holdForWarm(Promise.resolve(true), 5_000, clockOf([0, 1]), (_callback, ms) => {
      armed = ms;
      return () => {
        cancels++;
      };
    });
    expect(armed).toBe(5_000);
    expect(cancels).toBe(1);
  });

  it('gives up on the cap and ignores the warm that arrives after it', async () => {
    // The link is already running cold by then; a late answer that flipped
    // the outcome would tell the readout a cold link was a hit.
    let fire: () => void = () => {};
    let resolveWarm: (warm: boolean) => void = () => {};
    const warm = new Promise<boolean>((resolve) => {
      resolveWarm = resolve;
    });
    const held = holdForWarm(warm, 5_000, clockOf([2_000, 7_000, 9_999]), (callback) => {
      fire = callback;
      return () => {};
    });

    fire();
    resolveWarm(true);

    expect(await held).toEqual({ warm: false, timedOut: true, holdMs: 5_000 });
  });
});

describe('warmRootBeforeLink bypasses', () => {
  /** Every bypass still announces the root to the audit: a lane that dropped
   *  out of the announcement would read as a link nobody expected. */
  async function bypassed(options: {
    search?: string;
    armed?: boolean;
    context?: 'missing' | 'throws';
  }) {
    resetShaderWarmAuditForTest('?perf');
    const worker = laneWorker();
    resetShaderWarmForTest({
      search: options.search ?? '?shaderwarm=reveal',
      mobile: false,
      spawn: () => worker,
      schedule: () => () => {},
    });
    if (options.armed !== false) armShaderWarm();
    const { arms, assembled } = armsRig({
      sources: { zone: [dry('ka')] },
      context: options.context,
    });
    const rig = runRig();
    const outcome = await warmRootBeforeLink(arms, rootNamed('zone'), {
      priority: COSMETIC,
      label: 'zone-prepare-warm:zone',
      run: rig.run,
    });
    return { outcome, rig, assembled };
  }

  it('links as before in mode off, without touching the caller queue', async () => {
    const { outcome, rig, assembled } = await bypassed({ search: '?shaderwarm=off' });

    expect(outcome).toBeNull();
    expect(rig.calls).toEqual([]);
    // Announced all the same, through the audit's own dry pass.
    expect(assembled).toEqual(['zone']);
    expect(shaderWarmAuditSnapshot()).toMatchObject({ expected: 1 });
    expect(shaderWarmSnapshot().bypassed['mode-off']).toBe(1);
  });

  it('links as before before the first reveal', async () => {
    const { outcome, rig, assembled } = await bypassed({ armed: false });

    expect(outcome).toBeNull();
    expect(rig.calls).toEqual([]);
    expect(assembled).toEqual(['zone']);
    expect(shaderWarmSnapshot().bypassed['before-reveal']).toBe(1);
  });

  it('links as before when the host has no GL context to mirror', async () => {
    const { outcome, rig, assembled } = await bypassed({ context: 'missing' });

    expect(outcome).toBeNull();
    expect(rig.calls).toEqual([]);
    expect(assembled).toEqual(['zone']);
    expect(shaderWarmSnapshot().bypassed.unavailable).toBe(1);
  });

  it('links as before when reading the context throws', async () => {
    const { outcome, rig, assembled } = await bypassed({ context: 'throws' });

    expect(outcome).toBeNull();
    expect(rig.calls).toEqual([]);
    expect(assembled).toEqual(['zone']);
    expect(shaderWarmSnapshot().bypassed.unavailable).toBe(1);
  });
});

describe('warmRootBeforeLink holds', () => {
  it('runs ONE assembly unit at the caller priority and label, and waits outside it', async () => {
    // The queue is serial: a unit that waited for the worker would hold the
    // head for the whole link, which is the cost this lane exists to avoid.
    // The cap is armed inside the hold, so what it sees is what the wait
    // sees: the assembly unit already settled.
    const worker = armedLane(false);
    const { arms } = armsRig({ sources: { zone: [dry('ka')] } });
    const rig = runRig();
    let assemblySettledWhenHoldBegan: boolean | null = null;

    const held = warmRootBeforeLink(arms, rootNamed('zone'), {
      priority: COSMETIC,
      label: 'zone-prepare-warm:zone',
      run: rig.run,
      // The cap is armed at the instant the hold begins, so this reading is
      // the state of the queue unit at that instant.
      schedule: () => {
        assemblySettledWhenHoldBegan = rig.calls[0]?.settled ?? null;
        return () => {};
      },
      now: () => 0,
    });
    // Give the assembly unit its microtask, and the hold its own.
    for (let tick = 0; tick < 4; tick++) await Promise.resolve();

    expect(rig.calls).toHaveLength(1);
    expect(rig.calls[0]).toMatchObject({
      priority: COSMETIC,
      label: 'zone-prepare-warm:zone',
    });
    expect(assemblySettledWhenHoldBegan).toBe(true);
    expect(worker.askedIds()).toEqual([1]);

    worker.emit({ kind: 'warmed', id: 1, linkMs: 5 });
    expect(await held).toEqual({ warm: true, timedOut: false, holdMs: 0 });
    // Still one unit: the hold never went through the queue.
    expect(rig.calls).toHaveLength(1);
  });

  it('resolves warm and counts the hold in the readout', async () => {
    const worker = armedLane();
    const { arms } = armsRig({ sources: { zone: [dry('ka'), dry('kb')] } });
    const rig = runRig();

    const outcome = await warmRootBeforeLink(arms, rootNamed('zone'), {
      priority: COSMETIC,
      label: 'zone-prepare-warm:zone',
      run: rig.run,
      schedule: () => () => {},
      now: () => 0,
    });

    expect(outcome).toMatchObject({ warm: true, timedOut: false });
    expect(worker.askedIds()).toEqual([1, 2]);
    expect(shaderWarmSnapshot()).toMatchObject({ held: 1, heldWarm: 1, heldTimedOut: 0, sent: 2 });
  });

  it('gives up at the cap, answers the caller, and counts the miss', async () => {
    // The caller links cold from here; the readout is what says the worker
    // was asked and did not make it.
    const worker = armedLane(false);
    const { arms } = armsRig({ sources: { zone: [dry('ka')] } });
    const rig = runRig();
    let fire: () => void = () => {};
    let clock = 1_000;

    const held = warmRootBeforeLink(arms, rootNamed('zone'), {
      priority: COSMETIC,
      label: 'zone-prepare-warm:zone',
      run: rig.run,
      now: () => clock,
      schedule: (callback) => {
        fire = callback;
        return () => {};
      },
    });
    for (let tick = 0; tick < 4; tick++) await Promise.resolve();
    clock = 4_200;
    fire();

    expect(await held).toEqual({ warm: false, timedOut: true, holdMs: 3_200 });
    expect(shaderWarmSnapshot()).toMatchObject({ held: 1, heldWarm: 0, heldTimedOut: 1 });
    // A warm that lands after the escape changes neither the answer nor the
    // count.
    worker.emit({ kind: 'warmed', id: 1, linkMs: 5 });
    expect(shaderWarmSnapshot()).toMatchObject({ held: 1, heldTimedOut: 1 });
  });

  it('asks for the offscreen variant too when the caller compiles it', async () => {
    // The zone prewarm links the offscreen variant, so warming only the
    // canvas one would write a key its link never asks for.
    armedLane();
    const { arms, assembled } = armsRig({ sources: { zone: [dry('ka')] } });
    const rig = runRig();

    await warmRootBeforeLink(arms, rootNamed('zone'), {
      priority: COSMETIC,
      label: 'zone-prewarm-warm:zone',
      run: rig.run,
      includeOffscreenVariant: true,
      schedule: () => () => {},
      now: () => 0,
    });

    // One dry pass per colour target the arm covers: the canvas variant and
    // the offscreen one.
    expect(assembled).toEqual(['zone', 'zone']);
  });

  it('asks only for the canvas variant when the caller does not compile the other', async () => {
    armedLane();
    const { arms, assembled } = armsRig({ sources: { zone: [dry('ka')] } });
    const rig = runRig();

    await warmRootBeforeLink(arms, rootNamed('zone'), {
      priority: COSMETIC,
      label: 'zone-prepare-warm:zone',
      run: rig.run,
      schedule: () => () => {},
      now: () => 0,
    });

    expect(assembled).toEqual(['zone']);
  });

  it('answers null and counts nothing-to-warm when the root has no program to link', async () => {
    const worker = armedLane();
    const { arms } = armsRig();
    const rig = runRig();

    const outcome = await warmRootBeforeLink(arms, rootNamed('zone'), {
      priority: COSMETIC,
      label: 'zone-prepare-warm:zone',
      run: rig.run,
      schedule: () => () => {},
      now: () => 0,
    });

    expect(outcome).toBeNull();
    expect(worker.askedIds()).toEqual([]);
    expect(shaderWarmSnapshot()).toMatchObject({ held: 0 });
    expect(shaderWarmSnapshot().bypassed['nothing-to-warm']).toBe(1);
  });

  it('answers null when the dry assembly throws, rather than carrying it into the lane', async () => {
    // A renderer without the dry-compile patch, or one on its way out: the
    // caller's link must run exactly as it did before.
    armedLane();
    const { arms } = armsRig({ throwOnCollect: true });
    const rig = runRig();

    const outcome = await warmRootBeforeLink(arms, rootNamed('zone'), {
      priority: COSMETIC,
      label: 'zone-prepare-warm:zone',
      run: rig.run,
      schedule: () => () => {},
      now: () => 0,
    });

    expect(outcome).toBeNull();
    // Not "nothing to warm": the worker was unavailable to this root, and
    // the readout must say so.
    expect(shaderWarmSnapshot().bypassed.unavailable).toBe(1);
    expect(shaderWarmSnapshot().bypassed['nothing-to-warm']).toBe(0);
  });

  it('answers null when the queue refuses the assembly unit', async () => {
    armedLane();
    const { arms } = armsRig({ sources: { zone: [dry('ka')] } });
    const rig = runRig({ reject: true });

    const outcome = await warmRootBeforeLink(arms, rootNamed('zone'), {
      priority: COSMETIC,
      label: 'zone-prepare-warm:zone',
      run: rig.run,
      schedule: () => () => {},
      now: () => 0,
    });

    expect(outcome).toBeNull();
    expect(rig.calls).toHaveLength(1);
    expect(shaderWarmSnapshot().bypassed.unavailable).toBe(1);
    expect(shaderWarmSnapshot().bypassed['nothing-to-warm']).toBe(0);
  });
});

describe('warmRootsBeforeLink', () => {
  it('asks for every root before it waits on any of them', async () => {
    // A batch unit links its roots together, so the worker must have the
    // whole set to pace; asking one, waiting, then asking the next would
    // serialise the batch behind its own holds.
    const worker = armedLane(false);
    const { arms, assembled } = armsRig({
      sources: { a: [dry('ka')], b: [dry('kb')], c: [dry('kc')] },
    });
    const rig = runRig();
    let done = false;

    const all = warmRootsBeforeLink(arms, [rootNamed('a'), rootNamed('b'), rootNamed('c')], {
      priority: GPU_WORK_PRIORITY.BOOT_DEBT,
      label: 'scene:0:warm',
      run: rig.run,
      schedule: () => () => {},
      now: () => 0,
    }).then(() => {
      done = true;
    });
    for (let tick = 0; tick < 4; tick++) await Promise.resolve();

    expect(assembled).toEqual(['a', 'b', 'c']);
    expect(worker.askedIds()).toEqual([1, 2, 3]);
    expect(rig.calls.map((call) => call.label)).toEqual([
      'scene:0:warm',
      'scene:0:warm',
      'scene:0:warm',
    ]);
    expect(rig.calls.map((call) => call.priority)).toEqual([15, 15, 15]);
    // Nothing has been waited out yet: the whole set is in flight.
    expect(done).toBe(false);

    for (const id of [1, 2, 3]) worker.emit({ kind: 'warmed', id, linkMs: 5 });
    await all;
    expect(done).toBe(true);
    expect(shaderWarmSnapshot()).toMatchObject({ held: 3, heldWarm: 3 });
  });

  it('resolves over an empty root list without asking anything', async () => {
    const worker = armedLane();
    const { arms } = armsRig();
    const rig = runRig();

    await warmRootsBeforeLink(arms, [], {
      priority: GPU_WORK_PRIORITY.BOOT_DEBT,
      label: 'scene:0:warm',
      run: rig.run,
    });

    expect(rig.calls).toEqual([]);
    expect(worker.askedIds()).toEqual([]);
  });
});
