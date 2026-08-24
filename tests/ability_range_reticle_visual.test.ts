import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { AbilityRangeReticleVisual } from '../src/render/ability_range_reticle_visual';

describe('Ability range reticle visual', () => {
  it('draws a thin terrain-draped maximum-range edge and hides cleanly', () => {
    const scene = new THREE.Scene();
    const heightAt = (x: number, z: number): number => x * 0.01 - z * 0.02;
    const visual = new AbilityRangeReticleVisual(scene, heightAt);
    visual.setRange({ x: 4, z: -7, radius: 35, color: 0x72cfff, kind: 'circle' });

    const root = scene.getObjectByName('ability-range-reticle') as THREE.Group;
    const edge = root.getObjectByName('ability-range-edge') as THREE.LineLoop;
    expect(root.visible).toBe(true);
    const positions = edge.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i);
      const y = positions.getY(i);
      const z = positions.getZ(i);
      expect(Math.hypot(x - 4, z + 7)).toBeCloseTo(35, 4);
      expect(y).toBeCloseTo(heightAt(x, z) + 0.095, 4);
    }

    const opacity = (edge.material as THREE.LineBasicMaterial).opacity;
    visual.update(0.1);
    expect((edge.material as THREE.LineBasicMaterial).opacity).not.toBe(opacity);
    visual.setRange(null);
    expect(root.visible).toBe(false);
    visual.dispose();
    expect(scene.getObjectByName('ability-range-reticle')).toBeUndefined();
  });

  it('draws the authoritative 120 degree melee cone from facing', () => {
    const scene = new THREE.Scene();
    const visual = new AbilityRangeReticleVisual(scene, () => 2);
    visual.setRange({
      x: 10,
      z: 20,
      radius: 5,
      color: 0xffaa33,
      kind: 'meleeCone',
      angle: 0,
      halfAngle: Math.PI / 3,
    });

    const root = scene.getObjectByName('ability-range-reticle') as THREE.Group;
    const guide = root.getObjectByName('ability-direction-guide') as THREE.Line;
    const fill = root.getObjectByName('ability-range-fill') as THREE.Mesh;
    const edge = root.getObjectByName('ability-range-edge') as THREE.LineLoop;
    const positions = guide.geometry.getAttribute('position') as THREE.BufferAttribute;
    expect(edge.visible).toBe(false);
    expect(guide.visible).toBe(true);
    expect(fill.visible).toBe(true);
    expect(guide.geometry.drawRange.count).toBe(51);
    expect(positions.getX(0)).toBeCloseTo(10, 6);
    expect(positions.getZ(0)).toBeCloseTo(20, 6);
    expect(positions.getX(1)).toBeCloseTo(10 - Math.sin(Math.PI / 3) * 5, 5);
    expect(positions.getZ(1)).toBeCloseTo(22.5, 5);
    expect(positions.getX(25)).toBeCloseTo(10, 5);
    expect(positions.getZ(25)).toBeCloseTo(25, 5);
    visual.dispose();
  });

  it('draws a directional maximum-range line with an endpoint bar', () => {
    const scene = new THREE.Scene();
    const visual = new AbilityRangeReticleVisual(scene, () => 0);
    visual.setRange({
      x: -2,
      z: 3,
      radius: 30,
      color: 0x72cfff,
      kind: 'directionLine',
      angle: Math.PI / 2,
    });

    const root = scene.getObjectByName('ability-range-reticle') as THREE.Group;
    const guide = root.getObjectByName('ability-direction-guide') as THREE.Line;
    const terminal = root.getObjectByName('ability-direction-terminal') as THREE.LineSegments;
    const positions = guide.geometry.getAttribute('position') as THREE.BufferAttribute;
    const terminalPositions = terminal.geometry.getAttribute('position') as THREE.BufferAttribute;
    expect(guide.geometry.drawRange.count).toBe(2);
    expect(positions.getX(1)).toBeCloseTo(28, 6);
    expect(positions.getZ(1)).toBeCloseTo(3, 6);
    expect(terminal.visible).toBe(true);
    expect(terminalPositions.getX(0)).toBeCloseTo(28, 6);
    expect(terminalPositions.getZ(0)).toBeGreaterThan(3);
    expect(terminalPositions.getZ(1)).toBeLessThan(3);
    visual.dispose();
  });

  it('fills self-centered areas while retaining their exact radius edge', () => {
    const scene = new THREE.Scene();
    const visual = new AbilityRangeReticleVisual(scene, () => 0);
    visual.setRange({ x: 0, z: 0, radius: 8, color: 0xaa55ff, kind: 'area' });

    const root = scene.getObjectByName('ability-range-reticle') as THREE.Group;
    const edge = root.getObjectByName('ability-range-edge') as THREE.LineLoop;
    const fill = root.getObjectByName('ability-range-fill') as THREE.Mesh;
    expect(edge.visible).toBe(true);
    expect(fill.visible).toBe(true);
    expect(fill.geometry.drawRange.count).toBe(96 * 3);
    visual.dispose();
  });
});
