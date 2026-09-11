// Promptly release WebGL contexts when the page is torn down (reload, navigation,
// tab close). Browsers cap the number of live WebGL contexts per GPU process
// (~16) and reclaim lost ones lazily, so a player who reloads repeatedly - which
// the client does on every logout / "Return to Login" via location.reload - can
// exhaust the pool and make the next `new THREE.WebGLRenderer` throw
// "Error creating WebGL context". Forcing context loss on `pagehide` hands every
// context back at once instead of waiting for garbage collection.

/** The slice of THREE.WebGLRenderer we need to free a GPU context. */
export interface WebGLContextHolder {
  forceContextLoss(): void;
  dispose(): void;
  getContext?(): WebGLRenderingContext | WebGL2RenderingContext;
}

const holders = new Set<WebGLContextHolder>();
const normalizedInfoLogContexts = new WeakSet<object>();
const teardowns = new Set<() => void>();
const disposablePages = new WeakSet<object>();
const disposablePagesInstalled = new WeakSet<object>();

/**
 * Mark a renderer-heavy document as disposable. Editor/playtest pages must not
 * survive in the back-forward cache: even after JS objects become unreachable,
 * Chromium's renderer allocator can retain their decoded model/texture pages
 * (often swapped out) in the same process across repeated round trips.
 *
 * The unload listener keeps these pages out of the bfcache on browsers that use
 * it as an eligibility signal. The persisted-pagehide branch in
 * installWebGLContextRelease is the safety net for browsers that still cache
 * the page; a persisted restore is reloaded because its WebGL resources were
 * deliberately retired while it was frozen.
 */
export function markPageDisposable(
  target: Pick<EventTarget, 'addEventListener'> = window,
  locationTarget: Pick<Location, 'reload'> = window.location,
): void {
  const key = target as object;
  disposablePages.add(key);
  if (disposablePagesInstalled.has(key)) return;
  disposablePagesInstalled.add(key);
  target.addEventListener('unload', () => {
    // Presence of the handler is intentional: it disqualifies renderer-heavy
    // editor/playtest documents from the back-forward cache where supported.
  });
  target.addEventListener('pageshow', (e) => {
    if ((e as PageTransitionEvent).persisted) locationTarget.reload();
  });
}

/**
 * Register an arbitrary teardown to run alongside the WebGL context release on
 * real page teardown (see installWebGLContextRelease). The editor<->playtest
 * navigation ping-pong is a full document teardown each hop; browsers reclaim
 * AudioContexts (like GL contexts) lazily and cap them, so the audio engines
 * register their close() here to hand the audio threads/buffers back at once
 * instead of piling up across hops. Returns an unregister function.
 */
export function registerPageTeardown(fn: () => void): () => void {
  teardowns.add(fn);
  return () => {
    teardowns.delete(fn);
  };
}

/** Run every registered teardown once; per-callback failures are swallowed. */
export function runPageTeardowns(): void {
  // LIFO mirrors construction order: renderers and views register after the
  // shared asset modules they consume, so they retire before those caches are
  // emptied. This also matches ordinary nested resource ownership.
  const pending = [...teardowns].reverse();
  teardowns.clear();
  for (const fn of pending) {
    try {
      fn();
    } catch {
      /* best-effort teardown */
    }
  }
}

/**
 * Fully retire the current document and replace its history entry. Editor and
 * playtest pages are extremely large; assigning location leaves each previous
 * document eligible for the back-forward cache, retaining its map, decoded
 * models, canvases, workers, and JS heap. Replacement prevents the round-trip
 * workflow from stacking retired documents while preserving its explicit Back
 * to Editor button.
 */
export function retirePageAndReplace(
  url: string,
  target: Pick<Location, 'replace'> = window.location,
): void {
  releaseTrackedWebGLContexts();
  runPageTeardowns();
  target.replace(url);
}

/** Retire a short-lived renderer-heavy tab before closing it. */
export function retirePageAndClose(target: Pick<Window, 'close'> = window): void {
  releaseTrackedWebGLContexts();
  runPageTeardowns();
  target.close();
}

/**
 * Three r165 calls `.trim()` directly on WebGL info logs, although the WebGL
 * contract allows browsers to return null. Chrome 150 does that on some Linux
 * shader/link paths, which used to throw during the first render and leave the
 * loading screen up forever. Three r179+ coalesces these values to an empty
 * string; mirror that narrow upstream fix while this project remains pinned to
 * r165 for shader-chunk compatibility.
 */
function normalizeNullableInfoLogs(context: WebGLRenderingContext | WebGL2RenderingContext): void {
  if (normalizedInfoLogContexts.has(context)) return;
  const getProgramInfoLog = context.getProgramInfoLog.bind(context);
  const getShaderInfoLog = context.getShaderInfoLog.bind(context);
  try {
    Object.defineProperties(context, {
      getProgramInfoLog: {
        configurable: true,
        value: (program: WebGLProgram) => getProgramInfoLog(program) ?? '',
        writable: true,
      },
      getShaderInfoLog: {
        configurable: true,
        value: (shader: WebGLShader) => getShaderInfoLog(shader) ?? '',
        writable: true,
      },
    });
    normalizedInfoLogContexts.add(context);
  } catch {
    // Some embedded WebViews may expose non-configurable host methods. Leaving
    // them untouched is safer than making renderer construction itself fail.
  }
}

/**
 * Track a renderer so its GL context is released on page teardown. Returns an
 * unregister function; call it if the renderer is disposed earlier so it is not
 * touched twice.
 */
export function trackWebGLContext(holder: WebGLContextHolder): () => void {
  try {
    const context = holder.getContext?.();
    if (context) normalizeNullableInfoLogs(context);
  } catch {
    // Context release tracking must remain available even if an unusual host
    // rejects context introspection.
  }
  holders.add(holder);
  return () => {
    holders.delete(holder);
  };
}

/**
 * Force-lose and dispose every tracked context, then forget them. Safe to call
 * more than once; per-holder failures are swallowed so one already-lost context
 * cannot block the rest.
 */
export function releaseTrackedWebGLContexts(): void {
  for (const holder of holders) {
    try {
      holder.forceContextLoss();
    } catch {
      /* context may already be lost */
    }
    try {
      holder.dispose();
    } catch {
      /* best-effort teardown */
    }
  }
  holders.clear();
}

/**
 * Wire context release to the page-teardown event. `pagehide` fires on reload,
 * navigation, and tab close. Call once at startup.
 *
 * Ordinary pages retain their contexts when frozen into the bfcache. Pages
 * marked by markPageDisposable release even on a persisted pagehide and reload
 * if the browser nevertheless restores them.
 */
export function installWebGLContextRelease(
  target: Pick<EventTarget, 'addEventListener'> = window,
): void {
  target.addEventListener('pagehide', (e) => {
    const persisted = (e as PageTransitionEvent).persisted;
    if (!persisted || disposablePages.has(target as object)) {
      releaseTrackedWebGLContexts();
      runPageTeardowns();
    }
  });
}
