import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  buildIgnivarSoakTelegraph,
  IGNIVAR_SOAK_ARROWS_NAME,
  IGNIVAR_SOAK_BEACON_NAME,
  IGNIVAR_SOAK_FLAME_NAME,
  IGNIVAR_SOAK_OCCUPANCY_NAME,
  IGNIVAR_SOAK_READY_NAME,
  IGNIVAR_SOAK_SWIRL_NAME,
  IGNIVAR_SOAK_TIMER_NAME,
  IGNIVAR_SOAK_VISUAL_NAME,
  syncIgnivarSoakTelegraph,
} from '../src/render/ignivar_soak_telegraph';
import { IGNIVAR_SOAK_RADIUS, IGNIVAR_SOAK_REQUIRED_PLAYERS } from '../src/sim/encounters/ignivar';

function expectGeometryInsideRadius(object: THREE.Object3D, radius: number): void {
  object.traverse((child) => {
    const geometry = (child as THREE.Mesh).geometry;
    if (!geometry) return;
    const positions = geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let index = 0; index < positions.count; index++) {
      expect(Math.hypot(positions.getX(index), positions.getZ(index))).toBeLessThanOrEqual(
        radius + 1e-6,
      );
    }
  });
}

describe('Ignivar Shared Pyre soak telegraph', () => {
  it('combines the WoW soak flame, inward arrows, swirl, and four occupancy runes', () => {
    const soak = buildIgnivarSoakTelegraph();

    expect(soak.name).toBe(IGNIVAR_SOAK_VISUAL_NAME);
    expect(soak.getObjectByName(IGNIVAR_SOAK_SWIRL_NAME)).toBeInstanceOf(THREE.Mesh);
    expect(soak.getObjectByName(IGNIVAR_SOAK_ARROWS_NAME)).toBeInstanceOf(THREE.Mesh);
    expect(soak.getObjectByName(IGNIVAR_SOAK_OCCUPANCY_NAME)).toBeInstanceOf(THREE.Mesh);
    expect(soak.getObjectByName(IGNIVAR_SOAK_TIMER_NAME)).toBeInstanceOf(THREE.Mesh);
    expect(soak.getObjectByName(IGNIVAR_SOAK_FLAME_NAME)).toBeInstanceOf(THREE.InstancedMesh);
    expect(soak.getObjectByName(IGNIVAR_SOAK_BEACON_NAME)).toBeInstanceOf(THREE.Group);
    expect(soak.getObjectByName(IGNIVAR_SOAK_READY_NAME)).toBeInstanceOf(THREE.Mesh);
    expect(soak.userData.requiredPlayers).toBe(IGNIVAR_SOAK_REQUIRED_PLAYERS);
    expectGeometryInsideRadius(soak, IGNIVAR_SOAK_RADIUS);
  });

  it('fills four runes with occupancy and replaces the call-in flame when the soak is ready', () => {
    const soak = buildIgnivarSoakTelegraph();
    const occupancy = soak.getObjectByName(IGNIVAR_SOAK_OCCUPANCY_NAME) as THREE.Mesh;
    const flame = soak.getObjectByName(IGNIVAR_SOAK_FLAME_NAME) as THREE.InstancedMesh;
    const beacon = soak.getObjectByName(IGNIVAR_SOAK_BEACON_NAME) as THREE.Group;
    const ready = soak.getObjectByName(IGNIVAR_SOAK_READY_NAME) as THREE.Mesh;
    const timer = soak.getObjectByName(IGNIVAR_SOAK_TIMER_NAME) as THREE.Mesh;

    syncIgnivarSoakTelegraph(soak, true, 1, 4, 0.25, 1, 0);
    expect(soak.visible).toBe(true);
    expect(soak.userData.playersInside).toBe(1);
    expect(soak.userData.ready).toBe(false);
    expect(flame.visible).toBe(true);
    expect(beacon.visible).toBe(true);
    expect(ready.visible).toBe(false);
    expect(timer.geometry.drawRange.count).toBe(48 * 6);
    const colors = occupancy.geometry.getAttribute('color') as THREE.BufferAttribute;
    const lit = new THREE.Color().fromBufferAttribute(colors, 0);
    const unlit = new THREE.Color().fromBufferAttribute(colors, 4);
    expect(lit.r).toBeGreaterThan(unlit.r);
    expect(lit.g).toBeGreaterThan(unlit.g);

    syncIgnivarSoakTelegraph(soak, true, 4, 4, 0.75, 1, 0);
    expect(soak.userData.ready).toBe(true);
    expect(flame.visible).toBe(false);
    expect(beacon.visible).toBe(false);
    expect(ready.visible).toBe(true);
    expect(timer.geometry.drawRange.count).toBe(16 * 6);
    for (let slot = 0; slot < 4; slot++) {
      const color = new THREE.Color().fromBufferAttribute(colors, slot * 4);
      expect(color.r).toBeGreaterThan(0.8);
      expect(color.g).toBeGreaterThan(0.5);
    }

    syncIgnivarSoakTelegraph(soak, false, 0, 4, 0, 1, 0);
    expect(soak.visible).toBe(false);
  });

  it('keeps repeated state idempotent and advances rotation only with time', () => {
    const soak = buildIgnivarSoakTelegraph();
    const swirl = soak.getObjectByName(IGNIVAR_SOAK_SWIRL_NAME) as THREE.Mesh;
    const arrows = soak.getObjectByName(IGNIVAR_SOAK_ARROWS_NAME) as THREE.Mesh;
    syncIgnivarSoakTelegraph(soak, true, 2, 4, 0.4, 1, 0.1);
    const first = {
      elapsed: soak.userData.elapsed,
      rotation: swirl.rotation.y,
      arrowOpacity: (arrows.material as THREE.Material).opacity,
    };
    syncIgnivarSoakTelegraph(soak, true, 2, 4, 0.4, 1, 0);
    expect({
      elapsed: soak.userData.elapsed,
      rotation: swirl.rotation.y,
      arrowOpacity: (arrows.material as THREE.Material).opacity,
    }).toEqual(first);
    syncIgnivarSoakTelegraph(soak, true, 2, 4, 0.4, 1, 0.1);
    expect(soak.userData.elapsed).toBeCloseTo(0.2);
    expect(swirl.rotation.y).toBeLessThan(first.rotation);
  });

  it('freezes decoration under reduced motion without hiding occupancy or countdown', () => {
    const soak = buildIgnivarSoakTelegraph();
    const swirl = soak.getObjectByName(IGNIVAR_SOAK_SWIRL_NAME) as THREE.Mesh;
    const timer = soak.getObjectByName(IGNIVAR_SOAK_TIMER_NAME) as THREE.Mesh;

    syncIgnivarSoakTelegraph(soak, true, 2, 4, 0.5, 1, 0.5, true);
    syncIgnivarSoakTelegraph(soak, true, 2, 4, 0.5, 1, 0.5, true);

    expect(soak.visible).toBe(true);
    expect(Math.abs(swirl.rotation.y)).toBe(0);
    expect(timer.geometry.drawRange.count).toBe(32 * 6);
  });
});
