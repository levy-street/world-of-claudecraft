// Start-screen banner shown after the world-entry crash guard lowered the graphics
// preset (src/game/entry_crash_guard.ts): the player's previous entry attempt killed
// the WebView process, so they never saw an error. This tells them what happened and
// where the graphics control is, on the one screen the recovery guarantees they reach.
// Thin DOM painter over the static #entry-guard-banner shell in index.html.

import { type TranslationKey, t } from './i18n';

const PRESET_LABEL_KEYS: Record<number, TranslationKey> = {
  1: 'hud.options.graphicsPresetLow',
  2: 'hud.options.graphicsPresetMedium',
  3: 'hud.options.graphicsPresetHigh',
  4: 'hud.options.graphicsPresetUltra',
  5: 'hud.options.graphicsPresetAdvanced',
};

/** Localized display name for a graphicsPreset settings value. */
export function graphicsPresetDisplayName(preset: number): string {
  const key = PRESET_LABEL_KEYS[Math.round(preset)];
  return key ? t(key) : t('hud.options.graphicsPresetLow');
}

/** Body class that suppresses the Discord CTA while the recovery banner is up. */
const ENTRY_GUARD_OPEN_CLASS = 'entry-guard-open';

function paintBanner(banner: HTMLElement, preset: number): void {
  const body = banner.querySelector<HTMLElement>('.entry-guard-body');
  if (body) {
    body.textContent = t('entryGuard.body', { preset: graphicsPresetDisplayName(preset) });
  }
}

/**
 * Reveal the banner with the recovered preset named in the body. Safe to call on
 * entries whose DOM lacks the banner shell: it no-ops. While visible it suppresses
 * the Discord CTA (both live in the same fixed top-center slot), and it repaints the
 * dynamic body on a locale flip (the title/dismiss retranslate via data-i18n, but the
 * body's interpolated preset label is painted here).
 */
export function showEntryGuardBanner(preset: number): void {
  const banner = document.getElementById('entry-guard-banner');
  if (!banner) return;
  // Remember the preset so a woc:languagechange can repaint the body in the new locale.
  banner.dataset.preset = String(preset);
  paintBanner(banner, preset);
  banner.hidden = false;
  document.body.classList.add(ENTRY_GUARD_OPEN_CLASS);
  const hide = () => {
    banner.hidden = true;
    document.body.classList.remove(ENTRY_GUARD_OPEN_CLASS);
  };
  const dismiss = banner.querySelector<HTMLButtonElement>('.entry-guard-dismiss');
  // dataset guard: a repeat call (re-shown banner) must not stack listeners.
  if (dismiss && !dismiss.dataset.wired) {
    dismiss.dataset.wired = '1';
    dismiss.addEventListener('click', hide);
  }
  if (!banner.dataset.langWired) {
    banner.dataset.langWired = '1';
    document.addEventListener('woc:languagechange', () => {
      if (banner.hidden) return;
      const stored = Number(banner.dataset.preset);
      if (Number.isFinite(stored)) paintBanner(banner, stored);
    });
  }
}
