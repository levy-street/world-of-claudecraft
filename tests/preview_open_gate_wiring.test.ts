// CharacterPreview's cold-open gate, wired: the real armOpen / prepareOpen /
// draw-site path over a stub renderer and a stub GPU queue (the fake shape
// tests/preview_appearance.test.ts already builds for this class).
//
// What it pins is the SEQUENCE, because that is the whole fix: link, then
// upload, then one budgeted touch piece per linked program at the actionable
// priority, and only then the first frame the player sees.
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GPU_WORK_PRIORITY } from '../src/render/background_gpu_queue';
import { CharacterPreview } from '../src/render/characters/preview';
import {
  createPreviewOpenGate,
  type PreviewOpenGate,
} from '../src/render/characters/preview_open_gate_core';
import {
  gpuPrepEventsSnapshot,
  resetGpuPrepEventsForTest,
  setGpuPrepClockForTest,
} from '../src/render/gpu_prep_events';
import { PREVIEW_LINKED_PROGRAM_TOUCH_LABEL } from '../src/render/linked_program_touch_lane';

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

const SIG = '["player_warrior",null,null,null,null]';

interface Harness {
  preview: CharacterPreview;
  state: Record<string, unknown>;
  order: string[];
  touched: { priority: number; label: string }[];
  standIn: { show: () => void; hide: () => void };
  resolveCompile: () => void;
  clock: { now: number };
}

function harness(opts: { programs?: number; textures?: number } = {}): Harness {
  const order: string[] = [];
  const touched: { priority: number; label: string }[] = [];
  const clock = { now: 1_000 };

  let resolveCompile = (): void => {};
  const compiled = new Promise<void>((resolve) => {
    resolveCompile = resolve;
  });

  // One material per program, each carrying the variant its settled compile
  // resolved to. That record is the touch lane's whole notion of readiness: it
  // never asks three, whose cached false costs a synchronous driver query
  // (src/render/linked_program_readiness.ts).
  const programCount = opts.programs ?? 3;
  const materials: object[] = [];
  const linked = new Map<object, unknown>();
  for (let i = 0; i < programCount; i++) {
    const variant = {
      isReady: () => {
        throw new Error('the preview tail must never query the driver for readiness');
      },
      getUniforms: () => order.push(`touch-uniforms:${i}`),
      getAttributes: () => order.push(`touch-attributes:${i}`),
    };
    const material = { name: `body${i}` };
    materials.push(material);
    linked.set(material, { programs: new Map([[`k${i}`, variant]]), currentProgram: variant });
  }
  const characterGroup = {
    traverse: (cb: (o: unknown) => void) => {
      for (const material of materials) cb({ isMesh: true, material });
    },
  };

  const textures = Array.from({ length: opts.textures ?? 2 }, (_, i) => ({
    isTexture: true,
    name: `tex${i}`,
  }));
  const scene = {
    traverse: (cb: (o: unknown) => void) =>
      cb({ material: { map: textures[0], emissiveMap: textures[1] } }),
  };

  const renderer = {
    compileAsync: () => {
      order.push('compile');
      return compiled;
    },
    initTexture: (t: { name: string }) => order.push(`upload:${t.name}`),
    render: () => order.push('render'),
    setSize: () => {},
    getSize: (v: { x: number; y: number }) => {
      v.x = 300;
      v.y = 400;
      return v;
    },
    getPixelRatio: () => 1,
    setPixelRatio: () => {},
    properties: { get: (material: object) => linked.get(material) },
  };

  const preview = Object.create(CharacterPreview.prototype) as CharacterPreview;
  const state = preview as unknown as Record<string, unknown>;
  state.destroyed = false;
  state.prewarming = false;
  state.pendingActive = null;
  state.renderActive = true;
  state.currentSkin = 0;
  state.currentVisualSig = SIG;
  state.currentVisual = { update: vi.fn(), setSkin: vi.fn() };
  state.openGate = createPreviewOpenGate();
  state.standIn = null;
  state.yieldToMain = async (): Promise<void> => {};
  state.timer = { reset: () => {} };
  state.renderer = renderer;
  state.scene = scene;
  state.camera = { aspect: 1, updateProjectionMatrix: () => {} };
  state.characterGroup = characterGroup;
  state.container = { clientWidth: 300, clientHeight: 400 };
  state.touchQueue = {
    run: async <T>(work: () => T | Promise<T>, priority: number, label: string): Promise<T> => {
      touched.push({ priority, label });
      return work();
    },
  };

  // Freeze the gate's clock for every case: the soft deadline must fire
  // because a test moved time, never because a machine was slow.
  setGpuPrepClockForTest(() => clock.now);

  const standIn = {
    show: () => order.push('stand-in:show'),
    hide: () => order.push('stand-in:hide'),
  };
  return { preview, state, order, touched, standIn, resolveCompile, clock };
}

const drawSite = (h: Harness): boolean =>
  (h.preview as unknown as { gateAllowsDraw: () => boolean }).gateAllowsDraw();

const settle = async (): Promise<void> => {
  for (let i = 0; i < 12; i++) await Promise.resolve();
};

beforeEach(() => {
  resetGpuPrepEventsForTest();
});

afterEach(() => {
  setGpuPrepClockForTest(null);
  vi.unstubAllGlobals();
});

describe('CharacterPreview cold-open gate', () => {
  it('links, uploads, touches one budgeted piece per program, THEN draws once', async () => {
    const h = harness({ programs: 3, textures: 2 });
    h.preview.armOpen(h.standIn);

    // Armed: the link is in flight and nothing has drawn.
    expect(h.order).toEqual(['stand-in:show', 'compile']);
    h.preview.syncSize();
    expect(h.order).not.toContain('render');

    h.resolveCompile();
    await settle();

    expect(h.order).toEqual([
      'stand-in:show',
      'compile',
      'upload:tex0',
      'upload:tex1',
      'touch-uniforms:0',
      'touch-attributes:0',
      'touch-uniforms:1',
      'touch-attributes:1',
      'touch-uniforms:2',
      'touch-attributes:2',
      'stand-in:hide',
      'render',
    ]);
    // No render before the LAST touch piece: the reveal draw is what the
    // first-use uniform-table query would otherwise have blocked.
    expect(h.order.indexOf('render')).toBeGreaterThan(h.order.lastIndexOf('touch-attributes:2'));
  });

  it('sends one queue unit per program, at ACTIONABLE_VIEW, under its own label kind', async () => {
    const h = harness({ programs: 3 });
    h.preview.armOpen(h.standIn);
    h.resolveCompile();
    await settle();

    expect(h.touched).toHaveLength(3);
    for (const unit of h.touched) {
      expect(unit.priority).toBe(GPU_WORK_PRIORITY.ACTIONABLE_VIEW);
      expect(unit.label).toBe(PREVIEW_LINKED_PROGRAM_TOUCH_LABEL);
    }
    // Its own kind, so the budget cannot price a preview program off the world
    // touch tail's near-zero estimate.
    expect(PREVIEW_LINKED_PROGRAM_TOUCH_LABEL.split(':')[0]).toBe('touch-preview');
  });

  it('keeps the stand-in up for the WHOLE armed window (never an empty panel)', async () => {
    const h = harness();
    h.preview.armOpen(h.standIn);
    expect(h.order).toContain('stand-in:show');
    expect(h.order).not.toContain('stand-in:hide');

    // Every draw attempt while armed is refused, and the stand-in stays.
    expect(drawSite(h)).toBe(false);
    h.preview.syncSize();
    expect(h.order).not.toContain('stand-in:hide');

    h.resolveCompile();
    await settle();
    expect(h.order.indexOf('stand-in:hide')).toBeLessThan(h.order.indexOf('render'));
  });

  it('never arms a second time for a signature it already linked', async () => {
    const h = harness();
    h.preview.armOpen(h.standIn);
    h.resolveCompile();
    await settle();
    expect(h.preview.linkedVisualSig).toBe(SIG);

    const compiles = h.order.filter((step) => step === 'compile').length;
    const second = { show: vi.fn(), hide: vi.fn() };
    h.preview.armOpen(second);

    expect(second.show).not.toHaveBeenCalled();
    expect(h.order.filter((step) => step === 'compile').length).toBe(compiles);
    // The warm open draws immediately.
    expect(drawSite(h)).toBe(true);
  });

  it('a re-arm in the SAME container shows the stand-in too (the resize cleared the buffer)', async () => {
    const h = harness();
    h.preview.armOpen(h.standIn);
    h.resolveCompile();
    await settle();
    expect(h.order).toContain('render');

    // A gear change rebuilds the body in place, but the mount still runs
    // setContainer/syncSize first, and setSize reassigns canvas.width, which
    // CLEARS the drawing buffer: there is no retained frame to stand in, only
    // a black panel for the whole armed window.
    h.state.currentVisualSig = '["player_warrior","sword_b",null,null,null]';
    const second = { show: vi.fn(), hide: vi.fn() };
    h.preview.armOpen(second);
    expect(drawSite(h)).toBe(false);
    expect(second.show).toHaveBeenCalledTimes(1);
  });

  it('a sheet closed while armed drops the hold and the stand-in with it', async () => {
    const h = harness();
    h.preview.armOpen(h.standIn);
    expect(h.order).toContain('stand-in:show');

    // The window closed: the container has no box, so neither draw site is
    // reachable and the bounded escape can never fire. Nothing may be left
    // behind on the hidden container.
    const container = h.state.container as { clientWidth: number; clientHeight: number };
    container.clientWidth = 0;
    container.clientHeight = 0;
    h.preview.syncSize();

    expect(h.order).toContain('stand-in:hide');
    expect((h.state.openGate as PreviewOpenGate).isArmed()).toBe(false);

    // The warm still in flight was superseded: it records nothing and reveals
    // nothing into the closed panel.
    h.resolveCompile();
    await settle();
    expect(h.order).not.toContain('render');
    expect(h.preview.linkedVisualSig).toBeNull();
  });

  it('still gates when no background prewarm ever ran (the tightMemory arm)', () => {
    const h = harness();
    // src/main.ts gates the whole post-entry schedule on !GFX.tightMemory, so
    // there the first open is ALWAYS cold and this gate is the only cover.
    expect(h.preview.linkedVisualSig).toBeNull();
    h.preview.armOpen(h.standIn);
    expect(drawSite(h)).toBe(false);
    expect(h.order).toContain('stand-in:show');
  });

  it('escapes at the soft deadline: it records a gpu-prep event and draws anyway', () => {
    const h = harness();
    // A link that never resolves (a lost context, a stalled driver).
    h.preview.armOpen(h.standIn);
    expect(drawSite(h)).toBe(false);

    h.clock.now += 1_600;
    expect(drawSite(h)).toBe(true);
    h.preview.syncSize();
    expect(h.order).toContain('render');
    expect(h.order).toContain('stand-in:hide');

    const snapshot = gpuPrepEventsSnapshot();
    const escapes = snapshot.events.filter((e) => e.key === 'preview-open');
    expect(escapes).toHaveLength(1);
    expect(escapes[0].kind).toBe('gate-timeout');
    expect(escapes[0].ageMs).toBeGreaterThanOrEqual(1_500);

    // Recorded ONCE, whatever the frame rate: a draw site runs every frame.
    h.clock.now += 16;
    drawSite(h);
    drawSite(h);
    expect(gpuPrepEventsSnapshot().events.filter((e) => e.key === 'preview-open')).toHaveLength(1);
  });

  it('a warm that fails still reveals the character (fail-soft, never an empty panel)', async () => {
    const h = harness();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    (h.state.renderer as { compileAsync: () => Promise<void> }).compileAsync = () => {
      h.order.push('compile');
      return Promise.reject(new Error('context lost'));
    };
    h.preview.armOpen(h.standIn);
    await settle();
    expect(h.order).toContain('stand-in:hide');
    expect(h.order).toContain('render');
    warn.mockRestore();
  });

  it('prewarm shares the linked signature: a later skin unit skips its compile', async () => {
    vi.stubGlobal('window', { setTimeout: (fn: () => void) => setTimeout(fn, 0) });
    const h = harness();
    h.resolveCompile();
    await h.preview.prewarm([0, 1, 2]);

    expect(h.order.filter((step) => step === 'compile')).toHaveLength(1);
    // The per-skin texture work still happens for every skin.
    expect(h.order.filter((step) => step.startsWith('upload:')).length).toBeGreaterThanOrEqual(6);
    expect(h.preview.linkedVisualSig).toBe(SIG);

    await h.preview.prewarm([0]);
    expect(h.order.filter((step) => step === 'compile')).toHaveLength(1);
    // ...and an open right after warms nothing at all.
    h.preview.armOpen(h.standIn);
    expect(drawSite(h)).toBe(true);
  });

  it('prewarm records the signature only once its OWN touch tail has run', async () => {
    vi.stubGlobal('window', { setTimeout: (fn: () => void) => setTimeout(fn, 0) });
    const h = harness({ programs: 3 });
    h.resolveCompile();
    await h.preview.prewarm([0]);

    // The skip an open takes from this signature covers the tail as well, so
    // the warm has to have paid it: otherwise the open bypasses armOpen
    // entirely and the first-use uniform-table queries land on the click.
    expect(h.touched).toHaveLength(3);
    expect(h.order.indexOf('touch-uniforms:0')).toBeGreaterThan(h.order.indexOf('compile'));
    expect(h.preview.linkedVisualSig).toBe(SIG);
  });

  it('prewarm with NO queue records nothing, so the open gate still touches', async () => {
    vi.stubGlobal('window', { setTimeout: (fn: () => void) => setTimeout(fn, 0) });
    const h = harness({ programs: 2 });
    h.state.touchQueue = null;
    h.resolveCompile();
    await h.preview.prewarm([0]);

    expect(h.touched).toEqual([]);
    expect(h.preview.linkedVisualSig).toBeNull();

    // ...so the open still arms, and its own tail runs there.
    h.state.touchQueue = {
      run: async <T>(work: () => T | Promise<T>, priority: number, label: string): Promise<T> => {
        h.touched.push({ priority, label });
        return work();
      },
    };
    h.preview.armOpen(h.standIn);
    expect(drawSite(h)).toBe(false);
    await settle();
    expect(h.touched).toHaveLength(2);
  });
});

const withoutLineComments = (source: string): string =>
  source
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('//'))
    .join('\n');

describe('the second live draw site is gated too', () => {
  // The animate loop is a class-field arrow function, so it exists only on a
  // fully constructed preview (which needs a real WebGL context). Its gate is
  // pinned at the source, because a gate covering only syncSize is not a gate:
  // the loop would redraw the same cold scene on the very next frame.
  it('the animate loop consults the same gate before its render', () => {
    const src = readFileSync('src/render/characters/preview.ts', 'utf8');
    const animate = src.slice(src.indexOf('private animate = ('));
    // Code only: a commented-out gate must not satisfy the pin.
    const body = withoutLineComments(animate.slice(0, animate.indexOf('\n  };')));
    expect(body).toContain('if (!this.gateAllowsDraw()) return;');
    expect(body.indexOf('this.gateAllowsDraw()')).toBeLessThan(
      body.indexOf('this.renderer.render(this.scene, this.camera)'),
    );
  });

  // Both preview tails follow a compileAsync this class AWAITED to completion,
  // which is the only thing that proves its programs linked; the lane's
  // readiness record is fed from exactly that (linked_program_readiness.ts).
  it('both touch tails declare their compile settled, and neither names the driver', () => {
    const src = withoutLineComments(readFileSync('src/render/characters/preview.ts', 'utf8'));
    const calls = src.split('runLinkedProgramTouchLane(').slice(1);
    expect(calls).toHaveLength(2);
    for (const call of calls) {
      const args = call.slice(0, call.indexOf(');'));
      expect(args).toContain('{ label: PREVIEW_LINKED_PROGRAM_TOUCH_LABEL, settled: true }');
    }
    expect(src).not.toContain('isReady(');
  });

  // The HUD is the only arm site, and it is inside a monolith the ratchet
  // holds, so the wiring is two lines there and cannot carry its own test.
  it('every mount of the shared preview arms the gate', () => {
    const hud = readFileSync('src/ui/hud.ts', 'utf8');
    const mount = hud.slice(hud.indexOf('private mountSharedPreview('));
    const body = withoutLineComments(mount.slice(0, mount.indexOf('\n  }')));
    expect(body).toContain(
      'armPreviewOpen(this.charPreview, container, { cls: opts.cls, skin: opts.skin }, this.renderer)',
    );
  });
});
