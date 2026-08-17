import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { attachSceneGroupGated, GATED_ATTACH_WATCHDOG_MS } from '../src/render/gated_scene_attach';

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
