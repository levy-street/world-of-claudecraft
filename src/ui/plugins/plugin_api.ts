// The frozen `woc` API surface handed to each running plugin (API v1). This is
// the ONLY sanctioned bridge between community code and the client: events
// (plugin_events_core vocabulary), a read-only player snapshot, contained UI
// panels + toasts + a small sound-cue allowlist, namespaced size-capped
// storage, and locale-aware formatters. It is deliberately read-and-render
// only: there is no member that sends a game command, touches IWorld actions,
// or reaches the network. NOT a security boundary (reviewed code runs with
// page privileges; the human review gate is the boundary, see
// docs/prd/plugins-store.md); it exists so honest plugins compose cleanly and
// dishonest ones are easy to spot in review.

import { esc } from '../esc';
import { formatDuration, formatMoney, formatNumber } from '../i18n';
import type { PluginEventType, PluginPlayerSnapshot } from './plugin_events_core';

export type PluginSoundCue = 'click' | 'coin' | 'chime' | 'level' | 'quest' | 'alert';

const SOUND_CUES: readonly PluginSoundCue[] = ['click', 'coin', 'chime', 'level', 'quest', 'alert'];

const EVENT_TYPES: readonly PluginEventType[] = [
  'combat',
  'chat',
  'loot',
  'xp',
  'levelup',
  'quest',
  'death',
  'respawn',
  'deed',
  'tick',
  'enable',
  'disable',
];

// Containment caps: bound what one plugin can hold or write.
const MAX_HANDLERS_PER_EVENT = 16;
const MAX_PANELS = 4;
const MAX_TOAST_LENGTH = 200;
const STORAGE_KEY_CAP_BYTES = 8 * 1024;
const STORAGE_TOTAL_CAP_BYTES = 64 * 1024;
const MAX_STORAGE_KEY_LENGTH = 64;

/** What the API needs from its host composition (wired by Hud). */
export interface PluginApiDeps {
  /** The #plugin-panels overlay layer (null when the HUD is not in-world). */
  panelLayer(): HTMLElement | null;
  toast(text: string): void;
  sound(cue: PluginSoundCue): void;
  playerSnapshot(): PluginPlayerSnapshot | null;
}

export interface PluginPanelHandle {
  /** The plugin-owned content container. */
  readonly body: HTMLElement;
  setTitle(title: string): void;
  show(): void;
  hide(): void;
  remove(): void;
}

type PluginHandler = (data: Record<string, unknown>) => void;

/** Per-instance mutable state the host owns; the API closes over it. */
export class PluginInstanceState {
  readonly handlers = new Map<PluginEventType, Set<PluginHandler>>();
  readonly panels = new Map<string, { root: HTMLElement; handle: PluginPanelHandle }>();
  errorCount = 0;
  disposed = false;

  constructor(
    readonly slug: string,
    readonly name: string,
    readonly version: number,
  ) {}

  /** Tear down every panel and handler (uninstall, disable, or auto-disable). */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const { root } of this.panels.values()) root.remove();
    this.panels.clear();
    this.handlers.clear();
  }
}

function storagePrefix(slug: string): string {
  return `wocplugin.${slug}.k.`;
}

function panelPosKey(slug: string, panelId: string): string {
  return `wocplugin.${slug}.pos.${panelId}`;
}

function safeLocalStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** Total stored bytes under this plugin's namespace (JSON value lengths). */
function storageUsage(store: Storage, slug: string): number {
  const prefix = storagePrefix(slug);
  let total = 0;
  for (let i = 0; i < store.length; i++) {
    const key = store.key(i);
    if (key?.startsWith(prefix)) total += (store.getItem(key) ?? '').length;
  }
  return total;
}

/** Clamp-restore a persisted panel position; null when none is stored. */
function readPanelPos(slug: string, panelId: string): { left: number; top: number } | null {
  const store = safeLocalStorage();
  if (!store) return null;
  try {
    const raw = store.getItem(panelPosKey(slug, panelId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { left?: unknown; top?: unknown };
    if (typeof parsed.left !== 'number' || typeof parsed.top !== 'number') return null;
    return { left: parsed.left, top: parsed.top };
  } catch {
    return null;
  }
}

function clampPanel(root: HTMLElement): void {
  const rect = root.getBoundingClientRect();
  const maxLeft = Math.max(0, window.innerWidth - Math.min(rect.width, 120));
  const maxTop = Math.max(0, window.innerHeight - 24);
  const left = Math.min(Math.max(0, rect.left), maxLeft);
  const top = Math.min(Math.max(0, rect.top), maxTop);
  root.style.left = `${left}px`;
  root.style.top = `${top}px`;
}

/** Build one contained, draggable overlay panel for a plugin. */
function createPanel(
  state: PluginInstanceState,
  layer: HTMLElement,
  panelId: string,
  title: string,
): PluginPanelHandle {
  const root = document.createElement('div');
  root.className = 'plugin-panel';
  root.dataset.plugin = state.slug;
  const header = document.createElement('div');
  header.className = 'plugin-panel-header';
  const titleEl = document.createElement('span');
  titleEl.className = 'plugin-panel-title';
  titleEl.textContent = title;
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'plugin-panel-hide';
  closeBtn.textContent = 'x';
  header.append(titleEl, closeBtn);
  const body = document.createElement('div');
  body.className = 'plugin-panel-body';
  root.append(header, body);
  const stored = readPanelPos(state.slug, panelId);
  if (stored) {
    root.style.left = `${stored.left}px`;
    root.style.top = `${stored.top}px`;
  }
  layer.appendChild(root);
  if (stored) clampPanel(root);

  // Header drag: compositor-cheap absolute positioning inside the fixed layer;
  // position persists per (plugin, panel) so a meter stays where it was put.
  let dragFrom: { px: number; py: number; left: number; top: number } | null = null;
  header.addEventListener('pointerdown', (ev) => {
    if (ev.target === closeBtn) return;
    const rect = root.getBoundingClientRect();
    dragFrom = { px: ev.clientX, py: ev.clientY, left: rect.left, top: rect.top };
    header.setPointerCapture(ev.pointerId);
    ev.preventDefault();
  });
  header.addEventListener('pointermove', (ev) => {
    if (!dragFrom) return;
    root.style.left = `${dragFrom.left + ev.clientX - dragFrom.px}px`;
    root.style.top = `${dragFrom.top + ev.clientY - dragFrom.py}px`;
  });
  header.addEventListener('pointerup', () => {
    if (!dragFrom) return;
    dragFrom = null;
    clampPanel(root);
    const store = safeLocalStorage();
    if (store) {
      try {
        const rect = root.getBoundingClientRect();
        store.setItem(
          panelPosKey(state.slug, panelId),
          JSON.stringify({ left: rect.left, top: rect.top }),
        );
      } catch {
        // Quota or privacy mode: the panel just does not remember its spot.
      }
    }
  });
  closeBtn.addEventListener('click', () => {
    root.style.display = 'none';
  });

  const handle: PluginPanelHandle = {
    body,
    setTitle(next: string): void {
      titleEl.textContent = String(next);
    },
    show(): void {
      root.style.display = '';
    },
    hide(): void {
      root.style.display = 'none';
    },
    remove(): void {
      root.remove();
      state.panels.delete(panelId);
    },
  };
  state.panels.set(panelId, { root, handle });
  return handle;
}

/** Build the frozen `woc` object for one plugin instance. */
export function buildPluginApi(state: PluginInstanceState, deps: PluginApiDeps): object {
  const storage = Object.freeze({
    get(key: string): unknown {
      const store = safeLocalStorage();
      if (!store || typeof key !== 'string') return null;
      try {
        const raw = store.getItem(storagePrefix(state.slug) + key.slice(0, MAX_STORAGE_KEY_LENGTH));
        return raw === null ? null : (JSON.parse(raw) as unknown);
      } catch {
        return null;
      }
    },
    set(key: string, value: unknown): boolean {
      const store = safeLocalStorage();
      if (!store || typeof key !== 'string') return false;
      const fullKey = storagePrefix(state.slug) + key.slice(0, MAX_STORAGE_KEY_LENGTH);
      let json: string;
      try {
        json = JSON.stringify(value);
      } catch {
        return false;
      }
      if (typeof json !== 'string' || json.length > STORAGE_KEY_CAP_BYTES) return false;
      try {
        const existing = (store.getItem(fullKey) ?? '').length;
        if (storageUsage(store, state.slug) - existing + json.length > STORAGE_TOTAL_CAP_BYTES) {
          return false;
        }
        store.setItem(fullKey, json);
        return true;
      } catch {
        return false;
      }
    },
    remove(key: string): void {
      const store = safeLocalStorage();
      if (!store || typeof key !== 'string') return;
      try {
        store.removeItem(storagePrefix(state.slug) + key.slice(0, MAX_STORAGE_KEY_LENGTH));
      } catch {
        // Ignore storage failures on remove.
      }
    },
  });

  const ui = Object.freeze({
    panel(opts?: { id?: string; title?: string }): PluginPanelHandle {
      if (state.disposed) throw new Error('plugin is disabled');
      const layer = deps.panelLayer();
      if (!layer) throw new Error('panels are unavailable outside the world');
      const panelId = String(opts?.id ?? `panel${state.panels.size + 1}`).slice(0, 32);
      const existing = state.panels.get(panelId);
      if (existing) return existing.handle;
      if (state.panels.size >= MAX_PANELS) throw new Error('panel limit reached');
      return createPanel(state, layer, panelId, String(opts?.title ?? state.name));
    },
    toast(text: string): void {
      if (state.disposed) return;
      deps.toast(String(text).slice(0, MAX_TOAST_LENGTH));
    },
    sound(cue: PluginSoundCue): void {
      if (state.disposed) return;
      if (SOUND_CUES.includes(cue)) deps.sound(cue);
    },
  });

  return Object.freeze({
    apiVersion: 1,
    meta: Object.freeze({ slug: state.slug, name: state.name, version: state.version }),
    on(type: PluginEventType, handler: PluginHandler): void {
      if (state.disposed) return;
      if (!EVENT_TYPES.includes(type) || typeof handler !== 'function') return;
      let set = state.handlers.get(type);
      if (!set) {
        set = new Set();
        state.handlers.set(type, set);
      }
      if (set.size < MAX_HANDLERS_PER_EVENT) set.add(handler);
    },
    off(type: PluginEventType, handler: PluginHandler): void {
      state.handlers.get(type)?.delete(handler);
    },
    player(): PluginPlayerSnapshot | null {
      return deps.playerSnapshot();
    },
    ui,
    storage,
    util: Object.freeze({
      /** The canonical HTML escaper: any player or server text a plugin
       * interpolates into its panel HTML goes through this. */
      esc(value: unknown): string {
        return esc(value);
      },
      formatNumber(value: number): string {
        return formatNumber(Number(value) || 0);
      },
      formatMoney(copper: number): string {
        return formatMoney(Math.max(0, Math.floor(Number(copper) || 0)));
      },
      formatDuration(seconds: number): string {
        return formatDuration(Math.max(0, Math.floor(Number(seconds) || 0)));
      },
    }),
  });
}
