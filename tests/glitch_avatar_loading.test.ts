// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { syncGlitchAvatarLoading } from '../src/ui/glitch_avatar_loading';

function loadingHarness(): { container: HTMLElement; indicator: HTMLElement } {
  const container = document.createElement('div');
  const indicator = document.createElement('div');
  indicator.dataset.glitchAvatarLoading = '';
  indicator.hidden = true;
  container.appendChild(indicator);
  return { container, indicator };
}

describe('Glitch avatar loading indicator', () => {
  it('shows while an active Glitch preview is waiting for assets', () => {
    const { container, indicator } = loadingHarness();

    syncGlitchAvatarLoading(container, { glitchActive: true, previewReady: false });

    expect(indicator.hidden).toBe(false);
    expect(container.classList.contains('glitch-avatar-loading-active')).toBe(true);
  });

  it('hides once the Glitch character preview is ready', () => {
    const { container, indicator } = loadingHarness();
    syncGlitchAvatarLoading(container, { glitchActive: true, previewReady: false });

    syncGlitchAvatarLoading(container, { glitchActive: true, previewReady: true });

    expect(indicator.hidden).toBe(true);
    expect(container.classList.contains('glitch-avatar-loading-active')).toBe(false);
  });

  it('never shows outside the Glitch runtime', () => {
    const { container, indicator } = loadingHarness();

    syncGlitchAvatarLoading(container, { glitchActive: false, previewReady: false });

    expect(indicator.hidden).toBe(true);
    expect(container.classList.contains('glitch-avatar-loading-active')).toBe(false);
  });

  it('keeps the static graphic and lifecycle wiring in the game shell', () => {
    const html = readFileSync('index.html', 'utf8');
    const main = readFileSync('src/main.ts', 'utf8');
    const css = readFileSync('src/styles/shell.css', 'utf8');

    expect(html).toContain('data-glitch-avatar-loading');
    expect(html).toContain('data-i18n="character.loading"');
    expect(main.match(/syncGlitchAvatarLoading\(/g)).toHaveLength(2);
    expect(css).toContain('body.glitch-mode .glitch-avatar-loading');
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
  });
});
