import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Weather } from '../src/render/weather';

// weather.ts mints its two point textures via document.createElement('canvas')
// in the constructor; stub just enough canvas surface for that, the same
// pattern tests/vfx.test.ts uses for the other Three/document-touching
// render overlay module.
function installCanvasStub(): void {
  const context = {
    fillStyle: '',
    fillRect: vi.fn(),
    createRadialGradient: () => ({ addColorStop: vi.fn() }),
    createLinearGradient: () => ({ addColorStop: vi.fn() }),
  };
  vi.stubGlobal('document', {
    createElement: () => ({
      width: 0,
      height: 0,
      getContext: () => context,
    }),
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

interface WeatherProbe {
  material: THREE.PointsMaterial;
  points: THREE.Points;
  mode: 'snow' | 'rain';
  intensity: number;
  textures: { flake: THREE.CanvasTexture; streak: THREE.CanvasTexture };
}

// Drive update() for a stretch of simulated time so the eased intensity has
// settled toward its steady-state target (transitionAlpha never reaches 1).
function settle(
  weather: Weather,
  cam: THREE.Vector3,
  biome: Parameters<Weather['update']>[2],
): void {
  for (let i = 0; i < 200; i++) weather.update(cam, 0.1, biome);
}

describe('ambient precipitation biome mapping', () => {
  it('rains over the haunt biome, matching the permanent-drizzle ambience', () => {
    // Wraithwood's content header ("a drizzle that never quite stops") and
    // renderer.ts's ambient-audio precip mapping both put haunt under rain;
    // Weather.update must agree so the drizzle players hear is also visible.
    installCanvasStub();
    const scene = new THREE.Scene();
    const weather = new Weather(scene, false);
    const probe = weather as unknown as WeatherProbe;
    const cam = new THREE.Vector3(0, 0, 0);

    settle(weather, cam, 'haunt');

    expect(probe.mode).toBe('rain');
    expect(probe.points.visible).toBe(true);
    expect(probe.material.map).toBe(probe.textures.streak);
    expect(probe.material.color.getHex()).toBe(0x9fc4e0);
    expect(probe.material.opacity).toBeGreaterThan(0.65);
  });

  it('keeps snow on the peaks and stays clear on biomes with no weather', () => {
    installCanvasStub();
    const scene = new THREE.Scene();
    const weather = new Weather(scene, false);
    const probe = weather as unknown as WeatherProbe;
    const cam = new THREE.Vector3(0, 0, 0);

    settle(weather, cam, 'peaks');
    expect(probe.mode).toBe('snow');
    expect(probe.points.visible).toBe(true);
    expect(probe.material.map).toBe(probe.textures.flake);

    settle(weather, cam, 'vale');
    expect(probe.points.visible).toBe(false);
  });
});
