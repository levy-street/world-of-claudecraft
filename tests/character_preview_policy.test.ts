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

  it('uses a single-sample transient buffer at a capped 1.5x DPR on constrained devices', () => {
    // 1.5x, not 1x: the phone creator's face close-up read soft at 1x, and the
    // preview canvas is only a few hundred CSS px, so the cost is small
    expect(resolveCharacterPreviewPolicy(true)).toEqual({
      antialias: false,
      preserveDrawingBuffer: false,
      pixelRatioCap: 1.5,
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
    // Every iOS WebKit host (Safari, other iOS browsers, and the packaged app), not just
    // NATIVE_APP: GFX.constrainedMemory already folds in platform === 'ios' (iosMemoryProfile)
    // alongside the generic touch/coarse-pointer detector.
    expect(main).toMatch(
      /new CharacterPreview\(container, canvas, \{[\s\S]*?constrainedMemory: GFX\.constrainedMemory,?\s*\}\)/,
    );
    expect(preview).toContain('resolveCharacterPreviewPolicy(options.constrainedMemory === true)');
    expect(preview).toContain('antialias: policy.antialias');
    expect(preview).toContain('preserveDrawingBuffer: policy.preserveDrawingBuffer');
    expect(preview).toContain('Math.min(window.devicePixelRatio, policy.pixelRatioCap)');
    const animateStart = preview.indexOf('private animateFrame(): void {');
    const animateEnd = preview.indexOf('\n  /**', animateStart + 1);
    const animate = preview.slice(animateStart, animateEnd);
    expect(animate.indexOf('characterPreviewFrameVisible(')).toBeGreaterThan(-1);
    expect(animate.indexOf('characterPreviewFrameVisible(')).toBeLessThan(
      animate.indexOf('this.renderer.render(this.scene, this.camera)'),
    );
  });
});
