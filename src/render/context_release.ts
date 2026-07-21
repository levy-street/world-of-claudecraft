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
}

const holders = new Set<WebGLContextHolder>();

/**
 * Track a renderer so its GL context is released on page teardown. Returns an
 * unregister function; call it if the renderer is disposed earlier so it is not
 * touched twice.
 */
export function trackWebGLContext(holder: WebGLContextHolder): () => void {
  holders.add(holder);
  return () => { holders.delete(holder); };
}

/**
 * Force-lose and dispose every tracked context, then forget them. Safe to call
 * more than once; per-holder failures are swallowed so one already-lost context
 * cannot block the rest.
 */
export function releaseTrackedWebGLContexts(): void {
  for (const holder of holders) {
    try { holder.forceContextLoss(); } catch { /* context may already be lost */ }
    try { holder.dispose(); } catch { /* best-effort teardown */ }
  }
  holders.clear();
}

/**
 * Wire context release to the page-teardown event. `pagehide` fires on reload,
 * navigation, and tab close, and unlike `unload` it does not disqualify the page
 * from the bfcache. Call once at startup.
 *
 * Release only on a real teardown (`persisted === false`). When the page is
 * frozen into the bfcache (`persisted === true`) the contexts must survive:
 * `dispose()` is terminal and nothing rebuilds them, so a bfcache restore
 * (`pageshow` with `persisted`) has to come back to live canvases, not dead ones.
 */
export function installWebGLContextRelease(
  target: Pick<EventTarget, 'addEventListener'> = window,
): void {
  target.addEventListener('pagehide', (e) => {
    if (!(e as PageTransitionEvent).persisted) releaseTrackedWebGLContexts();
  });
}
