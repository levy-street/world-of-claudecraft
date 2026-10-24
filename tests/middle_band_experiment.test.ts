import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import {
  bandDistance,
  collectMiddleBandScenery,
  inMiddleBand,
  installMiddleBandExperiment,
} from '../scripts/lib/middle_band_experiment.mjs';
import { installSceneryDistanceExperiment } from '../scripts/lib/scenery_distance_experiment.mjs';

import { sceneryFixture as fixture } from './helpers/scenery_fixture';

describe('middle-distance research representations', () => {
  it('uses whole bounds for landmarks and the original origin law for foliage', () => {
    const item = { kind: 'landmark', bounds: [100, 160, -10, 10], x: 130, z: 0 };
    expect(bandDistance(item.bounds, 0, 0)).toBe(100);
    expect(inMiddleBand(item, 0, 0)).toBe(true);
    expect(inMiddleBand({ ...item, kind: 'foliage' }, 0, 0)).toBe(false);
    expect(inMiddleBand({ ...item, bounds: [64, 160, -10, 10] }, 0, 0)).toBe(false);
    expect(inMiddleBand({ ...item, bounds: [121, 160, -10, 10] }, 0, 0)).toBe(false);
  });
  it('unites trunk and canopy placements, retaining exact transforms and excluding actors', () => {
    const { renderer, mesh, root } = fixture();
    const canopy = new THREE.InstancedMesh(new THREE.BoxGeometry(20, 4, 20), mesh.material, 2);
    canopy.instanceMatrix.array.set(mesh.instanceMatrix.array);
    root.add(canopy);
    const actor = mesh.clone();
    actor.name = 'actor';
    renderer.scene.add(actor);
    const items = collectMiddleBandScenery(renderer);
    expect(items).toHaveLength(2);
    expect(items[1].parts).toHaveLength(2);
    expect(items[1].bounds).toEqual([80, 100, -10, 10]);
    expect(items[1].parts[0].matrix.elements[12]).toBe(90);
  });
  it('draws no simple geometry for an initially empty band, including after mode switches', async () => {
    const { renderer } = fixture(30),
      distance = installSceneryDistanceExperiment(renderer),
      original = renderer.foliage.update;
    const experiment = await installMiddleBandExperiment(renderer, distance);
    experiment.set('simple');
    const root = renderer.scene.getObjectByName('research-middle-band');
    if (!root) throw Error('Missing prepared root');
    root.children[0].traverse((n) => {
      if ((n as THREE.Mesh).isMesh) expect((n as THREE.Mesh).geometry.drawRange.count).toBe(0);
    });
    expect(experiment.snapshot().active).toEqual([]);
    experiment.set('sprites');
    experiment.set('simple');
    expect(experiment.snapshot().active).toEqual([]);
    experiment.dispose();
    expect(renderer.foliage.update).toBe(original);
    expect(root.parent).toBe(null);
    distance.dispose();
  });
  it('keeps the same middle-band membership, leaves sources untouched, and restores hooks', async () => {
    const { renderer, mesh } = fixture(),
      matrix = mesh.instanceMatrix.array.slice(),
      geometry = mesh.geometry,
      material = mesh.material;
    const original = renderer.foliage.update,
      distance = installSceneryDistanceExperiment(renderer),
      experiment = await installMiddleBandExperiment(renderer, distance);
    expect(distance.retains(mesh, 0)).toBe(true);
    expect(distance.retains(mesh, 1)).toBe(false);
    experiment.set('simple');
    expect(experiment.snapshot().active).toEqual([1]);
    experiment.set('sprites');
    expect(experiment.snapshot().active).toEqual([1]);
    expect(mesh.geometry).toBe(geometry);
    expect(mesh.material).toBe(material);
    expect(renderer.compileGate).toHaveBeenCalledOnce();
    renderer.camera.position.x = 80;
    renderer.foliage.update();
    expect(experiment.snapshot().active).toEqual([]);
    experiment.dispose();
    experiment.dispose();
    distance.dispose();
    expect(mesh.instanceMatrix.array).toEqual(matrix);
    expect(renderer.foliage.update).toBe(original);
  });
  it('cleans up failed preparation without changing source draw ownership', async () => {
    const { renderer, mesh } = fixture(),
      distance = installSceneryDistanceExperiment(renderer),
      original = renderer.foliage.update;
    renderer.compileGate.mockRejectedValueOnce(Error('gate rejected'));
    await expect(installMiddleBandExperiment(renderer, distance)).rejects.toThrow('gate rejected');
    expect(renderer.scene.getObjectByName('research-middle-band')).toBeUndefined();
    expect(renderer.foliage.update).toBe(original);
    expect(mesh.count).toBe(2);
    expect(distance.snapshot().cap).toBe(0);
    distance.dispose();
  });
  it('restores render target and state when an atlas draw fails', async () => {
    const { renderer, mesh } = fixture();
    const geometryDispose = vi.fn();
    mesh.geometry.addEventListener('dispose', geometryDispose);
    renderer.webgl.render.mockImplementationOnce(() => {
      throw Error('bake failed');
    });
    const distance = installSceneryDistanceExperiment(renderer);
    await expect(installMiddleBandExperiment(renderer, distance)).rejects.toThrow('bake failed');
    expect(renderer.webgl.setRenderTarget).toHaveBeenLastCalledWith(null);
    expect(renderer.webgl.setScissorTest).toHaveBeenLastCalledWith(false);
    expect(renderer.webgl.setClearColor).toHaveBeenLastCalledWith(expect.any(THREE.Color), 1);
    expect(renderer.webgl.autoClear).toBe(true);
    expect(geometryDispose).not.toHaveBeenCalled();
    expect(distance.snapshot().cap).toBe(0);
    distance.dispose();
  });
});
