import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { MageGroundFx } from '../src/render/mage_ground_fx';
import { RiftDeathZoneVisuals } from '../src/render/rift_death_zone';
import { DEATH_ZONE_FILL_COLOR, DEATH_ZONE_RIM_COLOR } from '../src/render/rift_death_zone_core';
import { riftGroundHeight } from '../src/render/rift_ground_height';
import { generateRiftFloor } from '../src/sim/rift/rift_gen';
import type { RiftFloorView } from '../src/world_api/dungeons';

// Drive the actual painter with a raised, sloped floor. The boss spectacle
// must never change the size, ground contact or lifetime of the damage tell.
describe('Roach King filth danger presentation', () => {
  it('keeps the exact replicated radius grounded and visible throughout its fuse', () => {
    const scene = new THREE.Scene();
    const ground = (x: number, z: number) => 4 + x * 0.03 + z * 0.02;
    const visuals = new RiftDeathZoneVisuals(scene, ground);
    const zone = { x: 20, z: 40, radius: 7, remaining: 5, total: 5 };
    visuals.sync([zone]);
    const group = scene.children[0] as THREE.Group;
    const rim = group.children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
    const fill = group.children[1] as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
    const positions = rim.geometry.getAttribute('position');
    let outerRadius = 0;
    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i);
      const y = positions.getY(i);
      const z = positions.getZ(i);
      outerRadius = Math.max(outerRadius, Math.hypot(x - zone.x, z - zone.z));
      expect(y - ground(x, z)).toBeCloseTo(0.08, 4);
    }
    expect(outerRadius).toBeCloseTo(zone.radius, 4);
    expect(
      rim.material.color.equals(new THREE.Color(DEATH_ZONE_RIM_COLOR).multiplyScalar(1.6)),
    ).toBe(true);
    expect(
      fill.material.color.equals(new THREE.Color(DEATH_ZONE_FILL_COLOR).multiplyScalar(1.3)),
    ).toBe(true);
    for (let step = 0; step <= 50; step++) {
      visuals.sync([{ ...zone, remaining: 5 - step / 10 }]);
      visuals.update(0.1);
      expect(scene.children[0]).toBe(group);
      expect(group.visible && rim.visible && fill.visible).toBe(true);
      expect(rim.material.opacity).toBeGreaterThanOrEqual(0.6);
      expect(fill.material.opacity).toBeGreaterThan(0);
    }
    visuals.sync([]);
    expect(scene.children).toHaveLength(0);
  });
});

it('drapes ordinary slam warnings above the actual raised Rift arena', () => {
  const rf = {
    seed: 42,
    baseLevel: 28,
    floorIndex: 5,
    upgrade: null,
    origin: { x: 1000, z: 500 },
  } as RiftFloorView;
  const floor = generateRiftFloor(rf.seed, rf.baseLevel, rf.floorIndex, rf.upgrade);
  const dais = floor.layout.dais;
  if (!dais) throw new Error('Expected seed42 final boss dais');
  const x = rf.origin.x + dais.x;
  const z = rf.origin.z + dais.z;
  const ground = (gx: number, gz: number) => riftGroundHeight(0, rf, gx, gz);
  expect(ground(x, z)).toBeGreaterThan(0);
  const scene = new THREE.Scene();
  const visuals = new MageGroundFx(scene, ground, () => undefined);
  visuals.spawnRune({ x, z, radius: 8, duration: 2.2, school: 'physical' });
  const ring = scene.getObjectByName('mage-rune-power-outer-ring') as THREE.Mesh<
    THREE.BufferGeometry,
    THREE.MeshBasicMaterial
  >;
  expect(ring).toBeDefined();
  const positions = ring.geometry.getAttribute('position');
  let radius = 0;
  for (let i = 0; i < positions.count; i++) {
    const gx = positions.getX(i),
      gz = positions.getZ(i);
    expect(positions.getY(i)).toBeGreaterThan(ground(gx, gz));
    radius = Math.max(radius, Math.hypot(gx - x, gz - z));
  }
  expect(radius).toBeCloseTo(8, 3);
  expect(ring.material.opacity).toBeGreaterThan(0.5);
  visuals.dispose();
});
