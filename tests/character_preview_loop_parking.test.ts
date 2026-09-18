// CharacterPreview's animation loop parks while the preview is hidden or
// unmounted (a closed character sheet) instead of requesting a frame it
// will not draw, and wakes from syncSize, which every mount and every
// container size change runs.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CharacterPreview } from '../src/render/characters/preview';
import { createPreviewOpenGate } from '../src/render/characters/preview_open_gate_core';

vi.mock('../src/render/characters/assets', () => ({
  mechAssetsReady: () => true,
  preloadMechAssets: () => Promise.resolve(),
}));

vi.mock('../src/render/characters/visual', () => ({
  CharacterVisual: class {
    root = {};
    setWeaponSkin = vi.fn();
    setSkin = vi.fn();
    update = vi.fn();
    dispose = vi.fn();
  },
}));

interface Harness {
  preview: CharacterPreview;
  container: { clientWidth: number; clientHeight: number };
  canvas: { isConnected: boolean };
  renders: number;
  pending: (() => void)[];
  /** Runs every pending animation frame callback once. */
  frame(): void;
}

function harness(): Harness {
  const pending: (() => void)[] = [];
  vi.stubGlobal('requestAnimationFrame', (cb: () => void) => {
    pending.push(cb);
    return pending.length;
  });
  vi.stubGlobal('cancelAnimationFrame', () => {});
  const container = { clientWidth: 0, clientHeight: 0 };
  const canvas = { isConnected: false };
  const h: Harness = {
    preview: Object.create(CharacterPreview.prototype) as CharacterPreview,
    container,
    canvas,
    renders: 0,
    pending,
    frame() {
      const batch = pending.splice(0, pending.length);
      for (const cb of batch) cb();
    },
  };
  const state = h.preview as unknown as Record<string, unknown>;
  state.destroyed = false;
  state.prewarming = false;
  state.pendingActive = null;
  state.renderActive = false;
  state.animationFrameId = null;
  state.animate = () => (h.preview as unknown as { animateFrame: () => void }).animateFrame();
  state.container = container;
  state.canvas = canvas;
  state.timer = { reset: vi.fn(), update: vi.fn(), getDelta: () => 0.016 };
  state.openGate = createPreviewOpenGate();
  state.standIn = null;
  state.currentVisual = { update: vi.fn() };
  state.scene = {};
  state.camera = { aspect: 1, updateProjectionMatrix: () => {} };
  state.renderer = {
    render: () => {
      h.renders++;
    },
    setSize: () => {},
  };
  return h;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('CharacterPreview loop parking', () => {
  it('requests no frame while hidden, then wakes from syncSize once the container has a size', () => {
    const h = harness();
    (h.preview as unknown as { animateFrame: () => void }).animateFrame();
    // Hidden: the loop parked, nothing pending.
    expect(h.pending).toHaveLength(0);
    for (let i = 0; i < 5; i++) h.frame();
    expect(h.pending).toHaveLength(0);
    expect(h.renders).toBe(0);

    // The sheet opens: the container gets a size, the resize observer runs syncSize.
    h.container.clientWidth = 300;
    h.container.clientHeight = 400;
    h.canvas.isConnected = true;
    h.preview.syncSize();
    expect(h.pending).toHaveLength(1);
    const before = h.renders;
    h.frame();
    // Drawing again, one frame requested per frame.
    expect(h.renders).toBe(before + 1);
    expect(h.pending).toHaveLength(1);
    // A second syncSize while a frame is pending does not double the loop.
    h.preview.syncSize();
    expect(h.pending).toHaveLength(1);

    // The sheet closes: the next frame parks again.
    h.container.clientWidth = 0;
    h.container.clientHeight = 0;
    h.frame();
    expect(h.pending).toHaveLength(0);
  });

  it('never wakes after destroy', () => {
    const h = harness();
    h.container.clientWidth = 300;
    h.container.clientHeight = 400;
    h.canvas.isConnected = true;
    (h.preview as unknown as { destroyed: boolean }).destroyed = true;
    h.preview.syncSize();
    expect(h.pending).toHaveLength(0);
  });
});
