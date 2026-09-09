// The shader warm-up's cache key is the translated GLSL PLUS the context's
// enabled extension set, so the worker and the game context must hold the same
// set for a warmed program to be a hit. The sweep
// (renderer_extensions.ts) makes them equal up front, and both sides compare
// their swept list at init.
//
// What neither side can see is the set growing AFTERWARDS. three enables an
// extension lazily, from `WebGLUtils.convert` on the first upload of a
// compressed texture and from any `extensions.get`/`has` a feature reaches for,
// and every such acquisition goes through the one object the renderer exposes
// as `renderer.extensions`. From the first name enabled outside the swept list
// the two sets differ, every program linked after it is keyed differently from
// what the worker warmed, and the warm-up silently stops paying: no error, no
// visual difference, just the hitches back.
//
// So the sentinel wraps that object and reports the first name enabled outside
// the list. `has` is wrapped too, not only `get`: three's `has` acquires the
// extension exactly like `get` does, so watching `get` alone would miss the
// commonest caller. Host-agnostic and installed once; the caller decides what
// a drift means (today: record it and retire the worker, whose warmed programs
// are now keyed for a set the game no longer has).

import {
  enableRendererExtensions,
  RENDERER_CONTEXT_EXTENSIONS,
  type RendererExtensionSweep,
} from './renderer_extensions';
import { noteShaderWarmExtensionDrift } from './shader_warm_client';

export interface ExtensionDriftHost {
  has(name: string): boolean;
  get(name: string): unknown;
}

export interface ExtensionDriftWatch {
  /** Names asked for outside the swept list, in first-seen order. */
  readonly drifted: readonly string[];
  /** Put the host's own `has` and `get` back. */
  stop(): void;
}

/**
 * Watch `host` for an extension asked for outside `pinned`, calling `onDrift`
 * once per new name with whether the adapter actually HAD it. That second
 * argument is the one that matters: a name the adapter lacks leaves the
 * context's set unchanged and costs nothing, while a name it has just grew
 * the set and re-keyed every program linked from here on. Installing twice on
 * the same host is safe: the second install wraps the first, and each reports
 * only names it has not seen.
 */
export function watchExtensionDrift(
  host: ExtensionDriftHost,
  pinned: readonly string[],
  onDrift?: (name: string, enabled: boolean) => void,
): ExtensionDriftWatch {
  const swept = new Set(pinned);
  const drifted: string[] = [];
  // The host's OWN function values, not bound copies: stop() must put the
  // very same references back, or an outer sentinel would restore a wrapper.
  const ownHas = host.has;
  const ownGet = host.get;
  const note = (name: string, enabled: boolean): void => {
    if (swept.has(name) || drifted.includes(name)) return;
    drifted.push(name);
    onDrift?.(name, enabled);
  };
  host.has = (name: string): boolean => {
    const had = ownHas.call(host, name);
    note(name, had);
    return had;
  };
  host.get = (name: string): unknown => {
    const extension = ownGet.call(host, name);
    note(name, extension !== null && extension !== undefined);
    return extension;
  };
  return {
    drifted,
    stop: () => {
      host.has = ownHas;
      host.get = ownGet;
    },
  };
}

/** What the renderer hands over: three's `WebGLRenderer`, of which this needs
 *  the raw context (to sweep) and the extension object (to watch). */
export interface DriftWatchedRenderer {
  getContext(): { getExtension(name: string): unknown };
  extensions: ExtensionDriftHost;
}

/**
 * The renderer's ONE call: enable the pinned extension set on this context,
 * then watch that set for the drift that would silently un-key the shader warm
 * worker. Kept together on purpose, and kept OUT of the renderer, which is a
 * ratcheted coordinator: the sweep and its watch are one decision, and a
 * caller that swept without watching would be back to the silent failure.
 * Only a name the adapter actually has grew the set, so only that retires the
 * worker; a name it lacks is reported by the watch and costs nothing.
 */
export function enableAndWatchRendererExtensions(
  webgl: DriftWatchedRenderer,
): RendererExtensionSweep {
  const sweep = enableRendererExtensions(webgl.getContext());
  watchExtensionDrift(webgl.extensions, RENDERER_CONTEXT_EXTENSIONS, (name, enabled) => {
    if (enabled) noteShaderWarmExtensionDrift(name);
  });
  return sweep;
}
