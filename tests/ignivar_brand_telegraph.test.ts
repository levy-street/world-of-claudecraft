import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  buildIgnivarBrandTelegraph,
  IGNIVAR_BRAND_CRACKS_NAME,
  IGNIVAR_BRAND_EMBERS_NAME,
  IGNIVAR_BRAND_FILL_NAME,
  IGNIVAR_BRAND_FLAME_NAME,
  IGNIVAR_BRAND_OVERHEAD_RING_NAME,
  IGNIVAR_BRAND_RIM_NAME,
  IGNIVAR_BRAND_RUNES_NAME,
  IGNIVAR_BRAND_SPIKES_NAME,
  IGNIVAR_BRAND_VISUAL_NAME,
  syncIgnivarBrandTelegraph,
} from '../src/render/ignivar_brand_telegraph';
import { IGNIVAR_BRAND_RADIUS } from '../src/sim/encounters/ignivar';

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

function maxAuthoredRadius(object: THREE.Object3D): number {
  const geometry = (object as THREE.Mesh).geometry;
  const positions = geometry.getAttribute('position') as THREE.BufferAttribute;
  let maxRadius = 0;
  for (let index = 0; index < positions.count; index++) {
    maxRadius = Math.max(maxRadius, Math.hypot(positions.getX(index), positions.getZ(index)));
  }
  return maxRadius;
}

describe('Ignivar Brand of the Pyre telegraph', () => {
  it('pins the authoritative 4.5 yard personal-space radius', () => {
    expect(IGNIVAR_BRAND_RADIUS).toBe(4.5);
  });

  it('builds a spread marker whose authored footprint never exceeds the damage radius', () => {
    const brand = buildIgnivarBrandTelegraph();

    expect(brand.name).toBe(IGNIVAR_BRAND_VISUAL_NAME);
    expect(brand.getObjectByName(IGNIVAR_BRAND_FILL_NAME)).toBeInstanceOf(THREE.Mesh);
    expect(brand.getObjectByName(IGNIVAR_BRAND_RIM_NAME)).toBeInstanceOf(THREE.Mesh);
    expect(brand.getObjectByName(IGNIVAR_BRAND_CRACKS_NAME)).toBeInstanceOf(THREE.Mesh);
    expect(brand.getObjectByName(IGNIVAR_BRAND_RUNES_NAME)).toBeInstanceOf(THREE.Mesh);
    expect(brand.getObjectByName(IGNIVAR_BRAND_SPIKES_NAME)).toBeInstanceOf(THREE.Mesh);
    expect(brand.getObjectByName(IGNIVAR_BRAND_FLAME_NAME)).toBeInstanceOf(THREE.InstancedMesh);
    expect(brand.getObjectByName(IGNIVAR_BRAND_EMBERS_NAME)).toBeInstanceOf(THREE.Points);
    expect(brand.getObjectByName(IGNIVAR_BRAND_OVERHEAD_RING_NAME)).toBeInstanceOf(THREE.Mesh);
    expectGeometryInsideRadius(brand, IGNIVAR_BRAND_RADIUS);

    const fill = brand.getObjectByName(IGNIVAR_BRAND_FILL_NAME) as THREE.Mesh;
    const rim = brand.getObjectByName(IGNIVAR_BRAND_RIM_NAME) as THREE.Mesh;
    expect(maxAuthoredRadius(fill)).toBeCloseTo(IGNIVAR_BRAND_RADIUS, 6);
    expect(maxAuthoredRadius(rim)).toBeCloseTo(IGNIVAR_BRAND_RADIUS, 6);

    const spikes = brand.getObjectByName(IGNIVAR_BRAND_SPIKES_NAME) as THREE.Mesh;
    const spikePositions = spikes.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let index = 0; index < spikePositions.count; index += 3) {
      const baseRadius = Math.hypot(spikePositions.getX(index), spikePositions.getZ(index));
      const tipRadius = Math.hypot(spikePositions.getX(index + 2), spikePositions.getZ(index + 2));
      expect(tipRadius).toBeLessThan(baseRadius);
    }

    const fillMaterial = fill.material as THREE.MeshBasicMaterial;
    const rimMaterial = rim.material as THREE.MeshBasicMaterial;
    expect(fillMaterial.color.getHex()).toBeLessThanOrEqual(0x4f0808);
    expect(fillMaterial.blending).toBe(THREE.NormalBlending);
    expect(rimMaterial.blending).toBe(THREE.NormalBlending);
    expect(fillMaterial.opacity).toBeLessThanOrEqual(0.46);
    expect(rimMaterial.opacity).toBeLessThanOrEqual(0.82);
  });

  it('intensifies for stacks and pulses decisively when another player enters the radius', () => {
    const brand = buildIgnivarBrandTelegraph();
    const fill = brand.getObjectByName(IGNIVAR_BRAND_FILL_NAME) as THREE.Mesh;
    const rim = brand.getObjectByName(IGNIVAR_BRAND_RIM_NAME) as THREE.Mesh;
    const flame = brand.getObjectByName(IGNIVAR_BRAND_FLAME_NAME) as THREE.InstancedMesh;
    const embers = brand.getObjectByName(IGNIVAR_BRAND_EMBERS_NAME) as THREE.Points;

    syncIgnivarBrandTelegraph(brand, true, 1, 0, 1, 0);
    const safeFill = (fill.material as THREE.Material).opacity;
    const safeRim = (rim.material as THREE.Material).opacity;
    const safeFlameScale = flame.scale.y;
    const safeEmberScale = embers.scale.y;
    expect(brand.visible).toBe(true);
    expect(brand.userData.overlapDanger).toBe(false);

    syncIgnivarBrandTelegraph(brand, true, 3, 0, 1, 0);
    expect((fill.material as THREE.Material).opacity).toBeGreaterThan(safeFill);
    expect((rim.material as THREE.Material).opacity).toBeGreaterThan(safeRim);
    expect(flame.scale.y).toBeGreaterThan(safeFlameScale);
    expect(embers.scale.y).toBeGreaterThan(safeEmberScale);
    const stackedFill = (fill.material as THREE.Material).opacity;
    const stackedRim = (rim.material as THREE.Material).opacity;

    syncIgnivarBrandTelegraph(brand, true, 3, 1, 1, 0);
    expect(brand.userData.overlapDanger).toBe(true);
    expect(brand.userData.nearbyPlayers).toBe(1);
    expect((fill.material as THREE.Material).opacity).toBeGreaterThan(stackedFill);
    expect((rim.material as THREE.Material).opacity).toBeGreaterThanOrEqual(stackedRim);
    expect((fill.material as THREE.Material).opacity).toBeLessThanOrEqual(0.62);
    expect((rim.material as THREE.Material).opacity).toBeLessThanOrEqual(0.94);
    expect((flame.material as THREE.Material).opacity).toBeLessThanOrEqual(0.86);

    const dangerSnapshot = {
      fill: (fill.material as THREE.Material).opacity,
      rim: (rim.material as THREE.Material).opacity,
      flame: flame.scale.y,
    };
    syncIgnivarBrandTelegraph(brand, true, 3, 1, 1, 0);
    expect({
      fill: (fill.material as THREE.Material).opacity,
      rim: (rim.material as THREE.Material).opacity,
      flame: flame.scale.y,
    }).toEqual(dangerSnapshot);

    syncIgnivarBrandTelegraph(brand, false, 1, 0, 1, 0);
    expect(brand.visible).toBe(false);
  });

  it('advances animated fire layers only when positive time elapses', () => {
    const brand = buildIgnivarBrandTelegraph();
    const embers = brand.getObjectByName(IGNIVAR_BRAND_EMBERS_NAME) as THREE.Points;
    const spikes = brand.getObjectByName(IGNIVAR_BRAND_SPIKES_NAME) as THREE.Mesh;
    const runes = brand.getObjectByName(IGNIVAR_BRAND_RUNES_NAME) as THREE.Mesh;
    const cracks = brand.getObjectByName(IGNIVAR_BRAND_CRACKS_NAME) as THREE.Mesh;
    syncIgnivarBrandTelegraph(brand, true, 2, 1, 1, 0.1);
    const first = {
      elapsed: brand.userData.elapsed,
      emberRotation: embers.rotation.y,
      spikeScale: spikes.scale.x,
      runeRotation: runes.rotation.y,
      crackOpacity: (cracks.material as THREE.Material).opacity,
    };
    syncIgnivarBrandTelegraph(brand, true, 2, 1, 1, 0);
    expect({
      elapsed: brand.userData.elapsed,
      emberRotation: embers.rotation.y,
      spikeScale: spikes.scale.x,
      runeRotation: runes.rotation.y,
      crackOpacity: (cracks.material as THREE.Material).opacity,
    }).toEqual(first);
    syncIgnivarBrandTelegraph(brand, true, 2, 1, 1, 0.1);
    expect(brand.userData.elapsed).toBeCloseTo(0.2);
    expect(embers.rotation.y).toBeGreaterThan(first.emberRotation);
    expect(spikes.scale.x).not.toBe(first.spikeScale);
    expect(runes.rotation.y).not.toBe(first.runeRotation);
    expect((cracks.material as THREE.Material).opacity).not.toBe(first.crackOpacity);
  });

  it('settles decorative motion while keeping the danger footprint visible', () => {
    const brand = buildIgnivarBrandTelegraph();
    const runes = brand.getObjectByName(IGNIVAR_BRAND_RUNES_NAME) as THREE.Mesh;
    const embers = brand.getObjectByName(IGNIVAR_BRAND_EMBERS_NAME) as THREE.Points;

    syncIgnivarBrandTelegraph(brand, true, 3, 1, 1, 0.5, true);
    const first = { runes: runes.rotation.y, embers: embers.rotation.y };
    syncIgnivarBrandTelegraph(brand, true, 3, 1, 1, 0.5, true);

    expect(brand.visible).toBe(true);
    expect(Math.abs(first.runes)).toBe(0);
    expect(Math.abs(first.embers)).toBe(0);
    expect({ runes: runes.rotation.y, embers: embers.rotation.y }).toEqual(first);
  });
});
