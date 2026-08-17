// Orchestration core for the async portrait prewarm (the paced post-entry
// lane). The host (portrait.ts) owns the WebGL rig, the shared mount, and the
// data-URL cache; this core owns the step ORDER and the lifecycle guarantees a
// Vitest can pin without a GL context:
// - the three cheap early-outs (cached, assets not ready, atlas streaming)
//   build nothing;
// - the built visual is ALWAYS released, on success, error, and every
//   mid-flight cancellation;
// - a stale host (graphics rebuild swapped the rig) stops the run before the
//   next stage, and its late encode result is never committed;
// - the cache commit happens only after a successful encode.
// The host's own contract (kept out of this core because it needs the rig):
// the visual must never stay MOUNTED across an await, because the mount is
// shared with the synchronous capture() path and a mounted visual would bleed
// into any concurrent live portrait capture.

export interface PortraitPrewarmSteps<V> {
  /** True when the portrait is already in the data-URL cache. */
  cached(): boolean;
  /** True once character assets finished preloading. */
  ready(): boolean;
  /** True while the (visualKey, skin) atlas is still streaming in. */
  atlasPending(): boolean;
  build(): V;
  /** Budgeted texture-residency sweep (uploadTexturesInSlices). */
  uploadTextures(visual: V): Promise<void>;
  /** False once the host's rig was swapped by a graphics rebuild. */
  current(): boolean;
  /** Async shader link for the visual's materials. */
  compile(visual: V): Promise<void>;
  /** One synchronous render plus the bitmap snapshot; resolves the encoded
   *  data URL, or null on an encode failure (the lazy sync path covers it). */
  renderAndSnapshot(visual: V): Promise<string | null>;
  /** Unmount + dispose; must be safe to call in every exit path. */
  release(visual: V): void;
  commit(url: string): void;
  onError(err: unknown): void;
}

export async function runPortraitPrewarm<V>(steps: PortraitPrewarmSteps<V>): Promise<void> {
  if (steps.cached() || !steps.ready() || steps.atlasPending()) return;
  let visual: V | null = null;
  let encode: Promise<string | null> | null = null;
  try {
    visual = steps.build();
    await steps.uploadTextures(visual);
    if (!steps.current()) return;
    await steps.compile(visual);
    if (!steps.current()) return;
    encode = steps.renderAndSnapshot(visual);
  } catch (err) {
    steps.onError(err);
    return;
  } finally {
    if (visual) steps.release(visual);
  }
  if (!encode) return;
  const url = await encode;
  // The rebuild recheck matters here too: resetPortraitRendererForGraphicsRebuild
  // clears the cache, and a pre-rebuild PNG landing after that clear would be
  // served against the new graphics profile indefinitely.
  if (url && steps.current()) steps.commit(url);
}
