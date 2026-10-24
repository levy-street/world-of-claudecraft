// @vitest-environment happy-dom
// src/render/characters/preview_material_gate.ts: the compile gate a preview body's late
// materials link behind (CharacterPreview hands it to CharacterVisual.setFarBakeGate). It
// holds two kinds of target: a hidden TWIN whose stand-in keeps drawing (a late body atlas,
// an effect swap) and a NODE with nothing standing in for it (a late head file, a first
// armor file, a face decal), which stays hidden until the gate settles. A warm the context
// rejects must not leave the second kind hidden for good, and must not commit the first
// kind cold: the gate reports a rejection once, not ready, and stays silent for a target
// whose warm fails again. The atlas twin's own preview cases live with the swap, in
// tests/woc_far_equipment.test.ts.
import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { previewMaterialGate } from '../src/render/characters/preview_material_gate';
import { IDLE, KEY, releaseWocVisualHarness, wocVisualHarness } from './helpers/woc_visual_harness';

type Settle = (ready?: () => boolean) => void;

/** A preview context whose warm the case finishes or fails by hand. */
function context() {
  const warms: Array<{ target: THREE.Object3D; finish(): void; fail(err: Error): void }> = [];
  const uploads: THREE.Texture[] = [];
  let current = true;
  const gate = previewMaterialGate({
    renderer: {
      compileAsync: (target: THREE.Object3D) =>
        new Promise<THREE.Object3D>((resolve, reject) =>
          warms.push({ target, finish: () => resolve(target), fail: reject }),
        ),
      initTexture: (texture: THREE.Texture) => {
        uploads.push(texture);
      },
      properties: { get: () => ({ programs: new Map(), currentProgram: null }) },
    } as never,
    scene: new THREE.Scene(),
    camera: new THREE.PerspectiveCamera(),
    touchQueue: () => null,
    yieldToMain: async () => {},
    isCurrent: () => current,
  });
  return {
    gate,
    warms,
    uploads,
    retire: () => {
      current = false;
    },
  };
}

/** A hidden node under a parent, as every gated target is (a detached one is superseded). */
function target(): THREE.Object3D {
  const parent = new THREE.Group();
  const node = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshBasicMaterial({ map: new THREE.Texture() }),
  );
  node.visible = false;
  parent.add(node);
  return node;
}

async function flush(): Promise<void> {
  for (let i = 0; i < 30; i++) await Promise.resolve();
}

afterEach(() => {
  vi.restoreAllMocks();
  releaseWocVisualHarness();
});

describe('previewMaterialGate: what a settle says', () => {
  it('settles once, vouching (no proof to consult), after the warm links and uploads', async () => {
    const c = context();
    const node = target();
    const settle = vi.fn<Settle>();
    c.gate(node, settle);
    await flush();
    expect(settle).not.toHaveBeenCalled();
    c.warms[0].finish();
    await flush();
    expect(settle).toHaveBeenCalledOnce();
    // no `ready` at all: the gate did the link, the upload and the touch itself
    expect(settle.mock.calls[0]).toEqual([]);
    expect(c.uploads).toHaveLength(1);
  });

  it('settles NOT ready when the warm is rejected, so the caller hears of it', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const c = context();
    const settle = vi.fn<Settle>();
    c.gate(target(), settle);
    await flush();
    c.warms[0].fail(new Error('context lost'));
    await flush();
    expect(settle).toHaveBeenCalledOnce();
    const ready = settle.mock.calls[0][0];
    expect(typeof ready).toBe('function');
    expect(ready?.()).toBe(false);
    expect(warn).toHaveBeenCalledOnce();
    // nothing was uploaded for a link that never came back
    expect(c.uploads).toHaveLength(0);
  });

  it('reports a rejected upload the same way', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const node = target();
    const settle = vi.fn<Settle>();
    const gate = previewMaterialGate({
      renderer: {
        compileAsync: () => Promise.resolve(node),
        initTexture: () => {
          throw new Error('upload refused');
        },
        properties: { get: () => ({ programs: new Map(), currentProgram: null }) },
      } as never,
      scene: new THREE.Scene(),
      camera: new THREE.PerspectiveCamera(),
      touchQueue: () => null,
      yieldToMain: async () => {},
      isCurrent: () => true,
    });
    gate(node, settle);
    await flush();
    expect(settle).toHaveBeenCalledOnce();
    expect(settle.mock.calls[0][0]?.()).toBe(false);
    expect(warn).toHaveBeenCalledOnce();
  });

  it('reports a rejection ONCE per target: asked again, a second failure keeps its silence', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const c = context();
    const twin = target();
    const first = vi.fn<Settle>();
    c.gate(twin, first);
    await flush();
    c.warms[0].fail(new Error('rejected'));
    await flush();
    expect(first).toHaveBeenCalledOnce();
    // only a caller with a stand-in drawing asks again (a swap twin, a replacement file):
    // a warm that fails again is not vouched for and not reported, so that stand-in stays
    const again = vi.fn<Settle>();
    c.gate(twin, again);
    await flush();
    expect(c.warms).toHaveLength(2);
    c.warms[1].fail(new Error('rejected again'));
    await flush();
    expect(again).not.toHaveBeenCalled();
    // and a third ask is still warmed, and still silent on failure
    const third = vi.fn<Settle>();
    c.gate(twin, third);
    await flush();
    c.warms[2].fail(new Error('and again'));
    await flush();
    expect(third).not.toHaveBeenCalled();
    expect(first).toHaveBeenCalledOnce();
  });

  it('vouches for a target whose retry warms: the stand-in gives way to a prepared twin', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const c = context();
    const twin = target();
    c.gate(twin, vi.fn<Settle>());
    await flush();
    c.warms[0].fail(new Error('rejected'));
    await flush();
    const again = vi.fn<Settle>();
    c.gate(twin, again);
    await flush();
    c.warms[1].finish();
    await flush();
    expect(again).toHaveBeenCalledOnce();
    expect(again.mock.calls[0]).toEqual([]);
    expect(c.uploads).toHaveLength(1);
  });

  it('keeps one failed target from silencing another', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const c = context();
    c.gate(target(), vi.fn<Settle>());
    await flush();
    c.warms[0].fail(new Error('rejected'));
    await flush();
    const other = vi.fn<Settle>();
    c.gate(target(), other);
    await flush();
    c.warms[1].fail(new Error('rejected too'));
    await flush();
    expect(other).toHaveBeenCalledOnce();
    expect(other.mock.calls[0][0]?.()).toBe(false);
  });

  it('answers an ask once: a caller that throws out of its settle is not settled again', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const c = context();
    const settle = vi.fn<Settle>(() => {
      throw new Error('the caller broke');
    });
    c.gate(target(), settle);
    await flush();
    c.warms[0].finish();
    await flush();
    // the throw is logged like any failed warm, but the ask was already answered (vouched)
    expect(settle).toHaveBeenCalledOnce();
    expect(settle.mock.calls[0]).toEqual([]);
    expect(warn).toHaveBeenCalledOnce();
  });

  it('contains a caller that throws out of the not-ready report', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const c = context();
    const settle = vi.fn<Settle>(() => {
      throw new Error('the caller broke');
    });
    c.gate(target(), settle);
    await flush();
    c.warms[0].fail(new Error('context lost'));
    await flush();
    // reported once; the throw is logged, never an unhandled rejection (which fails the run)
    expect(settle).toHaveBeenCalledOnce();
    expect(settle.mock.calls[0][0]?.()).toBe(false);
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('settles nothing for a superseded target, rejected or not', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const c = context();
    const detached = target();
    const a = vi.fn<Settle>();
    c.gate(detached, a);
    await flush();
    detached.removeFromParent();
    c.warms[0].fail(new Error('too late'));
    await flush();
    expect(a).not.toHaveBeenCalled();
    // a preview that moved on to another body
    const stale = target();
    const b = vi.fn<Settle>();
    c.gate(stale, b);
    await flush();
    c.retire();
    c.warms[1].fail(new Error('too late'));
    await flush();
    expect(b).not.toHaveBeenCalled();
    const done = target();
    const d = vi.fn<Settle>();
    c.gate(done, d);
    await flush();
    // retired before it started: no warm is even asked for
    expect(c.warms).toHaveLength(2);
    expect(d).not.toHaveBeenCalled();
    // a superseded warm is nobody's failure: nothing is logged for it
    expect(warn).not.toHaveBeenCalled();
  });
});

// The reason a rejection has to be reported: a preview body draws NOTHING until its head is
// live (the base file ends at the neck), and a head file landing late is revealed through
// this gate. With no settle after a rejected warm, the wrapper stayed hidden, the head never
// went live, and the body stayed undrawn for as long as the preview lived.
describe('a preview body waiting on its head recovers from a rejected warm', () => {
  const QUIFF = 'models/chars/players/woc/head_type_a_hair_quiff.glb';

  it('shows the late head file, takes the head live and draws the body', async () => {
    const warn = vi.spyOn(console, 'warn');
    const h = await wocVisualHarness({ headPack: true, held: [QUIFF] });
    const c = context();
    const v = new h.CharacterVisual(KEY, 0xffffff, 0);
    const wrap = v.root.getObjectByName('character_model_wrap');
    v.setFarBakeGate(c.gate);
    v.setWocHeadLook({ ...h.DEFAULT_APPEARANCE, headHair: 'quiff' });
    v.update(0.05, IDLE, true);
    // its hairstyle still streams: no head, so no body
    expect(v.wocHeadLook).toBeNull();
    expect(wrap?.visible).toBe(false);
    h.releases.get(QUIFF)?.();
    await vi.waitFor(() => expect(h.heads.wocHeadFileResident(QUIFF)).toBe(true));
    // the frame the file lands: hung hidden, its warm asked of the preview context
    v.update(0.05, IDLE, true);
    await flush();
    expect(c.warms.length).toBeGreaterThan(0);
    expect(wrap?.visible).toBe(false);
    // the context rejects every warm of it
    warn.mockImplementation(() => undefined);
    for (const warm of c.warms.splice(0)) warm.fail(new Error('context lost'));
    await flush();
    v.update(0.05, IDLE, true);
    v.update(0.05, IDLE, true);
    // reported, not swallowed: the head is live on the look that was picked, and the body
    // it was hidden for is drawn (the file links on its first draw: a late link beats a
    // preview with nobody in it)
    expect(v.wocHeadLook?.look.hair).toBe('quiff');
    expect(wrap?.visible).toBe(true);
    v.dispose();
  }, 60000);
});
