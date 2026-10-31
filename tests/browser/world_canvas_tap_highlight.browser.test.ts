// The hover cursor makes the entire world canvas a clickable surface to Blink.
// A native tap highlight then covers the viewport, rather than just the mob.
// Check the shipped cascade: input-handler unit tests cannot observe this overlay.
import { afterEach, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { cursorForHover } from '../../src/game/cursors';
import '../../src/styles/index.css';

const TRANSPARENT = 'rgba(0, 0, 0, 0)';

afterEach(() => {
  document.body.innerHTML = '';
  document.body.className = '';
  document.documentElement.style.removeProperty('--app-vw');
  document.documentElement.style.removeProperty('--app-vh');
});

describe.each([
  { width: 915, height: 412 },
  { width: 412, height: 915 },
])('world canvas touch feedback at $width x $height', ({ width, height }) => {
  it('never highlights the viewport when the mob hover cursor becomes interactive', async () => {
    await page.viewport(width, height);
    document.body.className = 'game-active mobile-touch';
    document.documentElement.style.setProperty('--app-vw', `${width}px`);
    document.documentElement.style.setProperty('--app-vh', `${height}px`);
    const canvas = document.createElement('canvas');
    canvas.id = 'game-canvas';
    document.body.append(canvas);
    const bounds = canvas.getBoundingClientRect();
    expect(bounds.width).toBe(width);
    expect(bounds.height).toBe(height);
    for (const kind of ['attack', 'friendly', 'default'] as const) {
      canvas.style.cursor = cursorForHover(kind, false);
      expect(getComputedStyle(canvas).getPropertyValue('-webkit-tap-highlight-color'), kind).toBe(
        TRANSPARENT,
      );
    }
  });

  it('preserves native tap feedback on ordinary HUD controls', () => {
    document.body.className = 'game-active mobile-touch';
    const button = document.createElement('button');
    button.id = 'mobile-target-cycle';
    document.body.append(button);
    expect(getComputedStyle(button).getPropertyValue('-webkit-tap-highlight-color')).not.toBe(
      TRANSPARENT,
    );
  });
});
