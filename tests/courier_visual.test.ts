import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CourierVisual, courierPreloadInternalsForTest } from '../src/render/courier_visual';

afterEach(() => courierPreloadInternalsForTest.setSourceForTest(null));

function setup() {
  const source = new THREE.Group();
  const geometry = new THREE.BoxGeometry();
  const material = new THREE.MeshStandardMaterial();
  source.add(new THREE.Mesh(geometry, material));
  for (const name of ['WingLeft', 'WingRight']) {
    const wing = new THREE.Group();
    wing.name = name;
    source.add(wing);
  }
  courierPreloadInternalsForTest.setSourceForTest(source);
  const scene = new THREE.Scene();
  let finish = () => {};
  const pending = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const gate = vi.fn(() => pending);
  const ground = vi.fn(() => 7);
  const view = new CourierVisual(scene, ground, gate);
  return { view, source, scene, gate, ground, finish, geometry, material };
}

describe('CourierVisual lifecycle', () => {
  it('gates the first attach and reuses the same root across snapshots and journeys', async () => {
    const { view, scene, gate, finish, source, ground } = setup();
    const info = { phase: 'outbound' as const, x: 4, z: 8 };
    view.update(info, 0.05, true);
    expect(scene.children).toEqual([view.root]);
    expect(view.root.visible).toBe(false);
    view.update({ ...info, x: 5 }, 0.05, true);
    expect(view.root.visible).toBe(false);
    expect(view.root.position.toArray()).toEqual([5, 9, 8]);
    expect(ground).toHaveBeenLastCalledWith(5, 8);
    expect(view.root.rotation.y).toBe(Math.PI / 2);
    expect(source.getObjectByName('WingLeft')?.rotation.z).toBe(0);
    finish();
    await Promise.resolve();
    expect(view.root.visible).toBe(true);
    view.update(null, 0.05, false);
    expect(view.root.children[0].visible).toBe(false);
    view.update(info, 0.05, true);
    expect(view.root.children[0].visible).toBe(true);
    expect(gate).toHaveBeenCalledTimes(1);
    view.dispose();
  });
  it('does not resurrect a cancelled journey when its gate finishes late', async () => {
    const { view, finish } = setup();
    view.update({ phase: 'ready', x: 0, z: 0 }, 0, false);
    view.update(null, 0, false);
    finish();
    await Promise.resolve();
    expect(view.root.children[0].visible).toBe(false);
    view.dispose();
  });
  it('cancels pending reveal on disposal without disposing shared asset resources', async () => {
    const { view, finish, scene, geometry, material } = setup();
    const geometryDispose = vi.spyOn(geometry, 'dispose');
    const materialDispose = vi.spyOn(material, 'dispose');
    view.update({ phase: 'returning', x: 3, z: 1 }, 0.05, false);
    view.dispose();
    finish();
    await Promise.resolve();
    await Promise.resolve();
    expect(scene.children).toEqual([]);
    expect(view.root.visible).toBe(false);
    expect(geometryDispose).not.toHaveBeenCalled();
    expect(materialDispose).not.toHaveBeenCalled();
    view.update({ phase: 'ready', x: 0, z: 0 }, 0.05, false);
    expect(scene.children).toEqual([]);
  });
  it('adds nothing until the deferred asset is ready', () => {
    const { view, scene, gate } = setup();
    courierPreloadInternalsForTest.setSourceForTest(null);
    view.update({ phase: 'ready', x: 0, z: 0 }, 0.05, false);
    expect(scene.children).toEqual([]);
    expect(gate).not.toHaveBeenCalled();
    view.dispose();
  });
});
