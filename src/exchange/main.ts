import './styles.css';
import { ensureLocaleLoaded, getLanguage } from '../ui/i18n';
import { ExchangeApp } from './app';

async function boot(): Promise<void> {
  try {
    await ensureLocaleLoaded(getLanguage());
  } catch {
    // English remains the synchronous fallback.
  }
  document.documentElement.lang = getLanguage().replace('_', '-');
  const mount = document.getElementById('exchange-app');
  if (mount) await new ExchangeApp(mount).start();
}

void boot();
