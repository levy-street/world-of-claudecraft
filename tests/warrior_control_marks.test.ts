import * as THREE from 'three';
import { expect, it } from 'vitest';
import { AbilityVfxFx } from '../src/render/ability_vfx/fx';
import type { AbilityVfxTextures } from '../src/render/ability_vfx/fx_textures';
import { OVERLAY_CELL } from '../src/render/ability_vfx/fx_textures';
import { OverlaySprites } from '../src/render/ability_vfx/overlay_sprites';
import { drawWarriorControlMark } from '../src/render/ability_vfx/warrior_control_marks';

function orbitHost() {
  return Object.assign(Object.create(AbilityVfxFx.prototype), {
    disposed: false,
    orbits: new Map(),
    orbitBandCount: 0,
    frame: 1,
  }) as {
    orbit: AbilityVfxFx['orbit'];
    orbits: Map<number, { style: string; stamp: number }[]>;
    orbitBandCount: number;
    frame: number;
  };
}

it('the real orbit pool admits an armor imprint by replacing cosmetic clutter at global capacity', () => {
  const fx = orbitHost();
  for (let i = 0; i < 24; i++) fx.orbit(i, 'sparks', 0xffffff);
  expect(fx.orbitBandCount).toBe(24);
  expect(fx.orbit(99, 'armorShear', 0xffffff, { n: 5 })).toBe(true);
  expect(fx.orbitBandCount).toBe(24);
  expect(fx.orbits.get(99)?.[0].style).toBe('armorShear');
  fx.frame++;
  fx.orbit(99, 'armorShear', 0xffffff, { n: 3 });
  expect(fx.orbits.get(99)?.[0].stamp).toBe(fx.frame);
  expect(fx.orbitBandCount).toBe(24);
});

it('per-body replacement preserves real weapon readiness and charge counts', () => {
  const fx = orbitHost();
  fx.orbit(1, 'weaponGlow', 0xffffff);
  fx.orbit(1, 'wardCharges', 0xffffff);
  fx.orbit(1, 'leaves', 0xffffff);
  expect(fx.orbit(1, 'hamstringMark', 0xffffff)).toBe(true);
  expect(fx.orbits.get(1)?.map((band) => band.style)).toEqual([
    'weaponGlow',
    'wardCharges',
    'hamstringMark',
  ]);
  expect(fx.orbit(1, 'armorShear', 0xffffff)).toBe(false);
  expect(fx.orbitBandCount).toBe(3);
});

it('protected status-only saturation stays bounded and cannot steal another real status', () => {
  const fx = orbitHost();
  for (let i = 0; i < 24; i++) fx.orbit(i, 'wardCharges', 0xffffff);
  expect(fx.orbit(99, 'armorShear', 0xffffff)).toBe(false);
  expect(fx.orbitBandCount).toBe(24);
  expect([...fx.orbits.values()].flat().every((band) => band.style === 'wardCharges')).toBe(true);
});

it('imprints replace decorative sprites while protecting the hard-control prefix', () => {
  const texture = new THREE.Texture();
  const scene = new THREE.Scene();
  const overlay = new OverlaySprites(scene, { overlay: texture } as AbilityVfxTextures);
  overlay.beginFrame();
  for (let i = 0; i < 64; i++) overlay.push(i, 0, 0, 0xffffff, 1, OVERLAY_CELL.star, 1);
  overlay.protectPrefix();
  for (let i = 0; i < 64; i++) overlay.push(i, 0, 0, 0xffffff, 1, OVERLAY_CELL.glow, 1);
  drawWarriorControlMark(overlay, true, 5, { x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: -1 });
  overlay.commit();
  const points = scene.children[0] as THREE.Points;
  const cells = points.geometry.getAttribute('aCell');
  expect(points.geometry.drawRange.count).toBe(128);
  for (let i = 0; i < 64; i++) expect(cells.getX(i)).toBe(OVERLAY_CELL.star);
  expect(cells.getX(127)).toBe(OVERLAY_CELL.armorShear0 + 4);
  overlay.dispose();
  texture.dispose();
});

it('solid overlays draw far-to-near as the camera moves while hard-control tells remain on top', () => {
  const texture = new THREE.Texture(),
    scene = new THREE.Scene();
  const overlay = new OverlaySprites(scene, { overlay: texture } as AbilityVfxTextures);
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(0, 0, 10);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  overlay.beginFrame();
  overlay.push(0, 0, -10, 0xffffff, 1, OVERLAY_CELL.star, 1);
  overlay.protectPrefix();
  overlay.push(0, 0, 5, 0xffffff, 1, OVERLAY_CELL.armorShear0, 1, 1, 1);
  overlay.push(0, 0, 0, 0xffffff, 1, OVERLAY_CELL.hammer0, 1);
  overlay.commit(camera);
  const geometry = (scene.children[0] as THREE.Points).geometry;
  const order = () => Array.from(geometry.index!.array).slice(0, geometry.drawRange.count);
  expect(order()).toEqual([2, 1, 0]);
  camera.position.z = -20;
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  overlay.orderForCamera(camera);
  expect(order()).toEqual([1, 2, 0]);
  // Sorting did not move admission slots: the protected prefix is still slot zero.
  expect(geometry.getAttribute('aCell').getX(0)).toBe(OVERLAY_CELL.star);
  overlay.beginFrame();
  overlay.push(0, 0, 5, 0xffffff, 1, OVERLAY_CELL.glow, 1);
  overlay.push(0, 0, 0, 0xffffff, 1, OVERLAY_CELL.spark, 1);
  overlay.commit(camera);
  expect(order()).toEqual([0, 1]);
  overlay.dispose();
  texture.dispose();
});
