import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { attachSceneGroupGated } from '../src/render/gated_scene_attach';
import { measureFeatureFootprint } from '../src/render/renderer_diagnostics';
import { buildSceneryBand } from '../src/render/scenery_bands/batches';
import { collectSceneryPlacements } from '../src/render/scenery_bands/collect';
import { SceneryIndexCache } from '../src/render/scenery_bands/geometry';
import { lowSceneryBandMaterial, sceneryBandMaterial } from '../src/render/scenery_bands/material';
import { SceneryNearSources } from '../src/render/scenery_bands/near';
import { LowSceneryBands, sceneryBandsHost } from '../src/render/scenery_bands/session';
import {
  sweepZoneFeatures,
  type ZoneFeatureEntry,
  zoneFeatureEntryFor,
} from '../src/render/zone_feature_sweep';

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
});
