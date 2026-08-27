// A compile gate as a requester of the shader warm worker
// (src/render/shader_warm_gate.ts). Two things move, and both are read here:
// the dry assembly of a piece's programs becomes its OWN queue unit (it runs
// three's assembly, so it is budgeted work, never a free pass on the frame
// that created the gate), and the piece itself is submitted only once those
// programs came back warm. A gate that cannot wait, one whose cut no longer
// matches its pieces, or one whose hold outlives the cap submits exactly as
// it did before, under the labels one whole submission would have given it.

import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import { type CompileArmHost, setCompileArmObserver } from '../src/render/compile_arms';
import type { CompileGatePiece, CompileGateResult } from '../src/render/compile_gate';
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
import { runPiecesWarmed, SHADER_WARM_HOLD_CAP_MS } from '../src/render/shader_warm_gate';
import type { ShaderWarmWorkerMessage } from '../src/render/shader_warm_protocol';

afterEach(() => {
  resetShaderWarmForTest();
  resetShaderWarmAuditForTest();
  setCompileArmObserver(null);
});

const SETTLED: CompileGateResult = { failed: false, timedOut: false };

function dry(cacheKey: string, vertex: string): DryProgramSource {
  return {
    cacheKey,
    name: 'physical',
    vertexGlsl: vertex,
    fragmentGlsl: 'precision highp float;',
    index0Attribute: 'position',
  };
}

interface ArmsRigOptions {
  /** The dry compile a representative is served, by node name. */
  sources?: Record<string, DryProgramSource[]>;
  context?: 'present' | 'missing' | 'throws';
}

function armsRig(options: ArmsRigOptions = {}) {
  const scene = new THREE.Scene();
  let current: THREE.WebGLRenderTarget | null = null;
  let collectCalls = 0;
  const webgl = {
    getRenderTarget: () => current,
    setRenderTarget: (target: THREE.WebGLRenderTarget | null) => {
      current = target;
    },
    compileAsync: () => Promise.resolve(scene),
    collectProgramSources: (root: THREE.Object3D): DryProgramSource[] => {
      collectCalls++;
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
  return { arms, collectCalls: () => collectCalls };
}

/** A root of one material group per name: one representative per name, in
 *  order, so `pieces` and the representatives line up. */
function rootOf(names: string[]): THREE.Group {
  const group = new THREE.Group();
  group.name = 'kit';
  for (const name of names) {
    const mesh = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial());
    mesh.name = name;
    group.add(mesh);
  }
  return group;
}

/** The gate's own pieces are opaque to the warm gate, so each carries a
 *  marker; the assembly unit the warm gate mints carries none. */
function markerOf(piece: CompileGatePiece): string {
  return (piece as unknown as { marker?: string }).marker ?? 'assemble';
}

function piecesOf(markers: string[]): CompileGatePiece[] {
  return markers.map((marker) => Object.assign(() => Promise.resolve(marker), { marker }));
}

interface SubmitRig {
  submit: (pieces: CompileGatePiece[], firstIndex: number) => Promise<CompileGateResult>;
  /** One `marker@firstIndex` entry per submitted piece, in submission order. */
  log: string[];
}

/** Runs every piece it is handed, the way the queue does, and answers with
 *  whatever `answer` says for that submission. */
function submitRig(
  answer: (log: readonly string[], firstIndex: number) => CompileGateResult = () => SETTLED,
): SubmitRig {
  const log: string[] = [];
  return {
    log,
    submit(pieces, firstIndex) {
      const entries = pieces.map((piece) => `${markerOf(piece)}@${firstIndex}`);
      log.push(...entries);
      const result = answer(entries, firstIndex);
      return Promise.all(pieces.map((piece) => piece({ fired: false }))).then(() => result);
    },
  };
}

interface WarmWorker {
  postMessage(message: unknown): void;
  terminate(): void;
  onmessage: ((event: MessageEvent<ShaderWarmWorkerMessage>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  posted: Record<string, unknown>[];
  emit(message: ShaderWarmWorkerMessage): void;
  ready(): void;
  /** The ids the worker has been asked to warm, oldest first. */
  askedIds(): number[];
}

function warmWorker(): WarmWorker {
  const worker: WarmWorker = {
    posted: [],
    onmessage: null,
    onerror: null,
    postMessage(message) {
      worker.posted.push(message as Record<string, unknown>);
    },
    terminate() {},
    emit(message) {
      worker.onmessage?.({ data: message } as MessageEvent<ShaderWarmWorkerMessage>);
    },
    ready() {
      worker.emit({ kind: 'ready', ok: true, reason: null, extensions: [], adapter: 'test' });
    },
    askedIds() {
      return worker.posted
        .filter((message) => message.kind === 'warm')
        .flatMap((message) => (message.sources as { id: number }[]).map((source) => source.id));
    },
  };
  return worker;
}

/** Reset the client onto a fake worker in the reveal lane (the mode a
 *  cosmetic reveal ships under) and arm it. */
function armedWorker(search = '?shaderwarm=reveal'): WarmWorker {
  const worker = warmWorker();
  resetShaderWarmForTest({
    search,
    mobile: false,
    spawn: () => worker,
    schedule: () => () => {},
  });
  armShaderWarm();
  return worker;
}

/** Let the assembly units, the warm promises and the submissions they
 *  trigger run out. */
async function flush(): Promise<void> {
  for (let tick = 0; tick < 4; tick++) await Promise.resolve();
}

const COSMETIC = 20;

describe('a gate that cannot wait', () => {
  it('submits every piece at once, at index zero, and counts the reason', async () => {
    // Mode off is the measurement arm and the shipping default: the gate
    // must behave exactly as it did before the worker existed, in one
    // submission, with no dry assembly at all.
    resetShaderWarmForTest({ search: '?shaderwarm=off' });
    armShaderWarm();
    const { arms, collectCalls } = armsRig();
    const rig = submitRig();

    const result = await runPiecesWarmed(arms, rootOf(['a', 'b']), piecesOf(['a', 'b']), {
      priority: COSMETIC,
      imminent: false,
      submit: rig.submit,
    });

    expect(rig.log).toEqual(['a@0', 'b@0']);
    expect(result).toEqual(SETTLED);
    expect(shaderWarmSnapshot().bypassed['mode-off']).toBe(1);
    expect(collectCalls()).toBe(0);
  });

  it('bypasses as unavailable when the host has no GL context to mirror', async () => {
    armedWorker();
    const { arms } = armsRig({ context: 'missing' });
    const rig = submitRig();

    await runPiecesWarmed(arms, rootOf(['a']), piecesOf(['a']), {
      priority: COSMETIC,
      imminent: false,
      submit: rig.submit,
    });

    expect(rig.log).toEqual(['a@0']);
    expect(shaderWarmSnapshot().bypassed.unavailable).toBe(1);
    expect(shaderWarmSnapshot().worker).toBe('idle');
  });

  it('bypasses as unavailable when reading the context throws', async () => {
    // A context on its way out: the gate links as before rather than
    // carrying the throw into the reveal.
    armedWorker();
    const { arms } = armsRig({ context: 'throws' });
    const rig = submitRig();

    const result = await runPiecesWarmed(arms, rootOf(['a']), piecesOf(['a']), {
      priority: COSMETIC,
      imminent: false,
      submit: rig.submit,
    });

    expect(rig.log).toEqual(['a@0']);
    expect(result).toEqual(SETTLED);
    expect(shaderWarmSnapshot().bypassed.unavailable).toBe(1);
  });

  it('submits an empty gate straight through', async () => {
    armedWorker();
    const { arms } = armsRig();
    const rig = submitRig();

    await runPiecesWarmed(arms, rootOf([]), [], {
      priority: COSMETIC,
      imminent: false,
      submit: rig.submit,
    });

    expect(rig.log).toEqual([]);
  });

  it('counts a cut that no longer matches the caller pieces, and submits the gate whole', async () => {
    // The gate pairs piece to representative by index; a root whose material
    // groups stopped lining up with the caller's pieces would warm the wrong
    // programs, so it keeps the old path and says so in the readout.
    armedWorker();
    const { arms, collectCalls } = armsRig({ sources: { a: [dry('k', 'v')] } });
    const rig = submitRig();

    await runPiecesWarmed(arms, rootOf(['a', 'b']), piecesOf(['only-one']), {
      priority: COSMETIC,
      imminent: false,
      submit: rig.submit,
    });

    expect(rig.log).toEqual(['only-one@0']);
    expect(shaderWarmSnapshot().bypassed['piece-mismatch']).toBe(1);
    expect(collectCalls()).toBe(0);
  });

  it('still announces a bypassed gate through the audit own dry pass', async () => {
    // The audit is the evidence that a link matched what was announced; a
    // bypassed gate must stay in it, or the capture reads as if the gate
    // never existed.
    resetShaderWarmAuditForTest('?perf');
    resetShaderWarmForTest({ search: '?shaderwarm=off' });
    const { arms, collectCalls } = armsRig({
      sources: { a: [dry('ka', 'va')], b: [dry('kb', 'vb')] },
    });
    const rig = submitRig();

    await runPiecesWarmed(arms, rootOf(['a', 'b']), piecesOf(['a', 'b']), {
      priority: COSMETIC,
      imminent: false,
      submit: rig.submit,
    });

    expect(rig.log).toEqual(['a@0', 'b@0']);
    expect(collectCalls()).toBe(2);
    expect(shaderWarmAuditSnapshot()).toMatchObject({ expected: 2, dryCompile: true });
  });
});

describe('a gate that holds for the worker', () => {
  it('runs each piece dry assembly as its own unit, then the piece once it is warm', async () => {
    // Both submissions carry the piece's index in the root's cut, so the
    // queue labels them as one whole submission would have.
    const worker = armedWorker();
    const { arms } = armsRig({
      sources: { a: [dry('ka', 'va')], b: [dry('kb', 'vb'), dry('kb2', 'vb2')] },
    });
    const rig = submitRig();

    const gate = runPiecesWarmed(arms, rootOf(['a', 'b']), piecesOf(['a', 'b']), {
      priority: COSMETIC,
      imminent: false,
      submit: rig.submit,
    });
    // The assembly units go to the queue at once; the pieces do not.
    expect(rig.log).toEqual(['assemble@0', 'assemble@1']);
    worker.ready();
    await flush();
    expect(rig.log).toEqual(['assemble@0', 'assemble@1']);
    expect(worker.askedIds()).toEqual([1, 2, 3]);

    worker.emit({ kind: 'warmed', id: 1, linkMs: 9 });
    await flush();
    expect(rig.log).toEqual(['assemble@0', 'assemble@1', 'a@0']);

    // The second piece waits for BOTH of its programs.
    worker.emit({ kind: 'warmed', id: 2, linkMs: 9 });
    await flush();
    expect(rig.log).toEqual(['assemble@0', 'assemble@1', 'a@0']);

    worker.emit({ kind: 'warmed', id: 3, linkMs: 9 });
    expect(await gate).toEqual(SETTLED);
    expect(rig.log).toEqual(['assemble@0', 'assemble@1', 'a@0', 'b@1']);
    expect(shaderWarmSnapshot()).toMatchObject({ held: 2, heldWarm: 2, heldTimedOut: 0 });
  });

  it('merges the pieces gate results into the one the caller awaits', async () => {
    // The caller sees exactly what a single submit(pieces, 0) would have
    // answered: a failure or a timeout anywhere is the gate's.
    const worker = armedWorker();
    const { arms } = armsRig({ sources: { a: [dry('ka', 'va')], b: [dry('kb', 'vb')] } });
    const rig = submitRig((entries) => {
      if (entries[0] === 'a@0') return { failed: true, timedOut: false };
      if (entries[0] === 'b@1') return { failed: false, timedOut: true };
      return SETTLED;
    });

    const gate = runPiecesWarmed(arms, rootOf(['a', 'b']), piecesOf(['a', 'b']), {
      priority: COSMETIC,
      imminent: false,
      submit: rig.submit,
    });
    worker.ready();
    await flush();
    worker.emit({ kind: 'warmed', id: 1, linkMs: 9 });
    worker.emit({ kind: 'warmed', id: 2, linkMs: 9 });

    expect(await gate).toEqual({ failed: true, timedOut: true });
  });

  it('counts a piece the worker could not warm as held, and submits it anyway', async () => {
    // A failed warm is a cold link, not a dropped piece: the gate still runs.
    const worker = armedWorker();
    const { arms } = armsRig({ sources: { a: [dry('ka', 'va')] } });
    const rig = submitRig();

    const gate = runPiecesWarmed(arms, rootOf(['a']), piecesOf(['a']), {
      priority: COSMETIC,
      imminent: false,
      submit: rig.submit,
    });
    worker.ready();
    await flush();
    worker.emit({ kind: 'failed', id: 1, reason: 'link-failed' });

    expect(await gate).toEqual(SETTLED);
    expect(rig.log).toEqual(['assemble@0', 'a@0']);
    expect(shaderWarmSnapshot()).toMatchObject({ held: 1, heldWarm: 0, heldTimedOut: 0 });
  });

  it('submits a piece cold, unheld, when its own assembly unit failed', async () => {
    // The assembly is queue work like any other and can be rejected or cut
    // short; without its sources there is nothing to wait for.
    const worker = armedWorker();
    const { arms } = armsRig({ sources: { a: [dry('ka', 'va')], b: [dry('kb', 'vb')] } });
    const rig = submitRig((entries) =>
      entries[0] === 'assemble@0' ? { failed: true, timedOut: false } : SETTLED,
    );

    const gate = runPiecesWarmed(arms, rootOf(['a', 'b']), piecesOf(['a', 'b']), {
      priority: COSMETIC,
      imminent: false,
      submit: rig.submit,
    });
    worker.ready();
    await flush();
    // The first piece went cold the moment its assembly unit failed.
    expect(rig.log).toEqual(['assemble@0', 'assemble@1', 'a@0']);

    worker.emit({ kind: 'warmed', id: 2, linkMs: 9 });
    // The gate's result is its PIECES': an assembly that failed cost the
    // piece its warm, and nothing else. Failing the gate on it would mark
    // the root unready over work that never linked anything.
    expect(await gate).toEqual(SETTLED);
    expect(rig.log).toEqual(['assemble@0', 'assemble@1', 'a@0', 'b@1']);
    expect(shaderWarmSnapshot()).toMatchObject({ held: 1, heldWarm: 1 });
  });

  it('gives up on the hold cap, submits cold, and ignores the late warm', async () => {
    // The cap is half the reveal watchdog: a piece that gives up still
    // leaves the queue the other half to link it before the hard escape
    // reveals the root unlinked.
    const worker = armedWorker();
    const { arms } = armsRig({ sources: { a: [dry('ka', 'va')] } });
    const rig = submitRig();
    const capped: number[] = [];
    let fire: () => void = () => {};
    let cancels = 0;
    let clock = 1_000;

    const gate = runPiecesWarmed(arms, rootOf(['a']), piecesOf(['a']), {
      priority: COSMETIC,
      imminent: false,
      submit: rig.submit,
      now: () => clock,
      schedule: (callback, ms) => {
        capped.push(ms);
        fire = callback;
        return () => {
          cancels++;
        };
      },
    });
    worker.ready();
    await flush();
    expect(capped).toEqual([SHADER_WARM_HOLD_CAP_MS]);

    clock = 4_500;
    fire();
    expect(await gate).toEqual(SETTLED);
    expect(rig.log).toEqual(['assemble@0', 'a@0']);
    expect(shaderWarmSnapshot()).toMatchObject({
      held: 1,
      heldWarm: 0,
      heldTimedOut: 1,
      holdMs: 3_500,
    });

    // The worker answering after the escape must not submit the piece twice.
    worker.emit({ kind: 'warmed', id: 1, linkMs: 9 });
    await flush();
    expect(rig.log).toEqual(['assemble@0', 'a@0']);
    expect(cancels).toBe(1);
  });

  it('pins the hold cap to half the reveal watchdog', () => {
    expect(SHADER_WARM_HOLD_CAP_MS).toBe(REVEAL_GATE_WATCHDOG_MS / 2);
    expect(SHADER_WARM_HOLD_CAP_MS).toBe(5_000);
  });

  it('submits a piece with no program to warm at once, and says the worker was not the path', async () => {
    // A root the dry compile reports nothing for (an unpatched renderer, or
    // a piece three has already linked) must not wait on a worker that will
    // never answer for it.
    const worker = armedWorker();
    const { arms } = armsRig();
    const rig = submitRig();

    const gate = runPiecesWarmed(arms, rootOf(['a', 'b']), piecesOf(['a', 'b']), {
      priority: COSMETIC,
      imminent: false,
      submit: rig.submit,
    });
    worker.ready();

    expect(await gate).toEqual(SETTLED);
    expect(rig.log).toEqual(['assemble@0', 'assemble@1', 'a@0', 'b@1']);
    expect(worker.askedIds()).toEqual([]);
    expect(shaderWarmSnapshot()).toMatchObject({ held: 0 });
    expect(shaderWarmSnapshot().bypassed['nothing-to-warm']).toBe(1);
  });

  it('says nothing about the worker when at least one piece did use it', async () => {
    const worker = armedWorker();
    const { arms } = armsRig({ sources: { b: [dry('kb', 'vb')] } });
    const rig = submitRig();

    const gate = runPiecesWarmed(arms, rootOf(['a', 'b']), piecesOf(['a', 'b']), {
      priority: COSMETIC,
      imminent: false,
      submit: rig.submit,
    });
    worker.ready();
    await flush();
    // The empty piece went straight to the queue, without waiting.
    expect(rig.log).toEqual(['assemble@0', 'assemble@1', 'a@0']);

    worker.emit({ kind: 'warmed', id: 1, linkMs: 9 });
    await gate;
    expect(rig.log).toEqual(['assemble@0', 'assemble@1', 'a@0', 'b@1']);
    expect(shaderWarmSnapshot().bypassed['nothing-to-warm']).toBe(0);
    expect(shaderWarmSnapshot()).toMatchObject({ held: 1, heldWarm: 1 });
  });

  it('assembles each piece programs once, for the worker and the audit alike', async () => {
    // The audit's announcement rides the same dry pass: a second one would
    // describe a renderer state that has moved on, and cost the announce
    // time twice.
    resetShaderWarmAuditForTest('?perf');
    const worker = armedWorker();
    const { arms, collectCalls } = armsRig({
      sources: { a: [dry('ka', 'va')], b: [dry('kb', 'vb')] },
    });
    const rig = submitRig();

    const gate = runPiecesWarmed(arms, rootOf(['a', 'b']), piecesOf(['a', 'b']), {
      priority: COSMETIC,
      imminent: false,
      submit: rig.submit,
    });
    worker.ready();
    await flush();
    worker.emit({ kind: 'warmed', id: 1, linkMs: 9 });
    worker.emit({ kind: 'warmed', id: 2, linkMs: 9 });
    await gate;

    // One dry pass per piece (one colour target, no shadow arm here).
    expect(collectCalls()).toBe(2);
    expect(shaderWarmAuditSnapshot()).toMatchObject({ expected: 2, dryCompile: true });
  });

  it('records what the dry assembly cost, off the caller own clock', async () => {
    // The assembly is main-thread work the gate pays per piece; a capture
    // divides it out of the hold.
    const worker = armedWorker();
    const { arms } = armsRig({ sources: { a: [dry('ka', 'va')], b: [dry('kb', 'vb')] } });
    const rig = submitRig();
    let ticks = 0;

    const gate = runPiecesWarmed(arms, rootOf(['a', 'b']), piecesOf(['a', 'b']), {
      priority: COSMETIC,
      imminent: false,
      submit: rig.submit,
      // Every reading is one millisecond after the last: an assembly is one.
      now: () => ticks++,
    });
    worker.ready();
    await flush();
    worker.emit({ kind: 'warmed', id: 1, linkMs: 9 });
    worker.emit({ kind: 'warmed', id: 2, linkMs: 9 });
    await gate;

    expect(shaderWarmSnapshot().dryAssembleMs).toBe(2);
  });
});
