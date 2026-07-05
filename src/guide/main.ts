// Guide client entry (the /guide Vite entry, loaded by guide.html). Loads the active
// locale, then mounts the SPA. Only `en` is resident synchronously; a stored non-en
// locale lazy-loads here before the first localized paint (mirrors src/main.ts).

import './styles.css';
import { installWebGLContextRelease } from '../render/context_release';
import { startSitePresence } from '../site_presence';
import { ensureLocaleLoaded, getLanguage } from '../ui/i18n';
import { GuideApp } from './app';

async function boot(): Promise<void> {
  const mount = document.getElementById('guide-app');
  if (!mount) return;
  try {
    await ensureLocaleLoaded(getLanguage());
  } catch {
    // A missing locale chunk falls back to English; render regardless.
  }
  new GuideApp(mount).start();
}

startSitePresence('guide');
// Free any live model-viewer WebGL contexts on a real page teardown (reload, navigation),
// so repeated visits cannot exhaust the browser's per-process context pool.
installWebGLContextRelease();
void boot();
