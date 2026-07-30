import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { GlacialFrontVisual } from '../src/render/glacial_front_visual';
import type { Entity } from '../src/sim/types';

function caster(progress: number, ability = 'glacial_front'): Entity {
  return {
    castingAbility: ability,
    castTotal: 2.4,
    castRemaining: 2.4 * (1 - progress),
    facing: 0.4,
    pos: { x: 3, y: 0, z: 8 },
  } as Entity;
}

describe('GlacialFrontVisual', () => {
  it('shows a local preview that grows from 7 to 16 yards with authoritative progress', () => {
    const scene = new THREE.Scene();
    const visual = new GlacialFrontVisual(scene);
    visual.updateCharge(caster(0), 0.016, 2);
    expect(visual.preview.visible).toBe(true);
    const fill = visual.preview.getObjectByProperty('type', 'Mesh') as THREE.Mesh;
    expect(fill.scale.x).toBeCloseTo(7, 4);
    visual.updateCharge(caster(1), 0.016, 2);
    expect(fill.scale.x).toBeCloseTo(16, 4);
    expect(visual.preview.position.x).toBe(3);
    expect(visual.preview.rotation.y).toBeCloseTo(0.4, 4);
  });

  it("shows Dragon's Breath as a staged fire cone", () => {
    const scene = new THREE.Scene();
    const visual = new GlacialFrontVisual(scene);
    visual.updateCharge(caster(0, 'dragons_breath'), 0.016, 2);
    expect(visual.preview.visible).toBe(true);
    const fill = visual.preview.getObjectByProperty('type', 'Mesh') as THREE.Mesh;
    expect(fill.scale.x).toBeCloseTo(6, 4);
    visual.updateCharge(caster(1, 'dragons_breath'), 0.016, 2);
    expect(fill.scale.x).toBeCloseTo(12, 4);
    expect((fill.material as THREE.MeshBasicMaterial).color.getHex()).toBe(0xff682e);
  });

  it('uses a bounded release pool and retires a wave after its lifetime', () => {
    const scene = new THREE.Scene();
    const visual = new GlacialFrontVisual(scene);
    const before = scene.children.length;
    for (let i = 0; i < 12; i++) visual.spawn(i, 0, i, 0, 16, 4);
    expect(scene.children.length).toBe(before);
    expect(
      scene.children.filter((o) => o.name === 'glacial-front-release').some((o) => o.visible),
    ).toBe(true);
    visual.update(1);
    expect(
      scene.children.filter((o) => o.name === 'glacial-front-release').every((o) => !o.visible),
    ).toBe(true);
  });

  it('drapes the preview over a sloped terrain sampler', () => {
    const scene = new THREE.Scene();
    const visual = new GlacialFrontVisual(scene, (x, z) => x * 0.1 + z * 0.05);
    visual.updateCharge(caster(1), 0.016, 0.7);
    const fill = visual.preview.getObjectByProperty('type', 'Mesh') as THREE.Mesh;
    const positions = fill.geometry.getAttribute('position') as THREE.BufferAttribute;
    const ys = Array.from({ length: positions.count }, (_, i) => positions.getY(i));
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(0.5);
  });

  it('keeps a radially tessellated preview safely above uneven terrain', () => {
    const terrain = (x: number, z: number) => Math.sin(x * 0.7) * 0.8 + Math.cos(z * 0.55) * 0.9;
    const scene = new THREE.Scene();
    const visual = new GlacialFrontVisual(scene, terrain);
    visual.updateCharge(caster(1), 0.016, terrain(3, 8));
    const fill = visual.preview.getObjectByProperty('type', 'Mesh') as THREE.Mesh;
    const positions = fill.geometry.getAttribute('position') as THREE.BufferAttribute;
    const boundaryRay = visual.preview.children.find(
      (child) => child.type === 'Line',
    ) as THREE.Line;

    expect(positions.count).toBeGreaterThan(28 * 6);
    expect(boundaryRay.geometry.getAttribute('position').count).toBeGreaterThan(2);
    for (let i = 0; i < positions.count; i++) {
      const local = new THREE.Vector3(
        positions.getX(i) * fill.scale.x,
        positions.getY(i),
        positions.getZ(i) * fill.scale.z,
      );
      local.applyAxisAngle(new THREE.Vector3(0, 1, 0), visual.preview.rotation.y);
      const worldX = visual.preview.position.x + local.x;
      const worldZ = visual.preview.position.z + local.z;
      const worldY = visual.preview.position.y + local.y;
      expect(worldY).toBeGreaterThanOrEqual(terrain(worldX, worldZ) + 0.09);
    }
  });
});
