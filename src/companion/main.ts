// Companion SPA entry: Home (auth, daily spin, Claudium, multi-realm roster, deeds, history).

import { ensureLocaleLoaded, getLanguage, t } from '../ui/i18n';
import type { TranslationKey } from '../ui/i18n.catalog';
import { CompanionApp } from './app';
import './companion.css';

function companionT(key: string, vars?: Record<string, string | number>): string {
  return t(key as TranslationKey, vars);
}

const root = document.getElementById('root');
if (!root) throw new Error('companion root missing');

void (async () => {
  await ensureLocaleLoaded(getLanguage());
  const app = new CompanionApp({ root, t: companionT, playUrl: '/play' });
  await app.start();
})();
