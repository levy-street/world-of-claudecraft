// Guide client entry (the /guide Vite entry, loaded by guide.html). Loads the active
// locale, then mounts the SPA. Only `en` is resident synchronously; a stored non-en
// locale lazy-loads here before the first localized paint (mirrors src/main.ts).

import './styles.css';
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

void boot();
