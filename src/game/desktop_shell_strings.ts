// The Electron main process has no i18n runtime, but its crash dialogs are
// player-visible, so the renderer pushes t()-rendered strings over the
// wocDesktop bridge at boot and on every locale flip. The main-process side
// caches them (electron/shell_strings.cjs) and falls back to English only for
// a crash that happens before this module ever ran. The payload keys form a
// cross-boundary contract with DEFAULT_SHELL_STRINGS over there, pinned by
// tests/desktop_shell_strings.test.ts.

import type { DesktopBridge } from '../runtime';
import type { SupportedLanguage } from '../ui/i18n';
import { ensureLocaleLoaded, getLanguage, isLocaleResident, t } from '../ui/i18n';

export function desktopShellStringsPayload(): Record<string, string> {
  return {
    crashTitle: t('desktop.crash.title'),
    crashBody: t('desktop.crash.body'),
    crashReload: t('desktop.crash.reload'),
    crashQuit: t('desktop.crash.quit'),
    fatalTitle: t('desktop.crash.title'),
    fatalBody: t('desktop.crash.fatalBody'),
  };
}

// The wiring below runs at client-entry evaluation, when English is the only
// resident locale table (src/ui/i18n.ts loads non-en chunks lazily), so the
// first push is English even for a player with a stored non-en locale, and the
// boot chunk load never fires woc:languagechange. Re-push once the boot
// locale's table lands: the load coalesces with startGame's own
// ensureLocaleLoaded via the in-flight map, and a failed chunk load keeps the
// English defaults, matching the language picker's fallback. Injected deps
// keep the decision Node-testable (tests/desktop_shell_strings.test.ts).
export function repushWhenLocaleResident(
  push: () => void,
  lang: SupportedLanguage = getLanguage(),
  deps: {
    isLocaleResident: (lang: SupportedLanguage) => boolean;
    ensureLocaleLoaded: (lang: SupportedLanguage) => Promise<void>;
  } = { isLocaleResident, ensureLocaleLoaded },
): void {
  if (deps.isLocaleResident(lang)) return;
  deps.ensureLocaleLoaded(lang).then(push, () => {});
}

export function initDesktopShellStrings(bridge: DesktopBridge): void {
  if (typeof bridge.setShellStrings !== 'function') return;
  const push = (): void => {
    void bridge.setShellStrings?.(desktopShellStringsPayload());
  };
  push();
  repushWhenLocaleResident(push);
  document.addEventListener('woc:languagechange', push);
}
