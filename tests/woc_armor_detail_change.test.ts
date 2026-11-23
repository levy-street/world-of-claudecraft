import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WocCharacterManifest } from '../src/render/characters/woc_character_manifest';

// A LIVE body changing its armor detail (woc_armor_dressing.ts setDetail, 2026-10-05): what a
// preview asks when its character is chosen in the creator, or when its stage changes hands
// (preview_armor_detail_core.ts). The change asks for nothing by itself: it takes effect with
// the body's next dressing (so a stage that changes hands asks at the new detail for the sets
// it shows NOW, never for the ones the body wore) or its next poll. The step up is then the
// local player's own streaming path, begun later: the medium file keeps drawing until the high
// pack's reveal settles. The step down is what makes a choice cancellable: it stops waiting on
// a top file still streaming, takes off a replacement that never drew, and gives the high pack
// back once the medium file draws again. Through the real store and the real dressing; only the
// loader and the graphics profile are stubbed, the host's compile gate held open until the case
// settles it.

/** A body with a kit of its own (`test`) and one piece of another set (`other`): what a worn
 *  item whose display row points at another set adds to a character. */
const manifest: WocCharacterManifest = {
  schemaVersion: 1,
  rigId: 'detail-change-fixture',
  fit: 'male',
  baseNodes: ['Character_Body'],
  appearance: {},
  defaultAppearance: {},
  armorSlots: { head: { label: 'Head' }, arms: { label: 'Arms' }, waist: { label: 'Waist' } },
  items: {
    male_test_helm: { label: 'Helm', slot: 'head', set: 'test', nodes: ['Armor_Test_Helm'] },
    male_test_shoulders: {
      label: 'Shoulders',
      slot: 'arms',
      set: 'test',
      nodes: ['Armor_Test_Shoulder_L'],
    },
    male_other_waist: { label: 'Waist', slot: 'waist', set: 'other', nodes: ['Armor_Other_Waist'] },
  },
  defaultEquipment: { head: 'male_test_helm', arms: 'male_test_shoulders', waist: null },
  animationNames: [],
};

function bones(): { root: THREE.Group; spine: THREE.Bone; list: THREE.Bone[] } {
  const root = new THREE.Group();
  const hips = new THREE.Bone();
  hips.name = 'root';
  const spine = new THREE.Bone();
  spine.name = 'spine';
  spine.position.set(0, 1, 0);
  root.add(hips);
  hips.add(spine);
  root.updateMatrixWorld(true);
  return { root, spine, list: [hips, spine] };
}

function tri(): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute(
    'position',
    new THREE.Float32BufferAttribute([0, 1, 0, 0.2, 1.2, 0, -0.2, 1.4, 0], 3),
  );
  g.setAttribute(
    'skinIndex',
    new THREE.Uint16BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 4),
  );
  g.setAttribute(
    'skinWeight',
    new THREE.Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 4),
  );
  return g;
}

/** The character: a base body on the rig. */
function model(): THREE.Group {
  const r = bones();
  const body = new THREE.SkinnedMesh(tri(), new THREE.MeshBasicMaterial());
  body.name = 'Character_Body';
  r.root.add(body);
  body.bind(new THREE.Skeleton(r.list));
  return r.root;
}

interface Level {
  data: Uint8Array;
  width: number;
  height: number;
}

function chain(width: number, height: number, levels = 99): Level[] {
  const out: Level[] = [];
  let w = width;
  let h = height;
  while (out.length < levels) {
    out.push({ data: new Uint8Array(Math.max(16, w * h)).fill(w), width: w, height: h });
    if (w === 1 && h === 1) break;
    w = Math.max(1, w >> 1);
    h = Math.max(1, h >> 1);
  }
  return out;
}

function compressed(name: string, levels: Level[]): THREE.CompressedTexture {
  const t = new THREE.CompressedTexture(
    levels as unknown as THREE.CompressedTextureMipmap[],
    levels[0].width,
    levels[0].height,
    THREE.RGBA_ASTC_4x4_Format,
    THREE.UnsignedByteType,
  );
  t.name = name;
  t.needsUpdate = true;
  return t;
}

/** A set's low or medium file: its parts (a skinned one and a rigid one for the `test` kit,
 *  one rigid part for the `other` set) on one material. */
function fileOf(set: string) {
  const r = bones();
  const material = new THREE.MeshStandardMaterial({
    name: set,
    map: compressed('full_color_atlas', chain(8, 4)),
  });
  const rigid = (name: string): void => {
    const part = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), material);
    part.name = name;
    r.spine.add(part);
  };
  if (set === 'other') {
    rigid('Armor_Other_Waist');
    return { scene: r.root, animations: [] };
  }
  const helm = new THREE.SkinnedMesh(tri(), material);
  helm.name = 'Armor_Test_Helm';
  r.root.add(helm);
  helm.bind(new THREE.Skeleton(r.list));
  rigid('Armor_Test_Shoulder_L');
  return { scene: r.root, animations: [] };
}

/** A set's top file: the top level of its medium file's one map, on one degenerate mesh. */
function topFile() {
  const root = new THREE.Group();
  const mesh = new THREE.Mesh(
    new THREE.BufferGeometry(),
    new THREE.MeshStandardMaterial({ map: compressed('full_color_atlas', chain(16, 8, 1)) }),
  );
  mesh.name = 'top_levels';
  root.add(mesh);
  return { scene: root, animations: [] };
}

async function harness(tier: 'low' | 'medium' | 'high', constrainedMemory = false) {
  vi.resetModules();
  const pending = new Map<string, (value: unknown) => void>();
  const fetches: string[] = [];
  vi.doMock('../src/render/gfx', () => ({
    GFX: { tier, constrainedMemory, anisotropy: 8, normalAnisotropy: 4 },
  }));
  vi.doMock('../src/render/assets/loader', () => ({
    loadGltf: vi.fn(
      (url: string) =>
        new Promise((resolve) => {
          fetches.push(url);
          pending.set(url, resolve);
        }),
    ),
    releaseGltf: vi.fn(),
  }));
  const packs = await import('../src/render/characters/woc_armor_packs');
  const core = await import('../src/render/characters/woc_armor_core');
  const dressing = await import('../src/render/characters/woc_armor_dressing');
  let now = 0;
  packs.setWocArmorClockForTest(() => now);
  const url = (fileTier: 'low' | 'medium' | 'high', set = 'test') =>
    core.wocArmorPackUrl('male', set, fileTier);
  const linking: (() => void)[] = [];
  const host = {
    model: model(),
    adopt: vi.fn((_node: THREE.Object3D): void => undefined),
    forget: vi.fn((_node: THREE.Object3D): void => undefined),
    // the visual's compile gate: hidden until its link settles, and a settle of a node
    // detached meanwhile is dropped (CharacterVisual.revealOnCompile)
    reveal: vi.fn((node: THREE.Object3D, live?: (prepared: boolean) => void): void => {
      node.visible = false;
      linking.push(() => {
        if (node.parent === null) return;
        node.visible = true;
        live?.(true);
      });
    }),
    rigDrawn: (): boolean => true,
  };
  /** The attached containers by file, and whether each draws (its Group of skinned parts). */
  const drawn = (): Record<string, boolean> => {
    const out: Record<string, boolean> = {};
    for (const container of packs.wocArmorContainers(host.model)) {
      out[String(container.userData[packs.WOC_ARMOR_CONTAINER])] = container.visible;
    }
    return out;
  };
  /** Every reveal in flight settles. */
  const settle = (): void => {
    for (const reveal of linking.splice(0)) reveal();
  };
  /** One file lands (it must be on its way), and everything its landing sets off has run. */
  const land = async (fileUrl: string): Promise<void> => {
    const resolve = pending.get(fileUrl);
    const parsed = core.parseWocArmorPackUrl(fileUrl);
    if (!resolve || !parsed) throw new Error(`no armor file is being fetched: ${fileUrl}`);
    pending.delete(fileUrl);
    resolve(parsed.tier === 'high' ? topFile() : fileOf(parsed.set));
    await new Promise<void>((done) => setTimeout(done, 0));
  };
  return {
    packs,
    core,
    dressing,
    host,
    fetches,
    url,
    low: url('low'),
    medium: url('medium'),
    high: url('high'),
    drawn,
    land,
    settle,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

type Harness = Awaited<ReturnType<typeof harness>>;

/** A body at the crowd's detail on the high preset, its medium file drawing. */
async function crowdBody(h: Harness) {
  const d = new h.dressing.WocArmorDressing(h.host, manifest, 'crowd');
  d.want(['test']);
  await h.land(h.medium);
  d.poll();
  h.settle();
  return d;
}

afterEach(() => {
  vi.doUnmock('../src/render/gfx');
  vi.doUnmock('../src/render/assets/loader');
  vi.resetModules();
});

describe('a live body stepping up to full detail', () => {
  it('asks for exactly its top file from its next poll, the medium file drawing until the high pack is revealed', async () => {
    const h = await harness('high');
    const d = await crowdBody(h);
    expect(h.fetches).toEqual([h.medium]);
    expect(h.drawn()).toEqual({ [h.medium]: true });

    // the change itself asks for nothing: the body's next dressing or poll does
    d.setDetail('full');
    expect(h.fetches).toEqual([h.medium]);
    // nothing to attach yet: the files are as they were, and the top file is on its way
    expect(d.poll()).toBe(false);
    expect(h.fetches).toEqual([h.medium, h.high]);
    expect(d.isWaiting).toBe(true);
    expect(d.attachedFiles).toEqual([{ set: 'test', url: h.medium }]);
    expect(h.drawn()).toEqual({ [h.medium]: true });

    // the top levels land: the high pack attaches HIDDEN while it links, the medium file
    // still the one that draws
    await h.land(h.high);
    expect(d.poll()).toBe(true);
    expect(h.drawn()).toEqual({ [h.medium]: true, [h.high]: false });
    expect(d.attachedFiles).toEqual([{ set: 'test', url: h.medium }]);

    // its reveal settles: one step, never a frame of neither file
    h.settle();
    expect(h.drawn()).toEqual({ [h.high]: true });
    expect(d.poll()).toBe(true);
    expect(d.attachedFiles).toEqual([{ set: 'test', url: h.high }]);
    expect(d.isWaiting).toBe(false);
    expect(h.packs.wocArmorPackRefs(h.high)).toBe(1);
    // the medium file's own wearer is gone; the high pack still holds it
    expect(h.packs.wocArmorPackRefs(h.medium)).toBe(1);
    d.dispose();
  });

  it('asks at the new detail for the sets of its NEXT dressing, never for the ones it wore', async () => {
    const h = await harness('high');
    // a body shown as someone else's character, who wears a piece of another set
    const d = new h.dressing.WocArmorDressing(h.host, manifest, 'crowd');
    d.want(['test', 'other']);
    await h.land(h.medium);
    await h.land(h.url('medium', 'other'));
    d.poll();
    h.settle();
    expect(h.drawn()).toEqual({ [h.medium]: true, [h.url('medium', 'other')]: true });

    // the stage changes hands: its detail first, then the sets of what it shows now
    d.setDetail('full');
    expect(d.want(['test'])).toBe(true);
    // the other character's set is taken off, and its top file was never asked for
    expect(h.fetches).toEqual([h.medium, h.url('medium', 'other'), h.high]);
    expect(h.drawn()).toEqual({ [h.medium]: true });
    d.dispose();
  });

  it('is a no-op on a repeat of the detail it draws', async () => {
    const h = await harness('high');
    const d = await crowdBody(h);
    d.setDetail('crowd');
    expect(d.isWaiting).toBe(false);
    expect(d.poll()).toBe(false);
    expect(h.fetches).toEqual([h.medium]);
    d.dispose();
  });
});

describe('a live body stepping back down to the crowd detail', () => {
  it('stops waiting on a top file still streaming, and its late landing attaches nowhere', async () => {
    const h = await harness('high');
    const d = await crowdBody(h);
    d.setDetail('full');
    d.poll();
    expect(h.fetches).toEqual([h.medium, h.high]);
    expect(d.isWaiting).toBe(true);

    // left before it landed: the medium file is the wanted one again
    d.setDetail('crowd');
    expect(d.poll()).toBe(false);
    expect(d.isWaiting).toBe(false);
    expect(d.attachedFiles).toEqual([{ set: 'test', url: h.medium }]);

    await h.land(h.high);
    expect(d.poll()).toBe(false);
    h.settle();
    expect(h.drawn()).toEqual({ [h.medium]: true });
    // nobody holds the pack that landed: it is the store's to free after its idle window,
    // and the medium file under it stays for the body that draws it
    expect(h.packs.wocArmorPackResident(h.high)).toBe(true);
    expect(h.packs.wocArmorPackRefs(h.high)).toBe(0);
    h.advance(h.core.WOC_ARMOR_IDLE_EVICT_MS);
    h.packs.sweepWocArmorPacks();
    expect(h.packs.wocArmorPackResident(h.high)).toBe(false);
    expect(h.packs.wocArmorPackResident(h.medium)).toBe(true);
    expect(h.packs.wocArmorPackRefs(h.medium)).toBe(1);
    d.dispose();
  });

  it('takes off a high pack still linking: it never draws, and its reference is given back', async () => {
    const h = await harness('high');
    const d = await crowdBody(h);
    d.setDetail('full');
    d.poll();
    await h.land(h.high);
    d.poll();
    expect(h.drawn()).toEqual({ [h.medium]: true, [h.high]: false });
    expect(h.packs.wocArmorPackRefs(h.high)).toBe(1);

    d.setDetail('crowd');
    expect(d.poll()).toBe(true);
    expect(h.drawn()).toEqual({ [h.medium]: true });
    expect(h.packs.wocArmorPackRefs(h.high)).toBe(0);
    // the link it was waiting on settles into nothing
    h.settle();
    expect(d.poll()).toBe(false);
    expect(h.drawn()).toEqual({ [h.medium]: true });
    expect(d.attachedFiles).toEqual([{ set: 'test', url: h.medium }]);
    d.dispose();
  });

  it('swaps a drawn high pack for the medium file without a gap, then lets the high pack go', async () => {
    const h = await harness('high');
    const d = await crowdBody(h);
    d.setDetail('full');
    d.poll();
    await h.land(h.high);
    d.poll();
    h.settle();
    d.poll();
    expect(h.drawn()).toEqual({ [h.high]: true });

    // the medium file is resident under the high pack: it attaches at once, hidden
    d.setDetail('crowd');
    expect(d.poll()).toBe(true);
    expect(h.fetches).toEqual([h.medium, h.high]);
    expect(h.drawn()).toEqual({ [h.high]: true, [h.medium]: false });
    h.settle();
    expect(h.drawn()).toEqual({ [h.medium]: true });
    expect(d.poll()).toBe(true);
    expect(d.attachedFiles).toEqual([{ set: 'test', url: h.medium }]);
    expect(h.packs.wocArmorPackRefs(h.high)).toBe(0);

    // choosing again: the high pack is still in memory, so it takes over with no fetch
    d.setDetail('full');
    expect(d.poll()).toBe(true);
    expect(h.fetches).toEqual([h.medium, h.high]);
    h.settle();
    expect(h.drawn()).toEqual({ [h.high]: true });
    d.dispose();
    expect(h.packs.wocArmorPackRefs(h.high)).toBe(0);
  });
});

describe('a detail change that has nothing to change', () => {
  it('keeps the kit a body was born with when nobody dressed it through want', async () => {
    const h = await harness('high');
    h.packs.ensureWocArmorPack(h.medium);
    await h.land(h.medium);
    // a speculative build: its kit attached at assembly, never wanted
    h.dressing.attachWocArmorAtBuild(h.host.model, manifest, undefined, false, 'crowd');
    const d = new h.dressing.WocArmorDressing(h.host, manifest, 'crowd');
    expect(d.attachedFiles).toEqual([{ set: 'test', url: h.medium }]);
    d.setDetail('full');
    expect(d.poll()).toBe(false);
    expect(d.attachedFiles).toEqual([{ set: 'test', url: h.medium }]);
    expect(h.fetches).toEqual([h.medium]);
    d.dispose();
  });

  it.each([
    ['the low preset', 'low', false, 'low'],
    ['a phone on the high preset', 'high', true, 'low'],
    ['the medium preset', 'medium', false, 'medium'],
  ] as const)(
    'draws one file whatever the detail on %s',
    async (_name, tier, constrained, file) => {
      const h = await harness(tier, constrained);
      const d = new h.dressing.WocArmorDressing(h.host, manifest, 'crowd');
      d.want(['test']);
      await h.land(h[file]);
      d.poll();
      h.settle();
      for (const detail of ['full', 'crowd', 'full'] as const) {
        d.setDetail(detail);
        expect(d.poll(), detail).toBe(false);
        expect(d.want(['test']), detail).toBe(false);
      }
      expect(h.fetches).toEqual([h[file]]);
      expect(h.drawn()).toEqual({ [h[file]]: true });
      expect(d.isWaiting).toBe(false);
      d.dispose();
    },
  );
});
