import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';

const assets = vi.hoisted(() => ({
  start: null as (() => Promise<unknown>) | null,
  load: vi.fn(),
}));
vi.mock('../src/render/assets/loader', () => ({ loadGltf: assets.load }));
vi.mock('../src/render/assets/preload', () => ({
  registerDeferredPreload: (start: () => Promise<unknown>) => {
    assets.start = start;
  },
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
  assets.start = null;
  assets.load.mockReset();
});

describe('shared glider apparatus asset lifecycle', () => {
  it('defers its load and compiles the attached GLB even when the course predates the asset', async () => {
    vi.stubGlobal('window', {});
    let settle!: (value: { scene: THREE.Group }) => void;
    assets.load.mockImplementation(
      () =>
        new Promise((resolve) => {
          settle = resolve;
        }),
    );
    const { GliderCourseVisual } = await import('../src/render/glider_course_visual');
    expect(assets.load).not.toHaveBeenCalled();
    const source = new THREE.Group();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 1, 4), new THREE.MeshLambertMaterial());
    source.add(mesh);
    const gate = vi.fn(async (root: THREE.Object3D) => {
      const fitted = root.getObjectByName('glider-apparatus-model')!;
      expect(fitted).toBeDefined();
      const meshes: THREE.Mesh[] = [];
      fitted.traverse((node) => {
        if ((node as THREE.Mesh).isMesh) meshes.push(node as THREE.Mesh);
      });
      expect(meshes[0].material).toBe(mesh.material);
    });
    const visual = new GliderCourseVisual(new THREE.Group(), () => 0, gate);
    expect(gate).not.toHaveBeenCalled();
    const pending = assets.start!();
    settle({ scene: source });
    await pending;
    await visual.readyForEntry;
    expect(gate).toHaveBeenCalledOnce();
    const materialDispose = vi.spyOn(mesh.material as THREE.Material, 'dispose');
    visual.dispose();
    expect(materialDispose).not.toHaveBeenCalled();
  });

  it('releases asset waiters when disposed and never compiles a retired reward visual', async () => {
    vi.stubGlobal('window', {});
    let settle!: (value: { scene: THREE.Group }) => void;
    assets.load.mockImplementation(
      () =>
        new Promise((resolve) => {
          settle = resolve;
        }),
    );
    const { RewardGliderVisual } = await import('../src/render/reward_glider_visual');
    const gate = vi.fn(async () => {});
    const scene = new THREE.Group();
    const visual = new RewardGliderVisual(scene, gate);
    const pending = assets.start!();
    visual.dispose();
    await visual.readyForEntry;
    settle({ scene: new THREE.Group() });
    await pending;
    expect(gate).not.toHaveBeenCalled();
    expect(visual.group.children).toHaveLength(0);
    expect(scene.children).not.toContain(visual.group);
  });

  it('settles a failed GLB to the existing fallback and fits source clones without mutation', async () => {
    vi.stubGlobal('window', {});
    assets.load.mockRejectedValue(new Error('missing prop'));
    const { createGliderApparatusMesh, fitGliderApparatus } = await import(
      '../src/render/glider_apparatus'
    );
    const apparatus = createGliderApparatusMesh();
    await assets.start!();
    await apparatus.readyForEntry;
    expect(apparatus.group.getObjectByName('glider-apparatus-fallback')).toBeDefined();
    const source = new THREE.Mesh(new THREE.BoxGeometry(2, 1, 6), new THREE.MeshLambertMaterial());
    const fitted = fitGliderApparatus(source);
    const bounds = new THREE.Box3().setFromObject(fitted);
    expect(bounds.max.x - bounds.min.x).toBeCloseTo(4.8);
    expect(bounds.max.y).toBeCloseTo(0.42);
    expect(source.rotation.y).toBe(0);
    expect(source.scale.toArray()).toEqual([1, 1, 1]);
    apparatus.dispose();
  });
});
