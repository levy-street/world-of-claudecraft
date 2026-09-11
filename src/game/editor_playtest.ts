// Game-side reader for an editor play-test handoff. The map editor (its own
// entry at /editor) serializes a custom world into a one-shot localStorage
// transfer and opens the game in a disposable tab; this reads it back so the
// OFFLINE boot can run that world. A same-tab sessionStorage path remains as a
// fallback for browsers that block shared storage.
// Playtest never touches the server or the authoritative world: it only shapes
// the local offline Sim, so it ships enabled (same-origin browser storage is the
// player's own data, and offline progress remains local anyway).
//
// Deliberately never imports src/editor, so editor implementation code does not
// enter the shipped game bundle. The shared render teardown helper is the one
// exception to the sim/i18n-only data path: it releases the playtest renderer
// before returning. Defensive: malformed blobs still yield null and the normal
// start screen runs instead.

import { decodeBiomePaintIdsRle } from '../sim/map_doc';
import type { PlayerClass, WorldContent } from '../sim/types';
import { t } from '../ui/i18n';
import {
  registerPageTeardown,
  retirePageAndClose,
  retirePageAndReplace,
} from '../render/context_release';
import { WORLD_SEED } from '../sim/world_seed';

export const EDITOR_PLAYTEST_KEY = 'woc_editor_playtest';
const PLAYTEST_TRANSFER_PREFIX = 'woc_editor_playtest_transfer:';
const PLAYTEST_TRANSFER_PARAM = 'editorPlaytest';

// Fresh object URLs minted for locally imported models belong to this playtest
// document. Revoke them on return so their backing Blobs can be reclaimed even
// before the browser destroys the old realm.
const localPlaytestObjectUrls = new Set<string>();
registerPageTeardown(() => {
  for (const url of localPlaytestObjectUrls) URL.revokeObjectURL(url);
  localPlaytestObjectUrls.clear();
});

export interface EditorPlaytestRequest {
  content: WorldContent;
  seed: number;
  playerClass: PlayerClass;
  playerName: string;
}

const VALID_CLASSES: ReadonlySet<string> = new Set([
  'warrior',
  'paladin',
  'hunter',
  'rogue',
  'priest',
  'mage',
  'warlock',
  'druid',
  'shaman',
]);

// Shape-check the content enough that the Sim ctor and terrain function won't trip
// on it. Full validation lives in the editor; this is the safety net at the door.
function looksLikeWorldContent(c: unknown): c is WorldContent {
  if (!c || typeof c !== 'object') return false;
  const w = c as Record<string, unknown>;
  const zones = w.zones;
  if (!Array.isArray(zones) || zones.length === 0) return false;
  for (const z of zones) {
    const zone = z as Record<string, unknown>;
    if (typeof zone.zMin !== 'number' || typeof zone.zMax !== 'number') return false;
    if (!zone.hub || typeof (zone.hub as Record<string, unknown>).x !== 'number') return false;
    if (!Array.isArray(zone.lakes) || !Array.isArray(zone.pois)) return false;
  }
  return (
    Array.isArray(w.camps) &&
    Array.isArray(w.groundObjects) &&
    Array.isArray(w.roads) &&
    !!w.props &&
    !!w.playerStart &&
    typeof (w.playerStart as Record<string, unknown>).x === 'number'
  );
}

// Read AND consume a pending play-test request (removed so a later refresh shows
// the normal menu). Returns null with no request or on bad data.
export function takeEditorPlaytestRequest(): EditorPlaytestRequest | null {
  let raw: string | null = null;
  const transferToken = new URLSearchParams(location.search).get(PLAYTEST_TRANSFER_PARAM);
  try {
    if (transferToken && /^[a-zA-Z0-9-]{8,80}$/.test(transferToken)) {
      const key = `${PLAYTEST_TRANSFER_PREFIX}${transferToken}`;
      raw = localStorage.getItem(key);
      localStorage.removeItem(key);
    }
    if (!raw) {
      raw = sessionStorage.getItem(EDITOR_PLAYTEST_KEY);
      if (raw) sessionStorage.removeItem(EDITOR_PLAYTEST_KEY);
    }
  } catch {
    return null; // storage blocked
  }
  if (!raw) return null;
  try {
    const obj = JSON.parse(raw) as Record<string, unknown>;
    if (!obj || typeof obj !== 'object') return null;
    // The editor ships large biome-paint grids run-length encoded (several MB
    // as a plain array ? past the sessionStorage quota). Expand before the
    // shape check; a malformed blob just drops the paint layer.
    const content = obj.content as Record<string, unknown> | null;
    const bp =
      content && typeof content === 'object'
        ? (content.biomePaint as Record<string, unknown> | undefined)
        : undefined;
    if (bp && typeof bp === 'object' && typeof bp.idsRle === 'string' && !Array.isArray(bp.ids)) {
      const ids = decodeBiomePaintIdsRle(bp.idsRle);
      if (ids) {
        bp.ids = ids;
        delete bp.idsRle;
      } else if (content) {
        delete content.biomePaint;
      }
    }
    if (!looksLikeWorldContent(obj.content)) return null;
    const seed = typeof obj.seed === 'number' && Number.isFinite(obj.seed) ? obj.seed : WORLD_SEED;
    const pc =
      typeof obj.playerClass === 'string' && VALID_CLASSES.has(obj.playerClass)
        ? (obj.playerClass as PlayerClass)
        : 'warrior';
    const name =
      typeof obj.playerName === 'string' && obj.playerName.trim()
        ? obj.playerName.slice(0, 24)
        : 'Mapmaker';
    return { content: obj.content as WorldContent, seed, playerClass: pc, playerName: name };
  } catch {
    return null;
  }
}

// ---- imported (local) model resolution --------------------------------------
//
// The editor persists imported .glb/.gltf bytes in IndexedDB keyed by content
// sha256 (editor/local_assets_db.ts). A playtest placement referencing one
// arrives with the LOGICAL id 'local/<sha256>' as its path: the editor's
// object URLs are document-scoped and die on the navigation here, so this side
// re-reads the bytes by database name (a deliberate string-level contract, not
// a code import, keeping editor code out of the game bundle) and mints fresh
// object URLs in THIS document. A model missing from storage drops its
// placements instead of leaving invisible colliders in the world.

const LOCAL_DB_NAME = 'woc_editor_local_assets';
const LOCAL_DB_STORE = 'models';
const LOCAL_PATH_PREFIX = 'local/';

function openLocalAssetDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(LOCAL_DB_NAME);
      req.onupgradeneeded = () => {
        // First open on this browser: the store does not exist (nothing was
        // ever imported), so there is nothing to read.
        if (!req.result.objectStoreNames.contains(LOCAL_DB_STORE)) {
          req.result.createObjectStore(LOCAL_DB_STORE, { keyPath: 'sha256' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function loadLocalModelBlobs(shas: ReadonlySet<string>): Promise<Map<string, Blob>> {
  const out = new Map<string, Blob>();
  if (shas.size === 0) return out;
  const db = await openLocalAssetDb();
  if (!db) return out;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(LOCAL_DB_STORE, 'readonly');
      const store = tx.objectStore(LOCAL_DB_STORE);
      let pending = shas.size;
      for (const sha of shas) {
        const req = store.get(sha);
        req.onsuccess = () => {
          const row = req.result as { bytes?: ArrayBuffer; mime?: string } | undefined;
          if (row?.bytes) {
            out.set(sha, new Blob([row.bytes], { type: row.mime || 'model/gltf-binary' }));
          }
          if (--pending === 0) resolve();
        };
        req.onerror = () => {
          if (--pending === 0) resolve();
        };
      }
    } catch {
      resolve();
    }
  });
  db.close();
  return out;
}

/**
 * Rewrite 'local/<sha256>' placement paths to fresh object URLs backed by the
 * editor's IndexedDB model store. Await this BEFORE the world boots so the
 * renderer's constructor sees loadable paths. Never throws: with blocked
 * storage every local placement is dropped (and logged) rather than wedging
 * the playtest boot.
 */
export async function resolveLocalPlaytestAssets(content: WorldContent): Promise<void> {
  const placements = content.placements;
  if (!placements || placements.length === 0) return;
  const wanted = new Set<string>();
  for (const p of placements) {
    if (p.path.startsWith(LOCAL_PATH_PREFIX)) wanted.add(p.path.slice(LOCAL_PATH_PREFIX.length));
  }
  if (wanted.size === 0) return;
  const blobs = await loadLocalModelBlobs(wanted);
  const urlBySha = new Map<string, string>();
  const kept: typeof placements = [];
  let dropped = 0;
  for (const p of placements) {
    if (!p.path.startsWith(LOCAL_PATH_PREFIX)) {
      kept.push(p);
      continue;
    }
    const sha = p.path.slice(LOCAL_PATH_PREFIX.length);
    let url = urlBySha.get(sha);
    if (!url) {
      const blob = blobs.get(sha);
      if (blob) {
        url = URL.createObjectURL(blob);
        localPlaytestObjectUrls.add(url);
        urlBySha.set(sha, url);
      }
    }
    if (url) {
      p.path = url;
      kept.push(p);
    } else {
      dropped++;
    }
  }
  if (dropped > 0) {
    console.warn(`playtest: ${dropped} placement(s) reference imported models not in this browser`);
    content.placements = kept;
  }
}

/**
 * Pin a "Back to Editor" button to the top-right corner of the playtest UI
 * (left of the minimap), so the map maker can hop back without losing anything:
 * the editor fully saved the map before launching and reopens it on return.
 * Inline-styled and mounted on <body>, so it needs no HUD CSS and survives the
 * game's own screens coming and going.
 */
export function mountPlaytestReturnButton(): void {
  const btn = document.createElement('button');
  btn.id = 'playtest-return';
  btn.type = 'button';
  btn.textContent = t('editor.playtestBack');
  btn.title = t('editor.playtestBackTitle');
  btn.style.cssText =
    'position:fixed;top:10px;right:196px;z-index:1000;padding:6px 12px;' +
    'background:rgba(18,14,10,0.85);color:var(--gold, #ffd100);' +
    'border:1px solid var(--border, #6b5a36);border-radius:6px;' +
    'font-family:inherit;font-size:13px;cursor:pointer;';
  btn.onclick = () => {
    if (new URLSearchParams(location.search).has(PLAYTEST_TRANSFER_PARAM)) {
      retirePageAndClose();
    } else {
      retirePageAndReplace('/editor.html');
    }
  };
  document.body.appendChild(btn);
}
