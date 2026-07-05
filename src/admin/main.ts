import { mount } from 'svelte';
import App from './App.svelte';
import { adminLanguage, ensureAdminLocaleLoaded, t } from './i18n';
import { startSitePresence } from './site_presence';
import './admin.css';

startSitePresence();

// Admin SPA entry. Loads the active locale (admin keeps every locale static, so this
// resolves instantly; the await mirrors the game client's bootstrap shape), sets the
// localized document title, then mounts the Svelte app into #app. All UI, auth, and
// data flow live in components; this file only bootstraps.
async function boot(): Promise<void> {
  await ensureAdminLocaleLoaded(adminLanguage());
  document.title = t('app.title');
  const target = document.getElementById('app');
  if (!target) throw new Error('missing #app mount target');
  mount(App, { target });
}

void boot();
