// Unit test for wireModelViewers (src/guide/viewer/mount.ts): the LRU context-cap eviction,
// the generation-token guard that drops a viewer evicted mid-load, the autoplay gating, and the
// no-WebGL fallback. This is the most bug-prone new logic on the branch and the code the
// "models not loading / WebGL context exhaustion" fix depends on, yet the only other exerciser is
// the browser E2E driver (needs a live dev server, not in `npm test`). Per tests/CLAUDE.md we use
// a small hand-rolled fake DOM + a controllable fake ModelViewer, never jsdom.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Shared, hoisted fake viewer so the mock factory and the test see the same instance list.
const h = vi.hoisted(() => {
  const instances: Array<{
    destroyed: boolean;
    onscreen: boolean | null;
    resolveLoad: () => void;
    failLoad: () => void;
    loseContext: () => void;
    label: string;
  }> = [];
  class FakeViewer {
    destroyed = false;
    onscreen: boolean | null = null;
    label: string;
    private loadResolvers: Array<() => void> = [];
    private loadRejecters: Array<(e: unknown) => void> = [];
    private contextLostCb: (() => void) | null = null;
    constructor(_stage: unknown, label: string) {
      this.label = label;
      instances.push(this);
    }
    onContextLost(cb: () => void): void {
      this.contextLostCb = cb;
    }
    isContextLost(): boolean {
      return false;
    }
    setOnscreen(v: boolean): void {
      this.onscreen = v;
    }
    setLabel(l: string): void {
      this.label = l;
    }
    // Stays pending until the test resolves OR fails it, so we can evict a viewer mid-load or
    // drive it down the error path.
    load(): Promise<void> {
      return new Promise((res, rej) => {
        this.loadResolvers.push(res);
        this.loadRejecters.push(rej);
      });
    }
    resolveLoad(): void {
      for (const r of this.loadResolvers) r();
    }
    failLoad(): void {
      for (const r of this.loadRejecters) r(new Error('load failed'));
    }
    // Simulate a lost WebGL context: invoke the callback mount.ts registered via onContextLost.
    loseContext(): void {
      this.contextLostCb?.();
    }
    destroy(): void {
      this.destroyed = true;
    }
  }
  return { instances, FakeViewer };
});

vi.mock('../src/guide/viewer/scene', () => ({ ModelViewer: h.FakeViewer }));
vi.mock('../src/guide/content.generated', () => ({
  GUIDE_MODELS: { wolf: { url: 'a.glb' }, bear: { url: 'b.glb' }, boar: { url: 'c.glb' } },
}));
// mount.ts only uses t() for the canvas accessible name; stub it so the reset-module test env
// (no initialized locale) does not throw on the key lookup. We assert on behavior, not the label.
vi.mock('../src/ui/i18n', () => ({ t: (k: string) => k }));

// ---- fake DOM (only the surface wireModelViewers queries) ----
class FakeEl {
  dataset: Record<string, string> = {};
  disabled = false;
  textContent = '';
  private listeners: Record<string, Array<(e: unknown) => void>> = {};
  constructor(
    public kind: 'figure' | 'button' | 'stage' | 'status',
    private button?: FakeEl,
    private stage?: FakeEl,
    private status?: FakeEl,
  ) {}
  addEventListener(type: string, fn: (e: unknown) => void): void {
    this.listeners[type] = this.listeners[type] ?? [];
    this.listeners[type].push(fn);
  }
  removeEventListener(type: string, fn: (e: unknown) => void): void {
    this.listeners[type] = (this.listeners[type] || []).filter((f) => f !== fn);
  }
  fire(type: string, e: unknown = {}): void {
    for (const fn of (this.listeners[type] || []).slice()) fn(e);
  }
  // mount.ts asks a figure for its load button, its stage, and its status live region.
  querySelector(sel: string): FakeEl | null {
    if (sel.includes('guide-viewer-load')) return this.button ?? null;
    if (sel.includes('guide-viewer-stage')) return this.stage ?? null;
    if (sel.includes('guide-viewer-status')) return this.status ?? null;
    return null;
  }
}

interface Fig {
  fig: FakeEl;
  btn: FakeEl;
  stage: FakeEl;
  status: FakeEl;
}
function makeFigure(model: string, opts: { autoplay?: boolean } = {}): Fig {
  const btn = new FakeEl('button');
  const stage = new FakeEl('stage');
  const status = new FakeEl('status');
  const fig = new FakeEl('figure', btn, stage, status);
  fig.dataset = { model, name: model, state: 'idle' };
  if (opts.autoplay) fig.dataset.autoplay = 'true';
  return { fig, btn, stage, status };
}
// Returns HTMLElement (the public wireModelViewers param type); the fake only models the
// surface mount.ts actually touches.
function makeRoot(figs: Fig[]): HTMLElement {
  const root = new FakeEl('figure');
  // root.querySelectorAll('.guide-viewer[data-model]') -> the figures
  (root as unknown as { querySelectorAll: (sel: string) => FakeEl[] }).querySelectorAll = () =>
    figs.map((f) => f.fig);
  return root as unknown as HTMLElement;
}

// Captured IntersectionObserver instances so the test can trigger intersections.
let observers: Array<{
  cb: (entries: unknown[], obs: unknown) => void;
  disconnect: () => void;
  observed: unknown[];
}>;
let webglOk: boolean;
let reducedMotion: boolean;

beforeEach(() => {
  h.instances.length = 0;
  observers = [];
  webglOk = true;
  reducedMotion = false;
  vi.resetModules(); // reset mount.ts's cached webglSupport between tests

  class FakeIO {
    observed: unknown[] = [];
    constructor(public cb: (entries: unknown[], obs: unknown) => void) {
      observers.push({ cb, disconnect: () => this.disconnect(), observed: this.observed });
    }
    observe(el: unknown): void {
      this.observed.push(el);
    }
    disconnect(): void {}
    unobserve(): void {}
  }
  vi.stubGlobal('IntersectionObserver', FakeIO as unknown as typeof IntersectionObserver);
  vi.stubGlobal('requestAnimationFrame', () => 0);
  vi.stubGlobal('cancelAnimationFrame', () => {});
  vi.stubGlobal('matchMedia', (q: string) => ({
    matches: q.includes('reduced-motion') ? reducedMotion : false,
    media: q,
    addEventListener() {},
    removeEventListener() {},
  }));
  vi.stubGlobal('window', {
    matchMedia: (q: string) => ({ matches: q.includes('reduced-motion') ? reducedMotion : false }),
    WebGLRenderingContext: () => {},
    devicePixelRatio: 1,
  });
  vi.stubGlobal('document', {
    createElement: () => ({ getContext: () => (webglOk ? {} : null) }),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// activate() fires-and-forgets a dynamic import('./scene'); drain macrotasks (not just
// microtasks) so the mocked viewer is built and its load() promise is registered before asserting.
const flush = async (): Promise<void> => {
  for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0));
};

describe('wireModelViewers', () => {
  it('keeps the live viewer count at or under the cap, evicting the oldest (LRU)', async () => {
    const { wireModelViewers } = await import('../src/guide/viewer/mount');
    const figs = [makeFigure('wolf'), makeFigure('bear'), makeFigure('boar')];
    const cleanup = wireModelViewers(makeRoot(figs), { maxConcurrent: 2 });

    // Activate one at a time (a real reader clicks viewers seconds apart, and createViewer's
    // dynamic import settles between clicks).
    figs[0].btn.fire('click');
    await flush();
    figs[1].btn.fire('click');
    await flush();
    figs[2].btn.fire('click'); // third activation: cap is 2, so the oldest (wolf) is evicted
    await flush();

    // Three viewers were built; the first was destroyed by the cap eviction, leaving exactly two.
    expect(h.instances).toHaveLength(3);
    expect(h.instances[0].destroyed).toBe(true);
    expect(h.instances.filter((v) => !v.destroyed)).toHaveLength(2);
    cleanup();
  });

  it('drops a viewer evicted mid-load instead of leaving an untracked context above the cap', async () => {
    const { wireModelViewers } = await import('../src/guide/viewer/mount');
    const figs = [makeFigure('wolf'), makeFigure('bear'), makeFigure('boar')];
    const cleanup = wireModelViewers(makeRoot(figs), { maxConcurrent: 1 });

    figs[0].btn.fire('click');
    await flush(); // wolf viewer built, its load() is pending
    expect(h.instances).toHaveLength(1);
    expect(h.instances[0].destroyed).toBe(false);

    figs[1].btn.fire('click'); // evicts wolf (cap 1) before its load resolved
    await flush();
    expect(h.instances[0].destroyed).toBe(true); // wolf released + destroyed

    // Even if wolf's in-flight load now resolves, it must not resurrect or leak.
    h.instances[0].resolveLoad();
    await flush();
    expect(h.instances[0].destroyed).toBe(true);
    expect(h.instances.filter((v) => !v.destroyed).length).toBeLessThanOrEqual(1);
    cleanup();
  });

  it('does not build any viewer when WebGL is unavailable (poster-only fallback)', async () => {
    webglOk = false;
    const { wireModelViewers } = await import('../src/guide/viewer/mount');
    const figs = [makeFigure('wolf')];
    const cleanup = wireModelViewers(makeRoot(figs));
    figs[0].btn.fire('click');
    await flush();
    expect(h.instances).toHaveLength(0);
    expect(figs[0].fig.dataset.state).toBe('nowebgl');
    cleanup();
  });

  it('autoplays a flagged hero only when motion is allowed', async () => {
    const { wireModelViewers } = await import('../src/guide/viewer/mount');
    const figs = [makeFigure('wolf', { autoplay: true })];
    const cleanup = wireModelViewers(makeRoot(figs));
    // The autoplay trigger is a one-shot IntersectionObserver; fire its intersection.
    expect(observers.length).toBeGreaterThan(0);
    observers[0].cb([{ isIntersecting: true }], { disconnect() {} });
    await flush();
    expect(h.instances).toHaveLength(1); // auto-loaded without a click
    cleanup();
  });

  it('does not autoplay when the reader prefers reduced motion', async () => {
    reducedMotion = true;
    const { wireModelViewers } = await import('../src/guide/viewer/mount');
    const figs = [makeFigure('wolf', { autoplay: true })];
    const cleanup = wireModelViewers(makeRoot(figs));
    await flush();
    // No autoplay trigger registered, so nothing builds on its own.
    expect(h.instances).toHaveLength(0);
    cleanup();
  });

  it('cleanup destroys every live viewer', async () => {
    const { wireModelViewers } = await import('../src/guide/viewer/mount');
    const figs = [makeFigure('wolf'), makeFigure('bear')];
    const cleanup = wireModelViewers(makeRoot(figs), { maxConcurrent: 4 });
    figs[0].btn.fire('click');
    await flush();
    figs[1].btn.fire('click');
    await flush();
    expect(h.instances.filter((v) => !v.destroyed).length).toBe(2);
    cleanup();
    expect(h.instances.every((v) => v.destroyed)).toBe(true);
  });

  // VIEW-4: the status pill is an empty ARIA live region (embed.ts); mount.ts must write into it
  // on each transition, since aria-live announces a text mutation, not the CSS show/hide keyed off
  // data-state. The t() stub is identity, so we assert on the key the transition resolves.
  it('writes the loading message to the live region, then clears it once the model is ready', async () => {
    const { wireModelViewers } = await import('../src/guide/viewer/mount');
    const figs = [makeFigure('wolf')];
    const cleanup = wireModelViewers(makeRoot(figs), { maxConcurrent: 2 });
    figs[0].btn.fire('click');
    await flush(); // viewer built, load() pending: the figure is in its loading state
    expect(figs[0].fig.dataset.state).toBe('loading');
    expect(figs[0].status.textContent).toBe('guide.viewer.loading');
    h.instances[0].resolveLoad(); // load settles: the figure becomes ready
    await flush();
    expect(figs[0].fig.dataset.state).toBe('ready');
    expect(figs[0].status.textContent).toBe(''); // cleared so the loading line is not re-announced
    cleanup();
  });

  it('writes the error message to the live region when the model load fails', async () => {
    const { wireModelViewers } = await import('../src/guide/viewer/mount');
    const figs = [makeFigure('wolf')];
    const cleanup = wireModelViewers(makeRoot(figs), { maxConcurrent: 2 });
    figs[0].btn.fire('click');
    await flush();
    expect(figs[0].status.textContent).toBe('guide.viewer.loading');
    h.instances[0].failLoad(); // load rejects: the catch drops the figure to its error state
    await flush();
    expect(figs[0].fig.dataset.state).toBe('error');
    expect(figs[0].status.textContent).toBe('guide.viewer.error');
    cleanup();
  });

  it('writes the error message to the live region on a lost WebGL context', async () => {
    const { wireModelViewers } = await import('../src/guide/viewer/mount');
    const figs = [makeFigure('wolf')];
    const cleanup = wireModelViewers(makeRoot(figs), { maxConcurrent: 2 });
    figs[0].btn.fire('click');
    await flush();
    h.instances[0].resolveLoad();
    await flush();
    expect(figs[0].fig.dataset.state).toBe('ready');
    expect(figs[0].status.textContent).toBe('');
    h.instances[0].loseContext(); // context loss: release() then the error transition
    await flush();
    expect(figs[0].fig.dataset.state).toBe('error');
    expect(figs[0].status.textContent).toBe('guide.viewer.error');
    cleanup();
  });

  it('clears the live region when a loading figure is evicted (LRU), so no stale message lingers', async () => {
    // The other half of "cleared on idle/ready": release() (LRU eviction / cleanup) must wipe the
    // loading message. Otherwise an evicted mid-load figure keeps "Loading model..." in its live
    // region, and re-activating it rewrites the SAME value, so textContent never mutates and the
    // screen reader never re-announces the load.
    const { wireModelViewers } = await import('../src/guide/viewer/mount');
    const figs = [makeFigure('wolf'), makeFigure('bear')];
    const cleanup = wireModelViewers(makeRoot(figs), { maxConcurrent: 1 });
    figs[0].btn.fire('click');
    await flush(); // wolf is loading; its live region carries the loading message
    expect(figs[0].fig.dataset.state).toBe('loading');
    expect(figs[0].status.textContent).toBe('guide.viewer.loading');
    figs[1].btn.fire('click'); // cap 1: activating bear evicts wolf through release()
    await flush();
    expect(figs[0].fig.dataset.state).toBe('idle'); // wolf drops back to its 2D poster
    expect(figs[0].status.textContent).toBe(''); // and its live region is wiped, not left stale
    cleanup();
  });
});
