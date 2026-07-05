// Wires inline 3D embeds and the gallery to the lazy three.js viewer. Pages call these
// from their mount() hook; the actual renderer (scene.ts) is pulled in via a dynamic
// import on first activation, so three.js stays out of the main Guide bundle and only a
// reader who asks for a model ever downloads it (or a GLB).

import { t } from '../../ui/i18n';
import { GUIDE_MODELS } from '../content.generated';
import type { ModelViewer } from './scene';

let webglSupport: boolean | null = null;

/** Whether this browser can show a WebGL model at all (else embeds stay poster-only). */
export function hasWebGL(): boolean {
  if (webglSupport !== null) return webglSupport;
  try {
    const c = document.createElement('canvas');
    webglSupport = !!(window.WebGLRenderingContext && (c.getContext('webgl') || c.getContext('experimental-webgl')));
  } catch {
    webglSupport = false;
  }
  return webglSupport;
}

/** Lazily load the viewer chunk and construct a turntable over `stage`. */
export async function createViewer(stage: HTMLElement, canvasLabel: string): Promise<ModelViewer> {
  const { ModelViewer } = await import('./scene');
  return new ModelViewer(stage, canvasLabel);
}

interface WireOptions {
  /** Cap on simultaneously-live viewers; opening more evicts the oldest (LRU). Guards the
   *  browser's ~16-context WebGL limit on a long page like the bestiary. */
  maxConcurrent?: number;
}

interface LiveEntry { release(): void; }

/**
 * Wire every inline model embed under `root` (figures emitted by modelViewerEmbed). Each
 * figure loads its model on first activation, pauses while scrolled offscreen, and is
 * evicted (back to its 2D poster, reopenable) once the live count passes maxConcurrent.
 * Returns a cleanup that destroys all live viewers and removes listeners.
 */
export function wireModelViewers(root: HTMLElement, opts: WireOptions = {}): () => void {
  const cap = Math.max(1, opts.maxConcurrent ?? 4);
  const figures = Array.from(root.querySelectorAll<HTMLElement>('.guide-viewer[data-model]'));
  const noWebGL = !hasWebGL();
  const live: LiveEntry[] = [];
  const cleanups: Array<() => void> = [];

  for (const fig of figures) {
    const btn = fig.querySelector<HTMLButtonElement>('.guide-viewer-load');
    const stage = fig.querySelector<HTMLElement>('.guide-viewer-stage');
    if (!btn || !stage) continue;
    if (noWebGL) {
      fig.dataset.state = 'nowebgl'; // CSS hides the button; the 2D poster remains
      continue;
    }

    let viewer: ModelViewer | null = null;
    let io: IntersectionObserver | null = null;
    let started = false;
    let loadGen = 0;
    const entry: LiveEntry = { release };

    function release(): void {
      loadGen++; // invalidate any in-flight activate() for this figure
      if (io) { io.disconnect(); io = null; }
      if (viewer) { viewer.destroy(); viewer = null; }
      const i = live.indexOf(entry);
      if (i >= 0) live.splice(i, 1);
      fig.dataset.state = 'idle';
      if (btn) btn.disabled = false;
      started = false;
    }

    async function activate(): Promise<void> {
      if (started) return;
      started = true;
      // Generation token: every release() (LRU eviction, context loss, cleanup) bumps
      // loadGen, so a load evicted mid-await can detect it is stale and discard the context
      // it built instead of leaving an untracked WebGL context above the cap.
      const myGen = ++loadGen;
      const spec = GUIDE_MODELS[fig.dataset.model ?? ''];
      if (!spec) {
        // eslint-disable-next-line no-console
        console.error('Guide model viewer: no model for key', fig.dataset.model);
        started = false;
        return;
      }
      if (!stage || !btn) { started = false; return; }
      // Evict the oldest live viewers BEFORE building this one, so the count of live WebGL
      // contexts never momentarily exceeds the cap (each viewer is its own GL context, and
      // browsers cap live contexts at ~16). release() also clears the oldest's started flag.
      while (live.length >= cap) live[0].release();
      // Claim a slot up front (most-recently-activated stays last), then build; the catch
      // releases the slot if the load throws, so a failed figure never wedges the cap.
      live.push(entry);
      fig.dataset.state = 'loading';
      btn.disabled = true;
      try {
        const label = t('guide.viewer.canvasLabel', { name: fig.dataset.name ?? '' });
        const built = await createViewer(stage, label);
        // Evicted while the lazy chunk loaded: this load is stale, so drop the just-built
        // context (release ran before `viewer` was assigned, so it did not destroy it).
        if (myGen !== loadGen) { built.destroy(); return; }
        viewer = built;
        built.onContextLost(() => { release(); fig.dataset.state = 'error'; });
        const tintAttr = fig.dataset.tint;
        const tint = tintAttr ? parseInt(tintAttr.replace('#', ''), 16) : null;
        await built.load(spec, tint);
        // Evicted during the GLB load: release() already destroyed `viewer`, so just bail.
        if (myGen !== loadGen) return;
        fig.dataset.state = 'ready';
        const v = built;
        io = new IntersectionObserver(
          (entries) => { for (const e of entries) v.setOnscreen(e.isIntersecting); },
          { threshold: 0 },
        );
        io.observe(stage);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('Guide model viewer failed to load', err);
        release();
        fig.dataset.state = 'error';
      }
    }

    const onClick = (): void => { void activate(); };
    btn.addEventListener('click', onClick);
    cleanups.push(() => { btn.removeEventListener('click', onClick); release(); });
  }

  return () => { for (const c of cleanups) c(); };
}
