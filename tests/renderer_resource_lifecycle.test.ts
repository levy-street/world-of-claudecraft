import { describe, expect, it, vi } from 'vitest';
import { disposeRendererPrewarmAndGroundFx } from '../src/render/renderer_resource_lifecycle';

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
});
