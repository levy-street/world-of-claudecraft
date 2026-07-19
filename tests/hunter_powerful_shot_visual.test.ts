import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { PowerfulShotTelegraph } from '../src/render/powerful_shot_visual';

describe('Powershot telegraph', () => {
  it('draws a narrow terrain-draped strip with the requested facing and dimensions', () => {
    const scene = new THREE.Scene();
    const visual = new PowerfulShotTelegraph(scene, (x, z) => x * 0.1 + z * 0.02);

    visual.update(10, 20, 40, 2, Math.PI / 2, 0xffcc66);

    expect(visual.group.visible).toBe(true);
    expect(scene.children).toContain(visual.group);
    expect(visual.group.position.x).toBe(10);
    expect(visual.group.position.z).toBe(20);
    expect(visual.group.rotation.y).toBe(Math.PI / 2);

    const positions = visual.fill.geometry.getAttribute('position') as THREE.BufferAttribute;
    const xs: number[] = [];
    const ys: number[] = [];
    const zs: number[] = [];
    for (let i = 0; i < positions.count; i++) {
      xs.push(positions.getX(i));
      ys.push(positions.getY(i));
      zs.push(positions.getZ(i));
    }
    expect(Math.min(...xs)).toBeCloseTo(-1);
    expect(Math.max(...xs)).toBeCloseTo(1);
    expect(Math.min(...zs)).toBeCloseTo(-20);
    expect(Math.max(...zs)).toBeCloseTo(20);
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(3);

    visual.setOpacity(0.7);
    expect(visual.fill.material.opacity).toBeCloseTo(0.21);
    visual.hide();
    expect(visual.group.visible).toBe(false);
    visual.dispose();
    expect(scene.children).not.toContain(visual.group);
  });
});
