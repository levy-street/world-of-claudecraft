import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { GPU_QUEUE_SHUTDOWN_ERROR_NAME } from '../src/render/background_gpu_queue';
import { attachSceneGroupGated } from '../src/render/gated_scene_attach';
import { markProgramsReadyUnder } from '../src/render/linked_program_readiness';
import { measureFeatureFootprint } from '../src/render/renderer_diagnostics';
import { buildSceneryBand } from '../src/render/scenery_bands/batches';
import { collectSceneryPlacements } from '../src/render/scenery_bands/collect';
import { SceneryIndexCache } from '../src/render/scenery_bands/geometry';
import { lowSceneryBandMaterial, sceneryBandMaterial } from '../src/render/scenery_bands/material';
import { SceneryNearSources } from '../src/render/scenery_bands/near';
import {
  giantsCover,
  giantsRebakeDue,
  LowSceneryBands,
  sceneryBandsHost,
} from '../src/render/scenery_bands/session';
import {
  sweepZoneFeatures,
  type ZoneFeatureEntry,
  zoneFeatureEntryFor,
} from '../src/render/zone_feature_sweep';

/** Every sprite root the giant stand-in made, newest last. */
const giantBakeRoots = vi.hoisted((): THREE.Group[] => []);

// The giant atlas bake needs a real context. With giant items present, a
// stand-in honours the gate and returns sprites with nothing to draw; an empty
// window still runs the real builder. The stand-in records which giants the
// session selects, and marks a bake whose gate threw as released, as the real
// builder releases its atlas targets.
vi.mock('../src/render/scenery_bands/giants', async (importActual) => {
  const actual = await importActual<typeof import('../src/render/scenery_bands/giants')>();
  return {
    ...actual,
    buildGiantSprites: async (
      options: Parameters<typeof actual.buildGiantSprites>[0],
    ): ReturnType<typeof actual.buildGiantSprites> => {
      if (!options.items.length) return actual.buildGiantSprites(options);
      const root = new THREE.Group();
      root.name = 'scenery-band:giants';
      giantBakeRoots.push(root);
      try {
        await options.gate(root);
      } catch (error) {
        root.userData.released = true;
        throw error;
      }
      return {
        root,
        update: (selected: Uint8Array) => {
          root.userData.selected = Array.from(selected);
        },
        snapshot: () => ({ placements: options.items.length }),
        dispose: () => undefined,
      } as unknown as Awaited<ReturnType<typeof actual.buildGiantSprites>>;
    },
  };
});

/** A streamed replacement root carrying one giant tree at (x, 0). */
function giantRoot(x: number): { root: THREE.Group; landmark: THREE.Group } {
  const root = new THREE.Group();
  root.name = 'garden-features';
  const landmark = new THREE.Group();
  landmark.position.set(x, 0, 0);
  const trunk = new THREE.Mesh(new THREE.BoxGeometry(6, 40, 6), new THREE.MeshLambertMaterial());
  trunk.name = 'TwistedTree_1';
  landmark.add(trunk);
  landmark.updateMatrixWorld(true);
  landmark.traverse((node) => {
    node.matrixAutoUpdate = false;
  });
  root.add(landmark);
  return { root, landmark };
}

/** An ordinary landmark tree (no giant) at (x, 0), a child of `root`. */
function ordinaryTree(root: THREE.Group, x: number): THREE.Group {
  const tree = new THREE.Group();
  tree.position.set(x, 0, 0);
  const trunk = new THREE.Mesh(new THREE.BoxGeometry(6, 20, 6), new THREE.MeshLambertMaterial());
  trunk.name = 'Oak_1';
  tree.add(trunk);
  tree.updateMatrixWorld(true);
  tree.traverse((node) => {
    node.matrixAutoUpdate = false;
  });
  root.add(tree);
  return tree;
}

/** A session whose giant gate fails, hangs or passes as the test says, with
 *  a test clock for its backoff and timeout. */
function giantBakeHarness(onGiantGate: (call: number) => Promise<void> | void) {
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0, 120, 340);
  const clock = { now: 1000 };
  const now = vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  let calls = 0;
  const session = new LowSceneryBands({ run: async (work) => work() }, () => ({
    scene,
    camera: new THREE.PerspectiveCamera(),
    webgl: bandWebgl(),
    gate: async (root) => {
      if (root.name === 'scenery-band:giants') await onGiantGate(++calls);
    },
    outdoor: () => true,
  }));
  const { root, landmark } = giantRoot(150);
  scene.add(root);
  session.registerRoot(root, true);
  return {
    session,
    landmark,
    clock,
    warn,
    calls: () => calls,
    restore: () => {
      session.dispose();
      now.mockRestore();
      warn.mockRestore();
    },
  };
}

function bandWebgl(properties?: object): THREE.WebGLRenderer {
  return {
    shadowMap: { enabled: false },
    render: vi.fn(),
    ...(properties ? { properties } : {}),
  } as unknown as THREE.WebGLRenderer;
}

function bandMaterialsIn(scene: THREE.Scene): THREE.Material[] {
  return scene.children
    .filter((node) => node.name.startsWith('scenery-band:') && node.name !== 'scenery-band:giants')
    .flatMap((band) =>
      band.children.map((mesh) => (mesh as THREE.Mesh).material as THREE.Material),
    );
}

/** A gate stand-in that proves every program under the root, the way a
 *  settled gate does, so a later window may skip it. */
function provingGate(gated: string[]) {
  const records = new Map<object, object>();
  const properties = { get: (object: object) => records.get(object) };
  const gate = async (root: THREE.Object3D): Promise<void> => {
    gated.push(root.name);
    root.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (!mesh.isMesh) return;
      const program = {};
      records.set(mesh.material as THREE.Material, {
        programs: new Map([['key', program]]),
        currentProgram: program,
      });
    });
    markProgramsReadyUnder(properties as never, root as THREE.Group);
  };
  return { properties, gate };
}

function sources(): THREE.Group {
  const root = new THREE.Group();
  root.name = 'jungle-features';
  const material = new THREE.MeshStandardMaterial({ color: 0x458822, roughness: 0.7 });
  for (const width of [3, 16]) {
    const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(width, 12, width), material, 3);
    for (let i = 0; i < 3; i++) {
      mesh.setMatrixAt(i, new THREE.Matrix4().makeTranslation(30 + i * 90, 0, 0));
      mesh.setColorAt(i, new THREE.Color(0.2 + i * 0.2, 0.8, 0.5));
    }
    root.add(mesh);
  }
  return root;
}

describe('scenery replacement ownership', () => {
  it('uses the supplied scheduled gate without requiring parallel compile support', async () => {
    const root = new THREE.Group();
    const gate = vi.fn(async () => undefined);
    const host = sceneryBandsHost(
      {
        scene: new THREE.Scene(),
        camera: new THREE.PerspectiveCamera(),
        webgl: {} as THREE.WebGLRenderer,
        fogState: 'outdoor',
      },
      gate,
    );
    await host.gate(root);
    expect(gate).toHaveBeenCalledWith(root);
  });

  it('keeps existing cheap bands while only newly streamed scenery waits for replacements', async () => {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera();
    const webgl = {
      shadowMap: { enabled: false },
      render: vi.fn(),
    } as unknown as THREE.WebGLRenderer;
    let hold = false;
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let reveal!: () => void;
    const sourceGate = new Promise<void>((resolve) => {
      reveal = resolve;
    });
    const session = new LowSceneryBands(
      {
        run: async (work) => {
          if (hold) await held;
          return work();
        },
      },
      () => ({ scene, camera, webgl, gate: async () => undefined }),
    );
    try {
      const existing = sources();
      scene.add(existing);
      session.registerRoot(existing);
      session.update(0, 0);
      await vi.waitFor(() => expect(session.snapshot()).toMatchObject({ stage: 'ready' }));
      session.update(0, 0);
      expect(session.cullFar(1000)).toBe(60);
      expect((existing.children[0] as THREE.InstancedMesh).count).toBe(1);
      hold = true;
      const root = sources();
      root.position.x = 100;
      session.registerRoot(root);
      const entries: ZoneFeatureEntry[] = [];
      const attached = attachSceneGroupGated(scene, root, () => sourceGate).then(() => {
        entries.push(zoneFeatureEntryFor(root, measureFeatureFootprint(root)));
      });
      expect(session.cullFar(1000)).toBe(60);
      session.update(0, 0);
      const sweep = () =>
        sweepZoneFeatures(entries, 0, 0, (group) => session.cullFar(1000, group), 105);
      sweep();
      expect(root.visible).toBe(false);
      reveal();
      await attached;
      sweep();
      expect(root.visible).toBe(true);
      expect(session.cullFar(1000, root.children[0])).toBe(1000);
      expect(session.snapshot()).toMatchObject({ active: true, pending: true });
      expect((existing.children[0] as THREE.InstancedMesh).count).toBe(1);
      expect((root.children[0] as THREE.InstancedMesh).count).toBe(3);
      hold = false;
      release();
      await vi.waitFor(() =>
        expect(session.snapshot()).toMatchObject({ stage: 'ready', pending: false }),
      );
      session.update(0, 0);
      sweep();
      expect(root.visible).toBe(false);
      expect((root.children[0] as THREE.InstancedMesh).count).toBe(0);
      expect((existing.children[0] as THREE.InstancedMesh).count).toBe(1);
    } finally {
      reveal();
      release();
      session.dispose();
    }
  });

  it('retains the global native fallback while a new foliage owner is uncovered', async () => {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera();
    const webgl = {
      shadowMap: { enabled: false },
      render: vi.fn(),
    } as unknown as THREE.WebGLRenderer;
    let hold = false;
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const session = new LowSceneryBands(
      {
        run: async (work) => {
          if (hold) await held;
          return work();
        },
      },
      () => ({ scene, camera, webgl, gate: async () => undefined }),
    );
    try {
      const root = sources();
      scene.add(root);
      session.registerRoot(root);
      session.update(0, 0);
      await vi.waitFor(() => expect(session.snapshot()).toMatchObject({ stage: 'ready' }));
      session.update(0, 0);
      const middle = scene.children.find((node) => node.name === 'scenery-band:middle')!;
      expect((middle.children[0] as THREE.Mesh).geometry.drawRange.count).toBeGreaterThan(0);
      hold = true;
      const foliage = new THREE.Group();
      foliage.name = 'foliage';
      scene.add(foliage);
      session.registerRoot(foliage);
      expect(session.cullFar(1000)).toBe(1000);
      session.update(0, 0);
      expect(session.snapshot()).toMatchObject({ active: false, pending: true });
      expect((middle.children[0] as THREE.Mesh).geometry.drawRange.count).toBe(0);
      expect((root.children[0] as THREE.InstancedMesh).count).toBe(3);
    } finally {
      release();
      session.dispose();
    }
  });

  it('suspends distance bands and preserves native fog inside and underwater', async () => {
    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0, 400, 1050);
    const camera = new THREE.PerspectiveCamera();
    let outdoor = true;
    const fogSeen: number[] = [];
    const webgl = {
      shadowMap: { enabled: false },
      render: () => {
        fogSeen.push((scene.fog as THREE.Fog).far);
      },
    } as unknown as THREE.WebGLRenderer;
    const session = new LowSceneryBands({ run: async (work) => work() }, () => ({
      scene,
      camera,
      webgl,
      gate: async () => undefined,
      outdoor: () => outdoor,
    }));
    try {
      const root = sources();
      scene.add(root);
      session.registerRoot(root);
      session.update(0, 0);
      await vi.waitFor(() => expect(session.snapshot()).toMatchObject({ stage: 'ready' }));
      session.update(0, 0);
      const middle = scene.children.find((node) => node.name === 'scenery-band:middle')!;
      expect((middle.children[0] as THREE.Mesh).geometry.drawRange.count).toBeGreaterThan(0);
      expect(middle.visible).toBe(true);
      webgl.render(scene, camera);
      expect(fogSeen).toEqual([560]);
      expect(scene.fog.far).toBe(1050);
      outdoor = false;
      expect(session.cullFar(1050)).toBe(1050);
      webgl.render(scene, camera);
      expect(fogSeen).toEqual([560, 1050]);
      session.update(0, 0);
      expect(session.snapshot()).toMatchObject({ active: false, pending: false });
      expect(
        scene.children
          .filter((node) => node.name.startsWith('scenery-band:'))
          .every((node) => !node.visible),
      ).toBe(true);
      outdoor = true;
      session.update(0, 0);
      expect(session.cullFar(1050)).toBe(60);
      expect(middle.visible).toBe(true);
      expect((middle.children[0] as THREE.Mesh).geometry.drawRange.count).toBeGreaterThan(0);
    } finally {
      session.dispose();
    }
  });

  it('keeps prepared replacements active when an unrelated zone dressing root streams in', async () => {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera();
    const webgl = {
      shadowMap: { enabled: false },
      render: vi.fn(),
    } as unknown as THREE.WebGLRenderer;
    let hold = false;
    const session = new LowSceneryBands(
      { run: async (work) => (hold ? new Promise(() => undefined) : work()) },
      () => ({ scene, camera, webgl, gate: async () => undefined }),
    );
    try {
      session.update(0, 0);
      await vi.waitFor(() => expect(session.snapshot()).toMatchObject({ stage: 'ready' }));
      session.update(0, 0);
      hold = true;
      const root = new THREE.Group();
      root.name = 'dawnhold-features';
      const object = new THREE.Mesh(new THREE.BoxGeometry(20, 10, 20));
      object.position.x = 100;
      object.updateMatrix();
      object.matrixAutoUpdate = false;
      root.add(object);
      scene.add(root);
      session.registerRoot(root, true);
      session.update(0, 0);
      expect(session.snapshot()).toMatchObject({ active: true, pending: false });
      expect(session.cullFar(1000)).toBe(60);
      expect(object.visible).toBe(false);
    } finally {
      session.dispose();
    }
  });

  it('does not reveal a pending outdoor replacement after entering an interior', async () => {
    const scene = new THREE.Scene();
    let outdoor = true;
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const webgl = {
      shadowMap: { enabled: false },
      render: vi.fn(),
    } as unknown as THREE.WebGLRenderer;
    const session = new LowSceneryBands({ run: async (work) => work() }, () => ({
      scene,
      camera: new THREE.PerspectiveCamera(),
      webgl,
      gate: () => gate,
      outdoor: () => outdoor,
    }));
    try {
      session.update(0, 0);
      await vi.waitFor(() => expect(session.snapshot()).toMatchObject({ stage: 'middle' }));
      outdoor = false;
      session.update(0, 0);
      release?.();
      await vi.waitFor(() => expect(session.snapshot()).toMatchObject({ pending: false }));
      expect(scene.children).toHaveLength(0);
      expect(session.cullFar(1050)).toBe(1050);
    } finally {
      session.dispose();
    }
  });

  it('leaves moving props and nondecorative objects under their native visibility owner', () => {
    const near = new SceneryNearSources();
    for (const rootName of ['props', 'garden-features']) {
      const root = new THREE.Group();
      root.name = rootName;
      const ship = new THREE.Mesh(new THREE.BoxGeometry(20, 10, 20));
      ship.matrixAutoUpdate = false;
      ship.userData.decorative = false;
      root.add(ship);
      near.register(root);
      ship.visible = false;
      near.update(0, 0, 60);
      expect(ship.visible).toBe(false);
      ship.visible = true;
      near.update(1000, 0, 60);
      expect(ship.visible).toBe(true);
    }
    near.dispose();
  });

  it('caps static registered zone scenery outside the two replacement biomes', () => {
    const root = new THREE.Group();
    root.name = 'dawnhold-features';
    const object = new THREE.Mesh(new THREE.BoxGeometry(20, 10, 20));
    object.position.x = 100;
    object.updateMatrix();
    object.matrixAutoUpdate = false;
    root.add(object);
    const near = new SceneryNearSources();
    near.register(root, true);
    near.update(0, 0, 60);
    expect(object.visible).toBe(false);
    near.update(50, 0, 60);
    expect(object.visible).toBe(true);
    near.dispose();
  });

  it('retains native rendering if a streamed source has unsupported instance data', () => {
    const root = sources();
    const mesh = root.children[0] as THREE.InstancedMesh;
    mesh.geometry.setAttribute(
      'customAnimatedData',
      new THREE.InstancedBufferAttribute(new Float32Array(3), 1),
    );
    const scene = new THREE.Scene();
    scene.add(root);
    const render = vi.fn();
    const webgl = { shadowMap: { enabled: false }, render } as unknown as THREE.WebGLRenderer;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const session = new LowSceneryBands({ run: async (work) => work() }, () => ({
      scene,
      camera: new THREE.PerspectiveCamera(),
      webgl,
      gate: async () => undefined,
    }));
    try {
      session.registerRoot(root);
      expect(() => session.update(0, 0)).not.toThrow();
      expect(session.cullFar(1000)).toBe(1000);
      expect(mesh.count).toBe(3);
      expect(webgl.render).toBe(render);
      expect(session.snapshot()).toMatchObject({
        active: false,
        pending: false,
        error: 'Error: Unsupported packed scenery attributes',
      });
      session.update(100, 0);
      expect(warn).toHaveBeenCalledOnce();
    } finally {
      session.dispose();
      warn.mockRestore();
    }
  });
  it('packs whole placements, restores authored slots for collection and releases ownership', () => {
    const root = sources();
    const meshes = root.children as THREE.InstancedMesh[];
    const original = meshes.map((mesh) => mesh.instanceMatrix.array.slice());
    const near = new SceneryNearSources();
    near.register(root);
    near.update(0, 0, 60);
    expect(meshes.map((mesh) => mesh.count)).toEqual([1, 1]);
    expect(near.retains(meshes[0], 1)).toBe(false);
    const items = near.withOriginalInstances(() => collectSceneryPlacements([root], 0, 0, 630));
    expect(items).toHaveLength(3);
    expect(items.map((item) => item.x)).toEqual([30, 120, 210]);
    expect(meshes.map((mesh) => mesh.count)).toEqual([1, 1]);
    near.update(50, 0, 60);
    // Crown footprint enters the margin first. Its trunk follows the same
    // whole-placement decision, not a smaller independent trunk footprint.
    expect(meshes.map((mesh) => mesh.count)).toEqual([2, 2]);
    near.dispose();
    for (const [i, mesh] of meshes.entries()) {
      expect(mesh.count).toBe(3);
      expect(mesh.instanceMatrix.array).toEqual(original[i]);
    }
  });

  it('combines source cells into one draw per material and never disposes their textures', async () => {
    const root = sources();
    const items = collectSceneryPlacements([root], 0, 0, 630);
    const source = items[0].parts[0].source.material as THREE.MeshStandardMaterial;
    source.map = new THREE.Texture();
    const textureDisposed = vi.fn();
    source.map.addEventListener('dispose', textureDisposed);
    const sourceDisposed = vi.fn();
    source.addEventListener('dispose', sourceDisposed);
    const gate = vi.fn(async () => undefined);
    const band = await buildSceneryBand({
      name: 'test-band',
      items,
      reduction: () => ({ triangles: 12, mode: 'coarse' }),
      material: sceneryBandMaterial,
      prepare: async (work) => work(),
      gate,
      cancelled: () => false,
    });
    expect(gate).toHaveBeenCalledOnce();
    expect(band.root.children).toHaveLength(1);
    band.select(new Uint8Array([0, 1, 1]));
    expect(band.snapshot()).toEqual({ placements: 2, draws: 1, triangles: 48 });
    const mesh = band.root.children[0] as THREE.Mesh<
      THREE.BufferGeometry,
      THREE.MeshStandardMaterial
    >;
    expect(mesh.material.map).toBe(source.map);
    expect(mesh.material.roughness).toBe(source.roughness);
    expect(mesh.geometry.attributes.sceneryLocalPosition.count).toBe(
      mesh.geometry.attributes.position.count,
    );
    band.select(new Uint8Array([0, 0, 0]));
    expect(band.snapshot().draws).toBe(0);
    band.dispose();
    band.dispose();
    expect(sourceDisposed).not.toHaveBeenCalled();
    expect(textureDisposed).not.toHaveBeenCalled();
  });

  it('reuses reductions across source shells and moving preparation windows', async () => {
    const root = sources();
    const first = root.children[0] as THREE.InstancedMesh;
    const second = root.children[1] as THREE.InstancedMesh;
    const shell = new THREE.BufferGeometry();
    shell.attributes = { ...first.geometry.attributes };
    shell.index = first.geometry.index;
    second.geometry = shell;
    const items = collectSceneryPlacements([root], 0, 0, 630);
    const cache = new SceneryIndexCache();
    const labels: string[] = [];
    for (let window = 0; window < 2; window++) {
      const band = await buildSceneryBand({
        name: 'moving-band',
        items,
        cache,
        reduction: () => ({ triangles: 6, mode: 'coarse' }),
        material: sceneryBandMaterial,
        prepare: async (work, label) => {
          labels.push(label);
          return work();
        },
        gate: async () => undefined,
        cancelled: () => false,
      });
      band.dispose();
    }
    expect(labels.filter((label) => label.startsWith('scenery-band-reduce:'))).toHaveLength(1);
    expect(labels.filter((label) => label.startsWith('scenery-band-part:'))).toHaveLength(12);
  });

  it('ports the selected Low material without adding full source effects or local vertex buffers', async () => {
    const items = collectSceneryPlacements([sources()], 0, 0, 630);
    const source = items[0].parts[0].source.material as THREE.MeshStandardMaterial;
    source.map = new THREE.Texture();
    source.alphaTest = 0.35;
    source.side = THREE.DoubleSide;
    source.onBeforeCompile = vi.fn();
    const band = await buildSceneryBand({
      name: 'selected-low',
      items,
      reduction: () => ({ triangles: 12, mode: 'coarse' }),
      material: lowSceneryBandMaterial,
      localCoordinates: false,
      prepare: async (work) => work(),
      gate: async () => undefined,
      cancelled: () => false,
    });
    try {
      band.select(new Uint8Array([0, 1, 1]));
      const mesh = band.root.children[0] as THREE.Mesh<
        THREE.BufferGeometry,
        THREE.MeshLambertMaterial
      >;
      expect(mesh.material).toBeInstanceOf(THREE.MeshLambertMaterial);
      expect(mesh.material.map).toBe(source.map);
      expect(mesh.material.color).toEqual(source.color);
      expect(mesh.material).toMatchObject({
        alphaTest: 0.35,
        side: THREE.DoubleSide,
        vertexColors: true,
        fog: true,
        toneMapped: true,
      });
      expect(Object.keys(mesh.geometry.attributes).sort()).toEqual([
        'color',
        'normal',
        'position',
        'uv',
      ]);
      expect(mesh.material.onBeforeCompile).not.toBe(source.onBeforeCompile);
      expect(band.snapshot()).toEqual({ placements: 2, draws: 1, triangles: 48 });
    } finally {
      band.dispose();
    }
  });

  it('keeps the complete source shader hook and supplies its local coordinate frame', () => {
    const source = new THREE.MeshStandardMaterial();
    source.onBeforeCompile = (shader) => {
      shader.uniforms.customLight = { value: 0.8 };
      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvec2 windOrigin = vec2(0.0);',
      );
    };
    source.customProgramCacheKey = () => 'existing-canopy';
    const callback = source.onBeforeCompile;
    const material = sceneryBandMaterial(source);
    const shader = {
      uniforms: {},
      vertexShader:
        '#include <beginnormal_vertex>\n#include <defaultnormal_vertex>\n#include <begin_vertex>\n#include <project_vertex>',
      fragmentShader: 'void main() {}',
    };
    material.onBeforeCompile(
      shader as Parameters<THREE.Material['onBeforeCompile']>[0],
      {} as THREE.WebGLRenderer,
    );
    expect(shader.uniforms).toHaveProperty('customLight.value', 0.8);
    expect(shader.vertexShader).toContain('#define position sceneryLocalPosition');
    expect(shader.vertexShader).toContain('windOrigin = sceneryMatrix3.xz');
    expect(shader.vertexShader).toContain('transpose(inverse(mat3(');
    expect(material.customProgramCacheKey()).toBe('existing-canopy|scenery-merged-local-v1');
    expect(source.onBeforeCompile).toBe(callback);
  });

  it('syncs outer scenery selection to the live terrain fog far distance', async () => {
    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0, 120, 340);
    const camera = new THREE.PerspectiveCamera();
    const webgl = {
      shadowMap: { enabled: false },
      render: vi.fn(),
    } as unknown as THREE.WebGLRenderer;
    const session = new LowSceneryBands({ run: async (work) => work() }, () => ({
      scene,
      camera,
      webgl,
      gate: async () => undefined,
      outdoor: () => true,
    }));
    try {
      const root = new THREE.Group();
      root.name = 'jungle-features';
      const material = new THREE.MeshStandardMaterial({ color: 0x458822 });
      const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(8, 12, 8), material, 2);
      mesh.setMatrixAt(0, new THREE.Matrix4().makeTranslation(300, 0, 0));
      mesh.setMatrixAt(1, new THREE.Matrix4().makeTranslation(420, 0, 0));
      root.add(mesh);
      scene.add(root);
      session.registerRoot(root);
      session.update(0, 0);
      await vi.waitFor(() => expect(session.snapshot()).toMatchObject({ stage: 'ready' }));
      session.update(0, 0);
      const outer =
        scene.children.find((node) => node.name === 'scenery-band:outer') ?? new THREE.Group();
      expect((outer.children[0] as THREE.Mesh).geometry.drawRange.count).toBe(36);
      (scene.fog as THREE.Fog).far = 560;
      session.update(0, 0);
      expect((outer.children[0] as THREE.Mesh).geometry.drawRange.count).toBe(72);
    } finally {
      session.dispose();
    }
  });

  it('compacts indexed vertices per reduced part and batches part units on large bands', async () => {
    const root = new THREE.Group();
    root.name = 'jungle-features';
    const material = new THREE.MeshStandardMaterial({ color: 0x458822 });
    const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(8, 12, 8), material, 20);
    for (let i = 0; i < 20; i++) {
      mesh.setMatrixAt(i, new THREE.Matrix4().makeTranslation(80 + i * 15, 0, 0));
    }
    const trunk = new THREE.InstancedMesh(new THREE.BoxGeometry(3, 12, 3), material, 20);
    for (let i = 0; i < 20; i++) {
      trunk.setMatrixAt(i, new THREE.Matrix4().makeTranslation(80 + i * 15, 0, 0));
    }
    root.add(mesh, trunk);
    const items = collectSceneryPlacements([root], 0, 0, 630);
    expect(items).toHaveLength(20);
    const labels: string[] = [];
    const band = await buildSceneryBand({
      name: 'large-band',
      items,
      reduction: () => ({ triangles: 12, mode: 'coarse' }),
      material: sceneryBandMaterial,
      prepare: async (work, label) => {
        labels.push(label);
        return work();
      },
      gate: async () => undefined,
      cancelled: () => false,
    });
    band.select(new Uint8Array(20).fill(1));
    const mergedMesh = band.root.children[0] as THREE.Mesh;
    // 40 box parts x 12 triangles = 480 triangles (1440 indices), but indexed box has 24 vertices * 40 = 960 vertices (< 1440 non-indexed)
    expect(mergedMesh.geometry.drawRange.count).toBe(1440);
    expect(mergedMesh.geometry.attributes.position.count).toBeLessThan(1440);
    // 40 parts (> 32 threshold) are chunked into 2 scenery-band-part units instead of 40
    expect(labels.filter((l) => l.startsWith('scenery-band-part:'))).toHaveLength(2);
    band.dispose();
  });
  it('keeps giant sprites covering only while every giant inside the fog is held', () => {
    // At the 560 yd fog cap a 630 yd window holds 70 yd, past the bands' 64 yd ring.
    expect(giantsCover(0, 0, 70, 0, 560)).toBe(true);
    expect(giantsCover(0, 0, 71, 0, 560)).toBe(false);
    // Under a nearer fog the 630 yd window holds the previous sprites further.
    expect(giantsCover(0, 0, 290, 0, 340)).toBe(true);
    expect(giantsCover(0, 0, 291, 0, 340)).toBe(false);
    // A rebake starts past half the coverage, at most 128 yd out.
    expect(giantsRebakeDue(0, 0, 128, 0, 340)).toBe(false);
    expect(giantsRebakeDue(0, 0, 129, 0, 340)).toBe(true);
    expect(giantsRebakeDue(0, 0, 35, 0, 560)).toBe(false);
    expect(giantsRebakeDue(0, 0, 36, 0, 560)).toBe(true);
    // A raw fog past 566 yd still covers the bands' own 64 yd ring.
    expect(giantsCover(0, 0, 64, 0, 600)).toBe(true);
    expect(giantsCover(0, 0, 65, 0, 600)).toBe(false);
    // Re-entry needs the hysteresis margin inside the edge.
    expect(giantsCover(0, 0, 62, 0, 560, 8)).toBe(true);
    expect(giantsCover(0, 0, 63, 0, 560, 8)).toBe(false);
  });

  it('commits the bands before the giant atlas bake so a walking camera keeps them', async () => {
    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0, 120, 340);
    const camera = new THREE.PerspectiveCamera();
    const webgl = {
      shadowMap: { enabled: false },
      render: vi.fn(),
    } as unknown as THREE.WebGLRenderer;
    let holdGiants = false;
    let releaseGiants!: () => void;
    const giantsHeld = new Promise<void>((resolve) => {
      releaseGiants = resolve;
    });
    const session = new LowSceneryBands({ run: async (work) => work() }, () => ({
      scene,
      camera,
      webgl,
      gate: async (root) => {
        if (holdGiants && root.name === 'scenery-band:giants') await giantsHeld;
      },
      outdoor: () => true,
    }));
    try {
      session.update(0, 0);
      await vi.waitFor(() => expect(session.snapshot()).toMatchObject({ stage: 'ready' }));
      holdGiants = true;
      // 150 yd on, past half the sprites' 290 yd coverage under a 340 yd fog,
      // the next window bakes new sprites: its bands land, its giants wait.
      camera.position.set(150, 0, 0);
      session.update(150, 0);
      await vi.waitFor(() => expect(session.snapshot()).toMatchObject({ giantsPending: true }));
      // 50 yd from the new bands and 200 from the first window's sprites:
      // still covered by both, so far scenery stays cut.
      camera.position.set(200, 0, 0);
      session.update(200, 0);
      expect(session.snapshot()).toMatchObject({ active: true, giantsPending: true });
      expect(session.cullFar(1000)).toBe(60);
      // The window at 200 yd does not wait for the held bake: its bands land,
      // so 260 yd (60 from them, 260 from the first sprites) stays covered.
      await vi.waitFor(() =>
        expect(session.snapshot()).toMatchObject({ pending: false, giantsPending: true }),
      );
      camera.position.set(260, 0, 0);
      session.update(260, 0);
      expect(session.cullFar(1000)).toBe(60);
      releaseGiants();
      await vi.waitFor(() =>
        expect(session.snapshot()).toMatchObject({
          stage: 'ready',
          pending: false,
          giantsPending: false,
        }),
      );
      // Past the newest window's validity ring (260 yd) the native fallback
      // returns.
      camera.position.set(330, 0, 0);
      session.update(330, 0);
      expect(session.cullFar(1000)).toBe(1000);
    } finally {
      releaseGiants();
      session.dispose();
    }
  });

  it('keeps the native fallback while a streamed root waits for its own giant sprites', async () => {
    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0, 120, 340);
    const camera = new THREE.PerspectiveCamera();
    const webgl = {
      shadowMap: { enabled: false },
      render: vi.fn(),
    } as unknown as THREE.WebGLRenderer;
    let holdGiants = false;
    let releaseGiants!: () => void;
    const giantsHeld = new Promise<void>((resolve) => {
      releaseGiants = resolve;
    });
    const session = new LowSceneryBands({ run: async (work) => work() }, () => ({
      scene,
      camera,
      webgl,
      gate: async (root) => {
        if (holdGiants && root.name === 'scenery-band:giants') await giantsHeld;
      },
      outdoor: () => true,
    }));
    try {
      session.update(0, 0);
      await vi.waitFor(() => expect(session.snapshot()).toMatchObject({ stage: 'ready' }));
      session.update(0, 0);
      expect(session.cullFar(1000)).toBe(60);
      holdGiants = true;
      // A streamed replacement root carrying one giant tree.
      const root = new THREE.Group();
      root.name = 'garden-features';
      const landmark = new THREE.Group();
      landmark.position.set(150, 0, 0);
      const trunk = new THREE.Mesh(
        new THREE.BoxGeometry(6, 40, 6),
        new THREE.MeshLambertMaterial(),
      );
      trunk.name = 'TwistedTree_1';
      landmark.add(trunk);
      landmark.updateMatrixWorld(true);
      landmark.traverse((node) => {
        node.matrixAutoUpdate = false;
      });
      root.add(landmark);
      scene.add(root);
      session.registerRoot(root, true);
      session.update(0, 0);
      await vi.waitFor(() => expect(session.snapshot()).toMatchObject({ giantsPending: true }));
      session.update(0, 0);
      // The new bands hold the root, but no sprite exists for its giant yet:
      // that root alone keeps its native horizon and its giant tree, while
      // the rest of the view stays on the bands.
      expect(session.snapshot()).toMatchObject({ active: true });
      expect(session.cullFar(1000)).toBe(60);
      expect(session.cullFar(1000, landmark)).toBe(1000);
      expect(landmark.visible).toBe(true);
      releaseGiants();
      await vi.waitFor(() =>
        expect(session.snapshot()).toMatchObject({ pending: false, giantsPending: false }),
      );
      session.update(0, 0);
      expect(session.cullFar(1000, landmark)).toBe(60);
    } finally {
      releaseGiants();
      session.dispose();
    }
  });
  it('finishes a window for its own roots when a zone streams in mid-preparation', async () => {
    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0, 120, 340);
    const camera = new THREE.PerspectiveCamera();
    const webgl = {
      shadowMap: { enabled: false },
      render: vi.fn(),
    } as unknown as THREE.WebGLRenderer;
    const gated: string[] = [];
    let hold = false;
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const session = new LowSceneryBands({ run: async (work) => work() }, () => ({
      scene,
      camera,
      webgl,
      gate: async (root) => {
        gated.push(root.name);
        if (hold && root.name === 'scenery-band:middle') {
          hold = false;
          await held;
        }
      },
      outdoor: () => true,
    }));
    try {
      const existing = sources();
      scene.add(existing);
      session.registerRoot(existing);
      session.update(0, 0);
      await vi.waitFor(() => expect(session.snapshot()).toMatchObject({ stage: 'ready' }));
      gated.length = 0;
      hold = true;
      camera.position.set(40, 0, 0);
      session.update(40, 0);
      await vi.waitFor(() => expect(gated).toEqual(['scenery-band:middle']));
      // A replacement root streams in while the window waits on its gate.
      const streamed = sources();
      streamed.name = 'garden-features';
      streamed.position.x = 200;
      scene.add(streamed);
      session.registerRoot(streamed, true);
      session.update(40, 0);
      release();
      await vi.waitFor(() =>
        expect(session.snapshot()).toMatchObject({ stage: 'ready', pending: false }),
      );
      // The held window went on to its far band instead of restarting.
      expect(gated.slice(0, 2)).toEqual(['scenery-band:middle', 'scenery-band:far']);
      // The streamed root stays native until the next window, which follows.
      expect(session.cullFar(1000, streamed)).toBe(1000);
      expect(session.cullFar(1000)).toBe(60);
      session.update(40, 0);
      await vi.waitFor(() => expect(session.cullFar(1000, streamed)).toBe(60));
    } finally {
      release();
      session.dispose();
    }
  });
  it('keeps the held giant sprites for a short move instead of baking new ones', async () => {
    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0, 120, 340);
    const camera = new THREE.PerspectiveCamera();
    const webgl = {
      shadowMap: { enabled: false },
      render: vi.fn(),
    } as unknown as THREE.WebGLRenderer;
    const gated: string[] = [];
    const session = new LowSceneryBands({ run: async (work) => work() }, () => ({
      scene,
      camera,
      webgl,
      gate: async (root) => {
        gated.push(root.name);
      },
      outdoor: () => true,
    }));
    try {
      session.update(0, 0);
      await vi.waitFor(() => expect(session.snapshot()).toMatchObject({ stage: 'ready' }));
      expect(gated).toContain('scenery-band:giants');
      gated.length = 0;
      camera.position.set(40, 0, 0);
      session.update(40, 0);
      await vi.waitFor(() =>
        expect(session.snapshot()).toMatchObject({ stage: 'ready', pending: false }),
      );
      expect(gated).toEqual(['scenery-band:middle', 'scenery-band:far', 'scenery-band:outer']);
      session.update(40, 0);
      expect(session.cullFar(1000)).toBe(60);
    } finally {
      session.dispose();
    }
  });
  it('reuses band materials across windows and skips a gate whose programs are proven', async () => {
    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0, 120, 340);
    const camera = new THREE.PerspectiveCamera();
    // A context record per material: the gate stands in for a real link and
    // proves each program the way a settled gate does.
    const records = new Map<object, object>();
    const properties = { get: (object: object) => records.get(object) };
    const webgl = {
      shadowMap: { enabled: false },
      render: vi.fn(),
      properties,
    } as unknown as THREE.WebGLRenderer;
    const gated: string[] = [];
    const session = new LowSceneryBands({ run: async (work) => work() }, () => ({
      scene,
      camera,
      webgl,
      gate: async (root) => {
        gated.push(root.name);
        root.traverse((node) => {
          const mesh = node as THREE.Mesh;
          if (!mesh.isMesh) return;
          const program = {};
          records.set(mesh.material as THREE.Material, {
            programs: new Map([['key', program]]),
            currentProgram: program,
          });
        });
        markProgramsReadyUnder(properties as never, root);
      },
      outdoor: () => true,
    }));
    const bandMaterials = (): THREE.Material[] =>
      scene.children
        .filter(
          (node) => node.name.startsWith('scenery-band:') && node.name !== 'scenery-band:giants',
        )
        .flatMap((band) =>
          band.children.map((mesh) => (mesh as THREE.Mesh).material as THREE.Material),
        );
    try {
      const root = sources();
      scene.add(root);
      session.registerRoot(root);
      session.update(0, 0);
      await vi.waitFor(() => expect(session.snapshot()).toMatchObject({ stage: 'ready' }));
      // The far and outer bands share the middle band's materials, proven by
      // its gate, so only the first band and the sprites take a gate.
      expect(gated).toEqual(['scenery-band:middle', 'scenery-band:giants']);
      const first = bandMaterials();
      expect(first.length).toBeGreaterThan(0);
      expect(first.every((material) => material.name.startsWith('scenery-band:low:'))).toBe(true);
      const disposed = vi.fn();
      for (const material of first) material.addEventListener('dispose', disposed);
      gated.length = 0;
      camera.position.set(40, 0, 0);
      session.update(40, 0);
      await vi.waitFor(() =>
        expect(session.snapshot()).toMatchObject({ stage: 'ready', pending: false }),
      );
      // The next window's bands reuse the same, already proven materials:
      // no gate runs, and retiring the first window disposes none of them.
      expect(gated).toEqual([]);
      expect(new Set(bandMaterials())).toEqual(new Set(first));
      expect(disposed).not.toHaveBeenCalled();
      session.update(40, 0);
      expect(session.cullFar(1000)).toBe(60);
      session.dispose();
      expect(disposed).toHaveBeenCalledTimes(new Set(first).size);
    } finally {
      session.dispose();
    }
  });

  it('draws only the roots with giant trees natively while the sprites are out of coverage', async () => {
    const scene = new THREE.Scene();
    // At the 560 yd fog cap the sprites cover 70 yd and a rebake starts past 35.
    scene.fog = new THREE.Fog(0, 120, 560);
    const camera = new THREE.PerspectiveCamera();
    let holdGiants = false;
    let releaseGiants!: () => void;
    const giantsHeld = new Promise<void>((resolve) => {
      releaseGiants = resolve;
    });
    const session = new LowSceneryBands({ run: async (work) => work() }, () => ({
      scene,
      camera,
      webgl: bandWebgl(),
      gate: async (root) => {
        if (holdGiants && root.name === 'scenery-band:giants') await giantsHeld;
      },
      outdoor: () => true,
    }));
    try {
      const plain = sources();
      scene.add(plain);
      session.registerRoot(plain);
      const { root, landmark } = giantRoot(150);
      scene.add(root);
      session.registerRoot(root, true);
      session.update(0, 0);
      await vi.waitFor(() =>
        expect(session.snapshot()).toMatchObject({ stage: 'ready', giantsPending: false }),
      );
      session.update(0, 0);
      expect(session.cullFar(1000, landmark)).toBe(60);
      // A slow bake: the window at 40 yd starts one, then the camera walks on
      // to 80 yd, past the first sprites' 70 yd coverage, before it lands.
      holdGiants = true;
      camera.position.set(40, 0, 0);
      session.update(40, 0);
      await vi.waitFor(() =>
        expect(session.snapshot()).toMatchObject({ pending: false, giantsPending: true }),
      );
      camera.position.set(80, 0, 0);
      session.update(80, 0);
      await vi.waitFor(() => expect(session.snapshot()).toMatchObject({ pending: false }));
      session.update(80, 0);
      // Only the root that owns giants falls back; the rest keeps its bands.
      expect(session.snapshot()).toMatchObject({ active: true, giantsPending: true });
      expect(session.cullFar(1000)).toBe(60);
      expect(session.cullFar(1000, plain.children[0])).toBe(60);
      expect(session.cullFar(1000, landmark)).toBe(1000);
      releaseGiants();
      await vi.waitFor(() => expect(session.snapshot()).toMatchObject({ giantsPending: false }));
      session.update(80, 0);
      expect(session.cullFar(1000, landmark)).toBe(60);
    } finally {
      releaseGiants();
      session.dispose();
    }
  });

  it('retries a failed giant bake for the same window after a pause', async () => {
    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0, 120, 340);
    const camera = new THREE.PerspectiveCamera();
    let clock = 1000;
    const now = vi.spyOn(performance, 'now').mockImplementation(() => clock);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    let failGiants = true;
    let giantGates = 0;
    const session = new LowSceneryBands({ run: async (work) => work() }, () => ({
      scene,
      camera,
      webgl: bandWebgl(),
      gate: async (root) => {
        if (root.name !== 'scenery-band:giants') return;
        giantGates++;
        if (failGiants) throw new Error('atlas lost');
      },
      outdoor: () => true,
    }));
    try {
      const { root, landmark } = giantRoot(150);
      scene.add(root);
      session.registerRoot(root, true);
      session.update(0, 0);
      await vi.waitFor(() =>
        expect(session.snapshot()).toMatchObject({ stage: 'ready', giantsPending: false }),
      );
      expect(giantGates).toBe(1);
      expect(warn).toHaveBeenCalledWith(
        '[scenery-bands] retained previous giant sprites',
        expect.any(Error),
      );
      failGiants = false;
      // Standing still: no retry inside the pause, and the root stays native.
      session.update(0, 0);
      expect(giantGates).toBe(1);
      expect(session.cullFar(1000, landmark)).toBe(1000);
      clock += 10_001;
      session.update(0, 0);
      await vi.waitFor(() => expect(giantGates).toBe(2));
      await vi.waitFor(() => expect(session.snapshot()).toMatchObject({ giantsPending: false }));
      session.update(0, 0);
      expect(session.cullFar(1000, landmark)).toBe(60);
    } finally {
      session.dispose();
      now.mockRestore();
      warn.mockRestore();
    }
  });

  it('resumes a giant bake cancelled indoors once the camera is outdoors again', async () => {
    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0, 120, 340);
    const camera = new THREE.PerspectiveCamera();
    let outdoor = true;
    let holdGiants = true;
    let giantGates = 0;
    let releaseGiants!: () => void;
    const giantsHeld = new Promise<void>((resolve) => {
      releaseGiants = resolve;
    });
    const session = new LowSceneryBands({ run: async (work) => work() }, () => ({
      scene,
      camera,
      webgl: bandWebgl(),
      gate: async (root) => {
        if (root.name !== 'scenery-band:giants') return;
        giantGates++;
        if (holdGiants) await giantsHeld;
      },
      outdoor: () => outdoor,
    }));
    try {
      const { root, landmark } = giantRoot(150);
      scene.add(root);
      session.registerRoot(root, true);
      session.update(0, 0);
      await vi.waitFor(() => expect(session.snapshot()).toMatchObject({ giantsPending: true }));
      // Into an interior mid-bake: the bake is cancelled, nothing is retried.
      outdoor = false;
      session.update(0, 0);
      holdGiants = false;
      releaseGiants();
      await vi.waitFor(() => expect(session.snapshot()).toMatchObject({ giantsPending: false }));
      expect(giantGates).toBe(1);
      // Back outdoors at the same spot, with no new window: the bake resumes.
      outdoor = true;
      session.update(0, 0);
      await vi.waitFor(() => expect(giantGates).toBe(2));
      await vi.waitFor(() => expect(session.snapshot()).toMatchObject({ giantsPending: false }));
      session.update(0, 0);
      expect(session.cullFar(1000, landmark)).toBe(60);
    } finally {
      releaseGiants();
      session.dispose();
    }
  });

  it('releases band materials a gate relinked after the session let go', async () => {
    const scene = new THREE.Scene();
    const log: string[] = [];
    let entered = false;
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const session = new LowSceneryBands({ run: async (work) => work() }, () => ({
      scene,
      camera: new THREE.PerspectiveCamera(),
      webgl: bandWebgl(),
      gate: async (root) => {
        if (root.name !== 'scenery-band:middle') return;
        root.traverse((node) => {
          const mesh = node as THREE.Mesh;
          if (mesh.isMesh)
            (mesh.material as THREE.Material).addEventListener('dispose', () =>
              log.push('dispose'),
            );
        });
        entered = true;
        await held;
        log.push('settled');
      },
      outdoor: () => true,
    }));
    try {
      const root = sources();
      scene.add(root);
      session.registerRoot(root);
      session.update(0, 0);
      await vi.waitFor(() => expect(entered).toBe(true));
      // Disposed while the window's first gate still runs: the session
      // releases its materials at once, but the gate may still relink them.
      session.dispose();
      expect(log).toContain('dispose');
      expect(log).not.toContain('settled');
      release();
      await vi.waitFor(() => expect(log).toContain('settled'));
      // Released again once that gate has settled.
      await vi.waitFor(() =>
        expect(log.lastIndexOf('dispose')).toBeGreaterThan(log.indexOf('settled')),
      );
    } finally {
      release();
      session.dispose();
    }
  });

  it('takes the band gate again for materials neither on screen nor proven by the window', async () => {
    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0, 120, 340);
    const camera = new THREE.PerspectiveCamera();
    const gated: string[] = [];
    const { properties, gate } = provingGate(gated);
    const session = new LowSceneryBands({ run: async (work) => work() }, () => ({
      scene,
      camera,
      webgl: bandWebgl(properties),
      gate,
      outdoor: () => true,
    }));
    try {
      const root = sources();
      scene.add(root);
      session.registerRoot(root);
      session.update(0, 0);
      await vi.waitFor(() =>
        expect(session.snapshot()).toMatchObject({ stage: 'ready', pending: false }),
      );
      expect(gated).toContain('scenery-band:middle');
      // A window 1000 yd away holds none of the root's scenery.
      camera.position.set(1000, 0, 0);
      session.update(1000, 0);
      await vi.waitFor(() =>
        expect(session.snapshot()).toMatchObject({ stage: 'ready', pending: false }),
      );
      expect(bandMaterialsIn(scene)).toHaveLength(0);
      gated.length = 0;
      // Back again: the materials were proven long ago and are not on screen,
      // so the first band gates them; the later bands reuse that proof.
      camera.position.set(0, 0, 0);
      session.update(0, 0);
      await vi.waitFor(() =>
        expect(session.snapshot()).toMatchObject({ stage: 'ready', pending: false }),
      );
      expect(gated.filter((name) => name !== 'scenery-band:giants')).toEqual([
        'scenery-band:middle',
      ]);
    } finally {
      session.dispose();
    }
  });

  it('replaces a band material whose source texture arrived late, keeping the old one until dispose', async () => {
    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0, 120, 340);
    const camera = new THREE.PerspectiveCamera();
    const session = new LowSceneryBands({ run: async (work) => work() }, () => ({
      scene,
      camera,
      webgl: bandWebgl(),
      gate: async () => undefined,
      outdoor: () => true,
    }));
    try {
      const root = sources();
      const source = (root.children[0] as THREE.InstancedMesh)
        .material as THREE.MeshStandardMaterial;
      scene.add(root);
      session.registerRoot(root);
      session.update(0, 0);
      await vi.waitFor(() =>
        expect(session.snapshot()).toMatchObject({ stage: 'ready', pending: false }),
      );
      const first = bandMaterialsIn(scene) as THREE.MeshLambertMaterial[];
      expect(first.length).toBeGreaterThan(0);
      expect(first.every((material) => material.map === null)).toBe(true);
      const disposed = vi.fn();
      for (const material of first) material.addEventListener('dispose', disposed);
      // The source's texture lands after its band material was made, as a
      // procedural leaf atlas does.
      source.map = new THREE.Texture();
      camera.position.set(40, 0, 0);
      session.update(40, 0);
      await vi.waitFor(() =>
        expect(session.snapshot()).toMatchObject({ stage: 'ready', pending: false }),
      );
      const second = bandMaterialsIn(scene) as THREE.MeshLambertMaterial[];
      expect(second.length).toBeGreaterThan(0);
      expect(second.every((material) => material.map === source.map)).toBe(true);
      expect(second.some((material) => first.includes(material))).toBe(false);
      expect(disposed).not.toHaveBeenCalled();
      session.dispose();
      expect(disposed).toHaveBeenCalledTimes(new Set(first).size);
    } finally {
      session.dispose();
    }
  });

  it('keeps the ordinary trees of a giant-owning zone on bands while only its giant stays native', async () => {
    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0, 120, 340);
    const camera = new THREE.PerspectiveCamera();
    let releaseGiants!: () => void;
    const giantsHeld = new Promise<void>((resolve) => {
      releaseGiants = resolve;
    });
    const session = new LowSceneryBands({ run: async (work) => work() }, () => ({
      scene,
      camera,
      webgl: bandWebgl(),
      gate: async (root) => {
        if (root.name === 'scenery-band:giants') await giantsHeld;
      },
      outdoor: () => true,
    }));
    try {
      const { root, landmark } = giantRoot(150);
      const ordinary = ordinaryTree(root, 120);
      scene.add(root);
      session.registerRoot(root, true);
      session.update(0, 0);
      await vi.waitFor(() =>
        expect(session.snapshot()).toMatchObject({ stage: 'ready', giantsPending: true }),
      );
      session.update(0, 0);
      // No sprites yet: the giant stays native and its root keeps the native
      // horizon, but the root's ordinary tree is capped and drawn by a band.
      expect(session.snapshot()).toMatchObject({ active: true });
      expect(landmark.visible).toBe(true);
      expect(ordinary.visible).toBe(false);
      expect(session.cullFar(1000, landmark)).toBe(1000);
      const middle = scene.children.find((node) => node.name === 'scenery-band:middle')!;
      expect((middle.children[0] as THREE.Mesh).geometry.drawRange.count).toBeGreaterThan(0);
      releaseGiants();
      await vi.waitFor(() => expect(session.snapshot()).toMatchObject({ giantsPending: false }));
      session.update(0, 0);
      expect(landmark.visible).toBe(false);
      expect(session.cullFar(1000, landmark)).toBe(60);
      // ...and the landed sprites draw it instead.
      expect(giantBakeRoots.at(-1)?.userData.selected).toEqual([1]);
    } finally {
      releaseGiants();
      session.dispose();
    }
  });

  it('re-enters the giant sprites only well inside their coverage edge', async () => {
    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0, 120, 560);
    const camera = new THREE.PerspectiveCamera();
    let holdGiants = false;
    let releaseGiants!: () => void;
    const giantsHeld = new Promise<void>((resolve) => {
      releaseGiants = resolve;
    });
    const session = new LowSceneryBands({ run: async (work) => work() }, () => ({
      scene,
      camera,
      webgl: bandWebgl(),
      gate: async (root) => {
        if (holdGiants && root.name === 'scenery-band:giants') await giantsHeld;
      },
      outdoor: () => true,
    }));
    const at = async (x: number): Promise<void> => {
      camera.position.set(x, 0, 0);
      session.update(x, 0);
      await vi.waitFor(() => expect(session.snapshot()).toMatchObject({ pending: false }));
      session.update(x, 0);
    };
    try {
      const { root, landmark } = giantRoot(150);
      scene.add(root);
      session.registerRoot(root, true);
      session.update(0, 0);
      await vi.waitFor(() =>
        expect(session.snapshot()).toMatchObject({ stage: 'ready', giantsPending: false }),
      );
      holdGiants = true;
      // Sprites at 0 cover 70 yd under the 560 yd fog; the next bake hangs.
      await at(40);
      await at(75);
      expect(session.cullFar(1000, landmark)).toBe(1000);
      // Back inside the edge but within the 8 yd margin: still native.
      await at(66);
      expect(session.cullFar(1000, landmark)).toBe(1000);
      await at(60);
      expect(session.cullFar(1000, landmark)).toBe(60);
      // Once inside, the camera stays inside right up to the edge.
      await at(66);
      expect(session.cullFar(1000, landmark)).toBe(60);
      await at(71);
      expect(session.cullFar(1000, landmark)).toBe(1000);
    } finally {
      releaseGiants();
      session.dispose();
    }
  });

  it('abandons a giant bake that never settles and bakes again after the backoff', async () => {
    const h = giantBakeHarness((call) =>
      call === 1 ? new Promise<void>(() => undefined) : undefined,
    );
    try {
      h.session.update(0, 0);
      await vi.waitFor(() => expect(h.session.snapshot()).toMatchObject({ giantsPending: true }));
      h.clock.now += 120_001;
      h.session.update(0, 0);
      expect(h.session.snapshot()).toMatchObject({ giantsPending: false });
      expect(h.warn).toHaveBeenCalledWith(
        '[scenery-bands] abandoned a giant bake that did not settle',
      );
      expect(h.calls()).toBe(1);
      // The stuck bake's awaits are aborted, so it releases what it baked.
      const stuck = giantBakeRoots.at(-1)!;
      await vi.waitFor(() => expect(stuck.userData.released).toBe(true));
      expect(h.session.snapshot()).toMatchObject({ giantsPending: false, giantsFailures: 1 });
      h.clock.now += 10_001;
      h.session.update(0, 0);
      await vi.waitFor(() => expect(h.calls()).toBe(2));
      await vi.waitFor(() => expect(h.session.snapshot()).toMatchObject({ giantsPending: false }));
      h.session.update(0, 0);
      expect(h.session.cullFar(1000, h.landmark)).toBe(60);
    } finally {
      h.restore();
    }
  });

  it('doubles the pause between giant bakes that keep failing', async () => {
    const h = giantBakeHarness(() => {
      throw new Error('atlas lost');
    });
    const settle = () =>
      vi.waitFor(() => expect(h.session.snapshot()).toMatchObject({ giantsPending: false }));
    try {
      h.session.update(0, 0);
      await vi.waitFor(() => expect(h.calls()).toBe(1));
      await settle();
      h.clock.now += 10_001;
      h.session.update(0, 0);
      await vi.waitFor(() => expect(h.calls()).toBe(2));
      await settle();
      // The second failure waits 20 s, not 10.
      h.clock.now += 10_001;
      h.session.update(0, 0);
      expect(h.calls()).toBe(2);
      h.clock.now += 10_000;
      h.session.update(0, 0);
      await vi.waitFor(() => expect(h.calls()).toBe(3));
    } finally {
      h.restore();
    }
  });

  it('stops baking giants once the GPU queue has shut down', async () => {
    const h = giantBakeHarness(() => {
      const error = new Error('Background GPU queue is shut down');
      error.name = GPU_QUEUE_SHUTDOWN_ERROR_NAME;
      throw error;
    });
    try {
      h.session.update(0, 0);
      await vi.waitFor(() => expect(h.calls()).toBe(1));
      await vi.waitFor(() => expect(h.session.snapshot()).toMatchObject({ giantsPending: false }));
      for (let i = 0; i < 5; i++) {
        h.clock.now += 600_000;
        h.session.update(0, 0);
      }
      expect(h.calls()).toBe(1);
      expect(h.session.snapshot()).toMatchObject({ giantsStopped: true });
      expect(h.warn).not.toHaveBeenCalledWith(
        '[scenery-bands] retained previous giant sprites',
        expect.anything(),
      );
    } finally {
      h.restore();
    }
  });

  it('rebuilds a band material whose source texture lands while the camera stands still', async () => {
    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0, 120, 340);
    let clock = 1000;
    const now = vi.spyOn(performance, 'now').mockImplementation(() => clock);
    const session = new LowSceneryBands({ run: async (work) => work() }, () => ({
      scene,
      camera: new THREE.PerspectiveCamera(),
      webgl: bandWebgl(),
      gate: async () => undefined,
      outdoor: () => true,
    }));
    try {
      const root = sources();
      const source = (root.children[0] as THREE.InstancedMesh)
        .material as THREE.MeshStandardMaterial;
      scene.add(root);
      session.registerRoot(root);
      session.update(0, 0);
      await vi.waitFor(() =>
        expect(session.snapshot()).toMatchObject({ stage: 'ready', pending: false }),
      );
      session.update(0, 0);
      const first = bandMaterialsIn(scene) as THREE.MeshLambertMaterial[];
      expect(first.every((material) => material.map === null)).toBe(true);
      source.map = new THREE.Texture();
      // Inside the check interval nothing is rebuilt.
      session.update(0, 0);
      expect(session.snapshot()).toMatchObject({ pending: false });
      clock += 2001;
      session.update(0, 0);
      await vi.waitFor(() => {
        const current = bandMaterialsIn(scene) as THREE.MeshLambertMaterial[];
        expect(current.length).toBeGreaterThan(0);
        expect(current.every((material) => material.map === source.map)).toBe(true);
      });
    } finally {
      session.dispose();
      now.mockRestore();
    }
  });

  it('measures giant coverage against the fog the bands draw under, not a raw far fog', async () => {
    const scene = new THREE.Scene();
    // A raw 1050 yd fog is drawn at 560 while the bands are active, so the
    // sprites cover 70 yd, not the 64 yd floor a raw fog would give.
    scene.fog = new THREE.Fog(0, 400, 1050);
    const camera = new THREE.PerspectiveCamera();
    let holdGiants = false;
    let releaseGiants!: () => void;
    const giantsHeld = new Promise<void>((resolve) => {
      releaseGiants = resolve;
    });
    const session = new LowSceneryBands({ run: async (work) => work() }, () => ({
      scene,
      camera,
      webgl: bandWebgl(),
      gate: async (root) => {
        if (holdGiants && root.name === 'scenery-band:giants') await giantsHeld;
      },
      outdoor: () => true,
    }));
    try {
      const { root, landmark } = giantRoot(150);
      scene.add(root);
      session.registerRoot(root, true);
      session.update(0, 0);
      await vi.waitFor(() =>
        expect(session.snapshot()).toMatchObject({ stage: 'ready', giantsPending: false }),
      );
      session.update(0, 0);
      holdGiants = true;
      camera.position.set(40, 0, 0);
      session.update(40, 0);
      await vi.waitFor(() =>
        expect(session.snapshot()).toMatchObject({ pending: false, giantsPending: true }),
      );
      camera.position.set(67, 0, 0);
      session.update(67, 0);
      expect(session.cullFar(1000, landmark)).toBe(60);
    } finally {
      releaseGiants();
      session.dispose();
    }
  });

  it('keeps a giant drawn on the frame its sprites lose coverage, in renderer order', async () => {
    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0, 120, 560);
    const camera = new THREE.PerspectiveCamera();
    let holdGiants = false;
    let releaseGiants!: () => void;
    const giantsHeld = new Promise<void>((resolve) => {
      releaseGiants = resolve;
    });
    const session = new LowSceneryBands({ run: async (work) => work() }, () => ({
      scene,
      camera,
      webgl: bandWebgl(),
      gate: async (root) => {
        if (holdGiants && root.name === 'scenery-band:giants') await giantsHeld;
      },
      outdoor: () => true,
    }));
    try {
      const { root, landmark } = giantRoot(150);
      scene.add(root);
      session.registerRoot(root, true);
      // The renderer sweeps zone features (cullFar) before the band update.
      const frame = (x: number): void => {
        camera.position.set(x, 0, 0);
        root.visible = 147 - x <= session.cullFar(1000, root);
        session.update(x, 0);
      };
      frame(0);
      await vi.waitFor(() =>
        expect(session.snapshot()).toMatchObject({ stage: 'ready', giantsPending: false }),
      );
      frame(0);
      // The sprites that landed; the next bake (held) never replaces them.
      const sprites = giantBakeRoots.at(-1)!;
      holdGiants = true;
      frame(40);
      await vi.waitFor(() =>
        expect(session.snapshot()).toMatchObject({ pending: false, giantsPending: true }),
      );
      frame(56);
      expect(sprites.userData.selected).toEqual([1]);
      // 71 yd: just past the 70 yd coverage, within the window at 40 yd. The
      // sweep still cut the root at 60 yd this frame, so the giant must stay
      // on its sprite until the next frame draws it natively.
      frame(71);
      const drawn = (): boolean =>
        (landmark.visible && root.visible) || sprites.userData.selected[0] === 1;
      expect(drawn()).toBe(true);
      frame(71);
      expect(root.visible && landmark.visible).toBe(true);
      expect(sprites.userData.selected).toEqual([0]);
    } finally {
      releaseGiants();
      session.dispose();
    }
  });

  it('exempts a streamed giant root for the sweep that runs before the next update', async () => {
    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0, 120, 340);
    const camera = new THREE.PerspectiveCamera();
    let releaseGiants!: () => void;
    const giantsHeld = new Promise<void>((resolve) => {
      releaseGiants = resolve;
    });
    const session = new LowSceneryBands({ run: async (work) => work() }, () => ({
      scene,
      camera,
      webgl: bandWebgl(),
      gate: async (root) => {
        if (root.name === 'scenery-band:giants') await giantsHeld;
      },
      outdoor: () => true,
    }));
    try {
      session.update(0, 0);
      await vi.waitFor(() => expect(session.snapshot()).toMatchObject({ stage: 'ready' }));
      session.update(0, 0);
      const { root, landmark } = giantRoot(150);
      scene.add(root);
      session.registerRoot(root, true);
      session.update(0, 0);
      await vi.waitFor(() =>
        expect(session.snapshot()).toMatchObject({ pending: false, giantsPending: true }),
      );
      // The window holding the root committed between frames. Before any
      // update, the sweep must already keep the root's native horizon for its
      // giant, which no sprite holds yet.
      expect(session.cullFar(1000, landmark)).toBe(1000);
    } finally {
      releaseGiants();
      session.dispose();
    }
  });

  it('resets the giant backoff after a bake succeeds', async () => {
    const h = giantBakeHarness((call) => {
      if (call === 1 || call === 3) throw new Error('atlas lost');
    });
    const settle = () =>
      vi.waitFor(() => expect(h.session.snapshot()).toMatchObject({ giantsPending: false }));
    try {
      h.session.update(0, 0);
      await vi.waitFor(() => expect(h.calls()).toBe(1));
      await settle();
      h.clock.now += 10_001;
      h.session.update(0, 0);
      await vi.waitFor(() => expect(h.calls()).toBe(2));
      await settle();
      expect(h.session.snapshot()).toMatchObject({ giantsFailures: 0 });
      // A window 200 yd on is due new sprites; that bake fails once more.
      h.session.update(200, 0);
      await vi.waitFor(() => expect(h.calls()).toBe(3));
      await settle();
      // After a success the pause starts over at 10 s, not 20.
      h.clock.now += 10_001;
      h.session.update(200, 0);
      await vi.waitFor(() => expect(h.calls()).toBe(4));
    } finally {
      h.restore();
    }
  });

  it('does not rebake for a far giant of a zone the sprites already collected', async () => {
    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0, 120, 340);
    const camera = new THREE.PerspectiveCamera();
    let giantGates = 0;
    const session = new LowSceneryBands({ run: async (work) => work() }, () => ({
      scene,
      camera,
      webgl: bandWebgl(),
      gate: async (root) => {
        if (root.name === 'scenery-band:giants') giantGates++;
      },
      outdoor: () => true,
    }));
    try {
      // One zone, two giants: 150 yd out, and 700 yd out (past the first
      // window's 630 yd collection radius).
      const { root } = giantRoot(150);
      const far = giantRoot(700).landmark;
      root.add(far);
      scene.add(root);
      session.registerRoot(root, true);
      session.update(0, 0);
      await vi.waitFor(() =>
        expect(session.snapshot()).toMatchObject({ stage: 'ready', giantsPending: false }),
      );
      expect(giantGates).toBe(1);
      // 100 yd on, the far giant enters the window. The sprites lack it, but
      // they collected its zone and it is far past the fog, so nothing rebakes
      // and the zone keeps its bands.
      camera.position.set(100, 0, 0);
      session.update(100, 0);
      await vi.waitFor(() =>
        expect(session.snapshot()).toMatchObject({ stage: 'ready', pending: false }),
      );
      session.update(100, 0);
      expect(session.snapshot()).toMatchObject({ giantsPending: false });
      expect(giantGates).toBe(1);
      expect(session.cullFar(1000, far)).toBe(60);
    } finally {
      session.dispose();
    }
  });

  it('caps the pause between failing giant bakes at 160 s', async () => {
    const h = giantBakeHarness(() => {
      throw new Error('atlas lost');
    });
    try {
      h.session.update(0, 0);
      await vi.waitFor(() => expect(h.calls()).toBe(1));
      for (const [i, pause] of [10_000, 20_000, 40_000, 80_000, 160_000, 160_000].entries()) {
        await vi.waitFor(() =>
          expect(h.session.snapshot()).toMatchObject({ giantsPending: false }),
        );
        h.clock.now += pause - 1;
        h.session.update(0, 0);
        expect(h.calls()).toBe(i + 1);
        h.clock.now += 2;
        h.session.update(0, 0);
        await vi.waitFor(() => expect(h.calls()).toBe(i + 2));
      }
    } finally {
      h.restore();
    }
  });
});
