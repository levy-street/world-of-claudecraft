// Map-editor entry (loaded by editor.html, served at /editor). Loads the active
// locale before the first localized paint (mirrors src/guide/main.ts), stamps
// the document language/direction and title, then mounts the editor over the
// built-in world content as a starting point.

import { CAMPS, GROUND_OBJECTS, NPCS, ROADS, ZONES } from '../sim/data';
import './styles.css';
import { studioBoot } from '#studio';
import { ensureLocaleLoaded, getLanguage, languageTag, t } from '../ui/i18n';
import { EditorApp } from './app';

// Deep clone so editing never mutates the imported module globals (BUILTIN_WORLD
// shares those arrays); the editor works on its own document.
function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

function isRtl(tag: string): boolean {
  return /^(ar|he|fa|ur)\b/.test(tag);
}

async function boot(): Promise<void> {
  const mount = document.getElementById('editor-app');
  if (!mount) return;
  try {
    await ensureLocaleLoaded(getLanguage());
  } catch {
    // A missing locale chunk falls back to English; render regardless.
  }
  const tag = languageTag(getLanguage());
  document.documentElement.lang = tag;
  document.documentElement.dir = isRtl(tag) ? 'rtl' : 'ltr';
  document.title = t('editor.docTitle');
  const world = {
    zones: clone(ZONES),
    camps: clone(CAMPS),
    npcs: clone(NPCS),
    objects: clone(GROUND_OBJECTS),
    roads: clone(ROADS),
  };
  // ClaudeCraft Studio takes the entry over when its private clone is mounted
  // (src/editor/studio_contract.ts); the public editor is the fallback.
  if (studioBoot) {
    await studioBoot({ mount, world });
    return;
  }
  const app = new EditorApp(mount, world);
  // Dev-only handle for debugging and E2E inspection.
  (window as unknown as { __editor?: EditorApp }).__editor = app;
}

void boot();
