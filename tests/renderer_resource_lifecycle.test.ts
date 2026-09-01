import { describe, expect, it, vi } from 'vitest';
import {
  disposeRendererPrewarmAndGroundFx,
  disposeRendererWorldViews,
} from '../src/render/renderer_resource_lifecycle';

describe('renderer resource lifecycle', () => {
  it('keeps every renderer-owned VFX owner independent at the lifecycle seam', () => {
    const depthMaterial = {
      dispose: vi.fn(() => {
        throw new Error('depth');
      }),
    };
    const mageGroundFx = {
      dispose: vi.fn(() => {
        throw new Error('mage');
      }),
    };
    const warlockMeteorFx = { dispose: vi.fn() };
    const abilityVfxFx = { dispose: vi.fn() };
    const vfx = { dispose: vi.fn() };
    const prewarmDepthMaterials = new Map([['depth', depthMaterial]]);
    const errors: unknown[] = [];
    const bestEffort = (cleanup: () => void): void => {
      try {
        cleanup();
      } catch (error) {
        errors.push(error);
      }
    };

    disposeRendererPrewarmAndGroundFx(
      { prewarmDepthMaterials, mageGroundFx, warlockMeteorFx, abilityVfxFx, vfx },
      bestEffort,
    );

    expect(depthMaterial.dispose).toHaveBeenCalledOnce();
    expect(mageGroundFx.dispose).toHaveBeenCalledOnce();
    expect(warlockMeteorFx.dispose).toHaveBeenCalledOnce();
    expect(abilityVfxFx.dispose).toHaveBeenCalledOnce();
    expect(vfx.dispose).toHaveBeenCalledOnce();
    expect(prewarmDepthMaterials.size).toBe(0);
    expect(errors).toHaveLength(2);
  });

  it('runs generic VFX cleanup even when a ground owner fails', () => {
    const mageGroundFx = {
      dispose: vi.fn(() => {
        throw new Error('mage');
      }),
    };
    const vfx = { dispose: vi.fn() };
    const abilityVfxFx = { dispose: vi.fn() };
    const errors: unknown[] = [];
    const bestEffort = (cleanup: () => void): void => {
      try {
        cleanup();
      } catch (error) {
        errors.push(error);
      }
    };

    disposeRendererPrewarmAndGroundFx(
      { prewarmDepthMaterials: new Map(), mageGroundFx, vfx, abilityVfxFx },
      bestEffort,
    );

    expect(mageGroundFx.dispose).toHaveBeenCalledOnce();
    expect(vfx.dispose).toHaveBeenCalledOnce();
    expect(abilityVfxFx.dispose).toHaveBeenCalledOnce();
    expect(errors).toHaveLength(1);
  });

  // Regression for the graphics-rebuild heap leak (GitHub issue #3750):
  // disposeRendererResources() never called these views' own dispose()
  // methods, so a renderer swap permanently retained the previous
  // terrain/far-terrain/water/underwater GPU resources on the JS heap.
  describe('disposeRendererWorldViews', () => {
    it('disposes terrain, far terrain, water, and underwater independently, each other failing', () => {
      const terrainView = {
        dispose: vi.fn(() => {
          throw new Error('terrain');
        }),
      };
      const farTerrainView = {
        dispose: vi.fn(() => {
          throw new Error('far terrain');
        }),
      };
      const waterView = { dispose: vi.fn() };
      const underwaterView = {
        dispose: vi.fn(() => {
          throw new Error('underwater');
        }),
      };
      const errors: unknown[] = [];
      const bestEffort = (cleanup: () => void): void => {
        try {
          cleanup();
        } catch (error) {
          errors.push(error);
        }
      };

      disposeRendererWorldViews(terrainView, farTerrainView, waterView, underwaterView, bestEffort);

      expect(terrainView.dispose).toHaveBeenCalledOnce();
      expect(farTerrainView.dispose).toHaveBeenCalledOnce();
      expect(waterView.dispose).toHaveBeenCalledOnce();
      expect(underwaterView.dispose).toHaveBeenCalledOnce();
      expect(errors).toHaveLength(3);
    });

    it('tolerates a view that has not been constructed yet', () => {
      const waterView = { dispose: vi.fn() };
      const errors: unknown[] = [];
      const bestEffort = (cleanup: () => void): void => {
        try {
          cleanup();
        } catch (error) {
          errors.push(error);
        }
      };

      expect(() =>
        disposeRendererWorldViews(undefined, undefined, waterView, undefined, bestEffort),
      ).not.toThrow();

      expect(waterView.dispose).toHaveBeenCalledOnce();
      expect(errors).toHaveLength(0);
    });
  });
});
