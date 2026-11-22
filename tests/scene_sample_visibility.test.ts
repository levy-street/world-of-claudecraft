import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { SceneSampleVisibility } from '../src/render/scene_sample_visibility';

function fixture() {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(), new THREE.ShaderMaterial());
  mesh.position.z = -5;
  scene.add(mesh);
  const visibility = new SceneSampleVisibility();
  const consumers = new Set([mesh]);
  const active = () => {
    scene.updateMatrixWorld(true);
    camera.updateMatrixWorld(true);
    return visibility.hasVisibleConsumer(consumers, scene, camera);
  };
  return { scene, camera, mesh, consumers, active };
}

describe('opaque scene sampling demand', () => {
  it('copies only when a consumer can enter the camera frustum, including its bounds', () => {
    const f = fixture();
    expect(f.active()).toBe(true);
    f.mesh.position.x = 20;
    expect(f.active()).toBe(false);
    f.mesh.position.set(0, 0, 5);
    expect(f.active()).toBe(false);
    f.mesh.position.set(3.1, 0, -5);
    // The centre is outside, but part of the plane still intersects the view.
    expect(f.active()).toBe(true);
    f.camera.rotation.y = Math.PI;
    expect(f.active()).toBe(false);
  });

  it('keeps shader-displaced consumers that explicitly disable frustum culling', () => {
    const f = fixture();
    f.mesh.position.set(1000, 0, 5);
    f.mesh.frustumCulled = false;
    expect(f.active()).toBe(true);
  });

  it('rejects hidden, detached, layer-masked and empty consumers', () => {
    const f = fixture();
    f.mesh.material.visible = false;
    expect(f.active()).toBe(false);
    f.mesh.material.visible = true;
    f.mesh.layers.set(1);
    expect(f.active()).toBe(false);
    f.mesh.layers.set(0);
    f.scene.visible = false;
    expect(f.active()).toBe(false);
    f.scene.visible = true;
    f.mesh.removeFromParent();
    expect(f.active()).toBe(false);
    f.scene.add(f.mesh);
    f.mesh.geometry.setDrawRange(0, 0);
    expect(f.active()).toBe(false);
    f.mesh.geometry.setDrawRange(f.mesh.geometry.index?.count ?? 0, Infinity);
    expect(f.active()).toBe(false);
    f.mesh.geometry.setDrawRange(0, Infinity);
    expect(f.active()).toBe(true);
  });

  it('does not request a full-frame copy for a zero-instance batch', () => {
    const f = fixture();
    const batch = new THREE.InstancedMesh(f.mesh.geometry, f.mesh.material, 1);
    batch.position.z = -5;
    batch.count = 0;
    f.scene.add(batch);
    f.consumers.clear();
    f.consumers.add(batch);
    expect(f.active()).toBe(false);
    batch.count = 1;
    expect(f.active()).toBe(true);
  });
});
