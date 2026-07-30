import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { artisanRowPreloadInternalsForTest } from '../src/render/artisan_row_props';
import { REMOVED_EASTBROOK_PLACEMENTS } from '../src/sim/eastbrook_layout';

describe('removed Artisan Row renderer placements', () => {
  it('retains model-inventory metadata without retaining a runtime builder or preload path', () => {
    const { assetUrl, targetHeight } = artisanRowPreloadInternalsForTest;
    expect(Object.keys(assetUrl)).toHaveLength(10);
    expect(Object.keys(targetHeight).sort()).toEqual(Object.keys(assetUrl).sort());
    for (const kind of Object.keys(assetUrl) as Array<keyof typeof assetUrl>) {
      expect(assetUrl[kind]).toMatch(/^\/models\/props\/.+\.glb$/);
      expect(targetHeight[kind]).toBeGreaterThan(0);
    }

    const source = readFileSync(
      new URL('../src/render/artisan_row_props.ts', import.meta.url),
      'utf8',
    );
    expect(source).not.toContain('buildArtisanRowProps');
    expect(source).not.toContain('registerPreload(');
    expect(source).not.toContain('loadGltf(');
    expect(source).not.toContain('ARTISAN_ROW_PLACEMENTS');
  });

  it('keeps all ten removed placements in the canonical replacement inventory', () => {
    const removed = REMOVED_EASTBROOK_PLACEMENTS.artisanRow;
    expect(removed).toHaveLength(10);
    expect(new Set(removed.map((placement) => placement.id)).size).toBe(10);
    expect(removed.every((placement) => placement.disposition === 'removed')).toBe(true);
    expect(removed.map((placement) => placement.assetId).sort()).toEqual(
      Object.values(artisanRowPreloadInternalsForTest.assetUrl).sort(),
    );
  });

  it('does not mount the superseded subtree from the renderer', () => {
    const source = readFileSync(new URL('../src/render/renderer.ts', import.meta.url), 'utf8');
    expect(source).not.toContain('artisan_row_props');
    expect(source).not.toContain('artisanRowProps');
    expect(source).not.toContain('buildArtisanRowProps');
  });
});
