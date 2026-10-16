// @vitest-environment jsdom
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

// The live getters must never block the calling frame: on a cache miss they
// answer null and kick the ASYNC capture (the prewarm twin), then fire the
// update listeners so the chips and the painter hydrate. The offscreen WebGL
// rig is faked here; everything else (the lane, the prewarm order, the encode)
// is the real module.
//
// Every queued encode is TAGGED with the visual that was on the rig when its
// frame was drawn (render and the toBlob snapshot are one synchronous window,
// so the pairing is exact), and each case settles the captures it started.
// Nothing here may depend on how many turns a capture takes to reach its
// encode, or on which case queued first.
const rig = vi.hoisted(() => ({
  builds: [] as string[],
  renders: 0,
  drawn: '',
  encodes: [] as Array<{ tag: string; cb: (blob: Blob | null) => void }>,
  /** Every default-kit dressing a capture asked of its visual: [visual key, helm hidden]. */
  dressings: [] as Array<[string, boolean]>,
}));

/** What jsdom's FileReader makes of the fake toBlob payload below. */
const ASYNC_URL = 'data:image/png;base64,cG5n';

vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal<typeof import('three')>();
  class FakeWebGLRenderer {
    debug = { checkShaderErrors: true };
    shadowMap = { enabled: true };
    domElement: HTMLCanvasElement;
    constructor(params: { canvas: HTMLCanvasElement }) {
      this.domElement = params.canvas;
      // Every capture, class-keyed or composed, snapshots through toBlob: no
      // portrait path reads the canvas back synchronously any more.
      this.domElement.toBlob = ((cb: (blob: Blob | null) => void) => {
        rig.encodes.push({ tag: rig.drawn, cb });
      }) as HTMLCanvasElement['toBlob'];
    }
    setPixelRatio() {}
    setSize() {}
    initTexture() {}
    compileAsync() {
      return Promise.resolve();
    }
    render(scene: { traverse(cb: (o: { userData: Record<string, unknown> }) => void): void }) {
      rig.renders++;
      rig.drawn = '';
      scene.traverse((o) => {
        if (typeof o.userData.tag === 'string') rig.drawn = o.userData.tag;
      });
    }
    forceContextLoss() {}
    dispose() {}
  }
  return { ...actual, WebGLRenderer: FakeWebGLRenderer };
});

vi.mock('../src/render/assets/preload', () => ({
  assetsReady: () => Promise.resolve(),
  registerPreload: vi.fn(),
  registerDeferredPreload: vi.fn((start: () => unknown) => start()),
}));
vi.mock('../src/render/characters/assets', () => ({
  ensureSkinTexture: () => null,
  // every body resident: the streamed-WOC wait (trackWocFilesPending) never holds a capture here
  visualAssetsResident: () => true,
  onCharacterAssetReady: () => () => undefined,
}));
vi.mock('../src/render/characters/woc_armor_dressing', () => ({ wocPortraitKit: () => [] }));
// the split head files: every one resident unless a case HOLDS it, each fetch kicked for a
// missing one recorded, the ready listeners the case fires when a held file lands
const heads = vi.hoisted(() => ({
  held: new Set<string>(),
  kicked: [] as string[],
  ready: new Set<(url: string) => void>(),
}));
vi.mock('../src/render/characters/woc_head_packs', async () => {
  const { wocHeadAppearanceUrls } = await import('../src/render/characters/woc_head_stream_core');
  const { wocHeadTypeForGender } = await import('../src/render/characters/woc_head_catalog');
  const urlsOf = (fit: string, app: unknown) =>
    wocHeadAppearanceUrls(app as Record<string, unknown>, wocHeadTypeForGender(fit));
  return {
    // the head measure (woc_portrait_bounds.ts) finds hung pieces by this wrapper tag
    WOC_HEAD_WRAPPER: 'wocHeadPack',
    ensureWocHeadForAppearance: (fit: string, app: unknown) => {
      const missing = urlsOf(fit, app).filter((u) => heads.held.has(u));
      heads.kicked.push(...missing);
      return missing.length === 0;
    },
    wocHeadAppearanceResident: (fit: string, app: unknown) =>
      urlsOf(fit, app).every((u) => !heads.held.has(u)),
    onWocHeadFileReady: (listener: (url: string) => void) => {
      heads.ready.add(listener);
      return () => heads.ready.delete(listener);
    },
  };
});
// Partial on purpose: characters/manifest.ts now pulls npc_looks, which reads
// NEUTRAL_FACE from this module at load time, so the real exports stay and only
// the signature this test keys its cache on is faked.
vi.mock('../src/render/characters/modular', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/render/characters/modular')>()),
  modularSignature: (app: { sig?: string }) => app?.sig ?? 'sig',
}));
vi.mock('../src/render/texture_prewarm', () => ({
  collectPrewarmTextures: () => undefined,
  uploadTexturesInSlices: () => Promise.resolve(),
  yieldToMainThread: () => Promise.resolve(),
}));
vi.mock('../src/render/characters/visual', async () => {
  const THREE = await import('three');
  return {
    CharacterVisual: class {
      root = new THREE.Object3D();
      private readonly visualKey: string;
      constructor(
        visualKey: string,
        _color: number,
        skin = 0,
        _weapon?: unknown,
        _offhand?: unknown,
        _form?: unknown,
        look?: { app?: { sig?: string } },
      ) {
        this.visualKey = visualKey;
        rig.builds.push(visualKey);
        this.root.userData.tag = look
          ? `${visualKey}:mod:${look.app?.sig}`
          : `${visualKey}:${skin}`;
      }
      // The WOC head a class capture is dressed in: tagged by its hairstyle, so
      // an encode names the head the frame was drawn with.
      setWocHeadLook(app?: { headHair?: string }) {
        this.root.userData.tag += `:head:${app?.headHair ?? '?'}`;
        return true;
      }
      setWocDefaultEquipment(helmHidden: boolean) {
        rig.dressings.push([this.visualKey, helmHidden]);
        return true;
      }
      update() {}
      dispose() {}
    },
  };
});

import { DEFAULT_APPEARANCE, type ModularLook } from '../src/render/characters/modular';
import {
  COMPOSED_PORTRAIT_SKIN,
  cachedPortraitByKey,
  cachedPortraitDataUrl,
  composedPortraitKey,
  isComposedPortraitKey,
  MODULAR_PORTRAIT_CACHE_MAX,
  modularPortraitDataUrl,
  onPortraitUpdate,
  playerPortraitDataUrl,
  portraitsReady,
  resetPortraitRendererForGraphicsRebuild,
  visualPortraitDataUrl,
  visualPortraitKey,
} from '../src/render/characters/portrait';
import { PORTRAIT_CAPTURE_RETRY_BASE_MS } from '../src/render/characters/portrait_capture_lane_core';
import { WOC_HEAD_MORPH_KEYS } from '../src/render/characters/woc_head_catalog';
import { setGpuPrepClockForTest } from '../src/render/gpu_prep_events';

// The retry backoff is measured against the render-wide gpu-prep clock, so the
// cases below step time instead of racing a real one.
const clock = { now: 100_000 };

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

// A composed look is identified here by the one field the faked
// modularSignature reads, so each case picks its own cache key and its own
// encode tag.
const MODULAR_KEY = 'player_warrior_modular';
const lookOf = (sig: string): ModularLook => ({ app: { sig }, worn: {} }) as unknown as ModularLook;
const modTag = (sig: string) => `${MODULAR_KEY}:mod:${sig}`;
const modKey = (sig: string) => `${MODULAR_KEY}:mod:${sig}:headshot`;

/** Hand the capture drawn from `tag` its PNG (or fail its encode). Waits for
 *  that capture to reach its encode, so no case depends on how many turns the
 *  build/upload/compile chain took. */
async function settleCapture(tag: string, ok = true): Promise<void> {
  await vi.waitFor(() => expect(rig.encodes.some((e) => e.tag === tag)).toBe(true));
  const index = rig.encodes.findIndex((e) => e.tag === tag);
  const [entry] = rig.encodes.splice(index, 1);
  entry.cb(ok ? new Blob(['png'], { type: 'image/png' }) : null);
}

afterAll(() => setGpuPrepClockForTest(null));

describe('live portrait capture', () => {
  beforeEach(async () => {
    setGpuPrepClockForTest(() => clock.now);
    await vi.waitFor(() => expect(portraitsReady()).toBe(true));
    // Each case settles what it started, so a leftover here would mean one
    // case could settle another's capture: fail loudly instead.
    expect(rig.encodes).toEqual([]);
    rig.builds.length = 0;
    rig.renders = 0;
    rig.dressings.length = 0;
  });

  it('answers null on a miss and kicks ONE async capture for a crowd of the same class', async () => {
    for (let i = 0; i < 20; i++) expect(playerPortraitDataUrl('mage')).toBeNull();
    await vi.waitFor(() => expect(rig.encodes).toHaveLength(1));

    expect(rig.builds).toEqual(['player_mage']);
    expect(rig.renders).toBe(1);
    // A further ask while that capture is still in flight adds no capture: the
    // duplicate would build synchronously inside the next microtask turn.
    expect(playerPortraitDataUrl('mage')).toBeNull();
    await flush();
    expect(rig.builds).toEqual(['player_mage']);

    await settleCapture('player_mage:0');
    await vi.waitFor(() => expect(playerPortraitDataUrl('mage')).toBe(ASYNC_URL));
  });

  it('fills the cache, fires the update listeners, and then answers synchronously', async () => {
    const updated = vi.fn();
    onPortraitUpdate(updated);
    expect(playerPortraitDataUrl('rogue')).toBeNull();

    await settleCapture('player_rogue:0');
    await vi.waitFor(() => expect(updated).toHaveBeenCalledWith('player_rogue', 0));

    expect(playerPortraitDataUrl('rogue')).toBe(ASYNC_URL);
    // The cache hit captures nothing more.
    await flush();
    expect(rig.builds).toEqual(['player_rogue']);
  });

  it('keys the capture, so another skin or framing is its own miss', async () => {
    expect(visualPortraitDataUrl('player_mech', 2)).toBeNull();
    expect(visualPortraitDataUrl('player_mech', 2, 'body')).toBeNull();
    expect(visualPortraitDataUrl('player_mech', 3)).toBeNull();
    await vi.waitFor(() => expect(rig.encodes).toHaveLength(3));

    expect(rig.builds).toEqual(['player_mech', 'player_mech', 'player_mech']);
    await settleCapture('player_mech:2');
    await settleCapture('player_mech:2');
    await settleCapture('player_mech:3');
    await vi.waitFor(() => {
      expect(visualPortraitDataUrl('player_mech', 2)).toBe(ASYNC_URL);
      expect(visualPortraitDataUrl('player_mech', 2, 'body')).toBe(ASYNC_URL);
      expect(visualPortraitDataUrl('player_mech', 3)).toBe(ASYNC_URL);
    });
  });

  it('caches nothing, notifies nobody, and BACKS OFF a key whose capture failed', async () => {
    const updated = vi.fn();
    onPortraitUpdate(updated);
    expect(playerPortraitDataUrl('druid')).toBeNull();

    await settleCapture('player_druid:0', false);
    // Wait for the lane to retire the key, then keep asking: every consumer
    // asks once per frame while it draws its crest, and without a cooldown
    // each of those asks re-kicks the whole 43 to 201 ms capture.
    await flush();
    for (let i = 0; i < 5; i++) expect(playerPortraitDataUrl('druid')).toBeNull();
    clock.now += PORTRAIT_CAPTURE_RETRY_BASE_MS - 1;
    expect(playerPortraitDataUrl('druid')).toBeNull();
    await flush();
    expect(rig.builds).toEqual(['player_druid']);
    expect(rig.encodes).toEqual([]);
    expect(updated).not.toHaveBeenCalled();

    // Past the cooldown, exactly one retry, which lands.
    clock.now += 1;
    expect(playerPortraitDataUrl('druid')).toBeNull();
    await vi.waitFor(() => expect(rig.builds).toEqual(['player_druid', 'player_druid']));

    await settleCapture('player_druid:0');
    await vi.waitFor(() => expect(updated).toHaveBeenCalledWith('player_druid', 0));
    expect(playerPortraitDataUrl('druid')).toBe(ASYNC_URL);
  });

  it('a graphics rebuild clears the backoff, so the next ask captures at once', async () => {
    expect(playerPortraitDataUrl('priest')).toBeNull();
    await settleCapture('player_priest:0', false);
    await flush();
    expect(playerPortraitDataUrl('priest')).toBeNull();
    await flush();
    expect(rig.builds).toEqual(['player_priest']);

    // The rebuild swapped the rig: a key that failed against the old one gets
    // a fresh attempt against the new one, with no cooldown left to wait out.
    resetPortraitRendererForGraphicsRebuild();
    expect(playerPortraitDataUrl('priest')).toBeNull();
    await vi.waitFor(() => expect(rig.builds).toEqual(['player_priest', 'player_priest']));
    await settleCapture('player_priest:0');
    await vi.waitFor(() => expect(playerPortraitDataUrl('priest')).toBe(ASYNC_URL));
  });

  it('answers null on a COMPOSED miss and kicks ONE async capture', async () => {
    const look = lookOf('one');
    // The char sheet and the player frame both ask, every frame they paint.
    for (let i = 0; i < 5; i++) expect(modularPortraitDataUrl(MODULAR_KEY, look)).toBeNull();
    await vi.waitFor(() => expect(rig.encodes).toHaveLength(1));

    expect(rig.builds).toEqual([MODULAR_KEY]);
    expect(rig.renders).toBe(1);
    await settleCapture(modTag('one'));
    await vi.waitFor(() => expect(modularPortraitDataUrl(MODULAR_KEY, look)).toBe(ASYNC_URL));
  });

  it('dedupes a composed capture by look SIGNATURE, not by look object', async () => {
    // Two asks for the same appearance (the sheet holds its own ModularLook,
    // the player frame resolves another) are one capture; a changed slider is
    // its own.
    expect(modularPortraitDataUrl(MODULAR_KEY, lookOf('same'))).toBeNull();
    expect(modularPortraitDataUrl(MODULAR_KEY, lookOf('same'))).toBeNull();
    expect(modularPortraitDataUrl(MODULAR_KEY, lookOf('other'))).toBeNull();
    await vi.waitFor(() => expect(rig.encodes).toHaveLength(2));

    expect(rig.builds).toEqual([MODULAR_KEY, MODULAR_KEY]);
    await settleCapture(modTag('same'));
    await settleCapture(modTag('other'));
    await vi.waitFor(() => {
      expect(modularPortraitDataUrl(MODULAR_KEY, lookOf('same'))).toBe(ASYNC_URL);
      expect(modularPortraitDataUrl(MODULAR_KEY, lookOf('other'))).toBe(ASYNC_URL);
    });
  });

  it('fills the cache and notifies with the composed KEY, which is what names it', async () => {
    const updated = vi.fn();
    onPortraitUpdate(updated);
    const look = lookOf('notify');
    expect(modularPortraitDataUrl(MODULAR_KEY, look)).toBeNull();

    await settleCapture(modTag('notify'));
    // No (class, skin) pair describes a composed body, so the cache key is the
    // third argument and the skin is the non-index COMPOSED_PORTRAIT_SKIN.
    // Pinned to the literal: a listener that indexes a catalog by it must get
    // a miss, which only a value no catalog holds guarantees.
    expect(COMPOSED_PORTRAIT_SKIN).toBe(-1);
    await vi.waitFor(() =>
      expect(updated).toHaveBeenCalledWith(MODULAR_KEY, COMPOSED_PORTRAIT_SKIN, modKey('notify')),
    );
    expect(modularPortraitDataUrl(MODULAR_KEY, look)).toBe(ASYNC_URL);
    // The key a consumer derives to recognize that landing IS the reported
    // key, and the by-key peek answers the same entry: the two halves of the
    // frame and chip matching, exercised against the real module.
    expect(composedPortraitKey(MODULAR_KEY, look)).toBe(modKey('notify'));
    expect(cachedPortraitByKey(modKey('notify'))).toBe(ASYNC_URL);
    expect(cachedPortraitByKey(modKey('never-captured'))).toBeNull();
  });

  it('keeps two-argument listeners valid across a composed update', async () => {
    // The widening is source-compatible on purpose: portrait_chip, main.ts and
    // the skin-event controller all subscribe with (visualKey, skin).
    const seen: Array<[string, number]> = [];
    const legacy = (visualKey: string, skin: number): void => {
      seen.push([visualKey, skin]);
    };
    onPortraitUpdate(legacy);
    expect(modularPortraitDataUrl(MODULAR_KEY, lookOf('legacy'))).toBeNull();

    await settleCapture(modTag('legacy'));
    await vi.waitFor(() => expect(seen).toContainEqual([MODULAR_KEY, COMPOSED_PORTRAIT_SKIN]));
  });

  it('BACKS OFF a composed key whose capture cached nothing', async () => {
    const look = lookOf('backoff');
    expect(modularPortraitDataUrl(MODULAR_KEY, look)).toBeNull();

    await settleCapture(modTag('backoff'), false);
    await flush();
    for (let i = 0; i < 5; i++) expect(modularPortraitDataUrl(MODULAR_KEY, look)).toBeNull();
    clock.now += PORTRAIT_CAPTURE_RETRY_BASE_MS - 1;
    expect(modularPortraitDataUrl(MODULAR_KEY, look)).toBeNull();
    await flush();
    expect(rig.builds).toEqual([MODULAR_KEY]);
    expect(rig.encodes).toEqual([]);

    clock.now += 1;
    expect(modularPortraitDataUrl(MODULAR_KEY, look)).toBeNull();
    await vi.waitFor(() => expect(rig.builds).toEqual([MODULAR_KEY, MODULAR_KEY]));
    await settleCapture(modTag('backoff'));
    await vi.waitFor(() => expect(modularPortraitDataUrl(MODULAR_KEY, look)).toBe(ASYNC_URL));
  });

  it('still bounds the composed cache: the oldest look is evicted past the cap', async () => {
    // A creation session drags a colour wheel around, so the key space is
    // unbounded and only the FIFO keeps the PNGs off the heap.
    const sigs = Array.from({ length: MODULAR_PORTRAIT_CACHE_MAX + 1 }, (_, i) => `cap${i}`);
    for (const sig of sigs) expect(modularPortraitDataUrl(MODULAR_KEY, lookOf(sig))).toBeNull();
    await vi.waitFor(() => expect(rig.encodes).toHaveLength(sigs.length));
    for (const sig of sigs) await settleCapture(modTag(sig));

    await vi.waitFor(() =>
      expect(modularPortraitDataUrl(MODULAR_KEY, lookOf('cap1'))).toBe(ASYNC_URL),
    );
    expect(modularPortraitDataUrl(MODULAR_KEY, lookOf('cap0'))).toBeNull();
    // That miss kicked its own capture; settle it so no case inherits one.
    await settleCapture(modTag('cap0'));
  });

  it('keeps a look a frame keeps asking for: a hit re-touches it past newer entries', async () => {
    // A targeted crowd wider than the cap: under plain FIFO the viewer's own
    // face, asked for every paint, would be evicted by the newcomers and
    // re-captured on every pass.
    const sigs = Array.from({ length: MODULAR_PORTRAIT_CACHE_MAX }, (_, i) => `lru${i}`);
    for (const sig of sigs) expect(modularPortraitDataUrl(MODULAR_KEY, lookOf(sig))).toBeNull();
    await vi.waitFor(() => expect(rig.encodes).toHaveLength(sigs.length));
    for (const sig of sigs) await settleCapture(modTag(sig));
    await vi.waitFor(() =>
      expect(modularPortraitDataUrl(MODULAR_KEY, lookOf('lru0'))).toBe(ASYNC_URL),
    );
    // The oldest entry is asked for again (touched), then one more look lands.
    expect(modularPortraitDataUrl(MODULAR_KEY, lookOf('lru0'))).toBe(ASYNC_URL);
    expect(modularPortraitDataUrl(MODULAR_KEY, lookOf('lruNew'))).toBeNull();
    await settleCapture(modTag('lruNew'));
    await vi.waitFor(() =>
      expect(modularPortraitDataUrl(MODULAR_KEY, lookOf('lruNew'))).toBe(ASYNC_URL),
    );
    expect(cachedPortraitByKey(modKey('lru0'))).toBe(ASYNC_URL);
    // The least-recently-asked entry went instead.
    expect(cachedPortraitByKey(modKey('lru1'))).toBeNull();
  });

  it('a graphics rebuild clears the composed FIFO, so a re-captured look survives', async () => {
    // The rebuild clears the cache; a FIFO left holding those dead keys evicts
    // the fresh entry a re-captured look just committed, under its own name.
    const sigs = Array.from({ length: MODULAR_PORTRAIT_CACHE_MAX }, (_, i) => `rb${i}`);
    for (const sig of sigs) expect(modularPortraitDataUrl(MODULAR_KEY, lookOf(sig))).toBeNull();
    await vi.waitFor(() => expect(rig.encodes).toHaveLength(sigs.length));
    for (const sig of sigs) await settleCapture(modTag(sig));
    await vi.waitFor(() =>
      expect(modularPortraitDataUrl(MODULAR_KEY, lookOf('rb0'))).toBe(ASYNC_URL),
    );

    resetPortraitRendererForGraphicsRebuild();
    expect(modularPortraitDataUrl(MODULAR_KEY, lookOf('rb0'))).toBeNull();
    await settleCapture(modTag('rb0'));
    await vi.waitFor(() =>
      expect(modularPortraitDataUrl(MODULAR_KEY, lookOf('rb0'))).toBe(ASYNC_URL),
    );
  });

  // A WOC class body wears its player's modular head: the live portrait keys
  // on that head, and a default head keeps the key it had before heads.
  const LONG_HAIR = { ...DEFAULT_APPEARANCE, headHair: 'long' };

  it('keeps the pre-head key for a default or absent head, and appends the head otherwise', () => {
    expect(visualPortraitKey('player_warrior', 0)).toBe('player_warrior:0:headshot');
    expect(visualPortraitKey('player_warrior', 0, 'headshot', null)).toBe(
      'player_warrior:0:headshot',
    );
    expect(visualPortraitKey('player_warrior', 0, 'headshot', DEFAULT_APPEARANCE)).toBe(
      'player_warrior:0:headshot',
    );
    const key = visualPortraitKey('player_warrior', 1, 'body', LONG_HAIR);
    expect(key.startsWith('player_warrior:1:body:head:a.long.')).toBe(true);
    // never mistaken for a composed capture
    expect(isComposedPortraitKey(key)).toBe(false);
    // a body with no modular head ignores the appearance entirely
    expect(visualPortraitKey('player_mech', 2, 'headshot', LONG_HAIR)).toBe(
      'player_mech:2:headshot',
    );
  });

  it('dresses a head-keyed capture in that head and files it under the head key only', async () => {
    const updated = vi.fn();
    onPortraitUpdate(updated);
    expect(visualPortraitDataUrl('player_warrior', 7, 'headshot', LONG_HAIR)).toBeNull();
    await settleCapture('player_warrior:7:head:long');
    await vi.waitFor(() =>
      expect(visualPortraitDataUrl('player_warrior', 7, 'headshot', LONG_HAIR)).toBe(ASYNC_URL),
    );
    // reported by (visual, skin), so every frame holding that body re-asks with its own head
    expect(updated).toHaveBeenCalledWith('player_warrior', 7);
    // the default face is still its own entry: a custom head never answers for it
    expect(cachedPortraitDataUrl('player_warrior', 7)).toBeNull();
    expect(rig.builds).toEqual(['player_warrior']);
  });

  it('shares ONE capture between a default head and no head, and never dresses it', async () => {
    expect(visualPortraitDataUrl('player_warrior', 8, 'headshot', DEFAULT_APPEARANCE)).toBeNull();
    expect(visualPortraitDataUrl('player_warrior', 8)).toBeNull();
    await vi.waitFor(() => expect(rig.encodes).toHaveLength(1));
    expect(rig.encodes[0].tag).toBe('player_warrior:8');
    await settleCapture('player_warrior:8');
    await vi.waitFor(() => expect(visualPortraitDataUrl('player_warrior', 8)).toBe(ASYNC_URL));
    expect(visualPortraitDataUrl('player_warrior', 8, 'headshot', DEFAULT_APPEARANCE)).toBe(
      ASYNC_URL,
    );
  });

  it('bounds the head-keyed entries with the composed cap: the oldest head is evicted', async () => {
    // distinct heads by face controls, one signature step (0.05) apart
    const [k0, k1] = WOC_HEAD_MORPH_KEYS;
    const heads = Array.from({ length: MODULAR_PORTRAIT_CACHE_MAX + 1 }, (_, i) => ({
      ...LONG_HAIR,
      headShape: { [k0]: ((i % 40) - 20) / 20, [k1]: Math.floor(i / 40) / 20 },
    }));
    const keys = new Set(heads.map((h) => visualPortraitKey('player_warrior', 9, 'headshot', h)));
    expect(keys.size).toBe(heads.length);
    for (const h of heads) {
      expect(visualPortraitDataUrl('player_warrior', 9, 'headshot', h)).toBeNull();
    }
    await vi.waitFor(() => expect(rig.encodes).toHaveLength(heads.length));
    for (let i = 0; i < heads.length; i++) await settleCapture('player_warrior:9:head:long');
    const last = heads[heads.length - 1];
    await vi.waitFor(() =>
      expect(visualPortraitDataUrl('player_warrior', 9, 'headshot', last)).toBe(ASYNC_URL),
    );
    expect(cachedPortraitByKey(visualPortraitKey('player_warrior', 9, 'headshot', heads[0]))).toBe(
      null,
    );
    expect(cachedPortraitByKey(visualPortraitKey('player_warrior', 9, 'headshot', heads[1]))).toBe(
      ASYNC_URL,
    );
  });

  it('waits for exactly the head files its look draws, never the library, then captures', async () => {
    const MOHAWK = { ...DEFAULT_APPEARANCE, headHair: 'mohawk' };
    const mohawk = 'models/chars/players/woc/head_type_a_hair_mohawk.glb';
    heads.held.add(mohawk);
    heads.kicked.length = 0;
    const updated = vi.fn();
    onPortraitUpdate(updated);
    expect(visualPortraitDataUrl('player_warrior', 13, 'headshot', MOHAWK)).toBeNull();
    await flush();
    // nothing is built while its hairstyle streams, and only that file was asked for
    expect(rig.builds).toEqual([]);
    expect(heads.kicked).toEqual([mohawk]);
    // a default head on the same body needs none of it: it captures meanwhile
    expect(visualPortraitDataUrl('player_warrior', 14)).toBeNull();
    await settleCapture('player_warrior:14');
    // the file lands: the consumers are told to re-ask, and the re-ask captures that head
    heads.held.delete(mohawk);
    for (const listener of heads.ready) listener(mohawk);
    expect(updated).toHaveBeenCalledWith('player_warrior', 13);
    expect(visualPortraitDataUrl('player_warrior', 13, 'headshot', MOHAWK)).toBeNull();
    await settleCapture('player_warrior:13:head:mohawk');
    await vi.waitFor(() =>
      expect(visualPortraitDataUrl('player_warrior', 13, 'headshot', MOHAWK)).toBe(ASYNC_URL),
    );
    expect(heads.kicked).toEqual([mohawk]);
  });

  it('wakes EVERY skin waiting on the same body when its head file lands', async () => {
    const QUIFF = { ...DEFAULT_APPEARANCE, headHair: 'quiff' };
    const quiff = 'models/chars/players/woc/head_type_a_hair_quiff.glb';
    heads.held.add(quiff);
    const updated = vi.fn();
    onPortraitUpdate(updated);
    expect(visualPortraitDataUrl('player_warrior', 15, 'headshot', QUIFF)).toBeNull();
    expect(visualPortraitDataUrl('player_warrior', 16, 'headshot', QUIFF)).toBeNull();
    heads.held.delete(quiff);
    for (const listener of heads.ready) listener(quiff);
    // both chips hydrate by their own (body, skin), so both are told to re-ask
    expect(updated).toHaveBeenCalledWith('player_warrior', 15);
    expect(updated).toHaveBeenCalledWith('player_warrior', 16);
  });

  it('never dresses a capture through the visual dressing API, which streams armor', async () => {
    // Every CharacterVisual dressing setter reaches WocArmorDressing.want, which fetches
    // the LIVE tier's armor: a portrait's kit is the no-fetch one it waited for, so the
    // helm comes off portrait-side instead (woc_portrait_bounds.ts uncoverWocPortraitHead).
    expect(visualPortraitDataUrl('player_warrior', 11, 'headshot', LONG_HAIR)).toBeNull();
    await settleCapture('player_warrior:11:head:long');
    expect(visualPortraitDataUrl('player_warrior', 12)).toBeNull();
    await settleCapture('player_warrior:12');
    expect(visualPortraitDataUrl('player_mech', 11)).toBeNull();
    await settleCapture('player_mech:11');
    expect(rig.dressings).toEqual([]);
  });
});
