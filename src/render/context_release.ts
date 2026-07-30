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
