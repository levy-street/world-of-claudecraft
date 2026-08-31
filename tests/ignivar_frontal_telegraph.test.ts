import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  buildIgnivarFrontalTelegraph,
  IGNIVAR_FRONTAL_BORDER_NAME,
  IGNIVAR_FRONTAL_FILL_NAME,
  IGNIVAR_FRONTAL_FLAME_CURTAINS_NAME,
  IGNIVAR_FRONTAL_HEAT_BANDS_NAME,
  IGNIVAR_FRONTAL_VISUAL_NAME,
  syncIgnivarFrontalTelegraph,
} from '../src/render/ignivar_frontal_telegraph';
import { IGNIVAR_FRONTAL_HALF_ANGLE, IGNIVAR_FRONTAL_RANGE } from '../src/sim/ignivar_arena';

function expectInsideFrontal(object: THREE.Object3D): void {
  object.traverse((child) => {
    const geometry = (child as THREE.Mesh).geometry;
    if (!geometry) return;
    const positions = geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let index = 0; index < positions.count; index++) {
      const x = positions.getX(index);
      const z = positions.getZ(index);
      const distance = Math.hypot(x, z);
      expect(distance).toBeLessThanOrEqual(IGNIVAR_FRONTAL_RANGE + 2e-6);
      if (distance > 1e-6) {
        expect(Math.abs(Math.atan2(x, z))).toBeLessThanOrEqual(IGNIVAR_FRONTAL_HALF_ANGLE + 1e-6);
      }
    }
  });
}

describe('Ignivar Searing Torrent frontal telegraph', () => {
  it('builds layered, hard-edged danger geometry inside the authoritative cone', () => {
    const frontal = buildIgnivarFrontalTelegraph();

    expect(frontal.name).toBe(IGNIVAR_FRONTAL_VISUAL_NAME);
    expect(frontal.getObjectByName(IGNIVAR_FRONTAL_FILL_NAME)).toBeInstanceOf(THREE.Mesh);
    expect(frontal.getObjectByName(IGNIVAR_FRONTAL_BORDER_NAME)).toBeInstanceOf(THREE.Mesh);
    expect(frontal.getObjectByName(IGNIVAR_FRONTAL_HEAT_BANDS_NAME)).toBeInstanceOf(THREE.Mesh);
    expect(frontal.getObjectByName(IGNIVAR_FRONTAL_FLAME_CURTAINS_NAME)).toBeInstanceOf(THREE.Mesh);
    expectInsideFrontal(frontal);
  });

  it('ramps toward impact without compounding material opacity per frame', () => {
    const frontal = buildIgnivarFrontalTelegraph();
    const fill = frontal.getObjectByName(IGNIVAR_FRONTAL_FILL_NAME) as THREE.Mesh;
    const border = frontal.getObjectByName(IGNIVAR_FRONTAL_BORDER_NAME) as THREE.Mesh;
    const curtains = frontal.getObjectByName(IGNIVAR_FRONTAL_FLAME_CURTAINS_NAME) as THREE.Mesh;

    syncIgnivarFrontalTelegraph(frontal, true, 0, 1, 0);
    const start = {
      fill: (fill.material as THREE.Material).opacity,
      border: (border.material as THREE.Material).opacity,
      curtainScale: curtains.scale.y,
    };
    expect(start.fill).toBeGreaterThan(0.15);
    expect(start.border).toBeGreaterThan(0.65);

    syncIgnivarFrontalTelegraph(frontal, true, 0.95, 1, 0);
    const impact = {
      fill: (fill.material as THREE.Material).opacity,
      border: (border.material as THREE.Material).opacity,
      curtainScale: curtains.scale.y,
    };
    expect(impact.fill).toBeGreaterThan(start.fill);
    expect(impact.border).toBeGreaterThanOrEqual(start.border);
    expect(impact.curtainScale).toBeGreaterThan(start.curtainScale);
    syncIgnivarFrontalTelegraph(frontal, true, 0.95, 1, 0);
    expect({
      fill: (fill.material as THREE.Material).opacity,
      border: (border.material as THREE.Material).opacity,
      curtainScale: curtains.scale.y,
    }).toEqual(impact);

    syncIgnivarFrontalTelegraph(frontal, false, 0, 1, 0);
    expect(frontal.visible).toBe(false);
  });

  it('advances its fire pulse only when positive time elapses', () => {
    const frontal = buildIgnivarFrontalTelegraph();
    const curtains = frontal.getObjectByName(IGNIVAR_FRONTAL_FLAME_CURTAINS_NAME) as THREE.Mesh;
    syncIgnivarFrontalTelegraph(frontal, true, 0.75, 1, 0.1);
    const first = {
      elapsed: frontal.userData.elapsed,
      opacity: (curtains.material as THREE.Material).opacity,
      scale: curtains.scale.y,
    };
    syncIgnivarFrontalTelegraph(frontal, true, 0.75, 1, 0);
    expect({
      elapsed: frontal.userData.elapsed,
      opacity: (curtains.material as THREE.Material).opacity,
      scale: curtains.scale.y,
    }).toEqual(first);
  });
});
