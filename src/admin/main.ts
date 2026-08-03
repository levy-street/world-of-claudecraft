import { mount } from 'svelte';
import App from './App.svelte';
import { adminLanguage, ensureAdminLocaleLoaded, t } from './i18n';
import { startSitePresence } from './site_presence';
// Side-effect import: constructs the theme singleton (state/theme.svelte.ts) so the
// stored dark/light preference is applied and kept in sync from the first tick,
// even before AdminShell (where the toggle itself lives) ever mounts. admin.html's
// inline <head> script already avoids the first-paint flash; this is what keeps the
// DOM attribute authoritative once the app is running.
import './state/theme.svelte';
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
