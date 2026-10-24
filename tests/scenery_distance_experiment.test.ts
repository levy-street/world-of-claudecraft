import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { installSceneryDistanceExperiment } from '../scripts/lib/scenery_distance_experiment.mjs';

function rig() {
  const scene = new THREE.Scene();
  const root = new THREE.Group();
  root.name = 'jungle-features';
  scene.add(root);
  const mesh = new THREE.InstancedMesh(
    new THREE.BoxGeometry(20, 10, 20),
    new THREE.MeshBasicMaterial(),
    3,
  );
  for (const [i, x] of [0, 130, 300].entries()) {
    mesh.setMatrixAt(i, new THREE.Matrix4().makeTranslation(x, 0, 0));
    mesh.setColorAt(i, new THREE.Color(i / 3, 0.2, 0.3));
  }
  root.add(mesh);
  const landmark = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
  root.add(landmark);
  const actor = mesh.clone();
  scene.add(actor);
  scene.updateMatrixWorld(true);
  const renderer = {
    scene,
    camera: new THREE.PerspectiveCamera(),
    foliage: { update: vi.fn((..._args: unknown[]) => 'original') },
    entryDetailHorizon: { sceneryCullFar: vi.fn((distance: number) => distance) },
    updateZoneFeatureVisibility: vi.fn((_distance: number) => undefined),
    zoneFeatureGroups: [{ group: root }],
    webgl: { shadowMap: { enabled: false }, render: vi.fn((_scene: THREE.Scene) => undefined) },
  };
  return { renderer, mesh, actor, landmark, root };
}

describe('research scenery distance controller', () => {
  it('suppresses scenery only during the diagnostic draw and restores flags even on failure', () => {
    const { renderer, root, actor } = rig();
    root.userData.renderCategory = 'props';
    actor.userData.renderCategory = 'entity:mob';
    const original = renderer.webgl.render;
    original.mockImplementation(() => {
      expect(root.visible).toBe(false);
      expect(actor.visible).toBe(true);
      throw Error('draw failed');
    });
    const controller = installSceneryDistanceExperiment(renderer);
    controller.setSceneryOff(true);
    expect(() => renderer.webgl.render(renderer.scene)).toThrow('draw failed');
    expect(root.visible).toBe(true);
    expect(controller.snapshot().suppressedRoots).toBe(1);
    controller.setSceneryOff(false);
    original.mockImplementation(() => {
      expect(root.visible).toBe(true);
      expect(actor.visible).toBe(true);
    });
    renderer.webgl.render(renderer.scene);
    expect(controller.snapshot().suppressedRoots).toBe(0);
    controller.dispose();
    expect(renderer.webgl.render).toBe(original);
  });
  it('keeps every palm part when only the canopy crosses the cutoff, without packing gardens', () => {
    const { renderer, mesh, root } = rig();
    const trunk = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 10, 1), mesh.material, 3);
    trunk.instanceMatrix.array.set(mesh.instanceMatrix.array);
    root.add(trunk);
    const garden = root.clone();
    garden.name = 'garden-features';
    renderer.scene.add(garden);
    renderer.scene.updateMatrixWorld(true);
    const controller = installSceneryDistanceExperiment(renderer);
    controller.set(120);
    expect(controller.snapshot().entries.map((e) => e.indices)).toEqual([
      [0, 1],
      [0, 1],
    ]);
    expect((garden.children[0] as THREE.InstancedMesh).count).toBe(3);
    controller.dispose();
  });
  it('keeps footprint-edge and nearby instances, exact transforms/colors, and restores everything', () => {
    const { renderer, mesh, actor, landmark } = rig();
    const matrices = mesh.instanceMatrix.array.slice();
    const colors = mesh.instanceColor?.array.slice();
    const original = renderer.foliage.update;
    const controller = installSceneryDistanceExperiment(renderer);
    controller.set(120);
    expect(controller.snapshot().entries[0].indices).toEqual([0, 1]);
    expect(mesh.count).toBe(2);
    expect(actor.count).toBe(3);
    expect(landmark.visible).toBe(true);
    renderer.camera.position.x = 300;
    const args = [0, 0, 0, 0, 0, 0, 0, 0, 100, 340, 120, 340, 900, 0.05];
    expect(Reflect.apply(renderer.foliage.update, renderer.foliage, args)).toBe('original');
    expect(original.mock.calls.at(-1)?.[9]).toBe(120);
    expect(args[9]).toBe(340);
    expect(controller.snapshot().entries[0].indices).toEqual([2]);
    expect(controller.snapshot().entries[0].placementsExact).toBe(true);
    expect(Array.from(mesh.instanceColor?.array.slice(0, 3) ?? [])).toEqual(
      Array.from(colors?.slice(6, 9) ?? []),
    );
    controller.dispose();
    controller.dispose();
    expect(renderer.foliage.update).toBe(original);
    expect(mesh.count).toBe(3);
    expect(mesh.instanceMatrix.array).toEqual(matrices);
    expect(mesh.instanceColor?.array).toEqual(colors);
  });

  it('never extends an existing shorter cull, and repacks only after movement', () => {
    const { renderer } = rig();
    const original = renderer.foliage.update;
    const controller = installSceneryDistanceExperiment(renderer);
    controller.set(80);
    const serial = controller.snapshot().serial;
    Reflect.apply(renderer.foliage.update, renderer.foliage, Array(10).fill(70));
    expect(original.mock.calls.at(-1)?.[9]).toBe(70);
    expect(controller.snapshot().serial).toBe(serial);
    expect(() => controller.set(20)).toThrow('Unsupported');
    controller.set(0);
    const restoredSerial = controller.snapshot().serial;
    renderer.camera.position.x = 100;
    Reflect.apply(renderer.foliage.update, renderer.foliage, Array(10).fill(70));
    expect(controller.snapshot().serial).toBe(restoredSerial);
    controller.dispose();
  });

  it('caps the shared prop/town horizon and zone sweep, hides far landmarks, and restores all hooks', () => {
    const { renderer, root } = rig();
    const originalHorizon = renderer.entryDetailHorizon.sceneryCullFar;
    const originalSweep = renderer.updateZoneFeatureVisibility;
    const tree = new THREE.Group();
    const trunk = new THREE.Mesh(new THREE.BoxGeometry(10, 40, 10), new THREE.MeshBasicMaterial());
    tree.add(trunk);
    tree.position.x = 200;
    root.add(tree);
    const near = tree.clone();
    near.position.x = 30;
    root.add(near);
    renderer.scene.updateMatrixWorld(true);
    for (const object of [tree, near])
      object.traverse((node) => {
        node.matrixAutoUpdate = false;
      });
    const controller = installSceneryDistanceExperiment(renderer);
    for (const distance of [120, 80, 60]) {
      controller.set(distance);
      expect(renderer.entryDetailHorizon.sceneryCullFar(340)).toBe(distance);
      renderer.updateZoneFeatureVisibility(340);
      expect(originalSweep).toHaveBeenLastCalledWith(distance);
      expect(tree.visible).toBe(false);
      expect(near.visible).toBe(true);
    }
    controller.set(0);
    expect(tree.visible).toBe(true);
    expect(renderer.entryDetailHorizon.sceneryCullFar(340)).toBe(340);
    controller.dispose();
    expect(renderer.entryDetailHorizon.sceneryCullFar).toBe(originalHorizon);
    expect(renderer.updateZoneFeatureVisibility).toBe(originalSweep);
    expect(tree.visible).toBe(true);
  });

  it('fails before modifying unsupported sources and rejects shadows', () => {
    const { renderer, mesh } = rig();
    const original = renderer.foliage.update;
    mesh.geometry.setAttribute(
      'custom',
      new THREE.InstancedBufferAttribute(new Float32Array(3), 1),
    );
    expect(() => installSceneryDistanceExperiment(renderer)).toThrow('Unsupported');
    expect(renderer.foliage.update).toBe(original);
    expect(mesh.count).toBe(3);
    renderer.webgl.shadowMap.enabled = true;
    expect(() => installSceneryDistanceExperiment(renderer)).toThrow('shadows');
  });

  it('measures full bounds through parent transforms and registers newly attached static rows', () => {
    const { renderer, mesh, root } = rig();
    root.position.x = -100;
    root.scale.setScalar(2);
    renderer.scene.updateMatrixWorld(true);
    const controller = installSceneryDistanceExperiment(renderer);
    controller.set(120);
    expect(controller.snapshot().entries[0].indices).toEqual([0]);
    const added = new THREE.InstancedMesh(mesh.geometry, mesh.material, 1);
    added.setMatrixAt(0, new THREE.Matrix4());
    root.add(added);
    renderer.scene.updateMatrixWorld(true);
    controller.refresh();
    expect(controller.snapshot().entries).toHaveLength(2);
    expect(added.count).toBe(1);
    controller.set(0);
    expect(mesh.count).toBe(3);
    controller.dispose();
  });
});
