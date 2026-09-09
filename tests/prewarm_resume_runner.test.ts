// How the post-entry resume lane runs one unit
// (src/render/prewarm_resume_runner.ts): the debt or cosmetic priority, the
// held or released tail, the per-root pieces of a debt batch, the compile
// lifecycle transitions, and the shader warm worker ahead of every root's
// link. The queue order is the whole subject here: a warm that landed after
// its link, or a tail released on a debt batch, is the hitch this module was
// extracted to keep fixed.

import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import { GPU_WORK_PRIORITY } from '../src/render/background_gpu_queue';
import { type CompileArmHost, setCompileArmObserver } from '../src/render/compile_arms';
import { createPrewarmCompileLifecycle } from '../src/render/prewarm_compile_lifecycle';
import {
  buildPrewarmCompileUnits,
  type PrewarmResumeEntry,
  type PrewarmResumeUnit,
} from '../src/render/prewarm_resume';
import { resumeWarmLabel, runResumeUnit } from '../src/render/prewarm_resume_runner';
import type { DryProgramSource } from '../src/render/program_sources';
import { resetShaderWarmAuditForTest } from '../src/render/shader_warm_audit';
import {
  armShaderWarm,
  resetShaderWarmForTest,
  shaderWarmSnapshot,
} from '../src/render/shader_warm_client';
import type { ShaderWarmWorkerMessage } from '../src/render/shader_warm_protocol';

afterEach(() => {
  resetShaderWarmForTest();
  resetShaderWarmAuditForTest();
  setCompileArmObserver(null);
});

/** A debt entry that is not a compile one, so the lifecycle path stays out
 *  of the cases that are about the queue order. */
const DEBT = 'textures.scene';
const COSMETIC = 'foliage.preview';

function rootNamed(name: string): THREE.Group {
  const group = new THREE.Group();
  group.name = name;
  group.add(new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial()));
  return group;
}

function dry(cacheKey: string): DryProgramSource {
  return {
    cacheKey,
    name: 'physical',
    vertexGlsl: `vertex:${cacheKey}`,
    fragmentGlsl: 'precision highp float;',
    index0Attribute: 'position',
  };
}

/** Compile arms whose dry compile serves one program per root, named after
 *  the root, so a case can say WHICH roots were warmed. */
function armsRig() {
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
      return [dry(`key:${root.name}`)];
    },
  };
  const arms: CompileArmHost = {
    webgl: () => webgl,
    context: () => ({
      getContextAttributes: () => ({ antialias: false }),
      getExtension: (name: string) => (name === 'KHR_parallel_shader_compile' ? { name } : null),
    }),
    camera: () => new THREE.PerspectiveCamera(),
    scene: () => scene,
    shadowCamera: () => new THREE.OrthographicCamera(),
    offscreen: () => false,
    offscreenTarget: () => ({}) as THREE.WebGLRenderTarget,
    depthMaterials: () => new Map(),
    shadowArm: () => false,
  };
  return { arms, assembled };
}

interface WarmWorkerStub {
  postMessage(message: unknown): void;
  terminate(): void;
  onmessage: ((event: MessageEvent<ShaderWarmWorkerMessage>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  emit(message: ShaderWarmWorkerMessage): void;
}

/** Comes up at once and answers every program warm as it arrives, so the
 *  lane's own sequencing is what a case reads. */
function autoWorker(): WarmWorkerStub {
  const worker: WarmWorkerStub = {
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
        worker.emit({ kind: 'warmed', id: source.id, linkMs: 4 });
      }
    },
    emit(message) {
      worker.onmessage?.({ data: message } as MessageEvent<ShaderWarmWorkerMessage>);
    },
  };
  return worker;
}

function armedClient(): WarmWorkerStub {
  const worker = autoWorker();
  resetShaderWarmForTest({
    search: '?shaderwarm=reveal',
    mobile: false,
    spawn: () => worker,
    schedule: () => () => {},
  });
  armShaderWarm();
  return worker;
}

interface QueueCall {
  label: string;
  priority: number;
  releaseTail: boolean | undefined;
}

/** The GPU queue and the ledger share one event log, so "before any queue
 *  work" is a position in it rather than a second assertion. */
function runnerRig(options: { arms?: CompileArmHost | null } = {}) {
  const calls: QueueCall[] = [];
  const events: string[] = [];
  const lifecycle = createPrewarmCompileLifecycle(() => events.length + 1);
  const deps = {
    queue: {
      run<T>(
        work: () => T | Promise<T>,
        priority: number,
        label: string,
        runOptions?: { releaseTail?: boolean },
      ): Promise<T> {
        calls.push({ label, priority, releaseTail: runOptions?.releaseTail });
        events.push(`queue:${label}`);
        return Promise.resolve().then(work);
      },
    },
    ledger: {
      noteStart(entryId: string): void {
        events.push(`start:${entryId}`);
      },
    },
    lifecycle,
    arms: options.arms === undefined ? armsRig().arms : options.arms,
  };
  return {
    deps,
    calls,
    events,
    lifecycle,
    labels: () => calls.map((call) => call.label),
  };
}

function entryOf(id: string, units: PrewarmResumeUnit[]): PrewarmResumeEntry {
  return { id, units };
}

describe('runResumeUnit debt pieces', () => {
  it('warms each piece root, then runs that piece as its own released-tail unit', async () => {
    // One root per queue unit with the tail RELEASED: a held root blocked the
    // queue head for its whole link wait behind the driver's queue, and the
    // reveals of the decor the camera stands in waited behind it.
    armedClient();
    const { arms, assembled } = armsRig();
    const rig = runnerRig({ arms });
    const ran: string[] = [];
    const unit: PrewarmResumeUnit = {
      id: 'scene:0',
      run: async () => {
        ran.push('batch');
      },
      pieces: [
        { id: 'scene:0:0', root: rootNamed('a'), run: async () => void ran.push('a') },
        { id: 'scene:0:1', root: rootNamed('b'), run: async () => void ran.push('b') },
      ],
    };

    await runResumeUnit(unit, entryOf(DEBT, [unit]), rig.deps);

    expect(rig.labels()).toEqual([
      'resume-warm:scene:0',
      'resume-warm:scene:0',
      'scene:0:0',
      'scene:0:1',
    ]);
    expect(rig.calls.map((call) => call.priority)).toEqual([15, 15, 15, 15]);
    expect(rig.calls.map((call) => call.releaseTail)).toEqual([undefined, undefined, true, true]);
    // The batch's own run is not used when it was cut into pieces.
    expect(ran).toEqual(['a', 'b']);
    expect(assembled).toEqual(['a', 'b']);
    expect(shaderWarmSnapshot()).toMatchObject({ held: 2, heldWarm: 2 });
  });

  it('labels the warm units under a kind of their own', () => {
    // The budget learns per kind (the label up to the first colon): a warm
    // under the piece's own kind would blend the dry assembly's cost into
    // the link's EMA and predict neither. A kind with no history costs the
    // budget one first-sample admission, once.
    expect(resumeWarmLabel('scene:0:3')).toBe('resume-warm:scene:0:3');
  });

  it('warms every piece root before the first link, so the worker paces the set', async () => {
    armedClient();
    const { arms } = armsRig();
    const rig = runnerRig({ arms });
    const unit: PrewarmResumeUnit = {
      id: 'scene:1',
      run: async () => {},
      pieces: [
        { id: 'scene:1:0', root: rootNamed('a'), run: async () => {} },
        { id: 'scene:1:1', root: rootNamed('b'), run: async () => {} },
      ],
    };

    await runResumeUnit(unit, entryOf(DEBT, [unit]), rig.deps);

    // Asked one by one between links, the worker would see one program at a
    // time and every piece would pay its own hold in series.
    expect(rig.events).toEqual([
      `start:${DEBT}`,
      'queue:resume-warm:scene:1',
      'queue:resume-warm:scene:1',
      'queue:scene:1:0',
      'queue:scene:1:1',
    ]);
  });

  it('carries the root each piece links, so the warm is that root own', async () => {
    // buildPrewarmCompileUnits is what mints the pieces; the runner warms
    // `piece.root`, so a piece that lost its root would link cold in silence.
    armedClient();
    const { arms, assembled } = armsRig();
    const rig = runnerRig({ arms });
    const roots = [rootNamed('first'), rootNamed('second')];
    const compiled: string[] = [];
    const units = buildPrewarmCompileUnits<THREE.Object3D>(
      [{ id: 'scene', roots }],
      (root) => {
        compiled.push(root.name);
      },
      { batchSize: 2 },
    );

    expect(units).toHaveLength(1);
    const pieces = units[0].pieces ?? [];
    expect(pieces).toHaveLength(2);
    expect(pieces[0].root).toBe(roots[0]);
    expect(pieces[1].root).toBe(roots[1]);

    await runResumeUnit(units[0], entryOf(DEBT, units), rig.deps);

    expect(assembled).toEqual(['first', 'second']);
    expect(compiled).toEqual(['first', 'second']);
    expect(rig.labels()).toEqual([
      'resume-warm:scene:0',
      'resume-warm:scene:0',
      'scene:0:0',
      'scene:0:1',
    ]);
  });
});

describe('runResumeUnit whole units', () => {
  it('warms every root of a debt batch, then runs the batch with its tail HELD', async () => {
    // Released, a batch's 16 to 32 links piled into the driver at once
    // (sub-1-fps for a minute with a dropped manifest).
    armedClient();
    const { arms, assembled } = armsRig();
    const rig = runnerRig({ arms });
    const unit: PrewarmResumeUnit = {
      id: 'textures.scene:0',
      run: async () => {},
      roots: [rootNamed('a'), rootNamed('b')],
    };

    await runResumeUnit(unit, entryOf(DEBT, [unit]), rig.deps);

    expect(rig.labels()).toEqual([
      'resume-warm:textures.scene:0',
      'resume-warm:textures.scene:0',
      'textures.scene:0',
    ]);
    expect(rig.calls.map((call) => call.priority)).toEqual([
      GPU_WORK_PRIORITY.BOOT_DEBT,
      GPU_WORK_PRIORITY.BOOT_DEBT,
      GPU_WORK_PRIORITY.BOOT_DEBT,
    ]);
    expect(rig.calls.at(-1)?.releaseTail).toBe(false);
    expect(assembled).toEqual(['a', 'b']);
  });

  it('runs a cosmetic entry at BOOT_RESUME with its tail released', async () => {
    // The cosmetic resume is not debt: it sits under the preview lane, and a
    // held 16-root unit blocked live compile gates for seconds (travel
    // hitches).
    armedClient();
    const { arms } = armsRig();
    const rig = runnerRig({ arms });
    const unit: PrewarmResumeUnit = {
      id: 'foliage.preview:0',
      run: async () => {},
      roots: [rootNamed('a')],
    };

    await runResumeUnit(unit, entryOf(COSMETIC, [unit]), rig.deps);

    expect(rig.labels()).toEqual(['resume-warm:foliage.preview:0', 'foliage.preview:0']);
    expect(rig.calls.map((call) => call.priority)).toEqual([
      GPU_WORK_PRIORITY.BOOT_RESUME,
      GPU_WORK_PRIORITY.BOOT_RESUME,
    ]);
    expect(rig.calls.at(-1)?.releaseTail).toBe(true);
  });

  it('runs a unit with no root at all, warming nothing', async () => {
    armedClient();
    const { arms, assembled } = armsRig();
    const rig = runnerRig({ arms });
    const unit: PrewarmResumeUnit = { id: 'textures.scene:9', run: async () => {} };

    await runResumeUnit(unit, entryOf(DEBT, [unit]), rig.deps);

    expect(rig.labels()).toEqual(['textures.scene:9']);
    expect(assembled).toEqual([]);
  });

  it('notes the entry start once, before any queue work', async () => {
    // The ledger's start is what the readout attributes the lane's time to;
    // noted per unit run, and before the unit reaches the queue.
    armedClient();
    const { arms } = armsRig();
    const rig = runnerRig({ arms });
    const unit: PrewarmResumeUnit = {
      id: 'textures.scene:0',
      run: async () => {},
      roots: [rootNamed('a')],
    };

    await runResumeUnit(unit, entryOf(DEBT, [unit]), rig.deps);

    expect(rig.events.filter((event) => event.startsWith('start:'))).toEqual([`start:${DEBT}`]);
    expect(rig.events[0]).toBe(`start:${DEBT}`);
  });

  it('skips every warm when the renderer has no arms bound', async () => {
    // A renderer that never bound its arms (a stub host, a graphics rebuild
    // in flight) must run the lane exactly as it did before the worker.
    armedClient();
    const rig = runnerRig({ arms: null });
    const unit: PrewarmResumeUnit = {
      id: 'textures.scene:0',
      run: async () => {},
      roots: [rootNamed('a')],
      pieces: [{ id: 'textures.scene:0:0', root: rootNamed('b'), run: async () => {} }],
    };

    const batch: PrewarmResumeUnit = {
      id: 'textures.scene:1',
      run: async () => {},
      roots: [rootNamed('c')],
    };

    await runResumeUnit(unit, entryOf(DEBT, [unit]), rig.deps);
    await runResumeUnit(batch, entryOf(DEBT, [batch]), rig.deps);

    // Neither the per-piece arm nor the batch arm asked the worker anything.
    expect(rig.labels()).toEqual(['textures.scene:0:0', 'textures.scene:1']);
    expect(shaderWarmSnapshot()).toMatchObject({ asked: 0, held: 0 });
  });
});

describe('runResumeUnit compile lifecycle', () => {
  it('keeps a deferred compile record live: submitted then settled on the resume lane', async () => {
    // Without these transitions the unit stays submittedAtMs=null forever, so
    // admission keeps seeing compile debt and the detail horizon never
    // advances.
    armedClient();
    const { arms } = armsRig();
    const rig = runnerRig({ arms });
    const unit: PrewarmResumeUnit = { id: 'scene:deferred', run: async () => {} };
    const record = rig.lifecycle.recordFor(unit, 'programs.compile-submit');

    await runResumeUnit(unit, entryOf('programs.compile-submit', [unit]), rig.deps);

    expect(record.lane).toBe('programs.compile-resume');
    expect(record.submittedAtMs).not.toBeNull();
    expect(record.settledAtMs).not.toBeNull();
    expect(record.failedAtMs).toBeNull();
    expect(rig.labels()).toEqual(['scene:deferred']);
  });

  it('opens the compile record after the warm, so the hold is never counted as link time', async () => {
    // The record's submitted-to-settled span is what the capture reads as
    // the compile stage; the worker's hold is a stage of its own (the warm
    // readout), and folding it in would make off/reveal captures compare
    // different things.
    armedClient();
    const { arms } = armsRig();
    const rig = runnerRig({ arms });
    const unit: PrewarmResumeUnit = {
      id: 'scene:warmed',
      run: async () => {},
      roots: [rootNamed('a')],
    };
    const record = rig.lifecycle.recordFor(unit, 'programs.compile-submit');

    await runResumeUnit(unit, entryOf('programs.compile-submit', [unit]), rig.deps);

    // The lifecycle clock is the event count: the warm unit's event is
    // already in the list when the record is marked submitted.
    expect(rig.events).toEqual([
      'start:programs.compile-submit',
      'queue:resume-warm:scene:warmed',
      'queue:scene:warmed',
    ]);
    expect(record.submittedAtMs).toBe(3);
    expect(record.settledAtMs).toBe(4);
  });

  it('marks the record failed and rethrows when the unit fails', async () => {
    armedClient();
    const { arms } = armsRig();
    const rig = runnerRig({ arms });
    const unit: PrewarmResumeUnit = {
      id: 'scene:failing',
      run: async () => {
        throw new Error('resume failed');
      },
    };
    const record = rig.lifecycle.recordFor(unit, 'programs.compile');

    await expect(
      runResumeUnit(unit, entryOf('programs.compile', [unit]), rig.deps),
    ).rejects.toThrow('resume failed');

    expect(record.submittedAtMs).not.toBeNull();
    expect(record.settledAtMs).toBeNull();
    expect(record.failedAtMs).not.toBeNull();
  });

  it('leaves a non-compile entry out of the lifecycle entirely', async () => {
    // Only the compile entries carry a record; opening one for a texture
    // entry would put a unit in the capture that has no compile history.
    armedClient();
    const { arms } = armsRig();
    const rig = runnerRig({ arms });
    const unit: PrewarmResumeUnit = { id: 'textures.scene:0', run: async () => {} };

    await runResumeUnit(unit, entryOf(DEBT, [unit]), rig.deps);

    expect(rig.lifecycle.records).toEqual([]);
  });
});
