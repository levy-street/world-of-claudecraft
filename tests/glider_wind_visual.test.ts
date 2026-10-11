import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { GliderWindVisual } from '../src/render/glider_wind_visual';

const tunnel = {
  id: 'wind-test',
  x: 10,
  y: 30,
  z: 20,
  yaw: Math.PI / 2,
  radius: 5,
  length: 14,
  speedBoost: 8,
};

describe('glider wind corridor geometry', () => {
  it('uses open directional lines at the authoritative radius, length and yaw', () => {
    const visual = new GliderWindVisual([tunnel]);
    const lines = visual.group.children[0] as THREE.LineSegments;
    expect(lines.isLineSegments).toBe(true);
    expect(lines.position.toArray()).toEqual([10, 30, 20]);
    expect(lines.rotation.y).toBe(tunnel.yaw);
    const positions = lines.geometry.getAttribute('position');
    expect(positions.count).toBe(320);
    for (let i = 0; i < positions.count; i++) {
      expect(Math.hypot(positions.getX(i), positions.getY(i))).toBeCloseTo(tunnel.radius);
      expect(Math.abs(positions.getZ(i))).toBeLessThanOrEqual(tunnel.length / 2);
    }
    for (let i = 288; i < positions.count; i += 4) {
      expect(positions.getZ(i + 1)).toBeGreaterThan(positions.getZ(i));
      expect(positions.getZ(i + 2)).toBeGreaterThan(positions.getZ(i + 3));
    }
    const material = lines.material as THREE.LineBasicMaterial;
    expect(material.transparent).toBe(true);
    expect(material.depthWrite).toBe(false);
    expect(material.depthTest).toBe(true);
    visual.dispose();
  });

  it('dims consumed boosts without hiding guidance or replacing GPU resources', () => {
    const visual = new GliderWindVisual([tunnel]);
    const lines = visual.group.children[0] as THREE.LineSegments;
    const geometry = lines.geometry;
    const material = lines.material as THREE.LineBasicMaterial;
    visual.update(['wind-test']);
    expect(material.opacity).toBe(0.35);
    expect(lines.visible).toBe(true);
    visual.update([]);
    expect(material.opacity).toBe(0.85);
    expect(lines.geometry).toBe(geometry);
    expect(lines.material).toBe(material);
    visual.dispose();
  });

  it('detaches and disposes every owned resource exactly once', () => {
    const visual = new GliderWindVisual([tunnel, { ...tunnel, id: 'other' }]);
    const scene = new THREE.Group();
    scene.add(visual.group);
    const spies = visual.group.children.flatMap((child) => {
      const lines = child as THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>;
      return [vi.spyOn(lines.geometry, 'dispose'), vi.spyOn(lines.material, 'dispose')];
    });
    visual.dispose();
    visual.dispose();
    expect(scene.children).toHaveLength(0);
    for (const spy of spies) expect(spy).toHaveBeenCalledTimes(1);
  });
});
