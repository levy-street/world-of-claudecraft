// The ambient leaping fish compile gate (src/render/fish.ts): the fish body
// GLB rides the DEFERRED preload lane, so no prewarm manifest entry ever sees
// its Tripo material, and the pooled bodies stay hidden between leaps. Its
// program therefore linked synchronously at the FIRST LEAP after the world
// reveal (measured 23-146 ms frames on an RTX 3090, tier high).
//
// `FishView.setCompileGate` makes the view a client of the renderer's live
// compile gate (the shape `renderer.compileGate` has, and that dungeon
// interiors already take): one hidden prewarm instance goes through the gate
// and the pool keeps the merged-primitive fallback body until the programs are
// linked.
//
// Driven through the real `buildFish` with the preload asset injected via
// `fishPreloadInternalsForTest`; the world module is stubbed to deep water
// everywhere so leaps are deterministic (no loader, no GPU).
import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildFish, fishPreloadInternalsForTest } from '../src/render/fish';

vi.mock('../src/sim/world', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/sim/world')>();
  return {
    ...actual,
    terrainHeight: () => -10,
    waterLevel: () => 0,
    waterLevelAt: () => 0,
  };
});

// The stand-in for the loaded GLB scene: one mesh carrying the material whose
// link is the hitch under test.
const GLB_MATERIAL_NAME = 'tripo_material_f1366419';

function fakeFishGltf(): THREE.Group {
  const scene = new THREE.Group();
  scene.name = 'leaping_fish_glb';
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(0.2, 0.2, 0.6),
    new THREE.MeshStandardMaterial({ name: GLB_MATERIAL_NAME }),
  );
  mesh.name = 'leaping_fish_body';
  scene.add(mesh);
  return scene;
}

function carriesGlbMaterial(root: THREE.Object3D): boolean {
  let found = false;
  root.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      const mats = Array.isArray(child.material) ? child.material : [child.material];
      if (mats.some((m) => m.name === GLB_MATERIAL_NAME)) found = true;
    }
  });
  return found;
}

// A live rig: the view plus the hidden prewarm root the gate was handed, which
// is a child of the fish group but not one of the pooled bodies.
function rig(options: { gate?: (root: THREE.Object3D) => Promise<unknown> } = {}) {
  const view = buildFish(7);
  if (options.gate) view.setCompileGate(options.gate);
  let prewarm: THREE.Object3D | null = null;
  return {
    view,
    setPrewarm(root: THREE.Object3D | null): void {
      prewarm = root;
    },
    pooled(): THREE.Object3D[] {
      return view.group.children.filter((c) => c !== prewarm);
    },
    glbBodies(): THREE.Object3D[] {
      return view.group.children.filter((c) => c !== prewarm && carriesGlbMaterial(c));
    },
    update(dt = 0.1): void {
      view.update(0, 0, dt);
    },
  };
}

/** A compile gate whose link is held open until `release()` is called. */
function heldGate() {
  let resolveLink = (): void => {};
  const gate = vi.fn(
    (_root: THREE.Object3D) =>
      new Promise<void>((resolve) => {
        resolveLink = resolve;
      }),
  );
  return { gate, release: (): void => resolveLink() };
}

/** Let a settled gate promise run its `then` before the next frame. */
async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

afterEach(() => {
  fishPreloadInternalsForTest.setLoadedGltfForTest(null);
  vi.restoreAllMocks();
});

describe('fish GLB body compile gate', () => {
  it('keeps every pooled fish on the fallback body until the gate resolves', async () => {
    fishPreloadInternalsForTest.setLoadedGltfForTest(fakeFishGltf());
    const { gate, release } = heldGate();
    const r = rig({ gate });
    r.update();
    r.setPrewarm(gate.mock.calls[0][0]);

    expect(gate).toHaveBeenCalledTimes(1);
    expect(r.glbBodies()).toHaveLength(0);

    for (let i = 0; i < 40; i++) r.update();
    expect(r.glbBodies()).toHaveLength(0); // leaps happen, still no GLB body
    expect(gate).toHaveBeenCalledTimes(1); // one prewarm instance, not one per frame

    release();
    await settle();
    r.update();
    expect(r.glbBodies().length).toBeGreaterThan(0);
  });

  it('hands the gate a hidden root carrying the GLB material', () => {
    fishPreloadInternalsForTest.setLoadedGltfForTest(fakeFishGltf());
    const gate = vi.fn((_root: THREE.Object3D) => new Promise<void>(() => {}));
    const r = rig({ gate });
    r.update();

    const root = gate.mock.calls[0][0];
    expect(root).toBeInstanceOf(THREE.Object3D);
    expect(root.visible).toBe(false);
    expect(carriesGlbMaterial(root)).toBe(true);
    expect(root.parent).toBe(r.view.group); // compiled in place, under the fish group
  });

  it('mirrors the live body flags and material on the prewarm instance', async () => {
    fishPreloadInternalsForTest.setLoadedGltfForTest(fakeFishGltf());
    const { gate, release } = heldGate();
    const r = rig({ gate });
    r.update();
    const prewarm = gate.mock.calls[0][0];
    r.setPrewarm(prewarm);
    const prewarmMesh = prewarm.children[0] as THREE.Mesh;

    release();
    await settle();
    r.update();
    const live = r.glbBodies()[0];
    const liveMesh = live.children[0] as THREE.Mesh;

    // castShadow decides whether a depth variant is needed, so it must match or
    // the live body links a program the prewarm never compiled; the shared
    // material instance is what makes the linked program reusable at all.
    expect(liveMesh.castShadow).toBe(prewarmMesh.castShadow);
    expect(liveMesh.receiveShadow).toBe(prewarmMesh.receiveShadow);
    expect(liveMesh.material).toBe(prewarmMesh.material);
  });

  it('performs the swap on update(), never from the promise callback', async () => {
    fishPreloadInternalsForTest.setLoadedGltfForTest(fakeFishGltf());
    const { gate, release } = heldGate();
    const r = rig({ gate });
    r.update();
    r.setPrewarm(gate.mock.calls[0][0]);
    const before = r.view.group.children.map((c) => c.uuid);

    release();
    await settle();
    // The settle alone changed nothing: no body flipped between frames (a
    // hide/show off a promise can move three's counted light set).
    expect(r.view.group.children.map((c) => c.uuid)).toEqual(before);

    r.update();
    expect(r.glbBodies()).toHaveLength(r.pooled().length);
  });

  it('never swaps a fish that is mid-leap', async () => {
    fishPreloadInternalsForTest.setLoadedGltfForTest(fakeFishGltf());
    const { gate, release } = heldGate();
    const r = rig({ gate });
    r.update();
    r.setPrewarm(gate.mock.calls[0][0]);

    // run the pool until some fish are out of the water
    let inFlight: THREE.Object3D[] = [];
    for (let i = 0; i < 40 && inFlight.length === 0; i++) {
      r.update();
      inFlight = r.pooled().filter((body) => body.visible);
    }
    expect(inFlight.length).toBeGreaterThan(0);

    release();
    await settle();
    r.update(0.016);
    for (const body of inFlight) {
      expect(body.parent).toBe(r.view.group); // still the body it is drawing
      expect(carriesGlbMaterial(body)).toBe(false);
    }

    // ...and it swaps once it is back under water
    for (let i = 0; i < 40; i++) r.update();
    for (const body of inFlight) expect(body.parent).toBe(null);
    expect(r.glbBodies()).toHaveLength(r.pooled().length);
  });

  it('swaps immediately without a gate (headless hosts and tests)', () => {
    fishPreloadInternalsForTest.setLoadedGltfForTest(fakeFishGltf());
    const r = rig();
    r.update();
    expect(r.glbBodies()).toHaveLength(r.pooled().length);
  });

  it('keeps the fallback body when the gate rejects, and does not throw', async () => {
    fishPreloadInternalsForTest.setLoadedGltfForTest(fakeFishGltf());
    const r = rig({ gate: () => Promise.reject(new Error('fish gate link rejected')) });
    const pooledCount = r.view.group.children.length;

    expect(() => r.update()).not.toThrow();
    await settle();
    expect(() => r.update()).not.toThrow();
    expect(r.glbBodies()).toHaveLength(0);
    // and the hidden prewarm instance is not left parented under the group
    expect(r.view.group.children).toHaveLength(pooledCount);
    for (const child of r.view.group.children) expect(carriesGlbMaterial(child)).toBe(false);
  });

  it('leaves the pool on the fallback body while the preload has not resolved', () => {
    fishPreloadInternalsForTest.setLoadedGltfForTest(null);
    const gate = vi.fn((_root: THREE.Object3D) => Promise.resolve());
    const r = rig({ gate });
    r.update();
    expect(gate).not.toHaveBeenCalled();
    expect(r.glbBodies()).toHaveLength(0);
  });
});
