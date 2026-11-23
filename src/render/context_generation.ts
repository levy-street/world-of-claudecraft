// The WebGL context generation of each world renderer: bumped on every
// `webglcontextlost` and every `webglcontextrestored` the renderer's own
// listeners see (context_restore.ts), so an async GPU operation can tell
// whether the context it was submitted on is still the one it resolved on.
//
// The operation this exists for is three's compileAsync. On a restore three
// replaces its whole per-material bookkeeping (WebGLProperties) and program
// cache, but a compileAsync submitted before the loss still resolves: during
// the lost window KHR_parallel_shader_compile answers "complete" for every
// program, and after the restore its poll finds no current program in the new
// properties and resolves with nothing linked. Every gate and prewarm unit
// awaiting it then records a proof for programs the restored context has
// never seen. `linkAcrossContextLoss` re-submits such a link once the context
// is live again, so the promise a caller awaits always means "linked on the
// context that is live now".
//
// Keyed by the renderer object (three's WebGLRenderer), never global: the
// paperdoll and portrait previews own their own contexts and lose them on
// their own. Module state rather than a renderer field for the reason
// arrival_cover.ts gives: renderer.ts is under a line ratchet.

interface ContextState {
  generation: number;
  lost: boolean;
  disposed: boolean;
  waiters: Array<() => void>;
}

const states = new WeakMap<object, ContextState>();

/** How many times one link is re-submitted before its caller gets the last
 *  answer anyway. Each retry needs a fresh loss while the previous one was in
 *  flight, so this only bounds a context that keeps dying under one link. */
export const CONTEXT_LINK_MAX_RESUBMITS = 3;

function stateOf(renderer: object): ContextState {
  let state = states.get(renderer);
  if (!state) {
    state = { generation: 0, lost: false, disposed: false, waiters: [] };
    states.set(renderer, state);
  }
  return state;
}

function wake(state: ContextState): void {
  const waiters = state.waiters;
  state.waiters = [];
  for (const waiter of waiters) waiter();
}

export function noteRendererContextLost(renderer: object): void {
  const state = stateOf(renderer);
  state.generation++;
  state.lost = true;
}

export function noteRendererContextRestored(renderer: object): void {
  const state = stateOf(renderer);
  state.generation++;
  state.lost = false;
  wake(state);
}

/** The renderer is going away: nothing may wait on its context any longer. */
export function disposeRendererContextGeneration(renderer: object): void {
  const state = stateOf(renderer);
  state.disposed = true;
  state.lost = false;
  wake(state);
}

/** The renderer's restore host was disposed (a graphics rebuild or a
 *  teardown): nothing may be drawn with it again. */
export function rendererDisposed(renderer: object): boolean {
  return states.get(renderer)?.disposed === true;
}

export function rendererContextGeneration(renderer: object): number {
  return states.get(renderer)?.generation ?? 0;
}

export function rendererContextLost(renderer: object): boolean {
  return states.get(renderer)?.lost === true;
}

/** Resolves at once on a live context, else at the next restore (or when
 *  the renderer is disposed). */
export function whenRendererContextLive(renderer: object): Promise<void> {
  const state = states.get(renderer);
  if (!state?.lost || state.disposed) return Promise.resolve();
  return new Promise<void>((resolve) => state.waiters.push(resolve));
}

/**
 * Run `submit` (one link: a compileAsync and whatever state it needs) and
 * re-run it when the context generation moved while it was in flight. A
 * submission never starts on a lost context: it waits for the restore first,
 * since a link issued there proves nothing either. On a live context the
 * first submission runs synchronously in the caller's stack, so a queue unit
 * still pays (and is charged for) compileAsync's synchronous prologue.
 */
export function linkAcrossContextLoss<T>(renderer: object, submit: () => Promise<T>): Promise<T> {
  const attempt = (resubmits: number): Promise<T> => {
    const generation = rendererContextGeneration(renderer);
    return submit().then((result) => {
      const state = states.get(renderer);
      if (
        !state ||
        state.disposed ||
        state.generation === generation ||
        resubmits >= CONTEXT_LINK_MAX_RESUBMITS
      ) {
        return result;
      }
      return whenRendererContextLive(renderer).then(() => attempt(resubmits + 1));
    });
  };
  if (!rendererContextLost(renderer)) return attempt(0);
  return whenRendererContextLive(renderer).then(() => attempt(0));
}
