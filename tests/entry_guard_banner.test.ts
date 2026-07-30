// @vitest-environment jsdom
//
// Thin-painter coverage for the world-entry crash recovery banner: localized preset
// display names (including the unknown-preset fallback), body interpolation through
// t(), the missing-shell no-op (play.html), and the dataset guard that keeps a
// repeat show from stacking dismiss listeners. The decision logic itself is covered
// in tests/entry_crash_guard.test.ts.
import { beforeEach, describe, expect, it } from 'vitest';
import { graphicsPresetDisplayName, showEntryGuardBanner } from '../src/ui/entry_guard_banner';
import { t } from '../src/ui/i18n';

const BANNER_HTML = `
  <div id="entry-guard-banner" hidden>
    <div class="entry-guard-text">
      <strong class="entry-guard-title"></strong>
      <span class="entry-guard-body"></span>
    </div>
    <button type="button" class="entry-guard-dismiss"></button>
  </div>
`;

describe('graphicsPresetDisplayName', () => {
  it('maps every settings preset value to its localized options label', () => {
    expect(graphicsPresetDisplayName(1)).toBe(t('hud.options.graphicsPresetLow'));
    expect(graphicsPresetDisplayName(2)).toBe(t('hud.options.graphicsPresetMedium'));
    expect(graphicsPresetDisplayName(3)).toBe(t('hud.options.graphicsPresetHigh'));
    expect(graphicsPresetDisplayName(4)).toBe(t('hud.options.graphicsPresetUltra'));
    expect(graphicsPresetDisplayName(5)).toBe(t('hud.options.graphicsPresetAdvanced'));
  });

  it('falls back to the Low label for out-of-range values', () => {
    expect(graphicsPresetDisplayName(0)).toBe(t('hud.options.graphicsPresetLow'));
    expect(graphicsPresetDisplayName(99)).toBe(t('hud.options.graphicsPresetLow'));
  });
});

describe('showEntryGuardBanner', () => {
  beforeEach(() => {
    document.body.innerHTML = BANNER_HTML;
  });

  it('reveals the banner with the localized preset interpolated into the body', () => {
    showEntryGuardBanner(2);
    const banner = document.getElementById('entry-guard-banner') as HTMLElement;
    expect(banner.hidden).toBe(false);
    const body = banner.querySelector('.entry-guard-body') as HTMLElement;
    expect(body.textContent).toBe(
      t('entryGuard.body', { preset: t('hud.options.graphicsPresetMedium') }),
    );
    // The interpolation actually landed (no raw {preset} token left behind).
    expect(body.textContent).not.toContain('{preset}');
  });

  it('dismiss hides the banner, and a repeat show does not stack listeners', () => {
    showEntryGuardBanner(1);
    showEntryGuardBanner(1);
    const banner = document.getElementById('entry-guard-banner') as HTMLElement;
    const dismiss = banner.querySelector('.entry-guard-dismiss') as HTMLButtonElement;
    expect(dismiss.dataset.wired).toBe('1');
    dismiss.click();
    expect(banner.hidden).toBe(true);
    // Re-shown after a dismiss: the single wired listener still works.
    showEntryGuardBanner(1);
    expect(banner.hidden).toBe(false);
    dismiss.click();
    expect(banner.hidden).toBe(true);
  });

  it('suppresses the Discord CTA while open and restores it on dismiss', () => {
    showEntryGuardBanner(2);
    expect(document.body.classList.contains('entry-guard-open')).toBe(true);
    const dismiss = document.querySelector('.entry-guard-dismiss') as HTMLButtonElement;
    dismiss.click();
    expect(document.body.classList.contains('entry-guard-open')).toBe(false);
  });

  it('repaints the interpolated body on a locale change while visible', () => {
    showEntryGuardBanner(3);
    const body = document.querySelector('.entry-guard-body') as HTMLElement;
    const first = body.textContent;
    // Force a different resolved body string, then fire the locale-flip event the
    // shell/options language selector dispatches; the body must repaint from the
    // stored preset rather than staying in the boot locale.
    body.textContent = 'stale';
    document.dispatchEvent(new Event('woc:languagechange'));
    expect(body.textContent).toBe(first);
    expect(body.textContent).not.toBe('stale');
  });

  it('does not repaint after dismiss (no work while hidden)', () => {
    showEntryGuardBanner(3);
    const banner = document.getElementById('entry-guard-banner') as HTMLElement;
    (banner.querySelector('.entry-guard-dismiss') as HTMLButtonElement).click();
    const body = banner.querySelector('.entry-guard-body') as HTMLElement;
    body.textContent = 'stale';
    document.dispatchEvent(new Event('woc:languagechange'));
    expect(body.textContent).toBe('stale');
  });

  it('no-ops on entries whose DOM lacks the banner shell', () => {
    document.body.innerHTML = '';
    expect(() => showEntryGuardBanner(2)).not.toThrow();
    expect(document.body.classList.contains('entry-guard-open')).toBe(false);
  });
});
