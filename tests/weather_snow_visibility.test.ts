import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Weather } from '../src/render/weather';
import type { BiomeId } from '../src/sim/types';

beforeEach(() => {
  const context = {
    fillStyle: '',
    fillRect: vi.fn(),
    createRadialGradient: () => ({ addColorStop: vi.fn() }),
    createLinearGradient: () => ({ addColorStop: vi.fn() }),
  };
  vi.stubGlobal('document', {
    createElement: () => ({ width: 0, height: 0, getContext: () => context }),
  });
});
afterEach(() => vi.unstubAllGlobals());

function fixture() {
  const scene = new THREE.Scene();
  const weather = new Weather(scene, true);
  const points = scene.children[0] as THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
  return { weather, points, material: points.material };
}

function settle(weather: Weather, biome: BiomeId, biomeAt = (_x: number, _z: number) => biome) {
  const camera = new THREE.Vector3();
  for (let step = 0; step < 200; step++) weather.update(camera, 0.1, biome, biomeAt);
}

describe('Studio snowfall visibility', () => {
  it('defaults snow on, hides it immediately when disabled, and restores it when enabled', () => {
    const { weather, points, material } = fixture();
    settle(weather, 'peaks');
    expect(points.visible).toBe(true);
    expect(material.opacity).toBeGreaterThan(0.9);
    const snowTexture = material.map;
    weather.setSnowEnabled(false);
    expect(points.visible).toBe(false);
    expect(material.opacity).toBe(0);
    settle(weather, 'peaks');
    expect(points.visible).toBe(false);
    weather.setSnowEnabled(true);
    settle(weather, 'peaks');
    expect(points.visible).toBe(true);
    expect(material.map).toBe(snowTexture);
  });

  it('suppresses neighbouring snow seen from a clear biome and restores remote snow too', () => {
    const { weather, points } = fixture();
    const remote = (x: number): BiomeId => (x > 10 ? 'frost' : 'amber');
    settle(weather, 'amber', remote);
    expect(points.visible).toBe(true);
    weather.setSnowEnabled(false);
    settle(weather, 'amber', remote);
    expect(points.visible).toBe(false);
    weather.setSnowEnabled(true);
    settle(weather, 'amber', remote);
    expect(points.visible).toBe(true);
  });

  it('leaves live rain unchanged while the snow preference changes', () => {
    const { weather, points, material } = fixture();
    settle(weather, 'marsh');
    const rainTexture = material.map;
    const rainOpacity = material.opacity;
    weather.setSnowEnabled(false);
    expect(points.visible).toBe(true);
    expect(material.opacity).toBe(rainOpacity);
    settle(weather, 'marsh');
    expect(points.visible).toBe(true);
    expect(material.map).toBe(rainTexture);
    weather.setSnowEnabled(true);
    expect(points.visible).toBe(true);
    expect(material.map).toBe(rainTexture);
  });

  it('still finds distant rain when a nearer snowy neighbour is disabled', () => {
    const { weather, points, material } = fixture();
    const mixed = (x: number): BiomeId => (x > 35 ? 'marsh' : x < -10 ? 'peaks' : 'amber');
    settle(weather, 'amber', mixed);
    expect(material.color.getHex()).toBe(0xffffff);
    weather.setSnowEnabled(false);
    settle(weather, 'amber', mixed);
    expect(points.visible).toBe(true);
    expect(material.color.getHex()).toBe(0x9fc4e0);
  });

  it('cannot re-enable precipitation disabled by the master weather setting', () => {
    const { weather, points } = fixture();
    weather.setEnabled(false);
    weather.setSnowEnabled(false);
    weather.setSnowEnabled(true);
    settle(weather, 'peaks');
    expect(points.visible).toBe(false);
    settle(weather, 'marsh');
    expect(points.visible).toBe(false);
    weather.setEnabled(true);
    weather.setSnowEnabled(false);
    settle(weather, 'peaks');
    expect(points.visible).toBe(false);
    settle(weather, 'marsh');
    expect(points.visible).toBe(true);
  });
});
