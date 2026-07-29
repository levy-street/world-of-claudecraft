// @vitest-environment jsdom
import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  vi.doUnmock('../src/render/assets/loader');
  vi.doUnmock('../src/render/assets/preload');
});

describe('Vfx GPU buffer bounds', () => {
  it('draws and uploads only the live high-water range', async () => {
    vi.doMock('../src/render/assets/loader', () => ({
      loadTexture: vi.fn(() => Promise.resolve(new THREE.Texture())),
    }));
    vi.doMock('../src/render/assets/preload', () => ({
      registerPreload: vi.fn(),
    }));
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((kind) =>
      kind === '2d'
        ? ({
            fillStyle: '',
            fillRect: vi.fn(),
            drawImage: vi.fn(),
            createRadialGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
          } as unknown as CanvasRenderingContext2D)
        : null,
    );

    const { Vfx } = await import('../src/render/vfx');
    const scene = new THREE.Scene();
    const vfx = new Vfx(scene, () => null);
    const points = scene.children.find((child) => (child as THREE.Points).isPoints) as THREE.Points;
    const geometry = points.geometry;
    expect(geometry.drawRange.count).toBe(0);
    for (const attribute of Object.values(geometry.attributes)) {
      expect((attribute as THREE.BufferAttribute).usage).toBe(THREE.DynamicDrawUsage);
    }

    vfx.prewarm(new THREE.Vector3());
    expect(geometry.drawRange).toEqual({ start: 0, count: 16 });
    expect((geometry.attributes.position as THREE.BufferAttribute).updateRanges).toEqual([
      { start: 0, count: 48 },
    ]);
    expect((geometry.attributes.aColor as THREE.BufferAttribute).updateRanges).toEqual([
      { start: 0, count: 48 },
    ]);

    vfx.update(0.1);
    expect((geometry.attributes.aColor as THREE.BufferAttribute).updateRanges).toEqual([]);
    expect((geometry.attributes.aSprite as THREE.BufferAttribute).updateRanges).toEqual([]);
    expect((geometry.attributes.position as THREE.BufferAttribute).updateRanges).toEqual([
      { start: 0, count: 48 },
    ]);

    vfx.clear();
    expect(geometry.drawRange).toEqual({ start: 0, count: 0 });
  });
});
