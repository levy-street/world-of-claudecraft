import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { installMiddleBandExperiment } from '../scripts/lib/middle_band_experiment.mjs';
import { installSceneryDistanceExperiment } from '../scripts/lib/scenery_distance_experiment.mjs';
import { installSceneryQualityExperiment } from '../scripts/lib/scenery_quality_experiment.mjs';

import { sceneryFixture as fixture } from './helpers/scenery_fixture';

describe('quality and skyline research', () => {
  it('keeps separate reductions for shared tree geometry across a zone boundary', async () => {
    const { renderer, mesh } = fixture(90);
    mesh.geometry = new THREE.SphereGeometry(10, 32, 24);
    mesh.material.name = 'Leaves_NormalTree';
    mesh.setMatrixAt(0, new THREE.Matrix4().makeTranslation(-90, 0, 0));
    const distance = installSceneryDistanceExperiment(renderer);
    const experiment = await installMiddleBandExperiment(renderer, distance, {
      quality: true,
      palmZone: { xMin: -120, xMax: 0, zMin: -20, zMax: 20 },
    });
    experiment.set('regional');
    const regional = experiment.snapshot();
    expect(regional.active).toHaveLength(2);
    const reductions = regional.stats.filter((s) => s.mode === 'regional');
    expect(reductions).toHaveLength(2);
    expect(reductions.find((s) => s.palm)?.after).toBeLessThanOrEqual(256);
    expect(reductions.find((s) => !s.palm)?.after).toBe(
      regional.stats.find((s) => s.mode === 'quality')?.after,
    );
    experiment.set('quality');
    expect(experiment.snapshot().active).toEqual(regional.active);
    experiment.dispose();
    distance.dispose();
  });
  it('switches only distant representation, restores fog after errors, and disposes owned roots', async () => {
    const { renderer, root, mesh } = fixture(300);
    const fog = new THREE.Fog(0x888888, 80, 900);
    renderer.scene.fog = fog;
    const giant = new THREE.Group();
    const crown = new THREE.Mesh(
      new THREE.BoxGeometry(20, 30, 20),
      new THREE.MeshLambertMaterial(),
    );
    crown.name = 'TwistedTree_1';
    giant.add(crown);
    giant.position.x = 190;
    giant.updateMatrix();
    giant.traverse((n) => {
      n.matrixAutoUpdate = false;
    });
    root.add(giant);
    renderer.scene.updateMatrixWorld(true);
    const update = renderer.foliage.update;
    const render = renderer.webgl.render;
    const sourceDispose = vi.fn();
    mesh.geometry.addEventListener('dispose', sourceDispose);
    const distance = installSceneryDistanceExperiment(renderer);
    const experiment = await installSceneryQualityExperiment(renderer, distance, {
      palmZone: { xMin: -120, xMax: 0, zMin: -20, zMax: 20 },
    });
    expect(experiment.snapshot().far.active).toHaveLength(1);
    experiment.set('quality');
    expect(experiment.snapshot().middle.mode).toBe('quality');
    experiment.set('horizon');
    expect(experiment.snapshot().far.active).toHaveLength(0);
    expect(experiment.snapshot().giants.active).toHaveLength(1);
    expect(experiment.snapshot().outer.active).toHaveLength(1);
    const horizon = experiment.snapshot();
    experiment.set('regional');
    expect(experiment.snapshot().giants.active).toEqual(horizon.giants.active);
    expect(experiment.snapshot().outer.active).toEqual(horizon.outer.active);
    render.mockImplementation(() => {
      expect(fog.near).toBe(80);
      expect(fog.far).toBe(560);
      throw Error('draw failed');
    });
    expect(() => renderer.webgl.render(renderer.scene, renderer.camera)).toThrow('draw failed');
    expect(renderer.scene.fog.near).toBe(80);
    expect(renderer.scene.fog.far).toBe(900);
    renderer.camera.position.x = 170;
    renderer.foliage.update();
    expect(experiment.snapshot().giants.active).toHaveLength(0);
    expect(giant.visible).toBe(true);
    experiment.dispose();
    experiment.dispose();
    distance.dispose();
    expect(renderer.webgl.render).toBe(render);
    expect(renderer.foliage.update).toBe(update);
    expect(renderer.scene.children.filter((n) => n.name.startsWith('research-'))).toEqual([]);
    expect(sourceDispose).not.toHaveBeenCalled();
  });
  it('rolls back earlier installed layers if a later compile gate fails', async () => {
    const { renderer } = fixture();
    const distance = installSceneryDistanceExperiment(renderer);
    const update = renderer.foliage.update;
    renderer.compileGate
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(Error('gate failed'));
    await expect(installSceneryQualityExperiment(renderer, distance)).rejects.toThrow(
      'gate failed',
    );
    expect(renderer.foliage.update).toBe(update);
    expect(renderer.scene.children.filter((n) => n.name.startsWith('research-'))).toEqual([]);
    expect(distance.snapshot().cap).toBe(0);
    distance.dispose();
  });
});
