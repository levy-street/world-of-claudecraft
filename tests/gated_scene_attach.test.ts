import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { attachSceneGroupGated, GATED_ATTACH_WATCHDOG_MS } from '../src/render/gated_scene_attach';
import {
  gpuPrepEventsSnapshot,
  resetGpuPrepEventsForTest,
  setGpuPrepClockForTest,
} from '../src/render/gpu_prep_events';

beforeEach(() => {
  resetGpuPrepEventsForTest();
});

afterEach(() => {
  setGpuPrepClockForTest(null);
  resetGpuPrepEventsForTest();
});

const fakeScene = () => {
  const added: THREE.Object3D[] = [];
  return { added, add: (o: THREE.Object3D) => added.push(o) };
};

describe('attachSceneGroupGated', () => {
  it('attaches immediately and visible when no gate is supplied', async () => {
    const scene = fakeScene();
    const group = new THREE.Group();
    await attachSceneGroupGated(scene, group);
    expect(scene.added).toEqual([group]);
    expect(group.visible).toBe(true);
  });

  it('hides the group while the gate compiles, then reveals it', async () => {
    const scene = fakeScene();
    const group = new THREE.Group();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const pending = attachSceneGroupGated(scene, group, () => gate);
    expect(scene.added).toEqual([group]);
    expect(group.visible).toBe(false);
    release();
    await pending;
    expect(group.visible).toBe(true);
  });

  it('still reveals the group when the gate rejects (fail-soft first draw)', async () => {
    const scene = fakeScene();
    const group = new THREE.Group();
    await attachSceneGroupGated(scene, group, () => Promise.reject(new Error('shutdown')));
    expect(group.visible).toBe(true);
  });

  it('reveals a never-settling gate through the watchdog, with a warning', async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const scene = fakeScene();
      const group = new THREE.Group();
      group.name = 'stuck-town';
      // A gate promise that never settles: without the watchdog the town
      // stays invisible forever with no diagnostic.
      void attachSceneGroupGated(scene, group, () => new Promise(() => {}));
      expect(group.visible).toBe(false);

      vi.advanceTimersByTime(GATED_ATTACH_WATCHDOG_MS - 1);
      expect(group.visible).toBe(false);
      vi.advanceTimersByTime(1);
      expect(group.visible).toBe(true);
      expect(warn).toHaveBeenCalledWith(
        `Gated scene attach never settled after ${GATED_ATTACH_WATCHDOG_MS}ms, revealed anyway`,
        'stuck-town',
      );
    } finally {
      warn.mockRestore();
      vi.useRealTimers();
    }
  });

  it('records the watchdog reveal as a machine-readable gpu-prep event', async () => {
    // The console line the case above pins is the only evidence a stuck town
    // used to leave. A capture needs the same fact as data: which group, and
    // how long it sat hidden before the escape fired.
    vi.useFakeTimers();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let clock = 0;
    setGpuPrepClockForTest(() => clock);
    try {
      const scene = fakeScene();
      const group = new THREE.Group();
      group.name = 'stuck-town';
      void attachSceneGroupGated(scene, group, () => new Promise(() => {}));
      clock = GATED_ATTACH_WATCHDOG_MS;
      vi.advanceTimersByTime(GATED_ATTACH_WATCHDOG_MS);

      const snapshot = gpuPrepEventsSnapshot();
      expect(snapshot.counts['attach-watchdog']).toBe(1);
      expect(snapshot.events).toHaveLength(1);
      expect(snapshot.events[0].kind).toBe('attach-watchdog');
      expect(snapshot.events[0].key).toBe('stuck-town');
      expect(snapshot.events[0].ageMs).toBe(GATED_ATTACH_WATCHDOG_MS);
    } finally {
      warn.mockRestore();
      vi.useRealTimers();
    }
  });

  it('records nothing when the gate settles inside its watchdog window', async () => {
    const scene = fakeScene();
    const group = new THREE.Group();
    await attachSceneGroupGated(scene, group, () => Promise.resolve());
    expect(gpuPrepEventsSnapshot().total).toBe(0);
  });

  it('never fires the watchdog once the gate has settled', async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const scene = fakeScene();
      const group = new THREE.Group();
      await attachSceneGroupGated(scene, group, () => Promise.resolve());
      vi.advanceTimersByTime(GATED_ATTACH_WATCHDOG_MS + 1);
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
      vi.useRealTimers();
    }
  });
});
