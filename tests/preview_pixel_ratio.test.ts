// The shared pixel-ratio clamp for the two secondary preview contexts
// (src/render/preview_pixel_ratio.ts): a preview opens over the live world and
// must never draw at a higher ratio than the world's active tier cap.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GFX } from '../src/render/gfx';
import { previewPixelRatio } from '../src/render/preview_pixel_ratio';

const src = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');

describe('preview pixel ratio', () => {
  it('caps the device ratio at the tier cap and never raises it', () => {
    expect(previewPixelRatio(3, 1.48)).toBe(1.48);
    expect(previewPixelRatio(2, 1.75)).toBe(1.75);
    expect(previewPixelRatio(1, 1.75)).toBe(1);
    expect(previewPixelRatio(3, 1)).toBe(1);
  });

  it('defaults the cap to the live world tier cap', () => {
    expect(previewPixelRatio(10)).toBe(GFX.pixelRatioCap);
    expect(previewPixelRatio(0.5)).toBe(0.5);
  });

  it('is the one clamp both preview rigs use (no flat cap of 2 left)', () => {
    for (const rel of ['../src/render/armory_preview.ts', '../src/render/mount_preview.ts']) {
      const text = src(rel);
      expect(text, rel).toContain(
        'renderer.setPixelRatio(previewPixelRatio(window.devicePixelRatio));',
      );
      expect(text, rel).not.toContain('Math.min(window.devicePixelRatio, 2)');
    }
    expect(src('../src/render/preview_pixel_ratio.ts')).toContain('cap = GFX.pixelRatioCap');
  });
});
