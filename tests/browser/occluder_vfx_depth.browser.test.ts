import * as THREE from 'three';
import { expect, it } from 'vitest';
import { applyOccluderFade, occluderFadeMat } from '../../src/render/occluder_fade';
import { createWorldRenderer } from '../../src/render/world_renderer';

it('shows transparent combat effects through faded scenery while solid walls still occlude them', () => {
  const canvas = document.createElement('canvas');
  const renderer = createWorldRenderer(canvas);
  const target = new THREE.WebGLRenderTarget(64, 64);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 20);
  camera.position.z = 5;
  const geometry = new THREE.PlaneGeometry(2, 2);
  const effectMaterial = new THREE.MeshBasicMaterial({
    color: 0x0011ff,
    transparent: true,
    depthWrite: false,
  });
  const effect = new THREE.Mesh(geometry, effectMaterial);
  effect.renderOrder = 6;
  scene.add(effect);
  const ghostMaterial = new THREE.MeshBasicMaterial({ color: 0x202020 });
  const ghost = new THREE.Mesh(geometry, ghostMaterial);
  ghost.position.z = 1;
  scene.add(ghost);
  const fade = occluderFadeMat(ghostMaterial, ghost);
  const wallMaterial = new THREE.MeshBasicMaterial({ color: 0xff1100 });
  const wall = new THREE.Mesh(geometry, wallMaterial);
  wall.position.z = 0.5;
  wall.visible = false;
  scene.add(wall);
  const pixel = new Uint8Array(4);
  const draw = () => {
    renderer.setRenderTarget(target);
    renderer.render(scene, camera);
    renderer.readRenderTargetPixels(target, 32, 32, 1, 1, pixel);
    expect(renderer.getContext().getError()).toBe(0);
  };
  try {
    applyOccluderFade([fade], 0.2);
    expect(ghostMaterial.depthWrite).toBe(true);
    expect(effectMaterial.depthTest).toBe(true);
    draw();
    expect(pixel[2]).toBeGreaterThan(pixel[0] + 70);
    applyOccluderFade([fade], 1);
    draw();
    expect(pixel[2]).toBeLessThan(100);
    expect(Math.abs(pixel[2] - pixel[0])).toBeLessThan(3);
    applyOccluderFade([fade], 0.2);
    wall.visible = true;
    draw();
    expect(pixel[0]).toBeGreaterThan(pixel[2] + 70);
    // Control: the same scene with Three's former stock ordering reproduces
    // the invisible VFX, rather than passing because the wall missed the pixel.
    wall.visible = false;
    renderer.setTransparentSort(null);
    draw();
    expect(pixel[2]).toBeLessThan(100);
    expect(Math.abs(pixel[2] - pixel[0])).toBeLessThan(3);
  } finally {
    renderer.setRenderTarget(null);
    target.dispose();
    geometry.dispose();
    effectMaterial.dispose();
    ghostMaterial.dispose();
    wallMaterial.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
  }
});
