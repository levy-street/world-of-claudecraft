// A WebGL context loss and restore, simulated in Node against the real
// restore host (src/render/context_restore.ts), the real GPU queue and the real
// hold, with a stand-in renderer surface: the queue pauses on the loss and
// resumes on the restore, every registered record is reset, the world draw is
// held (under the arrival cover) while the visible set links and at most for
// the bound, and the rest resumes as debt afterwards, in order.
import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBackgroundGpuQueue, GPU_WORK_PRIORITY } from '../src/render/background_gpu_queue';
import { ContextRestoreHost, type ContextRestoreSurface } from '../src/render/context_restore';
import { CONTEXT_RESTORE_HOLD_MAX_MS } from '../src/render/context_restore_core';
import {
  contextRestoreDrawHeld,
  contextRestorePacingActive,
  resetContextRestoreHoldForTest,
} from '../src/render/context_restore_hold';
import { resetContextRestoreRegistriesForTest } from '../src/render/context_restore_registry';
import { gpuPrepEventsSnapshot, resetGpuPrepEventsForTest } from '../src/render/gpu_prep_events';
import type { PrewarmResumeUnit } from '../src/render/prewarm_resume';
import { RENDERER_CONTEXT_EXTENSIONS } from '../src/render/renderer_extensions';

afterEach(() => {
  resetContextRestoreHoldForTest();
  resetGpuPrepEventsForTest();
  resetContextRestoreRegistriesForTest();
});

const flush = async (rounds = 20): Promise<void> => {
  for (let i = 0; i < rounds; i++) await Promise.resolve();
};

interface Harness {
  host: ContextRestoreHost;
  surface: ContextRestoreSurface;
  canvas: EventTarget;
  queue: ReturnType<typeof createBackgroundGpuQueue>;
  compiled: string[];
  cover: boolean[];
  fireBound: () => void;
  zones: Set<string>[];
  castUnit: ReturnType<typeof vi.fn>;
  observe: ReturnType<typeof vi.fn>;
  prewarmZone: ReturnType<typeof vi.fn>;
  presentation: ReturnType<typeof vi.fn>;
  shadowMap: { needsUpdate: boolean };
  releaseLinks: () => void;
  compiledAtDebtStart: string[][];
  boundMs: number[];
  extensionAsks: string[];
}

function mesh(name: string, visible: boolean): THREE.Mesh {
  const out = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
  out.name = name;
  out.visible = visible;
  // Distinct programs, so the program-content dedupe keeps every root.
  (out.material as THREE.MeshBasicMaterial).vertexColors = name.endsWith('b');
  if (name.startsWith('far')) (out.material as THREE.MeshBasicMaterial).fog = false;
  return out;
}

function harness(opts: { holdLinks?: boolean; shutdown?: boolean } = {}): Harness {
  const canvas = new EventTarget();
  const queue = createBackgroundGpuQueue();
  const scene = new THREE.Scene();
  scene.add(mesh('near-a', true), mesh('near-b', true), mesh('far-hidden', false));
  const compiled: string[] = [];
  const cover: boolean[] = [];
  let bound: (() => void) | null = null;
  let releaseLinks: () => void = () => {};
  const linksHeld = opts.holdLinks
    ? new Promise<void>((resolve) => {
        releaseLinks = resolve;
      })
    : Promise.resolve();
  const zones = [new Set(['vale']), new Set(['boar']), new Set(['guard'])];
  const compiledAtDebtStart: string[][] = [];
  const castUnit = vi.fn(() => {
    compiledAtDebtStart.push([...compiled]);
  });
  const boundMs: number[] = [];
  const extensionAsks: string[] = [];
  const observe = vi.fn();
  const prewarmZone = vi.fn(() => Promise.resolve());
  const presentation = vi.fn(() => true);
  const shadowMap = { needsUpdate: false };
  const webgl = {
    domElement: canvas,
    properties: { get: () => ({}) },
    shadowMap,
    extensions: { has: () => false, get: () => null },
    getContext: () => ({
      getExtension: (name: string) => {
        extensionAsks.push(name);
        return null;
      },
    }),
  } as unknown as THREE.WebGLRenderer;
  const surface: ContextRestoreSurface = {
    webgl: () => webgl,
    queue,
    isShutdown: () => opts.shutdown === true,
    rebindContextReaders: () => {},
    scene: () => scene,
    player: () => ({ x: 0, z: 0 }),
    arms: null,
    compileColor: async (root) => {
      await linksHeld;
      compiled.push(root.name);
    },
    compileShadow: async () => {},
    tail: () => ({
      settle: async () => ({ settled: true, programs: 0 }),
      touch: async () => 0,
      timeoutMs: 1,
    }),
    textureInFlight: new WeakMap(),
    compileBatchRoots: 1,
    zoneProgramRecords: () => zones,
    prewarmZone,
    presentationPrewarm: presentation,
    castVfxUnits: (): PrewarmResumeUnit[] => [{ id: 'program:cast', run: castUnit }],
    selfSpirit: () => ({ observe }),
    environment: () => null,
  };
  const host = new ContextRestoreHost(surface, {
    schedule: (callback, ms) => {
      boundMs.push(ms);
      bound = callback;
      return () => {
        bound = null;
      };
    },
    setArrivalCover: (active) => cover.push(active),
  });
  return {
    host,
    surface,
    canvas,
    queue,
    compiled,
    cover,
    fireBound: () => bound?.(),
    zones,
    castUnit,
    observe,
    prewarmZone,
    presentation,
    shadowMap,
    releaseLinks: () => releaseLinks(),
    compiledAtDebtStart,
    boundMs,
    extensionAsks,
  };
}

const lose = (h: Harness): void => {
  h.canvas.dispatchEvent(new Event('webglcontextlost'));
};
const restore = (h: Harness): void => {
  h.canvas.dispatchEvent(new Event('webglcontextrestored'));
};

describe('an in-place context loss and restore', () => {
  it('pauses the GPU queue on the loss and resumes it on the restore', async () => {
    const h = harness();
    lose(h);
    expect(h.queue.isPaused()).toBe(true);
    const ran = vi.fn();
    const pending = h.queue.run(ran, GPU_WORK_PRIORITY.ACTIONABLE_VIEW, 'live-gate:test');
    await flush();
    // Nothing starts on a dead context, not even the actionable floor.
    expect(ran).not.toHaveBeenCalled();
    restore(h);
    expect(h.queue.isPaused()).toBe(false);
    await pending;
    expect(ran).toHaveBeenCalledTimes(1);
    h.host.dispose();
  });

  it('resets the records, holds the world draw under the cover while the visible set links, then resumes the rest as debt in order', async () => {
    const h = harness({ holdLinks: true });
    lose(h);
    restore(h);
    // The pinned extension sweep ran again on the restored context, whole.
    expect(h.extensionAsks).toEqual(RENDERER_CONTEXT_EXTENSIONS);
    // The hold is armed for exactly the bound.
    expect(h.boundMs).toHaveLength(1);
    expect(h.boundMs[0]).toBeLessThanOrEqual(CONTEXT_RESTORE_HOLD_MAX_MS);
    expect(h.boundMs[0]).toBeGreaterThan(CONTEXT_RESTORE_HOLD_MAX_MS - 100);
    // The registered records are cleared before anything prepares again.
    expect(h.zones.every((set) => set.size === 0)).toBe(true);
    expect(h.observe).toHaveBeenCalledTimes(1);
    expect(h.shadowMap.needsUpdate).toBe(true);
    // The hold and the cover stand while the visible set is still linking.
    expect(contextRestoreDrawHeld()).toBe(true);
    expect(h.cover).toEqual([true]);
    // The cover it raised is paced for as long as it stands.
    expect(contextRestorePacingActive()).toBe(true);
    await flush(60);
    expect(h.presentation).toHaveBeenCalledTimes(1);
    expect(contextRestoreDrawHeld()).toBe(true);
    // Nothing of the debt runs under the hold.
    expect(h.castUnit).not.toHaveBeenCalled();
    expect(h.prewarmZone).not.toHaveBeenCalled();
    h.releaseLinks();
    await vi.waitFor(() => expect(contextRestoreDrawHeld()).toBe(false));
    expect(h.cover).toEqual([true, false]);
    expect(contextRestorePacingActive()).toBe(false);
    // The hold linked the VISIBLE roots only; the hidden one waited for the debt.
    await vi.waitFor(() => expect(h.compiledAtDebtStart).toHaveLength(1));
    expect([...h.compiledAtDebtStart[0]].sort()).toEqual(['near-a', 'near-b']);
    const events = gpuPrepEventsSnapshot().events.filter((e) => e.kind === 'context-restore');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ key: 'settled' });
    expect(events[0].totalRoots).toBeGreaterThan(0);
    expect(events[0].readyRoots).toBe(events[0].totalRoots);
    // Then the debt: the cast families first, the zone archetypes, the rest.
    await vi.waitFor(() => expect(h.compiled).toContain('far-hidden'));
    expect(h.castUnit).toHaveBeenCalledTimes(1);
    expect(h.prewarmZone).toHaveBeenCalledWith(0, 0);
    expect(h.castUnit.mock.invocationCallOrder[0]).toBeLessThan(
      h.prewarmZone.mock.invocationCallOrder[0],
    );
    expect(h.host.snapshot().phase).toBe('live');
    h.host.dispose();
  });

  it('never holds past the bound: a link that never settles ends the hold on the deadline', async () => {
    const h = harness({ holdLinks: true });
    lose(h);
    restore(h);
    await flush(60);
    expect(contextRestoreDrawHeld()).toBe(true);
    h.fireBound();
    await vi.waitFor(() => expect(contextRestoreDrawHeld()).toBe(false));
    expect(h.cover).toEqual([true, false]);
    const event = gpuPrepEventsSnapshot().events.find((e) => e.kind === 'context-restore');
    expect(event?.key).toBe('bound');
    expect(event?.readyRoots).toBeLessThan(event?.totalRoots ?? 0);
    // The hold module's own deadline backs the timer up: even a release that
    // never ran cannot withhold the world past the bound.
    h.host.dispose();
    resetContextRestoreHoldForTest();
    const { beginContextRestoreHold } = await import('../src/render/context_restore_hold');
    beginContextRestoreHold(CONTEXT_RESTORE_HOLD_MAX_MS, 1000);
    expect(contextRestoreDrawHeld(1000 + CONTEXT_RESTORE_HOLD_MAX_MS - 1)).toBe(true);
    expect(contextRestoreDrawHeld(1000 + CONTEXT_RESTORE_HOLD_MAX_MS)).toBe(false);
  });

  it('a second loss during the hold releases it and cancels the pass', async () => {
    const h = harness({ holdLinks: true });
    lose(h);
    restore(h);
    // Lost again before the queue even started the pass's units.
    lose(h);
    expect(contextRestoreDrawHeld()).toBe(false);
    expect(h.cover).toEqual([true, false]);
    expect(h.queue.isPaused()).toBe(true);
    expect(h.host.snapshot().lastHold?.end).toBe('cancelled');
    expect(
      gpuPrepEventsSnapshot()
        .events.filter((e) => e.kind === 'context-restore')
        .map((e) => e.key),
    ).toEqual(['cancelled']);
    // The cancelled pass never schedules its debt, even once its links land,
    // and the units it left queued are skipped rather than run.
    const presentations = h.presentation.mock.calls.length;
    h.queue.setPaused(false);
    h.releaseLinks();
    await flush(200);
    expect(h.castUnit).not.toHaveBeenCalled();
    expect(h.presentation.mock.calls.length).toBe(presentations);
    expect(h.prewarmZone).not.toHaveBeenCalled();
    h.host.dispose();
  });

  it('dispose stops listening and releases whatever it held', async () => {
    const h = harness({ holdLinks: true });
    lose(h);
    restore(h);
    expect(contextRestoreDrawHeld()).toBe(true);
    h.host.dispose();
    expect(contextRestoreDrawHeld()).toBe(false);
    expect(h.cover).toEqual([true, false]);
    lose(h);
    expect(h.queue.isPaused()).toBe(false);
  });

  it('a restore that lands after the renderer began shutting down does nothing', () => {
    const h = harness({ shutdown: true });
    lose(h);
    restore(h);
    expect(contextRestoreDrawHeld()).toBe(false);
    expect(h.cover).toEqual([]);
    expect(h.zones.every((set) => set.size === 1)).toBe(true);
    expect(h.host.snapshot().restores).toBe(0);
    h.host.dispose();
  });
});
