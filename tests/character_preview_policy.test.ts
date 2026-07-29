import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  characterPreviewFrameVisible,
  resolveCharacterPreviewPolicy,
} from '../src/render/characters/preview_policy';

describe('character preview memory policy', () => {
  it('preserves the historical desktop framebuffer quality', () => {
    expect(resolveCharacterPreviewPolicy(false)).toEqual({
      antialias: true,
      preserveDrawingBuffer: true,
      pixelRatioCap: 2,
    });
  });

  it('uses a single-sample, single-DPR transient buffer on constrained devices', () => {
    expect(resolveCharacterPreviewPolicy(true)).toEqual({
      antialias: false,
      preserveDrawingBuffer: false,
      pixelRatioCap: 1,
    });
  });

  it('submits preview frames only while its canvas has a visible host', () => {
    expect(characterPreviewFrameVisible(true, 260, 320)).toBe(true);
    expect(characterPreviewFrameVisible(false, 260, 320)).toBe(false);
    expect(characterPreviewFrameVisible(true, 0, 320)).toBe(false);
    expect(characterPreviewFrameVisible(true, 260, 0)).toBe(false);
  });

  it('is wired through the HUD device profile and preview render loop', () => {
    const hud = readFileSync(new URL('../src/ui/hud.ts', import.meta.url), 'utf8');
    const preview = readFileSync(
      new URL('../src/render/characters/preview.ts', import.meta.url),
      'utf8',
    );
    expect(hud).toContain('constrainedMemory: this.features.constrainedMemory === true');
    const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
    expect(main).toMatch(
      /new CharacterPreview\(container, canvas, \{\s*constrainedMemory: NATIVE_APP,?\s*\}\)/,
    );
    expect(preview).toContain('resolveCharacterPreviewPolicy(options.constrainedMemory === true)');
    expect(preview).toContain('antialias: policy.antialias');
    expect(preview).toContain('preserveDrawingBuffer: policy.preserveDrawingBuffer');
    expect(preview).toContain('Math.min(window.devicePixelRatio, policy.pixelRatioCap)');
    const animateStart = preview.indexOf('private animate = (): void => {');
    const animateEnd = preview.indexOf('\n  private ', animateStart + 1);
    const animate = preview.slice(animateStart, animateEnd);
    expect(animate.indexOf('characterPreviewFrameVisible(')).toBeGreaterThan(-1);
    expect(animate.indexOf('characterPreviewFrameVisible(')).toBeLessThan(
      animate.indexOf('this.renderer.render(this.scene, this.camera)'),
    );
  });
});
