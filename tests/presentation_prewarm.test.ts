import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { withSceneHiddenForPresentationPrewarm } from '../src/render/presentation_prewarm';

describe('withSceneHiddenForPresentationPrewarm', () => {
  it('warms the presentation path without submitting scene objects', () => {
    const scene = { visible: true };
    const render = vi.fn(() => expect(scene.visible).toBe(false));
    withSceneHiddenForPresentationPrewarm(scene, render);
    expect(render).toHaveBeenCalledOnce();
    expect(scene.visible).toBe(true);
  });

  it('restores a pre-hidden scene and restores after a render failure', () => {
    const scene = { visible: false };
    expect(() =>
      withSceneHiddenForPresentationPrewarm(scene, () => {
        expect(scene.visible).toBe(false);
        throw new Error('post failed');
      }),
    ).toThrow('post failed');
    expect(scene.visible).toBe(false);
  });
});

describe('renderer presentation prewarm wiring', () => {
  it('runs the composer-only pass after world settle and before broad compile submission', () => {
    const source = readFileSync(new URL('../src/render/renderer.ts', import.meta.url), 'utf8');
    const settleAt = source.indexOf("id: 'world.settle-state'");
    const postAt = source.indexOf("id: 'post.initial-frame'", settleAt);
    const compileAt = source.indexOf("id: 'programs.compile-submit'", settleAt);
    const entry = source.slice(postAt, compileAt);
    expect(postAt).toBeGreaterThan(settleAt);
    expect(compileAt).toBeGreaterThan(postAt);
    expect(entry).toContain('this.renderPresentationPrewarmPass()');
    expect(entry).toContain('deadlineExempt: true');
  });
});
