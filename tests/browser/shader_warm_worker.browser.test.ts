// The shader warm worker on a real browser: spawned as the client spawns it,
// handed a real game context's contract, it links and resolves the exact
// sources the dry compile produced, and the main context then links those
// programs under the same keys. Also the refusal on an extension set the
// worker cannot reproduce, and the client end to end through a gate.

import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CompileArmHost } from '../../src/render/compile_arms';
import type { CompileGatePiece } from '../../src/render/compile_gate';
import type { DryCompileRenderer } from '../../src/render/program_sources';
import { enableRendererExtensions } from '../../src/render/renderer_extensions';
import {
  armShaderWarm,
  resetShaderWarmForTest,
  shaderWarmSnapshot,
  warmShaderPrograms,
} from '../../src/render/shader_warm_client';
import { runPiecesWarmed } from '../../src/render/shader_warm_gate';
import type { ShaderWarmWorkerMessage } from '../../src/render/shader_warm_protocol';

type PatchedRenderer = THREE.WebGLRenderer & Required<DryCompileRenderer>;

let renderer: PatchedRenderer;
const workers: Worker[] = [];

function spawnWorker(): Worker {
  const worker = new Worker(new URL('../../src/render/shader_warm_worker.ts', import.meta.url), {
    type: 'module',
  });
  workers.push(worker);
  return worker;
}

beforeEach(() => {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  renderer = new THREE.WebGLRenderer({ canvas, antialias: false }) as PatchedRenderer;
  resetShaderWarmForTest({ search: '?shaderwarm=all', spawn: () => spawnWorker() });
});

afterEach(() => {
  resetShaderWarmForTest();
  for (const worker of workers.splice(0)) worker.terminate();
  renderer.dispose();
});

function scene(): { scene: THREE.Scene; camera: THREE.PerspectiveCamera; root: THREE.Group } {
  const world = new THREE.Scene();
  world.add(new THREE.DirectionalLight(0xffffff, 1));
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 500);
  const root = new THREE.Group();
  root.add(
    new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial({ color: 0x8a7f70 })),
    new THREE.Mesh(new THREE.SphereGeometry(1, 8, 8), new THREE.MeshLambertMaterial()),
  );
  world.add(root);
  return { scene: world, camera, root };
}

function messages(worker: Worker, until: (message: ShaderWarmWorkerMessage) => boolean) {
  return new Promise<ShaderWarmWorkerMessage[]>((resolve, reject) => {
    const seen: ShaderWarmWorkerMessage[] = [];
    const timeout = setTimeout(
      () => reject(new Error(`worker silent: ${JSON.stringify(seen)}`)),
      20000,
    );
    worker.onmessage = (event: MessageEvent<ShaderWarmWorkerMessage>) => {
      seen.push(event.data);
      if (until(event.data)) {
        clearTimeout(timeout);
        resolve(seen);
      }
    };
  });
}

describe('the shader warm worker, raw', () => {
  it('reproduces the game context, links the dry sources, and the main link follows under the same keys', async () => {
    const gl = renderer.getContext();
    const sweep = enableRendererExtensions(gl);
    const { scene: world, camera, root } = scene();
    const dry = renderer.collectProgramSources(root, camera, world);
    expect(dry.length).toBeGreaterThanOrEqual(2);
    const worker = spawnWorker();
    const ready = messages(worker, (m) => m.kind === 'ready');
    worker.postMessage({
      kind: 'init',
      contextAttributes: gl.getContextAttributes(),
      extensions: sweep.enabled,
      maxWindow: 2,
    });
    const [readyMessage] = await ready;
    expect(
      readyMessage,
      `worker: ${JSON.stringify(readyMessage)} main: ${JSON.stringify(sweep.enabled)}`,
    ).toMatchObject({ kind: 'ready', ok: true, reason: null });
    const ids = dry.map((_entry, i) => i + 1);
    const done = messages(
      worker,
      (m) => (m.kind === 'warmed' || m.kind === 'failed') && m.id === ids[ids.length - 1],
    );
    worker.postMessage({
      kind: 'warm',
      sources: dry.map((entry, i) => ({
        id: ids[i],
        vertex: entry.vertexGlsl,
        fragment: entry.fragmentGlsl,
        index0Attribute: entry.index0Attribute,
        priority: 20,
      })),
    });
    const seen = await done;
    const warmed = seen.filter((m) => m.kind === 'warmed');
    expect(warmed.map((m) => (m as { id: number }).id).sort((a, b) => a - b)).toEqual(ids);
    expect(seen.some((m) => m.kind === 'failed')).toBe(false);
    // The main context links the same programs: the keys the dry pass named.
    // This is protocol and key-identity coverage (a headless Chromium, often
    // on a software rasterizer): that the warm made the link a browser-cache
    // HIT is the hardware measurement's claim, not this test's.
    const before = new Set((renderer.info.programs ?? []).map((p) => p.cacheKey));
    await renderer.compileAsync(root, camera, world);
    const linked = (renderer.info.programs ?? []).filter((p) => !before.has(p.cacheKey));
    expect(linked.map((p) => p.cacheKey).sort()).toEqual(dry.map((e) => e.cacheKey).sort());
  });

  it('refuses an extension set it cannot reproduce', async () => {
    const worker = spawnWorker();
    const ready = messages(worker, (m) => m.kind === 'ready');
    worker.postMessage({
      kind: 'init',
      contextAttributes: null,
      extensions: ['NOT_A_REAL_EXTENSION'],
      maxWindow: 2,
    });
    const [readyMessage] = await ready;
    expect(readyMessage).toMatchObject({ kind: 'ready', ok: false, reason: 'extension-mismatch' });
  });
});

describe('the client through a gate', () => {
  it('holds a piece until its programs are warm, then submits it, and the link is announced warm', async () => {
    const { scene: world, camera, root } = scene();
    const arms: CompileArmHost = {
      webgl: () => renderer,
      context: () => renderer.getContext(),
      camera: () => camera,
      scene: () => world,
      shadowCamera: () => camera,
      offscreen: () => false,
      offscreenTarget: () => new THREE.WebGLRenderTarget(8, 8),
      depthMaterials: () => new Map(),
      shadowArm: () => false,
    };
    armShaderWarm();
    const dry = renderer.collectProgramSources(root, camera, world);
    expect(dry.length).toBeGreaterThanOrEqual(2);
    // The first policy call spawns the worker; it answers ready asynchronously,
    // and the requests wait for it. Each piece's real link runs in submit.
    const submitted: number[] = [];
    const pieces: CompileGatePiece[] = root.children.map((child, i) => async () => {
      submitted.push(i);
      await renderer.compileAsync(child, camera, world);
    });
    const result = await runPiecesWarmed(arms, root, pieces, {
      priority: 20,
      imminent: false,
      submit: async (some) => {
        for (const piece of some) await piece({ fired: false });
        return { failed: false, timedOut: false };
      },
    });
    expect(result).toEqual({ failed: false, timedOut: false });
    expect(submitted.sort()).toEqual([0, 1]);
    const snapshot = shaderWarmSnapshot();
    expect(snapshot.worker).toBe('ready');
    expect(snapshot.held).toBe(2);
    expect(snapshot.heldWarm).toBe(2);
    expect(snapshot.heldTimedOut).toBe(0);
    expect(snapshot.warmed).toBe(dry.length);
    // Everything the pieces linked is linked now: nothing left to collect.
    expect(renderer.collectProgramSources(root, camera, world)).toEqual([]);
    // Asking again for the same text is answered without the worker.
    const again = await warmShaderPrograms(
      dry.map((entry) => ({
        vertex: entry.vertexGlsl,
        fragment: entry.fragmentGlsl,
        index0Attribute: entry.index0Attribute,
      })),
      20,
    );
    expect(again.every((outcome) => outcome === 'warmed')).toBe(true);
    expect(shaderWarmSnapshot().deduped).toBe(dry.length);
    expect(shaderWarmSnapshot().sent).toBe(dry.length);
  });
});
