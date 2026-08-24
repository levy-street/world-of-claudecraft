import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { AbilityRangeReticleVisual } from '../src/render/ability_range_reticle_visual';

describe('Ability range reticle visual', () => {
  it('draws a thin terrain-draped maximum-range edge and hides cleanly', () => {
    const scene = new THREE.Scene();
    const heightAt = (x: number, z: number): number => x * 0.01 - z * 0.02;
    const visual = new AbilityRangeReticleVisual(scene, heightAt);
    visual.setRange({ x: 4, z: -7, radius: 35, color: 0x72cfff });

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
});
