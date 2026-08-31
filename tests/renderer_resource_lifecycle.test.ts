import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { disposeRendererPrewarmAndGroundFx } from '../src/render/renderer_resource_lifecycle';
import { stripComments } from './helpers/strip_comments';

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
    // The farm patch visuals joined the seam at the Phase 17 render review:
    // their dispose() had no production caller before this arm existed.
    const farmPatchVisuals = { dispose: vi.fn() };
    // The two release-side FX joined at the Phase 18 sweep for the same
    // reason; the portal one throws here so its failure is proved independent.
    const frozenOrbFx = { dispose: vi.fn() };
    const necromancyArmyPortalFx = {
      dispose: vi.fn(() => {
        throw new Error('portal');
      }),
    };
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
      {
        prewarmDepthMaterials,
        mageGroundFx,
        warlockMeteorFx,
        abilityVfxFx,
        vfx,
        farmPatchVisuals,
        frozenOrbFx,
        necromancyArmyPortalFx,
      },
      bestEffort,
    );

    expect(depthMaterial.dispose).toHaveBeenCalledOnce();
    expect(mageGroundFx.dispose).toHaveBeenCalledOnce();
    expect(warlockMeteorFx.dispose).toHaveBeenCalledOnce();
    expect(abilityVfxFx.dispose).toHaveBeenCalledOnce();
    expect(vfx.dispose).toHaveBeenCalledOnce();
    expect(farmPatchVisuals.dispose).toHaveBeenCalledOnce();
    expect(frozenOrbFx.dispose).toHaveBeenCalledOnce();
    expect(necromancyArmyPortalFx.dispose).toHaveBeenCalledOnce();
    expect(prewarmDepthMaterials.size).toBe(0);
    expect(errors).toHaveLength(3);
  });

  it('the renderer teardown reaches both release FX through this seam (source pin)', () => {
    // The seam reads the owner's fields by name, so the renderer's own field
    // names are the contract: a rename there silently drops the dispose.
    const renderer = stripComments(
      readFileSync(new URL('../src/render/renderer.ts', import.meta.url), 'utf8'),
    );
    expect(renderer).toContain('private frozenOrbFx!: FrozenOrbFx;');
    expect(renderer).toContain('private necromancyArmyPortalFx!: NecromancyArmyPortalFx;');
    expect(renderer).toContain('private farmPatchVisuals: FarmPatchVisuals | null = null;');
    expect(renderer).toContain('disposeRendererPrewarmAndGroundFx(this, bestEffort);');
    // ...and both classes really carry the terminal owner the seam calls.
    expect(
      stripComments(
        readFileSync(new URL('../src/render/frozen_orb_fx.ts', import.meta.url), 'utf8'),
      ),
    ).toContain('dispose(): void {');
    expect(
      stripComments(
        readFileSync(
          new URL('../src/render/necromancy_army_portal_fx.ts', import.meta.url),
          'utf8',
        ),
      ),
    ).toContain('dispose(): void {');
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
