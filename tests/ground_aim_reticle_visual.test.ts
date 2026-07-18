import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { GroundAimReticleVisual } from '../src/render/ground_aim_reticle_visual';

describe('Ground aim reticle visual', () => {
  it('drapes its exact outer radius and meteor-matched inner guide over terrain', () => {
    const scene = new THREE.Scene();
    const heightAt = (x: number, z: number): number =>
      Math.sin(x * 0.31) * 0.8 + Math.cos(z * 0.27) * 0.55;
    const visual = new GroundAimReticleVisual(scene, heightAt);

    visual.setAim({ x: 10, z: 20, radius: 8, color: 0xff5a16, dimmed: false });

    const root = scene.getObjectByName('ground-aim-reticle') as THREE.Group;
    const outer = root.getObjectByName('ground-aim-outer-edge') as THREE.LineLoop;
    const inner = root.getObjectByName('ground-aim-inner-guide') as THREE.LineLoop;
    const band = root.getObjectByName('ground-aim-band') as THREE.Mesh;
    const ticks = root.getObjectByName('ground-aim-ticks') as THREE.LineSegments;
    expect(root.visible).toBe(true);
    expect(band).toBeInstanceOf(THREE.Mesh);
    expect(ticks).toBeInstanceOf(THREE.LineSegments);

    for (const [line, radius, lift] of [
      [outer, 8, 0.08],
      [inner, 8 * 0.62, 0.075],
    ] as const) {
      const positions = line.geometry.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < positions.count; i++) {
        const x = positions.getX(i);
        const y = positions.getY(i);
        const z = positions.getZ(i);
        expect(Math.hypot(x - 10, z - 20)).toBeCloseTo(radius, 4);
        expect(y).toBeCloseTo(heightAt(x, z) + lift, 4);
      }
    }

    const bandPositions = band.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < bandPositions.count; i++) {
      const x = bandPositions.getX(i);
      const y = bandPositions.getY(i);
      const z = bandPositions.getZ(i);
      const radius = Math.hypot(x - 10, z - 20);
      expect(Math.abs(radius - 8 * 0.82) < 0.0001 || Math.abs(radius - 8) < 0.0001).toBe(true);
      expect(y).toBeCloseTo(heightAt(x, z) + 0.055, 4);
    }
  });

  it('rebuilds at the real radius without scaling a flat mesh, pulses, dims, and hides', () => {
    const scene = new THREE.Scene();
    const visual = new GroundAimReticleVisual(scene, () => 2);
    visual.setAim({ x: 3, z: 7, radius: 5, color: 0x72cfff, dimmed: false });
    const root = scene.getObjectByName('ground-aim-reticle') as THREE.Group;
    const outer = root.getObjectByName('ground-aim-outer-edge') as THREE.LineLoop<
      THREE.BufferGeometry,
      THREE.LineBasicMaterial
    >;
    expect(root.scale.toArray()).toEqual([1, 1, 1]);
    const brightOpacity = outer.material.opacity;
    visual.update(0.125);
    expect(outer.material.opacity).not.toBe(brightOpacity);

    visual.setAim({ x: 3, z: 7, radius: 5, color: 0x72cfff, dimmed: true });
    visual.update(0.125);
    expect(outer.material.opacity).toBeLessThan(brightOpacity);

    visual.setAim(null);
    expect(root.visible).toBe(false);
    visual.dispose();
    expect(scene.getObjectByName('ground-aim-reticle')).toBeUndefined();
  });
});
