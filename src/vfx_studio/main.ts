import { ensureLocaleLoaded, getLanguage, t } from '../ui/i18n';
import { VfxStudioApp } from './app';
import './studio.css';

await ensureLocaleLoaded(getLanguage());
document.title = t('editor.vfx.title');
document.documentElement.lang = getLanguage().replace('_', '-');
document.documentElement.dir = /^(ar|he|fa|ur)\b/.test(document.documentElement.lang)
  ? 'rtl'
  : 'ltr';
const root = document.getElementById('vfx-studio');
if (!root) throw new Error('VFX studio root is missing');
const app = new VfxStudioApp(root);
if (import.meta.env.DEV) Object.assign(window, { __vfxStudio: app });
window.addEventListener('pagehide', (event) => {
  if (!event.persisted) void app.dispose();
});
