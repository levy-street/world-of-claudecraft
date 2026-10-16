// Map-editor entry (loaded by editor.html, served at /editor). Loads the active
// locale before the first localized paint (mirrors src/guide/main.ts), stamps
// the document language/direction and title, then mounts the editor over the
// built-in world content as a starting point.

import { audio } from '../game/audio';
import { music } from '../game/music';
import {
  installWebGLContextRelease,
  markPageDisposable,
  registerPageTeardown,
} from '../render/context_release';
import { disableRenderLayer } from '../render/render_dev_flags';
import { ensureTerrainSplatAssetFetch } from '../render/terrain';
import { CAMPS, GROUND_OBJECTS, NPCS, ROADS, ZONES } from '../sim/data';
import './styles.css';
import { ensureLocaleLoaded, getLanguage, languageTag } from '../ui/i18n';
import { EditorApp } from './app';
import { drainLocalAssetUrls } from './local_assets';
import { STUDIO_DOCUMENT_TITLE } from './studio_brand';

// The editor's 3D viewport holds a full game WebGLRenderer (its GL context is
// tracked via trackWebGLContext). The page is deliberately excluded from the
// bfcache so reload/close always returns renderer, audio, worker and asset-cache
// resources promptly. Playtest saves first and runs in its own disposable tab,
// so no unsaved editor document needs to survive a navigation freeze.
markPageDisposable();
installWebGLContextRelease();
registerPageTeardown(() => {
  music.close();
  audio.close();
  for (const url of drainLocalAssetUrls()) URL.revokeObjectURL(url);
  delete (window as unknown as { __editor?: EditorApp }).__editor;
});

// Painting always renders through the paint-capable splat material, so the
// editor needs the terrain layer textures on EVERY graphics tier (the game
// skips the ~15MB fetch on the low tier; a maker cannot).
ensureTerrainSplatAssetFetch();

// The meadow grass bake is OFF in the Studio.
//
// It is a module singleton baked once per WebGLRenderer, and terrain materials
// capture its texture when they build. The Studio tears the engine down and
// builds a new one on every loadMap, so the singleton and the live GL context
// drift apart: the terrain ends up bound to a bake texture whose renderer is
// gone, which samples WHITE. On any map whose ground is mostly grass-weighted
// (aSplat.x = 1, i.e. every plain authored map) that bake owns the entire
// ground colour, so the whole world rendered untextured in the viewport while
// Playtest, a fresh page with one renderer, looked correct.
// SPACEY, 2026-09-22: "all of my texures are missing ... it works duing playtest
// just not while in the studio itself".
//
// Turning it off here is exactly what `?grassbake=off` does, and it is the
// right default for an editor regardless: the maker needs to see the real
// splat and their own paint, not a baked meadow over the top of it. The game
// keeps the bake. The underlying lifetime bug is worth fixing separately.
disableRenderLayer('grassbake');

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
  document.title = STUDIO_DOCUMENT_TITLE;
  const app = new EditorApp(mount, {
    zones: clone(ZONES),
    camps: clone(CAMPS),
    npcs: clone(NPCS),
    objects: clone(GROUND_OBJECTS),
    roads: clone(ROADS),
  });
  // Dev-only handle for debugging and E2E inspection.
  (window as unknown as { __editor?: EditorApp }).__editor = app;
}

void boot();
